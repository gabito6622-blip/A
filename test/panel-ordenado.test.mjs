// Panel ordenado en 6 áreas (12/11/2026). Regla del dueño: no se pierde NINGUNA pantalla. Esta prueba compara, rol
// por rol, las pantallas del menú nuevo con la foto del menú anterior (inventario del 12/11), abre cada una sin error,
// y revisa el buscador de pantallas, la barra de abajo y "Lo que tenés pendiente" en Inicio. Datos ficticios.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }

// Foto del menú ANTERIOR: lo que cada rol podía abrir (inventario del 12/11/2026).
const BEFORE = {
  owner: "inicio oficina vender control renovar dashboard finanzas fiado quevuelvan notificaciones fallas reubicar aprobacion recordatorios codigos cuentas carga productos cupones revendedores comovan proveedores clientes excel whatsapp apariencia usuarios auditoria configuracion ayuda",
  admin: "inicio oficina vender control renovar dashboard fiado quevuelvan notificaciones fallas reubicar aprobacion recordatorios cuentas carga productos cupones revendedores comovan proveedores clientes excel whatsapp apariencia configuracion ayuda",
  seller: "inicio vender control renovar fiado quevuelvan notificaciones fallas aprobacion recordatorios revendedores clientes excel whatsapp configuracion ayuda",
};
// Pantallas NUEVAS agregadas después de la foto (se suman; ninguna reemplaza a otra).
// 12/11/2026: "Mi secretaria" (todo lo pendiente en una pantalla) para el dueño y el admin.
const ADDED = { owner: "secretaria cortes", admin: "secretaria cortes", seller: "" };
const USERS = { owner: ["gabriel", "clave-del-dueño-123"], admin: ["ada", "clave-de-ada-123"], seller: ["lucia", "clave-de-lucia-123"] };

test("menú en 6 áreas: cada rol conserva exactamente sus pantallas, todas abren, buscador, barra de abajo y pendientes en Inicio", { skip: !chromium, timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-panel-ordenado-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const A = (m, p, body) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    await A("POST", "/api/admin/staff", { username: "ada", name: "Ada", role: "admin", password: "clave-de-ada-123" });
    await A("POST", "/api/admin/staff", { username: "lucia", name: "Lucía", role: "seller", password: "clave-de-lucia-123" });
    await A("POST", "/api/admin/products", { id: "netflix", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    await A("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true });
    await A("POST", "/api/admin/accounts", { productId: "netflix", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 5 * 864e5, cost: 3000, profiles: [{ label: "P1" }, { label: "P2" }] });
    const ana = await A("POST", "/api/admin/customers", { name: "Ana Quispe", phone: "+59170011223" });
    await A("POST", "/api/admin/orders", { customerId: ana.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });

    for (const role of ["owner", "admin", "seller"]) {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
      await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      await p.goto(base + "/panel.html#inicio");
      await p.fill("input[name=username]", USERS[role][0]); await p.fill("input[name=password]", USERS[role][1]); await p.press("input[name=password]", "Enter");
      await p.waitForSelector("#menu button[data-go]");
      // 1) Mismas pantallas que antes, ni una más ni una menos.
      const now = await p.evaluate(() => [...new Set([...document.querySelectorAll("#menu [data-go]")].map((x) => x.dataset.go))].sort());
      assert.deepEqual(now, [...BEFORE[role].split(" "), ...ADDED[role].split(" ").filter(Boolean)].sort(), `${role}: el menú tiene que tener las mismas pantallas que antes (más las nuevas)`);
      // 2) Cada una abre sin error, por su dirección de siempre (#clave).
      for (const k of now) {
        await p.evaluate((k) => { location.hash = k; document.querySelector(`#menu [data-go="${k}"]`).click(); }, k);
        await p.waitForFunction((k) => location.hash === "#" + k && document.querySelector("#pout")?.children.length > 0, k, { timeout: 15_000 });
        await p.waitForTimeout(250);
        const bad = await p.evaluate(() => /No se pudo cargar/.test(document.querySelector("#pout").textContent));
        assert.equal(bad, false, `${role}: la pantalla ${k} abre sin error`);
      }
      // 3) Buscar pantalla.
      await p.evaluate(() => document.getElementById("app").classList.add("open"));
      await p.fill("#menuFind", "comprobantes");
      assert.deepEqual(await p.evaluate(() => [...document.querySelectorAll("#menu [data-go]")].map((x) => x.dataset.go)), ["aprobacion"], `${role}: «comprobantes» encuentra Aprobar pagos`);
      await p.fill("#menuFind", "codigo");
      const cod = await p.evaluate(() => [...document.querySelectorAll("#menu [data-go]")].map((x) => x.dataset.go));
      assert.equal(cod.includes("codigos"), role === "owner", `${role}: el buscador respeta los permisos (códigos solo el dueño)`);
      await p.fill("#menuFind", "zzzz");
      assert.match(await p.locator("#menu").innerText(), /No encontré esa pantalla/);
      await p.fill("#menuFind", "");
      // 4) Menú a 360 px: botones de 44 px y sin desborde.
      const m = await p.evaluate(() => ({
        small: [...document.querySelectorAll("#menu button, #menu summary, #menuFind")].filter((x) => { const r = x.getBoundingClientRect(); return r.height && r.height < 44; }).length,
        over: document.documentElement.scrollWidth > innerWidth + 1,
      }));
      assert.deepEqual(m, { small: 0, over: false }, `${role}: menú cómodo en el celular`);
      // 5) Barra de abajo: Inicio, Clientes, Vender, Inventario (o Fallas para Atención) y Más; Más abre el menú.
      await p.evaluate(() => { document.getElementById("app").classList.remove("open"); location.hash = "inicio"; document.querySelector('#pbnav [data-go="inicio"]').click(); });
      await p.waitForSelector(".hm-pend, .hm-hero");
      const nav = await p.evaluate(() => [...document.querySelectorAll("#pbnav button")].map((x) => x.querySelector("span").textContent));
      assert.deepEqual(nav, ["Inicio", "Clientes", "Vender", role === "seller" ? "Fallas" : "Inventario", "Más"]);
      await p.click('#pbnav [data-more="1"]');
      assert.equal(await p.evaluate(() => document.getElementById("app").classList.contains("open")), true, "Más abre el menú");
      await p.evaluate(() => document.getElementById("app").classList.remove("open"));
      // 6) Inicio: "Lo que tenés pendiente" muestra lo mismo que Notificaciones.
      const n = await p.evaluate(() => fetch("/api/admin/notifications").then((r) => r.json()));
      const rows = await p.locator(".hm-pend .notirow").count();
      assert.equal(rows, n.items.length, `${role}: Inicio muestra los ${n.items.length} pendientes`);
      if (role === "owner") assert.ok(rows > 0, "con datos de ejemplo hay algo pendiente (cuenta que vence con el proveedor)");
      assert.deepEqual(errs, [], `${role}: sin errores en la página`);
      await ctx.close();
    }
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
