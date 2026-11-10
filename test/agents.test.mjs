// Agentes con Claude: comprobantes, WhatsApp y reporte del día. La API de Claude es FALSA (fetch simulado):
// no se llama a nada real ni se gasta plata.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";
import { Agents, defaultAiCfg, cleanApiKey, keyShape } from "../dist/server/agents.js";
import { botAnswer } from "../dist/server/bot.js";
import { createStore } from "../dist/store/index.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");

/** API de Claude simulada: devuelve como texto el JSON que le pidamos y guarda cada pedido. */
function fakeClaude() {
  const calls = [];
  let next = () => ({});
  const f = async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url: String(url), body, headers: Object.fromEntries(new Headers(init.headers).entries()) });
    const out = next(body);
    if (out.__status) return new Response(JSON.stringify({ type: "error", error: { type: "api_error", message: "falló" } }), { status: out.__status, headers: { "content-type": "application/json" } });
    return new Response(JSON.stringify({
      id: "msg_x", type: "message", role: "assistant", model: body.model,
      content: [{ type: "text", text: JSON.stringify(out) }], stop_reason: out.__refusal ? "refusal" : "end_turn", stop_sequence: null,
      usage: { input_tokens: 2000, output_tokens: 200, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    }), { status: 200, headers: { "content-type": "application/json", "request-id": "req_x" } });
  };
  return { f, calls, set: (fn) => { next = fn; } };
}

