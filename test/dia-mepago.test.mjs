// Día a día · cobros (14/11/2026). Requisitos 1, 2 y 3 de la revisión del día a día del dueño:
//   1) La vista previa de «Me pagó» entra en 360 y 390 px: «Confirmar» y «Cancelar» visibles y de 44 px o más.
//   2) Corte automático: se ve «se corta solo el dd/mm» y se puede anotar «Me pagó» de lo que ya se cortó (≤ 30 días)
//      sin vender dos veces un perfil: vuelve a su perfil si sigue libre, si no se ofrece otro, y si no hay se avisa claro.
//      La regla del corte no cambia (vencimiento + 2 días).
//   3) «💳 Renovar proveedor y anotar»: cuando «Me pagó» choca con la fecha del proveedor, anota «Pagué la renovación» y
//      después el cobro, con una confirmación que dice el monto y la nueva fecha del proveedor.
// Datos ficticios, carpetas temporales, ningún WhatsApp real (wa.me bloqueado en el navegador).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { CORTE_GRACE_DAYS } from "../dist/store/dia.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const PASS = "clave-del-dueño-123";

function seed(clock) {
  const dir = mkdtempSync(join(tmpdir(), "gs-equipoA-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, ...(clock ? { clock } : {}) });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  const now = () => (clock ? clock.t : Date.now());
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix Premium Ultra HD (alquiler revendedores)", kind: "profile", durationDays: 30, price: 3000, published: true });
  const addAcc = (email, supDays, labels = ["P1"], cost = 1000) => {
    const r = s.inventory.addAccount(owner, { productId: "nf", email, password: "Clave-Larga#1", supplierExpiresAt: now() + supDays * DAY, cost, profiles: labels.map((label) => ({ label })) });
    return r.account ?? r;
  };
  const slotsOf = (accId) => Object.values(s.engine.s.slots).filter((x) => x.accountId === accId);
  const sell = (customer, slotId, expDays) => {
    const o = s.orders.create(owner, { customerId: customer.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slotId] });
    s.orders.setExpiry(owner, o.assignmentIds[0], now() + expDays * DAY);
    return o.assignmentIds[0];
  };
  return { dir, app, s, owner, addAcc, slotsOf, sell, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
const bases = new WeakMap();
async function login(app, b, width) {
  if (!bases.has(app)) bases.set(app, `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`);
  const base = bases.get(app);
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: PASS }) })).headers.get("set-cookie").split(";")[0];
  const ctx = await b.newContext({ viewport: { width, height: 780 } });
  await ctx.route(/wa\.me|fonts\.(googleapis|gstatic)/, (r) => r.abort());
  const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  return { base, ctx, p, errs };
}

test("1) «Me pagó» en Mi secretaria: la vista previa no se sale a 360 ni a 390 px; Confirmar y Cancelar visibles y de 44 px", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const t = seed();
  const ana = t.s.catalog.createCustomer(t.owner, { name: "Ana María Quispe Mamani de los Andes", phone: "+59170011223" });
  const acc = t.addAcc("una.cuenta.con.correo.muy.largo@ejemplo-proveedor.lat", 90, ["Perfil Mamá", "P2"]);
  const aid = t.sell(ana, t.slotsOf(acc.id)[0].id, -1);
  t.s.orders.setControl(t.owner, aid, { note: "🔔 EN COBRO" });
  const b = await chromium.launch();
  try {
    for (const w of [360, 390]) {
      for (const scheme of ["dark", "light"]) {
        const { base, ctx, p, errs } = await login(t.app, b, w);
        await p.emulateMedia({ colorScheme: scheme });
        await p.goto(base + "/panel#secretaria");
        await p.locator("[data-secpay]").first().click();
        await p.locator(".sec-pvbox").waitFor();
        const ok = p.locator("[data-secpayok]"), no = p.locator(".sec-pvbox [data-secpayno]");
        for (const [name, el] of [["Confirmar", ok], ["Cancelar", no]]) {
          await el.scrollIntoViewIfNeeded();
          const bb = await el.boundingBox();
          assert.ok(bb.height >= 44, `${name} mide ${bb.height}px a ${w}px`);
          assert.ok(bb.x >= 0 && bb.x + bb.width <= w + 0.5, `${name} queda dentro de la pantalla a ${w}px (${bb.x}–${bb.x + bb.width})`);
          assert.ok(await el.isVisible());
        }
        const out = await p.evaluate(() => [...document.querySelectorAll(".sec-pvbox, .sec-pvbox *")].filter((el) => el.getBoundingClientRect().right > innerWidth + 0.5).map((el) => el.className || el.tagName));
        assert.deepEqual(out, [], `nada de la vista previa se sale a ${w}px`);
        assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
        // Cancelar cierra la vista previa.
        await no.click();
        assert.equal(await p.locator(".sec-pvbox").count(), 0);
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    }
  } finally { await b.close(); await t.close(); }
});

