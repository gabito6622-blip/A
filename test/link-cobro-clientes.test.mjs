// Link de cobro para clientes REGISTRADOS del revendedor + recordatorio matutino «Tu día» (13/11/2026).
// Datos ficticios; reloj controlado; los avisos al celular van a un servidor falso. Nada real.
//  - Misma página /c/<token> y misma lista cerrada de campos que los perfiles repartidos: nada de la cuenta,
//    ni costos, ni teléfono del cliente, ni ids. Lo crea solo el revendedor del cliente; muere si el cliente
//    cambia de revendedor o se revoca; sobrevive a un reinicio (índice por estado).
//  - Mi control y Mi día traen el token para que el «Mensaje listo» lleve el link.
//  - Tito a las 9: un solo aviso «☀️ Tu día: 1 para cobrar · …» que abre /hub#dia; con plan Básico, el aviso de siempre.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";
import { generateVapidKeys } from "../dist/server/push.js";

const DAY = 864e5;
const owner = { id: "u_owner", role: "owner" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const NOW = Date.UTC(2026, 10, 13, 18); // 13/11 14:00 Bolivia
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

function world(clock = { t: NOW - 40 * DAY, now() { return this.t; } }, s = createStore({ clock })) {
  const at = (t) => { clock.t = t; };
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil (alquiler revendedores)", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
  s.inventory.addAccount(owner, { productId: "netflix", supplierId: "prov", email: "nf-secreto@x.lat", password: "Clave#Secreta1", supplierExpiresAt: NOW + 120 * DAY, cost: 2000, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }, { label: "Perfil 3" }] });
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "revendedor" }); s.wallet.adjust(owner, c.id, 100000, "demo"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Flores", "+59171000001"), otro = mk("Otro Revendedor", "+59171000002");
  s.shops.setupFor(owner, ana.c.id, { slug: "ana-tv", title: "Ana TV", whatsapp: "59171000001", enabled: true });
  const marisel = s.catalog.createCustomer(ana.A, { name: "Marisel Rojas", phone: "+59175000001", whatsappConsent: true });
  at(NOW - 32 * DAY); const o = s.orders.create(ana.A, { customerId: marisel.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" }); at(NOW);
  s.rtools.setControl(ana.A, o.assignmentIds[0], { price: 4000 });
  const directo = s.catalog.createCustomer(owner, { name: "Directo Tienda", phone: "+59175008888" });
  const oD = s.orders.create(owner, { customerId: directo.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
  return { s, clock, at, ana, otro, marisel, asg: o.assignmentIds[0], asgDirecto: oD.assignmentIds[0] };
}

describe("link de cobro de clientes registrados", () => {
  test("lo crea el revendedor del cliente; la página pública muestra lo mínimo; Mi control y Mi día traen el token", () => {
    const { s, ana, otro, marisel, asg, asgDirecto } = world();
    const { token, created } = s.rtools.clientLink(ana.A, asg);
    assert.ok(token.length >= 32); assert.equal(created, true);
    assert.deepEqual(s.rtools.clientLink(ana.A, asg), { token, created: false }, "pedirlo de nuevo devuelve el mismo");
    const v = s.subs.publicView(token);
    assert.deepEqual(v, { name: "Marisel", label: "", product: "Netflix perfil", expiresAt: NOW - 2 * DAY, price: 4000, pay: "pagado", seller: "Ana TV", sellerWhatsapp: "59171000001", hasQr: false, currency: "Bs", hasLogo: false, codes: "off" });
    const txt = JSON.stringify(v);
    for (const x of ["nf-secreto", "Clave#", "+59175000001", "75000001", "asg_", "cus_", "2500"]) assert.ok(!txt.includes(x), `la página muestra ${x}`);
    assert.equal(s.subs.publicQr(token), undefined, "sin QR cargado: nada, pero el token resuelve");
    assert.equal(s.subs.publicLogo(token), undefined);
    // Solo el revendedor del cliente.
    assert.throws(() => s.rtools.clientLink(otro.A, asg), err("FORBIDDEN"));
    assert.throws(() => s.rtools.clientLink(owner, asg), err("FORBIDDEN"));
    assert.throws(() => s.rtools.clientLink(ana.A, asgDirecto), err("FORBIDDEN"), "un cliente directo de la tienda no es suyo");
    // Mi control y Mi día lo traen.
    assert.equal(s.rtools.control(ana.A).find((r) => r.id === asg).linkToken, token);
    const d = s.rtools.day(ana.A);
    assert.equal(d.cobrar[0].items[0].linkToken, token);
    // Revocar: muere al instante; crear de nuevo da otro distinto.
    assert.deepEqual(s.rtools.revokeClientLink(ana.A, asg), { ok: true, revoked: true });
    assert.throws(() => s.subs.publicView(token), err("NOT_FOUND"));
    const t2 = s.rtools.clientLink(ana.A, asg).token;
    assert.notEqual(t2, token);
    // Si la tienda pasa el cliente a otro revendedor, el link del viejo muere (no se muestran datos a nombre de otro).
    s.engine.tx(() => { s.engine.s.customers[marisel.id].resellerId = otro.c.id; });
    assert.throws(() => s.subs.publicView(t2), err("NOT_FOUND"));
    s.engine.tx(() => { s.engine.s.customers[marisel.id].resellerId = ana.c.id; });
    assert.equal(s.subs.publicView(t2).name, "Marisel");
    // Sobrevive a un reinicio (el índice se arma desde el estado guardado).
    const s2 = createStore({ clock: { t: NOW, now() { return this.t; } }, initialState: s.snapshot() });
    assert.equal(s2.subs.publicView(t2).seller, "Ana TV");
    // Un link creado en una transacción que se deshace no queda vivo.
    let ghost = "";
    const w2 = world();
    assert.throws(() => w2.s.engine.tx(() => { ghost = w2.s.rtools.clientLink(w2.ana.A, w2.asg).token; throw new DomainError("VALIDATION", "x"); }));
    assert.throws(() => w2.s.subs.publicView(ghost), err("NOT_FOUND"));
  });

  test("recordatorio matutino: texto de «Tu día», con nombres, saldo y el link a /hub#dia; null si no hay nada", () => {
    const { s, ana, otro } = world();
    const p = s.rtools.dayPushText(ana.A);
    assert.equal(p.title, "☀️ Tu día: 1 para cobrar"); assert.match(p.body, /^Marisel\. Tocá para abrir Mi día\.$/); assert.equal(p.url, "/hub#dia");
    assert.equal(s.rtools.dayPushText(otro.A), null, "sin nada que hacer, sin aviso");
    s.wallet.adjust(owner, ana.c.id, -s.wallet.balance(ana.c.id), "vaciar");
    assert.match(s.rtools.dayPushText(ana.A).body, /Te falta saldo para renovarlos \(tenés 0, necesitás 25\)/);
  });
});

describe("link de cobro y recordatorio por la API", () => {
  let dir, app, base, ock, rck, w;
  const clock = { t: NOW, now() { return this.t; } };
  const vapid = { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" };
  const sent = [];
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const get = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, json: await r.json().catch(() => null) }; };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-clink-"));
    const fetchImpl = async (url) => { sent.push(String(url)); return new Response("", { status: 201 }); };
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock, vapid, fetchImpl });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    w = world(clock, app.store);
    clock.t = NOW;
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${w.ana.c.id}/login-pin`, {}, ock)).json();
    rck = (await post("/api/auth/customer/pin", { phone: w.ana.c.phone, pin })).headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("POST /api/me/control/:id/link → url /c/<token>; GET /api/cobro/<token> público con lo mínimo; revocar → 404; sin sesión 401", async () => {
    assert.equal((await post(`/api/me/control/${w.asg}/link`, {})).status, 401);
    const r = await (await post(`/api/me/control/${w.asg}/link`, {}, rck)).json();
    assert.match(r.url, /\/c\/[A-Za-z0-9_-]{32,}$/);
    const tk = r.url.split("/c/")[1];
    const v = (await get(`/api/cobro/${tk}`)).json;
    assert.equal(v.name, "Marisel"); assert.equal(v.price, 4000); assert.equal(v.seller, "Ana TV"); assert.equal(v.alerts, false);
    assert.ok(!JSON.stringify(v).includes("nf-secreto"));
    assert.equal((await get(`/api/cobro/${tk}/qr`)).status, 404, "sin QR cargado");
    assert.equal((await get("/api/me/control", rck)).json.find((x) => x.id === w.asg).linkToken, tk);
    await post(`/api/me/control/${w.asg}/link/revoke`, {}, rck);
    assert.equal((await get(`/api/cobro/${tk}`)).status, 404);
  });

  test("Tito a las 9: al revendedor le llega un solo aviso «☀️ Tu día…» que abre /hub#dia; con plan Básico, el de siempre", async () => {
    assert.equal((await post("/api/me/push/subscribe", { subscription: { endpoint: "https://fcm.googleapis.com/fcm/send/ana-cel", keys: KEYS } }, rck)).status, 200);
    await app.checkResellerPush();
    assert.equal(sent.filter((u) => u.includes("ana-cel")).length, 1, "un solo aviso");
    const m = (await get("/api/me/push/latest", rck)).json;
    assert.equal(m.title, "☀️ Tu día: 1 para cobrar"); assert.match(m.body, /Marisel/); assert.equal(m.url, "/hub#dia");
    // Mismo día: no repite.
    await app.checkResellerPush();
    assert.equal(sent.filter((u) => u.includes("ana-cel")).length, 1);
    // Plan Básico (sin Mi día): otro día, vuelve el aviso de «vence mañana» (acá no hay ninguno → nada).
    await post("/api/admin/settings", { shopRent: { enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", trialDays: 0, basicPrice: 2500 } }, ock);
    app.store.shops.setPlan(w.ana.A, w.ana.c.id, "basic");
    clock.t = NOW + DAY;
    await app.checkResellerPush();
    assert.equal(sent.filter((u) => u.includes("ana-cel")).length, 1, "en Básico no manda el resumen de Mi día (y acá no hay «vence mañana»)");
  });
});
