// Saca la tienda de la revendedora de ejemplo en cada uno de los 17 estilos listos de GaboHub (los de public/common.js).
// Por estilo: arriba (portada) y el catálogo. Celular 390 px ×2. Tienda de prueba en BASE (por defecto :8091).
// Uso: node promo/gabohub-estilos/capturas-estilos.cjs
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const B = process.env.BASE || "http://localhost:8091";
const sinPrecios = require("./sin-precios.cjs");   // el video no muestra precios ni stock
const OUT = path.join(__dirname, "assets/estilos");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const { THEMES } = await import(path.join(__dirname, "../../public/common.js"));
  const br = await chromium.launch();
  const ar = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark", locale: "es-BO" });
  const r = await ar.request.post(B + "/api/auth/customer/pin", { data: { phone: "+59171234567", pin: "2468" }, headers: { origin: B } });
  if (!r.ok()) throw new Error("login " + r.status());
  const before = await (await ar.request.get(B + "/api/me/shop")).json();
  const pub = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, colorScheme: "dark", locale: "es-BO" });
  const list = [];
  for (const t of THEMES) {
    const u = await ar.request.put(B + "/api/me/shop", { data: { ...t.look }, headers: { origin: B } });
    if (!u.ok()) throw new Error(t.id + " " + u.status() + " " + (await u.text()));
    const p = await pub.newPage();
    await p.goto(B + "/r/ariana-streaming"); await p.waitForTimeout(1400);
    await p.evaluate(() => document.fonts.ready);
    // carga las imágenes de abajo y vuelve arriba
    for (let y = 0; y < 3000; y += 600) { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(80); }
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(500);
    await p.evaluate(sinPrecios);
    await p.screenshot({ path: path.join(OUT, `${t.id}-arriba.jpg`), type: "jpeg", quality: 86 });
    const y = await p.evaluate(() => { const h = [...document.querySelectorAll("h2")].find((e) => /catálogo/i.test(e.textContent)); return h ? h.getBoundingClientRect().top + window.scrollY - 30 : 1100; });
    await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(600);
    await p.screenshot({ path: path.join(OUT, `${t.id}-catalogo.jpg`), type: "jpeg", quality: 86 });
    list.push({ id: t.id, name: t.name.replace(/\s*[✨⭐]/u, "").trim(), bg: t.look.backgroundColor, a1: t.look.accentColor, a2: t.look.accent2Color });
    console.log(t.name);
    await p.close();
  }
  // vuelve la tienda a como estaba
  const keep = ["cardStyle", "bgStyle", "accentColor", "accent2Color", "backgroundColor", "headingFont", "fontFamily", "corners", "layout"];
  await ar.request.put(B + "/api/me/shop", { data: Object.fromEntries(keep.filter((k) => before[k] !== undefined).map((k) => [k, before[k]])), headers: { origin: B } });
  fs.writeFileSync(path.join(OUT, "estilos.js"), "window.ESTILOS = " + JSON.stringify(list) + ";\n");
  await br.close();
})();
