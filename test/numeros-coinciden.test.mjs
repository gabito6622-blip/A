// Premium 2.0 · etapa 2 "Números que coinciden" (12/11/2026). Datos ficticios; reloj controlado.
//  1. Inicio (dashboard), Finanzas, el resumen (/api/admin/stats) y "Cómo van" muestran el MISMO ingreso:
//     pedidos entregados + cobros marcados 💵 en el Control, sin recargas, pruebas ni importados, sin contar doble.
//  2. Los meses y los días se cortan en hora de Bolivia (UTC−4), corra donde corra el servidor.
//  3. El costo de una cuenta pagada en dólares (costUsd) entra a la ganancia con la tasa de hoy.
//  4. Fiado: quien paga en dólares ve su deuda también en US$ (la libreta sigue en Bs).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStore } from "../dist/store/index.js";
import { overview } from "../dist/store/resellerStats.js";
import { incomeEvents } from "../dist/store/income.js";
import { boDayKey, boMonthKey, boMonthStart, boDayStart } from "../dist/store/time.js";

const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" };
// Bolivia = UTC−4: el 1/11/2026 a las 00:00 en La Paz son las 04:00 UTC.
const NOV1 = Date.UTC(2026, 10, 1, 4);
const NOW = NOV1 + 11 * DAY + 14 * HOUR; // 12/11 a las 14:00 en Bolivia

function world(start = NOV1 - 40 * DAY, rate = 0) {
  const clock = { t: start, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "disney-alq", name: "Disney (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { "disney-alq": 6600, netflix: 3000 } });
  s.catalog.upsertPriceGroup(owner, { id: "lp-usd", name: "Paraguay (US$)", currency: "USD", prices: { "disney-alq": 700, netflix: 300 } });
  if (rate) s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
  let n = 0;
  for (let i = 0; i < 8; i++) s.inventory.addAccount(owner, { productId: "disney-alq", supplierId: "prov", email: `dis${++n}@x.lat`, password: "Clave#Secreta1", supplierExpiresAt: start + 500 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] });
  for (let i = 0; i < 2; i++) s.inventory.addAccount(owner, { productId: "netflix", supplierId: "prov", email: `nf${++n}@x.lat`, password: "Clave#Secreta1", supplierExpiresAt: start + 500 * DAY, cost: 2500, profiles: [1, 2, 3, 4, 5].map((k) => ({ label: `P${k}` })) });
  const at = (t) => { clock.t = t; };
  const rev = s.catalog.createCustomer(owner, { name: "ARIt", phone: "+59170000001", kind: "reseller", priceGroupId: "revendedor" });
  const fin = s.catalog.createCustomer(owner, { name: "Carla Final", phone: "+59170000002" });
  const buy = (cid, productId, t, method = "cash") => { at(t); return s.orders.create(owner, { customerId: cid, items: [{ productId, qty: 1 }], paymentMethod: method }); };
  return { s, clock, at, rev, fin, buy };
}

