// «🗂️ Resumen del mediodía» al celular del dueño (13/11/2026): una vez por día, desde las 12:00 de Bolivia, un aviso con
// lo que Mi secretaria tiene pendiente, que abre esa pantalla. Sin pendientes no molesta; se puede apagar; lo ya
// marcado «Ya le avisé» no cuenta. El envío va por un doble (fetchImpl): nada sale a internet.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { generateVapidKeys } from "../dist/server/push.js";

const DAY = 864e5, HOUR = 36e5, FCM = "https://fcm.googleapis.com/fcm/send/abc123";

test("resumen del mediodía: a las 12:00, una vez por día, con los pendientes; apagable; sin pendientes no avisa", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-mediodia-"));
  const sent = [];
  const clock = { t: Date.UTC(2026, 10, 13, 13, 0), now() { return this.t; } }; // 09:00 en Bolivia
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock, vapid: { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" }, fetchImpl: async (url, init) => { sent.push({ url, init }); return new Response("", { status: 201 }); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const login = async () => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const call = async (m, p, body) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: await login() }, body: body ? JSON.stringify(body) : undefined }); return r.json(); };
    const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
    s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ (alquiler)", kind: "full_account", durationDays: 30, price: 6900, published: true });
    const oby = s.catalog.createCustomer(owner, { name: "oby · Ovidio Ficticio", phone: "+59170000001", kind: "reseller" });
    const ari = s.catalog.createCustomer(owner, { name: "Ari Ficticia", phone: "+59170000002", kind: "reseller" });
    const sell = (c, email, expDays, control) => {
      s.inventory.addAccount(owner, { productId: "dis", email, password: "Clave-Larga#1", supplierExpiresAt: clock.t + 200 * DAY, cost: 3000, profiles: [{ label: "Cuenta completa" }] });
      const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" });
      s.orders.setExpiry(owner, o.assignmentIds[0], clock.t + expDays * DAY);
      s.orders.setControl(owner, o.assignmentIds[0], control);
      return o.assignmentIds[0];
    };
    // Sin celular suscrito: no hace nada (ni marca el día).
    clock.t += 3.5 * HOUR; // 12:30
    await app.checkNoonPush();
    assert.equal(sent.length, 0);
    await call("POST", "/api/admin/push/subscribe", { subscription: { endpoint: FCM, keys: { p256dh: "a", auth: "b" } }, label: "Android" });
    assert.equal((await call("GET", "/api/admin/push")).noon, true, "prendido de fábrica");
    // Sin pendientes: no molesta (pero ya contó el día).
    await app.checkNoonPush();
    assert.equal(sent.length, 0, "sin pendientes no avisa");
    // Día siguiente, con pendientes. Antes de las 12 no avisa.
    const cobro = sell(ari, "ari.cobro@ejemplo.lat", -1, { note: "🔔 EN COBRO desde ayer", payStatus: "pendiente" });
    const a1 = sell(oby, "oby.uno@ejemplo.lat", 1, { payStatus: "pagado" });
    sell(oby, "oby.dos@ejemplo.lat", 2, { payStatus: "pagado" });
    clock.t += 20 * HOUR; // 08:30 del día siguiente
    await app.checkNoonPush();
    assert.equal(sent.length, 0, "a las 8:30 todavía no");
    clock.t += 4 * HOUR; // 12:30
    await app.checkNoonPush();
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, FCM);
    let latest = await call("GET", "/api/admin/push/latest");
    assert.deepEqual([latest.title, latest.go], ["🗂️ Mediodía: 1 en cobro · 2 por avisar", "secretaria"]);
    assert.equal(latest.body, "Cobrar o cortar: Ari\nAvisar: oby", "usa el apodo, como los conoce el dueño");
    // Un celular de Atención (seller) no recibe el resumen: Mi secretaria es del dueño y de admins.
    const mkStaff = await call("POST", "/api/admin/staff", { username: "seba", name: "Seba Ventas", role: "seller", password: "clave-larga-seller-1" });
    assert.ok(mkStaff.id || mkStaff.staff?.id || mkStaff.ok !== false);
    const sck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "seba", password: "clave-larga-seller-1" }) })).headers.get("set-cookie").split(";")[0];
    const subSeller = await fetch(base + "/api/admin/push/subscribe", { method: "POST", headers: { "content-type": "application/json", cookie: sck }, body: JSON.stringify({ subscription: { endpoint: FCM + "-seller", keys: { p256dh: "a", auth: "b" } }, label: "Atención" }) });
    assert.equal(subSeller.status, 200);
    // El mismo día no repite.
    clock.t += 2 * HOUR; await app.checkNoonPush();
    assert.equal(sent.length, 1);
    // Día siguiente: lo que ya marcó «Ya le avisé» no cuenta. (oby.uno venció: pasa a vencidas sin anotar.)
    s.orders.markNoticed(owner, [a1]);
    clock.t += 22 * HOUR; // 12:30
    s.orders.markNoticed(owner, Object.values(s.engine.s.assignments).filter((a) => a.id !== cobro && a.id !== a1).map((a) => a.id));
    await app.checkNoonPush();
    assert.equal(sent.length, 2);
    assert.ok(!sent.some((x) => x.url.endsWith("-seller")), "el celular de Atención no recibió el resumen");
    latest = await call("GET", "/api/admin/push/latest");
    assert.equal(latest.title, "🗂️ Mediodía: 1 en cobro · 1 vencida sin anotar");
    // Apagado: no avisa más. De noche tampoco.
    const cfg = await call("POST", "/api/admin/push/config", { alerts: ["payment"], noon: false });
    assert.equal(cfg.noon, false);
    assert.equal((await call("GET", "/api/admin/push")).noon, false);
    clock.t += 24 * HOUR; await app.checkNoonPush();
    assert.equal(sent.length, 2, "apagado");
    await call("POST", "/api/admin/push/config", { alerts: ["payment"], noon: true });
    clock.t += 9 * HOUR; // 21:30
    await app.checkNoonPush();
    assert.equal(sent.length, 2, "de noche no manda el resumen atrasado");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
