// Captura publicidad.html cuadro a cuadro (30 fps) con Playwright.
//   node render.cjs full|short <carpeta>            -> cuadros f00000.png...
//   node render.cjs full|short <carpeta> --stills 1,2,3
//   node render.cjs cover <carpeta>                 -> portada.png
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");
const [V, out] = [process.argv[2] || "full", process.argv[3] || "frames"];
const si = process.argv.indexOf("--stills");
const FPS = 30, WORKERS = 4;
fs.mkdirSync(out, { recursive: true });
const url = "file://" + path.join(__dirname, "publicidad.html") + "?v=" + V;
(async () => {
  const browser = await chromium.launch();
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 } });
    page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
    page.on("pageerror", (e) => console.log("pageerror:", e.message));
    await page.goto(url); await page.evaluate(() => window.READY); return page;
  };
  if (V === "cover") { const p = await open(); await p.screenshot({ path: path.join(out, "portada.png") }); return browser.close(); }
  if (si > 0) {
    const p = await open();
    for (const s of process.argv[si + 1].split(",").map(Number)) { await p.evaluate((t) => window.seek(t), s); await p.screenshot({ path: path.join(out, `still-${s.toFixed(2)}.png`) }); }
    return browser.close();
  }
  const first = await open();
  const total = Math.round((await first.evaluate(() => window.DURATION)) * FPS);
  const pages = [first, ...(await Promise.all(Array.from({ length: WORKERS - 1 }, open)))];
  let next = 0, done = 0; const t0 = Date.now();
  await Promise.all(pages.map(async (page) => {
    for (;;) { const f = next++; if (f >= total) break;
      await page.evaluate((t) => window.seek(t), f / FPS);
      await page.screenshot({ path: path.join(out, `f${String(f).padStart(5, "0")}.png`) });
      if (++done % 150 === 0) console.log(`${done}/${total} · ${((Date.now() - t0) / 1000).toFixed(0)} s`); }
  }));
  console.log(`listo: ${total} cuadros`); await browser.close();
})();
