// Revendedor de otro país (primer caso: Paraguay, ₲ sin decimales, teléfonos +595).
// Cubre: teléfonos (Bolivia igual que antes, Paraguay completo, duplicados, wa.me), país y moneda del
// revendedor (permisos), formato de plata, que nunca se mezclen dos monedas en una cifra, su página
// /r/<slug> con y sin tipo de cambio, y el link de cobro /c/ en ₲.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { createStore, DomainError, DAY, phoneWithCountry, samePhone, money, convertFromStore } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const PUBLIC = new URL("../public/", import.meta.url).pathname;
const owner = { id: "u_owner", role: "owner" };
const PYG = { symbol: "₲", decimals: 0 };
const err = (code, re) => (e) => e instanceof DomainError && e.code === code && (!re || re.test(e.message));
const asR = (c) => ({ id: "web:" + c.id, role: "reseller", customerId: c.id });

/** Tienda chica: Netflix (lo que el revendedor le compra a la tienda), un revendedor de Bolivia y uno de Paraguay. */
function shop() {
  const s = createStore();
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "netflix", supplierId: "andes", email: "n@x.lat", password: "Clave-N#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1500, profiles: [{ label: "P1" }, { label: "P2" }, { label: "P3" }] });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 2500 } });
  const bo = s.catalog.createCustomer(owner, { name: "Ari Bolivia", phone: "+59171000001", kind: "reseller", priceGroupId: "revendedor" });
  const py = s.catalog.createCustomer(owner, { name: "Py Demo", phone: "+595981000001", kind: "reseller", priceGroupId: "revendedor" });
  s.locale.setMine(asR(py), { country: "PY" });
  return { s, bo, py };
}

