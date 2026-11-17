// 🤵 Mi secretaria y 📈 Cómo van del revendedor en GaboHub (17/11/2026).
//  - Mensajes del día (cobrar, avisar, ya renovaron) con la plantilla de fábrica y con la suya ({nombre}, {servicio},
//    {fecha}, {monto}, {link}); «💬 Mandar» abre wa.me con ese texto (nunca se manda nada solo).
//  - Cómo van con números conocidos: este mes contra el mes pasado, % solo si la base es de Bs 30 o más.
//  - Separación: otro revendedor nunca aparece. Plan vencido: 402 como Mis ganancias.
//  - Celular (360 px), claro y oscuro, botones de 44 px, sin desborde ni errores.
// Datos ficticios en una carpeta temporal; WhatsApp bloqueado en el navegador.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";
import { fillTemplate } from "../dist/store/hubSecretaria.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const at = (m, d) => Date.UTC(2026, m - 1, d, 15); // 11:00 en Bolivia

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-hubsec-"));
  const clock = { t: at(10, 10), now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller" }); s.catalog.setResellerTrust(owner, c.id, "independent"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Secretaria", "+59171234567"), beto = mk("Beto Ajeno", "+59172345678");
  const p = s.own.saveProduct(ana.A, { name: "Flujo TV", emoji: "📡", durationDays: 30, price: 3000, kind: "profiles", slots: 5 });
  const acc = s.own.saveAccount(ana.A, { productId: p.id, user: "flujo.uno", password: "Clave-1234", slots: 5, providerExpiresAt: at(12, 30) });
  // Octubre: Carla y Mario, pagados.
  const carla = s.own.assign(ana.A, { accountId: acc.id, name: "Carla Rojas", phone: "70011111", price: 3000, pay: "pagado" });
  const mario = s.own.assign(ana.A, { accountId: acc.id, name: "Mario Soto", phone: "70022222", price: 2000, pay: "pagado" });
  // El otro revendedor: un cliente que Ana nunca debe ver.
  const pX = s.own.saveProduct(beto.A, { name: "Secreto IPTV", emoji: "🔒", durationDays: 30, price: 1000, kind: "line" });
  const aX = s.own.saveAccount(beto.A, { productId: pX.id, user: "secreto", password: "Clave-1234" });
  s.own.assign(beto.A, { accountId: aX.id, name: "Cliente Ajeno", phone: "70099999", price: 1000, pay: "pendiente" });
  // Noviembre: Lucía (pagó) y Pedro (vence el 19/11, debe, con link de cobro). Mario venció el 02/11 y no volvió.
  clock.t = at(11, 5);
  s.own.assign(ana.A, { accountId: acc.id, name: "Lucía Paz", phone: "70033333", price: 2500, pay: "pagado" });
  const pedro = s.own.assign(ana.A, { accountId: acc.id, name: "Pedro Gil", phone: "70044444", price: 1500, pay: "pendiente" });
  s.own.updateSale(ana.A, pedro.id, { expiresAt: at(11, 19) });
  s.own.updateSale(ana.A, mario.id, { expiresAt: at(11, 2) });
  const { token } = s.own.link(ana.A, pedro.id);
  // Carla renueva el 16/11 y paga.
  clock.t = at(11, 16);
  s.own.renew(ana.A, carla.id, true);
  clock.t = at(11, 17);

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const req = async (method, p2, ck, body) => { const r = await fetch(base + p2, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null), raw: r }; };
  const ock = (await req("POST", "/api/auth/staff/login", null, { username: "gabriel", password: "clave-del-dueño-123" })).raw.headers.get("set-cookie").split(";")[0];
  const login = async (c) => { const { pin } = (await req("POST", `/api/admin/customers/${c.id}/login-pin`, ock, {})).json; return (await req("POST", "/api/auth/customer/pin", null, { phone: c.phone, pin })).raw.headers.get("set-cookie").split(";")[0]; };
  const ckA = await login(ana.c), ckB = await login(beto.c);
  return { dir, app, s, owner, clock, ana, beto, base, req, ckA, ckB, token, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("plantilla: llena los campos y saca la línea del link o del monto si faltan", () => {
  const v = { nombre: "Ana", servicio: "Netflix", fecha: "19/11", monto: "Bs 15", link: "" };
  assert.equal(fillTemplate("Hola {nombre}: {servicio} el {fecha} ({monto})\nPagá 👉 {link}", v), "Hola Ana: Netflix el 19/11 (Bs 15)");
  assert.equal(fillTemplate("{nombre}\nDebés {monto}", { ...v, monto: "" }), "Ana");
});

test("Mi secretaria y Cómo van: mensajes del día, plantilla propia, números conocidos, separación y plan vencido", async () => {
  const t = await setup();
  const { req, ckA, ckB, base, token } = t;
  try {
    let r = await req("GET", "/api/me/secretaria", ckA);
    assert.equal(r.status, 200);
    let S = r.json;
    assert.deepEqual(S.counts, { cobrar: 1, avisar: 1, renovo: 1 });
    assert.equal(S.avisar[0].name, "Pedro Gil");
    assert.equal(S.avisar[0].text, `Hola Pedro 👋 tu Flujo TV vence el 19/11.\nLa renovación es Bs 15. ¿Lo renovamos? 🙌\nPagás acá 👉 ${base}/c/${token}`);
    assert.equal(S.cobrar[0].name, "Mario Soto");
    assert.match(S.cobrar[0].text, /^Hola Mario 👋 tu Flujo TV venció el 02\/11\./);
    assert.doesNotMatch(S.cobrar[0].text, /Pagás acá/, "sin link: la línea no va");
    assert.equal(S.renovo[0].name, "Carla Rojas");
    assert.equal(S.renovo[0].text, "Hola Carla 👋 ¡listo! Tu Flujo TV quedó renovado hasta el 09/12. ¡Gracias por confiar! 🙌");
    assert.doesNotMatch(JSON.stringify(S), /Ajeno|Secreto|70099999/, "nada del otro revendedor");

    // Plantilla propia: se guarda, se usa y no le cambia nada a Beto.
    r = await req("PUT", "/api/me/secretaria/plantilla", ckA, { kind: "avisar", text: "{nombre}: tu {servicio} vence el {fecha} ({monto}).\n{link}" });
    assert.equal(r.status, 200); assert.equal(r.json.custom, true);
    S = (await req("GET", "/api/me/secretaria", ckA)).json;
    assert.equal(S.avisar[0].text, `Pedro: tu Flujo TV vence el 19/11 (Bs 15).\n${base}/c/${token}`);
    assert.deepEqual(S.custom, ["avisar"]);
    r = await req("PUT", "/api/me/secretaria/plantilla", ckA, { kind: "avisar", text: "Hola {precio}" });
    assert.equal(r.status, 400); assert.match(r.json.message, /\{precio\}/);
    r = await req("PUT", "/api/me/secretaria/plantilla", ckA, { kind: "otro", text: "x" });
    assert.equal(r.status, 400);
    const SB = (await req("GET", "/api/me/secretaria", ckB)).json;
    assert.deepEqual(SB.custom, [], "la plantilla de Ana es solo de Ana");
    assert.doesNotMatch(JSON.stringify(SB), /Carla|Mario|Lucía|Pedro/);
    assert.deepEqual(SB.cobrar.map((m) => m.name), ["Cliente Ajeno"], "Beto ve solo a su cliente (venció el 09/11 y debe)");

    // Cómo van: noviembre (al 17) contra octubre completo.
    r = await req("GET", "/api/me/como-van", ckA);
    assert.equal(r.status, 200);
    const C = r.json;
    assert.deepEqual([C.month.paid, C.month.propias, C.month.nuevos, C.month.renovaron, C.month.fueron], [5500, 5500, 2, 1, 1]);
    assert.deepEqual([C.prev.paid, C.prev.nuevos, C.prev.renovaron, C.prev.fueron], [5000, 2, 0, 0]);
    assert.equal(C.change.paidPct, 10, "base de Bs 50: con %");
    const CB = (await req("GET", "/api/me/como-van", ckB)).json;
    assert.equal(CB.prev.nuevos, 1); assert.equal(CB.month.paid, 0);
    assert.equal(CB.change.paidPct, null, "base menor a Bs 30: sin %");

    // Un cliente común no entra.
    const cli = t.s.catalog.createCustomer(t.owner, { name: "Cliente Común", phone: "+59175555555" });
    const { pin } = (await req("POST", `/api/admin/customers/${cli.id}/login-pin`, (await req("POST", "/api/auth/staff/login", null, { username: "gabriel", password: "clave-del-dueño-123" })).raw.headers.get("set-cookie").split(";")[0], {})).json;
    const ckC = (await req("POST", "/api/auth/customer/pin", null, { phone: cli.phone, pin })).raw.headers.get("set-cookie").split(";")[0];
    assert.equal((await req("GET", "/api/me/secretaria", ckC)).status, 403);
    assert.equal((await req("GET", "/api/me/como-van", ckC)).status, 403);

    // Pantallas (celular, claro y oscuro).
    if (chromium) {
      const shots = "/tmp/capturas-secretaria"; mkdirSync(shots, { recursive: true });
      const b = await chromium.launch();
      try {
        for (const colorScheme of ["light", "dark"]) {
          const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, colorScheme });
          await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (x) => x.abort());
          await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* */ } }, t.ana.c.id);
          const [n, v] = ckA.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
          const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
          const open = async (k) => { await page.goto(base + "/hub#mas"); await page.locator(`.hubarea-i[data-rtool="${k}"]`).click(); await page.waitForFunction((x) => document.querySelector(`[data-rtab="${x}"]`)?.getAttribute("aria-selected") === "true", k); };
          const check = (sel) => page.evaluate((q) => ({ over: document.documentElement.scrollWidth > document.documentElement.clientWidth, small: [...document.querySelectorAll(q)].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 44).map((x) => x.textContent.trim().slice(0, 30)) }), sel);

          await open("secretaria");
          await page.locator("#hsec-avisar .hsec-m").waitFor();
          const href = await page.locator('#hsec-avisar [data-hsecwa]').getAttribute("href");
          assert.equal(href, `https://wa.me/59170044444?text=${encodeURIComponent(S.avisar[0].text)}`, "wa.me con el texto de su plantilla");
          assert.match(await page.locator("#hsec-renovo").innerText(), /Carla Rojas[\s\S]*09\/12/);
          assert.doesNotMatch(await page.locator("#sout").innerText(), /Ajeno/);
          assert.deepEqual(await check(".hsec-a .sbtn, [data-hsecprecios]"), { over: false, small: [] });
          await page.screenshot({ path: `${shots}/secretaria-360-${colorScheme}.png`, fullPage: true });
          if (colorScheme === "light") {
            // Editar la plantilla desde la pantalla: error junto al campo, después se guarda y el mensaje cambia.
            await page.locator(".hsec-tpl summary").click();
            const f = page.locator('form[data-hsectpl="renovo"]');
            await f.locator("textarea").fill("Hola {cliente}");
            await f.locator('[type="submit"]').click();
            await f.locator(".hsec-err").waitFor();
            assert.match(await f.locator(".hsec-err").innerText(), /\{cliente\}/);
            await f.locator("textarea").fill("¡Gracias {nombre}! {servicio} hasta el {fecha}.");
            await f.locator('[type="submit"]').click();
            await page.waitForFunction(() => /Gracias Carla! Flujo TV hasta el 09\/12/.test(document.querySelector("#hsec-renovo")?.innerText ?? ""));
          }

          await open("comovan");
          await page.locator(".hcv-kpis").waitFor();
          const cv = await page.locator(".hcv").innerText();
          assert.match(cv, /Bs 55/); assert.match(cv, /\+10 %/); assert.match(cv, /Mes pasado: Bs 50/);
          assert.deepEqual(await check(".hcv .sbtn"), { over: false, small: [] });
          await page.screenshot({ path: `${shots}/comovan-360-${colorScheme}.png`, fullPage: true });

          // Más: los tres accesos están y «Mis precios de venta» lleva a la lista de precios.
          await page.goto(base + "/hub#mas");
          await page.locator('.hubarea-i[data-hsecprecios]').click();
          await page.waitForFunction(() => document.querySelector('[data-rtab="ventas"]')?.getAttribute("aria-selected") === "true");
          assert.deepEqual(errs, []);
          await ctx.close();
        }
      } finally { await b.close(); }
    }

    // Plan vencido (cobro para todos, sin pagar): igual que Mis ganancias, 402.
    t.s.catalog.updateSettings(t.owner, { shopRent: { enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", trialDays: 0, sellerPrice: 2800 } });
    t.s.shops.chargeRents({ id: "system:prueba", role: "system" }); t.clock.t += 4 * DAY; t.s.shops.chargeRents({ id: "system:prueba", role: "system" });
    for (const p of ["/api/me/secretaria", "/api/me/como-van", "/api/me/earnings"]) {
      r = await req("GET", p, ckA);
      assert.equal(r.status, 402, p); assert.equal(r.json.error, "HUB_UNPAID", p);
    }
    r = await req("PUT", "/api/me/secretaria/plantilla", ckA, { kind: "avisar", text: "" });
    assert.equal(r.status, 402);
  } finally { await t.close(); }
});
