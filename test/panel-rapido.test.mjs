// Premium 2.0 · etapa 3 "Panel rápido y oscuro" (12/11/2026). Datos ficticios.
//  1. GET /api/admin/inicio trae en UNA llamada lo mismo que los 6 endpoints que Inicio pedía encadenados.
//  2. En el navegador: Inicio hace una sola lectura grande; filtrar el Control no vuelve a pedir la lista;
//     después de guardar algo, la lista se vuelve a pedir (la caché se vacía).
//  3. El panel arranca oscuro (Premium) y recuerda si elegís claro; el oscuro usa los colores de tema.css.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

describe("etapa 3 · panel rápido y oscuro", () => {
  let dir, app, base, owner, admin, custCk;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const get = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, json: await r.json().catch(() => null) }; };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-rapido-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    await post("/api/admin/staff", { username: "lucia", name: "Lucía", role: "admin", password: "clave-de-lucia-123" }, owner);
    admin = (await post("/api/auth/staff/login", { username: "lucia", password: "clave-de-lucia-123" })).headers.get("set-cookie").split(";")[0];
    await post("/api/admin/products", { id: "dis", name: "Disney (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true }, owner);
    await post("/api/admin/products", { id: "nf", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true }, owner);
    await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, owner);
    for (let i = 0; i < 4; i++) await post("/api/admin/accounts", { productId: "dis", supplierId: "andes", email: `dis${i}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] }, owner);
    await post("/api/admin/accounts", { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2500, profiles: [1, 2, 3].map((k) => ({ label: `P${k}` })) }, owner);
    const rev = await (await post("/api/admin/customers", { name: "ARIt", phone: "+59170000001", kind: "reseller" }, owner)).json();
    const ana = await (await post("/api/admin/customers", { name: "Ana Prueba", phone: "+59170011223" }, owner)).json();
    for (let i = 0; i < 3; i++) await post("/api/admin/orders", { customerId: rev.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }, owner);
    await post("/api/admin/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }, owner);
    // Un pago por revisar (QR con comprobante) para que pendingReview no sea 0.
    await post(`/api/admin/customers/${ana.id}/login-pin`, { pin: "2468" }, owner);
    custCk = (await post("/api/auth/customer/pin", { phone: ana.phone, pin: "2468" })).headers.get("set-cookie").split(";")[0];
    const o = await (await post("/api/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr", idempotencyKey: "q1" }, custCk)).json();
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
    await post(`/api/orders/${o.id}/evidence`, { contentBase64: png, declaredReference: "OP-1" }, custCk);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("/api/admin/inicio trae lo mismo que los endpoints sueltos; el admin no ve finanzas; un cliente no entra", async () => {
    const ini = (await get("/api/admin/inicio", owner)).json;
    assert.deepEqual(ini.assignments, (await get("/api/admin/assignments", owner)).json);
    assert.equal(ini.assignments.length, 4);
    assert.equal(ini.pendingReview, (await get("/api/admin/orders?status=payment_review", owner)).json.length);
    assert.equal(ini.pendingReview, 1);
    assert.equal(ini.finance.current.ingresos, (await get("/api/admin/finance?months=1", owner)).json.current.ingresos);
    assert.equal(ini.finance.current.ingresos, 3 * 6900 + 3500);
    assert.deepEqual(ini.notifications, (await get("/api/admin/notifications", owner)).json);
    const ai = (await get("/api/admin/ai", owner)).json;
    assert.deepEqual([ini.ai.hasKey, ini.ai.enabled, ini.ai.model], [ai.hasKey, ai.enabled, ai.model]);
    assert.equal(ini.sinPin, 1, "ARIt todavía no tiene PIN");
    const adm = (await get("/api/admin/inicio", admin)).json;
    assert.equal(adm.finance, null, "las finanzas son del dueño");
    assert.equal(adm.assignments.length, 4);
    assert.equal(adm.ai.daily, null);
    assert.ok([401, 403].includes((await get("/api/admin/inicio", custCk)).status));
    assert.equal((await get("/api/admin/inicio")).status, 401);
  });

  test("navegador: Inicio con una sola lectura grande; filtrar el Control no vuelve a pedir; guardar sí; oscuro por defecto y claro recordado", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [n, v] = owner.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      const reqs = []; p.on("request", (r) => { const u = new URL(r.url()); if (u.pathname.startsWith("/api/")) reqs.push(u.pathname + u.search); });
      const count = (re) => reqs.filter((x) => re.test(x)).length;

      // 1) Inicio: una llamada /api/admin/inicio y ninguna de las 5 que antes iban encadenadas.
      await p.goto(base + "/panel.html#inicio");
      await p.waitForSelector(".sec-cta", { timeout: 20_000 });
      await p.waitForTimeout(400);
      assert.equal(count(/^\/api\/admin\/inicio$/), 1, "una sola lectura de Inicio");
      for (const re of [/^\/api\/admin\/assignments/, /^\/api\/admin\/ai$/, /^\/api\/admin\/resellers$/, /^\/api\/admin\/finance/]) assert.equal(count(re), 0, `Inicio ya no pide ${re}`);
      assert.ok(count(/^\/api\/admin\/notifications$/) <= 1, "notificaciones: a lo sumo la campanita, no la pantalla");
      const totalInicio = reqs.length;
      // Antes: 12 pedidos (me, settings, pagos ×2, notificaciones ×2, assignments, finance, ai, resellers, usdt, winback).
      // Ahora: me, settings, pagos (campanita), notificaciones (campanita), inicio, usdt, winback = 7.
      assert.ok(totalInicio <= 7, `Inicio hizo ${totalInicio} pedidos (${reqs.join(", ")}); se esperaban 7 o menos`);

      // 2) Tema: oscuro por defecto, con los colores de tema.css; elegir claro se recuerda al recargar.
      const theme = () => p.evaluate(() => ({ dark: document.getElementById("app").classList.contains("dark"), gs: document.documentElement.dataset.gsTheme, bg: getComputedStyle(document.getElementById("app")).getPropertyValue("--bg").trim(), stored: (() => { try { return localStorage.getItem("gs-panel-theme"); } catch { return null; } })() }));
      let th = await theme();
      assert.equal(th.dark, true, "arranca oscuro");
      assert.equal(th.gs, "dark");
      assert.equal(th.bg, "#070b16", "el oscuro del panel usa --gs-bg de tema.css");
      await p.evaluate(() => document.querySelector('[data-th="light"]').click());
      th = await theme();
      assert.deepEqual([th.dark, th.gs, th.stored], [false, "light", "light"]);
      await p.reload(); await p.waitForSelector(".sec-cta", { timeout: 20_000 });
      th = await theme();
      assert.equal(th.dark, false, "sigue claro después de recargar");
      await p.evaluate(() => document.querySelector('[data-th="dark"]').click());

      // 3) Control: la lista se pide una vez; filtrar por pestaña no vuelve a pedirla; guardar un cambio la vuelve a pedir.
      reqs.length = 0;
      await p.goto("about:blank"); // cambiar solo el #hash no recarga la página
      await p.goto(base + "/panel.html#control");
      await p.waitForSelector('[data-tab^="cf:"]', { timeout: 20_000 });
      await p.waitForTimeout(300);
      const before = count(/^\/api\/admin\/assignments$/);
      assert.ok(before >= 1 && before <= 2, `el Control pidió la lista ${before} vez/veces`);
      const nTabs = await p.evaluate(() => document.querySelectorAll('[data-tab^="cf:"]').length);
      assert.ok(nTabs >= 2, "hay pestañas de filtro");
      const tab = (i) => p.evaluate((k) => document.querySelectorAll('[data-tab^="cf:"]')[k].click(), i); // la fila de chips se desplaza: clic por JS
      await tab(1); await p.waitForTimeout(300);
      await tab(0); await p.waitForTimeout(300);
      assert.equal(count(/^\/api\/admin\/assignments$/), before, "filtrar no vuelve a pedir la lista");
      // Guardar un cambio (una nota en el Control) vacía la caché: la lista se vuelve a pedir en el próximo dibujado.
      const firstAsg = (await get("/api/admin/assignments", owner)).json[0].id;
      await p.evaluate(async (id) => { const { api } = await import("/common.js"); await api("POST", `/api/admin/assignments/${id}/control`, { note: "prueba de caché" }); }, firstAsg);
      await tab(1); await p.waitForTimeout(400);
      assert.equal(count(/^\/api\/admin\/assignments$/), before + 1, "después de guardar, la lista se pide de nuevo");
      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  });
});
