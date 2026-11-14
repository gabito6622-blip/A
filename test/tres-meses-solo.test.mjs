// Lo que encontró la simulación de 3 meses trabajando como Gabriel (16/11/2026): cada caso con lo que pasaba y lo que
// tiene que pasar. Datos ficticios en memoria, reloj simulado, nada real.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { incomeEvents } from "../dist/store/income.js";

const owner = { id: "u_owner", role: "owner" };
const T0 = Date.UTC(2026, 7, 4, 14); // 04/08/2026 10:00 en Bolivia
const sum = (l) => l.reduce((t, x) => t + x.amount, 0);

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 2000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { nf: 1800 } });
  let n = 0;
  const acc = (days = 90, k = 5) => s.inventory.addAccount(owner, { productId: "nf", email: `nf${++n}@ficticio.lat`, password: "Clave-Ficticia#" + n, supplierExpiresAt: T0 + days * DAY, cost: 1000, profiles: Array.from({ length: k }, (_, i) => ({ label: `P${i + 1}` })) }).account;
  const cust = (name, extra = {}) => s.catalog.createCustomer(owner, { name, phone: `+591711${String(++n).padStart(5, "0")}`, whatsappConsent: true, ...extra });
  const sell = (c) => s.orders.create(owner, { customerId: c.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", idempotencyKey: `k${++n}` }).assignmentIds[0];
  const owed = () => { const f = s.fiado.overview(owner); return f.totals.owed + f.totals.unlinked; };
  return { s, E: s.engine, clock, acc, cust, sell, owed, A: (id) => s.engine.s.assignments[id] };
}

describe("cobrar dos veces por error", () => {
  test("«Me pagó» a los días de venderle (venta pagada) pregunta si es otro mes; no regala 30 días", () => {
    const { s, acc, cust, sell, clock, A } = setup();
    acc();
    const id = sell(cust("Ana"));
    const exp = A(id).customerExpiresAt;
    clock.t += 6 * DAY;
    const pv = s.cobro.preview(owner, id);
    assert.match(pv.doubleCharge?.text ?? "", /Ya anotaste un cobro el 04\/08 \(Bs 20\).*¿Es otro mes\?/);
    assert.throws(() => s.cobro.apply(owner, id, {}), (e) => e instanceof DomainError && e.code === "DOUBLE_CHARGE");
    assert.equal(A(id).customerExpiresAt, exp, "la fecha no se movió");
    // «Renovar» (pagar por adelantado) no lo pregunta: es otro período a propósito.
    assert.equal(s.cobro.preview(owner, id, { renew: true }).doubleCharge, undefined);
    // Si de verdad le pagó el mes siguiente, confirma y se anota.
    s.cobro.apply(owner, id, { confirmOther: true });
    assert.equal(A(id).customerExpiresAt, exp + 30 * DAY);
  });

  test("una venta fiada sin cobrar no cuenta como cobro (ese «Me pagó» es la deuda)", () => {
    const { s, acc, cust, sell, clock } = setup();
    acc();
    const id = sell(cust("Dani"));
    s.orders.setControl(owner, id, { payStatus: "pendiente" });
    clock.t += 6 * DAY;
    assert.equal(s.cobro.preview(owner, id).doubleCharge, undefined);
  });
});

describe("«Me pagó» de alguien que estaba fiado", () => {
  test("primero paga lo que debía y no le regala el mes; con 2 meses paga la deuda y corre la fecha uno", () => {
    const { s, E, acc, cust, sell, clock, A, owed } = setup();
    acc();
    const dani = cust("Dani");
    const id = sell(dani);
    s.orders.setControl(owner, id, { payStatus: "pendiente" });
    const exp = A(id).customerExpiresAt;
    assert.equal(owed(), 2000);
    clock.t = exp - DAY / 2;
    const pv = s.cobro.preview(owner, id);
    assert.equal(pv.debt, 2000);
    assert.equal(pv.to, exp, "con 1 mes no corre la fecha");
    assert.match(pv.warnings.join(" "), /te debe el período que está usando \(Bs 20\).*no corre la fecha.*elegí 2 meses/);
    const r = s.cobro.apply(owner, id, {});
    assert.equal(r.saved.debtPaid, 2000);
    assert.equal(A(id).customerExpiresAt, exp);
    assert.equal(owed(), 0);
    assert.equal(sum(incomeEvents(E)), 2000, "entró una sola vez");
    // Otra clienta fiada que paga lo que debía y el mes nuevo juntos.
    const eva = cust("Eva");
    clock.t = T0;
    const id2 = sell(eva);
    s.orders.setControl(owner, id2, { payStatus: "pendiente" });
    const exp2 = A(id2).customerExpiresAt;
    clock.t = exp2 - DAY / 2;
    const pv2 = s.cobro.preview(owner, id2, { periods: 2 });
    assert.equal(pv2.to, exp2 + 30 * DAY);
    s.cobro.apply(owner, id2, { periods: 2 });
    assert.equal(A(id2).customerExpiresAt, exp2 + 30 * DAY);
    assert.equal(owed(), 0);
    assert.equal(sum(incomeEvents(E)), 2000 + 4000, "Eva: lo que debía + el mes nuevo");
  });

  test("pago de 3 meses juntos: Finanzas cuenta los 3 (antes contaba uno)", () => {
    const { s, E, acc, cust, sell, clock, A } = setup();
    acc(200);
    const id = sell(cust("Mario"));
    clock.t = A(id).customerExpiresAt - DAY;
    s.cobro.apply(owner, id, { periods: 3 });
    const ctl = incomeEvents(E).filter((x) => x.source === "control");
    assert.equal(sum(ctl), 6000);
  });
});

describe("Fiado que no se pierde", () => {
  test("se cortó debiendo: lo fiado pasa a su libreta y se cobra después sin contarse dos veces", () => {
    const { s, E, acc, cust, sell, clock, A, owed } = setup();
    acc();
    const zoe = cust("Zoe");
    const id = sell(zoe);
    s.orders.setControl(owner, id, { payStatus: "pendiente" });
    clock.t = A(id).customerExpiresAt + 3 * DAY;
    s.orders.closeExpired({ id: "system", role: "system" }, 2);
    assert.equal(A(id).status, "revoked");
    assert.equal(owed(), 2000, "la deuda sigue en el Fiado");
    assert.ok(E.s.fiado.some((x) => x.kind === "cargo" && x.customerId === zoe.id && /se cortó sin pagar/.test(x.note)));
    s.fiado.pay(owner, { customerId: zoe.id, amount: 2000, note: "pagó" });
    assert.equal(owed(), 0);
    assert.equal(sum(incomeEvents(E)), 2000);
  });

  test("«Me pagó» en el Fiado de un revendedor con alquileres «Pendiente»: el pago los cubre (no queda «debe» y «a favor» a la vez)", () => {
    const { s, E, acc, cust, clock, A, owed } = setup();
    acc();
    const pedro = cust("Pedro", { kind: "reseller", priceGroupId: "rev" });
    const ids = [0, 1].map(() => s.orders.create(owner, { customerId: pedro.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0]);
    for (const id of ids) s.orders.setControl(owner, id, { payStatus: "pendiente" });
    assert.equal(owed(), 3600);
    clock.t += 5 * DAY;
    s.fiado.pay(owner, { customerId: pedro.id, amount: 2000, note: "una parte" });
    const row = s.fiado.overview(owner).rows.find((r) => r.customerId === pedro.id);
    assert.equal(row.owed + row.unlinked.amount, 1600);
    assert.equal(row.credit, 0);
    // El primero quedó pagado (el pago cubre lo más viejo); el segundo sigue «Pendiente» y en el fiado.
    assert.deepEqual(ids.map((id) => A(id).control.payStatus), ["pagado", "pendiente"]);
    // Renueva los dos: el pagado se cobra en efectivo; el que sigue en el fiado se renueva fiado y va a la libreta.
    clock.t = A(ids[0]).customerExpiresAt - DAY;
    for (const id of ids) s.orders.renew(owner, id, { paymentMethod: "cash" });
    assert.equal(owed(), 1600 + 1800, "lo que debía + la renovación fiada");
    s.fiado.pay(owner, { customerId: pedro.id, amount: 3400, note: "todo" });
    assert.equal(owed(), 0);
    assert.ok(ids.every((id) => A(id).control.payStatus === "pagado"));
    assert.equal(sum(incomeEvents(E)), 2000 + 1800 + 3400, "entró lo que pagó, ni más ni menos");
    // El mes siguiente le vuelve a fiar uno (lo renueva y lo marca «Pendiente»): la deuda nueva se ve en el Fiado y un
    // pago de otra cosa no la pisa (el cargo viejo ya pagado no vuelve a poner «Pagado»).
    clock.t = A(ids[0]).customerExpiresAt - DAY;
    s.orders.renew(owner, ids[0], { paymentMethod: "cash" });
    s.orders.setControl(owner, ids[0], { payStatus: "pendiente" });
    assert.equal(owed(), 1800, "la renovación fiada se ve");
    s.fiado.charge(owner, { customerId: pedro.id, amount: 500, note: "otra cosa" });
    s.fiado.pay(owner, { customerId: pedro.id, amount: 500, note: "pagó la otra cosa" });
    assert.equal(A(ids[0]).control.payStatus, "pendiente");
    assert.equal(owed(), 1800);
  });
});

describe("mensajes en palabras simples", () => {
  test("al revendedor que renueva con saldo una cuenta que la tienda todavía no renovó: qué hacer, no «renová con el proveedor»", () => {
    const { s, acc, cust } = setup();
    acc(20);
    const rev = cust("Lucho", { kind: "reseller", priceGroupId: "rev" });
    s.wallet.adjust(owner, rev.id, 5000, "recarga");
    const id = s.orders.create(owner, { customerId: rev.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    assert.throws(() => s.orders.renew({ id: "u_r", role: "reseller", customerId: rev.id }, id, { paymentMethod: "balance" }),
      (e) => e.code === "SUPPLIER_EXPIRY_EXCEEDED" && /Escribile a la tienda/.test(e.message) && !/proveedor|reemplazá/.test(e.message));
    assert.equal(s.wallet.balance(rev.id), 5000, "no se le cobró");
  });
});
