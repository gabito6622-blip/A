// Simulación de 3 meses en el lugar de los revendedores (ago–oct 2026, 15/11/2026): lo que se arregló, con su prueba.
// Datos ficticios, reloj simulado, nada real. Siempre con la separación entre revendedores.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createStore, DAY } from "../dist/store/index.js";
import { ownCategory } from "../dist/store/categoriaPropia.js";

const owner = { id: "u_owner", role: "owner" };
const T0 = Date.UTC(2026, 7, 1, 14); // 01/08/2026 10:00 en Bolivia
const R = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "hbo", name: "HBO Max (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 2000, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "net", name: "Netflix 1 perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { hbo: 1500, net: 2500 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  for (let i = 1; i <= 3; i++) s.inventory.addAccount(owner, { productId: "hbo", supplierId: "andes", email: `hbo.${i}@ficticio.lat`, password: "Clave#" + i, supplierExpiresAt: T0 + 200 * DAY, cost: 4000, profiles: [{ label: "Cuenta completa" }] });
  s.inventory.addAccount(owner, { productId: "net", supplierId: "andes", email: "net.1@ficticio.lat", password: "Clave-Net", supplierExpiresAt: T0 + 200 * DAY, cost: 1000, profiles: [1, 2, 3].map((k) => ({ label: `Perfil ${k}` })) });
  const mk = (name, phone) => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" });
  const marta = mk("Marta Choque", "+59170100001"), beto = mk("Beto Mamani", "+59170100002");
  for (const r of [marta, beto]) s.wallet.adjust(owner, r.id, 50000, "carga ficticia");
  const buy = (r, pid, customerId) => s.orders.create(R(r), { customerId: customerId ?? r.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "balance", idempotencyKey: `${r.id}-${pid}-${Math.random()}` }).assignmentIds[0];
  const accOf = (aid) => s.engine.s.accounts[s.engine.s.slots[s.engine.s.assignments[aid].slotId].accountId];
  return { s, clock, marta, beto, buy, accOf };
}

describe("«✂️ Hoy se corta» también por los clientes del revendedor y al terminar la espera de un pedido", () => {
  test("el Netflix de su cliente registrado: aviso el día del corte, solo al revendedor de ese cliente", () => {
    const { s, clock, marta, beto, buy } = setup();
    const carmen = s.catalog.createCustomer(R(marta), { name: "Carmen Gutiérrez", phone: "+59171200010" });
    const aid = buy(marta, "net", carmen.id);
    const exp = s.engine.s.assignments[aid].customerExpiresAt;
    clock.t = exp + DAY; // vencido, se corta mañana
    assert.equal(s.rmes.rentPush(marta.id), null);
    clock.t = exp + 2 * DAY - 3_600_000; // el día del corte, antes de la hora
    const p = s.rmes.rentPush(marta.id);
    assert.equal(p.title, "✂️ Hoy se corta el Netflix 1 perfil de Carmen");
    assert.match(p.body, /Renovalo hoy/);
    assert.equal(p.url, "/hub#dia");
    assert.equal(s.rmes.rentPush(beto.id), null, "Beto no se entera de los clientes de Marta");
  });

  test("con «Pedir renovación» abierto: no avisa el corte normal; avisa el día que termina la espera, que es cuando se corta", () => {
    const { s, clock, marta, buy, accOf } = setup();
    const hbo = buy(marta, "hbo");
    const exp = s.engine.s.assignments[hbo].customerExpiresAt;
    s.inventory.updateAccount(owner, accOf(hbo).id, { supplierExpiresAt: exp + 5 * DAY }); // el proveedor vence antes
    clock.t = exp - DAY;
    s.rsin.request(R(marta), hbo);
    clock.t = exp + 2 * DAY - 3_600_000; // día del corte normal: el pedido lo frena
    assert.doesNotMatch(s.rmes.rentPush(marta.id)?.title ?? "", /Hoy se corta/);
    const al = s.rmes.rentAlerts(R(marta)).list[0];
    assert.equal(al.cutDaysLeft, 5, "el cartel dice el día en que de verdad se corta");
    clock.t = exp + 7 * DAY - 3_600_000; // último día de la espera
    const p = s.rmes.rentPush(marta.id);
    assert.equal(p.title, "✂️ Hoy se corta tu HBO Max de la tienda");
    assert.match(p.body, /pedido de renovación sigue sin resolverse/);
    s.orders.closeExpired({ id: "system", role: "system" }, 2);
    assert.equal(s.engine.s.assignments[hbo].status, "active", "antes de la hora, todavía no se corta");
    clock.t += 2 * 3_600_000;
    s.orders.closeExpired({ id: "system", role: "system" }, 2);
    assert.equal(s.engine.s.assignments[hbo].status, "revoked", "y ese mismo día se corta: el aviso no mintió");
  });
});

