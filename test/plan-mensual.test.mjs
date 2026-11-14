// Que el cliente de la tienda se quede (14/11/2026): renovar todo junto, el combo que no pierde el descuento, el plan
// mensual con un solo día de pago (días proporcionales, sin cobro automático), el aviso del plan, el horario en fallas y
// el aviso de una falla que lleva a la tienda. Reloj controlado, push falso (fetchImpl), carpeta temporal; nada real.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { generateVapidKeys } from "../dist/server/push.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const owner = { id: "u_owner", role: "owner" };
const asC = (c) => ({ id: "u_" + c.id, role: "customer", customerId: c.id });
const asR = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });
const H = 3_600_000, D = 24 * H;
const T0 = Date.UTC(2026, 11, 1, 14, 0); // 01/12/2026 10:00 en Bolivia
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const FCM = "https://fcm.googleapis.com/fcm/send/";
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM", auth: "tBHItJI5svbpez7KI4CCXg" };

describe("plan mensual y combos del cliente de la tienda", () => {
  const clock = { t: T0, now() { return this.t; } };
  const vapid = { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" };
  let dir, app, s, base, ana, bea, dani, carla, rosa, ck = {}, relogin;
  const call = async (m, p, body, who) => {
    const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(who ? { cookie: ck[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    return { status: r.status, json: await r.json().catch(() => null) };
  };
  const mine = (c) => Object.values(s.engine.s.assignments).filter((a) => a.customerId === c.id && a.status === "active").sort((x, y) => x.productId.localeCompare(y.productId));
  const exp = (id) => s.engine.s.assignments[id].customerExpiresAt;
  const bal = (c) => s.wallet.balance(c.id);

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-c3-"));
    app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {}, clock, vapid, fetchImpl: async () => new Response("", { status: 201 }) });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    s = app.store;
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    for (const [id, name, price] of [["nf", "Netflix", 3500], ["dp", "Disney+", 3000], ["sp", "Spotify", 2000]]) {
      s.catalog.upsertProduct(owner, { id, name, kind: "profile", durationDays: 30, price, published: true });
      for (let i = 0; i < 3; i++) s.inventory.addAccount(owner, { productId: id, supplierId: "andes", email: `${id}${i}@ficticio.lat`, password: "Clave-Ficticia#1", supplierExpiresAt: T0 + 400 * D, cost: 1000, profiles: [1, 2, 3, 4].map((n) => ({ label: `P${n}` })) });
    }
    s.catalog.upsertProduct(owner, { id: "familia", name: "Combo Familia", kind: "combo", durationDays: 30, price: 6000, published: true, comboProductIds: ["nf", "dp", "sp"] });
    const mk = (name, phone, extra = {}) => s.catalog.createCustomer(owner, { name, phone, ...extra });
    ana = mk("Ana Combo", "+59170000101"); bea = mk("Bea Armado", "+59170000102"); dani = mk("Dani Fechas", "+59170000103");
    rosa = mk("Rosa TV", "+59170000104", { kind: "reseller" }); carla = s.catalog.createCustomer(asR(rosa), { name: "Carla Cliente", phone: "+59170000105" });
    for (const c of [ana, bea, dani]) s.wallet.adjust(owner, c.id, 30000, "saldo de prueba");
    // Ana compra el combo armado; Bea arma su combo (Netflix + Disney+, −Bs 5); Dani compra suelto en días distintos.
    s.orders.create(asC(ana), { customerId: ana.id, items: [{ productId: "familia", qty: 1 }], paymentMethod: "balance", idempotencyKey: "a1" });
    const ob = s.orders.create(asC(bea), { customerId: bea.id, items: [{ productId: "nf", qty: 1 }, { productId: "dp", qty: 1 }], paymentMethod: "balance", idempotencyKey: "b1" });
    assert.equal(ob.total, 6000, "Armá tu combo: 3500 + 3000 − 500");
    s.orders.create(asC(dani), { customerId: dani.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance", idempotencyKey: "d1" });
    s.orders.create(owner, { customerId: carla.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
    const login = async (c) => {
      await call("POST", `/api/admin/customers/${c.id}/login-pin`, { pin: "2468" }, "owner");
      const r = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: c.phone, pin: "2468" }) });
      return r.headers.get("set-cookie").split(";")[0];
    };
    ck.owner = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    // Con el reloj adelantado las sesiones vencen: se vuelve a entrar.
    relogin = async () => {
      ck.owner = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
      for (const [k, c] of [["ana", ana], ["bea", bea], ["dani", dani], ["carla", carla], ["rosa", rosa]]) ck[k] = await login(c);
    };
    await relogin();
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("lo comprado en combo queda marcado; lo suelto no", () => {
    const a = mine(ana), b = mine(bea), d = mine(dani);
    assert.equal(a.length, 3);
    assert.ok(a.every((x) => x.combo?.productId === "familia" && x.combo.group === a[0].combo.group), "las 3 apps del combo, un solo grupo");
    assert.ok(b.every((x) => x.combo && !x.combo.productId && x.combo.group === b[0].combo.group), "Armá tu combo: grupo sin producto");
    assert.ok(d.every((x) => !x.combo));
  });

  test("renovar el combo junto: precio del combo de hoy; suelto: lista y «juntos te ahorrás»", async () => {
    const ids = mine(ana).map((a) => a.id);
    const all = (await call("POST", "/api/me/renew-all/preview", { ids }, "ana")).json;
    assert.equal(all.total, 6000);
    assert.equal(all.discount, 2500);
    assert.deepEqual(all.rows.map((r) => r.price).reduce((t, v) => t + v, 0), 6000);
    assert.ok(all.rows.every((r) => r.combo === "Disney+ + Netflix + Spotify"));
    const two = (await call("POST", "/api/me/renew-all/preview", { ids: ids.slice(0, 2) }, "ana")).json;
    assert.equal(two.total, 6500, "Disney+ y Netflix sin Spotify: precio de lista");
    assert.deepEqual(two.hints, [{ name: "Disney+ + Netflix + Spotify", missing: ["Spotify"], save: 2500 }]);
    const v = (await call("GET", "/api/me/plan", null, "ana")).json;
    assert.equal(v.groups.length, 1);
    assert.equal(v.groups[0].total, 6000);
    assert.equal(v.groups[0].discount, 2500);
    // Si el dueño sube el combo, vale el precio de HOY (no se inventa otro descuento).
    s.catalog.upsertProduct(owner, { id: "familia", name: "Combo Familia", kind: "combo", durationDays: 30, price: 6500, published: true, comboProductIds: ["nf", "dp", "sp"] });
    assert.equal((await call("POST", "/api/me/renew-all/preview", { ids }, "ana")).json.total, 6500);
    s.catalog.upsertProduct(owner, { id: "familia", name: "Combo Familia", kind: "combo", durationDays: 30, price: 6000, published: false, comboProductIds: ["nf", "dp", "sp"] });
    assert.equal((await call("POST", "/api/me/renew-all/preview", { ids }, "ana")).json.total, 8500, "combo despublicado: sin descuento");
    s.catalog.upsertProduct(owner, { id: "familia", name: "Combo Familia", kind: "combo", durationDays: 30, price: 6000, published: true, comboProductIds: ["nf", "dp", "sp"] });
  });

  test("con saldo: todo o nada; renovado junto paga Bs 60 y cada pedido lleva su parte del descuento", async () => {
    const ids = mine(ana).map((a) => a.id);
    const before = ids.map(exp);
    s.wallet.adjust(owner, ana.id, -bal(ana) + 5000, "dejar Bs 50");
    const poor = await call("POST", "/api/me/renew-all", { ids, paymentMethod: "balance", idempotencyKey: "x1" }, "ana");
    assert.equal(poor.status, 409, JSON.stringify(poor.json));
    assert.deepEqual(ids.map(exp), before, "no se renovó ninguno");
    assert.equal(bal(ana), 5000);
    s.wallet.adjust(owner, ana.id, 5000, "completar");
    const ok = await call("POST", "/api/me/renew-all", { ids, paymentMethod: "balance", idempotencyKey: "x2" }, "ana");
    assert.equal(ok.status, 200, JSON.stringify(ok.json));
    assert.equal(ok.json.total, 6000);
    assert.equal(bal(ana), 4000);
    assert.deepEqual(ids.map(exp), before.map((t) => t + 30 * D));
    const orders = ok.json.orders.map((o) => s.engine.s.orders[o.id]);
    assert.equal(orders.reduce((t, o) => t + o.discount, 0), 2500);
    assert.ok(orders.every((o) => o.status === "fulfilled" && o.kind === "renewal"));
    // Mismo pedido dos veces (doble toque): no cobra dos veces.
    const again = await call("POST", "/api/me/renew-all", { ids, paymentMethod: "balance", idempotencyKey: "x2" }, "ana");
    assert.equal(again.status, 200);
    assert.equal(bal(ana), 4000);
    // Un solo aviso «renovamos…», no tres.
    assert.equal(s.engine.s.outbox.filter((m) => m.customerId === ana.id && m.template === "renewal_confirmed" && m.createdAt === clock.t).length, 1);
  });

  test("suelto desde la tarjeta: precio de lista", async () => {
    const nf = mine(ana).find((a) => a.productId === "nf");
    const r = await call("POST", "/api/me/renew", { assignmentId: nf.id, paymentMethod: "balance", idempotencyKey: "s1" }, "ana");
    assert.equal(r.status, 200);
    assert.equal(r.json.order.total, 3500);
  });

  test("con UN QR: un pedido por servicio, un comprobante y «Aprobar juntos» con el total con descuento", async () => {
    const ids = mine(bea).map((a) => a.id), before = ids.map(exp);
    const r = await call("POST", "/api/me/renew-all", { ids, paymentMethod: "qr", idempotencyKey: "q1" }, "bea");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.total, 6000, "Netflix + Disney+ − Bs 5 de «Armá tu combo» de hoy");
    const oids = r.json.orders.map((o) => o.id);
    assert.equal((await call("POST", "/api/me/renew-many/evidence", { orderIds: oids, contentBase64: PNG, declaredReference: "BEA-77" }, "ana")).status, 403, "otra clienta no manda el comprobante");
    assert.equal((await call("POST", "/api/me/renew-many/evidence", { orderIds: oids, contentBase64: PNG, declaredReference: "BEA-77" }, "bea")).status, 200);
    const g = (await call("GET", "/api/admin/order-groups", null, "owner")).json.find((x) => x.payerId === bea.id);
    assert.equal(g.total, 6000);
    assert.equal((await call("POST", "/api/admin/order-groups/approve", { orderIds: oids, confirmedReference: "BEA-77", amount: 6500 }, "owner")).status, 400, "precio de lista no coincide");
    assert.equal((await call("POST", "/api/admin/order-groups/approve", { orderIds: oids, confirmedReference: "BEA-77", amount: 6000 }, "owner")).status, 200);
    assert.deepEqual(ids.map(exp), before.map((t) => t + 30 * D));
  });

  test("un solo día de pago: se emparejan las fechas y se cobran solo los días que faltan", async () => {
    clock.t = T0 + 10 * D;
    s.orders.create(asC(dani), { customerId: dani.id, items: [{ productId: "dp", qty: 1 }], paymentMethod: "balance", idempotencyKey: "d2" });
    clock.t = T0 + 20 * D;
    s.orders.create(asC(dani), { customerId: dani.id, items: [{ productId: "sp", qty: 1 }], paymentMethod: "balance", idempotencyKey: "d3" });
    clock.t = T0 + 25 * D;
    const [dp, nf, sp] = mine(dani);
    const ids = [nf.id, dp.id, sp.id];
    const pv = (await call("POST", "/api/me/renew-all/preview", { ids, align: true }, "dani")).json;
    assert.equal(pv.until, T0 + 60 * D, "todos hasta un mes después del que vence primero");
    const by = Object.fromEntries(pv.rows.map((r) => [r.product, r]));
    assert.deepEqual([by.Netflix.days, by["Disney+"].days, by.Spotify.days], [30, 20, 10]);
    assert.deepEqual([by.Netflix.price, by["Disney+"].price, by.Spotify.price], [3500, 2000, 666], "proporcional, redondeado hacia abajo al centavo");
    const b0 = bal(dani);
    const r = await call("POST", "/api/me/renew-all", { ids, align: true, plan: true, paymentMethod: "balance", idempotencyKey: "al1" }, "dani");
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(b0 - bal(dani), 6166);
    assert.ok(ids.every((id) => exp(id) === T0 + 60 * D), "mismo día para los tres");
    const v = (await call("GET", "/api/me/plan", null, "dani")).json;
    assert.equal(v.plan.aligned, true);
    assert.equal(v.plan.nextAt, T0 + 60 * D);
    assert.equal(v.plan.total, 8500, "el mes que viene: mes entero de cada uno");
    assert.deepEqual(v.plan.names.sort(), ["Disney+", "Netflix", "Spotify"]);
    // Ya emparejado: «Pagar este mes» es un mes entero para todos.
    const next = (await call("POST", "/api/me/renew-all/preview", { ids, align: true }, "dani")).json;
    assert.deepEqual(next.rows.map((x) => x.days), [30, 30, 30]);
    assert.equal(next.total, 8500);
    // Apagar el plan no cobra ni cambia nada.
    const off = (await call("POST", "/api/me/plan", { on: false }, "dani")).json;
    assert.equal(off.plan, null);
    assert.ok(ids.every((id) => exp(id) === T0 + 60 * D));
    assert.equal((await call("POST", "/api/me/plan", { on: true, ids }, "dani")).json.plan.ids.length, 3);
  });

  test("aviso del plan: 3 días, 1 día y el día, con el toque a «Pagar este mes» y sin montos", async () => {
    assert.equal((await call("POST", "/api/me/push/subscribe", { subscription: { endpoint: FCM + "dani", keys: KEYS } }, "dani")).status, 200);
    const seen = [];
    for (const day of [57, 59, 60]) {
      clock.t = T0 + day * D; // 10:00 de Bolivia de ese día
      await relogin();
      await app.checkExpiryPush();
      seen.push((await call("GET", "/api/me/push/latest", null, "dani")).json);
    }
    assert.deepEqual(seen.map((m) => m.title), ["🔔 Tu plan vence en 3 días (30/01)", "🔔 Tu plan vence mañana (30/01)", "🔔 Tu plan vence hoy (30/01)"]);
    assert.ok(seen.every((m) => m.url === "/tienda/?pagar=plan#cuentas" && /Tocá para pagar este mes/.test(m.body) && !/Bs|\d{2,}\.\d{2}/.test(m.body)));
  });

  test("quién puede: cliente de revendedor, revendedor y lo ajeno", async () => {
    await relogin();
    const carlaA = mine(carla)[0];
    const pv = await call("POST", "/api/me/renew-all/preview", { ids: [carlaA.id] }, "carla");
    assert.equal(pv.status, 400);
    assert.match(pv.json.message, /Rosa TV/, "renueva con su revendedor");
    assert.equal((await call("GET", "/api/me/plan", null, "carla")).json.available, false);
    assert.equal((await call("POST", "/api/me/renew-all/preview", { ids: [carlaA.id] }, "rosa")).status, 403, "un revendedor usa su propio «Renovar varias juntas»");
    assert.equal((await call("POST", "/api/me/renew-all/preview", { ids: [mine(bea)[0].id] }, "ana")).status, 403, "lo de otra clienta no");
    assert.equal((await call("POST", "/api/me/plan", { on: true, ids: [mine(bea)[0].id] }, "ana")).status, 403);
    assert.equal((await call("POST", "/api/me/renew-all", { ids: [mine(ana)[0].id], paymentMethod: "cash" }, "ana")).status, 400, "efectivo no");
    assert.ok([401, 403].includes((await call("GET", "/api/me/plan")).status));
  });

  test("fallas: horario, «Falla reportada · Revisando» y el aviso lleva a la tienda", async () => {
    clock.t = Date.UTC(2026, 11, 2, 3, 30); // 23:30 del 01/12 en Bolivia
    await relogin();
    const nf = mine(ana).find((a) => a.productId === "nf");
    assert.equal((await call("POST", "/api/me/tickets", { assignmentId: nf.id, kind: "no_entra" }, "ana")).status, 200);
    const t = (await call("GET", "/api/me/tickets", null, "ana")).json;
    assert.deepEqual(t.hours, { from: "08:00", to: "22:00", open: false, opensAt: "08:00", opensWhen: "tomorrow" });
    assert.equal((await call("GET", "/api/me/plan", null, "ana")).json.fallas[nf.id], "recibido");
    assert.equal((await call("POST", "/api/me/push/subscribe", { subscription: { endpoint: FCM + "ana", keys: KEYS } }, "ana")).status, 200);
    const tk = s.engine.s.tickets[Object.keys(s.engine.s.tickets).find((k) => s.engine.s.tickets[k].assignmentId === nf.id)];
    assert.equal((await call("POST", `/api/admin/tickets/${tk.id}`, { status: "revisando" }, "owner")).status, 200);
    assert.equal((await call("GET", "/api/me/push/latest", null, "ana")).json.url, "/tienda/#fallas");
    assert.equal((await call("GET", "/api/me/plan", null, "ana")).json.fallas[nf.id], "revisando");
    // El revendedor sigue yendo a GaboHub.
    const ra = s.orders.create(owner, { customerId: rosa.id, items: [{ productId: "sp", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    await call("POST", "/api/me/tickets", { assignmentId: ra, kind: "otro" }, "rosa");
    assert.equal((await call("POST", "/api/me/push/subscribe", { subscription: { endpoint: FCM + "rosa", keys: KEYS } }, "rosa")).status, 200);
    const rt = Object.values(s.engine.s.tickets).find((x) => x.assignmentId === ra);
    await call("POST", `/api/admin/tickets/${rt.id}`, { status: "revisando" }, "owner");
    assert.equal((await call("GET", "/api/me/push/latest", null, "rosa")).json.url, "/hub#fallas");
    // Con el horario del bot y de día: abierto.
    clock.t = Date.UTC(2026, 11, 2, 15, 0);
    s.chats.updateBotSettings(owner, { humanHours: { from: 9, to: 21 } });
    assert.deepEqual((await call("GET", "/api/me/tickets", null, "ana")).json.hours, { from: "09:00", to: "21:00", open: true });
  });
});
