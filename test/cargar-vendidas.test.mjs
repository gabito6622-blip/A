// "📋 Cargar sus cuentas": el dueño pega la lista de cuentas que ya le vendió a un revendedor
// (por WhatsApp) y quedan anotadas sin cobrar, sin avisos y sin revelar de quién es una cuenta ajena.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

const T0 = Date.UTC(2026, 10, 11, 15); // 11/11/2026, 11:00 en Bolivia
const owner = { id: "u_owner", role: "owner" };
const admin = { id: "u_admin", role: "admin" };
const seller = { id: "u_seller", role: "seller" };
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));
/** 23:59 de Bolivia de ese día. */
const day = (y, m, d) => Date.UTC(y, m - 1, d, 23, 59) + 4 * 3_600_000;

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Prov", active: true });
  s.catalog.upsertProduct(owner, { id: "disney-espn-alq", name: "Disney + ESPN", kind: "full_account", durationDays: 30, price: 7000, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "flujo", name: "Flujo TV", kind: "iptv", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3000, published: true });
  const acc = (productId, email, profiles = [{ label: "Cuenta completa" }]) => s.inventory.addAccount(owner, { productId, supplierId: "prov", email, password: "Clave-Larga#1", supplierExpiresAt: T0 + 120 * DAY, cost: 1000, profiles }).account;
  for (let i = 0; i < 8; i++) acc("disney-espn-alq", `de${i}@x.lat`);
  acc("flujo", "Flujo-Juan99", [{ label: "Línea IPTV" }]);
  acc("flujo", "flujo-ana", [{ label: "Línea IPTV" }]);
  acc("netflix", "nf1@x.lat", [1, 2, 3, 4].map((n) => ({ label: `Perfil ${n}` })));
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { "disney-espn-alq": 6500, flujo: 2000, netflix: 2500 } });
  s.catalog.upsertPriceGroup(owner, { id: "lp-usd", name: "Panamá y Paraguay (US$)", currency: "USD", prices: { "disney-espn-alq": 700, flujo: 300 } });
  s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: 9.85 } });
  const bo = s.catalog.createCustomer(owner, { name: "Beto Bolivia", phone: "+59171234567", kind: "reseller", priceGroupId: "revendedor" });
  const rita = s.catalog.createCustomer(owner, { name: "Rita Otra", phone: "+59171239999", kind: "reseller", priceGroupId: "revendedor" });
  const py = s.catalog.createCustomer(owner, { name: "Pedro Paraguay", phone: "+595981123456", kind: "reseller", priceGroupId: "lp-usd" });
  const carla = s.catalog.createCustomer(owner, { name: "Carla Cliente", phone: "+59170000001" });
  const as = (c) => ({ id: "u_" + c.id, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id });
  return { s, clock, bo, rita, py, carla, as };
}

/** Nunca dos servicios activos sobre el mismo perfil, y cada perfil asignado tiene su servicio. */
function assertNoDoubleSlots(s) {
  const st = s.engine.s, bySlot = new Map();
  for (const a of Object.values(st.assignments)) if (a.status === "active") {
    assert.ok(!bySlot.has(a.slotId), `perfil ${a.slotId} asignado dos veces`);
    bySlot.set(a.slotId, a.id);
    assert.equal(st.slots[a.slotId].status, "assigned");
  }
}

const LIST = [
  "DE0@X.lat 15/12 25",        // mayúsculas, fecha y precio
  "   de1@x.lat   ",           // espacios, sin fecha
  "de4@x.lat 20/12",           // de otro cliente (Rita)
  "nadie@x.lat",               // no existe
  "de2@x.lat 31/02",           // fecha inválida
  "de3@x.lat;10/01/2027;Bs 30", // punto y coma, año y "Bs 30"
  "flujo-JUAN99|20/12|25,50",  // usuario IPTV, barras y "25,50"
  "de0@x.lat",                 // repetida
  "nf1@x.lat\t18/12\t15",      // perfiles: toma uno libre
  "de5@x.lat,05/12,20",        // comas
].join("\n");

