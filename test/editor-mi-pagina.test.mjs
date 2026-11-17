// Editor de «Mi página» del revendedor (17/11/2026), en el navegador a 360 y 1280 px, claro y oscuro:
// secciones plegables, paletas que cambian la vista previa SIN guardar, guardar y ver el color en /r/<slug>,
// y todas las opciones de antes siguen. Datos ficticios en carpeta temporal, sin red.
// Con GS_SHOTS=<carpeta fuera del repo> guarda capturas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const SHOTS = process.env.GS_SHOTS || "";

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "gs-editor-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, staticDir: resolve("public"), fetchImpl: async () => { throw new Error("sin red"); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertProduct(owner, { id: "dp", name: "Disney+", kind: "profile", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500, dp: 2000 } });
  const mk = (name, phone, slug, title) => {
    const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" });
    s.shops.setPage(owner, c.id, true);
    s.shops.setupFor(owner, c.id, { slug, title, whatsapp: phone.slice(1), enabled: true });
    s.portal.setPrices({ id: "u_" + c.id, role: "reseller", customerId: c.id }, { nf: 3500, dp: 3000 });
    return c;
  };
  const dani = mk("Daniel Prueba", "+59171000099", "daniel", "Daniel TV");
  const otro = mk("Otra Persona", "+59171000088", "otra", "Otra Tienda");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
  const { pin } = await (await post(`/api/admin/customers/${dani.id}/login-pin`, {}, ock)).json();
  const rck = (await post("/api/auth/customer/pin", { phone: dani.phone, pin })).headers.get("set-cookie").split(";")[0];
  return { app, base, dani, otro, rck, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

async function openEditor(b, env, width, dark) {
  const ctx = await b.newContext({ viewport: { width, height: width < 800 ? 780 : 900 }, colorScheme: dark ? "dark" : "light", ...(width < 800 ? { isMobile: true, hasTouch: true } : {}) });
  await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)|facebook\.com/, (r) => r.abort());
  await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, env.dani.id);
  const [n, v] = env.rck.split("="); await ctx.addCookies([{ name: n, value: v, url: env.base }]);
  const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
  await page.goto(env.base + "/hub#clientes");
  await page.locator(".rtabs").waitFor();
  if (await page.locator('[data-rtab="pagina"]').count()) await page.locator('[data-rtab="pagina"]').click();
  else { await page.locator('[data-s="mas"]:visible').first().click(); await page.locator("#sout [data-gopage]").first().click(); }
  await page.locator("#shopForm").waitFor();
  await page.waitForLoadState("networkidle"); await page.waitForTimeout(400);
  return { ctx, page, errs };
}
const bgOf = (frame) => frame.evaluate(() => { const e = [document.documentElement, document.body, document.querySelector(".shop")].find((x) => x?.style.getPropertyValue("--s-bg")); return (e ? e.style.getPropertyValue("--s-bg") : getComputedStyle(document.querySelector(".shop") ?? document.body).getPropertyValue("--s-bg")).trim().toLowerCase(); });

