// Arreglos de la revisión del revendedor (14/11/2026), en el celular con datos ficticios:
// 1) dar un cupo propio ya no trae un cliente elegido (antes un toque en Guardar se lo daba al primero de la lista);
// 2) una cuenta que renueva la tienda siempre tiene «Pedir renovación» (pedido propio desde R2) y dice hasta cuándo anda;
// 3) renovar un perfil repartido: tres botones claros y «No renovar» no renueva (antes Cancelar igual renovaba);
// 4) el independiente no ve el formulario para comprar a la tienda en «Clientes y ventas».
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 86_400_000;

test("Revendedor: cupo sin cliente elegido, «Pedir renovación», renovar perfil con «No renovar» y el independiente sin compra a la tienda", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-rarr-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { "dis-alq": 7000 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  // El proveedor vence en 20 días: el alquiler de 30 no se puede renovar hasta que la tienda renueve.
  s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "andes", email: "alq@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 20 * DAY, cost: 5000, profiles: [{ label: "Cuenta completa" }] });
  const ana = s.catalog.createCustomer(owner, { name: "Ana Prueba", phone: "+59171000033", kind: "reseller", priceGroupId: "rev" });
  s.wallet.adjust(owner, ana.id, 50000, "carga de prueba");
  const A = { id: "u_" + ana.id, role: "reseller", customerId: ana.id };
  const aid = s.orders.create(A, { customerId: ana.id, items: [{ productId: "dis-alq", qty: 1 }], paymentMethod: "balance", idempotencyKey: "alq" }).assignmentIds[0];
  s.subs.save(A, aid, { name: "Rosa", phone: "+59171112233", expiresAt: Date.now() + 2 * DAY, price: 1500, pay: "pagado" });
  // Cuenta propia con dos clientes ya cargados (el primero por orden alfabético es «Álvaro»).
  const id = (x) => x.id ?? x.product?.id ?? x.account?.id;
  const pFl = s.own.saveProduct(A, { name: "Flujo TV", emoji: "📡", durationDays: 30, price: 3000, kind: "profiles", slots: 3 });
  const acc = s.own.saveAccount(A, { productId: id(pFl), user: "flujo.uno", password: "Clave-1234", slots: 3 });
  s.own.assign(A, { accountId: id(acc), name: "Álvaro", phone: "70011111", price: 3000, pay: "pagado" });
  s.own.assign(A, { accountId: id(acc), name: "Zoe", phone: "70022222", price: 3000, pay: "pagado" });
  // Clientes registrados de Ana (los que aparecen en la lista de «Cliente»).
  s.catalog.createCustomer(A, { name: "Álvaro Cliente", phone: "+59160000001" });
  s.catalog.createCustomer(A, { name: "Zoe Cliente", phone: "+59160000002" });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${ana.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: ana.phone, pin })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); localStorage.setItem("gs-acc-view", "clasica"); } catch { /* sin almacenamiento */ } }, ana.id);
    const [n, v] = rck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));

    // 2) «Pedir renovación» en la cuenta que renueva la tienda.
    await p.goto(base + "/hub#cuentas");
    await p.locator(".svc").first().waitFor();
    const svc = await p.locator(".svc").first().innerText();
    // R2 (14/11): el texto dice por qué y «📩 Pedir renovación» es un pedido propio (no una falla «No me deja entrar»).
    assert.match(svc, /Para renovarla, la tienda primero renueva con su proveedor\. Te anda hasta el/);
    const ask = p.locator(".svc [data-rrqask]", { hasText: "Pedir renovación" });
    assert.equal(await ask.count(), 1, "pide la renovación como pedido propio");
    assert.ok((await ask.boundingBox()).height >= 44);

    // 3) Renovar a Rosa: «No renovar» no renueva; «Sí, ya me pagó» sí.
    const before = s.subs.list(A).find((r) => r.assignmentId === aid).subs[0].expiresAt;
    const tool = async (k) => { await p.goto(base + "/hub#mas"); await p.locator(`#sout .hubarea-i[data-rtool="${k}"]`).click(); await p.waitForFunction((x) => document.querySelector(`[data-rtab="${x}"]`)?.getAttribute("aria-selected") === "true", k); };
    await tool("perfiles");
    const rb = p.locator("[data-subrenew]").first();
    if (!(await rb.isVisible())) await p.locator("[data-subopen]").first().click();
    await rb.click();
    await p.locator("#modal", { hasText: "¿Ya te pagó la renovación?" }).waitFor();
    await p.locator("#modal button", { hasText: "No renovar" }).click();
    await p.waitForTimeout(300);
    assert.equal(s.subs.list(A).find((r) => r.assignmentId === aid).subs[0].expiresAt, before, "«No renovar» no tocó la fecha");
    await rb.click();
    await p.locator("#modal button", { hasText: "Sí, ya me pagó" }).click();
    await p.waitForFunction(() => /renovado hasta/.test(document.body.innerText));
    assert.ok(s.subs.list(A).find((r) => r.assignmentId === aid).subs[0].expiresAt > before, "«Sí, ya me pagó» renovó");

    // 1) Darle un cupo: sin cliente elegido; Guardar sin elegir no se lo da a nadie.
    const salesBefore = JSON.stringify(s.engine.s.ownStock[ana.id].sales?.length ?? 0);
    await tool("propias");
    if (!(await p.locator('button[data-os="account"]').count())) await p.locator('[data-os="product"]').first().click();
    await p.locator('button[data-os="account"]').first().click();
    const form = p.locator('form[data-osf="assign"]').first();
    await form.waitFor();
    assert.equal(await form.locator('select[name="who"]').inputValue(), "", "ningún cliente elegido de antemano");
    await form.locator('button[type="submit"]').click();
    await p.waitForTimeout(400);
    assert.equal(JSON.stringify(s.engine.s.ownStock[ana.id].sales?.length ?? 0), salesBefore, "sin elegir cliente no se guarda nada");

    // 4) Independiente: en «Clientes y ventas» no está el formulario de compra a la tienda.
    await post(`/api/admin/customers/${ana.id}/trust`, { trust: "independent" }, ock);
    await p.reload();
    await tool("ventas");
    await p.locator("#sout", { hasText: "Ir a Mis cuentas propias" }).waitFor();
    assert.equal(await p.locator("#resSell").count(), 0);
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
