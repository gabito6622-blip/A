// «Mi día» del revendedor (13/11/2026): la secretaria del dueño con SUS clientes y SUS perfiles repartidos.
// Fórmulas, no agentes. Datos ficticios; reloj controlado; nada real.
//  - Grupos: cobrar (vencidos hasta 30 días o vencen hoy), avisar (1 a 3 días), me deben (sin pagar, más lejos).
//  - Solo lo suyo: nada de otro revendedor ni de clientes directos de la tienda.
//  - «Me pagó»: perfil repartido que vence → corre la fecha y queda pagado; cliente registrado → pagado en Mi control
//    y, si él quiere, renovado con su saldo en el mismo toque (misma renovación de siempre, con sus frenos). Idempotente.
//  - API con sesión de revendedor; plan Básico → 402; navegador a 360 px.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const NOW = Date.UTC(2026, 10, 13, 18); // 13/11 14:00 Bolivia

function world() {
  const clock = { t: NOW - 40 * DAY, now() { return this.t; } };
  const s = createStore({ clock });
  const at = (t) => { clock.t = t; };
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "disney-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, "disney-alq": 6600 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
  let n = 0;
  const add = (productId, slots) => s.inventory.addAccount(owner, { productId, supplierId: "prov", email: `${productId}${++n}@x.lat`, password: "Clave#Secreta1", supplierExpiresAt: NOW + 120 * DAY, cost: 2000, profiles: Array.from({ length: slots }, (_, i) => ({ label: slots === 1 ? "Cuenta completa" : `Perfil ${i + 1}` })) });
  add("netflix", 5); add("netflix", 5); add("disney-alq", 1); add("disney-alq", 1);
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "revendedor" }); s.wallet.adjust(owner, c.id, 100000, "demo"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Flores", "+59171000001"), otro = mk("Otro Revendedor", "+59171000002");
  const client = (R, name, phone) => s.catalog.createCustomer(R.A, { name, phone, whatsappConsent: true });
  const sell = (R, cid, productId, t) => { at(t); return s.orders.create(R.A, { customerId: cid, items: [{ productId, qty: 1 }], paymentMethod: "balance" }); };
  // Ana: Marisel venció hace 2 días; Ruthy vence en 2 días; José vence en 20 días pero figura «pendiente»; Kevin vence en 15 días y pagó.
  const marisel = client(ana, "Marisel Rojas", "+59175000001"), ruthy = client(ana, "Ruthy Mamani", "+59175000002"), jose = client(ana, "José Vargas", "+59175000003"), kevin = client(ana, "Kevin Flores", "+59175000004");
  const oM = sell(ana, marisel.id, "netflix", NOW - 32 * DAY), oR = sell(ana, ruthy.id, "netflix", NOW - 28 * DAY), oJ = sell(ana, jose.id, "netflix", NOW - 10 * DAY), oK = sell(ana, kevin.id, "netflix", NOW - 15 * DAY);
  at(NOW);
  s.rtools.setControl(ana.A, oM.assignmentIds[0], { price: 4000 });
  s.rtools.setControl(ana.A, oR.assignmentIds[0], { price: 4000, note: "paga los lunes" });
  s.rtools.setControl(ana.A, oJ.assignmentIds[0], { price: 4500, payStatus: "pendiente" });
  // Ana alquila una cuenta completa de Disney y la reparte: Mamá venció ayer (Bs 15), Papá vence en 10 días y debe.
  const oD = sell(ana, ana.c.id, "disney-alq", NOW - 5 * DAY); at(NOW);
  const aidD = oD.assignmentIds[0];
  const mama = s.subs.save(ana.A, aidD, { label: "Mamá", name: "Lucía Rojas", phone: "+59175556677", expiresAt: NOW - 1 * DAY, price: 1500, pay: "pagado" }).sub;
  const papa = s.subs.save(ana.A, aidD, { label: "Papá", name: "Mario Rojas", phone: "+59175556678", expiresAt: NOW + 10 * DAY, price: 1500, pay: "pendiente" }).sub;
  s.subs.link(ana.A, aidD, mama.id);
  // El otro revendedor tiene un cliente vencido que Ana nunca debe ver; y la tienda un cliente directo vencido.
  const ajeno = client(otro, "Cliente Ajeno", "+59175009999"); sell(otro, ajeno.id, "netflix", NOW - 35 * DAY); at(NOW);
  const directo = s.catalog.createCustomer(owner, { name: "Directo Tienda", phone: "+59175008888" }); at(NOW - 33 * DAY); s.orders.create(owner, { customerId: directo.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }); at(NOW);
  return { s, clock, at, ana, otro, ids: { marisel: oM.assignmentIds[0], ruthy: oR.assignmentIds[0], jose: oJ.assignmentIds[0], kevin: oK.assignmentIds[0], aidD, mama: mama.id, papa: papa.id } };
}

