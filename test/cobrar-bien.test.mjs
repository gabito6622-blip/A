// Cobrar bien (revisión de 3 meses simulados, 14/11/2026). Núcleo, sin navegador. Datos ficticios, reloj controlado,
// ningún WhatsApp real (bot apagado: los recordatorios quedan en la bandeja).
//   1) Recordatorios: «avisado» solo si el mensaje salió (o «Ya le avisé»); si no, «preparado, mandalo vos».
//   2) «Me pagó lo que debía» marca pagado sin correr la fecha; «Me pagó» de renovación sí la corre.
//   3) Doble cobro desde cualquier pantalla: confirmar «¿Es otro mes?» o 409.
//   4) Decisión (a): pago atrasado antes del corte → desde el vencimiento; reactivar después del corte → desde hoy.
//   5) Decisión (b): cobro permitido aunque pase al proveedor, con aviso y «Proveedores por renovar».
//   6) Reactivar con el proveedor corto: mismo trato que (b) y mensajes claros.
//   9) Cambiar de plataforma en un paso. 11) Apartadas con el ex cliente. 7) Buscar sin tildes ni orden.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" }, admin = { id: "u_admin", role: "admin" }, seller = { id: "u_seller", role: "seller" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const T0 = Date.UTC(2026, 9, 1, 15); // 01/10 11:00 Bolivia
const dm = (t) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t)).slice(0, 5);

function world() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "max", name: "Max", kind: "profile", durationDays: 30, price: 4200, published: true });
  const at = (t) => { clock.t = t; };
  const acc = (productId, email, supDays, n = 2) => s.inventory.addAccount(owner, { productId, email, password: "Clave#Ficticia1", supplierExpiresAt: clock.t + supDays * DAY, cost: 6000, profiles: Array.from({ length: n }, (_, i) => ({ label: `P${i + 1}` })) });
  const cust = (name, phone, consent = true) => s.catalog.createCustomer(owner, { name, phone, whatsappConsent: consent });
  const sell = (c, productId = "nf", pay = "pagado") => { const o = s.orders.create(owner, { customerId: c.id, items: [{ productId, qty: 1 }], paymentMethod: "cash" }); const id = o.assignmentIds[0]; s.orders.setControl(owner, id, { payStatus: pay }); return id; };
  return { s, clock, at, acc, cust, sell, A: (id) => s.engine.s.assignments[id] };
}

describe("1) recordatorios: avisado solo si salió", () => {
  test("bot apagado o sin permiso → «preparado»; enviado o «Ya le avisé» → avisado", () => {
    const w = world();
    const { s, at, A } = w;
    w.acc("nf", "nf1@ficticio.lat", 120, 3);
    const ana = w.cust("Ana Quispe", "+59171000001", true), beto = w.cust("Beto Mamani", "+59171000002", false);
    const ia = w.sell(ana), ib = w.sell(beto);
    at(A(ia).customerExpiresAt - 2 * DAY + 60_000); // dos días antes, 11:01
    assert.equal(s.orders.autoReminders({ id: "system", role: "system" }), 2);
    const msgA = s.engine.s.outbox.find((m) => m.id === A(ia).reminderMsgId), msgB = s.engine.s.outbox.find((m) => m.id === A(ib).reminderMsgId);
    assert.deepEqual([msgA.status, msgB.status], ["queued", "skipped_no_consent"]);
    const r = s.stats.secretary(owner, { botOn: false });
    const item = (id) => r.avisar.flatMap((g) => g.items).find((i) => i.assignmentId === id);
    assert.equal(item(ia).noticedAt, undefined, "el bot está apagado: NO figura avisado");
    assert.deepEqual([item(ia).prepared.why, item(ib).prepared.why], ["bot", "permiso"]);
    assert.equal(r.counts.avisar, 2); assert.equal(r.counts.avisados, 0); assert.equal(r.counts.preparados, 2);
    assert.deepEqual(r.avisosAuto, { enabled: true, bot: false });
    const row = s.admin.assignments(owner, {}).find((x) => x.id === ia);
    assert.equal(row.notice, null); assert.equal(row.lastNotice, null); assert.equal(row.reminder.why, "bot");
    // Salió de verdad (el bot lo mandó): ahora sí.
    s.notify.markSendResult({ id: "system", role: "system" }, msgA.id, { ok: true, waId: "wamid.ficticio" });
    // A Beto se lo mandó el dueño a mano: «✅ Ya le avisé».
    s.orders.markNoticed(owner, [ib]);
    const r2 = s.stats.secretary(owner, { botOn: true });
    const it2 = (id) => r2.avisar.flatMap((g) => g.items).find((i) => i.assignmentId === id);
    assert.equal(it2(ia).noticedVia, "recordatorio"); assert.equal(it2(ia).prepared, undefined);
    assert.equal(it2(ib).noticedVia, "secretaria");
    assert.equal(r2.counts.avisados, 2); assert.equal(r2.counts.preparados, 0);
  });
});

