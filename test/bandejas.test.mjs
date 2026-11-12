// Etapa 6: pestañas que unen pantallas hermanas. "Avisos y vencimientos" (Recordatorios, Que vuelvan, Vencidos del
// Control, Mensajes por enviar de WhatsApp) y "Plata" (Finanzas, Fiado, Reportes, Pagos por revisar). Solo llevan
// de una pantalla a otra y respetan los permisos de cada una. Datos ficticios; navegador (se salta sin Playwright).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("pestañas de Avisos y de Plata: llevan a sus pantallas, respetan permisos y entran en el celular", { skip: !chromium, timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-bandejas-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    await fetch(base + "/api/admin/staff", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" }) });
    const open = async (u, pw, view) => {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
      await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/panel.html#" + view);
      await p.fill("input[name=username]", u); await p.fill("input[name=password]", pw); await p.press("input[name=password]", "Enter");
      await p.waitForSelector(".gtabs");
      return { p, ctx, errs };
    };
    const labels = (p) => p.locator(".gtabs-row button").allInnerTexts();
    const current = (p) => p.locator('.gtabs-row button[aria-current="page"]').allInnerTexts();
    const goTab = async (p, text, hash) => { await p.click(`.gtabs-row button:has-text("${text}")`); await p.waitForFunction((h) => location.hash === "#" + h, hash); await p.waitForSelector(".gtabs, #pout > *"); await p.waitForTimeout(300); };

    // Dueño: Avisos y vencimientos.
    const o = await open("gabriel", "clave-del-dueño-123", "recordatorios");
    assert.deepEqual(await labels(o.p), ["⏰ Recordatorios", "💸 Que vuelvan", "🔴 Vencidos", "📤 Mensajes por enviar"]);
    assert.deepEqual(await current(o.p), ["⏰ Recordatorios"]);
    const m = await o.p.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll(".gtabs-row button")].filter((x) => x.getBoundingClientRect().height < 44).length }));
    assert.deepEqual(m, { over: false, small: 0 }, "en el celular: sin desborde y botones de 44 px");
    await goTab(o.p, "Que vuelvan", "quevuelvan");
    assert.deepEqual(await current(o.p), ["💸 Que vuelvan"]);
    await goTab(o.p, "Mensajes por enviar", "whatsapp");
    assert.equal(await o.p.locator('[data-tab="waSec:avisos"][aria-selected="true"]').count(), 1, "abre WhatsApp en Avisos");
    assert.deepEqual(await current(o.p), ["📤 Mensajes por enviar"]);
    // En Conversaciones (otra parte de WhatsApp) no aparecen las pestañas de avisos.
    await o.p.click('[data-tab="waSec:chats"]'); await o.p.waitForTimeout(500);
    assert.equal(await o.p.locator(".gtabs").count(), 0);
    await o.p.evaluate(() => { location.hash = "recordatorios"; document.querySelector('#menu [data-go="recordatorios"]').click(); });
    await o.p.waitForSelector(".gtabs");
    await goTab(o.p, "Vencidos", "control");
    // Plata.
    await o.p.evaluate(() => { location.hash = "finanzas"; document.querySelector('#menu [data-go="finanzas"]').click(); });
    await o.p.waitForSelector(".gtabs");
    assert.deepEqual(await labels(o.p), ["💰 Caja del mes", "📒 Fiado", "📊 Reportes", "✅ Pagos por revisar"]);
    await goTab(o.p, "Reportes", "dashboard");
    assert.deepEqual(await current(o.p), ["📊 Reportes"]);
    await goTab(o.p, "Pagos por revisar", "aprobacion");
    assert.equal(await o.p.locator(".gtabs").count(), 0, "Aprobar pagos sigue siendo de Ventas: sin pestañas propias");
    // Pantallas de otros grupos no cambian.
    await o.p.evaluate(() => { location.hash = "vender"; document.querySelector('#menu [data-go="vender"]').click(); });
    await o.p.waitForSelector("[data-pick], #sellForm, .emptybox", { timeout: 15_000 }).catch(() => {});
    assert.equal(await o.p.locator(".gtabs").count(), 0);
    assert.deepEqual(o.errs, []);
    await o.ctx.close();

    // Atención: en Plata solo ve lo que ya podía abrir (Fiado y Pagos por revisar).
    const s = await open("lucia", "clave-de-lucia-123", "fiado");
    assert.deepEqual(await labels(s.p), ["📒 Fiado", "✅ Pagos por revisar"]);
    assert.deepEqual(s.errs, []);
    await s.ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
