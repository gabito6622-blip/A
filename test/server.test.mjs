// Pruebas de punta a punta del servidor: se levanta de verdad en un puerto libre y se usa por HTTP.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { createStore } from "../dist/store/index.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
const OWNER_PASS = "clave-del-dueño-123";

function client(base) {
  const jar = { cookie: "" };
  async function call(method, path, body, extra = {}) {
    const headers = { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(jar.cookie ? { cookie: jar.cookie } : {}), ...extra };
    const r = await fetch(base + path, { method, headers, body: body !== undefined ? JSON.stringify(body) : undefined });
    const set = r.headers.get("set-cookie");
    if (set) jar.cookie = set.split(";")[0].endsWith("=") ? "" : set.split(";")[0];
    const text = await r.text();
    let json;
    try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json, headers: r.headers };
  }
  return { jar, get: (p, h) => call("GET", p, undefined, h), post: (p, b = {}, h) => call("POST", p, b, h), put: (p, b = {}) => call("PUT", p, b) };
}

describe("servidor Gabriel Store", () => {
  let dir, app, base, codes;
  const owner = () => client(base);

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-test-"));
    codes = new Map();
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, otpSender: (phone, code) => codes.set(phone, code) });
    assert.equal(app.bootstrapOwner("gabriel", "Gabriel", OWNER_PASS), true);
    assert.equal(app.bootstrapOwner("otro", "Otro", OWNER_PASS), false, "solo se crea un dueño inicial");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  });
  after(async () => {
    await app?.close().catch(() => {});
    rmSync(dir, { recursive: true, force: true });
  });

  const state = {};

  test("login del panel: contraseña incorrecta, correcta y sesión", async () => {
    const c = owner();
    assert.equal((await c.post("/api/auth/staff/login", { username: "gabriel", password: "mala-clave-000" })).status, 401);
    assert.equal((await c.post("/api/auth/staff/login", { username: "nadie", password: "x" })).status, 401);
    const ok = await c.post("/api/auth/staff/login", { username: "Gabriel", password: OWNER_PASS });
    assert.equal(ok.status, 200);
    assert.match(c.jar.cookie, /^gs_session=/);
    const me = await c.get("/api/me");
    assert.equal(me.json.role, "owner");
    state.owner = c;
  });

  test("la cookie de sesión es HttpOnly y SameSite=Strict", async () => {
    const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: OWNER_PASS }) });
    const set = r.headers.get("set-cookie");
    assert.match(set, /HttpOnly/);
    assert.match(set, /SameSite=Strict/);
  });

  test("el dueño arma catálogo, proveedor e inventario", async () => {
    const c = state.owner;
    assert.equal((await c.post("/api/admin/products", { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true })).status, 200);
    assert.equal((await c.post("/api/admin/suppliers", { id: "andes", name: "Proveedor Andes", active: true })).status, 200);
    const acc = await c.post("/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf01@gabostore.lat", password: "Sup3r-Secreta#1", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 4000, profiles: [{ label: "Perfil 1", pin: "1111" }, { label: "Perfil 2", pin: "2222" }] });
    assert.equal(acc.status, 200, JSON.stringify(acc.json));
    const list = await c.get("/api/admin/accounts");
    assert.equal(list.json[0].password, "••••••");
    const cat = await (client(base)).get("/api/catalog");
    assert.deepEqual(cat.json.map((p) => [p.id, p.available]), [["netflix", 2]]);
  });

  test("el dueño crea un vendedor; el vendedor no puede aprobar pagos ni crear usuarios", async () => {
    assert.equal((await state.owner.post("/api/admin/staff", { username: "vendedor1", name: "Ana", role: "seller", password: "corta" })).status, 400);
    const r = await state.owner.post("/api/admin/staff", { username: "vendedor1", name: "Ana", role: "seller", password: "clave-vendedor-1" });
    assert.equal(r.status, 200);
    assert.equal(r.json.passwordHash, undefined, "el hash nunca sale por la API");
    const s = client(base);
    assert.equal((await s.post("/api/auth/staff/login", { username: "vendedor1", password: "clave-vendedor-1" })).status, 200);
    assert.equal((await s.post("/api/admin/staff", { username: "x2", name: "X", role: "admin", password: "clave-larga-123" })).status, 403);
    state.seller = s;
  });

  test("cliente nuevo entra con código y queda registrado", async () => {
    const c = client(base);
    const first = await c.post("/api/auth/customer/request-code", { phone: "+591 7001 1223" });
    assert.deepEqual(first.json, { needsName: true });
    assert.equal((await c.post("/api/auth/customer/request-code", { phone: "+591 7001 1223", name: "María Quispe", whatsappConsent: true })).json.sent, true);
    const code = codes.get("+59170011223");
    assert.match(code, /^\d{6}$/);
    assert.equal((await c.post("/api/auth/customer/verify", { phone: "+59170011223", code: code === "000000" ? "111111" : "000000" })).status, 401);
    const ok = await c.post("/api/auth/customer/verify", { phone: "+591 70011223", code });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.name, "María Quispe");
    assert.equal((await c.post("/api/auth/customer/verify", { phone: "+59170011223", code })).status, 401, "el código es de un solo uso");
    state.maria = c;
    state.mariaId = ok.json.id;
  });

  test("un cliente no entra al panel; sin sesión pide login", async () => {
    assert.equal((await state.maria.get("/api/admin/orders")).status, 403);
    assert.equal((await client(base).get("/api/admin/orders")).status, 401);
    assert.equal((await client(base).get("/api/me/services")).status, 401);
  });

  test("compra con QR → comprobante → aprobación → accesos en el portal", async () => {
    const m = state.maria;
    const o = await m.post("/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr", idempotencyKey: "chk-1" });
    assert.equal(o.status, 200, JSON.stringify(o.json));
    assert.equal(o.json.total, 3500);
    const again = await m.post("/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr", idempotencyKey: "chk-1" });
    assert.equal(again.json.id, o.json.id, "doble clic no duplica");
    const bad = await m.post(`/api/orders/${o.json.id}/evidence`, { contentBase64: Buffer.from("no soy imagen").toString("base64"), declaredReference: "DEP-1" });
    assert.equal(bad.status, 400);
    const ev = await m.post(`/api/orders/${o.json.id}/evidence`, { contentBase64: PNG, declaredReference: "DEP-1" });
    assert.equal(ev.json.status, "payment_review");
    assert.equal(readdirSync(join(dir, "uploads")).length, 1, "el archivo rechazado no quedó guardado");

    assert.equal((await m.get(`/api/admin/orders/${o.json.id}/evidence`)).status, 403);
    const img = await state.owner.get(`/api/admin/orders/${o.json.id}/evidence`);
    assert.equal(img.status, 200);
    assert.equal(img.headers.get("content-type"), "image/png");

    assert.equal((await state.seller.post(`/api/admin/orders/${o.json.id}/approve`, { confirmedReference: "BNB-1" })).status, 403);
    const ap = await state.owner.post(`/api/admin/orders/${o.json.id}/approve`, { confirmedReference: "BNB-1" });
    assert.equal(ap.json.status, "fulfilled");
    const svc = await m.get("/api/me/services");
    assert.equal(svc.json.length, 1);
    assert.equal(svc.json[0].access.password, "Sup3r-Secreta#1");
    state.orderId = o.json.id;
  });

  test("los mensajes de WhatsApp encolados no llevan contraseñas", async () => {
    const out = await state.owner.get("/api/admin/outbox");
    assert.ok(out.json.length >= 2);
    assert.ok(out.json.every((m) => !m.text.includes("Sup3r-Secreta")));
  });

  test("link de acceso de un solo uso generado por el staff", async () => {
    const cus = await state.seller.post("/api/admin/customers", { name: "Luis Choque", phone: "+591 78889900" });
    assert.equal(cus.status, 200);
    const link = await state.seller.post(`/api/admin/customers/${cus.json.id}/login-link`);
    const token = link.json.url.split("#acceso=")[1];
    const l = client(base);
    assert.equal((await l.post("/api/auth/customer/link", { token })).status, 200);
    assert.equal((await l.get("/api/me")).json.name, "Luis Choque");
    assert.equal((await client(base).post("/api/auth/customer/link", { token })).status, 401, "no se puede reusar");
    assert.equal((await l.get("/api/me/services")).json.length, 0, "Luis no ve los servicios de María");
  });

  test("configuración de la tienda y QR de cobro", async () => {
    assert.equal((await state.maria.post("/api/admin/settings", { storeName: "X" })).status, 403);
    assert.equal((await state.owner.post("/api/admin/settings", { whatsapp: "abc" })).status, 400);
    const s = await state.owner.post("/api/admin/settings", { storeName: "Gabriel Store", whatsapp: "59170000000", paymentNote: "Banco Demo" });
    assert.equal(s.json.whatsapp, "59170000000");
    assert.equal((await client(base).get("/api/settings/qr")).status, 404);
    assert.equal((await state.owner.post("/api/admin/settings/qr", { contentBase64: Buffer.from("%PDF-1.4 x").toString("base64") })).status, 400, "el QR no puede ser PDF");
    assert.equal((await state.owner.post("/api/admin/settings/qr", { contentBase64: PNG })).status, 200);
    const pub = await client(base).get("/api/settings");
    assert.deepEqual([pub.json.storeName, pub.json.hasQr, pub.json.paymentNote], ["Gabriel Store", true, "Banco Demo"]);
    const img = await client(base).get("/api/settings/qr");
    assert.equal(img.headers.get("content-type"), "image/png");
  });

  test("apariencia: colores, textos, aviso y logo", async () => {
    assert.equal((await state.owner.post("/api/admin/settings", { accentColor: "rojo" })).status, 400);
    assert.equal((await state.owner.post("/api/admin/settings", { announcement: "x".repeat(200) })).status, 400);
    const r = await state.owner.post("/api/admin/settings", { accentColor: "#7c5cff", backgroundColor: "#140c24", heroTitle: "Tu streaming,", heroHighlight: "al toque.", announcement: "Promo de fin de semana" });
    assert.equal(r.status, 200);
    assert.equal((await state.owner.post("/api/admin/settings", { logoFileRef: "../../etc/passwd" })).json.logoFileRef, undefined, "el archivo del logo solo se cambia subiendo una imagen");
    const pub = (await client(base).get("/api/settings")).json;
    assert.deepEqual([pub.accentColor, pub.backgroundColor, pub.heroTitle, pub.announcement, pub.hasLogo], ["#7c5cff", "#140c24", "Tu streaming,", "Promo de fin de semana", false]);
    assert.equal((await state.owner.post("/api/admin/settings/logo", { contentBase64: PNG })).status, 200);
    assert.equal((await client(base).get("/api/settings/logo")).headers.get("content-type"), "image/png");
    await state.owner.post("/api/admin/settings/logo/remove");
    assert.equal((await client(base).get("/api/settings/logo")).status, 404);
  });

  test("avisos de WhatsApp: el staff los marca como enviados a mano", async () => {
    const out = await state.owner.get("/api/admin/outbox");
    const pending = out.json.find((m) => m.status === "queued");
    assert.ok(pending, "hay un aviso por enviar");
    assert.equal((await state.owner.post(`/api/admin/outbox/${pending.id}/sent`)).json.status, "sent_manually");
    assert.equal((await state.owner.post(`/api/admin/outbox/${pending.id}/sent`)).status, 409, "no se marca dos veces");
  });

  test("editar cuenta y cliente, liberar perfil y transferir por la API", async () => {
    const accs = (await state.owner.get("/api/admin/accounts")).json;
    const acc = accs[0];
    assert.equal((await state.maria.post(`/api/admin/accounts/${acc.id}`, { password: "x" })).status, 403);
    const up = await state.owner.post(`/api/admin/accounts/${acc.id}`, { password: "Clave-Nueva#7", notes: "cambio del proveedor" });
    assert.equal(up.status, 200);
    assert.equal(up.json.notified, 1);
    const svc = (await state.maria.get("/api/me/services")).json;
    assert.equal(svc[0].access.password, "Clave-Nueva#7");
    const asg = (await state.owner.get("/api/admin/assignments")).json[0];
    const rep = await state.owner.post(`/api/admin/assignments/${asg.id}/replace`, { reason: "bloqueado" });
    assert.equal(rep.status, 200);
    const quarantined = (await state.owner.get("/api/admin/accounts?secrets=1")).json.flatMap((a) => a.slots).find((sl) => sl.status === "quarantined");
    assert.ok(quarantined);
    assert.equal((await state.owner.post(`/api/admin/slots/${quarantined.id}/status`, { status: "available", note: "revisado" })).status, 200);
    assert.equal((await state.owner.post(`/api/admin/slots/${quarantined.id}`, { pin: "9876" })).json.notified, false);
    const customers = (await state.owner.get("/api/admin/customers")).json;
    const luis = customers.find((c) => c.name === "Luis Choque");
    const ed = await state.owner.post(`/api/admin/customers/${luis.id}`, { name: "Luis Choque Mamani", notes: "cliente nuevo" });
    assert.equal(ed.json.name, "Luis Choque Mamani");
    const tr = await state.owner.post(`/api/admin/assignments/${asg.id}/transfer`, { toCustomerId: luis.id, reason: "lo usa Luis" });
    assert.equal(tr.status, 200);
    assert.equal((await state.maria.get("/api/me/services")).json.length, 0);
    // Se lo devolvemos a María para las pruebas siguientes.
    const back = await state.owner.post(`/api/admin/assignments/${asg.id}/transfer`, { toCustomerId: state.mariaId, reason: "volvió a María" });
    assert.equal(back.status, 200);
  });

  test("protecciones: origen ajeno, JSON obligatorio, tamaño máximo", async () => {
    assert.equal((await state.maria.post("/api/orders", { items: [], paymentMethod: "qr" }, { origin: "https://sitio-malo.com" })).status, 403);
    const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
    assert.equal(r.status, 415);
    const big = await state.owner.post("/api/admin/products", { name: "x".repeat(200 * 1024) });
    assert.equal(big.status, 413);
  });

  test("demasiados intentos de login se bloquean", async () => {
    const c = client(base);
    for (let i = 0; i < 5; i++) await c.post("/api/auth/staff/login", { username: "vendedor1", password: "incorrecta-" + i });
    assert.equal((await c.post("/api/auth/staff/login", { username: "vendedor1", password: "clave-vendedor-1" })).status, 429);
  });

  test("desactivar a un vendedor corta su sesión al instante", async () => {
    const list = await state.owner.get("/api/admin/staff");
    const seller = list.json.find((u) => u.username === "vendedor1");
    await state.owner.post(`/api/admin/staff/${seller.id}/active`, { active: false });
    assert.equal((await state.seller.get("/api/admin/orders")).status, 401);
  });

  test("un segundo servidor no puede abrir la misma base", () => {
    assert.throws(() => createApp({ dataDir: dir, jobs: false, log: () => {} }));
  });

  test("al reiniciar, los datos y las sesiones siguen ahí", async () => {
    await app.close();
    app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    // Las cookies siguen sirviendo con el servidor nuevo.
    const svc = await fetch(base + "/api/me/services", { headers: { cookie: state.maria.jar.cookie } }).then((r) => r.json());
    assert.equal(svc.length, 1);
    assert.equal(svc[0].product, "Netflix perfil");
    const orders = await fetch(base + "/api/admin/orders", { headers: { cookie: state.owner.jar.cookie } }).then((r) => r.json());
    assert.equal(orders.find((o) => o.id === state.orderId).status, "fulfilled");
    assert.ok(app.db.versions().length > 5, "se guardan versiones del estado");
    assert.equal(app.bootstrapOwner("otro", "Otro", OWNER_PASS), false, "el dueño ya existe tras reiniciar");
  });

  test("tareas periódicas vencen reservas no pagadas", async () => {
    const r = app.runJobs();
    assert.equal(typeof r.expired, "number");
  });

  test("sin forma de enviar códigos, el login por código avisa que use el link", async () => {
    const d2 = mkdtempSync(join(tmpdir(), "gs-test2-"));
    const a2 = createApp({ dataDir: d2, jobs: false, log: () => {} });
    const p = await a2.listen(0, "127.0.0.1");
    const r = await fetch(`http://127.0.0.1:${p}/api/auth/customer/request-code`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "+59170000001" }) });
    assert.equal(r.status, 503);
    await a2.close();
    rmSync(d2, { recursive: true, force: true });
  });
});

test("si guardar en disco falla, la operación se deshace y no queda a medias", () => {
  let fail = false;
  const s = createStore({ onCommit: () => { if (fail) throw new Error("disco lleno"); } });
  const owner = { id: "o", role: "owner" };
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  fail = true;
  assert.throws(() => s.catalog.upsertSupplier(owner, { id: "otro", name: "Otro", active: true }), /disco lleno/);
  fail = false;
  assert.deepEqual(Object.keys(s.snapshot().suppliers), ["andes"]);
});
