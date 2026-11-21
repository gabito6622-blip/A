// Revisión «en el lugar del cliente final» (20/11/2026), en el navegador a 360 y 390 px, claro y oscuro.
// Datos ficticios en una carpeta temporal; nunca sale un WhatsApp ni un pago real (wa.me se corta).
//  1. Pagar con QR sin comprobante: el error sale UNA vez, junto al campo que falta y a la vista (antes salía arriba
//     de todo del carrito, fuera de la pantalla, y cada toque sumaba otro cartel).
//  2. Bandeja de códigos: los botones dicen «Netflix · nf», no solo «nf»; el número chico mide 12 px o más.
//  3. Número de WhatsApp legible: «+591 70000000».
//  4. Pantalla de fallas: no manda a «Mis cuentas» (ya estás donde se reporta).
//  5. El botón verde de WhatsApp se esconde si queda encima de «Copiar».
//  6. Link de códigos: el correo queda escrito para la próxima vez (sin abrir solo) y «Usar otro correo» lo borra.
//  7. Tarjetas de producto a 360 px: las etiquetas («Popular», «Últimas», la categoría) no tapan el logo.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import { createApp } from "../dist/server/app.js";
import { fakeQrPng } from "../scripts/png.mjs";
import { mailChipLabels, prettyPhone } from "../public/cliente-final.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 86_400_000;
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("nombres de la bandeja y número legible (sin navegador)", () => {
  const services = [{ product: "Netflix", access: { email: "nf02@x.lat" } }, { product: "Max (alquiler revendedores)", access: { email: "mx@x.lat" } }];
  assert.deepEqual(mailChipLabels(["nf02@x.lat", "mx@x.lat", "suelto@x.lat", "dp@x.lat"], services, [{ to: "dp@x.lat", product: "Disney+" }]),
    ["Netflix · nf02", "Max · mx", "suelto", "Disney+ · dp"]);
  assert.equal(prettyPhone("59170000000"), "+591 70000000");
  assert.equal(prettyPhone("+591 7000-0000"), "+591 70000000");
  assert.equal(prettyPhone("50760001234"), "+50760001234");
  assert.equal(prettyPhone(""), "");
});

