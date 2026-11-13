// "🔔 Avisarme antes de que venza": avisos automáticos de vencimiento al celular del cliente final (Web Push).
// Reloj controlado y servicio de push falso (fetchImpl): no sale nada real, ni WhatsApp, ni SMS, ni correo.
// Cubre: 3 días / 1 día / hoy, uno por día sin repetir, agrupado; cliente de revendedor ("Renová con…", sin
// precio); suscripción atada a un link /c/<token> (alta, baja, se borra al cambiar/revocar el link, borrar el
// perfil o liberar el cupo); 410 borra; permisos y separación entre revendedores; lista cerrada de /api/cobro;
// y el navegador a 360 px (se salta sin Playwright).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";
import { generateVapidKeys } from "../dist/server/push.js";
import { alertText, daysUntil } from "../dist/store/expiryAlerts.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const owner = { id: "u_owner", role: "owner" };
const asR = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });
const H = 3_600_000, D = 24 * H;
// 12/12/2026 a las 10:00 de Bolivia (UTC-4).
const T0 = Date.UTC(2026, 11, 12, 14, 0);
const at = (day, hourLaPaz = 10) => Date.UTC(2026, 11, day, hourLaPaz + 4, 0);
const exp = (day) => Date.UTC(2026, 11, day, 18, 0); // vence ese día a las 14:00 de Bolivia
const FCM = "https://fcm.googleapis.com/fcm/send/";
const EP = { ana: FCM + "ana-cel", carla: FCM + "carla-cel", rosa: FCM + "rosa-cel", tel: FCM + "lucia-cel", tel2: FCM + "lucia-tablet" };
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };
const PUBLIC_KEYS = ["alerts", "codes", "currency", "expiresAt", "hasLogo", "hasQr", "label", "name", "pay", "price", "product", "seller", "sellerWhatsapp"];

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

function unzipText(buf) {
  let out = "", i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const start = i + 30 + nameLen + extra, data = buf.subarray(start, start + size);
    out += (method === 8 ? inflateRawSync(data) : data).toString("utf8") + "\n";
    i = start + size;
  }
  return out;
}

describe("avisos solos: textos", () => {
  test("días de calendario en Bolivia y texto en voseo, sin montos", () => {
    assert.equal(daysUntil(exp(15), T0), 3);
    assert.equal(daysUntil(exp(13), T0), 1);
    assert.equal(daysUntil(Date.UTC(2026, 11, 13, 3, 0), T0), 0, "las 23:00 del 12 en Bolivia todavía es hoy");
    const one = alertText([{ key: "a", product: "Disney+", expiresAt: exp(15), days: 1 }]);
    assert.deepEqual(one, { title: "🔔 Tu Disney+ vence mañana (15/12)", body: "Tocá para renovar." });
    const via = alertText([{ key: "a", product: "Disney+", expiresAt: exp(15), days: 0 }], { seller: "Rosa TV", action: "write" });
    assert.deepEqual(via, { title: "🔔 Tu Disney+ vence hoy (15/12)", body: "Renová con Rosa TV. Tocá para escribirle." });
    const many = alertText([{ key: "a", product: "Netflix", expiresAt: exp(13), days: 1 }, { key: "b", product: "Disney+", expiresAt: exp(15), days: 3 }]);
    assert.equal(many.title, "🔔 2 servicios tuyos vencen pronto");
    assert.equal(many.body, "Netflix mañana (13/12) · Disney+ en 3 días (15/12). Tocá para renovar.");
  });
});

