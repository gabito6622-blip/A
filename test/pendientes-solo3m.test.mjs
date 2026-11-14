// Pendientes de la revisión de 3 meses trabajando como Gabriel (16/11/2026). Cada uno con el caso que lo mostró.
// Datos ficticios en memoria, reloj simulado, nada real (los avisos quedan en la bandeja, no salen).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { incomeEvents } from "../dist/store/income.js";

const owner = { id: "u_owner", role: "owner" };
const T0 = Date.UTC(2026, 7, 20, 14); // 20/08/2026 10:00 en Bolivia
const R = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney", kind: "full_account", durationDays: 30, price: 9000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { nf: 2500, dis: 6900 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  let n = 0;
  const acc = (pid = "nf", k = 5, extra = {}) => s.inventory.addAccount(owner, { productId: pid, supplierId: "andes", email: `${pid}${++n}@ficticio.lat`, password: "Clave-Ficticia#" + n, supplierExpiresAt: T0 + 90 * DAY, cost: 4000, profiles: Array.from({ length: k }, (_, i) => ({ label: `Perfil ${i + 1}` })), ...extra }).account;
  const cust = (name, extra = {}) => s.catalog.createCustomer(owner, { name, phone: `+591710${String(++n).padStart(5, "0")}`, whatsappConsent: true, ...extra });
  const sell = (c, pid = "nf") => s.orders.create(owner, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash", idempotencyKey: `${c.id}-${pid}-${++n}` }).assignmentIds[0];
  return { s, E: s.engine, clock, acc, cust, sell };
}

describe("fechas dd/mm siempre con dos cifras", () => {
  test("ningún formateador de día y mes sin año usa «es-BO» (daba «13/1»)", () => {
    const files = [...readdirSync("public").filter((f) => f.endsWith(".js")).map((f) => `public/${f}`), ...readdirSync("src/store").map((f) => `src/store/${f}`), ...readdirSync("src/server").map((f) => `src/server/${f}`)];
    const bad = [];
    for (const f of files) {
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(/"es-BO",\s*\{([^}]*)\}/g)) if (/day: "2-digit"/.test(m[1]) && /month: "2-digit"/.test(m[1]) && !/year|weekday/.test(m[1])) bad.push(`${f}: ${m[0]}`);
    }
    assert.deepEqual(bad, []);
    assert.equal(new Date(Date.UTC(2026, 0, 13, 15)).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }), "13/01");
  });
});

describe("«Ya le avisé» y el recordatorio preparado", () => {
  test("marca el mensaje preparado como enviado: el bot no le manda después uno viejo", () => {
    const { s, E, acc, cust, sell, clock } = setup();
    acc();
    const a = sell(cust("Ana"));
    clock.t = E.s.assignments[a].customerExpiresAt - 2 * DAY;
    assert.equal(s.orders.queueExpiryReminders(owner, 3), 1);
    const msg = E.s.outbox.find((m) => m.id === E.s.assignments[a].reminderMsgId);
    assert.equal(msg.status, "queued");
    s.orders.markNoticed(owner, [a]);
    assert.equal(msg.status, "sent_manually");
    assert.equal(E.s.outbox.filter((m) => m.status === "queued" && m.template === "expiry_reminder").length, 0);
  });
});

describe("cliente dentro de una cuenta caída", () => {
  test("renovar, «+1 período» o anotar el cobro frena con un mensaje claro hasta moverlo", () => {
    const { s, E, acc, cust, sell } = setup();
    const a1 = acc();
    const a = sell(cust("Ana"));
    s.caidas.markFallen(owner, a1.id, "No entra");
    assert.throws(() => s.orders.renew(owner, a, { paymentMethod: "cash" }), (e) => e instanceof DomainError && e.code === "INVALID_STATE" && /está caída: pasalo a otra cuenta en Reubicar/.test(e.message));
    const pv = s.cobro.preview(owner, a);
    assert.equal(pv.ok, false);
    assert.match(pv.blockers[0], /está caída/);
    // Lo movés y ya se puede.
    acc();
    s.caidas.relocate(owner, a, {});
    const exp0 = E.s.assignments[a].customerExpiresAt;
    s.orders.renew(owner, a, { paymentMethod: "cash" });
    assert.equal(E.s.assignments[a].customerExpiresAt, exp0 + 30 * DAY);
  });

  test("«Volvió a funcionar» ofrece liberar sus apartados (y sin pedirlo quedan apartados)", () => {
    const { s, E, acc } = setup();
    const a1 = acc("nf", 3);
    s.caidas.markFallen(owner, a1.id, "No entra");
    const slots = () => Object.values(E.s.slots).filter((x) => x.accountId === a1.id);
    assert.ok(slots().every((x) => x.status === "quarantined"));
    const r = s.caidas.unmarkFallen(owner, a1.id, { release: true });
    assert.equal(r.released, 3);
    assert.ok(slots().every((x) => x.status === "available"));
    s.caidas.markFallen(owner, a1.id, "Otra vez");
    const r2 = s.caidas.unmarkFallen(owner, a1.id);
    assert.equal(r2.released, 0); assert.equal(r2.parked, 3);
  });
});

