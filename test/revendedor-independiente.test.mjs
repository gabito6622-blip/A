// Dos tipos de revendedor (14/11/2026). El dueño: «mis cuentas están destinadas para mis revendedores de confianza; los
// nuevos no me van a comprar y no les tengo confianza con los códigos». «De confianza» (los de siempre) compra y alquila
// el stock de la tienda; «Independiente» (los que se suman por la solicitud) usa GaboHub para SUS cuentas y no ve ni
// compra el stock de la tienda, y eso lo niega el SERVIDOR (no solo se esconde el botón). Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("Revendedor independiente: el servidor le niega el stock de la tienda; el de confianza sigue igual; el dueño lo cambia", { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-indep-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3000, published: true });
  s.catalog.upsertProduct(owner, { id: "dis-alq", name: "Disney+ (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 9000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Rev", prices: { nf: 2500, "dis-alq": 7000 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * 86_400_000, cost: 1000, profiles: [1, 2, 3, 4].map((i) => ({ label: `P${i}` })) });
  // Uno de confianza (como los 25 de hoy: sin marca) …
  const ari = s.catalog.createCustomer(owner, { name: "Ari Confianza", phone: "+59171000011", kind: "reseller", priceGroupId: "rev" });
  s.wallet.adjust(owner, ari.id, 50000, "carga de prueba");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const call = async (method, p, body, ck) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null), ck: r.headers.get("set-cookie")?.split(";")[0] }; };
  const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).ck;
  // … y uno nuevo que se suma por la solicitud de /revendedores.
  await call("POST", "/api/resellers/apply", { name: "Nico Nuevo", phone: "+59171000022", note: "quiero vender" });
  const app1 = (await call("GET", "/api/admin/reseller-apps", null, ock)).json;
  const appId = (Array.isArray(app1) ? app1 : app1.list ?? app1.items).find((a) => a.phone === "+59171000022").id;
  const ap = await call("POST", `/api/admin/reseller-apps/${appId}/approve`, {}, ock);
  assert.equal(ap.status, 200, JSON.stringify(ap.json));
  const nico = Object.values(s.engine.s.customers).find((c) => c.phone === "+59171000022");
  s.wallet.adjust(owner, nico.id, 50000, "carga de prueba");
  s.engine.tx(() => { nico.priceGroupId = "rev"; }); // aunque tuviera lista de precios, el tipo manda

  const enter = async (c) => { const { pin } = (await call("POST", `/api/admin/customers/${c.id}/login-pin`, {}, ock)).json; return (await call("POST", "/api/auth/customer/pin", { phone: c.phone, pin })).ck; };
  const ack = await enter(ari), nck = await enter(nico);

  // La lista del dueño dice el tipo de cada uno.
  const list = (await call("GET", "/api/admin/resellers", null, ock)).json.list;
  assert.equal(list.find((r) => r.id === ari.id).trust, "trusted");
  assert.equal(list.find((r) => r.id === nico.id).trust, "independent");
  assert.equal((await call("GET", "/api/me", null, nck)).json.trust, "independent");
  assert.equal((await call("GET", "/api/me", null, ack)).json.trust, undefined);

  // Independiente: sin catálogo, sin precios de revendedor, y comprar o pedir precio de la tienda falla en el servidor.
  assert.deepEqual((await call("GET", "/api/catalog", null, nck)).json, []);
  const prices = (await call("GET", "/api/me/prices", null, nck)).json;
  assert.equal((Array.isArray(prices) ? prices : prices.list ?? []).length, 0);
  for (const productId of ["nf", "dis-alq"]) {
    const r = await call("POST", "/api/orders", { items: [{ productId, qty: 1 }], paymentMethod: "balance", idempotencyKey: "n-" + productId }, nck);
    assert.notEqual(r.status, 200, `no puede comprar ${productId}`);
    assert.match(r.json.message, /no disponible/i);
  }
  assert.equal(s.wallet.balance(nico.id), 50000, "no se le cobró nada");
  // Su página muestra solo lo suyo (su Flujo TV), nunca el stock de la tienda.
  s.shops.setPage(owner, nico.id, true);
  s.shops.setupFor(owner, nico.id, { slug: "nico-tv", title: "Nico TV", enabled: true });
  s.engine.tx(() => { nico.resellerPrices = { nf: 3500 }; });
  const N = { id: "u_" + nico.id, role: "reseller", customerId: nico.id };
  s.own.saveProduct(N, { name: "Flujo TV", emoji: "📺", durationDays: 30, price: 3000, kind: "line", onPage: true });
  const page = (await call("GET", "/api/shops/nico-tv")).json;
  assert.deepEqual(page.products.map((p) => p.name), ["Flujo TV"]);

  // De confianza: todo como siempre.
  assert.ok((await call("GET", "/api/catalog", null, ack)).json.some((p) => p.id === "dis-alq"));
  const okBuy = await call("POST", "/api/orders", { items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance", idempotencyKey: "a-nf" }, ack);
  assert.equal(okBuy.status, 200, JSON.stringify(okBuy.json));

  // Solo el dueño (o admin) cambia el tipo; un revendedor no.
  assert.notEqual((await call("POST", `/api/admin/customers/${nico.id}/trust`, { trust: "trusted" }, nck)).status, 200);
  assert.equal((await call("POST", `/api/admin/customers/${nico.id}/trust`, { trust: "otro" }, ock)).status, 400);

  if (chromium) {
    const b = await chromium.launch();
    try {
      // Inicio del independiente en el celular: sus 4 botones, nada de la tienda.
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, nico.id);
      const [n, v] = nck.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
      const pg = await ctx.newPage(); const errs = []; pg.on("pageerror", (e) => errs.push(e.message));
      await pg.goto(base + "/hub#inicio");
      await pg.locator(".htiles.hsimple").waitFor();
      assert.deepEqual((await pg.locator(".hsimple .htile b").allInnerTexts()).map((x) => x.trim()), ["Mis cuentas", "Mis códigos", "Cobrar", "Mi página"]);
      assert.doesNotMatch(await pg.locator("#sout").innerText(), /Comprar|Gabriel/);
      await pg.locator('.bnav [data-s="mas"]').click();
      await pg.locator(".hubarea-i").first().waitFor();
      const mas = await pg.locator("#sout").innerText();
      assert.doesNotMatch(mas, /Comprar a la tienda|Cuentas de la tienda|Repartir perfiles/);
      assert.match(mas, /Mis cuentas propias/);
      await pg.locator('.bnav [data-s="vender"]').click();
      await pg.locator(".hubpick-i").first().waitFor();
      assert.doesNotMatch(await pg.locator("#sout").innerText(), /Una cuenta de la tienda|Ver precios y comprar/);
      assert.deepEqual(errs, []);
      await ctx.close();

      // El dueño ve el tipo en la tarjeta y lo pasa a «De confianza».
      const pctx = await b.newContext({ viewport: { width: 390, height: 844 } });
      const [on, ov] = ock.split("="); await pctx.addCookies([{ name: on, value: ov, url: base }]);
      const pp = await pctx.newPage();
      pp.on("dialog", (d) => d.accept());
      await pp.goto(base + "/panel#revendedores");
      const btn = pp.locator(`[data-rtrust="${nico.id}"]`);
      await btn.waitFor();
      assert.match(await btn.innerText(), /Pasar a De confianza/);
      assert.match(await pp.locator(".rcard", { has: btn }).innerText(), /Independiente/);
      await btn.click();
      await pp.locator(`[data-rtrust="${nico.id}"]`, { hasText: "Pasar a Independiente" }).waitFor();
      await pctx.close();
    } finally { await b.close(); }
  } else {
    assert.equal((await call("POST", `/api/admin/customers/${nico.id}/trust`, { trust: "trusted" }, ock)).status, 200);
  }
  // Ya de confianza: ahora sí ve y compra.
  assert.equal(s.engine.s.customers[nico.id].trust, undefined);
  assert.ok((await call("GET", "/api/catalog", null, nck)).json.some((p) => p.id === "nf"));
  assert.equal((await call("POST", "/api/orders", { items: [{ productId: "nf", qty: 1 }], paymentMethod: "balance", idempotencyKey: "n-ok" }, nck)).status, 200);
  const audit = Object.values(s.engine.s.audit ?? {}).concat(s.engine.s.auditLog ?? []);
  void audit;
  await app.close(); rmSync(dir, { recursive: true, force: true });
});
