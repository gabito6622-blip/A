// 🧮 Descuento por cantidad (20/11/2026, pedido del dueño: «Aracely, si renueva 10 de un saque, Bs 65; una por una, Bs 67»).
// Regla por revendedor: desde N cuentas renovadas juntas, cada una al precio rebajado. Solo en Bs. Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

const asR = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });

test("descuento por cantidad: desde N juntas cada una más barata; menos, precio normal; el dueño lo pone y lo quita", { timeout: 60_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-cantidad-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dza", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 7000, published: true, resellersOnly: true });
  for (let i = 0; i < 4; i++) s.inventory.addAccount(owner, { productId: "dza", email: `c${i}@ficticio.lat`, password: "Clave#1", supplierExpiresAt: Date.now() + 120 * 864e5, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  const ara = s.catalog.createCustomer(owner, { name: "ARIt · Aracely", phone: "+59170000432" });
  e.tx(() => { ara.kind = "reseller"; });
  s.orders.create(owner, { customerId: ara.id, items: [{ productId: "dza", qty: 4 }], paymentMethod: "cash" });
  const ids = Object.values(e.s.assignments).map((a) => a.id);
  e.tx(() => { for (const id of ids) e.s.assignments[id].control = { ...(e.s.assignments[id].control ?? {}), price: 6700 }; });
  s.orders.adjustBalance?.(owner, ara.id, 100000, "saldo de prueba") ?? e.tx(() => {});
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const post = (u, b) => fetch(base + u, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify(b) });
    assert.equal((await post(`/api/admin/bulk-renew/${ara.id}`, { min: 1, price: 6500 })).status, 400, "desde 2 o más");
    assert.equal((await post(`/api/admin/bulk-renew/${ara.id}`, { min: 3, price: 6500 })).status, 200);
    const list = await (await fetch(base + "/api/admin/bulk-renew", { headers: { cookie: ck } })).json();
    assert.deepEqual(list.find((x) => x.id === ara.id).rule, { min: 3, price: 6500 });

    const R = asR(ara);
    const two = s.rmes.renewPreview(R, ids.slice(0, 2));
    assert.equal(two.total, 13400, "2 juntas: precio normal (Bs 67 c/u)");
    assert.equal(two.bulkRule.applied, false);
    const three = s.rmes.renewPreview(R, ids.slice(0, 3));
    assert.equal(three.total, 19500, "3 juntas: Bs 65 c/u");
    assert.ok(three.rows.every((r) => r.bulk && r.price === 6500 && r.listPrice === 6700));
    const done = s.rmes.renewMany(R, { ids: ids.slice(0, 3), paymentMethod: "qr" });
    assert.equal(done.total, 19500, "se cobra lo mismo que mostró");
    assert.ok(done.orders.every((o) => o.total === 6500));

    assert.equal((await post(`/api/admin/bulk-renew/${ara.id}`, {})).status, 200, "quitar");
    assert.equal(e.s.customers[ara.id].bulkRenew, undefined);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
