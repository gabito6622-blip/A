// Revisión «solo clientes» (15/11/2026): ~30 clientes ficticios recorrieron la tienda ya arreglada en el celular, la
// computadora, con zoom y lector de pantalla. Lo que todavía los trababa y quedó arreglado:
//  1. «Soy nuevo» y «Olvidé mi PIN» prometían «Recibir código» aunque la tienda no manda códigos (sin WhatsApp oficial):
//     ahora van directo a pedir el PIN por WhatsApp, y al nuevo no se le pide «un dato de tu compra» (todavía no compró).
//  2. La tarjeta «Tu plan» decía «Próximo pago · Bs 17» por un plan de Bs 90 cuando un servicio todavía no se podía
//     renovar desde la tienda (la cuenta del proveedor vence antes): ya no muestra un monto a medias y dice cuál es.
//  3. «Cambiarme a otro servicio» (p. ej. de Netflix a Disney+) desde la tarjeta, con el servicio y el correo escritos.
//  4. «Vence en 18 d» → «Vence en 18 días».
//  5. Botones de 44 px también en la computadora (menú de arriba, «Acceder», carrito, botones chicos), en Términos y en
//     las preguntas de /revendedores; «Abrir enlace» de los códigos no se parte; fechas de Términos y Privacidad en dd/mm.
//  6. El cartel «… agregado al carrito» no tapa el pago (con zoom 200 % cubría «Guardar QR») ni bloquea toques.
//  7. Al terminar de pagar con QR: qué compró y cuánto (decía «Pedido ord_00297») y, de noche, «antes de las 08:30 de
//     mañana» como en Mis cuentas (prometía «10–30 minutos»).
// Datos ficticios, carpeta temporal, sin red (wa.me cortado en el navegador).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { fakeQrPng } from "../scripts/png.mjs";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const owner = { id: "u_owner", role: "owner" };
const asC = (c) => ({ id: "u_" + c.id, role: "customer", customerId: c.id });
const D = 86_400_000;
const T0 = Date.UTC(2026, 10, 16, 14, 0); // lunes 16/11/2026 10:00 en Bolivia
const src = (f) => readFileSync(resolve("public", f), "utf8");

