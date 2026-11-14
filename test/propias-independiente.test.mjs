// Revendedor INDEPENDIENTE que vive de SUS cuentas propias (14/11/2026): lo mismo que el dueño tiene en su panel.
// Cubre (núcleo y HTTP): deudas que no se borran (cargos y pagos parciales, «Renovó» sin pago acumula, liberar frena
// si debe), cuenta caída o vencida con su proveedor (no se vende ni sale en su página), mover uno y mover todos
// (misma fecha, precio, deuda y link), su día con lo ya vencido, «Pagué a mi proveedor» y «Mis ganancias» por mes,
// deshacer «Renovó», renovar tarde desde el vencimiento, «Que vuelvan», combos con sus productos propios, que el
// dueño no vea códigos de sus correos propios, y la separación entre revendedores (núcleo y rutas).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";
import { ownSoonFor, ownPushText } from "../dist/store/ownAlerts.js";

const owner = { id: "u_owner", role: "owner" };
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));
const asR = (c) => ({ id: "web:" + c.id, role: "reseller", customerId: c.id });
const T0 = Date.UTC(2026, 7, 1, 14); // 01/08/2026 10:00 en Bolivia

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  const rosa = s.catalog.createCustomer(owner, { name: "Rosa Quispe", phone: "+59171111111", kind: "reseller" });
  const otro = s.catalog.createCustomer(owner, { name: "Otro Vendedor", phone: "+59172222222", kind: "reseller" });
  s.catalog.setResellerTrust(owner, rosa.id, "independent");
  const R = asR(rosa);
  const nf = s.own.saveProduct(R, { name: "Netflix", emoji: "🎬", kind: "profiles", slots: 4, durationDays: 30, price: 3000, onPage: true });
  s.own.addBulk(R, nf.id, "rosa.nf1@ficticio.lat ClaveNf1 31/08\nrosa.nf2@ficticio.lat ClaveNf2 20/09");
  const acc = (u) => s.own.view(R).accounts.find((a) => a.user === u);
  return { clock, s, rosa, otro, R, nf, acc };
}

describe("deudas de cuentas propias: cargos y pagos (núcleo)", () => {
  const t = setup();
  const { s, R, acc, clock } = t;
  let ana;
  test("«Renovó» sin pago acumula; los pagos pueden ser parciales; «Me pagó» sin monto paga todo", () => {
    ana = s.own.assign(R, { accountId: acc("rosa.nf1@ficticio.lat").id, name: "Ana Mamani", phone: "71000001", price: 3000, pay: "pendiente" });
    assert.equal(s.own.view(R).sales[0].debt, 3000, "el primer período es un cargo");
    clock.t = T0 + 29 * DAY;
    const r1 = s.own.renew(R, ana.id, { paid: false });
    assert.equal(r1.debt, 6000, "Renovó + me paga después: se suma, no se borra lo anterior");
    assert.equal(r1.pay, "pendiente");
    assert.equal(s.own.pay(R, ana.id, { amount: 1000 }).debt, 5000, "pago parcial");
    assert.throws(() => s.own.pay(R, ana.id, { amount: 9000 }), err("VALIDATION", /más de lo que te debe/));
    assert.equal(s.own.view(R).totals.owed, 5000);
    // «Sí, pagó Bs 30» al renovar: paga ese período; lo viejo sigue.
    const r2 = s.own.renew(R, ana.id, { paid: true, amount: 3000 });
    assert.equal(r2.debt, 5000);
    s.own.updateSale(R, ana.id, { pay: "pagado" });
    assert.equal(s.own.view(R).sales.find((x) => x.id === ana.id).debt, 0, "«Me pagó» sin monto paga todo");
    clock.t = T0;
  });

  test("liberar frena si debe; «Quién me debe» conserva la deuda; perdonar la borra con un movimiento", () => {
    const beto = s.own.assign(R, { accountId: acc("rosa.nf1@ficticio.lat").id, name: "Beto Choque", phone: "71000002", price: 3000, pay: "pendiente" });
    assert.throws(() => s.own.release(R, beto.id), err("INVALID_STATE", /Beto te debe Bs 30: ¿lo pasás a Quién me debe o lo perdonás\?/));
    assert.equal(s.own.release(R, beto.id, { debt: "fiado" }).debt, 3000);
    const v = s.own.view(R);
    assert.ok(!v.sales.some((x) => x.id === beto.id), "el cupo quedó libre");
    assert.deepEqual(v.gone.map((g) => [g.name, g.debt]), [["Beto Choque", 3000]], "la deuda sigue");
    assert.equal(v.totals.owed, 3000);
    assert.equal(s.own.pay(R, beto.id, { amount: 1000 }).debt, 2000, "puede pagar después de liberado");
    s.own.forgive(R, beto.id);
    assert.equal(s.own.view(R).gone.length, 0);
    const day = s.own.day(R);
    assert.ok(!day.deben.some((x) => x.id === beto.id));
  });

  test("ventas de antes del libro: su «pendiente» cuenta como deuda y se pasan al libro la primera vez", () => {
    const b = s.engine.s.ownStock[t.rosa.id];
    const old = { id: "osl_viejo", accountId: acc("rosa.nf2@ficticio.lat").id, slot: 4, name: "Vieja Venta", phone: "+59171000099", expiresAt: T0 + 10 * DAY, price: 2500, pay: "pendiente", createdAt: T0 - 5 * DAY };
    b.sales.push(old);
    assert.equal(s.own.view(R).sales.find((x) => x.id === old.id).debt, 2500);
    s.own.pay(R, old.id, { amount: 500 });
    assert.equal(s.own.view(R).sales.find((x) => x.id === old.id).debt, 2000);
    assert.ok(b.sales.every((x) => x.led), "todas quedaron en el libro");
  });
});

