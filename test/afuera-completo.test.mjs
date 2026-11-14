// Revendedor de afuera completo y cómodo (Paraguay ₲ y Panamá US$, lista en dólares).
// Cubre: tarjeta "🌎 Mi país, moneda y tipo de cambio" en su Inicio (con y sin tipo de cambio) y el
// ejemplo convertido; Panamá en la lista de países; el tipo de cambio escrito "7.300"; avisos de
// cuentas propias (W1) en "Tu día" y en el aviso diario al celular, un solo aviso por día y sin
// mezclar revendedores; afiches en ₲ (W2); celulares de Argentina en wa.me (W3); Bolivia sin cambios.
// Nada real: el servicio de push es un fetch falso y el navegador no abre WhatsApp.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { parseRate } from "../dist/store/country.js";
import { ownSoonFor, mySoon, ownPushText, withOwnSuffix } from "../dist/store/ownAlerts.js";
import { createApp } from "../dist/server/app.js";
import { generateVapidKeys } from "../dist/server/push.js";
import { waDigits, waLink } from "../public/common.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const T0 = Date.UTC(2026, 10, 11, 15); // 11:00 en Bolivia (el aviso diario sale desde las 9)
const owner = { id: "u_owner", role: "owner" };
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));
const asR = (c) => ({ id: "web:" + c.id, role: "reseller", customerId: c.id });
const FCM = "https://fcm.googleapis.com/fcm/send/afuera";
const USD_PRICES = { "disney-espn-alq": 700, "disney-alq": 350, "prime-alq": 300, "hbo-alq": 200 };
const PRODUCTS = [["disney-espn-alq", "Disney + ESPN", 7000], ["disney-alq", "Disney sin ESPN", 3500], ["prime-alq", "Prime Video", 3000], ["hbo-alq", "HBO Max", 2000]];

