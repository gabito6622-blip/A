// Deuda con la tienda en la tarjeta de la cuenta (14/11/2026). El dueño: «Me debe 27 Bs, eso debe salir en su perfil
// de revendedor en esa cuenta». Caso real (con datos ficticios acá): la revendedora pagó Bs 43 de Bs 70 por una
// cuenta; el saldo de Bs 27 se anota en el Fiado atado a ese alquiler y ella lo ve en su GaboHub, en esa tarjeta.
// Otro revendedor no ve nada; cuando paga, desaparece. 360 px.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("la deuda con la tienda sale en la tarjeta de ESA cuenta, solo para su dueña, y se va al pagar", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-deuda-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  s.catalog.upsertSupplier(owner, { id: "a", name: "A", active: true });
  for (const em of ["uno@x.lat", "dos@x.lat", "tres@x.lat"]) s.inventory.addAccount(owner, { productId: "dis", supplierId: "a", email: em, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 365 * 86_400_000, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  const liz = s.catalog.createCustomer(owner, { name: "Liz Prueba", phone: "+59162000001", kind: "reseller", priceGroupId: "revendedor" });
  const otra = s.catalog.createCustomer(owner, { name: "Otra Prueba", phone: "+59162000002", kind: "reseller", priceGroupId: "revendedor" });
  const o1 = s.orders.create(owner, { customerId: liz.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "a" });
  const o2 = s.orders.create(owner, { customerId: liz.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "b" });
  s.orders.create(owner, { customerId: otra.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "c" });
  const aid = o1.assignmentIds[0], aid2 = o2.assignmentIds[0];
  s.fiado.charge(owner, { customerId: liz.id, amount: 2700, note: "Saldo: pagó Bs 43 de Bs 70", assignmentId: aid });

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const login = async (c) => { const { pin } = await (await post(`/api/admin/customers/${c.id}/login-pin`, {}, ock)).json(); return (await post("/api/auth/customer/pin", { phone: c.phone, pin })).headers.get("set-cookie").split(";")[0]; };
    const lck = await login(liz), ock2 = await login(otra);
    const get = (p, ck) => fetch(base + p, { headers: { cookie: ck } }).then((r) => r.json());
    const lsvc = await get("/api/me/services", lck);
    const arr = Array.isArray(lsvc) ? lsvc : lsvc.services ?? lsvc.list ?? [];
    assert.equal(arr.find((x) => x.assignmentId === aid)?.storeOwed, 2700, "por la API: Bs 27 en esa cuenta");
    assert.equal(arr.find((x) => x.assignmentId === aid2)?.storeOwed, undefined);
    const osvc = await get("/api/me/services", ock2);
    assert.ok(!JSON.stringify(osvc).includes("storeOwed"), "la otra revendedora no ve nada");

    if (chromium) {
      const b = await chromium.launch();
      try {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
        await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
        await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); localStorage.setItem("gs-acc-view", "clasica"); } catch { /* */ } }, liz.id);
        const [n, v] = lck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        await p.goto(base + "/hub#cuentas");
        const owed = p.locator(".svc-owed");
        await owed.first().waitFor();
        assert.equal(await owed.count(), 1, "solo en una tarjeta");
        assert.match(await owed.innerText(), /Le debés a la tienda Bs\s?27 por esta cuenta/);
        assert.match(await p.locator(".svc", { has: owed }).textContent(), /uno@x\.lat/, "en la tarjeta de ESA cuenta (el correo va en «Ver correo y contraseña»)");
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false);
        assert.deepEqual(errs, []);
        await ctx.close();
      } finally { await b.close(); }
    }

    // Paga los Bs 27: la deuda desaparece de su tarjeta.
    s.fiado.pay(owner, { customerId: liz.id, amount: 2700, note: "pagó" });
    const after = await get("/api/me/services", lck);
    assert.ok(!JSON.stringify(after).includes("storeOwed"), "después de pagar ya no sale");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
