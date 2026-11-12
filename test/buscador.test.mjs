// 🔎 Buscador del panel (etapa 3): encuentra clientes, revendedores, servicios, cuentas y pedidos, y cada rol ve
// SOLO lo que ya veía en sus pantallas. Nunca devuelve contraseñas, PIN ni costos. Datos ficticios.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

describe("buscador del panel", () => {
  let dir, app, base, owner, seller, anaCk, ana, ord;
  const login = async (u, p) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) })).headers.get("set-cookie").split(";")[0];
  const call = async (path, ck = owner, method = "GET", body) => { const r = await fetch(base + path, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j, raw: t }; };
  const S = async (q, ck = owner) => (await call("/api/admin/search?q=" + encodeURIComponent(q), ck)).json;
  const keys = (r) => r.groups.map((g) => g.key);

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-buscador-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = await login("gabriel", "clave-del-dueño-123");
    await call("/api/admin/staff", owner, "POST", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
    seller = await login("lucia", "clave-de-lucia-123");
    await call("/api/admin/products", owner, "POST", { id: "disney", name: "Disney+", kind: "profile", durationDays: 30, price: 3500, published: true });
    await call("/api/admin/suppliers", owner, "POST", { id: "andes", name: "Andes", active: true });
    await call("/api/admin/accounts", owner, "POST", { productId: "disney", supplierId: "andes", email: "disney.uno@ejemplo.lat", password: "Secreta#99", supplierExpiresAt: Date.now() + 40 * 864e5, cost: 2000, profiles: [{ label: "Perfil 1", pin: "4321" }, { label: "Perfil 2" }] });
    ana = (await call("/api/admin/customers", owner, "POST", { name: "Ana María Quispe", phone: "+591 700-11223" })).json;
    await call("/api/admin/customers", owner, "POST", { name: "Rosa TV", phone: "+59171111111", kind: "reseller" });
    await call("/api/admin/orders", owner, "POST", { customerId: ana.id, items: [{ productId: "disney", qty: 1 }], paymentMethod: "cash" });
    const url = (await call(`/api/admin/customers/${ana.id}/login-link`, owner, "POST", {})).json.url;
    anaCk = (await fetch(base + "/api/auth/customer/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: url.split("#acceso=")[1] }) })).headers.get("set-cookie").split(";")[0];
    ord = (await call("/api/orders", anaCk, "POST", { items: [{ productId: "disney", qty: 1 }], paymentMethod: "qr" })).json;
    const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
    await call(`/api/orders/${ord.id}/evidence`, anaCk, "POST", { contentBase64: PNG, declaredReference: "OP-778899" });
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("el dueño encuentra todo: sin tildes, por teléfono, por correo de cuenta, por referencia del banco", async () => {
    const r = await S("maria quispe");
    assert.deepEqual(keys(r).slice(0, 2), ["customers", "services"]);
    assert.equal(r.groups[0].items[0].title, "Ana María Quispe");
    assert.equal(r.groups[0].items[0].id, ana.id);
    assert.equal((await S("11223")).groups[0].items[0].id, ana.id, "por los últimos números del teléfono");
    const acc = await S("disney.uno");
    assert.ok(keys(acc).includes("accounts") && keys(acc).includes("services"));
    assert.match(acc.groups.find((g) => g.key === "accounts").items[0].sub, /^Disney\+ · \d libres? de 2 · proveedor vence \d\d\/\d\d$/);
    assert.equal((await S("rosa")).groups.find((g) => g.key === "resellers").items[0].title, "Rosa TV");
    const op = await S("op-778899");
    assert.equal(op.groups.find((g) => g.key === "orders").items[0].id, ord.id, "por la referencia que mandó el cliente");
    assert.equal((await S(ord.id)).groups.find((g) => g.key === "orders").items[0].id, ord.id, "por número de pedido");
  });

  test("nunca devuelve contraseñas, PIN, costos ni ganancias", async () => {
    for (const q of ["disney", "ana", "4321", "secreta", "2000"]) {
      // Solo los resultados (la respuesta repite lo que se buscó en "q").
      const res = JSON.stringify((await call("/api/admin/search?q=" + q)).json.groups);
      assert.ok(!/Secreta#99|4321|"cost"|"gain"|"password"|"pin"/i.test(res), `«${q}» no filtra datos sensibles`);
    }
    assert.deepEqual((await S("secreta")).groups, [], "buscar por la contraseña no encuentra nada");
  });

  test("atención (vendedor) ve clientes y servicios, pero no cuentas ni pedidos; un cliente no puede buscar", async () => {
    const r = await S("disney", seller);
    assert.ok(keys(r).includes("services"));
    assert.ok(!keys(r).includes("accounts"), "las cuentas son de dueño y admin, como la pantalla Cuentas");
    assert.ok(!keys(await S("op-778899", seller)).includes("orders"), "los pedidos son de quien aprueba pagos");
    assert.equal((await S("ana", seller)).groups[0].key, "customers");
    assert.ok([401, 403].includes((await call("/api/admin/search?q=ana", anaCk)).status));
    assert.equal((await call("/api/admin/search?q=ana", null)).status, 401);
  });

  test("menos de 2 letras no busca", async () => {
    assert.deepEqual((await S("a")).groups, []);
    assert.deepEqual((await S("   ")).groups, []);
  });

  test("navegador a 360 px: botón Buscar arriba, tecla /, Inicio abre el buscador y cada resultado abre su pantalla", { skip: !chromium, timeout: 120_000 }, async () => {
    const b = await chromium.launch();
    try {
      for (const scheme of ["light", "dark"]) {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme });
        await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        await p.goto(base + "/panel.html#inicio");
        await p.fill("input[name=username]", "gabriel"); await p.fill("input[name=password]", "clave-del-dueño-123"); await p.press("input[name=password]", "Enter");
        await p.waitForSelector("#hmSearch");
        // Botón de arriba.
        await p.click('[data-gsopen="1"]');
        await p.fill("#gsInput", "quispe");
        await p.waitForSelector('.gs-item[data-gsitem="customer"]');
        const m = await p.evaluate(() => ({
          over: document.documentElement.scrollWidth > innerWidth + 1,
          small: [...document.querySelectorAll("#gsearch button, #gsInput")].filter((x) => { const r = x.getBoundingClientRect(); return r.height && r.height < 44; }).length,
          tiny: [...document.querySelectorAll("#gsearch *")].filter((x) => [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 12).length,
          top: [...document.querySelectorAll(".ptop .ibtn")].every((x) => x.getBoundingClientRect().right <= innerWidth),
        }));
        assert.deepEqual(m, { over: false, small: 0, tiny: 0, top: true }, `${scheme}: cómodo en el celular`);
        // Resultado de cliente → Clientes con su ficha abierta.
        await p.click('.gs-item[data-gsitem="customer"]');
        await p.waitForFunction(() => location.hash === "#clientes" && document.querySelector("details.rcli[open]"));
        assert.match(await p.locator("details.rcli[open] summary").innerText(), /Ana María Quispe/);
        // Tecla "/" y Esc.
        await p.locator("body").click({ position: { x: 5, y: 300 } }).catch(() => {});
        await p.keyboard.press("/");
        await p.waitForSelector("#gsInput");
        await p.keyboard.press("Escape");
        assert.equal(await p.locator("#gsearch").count(), 0);
        // Inicio: su buscador abre el general, y "Ver todo en el Control" hace lo de antes.
        await p.evaluate(() => { location.hash = "inicio"; document.querySelector('#pbnav [data-go="inicio"]').click(); });
        await p.waitForSelector("#hmSearch");
        await p.fill("#hmSearch input[name=q]", "ana"); await p.press("#hmSearch input[name=q]", "Enter");
        await p.waitForSelector(".gs-all");
        await p.click(".gs-all");
        await p.waitForFunction(() => location.hash === "#control");
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    } finally { await b.close(); }
  });
});
