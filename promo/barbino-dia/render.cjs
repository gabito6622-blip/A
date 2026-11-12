// Captura dia.html cuadro a cuadro (30 fps) con Playwright y arma el MP4 con ffmpeg.
//   node render.cjs <carpeta-de-cuadros> [--stills 0,4.5,9]   (stills: solo esos segundos, para revisar)
// Después: ver README.md (comando ffmpeg).
const { chromium } = require("playwright");
const path = require("path");
const fs = require("fs");

const out = process.argv[2] || "frames";
const stillsArg = process.argv.indexOf("--stills");
const FPS = 30, WORKERS = 4;
fs.mkdirSync(out, { recursive: true });
const url = "file://" + path.join(__dirname, "dia.html");

(async () => {
  const browser = await chromium.launch();
  const open = async () => {
    const page = await browser.newPage({ viewport: { width: 1080, height: 1920 }, deviceScaleFactor: 1 });
    page.on("console", (m) => m.type() === "error" && console.log("console:", m.text()));
    await page.goto(url);
    await page.evaluate(() => window.READY);
    return page;
  };
  if (stillsArg > 0) {
    const page = await open();
    for (const s of process.argv[stillsArg + 1].split(",").map(Number)) {
      await page.evaluate((t) => window.seek(t), s);
      await page.screenshot({ path: path.join(out, `still-${s.toFixed(2)}.png`) });
    }
    await browser.close();
    return;
  }
  const first = await open();
  const total = Math.round((await first.evaluate(() => window.DURATION)) * FPS);
  const pages = [first, ...(await Promise.all(Array.from({ length: WORKERS - 1 }, open)))];
  let next = 0, done = 0;
  const t0 = Date.now();
  await Promise.all(pages.map(async (page) => {
    for (;;) {
      const f = next++;
      if (f >= total) break;
      const file = path.join(out, `f${String(f).padStart(5, "0")}.png`);
      if (fs.existsSync(file) && fs.statSync(file).size > 0) { done++; continue; }   // retoma un render cortado
      await page.evaluate((t) => window.seek(t), f / FPS);
      await page.screenshot({ path: file });
      if (++done % 100 === 0) console.log(`${done}/${total} · ${((Date.now() - t0) / 1000).toFixed(0)} s`);
    }
  }));
  console.log(`listo: ${total} cuadros`);
  await browser.close();
})();