test("2) Corte automático: «se corta solo el dd/mm», la regla no cambia y «Me pagó» reactiva sin vender dos veces un perfil", async () => {
  const clock = { t: new Date(new Date().setHours(12, 0, 0, 0)).getTime(), now() { return this.t; } };
  const t = seed(clock);
  const { s, owner } = t;
  const system = { id: "system:jobs", role: "system" };
  try {
    assert.equal(CORTE_GRACE_DAYS, 2, "la regla del corte sigue siendo vencimiento + 2 días");
    const ana = s.catalog.createCustomer(owner, { name: "Ana Ficticia", phone: "+59170000001" });
    const beto = s.catalog.createCustomer(owner, { name: "Beto Ficticio", phone: "+59170000002" });
    const ceci = s.catalog.createCustomer(owner, { name: "Ceci Ficticia", phone: "+59170000003" });
    const dani = s.catalog.createCustomer(owner, { name: "Dani Ficticio", phone: "+59170000004" });
    const A = t.addAcc("a@ejemplo.lat", 120, ["P1", "P2"]);
    const [a1, a2] = t.slotsOf(A.id);
    const idAna = t.sell(ana, a1.id, -1);   // venció ayer: se corta mañana (vencimiento + 2 días)
    const idBeto = t.sell(beto, a2.id, -1);
    // «se corta solo el dd/mm» en Mi secretaria y en el Control (la misma fecha).
    let r = s.stats.secretary(owner);
    const it = r.sinAnotar.flatMap((g) => g.items).find((i) => i.assignmentId === idAna);
    assert.equal(it.cutAt, s.engine.s.assignments[idAna].customerExpiresAt + 2 * DAY);
    const row = s.admin.assignments(owner, {}).find((x) => x.id === idAna);
    assert.equal(row.cutAt, it.cutAt);
    // Hoy no se corta nada (vencido hace 1 día < 2 de gracia); pasado el plazo, sí: la regla de siempre.
    assert.equal(s.orders.closeExpired(system, CORTE_GRACE_DAYS), 0);
    clock.t += 2 * DAY;
    assert.equal(s.orders.closeExpired(system, CORTE_GRACE_DAYS), 2);
    assert.equal(s.engine.s.assignments[idAna].status, "revoked");
    assert.equal(s.engine.s.slots[a1.id].status, "quarantined");
    // Aparecen en «Se cortaron solos» y «Me pagó» de siempre ya no sirve.
    r = s.stats.secretary(owner);
    assert.deepEqual(r.cortados.map((x) => x.name).sort(), ["Ana Ficticia", "Beto Ficticio"]);
    assert.equal(s.cobro.preview(owner, idAna).ok, false);

    // a) Su perfil sigue libre (apartado, nadie adentro): vuelve al mismo y se anota el cobro.
    let pv = s.dia.reactivatePreview(owner, idAna);
    assert.equal(pv.ok, true, pv.blockers.join(" | "));
    assert.equal(pv.mode, "same");
    const res = s.dia.reactivate(owner, idAna, { price: 3000, idempotencyKey: "k1" });
    const a = s.engine.s.assignments[idAna];
    assert.deepEqual([a.status, a.slotId, s.engine.s.slots[a1.id].status], ["active", a1.id, "assigned"]);
    assert.equal(a.customerExpiresAt, clock.t + 30 * DAY, "el período nuevo arranca hoy");
    assert.equal(a.control.payStatus, "pagado");
    assert.equal(a.control.paidLog.at(-1).amount, 3000);
    assert.equal(res.reactivated.changedSlot, false);
    // Doble toque: misma llave, mismo resultado, nada se duplica.
    s.dia.reactivate(owner, idAna, { price: 3000, idempotencyKey: "k1" });
    assert.equal(a.control.paidLog.length, 1);
    assert.match(s.dia.reactivatePreview(owner, idAna).blockers[0], /sigue activo/);

    // b) El perfil de Beto ya se lo vendieron a Ceci: se ofrece otro perfil libre de la misma plataforma.
    s.inventory.setSlotStatus(owner, a2.id, "available", "revisado");
    const idCeci = t.sell(ceci, a2.id, 20);
    const B = t.addAcc("b@ejemplo.lat", 120, ["Q1"]);
    pv = s.dia.reactivatePreview(owner, idBeto);
    assert.equal(pv.mode, "other");
    assert.deepEqual(pv.options.map((o) => o.email), ["b@ejemplo.lat"]);
    assert.match(pv.warnings.join(" "), /ya lo tiene otro cliente/);
    // Pedir el perfil de Ceci a mano: frena (nunca dos clientes en un perfil).
    assert.throws(() => s.dia.reactivate(owner, idBeto, { toSlotId: a2.id }), /ya no está libre/);
    const rb = s.dia.reactivate(owner, idBeto, { price: 2800 });
    assert.equal(rb.reactivated.changedSlot, true);
    const beto2 = s.engine.s.assignments[idBeto];
    assert.equal(beto2.slotId, t.slotsOf(B.id)[0].id);
    assert.equal(s.engine.s.assignments[idCeci].slotId, a2.id, "Ceci sigue en su perfil");
    const active = Object.values(s.engine.s.assignments).filter((x) => x.status === "active");
    assert.equal(new Set(active.map((x) => x.slotId)).size, active.length, "ningún perfil con dos clientes");

    // c) Sin perfiles libres: aviso claro y no se guarda nada.
    const idDani = t.sell(dani, t.slotsOf(t.addAcc("c@ejemplo.lat", 120, ["R1"]).id)[0].id, -3);
    clock.t += DAY;
    assert.equal(s.orders.closeExpired(system, CORTE_GRACE_DAYS), 1);
    const r1 = t.slotsOf(Object.values(s.engine.s.accounts).find((x) => x.email === "c@ejemplo.lat").id)[0];
    s.inventory.setSlotStatus(owner, r1.id, "available", "revisado");
    t.sell(ceci, r1.id, 10); // otra clienta ocupa el perfil de Dani
    const before = structuredClone(s.engine.s.assignments[idDani]);
    pv = s.dia.reactivatePreview(owner, idDani);
    assert.equal(pv.ok, false);
    assert.equal(pv.mode, "none");
    assert.match(pv.blockers[0], /no hay otro perfil libre de Netflix/);
    assert.throws(() => s.dia.reactivate(owner, idDani, {}), /no hay otro perfil libre/);
    assert.deepEqual(s.engine.s.assignments[idDani], before, "no cambió nada");

    // d) Más de 30 días después del corte: ya no se ofrece.
    clock.t += 31 * DAY;
    assert.ok(!s.stats.secretary(owner).cortados.some((x) => x.assignmentId === idDani));
    assert.match(s.dia.reactivatePreview(owner, idDani).blockers[0], /más de 30 días/);

    // Permisos: Atención (seller) y un revendedor no reactivan ni ven la lista.
    const seller = { id: "st_x", role: "seller" }, rev = { id: "u_x", role: "reseller", customerId: ana.id };
    for (const who of [seller, rev]) {
      assert.throws(() => s.dia.reactivable(who), (e) => e.code === "FORBIDDEN");
      assert.throws(() => s.dia.reactivate(who, idDani, {}), (e) => e.code === "FORBIDDEN");
    }
    assert.ok(s.engine.s.audit.some((x) => x.action === "secretary.reactivated" && x.entityId === idAna));
  } finally { await t.close(); }
});