describe("Mi día del revendedor · fórmulas", () => {
  test("grupos: cobrar (vencidos/hoy), avisar (1 a 3 días), me deben; solo lo suyo; totales en su moneda", () => {
    const { s, ana, otro, ids } = world();
    const d = s.rtools.day(ana.A);
    assert.deepEqual(d.counts, { cobrar: 2, avisar: 1, deben: 2 });
    const names = (l) => l.map((g) => g.client);
    assert.deepEqual(names(d.cobrar), ["Marisel Rojas", "Lucía Rojas"], "primero el que venció antes: Marisel hace 2 días, la mamá del reparto ayer");
    assert.deepEqual(names(d.avisar), ["Ruthy Mamani"]);
    assert.deepEqual(names(d.deben).sort(), ["José Vargas", "Mario Rojas"]);
    assert.equal(d.totals.cobrar, 1500 + 4000); assert.equal(d.totals.avisar, 4000); assert.equal(d.totals.deben, 4500 + 1500);
    const m = d.cobrar.find((g) => g.client === "Marisel Rojas").items[0];
    assert.equal(m.kind, "client"); assert.equal(m.days, -2); assert.equal(m.price, 4000); assert.equal(m.cost, 2500, "lo que le cuesta renovar con su saldo"); assert.equal(m.canRenew, true);
    const l = d.cobrar.find((g) => g.client === "Lucía Rojas").items[0];
    assert.equal(l.kind, "sub"); assert.equal(l.label, "Mamá"); assert.ok(l.linkToken, "trae su link de cobro para el mensaje");
    const txt = JSON.stringify(d);
    assert.ok(!txt.includes("Ajeno") && !txt.includes("Directo Tienda"), "nada de otros revendedores ni de la tienda");
    assert.ok(!txt.includes("@x.lat") && !txt.includes("Clave#"), "sin correos ni claves");
    assert.equal(s.rtools.day(otro.A).counts.cobrar, 1, "el otro ve solo lo suyo");
    assert.throws(() => s.rtools.day(owner), err("FORBIDDEN"));
    assert.throws(() => s.rtools.dayPreview(otro.A, ids.marisel), err("NOT_FOUND"), "no puede ni mirar un servicio ajeno");
  });

  test("«Me pagó» en un perfil repartido vencido: corre la fecha un período y queda pagado; en uno que no vence, solo pagado; idempotente", () => {
    const { s, ana, ids } = world();
    const E = () => s.engine.s;
    const idM = `${ids.aidD}|${ids.mama}`, idP = `${ids.aidD}|${ids.papa}`;
    const pv = s.rtools.dayPreview(ana.A, idM);
    assert.equal(pv.moves, true); assert.equal(pv.to, NOW + 30 * DAY, "venció ayer: el período nuevo arranca hoy");
    const r1 = s.rtools.dayPay(ana.A, idM, { idempotencyKey: "m1" });
    assert.equal(r1.to, NOW + 30 * DAY);
    const subM = () => E().assignments[ids.aidD].subs.find((x) => x.id === ids.mama);
    assert.equal(subM().pay, "pagado"); assert.equal(subM().expiresAt, NOW + 30 * DAY);
    s.rtools.dayPay(ana.A, idM, { idempotencyKey: "m1" });
    assert.equal(subM().expiresAt, NOW + 30 * DAY, "misma llave: no corre dos veces");
    assert.equal(s.rtools.day(ana.A).counts.cobrar, 1, "Lucía salió de Cobrar");
    // Papá debe pero vence en 10 días: queda pagado, la fecha no se toca; precio corregido.
    const pvP = s.rtools.dayPreview(ana.A, idP);
    assert.equal(pvP.moves, false);
    s.rtools.dayPay(ana.A, idP, { price: 1800 });
    const subP = E().assignments[ids.aidD].subs.find((x) => x.id === ids.papa);
    assert.deepEqual([subP.pay, subP.expiresAt, subP.price], ["pagado", NOW + 10 * DAY, 1800]);
    assert.equal(s.rtools.day(ana.A).counts.deben, 1, "Mario salió de Me deben (queda José)");
  });

  test("«Me pagó» en un cliente registrado: pagado en Mi control y, si quiere, renovado con su saldo (con sus frenos)", () => {
    const { s, ana, ids } = world();
    const E = () => s.engine.s;
    const pv = s.rtools.dayPreview(ana.A, ids.marisel);
    assert.deepEqual([pv.renew.offered, pv.renew.cost, pv.renew.enough], [true, 2500, true]);
    const bal0 = s.wallet.balance(ana.c.id), exp0 = E().assignments[ids.marisel].customerExpiresAt;
    const r = s.rtools.dayPay(ana.A, ids.marisel, { renew: true, idempotencyKey: "k1" });
    // Decisión (a) del 14/11: venció hace 2 días y no se cortó → el período arranca en el vencimiento (sin días gratis).
    assert.equal(r.renewed, true); assert.equal(r.to, NOW - 2 * DAY + 30 * DAY);
    assert.equal(E().assignments[ids.marisel].rcontrol.payStatus, "pagado");
    assert.equal(s.wallet.balance(ana.c.id), bal0 - 2500, "pagó la renovación a la tienda una vez");
    s.rtools.dayPay(ana.A, ids.marisel, { renew: true, idempotencyKey: "k1" });
    assert.equal(s.wallet.balance(ana.c.id), bal0 - 2500, "misma llave: no cobra dos veces");
    assert.notEqual(exp0, E().assignments[ids.marisel].customerExpiresAt);
    // José debe pero no vence todavía: no se ofrece renovar; marcar pagado también salda su libreta.
    const pvJ = s.rtools.dayPreview(ana.A, ids.jose);
    assert.equal(pvJ.renew.offered, false);
    const rJ = s.rtools.dayPay(ana.A, ids.jose, { renew: true });
    assert.equal(rJ.renewed, null); assert.match(rJ.renewError, /Todavía no hace falta/);
    assert.equal(E().assignments[ids.jose].rcontrol.payStatus, "pagado");
    assert.equal(s.fiado.overview(ana.A).totals.owed ?? 0, 0, "Quién me debe queda en cero");
    // Sin saldo: el cobro queda anotado igual y se explica por qué no se renovó.
    s.wallet.adjust(owner, ana.c.id, -s.wallet.balance(ana.c.id), "vaciar");
    const pvR = s.rtools.dayPreview(ana.A, ids.ruthy);
    assert.equal(pvR.renew.enough, false);
    const rR = s.rtools.dayPay(ana.A, ids.ruthy, { renew: true });
    assert.equal(rR.renewed, false); assert.ok(rR.renewError);
    assert.equal(E().assignments[ids.ruthy].rcontrol.payStatus, "pagado");
    assert.throws(() => s.rtools.dayPay(ana.A, "no-existe"), err("NOT_FOUND"));
  });
});

