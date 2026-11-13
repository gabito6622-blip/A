// «✅ Ya le avisé» en Mi secretaria (13/11/2026): el dueño marca que ya le escribió a un cliente y la secretaria deja de
// pedírselo. La marca vale para ESE vencimiento (al renovar o cambiar la fecha se va). Si vence mañana u hoy y el aviso
// fue hace 2 días o más, vuelve a aparecer (segundo aviso). No manda nada ni cambia pagos. Datos ficticios.
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

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "gs-avise-"));
  // Mediodía de Bolivia, para que «hoy / mañana» no dependan de la hora en que corre la prueba.
  const clock = { t: new Date(new Date().setHours(12, 0, 0, 0)).getTime(), now() { return this.t; } };
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, clock });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ (alquiler)", kind: "full_account", durationDays: 30, price: 6900, published: true });
  const oby = s.catalog.createCustomer(owner, { name: "Oby Ficticio", phone: "+59170000001", kind: "reseller" });
  const ari = s.catalog.createCustomer(owner, { name: "Ari Ficticia", phone: "+59170000002", kind: "reseller" });
  const sell = (c, email, expDays) => {
    s.inventory.addAccount(owner, { productId: "dis", email, password: "Clave-Larga#1", supplierExpiresAt: clock.t + 200 * DAY, cost: 3000, profiles: [{ label: "Cuenta completa" }] });
    const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" });
    s.orders.setExpiry(owner, o.assignmentIds[0], clock.t + expDays * DAY);
    s.orders.setControl(owner, o.assignmentIds[0], { payStatus: "pagado" });
    return o.assignmentIds[0];
  };
  const ids = { obyHoy: sell(oby, "oby.hoy@ejemplo.lat", 0), obyManana: sell(oby, "oby.manana@ejemplo.lat", 1), ari3a: sell(ari, "ari.uno@ejemplo.lat", 3), ari3b: sell(ari, "ari.dos@ejemplo.lat", 3) };
  return { dir, app, s, owner, clock, oby, ari, ids, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("Ya le avisé: sale de «por avisar», vale para ese vencimiento, vuelve el día antes; permisos y deshacer", async () => {
  const t = seed();
  const { s, owner, clock, oby, ari, ids } = t;
  try {
    let r = s.stats.secretary(owner);
    assert.deepEqual([r.counts.avisar, r.counts.avisados], [4, 0]);
    // Un revendedor no puede marcar nada; lista vacía tampoco.
    assert.throws(() => s.orders.markNoticed({ id: "u_" + oby.id, role: "reseller", customerId: oby.id }, [ids.obyHoy]), (e) => e.code === "FORBIDDEN");
    assert.throws(() => s.orders.markNoticed(owner, []), (e) => e.code === "VALIDATION");
    // Marca las dos de Oby: no cambia ni la fecha ni el pago.
    const before = structuredClone(s.engine.s.assignments[ids.obyHoy]);
    const m = s.orders.markNoticed(owner, [ids.obyHoy, ids.obyManana]);
    assert.equal(m.ids.length, 2);
    const a = s.engine.s.assignments[ids.obyHoy];
    assert.deepEqual([a.customerExpiresAt, a.control.payStatus, a.control.noticed], [before.customerExpiresAt, "pagado", { at: clock.t, for: before.customerExpiresAt }]);
    r = s.stats.secretary(owner);
    assert.deepEqual([r.counts.avisar, r.counts.avisados], [2, 2]);
    assert.deepEqual(r.avisar.map((g) => g.name), ["Ari Ficticia", "Oby Ficticio"], "los ya avisados van al final");
    assert.ok(r.avisar[1].items.every((i) => i.noticedAt === clock.t));
    assert.equal(s.engine.s.audit.filter((x) => x.action === "assignment.noticed").length, 2);
    // Ari: avisada 3 días antes. Al día siguiente (faltan 2) sigue marcada; el día antes vuelve a pedir el aviso.
    s.orders.markNoticed(owner, [ids.ari3a, ids.ari3b]);
    clock.t += DAY;
    r = s.stats.secretary(owner);
    const ariG = (x) => x.avisar.find((g) => g.name === "Ari Ficticia");
    assert.ok(ariG(r).items.every((i) => i.noticedAt !== undefined), "faltan 2 días: sigue avisada");
    clock.t += DAY;
    r = s.stats.secretary(owner);
    assert.ok(ariG(r).items.every((i) => i.noticedAt === undefined), "vence mañana y el aviso fue hace 2 días: segundo aviso");
    // Si se renueva (cambia el vencimiento), la marca deja de contar.
    s.orders.markNoticed(owner, [ids.ari3a]);
    assert.ok(ariG(s.stats.secretary(owner)).items.some((i) => i.noticedAt !== undefined));
    s.orders.setExpiry(owner, ids.ari3a, clock.t + 2 * DAY);
    assert.ok(ariG(s.stats.secretary(owner)).items.every((i) => i.noticedAt === undefined), "otra fecha: el aviso viejo no vale");
    // Deshacer.
    s.orders.markNoticed(owner, [ids.ari3b]);
    s.orders.markNoticed(owner, [ids.ari3b], true);
    assert.equal(s.engine.s.assignments[ids.ari3b].control.noticed, undefined);
  } finally { await t.close(); }
});

test("Mi secretaria a 360 px: «✅ Ya le avisé» marca el grupo, lo manda al final y se puede deshacer", { skip: !chromium && "Playwright no instalado", timeout: 120_000 }, async () => {
  const t = seed();
  const { app, s } = t;
  let b;
  try {
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com/, (r) => r.abort());
    const [n, v] = ck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(base + "/panel.html#secretaria");
    const grupo = () => page.locator("#sec-avisar .sec-group", { hasText: "Oby Ficticio" });
    await grupo().waitFor({ timeout: 20_000 });
    assert.match(await page.locator(".sec-sum").innerText(), /4 por avisar/);
    const btn = grupo().getByRole("button", { name: "✅ Ya le avisé" });
    assert.ok((await btn.boundingBox()).height >= 44, "botón de 44 px");
    await btn.click();
    await page.locator("#sec-avisar .sec-group.sec-done", { hasText: "Oby Ficticio" }).waitFor({ timeout: 15_000 });
    assert.match(await page.locator(".sec-sum").innerText(), /2 por avisar[\s\S]*2 ya avisados/);
    assert.match(await grupo().innerText(), /📣 avisado hoy/);
    assert.equal(await page.locator("#sec-avisar .sec-group").last().locator("b").first().innerText(), "Oby Ficticio", "queda al final");
    assert.equal(Object.values(s.engine.s.assignments).filter((a) => a.control?.noticed).length, 2);
    await grupo().getByRole("button", { name: "↩️ No le avisé" }).click();
    await page.waitForFunction(() => !document.querySelector("#sec-avisar .sec-done"), null, { timeout: 15_000 });
    assert.equal(Object.values(s.engine.s.assignments).filter((a) => a.control?.noticed).length, 0);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), "sin desborde");
    assert.deepEqual(errs, []);
  } finally { await b?.close(); await t.close(); }
});
