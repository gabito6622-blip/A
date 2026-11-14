// Día a día · números y avisos (14/11/2026). Requisitos 4, 6 y 9 de la revisión del día a día del dueño:
//   4) Los números del día son los mismos en Inicio (saludo, botón «Abrir Mi secretaria · N para hoy», contadores) y en
//      Mi secretaria: un solo cálculo (dia.ts → todayNumbers), y si suman clientes de revendedores lo dicen.
//   6) «Ya le avisé» (Mi secretaria) y el «último recordatorio» (Recordatorios) son la misma marca.
//   9) «Tu mes» va arriba en el Inicio: después de los contadores y antes de los accesos.
// Datos ficticios; navegador a 360 px; nunca se abre un WhatsApp de verdad.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const PASS = "clave-del-dueño-123";

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "gs-equipoA-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  const sell = (c, expDays, control) => {
    s.inventory.addAccount(owner, { productId: "nf", email: `${c.name.split(" ")[0].toLowerCase()}@ejemplo.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [{ label: "P1" }] });
    const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
    const id = o.assignmentIds[0];
    s.orders.setExpiry(owner, id, Date.now() + expDays * DAY);
    if (control) s.orders.setControl(owner, id, control);
    return id;
  };
  const C = (name, phone) => s.catalog.createCustomer(owner, { name, phone });
  const ids = {
    ana: sell(C("Ana Ficticia", "+59170000001"), -2, { payStatus: "pendiente" }), // vencida y sin pagar: cuenta UNA vez
    bea: sell(C("Bea Ficticia", "+59170000002"), 0),
    caro: sell(C("Caro Ficticia", "+59170000003"), 2, { payStatus: "pagado" }),
    dora: sell(C("Dora Ficticia", "+59170000004"), 10, { payStatus: "pendiente" }),
  };
  // Un revendedor y un cliente SUYO que venció ayer.
  const rita = s.catalog.createCustomer(owner, { name: "Rita Revende", phone: "+59170000009", kind: "reseller" });
  const eli = s.catalog.createCustomer({ id: "u_" + rita.id, role: "reseller", customerId: rita.id }, { name: "Eli de Rita", phone: "+59170000010" });
  ids.eli = sell(eli, -1);
  return { dir, app, s, owner, ids, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const noAt = ({ at, ...x }) => x; // eslint-disable-line no-unused-vars

test("4) Números del día: un solo cálculo para Inicio y Mi secretaria, «tuyos · de revendedores», cada alquiler una vez", async () => {
  const t = seed();
  const { s, owner } = t;
  try {
    const d = s.dia.numbers(owner);
    assert.deepEqual([d.paraHoy.mine, d.paraHoy.rev, d.paraHoy.total], [3, 1, 4], "Ana (vencida y sin pagar) cuenta una sola vez");
    assert.deepEqual([d.vencidos.mine, d.vencidos.rev], [1, 1]);
    assert.deepEqual([d.hoy.total, d.pronto.total, d.sinPago.total, d.cobroFecha.total], [1, 1, 2, 3]);
    assert.deepEqual([d.total, d.mine, d.rev, d.revisar], [4, 3, 1, 0]);
    assert.deepEqual(noAt(s.stats.secretary(owner).dia), noAt(d), "Mi secretaria usa el mismo cálculo");
    // Por la API: Inicio y Mi secretaria devuelven lo mismo.
    const base = `http://127.0.0.1:${await t.app.listen(0, "127.0.0.1")}`;
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: PASS }) })).headers.get("set-cookie").split(";")[0];
    const J = async (p) => (await fetch(base + p, { headers: { cookie: ck } })).json();
    const [ini, sec] = await Promise.all([J("/api/admin/inicio"), J("/api/admin/secretaria")]);
    assert.deepEqual(noAt(ini.dia), noAt(sec.dia));
    assert.equal(ini.dia.total, 4);
    // Solo el panel: un cliente o revendedor no tiene números del día.
    assert.throws(() => s.dia.numbers({ id: "u_x", role: "customer", customerId: "x" }), (e) => e.code === "FORBIDDEN");

    if (!chromium) return;
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
      await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/panel#inicio");
      const btn = p.locator(".hm-hero .sec-cta");
      await btn.waitFor();
      const bt = (await btn.innerText()).replace(/\s+/g, " ");
      assert.match(bt, /Abrir Mi secretaria · 4 para hoy \(3 tuyos · 1 de revendedores\)/);
      assert.match(await p.locator(".hm-hero p").innerText(), /Hoy tenés 3 pendiente\(s\) de cobro o fecha\. \(2 tuyos · 1 de revendedores/);
      const bad = p.locator(".hm-alert.hm-bad");
      assert.match((await bad.innerText()).replace(/\s+/g, " "), /^2 Vencidos \/ esperando fecha 1 tuyo · 1 de revendedores$/);
      assert.equal(await bad.getAttribute("data-hgo"), "control:bad", "con clientes de revendedores, el atajo muestra todos");
      assert.equal(await p.locator(".hm-alert.hm-today").getAttribute("data-hgo"), "control:today:mios", "sin revendedores, sigue mostrando solo lo tuyo");
      assert.match(await p.locator(".hm-alert.hm-nopay").innerText(), /^2/);
      // Mi secretaria dice el mismo número.
      await btn.click();
      await p.locator(".sec-hero").waitFor();
      assert.match((await p.locator(".sec-sum").innerText()).replace(/\s+/g, " "), /📅 4 para hoy \(3 tuyos · 1 de revendedores\)/);
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
  } finally { await t.close(); }
});