describe("2) «Me pagó lo que debía»", () => {
  test("marca pagado SIN correr la fecha; «Me pagó» de renovación sí la corre; permisos", () => {
    const w = world();
    const { s, at, A } = w;
    w.acc("nf", "nf1@ficticio.lat", 120, 3);
    const karen = w.cust("Karen Limachi", "+59171000003");
    const id = w.sell(karen, "nf", "pendiente");
    const exp = A(id).customerExpiresAt;
    at(T0 + 5 * DAY);
    assert.ok(s.stats.secretary(owner).deben.some((g) => g.items.some((i) => i.assignmentId === id)), "figura en «Te deben»");
    assert.throws(() => s.dia.payDebt(seller, id, {}), err("FORBIDDEN"), "Atención no cobra");
    const r = s.dia.payDebt(owner, id, { idempotencyKey: "d1" });
    assert.equal(r.saved.expiresAt, exp); assert.equal(r.saved.price, 3500);
    assert.equal(A(id).customerExpiresAt, exp, "la fecha no se movió");
    assert.equal(A(id).control.payStatus, "pagado"); assert.match(A(id).control.note, /pagó lo que debía/);
    assert.equal(A(id).control.paidLog.length, 1, "queda anotado el cobro una vez");
    assert.ok(s.engine.s.audit.some((x) => x.action === "secretary.debt_paid" && x.entityId === id));
    assert.equal(s.dia.payDebt(owner, id, { idempotencyKey: "d1" }).saved.expiresAt, exp, "misma llave: misma respuesta");
    assert.throws(() => s.dia.payDebt(owner, id, { idempotencyKey: "d2" }), /ya figura pagado/);
    assert.ok(!s.stats.secretary(owner).deben.some((g) => g.items.some((i) => i.assignmentId === id)), "sale de «Te deben»");
    // El mes siguiente, «Me pagó» de renovación corre la fecha desde el vencimiento.
    at(exp - DAY);
    const p = s.cobro.apply(owner, id, { idempotencyKey: "p1" });
    assert.equal(p.saved.to, exp + 30 * DAY);
  });
});

describe("3) doble cobro desde cualquier pantalla", () => {
  test("«Me pagó» y después «Renovar» del Control: pide confirmar (DOUBLE_CHARGE); confirmado, renueva", () => {
    const w = world();
    const { s, at, A } = w;
    w.acc("nf", "nf1@ficticio.lat", 200, 3);
    const ivan = w.cust("Iván Callisaya", "+59171000004");
    const id = w.sell(ivan);
    const exp = A(id).customerExpiresAt;
    // Normal: pagar el día del vencimiento no pide confirmar (el cobro de la venta fue hace un mes).
    at(exp);
    assert.equal(s.cobro.preview(owner, id).doubleCharge, undefined);
    s.cobro.apply(owner, id, { idempotencyKey: "m1" });
    const after1 = A(id).customerExpiresAt;
    // Media hora después, desde el Control: frena (no solo 10 minutos).
    at(exp + 30 * 60_000);
    assert.throws(() => s.orders.renew(owner, id, { paymentMethod: "cash", idempotencyKey: "r1" }), (e) => e.code === "DOUBLE_CHARGE" && new RegExp(`Ya anotaste un cobro el ${dm(exp)} \\(Bs 35\\)`).test(e.message) && /¿Es otro mes\?/.test(e.message));
    // 5 días después, también.
    at(exp + 5 * DAY);
    assert.throws(() => s.orders.renew(owner, id, { paymentMethod: "cash", idempotencyKey: "r2" }), err("DOUBLE_CHARGE"));
    const bulk = s.orders.renewMany(admin, [id], { paymentMethod: "cash", batchKey: "b1" });
    assert.equal(bulk[0].code, "DOUBLE_CHARGE", "la renovación masiva tampoco lo anota dos veces");
    assert.equal(A(id).customerExpiresAt, after1, "nada se movió");
    // Confirmado («es otro mes»): renueva.
    const r = s.orders.renew(owner, id, { paymentMethod: "cash", idempotencyKey: "r3", confirmOther: true });
    assert.equal(r.assignment.customerExpiresAt, after1 + 30 * DAY);
    // Y al revés: después del Control, «Me pagó» de Mi secretaria también pregunta, con el monto de la renovación.
    const pv = s.cobro.preview(owner, id);
    assert.match(pv.doubleCharge.text, /Bs 35/);
    assert.throws(() => s.cobro.apply(owner, id, { idempotencyKey: "m2" }), err("DOUBLE_CHARGE"));
  });

  test("venta pagada y «Me pagó» al día siguiente: pide confirmar; el cliente que paga renovando el mismo día del vencimiento, no", () => {
    const w = world();
    const { s, at, A } = w;
    w.acc("nf", "nf1@ficticio.lat", 200, 3);
    const id = w.sell(w.cust("Rosa Copa", "+59171000005"));
    at(T0 + DAY);
    assert.match(s.cobro.preview(owner, id).doubleCharge.text, new RegExp(`Ya anotaste un cobro el ${dm(T0)}`));
    at(A(id).customerExpiresAt - 3 * DAY); // paga 3 días antes: lo normal
    assert.equal(s.cobro.preview(owner, id).doubleCharge, undefined);
  });
});

