// "Mi secretaria" (12/11/2026): un botón en el Inicio del panel que junta todo lo pendiente en una pantalla:
// cobrar (nota «EN COBRO»), cortar («POR CORTAR»), vencidas sin anotar, quién debe, a quién avisar (vence en 3 días),
// qué desenlazar, qué está libre de verdad, qué está apartado y lo que pasó en las últimas 24 h. Solo lee.
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

function seed() {
  const dir = mkdtempSync(join(tmpdir(), "gs-secretaria-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ (alquiler)", kind: "full_account", durationDays: 30, price: 7000, published: true });
  const add = (email, days = 90, n = 1) => s.inventory.addAccount(owner, { productId: "dis", email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + days * DAY, cost: 3000, profiles: Array.from({ length: n }, (_, i) => ({ label: `P${i + 1}` })) });
  const acc = (x) => x.account ?? x;
  const ana = s.catalog.createCustomer(owner, { name: "Ana Revende", phone: "+59171234567", kind: "reseller" });
  s.catalog.updateCustomer(owner, ana.id, { notes: "Avisar 3 días antes" });
  const beto = s.catalog.createCustomer(owner, { name: "Beto Revende", phone: "+59172345678", kind: "reseller" });
  const sell = (c, email, expDays, control) => {
    acc(add(email));
    const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash" });
    const aid = o.assignmentIds?.[0] ?? o.order?.assignmentIds?.[0];
    s.orders.setExpiry(owner, aid, Date.now() + expDays * DAY);
    if (control) s.orders.setControl(owner, aid, control);
    return aid;
  };
  sell(ana, "cobro.uno@ejemplo.lat", -1, { note: "🔔 EN COBRO desde ayer", price: 6900 });
  sell(ana, "cobro.dos@ejemplo.lat", -1, { note: "🔔 EN COBRO desde ayer", price: 6900 });
  sell(beto, "cortar@ejemplo.lat", -5, { note: "✂️ POR CORTAR: no pagó", price: 6500 });
  sell(beto, "olvidada@ejemplo.lat", -2, { payStatus: "pagado", price: 6500 });
  sell(beto, "debe@ejemplo.lat", 20, { payStatus: "pendiente", price: 6600 });
  sell(ana, "avisar@ejemplo.lat", 2, { payStatus: "pagado", price: 6900 });
  sell(ana, "tranquila@ejemplo.lat", 25, { payStatus: "pagado", price: 6900 });
  // Cuentas sin alquilar: libre lista, libre con proveedor vencido, por desenlazar y apartada.
  acc(add("libre@ejemplo.lat"));
  const vieja = acc(add("libre.vieja@ejemplo.lat"));
  s.inventory.updateAccount(owner, vieja.id, { supplierExpiresAt: Date.now() - 3 * DAY });
  const desen = acc(add("desenlazar@ejemplo.lat"));
  s.inventory.updateAccount(owner, desen.id, { notes: "LIBRE oficialmente. DESENLAZAR del correo de Beto." });
  const apart = acc(add("apartada@ejemplo.lat"));
  s.inventory.updateAccount(owner, apart.id, { notes: "La usa el dueño: cambiar la clave." });
  const slot = Object.values(s.engine.s.slots).find((x) => x.accountId === apart.id);
  s.inventory.setSlotStatus(owner, slot.id, "quarantined", "apartada");
  return { dir, app, s, owner, ana, beto };
}

