// Ficha del revendedor (17/11/2026): «⏳ Solo lo que vence este mes» y «Precio de renovación para el mensaje».
// El dueño mandó a Arit sus cuentas por vencer a Bs 67 c/u; esto lo deja hacer desde su panel sin tocar los precios guardados.
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

test("ficha: solo por vencer y precio de renovación en el mensaje", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-ficha-ren-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, E = s.engine, O = { id: Object.keys(E.s.staff)[0], role: "owner" };
  s.catalog.upsertSupplier(O, { id: "prov", name: "Prov", active: true });
  s.catalog.upsertProduct(O, { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  for (const n of [1, 2, 3]) s.inventory.addAccount(O, { productId: "dis", supplierId: "prov", email: `d${n}@ficticio.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] });
  const arit = s.catalog.createCustomer(O, { name: "ARIt · Aracely Ficticia", phone: "+59175000000", kind: "reseller" });
  const venta = (email, dias) => {
    const slot = Object.values(E.s.slots).find((x) => E.s.accounts[x.accountId].email === email);
    const id = s.orders.create(O, { customerId: arit.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slot.id] }).assignmentIds[0];
    s.orders.setExpiry(O, id, Date.now() + dias * DAY);
  };
  venta("d1@ficticio.lat", 4); venta("d2@ficticio.lat", 11); venta("d3@ficticio.lat", 45);

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ock = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const [cn, cv] = ock.split("="); await ctx.addCookies([{ name: cn, value: cv, url: base }]);
    const p = await ctx.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/panel.html#revendedores"); await p.reload();
    await p.locator(`[data-rficha="${arit.id}"]`).first().click();
    await p.waitForSelector(".rficha");
    const msg = async () => decodeURIComponent((await p.locator(".rficha a.pbtn.green").getAttribute("href")).split("text=")[1]);

    let m = await msg();
    assert.match(m, /tu resumen/); assert.match(m, /d3@ficticio\.lat/, "el resumen completo trae todas");

    await p.locator('.rficha [data-tab="rfv:1"]').click();
    await p.waitForSelector('.rficha [data-tab="rfv:1"][aria-selected="true"]');
    m = await msg();
    assert.match(m, /tus cuentas que vencen este mes/);
    assert.match(m, /d1@ficticio\.lat/); assert.match(m, /d2@ficticio\.lat/);
    assert.doesNotMatch(m, /d3@ficticio\.lat/, "la que vence en 45 días no va");

    await p.locator('.rficha form[data-rfren] input[name="ren"]').fill("67");
    await p.locator('.rficha form[data-rfren] button[type="submit"]').click();
    await p.waitForSelector('.rficha form[data-rfren] [data-tab="rfren:"]');
    m = await msg();
    assert.match(m, /Renovación: \*Bs 67(,00)? c\/u\*/);
    assert.match(m, /Total: 2 perfil\(es\) · Bs 134/);
    assert.doesNotMatch(m, /Bs 69/, "no aparece el precio guardado");
    assert.equal(Object.values(E.s.assignments).filter((a) => a.customerId === arit.id).every((a) => (a.control?.price ?? null) !== 67), true, "no cambió nada guardado");
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "sin scroll lateral a 360 px");
    assert.deepEqual(errs, []);
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
