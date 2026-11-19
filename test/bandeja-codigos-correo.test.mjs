// Bandeja de códigos tipo correo (18/11/2026, pedido del dueño): como yopmail, lo más nuevo arriba, buscador por
// correo, «hace X min» y código grande con Copiar, sin recargar. Datos ficticios; /api/me/codes se simula.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("Bandeja de códigos tipo correo: lo nuevo arriba, buscador y código para copiar", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-bandeja-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Secreta#9", supplierExpiresAt: Date.now() + 90 * 86_400_000, cost: 1000, profiles: [{ label: "P1" }] });
  const rosa = s.catalog.createCustomer(owner, { name: "Rosa Prueba", phone: "+59170000123" });
  s.engine.tx(() => { rosa.email = "rosa@prueba.lat"; });
  s.orders.create(owner, { customerId: rosa.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    if (chromium) {
      const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
      const { pin } = await (await post(`/api/admin/customers/${rosa.id}/login-pin`, {}, ock)).json();
      const ck = (await post("/api/auth/customer/pin", { phone: rosa.phone, pin })).headers.get("set-cookie").split(";")[0];
      const br = await chromium.launch();
      try {
        const ctx = await br.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
        await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const now = Date.now();
        const codes = [
          { to: "viejo@x.lat", product: "Disney+", kind: "verificacion", code: "111111", receivedAt: now - 20 * 6e4 },
          { to: "nf@x.lat", product: "Netflix", kind: "login", code: "222222", receivedAt: now - 30e3 },
          { to: "otro@x.lat", product: "Netflix", kind: "hogar", code: "333333", receivedAt: now - 5 * 6e4 },
          { to: "mas@x.lat", product: "Max", kind: "otro", code: "444444", receivedAt: now - 60 * 6e4 },
        ];
        await ctx.route(/\/api\/me\/codes(\?|$)/, (r) => r.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(codes) }));
        const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        await p.goto(base + "/tienda/#codigos");
        await p.locator(".mrow").first().waitFor();
        assert.equal(await p.locator(".mrow").count(), 4);
        assert.match(await p.locator(".mrow").first().textContent(), /222222/, "lo más nuevo arriba");
        assert.match(await p.locator(".mrow").first().textContent(), /recién/);
        assert.match(await p.locator(".minbox").textContent(), /Se actualiza sola/);
        await p.fill("#cq", "viejo");
        await p.waitForFunction(() => document.querySelectorAll(".mrow").length === 1);
        assert.match(await p.locator(".mrow").textContent(), /111111/);
        const btn = p.locator(".mrow .sbtn").first();
        assert.ok((await btn.boundingBox()).height >= 44, "botón Copiar de 44 px");
        assert.deepEqual(errs, []);
      } finally { await br.close(); }
    }
  } finally { await app.close?.(); rmSync(dir, { recursive: true, force: true }); }
});
