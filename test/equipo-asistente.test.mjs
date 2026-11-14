// Llave del asistente (14/11/2026). Primero se limitó en la revisión de seguridad del equipo; después el dueño decidió:
// «vos sos mi asistente de todo mi panel de super administrador, sí tenés derecho» → «Como un admin».
// Entonces: puede todo lo que puede un admin (contraseñas, PIN y links, Excel, páginas de revendedores), NO vence sola,
// todo queda en la Auditoría, no dispara avisos al celular del dueño y NO toca usuarios, contraseñas del equipo ni
// permisos. Todo con datos ficticios.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { assistantBlocked, assistKeyCheck } from "../dist/server/teamSecurity.js";

const DAY = 86_400_000;
const T0 = Date.UTC(2026, 10, 14, 15, 0); // 14/11 11:00 en Bolivia
const SECRET = "Clave-Secreta#77";

describe("Llave del asistente: como un admin, sin tocar usuarios", () => {
  let app, base, dir, ock, lck, pck, key, ana, rosa, aid;
  const clock = { t: T0, now() { return this.t; } };
  const call = async (method, p, body, auth) => {
    const headers = { "content-type": "application/json", ...(auth?.startsWith("gsa_") ? { authorization: `Bearer ${auth}` } : auth ? { cookie: auth } : {}) };
    const r = await fetch(base + p, { method, headers, ...(body ? { body: JSON.stringify(body) } : {}) });
    const t = await r.text(); let json; try { json = JSON.parse(t); } catch { json = t; }
    return { status: r.status, json, ck: r.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = async (username, password) => (await call("POST", "/api/auth/staff/login", { username, password })).ck;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-equipoB-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const s = app.store, owner = { id: "t", role: "owner" };
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "netflix@x.lat", password: SECRET, supplierExpiresAt: T0 + 90 * DAY, cost: 1111, profiles: [{ label: "P1", pin: "4321" }, { label: "P2" }, { label: "P3" }] });
    ana = s.catalog.createCustomer(owner, { name: "Ana Tienda", phone: "+59170000001" });
    rosa = s.catalog.createCustomer(owner, { name: "Rosa Mamani", phone: "+59171111111", kind: "reseller" });
    aid = s.orders.create(owner, { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    ock = await login("gabriel", "clave-del-dueño-123");
    await call("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "admin", password: "clave-de-lucia-123" }, ock);
    await call("POST", "/api/admin/staff", { username: "pedro", name: "Pedro", role: "seller", password: "clave-de-pedro-123" }, ock);
    lck = await login("lucia", "clave-de-lucia-123");
    pck = await login("pedro", "clave-de-pedro-123");
    const r = await call("POST", "/api/admin/assistant", {}, ock);
    assert.equal(r.status, 200);
    key = r.json.token;
    assert.equal(r.json.expiresAt, undefined, "la llave nueva no vence sola");
  });
  after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  test("puede todo lo de un admin: leer, vender, ver contraseñas, entregar, dar PIN y links, Excel y revendedores", async () => {
    assert.equal((await call("GET", "/api/admin/products", null, key)).status, 200);
    const c = await call("POST", "/api/admin/customers", { name: "Cliente del asistente", phone: "+59175555555" }, key);
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const o = await call("POST", "/api/admin/orders", { customerId: c.json.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", idempotencyKey: "asis-1" }, key);
    assert.equal(o.status, 200, JSON.stringify(o.json));
    assert.equal((await call("GET", "/api/admin/accounts?secrets=1", null, key)).status, 200, "ve contraseñas como un admin");
    const d = await call("GET", `/api/admin/assignments/${aid}/delivery`, null, key);
    assert.equal(d.json.password, SECRET, "entrega con la clave, como un admin");
    assert.equal(d.json.pin, "4321");
    for (const p of [`/api/admin/customers/${ana.id}/login-pin`, `/api/admin/customers/${rosa.id}/login-link`]) {
      assert.equal((await call("POST", p, {}, key)).status, 200, p);
    }
    for (const p of ["/api/admin/export/clientes", "/api/admin/descargas/reporte.xlsx"]) assert.equal((await call("GET", p, null, key)).status, 200, p);
    // Lo que hace queda en la Auditoría con su nombre.
    const aud = (await call("GET", "/api/admin/audit", null, ock)).json;
    const list = Array.isArray(aud) ? aud : aud.list ?? aud.events ?? [];
    const asisId = (await call("GET", "/api/admin/staff", null, ock)).json.find((u) => u.username === "asistente").id;
    assert.ok(list.some((a) => a.actorId === asisId && a.action === "customer.login_pin"), "el PIN que dio el asistente queda en la Auditoría");
  });

  test("no toca usuarios, contraseñas del equipo ni permisos (ni su propio usuario)", async () => {
    const tries = [["POST", "/api/admin/staff", { username: "otro", name: "Otro", role: "admin", password: "clave-larga-123" }], ["GET", "/api/admin/staff"],
      ["POST", "/api/admin/assistant", {}], ["POST", "/api/admin/assistant/off", {}], ["POST", "/api/admin/me/password", { current: "x", next: "clave-nueva-123" }], ["POST", "/api/admin/me/2fa/setup", {}]];
    for (const [m, p, b] of tries) {
      const r = await call(m, p, b, key);
      assert.equal(r.status, 403, `${m} ${p}`);
      assert.match(r.json.message, /usuarios/);
    }
  });

  test("las rutas bloqueadas: solo usuarios y permisos", () => {
    assert.ok(assistantBlocked("POST", "/api/admin/staff"));
    assert.ok(assistantBlocked("POST", "/api/admin/assistant/off"));
    assert.equal(assistantBlocked("POST", "/api/admin/customers/c_1/login-pin"), null);
    assert.equal(assistantBlocked("GET", "/api/admin/export/clientes"), null);
    assert.equal(assistantBlocked("POST", "/api/admin/orders"), null);
  });

  test("no vence sola: sigue andando después de 7 días y de un año; el dueño la apaga o la cambia", async () => {
    clock.t = T0 + 400 * DAY;
    assert.equal((await call("GET", "/api/admin/products", null, key)).status, 200);
    ock = await login("gabriel", "clave-del-dueño-123");
    const st = (await call("GET", "/api/admin/assistant", null, ock)).json;
    assert.equal(st.expired, false);
    assert.equal(st.expiresAt, null);
    const nueva = (await call("POST", "/api/admin/assistant", {}, ock)).json;
    assert.equal((await call("GET", "/api/admin/products", null, nueva.token)).status, 200);
    assert.equal((await call("GET", "/api/admin/products", null, key)).status, 401, "la vieja ya no sirve");
    await call("POST", "/api/admin/assistant/off", {}, ock);
    assert.equal((await call("GET", "/api/admin/products", null, nueva.token)).status, 401, "apagada no entra");
    assert.deepEqual(assistKeyCheck({ hash: "h", staffId: "s", createdAt: 0 }, 1e15), { expired: false });
    assert.deepEqual(assistKeyCheck({ hash: "h", staffId: "s", createdAt: 0, expiresAt: 10 }, 11), { expired: true }, "una fecha guardada se respeta");
  });
});
