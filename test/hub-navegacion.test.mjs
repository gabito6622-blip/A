// GaboHub etapa 1 (12/11/2026): el panel del revendedor con la forma del panel del dueño. Abajo: Inicio · Clientes ·
// Vender · Inventario · Más. Las 10 pestañas de "Mis clientes" se ven por grupo (Mi negocio, Inventario, Mi vitrina)
// y TODAS siguen llegando: desde su grupo, desde "Más" (con buscador) y desde "Vender". Datos ficticios, 360 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("GaboHub: barra de abajo, pestañas por grupo, Vender y Más llegan a todo", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-hubnav-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500 } });
  const conPag = s.catalog.createCustomer(owner, { name: "Ana Vitrina", phone: "+59171234567", kind: "reseller", priceGroupId: "rev" });
  s.shops.setPage(owner, conPag.id, true);
  s.shops.setupFor(owner, conPag.id, { slug: "ana-tv", title: "Ana TV", enabled: true });
  const solo = s.catalog.createCustomer(owner, { name: "Beto Panel", phone: "+59172345678", kind: "reseller", priceGroupId: "rev" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const enter = async (c) => {
      const { pin } = await (await post(`/api/admin/customers/${c.id}/login-pin`, {}, ock)).json();
      const rck = (await post("/api/auth/customer/pin", { phone: c.phone, pin })).headers.get("set-cookie").split(";")[0];
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, c.id);
      const [n, v] = rck.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      return { ctx, page, errs };
    };
    const small = (page, sel) => page.evaluate((q) => [...document.querySelectorAll(q)].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 44).map((x) => x.textContent.trim()), sel);
    const over = (page) => page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    const selTab = (page) => page.locator('.rtabs [aria-selected="true"]').innerText();
    const current = (page) => page.locator(".bnav [aria-current=page]").innerText();

    // ---- Revendedor con página propia ----
    const { ctx, page, errs } = await enter(conPag);
    await page.goto(base + "/hub#inicio");
    await page.locator(".htiles").waitFor();
    assert.deepEqual((await page.locator(".bnav button").allInnerTexts()).map((x) => x.trim()), ["Inicio", "Clientes", "Vender", "Inventario", "Más"]);
    assert.deepEqual(await small(page, ".bnav button"), []);

    // Clientes: solo "Mi negocio" (4 pestañas), en filas que se ven completas.
    await page.locator('.bnav [data-s="clientes"]').click();
    await page.locator(".rtabs.hubtabs").waitFor();
    assert.deepEqual((await page.locator(".rtabs [role=tab]").allInnerTexts()).map((x) => x.trim()), ["👥 Clientes y ventas", "📊 Mi control", "💸 Quién me debe", "📈 Mis ganancias"]);
    assert.deepEqual(await small(page, ".rtabs [role=tab]"), []);
    assert.equal(await over(page), false);

    // Inventario (etapa 2): Por plataforma + Cuentas de la tienda + Repartir perfiles + Mis cuentas propias.
    // La barra marca Inventario también adentro de cada pestaña.
    await page.locator('.bnav [data-s="inventario"]').click();
    await page.waitForFunction(() => location.hash === "#inventario");
    assert.deepEqual((await page.locator(".rtabs [role=tab]").allInnerTexts()).map((x) => x.trim()), ["🗂️ Por plataforma", "📺 Cuentas de la tienda", "🧩 Repartir perfiles", "📦 Mis cuentas propias"]);
    await page.getByRole("tab", { name: /Cuentas de la tienda/ }).click();
    await page.waitForFunction(() => location.hash === "#cuentas");
    assert.equal((await current(page)).trim(), "Inventario");
    await page.getByRole("tab", { name: /Mis cuentas propias/ }).click();
    await page.getByRole("heading", { name: /Mis cuentas propias/ }).waitFor();
    assert.equal(await selTab(page), "📦 Mis cuentas propias");
    assert.equal((await current(page)).trim(), "Inventario");
    await page.getByRole("tab", { name: /Cuentas de la tienda/ }).click();
    await page.waitForFunction(() => location.hash === "#cuentas");

    // Vender: 5 caminos, cada uno a su pantalla de siempre.
    await page.locator('.bnav [data-s="vender"]').click();
    await page.locator(".hubpick-i").first().waitFor();
    assert.equal(await page.locator(".hubpick-i").count(), 5);
    assert.deepEqual(await small(page, ".hubpick-i"), []);
    await page.locator(".hubpick-i", { hasText: "Una cuenta tuya" }).click();
    await page.getByRole("heading", { name: /Mis cuentas propias/ }).waitFor();
    await page.locator('.bnav [data-s="vender"]').click();
    await page.locator(".hubpick-i", { hasText: "Una cuenta de la tienda" }).click();
    await page.waitForFunction(() => document.querySelector('.rtabs [aria-selected="true"]')?.textContent.includes("Clientes y ventas"));

    // Más: las 5 áreas y TODOS los destinos, sin pestañas escondidas.
    await page.locator('.bnav [data-s="mas"]').click();
    await page.locator(".hubarea").first().waitFor();
    const items = (await page.locator(".hubarea-i").allInnerTexts()).map((x) => x.trim());
    for (const want of ["Clientes y ventas", "Mi control", "Quién me debe", "Mis ganancias", "Por plataforma", "Cuentas de la tienda", "Repartir perfiles", "Mis cuentas propias", "Códigos", "Mi página", "Mis combos y descuentos", "Afiches", "Comprar a la tienda", "Saldo y recargas", "Reportar falla", "Guía", "Mi país y moneda"])
      assert.ok(items.some((x) => x.includes(want)), `En "Más" falta: ${want}`);
    assert.deepEqual(await small(page, ".hubarea-i"), []);
    // Buscador (sin tildes): "pagina" encuentra Mi página; algo que no existe avisa.
    await page.fill("#hubFind", "pagina");
    assert.deepEqual((await page.locator(".hubarea-i:visible").allInnerTexts()).map((x) => x.trim()), ["🏪 Mi página"]);
    await page.fill("#hubFind", "zzz");
    await page.locator("#hubNone").waitFor({ state: "visible" });
    await page.fill("#hubFind", "");
    // Mi página (vitrina): la barra marca "Más" y la fila muestra Mi página, Combos y Afiches.
    await page.locator(".hubarea-i", { hasText: "Mi página" }).click();
    await page.waitForFunction(() => document.querySelector('.rtabs [aria-selected="true"]')?.textContent.includes("Mi página"));
    assert.deepEqual((await page.locator(".rtabs [role=tab]").allInnerTexts()).map((x) => x.trim()), ["🏪 Mi página", "🎁 Mis combos y descuentos", "🖼️ Afiches"]);
    assert.equal((await current(page)).trim(), "Más");
    // Tocar "Clientes" abajo te devuelve a Mi negocio, aunque vinieras de Mi página.
    await page.locator('.bnav [data-s="clientes"]').click();
    await page.waitForFunction(() => document.querySelector('.rtabs [aria-selected="true"]')?.textContent.includes("Clientes y ventas"));
    // Los atajos del Inicio siguen funcionando (Mi control → su pestaña, dentro de Mi negocio).
    await page.locator('.bnav [data-s="inicio"]').click();
    await page.locator('.hqrow [data-rtool="control"]').click();
    await page.waitForFunction(() => document.querySelector('.rtabs [aria-selected="true"]')?.textContent.includes("Mi control"));
    assert.deepEqual(errs, []);
    await ctx.close();

    // ---- Revendedor "solo panel": sin Mi página ni Combos, pero con Afiches ----
    const s2 = await enter(solo);
    await s2.page.goto(base + "/hub#mas");
    await s2.page.locator(".hubarea").first().waitFor();
    const it2 = (await s2.page.locator(".hubarea-i").allInnerTexts()).join(" | ");
    assert.doesNotMatch(it2, /Mi página|Mis combos/);
    assert.match(it2, /Afiches/);
    await s2.page.locator(".hubarea-i", { hasText: "Afiches" }).click();
    await s2.page.waitForFunction(() => document.querySelector('.rtabs [aria-selected="true"]')?.textContent.includes("Afiches"));
    assert.deepEqual((await s2.page.locator(".rtabs [role=tab]").allInnerTexts()).map((x) => x.trim()), ["🖼️ Afiches"]);
    assert.equal(await over(s2.page), false);
    assert.deepEqual(s2.errs, []);
    await s2.ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
