// «Seguridad de mi cuenta» en pantalla (14/11/2026): el revendedor ve dónde está abierta su cuenta y sus ingresos y
// cierra los otros aparatos; el dueño ve los ingresos de un revendedor y lo saca de todos lados; y ve los suyos en
// Configuración. Datos ficticios, 360 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const WINDOWS = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36 Edg/120.0";

test("Seguridad en pantalla: revendedor cierra otros aparatos; dueño lo saca de todos lados y ve sus propios ingresos", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-segp-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  const ari = s.catalog.createCustomer(owner, { name: "Ari Prueba", phone: "+59171000011", kind: "reseller", priceGroupId: "revendedor" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck, ua) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}), ...(ua ? { "user-agent": ua } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" }, null, WINDOWS)).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${ari.id}/login-pin`, {}, ock)).json();
    // Ari entra desde la compu (otro aparato) y desde el celular (el navegador de la prueba).
    await post("/api/auth/customer/pin", { phone: ari.phone, pin }, null, WINDOWS);
    const rck = (await post("/api/auth/customer/pin", { phone: ari.phone, pin })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, ari.id);
    const [n, v] = rck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (d) => d.accept());
    // Llega desde «Más» → «Mi cuenta».
    await p.goto(base + "/hub#mas");
    await p.locator('.hubarea-i[data-s="seguridad"]').click();
    await p.getByRole("heading", { name: /Seguridad de mi cuenta/ }).waitFor();
    const txt = await p.locator("#sout").innerText();
    assert.match(txt, /Dónde está abierta \(2\)/);
    assert.match(txt, /Windows · Edge/);
    assert.match(txt, /Este aparato/);
    assert.match(txt, /Entró/);
    for (const h of await p.locator("#sout .sbtn").evaluateAll((els) => els.filter((e) => e.offsetParent).map((e) => e.getBoundingClientRect().height))) assert.ok(h >= 44, `botón de ${h}px`);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
    await p.locator("[data-secothers]").click();
    await p.locator("#sout", { hasText: "Dónde está abierta (1)" }).waitFor();
    assert.deepEqual(errs, []);
    await ctx.close();

    // El dueño: tarjeta del revendedor → 🔐 Seguridad → Sacarlo de todos lados.
    const pctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    await pctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const [on, ov] = ock.split("="); await pctx.addCookies([{ name: on, value: ov, url: base }]);
    const pp = await pctx.newPage(); const perrs = []; pp.on("pageerror", (e) => perrs.push(e.message));
    pp.on("dialog", (d) => d.accept());
    await pp.goto(base + "/panel#revendedores");
    await pp.locator(`[data-rsec="${ari.id}"]`).click();
    const card = pp.locator("#rseccard");
    await card.waitFor();
    assert.match(await card.innerText(), /abierta en 1 aparato/);
    assert.match(await card.innerText(), /La tienda le generó un PIN nuevo/);
    await pp.locator("[data-routall]").click();
    await card.locator("text=No tiene sesiones abiertas ahora").waitFor();
    assert.notEqual((await (await fetch(base + "/api/me", { headers: { cookie: rck } })).json()).loggedIn, true, "Ari quedó afuera");
    // Sus propios aparatos e ingresos, en Configuración.
    await pp.goto(base + "/panel#configuracion"); await pp.reload(); // cambiar solo el # no recarga la página
    await pp.locator("#mysec").waitFor();
    await pp.locator("#mysec summary").first().click(); // Configuración muestra las tarjetas plegadas
    assert.match(await pp.locator("#mysec").innerText(), /Dónde está abierto tu panel \(1\)/);
    assert.deepEqual(perrs, []);
    await pctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
