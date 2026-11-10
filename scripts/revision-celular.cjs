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
const panelViews = process.env.VIEWS ? process.env.VIEWS.split(",") : ["inicio", "vender", "control", "renovar", "dashboard", "finanzas", "notificaciones", "reubicar", "aprobacion", "recordatorios", "codigos", "cuentas", "carga", "productos", "cupones", "revendedores", "proveedores", "clientes", "excel", "whatsapp", "apariencia", "usuarios", "auditoria", "configuracion", "ayuda"];
const widths = process.env.WIDTHS ? process.env.WIDTHS.split(",").map(Number) : [360, 390, 768];
const themes = process.env.THEMES ? process.env.THEMES.split(",") : ["light", "dark"];

async function check(page) {
  return page.evaluate(() => {
    const vw = document.documentElement.clientWidth;
    const r = { docW: document.documentElement.scrollWidth, vw, over: [], small: [], tiny: [], cut: [], card: [] };
    const label = (el) => (el.tagName + "." + [...el.classList].join(".")).slice(0, 50);
    // Tamaño real en pantalla: en SVG el font-size está en unidades del dibujo y se escala con el viewBox.
    const realPx = (el, s) => {
      const fs = parseFloat(s.fontSize);
      const svg = el.ownerSVGElement;
      if (!svg || !svg.viewBox || !svg.viewBox.baseVal || !svg.viewBox.baseVal.width) return fs;
      return fs * (svg.getBoundingClientRect().width / svg.viewBox.baseVal.width);
    };
    for (const el of document.querySelectorAll("body *")) {
      const s = getComputedStyle(el);
      if (s.display === "none" || s.visibility === "hidden") continue;
      const b = el.getBoundingClientRect();
      if (!b.width || !b.height) continue;
      // Dentro de un desplegable cerrado no se ve (el navegador lo ubica igual): no cuenta.
      const shut = el.closest("details:not([open])");
      if (shut && !el.closest("summary")) continue;
      // Se sale del ancho y ningún padre lo recorta.
      if (b.right > vw + 1) {
        let p = el.parentElement, clip = false;
        while (p) { const ps = getComputedStyle(p); if (/(auto|scroll|hidden)/.test(ps.overflowX) && p !== document.body && p !== document.documentElement) { clip = true; break; } p = p.parentElement; }
        if (!clip) r.over.push(label(el) + " →" + Math.round(b.right));
      }
      // Texto cortado: el contenido no entra y el elemento lo recorta (los "aparec…").
      const ownText = [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      // También cuenta el texto que "se derrama" fuera de su botón/caja (overflow visible): igual se ve cortado.
      if (ownText && !(el instanceof SVGElement) && el.scrollWidth > el.clientWidth + 2 && !/(auto|scroll)/.test(s.overflowX) && s.display !== "inline" && !el.closest('[aria-hidden="true"]') && !el.matches("input,select,textarea,option")) r.cut.push(label(el) + ' "' + el.textContent.trim().slice(0, 24) + '"');
      // Ilustraciones decorativas (aria-hidden): no cuentan para tamaño de letra/botón.
      const deco = !!el.closest('[aria-hidden="true"]');
      // Botón/enlace táctil demasiado bajo.
      // Enlace dentro de una frase: WCAG 2.5.8 lo exceptúa del tamaño mínimo (es parte del texto).
      const inlineLink = el.tagName === "A" && s.display === "inline" && el.parentElement && [...el.parentElement.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim());
      const boxInLabel = el.matches("input[type=checkbox],input[type=radio]") && el.closest("label") && el.closest("label").getBoundingClientRect().height >= 40;
      if (!deco && !boxInLabel && !inlineLink && el.matches("button,a,input,select,[role=button]") && b.height < 36 && b.width > 0 && b.top < 20000) r.small.push(label(el) + ' "' + (el.innerText || el.value || el.getAttribute("aria-label") || "").trim().slice(0, 18) + '" ' + Math.round(b.width) + "x" + Math.round(b.height));
      // Texto propio menor a 12 px.
      if (!deco && el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && realPx(el, s) < 12) r.tiny.push(label(el) + " " + Math.round(realPx(el, s) * 10) / 10 + "px" + ' "' + el.textContent.trim().slice(0, 20) + '"');
    }
    // Se sale del área interna de su tarjeta (lo de "Proyección del mes" pegado al borde).
    for (const card of document.querySelectorAll(".card,.sbox,.svc")) {
      const cb = card.getBoundingClientRect();
      if (!cb.width) continue;
      const cs = getComputedStyle(card);
      // Ojo: aunque la tarjeta tenga scroll interno, lo que no entra queda escondido detrás de ese scroll:
      // también cuenta. Solo se exceptúa lo que está dentro de un contenedor con scroll propio (tablas).
      const innerR = cb.right - parseFloat(cs.paddingRight) - parseFloat(cs.borderRightWidth);
      for (const el of card.querySelectorAll("*")) {
        const s2 = getComputedStyle(el);
        if (s2.display === "none" || s2.visibility === "hidden" || s2.position === "absolute" || s2.position === "fixed") continue;
        if (el.closest("details:not([open])") && !el.closest("summary")) continue;
        if (el.closest('[aria-hidden="true"]')) continue;
        let p = el.parentElement, clip = false;
        while (p && p !== card) { if (/(auto|scroll|hidden)/.test(getComputedStyle(p).overflowX)) { clip = true; break; } p = p.parentElement; }
        if (clip) continue;
        const rb = el.getBoundingClientRect();
        if (rb.width && rb.right > innerR + 2) r.card.push(label(el) + " +" + Math.round(rb.right - innerR) + "px");
      }
    }
    r.card = [...new Set(r.card)].slice(0, 8);
    r.over = [...new Set(r.over)].slice(0, 10);
    r.small = [...new Set(r.small)].slice(0, 12);
    r.tiny = [...new Set(r.tiny)].slice(0, 10);
    r.cut = [...new Set(r.cut)].slice(0, 10);
    return r;
  });
}

(async () => {
  const br = await chromium.launch({ args: ["--no-sandbox"] });
  const res = [];
  let r0 = "";
  for (const w of widths) {
    for (const theme of themes) {
      const ctx = await br.newContext({ viewport: { width: w, height: w < 700 ? 800 : 900 }, hasTouch: w < 700, isMobile: w < 700, colorScheme: theme });
      await ctx.addInitScript((t) => { try { localStorage.setItem("gs-panel-theme", t); } catch (e) { /* */ } }, theme);
      const page = await ctx.newPage();
      // Tienda
      for (const v of shopViews) {
        await page.goto(B + "/tienda/#" + v).catch(() => {});
        await page.reload().catch(() => {});
        await page.waitForTimeout(900);
        const r = await check(page);
        res.push({ w, theme, where: "tienda", v, ...r });
        if (w === 390) await page.screenshot({ path: `${OUT}/tienda-${v}-${theme}.png`, fullPage: true }).catch(() => {});
      }
      // Portada de la plataforma (GaboHub)
      for (const v of ["inicio", "tiendas"]) {
        await page.goto(B + "/#" + v).catch(() => {});
        await page.reload().catch(() => {});
        await page.waitForTimeout(900);
        const r = await check(page);
        res.push({ w, theme, where: "hub", v, ...r });
        if (w === 390) await page.screenshot({ path: `${OUT}/hub-${v}-${theme}.png`, fullPage: true }).catch(() => {});
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
        // Cambiar solo el #hash no recarga: el panel lee la vista al arrancar, así que recargamos.
        await page.reload().catch(() => {});
        await page.waitForSelector("#app:not([hidden])", { timeout: 8000 }).catch(() => {});
        await page.waitForTimeout(900);
        // Verificación: el título debe corresponder a la vista pedida (si no, la medición no vale).
        r0 = await page.evaluate(() => location.hash.slice(1));
        const r = await check(page);
        res.push({ w, theme, where: "panel", v, landed: r0, ...r });
        if (r0 !== v) console.log("OJO: pedí", v, "y quedó en", r0);
        if (w === 390) await page.screenshot({ path: `${OUT}/panel-${v}-${theme}.png`, fullPage: true }).catch(() => {});
      }
      await ctx.close();
    }
  }
  await br.close();
  fs.writeFileSync(OUT + "/scan.json", JSON.stringify(res, null, 1));
  // Resumen: solo lo que tiene problemas.
  let totOver = 0, totSmall = 0, totTiny = 0, totCut = 0, totCard = 0;
  for (const r of res) {
    totOver += r.over.length; totSmall += r.small.length; totTiny += r.tiny.length; totCut += r.cut.length; totCard += r.card.length;
    if (r.over.length || r.small.length || r.tiny.length || r.cut.length || r.card.length) console.log(r.w, r.theme, r.where, r.v, "| over", r.over.length, "small", r.small.length, "tiny", r.tiny.length, "cut", r.cut.length, "card", r.card.length);
  }
  console.log(`\nTOTAL desbordes=${totOver} botones-chicos=${totSmall} textos-chicos=${totTiny} textos-cortados=${totCut} fuera-de-tarjeta=${totCard}`);
})();
