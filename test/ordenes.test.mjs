// 🗣️ "Decile qué hacer": Sofi, la secretaria. Claude es FALSO (fetch simulado): solo "entiende" la orden.
// Se prueba que el servidor busque los datos reales, que lo enviado a Claude nunca lleve contraseñas,
// códigos, correos completos ni costos, que vender/renovar/pasar no cambien nada hasta confirmar, que
// confirmar use el núcleo y audite, los permisos, los límites y la pantalla a 360 px (sin Playwright, se salta).
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

const DAY = 86_400_000, MIN = 60_000;
const SECRETS = ["Secreta#99", "Clave#Disney7", "482913", "nf@x.lat", "dis@x.lat", "2777", "27.77", "1999", "19.99", "4321"];

describe("decile qué hacer (Sofi)", () => {
  let dir, app, base, owner, ada, beto, lucia, anaCk, claudeOut, shift = 0;
  const bodies = [];
  const ids = {};
  const call = async (method, path, body, ck = owner) => {
    const r = await fetch(base + path, { method, headers: { ...(body !== undefined ? { "content-type": "application/json" } : {}), ...(ck ? { cookie: ck } : {}) }, body: body === undefined ? undefined : JSON.stringify(body) });
    const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = t; } return { status: r.status, json: j };
  };
  const login = async (username, password) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username, password }) })).headers.get("set-cookie").split(";")[0];
  /** Lo que "entiende" Claude para la próxima orden. */
  const understands = (f) => { claudeOut = () => ({ intent: "help", customer: null, product: null, account: null, to_customer: null, qty: null, months: null, days: null, pay: null, ...f }); };
  const say = (text, ck = owner) => call("POST", "/api/admin/command", { text }, ck);
  const audit = () => app.store.engine.s.audit;
  const asg = (customerId) => Object.values(app.store.engine.s.assignments).filter((a) => a.customerId === customerId && a.status === "active");

  before(async () => {
    understands({});
    const claudeFetch = async (_u, init) => {
      const body = JSON.parse(init.body);
      bodies.push(init.body);
      return new Response(JSON.stringify({ id: "m", type: "message", role: "assistant", model: body.model, content: [{ type: "text", text: JSON.stringify(claudeOut(body)) }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 10, output_tokens: 10 } }), { status: 200, headers: { "content-type": "application/json" } });
    };
    dir = mkdtempSync(join(tmpdir(), "gs-ordenes-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, anthropicApiKey: "sk-ant-prueba", anthropicFetch: claudeFetch, clock: { now: () => Date.now() + shift } });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = await login("gabriel", "clave-del-dueño-123");
    await call("POST", "/api/admin/products", { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    await call("POST", "/api/admin/products", { id: "disney", name: "Disney+", kind: "profile", durationDays: 30, price: 3000, published: true });
    await call("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true });
    const far = Date.now() + 120 * DAY;
    ids.nfAcc = (await call("POST", "/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf@x.lat", password: "Secreta#99", supplierExpiresAt: far, cost: 2777, profiles: [{ label: "P1", pin: "4321" }, { label: "P2" }, { label: "P3" }] })).json.account.id;
    await call("POST", "/api/admin/accounts", { productId: "disney", supplierId: "andes", email: "dis@x.lat", password: "Clave#Disney7", supplierExpiresAt: far, cost: 1999, profiles: [{ label: "D1" }, { label: "D2" }, { label: "D3" }, { label: "D4" }, { label: "D5" }, { label: "D6" }] });
    const mk = async (name, phone) => (await call("POST", "/api/admin/customers", { name, phone, whatsappConsent: true })).json.id;
    ids.anaQ = await mk("Ana Quispe", "+591 70011111");
    ids.anaR = await mk("Ana Rojas", "+591 70022222");
    ids.rodrigo = await mk("Rodrigo Paz", "+591 70033333");
    ids.juan = await mk("Juan Pérez", "+591 70044444");
    const sell = async (customerId, slotLabel) => {
      const slot = Object.values(app.store.engine.s.slots).find((s) => s.label === slotLabel);
      return (await call("POST", "/api/admin/orders", { customerId, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slot.id] })).json.assignmentIds[0];
    };
    ids.rodNf = await sell(ids.rodrigo, "P1");
    ids.juanNf = await sell(ids.juan, "P2");
    await call("POST", "/api/admin/fiado/charge", { customerId: ids.juan, amount: 2000, note: "Netflix de octubre" });
    app.store.engine.tx(() => { (app.store.engine.s.codes ??= []).push({ id: "cod_t", mailboxId: "mb_x", to: "nf@x.lat", subject: "Tu código de Netflix", code: "482913", kind: "login", receivedAt: Date.now() - 2 * MIN }); });
    await call("POST", "/api/admin/staff", { username: "ada", name: "Ada", role: "admin", password: "clave-de-ada-123" });
    await call("POST", "/api/admin/staff", { username: "beto", name: "Beto", role: "admin", password: "clave-de-beto-123" });
    await call("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
    ada = await login("ada", "clave-de-ada-123"); beto = await login("beto", "clave-de-beto-123"); lucia = await login("lucia", "clave-de-lucia-123");
    const url = (await call("POST", `/api/admin/customers/${ids.anaQ}/login-link`, {})).json.url;
    anaCk = (await fetch(base + "/api/auth/customer/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: url.split("#acceso=")[1] }) })).headers.get("set-cookie").split(";")[0];
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("apagada por defecto o sin clave: lo explica claro y no llama a Claude", async () => {
    const r = await say("vendele un disney a ana");
    assert.equal(r.status, 409);
    assert.match(r.json.message, /apagada/);
    assert.match(r.json.message, /Configuración/);
    assert.equal(bodies.length, 0, "no gastó nada");
    const d2 = mkdtempSync(join(tmpdir(), "gs-ordenes-sin-"));
    const a2 = createApp({ dataDir: d2, staticDir: resolve("public"), jobs: false, log: () => {} });
    a2.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const b2 = `http://127.0.0.1:${await a2.listen(0, "127.0.0.1")}`;
    const ck = (await fetch(b2 + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const r2 = await fetch(b2 + "/api/admin/command", { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: JSON.stringify({ text: "quien me debe" }) });
    assert.equal(r2.status, 409);
    assert.match((await r2.json()).message, /clave de Claude/);
    await a2.close(); rmSync(d2, { recursive: true, force: true });
    // Prenderla (como en Configuración → Oficina virtual).
    assert.equal((await call("POST", "/api/admin/ai", { enabled: { commands: true } })).status, 200);
    assert.equal((await call("GET", "/api/admin/ai")).json.enabled.commands, true);
  });

  test("códigos: trae el real de la cuenta del cliente; a Claude solo va el texto tapado", async () => {
    understands({ intent: "codes", customer: "rodrigo", product: "netflix" });
    const r = await say("dame el codigo de la netflix de rodrigo");
    assert.equal(r.status, 200);
    assert.match(r.json.text, /Códigos de Rodrigo \(Netflix\)/);
    assert.match(r.json.lines.join("\n"), /482913/);
    const sent = JSON.parse(bodies.at(-1));
    assert.match(sent.messages[0].content, /dame el codigo de la netflix de rodrigo/);
    assert.match(sent.messages[0].content, /Netflix \| Disney\+/, "le pasa los nombres de los productos");
    // Por correo: el correo va tapado y el servidor lo destapa.
    understands({ intent: "codes", account: "[correo1]" });
    const r2 = await say("pasame el código de nf@x.lat");
    assert.match(r2.json.lines.join("\n"), /482913/);
    assert.match(bodies.at(-1), /\[correo1\]/);
    assert.ok(!bodies.at(-1).includes("nf@x.lat"), "el correo nunca va a Claude");
  });

  test("libres, cliente, deudas, vencimientos y ayuda: datos reales, tolerante a faltas", async () => {
    understands({ intent: "free", product: "disny" });
    let r = await say("que perfil de disny tengo libre");
    assert.equal(r.json.text, "Tenés 6 perfiles libres de Disney+:");
    assert.match(r.json.lines[0], /D1/);
    understands({ intent: "customer", customer: "rodirgo paz" });
    r = await say("como esta rodirgo");
    assert.equal(r.json.text, "Rodrigo Paz:");
    assert.match(r.json.lines.join("\n"), /Netflix · P1 · vence \d\d\/\d\d/);
    understands({ intent: "owes" });
    r = await say("quien me debe");
    assert.match(r.json.text, /Te deben Bs 20/);
    assert.match(r.json.lines.join("\n"), /Juan Pérez: Bs 20/);
    // Vencimientos: el de Rodrigo pasa a mañana.
    await call("POST", `/api/admin/assignments/${ids.rodNf}/expiry`, { expiresAt: Date.now() + DAY });
    understands({ intent: "expiring", days: 1 });
    r = await say("quien vence mañana");
    assert.match(r.json.text, /mañana/);
    assert.match(r.json.lines.join("\n"), /Rodrigo Paz · Netflix · \d\d\/\d\d/);
    understands({ intent: "unknown" });
    r = await say("bla bla");
    assert.equal(r.json.kind, "help");
    assert.ok(r.json.suggestions.length >= 3);
  });

  test("datos de acceso: la contraseña solo con el botón, con el permiso y la auditoría de siempre", async () => {
    understands({ intent: "account", customer: "rodrigo", product: "netflix" });
    const r = await say("datos de la netflix de rodrigo");
    assert.match(r.json.lines.join("\n"), /nf@x\.lat/);
    assert.match(r.json.lines.join("\n"), /P1/);
    assert.ok(!JSON.stringify(r.json).includes("Secreta#99"), "la contraseña no viene en la respuesta");
    assert.ok(!JSON.stringify(r.json).includes("4321"), "el PIN tampoco");
    const before = audit().filter((x) => x.action === "secrets.view").length;
    const s = await call("POST", "/api/admin/command/secret", r.json.account);
    assert.equal(s.status, 200);
    assert.equal(s.json.password, "Secreta#99");
    assert.equal(s.json.pin, "4321");
    const au = audit().filter((x) => x.action === "secrets.view");
    assert.equal(au.length, before + 1);
    assert.equal(au.at(-1).entityId, ids.nfAcc);
    assert.equal((await call("POST", "/api/admin/command/secret", r.json.account, lucia)).status, 403, "Atención no ve contraseñas");
  });

  test("vender: el plan no cambia nada; confirmar usa el núcleo, audita, anota en la oficina y es de un solo uso", async () => {
    understands({ intent: "sell", customer: "ana quispe", product: "disney", pay: "qr" });
    const orders0 = Object.keys(app.store.engine.s.orders).length;
    const r = await say("vendele un disney a ana quispe, me pago por qr");
    assert.equal(r.json.kind, "plan");
    const lines = r.json.plan.lines.join("\n");
    assert.match(lines, /Ana Quispe/);
    assert.match(lines, /Disney\+/);
    assert.match(lines, /Bs 30/);
    assert.match(lines, /D1/, "dice qué perfil le toca");
    assert.match(lines, /QR/);
    assert.ok(r.json.plan.expiresAt - Date.now() <= 10 * MIN + 1000);
    assert.equal(Object.keys(app.store.engine.s.orders).length, orders0, "todavía no vendió nada");
    assert.equal(asg(ids.anaQ).length, 0);
    // Otro usuario no puede confirmarlo.
    assert.equal((await call("POST", `/api/admin/command/${r.json.plan.id}/confirm`, {}, ada)).status, 404);
    const c = await call("POST", `/api/admin/command/${r.json.plan.id}/confirm`, {});
    assert.equal(c.status, 200);
    assert.match(c.json.text, /le vendí Disney\+ a Ana/);
    assert.equal(c.json.hasPhone, true);
    const mine = asg(ids.anaQ);
    assert.equal(mine.length, 1);
    assert.equal(app.store.engine.s.slots[mine[0].slotId].label, "D1");
    const o = app.store.engine.s.orders[mine[0].orderId];
    assert.equal(o.status, "fulfilled");
    assert.equal(o.total, 3000);
    assert.equal(o.createdBy, app.store.engine.s.audit.find((x) => x.action === "order.create" && x.entityId === o.id).actorId, "lo hizo el que confirmó");
    const au = audit().filter((x) => x.action === "assistant.command").at(-1);
    assert.equal(au.data.intent, "sell");
    assert.equal(au.data.order, o.id);
    assert.ok(!JSON.stringify(au).includes("Ana"), "la auditoría lleva solo ids");
    const office = (await call("GET", "/api/admin/office")).json;
    const sofi = office.agents.find((a) => a.id === "commands");
    assert.equal(sofi.last.text, "Le vendí Disney+ a Ana por orden tuya.");
    assert.equal(sofi.on, true);
    // Un solo uso.
    assert.equal((await call("POST", `/api/admin/command/${r.json.plan.id}/confirm`, {})).status, 409);
    assert.equal(asg(ids.anaQ).length, 1, "no vendió dos veces");
    // El mensaje de entrega que ya existe, para el botón de WhatsApp (nunca se manda solo).
    const dlv = await call("GET", `/api/admin/assignments/${c.json.assignmentIds[0]}/delivery`);
    assert.match(dlv.json.message, /Disney\+/);
    assert.equal(app.store.engine.s.outbox.filter((m) => m.status === "sent").length, 0, "no mandó nada");
  });

  test("vencido, cancelado o inventado: 409/404 y no hace nada", async () => {
    understands({ intent: "sell", customer: "juan", product: "disney", pay: "efectivo" });
    const r = await say("vendele disney a juan efectivo");
    shift = 11 * MIN;
    try { assert.equal((await call("POST", `/api/admin/command/${r.json.plan.id}/confirm`, {})).status, 409); } finally { shift = 0; }
    const r2 = await say("vendele disney a juan efectivo");
    assert.equal((await call("POST", `/api/admin/command/${r2.json.plan.id}/cancel`, {})).status, 200);
    assert.equal((await call("POST", `/api/admin/command/${r2.json.plan.id}/confirm`, {})).status, 404, "cancelar lo borra");
    assert.equal((await call("POST", "/api/admin/command/ord_inventado/confirm", {})).status, 404);
    assert.equal(asg(ids.juan).filter((a) => a.productId === "disney").length, 0);
  });

  test("renovar: muestra hasta cuándo y cuánto; confirmar extiende con el núcleo", async () => {
    understands({ intent: "renew", customer: "juan", months: 1, pay: "efectivo" });
    const exp0 = app.store.engine.s.assignments[ids.juanNf].customerExpiresAt;
    const r = await say("renova a juan un mes, efectivo");
    assert.equal(r.json.kind, "plan");
    assert.match(r.json.plan.lines.join("\n"), /queda hasta el \d\d\/\d\d/);
    assert.match(r.json.plan.lines.join("\n"), /Bs 35/);
    assert.equal(app.store.engine.s.assignments[ids.juanNf].customerExpiresAt, exp0, "no cambió nada todavía");
    const c = await call("POST", `/api/admin/command/${r.json.plan.id}/confirm`, {});
    assert.equal(c.status, 200);
    assert.equal(app.store.engine.s.assignments[ids.juanNf].customerExpiresAt, exp0 + 30 * DAY);
    assert.equal(audit().filter((x) => x.action === "assistant.command").at(-1).data.intent, "renew");
    assert.ok(audit().some((x) => x.action === "renewal.create" && x.data.assignmentId === ids.juanNf));
  });

  test("pasar a otro cliente: mismo perfil y fecha; confirmar usa transferAssignment", async () => {
    understands({ intent: "transfer", customer: "rodrigo", product: "netflix", to_customer: "juan perez" });
    const r = await say("pasale el netflix de rodrigo a juan perez");
    assert.equal(r.json.kind, "plan");
    assert.match(r.json.text, /de Rodrigo Paz a Juan Pérez/);
    assert.equal(app.store.engine.s.assignments[ids.rodNf].customerId, ids.rodrigo);
    assert.equal((await call("POST", `/api/admin/command/${r.json.plan.id}/confirm`, {})).status, 200);
    assert.equal(app.store.engine.s.assignments[ids.rodNf].customerId, ids.juan);
    assert.ok(audit().some((x) => x.action === "assignment.transfer" && x.entityId === ids.rodNf));
    assert.equal((await call("GET", "/api/admin/office")).json.agents.find((a) => a.id === "commands").last.text, "Pasé Netflix de Rodrigo a Juan por orden tuya.");
  });

  test("dudas: con 2 Ana pregunta y elegir completa la orden; sin forma de pago, pregunta", async () => {
    understands({ intent: "sell", customer: "ana", product: "disney", pay: "qr" });
    const r = await say("vendele un disney a ana me pago por qr");
    assert.equal(r.json.kind, "choose");
    assert.equal(r.json.text, "Tengo 2 Ana: ¿Ana Quispe o Ana Rojas?");
    assert.equal(r.json.choices.length, 2);
    assert.equal((await call("POST", "/api/admin/command", { draft: r.json.draft, pick: ids.juan })).status, 400, "solo las opciones ofrecidas");
    const rojas = r.json.choices.find((c) => /Rojas/.test(c.label));
    const p = await call("POST", "/api/admin/command", { draft: r.json.draft, pick: rojas.value, label: rojas.label });
    assert.equal(p.json.kind, "plan");
    assert.match(p.json.plan.lines.join("\n"), /Ana Rojas/);
    assert.equal((await call("POST", "/api/admin/command", { draft: r.json.draft, pick: rojas.value })).status, 404, "la pregunta se usa una vez");
    await call("POST", `/api/admin/command/${p.json.plan.id}/cancel`, {});
    // Falta la forma de pago.
    understands({ intent: "sell", customer: "ana rojas", product: "disney" });
    const q = await say("vendele un disney a ana rojas");
    assert.equal(q.json.kind, "choose");
    assert.match(q.json.text, /¿Cómo te pagó Ana/);
    assert.deepEqual(q.json.choices.map((c) => c.value), ["qr", "efectivo", "fiado"], "sin saldo suficiente no ofrece saldo");
    const p2 = await call("POST", "/api/admin/command", { draft: q.json.draft, pick: "fiado" });
    assert.match(p2.json.plan.lines.join("\n"), /Fiado/);
    assert.equal((await call("POST", `/api/admin/command/${p2.json.plan.id}/confirm`, {})).status, 200);
    const a = asg(ids.anaR)[0];
    assert.equal(a.control.payStatus, "pendiente", "fiado: queda Pendiente en el Control (como en Vender)");
    assert.ok((await call("GET", "/api/admin/fiado")).json.rows.some((x) => x.customerId === ids.anaR), "y aparece en Fiado");
  });

  test("nada sensible fue a Claude en toda la charla", () => {
    assert.ok(bodies.length >= 10);
    for (const b of bodies) for (const s of SECRETS) assert.ok(!b.includes(s), `no manda "${s}" a Claude`);
    // La charla de contexto va con las últimas 6 líneas como mucho.
    const last = JSON.parse(bodies.at(-1)).messages[0].content;
    const hist = last.split("Charla reciente:\n")[1]?.split("\n\n")[0].split("\n") ?? [];
    assert.ok(hist.length <= 6);
  });

  test("permisos: Atención no; clientes no; admin sí, con lo que permite su rol", async () => {
    assert.equal((await say("quien me debe", lucia)).status, 403);
    assert.equal((await call("POST", "/api/admin/command/x/confirm", {}, lucia)).status, 403);
    assert.ok([401, 403].includes((await say("quien me debe", anaCk)).status));
    assert.equal((await say("quien me debe", null)).status, 401);
    understands({ intent: "codes", customer: "juan", product: "netflix" });
    const c = await say("codigo de juan", ada);
    assert.equal(c.status, 200);
    assert.match(c.json.text, /solo el dueño/, "los códigos son del dueño (codes.configure)");
    understands({ intent: "sell", customer: "juan", product: "disney", pay: "efectivo" });
    const p = await say("vendele disney a juan", ada);
    assert.equal(p.json.kind, "plan");
    const ok = await call("POST", `/api/admin/command/${p.json.plan.id}/confirm`, {}, ada);
    assert.equal(ok.status, 200);
    const adaId = Object.values(app.store.engine.s.staff).find((u) => u.username === "ada").id;
    assert.equal(audit().filter((x) => x.action === "assistant.command").at(-1).actorId, adaId);
    assert.equal(audit().filter((x) => x.action === "assistant.command").at(-1).role, "admin", "lo hizo el admin, con sus permisos");
  });

  test("límites: tope de gasto del mes y 60 órdenes por hora", async () => {
    await call("POST", "/api/admin/ai", { monthlyLimitUsd: 0 });
    const n = bodies.length;
    const r = await say("quien me debe");
    assert.equal(r.status, 409);
    assert.equal(r.json.error, "AI_LIMIT");
    assert.match(r.json.message, /tope/);
    assert.equal(bodies.length, n, "no llamó a Claude");
    await call("POST", "/api/admin/ai", { monthlyLimitUsd: 20 });
    understands({ intent: "owes" });
    for (let i = 0; i < 60; i++) assert.equal((await say("quien me debe", beto)).status, 200);
    const t = await say("quien me debe", beto);
    assert.equal(t.status, 429);
    assert.match(t.json.message, /60 por hora/);
  });

  test("navegador a 360 px: la caja en Inicio, una charla con plan y confirmación; Sofi en Mi oficina", { skip: !chromium }, async () => {
    const b = await chromium.launch();
    try {
      for (const scheme of ["light", "dark"]) {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme });
        await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        const [name, value] = owner.split("=");
        await ctx.addCookies([{ name, value, url: base }]);
        await p.addInitScript((th) => { try { localStorage.setItem("gs-panel-theme", th); } catch { /* */ } }, scheme);
        await p.goto(base + "/panel.html#inicio");
        await p.waitForSelector("#ocForm");
        understands({ intent: "sell", customer: "juan", product: "disney", pay: "qr" });
        await p.fill("#ocText", "vendele un disney a juan, me pagó por qr");
        await p.click("#ocForm button[type=submit]");
        await p.waitForSelector("[data-occonfirm]", { timeout: 8000 }).catch(async (e) => { throw new Error(`${e.message}\n${await p.textContent("#ocCard").catch(() => "")}\n${errs.join("\n")}`); });
        const measure = () => p.evaluate(() => {
          const root = document.getElementById("ocCard");
          return {
            over: document.documentElement.scrollWidth > innerWidth + 1,
            small: [...root.querySelectorAll("button, a.pbtn")].filter((x) => { const r = x.getBoundingClientRect(); return r.width && r.height < 44; }).map((x) => x.textContent.trim()),
            tiny: [...root.querySelectorAll("*")].filter((x) => [...x.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 12).map((x) => x.className),
            wide: [...root.querySelectorAll("*")].filter((x) => x.getBoundingClientRect().right > innerWidth + 1).length,
          };
        });
        let m = await measure();
        assert.equal(m.over, false, `${scheme}: sin desborde`);
        assert.equal(m.wide, 0, `${scheme}: nada se sale de la pantalla`);
        assert.deepEqual(m.small, [], `${scheme}: botones de 44 px`);
        assert.deepEqual(m.tiny, [], `${scheme}: letra de 12 px o más`);
        assert.match(await p.textContent(".oc-plan"), /Voy a hacer esto/);
        assert.match(await p.textContent(".oc-plan"), /\d\d\/\d\d/, "fechas dd/mm");
        await p.click("[data-occonfirm]");
        await p.waitForSelector(".oc-ok");
        await p.waitForSelector('.oc-plan a[href^="https://wa.me/"]');
        m = await measure();
        assert.equal(m.over, false);
        assert.deepEqual(m.small, []);
        await p.goto(base + "/panel.html#oficina");
        await p.reload();
        await p.waitForSelector(".of-desk");
        assert.equal(await p.locator(".of-desk").count(), 7);
        assert.match(await p.textContent('[data-ofsel="commands"]'), /Sofi/);
        const of = await p.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1 }));
        assert.equal(of.over, false);
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    } finally { await b.close(); }
  });
});