test("2) En el panel: «se corta solo» en Mi secretaria y en el Control, y «Me pagó · reactivar» a 360 px", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const t = seed();
  const { s, owner } = t;
  const ana = s.catalog.createCustomer(owner, { name: "Ana Ficticia", phone: "+59170000001" });
  const ema = s.catalog.createCustomer(owner, { name: "Ema Ficticia", phone: "+59170000005" });
  const A = t.addAcc("a@ejemplo.lat", 120, ["P1", "P2"]);
  const [a1, a2] = t.slotsOf(A.id);
  const idAna = t.sell(ana, a1.id, -3);
  t.sell(ema, a2.id, 0); // vence hoy: se corta en 2 días
  s.orders.closeExpired({ id: "system:jobs", role: "system" }, CORTE_GRACE_DAYS); // Ana se corta (venció hace 3 días)
  const b = await chromium.launch();
  try {
    const { base, p, errs } = await login(t.app, b, 360);
    await p.goto(base + "/panel#secretaria");
    await p.locator("#sec-cortados").waitFor();
    const cut = new Date(s.engine.s.assignments[Object.keys(s.engine.s.assignments).find((k) => k !== idAna)].customerExpiresAt + 2 * DAY).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" });
    assert.match(await p.locator(".sec-card").filter({ hasText: "Ema Ficticia" }).first().innerText(), new RegExp(`se corta solo el ${cut}`));
    await p.locator("[data-secreact]").click();
    await p.locator(".sec-pvbox").waitFor();
    assert.match(await p.locator(".sec-pvbox").innerText(), /Su mismo perfil/);
    const ok = p.locator("[data-secreactok]");
    assert.ok((await ok.boundingBox()).height >= 44);
    await ok.click();
    await p.waitForFunction(() => !document.querySelector("#sec-cortados"), null, { timeout: 15_000 });
    assert.equal(s.engine.s.assignments[idAna].status, "active");
    // Control: la tarjeta de Ema dice cuándo se corta sola.
    await p.goto("about:blank");
    await p.goto(base + "/panel#control");
    const card = p.locator("article.ccard").filter({ has: p.locator("header b", { hasText: "Ema Ficticia" }) });
    await card.waitFor();
    assert.match(await card.innerText(), new RegExp(`se corta solo el ${cut}`));
    assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
    assert.deepEqual(errs, []);
  } finally { await b.close(); await t.close(); }
});

