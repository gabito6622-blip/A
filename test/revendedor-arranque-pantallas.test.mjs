// Revendedor nuevo en el celular (360 px, claro y oscuro), con datos ficticios (revisión de 3 meses, 15/11/2026):
// primeros pasos a la vista que se tachan solos, «pedísela a la tienda» sin página, el independiente explicado,
// la dirección desde el nombre de la tienda, su página sin marca ajena ni promesas falsas, el link de códigos con
// la plataforma real, «Mis descargas» sin desborde, el ojo solo para quien entró y el mensaje de la solicitud.
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

/** Desborde, botones de menos de 44 px y letras de menos de 12 px dentro de `sel`. */
const audit = (page, sel) => page.evaluate((sel) => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const root = document.querySelector(sel) ?? document.body;
  const small = [...root.querySelectorAll("button, a.sbtn, select, input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=file])")].filter(vis).filter((el) => el.getBoundingClientRect().height < 44).map((el) => `${(el.textContent || el.name || "").trim().slice(0, 24)} ${Math.round(el.getBoundingClientRect().height)}px`);
  const tiny = [];
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = w.nextNode(); n; n = w.nextNode()) { const el = n.parentElement; if (el && n.textContent.trim() && vis(el) && !el.closest("[aria-hidden=true]") && parseFloat(getComputedStyle(el).fontSize) < 12) tiny.push(`${n.textContent.trim().slice(0, 24)} ${getComputedStyle(el).fontSize}`); }
  return { overflow: document.documentElement.scrollWidth > document.documentElement.clientWidth, small, tiny };
}, sel);