describe("«Pasar a otro»: el Control y los cobros del anterior", () => {
  test("un pago del anterior en el fiado no vuelve a poner «Pendiente» en el Control del nuevo", () => {
    const { s, E, acc, cust, sell } = setup();
    acc();
    const luis = cust("Luis"), ana = cust("Ana");
    const a = sell(luis);
    s.orders.setControl(owner, a, { payStatus: "pendiente", price: 3500 });
    s.fiado.fromControl(owner, luis.id);
    assert.ok(E.s.fiado.some((x) => x.assignmentId === a && x.customerId === luis.id));
    s.orders.transfer(owner, a, ana.id, "Luis ya no lo quiere");
    s.orders.setControl(owner, a, { payStatus: "pagado", price: 3500 });
    s.fiado.pay(owner, { customerId: luis.id, amount: 1000, note: "pagó una parte" });
    assert.equal(E.s.assignments[a].control.payStatus, "pagado", "Ana sigue «Pagado»");
  });

  test("lo que pagó el anterior sigue a su nombre en Finanzas y «Cómo van», no del nuevo", () => {
    const { s, E, acc, cust, sell, clock } = setup();
    acc();
    const rev1 = s.catalog.createCustomer(owner, { name: "Rev Uno", phone: "+59171999001", kind: "reseller", priceGroupId: "rev" });
    const rev2 = s.catalog.createCustomer(owner, { name: "Rev Dos", phone: "+59171999002", kind: "reseller", priceGroupId: "rev" });
    const a = sell(rev1);
    // El mes siguiente le cobra por el Control (💵 cobrado), sin pedido.
    clock.t += 30 * DAY;
    s.orders.setExpiry(owner, a, E.s.assignments[a].customerExpiresAt + 30 * DAY);
    s.orders.setControl(owner, a, { payStatus: "pendiente" });
    s.orders.setControl(owner, a, { payStatus: "pagado", price: 2500 });
    clock.t += DAY;
    s.orders.transfer(owner, a, rev2.id, "Se lo pasó");
    const ctl = incomeEvents(E).filter((x) => x.source === "control" && x.assignmentId === a);
    assert.equal(ctl.length, 1);
    assert.equal(ctl[0].customerId, rev1.id);
    assert.equal(ctl[0].payerId, rev1.id);
    assert.ok(incomeEvents(E).filter((x) => x.assignmentId === a || x.order?.assignmentIds?.includes(a)).every((x) => x.customerId === rev1.id), "nada del anterior quedó a nombre del nuevo");
  });
});

describe("«Renovar varias» con un QR: un solo aviso por persona", () => {
  test("al revendedor le queda un «registramos tus pedidos», al dueño un «nuevo pago para revisar» y al aprobar un «renovamos»", () => {
    const { s, E, acc, sell } = setup();
    for (let i = 0; i < 3; i++) acc("dis", 1);
    const mendoza = s.catalog.createCustomer(owner, { name: "Carla Mendoza", phone: "+59170000002", kind: "reseller", priceGroupId: "rev", whatsappConsent: true });
    s.orders.updateStaffAlerts(owner, { phone: "+59170000999", payments: true });
    const ids = [sell(mendoza, "dis"), sell(mendoza, "dis"), sell(mendoza, "dis")];
    const box0 = E.s.outbox.length;
    const r = s.rmes.renewMany(R(mendoza), { ids, paymentMethod: "qr", idempotencyKey: "k1" });
    const rec = E.s.outbox.slice(box0).filter((m) => m.template === "order_received");
    assert.equal(rec.length, 1);
    assert.match(rec[0].text, /#ord_\w+, #ord_\w+, #ord_\w+ por Bs 207\.00/);
    const box1 = E.s.outbox.length;
    s.rmes.evidenceMany(R(mendoza), r.orders.map((o) => o.id), { fileRef: "a".repeat(32) + ".png", declaredReference: "MEN-207", hash: "h1" });
    const staff = E.s.outbox.slice(box1).filter((m) => m.template === "staff_payment_review");
    assert.equal(staff.length, 1, "un solo aviso al dueño");
    assert.match(staff[0].text, /por Bs 207\.00/);
    const box2 = E.s.outbox.length;
    s.rmes.approveGroup(owner, { orderIds: r.orders.map((o) => o.id), confirmedReference: "MEN-207", amount: 20700 });
    const ren = E.s.outbox.slice(box2).filter((m) => m.template === "renewal_confirmed" && m.customerId === mendoza.id);
    assert.equal(ren.length, 1);
    assert.match(ren[0].text, /renovamos Disney/);
  });
});

describe("Mi secretaria con el día de Bolivia", () => {
  test("a las 21:00 de La Paz (01:00 UTC del día siguiente) lo que vence mañana dice «mañana», no «hoy»", () => {
    const { s, E, acc, cust, sell, clock } = setup();
    acc();
    const a = sell(cust("Ana"));
    // Vence el 25/08 a las 23:59 de Bolivia; ahora es el 24/08 a las 21:00 de Bolivia.
    E.s.assignments[a].customerExpiresAt = Date.UTC(2026, 7, 26, 3, 59);
    clock.t = Date.UTC(2026, 7, 25, 1, 0);
    const rep = s.stats.secretary(owner);
    const item = rep.avisar.flatMap((g) => g.items).find((x) => x.assignmentId === a);
    assert.equal(item.days, 1);
  });
});
