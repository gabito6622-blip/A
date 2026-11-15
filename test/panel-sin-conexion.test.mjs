// Panel sin conexión (15/11/2026). El dueño vio «No se pudo cargar: Failed to fetch» en «Cómo van» (se cortó la conexión
// un momento: el servidor respondía bien). Ahora: si un pedido no tiene respuesta, se reintenta solo una vez; si sigue
// sin conexión, se explica en castellano con un botón «Reintentar» que vuelve a cargar la pantalla. Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("«Cómo van» sin conexión: reintenta solo y, si sigue, «Reintentar» en castellano", { timeout: 120_000, skip: !chromium && "sin navegador" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-sinred-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 768 } });
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    // 1. Se corta una sola vez: se reintenta solo y la pantalla carga.
    let cortes = 1;
    await ctx.route(/\/api\/admin\/resellers\/overview/, (r) => (cortes-- > 0 ? r.abort("internetdisconnected") : r.continue()));
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel.html#comovan");
    await p.locator(".cv-kpis").waitFor({ timeout: 15_000 });
    assert.doesNotMatch(await p.locator("#pout").innerText(), /Failed to fetch/);
    // 2. Sigue sin conexión: mensaje en castellano y «Reintentar»; al volver la conexión, carga.
    // (en una pestaña nueva: «Cómo van» guarda lo que ya cargó y no vuelve a pedirlo al entrar de nuevo)
    cortes = 99;
    await p.close();
    const p2 = await ctx.newPage(); p2.on("pageerror", (e) => errs.push(e.message));
    await p2.goto(base + "/panel.html#comovan");
    const err = p2.locator("#pout .perr");
    await err.waitFor({ timeout: 15_000 });
    assert.match(await err.innerText(), /No hay conexión con la tienda en este momento\. Revisá tu internet y probá de nuevo\./);
    assert.doesNotMatch(await err.innerText(), /Failed to fetch/);
    const btn = p2.locator('#pout [data-reload]');
    assert.ok((await btn.boundingBox()).height >= 30);
    cortes = 0;
    await btn.click();
    await p2.locator(".cv-kpis").waitFor({ timeout: 15_000 });
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