describe("4) decisión (a): sin días regalados", () => {
  test("pago atrasado antes del corte: desde el vencimiento (Me pagó y Control); después del corte: reactivar desde hoy", () => {
    const w = world();
    const { s, at, A } = w;
    w.acc("nf", "nf1@ficticio.lat", 200, 3);
    const d = w.sell(w.cust("Diego Flores", "+59171000006")), l = w.sell(w.cust("Luis Ticona", "+59171000007")), x = w.sell(w.cust("Sergio Alanoca", "+59171000008"));
    const exp = A(d).customerExpiresAt;
    at(exp + DAY + 3 * HOUR); // un día tarde, antes del corte (vencimiento + 2 días)
    const pv = s.cobro.preview(owner, d);
    assert.deepEqual([pv.from, pv.to], [exp, exp + 30 * DAY]);
    assert.equal(s.cobro.apply(owner, d, { idempotencyKey: "a" }).saved.to, exp + 30 * DAY, "Me pagó: 0 días regalados");
    assert.equal(s.orders.renew(owner, l, { paymentMethod: "cash", idempotencyKey: "b" }).assignment.customerExpiresAt, exp + 30 * DAY, "Control «Renovar»: 0 días regalados");
    // Después del corte: reactivación desde hoy (decisión del dueño).
    at(exp + 5 * DAY);
    s.orders.closeExpired({ id: "system", role: "system" }, 2);
    assert.equal(A(x).status, "revoked");
    const r = s.dia.reactivate(owner, x, { idempotencyKey: "c" });
    assert.equal(r.saved.to, exp + 5 * DAY + 30 * DAY);
  });
});

describe("5) y 6) decisión (b): el proveedor no frena el cobro", () => {
  test("«Me pagó» pasa la fecha del proveedor con aviso y queda en «Proveedores por renovar»; Atención no cobra", () => {
    const w = world();
    const { s, at, A } = w;
    const corta = w.acc("nf", "corta@ficticio.lat", 40, 1); // el proveedor vence a los 40 días
    const id = w.sell(w.cust("Fabio Vargas", "+59171000009"));
    const exp = A(id).customerExpiresAt;
    at(exp - DAY);
    const pv = s.cobro.preview(owner, id);
    assert.equal(pv.ok, true);
    assert.equal(pv.supplierWarn.text, `⚠️ Renová el proveedor antes del ${dm(T0 + 40 * DAY)}: la fecha nueva del cliente la pasa. Queda en «Proveedores por renovar».`);
    assert.ok(pv.supplierRenew, "sigue el atajo «💳 Renovar proveedor y anotar»");
    assert.throws(() => s.cobro.preview(seller, id), err("FORBIDDEN"));
    const r = s.cobro.apply(owner, id, { idempotencyKey: "p" });
    assert.equal(r.saved.to, exp + 30 * DAY); assert.ok(r.saved.supplierWarn);
    const sec = s.stats.secretary(owner);
    assert.equal(sec.counts.proveedores, 1);
    assert.deepEqual([sec.proveedores[0].email, sec.proveedores[0].supplierExpiresAt, sec.proveedores[0].clients[0].name], ["corta@ficticio.lat", T0 + 40 * DAY, "Fabio Vargas"]);
    assert.ok(s.engine.s.audit.some((x) => x.action === "secretary.paid"));
    // Cuando renueva con el proveedor, sale de la lista.
    s.finance.payRenewal(owner, corta.account.id, { months: 1 });
    assert.equal(s.stats.secretary(owner).counts.proveedores, 0);
  });

  test("reactivar lo cortado con el proveedor corto: se reactiva en su perfil con aviso; sin perfil libre, el motivo real", () => {
    const w = world();
    const { s, at, A } = w;
    w.acc("nf", "corta@ficticio.lat", 33, 1);
    const id = w.sell(w.cust("Heidi Arce", "+59171000010"));
    const exp = A(id).customerExpiresAt;
    at(exp + 3 * DAY);
    s.orders.closeExpired({ id: "system", role: "system" }, 2);
    const pv = s.dia.reactivatePreview(owner, id);
    assert.equal(pv.ok, true, pv.blockers.join());
    assert.equal(pv.mode, "same");
    assert.match(pv.supplierWarn.text, new RegExp(`Renová el proveedor antes del ${dm(T0 + 33 * DAY)}`));
    // El perfil se dio de baja: el motivo dice eso, no «el proveedor».
    s.inventory.setSlotStatus(owner, A(id).slotId, "retired", "se cayó");
    const pv2 = s.dia.reactivatePreview(owner, id);
    assert.equal(pv2.ok, false);
    assert.match(pv2.blockers[0], /se retiró y no hay otro perfil libre de Netflix/);
    assert.doesNotMatch(pv2.blockers[0], /proveedor/);
  });
});