describe("plan mensual: no muestra un «próximo pago» a medias", () => {
  const clock = { t: T0, now() { return this.t; } };
  let dir, app, s, gaby;
  before(() => {
    dir = mkdtempSync(join(tmpdir(), "gs-solocli-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
    s = app.store;
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    for (const [id, name, price, supplierDays] of [["nf", "Netflix", 4000, 300], ["dp", "Disney+", 1700, 300], ["sp", "Spotify", 3300, 300]]) {
      s.catalog.upsertProduct(owner, { id, name, kind: "profile", durationDays: 30, price, published: true });
      s.inventory.addAccount(owner, { productId: id, supplierId: "andes", email: `${id}@ficticio.lat`, password: "Clave-Ficticia#1", supplierExpiresAt: T0 + supplierDays * D, cost: 1000, profiles: [{ label: "P1" }, { label: "P2" }] });
    }
    gaby = s.catalog.createCustomer(owner, { name: "Gaby Plan", phone: "+59170000111" });
    s.wallet.adjust(owner, gaby.id, 50000, "saldo de prueba");
    for (const pid of ["nf", "dp", "sp"]) s.orders.create(asC(gaby), { customerId: gaby.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "balance", idempotencyKey: pid });
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("con todo renovable: el próximo pago es el mes entero de los tres", () => {
    const ids = Object.values(s.engine.s.assignments).filter((a) => a.customerId === gaby.id).map((a) => a.id);
    s.plan.set(asC(gaby), { on: true, ids });
    const v = s.plan.view(asC(gaby));
    assert.equal(v.plan.ok, true);
    assert.equal(v.plan.total, 4000 + 1700 + 3300);
  });

  test("si la cuenta del proveedor de Netflix vence antes del próximo mes: sin monto a medias y dice cuál", () => {
    // La cuenta de Netflix con el proveedor ahora vence a los 45 días: renovarla (hasta el día 60) no se puede desde acá.
    const acc = Object.values(s.engine.s.accounts).find((a) => a.productId === "nf");
    s.inventory.updateAccount(owner, acc.id, { supplierExpiresAt: T0 + 45 * D });
    clock.t = T0 + 25 * D;
    const v = s.plan.view(asC(gaby));
    assert.equal(v.plan.ok, false);
    assert.equal(v.plan.total, null, "no decir «Bs 50» por un plan de Bs 90");
    assert.match(v.plan.why, /^Netflix: todavía no se puede renovar desde acá/);
  });
});

test("Acceder sabe si la tienda manda códigos por WhatsApp (loginCode)", async () => {
  for (const [otpSender, want] of [[undefined, false], [() => {}, true]]) {
    const dir = mkdtempSync(join(tmpdir(), "gs-solocli-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {}, ...(otpSender ? { otpSender } : {}) });
    const port = await app.listen(0, "127.0.0.1");
    const st = await (await fetch(`http://127.0.0.1:${port}/api/settings`)).json();
    assert.equal(st.loginCode, want);
    await app.close(); rmSync(dir, { recursive: true, force: true });
  }
});

test("botones de 44 px también en la computadora, Términos/Privacidad en dd/mm y el cartel no bloquea toques", () => {
  const shop = src("shop.css"), legal = src("legal.css"), base = src("base.css");
  assert.match(shop, /\n\.sbtn,\.sbtn\.sm\{min-height:44px\}/, "fuera de la media query del celular");
  assert.match(shop, /\.snav button\{[^}]*min-height:44px/);
  assert.match(shop, /\.pfaq summary\{[^}]*min-height:44px/);
  assert.match(shop, /\.code \.sbtn\{white-space:nowrap;min-width:44px\}/);
  assert.match(legal, /\.toc a\{display:inline-flex;align-items:center;min-height:44px/);
  assert.match(base, /\.toast\{[^}]*pointer-events:none/);
  for (const f of ["terminos.html", "privacidad.html"]) {
    const h = src(f);
    assert.match(h, /Actualizado: \d{2}\/\d{2}\/\d{4}/, f);
    assert.doesNotMatch(h, /\d{1,2} de (enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|octubre|noviembre|diciembre)/, f);
  }
});

describe("en el navegador (360 px y computadora)", { skip: !chromium && "Playwright no está instalado" }, () => {
  let dir, app, base, b, nf;
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-solocli-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, fetchImpl: async () => { throw new Error("sin red"); } });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const s = app.store;
    writeFileSync(join(dir, "uploads", "qr-prueba.png"), fakeQrPng());
    s.catalog.updateSettings(owner, { storeName: "Tienda Prueba", whatsapp: "59170000000", storeHours: "8 a 22", qrFileRef: "qr-prueba.png" });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    for (const [id, name, price] of [["nf", "Netflix", 4000], ["dp", "Disney+", 1700]]) {
      s.catalog.upsertProduct(owner, { id, name, kind: "profile", durationDays: 30, price, published: true });
      s.inventory.addAccount(owner, { productId: id, supplierId: "andes", email: `${id}1@ficticio.lat`, password: "Clave-Ficticia#1", supplierExpiresAt: Date.now() + 200 * D, cost: 1000, profiles: [1, 2, 3].map((n) => ({ label: `Perfil ${n}`, pin: "1234" })) });
    }
    const andres = s.catalog.createCustomer(owner, { name: "Andrés Cambio", phone: "+59170000222" });
    nf = s.orders.create(owner, { customerId: andres.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    await fetch(base + `/api/admin/customers/${andres.id}/login-pin`, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ pin: "2222" }) });
    b = await chromium.launch();
  });
  after(async () => { await b?.close(); await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  const open = async (opts) => {
    const ctx = await b.newContext(opts);
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    return { ctx, p, errs };
  };

  test("Mis cuentas: «Vence en N días» y «Cambiarme a otro servicio» con el servicio y el correo", { timeout: 120_000 }, async () => {
    const { ctx, p, errs } = await open({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
    await p.goto(base + "/tienda/#cuentas");
    await p.locator("#accBtn").click();
    await p.locator("#login [name=phone]").fill("+591 70000222");
    await p.locator("#login [name=pin]").fill("2222");
    await p.locator('#login [type="submit"]').click();
    const card = p.locator("#sout .svc", { hasText: "Netflix" }).first();
    await card.waitFor();
    assert.match(await card.innerText(), /Vence en (29|30) días ·/);
    assert.doesNotMatch(await card.innerText(), /Vence en \d+ d ·/);
    const sw = card.locator("a", { hasText: "Cambiarme a otro servicio" });
    const href = decodeURIComponent(await sw.getAttribute("href"));
    assert.match(href, /soy Andrés Cambio\. Quiero cambiar mi Netflix \(nf1@ficticio\.lat\) por otro servicio de Tienda Prueba\. ¿Se puede y cómo me queda la fecha\?/);
    const bb = await sw.boundingBox();
    assert.ok(bb.height >= 44 && bb.width >= 44);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test("al terminar de pagar con QR: qué compró y cuánto, no «Pedido ord_…»", { timeout: 120_000 }, async () => {
    const { ctx, p, errs } = await open({ viewport: { width: 360, height: 760 }, isMobile: true, hasTouch: true });
    await p.goto(base + "/tienda/#catalogo");
    await p.locator("#accBtn").click();
    await p.locator("#login [name=phone]").fill("+591 70000222");
    await p.locator("#login [name=pin]").fill("2222");
    await p.locator('#login [type="submit"]').click();
    await p.locator("#accName", { hasText: "Andrés" }).waitFor();
    await p.locator('[data-add="dp"]:visible').first().click();
    await p.locator(".bnav [data-cart]").click();
    await p.locator('#drawer [data-step="2"]').click();
    await p.locator('#checkout input[name="pm"][value="qr"]').check();
    await p.locator('#checkout input[name="file"]').setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64") });
    await p.locator('#checkout input[name="ref"]').fill("55512345");
    await p.locator('#checkout [type="submit"]').click();
    await p.locator("#drawer .steps span.on", { hasText: "3 · Listo" }).waitFor();
    const t = await p.locator("#drawer").innerText();
    assert.match(t, /Disney\+ · Bs 17/);
    assert.match(t, /Nro\. de pedido ord_\d+/);
    assert.doesNotMatch(t, /Pedido ord_/);
    // De noche (22:30, la tienda atiende de 8 a 22) no promete «10–30 minutos»: el mismo plazo que «Mis cuentas».
    const night = Date.UTC(2026, 10, 23, 2, 30); // domingo 22/11 22:30 en Bolivia
    const html = await p.evaluate(async (t0) => (await import("/despues-pago.js")).pedidoListoHtml({ what: "Prime", total: 2000, status: "payment_review", id: "ord_1", sentAt: t0 }, t0), night);
    assert.match(html, /antes de las 08:30 de mañana/);
    assert.doesNotMatch(html, /10–30 minutos/);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test("el cartel «agregado al carrito» se va al abrir el carrito y nunca tapa un toque", { timeout: 120_000 }, async () => {
    const { ctx, p, errs } = await open({ viewport: { width: 180, height: 380 }, deviceScaleFactor: 4, isMobile: true, hasTouch: true }); // 360 px con zoom 200 %
    await p.goto(base + "/tienda/#catalogo");
    await p.locator('[data-add="dp"]:visible').first().click();
    assert.equal(await p.locator("#toast").isVisible(), true);
    assert.equal(await p.evaluate(() => getComputedStyle(document.getElementById("toast")).pointerEvents), "none");
    await p.locator(".bnav [data-cart]").click();
    assert.equal(await p.locator("#toast").isHidden(), true, "el carrito ya muestra lo agregado");
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test("computadora: el menú de arriba, Acceder y el carrito miden 44 px", { timeout: 120_000 }, async () => {
    const { ctx, p, errs } = await open({ viewport: { width: 1366, height: 768 } });
    await p.goto(base + "/tienda/#inicio");
    await p.locator(".snav button").first().waitFor();
    const small = await p.evaluate(() => [...document.querySelectorAll(".snav button, #accBtn, .shead [data-cart], #sout .sbtn")]
      .filter((e) => { const r = e.getBoundingClientRect(); return r.width && r.height < 43.5; }).map((e) => e.textContent.trim().slice(0, 20)));
    assert.deepEqual(small, []);
    assert.deepEqual(errs, []);
    await ctx.close();
  });
});
