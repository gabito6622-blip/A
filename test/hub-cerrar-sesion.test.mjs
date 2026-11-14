// GaboHub (14/11/2026): el dueño entró a la cuenta de un revendedor y no encontró «Cerrar sesión» (estaba solo al final
// de «Cuentas de la tienda», debajo de todas las cuentas). Ahora está en «Más» → «Mi cuenta». Datos ficticios, 360 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("GaboHub: «Más» tiene «Cerrar sesión» y cierra de verdad", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-salir-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500 } });
  const rev = s.catalog.createCustomer(owner, { name: "Rita Prueba", phone: "+59171000055", kind: "reseller", priceGroupId: "rev" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${rev.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: rev.phone, pin })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, rev.id);
    const [n, v] = rck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(base + "/hub#inicio");
    await page.locator(".htiles").waitFor();
    await page.locator('.bnav [data-s="mas"]').click();
    const out = page.locator("#sout .hubarea-i[data-logout]");
    await out.waitFor();
    assert.match(await out.innerText(), /Cerrar sesión/);
    assert.ok((await out.boundingBox()).height >= 44, "botón de 44 px");
    // El buscador de «Más» también lo encuentra.
    await page.locator("#hubFind").fill("salir");
    assert.equal(await out.isVisible(), true);
    await out.click();
    await page.getByText("Cerraste sesión").waitFor();
    const me = await page.evaluate(() => fetch("/api/me").then((r) => r.json()).catch(() => ({})));
    assert.notEqual(me.loggedIn, true, "la sesión quedó cerrada en el servidor");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
