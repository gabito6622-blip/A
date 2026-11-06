// Tests del núcleo del SDK con un `fetch` simulado (sin red real).
// Ejecutar: node --test   (tras `npm run build`)
import { test } from "node:test";
import assert from "node:assert/strict";
import { Http, MemoryTokenStore, HttpError } from "../dist/http.js";
import { VendePlayClient } from "../dist/index.js";
import { WhatsAppClient } from "../dist/resources/whatsapp.js";

/** Crea un fetch falso que va devolviendo respuestas de una cola y registra llamadas. */
function fakeFetch(responses) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const r = responses.shift();
    if (!r) throw new Error("fakeFetch: sin más respuestas en cola");
    const body = typeof r.body === "string" ? r.body : JSON.stringify(r.body ?? {});
    return new Response(body, {
      status: r.status ?? 200,
      headers: { "content-type": "application/json", ...(r.headers ?? {}) },
    });
  };
  fn.calls = calls;
  return fn;
}

test("GET agrega Bearer y arma query", async () => {
  const tokens = new MemoryTokenStore();
  tokens.setAccess("ACCESS123");
  const f = fakeFetch([{ body: { data: [1, 2, 3] } }]);
  const http = new Http({ tokens, fetchImpl: f });
  const out = await http.get("/clients", { page: 1, q: "ana" });
  assert.deepEqual(out, { data: [1, 2, 3] });
  const call = f.calls[0];
  assert.equal(call.init.method, "GET");
  assert.match(call.url, /\/clients\?/);
  assert.match(call.url, /page=1/);
  assert.match(call.url, /q=ana/);
  assert.equal(call.init.headers.Authorization, "Bearer ACCESS123");
});

test("POST manda JSON con content-type", async () => {
  const f = fakeFetch([{ body: { ok: true } }]);
  const http = new Http({ fetchImpl: f });
  await http.post("/clients", { name: "Ana" });
  const call = f.calls[0];
  assert.equal(call.init.method, "POST");
  assert.equal(call.init.headers["Content-Type"], "application/json");
  assert.equal(call.init.body, JSON.stringify({ name: "Ana" }));
});

test("401 limpia el token, notifica onUnauthorized y lanza (sin refresh)", async () => {
  const tokens = new MemoryTokenStore();
  tokens.setAccess("OLD");
  let unauthorized = 0;
  const f = fakeFetch([{ status: 401, body: { code: "ERROR", message: "Unauthorized", status: 401 } }]);
  const http = new Http({ tokens, fetchImpl: f, onUnauthorized: () => { unauthorized++; } });
  await assert.rejects(
    () => http.get("/metrics/dashboard"),
    (e) => e instanceof HttpError && e.status === 401 && e.body.message === "Unauthorized",
  );
  assert.equal(f.calls.length, 1);              // no reintento ni /auth/refresh
  assert.equal(await tokens.getAccess(), null); // token limpiado
  assert.equal(unauthorized, 1);
});

test("error no-OK lanza HttpError con status y body", async () => {
  const f = fakeFetch([{ status: 500, body: { message: "boom" } }]);
  const http = new Http({ fetchImpl: f });
  await assert.rejects(
    () => http.get("/x", undefined, { auth: false }),
    (err) => err instanceof HttpError && err.status === 500 && err.body.message === "boom",
  );
});

test("login manda {accountCode(ACC-),username,password}, guarda token", async () => {
  const tokens = new MemoryTokenStore();
  const f = fakeFetch([{ body: { data: { accessToken: "AAA", user: { accountCode: "ACC-12345" } } } }]);
  const c = new VendePlayClient({ tokens, fetchImpl: f });
  const data = await c.login({ accountCode: "12345", username: "ana", password: "x" });
  assert.equal(data.accessToken, "AAA");
  assert.equal(await tokens.getAccess(), "AAA");
  assert.equal(f.calls[0].init.headers.Authorization, undefined); // login sin Bearer
  assert.deepEqual(JSON.parse(f.calls[0].init.body), {
    accountCode: "ACC-12345", username: "ana", password: "x",
  });
});

test("WhatsAppClient usa x-api-key y manda session en sendText", async () => {
  const f = fakeFetch([{ body: { ok: true } }]);
  const wa = new WhatsAppClient(
    { url: "https://gw.example.com", referenceId: "REF1", token: "KEY1" },
    { fetchImpl: f },
  );
  await wa.sendText("chat-9", "hola");
  const call = f.calls[0];
  assert.match(call.url, /^https:\/\/gw\.example\.com\/sendText$/);
  assert.equal(call.init.headers["x-api-key"], "KEY1");
  assert.equal(call.init.headers.Authorization, undefined);
  assert.deepEqual(JSON.parse(call.init.body), { session: "REF1", chatId: "chat-9", text: "hola" });
});

test("connectWhatsApp resuelve el plugin self.ws", async () => {
  const tokens = new MemoryTokenStore();
  tokens.setAccess("ACCESS");
  const f = fakeFetch([
    { body: { data: [{ url: "https://gw.x", referenceId: "R2", token: "K2", name: "self.ws" }] } },
    { body: { ok: true } },
  ]);
  const c = new VendePlayClient({ tokens, fetchImpl: f });
  const wa = await c.connectWhatsApp();
  assert.equal(wa.referenceId, "R2");
  // la 1a llamada fue GET /account-plugins?name=self.ws&status=ACTIVE con Bearer
  assert.match(f.calls[0].url, /\/account-plugins\?/);
  assert.match(f.calls[0].url, /name=self\.ws/);
  assert.match(f.calls[0].url, /status=ACTIVE/);
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer ACCESS");
  await wa.sessions.status();
  assert.match(f.calls[1].url, /^https:\/\/gw\.x\/sessions\/R2$/);
  assert.equal(f.calls[1].init.headers["x-api-key"], "K2");
});
