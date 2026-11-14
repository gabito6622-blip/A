// Avisos al dueño por lo delicado que hace el equipo (revisión de seguridad del equipo, 14/11/2026):
// exportar clientes, ver más de 20 accesos o contraseñas en un día, o generar un PIN / link de revendedor.
// Como mucho 1 aviso por persona y tipo por hora. Push con fetch falso: no sale nada real.
// Y Atención (seller) no cambia el precio de un alquiler que ya figura como cobrado (el dueño y admin sí).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { generateVapidKeys } from "../dist/server/push.js";

const DAY = 86_400_000, MIN = 60_000;
const T0 = Date.UTC(2026, 10, 14, 15, 0); // 14/11 11:00 en Bolivia
const FCM = "https://fcm.googleapis.com/fcm/send/dueño-celular";

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "gs-equipoB-"));
  const clock = { t: T0, now() { return this.t; } };
  const sent = [];
  const fetchImpl = async (url) => { sent.push(String(url)); return new Response("", { status: 201 }); };
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock, fetchImpl, vapid: { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const call = async (method, p, body, ck) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const t = await r.text(); let json; try { json = JSON.parse(t); } catch { json = t; }
    return { status: r.status, json, ck: r.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = async (u, pw) => (await call("POST", "/api/auth/staff/login", { username: u, password: pw })).ck;
  const s = app.store, owner = { id: "t", role: "owner" };
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "netflix@x.lat", password: "Clave-Secreta#77", supplierExpiresAt: T0 + 90 * DAY, cost: 1111, profiles: [{ label: "P1" }, { label: "P2" }] });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Tienda", phone: "+59170000001" });
  const rosa = s.catalog.createCustomer(owner, { name: "Rosa Mamani", phone: "+59171111111", kind: "reseller" });
  const aid = s.orders.create(owner, { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
  const ock = await login("gabriel", "clave-del-dueño-123");
  await call("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "admin", password: "clave-de-lucia-123" }, ock);
  await call("POST", "/api/admin/staff", { username: "pedro", name: "Pedro", role: "seller", password: "clave-de-pedro-123" }, ock);
  // Solo el celular del dueño está suscripto a los avisos.
  assert.equal((await call("POST", "/api/admin/push/subscribe", { subscription: { endpoint: FCM, keys: { p256dh: "a", auth: "b" } }, label: "Celular" }, ock)).status, 200);
  const settle = () => new Promise((r) => setTimeout(r, 60));
  const latest = async () => (await call("GET", "/api/admin/push/latest", null, ock)).json;
  return { app, dir, base, clock, sent, call, login, ock, ana, rosa, aid, settle, latest, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("Avisos al dueño por lo que hace el equipo", () => {
  let t;
  before(async () => { t = await boot(); });
  after(() => t.stop());

  test("exportar clientes avisa una vez por hora por persona; el dueño no se avisa a sí mismo", async () => {
    const lck = await t.login("lucia", "clave-de-lucia-123");
    const n0 = t.sent.length;
    assert.equal((await t.call("GET", "/api/admin/export/clientes", null, lck)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0 + 1, "1 aviso al celular del dueño");
    assert.match((await t.latest()).title, /Lucía exportó datos de clientes/);
    assert.equal((await t.call("GET", "/api/admin/export/todo", null, lck)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0 + 1, "no repite dentro de la hora");
    t.clock.t += 61 * MIN;
    assert.equal((await t.call("GET", "/api/admin/export/servicios", null, lck)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0 + 2, "pasada la hora, vuelve a avisar");
    const before = t.sent.length;
    const ock = await t.login("gabriel", "clave-del-dueño-123");
    assert.equal((await t.call("GET", "/api/admin/export/clientes", null, ock)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, before, "lo que hace el dueño no le avisa");
    // El aviso queda también en la Auditoría (por si no tiene avisos activados).
    const aud = (await t.call("GET", `/api/admin/audit?action=team.alert`, null, ock)).json;
    assert.equal(aud.length, 2);
    assert.equal(aud[0].data.kind, "export");
  });

  test("generar un PIN o link de revendedor avisa; el de un cliente común no", async () => {
    const lck = await t.login("lucia", "clave-de-lucia-123");
    const n0 = t.sent.length;
    assert.equal((await t.call("POST", `/api/admin/customers/${t.ana.id}/login-pin`, {}, lck)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0, "PIN de un cliente común: sin aviso");
    assert.equal((await t.call("POST", `/api/admin/customers/${t.rosa.id}/login-pin`, {}, lck)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0 + 1);
    const l = await t.latest();
    assert.match(l.title, /Lucía generó un acceso de revendedor/);
    assert.match(l.body, /un PIN de acceso a Rosa Mamani/);
    assert.equal((await t.call("POST", `/api/admin/customers/${t.rosa.id}/login-link`, {}, lck)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0 + 1, "el link dentro de la misma hora no repite el aviso");
  });

  test("ver más de 20 accesos en un día avisa (al 21.º), no antes", async () => {
    const pck = await t.login("pedro", "clave-de-pedro-123");
    const n0 = t.sent.length;
    for (let i = 0; i < 20; i++) assert.equal((await t.call("GET", `/api/admin/assignments/${t.aid}/delivery`, null, pck)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0, "20 veces todavía es normal");
    await t.call("GET", `/api/admin/assignments/${t.aid}/delivery`, null, pck);
    await t.settle();
    assert.equal(t.sent.length, n0 + 1);
    assert.match((await t.latest()).title, /Pedro vio 21 accesos hoy/);
    for (let i = 0; i < 5; i++) await t.call("GET", `/api/admin/assignments/${t.aid}/delivery`, null, pck);
    await t.settle();
    assert.equal(t.sent.length, n0 + 1, "como mucho 1 por hora");
  });

  test("ver todas las contraseñas de golpe cuenta como muchas", async () => {
    const lck = await t.login("lucia", "clave-de-lucia-123");
    const n0 = t.sent.length;
    // Una sola cuenta cargada: «ver contraseñas» suma 1; con 21 cuentas, ya avisaría de una.
    assert.equal((await t.call("GET", "/api/admin/accounts?secrets=1", null, lck)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0);
    const owner = { id: "t", role: "owner" };
    for (let i = 0; i < 21; i++) t.app.store.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: `extra${i}@x.lat`, password: "Clave-Secreta#77", supplierExpiresAt: T0 + 90 * DAY, cost: 1111, profiles: [{ label: "P1" }] });
    assert.equal((await t.call("GET", "/api/admin/accounts?secrets=1", null, lck)).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0 + 1);
    assert.match((await t.latest()).title, /Lucía vio \d+ accesos hoy/);
  });
});

describe("Atención no cambia el precio de un alquiler ya cobrado", () => {
  let t;
  before(async () => { t = await boot(); });
  after(() => t.stop());

  test("Atención: 403 con mensaje claro si ya figura como pagado; antes de cobrar, sí puede", async () => {
    const pck = await t.login("pedro", "clave-de-pedro-123");
    const ctl = (body, ck) => t.call("POST", `/api/admin/assignments/${t.aid}/control`, body, ck);
    assert.equal((await ctl({ price: 3000 }, pck)).status, 200, "sin cobrar todavía: Atención ajusta el precio");
    assert.equal((await ctl({ payStatus: "pagado" }, pck)).status, 200);
    const r = await ctl({ price: 1000 }, pck);
    assert.equal(r.status, 403);
    assert.match(r.json.message, /ya figura como cobrado: el precio lo cambia el dueño o un admin/);
    assert.equal(t.app.store.engine.s.assignments[t.aid].control.price, 3000, "el precio no se tocó");
    assert.equal((await ctl({ price: 3000, note: "mismo precio" }, pck)).status, 200, "mandar el mismo precio (sin cambiarlo) no se frena");
    assert.equal((await ctl({ note: "pagó en efectivo" }, pck)).status, 200, "las notas siguen libres");
  });

  test("el dueño y un admin sí lo cambian, y queda en la Auditoría con el precio anterior", async () => {
    const lck = await t.login("lucia", "clave-de-lucia-123");
    const ctl = (body, ck) => t.call("POST", `/api/admin/assignments/${t.aid}/control`, body, ck);
    assert.equal((await ctl({ price: 2500 }, lck)).status, 200);
    assert.equal((await ctl({ price: 2800 }, t.ock)).status, 200);
    assert.equal(t.app.store.engine.s.assignments[t.aid].control.price, 2800);
    const aud = (await t.call("GET", "/api/admin/audit?action=assignment.control", null, t.ock)).json;
    assert.deepEqual({ price: aud[0].data.price, priceFrom: aud[0].data.priceFrom }, { price: 2800, priceFrom: 2500 });
  });
});

// El asistente trabaja a pedido del dueño (decisión del 14/11/2026: «como un admin»): lo que hace queda en la
// Auditoría, pero no le llena el celular de avisos.
test("el asistente exporta y da PIN sin mandar avisos al celular, pero queda en la Auditoría", async () => {
  const t = await boot();
  try {
    const key = (await t.call("POST", "/api/admin/assistant", {}, t.ock)).json.token;
    const asis = (url, method = "GET") => fetch(t.base + url, { method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json" }, ...(method === "POST" ? { body: "{}" } : {}) });
    const n0 = t.sent.length;
    assert.equal((await asis("/api/admin/export/clientes")).status, 200);
    assert.equal((await asis(`/api/admin/customers/${t.rosa.id}/login-pin`, "POST")).status, 200);
    await t.settle();
    assert.equal(t.sent.length, n0, "ningún aviso al celular");
    const aud = (await t.call("GET", "/api/admin/audit", null, t.ock)).json;
    const list = Array.isArray(aud) ? aud : aud.list ?? aud.events ?? [];
    assert.ok(list.some((a) => a.action === "team.alert"), "queda anotado en la Auditoría");
  } finally { await t.stop(); }
});
