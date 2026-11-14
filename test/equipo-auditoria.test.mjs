// Auditoría del dueño (revisión de seguridad del equipo, 14/11/2026): filtros por persona y por período
// (Hoy / Ayer / 7 días / Todo) en el servidor y en pantalla, que se mezclan con Plata / Accesos / Precios; y los
// ingresos y fallos del EQUIPO (access_log) dentro de la Auditoría con la etiqueta «🔑 Accesos».
// También Usuarios: el rol se llama «Atención» en todo el panel y cada usuario muestra «2 pasos ✅/❌».
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { auditRange } from "../dist/server/teamSecurity.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

const DAY = 86_400_000, HOUR = 3_600_000;
const T0 = Date.UTC(2026, 10, 14, 15, 0); // sábado 14/11 a las 11:00 en Bolivia

test("períodos de la Auditoría: los días se cortan a la hora de Bolivia", () => {
  const boMidnight = Date.UTC(2026, 10, 14, 4, 0); // 14/11 00:00 en Bolivia
  assert.deepEqual(auditRange("hoy", T0), { from: boMidnight });
  assert.deepEqual(auditRange("ayer", T0), { from: boMidnight - DAY, to: boMidnight });
  assert.deepEqual(auditRange("7d", T0), { from: boMidnight - 6 * DAY });
  assert.deepEqual(auditRange("todo", T0), {});
  assert.deepEqual(auditRange(null, T0), {});
  // 23:30 del 13/11 en Bolivia todavía es «ayer» para el 14/11 aunque en UTC ya sea 14/11.
  assert.equal(auditRange("hoy", Date.UTC(2026, 10, 14, 3, 30)).from, boMidnight - DAY);
});