test("secretaria: separa cobrar, cortar, vencidas, deudas, avisos, desenlazar, libres y apartadas", async () => {
  const { dir, app, s, owner, ana } = seed();
  try {
    const r = s.stats.secretary(owner);
    const mails = (gs) => gs.flatMap((g) => g.items.map((i) => i.email)).sort();
    assert.deepEqual(mails(r.cobrar), ["cobro.dos@ejemplo.lat", "cobro.uno@ejemplo.lat"]);
    assert.equal(r.cobrar.length, 1, "las 2 de Ana van juntas");
    assert.equal(r.cobrar[0].name, "Ana Revende"); assert.equal(r.cobrar[0].total, 13800); assert.equal(r.cobrar[0].note, "Avisar 3 días antes");
    assert.deepEqual(mails(r.cortar), ["cortar@ejemplo.lat"]);
    assert.deepEqual(mails(r.sinAnotar), ["olvidada@ejemplo.lat"], "vencida sin nota, aunque figure pagada del mes pasado");
    assert.deepEqual(mails(r.deben), ["debe@ejemplo.lat"]);
    assert.deepEqual(mails(r.avisar), ["avisar@ejemplo.lat"], "vence en 2 días; la de 25 días no aparece");
    assert.equal(r.avisar[0].items[0].days, 2);
    assert.deepEqual(r.desenlazar.map((a) => a.email), ["desenlazar@ejemplo.lat"]);
    assert.deepEqual(r.libres.listas.map((a) => a.email), ["libre@ejemplo.lat"], "la de desenlazar no figura como lista");
    assert.deepEqual(r.libres.faltaFecha.map((a) => a.email), ["libre.vieja@ejemplo.lat"]);
    assert.deepEqual(r.apartadas.map((a) => a.email), ["apartada@ejemplo.lat"]);
    assert.deepEqual(r.counts, { cobrar: 2, cortar: 1, deben: 1, sinAnotar: 1, avisar: 1, desenlazar: 1, libres: 1, faltaFecha: 1, apartadas: 1, claves: r.counts.claves });
    // El dueño ve lo que pasó; un admin no (no tiene la auditoría); un revendedor no entra.
    assert.ok(Array.isArray(r.actividad) && r.actividad.length > 0);
    assert.equal(s.stats.secretary({ id: "stf_x", role: "admin" }).actividad, null);
    assert.throws(() => s.stats.secretary({ id: "u_" + ana.id, role: "reseller", customerId: ana.id }), /FORBIDDEN|Solo/);
    // Solo lee: no cambia nada.
    const before = JSON.stringify(s.engine.s.assignments);
    s.stats.secretary(owner);
    assert.equal(JSON.stringify(s.engine.s.assignments), before);
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});

test("Mi secretaria en el panel: botón en Inicio y pantalla clara a 360 px", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
  const { dir, app } = seed();
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel.html#inicio");
    await p.fill("input[name=username]", "gabriel"); await p.fill("input[name=password]", "clave-del-dueño-123"); await p.press("input[name=password]", "Enter");
    const btn = p.locator(".sec-cta");
    await btn.waitFor();
    assert.ok((await btn.boundingBox()).height >= 44);
    await btn.click();
    await p.locator(".sec-hero").waitFor();
    const txt = (await p.locator("#pmain, main, body").first().innerText()).replace(/\s+/g, " ");
    for (const want of ["Cobrar ahora", "Cortar", "Vencidas sin anotar", "Te deben", "Avisar", "Desenlazar", "Libres de verdad", "Apartadas", "Lo que pasó"]) assert.match(txt, new RegExp(want), `falta la sección: ${want}`);
    assert.match(txt, /Ana Revende[\s\S]*2 cuentas/);
    assert.match(txt, /📝 Avisar 3 días antes/);
    // "Lo que pasó" viene plegado (en el celular es largo) y se abre con un toque.
    assert.equal(await p.locator("#sec-actividad details[open]").count(), 0);
    await p.locator("#sec-actividad summary").click();
    await p.locator("#sec-actividad .audrow").first().waitFor();
    // Mensaje listo: lleva las cuentas y el total; no hay botón de mensaje para "cortar".
    const href = await p.locator("#sec-cobrar a[href*='wa.me']").first().getAttribute("href");
    const msg = decodeURIComponent(href);
    assert.match(msg, /^https:\/\/wa\.me\/59171234567\?text=Hola Ana/);
    assert.match(msg, /cobro\.uno@ejemplo\.lat/); assert.match(msg, /cobro\.dos@ejemplo\.lat/); assert.match(msg, /Total para renovar: Bs\s?138/);
    assert.equal(await p.locator("#sec-cortar a[href*='wa.me']").count(), 0);
    const m = await p.evaluate(() => ({
      over: document.documentElement.scrollWidth > innerWidth + 1,
      small: [...document.querySelectorAll(".sec-card a.pbtn, .sec-hero button")].filter((x) => x.getBoundingClientRect().height < 44).length,
      tiny: [...document.querySelectorAll(".sec-card, .sec-hero")].flatMap((c) => [...c.querySelectorAll("*")]).filter((x) => x.childElementCount === 0 && x.textContent.trim() && parseFloat(getComputedStyle(x).fontSize) < 12).length,
    }));
    assert.deepEqual(m, { over: false, small: 0, tiny: 0 });
    // También está en el menú (buscando "cobrar").
    assert.ok(await p.locator('#menu button[data-go="secretaria"]').count() >= 1);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
