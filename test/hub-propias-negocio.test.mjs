// GaboHub etapa 3 + 14/11/2026: las cuentas propias del revendedor (independiente) en Inicio, Mi día, Mi control,
// Quién me debe y Mis ganancias, y en su pestaña: «Renovó» pregunta «¿Te pagó?» y se puede deshacer, liberar con
// deuda pregunta, cuenta caída → «Mover todos» con la fila de avisos con los datos nuevos. Celular (360 px), claro
// y oscuro, botones de 44 px, sin desborde y sin errores. Otro revendedor nunca aparece.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 86_400_000;

test("cuentas propias en Inicio, Mi día, Mi control, Quién me debe y Mis ganancias, con «¿Te pagó?», deshacer, liberar y mover", { skip: !chromium && "Playwright no está instalado", timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-r3-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  const mk = (name, phone) => { const c = s.catalog.createCustomer(owner, { name, phone, kind: "reseller" }); s.catalog.setResellerTrust(owner, c.id, "independent"); return { c, A: { id: "u_" + c.id, role: "reseller", customerId: c.id } }; };
  const ana = mk("Ana Propias", "+59171234567"), otro = mk("Otro Revendedor", "+59172345678");
  const pFl = s.own.saveProduct(ana.A, { name: "Flujo TV", emoji: "📡", durationDays: 30, price: 3000, kind: "profiles", slots: 3 });
  const a1 = s.own.saveAccount(ana.A, { productId: pFl.id, user: "flujo.uno", password: "Clave-1234", slots: 3, providerExpiresAt: Date.now() + 20 * DAY });
  const a2 = s.own.saveAccount(ana.A, { productId: pFl.id, user: "flujo.dos", password: "Clave-5678", slots: 3, providerExpiresAt: Date.now() + 20 * DAY });
  const carla = s.own.assign(ana.A, { accountId: a1.id, name: "Carla Rojas", phone: "70011111", price: 3000, pay: "pendiente" });
  const mario = s.own.assign(ana.A, { accountId: a1.id, name: "Mario Soto", phone: "70022222", price: 2500, pay: "pagado" });
  s.own.updateSale(ana.A, carla.id, { expiresAt: Date.now() - 2 * DAY }); // venció hace 2 días y debe Bs 30
  s.own.updateSale(ana.A, mario.id, { expiresAt: Date.now() + 20 * DAY }); // al día
  s.own.providerPay(ana.A, a1.id, { amount: 8000, months: 1, extend: false });
  // El otro revendedor tiene una venta propia pendiente que Ana nunca debe ver.
  const pX = s.own.saveProduct(otro.A, { name: "Secreto IPTV", emoji: "🔒", durationDays: 30, price: 1000, kind: "line" });
  const aX = s.own.saveAccount(otro.A, { productId: pX.id, user: "secreto", password: "Clave-1234" });
  s.own.assign(otro.A, { accountId: aX.id, name: "Cliente Ajeno", phone: "70099999", price: 1000, pay: "pendiente", expiresAt: Date.now() - DAY });

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const { pin } = await (await post(`/api/admin/customers/${ana.c.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: ana.c.phone, pin })).headers.get("set-cookie").split(";")[0];
    const own = async () => (await fetch(base + "/api/me/own", { headers: { cookie: rck } })).json();
    // Oscuro primero (solo mira); claro después (toca y cambia datos).
    for (const colorScheme of ["dark", "light"]) {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, colorScheme });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort()); // nunca sale un WhatsApp real
      await ctx.addInitScript((cid) => { try { localStorage.setItem("gs-guide-" + cid, "1"); } catch { /* sin almacenamiento */ } }, ana.c.id);
      const [n, v] = rck.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
      const tab = async (t) => { if (t === "dia") { await page.goto(base + "/hub"); await page.locator('.hsimple [data-rtool="dia"]').click(); } else { await page.goto(base + "/hub#mas"); await page.locator(`.hubarea-i[data-rtool="${t}"]`).click(); } await page.waitForFunction((k) => document.querySelector(`[data-rtab="${k}"]`)?.getAttribute("aria-selected") === "true", t); };
      const check = (sel) => page.evaluate((q) => ({ over: document.documentElement.scrollWidth > document.documentElement.clientWidth, small: [...document.querySelectorAll(q)].filter((x) => x.offsetParent && x.getBoundingClientRect().height < 44).map((x) => x.textContent.trim().slice(0, 30)) }), sel);
      const dark = colorScheme === "dark";

      // Inicio: no compra a la tienda → sin «Tu saldo» ni carrito; «Tu día» no dice «todo al día» con Carla vencida.
      await page.goto(base + "/hub");
      await page.locator(".tday").waitFor();
      assert.equal(await page.locator(".hbal").isVisible(), false, "sin «Tu saldo Bs 0»");
      assert.equal(await page.locator('.shead [data-cart]').isVisible(), false, "sin carrito");
      const tday = await page.locator(".tday").innerText();
      assert.doesNotMatch(tday, /todo al día/);
      assert.match(tday, /ya vencido/);
      assert.match(tday, /Bs 30/, "te deben");
      assert.match(await page.locator('.hsimple [data-s="codigos"]').innerText(), /Link para tus clientes/, "«Mis códigos» no promete leer sus correos");

      // Mi día: «Tus cuentas propias» con Carla en «Cobrar hoy»; arriba no dice «Todo al día acá ✅» en Cobrar.
      await tab("dia");
      await page.locator("#ownDay").waitFor();
      const dia = await page.locator("#sout").innerText();
      assert.match(await page.locator("#ownDay").innerText(), /Carla Rojas[\s\S]*debe Bs 30/);
      assert.doesNotMatch(dia, /Cliente Ajeno|Secreto/);
      assert.match(await page.locator(".rdia-s").first().innerText(), /De tus cuentas propias: 1/);
      assert.deepEqual(await check("#ownDay .sbtn"), { over: false, small: [] });

      if (!dark) {
        // «Renovó» pregunta «¿Te pagó?»: «Me paga después» acumula y se puede deshacer por unos segundos.
        await page.locator('#ownDay [data-os="renew"]').first().click();
        await page.locator(".os-sheet").waitFor();
        assert.match(await page.locator(".os-sheet").innerText(), /¿Te pagó\?[\s\S]*Sí, pagó Bs 30[\s\S]*Me paga después/);
        assert.deepEqual(await check(".os-sheet .sbtn, .os-sheet input, .os-sheet select"), { over: false, small: [] });
        await page.locator('.os-sheet [data-os="renewlater"]').click();
        await page.locator(".os-undo").waitFor();
        let c = (await own()).sales.find((x) => x.id === carla.id);
        assert.equal(c.debt, 6000, "Bs 30 de antes + Bs 30 de este período");
        await page.locator('.os-undo [data-os="undo"]').click();
        await page.waitForFunction(() => !document.querySelector(".os-undo"));
        c = (await own()).sales.find((x) => x.id === carla.id);
        assert.equal(c.debt, 3000, "deshecho");
        assert.ok(c.expiresAt < Date.now(), "vuelve a estar vencida");
      }

      // Mi control: sus clientes de cuentas propias, con los vencidos.
      await tab("control");
      await page.locator(".ownbox").waitFor();
      let box = await page.locator(".ownbox").innerText();
      assert.match(box, /Carla Rojas/); assert.doesNotMatch(box, /Cliente Ajeno/);
      assert.match(box, /Vencidos\s*1/);
      assert.deepEqual(await check(".ownbox button, .ownbox a.sbtn, .ownbox summary"), { over: false, small: [] });

      // Quién me debe: Carla debe Bs 30; «Me pagó» con monto parcial.
      await tab("debe");
      await page.locator(".ownbox").waitFor();
      box = await page.locator(".ownbox").innerText();
      assert.match(box, /te deben · Bs 30/);
      assert.doesNotMatch(await page.locator("#sout").innerText(), /Nadie te debe nada/);
      if (!dark) {
        await page.locator('.ownbox [data-os="pay"]').click();
        await page.locator('.os-sheet form[data-osf="pay"]').waitFor();
        await page.locator('.os-sheet input[name="amount"]').fill("10");
        await page.locator('.os-sheet button[type="submit"]').click();
        await page.waitForFunction(() => !document.querySelector(".os-sheet"));
        assert.equal((await own()).sales.find((x) => x.id === carla.id).debt, 2000, "pago parcial: debe Bs 20");
        await page.waitForFunction(() => /Bs 20/.test(document.querySelector(".ownbox")?.textContent ?? ""));
      }

      // Mis ganancias: entró − pagaste = te quedó (Mario pagó 25; al proveedor 80).
      await tab("ganancias");
      await page.locator("#ownEarn").waitFor();
      box = (await page.locator("#ownEarn").innerText()).replace(/\s+/g, " ");
      assert.match(box, dark ? /Entró Bs 25 − pagaste Bs 80 = te quedó Bs -55/ : /Entró Bs 35 − pagaste Bs 80 = te quedó Bs -45/, "Mario 25 (+ Carla 10 en claro) − proveedor 80");
      assert.match(box, /Mes por mes/);
      assert.deepEqual(await check("#ownEarn .sbtn, #ownEarn select"), { over: false, small: [] });

      if (!dark) {
        const marioBefore = (await own()).sales.find((x) => x.id === mario.id).expiresAt;
        // Su pestaña: la cuenta se cae → «Mover todos» → la fila de avisos con los datos nuevos (misma fecha).
        await tab("propias");
        await page.locator('[data-os="product"]').first().click();
        await page.locator('[data-os="account"]', { hasText: "flujo.uno" }).click();
        await page.locator('[data-os="down"]').click();
        await page.locator('.os-sheet form[data-osf="down"] button[type="submit"]').click();
        await page.waitForFunction(() => /Marcaste que se cayó/.test(document.querySelector("#sout")?.textContent ?? ""));
        assert.equal((await own()).accounts.find((x) => x.id === a1.id).free.length, 0, "ya no ofrece cupos");
        assert.equal(await page.locator('form[data-osf="assign"][data-acc="' + a1.id + '"]').count(), 0, "no deja dar cupos");
        await page.locator('[data-os="moveall"]').click();
        await page.locator('.os-sheet [data-os="moveallok"]').click();
        await page.locator("#osNotify").waitFor();
        const note = await page.locator("#osNotify").innerText();
        assert.match(note, /Carla Rojas[\s\S]*flujo\.dos/);
        assert.match(note, /Mario Soto/);
        const href = await page.locator('#osNotify a[href*="wa.me"]').first().getAttribute("href");
        assert.match(decodeURIComponent(href), /flujo\.dos[\s\S]*Clave-5678/, "datos nuevos en el mensaje");
        const after = await own();
        assert.equal(after.sales.find((x) => x.id === carla.id).accountId, a2.id);
        assert.equal(after.sales.find((x) => x.id === mario.id).expiresAt, marioBefore, "días regalados al mover: 0");
        assert.deepEqual(await check("#osNotify .sbtn, .os-acc .sbtn"), { over: false, small: [] });
        // Liberar con deuda: pregunta y la pasa a Quién me debe.
        await page.locator('[data-os="account"]', { hasText: "flujo.dos" }).click();
        await page.locator('[data-os="sale"]', { hasText: "Carla Rojas" }).first().click();
        await page.locator('.os-sale [data-os="release"]').first().click();
        assert.match(await page.locator(".os-sheet").innerText(), /Carla te debe Bs 20[\s\S]*¿Lo pasás a Quién me debe o lo perdonás\?/);
        await page.locator('.os-sheet [data-os="relfiado"]').click();
        await page.waitForFunction(() => !document.querySelector(".os-sheet"));
        const v = await own();
        assert.ok(!v.sales.some((x) => x.id === carla.id));
        assert.equal(v.totals.owed, 2000, "la deuda sigue");
      }
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
