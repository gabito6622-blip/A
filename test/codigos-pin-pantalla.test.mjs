// Link de códigos con PIN, EN EL NAVEGADOR (14/11/2026). Una revisión «en el lugar del cliente» encontró que al
// escribir el PIN la página mostraba «Cannot access 'keep' before initialization» y nunca el código: dentro de
// show() una variable local se llamaba igual que la función keep() de arriba. La prueba vieja (codes.test.mjs) solo
// miraba la API, por eso no lo vio. Datos ficticios, 360 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("link de códigos con PIN: escribir el PIN muestra el código, sin errores", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-codpin-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf-ana@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * 86_400_000, cost: 1000, profiles: [{ label: "P1" }] });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Prueba", phone: "+59170001122" });
  s.orders.create(owner, { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
  const mbx = s.codes.configureMailbox(owner, { address: "codigos.tienda@gmail.com", host: "imap.gmail.com" }).id;
  s.codes.ingest(owner, mbx, { to: "nf-ana@x.lat", from: "Netflix <info@account.netflix.com>", subject: "Tu código de inicio de sesión", body: "Hola,\nIngresá este código para iniciar sesión:\n4815\n", receivedAt: Date.now() });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const lk = await (await post(`/api/admin/customers/${ana.id}/code-link`, { pin: "2580" }, ock)).json();
    const path = new URL(lk.url).pathname;
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + path);
    const ins = p.locator(".pin input");
    await ins.first().waitFor();
    for (const [i, d] of [..."2580"].entries()) await ins.nth(i).fill(d);
    const send = p.locator("#f button[type=submit]");
    if (await send.count() && await send.isVisible()) await send.click().catch(() => {});
    await p.locator(".code .v", { hasText: "4815" }).waitFor({ timeout: 10_000 });
    assert.match(await p.locator("#app").innerText(), /Netflix/);
    assert.deepEqual(errs, [], "sin errores en la página");
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
