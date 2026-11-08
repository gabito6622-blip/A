// Panel de códigos: lector de correos (MIME), cliente IMAP contra un servidor de prueba y
// el recorrido completo: conectar el Gmail → leer → el cliente ve solo el código de su cuenta.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:tls";
import { createApp } from "../dist/server/app.js";
import { parseMail } from "../dist/server/mail.js";
import { extractCode, classifyCode } from "../dist/store/codes.js";

const FIX = new URL("./fixtures/", import.meta.url);
const cert = readFileSync(new URL("imap-test-cert.pem", FIX));
const key = readFileSync(new URL("imap-test-key.pem", FIX));
const b64 = (s) => Buffer.from(s, "utf8").toString("base64");

const disneyMail = (to, code) => [
  "From: Disney+ <disneyplus@trx.mail2.disneyplus.com>",
  `To: ${to}`,
  `Subject: =?UTF-8?B?${b64("Tu código de acceso único para Disney+")}?=`,
  `Date: ${new Date(Date.now() + 5000).toUTCString()}`,
  "MIME-Version: 1.0",
  'Content-Type: multipart/alternative; boundary="XYZ"',
  "",
  "--XYZ",
  "Content-Type: text/html; charset=UTF-8",
  "Content-Transfer-Encoding: base64",
  "",
  b64(`<html><body><p>Usá este código para iniciar sesión</p><table><tr><td style="font-size:28px">${code}</td></tr></table><p>Este código vence en 15 minutos.</p><p>© 2026 Disney</p></body></html>`),
  "--XYZ--",
  "",
].join("\r\n");

const netflixForwarded = (account) => [
  "From: Netflix <info@account.netflix.com>",
  "To: gabito.codigos@gmail.com",
  "Subject: Tu código de acceso temporal de Netflix",
  `Date: ${new Date(Date.now() + 5000).toUTCString()}`,
  "MIME-Version: 1.0",
  "Content-Type: text/html; charset=UTF-8",
  "Content-Transfer-Encoding: quoted-printable",
  "",
  `<p>---------- Mensaje reenviado ---------<br>Para: ${account}</p><p>Solicitaste acceso temporal.</p><a href=3D"https://www.netflix.com/account/travel/verify?nftoken=3DAB=`,
  `C123&amp;g=3D9">Obtener c=C3=B3digo</a>`,
  "",
].join("\r\n");

const promo = ["From: tienda@x.com", "To: disney01@hotmail.com", "Subject: Ofertas de la semana 123456", "Content-Type: text/plain", "", "Precio 123456", ""].join("\r\n");

