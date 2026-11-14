// Plata del cuaderno en el celular (14/11/2026): rutas por HTTP con separación, y GaboHub a 360 px (claro y oscuro):
//  - «Me pagó Bs 15» de un toque en Mi día, con «Deshacer»; «✏️ Otro monto» para un pago parcial (queda «Debe Bs 5»).
//  - Nombres parecidos con los últimos 3 números («Juan Pérez ·…123» y «Juan Peres ·…456»).
//  - Cuenta cortada: «Se cortó tu HBO Max: tus 2 clientes (Nina, Óscar)» y «Pasar a mi cuenta nueva».
//  - «Te deben» igual en Repartir perfiles, Quién me debe y Mi día; atajos a Mi día y Ganancias; «Mis clientes» abre la lista.
// Datos ficticios, carpeta temporal, sin red.
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
const system = { id: "system", role: "system" };

test("cuaderno del revendedor: rutas, separación y pantallas a 360 px", { timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-r1-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, fetchImpl: async () => { throw new Error("sin red"); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "hbo", name: "HBO Max (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 2000, published: true, resellersOnly: true });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { hbo: 1500 } });
  s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
  for (let i = 0; i < 4; i++) s.inventory.addAccount(owner, { productId: "hbo", supplierId: "andes", email: `hbo.${i}@ficticio.lat`, password: "Clave-Ficticia#" + i, supplierExpiresAt: Date.now() + 200 * DAY, cost: 1000, profiles: [{ label: "Cuenta completa" }] });
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "rev" }); s.wallet.adjust(owner, c.id, 20000, "prueba"); return c; };
  const marta = mk("Marta Choque", "+59170100001"), zulma = mk("Zulma Otra", "+59170100003");
  const R = (c) => ({ id: "u_" + c.id, role: "reseller", customerId: c.id });
  const rent = (c) => s.orders.create(R(c), { customerId: c.id, items: [{ productId: "hbo", qty: 1 }], paymentMethod: "balance", idempotencyKey: Math.random() + "" }).assignmentIds[0];
  // Una HBO que se cortó con Nina y Óscar anotados, y una HBO nueva con dos «Juan» y Rosa.
  const old = rent(marta);
  s.subs.save(R(marta), old, { name: "Nina Vela", expiresAt: Date.now() + 20 * DAY, price: 1500, pay: "pagado" });
  s.subs.save(R(marta), old, { name: "Óscar Vela", phone: "72200009", expiresAt: Date.now() + 20 * DAY, price: 1500, pay: "pagado" });
  s.orders.setExpiry(owner, old, Date.now() - 3 * DAY);
  s.orders.closeExpired(system, 2);
  assert.equal(s.engine.s.assignments[old].status, "revoked");
  const neu = rent(marta);
  const juan = s.subs.save(R(marta), neu, { name: "Juan Pérez", phone: "71200123", expiresAt: Date.now() - 2 * DAY, price: 1500, pay: "pagado" }).sub;
  s.subs.save(R(marta), neu, { name: "Juan Peres", phone: "71200456", expiresAt: Date.now() + 20 * DAY, price: 1500, pay: "pagado" });
  s.subs.save(R(marta), neu, { name: "Rosa Quispe", phone: "71200789", expiresAt: Date.now() + 2 * DAY, price: 2000, pay: "pagado" });
  const zAid = rent(zulma);
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (method, p, body, ck) => { const r = await fetch(base + p, { method, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) }); return { status: r.status, json: await r.json().catch(() => null), ck: r.headers.get("set-cookie")?.split(";")[0] }; };
    const ock = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).ck;
    const enter = async (c) => { const { pin } = (await call("POST", `/api/admin/customers/${c.id}/login-pin`, {}, ock)).json; return (await call("POST", "/api/auth/customer/pin", { phone: c.phone, pin })).ck; };
    const mck = await enter(marta), zck = await enter(zulma);

    // ---- Rutas: cada uno lo suyo; el dueño no entra a /api/me ----
    const subs = (await call("GET", "/api/me/subs", null, mck)).json;
    assert.equal(subs.debts.total, 1500, "Juan venció hace 2 días: debe su período");
    assert.deepEqual(subs.cuts.map((c) => c.clients.map((x) => x.name)), [["Nina Vela", "Óscar Vela"]]);
    assert.equal((await call("POST", `/api/me/subs/${neu}/${juan.id}/pay`, { amount: 100 }, zck)).status, 403, "Zulma no cobra lo de Marta");
    assert.equal((await call("POST", `/api/me/cortes/${old}/move`, { to: zAid }, zck)).status, 403);
    assert.equal((await call("POST", `/api/me/cortes/${old}/drop`, {}, zck)).status, 403);
    assert.equal((await call("POST", `/api/me/dia/pay/${encodeURIComponent(`${neu}|${juan.id}`)}`, { amount: 100 }, zck)).status, 404);
    const zs = JSON.stringify((await call("GET", "/api/me/subs", null, zck)).json);
    for (const w of ["Juan", "Nina", "Marta", "71200123"]) assert.ok(!zs.includes(w), `Zulma ve «${w}»`);
    assert.ok([401, 403].includes((await call("GET", "/api/me/subs", null, ock)).status));
    assert.equal((await call("POST", "/api/me/cobros/rco_00001/undo", {}, zck)).status, 404);

    if (!chromium) return;
    const b = await chromium.launch();
    try {
      const ctxFor = async (w = 360, scheme = "light") => {
        const ctx = await b.newContext({ viewport: { width: w, height: 800 }, isMobile: true, hasTouch: true, colorScheme: scheme });
        await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (x) => x.abort());
        const [k, v] = mck.split("="); await ctx.addCookies([{ name: k, value: v, url: base }]);
        await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* sin almacenamiento */ } }, marta.id);
        return ctx;
      };
      const over = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      const txt = async (p) => (await p.locator("#sout").innerText()).replace(/\s+/g, " ");
      const ctx = await ctxFor();
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      p.on("dialog", (d) => d.accept());

      // «Mis clientes» de Inicio abre la lista de clientes (no la última pestaña que usó).
      await p.goto(base + "/hub#inicio");
      await p.locator('.hsmall [data-s="clientes"]').click();
      await p.locator('[data-rtab="ventas"][aria-selected="true"]').waitFor();

      // Repartir perfiles: nombres con los últimos 3 números, «Te deben», cuenta cortada y atajos.
      await p.evaluate(() => { const x = document.createElement("button"); x.dataset.rtool = "perfiles"; x.id = "goPerf"; document.body.append(x); });
      await p.locator("#goPerf").dispatchEvent("click");
      await p.locator(".ccut").waitFor();
      let t = await txt(p);
      assert.match(t, /Juan Pérez ·…123/); assert.match(t, /Juan Peres ·…456/);
      assert.match(t, /Se cortó tu HBO Max: tus 2 clientes \(Nina, Óscar\)/);
      assert.match(t, /Te deben Bs 15\b/);
      assert.equal(await over(p), 0);
      for (const h of await p.locator(".cnav .sbtn, .ccut .sbtn").evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height))) assert.ok(h >= 44, `botón de ${h}px`);
      await p.locator(`[data-cutmove="${old}|${neu}"]`).click();
      await p.waitForFunction(() => !document.querySelector(".ccut"));
      t = await txt(p);
      assert.match(t, /Nina Vela/); assert.match(t, /Óscar Vela ·…009/);
      assert.equal(s.engine.s.assignments[neu].subs.length, 5);

      // De Repartir perfiles a Mi día en un toque. «Me pagó Bs 15» de Juan Pérez: un toque, y «Deshacer».
      await p.locator('.cnav [data-rtool="dia"]').click();
      await p.locator('[data-rtab="dia"][aria-selected="true"]').waitFor();
      await p.locator("[data-rdfast]").first().waitFor();
      t = await txt(p);
      assert.match(t, /Cobrar hoy 1 te deben Bs 15\b/); assert.match(t, /Juan Pérez ·…123/);
      const fast = p.locator(`[data-rdfast="${neu}|${juan.id}"]`);
      assert.match(await fast.innerText(), /Me pagó Bs 15\b/);
      assert.ok((await fast.evaluate((e) => e.getBoundingClientRect().height)) >= 44);
      const exp0 = s.engine.s.assignments[neu].subs.find((x) => x.id === juan.id).expiresAt;
      await fast.click();
      await p.locator(".cundo").waitFor();
      assert.equal(s.engine.s.assignments[neu].subs.find((x) => x.id === juan.id).expiresAt, exp0 + 30 * DAY, "un toque: cobrado y corre un período");
      assert.match(await txt(p), /Cobrar hoy 0/);
      await p.locator("[data-cundo]").click();
      await p.waitForFunction(() => /Cobrar hoy 1/.test(document.body.innerText.replace(/\s+/g, " ")));
      assert.equal(s.engine.s.assignments[neu].subs.find((x) => x.id === juan.id).expiresAt, exp0, "deshecho");
      // «Otro monto»: te pagó Bs 10 de Bs 15 → queda debiendo Bs 5 y el precio sigue en Bs 15.
      await p.locator(`[data-rdpay="${neu}|${juan.id}"]`).click();
      const amt = p.locator('.rdia-pvbox [name="amount"]');
      await amt.fill("10");
      assert.match(await p.locator(".rdia-pvbox .rdia-left").innerText(), /Queda debiendo Bs 5\b/);
      await p.locator("[data-rdpayok]").click();
      await p.waitForFunction(() => /te deben Bs 5\b/.test(document.body.innerText.replace(/\s+/g, " ")));
      const j = s.engine.s.assignments[neu].subs.find((x) => x.id === juan.id);
      assert.deepEqual([j.price, j.pay], [1500, "pendiente"]);
      assert.equal(await over(p), 0);

      // El mismo número en las 3 pantallas.
      const total = s.cuaderno.debts(R(marta)).total;
      assert.equal(total, 500);
      await p.locator('[data-rtab="debe"]').click();
      await p.locator(".cdebts").waitFor();
      assert.match(await txt(p), /Quién me debe Te deben Bs 5\b/);
      assert.match(await p.locator(".cdebts").innerText(), /Juan Pérez ·…123/);
      // A Ganancias desde Repartir perfiles sin pasar por Inicio.
      await p.evaluate(() => { document.getElementById("goPerf")?.remove(); const x = document.createElement("button"); x.dataset.rtool = "perfiles"; x.id = "goPerf"; document.body.append(x); });
      await p.locator("#goPerf").dispatchEvent("click");
      await p.locator(".cnav").waitFor();
      assert.match(await txt(p), /Te deben Bs 5\b/);
      await p.locator('.cnav [data-rtool="ganancias"]').click();
      await p.locator(".rmreal").waitFor();
      const g = (await p.locator(".rmreal").innerText()).replace(/\s+/g, " ");
      assert.match(g, /Cobraste Bs \d/); assert.match(g, /te deben Bs 5\b/i);
      await p.locator(".chist").waitFor();
      assert.equal(await over(p), 0);
      assert.deepEqual(errs, []);
      await ctx.close();

      // 390 px y modo oscuro: sin desborde ni errores.
      for (const [w, scheme] of [[390, "light"], [360, "dark"]]) {
        const c2 = await ctxFor(w, scheme); const p2 = await c2.newPage(); const e2 = []; p2.on("pageerror", (e) => e2.push(e.message));
        await p2.goto(base + "/hub#dia"); await p2.locator(".rdia-s").first().waitFor();
        assert.equal(await over(p2), 0, `${w} ${scheme}`);
        assert.deepEqual(e2, []);
        await c2.close();
      }
    } finally { await b.close(); }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
