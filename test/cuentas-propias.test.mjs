// "📦 Mis cuentas propias": productos y cuentas del revendedor que NO son de la tienda (Flujo TV…).
// Cubre: crear producto, pegar lista con vista previa, asignar, que un cupo no se asigne dos veces,
// renovar, liberar, pagado/pendiente; contraseñas cifradas en la base; que el dueño, su equipo y otro
// revendedor no vean nada (rutas GET /api/admin/*, exportaciones y auditoría); permisos por HTTP de
// todas las rutas nuevas; link de cobro en ₲; y la pestaña en el navegador a 360 px.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { createRequire } from "node:module";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const APP_SRC = new URL("../src/server/app.ts", import.meta.url).pathname;
const owner = { id: "u_owner", role: "owner" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));
const asR = (c) => ({ id: "web:" + c.id, role: "reseller", customerId: c.id });
const PUBLIC_KEYS = ["currency", "expiresAt", "hasQr", "label", "name", "pay", "price", "product", "seller", "sellerWhatsapp"];

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

function unzipText(buf) {
  let out = "", i = 0;
  while (i + 30 <= buf.length && buf.readUInt32LE(i) === 0x04034b50) {
    const method = buf.readUInt16LE(i + 8), size = buf.readUInt32LE(i + 18), nameLen = buf.readUInt16LE(i + 26), extra = buf.readUInt16LE(i + 28);
    const start = i + 30 + nameLen + extra, data = buf.subarray(start, start + size);
    out += (method === 8 ? inflateRawSync(data) : data).toString("utf8") + "\n";
    i = start + size;
  }
  return out;
}

