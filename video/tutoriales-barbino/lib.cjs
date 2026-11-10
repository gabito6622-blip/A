// Captura de tutoriales de Barbiño: cada paso = una captura del celular + (opcional) recuadro de dónde tocar + narración.
// Uso: node lib.cjs <id>   (lee ./tutoriales/<id>.cjs y escribe ./out/<id>/steps.json + PNGs)
const { chromium } = require("playwright");
const fs = require("node:fs");
const path = require("node:path");

const B = process.env.BARBINO_URL || "http://localhost:3000";
const SHOP = "imperio";
const USER = { email: "andres@imperio.test", password: "DemoBarber2026!" };

async function clean(page, keepBanners = false) {
  await page.evaluate((keepBanners) => {
    for (const e of document.querySelectorAll("body *")) {
      const h = e.getBoundingClientRect().height;
      if (!keepBanners && e.children.length < 6 && /Sin PIN de gerencia|Todavía no cargaste el WhatsApp/.test(e.textContent) && h < 130 && h > 20 && !e.closest("[data-keep]")) e.style.display = "none";
    }
    // Nunca mostrar direcciones web: se desenfoca cualquier texto o campo que tenga una.
    const re = /localhost|127\.0\.0\.1|https?:\/\//i;
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) if (re.test(n.textContent) && n.parentElement) n.parentElement.style.filter = "blur(7px)";
    for (const i of document.querySelectorAll("input,textarea")) if (re.test(i.value)) i.style.filter = "blur(7px)";
  }, keepBanners);
}

async function run(id) {
  const def = require(path.resolve(__dirname, "tutoriales", id + ".cjs"));
  const out = path.join(__dirname, "out", id);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const br = await chromium.launch();
  const ctx = await br.newContext({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, colorScheme: "dark", locale: "es-BO", timezoneId: "America/La_Paz" });
  const page = await ctx.newPage();
  const steps = [];
  const T = {
    B, SHOP, page,
    url: (p) => B + "/" + SHOP + p,
    async go(p, opts = {}) {
      await page.goto(p.startsWith("http") ? p : B + p, { waitUntil: "networkidle" }).catch(() => {});
      await page.waitForTimeout(opts.wait ?? 700);
    },
    async login(email = USER.email, password = USER.password) {
      await T.go("/login");
      await page.fill("input[type=email],input[name=email]", email);
      await page.fill("input[type=password]", password);
      await page.click("button[type=submit]");
      await page.waitForTimeout(3000);
    },
    async logout() { await ctx.clearCookies(); },
    // Un paso del tutorial. hl: locator (o función que lo devuelve) del elemento a señalar.
    async step({ title, text, hl, scrollY, wait = 400, long, keepBanners = false }) {
      await page.waitForTimeout(wait);
      await clean(page, keepBanners);
      let box = null;
      const loc = typeof hl === "function" ? hl() : hl;
      if (loc) {
        const el = loc.first();
        await el.scrollIntoViewIfNeeded().catch(() => {});
        await page.waitForTimeout(250);
        if (scrollY !== undefined) await page.evaluate((y) => scrollBy(0, y), scrollY);
        await page.waitForTimeout(150);
        box = await el.boundingBox().catch(() => null);
      } else if (scrollY !== undefined) {
        await page.evaluate((y) => scrollTo(0, y), scrollY);
        await page.waitForTimeout(250);
      }
      await clean(page, keepBanners);
      const n = String(steps.length + 1).padStart(2, "0");
      const img = `step${n}.png`;
      if (long) {
        // captura larga para mostrar "deslizando" la pantalla
        await page.evaluate(() => scrollTo(0, 0));
        await page.screenshot({ path: path.join(out, img), fullPage: true, clip: { x: 0, y: 0, width: 390, height: long } });
      } else await page.screenshot({ path: path.join(out, img) });
      steps.push({ img, title, text, hl: box ? { x: box.x, y: box.y, w: box.width, h: box.height } : null, long: long || null });
      console.log(n, title, box ? "●" : "");
    },
    async tap(loc, wait = 900) { await loc.first().click(); await page.waitForTimeout(wait); },
    async fill(loc, value) { await loc.first().fill(value); },
    text: (t, exact = false) => page.getByText(t, { exact }),
    role: (r, name) => page.getByRole(r, { name }),
    label: (l) => page.getByLabel(l),
  };
  try {
    await def.capture(T);
  } catch (e) {
    console.error("ERROR:", e.message.split("\n")[0]);
    await page.screenshot({ path: path.join(out, "_error.png") });
    process.exitCode = 1;
  }
  fs.writeFileSync(path.join(out, "steps.json"), JSON.stringify({ id, title: def.title, number: def.number, learn: def.learn, steps }, null, 1));
  const chars = steps.reduce((a, s) => a + s.text.length, 0);
  console.log(`pasos=${steps.length} caracteres=${chars}`);
  await br.close();
}

if (require.main === module) run(process.argv[2]);
module.exports = { run };
