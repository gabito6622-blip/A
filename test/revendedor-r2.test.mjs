// R2 (revisión de 3 meses, 14/11/2026): que el revendedor que alquila cuentas a la tienda se entere SIEMPRE cuando algo
// le pasa a sus cuentas, renueve sin trabarse ni pagar dos veces, y que a sus clientes no se los corte cuando él quiso
// pagar. Datos ficticios, reloj simulado, nada real. Siempre con la separación entre revendedores.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createStore, DomainError, DAY } from "../dist/store/index.js";

const owner = { id: "u_owner", role: "owner" };
const admin = { id: "u_admin", role: "admin" };
const seller = { id: "u_seller", role: "seller" };
const system = { id: "system", role: "system" };
const T0 = Date.UTC(2026, 9, 1, 14); // 01/10/2026 10:00 en Bolivia
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));
const R = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });
const C = (c) => ({ id: "u_" + c.id, role: "customer", customerId: c.id });

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  for (const [id, name, price] of [["dis", "Disney+ Premium (alquiler revendedores)", 9000], ["hbo", "HBO Max (alquiler revendedores)", 2000]])
    s.catalog.upsertProduct(owner, { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "net", name: "Netflix 1 perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { dis: 6900, hbo: 1500, net: 2500 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  let n = 0;
  for (const pid of ["dis", "hbo"]) for (let i = 0; i < 4; i++) s.inventory.addAccount(owner, { productId: pid, supplierId: "andes", email: `${pid}.${++n}@ficticio.lat`, password: "Clave-Ficticia#" + n, supplierExpiresAt: T0 + 200 * DAY, cost: 4000, profiles: [{ label: "Cuenta completa" }] });
  for (let i = 1; i <= 2; i++) s.inventory.addAccount(owner, { productId: "net", supplierId: "andes", email: `net.${i}@ficticio.lat`, password: "Clave-Net#" + i, supplierExpiresAt: T0 + 200 * DAY, cost: 1000, profiles: [1, 2, 3].map((k) => ({ label: `Perfil ${k}`, pin: `10${i}${k}` })) });
  const mk = (name, phone) => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" });
  const marta = mk("Marta Choque", "+59170100001"), beto = mk("Beto Mamani", "+59170100002");
  const sell = (c, pid) => s.orders.create(owner, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash", idempotencyKey: `${c.id}-${pid}-${Math.random()}` }).assignmentIds[0];
  const accOf = (aid) => s.engine.s.accounts[s.engine.s.slots[s.engine.s.assignments[aid].slotId].accountId];
  return { s, clock, marta, beto, sell, accOf };
}

describe("1 · cambio de clave o de correo hecho por la tienda", () => {
  test("cuenta como cambio de cuenta: aviso con la clave nueva, mensaje por cliente y aviso al celular; solo lo suyo", () => {
    const { s, clock, marta, beto, sell, accOf } = setup();
    const hbo = sell(marta, "hbo");
    s.subs.save(R(marta), hbo, { name: "Nina Vela", phone: "+59172200001", label: "Perfil 1", expiresAt: T0 + 25 * DAY, price: 1500, pay: "pagado" });
    s.subs.save(R(marta), hbo, { name: "Óscar Vela", phone: "+59172200002", label: "Perfil 2", expiresAt: T0 + 25 * DAY, price: 1500, pay: "pagado" });
    const bHbo = sell(beto, "hbo");
    assert.deepEqual(s.caidas.changes(R(marta)), []);
    clock.t += DAY;
    s.inventario.rotatePassword(owner, accOf(hbo).id, "Clave-Nueva#77");
    const ch = s.caidas.changes(R(marta));
    assert.equal(ch.length, 1);
    assert.equal(ch[0].kind, "password");
    assert.equal(ch[0].title, "Cambió la clave de tu HBO Max: avisá a tus 2 clientes");
    assert.ok(!JSON.stringify(ch).includes("Clave-Nueva"), "el aviso no lleva la clave: GaboHub la toma de «Mis cuentas»");
    assert.equal(s.portal.services(R(marta)).find((x) => x.assignmentId === hbo).access.password, "Clave-Nueva#77");
    assert.equal(ch[0].clients.length, 2);
    // Beto no ve nada de Marta, y su HBO no cambió.
    assert.deepEqual(s.caidas.changes(R(beto)), []);
    assert.ok(!JSON.stringify(s.caidas.changes(R(beto))).includes("Clave-Nueva"));
    assert.throws(() => s.caidas.changeSeen(R(beto), hbo), err("NOT_FOUND"));
    // Aviso al celular: una vez por cambio (el servidor guarda hasta cuándo avisó).
    const p = s.rsin.changePush(marta.id, T0);
    assert.match(p.title, /Cambió la clave de tu HBO Max: avisá a tus 2 clientes/);
    assert.ok(!p.body.includes("Clave-Nueva"), "el aviso al celular no lleva la clave");
    assert.equal(s.rsin.changePush(marta.id, p.at), null);
    assert.equal(s.rsin.changePush(beto.id, T0), null);
    // «Ya les avisé» lo saca hasta el próximo cambio; cambiar el correo lo vuelve a mostrar como «correo».
    s.caidas.changeSeen(R(marta), hbo);
    assert.deepEqual(s.caidas.changes(R(marta)), []);
    clock.t += DAY;
    s.inventory.updateAccount(owner, accOf(hbo).id, { email: "hbo.nuevo@ficticio.lat" });
    const ch2 = s.caidas.changes(R(marta));
    assert.equal(ch2[0].kind, "email");
    assert.equal(ch2[0].title, "Cambió el correo de tu HBO Max: avisá a tus 2 clientes");
    assert.equal(ch2[0].email, "hbo.nuevo@ficticio.lat");
    clock.t += DAY;
    s.inventory.updateAccount(owner, accOf(hbo).id, { email: "hbo.otro@ficticio.lat", password: "Otra-Clave#1" });
    assert.match(s.caidas.changes(R(marta))[0].title, /^Cambiaron los datos de tu HBO Max/);
    assert.ok(bHbo);
  });

  test("el servicio de un CLIENTE del revendedor que la tienda cambió de cuenta también le avisa (y la falla trae los datos nuevos)", () => {
    const { s, clock, marta, beto, accOf } = setup();
    const diego = s.catalog.createCustomer(R(marta), { name: "Diego Mamani", phone: "+59176661001" });
    s.wallet.adjust(owner, marta.id, 10000, "prueba");
    const net = s.orders.create(R(marta), { customerId: diego.id, items: [{ productId: "net", qty: 1 }], paymentMethod: "balance", idempotencyKey: "dn" }).assignmentIds[0];
    const t = s.tickets.report(R(marta), { assignmentId: net, kind: "no_entra" });
    clock.t += 3600_000;
    const old = accOf(net).id;
    s.orders.replace(owner, net, { reason: "no entra", otherAccount: true });
    assert.notEqual(accOf(net).id, old);
    s.tickets.setStatus(owner, t.id, { status: "solucionado", reply: "Te cambiamos a otra cuenta" });
    const mine = s.tickets.mine(R(marta)).find((x) => x.id === t.id);
    assert.equal(mine.accessChanged, true, "«Avisar a mi cliente» sabe que tiene que llevar los datos nuevos");
    assert.ok(!JSON.stringify(mine).includes(accOf(net).password), "la falla no lleva la clave: la toma de «Mis cuentas»");
    const svc = s.portal.services(R(marta)).find((x) => x.assignmentId === net);
    assert.equal(svc.access.email, accOf(net).email);
    assert.ok(svc.access.profile && svc.access.pin);
    assert.equal(s.tickets.list(owner).find((x) => x.id === t.id).accessChanged, undefined);
    const ch = s.caidas.changes(R(marta));
    assert.equal(ch.length, 1);
    assert.equal(ch[0].forClient, "Diego Mamani");
    assert.equal(ch[0].title, "Cambió la cuenta de el Netflix 1 perfil de Diego: avisá a tu cliente");
    assert.equal(ch[0].clients[0].phone, "+59176661001");
    assert.deepEqual(s.caidas.changes(R(beto)), [], "Beto no ve al cliente de Marta");
    assert.ok(!JSON.stringify(s.tickets.mine(R(beto))).includes("Diego"));
  });
});

describe("2 · cuenta caída o movida", () => {
  test("caída y después movida: el aviso cambia de «se cayó» a «cambió la cuenta» con los datos nuevos", () => {
    const { s, clock, marta, sell, accOf } = setup();
    const dis = sell(marta, "dis");
    s.subs.save(R(marta), dis, { name: "Rosa Quispe", phone: "+59171200001", label: "Perfil 1", expiresAt: T0 + 25 * DAY, price: 2500, pay: "pagado" });
    const acc = accOf(dis);
    clock.t += DAY;
    s.caidas.markFallen(owner, acc.id, "pide código");
    const f = s.caidas.changes(R(marta));
    assert.equal(f[0].kind, "fallen");
    assert.equal(f[0].title, "Se cayó tu Disney+ Premium: avisá a tus 1 cliente");
    assert.equal(f[0].email, acc.email);
    clock.t += DAY;
    s.caidas.down(owner, acc.id, "cambio");
    const m = s.caidas.changes(R(marta));
    assert.equal(m[0].kind, "moved");
    assert.equal(m[0].email, accOf(dis).email);
    assert.notEqual(m[0].email, acc.email);
    assert.ok(s.rsin.changePush(marta.id, T0));
  });
});

describe("3 · aviso el día del corte", () => {
  test("push y cartel «Hoy se corta tu HBO» además de 3 días antes y el día del vencimiento", () => {
    const { s, clock, marta, sell } = setup();
    const hbo = sell(marta, "hbo");
    const exp = s.engine.s.assignments[hbo].customerExpiresAt;
    clock.t = exp - 3 * DAY; assert.ok(s.rmes.rentPush(marta.id));
    clock.t = exp; assert.ok(s.rmes.rentPush(marta.id));
    clock.t = exp + DAY; assert.equal(s.rmes.rentPush(marta.id), null);
    clock.t = exp + 2 * DAY - 3600_000; // el día del corte, antes de la hora del corte
    const p = s.rmes.rentPush(marta.id);
    assert.equal(p.title, "✂️ Hoy se corta tu HBO Max de la tienda");
    const al = s.rmes.rentAlerts(R(marta));
    assert.match(al.list[0].text, /^✂️ Hoy se corta tu HBO Max de la tienda/);
    assert.equal(al.list[0].cutDaysLeft, 0);
  });
});

describe("4 · no pagar dos veces y renovaciones esperando pago", () => {
  test("con un QR esperando pago no se crea otra (ni por saldo); cancelar y pagar con saldo sí; vence a los 3 días", () => {
    const { s, clock, marta, beto, sell } = setup();
    const dis = sell(marta, "dis"), hbo = sell(marta, "hbo");
    s.wallet.adjust(owner, marta.id, 20000, "prueba");
    const me = R(marta);
    const q = s.orders.renew(me, dis, { paymentMethod: "qr" }).order;
    assert.throws(() => s.orders.renew(me, dis, { paymentMethod: "qr" }), err("PENDING_RENEWAL", /esperando pago/));
    assert.throws(() => s.orders.renew(me, dis, { paymentMethod: "balance" }), err("PENDING_RENEWAL", /¿Lo cancelo y pagás con saldo\?/));
    assert.throws(() => s.rmes.renewMany(me, { ids: [dis, hbo], paymentMethod: "qr" }), err("VALIDATION", /esperando pago/));
    const pv = s.rmes.renewPreview(me, [dis, hbo]);
    assert.equal(pv.rows.find((r) => r.assignmentId === dis).pendingOrderId, q.id);
    assert.equal(pv.total, 1500, "el total no cuenta la que ya espera pago");
    // Otro revendedor no se entera del pedido de Marta (le dice que no es suyo, no que hay un pedido).
    assert.throws(() => s.orders.renew(R(beto), dis, { paymentMethod: "balance" }), err("FORBIDDEN"));
    // El cartel lo marca y no lo suma.
    clock.t = s.engine.s.assignments[dis].customerExpiresAt - DAY;
    const al = s.rmes.rentAlerts(me);
    const row = al.list.find((x) => x.assignmentId === dis);
    assert.equal(row.pendingOrderId, q.id);
    assert.equal(row.canRenew, false);
    assert.deepEqual(al.pending.map((x) => [x.id, x.product, x.email]), [[q.id, "Disney+ Premium", s.engine.s.accounts[s.engine.s.slots[s.engine.s.assignments[dis].slotId].accountId].email]]);
    // «¿Lo cancelo y pago con saldo?»: cancela y renueva con saldo; una sola renovación cobrada.
    s.orders.cancel(me, q.id);
    const exp = s.engine.s.assignments[dis].customerExpiresAt;
    s.orders.renew(me, dis, { paymentMethod: "balance" });
    assert.equal(s.engine.s.assignments[dis].customerExpiresAt, exp + 30 * DAY);
    assert.equal(s.wallet.balance(marta.id), 20000 - 6900);
    // El dueño sí puede anotar a mano (efectivo) aunque haya un QR esperando.
    const q2 = s.orders.renew(me, hbo, { paymentMethod: "qr" }).order;
    assert.doesNotThrow(() => s.orders.renew(owner, hbo, { paymentMethod: "cash", confirmOther: true }));
    // Un QR sin comprobante vence a los 3 días y se puede renovar de nuevo.
    const q3 = s.orders.renew(R(beto), sell(beto, "dis"), { paymentMethod: "qr" }).order;
    clock.t = q3.createdAt + 3 * DAY - 60_000; s.orders.expireReservations(system);
    assert.equal(s.engine.s.orders[q3.id].status, "awaiting_payment");
    clock.t = q3.createdAt + 3 * DAY + 60_000; s.orders.expireReservations(system);
    assert.equal(s.engine.s.orders[q3.id].status, "expired");
    assert.doesNotThrow(() => s.orders.renew(R(beto), q3.renewal.assignmentId, { paymentMethod: "qr" }));
    // Con comprobante no vence (lo revisa el dueño).
    const q4 = s.engine.s.orders[q2.id];
    assert.ok(q4);
  });

  test("un pedido con comprobante en revisión: el mensaje dice que no hace falta pagar de nuevo", () => {
    const { s, marta, sell } = setup();
    const dis = sell(marta, "dis");
    const q = s.orders.renew(R(marta), dis, { paymentMethod: "qr" }).order;
    s.orders.submitEvidence(R(marta), q.id, { fileRef: "e".repeat(32) + ".png", declaredReference: "OP-1" });
    assert.throws(() => s.orders.renew(R(marta), dis, { paymentMethod: "balance" }), err("PENDING_RENEWAL", /lo estamos revisando/));
  });
});

describe("5 · «📩 Pedir renovación» propio, sin corte mientras está abierto", () => {
  function blocked() {
    const x = setup();
    const hbo = x.sell(x.marta, "hbo");
    // El proveedor vence 10 días después del alquiler: renovar 30 días no entra.
    const exp = x.s.engine.s.assignments[hbo].customerExpiresAt;
    x.s.inventory.updateAccount(owner, x.accOf(hbo).id, { supplierExpiresAt: exp + 10 * DAY });
    return { ...x, hbo, exp };
  }

  test("solo si la cuenta vence antes con el proveedor; un pedido por servicio; el otro revendedor no lo toca", () => {
    const { s, clock, marta, beto, hbo, exp, sell } = blocked();
    const me = R(marta);
    clock.t = exp - 2 * DAY;
    assert.equal(s.rmes.rentAlerts(me).list[0].why, "supplier");
    assert.throws(() => s.rsin.request(R(beto), hbo), err("FORBIDDEN"));
    const r = s.rsin.request(me, hbo);
    assert.equal(r.status, "open");
    assert.equal(r.amount, 1500);
    assert.equal(r.already, false);
    assert.equal(s.rsin.request(me, hbo).already, true, "no se duplica");
    assert.equal(Object.keys(s.engine.s.renewRequests).length, 1);
    assert.deepEqual(s.rsin.mine(R(beto)), []);
    assert.throws(() => s.rsin.cancel(R(beto), r.id), err("NOT_FOUND"));
    // Una cuenta que se puede renovar desde acá no se pide.
    const dis = sell(marta, "dis");
    assert.throws(() => s.rsin.request(me, dis), err("VALIDATION", /ya se puede renovar/));
    // Queda en el panel del dueño: Mi secretaria y Notificaciones, con el monto.
    const list = s.rsin.staffList(owner);
    assert.equal(list.length, 1);
    assert.equal(list[0].payerName, "Marta Choque");
    assert.equal(list[0].amount, 1500);
    assert.equal(list[0].supplier.months, 1);
    assert.ok(s.stats.feed().items.some((it) => it.kind === "renewReq" && it.count === 1));
    assert.throws(() => s.rsin.staffList(R(marta)), err("FORBIDDEN"));
    assert.throws(() => s.rsin.staffList(seller), err("FORBIDDEN"));
    // El cartel dice que esta queda afuera y por qué.
    const row = s.rmes.rentAlerts(me).list.find((x) => x.assignmentId === hbo);
    assert.equal(row.request.id, r.id);
  });

  test("no se corta mientras está abierto (a lo sumo 5 días de más); rechazado vuelve la regla de siempre", () => {
    const { s, clock, marta, hbo, exp } = blocked();
    clock.t = exp - DAY;
    const r = s.rsin.request(R(marta), hbo);
    clock.t = exp + 3 * DAY; s.orders.closeExpired(system, 2);
    assert.equal(s.engine.s.assignments[hbo].status, "active", "pidió renovar: no se corta");
    assert.equal(s.rmes.rentPush(marta.id)?.title?.startsWith("✂️"), undefined, "ni avisa «hoy se corta»");
    clock.t = exp + 2 * DAY + 5 * DAY + 60_000; s.orders.closeExpired(system, 2);
    assert.equal(s.engine.s.assignments[hbo].status, "revoked", "pero no para siempre");
    // Otro: rechazado → se corta como siempre.
    const x = blocked();
    x.clock.t = x.exp - DAY;
    const r2 = x.s.rsin.request(R(x.marta), x.hbo);
    assert.throws(() => x.s.rsin.reject(owner, r2.id, ""), err("VALIDATION"));
    x.s.rsin.reject(owner, r2.id, "Ese proveedor ya no vende HBO");
    assert.equal(x.s.rsin.mine(R(x.marta))[0].reason, "Ese proveedor ya no vende HBO");
    x.clock.t = x.exp + 2 * DAY + 60_000; x.s.orders.closeExpired(system, 2);
    assert.equal(x.s.engine.s.assignments[x.hbo].status, "revoked");
    assert.ok(r);
  });

  test("«Renovar proveedor y anotar»: paga el proveedor, cobra con su saldo y corre la fecha; una sola vez", () => {
    const { s, clock, marta, hbo, exp, accOf } = blocked();
    s.wallet.adjust(owner, marta.id, 5000, "prueba");
    clock.t = exp - DAY;
    const r = s.rsin.request(R(marta), hbo);
    assert.throws(() => s.rsin.resolve(seller, r.id, {}), err("FORBIDDEN"));
    assert.throws(() => s.rsin.resolve(R(marta), r.id, {}), err("FORBIDDEN"));
    const sup0 = accOf(hbo).supplierExpiresAt, exp0 = (s.engine.s.expenses ?? []).length;
    const out = s.rsin.resolve(owner, r.id, { idempotencyKey: "k1" });
    assert.equal(out.method, "balance");
    assert.equal(out.supplier.months, 1);
    assert.ok(accOf(hbo).supplierExpiresAt > sup0, "la cuenta quedó renovada con el proveedor");
    assert.equal(s.engine.s.expenses.length, exp0 + 1, "el pago al proveedor queda en Finanzas");
    assert.equal(s.engine.s.assignments[hbo].customerExpiresAt, exp + 30 * DAY);
    assert.equal(s.wallet.balance(marta.id), 5000 - 1500);
    // Repetir con la misma llave no cobra dos veces; con otra, ya está resuelto.
    s.rsin.resolve(owner, r.id, { idempotencyKey: "k1" });
    assert.equal(s.wallet.balance(marta.id), 3500);
    assert.throws(() => s.rsin.resolve(admin, r.id, { idempotencyKey: "k2" }), err("ALREADY_PROCESSED"));
    assert.equal(s.rsin.mine(R(marta))[0].status, "done");
  });

  test("sin saldo: queda un pedido por QR y el corte sigue frenado hasta que pague (máx. 5 días)", () => {
    const { s, clock, marta, hbo, exp } = blocked();
    clock.t = exp - DAY;
    const r = s.rsin.request(R(marta), hbo);
    const out = s.rsin.resolve(owner, r.id, {});
    assert.equal(out.method, "qr");
    assert.equal(s.engine.s.orders[out.orderId].status, "awaiting_payment");
    assert.equal(s.engine.s.orders[out.orderId].payerId, marta.id);
    clock.t = exp + 3 * DAY; s.orders.closeExpired(system, 2);
    assert.equal(s.engine.s.assignments[hbo].status, "active");
    // Paga el QR: con comprobante se aprueba y queda renovada.
    s.orders.submitEvidence(R(marta), out.orderId, { fileRef: "f".repeat(32) + ".png", declaredReference: "OP-77" });
    s.orders.approvePayment(owner, out.orderId, { confirmedReference: "OP-77" });
    assert.equal(s.engine.s.assignments[hbo].customerExpiresAt, exp + 30 * DAY);
  });

  test("el pedido del servicio de un cliente lo paga el revendedor; el cliente de un revendedor no le pide a la tienda", () => {
    const { s, clock, marta, accOf } = setup();
    s.wallet.adjust(owner, marta.id, 10000, "prueba");
    const camila = s.catalog.createCustomer(R(marta), { name: "Camila Rojas", phone: "+59176661002" });
    const net = s.orders.create(R(marta), { customerId: camila.id, items: [{ productId: "net", qty: 1 }], paymentMethod: "balance", idempotencyKey: "cn" }).assignmentIds[0];
    const exp = s.engine.s.assignments[net].customerExpiresAt;
    s.inventory.updateAccount(owner, accOf(net).id, { supplierExpiresAt: exp + 5 * DAY });
    clock.t = exp - DAY;
    assert.throws(() => s.rsin.request(C(camila), net), err("FORBIDDEN", /revendedor/));
    const r = s.rsin.request(R(marta), net);
    assert.equal(r.amount, 2500, "a precio de revendedora");
    const bal = s.wallet.balance(marta.id);
    s.rsin.resolve(owner, r.id, {});
    assert.equal(s.wallet.balance(marta.id), bal - 2500, "lo paga Marta, no Camila");
    assert.equal(s.wallet.balance(camila.id), 0);
  });

  test("Mi secretaria lo muestra con el monto", () => {
    const { s, clock, marta, hbo, exp } = blocked();
    clock.t = exp - DAY;
    s.rsin.request(R(marta), hbo);
    const rep = s.stats.secretary(owner);
    assert.equal(rep.pedidosRenovar.length, 1);
    assert.equal(rep.pedidosRenovar[0].amount, 1500);
  });
});