describe("cuentas propias (núcleo)", () => {
  const T0 = Date.UTC(2026, 10, 11, 15);
  const clock = { t: T0, now() { return this.t; } };
  let s, py, otro;
  before(() => {
    s = createStore({ clock });
    py = s.catalog.createCustomer(owner, { name: "Py Demo", phone: "+595981000001", kind: "reseller" });
    otro = s.catalog.createCustomer(owner, { name: "Otro Rev", phone: "+59171000009", kind: "reseller" });
    s.locale.setMine(asR(py), { country: "PY" });
  });

  test("producto, lista pegada con vista previa y guardado solo de lo bueno", () => {
    const p = s.own.saveProduct(asR(py), { name: "Flujo TV", emoji: "📺", durationDays: 30, price: 3500040, kind: "profiles", slots: 2 });
    assert.equal(p.price, 3500000, "₲ sin decimales");
    assert.equal(p.slots, 2);
    assert.throws(() => s.own.saveProduct(asR(py), { name: "flujo tv", price: 1 }), err("VALIDATION", /ya tenés/i));
    assert.throws(() => s.own.saveProduct(asR(py), { name: "", price: 1 }), err("VALIDATION"));
    const text = "flujo01 Clave-Uno 15/12\nflujo02 Clave-Dos\nflujo01 repetida\nsolo-usuario\nflujo03 Clave-Tres 31/02\n";
    const pv = s.own.preview(asR(py), p.id, text);
    assert.deepEqual(pv.rows.map((r) => r.ok), [true, true, false, false, false]);
    assert.match(pv.rows[2].error, /repetida/);
    assert.match(pv.rows[3].error, /contraseña/);
    assert.equal(new Date(pv.rows[0].providerExpiresAt).getUTCDate(), 16, "15/12 23:59 en Bolivia/Paraguay = 16/12 03:59 UTC");
    assert.equal(s.engine.s.ownStock?.[py.id]?.accounts?.length ?? 0, 0, "la vista previa no guarda nada");
    assert.equal(s.own.addBulk(asR(py), p.id, text).added, 2);
    // Una segunda vez: las que ya están no se repiten.
    assert.throws(() => s.own.addBulk(asR(py), p.id, "flujo01 otra"), err("VALIDATION"));
    const v = s.own.view(asR(py));
    assert.deepEqual(v.products[0].accounts, 2);
    assert.deepEqual(v.products[0].free, 4);
    assert.deepEqual(v.currency, { symbol: "₲", decimals: 0 });
  });

  test("asignar, no doble asignación, renovar, pagado/pendiente y liberar", () => {
    const v = s.own.view(asR(py));
    const acc = v.accounts.find((a) => a.user === "flujo01");
    const cli = s.catalog.createCustomer(asR(py), { name: "Lucía Benítez", phone: "0981 123 456" });
    const a1 = s.own.assign(asR(py), { accountId: acc.id, customerId: cli.id, slot: 1, pay: "pendiente" });
    assert.deepEqual([a1.slot, a1.phone, a1.price, a1.pay, a1.expiresAt], [1, "+595981123456", 3500000, "pendiente", T0 + 30 * DAY]);
    assert.throws(() => s.own.assign(asR(py), { accountId: acc.id, name: "Otro", phone: "0982000000", slot: 1 }), err("OUT_OF_STOCK", /otro cliente/));
    const a2 = s.own.assign(asR(py), { accountId: acc.id, name: "Carlos Duarte", phone: "0982 444 555", price: 3000000 });
    assert.equal(a2.slot, 2, "toma el cupo libre");
    assert.equal(a2.phone, "+595982444555");
    assert.throws(() => s.own.assign(asR(py), { accountId: acc.id, name: "Tercero", phone: "0983000000" }), err("OUT_OF_STOCK", /cupos libres/));
    assert.throws(() => s.own.assign(asR(py), { accountId: acc.id, name: "Sin tel", phone: "" }), (e) => e instanceof DomainError);
    // Un cliente de OTRO revendedor no se puede usar.
    const ajeno = s.catalog.createCustomer(asR(otro), { name: "Ajeno", phone: "72000000" });
    const acc2 = v.accounts.find((a) => a.user === "flujo02");
    assert.throws(() => s.own.assign(asR(py), { accountId: acc2.id, customerId: ajeno.id }), err("NOT_FOUND"));
    // Renovar: +30 días desde el vencimiento (o desde hoy si ya venció) y queda pagado.
    assert.equal(s.own.renew(asR(py), a1.id).expiresAt, T0 + 60 * DAY);
    clock.t = T0 + 90 * DAY;
    assert.equal(s.own.renew(asR(py), a1.id, false).expiresAt, T0 + 120 * DAY);
    assert.equal(s.own.view(asR(py)).sales.find((x) => x.id === a1.id).pay, "pendiente");
    s.own.updateSale(asR(py), a1.id, { pay: "pagado" });
    assert.equal(s.own.view(asR(py)).totals.owed, 0);
    s.own.updateSale(asR(py), a2.id, { pay: "pendiente" });
    assert.equal(s.own.view(asR(py)).totals.owed, 3000000);
    // Liberar: el cupo queda libre y se puede volver a dar.
    s.own.release(asR(py), a2.id);
    assert.deepEqual(s.own.view(asR(py)).accounts.find((a) => a.id === acc.id).free, [2]);
    assert.equal(s.own.assign(asR(py), { accountId: acc.id, name: "Nueva", phone: "0985111222" }).slot, 2);
    // No se borra una cuenta con clientes; tampoco un producto con cuentas.
    assert.throws(() => s.own.deleteAccount(asR(py), acc.id), err("VALIDATION"));
    assert.throws(() => s.own.deleteProduct(asR(py), s.own.view(asR(py)).products[0].id), err("VALIDATION"));
    clock.t = T0;
  });

  test("IPTV: datos para el cliente en el producto y prueba gratis de 24 h que se vuelve venta al renovar", () => {
    const p = s.own.saveProduct(asR(py), { name: "Flujo TV Prueba", kind: "line", durationDays: 30, price: 3500000, server: "http://flujo.tv:8080", app: "Flujo TV", screens: 2, guide: "Bajá la app y entrá con tu usuario." });
    assert.deepEqual([p.server, p.app, p.screens, p.guide], ["http://flujo.tv:8080", "Flujo TV", 2, "Bajá la app y entrá con tu usuario."]);
    assert.throws(() => s.own.saveProduct(asR(py), { id: p.id, name: "Flujo TV Prueba", kind: "line", price: 3500000, screens: 11 }), err("VALIDATION", /Pantallas/));
    s.own.saveAccount(asR(py), { productId: p.id, user: "demo-iptv", password: "Demo#123" });
    const acc = s.own.view(asR(py)).accounts.find((a) => a.user === "demo-iptv");
    const before = s.own.view(asR(py)).totals;
    const t = s.own.assign(asR(py), { accountId: acc.id, name: "Prueba Uno", phone: "0983 111 222", trialHours: 24 });
    assert.deepEqual([t.trial, t.price, t.pay, t.expiresAt], [true, 0, "pagado", T0 + 24 * 3_600_000]);
    const v = s.own.view(asR(py)).totals;
    assert.equal(v.owed, before.owed, "la prueba no es deuda");
    assert.equal(v.monthly, before.monthly, "ni venta");
    assert.equal(v.trials, (before.trials ?? 0) + 1);
    assert.throws(() => s.own.assign(asR(py), { accountId: acc.id, name: "X", phone: "0983000000", trialHours: 100 }), err("VALIDATION", /1 a 72 horas/));
    s.own.renew(asR(py), t.id, true);
    const sold = s.own.view(asR(py)).sales.find((x) => x.id === t.id);
    assert.equal(sold.trial, undefined, "al renovar deja de ser prueba");
    assert.equal(sold.price, 3500000, "y toma el precio del producto");
    s.own.release(asR(py), t.id);
    s.own.deleteAccount(asR(py), acc.id);
    s.own.deleteProduct(asR(py), p.id);
  });

  test("aislamiento en el núcleo: otro revendedor, un cliente y el staff no tocan nada", () => {
    const v = s.own.view(asR(py));
    const [acc] = v.accounts, [sale] = v.sales, [prod] = v.products;
    assert.equal(s.own.view(asR(otro)).products.length, 0);
    for (const fn of [
      () => s.own.assign(asR(otro), { accountId: acc.id, name: "X", phone: "72000001" }),
      () => s.own.renew(asR(otro), sale.id), () => s.own.release(asR(otro), sale.id), () => s.own.updateSale(asR(otro), sale.id, { pay: "pagado" }),
      () => s.own.link(asR(otro), sale.id), () => s.own.deleteAccount(asR(otro), acc.id), () => s.own.saveAccount(asR(otro), { id: acc.id, productId: prod.id, user: "x", password: "y" }),
      () => s.own.preview(asR(otro), prod.id, "a b"), () => s.own.saveProduct(asR(otro), { id: prod.id, name: "Robado", price: 1 }),
    ]) assert.throws(fn, err("NOT_FOUND"));
    const cli = s.catalog.createCustomer(owner, { name: "Final", phone: "+59173000000" });
    for (const actor of [{ id: "web:" + cli.id, role: "customer", customerId: cli.id }, owner, { id: "u_a", role: "admin" }, { id: "u_s", role: "seller" }]) {
      assert.throws(() => s.own.view(actor), err("FORBIDDEN"), actor.role);
    }
    // La auditoría nunca lleva contraseñas, usuarios ni nombres o teléfonos de los clientes.
    const audit = JSON.stringify(s.engine.s.audit.filter((a) => a.action.startsWith("own.")));
    for (const x of ["Clave-Uno", "Clave-Dos", "flujo01", "Lucía", "595981123456", "Carlos"]) assert.ok(!audit.includes(x), `auditoría con ${x}`);
    assert.ok(audit.includes("own.assign"));
  });
});