describe("«Que vuelvan» no repite a quien todavía debe", () => {
  test("perfil repartido vencido hace 40 días que debe: está en Cobrar hoy, no en Que vuelvan (y lo dice)", () => {
    const { s, clock, marta, beto, buy } = setup();
    const hbo = buy(marta, "hbo");
    s.subs.save(R(marta), hbo, { name: "Juan Peres", phone: "+59172200002", expiresAt: T0 + 5 * DAY, price: 1500, pay: "pendiente" });
    s.subs.save(R(marta), hbo, { name: "Nina Vela", phone: "+59172200009", expiresAt: T0 + 5 * DAY, price: 1500, pay: "pagado" });
    clock.t = T0 + 45 * DAY;
    const nina = s.engine.s.assignments[hbo].subs.find((x) => x.name === "Nina Vela");
    s.subs.pay(R(marta), hbo, nina.id, 3000); // Nina pagó los dos períodos que usó
    const day = s.rtools.day(R(marta));
    assert.ok(day.cobrar.some((g) => g.client === "Juan Peres"), "Juan está en Cobrar hoy");
    const back = s.rtools.winback(R(marta));
    assert.ok(!back.items.some((x) => x.client === "Juan Peres"), "Juan no sale en Que vuelvan");
    assert.equal(back.owing, 1);
    assert.deepEqual(s.rtools.winback(R(beto)).items, [], "Beto no ve a nadie de Marta");
  });

  test("cuentas propias: el que debe y venció hace más de 30 días sale en «Te deben» de Mi día y no en Que vuelvan", () => {
    const { s, clock, marta } = setup();
    const M = R(marta);
    const p = s.own.saveProduct(M, { name: "Netflix", emoji: "🎬", kind: "profiles", slots: 4, durationDays: 30, price: 3000 });
    s.own.addBulk(M, p.id, "rosa.nf1@ficticio.lat ClaveNf1 31/12");
    const acc = s.own.view(M).accounts[0];
    s.own.assign(M, { accountId: acc.id, name: "Fede Lima", phone: "71000006", price: 3000, pay: "pendiente" });
    s.own.assign(M, { accountId: acc.id, name: "Ana Mamani", phone: "71000001", price: 3000, pay: "pagado" });
    clock.t = T0 + 70 * DAY;
    const d = s.own.day(M);
    assert.ok(d.deben.some((x) => x.name === "Fede Lima"), "Fede (debe y venció hace 40 días) sale en «Te deben»");
    const b = s.own.back(M);
    assert.ok(!b.items.some((x) => x.name === "Fede Lima"));
    assert.ok(b.items.some((x) => x.name === "Ana Mamani"), "Ana no debe: sí sale para que vuelva");
    assert.equal(b.owing, 1);
  });
});

describe("Mi día: cobrar un perfil de una cuenta cortada que ya no debe", () => {
  test("explica que la cuenta se cortó (antes: «Ese servicio no es de un cliente tuyo»); a otro revendedor no le dice nada", () => {
    const { s, clock, marta, beto, buy } = setup();
    const hbo = buy(marta, "hbo");
    s.subs.save(R(marta), hbo, { name: "Nina Vela", phone: "+59172200009", expiresAt: T0 + 40 * DAY, price: 1500, pay: "pagado" });
    const sid = s.engine.s.assignments[hbo].subs[0].id;
    clock.t = s.engine.s.assignments[hbo].customerExpiresAt + 3 * DAY;
    s.orders.closeExpired({ id: "system", role: "system" }, 2);
    assert.equal(s.engine.s.assignments[hbo].status, "revoked");
    assert.throws(() => s.rtools.dayPay(R(marta), `${hbo}|${sid}`, { amount: 1500 }), (e) => e.code === "INVALID_STATE" && /se cortó y no te debe nada/.test(e.message));
    assert.throws(() => s.rtools.dayPay(R(beto), `${hbo}|${sid}`, { amount: 1500 }), (e) => e.code === "NOT_FOUND" && /no es de un cliente tuyo/.test(e.message));
  });
});

