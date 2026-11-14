// Finanzas (14/11/2026): la barra del mes en curso del gráfico «Últimos 6 meses» decía una ganancia y el número
// «Te quedó» de arriba otra (la barra no restaba el costo estimado de las cuentas). Ahora coinciden. Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("Finanzas: la barra del mes en curso dice lo mismo que «Te quedó»", { skip: !chromium && "Playwright no está instalado", timeout: 90_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-fincoin-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  // Cuenta con costo Bs 120 que no se anotó como gasto: el panel la estima.
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 30 * 86_400_000, cost: 12000, profiles: [{ label: "P1" }, { label: "P2" }] });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Quispe", phone: "+59170011223" });
  s.orders.create(owner, { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 390, height: 844 } });
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel#finanzas");
    await p.locator(".finbar.cur").waitFor();
    const top = (await p.locator(".finkpi.net b").first().innerText()).trim();
    const bar = (await p.locator(".finbar.cur > b").innerText()).trim();
    assert.equal(bar, top, `barra ${bar} vs Te quedó ${top}`);
    assert.match(top, /-/, "con Bs 35 de venta y Bs 120 de cuenta, el mes da negativo en los dos lados");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
