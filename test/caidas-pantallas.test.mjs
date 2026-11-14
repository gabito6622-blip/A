// Cuentas caídas sin sorpresas — pantallas a 360 px (claro y oscuro): marcar caída, Reubicar exacto, Notificaciones en
// rojo, «💳 Pagué la renovación» y «Pagar varias» desde la tarjeta, fila de envíos que sobrevive a recargar y pregunta
// si la vieja murió, fecha sospechosa al cargar, Cortes plegado y el cartel del revendedor en GaboHub.
// Datos ficticios, carpeta temporal; los links de WhatsApp se cortan (nunca sale nada).
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const SHOTS = process.env.GS_SHOTS || ""; // carpeta FUERA del repo para las capturas (opcional)

test("cuentas caídas: pantallas a 360 px", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-eq3-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, E = s.engine, O = { id: Object.keys(E.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(O, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(O, { id: "nfc", name: "Netflix completa", kind: "full_account", durationDays: 30, price: 9000, published: true });
  s.catalog.upsertPriceGroup(O, { id: "revendedor", name: "Revendedor", prices: { nf: 2500, nfc: 7000 } });
  s.catalog.upsertSupplier(O, { id: "ana", name: "Prov Ana", active: true });
  let n = 0;
  const add = (email, days, k, pid = "nf") => s.inventory.addAccount(O, { productId: pid, supplierId: "ana", email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + days * DAY, cost: 3000, profiles: Array.from({ length: k }, (_, i) => ({ label: `Perfil ${i + 1}` })) }).account;
  const cust = (name, kind) => s.catalog.createCustomer(O, { name, phone: `+5917200${String(n++).padStart(4, "0")}`, whatsappConsent: true, ...(kind ? { kind } : {}) });
  const slots = (acc) => Object.values(E.s.slots).filter((x) => x.accountId === acc.id).sort((a, b) => a.label.localeCompare(b.label));
  const sell = (c, acc, i, days, pid = "nf") => { const o = s.orders.create(O, { customerId: c.id, items: [{ productId: pid, qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slots(acc)[i].id] }); s.orders.setExpiry(O, o.assignmentIds[0], Date.now() + days * DAY); return o.assignmentIds[0]; };
  const accOf = (aid) => E.s.accounts[E.s.slots[E.s.assignments[aid].slotId].accountId];
  const caida = add("caida@ficticio.lat", 40, 3), sana = add("sana@ficticio.lat", 45, 1);
  const enCaida = [0, 1, 2].map((i) => sell(cust(`Caído ${i + 1}`), caida, i, 20 + i));
  const vieja = add("vieja@ficticio.lat", 6, 2);
  let nueva; // se carga después de Reubicar (así faltan perfiles para los de la caída)
  const enVieja = [0, 1].map((i) => sell(cust(`Viejo ${i + 1}`), vieja, i, 25));
  // Cortes: una cuenta desalineada (para ver el plegado).
  const cortes = add("cortes@ficticio.lat", 50, 3);
  [0, 1, 2].forEach((i) => sell(cust(`Corte ${i + 1}`), cortes, i, 10 + i * 4));
  // Revendedora con una cuenta completa y sus dos clientes anotados; otra revendedora sin nada que ver.
  const rv = add("rev-vieja@ficticio.lat", 40, 1, "nfc"); add("rev-nueva@ficticio.lat", 60, 1, "nfc");
  const rosa = cust("Rosa Revende", "reseller"); cust("Lalo Revende", "reseller");
  const RO = { id: "u_" + rosa.id, role: "reseller", customerId: rosa.id };
  const rent = sell(rosa, rv, 0, 20, "nfc");
  s.subs.save(RO, rent, { name: "Camila Rojas", phone: "+59171112233", label: "Perfil 1", expiresAt: Date.now() + 10 * DAY });
  s.subs.save(RO, rent, { name: "Diego Mamani", phone: "+59171112244", label: "Perfil 2", expiresAt: Date.now() + 12 * DAY });

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const post = (p, b, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(b) });
  const ock = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  if (SHOTS) mkdirSync(SHOTS, { recursive: true });
  try {
    for (const scheme of ["light", "dark"]) {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [cn, cv] = ock.split("="); await ctx.addCookies([{ name: cn, value: cv, url: base }]);
      await ctx.addInitScript((th) => { try { localStorage.setItem("gs-panel-theme", th); } catch { /* */ } }, scheme);
      const p = await ctx.newPage(); const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      p.on("dialog", (d) => d.accept());
      const shot = async (name) => { if (SHOTS) await p.screenshot({ path: join(SHOTS, `${scheme}-${name}.png`), fullPage: false }); };
      const over = () => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const view = async (v, sel) => { await p.goto(base + "/panel.html#" + v); await p.reload(); await p.waitForSelector(sel, { state: "attached" }); await p.waitForTimeout(300); };
      const openAll = () => p.evaluate(() => { for (const d of document.querySelectorAll("details.pgrp, .acard details.more")) d.open = true; });
      const card = (email) => p.locator(".acard", { hasText: email });

      if (scheme === "light") {
        // 2) «⚠️ Se cayó, todavía no la muevo»: solo marca.
        await view("cuentas", ".acard"); await openAll();
        await p.click(`[data-cxfall="${caida.id}"]`);
        await p.waitForSelector(".acard .cx-ban.bad", { state: "attached" });
        assert.ok(E.s.accounts[caida.id].fallen, "quedó marcada");
        assert.deepEqual(enCaida.map((a) => accOf(a).id), [caida.id, caida.id, caida.id], "no movió a nadie");
        await openAll();
        const cc = p.locator(".acard", { has: p.locator(`[data-cxunfall="${caida.id}"]`) });
        assert.equal(await cc.locator("[data-unquar]").count(), 0, "no ofrece «Liberar en cuarentena»");
        assert.equal(await cc.locator('[data-go="reubicar"]').count(), 1, "lleva a Reubicar");
        assert.match(await cc.innerText(), /3 clientes sin servicio/);
        await shot("01-cuenta-caida");
        // Notificaciones en rojo: faltan 2 (hay un solo lugar libre en una cuenta sana).
        await view("notificaciones", ".notis");
        const red = await p.locator(".notirow.noti-bad", { hasText: "Faltan 2 perfiles de Netflix: cargá una cuenta" }).count();
        assert.equal(red, 1, "Notificaciones: faltan 2, en rojo");
        await shot("02-notificaciones");
        // Reubicar: «Mover» va a la cuenta que muestra.
        await view("reubicar", ".relrow");
        const rows = await p.locator(".relrow").count();
        assert.equal(rows, 3);
        assert.equal(await p.locator(".relrow .pp-bad", { hasText: "Falta un perfil" }).count(), 2);
        const mv = p.locator("[data-relocate]").first();
        const to = await mv.getAttribute("data-to"), who = await mv.getAttribute("data-relocate");
        assert.equal(to, sana.id);
        await shot("03-reubicar");
        await mv.click();
        await p.waitForFunction(() => document.querySelectorAll(".relrow").length === 2);
        assert.equal(accOf(who).id, sana.id, "fue a la que mostraba");
        assert.equal(await over(), false);
        nueva = add("nueva@ficticio.lat", 60, 3);

        // 9) «💳 Pagué la renovación» desde la tarjeta, sin abrir Editar ni mostrar la clave.
        await view("cuentas", ".acard"); await openAll();
        const exp0 = E.s.expenses.length, until0 = E.s.accounts[nueva.id].supplierExpiresAt;
        await p.click(`[data-cxpay="${nueva.id}"]`);
        await p.waitForSelector("#cxPayCard form[data-renewpaid]");
        assert.ok(!/Clave-Larga#1/.test(await p.evaluate(() => document.body.innerText)), "ninguna clave a la vista");
        await shot("04-pague-renovacion");
        await p.click("#cxPayCard button[type=submit]");
        await p.waitForFunction((n) => true, 0); await p.waitForTimeout(600);
        assert.equal(E.s.expenses.length, exp0 + 1);
        assert.ok(E.s.accounts[nueva.id].supplierExpiresAt > until0, "corrió el vencimiento");
        // «Pagar varias»: dos del mismo proveedor.
        await p.click("[data-cxmany='1']");
        await p.waitForSelector("#cxPayMany");
        await p.evaluate(() => { const f = document.querySelector("#cxPayMany"); f.querySelectorAll('input[name="pick"]').forEach((x, i) => { x.checked = i < 2; }); f.dispatchEvent(new Event("change", { bubbles: true })); });
        assert.match(await p.locator("#cxManyTotal").innerText(), /2 cuentas · Bs 60/);
        assert.equal(await over(), false, "Pagar varias sin desborde");
        await shot("05-pagar-varias");
        await p.click("#cxPayMany button[type=submit]");
        await p.waitForFunction(() => !document.querySelector("#cxPayMany"));
        assert.equal(E.s.expenses.length, exp0 + 3);

        // 3) y 7) Mover todos → fila con el resultado arriba, «Cambiamos tu cuenta», no se pierde al recargar, ¿murió?
        await openAll();
        const f = p.locator(`form[data-moveall="${vieja.id}"]`);
        await f.locator("select[name=to]").selectOption(nueva.id);
        await f.locator("button[type=submit]").click();
        await p.waitForSelector("#sendq .cx-ask");
        await p.waitForTimeout(400);
        assert.deepEqual(enVieja.map((a) => accOf(a).id), [nueva.id, nueva.id]);
        const sq = await p.evaluate(() => {
          const a = document.querySelector("#sendq a[data-sendqsent]"), r = a.getBoundingClientRect();
          const top = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          const t = document.querySelector("#toast");
          return { text: document.querySelector("#sendq").innerText, free: a.contains(top), toast: t && !t.hidden ? t.getBoundingClientRect() : null, btn: { top: r.top, bottom: r.bottom } };
        });
        assert.match(sq.text, /Cambiamos tu cuenta de \*Netflix\*, estos son tus datos nuevos/);
        assert.ok(!/Gracias por tu compra/.test(sq.text));
        assert.match(sq.text, /2 clientes pasados a nueva@ficticio\.lat/);
        assert.match(sq.text, /¿La cuenta vieja murió\?/);
        assert.ok(sq.free, "nada tapa «Enviar por WhatsApp»");
        assert.ok(!sq.toast || sq.toast.top > sq.btn.bottom || sq.toast.bottom < sq.btn.top, "el aviso no tapa el botón");
        await shot("06-fila-envios");
        // Recargar: la fila sigue.
        await p.reload(); await p.waitForSelector("#sendq");
        assert.match(await p.locator("#sendq").innerText(), /Viejo 1/);
        assert.ok(!/Clave-Larga/.test(await p.evaluate(() => localStorage.getItem("gs-sendq") ?? "")), "la fila guardada no lleva claves");
        await p.click("[data-cxretireq='yes']");
        await p.waitForFunction(() => /quedó retirada/.test(document.querySelector("#sendq")?.innerText ?? ""));
        assert.equal(E.s.accounts[vieja.id].status, "retired");
        await p.click("#sendq [data-sendq='stop']");
        assert.equal(await p.evaluate(() => localStorage.getItem("gs-sendq")), null);

        // 6) Fecha sospechosa al cargar: «¿Pagaste N meses?».
        await view("carga", "#quickForm");
        const far = new Date(Date.now() + 92 * DAY), ymd = `${far.getFullYear()}-${String(far.getMonth() + 1).padStart(2, "0")}-${String(far.getDate()).padStart(2, "0")}`;
        const n0 = Object.keys(E.s.accounts).length;
        await p.fill("#quickForm input[name=email]", "tres-meses@ficticio.lat"); await p.fill("#quickForm input[name=password]", "Clave#Tres1");
        await p.fill("#quickForm input[name=cost]", "35"); await p.fill("#quickForm input[name=exp]", ymd);
        await p.click("#quickForm button[type=submit]");
        await p.waitForSelector("#quickForm .cx-expq");
        assert.match(await p.locator("#quickForm .cx-expq").innerText(), /¿Pagaste 3 meses al proveedor\?/);
        assert.equal(Object.keys(E.s.accounts).length, n0, "no se guardó todavía");
        await shot("07-carga-pregunta");
        await p.check("#quickForm input[name=expOk]");
        await p.click("#quickForm button[type=submit]");
        await p.waitForFunction((k) => true, 0); await p.waitForTimeout(700);
        assert.ok(Object.values(E.s.accounts).some((a) => a.email === "tres-meses@ficticio.lat"), "con la confirmación, se guardó");
        // Carga por lista.
        await p.evaluate(() => document.querySelector("#bulkForm")?.closest("details")?.setAttribute("open", ""));
        const dd = `${String(far.getDate()).padStart(2, "0")}/${String(far.getMonth() + 1).padStart(2, "0")}/${far.getFullYear()}`;
        await p.fill("#bulkForm textarea[name=rows]", `lista-lejos@ficticio.lat, Clave#L1, 5, ${dd}`);
        await p.click("#bulkForm button[type=submit]");
        await p.waitForSelector("#bulkOut .cx-expq");
        assert.ok(!Object.values(E.s.accounts).some((a) => a.email === "lista-lejos@ficticio.lat"));
        await p.check("#bulkOut input[name=bulkExpOk]");
        await p.click("#bulkForm button[type=submit]");
        await p.waitForFunction(() => /1 cuentas cargadas/.test(document.body.innerText));
        assert.ok(Object.values(E.s.accounts).some((a) => a.email === "lista-lejos@ficticio.lat"));
      }

      // 10) Cortes plegado por cuenta en el celular.
      await view("cortes", ".cx-cut");
      const cut = await p.evaluate(() => ({ open: [...document.querySelectorAll("details.cx-cut")].filter((d) => d.open).length, n: document.querySelectorAll("details.cx-cut").length, h: document.documentElement.scrollHeight, sum: [...document.querySelectorAll("details.cx-cut > summary")].map((x) => x.getBoundingClientRect().height) }));
      assert.ok(cut.n >= 1 && cut.open === 0, `cortes plegados (${JSON.stringify(cut)})`);
      assert.ok(cut.sum.every((h) => h >= 44), "se tocan con el dedo");
      assert.ok(cut.h < 780 * 3, `no mide pantallas y pantallas (${cut.h}px)`);
      assert.equal(await over(), false);
      await shot("08-cortes");
      // Cuentas en los dos temas: sin desborde.
      await view("cuentas", ".acard"); await openAll();
      assert.equal(await over(), false, `${scheme}: cuentas sin desborde`);
      const small = await p.evaluate(() => [...document.querySelectorAll(".cx-ban, .cx-ban *")].map((x) => parseFloat(getComputedStyle(x).fontSize)).filter((v) => v < 12));
      assert.deepEqual(small, [], "texto de 12 px o más");
      await shot("09-cuentas");
      assert.deepEqual(errs, [], `${scheme}: sin errores en la consola`);
      await ctx.close();
    }

    // 8) GaboHub: la revendedora ve el cartel en ESA cuenta con SUS dos clientes; «Ya les avisé» lo saca.
    s.orders.moveAll(O, rv.id, { toAccountId: Object.values(E.s.accounts).find((a) => a.email === "rev-nueva@ficticio.lat").id, reason: "caída" });
    const { pin } = await (await post(`/api/admin/customers/${rosa.id}/login-pin`, {}, ock)).json();
    const rck = (await post("/api/auth/customer/pin", { phone: rosa.phone, pin })).headers.get("set-cookie").split(";")[0];
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
    await ctx.addInitScript((id) => { try { localStorage.setItem("gs-guide-" + id, "1"); } catch { /* */ } }, rosa.id);
    const [rn, rv2] = rck.split("="); await ctx.addCookies([{ name: rn, value: rv2, url: base }]);
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base + "/hub#clientes");
    await p.locator(".rtabs").waitFor();
    if (await p.locator('[data-rtab="perfiles"]').count()) await p.locator('[data-rtab="perfiles"]').click();
    else { await p.locator('.bnav [data-s="mas"]').click(); await p.locator('#sout [data-rtool="perfiles"]').click(); }
    await p.waitForSelector(".accchg");
    const box = await p.locator(".accchg").innerText();
    assert.match(box, /Cambió la cuenta: avisá a tus 2 clientes/);
    assert.match(box, /Camila Rojas/); assert.match(box, /Diego Mamani/);
    const links = await p.locator(".accchg a.sbtn").evaluateAll((l) => l.map((a) => decodeURIComponent(a.href)));
    assert.equal(links.length, 2);
    assert.ok(links.every((h) => /wa\.me\/591711122(33|44)/.test(h) && /rev-nueva@ficticio\.lat/.test(h) && !/Clave-Larga/.test(h)), links.join(" | "));
    assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
    if (SHOTS) { await p.locator(".accchg").scrollIntoViewIfNeeded(); await p.screenshot({ path: join(SHOTS, "10-gabohub-cambio.png") }); }
    await p.click("[data-accchgseen]");
    await p.waitForFunction(() => !document.querySelector(".accchg"));
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
