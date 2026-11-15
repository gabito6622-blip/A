// Cuentas en la computadora (15/11/2026). El dueño, en su compu, veía la tabla vieja (correo y notas apretados letra por
// letra) en vez de las bolitas de perfiles «Por plataforma», que solo salían en el celular. Ahora en la computadora se
// ven las bolitas; «📋 Vista clásica» muestra la tabla (con la columna del correo ancha) y se puede volver. Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("computadora: Cuentas muestra las bolitas por plataforma; la tabla solo con «Vista clásica»", { timeout: 120_000, skip: !chromium && "sin navegador" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-cuentaspc-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+", kind: "profile", durationDays: 30, price: 1700, published: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  s.inventory.addAccount(owner, { productId: "dis", supplierId: "p", email: "n2025gt+tm3@ficticio.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 0, notes: "LLENA · nota larga del dueño para ver que no se aprieta letra por letra", profiles: [1, 2, 3].map((i) => ({ label: `Perfil ${i}` })) });
  const c = s.catalog.createCustomer(owner, { name: "Ana Prueba", phone: "+59170000001" });
  s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "a" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 1366, height: 900 } });
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel.html#cuentas");
    await p.locator(".acc-cards .pdot").first().waitFor();
    const vis = () => p.evaluate(() => ({ cards: getComputedStyle(document.querySelector(".acc-cards")).display, table: getComputedStyle(document.querySelector(".acc-table")).display, dots: [...document.querySelectorAll(".acc-cards .pdot")].filter((d) => d.getBoundingClientRect().width > 0).length }));
    assert.deepEqual(await vis(), { cards: "grid", table: "none", dots: 3 }, "por plataforma, con 3 bolitas");
    // Vista clásica: la tabla, con el correo en una columna ancha.
    const btn = p.locator(".acc-viewbtn");
    assert.equal(await btn.isVisible(), true, "el botón está en la computadora");
    await btn.click();
    await p.waitForFunction(() => getComputedStyle(document.querySelector(".acc-table")).display !== "none");
    const t = await vis();
    assert.equal(t.cards, "none");
    const mailW = await p.evaluate(() => document.querySelector(".acc-table td.mono").getBoundingClientRect().width);
    assert.ok(mailW >= 200, `columna del correo de ${mailW} px`);
    await p.locator(".acc-viewbtn").click();
    await p.waitForFunction(() => getComputedStyle(document.querySelector(".acc-cards")).display === "grid");
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
