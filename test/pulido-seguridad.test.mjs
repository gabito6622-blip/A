// Pulido GaboHub · seguridad: nadie se adueña de una cuenta con solo saber su correo,
// los correos no se repiten y Atención (seller) no ve costos ni proveedores del dueño.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

async function boot() {
  const dir = mkdtempSync(join(tmpdir(), "gs-pul-"));
  const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const login = async (path, body) => {
    const r = await fetch(base + path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    return { status: r.status, ck: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  const as = (ck) => async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(ck ? { cookie: ck } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j, ck: r.headers.get("set-cookie")?.split(";")[0] ?? "" };
  };
  const owner = as((await login("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).ck);
  return { app, base, login, as, owner, stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("Pulido · seguridad", () => {
  let s;
  before(async () => { s = await boot(); });
  after(() => s.stop());

  test("registrarse con el correo de una cuenta existente (sin clave) NO abre su sesión", async () => {
    const rev = (await s.owner("POST", "/api/admin/customers", { name: "Ariana", phone: "+59171234567", kind: "reseller", email: "ariana@correo.com" })).json;
    assert.ok(rev.id);
    const r = await s.as("")("POST", "/api/auth/customer/register", { name: "Intruso", email: "Ariana@Correo.com", password: "clave-del-intruso" });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /Olvidé mi contraseña/);
    assert.equal(r.ck, "", "no se crea sesión");
    // Y el intruso tampoco puede entrar con esa clave
    assert.equal((await s.login("/api/auth/customer/login-email", { email: "ariana@correo.com", password: "clave-del-intruso" })).status, 401);
  });

  test("un correo nuevo sí crea su propia cuenta", async () => {
    const r = await s.as("")("POST", "/api/auth/customer/register", { name: "Nueva", email: "nueva@correo.com", password: "clave-nueva-1" });
    assert.equal(r.status, 200);
    assert.ok(r.ck);
  });

  test("no se puede crear un cliente con un correo que ya es de otro", async () => {
    const r = await s.owner("POST", "/api/admin/customers", { name: "Copia", phone: "+59170000999", email: "ARIANA@correo.com" });
    assert.equal(r.status, 400);
    assert.match(r.json.message, /ya lo usa otra cuenta/);
  });

  test("Atención (seller) no ve costo de cuentas ni proveedores; el dueño sí", async () => {
    const st = s.app.store, sys = { id: "t", role: "owner" };
    st.catalog.upsertProduct(sys, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    st.catalog.upsertSupplier(sys, { id: "andes", name: "Proveedor Andes", active: true });
    st.inventory.addAccount(sys, { productId: "nf", supplierId: "andes", email: "nf1@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * 864e5, cost: 1234, profiles: [{ label: "P1" }] });
    const cli = (await s.owner("POST", "/api/admin/customers", { name: "Cliente", phone: "+59170001111" })).json;
    assert.equal(st.orders.create(sys, { customerId: cli.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }).status, "fulfilled");
    assert.equal((await s.owner("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-1" })).status, 200);
    const lucia = s.as((await s.login("/api/auth/staff/login", { username: "lucia", password: "clave-de-lucia-1" })).ck);
    const own = (await s.owner("GET", "/api/admin/assignments")).json;
    assert.equal(own[0].accountCost, 1234, "el dueño ve su costo");
    const sel = (await lucia("GET", "/api/admin/assignments")).json;
    assert.equal(sel.length, 1);
    assert.equal(sel[0].accountCost, undefined, "Atención no ve el costo");
    assert.equal(sel[0].accountNotes, undefined);
    assert.deepEqual((await lucia("GET", "/api/admin/suppliers")).json, [], "Atención no ve proveedores");
    assert.equal((await s.owner("GET", "/api/admin/suppliers")).json.length, 1);
  });
});