test("revendedor nuevo en el celular: arranque, su página sin marca ajena, códigos y descargas", { skip: !chromium && "Playwright no está instalado", timeout: 300_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-r4-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {}, fetchImpl: async () => { throw new Error("sin red en las pruebas"); } });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
  s.catalog.updateSettings(owner, { storeName: "Gabriel Store", whatsapp: "59170000001" });
  s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix 1 perfil", kind: "profile", durationDays: 30, price: 3500, published: true, category: "Streaming" });
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney+ perfil", kind: "profile", durationDays: 30, price: 2800, published: true, category: "Streaming" });
  s.catalog.upsertPriceGroup(owner, { id: "rev", name: "Revendedores", prices: { nf: 2500, dis: 1900 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor ficticio", active: true });
  for (const [pid, i] of [["nf", 1], ["dis", 2]]) s.inventory.addAccount(owner, { productId: pid, supplierId: "prov", email: `${pid}${i}@ficticio.lat`, password: `Clave-Ficticia#${i}`, supplierExpiresAt: Date.now() + 90 * DAY, cost: 1000, profiles: [1, 2, 3, 4].map((k) => ({ label: `Perfil ${k}`, pin: String(1000 + k) })) });
  const approve = (name, phone, opts) => { s.shops.apply({ name, phone }); const a = Object.values(s.engine.s.resellerApps).find((x) => x.phone.endsWith(phone.slice(-8))); return s.shops.approve(owner, a.id, opts); };
  const ana = approve("Ana Quispe", "+59171110001", { trust: "trusted", priceGroupId: "rev" }); // solo panel
  const carla = approve("Carla Ruiz", "+59171110003", {}); // independiente
  const dani = approve("Daniela Paz", "+59171110004", { trust: "trusted", priceGroupId: "rev", page: true }); // con página
  const D = { id: "u_" + dani.customerId, role: "reseller", customerId: dani.customerId };
  s.wallet.adjust(owner, dani.customerId, 20000, "recarga ficticia");
  s.own.saveProduct(D, { name: "Flujo TV", emoji: "📡", durationDays: 30, price: 3000, kind: "profiles", slots: 3, onPage: true });
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  const errs = [];
  try {
    const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
    const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    const login = async (id, phone) => { const { pin } = await (await post(`/api/admin/customers/${id}/login-pin`, {}, ock)).json(); return (await post("/api/auth/customer/pin", { phone, pin })).headers.get("set-cookie").split(";")[0]; };
    const open = async (cookie, { dark = false, guideSeenFor = null } = {}) => {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true, colorScheme: dark ? "dark" : "light" });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      if (guideSeenFor) await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* */ } }, guideSeenFor);
      if (cookie) { const [n, v] = cookie.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]); }
      const page = await ctx.newPage();
      page.on("pageerror", (e) => errs.push(e.message));
      return { ctx, page };
    };

    /* ---- Visitante: sin el ojo de «Tapar montos» y la solicitud dice la verdad ---- */
    {
      const { ctx, page } = await open(null);
      await page.goto(base + "/revendedores");
      await page.locator(".phero").waitFor();
      assert.equal(await page.locator(".mnybtn").isVisible(), false, "un visitante no tiene montos que tapar");
      await page.locator("[data-apply]").first().click();
      assert.match(await page.locator("#applyForm").innerText(), /La tienda te va a escribir por WhatsApp con tu acceso/);
      await page.fill("#applyForm [name=name]", "Beto Visitante"); await page.fill("#applyForm [name=phone]", "+591 71119999");
      await page.click("#applyForm [type=submit]");
      await page.locator("#modal h2", { hasText: "Solicitud enviada" }).waitFor();
      assert.match(await page.locator("#modal").innerText(), /La tienda te va a escribir por WhatsApp con tu acceso/);
      await ctx.close();
    }

    /* ---- Ana: recién aprobada, solo panel, sin saldo ---- */
    const ack = await login(ana.customerId, ana.phone);
    for (const dark of [false, true]) {
      const { ctx, page } = await open(ack, { dark });
      await page.goto(base + "/hub#inicio");
      await page.locator(".arr-pasos").waitFor();
      await page.waitForTimeout(1300);
      assert.equal(await page.locator("#tour").count(), 0, "con primeros pasos la guía no tapa la pantalla");
      assert.equal(await page.locator(".mnybtn").isVisible(), true, "el revendedor sí tiene el ojo");
      const steps = (await page.locator(".arr-pasos .paso b").allInnerTexts()).map((t) => t.trim());
      assert.deepEqual(steps, ["Recargá saldo", "Hacé tu primera venta", "Tu página: pedísela a la tienda"]);
      const ask = page.locator(".arr-pasos .paso.ask a[href*='wa.me']");
      assert.match(decodeURIComponent(await ask.getAttribute("href")), /wa\.me\/59170000001\?text=.*Quiero mi página propia/);
      assert.ok((await page.locator(".arr-pasos").boundingBox()).y < 400, "a la vista, arriba (no plegado)");
      assert.doesNotMatch(await page.locator(".hmore > summary").innerText(), /Mi página/, "no promete «Mi página» si no la tiene");
      const a = await audit(page, ".arr-pasos");
      assert.deepEqual([a.overflow, a.small, a.tiny], [false, [], []], `${dark ? "oscuro" : "claro"}: ${JSON.stringify(a)}`);
      if (!dark) {
        assert.match(await page.locator("#refLink").inputValue(), /\/revendedores\?ref=/);
        await page.click('.bnav [data-s="mas"]');
        await page.locator(".hubarea").first().waitFor();
        assert.match(await page.locator("#sout").innerText(), /Pedir mi página a la tienda/);
      }
      await ctx.close();
    }
    // Recarga: el primer paso se tacha solo; «Vender» lleva directo al formulario de venta.
    s.wallet.adjust(owner, ana.customerId, 10000, "recarga ficticia");
    {
      const { ctx, page } = await open(ack, { guideSeenFor: ana.customerId });
      await page.goto(base + "/hub#inicio");
      await page.locator(".arr-pasos").waitFor();
      assert.equal(await page.locator(".arr-pasos .paso.done s", { hasText: "Recargá saldo" }).count(), 1);
      assert.match(await page.locator(".arr-pasos b").first().innerText(), /1 de 3/);
      await page.locator('.arr-pasos [data-rtool="ventas"]').click();
      await page.locator("#resSell").waitFor();
      await ctx.close();
    }

    /* ---- Carla: independiente, explicado en una línea; sin catálogo vacío ---- */
    {
      const cck = await login(carla.customerId, carla.phone);
      const { ctx, page } = await open(cck, { guideSeenFor: carla.customerId });
      await page.goto(base + "/hub#inicio");
      await page.locator(".arr-indep").waitFor();
      assert.match(await page.locator(".arr-indep").innerText(), /Independiente.*cuentas propias.*no le comprás a la tienda.*pedíselo a la tienda/s);
      assert.deepEqual((await page.locator(".arr-pasos .paso b").allInnerTexts()).map((t) => t.trim()), ["Hacé tu primera venta", "Tu página: pedísela a la tienda"], "sin paso de recarga");
      await page.goto(base + "/hub#precios"); await page.reload();
      await page.locator(".arr-indepcat").waitFor();
      assert.doesNotMatch(await page.locator("#sout").innerText(), /Todavía no hay productos para revendedores/);
      const a = await audit(page, "#sout");
      assert.equal(a.overflow, false);
      await ctx.close();
    }

    /* ---- Daniela (con página): la dirección sale del nombre de la tienda y se confirma antes de publicar ---- */
    const dck = await login(dani.customerId, dani.phone);
    {
      const { ctx, page } = await open(dck, { guideSeenFor: dani.customerId });
      await page.goto(base + "/hub#inicio");
      await page.locator(".arr-pasos [data-wiz]").click();
      await page.locator("#wiz1").waitFor();
      await page.fill("#wiz1 [name=title]", "");
      await page.locator("#wiz1 [name=title]").pressSequentially("Ana TV");
      await page.waitForFunction(() => document.querySelector("#wiz1 [name=slug]").value === "ana-tv");
      await page.locator("#slugMsg", { hasText: "Libre" }).waitFor();
      const a1 = await audit(page, "#wiz1");
      assert.deepEqual([a1.overflow, a1.small, a1.tiny], [false, [], []], JSON.stringify(a1));
      await page.click("#wiz1 [type=submit]");
      await page.locator("#wiz2").waitFor();
      assert.match(await page.locator("#wiz2 .arr-where").innerText(), /\/r\/ana-tv/);
      await page.click("#wiz2 [type=submit]");
      await page.locator(".wiz.done").waitFor();
      assert.match(await page.locator(".wiz.done code").innerText(), /\/r\/ana-tv$/);
      // Mis descargas: sin desborde ni letras chicas a 360 px.
      await page.goto(base + "/hub#inicio"); await page.reload();
      await page.click('.bnav [data-s="mas"]');
      await page.locator('.hubarea [data-rtool="descargas"]').click();
      await page.locator(".dl-grid").waitFor();
      for (const dark of [false, true]) {
        await page.emulateMedia({ colorScheme: dark ? "dark" : "light" });
        const a = await audit(page, "#sout");
        assert.equal(a.overflow, false, "Mis descargas sin desborde");
        assert.deepEqual(a.tiny, [], "sin letras de menos de 12 px");
      }
      await ctx.close();
    }

    /* ---- Camila, clienta de Daniela, en /r/ana-tv: solo la marca de Daniela, sin promesas falsas ---- */
    for (const dark of [false, true]) {
      const { ctx, page } = await open(null, { dark });
      await page.goto(base + "/r/ana-tv");
      await page.locator(".hero, .tkhero").first().waitFor();
      await page.waitForTimeout(400);
      const body = await page.locator("body").innerText();
      assert.doesNotMatch(body, /Gabriel|GaboHub|software protegido/i, "ni el nombre de la tienda ni el de la plataforma");
      assert.doesNotMatch(body, /Mis cuentas|con saldo|entrega al instante|reponemos|garant/i, "sin promesas que el revendedor no da");
      assert.doesNotMatch(body, /\bown\b/, "las tarjetas no dicen «own»");
      assert.match(body, /Flujo TV/);
      const links = await page.$$eval(".sfoot a", (as) => as.map((x) => x.getAttribute("href")));
      assert.ok(!links.some((h) => /terminos|privacidad/.test(h)), JSON.stringify(links));
      await page.locator(".sfoot [data-conds]").click();
      await page.locator("#modal .rconds").waitFor();
      assert.match(await page.locator("#modal").innerText(), /Condiciones de Ana TV/);
      assert.doesNotMatch(await page.locator("#modal").innerText(), /Gabriel|GaboHub/);
      await page.locator("#modal [data-close]").last().click();
      const a = await audit(page, "body");
      assert.equal(a.overflow, false, `${dark ? "oscuro" : "claro"}: sin desborde`);
      await ctx.close();
    }

    /* ---- Link de códigos de un cliente con Netflix: el texto dice Netflix y «recién» entra en una línea ---- */
    {
      const fab = s.catalog.createCustomer(owner, { name: "Fabio Choque", phone: "+59171110505" });
      s.orders.create(owner, { customerId: fab.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" });
      const mail = s.engine.s.accounts[s.engine.s.slots[Object.values(s.engine.s.assignments).find((x) => x.customerId === fab.id).slotId].accountId].email;
      const mb = s.codes.configureMailbox(owner, { address: "codigos@ficticio.lat", host: "imap.ficticio.lat" });
      s.codes.ingest(owner, mb.id, { to: mail, subject: "Tu código de acceso temporal de Netflix", body: "Tu código es 482915", receivedAt: Date.now(), from: "info@account.netflix.com" });
      const link = await (await post(`/api/admin/customers/${fab.id}/code-link`, {}, ock)).json();
      for (const dark of [false, true]) {
        const { ctx, page } = await open(null, { dark });
        await page.goto(link.url.replace(/^https?:\/\/[^/]+/, base));
        await page.locator("#em").waitFor();
        assert.match(await page.locator("#app").innerText(), /Netflix/);
        await page.fill("#em", mail); await page.click("#fe [type=submit]");
        await page.locator(".code").waitFor();
        const txt = await page.locator("#app").innerText();
        assert.doesNotMatch(txt, /Disney/, "no dice Disney+ si su cuenta es de Netflix");
        const recien = page.locator(".code .top > small").first();
        assert.equal(await recien.innerText(), "recién");
        const lh = await recien.evaluate((el) => [el.getBoundingClientRect().height, parseFloat(getComputedStyle(el).lineHeight) || 20]);
        assert.ok(lh[0] <= lh[1] * 1.2, `«recién» en una sola línea (${lh})`);
        assert.equal((await audit(page, "#app")).overflow, false);
        await ctx.close();
      }
    }
    assert.deepEqual(errs, []);
  } finally {
    await b.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
