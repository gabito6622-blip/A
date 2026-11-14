// QR de cobro grande (14/11/2026). Un cliente le dijo al dueño que el QR de la tienda «estaba muy chico» (120 px al
// costado del texto). Ahora: a lo ancho, sin recortar un afiche vertical, con el monto exacto, «🔍 Ver grande» a
// pantalla completa y «📥 Guardar QR» para pagar desde la galería del mismo celular. También en la página del revendedor.
// Imagen ficticia generada acá (nunca el QR real del dueño), 360 px, claro y oscuro.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

// PNG ficticio de W×H (un «afiche» vertical gris claro), para medir cómo se ve sin usar el QR real.
function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 220)]);
  const raw = Buffer.concat(Array.from({ length: h }, () => row));
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

test("QR grande: a lo ancho, con el monto, «Ver grande» y «Guardar QR» en el pago de la tienda", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-qrg-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * 86_400_000, cost: 1000, profiles: [{ label: "P1" }, { label: "P2" }] });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    assert.equal((await post("/api/admin/settings/qr", { contentBase64: png(600, 656).toString("base64") }, ock)).status, 200);
    await fetch(base + "/api/admin/settings", { method: "PUT", headers: { "content-type": "application/json", cookie: ock }, body: JSON.stringify({ whatsapp: "+59170000000" }) });

    for (const scheme of ["dark", "light"]) {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme, isMobile: true, hasTouch: true, acceptDownloads: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/tienda/");
      await p.locator('[data-add="nf"]').first().click();
      await p.locator("[data-cart]").first().click();
      // Paso 2 (pago) del invitado: el QR grande.
      const next = p.locator("#drawer button.pri", { hasText: /pagar|Continuar|Siguiente/i }).first();
      if (await next.count()) await next.click();
      const img = p.locator("#drawer .qrg-img img");
      await img.waitFor();
      await p.waitForFunction(() => document.querySelector("#drawer .qrg-img img")?.complete);
      const box = await img.boundingBox();
      assert.ok(box.width >= 290, `${scheme}: el QR mide ${box.width}px de ancho (antes 120)`);
      assert.ok(Math.abs(box.height / box.width - 656 / 600) < 0.02, `${scheme}: el afiche no se recorta ni se estira`);
      assert.match(await p.locator("#drawer .qrg-amt").innerText(), /Pagá exactamente Bs\s?35/);
      for (const h of await p.locator("#drawer .qrg-btns .sbtn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) assert.ok(h >= 44, `${scheme}: botón de ${h}px`);
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, `${scheme}: sin desborde`);
      // «Guardar QR» baja la imagen con un nombre claro.
      const save = p.locator("#drawer .qrg-btns [data-qrsave]");
      assert.match(await save.getAttribute("download"), /^QR-.+\.jpg$/);
      const [dl] = await Promise.all([p.waitForEvent("download"), save.click()]);
      assert.match(dl.suggestedFilename(), /^QR-.+\.jpg$/);
      // «Ver grande»: a pantalla completa sobre blanco, y se cierra.
      await p.locator("#drawer .qrg-btns [data-qrzoom]").click();
      const full = p.locator(".qrg-full img");
      await full.waitFor();
      const fb = await full.boundingBox();
      assert.ok(fb.width >= 320, `${scheme}: en grande mide ${fb.width}px`);
      assert.equal(await p.locator(".qrg-full").evaluate((e) => getComputedStyle(e).backgroundColor), "rgb(255, 255, 255)");
      await p.locator(".qrg-full [data-qrclose]").click();
      assert.equal(await p.locator(".qrg-full").count(), 0, "se cierra");
      // Tocar la imagen también la abre en grande.
      await p.locator("#drawer .qrg-img").click();
      await p.locator(".qrg-full").waitFor();
      await p.keyboard.press("Escape");
      assert.equal(await p.locator(".qrg-full").count(), 0);
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
