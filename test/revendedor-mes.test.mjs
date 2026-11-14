// Revendedores un mes entero sin perder plata ni cuentas (revisión de 3 meses, 14/11/2026). Datos ficticios, reloj
// simulado, nada real. Cubre: un QR para varias renovaciones (y aprobar juntos), renovar varias con saldo, aviso antes
// del corte, aprobar solicitud con tipo y lista, «Pasar a otro» sin deudas falsas ni libretas perdidas, «Me pagó todo»,
// «Mis ganancias» con los alquileres, recargas en «Cómo van», teléfono repetido sin delatar y el independiente que
// renueva sus alquileres. Siempre con la separación entre revendedores.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStore, DomainError, DAY } from "../dist/store/index.js";

const owner = { id: "u_owner", role: "owner" };
const admin = { id: "u_admin", role: "admin" };
const seller = { id: "u_seller", role: "seller" };
const T0 = Date.UTC(2026, 9, 1, 14); // 01/10/2026 10:00 en Bolivia
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));
const R = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  for (const [id, name, price] of [["dis", "Disney+ Premium (alquiler revendedores)", 9000], ["prime", "Prime Video (alquiler revendedores)", 2500], ["hbo", "HBO Max (alquiler revendedores)", 2000]])
    s.catalog.upsertProduct(owner, { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "net", name: "Netflix 1 perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { dis: 6900, prime: 2000, hbo: 1500, net: 2500 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  let n = 0;
  for (const pid of ["dis", "prime", "hbo"]) for (let i = 0; i < 6; i++) s.inventory.addAccount(owner, { productId: pid, supplierId: "andes", email: `${pid}.${++n}@ficticio.lat`, password: "Clave-Ficticia#" + n, supplierExpiresAt: T0 + 200 * DAY, cost: 4000, profiles: [{ label: "Cuenta completa" }] });
  s.inventory.addAccount(owner, { productId: "net", supplierId: "andes", email: "net@ficticio.lat", password: "Clave-Ficticia#net", supplierExpiresAt: T0 + 200 * DAY, cost: 1000, profiles: [1, 2, 3, 4, 5].map((i) => ({ label: `Perfil ${i}` })) });
  const mk = (name, phone, extra = {}) => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev", ...extra });
  const mamani = mk("Carla Mamani", "+59170000001"), mendoza = mk("Carla Mendoza", "+59170000002");
  const sell = (c, pid) => s.orders.create(owner, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash", idempotencyKey: `${c.id}-${pid}-${Math.random()}` }).assignmentIds[0];
  return { s, clock, mamani, mendoza, sell, mk };
}

describe("1 · un QR para varias renovaciones", () => {
  test("el revendedor manda UN comprobante para 3 renovaciones y el dueño las aprueba juntas si la suma coincide", () => {
    const { s, mendoza, mamani, sell } = setup();
    const ids = [sell(mendoza, "dis"), sell(mendoza, "dis"), sell(mendoza, "hbo")];
    const me = R(mendoza);
    const pv = s.rmes.renewPreview(me, ids);
    assert.equal(pv.total, 6900 + 6900 + 1500);
    const r = s.rmes.renewMany(me, { ids, paymentMethod: "qr", idempotencyKey: "k1" });
    assert.equal(r.count, 3);
    assert.equal(r.total, 15300);
    assert.ok(r.orders.every((o) => o.status === "awaiting_payment"));
    s.rmes.evidenceMany(me, r.orders.map((o) => o.id), { fileRef: "a".repeat(32) + ".png", declaredReference: "MEN-153", hash: "h1" });
    const orders = r.orders.map((o) => s.engine.s.orders[o.id]);
    assert.ok(orders.every((o) => o.status === "payment_review" && o.evidence.group.length === 3 && !o.evidence.duplicateOf), "no quedan como comprobante repetido");
    // El dueño los ve como un grupo.
    const g = s.rmes.groups(owner);
    assert.equal(g.length, 1);
    assert.equal(g[0].payerName, "Carla Mendoza");
    assert.equal(g[0].grandTotal, 15300);
    // Otro revendedor no los ve ni los aprueba.
    assert.throws(() => s.rmes.groups(R(mamani)), err("FORBIDDEN"));
    assert.throws(() => s.rmes.approveGroup(R(mamani), { orderIds: orders.map((o) => o.id), confirmedReference: "MEN-153", amount: 15300 }), err("FORBIDDEN"));
    assert.throws(() => s.rmes.approveGroup(seller, { orderIds: orders.map((o) => o.id), confirmedReference: "MEN-153", amount: 15300 }), err("FORBIDDEN"));
    // Suma distinta: no aprueba ninguno.
    assert.throws(() => s.rmes.approveGroup(owner, { orderIds: orders.map((o) => o.id), confirmedReference: "MEN-153", amount: 15000 }), err("VALIDATION", /no coincide/));
    assert.ok(orders.every((o) => s.engine.s.orders[o.id].status === "payment_review"));
    const before = ids.map((id) => s.engine.s.assignments[id].customerExpiresAt);
    const ok = s.rmes.approveGroup(owner, { orderIds: orders.map((o) => o.id), confirmedReference: "MEN-153", amount: 15300, idempotencyKey: "ag1" });
    assert.equal(ok.approved.length, 3);
    ids.forEach((id, i) => assert.equal(s.engine.s.assignments[id].customerExpiresAt, before[i] + 30 * DAY, "cada una +30 días"));
    // La misma referencia no sirve para OTRA persona.
    const other = s.orders.renew(R(mamani), sell(mamani, "hbo"), { paymentMethod: "qr" }).order;
    s.orders.submitEvidence(R(mamani), other.id, { fileRef: "b".repeat(32) + ".png", declaredReference: "MEN-153" });
    assert.throws(() => s.orders.approvePayment(owner, other.id, { confirmedReference: "MEN-153" }), err("ALREADY_PROCESSED"));
  });

  test("lo que pasó en la revisión: 4 pedidos sueltos con el mismo QR, aprobó 1 solo → aprueba los otros 3 juntos con el total", () => {
    const { s, mendoza, sell } = setup();
    const ids = [sell(mendoza, "dis"), sell(mendoza, "dis"), sell(mendoza, "prime"), sell(mendoza, "hbo")];
    const me = R(mendoza);
    const ords = ids.map((id, i) => {
      const o = s.orders.renew(me, id, { paymentMethod: "qr", idempotencyKey: "q" + i }).order;
      s.orders.submitEvidence(me, o.id, { fileRef: "c".repeat(32) + ".png", declaredReference: "MEN-187", hash: "mismo" });
      return o;
    });
    s.orders.approvePayment(owner, ords[0].id, { confirmedReference: "MEN-187" });
    // Uno por uno da 409, pero ahora dice qué hacer.
    assert.throws(() => s.orders.approvePayment(owner, ords[1].id, { confirmedReference: "MEN-187", force: true, forceReason: "un QR por todo" }), err("ALREADY_PROCESSED", /Aprobar juntos/));
    const g = s.rmes.groups(owner);
    assert.equal(g.length, 1);
    assert.equal(g[0].orders.length, 3);
    assert.equal(g[0].prior.length, 1);
    assert.equal(g[0].grandTotal, 6900 + 6900 + 2000 + 1500);
    s.rmes.approveGroup(owner, { orderIds: g[0].orders.map((o) => o.id), confirmedReference: "MEN-187", amount: g[0].grandTotal });
    assert.ok(ords.every((o) => s.engine.s.orders[o.id].status === "fulfilled"), "ninguno quedó pagado sin aprobar");
  });

  test("un comprobante por revisar no deja que se corte la cuenta (no se corta algo pagado)", () => {
    const { s, clock, mendoza, sell } = setup();
    const id = sell(mendoza, "dis");
    clock.t = s.engine.s.assignments[id].customerExpiresAt - DAY;
    const o = s.orders.renew(R(mendoza), id, { paymentMethod: "qr" }).order;
    s.orders.submitEvidence(R(mendoza), o.id, { fileRef: "d".repeat(32) + ".png", declaredReference: "X-1" });
    clock.t += 4 * DAY; // vencido + 2 días de gracia ya pasaron
    s.orders.closeExpired({ id: "system", role: "system" }, 2);
    assert.equal(s.engine.s.assignments[id].status, "active");
    clock.t += 3 * DAY; // pero no para siempre
    s.orders.closeExpired({ id: "system", role: "system" }, 2);
    assert.equal(s.engine.s.assignments[id].status, "revoked");
  });
});

describe("2 y 7 · renovar varias juntas con saldo", () => {
  test("todo o nada, con el total; no toca alquileres de otro", () => {
    const { s, mamani, mendoza, sell } = setup();
    const ids = [sell(mamani, "dis"), sell(mamani, "prime"), sell(mamani, "hbo")];
    s.wallet.adjust(owner, mamani.id, 8000, "prueba");
    const me = R(mamani);
    assert.equal(s.rmes.renewPreview(me, ids).total, 6900 + 2000 + 1500);
    assert.throws(() => s.rmes.renewMany(me, { ids, paymentMethod: "balance" }), err("INSUFFICIENT_BALANCE", /Bs 104\.00/));
    assert.equal(s.wallet.balance(mamani.id), 8000, "no se descontó nada");
    s.wallet.adjust(owner, mamani.id, 4000, "prueba");
    const exp = ids.map((id) => s.engine.s.assignments[id].customerExpiresAt);
    const r = s.rmes.renewMany(me, { ids, paymentMethod: "balance", idempotencyKey: "x" });
    assert.equal(r.total, 10400);
    assert.equal(s.wallet.balance(mamani.id), 1600);
    ids.forEach((id, i) => assert.equal(s.engine.s.assignments[id].customerExpiresAt, exp[i] + 30 * DAY));
    // Repetir la misma orden no cobra dos veces.
    s.rmes.renewMany(me, { ids, paymentMethod: "balance", idempotencyKey: "x" });
    assert.equal(s.wallet.balance(mamani.id), 1600);
    // Un alquiler de Mendoza no se puede meter en la lista.
    const ajeno = sell(mendoza, "dis");
    assert.throws(() => s.rmes.renewPreview(me, [ids[0], ajeno]), err("FORBIDDEN"));
    assert.throws(() => s.rmes.renewMany(me, { ids: [ajeno], paymentMethod: "balance" }), err("FORBIDDEN"));
    assert.throws(() => s.rmes.renewMany(owner, { ids, paymentMethod: "balance" }), err("FORBIDDEN"));
  });
});

describe("3 · aviso antes del corte de sus alquileres", () => {
  test("cartel y aviso al celular 3 días antes y el día del vencimiento, con la fecha del corte", () => {
    const { s, clock, mamani, mendoza, sell } = setup();
    const id = sell(mamani, "dis");
    sell(mendoza, "hbo");
    const exp = s.engine.s.assignments[id].customerExpiresAt;
    clock.t = exp - 10 * DAY;
    assert.equal(s.rmes.rentAlerts(R(mamani)).list.length, 0);
    assert.equal(s.rmes.rentPush(mamani.id), null);
    clock.t = exp - 3 * DAY;
    const a = s.rmes.rentAlerts(R(mamani));
    assert.equal(a.list.length, 1);
    assert.match(a.list[0].text, /^Tu Disney\+ Premium de la tienda vence el \d\d\/\d\d y se corta el \d\d\/\d\d$/);
    assert.equal(a.list[0].cutAt, exp + 2 * DAY);
    assert.equal(a.total, 6900);
    assert.match(s.rmes.rentPush(mamani.id).title, /vence el/);
    clock.t = exp - 2 * DAY;
    assert.equal(s.rmes.rentPush(mamani.id), null, "no todos los días");
    clock.t = exp - 3600_000;
    assert.ok(s.rmes.rentPush(mamani.id), "el día del vencimiento");
    // Solo lo suyo: Mendoza no ve el Disney de Mamani.
    assert.ok(!JSON.stringify(s.rmes.rentAlerts(R(mendoza))).includes(id));
  });
});

describe("4 · aprobar una solicitud con tipo y lista de precios", () => {
  test("viene marcada la lista de los demás; una vacía no se acepta; avisa al vender sin precio de lista", () => {
    const { s, mamani } = setup();
    s.shops.apply({ name: "Ana Nueva", phone: "+59170000006" });
    s.shops.apply({ name: "Beto Nuevo", phone: "+59170000007" });
    const [appA, appB] = Object.values(s.engine.s.resellerApps).sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const opt = s.rmes.approveOptions(owner);
    assert.equal(opt.suggested, "rev");
    assert.ok(opt.groups.find((g) => g.id === "rev").prices > 0);
    assert.throws(() => s.rmes.approveOptions(seller), err("FORBIDDEN"));
    assert.throws(() => s.shops.approve(owner, appA.id, { trust: "trusted", priceGroupId: "revendedor" }), err("VALIDATION", /no tiene precios/));
    const a = s.shops.approve(owner, appA.id, { trust: "trusted" });
    assert.equal(a.priceGroupId, "rev");
    assert.equal(a.trust, "trusted");
    assert.equal(s.engine.s.customers[a.customerId].trust, undefined);
    const b = s.shops.approve(owner, appB.id, {});
    assert.equal(b.priceGroupId, "rev", "sin elegir: la lista de los demás, nunca la vacía");
    assert.equal(b.trust, "independent");
    // Al vender: si su lista no tiene precio para algo, la cotización lo dice.
    s.catalog.upsertProduct(owner, { id: "max", name: "Max (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
    const q = s.orders.quote(owner, { customerId: mamani.id, items: [{ productId: "max", qty: 1 }] });
    assert.deepEqual(q.missingListPrice.map((x) => x.productId), ["max"]);
    assert.equal(s.orders.quote(owner, { customerId: mamani.id, items: [{ productId: "dis", qty: 1 }] }).missingListPrice, undefined);
  });
});

describe("5 · «Pasar a otro»", () => {
  test("la deuda queda del anterior, el Control arranca de cero, la libreta se guarda y vuelve", () => {
    const { s, mk, sell } = setup();
    const luis = mk("Luis Nopaga", "+59170000005"), ana = mk("Ana Nueva", "+59170000006");
    const id = sell(luis, "dis");
    s.orders.setControl(owner, id, { payStatus: "pendiente", price: 6500 });
    const L = R(luis);
    s.subs.save(L, id, { name: "Cliente-de-Luis-1", phone: "72220001", expiresAt: T0 + 20 * DAY, price: 2500, pay: "pagado" });
    s.subs.save(L, id, { name: "Cliente-de-Luis-2", phone: "72220002", expiresAt: T0 + 20 * DAY, price: 2500, pay: "pendiente" });
    const pv = s.rmes.transferPreview(owner, id, ana.id);
    assert.equal(pv.debt, 6500);
    assert.ok(pv.lines.some((l) => /queda en SU fiado/.test(l)) && pv.lines.some((l) => /se guarda/.test(l)));
    assert.throws(() => s.rmes.transferPreview(seller, id, ana.id), err("FORBIDDEN"));
    const t = s.orders.transfer(owner, id, ana.id, "Luis no paga");
    assert.equal(t.transfer.debtToPrevious, 6500);
    const a = s.engine.s.assignments[id];
    assert.equal(a.customerId, ana.id);
    assert.equal(a.control.payStatus, undefined, "Ana no hereda la deuda");
    assert.equal(a.control.price, undefined, "ni el precio acordado con Luis");
    assert.equal(a.subs, undefined);
    assert.equal(s.fiado.owedBy(luis.id), 6500, "Luis sigue debiendo");
    assert.equal(s.fiado.owedBy(ana.id), 0);
    const fo = s.fiado.overview(owner).rows;
    assert.ok(!fo.some((r) => r.customerId === ana.id), "Ana no aparece debiendo en Fiado");
    assert.ok(!JSON.stringify(s.subs.list(R(ana))).includes("Cliente-de-Luis"), "Ana no ve los clientes de Luis");
    // Vuelve a Luis: recupera su libreta y su precio.
    s.orders.transfer(owner, id, luis.id, "volvió");
    const b = s.engine.s.assignments[id];
    assert.deepEqual(b.subs.map((x) => x.name), ["Cliente-de-Luis-1", "Cliente-de-Luis-2"]);
    assert.equal(b.control.price, 6500);
    assert.equal(s.fiado.owedBy(luis.id), 6500, "la deuda no se duplica");
  });

  test("«Fue un error: pasar también el cobro» lleva el pedido y el ingreso a la persona correcta", () => {
    const { s, mamani, mendoza, sell } = setup();
    const id = sell(mamani, "hbo");
    const oid = s.engine.s.assignments[id].orderId;
    s.orders.transfer(owner, id, mendoza.id, "me confundí de Carla", { moveCharge: true });
    assert.equal(s.engine.s.orders[oid].customerId, mendoza.id);
    assert.equal(s.engine.s.orders[oid].payerId, mendoza.id);
    // Con saldo: se le devuelve al equivocado y se descuenta del correcto (si le alcanza).
    s.wallet.adjust(owner, mamani.id, 5000, "prueba");
    const o2 = s.orders.create(R(mamani), { customerId: mamani.id, items: [{ productId: "hbo", qty: 1 }], paymentMethod: "balance", idempotencyKey: "b1" });
    assert.equal(s.wallet.balance(mamani.id), 3500);
    assert.throws(() => s.orders.transfer(owner, o2.assignmentIds[0], mendoza.id, "error", { moveCharge: true }), err("INSUFFICIENT_BALANCE"));
    assert.equal(s.wallet.balance(mamani.id), 3500, "nada cambió");
    s.wallet.adjust(owner, mendoza.id, 2000, "prueba");
    s.orders.transfer(owner, o2.assignmentIds[0], mendoza.id, "error", { moveCharge: true });
    assert.equal(s.wallet.balance(mamani.id), 5000);
    assert.equal(s.wallet.balance(mendoza.id), 500);
  });
});

describe("6 · «Me pagó todo» por revendedor", () => {
  test("muestra lo vencido / por vencer y lo que debe, con la suma, y lo anota todo junto", () => {
    const { s, clock, mamani, mendoza, sell } = setup();
    const a1 = sell(mamani, "dis"), a2 = sell(mamani, "prime"), a3 = sell(mamani, "hbo");
    sell(mendoza, "dis");
    s.orders.setControl(owner, a3, { payStatus: "pendiente" });
    clock.t = T0 + 25 * DAY;
    const d = s.rmes.due(owner, mamani.id);
    assert.equal(d.rows.length, 3);
    assert.deepEqual(d.rows.map((r) => r.action).sort(), ["debt", "renew", "renew"]);
    assert.equal(d.total, 6900 + 2000 + 1500);
    assert.ok(!JSON.stringify(d).includes("Mendoza"), "solo lo de Mamani");
    assert.throws(() => s.rmes.due(seller, mamani.id), err("FORBIDDEN"));
    assert.throws(() => s.rmes.paidAll(owner, mamani.id, { total: 100 }), err("INVALID_STATE", /total cambió/));
    const exp1 = s.engine.s.assignments[a1].customerExpiresAt, exp3 = s.engine.s.assignments[a3].customerExpiresAt;
    const r = s.rmes.paidAll(owner, mamani.id, { total: d.total, idempotencyKey: "pt" });
    assert.equal(r.count, 3);
    assert.equal(s.engine.s.assignments[a1].customerExpiresAt, exp1 + 30 * DAY);
    assert.equal(s.engine.s.assignments[a3].customerExpiresAt, exp3, "la deuda se marca pagada sin regalar días");
    assert.equal(s.engine.s.assignments[a3].control.payStatus, "pagado");
    assert.equal(s.engine.s.assignments[a2].control.payStatus, "pagado");
    // Dos toques: el mismo período no se cobra dos veces.
    assert.equal(s.rmes.due(owner, mamani.id).count, 0);
  });
});

describe("8 · «Mis ganancias» con sus alquileres", () => {
  test("cobra − lo que le cuesta su alquiler = ganancia real", () => {
    const { s, mamani } = setup();
    s.wallet.adjust(owner, mamani.id, 30000, "prueba");
    const me = R(mamani);
    const ids = ["dis", "prime", "prime", "hbo"].map((pid, i) => s.orders.create(me, { customerId: mamani.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "balance", idempotencyKey: "m" + i }).assignmentIds[0]);
    for (const n of ["Rosa", "Juan", "Mery", "Tito"]) s.subs.save(me, ids[0], { name: n, expiresAt: T0 + 30 * DAY, price: 2000, pay: "pagado" });
    const rosa = s.catalog.createCustomer(me, { name: "Rosa Quispe", phone: "+59171110001" });
    const net = s.orders.create(me, { customerId: rosa.id, items: [{ productId: "net", qty: 1 }], paymentMethod: "balance", idempotencyKey: "n" });
    s.rtools.setControl(me, net.assignmentIds[0], { price: 4000, payStatus: "pagado" });
    const g = s.rtools.earnings(me);
    assert.equal(g.month.revenue, 4000);
    assert.equal(g.month.cost, 2500);
    assert.equal(g.rentals.cost, 6900 + 2000 + 2000 + 1500);
    assert.equal(g.rentals.revenue, 8000);
    assert.equal(g.real.profit, 4000 + 8000 - 2500 - 12400, "pierde Bs 29: ahora se ve");
  });
});

describe("10 · teléfono repetido entre revendedores", () => {
  test("cada uno su ficha, sin delatar; el propio sí avisa; el staff sí ve el repetido; entrar con el número va a la original", () => {
    const { s, mamani, mendoza } = setup();
    const c1 = s.catalog.createCustomer(R(mendoza), { name: "Cliente Registrado Mendoza", phone: "+59173330002" });
    const c2 = s.catalog.createCustomer(R(mamani), { name: "Probar", phone: "+59173330002" });
    assert.notEqual(c1.id, c2.id);
    assert.ok(!JSON.stringify(c2).includes("Mendoza"));
    assert.throws(() => s.catalog.createCustomer(R(mamani), { name: "Otra vez", phone: "73330002" }), err("VALIDATION", /^Ya existe un cliente tuyo/));
    assert.throws(() => s.catalog.createCustomer(owner, { name: "x", phone: "+59173330002" }), err("VALIDATION", /Ya existe/));
    // El número de un revendedor tampoco se delata.
    const c3 = s.catalog.createCustomer(R(mamani), { name: "Era Mendoza", phone: "+59170000002" });
    assert.equal(s.catalog.findCustomerByPhone("+59170000002").id, mendoza.id, "entrar con ese número sigue siendo Mendoza");
    assert.equal(s.catalog.findCustomerByPhone("+59173330002").id, c1.id);
    // Cada uno ve solo su ficha.
    assert.ok(!JSON.stringify(s.portal.customers(R(mamani))).includes("Cliente Registrado Mendoza"));
    assert.ok(!JSON.stringify(s.portal.customers(R(mendoza))).includes("Probar"));
    assert.ok(c3.id);
  });
});

describe("11 · independiente renueva sus alquileres de la tienda", () => {
  test("con saldo desde GaboHub si el dueño no se lo apagó; nunca compra stock nuevo", () => {
    const { s, mk, sell } = setup();
    const diego = mk("Diego Rojas", "+59170000003");
    s.catalog.setResellerTrust(owner, diego.id, "independent");
    const id = sell(diego, "dis");
    s.wallet.adjust(owner, diego.id, 10000, "prueba");
    const me = R(diego);
    assert.equal(s.portal.services(me)[0].canRenew, true);
    const exp = s.engine.s.assignments[id].customerExpiresAt;
    s.orders.renew(me, id, { paymentMethod: "balance", idempotencyKey: "d1" });
    assert.equal(s.engine.s.assignments[id].customerExpiresAt, exp + 30 * DAY);
    assert.equal(s.wallet.balance(diego.id), 3100);
    assert.throws(() => s.orders.create(me, { customerId: diego.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "balance" }), err("NOT_FOUND"));
    // El dueño se lo apaga.
    assert.throws(() => s.rmes.setStoreRenew(seller, diego.id, false), err("FORBIDDEN"));
    s.rmes.setStoreRenew(owner, diego.id, false);
    assert.equal(s.portal.services(me)[0].canRenew, false);
    assert.throws(() => s.orders.renew(me, id, { paymentMethod: "balance" }), err("FORBIDDEN", /lo renueva la tienda/));
    s.rmes.setStoreRenew(admin, diego.id, true);
    assert.equal(s.portal.services(me)[0].canRenew, true);
  });
});