/** Servidor IMAP mínimo para pruebas (solo lo que usa el lector). */
function fakeImap(user, pass) {
  const mails = [], appended = [];
  const srv = createServer({ key, cert }, (sock) => {
    let buf = "";
    sock.write("* OK Fake IMAP listo\r\n");
    let pending = null; // APPEND esperando el literal
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      let i;
      for (;;) {
        if (pending) {
          if (buf.length < pending.n + 2) break;
          appended.push({ folder: pending.folder, raw: Buffer.from(buf.slice(0, pending.n), "latin1") });
          buf = buf.slice(pending.n + 2);
          sock.write(`${pending.tag} OK APPEND listo\r\n`);
          pending = null;
          continue;
        }
        if ((i = buf.indexOf("\r\n")) < 0) break;
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const ap = /^(\S+) APPEND "([^"]+)" \(\\Seen\) \{(\d+)\}$/.exec(line);
        if (ap) { pending = { tag: ap[1], folder: ap[2], n: Number(ap[3]) }; sock.write("+ dale\r\n"); continue; }
        const [tag, cmd, ...rest] = line.split(" ");
        const C = cmd.toUpperCase();
        if (C === "LOGIN") {
          const ok = rest.join(" ") === `"${user}" "${pass}"`;
          sock.write(ok ? `${tag} OK LOGIN listo\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        } else if (C === "EXAMINE" || C === "SELECT") {
          sock.write(`* ${mails.length} EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n* OK [UIDNEXT ${mails.length + 1}] ok\r\n${tag} OK [READ-ONLY] listo\r\n`);
        } else if (C === "UID" && rest[0].toUpperCase() === "SEARCH") {
          let uids = mails.map((_, k) => k + 1);
          const m = /^UID (\d+):\*$/i.exec(rest.slice(1).join(" "));
          if (m) uids = uids.filter((u) => u >= Number(m[1]));
          sock.write(`* SEARCH${uids.map((u) => " " + u).join("")}\r\n${tag} OK listo\r\n`);
        } else if (C === "UID" && rest[0].toUpperCase() === "FETCH") {
          const uid = Number(rest[1]);
          const raw = Buffer.from(mails[uid - 1], "utf8");
          sock.write(Buffer.concat([Buffer.from(`* ${uid} FETCH (UID ${uid} BODY[] {${raw.length}}\r\n`), raw, Buffer.from(`)\r\n${tag} OK listo\r\n`)]));
        } else if (C === "CREATE") {
          sock.write(`${tag} OK creada\r\n`);
        } else if (C === "LOGOUT") {
          sock.end(`* BYE chau\r\n${tag} OK listo\r\n`);
        } else sock.write(`${tag} BAD no entiendo\r\n`);
      }
    });
    sock.on("error", () => {});
  });
  return { srv, mails, appended, listen: () => new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv.address().port))) };
}

describe("Panel de códigos", () => {
  test("lector de correos: asunto codificado, base64, quoted-printable y enlace de Netflix", () => {
    const d = parseMail(Buffer.from(disneyMail("disney01@hotmail.com", "482913")));
    assert.equal(d.subject, "Tu código de acceso único para Disney+");
    assert.deepEqual(d.recipients, ["disney01@hotmail.com"]);
    assert.equal(extractCode(d.text, d.html).code, "482913", "no confunde el año 2026 con el código");
    const n = parseMail(Buffer.from(netflixForwarded("nf01@gabo.lat")));
    assert.match(n.text, /Obtener código/);
    const x = extractCode(n.text, n.html);
    assert.equal(classifyCode("Tu código de inicio de sesión de Netflix", ""), "login");
    assert.equal(classifyCode("Actualizar tu Hogar con Netflix", ""), "hogar");
    assert.equal(classifyCode("Your one-time passcode for MyDisney", ""), "verificacion");
    assert.equal(classifyCode("Tu código de acceso único para Disney+", ""), "verificacion");
    assert.equal(classifyCode("Tu código de acceso temporal", ""), "temporal");
    assert.equal(x.link, "https://www.netflix.com/account/travel/verify?nftoken=ABC123&g=9");
  });

  test("conectar Gmail, leer solo lo nuevo y mostrar el código solo al dueño de la cuenta", async () => {
    const imap = fakeImap("gabito.codigos@gmail.com", "abcdabcdabcdabcd");
    const port = await imap.listen();
    const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "gs-codes-")), jobs: false, log: () => {}, otpSender: () => {}, staticDir: new URL("../public", import.meta.url).pathname,
      imapTest: { host: "localhost", port, tls: { ca: cert } } });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const r0 = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    const cookie = r0.headers.get("set-cookie").split(";")[0];
    const call = (path, body) => fetch(base + path, { method: body ? "POST" : "GET", headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
    try {
      // Datos: una cuenta Disney vendida a Ana y una Netflix vendida a Beto.
      const s = app.store, owner = { id: "u_owner", role: "owner" };
      s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
      s.catalog.upsertProduct(owner, { id: "disney", name: "Disney+", kind: "full_account", durationDays: 30, price: 3500, published: true });
      s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
      s.inventory.addAccount(owner, { productId: "disney", supplierId: "prov", email: "disney01@hotmail.com", password: "x-Clave#1", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 1000, profiles: [{ label: "Cuenta" }] });
      s.inventory.addAccount(owner, { productId: "netflix", supplierId: "prov", email: "nf01@gabo.lat", password: "x-Clave#2", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 1000, profiles: [{ label: "Perfil 1" }] });
      const ana = s.catalog.createCustomer(owner, { name: "Ana", phone: "+591 70000001" });
      const beto = s.catalog.createCustomer(owner, { name: "Beto", phone: "+591 70000002" });
      s.orders.create(owner, { customerId: ana.id, items: [{ productId: "disney", qty: 1 }], paymentMethod: "cash" });
      s.orders.create(owner, { customerId: beto.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });

      imap.mails.push(disneyMail("disney01@hotmail.com", "111222"), promo);
      const bad = await call("/api/admin/mailboxes/test", { kind: "gmail", address: "gabito.codigos@gmail.com", password: "mala" });
      assert.equal(bad.status, 400);
      assert.match(bad.body.message, /incorrect/i);
      const ok = await call("/api/admin/mailboxes/test", { kind: "gmail", address: "gabito.codigos@gmail.com", password: "abcd abcd abcd abcd" });
      assert.equal(ok.body.messages, 2);
      const box = await call("/api/admin/mailboxes", { kind: "gmail", address: "gabito.codigos@gmail.com", password: "abcd abcd abcd abcd", name: "Códigos" });
      assert.equal(box.status, 200);
      const chk = await call(`/api/admin/mailboxes/${box.body.id}/check`, {});
      assert.equal(chk.body.errors, 0);
      const list = await call("/api/admin/mailboxes");
      assert.equal(list.body[0].hasPassword, true);
      assert.equal(list.body[0].password, undefined, "la contraseña nunca sale");
      assert.ok(!JSON.stringify(app.store.engine.s).includes("abcdabcd"), "la contraseña no está en el estado");

      // Llega un correo nuevo (reenviado): solo se lee ese.
      imap.mails.push(netflixForwarded("nf01@gabo.lat"));
      await call(`/api/admin/mailboxes/${box.body.id}/check`, {});
      const codes = (await call("/api/admin/codes")).body;
      assert.equal(codes.length, 2, "la promo se descarta");
      assert.equal(codes.filter((c) => c.code === "111222").length, 1, "no se duplica al leer otra vez");
      assert.ok(codes.every((c) => c.matched));

      const anaCodes = s.portal.codes({ id: "u_" + ana.id, role: "customer", customerId: ana.id }, ana.id);
      assert.deepEqual(anaCodes.map((c) => c.code), ["111222"]);
      const betoCodes = s.portal.codes({ id: "u_" + beto.id, role: "customer", customerId: beto.id }, beto.id);
      assert.equal(betoCodes.length, 1);
      assert.match(betoCodes[0].link, /netflix\.com\/account\/travel/);

      // Solo Disney: un correo de Netflix ya no se guarda; uno de MyDisney en inglés sí.
      const ed = await call("/api/admin/mailboxes", { id: box.body.id, kind: "gmail", address: "gabito.codigos@gmail.com", senders: "disney" });
      assert.deepEqual(ed.body.senderAllowlist, ["disney"]);
      imap.mails.push(netflixForwarded("nf01@gabo.lat"));
      imap.mails.push(["From: MyDisney <memberservices@disneyaccount.com>", "To: disney01@hotmail.com", "Subject: Your one-time passcode for MyDisney", `Date: ${new Date(Date.now() + 5000).toUTCString()}`, "Content-Type: text/plain; charset=UTF-8", "", "Your one-time passcode is:", "", "735 190", "", "© 2026 Disney"].join("\r\n"));
      await call(`/api/admin/mailboxes/${box.body.id}/check`, {});
      const after = (await call("/api/admin/codes")).body;
      assert.equal(after.length, 3, "solo se sumó el de MyDisney");
      assert.equal(after[0].code, "735 190");

      // Link de códigos con PIN para Ana (como si fuera revendedora).
      const lk = await call(`/api/admin/customers/${ana.id}/code-link`, { pin: "4821" });
      assert.equal(lk.status, 200, JSON.stringify(lk.body));
      const token = lk.body.url.split("/codigos/")[1];
      const pub = (pinv) => fetch(`${base}/api/code-link/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ pin: pinv }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
      assert.equal((await fetch(`${base}/api/code-link/${token}`).then((r) => r.json())).name, "Ana");
      assert.equal((await pub("0000")).status, 401);
      const okPin = await pub("4821");
      assert.equal(okPin.status, 200);
      assert.deepEqual(okPin.body.codes.map((x) => x.code).sort(), ["111222", "735 190"].sort(), "solo los códigos de las cuentas de Ana");
      for (let i = 0; i < 5; i++) await pub("1111");
      assert.equal((await pub("4821")).status, 429, "se bloquea tras muchos intentos");
      const page = await fetch(`${base}/codigos/${token}`);
      assert.equal(page.status, 200);
      assert.match(await page.text(), /PIN de 4 números/, "sirve la página del link");

      // Link "escribí tu correo" (sin PIN) para Beto: el cliente pone su correo y ve solo ese código.
      const elk = await call(`/api/admin/customers/${beto.id}/code-link`, {});
      assert.equal(elk.status, 200, JSON.stringify(elk.body));
      assert.equal(elk.body.mode, "email", "sin PIN => modo correo");
      const etoken = elk.body.url.split("/codigos/")[1];
      assert.equal((await fetch(`${base}/api/code-link/${etoken}`).then((r) => r.json())).mode, "email");
      const byEmail = (em) => fetch(`${base}/api/code-link/${etoken}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: em }) }).then(async (r) => ({ status: r.status, body: await r.json() }));
      const mine = await byEmail("nf01@gabo.lat");
      assert.equal(mine.status, 200);
      assert.ok(mine.body.codes.length >= 1 && mine.body.codes.every((c) => c.to === "nf01@gabo.lat"), "solo el código de ese correo");
      const foreign = await byEmail("disney01@hotmail.com");
      assert.equal(foreign.body.codes.length, 0, "no muestra cuentas que no son de este revendedor/cliente");
      assert.equal((await byEmail("no-es-correo")).status, 400, "pide un correo válido");

      // Copia del respaldo en el Gmail (carpeta "Respaldos GaboHub").
      const cfgOff = await call("/api/admin/offsite", { enabled: true, mailboxId: box.body.id });
      assert.equal(cfgOff.status, 200);
      const sent = await call("/api/admin/offsite/send", {});
      assert.equal(sent.status, 200);
      assert.equal(sent.body.lastError, undefined);
      assert.equal(imap.appended.length, 1);
      assert.equal(imap.appended[0].folder, "Respaldos GaboHub");
      const bk = parseMail(imap.appended[0].raw);
      assert.match(bk.subject, /^Respaldo GaboHub \d{4}-\d{2}-\d{2}$/);
      const zipB64 = imap.appended[0].raw.toString("latin1").split("filename=")[1].split("\r\n\r\n")[1].split("\r\n--")[0];
      const zip = Buffer.from(zipB64.replace(/\s+/g, ""), "base64");
      assert.equal(zip.readUInt32LE(0), 0x04034b50, "adjunto es un zip");
      assert.ok(zip.includes(Buffer.from("gabriel.db")));

      const del = await call(`/api/admin/mailboxes/${box.body.id}/delete`, {});
      assert.equal(del.status, 200);
      assert.equal((await call("/api/admin/mailboxes")).body.length, 0);
    } finally {
      await app.close();
      imap.srv.close();
    }
  });
});
