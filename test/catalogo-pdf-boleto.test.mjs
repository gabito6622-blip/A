// 📄 Botón «Descargar catálogo en PDF» para el cliente final en el diseño «boleto» (17/11/2026). El dueño: «mis clientes
// finales deberían ver algún botoncito para descargarlo». El diseño boleto (el de su tienda) no lo mostraba. Datos ficticios.
// PDF_SHOTS=<carpeta> guarda capturas.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("diseño boleto: el cliente ve y baja el catálogo PDF (tienda y página del revendedor)", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-pdfboleto-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.updateSettings(owner, { storeName: "Tienda Ficticia", whatsapp: "59170000000", layout: "ticket" });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix Premium", category: "Streaming", kind: "profile", durationDays: 30, price: 4000, published: true });
  s.catalog.upsertProduct(owner, { id: "disney", name: "Disney+", category: "Streaming", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 3000, disney: 2500 } });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Flores", phone: "+59171000001", kind: "reseller", priceGroupId: "revendedor" });
  s.shops.setPage(owner, ana.id, true);
  s.shops.setupFor(owner, ana.id, { slug: "ana-tv", title: "Ana TV", whatsapp: "59171000001", enabled: true });
  s.portal.setPrices({ id: "u_" + ana.id, role: "reseller", customerId: ana.id }, { netflix: 4500, disney: 3800 });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    if (!chromium) return;
    const shots = process.env.PDF_SHOTS;
    const b = await chromium.launch();
    try {
      for (const [path, href] of [["/tienda/", "/api/catalogo.pdf"], ["/r/ana-tv", "/api/shops/ana-tv/catalogo.pdf"]]) {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1, acceptDownloads: true });
        await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
        await p.goto(base + path, { waitUntil: "networkidle" });
        const a = p.locator("a[data-catpdf]").first();
        await a.waitFor();
        assert.equal(await a.getAttribute("href"), href);
        assert.match(await a.innerText(), /Descargar catálogo en PDF/);
        const box = await a.boundingBox();
        assert.ok(box.height >= 44, `alto ${box.height}`);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "sin desborde");
        if (shots) { await a.scrollIntoViewIfNeeded(); await p.screenshot({ path: `${shots}/pdf-${path.replace(/\W+/g, "-")}.png` }); }
        const [dl] = await Promise.all([p.waitForEvent("download"), a.click()]);
        const file = join(dir, `bajado-${path.replace(/\W+/g, "")}.pdf`);
        await dl.saveAs(file);
        const { readFileSync } = await import("node:fs");
        assert.equal(readFileSync(file).subarray(0, 5).toString("latin1"), "%PDF-");
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    } finally { await b.close(); }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
