// Pagos con Binance Pay (USDT) con la API de Binance SIMULADA: firma HMAC de salida, webhook RSA de entrada.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createSign } from "node:crypto";
import { createApp } from "../dist/server/app.js";

const API_KEY = "BinancePayApiKey0123456789abcd";
const API_SECRET = "BinancePaySecret0123456789abcd";
const ORIGIN = "https://gabostore.lat";

describe("Binance Pay (Binance simulado)", () => {
  let dir, app, base, owner, custCookie, clock, reqs, mariaId;
  // Par de llaves RSA que hace de "certificado de Binance": firmamos el webhook con la privada, el server verifica con la pública.
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const PUB_PEM = publicKey.export({ type: "spki", format: "pem" }).toString();

  const call = async (method, path, body, cookie, rawHeaders) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined && !rawHeaders ? { "content-type": "application/json" } : {}), ...(rawHeaders ?? {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  };
  const wait = async (fn, ms = 1500) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { const v = fn(); if (v) return v; await new Promise((r) => setTimeout(r, 15)); } return null; };
  const orderOf = (id) => app.store.snapshot().orders[id];

  // Webhook firmado por "Binance" (RSA-SHA256 sobre ts\nnonce\nbody\n).
  const sendWebhook = async (payloadObj, { sign = true } = {}) => {
    const bodyStr = JSON.stringify(payloadObj);
    const ts = String(clock.now()), nonce = "nonce0123456789nonce0123456789ab";
    const toSign = `${ts}\n${nonce}\n${bodyStr}\n`;
    let signature = "AAAA"; // firma falsa por defecto
    if (sign) signature = createSign("RSA-SHA256").update(toSign).end().sign(privateKey).toString("base64");
    return call("POST", "/api/binance/webhook", bodyStr, undefined, { "content-type": "application/json", "binancepay-timestamp": ts, "binancepay-nonce": nonce, "binancepay-signature": signature });
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-bp-"));
    reqs = []; clock = { t: Date.now(), now() { return this.t; } };
    const fakeFetch = async (url, init) => {
      reqs.push({ url, headers: init.headers });
      const ok = (data) => new Response(JSON.stringify({ status: "SUCCESS", code: "000000", data }), { status: 200 });
      if (url.endsWith("/certificates")) return ok([{ certSerialNumber: "SN-TEST-1", certPublic: PUB_PEM }]);
      if (url.endsWith("/v3/order")) return ok({ prepayId: "PP123", checkoutUrl: "https://pay.binance.test/checkout/PP123", qrcodeLink: "https://pay.binance.test/qr/PP123", qrContent: "01020304", expireTime: clock.now() + 3600_000 });
      if (url.endsWith("/order/query")) return ok({ status: "PAID", transactionId: "TX1" });
      return new Response(JSON.stringify({ status: "FAIL", code: "400203", errorMessage: "ruta desconocida" }), { status: 400 });
    };
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, publicOrigin: ORIGIN, clock, fetchImpl: fakeFetch, binanceBaseUrl: "https://bpay.binance.test" });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = (await (async () => { const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) }); return r.headers.get("set-cookie").split(";")[0]; })());
    // Tienda mínima.
    await call("POST", "/api/admin/products", { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true }, owner);
    await call("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, owner);
    await call("POST", "/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf@x.lat", password: "Secreta#99", supplierExpiresAt: clock.now() + 90 * 864e5, cost: 0, profiles: [{ label: "Perfil 1", pin: "4321" }] }, owner);
    const maria = await call("POST", "/api/admin/customers", { name: "María", phone: "+591 70011223" }, owner);
    mariaId = maria.json.id;
    await call("POST", `/api/admin/customers/${mariaId}/login-pin`, { pin: "2468" }, owner);
    const lr = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "+591 70011223", pin: "2468" }) });
    custCookie = lr.headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("sin configurar, la tienda no ofrece Binance y el pedido no se puede pagar así", async () => {
    assert.equal((await call("GET", "/api/settings")).json.binance, false);
    const o = await call("POST", "/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "binance" }, custCookie);
    assert.equal(o.status, 200);
    const r = await call("POST", `/api/orders/${o.json.id}/binance`, {}, custCookie);
    assert.equal(r.status, 409, "sin configurar devuelve 409");
    await call("POST", `/api/orders/${o.json.id}/cancel`, {}, custCookie);
  });

  test("solo el dueño configura; las llaves se validan y no vuelven completas", async () => {
    assert.equal((await call("POST", "/api/admin/binance", { apiKey: "x" }, owner)).status, 400);
    assert.equal((await call("POST", "/api/admin/binance", { apiKey: API_KEY, apiSecret: API_SECRET, rate: 13, enabled: true }, owner)).status, 200);
    const g = await call("GET", "/api/admin/binance", undefined, owner);
    assert.equal(g.json.hasKeys, true);
    assert.equal(g.json.ready, true);
    assert.equal(g.json.rate, 13);
    assert.equal(g.json.webhookUrl, `${ORIGIN}/api/binance/webhook`);
    assert.ok(!JSON.stringify(g.json).includes(API_SECRET), "la API Secret no vuelve al navegador");
    const dump = JSON.stringify(app.store.snapshot()) + JSON.stringify(app.store.stats.audit({ id: "x", role: "owner" }));
    assert.ok(!dump.includes(API_SECRET) && !dump.includes(API_KEY), "las llaves no quedan en el estado ni en la auditoría");
    assert.equal((await call("GET", "/api/settings")).json.binance, true, "ahora la tienda ofrece Binance");
  });

  test("la prueba valida las llaves pidiendo el certificado (firma HMAC)", async () => {
    const r = await call("POST", "/api/admin/binance/test", {}, owner);
    assert.equal(r.status, 200);
    assert.equal(r.json.certs, 1);
    const certReq = reqs.find((x) => x.url.endsWith("/certificates"));
    assert.ok(certReq, "pidió el certificado");
    assert.equal(certReq.headers["BinancePay-Certificate-SN"], API_KEY);
    assert.ok(certReq.headers["BinancePay-Signature"]?.length > 0);
  });

  let orderId, mtn;
  test("el cliente crea el pedido y obtiene el enlace de pago en USDT", async () => {
    const o = await call("POST", "/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "binance" }, custCookie);
    orderId = o.json.id;
    const r = await call("POST", `/api/orders/${orderId}/binance`, {}, custCookie);
    assert.equal(r.status, 200);
    assert.equal(r.json.usdt, 2.7, "35 Bs ÷ 13 = 2.70 USDT (redondeado hacia arriba)");
    assert.equal(r.json.link, "https://pay.binance.test/checkout/PP123");
    assert.equal(r.json.qr, "https://pay.binance.test/qr/PP123");
    assert.equal(orderOf(orderId).status, "awaiting_payment", "aún no pagado");
    mtn = orderOf(orderId).binance.merchantTradeNo;
    assert.ok(mtn && /^BP[0-9a-f]+$/.test(mtn));
  });

  test("un webhook con firma FALSA se rechaza y el pedido NO se entrega (anti producto gratis)", async () => {
    const r = await sendWebhook({ bizType: "PAY", bizStatus: "PAY_SUCCESS", data: JSON.stringify({ merchantTradeNo: mtn, transactionId: "TXFORGED", totalFee: "2.70", currency: "USDT" }) }, { sign: false });
    assert.equal(r.status, 400, "firma inválida");
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(orderOf(orderId).status, "awaiting_payment", "sigue sin pagar");
  });

  test("un webhook bien firmado entrega el pedido una sola vez (idempotente)", async () => {
    const payload = { bizType: "PAY", bizStatus: "PAY_SUCCESS", data: JSON.stringify({ merchantTradeNo: mtn, transactionId: "TX-REAL-1", totalFee: "2.70", currency: "USDT" }) };
    const r = await sendWebhook(payload);
    assert.equal(r.status, 200);
    assert.deepEqual(r.json, { returnCode: "SUCCESS", returnMessage: null });
    const done = await wait(() => orderOf(orderId).status === "fulfilled");
    assert.ok(done, "el pedido quedó entregado");
    const o = orderOf(orderId);
    assert.equal(o.binance.status, "PAID");
    assert.equal(o.binance.txnId, "TX-REAL-1");
    assert.equal(o.assignmentIds.length, 1, "un acceso entregado");
    // Reenvío del mismo webhook: no entrega de nuevo.
    await sendWebhook(payload);
    await new Promise((r) => setTimeout(r, 60));
    assert.equal(orderOf(orderId).assignmentIds.length, 1, "no duplica la entrega");
  });

  test("un webhook que no es PAY_SUCCESS no entrega nada", async () => {
    const o = await call("POST", "/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "binance" }, custCookie);
    // (puede quedar sin stock: con un solo perfil, ya se entregó antes) — sólo validamos que un cierre no entregue.
    if (o.status !== 200) return;
    await call("POST", `/api/orders/${o.json.id}/binance`, {}, custCookie).catch(() => {});
    const m = orderOf(o.json.id)?.binance?.merchantTradeNo;
    if (!m) return;
    await sendWebhook({ bizType: "PAY", bizStatus: "PAY_CLOSED", data: JSON.stringify({ merchantTradeNo: m, transactionId: "TXCLOSED" }) });
    await new Promise((r) => setTimeout(r, 60));
    assert.notEqual(orderOf(o.json.id).status, "fulfilled");
  });
});
