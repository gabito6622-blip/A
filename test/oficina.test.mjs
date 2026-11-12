// 🏢 Mi oficina: la pantalla animada de los asistentes muestra lo que hicieron DE VERDAD (comprobantes,
// WhatsApp, vigilante, códigos, reporte), sin datos sensibles, y solo la ven el dueño y los admin.
// Claude y Meta son FALSOS: no sale nada real. Navegador a 360 px (se salta sin Playwright).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

describe("mi oficina", () => {
  let dir, app, base, owner, ana, anaCk, claudeOut;
  const call = async (method, path, body, ck = owner) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(ck ? { cookie: ck } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };
  const login = async (username, password) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) })).headers.get("set-cookie").split(";")[0];
  const office = async (ck = owner) => (await call("GET", "/api/admin/office", undefined, ck));
  const ag = (d, id) => d.agents.find((a) => a.id === id);

  before(async () => {
    claudeOut = () => ({});
    const claudeFetch = async (_u, init) => {
      const body = JSON.parse(init.body);
      return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(claudeOut(body)) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    const metaFetch = async () => new Response(JSON.stringify({ messages: [{ id: "wamid.x" }] }), { status: 200, headers: { "content-type": "application/json" } });
    dir = mkdtempSync(join(tmpdir(), "gs-oficina-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, publicOrigin: "https://tienda.test", fetchImpl: metaFetch, metaBaseUrl: "https://meta.test", anthropicApiKey: "sk-ant-prueba", anthropicFetch: claudeFetch });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = await login("gabriel", "clave-del-dueño-123");
    await call("POST", "/api/admin/products", { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    await call("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true });
    await call("POST", "/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf@x.lat", password: "Secreta#99", supplierExpiresAt: Date.now() + 90 * 864e5, cost: 3000, profiles: [{ label: "P1" }, { label: "P2" }] });
    ana = (await call("POST", "/api/admin/customers", { name: "Ana María Rojas", phone: "+591 70011223", whatsappConsent: true })).json;
    const url = (await call("POST", `/api/admin/customers/${ana.id}/login-link`, {})).json.url;
    anaCk = (await fetch(base + "/api/auth/customer/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: url.split("#acceso=")[1] }) })).headers.get("set-cookie").split(";")[0];
    await call("POST", "/api/admin/staff", { username: "ada", name: "Ada", role: "admin", password: "clave-de-ada-123" });
    await call("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("arranca tranquila: los 6 en su puesto, los de IA dormidos hasta que el dueño los prenda", async () => {
    const r = await office();
    assert.equal(r.status, 200);
    assert.deepEqual(r.json.agents.map((a) => a.id), ["receipts", "whatsapp", "daily", "watch", "codes", "cartero"]);
    assert.equal(ag(r.json, "receipts").on, false);
    assert.equal(ag(r.json, "watch").on, true, "el vigilante con reglas trabaja siempre (gratis)");
    assert.equal(ag(r.json, "watch").aiOn, false);
    assert.equal(r.json.feed.length, 0);
    assert.equal(r.json.ai.calls, 0, "el dueño ve lo gastado en Claude");
  });

  test("permisos: dueño y admin sí; atención (vendedor) y clientes no; la plata de Claude solo el dueño", async () => {
    const ada = await login("ada", "clave-de-ada-123"), lucia = await login("lucia", "clave-de-lucia-123");
    const a = await office(ada);
    assert.equal(a.status, 200);
    assert.equal(a.json.ai, null, "el admin no ve lo gastado");
    assert.equal((await office(lucia)).status, 403);
    assert.ok([401, 403].includes((await office(anaCk)).status));
    assert.equal((await office(null)).status, 401);
  });

  test("Rocío revisa un comprobante y se anota con el primer nombre, sin montos ni datos de cuentas", async () => {
    await call("POST", "/api/admin/ai", { enabled: { receipts: true } });
    claudeOut = () => ({ is_payment_proof: true, amount: 35, currency: "Bs", reference: "777", date: "hoy", recipient: "Gabriel", looks_edited: false, notes: "Coincide." });
    const o = (await call("POST", "/api/orders", { items: [{ productId: "netflix", qty: 1 }], paymentMethod: "qr" }, anaCk)).json;
    assert.equal((await call("POST", `/api/orders/${o.id}/evidence`, { contentBase64: PNG, declaredReference: "777" }, anaCk)).status, 200);
    let d;
    for (let i = 0; i < 40; i++) { d = (await office()).json; if (ag(d, "receipts").last) break; await new Promise((r) => setTimeout(r, 50)); }
    const r = ag(d, "receipts");
    assert.equal(r.on, true);
    assert.equal(r.today, 1);
    assert.equal(r.last.text, "Revisé el comprobante de Ana: ✅ parece correcto.");
    assert.equal(r.last.tone, "ok");
    // Solo los textos que se muestran (los ids y las fechas son números que pueden contener "777" por casualidad).
    const shown = JSON.stringify([...d.feed.map((x) => x.text), ...d.agents.map((x) => x.last?.text ?? "")]);
    assert.ok(!/Rojas|Secreta#99|nf@x\.lat|777/.test(shown), "ni apellido, ni contraseña, ni correo, ni número de operación");
  });

  test("Wali responde por WhatsApp y avisa cuando hace falta una persona", async () => {
    await call("POST", "/api/admin/whatsapp/secrets", { accessToken: "EAAG" + "x".repeat(60), appSecret: "s".repeat(32) });
    await call("POST", "/api/admin/whatsapp/config", { enabled: true, phoneNumberId: "123456789" });
    await call("POST", "/api/admin/ai", { enabled: { whatsapp: true } });
    claudeOut = () => ({ reply: "¡Hola! Te ayudo 🙌", handoff: false, action: "none" });
    await app.handleInbound({ from: "59170011223", waId: "wamid.A1", name: "Ana", text: "che la tele me muestra un cartel raro", type: "text", timestamp: Math.floor(Date.now() / 1000) });
    assert.equal(ag((await office()).json, "whatsapp").last.text, "Le respondí a Ana por WhatsApp.");
    claudeOut = () => ({ reply: "Ya te escribe una persona 🙏", handoff: true, action: "none" });
    await app.handleInbound({ from: "59170011223", waId: "wamid.A2", name: "Ana", text: "quiero hablar con alguien ya mismo por favor", type: "text", timestamp: Math.floor(Date.now() / 1000) });
    const w = ag((await office()).json, "whatsapp");
    assert.equal(w.last.tone, "warn");
    assert.match(w.last.text, /Ana necesita hablar con vos/);
    assert.equal(w.today, 2);
  });

  test("Vico: la alarma suena mientras no viste el aviso; Coco se despierta con un código", async () => {
    app.watchMail({ to: "nf@x.lat", from: "Netflix <info@account.netflix.com>", subject: "Se cambió la contraseña de tu cuenta", body: "Te confirmamos que se cambió la contraseña.", at: Date.now() });
    let v = ag((await office()).json, "watch");
    assert.equal(v.last.tone, "bad");
    assert.equal(v.last.text, "Netflix: le cambiaron la contraseña. ¡Miralo!");
    const al = (await call("GET", "/api/admin/account-alerts")).json[0];
    await call("POST", `/api/admin/account-alerts/${al.id}/seen`, {});
    v = ag((await office()).json, "watch");
    assert.equal(v.last.tone, "info", "ya lo viste: deja de sonar");
    assert.match(v.last.text, /Ya lo viste/);
    assert.equal(ag((await office()).json, "codes").on, false, "sin buzón ni códigos: dormido");
    app.store.engine.tx(() => { (app.store.engine.s.codes ??= []).push({ id: "cod_t", mailboxId: "mb_x", to: "nf@x.lat", subject: "Tu código", code: "482913", kind: "login", receivedAt: Date.now() }); });
    const d = (await office()).json, c = ag(d, "codes");
    assert.equal(c.on, true);
    assert.equal(c.last.text, "Llegó un código de Netflix. Ya está en el Panel de códigos.");
    assert.ok(!JSON.stringify(d).includes("482913"), "el código nunca aparece en la oficina");
  });

  test("lo anotado no va en el estado ni en la exportación; guarda como mucho 80", async () => {
    assert.ok(!JSON.stringify(app.store.engine.s).includes("Revisé el comprobante"), "vive con los secretos, no en el estado");
    const exp = await fetch(base + "/api/admin/export/todo", { headers: { cookie: owner } });
    if (exp.status === 200) assert.ok(!(await exp.text()).includes("Revisé el comprobante"));
    await call("POST", "/api/admin/whatsapp/secrets", { accessToken: "EAAG" + "x".repeat(60), appSecret: "s".repeat(32) });
    await call("POST", "/api/admin/whatsapp/config", { enabled: true, phoneNumberId: "123456789" });
    await call("POST", "/api/admin/ai", { enabled: { whatsapp: true } });
    app.db.setSecret("office_feed", JSON.stringify(Array.from({ length: 80 }, (_, k) => ({ a: "receipts", at: Date.now() - 1000 - k, text: "x", tone: "ok" }))), Date.now());
    claudeOut = () => ({ reply: "Hola", handoff: false, action: "none" });
    await app.handleInbound({ from: "59176543210", waId: "wamid.B1", name: "Beto Paz", text: "una consulta rara que el bot no entiende", type: "text", timestamp: Math.floor(Date.now() / 1000) });
    const saved = JSON.parse(app.db.getSecret("office_feed"));
    assert.equal(saved.length, 80, "no crece sin fin");
    assert.equal(saved.at(-1).text, "Le respondí a Beto por WhatsApp.", "lo nuevo entra y se va lo más viejo");
  });

  test("navegador a 360 px: la oficina se ve, sin desborde, botones de 44 px y letra de 12 px o más", { skip: !chromium }, async () => {
    const b = await chromium.launch();
    try {
      for (const scheme of ["light", "dark"]) {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme });
        await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        // La app de la prueba tiene otro origen público: se entra con la sesión del dueño ya abierta.
        const [name, value] = owner.split("=");
        await ctx.addCookies([{ name, value, url: base }]);
        await p.goto(base + "/panel.html#oficina");
        await p.waitForSelector(".of-desk");
        assert.equal(await p.locator(".of-desk").count(), 6);
        await p.click('[data-ofsel="watch"]');
        await p.waitForSelector("#ofDetail");
        const m = await p.evaluate(() => ({
          over: document.documentElement.scrollWidth > innerWidth + 1,
          small: [...document.querySelectorAll("#ofRoot button")].filter((x) => { const r = x.getBoundingClientRect(); return r.width && r.height < 44; }).length,
          tiny: [...document.querySelectorAll("#ofRoot *")].filter((x) => [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 12).length,
          states: [...document.querySelectorAll(".of-desk")].map((d) => [...d.classList].find((c) => /^of-(work|idle|off|alert)$/.test(c))),
        }));
        assert.equal(m.over, false, `${scheme}: sin desborde`);
        assert.equal(m.small, 0, `${scheme}: botones de 44 px`);
        assert.equal(m.tiny, 0, `${scheme}: letra de 12 px o más`);
        assert.equal(m.states.length, 6);
        assert.ok(m.states.every(Boolean));
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    } finally { await b.close(); }
  });
});
