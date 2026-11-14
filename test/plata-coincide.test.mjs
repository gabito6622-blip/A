// «La plata del panel coincide con la real» (15/11/2026, equipo 1). El dueño trabaja como un humano: anota tarde,
// fía, paga en dólares, paga 3 meses juntos, le devuelven plata, devuelve plata. Cada requisito con su prueba.
// Datos ficticios, reloj controlado, carpetas temporales. Nada real.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore } from "../dist/store/index.js";
import { incomeEvents } from "../dist/store/income.js";
import { overview as comoVan } from "../dist/store/resellerStats.js";
import { accountsEstimateMonth } from "../dist/store/finanzasCostos.js";
import { businessReport } from "../dist/server/reportXlsx.js";
import { readSheet } from "../dist/server/xlsx.js";
import { createApp } from "../dist/server/app.js";

const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" }, admin = { id: "u_admin", role: "admin" }, seller = { id: "u_seller", role: "seller" };
const T = (m, d, h = 10) => Date.UTC(2026, m - 1, d, h + 4); // hora de Bolivia

function world(start = T(9, 1, 9)) {
  const clock = { t: start, now() { return this.t; } };
  const s = createStore({ clock });
  const at = (t) => { clock.t = t; };
  s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: 9.85 } });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "disney", name: "Disney perfil", kind: "profile", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertProduct(owner, { id: "barato", name: "Perfil barato", kind: "profile", durationDays: 30, price: 1000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 3000, disney: 2200 } });
  for (const [id, name] of [["andes", "Andes"], ["lima", "Lima"], ["rosa", "Rosa"]]) s.catalog.upsertSupplier(owner, { id, name, active: true });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Ficticia", phone: "+59170000001" });
  const beto = s.catalog.createCustomer(owner, { name: "Beto Ficticio", phone: "+59170000002" });
  const rita = s.catalog.createCustomer(owner, { name: "Rita Revende", phone: "+59170000003", kind: "reseller", priceGroupId: "revendedor" });
  const acc = (productId, supplierId, email, cost, n = 5, exp = start + 400 * DAY, extra = {}) => s.inventory.addAccount(owner, { productId, supplierId, email, password: "Ficticia#123", supplierExpiresAt: exp, cost, profiles: Array.from({ length: n }, (_, i) => ({ label: `P${i + 1}` })), ...extra }).account;
  const sell = (cid, productId, extra = {}) => s.orders.create(owner, { customerId: cid, items: [{ productId, qty: 1 }], paymentMethod: "cash", ...extra });
  const month = (k) => s.finance.monthClose(owner, k);
  return { s, clock, at, ana, beto, rita, acc, sell, month };
}