describe("cuentas propias: el cliente que vuelve recupera su historial", () => {
  test("mismo WhatsApp: «cliente desde» de la primera vez y lo que pagó antes; otro revendedor no lo hereda", () => {
    const { s, clock, marta, beto } = setup();
    const M = R(marta), B = R(beto);
    for (const who of [M, B]) {
      const p = s.own.saveProduct(who, { name: "Max", emoji: "🟣", kind: "profiles", slots: 3, durationDays: 30, price: 2500 });
      s.own.addBulk(who, p.id, `${who.customerId}.max@ficticio.lat Clave 31/12`);
    }
    const acc = s.own.view(M).accounts[0];
    const first = s.own.assign(M, { accountId: acc.id, name: "Juan Ortiz", phone: "71000010", price: 2500, pay: "pagado" });
    clock.t += 30 * DAY;
    s.own.renew(M, first.id, { paid: true });
    clock.t += 10 * DAY;
    s.own.release(M, first.id, {});
    clock.t += 50 * DAY;
    const again = s.own.assign(M, { accountId: acc.id, name: "Juan Ortiz", phone: "+591 71000010", price: 3000, pay: "pagado" });
    const v = s.own.view(M).sales.find((x) => x.id === again.id);
    assert.equal(v.since, T0);
    assert.equal(v.back.n, 1);
    assert.deepEqual(v.before, { paid: 5000, periods: 2, times: 1 });
    const bacc = s.own.view(B).accounts[0];
    const other = s.own.assign(B, { accountId: bacc.id, name: "Juan Ortiz", phone: "71000010", price: 2500, pay: "pagado" });
    const ov = s.own.view(B).sales.find((x) => x.id === other.id);
    assert.equal(ov.back, undefined, "en la libreta de Beto es un cliente nuevo: no ve nada de Marta");
    assert.equal(ov.before, undefined);
  });
});

describe("página del revendedor: la categoría de sus tarjetas propias", () => {
  test("ya no dice «Mis servicios» (el cliente lo leía como sus propios servicios)", () => {
    assert.equal(ownCategory("Netflix"), "Streaming");
    assert.equal(ownCategory("Max"), "Streaming");
    assert.equal(ownCategory("Spotify Familiar"), "Música");
    assert.equal(ownCategory("Flujo TV", "line"), "TV en vivo");
    assert.equal(ownCategory("Magis TV"), "TV en vivo");
    assert.equal(ownCategory("Canva Pro"), "Servicios");
    const { s, marta } = setup();
    const M = R(marta);
    s.shops.setPage(owner, marta.id, true);
    s.shops.setupFor(owner, marta.id, { slug: "marta-tv", title: "Marta TV", enabled: true });
    const p = s.own.saveProduct(M, { name: "Flujo TV", emoji: "📺", kind: "line", durationDays: 30, price: 4000, onPage: true });
    s.own.addBulk(M, p.id, "flujo_marta01 Pin01 31/12");
    const pub = s.shops.public("marta-tv");
    const card = pub.products.find((x) => x.name === "Flujo TV");
    assert.equal(card.category, "TV en vivo");
    assert.ok(!JSON.stringify(pub).includes("Mis servicios"));
  });
});

describe("pantallas (código del celular)", () => {
  const read = (f) => readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8");
  test("hub-mes.js ya no reexporta la ganancia real: shop.js la toma de cuaderno.js", () => {
    assert.doesNotMatch(read("hub-mes.js"), /earnRealBox/);
    assert.doesNotMatch(read("shop.js"), /earnRealBox/);
    assert.match(read("shop.js"), /gananciaRealBox[^;]*from "\/cuaderno\.js"/);
    assert.match(read("cuaderno.js"), /export function gananciaRealBox/);
  });
  test("«Quién me debe» suma lo propio en el número de arriba", () => {
    const shop = read("shop.js");
    assert.match(shop, /const owedAll = \(S\.data\.rsubs\?\.debts\?\.total \?\? ov\.totals\.owed \?\? 0\) \+ own\.owed/);
    assert.match(read("propias-plata.js"), /export function ownOwed\(\)/);
  });
  test("el número de operación del QR de «Renovar varias» tiene 44 px de alto", () => {
    assert.match(read("shop.css"), /\.rmqr input:not\(\[type=file\]\)\{min-height:44px/);
  });
  test("la fila «Avisá a tus clientes» de cuentas propias sobrevive a cerrar GaboHub y se reinicia en cada cambio", () => {
    const os = read("ownstock.js");
    assert.match(os, /localStorage\.setItem\(NKEY/);
    assert.equal((os.match(/OS\.notified = new Set\(\); saveNotify\(\);/g) ?? []).length, 4);
    assert.match(os, /if \(k === "notifyoff"\) \{ OS\.notify = null; saveNotify\(\);/);
  });
});
