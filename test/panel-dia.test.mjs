// Panel del dueño (14/11/2026): «Mi secretaria» es LA pantalla del día (botón dentro del saludo, con cuántas cosas hay
// hoy), «Lo que tenés pendiente» va debajo de los accesos y el menú pasa de 7 áreas a 6 (Clientes y revendedores juntos;
// lo de configuración bajo «Ajustes»). No se quita ninguna pantalla (eso lo cuida test/panel-ordenado). Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("Panel: Mi secretaria en el saludo, pendientes debajo de los accesos, menú en 6 áreas con «Ajustes»", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-pdia-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 2 * 86_400_000, cost: 1000, profiles: [{ label: "P1" }, { label: "P2" }] });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Quispe", phone: "+59170011223" });
  const o = s.orders.create(owner, { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
  s.orders.setExpiry(owner, o.assignmentIds[0], Date.now() - 86_400_000); // vencida ayer: 1 cosa para hoy
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel#inicio");
    const sec = p.locator(".hm-hero .sec-cta");
    await sec.waitFor();
    assert.match(await sec.innerText(), /Abrir Mi secretaria · 1 para hoy/);
    assert.ok((await sec.boundingBox()).height >= 44);
    assert.equal(await p.locator("#pout > .sec-cta").count(), 0, "ya no hay una barra aparte arriba");
    // «Lo que tenés pendiente» (si hay) va después de los accesos rápidos.
    if (await p.locator(".hm-pend").count()) {
      const after = await p.evaluate(() => !!(document.querySelector(".hm-grid").compareDocumentPosition(document.querySelector(".hm-pend")) & Node.DOCUMENT_POSITION_FOLLOWING));
      assert.equal(after, true);
    }
    await sec.click();
    await p.waitForFunction(() => location.hash === "#secretaria");
    // Menú: 6 áreas, Clientes y revendedores juntos, «Ajustes» como separador (no como pantalla).
    const areas = await p.evaluate(() => [...document.querySelectorAll("#menu > details > summary, #menu > button")].map((x) => x.textContent.replace(/\d+$/, "").trim()));
    assert.equal(areas.length, 6, areas.join(" | "));
    assert.ok(areas.includes("Clientes y revendedores") && areas.includes("Herramientas y ajustes"));
    const cl = await p.evaluate(() => [...document.querySelectorAll('#menu details[data-area="a-clientes"] [data-go]')].map((x) => x.dataset.go));
    assert.deepEqual(cl, ["clientes", "revendedores", "comovan"]);
    const her = await p.evaluate(() => [...document.querySelectorAll('#menu details[data-area="a-herramientas"] .sub > *')].map((x) => x.dataset.go ?? `[${x.textContent.trim()}]`));
    assert.deepEqual(her, ["descargas", "whatsapp", "oficina", "excel", "ayuda", "[⚙️ Ajustes]", "configuracion", "apariencia", "usuarios", "auditoria"]);
    await p.evaluate(() => document.getElementById("app").classList.add("open"));
    await p.fill("#menuFind", "ajustes");
    assert.doesNotMatch(await p.locator("#menu").innerHTML(), /menusep/, "el buscador no muestra separadores");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
