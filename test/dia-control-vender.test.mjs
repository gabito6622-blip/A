// Día a día · Control y Vender (14/11/2026). Requisitos 5, 7 y 8 de la revisión del día a día del dueño:
//   5) «Renovar · dd/mm» del Control no promete una fecha que pasa la del proveedor: muestra el motivo antes de tocar y
//      la confirmación dice el monto.
//   7) «Cambiar de cuenta»: primero los perfiles libres, después los apartados (marcados) y, si elegís uno apartado, pide confirmación.
//   8) Vender: si lo escrito no es un cliente, «➕ Crear "<nombre>"» ahí mismo (con su WhatsApp) y la venta sigue; «Prueba
//      gratis» queda debajo de «Nueva venta».
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
const dm = (t) => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }); // «13/01» (es-BO sin año daba «13/1»)

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-equipoA-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  const addAcc = (email, supDays, n = 1) => { const r = s.inventory.addAccount(owner, { productId: "nf", email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + supDays * DAY, cost: 1000, profiles: Array.from({ length: n }, (_, i) => ({ label: `P${i + 1}` })) }); return r.account ?? r; };
  const slotsOf = (accId) => Object.values(s.engine.s.slots).filter((x) => x.accountId === accId);
  const sell = (c, slotId, expDays) => { const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slotId] }); s.orders.setExpiry(owner, o.assignmentIds[0], Date.now() + expDays * DAY); return o.assignmentIds[0]; };
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: PASS }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  const page = async (width = 360) => {
    const ctx = await b.newContext({ viewport: { width, height: 780 } });
    await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    return { p, errs };
  };
  return { s, owner, addAcc, slotsOf, sell, base, page, close: async () => { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const cardOf = (p, name) => p.locator("article.ccard").filter({ has: p.locator("header b", { hasText: name }) });

test("5) Control: «Renovar» no promete una fecha que pasa la del proveedor; el motivo se ve antes y la confirmación dice el monto", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const t = await setup();
  try {
    const { s, owner } = t;
    const ana = s.catalog.createCustomer(owner, { name: "Ana Ficticia", phone: "+59170000001" });
    const bea = s.catalog.createCustomer(owner, { name: "Bea Ficticia", phone: "+59170000002" });
    const corta = t.addAcc("corta@ejemplo.lat", 10), larga = t.addAcc("larga@ejemplo.lat", 120);
    const idAna = t.sell(ana, t.slotsOf(corta.id)[0].id, -1);
    const idBea = t.sell(bea, t.slotsOf(larga.id)[0].id, 5);
    const { p, errs } = await t.page();
    await p.goto(t.base + "/panel#control");
    // Ana: +30 días pasaría la fecha del proveedor → el botón no dice fecha y el motivo ya está a la vista.
    const ca = cardOf(p, "Ana Ficticia");
    await ca.waitFor();
    const ba = ca.locator("[data-renew]");
    assert.match(await ba.innerText(), /Renovar · ⚠️ ver proveedor/);
    assert.doesNotMatch(await ba.innerText(), /\d{2}\/\d{2}/, "no promete una fecha");
    const warn = ca.locator(".ctl-renwarn");
    assert.ok(await warn.isVisible());
    assert.match(await warn.innerText(), new RegExp(`vence con el proveedor el ${dm(s.engine.s.accounts[corta.id].supplierExpiresAt)}`));
    let msg = "";
    p.once("dialog", (d) => { msg = d.message(); d.dismiss(); });
    await ba.click();
    await p.waitForTimeout(300);
    // Decisión (b), 14/11: avisa que pasa la del proveedor y pregunta si anotarlo igual (dijo que no: no se anota).
    assert.match(msg, /pasa la del proveedor[\s\S]*Proveedores por renovar/);
    assert.match(msg, /Monto: Bs\s?30/);
    assert.equal(s.engine.s.assignments[idAna].customerExpiresAt < Date.now(), true, "no se renovó");
    // Bea: entra con el proveedor → el botón dice la fecha nueva y la confirmación el monto.
    const cb = cardOf(p, "Bea Ficticia");
    const next = s.engine.s.assignments[idBea].customerExpiresAt + 30 * DAY;
    assert.match(await cb.locator("[data-renew]").innerText(), new RegExp(`Renovar · ${dm(next)}`));
    assert.equal(await cb.locator(".ctl-renwarn").count(), 0);
    p.once("dialog", (d) => { msg = d.message(); d.accept(); });
    await cb.locator("[data-renew]").click();
    await p.waitForFunction(() => /Renovado hasta/.test(document.body.innerText), null, { timeout: 15_000 });
    assert.match(msg, /Cobrás: Bs\s?30/);
    assert.equal(s.engine.s.assignments[idBea].customerExpiresAt, next);
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errs, []);
  } finally { await t.close(); }
});