describe("cuenta caída o vencida con su proveedor; mover clientes (núcleo)", () => {
  const t = setup();
  const { s, R, acc, clock, nf } = t;
  let carla, dani, link;
  before(() => {
    carla = s.own.assign(R, { accountId: acc("rosa.nf1@ficticio.lat").id, name: "Carla Rojas", phone: "71000003", price: 3000, pay: "pendiente", expiresAt: T0 + 20 * DAY });
    dani = s.own.assign(R, { accountId: acc("rosa.nf1@ficticio.lat").id, name: "Dani Paz", phone: "71000004", price: 2500, pay: "pagado" });
    link = s.own.link(R, carla.id).token;
  });

  test("«Se cayó esta cuenta»: no se asigna, no cuenta en «Cupos libres» ni sale disponible en su página", () => {
    const shopBefore = s.own.view(R).products[0].free;
    s.own.setDown(R, acc("rosa.nf1@ficticio.lat").id, { down: true, note: "bloqueada" });
    const v = s.own.view(R);
    const a = v.accounts.find((x) => x.user === "rosa.nf1@ficticio.lat");
    assert.deepEqual([a.free, a.blocked, a.empty], [[], "caida", 2]);
    assert.equal(v.products[0].free, shopBefore - 2, "sus 2 cupos vacíos ya no se ofrecen");
    assert.throws(() => s.own.assign(R, { accountId: a.id, name: "Nuevo", phone: "71000077" }), err("OUT_OF_STOCK", /se cayó/));
    assert.throws(() => s.own.renew(R, carla.id), err("INVALID_STATE", /mové a tu cliente/));
    assert.equal(v.sales.find((x) => x.id === carla.id).blocked, "caida");
  });

  test("«Mover a otra cuenta»: misma fecha, precio, deuda y link de cobro; no a otro producto ni a una caída", () => {
    const to = acc("rosa.nf2@ficticio.lat");
    const before = s.own.view(R).sales.find((x) => x.id === carla.id);
    const r = s.own.move(R, carla.id, { accountId: to.id });
    assert.equal(r.user, "rosa.nf2@ficticio.lat");
    const after = s.own.view(R).sales.find((x) => x.id === carla.id);
    assert.deepEqual([after.expiresAt, after.price, after.debt, after.linkToken, after.accountId], [before.expiresAt, before.price, 3000, link, to.id], "días regalados: 0");
    const max = s.own.saveProduct(R, { name: "Max", kind: "profiles", slots: 3, durationDays: 30, price: 2500 });
    s.own.saveAccount(R, { productId: max.id, user: "rosa.max1@ficticio.lat", password: "ClaveMax1" });
    assert.throws(() => s.own.move(R, dani.id, { accountId: s.own.view(R).accounts.find((x) => x.user === "rosa.max1@ficticio.lat").id }), err("VALIDATION", /mismo producto/));
    assert.throws(() => s.own.move(R, carla.id, { accountId: acc("rosa.nf1@ficticio.lat").id }), err("OUT_OF_STOCK", /se cayó/));
  });

  test("«Mover todos»: reparte en cupos libres; los que no entran quedan avisados", () => {
    s.own.addBulk(R, nf.id, "rosa.nf3@ficticio.lat ClaveNf3 30/09");
    const nf3 = acc("rosa.nf3@ficticio.lat");
    // Llenamos nf2 y nf3 para que quede 1 solo cupo libre en total.
    for (let i = 0; i < 2; i++) s.own.assign(R, { accountId: acc("rosa.nf2@ficticio.lat").id, name: `Relleno ${i}`, phone: `7100010${i}` });
    for (let i = 0; i < 3; i++) s.own.assign(R, { accountId: nf3.id, name: `Relleno3 ${i}`, phone: `7100020${i}` });
    const was = s.own.view(R).sales.find((x) => x.id === dani.id);
    // nf2: 4 cupos (Carla + 2 rellenos = 3) → 1 libre; nf3: 3 de 4 → 1 libre. Dani entra; no queda nadie afuera.
    const r = s.own.moveAll(R, acc("rosa.nf1@ficticio.lat").id);
    assert.deepEqual([r.moved.map((x) => x.name), r.left], [["Dani Paz"], []]);
    const now = s.own.view(R).sales.find((x) => x.id === dani.id);
    assert.deepEqual([now.expiresAt, now.price, now.debt], [was.expiresAt, was.price, was.debt]);
    assert.equal(s.own.view(R).accounts.find((x) => x.user === "rosa.nf1@ficticio.lat").empty, 4);
  });

  test("vencida con su proveedor: tampoco se vende; «Pagué a mi proveedor» la habilita y corre la fecha desde el vencimiento", () => {
    const a = acc("rosa.nf2@ficticio.lat");
    clock.t = Date.UTC(2026, 8, 22, 14); // 22/09: venció el 20/09
    assert.equal(acc("rosa.nf2@ficticio.lat").blocked, "vencida");
    assert.throws(() => s.own.assign(R, { accountId: a.id, name: "X", phone: "71000088" }), err("OUT_OF_STOCK", /venció con tu proveedor/));
    const r = s.own.providerPay(R, a.id, { amount: 8000, months: 1 });
    assert.equal(r.providerExpiresAt, a.providerExpiresAt + 30 * DAY, "desde el vencimiento (dentro del plazo), no desde hoy");
    assert.equal(acc("rosa.nf2@ficticio.lat").blocked, null);
    assert.equal(acc("rosa.nf2@ficticio.lat").cost, 8000, "queda anotado el costo");
    clock.t = T0;
  });

  test("su página: la cuenta caída no suma disponibles", () => {
    s.shops.setPage(owner, t.rosa.id, true);
    s.shops.update(R, { slug: "rosa-tv", title: "Rosa TV", whatsapp: "+59171111111", enabled: true });
    const card = s.shops.public("rosa-tv").products.find((p) => p.name === "Netflix");
    const v = s.own.view(R);
    assert.equal(card.available, v.products.find((p) => p.name === "Netflix").free);
    assert.ok(v.accounts.find((x) => x.user === "rosa.nf1@ficticio.lat").empty > 0 && card.available < 6);
    s.own.setDown(R, acc("rosa.nf1@ficticio.lat").id, { down: false });
    assert.equal(s.shops.public("rosa-tv").products.find((p) => p.name === "Netflix").available, card.available + 4, "volvió: se ofrece de nuevo");
  });
});

