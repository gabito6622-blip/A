// Revisión del revendedor en el celular (20/11/2026): «que se sientan cómodos». Arreglos chicos, con datos ficticios:
// 1) el link de códigos por cuenta sigue a la cuenta elegida en la bandeja (antes: 16 tarjetas para bajar);
// 2) una cuenta ya vencida no dice «te anda hasta el» una fecha pasada;
// 3) cambiar el PIN pide el nuevo dos veces y el error queda junto al formulario;
// 4) movimientos del saldo con el monto a la derecha, números de la bandeja de 12 px y «Por renovar» como en Inicio;
// 5) link pausado: se explica que el cliente no ve códigos.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";
import { accLinksShown } from "../public/hub-codigos.js";
import { myPinFields, myPinProblem } from "../public/hub-pin.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 86_400_000;

test("accLinksShown: la cuenta elegida, lo buscado, las dos cosas y «todas»", () => {
  const L = [{ email: "netflix02@prov.lat", product: "Netflix" }, { email: "disney09@prov.lat", product: "Disney+" }, { email: "netflix03@prov.lat", product: "Netflix" }];
  assert.equal(accLinksShown(L).length, 3, "sin elegir nada: todas");
  assert.deepEqual(accLinksShown(L, "NETFLIX02@prov.lat").map((a) => a.email), ["netflix02@prov.lat"], "el botón de la cuenta (sin importar mayúsculas)");
  assert.deepEqual(accLinksShown(L, "", "disney").map((a) => a.email), ["disney09@prov.lat"], "busca también por el nombre de la app");
  assert.deepEqual(accLinksShown(L, "", " netflix ").length, 2);
  assert.deepEqual(accLinksShown(L, "netflix03@prov.lat", "disney"), [], "cuenta elegida y búsqueda que no coincide: nada");
  assert.deepEqual(accLinksShown(null, "x"), []);
});

test("myPinProblem: 4 números, los dos iguales y distinto del actual", () => {
  assert.equal(myPinProblem({ current: "1111", pin: "4826", pin2: "4826" }), "");
  assert.equal(myPinProblem({ current: "", pin: "4826", pin2: "4826" }), "", "sin PIN actual (nunca tuvo): se deja");
  assert.match(myPinProblem({ current: "1111", pin: "482", pin2: "482" }), /4 números/);
  assert.match(myPinProblem({ current: "1111", pin: "48a6", pin2: "48a6" }), /4 números/);
  assert.match(myPinProblem({ current: "1111", pin: "4826", pin2: "4862" }), /no coinciden/);
  assert.match(myPinProblem({ current: "4826", pin: "4826", pin2: "4826" }), /igual al que ya tenés/);
  const html = myPinFields();
  for (const n of ["current", "pin", "pin2"]) assert.match(html, new RegExp(`<label>[^<]+<input name="${n}"`), `${n} con su etiqueta`);
  assert.match(html, /Repetí el PIN nuevo/);
  assert.match(html, /class="err mypinerr" role="alert" hidden/);
});

