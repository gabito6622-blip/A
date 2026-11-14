// Llave del asistente con poder limitado y que vence (revisión de seguridad del equipo, 14/11/2026).
// Entra como un admin propio («asistente») que puede leer el panel y vender, pero NO ve contraseñas, NO da PIN ni
// links de acceso, NO descarga Excel con datos de clientes y NO toca usuarios. La llave dura 7 días; las llaves
// viejas (sin vencimiento) toman 7 días desde su primer uso después del cambio. Todo con datos ficticios.
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

describe("Llave del asistente: poder limitado", () => {
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
    assert.equal(r.json.expiresAt, T0 + 7 * DAY, "la llave nueva vence a los 7 días");
  });
  after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  test("puede leer el panel, cargar clientes y vender", async () => {
    assert.equal((await call("GET", "/api/admin/products", null, key)).status, 200);
    assert.equal((await call("GET", "/api/admin/customers", null, key)).status, 200);
    const c = await call("POST", "/api/admin/customers", { name: "Cliente del asistente", phone: "+59175555555" }, key);
    assert.equal(c.status, 200, JSON.stringify(c.json));
    const o = await call("POST", "/api/admin/orders", { customerId: c.json.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", idempotencyKey: "asis-1" }, key);
    assert.equal(o.status, 200, JSON.stringify(o.json));
    const acc = await call("GET", "/api/admin/accounts", null, key);
    assert.equal(acc.status, 200);
    assert.ok(!JSON.stringify(acc.json).includes(SECRET), "la lista de cuentas sale sin contraseñas");
  });

  test("no ve contraseñas ni PIN de perfiles (ni con «ver contraseñas» ni al entregar)", async () => {
    const sec = await call("GET", "/api/admin/accounts?secrets=1", null, key);
    assert.equal(sec.status, 403);
    assert.match(sec.json.message, /asistente/);
    const d = await call("GET", `/api/admin/assignments/${aid}/delivery`, null, key);
    assert.equal(d.status, 200);
    assert.equal(d.json.password, "");
    assert.equal(d.json.pin, "");
    assert.equal(d.json.secretsHidden, true);
    assert.ok(!d.json.message.includes(SECRET) && !d.json.message.includes("4321"), "el mensaje de entrega no lleva la clave ni el PIN");
    assert.match(d.json.message, /te la paso aparte/);
    // El admin de carne y hueso sigue viendo todo (no se quitó nada).
    assert.equal((await call("GET", "/api/admin/accounts?secrets=1", null, lck)).status, 200);
    assert.equal((await call("GET", `/api/admin/assignments/${aid}/delivery`, null, lck)).json.password, SECRET);
    assert.equal((await call("GET", `/api/admin/assignments/${aid}/delivery`, null, pck)).json.password, SECRET, "Atención entrega con la clave, como siempre");
  });

  test("no da PIN ni links de acceso, ni aprueba revendedores", async () => {
    for (const [p, body] of [[`/api/admin/customers/${ana.id}/login-pin`, {}], [`/api/admin/customers/${rosa.id}/login-pin`, {}], [`/api/admin/customers/${ana.id}/login-link`, {}],
      [`/api/admin/customers/${rosa.id}/code-link`, {}], [`/api/admin/assignments/${aid}/renew-link`, {}], ["/api/admin/reseller-apps/x/approve", {}]]) {
      const r = await call("POST", p, body, key);
      assert.equal(r.status, 403, p);
      assert.match(r.json.message, /asistente/, p);
    }
    assert.equal((await call("POST", `/api/admin/customers/${ana.id}/login-pin`, {}, lck)).status, 200, "el admin sí");
  });

  test("no descarga Excel con datos de clientes", async () => {
    for (const p of ["/api/admin/export/clientes", "/api/admin/export/servicios", "/api/admin/export/todo", "/api/admin/export/ventas", "/api/admin/descargas/reporte.xlsx", "/api/admin/finance/cierre.xlsx"]) {
      const r = await call("GET", p, null, key);
      assert.equal(r.status, 403, p);
      assert.match(r.json.message, /Excel/, p);
    }
    assert.equal((await call("GET", "/api/admin/export/clientes", null, lck)).status, 200, "el admin sí");
  });

  test("no toca usuarios, contraseñas ni permisos (ni su propio usuario)", async () => {
    const tries = [["POST", "/api/admin/staff", { username: "otro", name: "Otro", role: "admin", password: "clave-larga-123" }], ["GET", "/api/admin/staff"],
      ["POST", "/api/admin/assistant", {}], ["POST", "/api/admin/assistant/off", {}], ["POST", "/api/admin/me/password", { current: "x", next: "clave-nueva-123" }], ["POST", "/api/admin/me/2fa/setup", {}]];
    for (const [m, p, b] of tries) assert.equal((await call(m, p, b, key)).status, 403, `${m} ${p}`);
    // El usuario «asistente» tiene el mismo límite aunque alguien le ponga contraseña y entre por el panel.
    const staff = (await call("GET", "/api/admin/staff", null, ock)).json;
    const asis = staff.find((u) => u.username === "asistente");
    assert.equal((await call("POST", `/api/admin/staff/${asis.id}/password`, { password: "clave-del-asistente-1" }, ock)).status, 200);
    const ack = await login("asistente", "clave-del-asistente-1");
    assert.equal((await call("GET", "/api/admin/accounts?secrets=1", null, ack)).status, 403);
    assert.equal((await call("POST", `/api/admin/customers/${ana.id}/login-pin`, {}, ack)).status, 403);
  });

  test("las rutas bloqueadas: tabla clara", () => {
    assert.ok(assistantBlocked("POST", "/api/admin/customers/c_1/login-pin"));
    assert.ok(assistantBlocked("GET", "/api/admin/export/clientes"));
    assert.equal(assistantBlocked("GET", "/api/admin/products"), null);
    assert.equal(assistantBlocked("POST", "/api/admin/orders"), null);
    assert.equal(assistantBlocked("GET", "/api/admin/import/template"), null, "las plantillas vacías no tienen datos");
  });

  test("vence a los 7 días: después no entra y Usuarios lo muestra; una llave nueva vuelve a andar", async () => {
    clock.t = T0 + 7 * DAY - 60_000;
    assert.equal((await call("GET", "/api/admin/products", null, key)).status, 200, "un minuto antes, todavía anda");
    clock.t = T0 + 7 * DAY + 1;
    const r = await call("GET", "/api/admin/products", null, key);
    assert.equal(r.status, 401);
    assert.equal(r.json.error, "KEY_EXPIRED");
    assert.match(r.json.message, /venció/);
    ock = await login("gabriel", "clave-del-dueño-123"); // la sesión del dueño también vence con los días
    const st = (await call("GET", "/api/admin/assistant", null, ock)).json;
    assert.equal(st.expired, true);
    assert.equal(st.expiresAt, T0 + 7 * DAY);
    const nueva = (await call("POST", "/api/admin/assistant", {}, ock)).json;
    assert.equal((await call("GET", "/api/admin/products", null, nueva.token)).status, 200);
    assert.equal((await call("GET", "/api/admin/products", null, key)).status, 401, "la vieja ya no sirve");
    key = nueva.token;
  });

  test("una llave que ya existía (sin vencimiento) toma 7 días desde su primer uso después del cambio", async () => {
    const k = JSON.parse(app.db.getSecret("assistant_key"));
    delete k.expiresAt; delete k.lastUsedAt;
    app.db.setSecret("assistant_key", JSON.stringify(k), clock.now());
    clock.t += 30 * DAY; // estuvo guardada un mes sin usarse: no se corta apenas se publica
    const firstUse = clock.t;
    ock = await login("gabriel", "clave-del-dueño-123");
    assert.equal((await call("GET", "/api/admin/assistant", null, ock)).json.expiresAt, null, "todavía sin fecha: vence 7 días después del próximo uso");
    assert.equal((await call("GET", "/api/admin/products", null, key)).status, 200);
    assert.equal(JSON.parse(app.db.getSecret("assistant_key")).expiresAt, firstUse + 7 * DAY);
    clock.t = firstUse + 7 * DAY + 1;
    assert.equal((await call("GET", "/api/admin/products", null, key)).status, 401);
    assert.deepEqual(assistKeyCheck({ hash: "h", staffId: "s", createdAt: 0 }, 1000), { expired: false, patch: { expiresAt: 1000 + 7 * DAY } });
  });
});