describe("cuentas propias por HTTP", () => {
  let dir, app, base, s, pyId, otroId, cliId, prodId, accId, acc2Id, saleId, token;
  const cookies = {};
  const call = async (m, p, body, who) => {
    const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(who ? { cookie: cookies[who] } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    let json = null; try { json = JSON.parse(text); } catch { /* no es JSON */ }
    return { status: r.status, json, text };
  };
  const loginStaff = async (username, password) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) })).headers.get("set-cookie").split(";")[0];
  const loginCustomer = async (id, phone) => {
    await call("POST", `/api/admin/customers/${id}/login-pin`, { pin: "2468" }, "owner");
    return (await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, pin: "2468" }) })).headers.get("set-cookie").split(";")[0];
  };
  // Lo que nunca puede salir fuera del panel del propio revendedor.
  const SECRETS = ["Flujo-Secreta#101", "Flujo-Secreta#102", "Flujo-Secreta#103", "Benítez Py", "595981777888", "Duarte Py", "flujo-py-01", "Flujo TV Py"];

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-propias-"));
    app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {}, dataKey: "clave-de-prueba-para-cifrar-cuentas", fetchImpl: async () => { throw new Error("sin red en las pruebas"); } });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    s = app.store;
    pyId = s.catalog.createCustomer(owner, { name: "Py Demo", phone: "+595981000001", kind: "reseller" }).id;
    otroId = s.catalog.createCustomer(owner, { name: "Otro Rev", phone: "+59171000009", kind: "reseller" }).id;
    cliId = s.catalog.createCustomer(owner, { name: "Cliente Final", phone: "+59176666666" }).id;
    s.shops.setupFor(owner, pyId, { slug: "py-demo", title: "Py Demo TV", whatsapp: "595981000001", enabled: true });
    cookies.owner = await loginStaff("gabriel", "clave-del-dueño-123");
    await call("POST", "/api/admin/staff", { username: "ada", name: "Ada Admin", role: "admin", password: "clave-larga-admin-1" }, "owner");
    await call("POST", "/api/admin/staff", { username: "seba", name: "Seba Ventas", role: "seller", password: "clave-larga-seller-1" }, "owner");
    cookies.admin = await loginStaff("ada", "clave-larga-admin-1");
    cookies.seller = await loginStaff("seba", "clave-larga-seller-1");
    cookies.py = await loginCustomer(pyId, "+595981000001");
    cookies.otro = await loginCustomer(otroId, "+59171000009");
    cookies.cli = await loginCustomer(cliId, "+59176666666");
    assert.equal((await call("PUT", "/api/me/locale", { country: "PY" }, "py")).status, 200);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("camino feliz: producto, lista, asignar, link de cobro en ₲", async () => {
    const p = await call("POST", "/api/me/own/products", { name: "Flujo TV Py", emoji: "📺", durationDays: 30, price: 3500000, kind: "line", onPage: true }, "py");
    assert.equal(p.status, 200);
    prodId = p.json.id;
    const text = "flujo-py-01 Flujo-Secreta#101 20/12\nflujo-py-02 Flujo-Secreta#102\nflujo-py-03 Flujo-Secreta#103";
    const pv = await call("POST", "/api/me/own/accounts/preview", { productId: prodId, text }, "py");
    assert.equal(pv.json.ok, 3);
    assert.equal((await call("POST", "/api/me/own/accounts/bulk", { productId: prodId, text }, "py")).json.added, 3);
    const v = (await call("GET", "/api/me/own", null, "py")).json;
    accId = v.accounts.find((a) => a.user === "flujo-py-01").id;
    acc2Id = v.accounts.find((a) => a.user === "flujo-py-02").id;
    assert.equal(v.accounts.find((a) => a.id === accId).password, "Flujo-Secreta#101", "él sí ve su contraseña");
    const a = await call("POST", "/api/me/own/sales", { accountId: accId, name: "Lucía Benítez Py", phone: "0981 777 888", pay: "pendiente" }, "py");
    assert.equal(a.status, 200);
    assert.equal(a.json.phone, "+595981777888");
    saleId = a.json.id;
    assert.equal((await call("POST", "/api/me/own/sales", { accountId: accId, name: "Duarte Py", phone: "0982 111 222" }, "py")).status, 409, "una cuenta completa no se da dos veces");
    const l = await call("POST", `/api/me/own/sales/${saleId}/link`, {}, "py");
    token = l.json.token;
    assert.ok(l.json.url.endsWith(`/c/${token}`));
    const pub = await call("GET", `/api/cobro/${token}`);
    assert.equal(pub.status, 200);
    assert.deepEqual(Object.keys(pub.json).sort(), PUBLIC_KEYS, "misma lista cerrada que el cuaderno");
    assert.deepEqual([pub.json.name, pub.json.product, pub.json.price, pub.json.currency, pub.json.pay, pub.json.seller], ["Lucía", "Flujo TV Py", 3500000, "₲", "pendiente", "Py Demo TV"]);
    for (const x of ["Flujo-Secreta", "flujo-py-01", "595981777888", "Benítez", accId, saleId]) assert.ok(!pub.text.includes(x), `el link no muestra ${x}`);
    // Su página: el producto propio con su precio en ₲.
    const page = (await call("GET", "/api/shops/py-demo")).json;
    assert.deepEqual(page.products.map((x) => [x.name, x.price]), [["Flujo TV Py", 3500000]]);
    assert.ok(!JSON.stringify(page).includes("flujo-py-01"));
    // Logo: imagen sí, PDF no; solo él lo ve.
    assert.equal((await call("POST", `/api/me/own/products/${prodId}/logo`, { contentBase64: PNG.toString("base64") }, "py")).status, 200);
    assert.equal((await call("POST", `/api/me/own/products/${prodId}/logo`, { contentBase64: Buffer.from("%PDF-1.4 hola").toString("base64") }, "py")).status, 400);
    assert.equal((await fetch(`${base}/api/me/own/products/${prodId}/logo`, { headers: { cookie: cookies.py } })).status, 200);
    assert.equal((await fetch(`${base}/api/me/own/products/${prodId}/logo`, { headers: { cookie: cookies.otro } })).status, 404);
  });

  test("las contraseñas quedan cifradas en el archivo de la base", () => {
    const raw = ["gabriel.db", "gabriel.db-wal"].map((f) => join(dir, f)).filter(existsSync).map((f) => readFileSync(f).toString("latin1")).join("\n");
    assert.ok(raw.length > 1000);
    for (const pw of ["Flujo-Secreta#101", "Flujo-Secreta#102", "Flujo-Secreta#103"]) assert.ok(!raw.includes(pw), `${pw} está en claro en la base`);
    assert.ok(raw.includes("enc1:"), "se guardan con el prefijo de cifrado");
    // Y al volver a leer la base (como al reiniciar) se recuperan.
    assert.equal(app.db.loadLatest().ownStock[pyId].accounts.find((a) => a.user === "flujo-py-01").password, "Flujo-Secreta#101");
  });

  test("permisos por HTTP de todas las rutas nuevas", async () => {
    const routes = [
      ["GET", "/api/me/own"], ["POST", "/api/me/own/products", { id: prodId, name: "Flujo TV Py", price: 3500000, kind: "line" }],
      ["GET", `/api/me/own/products/${prodId}/logo`], ["POST", `/api/me/own/products/${prodId}/logo`, { remove: true }],
      ["POST", "/api/me/own/accounts/preview", { productId: prodId, text: "x y" }], ["POST", "/api/me/own/accounts/bulk", { productId: prodId, text: "nueva-zz clave-zz" }],
      ["POST", "/api/me/own/accounts", { id: accId, productId: prodId, user: "flujo-py-01", password: "" }],
      ["POST", "/api/me/own/sales", { accountId: acc2Id, name: "Z", phone: "0982000000" }],
      ["POST", `/api/me/own/sales/${saleId}`, { note: "ok" }], ["POST", `/api/me/own/sales/${saleId}/renew`, { paid: true }],
      ["POST", `/api/me/own/sales/${saleId}/link`, {}], ["POST", `/api/me/own/sales/${saleId}/link/revoke`, {}],
      ["POST", `/api/me/own/accounts/${accId}/delete`, {}], ["POST", `/api/me/own/sales/${saleId}/release`, {}], ["POST", `/api/me/own/products/${prodId}/delete`, {}],
      ["GET", "/api/me/locale"], ["PUT", "/api/me/locale", { country: "PY" }],
    ];
    let n = 0;
    for (const [m, p, body] of routes) {
      for (const who of ["otro", "cli", "owner", "admin", "seller", null]) {
        const r = await call(m, p, body, who ?? undefined);
        const ok = who === "otro" ? (p.includes("/locale") || p === "/api/me/own" || p.endsWith("/preview") || p.endsWith("/bulk") || p === "/api/me/own/products" || p === "/api/me/own/sales" || p === "/api/me/own/accounts" ? [200, 400, 404] : [403, 404])
          : who === "cli" ? [403] : [401];
        assert.ok(ok.includes(r.status), `${who ?? "sin sesión"} ${m} ${p}: ${r.status}`);
        if (who === "otro") for (const x of SECRETS) assert.ok(!r.text.includes(x), `${p} le muestra ${x} a otro revendedor`);
        n++;
      }
    }
    // Lo de Py sigue intacto después de los intentos de Otro (nada se borró ni cambió de dueño).
    const v = (await call("GET", "/api/me/own", null, "py")).json;
    assert.ok(v.sales.some((x) => x.id === saleId));
    assert.ok(v.accounts.some((x) => x.id === accId));
    assert.equal((await call("GET", "/api/me/own", null, "otro")).json.products.length, 0, "otro revendedor ve su cuaderno vacío");
    // Y el revendedor dueño puede hacer todo (200).
    for (const [m, p, body] of routes.filter(([, p]) => !/delete|release|revoke|bulk/.test(p))) {
      assert.equal((await call(m, p, body, "py")).status, 200, `py ${m} ${p}`);
    }
    assert.ok(n > 90);
  });

  test("el dueño, el admin y el vendedor no ven nada de esto (rutas GET /api/admin/*, exportaciones y auditoría)", async () => {
    const src = readFileSync(APP_SRC, "utf8");
    const paths = [...src.matchAll(/route\("GET", "(\/api\/admin\/[^"]*)"/g)].map((m) => m[1]);
    const fill = (p) => (p.includes(":") ? [p.replace(/:\w+/g, pyId), p.replace(/:\w+/g, saleId)] : [p]);
    const kinds = ["clientes", "ventas", "servicios", "cuentas", "movimientos", "todo"];
    let checked = 0;
    for (const who of ["owner", "admin", "seller"]) {
      for (const p of paths.flatMap(fill)) {
        if (/\/export\/|\/backups\//.test(p)) continue;
        const r = await call("GET", p, null, who);
        for (const x of [...SECRETS, token]) assert.ok(!r.text.includes(x), `${who} ${p} muestra ${x}`);
        checked++;
      }
      for (const k of kinds) for (const q of ["", "?secrets=1"]) {
        const r = await fetch(`${base}/api/admin/export/${k}${q}`, { headers: { cookie: cookies[who] } });
        if (r.status !== 200) continue;
        const txt = unzipText(Buffer.from(await r.arrayBuffer()));
        for (const x of SECRETS) assert.ok(!txt.includes(x), `${who} export ${k}${q} muestra ${x}`);
        checked++;
      }
    }
    assert.ok(checked > 60, `se revisaron ${checked} respuestas`);
    // A lo sumo, cuántos productos y cuentas propias tiene cada revendedor.
    const ov = (await call("GET", "/api/admin/resellers", null, "owner")).json;
    const row = (Array.isArray(ov) ? ov : ov.list ?? ov.resellers ?? []).find((x) => x.id === pyId);
    assert.deepEqual(row.ownStock, { products: 1, accounts: 3 });
    const audit = (await call("GET", "/api/admin/audit?limit=500", null, "owner")).text;
    assert.ok(audit.includes("own.assign"));
    for (const x of [...SECRETS, token]) assert.ok(!audit.includes(x), `auditoría muestra ${x}`);
  });

  test("en el navegador: la pestaña a 360 px, claro y oscuro, y la página de cobro en ₲", { skip: !chromium && "Playwright no está instalado" }, async () => {
    // Lucía todavía no pagó la renovación: su página de cobro muestra el monto.
    assert.equal((await call("POST", `/api/me/own/sales/${saleId}`, { pay: "pendiente" }, "py")).status, 200);
    const browser = await chromium.launch();
    try {
      for (const colorScheme of ["light", "dark"]) {
        const ctx = await browser.newContext({ viewport: { width: 360, height: 760 }, isMobile: true, colorScheme });
        await ctx.route(/wa\.me|whatsapp\.com/, (route) => route.abort()); // nunca sale un WhatsApp real
        const [name, value] = cookies.py.split("=");
        await ctx.addCookies([{ name, value, url: base }]);
        const page = await ctx.newPage();
        const errors = [];
        page.on("pageerror", (e) => errors.push(e.message));
        page.on("dialog", (d) => d.accept());
        await page.goto(base + "/hub#clientes");
        await page.getByRole("tab", { name: /Mis cuentas propias/ }).click();
        await page.getByRole("heading", { name: /Mis cuentas propias/ }).waitFor();
        await page.locator(".os-prod .rcopen").first().click();
        await page.locator(".os-prod .rcopen", { hasText: "flujo-py-01" }).click();
        await page.locator(".os-sales .rcopen", { hasText: "Lucía Benítez Py" }).click();
        const access = page.getByRole("link", { name: /Mandar acceso por WhatsApp/ }).first();
        const href = await access.getAttribute("href");
        assert.match(href, /^https:\/\/wa\.me\/595981777888\?text=/);
        assert.ok(decodeURIComponent(href).includes("Flujo-Secreta#101"), "el acceso lleva usuario y contraseña");
        const h = await access.evaluate((el) => el.getBoundingClientRect().height);
        assert.ok(h >= 44, `botón de ${h}px`);
        const text = await page.locator("#sout").innerText();
        assert.match(text, /₲ 35\.000/);
        assert.ok(!/Bs 35/.test(text));
        assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), "sin desborde a 360 px");
        // Letra mínima de 12 px en la pestaña.
        const small = await page.evaluate(() => [...document.querySelectorAll("#sout *")].filter((el) => el.childNodes.length && [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(el).fontSize) < 12).map((el) => el.textContent.trim().slice(0, 30)));
        assert.deepEqual(small, [], "texto de menos de 12 px");
        // La página de cobro del cliente, en ₲.
        const pg = await ctx.newPage();
        pg.on("pageerror", (e) => errors.push(e.message));
        await pg.goto(`${base}/c/${token}`);
        await pg.locator("h1").waitFor();
        assert.match(await pg.locator("main").innerText(), /₲ 35\.000/);
        assert.deepEqual(errors, []);
        await ctx.close();
      }
    } finally { await browser.close(); }
  });
});