describe("Auditoría: persona, período e ingresos del equipo", () => {
  let app, base, dir, ock, lucia, pedro;
  const clock = { t: T0 - DAY, now() { return this.t; } };
  const call = async (method, p, body, ck) => {
    const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
    const t = await r.text(); let json; try { json = JSON.parse(t); } catch { json = t; }
    return { status: r.status, json, ck: r.headers.get("set-cookie")?.split(";")[0] };
  };
  const login = async (username, password) => (await call("POST", "/api/auth/staff/login", { username, password })).ck;

  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-equipoB-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ock = await login("gabriel", "clave-del-dueño-123");
    lucia = (await call("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "admin", password: "clave-de-lucia-123" }, ock)).json;
    pedro = (await call("POST", "/api/admin/staff", { username: "pedro", name: "Pedro", role: "seller", password: "clave-de-pedro-123" }, ock)).json;
    // Ayer: Lucía entra y carga una clienta.
    const lck = await login("lucia", "clave-de-lucia-123");
    assert.equal((await call("POST", "/api/admin/customers", { name: "Clienta de ayer", phone: "+59170000011" }, lck)).status, 200);
    // Hoy: Pedro se equivoca una vez, entra y carga un cliente.
    clock.t = T0;
    await call("POST", "/api/auth/staff/login", { username: "pedro", password: "mala-clave" });
    const pck = await login("pedro", "clave-de-pedro-123");
    assert.equal((await call("POST", "/api/admin/customers", { name: "Cliente de hoy", phone: "+59170000022" }, pck)).status, 200);
    ock = await login("gabriel", "clave-del-dueño-123");
  });
  after(async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); });

  const audit = async (q) => (await call("GET", `/api/admin/audit?${q}`, null, ock)).json;

  test("por persona: solo lo de esa persona", async () => {
    const p = await audit(`who=${pedro.id}`);
    assert.ok(p.length > 0);
    assert.ok(p.every((a) => a.actorId === pedro.id));
    assert.ok(p.some((a) => a.action === "customer.create"));
    const l = await audit(`who=${lucia.id}`);
    assert.ok(l.every((a) => a.actorId === lucia.id) && l.some((a) => a.action === "customer.create"));
  });

  test("por período: Hoy / Ayer / 7 días / Todo", async () => {
    const hoy = await audit("period=hoy"), ayer = await audit("period=ayer"), semana = await audit("period=7d"), todo = await audit("period=todo");
    const from = Date.UTC(2026, 10, 14, 4, 0);
    assert.ok(hoy.length && hoy.every((a) => a.at >= from));
    assert.ok(ayer.length && ayer.every((a) => a.at >= from - DAY && a.at < from));
    assert.ok(hoy.some((a) => a.actorId === pedro.id) && !hoy.some((a) => a.actorId === lucia.id), "Lucía trabajó ayer, no hoy");
    assert.ok(ayer.some((a) => a.actorId === lucia.id && a.action === "customer.create"));
    assert.equal(semana.length, todo.length, "todo pasó dentro de los últimos 7 días");
    // Se mezclan: persona + período.
    assert.deepEqual(await audit(`who=${lucia.id}&period=hoy`), []);
  });

  test("los ingresos y fallos del equipo entran a la Auditoría (solo si se piden) y respetan los filtros", async () => {
    const sin = await audit("period=hoy");
    assert.ok(!sin.some((a) => a.action.startsWith("access.")), "sin access=1 la respuesta queda como antes");
    const con = await audit("period=hoy&access=1");
    const fail = con.find((a) => a.action === "access.login_fail" && a.actorId === pedro.id);
    assert.ok(fail, "el fallo de Pedro aparece");
    assert.equal(fail.role, "seller");
    assert.equal(fail.data.ok, false);
    assert.ok(con.some((a) => a.action === "access.login" && a.actorId === pedro.id));
    for (let i = 1; i < con.length; i++) assert.ok(con[i - 1].at >= con[i].at, "en orden, lo más nuevo primero");
    const soloLucia = await audit(`who=${lucia.id}&access=1`);
    assert.ok(soloLucia.some((a) => a.action === "access.login") && soloLucia.every((a) => a.actorId === lucia.id));
    assert.ok(!(await audit(`period=ayer&access=1`)).some((a) => a.actorId === pedro.id), "Pedro no entró ayer");
    assert.ok(!JSON.stringify(con).includes("127.0.0.1"), "la Auditoría no muestra la IP completa");
  });

  test("Usuarios: «2 pasos» de cada uno; solo el dueño ve la Auditoría", async () => {
    const staff = (await call("GET", "/api/admin/staff", null, ock)).json;
    assert.ok(staff.every((u) => u.twoFactor === false));
    assert.ok(!JSON.stringify(staff).includes("passwordHash"));
    const lck = await login("lucia", "clave-de-lucia-123");
    assert.equal((await call("GET", "/api/admin/audit?access=1", null, lck)).status, 403);
    assert.equal((await call("GET", "/api/admin/staff", null, lck)).status, 403);
  });

  test("en el celular (360 px): filtros de la Auditoría, «Atención» y «2 pasos» en Usuarios", { skip: !chromium && "sin Playwright", timeout: 120_000 }, async () => {
    const b = await chromium.launch();
    try {
      for (const scheme of ["light", "dark"]) {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme });
        const [n, v] = ock.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("dialog", (d) => d.accept());
        await p.goto(base + "/panel#auditoria");
        const sel = p.locator('select[data-tabsel="audw"]');
        await sel.waitFor();
        assert.match(await sel.innerText(), /Pedro \(Atención\)/);
        await sel.selectOption(pedro.id);
        await p.locator('[data-tab="audp:hoy"]').click();
        await p.locator('[data-tab="audp:hoy"][aria-selected="true"]').waitFor();
        await p.locator('[data-tab="audf:accesos"]').click();
        await p.locator('[data-tab="audf:accesos"][aria-selected="true"]').waitFor();
        const txt = (await p.locator(".audrow").allInnerTexts()).join("\n");
        assert.match(txt, /Pedro \(atención\) ⛔ falló al entrar/);
        assert.match(txt, /Pedro \(atención\) 🔑 entró al panel/);
        assert.doesNotMatch(txt, /Lucía/);
        assert.equal(await p.locator('select[data-tabsel="audw"]').inputValue(), pedro.id, "la persona elegida queda marcada");
        const selH = await sel.evaluate((e) => e.getBoundingClientRect().height);
        assert.ok(selH >= 44, `la lista de personas mide ${selH} px`);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "sin desborde a 360 px");
        await p.screenshot({ path: join(dir, `auditoria-360-${scheme}.png`), fullPage: true });

        await p.goto("about:blank");
        await p.goto(base + "/panel#usuarios");
        await p.locator("text=No puede:").waitFor();
        const u = await p.locator("main").innerText();
        assert.match(u, /Atención: vende, renueva y carga clientes/);
        assert.doesNotMatch(u, /Vendedor/);
        assert.match(u, /2 pasos ❌/);
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth), false, "Usuarios sin desborde a 360 px");
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    } finally { await b.close(); }
  });
});