describe("su día, aviso al celular, ganancias, deshacer, renovar tarde y que vuelvan (núcleo)", () => {
  const t = setup();
  const { s, R, acc, clock, rosa } = t;
  let eli, fede;
  before(() => {
    eli = s.own.assign(R, { accountId: acc("rosa.nf1@ficticio.lat").id, name: "Eli Vargas", phone: "71000005", price: 3000, pay: "pagado", expiresAt: T0 + 30 * DAY });
    fede = s.own.assign(R, { accountId: acc("rosa.nf1@ficticio.lat").id, name: "Fede Lima", phone: "71000006", price: 3000, pay: "pendiente", expiresAt: T0 + 30 * DAY });
    s.own.providerPay(R, acc("rosa.nf1@ficticio.lat").id, { amount: 8000, months: 1, extend: false });
  });

  test("Mi día y el aviso: lo ya vencido (clientes y cuenta con su proveedor) sigue apareciendo; nunca «todo al día»", () => {
    clock.t = Date.UTC(2026, 8, 2, 14); // 02/09: vencieron el 31/08 los dos clientes y la cuenta
    const d = s.own.day(R);
    assert.deepEqual(d.cobrar.map((x) => [x.name, x.days]), [["Eli Vargas", -2], ["Fede Lima", -2]]);
    assert.deepEqual(d.provider.map((a) => [a.user, a.days, a.clients]), [["rosa.nf1@ficticio.lat", -2, 2]]);
    assert.ok(d.counts.late >= 3);
    assert.equal(d.totals.cobrar, 3000 + 6000, "Eli renueva (30); Fede debe 30 y renueva (30)");
    const o = ownSoonFor(s.engine, rosa.id);
    assert.equal(o.clients.filter((c) => c.late).length, 2);
    assert.equal(o.provider.filter((a) => a.late).length, 1);
    assert.match(ownPushText(o).title, /3 ya vencido/);
    clock.t = T0;
  });

  test("Renovó tarde dentro del plazo corre desde el vencimiento; «deshacer» vuelve todo atrás", () => {
    clock.t = Date.UTC(2026, 8, 5, 14); // 05/09, venció el 31/08
    const r = s.own.renew(R, eli.id, { paid: true });
    assert.equal(r.from, eli.expiresAt, "no regala días");
    assert.equal(r.expiresAt, eli.expiresAt + 30 * DAY);
    const u = s.own.undoRenew(R, eli.id, r.undo);
    assert.deepEqual([u.expiresAt, u.debt], [eli.expiresAt, 0]);
    assert.throws(() => s.own.undoRenew(R, eli.id, r.undo), err("INVALID_STATE"));
    const r2 = s.own.renew(R, eli.id, { paid: true });
    clock.t += 3 * 60_000;
    assert.throws(() => s.own.undoRenew(R, eli.id, r2.undo), err("INVALID_STATE", /Ya no/), "después de 2 minutos ya no");
    clock.t = T0;
  });

  test("Mis ganancias: por mes entró − pagaste = te quedó, y lo que le debían al cerrar", () => {
    clock.t = Date.UTC(2026, 8, 10, 14);
    const g = s.own.earnings(R);
    const ago = g.months.find((m) => m.month === "2026-08"), sep = g.months.find((m) => m.month === "2026-09");
    assert.deepEqual([ago.in, ago.out, ago.kept, ago.owed], [3000, 8000, -5000, 3000]);
    assert.deepEqual([sep.in, sep.out, sep.kept], [3000, 0, 3000], "la renovación de Eli (deshecha y vuelta a hacer) cuenta una vez");
    const book = s.own.earnings(R, "2026-08");
    assert.ok(book.ledger.some((x) => x.kind === "proveedor" && x.amount === 8000));
    assert.ok(book.ledger.some((x) => x.kind === "pago" && x.name === "Eli Vargas"));
    assert.ok(!JSON.stringify(book).includes("ClaveNf"), "sin contraseñas");
    clock.t = T0;
  });

  test("Que vuelvan: vencidos hace más de 30 días y liberados; «Ya le escribí» los calla 7 días", () => {
    s.own.release(R, fede.id, { debt: "fiado" });
    clock.t = Date.UTC(2026, 9, 15, 14); // 15/10
    const b = s.own.back(R);
    assert.ok(b.items.some((x) => x.name === "Fede Lima" && x.released));
    s.own.markBack(R, `g:${fede.id}`);
    assert.ok(!s.own.back(R).items.some((x) => x.name === "Fede Lima"));
    assert.equal(s.own.back(R).written, 1);
    assert.throws(() => s.own.markBack(R, "g:osl_no_existe"), err("NOT_FOUND"));
    clock.t = T0;
  });
});

