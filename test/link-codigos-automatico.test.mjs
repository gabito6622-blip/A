// El link de códigos se crea solo al cobrar una venta (17/11/2026, pedido del dueño). No manda nada: solo genera el link.
// Datos ficticios; nada se manda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
const DAY = 864e5;

test("venta cobrada: el cliente recibe su link de códigos sin que lo pidan; no pisa el que ya tenía", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-linkauto-"));
  try {
    const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix Premium HD 4K", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
    s.inventory.addAccount(owner, { productId: "nf", supplierId: "p", email: "autolink@ficticio.lat", password: "Clave#1", supplierExpiresAt: Date.now() + 30 * DAY, cost: 0, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }] });
    const nuevo = s.catalog.createCustomer(owner, { name: "Cliente Nuevo", phone: "+59170000031", kind: "customer" });
    const conLink = s.catalog.createCustomer(owner, { name: "Cliente Con Link", phone: "+59170000032", kind: "customer" });
    s.codes.setLink(owner, conLink.id, "tokenviejo1234567890abc");
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    try {
      const login = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const post = (body) => fetch(base + "/api/admin/orders", { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }).then((r) => r.json());
      const o1 = await post({ customerId: nuevo.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", idempotencyKey: "auto-1" });
      assert.equal(o1.status, "fulfilled", "la venta en efectivo queda cobrada");
      assert.ok(e.s.customers[nuevo.id].codeLink?.token, "el cliente nuevo ya tiene su link");
      const o2 = await post({ customerId: conLink.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", idempotencyKey: "auto-2" });
      assert.equal(o2.status, "fulfilled");
      assert.equal(e.s.customers[conLink.id].codeLink.token, "tokenviejo1234567890abc", "el link que ya tenía no se cambia");
    } finally { await app.close?.(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
