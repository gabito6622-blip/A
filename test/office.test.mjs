// Oficina final: comprobantes repetidos, vigilante de cuentas, WhatsApp con acciones del sistema,
// asistente del dueño y el banco de pruebas. Meta y Claude son FALSOS: no sale ningún mensaje real.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { run as runBank } from "../scripts/evaluar-agentes.mjs";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
const PNG2 = Buffer.from("89504e470d0a1a0a0000000d4948445200000002000000020806000000", "hex").toString("base64");

describe("oficina final", () => {
  let dir, app, base, owner, maria, mariaCk, luisCk, meta, claudeOut, claudeCalls;
  const call = async (method, path, body, ck = owner) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(ck ? { cookie: ck } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };
  const linkLogin = async (id) => {
    const url = (await call("POST", `/api/admin/customers/${id}/login-link`, {})).json.url;
    const r = await fetch(base + "/api/auth/customer/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: url.split("#acceso=")[1] }) });
    return r.headers.get("set-cookie").split(";")[0];
  };
  before(async () => {
    meta = []; claudeCalls = []; claudeOut = () => ({});
    const metaFetch = async (url, init) => { meta.push({ url: String(url), body: JSON.parse(init.body) }); return new Response(JSON.stringify({ messages: [{ id: `wamid.${meta.length}` }] }), { status: 200, headers: { "content-type": "application/json" } }); };
    const claudeFetch = async (_u, init) => {
      const body = JSON.parse(init.body); claudeCalls.push(body);
      return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(claudeOut(body)) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    dir = mkdtempSync(join(tmpdir(), "gs-office-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, publicOrigin: "https://tienda.test", fetchImpl: metaFetch, metaBaseUrl: "https://meta.test", anthropicApiKey: "sk-ant-prueba", anthropicFetch: claudeFetch });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    owner = lr.headers.get("set-cookie").split(";")[0];
    await call("POST", "/api/admin/products", { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    await call("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true });
    await call("POST", "/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf@x.lat", password: "Secreta#99", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 3000, profiles: [{ label: "P1" }, { label: "P2" }, { label: "P3" }, { label: "P4" }] });
    maria = (await call("POST", "/api/admin/customers", { name: "María Quispe", phone: "+591 70011223", whatsappConsent: true })).json;
    const luis = (await call("POST", "/api/admin/customers", { name: "Luis", phone: "+591 78889900" })).json;
    await call("POST", "/api/admin/orders", { customerId: maria.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    mariaCk = await linkLogin(maria.id); luisCk = await linkLogin(luis.id);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("el mismo comprobante en otro pedido queda marcado (sin IA)", async () => {
    const o1 = (await call("POST", "/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" }, mariaCk)).json;
    await call("POST", `/api/orders/${o1.id}/evidence`, { contentBase64: PNG, declaredReference: "111" }, mariaCk);
    const o2 = (await call("POST", "/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" }, luisCk)).json;
    await call("POST", `/api/orders/${o2.id}/evidence`, { contentBase64: PNG, declaredReference: "222" }, luisCk);
    const o3 = (await call("POST", "/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" }, luisCk)).json;
    await call("POST", `/api/orders/${o3.id}/evidence`, { contentBase64: PNG2, declaredReference: "333" }, luisCk);
    const list = (await call("GET", "/api/admin/orders?status=payment_review")).json;
    assert.equal(list.find((o) => o.id === o2.id).evidence.duplicateOf, o1.id);
    assert.equal(list.find((o) => o.id === o1.id).evidence.duplicateOf, undefined, "el primero no es repetido");
    assert.equal(list.find((o) => o.id === o3.id).evidence.duplicateOf, undefined, "otra foto, no repetido");
    const feed = (await call("GET", "/api/admin/notifications")).json;
    assert.ok(JSON.stringify(feed).includes("comprobante repetido"));
  });

  test("vigilante: avisa riesgos de cuentas cargadas, ignora códigos y correos ajenos", async () => {
    const at = Date.now();
    app.watchMail({ to: "nf@x.lat", from: "Netflix <info@account.netflix.com>", subject: "Se cambió la contraseña de tu cuenta", body: "Te confirmamos que se cambió la contraseña.", at });
    app.watchMail({ to: "nf@x.lat", from: "Netflix <info@account.netflix.com>", subject: "Se cambió la contraseña de tu cuenta", body: "Te confirmamos que se cambió la contraseña.", at: at + 60_000 });
    app.watchMail({ to: "nf@x.lat", from: "Netflix", subject: "Tu código de inicio de sesión", body: "Ingresa este código: 4821", at });
    app.watchMail({ to: "otra@x.lat", from: "Netflix", subject: "Se cambió la contraseña de tu cuenta", body: "", at });
    const alerts = (await call("GET", "/api/admin/account-alerts")).json;
    assert.equal(alerts.length, 1, "uno solo: sin repetidos, sin códigos, sin cuentas ajenas");
    assert.equal(alerts[0].kind, "password_changed");
    assert.equal(alerts[0].clients, 1, "dice cuántos clientes hay en esa cuenta");
    assert.ok(JSON.stringify((await call("GET", "/api/admin/notifications")).json).includes("cuenta en riesgo"));
    assert.equal((await call("POST", `/api/admin/account-alerts/${alerts[0].id}/seen`, {})).status, 200);
    assert.equal((await call("GET", "/api/admin/account-alerts?unseen=1")).json.length, 0);
  });

  test("WhatsApp: la IA responde y el SISTEMA manda los códigos; nunca los escribe la IA", async () => {
    await call("POST", "/api/admin/whatsapp/secrets", { accessToken: "EAAG" + "x".repeat(60), appSecret: "s".repeat(32) });
    await call("POST", "/api/admin/whatsapp/config", { enabled: true, phoneNumberId: "123456789" });
    await call("POST", "/api/admin/ai", { enabled: { whatsapp: true } });
    claudeOut = () => ({ reply: "Te mando tus códigos recientes 👇", handoff: false, action: "codes" });
    meta.length = 0;
    await app.handleInbound({ from: "59170011223", waId: "wamid.IN1", name: "María", text: "che la tele me muestra un cartel raro y no se que hacer", type: "text", timestamp: Math.floor(Date.now() / 1000) });
    const texts = meta.filter((m) => m.body.type === "text").map((m) => m.body.text.body);
    assert.equal(texts[0], "Te mando tus códigos recientes 👇");
    assert.match(texts[1], /código/i, "segundo mensaje: la respuesta fija del bot con los códigos reales");
    const sys = claudeCalls.at(-1);
    assert.match(sys.messages[0].content, /Lo que sabemos de este cliente/);
    assert.match(sys.messages[0].content, /Netflix: vence en \d+ día\(s\); la cuenta (está bien|tiene un problema)/);
    assert.ok(!JSON.stringify(sys).includes("Secreta#99"), "la contraseña de la cuenta nunca va a Claude");
  });

  test("WhatsApp: si la IA pide una persona, el bot se pausa y no manda extras", async () => {
    claudeOut = () => ({ reply: "Ya te escribe una persona 🙏", handoff: true, action: "codes" });
    meta.length = 0;
    await app.handleInbound({ from: "59170011223", waId: "wamid.IN2", name: "María", text: "son unos estafadores devuelvanme la plata", type: "text", timestamp: Math.floor(Date.now() / 1000) });
    assert.deepEqual(meta.filter((m) => m.body.type === "text").map((m) => m.body.text.body), ["Ya te escribe una persona 🙏"]);
    const chat = (await call("GET", `/api/admin/whatsapp/chats/${encodeURIComponent("+59170011223")}`)).json;
    assert.equal(chat.needsHuman, true, "queda marcado para que responda una persona");
    assert.ok(chat.botPausedUntil > Date.now(), "el bot se pausa en ese chat");
  });

  test("asistente del dueño: responde con la foto del negocio y solo lee", async () => {
    assert.equal((await call("POST", "/api/admin/ai/ask", { question: "¿quién vence esta semana?" })).status, 409, "apagado: no responde");
    await call("POST", "/api/admin/ai", { enabled: { daily: true } });
    claudeOut = (body) => ({ answer: body.messages[0].content.includes("Vencen en los próximos 7 días") ? "Esta semana no vence nadie." : "?" });
    const r = await call("POST", "/api/admin/ai/ask", { question: "¿quién vence esta semana?" });
    assert.equal(r.status, 200);
    assert.equal(r.json.answer, "Esta semana no vence nadie.");
    const snap = claudeCalls.at(-1).messages[0].content;
    assert.match(snap, /Netflix: precio Bs 35\.00, libres \d/);
    assert.match(snap, /María Quispe/);
    assert.ok(!snap.includes("Secreta#99"), "sin contraseñas");
    assert.equal((await call("POST", "/api/admin/ai/ask", { question: "?" })).status, 400);
    assert.ok([401, 403].includes((await call("POST", "/api/admin/ai/ask", { question: "cuánto vendí" }, mariaCk)).status), "un cliente no puede preguntar");
  });

  test("banco de pruebas (modo simulado): todo conectado y las comparaciones del sistema bien", async () => {
    const r = await runBank({ real: false, render: false });
    assert.deepEqual(r.resumen.whatsapp, { total: 40, pasan: 40 });
    assert.deepEqual(r.resumen.comprobantes, { total: 12, pasan: 12 });
    assert.deepEqual(r.resumen.correos, { total: 12, pasan: 12 });
  });
});
