// GaboHub etapa 4 (12/11/2026): "Mis clientes" muestra cada cliente con TODO lo suyo: lo comprado a la tienda, sus
// cuentas propias y sus perfiles de cuentas completas (unidos por su ficha o su WhatsApp). Los que solo están en lo
// propio aparecen con "Guardar en mis clientes". El buscador encuentra también por app. Datos ficticios, 360 px.
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

test("Mis clientes: todo lo de cada cliente en un lugar, clientes sueltos y buscador por app", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-hubcli-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500, "dis-alq": 7000 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [1, 2].map((i) => ({ label: `P${i}` })) });
  s.inventory.addAccount(owner, { productId: "dis-alq", supplierId: "andes", email: "alq@x.lat", password: "Clave-Larga#2", supplierExpiresAt: Date.now() + 90 * DAY, cost: 5000, profiles: [{ label: "Cuenta completa" }] });
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" }); s.wallet.adjust(owner, c.id, 50000, "carga de prueba"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Clientes", "+59171234567"), otro = mk("Otro Revendedor", "+59172345678");
  const id = (x) => x.id ?? x.product?.id ?? x.account?.id;
  // Rosa: ficha de cliente con Netflix de la tienda, Flujo TV propio (por su ficha) y un perfil de Disney (por su WhatsApp).
  const rosa = s.catalog.createCustomer(ana.A, { name: "Rosa Quispe", phone: "+59160000001" });
  s.orders.create(ana.A, { customerId: rosa.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance", idempotencyKey: "nf1" });
  const pFl = s.own.saveProduct(ana.A, { name: "Flujo TV", emoji: "📡", durationDays: 30, price: 3000, kind: "profiles", slots: 3 });
  const acc = s.own.saveAccount(ana.A, { productId: id(pFl), user: "flujo.uno", password: "Clave-1234", slots: 3 });
  s.own.assign(ana.A, { accountId: id(acc), customerId: rosa.id, price: 3000, pay: "pagado" });
  const aid = s.orders.create(ana.A, { customerId: ana.c.id, items: [{ productId: "dis-alq", qty: 1 }], paymentMethod: "balance", idempotencyKey: "alq" }).assignmentIds[0];
  s.subs.save(ana.A, aid, { name: "Rosa Q.", phone: "+59160000001", expiresAt: Date.now() + 5 * DAY, price: 1500, pay: "pagado" });
  // 3 clientes más sin servicios (con 5 o más aparece el buscador).
  for (const i of [1, 2, 3]) s.catalog.createCustomer(ana.A, { name: `Relleno ${i}`, phone: `+5916100000${i}` });
  // Beto: solo tiene una cuenta propia (no está en su lista de clientes).
  s.own.assign(ana.A, { accountId: id(acc), name: "Beto Suelto", phone: "70044444", price: 3000, pay: "pendiente" });
  // El otro revendedor tiene un cliente con cuenta propia que Ana nunca debe ver.
  const pX = s.own.saveProduct(otro.A, { name: "Secreto IPTV", emoji: "🔒", durationDays: 30, price: 1000, kind: "line", slots: 1 });
  const aX = s.own.saveAccount(otro.A, { productId: id(pX), user: "secreto", password: "Clave-1234", slots: 1 });
  s.own.assign(otro.A, { accountId: id(aX), name: "Cliente Ajeno", phone: "70099999", price: 1000, pay: "pendiente" });

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
    await page.locator('.bnav [data-s="clientes"]').click();
    await page.locator('[data-rtab="ventas"][aria-selected="true"]').waitFor();
    await page.waitForFunction(() => document.querySelectorAll(".rcli").length === 5 && /3 serv\./.test(document.body.innerText), null, { timeout: 30_000 });
    const sums = await page.locator(".rcli > summary").evaluateAll((l) => l.map((x) => x.innerText.replace(/\s+/g, " ").trim()));
    // Rosa (3 servicios, uno de cada lado), Beto suelto y 3 de relleno. Nada del otro revendedor.
    assert.equal(sums.length, 5, sums.join("\n"));
    const rosaS = sums.find((x) => x.startsWith("Rosa Quispe")), betoS = sums.find((x) => x.startsWith("Beto Suelto"));
    assert.match(rosaS, /3 serv\./);
    assert.match(betoS, /no está en tu lista de clientes.*1 serv\./);
    assert.doesNotMatch(sums.join(" "), /Ajeno|Ana Clientes/);
    await page.locator(".rcli", { hasText: "Rosa Quispe" }).locator("summary").click();
    const rosaTxt = (await page.locator(".rcli", { hasText: "Rosa Quispe" }).innerText()).replace(/\s+/g, " ");
    assert.match(rosaTxt, /Netflix/); assert.match(rosaTxt, /Flujo TV.*Cuenta propia/); assert.match(rosaTxt, /Disney\+.*Perfil de cuenta completa/);
    // Buscador por app: "flujo" deja a los 2 (los dos tienen Flujo TV); "netflix" solo a Rosa; "disney" solo a Rosa.
    // Espera al resultado (no a un tiempo fijo): el buscador redibuja la lista un momento después de escribir.
    const names = () => page.locator(".rcli > summary b").evaluateAll((l) => l.map((x) => x.textContent.trim()).sort());
    const find = async (t, want) => {
      await page.fill("#cq", t);
      await page.waitForFunction((w) => JSON.stringify([...document.querySelectorAll(".rcli > summary b")].map((x) => x.textContent.trim()).sort()) === JSON.stringify(w), want, { timeout: 30_000 }).catch(() => {});
      assert.deepEqual(await names(), want, `buscar "${t}"`);
    };
    assert.equal(await page.locator("#cq").count(), 1, "con 5 clientes aparece el buscador");
    await find("netflix", ["Rosa Quispe"]);
    await find("flujo", ["Beto Suelto", "Rosa Quispe"]);
    await find("70044", ["Beto Suelto"]); // también por teléfono
    await find("", ["Beto Suelto", "Relleno 1", "Relleno 2", "Relleno 3", "Rosa Quispe"]);
    // Ver en Mis cuentas propias lleva a esa pestaña.
    await page.locator(".rcli", { hasText: "Rosa Quispe" }).locator("summary").click();
    await page.locator(".rcli", { hasText: "Rosa Quispe" }).locator('[data-rtool="propias"]').click();
    await page.getByRole("heading", { name: /Mis cuentas propias/ }).waitFor();
    // Guardar a Beto en sus clientes: queda con su ficha y ya no figura como suelto.
    await page.locator('.bnav [data-s="clientes"]').click();
    await page.locator(".rcli", { hasText: "Beto Suelto" }).locator("summary").click();
    // Clic por JS: al abrir el desplegable la lista se vuelve a dibujar y el botón real cambia de nodo (bajo carga, Playwright lo veía «inestable»).
    await page.locator(".rcli", { hasText: "Beto Suelto" }).locator("[data-addcli]").evaluate((b) => b.click());
    // Se espera por la API (lo que importa: quedó guardado) y después se recarga la pantalla, para no depender del
    // redibujado en vivo, que bajo carga tardaba más que el tiempo de espera de la prueba.
    let mine = [];
    for (let i = 0; i < 60 && !mine.some((c) => c.name === "Beto Suelto"); i++) { await new Promise((r) => setTimeout(r, 250)); mine = await (await fetch(base + "/api/me/customers", { headers: { cookie: rck } })).json(); }
    assert.ok(mine.some((c) => c.name === "Beto Suelto" && c.phone.endsWith("70044444")));
    await page.reload(); await page.waitForSelector('.bnav [data-s="clientes"]', { timeout: 30_000 });
    await page.locator('.bnav [data-s="clientes"]').click(); await page.waitForSelector(".rcli", { timeout: 30_000 });
    await page.waitForFunction(() => ![...document.querySelectorAll(".rcli-x")].some((x) => x.textContent.includes("Beto Suelto")), null, { timeout: 30_000 });
    await page.waitForFunction(() => [...document.querySelectorAll(".rcli:not(.rcli-x) > summary")].some((x) => x.textContent.includes("Beto Suelto") && /1 serv\./.test(x.textContent)), null, { timeout: 30_000 });
    const m = await page.evaluate(() => ({ over: document.documentElement.scrollWidth > document.documentElement.clientWidth }));
    assert.deepEqual(m, { over: false });
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