describe("etapa 2 · una sola fuente de ingresos", () => {
  test("Inicio, Finanzas, el resumen y Cómo van dan el mismo número; recargas, pruebas e importados no cuentan; el Control no se cuenta doble", () => {
    const w = world();
    const { s, at, rev, fin } = w;
    // Mes pasado (octubre): una venta al revendedor, para que haya historia.
    w.buy(rev.id, "disney-alq", NOV1 - 10 * DAY);
    // Este mes: venta con pedido (Bs 66), venta a cliente final (Bs 35), renovación del revendedor (Bs 66).
    const o1 = w.buy(rev.id, "disney-alq", NOV1 + 1 * DAY);
    w.buy(fin.id, "netflix", NOV1 + 2 * DAY);
    at(NOV1 + 3 * DAY); s.orders.renew(owner, o1.assignmentIds[0], { paymentMethod: "cash" });
    // Cobros del Control sin pedido: uno nuevo (paidLog, Bs 50 acordado) y uno viejo importado (marca sin fecha).
    const o4 = w.buy(rev.id, "disney-alq", NOV1 - 45 * DAY); // compra vieja (septiembre): no entra en ninguna ventana de este mes
    at(NOV1 - 15 * DAY); s.orders.setExpiry(owner, o4.assignmentIds[0], NOV1 + 15 * DAY); // renovó por fuera: el período nuevo arranca el 17/10
    at(NOV1 + 4 * DAY); s.orders.setControl(owner, o4.assignmentIds[0], { price: 5000, payStatus: "pagado" }); // y lo marcó cobrado el 5/11
    at(NOV1 - 60 * DAY);
    const imp = s.bulk.apply(owner, rev.id, "dis7@x.lat 20/11/2026").assignmentIds[0]; // importado: Bs 0, canal import
    s.engine.s.assignments[imp].control = { payStatus: "pagado", price: 6600 }; // marca vieja, sin paidLog: cuenta el día que empezó el período (21/10)
    // Lo mismo pero con pedido cerca: la marca no suma (ya está el pedido).
    at(NOV1 + 5 * DAY); s.orders.setControl(owner, o1.assignmentIds[0], { payStatus: "pagado" });
    // Cosas que NO son ingreso: recarga aprobada, prueba gratis.
    at(NOV1 + 6 * DAY);
    const tp = s.orders.requestTopup({ id: "u_" + fin.id, role: "customer", customerId: fin.id }, fin.id, 4000, { fileRef: "up/r.jpg", declaredReference: "DEP-1" });
    s.orders.approvePayment(owner, tp.id, { confirmedReference: "R-1" });
    at(NOW);

    const ev = incomeEvents(s.engine);
    const thisMonth = ev.filter((x) => x.at >= boMonthStart(NOW)).reduce((t, x) => t + x.amount, 0);
    assert.equal(thisMonth, 6600 + 3500 + 6600 + 5000, "venta + venta final + renovación + cobro del Control nuevo (la marca de o1 no suma: tiene pedido cerca)");
    const fin1 = s.finance.report(owner, 2);
    assert.equal(fin1.current.ingresos, thisMonth, "Finanzas");
    assert.equal(fin1.current.delControl, 5000, "Finanzas dice cuánto vino del Control");
    assert.equal(fin1.months[0].ingresos, 6600 + 6600, "octubre: la venta vieja + la marca importada (período que empezó el 21/10)");
    const sum = s.stats.summary(owner, { from: boMonthStart(NOW), to: NOW + 1 });
    assert.equal(sum.revenue, thisMonth, "resumen");
    assert.equal(sum.fromControl, 5000);
    assert.equal(sum.orders, 3, "3 pedidos (la marca del Control no es un pedido)");
    const d = s.stats.dashboard(owner, 11); // 11 días: desde el 1/11 a las 14:00 → no incluye nada de octubre
    assert.equal(d.kpi.revenue, thisMonth, "Inicio");
    assert.equal(d.kpi.fromControl, 5000);
    assert.equal(d.kpi.topups, 4000, "la recarga se ve aparte, no en ingresos");
    assert.equal(d.months.at(-1).revenue, thisMonth, "el mes actual del gráfico de 12 meses");
    assert.equal(d.months.at(-2).revenue, 6600 + 6600, "octubre en el gráfico");
    assert.equal(d.series.reduce((t, x) => t + x.control, 0), 5000, "la serie por día tiene los cobros del Control");
    assert.equal(d.resellers[0].spent, 6600 + 6600 + 5000, "lo que compró ARIt incluye su cobro del Control");
    const cv = overview(s.engine, owner, NOW);
    assert.equal(cv.totals.thisMonth, 6600 + 6600 + 5000, "Cómo van (solo revendedores): lo mismo menos la venta al cliente final");
    assert.equal(cv.totals.fromControl30, 5000 + 6600, "en 30 días entra también la marca importada del 21/10");
    const apps = fin1.topApps.find((x) => x.productId === "disney-alq");
    assert.equal(apps.ingresos, 6600 + 6600 + 5000, "las apps que más dejan también suman el Control");
  });

  test("meses y días en hora de Bolivia: una venta el 31/10 a las 23:30 (La Paz) es de octubre y del día 31", () => {
    const w = world();
    const { s, at, fin } = w;
    const t = NOV1 - 30 * 60_000; // 31/10 23:30 en Bolivia = 1/11 03:30 UTC
    w.buy(fin.id, "netflix", t);
    at(NOW);
    assert.equal(boMonthKey(t), "2026-10"); assert.equal(boDayKey(t), "2026-10-31"); assert.equal(boMonthKey(NOV1), "2026-11");
    assert.equal(boDayStart(NOW), NOV1 + 11 * DAY);
    const f = s.finance.report(owner, 2);
    assert.deepEqual([f.months[0].label, f.months[0].ingresos, f.months[1].ingresos], ["oct 26", 3500, 0]);
    const d = s.stats.dashboard(owner, 30);
    assert.equal(d.months.at(-2).revenue, 3500); assert.equal(d.months.at(-1).revenue, 0);
    assert.equal(d.series.find((x) => x.day === "2026-10-31").sales, 3500);
    assert.equal(d.upcoming[0].day, NOV1 + 11 * DAY, "los 14 días de vencimientos arrancan a las 00:00 de Bolivia");
    const sum = s.stats.summary(owner, { from: t - DAY, to: NOW });
    assert.equal(sum.byDay["2026-10-31"], 3500);
    // Un gasto a esa misma hora también es de octubre.
    at(t); s.finance.addExpense(owner, 1000, "internet");
    at(NOW);
    assert.equal(s.finance.report(owner, 2).months[0].gastos, 1000);
  });

  test("costo en dólares: la cuenta pagada con tarjeta en US$ entra a la ganancia con la tasa de hoy", () => {
    const w = world(NOV1 - 40 * DAY, 10);
    const { s, at } = w;
    at(NOV1 - 20 * DAY); // cargada el mes pasado (al cargarla se anota su gasto en ese mes; este mes entra al estimado)
    const acc = s.inventory.addAccount(owner, { productId: "netflix", supplierId: "prov", email: "nfusd@x.lat", password: "Clave#Secreta1", supplierExpiresAt: NOV1 + 60 * DAY, cost: 9000, costUsd: 900, profiles: [1, 2, 3, 4, 5].map((k) => ({ label: `P${k}` })) }).account;
    at(NOW);
    // Tasa 10 → US$ 9 = Bs 90 (igual que el Bs 90 anotado). Con tasa 12 pasa a Bs 108 sin tocar la cuenta.
    const est = () => s.finance.report(owner, 1).current.cuentasEstimado;
    const before = est();
    s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: 12 } });
    assert.equal(est() - before, 10800 - 9000, "el estimado del mes sube Bs 18 por la cuenta en dólares");
    const m = s.finance.margins(owner).products.find((p) => p.productId === "netflix");
    // Tres cuentas de Netflix de 5 perfiles: Bs 25, Bs 25 y US$ 9 × 12 = Bs 108 → promedio por perfil (25+25+108)/3/5 = Bs 10,53
    assert.equal(m.unitCost, Math.round(((2500 + 2500 + 10800) / 3) / 5));
    const sup = s.stats.suppliers(owner).find((x) => x.supplierId === "prov");
    assert.equal(sup.cost, 8 * 2000 + 2 * 2500 + 10800, "proveedores: la cuenta en dólares cuesta Bs 108 este mes");
    assert.equal(s.engine.s.accounts[acc.id].cost, 9000, "el costo en Bs anotado no se toca");
  });

  test("Fiado: quien paga en dólares ve su deuda también en US$; el resto solo en Bs", () => {
    const w = world(NOV1 - 40 * DAY, 10);
    const { s, at, fin } = w;
    const py = s.catalog.createCustomer(owner, { name: "Paraguay", phone: "+595981000001", kind: "reseller", priceGroupId: "lp-usd" });
    const o = w.buy(py.id, "disney-alq", NOV1 + 1 * DAY);
    at(NOV1 + 2 * DAY);
    s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pendiente" });
    assert.deepEqual(s.fiado.fromControl(owner, py.id), { added: 1, amount: 7000 }, "US$ 7 × 10 = Bs 70");
    s.fiado.charge(owner, { customerId: fin.id, amount: 3500, note: "Netflix" });
    at(NOW);
    const rows = s.fiado.overview(owner).rows;
    const rp = rows.find((r) => r.customerId === py.id), rf = rows.find((r) => r.customerId === fin.id);
    assert.deepEqual([rp.currency, rp.owed, rp.owedUsd, rp.rate], ["USD", 7000, 700, 10]);
    assert.deepEqual([rf.currency, rf.owed, rf.owedUsd], ["BOB", 3500, undefined]);
    // Si la tasa cambia, la libreta (Bs) no cambia; el ≈ US$ sí.
    s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: 14 } });
    const rp2 = s.fiado.overview(owner).rows.find((r) => r.customerId === py.id);
    assert.deepEqual([rp2.owed, rp2.owedUsd], [7000, 500]);
    // La libreta de un revendedor no cambia (sigue en su moneda, sin US$ de la tienda).
    const mine = s.fiado.overview({ id: "u_" + py.id, role: "reseller", customerId: py.id });
    assert.deepEqual(mine.rows, []);
  });
});