describe("combos con sus productos propios y códigos de sus correos (núcleo)", () => {
  const t = setup();
  const { s, R, rosa, nf } = t;
  test("arma un combo con SUS productos y su página lo muestra en su moneda; no mezcla con apps de la tienda", () => {
    const tv = s.own.saveProduct(R, { name: "Flujo TV", kind: "line", durationDays: 30, price: 4000, onPage: true });
    s.own.saveAccount(R, { productId: tv.id, user: "flujo_rosa01", password: "PinTv01" });
    s.shops.setPage(owner, rosa.id, true);
    s.shops.update(R, { slug: "rosa-tv", title: "Rosa TV", whatsapp: "+59171111111", enabled: true, combos: [{ name: "Netflix + TV", productIds: [`op_${nf.id}`, `op_${tv.id}`], price: 6000 }] });
    const card = s.shops.public("rosa-tv").products.find((p) => p.category === "Combos");
    assert.deepEqual([card.name, card.price, card.items, card.available], ["Netflix + TV", 6000, ["Netflix", "Flujo TV"], 1]);
    assert.ok(!JSON.stringify(card).match(/Clave|flujo_rosa01|cost/i));
    assert.throws(() => s.shops.update(R, { combos: [{ name: "Mezcla", productIds: [`op_${nf.id}`, "netflix"], price: 5000 }] }), err("VALIDATION", /mezcla/));
    assert.throws(() => s.shops.update(R, { combos: [{ name: "Fantasma", productIds: [`op_${nf.id}`, "op_opr_x"], price: 5000 }] }), err("VALIDATION", /ya no existe/));
  });

  test("el dueño no ve en su lista los códigos que lleguen de un correo de cuenta propia", () => {
    const mb = s.codes.configureMailbox(owner, { address: "codigos@tienda.ficticio", host: "imap.ficticio.lat" });
    const sys = { id: "system", role: "system" };
    s.codes.ingest(sys, mb.id, { to: "rosa.nf1@ficticio.lat", from: "info@account.netflix.com", subject: "Tu código de inicio de sesión", body: "Código 4321", receivedAt: T0 });
    s.codes.ingest(sys, mb.id, { to: "otra@tienda.ficticio", from: "info@account.netflix.com", subject: "Tu código de inicio de sesión", body: "Código 1111", receivedAt: T0 });
    const list = s.codes.recent(owner, 60);
    assert.ok(!list.some((c) => c.to === "rosa.nf1@ficticio.lat"), "solo Rosa ve lo de sus cuentas propias");
    assert.ok(list.some((c) => c.to === "otra@tienda.ficticio"));
  });
});