describe("avisos solos (API)", () => {
  const clock = { t: T0, now() { return this.t; } };
  const vapid = { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" };
  const sent = [];
  const status = {};
  let dir, app, base, s, ana, carla, rosa, juan, aidRosa, aidJuan, lucia, mario, juanSub, tk1, tk2, tkJuan;
  const cookies = {};
  const count = (ep) => sent.filter((u) => u === ep).length;
  const call = async (m, p, body, who) => {
    const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(who ? { cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
    return { status: r.status, json, text };
  };
  const loginStaff = async () => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
  const loginCustomer = async (id, phone) => {
    await call("POST", `/api/admin/customers/${id}/login-pin`, { pin: "2468" }, "owner");
    return (await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, pin: "2468" }) })).headers.get("set-cookie").split(";")[0];
  };
  const setExp = (aid, t) => s.engine.tx(() => { s.engine.s.assignments[aid].customerExpiresAt = t; });
  const tsubs = () => JSON.parse(app.db.getSecret("push_tsubs") ?? "[]");
  const latestFor = async (ep) => (await call("POST", "/api/cobro-push/latest", { endpoint: ep })).json;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-avisos-"));
    const fetchImpl = async (url) => { sent.push(String(url)); return new Response("", { status: status[url] ?? 201 }); };
    app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {}, clock, vapid, fetchImpl });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    s = app.store;
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertProduct(owner, { id: "sp", name: "Spotify", kind: "profile", durationDays: 30, price: 2000, published: true });
    s.catalog.upsertProduct(owner, { id: "dp", name: "Disney+", kind: "profile", durationDays: 30, price: 3000, published: true });
    s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 3400, published: true, resellersOnly: true });
    s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "netflix-secreto@x.lat", password: "Clave-Secreta#77", supplierExpiresAt: T0 + 90 * D, cost: 1111, profiles: [{ label: "P1" }, { label: "P2" }] });
    s.inventory.addAccount(owner, { productId: "sp", supplierId: "andes", email: "spotify-secreto@x.lat", password: "Clave-Secreta#78", supplierExpiresAt: T0 + 90 * D, cost: 1111, profiles: [{ label: "S1" }] });
    s.inventory.addAccount(owner, { productId: "dp", supplierId: "andes", email: "disney-secreto@x.lat", password: "Clave-Secreta#79", supplierExpiresAt: T0 + 90 * D, cost: 1111, profiles: [{ label: "D1" }] });
    for (const email of ["alq-rosa@x.lat", "alq-juan@x.lat"]) s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "andes", email, password: "Clave-Secreta#80", supplierExpiresAt: T0 + 90 * D, cost: 2111, profiles: [{ label: "Cuenta completa" }] });
    ana = s.catalog.createCustomer(owner, { name: "Ana Tienda", phone: "+59170000001" });
    rosa = s.catalog.createCustomer(owner, { name: "Rosa Mamani", phone: "+59171111111", kind: "reseller" });
    juan = s.catalog.createCustomer(owner, { name: "Juan Play", phone: "+59172222222", kind: "reseller" });
    s.shops.setupFor(owner, rosa.id, { slug: "rosa-tv", title: "Rosa TV", whatsapp: "59171111111", enabled: true });
    carla = s.catalog.createCustomer(asR(rosa), { name: "Carla Cliente", phone: "+59173333333" });
    const buy = (cid, pid) => s.orders.create(owner, { customerId: cid, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    setExp(buy(ana.id, "nf"), exp(15));
    setExp(buy(ana.id, "sp"), exp(13));
    setExp(buy(carla.id, "dp"), exp(13));
    setExp(buy(rosa.id, "nf"), exp(13)); // su propio servicio: el revendedor tiene su aviso aparte
    aidRosa = buy(rosa.id, "dis-alq"); setExp(aidRosa, exp(30));
    aidJuan = buy(juan.id, "dis-alq"); setExp(aidJuan, exp(30));
    cookies.owner = await loginStaff();
    cookies.ana = await loginCustomer(ana.id, "+59170000001");
    cookies.carla = await loginCustomer(carla.id, "+59173333333");
    cookies.rosa = await loginCustomer(rosa.id, "+59171111111");
    cookies.juan = await loginCustomer(juan.id, "+59172222222");
    lucia = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Lucía Rojas", phone: "75556677", label: "Mamá", expiresAt: exp(15), price: 1500, pay: "pendiente" }, "rosa")).json.sub;
    mario = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Mario Rojas", phone: "75556678", label: "Papá", expiresAt: exp(13), price: 1500 }, "rosa")).json.sub;
    juanSub = (await call("POST", `/api/me/subs/${aidJuan}`, { name: "Pedro Juancito", phone: "74445566", expiresAt: exp(14), price: 2000 }, "juan")).json.sub;
    tk1 = (await call("POST", `/api/me/subs/${aidRosa}/${lucia.id}/link`, {}, "rosa")).json.token;
    tk2 = (await call("POST", `/api/me/subs/${aidRosa}/${mario.id}/link`, {}, "rosa")).json.token;
    tkJuan = (await call("POST", `/api/me/subs/${aidJuan}/${juanSub.id}/link`, {}, "juan")).json.token;
    assert.ok(tk1 && tk2 && tkJuan);
    for (const who of ["ana", "carla", "rosa"]) assert.equal((await call("POST", "/api/me/push/subscribe", { subscription: { endpoint: EP[who], keys: KEYS } }, who)).status, 200);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("link de cobro: activar avisos sin cuenta, atados a ese token; la respuesta pública solo suma `alerts`", async () => {
    const v0 = await call("GET", `/api/cobro/${tk1}`);
    assert.deepEqual(Object.keys(v0.json).sort(), PUBLIC_KEYS, "lista cerrada");
    assert.equal(v0.json.alerts, false);
    const cfg = await call("GET", `/api/cobro/${tk1}/alerts`);
    assert.deepEqual(cfg.json, { configured: true, publicKey: vapid.publicKey });
    assert.equal((await call("POST", `/api/cobro/${tk1}/alerts`, { action: "on", subscription: { endpoint: "https://evil.com/x" } })).status, 400, "solo servicios de push conocidos");
    for (const [ep, tk] of [[EP.tel, tk1], [EP.tel, tk2], [EP.tel2, tk1]]) {
      const r = await call("POST", `/api/cobro/${tk}/alerts`, { action: "on", subscription: { endpoint: ep, keys: KEYS } });
      assert.deepEqual(r.json, { ok: true, on: true });
    }
    assert.equal((await call("GET", `/api/cobro/${tk1}`)).json.alerts, true);
    assert.equal((await call("GET", `/api/cobro/${tkJuan}`)).json.alerts, false, "otro link no se entera");
    assert.deepEqual((await call("POST", `/api/cobro/${tk1}/alerts`, { action: "check", endpoint: EP.tel })).json, { on: true });
    assert.deepEqual((await call("POST", `/api/cobro/${tkJuan}/alerts`, { action: "check", endpoint: EP.tel })).json, { on: false });
    // Con un token no se apaga lo de otro: "off" con el link de Juan no toca la suscripción del link de Rosa.
    await call("POST", `/api/cobro/${tkJuan}/alerts`, { action: "off", endpoint: EP.tel });
    assert.deepEqual((await call("POST", `/api/cobro/${tk1}/alerts`, { action: "check", endpoint: EP.tel })).json, { on: true });
    // Un token inventado: el mismo 404 genérico de siempre.
    const bad = await call("POST", `/api/cobro/${"Q".repeat(40)}/alerts`, { action: "on", subscription: { endpoint: EP.tel } });
    assert.equal(bad.status, 404);
    assert.equal(tsubs().length, 3);
  });

  test("3 días antes: uno por cliente, agrupado si son varios; cliente de revendedor: 'Renová con…' sin precio", async () => {
    clock.t = at(12);
    const st = await app.checkExpiryPush();
    assert.deepEqual(st, { day: "2026-12-12", sent: 4, customers: 2, links: 2, failed: 0, lastAt: clock.t }, "lastAt = hora real del último aviso (la usa Mi oficina)");
    assert.equal(count(EP.ana), 1);
    assert.equal(count(EP.carla), 1);
    assert.equal(count(EP.tel), 1, "un solo aviso por celular aunque tenga dos links");
    assert.equal(count(EP.tel2), 1);
    assert.equal(count(EP.rosa), 0, "el revendedor no recibe estos avisos (tiene el suyo)");
    const a = (await call("GET", "/api/me/push/latest", null, "ana")).json;
    assert.equal(a.title, "🔔 2 servicios tuyos vencen pronto");
    assert.equal(a.body, "Spotify mañana (13/12) · Netflix en 3 días (15/12). Tocá para renovar.");
    assert.equal(a.url, "/tienda/#cuentas");
    const c = (await call("GET", "/api/me/push/latest", null, "carla")).json;
    assert.equal(c.title, "🔔 Tu Disney+ vence mañana (13/12)");
    assert.equal(c.body, "Renová con Rosa TV. Tocá para escribirle.");
    assert.match(c.url, /^https:\/\/wa\.me\/59171111111\?text=/);
    assert.equal(decodeURIComponent(c.url.split("text=")[1]), "Hola, quiero renovar mi Disney+ (vence el 13/12).");
    const t = await latestFor(EP.tel);
    assert.equal(t.title, "🔔 2 servicios tuyos vencen pronto");
    assert.equal(t.body, "Disney+ mañana (13/12) · Disney+ en 3 días (15/12). Renová con Rosa TV. Tocá para ver cómo pagar.");
    assert.equal(t.url, `/c/${tk2}`);
    const t2 = await latestFor(EP.tel2);
    assert.deepEqual([t2.title, t2.url], ["🔔 Tu Disney+ vence en 3 días (15/12)", `/c/${tk1}`]);
    // Privacidad: nada de contraseñas, correos, montos ni nombres de otros clientes.
    for (const m of [a, c, t, t2]) {
      // El token del link /c/<token> es al azar y a veces contiene «Bs» (falló así en la CI el 13/11): se revisa el texto, no el token.
      const txt = JSON.stringify({ ...m, url: String(m.url ?? "").replace(/[A-Za-z0-9_-]{20,}/g, "TOKEN") });
      for (const x of ["Clave-Secreta", "@x.lat", "secreto", "Bs", "15.00", "Lucía", "Mario", "Ana Tienda", "alquiler", "Mamá"]) assert.ok(!txt.includes(x), `el aviso muestra ${x}: ${txt}`);
    }
    // El dueño ve solo cuántos salieron hoy.
    assert.deepEqual((await call("GET", "/api/admin/expiry-alerts", null, "owner")).json, { day: "2026-12-12", sent: 4, customers: 2, links: 2, failed: 0, on: true });
    // Un endpoint que no es de nadie: texto genérico.
    assert.deepEqual(await latestFor(FCM + "nadie"), { title: "Tenés un aviso", body: "Tocá para verlo.", url: "/", at: 0 });
  });

  test("sin repetir: el mismo día no vuelve a avisar (ni reiniciando el trabajo) y antes de las 9 no avisa", async () => {
    const n = sent.length;
    assert.equal(await app.checkExpiryPush(), null, "ya corrió hoy");
    app.db.setSecret("exp_day", null, clock.now()); // como si se borrara la marca del día
    const st = await app.checkExpiryPush();
    assert.equal(st.sent, 4, "el conteo del día no cambia");
    assert.equal(sent.length, n, "no repite ningún aviso");
    clock.t = at(13, 8);
    assert.equal(await app.checkExpiryPush(), null, "a las 8 de Bolivia todavía no");
    assert.equal(sent.length, n);
  });

  test("1 día antes y el día que vence; el día 2 no avisa", async () => {
    clock.t = at(13);
    await app.checkExpiryPush();
    assert.equal(count(EP.ana), 2);
    assert.equal((await call("GET", "/api/me/push/latest", null, "ana")).json.title, "🔔 Tu Spotify vence hoy (13/12)");
    assert.equal(count(EP.carla), 2);
    assert.equal((await call("GET", "/api/me/push/latest", null, "carla")).json.title, "🔔 Tu Disney+ vence hoy (13/12)");
    assert.equal(count(EP.tel), 2);
    assert.equal((await latestFor(EP.tel)).title, "🔔 Tu Disney+ vence hoy (13/12)");
    assert.equal(count(EP.tel2), 1, "Lucía está a 2 días: nada");
    clock.t = at(14);
    await app.checkExpiryPush();
    assert.equal(count(EP.ana), 3);
    assert.equal((await call("GET", "/api/me/push/latest", null, "ana")).json.title, "🔔 Tu Netflix vence mañana (15/12)");
    assert.equal(count(EP.carla), 2, "lo de Carla ya venció");
    assert.equal(count(EP.tel), 3);
    assert.equal(count(EP.tel2), 2);
    assert.equal((await latestFor(EP.tel2)).title, "🔔 Tu Disney+ vence mañana (15/12)");
    assert.equal(count(EP.rosa), 0);
  });

  test("si el servicio de push dice que el celular ya no existe (410), la suscripción se borra", async () => {
    status[EP.tel2] = 410;
    status[EP.ana] = 404;
    clock.t = at(15);
    const st = await app.checkExpiryPush();
    assert.deepEqual(st, { day: "2026-12-15", sent: 1, customers: 0, links: 1, failed: 0, lastAt: clock.t }, "solo el celular que sigue vivo");
    assert.ok(!tsubs().some((x) => x.endpoint === EP.tel2), "se borró la del link");
    assert.equal((await call("POST", `/api/cobro/${tk1}/alerts`, { action: "check", endpoint: EP.tel2 })).json.on, false);
    assert.equal((await call("GET", "/api/me/push", null, "ana")).json.mine, 0, "se borró la del cliente con cuenta");
    assert.equal((await latestFor(EP.tel)).title, "🔔 Tu Disney+ vence hoy (15/12)");
    clock.t = at(16);
    const n = sent.length;
    await app.checkExpiryPush();
    assert.equal(sent.length, n, "ya venció todo: nada más");
    delete status[EP.tel2]; delete status[EP.ana];
  });

  test("dueño: solo conteos del día; el panel y las exportaciones no muestran suscripciones", async () => {
    cookies.owner = await loginStaff();
    const r = await call("GET", "/api/admin/expiry-alerts", null, "owner");
    assert.deepEqual(Object.keys(r.json).sort(), ["customers", "day", "failed", "links", "on", "sent"]);
    assert.equal(r.json.day, "2026-12-16");
    assert.equal(r.json.sent, 0, "día nuevo: arranca en cero");
    assert.ok([401, 403].includes((await call("GET", "/api/admin/expiry-alerts", null, "ana")).status), "un cliente no lo ve");
    const hidden = ["lucia-cel", "fcm.googleapis.com", tk1, KEYS.auth];
    for (const p of ["/api/admin/expiry-alerts", "/api/admin/customers", `/api/admin/customers/${rosa.id}`, "/api/admin/push", "/api/admin/notifications"]) {
      const x = await call("GET", p, null, "owner");
      for (const h of hidden) assert.ok(!x.text.includes(h), `${p} muestra ${h}`);
    }
    const xl = await fetch(`${base}/api/admin/export/todo`, { headers: { cookie: cookies.owner } });
    assert.equal(xl.status, 200);
    const txt = unzipText(Buffer.from(await xl.arrayBuffer()));
    for (const h of hidden) assert.ok(!txt.includes(h), `la exportación muestra ${h}`);
    // Tampoco en lo que ve el revendedor de su cuaderno.
    const mine = await call("GET", "/api/me/subs", null, "rosa");
    for (const h of ["lucia-cel", "fcm.googleapis.com", KEYS.auth]) assert.ok(!mine.text.includes(h));
  });

  test("revendedor: ve quiénes de SUS clientes reciben avisos; otro revendedor no ve nada ajeno", async () => {
    const r = await call("GET", "/api/me/link-alerts", null, "rosa");
    assert.deepEqual(r.json, { subs: [`${aidRosa}|${lucia.id}`, `${aidRosa}|${mario.id}`], own: [], count: 2 });
    assert.ok(!r.text.includes("fcm") && !r.text.includes(tk1), "solo ids suyos, nunca endpoints ni tokens");
    assert.equal((await call("POST", `/api/cobro/${tkJuan}/alerts`, { action: "on", subscription: { endpoint: FCM + "pedro", keys: KEYS } })).status, 200);
    const j = await call("GET", "/api/me/link-alerts", null, "juan");
    assert.deepEqual(j.json, { subs: [`${aidJuan}|${juanSub.id}`], own: [], count: 1 });
    assert.equal((await call("GET", "/api/me/link-alerts", null, "ana")).status, 403, "un cliente no es revendedor");
    assert.equal((await call("GET", "/api/me/link-alerts")).status, 401, "sin sesión, nada");
    // Juan no puede tocar el link de Rosa (ni cambiarlo ni borrarlo).
    assert.equal((await call("POST", `/api/me/subs/${aidRosa}/${lucia.id}/link/revoke`, {}, "juan")).status, 403);
    assert.ok(tsubs().some((x) => x.token === tk1));
  });

  test("dejar de avisarme; cambiar el link, borrar el perfil o liberar el cupo borra la suscripción", async () => {
    // Dejar de avisarme (desde la página del link).
    assert.deepEqual((await call("POST", `/api/cobro/${tk2}/alerts`, { action: "off", endpoint: EP.tel })).json, { ok: true, on: false });
    assert.equal((await call("GET", `/api/cobro/${tk2}`)).json.alerts, false);
    // Cambiar (revocar) el link: la suscripción del link viejo se borra.
    assert.ok(tsubs().some((x) => x.token === tk1));
    assert.equal((await call("POST", `/api/me/subs/${aidRosa}/${lucia.id}/link/revoke`, {}, "rosa")).status, 200);
    assert.ok(!tsubs().some((x) => x.token === tk1), "se borró al revocar");
    // Borrar el perfil.
    const tk3 = (await call("POST", `/api/me/subs/${aidRosa}/${lucia.id}/link`, {}, "rosa")).json.token;
    await call("POST", `/api/cobro/${tk3}/alerts`, { action: "on", subscription: { endpoint: EP.tel, keys: KEYS } });
    assert.ok(tsubs().some((x) => x.token === tk3));
    assert.equal((await call("POST", `/api/me/subs/${aidRosa}/${lucia.id}/delete`, {}, "rosa")).status, 200);
    assert.ok(!tsubs().some((x) => x.token === tk3), "se borró al borrar el perfil");
    // Mis cuentas propias: liberar el cupo y cambiar el link.
    const R = asR(rosa);
    const p = s.own.saveProduct(R, { name: "Flujo TV", durationDays: 30, price: 3000, kind: "full" });
    const acc = s.own.saveAccount(R, { productId: p.id, user: "flujo01", password: "clave-flujo-1" });
    const accId = acc.id ?? s.own.view(R).accounts[0].id;
    const sale = s.own.assign(R, { accountId: accId, name: "Nina Flujo", phone: "76667788", expiresAt: exp(20) });
    const tko = (await call("POST", `/api/me/own/sales/${sale.id}/link`, {}, "rosa")).json.token;
    assert.deepEqual(Object.keys((await call("GET", `/api/cobro/${tko}`)).json).sort(), PUBLIC_KEYS.filter((k) => k !== "hasLogo"), "misma lista cerrada en cuentas propias");
    await call("POST", `/api/cobro/${tko}/alerts`, { action: "on", subscription: { endpoint: FCM + "nina", keys: KEYS } });
    assert.deepEqual((await call("GET", "/api/me/link-alerts", null, "rosa")).json.own, [sale.id]);
    assert.equal((await call("POST", `/api/me/own/sales/${sale.id}/link/revoke`, {}, "rosa")).status, 200);
    assert.ok(!tsubs().some((x) => x.token === tko), "se borró al cambiar el link de la cuenta propia");
    const tko2 = (await call("POST", `/api/me/own/sales/${sale.id}/link`, {}, "rosa")).json.token;
    await call("POST", `/api/cobro/${tko2}/alerts`, { action: "on", subscription: { endpoint: FCM + "nina", keys: KEYS } });
    assert.equal((await call("POST", `/api/me/own/sales/${sale.id}/release`, {}, "rosa")).status, 200);
    assert.ok(!tsubs().some((x) => x.token === tko2), "se borró al liberar el cupo");
    assert.equal((await call("POST", `/api/cobro/${tko2}/alerts`, { action: "check", endpoint: FCM + "nina" })).status, 404, "el link ya no sirve para nada");
  });

  test("en el navegador a 360 px: botón en el link de cobro, en Mis cuentas y la marca del revendedor", { skip: !chromium && "Playwright no está instalado" }, async () => {
    const sub = (await call("POST", `/api/me/subs/${aidRosa}`, { name: "Sofía Vargas", phone: "75550000", label: "Hija", expiresAt: exp(20), price: 1500 }, "rosa")).json.sub;
    const tk = (await call("POST", `/api/me/subs/${aidRosa}/${sub.id}/link`, {}, "rosa")).json.token;
    await call("POST", `/api/cobro/${tk}/alerts`, { action: "on", subscription: { endpoint: FCM + "sofia", keys: KEYS } });
    assert.equal((await call("POST", "/api/me/push/subscribe", { subscription: { endpoint: EP.ana, keys: KEYS } }, "ana")).status, 200);
    const browser = await chromium.launch();
    try {
      for (const colorScheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, colorScheme });
        await ctx.route(/wa\.me|whatsapp\.com|googleapis|gstatic/, (route) => route.abort());
        const errors = [];
        // Link de cobro: la tarjeta con el botón.
        const pg = await ctx.newPage();
        pg.on("pageerror", (e) => errors.push(e.message));
        await pg.goto(`${base}/c/${tk}`);
        const btn = pg.getByRole("button", { name: "🔔 Avisarme antes de que venza" });
        await btn.waitFor();
        assert.ok((await btn.evaluate((el) => el.getBoundingClientRect().height)) >= 44, "botón de 44 px");
        assert.match(await pg.locator(".avisos").innerText(), /3 días antes, 1 día antes y el día que vence/);
        assert.ok(await pg.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde en /c/");
        assert.equal(await pg.locator('link[rel="manifest"]').getAttribute("href"), "/cobro.webmanifest");
        // Mis cuentas de la tienda (cliente con cuenta).
        const [name, value] = cookies.ana.split("=");
        await ctx.addCookies([{ name, value, url: base }]);
        const shop = await ctx.newPage();
        shop.on("pageerror", (e) => errors.push(e.message));
        await shop.goto(`${base}/tienda/#cuentas`);
        const card = shop.locator("#avisos");
        await card.waitFor();
        assert.match(await card.innerText(), /Avisarme antes de que venza/);
        const b2 = card.getByRole("button").first();
        assert.ok((await b2.evaluate((el) => el.getBoundingClientRect().height)) >= 44, "botón de 44 px en Mis cuentas");
        assert.ok(await shop.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde en Mis cuentas");
        // Revendedor: la marca en Repartir perfiles y el resumen.
        const [rn, rv] = cookies.rosa.split("=");
        await ctx.addCookies([{ name: rn, value: rv, url: base }]);
        const hub = await ctx.newPage();
        hub.on("pageerror", (e) => errors.push(e.message));
        await hub.goto(`${base}/hub#clientes`);
        const tab = hub.getByRole("tab", { name: /Repartir perfiles/ });
        if (await tab.count()) await tab.click();
        await hub.getByText(/de tus clientes reciben? avisos solos/).first().waitFor();
        await hub.getByRole("button", { name: /Sofía Vargas.*avisos automáticos activados/ }).waitFor();
        assert.ok(await hub.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde en Repartir perfiles");
        // El recordatorio por WhatsApp invita a activar los avisos en el link… si ese cliente todavía no los tiene.
        const remind = async (who) => {
          await hub.getByRole("button", { name: new RegExp(who) }).first().click();
          const href = await hub.getByRole("link", { name: /Recordar renovación/ }).first().getAttribute("href");
          await hub.getByRole("button", { name: new RegExp(who) }).first().click(); // cerrar
          return decodeURIComponent(href.split("text=")[1]);
        };
        const mm = await remind("Mario Rojas");
        assert.ok(mm.includes(`/c/${tk2}`) && mm.includes("«Avisarme antes de que venza»"), mm);
        assert.ok(!(await remind("Sofía Vargas")).includes("Avisarme antes de que venza"), "Sofía ya los tiene: no se lo repite");
        assert.deepEqual(errors, []);
        await ctx.close();
      }
    } finally { await browser.close(); }
  });

  test("límite por IP: muchos tokens inválidos seguidos terminan en 429", async () => {
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await call("GET", `/api/cobro/${"Z".repeat(36)}${String(i).padStart(4, "0")}/alerts`)).status;
    assert.equal(last, 429);
  });
});