test("Revendedor en el celular: códigos por cuenta, «Venció el», PIN dos veces, movimientos y «Por renovar»", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-rcomodo-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  // 4 cuentas de Netflix; el proveedor vence en 10 días: renovar 30 necesita que la tienda renueve primero.
  for (let i = 1; i <= 4; i++) s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: `netflix0${i}@prov.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 10 * DAY, cost: 1000, profiles: [{ label: "Perfil 1" }] });
  const ari = s.catalog.createCustomer(owner, { name: "Ariana Flores", phone: "+59171234567", kind: "reseller", priceGroupId: "rev" });
  const bru = s.catalog.createCustomer(owner, { name: "Bruno Ledesma", phone: "+59171770001", kind: "reseller", priceGroupId: "rev" });
  const AR = { id: "u_" + ari.id, role: "reseller", customerId: ari.id }, BR = { id: "u_" + bru.id, role: "reseller", customerId: bru.id };
  s.wallet.adjust(owner, ari.id, 50000, "carga de prueba");
  s.wallet.adjust(owner, bru.id, 50000, "carga de prueba");
  const names = ["Camila Rojas", "Rebeca Alanoca de la Fuente Montenegro", "Diego Mamani"];
  const aids = names.map((name, i) => {
    const c = s.catalog.createCustomer(AR, { name, phone: `+5916000000${i}` });
    return s.orders.create(AR, { customerId: c.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance", idempotencyKey: "k" + i }).assignmentIds[0];
  });
  s.orders.setExpiry(owner, aids[0], Date.now() - 6 * DAY); // ya vencida
  s.orders.setExpiry(owner, aids[1], Date.now() + 3 * DAY); // vence esta semana
  // Bruno (otro revendedor) tiene su propia cuenta: nunca aparece en los links de Ariana.
  const cb = s.catalog.createCustomer(BR, { name: "Cliente de Bruno", phone: "+59160000099" });
  s.orders.create(BR, { customerId: cb.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance", idempotencyKey: "kb" });
  const emailOf = (aid) => e.s.accounts[e.s.slots[e.s.assignments[aid].slotId].accountId].email;
  const brunoMail = Object.values(e.s.assignments).filter((a) => a.customerId === cb.id).map((a) => emailOf(a.id))[0];
  const box = s.codes.configureMailbox(owner, { address: "codigos@prov.lat", host: "imap.prov.lat" });
  s.codes.ingest(owner, box.id, { to: emailOf(aids[0]), subject: "Tu código de acceso temporal de Netflix", body: "Tu código es 482913", from: "info@account.netflix.com", receivedAt: Date.now() - 60_000 });

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, b, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b) });
  const b = await chromium.launch();
  try {
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${ari.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: ari.phone, pin })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort()); // nunca sale nada real
    await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); localStorage.setItem("gs-tour-done", "1"); localStorage.setItem("gs-tour-short-done", "1"); localStorage.setItem("gs-acc-view", "clasica"); } catch { /* sin almacenamiento */ } }, ari.id);
    const [n, v] = rck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage();
    const errs = [];
    p.on("pageerror", (x) => errs.push(x.message));
    p.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource/.test(m.text())) errs.push(m.text()); });
    const noOverflow = async (where) => assert.ok(await p.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth), `${where}: sin desborde`);

    // 1) Códigos: al tocar la cuenta arriba, abajo queda solo SU link; «Ver todas» vuelve.
    await p.goto(base + "/hub#codigos");
    await p.locator(".alrow").first().waitFor();
    const total = await p.locator(".alrow").count();
    assert.equal(total, 3, "sus 3 cuentas (las de Bruno no)");
    assert.equal(await p.locator(`[data-acclink="${brunoMail}"]`).count(), 0, "aislamiento: la cuenta de otro revendedor no aparece");
    const small = await p.locator(".mchip small").first().evaluate((x) => parseFloat(getComputedStyle(x).fontSize));
    assert.ok(small >= 12, `número de la bandeja: ${small}px`);
    const pick = emailOf(aids[2]);
    await p.locator(`.mchip[data-cbox="${pick}"]`).click();
    await p.waitForFunction(() => document.querySelectorAll(".alrow").length === 1);
    assert.equal(await p.locator(`.alrow [data-acclink="${pick}"]`).count(), 1, "queda la cuenta elegida");
    assert.match(await p.locator(".alfilt").innerText(), /el link de esta cuenta/);
    assert.ok((await p.locator(".alfilt button").boundingBox()).height >= 44, "«Ver todas» de 44 px");
    // Crear y pausar: se explica que el cliente no ve códigos.
    await p.locator(`[data-acclink="${pick}"][data-accdo="make"]`).click();
    await p.locator(`[data-acclink="${pick}"][data-accdo="pause"]`).click();
    await p.locator(".alpaused").waitFor();
    assert.match(await p.locator(".alpaused").innerText(), /no ve códigos hasta que toques «Activar»/);
    await noOverflow("Códigos filtrados");
    await p.locator(".alfilt button").click();
    await p.waitForFunction((n) => document.querySelectorAll(".alrow").length === n, total);

    // 2) Cuenta ya vencida: «Venció el», no «Te anda hasta el» una fecha pasada. La que vence en 3 días sí «Te anda hasta».
    await p.goto(base + "/hub#cuentas");
    await p.locator(".svc .rlock").first().waitFor();
    const locks = await p.locator(".svc .rlock").allInnerTexts();
    assert.ok(locks.some((t) => /Venció el \d{2}\/\d{2}/.test(t)), "la vencida dice «Venció el»");
    assert.ok(locks.some((t) => /Te anda hasta el \d{2}\/\d{2}/.test(t)), "la que sigue andando dice «Te anda hasta el»");
    assert.equal(locks.filter((t) => /Venció el/.test(t)).length, 1, "solo la vencida");
    assert.ok(locks.every((t) => !/ \.$/.test(t.trim())), "sin espacio suelto antes del punto");

    // 4) «Por renovar» (vencidas + esta semana), igual que el botón de Inicio.
    await p.goto(base + "/hub#clientes");
    await p.waitForFunction(() => /Clientes\s*3/.test(document.querySelector(".rkpis")?.innerText ?? ""));
    assert.match(await p.locator(".rkpis").innerText(), /Por renovar\s*2/);

    // Movimientos del saldo: el monto queda a la derecha, en el mismo renglón que el detalle largo.
    await p.goto(base + "/hub#recargas");
    await p.locator(".line.lmov").first().waitFor();
    const lay = await p.locator(".line.lmov", { hasText: "Rebeca" }).evaluate((l) => { const [a, m] = l.children; const ra = a.getBoundingClientRect(), rm = m.getBoundingClientRect(), rl = l.getBoundingClientRect(); return { sameRow: Math.abs(ra.top - rm.top) < 4, right: rl.right - rm.right }; });
    assert.ok(lay.sameRow, "monto en el mismo renglón");
    assert.ok(lay.right < 2, "monto pegado a la derecha");
    await noOverflow("Saldo y recargas");

    // 3) Cambiar el PIN: si los dos no coinciden, el error queda en el formulario y el PIN no cambia.
    await p.goto(base + "/hub#inicio");
    await p.locator("[data-pinfocus]").click();
    const f = p.locator("#myPin"); await f.waitFor({ state: "visible" });
    await f.locator("[name=current]").fill(pin); await f.locator("[name=pin]").fill("4826"); await f.locator("[name=pin2]").fill("4862");
    await f.locator("[type=submit]").click();
    await f.locator(".mypinerr:not([hidden])").waitFor();
    assert.match(await f.locator(".mypinerr").innerText(), /no coinciden/);
    assert.equal((await post("/api/auth/customer/pin", { phone: ari.phone, pin: "4826" })).status, 401, "no se cambió");
    // PIN actual equivocado: el error del servidor también queda junto al formulario.
    await f.locator("[name=current]").fill(pin === "0000" ? "1111" : "0000"); await f.locator("[name=pin2]").fill("4826");
    await f.locator("[type=submit]").click();
    await p.waitForFunction(() => /PIN actual no es correcto/.test(document.querySelector("#myPin .mypinerr")?.textContent ?? ""));
    // Bien escrito: cambia y desaparece el aviso.
    await f.locator("[name=current]").fill(pin);
    await f.locator("[type=submit]").click();
    await p.waitForFunction(() => !document.querySelector(".pinask"), null, { timeout: 10_000 });
    assert.equal((await post("/api/auth/customer/pin", { phone: ari.phone, pin: "4826" })).status, 200, "entra con su PIN nuevo");
    await noOverflow("Inicio con el PIN");
    assert.deepEqual(errs, [], "sin errores en la consola");
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