describe("1 · venta o renovación fiada: no entra hasta que se cobra, y entra una vez el día del cobro", () => {
  test("Vender «⏳ Pendiente»: no cuenta; «Sin pagar» y el Fiado la muestran; al cobrarla cuenta el día del cobro", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(9, 2));
    const o = w.sell(w.ana.id, "netflix", { payLater: true });
    const aid = o.assignmentIds[0];
    assert.equal(o.status, "fulfilled");
    assert.equal(s.engine.s.assignments[aid].control.payStatus, "pendiente", "queda pendiente en el Control");
    at(T(9, 3));
    assert.equal(w.month("2026-09").ingresos, 0, "una venta fiada no es plata que entró");
    assert.equal(s.finance.report(owner, 1).current.ingresos, 0, "Finanzas igual");
    const dash = s.stats.dashboard(owner, 30);
    assert.deepEqual([dash.alerts.unpaid.count, dash.alerts.unpaid.amount], [1, 3500], "Inicio «Sin pagar»");
    assert.equal(s.fiado.overview(owner).totals.unlinked, 3500, "el Fiado ve lo mismo");
    // El 10/09 te paga: lo marcás «Pagado» en el Control.
    at(T(9, 10));
    s.orders.setControl(owner, aid, { payStatus: "pagado" });
    at(T(9, 30, 20));
    const ev = incomeEvents(s.engine).filter((x) => x.assignmentId === aid || x.orderId === o.id);
    assert.equal(ev.length, 1, "cuenta UNA sola vez (el pedido, no además la marca del Control)");
    assert.equal(ev[0].at, T(9, 10), "el día del cobro, no el de la venta");
    assert.equal(ev[0].amount, 3500);
    assert.equal(w.month("2026-09").ingresos, 3500);
    assert.equal(s.stats.dashboard(owner, 30).alerts.unpaid.count, 0);
    // Te equivocaste: vuelve a «Pendiente» → deja de contar; «Pagado» otra vez → cuenta una vez.
    s.orders.setControl(owner, aid, { payStatus: "pendiente" });
    assert.equal(w.month("2026-09").ingresos, 0);
    s.orders.setControl(owner, aid, { payStatus: "pagado" });
    assert.equal(w.month("2026-09").ingresos, 3500);
  });

  test("revendedor que fía: «Cómo van» y el Excel dicen lo mismo que Finanzas, antes y después de cobrar", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(9, 2));
    const o = w.sell(w.rita.id, "netflix", { payLater: true });
    at(T(9, 3));
    const rita = () => comoVan(s.engine, owner).list.find((r) => r.id === w.rita.id).thisMonth;
    const excel = () => { const raw = businessReport(s, owner, { from: T(9, 1, 0), to: T(9, 30, 23) }).file.toString("utf8"); return raw.includes("Rita Revende"); };
    assert.equal(rita(), 0); assert.equal(w.month("2026-09").ingresos, 0);
    at(T(9, 6)); s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pagado" });
    assert.equal(rita(), 3000); assert.equal(w.month("2026-09").ingresos, 3000);
    assert.ok(excel(), "la venta cobrada está en la hoja Ventas");
  });

  test("fiada por 3 meses: debe los 3 meses y, al cobrarla, entran los 3", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(9, 2));
    const o = w.sell(w.ana.id, "netflix", { payLater: true, periods: 3 });
    assert.equal(o.total, 10500);
    assert.equal(s.stats.dashboard(owner, 30).alerts.unpaid.amount, 10500, "Sin pagar = lo fiado de verdad (3 meses)");
    at(T(9, 5)); s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pagado" });
    assert.equal(w.month("2026-09").ingresos, 10500);
  });

  test("vendida como pagada y después marcada «Pendiente» (no te pagó): sale de «Entró» hasta que te paga", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(10, 28));
    const o = w.sell(w.beto.id, "netflix");
    s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pagado" }); // el panel lo marca así al vender
    assert.equal(w.month("2026-10").ingresos, 3500, "cuenta una vez (pedido + marca = el mismo pago)");
    at(T(10, 30)); s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pendiente" });
    assert.equal(w.month("2026-10").ingresos, 0, "no te pagó: octubre no lo cuenta");
    at(T(11, 3)); s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pagado" });
    assert.equal(w.month("2026-10").ingresos, 0);
    assert.equal(w.month("2026-11").ingresos, 3500, "entra en noviembre, el día que te pagó");
  });

  test("«Renovar» del Control con el alquiler pendiente: la renovación queda fiada; al cobrar entran las dos", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(9, 2));
    const o = w.sell(w.ana.id, "netflix", { payLater: true });
    const aid = o.assignmentIds[0];
    at(T(10, 2));
    const r = s.orders.renew(owner, aid, { paymentMethod: "cash" });
    assert.ok(r.order.payLater, "renovación fiada");
    assert.equal(w.month("2026-10").ingresos, 0);
    assert.equal(s.stats.dashboard(owner, 30).alerts.unpaid.amount, 7000, "debe la venta y la renovación");
    at(T(10, 6)); s.orders.setControl(owner, aid, { payStatus: "pagado" });
    assert.equal(w.month("2026-10").ingresos, 7000);
    // Ya pagado: la próxima renovación normal cuenta al toque.
    at(T(11, 1)); s.orders.renew(owner, aid, { paymentMethod: "cash" });
    assert.equal(w.month("2026-11").ingresos, 3500);
  });

  test("marcada «Pendiente» cuando ya vence (antes de renovar): lo que pagó el mes pasado sigue contando; la renovación queda fiada", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(9, 2));
    const o = w.sell(w.ana.id, "netflix");
    s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pagado" });
    at(T(10, 1)); // vence el 02/10: «me renovás y te pago después»
    s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pendiente" });
    assert.equal(w.month("2026-09").ingresos, 3500, "septiembre no se toca");
    const r = s.orders.renew(owner, o.assignmentIds[0], { paymentMethod: "cash" });
    assert.ok(r.order.payLater);
    assert.equal(w.month("2026-10").ingresos, 0);
    at(T(10, 9)); s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pagado" });
    assert.equal(w.month("2026-10").ingresos, 3500);
    assert.equal(w.month("2026-09").ingresos, 3500);
  });

  test("pasada al Fiado: entra por el pago del fiado, una sola vez", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(9, 2));
    const o = w.sell(w.ana.id, "netflix", { payLater: true, periods: 2 });
    const r = s.fiado.fromControl(owner, w.ana.id);
    assert.deepEqual(r, { added: 1, amount: 7000 }, "el cargo del fiado es lo fiado (2 meses)");
    at(T(9, 15)); s.fiado.pay(owner, { customerId: w.ana.id, amount: 7000 });
    assert.equal(s.engine.s.assignments[o.assignmentIds[0]].control.payStatus, "pagado");
    at(T(9, 20)); s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pendiente" }); s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pagado" });
    assert.equal(w.month("2026-09").ingresos, 7000, "el pago del fiado; el pedido no suma además");
  });

  test("por HTTP: POST /api/admin/orders con payLater", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-eq1-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    try {
      app.bootstrapOwner("gabriel", "Gabriel", "clave-ficticia-123");
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-ficticia-123" }) })).headers.get("set-cookie").split(";")[0];
      const s = app.store, O = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
      s.catalog.upsertProduct(O, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
      s.inventory.addAccount(O, { productId: "nf", email: "nf@x.lat", password: "Ficticia#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 9000, profiles: [{ label: "P1" }] });
      const c = s.catalog.createCustomer(O, { name: "Dani Ficticia", phone: "+59170000009" });
      const r = await fetch(base + "/api/admin/orders", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ customerId: c.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", payLater: true }) });
      assert.equal(r.status, 200);
      const o = await r.json();
      assert.ok(o.payLater);
      assert.equal(s.finance.report(O, 1).current.ingresos, 0);
      await app.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("2 · «Pasar al fiado» usa el precio real", () => {
  test("cliente de lista de revendedor: su precio (Bs 30), no el del producto (Bs 35)", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(9, 2));
    // Un servicio que ya existía (importado del Excel): no hay pedido fiado, vale su precio real.
    const o = s.orders.create(owner, { customerId: w.rita.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash", channel: "import" });
    s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pendiente" });
    assert.deepEqual(s.fiado.fromControl(owner, w.rita.id), { added: 1, amount: 3000 });
  });
});

describe("3 · pago al proveedor por varios meses: no se vuelve a estimar", () => {
  test("«Pagué la renovación» con 3 meses: Bs 210 en el mes del pago y 0 estimado los dos siguientes", () => {
    const w = world(T(8, 1, 9));
    const { s, at } = w;
    const d = w.acc("disney", "lima", "dis@x.lat", 7000, 7, T(8, 31, 20));
    at(T(9, 1, 9));
    const r = s.finance.payRenewal(owner, d.id, { amount: 21000, months: 3 });
    assert.equal(r.expense.months, 3);
    assert.ok(r.expense.coversUntil > T(11, 25), "cubre hasta fin de noviembre");
    at(T(12, 15));
    assert.equal(accountsEstimateMonth(s.engine, "2026-09").amount, 0, "septiembre: el gasto real");
    assert.equal(accountsEstimateMonth(s.engine, "2026-10").amount, 0, "octubre: cubierto");
    assert.equal(accountsEstimateMonth(s.engine, "2026-11").amount, 0, "noviembre: cubierto");
    assert.equal(accountsEstimateMonth(s.engine, "2026-08").amount, 7000, "agosto (antes del pago) se estima");
    assert.equal(w.month("2026-09").gastos, 21000);
    assert.equal(w.month("2026-10").gananciaEstimada, 0, "octubre no resta Bs 70 de nuevo");
  });

  test("cuenta cargada con «Ya la pagué» por 3 meses: se anota lo pagado de verdad y cubre esos meses", () => {
    const w = world(T(8, 1, 9));
    const { s } = w;
    const d = w.acc("disney", "lima", "dis@x.lat", 7000, 7, T(10, 31, 20));
    const ex = s.finance.recordAccountCost(owner, d.id, { months: 3, amount: 20000 });
    assert.deepEqual([ex.amount, ex.months], [20000, 3]);
    assert.equal(accountsEstimateMonth(s.engine, "2026-09").amount, 0);
    assert.equal(accountsEstimateMonth(s.engine, "2026-10").amount, 0);
    // Sin decir el monto: costo por mes × meses.
    const d2 = w.acc("disney", "lima", "dis2@x.lat", 7000, 7, T(10, 31, 20));
    assert.equal(s.finance.recordAccountCost(owner, d2.id, { months: 3 }).amount, 21000);
    // Sin meses: uno, como antes.
    const d3 = w.acc("disney", "lima", "dis3@x.lat", 7000, 7, T(10, 31, 20));
    assert.equal(s.finance.recordAccountCost(owner, d3.id).amount, 7000);
  });
});

describe("4 · gastos con fecha, moneda, categoría y proveedor; editar meses anteriores", () => {
  test("cae en el mes de su fecha, en dólares guarda US$ y tasa, y se edita después", () => {
    const w = world(T(11, 1, 10));
    const { s, at } = w;
    // 01/11: anota «ayer» (31/10) la comisión del QR: va a octubre.
    const x = s.finance.addExpenseFull(owner, { amount: 1200, note: "Comisión QR", category: "comision", date: "2026-10-31" });
    assert.equal(x.category, "comision");
    assert.equal(w.month("2026-10").gastos, 1200, "octubre");
    assert.equal(w.month("2026-11").gastos, 0, "no noviembre");
    // Publicidad US$ 10 a 10,10.
    const fb = s.finance.addExpenseFull(owner, { amount: 1000, currency: "USD", rate: 10.1, note: "Publicidad Facebook", category: "publicidad", supplierId: "andes" });
    assert.deepEqual([fb.amount, fb.usd, fb.rate, fb.currency, fb.supplierId], [10100, 1000, 10.1, "USD", "andes"]);
    // USDT sin tasa: la última que anotaste.
    const u = s.finance.addExpenseFull(owner, { amount: 500, currency: "USDT", note: "Algo en USDT" });
    assert.equal(u.rate, 10.1);
    // Editar el de octubre desde noviembre.
    at(T(11, 5));
    const ed = s.finance.updateExpense(owner, x.id, { amount: 1500, note: "Comisión QR de octubre" });
    assert.equal(ed.amount, 1500);
    assert.equal(w.month("2026-10").gastos, 1500);
    const list = s.finance.monthExpenses(owner, "2026-10");
    assert.equal(list.expenses.length, 1);
    assert.equal(list.expenses[0].note, "Comisión QR de octubre");
    assert.ok(s.engine.s.audit.some((a) => a.action === "expense.edit" && a.entityId === x.id), "queda en la auditoría");
    // Cambiar la fecha lo pasa de mes.
    s.finance.updateExpense(owner, x.id, { date: "2026-11-02" });
    assert.equal(w.month("2026-10").gastos, 0);
    // Errores claros.
    assert.throws(() => s.finance.addExpenseFull(owner, { amount: 100, note: "x", date: "2026-12-01" }), /futuro/);
    assert.throws(() => s.finance.addExpenseFull(owner, { amount: 100, note: "x", category: "lujos" }), /Categoría/);
    assert.throws(() => s.finance.addExpenseFull(owner, { amount: 0, note: "x" }), /mayor a 0/);
    assert.throws(() => s.finance.addExpenseFull(seller, { amount: 100, note: "x" }), (e) => e.code === "FORBIDDEN");
    // El viejo addExpense(monto, nota) sigue andando.
    assert.equal(s.finance.addExpense(owner, 700, "Viejo").amount, 700);
  });
});

describe("5 · «Me devolvió plata» (devolución de un proveedor)", () => {
  test("resta de los gastos del mes, se ve en verde y no cuenta como «ya pagué la cuenta»", () => {
    const w = world(T(9, 1, 9));
    const { s, at } = w;
    const r1 = w.acc("netflix", "rosa", "rosa@x.lat", 2200, 1, T(12, 30));
    s.finance.recordAccountCost(owner, r1.id);
    at(T(9, 18));
    const dev = s.finance.addRefund(owner, { amount: 1500, supplierId: "rosa", accountId: r1.id, note: "Se cayó el perfil" });
    assert.deepEqual([dev.refund, dev.amount, dev.supplierId], [true, 1500, "rosa"]);
    const m = w.month("2026-09");
    assert.equal(m.gastos, 2200 - 1500);
    assert.equal(m.devueltoProveedores, 1500);
    // En octubre la cuenta se estima de nuevo (la devolución no es un pago).
    at(T(10, 2));
    assert.equal(accountsEstimateMonth(s.engine, "2026-10").amount, 2200);
    // En dólares, con fecha.
    const usd = s.finance.addRefund(owner, { amount: 200, currency: "USD", rate: 10, note: "Tarjeta devolvió", at: "2026-10-01" });
    assert.equal(usd.amount, 2000);
    assert.equal(s.finance.monthExpenses(owner, "2026-10").devuelto, 2000);
    assert.throws(() => s.finance.addRefund(seller, { amount: 100, note: "x" }), (e) => e.code === "FORBIDDEN");
    assert.equal(s.finance.addRefund(admin, { amount: 100, note: "admin" }).refund, true, "admin sí");
  });
});

describe("6 · gastos fijos mensuales", () => {
  test("cada mes aparecen pendientes (y se restan como estimado) hasta «Lo pagué»", () => {
    const w = world(T(8, 5));
    const { s, at } = w;
    const f = s.finance.upsertFixed(owner, { name: "Internet", amount: 15000, category: "internet" });
    s.finance.addExpenseFull(owner, { amount: 15000, note: "Internet agosto", category: "internet" }); // anotado a mano: cuenta
    at(T(9, 20));
    assert.deepEqual(w.month("2026-08").fijosPendientes, [], "agosto ya anotado (misma categoría)");
    const sep = w.month("2026-09");
    assert.deepEqual(sep.fijosPendientes.map((p) => [p.name, p.amount]), [["Internet", 15000]], "septiembre: «Falta anotar: Internet Bs 150»");
    assert.equal(sep.fijosEstimado, 15000);
    assert.equal(sep.gananciaEstimada, sep.ingresos - sep.gastos - sep.cuentasEstimado - 15000);
    assert.deepEqual(w.month("2026-07").fijosPendientes ?? [], [], "antes de crearlo no aparece");
    // «Lo pagué» con monto editable.
    const x = s.finance.payFixed(owner, f.id, { amount: 16000 });
    assert.deepEqual([x.amount, x.fixedId, x.category], [16000, f.id, "internet"]);
    assert.deepEqual(w.month("2026-09").fijosPendientes, []);
    assert.throws(() => s.finance.payFixed(owner, f.id), /ya está anotado/);
    // Un mes anterior: queda el último día de ese mes.
    at(T(11, 3));
    const oct = s.finance.payFixed(owner, f.id, { month: "2026-10" });
    assert.equal(new Date(oct.at - 4 * HOUR).toISOString().slice(0, 10), "2026-10-31");
    assert.equal(s.finance.report(owner, 1).current.fijosEstimado, 15000, "noviembre todavía falta");
  });
});

describe("7 · devolver plata a un cliente no cuenta dos veces", () => {
  test("a su saldo: resta el día que devolviste; lo que paga con ese saldo vuelve a entrar → total = lo real", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    w.acc("disney", "lima", "dis@x.lat", 7000, 7);
    at(T(9, 2));
    const o = w.sell(w.ana.id, "disney");
    at(T(9, 15));
    const r = s.orders.refundAssignment(owner, o.assignmentIds[0], { amount: 2500, reason: "Se cayó el perfil" });
    assert.equal(r.via, "saldo");
    assert.equal(s.wallet.balance(w.ana.id), 2500);
    at(T(9, 16));
    s.orders.create(owner, { customerId: w.ana.id, items: [{ productId: "disney", qty: 1 }], paymentMethod: "balance" });
    assert.equal(w.month("2026-09").ingresos, 2500, "entró Bs 25 de verdad (una vez)");
    assert.equal(w.month("2026-09").devueltoClientes, 2500);
  });

  test("«Le devolví en efectivo»: resta de «Entró» y no toca el saldo; perfil caído va a cuarentena", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(9, 2));
    const o = w.sell(w.ana.id, "netflix");
    const slotId = s.engine.s.assignments[o.assignmentIds[0]].slotId;
    at(T(9, 17));
    const r = s.orders.refundAssignment(owner, o.assignmentIds[0], { amount: 1750, cash: true, slotFallen: true });
    assert.equal(r.via, "efectivo");
    assert.equal(s.wallet.balance(w.ana.id), 0);
    assert.equal(w.month("2026-09").ingresos, 3500 - 1750);
    assert.equal(s.engine.s.slots[slotId].status, "quarantined", "slotFallen → cuarentena");
    const o2 = w.sell(w.beto.id, "netflix");
    s.orders.refundAssignment(owner, o2.assignmentIds[0], { amount: 0 });
    assert.equal(s.engine.s.slots[s.engine.s.assignments[o2.assignmentIds[0]].slotId].status, "available", "sin slotFallen → libre, como antes");
  });
});

describe("8 · corregir el monto de una venta", () => {
  test("dueño o admin con motivo; Finanzas usa el corregido; queda en la Auditoría; ofrecer corregir al cambiar el precio", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(9, 2));
    const o = w.sell(w.ana.id, "netflix");
    s.orders.setControl(owner, o.assignmentIds[0], { price: 3000 });
    const fix = s.finance.saleToFix(owner, o.assignmentIds[0]);
    assert.deepEqual([fix.orderId, fix.total, fix.suggested], [o.id, 3500, 3000]);
    assert.throws(() => s.finance.amendOrder(seller, o.id, { total: 3000, reason: "precio" }), (e) => e.code === "FORBIDDEN");
    assert.throws(() => s.finance.amendOrder(owner, o.id, { total: 3000, reason: "" }), /motivo/);
    s.finance.amendOrder(admin, o.id, { total: 3000, reason: "Cambié el precio en el Control" });
    assert.equal(w.month("2026-09").ingresos, 3000);
    assert.ok(s.engine.s.audit.some((a) => a.action === "order.amend" && a.entityId === o.id && a.data?.from === 3500 && a.data?.to === 3000));
    assert.equal(s.finance.saleToFix(owner, o.assignmentIds[0]).suggested, 3000);
    // Pagada con saldo: no se corrige así.
    s.wallet.adjust(owner, w.beto.id, 5000, "demo");
    const ob = s.orders.create(owner, { customerId: w.beto.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    assert.throws(() => s.finance.amendOrder(owner, ob.id, { total: 100, reason: "probando" }), /saldo/);
  });
});

describe("9 · Excel: hojas Gastos y Proveedores; cierre con una sola fila «Te quedó»", () => {
  test("el del negocio trae Gastos (con US$, tasa y devoluciones) y Proveedores; el cierre una fila «Te quedó»", async () => {
    const w = world(T(11, 1, 9));
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 12000);
    at(T(11, 3)); w.sell(w.ana.id, "netflix");
    s.finance.addExpenseFull(owner, { amount: 1000, currency: "USD", rate: 10.1, note: "Publicidad FB", category: "publicidad" });
    s.finance.addRefund(owner, { amount: 1500, supplierId: "rosa", note: "Rosa devolvió" });
    at(T(11, 14));
    const { file } = businessReport(s, owner, { from: T(11, 1, 0), to: T(11, 14, 23) });
    const raw = file.toString("utf8");
    for (const sh of ["Gastos", "Proveedores"]) assert.ok(raw.includes(`name="${sh}"`), `hoja ${sh}`);
    for (const t of ["Publicidad FB", "Devolución (resta)", "Rosa", "Andes", "Te devolvió"]) assert.ok(raw.includes(t), t);
    assert.ok(raw.includes("B6-B7-B8-B9"), "Te quedó = ingresos − gastos − cuentas − fijos");
    // El revendedor no ve gastos ni proveedores de la tienda.
    const RA = { id: "u_" + w.rita.id, role: "reseller", customerId: w.rita.id };
    const rr = businessReport(s, RA, { from: T(11, 1, 0), to: T(11, 14, 23) }).file.toString("utf8");
    assert.ok(!rr.includes('name="Gastos"') && !rr.includes('name="Proveedores"') && !rr.includes("Rosa devolvió"));
    // Cierre por HTTP: una sola fila «Te quedó».
    const dir = mkdtempSync(join(tmpdir(), "gs-eq1-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    try {
      app.bootstrapOwner("gabriel", "Gabriel", "clave-ficticia-123");
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-ficticia-123" }) })).headers.get("set-cookie").split(";")[0];
      const O = { id: Object.keys(app.store.engine.s.staff)[0], role: "owner" };
      app.store.finance.addExpenseFull(O, { amount: 5000, note: "Internet", category: "internet" });
      const buf = Buffer.from(await (await fetch(base + "/api/admin/finance/cierre.xlsx", { headers: { cookie: ck } })).arrayBuffer());
      const rows = readSheet(buf);
      assert.equal(rows.filter((r) => /^Te quedó/.test(String(r[0] ?? ""))).length, 2, "una en el mes y una en el mes anterior");
      assert.equal(rows.filter((r) => String(r[0]) === "Te quedó (estimado)").length, 0, "ya no hay dos «Te quedó» por mes");
      await app.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("10 · Proveedores por mes", () => {
  test("lo que entró va al proveedor de la cuenta donde estaba el cliente al pagar; la retirada cuesta su mes; suma = Finanzas", () => {
    const w = world(T(9, 1, 9));
    const { s, at } = w;
    const r1 = w.acc("netflix", "rosa", "rosa@x.lat", 2200, 1);
    w.acc("netflix", "andes", "nf@x.lat", 12000, 5);
    at(T(9, 2));
    const o = w.sell(w.ana.id, "netflix", { preferredSlotIds: Object.values(s.engine.s.slots).filter((x) => x.accountId === r1.id).map((x) => x.id) });
    assert.equal(s.engine.s.slots[s.engine.s.assignments[o.assignmentIds[0]].slotId].accountId, r1.id);
    at(T(9, 18)); s.orders.replaceAccount(owner, r1.id, "Se cayó la de Rosa"); // Ana pasa a Andes; la de Rosa se retira
    at(T(9, 19)); s.finance.addRefund(owner, { amount: 1500, supplierId: "rosa", note: "Rosa devolvió" });
    at(T(10, 2)); s.orders.renew(owner, o.assignmentIds[0], { paymentMethod: "cash" });
    at(T(10, 20));
    const sep = s.finance.suppliersMonth(owner, "2026-09");
    const by = (d, id) => d.rows.find((r) => r.supplierId === id);
    assert.equal(by(sep, "rosa").ingresos, 3500, "septiembre: Ana estaba en la cuenta de Rosa cuando pagó");
    assert.equal(by(sep, "andes").ingresos, 0);
    assert.equal(by(sep, "rosa").estimado, 2200, "la cuenta retirada cuesta en el mes que se retiró");
    assert.equal(by(sep, "rosa").devuelto, 1500);
    const oct = s.finance.suppliersMonth(owner, "2026-10");
    assert.equal(by(oct, "andes").ingresos, 3500, "octubre: ya estaba en Andes");
    assert.equal(by(oct, "rosa").ingresos, 0);
    // La suma de proveedores = Finanzas del mes.
    for (const [k, d] of [["2026-09", sep], ["2026-10", oct]]) {
      const m = w.month(k);
      assert.equal(d.totals.ingresos, m.ingresos, `${k}: entró`);
      assert.equal(d.totals.ganancia, m.gananciaEstimada, `${k}: te quedó`);
    }
    assert.throws(() => s.finance.suppliersMonth(seller), (e) => e.code === "FORBIDDEN");
  });
});

describe("11 · cuentas en US$: la última tasa que anotaste al pagarla", () => {
  test("estima con 10,10 (lo que cobró el banco), no con el USDT de la tienda (9,85)", () => {
    const w = world(T(8, 1, 9));
    const { s, at } = w;
    const m1 = w.acc("disney", "andes", "max@x.lat", 16700, 5, T(12, 31, 20), { costUsd: 1699 });
    at(T(9, 1, 9)); s.finance.payRenewal(owner, m1.id, { amount: Math.round(1699 * 10.1), months: 1, usd: 1699, rate: 10.1 });
    at(T(10, 5));
    assert.equal(accountsEstimateMonth(s.engine, "2026-10").amount, Math.round(1699 * 10.1));
  });
});

describe("12 · «Apps que más dejaron» muestra también la que da pérdida", () => {
  test("una app que cuesta más de lo que se cobra aparece aunque no esté entre las 3 primeras", () => {
    const w = world();
    const { s, at } = w;
    w.acc("netflix", "andes", "nf@x.lat", 5000, 5);
    w.acc("disney", "lima", "dis@x.lat", 3500, 7);
    w.acc("barato", "rosa", "bar@x.lat", 3000, 1); // cuesta Bs 30 y se vende a Bs 10
    s.catalog.upsertProduct(owner, { id: "extra", name: "Extra", kind: "profile", durationDays: 30, price: 2000, published: true });
    w.acc("extra", "andes", "ex@x.lat", 1000, 5);
    at(T(9, 2));
    for (const p of ["netflix", "disney", "extra", "barato"]) w.sell(w.ana.id, p);
    const top = w.month("2026-09").topApps;
    assert.ok(top.length >= 4);
    const bad = top.find((a) => a.productId === "barato");
    assert.ok(bad && bad.gana < 0, "la que da pérdida está");
  });
});

describe("rutas nuevas por HTTP: dueño sí, Atención no, sin sesión 401", () => {
  test("gastos, devoluciones, fijos, proveedores y corregir venta", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-eq1-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    try {
      app.bootstrapOwner("gabriel", "Gabriel", "clave-ficticia-123");
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const login = async (u, p) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) })).headers.get("set-cookie").split(";")[0];
      const ck = await login("gabriel", "clave-ficticia-123");
      const req = async (m, p, body, c = ck) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(c ? { cookie: c } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null) }; };
      const x = await req("POST", "/api/admin/expenses", { amount: 1000, currency: "USD", rate: 10, note: "Publicidad", category: "publicidad", date: new Date(Date.now() - 4 * HOUR).toISOString().slice(0, 10) });
      assert.equal(x.status, 200); assert.equal(x.json.amount, 10000);
      assert.equal((await req("POST", `/api/admin/expenses/${x.json.id}`, { amount: 1200, currency: "USD", rate: 10, note: "Publicidad FB" })).json.amount, 12000);
      assert.equal((await req("GET", "/api/admin/expenses")).json.expenses.length, 1);
      const dv = await req("POST", "/api/admin/finance/refunds", { amount: 500, note: "Devolución" });
      assert.equal(dv.status, 200); assert.equal(dv.json.refund, true);
      const f = await req("POST", "/api/admin/finance/fixed", { name: "Internet", amount: 15000, category: "internet" });
      assert.equal(f.status, 200);
      assert.equal((await req("POST", `/api/admin/finance/fixed/${f.json.id}/pay`, { amount: 15500 })).json.amount, 15500);
      assert.equal((await req("GET", "/api/admin/finance/proveedores")).status, 200);
      assert.equal((await req("GET", "/api/admin/expenses", null, null)).status, 401);
      assert.equal((await req("POST", "/api/admin/finance/refunds", { amount: 500, note: "x" }, null)).status, 401);
      // Atención (seller): no ve ni anota la plata del dueño.
      await req("POST", "/api/admin/staff", { username: "atencion", name: "Atención", password: "clave-atencion-123", role: "seller" });
      const cks = await login("atencion", "clave-atencion-123");
      assert.equal((await req("POST", "/api/admin/finance/refunds", { amount: 500, note: "x" }, cks)).status, 403);
      assert.equal((await req("GET", "/api/admin/expenses", null, cks)).status, 403);
      assert.equal((await req("GET", "/api/admin/finance/proveedores", null, cks)).status, 403);
      assert.equal((await req("POST", "/api/admin/orders/ord_x/amend", { total: 1, reason: "xxx" }, cks)).status, 403);
      await app.close();
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
