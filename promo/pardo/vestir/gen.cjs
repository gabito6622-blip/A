// Imágenes de ejemplo para «Pardo Barber Club» en Barbiño: logo, portada, fotos de servicios y de barberos.
// Todo es diseño propio (ilustración en verde y dorado), no fotos reales. Salen en PNG y después se pasan a WEBP.
// Uso: node promo/pardo/vestir/gen.cjs <carpeta-de-salida>
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");
const out = process.argv[2] || path.join(__dirname, "png");
fs.mkdirSync(out, { recursive: true });

const G = "#1F5F4F", G2 = "#0f3a30", GOLD = "#C9A15A", GOLD2 = "#e9cf94", INK = "#0b1411";
const page = (body, w, h) => `<!doctype html><html><head><meta charset="utf-8"><style>
  @font-face{font-family:"Playfair";src:url(file://${path.resolve(__dirname, "../../barbino-dia/fonts/PlayfairDisplay.woff2")}) format("woff2");font-weight:400 900}
  @font-face{font-family:"Playfair";font-style:italic;src:url(file://${path.resolve(__dirname, "../../barbino-dia/fonts/PlayfairDisplay-Italic.woff2")}) format("woff2");font-weight:400 900}
  *{margin:0;box-sizing:border-box} html,body{width:${w}px;height:${h}px;overflow:hidden;background:transparent;font-family:"Inter Display","Inter",sans-serif}
  .bg{position:absolute;inset:0;background:radial-gradient(120% 90% at 30% 15%, #2a7a66 0%, ${G} 38%, ${G2} 75%, ${INK} 100%)}
  .pin{position:absolute;inset:0;background:repeating-linear-gradient(90deg, rgba(201,161,90,.07) 0 2px, transparent 2px 46px)}
  .serif{font-family:"Playfair",serif}
</style></head><body>${body}</body></html>`;

// Íconos de línea propios (trazo dorado, grilla de 64)
const ICON = {
  tijera: '<circle cx="18" cy="46" r="8"/><circle cx="46" cy="46" r="8"/><path d="M23 40 48 8M41 40 16 8"/><circle cx="32" cy="27" r="1.6" fill="currentColor"/>',
  maquina: '<rect x="20" y="16" width="24" height="40" rx="7"/><path d="M18 16h28M20 10h24v6H20zM24 10V6M30 10V6M34 10V6M40 10V6M28 30h8M28 38h8"/>',
  combo: '<circle cx="14" cy="50" r="6"/><circle cx="34" cy="50" r="6"/><path d="M18 45 36 20M30 45 12 20"/><path d="M44 54 58 12l4 2-12 42z"/><path d="M44 54h8"/>',
  navaja: '<path d="M8 40 40 12c4-3 10 2 7 6L22 46z"/><path d="M22 46l8 8c2 2 5 2 7 0l17-17"/><path d="M15 34l9 9"/>',
  lineas: '<path d="M10 14h44M10 26h30M10 38h40M10 50h22"/><path d="M46 46l10-10 4 4-10 10-6 2z"/>',
  cejas: '<path d="M8 30c10-12 26-14 40-6"/><path d="M14 42c8-6 18-6 26 0"/><path d="M48 18l8-6M52 26l8-2"/>',
};
const icon = (k, size) => `<svg viewBox="0 0 64 64" width="${size}" height="${size}" fill="none" stroke="${GOLD2}" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round" style="color:${GOLD2};filter:drop-shadow(0 6px 18px rgba(0,0,0,.4))">${ICON[k]}</svg>`;

const SERVICES = [["corte-clasico", "tijera", "Corte clásico"], ["degradado", "maquina", "Degradado"], ["corte-barba", "combo", "Corte + barba"],
  ["perfilado", "navaja", "Perfilado de barba"], ["diseno", "lineas", "Diseño / líneas"], ["cejas", "cejas", "Cejas"]];
// Barberos: monograma con la herramienta de su especialidad (ilustración, no foto)
const BARBERS = { Camilo: "maquina", Diego: "navaja", Mateo: "tijera", Luis: "lineas" };
const barber = (name) => `<div class="bg"></div><div class="pin"></div>
  <div style="position:absolute;inset:70px;border-radius:50%;box-shadow:inset 0 0 0 6px ${GOLD}, inset 0 0 0 12px ${G2}, inset 0 0 0 14px ${GOLD2}"></div>
  <div class="serif" style="position:absolute;inset:0;display:grid;place-items:center;color:${GOLD2};font-size:380px;font-weight:900;font-style:italic;margin-top:-60px">${name[0]}</div>
  <div style="position:absolute;left:0;right:0;bottom:150px;display:grid;place-items:center;opacity:.95">${icon(BARBERS[name], 130)}</div>`;

const ITEMS = {
  "logo": [`<div style="position:absolute;inset:16px;border-radius:50%;background:radial-gradient(circle at 35% 30%, #2a7a66, ${G} 45%, ${G2});box-shadow:inset 0 0 0 10px ${GOLD}, inset 0 0 0 16px ${G2}, inset 0 0 0 19px ${GOLD2}"></div>
     <div class="serif" style="position:absolute;inset:0;display:grid;place-items:center;color:${GOLD2};font-size:300px;font-weight:900;font-style:italic;margin-top:-18px">P</div>
     <div style="position:absolute;left:0;right:0;top:372px;text-align:center;color:${GOLD2};font-size:34px;font-weight:800;letter-spacing:.32em">BARBER CLUB</div>`, 512, 512, true],
  // Portada sin texto: la página ya pone el nombre encima
  "portada": [`<div class="bg"></div><div class="pin"></div>
     <div style="position:absolute;right:-60px;top:60px;opacity:.55;transform:rotate(-12deg)">${icon("tijera", 760)}</div>
     <div style="position:absolute;left:-80px;bottom:-120px;opacity:.25;transform:rotate(18deg)">${icon("navaja", 620)}</div>`, 1600, 900],
  ...Object.fromEntries(SERVICES.map(([id, ic, name]) => [`servicio-${id}`, [`<div class="bg"></div><div class="pin"></div>
     <div style="position:absolute;left:0;right:0;top:120px;display:grid;place-items:center">${icon(ic, 440)}</div>
     <div class="serif" style="position:absolute;left:70px;bottom:70px;color:#f5ecd8;font-size:84px;font-weight:900">${name}</div>
     <div style="position:absolute;left:74px;bottom:170px;color:${GOLD2};font-size:30px;font-weight:800;letter-spacing:.3em">PARDO BARBER CLUB</div>`, 1200, 900]])),
  ...Object.fromEntries(Object.keys(BARBERS).map((n) => [`barbero-${n.toLowerCase()}`, [barber(n), 800, 800]])),
};

(async () => {
  const br = await chromium.launch();
  const p = await br.newPage();
  for (const [name, [body, w, h, transparent]] of Object.entries(ITEMS)) {
    await p.setViewportSize({ width: w, height: h });
    await p.setContent(page(body, w, h));
    await p.evaluate(() => document.fonts.ready);
    await p.screenshot({ path: path.join(out, name + ".png"), omitBackground: !!transparent });
  }
  await br.close();
  console.log("listo", Object.keys(ITEMS).length, "imágenes en", out);
})();
