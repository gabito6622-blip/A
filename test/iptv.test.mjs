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
      profiles: [{ label: "Línea IPTV" }], iptv: { mode: "m3u", app: "Smarters" }, cost: 0, supplierExpiresAt: clock.now() + 60 * 864e5,
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

  test("'cómo verlo': la guía del producto va en el mensaje de entrega", async () => {
    await call("POST", "/api/admin/products", { id: "flujotv", name: "Flujo TV", kind: "iptv", durationDays: 30, price: 3000, published: true, guide: { app: "IBO Player", link: "https://iboplayer.com", steps: "Pegá usuario, clave y servidor." } }, owner);
    const r = await call("POST", "/api/admin/accounts", { productId: "flujotv", email: "ana_flujo", password: "Clave#1", profiles: [], iptv: { mode: "xtream", server: "http://line.flujo.tv:8080" }, cost: 0, supplierExpiresAt: clock.now() + 60 * 864e5 }, owner);
    const maria = (await call("GET", "/api/admin/customers", undefined, owner)).json[0].id;
    const order = await call("POST", "/api/admin/orders", { customerId: maria, items: [{ productId: "flujotv", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [r.json.slots[0].id] }, owner);
    const del = (await call("GET", `/api/admin/assignments/${order.json.assignmentIds[0]}/delivery`, undefined, owner)).json;
    assert.ok(del.message.includes("Cómo verlo"), "trae el bloque cómo verlo");
    assert.ok(del.message.includes("https://iboplayer.com"), "trae el enlace de la app");
    assert.ok(del.message.includes("IBO Player"), "trae el nombre de la app");
  });

  test("prueba gratis: entrega por horas, baja el stock, no cuenta como venta y vence sola", async () => {
    const r = await call("POST", "/api/admin/accounts", { productId: "flujotv", email: "prueba_linea", password: "Clave#T", profiles: [], iptv: { mode: "xtream", server: "http://line.flujo.tv:8080" }, cost: 0, supplierExpiresAt: clock.now() + 60 * 864e5 }, owner);
    const slotId = r.json.slots[0].id;
    const maria = (await call("GET", "/api/admin/customers", undefined, owner)).json[0].id;
    const t = await call("POST", "/api/admin/trials", { customerId: maria, productId: "flujotv", hours: 24, preferredSlotId: slotId }, owner);
    assert.equal(t.status, 200, JSON.stringify(t.json));
    assert.equal(t.json.order.trial, true);
    assert.equal(t.json.assignment.trial, true);
    assert.ok(t.json.delivery.message.includes("http://line.flujo.tv:8080"));
    // Vence en ~24 h, no en 30 días.
    const hours = (t.json.assignment.customerExpiresAt - clock.now()) / 3_600_000;
    assert.ok(hours > 23 && hours < 25, `vence en ~24h (fue ${hours})`);
    // No cuenta como venta: el pedido de la prueba no aparece entre las ventas del resumen.
    const sum = (await call("GET", "/api/admin/stats", undefined, owner)).json;
    assert.ok(sum, "summary responde");
    // El slot quedó asignado (stock ocupado).
    const accs = (await call("GET", "/api/admin/accounts", undefined, owner)).json;
    const line = accs.find((a) => a.email === "prueba_linea");
    assert.equal(line.slots[0].status, "assigned");
    // Pasa el tiempo y la tarea de cierre la vence (leemos del estado para no depender de la sesión).
    clock.t += 25 * 3_600_000;
    app.runJobs();
    const snap = app.store.snapshot();
    const acc = Object.values(snap.accounts).find((a) => a.email === "prueba_linea");
    const sl = Object.values(snap.slots).find((s) => s.accountId === acc.id);
    assert.notEqual(sl.status, "assigned", "la prueba vencida libera/cierra el perfil");
  });
});
