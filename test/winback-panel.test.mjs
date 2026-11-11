// "Que vuelvan" en el panel: tarjeta en Inicio, fila guiada (Abrir WhatsApp marca "escrito" y pasa al
// siguiente, Anterior, No molestar con confirmación). Usa el navegador (Playwright) si está instalado;
// si no (por ejemplo en la CI), se salta. wa.me queda bloqueado: nunca sale un WhatsApp real.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

test("Que vuelvan: de Inicio a la fila guiada; WhatsApp marca escrito y No molestar pide confirmación", { skip: !chromium && "Playwright no está instalado" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-wbpanel-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const port = await app.listen(0, "127.0.0.1");
  const base = `http://127.0.0.1:${port}`;
  const browser = await chromium.launch();
  try {
    const st = app.store, o = { id: "t", role: "owner" };
    st.catalog.upsertProduct(o, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    st.catalog.upsertSupplier(o, { id: "andes", name: "Andes", active: true });
    st.inventory.addAccount(o, { productId: "nf", supplierId: "andes", email: "nf1@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 4000, profiles: [{ label: "P1" }, { label: "P2" }, { label: "P3" }] });
    const ana = st.catalog.createCustomer(o, { name: "Ana Mamani", phone: "+59170100001" });
    const beto = st.catalog.createCustomer(o, { name: "Beto Paz", phone: "+59170100002" });
    const expire = (c, days) => {
      const aid = st.orders.create(o, { customerId: c.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
      st.engine.s.assignments[aid].customerExpiresAt = Date.now() - days * DAY;
    };
    expire(ana, 2); // más reciente: primero en la fila
    expire(beto, 9);

    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    const [name, value] = lr.headers.get("set-cookie").split(";")[0].split("=");
    const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true });
    await ctx.addCookies([{ name, value, url: base }]);
    await ctx.route(/wa\.me|whatsapp\.com/, (route) => route.abort());
    const page = await ctx.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    await page.goto(base + "/panel.html#inicio");

    const card = page.locator(".wb-home");
    await card.waitFor();
    assert.match(await card.innerText(), /2 ventas para recuperar · Bs 70/);
    await card.getByRole("button", { name: /Ver a quién escribirle/ }).click();
    await page.locator(".wb-sum").waitFor();
    assert.match(await page.locator(".wb-sum").innerText(), /2 ventas para recuperar · Bs 70 en juego/);
    assert.match(await page.locator("#ptitle").innerText(), /Que vuelvan/);

    await page.getByRole("button", { name: /Empezar \(2\)/ }).click();
    const step = page.locator(".invstep");
    await step.waitFor();
    assert.match(await step.innerText(), /1 de 2/);
    assert.match(await step.innerText(), /Ana Mamani/);
    const wa = step.locator("a[data-wbsent]");
    const href = await wa.getAttribute("href");
    assert.match(href, /^https:\/\/wa\.me\/59170100001\?text=/);
    assert.match(decodeURIComponent(href), /¿Querés renovar tu Netflix\? Sigue a Bs 35/);
    await wa.click();
    await page.waitForFunction(() => /2 de 2/.test(document.querySelector(".invstep")?.innerText ?? ""));
    assert.match(await step.innerText(), /Beto Paz/, "pasó sola a la siguiente");
    assert.ok(st.engine.s.winback?.[ana.id]?.writtenAt > 0, "Ana quedó marcada como escrita");

    await step.getByRole("button", { name: /Anterior/ }).click();
    await page.waitForFunction(() => /1 de 2/.test(document.querySelector(".invstep")?.innerText ?? ""));
    assert.match(await step.innerText(), /Ya le escribiste/);
    await step.getByRole("button", { name: /Saltar/ }).click();
    await page.waitForFunction(() => /2 de 2/.test(document.querySelector(".invstep")?.innerText ?? ""));

    // No molestar: si cancela la confirmación no pasa nada; si acepta, queda marcado.
    page.once("dialog", (d) => d.dismiss());
    await step.getByRole("button", { name: /No molestar/ }).click();
    await page.waitForTimeout(200);
    assert.equal(st.engine.s.winback?.[beto.id], undefined);
    page.once("dialog", (d) => { assert.match(d.message(), /Beto Paz/); d.accept(); });
    await step.getByRole("button", { name: /No molestar/ }).click();
    await page.waitForFunction(() => /Listo/.test(document.querySelector(".wb-row")?.innerText ?? ""));
    assert.ok(st.engine.s.winback[beto.id].mutedAt > 0);
    assert.match(await page.locator(".wb-sum").innerText(), /No hay ventas para recuperar/);
    assert.match(await page.locator(".wb-sum").innerText(), /le escribiste a 1/);

    const vw = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
    assert.equal(vw[0], vw[1], "sin desborde a 360 px");
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