describe("avisos solos: sin claves de push", () => {
  test("no se manda nada, no se ofrece el botón y activar avisa que falta configurar", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-avisos-off-"));
    const sent = [];
    const app = createApp({ dataDir: dir, jobs: false, log: () => {}, fetchImpl: async (u) => { sent.push(u); return new Response("", { status: 201 }); } });
    try {
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const s = app.store;
      s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
      s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 3400, published: true, resellersOnly: true });
      s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "andes", email: "x@x.lat", password: "Clave-Secreta#80", supplierExpiresAt: Date.now() + 90 * D, cost: 2111, profiles: [{ label: "Cuenta completa" }] });
      const r = s.catalog.createCustomer(owner, { name: "Rev", phone: "+59171111999", kind: "reseller" });
      const aid = s.orders.create(owner, { customerId: r.id, items: [{ productId: "dis-alq", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
      const sub = s.subs.save(asR(r), aid, { name: "Cli", expiresAt: Date.now() + D }).sub;
      const tk = s.subs.link(asR(r), aid, sub.id).token;
      assert.deepEqual(await (await fetch(`${base}/api/cobro/${tk}/alerts`)).json(), { configured: false, publicKey: null });
      const on = await fetch(`${base}/api/cobro/${tk}/alerts`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: "on", subscription: { endpoint: FCM + "x" } }) });
      assert.equal(on.status, 409);
      assert.equal(await app.checkExpiryPush(), null);
      assert.equal(sent.length, 0);
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
