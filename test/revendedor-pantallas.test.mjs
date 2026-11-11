// Pantallas del revendedor en el celular (360 px): sin desborde, sin errores y con los logos de las apps.
// Usa el navegador (Playwright) si está instalado; si no (por ejemplo en la CI), se salta.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { randomBytes } from "node:crypto";
import { deflateSync } from "node:zlib";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

const DAY = 86_400_000;
function png(rgb) {
  const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
  const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
  const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const w = 8, h = 8, raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) raw.set(rgb, y * (w * 3 + 1) + 1 + x * 3);
  const ih = Buffer.alloc(13); ih.writeUInt32BE(w, 0); ih.writeUInt32BE(h, 4); ih[8] = 8; ih[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ih), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("revendedor a 360 px: todas sus pestañas sin desborde ni errores, con logos de las apps", { skip: !chromium && "Playwright no está instalado" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-rpant-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine;
  const owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  mkdirSync(join(dir, "uploads"), { recursive: true });
  const upload = (buf) => { const n = randomBytes(16).toString("hex") + ".png"; writeFileSync(join(dir, "uploads", n), buf); return n; };
  // Catálogo: Netflix y Disney con logo, Crunchyroll sin logo (se ve la inicial), y Disney de alquiler sin imagen propia.
  for (const [id, name, color, rgb] of [["nf", "Netflix", "#e50914", [229, 9, 20]], ["dis", "Disney+", "#113ccf", [17, 60, 207]], ["cr", "Crunchyroll", "#f47521", null]]) {
    s.catalog.upsertProduct(owner, { id, name, kind: "profile", durationDays: 30, price: 3000, color, published: true });
    if (rgb) s.catalog.setProductImage(owner, id, upload(png(rgb)));
  }
  s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500, dis: 2200, cr: 1500, "dis-alq": 7000 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  for (const pid of ["nf", "dis", "cr"]) s.inventory.addAccount(owner, { productId: pid, supplierId: "andes", email: `${pid}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [1, 2, 3, 4].map((i) => ({ label: `Perfil ${i}` })) });
  s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "andes", email: "alq@x.lat", password: "Clave-Larga#2", supplierExpiresAt: Date.now() + 90 * DAY, cost: 5000, profiles: [{ label: "Cuenta completa" }] });
  const ari = s.catalog.createCustomer(owner, { name: "Ariana Flores", phone: "+59171234567", kind: "reseller", priceGroupId: "rev" });
  const AR = { id: "u_" + ari.id, role: "reseller", customerId: ari.id };
  s.shops.setPage(owner, ari.id, true);
  s.shops.setupFor(owner, ari.id, { slug: "ariana-tv", title: "Ariana Streaming", enabled: true });
  s.portal.setPrices(AR, { nf: 4000, dis: 3500, cr: 2500 });
  s.wallet.adjust(owner, ari.id, 50000, "carga de prueba");
  const names = ["Camila Rojas", "Diego Mamani", "Valeria Soto de la Fuente Montenegro"];
  names.forEach((name, i) => {
    const c = s.catalog.createCustomer(AR, { name, phone: `+5916000000${i}` });
    const o = s.orders.create(AR, { customerId: c.id, items: [{ productId: ["nf", "dis", "cr"][i], qty: 1 }], paymentMethod: "balance", idempotencyKey: "k" + i });
    s.orders.setExpiry(owner, o.assignmentIds[0], Date.now() + (i * 3 - 1) * DAY);
    if (i === 0) s.fiado.charge(AR, { customerId: c.id, amount: 1500, note: "Netflix" });
  });
  const aid = s.orders.create(AR, { customerId: ari.id, items: [{ productId: "dis-alq", qty: 1 }], paymentMethod: "balance", idempotencyKey: "alq" }).assignmentIds[0];
  const { sub } = s.subs.save(AR, aid, { name: "Rosa Quispe", phone: "+59171112233", expiresAt: Date.now() + 2 * DAY, price: 1500, pay: "pendiente" });
  const { token } = s.subs.link(AR, aid, sub.id);

  const port = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  try {
    const post = (p, b, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${ari.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: "+59171234567", pin })).headers.get("set-cookie").split(";")[0];

    const ctx = await browser.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com/, (route) => route.abort()); // nunca sale un WhatsApp real
    await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, ari.id);
    const [n, v] = rck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (err) => errors.push(err.message));
    page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errors.push(m.text()); });

    /** Nada más ancho que la pantalla, y los logos (imágenes) que haya, cargados. */
    const check = async (where) => {
      const r = await page.evaluate(() => {
        const vw = document.documentElement.clientWidth;
        const imgs = [...document.querySelectorAll("#sout .mini.mimg img")];
        return { docW: document.documentElement.scrollWidth, vw, logos: imgs.length, broken: imgs.filter((i) => i.complete && !i.naturalWidth).length, letters: document.querySelectorAll("#sout .mini:not(.mimg)").length };
      });
      assert.ok(r.docW <= r.vw, `${where}: la página se sale (${r.docW} > ${r.vw})`);
      assert.equal(r.broken, 0, `${where}: logos rotos`);
      return r;
    };
    const settle = () => page.waitForTimeout(400);

    await page.goto(base + "/hub#inicio");
    await page.locator(".tday").waitFor();
    await settle();
    const ini = await check("Inicio");
    assert.ok(await page.locator(".tday .appsrow .mini").count() >= 1, "Tu día muestra las apps por avisar");
    assert.ok(ini.logos >= 1);

    for (const v of ["precios", "cuentas", "codigos", "recargas", "fallas"]) {
      await page.goto(base + "/hub#" + v);
      await page.locator("#sout .sec-h, #sout .sbox").first().waitFor();
      await settle();
      const r = await check(v);
      if (v === "cuentas") assert.ok(r.logos >= 3, "Mis cuentas: logo en cada servicio");
    }

    await page.goto(base + "/hub#clientes");
    await page.locator(".rtabs").waitFor();
    const want = { perfiles: 1, control: 2, debe: 1, ganancias: 1 };
    for (const t of ["ventas", "perfiles", "control", "debe", "ganancias", "afiches", "pagina", "combos"]) {
      await page.locator(`[data-rtab="${t}"]`).click();
      await page.waitForFunction((tab) => document.querySelector(`[data-rtab="${tab}"]`)?.getAttribute("aria-selected") === "true", t);
      await page.waitForTimeout(500);
      const r = await check("Clientes → " + t);
      if (want[t]) assert.ok(r.logos >= want[t], `${t}: faltan logos (${r.logos})`);
      if (t === "control") assert.ok(r.letters >= 1, "Crunchyroll sin logo: se ve la inicial");
    }
    // Repartir perfiles: la cuenta de alquiler sin imagen propia muestra el logo de Disney+.
    await page.locator('[data-rtab="perfiles"]').click();
    await page.locator(".subacc header .mini.mimg img").first().waitFor();
    assert.match(await page.locator(".subacc header .mini.mimg img").first().getAttribute("src"), /\/api\/products\/dis\/image/);

    // Link de cobro: el logo de la app, sin desborde.
    await page.goto(`${base}/c/${token}`);
    await page.locator("img.plogo").waitFor();
    await page.waitForFunction(() => document.querySelector("img.plogo")?.naturalWidth > 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth));

    assert.deepEqual(errors, [], "sin errores en la consola");
  } finally { await browser.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
