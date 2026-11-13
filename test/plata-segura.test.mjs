// Premium 2.0 · etapa 1 "Plata segura" (12/11/2026). Datos ficticios; nada real.
//  1. Un comprobante repetido (misma imagen que otro pedido vivo) NO se aprueba; solo el dueño, diciendo por qué, y queda auditado.
//  2. Las referencias bancarias se comparan sin espacios, guiones, puntos, mayúsculas ni ceros a la izquierda.
//  3. Al subir un comprobante con un número de operación que ya figura en otro pedido, queda marcado.
//  4. Recargas: al aprobar, el dueño pone el monto que de verdad llegó; se acredita ese y queda auditado.
//  5. Recargas: la misma llave de idempotencia no crea dos; y no se aceptan más de 3 en revisión por cliente.
//  6. El consentimiento de WhatsApp guarda cuándo y por dónde llegó (registro, cliente, WhatsApp, panel, revendedor).
//  7. Un aviso "sin permiso" no se marca como enviado a mano, salvo el dueño con motivo (auditado).
//  8. Binance: si el webhook confirma un pago pero la entrega falla, queda en una bandeja del dueño para reintentar.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { generateKeyPairSync, createSign } from "node:crypto";
import { createStore, DomainError, DAY } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

const T0 = Date.UTC(2026, 10, 12, 15, 0, 0);
const owner = { id: "u_owner", role: "owner" }, admin = { id: "u_admin", role: "admin" }, seller = { id: "u_seller", role: "seller" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const as = (c) => ({ id: "u_" + c.id, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id });

function setup() {
  const clock = { t: T0, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(admin, { productId: "netflix", supplierId: "andes", email: "nf01@x.lat", password: "Clave-Larga#1", supplierExpiresAt: T0 + 90 * DAY, cost: 2000, profiles: [1, 2, 3, 4].map((i) => ({ label: `P${i}` })) });
  const maria = s.catalog.createCustomer(seller, { name: "María Quispe", phone: "+591 70011223", whatsappConsent: true });
  const luis = s.catalog.createCustomer(seller, { name: "Luis Choque", phone: "+591 78889900" });
  const buy = (c) => s.orders.create(as(c), { customerId: c.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" });
  return { s, clock, maria, luis, buy, audit: (action) => s.engine.s.audit.filter((a) => a.action === action) };
}

describe("etapa 1 · plata segura (núcleo)", () => {
  test("comprobante repetido: no se aprueba; el dueño sí, con motivo, y queda auditado; si el otro pedido se rechazó, se aprueba normal", () => {
    const { s, maria, luis, buy, audit } = setup();
    const a = buy(maria), b = buy(luis);
    s.orders.submitEvidence(as(maria), a.id, { fileRef: "up/1.jpg", declaredReference: "DEP-1", hash: "h-misma-foto" });
    s.orders.submitEvidence(as(luis), b.id, { fileRef: "up/2.jpg", declaredReference: "DEP-2", hash: "h-misma-foto" });
    assert.equal(s.admin.orders(owner).find((o) => o.id === b.id).evidence.duplicateOf, a.id, "el segundo queda marcado");
    s.orders.approvePayment(admin, a.id, { confirmedReference: "BNB-1" });
    assert.throws(() => s.orders.approvePayment(admin, b.id, { confirmedReference: "BNB-2" }), err("DUPLICATE_EVIDENCE"), "repetido: no se aprueba");
    assert.throws(() => s.orders.approvePayment(admin, b.id, { confirmedReference: "BNB-2", force: true, forceReason: "un comprobante por los dos pedidos" }), err("FORBIDDEN"), "un admin no puede forzar");
    assert.throws(() => s.orders.approvePayment(owner, b.id, { confirmedReference: "BNB-2", force: true, forceReason: "" }), err("VALIDATION"), "el dueño tiene que decir por qué");
    const ok = s.orders.approvePayment(owner, b.id, { confirmedReference: "BNB-2", force: true, forceReason: "pagó los dos pedidos juntos (Bs 70)" });
    assert.equal(ok.status, "fulfilled");
    assert.equal(audit("payment.approve_forced").length, 1);
    assert.match(audit("payment.approve_forced")[0].data.reason, /pagó los dos/);
    // Si el pedido original se rechazó, la misma foto en un pedido nuevo es un reintento legítimo: se aprueba sin forzar.
    const c = buy(luis), d = buy(maria);
    s.orders.submitEvidence(as(luis), c.id, { fileRef: "up/3.jpg", declaredReference: "DEP-3", hash: "h-otra" });
    s.orders.rejectPayment(admin, c.id, "borrosa");
    s.orders.submitEvidence(as(maria), d.id, { fileRef: "up/4.jpg", declaredReference: "DEP-4", hash: "h-otra" });
    assert.equal(s.orders.approvePayment(admin, d.id, { confirmedReference: "BNB-4" }).status, "fulfilled");
  });

  test("referencias: '0012-345', ' 12 345 ' y '12.345' son el mismo pago; binance:<txn> sigue siendo única", () => {
    const { s, maria, luis, buy } = setup();
    const a = buy(maria), b = buy(luis);
    s.orders.approvePayment(admin, a.id, { confirmedReference: "0012-345" });
    assert.throws(() => s.orders.approvePayment(admin, b.id, { confirmedReference: " 12 345 " }), err("ALREADY_PROCESSED"));
    assert.throws(() => s.orders.approvePayment(admin, b.id, { confirmedReference: "12.345" }), err("ALREADY_PROCESSED"));
    assert.equal(s.orders.approvePayment(admin, b.id, { confirmedReference: "12346" }).status, "fulfilled", "otra referencia sí");
    assert.equal(s.admin.orders(owner).find((o) => o.id === a.id).confirmedReference, "0012-345", "se guarda como la escribieron");
  });

  test("número de operación ya visto en otro pedido: el comprobante queda marcado (aviso, no bloqueo)", () => {
    const { s, maria, luis, buy, audit } = setup();
    const a = buy(maria), b = buy(luis);
    s.orders.submitEvidence(as(maria), a.id, { fileRef: "up/1.jpg", declaredReference: "OP 7788", hash: "h1" });
    s.orders.submitEvidence(as(luis), b.id, { fileRef: "up/2.jpg", declaredReference: "op-7788", hash: "h2" });
    const ob = s.admin.orders(owner).find((o) => o.id === b.id);
    assert.equal(ob.evidence.referenceSeenIn, a.id);
    assert.equal(ob.evidence.duplicateOf, undefined, "la foto es distinta: no es duplicado");
    assert.equal(audit("order.evidence_reference_seen").length, 1);
    assert.equal(s.orders.approvePayment(admin, b.id, { confirmedReference: "7788" }).status, "fulfilled", "se puede aprobar igual: el dueño decide");
  });

  test("recarga: el dueño corrige el monto al aprobar; se acredita lo verificado y queda auditado", () => {
    const { s, maria, audit } = setup();
    const t = s.orders.requestTopup(as(maria), maria.id, 10000, { fileRef: "up/r.jpg", declaredReference: "DEP-9" });
    assert.throws(() => s.orders.approvePayment(admin, t.id, { confirmedReference: "BNB-9", verifiedAmount: 500 }), err("VALIDATION"), "menos de Bs 10 no");
    s.orders.approvePayment(admin, t.id, { confirmedReference: "BNB-9", verifiedAmount: 8000 });
    assert.equal(s.wallet.balance(maria.id), 8000, "se acreditan los Bs 80 que llegaron, no los 100 declarados");
    assert.deepEqual(audit("payment.amount_corrected")[0].data, { from: 10000, to: 8000 });
    const o = s.admin.orders(owner).find((x) => x.id === t.id);
    assert.equal(o.total, 8000); assert.equal(o.topupAmount, 8000);
    // Sin corrección, se acredita lo declarado como siempre.
    const t2 = s.orders.requestTopup(as(maria), maria.id, 2000, { fileRef: "up/r2.jpg", declaredReference: "DEP-10" });
    s.orders.approvePayment(admin, t2.id, { confirmedReference: "BNB-10", verifiedAmount: 2000 });
    assert.equal(s.wallet.balance(maria.id), 10000);
    assert.equal(audit("payment.amount_corrected").length, 1, "igual monto: no se audita corrección");
  });

  test("recarga: la misma llave no crea dos; más de 3 en revisión no se aceptan", () => {
    const { s, maria } = setup();
    const ev = (n) => ({ fileRef: `up/${n}.jpg`, declaredReference: `DEP-${n}` });
    const a = s.orders.requestTopup(as(maria), maria.id, 2000, ev(1), "qr", undefined, "llave-1");
    const b = s.orders.requestTopup(as(maria), maria.id, 2000, ev(1), "qr", undefined, "llave-1");
    assert.equal(a.id, b.id, "doble envío: la misma recarga");
    s.orders.requestTopup(as(maria), maria.id, 2000, ev(2), "qr", undefined, "llave-2");
    s.orders.requestTopup(as(maria), maria.id, 2000, ev(3), "qr", undefined, "llave-3");
    assert.throws(() => s.orders.requestTopup(as(maria), maria.id, 2000, ev(4), "qr", undefined, "llave-4"), err("VALIDATION"), "4ª en revisión: no");
    assert.equal(s.admin.orders(owner).filter((o) => o.kind === "topup" && o.customerId === maria.id).length, 3);
    s.orders.approvePayment(admin, a.id, { confirmedReference: "BNB-1" });
    assert.ok(s.orders.requestTopup(as(maria), maria.id, 2000, ev(5), "qr", undefined, "llave-5"), "aprobada una, entra otra");
  });

  test("consentimiento con fecha y origen: registro, cliente, WhatsApp, panel y revendedor", () => {
    const { s, maria, luis, clock } = setup();
    const c = (id) => s.engine.s.customers[id];
    assert.equal(c(maria.id).whatsappConsent, true);
    assert.equal(c(maria.id).whatsappConsentVia, "panel", "la creó el vendedor con permiso: origen panel");
    assert.equal(c(maria.id).whatsappConsentAt, T0);
    assert.equal(c(luis.id).whatsappConsentVia, undefined, "sin permiso: sin origen");
    clock.t = T0 + DAY;
    s.catalog.setWhatsappConsent(as(luis), luis.id, true);
    assert.deepEqual([c(luis.id).whatsappConsent, c(luis.id).whatsappConsentVia, c(luis.id).whatsappConsentAt], [true, "cliente", T0 + DAY]);
    clock.t = T0 + 2 * DAY;
    s.catalog.setWhatsappConsent({ id: `wa:${luis.id}`, role: "customer", customerId: luis.id }, luis.id, false);
    assert.deepEqual([c(luis.id).whatsappConsent, c(luis.id).whatsappConsentVia, c(luis.id).whatsappConsentAt], [false, "whatsapp", T0 + 2 * DAY], "BAJA por WhatsApp");
    s.catalog.setWhatsappConsent(admin, luis.id, true, "panel");
    assert.equal(c(luis.id).whatsappConsentVia, "panel");
    const reg = s.catalog.selfRegister({ name: "Nueva Cliente", phone: "+591 71112233", whatsappConsent: true });
    assert.equal(c(reg.id).whatsappConsentVia, "registro");
    const rev = s.catalog.createCustomer(admin, { name: "Rosa Rev", phone: "+591 72223344", kind: "reseller" });
    const suyo = s.catalog.createCustomer(as(rev), { name: "Cliente de Rosa", phone: "+591 73334455", whatsappConsent: true });
    assert.equal(c(suyo.id).whatsappConsentVia, "revendedor");
    const vias = s.engine.s.audit.filter((a) => a.action === "consent.granted" || a.action === "consent.revoked").map((a) => [a.action, a.data.via]);
    assert.deepEqual(vias, [["consent.granted", "cliente"], ["consent.revoked", "whatsapp"], ["consent.granted", "panel"]], "la auditoría dice por dónde llegó cada cambio");
  });

  test("aviso sin permiso del cliente: no se marca enviado a mano; el dueño sí, con motivo, y queda auditado", () => {
    const { s, luis, buy } = setup();
    const o = buy(luis);
    s.orders.approvePayment(admin, o.id, { confirmedReference: "BNB-77" }); // dispara el aviso de entrega
    const m = s.notify.outbox(owner).find((x) => x.customerId === luis.id && x.status === "skipped_no_consent");
    assert.ok(m, "Luis no dio permiso: el aviso queda 'sin permiso'");
    assert.throws(() => s.notify.markSentManually(admin, m.id), err("NO_CONSENT"));
    assert.throws(() => s.notify.markSentManually(admin, m.id, { force: true, reason: "me lo pidió" }), err("FORBIDDEN"), "un admin no puede forzar");
    assert.throws(() => s.notify.markSentManually(owner, m.id, { force: true, reason: "" }), err("NO_CONSENT"), "sin motivo no");
    assert.equal(s.notify.markSentManually(owner, m.id, { force: true, reason: "me lo pidió por WhatsApp" }).status, "sent_manually");
    assert.equal(s.engine.s.audit.filter((a) => a.action === "outbox.sent_without_consent").length, 1);
  });
});

describe("etapa 1 · plata segura (servidor)", () => {
  let dir, app, base, owner, orderId, mtn;
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const ORIGIN = "https://tienda.test";
  const call = async (m, p, body, ck, headers = {}) => {
    const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };
  before(async () => {
    // Binance simulado: devuelve el certificado (nuestra pública) y crea órdenes de pago.
    const fakeBinance = async (url, init) => {
      const u = String(url);
      if (u.endsWith("/certificates")) return new Response(JSON.stringify({ status: "SUCCESS", data: [{ certSerial: "1", certPublic: publicKey.export({ type: "spki", format: "pem" }) }] }), { status: 200 });
      if (u.endsWith("/order")) { const b = JSON.parse(init.body); return new Response(JSON.stringify({ status: "SUCCESS", data: { prepayId: "pp1", checkoutUrl: "https://pay.test/x", qrcodeLink: "https://pay.test/qr.png", merchantTradeNo: b.merchantTradeNo } }), { status: 200 }); }
      return new Response(JSON.stringify({ status: "FAIL" }), { status: 500 });
    };
    dir = mkdtempSync(join(tmpdir(), "gs-plata-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, publicOrigin: ORIGIN, fetchImpl: fakeBinance, binanceBaseUrl: "https://binance.test" });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    await call("POST", "/api/admin/products", { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true }, owner);
    await call("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, owner);
    await call("POST", "/api/admin/accounts", { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [{ label: "P1" }] }, owner);
    await call("POST", "/api/admin/usdt", { enabled: true, rate: 10, address: "TX1", network: "TRC20" }, owner);
    await call("POST", "/api/admin/binance", { enabled: true, apiKey: "k".repeat(32), apiSecret: "s".repeat(32), rate: 10 }, owner);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("Binance: pago confirmado que no se pudo entregar queda en la bandeja; el dueño reintenta cuando hay stock", async () => {
    const ana = (await call("POST", "/api/admin/customers", { name: "Ana", phone: "+59170011223" }, owner)).json;
    const link = (await call("POST", `/api/admin/customers/${ana.id}/login-link`, {}, owner)).json.url;
    const ck = (await fetch(base + "/api/auth/customer/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: link.split("#acceso=")[1] }) })).headers.get("set-cookie").split(";")[0];
    const o = (await call("POST", "/api/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "binance", idempotencyKey: "b1" }, ck)).json;
    orderId = o.id;
    const bp = (await call("POST", `/api/orders/${o.id}/binance`, {}, ck)).json;
    mtn = bp.merchantTradeNo ?? (await call("GET", "/api/admin/orders", undefined, owner)).json.find((x) => x.id === o.id).binance.merchantTradeNo;
    // El único perfil se retira: la entrega va a fallar aunque Binance diga que cobró.
    const acc = (await call("GET", "/api/admin/accounts", undefined, owner)).json[0];
    const slotId = acc.slots[0].id;
    // Como cuando la reserva vence y el perfil se retira antes de que llegue el pago: el pedido ya no tiene perfil.
    app.store.engine.tx(() => { const s = app.store.engine.s.slots[slotId]; s.status = "retired"; delete s.reservedByOrder; delete s.reservedUntil; });
    const sendWebhook = async (payloadObj) => {
      const bodyStr = JSON.stringify(payloadObj), ts = String(Date.now()), nonce = "n".repeat(32);
      const signature = createSign("RSA-SHA256").update(`${ts}\n${nonce}\n${bodyStr}\n`).end().sign(privateKey).toString("base64");
      return call("POST", "/api/binance/webhook", bodyStr, undefined, { "binancepay-timestamp": ts, "binancepay-nonce": nonce, "binancepay-signature": signature });
    };
    const w = await sendWebhook({ bizType: "PAY", bizStatus: "PAY_SUCCESS", data: JSON.stringify({ merchantTradeNo: mtn, transactionId: "TX-OK-1", totalFee: "3.50", currency: "USDT" }) });
    assert.equal(w.status, 200);
    await new Promise((r) => setTimeout(r, 150));
    assert.equal((await call("GET", "/api/admin/orders", undefined, owner)).json.find((x) => x.id === orderId).status, "awaiting_payment", "no se entregó (sin stock)");
    const tray = (await call("GET", "/api/admin/binance/failed", undefined, owner)).json;
    assert.equal(tray.length, 1, "queda en la bandeja");
    assert.equal(tray[0].orderId, orderId); assert.equal(tray[0].txnId, "TX-OK-1"); assert.match(tray[0].error, /stock|cuenta|perfil|reservar|a pedido/i);
    // Llega stock: el dueño reintenta y se entrega con la misma transacción.
    await call("POST", "/api/admin/accounts", { productId: "nf", supplierId: "andes", email: "nf2@x.lat", password: "Clave-Larga#2", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [{ label: "P1" }] }, owner);
    const r = await call("POST", "/api/admin/binance/failed/retry", { merchantTradeNo: mtn }, owner);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.status, "fulfilled");
    assert.equal(r.json.assignmentIds.length, 1);
    assert.deepEqual((await call("GET", "/api/admin/binance/failed", undefined, owner)).json, [], "sale de la bandeja");
  });

  test("por la API: aprobar con comprobante repetido exige force + motivo; recarga con llave de idempotencia", async () => {
    const beto = (await call("POST", "/api/admin/customers", { name: "Beto", phone: "+59170011299" }, owner)).json;
    const link = (await call("POST", `/api/admin/customers/${beto.id}/login-link`, {}, owner)).json.url;
    const ck = (await fetch(base + "/api/auth/customer/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: link.split("#acceso=")[1] }) })).headers.get("set-cookie").split(";")[0];
    const png = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
    const t1 = await call("POST", "/api/me/topups", { amount: 2000, contentBase64: png, declaredReference: "OP-1", method: "qr", idempotencyKey: "misma" }, ck);
    const t2 = await call("POST", "/api/me/topups", { amount: 2000, contentBase64: png, declaredReference: "OP-1", method: "qr", idempotencyKey: "misma" }, ck);
    assert.equal(t1.status, 200, JSON.stringify(t1.json)); assert.equal(t1.json.id, t2.json.id, "doble envío = una sola recarga");
    const t3 = await call("POST", "/api/me/topups", { amount: 2000, contentBase64: png, declaredReference: "OP-2", method: "qr", idempotencyKey: "otra" }, ck);
    assert.equal(t3.json.evidence.duplicateOf, t1.json.id, "misma imagen: marcada como repetida");
    const no = await call("POST", `/api/admin/orders/${t3.json.id}/approve`, { confirmedReference: "R-2", idempotencyKey: "a1" }, owner);
    assert.equal(no.status, 409); assert.equal(no.json.error, "DUPLICATE_EVIDENCE");
    const si = await call("POST", `/api/admin/orders/${t3.json.id}/approve`, { confirmedReference: "R-2", idempotencyKey: "a2", force: true, forceReason: "misma captura, dos transferencias", verifiedAmount: 1500 }, owner);
    assert.equal(si.status, 200, JSON.stringify(si.json));
    assert.equal(si.json.topupAmount, 1500, "monto verificado aplicado");
  });
});
