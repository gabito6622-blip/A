// GaboHub etapa 2 (12/11/2026): Inventario "Por plataforma" junta, por plataforma, las cuentas compradas a la
// tienda, las cuentas completas que reparte y sus cuentas propias. Solo lee: cada fila lleva a su pantalla de siempre.
// Separación: nunca aparece nada de otro revendedor. Datos ficticios, 360 px.
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

test("Inventario por plataforma: tienda + cuentas completas + propias, contadores, Ver y separación", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-hubinv-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500, "dis-alq": 7000 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [1, 2, 3, 4].map((i) => ({ label: `P${i}` })) });
  s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "andes", email: "alq@x.lat", password: "Clave-Larga#2", supplierExpiresAt: Date.now() + 90 * DAY, cost: 5000, profiles: [{ label: "Cuenta completa" }] });

  const mk = (name, phone) => {
    const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" });
    s.wallet.adjust(owner, c.id, 50000, "carga de prueba");
    return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } };
  };
  const ana = mk("Ana Stock", "+59171234567"), otro = mk("Otro Revendedor", "+59172345678");
  // Ana: 2 Netflix de la tienda (uno vence en 3 días, otro ya venció), 1 Disney completo con 2 perfiles repartidos.
  for (const [i, days] of [[0, 3], [1, -2]]) {
    const cl = s.catalog.createCustomer(ana.A, { name: `Cliente ${i}`, phone: `+5916000000${i}` });
    const o = s.orders.create(ana.A, { customerId: cl.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance", idempotencyKey: "nf" + i });
    s.orders.setExpiry(owner, o.assignmentIds[0], Date.now() + days * DAY);
  }
  const aid = s.orders.create(ana.A, { customerId: ana.c.id, items: [{ productId: "dis-alq", qty: 1 }], paymentMethod: "balance", idempotencyKey: "alq" }).assignmentIds[0];
  s.subs.save(ana.A, aid, { name: "Rosa", phone: "+59171112233", expiresAt: Date.now() + 10 * DAY, price: 1500, pay: "pagado" });
  s.subs.save(ana.A, aid, { name: "Pepe", phone: "+59171112244", expiresAt: Date.now() + 12 * DAY, price: 1500, pay: "pendiente" });
  // Ana: cuentas propias. "Netflix" propio (5 cupos, 2 vendidos, vence con su proveedor en 2 días) y Flujo TV sin cupos libres.
  const pNf = s.own.saveProduct(ana.A, { name: "Netflix", emoji: "🎬", durationDays: 30, price: 4500, kind: "profiles", slots: 5 });
  const pFl = s.own.saveProduct(ana.A, { name: "Flujo TV", emoji: "📡", durationDays: 30, price: 3000, kind: "line", slots: 1 });
  const id = (x) => x.id ?? x.product?.id ?? x.account?.id;
  const aNf = s.own.saveAccount(ana.A, { productId: id(pNf), user: "nf.propia@x.lat", password: "Clave-1234", slots: 5, providerExpiresAt: Date.now() + 2 * DAY });
  const aFl = s.own.saveAccount(ana.A, { productId: id(pFl), user: "flujo.uno", password: "Clave-1234", slots: 1 });
  s.own.assign(ana.A, { accountId: id(aNf), name: "Mario", phone: "70022222", price: 4500, pay: "pendiente" });
  s.own.assign(ana.A, { accountId: id(aNf), name: "Lucía", phone: "70033333", price: 4500, pay: "pagado" });
  s.own.assign(ana.A, { accountId: id(aFl), name: "Carla", phone: "70011111", price: 3000, pay: "pagado" });
  // Otro revendedor: una cuenta propia que Ana NUNCA debe ver.
  const pX = s.own.saveProduct(otro.A, { name: "Secreto IPTV", emoji: "🔒", durationDays: 30, price: 1000, kind: "line", slots: 1 });
  s.own.saveAccount(otro.A, { productId: id(pX), user: "secreto.otro", password: "Clave-1234", slots: 1 });

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${ana.c.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: ana.c.phone, pin })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* sin almacenamiento */ } }, ana.c.id);
    const [n, v] = rck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));

    await page.goto(base + "/hub#inicio");
    await page.locator(".htiles").waitFor();
    await page.locator('.bnav [data-s="inventario"]').click();
    await page.locator(".invrow").first().waitFor();
    const rows = await page.locator(".invrow").evaluateAll((l) => l.map((r) => r.innerText.replace(/\s+/g, " ").trim()));
    // 3 plataformas, ordenadas: Disney+ (completas), Flujo TV (propias), Netflix (tienda + propias en la misma fila).
    assert.equal(rows.length, 3, rows.join("\n"));
    assert.match(rows[0], /Disney\+ 🧩 Cuentas completas 1 cuenta · 2 perfiles repartidos/);
    assert.doesNotMatch(rows[0], /De la tienda|alquiler revendedores/, "la cuenta completa se cuenta una sola vez");
    assert.match(rows[1], /Flujo TV .*Propias 1 cuenta · 0 cupos libres · 1 vendido.*Sin cupos libres/);
    assert.match(rows[2], /Netflix .*De la tienda 2 servicios activos.*1 vencido.*1 vence ≤ 7 d.*Propias 1 cuenta · 3 cupos libres · 2 vendidos.*1 cuenta vence con tu proveedor/);
    // Totales: clientes = 2 tienda + 2 perfiles + 3 propios; cupos libres propios = 3; 1 vence ≤ 7 d; 1 vencido.
    const tot = await page.locator(".invtot-i").evaluateAll((l) => l.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
    assert.deepEqual(tot, ["Clientes 7", "Cupos libres (propias) 3", "Vencen ≤ 7 días 1", "Vencidos 1"]);
    // Separación: nada del otro revendedor.
    assert.doesNotMatch(await page.locator("#sout").innerText(), /Secreto|secreto\.otro/);
    // Celular: sin scroll de costado, botones de 44 px o más, la barra marca Inventario.
    const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > document.documentElement.clientWidth, small: [...document.querySelectorAll("#sout button")].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 44).length, cur: document.querySelector(".bnav [aria-current=page]")?.textContent.trim() }));
    assert.deepEqual(m, { over: false, small: 0, cur: "Inventario" });
    // "Ver" de la tienda abre Cuentas de la tienda filtrada por esa plataforma; "Ver" de propias abre Mis cuentas propias.
    await page.locator(".invrow", { hasText: "Netflix" }).locator("[data-invsee]").click();
    await page.waitForFunction(() => location.hash === "#cuentas");
    assert.equal(await page.locator('.rtabs [aria-selected="true"]').innerText(), "📺 Cuentas de la tienda");
    await page.locator('.bnav [data-s="inventario"]').click();
    await page.locator(".invrow", { hasText: "Flujo TV" }).locator('[data-rtool="propias"]').click();
    await page.getByRole("heading", { name: /Mis cuentas propias/ }).waitFor();
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