test("7) Cambiar de cuenta: libres primero, apartados al final y marcados; elegir uno apartado pide confirmación", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const t = await setup();
  try {
    const { s, owner } = t;
    const dani = s.catalog.createCustomer(owner, { name: "Dani Ficticio", phone: "+59170000004" });
    const vieja = t.addAcc("vieja@ejemplo.lat", 60);
    const aid = t.sell(dani, t.slotsOf(vieja.id)[0].id, 10);
    const apart = t.addAcc("a-apartada@ejemplo.lat", 60); // primera por orden alfabético: igual va al final
    s.inventory.setSlotStatus(owner, t.slotsOf(apart.id)[0].id, "quarantined", "cambiar la clave");
    t.addAcc("libre@ejemplo.lat", 60);
    t.addAcc("z-libre@ejemplo.lat", 60);
    const { p, errs } = await t.page();
    await p.goto(t.base + "/panel#control");
    const card = cardOf(p, "Dani Ficticio");
    await card.waitFor();
    await card.locator("summary", { hasText: "Cambiar de cuenta" }).click();
    const sel = card.locator("form[data-swapacc] select[name=to]");
    const groups = await sel.evaluate((x) => [...x.querySelectorAll("optgroup")].map((g) => [g.label, [...g.querySelectorAll("option")].map((o) => o.textContent)]));
    assert.equal(groups.length, 2);
    assert.match(groups[0][0], /Libres/);
    assert.deepEqual(groups[0][1].map((x) => x.split(" · ")[0]).sort(), ["libre@ejemplo.lat", "z-libre@ejemplo.lat"]);
    assert.match(groups[1][0], /Apartados/);
    assert.deepEqual(groups[1][1], ["a-apartada@ejemplo.lat · P1 (apartado)"]);
    const all = await sel.locator("option").allTextContents();
    assert.ok(all.findIndex((x) => x.includes("apartado")) > all.findIndex((x) => x.startsWith("z-libre")), "los apartados van después de los libres");
    // Elegir el apartado: pide confirmación; si decís que no, no se mueve.
    await sel.selectOption({ label: "a-apartada@ejemplo.lat · P1 (apartado)" });
    let msg = "";
    p.once("dialog", (d) => { msg = d.message(); d.dismiss(); });
    await card.locator('form[data-swapacc] button[type="submit"]').click();
    await p.waitForTimeout(400);
    assert.match(msg, /APARTADO/);
    assert.equal(s.engine.s.assignments[aid].slotId, t.slotsOf(vieja.id)[0].id, "dijo que no: no se movió");
    // Si confirma, se mueve con la misma fecha.
    const before = s.engine.s.assignments[aid].customerExpiresAt;
    p.once("dialog", (d) => d.accept());
    await card.locator('form[data-swapacc] button[type="submit"]').click();
    await p.waitForFunction(() => /Pasado a/.test(document.body.innerText), null, { timeout: 15_000 });
    assert.equal(s.engine.s.assignments[aid].slotId, t.slotsOf(apart.id)[0].id);
    assert.equal(s.engine.s.assignments[aid].customerExpiresAt, before);
    assert.deepEqual(errs, []);
  } finally { await t.close(); }
});

test("8) Vender: «➕ Crear <nombre>» ahí mismo y la venta sigue; «Prueba gratis» debajo de «Nueva venta»", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const t = await setup();
  try {
    const { s, owner } = t;
    s.catalog.createCustomer(owner, { name: "Ana Ficticia", phone: "+59170000001" });
    t.addAcc("venta@ejemplo.lat", 90);
    const { p, errs } = await t.page();
    await p.goto(t.base + "/panel#vender");
    const f = p.locator("#sellForm");
    await f.waitFor();
    // «Prueba gratis» va debajo.
    assert.ok(await p.evaluate(() => !!(document.querySelector(".sellcard").compareDocumentPosition(document.querySelector("#trialForm")) & Node.DOCUMENT_POSITION_FOLLOWING)));
    // Un cliente que existe: no ofrece crear.
    await f.locator("[name=customerName]").fill("Ana Ficticia · +59170000001");
    assert.equal(await p.locator("#sellNew").isVisible(), false);
    // Uno que no existe: ofrece crearlo ahí mismo.
    await f.locator("[name=customerName]").fill("Fede Nuevo");
    const create = p.locator("[data-sellnew]");
    await create.waitFor();
    assert.equal(await create.innerText(), '➕ Crear "Fede Nuevo"');
    assert.ok((await create.boundingBox()).height >= 44);
    // Sin WhatsApp: el error va junto al campo, no se crea nada.
    await create.click();
    assert.match(await p.locator(".sellnew-err").innerText(), /WhatsApp/);
    assert.ok(!Object.values(s.engine.s.customers).some((c) => c.name === "Fede Nuevo"));
    await p.locator("#sellNew [name=newPhone]").fill("70012345");
    await create.click();
    await p.waitForFunction(() => /Fede Nuevo · \+?591?70012345/.test(document.querySelector("#sellForm [name=customerName]").value), null, { timeout: 10_000 });
    const fede = Object.values(s.engine.s.customers).find((c) => c.name === "Fede Nuevo");
    assert.ok(fede, "se creó el cliente");
    assert.equal(await p.locator("#sellNew").isVisible(), false);
    // La venta sigue sin ir a Clientes.
    await p.locator('[data-pick="nf"]').click();
    const btn = p.locator("#sellBtn");
    await p.waitForFunction(() => !document.querySelector("#sellBtn").disabled);
    assert.match(await btn.innerText(), /Vender a Fede Nuevo/);
    await btn.click();
    await p.waitForFunction(() => /Venta registrada/.test(document.body.innerText), null, { timeout: 15_000 });
    assert.ok(Object.values(s.engine.s.assignments).some((a) => a.customerId === fede.id && a.status === "active"));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errs, []);
  } finally { await t.close(); }
});
