// Premium 2.0 · etapa 0 "Base segura" (12/11/2026): tema común cargado en tienda y panel, fuentes que no frenan el
// primer dibujado, Tito (cartero) con hora real (sin redibujar la oficina cada 20 s), y la tienda del cliente a
// 360 px: portada, catálogo, carrito y paso de pago sin desborde, botones de 44 px y letra de 12 px o más.
// Datos ficticios; nunca sale un WhatsApp ni un pago real.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
const DAY = 864e5;

describe("etapa 0 · base segura", () => {
  let dir, app, base, owner, ana, anaCk;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const get = async (p, ck) => (await fetch(base + p, { headers: ck ? { cookie: ck } : {} })).json();

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-base-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    await post("/api/admin/products", { id: "nf", name: "Netflix Premium", kind: "profile", durationDays: 30, price: 4000, published: true }, owner);
    await post("/api/admin/products", { id: "dis", name: "Disney+", kind: "profile", durationDays: 30, price: 3500, published: true }, owner);
    await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, owner);
    for (const [pid, email] of [["nf", "nf1@x.lat"], ["dis", "dis1@x.lat"]]) await post("/api/admin/accounts", { productId: pid, supplierId: "andes", email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [1, 2, 3].map((i) => ({ label: `Perfil ${i}` })) }, owner);
    await post("/api/admin/settings", { storeName: "Gabriel Store", whatsapp: "59170000000", paymentNote: "Banco Demo" }, owner);
    await post("/api/admin/settings/qr", { contentBase64: PNG }, owner);
    ana = await (await post("/api/admin/customers", { name: "Ana Prueba", phone: "+59170011223" }, owner)).json();
    await post(`/api/admin/customers/${ana.id}/login-pin`, { pin: "2468" }, owner);
    anaCk = (await post("/api/auth/customer/pin", { phone: ana.phone, pin: "2468" })).headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("el tema común existe y lo cargan la tienda y el panel; las fuentes de Google no bloquean el primer dibujado", async () => {
    const css = await (await fetch(base + "/tema.css")).text();
    for (const v of ["--gs-blue", "--gs-cyan", "--gs-violet", "--gs-tap:44px", "--gs-text-min:12px", "prefers-reduced-motion"]) assert.ok(css.includes(v), `tema.css sin ${v}`);
    for (const page of ["/tienda/", "/panel.html"]) {
      const html = await (await fetch(base + page)).text();
      assert.ok(html.includes('href="/tema.css"'), `${page} no carga tema.css`);
      const fontLinks = html.match(/<link[^>]+fonts\.googleapis\.com\/css2[^>]*>/g) ?? [];
      assert.ok(fontLinks.length >= 1, `${page}: se espera el link de fuentes`);
      for (const l of fontLinks) assert.ok(/media="print"/.test(l) && /data-font/.test(l), `${page}: la fuente tiene que venir con media="print" (no bloquea) y data-font`);
      assert.ok(!/onload=/.test(html), `${page}: sin manejadores en línea (CSP)`);
    }
    // common.js es el que las activa (sin JS en línea).
    assert.match(readFileSync(resolve("public/common.js"), "utf8"), /link\[data-font\]/);
    // Nadie busca más a Sofi (ya no existe); sí a los 6 de la oficina.
    const panel = readFileSync(resolve("public/panel.js"), "utf8");
    assert.doesNotMatch(panel, /\bsofi\b/i);
    assert.match(panel, /oficina: "[^"]*vico[^"]*"/);
  });

  test("Tito: la hora de su evento es la del último aviso real y no cambia entre lecturas (antes saltaba cada 20 s)", async () => {
    const day = new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz" }).format(new Date());
    // Avisos de HOY sin hora guardada (como los de antes de este cambio): hora fija del día, no "ahora".
    app.db.setSecret("exp_stats", JSON.stringify({ day, sent: 2, customers: 2, links: 0, failed: 0 }), Date.now());
    const tito = async () => (await get("/api/admin/office", owner)).agents.find((a) => a.id === "cartero");
    const a1 = await tito(); await new Promise((r) => setTimeout(r, 30)); const a2 = await tito();
    assert.ok(a1.last && /2 avisos/.test(a1.last.text), "Tito cuenta los avisos de hoy");
    assert.equal(a1.last.at, a2.last.at, "misma hora en dos lecturas seguidas");
    assert.equal(a1.last.at, Date.parse(`${day}T09:00:00-04:00`), "sin hora guardada: las 9 de Bolivia");
    // Con hora guardada (desde ahora la guarda el cartero), se usa esa.
    const at = Date.now() - 3600_000;
    app.db.setSecret("exp_stats", JSON.stringify({ day, sent: 3, customers: 3, links: 0, failed: 0, lastAt: at }), Date.now());
    const a3 = await tito();
    assert.equal(a3.last.at, at);
    assert.ok(Date.now() - a3.last.at > 3000_000, "no es la hora actual");
  });

  test("tienda a 360 px: portada, catálogo, carrito y pago sin desborde, botones de 44 px y letra de 12 px o más", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [n, v] = anaCk.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      // Lo que se mide en cada pantalla. Se excluyen los adornos de la portada (fichas flotantes y mini-logos de los
      // tickets), que no son texto para leer; todo lo demás tiene que tener 12 px o más.
      const measure = (scope) => p.evaluate((sel) => {
        const root = document.querySelector(sel) ?? document.body;
        const vis = (x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(x).visibility !== "hidden"; };
        const deco = (x) => !!x.closest(".pt, .tkgrid, .skeleton");
        return {
          over: document.documentElement.scrollWidth > innerWidth + 1,
          small: [...root.querySelectorAll("button, a.sbtn, .bnav button, input[type=submit]")].filter((x) => vis(x) && !x.closest(".cupx") && x.getBoundingClientRect().height < 44).map((x) => (x.textContent || x.getAttribute("aria-label") || "?").trim().slice(0, 30)),
          tiny: [...root.querySelectorAll("*")].filter((x) => vis(x) && !deco(x) && [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 12).map((x) => x.textContent.trim().slice(0, 30)),
          theme: getComputedStyle(document.documentElement).getPropertyValue("--gs-blue").trim(),
          fontsOn: [...document.querySelectorAll("link[data-font]")].every((l) => l.media === "all"),
        };
      }, scope);
      await p.goto(base + "/tienda/#inicio");
      await p.waitForFunction(() => !document.querySelector("#sout .skeleton"));
      let m = await measure("body");
      assert.equal(m.theme, "#2f6bff", "la tienda carga tema.css");
      assert.equal(m.fontsOn, true, "common.js activó las fuentes");
      assert.equal(m.over, false, "portada sin desborde");
      assert.deepEqual(m.small, [], "portada: botones de 44 px");
      assert.deepEqual(m.tiny, [], "portada: letra de 12 px o más");
      // Catálogo → agregar al carrito → carrito → pago (clienta con sesión).
      await p.locator('.bnav [data-s="catalogo"]').click();
      await p.locator("[data-add]").first().waitFor();
      m = await measure("body");
      assert.equal(m.over, false, "catálogo sin desborde"); assert.deepEqual(m.small, [], "catálogo: botones de 44 px"); assert.deepEqual(m.tiny, [], "catálogo: letra");
      await p.locator("[data-add]:not([disabled])").first().click();
      await p.waitForFunction(() => Number(document.querySelector("#cartN")?.textContent) >= 1);
      await p.locator('.bnav [data-cart]').click();
      await p.locator("#drawer:not([hidden]) .line").first().waitFor();
      m = await measure("#drawer");
      assert.equal(m.over, false, "carrito sin desborde"); assert.deepEqual(m.small, [], "carrito: botones de 44 px"); assert.deepEqual(m.tiny, [], "carrito: letra");
      await p.locator('#drawer [data-step="2"]').click();
      await p.locator("#drawer form").waitFor();
      const txt = (await p.locator("#drawer").innerText()).replace(/\s+/g, " ");
      assert.match(txt, /Finalizar pedido/);
      assert.match(txt, /QR|saldo|Saldo/, "ofrece al menos una forma de pago");
      m = await measure("#drawer");
      assert.equal(m.over, false, "pago sin desborde"); assert.deepEqual(m.small, [], "pago: botones de 44 px"); assert.deepEqual(m.tiny, [], "pago: letra");
      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  });
});
