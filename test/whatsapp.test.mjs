// Bot de WhatsApp con la API oficial de Meta SIMULADA: firma real del webhook, envíos capturados.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHmac } from "node:crypto";
import { createApp } from "../dist/server/app.js";

const APP_SECRET = "0123456789abcdef0123456789abcdef";
const TOKEN = "EAAG-token-de-prueba-1234567890";
const ORIGIN = "https://gabostore.lat";

describe("bot de WhatsApp (Meta simulado)", () => {
  let dir, app, base, owner, sent, metaFails, clock;
  const wait = async (fn, ms = 2000) => { const t0 = Date.now(); while (Date.now() - t0 < ms) { if (fn()) return true; await new Promise((r) => setTimeout(r, 15)); } return false; };

  const call = async (method, path, body, cookie, headers = {}) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}), ...headers }, body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body) });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json, headers: r.headers };
  };
  let wamid = 0;
  /** Lo que mandaría Meta cuando un cliente escribe. */
  const inbound = async (from, text, { sign = true, id } = {}) => {
    const payload = JSON.stringify({ object: "whatsapp_business_account", entry: [{ id: "WABA", changes: [{ field: "messages", value: {
      messaging_product: "whatsapp", metadata: { phone_number_id: "123456789" }, contacts: [{ wa_id: from, profile: { name: "Cliente WA" } }],
      messages: [{ from, id: id ?? `wamid.IN${++wamid}`, timestamp: String(Math.floor(clock.now() / 1000)), type: "text", text: { body: text } }] } }] }] });
    const sig = "sha256=" + createHmac("sha256", APP_SECRET).update(payload).digest("hex");
    return call("POST", "/api/whatsapp/webhook", payload, undefined, sign ? { "x-hub-signature-256": sig } : {});
  };
  const relogin = async () => {
    const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    owner = r.headers.get("set-cookie").split(";")[0];
  };
  const texts = () => sent.filter((x) => x.body.type === "text").map((x) => x.body.text.body);

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-wa-"));
    sent = []; metaFails = null;
    clock = { t: Date.now(), now() { return this.t; } };
    const fakeFetch = async (url, init) => {
      const body = JSON.parse(init.body);
      sent.push({ url, auth: init.headers.Authorization, body });
      if (metaFails) return new Response(JSON.stringify({ error: metaFails }), { status: 400, headers: { "content-type": "application/json" } });
      return new Response(JSON.stringify({ messages: [{ id: `wamid.OUT${sent.length}` }] }), { status: 200, headers: { "content-type": "application/json" } });
    };
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, publicOrigin: ORIGIN, clock, fetchImpl: fakeFetch, metaBaseUrl: "https://meta.test" });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    owner = r.headers.get("set-cookie").split(";")[0];
    // Datos mínimos de la tienda.
    await call("POST", "/api/admin/products", { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true }, owner);
    await call("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, owner);
    await call("POST", "/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf@x.lat", password: "Secreta#99", supplierExpiresAt: clock.now() + 90 * 864e5, cost: 0, profiles: [{ label: "Perfil 1", pin: "4321" }, { label: "Perfil 2" }] }, owner);
    const maria = await call("POST", "/api/admin/customers", { name: "María Quispe", phone: "+591 70011223", whatsappConsent: true }, owner);
    await call("POST", "/api/admin/orders", { customerId: maria.json.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" }, owner);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("configuración: solo el dueño; las claves nunca vuelven completas", async () => {
    assert.equal((await call("POST", "/api/admin/whatsapp/config", { enabled: true }, owner)).status, 400, "sin Phone number ID no se enciende");
    assert.equal((await call("POST", "/api/admin/whatsapp/secrets", { appSecret: "corto" }, owner)).status, 400);
    assert.equal((await call("POST", "/api/admin/whatsapp/secrets", { accessToken: TOKEN, appSecret: APP_SECRET }, owner)).status, 200);
    assert.equal((await call("POST", "/api/admin/whatsapp/config", { enabled: true, phoneNumberId: "123456789" }, owner)).status, 200);
    const cfg = (await call("GET", "/api/admin/whatsapp/config", undefined, owner)).json;
    assert.equal(cfg.secrets.token, "••••7890");
    assert.equal(cfg.webhookUrl, `${ORIGIN}/api/whatsapp/webhook`);
    assert.ok(cfg.ready.token && cfg.ready.appSecret && cfg.ready.https);
    assert.ok(cfg.templates.find((t) => t.id === "order_confirmed").body.includes("{{1}}"));
    const dump = JSON.stringify(app.store.snapshot()) + JSON.stringify(app.store.stats.audit({ id: "x", role: "owner" }));
    assert.ok(!dump.includes(TOKEN) && !dump.includes(APP_SECRET), "las claves no quedan en el estado ni en la auditoría");
  });

  test("verificación del webhook (GET de Meta)", async () => {
    const vt = (await call("GET", "/api/admin/whatsapp/config", undefined, owner)).json.verifyToken;
    const ok = await call("GET", `/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=${vt}&hub.challenge=987654`);
    assert.equal(ok.status, 200);
    assert.equal(ok.json, 987654);
    assert.equal((await call("GET", "/api/whatsapp/webhook?hub.mode=subscribe&hub.verify_token=malo&hub.challenge=1")).status, 403);
  });

  test("un webhook sin firma o con firma falsa se rechaza", async () => {
    assert.equal((await inbound("59170011223", "hola", { sign: false })).status, 403);
    const r = await call("POST", "/api/whatsapp/webhook", JSON.stringify({ object: "whatsapp_business_account", entry: [] }), undefined, { "x-hub-signature-256": "sha256=" + "0".repeat(64) });
    assert.equal(r.status, 403);
  });

  test("el bot saluda con el menú y usa la API oficial con el token", async () => {
    sent.length = 0;
    assert.equal((await inbound("59170011223", "Hola!")).status, 200);
    assert.ok(await wait(() => texts().length >= 1));
    const reply = sent.find((x) => x.body.type === "text");
    assert.equal(reply.url, "https://meta.test/v21.0/123456789/messages");
    assert.equal(reply.auth, `Bearer ${TOKEN}`);
    assert.equal(reply.body.to, "59170011223");
    assert.match(reply.body.text.body, /María/);
    assert.match(reply.body.text.body, /1️⃣ Mis servicios/);
    assert.ok(sent.some((x) => x.body.status === "read"), "marca como leído");
  });

  test("'1' lista servicios con vencimiento y link, SIN contraseña ni PIN", async () => {
    sent.length = 0;
    await inbound("59170011223", "1");
    assert.ok(await wait(() => texts().length >= 1));
    const t = texts()[0];
    assert.match(t, /Netflix \(Perfil 1\): vence/);
    assert.match(t, /https:\/\/gabostore\.lat\/#acceso=/);
    assert.ok(!t.includes("Secreta#99") && !t.includes("4321"));
  });

  test("'4' manda un link de acceso que sirve para entrar una sola vez", async () => {
    sent.length = 0;
    await inbound("59170011223", "entrar");
    assert.ok(await wait(() => texts().length >= 1));
    const token = texts()[0].match(/#acceso=([\w-]+)/)[1];
    assert.equal((await call("POST", "/api/auth/customer/link", { token })).status, 200);
    assert.equal((await call("POST", "/api/auth/customer/link", { token })).status, 401);
  });

  test("número desconocido: precios y tienda, sin datos de nadie", async () => {
    sent.length = 0;
    await inbound("59179999999", "cuánto cuesta?");
    assert.ok(await wait(() => texts().length >= 1));
    assert.match(texts()[0], /Netflix: \*Bs 35\*/);
    sent.length = 0;
    await inbound("59179999999", "1");
    assert.ok(await wait(() => texts().length >= 1));
    assert.match(texts()[0], /Todavía no tengo compras a tu número/);
  });

  test("mensajes repetidos por Meta no se contestan dos veces", async () => {
    sent.length = 0;
    await inbound("59170011223", "6", { id: "wamid.REPETIDO" });
    await inbound("59170011223", "6", { id: "wamid.REPETIDO" });
    await wait(() => texts().length >= 2, 400);
    assert.equal(texts().length, 1);
    assert.match(texts()[0], /Tu saldo es \*Bs 0\*/);
  });

  test("'0' pasa a una persona: el bot se calla y el chat queda marcado; el staff responde", async () => {
    sent.length = 0;
    await inbound("59170011223", "quiero hablar con una persona");
    assert.ok(await wait(() => texts().length >= 1));
    sent.length = 0;
    await inbound("59170011223", "hola?");
    await wait(() => texts().length >= 1, 300);
    assert.equal(texts().length, 0, "el bot no contesta mientras atiende una persona");
    const chats = (await call("GET", "/api/admin/whatsapp/chats", undefined, owner)).json;
    const c = chats.find((x) => x.phone === "+59170011223");
    assert.ok(c.needsHuman && c.botPaused && c.inWindow);
    const r = await call("POST", `/api/admin/whatsapp/chats/${encodeURIComponent("+59170011223")}/reply`, { text: "Hola María, te ayudo yo." }, owner);
    assert.equal(r.status, 200);
    assert.equal(texts()[0], "Hola María, te ayudo yo.");
    const thread = (await call("GET", `/api/admin/whatsapp/chats/${encodeURIComponent("+59170011223")}`, undefined, owner)).json;
    assert.equal(thread.messages.at(-1).by, "staff");
    await call("POST", `/api/admin/whatsapp/chats/${encodeURIComponent("+59170011223")}/human`, { on: false }, owner);
  });

  test("pasadas 24 h no se puede escribir texto libre", async () => {
    clock.t += 25 * 3600_000;
    await relogin(); // la sesión del staff dura 12 h
    const r = await call("POST", `/api/admin/whatsapp/chats/${encodeURIComponent("+59170011223")}/reply`, { text: "¿Seguís ahí?" }, owner);
    assert.equal(r.status, 409);
    assert.match(r.json.message, /plantilla aprobada/);
  });

  test("avisos: sin plantilla fuera de 24 h quedan fallidos con explicación; con plantilla salen", async () => {
    sent.length = 0;
    const res1 = await app.flushWhatsApp();
    assert.ok(res1.failed >= 1);
    const failed = (await call("GET", "/api/admin/outbox", undefined, owner)).json.find((m) => m.status === "failed");
    assert.match(failed.error, /Sin plantilla aprobada/);
    // Se carga la plantilla aprobada y se genera otro aviso.
    await call("POST", "/api/admin/whatsapp/config", { templates: { expiry_reminder: { name: "recordatorio_vencimiento", lang: "es" } } }, owner);
    clock.t += 28 * 864e5;
    await relogin();
    await call("POST", "/api/admin/reminders", { withinDays: 3 }, owner);
    const res2 = await app.flushWhatsApp();
    assert.equal(res2.sent, 1);
    const tpl = sent.find((x) => x.body.type === "template");
    assert.equal(tpl.body.template.name, "recordatorio_vencimiento");
    assert.deepEqual(tpl.body.template.components[0].parameters.map((p) => p.text).slice(0, 2), ["María Quispe", "Netflix"]);
  });

  test("errores de Meta: token vencido se explica y no se reintenta", async () => {
    metaFails = { message: "Error validating access token", code: 190 };
    await call("POST", "/api/admin/reminders", { withinDays: 3 }, owner); // ya se mandó hoy: no encola
    clock.t += 864e5;
    await relogin();
    await call("POST", "/api/admin/reminders", { withinDays: 3 }, owner);
    const r = await app.flushWhatsApp();
    assert.equal(r.failed, 1);
    const m = (await call("GET", "/api/admin/outbox", undefined, owner)).json.find((x) => x.status === "failed" && /token/.test(x.error));
    assert.match(m.error, /token de acceso venció/);
    metaFails = null;
  });

  test("BAJA y ALTA cambian el permiso de avisos", async () => {
    clock.t += 1000;
    await inbound("59170011223", "BAJA");
    assert.ok(await wait(() => app.store.engine.s.customers[Object.keys(app.store.engine.s.customers)[0]].whatsappConsent === false));
    await inbound("59170011223", "alta");
    assert.ok(await wait(() => app.store.engine.s.customers[Object.keys(app.store.engine.s.customers)[0]].whatsappConsent === true));
  });

  test("código de acceso del cliente por la plantilla de autenticación", async () => {
    assert.equal((await call("POST", "/api/auth/customer/request-code", { phone: "+59170011223" })).status, 503, "sin plantilla login_code está apagado");
    await call("POST", "/api/admin/whatsapp/config", { templates: { expiry_reminder: { name: "recordatorio_vencimiento", lang: "es" }, login_code: { name: "codigo_acceso", lang: "es" } } }, owner);
    sent.length = 0;
    assert.equal((await call("POST", "/api/auth/customer/request-code", { phone: "+59170011223" })).json.sent, true);
    const t = sent.find((x) => x.body.type === "template");
    assert.equal(t.body.template.name, "codigo_acceso");
    const code = t.body.template.components[0].parameters[0].text;
    assert.match(code, /^\d{6}$/);
    assert.equal(t.body.template.components[1].parameters[0].text, code, "el botón 'Copiar código' lleva el mismo código");
    assert.equal((await call("POST", "/api/auth/customer/verify", { phone: "+59170011223", code })).status, 200);
  });

  test("con el bot apagado los mensajes se guardan pero no se contestan", async () => {
    await call("POST", "/api/admin/whatsapp/config", { enabled: false }, owner);
    sent.length = 0;
    await inbound("59170011223", "hola");
    await wait(() => sent.length > 0, 300);
    assert.equal(sent.length, 0);
    const thread = (await call("GET", `/api/admin/whatsapp/chats/${encodeURIComponent("+59170011223")}`, undefined, owner)).json;
    assert.equal(thread.messages.at(-1).text, "hola");
  });
});
