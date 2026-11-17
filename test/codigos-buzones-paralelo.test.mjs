// Buzones de códigos en paralelo (17/11/2026): un buzón lento o caído no frena a los demás,
// y cada buzón tiene un tope de tiempo por vuelta. Antes se leían de a uno y el código llegaba tarde.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:tls";
import { createApp } from "../dist/server/app.js";

const FIX = new URL("./fixtures/", import.meta.url);
const cert = readFileSync(new URL("imap-test-cert.pem", FIX));
const key = readFileSync(new URL("imap-test-key.pem", FIX));
const disney = (to, code) => ["From: MyDisney <memberservices@disneyaccount.com>", `To: ${to}`, "Subject: Your one-time passcode for MyDisney",
  `Date: ${new Date(Date.now() + 5000).toUTCString()}`, "Content-Type: text/plain; charset=UTF-8", "", "Your one-time passcode is:", "", code, "", "© 2026 Disney"].join("\r\n");

/** IMAP de prueba con dos usuarios: el «lento» deja de contestar al LOGIN cuando `lento.on` es true. */
function fakeImap(users) {
  const mails = { }, lento = { on: false };
  for (const u of Object.keys(users)) mails[u] = [];
  const srv = createServer({ key, cert }, (sock) => {
    let buf = "", who = null;
    sock.write("* OK listo\r\n");
    sock.on("data", (d) => {
      buf += d.toString("latin1");
      let i;
      while ((i = buf.indexOf("\r\n")) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 2);
        const [tag, cmd, ...rest] = line.split(" ");
        const C = (cmd ?? "").toUpperCase(), box = who ? mails[who] : [];
        if (C === "LOGIN") {
          const u = Object.keys(users).find((x) => rest.join(" ") === `"${x}" "${users[x]}"`);
          if (u === "lento@gmail.com" && lento.on) continue; // no contesta nunca
          who = u ?? null;
          sock.write(u ? `${tag} OK\r\n` : `${tag} NO [AUTHENTICATIONFAILED] Invalid credentials\r\n`);
        } else if (C === "EXAMINE" || C === "SELECT") {
          sock.write(`* ${box.length} EXISTS\r\n* OK [UIDVALIDITY 7] ok\r\n* OK [UIDNEXT ${box.length + 1}] ok\r\n${tag} OK [READ-ONLY] listo\r\n`);
        } else if (C === "UID" && rest[0].toUpperCase() === "SEARCH") {
          let uids = box.map((_, k) => k + 1);
          const m = /^UID (\d+):\*$/i.exec(rest.slice(1).join(" "));
          if (m) uids = uids.filter((u) => u >= Number(m[1]));
          sock.write(`* SEARCH${uids.map((u) => " " + u).join("")}\r\n${tag} OK listo\r\n`);
        } else if (C === "UID" && rest[0].toUpperCase() === "FETCH") {
          const uid = Number(rest[1]), raw = Buffer.from(box[uid - 1], "utf8");
          sock.write(Buffer.concat([Buffer.from(`* ${uid} FETCH (UID ${uid} BODY[] {${raw.length}}\r\n`), raw, Buffer.from(`)\r\n${tag} OK listo\r\n`)]));
        } else if (C === "LOGOUT") sock.end(`* BYE\r\n${tag} OK\r\n`);
        else sock.write(`${tag} OK\r\n`);
      }
    });
    sock.on("error", () => {});
  });
  return { srv, mails, lento, listen: () => new Promise((ok) => srv.listen(0, "127.0.0.1", () => ok(srv.address().port))) };
}

