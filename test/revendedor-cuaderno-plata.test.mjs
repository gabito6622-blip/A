// Plata del cuaderno del revendedor de confianza (revisión de 3 meses, 14/11/2026). Datos ficticios, reloj controlado,
// carpetas temporales, nada real. Cubre lo que pedía la revisión:
//  1. Pago parcial: «Me pagó» es CUÁNTO te pagó; si es menos queda «Debe Bs X» y el precio no cambia (perfil y cliente registrado).
//  2. Deudas por período: un perfil vencido y sin renovar es deuda; se acumula; a los 30 días no desaparece; «Te deben»,
//     Quién me debe y «Cobrar hoy» dan el mismo número y la misma lista.
//  3. Corte del alquiler: el cuaderno queda, «Pasar a mi cuenta nueva» lleva fecha, precio y deuda; si el dueño reactiva, vuelve.
//  4. Ganancia real: cobros reales del mes − alquileres por los días que cubren (renovar temprano no castiga) + cierre de mes.
//  6. «Me pagó» de un toque con «Deshacer».
//  Separación: otro revendedor no ve, no cobra, no deshace ni mueve nada ajeno; el dueño no entra a /api/me.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStore, DomainError } from "../dist/store/index.js";

const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" };
const system = { id: "system", role: "system" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const T0 = Date.UTC(2026, 7, 1, 14); // 01/08/2026 10:00 en Bolivia

function world() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  const at = (t) => { clock.t = t; };
  s.catalog.upsertProduct(owner, { id: "hbo", name: "HBO Max (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 2000, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "net", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { hbo: 1500, net: 2500 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
  for (let i = 0; i < 4; i++) s.inventory.addAccount(owner, { productId: "hbo", supplierId: "prov", email: `hbo${i}@ficticio.lat`, password: "Clave#Ficticia1", supplierExpiresAt: T0 + 300 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
  s.inventory.addAccount(owner, { productId: "net", supplierId: "prov", email: "net@ficticio.lat", password: "Clave#Ficticia2", supplierExpiresAt: T0 + 300 * DAY, cost: 1000, profiles: [1, 2, 3].map((i) => ({ label: `Perfil ${i}` })) });
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" }); s.wallet.adjust(owner, c.id, 50000, "prueba"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const beto = mk("Beto Mamani", "+59170100002"), zulma = mk("Zulma Otra", "+59170100003");
  const rent = (R, pid = "hbo") => s.orders.create(R.A, { customerId: R.c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "balance", idempotencyKey: Math.random() + "" }).assignmentIds[0];
  return { s, clock, at, beto, zulma, rent };
}

describe("cuaderno del revendedor · plata", () => {
  test("1 · pago parcial en un perfil: queda «Debe Bs 5» y el precio sigue en Bs 15; después paga lo que falta", () => {
    const { s, at, beto, rent } = world();
    const aid = rent(beto);
    const marco = s.subs.save(beto.A, aid, { name: "Marco Ríos", phone: "72200007", expiresAt: T0 + 30 * DAY, price: 1500, pay: "pendiente" }).sub;
    at(T0 + 24 * DAY);
    const id = `${aid}|${marco.id}`;
    const r = s.rtools.dayPay(beto.A, id, { amount: 1000, idempotencyKey: "p1" });
    assert.deepEqual([r.paid, r.left], [1000, 500]);
    const sub = () => s.engine.s.assignments[aid].subs.find((x) => x.id === marco.id);
    assert.equal(sub().price, 1500, "el precio NO cambia (antes quedaba en Bs 10)");
    assert.equal(sub().pay, "pendiente");
    const v = s.subs.list(beto.A)[0].subs[0];
    assert.equal(v.owed, 500);
    assert.equal(s.cuaderno.debts(beto.A).total, 500);
    // Misma llave: no cobra dos veces.
    s.rtools.dayPay(beto.A, id, { amount: 1000, idempotencyKey: "p1" });
    assert.equal(s.cuaderno.debts(beto.A).total, 500);
    // Paga lo que falta: al día, sin mover la fecha (todavía no vence).
    s.rtools.dayPay(beto.A, id, { amount: 500 });
    assert.deepEqual([sub().pay, sub().expiresAt, s.cuaderno.debts(beto.A).total], ["pagado", T0 + 30 * DAY, 0]);
    // Cobros reales anotados: 10 + 5 (Bs 15), no el precio dos veces.
    assert.equal(s.engine.s.rcobros.filter((c) => c.subId === marco.id).reduce((t, c) => t + c.amount, 0), 1500);
    assert.throws(() => s.rtools.dayPay(beto.A, id, { amount: 0 }), err("VALIDATION"));
  });

  test("1b · pago parcial de un cliente registrado: no queda pagado; la libreta dice cuánto falta", () => {
    const { s, beto } = world();
    const pedro = s.catalog.createCustomer(beto.A, { name: "Pedro Arce", phone: "+59172200010" });
    const o = s.orders.create(beto.A, { customerId: pedro.id, items: [{ productId: "net", qty: 1 }], paymentMethod: "balance" });
    const aid = o.assignmentIds[0];
    s.rtools.setControl(beto.A, aid, { price: 3500 });
    const r = s.rtools.dayPay(beto.A, aid, { amount: 2000 });
    assert.equal(r.left, 1500);
    assert.equal(s.engine.s.assignments[aid].rcontrol.payStatus, "pendiente", "no se marca pagado completo");
    assert.equal(s.engine.s.assignments[aid].rcontrol.price, 3500, "el precio no cambia");
    assert.equal(s.fiado.overview(beto.A).totals.owed, 1500);
    const d = s.cuaderno.debts(beto.A);
    assert.deepEqual([d.total, d.items[0].kind, d.items[0].client], [1500, "fiado", "Pedro Arce"]);
    // «Me pagó» de la deuda desde Mi día: queda al día y el Control vuelve a «Pagado».
    s.rtools.dayPay(beto.A, `f|${pedro.id}`, {});
    assert.equal(s.cuaderno.debts(beto.A).total, 0);
    assert.equal(s.engine.s.assignments[aid].rcontrol.payStatus, "pagado");
  });

  test("2 · vencido y sin renovar = deuda por período; se acumula; a los 30 días sigue; las 3 pantallas dan lo mismo", () => {
    const { s, at, beto, rent } = world();
    const aid = rent(beto);
    const ana = s.subs.save(beto.A, aid, { name: "Ana Lima", phone: "72200003", expiresAt: T0 + 30 * DAY, price: 2500, pay: "pagado" }).sub;
    s.subs.save(beto.A, aid, { name: "Ana María Lima", phone: "72200004", expiresAt: T0 + 30 * DAY, price: 2500, pay: "pagado" });
    // Se renueva su alquiler para que la cuenta siga andando todo el tiempo.
    for (let i = 0; i < 3; i++) s.orders.renew(beto.A, aid, { paymentMethod: "balance", periods: 1 });
    at(T0 + 29 * DAY);
    assert.equal(s.cuaderno.debts(beto.A).total, 0, "todavía no venció");
    at(T0 + 31 * DAY);
    const check = (want) => {
      const d = s.cuaderno.debts(beto.A), dia = s.rtools.day(beto.A), sm = s.subs.summary(beto.A);
      assert.equal(d.total, want); assert.equal(dia.totals.cobrar, want); assert.equal(sm.owed, want);
      assert.deepEqual(dia.cobrar.flatMap((g) => g.items.map((x) => x.id)).sort(), d.items.map((x) => x.id).sort(), "la misma lista");
      return d;
    };
    check(5000);
    at(T0 + 61 * DAY);
    const d = check(10000);
    assert.equal(d.items.find((x) => x.subId === ana.id).periods.length, 2, "dos meses sin renovar");
    at(T0 + 75 * DAY); // 45 días después del vencimiento: no se va de «Cobrar hoy»
    check(10000);
    // Paga un solo mes: queda debiendo el otro; la fecha corre un período desde el vencimiento (sin días gratis).
    s.rtools.dayPay(beto.A, `${aid}|${ana.id}`, { amount: 2500 });
    const a2 = s.engine.s.assignments[aid].subs.find((x) => x.id === ana.id);
    assert.equal(a2.expiresAt, T0 + 60 * DAY);
    check(7500);
    // Quitarlo del cuaderno: ya no cuenta (avisado en la pantalla).
    s.subs.remove(beto.A, aid, ana.id);
    check(5000);
  });

  test("2b · «Renovó y me paga después» suma un período debiendo; «Pendiente» en el formulario descuenta lo cobrado", () => {
    const { s, at, beto, rent } = world();
    const aid = rent(beto);
    const x = s.subs.save(beto.A, aid, { name: "Luis Soto", expiresAt: T0 + 3 * DAY, price: 1500, pay: "pagado" }).sub;
    const cobros = () => s.engine.s.rcobros.filter((c) => c.subId === x.id).reduce((t, c) => t + c.amount, 0);
    assert.equal(cobros(), 1500, "anotado pagado = cobrado");
    s.subs.renew(beto.A, aid, x.id, false);
    assert.equal(s.cuaderno.debts(beto.A).total, 1500);
    s.subs.renew(beto.A, aid, x.id, true);
    assert.equal(s.cuaderno.debts(beto.A).total, 1500, "el período de antes sigue debiendo");
    assert.equal(cobros(), 3000);
    const cur = s.engine.s.assignments[aid].subs[0];
    s.subs.save(beto.A, aid, { id: x.id, name: cur.name, expiresAt: cur.expiresAt, price: 1500, pay: "pagado" });
    assert.equal(s.cuaderno.debts(beto.A).total, 0); assert.equal(cobros(), 4500);
    at(T0 + 5 * DAY);
    const cur2 = s.engine.s.assignments[aid].subs[0];
    s.subs.save(beto.A, aid, { id: x.id, name: cur2.name, expiresAt: cur2.expiresAt, price: 1500, pay: "pendiente" });
    assert.equal(s.cuaderno.debts(beto.A).total, 1500);
    assert.equal(cobros(), 3000, "lo marcado por error se descuenta");
  });

  test("6 · «Me pagó» de un toque se puede deshacer unos minutos (y no si el perfil cambió)", () => {
    const { s, at, beto, rent } = world();
    const aid = rent(beto);
    const r1 = s.subs.save(beto.A, aid, { name: "Rosa Quispe", expiresAt: T0 + 2 * DAY, price: 2500, pay: "pagado" }).sub;
    const before = structuredClone(s.engine.s.assignments[aid].subs[0]);
    const p = s.subs.pay(beto.A, aid, r1.id); // vence en 2 días: paga el próximo período
    assert.equal(p.paid, 2500); assert.equal(p.to, T0 + 32 * DAY);
    s.cuaderno.undo(beto.A, p.cobroId);
    assert.deepEqual(s.engine.s.assignments[aid].subs[0], before, "vuelve como estaba");
    assert.ok(!s.engine.s.rcobros.some((c) => c.id === p.cobroId));
    const p2 = s.subs.pay(beto.A, aid, r1.id);
    s.subs.save(beto.A, aid, { id: r1.id, name: "Rosa Q.", expiresAt: T0 + 32 * DAY, price: 2500, pay: "pagado" });
    assert.throws(() => s.cuaderno.undo(beto.A, p2.cobroId), err("VALIDATION"), "cambió después: a mano");
    const p3 = s.subs.pay(beto.A, aid, r1.id, 2500);
    at(T0 + 2 * HOUR);
    assert.throws(() => s.cuaderno.undo(beto.A, p3.cobroId), err("VALIDATION"), "pasó la media hora");
  });

  test("3 · se corta el alquiler: el cuaderno queda con lo que debían; «Pasar a mi cuenta nueva»; si el dueño reactiva, vuelve", () => {
    const { s, at, beto, rent } = world();
    const old = rent(beto);
    const nina = s.subs.save(beto.A, old, { name: "Nina Vela", expiresAt: T0 + 30 * DAY, price: 1500, pay: "pagado" }).sub;
    s.subs.save(beto.A, old, { name: "Óscar Vela", phone: "72200009", expiresAt: T0 + 40 * DAY, price: 1500, pay: "pendiente" });
    at(T0 + 33 * DAY); // el alquiler venció el 31/08 y se corta a los 2 días
    s.orders.closeExpired(system, 2);
    assert.equal(s.engine.s.assignments[old].status, "revoked");
    assert.equal(s.subs.list(beto.A).length, 0);
    const cuts = s.cuaderno.cuts(beto.A);
    assert.equal(cuts.length, 1);
    assert.deepEqual(cuts[0].clients.map((c) => c.name), ["Nina Vela", "Óscar Vela"]);
    assert.deepEqual(cuts[0].targets, [], "todavía no tiene otra HBO");
    // Lo que debían hasta el corte sigue en «Te deben» (Nina: el período del 31/08; Óscar: el suyo).
    assert.equal(s.cuaderno.debts(beto.A).total, 3000);
    at(T0 + 50 * DAY);
    assert.equal(s.cuaderno.debts(beto.A).total, 3000, "sin servicio no se suma deuda nueva");
    // Compra otra HBO y los pasa: fecha + días sin servicio, precio y deuda.
    at(T0 + 35 * DAY);
    const neu = rent(beto);
    assert.deepEqual(s.cuaderno.cuts(beto.A)[0].targets.map((t) => t.assignmentId), [neu]);
    const mv = s.cuaderno.moveCut(beto.A, old, neu);
    assert.deepEqual([mv.moved, mv.gapDays], [2, 2]);
    const moved = s.engine.s.assignments[neu].subs;
    assert.deepEqual(moved.map((x) => [x.name, x.price]), [["Nina Vela", 1500], ["Óscar Vela", 1500]]);
    assert.equal(moved[0].expiresAt, T0 + 60 * DAY + 2 * DAY, "el período del corte quedó debiendo y se suman los 2 días sin servicio");
    assert.equal(s.cuaderno.debts(beto.A).total, 3000, "la deuda viaja con ellos");
    assert.equal(s.cuaderno.cuts(beto.A).length, 0);
    assert.ok(!s.engine.s.assignments[old].subs);
    // Otro corte, y esta vez el dueño reactiva el mismo alquiler: el cuaderno vuelve solo.
    const third = rent(beto);
    s.subs.save(beto.A, third, { name: "Luisa Soto", expiresAt: T0 + 70 * DAY, price: 1500, pay: "pagado" });
    at(T0 + 35 * DAY + 33 * DAY);
    s.orders.closeExpired(system, 2);
    assert.ok(s.cuaderno.cuts(beto.A).some((c) => c.assignmentId === third));
    s.dia.reactivate(owner, third, { idempotencyKey: "re1" });
    assert.ok(s.subs.list(beto.A).find((r) => r.assignmentId === third)?.subs.some((x) => x.name === "Luisa Soto"), "volvió con la cuenta");
    assert.ok(!s.cuaderno.cuts(beto.A).some((c) => c.assignmentId === third));
    void nina;
  });

  test("4 · ganancia real: cobros del mes − alquileres por los días que cubren; renovar temprano no castiga; cierre de mes", () => {
    const { s, at, beto, rent } = world();
    const aid = rent(beto); // 01/08: cubre 01/08 → 31/08 (Bs 15)
    s.subs.save(beto.A, aid, { name: "Nina Vela", expiresAt: T0 + 30 * DAY, price: 1500, pay: "pagado" });
    s.subs.save(beto.A, aid, { name: "Óscar Vela", expiresAt: T0 + 30 * DAY, price: 1500, pay: "pendiente" });
    at(T0 + 27 * DAY); // 28/08: renueva temprano su alquiler (cubre 31/08 → 30/09)
    s.orders.renew(beto.A, aid, { paymentMethod: "balance", periods: 1 });
    const g = s.rtools.earnings(beto.A);
    assert.equal(g.real.cobrosPerfiles, 1500, "solo lo que de verdad le pagaron (Óscar debe)");
    // Agosto: el primer pago entero + las 14 horas del 31/08 que cubre la renovación (1500 × 14/720 ≈ 29).
    assert.equal(g.real.alquileres, 1500 + 29, "la renovación temprana casi no pesa en agosto");
    assert.equal(g.real.profit, 1500 - 1529);
    assert.equal(g.rentals.owed, 1500);
    // Septiembre: el resto de la renovación (29 días) y lo que cobre ese mes.
    at(T0 + 35 * DAY);
    s.rtools.dayPay(beto.A, s.rtools.day(beto.A).cobrar.flatMap((x) => x.items).find((x) => x.client === "Óscar Vela").id, {});
    const g9 = s.rtools.earnings(beto.A);
    assert.equal(g9.real.alquileres, 1471);
    assert.ok(g9.real.cobrosPerfiles >= 1500);
    // Cierre de mes: agosto queda guardado y no cambia aunque después se corrija algo.
    assert.equal(s.cuaderno.closeMonths(system), 1);
    assert.equal(s.cuaderno.closeMonths(system), 0, "un mes cerrado no se vuelve a tocar");
    const aug = s.engine.s.rcierres[beto.c.id]["2026-08"];
    assert.deepEqual([aug.cobros, aug.alquileres, aug.ganancia, aug.perfiles], [1500, 1529, -29, 2]);
    const h = s.rtools.earnings(beto.A).history;
    assert.deepEqual(h.map((m) => [m.key, m.closed]), [["2026-09", false], ["2026-08", true]]);
    assert.equal(s.cuaderno.closeMonths(beto.A), 0, "solo la tarea del sistema cierra meses");
  });

  test("separación: otro revendedor no ve, no cobra, no deshace ni mueve nada ajeno", () => {
    const { s, at, beto, zulma, rent } = world();
    const aid = rent(beto);
    const x = s.subs.save(beto.A, aid, { name: "Juan Pérez", phone: "72200001", expiresAt: T0 + 1 * DAY, price: 2500, pay: "pendiente" }).sub;
    const p = s.subs.pay(beto.A, aid, x.id, 1000);
    assert.throws(() => s.subs.pay(zulma.A, aid, x.id, 100), err("FORBIDDEN"));
    assert.throws(() => s.rtools.dayPay(zulma.A, `${aid}|${x.id}`, { amount: 100 }), err("NOT_FOUND"));
    assert.throws(() => s.rtools.dayPreview(zulma.A, `${aid}|${x.id}`), err("NOT_FOUND"));
    assert.throws(() => s.cuaderno.undo(zulma.A, p.cobroId), err("NOT_FOUND"));
    const zAid = rent(zulma);
    assert.throws(() => s.cuaderno.moveCut(zulma.A, aid, zAid), err("FORBIDDEN"));
    assert.throws(() => s.cuaderno.dropCut(zulma.A, aid), err("FORBIDDEN"));
    at(T0 + 40 * DAY); s.orders.closeExpired(system, 2);
    assert.equal(s.engine.s.assignments[aid].status, "revoked");
    assert.throws(() => s.cuaderno.moveCut(zulma.A, aid, zAid), err("FORBIDDEN"), "ni siquiera con su propia cuenta de destino");
    const seen = JSON.stringify([s.cuaderno.debts(zulma.A), s.cuaderno.cuts(zulma.A), s.rtools.day(zulma.A), s.rtools.earnings(zulma.A), s.subs.list(zulma.A)]);
    for (const w of ["Juan", "Beto", "72200001", "@ficticio"]) assert.ok(!seen.includes(w), `Zulma ve «${w}»`);
    assert.throws(() => s.cuaderno.debts(owner), err("FORBIDDEN"));
    assert.throws(() => s.cuaderno.cuts(owner), err("FORBIDDEN"));
  });
});
