// Avisos del dueño por Telegram, con la API de Telegram SIMULADA (fetch capturado).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../dist/server/app.js";

const TG_TOKEN = "123456789:AAEabcdefghijklmnopqrstuvwxyz012345";

describe("avisos del dueño por Telegram", () => {
  let dir, app, base, owner, seller, sent, tgFails, clock;

  const call = async (method, path, body, cookie) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(cookie ? { cookie } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await r.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: r.status, json };
  };
  const loginCookie = async (username, password) => {
    const r = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) });
    return r.headers.get("set-cookie").split(";")[0];
  };

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-tg-"));
    sent = []; tgFails = null;
    clock = { t: Date.now(), now() { return this.t; } };
    const fakeFetch = async (url, init) => {
      sent.push({ url, body: JSON.parse(init.body) });
      if (tgFails) return new Response(JSON.stringify({ ok: false, description: tgFails }), { status: 400 });
      return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }), { status: 200 });
    };
    app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock, fetchImpl: fakeFetch, telegramBaseUrl: "https://tg.test" });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = await loginCookie("gabriel", "clave-del-dueño-123");
    await call("POST", "/api/admin/staff", { username: "ana", name: "Ana", role: "seller", password: "clave-de-ana-123" }, owner);
    seller = await loginCookie("ana", "clave-de-ana-123");
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("estado inicial: sin configurar y con la lista de avisos", async () => {
    const r = await call("GET", "/api/admin/telegram", undefined, owner);
    assert.equal(r.status, 200);
    assert.equal(r.json.hasToken, false);
    assert.equal(r.json.enabled, false);
    assert.deepEqual(r.json.alertTypes, ["payment", "reseller", "reloc", "supplier", "overdue", "due"]);
  });

  test("solo el dueño configura", async () => {
    assert.equal((await call("POST", "/api/admin/telegram", { enabled: true }, seller)).status, 403);
  });

  test("el token se valida y nunca vuelve completo", async () => {
    assert.equal((await call("POST", "/api/admin/telegram", { token: "no-sirve" }, owner)).status, 400);
    assert.equal((await call("POST", "/api/admin/telegram", { token: TG_TOKEN, chatId: "987654321", alerts: ["payment", "reloc"], enabled: true }, owner)).status, 200);
    const r = await call("GET", "/api/admin/telegram", undefined, owner);
    assert.equal(r.json.hasToken, true);
    assert.equal(r.json.chatId, "987654321");
    assert.deepEqual(r.json.alerts, ["payment", "reloc"]);
    assert.equal(r.json.enabled, true);
    // El token no aparece en el estado ni en la auditoría.
    const dump = JSON.stringify(app.store.snapshot()) + JSON.stringify(app.store.stats.audit({ id: "x", role: "owner" }));
    assert.ok(!dump.includes(TG_TOKEN), "el token no queda en el estado ni en la auditoría");
  });

  test("la prueba manda un mensaje a Telegram con el formato correcto", async () => {
    sent.length = 0;
    const r = await call("POST", "/api/admin/telegram/test", { chatId: "555" }, owner);
    assert.equal(r.status, 200);
    assert.equal(sent.length, 1);
    assert.equal(sent[0].url, `https://tg.test/bot${TG_TOKEN}/sendMessage`);
    assert.equal(sent[0].body.chat_id, "555");
    assert.equal(sent[0].body.parse_mode, "HTML");
    assert.ok(typeof sent[0].body.text === "string" && sent[0].body.text.length > 0);
  });

  test("si Telegram falla, el error se devuelve claro", async () => {
    tgFails = "chat not found";
    const r = await call("POST", "/api/admin/telegram/test", { chatId: "555" }, owner);
    assert.equal(r.status, 502);
    assert.ok(String(r.json.message).includes("chat not found"));
    tgFails = null;
  });

  test("guardar solo la config no borra el token", async () => {
    await call("POST", "/api/admin/telegram", { enabled: false, chatId: "987654321", alerts: ["payment"] }, owner);
    assert.equal((await call("GET", "/api/admin/telegram", undefined, owner)).json.hasToken, true);
  });
});
