// 📗 Mis hojas (15/11/2026). El dueño: «lo que me gustaba de mi Excel es que entraba a las hojas… y aunque esté sin
// internet anotaba y ya estaba». Una hoja por plataforma con pestañas abajo, más Revendedores y Me deben; tocar una fila
// abre Me pagó / Cambiar fecha / Nota / WhatsApp / Cortar / Ver en Cuentas (los mismos botones de siempre).
// Sin internet: el panel abre con la copia guardada (SIN contraseñas), lo anotado queda con ⏳ y se sube solo al volver
// la señal; si esa cuenta cambió mientras tanto, se pregunta antes de guardar. Datos ficticios; nada se manda.
// Con HJ_SHOTS=<carpeta> guarda capturas (fuera del repositorio).
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

test("mis hojas: pestañas como el Excel, botones de siempre y anotar sin internet", { timeout: 300_000, skip: !chromium && "sin navegador" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-hojas-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6500, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix Premium", kind: "profile", durationDays: 30, price: 4000, published: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  for (let i = 0; i < 4; i++) s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "p", email: `madre+c${i}@ficticio.lat`, password: "Clave-Secreta#77", supplierExpiresAt: Date.now() + 200 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "p", email: "netflix1@ficticio.lat", password: "Clave-Secreta#77", supplierExpiresAt: Date.now() + 200 * DAY, cost: 0, profiles: [1, 2, 3, 4].map((i) => ({ label: `Perfil ${i}` })) });
  const rev = (name, phone) => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "revendedor" });
  const cli = (name, phone) => s.catalog.createCustomer(owner, { name, phone });
  const ana = rev("Ana Revende", "+59170000001"), beto = rev("Beto Revende", "+59170000002");
  const carla = cli("Carla Cliente", "+59170000003"), dani = cli("Dani Cliente", "+59170000004");
  let k = 0;
  const rent = (c, pid, days) => { const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash", idempotencyKey: "r" + k++ }); s.orders.setExpiry(owner, o.assignmentIds[0], Date.now() + days * DAY); return o.assignmentIds[0]; };
  rent(ana, "dis-alq", 20); const anaVencida = rent(ana, "dis-alq", -1);
  const betoA = rent(beto, "dis-alq", 3);
  rent(carla, "nf", 12); const daniA = rent(dani, "nf", 2);
  s.fiado.charge(owner, { customerId: carla.id, amount: 3000, note: "Netflix de octubre" });
  const A = (id) => s.engine.s.assignments[id];
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  const shots = process.env.HJ_SHOTS;
  try {
    // ---- Computadora: la misma hoja, ancha ----
    {
      const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: shots ? 2 : 1, timezoneId: "America/La_Paz" });
      const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/panel.html#hojas");
      await p.locator(".hjt").waitFor();
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "1366: sin desborde");
      if (shots) await p.screenshot({ path: `${shots}/hojas-1366.png` });
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    // ---- Celular ----
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1, timezoneId: "America/La_Paz" });
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    const dialogs = [];
    p.on("dialog", (dl) => { dialogs.push(dl.message()); return /mientras tanto/.test(dl.message()) ? dl.dismiss() : dl.accept(); });
    await p.goto(base + "/panel.html#hojas");
    await p.locator(".hjt").waitFor();
    // Pestañas abajo: Disney, Netflix, Revendedores, Me deben (con cuántos hay).
    const tabs = await p.locator(".hjtabs button").allInnerTexts();
    assert.deepEqual(tabs.map((t) => t.replace(/\s+/g, " ").trim()), ["D+ Disney 4", "N Netflix 4", "👥 Revendedores 2", "💸 Me deben 1"]);
    for (const h of await p.locator(".hjtabs button").evaluateAll((l) => l.map((x) => x.getBoundingClientRect().height))) assert.ok(h >= 44, `pestaña de ${h}px`);
    // Hoja Disney: primero la vencida (roja), después la que vence en 3 días (naranja), al día (verde) y la libre (azul).
    const cls = await p.locator(".hjt tbody tr").evaluateAll((l) => l.map((x) => x.className.split(" ")[0]));
    assert.deepEqual(cls, ["hj-r", "hj-o", "hj-g", "hj-l"]);
    assert.match(await p.locator(".hjt tbody tr").first().innerText(), /madre\+c\d[\s\S]*Ana Revende[\s\S]*hace 1 d[\s\S]*Bs 65/);
    assert.match(await p.locator(".hjchips").innerText(), /3 ocupadas[\s\S]*1 al día[\s\S]*1 vencen pronto[\s\S]*1 vencida[\s\S]*1 libre/);
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "390: sin desborde");
    // La hoja entra entera en el celular (sin cortar «Quién», «Vence» ni «Precio»).
    const fit = await p.evaluate(() => { const t = document.querySelector(".hjt").getBoundingClientRect(), c = document.querySelector("#hj").getBoundingClientRect(), pr = document.querySelector(".hjt thead th:last-child").getBoundingClientRect(); return { t: t.right, c: c.right, pr: pr.right }; });
    assert.ok(fit.t <= fit.c + 1 && fit.pr <= fit.c + 1, `la tabla entra en la tarjeta (${JSON.stringify(fit)})`);
    if (shots) await p.screenshot({ path: `${shots}/hojas-390.png` });
    // Netflix: 2 ocupadas y 2 libres; la búsqueda filtra.
    await p.locator('[data-hjtab="Netflix"]').click();
    await p.waitForFunction(() => document.querySelectorAll(".hjt tbody tr").length === 4);
    assert.equal(await p.locator(".hjt tbody tr.hj-l").count(), 2);
    await p.locator("#hjq").fill("carla");
    await p.waitForFunction(() => document.querySelectorAll(".hjt tbody tr").length === 1);
    await p.locator("#hjq").fill("");
    // Revendedores: agrupados, con «📋 Su lista» (todas sus cuentas y fechas).
    await p.locator('[data-hjtab="rev"]').click();
    await p.waitForFunction(() => document.querySelectorAll(".hjgrp").length === 2);
    const lista = decodeURIComponent((await p.locator(".hjgrp", { hasText: "Ana Revende" }).locator("[data-hjlista]").getAttribute("href")).split("text=")[1]);
    assert.match(lista, /^Hola Ana 👋 tu resumen:\n• Disney ESPN \(madre\+c\d@ficticio\.lat\) – venció el \d{2}\/\d{2}\/\d{4}\n• Disney ESPN .* – vence el /);
    // Me deben: Carla, Bs 30, con «Cobrar».
    await p.locator('[data-hjtab="debe"]').click();
    await p.waitForFunction(() => /Carla Cliente/.test(document.querySelector("#hjbody").innerText));
    assert.match(await p.locator("#hjbody").innerText(), /Carla Cliente[\s\S]*Bs 30/);
    // Con internet: tocar la fila de Beto → «Me pagó» renueva al toque (el mismo Renovar de Cuentas) y ofrece avisarle.
    await p.locator('[data-hjtab="Disney"]').click();
    await p.locator(".hjt tbody tr", { hasText: "Beto Revende" }).click();
    await p.locator("#hjsheet [data-hjpay]").waitFor();
    if (shots) await p.screenshot({ path: `${shots}/hojas-fila.png` });
    for (const h of await p.locator("#hjsheet .hjbtns .pbtn").evaluateAll((l) => l.map((x) => x.getBoundingClientRect().height))) assert.ok(h >= 44, `botón de ${h}px`);
    const betoAntes = A(betoA).customerExpiresAt;
    await p.locator("#hjsheet [data-hjpay]").click();
    await p.locator("#tbAviso").waitFor();
    assert.match(await p.locator("#tbAviso").innerText(), /Hola Beto ✅ Listo, renové tu cuenta:\n• Disney ESPN/);
    assert.ok(A(betoA).customerExpiresAt > betoAntes + 25 * DAY, "Beto renovado en el servidor");
    await p.locator("#tbAviso [data-tbavclose]").first().click();
    // La copia del aparato no tiene contraseñas.
    const snap = await p.evaluate(() => localStorage.getItem("gs-hojas-v1"));
    assert.ok(snap && snap.includes("madre+c0@ficticio.lat"));
    assert.doesNotMatch(snap, /Clave-Secreta|password|••••/i);
    // Esperar a que el aparato guarde los archivos del panel (service worker).
    await p.waitForFunction(async () => { const c = await caches.open("gs-panel-v1"); return !!(await c.match("/panel-hojas.js")) && !!(await c.match("/panel.html")) && !!(await c.match("/panel.css")); }, null, { timeout: 30_000, polling: 300 });

    // ---- Sin internet: el panel abre igual, con la copia ----
    await ctx.setOffline(true);
    await p.reload();
    await p.locator(".hjnet.off").waitFor({ timeout: 20_000 });
    assert.match(await p.locator(".hjnet.off").innerText(), /Sin internet · ves lo guardado el \d{2}\/\d{2} a las/);
    // «Me pagó» de Ana (vencida): queda anotado con ⏳.
    await p.locator(".hjt tbody tr", { hasText: "Ana Revende" }).first().click();
    assert.equal(await p.locator("#hjsheet [data-slotcut]").isDisabled(), true, "cortar necesita internet");
    await p.locator("#hjsheet [data-hjpay]").click();
    await p.waitForFunction(() => /⏳ Me pagó/.test(document.querySelector(".hjt").innerText));
    // Cambiar la fecha de Dani (Netflix) sin internet.
    await p.locator('[data-hjtab="Netflix"]').click();
    await p.locator(".hjt tbody tr", { hasText: "Dani Cliente" }).click();
    await p.locator("#hjsheet [data-hjdate]").click();
    const nueva = new Date(Date.now() + 40 * DAY);
    await p.locator('#hjform input[type="date"]').fill(`${nueva.getFullYear()}-${String(nueva.getMonth() + 1).padStart(2, "0")}-${String(nueva.getDate()).padStart(2, "0")}`);
    await p.locator("#hjform [type=submit]").click();
    await p.waitForFunction(() => /⏳ fecha nueva/.test(document.querySelector(".hjt").innerText));
    assert.match(await p.locator(".hjnet.off").innerText(), /⏳ 2 cambios esperando internet/);
    if (shots) { await p.locator('[data-hjtab="Disney"]').click(); await p.screenshot({ path: `${shots}/hojas-sin-internet.png` }); }
    // Mientras tanto, en la tienda alguien cambió la fecha de Dani: al volver la señal se pregunta (y acá se dice que no).
    const daniServidor = Date.now() + 5 * DAY;
    s.orders.setExpiry(owner, daniA, daniServidor);
    const anaAntes = A(anaVencida).customerExpiresAt;

    // ---- Vuelve la señal: se sube solo ----
    await ctx.setOffline(false);
    await p.waitForFunction(() => { try { return JSON.parse(localStorage.getItem("gs-hojas-cola-v1") || "[]").length === 0; } catch { return false; } }, null, { timeout: 30_000, polling: 300 });
    assert.ok(A(anaVencida).customerExpiresAt > anaAntes + 25 * DAY, "el «Me pagó» de Ana se guardó al volver la señal");
    assert.equal(A(daniA).customerExpiresAt, daniServidor, "la fecha de Dani que cambió en la tienda no se pisó");
    assert.ok(dialogs.some((m) => /Dani Cliente[\s\S]*mientras tanto la fecha cambió/.test(m)), "se preguntó por el cambio de Dani");
    await p.locator(".hjnet.ok").waitFor({ timeout: 15_000 });
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