describe("9) cambiar de plataforma en un paso", () => {
  test("Netflix → Max: perfil viejo apartado, uno libre de Max, misma fecha o ajustada por precio, auditoría; permisos", () => {
    const w = world();
    const { s, at, A } = w;
    w.acc("nf", "nf1@ficticio.lat", 120, 2);
    const mx = w.acc("max", "max1@ficticio.lat", 120, 2);
    const id = w.sell(w.cust("Flor Yujra", "+59171000012"));
    s.orders.setControl(owner, id, { price: 3000 });
    const exp = A(id).customerExpiresAt, oldSlot = A(id).slotId;
    at(T0 + 10 * DAY);
    assert.throws(() => s.dia.switchPreview(seller, id, { toProductId: "max" }), err("FORBIDDEN"));
    const pv = s.dia.switchPreview(owner, id, { toProductId: "max" });
    assert.equal(pv.ok, true, pv.blockers.join());
    assert.equal(pv.to.email, "max1@ficticio.lat");
    assert.equal(pv.priceDiff, 4200 - 3000);
    assert.equal(pv.adjustedExpiresAt, T0 + 10 * DAY + Math.round((20 * DAY * 3000) / 4200 / 60_000) * 60_000);
    assert.match(pv.adjustText, /cuesta Bs 12 más/);
    assert.ok(pv.warnings.some((x) => /precio acordado/.test(x)));
    assert.match(s.dia.switchPreview(owner, id, { toProductId: "nf" }).blockers[0], /Ya tiene Netflix/);
    const r = s.dia.switchPlatform(owner, id, { toProductId: "max", idempotencyKey: "s1" });
    assert.equal(A(id).productId, "max"); assert.equal(A(id).customerExpiresAt, exp, "conserva la fecha");
    assert.equal(s.engine.s.slots[oldSlot].status, "quarantined", "el perfil viejo queda apartado");
    assert.equal(s.engine.s.slots[A(id).slotId].status, "assigned"); assert.equal(s.engine.s.slots[A(id).slotId].accountId, mx.account.id);
    assert.equal(A(id).control.price, undefined, "el precio acordado de Netflix no sigue");
    assert.match(A(id).control.note, /🔀 .*de Netflix a Max/);
    assert.ok(s.engine.s.audit.some((x) => x.action === "assignment.switch_platform" && x.entityId === id));
    assert.equal(s.dia.switchPlatform(owner, id, { toProductId: "max", idempotencyKey: "s1" }).to.slotId, r.to.slotId, "misma llave: mismo resultado");
    // Vuelta a Netflix ajustando la fecha por precio (Netflix cuesta menos: le quedan más días).
    const back = s.dia.switchPreview(owner, id, { toProductId: "nf" });
    assert.equal(back.ok, true); assert.ok(back.adjustedExpiresAt > exp);
    s.dia.switchPlatform(owner, id, { toProductId: "nf", adjust: "price", idempotencyKey: "s2" });
    assert.equal(A(id).customerExpiresAt, back.adjustedExpiresAt);
    // Sin perfiles libres de Max: lo dice claro.
    s.orders.create(owner, { customerId: w.cust("Max Uno", "+59171000013").id, items: [{ productId: "max", qty: 1 }], paymentMethod: "cash" });
    assert.match(s.dia.switchPreview(owner, id, { toProductId: "max" }).blockers[0], /No hay perfiles libres de Max/);
  });
});