describe("Mi día del revendedor · API y navegador", () => {
  let dir, app, base, ock, rck, ana, ids;
  const clock = { t: NOW, now() { return this.t; } };
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const get = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, json: await r.json().catch(() => null) }; };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-midia-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const s = app.store;
    s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500 } });
    s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
    s.inventory.addAccount(owner, { productId: "netflix", supplierId: "prov", email: "nf@x.lat", password: "Clave#Secreta1", supplierExpiresAt: NOW + 120 * DAY, cost: 2000, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }, { label: "Perfil 3" }] });
    const c = s.catalog.createCustomer(owner, { name: "Ana Flores", phone: "+59171000001", kind: "reseller", priceGroupId: "revendedor" });
    ana = { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } };
    s.wallet.adjust(owner, c.id, 100000, "demo");
    const marisel = s.catalog.createCustomer(ana.A, { name: "Marisel Rojas", phone: "+59175000001", whatsappConsent: true });
    clock.t = NOW - 32 * DAY; const o = s.orders.create(ana.A, { customerId: marisel.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" }); clock.t = NOW;
    s.rtools.setControl(ana.A, o.assignmentIds[0], { price: 4000 });
    ids = { marisel: o.assignmentIds[0] };
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${c.id}/login-pin`, {}, ock)).json();
    rck = (await post("/api/auth/customer/pin", { phone: c.phone, pin })).headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("GET /api/me/dia con sesión de revendedor; sin sesión 401; el dueño (staff) 401/403; plan Básico 402", async () => {
    assert.equal((await get("/api/me/dia")).status, 401);
    const d = (await get("/api/me/dia", rck)).json;
    assert.deepEqual(d.counts, { cobrar: 1, avisar: 0, deben: 0 }); assert.equal(d.cobrar[0].client, "Marisel Rojas");
    const pv = (await get(`/api/me/dia/preview/${encodeURIComponent(ids.marisel)}`, rck)).json;
    assert.equal(pv.renew.offered, true);
    // Plan Básico: Mi día es del plan Completo (como Mi control).
    await post("/api/admin/settings", { shopRent: { enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", trialDays: 0, basicPrice: 2500 } }, ock);
    app.store.shops.setPlan(ana.A, ana.c.id, "basic");
    const r402 = await get("/api/me/dia", rck);
    assert.equal(r402.status, 402); assert.equal(r402.json.error, "HUB_PLAN");
    app.store.shops.setPlan(ana.A, ana.c.id, "full");
    await post("/api/admin/settings", { shopRent: { enabled: false, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all" } }, ock);
    assert.equal((await get("/api/me/dia", rck)).status, 200);
  });

  test("navegador a 360 px: pestaña «Mi día», Me pagó con vista previa y renovar con saldo en el mismo toque", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* */ } }, ana.c.id);
      const [n, v] = rck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/hub#inicio");
      await p.locator(".htiles").waitFor();
      await p.locator(".hmore > summary").click(); // inicio simple: «Tu negocio» quedó en «Todas mis herramientas»
      await p.locator('.hqrow [data-rtool="dia"]').click();
      await p.locator('[data-rtab="dia"][aria-selected="true"]').waitFor();
      await p.waitForSelector("[data-rdpay]", { timeout: 20_000 });
      const txt = (await p.locator("#sout").innerText()).replace(/\s+/g, " ");
      assert.match(txt, /Mi día/); assert.match(txt, /Cobrar hoy 1/); assert.match(txt, /Marisel Rojas/); assert.match(txt, /Venció hace 2 d/); assert.match(txt, /Bs 40\b/);
      assert.ok(!txt.includes("nf@x.lat"), "sin correo de la cuenta");
      assert.ok((await p.evaluate(() => document.documentElement.scrollWidth)) <= 360, "sin scroll horizontal");
      const h = await p.evaluate(() => Math.round(document.querySelector("[data-rdpay]").getBoundingClientRect().height)); assert.ok(h >= 44, `botón de ${h}px`);
      await p.locator("[data-rdpay]").click();
      await p.waitForSelector("[data-rdpayok]", { timeout: 20_000 });
      const pvTxt = (await p.locator(".rdia-pvbox").innerText()).replace(/\s+/g, " ");
      assert.match(pvTxt, /Renovar ahora con mi saldo/); assert.match(pvTxt, /Bs 25\b/);
      assert.equal(await p.locator('[name="renew"]').isChecked(), true);
      await p.locator("[data-rdpayok]").click();
      await p.waitForFunction(() => /Todo al día acá/.test(document.body.innerText) && /Cobrar hoy\s*0/.test(document.body.innerText.replace(/\s+/g, " ")), null, { timeout: 20_000 });
      const a = app.store.engine.s.assignments[ids.marisel];
      assert.equal(a.rcontrol.payStatus, "pagado"); assert.equal(a.customerExpiresAt, NOW - 2 * DAY + 30 * DAY, "renovado un período desde el vencimiento (decisión (a), sin días gratis)");
      assert.equal(app.store.wallet.balance(ana.c.id), 100000 - 2500 - 2500, "la venta y la renovación, una vez cada una");
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
  });
});
