// C1 · «Hablar con una persona» y saber qué hacer antes, durante y después de pagar (revisión «en el lugar de ~30
// clientes», 14/11/2026). Datos ficticios; nunca sale un WhatsApp, un aviso ni un pago real (wa.me se corta y el
// servicio de push es un fetch falso).
//  1. Botón verde fijo «Hablar con una persona» en la tienda (no en GaboHub; en la página de un revendedor, con SU
//     WhatsApp), sin tapar el carrito ni la barra de abajo, con el horario configurado; «Preguntar por este» en la ficha.
//  2. Invitado: «Ya pagué» / «Todavía no pagué» con lo que pide y el total; «Ya pagué» lleva a «3 · Listo».
//  3. QR: los 3 pasos siempre a la vista; «📤 Mandar a quien paga» (imagen o WhatsApp con el link del QR).
//  4. Invitado de afuera: ve que puede pagar con USDT y cuánto es.
//  5. Aviso al celular al aprobar o rechazar (solo clientes de la tienda); «Mis cuentas» se actualiza sola;
//     «antes de las HH:MM» desde que subió el comprobante; «Se demoró más de lo normal» con el número de pedido.
//  6. Rechazado arriba de todo con «No pagues de nuevo».  7. Producto en tarjetas e historial; «🧾 Recibo».
//  8. Un solo mensaje sobre dónde llegan los datos.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { deflateSync } from "node:zlib";
import { createStore } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";
import { generateVapidKeys } from "../dist/server/push.js";
import { payOutcomeMsg } from "../dist/server/avisoPago.js";
import { hoursOf, isOpen, closedText, reviewDeadline, hhmm, nextOpen } from "../public/horario.js";
import { shareText } from "../public/qr-grande.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const owner = { id: "u_owner", role: "owner" }, admin = { id: "u_admin", role: "admin" };
const as = (c) => ({ id: "u_" + c.id, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id });
const FCM = "https://fcm.googleapis.com/fcm/send/c1-";
// Hora de Bolivia (UTC−4): 15:00 UTC = 11:00 en La Paz.
const LPZ = (h, m = 0) => Date.UTC(2026, 10, 14, h + 4, m);

