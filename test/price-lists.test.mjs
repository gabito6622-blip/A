// Listas de precios por país/cliente + moneda configurable.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

describe("listas de precios y moneda", () => {
  let dir, app, base, owner, clock, panama;
  const call = async (method, path, body, cookie) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-pl-"));
    clock = { t: Date.now(), now() { return this.t; } };
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    owner = lr.headers.get("set-cookie").split(";")[0];
    await call("POST", "/api/admin/products", { id: "flujo", name: "Flujo TV", kind: "full_account", durationDays: 30, price: 3500, published: true }, owner);
    await call("POST", "/api/admin/products", { id: "disney", name: "Disney", kind: "profile", durationDays: 30, price: 2000, published: true }, owner);
    const c = await call("POST", "/api/admin/customers", { name: "Cliente Panamá", phone: "+507 60000000" }, owner);
    panama = c.json.id;
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("moneda configurable: se guarda y vuelve en /api/settings", async () => {
    assert.equal((await call("GET", "/api/settings")).json.currencySymbol, "Bs");
    assert.equal((await call("POST", "/api/admin/settings", { currencySymbol: "US$" }, owner)).status, 200);
    assert.equal((await call("GET", "/api/settings")).json.currencySymbol, "US$");
    assert.equal((await call("POST", "/api/admin/settings", { currencySymbol: "" }, owner)).status, 400, "símbolo vacío no vale");
  });

  test("se crea una lista 'Panamá' con precios propios por producto", async () => {
    const r = await call("POST", "/api/admin/price-groups", { id: "lp-panama", name: "Panamá (US$)", prices: { flujo: 290, disney: 700 } }, owner);
    assert.equal(r.status, 200);
    const groups = (await call("GET", "/api/admin/price-groups", undefined, owner)).json;
    const g = groups.find((x) => x.id === "lp-panama");
    assert.ok(g, "la lista existe");
    assert.equal(g.prices.flujo, 290);
    assert.equal(g.prices.disney, 700);
  });

  test("al asignar la lista al cliente, ve SUS precios (no el base)", async () => {
    await call("POST", `/api/admin/customers/${panama}`, { priceGroupId: "lp-panama" }, owner);
    // El catálogo visible para ese cliente usa los precios de su lista.
    const cat = app.store.catalog.publicCatalog(panama);
    const flujo = cat.find((p) => p.id === "flujo");
    const disney = cat.find((p) => p.id === "disney");
    assert.equal(flujo.price, 290, "Flujo a 2.90 para Panamá");
    assert.equal(disney.price, 700, "Disney a 7.00 para Panamá");
  });

  test("un cliente sin lista sigue viendo el precio base", async () => {
    const other = await call("POST", "/api/admin/customers", { name: "Cliente Bolivia", phone: "+591 70000001" }, owner);
    const cat = app.store.catalog.publicCatalog(other.json.id);
    assert.equal(cat.find((p) => p.id === "flujo").price, 3500, "precio base");
  });

  test("el precio de venta real sale de la lista del cliente, no del que mande", async () => {
    // Venta en efectivo al cliente de Panamá: el total usa el precio de su lista (2.90 = 290 centavos).
    await call("POST", "/api/admin/accounts", { productId: "flujo", email: "line@x.lat", password: "k", profiles: [{ label: "Cuenta completa" }], cost: 0, supplierExpiresAt: clock.now() + 60 * 864e5 }, owner);
    const order = await call("POST", "/api/admin/orders", { customerId: panama, items: [{ productId: "flujo", qty: 1 }], paymentMethod: "cash" }, owner);
    assert.equal(order.status, 200, JSON.stringify(order.json));
    assert.equal(order.json.total, 290, "cobró el precio de la lista de Panamá");
  });
});
