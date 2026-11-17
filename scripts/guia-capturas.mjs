// Capturas para la guía con fotos de los revendedores (public/guia-revendedor.html). Datos ficticios: nada real.
// Uso: npm run build && node scripts/guia-capturas.mjs   (escribe public/img/guia/1..4.jpg)
import { createRequire } from "node:module";
import { mkdtempSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { createApp } from "../dist/server/app.js";

const { chromium } = createRequire(import.meta.url)("playwright");
const out = resolve("public/img/guia"); mkdirSync(out, { recursive: true });
const DAY = 864e5;
const dir = mkdtempSync(join(tmpdir(), "gs-guia-"));
const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
app.bootstrapOwner("dueno", "Dueño", "clave-ficticia-123");
const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
s.catalog.updateSettings(owner, { storeName: "Tu tienda", whatsapp: "59170000000" });
s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", category: "Streaming", kind: "full_account", durationDays: 30, price: 7000, published: true, resellersOnly: true });
s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { dis: 6900 } });
s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
for (let i = 1; i <= 4; i++) s.inventory.addAccount(owner, { productId: "dis", supplierId: "p", email: `ejemplo${i}@correo.com`, password: "Clave-Ejemplo#1", supplierExpiresAt: Date.now() + 300 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] });
const rev = s.catalog.createCustomer(owner, { name: "Ana Ejemplo", phone: "+59170000001", kind: "reseller", priceGroupId: "revendedor" });
let k = 0;
const rent = (days) => { const o = s.orders.create(owner, { customerId: rev.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "r" + k++ }); const id = o.assignmentIds[0]; s.orders.setExpiry(owner, id, Date.now() + days * DAY); s.orders.setControl(owner, id, { price: 6900, payStatus: "pagado" }); };
rent(2); rent(-1); rent(20);
// QR de ejemplo (un dibujo cualquiera, no sirve para pagar).
const W = 160, raw = Buffer.alloc(W * (1 + W * 3));
for (let y = 0; y < W; y++) for (let x = 0; x < W; x++) { const o = y * (1 + W * 3) + 1 + x * 3; const on = ((x >> 3) * 7 + (y >> 3) * 13) % 5 < 2 || ((x < 48 || x > 111) && (y < 48 || y > 111) && !((x % 48 > 8 && x % 48 < 40) && (y % 48 > 8 && y % 48 < 40) && !(x % 48 > 16 && x % 48 < 32 && y % 48 > 16 && y % 48 < 32))); raw[o] = raw[o + 1] = raw[o + 2] = on ? 20 : 255; }
const crcT = new Int32Array(256).map((_, n) => { let c = n; for (let q = 0; q < 8; q++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc = (b) => { let c = -1; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (t, d) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(W, 0); ihdr.writeUInt32BE(W, 4); ihdr[8] = 8; ihdr[9] = 2;
const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);

const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
const post = (p, b, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b ?? {}) });
const ock = (await post("/api/auth/staff/login", { username: "dueno", password: "clave-ficticia-123" })).headers.get("set-cookie").split(";")[0];
await post("/api/admin/settings/qr", { contentBase64: png.toString("base64") }, ock);
await post(`/api/admin/customers/${rev.id}/login-pin`, {}, ock);
const link = (await (await post(`/api/admin/customers/${rev.id}/login-link`, {}, ock)).json()).url.replace(/^https?:\/\/[^/]+/, base);
const b = await chromium.launch();
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2, timezoneId: "America/La_Paz" });
  await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
  await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* */ } }, "c:" + rev.id);
  const p = await ctx.newPage(); p.on("dialog", (d) => d.accept());
  // Sin la barra de abajo ni los avisos flotantes: solo lo que hay que mirar. Recorta desde `from` hasta `to`.
  const clean = () => p.addStyleTag({ content: ".bnav,.toast,#toast,.toasts,#tour,.wafab,.hablar-fab{display:none!important}" });
  const shot = async (from, to, n) => {
    await p.waitForTimeout(600); await clean();
    const box = async (sel) => { const l = p.locator(sel).first(); await l.scrollIntoViewIfNeeded(); return l.evaluate((el) => { const r = el.getBoundingClientRect(); return { y: r.top + scrollY, height: r.height }; }); };
    const a = await box(from), z = await box(to);
    const y = Math.max(0, a.y - 8), h = Math.min(z.y + z.height + 8 - y, 1500);
    await p.screenshot({ path: `${out}/${n}.jpg`, type: "jpeg", quality: 72, clip: { x: 0, y, width: 390, height: h }, fullPage: true });
    console.log("ok", n, Math.round(h));
  };
  await p.goto(link, { waitUntil: "networkidle" });
  await p.evaluate(() => { for (const k of Object.keys(localStorage)) if (k.startsWith("gs-guide-")) return; localStorage.setItem("gs-guide-x", "1"); });
  await p.locator("#tour .tour-x").click({ timeout: 3000 }).catch(() => {});
  await shot(".hhead", ".hsimple", "1-inicio");
  await p.locator('.hsimple [data-s="cuentas"]').click(); await p.waitForLoadState("networkidle");
  await p.locator("#tour .tour-x").click({ timeout: 1000 }).catch(() => {});
  await shot(":text(\"Servicios activos\")", ":text(\"Reportar falla\")", "2-cuentas");
  await p.goto(base + "/hub/", { waitUntil: "networkidle" }); await p.locator("#tour .tour-x").click({ timeout: 2000 }).catch(() => {});
  await p.locator("button:visible").filter({ hasText: /Renovar las 2/ }).first().click();
  await p.waitForTimeout(900);
  await shot(":text(\"Pagá Bs 138 con un solo QR\")", ":text(\"Enviar comprobante\")", "3-renovar");
  await p.goto(base + "/hub/", { waitUntil: "networkidle" }); await p.locator("#tour .tour-x").click({ timeout: 2000 }).catch(() => {});
  await p.locator('.hsimple [data-s="codigos"]').click(); await p.waitForLoadState("networkidle");
  await shot(":text(\"Códigos de acceso\")", ":text(\"Bandeja\") >> xpath=..", "4-codigos");
} finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
