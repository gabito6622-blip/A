// Revisión de celular: recorre tienda y panel a varios anchos, en claro y oscuro.
// Marca lo que se sale del ancho, botones < 36 px y textos < 12 px. Deja capturas + scan.json.
// Uso: levantá la tienda en el puerto 8090 con datos de ejemplo y corré:
//   node scripts/revision-celular.cjs <carpeta-de-salida>
// No usa dependencias del proyecto: Playwright ya viene en el entorno.
const { chromium } = require("playwright");
const fs = require("node:fs");

const B = process.env.BASE || "http://localhost:8090";
const OUT = process.argv[2] || ".";
const USER = process.env.GS_USER || "gabriel";
const PASS = process.env.GS_PASS || "demo-gabriel-2026";
const shopViews = ["inicio", "catalogo", "combo", "asesor", "cuentas", "recargas"];
const panelViews = ["inicio", "vender", "control", "renovar", "dashboard", "finanzas", "notificaciones", "reubicar", "aprobacion", "recordatorios", "codigos", "cuentas", "carga", "productos", "revendedores", "proveedores", "clientes", "excel", "whatsapp", "apariencia", "usuarios", "auditoria", "configuracion", "ayuda"];
const widths = [360, 390, 768];
const themes = ["light", "dark"];

async function check(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const r = { docW: document.documentElement.scrollWidth, vw, over: [], small: [], tiny: [] };
    const label = (el) => (el.tagName + "." + [...el.classList].join(".")).slice(0, 50);
    for (const el of document.querySelectorAll("body *")) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      // Se sale del ancho y ningún padre lo recorta.
      if (b.right > vw + 1) {
        let p = el.parentElement, clip = false;
        while (p) { const ps = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(ps.overflowX) && p !== document.body && p !== document.documentElement) { clip = true; break; } p = p.parentElement; }
        if (!clip) r.over.push(label(el) + " →" + Math.round(b.right));
      }
      // Botón/enlace táctil demasiado bajo.
      if (el.matches("button,a,input,select,[role=button]") && b.height < 36 && b.width > 0 && b.top < 20000) r.small.push(label(el) + ' "' + (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 18) + '" ' + Math.round(b.width) + "x" + Math.round(b.height));
      // Texto propio menor a 12 px.
      if (el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(s.fontSize) < 12) r.tiny.push(label(el) + " " + s.fontSize + ' "' + el.textContent.trim().slice(0, 20) + '"');
    }
    r.over = [...new Set(r.over)].slice(0, 10);
    r.small = [...new Set(r.small)].slice(0, 12);
    r.tiny = [...new Set(r.tiny)].slice(0, 10);
    return r;
  });
}

(async () => {
  const br = await chromium.launch({ args: ["--no-sandbox"] });
  const res = [];
  for (const w of widths) {
    for (const theme of themes) {
      const ctx = await br.newContext({ viewport: { width: w, height: w < 700 ? 800 : 900 }, hasTouch: w < 700, isMobile: w < 700, colorScheme: theme });
      await ctx.addInitScript((t) => { try { localStorage.setItem("gs-panel-theme", t); } catch (e) { /* */ } }, theme);
      const page = await ctx.newPage();
      // Tienda
      for (const v of shopViews) {
        await page.goto(B + "/tienda/#" + v).catch(() => {});
        await page.waitForTimeout(700);
        const r = await check(page);
        res.push({ w, theme, where: "tienda", v, ...r });
        if (w === 390) await page.screenshot({ path: `${OUT}/tienda-${v}-${theme}.png`, fullPage: true }).catch(() => {});
      }
      // Panel: login por el formulario.
      await page.goto(B + "/panel.html").catch(() => {});
      await page.waitForTimeout(500);
      try {
        await page.fill("#loginForm [name=username]", USER);
        await page.fill("#loginForm [name=password]", PASS);
        await page.click("#loginForm button[type=submit]");
        await page.waitForSelector("#app:not([hidden])", { timeout: 8000 });
      } catch (e) { /* ya logueado o sin login */ }
      for (const v of panelViews) {
        await page.goto(B + "/panel.html#" + v).catch(() => {});
        await page.waitForTimeout(800);
        const r = await check(page);
        res.push({ w, theme, where: "panel", v, ...r });
        if (w === 390) await page.screenshot({ path: `${OUT}/panel-${v}-${theme}.png`, fullPage: true }).catch(() => {});
      }
      await ctx.close();
    }
  }
  await br.close();
  fs.writeFileSync(OUT + "/scan.json", JSON.stringify(res, null, 1));
  // Resumen: solo lo que tiene problemas.
  let totOver = 0, totSmall = 0, totTiny = 0;
  for (const r of res) {
    totOver += r.over.length; totSmall += r.small.length; totTiny += r.tiny.length;
    if (r.over.length || r.small.length > 3 || r.tiny.length) console.log(r.w, r.theme, r.where, r.v, "| over", r.over.length, "small", r.small.length, "tiny", r.tiny.length);
  }
  console.log(`\nTOTAL cortes=${totOver} botones-chicos=${totSmall} textos-chicos=${totTiny}`);
})();
