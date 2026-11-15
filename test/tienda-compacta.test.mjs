// Tienda más compacta y clara en el celular (pedido del dueño, 15/11/2026). Datos ficticios; WhatsApp cortado.
//  1. Portada compacta a 390 px: el buscador y el primer plan aparecen antes (sin cambiar colores ni tarjetas).
//  2. Botón flotante: ícono + «WhatsApp», ancho justo y 44 px; al desplazarse nunca tapa precios, «Agregar» ni la barra.
//  3. Perfiles: «1 perfil asignado · <duración del plan elegido>» y «Qué recibís» explica que se entra al perfil indicado
//     en la entrega y que la web no le cambia el nombre.
//  4. A pedido (Netflix): «Consultar disponibilidad» antes de todo, con plan, duración y precio en el mensaje.
//  5. Carrito mezclado (Disney+ sin ESPN hay · Netflix a pedido): se paga solo lo disponible; Netflix queda en el carrito
//     hasta «Ya me confirmaron que hay». Invitado: «¿Cómo querés comprar?» (tienda vs WhatsApp). Con cuenta: el pedido
//     lleva solo Disney+ y el comprobante se sube en la tienda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d4944415478da63f8ffff3f0005fe02fea7d6a4c40000000049454e44ae426082", "hex");
const DAY = 864e5;
const waText = (href) => decodeURIComponent((href.split("text=")[1] ?? "").replace(/\+/g, " "));

