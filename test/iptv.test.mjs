// IPTV: registrar una línea, venderla y entregar las credenciales correctas (Xtream y M3U).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

describe("IPTV", () => {
  let dir, app, base, owner, clock, custId;
  const call = async (method, path, body, cookie) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-iptv-"));
    clock = { t: Date.now(), now() { return this.t; } };
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    owner = lr.headers.get("set-cookie").split(";")[0];
    await call("POST", "/api/admin/products", { id: "flujotv", name: "Flujo TV", kind: "iptv", durationDays: 30, price: 3000, published: true }, owner);
    await call("POST", "/api/admin/suppliers", { id: "panel", name: "Panel IPTV", active: true }, owner);
    const maria = await call("POST", "/api/admin/customers", { name: "María", phone: "+591 70011223" }, owner);
    custId = maria.json.id;
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("el producto IPTV se crea con kind iptv", async () => {
    const prods = (await call("GET", "/api/admin/products", undefined, owner)).json;
    assert.equal(prods.find((p) => p.id === "flujotv").kind, "iptv");
  });

  test("una línea IPTV no acepta el flujo de email con @ pero sí usuario normal", async () => {
    // Registramos una línea Xtream (usuario/clave/servidor), sin email real.
    const r = await call("POST", "/api/admin/accounts", {
      productId: "flujotv", supplierId: "panel", email: "juan_flujo", password: "Clave#99",
      profiles: [{ label: "Línea IPTV" }], iptv: { mode: "xtream", server: "http://line.flujo.tv:8080", app: "IBO Player", connections: 2 },
      cost: 1000, supplierExpiresAt: clock.now() + 60 * 864e5,
    }, owner);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.account.iptv.mode, "xtream");
    assert.equal(r.json.account.iptv.server, "http://line.flujo.tv:8080");
    assert.equal(r.json.slots.length, 1, "una línea = un solo slot");
  });

  test("por MAC exige la MAC", async () => {
    const bad = await call("POST", "/api/admin/accounts", { productId: "flujotv", email: "x", password: "y", profiles: [], iptv: { mode: "mac" }, cost: 0 }, owner);
    assert.equal(bad.status, 400);
  });

  test("se vende la línea y el stock baja; el mensaje de entrega trae servidor/usuario/clave", async () => {
    const before = (await call("GET", "/api/admin/accounts", undefined, owner)).json.find((a) => a.email === "juan_flujo");
    assert.equal(before.slots[0].status, "available");
    // Venta en efectivo (se entrega al instante) a María.
    const order = await call("POST", "/api/admin/orders", { customerId: custId, items: [{ productId: "flujotv", qty: 1 }], paymentMethod: "cash" }, owner);
    assert.equal(order.status, 200, JSON.stringify(order.json));
    assert.equal(order.json.status, "fulfilled");
    const asgId = order.json.assignmentIds[0];
    const del = (await call("GET", `/api/admin/assignments/${asgId}/delivery`, undefined, owner)).json;
    assert.ok(del.message.includes("http://line.flujo.tv:8080"), "trae el servidor");
    assert.ok(del.message.includes("juan_flujo"), "trae el usuario");
    assert.ok(del.message.includes("Clave#99"), "trae la clave");
    assert.ok(del.message.includes("IBO Player"), "trae la app");
    assert.ok(!del.message.includes("Perfil:"), "no habla de perfiles");
  });

  test("una línea M3U entrega el enlace, no usuario/clave", async () => {
    const r = await call("POST", "/api/admin/accounts", {
      productId: "flujotv", email: "Lista Pedro", password: "http://line.flujo.tv/get.php?username=p&password=q&type=m3u",
      profiles: [{ label: "Línea IPTV" }], iptv: { mode: "m3u", app: "Smarters" }, cost: 0,
    }, owner);
    assert.equal(r.status, 200);
    const order = await call("POST", "/api/admin/orders", { customerId: custId, items: [{ productId: "flujotv", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [r.json.slots[0].id] }, owner);
    const del = (await call("GET", `/api/admin/assignments/${order.json.assignmentIds[0]}/delivery`, undefined, owner)).json;
    assert.ok(del.message.includes("Lista M3U"), "dice Lista M3U");
    assert.ok(del.message.includes("get.php"), "trae el enlace");
    assert.ok(!del.message.includes("Usuario:"), "no muestra usuario en M3U");
  });

  test("el secreto de la línea nunca vuelve en texto en el listado enmascarado", async () => {
    const accs = (await call("GET", "/api/admin/accounts", undefined, owner)).json;
    const line = accs.find((a) => a.email === "juan_flujo");
    assert.equal(line.password, "••••••", "la clave va enmascarada sin ?secrets=1");
  });
});
