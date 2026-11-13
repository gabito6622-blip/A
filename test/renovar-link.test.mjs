// Optimización 2 (13/11/2026): renovar con QR o saldo desde un link, APAGADO por defecto. Datos ficticios; nada real.
//  - Apagado: generar un link da 409 y abrir uno da 404. Nada cambia para quien no lo prende.
//  - Prendido: el link muestra UN servicio (sin correo ni clave), fecha actual, fecha nueva, precio y saldo.
//  - Saldo: renueva al instante (plata ya entrada) y el link queda usado. QR: pedido «esperando pago» + comprobante → «En revisión»
//    y lo aprueba el dueño como siempre. Nunca se entrega sin plata confirmada.
//  - Frenos: fecha del proveedor, segundo pago del mismo link (409), clientes de revendedor (409), link vencido, idempotencia.
//  - Acceso «full»: el mismo link deja entrar a Mis cuentas; en «renew» no.
//  - Navegador a 360 px: la pantalla «Renovar» se ve y el botón de saldo renueva.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5, HOUR = 36e5;
const PNG = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

describe("renovar por link (apagado por defecto)", () => {
  let dir, app, base, ownerCk, cli, asg, asg2, rclient, rasg;
  const clock = { t: Date.now(), now() { return this.t; } };
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const get = async (p, ck) => { const r = await fetch(base + p, { headers: ck ? { cookie: ck } : {} }); return { status: r.status, json: await r.json().catch(() => null) }; };
  const tokenOf = (url) => url.split("#renovar=")[1];
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-renovar-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ownerCk = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    await post("/api/admin/products", { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true }, ownerCk);
    await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, ownerCk);
    await post("/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf1@x.lat", password: "Clave-Larga#1", supplierExpiresAt: clock.t + 90 * DAY, cost: 2000, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }, { label: "Perfil 3" }] }, ownerCk);
    await post("/api/admin/settings", { paymentNote: "Banco Demo · QR" }, ownerCk);
    cli = await (await post("/api/admin/customers", { name: "Marisel Rojas", phone: "+59175000001" }, ownerCk)).json();
    const o = await (await post("/api/admin/orders", { customerId: cli.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }, ownerCk)).json();
    asg = o.assignmentIds[0];
    const o2 = await (await post("/api/admin/orders", { customerId: cli.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }, ownerCk)).json();
    asg2 = o2.assignmentIds[0];
    // Cliente de un revendedor: renueva con su revendedor, no por link.
    const rev = await (await post("/api/admin/customers", { name: "Carla Quispe", phone: "+59171000001", kind: "reseller" }, ownerCk)).json();
    await post(`/api/admin/customers/${rev.id}/adjust`, { amount: 50000, reason: "demo" }, ownerCk);
    const RA = { id: "u_" + rev.id, role: "reseller", customerId: rev.id };
    rclient = app.store.catalog.createCustomer(RA, { name: "Kevin Flores", phone: "+59175000009", whatsappConsent: true });
    const o3 = app.store.orders.create(RA, { customerId: rclient.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "balance" });
    rasg = o3.assignmentIds[0];
    // Cuenta que vence pronto con el proveedor (la única con lugar libre ahora): el link no puede renovar más allá.
    await post("/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf-corta@x.lat", password: "Clave-Larga#1", supplierExpiresAt: clock.t + 10 * DAY, cost: 2000, profiles: [{ label: "Perfil 1" }] }, ownerCk);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("apagado de fábrica: Configuración lo dice, generar link da 409 y un token cualquiera da 404", async () => {
    const sup = (await get("/api/admin/settings/soporte", ownerCk)).json;
    assert.deepEqual(sup.renewLink, { enabled: false, access: "renew", hours: 48 });
    const r = await post(`/api/admin/assignments/${asg}/renew-link`, {}, ownerCk);
    assert.equal(r.status, 409); assert.equal((await r.json()).error, "RENEW_LINKS_OFF");
    assert.equal((await get("/api/renovar/abcdefghijklmnopqrstuvwxyz0123456789")).status, 404);
    assert.equal((await post("/api/renovar/abcdefghijklmnopqrstuvwxyz0123456789", { method: "balance" })).status, 404);
  });

  test("ajuste validado: horas de 1 a 168, acceso renew/full; se guarda y se lee", async () => {
    assert.equal((await post("/api/admin/settings", { renewLink: { enabled: true, hours: 0 } }, ownerCk)).status, 400);
    assert.equal((await post("/api/admin/settings", { renewLink: { enabled: true, access: "root" } }, ownerCk)).status, 400);
    assert.equal((await post("/api/admin/settings", { renewLink: { enabled: true, access: "renew", hours: 48 } }, ownerCk)).status, 200);
    assert.deepEqual((await get("/api/admin/settings/soporte", ownerCk)).json.renewLink, { enabled: true, access: "renew", hours: 48 });
    assert.equal((await get("/api/settings")).json.renewLink, undefined, "el ajuste no se publica a la tienda");
  });

  test("prendido: el link muestra el servicio sin correo ni clave; sin sesión 401 para generarlo; clientes de revendedor 409", async () => {
    assert.equal((await post(`/api/admin/assignments/${asg}/renew-link`, {})).status, 401);
    const r = await post(`/api/admin/assignments/${rasg}/renew-link`, {}, ownerCk);
    assert.equal(r.status, 409); assert.equal((await r.json()).error, "VIA_RESELLER");
    const link = await (await post(`/api/admin/assignments/${asg}/renew-link`, {}, ownerCk)).json();
    assert.match(link.url, /\/tienda\/#renovar=[\w-]{16,}$/);
    assert.ok(link.expiresAt > clock.t + 47 * HOUR && link.expiresAt <= clock.t + 48 * HOUR);
    const v = (await get(`/api/renovar/${tokenOf(link.url)}`)).json;
    assert.equal(v.name, "Marisel"); assert.equal(v.product, "Netflix perfil"); assert.equal(v.price, 3500); assert.equal(v.currency, "BOB");
    assert.equal(v.days, 30); assert.equal(v.to - v.from, 30 * DAY); assert.equal(v.supplierOk, true); assert.equal(v.access, "renew");
    assert.equal(v.canBalance, false); assert.equal(v.balance, 0); assert.equal(v.pending, null);
    const txt = JSON.stringify(v);
    assert.ok(!txt.includes("nf1@x.lat") && !txt.includes("Clave-Larga"), "no muestra correo ni clave");
    assert.ok(!txt.includes(cli.phone), "no muestra el teléfono");
  });

  test("saldo: renueva al instante, el link queda usado y la misma llave no cobra dos veces", async () => {
    await post(`/api/admin/customers/${cli.id}/adjust`, { amount: 10000, reason: "recarga demo" }, ownerCk);
    const link = await (await post(`/api/admin/assignments/${asg}/renew-link`, {}, ownerCk)).json();
    const tk = tokenOf(link.url);
    const before = (await get(`/api/renovar/${tk}`)).json;
    assert.equal(before.canBalance, true);
    const r1 = await post(`/api/renovar/${tk}`, { method: "balance", idempotencyKey: "k1" });
    const j1 = await r1.json();
    assert.equal(r1.status, 200, JSON.stringify(j1));
    assert.equal(j1.order.status, "fulfilled"); assert.equal(j1.order.total, 3500); assert.equal(j1.assignment.expiresAt, before.to);
    // Segundo toque con el mismo link: ya se usó.
    assert.equal((await post(`/api/renovar/${tk}`, { method: "balance", idempotencyKey: "k1" })).status, 404);
    const a = app.store.engine.s.assignments[asg];
    assert.equal(a.customerExpiresAt, before.to, "corrió exactamente un período");
    assert.equal(app.store.wallet.balance(cli.id), 10000 - 3500, "se descontó una vez");
    const audit = app.store.engine.s.audit.filter((x) => x.action === "renewal.create" && x.entityId === j1.order.id);
    assert.equal(audit.length, 1); assert.match(audit[0].actorId, /^renewlink:/);
  });

  test("QR: pedido esperando pago → comprobante → En revisión → el dueño aprueba; sin aprobar no se entrega; no se duplica", async () => {
    const link = await (await post(`/api/admin/assignments/${asg2}/renew-link`, {}, ownerCk)).json();
    const tk = tokenOf(link.url);
    const v0 = (await get(`/api/renovar/${tk}`)).json;
    const r1 = await post(`/api/renovar/${tk}`, { method: "qr", idempotencyKey: "q1" });
    assert.equal(r1.status, 200);
    const j1 = await r1.json();
    assert.equal(j1.order.status, "awaiting_payment");
    assert.equal(app.store.engine.s.assignments[asg2].customerExpiresAt, v0.expiresAt, "sin plata confirmada no corre la fecha");
    const v1 = (await get(`/api/renovar/${tk}`)).json;
    assert.deepEqual(v1.pending, { id: j1.order.id, status: "awaiting_payment", hasEvidence: false });
    // Un segundo pedido por el mismo link no se crea.
    const dup = await post(`/api/renovar/${tk}`, { method: "qr", idempotencyKey: "q2" });
    assert.equal(dup.status, 409); assert.equal((await dup.json()).error, "ALREADY_PENDING");
    // Comprobante.
    const ev = await post(`/api/renovar/${tk}/evidence`, { contentBase64: PNG, declaredReference: "778899" });
    assert.equal(ev.status, 200); assert.equal((await ev.json()).status, "payment_review");
    assert.equal((await get(`/api/renovar/${tk}`)).status, 404, "en modo «solo renovar», mandado el comprobante el link ya cumplió");
    const o = app.store.engine.s.orders[j1.order.id];
    assert.equal(o.status, "payment_review"); assert.equal(o.evidence?.declaredReference, "778899");
    // Aprobación humana, como siempre.
    const ap = await post(`/api/admin/orders/${j1.order.id}/approve`, { confirmedReference: "778899" }, ownerCk);
    assert.equal(ap.status, 200);
    assert.equal(app.store.engine.s.orders[j1.order.id].status, "fulfilled");
    assert.equal(app.store.engine.s.assignments[asg2].customerExpiresAt, v0.to, "recién al aprobar corre la fecha, un período");
  });

  test("freno del proveedor: la fecha nueva no pasa la de la cuenta; el link lo dice y no cobra", async () => {
    const o = await (await post("/api/admin/orders", { customerId: cli.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }, ownerCk)).json();
    const a3 = o.assignmentIds[0];
    assert.equal(app.store.engine.s.accounts[app.store.engine.s.slots[app.store.engine.s.assignments[a3].slotId].accountId].email, "nf-corta@x.lat");
    const link = await (await post(`/api/admin/assignments/${a3}/renew-link`, {}, ownerCk)).json();
    const v = (await get(`/api/renovar/${tokenOf(link.url)}`)).json;
    assert.equal(v.supplierOk, false);
    const bal0 = app.store.wallet.balance(cli.id);
    const r = await post(`/api/renovar/${tokenOf(link.url)}`, { method: "balance" });
    assert.equal(r.status, 409); assert.equal((await r.json()).error, "SUPPLIER_EXPIRY_EXCEEDED");
    assert.equal(app.store.wallet.balance(cli.id), bal0, "no descontó nada");
    // Stock para lo que sigue.
    await post("/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf2@x.lat", password: "Clave-Larga#1", supplierExpiresAt: clock.t + 90 * DAY, cost: 2000, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }, { label: "Perfil 3" }, { label: "Perfil 4" }, { label: "Perfil 5" }] }, ownerCk);
  });

  test("link vencido (48 h) → 404; apagar el interruptor invalida los links vivos; «entrar» solo con acceso full", async () => {
    const link = await (await post(`/api/admin/assignments/${asg}/renew-link`, {}, ownerCk)).json();
    const tk = tokenOf(link.url);
    const en = await post(`/api/renovar/${tk}/entrar`, {});
    assert.equal(en.status, 403, "en «solo renovar» no entra a Mis cuentas");
    await post("/api/admin/settings", { renewLink: { enabled: true, access: "full", hours: 48 } }, ownerCk);
    const en2 = await post(`/api/renovar/${tk}/entrar`, {});
    assert.equal(en2.status, 200);
    const ck = en2.headers.get("set-cookie").split(";")[0];
    const me = (await get("/api/me", ck)).json;
    assert.equal(me.loggedIn, true); assert.equal(me.name, "Marisel Rojas");
    clock.t += 49 * HOUR;
    assert.equal((await get(`/api/renovar/${tk}`)).status, 404, "a las 49 h ya no sirve");
    clock.t -= 49 * HOUR;
    const link2 = await (await post(`/api/admin/assignments/${asg}/renew-link`, {}, ownerCk)).json();
    await post("/api/admin/settings", { renewLink: { enabled: false, access: "renew", hours: 48 } }, ownerCk);
    assert.equal((await get(`/api/renovar/${tokenOf(link2.url)}`)).status, 404, "apagado: ni los links ya mandados sirven");
    await post("/api/admin/settings", { renewLink: { enabled: true, access: "renew", hours: 48 } }, ownerCk);
  });

  test("el aviso de Tito lleva el link cuando está prendido (y la tienda común cuando está apagado); nada se manda solo", async () => {
    const { createExpiryPush } = await import("../dist/server/expiryPush.js");
    // Un servicio que vence en 1 día (Tito avisa a 3, 1 y 0 días).
    const o = await (await post("/api/admin/orders", { customerId: cli.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }, ownerCk)).json();
    const aT = o.assignmentIds[0];
    const t0 = clock.t;
    const run = async (renewLink) => {
      const sent = [];
      const tito = createExpiryPush({ route: () => {}, store: app.store, db: app.db, now: () => clock.t, pushOn: () => true, publicKey: () => "k", send: async () => "ok",
        customerPush: async (cid, msg) => { sent.push({ cid, ...msg }); return { sent: 1, failed: 0 }; }, customerIds: () => [cli.id], cobro: (c, fn) => fn(), tooMany: () => { throw new Error("tooMany"); }, ...(renewLink ? { renewLink } : {}) });
      await tito.check();
      return sent;
    };
    try {
      // Mañana vence, a las 12:00 de Bolivia (Tito no avisa antes de las 9): día de Bolivia del vencimiento − 1, + 16 h UTC.
      const { boDayStart } = await import("../dist/store/time.js");
      clock.t = boDayStart(app.store.engine.s.assignments[aT].customerExpiresAt) - DAY + 16 * HOUR;
      const off = await run(null);
      assert.equal(off.length, 1); assert.equal(off[0].url, "/tienda/#cuentas");
      clock.t += DAY; // hoy vence (otro día: Tito vuelve a avisar)
      const on = await run((id) => `${base}/tienda/#renovar=TOKEN-${id}`);
      assert.equal(on.length, 1); assert.match(on[0].url, /#renovar=TOKEN-/);
    } finally { clock.t = t0; }
    // El camino real de app.ts: con publicOrigin y el interruptor prendido, el aviso trae un token válido.
    const link = await (await post(`/api/admin/assignments/${aT}/renew-link`, {}, ownerCk)).json();
    assert.equal((await get(`/api/renovar/${tokenOf(link.url)}`)).status, 200);
  });

  test("navegador a 360 px: abre el link, ve servicio/fechas/precio y renueva con saldo", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
    await post(`/api/admin/customers/${cli.id}/adjust`, { amount: 10000, reason: "recarga demo" }, ownerCk);
    const o = await (await post("/api/admin/orders", { customerId: cli.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }, ownerCk)).json();
    const a4 = o.assignmentIds[0];
    const link = await (await post(`/api/admin/assignments/${a4}/renew-link`, {}, ownerCk)).json();
    const url = base + "/tienda/#renovar=" + tokenOf(link.url);
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(url);
      await p.waitForSelector('[data-renew-pay="balance"]', { timeout: 20_000 });
      assert.equal(new URL(p.url()).hash, "#renovar", "el token no queda en la barra");
      const txt = (await p.locator("#sout").innerText()).replace(/\s+/g, " ");
      assert.match(txt, /Marisel/); assert.match(txt, /Netflix perfil/); assert.match(txt, /Nueva fecha/); assert.match(txt, /35\.00/);
      assert.ok(!txt.includes("nf1@x.lat"), "sin correo en pantalla");
      const sw = await p.evaluate(() => document.documentElement.scrollWidth); assert.ok(sw <= 360, `sin scroll horizontal (${sw})`);
      const h = await p.evaluate(() => Math.round(document.querySelector('[data-renew-pay="balance"]').getBoundingClientRect().height)); assert.ok(h >= 44, `botón de ${h}px`);
      await p.click('[data-renew-pay="balance"]');
      await p.waitForSelector("#sout >> text=¡Renovado!", { timeout: 20_000 });
      assert.match((await p.locator("#sout").innerText()).replace(/\s+/g, " "), /ahora vence el \d\d\/\d\d\/\d{4}/);
      assert.equal(app.store.engine.s.orders[Object.keys(app.store.engine.s.orders).at(-1)].status, "fulfilled");
      assert.deepEqual(errs, []);
      // Secretaria: el botón «Link para renovar» aparece para el cliente directo y no para el de revendedor.
      const [n, v] = ownerCk.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const o5 = await (await post("/api/admin/orders", { customerId: cli.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }, ownerCk)).json();
      await post(`/api/admin/assignments/${o5.assignmentIds[0]}/control`, { note: "🔔 EN COBRO", payStatus: "pendiente" }, ownerCk);
      await post(`/api/admin/assignments/${rasg}/control`, { note: "🔔 EN COBRO", payStatus: "pendiente" }, ownerCk);
      await p.goto(base + "/panel.html#secretaria");
      await p.waitForSelector(`[data-seclink="${o5.assignmentIds[0]}"]`, { timeout: 20_000 });
      assert.equal(await p.locator(`[data-seclink="${rasg}"]`).count(), 0, "el cliente del revendedor no tiene link");
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
  });
});
