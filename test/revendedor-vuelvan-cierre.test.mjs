// Revendedores (13/11/2026): «🔁 Que vuelvan» en Mi día y «🧾 Cierre de mes» en Mis ganancias. Las mismas fórmulas que
// tiene el dueño, pero solo con lo suyo:
//  - Que vuelvan: clientes registrados cuyo servicio se cerró por vencido (hasta 60 días) y que no tienen otro activo del
//    mismo producto; perfiles repartidos vencidos hace más de 30 días (hasta 90). «Ya le escribí» los saca 7 días.
//  - Cierre: este mes contra el anterior (sin % si el anterior no tuvo ventas o quedó incompleto), quién le pagó más y
//    la app que más le dejó.
//  - Aislamiento: nunca aparece un cliente de otro revendedor ni un cliente directo de la tienda; no salen costos de la
//    tienda, correos ni claves. Datos ficticios; nada real.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const owner = { id: "u_owner", role: "owner" }, system = { id: "system:prueba", role: "system" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const NOW = Date.UTC(2026, 10, 13, 18); // 13/11 14:00 Bolivia

function seed(s, clock) {
  const at = (t) => { clock.t = t; };
  at(NOW - 80 * DAY);
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "max", name: "Max perfil", kind: "profile", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertProduct(owner, { id: "disney-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500, max: 1800, "disney-alq": 6600 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
  let n = 0;
  const add = (productId, slots) => s.inventory.addAccount(owner, { productId, supplierId: "prov", email: `${productId}${++n}@secreto.lat`, password: "Clave#Secreta1", supplierExpiresAt: NOW + 200 * DAY, cost: 2000, profiles: Array.from({ length: slots }, (_, i) => ({ label: `Perfil ${i + 1}` })) });
  add("netflix", 5); add("netflix", 5); add("max", 5); add("disney-alq", 1);
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "revendedor" }); s.wallet.adjust(owner, c.id, 100000, "demo"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Flores", "+59171000001"), otro = mk("Otro Revendedor", "+59171000002");
  const client = (R, name, phone) => s.catalog.createCustomer(R.A, { name, phone, whatsappConsent: true });
  const sell = (R, cid, productId, t, price) => { at(t); const o = s.orders.create(R.A, { customerId: cid, items: [{ productId, qty: 1 }], paymentMethod: "balance" }); if (price) s.rtools.setControl(R.A, o.assignmentIds[0], { price }); return o; };
  const marisel = client(ana, "Marisel Rojas", "+59175000001"), ruthy = client(ana, "Ruthy Mamani", "+59175000002"), jose = client(ana, "José Vargas", "+59175000003"), kevin = client(ana, "Kevin Flores", "+59175000004");
  // Octubre (mes anterior completo: Ana ya vendía en septiembre): 2 ventas. Marisel y José NO renovaron; Ruthy sí.
  sell(ana, kevin.id, "max", NOW - 70 * DAY, 2500);                       // septiembre: su primera venta
  const oM = sell(ana, marisel.id, "netflix", NOW - 40 * DAY, 4000);      // venció hace 10 días → Que vuelvan
  const oJ = sell(ana, jose.id, "max", NOW - 36 * DAY, 3000);             // venció hace 6 días → Que vuelvan
  const oR = sell(ana, ruthy.id, "netflix", NOW - 34 * DAY, 4000);        // venció hace 4 días, pero…
  // Noviembre (este mes): Ruthy volvió a comprar Netflix (ya tiene uno activo: NO aparece) y Kevin compró dos veces.
  at(NOW - 20 * DAY); s.orders.closeExpired(system);
  at(NOW - 2 * DAY); s.orders.closeExpired(system);
  sell(ana, ruthy.id, "netflix", NOW - 2 * DAY, 4000);
  sell(ana, kevin.id, "netflix", NOW - 1 * DAY, 4500);
  const oK2 = sell(ana, kevin.id, "max", NOW - 1 * DAY, 3000);
  s.rtools.setControl(ana.A, oK2.assignmentIds[0], { payStatus: "pendiente" });
  // Perfil repartido que venció hace 45 días (Mi día ya no lo muestra) y otro que vence en 10 días.
  const oD = sell(ana, ana.c.id, "disney-alq", NOW - 5 * DAY);
  const viejo = s.subs.save(ana.A, oD.assignmentIds[0], { label: "Tío", name: "Pedro Lejano", phone: "+59175550001", expiresAt: NOW - 45 * DAY, price: 1500, pay: "pagado" }).sub;
  s.subs.save(ana.A, oD.assignmentIds[0], { label: "Mamá", name: "Lucía Cerca", phone: "+59175550002", expiresAt: NOW + 10 * DAY, price: 1500, pay: "pagado" });
  // Otro revendedor y la tienda: clientes vencidos que Ana nunca debe ver.
  const ajeno = client(otro, "Cliente Ajeno", "+59175009999"); sell(otro, ajeno.id, "netflix", NOW - 38 * DAY, 9999);
  const directo = s.catalog.createCustomer(owner, { name: "Directo Tienda", phone: "+59175008888" });
  at(NOW - 37 * DAY); s.orders.create(owner, { customerId: directo.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
  at(NOW - 1 * DAY); s.orders.closeExpired(system);
  at(NOW);
  return { ana, otro, ids: { marisel: oM.assignmentIds[0], jose: oJ.assignmentIds[0], ruthy: oR.assignmentIds[0], viejo: `${oD.assignmentIds[0]}|${viejo.id}` } };
}

describe("Revendedor · Que vuelvan y cierre de mes · fórmulas", () => {
  test("Que vuelvan: solo los suyos que no renovaron; Ya le escribí los saca 7 días; nada ajeno ni privado", () => {
    const clock = { t: NOW, now() { return this.t; } };
    const s = createStore({ clock });
    const { ana, otro, ids } = seed(s, clock);
    const b = s.rtools.winback(ana.A);
    assert.deepEqual(b.items.map((x) => [x.client, x.product, x.days, x.price, x.kind]), [
      ["José Vargas", "Max perfil", 6, 3000, "client"],
      ["Marisel Rojas", "Netflix perfil", 10, 4000, "client"],
      ["Pedro Lejano", "Disney+", 45, 1500, "sub"],
    ], "ordenados del más reciente al más viejo; Ruthy no (volvió a comprar), Lucía Cerca no (no venció)");
    assert.deepEqual([b.items[0].key, b.items[2].key, b.written, b.quietDays], [`c:${ids.jose}`, `s:${ids.viejo}`, 0, 7]);
    const txt = JSON.stringify(b);
    for (const x of ["Cliente Ajeno", "Directo Tienda", "secreto.lat", "Clave#Secreta1", "9999", "2500", "1800"]) assert.ok(!txt.includes(x), `no debe salir ${x}`);
    // El otro revendedor ve solo el suyo; el dueño y un cliente no usan esta lista.
    assert.deepEqual(s.rtools.winback(otro.A).items.map((x) => x.client), ["Cliente Ajeno"]);
    assert.throws(() => s.rtools.winback(owner), err("FORBIDDEN"));
    // Ya le escribí: sale de la lista 7 días; el otro revendedor no puede marcar un renglón de Ana.
    assert.throws(() => s.rtools.markBack(otro.A, `c:${ids.jose}`), err("NOT_FOUND"));
    assert.throws(() => s.rtools.markBack(ana.A, "c:inventado"), err("NOT_FOUND"));
    const m = s.rtools.markBack(ana.A, `c:${ids.jose}`);
    assert.equal(m.until, NOW + 7 * DAY);
    let b2 = s.rtools.winback(ana.A);
    assert.deepEqual([b2.items.map((x) => x.client), b2.written], [["Marisel Rojas", "Pedro Lejano"], 1]);
    clock.t = NOW + 8 * DAY;
    assert.ok(s.rtools.winback(ana.A).items.some((x) => x.client === "José Vargas"), "a los 8 días vuelve");
    clock.t = NOW;
    s.rtools.markBack(ana.A, `c:${ids.jose}`); s.rtools.markBack(ana.A, `c:${ids.jose}`, true);
    assert.equal(s.rtools.winback(ana.A).items.length, 3, "deshacer");
  });

  test("cierre de mes: contra el mes anterior, quién pagó más y app que más dejó; sin % cuando no corresponde", () => {
    const clock = { t: NOW, now() { return this.t; } };
    const s = createStore({ clock });
    const { ana, otro } = seed(s, clock);
    const g = s.rtools.earnings(ana.A);
    // Noviembre: Ruthy Netflix 4000 + Kevin Netflix 4500 + Kevin Max 3000 = 11500; costo 2500 + 2500 + 1800 = 6800 (+ su Disney no cuenta: es compra propia).
    assert.deepEqual([g.month.sales, g.month.revenue, g.month.cost, g.month.profit, g.month.unpaid], [3, 11500, 6800, 4700, 3000]);
    // Octubre: Marisel 4000 + José 3000 + Ruthy 4000 = 11000; costo 2500 + 1800 + 2500 = 6800.
    assert.deepEqual([g.prev.label, g.prev.sales, g.prev.revenue, g.prev.profit], ["oct 2026", 3, 11000, 4200]);
    assert.deepEqual(g.compare, { revenuePct: 5, profitPct: 12, salesDiff: 0 });
    assert.equal(g.prevNote, null);
    assert.deepEqual(g.topClients.map((c) => [c.name, c.sales, c.revenue, c.unpaid]), [["Kevin Flores", 2, 7500, 3000], ["Ruthy Mamani", 1, 4000, 0]]);
    assert.equal(g.byApp[0].name, "Netflix perfil");
    // El otro revendedor: su única venta fue en octubre → este mes en cero; octubre fue su primer mes (incompleto): sin %.
    const o = s.rtools.earnings(otro.A);
    assert.deepEqual([o.month.sales, o.prev.sales, o.compare, o.prevNote, o.topClients], [0, 1, null, "incompleto", []]);
    assert.ok(!JSON.stringify(o).includes("Kevin"), "nada de los clientes de Ana");
    // Sin ventas el mes pasado.
    clock.t = NOW + 62 * DAY;
    const later = s.rtools.earnings(ana.A);
    assert.deepEqual([later.compare, later.prevNote], [null, "sin_ventas"]);
  });
});

test("en el celular (360 px): Mi día muestra «Que vuelvan» con mensaje listo y «Ya le escribí»; Mis ganancias muestra el cierre", { skip: !chromium && "Playwright no instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-vuelvan-"));
  const clock = { t: NOW, now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  let b;
  try {
    const { ana } = seed(app.store, clock);
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${ana.c.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: ana.c.phone, pin })).headers.get("set-cookie").split(";")[0];
    // Sin sesión 401; el dueño (staff) no entra a rutas de revendedor.
    assert.equal((await fetch(base + "/api/me/vuelvan")).status, 401);
    assert.ok([401, 403].includes((await fetch(base + "/api/me/vuelvan", { headers: { cookie: ock } })).status));
    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* sin almacenamiento */ } }, ana.c.id);
    const [n, v] = rck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(base + "/hub#dia");
    const box = page.locator("#rback");
    await box.waitFor({ timeout: 20_000 });
    assert.match(await box.innerText(), /Que vuelvan[\s\S]*3 clientes[\s\S]*José Vargas[\s\S]*Marisel Rojas[\s\S]*Pedro Lejano/);
    const href = decodeURIComponent(await box.locator("a.sbtn").first().getAttribute("href"));
    assert.match(href, /wa\.me\/59175000003\?text=Hola José 👋 ¿Cómo estás\? Hace 6 días se venció tu Max perfil\. ¿Querés que te lo active de nuevo\? Te sale Bs 30\./);
    assert.equal(await page.evaluate(() => [...document.querySelectorAll("#rback .sbtn")].filter((x) => x.getBoundingClientRect().height < 44).length), 0, "botones de 44 px");
    await box.getByRole("button", { name: "✅ Ya le escribí" }).first().click();
    await page.waitForFunction(() => !document.querySelector("#rback")?.innerText.includes("José Vargas"), null, { timeout: 15_000 });
    assert.match(await box.innerText(), /2 clientes[\s\S]*1 ya escrito/);
    // Mis ganancias: el cierre.
    await page.goto(base + "/hub#mas");
    await page.locator('.hubarea-i[data-rtool="ganancias"]').click();
    const cierre = page.locator("#rcierre");
    await cierre.waitFor({ timeout: 15_000 });
    const t = await cierre.innerText();
    assert.match(t, /Cierre de nov 2026/); assert.match(t, /Vendiste[\s\S]*oct 2026: Bs 110[\s\S]*Bs 115[\s\S]*▲ \+5 %/); assert.match(t, /Ganaste[\s\S]*▲ \+12 %/);
    assert.match(t, /Quién te pagó más[\s\S]*1\. Kevin Flores[\s\S]*te debe Bs 30[\s\S]*Bs 75[\s\S]*2\. Ruthy Mamani/); assert.match(t, /La app que más te dejó: Netflix perfil/);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), "sin desborde");
    assert.deepEqual(errs, []);
  } finally { await b?.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