// GS_EDITOR_WIDTHS=360,390,768,1280 para revisar más anchos (por defecto 360 y 1280).
for (const width of (process.env.GS_EDITOR_WIDTHS || "360,1280").split(",").map(Number)) {
  test(`editor de Mi página a ${width} px: secciones, paleta en vivo sin guardar, guardar y /r/<slug>`, { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const env = await boot();
    const b = await chromium.launch();
    try {
      for (const dark of [false, true]) {
        const { ctx, page, errs } = await openEditor(b, env, width, dark);
        // Las cinco secciones y todas las opciones de antes.
        for (const s of ["marca", "colores", "portada", "productos", "publicar"]) assert.equal(await page.locator(`details[data-edsec="${s}"]`).count(), 1, s);
        for (const s of ["portada", "productos", "publicar"]) await page.locator(`details[data-edsec="${s}"] > summary`).click();
        for (const name of ["title", "slug", "whatsapp", "accentColor", "accent2Color", "backgroundColor", "layout", "bgStyle", "cardStyle", "corners", "headingFont", "fontFamily",
          "heroChip", "heroTitle", "heroHighlight", "heroText", "heroTicks", "announcement", "storeHours", "footerText", "instagram", "tiktok", "facebook", "prod"]) {
          assert.ok(await page.evaluate((k) => !!document.getElementById("shopForm").elements[k], name), `campo ${name}`);
        }
        for (const sel of ["#shopLogo", "#shopBanner", "#shopQr", "#shopPayNote", "#shopFaq", "#shopOn", "[data-copy]", "[data-tpl]", "[data-mixrand]", "[data-mixl]", "[data-theme]", "[data-mixt]", "[data-pv=pc]", "[data-pv=cel]", '[form="shopLogo"][type=file]', '[form="shopBanner"][type=submit]'])
          assert.ok(await page.locator(sel).count() > 0, `sigue ${sel}`);
        // Sin scroll lateral y botones de 44 px en lo nuevo.
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "sin scroll lateral");
        const small = await page.evaluate(() => [...document.querySelectorAll(".edsec > summary, .edpal-b, .rsave .sbtn, .edsec-b .ropts span")].filter((e) => e.offsetParent && e.getBoundingClientRect().height < 44).map((e) => e.textContent.trim().slice(0, 30)));
        assert.deepEqual(small, [], "todo de 44 px");
        const tiny = await page.evaluate(() => [...document.querySelectorAll(".reditor *")].filter((e) => e.offsetParent && e.childNodes.length && [...e.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(e).fontSize) < 12).map((e) => e.textContent.trim().slice(0, 30)));
        assert.deepEqual(tiny, [], "texto de 12 px o más");
        // Guardar fijo abajo.
        const bar = await page.locator(".rsave").boundingBox();
        if (width < 1024) assert.ok(bar.y + bar.height >= 780 - 2, "Guardar pegado abajo");
        const frame = page.frameLocator("#shopPreview");
        await frame.locator("body").waitFor({ state: "attached" });
        const fr = page.frame({ url: /\/r\/daniel/ });
        await fr.waitForFunction(() => document.querySelector("#sout"));
        if (!dark) {
          // Paleta «Rosa Pastel»: la vista previa cambia sin guardar.
          if (width < 1024) assert.equal(await page.locator("#edPreview").isVisible(), false, "en celular la vista previa está escondida");
          await page.locator('[data-rpal="rosa"]').click();
          assert.equal(await page.locator('#shopForm input[name="backgroundColor"]').inputValue(), "#fff0f6");
          await fr.waitForFunction(() => /fff0f6|255, 240, 246/i.test(document.documentElement.outerHTML.slice(0, 4000) + [document.documentElement, document.body, document.querySelector(".shop")].map((x) => x?.style.cssText).join()), null, { timeout: 5000 });
          assert.match(await page.locator("#edDirty").innerText(), /sin guardar/);
          const saved = await (await fetch(env.base + "/api/shops/daniel")).json().catch(() => ({}));
          assert.notEqual(String(saved.backgroundColor ?? saved.settings?.backgroundColor ?? "").toLowerCase(), "#fff0f6", "todavía no se guardó");
          // Aviso de contraste con un color ilegible elegido a mano.
          await page.locator('#shopForm input[name="accentColor"]').evaluate((e) => { e.value = "#ffe6f0"; e.dispatchEvent(new Event("input", { bubbles: true })); });
          await page.waitForFunction(() => /se lee poco/.test(document.getElementById("shopWarn").textContent));
          await page.locator('[data-rpal="rosa"]').click();
          if (width < 1024) {
            await page.locator("[data-pvfull]").click();
            assert.equal(await page.locator("#edPreview").isVisible(), true, "vista previa a pantalla completa");
            const box = await page.locator("#edPreview").boundingBox();
            assert.ok(box.width >= width - 1 && box.height >= 700, "ocupa toda la pantalla");
            if (SHOTS) await page.screenshot({ path: join(SHOTS, `editor-${width}-vista-previa.png`) });
            await page.keyboard.press("Escape");
            assert.equal(await page.locator("#edPreview").isVisible(), false);
          } else {
            const [l, r] = await Promise.all([page.locator(".edcol").boundingBox(), page.locator("#edPreview").boundingBox()]);
            assert.ok(r.x > l.x + l.width - 1 && r.width > 300, "dos columnas: editor a la izquierda, vista previa a la derecha");
          }
          await page.locator(".rsave button[type=submit]").click();
          await page.waitForFunction(() => document.body.innerText.includes("Guardado"));
          const p2 = await ctx.newPage();
          await p2.goto(env.base + "/r/daniel");
          await p2.locator("#sout").waitFor();
          await p2.waitForFunction(() => getComputedStyle(document.querySelector(".shop") ?? document.body).getPropertyValue("--s-bg").trim().toLowerCase() === "#fff0f6", null, { timeout: 8000 });
          // Separación: la página de otra persona no cambió.
          const p3 = await ctx.newPage(); await p3.goto(env.base + "/r/otra"); await p3.locator("#sout").waitFor(); await p3.waitForTimeout(300);
          assert.notEqual(await bgOf(p3), "#fff0f6", "la página de otro revendedor no cambia");
          await p2.close(); await p3.close();
        }
        if (SHOTS) { await page.evaluate(() => scrollTo(0, 0)); await page.screenshot({ path: join(SHOTS, `editor-${width}-${dark ? "oscuro" : "claro"}.png`), fullPage: width >= 1024 }); }
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    } finally { await b.close(); await env.stop(); }
  });
}
