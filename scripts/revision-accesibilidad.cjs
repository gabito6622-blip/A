// Revisión automática de accesibilidad con axe-core (reglas WCAG 2.0/2.1/2.2 A y AA).
// Recorre tienda, portada, páginas legales y todo el panel a 375, 768 y 1440 px, en claro y oscuro.
//
// axe-core NO es dependencia del proyecto: se baja aparte, una vez:
//   npm pack axe-core@4.10.2 && tar xzf axe-core-4.10.2.tgz      (deja package/axe.min.js)
// Uso (con la tienda de ejemplo en el puerto 8090):
//   AXE_JS=package/axe.min.js node scripts/revision-accesibilidad.cjs <carpeta-de-salida>
// Variables: BASE, WIDTHS (375,768,1440), THEMES (light,dark), VIEWS (vistas del panel), GS_USER/GS_PASS.
// Deja axe.json con todo y muestra un resumen por regla. Playwright ya viene en el entorno.
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const B = process.env.BASE || "http://localhost:8090";
const OUT = process.argv[2] || ".";
const AXE = process.env.AXE_JS || "package/axe.min.js";
if (!fs.existsSync(AXE)) { console.error(`No encuentro axe-core en ${AXE}. Bajalo con: npm pack axe-core@4.10.2 && tar xzf axe-core-4.10.2.tgz`); process.exit(2); }
const axeSrc = fs.readFileSync(AXE, "utf8");
const USER = process.env.GS_USER || "gabriel";
const PASS = process.env.GS_PASS || "demo-gabriel-2026";
const widths = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [375, 768, 1440];
const themes = process.env.THEMES ? process.env.THEMES.split(",") : ["light", "dark"];
const panelViews = process.env.VIEWS ? process.env.VIEWS.split(",") : ["inicio", "vender", "control", "renovar", "dashboard", "finanzas", "notificaciones", "reubicar", "aprobacion", "recordatorios", "codigos", "cuentas", "carga", "productos", "cupones", "revendedores", "proveedores", "clientes", "excel", "whatsapp", "apariencia", "usuarios", "auditoria", "configuracion", "ayuda"];
const publicPages = [["tienda", "/tienda/#inicio"], ["tienda-catalogo", "/tienda/#catalogo"], ["tienda-combo", "/tienda/#combo"], ["tienda-cuentas", "/tienda/#cuentas"],
  ["hub", "/#inicio"], ["hub-tiendas", "/#tiendas"], ["terminos", "/terminos"], ["privacidad", "/privacidad"], ["recuperar", "/recuperar"], ["panel-login", "/panel.html"]];
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

async function audit(page) {
  await page.evaluate(axeSrc);
  return page.evaluate(async (tags) => {
    const r = await window.axe.run(document, { runOnly: { type: "tag", values: tags }, resultTypes: ["violations"] });
    return r.violations.map((v) => ({ id: v.id, impact: v.impact, help: v.help, nodes: v.nodes.map((n) => ({ target: n.target.join(" "), html: n.html.slice(0, 160), why: (n.any[0] || n.all[0] || n.none[0] || {}).message })) }));
  }, TAGS);
}

(async () => {
  const br = await chromium.launch({ args: ["--no-sandbox"] });
  const res = [];
  const run = async (page, w, theme, where) => {
    await page.waitForTimeout(700);
    const v = await audit(page).catch((e) => [{ id: "ERROR", impact: "critical", help: e.message, nodes: [] }]);
    res.push({ w, theme, where, violations: v });
  };
  for (const w of widths) {
    for (const theme of themes) {
      // bypassCSP: axe se inyecta como script de prueba; la página real sigue con su CSP.
      const ctx = await br.newContext({ viewport: { width: w, height: w < 700 ? 800 : 900 }, hasTouch: w < 700, isMobile: w < 700, colorScheme: theme, bypassCSP: true });
      await ctx.addInitScript((t) => { try { localStorage.setItem("gs-panel-theme", t); } catch (e) { /* */ } }, theme);
      const page = await ctx.newPage();
      for (const [name, url] of publicPages) {
        await page.goto(B + url).catch(() => {});
        await page.reload().catch(() => {});
        await run(page, w, theme, name);
      }
      // Estados con ventanas: carrito abierto con un producto y ventana de acceso.
      await page.goto(B + "/tienda/#catalogo"); await page.reload(); await page.waitForTimeout(800);
      if (await page.$("[data-add]")) { await page.click("[data-add] >> nth=0").catch(() => {}); await page.click("[data-cart] >> nth=0").catch(() => {}); await run(page, w, theme, "tienda-carrito"); }
      await page.goto(B + "/tienda/#cuentas"); await page.reload(); await page.waitForTimeout(800);
      if (await page.$("[data-login]")) { await page.click("[data-login] >> nth=0").catch(() => {}); await run(page, w, theme, "tienda-acceso"); }
      // Panel
      await page.goto(B + "/panel.html");
      try {
        await page.fill("#loginForm [name=username]", USER);
        await page.fill("#loginForm [name=password]", PASS);
        await page.click("#loginForm button[type=submit]");
        await page.waitForSelector("#app:not([hidden])", { timeout: 8000 });
      } catch (e) { /* ya logueado */ }
      for (const v of panelViews) {
        await page.goto(B + "/panel.html#" + v).catch(() => {});
        await page.reload().catch(() => {});
        await page.waitForSelector("#app:not([hidden])", { timeout: 8000 }).catch(() => {});
        // Abrimos las tarjetas plegadas para revisar también lo de adentro.
        await page.waitForTimeout(600);
        await page.evaluate(() => document.querySelectorAll("details").forEach((d) => (d.open = true)));
        await run(page, w, theme, "panel-" + v);
      }
      await ctx.close();
    }
  }
  await br.close();
  fs.mkdirSync(OUT, { recursive: true });
  fs.writeFileSync(path.join(OUT, "axe.json"), JSON.stringify(res, null, 1));
  // Resumen por regla
  const by = {};
  for (const r of res) for (const v of r.violations) {
    const k = v.id; by[k] ??= { impact: v.impact, help: v.help, where: new Set(), nodes: 0, sample: [] };
    by[k].where.add(`${r.where}@${r.w}/${r.theme}`); by[k].nodes += v.nodes.length;
    for (const n of v.nodes) if (by[k].sample.length < 6 && !by[k].sample.some((s) => s.target === n.target)) by[k].sample.push({ ...n, where: r.where });
  }
  const order = { critical: 0, serious: 1, moderate: 2, minor: 3 };
  const rules = Object.entries(by).sort((a, b) => (order[a[1].impact] ?? 9) - (order[b[1].impact] ?? 9));
  for (const [id, x] of rules) {
    console.log(`\n[${x.impact}] ${id}: ${x.help} — ${x.nodes} elemento(s) en ${x.where.size} pantalla(s)`);
    for (const s of x.sample) console.log(`   · ${s.where}: ${s.target} — ${s.why ?? ""}`.slice(0, 260));
  }
  console.log(`\nTOTAL: ${rules.length} regla(s) con fallas, ${rules.reduce((n, [, x]) => n + x.nodes, 0)} elemento(s), ${res.length} pantallas revisadas.`);
})();