test("tienda compacta: portada, botón WhatsApp, perfiles, a pedido y carrito separado (390 px)", { timeout: 300_000, skip: !chromium && "sin navegador" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-compacta-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, otpSender: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const ck = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
  const P = (id, name, kind, d, price, extra = {}) => post("/api/admin/products", { id, name, kind, durationDays: d, price, published: true, category: "Streaming", description: `${name}.`, ...extra }, ck);
  await P("netflix", "Netflix Premium HD 4K", "profile", 30, 4000);
  await P("netflix-3m", "Netflix Premium HD 4K · 3 meses", "profile", 90, 12000);
  await P("disney", "Disney+ sin ESPN", "profile", 30, 1700);
  await P("disney-3m", "Disney+ sin ESPN · 3 meses", "profile", 90, 4500);
  await P("chatgpt", "ChatGPT Premium", "full_account", 30, 4000);
  for (let i = 0; i < 6; i++) await P(`extra${i}`, `Servicio de prueba ${i + 1}`, "profile", 30, 1000 + i * 100);
  await post("/api/admin/suppliers", { id: "prov", name: "Prov", active: true }, ck);
  await post("/api/admin/accounts", { productId: "disney", supplierId: "prov", email: "dis@ficticio.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 120 * DAY, cost: 0, profiles: [1, 2, 3].map((i) => ({ label: `Perfil ${i}` })) }, ck);
  await post("/api/admin/accounts", { productId: "chatgpt", supplierId: "prov", email: "gpt@ficticio.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 120 * DAY, cost: 0, profiles: [{ label: "Cuenta" }] }, ck);
  for (let i = 0; i < 6; i++) await post("/api/admin/accounts", { productId: `extra${i}`, supplierId: "prov", email: `x${i}@ficticio.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 120 * DAY, cost: 0, profiles: [{ label: "Perfil 1" }] }, ck);
  await post("/api/admin/settings", { storeName: "Gabriel Store", whatsapp: "59170000000", layout: "ticket", alwaysAvailable: true, backgroundColor: "#070b16", accentColor: "#fcc42d", heroTitle: "Todo tu entretenimiento,", heroHighlight: "en un solo lugar.", heroText: "Netflix, Disney+, Prime Video, HBO Max, Spotify y más. Elegí tu plan, pagá con QR y te lo activamos por WhatsApp. Soporte real todo el mes.", announcement: "Atención: 08:00 a 22:00" }, ck);
  await post("/api/admin/settings/qr", { contentBase64: PNG.toString("base64") }, ck);
  await post("/api/admin/settings/banner", { contentBase64: PNG.toString("base64") }, ck);
  const cust = await (await post("/api/admin/customers", { name: "Clienta Prueba", phone: "+59162000077" }, ck)).json();
  const { pin } = await (await post(`/api/admin/customers/${cust.id}/login-pin`, {}, ck)).json();
  const cck = (await post("/api/auth/customer/pin", { phone: "+59162000077", pin })).headers.get("set-cookie").split(";")[0];

  const b = await chromium.launch();
  const newPage = async (cookie) => {
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, timezoneId: "America/La_Paz" });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    if (cookie) { const [n, v] = cookie.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]); }
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/tienda/#inicio");
    await p.waitForFunction(() => !document.querySelector("#sout .skeleton") && document.querySelector(".tk"));
    return { ctx, p, errs };
  };
  const row = (p, n) => p.locator(".tk", { has: p.locator(`h3:text-is("${n}")`) });
  try {
    // ---------- Invitado ----------
    const { ctx, p, errs } = await newPage();
    // 1. Portada compacta.
    const pos = await p.evaluate(() => ({ q: document.querySelector("#q").getBoundingClientRect().top, tk: document.querySelector(".tk").getBoundingClientRect().top, h1: parseFloat(getComputedStyle(document.querySelector(".tkhero h1")).fontSize), bg: getComputedStyle(document.body).backgroundColor }));
    assert.ok(pos.q < 360, `buscador a ${pos.q}px (antes ~450)`);
    assert.ok(pos.tk < 540, `primer plan a ${pos.tk}px (antes ~646)`);
    assert.ok(pos.h1 <= 26, `título de portada de ${pos.h1}px`);
    // 2. Botón flotante.
    const fab = p.locator("#hablar");
    assert.equal((await fab.innerText()).trim(), "WhatsApp");
    const fb = await fab.boundingBox();
    assert.ok(Math.round(fb.height) === 44, `alto ${fb.height}`);
    assert.ok(fb.width < 160, `ancho justo al texto (${fb.width}px)`);
    assert.match(waText(await fab.getAttribute("href")), /quiero hablar con una persona/);
    const H = await p.evaluate(() => document.documentElement.scrollHeight);
    let visible = 0, tapa = [];
    for (let y = 0; y < H; y += 89) {
      await p.evaluate((y) => window.scrollTo({ top: y, behavior: "instant" }), y);
      await p.waitForTimeout(220);
      const r = await p.evaluate(() => {
        const a = document.getElementById("hablar"), v = getComputedStyle(a).visibility !== "hidden", ar = a.getBoundingClientRect();
        if (!v) return { v, hit: [] };
        return { v, hit: [...document.querySelectorAll("[data-add], .tkbtn, .ccmore, .tkend > b, .ccopt, .bnav")].filter((x) => { const b = x.getBoundingClientRect(); return b.width && b.height && b.left < ar.right && b.right > ar.left && b.top < ar.bottom && b.bottom > ar.top; }).map((x) => x.className) };
      });
      if (r.v) visible++;
      if (r.hit.length) tapa.push([y, r.hit]);
    }
    assert.deepEqual(tapa, [], "el botón nunca queda encima de un precio, «Agregar» ni la barra");
    assert.ok(visible > 0, "y se ve en algún momento al desplazarse");
    await p.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));

    // 3. Perfiles con la duración del plan elegido.
    assert.match(await row(p, "Disney+ sin ESPN").innerText(), /1 perfil asignado · 1 mes/);
    assert.doesNotMatch(await p.locator("#sout").innerText(), /con tu nombre/);
    await row(p, "Disney+ sin ESPN").locator(".ccopt", { hasText: "3 meses" }).click();
    await p.waitForFunction(() => /1 perfil asignado · 3 meses/.test([...document.querySelectorAll(".tk")].find((t) => /Disney\+ sin ESPN/.test(t.querySelector("h3")?.textContent ?? ""))?.innerText ?? ""));
    await row(p, "Disney+ sin ESPN").locator(".ccopt", { hasText: "Mensual" }).click();
    assert.match(await row(p, "ChatGPT Premium").innerText(), /Acceso con correo y contraseña · 1 mes/, "lo que no es perfil no cambia");
    // Ficha de Disney+ (hay): «Qué recibís» explica el perfil indicado; «Preguntar por este» con plan y precio.
    await row(p, "Disney+ sin ESPN").locator(".ccmore").click();
    let f = p.locator(".ccficha"); await f.waitFor();
    let ft = (await f.innerText()).replace(/\s+/g, " ");
    assert.match(ft, /1 perfil asignado/);
    assert.match(ft, /En la entrega te decimos cuál es tu perfil de Disney\+ \(por ejemplo «Perfil 3»\): entrá siempre a ese\. La web no le cambia el nombre\./);
    assert.match(ft, /En la tienda: con saldo aparece al instante en «Mis cuentas»; con QR, apenas revisamos tu comprobante\. Sin cuenta: te lo pasamos por WhatsApp\./);
    assert.equal(await f.locator("[data-dispo]").count(), 0, "lo que hay no pide consultar");
    assert.match(waText(await p.locator("#modal [data-preguntar]").getAttribute("href")), /Disney\+ sin ESPN \(Bs 17 · 1 mes\)/);
    await f.locator('[data-add="disney"]').click();
    // 4. Ficha de Netflix (a pedido): «Consultar disponibilidad» primero.
    await row(p, "Netflix Premium HD 4K").locator(".ccmore").click();
    f = p.locator(".ccficha"); await f.waitFor();
    const btns = await f.locator(".ccfbtns > *").allInnerTexts();
    assert.equal(btns[0].trim(), "Consultar disponibilidad", `primero se consulta (${btns.join(" | ")})`);
    assert.match(waText(await f.locator("[data-dispo]").getAttribute("href")), /Antes de pagar, ¿tienen disponible\?\n• Netflix Premium HD 4K · 1 mes · Bs 40/);
    assert.equal(await p.locator("#modal [data-preguntar]").count(), 0, "no se repite «Preguntar por este»");
    for (const h of await f.locator("button, a.sbtn").evaluateAll((l) => l.filter((x) => x.getBoundingClientRect().height > 0).map((x) => x.getBoundingClientRect().height))) assert.ok(h >= 44, `botón de ${h}px en la ficha`);
    await f.locator('[data-add="netflix"]').click();

    // 5. Carrito mezclado (invitado).
    await p.locator(".bnav [data-cart]").click();
    const dr = p.locator("#drawer");
    await dr.locator(".cwait").waitFor();
    assert.match(await dr.locator(".cwait").innerText(), /Netflix Premium HD 4K[\s\S]*No se cobra todavía/);
    assert.match(waText(await dr.locator(".cwaitask").getAttribute("href")), /• Netflix Premium HD 4K · 1 mes · Bs 40/);
    assert.match(await dr.innerText(), /Total a pagar ahora\s*Bs 17/);
    await dr.locator('[data-step="2"]').click();
    await dr.locator(".cmodos").waitFor();
    const pay = (await dr.innerText()).replace(/\s+/g, " ");
    assert.match(pay, /Netflix Premium HD 4K queda en tu carrito: no se cobra ahora/);
    assert.match(pay, /En la tienda, con tu cuenta.*subís el comprobante acá.*el acceso aparece en «Mis cuentas»/);
    assert.match(pay, /Sin cuenta, por WhatsApp.*mandás el comprobante por WhatsApp.*te pasamos el acceso por WhatsApp/);
    assert.match(pay, /Pagá Bs 17 con este QR/);
    const paidMsg = waText(await dr.locator('[data-gsent="paid"]').getAttribute("href"));
    assert.match(paidMsg, /• 1 × Disney\+ sin ESPN \(Bs 17\)\nTotal: Bs 17/);
    assert.doesNotMatch(paidMsg, /Netflix/, "lo a pedido no va en el pago");
    const small = await dr.locator("button, a.sbtn").evaluateAll((l) => l.filter((x) => { const h = x.getBoundingClientRect().height; return h > 0 && h < 44 && !x.closest(".cupx"); }).map((x) => x.textContent.trim().slice(0, 30)));
    assert.deepEqual(small, []);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.deepEqual(errs, []);
    await ctx.close();

    // ---------- Con cuenta: el pedido lleva solo lo disponible y Netflix queda en el carrito ----------
    const c2 = await newPage(cck);
    await row(c2.p, "Disney+ sin ESPN").locator("[data-add]").click();
    await row(c2.p, "Netflix Premium HD 4K").locator("[data-add]").click();
    await c2.p.locator(".bnav [data-cart]").click();
    const d2 = c2.p.locator("#drawer");
    await d2.locator('[data-step="2"]').click();
    await d2.locator("#checkout").waitFor();
    assert.match((await d2.innerText()).replace(/\s+/g, " "), /Cómo sigue: pagás, subís acá la foto del comprobante y tocás «Finalizar pedido»\. No hace falta mandarlo por WhatsApp\. Apenas lo revisamos, el acceso aparece en «Mis cuentas»/);
    await d2.locator('input[name="pm"][value="qr"]').check();
    await d2.locator('input[name="file"]').setInputFiles({ name: "comprobante.png", mimeType: "image/png", buffer: PNG });
    await d2.locator('input[name="ref"]').fill("998877");
    await d2.locator('[type="submit"]').click();
    await c2.p.waitForFunction(() => /3 · Listo/.test(document.querySelector("#drawer")?.innerText ?? "") && document.querySelector("#drawer .steps span:nth-child(3).on"));
    const orders = Object.values(app.store.engine.s.orders).filter((o) => o.customerId === cust.id);
    assert.equal(orders.length, 1);
    assert.deepEqual(orders[0].items.map((i) => [i.productId, i.qty]), [["disney", 1]], "el pedido lleva solo Disney+");
    assert.equal(orders[0].total, 1700);
    const left = await c2.p.evaluate(() => JSON.parse(localStorage.getItem("gs-cart-store") || "[]"));
    assert.deepEqual(left.map((l) => l.productId), ["netflix"], "Netflix sigue en el carrito para consultarlo");
    // «Ya me confirmaron que hay»: entra al cobro.
    await c2.p.locator("#drawer [data-close]").first().click();
    await c2.p.locator(".bnav [data-cart]").click();
    await d2.locator("[data-cartok]").click();
    await c2.p.waitForFunction(() => /Total\s*Bs 40/.test(document.querySelector("#drawer")?.innerText ?? "") && !document.querySelector("#drawer .cwait"));
    assert.equal((await d2.locator('[data-step="2"]').innerText()).trim(), "Continuar al pago");
    assert.deepEqual(c2.errs, []);
    await c2.ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
