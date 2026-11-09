// Cuentas de clientes finales con correo + contraseña: registro, login, cambiar y recuperar por correo.
// Usa un IMAP de prueba (para conectar un Gmail) y un SMTP de prueba (para capturar los correos salientes).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:tls";
import { createApp } from "../dist/server/app.js";
import { parseMail } from "../dist/server/mail.js";

const FIX = new URL("./fixtures/", import.meta.url);
const cert = readFileSync(new URL("imap-test-cert.pem", FIX));
const key = readFileSync(new URL("imap-test-key.pem", FIX));

/** IMAP mínimo: solo lo justo para conectar un Gmail (LOGIN, SELECT, SEARCH, LOGOUT). */
function fakeImap(user, pass) {
  const mails = [];
  const srv = createServer({ key, cert }, (sock) => {
    let buf = "";
    sock.write("* OK Fake IMAP listo\r\n");
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const [tag, cmd, ...rest] = line.split(" ");
        const C = (cmd || "").toUpperCase();
        if (C === "LOGIN") {
          const ok = rest.join(" ") === `"${user}" "${pass}"`;
          sock.write(ok ? `${tag} OK LOGIN listo\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        } else if (C === "EXAMINE" || C === "SELECT") {
          sock.write(`* ${mails.length} EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n* OK [UIDNEXT ${mails.length + 1}] ok\r\n${tag} OK [READ-ONLY] listo\r\n`);
        } else if (C === "UID" && (rest[0] || "").toUpperCase() === "SEARCH") {
          sock.write(`* SEARCH\r\n${tag} OK listo\r\n`);
        } else if (C === "LOGOUT") {
          sock.end(`* BYE chau\r\n${tag} OK listo\r\n`);
        } else sock.write(`${tag} OK listo\r\n`);
      }
    });
    sock.on("error", () => {});
  });
  return { srv, mails, listen: () => new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv.address().port))) };
}

/** SMTP de prueba: habla lo justo que usa src/server/smtp.ts y guarda cada correo enviado. */
function fakeSmtp() {
  const mails = [];
  const srv = createServer({ key, cert }, (sock) => {
    sock.setEncoding("utf8");
    let buf = "", inData = false, data = "", from = "", rcpt = [], auth = 0;
    sock.write("220 fake smtp listo\r\n");
    sock.on("data", (d) => {
      buf += d;
      for (;;) {
        if (inData) {
          const idx = buf.indexOf("\r\n.\r\n");
          if (idx < 0) break;
          data += buf.slice(0, idx);
          buf = buf.slice(idx + 5);
          inData = false;
          mails.push({ from, rcpt: [...rcpt], data });
          sock.write("250 OK recibido\r\n");
          continue;
        }
        const i = buf.indexOf("\r\n");
        if (i < 0) break;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        if (auth === 1) { auth = 2; sock.write("334 UGFzc3dvcmQ6\r\n"); continue; } // pide contraseña
        if (auth === 2) { auth = 0; sock.write("235 OK autenticado\r\n"); continue; }
        const up = line.toUpperCase();
        if (up.startsWith("EHLO") || up.startsWith("HELO")) sock.write("250 hola\r\n");
        else if (up === "AUTH LOGIN") { auth = 1; sock.write("334 VXNlcm5hbWU6\r\n"); }
        else if (up.startsWith("MAIL FROM")) { from = line.slice(line.indexOf(":") + 1).trim(); sock.write("250 OK\r\n"); }
        else if (up.startsWith("RCPT TO")) { rcpt.push(line.slice(line.indexOf(":") + 1).trim()); sock.write("250 OK\r\n"); }
        else if (up === "DATA") { inData = true; data = ""; sock.write("354 dale\r\n"); }
        else if (up === "QUIT") { sock.write("221 chau\r\n"); sock.end(); }
        else sock.write("250 OK\r\n");
      }
    });
    sock.on("error", () => {});
  });
  return { srv, mails, listen: () => new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv.address().port))) };
}

/** Espera hasta que haya al menos n correos capturados (los de registro/forgot salen async). */
async function waitMails(smtp, n, ms = 2000) {
  const t0 = Date.now();
  while (smtp.mails.length < n && Date.now() - t0 < ms) await new Promise((r) => setTimeout(r, 15));
  return smtp.mails;
}

describe("Cuentas de clientes con correo y contraseña", () => {
  test("registrar, iniciar sesión, cambiar y recuperar la contraseña por correo", async () => {
    const imap = fakeImap("gabito.codigos@gmail.com", "abcdabcdabcdabcd");
    const smtp = fakeSmtp();
    const iport = await imap.listen();
    const sport = await smtp.listen();
    const app = createApp({
      dataDir: mkdtempSync(join(tmpdir(), "gs-email-")), jobs: false, log: () => {}, otpSender: () => {},
      staticDir: new URL("../public", import.meta.url).pathname,
      imapTest: { host: "localhost", port: iport, tls: { ca: cert } },
      smtpTest: { host: "localhost", port: sport, tls: { ca: cert } },
    });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const jar = {};
    const grab = (r) => { const c = r.headers.get("set-cookie"); if (c) jar.cookie = c.split(";")[0]; return r; };
    const call = (method, path, body, useCookie = false) => fetch(base + path, {
      method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(useCookie && jar.cookie ? { cookie: jar.cookie } : {}) },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const json = async (r) => ({ status: r.status, body: await r.json().catch(() => ({})) });
    try {
      // El dueño conecta su Gmail (necesario para que la tienda pueda mandar correos).
      const r0 = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
      const staffCookie = r0.headers.get("set-cookie").split(";")[0];
      const box = await fetch(base + "/api/admin/mailboxes", { method: "POST", headers: { "content-type": "application/json", cookie: staffCookie }, body: JSON.stringify({ kind: "gmail", address: "gabito.codigos@gmail.com", password: "abcd abcd abcd abcd", name: "Códigos" }) }).then(json);
      assert.equal(box.status, 200, JSON.stringify(box.body));

      // Registro: correo inválido y contraseña corta se rechazan.
      assert.equal((await json(await call("POST", "/api/auth/customer/register", { name: "Luci", email: "no-es-correo", password: "12345678" }))).status, 400);
      assert.equal((await json(await call("POST", "/api/auth/customer/register", { name: "Luci", email: "luci@correo.com", password: "123" }))).status, 400);

      // Registro correcto: crea la cuenta, deja sesión iniciada y manda correo de bienvenida.
      const reg = grab(await call("POST", "/api/auth/customer/register", { name: "Luci Vargas", email: "Luci@Correo.com", password: "miClave123" }));
      const regj = await json(reg);
      assert.equal(regj.status, 200, JSON.stringify(regj.body));
      assert.ok(jar.cookie, "deja cookie de sesión");
      assert.equal((await json(await call("GET", "/api/me", undefined, true))).body.loggedIn, true);
      assert.equal((await json(await call("GET", "/api/me/has-password", undefined, true))).body.hasPassword, true);

      // El mismo correo no se puede registrar dos veces.
      assert.equal((await json(await call("POST", "/api/auth/customer/register", { name: "Otra", email: "luci@correo.com", password: "otraClave9" }))).status, 400);

      // La contraseña NO queda legible en el estado (va cifrada/hasheada en secrets).
      assert.ok(!JSON.stringify(app.store.engine.s).includes("miClave123"), "la contraseña no está en el estado");

      // Login con correo: contraseña incorrecta falla, correcta entra (sin importar mayúsculas del correo).
      delete jar.cookie;
      assert.equal((await json(await call("POST", "/api/auth/customer/login-email", { email: "luci@correo.com", password: "mala" }))).status, 401);
      const loginOk = grab(await call("POST", "/api/auth/customer/login-email", { email: "LUCI@correo.com", password: "miClave123" }));
      assert.equal((await json(loginOk)).status, 200);
      assert.ok(jar.cookie);

      // Cambiar contraseña: pide la actual; con la actual correcta la cambia.
      assert.equal((await json(await call("POST", "/api/me/password", { current: "mala", password: "nuevaClave9" }, true))).status, 401);
      assert.equal((await json(await call("POST", "/api/me/password", { current: "miClave123", password: "nuevaClave9" }, true))).status, 200);
      // Ahora entra con la nueva, no con la vieja.
      delete jar.cookie;
      assert.equal((await json(await call("POST", "/api/auth/customer/login-email", { email: "luci@correo.com", password: "miClave123" }))).status, 401);
      assert.equal((await json(await call("POST", "/api/auth/customer/login-email", { email: "luci@correo.com", password: "nuevaClave9" }))).status, 200);

      // Recuperar: pedir enlace manda un correo con /recuperar?t=TOKEN.
      const before = smtp.mails.length;
      assert.equal((await json(await call("POST", "/api/auth/customer/forgot", { email: "luci@correo.com" }))).status, 200);
      const mails = await waitMails(smtp, before + 1);
      const resetMail = mails.slice().reverse().find((m) => parseMail(Buffer.from(m.data)).html?.includes("/recuperar?t=") || parseMail(Buffer.from(m.data)).text?.includes("/recuperar?t="));
      assert.ok(resetMail, "llegó el correo de recuperación");
      assert.ok(resetMail.rcpt.some((x) => x.includes("luci@correo.com")), "va al correo del cliente");
      const parsed = parseMail(Buffer.from(resetMail.data));
      const token = (parsed.html + " " + parsed.text).match(/\/recuperar\?t=([A-Za-z0-9_-]+)/)[1];
      assert.ok(token && token.length >= 16);

      // Un correo que no existe no da pistas (responde 200 igual) y no manda nada.
      const n1 = smtp.mails.length;
      assert.equal((await json(await call("POST", "/api/auth/customer/forgot", { email: "noexiste@correo.com" }))).status, 200);
      await new Promise((r) => setTimeout(r, 120));
      assert.equal(smtp.mails.length, n1, "no manda correo a cuentas que no existen");

      // La página de recuperación valida el token y deja ver el correo.
      const info = await json(await call("GET", `/api/auth/customer/reset/${token}`));
      assert.equal(info.status, 200);
      assert.equal(info.body.email, "luci@correo.com");

      // Poner la contraseña nueva con el token, y entrar con ella.
      delete jar.cookie;
      assert.equal((await json(await call("POST", "/api/auth/customer/reset", { token, password: "123" }))).status, 400, "respeta el mínimo");
      const done = grab(await call("POST", "/api/auth/customer/reset", { token, password: "recuperada7" }));
      assert.equal((await json(done)).status, 200);
      assert.ok(jar.cookie, "deja sesión iniciada tras recuperar");
      // El token es de un solo uso.
      assert.equal((await json(await call("GET", `/api/auth/customer/reset/${token}`))).status, 404);
      assert.equal((await json(await call("POST", "/api/auth/customer/reset", { token, password: "otraMas99" }))).status, 404);
      // Entra con la contraseña recuperada.
      delete jar.cookie;
      assert.equal((await json(await call("POST", "/api/auth/customer/login-email", { email: "luci@correo.com", password: "recuperada7" }))).status, 200);

      // La página /recuperar se sirve.
      const page = await fetch(`${base}/recuperar?t=${token}`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /Nueva contraseña|Recuperar/);
    } finally {
      await app.close();
      imap.srv.close();
      smtp.srv.close();
    }
  });
});
