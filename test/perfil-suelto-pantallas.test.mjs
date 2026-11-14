// Perfil suelto comprado a terceros — pantallas a 360 px (claro y oscuro): «➕ Compré un perfil» desde Inicio y Carga,
// la ficha del perfil en Cuentas, «⚠️ Se cayó» con sus tres salidas (opciones de 44 px en una fila), «Le pagué a Juan»
// y la línea de perfiles en «Proveedores por mes». Datos ficticios, carpeta temporal; los links de WhatsApp se cortan.
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

test("perfil suelto: pantallas a 360 px", { skip: !chromium && "Playwright no está instalado", timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-solo-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, E = s.engine, O = { id: Object.keys(E.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(O, { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 2500, published: true });
  s.catalog.upsertProduct(O, { id: "prime", name: "Prime", kind: "profile", durationDays: 30, price: 2000, published: true });
  const ana = s.catalog.createCustomer(O, { name: "Ana Ficticia", phone: "+59172000001", whatsappConsent: true });
  // Un perfil de Juan ya vendido a Ana (para la ficha) y otro libre de Netflix (para pasarla si se cae).
  const r1 = s.perfiles.buy(O, { productId: "nf", supplierName: "Juan", amount: 1500, email: "juan.nf@ficticio.lat", password: "JuanClave#1", label: "Perfil 3" });
  const aid = s.orders.create(O, { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [r1.slotId] }).assignmentIds[0];
  s.inventory.addAccount(O, { productId: "nf", email: "libre@ficticio.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 40 * DAY, cost: 3000, profiles: [{ label: "P1" }] });

  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ock = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
  const b = await chromium.launch();
  try {
    for (const scheme of ["light", "dark"]) {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [cn, cv] = ock.split("="); await ctx.addCookies([{ name: cn, value: cv, url: base }]);
      await ctx.addInitScript((th) => { try { localStorage.setItem("gs-panel-theme", th); } catch { /* */ } }, scheme);
      const p = await ctx.newPage(); const errs = [];
      p.on("pageerror", (e) => errs.push(e.message));
      p.on("dialog", (d) => d.accept());
      const view = async (v, sel) => { await p.goto(base + "/panel.html#" + v); await p.reload(); await p.waitForSelector(sel, { state: "attached" }); await p.waitForTimeout(300); };
      const over = () => p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1);
      const small = (sel) => p.evaluate((q) => [...document.querySelectorAll(q)].filter((x) => { const r = x.getBoundingClientRect(); return r.height && r.height < 44; }).map((x) => x.textContent.trim().slice(0, 30)), sel);

      // Inicio: el botón lleva al formulario de Carga.
      await view("inicio", ".tumes");
      await p.click("[data-pfgo]");
      await p.waitForSelector('[data-pfform="buy"]');
      assert.deepEqual(await small('#pfCompre button, #pfCompre input, #pfCompre select'), [], "todo de 44 px");
      assert.equal(await over(), false, "sin desborde");
      if (scheme === "light") {
        // Comprar un Prime a «juan» (el mismo vendedor) con un error primero: el aviso queda junto al formulario.
        const f = p.locator('[data-pfform="buy"]');
        await f.locator('[name="productId"]').selectOption("prime");
        await f.locator('[name="supplierName"]').fill("juan");
        await f.locator('[name="email"]').fill("juan.prime@ficticio.lat");
        await f.locator('[name="password"]').fill("JuanPrime#1");
        await f.locator('button[type="submit"]').click();
        assert.match(await f.locator(".pf-err").innerText(), /cuánto pagaste/);
        await f.locator('[name="amount"]').fill("14");
        await f.locator('button[type="submit"]').click();
        await p.waitForSelector("#pfCompre .pf-ok");
        assert.match(await p.locator("#pfCompre .pf-ok").innerText(), /libre para vender\. Gasto Bs 14 anotado el \d\d\/\d\d \(perfil suelto, Juan\)/);
        assert.equal(Object.values(E.s.suppliers).filter((x) => /juan/i.test(x.name)).length, 1, "no duplicó a Juan");
      }

      // Cuentas → el perfil de Juan: ficha, «Se cayó» con opciones de 44 px en una fila y «Le pagué a Juan».
      await view("cuentas", ".acard");
      await p.locator("#accq").fill("juan.nf");
      await p.waitForTimeout(400);
      await p.evaluate(() => { for (const d of document.querySelectorAll("details.pgrp")) d.open = true; });
      await p.locator(`[data-slotact="${r1.slotId}"]`).first().click();
      await p.waitForSelector(".pf-slot .pf-ficha");
      assert.equal((await p.locator(".pf-ficha").innerText()).trim(), "Te costó Bs 15 · lo vendiste a Bs 25 · ganás Bs 10");
      await p.locator(".pf-slot summary", { hasText: "Se cayó" }).click();
      await p.locator('.pf-down input[value="devolvio"]').check();
      assert.ok(await p.locator(".pf-down .pf-dev").isVisible(), "pide cuánto devolvió");
      assert.ok(await p.locator(".pf-down .pf-cli").isVisible(), "pregunta qué hacer con Ana");
      const rows = await p.evaluate(() => [...document.querySelectorAll(".pf-down .pf-opt")].map((l) => { const i = l.querySelector("input").getBoundingClientRect(), r = l.getBoundingClientRect(); return { h: r.height, sameRow: Math.abs((i.top + i.height / 2) - (r.top + r.height / 2)) < 8 }; }));
      assert.ok(rows.length >= 5 && rows.every((x) => x.h >= 44 && x.sameRow), JSON.stringify(rows));
      assert.deepEqual(await small(".pf-slot button, .pf-slot summary, .pf-slot input:not([type=radio]), .pf-slot select"), []);
      assert.equal(await over(), false);
      if (scheme === "dark") {
        // Juan le devolvió Bs 10: Ana pasa a la cuenta libre y se abre la fila para mandarle los datos nuevos.
        await p.locator('.pf-down [name="amount"]').fill("10");
        await p.locator('.pf-down button[type="submit"]').click();
        await p.waitForFunction(() => location.hash === "#control");
        assert.equal(E.s.accounts[E.s.slots[E.s.assignments[aid].slotId].accountId].email, "libre@ficticio.lat");
        assert.equal(E.s.slots[r1.slotId].status, "retired");
        assert.ok(E.s.expenses.some((x) => x.refund && x.amount === 1000 && x.category === "perfil"));
        // Proveedores por mes: la línea de perfiles de Juan.
        await view("proveedores", ".plprov");
        assert.match(await p.locator(".plprow", { hasText: "Juan" }).innerText(), /Perfiles: compré 2 .*vendí 1.*1 caída.*te devolvió Bs 10/s);
        assert.equal(await over(), false);
      }
      assert.deepEqual(errs, []);
      await ctx.close();
    }
  } finally {
    await b.close();
    await app.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