test("un buzón que no contesta no frena el código de otro buzón", async () => {
  const imap = fakeImap({ "netscz108@gmail.com": "aaaabbbbccccdddd", "lento@gmail.com": "eeeeffffgggghhhh" });
  const port = await imap.listen();
  const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "gs-buzones-")), jobs: false, log: () => {}, otpSender: () => {}, staticDir: new URL("../public", import.meta.url).pathname,
    imapTest: { host: "localhost", port, tls: { ca: cert } }, mailBoxTimeoutMs: 1500 });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const r0 = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
  const cookie = r0.headers.get("set-cookie").split(";")[0];
  const call = (path, body) => fetch(base + path, { method: body ? "POST" : "GET", headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
  try {
    const s = app.store, owner = { id: "u_owner", role: "owner" };
    s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
    s.catalog.upsertProduct(owner, { id: "disney", name: "Disney+", kind: "full_account", durationDays: 30, price: 7000, published: true });
    s.inventory.addAccount(owner, { productId: "disney", supplierId: "prov", email: "netscz108+10m@gmail.com", password: "x-Clave#1", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
    const cabezas = s.catalog.createCustomer(owner, { name: "Cabezas", phone: "+591 70000009" });
    s.orders.create(owner, { customerId: cabezas.id, items: [{ productId: "disney", qty: 1 }], paymentMethod: "cash" });

    const lento = await call("/api/admin/mailboxes", { kind: "gmail", address: "lento@gmail.com", password: "eeee ffff gggg hhhh" });
    const rapido = await call("/api/admin/mailboxes", { kind: "gmail", address: "netscz108@gmail.com", password: "aaaa bbbb cccc dddd" });
    assert.equal(lento.status, 200); assert.equal(rapido.status, 200);
    await app.pollMail();

    // El buzón lento deja de contestar y llega un código al otro.
    imap.lento.on = true;
    imap.mails["netscz108@gmail.com"].push(disney("netscz108+10m@gmail.com", "735190"));
    const t0 = Date.now();
    const r = await app.pollMail();
    const tardo = Date.now() - t0;
    assert.ok(tardo < 4000, `la vuelta respetó el tope por buzón (tardó ${tardo} ms)`);
    assert.equal(r.checked, 2);
    assert.equal(r.found, 1, "el código del buzón que anda se guardó");
    assert.equal(r.errors, 1, "el buzón que no contesta queda con error");
    const mine = s.portal.codes({ id: "u_" + cabezas.id, role: "customer", customerId: cabezas.id }, cabezas.id);
    assert.deepEqual(mine.map((c) => c.code), ["735190"], "Cabezas ve su código");
    const boxes = (await call("/api/admin/mailboxes")).body;
    assert.match(boxes.find((b) => b.address === "lento@gmail.com").lastError ?? "", /tardó demasiado/);
  } finally { await app.close(); imap.srv.close(); }
});

test("Disney y MyDisney pasan siempre, aunque el buzón filtre asuntos o remitentes", async () => {
  const imap = fakeImap({ "netscz108@gmail.com": "aaaabbbbccccdddd", "lento@gmail.com": "eeeeffffgggghhhh" });
  const port = await imap.listen();
  const app = createApp({ dataDir: mkdtempSync(join(tmpdir(), "gs-disney-")), jobs: false, log: () => {}, otpSender: () => {}, staticDir: new URL("../public", import.meta.url).pathname,
    imapTest: { host: "localhost", port, tls: { ca: cert } } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const r0 = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
  const cookie = r0.headers.get("set-cookie").split(";")[0];
  const call = (path, body) => fetch(base + path, { method: body ? "POST" : "GET", headers: { cookie, ...(body ? { "content-type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }).then(async (r) => ({ status: r.status, body: await r.json() }));
  const mail = (from, subject, code) => [`From: ${from}`, "To: netscz108+10m@gmail.com", `Subject: ${subject}`, `Date: ${new Date(Date.now() + 5000).toUTCString()}`,
    "Content-Type: text/plain; charset=UTF-8", "", "Usá este código:", "", code, "", "© 2026"].join("\r\n");
  try {
    const s = app.store, owner = { id: "u_owner", role: "owner" };
    s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
    s.catalog.upsertProduct(owner, { id: "disney", name: "Disney+", kind: "full_account", durationDays: 30, price: 7000, published: true });
    s.inventory.addAccount(owner, { productId: "disney", supplierId: "prov", email: "netscz108+10m@gmail.com", password: "x-Clave#1", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
    const cab = s.catalog.createCustomer(owner, { name: "Cabezas", phone: "+591 70000009" });
    s.orders.create(owner, { customerId: cab.id, items: [{ productId: "disney", qty: 1 }], paymentMethod: "cash" });
    // Buzón viejo y estricto: solo asuntos con «netflix» y solo remitentes de Netflix.
    const box = await call("/api/admin/mailboxes", { kind: "gmail", address: "netscz108@gmail.com", password: "aaaa bbbb cccc dddd", subjects: "netflix", senders: "netflix" });
    assert.equal(box.status, 200);
    imap.mails["netscz108@gmail.com"].push(
      mail("MyDisney <memberservices@disneyaccount.com>", "Your MyDisney passcode", "111111"),
      mail("Disney+ <disneyplus@trx.mail2.disneyplus.com>", "Tu acceso a Disney+", "222222"),
      mail("MyDisney <memberservices@disneyaccount.com>", "Seu código de acesso único para MyDisney", "333 333"),
      mail("Ofertas <promo@tienda.com>", "Tu acceso a Disney+", "444444"),
    );
    await call(`/api/admin/mailboxes/${box.body.id}/check`, {});
    const mine = s.portal.codes({ id: "u_" + cab.id, role: "customer", customerId: cab.id }, cab.id).map((c) => c.code).sort();
    assert.deepEqual(mine, ["111111", "222222", "333 333"], "llegan los de Disney y MyDisney; el de otro remitente sigue filtrado");
  } finally { await app.close(); imap.srv.close(); }
});