describe("Cargar sus cuentas (núcleo)", () => {
  test("vista previa: libre, ya suya, de otro, no existe, fecha mala, mayúsculas/espacios, con y sin fecha, con precio", () => {
    const { s, bo, rita } = setup();
    s.bulk.apply(owner, rita.id, "de4@x.lat");
    const before = JSON.stringify(s.engine.s);
    const p = s.bulk.preview(owner, bo.id, LIST);
    assert.equal(JSON.stringify(s.engine.s), before, "la vista previa no guarda nada");
    const by = Object.fromEntries(p.rows.map((r) => [r.line, r]));
    assert.deepEqual([p.ok, p.skipped, p.currency, p.name], [6, 4, "BOB", "Beto Bolivia"]);

    assert.equal(by[1].email, "de0@x.lat");
    assert.deepEqual([by[1].ok, by[1].status, by[1].product, by[1].profile, by[1].expiresAt, by[1].price], [true, "nueva", "Disney + ESPN", "Cuenta completa", day(2026, 12, 15), 2500]);
    assert.deepEqual([by[2].ok, by[2].email, by[2].expiresAt, by[2].defaultDate, by[2].price], [true, "de1@x.lat", T0 + 30 * DAY, true, undefined], "sin fecha: duración del producto desde hoy");
    assert.deepEqual([by[3].ok, by[3].status, by[3].reason], [false, "de_otro", "Es de otro cliente"]);
    assert.deepEqual([by[4].ok, by[4].status], [false, "no_existe"]);
    assert.match(by[4].reason, /No existe/);
    assert.deepEqual([by[5].ok, by[5].status], [false, "fecha_mala"]);
    assert.match(by[5].reason, /dd\/mm/);
    assert.deepEqual([by[6].ok, by[6].expiresAt, by[6].price], [true, day(2027, 1, 10), 3000]);
    assert.deepEqual([by[7].ok, by[7].product, by[7].profile, by[7].price], [true, "Flujo TV", "Línea IPTV", 2550]);
    assert.deepEqual([by[8].ok, by[8].status], [false, "repetida"]);
    assert.deepEqual([by[9].ok, by[9].product, by[9].profile, by[9].price], [true, "Netflix perfil", "Perfil 1", 1500]);
    assert.deepEqual([by[10].ok, by[10].expiresAt, by[10].price], [true, day(2026, 12, 5), 2000]);

    // No revela de quién es la cuenta ajena: ni nombre, ni teléfono, ni id.
    const json = JSON.stringify(p);
    for (const leak of [rita.id, "Rita", "71239999"]) assert.ok(!json.includes(leak), `la vista previa no dice ${leak}`);

    // Ya suya: se puede pegar dos veces.
    s.bulk.apply(owner, bo.id, "de6@x.lat 01/12");
    const again = s.bulk.preview(owner, bo.id, "DE6@x.lat 09/12 10");
    assert.deepEqual([again.rows[0].ok, again.rows[0].status, again.rows[0].expiresAt], [false, "ya_suya", day(2026, 12, 1)]);
  });

  test("datos raros: dos fechas, palabra suelta, lista vacía, demasiadas líneas, dada de baja, sin perfiles libres", () => {
    const { s, bo } = setup();
    const rows = s.bulk.preview(owner, bo.id, "de0@x.lat 10/12 11/12\nde1@x.lat hola\nde2@x.lat 32/12\nde3@x.lat 5/13").rows;
    assert.deepEqual(rows.map((r) => r.status), ["dato_malo", "dato_malo", "fecha_mala", "fecha_mala"]);
    assert.throws(() => s.bulk.preview(owner, bo.id, "  \n \n"), err("VALIDATION", /al menos una/));
    assert.throws(() => s.bulk.preview(owner, bo.id, Array.from({ length: 501 }, (_, i) => `x${i}@x.lat`).join("\n")), err("VALIDATION", /500/));
    const acc = Object.values(s.engine.s.accounts).find((a) => a.email === "de7@x.lat");
    const slot = Object.values(s.engine.s.slots).find((x) => x.accountId === acc.id);
    s.inventory.setSlotStatus(owner, slot.id, "quarantined");
    assert.equal(s.bulk.preview(owner, bo.id, "de7@x.lat").rows[0].status, "sin_lugar");
  });

  test("aplicar: crea las asignaciones sin cobrar, canal import, sin avisos; pegar dos veces no duplica", () => {
    const { s, bo, rita } = setup();
    s.bulk.apply(owner, rita.id, "de4@x.lat");
    s.wallet.adjust(owner, bo.id, 5000, "saldo de prueba");
    const st = s.engine.s;
    const bal0 = s.wallet.balance(bo.id), ledger0 = st.ledger.length, outbox0 = JSON.stringify(st.outbox);
    // Finanzas: lo que entró y la ganancia de cada mes no cambian (Bs 0: no es plata que entró).
    const money = () => { const f = s.finance.report(owner); return JSON.stringify({ months: f.months, ingresos: f.current.ingresos, ganancia: f.current.ganancia, apps: f.topApps.reduce((t, x) => t + x.ingresos, 0) }); };
    const fin0 = money();
    const asg0 = Object.keys(st.assignments).length;

    const r = s.bulk.apply(owner, bo.id, LIST);
    assert.equal(r.added, 6);
    assert.deepEqual(r.skipped.map((x) => [x.line, x.status]), [[3, "de_otro"], [4, "no_existe"], [5, "fecha_mala"], [8, "repetida"]]);
    assert.equal(Object.keys(st.assignments).length, asg0 + 6);
    for (const id of r.assignmentIds) {
      const a = st.assignments[id], o = st.orders[a.orderId];
      assert.equal(a.customerId, bo.id);
      assert.equal(a.status, "active");
      assert.deepEqual([o.channel, o.total, o.status, o.payerId], ["import", 0, "fulfilled", bo.id]);
      assert.equal(o.items[0].unitPrice, 0);
    }
    const de0 = Object.values(st.assignments).find((a) => a.customerId === bo.id && st.accounts[st.slots[a.slotId].accountId].email === "de0@x.lat");
    assert.equal(de0.customerExpiresAt, day(2026, 12, 15));
    assert.equal(de0.control.price, 2500, "el precio acordado queda en el Control");
    const de1 = Object.values(st.assignments).find((a) => a.customerId === bo.id && st.accounts[st.slots[a.slotId].accountId].email === "de1@x.lat");
    assert.equal(de1.control, undefined, "sin precio no inventa uno");

    assert.equal(s.wallet.balance(bo.id), bal0, "no toca el saldo");
    assert.equal(st.ledger.length, ledger0, "ni un movimiento de saldo");
    assert.equal(JSON.stringify(st.outbox), outbox0, "no encola ningún aviso ni WhatsApp");
    assert.equal(money(), fin0, "Finanzas igual");
    assertNoDoubleSlots(s);

    // Auditoría: solo ids y cantidades.
    const ev = st.audit.at(-1);
    assert.equal(ev.action, "assignment.bulk_load");
    assert.equal(ev.entityId, bo.id);
    assert.deepEqual([ev.data.added, ev.data.skipped], [6, 4]);
    assert.ok(!JSON.stringify(ev).includes("@"), "sin correos en la auditoría");

    // Pegar dos veces: no duplica nada.
    const r2 = s.bulk.apply(owner, bo.id, LIST);
    assert.equal(r2.added, 0);
    assert.equal(r2.skipped.filter((x) => x.status === "ya_suya").length, 6);
    assert.equal(Object.keys(st.assignments).length, asg0 + 6);
    assert.equal(JSON.stringify(st.outbox), outbox0);
    assertNoDoubleSlots(s);
  });

  test("perfiles: cada revendedor toma un perfil libre distinto; nunca el mismo dos veces", () => {
    const { s, bo, rita, py } = setup();
    s.bulk.apply(owner, bo.id, "nf1@x.lat");
    s.bulk.apply(owner, rita.id, "nf1@x.lat");
    s.bulk.apply(owner, py.id, "nf1@x.lat");
    const st = s.engine.s;
    const labels = Object.values(st.assignments).filter((a) => a.status === "active").map((a) => st.slots[a.slotId].label).sort();
    assert.deepEqual(labels, ["Perfil 1", "Perfil 2", "Perfil 3"]);
    assert.equal(s.bulk.preview(owner, rita.id, "nf1@x.lat").rows[0].status, "ya_suya");
    const carlaRes = s.catalog.createCustomer(owner, { name: "Otro Rev", phone: "+59170000077", kind: "reseller" });
    s.bulk.apply(owner, carlaRes.id, "nf1@x.lat");
    const full = s.bulk.preview(owner, s.catalog.createCustomer(owner, { name: "Quinto", phone: "+59170000078", kind: "reseller" }).id, "nf1@x.lat").rows[0];
    assert.deepEqual([full.status, full.reason], ["de_otro", "Es de otro cliente"], "los 4 perfiles ocupados");
    assertNoDoubleSlots(s);
  });

  test("ya suya también si la cuenta está a nombre de un cliente de ese revendedor", () => {
    const { s, bo, as } = setup();
    const cli = s.catalog.createCustomer(as(bo), { name: "Cliente de Beto", phone: "+59171230000" });
    const acc = Object.values(s.engine.s.accounts).find((a) => a.email === "de2@x.lat");
    const slot = Object.values(s.engine.s.slots).find((x) => x.accountId === acc.id);
    s.orders.create(owner, { customerId: cli.id, items: [{ productId: "disney-espn-alq", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slot.id] });
    const row = s.bulk.preview(owner, bo.id, "de2@x.lat").rows[0];
    assert.equal(row.status, "ya_suya");
  });

  test("revendedor en lista en dólares: carga igual, no toca su saldo y el precio va a «Te paga US$» (priceUsd)", () => {
    const { s, py } = setup();
    s.wallet.adjust(owner, py.id, 1500, "saldo US$ de prueba");
    const st = s.engine.s;
    const bal0 = s.wallet.balance(py.id), ledger0 = st.ledger.length, outbox0 = JSON.stringify(st.outbox);
    const p = s.bulk.preview(owner, py.id, "de0@x.lat 15/12 10\nflujo-ana 20/12");
    assert.equal(p.currency, "USD");
    assert.equal(p.ok, 2);
    assert.match(p.rows[0].warnings.join(" "), /US\$/);
    const r = s.bulk.apply(owner, py.id, "de0@x.lat 15/12 10\nflujo-ana 20/12");
    assert.equal(r.added, 2);
    const a = st.assignments[r.assignmentIds[0]];
    assert.equal(a.control.price, undefined, "no mezcla US$ con Bs en el precio del Control");
    assert.equal(a.control.priceUsd, 1000, "el acordado queda en US$ en su campo del Control");
    assert.equal(s.wallet.balance(py.id), bal0);
    assert.equal(st.ledger.length, ledger0);
    assert.equal(JSON.stringify(st.outbox), outbox0);
  });

  test("permisos: dueño y admin sí; Atención, revendedor y cliente no. Solo para revendedores", () => {
    const { s, bo, rita, carla, as } = setup();
    assert.equal(s.bulk.preview(admin, bo.id, "de0@x.lat").ok, 1);
    assert.equal(s.bulk.apply(admin, bo.id, "de0@x.lat").added, 1);
    for (const who of [seller, as(rita), as(bo), as(carla)]) {
      assert.throws(() => s.bulk.preview(who, bo.id, "de1@x.lat"), err("FORBIDDEN"));
      assert.throws(() => s.bulk.apply(who, bo.id, "de1@x.lat"), err("FORBIDDEN"));
    }
    assert.throws(() => s.bulk.apply(owner, carla.id, "de1@x.lat"), err("VALIDATION", /solo para revendedores/));
    assert.throws(() => s.bulk.apply(owner, "cus_nope", "de1@x.lat"), err("NOT_FOUND"));
  });

  test("una fecha ya vencida queda abierta (como el importador) y avisa", () => {
    const { s, bo } = setup();
    const p = s.bulk.preview(owner, bo.id, "de0@x.lat 01/11");
    assert.match(p.rows[0].warnings.join(" "), /Ya venció/);
    const r = s.bulk.apply(owner, bo.id, "de0@x.lat 01/11");
    assert.equal(s.engine.s.assignments[r.assignmentIds[0]].holdOpen, true);
  });
});

async function serve() {
  const dir = mkdtempSync(join(tmpdir(), "gs-cargar-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const port = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  const call = (m, p, ck, b) => fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const staff = async (u, pw) => (await call("POST", "/api/auth/staff/login", "", { username: u, password: pw })).headers.get("set-cookie").split(";")[0];
  const pinLogin = async (phone, pin) => { const r = await call("POST", "/api/auth/customer/pin", "", { phone, pin }); assert.equal(r.status, 200, await r.clone().text()); return r.headers.get("set-cookie").split(";")[0]; };
  const ownerId = Object.values(app.store.engine.s.staff)[0].id;
  const O = { id: ownerId, role: "owner" };
  const st = app.store;
  st.catalog.upsertSupplier(O, { id: "prov", name: "Prov", active: true });
  st.catalog.upsertProduct(O, { id: "disney-espn-alq", name: "Disney + ESPN", kind: "full_account", durationDays: 30, price: 7000, published: true, resellersOnly: true });
  st.catalog.upsertProduct(O, { id: "flujo", name: "Flujo TV", kind: "iptv", durationDays: 30, price: 2500, published: true });
  for (let i = 0; i < 6; i++) st.inventory.addAccount(O, { productId: "disney-espn-alq", supplierId: "prov", email: `de${i}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 120 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
  st.inventory.addAccount(O, { productId: "flujo", supplierId: "prov", email: "flujo-ana", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 120 * DAY, cost: 1000, profiles: [{ label: "Línea IPTV" }] });
  return { app, base, call, staff, pinLogin, O, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("Cargar sus cuentas: HTTP", () => {
  test("permisos por rol, no cobra, no avisa y no revela de quién es una cuenta ajena", async () => {
    const h = await serve();
    try {
      const ck = await h.staff("gabriel", "clave-del-dueño-123");
      const j = async (r) => ({ status: r.status, body: await r.json() });
      const mk = async (body) => (await j(await h.call("POST", "/api/admin/customers", ck, body))).body;
      const bo = await mk({ name: "Beto Bolivia", phone: "+59171234567", kind: "reseller" });
      const rita = await mk({ name: "Rita Otra", phone: "+59171239999", kind: "reseller" });
      const carla = await mk({ name: "Carla Cliente", phone: "+59170000001" });
      await h.call("POST", "/api/admin/staff", ck, { username: "ana", name: "Ana", role: "admin", password: "clave-de-ana-123" });
      await h.call("POST", "/api/admin/staff", ck, { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
      const ckAdmin = await h.staff("ana", "clave-de-ana-123"), ckSeller = await h.staff("lucia", "clave-de-lucia-123");
      await h.call("POST", `/api/admin/customers/${rita.id}/login-pin`, ck, { pin: "2468" });
      await h.call("POST", `/api/admin/customers/${carla.id}/login-pin`, ck, { pin: "1357" });
      const ckRita = await h.pinLogin("+59171239999", "2468"), ckCarla = await h.pinLogin("+59170000001", "1357");

      const P = `/api/admin/customers/${bo.id}/bulk-assign`;
      // Rita ya tiene de4 (cargada por el dueño).
      assert.equal((await j(await h.call("POST", `/api/admin/customers/${rita.id}/bulk-assign`, ck, { text: "de4@x.lat" }))).body.added, 1);
      const outbox0 = JSON.stringify(h.app.store.engine.s.outbox), ledger0 = h.app.store.engine.s.ledger.length;

      const pv = await j(await h.call("POST", P + "/preview", ck, { text: "de0@x.lat 15/12 25\nde4@x.lat\nFLUJO-ANA" }));
      assert.equal(pv.status, 200);
      assert.deepEqual(pv.body.rows.map((r) => r.status), ["nueva", "de_otro", "nueva"]);
      const raw = JSON.stringify(pv.body);
      for (const leak of [rita.id, "Rita", "71239999"]) assert.ok(!raw.includes(leak), `no revela ${leak}`);

      for (const [who, c] of [["Atención", ckSeller], ["revendedor", ckRita], ["cliente", ckCarla]]) {
        assert.equal((await h.call("POST", P + "/preview", c, { text: "de1@x.lat" })).status, 403, `${who}: vista previa 403`);
        assert.equal((await h.call("POST", P, c, { text: "de1@x.lat" })).status, 403, `${who}: guardar 403`);
      }
      assert.equal((await h.call("POST", P, "", { text: "de1@x.lat" })).status, 401, "sin sesión: 401");
      assert.equal((await h.call("POST", `/api/admin/customers/${carla.id}/bulk-assign`, ck, { text: "de1@x.lat" })).status, 400, "solo revendedores");

      const ap = await j(await h.call("POST", P, ckAdmin, { text: "de0@x.lat 15/12 25\nde4@x.lat\nFLUJO-ANA" }));
      assert.equal(ap.status, 200);
      assert.equal(ap.body.added, 2);
      assert.deepEqual(ap.body.skipped.map((x) => [x.line, x.reason]), [[2, "Es de otro cliente"]]);
      assert.ok(!JSON.stringify(ap.body).includes(rita.id));
      assert.equal(JSON.stringify(h.app.store.engine.s.outbox), outbox0, "sin avisos");
      assert.equal(h.app.store.engine.s.ledger.length, ledger0, "sin cobros");

      // Aparecen en la ficha del revendedor; pegar otra vez no duplica.
      const sheet = (await j(await h.call("GET", `/api/admin/resellers/${bo.id}/sheet`, ck))).body;
      assert.deepEqual(sheet.rows.map((r) => r.email).sort(), ["de0@x.lat", "flujo-ana"]);
      assert.equal((await j(await h.call("POST", P, ck, { text: "de0@x.lat\nflujo-ana" }))).body.added, 0);
      assert.equal((await j(await h.call("GET", `/api/admin/resellers/${bo.id}/sheet`, ck))).body.rows.length, 2);
      // Rita (revendedora) no ve nada de Beto en su portal.
      const mine = await (await h.call("GET", "/api/me/services", ckRita)).json();
      assert.ok(!JSON.stringify(mine).includes("de0@x.lat"));
    } finally { await h.stop(); }
  });
});

test("Navegador 360 px: ficha → Cargar sus cuentas → vista previa → Guardar", { skip: !chromium && "Playwright no está instalado" }, async () => {
  const h = await serve();
  const browser = await chromium.launch();
  try {
    const ck = await h.staff("gabriel", "clave-del-dueño-123");
    const bo = await (await h.call("POST", "/api/admin/customers", ck, { name: "Beto Bolivia", phone: "+59171234567", kind: "reseller" })).json();
    const rita = await (await h.call("POST", "/api/admin/customers", ck, { name: "Rita Otra", phone: "+59171239999", kind: "reseller" })).json();
    await h.call("POST", `/api/admin/customers/${rita.id}/bulk-assign`, ck, { text: "de4@x.lat" });
    const outbox0 = JSON.stringify(h.app.store.engine.s.outbox);
    const errors = [];
    for (const theme of ["light", "dark"]) {
      const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true });
      const [name, value] = ck.split("=");
      await ctx.addCookies([{ name, value, url: h.base }]);
      await ctx.addInitScript((t) => { try { localStorage.setItem("gs-panel-theme", t); } catch { /* */ } }, theme);
      await ctx.route(/wa\.me|whatsapp\.com/, (route) => route.abort());
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errors.push(e.message));
      page.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });
      await page.goto(h.base + "/panel.html#revendedores");
      await page.locator(`button[data-rficha="${bo.id}"]`).first().click();
      await page.locator(".rficha").waitFor();
      await page.getByRole("button", { name: /Cargar sus cuentas/ }).click();
      const ta = page.getByLabel(/Lista de Beto/);
      await ta.waitFor();
      // Sin texto: el error va junto al campo, sin alert().
      await page.getByRole("button", { name: /Ver cómo queda/ }).click();
      assert.match(await page.locator("#cgErr").innerText(), /al menos una/);
      const text = theme === "light" ? "de0@x.lat 15/12 25\nde4@x.lat\nnadie@x.lat\nflujo-ana" : "de1@x.lat";
      await page.getByLabel(/Lista de Beto/).fill(text);
      await page.getByRole("button", { name: /Ver cómo queda/ }).click();
      await page.locator(".cg-table").waitFor();
      if (theme === "light") {
        const body = await page.locator(".cg-table").innerText();
        assert.match(body, /Es de otro cliente/);
        assert.match(body, /No existe/);
        assert.match(body, /15\/12/, "fecha dd/mm");
        assert.ok(!/Rita/.test(await page.locator("#cgBox").innerText()), "no dice de quién es");
      }
      // Celular: sin desborde, botones de 44 px y texto de 12 px o más.
      const m = await page.evaluate(() => {
        const box = document.getElementById("cgBox");
        const small = [...box.querySelectorAll("*")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => el.tagName + "." + el.className);
        const btns = [...box.querySelectorAll("button")].map((b) => b.getBoundingClientRect().height);
        return { sw: document.documentElement.scrollWidth, bw: box.getBoundingClientRect().right, small, btns };
      });
      assert.ok(m.sw <= 360, `sin desborde horizontal (${m.sw})`);
      assert.ok(m.bw <= 360, `el cuadro entra en 360 px (${m.bw})`);
      assert.deepEqual(m.small, [], "texto de 12 px o más");
      assert.ok(m.btns.every((x) => x >= 44), `botones de 44 px (${m.btns})`);
      const n = theme === "light" ? 2 : 1;
      await page.getByRole("button", { name: new RegExp(`Guardar ${n} cuenta`) }).click();
      await page.locator(".cg-done").waitFor();
      assert.match(await page.locator(".cg-done").innerText(), new RegExp(`${n} cuenta`));
      await page.locator(".racc").first().waitFor();
      await ctx.close();
    }
    const sheet = await (await h.call("GET", `/api/admin/resellers/${bo.id}/sheet`, ck)).json();
    assert.deepEqual(sheet.rows.map((r) => r.email).sort(), ["de0@x.lat", "de1@x.lat", "flujo-ana"]);
    assert.equal(JSON.stringify(h.app.store.engine.s.outbox), outbox0, "no salió ningún aviso");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await h.stop(); }
});