test("cliente final en el celular: error del pago a la vista, códigos claros, fallas y link de códigos", { timeout: 240_000 }, async (t) => {
  if (!chromium) return t.skip("sin Playwright");
  const dir = mkdtempSync(join(tmpdir(), "gs-clifinal-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, fetchImpl: async () => { throw new Error("sin red"); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  const qr = randomBytes(16).toString("hex") + ".png";
  writeFileSync(join(dir, "uploads", qr), fakeQrPng());
  s.catalog.updateSettings(owner, { storeName: "Tienda Prueba", whatsapp: "59170000000", paymentNote: "QR de prueba", qrFileRef: qr });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", category: "Streaming", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "gm", name: "Gemini Pro", category: "Inteligencia artificial", kind: "invite", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertProduct(owner, { id: "cv", name: "Canva Pro", category: "Inteligencia artificial", kind: "invite", durationDays: 30, price: 2000, published: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Secreta#9", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [{ label: "P1", pin: "1111" }, { label: "P2", pin: "2222" }] });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf2@x.lat", password: "Clave-Secreta#8", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [{ label: "P1", pin: "3333" }] });
  s.inventory.addAccount(owner, { productId: "gm", supplierId: "andes", email: "gm@x.lat", password: "Clave-Secreta#7", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [{ label: "Invitación" }, { label: "Invitación 2" }, { label: "Invitación 3" }] });
  s.inventory.addAccount(owner, { productId: "cv", supplierId: "andes", email: "cv@x.lat", password: "Clave-Secreta#6", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [{ label: "Invitación" }] });
  const rosa = s.catalog.createCustomer(owner, { name: "Rosa Prueba", phone: "+59170000123" });
  s.orders.create(owner, { customerId: rosa.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
  s.orders.create(owner, { customerId: rosa.id, items: [{ productId: "gm", qty: 1 }], paymentMethod: "cash" });
  const mails = Object.values(s.engine.s.assignments).filter((a) => a.customerId === rosa.id).map((a) => s.engine.s.accounts[s.engine.s.slots[a.slotId].accountId].email);
  const mb = s.codes.configureMailbox(owner, { address: "codigos@ficticio.lat", host: "imap.ficticio.lat" });
  s.codes.ingest(owner, mb.id, { to: mails[0], subject: "Tu código de acceso temporal de Netflix", body: "Tu código es 482915", receivedAt: Date.now(), from: "info@account.netflix.com" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", origin: base, ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const br = await chromium.launch();
  try {
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${rosa.id}/login-pin`, {}, ock)).json();
    const link = await (await post(`/api/admin/customers/${rosa.id}/code-link`, {}, ock)).json();
    for (const [w, dark] of [[360, false], [390, true]]) {
      const ck = (await post("/api/auth/customer/pin", { phone: rosa.phone, pin })).headers.get("set-cookie").split(";")[0];
      const ctx = await br.newContext({ viewport: { width: w, height: 780 }, isMobile: true, hasTouch: true, colorScheme: dark ? "dark" : "light" });
      await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      const where = `${w} px ${dark ? "oscuro" : "claro"}`;

      /* 3 · número legible */
      await p.goto(base + "/tienda/#inicio");
      await p.locator(".availbar a").first().waitFor();
      assert.match(await p.locator(".availbar a").first().innerText(), /\+591 70000000/, where);

      /* 7 · etiquetas que no tapan el logo */
      await p.goto(base + "/tienda/#catalogo");
      await p.locator(".pc").first().waitFor();
      assert.doesNotMatch(await p.locator("body").innerText(), /🔥 Popular|⭐ Top/, "21/11: sin «Popular»/«Top» inventados");
      const gaps = await p.evaluate(() => [...document.querySelectorAll(".pc .pimg")].map((x) => { const b = x.querySelector(".pbadges").getBoundingClientRect(), m = x.querySelector(":scope > :not(.pbadges)").getBoundingClientRect(); return m.top - b.bottom; }));
      assert.ok(gaps.length >= 3 && gaps.every((g) => g >= 0), `${where}: etiquetas sin tapar el logo (${gaps.join(",")})`);
      const hs = await p.evaluate(() => [...new Set([...document.querySelectorAll(".pc .pimg")].map((x) => Math.round(x.getBoundingClientRect().height)))]);
      assert.equal(hs.length, 1, `${where}: todas las imágenes miden lo mismo (${hs})`);

      /* 1 · error del pago a la vista, una sola vez, junto al campo */
      await p.locator(".pc", { hasText: "Gemini Pro" }).locator("[data-add]").first().click();
      await p.locator(".bnav [data-cart]").click();
      await p.locator("#drawer [data-step='2']").click();
      const form = p.locator("#checkout");
      await form.waitFor();
      assert.equal(await form.locator("[name=pm]:checked").inputValue(), "qr", `${where}: sin saldo, QR`);
      const fin = form.locator("[type=submit]");
      await fin.click(); await fin.click();
      const err = form.locator("[data-ferr]");
      await err.waitFor();
      assert.equal(await err.count(), 1, `${where}: un solo cartel aunque toque dos veces`);
      assert.equal(await err.getAttribute("role"), "alert");
      assert.match(await err.innerText(), /Subí la foto del comprobante y escribí el número de operación/);
      await p.waitForTimeout(500);
      assert.ok(await err.evaluate((el) => { const r = el.getBoundingClientRect(), d = el.closest("#drawer").getBoundingClientRect(); return r.top >= d.top && r.bottom <= Math.min(d.bottom, innerHeight); }), `${where}: el error se ve sin buscarlo`);
      assert.ok(await err.evaluate((el) => !!el.previousElementSibling?.querySelector?.("input[type=file]")), `${where}: va justo debajo del comprobante`);
      assert.equal(await form.locator("input[type=file]").getAttribute("aria-invalid"), "true");
      // Con la foto pero sin el número: el error pasa al número de operación.
      await form.locator("input[type=file]").setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: PNG });
      assert.equal(await form.locator("[data-ferr]").count(), 0, "al elegir la foto se va el error");
      await fin.click();
      assert.match(await form.locator("[data-ferr]").innerText(), /Falta el número de operación/);
      assert.equal(await form.locator("[name=ref]").getAttribute("aria-invalid"), "true");
      assert.equal(await form.locator("input[type=file]").getAttribute("aria-invalid"), null);
      await form.locator("[name=ref]").fill(`OP-${w}-123456`);
      await fin.click();
      await p.locator("#drawer", { hasText: "Pedido enviado" }).waitFor();
      await p.locator("#drawer [data-close]").first().click();

      /* 2 · bandeja de códigos */
      await p.goto(base + "/tienda/#codigos");
      await p.locator(".mrow [data-copy]").first().waitFor(); // los códigos ya llegaron (antes, los botones salen sin el número)
      const chips = await p.locator(".mchip").allInnerTexts();
      assert.ok(chips.some((c) => /^Netflix · nf\b/.test(c)), `${where}: ${chips.join(" | ")}`);
      // La bandeja se redibuja sola: se mide todo en un solo paso dentro de la página.
      const fsz = await p.evaluate(() => [...document.querySelectorAll(".mchip small")].filter((x) => x.textContent.trim()).map((x) => parseFloat(getComputedStyle(x).fontSize)));
      assert.ok(fsz.length && fsz.every((f) => f >= 12), `número del botón ≥ 12 px (${fsz})`);

      /* 5 · el botón verde no tapa «Copiar» */
      const copy = p.locator(".mrow [data-copy]").first();
      const fab = p.locator("#hablar");
      const fb = await fab.boundingBox(), cb = await copy.boundingBox();
      await p.evaluate((dy) => scrollBy(0, dy), cb.y + cb.height / 2 - (fb.y + fb.height / 2));
      await p.waitForTimeout(250);
      const [a, c] = [await fab.boundingBox(), await copy.boundingBox()];
      assert.ok(c.y < a.y + a.height && c.y + c.height > a.y && c.x < a.x + a.width && c.x + c.width > a.x, `${where}: la prueba pone «Copiar» debajo del botón verde`);
      assert.match(await fab.getAttribute("class"), /hablar-fuera/, `${where}: se esconde encima de Copiar`);

      /* 4 · fallas */
      await p.goto(base + "/tienda/#fallas");
      await p.locator(".fhelp").waitFor();
      const fh = await p.locator(".fhelp").innerText();
      assert.match(fh, /formulario de abajo/);
      assert.doesNotMatch(fh, /Reportá en Mis cuentas/);

      /* 6 · link de códigos: el correo queda escrito */
      const url = link.url.replace(/^https?:\/\/[^/]+/, base);
      await p.goto(url);
      await p.locator("#em").fill(mails[0]);
      await p.locator("#fe [type=submit]").click();
      await p.locator(".v", { hasText: "482915" }).waitFor();
      const p2 = await ctx.newPage(); // otra pestaña: como volver a abrir el link desde WhatsApp
      await p2.goto(url);
      await p2.locator("#em").waitFor();
      assert.equal(await p2.locator("#em").inputValue(), mails[0], `${where}: el correo ya está escrito`);
      assert.equal(await p2.locator(".v").count(), 0, "no se abre solo: hay que tocar «Ver mi código»");
      assert.equal(await p2.locator("#e").getAttribute("aria-live"), "polite");
      await p2.locator("#em").fill("otro@x.lat");
      await p2.locator("#fe [type=submit]").click();
      await p2.locator(".empty", { hasText: "bien escrito" }).waitFor();
      await p2.locator("#chg").click();
      assert.equal(await p2.locator("#em").inputValue(), "", "«Usar otro correo» lo borra");
      const p3 = await ctx.newPage(); await p3.goto(url); await p3.locator("#em").waitFor();
      assert.equal(await p3.locator("#em").inputValue(), "");

      const over = await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
      assert.equal(over, false, `${where}: sin desborde`);
      assert.deepEqual(errs, [], where);
      await ctx.close();
    }
  } finally {
    await br.close();
    await app.close?.();
    rmSync(dir, { recursive: true, force: true });
  }
});
