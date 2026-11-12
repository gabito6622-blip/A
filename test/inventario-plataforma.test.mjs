// Etapa 7: Cuentas "Por plataforma" agrupa las MISMAS tarjetas por producto (Plataforma → Cuenta → Perfiles →
// Cliente). La prueba compara botones y formularios con la "Vista clásica": tienen que ser exactamente los mismos.
// Datos ficticios; navegador a 360 px (se salta sin Playwright).
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

test("Cuentas por plataforma: mismos botones que la vista clásica, contadores correctos y la vista se recuerda", { skip: !chromium, timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-inventario-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const A = (m, p, body) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    await A("POST", "/api/admin/products", { id: "dis", name: "Disney+", kind: "profile", durationDays: 30, price: 3500, published: true });
    await A("POST", "/api/admin/products", { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    const add = (productId, email, n, days = 60) => A("POST", "/api/admin/accounts", { productId, email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + days * DAY, cost: 2000, profiles: Array.from({ length: n }, (_, i) => ({ label: `Perfil ${i + 1}` })) });
    await add("dis", "dis.uno@ejemplo.lat", 2); await add("dis", "dis.dos@ejemplo.lat", 3, 5); await add("nf", "nf.uno@ejemplo.lat", 4);
    // Una cuenta ya vencida: cuenta como "vencida", no como "vence ≤ 7 d".
    const vieja = (await add("nf", "nf.vieja@ejemplo.lat", 1)).account.id;
    await A("POST", `/api/admin/accounts/${vieja}`, { supplierExpiresAt: Date.now() - 3 * DAY });
    const ana = await A("POST", "/api/admin/customers", { name: "Ana", phone: "+59170011223" });
    await A("POST", "/api/admin/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });

    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel.html#cuentas");
    await p.fill("input[name=username]", "gabriel"); await p.fill("input[name=password]", "clave-del-dueño-123"); await p.press("input[name=password]", "Enter");
    await p.waitForSelector(".acc-cards");
    // Foto de botones y formularios dentro de las tarjetas (sin contar los de los grupos).
    const foto = () => p.evaluate(() => {
      const root = document.querySelector(".acc-cards");
      const key = (x) => Object.keys(x.dataset).sort().map((k) => `${k}=${x.dataset[k]}`).join("&");
      return {
        cards: root.querySelectorAll("article.acard").length,
        controls: [...root.querySelectorAll("article.acard button, article.acard form, article.acard summary")].map(key).sort(),
      };
    });
    // Por plataforma (la vista por defecto).
    assert.equal(await p.locator(".pgrp").count(), 2);
    const sums = await p.locator(".pgrp > summary").allInnerTexts();
    assert.match(sums[0], /Disney\+[\s\S]*2 cuentas · 5 libres · 0 ocupados[\s\S]*1 vence ≤ 7 d/);
    assert.match(sums[1], /Netflix[\s\S]*2 cuentas · 4 libres · 1 ocupado[\s\S]*1 vencida/);
    assert.doesNotMatch(sums[1], /vence/, "una cuenta ya vencida no es «por vencer»");
    assert.doesNotMatch(sums[0], /vencida/);
    assert.equal(await p.locator(".pgrp[open]").count(), 0, "con varios grupos, arrancan cerrados");
    const plat = await foto();
    const m = await p.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1, small: [...document.querySelectorAll(".pgrp > summary")].filter((x) => x.getBoundingClientRect().height < 44).length }));
    assert.deepEqual(m, { over: false, small: 0 });
    // Un grupo abierto sigue abierto después de volver a dibujar la pantalla.
    await p.click('.pgrp[data-pgrp="nf"] > summary');
    await p.click('[data-secrets="1"]');
    await p.waitForFunction(() => document.querySelector('.pgrp[data-pgrp="nf"]')?.open === true);
    // Vista clásica: exactamente las mismas tarjetas, botones y formularios.
    await p.click('[data-accview="clasica"]');
    await p.waitForFunction(() => !document.querySelector(".pgrp") && document.querySelector(".acc-cards article.acard"));
    await p.click('[data-secrets="1"]');
    await p.waitForFunction(() => !/Ocultar/.test(document.querySelector('[data-secrets="1"]')?.textContent ?? ""));
    const clasica = await foto();
    assert.deepEqual(clasica, plat, "ningún botón ni formulario de más o de menos");
    // Se recuerda la vista elegida.
    await p.reload(); await p.waitForSelector(".acc-cards");
    assert.equal(await p.locator(".pgrp").count(), 0);
    await p.click('[data-accview="plat"]');
    await p.waitForSelector(".pgrp");
    // Al buscar, los grupos con resultados se abren.
    await p.fill("#accq", "dis.dos"); await p.press("#accq", "Enter").catch(() => {});
    await p.waitForFunction(() => document.querySelectorAll(".pgrp").length === 1 && document.querySelector(".pgrp").open, null, { timeout: 15_000 });
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
