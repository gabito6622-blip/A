// "Que vuelvan": pedidos sin terminar y servicios vencidos sin renovar, para recuperar la venta
// con un WhatsApp que abre una persona. Clientes de revendedores nunca entran (son del revendedor).
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DomainError, DAY, MINUTE } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const T0 = Date.UTC(2026, 10, 11, 16, 0, 0);
const owner = { id: "u_owner", role: "owner" };
const admin = { id: "u_admin", role: "admin" };
const seller = { id: "u_seller", role: "seller" };
const sys = { id: "system", role: "system" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "disney", name: "Disney", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertProduct(owner, { id: "dfull", name: "Disney completa", kind: "full_account", durationDays: 30, price: 12000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, dfull: 9000 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  const far = T0 + 400 * DAY;
  s.inventory.addAccount(admin, { productId: "netflix", supplierId: "andes", email: "nf-secreto@x.lat", password: "Clave-Secreta#1", supplierExpiresAt: far, cost: 4321, profiles: Array.from({ length: 5 }, (_, i) => ({ label: `N${i + 1}` })) });
  s.inventory.addAccount(admin, { productId: "netflix", supplierId: "andes", email: "nf2-secreto@x.lat", password: "Clave-Secreta#2", supplierExpiresAt: far, cost: 4321, profiles: Array.from({ length: 5 }, (_, i) => ({ label: `M${i + 1}` })) });
  s.inventory.addAccount(admin, { productId: "disney", supplierId: "andes", email: "dn-secreto@x.lat", password: "Clave-Secreta#3", supplierExpiresAt: far, cost: 3000, profiles: Array.from({ length: 5 }, (_, i) => ({ label: `D${i + 1}` })) });
  s.inventory.addAccount(admin, { productId: "dfull", supplierId: "andes", email: "df-secreto@x.lat", password: "Clave-Secreta#4", supplierExpiresAt: far, cost: 8000, profiles: [{ label: "Completa" }] });
  const ari = s.catalog.createCustomer(admin, { name: "Ariana Flores", phone: "+59171234567", kind: "reseller", priceGroupId: "revendedor" });
  const asAri = { id: "r_ari", role: "reseller", customerId: ari.id };
  const noe = s.catalog.createCustomer(asAri, { name: "Noelia Quispe", phone: "+59170000001" });
  const carla = s.catalog.createCustomer(admin, { name: "Carla Rojas", phone: "+59170011223" });
  const beto = s.catalog.createCustomer(admin, { name: "Beto Paz", phone: "+59170011224" });
  s.wallet.adjust(owner, ari.id, 100000, "Recarga de prueba");
  const sell = (customerId, productId, method = "cash", actor = admin) => s.orders.create(actor, { customerId, items: [{ productId, qty: 1 }], paymentMethod: method });
  const list = (who = owner) => s.winback.list(who);
  const all = (who = owner) => { const l = list(who); return [...l.pedidos, ...l.vencidos]; };
  const find = (cid, who = owner) => all(who).find((i) => i.customerId === cid);
  return { s, clock, ari, asAri, noe, carla, beto, sell, list, all, find };
}

describe("Que vuelvan: pedidos sin terminar", () => {
  test("pedido sin pagar: aparece pasados 30 minutos, con su precio y el mensaje de ayuda", () => {
    const { s, clock, carla, sell, find, list } = setup();
    sell(carla.id, "netflix", "qr");
    clock.t += 20 * MINUTE;
    assert.equal(find(carla.id), undefined, "con 20 minutos todavía está pagando");
    clock.t += 15 * MINUTE;
    const it = find(carla.id);
    assert.ok(it, "con 35 minutos ya aparece");
    assert.equal(it.group, "pedido");
    assert.equal(it.kind, "cliente");
    assert.equal(it.phone, "+59170011223");
    assert.equal(it.amount, 3500);
    assert.equal(it.things[0].what, "Pedido sin pagar");
    assert.equal(it.days, 0);
    assert.match(it.message, /Hola Carla/);
    assert.match(it.message, /¿Te ayudo a terminar tu compra\?/);
    assert.doesNotMatch(it.message, /Clave|secreto|@x\.lat/);
    const l = list();
    assert.equal(l.count, 1);
    assert.equal(l.amount, 3500);
    assert.ok(s);
  });

  test("vencido, cancelado y rechazado de los últimos 7 días aparecen; el de hace 10 días no", () => {
    const { s, clock, carla, beto, ari, asAri, sell, find } = setup();
    const o1 = sell(carla.id, "netflix", "qr");
    clock.t += 31 * MINUTE;
    assert.equal(s.orders.expireReservations(sys), 1);
    assert.equal(s.engine.s.orders[o1.id].status, "expired");
    const o2 = sell(beto.id, "disney", "qr");
    s.orders.cancel(admin, o2.id);
    const o3 = sell(ari.id, "netflix", "qr", asAri);
    s.orders.rejectPayment(owner, o3.id, "comprobante ilegible");
    clock.t += 2 * DAY;
    assert.equal(find(carla.id).things[0].what, "Pedido que venció sin pagar");
    assert.equal(find(beto.id).things[0].what, "Canceló el pedido");
    const a = find(ari.id);
    assert.equal(a.things[0].what, "Pago rechazado");
    assert.equal(a.kind, "revendedor", "el revendedor por su propia compra sí");
    assert.equal(a.amount, 2500, "a su precio de revendedor");
    clock.t += 8 * DAY; // ya pasaron 10 días
    assert.equal(find(carla.id), undefined);
    assert.equal(find(beto.id), undefined);
    assert.equal(find(ari.id), undefined);
  });

  test("si después compró (o mandó comprobante) del mismo producto, no aparece", () => {
    const { s, clock, carla, beto, sell, find } = setup();
    const o = sell(carla.id, "netflix", "qr");
    s.orders.cancel(admin, o.id);
    clock.t += MINUTE;
    sell(carla.id, "netflix", "cash");
    const o2 = sell(beto.id, "disney", "qr");
    s.orders.cancel(admin, o2.id);
    clock.t += MINUTE;
    const o3 = sell(beto.id, "disney", "qr");
    s.orders.submitEvidence(admin, o3.id, { fileRef: "f1", declaredReference: "123" });
    clock.t += 2 * DAY;
    assert.equal(find(carla.id), undefined, "ya volvió a comprar");
    assert.equal(find(beto.id), undefined, "está en revisión");
  });

  test("un pedido del cliente de un revendedor no aparece", () => {
    const { s, clock, noe, asAri, sell, all } = setup();
    const o = sell(noe.id, "netflix", "qr", asAri);
    s.orders.cancel(asAri, o.id);
    clock.t += DAY;
    assert.equal(all().length, 0);
  });
});

describe("Que vuelvan: se les venció y no renovaron", () => {
  test("aparece de 1 a 30 días después del vencimiento, también después de cerrarse solo", () => {
    const { s, clock, carla, sell, find } = setup();
    sell(carla.id, "netflix");
    clock.t = T0 + 30 * DAY + 12 * 60 * MINUTE;
    assert.equal(find(carla.id), undefined, "venció hace medio día: todavía no");
    clock.t = T0 + 32 * DAY;
    const it = find(carla.id);
    assert.equal(it.group, "vencido");
    assert.equal(it.days, 2);
    assert.equal(it.things[0].what, "Se le venció");
    assert.match(it.message, /¿Querés renovar tu Netflix\? Sigue a Bs 35\./);
    assert.match(it.message, /venció el \d\d\/\d\d/);
    assert.equal(s.orders.closeExpired(sys), 1);
    assert.ok(find(carla.id), "cerrado por el trabajo de vencidos: sigue apareciendo");
    clock.t = T0 + 60 * DAY;
    assert.ok(find(carla.id), "30 días: sí");
    clock.t = T0 + 61 * DAY;
    assert.equal(find(carla.id), undefined, "31 días: ya no");
  });

  test("con otro servicio vigente del mismo producto no aparece; con uno de otro producto sí", () => {
    const { clock, carla, beto, sell, find } = setup();
    sell(carla.id, "netflix");
    sell(beto.id, "netflix");
    clock.t = T0 + 25 * DAY;
    sell(carla.id, "netflix");
    sell(beto.id, "disney");
    clock.t = T0 + 33 * DAY;
    assert.equal(find(carla.id), undefined);
    assert.equal(find(beto.id).things[0].product, "Netflix");
  });

  test("en espera de fecha (holdOpen), prueba gratis, devuelto o cliente de revendedor: no aparecen", () => {
    const { s, clock, carla, beto, noe, asAri, ari, sell, all } = setup();
    const a1 = sell(carla.id, "netflix").assignmentIds[0];
    s.engine.s.assignments[a1].holdOpen = true; // como lo deja el importador
    const a2 = sell(beto.id, "netflix").assignmentIds[0];
    s.orders.refundAssignment(owner, a2, { reason: "no le anduvo" });
    sell(noe.id, "netflix", "balance", asAri);
    s.orders.createTrial(admin, { customerId: ari.id, productId: "disney", hours: 2 });
    clock.t = T0 + 5 * DAY;
    s.orders.closeExpired(sys);
    assert.deepEqual(all().map((i) => i.name), []);
  });

  test("el revendedor entra por su propio alquiler, a su precio", () => {
    const { clock, ari, asAri, sell, find } = setup();
    sell(ari.id, "dfull", "balance", asAri);
    clock.t = T0 + 35 * DAY;
    const it = find(ari.id);
    assert.equal(it.kind, "revendedor");
    assert.equal(it.amount, 9000);
    assert.match(it.message, /Disney completa\? Sigue a Bs 90\./);
  });

  test("un cliente con un pedido sin terminar y un vencido aparece una sola vez, con las dos cosas", () => {
    const { s, clock, carla, sell, all } = setup();
    sell(carla.id, "netflix");
    clock.t = T0 + 33 * DAY;
    const o = sell(carla.id, "disney", "qr");
    s.orders.cancel(admin, o.id);
    clock.t += DAY;
    const mine = all().filter((i) => i.customerId === carla.id);
    assert.equal(mine.length, 1);
    assert.equal(mine[0].group, "pedido");
    assert.deepEqual(mine[0].things.map((t) => t.kind).sort(), ["pedido", "vencido"]);
    assert.equal(mine[0].amount, 6500);
    assert.match(mine[0].message, /terminar tu compra/);
    assert.match(mine[0].message, /renovar tu Netflix/);
  });

  test("ordenados del más reciente al más viejo", () => {
    const { clock, carla, beto, sell, list } = setup();
    sell(carla.id, "netflix");
    clock.t = T0 + 5 * DAY;
    sell(beto.id, "netflix");
    clock.t = T0 + 40 * DAY;
    assert.deepEqual(list().vencidos.map((i) => i.name), ["Beto Paz", "Carla Rojas"]);
  });
});

describe("Que vuelvan: marcar escrito / no molestar y la métrica", () => {
  test("escrito: desaparece 7 días y vuelve después; queda en la auditoría", () => {
    const { s, clock, carla, sell, find } = setup();
    sell(carla.id, "netflix");
    clock.t = T0 + 31 * DAY;
    assert.ok(find(carla.id));
    const r = s.winback.mark(seller, carla.id, "escrito");
    assert.equal(r.until, clock.t + 7 * DAY);
    assert.equal(find(carla.id), undefined);
    clock.t += 6 * DAY;
    assert.equal(find(carla.id), undefined, "6 días después: todavía no");
    clock.t += DAY + MINUTE;
    assert.ok(find(carla.id), "pasados 7 días vuelve a aparecer");
    const ev = s.engine.s.audit.find((a) => a.action === "winback.mark");
    assert.deepEqual([ev.entityId, ev.data.outcome, ev.role], [carla.id, "escrito", "seller"]);
  });

  test("no molestar: no aparece por 60 días", () => {
    const { s, clock, carla, sell, find } = setup();
    const o = sell(carla.id, "netflix", "qr");
    s.orders.cancel(admin, o.id);
    clock.t += DAY;
    s.winback.mark(owner, carla.id, "no_molestar");
    assert.equal(find(carla.id), undefined);
    clock.t = T0 + 59 * DAY;
    s.orders.cancel(admin, sell(carla.id, "disney", "qr").id);
    clock.t += DAY - MINUTE;
    assert.equal(find(carla.id), undefined, "a los 59 días todavía no, aunque tenga algo nuevo");
    clock.t = T0 + 62 * DAY;
    s.orders.cancel(admin, sell(carla.id, "netflix", "qr").id);
    clock.t += DAY;
    assert.ok(find(carla.id), "pasados 60 días vuelve");
  });

  test("métrica: a cuántos se les escribió en 30 días y cuántos volvieron a comprar", () => {
    const { s, clock, carla, beto, sell, list } = setup();
    const ac = sell(carla.id, "netflix").assignmentIds[0];
    sell(beto.id, "disney");
    clock.t = T0 + 32 * DAY;
    s.winback.mark(seller, carla.id, "escrito");
    s.winback.mark(seller, beto.id, "escrito");
    assert.deepEqual([list().written30, list().returned30], [2, 0]);
    clock.t += DAY;
    s.orders.renew(seller, ac, { paymentMethod: "cash" });
    assert.deepEqual([list().written30, list().returned30], [2, 1], "Carla renovó después del mensaje");
    clock.t += 31 * DAY;
    assert.deepEqual([list().written30, list().returned30], [0, 0], "ya pasaron más de 30 días");
  });

  test("permisos y validaciones del módulo", () => {
    const { s, carla, noe, asAri } = setup();
    for (const who of [owner, admin, seller]) assert.ok(s.winback.list(who));
    assert.throws(() => s.winback.list(asAri), err("FORBIDDEN"));
    assert.throws(() => s.winback.list({ id: "c", role: "customer", customerId: carla.id }), err("FORBIDDEN"));
    assert.throws(() => s.winback.mark(asAri, carla.id, "escrito"), err("FORBIDDEN"));
    assert.throws(() => s.winback.mark(owner, carla.id, "spam"), err("VALIDATION"));
    assert.throws(() => s.winback.mark(owner, noe.id, "escrito"), err("FORBIDDEN"), "el cliente de un revendedor es del revendedor");
    assert.throws(() => s.winback.mark(owner, "cus_nadie", "escrito"), err("NOT_FOUND"));
  });
});

describe("Que vuelvan por HTTP", () => {
  test("dueño, admin y Atención 200; revendedor y cliente 403; sin costos ni datos de cuentas", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-winback-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    try {
      const st = app.store, o = { id: "t", role: "owner" };
      st.catalog.upsertProduct(o, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
      st.catalog.upsertSupplier(o, { id: "andes", name: "Proveedor Andes", active: true });
      st.inventory.addAccount(o, { productId: "nf", supplierId: "andes", email: "nf-secreto@x.lat", password: "Clave-Secreta#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 4321, profiles: [{ label: "P1" }, { label: "P2" }] });
      const carla = st.catalog.createCustomer(o, { name: "Carla", phone: "+59170011223" });
      const rev = st.catalog.createCustomer(o, { name: "Rev", phone: "+59171234567", kind: "reseller", priceGroupId: "revendedor" });
      const aid = st.orders.create(o, { customerId: carla.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
      st.engine.s.assignments[aid].customerExpiresAt = Date.now() - 3 * DAY; // venció hace 3 días
      st.engine.s.assignments[aid].control = { cost: 1111, price: 3500 };

      const post = (p, b, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b) });
      const login = async (p, b) => (await post(p, b)).headers.get("set-cookie").split(";")[0];
      const call = (ck) => async (m, p, b) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: b ? JSON.stringify(b) : undefined }); return { status: r.status, text: await r.text() }; };
      const owner = call(await login("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" }));
      assert.equal((await owner("POST", "/api/admin/staff", { username: "ada", name: "Ada", role: "admin", password: "clave-de-ada-12" })).status, 200);
      assert.equal((await owner("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-1" })).status, 200);
      const adminC = call(await login("/api/auth/staff/login", { username: "ada", password: "clave-de-ada-12" }));
      const lucia = call(await login("/api/auth/staff/login", { username: "lucia", password: "clave-de-lucia-1" }));
      const pinOf = async (id) => JSON.parse((await owner("POST", `/api/admin/customers/${id}/login-pin`, {})).text).pin;
      const revC = call(await login("/api/auth/customer/pin", { phone: "71234567", pin: await pinOf(rev.id) }));
      const cliC = call(await login("/api/auth/customer/pin", { phone: "70011223", pin: await pinOf(carla.id) }));

      for (const who of [owner, adminC, lucia]) {
        const r = await who("GET", "/api/admin/winback");
        assert.equal(r.status, 200);
        const j = JSON.parse(r.text);
        assert.equal(j.vencidos.length, 1);
        assert.equal(j.vencidos[0].amount, 3500);
        assert.doesNotMatch(r.text, /accountCost|"cost"|estCost|(?<!\d)4321(?!\d)|(?<!\d)1111(?!\d)|nf-secreto|Clave-Secreta|Andes|supplier/i, "sin costos, proveedores ni datos de la cuenta");
      }
      for (const who of [revC, cliC]) {
        assert.equal((await who("GET", "/api/admin/winback")).status, 403);
        assert.equal((await who("POST", `/api/admin/winback/${carla.id}`, { outcome: "escrito" })).status, 403);
      }
      assert.equal((await lucia("POST", `/api/admin/winback/${carla.id}`, { outcome: "nada" })).status, 400);
      assert.equal((await lucia("POST", `/api/admin/winback/${carla.id}`, { outcome: "escrito" })).status, 200);
      const after = JSON.parse((await owner("GET", "/api/admin/winback")).text);
      assert.equal(after.count, 0, "Atención le escribió: ya no aparece");
      assert.equal(after.written30, 1);
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