test("3) «💳 Renovar proveedor y anotar»: anota la renovación del proveedor y el cobro juntos, con monto y fecha a la vista", { skip: !chromium && "Playwright no está instalado", timeout: 120_000 }, async () => {
  const t = seed();
  const { s, owner } = t;
  const ana = s.catalog.createCustomer(owner, { name: "Ana Ficticia", phone: "+59170000001" });
  const A = t.addAcc("corta@ejemplo.lat", 10, ["P1"], 3500); // el proveedor vence en 10 días
  const aid = t.sell(ana, t.slotsOf(A.id)[0].id, -1);
  try {
    // Vista previa: la fecha del proveedor ya no frena (decisión (b), 14/11): avisa y trae la sugerencia (1 mes, Bs 35, nueva fecha).
    const pv = s.cobro.preview(owner, aid);
    assert.equal(pv.ok, true);
    assert.match(pv.supplierWarn.text, /Renová el proveedor antes del/);
    assert.equal(pv.supplierRenew.months, 1);
    assert.equal(pv.supplierRenew.amount, 3500);
    assert.ok(pv.supplierRenew.to >= pv.to);
    // Atención (seller) no anota gastos de cuentas: no ve la sugerencia ni puede usarla.
    assert.throws(() => s.cobro.preview({ id: "st_x", role: "seller" }, aid), (e) => e.code === "FORBIDDEN");
    assert.throws(() => s.dia.payWithSupplier({ id: "st_x", role: "seller" }, aid, {}), (e) => e.code === "FORBIDDEN");
    // Si el panel mostró otros meses (datos viejos), frena y no guarda nada.
    const accBefore = structuredClone(s.engine.s.accounts[A.id]);
    assert.throws(() => s.dia.payWithSupplier(owner, aid, { months: 3 }), /cambiaron/);
    assert.deepEqual(s.engine.s.accounts[A.id], accBefore);

    const b = await chromium.launch();
    try {
      const { base, p, errs } = await login(t.app, b, 360);
      await p.goto(base + "/panel#secretaria");
      await p.locator("[data-secpay]").first().click();
      const btn = p.locator("[data-secsup]");
      await btn.waitFor();
      assert.match(await btn.innerText(), /Renovar proveedor y anotar/);
      assert.ok((await btn.boundingBox()).height >= 44);
      await btn.click();
      const box = p.locator(".sec-supbox");
      await box.waitFor();
      const txt = await box.innerText();
      assert.match(txt, /Bs\s?35/, "dice el monto");
      assert.match(txt, new RegExp(new Date(pv.supplierRenew.to).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" }).replace(/\//g, "\\/")), "dice la nueva fecha del proveedor");
      const ok = p.locator("[data-secsupok]");
      const bb = await ok.boundingBox();
      assert.ok(bb.height >= 44 && bb.x + bb.width <= 360.5);
      await ok.click();
      await p.waitForFunction(() => !document.querySelector(".sec-supbox"), null, { timeout: 15_000 });
      assert.deepEqual(errs, []);
    } finally { await b.close(); }
    const acc = s.engine.s.accounts[A.id], a = s.engine.s.assignments[aid];
    assert.equal(acc.supplierExpiresAt, pv.supplierRenew.to, "la fecha del proveedor es la que se mostró");
    assert.ok(s.engine.s.expenses.some((x) => x.accountId === A.id && x.amount === 3500), "el pago al proveedor queda en Finanzas");
    assert.equal(a.control.payStatus, "pagado");
    assert.ok(a.customerExpiresAt <= acc.supplierExpiresAt, "el cliente no pasa al proveedor");
    assert.ok(s.engine.s.audit.some((x) => x.action === "account.renew_paid") && s.engine.s.audit.some((x) => x.action === "secretary.paid"));
    // El próximo período arranca donde termina el que se acaba de cobrar (no se cobra dos veces el mismo).
    assert.equal(s.cobro.preview(owner, aid).from, a.customerExpiresAt);
  } finally { await t.close(); }
});
