// 📈 Cómo van tus revendedores: números con reloj controlado (borde de mes en hora de Bolivia),
// estados, permisos por rol, privacidad del JSON y una revisión con navegador (si hay Playwright).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createStore } from "../dist/store/index.js";
import { overview, boMonthStart, trendOf } from "../dist/store/resellerStats.js";
import { createApp } from "../dist/server/app.js";

const DAY = 864e5, HOUR = 36e5, MIN = 6e4;
const OWNER = { id: "own", role: "owner" };
// Bolivia = UTC−4: el 1/11/2026 a las 00:00 en La Paz son las 04:00 UTC.
const NOV1 = Date.UTC(2026, 10, 1, 4);
const NOW = NOV1 + 9 * DAY + 12 * HOUR; // martes 10/11 al mediodía en Bolivia
const PRODUCTS = [
  ["disney-alq", "Disney + ESPN (alquiler revendedores)", 6900],
  ["disneyse-alq", "Disney sin ESPN (alquiler revendedores)", 3400],
  ["prime-alq", "Prime Video (alquiler revendedores)", 2000],
  ["hbo-alq", "HBO Max (alquiler revendedores)", 1500],
];

function world(start) {
  const clock = { t: start, now() { return this.t; } };
  const s = createStore({ clock });
  for (const [id, name, price] of PRODUCTS) s.catalog.upsertProduct(OWNER, { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(OWNER, { id: "revendedor", name: "Revendedor", prices: Object.fromEntries(PRODUCTS.map(([id, , p]) => [id, p])) });
  s.catalog.upsertSupplier(OWNER, { id: "prov", name: "Proveedor", contact: "x", active: true });
  let n = 0;
  for (const [id] of PRODUCTS) for (let i = 0; i < 12; i++) {
    s.inventory.addAccount(OWNER, { productId: id, supplierId: "prov", email: `cuenta${++n}@proveedor.test`, password: `Clave#Secreta${n}`, supplierExpiresAt: start + 500 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
  }
  let ph = 70000000;
  const at = (t) => { clock.t = t; };
  const reseller = (name, t) => { at(t); return s.catalog.createCustomer(OWNER, { name, phone: `+591${++ph}`, kind: "reseller", priceGroupId: "revendedor", whatsappConsent: true }); };
  const buy = (rid, productId, t) => { at(t); return s.orders.create(OWNER, { customerId: rid, items: [{ productId, qty: 1 }], paymentMethod: "cash" }).assignmentIds[0]; };
  const renew = (asgId, t, actor = OWNER, paymentMethod = "cash") => { at(t); return s.orders.renew(actor, asgId, { paymentMethod }); };
  const view = (t = NOW) => overview(s.engine, OWNER, t);
  return { s, clock, at, reseller, buy, renew, view };
}

describe("Cómo van: números", () => {
  test("mes de Bolivia, pagos sin contar doble la renovación, activos, caídos, vence en 7 días", () => {
    assert.equal(boMonthStart(NOW), NOV1);
    assert.equal(boMonthStart(NOV1 - 1), Date.UTC(2026, 9, 1, 4), "las 23:59 del 31/10 en Bolivia todavía son octubre");
    assert.equal(boMonthStart(NOW, -1), Date.UTC(2026, 9, 1, 4));

    const w = world(NOV1 - 120 * DAY);
    const ana = w.reseller("Ana Rojas", NOV1 - 100 * DAY);
    const AR = { id: "u_ana", role: "reseller", customerId: ana.id };
    const p1 = w.buy(ana.id, "prime-alq", NOV1 - 42 * DAY);         // 20/09 → vence 20/10, no lo renueva: se le cayó
    const h1 = w.buy(ana.id, "hbo-alq", NOV1 - 31 * DAY + 12 * HOUR); // 01/10 12:00 → vence 31/10 12:00
    const s1 = w.buy(ana.id, "disneyse-alq", NOV1 - 17 * DAY + 12 * HOUR); // 15/10 → vence 14/11 (en 7 días)
    const d1 = w.buy(ana.id, "disney-alq", NOV1 - MIN);             // 31/10 23:59 en Bolivia: mes anterior
    const p2 = w.buy(ana.id, "prime-alq", NOV1);                     // 01/11 00:00 en Bolivia: este mes
    // Recarga de saldo por QR (pedido "topup"): no es un pago por servicios, no se cuenta.
    w.at(NOV1 + DAY);
    const top = w.s.orders.requestTopup(AR, ana.id, 50000, { fileRef: "a.png", declaredReference: "OP-1" });
    w.s.orders.approvePayment(OWNER, top.id, { confirmedReference: "OP-1" });
    // Le vende a SU clienta con su saldo: lo paga Ana.
    w.at(NOV1 + DAY + HOUR);
    const cli = w.s.catalog.createCustomer(AR, { name: "Clienta Privada", phone: "+59169999999", email: "clienta@privado.test", whatsappConsent: true });
    const c1 = w.s.orders.create(AR, { customerId: cli.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" }).assignmentIds[0];
    w.renew(h1, NOV1 + 2 * DAY);                       // tarde: venció el 31/10
    w.renew(d1, NOV1 + 4 * DAY, AR, "balance");        // a tiempo, con saldo (pedido + movimiento de saldo)
    // El cuaderno de Ana (no lo tiene que ver el dueño acá).
    w.s.subs.save(AR, d1, { label: "Perfil 1", name: "Sobrina Secreta", phone: "+59168888888", expiresAt: NOW + 10 * DAY, pay: "pagado", price: 3000 });
    w.s.rtools.setControl(AR, c1, { price: 2500, payStatus: "pendiente", note: "nota privada de Ana" });

    const v = w.view();
    const r = v.list.find((x) => x.id === ana.id);
    assert.equal(r.thisMonth, 2000 + 1500 + 1500 + 6900, "prime 01/11 + hbo clienta + 2 renovaciones");
    assert.equal(r.prevMonth, 1500 + 3400 + 6900, "hbo 01/10 + disney sin ESPN 15/10 + disney 31/10 23:59");
    assert.equal(r.prevMonthToDate, 1500, "hasta el 10/10 a la misma hora solo el hbo del 01/10");
    assert.equal(r.change, 11900 - 1500);
    assert.equal(r.paid30, 3400 + 6900 + 2000 + 1500 + 1500 + 6900);
    assert.equal(r.prev30, 2000 + 1500);
    assert.equal(r.renewalsOnTime, 1);
    assert.equal(r.renewalsLate, 1);
    assert.equal(r.dropped, 1, "el prime del 20/09");
    assert.equal(r.droppedAmount, 2000);
    assert.deepEqual(r.due7, { count: 1, amount: 3400 });
    assert.equal(r.activeCount, 5);
    assert.deepEqual(r.active.map((a) => `${a.name} ×${a.count}`), ["HBO Max ×2", "Disney + ESPN ×1", "Disney sin ESPN ×1", "Prime Video ×1"]);
    assert.equal(r.lastOrderAt, NOV1 + 4 * DAY);
    assert.equal(r.status, "creciendo");
    assert.ok(p1 && s1 && p2);
    // Totales: un solo revendedor → concentración 100 %; proyección = lo que vence en 30 días a su precio.
    assert.equal(v.totals.thisMonth, 11900);
    assert.equal(v.totals.prevMonth, 11800);
    assert.deepEqual(v.totals.due7, { count: 1, amount: 3400 });
    assert.deepEqual(v.totals.projection30, { count: 4, amount: 3400 + 2000 + 1500 + 1500 }, "disneyse 14/11, prime 01/12, hbo 02/12 y 03/12; el disney vence 30/12");
    assert.equal(v.totals.concentration.pct, 100);

    // Sin contar doble: lo de Ana coincide con la suma de sus pedidos entregados (no con saldo + recargas).
    const st = w.s.engine.s;
    const ledgerRenew = st.ledger.filter((l) => l.customerId === ana.id && l.type === "renewal").reduce((t, l) => t - l.amount, 0);
    assert.equal(ledgerRenew, 6900, "la renovación con saldo dejó un movimiento…");
    assert.equal(Object.values(st.orders).filter((o) => o.kind === "renewal" && o.payerId === ana.id).length, 2, "…y un solo pedido por renovación");
    // La renovación nueva guarda el vencimiento anterior.
    const ren = Object.values(st.orders).find((o) => o.kind === "renewal" && o.renewal.assignmentId === h1);
    assert.equal(ren.renewal.prevExpiresAt, NOV1 - DAY + 12 * HOUR);
  });

  test("renovaciones viejas sin el dato nuevo: a tiempo o tarde se reconstruye desde el vencimiento", () => {
    const w = world(NOW - 120 * DAY);
    const r = w.reseller("Vieja Data", NOW - 100 * DAY);
    const a = w.buy(r.id, "prime-alq", NOW - 70 * DAY);   // vence NOW−40
    w.renew(a, NOW - 50 * DAY);                             // a tiempo → NOW−10
    w.renew(a, NOW - 5 * DAY);                              // tarde → NOW+25
    const b = w.buy(r.id, "hbo-alq", NOW - 40 * DAY);     // vence NOW−10
    w.renew(b, NOW - 20 * DAY);                             // a tiempo → NOW+20
    for (const o of Object.values(w.s.engine.s.orders)) if (o.renewal) delete o.renewal.prevExpiresAt; // como un pedido de antes
    const x = w.view().list[0];
    assert.equal(x.renewalsLate, 1);
    assert.equal(x.renewalsOnTime, 1, "solo las de los últimos 30 días");
  });

  test("concentración: los 3 primeros sobre lo que pagaron todos en 30 días", () => {
    const w = world(NOW - 120 * DAY);
    const plan = [["A", ["disney-alq", "disney-alq"]], ["B", ["disney-alq"]], ["C", ["disneyse-alq"]], ["D", ["prime-alq"]], ["E", ["hbo-alq"]]];
    for (const [name, prods] of plan) {
      const r = w.reseller(name, NOW - 90 * DAY);
      prods.forEach((p, i) => w.buy(r.id, p, NOW - (3 + i) * DAY));
    }
    const v = w.view();
    const total = 6900 * 3 + 3400 + 2000 + 1500;
    assert.deepEqual(v.list.map((r) => r.name), ["A", "B", "C", "D", "E"]);
    assert.equal(v.totals.paid30, total);
    assert.equal(v.totals.concentration.amount, 6900 * 3 + 3400);
    assert.equal(v.totals.concentration.pct, Math.round(((6900 * 3 + 3400) / total) * 100));
    assert.deepEqual(v.totals.concentration.names, ["A", "B", "C"]);
  });
});

describe("Cómo van: cobros marcados en el Control", () => {
  test("cuenta lo marcado 💵 cobrado (viejo y nuevo), una vez por mes, sin duplicar lo que ya tiene pedido", () => {
    const w = world(NOV1 - 120 * DAY);
    const ana = w.reseller("Ana Control", NOV1 - 100 * DAY);
    const E = w.s.engine.s;
    // Alquiler importado del Excel: su pedido no es un pago (channel "import").
    const imported = (productId, t) => {
      const id = w.buy(ana.id, productId, t);
      for (const o of Object.values(E.orders)) if (o.assignmentIds?.includes(id)) o.channel = "import";
      return id;
    };
    // a) Marca vieja (de antes de esta versión, sin anotación): cuenta el día que empezó el período.
    const a1 = imported("disney-alq", NOV1 - 60 * DAY);
    w.at(NOW - 6 * DAY); w.s.orders.setExpiry(OWNER, a1, NOW + 25 * DAY); // período: 05/11 → 05/12
    E.assignments[a1].control = { payStatus: "pagado", price: 6900 };
    // b) Marca nueva: queda anotada con fecha y monto. Si te equivocás y la volvés a "pendiente", se borra.
    const a2 = imported("prime-alq", NOV1 - 60 * DAY);
    w.at(NOW - 3 * DAY); w.s.orders.setExpiry(OWNER, a2, NOW + 20 * DAY);
    w.at(NOW - 2 * DAY); w.s.orders.setControl(OWNER, a2, { payStatus: "pagado" });
    assert.equal(E.assignments[a2].control.paidLog.length, 1);
    assert.equal(E.assignments[a2].control.paidLog[0].amount, 2000, "a su precio de revendedor");
    w.s.orders.setControl(OWNER, a2, { payStatus: "pendiente" });
    assert.equal(E.assignments[a2].control.paidLog, undefined, "volver a pendiente borra el cobro");
    w.s.orders.setControl(OWNER, a2, { payStatus: "pagado" });
    w.s.orders.setControl(OWNER, a2, { note: "pagó por QR" });
    assert.equal(E.assignments[a2].control.paidLog.length, 1, "el mismo período cuenta una sola vez");
    // c) Comprado con pedido (ya cuenta) y además marcado cobrado: no se suma dos veces.
    const a3 = w.buy(ana.id, "hbo-alq", NOV1 + 2 * DAY);
    w.at(NOV1 + 3 * DAY); w.s.orders.setControl(OWNER, a3, { payStatus: "pagado" });
    // d) Un cobro marcado en octubre cuenta para el mes pasado, no para este.
    const a4 = imported("disneyse-alq", NOV1 - 80 * DAY);
    w.at(NOV1 - 20 * DAY); w.s.orders.setExpiry(OWNER, a4, NOV1 + 10 * DAY);
    w.s.orders.setControl(OWNER, a4, { payStatus: "pagado" });

    const r = w.view().list.find((x) => x.id === ana.id);
    assert.equal(r.thisMonth, 6900 + 2000 + 1500, "Disney (marca vieja) + Prime (marca nueva) + HBO (pedido, una vez)");
    assert.equal(r.prevMonth, 3400, "Disney sin ESPN marcado en octubre");
    assert.equal(r.fromControl30, 6900 + 2000 + 3400, "lo que vino del Control en 30 días");
    const t = w.view().totals;
    assert.equal(t.fromControl30, r.fromControl30);
    assert.equal(t.changePct, null, "sin mes pasado comparable a esta altura, no se muestra un % gigante");
  });
});

describe("Cómo van: un caso por estado", () => {
  test("nuevo, dormido, creciendo, bajando y estable", () => {
    const w = world(NOW - 200 * DAY);
    const nuevo = w.reseller("Nuevo", NOW - 10 * DAY); w.buy(nuevo.id, "prime-alq", NOW - 9 * DAY);
    const dormido = w.reseller("Dormido", NOW - 150 * DAY); w.buy(dormido.id, "disney-alq", NOW - 80 * DAY); // venció hace 50 días
    const crece = w.reseller("Crece", NOW - 150 * DAY);
    w.buy(crece.id, "prime-alq", NOW - 45 * DAY); w.buy(crece.id, "disney-alq", NOW - 5 * DAY);
    const baja = w.reseller("Baja", NOW - 150 * DAY);
    w.buy(baja.id, "disney-alq", NOW - 50 * DAY); w.buy(baja.id, "disney-alq", NOW - 49 * DAY); w.buy(baja.id, "prime-alq", NOW - 5 * DAY);
    const estable = w.reseller("Estable", NOW - 150 * DAY);
    const e1 = w.buy(estable.id, "disney-alq", NOW - 50 * DAY); w.renew(e1, NOW - 21 * DAY);
    const st = Object.fromEntries(w.view().list.map((r) => [r.name, r.status]));
    assert.deepEqual(st, { Nuevo: "nuevo", Dormido: "dormido", Crece: "creciendo", Baja: "bajando", Estable: "estable" });
    const v = w.view();
    assert.deepEqual(v.totals.byStatus, { nuevo: 1, creciendo: 1, estable: 1, bajando: 1, dormido: 1 });
    // Bajando también por caídos: paga lo mismo pero se le cayeron 2 y no renovó ninguno.
    assert.equal(trendOf({ createdAt: 0, paid30: 5000, prev30: 5000, activeCount: 1, dropped: 2, renewals: 0 }, NOW), "bajando");
    assert.equal(trendOf({ createdAt: 0, paid30: 5000, prev30: 5000, activeCount: 1, dropped: 2, renewals: 2 }, NOW), "estable");
    // Un alquiler suelto de Bs 15 no lo pasa a "creciendo" (diferencia mínima Bs 30).
    assert.equal(trendOf({ createdAt: 0, paid30: 1500, prev30: 0, activeCount: 1, dropped: 0, renewals: 0 }, NOW), "estable");
  });

  test("Atención (seller), revendedor y cliente no pueden pedirlo en el núcleo", () => {
    const w = world(NOW - 10 * DAY);
    for (const role of ["seller", "reseller", "customer"]) {
      assert.throws(() => overview(w.s.engine, { id: "x", role, customerId: role === "seller" ? undefined : "c" }, NOW), /FORBIDDEN|no puede/);
    }
    assert.ok(overview(w.s.engine, { id: "adm", role: "admin" }, NOW));
  });
});

const PASS = "clave-del-dueño-123";
async function serve(clock) {
  const dir = mkdtempSync(join(tmpdir(), "gs-comovan-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const port = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  const call = (m, p, ck, b) => fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: b ? JSON.stringify(b) : undefined });
  const staff = async (u, pw) => (await call("POST", "/api/auth/staff/login", "", { username: u, password: pw })).headers.get("set-cookie").split(";")[0];
  const pinLogin = async (phone, pin) => { const r = await call("POST", "/api/auth/customer/pin", "", { phone, pin }); assert.equal(r.status, 200, await r.clone().text()); return r.headers.get("set-cookie").split(";")[0]; };
  return { app, base, call, staff, pinLogin, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("Cómo van: HTTP", () => {
  test("permisos: dueño y admin 200; Atención, revendedor y cliente 403. El JSON no trae datos de clientes ni de cuentas", async () => {
    const clock = { t: NOW - 10 * DAY, now() { return this.t; } };
    const h = await serve(clock);
    try {
      const own = await h.staff("gabriel", PASS);
      const s = h.app.store;
      for (const [id, name, price] of PRODUCTS) s.catalog.upsertProduct(OWNER, { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
      s.catalog.upsertSupplier(OWNER, { id: "prov", name: "Proveedor", contact: "x", active: true });
      s.inventory.addAccount(OWNER, { productId: "disney-alq", supplierId: "prov", email: "secreta@proveedor.test", password: "Clave#NoMostrar", supplierExpiresAt: NOW + 300 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
      s.inventory.addAccount(OWNER, { productId: "hbo-alq", supplierId: "prov", email: "otra@proveedor.test", password: "Clave#NoMostrar2", supplierExpiresAt: NOW + 300 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
      const rev = await (await h.call("POST", "/api/admin/customers", own, { name: "Rev Uno", phone: "+59177700011", kind: "reseller", priceGroupId: "revendedor" })).json();
      const cli = await (await h.call("POST", "/api/admin/customers", own, { name: "Cliente Final", phone: "+59177700099" })).json();
      const AR = { id: "u_rev", role: "reseller", customerId: rev.id };
      s.wallet.adjust(OWNER, rev.id, 20000, "carga");
      const mine = s.orders.create(AR, { customerId: rev.id, items: [{ productId: "disney-alq", qty: 1 }], paymentMethod: "balance" }).assignmentIds[0];
      const hisClient = s.catalog.createCustomer(AR, { name: "Clienta Escondida", phone: "+59166600011", email: "escondida@cliente.test", whatsappConsent: true });
      const ca = s.orders.create(AR, { customerId: hisClient.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance" }).assignmentIds[0];
      s.subs.save(AR, mine, { label: "Perfil 1", name: "Primo Oculto", phone: "+59165500011", expiresAt: NOW + 5 * DAY, pay: "pendiente", price: 2500 });
      s.rtools.setControl(AR, ca, { price: 2000, payStatus: "no_pago", note: "anotación privada" });
      clock.t = NOW;
      const own2 = await h.staff("gabriel", PASS); // la sesión de hace 10 días ya venció

      await h.call("POST", "/api/admin/staff", own2, { username: "ada", name: "Ada", role: "admin", password: "clave-de-ada-123" });
      await h.call("POST", "/api/admin/staff", own2, { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
      const { pin } = await (await h.call("POST", `/api/admin/customers/${rev.id}/login-pin`, own2, {})).json();
      const { pin: pin2 } = await (await h.call("POST", `/api/admin/customers/${cli.id}/login-pin`, own2, {})).json();
      const ckRev = await h.pinLogin("+59177700011", pin), ckCli = await h.pinLogin("+59177700099", pin2);

      const res = await h.call("GET", "/api/admin/resellers/overview", own2);
      assert.equal(res.status, 200);
      const raw = await res.text();
      assert.equal((await h.call("GET", "/api/admin/resellers/overview", await h.staff("ada", "clave-de-ada-123"))).status, 200);
      assert.equal((await h.call("GET", "/api/admin/resellers/overview", await h.staff("lucia", "clave-de-lucia-123"))).status, 403);
      assert.equal((await h.call("GET", "/api/admin/resellers/overview", ckRev)).status, 403);
      assert.equal((await h.call("GET", "/api/admin/resellers/overview", ckCli)).status, 403);
      assert.equal((await h.call("GET", "/api/admin/resellers/overview", "")).status, 401);

      const d = JSON.parse(raw);
      const r = d.list.find((x) => x.id === rev.id);
      assert.equal(r.activeCount, 2, "cuenta lo suyo y lo de su clienta, sin nombrarla");
      assert.equal(r.paid30, 6900 + 1500);
      assert.ok(r.lastLoginAt, "trae su último ingreso");
      for (const bad of ["subs", "rcontrol", "Clienta Escondida", "escondida@cliente.test", "+59166600011", "Primo Oculto", "+59165500011", "anotación privada", "proveedor.test", "Clave#", "password", "email", "\"control\""]) {
        assert.ok(!raw.includes(bad), `la respuesta no debe incluir ${bad}`);
      }
    } finally { await h.stop(); }
  });
});

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("panel: '📈 Cómo van' muestra las cifras, filtra por estado y arma el WhatsApp de una persona", { skip: !chromium && "Playwright no está instalado" }, async () => {
  const h = await serve({ now: () => Date.now() });
  const browser = await chromium.launch();
  try {
    const own = await h.staff("gabriel", PASS);
    const s = h.app.store, now = Date.now();
    for (const [id, name, price] of PRODUCTS) s.catalog.upsertProduct(OWNER, { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
    s.catalog.upsertSupplier(OWNER, { id: "prov", name: "Proveedor", contact: "x", active: true });
    for (let i = 0; i < 3; i++) s.inventory.addAccount(OWNER, { productId: "disney-alq", supplierId: "prov", email: `c${i}@proveedor.test`, password: "x", supplierExpiresAt: now + 300 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
    const ana = s.catalog.createCustomer(OWNER, { name: "Ana Nueva", phone: "+59177711111", kind: "reseller", priceGroupId: "revendedor", whatsappConsent: true });
    s.orders.create(OWNER, { customerId: ana.id, items: [{ productId: "disney-alq", qty: 2 }], paymentMethod: "cash" });
    s.catalog.createCustomer(OWNER, { name: "Beto Sinnada", phone: "+59177722222", kind: "reseller", priceGroupId: "revendedor", whatsappConsent: true });

    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true });
    const [name, value] = own.split("=");
    await ctx.addCookies([{ name, value, url: h.base }]);
    await ctx.route(/wa\.me|whatsapp\.com/, (route) => route.abort()); // nunca sale un WhatsApp real
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(h.base + "/panel.html#comovan");
    await page.locator(".cv-kpis").waitFor();
    const kp = await page.locator(".cv-kpis").innerText();
    assert.match(kp, /Te pagaron este mes/);
    assert.match(kp, /Vence en 7 días/);
    assert.match(kp, /Concentración top 3/);
    assert.match(kp, /138/);
    assert.equal(await page.locator(".cv-row").count(), 2);
    const first = page.locator(".cv-row").first();
    assert.match(await first.innerText(), /Ana Nueva[\s\S]*Nuevo[\s\S]*Disney \+ ESPN ×2/);
    await first.locator("summary").click();
    const wa = first.locator("a[href*='wa.me']");
    await wa.waitFor();
    const href = await wa.getAttribute("href");
    assert.match(href, /wa\.me\/59177711111\?text=/);
    assert.match(decodeURIComponent(href), /primeras cuentas/);
    // Sin desborde horizontal a 360 px.
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1));
    // Filtro por estado.
    await page.getByRole("tab", { name: /Nuevo \(2\)/ }).click();
    await page.waitForFunction(() => document.querySelector('[data-tab="cvf:nuevo"]')?.getAttribute("aria-selected") === "true");
    assert.equal(await page.locator(".cv-row").count(), 2);
    await page.getByRole("tab", { name: /Dormido/ }).click();
    await page.locator(".emptybox").waitFor();
    assert.deepEqual(errors, []);

    // Atención (seller) no la ve en el menú.
    await h.call("POST", "/api/admin/staff", own, { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
    const ck2 = await h.staff("lucia", "clave-de-lucia-123");
    const ctx2 = await browser.newContext({ viewport: { width: 390, height: 844 } });
    const [n2, v2] = ck2.split("=");
    await ctx2.addCookies([{ name: n2, value: v2, url: h.base }]);
    const p2 = await ctx2.newPage();
    await p2.goto(h.base + "/panel.html#inicio");
    await p2.locator("#menu button").first().waitFor();
    assert.equal(await p2.locator('#menu [data-go="comovan"]').count(), 0);
  } finally { await browser.close(); await h.stop(); }
});