describe("agentes (unidad)", () => {
  const mk = (fake, cfg = {}) => {
    let c = { ...defaultAiCfg("2026-11"), enabled: { receipts: true, whatsapp: true, daily: true }, ...cfg };
    return new Agents({ apiKey: "sk-ant-prueba", fetchImpl: fake.f, now: () => Date.UTC(2026, 10, 10), getCfg: () => c, saveCfg: (x) => { c = x; } });
  };

  test("comprobante que coincide: parece bien; el servidor compara monto y número", async () => {
    const fake = fakeClaude();
    fake.set(() => ({ is_payment_proof: true, amount: 35, currency: "Bs", reference: "00123456", date: "10/11/2026", recipient: "Gabriel", looks_edited: false, notes: "Se ve claro." }));
    const a = mk(fake);
    const r = await a.reviewReceipt({ file: Buffer.from("x"), mime: "image/png", expectedTotal: 3500, currencySymbol: "Bs", declaredReference: "123456", methodName: "QR" });
    assert.equal(r.verdict, "parece_ok");
    assert.equal(r.amountMatches, true);
    assert.equal(r.referenceMatches, true);
    const req = fake.calls[0];
    assert.equal(req.body.model, "claude-opus-5-5");
    assert.equal(req.body.output_config.format.type, "json_schema");
    assert.equal(req.body.output_config.effort, "low");
    assert.equal(req.body.fallbacks, "default");
    assert.match(req.headers["anthropic-beta"] ?? "", /server-side-fallback-2026-07-01/);
    assert.equal(req.body.messages[0].content[0].type, "image");
    for (const k of ["temperature", "top_p", "top_k"]) assert.ok(!(k in req.body), `no manda ${k}`);
    assert.ok(a.cfg().spentUsd > 0, "anota lo gastado");
  });

  test("monto distinto o comprobante editado: no aprueba nada, pide revisar", async () => {
    const fake = fakeClaude();
    fake.set(() => ({ is_payment_proof: true, amount: 3.5, currency: "Bs", reference: "999", date: null, recipient: null, looks_edited: false, notes: "" }));
    const a = mk(fake);
    assert.equal((await a.reviewReceipt({ file: Buffer.from("x"), mime: "image/png", expectedTotal: 3500, currencySymbol: "Bs", declaredReference: "123", methodName: "QR" })).verdict, "no_coincide");
    fake.set(() => ({ is_payment_proof: true, amount: 35, currency: "Bs", reference: "123", date: null, recipient: null, looks_edited: true, notes: "Letras raras." }));
    assert.equal((await a.reviewReceipt({ file: Buffer.from("x"), mime: "image/png", expectedTotal: 3500, currencySymbol: "Bs", declaredReference: "123", methodName: "QR" })).verdict, "revisar");
  });

  test("Haiku no manda el parámetro de respaldo (no lo admite)", async () => {
    const fake = fakeClaude();
    fake.set(() => ({ report: "Todo tranqui." }));
    await mk(fake, { model: "claude-haiku-5-5" }).dailyReport("nada");
    assert.equal(fake.calls[0].body.model, "claude-haiku-5-5");
    assert.ok(!("fallbacks" in fake.calls[0].body));
  });

  test("tope mensual, apagado y negativa: no se llama o se informa claro", async () => {
    const fake = fakeClaude();
    await assert.rejects(mk(fake, { monthlyLimitUsd: 0 }).dailyReport("x"), (e) => e.code === "AI_LIMIT");
    await assert.rejects(mk(fake, { enabled: { receipts: false, whatsapp: false, daily: false } }).dailyReport("x"), (e) => e.code === "AI_OFF");
    assert.equal(fake.calls.length, 0, "no gastó nada");
    fake.set(() => ({ report: "x", __refusal: true }));
    await assert.rejects(mk(fake).dailyReport("x"), (e) => e.code === "AI_REFUSED");
    const noKey = new Agents({ now: () => 0, getCfg: () => defaultAiCfg("1970-01"), saveCfg: () => {} });
    assert.equal(noKey.hasKey, false);
    assert.equal(noKey.isOn("whatsapp"), false);
  });

  test("WhatsApp: la respuesta y el pase a una persona; el mensaje del cliente va como dato", async () => {
    const fake = fakeClaude();
    fake.set(() => ({ reply: "¡Hola! Netflix sale Bs 35 por 30 días. Escribí *menu* para ver más.", handoff: false }));
    const r = await mk(fake).whatsappReply({ storeContext: "- Netflix: Bs 35", history: [{ from: "cliente", text: "hola" }], message: "cuánto sale netflix?" });
    assert.match(r.reply, /Bs 35/);
    assert.equal(r.handoff, false);
    assert.match(fake.calls[0].body.system, /no lo hagas/);
    assert.match(fake.calls[0].body.messages[0].content, /cuánto sale netflix/);
  });

  test("la clave se limpia al leerla y se avisa si no es de API (sin mostrarla)", async () => {
    assert.equal(cleanApiKey('  "sk-ant-api03-abc\n" '), "sk-ant-api03-abc");
    assert.equal(cleanApiKey("sk-ant-api03-a b\tc"), "sk-ant-api03-abc");
    assert.equal(cleanApiKey("   "), undefined);
    assert.equal(keyShape("sk-ant-api03-abc"), "ok");
    assert.equal(keyShape("sk-ant-oat01-abc"), "not_api_key");
    assert.equal(keyShape(undefined), "missing");
    // Clave rechazada por Anthropic: mensaje claro para el dueño.
    const f401 = async () => new Response(JSON.stringify({ type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }), { status: 401, headers: { "content-type": "application/json" } });
    let c = { ...defaultAiCfg("2026-11"), enabled: { receipts: true, whatsapp: true, daily: true, watch: true } };
    const a = new Agents({ apiKey: "sk-ant-api03-mala", fetchImpl: f401, now: () => Date.UTC(2026, 10, 10), getCfg: () => c, saveCfg: (x) => { c = x; } });
    await assert.rejects(a.dailyReport("x"), (e) => /no es válida/.test(e.message) && /Railway/.test(e.message));
    assert.match(c.lastError, /no es válida/);
    assert.ok(!c.lastError.includes("sk-ant-api03-mala"), "el error nunca muestra la clave");
  });

  test("el bot marca lo que no entendió (ahí entra la IA)", () => {
    const s = createStore();
    const a = botAnswer({ store: s, origin: undefined, loginLink: () => null }, "+59170000000", "che me podés explicar cómo anda lo de los perfiles compartidos?");
    assert.equal(a.unknown, true);
    assert.notEqual(botAnswer({ store: s, origin: undefined, loginLink: () => null }, "+59170000000", "precios").unknown, true);
  });
});