describe("separación entre revendedores y permisos (núcleo y HTTP)", () => {
  const t = setup();
  const { s, R, acc, otro } = t;
  let sale, dir, app, base, ck = {};
  before(async () => {
    sale = s.own.assign(R, { accountId: acc("rosa.nf1@ficticio.lat").id, name: "Gabi Soto", phone: "71000007", price: 3000, pay: "pendiente" });
  });
  after(async () => { await app?.close(); if (dir) rmSync(dir, { recursive: true, force: true }); });

  test("en el núcleo: otro revendedor, un cliente y el equipo no tocan nada de Rosa", () => {
    const O = asR(otro);
    for (const f of [() => s.own.pay(O, sale.id, { amount: 100 }), () => s.own.forgive(O, sale.id), () => s.own.move(O, sale.id, { accountId: acc("rosa.nf2@ficticio.lat").id }),
      () => s.own.moveAll(O, acc("rosa.nf1@ficticio.lat").id), () => s.own.setDown(O, acc("rosa.nf1@ficticio.lat").id, {}), () => s.own.providerPay(O, acc("rosa.nf1@ficticio.lat").id, { amount: 100 }),
      () => s.own.undoRenew(O, sale.id, "x"), () => s.own.markBack(O, `s:${sale.id}`)]) assert.throws(f, err("NOT_FOUND"));
    assert.deepEqual([s.own.day(O).cobrar.length, s.own.day(O).has, s.own.earnings(O).months.every((m) => !m.in && !m.out), s.own.back(O).items.length], [0, false, true, 0]);
    const cli = s.catalog.createCustomer(R, { name: "Cliente de Rosa", phone: "71000055" });
    for (const actor of [owner, { id: "u_s", role: "seller" }, { id: "c", role: "customer", customerId: cli.id }]) {
      assert.throws(() => s.own.day(actor), (e) => e instanceof DomainError);
      assert.throws(() => s.own.earnings(actor), (e) => e instanceof DomainError);
      assert.throws(() => s.own.pay(actor, sale.id, {}), (e) => e instanceof DomainError);
    }
  });

  test("por HTTP: sin sesión 401, el equipo no entra, otro revendedor 404; liberar con deuda da 409 con la pregunta", async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-r3-"));
    app = createApp({ dataDir: dir, staticDir: new URL("../public/", import.meta.url).pathname, jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const st = app.store, own = { id: Object.keys(st.engine.s.staff)[0], role: "owner" };
    const mk = (name, phone) => st.catalog.createCustomer(own, { name, phone, kind: "reseller" });
    const a = mk("Rosa Http", "+59171111999"), b = mk("Otro Http", "+59172222999");
    const A = asR(a);
    const p = st.own.saveProduct(A, { name: "Netflix", kind: "profiles", slots: 2, durationDays: 30, price: 3000 });
    st.own.saveAccount(A, { productId: p.id, user: "h1@ficticio.lat", password: "Clave-H1" });
    st.own.saveAccount(A, { productId: p.id, user: "h2@ficticio.lat", password: "Clave-H2" });
    const accs = st.own.view(A).accounts;
    const sl = st.own.assign(A, { accountId: accs[0].id, name: "Hugo Paz", phone: "71000008", price: 3000, pay: "pendiente" });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const call = async (method, path, body, who) => { const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(who ? { cookie: ck[who] } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const post = (p, body, c) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(c ? { cookie: c } : {}) }, body: JSON.stringify(body) });
    ck.owner = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    for (const [k, c] of [["a", a], ["b", b]]) {
      const { pin } = await (await post(`/api/admin/customers/${c.id}/login-pin`, {}, ck.owner)).json();
      ck[k] = (await post("/api/auth/customer/pin", { phone: c.phone, pin })).headers.get("set-cookie").split(";")[0];
    }
    const routes = [["POST", `/api/me/own/sales/${sl.id}/pay`, { amount: 100 }], ["POST", `/api/me/own/sales/${sl.id}/forgive`, {}], ["POST", `/api/me/own/sales/${sl.id}/move`, { accountId: accs[1].id }],
      ["POST", `/api/me/own/accounts/${accs[0].id}/move-all`, {}], ["POST", `/api/me/own/accounts/${accs[0].id}/down`, { down: true }], ["POST", `/api/me/own/accounts/${accs[0].id}/provider-pay`, { amount: 100 }],
      ["POST", `/api/me/own/sales/${sl.id}/renew/undo`, { undo: "x" }], ["POST", "/api/me/own/back", { key: `s:${sl.id}` }]];
    for (const [m, path, body] of routes) {
      assert.equal((await call(m, path, body)).status, 401, `${path} sin sesión`);
      assert.equal((await call(m, path, body, "b")).status, 404, `${path} de otro revendedor`);
      assert.ok((await call(m, path, body, "owner")).status >= 400, `${path} del equipo`);
    }
    for (const path of ["/api/me/own/day", "/api/me/own/back", "/api/me/own/earnings"]) {
      assert.equal((await call("GET", path)).status, 401);
      assert.ok((await call("GET", path, null, "owner")).status >= 400);
      const other = await call("GET", path, null, "b");
      assert.equal(other.status, 200);
      assert.ok(!JSON.stringify(other.json).includes("Hugo"), `${path}: otro no ve a Hugo`);
    }
    const rel = await call("POST", `/api/me/own/sales/${sl.id}/release`, {}, "a");
    assert.equal(rel.status, 409);
    assert.match(rel.json.message, /Hugo te debe Bs 30: ¿lo pasás a Quién me debe o lo perdonás\?/);
    const ren = await call("POST", `/api/me/own/sales/${sl.id}/renew`, { paid: false }, "a");
    assert.deepEqual([ren.status, ren.json.debt], [200, 6000]);
    assert.equal((await call("POST", `/api/me/own/sales/${sl.id}/renew/undo`, { undo: ren.json.undo }, "a")).json.debt, 3000);
    assert.equal((await call("POST", `/api/me/own/sales/${sl.id}/pay`, { amount: 1000 }, "a")).json.debt, 2000);
    const day = (await call("GET", "/api/me/own/day", null, "a")).json;
    assert.equal(day.owed, 2000);
    assert.ok(!JSON.stringify(day).includes("Clave-H"), "Mi día no lleva contraseñas");
    const mv = await call("POST", `/api/me/own/sales/${sl.id}/move`, { accountId: accs[1].id }, "a");
    assert.equal(mv.json.user, "h2@ficticio.lat");
    assert.equal((await call("POST", `/api/me/own/sales/${sl.id}/release`, { debt: "fiado" }, "a")).status, 200);
    assert.equal((await call("GET", "/api/me/own", null, "a")).json.totals.owed, 2000, "la deuda no se borra al liberar");
  });
});
