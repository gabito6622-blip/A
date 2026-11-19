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

test("Vender: para quién es cada producto, precio y fecha en el mismo paso", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-venderfacil-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dz", name: "Disney+ sin ESPN", kind: "profile", durationDays: 30, price: 1700, published: true });
  s.catalog.upsertProduct(owner, { id: "dza", name: "Disney Premium sin ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  for (const [pid, em] of [["dz", "cli@ficticio.lat"], ["dza", "rev@ficticio.lat"]]) s.inventory.addAccount(owner, { productId: pid, email: em, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 0, profiles: [{ label: "P1" }, ...(pid === "dz" ? [{ label: "P2" }] : [])] });
  const ale = s.catalog.createCustomer(owner, { name: "Ale Ficticia", phone: "+59170000001" });
  const rev = s.catalog.createCustomer(owner, { name: "Rev Ficticio", phone: "+59170000002" });
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
    assert.match(await p.locator('[data-pick="dza"]').innerText(), /👥 Revendedor/);
    assert.match(await p.locator('[data-pick="dz"]').innerText(), /👤 Cliente/);
    assert.doesNotMatch(await p.locator('[data-pick="dza"]').innerText(), /alquiler revendedores/, "sin el nombre largo");
    // Cliente final: no le aparece el producto de revendedores.
    await f.locator("[name=customerName]").fill("Ale Ficticia · +59170000001");
    await p.waitForFunction(() => document.querySelector('[data-pick="dza"]').hidden);
    assert.equal(await p.locator('[data-pick="dz"]').isVisible(), true);
    await p.locator('[data-pick="dz"]').click();
    const pick = p.locator("#profPick [data-slot], #profPick button").first();
    if (await pick.count()) await pick.click().catch(() => {});
    await f.locator("[name=priceBs]").fill("15");
    await f.locator("[name=until]").fill("2027-01-10");
    await p.waitForFunction(() => !document.querySelector("#sellBtn").disabled);
    assert.match(await p.locator("#sellBtn").innerText(), /Bs\.? ?15/);
    assert.match(await p.locator("#sellSummary").innerText(), /10\/01\/2027/);
    assert.ok((await f.locator("[name=priceBs]").boundingBox()).height >= 44);
    await p.locator("#sellBtn").click();
    await p.waitForFunction(() => /Venta registrada/.test(document.body.innerText), null, { timeout: 15_000 });
    await p.waitForTimeout(500);
    const a = Object.values(e.s.assignments).find((x) => x.customerId === ale.id && x.status === "active");
    assert.ok(a, "se vendió");
    assert.equal(e.s.orders[a.orderId].total, 1500, "cobró Bs 15");
    assert.equal(new Date(a.customerExpiresAt).toISOString().slice(0, 10), "2027-01-11", "vence el 10/01 a la noche (hora de Bolivia)");
    // Revendedor: sí ve el de revendedores.
    await p.goto(base + "/panel#vender"); await f.waitFor();
    await f.locator("[name=customerName]").fill("Rev Ficticio · +59170000002");
    await p.waitForTimeout(300);
    assert.equal(await p.locator('[data-pick="dza"]').isVisible(), true);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