/** Catálogo, lista en dólares y revendedores: Paraguay con tipo de cambio, Panamá, Paraguay sin tipo de cambio y Bolivia. */
function fill(s, now) {
  const O = { id: Object.keys(s.engine.s.staff)[0] ?? "u_owner", role: "owner" };
  s.catalog.upsertSupplier(O, { id: "prov", name: "Prov", active: true });
  for (const [id, name, price] of PRODUCTS) {
    s.catalog.upsertProduct(O, { id, name, kind: "full_account", durationDays: 30, price, published: true, resellersOnly: true });
    for (let i = 0; i < 3; i++) s.inventory.addAccount(O, { productId: id, supplierId: "prov", email: `${id}${i}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: now + 120 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
  }
  // Vence en 2 días: el aviso de "tus clientes vencen mañana" del revendedor de Bolivia.
  s.catalog.upsertProduct(O, { id: "corto", name: "Netflix 2 días", kind: "full_account", durationDays: 2, price: 1500, published: true, resellersOnly: true });
  s.inventory.addAccount(O, { productId: "corto", supplierId: "prov", email: "corto@x.lat", password: "Clave-Larga#1", supplierExpiresAt: now + 120 * DAY, cost: 500, profiles: [{ label: "Cuenta completa" }] });
  s.catalog.updateSettings(O, { usdt: { enabled: true, payId: "123456789", rate: 9.85 } });
  s.catalog.upsertPriceGroup(O, { id: "lp-usd", name: "Panamá y Paraguay (US$)", currency: "USD", prices: USD_PRICES });
  s.catalog.upsertPriceGroup(O, { id: "revendedor", name: "Revendedor", prices: { "disney-espn-alq": 6500, corto: 1200 } });
  const mk = (name, phone, group, slug) => {
    const c = s.catalog.createCustomer(O, { name, phone, kind: "reseller", priceGroupId: group });
    s.shops.setPage(O, c.id, true);
    s.shops.setupFor(O, c.id, { slug, title: name, enabled: true });
    return c;
  };
  const py = mk("Pedro Paraguay", "+595981123456", "lp-usd", "pedro-py");
  const pa = mk("Ana Panamá", "+50761234567", "lp-usd", "ana-pa");
  const py2 = mk("Pablo Paraguay", "+595981999888", "lp-usd", "pablo-py");
  const bo = mk("Beto Bolivia", "+59171234567", "revendedor", "beto-bo");
  s.locale.setMine(asR(py), { country: "PY", rate: "7.300" });
  s.locale.setMine(asR(pa), { country: "PA", symbol: "$" });
  s.locale.setMine(asR(py2), { country: "PY" });
  for (const c of [py, pa, py2]) s.portal.setPrices(asR(c), { "disney-espn-alq": 1000, "disney-alq": 500, "prime-alq": 450, "hbo-alq": 300 });
  s.portal.setPrices(asR(bo), { "disney-espn-alq": 8000 });
  return { py, pa, py2, bo, O };
}
/** Cuentas propias: un cliente que vence en 2 días, otro en 5 (no avisa), una cuenta con el proveedor mañana. */
function ownStock(s, c, now, price) {
  const A = asR(c);
  const p = s.own.saveProduct(A, { name: "Flujo TV", emoji: "📺", durationDays: 30, price, kind: "line" });
  s.own.addBulk(A, p.id, "flujo01 Clave-Uno\nflujo02 Clave-Dos\nflujo03 Clave-Tres");
  const v = s.own.view(A);
  s.own.assign(A, { accountId: v.accounts[0].id, name: "Rosa Giménez", phone: "0982 444 555", expiresAt: now + 2 * DAY, pay: "pagado" });
  s.own.assign(A, { accountId: v.accounts[1].id, name: "Lejano Pérez", phone: "0982 444 666", expiresAt: now + 5 * DAY, pay: "pagado" });
  s.own.saveAccount(A, { id: v.accounts[2].id, productId: p.id, user: "flujo03", password: "", providerExpiresAt: now + 1 * DAY });
}

describe("país, moneda y tipo de cambio (núcleo)", () => {
  test("tipo de cambio escrito como en Paraguay: 7.300 es 7300; 6,96 sigue siendo 6,96", () => {
    assert.equal(parseRate("7.300"), 7300);
    assert.equal(parseRate("1.050"), 1050);
    assert.equal(parseRate("7300"), 7300);
    assert.equal(parseRate("6,96"), 6.96);
    assert.equal(parseRate("1.234.567,5"), 1234567.5);
    assert.equal(parseRate(7300), 7300);
  });

  test("Paraguay con 7.300 queda en 7300; Panamá está en la lista y su dólar no pide tipo de cambio", () => {
    const clock = { t: T0, now() { return this.t; } };
    const s = createStore({ clock });
    const { py, pa, py2, bo } = fill(s, T0);
    const lp = s.locale.mine(asR(py));
    assert.deepEqual([lp.country, lp.symbol, lp.decimals, lp.rate, lp.foreign, lp.store.symbol], ["PY", "₲", 0, 7300, true, "US$"]);
    const la = s.locale.mine(asR(pa));
    assert.deepEqual([la.country, la.name, la.dial, la.symbol, la.foreign], ["PA", "Panamá", "507", "US$", false], "“$” en Panamá se guarda como US$");
    assert.equal(s.locale.mine(asR(py2)).rate, undefined);
    assert.equal(s.engine.s.customers[bo.id].locale, undefined, "Bolivia: no se guarda nada, como siempre");
    // El dueño también puede elegir Panamá desde la ficha.
    assert.equal(s.locale.setFor(owner, bo.id, { country: "PA" }).symbol, "US$");
    assert.throws(() => s.locale.setMine(asR(py), { rate: "0" }), err("VALIDATION"));
  });
});

describe("W1: cuentas propias que vencen (núcleo)", () => {
  const clock = { t: T0, now() { return this.t; } };
  let s, py, pa, bo;
  before(() => { s = createStore({ clock }); ({ py, pa, bo } = fill(s, T0)); ownStock(s, py, T0, 3500000); });

  test("solo lo que vence en 3 días o menos, sin contraseñas ni teléfonos", () => {
    const o = mySoon(s.engine, asR(py));
    assert.deepEqual(o.clients.map((c) => [c.name, c.product, c.expiresAt]), [["Rosa Giménez", "Flujo TV", T0 + 2 * DAY]]);
    assert.deepEqual(o.provider.map((a) => [a.user, a.product]), [["flujo03", "Flujo TV"]]);
    const raw = JSON.stringify(o);
    for (const x of ["Clave-", "0982", "+595"]) assert.ok(!raw.includes(x), `muestra ${x}`);
    clock.t = T0 + 3 * DAY; // lo vencido ya no se avisa
    assert.equal(ownSoonFor(s.engine, py.id).clients.length, 1, "Lejano (vence en 5) entra recién a 3 días");
    assert.equal(ownSoonFor(s.engine, py.id).clients[0].name, "Lejano Pérez");
    assert.equal(ownSoonFor(s.engine, py.id).provider.length, 0);
    clock.t = T0;
  });

  test("cada uno ve lo suyo: otro revendedor no ve nada; el equipo no puede leerlo", () => {
    assert.deepEqual(mySoon(s.engine, asR(pa)), { days: 3, clients: [], provider: [] });
    assert.deepEqual(mySoon(s.engine, asR(bo)), { days: 3, clients: [], provider: [] });
    assert.throws(() => mySoon(s.engine, owner), (e) => e instanceof DomainError);
    assert.throws(() => mySoon(s.engine, { id: "c1", role: "customer", customerId: bo.id }), (e) => e instanceof DomainError);
  });

  test("texto del aviso: solo, o sumado al aviso que ya existe sin pasarse del largo", () => {
    const o = ownSoonFor(s.engine, py.id);
    assert.deepEqual(ownPushText(o), { title: "📦 Cuentas propias: 1 cliente(s) y 1 cuenta(s) por vencer", body: "Rosa · Proveedor: flujo03 · Mirá Mis cuentas propias" });
    assert.equal(ownPushText({ days: 3, clients: [], provider: [] }), null);
    const long = "x".repeat(300);
    const b = withOwnSuffix(long, o);
    assert.equal(b.length, 180);
    assert.ok(b.endsWith(" · 📦 Cuentas propias: 1 cliente(s) y 1 con tu proveedor"));
    assert.equal(withOwnSuffix("Hola · Avisales", { days: 3, clients: [], provider: [] }), "Hola · Avisales", "sin cuentas propias, el texto de siempre");
  });
});

describe("W3: celulares de Argentina en wa.me", () => {
  test("se agrega el 9 (y se saca el 0 y el 15 de Buenos Aires); los demás países quedan igual", () => {
    assert.equal(waDigits("+54 11 1234 5678"), "5491112345678");
    assert.equal(waDigits("+54 9 11 1234 5678"), "5491112345678", "ya tenía el 9");
    assert.equal(waDigits("+54 011 15 1234 5678"), "5491112345678");
    assert.equal(waDigits("+54 351 123 4567"), "5493511234567", "Córdoba");
    assert.equal(waDigits("+54 1234"), "541234", "un número raro no se toca");
    assert.equal(waDigits("+591 71234567"), "59171234567");
    assert.equal(waDigits("+595 981 123 456"), "595981123456");
    assert.equal(waDigits("+507 6123 4567"), "50761234567");
    assert.equal(waDigits("71234567"), "71234567");
    assert.equal(waLink("+54 11 1234 5678", "Hola"), "https://wa.me/5491112345678?text=Hola");
  });
});

/* ---------------- servidor real: rutas y aviso diario al celular ---------------- */
async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "gs-afuera-"));
  const sent = [];
  const fetchImpl = async (url, init) => { sent.push({ url, init }); return new Response("", { status: 201 }); };
  const clock = { t: T0, now() { return this.t; } };
  const vapid = { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" };
  const app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {}, fetchImpl, vapid, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const s = app.store;
  const r = fill(s, T0);
  ownStock(s, r.py, T0, 3500000);
  ownStock(s, r.pa, T0, 1000);
  // Beto (Bolivia) tiene un cliente de la tienda que vence en 2 días: su aviso de siempre.
  s.wallet.adjust(r.O, r.bo.id, 5000, "Saldo");
  const cli = s.catalog.createCustomer(asR(r.bo), { name: "Carla Rojas", phone: "71112233" });
  s.orders.create(asR(r.bo), { customerId: cli.id, items: [{ productId: "corto", qty: 1 }], paymentMethod: "balance", idempotencyKey: "afuera-bo" });
  // Pedro también tiene uno (para ver que va un solo aviso con lo de cuentas propias sumado).
  s.wallet.adjust(r.O, r.py.id, 3000, "Saldo");
  const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
  const staff = lr.headers.get("set-cookie").split(";")[0];
  const call = async (cookie, method, path, body) => {
    const res = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: res.status, json: await res.json().catch(() => ({})) };
  };
  const cookies = {};
  for (const k of ["py", "pa", "py2", "bo"]) {
    const { json } = await call(staff, "POST", `/api/admin/customers/${r[k].id}/login-pin`, {});
    const res = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: r[k].phone, pin: json.pin }) });
    cookies[k] = res.headers.get("set-cookie").split(";")[0];
  }
  return { app, base, s, r, sent, clock, staff, call, cookies, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("por la API y en el navegador", () => {
  let t;
  before(async () => { t = await boot(); });
  after(() => t?.stop());

  test("GET /api/me/own/soon: lo suyo, sin contraseñas; sin sesión o del equipo, no", async () => {
    const me = await t.call(t.cookies.py, "GET", "/api/me/own/soon");
    assert.equal(me.status, 200);
    assert.deepEqual(me.json.clients.map((c) => c.name), ["Rosa Giménez"]);
    assert.deepEqual(me.json.provider.map((a) => a.user), ["flujo03"]);
    assert.ok(!JSON.stringify(me.json).includes("Clave-"));
    assert.deepEqual((await t.call(t.cookies.bo, "GET", "/api/me/own/soon")).json, { days: 3, clients: [], provider: [] }, "Beto no ve lo de Pedro");
    assert.equal((await t.call(null, "GET", "/api/me/own/soon")).status, 401);
    assert.ok((await t.call(t.staff, "GET", "/api/me/own/soon")).status >= 400, "el equipo no lo lee");
  });

  test("aviso diario al celular: lo de cuentas propias va una sola vez por día, junto al aviso que ya existe", async () => {
    // Pedro también tiene un cliente de la tienda que vence en 2 días.
    const cli = t.s.catalog.createCustomer(asR(t.r.py), { name: "Lucía Benítez", phone: "0981 222 333" });
    t.s.orders.create(asR(t.r.py), { customerId: cli.id, items: [{ productId: "hbo-alq", qty: 1 }], paymentMethod: "balance", idempotencyKey: "afuera-py" });
    t.s.engine.tx(() => { const a = Object.values(t.s.engine.s.assignments).find((x) => x.customerId === cli.id); a.customerExpiresAt = T0 + DAY; });
    for (const k of ["py", "pa", "py2", "bo"]) assert.equal((await t.call(t.cookies[k], "POST", "/api/me/push/subscribe", { subscription: { endpoint: `${FCM}-${k}`, keys: { p256dh: "a", auth: "b" } } })).status, 200);
    const n0 = t.sent.length;
    await t.app.checkResellerPush();
    const to = t.sent.slice(n0).map((x) => x.url).sort();
    assert.deepEqual(to, [`${FCM}-bo`, `${FCM}-pa`, `${FCM}-py`], "un aviso para cada uno que tiene algo; Pablo no tiene nada");
    const py = (await t.call(t.cookies.py, "GET", "/api/me/push/latest")).json;
    // Desde el 13/11 el aviso de la mañana es el resumen de «Mi día» (abre /hub#dia); lo de cuentas propias sigue al final.
    assert.equal(py.title, "☀️ Tu día: 1 por avisar"); assert.equal(py.url, "/hub#dia");
    assert.match(py.body, /^Lucía\. Tocá para abrir Mi día\./);
    assert.ok(py.body.endsWith("📦 Cuentas propias: 1 cliente(s) y 1 con tu proveedor"), py.body);
    const pa = (await t.call(t.cookies.pa, "GET", "/api/me/push/latest")).json;
    assert.equal(pa.title, "📦 Cuentas propias: 1 cliente(s) y 1 cuenta(s) por vencer");
    assert.equal(pa.body, "Rosa · Proveedor: flujo03 · Mirá Mis cuentas propias");
    const bo = (await t.call(t.cookies.bo, "GET", "/api/me/push/latest")).json;
    assert.equal(bo.title, "☀️ Tu día: 1 por avisar", "Bolivia: el mismo resumen de Mi día");
    assert.equal(bo.body, "Carla. Tocá para abrir Mi día.");
    // El mismo día no se repite.
    await t.app.checkResellerPush();
    assert.equal(t.sent.length, n0 + 3);
  });

  test("en el navegador a 360 px (claro y oscuro): Paraguay, Panamá y Paraguay sin tipo de cambio", { skip: !chromium && "Playwright no está instalado" }, async () => {
    const browser = await chromium.launch();
    try {
      for (const colorScheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, colorScheme });
        await ctx.route(/wa\.me|whatsapp\.com/, (route) => route.abort());
        await ctx.addInitScript((ids) => { for (const id of ids) localStorage.setItem("gs-guide-" + id, "1"); }, Object.values(t.r).map((c) => c.id));
        const open = async (who, hash) => {
          await ctx.clearCookies();
          const [name, value] = t.cookies[who].split("=");
          await ctx.addCookies([{ name, value, url: t.base }]);
          const page = await ctx.newPage();
          page.errors = [];
          page.on("pageerror", (e) => page.errors.push(e.message));
          await page.goto(t.base + "/hub#" + hash);
          return page;
        };
        const noOverflow = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
        // GaboHub etapa 1: las pestañas se ven por grupo; si no está en la fila, se abre desde "Más".
        const tab = async (page, name) => {
          await page.goto(t.base + "/hub#clientes"); await page.locator(".rtabs").waitFor();
          if (await page.getByRole("tab", { name }).count()) return page.getByRole("tab", { name }).click();
          await page.goto(t.base + "/hub#mas"); await page.locator(".hubarea-i").first().waitFor();
          await page.locator(".hubarea-i", { hasText: name }).first().click();
        };

        // Paraguay con tipo de cambio: la tarjeta, el ejemplo y "Tu día" con sus cuentas propias.
        let page = await open("py", "inicio");
        const card = page.locator("#afCountry");
        await card.waitFor();
        const ct = await card.innerText();
        assert.match(ct, /Paraguay · ₲/);
        assert.match(ct, /1 US\$ = ₲ 7\.300/);
        assert.match(ct, /Disney \+ ESPN te cuesta US\$ 7 ≈ ₲ 51\.100/);
        const today = await page.locator(".tday").innerText();
        assert.match(today, /Cuentas propias: 1 cliente vence · 1 cuenta vence con tu proveedor/);
        assert.match(today, /Rosa, flujo03/);
        assert.ok(!/\bBs\b/.test(await page.locator("#sout").innerText()), "sin Bs en su Inicio");
        assert.ok(await noOverflow(page), "sin desborde (Paraguay, Inicio)");
        // El menú "Tu negocio" lleva a la tarjeta (desde el 14/11 ese menú está en «Todas mis herramientas»).
        await page.locator(".hmore > summary").click();
        await page.getByRole("button", { name: /Mi país y moneda/ }).click();
        assert.ok(await page.locator("#afCountry details").evaluate((d) => d.open));
        const h = await page.locator(".tday-own").evaluate((el) => el.getBoundingClientRect().height);
        assert.ok(h >= 44, `fila de Tu día de ${h}px`);
        await page.locator(".tday-own").click();
        await page.getByRole("heading", { name: /Mis cuentas propias/ }).waitFor();
        // Afiches en ₲ redondeados como su página.
        await tab(page, /Afiches/);
        await page.locator("#poster").waitFor();
        const chips = await page.locator(".pchips").textContent(); // plegado: se lee el texto igual
        assert.match(chips, /Disney \+ ESPN · ₲ 73\.000/);
        assert.match(chips, /HBO Max · ₲ 21\.900/);
        assert.ok(!/\bBs\b|US\$/.test(chips));
        const shop = await t.call(null, "GET", "/api/shops/pedro-py");
        assert.equal(shop.json.products.find((p) => p.id === "disney-espn-alq").price, 7300000, "la misma cifra que su página");
        // Mis combos y Mi lista de precios: en su moneda de compra (US$), no Bs.
        await tab(page, /Mis combos/);
        assert.ok(!/\(Bs\)/.test(await page.locator("#sout").innerText()));
        await tab(page, /Clientes y ventas/);
        const prices = await page.locator("#myPrices").innerText();
        assert.match(prices, /Le cobro US\$/);
        assert.match(prices, /tu cliente ve ₲ 73\.000/);
        assert.deepEqual(page.errors, []);
        await page.close();

        // Paraguay sin tipo de cambio: aviso claro, ejemplo en vivo y se guarda escrito "7.300".
        page = await open("py2", "inicio");
        await page.locator("#afCountry").waitFor();
        assert.match(await page.locator("#afCountry").innerText(), /Poné tu tipo de cambio \(1 US\$ = … ₲\) para ver tus ganancias y tu página en tu moneda/);
        await tab(page, /Afiches/);
        await page.locator("form[data-locf=afiches]").waitFor();
        assert.equal(await page.locator("#poster").count(), 0, "sin tipo de cambio no se arma el afiche con otra moneda");
        assert.ok(!/\bBs\b/.test(await page.locator("#sout").innerText()));
        await page.goto(t.base + "/hub#inicio");
        await page.locator("#afCountry").waitFor();
        await page.waitForLoadState("networkidle"); // que no se redibuje mientras escribe
        const rate = page.locator("#afCountry input[name=rate]");
        await rate.fill("7.300");
        await page.locator("#afCountry [data-locex]").filter({ hasText: "≈ ₲ 51.100" }).waitFor();
        await page.locator("#afCountry").getByRole("button", { name: "Guardar" }).click();
        await page.locator("#afCountry .af-pill").filter({ hasText: "1 US$ = ₲ 7.300" }).waitFor();
        assert.ok(await noOverflow(page), "sin desborde (Paraguay sin tipo de cambio)");
        assert.deepEqual(page.errors, []);
        await page.close();
        t.s.locale.setMine(asR(t.r.py2), { rate: null }); // para la otra vuelta (claro/oscuro)

        // Panamá: todo en US$, sin tipo de cambio ni Bs.
        page = await open("pa", "inicio");
        await page.locator("#afCountry").waitFor();
        const pt = await page.locator("#afCountry").innerText();
        assert.match(pt, /Panamá · US\$/);
        assert.match(pt, /no hace falta tipo de cambio/);
        assert.ok(!/\bBs\b|₲/.test(await page.locator("#sout").innerText()));
        await tab(page, /Afiches/);
        await page.locator("#poster").waitFor();
        assert.match(await page.locator(".pchips").textContent(), /Disney \+ ESPN · US\$ 10/);
        assert.ok(await noOverflow(page), "sin desborde (Panamá)");
        assert.deepEqual(page.errors, []);
        await page.close();

        // Bolivia: una línea plegada, sin avisos de tipo de cambio (desde el 14/11, dentro de «Todas mis herramientas»).
        page = await open("bo", "inicio");
        await page.locator(".hmore > summary").click();
        await page.locator("#afCountry").waitFor();
        assert.ok(!(await page.locator("#afCountry").evaluate((d) => d.open)), "plegada");
        assert.ok(!/tipo de cambio/i.test(await page.locator(".hhead").innerText()));
        await page.close();
        await ctx.close();
      }
    } finally { await browser.close(); }
  });
});
