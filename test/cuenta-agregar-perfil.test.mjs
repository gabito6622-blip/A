// Agregar un perfil nuevo a una cuenta existente desde la API (18/11/2026, pedido del dueño). Datos ficticios; nada se manda.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
const DAY = 864e5;

test("POST /api/admin/accounts/:id/slots agrega un perfil libre sin tocar los demás", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-addslot-"));
  try {
    const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
    s.catalog.upsertProduct(owner, { id: "dz", name: "Disney+ sin ESPN", kind: "profile", durationDays: 30, price: 1700, published: true });
    s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
    const acc = s.inventory.addAccount(owner, { productId: "dz", supplierId: "p", email: "addslot@ficticio.lat", password: "Clave#1", supplierExpiresAt: Date.now() + 30 * DAY, cost: 0, profiles: [{ label: "Perfil 1" }] }).account;
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    try {
      const login = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
      const cookie = login.headers.get("set-cookie").split(";")[0];
      const post = (url, body) => fetch(base + url, { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) });
      const r1 = await post(`/api/admin/accounts/${acc.id}/slots`, { label: "Perfil 2" });
      assert.equal(r1.status, 200);
      const slot = await r1.json();
      assert.equal(slot.label, "Perfil 2");
      assert.equal(slot.status, "available");
      assert.equal(slot.accountId, acc.id);
      const dup = await post(`/api/admin/accounts/${acc.id}/slots`, { label: "perfil 2" });
      assert.notEqual(dup.status, 200, "no permite perfiles con el mismo nombre");
      const otros = Object.values(e.s.slots).filter((x) => x.accountId === acc.id).map((x) => x.label).sort();
      assert.deepEqual(otros, ["Perfil 1", "Perfil 2"]);
    } finally { await app.close?.(); }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
