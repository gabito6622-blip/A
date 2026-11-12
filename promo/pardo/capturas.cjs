// Capturas del video de Pardo Barber Club desde la copia LOCAL de Barbiño (datos de ejemplo).
// Antes: seed-pardo.mjs + vestir/cargar.py y la app corriendo en http://localhost:3000 (ver README).
// Uso: node promo/pardo/capturas.cjs   → promo/pardo/assets/*.jpg (celular 390 px ×3)
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const B = process.env.BASE || "http://localhost:3000";
const OUT = path.join(__dirname, "assets");
fs.mkdirSync(OUT, { recursive: true });

(async () => {
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 3, colorScheme: "dark", locale: "es-BO" });
  const p = await ctx.newPage();
  // baja despacio para que carguen las fotos (se cargan al aparecer) y vuelve arriba
  const warm = async () => {
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    for (let y = 0; y < h; y += 500) { await p.evaluate((y) => window.scrollTo(0, y), y); await p.waitForTimeout(120); }
    await p.evaluate(() => window.scrollTo(0, 0)); await p.waitForTimeout(500);
    await p.evaluate(() => Promise.all([...document.images].map((i) => (i.complete ? 0 : new Promise((r) => { i.onload = i.onerror = r; })))));
  };
  // dónde toca el dedo en cada paso (px CSS de la captura, para el video)
  const taps = {};
  const tapAt = async (name, locator) => {
    await p.evaluate(() => window.scrollTo(0, 0));
    const bx = await locator.boundingBox();
    const sy = await p.evaluate(() => window.scrollY);
    taps[name] = { x: Math.round(bx.x + bx.width / 2), y: Math.round(bx.y + sy + bx.height / 2) };
  };
  const shot = async (name, maxH) => {
    await warm();
    const h = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.screenshot({ path: path.join(OUT, name + ".jpg"), type: "jpeg", quality: 88, fullPage: true, clip: { x: 0, y: 0, width: 390, height: Math.min(h, maxH ?? h) } });
    console.log(name, Math.min(h, maxH ?? h));
  };

  await p.goto(B + "/pardo"); await p.waitForTimeout(1200);
  await shot("pagina", 4200);
  const camilo = await p.evaluate(() => [...document.querySelectorAll('a[href*="/pardo/barbero/"]')][0]?.getAttribute("href"));
  // reserva paso a paso
  await p.goto(B + "/pardo/reservar"); await p.waitForTimeout(1200);
  await shot("paso1-servicio");
  await tapAt("paso1-servicio", p.getByText("Degradado (fade)").first());
  await p.getByText("Degradado (fade)").first().click(); await p.waitForTimeout(1200);
  await shot("paso2-barbero");
  await tapAt("paso2-barbero", p.getByText("Camilo").first());
  await p.getByText("Camilo").first().click(); await p.waitForTimeout(1200);
  await p.getByText("VIE", { exact: false }).first().click(); await p.waitForTimeout(1200);
  await shot("paso3-hora");
  // primer horario libre desde las 12:00 (cada corrida reserva uno, así que va cambiando)
  const hora = await p.evaluate(() => [...document.querySelectorAll("main a")].map((a) => a.innerText.trim()).find((t) => /^\d\d:\d\d$/.test(t) && t >= "12:00"));
  taps.hora = hora;
  await tapAt("paso3-hora", p.getByRole("link", { name: hora, exact: true }).first());
  await p.getByRole("link", { name: hora, exact: true }).first().click(); await p.waitForTimeout(1200);
  await p.fill('input[name="name"]', "Martín Rojas");
  await p.fill('input[name="phone"], input[placeholder="7xxxxxxx"]', "71234567");
  await p.check('input[name="accept"]');
  await shot("paso4-datos");
  await tapAt("paso4-datos", p.getByRole("button", { name: "Confirmar reserva" }));
  await p.getByRole("button", { name: "Confirmar reserva" }).click();
  await p.waitForURL(/\/pardo\/reserva\//, { timeout: 15000 }); await p.waitForTimeout(1500);
  await shot("reserva", 3600);
  if (camilo) { await p.goto(B + camilo); await p.waitForTimeout(1200); await shot("barbero-camilo", 3000); }
  fs.writeFileSync(path.join(OUT, "taps.json"), JSON.stringify(taps, null, 1));
  fs.writeFileSync(path.join(OUT, "taps.js"), "window.TAPS = " + JSON.stringify(taps) + ";\n");   // lo lee pardo.html
  console.log("toques", JSON.stringify(taps));
  await br.close();
})();