describe("teléfonos", () => {
  test("Bolivia: igual que antes", () => {
    assert.equal(phoneWithCountry("70099111"), "+59170099111");
    assert.equal(phoneWithCountry("591 70099111"), "+59170099111");
    assert.equal(phoneWithCountry("+591 700-99111"), "+59170099111");
    assert.equal(phoneWithCountry("0981123456"), "0981123456", "en Bolivia un número raro queda como estaba");
    assert.equal(phoneWithCountry("+595981123456"), "+595981123456");
  });

  test("Paraguay: todas las formas comunes dan +595981123456", () => {
    for (const p of ["0981123456", "981123456", "+595981123456", "595981123456", "0981 123 456", "0981-123-456", "(0981) 123-456", "+595 981 123 456", "+595 0981 123 456", "00595981123456"]) {
      assert.equal(phoneWithCountry(p, "595"), "+595981123456", p);
    }
    // Un número de Bolivia escrito con su código no cambia aunque lo cargue un paraguayo.
    assert.equal(phoneWithCountry("+591 71234567", "595"), "+59171234567");
  });

  test("mismo número o no: no confunde un boliviano con un paraguayo que terminan igual", () => {
    assert.equal(samePhone("+59171234567", "+595971234567"), false);
    assert.equal(samePhone("+595981123456", "+595981123456"), true);
    assert.equal(samePhone("+59170012345", "70012345"), true, "datos viejos sin código: como antes");
    assert.equal(samePhone("+595981123456", "+595981123457"), false);
  });

  test("el revendedor paraguayo carga clientes con +595; los duplicados se detectan; el boliviano sigue con +591", () => {
    const { s, bo, py } = shop();
    const a = s.catalog.createCustomer(asR(py), { name: "Lucía", phone: "0981 123 456" });
    assert.equal(a.phone, "+595981123456");
    assert.equal(a.resellerId, py.id);
    assert.throws(() => s.catalog.createCustomer(asR(py), { name: "Lucía otra vez", phone: "981-123-456" }), err("VALIDATION", /ya existe/i));
    // Otro revendedor con el mismo número: tiene su propia ficha y no se entera de que ese número es cliente de otro (B18, 14/11/2026).
    const copia = s.catalog.createCustomer(asR(bo), { name: "Copia", phone: "+595 981 123 456" });
    assert.equal(copia.resellerId, bo.id);
    assert.ok(!JSON.stringify(copia).includes("Lucía"));
    // Un boliviano +591 71234567 y un paraguayo 0971 234 567 son dos personas distintas.
    s.catalog.createCustomer(asR(bo), { name: "Boliviano", phone: "71234567" });
    const pyc = s.catalog.createCustomer(asR(py), { name: "Paraguayo", phone: "0971 234 567" });
    assert.equal(pyc.phone, "+595971234567");
    assert.equal(s.catalog.createCustomer(asR(bo), { name: "Bo 2", phone: "72223333" }).phone, "+59172223333");
    // Editar su cliente también usa su código.
    assert.equal(s.portal.updateClient(asR(py), a.id, { phone: "0982 000 111" }).phone, "+595982000111");
    // Cuaderno de perfiles: igual.
    s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ completa", kind: "full_account", durationDays: 30, price: 4000, published: true });
    s.inventory.addAccount(owner, { productId: "dis", supplierId: "andes", email: "d@x.lat", password: "Clave-D#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] });
    const aid = s.orders.create(owner, { customerId: py.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    const { sub } = s.subs.save(asR(py), aid, { name: "Ana", phone: "0983 555 666", expiresAt: Date.now() + 10 * DAY, price: 3500000 });
    assert.equal(sub.phone, "+595983555666");
    // wa.me: solo dígitos, con el código del país.
    assert.equal(`https://wa.me/${sub.phone.replace(/\D/g, "")}`, "https://wa.me/595983555666");
  });
});

describe("país y moneda del revendedor", () => {
  test("elegir país: valores del país, editables; validaciones; Bolivia = nada guardado", () => {
    const { s, bo, py } = shop();
    const l = s.locale.mine(asR(py));
    assert.deepEqual([l.country, l.dial, l.symbol, l.decimals, l.foreign], ["PY", "595", "₲", 0, true]);
    assert.equal(s.locale.setMine(asR(py), { rate: "1050" }).rate, 1050);
    assert.equal(s.locale.setMine(asR(py), { symbol: "Gs" }).symbol, "Gs", "el símbolo se puede editar");
    assert.equal(s.locale.setMine(asR(py), { symbol: "₲" }).rate, 1050, "lo demás queda");
    assert.throws(() => s.locale.setMine(asR(py), { country: "ZZ" }), err("VALIDATION"));
    assert.throws(() => s.locale.setMine(asR(py), { rate: -3 }), err("VALIDATION"));
    assert.throws(() => s.locale.setMine(asR(py), { country: "XX", dial: "", symbol: "€" }), err("VALIDATION", /código/i));
    assert.equal(s.locale.setMine(asR(bo), { country: "BO" }).foreign, false);
    assert.equal(s.engine.s.customers[bo.id].locale, undefined, "Bolivia por defecto: no cambia nada");
    // Un cliente final no tiene país de revendedor; el vendedor del dueño no lo puede fijar; el admin sí.
    const cli = s.catalog.createCustomer(owner, { name: "Cliente", phone: "+59173333333" });
    assert.throws(() => s.locale.setMine({ id: "web:" + cli.id, role: "customer", customerId: cli.id }, { country: "PY" }), err("FORBIDDEN"));
    assert.throws(() => s.locale.setFor({ id: "u_s", role: "seller" }, py.id, { country: "AR" }), err("FORBIDDEN"));
    assert.equal(s.locale.setFor({ id: "u_a", role: "admin" }, py.id, { country: "AR" }).symbol, "$");
    assert.throws(() => s.locale.setFor(owner, cli.id, { country: "PY" }), err("VALIDATION"));
    // La auditoría registra el cambio sin datos de más.
    assert.ok(s.engine.s.audit.some((a) => a.action === "reseller.locale" && a.data.country === "AR"));
  });

  test("formato: ₲ sin decimales con punto de miles; Bs igual que antes", () => {
    assert.equal(money(3500000, PYG), "₲ 35.000");
    assert.equal(money(100000000, PYG), "₲ 1.000.000");
    assert.equal(money(50000, PYG), "₲ 500");
    assert.equal(money(1250, { symbol: "Bs", decimals: 2 }), "Bs 12,50");
    assert.equal(money(1500, { symbol: "Bs", decimals: 2 }), "Bs 15");
    // Tipo de cambio: 1 Bs = 1050 ₲ → Bs 35 = ₲ 36.750 → hacia arriba a 3 cifras: ₲ 36.800.
    assert.equal(convertFromStore(3500, 1050), 3680000);
    assert.equal(convertFromStore(2500, 1000), 2500000);
    assert.equal(convertFromStore(1000, 0.54), 600, "S/ 5,40 → S/ 6 (sin centavos sueltos)");
  });

  test("lo suyo en ₲, lo de la tienda en Bs: Mi control, ganancias, cuaderno y libreta nunca mezclan", () => {
    const { s, bo, py } = shop();
    s.wallet.adjust(owner, py.id, 10000, "carga de prueba");
    const cl = s.catalog.createCustomer(asR(py), { name: "Lucía", phone: "0981123456" });
    s.portal.setPrices(asR(py), { netflix: 3500 }); // su lista: Bs 35 (al lado de su costo Bs 25)
    const o = s.orders.create(asR(py), { customerId: cl.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance", idempotencyKey: "py-1" });
    const aid = o.assignmentIds[0];
    // Sin tipo de cambio, su lista en Bs no se muestra como si fuera ₲.
    assert.equal(s.rtools.control(asR(py))[0].price, null);
    s.locale.setMine(asR(py), { rate: 1050 });
    assert.equal(s.rtools.control(asR(py))[0].price, 3680000, "su lista convertida con su tipo de cambio");
    s.rtools.setControl(asR(py), aid, { price: 4000040, payStatus: "pendiente" }); // ₲ 40.000,40 → ₲ 40.000
    const row = s.rtools.control(asR(py))[0];
    assert.equal(row.price, 4000000, "₲ sin decimales");
    assert.equal(row.cost, 2500, "lo que le cuesta renovar sigue en Bs");
    const g = s.rtools.earnings(asR(py));
    assert.deepEqual(g.split.mine, PYG);
    assert.equal(g.month.revenue, 4000000);
    assert.equal(g.month.cost, 2500);
    assert.equal(g.month.profit, null, "no se resta ₲ − Bs");
    assert.equal(g.month.profitCollected, null);
    assert.equal(g.byApp[0].profit, null);
    const all = JSON.stringify(g);
    for (const mixed of [4000000 - 2500, 4000000 + 2500]) assert.ok(!all.includes(String(mixed)), `ninguna cifra mezcla monedas (${mixed})`);
    // La libreta (Quién me debe) se llenó sola con lo que le debe, en ₲.
    const fi = s.fiado.overview(asR(py));
    assert.equal(fi.totals.owed, 4000000);
    // Montos grandes en ₲ entran (₲ 150.000 > el tope viejo); en Bs el tope sigue igual.
    assert.equal(s.fiado.charge(asR(py), { customerId: cl.id, amount: 15000000 }).amount, 15000000);
    const bcl = s.catalog.createCustomer(asR(bo), { name: "Rosa", phone: "72000111" });
    assert.throws(() => s.fiado.charge(asR(bo), { customerId: bcl.id, amount: 10000001 }), err("VALIDATION"));
    // El boliviano sigue con su ganancia de siempre (sin "split").
    assert.equal(s.rtools.earnings(asR(bo)).split, undefined);
    assert.equal(s.subs.summary(asR(bo)).split, undefined);
    assert.equal(s.subs.summary(asR(py)).profit, null);
  });

  test("su página /r/<slug>: sin tipo de cambio no salen los productos de la tienda; con tipo de cambio, en ₲", () => {
    const { s, py } = shop();
    s.shops.setupFor(owner, py.id, { slug: "py-demo", title: "Py Demo", whatsapp: "595981000001", enabled: true });
    s.portal.setPrices(asR(py), { netflix: 3500 });
    let pub = s.shops.public("py-demo");
    assert.equal(pub.currencySymbol, "₲");
    assert.equal(pub.currencyDecimals, 0);
    assert.equal(pub.products.filter((p) => p.id === "netflix").length, 0, "sin tipo de cambio: no se muestran Bs a un paraguayo");
    // Sus productos propios marcados para la página salen siempre (ya están en ₲).
    const fl = s.own.saveProduct(asR(py), { name: "Flujo TV", price: 3500000, durationDays: 30, kind: "line", onPage: true });
    s.own.saveAccount(asR(py), { productId: fl.id, user: "flujo01", password: "Secreta-01" });
    pub = s.shops.public("py-demo");
    assert.deepEqual(pub.products.map((p) => [p.name, p.price]), [["Flujo TV", 3500000]]);
    s.locale.setMine(asR(py), { rate: 1050 });
    pub = s.shops.public("py-demo");
    assert.equal(pub.products.find((p) => p.id === "netflix").price, 3680000, "Bs 35 × 1050 → ₲ 36.800");
    const raw = JSON.stringify(pub);
    for (const bad of ["2500", "flujo01", "Secreta-01", '"cost"']) assert.ok(!raw.includes(bad), `la página no muestra ${bad}`);
    // Cupón de su página en la moneda de la página.
    s.engine.s.settings.resellerCoupons = true;
    s.shops.saveCoupon(asR(py), { code: "AMIGO", type: "percent", value: 10 });
    const q = s.shops.quoteCoupon("py-demo", "AMIGO", [{ productId: "netflix", qty: 1 }, { productId: `op_${fl.id}`, qty: 1 }]);
    assert.equal(q.gross, 3680000 + 3500000);
    assert.equal(q.amount, Math.round((3680000 + 3500000) * 0.1));
  });

  test("link de cobro /c/ en ₲", () => {
    const { s, py } = shop();
    s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 4000, published: true, resellersOnly: true });
    s.inventory.addAccount(owner, { productId: "dis", supplierId: "andes", email: "d@x.lat", password: "Clave-D#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] });
    const aid = s.orders.create(owner, { customerId: py.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
    const { sub } = s.subs.save(asR(py), aid, { name: "Ana Gómez", phone: "0983555666", expiresAt: Date.now() + 10 * DAY, price: 2500000, pay: "pendiente" });
    const v = s.subs.publicView(s.subs.link(asR(py), aid, sub.id).token);
    assert.equal(v.currency, "₲");
    assert.equal(v.price, 2500000);
    assert.equal(v.product, "Disney+");
  });
});

describe("país y moneda por HTTP", () => {
  let dir, app, base, s, pyId, cliId;
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
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-pais-"));
    app = createApp({ dataDir: dir, staticDir: PUBLIC, jobs: false, log: () => {}, fetchImpl: async () => { throw new Error("sin red en las pruebas"); } });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    s = app.store;
    pyId = s.catalog.createCustomer(owner, { name: "Py Demo", phone: "+595981000001", kind: "reseller" }).id;
    cliId = s.catalog.createCustomer(owner, { name: "Cliente Final", phone: "+59176666666" }).id;
    cookies.owner = await loginStaff("gabriel", "clave-del-dueño-123");
    await call("POST", "/api/admin/staff", { username: "seba", name: "Seba Ventas", role: "seller", password: "clave-larga-seller-1" }, "owner");
    cookies.seller = await loginStaff("seba", "clave-larga-seller-1");
    cookies.py = await loginCustomer(pyId, "+595981000001");
    cookies.cli = await loginCustomer(cliId, "+59176666666");
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("el revendedor fija su país; /api/me lo trae; cliente, staff y vendedor no pueden", async () => {
    const r = await call("PUT", "/api/me/locale", { country: "PY", rate: 1050 }, "py");
    assert.equal(r.status, 200);
    assert.deepEqual([r.json.symbol, r.json.decimals, r.json.dial, r.json.rate], ["₲", 0, "595", 1050]);
    assert.equal((await call("GET", "/api/me", null, "py")).json.locale.symbol, "₲");
    assert.equal((await call("GET", "/api/me/locale", null, "py")).status, 200);
    assert.equal((await call("PUT", "/api/me/locale", { country: "PY" }, "cli")).status, 403);
    assert.equal((await call("PUT", "/api/me/locale", { country: "PY" }, "owner")).status, 401, "el staff no usa rutas de revendedor");
    assert.equal((await call("PUT", "/api/me/locale", { country: "PY" })).status, 401);
    // El dueño lo fija desde la ficha; el vendedor no; un revendedor tampoco.
    assert.equal((await call("POST", `/api/admin/customers/${pyId}/locale`, { country: "PY", rate: 1100 }, "owner")).json.rate, 1100);
    assert.equal((await call("POST", `/api/admin/customers/${pyId}/locale`, { country: "AR" }, "seller")).status, 403);
    assert.equal((await call("POST", `/api/admin/customers/${pyId}/locale`, { country: "AR" }, "py")).status, 403);
    // La ficha del revendedor muestra su país y cuántas cuentas propias tiene (nada más).
    const ov = (await call("GET", "/api/admin/resellers", null, "owner")).json;
    const row = (Array.isArray(ov) ? ov : ov.list ?? ov.resellers ?? []).find((x) => x.id === pyId);
    assert.equal(row.locale.symbol, "₲");
    assert.deepEqual(row.ownStock, { products: 0, accounts: 0 });
    // El revendedor carga un cliente por HTTP con número local paraguayo.
    const c = await call("POST", "/api/me/customers", { name: "Lucía", phone: "0981 123 456" }, "py");
    assert.equal(c.json.phone, "+595981123456");
  });
});

describe("plata y teléfonos en el navegador (country.js)", () => {
  test("money(), mine() y Pegar mi lista con números y precios de Paraguay", async () => {
    // country.js importa "/common.js" (ruta del servidor): para Node se apunta al archivo.
    const dir = mkdtempSync(join(tmpdir(), "gs-cjs-"));
    try {
      const src = readFileSync(join(PUBLIC, "country.js"), "utf8").replace('from "/common.js"', `from ${JSON.stringify(pathToFileURL(join(PUBLIC, "common.js")).href)}`);
      writeFileSync(join(dir, "country.mjs"), src);
      const c = await import(pathToFileURL(join(dir, "country.mjs")).href);
      const { bs } = await import(pathToFileURL(join(PUBLIC, "common.js")).href);
      assert.equal(c.money(3500000, PYG), "₲ 35.000");
      assert.equal(c.money(1250, { symbol: "Bs", decimals: 2 }), "Bs 12,50");
      // Bolivia (o sin país): mine() es exactamente bs().
      c.setMine(null);
      for (const v of [0, 1500, 1250, 123456]) assert.equal(c.mine(v), bs(v));
      assert.equal(c.findPhone("Rosa 71112233"), null, "Bolivia: sigue la regla de siempre de shop.js");
      assert.equal(c.myPhoneDefault(), "+591 ");
      c.setMine({ country: "PY", dial: "595", symbol: "₲", decimals: 0, rate: 1050, foreign: true });
      assert.equal(c.mine(3500000), "₲ 35.000");
      assert.equal(c.myPhoneDefault(), "", "otro país: sin +591 de entrada");
      for (const t of ["Lucía 0981 123 456 15/12", "Lucía 0981123456", "Lucía +595 981-123-456", "Lucía 981123456"]) assert.equal(c.findPhone(t).phone, "+595981123456", t);
      assert.equal(c.findPrice(" Lucía ₲ 35.000 debe ").cents, 3500000);
      assert.equal(c.findPrice(" Lucía 35000 ").cents, 3500000);
      assert.equal(c.findPrice(" Lucía 35.000 ").cents, 3500000);
      assert.equal(c.findPrice(" Lucía 35 mil ").cents, 3500000);
      assert.equal(c.sellText(3500), "₲ 36.800", "su lista en Bs, convertida para mandarla a sus clientes");
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});
