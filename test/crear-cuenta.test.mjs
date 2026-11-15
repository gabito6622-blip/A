// «Crear mi cuenta» sin códigos (15/11/2026). El dueño: «alguna opción para que mis clientes creen su cuenta fácil».
// Nombre + número de WhatsApp + PIN de 4 números que elige el cliente. Datos ficticios; WhatsApp cortado.
//  1. API: crea un cliente común (precio final, sin avisos si no los pidió), deja la sesión abierta y después entra con
//     su número y PIN. Un número que ya es de alguien (aunque esté escrito distinto) no crea nada ni abre sesión.
//     PIN débil, nombre o número inválidos → error claro. Límite por IP.
//  2. Pantalla: desde el pago del carrito, «🆕 Crear mi cuenta» → queda adentro y sigue con el pago en la tienda.
//     Los PIN distintos avisan sin borrar el nombre. «Soy nuevo» del ingreso abre lo mismo. 360 px, botones de 44 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-signup-"));
  // Como hoy en la tienda real: sin WhatsApp oficial que mande códigos (sin otpSender).
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const ck = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
  await post("/api/admin/products", { id: "disney", name: "Disney+ sin ESPN", kind: "profile", durationDays: 30, price: 1700, published: true, category: "Streaming" }, ck);
  await post("/api/admin/suppliers", { id: "prov", name: "Prov", active: true }, ck);
  await post("/api/admin/accounts", { productId: "disney", supplierId: "prov", email: "dis@ficticio.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 120 * DAY, cost: 0, profiles: [1, 2].map((i) => ({ label: `Perfil ${i}` })) }, ck);
  await post("/api/admin/settings", { storeName: "Gabriel Store", whatsapp: "59170000000", layout: "ticket" }, ck);
  return { dir, app, base, post, ck };
}

test("API: crear cuenta con nombre, número y PIN; número repetido, PIN débil y límite", async () => {
  const { dir, app, base, post, ck } = await setup();
  try {
    // Un cliente que ya existe (cargado por la tienda) con el número escrito de otra forma.
    await post("/api/admin/customers", { name: "Ya Existe", phone: "+59170012345" }, ck);
    const before = Object.keys(app.store.engine.s.customers).length;
    const r = await post("/api/auth/customer/signup", { name: "  Ana   Quispe ", phone: "71234567", pin: "4826" });
    assert.equal(r.status, 200);
    const sc = r.headers.get("set-cookie");
    assert.ok(sc, "queda adentro");
    const me = await (await fetch(base + "/api/me", { headers: { cookie: sc.split(";")[0] } })).json();
    assert.equal(me.loggedIn, true);
    const c = Object.values(app.store.engine.s.customers).find((x) => x.name === "Ana Quispe");
    assert.ok(c, "nombre prolijo");
    assert.equal(c.phone, "+59171234567", "agrega el +591 si el número es boliviano");
    assert.equal(c.kind, "customer");
    assert.equal(c.priceGroupId, "final");
    assert.equal(c.whatsappConsent, false, "sin avisos si no los pidió");
    assert.equal(Object.keys(app.store.engine.s.customers).length, before + 1);
    // Después entra con su número y PIN.
    assert.equal((await post("/api/auth/customer/pin", { phone: "+591 71234567", pin: "4826" })).status, 200);
    assert.equal((await post("/api/auth/customer/pin", { phone: "+591 71234567", pin: "1111" })).status, 401);
    // Número que ya es de alguien (escrito sin +591): no crea ni abre sesión.
    const dup = await post("/api/auth/customer/signup", { name: "Otra Persona", phone: "70012345", pin: "5937" });
    assert.equal(dup.status, 409);
    assert.match((await dup.json()).message ?? "", /Ese número ya tiene una cuenta\. Entrá con tu PIN o tocá «Olvidé mi PIN»/);
    assert.equal(dup.headers.get("set-cookie"), null, "no abre sesión en una cuenta ajena");
    assert.equal(Object.keys(app.store.engine.s.customers).length, before + 1);
    // Errores claros.
    const err = async (body) => { const x = await post("/api/auth/customer/signup", body); return [x.status, (await x.json()).message]; };
    assert.deepEqual(await err({ name: "Beto", phone: "+59176543210", pin: "1234" }), [400, "Elegí un PIN más difícil: no 1234 ni 4 números iguales"]);
    assert.deepEqual(await err({ name: "Beto", phone: "+59176543210", pin: "7777" }), [400, "Elegí un PIN más difícil: no 1234 ni 4 números iguales"]);
    assert.deepEqual(await err({ name: "Beto", phone: "+59176543210", pin: "12a4" }), [400, "El PIN tiene que ser de 4 números"]);
    assert.deepEqual(await err({ name: "", phone: "+59176543210", pin: "4826" }), [400, "Escribí tu nombre"]);
    assert.equal((await err({ name: "Beto", phone: "123", pin: "4826" }))[0], 400);
    // Límite: 5 cuentas nuevas por hora desde el mismo lugar (ya van 1 creada + 1 repetida = 2 contadas).
    const codes = [];
    for (let i = 0; i < 4; i++) codes.push((await post("/api/auth/customer/signup", { name: `Persona ${i}`, phone: `+5917654321${i}`, pin: "4826" })).status);
    assert.deepEqual(codes, [200, 200, 200, 429]);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("pantalla: «Crear mi cuenta» desde el pago y desde «Soy nuevo» (360 px)", { timeout: 180_000, skip: !chromium && "sin navegador" }, async () => {
  const { dir, app, base } = await setup();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, timezoneId: "America/La_Paz" });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/tienda/#inicio");
    await p.waitForFunction(() => document.querySelector(".tk"));
    // «Soy nuevo» del ingreso → «Crear mi cuenta».
    await p.locator(".shead [data-login], #accBtn").first().click();
    await p.locator('#login [data-loginstep="signup"]').click();
    await p.locator('#login[data-step="signup"]').waitFor();
    assert.match(await p.locator("#modal h2").innerText(), /Crear mi cuenta/);
    await p.locator("#modal [data-close]").first().click();
    // Desde el pago del carrito.
    await p.locator(".tk [data-add]").first().click();
    await p.locator(".bnav [data-cart]").click();
    await p.locator('#drawer [data-step="2"]').click();
    await p.locator('#drawer [data-loginstep="signup"]').click();
    const f = p.locator('#login[data-step="signup"]');
    await f.waitFor();
    for (const h of await p.locator("#modal button, #modal input:not([type=checkbox]), #modal a.sbtn").evaluateAll((l) => l.filter((x) => x.getBoundingClientRect().height > 0).map((x) => x.getBoundingClientRect().height))) assert.ok(h >= 44, `control de ${h}px`);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    assert.equal(await f.locator('[name="consent"]').isChecked(), false, "la casilla de avisos no viene marcada");
    // PIN distintos: avisa y no borra el nombre.
    await f.locator('[name="name"]').fill("Rosa Mamani");
    await f.locator('[name="phone"]').fill("+591 68887766");
    await f.locator('[name="pin"]').fill("5293");
    await f.locator('[name="pin2"]').fill("5294");
    await f.locator('[type="submit"]').click();
    await p.locator("#modal .err").waitFor();
    assert.match(await p.locator("#modal .err").innerText(), /Los dos PIN no coinciden/);
    assert.equal(await p.locator('#login [name="name"]').inputValue(), "Rosa Mamani");
    // Bien: queda adentro y sigue con el pago en la tienda.
    await p.locator('#login [name="phone"]').fill("+591 68887766");
    await p.locator('#login [name="pin"]').fill("5293");
    await p.locator('#login [name="pin2"]').fill("5293");
    await p.locator('#login [type="submit"]').click();
    await p.locator("#drawer #checkout").waitFor();
    assert.match((await p.locator("#drawer").innerText()).replace(/\s+/g, " "), /Cómo sigue: pagás, subís acá la foto del comprobante/);
    const c = Object.values(app.store.engine.s.customers).find((x) => x.name === "Rosa Mamani");
    assert.equal(c?.phone, "+59168887766");
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
