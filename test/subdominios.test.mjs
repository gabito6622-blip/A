// Subdominios de revendedores (13/11/2026): daniel.gabostore.lat muestra la página de Daniel (la misma que /r/daniel),
// sin cambiar la dirección. Un subdominio que no es de ninguna página publicada, o reservado, lleva a la portada.
// El link lindo solo se le muestra al revendedor con GS_SHOP_SUBDOMAINS=1 (cuando el comodín ya tiene candado).
// Datos ficticios en carpeta temporal.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { request } from "node:http";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

const get = (port, host, path) => new Promise((ok, bad) => {
  const r = request({ host: "127.0.0.1", port, path, method: "GET", headers: { host } }, (res) => { let b = ""; res.on("data", (c) => (b += c)); res.on("end", () => ok({ status: res.statusCode, location: res.headers.location, body: b })); });
  r.on("error", bad); r.end();
});

async function boot(opts) {
  const dir = mkdtempSync(join(tmpdir(), "gs-subdom-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, staticDir: resolve("public"), ...opts });
  const s = app.store, owner = { id: "u_owner", role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500 } });
  const dani = s.catalog.createCustomer(owner, { name: "Daniel Prueba", phone: "+59171000099", kind: "reseller", priceGroupId: "rev" });
  s.shops.setPage(owner, dani.id, true);
  s.shops.setupFor(owner, dani.id, { slug: "daniel", title: "Daniel TV", whatsapp: "59171000099", enabled: true });
  const apagada = s.catalog.createCustomer(owner, { name: "Rosa Apagada", phone: "+59171000098", kind: "reseller", priceGroupId: "rev" });
  s.shops.setPage(owner, apagada.id, true);
  s.shops.setupFor(owner, apagada.id, { slug: "rosa", title: "Rosa TV", enabled: false });
  const port = await app.listen(0, "127.0.0.1");
  return { port, app, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("Subdominios de revendedores", () => {
  let s;
  before(async () => { s = await boot({ publicOrigin: "https://gabostore.lat", shopSubdomains: true }); });
  after(() => s.stop());

  test("daniel.gabostore.lat muestra la página de Daniel sin cambiar la dirección", async () => {
    const r = await get(s.port, "daniel.gabostore.lat", "/");
    assert.equal(r.status, 200);
    assert.match(r.body, /<meta name="gs-shop" content="daniel">/);
    assert.match(r.body, /Daniel TV/, "la vista previa del link (WhatsApp) es la de Daniel");
    assert.match(r.body, /https:\/\/daniel\.gabostore\.lat\//, "el link que se comparte es el del subdominio");
    assert.equal((await get(s.port, "DANIEL.gabostore.lat:443", "/")).status, 200, "mayúsculas y puerto no lo rompen");
  });

  test("los archivos y la API andan desde el subdominio", async () => {
    assert.equal((await get(s.port, "daniel.gabostore.lat", "/shop.js")).status, 200);
    const pub = await get(s.port, "daniel.gabostore.lat", "/api/shops/daniel");
    assert.equal(pub.status, 200);
    assert.doesNotMatch(pub.body, /"cost"|costPrice/, "la página pública no muestra costos");
  });

  test("subdominio desconocido, apagado o reservado lleva a la portada de la tienda", async () => {
    for (const host of ["nadie.gabostore.lat", "rosa.gabostore.lat", "api.gabostore.lat", "panel.gabostore.lat", "a.b.gabostore.lat", "-mal.gabostore.lat"]) {
      const r = await get(s.port, host, "/");
      assert.equal(r.status, 302, host);
      assert.equal(r.location, "https://gabostore.lat/", host);
    }
  });

  test("el dominio principal, www y /r/daniel siguen como antes", async () => {
    assert.match((await get(s.port, "gabostore.lat", "/")).body, /gs-mode" content="store"/);
    assert.equal((await get(s.port, "www.gabostore.lat", "/r/daniel")).location, "https://gabostore.lat/r/daniel");
    assert.equal((await get(s.port, "gabostore.lat", "/r/daniel")).status, 200);
  });

  test("con el interruptor prendido, la tienda avisa el dominio para armar el link lindo", async () => {
    const r = JSON.parse((await get(s.port, "gabostore.lat", "/api/settings")).body);
    assert.equal(r.shopDomain, "gabostore.lat");
  });
});

describe("Subdominios: interruptor apagado o sin dominio propio", () => {
  test("sin GS_SHOP_SUBDOMAINS, el link que ve el revendedor sigue siendo /r/…", async () => {
    const s = await boot({ publicOrigin: "https://gabostore.lat" });
    try {
      const r = JSON.parse((await get(s.port, "gabostore.lat", "/api/settings")).body);
      assert.equal(r.shopDomain, undefined);
    } finally { await s.stop(); }
  });
  test("con la dirección de Railway no hay subdominios ni redirecciones", async () => {
    const s = await boot({ publicOrigin: "https://tienda-production-8c7b.up.railway.app", shopSubdomains: true });
    try {
      assert.equal((await get(s.port, "tienda-production-8c7b.up.railway.app", "/")).status, 200);
      const r = JSON.parse((await get(s.port, "tienda-production-8c7b.up.railway.app", "/api/settings")).body);
      assert.equal(r.shopDomain, undefined);
    } finally { await s.stop(); }
  });
});

test("en el celular, daniel.gabostore.lat abre la tienda de Daniel con sus productos", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const s = await boot({ publicOrigin: "https://gabostore.lat", shopSubdomains: true });
  const b = await chromium.launch({ args: [`--host-resolver-rules=MAP daniel.gabostore.lat 127.0.0.1`] });
  try {
    const page = await b.newPage({ viewport: { width: 360, height: 740 } });
    const errs = []; page.on("pageerror", (e) => errs.push(String(e)));
    await page.goto(`http://daniel.gabostore.lat:${s.port}/`);
    await page.getByText("Daniel TV").first().waitFor({ timeout: 15_000 });
    await page.getByText("Netflix").first().waitFor({ timeout: 15_000 });
    assert.equal(new URL(page.url()).pathname, "/", "la dirección queda limpia");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await s.stop(); }
});

test("en su panel, el revendedor elige su nombre y ve al instante cómo le queda el link", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const s = await boot({ publicOrigin: "https://gabostore.lat", shopSubdomains: true });
  s.app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const dani = Object.values(s.app.store.engine.s.customers).find((c) => c.shop?.slug === "daniel");
  const base = `http://127.0.0.1:${s.port}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${dani.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: dani.phone, pin })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, dani.id);
    const [n, v] = rck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(base + "/hub#clientes");
    await page.locator(".rtabs").waitFor();
    if (await page.locator('[data-rtab="pagina"]').count()) await page.locator('[data-rtab="pagina"]').click();
    else { await page.locator('.bnav [data-s="mas"]').click(); await page.locator("#sout [data-gopage]").first().click(); }
    const slug = page.locator('#shopForm input[name="slug"]');
    await slug.waitFor();
    assert.match(await page.locator("#shopForm").innerText(), /lo que va antes de \.gabostore\.lat/);
    assert.match(await page.locator("#slugPrev b").innerText(), /^https:\/\/daniel\.gabostore\.lat$/);
    await slug.fill(""); await slug.pressSequentially("Dani Strem");
    assert.equal(await slug.inputValue(), "dani-strem", "minúsculas y guiones solos");
    assert.equal(await page.locator("#slugPrev b").innerText(), "https://dani-strem.gabostore.lat");
    const fs = await page.locator("#slugPrev").evaluate((el) => parseFloat(getComputedStyle(el).fontSize));
    assert.ok(fs >= 12, `letra de ${fs}px`);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    assert.deepEqual(errs, []);
  } finally { await b.close(); await s.stop(); }
});
