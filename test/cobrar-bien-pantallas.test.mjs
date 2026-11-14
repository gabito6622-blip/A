// Cobrar y vender sin trabas (revisión de 3 meses, 14/11/2026): las pantallas, en el celular (360 px, claro y oscuro).
// Datos ficticios, carpeta temporal, ningún WhatsApp real (wa.me bloqueado en el navegador; el bot no está configurado).
//   Mi secretaria: «avisos no salen» (bot apagado), aviso preparado, «Me pagó lo que debía» vs «Me pagó y renueva»,
//   «¿Es otro mes?», «Proveedores por renovar», apartadas con el ex cliente y «✅ Liberar», secciones plegables.
//   Vender: buscar sin tildes ni orden, sugerencias grandes, el botón no se traba, teléfono repetido → elegir ese
//   cliente, «ya tiene Netflix: ¿otro perfil o renovar?».
//   Control: buscar sin tildes, «Era una prueba / Me equivoqué», cambiar de plataforma, «Ver más», filtros plegados.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { matches, matchCustomers, resolveCustomer } from "../public/buscar.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const PASS = "clave-del-dueño-123";
const dm = (t) => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }); // «13/01» (es-BO sin año daba «13/1»)

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-eq2-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", PASS);
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "max", name: "Max", kind: "profile", durationDays: 30, price: 3000, published: true });
  const addAcc = (productId, email, supDays, n = 1) => { const r = s.inventory.addAccount(owner, { productId, email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + supDays * DAY, cost: 1000, profiles: Array.from({ length: n }, (_, i) => ({ label: `P${i + 1}` })) }); return r.account ?? r; };
  const cust = (name, phone, consent = true) => s.catalog.createCustomer(owner, { name, phone, whatsappConsent: consent });
  const sell = (c, productId = "nf", pay = "pagado", expDays) => {
    const o = s.orders.create(owner, { customerId: c.id, items: [{ productId, qty: 1 }], paymentMethod: "cash" });
    const id = o.assignmentIds[0];
    if (expDays !== undefined) s.orders.setExpiry(owner, id, Date.now() + expDays * DAY);
    s.orders.setControl(owner, id, { payStatus: pay });
    return id;
  };
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: PASS }) })).headers.get("set-cookie").split(";")[0];
  const b = chromium ? await chromium.launch() : null;
  const page = async (width = 360, colorScheme = "light") => {
    const ctx = await b.newContext({ viewport: { width, height: 780 }, colorScheme, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const [n, v] = ck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    return { p, errs, ctx };
  };
  return { s, owner, addAcc, cust, sell, base, page, A: (id) => s.engine.s.assignments[id], close: async () => { await b?.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}
/** Sin desborde, botones visibles de 44 px o más y letra de 12 px o más. */
const fit = (p, sel) => p.evaluate((sel) => {
  const vis = (x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
  const root = document.querySelector(sel) ?? document.body;
  return {
    over: document.documentElement.scrollWidth > innerWidth + 1,
    small: [...root.querySelectorAll("button, a.pbtn, select")].filter((x) => vis(x) && x.getBoundingClientRect().height < 43.5).map((x) => x.textContent.trim().slice(0, 40)),
    tiny: [...root.querySelectorAll("*")].filter((x) => vis(x) && x.childElementCount === 0 && x.textContent.trim() && parseFloat(getComputedStyle(x).fontSize) < 12).map((x) => x.textContent.trim().slice(0, 30)),
  };
}, sel);

test("buscar.js: sin tildes, en cualquier orden y por parte del número; resolver sin tocar la sugerencia", () => {
  const map = { "María Chávez · +59171009911": "c1", "María Choque · +59171005522": "c2", "Ana Quispe · +59171002233": "c3" };
  assert.ok(matches("Irene Gutiérrez · +59160012345", "gutierrez irene"));
  assert.ok(matches("Ana Quispe · +59171002233", "710"));
  assert.ok(!matches("Ana Quispe", "ana torres"));
  assert.deepEqual(matchCustomers(map, "maria").map((x) => x.id), ["c1", "c2"]);
  assert.deepEqual(matchCustomers(map, "7100").map((x) => x.id).sort(), ["c1", "c2", "c3"]);
  assert.equal(resolveCustomer(map, "quispe ana")?.id, "c3", "nombre y apellido en otro orden: es ella");
  assert.equal(resolveCustomer(map, "Ana Quispe")?.id, "c3", "el nombre exacto sin el número");
  assert.equal(resolveCustomer(map, "71002233")?.id, "c3", "el número completo");
  assert.equal(resolveCustomer(map, "maria"), null, "dos Marías: hay que elegir");
  assert.equal(resolveCustomer(map, "ana"), null, "una palabra sola puede ser un cliente nuevo: se pide tocar la sugerencia");
});

test("Mi secretaria a 360 px: avisos que no salen, deuda sin correr la fecha, «¿Es otro mes?», proveedores y apartadas", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
  const t = await setup();
  try {
    const { s, owner, A } = t;
    t.addAcc("nf", "nf.uno@ficticio.lat", 120, 4);
    t.addAcc("max", "max.uno@ficticio.lat", 120, 2);
    // Bea vence en 2 días: se le prepara el recordatorio, pero el bot no está: queda «preparado».
    const bea = t.sell(t.cust("Bea Ficticia", "+59171000002"), "nf", "pagado", 2);
    s.orders.queueExpiryReminders(owner, 3);
    // Karen: venta fiada (debe la venta).
    const karen = t.sell(t.cust("Karen Limachi", "+59171000003"), "nf", "pendiente");
    // Iván: venta pagada hoy y «EN COBRO» en la nota (el dueño se confundió): «Me pagó» pregunta «¿Es otro mes?».
    const ivan = t.sell(t.cust("Iván Callisaya", "+59171000004"), "nf", "pagado");
    s.orders.setControl(owner, ivan, { note: "🔔 EN COBRO" });
    // Fabio: cobro anotado que pasa la fecha del proveedor (cuenta corta; se carga después para que nadie más caiga ahí).
    const corta = t.addAcc("nf", "nf.corta@ficticio.lat", 20, 1);
    const fab = s.orders.create(owner, { customerId: t.cust("Fabio Vargas", "+59171000005").id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [Object.values(s.engine.s.slots).find((x) => x.accountId === corta.id).id] }).assignmentIds[0];
    s.orders.setExpiry(owner, fab, Date.now() + 10 * DAY);
    s.cobro.apply(owner, fab, { idempotencyKey: "fab" });
    // Abel: cambió de perfil → el viejo queda apartado con su nombre.
    const abel = t.sell(t.cust("Abel Cusi", "+59171000006"), "max");
    const abelOld = A(abel).slotId;
    s.orders.replace(owner, abel, { reason: "no le entra" });
    const karenExp = A(karen).customerExpiresAt, ivanExp = A(ivan).customerExpiresAt;

    for (const [width, scheme] of [[360, "dark"], [390, "light"]]) {
      const { p, errs, ctx } = await t.page(width, scheme);
      await p.goto(t.base + "/panel#secretaria");
      await p.locator(".sec-hero").waitFor();
      assert.match(await p.locator(".sec-botoff").innerText(), /Los avisos automáticos no salen: el bot está apagado/);
      // Lo urgente abierto; lo que no es de hoy, plegado con el número a la vista.
      assert.equal(await p.locator("#sec-avisar").getAttribute("open"), "");
      assert.equal(await p.locator("#sec-apartadas").getAttribute("open"), null);
      assert.match(await p.locator("#sec-apartadas > summary").innerText(), /Apartadas.*1/s);
      const beaG = p.locator("#sec-avisar .sec-group", { hasText: "Bea Ficticia" });
      assert.match(await beaG.innerText(), /Aviso preparado, no salió \(el bot está apagado\)/);
      assert.equal(await beaG.locator(".sec-noticed").count(), 0, "no figura «avisado»");
      assert.equal(await beaG.locator("a[href*='wa.me']").count(), 1, "botón de WhatsApp manual");
      assert.deepEqual(await fit(p, "#pout"), { over: false, small: [], tiny: [] }, `secretaria ${width} ${scheme}`);
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    const { p, errs } = await t.page(360);
    await p.goto(t.base + "/panel#secretaria");
    // Karen: dos botones distintos; «Me pagó lo que debía» no corre la fecha.
    const kg = p.locator("#sec-deben .sec-group", { hasText: "Karen Limachi" });
    await kg.waitFor();
    assert.equal(await kg.locator("[data-secdebt]").innerText(), "💵 Me pagó lo que debía");
    assert.equal(await kg.locator("[data-secpay]").innerText(), "🔄 Me pagó y renueva");
    await kg.locator("[data-secdebt]").click();
    assert.match(await kg.locator(".sec-pvbox").innerText(), /La fecha no cambia: sigue venciendo el/);
    await kg.locator("[data-secdebtok]").click();
    await p.waitForFunction(() => !/Karen Limachi/.test(document.querySelector("#sec-deben")?.innerText ?? ""), null, { timeout: 15_000 });
    assert.equal(A(karen).customerExpiresAt, karenExp, "no corrió la fecha");
    assert.equal(A(karen).control.payStatus, "pagado");
    // Iván: «¿Es otro mes?» antes de guardar; sin marcar, no guarda.
    const ig = p.locator(".sec-group", { hasText: "Iván Callisaya" });
    await ig.locator("[data-secpay]").click();
    await ig.locator(".sec-double").waitFor();
    assert.match(await ig.locator(".sec-double").innerText(), new RegExp(`Ya anotaste un cobro el ${dm(Date.now())} \\(Bs 35\\).*¿Es otro mes\\?`));
    await ig.locator("[data-secpayok]").click();
    await p.waitForTimeout(400);
    assert.equal(A(ivan).customerExpiresAt, ivanExp, "sin marcar «es otro mes» no se anota");
    await ig.locator('[name="otro"]').check();
    await ig.locator("[data-secpayok]").click();
    await p.waitForFunction(() => !/Iván Callisaya/.test(document.querySelector("#sec-cobrar")?.innerText ?? ""), null, { timeout: 15_000 });
    assert.equal(A(ivan).customerExpiresAt, ivanExp + 30 * DAY);
    // Proveedores por renovar: la cuenta corta con Fabio.
    const prov = p.locator("#sec-proveedores");
    if ((await prov.getAttribute("open")) === null) await prov.locator("summary").click();
    assert.match(await prov.innerText(), new RegExp(`nf\\.corta@ficticio\\.lat[\\s\\S]*renová antes del ${dm(s.engine.s.accounts[corta.id].supplierExpiresAt)}[\\s\\S]*Fabio Vargas`));
    // Apartadas: «era de Abel Cusi» y «✅ Liberar» (1 toque + confirmación).
    await p.locator("#sec-apartadas > summary").click();
    const slot = p.locator("#sec-apartadas .sec-slot");
    assert.match(await slot.innerText(), /era de Abel Cusi/);
    let msg = "";
    p.once("dialog", (d) => { msg = d.message(); d.accept(); });
    await slot.locator("[data-secfree]").click();
    await p.waitForFunction(() => !document.querySelector("#sec-apartadas"), null, { timeout: 15_000 });
    assert.match(msg, /Liberar max\.uno@ficticio\.lat · P1 \(era de Abel Cusi\)/);
    assert.equal(s.engine.s.slots[abelOld].status, "available");
    assert.deepEqual(await fit(p, "#pout"), { over: false, small: [], tiny: [] });
    assert.deepEqual(errs, []);
    void bea;
  } finally { await t.close(); }
});

test("Vender a 360 px: «quispe ana» sin tocar la sugerencia, «maria» con botones grandes, teléfono repetido y «¿otro perfil o renovar?»", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
  const t = await setup();
  try {
    const { s, A } = t;
    t.addAcc("nf", "nf.uno@ficticio.lat", 120, 6);
    const ana = t.cust("Ana Quispe", "+59171002233");
    t.cust("María Chávez", "+59171009911"); t.cust("María Choque", "+59171005522");
    const anaNf = t.sell(ana, "nf", "pagado");
    for (const [width, scheme] of [[360, "dark"], [390, "light"]]) {
      const { p, errs, ctx } = await t.page(width, scheme);
      await p.goto(t.base + "/panel#vender");
      const f = p.locator("#sellForm");
      await f.waitFor();
      // «maria»: dos sugerencias grandes; tocar una la elige.
      await f.locator("[name=customerName]").fill("maria");
      const picks = p.locator("#sellNew [data-sellpick]");
      await picks.first().waitFor();
      assert.deepEqual((await picks.allInnerTexts()).map((x) => x.trim()), ["¿Es María Chávez · +59171009911?", "¿Es María Choque · +59171005522?"]);
      assert.ok((await picks.first().boundingBox()).height >= 44);
      assert.deepEqual(await fit(p, "#sellForm"), { over: false, small: [], tiny: [] }, `vender ${width} ${scheme}`);
      await picks.nth(1).click();
      assert.equal(await f.locator("[name=customerName]").inputValue(), "María Choque · +59171005522");
      assert.equal(await p.locator("#sellNew").isVisible(), false);
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    const { p, errs } = await t.page(360);
    await p.goto(t.base + "/panel#vender");
    const f = p.locator("#sellForm");
    await f.waitFor();
    // «quispe ana» sin tocar la sugerencia: el botón no se traba.
    await f.locator("[name=customerName]").fill("quispe ana");
    await p.locator('[data-pick="nf"]').click();
    await p.waitForFunction(() => !document.querySelector("#sellBtn").disabled, null, { timeout: 10_000 });
    assert.match(await p.locator("#sellBtn").innerText(), /Vender a Ana Quispe/);
    // Ana ya tiene Netflix: pregunta antes de vender.
    await p.locator("#sellBtn").click();
    const dup = p.locator("#sellDup");
    await dup.waitFor();
    assert.match(await dup.innerText(), new RegExp(`Ana ya tiene Netflix hasta el ${dm(A(anaNf).customerExpiresAt)}.*¿Es otro perfil o querías renovar\\?`, "s"));
    assert.equal(Object.values(s.engine.s.assignments).filter((a) => a.customerId === ana.id && a.status === "active").length, 1, "todavía no vendió");
    for (const bb of await dup.locator("button").all()) assert.ok((await bb.boundingBox()).height >= 44);
    // «Renovar»: la venta de hoy ya está cobrada → pregunta «¿Es otro mes?» (dijo que sí).
    const exp0 = A(anaNf).customerExpiresAt;
    let msg = "";
    p.once("dialog", (d) => { msg = d.message(); d.accept(); });
    await dup.locator("[data-selldupren]").click();
    await p.waitForFunction(() => !document.querySelector("#sellDup"), null, { timeout: 15_000 });
    assert.match(msg, /Ya anotaste un cobro/);
    assert.equal(A(anaNf).customerExpiresAt, exp0 + 30 * DAY, "renovó su Netflix");
    // «Es otro perfil»: vende.
    await p.locator("#sellBtn").click();
    await p.locator("#sellDup [data-selldupok]").click();
    await p.waitForFunction(() => /Venta registrada/.test(document.body.innerText), null, { timeout: 15_000 });
    assert.equal(Object.values(s.engine.s.assignments).filter((a) => a.customerId === ana.id && a.status === "active").length, 2);
    // Cliente nuevo con un teléfono que ya existe: ofrece elegir ese cliente en vez del error.
    await p.goto("about:blank");
    await p.goto(t.base + "/panel#vender");
    await p.locator("#sellForm [name=customerName]").waitFor();
    await p.locator("#sellForm [name=customerName]").fill("Mery Chavez Nueva");
    await p.locator("#sellNew [data-sellnew]").waitFor();
    await p.locator("#sellNew [name=newPhone]").fill("71009911");
    await p.locator("#sellNew [data-sellnew]").click();
    const use = p.locator("#sellNew .sellnew-alt [data-sellpick]");
    await use.waitFor();
    assert.match(await use.innerText(), /Usar a María Chávez/);
    await use.click();
    assert.match(await p.locator("#sellForm [name=customerName]").inputValue(), /^María Chávez · /);
    assert.equal(Object.values(s.engine.s.customers).filter((c) => /Chavez Nueva/.test(c.name)).length, 0, "no se creó un duplicado");
    assert.deepEqual(errs, []);
  } finally { await t.close(); }
});

test("Control a 360 px: buscar sin tildes, «Me equivoqué (anular venta)», cambiar de plataforma, «Ver más» y filtros plegados", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
  const t = await setup();
  try {
    const { s, A } = t;
    t.addAcc("nf", "nf.muchos@ficticio.lat", 120, 20); t.addAcc("nf", "nf.mas@ficticio.lat", 120, 10);
    t.addAcc("max", "max.uno@ficticio.lat", 120, 2);
    const irene = t.sell(t.cust("Irene Gutiérrez", "+59160012345"), "nf", "pagado");
    for (let i = 0; i < 27; i++) t.sell(t.cust(`Cliente Relleno ${i + 1}`, `+5917200${String(1000 + i)}`), "nf", "pagado", 3 + i);
    for (const [width, scheme] of [[360, "dark"], [390, "light"]]) {
      const { p, errs, ctx } = await t.page(width, scheme);
      await p.goto(t.base + "/panel#control");
      await p.locator("article.ccard").first().waitFor();
      assert.equal(await p.locator("article.ccard").count(), 25, "de a 25 en el celular");
      assert.match(await p.locator(".ctl-vermas").innerText(), /Ver 3 más/);
      assert.equal(await p.locator(".ctl-fdet").getAttribute("open"), null, "filtros plegados; la búsqueda a la vista");
      assert.ok(await p.locator("#cq").isVisible());
      assert.deepEqual((await fit(p, ".ctl-top")).over, false, `control ${width} ${scheme}`);
      assert.deepEqual(errs, []);
      await ctx.close();
    }
    const { p, errs } = await t.page(360);
    await p.goto(t.base + "/panel#control");
    await p.locator(".ctl-vermas").click();
    await p.waitForFunction(() => document.querySelectorAll("article.ccard").length === 28, null, { timeout: 10_000 });
    // Buscar sin tilde.
    await p.locator("#cq").fill("gutierrez");
    await p.locator("#cq").press("Enter");
    await p.waitForFunction(() => document.querySelectorAll("article.ccard").length === 1, null, { timeout: 10_000 });
    const card = p.locator("article.ccard", { hasText: "Irene Gutiérrez" });
    assert.match(await card.locator("[data-wastest]").innerText(), /Era una prueba \/ Me equivoqué \(anular venta\)/);
    // Cambiar de plataforma: Netflix → Max en un paso, misma fecha.
    const exp = A(irene).customerExpiresAt, oldSlot = A(irene).slotId;
    await card.locator(".swplat > summary").click();
    await card.locator('[name="swto"] option[value="max"]').waitFor({ state: "attached" });
    await card.locator('[name="swto"]').selectOption("max");
    await card.locator("[data-swpv]").click();
    const box = card.locator(".swpbox");
    await box.locator("[data-swok]").first().waitFor();
    assert.match(await box.innerText(), /Pasa a[\s\S]*Max[\s\S]*max\.uno@ficticio\.lat/);
    assert.match(await box.innerText(), /Max cuesta Bs 5 menos/);
    assert.deepEqual(await fit(p, "article.ccard"), { over: false, small: [], tiny: [] });
    await box.locator("[data-swok]").first().click();
    await p.waitForFunction(() => /Listo: ahora tiene Max/.test(document.body.innerText), null, { timeout: 15_000 });
    assert.equal(A(irene).productId, "max"); assert.equal(A(irene).customerExpiresAt, exp);
    assert.equal(s.engine.s.slots[oldSlot].status, "quarantined");
    assert.ok(s.engine.s.audit.some((x) => x.action === "assignment.switch_platform"));
    assert.deepEqual(errs, []);
  } finally { await t.close(); }
});
