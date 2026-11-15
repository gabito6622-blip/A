// 🗂️ Tablero de revendedores (15/11/2026). El dueño: para los revendedores, bajar por cada cuenta Disney le quita tiempo.
// Una fila por revendedor: primero el que tiene algo vencido, después el que vence en 7 días, el que debe y el que está
// al día. Cada cuenta es una etiqueta con color; tocarla abre esa cuenta en Cuentas con sus botones. «📲 Cobrar» arma el
// WhatsApp con lo que vence y el total; «💵 Me pagó todo» es el mismo de Revendedores. Datos ficticios; nada se manda.
// Con TB_SHOTS=<carpeta> guarda capturas (fuera del repositorio) para mostrarle al dueño.
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
const waText = (href) => decodeURIComponent((href.split("text=")[1] ?? "").replace(/\+/g, " "));

test("tablero: una fila por revendedor, ordenado por urgencia, con cobrar, me pagó todo y la cuenta a un toque", { timeout: 240_000, skip: !chromium && "sin navegador" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-tablero-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6500, published: true, resellersOnly: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  for (let i = 0; i < 9; i++) s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "p", email: `madre${i < 5 ? "a" : "b"}+c${i}@ficticio.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 200 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  const mk = (name, phone) => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "revendedor" });
  const alDia = mk("aldia · Ana Al Día", "+59170000001"), pronto = mk("pronto · Beto Pronto", "+59170000002"), vencido = mk("vencido · Carla Vencida", "+59170000003");
  mk("dormido · Dani Sin Cuentas", "+59170000004");
  let k = 0;
  const rent = (c, days) => { const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis-alq", qty: 1 }], paymentMethod: "cash", idempotencyKey: "r" + k++ }); s.orders.setExpiry(owner, o.assignmentIds[0], Date.now() + days * DAY); return o.assignmentIds[0]; };
  rent(alDia, 20); rent(alDia, 25);
  rent(pronto, 2); rent(pronto, 6); rent(pronto, 18);
  rent(vencido, -1); rent(vencido, 12);
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  const shots = process.env.TB_SHOTS;
  try {
    for (const [w, h, mobile] of [[1366, 900, false], [390, 844, true]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: h }, isMobile: mobile, hasTouch: mobile, deviceScaleFactor: shots ? 2 : 1, timezoneId: "America/La_Paz" });
      const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      await ctx.route(/wa\.me|whatsapp\.com/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/panel.html#tablero");
      await p.locator(".tbrow").first().waitFor();
      if (shots) await p.screenshot({ path: `${shots}/tablero-${w}.png`, fullPage: !mobile });
      // Orden: vencido, pronto, al día, sin cuentas.
      const order = await p.locator(".tbrow .tbname b").allInnerTexts();
      assert.deepEqual(order.map((x) => x.split(" · ")[0]), ["vencido", "pronto", "aldia", "dormido"], `${w}: orden por urgencia`);
      const rows = p.locator(".tbrow");
      assert.match(await rows.nth(0).innerText(), /1 vencida/);
      assert.match(await rows.nth(1).innerText(), /2 vencen en 7 días/);
      assert.match(await rows.nth(2).innerText(), /Al día/);
      assert.match(await rows.nth(3).innerText(), /Sin cuentas activas/);
      // Etiquetas con color por estado.
      assert.equal(await rows.nth(0).locator(".tbchip.tbc-exp").count(), 1);
      assert.equal(await rows.nth(1).locator(".tbchip.tbc-soon").count(), 1);
      assert.equal(await rows.nth(1).locator(".tbchip.tbc-week").count(), 1);
      assert.equal(await rows.nth(2).locator(".tbchip.tbc-ok").count(), 2);
      // Cobrar: WhatsApp de Beto con lo que vence y el total; el que está al día no tiene «Cobrar».
      const wa = waText(await rows.nth(1).locator("[data-tbwa]").getAttribute("href"));
      assert.match(wa, /^Hola Beto 👋\nTe paso tus alquileres para renovar:\n• Disney ESPN \(madre.\+c\d@ficticio\.lat\) — vence el \d{2}\/\d{2}\/\d{4}: Bs 65\n• Disney ESPN .*: Bs 65\nTotal: Bs 130/);
      assert.equal(await rows.nth(2).locator("[data-tbwa]").count(), 0);
      assert.equal(await rows.nth(1).locator("[data-rmpaid]").count(), 1, "«Me pagó todo» en el que tiene algo para cobrar");
      // Resumen arriba.
      assert.match(await p.locator(".tbsum").innerText(), /3\s*revendedores con cuentas[\s\S]*7\s*cuentas[\s\S]*1\s*vencidas[\s\S]*2\s*vencen en 7 días[\s\S]*Para cobrar\s*Bs 195/);
      // Filtro «Para cobrar» y búsqueda.
      await p.locator('[data-tbf="urgente"]').click();
      await p.waitForFunction(() => document.querySelectorAll(".tbrow").length === 2);
      await p.locator('[data-tbf="todos"]').click();
      await p.waitForFunction(() => document.querySelectorAll(".tbrow").length === 4);
      await p.locator("#tbq").fill("carla");
      await p.waitForFunction(() => document.querySelectorAll(".tbrow").length === 1);
      await p.locator("#tbq").fill("");
      await p.waitForFunction(() => document.querySelectorAll(".tbrow").length === 4);
      // Tamaños y sin desborde.
      assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${w}: sin desborde`);
      for (const hgt of await p.locator(".tbact .pbtn").evaluateAll((l) => l.map((x) => x.getBoundingClientRect().height))) assert.ok(hgt >= 44, `${w}: botón de ${hgt}px`);
      // «Me pagó todo» abre su resumen con el total.
      await rows.nth(1).locator("[data-rmpaid]").click();
      const mp = p.locator(".rmcard");
      await mp.waitFor();
      assert.match(await mp.innerText(), /Total: Bs 130/);
      await mp.locator("[data-rmclose]").first().click();
      await mp.waitFor({ state: "detached" });
      // Tocar una etiqueta abre esa cuenta en Cuentas con sus botones.
      await p.locator(".tbrow").nth(0).locator(".tbchip").first().click();
      await p.waitForFunction(() => location.hash === "#cuentas");
      await p.getByRole("button", { name: /Liberar/ }).first().waitFor();
      assert.match(await p.locator("#pout").innerText(), /Ocupado por vencido · Carla Vencida/);
      if (shots) await p.screenshot({ path: `${shots}/tablero-${w}-cuenta.png` });
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    // ---- Acciones (una sola vez, en la computadora) ----
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 }, deviceScaleFactor: shots ? 2 : 1, timezoneId: "America/La_Paz" });
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    await ctx.route(/wa\.me|whatsapp\.com/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    p.on("dialog", (dl) => dl.accept());
    const A = () => Object.values(s.engine.s.assignments);
    // 1. «✂️ Cortar: no renovó» (Carla, la vencida): termina el alquiler y la cuenta queda apartada, no a la venta.
    await p.goto(base + "/panel.html#tablero");
    await p.locator(".tbrow").first().waitFor();
    const carlaChip = p.locator(".tbrow").nth(0).locator(".tbchip.tbc-exp");
    const carlaSlot = await carlaChip.getAttribute("data-tbslot");
    await carlaChip.click();
    await p.locator("[data-slotcut]").waitFor();
    if (shots) await p.screenshot({ path: `${shots}/tablero-cortar.png` });
    await p.locator("[data-slotcut]").click();
    await p.waitForFunction(() => /Cortado/.test(document.body.innerText));
    assert.equal(s.engine.s.slots[carlaSlot].status, "quarantined", "apartada, no a la venta");
    assert.equal(A().filter((a) => a.customerId === vencido.id && a.status === "active").length, 1, "le queda solo la otra cuenta");
    // 2. «Me pagó todo» (Beto) → «📲 Avisarle que quedó renovada» con las 2 fechas nuevas.
    await p.goto(base + "/panel.html#tablero"); await p.reload();
    const beto = p.locator(".tbrow", { hasText: "Beto Pronto" });
    await beto.locator("[data-rmpaid]").click();
    await p.locator(".rmcard [data-rmpaidok]").click();
    const av = p.locator("#tbAviso");
    await av.waitFor();
    const avText = await av.innerText();
    assert.match(avText, /Hola Beto ✅ Listo, renové tus cuentas:\n• Disney ESPN \(madre.\+c\d@ficticio\.lat\) hasta el \d{2}\/\d{2}\/\d{4}\n• Disney ESPN .* hasta el \d{2}\/\d{2}\/\d{4}\n¡Gracias!/);
    assert.match(waText(await av.locator("[data-tbavwa]").getAttribute("href")), /renové tus cuentas/);
    if (shots) await p.screenshot({ path: `${shots}/tablero-aviso-renovada.png` });
    await av.locator("[data-tbavclose]").first().click();
    await av.waitFor({ state: "detached" });
    // 3. Renovar UNA cuenta desde su etiqueta (Ana) → aviso con esa cuenta.
    await p.goto(base + "/panel.html#tablero"); await p.reload();
    await p.locator(".tbrow", { hasText: "Ana Al Día" }).locator(".tbchip").first().click();
    await p.locator("[data-renew]").first().click();
    await av.waitFor();
    assert.match(await av.innerText(), /Hola Ana ✅ Listo, renové tu cuenta:\n• Disney ESPN/);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