function png(w, h) {
  const crcT = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = crcT[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (type, data) => { const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const td = Buffer.concat([Buffer.from(type), data]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([len, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const row = Buffer.concat([Buffer.from([0]), Buffer.alloc(w * 3, 220)]);
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(Array.from({ length: h }, () => row)))), chunk("IEND", Buffer.alloc(0))]);
}

describe("C1 · núcleo", () => {
  test("horario: el del bot manda; si no, el texto de la franja; si no, 8 a 22 en la tienda (nada en la página de un revendedor)", () => {
    assert.deepEqual(hoursOf({ attendHours: { from: 9, to: 21 }, storeHours: "Atención 8:00 a 22:00" }), { from: 9, to: 21 });
    assert.deepEqual(hoursOf({ storeHours: "Atención 8:00 a 23:00" }), { from: 8, to: 23 });
    assert.deepEqual(hoursOf({ storeHours: "de 10 a 20 hs" }), { from: 10, to: 20 });
    assert.deepEqual(hoursOf({}), { from: 8, to: 22 });
    assert.equal(hoursOf({}, false), null, "sin horario escrito, la página del revendedor no inventa uno");
    const h = { from: 8, to: 22 };
    assert.equal(isOpen(h, LPZ(11)), true);
    assert.equal(isOpen(h, LPZ(6)), false);
    assert.equal(closedText(h, LPZ(11)), "");
    assert.equal(closedText(h, LPZ(6)), "Te respondemos desde las 8:00");
    assert.equal(closedText(h, LPZ(23)), "Te respondemos mañana desde las 8:00");
    assert.equal(closedText(null, LPZ(3)), "", "sin horario no se dice nada");
  });

  test("«antes de las HH:MM» cuenta desde que SUBIÓ el comprobante; fuera de horario, desde que abrimos", () => {
    const h = { from: 8, to: 22 };
    assert.equal(hhmm(reviewDeadline(LPZ(14, 5), h)), "14:35", "subido 14:05 → antes de las 14:35");
    assert.equal(hhmm(reviewDeadline(LPZ(6, 40), h)), "08:30", "subido 6:40 → abrimos 8:00 → antes de las 8:30");
    const late = reviewDeadline(LPZ(23, 10), h);
    assert.equal(hhmm(late), "08:30");
    assert.ok(late - LPZ(23, 10) > 9 * 3_600_000, "subido 23:10 → al día siguiente");
    assert.equal(nextOpen(h, LPZ(10)), LPZ(10));
    assert.equal(reviewDeadline(undefined, h), null);
  });

  test("los pedidos dicen de qué son (título) y cuándo subió el comprobante; el cliente de un revendedor no ve más de lo debido", () => {
    const clock = { t: LPZ(11), now() { return this.t; } };
    const s = createStore({ clock });
    for (const [id, name] of [["nf", "Netflix"], ["dp", "Disney+"]]) s.catalog.upsertProduct(owner, { id, name, kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    for (const p of ["nf", "dp"]) s.inventory.addAccount(owner, { productId: p, supplierId: "andes", email: `${p}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: clock.t + 90 * DAY, cost: 2000, profiles: [1, 2, 3].map((i) => ({ label: `P${i}` })) });
    const ana = s.catalog.createCustomer(owner, { name: "Ana", phone: "+59170000001" });
    const o = s.orders.create(as(ana), { customerId: ana.id, items: [{ productId: "nf", qty: 1 }, { productId: "dp", qty: 2 }], paymentMethod: "qr" });
    clock.t += 5 * 60_000;
    s.orders.submitEvidence(as(ana), o.id, { fileRef: "up/1.jpg", declaredReference: "OP-1", hash: "h1" });
    const mine = s.portal.orders(as(ana)).find((x) => x.id === o.id);
    assert.equal(mine.title, "Netflix + 2 × Disney+");
    assert.equal(mine.sentAt, LPZ(11, 5), "sentAt = cuándo subió el comprobante, no cuándo hizo el pedido");
    // Cliente de un revendedor: el pedido que pagó su revendedor muestra qué es, pero ni monto ni cuándo pagó.
    const rev = s.catalog.createCustomer(owner, { name: "Rosa Rev", phone: "+59170000002", kind: "reseller" });
    const cli = s.catalog.createCustomer(as(rev), { name: "Cliente de Rosa", phone: "+59170000003" });
    const o2 = s.orders.create(as(rev), { customerId: cli.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr" });
    s.orders.submitEvidence(as(rev), o2.id, { fileRef: "up/2.jpg", declaredReference: "OP-2", hash: "h2" });
    const seen = s.portal.orders(as(cli)).find((x) => x.id === o2.id);
    assert.deepEqual([seen.title, seen.total, seen.sentAt, seen.paidBy], ["Netflix", null, undefined, "reseller"]);
  });

  test("aviso al celular: solo a clientes de la tienda; los de revendedor siguen igual", () => {
    const clock = { t: LPZ(11), now() { return this.t; } };
    const s = createStore({ clock });
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: clock.t + 90 * DAY, cost: 2000, profiles: [1, 2, 3, 4].map((i) => ({ label: `P${i}` })) });
    const ana = s.catalog.createCustomer(owner, { name: "Ana", phone: "+59170000001" });
    const rev = s.catalog.createCustomer(owner, { name: "Rosa Rev", phone: "+59170000002", kind: "reseller" });
    const cli = s.catalog.createCustomer(as(rev), { name: "Cliente de Rosa", phone: "+59170000003" });
    const pay = (who, cid) => { const o = s.orders.create(as(who), { customerId: cid, items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr" }); s.orders.submitEvidence(as(who), o.id, { fileRef: `up/${o.id}.jpg`, declaredReference: o.id, hash: o.id }); return o; };
    const a1 = pay(ana, ana.id), a2 = pay(ana, ana.id), r1 = pay(rev, cli.id), r2 = pay(rev, rev.id);
    assert.equal(payOutcomeMsg(s, a1.id), null, "en revisión todavía no se avisa");
    s.orders.approvePayment(admin, a1.id, { confirmedReference: a1.id });
    s.orders.rejectPayment(admin, a2.id, "El monto no coincide");
    const ok = payOutcomeMsg(s, a1.id), bad = payOutcomeMsg(s, a2.id);
    assert.equal(ok.customerId, ana.id);
    assert.deepEqual([ok.msg.title, ok.msg.url], ["✅ Tu pago fue aprobado", "/tienda/#cuentas"]);
    assert.match(ok.msg.body, /Netflix.*Mis cuentas/);
    assert.doesNotMatch(ok.msg.body, /Clave-Larga|nf@x\.lat/, "el aviso nunca lleva datos de la cuenta");
    assert.equal(bad.msg.title, "❌ No pudimos aprobar tu pago");
    assert.match(bad.msg.body, /Motivo: El monto no coincide.*No pagues de nuevo/);
    s.orders.approvePayment(admin, r1.id, { confirmedReference: r1.id });
    s.orders.approvePayment(admin, r2.id, { confirmedReference: r2.id });
    assert.equal(payOutcomeMsg(s, r1.id), null, "lo pagó el revendedor para su cliente");
    assert.equal(payOutcomeMsg(s, r2.id), null, "el revendedor tiene sus propios avisos en GaboHub");
  });

  test("«Mandar a quien paga»: el texto lleva qué es, el monto, a quién pagar y pide la foto del comprobante", () => {
    const t = shareText({ who: "Gabriel Store", amount: "Bs 35", what: "Netflix" });
    for (const x of ["Netflix", "Bs 35", "Gabriel Store", "foto del comprobante"]) assert.ok(t.includes(x), x);
  });
});

describe("C1 · servidor: aviso al aprobar o rechazar y horario en la tienda", () => {
  let dir, app, base, ock, sent;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body ?? {}) });
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-c1-"));
    sent = [];
    const fetchImpl = async (url) => { sent.push(String(url)); return new Response("", { status: 201 }); };
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, fetchImpl, vapid: { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" } });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("el cliente de la tienda recibe «aprobado» o «rechazado» en el celular, con link a Mis cuentas; el revendedor no", async () => {
    const s = app.store, o0 = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
    s.catalog.upsertProduct(o0, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertSupplier(o0, { id: "andes", name: "Andes", active: true });
    s.inventory.addAccount(o0, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [1, 2, 3, 4].map((i) => ({ label: `P${i}` })) });
    const login = async (c) => {
      assert.equal((await post(`/api/admin/customers/${c.id}/login-pin`, { pin: "4321" }, ock)).status, 200);
      return (await post("/api/auth/customer/pin", { phone: c.phone.replace(/^\+591/, ""), pin: "4321" })).headers.get("set-cookie").split(";")[0];
    };
    const ana = s.catalog.createCustomer(o0, { name: "Ana", phone: "+59170000011" });
    const rev = s.catalog.createCustomer(o0, { name: "Rosa", phone: "+59170000012", kind: "reseller" });
    const ack = await login(ana), rck = await login(rev);
    assert.equal((await post("/api/me/push/subscribe", { subscription: { endpoint: FCM + "ana", keys: { p256dh: "a", auth: "b" } } }, ack)).status, 200);
    assert.equal((await post("/api/me/push/subscribe", { subscription: { endpoint: FCM + "rosa", keys: { p256dh: "a", auth: "b" } } }, rck)).status, 200);
    const order = (who) => { const o = s.orders.create(as(who), { customerId: who.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr" }); s.orders.submitEvidence(as(who), o.id, { fileRef: `up/${o.id}.jpg`, declaredReference: o.id, hash: o.id }); return o; };
    const latest = async (ck) => (await fetch(base + "/api/me/push/latest", { headers: { cookie: ck } })).json();
    const settle = () => new Promise((r) => setTimeout(r, 150));

    const a1 = order(ana);
    assert.equal((await post(`/api/admin/orders/${a1.id}/approve`, { confirmedReference: a1.id }, ock)).status, 200);
    await settle();
    assert.deepEqual(sent, [FCM + "ana"], "un toque al celular de Ana");
    let m = await latest(ack);
    assert.deepEqual([m.title, m.url], ["✅ Tu pago fue aprobado", "/tienda/#cuentas"]);
    const a2 = order(ana);
    assert.equal((await post(`/api/admin/orders/${a2.id}/reject`, { reason: "Comprobante borroso" }, ock)).status, 200);
    await settle();
    m = await latest(ack);
    assert.equal(m.title, "❌ No pudimos aprobar tu pago");
    assert.match(m.body, /Comprobante borroso.*No pagues de nuevo/);
    // El revendedor sigue igual: su pago aprobado no le manda este aviso.
    const r1 = order(rev);
    assert.equal((await post(`/api/admin/orders/${r1.id}/approve`, { confirmedReference: r1.id }, ock)).status, 200);
    await settle();
    assert.equal(sent.filter((u) => u.endsWith("rosa")).length, 0);
    // Sin avisos configurados en el celular de alguien, aprobar igual funciona.
    const bob = s.catalog.createCustomer(o0, { name: "Bob", phone: "+59170000013" });
    const b1 = order(bob);
    assert.equal((await post(`/api/admin/orders/${b1.id}/approve`, { confirmedReference: b1.id }, ock)).status, 200);
  });

  test("/api/settings trae el horario de atención del bot (o nada si no está configurado)", async () => {
    assert.equal((await (await fetch(base + "/api/settings")).json()).attendHours, null);
    const o0 = { id: Object.keys(app.store.engine.s.staff)[0], role: "owner" };
    app.store.chats.updateBotSettings(o0, { humanHours: { from: 9, to: 21 } });
    assert.deepEqual((await (await fetch(base + "/api/settings")).json()).attendHours, { from: 9, to: 21 });
  });
});

describe("C1 · en el celular (360 px, claro y oscuro)", { skip: !chromium && "Playwright no está instalado" }, () => {
  let dir, app, base, ock, b, ana, rev;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body ?? {}) });
  const o0 = () => ({ id: Object.keys(app.store.engine.s.staff)[0], role: "owner" });
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-c1-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const s = app.store;
    assert.equal((await post("/api/admin/settings/qr", { contentBase64: png(300, 300).toString("base64") }, ock)).status, 200);
    s.catalog.updateSettings(o0(), { whatsapp: "59170000000", usdt: { enabled: true, payId: "123456789", network: "TRC20", rate: 10.5 } });
    s.chats.updateBotSettings(o0(), { humanHours: { from: 8, to: 22 } });
    s.catalog.upsertProduct(o0(), { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertSupplier(o0(), { id: "andes", name: "Andes", active: true });
    s.inventory.addAccount(o0(), { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [1, 2, 3, 4, 5].map((i) => ({ label: `P${i}` })) });
    ana = s.catalog.createCustomer(o0(), { name: "Ana", phone: "+59170000021" });
    s.catalog.upsertPriceGroup(o0(), { id: "rev", name: "Rev", prices: { nf: 2500 } });
    rev = s.catalog.createCustomer(o0(), { name: "Rosa", phone: "+59171111111", kind: "reseller", priceGroupId: "rev" });
    s.shops.setPage(o0(), rev.id, true);
    s.shops.setupFor(o0(), rev.id, { slug: "rosa-tv", title: "Rosa TV", enabled: true });
    b = await chromium.launch();
  });
  after(async () => { await b?.close(); await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  const newPage = async (scheme, opts = {}) => {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme, isMobile: true, hasTouch: true, acceptDownloads: true, ...opts });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    return { ctx, p, errs };
  };
  const measure = (p, sel) => p.evaluate((sel) => {
    const root = document.querySelector(sel) ?? document.body;
    const vis = (x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(x).visibility !== "hidden"; };
    return {
      over: document.documentElement.scrollWidth > innerWidth + 1,
      small: [...root.querySelectorAll("button, a.sbtn, a.hablar")].filter((x) => vis(x) && !x.closest(".cupx") && x.getBoundingClientRect().height < 44).map((x) => (x.textContent || "?").trim().slice(0, 30)),
      tiny: [...root.querySelectorAll("*")].filter((x) => vis(x) && !x.closest(".pt, .tkgrid, .skeleton") && [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 12).map((x) => x.textContent.trim().slice(0, 30)),
    };
  }, sel);
  const waText = (href) => decodeURIComponent(new URL(href).searchParams.get("text") ?? "");

  test("invitado: botón fijo de WhatsApp, «Preguntar por este», QR con los 3 pasos a la vista, «Mandar a quien paga», USDT y «Ya pagué» → «3 · Listo»", { timeout: 180_000 }, async () => {
    for (const scheme of ["dark", "light"]) {
      app.store.catalog.updateSettings(o0(), { backgroundColor: scheme === "light" ? "#f5f7fb" : "#090e1d" });
      const { ctx, p, errs } = await newPage(scheme);
      await p.clock.setFixedTime(new Date(LPZ(11))); // 11:00 en Bolivia: atendiendo
      await p.addInitScript((mode) => {
        window.__opened = []; window.open = (u) => { window.__opened.push(String(u)); return null; };
        if (mode === "fallback") Object.defineProperty(navigator, "share", { value: undefined, configurable: true });
        else {
          window.__shared = [];
          Object.defineProperty(navigator, "canShare", { value: (d) => !!d?.files?.length, configurable: true });
          Object.defineProperty(navigator, "share", { value: async (d) => { window.__shared.push({ text: d.text, type: d.files?.[0]?.type, name: d.files?.[0]?.name }); }, configurable: true });
        }
      }, scheme === "light" ? "fallback" : "share");
      await p.goto(base + "/tienda/#inicio");
      await p.waitForFunction(() => !document.querySelector("#sout .skeleton"));
      // 1. El botón verde, fijo, de 44 px o más, sin tapar la barra de abajo ni el carrito.
      const fab = p.locator("#hablar");
      await fab.waitFor();
      assert.equal((await fab.innerText()).trim(), "WhatsApp", "ícono + «WhatsApp» (15/11)");
      assert.match(await fab.getAttribute("aria-label"), /Hablar con una persona por WhatsApp/);
      const fb = await fab.boundingBox(), nav = await p.locator(".bnav").boundingBox(), cart = await p.locator(".shead [data-cart]").boundingBox();
      assert.ok(fb.height >= 44, `${scheme}: el botón mide ${fb.height}px`);
      const hit = (a, c) => a.x < c.x + c.width && c.x < a.x + a.width && a.y < c.y + c.height && c.y < a.y + a.height;
      assert.equal(hit(fb, nav), false, `${scheme}: no tapa la barra de abajo`);
      assert.equal(hit(fb, cart), false, `${scheme}: no tapa el carrito`);
      assert.equal(await fab.evaluate((e) => getComputedStyle(e).position), "fixed");
      assert.equal(await fab.evaluate((e) => getComputedStyle(e).backgroundColor), "rgb(21, 128, 61)", "verde WhatsApp que se lee con letra blanca");
      assert.match(waText(await fab.getAttribute("href")), /quiero hablar con una persona/);
      assert.ok((await fab.getAttribute("href")).startsWith("https://wa.me/59170000000"));
      // Ficha → «Preguntar por este» con el nombre del producto.
      await p.evaluate(() => document.querySelector('[data-det="nf"]').click());
      const pre = p.locator("#modal [data-preguntar]");
      await pre.waitFor();
      assert.match(waText(await pre.getAttribute("href")), /Quiero preguntar por Netflix \(Bs 35/);
      assert.ok((await pre.boundingBox()).height >= 44);
      assert.equal(await fab.isVisible(), false, "con la ficha abierta el botón fijo no estorba");
      await p.locator("#modal [data-add]").click();
      assert.match(waText(await fab.getAttribute("href")), /Tengo en el carrito:\n• Netflix \(Bs 35\)/, "el mensaje ya dice qué tiene en el carrito");
      // 2-4. Pago del invitado.
      await p.locator(".bnav [data-cart]").click();
      await p.locator('#drawer [data-step="2"]').click();
      await p.locator("#drawer .qrg-steps").waitFor();
      assert.equal(await p.locator("#drawer details.qrg-how").count(), 0, "los pasos ya no van en un desplegable");
      assert.equal(await p.locator("#drawer .qrg-steps li").count(), 3);
      for (const li of await p.locator("#drawer .qrg-steps li").all()) assert.ok(await li.isVisible(), `${scheme}: paso visible`);
      const num = await p.locator("#drawer .qrg-steps li").first().evaluate((e) => parseFloat(getComputedStyle(e, "::before").fontSize));
      assert.ok(num >= 18, `número de paso grande (${num}px)`);
      const paid = p.locator('#drawer [data-gsent="paid"]'), ask = p.locator('#drawer [data-gsent="ask"]');
      assert.match(waText(await paid.getAttribute("href")), /Quiero pedir:\n• 1 × Netflix \(Bs 35\)\nTotal: Bs 35\nYa pagué Bs 35 por QR, te mando la foto del comprobante 👇/);
      assert.match(waText(await ask.getAttribute("href")), /Total: Bs 35\nQuiero pagar Bs 35/);
      assert.match(await p.locator("#drawer").innerText(), /Tus datos quedan en Mis cuentas; si compraste sin cuenta, te los pasamos por WhatsApp/);
      const usdt = p.locator("#drawer .dp-usdt summary");
      assert.match(await usdt.innerText(), /fuera de Bolivia\? Pagá con USDT \(≈ 3\.34 USDT\)/, "35 / 10,5 = 3,34 USDT redondeado hacia arriba");
      // «📤 Mandar a quien paga»: con imagen (oscuro) o, si el celular no puede, WhatsApp con el link del QR (claro).
      await p.locator("#drawer [data-qrshare]").click();
      if (scheme === "dark") {
        await p.waitForFunction(() => window.__shared.length === 1);
        const sh = (await p.evaluate(() => window.__shared))[0];
        assert.equal(sh.type, "image/png");
        assert.match(sh.text, /Netflix[\s\S]*Bs 35[\s\S]*foto del comprobante/);
      } else {
        await p.waitForFunction(() => window.__opened.length === 1);
        const u = (await p.evaluate(() => window.__opened))[0];
        assert.ok(u.startsWith("https://wa.me/?text="));
        assert.match(waText(u), /Netflix[\s\S]*Bs 35[\s\S]*foto del comprobante[\s\S]*\/api\/settings\/qr/);
      }
      let m = await measure(p, "#drawer");
      assert.equal(m.over, false, `${scheme}: pago sin desborde`); assert.deepEqual(m.small, [], `${scheme}: pago con botones de 44 px`); assert.deepEqual(m.tiny, [], `${scheme}: letra ≥ 12 px`);
      // «Ya pagué» → «3 · Listo» y el carrito queda vacío (ya pidió por WhatsApp).
      await paid.click();
      await p.locator("#drawer .dp-done").waitFor();
      const done = await p.locator("#drawer").innerText();
      assert.match(done, /3 · Listo/);
      assert.match(done.replace(/\s+/g, " "), /Ahora mandá la foto del comprobante en el chat\. Te pasamos tus datos apenas lo veamos \(de 8 a 22 h\)/);
      assert.equal(await p.locator('#drawer .steps span.on').count(), 3);
      assert.equal(await p.locator("#cartN").innerText(), "0");
      m = await measure(p, "#drawer");
      assert.equal(m.over, false); assert.deepEqual(m.small, []); assert.deepEqual(m.tiny, []);
      assert.deepEqual(errs, []);
      // Fuera de horario: lo dice el botón (sin prometer que alguien contesta ya).
      await p.clock.setFixedTime(new Date(LPZ(6)));
      await p.goto("about:blank"); await p.goto(base + "/tienda/#inicio");
      // 15/11: el botón dice solo «WhatsApp»; el horario va en su descripción (y en la barra de arriba).
      await p.locator("#hablar").waitFor();
      await p.waitForFunction(() => /Te respondemos desde las 8:00/.test(document.querySelector("#hablar")?.getAttribute("aria-label") ?? ""));
      assert.equal((await p.locator("#hablar").innerText()).trim(), "WhatsApp");
      assert.ok((await p.locator("#hablar").boundingBox()).height >= 44);
      await ctx.close();
    }
    app.store.catalog.updateSettings(o0(), { backgroundColor: "#090e1d" });
  });

  test("solo en la tienda: no en GaboHub; en la página de un revendedor, con SU WhatsApp", { timeout: 60_000 }, async () => {
    const { ctx, p, errs } = await newPage("dark");
    await p.goto(base + "/hub");
    await p.waitForFunction(() => !document.querySelector("#sout .skeleton"));
    assert.equal(await p.locator("#hablar").count(), 0, "GaboHub no tiene el botón");
    await p.goto(base + "/r/rosa-tv");
    await p.locator("#hablar").waitFor();
    assert.ok((await p.locator("#hablar").getAttribute("href")).startsWith("https://wa.me/59171111111"), "el WhatsApp de Rosa, no el de la tienda");
    assert.match(waText(await p.locator("#hablar").getAttribute("href")), /Rosa TV/);
    assert.deepEqual(errs, []);
    await ctx.close();
  });

  test("con cuenta: rechazado arriba, «antes de las HH:MM» desde que subió, «se demoró» con el número, se actualiza sola al aprobar y «🧾 Recibo»", { timeout: 180_000 }, async () => {
    const s = app.store;
    s.chats.updateBotSettings(o0(), { humanHours: { from: 0, to: 24 } }); // siempre atendiendo: la prueba no depende de la hora real
    const mk = () => { const o = s.orders.create(as(ana), { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr" }); s.orders.submitEvidence(as(ana), o.id, { fileRef: `up/${o.id}.jpg`, declaredReference: o.id, hash: o.id }); return o; };
    const rej = mk(); s.orders.rejectPayment(o0(), rej.id, "El comprobante es de otro monto");
    const okd = mk(); s.orders.approvePayment(o0(), okd.id, { confirmedReference: okd.id });
    const rev1 = mk();
    const sentAt = s.engine.s.orders[rev1.id].evidence.submittedAt;
    assert.equal((await post(`/api/admin/customers/${ana.id}/login-pin`, { pin: "4321" }, ock)).status, 200);
    const ck = (await post("/api/auth/customer/pin", { phone: "70000021", pin: "4321" })).headers.get("set-cookie").split(";")[0];
    const { ctx, p, errs } = await newPage("dark");
    const [n, v] = ck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    await p.clock.install({ time: new Date(sentAt + 10 * 60_000) }); // la clienta mira 10 minutos después de subir
    await p.goto(base + "/tienda/#cuentas");
    await p.waitForFunction(() => /Historial de pedidos/.test(document.body.innerText));
    const until = async (re, ms = 8000) => { for (let t = 0; t < ms; t += 200) { if (re.test(await p.evaluate(() => document.body.innerText))) return true; await new Promise((r) => setTimeout(r, 200)); } assert.fail(`no apareció ${re}`); };
    // 6. Rechazado arriba de todo, antes que el pedido en revisión y que los servicios.
    const order = await p.evaluate(() => [...document.querySelectorAll("#sout .dp-rej, #sout .svc, #sout .msum")].map((e) => e.className.split(" ").find((c) => ["dp-rej", "svc", "msum"].includes(c))));
    assert.equal(order[0], "dp-rej", "el rechazo va primero");
    const rejBox = await p.locator(".dp-rej").innerText();
    assert.match(rejBox, /No pudimos aprobar tu pago/);
    assert.match(rejBox, /Motivo: El comprobante es de otro monto/);
    assert.match(rejBox, /No pagues de nuevo: escribinos con tu comprobante/);
    assert.ok(waText(await p.locator(".dp-rej a.dp-wa").getAttribute("href")).includes(rej.id), "el WhatsApp ya lleva el número de pedido");
    // 7. Las tarjetas dicen el producto; el historial no muestra «ord_…».
    const card = await p.locator("#sout .svc .top b").first().innerText();
    assert.equal(card, "Netflix · Bs 35");
    for (const t of await p.locator("#sout .dp-hist > span:first-child").allInnerTexts()) {
      assert.doesNotMatch(t, /ord_/, "el historial no muestra el código interno");
      assert.match(t, /^Compra del \d{2}\/\d{2} · Netflix/);
    }
    // 5. «antes de las HH:MM» desde que subió el comprobante (no desde que mira).
    const txt = await p.locator("#sout").innerText();
    assert.ok(txt.includes(`antes de las ${hhmm(sentAt + 30 * 60_000)}`), `dice «antes de las ${hhmm(sentAt + 30 * 60_000)}»`);
    assert.match(txt, /Estamos verificando tu pago/);
    assert.match(txt, /Tus datos quedan en Mis cuentas; si compraste sin cuenta, te los pasamos por WhatsApp/);
    assert.doesNotMatch(txt, /nunca mandamos contraseñas por WhatsApp/, "sin contradicciones");
    let m = await measure(p, "#sout");
    assert.equal(m.over, false); assert.deepEqual(m.small, []); assert.deepEqual(m.tiny, []);
    // Pasan 21 minutos más (31 desde que subió): se demoró → WhatsApp con el número de pedido.
    await p.clock.fastForward("21:00");
    await p.clock.runFor(16_000);
    await until(/Se demoró más de lo normal/);
    const late = p.locator(".dp-late a.dp-wa");
    assert.ok(waText(await late.getAttribute("href")).includes(rev1.id));
    // La tienda aprueba: «Mis cuentas» se actualiza sola (cada 15 s), sin tocar nada.
    assert.equal((await post(`/api/admin/orders/${rev1.id}/approve`, { confirmedReference: rev1.id }, ock)).status, 200);
    await p.clock.runFor(16_000);
    await until(/Aprobamos tu pago/);
    assert.equal(await p.locator("#sout .svc .spill.sp-warn", { hasText: "En revisión" }).count(), 0);
    // 🧾 Recibo de una compra pagada.
    await p.locator("[data-recibo]").first().click();
    const rec = await p.locator("#modal .dp-recibo").innerText();
    for (const x of ["Comprobante de compra", "Netflix", "Bs 35", "QR", "Pagado"]) assert.ok(rec.includes(x), `el recibo dice «${x}»`);
    assert.doesNotMatch(await p.locator("#modal").innerText(), /factura/i, "no dice «factura»");
    const [dl] = await Promise.all([p.waitForEvent("download"), p.locator("#modal [data-recibodl]").click()]);
    assert.match(dl.suggestedFilename(), /^Recibo-\d{2}-\d{2}-\d{4}\.png$/);
    m = await measure(p, "#modal");
    assert.equal(m.over, false); assert.deepEqual(m.small, []); assert.deepEqual(m.tiny, []);
    assert.deepEqual(errs, []);
    await ctx.close();
    s.chats.updateBotSettings(o0(), { humanHours: { from: 8, to: 22 } });
  });
});
