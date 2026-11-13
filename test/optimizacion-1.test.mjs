// Optimización 1 (13/11/2026), sobre Premium 2.0 ya publicado. Datos ficticios; reloj controlado; nada real.
//  1. Semáforo: una cuenta con todos los perfiles dados de baja (caída) ya no es alerta roja; retirada tampoco. No se borra nada.
//  2. «Me pagó» desde Mi secretaria: la vista previa dice cliente, cuenta, monto, período y fecha nueva; frena si el período
//     ya se cobró, si hubo un cobro hace minutos o si la fecha nueva pasa la del proveedor; guarda una sola vez (idempotente),
//     corre la fecha, marca pagado, limpia «EN COBRO» de la nota y Finanzas lo cuenta UNA vez.
//  3. Cierre de mes: si el mes anterior está incompleto (la tienda empezó a registrar después del día 1) no se muestra %.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { riskOf } from "../dist/store/inventario.js";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" }, seller = { id: "u_seller", role: "seller" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const NOV1 = Date.UTC(2026, 10, 1, 4), NOW = NOV1 + 12 * DAY + 14 * HOUR; // 13/11 14:00 Bolivia

function world(start = NOV1 - 40 * DAY) {
  const clock = { t: start, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "disney-alq", name: "Disney (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { "disney-alq": 6600, netflix: 3000 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
  const at = (t) => { clock.t = t; };
  const add = (productId, email, extra = {}) => s.inventory.addAccount(owner, { productId, supplierId: "prov", email, password: "Clave#Secreta1", supplierExpiresAt: clock.t + 90 * DAY, cost: 2000, profiles: productId === "netflix" ? [1, 2, 3].map((k) => ({ label: `P${k}` })) : [{ label: "Cuenta completa" }], ...extra });
  const rev = s.catalog.createCustomer(owner, { name: "ARIt", phone: "+59170000001", kind: "reseller", priceGroupId: "revendedor" });
  const buy = (cid, productId, t) => { at(t); return s.orders.create(owner, { customerId: cid, items: [{ productId, qty: 1 }], paymentMethod: "cash" }); };
  return { s, clock, at, add, rev, buy };
}

describe("optimización 1 · semáforo", () => {
  test("cuenta con todos los perfiles dados de baja = «dada de baja», no roja; retirada igual; una viva con nota CAÍDA sigue roja", () => {
    const { s, add } = world();
    const E = () => s.engine.s;
    const caida = add("disney-alq", "caida@x.lat", { notes: "⛔ CAÍDA · NO VENDER" });
    s.inventory.setSlotStatus(owner, caida.slots[0].id, "retired", "caída");
    const r = riskOf(s.engine, E().accounts[caida.account.id]);
    assert.deepEqual(r, { level: "ok", reasons: [], inactive: true });
    assert.equal(E().accounts[caida.account.id].status, "active", "la cuenta no se borró ni se retiró");
    assert.equal(E().slots[caida.slots[0].id].status, "retired", "el perfil sigue dado de baja (historial intacto)");
    const viva = add("disney-alq", "viva@x.lat", { notes: "⛔ CAÍDA · NO VENDER" });
    assert.equal(riskOf(s.engine, E().accounts[viva.account.id]).level, "bad", "con un perfil vivo y la nota, sigue siendo alerta");
    const list = s.inventory.listAccounts(owner);
    assert.equal(list.find((a) => a.id === caida.account.id).risk.inactive, true);
  });
});

describe("optimización 1 · «Me pagó» desde la secretaria", () => {
  test("vista previa completa; frenos por período ya cobrado, cobro reciente y proveedor; guarda una vez; Finanzas lo cuenta una vez", () => {
    const w = world();
    const { s, at, rev } = w;
    const E = () => s.engine.s;
    w.add("disney-alq", "dis1@x.lat", { supplierExpiresAt: NOV1 + 100 * DAY });
    const o = w.buy(rev.id, "disney-alq", NOV1 - 20 * DAY); // venció el 11/11 (NOV1 + 10 d)
    const asg = o.assignmentIds[0];
    at(NOV1 + 11 * DAY); s.orders.setControl(owner, asg, { note: "🔔 EN COBRO desde 12/11 (venció 11/11). Ya avisada", payStatus: "pendiente" });
    at(NOW);
    const pv = s.cobro.preview(owner, asg);
    assert.equal(pv.ok, true, pv.blockers.join());
    assert.deepEqual([pv.customer.name, pv.payer.isReseller, pv.email, pv.product, pv.price, pv.currency, pv.periods, pv.days], ["ARIt", true, "dis1@x.lat", "Disney (alquiler revendedores)", 6600, "BOB", 1, 30]);
    assert.equal(pv.from, NOW, "venció: el período nuevo arranca hoy"); assert.equal(pv.to, NOW + 30 * DAY); assert.equal(pv.expiredDays, 2);
    assert.throws(() => s.cobro.preview(seller, asg), err("FORBIDDEN"), "Atención no cobra");
    assert.throws(() => s.cobro.preview(owner, asg, { periods: 13 }), err("VALIDATION"));
    // Guardar (con llave): corre la fecha, marca pagado, limpia la nota, audita.
    const ing0 = s.finance.report(owner, 1).current.ingresos;
    const r1 = s.cobro.apply(owner, asg, { idempotencyKey: "k1" });
    assert.deepEqual([r1.saved.from, r1.saved.to, r1.saved.price], [NOV1 + 10 * DAY, NOW + 30 * DAY, 6600]);
    const a = E().assignments[asg];
    assert.equal(a.customerExpiresAt, NOW + 30 * DAY);
    assert.equal(a.control.payStatus, "pagado");
    assert.ok(!/EN COBRO/.test(a.control.note) && /💵 pagado 13\/11/.test(a.control.note), a.control.note);
    assert.equal(a.control.paidLog.length, 1);
    assert.equal(s.finance.report(owner, 1).current.ingresos - ing0, 6600, "Finanzas suma el cobro una vez");
    assert.equal(E().audit.filter((x) => x.action === "secretary.paid").length, 1);
    // Doble toque con la misma llave: misma respuesta, sin segundo cobro.
    const r2 = s.cobro.apply(owner, asg, { idempotencyKey: "k1" });
    assert.equal(r2.saved.to, r1.saved.to); assert.equal(E().assignments[asg].control.paidLog.length, 1);
    // Otra llave 1 minuto después: freno por cobro reciente; y al rato, el período siguiente sí se puede.
    at(NOW + 60_000);
    const pv2 = s.cobro.preview(owner, asg);
    assert.equal(pv2.ok, false); assert.match(pv2.blockers[0], /hace 1 min/);
    assert.throws(() => s.cobro.apply(owner, asg, { idempotencyKey: "k2" }), err("VALIDATION"));
    at(NOW + 2 * HOUR);
    const pv3 = s.cobro.preview(owner, asg);
    assert.equal(pv3.ok, true); assert.equal(pv3.from, NOW + 30 * DAY, "el siguiente período arranca donde termina el pagado");
    // Freno por proveedor: 3 períodos pasan la fecha del proveedor (NOV1 + 100 d).
    const pv4 = s.cobro.preview(owner, asg, { periods: 3 });
    assert.equal(pv4.ok, false); assert.match(pv4.blockers[0], /vence con el proveedor/);
    assert.throws(() => s.cobro.apply(owner, asg, { periods: 3, idempotencyKey: "k3" }), err("VALIDATION"));
    assert.equal(E().assignments[asg].customerExpiresAt, NOW + 30 * DAY, "no se tocó la fecha");
    // Precio corregido por el dueño al guardar.
    const r3 = s.cobro.apply(owner, asg, { price: 6500, idempotencyKey: "k4" });
    assert.deepEqual([r3.saved.price, E().assignments[asg].control.price, E().assignments[asg].control.paidLog.length], [6500, 6500, 2]);
    assert.equal(s.finance.report(owner, 1).current.ingresos - ing0, 6600 + 6500);
    // La secretaria ya no la lista en cobrar.
    assert.equal(s.stats.secretary(owner).counts.cobrar, 0);
  });
});

describe("optimización 1 · cierre con mes anterior incompleto", () => {
  test("si la tienda empezó a registrar después del día 1 del mes anterior, no hay % y se dice desde cuándo hay datos", () => {
    const w = world(NOV1 - 10 * DAY); // la tienda arranca el 22/10
    const { s, at, rev } = w;
    w.add("disney-alq", "d@x.lat"); w.add("disney-alq", "d2@x.lat"); w.buy(rev.id, "disney-alq", NOV1 - 9 * DAY); w.buy(rev.id, "disney-alq", NOV1 + 2 * DAY);
    at(NOW);
    const c = s.finance.monthClose(owner);
    assert.equal(c.prev.incomplete, true); assert.equal(c.prev.dataSince, NOV1 - 10 * DAY);
    assert.equal(c.vs.ingresosPct, null, "sin % inventado"); assert.equal(c.vs.ingresos, 0, "los Bs sí se comparan (66 − 66)");
    // Con historia desde antes del 1/10, el % vuelve.
    const w2 = world(NOV1 - 40 * DAY);
    w2.add("disney-alq", "d@x.lat"); w2.add("disney-alq", "d2@x.lat"); w2.buy(w2.rev.id, "disney-alq", NOV1 - 9 * DAY); w2.buy(w2.rev.id, "disney-alq", NOV1 + 2 * DAY);
    w2.at(NOW);
    const c2 = w2.s.finance.monthClose(owner);
    assert.deepEqual([c2.prev.incomplete, c2.vs.ingresosPct], [false, 0]);
  });
});

describe("optimización 1 · por la API y en el navegador", () => {
  let dir, app, base, ownerCk, asg;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const get = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, json: await r.json().catch(() => null) }; };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-opt1-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ownerCk = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    await post("/api/admin/products", { id: "dis", name: "Disney (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true }, ownerCk);
    await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, ownerCk);
    await post("/api/admin/accounts", { productId: "dis", supplierId: "andes", email: "dis1@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] }, ownerCk);
    const rev = await (await post("/api/admin/customers", { name: "ARIt", phone: "+59170000001", kind: "reseller" }, ownerCk)).json();
    const o = await (await post("/api/admin/orders", { customerId: rev.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }, ownerCk)).json();
    asg = o.assignmentIds[0];
    await post(`/api/admin/assignments/${asg}/control`, { note: "🔔 EN COBRO desde hoy", payStatus: "pendiente" }, ownerCk);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("GET pay-preview y POST pay (idempotente); sin sesión 401", async () => {
    const pv = (await get(`/api/admin/assignments/${asg}/pay-preview`, ownerCk)).json;
    assert.equal(pv.ok, true); assert.equal(pv.customer.name, "ARIt"); assert.equal(pv.email, "dis1@x.lat");
    const r1 = await post(`/api/admin/assignments/${asg}/pay`, { periods: 1, idempotencyKey: "a1" }, ownerCk);
    assert.equal(r1.status, 200);
    const j1 = await r1.json(); assert.equal(j1.saved.to, pv.to);
    const r2 = await (await post(`/api/admin/assignments/${asg}/pay`, { periods: 1, idempotencyKey: "a1" }, ownerCk)).json();
    assert.equal(r2.saved.to, j1.saved.to, "misma llave: no se cobra dos veces");
    const r3 = await post(`/api/admin/assignments/${asg}/pay`, { periods: 1, idempotencyKey: "a2" }, ownerCk);
    assert.equal(r3.status, 400, "cobro hace segundos: frena");
    assert.equal((await get(`/api/admin/assignments/${asg}/pay-preview`)).status, 401);
  });

  test("navegador a 360 px: «Me pagó» muestra la vista previa (cliente, cuenta, monto, período, fecha nueva) antes de guardar", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
    // Otro alquiler «en cobro» para la pantalla (el anterior ya se cobró).
    const rev2 = await (await post("/api/admin/customers", { name: "Rodbol", phone: "+59170000002", kind: "reseller" }, ownerCk)).json();
    await post("/api/admin/accounts", { productId: "dis", supplierId: "andes", email: "dis2@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] }, ownerCk);
    const o = await (await post("/api/admin/orders", { customerId: rev2.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }, ownerCk)).json();
    await post(`/api/admin/assignments/${o.assignmentIds[0]}/control`, { note: "🔔 EN COBRO", payStatus: "pendiente" }, ownerCk);
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [n, v] = ownerCk.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/panel.html#secretaria");
      await p.waitForSelector(`[data-secpay="${o.assignmentIds[0]}"]`, { timeout: 20_000 });
      await p.evaluate((id) => document.querySelector(`[data-secpay="${id}"]`).click(), o.assignmentIds[0]);
      await p.waitForSelector(".sec-pvbox", { timeout: 20_000 });
      const txt = (await p.locator(".sec-pvbox").innerText()).replace(/\s+/g, " ");
      for (const t of ["Rodbol", "dis2@x.lat", "Bs 69", "Período", "Fecha nueva", "Confirmar: me pagó"]) assert.ok(txt.includes(t), `la vista previa dice «${t}»: ${txt}`);
      const m = await p.evaluate(() => { const vis = (x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; }; return { over: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll(".sec-pvbox button, .sec-pvbox input")].filter((x) => vis(x) && x.getBoundingClientRect().height < 44).length }; });
      assert.deepEqual(m, { over: false, small: 0 });
      await p.evaluate(() => document.querySelector("[data-secpayok]").click());
      await p.waitForFunction((id) => !document.querySelector(`[data-secpay="${id}"]`), o.assignmentIds[0], { timeout: 20_000 });
      const a = (await get("/api/admin/assignments", ownerCk)).json.find((x) => x.id === o.assignmentIds[0]);
      assert.equal(a.control.payStatus, "pagado");
      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  });
});