describe("11) apartadas con el nombre del ex cliente", () => {
  test("Mi secretaria dice de quién era cada perfil apartado", () => {
    const w = world();
    const { s, at } = w;
    w.acc("nf", "nf1@ficticio.lat", 120, 1); w.acc("nf", "nf2@ficticio.lat", 120, 1);
    const id = w.sell(w.cust("Abel Cusi", "+59171000014"));
    const oldSlot = s.engine.s.assignments[id].slotId;
    at(T0 + DAY);
    s.orders.replace(owner, id, { reason: "no le entra" });
    const ap = s.stats.secretary(owner).apartadas;
    assert.equal(ap.length, 1);
    assert.deepEqual(ap[0].slots.map((x) => [x.slotId, x.exName]), [[oldSlot, "Abel Cusi"]]);
  });
});

describe("7) buscar clientes sin tildes ni orden", () => {
  test("«maria», «quispe ana», «7100» y «gutierrez» encuentran", () => {
    const w = world();
    const { s } = w;
    w.cust("María Chávez", "+59171009911"); w.cust("Ana Quispe", "+59171002233"); w.cust("Irene Gutiérrez", "+59160012345");
    const names = (q) => s.admin.customers(owner, q).map((c) => c.name).sort();
    assert.deepEqual(names("maria"), ["María Chávez"]);
    assert.deepEqual(names("quispe ana"), ["Ana Quispe"]);
    assert.deepEqual(names("gutierrez"), ["Irene Gutiérrez"]);
    assert.deepEqual(names("7100"), ["Ana Quispe", "María Chávez"]);
    assert.deepEqual(names("CHAVEZ m"), ["María Chávez"]);
  });
});

describe("API: rutas nuevas y códigos", () => {
  test("pay-debt, switch-preview/switch, DOUBLE_CHARGE 409 y bot en Mi secretaria; sin sesión 401", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-eq2-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    try {
      app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const post = (p, b, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b ?? {}) });
      const ck = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
      await post("/api/admin/products", { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true }, ck);
      await post("/api/admin/products", { id: "max", name: "Max", kind: "profile", durationDays: 30, price: 3500, published: true }, ck);
      await post("/api/admin/accounts", { productId: "nf", email: "nf@ficticio.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 200 * DAY, cost: 6000, profiles: [{ label: "P1" }, { label: "P2" }] }, ck);
      await post("/api/admin/accounts", { productId: "max", email: "max@ficticio.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 200 * DAY, cost: 6000, profiles: [{ label: "P1" }] }, ck);
      const c = await (await post("/api/admin/customers", { name: "Ximena Paz", phone: "+59171000015" }, ck)).json();
      const o = await (await post("/api/admin/orders", { customerId: c.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }, ck)).json();
      const id = o.assignmentIds[0];
      await post(`/api/admin/assignments/${id}/control`, { payStatus: "pendiente" }, ck);
      assert.equal((await post(`/api/admin/assignments/${id}/pay-debt`, {})).status, 401);
      const d = await post(`/api/admin/assignments/${id}/pay-debt`, { idempotencyKey: "x" }, ck);
      assert.equal(d.status, 200);
      const r1 = await post(`/api/admin/assignments/${id}/renew`, { paymentMethod: "cash", idempotencyKey: "y" }, ck);
      assert.equal(r1.status, 409); assert.equal((await r1.json()).error, "DOUBLE_CHARGE");
      assert.equal((await post(`/api/admin/assignments/${id}/renew`, { paymentMethod: "cash", idempotencyKey: "z", confirmOther: true }, ck)).status, 200);
      const sv = await (await fetch(`${base}/api/admin/assignments/${id}/switch-preview?to=max`, { headers: { cookie: ck } })).json();
      assert.equal(sv.ok, true); assert.equal(sv.priceDiff, 0);
      const sw = await post(`/api/admin/assignments/${id}/switch`, { toProductId: "max", idempotencyKey: "w" }, ck);
      assert.equal(sw.status, 200);
      const sec = await (await fetch(`${base}/api/admin/secretaria`, { headers: { cookie: ck } })).json();
      assert.deepEqual(sec.avisosAuto, { enabled: true, bot: false }, "sin bot configurado: los avisos automáticos no salen");
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
