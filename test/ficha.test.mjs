// 👤 Ficha 360° del cliente (etapa 4): al abrir un cliente en Clientes se ven sus servicios, pedidos y fallas, y
// Renovar, Pagado y Reemplazar hacen ahí mismo LO MISMO que en Renovar y el Control (mismas rutas). Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

test("ficha 360°: servicios, pedidos y fallas del cliente, con Renovar, Pagado y Reemplazar ahí mismo; Atención sin Reemplazar", { skip: !chromium, timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-ficha-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const login = async (u, p) => (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: u, password: p }) })).headers.get("set-cookie").split(";")[0];
    const ck = await login("gabriel", "clave-del-dueño-123");
    const A = (m, p, body, cookie = ck) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    await A("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
    await A("POST", "/api/admin/products", { id: "disney", name: "Disney+", kind: "profile", durationDays: 30, price: 3500, published: true });
    await A("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true });
    await A("POST", "/api/admin/accounts", { productId: "disney", supplierId: "andes", email: "dis.uno@ejemplo.lat", password: "Secreta#99", supplierExpiresAt: Date.now() + 120 * 864e5, cost: 2000, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }, { label: "Perfil 3" }] });
    const ana = await A("POST", "/api/admin/customers", { name: "Ana Quispe", phone: "+59170011223" });
    await A("POST", "/api/admin/orders", { customerId: ana.id, items: [{ productId: "disney", qty: 1 }], paymentMethod: "cash" });
    const [svc] = await A("GET", `/api/admin/assignments?customerId=${ana.id}`);
    await A("POST", `/api/admin/assignments/${svc.id}/control`, { payStatus: "pendiente" });
    const url = (await A("POST", `/api/admin/customers/${ana.id}/login-link`, {})).url;
    const anaCk = (await fetch(base + "/api/auth/customer/link", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: url.split("#acceso=")[1] }) })).headers.get("set-cookie").split(";")[0];
    await A("POST", "/api/me/tickets", { assignmentId: svc.id, kind: "no_entra", note: "dice contraseña incorrecta" }, anaCk);
    const before = svc.customerExpiresAt;

    const open = async (user, pass, scheme = "light") => {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme });
      await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      p.on("dialog", (d) => d.accept());
      await p.goto(base + "/panel.html#clientes");
      await p.fill("input[name=username]", user); await p.fill("input[name=password]", pass); await p.press("input[name=password]", "Enter");
      await p.waitForSelector(`details.rcli[data-cid="${ana.id}"]`);
      await p.click(`details.rcli[data-cid="${ana.id}"] > summary`);
      await p.waitForSelector(`[data-fxslot="${ana.id}"] .fx`);
      return { p, ctx, errs };
    };

    // Dueño.
    const { p, ctx, errs } = await open("gabriel", "clave-del-dueño-123");
    const fx = `[data-fxslot="${ana.id}"]`;
    assert.match(await p.locator(`${fx} [data-fxtab="svc"]`).innerText(), /Servicios \(1\)/);
    assert.match(await p.locator(`${fx} [data-fxtab="bug"]`).innerText(), /Fallas \(1\)/);
    assert.equal(await p.locator(`${fx} [data-replace="${svc.id}"]`).count(), 1, "el dueño ve Reemplazar");
    assert.match(await p.locator(`${fx} .fx-svc`).innerText(), /Disney\+[\s\S]*Perfil[\s\S]*Pendiente de pago/);
    assert.ok(!/Secreta#99|2000/.test(await p.locator(fx).innerText()), "ni contraseña ni costo");
    // Pestañas.
    await p.click(`${fx} [data-fxtab="bug"]`);
    assert.match(await p.locator(`${fx} [data-pane="bug"]`).innerText(), /No me deja entrar/);
    await p.click(`${fx} [data-fxtab="pay"]`);
    assert.match(await p.locator(`${fx} [data-pane="pay"]`).innerText(), /Compra/);
    await p.click(`${fx} [data-fxtab="svc"]`);
    // Celular: sin desborde, botones de 44 px.
    const m = await p.evaluate((fx) => ({
      over: document.documentElement.scrollWidth > innerWidth + 1,
      small: [...document.querySelectorAll(`${fx} button, ${fx} summary, ${fx} a.pbtn`)].filter((x) => { const r = x.getBoundingClientRect(); return r.height && r.height < 44; }).length,
    }), fx);
    assert.deepEqual(m, { over: false, small: 0 });
    // Pagado: misma ruta que el Control.
    await p.click(`${fx} [data-paid="${svc.id}"]`);
    await p.waitForFunction((id) => !document.querySelector(`[data-paid="${id}"]`) && document.querySelector(".fx"), svc.id, { timeout: 15_000 });
    assert.equal((await A("GET", `/api/admin/assignments?customerId=${ana.id}`))[0].control.payStatus, "pagado");
    // La ficha sigue abierta después de la acción.
    assert.equal(await p.locator(`details.rcli[data-cid="${ana.id}"][open] .fx`).count(), 1);
    // Renovar: misma ruta que la pantalla Renovar (+1 período).
    await p.click(`${fx} [data-renew="${svc.id}"]`);
    await p.waitForFunction(async ([id, prev]) => {
      const r = await fetch(`/api/admin/assignments?customerId=${id}`).then((x) => x.json()); return r[0]?.customerExpiresAt > prev;
    }, [ana.id, before], { timeout: 15_000 });
    const after = (await A("GET", `/api/admin/assignments?customerId=${ana.id}`))[0].customerExpiresAt;
    assert.ok(after - before >= 29 * 864e5, "sumó un período");
    // Reemplazar: misma ruta que la pantalla Renovar.
    await p.click(`${fx} .fx-more summary`);
    await p.fill(`${fx} [data-replace="${svc.id}"] input[name=reason]`, "perfil bloqueado");
    await p.click(`${fx} [data-replace="${svc.id}"] button[type=submit]`);
    await p.waitForFunction(async ([id, old]) => {
      const r = await fetch(`/api/admin/assignments?customerId=${id}`).then((x) => x.json()); return r[0] && r[0].slotId !== old;
    }, [ana.id, svc.slotId], { timeout: 15_000 });
    assert.deepEqual(errs, []);
    await ctx.close();

    // Atención: ve la ficha, pero sin Reemplazar (como en Renovar) y sin costos.
    const s = await open("lucia", "clave-de-lucia-123", "dark");
    assert.equal(await s.p.locator(`${fx} [data-replace]`).count(), 0, "Atención no reemplaza");
    assert.equal(await s.p.locator(`${fx} [data-renew]`).count(), 1, "Atención sí renueva, como hoy");
    assert.deepEqual(s.errs, []);
    await s.ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