test("6) «Ya le avisé» y el último recordatorio son la misma marca, por los dos lados (y «No le avisé» borra las dos)", { timeout: 120_000 }, async () => {
  const t = seed();
  const { s, owner, ids } = t;
  try {
    const item = (id) => s.stats.secretary(owner).avisar.flatMap((g) => g.items).find((i) => i.assignmentId === id);
    const row = (id) => s.admin.assignments(owner, {}).find((x) => x.id === id);
    // Desde Mi secretaria → Recordatorios lo muestra.
    s.orders.markNoticed(owner, [ids.caro]);
    assert.equal(row(ids.caro).lastNotice.via, "secretaria");
    assert.equal(row(ids.caro).notice.via, "secretaria");
    // Desde Recordatorios («Preparar avisos») → Mi secretaria lo muestra como avisado. A Caro no se le prepara otro hoy.
    s.orders.queueExpiryReminders(owner, 3);
    const a = s.engine.s.assignments;
    assert.equal(a[ids.caro].lastReminderAt, undefined, "ya le avisaste hoy: no se le prepara otro");
    assert.equal(a[ids.bea].reminderFor, a[ids.bea].customerExpiresAt);
    // 14/11 (revisión de 3 meses): preparado NO es avisado. Cuenta recién cuando el mensaje sale (bot o «enviado» a mano).
    assert.equal(item(ids.bea).noticedAt, undefined, "preparado pero sin enviar: no figura avisado");
    assert.ok(item(ids.bea).prepared, "queda «preparado, mandalo vos»");
    const msg = s.engine.s.outbox.find((m) => m.id === a[ids.bea].reminderMsgId);
    if (msg.status === "skipped_no_consent") s.notify.markSentManually(owner, msg.id, { force: true, reason: "me lo pidió por WhatsApp" });
    else s.notify.markSentManually(owner, msg.id);
    assert.equal(item(ids.bea).prepared, undefined);
    assert.equal(item(ids.bea).noticedVia, "recordatorio");
    assert.equal(item(ids.bea).noticedAt, a[ids.bea].lastReminderAt);
    assert.equal(s.stats.secretary(owner).counts.avisar, 0, "los dos ya figuran avisados");
    assert.equal(row(ids.bea).lastNotice.via, "recordatorio");
    // Si cambia el vencimiento, el aviso viejo no vale para el nuevo (ni el de un lado ni el del otro).
    s.orders.setExpiry(owner, ids.bea, Date.now() + 1 * DAY);
    assert.equal(item(ids.bea).noticedAt, undefined);
    s.orders.setExpiry(owner, ids.bea, a[ids.bea].reminderFor);
    assert.equal(item(ids.bea).noticedVia, "recordatorio");
    // «↩️ No le avisé» borra las dos marcas de ese vencimiento.
    s.orders.markNoticed(owner, [ids.bea], true);
    assert.equal(item(ids.bea).noticedAt, undefined);

    if (!chromium) return;
    const base = `http://127.0.0.1:${await t.app.listen(0, "127.0.0.1")}`;
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: PASS }) })).headers.get("set-cookie").split(";")[0];
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
      await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/panel#recordatorios");
      const caro = p.locator("tr", { hasText: "Caro Ficticia" });
      await caro.waitFor();
      assert.match(await caro.innerText(), /Ya le avisé \(Mi secretaria\)/);
      // Lo marcado desde Mi secretaria con el botón se ve en Recordatorios.
      await p.goto("about:blank");
      await p.goto(base + "/panel#secretaria");
      const g = p.locator(".sec-group", { hasText: "Bea Ficticia" });
      await g.locator("[data-secnotice]").click();
      await p.waitForFunction(() => /avisado hoy/.test(document.querySelector("#sec-avisar")?.innerText ?? "") && [...document.querySelectorAll(".sec-group")].some((x) => x.innerText.includes("Bea Ficticia") && x.innerText.includes("avisado")), null, { timeout: 15_000 });
      await p.goto("about:blank");
      await p.goto(base + "/panel#recordatorios");
      const bea = p.locator("tr", { hasText: "Bea Ficticia" });
      await bea.waitFor();
      assert.match(await bea.innerText(), /Ya le avisé \(Mi secretaria\)/);
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
  } finally { await t.close(); }
});

test("9) Inicio: «Tu mes» va después de los contadores y antes de los accesos", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const t = seed();
  try {
    const base = `http://127.0.0.1:${await t.app.listen(0, "127.0.0.1")}`;
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: PASS }) })).headers.get("set-cookie").split(";")[0];
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
      await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/panel#inicio");
      await p.locator(".tumes").waitFor();
      const order = await p.evaluate(() => {
        const f = (a, b) => !!(document.querySelector(a).compareDocumentPosition(document.querySelector(b)) & Node.DOCUMENT_POSITION_FOLLOWING);
        return { despuesDeContadores: f(".hm-alerts", ".tumes"), antesDeAccesos: f(".tumes", ".hm-grid"), antesDeSemana: f(".tumes", ".hm-week") };
      });
      assert.deepEqual(order, { despuesDeContadores: true, antesDeAccesos: true, antesDeSemana: true });
      assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
  } finally { await t.close(); }
});