describe("agentes (servidor)", () => {
  let dir, app, base, ownerCk, custCk, fake;
  const call = async (method, path, body, ck = ownerCk) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(ck ? { cookie: ck } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };
  before(async () => {
    fake = fakeClaude();
    dir = mkdtempSync(join(tmpdir(), "gs-ai-"));
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, anthropicApiKey: "sk-ant-prueba", anthropicFetch: fake.f });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    ownerCk = lr.headers.get("set-cookie").split(";")[0];
    const s = app.store, sys = { id: "t", role: "owner" };
    s.catalog.upsertProduct(sys, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertSupplier(sys, { id: "p", name: "P", active: true });
    s.inventory.addAccount(sys, { productId: "nf", supplierId: "p", email: "a@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 30 * 864e5, cost: 100, profiles: [{ label: "P1" }, { label: "P2" }] });
    const c = s.catalog.createCustomer(sys, { name: "María", phone: "+59170011223" });
    const link = (await call("POST", `/api/admin/customers/${c.id}/login-link`, {})).json.url;
    const r = await fetch(base + "/api/auth/customer/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: link.split("#acceso=")[1] }) });
    custCk = r.headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("arranca apagado aunque haya clave; solo el dueño lo configura", async () => {
    const g = await call("GET", "/api/admin/ai");
    assert.equal(g.json.hasKey, true);
    assert.deepEqual(g.json.enabled, { receipts: false, whatsapp: false, daily: false, watch: false });
    assert.equal(g.json.model, "claude-opus-5-5");
    assert.equal((await call("POST", "/api/admin/ai", { model: "gpt-9" })).status, 400);
    const ok = await call("POST", "/api/admin/ai", { enabled: { receipts: true, daily: true }, monthlyLimitUsd: 10 });
    assert.deepEqual(ok.json.enabled, { receipts: true, whatsapp: false, daily: true, watch: false });
    assert.ok([401, 403].includes((await call("GET", "/api/admin/ai", undefined, custCk)).status), "un cliente no lo ve");
  });

  test("al subir un comprobante, el agente lo revisa solo y el panel ve la sugerencia", async () => {
    fake.set(() => ({ is_payment_proof: true, amount: 35, currency: "Bs", reference: "777", date: "hoy", recipient: "Gabriel", looks_edited: false, notes: "Coincide." }));
    const o = (await call("POST", "/api/orders", { items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr" }, custCk)).json;
    assert.equal((await call("POST", `/api/orders/${o.id}/evidence`, { contentBase64: PNG, declaredReference: "777" }, custCk)).status, 200);
    let list;
    for (let i = 0; i < 20; i++) { list = (await call("GET", "/api/admin/orders?status=payment_review")).json; if (list[0]?.aiCheck) break; await new Promise((r) => setTimeout(r, 50)); }
    assert.equal(list[0].aiCheck.verdict, "parece_ok");
    assert.equal(list[0].status, "payment_review", "la IA no aprueba: sigue esperando a una persona");
    const again = await call("POST", `/api/admin/orders/${o.id}/ai-check`, {});
    assert.equal(again.json.amountMatches, true);
  });

  test("reporte del día: con números del sistema, guardado para el panel", async () => {
    fake.set((body) => ({ report: `📋 Hoy: ${body.messages[0].content.includes("Pendientes") ? "hay pendientes" : "?"}` }));
    const r = await call("POST", "/api/admin/ai/daily", {});
    assert.equal(r.status, 200);
    assert.match(r.json.text, /hay pendientes/);
    assert.equal((await call("GET", "/api/admin/ai")).json.daily.text, r.json.text);
  });

  test("probar la oficina: corre el banco en segundo plano, no toca clientes y suma lo gastado", async () => {
    fake.set((body) => Object.keys(body.output_config.format.schema.properties).includes("risk") ? { risk: "none" } : { reply: "Hola, te ayudo. Escribí *menu*.", handoff: false, action: "none" });
    const before = (await call("GET", "/api/admin/ai")).json.calls;
    const st = await call("POST", "/api/admin/ai/selftest", { model: "claude-haiku-5-5" });
    assert.equal(st.status, 200);
    assert.equal(st.json.status, "running");
    let r;
    for (let i = 0; i < 100; i++) { r = (await call("GET", "/api/admin/ai/selftest")).json; if (r.status !== "running") break; await new Promise((x) => setTimeout(x, 50)); }
    assert.equal(r.status, "done");
    assert.equal(r.model, "claude-haiku-5-5");
    assert.equal(r.result.resumen.whatsapp.total, 40);
    assert.equal(r.result.resumen.correos.total, 12);
    assert.equal(r.result.resumen.comprobantes.total, 0, "en el servidor no se dibujan comprobantes");
    assert.ok((await call("GET", "/api/admin/ai")).json.calls >= before + 44, "lo gastado se suma al mes (40 mensajes + 4 correos que las reglas no reconocen)");
    assert.ok([401, 403].includes((await call("POST", "/api/admin/ai/selftest", {}, custCk)).status));
  });

  test("sin clave: todo apagado y el panel lo dice", async () => {
    const d2 = mkdtempSync(join(tmpdir(), "gs-ai2-"));
    const app2 = createApp({ dataDir: d2, jobs: false, log: () => {} });
    app2.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const b2 = `http://127.0.0.1:${await app2.listen(0, "127.0.0.1")}`;
    const lr = await fetch(b2 + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    const ck = lr.headers.get("set-cookie").split(";")[0];
    const g = await (await fetch(b2 + "/api/admin/ai", { headers: { cookie: ck } })).json();
    assert.equal(g.hasKey, false);
    const r = await fetch(b2 + "/api/admin/ai/daily", { method: "POST", headers: { cookie: ck, "content-type": "application/json" }, body: "{}" });
    assert.equal(r.status, 409);
    await app2.close(); rmSync(d2, { recursive: true, force: true });
  });
});
