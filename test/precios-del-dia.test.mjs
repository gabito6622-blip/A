// 💲 Precios del día (16/11/2026). El dueño: «quiero poner el precio de las cuentas nuevas y de la renovación… le voy a
// poner el precio actualizado del día… en dólares se mantiene a 7 para los extranjeros». Daniel Choque es cliente final y
// se queda en Bs 50. «Nueva» = lista revendedor; «Renovación» = precio que pasan a tener los alquileres de revendedores
// en Bs, con vista previa y «📌 mantener su precio». Datos ficticios. PP_SHOTS=<carpeta> guarda capturas.
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

test("precios del día: nuevas y renovación, vista previa, precio fijo; no toca clientes finales ni dólares", { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-preciodia-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 7500, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "dsin", name: "Disney Premium sin ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 4000, published: true, resellersOnly: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  e.s.priceGroups.revendedor = { ...(e.s.priceGroups.revendedor ?? { id: "revendedor", name: "Revendedor" }), prices: { dis: 6900, dsin: 3400 } };
  s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: 11.7 } });
  e.s.priceGroups.usd = { id: "usd", name: "Extranjeros (US$)", currency: "USD", prices: { dis: 700, dsin: 350 } };
  for (let i = 0; i < 12; i++) s.inventory.addAccount(owner, { productId: i < 10 ? "dis" : "dsin", supplierId: "p", email: `c${i}@ficticio.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 300 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  const rev = (name, phone, g = "revendedor") => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: g });
  const aracely = rev("aracely · Aracely", "+59170000001"), oby = rev("oby · Ovidio", "+59170000002"), marco = rev("mza · Marco", "+59170000003");
  const extranjero = rev("Extranjero", "+595990000004", "usd");
  const daniel = s.catalog.createCustomer(owner, { name: "Daniel Choque", phone: "+59170000005" });
  let k = 0;
  const rent = (c, pid, price) => { const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash", idempotencyKey: "r" + k++ }); const id = o.assignmentIds[0]; if (price) s.orders.setControl(owner, id, { price }); return id; };
  const ar1 = rent(aracely, "dis", 6500), ar2 = rent(aracely, "dis", 6500), ob1 = rent(oby, "dis", 6900), mz1 = rent(marco, "dis", 3500);
  const ex1 = rent(extranjero, "dis"), dc1 = rent(daniel, "dis", 5000), ar3 = rent(aracely, "dsin", 3400);
  const A = (id) => e.s.assignments[id];
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (ck, m, p, body) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})), r }; };
    const staff = (await call(null, "POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).r.headers.get("set-cookie").split(";")[0];
    const usdAntes = s.admin.assignments(owner).find((x) => x.id === ex1).payUsd;

    // La tarjeta: los 2 alquileres con su «nueva» (lista revendedor) y sin renovación todavía.
    const v = (await call(staff, "GET", "/api/admin/day-prices")).json;
    assert.deepEqual(v.products.map((p) => [p.id, p.nueva, p.renov]), [["dis", 6900, null], ["dsin", 3400, null]]);
    assert.deepEqual(v.usdLists, ["Extranjeros (US$)"]);
    // Precio inválido.
    assert.equal((await call(staff, "POST", "/api/admin/day-prices/preview", { prices: { dis: { renov: -5 } } })).status, 400);
    // Vista previa: no cambia nada todavía.
    const prices = { dis: { nueva: 7000, renov: 6900 }, dsin: { nueva: 3500, renov: 3500 } };
    const pv = (await call(staff, "POST", "/api/admin/day-prices/preview", { prices })).json;
    const g = Object.fromEntries(pv.payers.map((x) => [x.name, x]));
    assert.equal(g["aracely · Aracely"].changes, 3, "2 Disney ESPN 65→69 y la sin ESPN 34→35");
    assert.equal(g["oby · Ovidio"].changes, 0, "Oby ya está en 69");
    assert.equal(g["mza · Marco"].changes, 1);
    assert.equal(g["Extranjero"], undefined, "los de dólares no aparecen");
    assert.deepEqual(pv.skipped, { usd: 1, finales: 1 });
    assert.equal(A(ar1).control.price, 6500, "la vista previa no cambia nada");
    // Aplicar, con Marco «📌 mantener su precio».
    const ap = await call(staff, "POST", "/api/admin/day-prices", { prices, keep: [marco.id] });
    assert.equal(ap.status, 200);
    assert.deepEqual([ap.json.changed, ap.json.kept], [3, 1]);
    assert.deepEqual([A(ar1).control.price, A(ar2).control.price, A(ar3).control.price], [6900, 6900, 3500]);
    assert.equal(A(ob1).control.price, 6900);
    assert.equal(A(mz1).control.price, 3500, "Marco conserva su 35");
    assert.equal(e.s.customers[marco.id].fixedPrice, true);
    assert.equal(A(dc1).control.price, 5000, "Daniel Choque (cliente final) sigue en 50");
    assert.equal(s.admin.assignments(owner).find((x) => x.id === ex1).payUsd, usdAntes, "US$ 7 sigue igual");
    assert.deepEqual(e.s.priceGroups.revendedor.prices, { dis: 7000, dsin: 3500 }, "«nueva» = lista revendedor");
    assert.equal(e.s.dayPrices.dis.renew, 6900);
    const au = e.s.audit.filter((x) => x.action === "prices.day");
    assert.equal(au.length, 1);
    assert.ok(au[0].data.changed.some((x) => x.id === ar1 && x.from === 6500 && x.to === 6900), "queda en la auditoría de cuánto a cuánto");
    // Una cuenta nueva para Oby: se vende a Bs 70 y renueva a Bs 69 (el precio del día).
    const nueva = s.orders.create(owner, { customerId: oby.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "nueva" });
    assert.equal(nueva.total, 7000);
    const nid = nueva.assignmentIds[0];
    assert.equal(s.admin.assignments(owner).find((x) => x.id === nid).effectivePrice, 6900, "renueva al precio del día");
    const ren = s.orders.renew(owner, nid, { paymentMethod: "cash", idempotencyKey: "ren" });
    assert.equal(ren.order.total, 6900);
    // Marco (precio fijo) con una cuenta nueva no toma el precio del día de renovación.
    const nm = s.orders.create(owner, { customerId: marco.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "nm" });
    assert.notEqual(s.admin.assignments(owner).find((x) => x.id === nm.assignmentIds[0]).effectivePrice, 6900);
    // La tarjeta ahora muestra los precios del día; Marco sale con «📌» tildado en la próxima vista previa.
    assert.deepEqual((await call(staff, "GET", "/api/admin/day-prices")).json.products.map((p) => [p.nueva, p.renov]), [[7000, 6900], [3500, 3500]]);
    assert.equal((await call(staff, "POST", "/api/admin/day-prices/preview", { prices })).json.payers.find((x) => x.payerId === marco.id).fixed, true);

    // ---- Pantalla (celular) ----
    if (chromium) {
      const shots = process.env.PP_SHOTS;
      const b = await chromium.launch();
      try {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1 });
        const [n, vv] = staff.split("="); await ctx.addCookies([{ name: n, value: vv, url: base }]);
        await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
        await p.goto(base + "/panel.html#productos");
        await p.locator("#dpCard").waitFor();
        assert.equal(await p.locator('#dpForm input[name="r:dis"]').inputValue(), "69");
        await p.locator('#dpForm input[name="r:dis"]').fill("67");
        await p.getByRole("button", { name: /Ver qué cambia/ }).click();
        await p.locator("#dpPrev .dpp").first().waitFor();
        assert.match(await p.locator("#dpPrev").innerText(), /Aracely[\s\S]*Bs 69(,00)? → Bs 67/);
        assert.equal(await p.locator(`#dpPrev [data-dpkeep="${marco.id}"]`).isChecked(), true, "Marco sigue tildado");
        if (shots) await p.screenshot({ path: `${shots}/precios-del-dia.png`, fullPage: true });
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, "sin desborde");
        for (const h of await p.locator("#dpForm input, #dpPrev .dpkeep, #dpPrev [data-dpapply]").evaluateAll((l) => l.map((x) => x.getBoundingClientRect().height))) assert.ok(h >= 44, `alto ${h}`);
        await p.locator("#dpPrev [data-dpapply]").click();
        await p.waitForFunction(() => /Precios del día guardados/.test(document.body.innerText));
        assert.equal(A(ar1).control.price, 6700);
        assert.equal(A(mz1).control.price, 3500);
        assert.deepEqual(errs, []);
        await ctx.close();
      } finally { await b.close(); }
    }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
