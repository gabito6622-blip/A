// Sin destello azul (13/11/2026): la tienda pintaba primero los colores de fábrica (azul) y recién al llegar la
// configuración pasaba a los del dueño. Ahora el HTML ya trae sus colores. Datos ficticios en carpeta temporal.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { earlyLookVars } from "../dist/server/earlyLook.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

const GOLD = { accentColor: "#fcc42d", accent2Color: "#ffd95a", backgroundColor: "#070b16", bgStyle: "glow", cardStyle: "glass" };

describe("Colores desde el primer cuadro", () => {
  let app, base, dir;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-flash-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, staticDir: resolve("public"), publicOrigin: "https://gabostore.lat" });
    const s = app.store, owner = { id: "u_owner", role: "owner" };
    Object.assign(s.engine.s.settings, GOLD);
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
    s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500 } });
    const ana = s.catalog.createCustomer(owner, { name: "Ana Prueba", phone: "+59171000077", kind: "reseller", priceGroupId: "rev" });
    s.shops.setPage(owner, ana.id, true);
    s.shops.setupFor(owner, ana.id, { slug: "ana-tv", title: "Ana TV", enabled: true });
    s.shops.update({ id: "u_" + ana.id, role: "reseller", customerId: ana.id }, { accentColor: "#e50914", backgroundColor: "#ffffff", bgStyle: "dots" });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  });
  after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  test("el HTML de la tienda ya trae el dorado del dueño, no el azul de fábrica", async () => {
    for (const p of ["/tienda/", "/hub"]) {
      const html = await (await fetch(base + p)).text();
      assert.match(html, /<html[^>]* style="[^"]*--s-blue:#fcc42d/, p);
      assert.match(html, /--s-bg:#070b16/, p);
      assert.match(html, /<meta name="theme-color" content="#070b16">/, p);
      assert.match(html, /<div class="shop" id="shop" data-corners="round" data-bg="glow" data-card="glass"/, p);
      assert.doesNotMatch(html, /--s-blue:#3984ff/, p);
    }
  });

  test("la página de un revendedor sale con SUS colores (fondo claro incluido)", async () => {
    const html = await (await fetch(base + "/r/ana-tv")).text();
    assert.match(html, /--s-blue:#e50914/);
    assert.match(html, /--s-ink:#111827/, "fondo claro: letras oscuras desde el principio");
    assert.match(html, /color-scheme:light/);
    assert.match(html, /data-bg="dots"/);
    assert.doesNotMatch(html, /#fcc42d/, "no se mezcla con los colores de la tienda");
  });

  test("las cuentas son las mismas que hace el navegador (contraste del botón ≥ 4,5)", () => {
    const { vars } = earlyLookVars(GOLD);
    assert.equal(vars["--s-on-blue"], "#0d1117", "sobre dorado, texto oscuro");
    assert.equal(vars["--s-sky"], "#ffd95a");
    const fallback = earlyLookVars({ accentColor: "nada", backgroundColor: "<script>" });
    assert.equal(fallback.vars["--s-blue"], "#3984ff", "un color mal guardado no rompe nada");
    assert.equal(fallback.bg, "#090e1d");
  });

  test("en el celular, aunque la configuración tarde, el primer cuadro ya es dorado", { skip: !chromium && "Playwright no está instalado", timeout: 60_000 }, async () => {
    const b = await chromium.launch();
    try {
      const page = await b.newPage({ viewport: { width: 360, height: 740 } });
      await page.route(/\/api\/settings/, () => { /* se queda colgada: así se ve el primer cuadro */ });
      await page.goto(base + "/tienda/", { waitUntil: "domcontentloaded" });
      const look = await page.evaluate(() => {
        const cs = getComputedStyle(document.documentElement);
        return { blue: cs.getPropertyValue("--s-blue").trim(), bg: getComputedStyle(document.body).backgroundColor, mark: getComputedStyle(document.querySelector("#logoMark")).backgroundImage };
      });
      assert.equal(look.blue, "#fcc42d");
      assert.equal(look.bg, "rgb(7, 11, 22)");
      assert.doesNotMatch(look.mark, /57, 132, 255/, "el logo no sale azul de fábrica");
    } finally { await b.close(); }
  });
});
