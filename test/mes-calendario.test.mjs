// ¿Cómo cuenta un mes cada quien? (14/11/2026). El dueño: «Es de un mes: si vence el 12 de enero, siguiente mes es hasta
// el 12 de febrero» y después «Sería mejor que cada quien decida, porque yo doy de mes a mes, pero otros revendedores sí
// hacen 30 días». Entonces es un AJUSTE (mesModo.ts):
//  - la tienda: «del mismo día al mismo día» (por defecto) o «30 días», en Configuración;
//  - cada revendedor, para SUS clientes (cuaderno y cuentas propias): «30 días» (por defecto) o «del mismo día».
// El de uno no toca a otro ni a la tienda. Datos ficticios, carpeta temporal, reloj controlado, nada real.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { addPeriods, subPeriods, periodText } from "../dist/store/time.js";
import { createApp } from "../dist/server/app.js";
import { DomainError } from "../dist/store/index.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

const DAY = 86_400_000;
// hh:mm de Bolivia (UTC−4) del día d/m/y.
const bo = (y, m, d, h = 23, mi = 59) => Date.UTC(y, m - 1, d, h + 4, mi);
const dm = (t) => { const x = new Date(t - 4 * 3_600_000); return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`; };
const err = (code) => (e) => e instanceof DomainError && e.code === code;

describe("la cuenta del mes (time.ts)", () => {
  test("«calendar»: mismo día del mes siguiente, a la misma hora de Bolivia", () => {
    const C = "calendar";
    assert.equal(dm(addPeriods(bo(2026, 12, 13), 30, 1, C)), "13/01/2027", "13/12 → 13/01");
    assert.equal(dm(addPeriods(bo(2027, 1, 12), 30, 1, C)), "12/02/2027", "el ejemplo del dueño");
    assert.equal(addPeriods(bo(2027, 1, 12), 30, 1, C), bo(2027, 2, 12), "misma hora");
    assert.equal(dm(addPeriods(bo(2027, 1, 31), 30, 1, C)), "28/02/2027", "si el día no existe, el último del mes");
    assert.equal(dm(addPeriods(bo(2028, 1, 31), 30, 1, C)), "29/02/2028", "año bisiesto");
    assert.equal(dm(addPeriods(bo(2026, 11, 14), 90, 1, C)), "14/02/2027", "3 meses");
    assert.equal(dm(addPeriods(bo(2026, 11, 14), 30, 3, C)), "14/02/2027", "3 períodos de 1 mes");
    assert.equal(dm(addPeriods(bo(2026, 12, 31, 23, 30), 30, 1, C)), "31/01/2027", "23:30 de Bolivia ya es el día siguiente en UTC: igual cuenta el día de Bolivia");
    assert.equal(addPeriods(bo(2026, 11, 14), 7, 1, C), bo(2026, 11, 21), "los de 7 días siguen contando días");
    assert.equal(subPeriods(bo(2027, 1, 13), 30, 1, C), bo(2026, 12, 13), "hacia atrás: dónde empezó el período");
    assert.deepEqual([periodText(30, 1, C), periodText(90, 1, C), periodText(30, 2, C), periodText(15, 1, C)], ["1 mes", "3 meses", "2 meses", "15 días"]);
  });

  test("«days»: 30 días justos, como siempre", () => {
    const D = "days";
    assert.equal(dm(addPeriods(bo(2026, 12, 13), 30, 1, D)), "12/01/2027", "13/12 → 12/01");
    assert.equal(addPeriods(bo(2026, 11, 14), 30, 3, D), bo(2026, 11, 14) + 90 * DAY);
    assert.equal(subPeriods(bo(2027, 1, 12), 30, 1, D), bo(2027, 1, 12) - 30 * DAY);
    assert.deepEqual([periodText(30, 1, D), periodText(90, 1, D), periodText(15, 1, D)], ["30 días", "90 días", "15 días"]);
  });
});

function world() {
  const dir = mkdtempSync(join(tmpdir(), "gs-mes-"));
  const clock = { t: bo(2026, 12, 13, 10, 0), now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN", kind: "full_account", durationDays: 30, price: 6900, published: true });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertSupplier(owner, { id: "a", name: "A", active: true });
  for (let i = 0; i < 3; i++) s.inventory.addAccount(owner, { productId: "dis", supplierId: "a", email: `ficticia+dis${i}@x.lat`, password: "Clave-Larga#1", supplierExpiresAt: bo(2027, 6, 1), cost: 0, profiles: [{ label: "Cuenta completa" }] });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "a", email: "ficticia+nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: bo(2027, 6, 1), cost: 0, profiles: [1, 2, 3, 4].map((n) => ({ label: `P${n}` })) });
  const rev = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller" }); s.wallet.adjust(owner, c.id, 100_000, "saldo ficticio"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const done = async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); };
  return { app, s, owner, clock, rev, done };
}

describe("la tienda elige (Configuración)", () => {
  test("por defecto «mismo día»: venta, renovación, «Me pagó» y el link de renovar dicen y hacen lo mismo", async () => {
    const { app, s, owner, clock, done } = world();
    try {
      assert.equal(s.engine.s.settings.monthMode, undefined, "sin ajuste guardado");
      const c = s.catalog.createCustomer(owner, { name: "Oby Prueba", phone: "+59177000001" });
      const aid = s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "v" }).assignmentIds[0];
      const A = () => s.engine.s.assignments[aid];
      assert.equal(dm(A().customerExpiresAt), "13/01/2027", "vendido el 13/12 → vence el 13/01");
      clock.t = bo(2027, 1, 10, 10, 0);
      const pv = s.cobro.preview(owner, aid);
      assert.equal(pv.period, "1 mes");
      assert.equal(dm(pv.to), "13/02/2027", "la vista previa de «Me pagó»");
      s.orders.renew(owner, aid, { periods: 1, paymentMethod: "cash", idempotencyKey: "r1", confirmOther: true });
      assert.equal(A().customerExpiresAt, pv.to, "lo que se vio antes es lo que pasó");
      assert.match(A().history.at(-1).note, /\+1 mes/);
      // El link de renovar: «1 mes», la fecha nueva y el correo de la cuenta (nunca la clave).
      s.catalog.updateSettings(owner, { renewLink: { enabled: true, access: "renew", hours: 48 } });
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
      const link = await (await fetch(base + `/api/admin/assignments/${aid}/renew-link`, { method: "POST", headers: { "content-type": "application/json", cookie: ck }, body: "{}" })).json();
      const v = await (await fetch(base + `/api/renovar/${link.url.split("renovar=")[1]}`)).json();
      assert.equal(v.period, "1 mes");
      assert.equal(dm(v.to), "13/03/2027", "13/02 → 13/03");
      assert.match(v.email, /^ficticia\+dis\d@x\.lat$/);
      assert.ok(!JSON.stringify(v).includes("Clave-Larga"));
      assert.equal((await (await fetch(base + "/api/settings")).json()).monthMode, "calendar", "la tienda y el panel lo saben");
    } finally { await done(); }
  });

  test("«30 días»: 13/12 → 12/01, textos «30 días»; solo el dueño o un admin lo cambian y se valida", async () => {
    const { s, owner, clock, rev, done } = world();
    try {
      assert.throws(() => s.catalog.updateSettings({ id: "u_x", role: "seller" }, { monthMode: "days" }), err("FORBIDDEN"));
      assert.throws(() => s.catalog.updateSettings(owner, { monthMode: "semanas" }), err("VALIDATION"));
      s.catalog.updateSettings(owner, { monthMode: "days" });
      assert.equal(s.engine.s.settings.monthMode, "days");
      assert.ok(s.engine.s.audit.some((x) => x.action === "settings.update" && /monthMode/.test(x.detail?.fields ?? JSON.stringify(x))));
      const c = s.catalog.createCustomer(owner, { name: "Cliente Días", phone: "+59177000002" });
      const aid = s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
      assert.equal(dm(s.engine.s.assignments[aid].customerExpiresAt), "12/01/2027", "13/12 + 30 días");
      clock.t = bo(2027, 1, 10, 10, 0);
      const pv = s.cobro.preview(owner, aid);
      assert.deepEqual([pv.period, dm(pv.to)], ["30 días", "11/02/2027"]);
      // Los alquileres a revendedores siguen la regla de la tienda (no la del revendedor).
      const r = rev("Rev Calendario", "+59177000010");
      s.monthMode.setMine(r.A, { mode: "calendar" });
      const ra = s.orders.create(owner, { customerId: r.c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
      assert.equal(s.engine.s.assignments[ra].customerExpiresAt, bo(2027, 1, 10, 10, 0) + 30 * DAY, "alquiler de la tienda: 30 días, aunque el revendedor cuente meses");
      // La plata no cambia con el modo.
      assert.equal(s.orders.quote(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], periods: 3 }).total, 3 * 6900);
    } finally { await done(); }
  });
});

describe("cada revendedor elige para SUS clientes", () => {
  test("por defecto «30 días»; con «mismo día» su cuaderno y sus cuentas propias corren meses; no toca a otro ni a la tienda", async () => {
    const { s, owner, rev, done } = world();
    try {
      const ana = rev("Ana Mes", "+59177000020"), beto = rev("Beto Días", "+59177000021");
      assert.deepEqual(s.monthMode.mine(ana.A), { mode: "days" }, "un revendedor arranca en «30 días» (lo de siempre)");
      // Permisos: solo un revendedor, solo el suyo.
      assert.throws(() => s.monthMode.setMine(owner, { mode: "calendar" }), err("FORBIDDEN"));
      assert.throws(() => s.monthMode.setMine({ id: "u_c", role: "customer", customerId: s.catalog.createCustomer(owner, { name: "Cli", phone: "+59177000029" }).id }, { mode: "calendar" }), err("FORBIDDEN"));
      assert.throws(() => s.monthMode.setMine(ana.A, { mode: "x" }), err("VALIDATION"));
      assert.deepEqual(s.monthMode.setMine(ana.A, { mode: "calendar" }), { mode: "calendar" });
      assert.equal(s.engine.s.customers[ana.c.id].monthMode, "calendar");
      assert.equal(s.engine.s.customers[beto.c.id].monthMode, undefined, "el de Beto no cambió");
      assert.equal(s.engine.s.settings.monthMode, undefined, "la tienda no cambió");
      assert.ok(s.engine.s.audit.some((x) => x.action === "reseller.month_mode" && x.entityId === ana.c.id));

      // Cuaderno (perfiles repartidos): mismo alquiler de la tienda, cada uno con su regla.
      const aidA = s.orders.create(owner, { customerId: ana.c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
      const aidB = s.orders.create(owner, { customerId: beto.c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" }).assignmentIds[0];
      assert.equal(dm(s.engine.s.assignments[aidA].customerExpiresAt), "13/01/2027", "el alquiler de la tienda sigue la regla de la tienda");
      const exp = bo(2026, 12, 13);
      const subA = s.subs.save(ana.A, aidA, { label: "Mamá", name: "Lucía", phone: "+59175550001", expiresAt: exp, price: 1500, pay: "pagado" }).sub;
      const subB = s.subs.save(beto.A, aidB, { label: "Tío", name: "Pedro", phone: "+59175550002", expiresAt: exp, price: 1500, pay: "pagado" }).sub;
      s.subs.renew(ana.A, aidA, subA.id, true);
      s.subs.renew(beto.A, aidB, subB.id, true);
      const subOf = (aid, id) => s.engine.s.assignments[aid].subs.find((x) => x.id === id);
      assert.equal(dm(subOf(aidA, subA.id).expiresAt), "13/01/2027", "Ana: del mismo día al mismo día");
      assert.equal(dm(subOf(aidB, subB.id).expiresAt), "12/01/2027", "Beto: 30 días, como siempre");
      // Lo mismo de plata para los dos (anotado «pagado» Bs 15 + «Renovó» Bs 15): el modo no cambia la plata.
      assert.deepEqual([ana, beto].map((r) => (s.engine.s.rcobros ?? []).filter((x) => x.resellerId === r.c.id).reduce((t, x) => t + x.amount, 0)), [3000, 3000]);

      // Cuentas propias (revendedor independiente): vender y «Renovó» con su regla; la vista previa lo sabe.
      for (const r of [ana, beto]) {
        const p = s.own.saveProduct(r.A, { name: "Flujo TV", durationDays: 30, price: 3000, kind: "profiles", slots: 2 });
        s.own.addBulk(r.A, p.id, "flujo01 Clave-Uno 30/06/2027\n");
      }
      const sell = (r, name, phone) => { const acc = s.own.view(r.A).accounts[0]; return s.own.assign(r.A, { accountId: acc.id, name, phone, slot: 1 }); };
      sell(ana, "Carla Ana", "+59175550011"); sell(beto, "Diego Beto", "+59175550012");
      const saleOf = (r) => s.own.view(r.A).sales[0];
      assert.equal(dm(saleOf(ana).expiresAt), "13/01/2027");
      assert.equal(dm(saleOf(beto).expiresAt), "12/01/2027");
      assert.deepEqual([s.own.view(ana.A).monthMode, s.own.view(beto.A).monthMode], ["calendar", "days"], "la pantalla calcula igual que el servidor");
      assert.deepEqual([s.own.view(ana.A).products[0].period, s.own.view(beto.A).products[0].period], ["1 mes", "30 días"]);
      s.own.renew(ana.A, saleOf(ana).id, true); s.own.renew(beto.A, saleOf(beto).id, true);
      assert.equal(dm(saleOf(ana).expiresAt), "13/02/2027");
      assert.equal(dm(saleOf(beto).expiresAt), "11/02/2027");

      // Vuelve a «30 días»: no se guarda nada (lo de siempre).
      s.monthMode.setMine(ana.A, { mode: "days" });
      assert.equal(s.engine.s.customers[ana.c.id].monthMode, undefined);
    } finally { await done(); }
  });

  test("API: GET/PUT /api/me/month-mode solo con sesión de revendedor; /api/me lo trae", async () => {
    const { app, s, owner, rev, done } = world();
    try {
      const ana = rev("Ana Api", "+59177000030");
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const post = (p, body, ck, m = "POST") => fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
      const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
      const { pin } = await (await post(`/api/admin/customers/${ana.c.id}/login-pin`, {}, ock)).json();
      const rck = (await post("/api/auth/customer/pin", { phone: ana.c.phone, pin })).headers.get("set-cookie").split(";")[0];
      assert.equal((await post("/api/me/month-mode", { mode: "calendar" }, undefined, "PUT")).status, 401, "sin sesión");
      assert.ok([401, 403].includes((await post("/api/me/month-mode", { mode: "calendar" }, ock, "PUT")).status), "el dueño no lo cambia por el revendedor");
      assert.equal((await post("/api/me/month-mode", { mode: "calendar" }, rck, "PUT")).status, 200);
      assert.equal((await (await fetch(base + "/api/me/month-mode", { headers: { cookie: rck } })).json()).mode, "calendar");
      assert.equal((await (await fetch(base + "/api/me", { headers: { cookie: rck } })).json()).monthMode, "calendar");
      assert.equal(s.engine.s.settings.monthMode, undefined, "la tienda sigue en su ajuste");
      assert.ok(owner);
    } finally { await done(); }
  });
});

describe("pantallas a 360 px", () => {
  test("panel (Configuración) y GaboHub: elegir cómo se cuenta un mes, sin desborde", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
    const { app, s, rev, done } = world();
    const b = await chromium.launch();
    try {
      const ana = rev("Ana Hub", "+59177000040");
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
      const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
      const { pin } = await (await post(`/api/admin/customers/${ana.c.id}/login-pin`, {}, ock)).json();
      const rck = (await post("/api/auth/customer/pin", { phone: ana.c.phone, pin })).headers.get("set-cookie").split(";")[0];
      for (const scheme of ["light", "dark"]) {
        // Panel: Configuración → «¿Cómo contás un mes?»
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme });
        await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const [n, v] = ock.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        await p.goto(base + "/panel.html#configuracion");
        await p.waitForSelector('#setForm input[name="monthMode"][value="calendar"]');
        assert.equal(await p.locator('#setForm input[name="monthMode"]:checked').getAttribute("value"), "calendar", "por defecto, mismo día");
        if (process.env.GS_SHOTS) { await p.locator(".mm-field").scrollIntoViewIfNeeded(); await p.screenshot({ path: join(process.env.GS_SHOTS, `mes-panel-${scheme}.png`) }); }
        await p.locator('#setForm input[name="monthMode"][value="days"]').check();
        await p.locator('#setForm button[type="submit"]').click();
        for (let i = 0; i < 50 && s.engine.s.settings.monthMode !== "days"; i++) await p.waitForTimeout(100);
        assert.equal(s.engine.s.settings.monthMode, "days", "se guardó «30 días»");
        const box = await p.locator(".mm-field").boundingBox();
        assert.ok(box && box.x >= 0 && box.x + box.width <= 360, "entra en 360 px");
        const h = await p.locator('.mm-field label').first().boundingBox();
        assert.ok(h.height >= 44, "opciones de 44 px");
        assert.ok((await p.evaluate(() => document.documentElement.scrollWidth)) <= 360, "sin scroll horizontal");
        s.catalog.updateSettings({ id: "u_o", role: "owner" }, { monthMode: "calendar" });
        assert.deepEqual(errs, []);
        await ctx.close();

        // GaboHub: «📅 ¿Cómo contás un mes?» en Todas mis herramientas.
        const hc = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, colorScheme: scheme });
        await hc.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
        await hc.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* */ } }, ana.c.id);
        const [rn, rv] = rck.split("="); await hc.addCookies([{ name: rn, value: rv, url: base }]);
        const q = await hc.newPage(); const qerrs = []; q.on("pageerror", (e) => qerrs.push(e.message));
        await q.goto(base + "/hub#inicio");
        await q.locator(".htiles").waitFor();
        await q.locator(".hmore > summary").click();
        await q.locator("#mmCard > summary").click();
        if (process.env.GS_SHOTS) { await q.locator("#mmCard").scrollIntoViewIfNeeded(); await q.screenshot({ path: join(process.env.GS_SHOTS, `mes-hub-${scheme}.png`) }); } // capturas fuera del repo
        assert.equal(await q.locator('#mesModoForm input[name="monthMode"]:checked').getAttribute("value"), scheme === "light" ? "days" : "calendar");
        await q.locator(`#mesModoForm input[name="monthMode"][value="${scheme === "light" ? "calendar" : "days"}"]`).check();
        await q.locator('#mesModoForm button[type="submit"]').click();
        for (let i = 0; i < 50 && (s.engine.s.customers[ana.c.id].monthMode ?? "days") !== (scheme === "light" ? "calendar" : "days"); i++) await q.waitForTimeout(100);
        assert.equal(s.engine.s.customers[ana.c.id].monthMode ?? "days", scheme === "light" ? "calendar" : "days");
        assert.equal(s.engine.s.settings.monthMode, "calendar", "el revendedor no toca la tienda");
        assert.ok((await q.evaluate(() => document.documentElement.scrollWidth)) <= 360, "sin scroll horizontal en GaboHub");
        assert.deepEqual(qerrs, []);
        await hc.close();
      }
    } finally { await b.close(); await done(); }
  });
});
