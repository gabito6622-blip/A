// 📒 Mis hojas del revendedor en GaboHub (17/11/2026): sus clientes (tienda, cuentas propias y perfiles repartidos)
// como en el Excel, también sin internet. Cubre: separación entre dos revendedores, sin contraseñas ni costos en la
// copia, cambios con llave (no se renueva dos veces), choque (409) y plan vencido. Con navegador: pestaña, copia sin
// contraseñas, anotar sin internet, subirlo al volver y abrir GaboHub sin señal. Datos ficticios; nada se manda.
// Con HH_SHOTS=<carpeta> guarda capturas (fuera del repositorio).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const PASS = ["Clave-Larga#1", "Clave-Larga#2", "Clave-Propia-1234", "Clave-Ajena-9876"];

function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-hubhojas-"));
  const clock = { t: Date.now(), now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500, "dis-alq": 7000 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@ficticio.lat", password: PASS[0], supplierExpiresAt: clock.t + 90 * DAY, cost: 1000, profiles: [1, 2, 3].map((i) => ({ label: `P${i}` })) });
  s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "andes", email: "alq@ficticio.lat", password: PASS[1], supplierExpiresAt: clock.t + 90 * DAY, cost: 5000, profiles: [{ label: "Cuenta completa" }] });
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" }); s.wallet.adjust(owner, c.id, 50000, "carga de prueba"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Hojas", "+59171234567"), beto = mk("Beto Otro", "+59172345678");
  const id = (x) => x.id ?? x.product?.id ?? x.account?.id;
  // Ana: Rosa con Netflix de la tienda, Carla en una cuenta propia y Lucía en un perfil de su Disney alquilado.
  const rosa = s.catalog.createCustomer(ana.A, { name: "Rosa Quispe", phone: "+59160000001" });
  const tAsg = s.orders.create(ana.A, { customerId: rosa.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance", idempotencyKey: "nf1" }).assignmentIds[0];
  const pFl = s.own.saveProduct(ana.A, { name: "Flujo TV", emoji: "📡", durationDays: 30, price: 3000, kind: "profiles", slots: 3 });
  const acc = s.own.saveAccount(ana.A, { productId: id(pFl), user: "flujo.uno", password: PASS[2], slots: 3 });
  const carla = s.own.assign(ana.A, { accountId: id(acc), name: "Carla Rojas", phone: "70011111", price: 3000, pay: "pendiente" });
  const aid = s.orders.create(ana.A, { customerId: ana.c.id, items: [{ productId: "dis-alq", qty: 1 }], paymentMethod: "balance", idempotencyKey: "alq" }).assignmentIds[0];
  const lucia = s.subs.save(ana.A, aid, { name: "Lucía Paz", phone: "+59160000003", expiresAt: clock.t + 5 * DAY, price: 1500, pay: "pagado" }).sub;
  // Beto: un cliente con cuenta propia que Ana nunca debe ver.
  const pX = s.own.saveProduct(beto.A, { name: "Secreto IPTV", emoji: "🔒", durationDays: 30, price: 1000, kind: "line", slots: 1 });
  const aX = s.own.saveAccount(beto.A, { productId: id(pX), user: "secreto", password: PASS[3], slots: 1 });
  const ajeno = s.own.assign(beto.A, { accountId: id(aX), name: "Cliente Ajeno", phone: "70099999", price: 1000, pay: "pendiente" });
  return { dir, app, s, owner, clock, ana, beto, tAsg, carlaId: id(carla), aid, luciaId: lucia.id, ajenoId: id(ajeno), close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
async function http(t) {
  const base = `http://127.0.0.1:${await t.app.listen(0, "127.0.0.1")}`;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
  const login = async (r) => { const { pin } = await (await post(`/api/admin/customers/${r.c.id}/login-pin`, {}, ock)).json(); return (await post("/api/auth/customer/pin", { phone: r.c.phone, pin })).headers.get("set-cookie").split(";")[0]; };
  return { base, post, ock, login, get: (p, ck) => fetch(base + p, { headers: { cookie: ck } }) };
}

test("hojas del revendedor: solo lo suyo, sin contraseñas ni costos, cambios con llave y choques", async () => {
  const t = setup();
  try {
    const h = await http(t);
    const ack = await h.login(t.ana), bck = await h.login(t.beto);
    const r = await h.get("/api/me/hojas", ack);
    assert.equal(r.status, 200);
    const raw = await r.text(), d = JSON.parse(raw);
    // Las tres clases de clientes, nada de Beto ni de otra persona.
    assert.deepEqual(d.rows.map((x) => `${x.k}:${x.cn}`).sort(), ["o:Carla Rojas", "s:Lucía Paz", "t:Rosa Quispe"]);
    assert.doesNotMatch(raw, /Ajeno|secreto/);
    // Sin contraseñas, sin costos de la tienda ni ganancias.
    for (const p of PASS) assert.ok(!raw.includes(p), "sin contraseñas");
    assert.doesNotMatch(raw, /"(password|cost|profit|ganancia|supplier\w*)"/i);
    const rosa = d.rows.find((x) => x.k === "t"), carla = d.rows.find((x) => x.k === "o"), lucia = d.rows.find((x) => x.k === "s");
    assert.equal(rosa.e, "nf@ficticio.lat"); assert.equal(carla.e, "flujo.uno"); assert.equal(lucia.m, 1500);
    // Beto ve solo lo suyo.
    const db = await (await h.get("/api/me/hojas", bck)).json();
    assert.deepEqual(db.rows.map((x) => x.cn), ["Cliente Ajeno"]);
    // Sin sesión o con sesión del dueño: no.
    assert.equal((await fetch(h.base + "/api/me/hojas")).status, 401);

    // Cruzado: Beto no puede tocar filas de Ana (ni la tienda, ni propia, ni perfil).
    for (const row of [rosa.id, carla.id, lucia.id]) {
      const x = await h.post("/api/me/hojas/op", { k: "x-" + row, row, t: "note", v: "hackeo", base: {} }, bck);
      assert.equal(x.status, 404, row);
    }
    assert.equal(t.s.engine.s.assignments[t.tAsg].rcontrol?.note, undefined);

    // Nota y «Me pagó» en la de la tienda (lo mismo que Mi control); la fecha de la tienda no se toca.
    let x = await h.post("/api/me/hojas/op", { k: "n1", row: rosa.id, t: "note", v: "paga los 5", base: { x: rosa.x, n: "" } }, ack);
    assert.equal(x.status, 200); assert.equal((await x.json()).row.n, "paga los 5");
    x = await h.post("/api/me/hojas/op", { k: "d1", row: rosa.id, t: "date", v: t.clock.t + 40 * DAY, base: { x: rosa.x } }, ack);
    assert.equal(x.status, 400);
    assert.match((await x.json()).message, /la cambia la tienda/);

    // Renovó y pagó (cuenta propia) con la misma llave dos veces: suma UN período.
    const before = carla.x;
    const op = { k: "pay-carla", row: carla.id, t: "pay", base: { x: carla.x, pay: carla.pay, n: carla.n } };
    const p1 = await (await h.post("/api/me/hojas/op", op, ack)).json();
    const p2 = await (await h.post("/api/me/hojas/op", op, ack)).json();
    assert.ok(p1.row.x > before + 25 * DAY);
    assert.equal(p2.row.x, p1.row.x, "reintento con la misma llave: no renueva dos veces");
    const sale = t.s.own.view(t.ana.A).sales.find((s) => s.id === t.carlaId);
    assert.equal(sale.expiresAt, p1.row.x);

    // Choque: el celular guardó la fecha vieja; mientras tanto la cambiaron → 409 con qué cambió; con force se guarda.
    x = await h.post("/api/me/hojas/op", { k: "d-viejo", row: carla.id, t: "date", v: t.clock.t + 3 * DAY, base: { x: before } }, ack);
    assert.equal(x.status, 409);
    assert.match((await x.json()).message, /la fecha cambió: ahora vence el \d\d\/\d\d/);
    x = await h.post("/api/me/hojas/op", { k: "d-viejo", row: carla.id, t: "date", v: t.clock.t + 3 * DAY, base: { x: before }, force: true }, ack);
    assert.equal(x.status, 200);
    // Choque de nota en un perfil repartido.
    await h.post("/api/me/hojas/op", { k: "nl1", row: lucia.id, t: "note", v: "primera", base: { n: "" } }, ack);
    x = await h.post("/api/me/hojas/op", { k: "nl2", row: lucia.id, t: "note", v: "segunda", base: { n: "" } }, ack);
    assert.equal(x.status, 409); assert.match((await x.json()).message, /cambió la nota/);
    // Fecha de un perfil: se guarda sin tocar nombre, precio ni pago.
    const nueva = t.clock.t + 12 * DAY;
    x = await (await h.post("/api/me/hojas/op", { k: "dl", row: lucia.id, t: "date", v: nueva, base: { x: lucia.x } }, ack)).json();
    const sub = t.s.subs.list(t.ana.A)[0].subs[0];
    assert.deepEqual([sub.expiresAt, sub.name, sub.price, sub.pay, sub.note], [nueva, "Lucía Paz", 1500, "pagado", "primera"]);
    // Una fila que ya no está (liberada): 404 claro.
    t.s.own.release(t.ana.A, t.carlaId, { debt: "fiado" });
    x = await h.post("/api/me/hojas/op", { k: "tarde", row: carla.id, t: "note", v: "x", base: {} }, ack);
    assert.equal(x.status, 404); assert.match((await x.json()).message, /ya no está/);
  } finally { await t.close(); }
});

test("hojas del revendedor: con la suscripción vencida no se entregan (como Mi control); anotar sigue abierto", async () => {
  const t = setup();
  try {
    const { s, owner, clock } = t;
    const h = await http(t);
    const ack = await h.login(t.ana);
    const row = (await (await h.get("/api/me/hojas", ack)).json()).rows.find((x) => x.k === "o");
    s.catalog.updateSettings(owner, { shopRent: { enabled: true, price: 4900, freeIfSpent: 0, graceDays: 3, scope: "all", priceUsd: 500 } });
    s.wallet.adjust(owner, t.ana.c.id, -s.wallet.balance(t.ana.c.id), "sin saldo (prueba)");
    const sys = { id: "system:prueba", role: "system" };
    s.shops.chargeRents(sys); clock.t += 4 * DAY; s.shops.chargeRents(sys);
    assert.equal(s.shops.hubLocked(t.ana.c.id), true);
    for (const p of ["/api/me/control", "/api/me/hojas"]) {
      const r = await h.get(p, ack);
      assert.equal(r.status, 402, p);
      assert.equal((await r.json()).error, "HUB_UNPAID");
    }
    // Lo anotado sin internet antes de vencer igual se sube (como las rutas que escriben de Mi control).
    const x = await h.post("/api/me/hojas/op", { k: "n-tarde", row: row.id, t: "note", v: "anotado sin señal", base: { n: "" } }, ack);
    assert.equal(x.status, 200);
  } finally { await t.close(); }
});

test("Mis hojas en GaboHub: pestaña, copia sin contraseñas, anotar sin internet y abrir sin señal", { skip: !chromium && "sin navegador", timeout: 240_000 }, async () => {
  const t = setup();
  const shots = process.env.HH_SHOTS; if (shots) mkdirSync(shots, { recursive: true });
  const b = await chromium.launch();
  try {
    const h = await http(t);
    const ack = await h.login(t.ana);
    for (const [w, scheme] of [[360, "light"], [390, "dark"]]) {
      const ctx = await b.newContext({ viewport: { width: w, height: 780 }, isMobile: true, hasTouch: true, colorScheme: scheme });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* sin almacenamiento */ } }, t.ana.c.id);
      const [n, v] = ack.split("="); await ctx.addCookies([{ name: n, value: v, url: h.base }]);
      const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      page.on("dialog", (d) => d.accept());
      await page.goto(h.base + "/hub#inicio");
      await page.locator(".htiles").waitFor();
      // Clientes → Mi negocio → 📒 Mis hojas.
      await page.locator('.bnav [data-s="clientes"]').click();
      await page.locator('[data-rtab="hojas"]').click();
      await page.locator("#hh .hht").waitFor();
      const tabs = await page.locator("#hh .hhtabs button").allInnerTexts();
      assert.deepEqual(tabs.map((x) => x.replace(/\s+/g, " ").trim()).sort(), ["Disney 1", "IPTV 1", "Netflix 1", "💸 Me deben 1"].sort(), tabs.join("|"));
      assert.doesNotMatch(await page.locator("#hh").innerText(), /Ajeno/);
      // La copia del aparato: sin contraseñas ni costos.
      const snap = await page.evaluate(() => localStorage.getItem("gs-hubhojas-v1"));
      for (const p of PASS) assert.ok(!snap.includes(p));
      assert.doesNotMatch(snap, /"cost"|password/);
      // Nada desborda a lo ancho; botones de las pestañas de 44 px.
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), "sin desborde");
      const tabH = await page.locator("#hh .hhtabs button").first().evaluate((x) => x.getBoundingClientRect().height);
      assert.ok(tabH >= 44, `pestaña de ${tabH}px`);
      if (shots) await page.screenshot({ path: join(shots, `hojas-${w}-${scheme}.png`), fullPage: true });
      if (w !== 360) {
        // Más → el buscador encuentra «Mis hojas» y lleva ahí.
        await page.locator('.bnav [data-s="mas"]').click();
        await page.fill("#hubFind", "excel");
        const hit = page.locator('.hubarea-i[data-rtool="hojas"]');
        assert.ok(await hit.isVisible());
        await hit.click();
        await page.locator("#hh .hht").waitFor();
        assert.deepEqual(errs, []); await ctx.close(); continue;
      }

      // Sin internet: anotar una nota a Carla (cuenta propia) queda en la cola con ⏳.
      await page.locator('[data-hhtab="IPTV"]').click();
      await page.locator("[data-hhrow]", { hasText: "Carla" }).click();
      await page.locator("#hhsheet").waitFor();
      if (shots) await page.screenshot({ path: join(shots, "hojas-360-fila.png") });
      await ctx.setOffline(true);
      await page.locator("[data-hhnote]").click();
      await page.fill('#hhform textarea[name="v"]', "Paga el viernes");
      await page.locator('#hhform button[type="submit"]').click();
      await page.locator("#hh .hhnet.off").waitFor();
      assert.match(await page.locator("#hh").innerText(), /⏳/);
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem("gs-hubhojas-cola-v1")).length), 1);
      assert.equal(t.s.own.view(t.ana.A).sales.find((x) => x.id === t.carlaId).note, undefined, "todavía no llegó");
      if (shots) await page.screenshot({ path: join(shots, "hojas-360-sin-internet.png") });
      // Vuelve la señal: se sube sola.
      await ctx.setOffline(false);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("gs-hubhojas-cola-v1") || "[]").length === 0, null, { timeout: 20_000 });
      assert.equal(t.s.own.view(t.ana.A).sales.find((x) => x.id === t.carlaId).note, "Paga el viernes");

      // Choque: anotada sin señal una fecha, pero mientras tanto la cambiaron en otra pantalla → pregunta (se acepta).
      await ctx.setOffline(true);
      await page.locator("[data-hhrow]", { hasText: "Carla" }).click();
      await page.locator("[data-hhdate]").click();
      const want = new Date(t.clock.t + 60 * DAY); const ymd = `${want.getFullYear()}-${String(want.getMonth() + 1).padStart(2, "0")}-${String(want.getDate()).padStart(2, "0")}`;
      await page.fill('#hhform input[name="v"]', ymd);
      await page.locator('#hhform button[type="submit"]').click();
      await page.locator("#hh .hhnet.off").waitFor();
      t.s.own.updateSale(t.ana.A, t.carlaId, { expiresAt: t.clock.t + 9 * DAY });
      const asked = new Promise((ok) => page.once("dialog", (d) => ok(d.message())));
      await ctx.setOffline(false);
      assert.match(await asked, /la fecha cambió: ahora vence el/);
      await page.waitForFunction(() => JSON.parse(localStorage.getItem("gs-hubhojas-cola-v1") || "[]").length === 0, null, { timeout: 20_000 });
      assert.equal(new Date(t.s.own.view(t.ana.A).sales.find((x) => x.id === t.carlaId).expiresAt).toDateString(), want.toDateString());

      // Abrir GaboHub sin señal: muestra las hojas guardadas.
      // Espera a que el aparato guarde los archivos de GaboHub (los que ya cargó; nunca los datos).
      const saved = await page.evaluate(async () => {
        for (let i = 0; i < 60; i++) {
          const c = await caches.open("gs-panel-v1");
          const urls = performance.getEntriesByType("resource").map((e) => new URL(e.name)).filter((u) => u.origin === location.origin && /\.(js|css)$/.test(u.pathname)).map((u) => u.pathname);
          let ok = true;
          for (const u of ["/hub", "/hub-hojas.js", "/shop.js", ...urls]) if (!(await c.match(u, { ignoreSearch: true }))) { ok = false; break; }
          if (ok) return true;
          await new Promise((r) => setTimeout(r, 500));
        }
        return false;
      });
      assert.equal(saved, true, "GaboHub guardado en el aparato");
      await ctx.setOffline(true);
      await page.reload();
      await page.locator("#hh .hht").waitFor({ timeout: 20_000 });
      assert.match(await page.locator(".hhcold").innerText(), /sin internet/);
      if (shots) await page.screenshot({ path: join(shots, "hojas-360-abrir-sin-senal.png"), fullPage: true });
      await ctx.setOffline(false);
      assert.deepEqual(errs.filter((e) => !/fetch|network/i.test(e)), []);
      await ctx.close();
    }
  } finally { await b.close(); await t.close(); }
});
