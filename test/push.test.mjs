// Avisos al celular (Web Push): firma VAPID, suscripciones, alertas nuevas y que sin claves no se rompe nada.
// No se manda nada real: el "servicio de push" es un fetch falso.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPublicKey, verify } from "node:crypto";
import { createApp } from "../dist/server/app.js";
import { generateVapidKeys, validSubscription, vapidJwt, vapidKeyObject } from "../dist/server/push.js";

const FCM = "https://fcm.googleapis.com/fcm/send/abc123";

async function boot(opts = {}) {
  const dir = mkdtempSync(join(tmpdir(), "gs-push-"));
  const sent = [];
  let status = 201;
  const fetchImpl = async (url, init) => { sent.push({ url, init }); return new Response("", { status }); };
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, fetchImpl, ...opts });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
  const ck = lr.headers.get("set-cookie").split(";")[0];
  const call = async (method, path, body) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), cookie: ck }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };
  return { app, call, sent, setStatus: (s) => (status = s), stop: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

describe("Web Push: claves y firma", () => {
  test("las claves generadas forman un par y el JWT se verifica con la pública", () => {
    const k = { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" };
    const key = vapidKeyObject(k);
    const jwt = vapidJwt(FCM, k, key, Date.UTC(2026, 10, 10));
    const [h, b, sig] = jwt.split(".");
    const body = JSON.parse(Buffer.from(b, "base64url"));
    assert.equal(body.aud, "https://fcm.googleapis.com");
    assert.equal(body.sub, "mailto:prueba@ejemplo.com");
    const pub = createPublicKey(key);
    assert.ok(verify("sha256", Buffer.from(`${h}.${b}`), { key: pub, dsaEncoding: "ieee-p1363" }, Buffer.from(sig, "base64url")));
  });

  test("claves mal pegadas o que no son par: error claro", () => {
    const a = generateVapidKeys(), b = generateVapidKeys();
    assert.throws(() => vapidKeyObject({ publicKey: a.publicKey, privateKey: b.privateKey, subject: "mailto:x@y.z" }), /no son un par/);
    assert.throws(() => vapidKeyObject({ publicKey: "corta", privateKey: a.privateKey, subject: "mailto:x@y.z" }), /PUBLIC/);
    assert.throws(() => vapidKeyObject({ ...a, subject: "yo" }), /VAPID_SUBJECT/);
  });

  test("solo se aceptan servicios de push conocidos (nada de llamar a otros sitios)", () => {
    assert.ok(validSubscription({ endpoint: FCM, keys: { p256dh: "x", auth: "y" } }));
    assert.ok(validSubscription({ endpoint: "https://web.push.apple.com/QGx" }));
    for (const ep of ["http://fcm.googleapis.com/x", "https://169.254.169.254/latest", "https://evil.com/fcm.googleapis.com", "https://fcm.googleapis.com:8443/x", "nada"])
      assert.equal(validSubscription({ endpoint: ep }), null, ep);
  });
});

describe("Web Push: servidor sin claves", () => {
  let s;
  before(async () => { s = await boot(); });
  after(() => s.stop());
  test("el panel lo muestra apagado y suscribirse avisa que falta configurar", async () => {
    const g = await s.call("GET", "/api/admin/push");
    assert.equal(g.json.configured, false);
    assert.equal(g.json.publicKey, null);
    const r = await s.call("POST", "/api/admin/push/subscribe", { subscription: { endpoint: FCM } });
    assert.equal(r.status, 409);
    await s.app.checkPushAlerts();
    assert.equal(s.sent.length, 0);
  });
});

describe("Web Push: con claves", () => {
  let s;
  const vapid = { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" };
  before(async () => { s = await boot({ vapid }); });
  after(() => s.stop());

  test("suscribir, probar (toque sin contenido y firmado) y leer el texto", async () => {
    const g = await s.call("GET", "/api/admin/push");
    assert.equal(g.json.configured, true);
    assert.equal(g.json.publicKey, vapid.publicKey);
    assert.equal((await s.call("POST", "/api/admin/push/subscribe", { subscription: { endpoint: "https://evil.com/x" } })).status, 400);
    assert.equal((await s.call("POST", "/api/admin/push/subscribe", { subscription: { endpoint: FCM, keys: { p256dh: "a", auth: "b" } }, label: "Android" })).status, 200);
    assert.equal((await s.call("GET", "/api/admin/push")).json.mine, 1);
    const t = await s.call("POST", "/api/admin/push/test", {});
    assert.deepEqual(t.json, { sent: 1, failed: 0, removed: 0 });
    const req = s.sent.at(-1);
    assert.equal(req.url, FCM);
    assert.match(req.init.headers.Authorization, new RegExp(`^vapid t=[^,]+, k=${vapid.publicKey}$`));
    assert.equal(req.init.body, undefined, "el aviso no lleva datos");
    const latest = await s.call("GET", "/api/admin/push/latest");
    assert.match(latest.json.title, /Avisos activados/);
    assert.equal((await fetch(s.app.server.address() ? `http://127.0.0.1:${s.app.server.address().port}/api/admin/push/latest` : "")).status, 401, "sin sesión no se lee");
  });

  test("avisa solo lo nuevo: pago por revisar y stock bajo", async () => {
    const st = s.app.store, sys = { id: "t", role: "owner" };
    await s.app.checkPushAlerts(); // primera pasada: toma la foto, no avisa lo viejo
    const before = s.sent.length;
    st.catalog.upsertProduct(sys, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    st.catalog.upsertSupplier(sys, { id: "andes", name: "Andes", active: true });
    st.inventory.addAccount(sys, { productId: "nf", supplierId: "andes", email: "nf1@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 30 * 864e5, cost: 1, profiles: [{ label: "P1" }] });
    await s.app.checkPushAlerts();
    assert.equal(s.sent.length, before + 1, "1 perfil libre con umbral 2 = stock bajo");
    assert.match((await s.call("GET", "/api/admin/push/latest")).json.title, /Stock bajo: Netflix \(1\)/);
    await s.app.checkPushAlerts();
    assert.equal(s.sent.length, before + 1, "no repite el mismo aviso cada minuto");
  });

  test("solo los avisos elegidos; umbral configurable", async () => {
    const r = await s.call("POST", "/api/admin/push/config", { alerts: ["payment"], lowStockAt: 0 });
    assert.deepEqual(r.json, { ok: true, alerts: ["payment"], lowStockAt: 0 });
    assert.equal((await s.call("POST", "/api/admin/push/config", { lowStockAt: 99 })).status, 400);
  });

  test("si el celular ya no existe (410), la suscripción se borra sola", async () => {
    s.setStatus(410);
    const t = await s.call("POST", "/api/admin/push/test", {});
    assert.deepEqual(t.json, { sent: 0, failed: 0, removed: 1 });
    assert.equal((await s.call("GET", "/api/admin/push")).json.total, 0);
    s.setStatus(201);
  });
});

describe("Web Push: revendedores y claves automáticas", () => {
  test("en la tienda publicada (https) se generan las claves solas y quedan guardadas", async () => {
    const s = await boot({ publicOrigin: "https://tienda.ejemplo.com" });
    try {
      const g = await s.call("GET", "/api/admin/push");
      assert.equal(g.json.configured, true);
      assert.ok(g.json.publicKey.length > 60);
    } finally { await s.stop(); }
  });

  test("el revendedor activa sus avisos: le llega lo suyo y nunca los avisos del panel", async () => {
    const vapid = { ...generateVapidKeys(), subject: "mailto:prueba@ejemplo.com" };
    const s = await boot({ vapid });
    try {
      const c = (await s.call("POST", "/api/admin/customers", { name: "Rev Uno", phone: "+59177700011", kind: "reseller" })).json;
      assert.equal((await s.call("POST", `/api/admin/customers/${c.id}/login-pin`, { pin: "4321" })).status, 200);
      const base = `http://127.0.0.1:${s.app.server.address().port}`;
      const lr = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone: "77700011", pin: "4321" }) });
      assert.equal(lr.status, 200);
      const ck = lr.headers.get("set-cookie").split(";")[0];
      const me = async (method, path, body) => { const r = await fetch(base + path, { method, headers: { ...(body ? { "content-type": "application/json" } : {}), cookie: ck }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json() }; };
      assert.equal((await me("GET", "/api/me/push")).json.configured, true);
      assert.equal((await me("POST", "/api/me/push/test", {})).status, 409, "sin suscribirse no hay a quién avisar");
      assert.equal((await me("POST", "/api/me/push/subscribe", { subscription: { endpoint: FCM + "rev", keys: { p256dh: "a", auth: "b" } } })).status, 200);
      const n = s.sent.length;
      assert.deepEqual((await me("POST", "/api/me/push/test", {})).json, { sent: 1, failed: 0 });
      assert.equal(s.sent.at(-1).url, FCM + "rev");
      assert.match((await me("GET", "/api/me/push/latest")).json.title, /Avisos activados/);
      assert.equal((await me("GET", "/api/admin/push/latest")).status, 403, "un revendedor no lee los avisos del panel");
      // Los avisos del panel van solo a los celulares del equipo
      assert.equal((await s.call("GET", "/api/admin/push")).json.total, 0);
      await s.app.checkPushAlerts(); await s.app.checkPushAlerts();
      assert.equal(s.sent.length, n + 1);
    } finally { await s.stop(); }
  });
});
