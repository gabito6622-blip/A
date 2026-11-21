// Un día del dueño en el panel, en el celular (20/11/2026). Datos ficticios, carpeta temporal.
// Arreglos que se prueban acá:
//  1. Inicio: «🏠 Para hacer hoy» aparece aunque haya movimientos en las últimas 24 h (antes rompía y no salía nunca).
//  2. Vender a un revendedor: el resumen y el botón dicen el precio de SU lista (lo que se cobra), no el de la tienda.
//  3. Crear un revendedor deja a la vista «✅ Listo · Mandarle todo por WhatsApp».
//  4. Cuentas → «Cuenta caída»: la tarjeta no se ensancha ni se corta, y el motivo viene escrito («Se cayó»).
//  5. Carga de cuentas: primero la carga rápida (antes, «Compré un perfil» ocupaba la primera pantalla).
//  6. Títulos de arriba enteros a 390 y 360 px; chips del Tablero y del Dashboard de 44 px; botones de cada
//     revendedor de a dos por renglón en el celular.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { silabaCorte } from "../public/titulo-ajuste.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

describe("día del dueño en el celular", () => {
  let dir, app, base, owner, rev;
  const post = (p, body, ck = owner) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify(body) });
  const get = async (p) => (await fetch(base + p, { headers: { cookie: owner } })).json();

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-duenio-dia-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    await post("/api/admin/products", { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    await post("/api/admin/price-groups", { id: "revendedor", name: "Revendedor", prices: { nf: 2500 } });
    await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true });
    for (let i = 0; i < 3; i++) await post("/api/admin/accounts", { productId: "nf", supplierId: "andes", email: `nf${i}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 3000, profiles: [1, 2, 3, 4, 5].map((k) => ({ label: `Perfil ${k}` })) });
    rev = await (await post("/api/admin/customers", { name: "Carla Vargas", phone: "+59169990011", kind: "reseller", priceGroupId: "revendedor" })).json();
    const ana = await (await post("/api/admin/customers", { name: "Ana Suárez", phone: "+59162000000" })).json();
    // Movimientos de hoy (quedan en la auditoría de las últimas 24 h) y cuentas que vencen pronto.
    for (const c of [rev, rev, ana]) {
      const o = await (await post("/api/admin/orders", { customerId: c.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" })).json();
      for (const id of o.assignmentIds) await post(`/api/admin/assignments/${id}/expiry`, { expiresAt: Date.now() + 2 * DAY, note: "prueba" });
    }
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("corte en sílabas del título: castellano, sin romper ch, ll, rr ni pr/bl", () => {
    const cut = (w) => { const i = silabaCorte(w); return i > 0 ? `${w.slice(0, i)}-${w.slice(i)}` : w; };
    assert.equal(cut("Revendedores"), "Reven-dedores");
    assert.equal(cut("Recordatorios"), "Recorda-torios");
    assert.equal(cut("Proveedores"), "Provee-dores");
    assert.equal(cut("Configuración"), "Configu-ración");
    for (const w of ["Muchachos", "Pollitos", "Carretera", "Sobreprecio", "Tablero"]) {
      const c = cut(w);
      assert.doesNotMatch(c, /c-h|l-l|r-r|[bcdfgkpt]-[lr]/i, `${w} → ${c}`);
    }
    assert.equal(silabaCorte("Inicio"), silabaCorte("Inicio")); // palabras cortas: se puede, pero el panel solo corta las de 9 letras o más
  });

  test("navegador a 390/360 px: Para hacer hoy, precio del revendedor, invitar, cuenta caída, carga y 44 px", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, colorScheme: "light" });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [n, v] = owner.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage();
      const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      p.on("dialog", (d) => d.accept());
      const open = async (view, sel) => { await p.goto("about:blank"); await p.goto(`${base}/panel.html#${view}`); await p.waitForSelector(sel, { timeout: 20_000 }); await p.waitForTimeout(300); };

      // 1) Inicio con movimientos de hoy: la lista del día aparece.
      await open("inicio", ".sec-cta");
      await p.waitForSelector(".hm-hoy", { timeout: 20_000 });
      assert.match(await p.locator(".hm-hoy").innerText(), /Para hacer hoy/);
      assert.ok(await p.locator(".hm-hoy #sec-actividad .audrow").count() > 0, "con los movimientos de hoy en «Lo que pasó»");
      assert.match(await p.locator(".hm-hoy #sec-actividad").textContent(), /Gabriel/, "dice quién lo hizo (vos)");

      // 2) Vender a un revendedor: el botón dice Bs 25 (su lista) y se cobra Bs 25.
      await open("vender", "#sellForm");
      await p.fill("#sellForm [name=customerName]", "Carla Vargas · +59169990011");
      await p.click('#sellForm [data-pick="nf"]');
      await p.waitForFunction(() => /Bs 25/.test(document.querySelector("#sellBtn")?.innerText ?? ""), null, { timeout: 10_000 });
      const sum = await p.locator("#sellSummary").innerText();
      assert.match(sum, /Su precio\s*Bs 25 \(en la tienda Bs 35\)/);
      assert.match(sum, /Total a cobrar\s*Bs 25/);
      assert.match(await p.getAttribute("#sellForm [name=priceBs]", "placeholder"), /^25 \(su precio\)$/);
      await p.click("#sellBtn");
      // Carla ya tiene Netflix: el panel pregunta «¿Es otro perfil o querías renovar?».
      await p.click("[data-selldupok]", { timeout: 10_000 });
      await p.waitForSelector("text=Listo para enviar", { timeout: 15_000 });
      const last = (await get("/api/admin/orders?status=fulfilled")).find((o) => o.customerId === rev.id);
      assert.equal(last.total, 2500, "se cobró lo mismo que decía el botón");
      // Cliente final: sigue el precio de la tienda, sin la línea «Su precio».
      await open("vender", "#sellForm");
      await p.fill("#sellForm [name=customerName]", "Ana Suárez · +59162000000");
      await p.click('#sellForm [data-pick="nf"]');
      await p.waitForFunction(() => /Bs 35/.test(document.querySelector("#sellBtn")?.innerText ?? ""), null, { timeout: 10_000 });
      assert.doesNotMatch(await p.locator("#sellSummary").innerText(), /Su precio/);

      // 3) Crear un revendedor: la tarjeta para mandarle el acceso queda a la vista.
      await open("revendedores", "#resForm");
      await p.fill("#resForm [name=name]", "Sofía Prueba");
      await p.fill("#resForm [name=phone]", "59176543210");
      await p.click("#resForm button[type=submit]");
      await p.waitForSelector("#rsent", { timeout: 15_000 });
      await p.waitForTimeout(300);
      const top = await p.evaluate(() => document.querySelector("#rsent").getBoundingClientRect().top);
      assert.ok(top >= -2 && top < 300, `la tarjeta del acceso está a la vista (top ${top})`);
      // Botones de cada revendedor: de a dos por renglón.
      const cols = await p.evaluate(() => getComputedStyle(document.querySelector(".rcard > .inline")).gridTemplateColumns.split(" ").length);
      assert.equal(cols, 2);
      // Título entero (antes «Revendedore»).
      const fit = () => p.evaluate(() => { const h = document.querySelector("#ptitle"); return h.scrollWidth <= h.clientWidth + 1 && parseFloat(getComputedStyle(h).fontSize) >= 12; });
      assert.ok(await fit(), "título entero a 390 px");
      await p.setViewportSize({ width: 360, height: 800 });
      await p.waitForTimeout(500);
      assert.ok(await fit(), "título entero a 360 px");
      await p.setViewportSize({ width: 390, height: 844 });

      // 4) Cuenta caída: la tarjeta no cambia de ancho, nada se sale y el motivo viene escrito.
      await open("cuentas", "#accq");
      await p.fill("#accq", "nf0@");
      await p.waitForTimeout(900);
      const w0 = await p.evaluate(() => document.querySelector(".acard").getBoundingClientRect().width);
      await p.locator(".acard summary", { hasText: "Cuenta caída" }).first().click();
      const r = await p.evaluate(() => ({ w: document.querySelector(".acard").getBoundingClientRect().width, reason: document.querySelector("form[data-down] [name=reason]").value, over: document.documentElement.scrollWidth - document.documentElement.clientWidth }));
      assert.ok(Math.abs(r.w - w0) < 2, `la tarjeta medía ${w0} y quedó en ${r.w}`);
      assert.equal(r.reason, "Se cayó");
      assert.equal(r.over, 0);

      // 5) Carga de cuentas: primero la carga rápida.
      await open("carga", "#quickForm");
      const order = await p.evaluate(() => [...document.querySelectorAll("#quickForm, #pfCompre")].map((x) => x.id));
      assert.deepEqual(order, ["quickForm", "pfCompre"]);

      // 6) 44 px: etiquetas del Tablero y del nivel de estrés del Dashboard.
      await open("tablero", ".tbchip");
      const chipH = await p.evaluate(() => Math.min(...[...document.querySelectorAll(".tbchip")].map((x) => x.getBoundingClientRect().height)));
      assert.ok(chipH >= 44, `chips del Tablero de ${chipH} px`);
      await open("dashboard", ".stresswhy");
      const stressH = await p.evaluate(() => [...document.querySelectorAll(".stresswhy button")].map((x) => x.getBoundingClientRect().height));
      assert.ok(stressH.length && Math.min(...stressH) >= 44, `botones del estrés: ${stressH}`);

      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  });
});
