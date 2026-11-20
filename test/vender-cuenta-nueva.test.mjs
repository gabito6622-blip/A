// Vender: cuenta nueva sin salir (19/11/2026). Antes:
// Vender fácil (19/11/2026, pedido del dueño: «que reemplace el Excel, práctico para todos»). En la misma pantalla:
// cada producto dice si es para 👤 Cliente o 👥 Revendedor (a un cliente final no le aparecen los de revendedor),
// y se pone el precio cobrado y la fecha de vencimiento sin corregir después. Datos ficticios; 360 px; nada se manda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5, PASS = "clave-del-dueño-123";

test("Vender: cargar una cuenta nueva sin salir y venderla en el mismo paso", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-vendernueva-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "hba", name: "HBO Max cuenta completa (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 2336, published: true, resellersOnly: true });
  const rev = s.catalog.createCustomer(owner, { name: "Rev Panamá", phone: "+50760000001" });
  e.tx(() => { rev.kind = "reseller"; });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: PASS }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
    await p.goto(base + "/panel#vender");
    const f = p.locator("#sellForm"); await f.waitFor();
    assert.equal(await p.locator('[data-pick="hba"]').isDisabled(), true, "sin stock");
    await f.locator("[name=customerName]").fill("Rev Panamá · +50760000001");
    await p.locator(".newacc > summary").click();
    await p.selectOption("[name=naProd]", "hba");
    await p.fill("[name=naEmail]", "nueva+1@ficticio.lat");
    await p.locator("[data-newacc]").click();
    await p.waitForTimeout(200);
    assert.equal(Object.keys(e.s.accounts).length, 0, "sin fecha del proveedor no carga nada");
    await p.fill("[name=naSup]", "2026-12-09");
    await p.locator("[data-newacc]").click();
    await p.waitForFunction(() => document.querySelector('[data-pick="hba"]')?.getAttribute("aria-pressed") === "true", null, { timeout: 15_000 });
    const acc = Object.values(e.s.accounts).find((a) => a.email === "nueva+1@ficticio.lat");
    assert.ok(acc, "se cargó"); assert.ok(!acc.password, "sin clave queda pendiente");
    assert.equal(await f.locator("[name=customerName]").inputValue(), "Rev Panamá · +50760000001", "no se pierde el cliente");
    await p.waitForFunction(() => !document.querySelector("#sellBtn").disabled);
    await p.locator("#sellBtn").click();
    await p.waitForFunction(() => /Venta registrada/.test(document.body.innerText), null, { timeout: 15_000 });
    const a = Object.values(e.s.assignments).find((x) => x.customerId === rev.id);
    assert.equal(e.s.slots[a.slotId].accountId, acc.id, "vendió la cuenta recién cargada");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
