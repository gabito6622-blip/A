// 🧹 Cuentas caídas sin clientes (pedido del dueño, 12/11/2026): en Cuentas se listan las vencidas que no tienen a
// nadie adentro y el DUEÑO las retira con un toque (misma acción que "Cuenta caída" de cada cuenta). Nunca aparece
// una cuenta con clientes ni una que no venció, y solo se retiran las que quedan marcadas. Datos ficticios.
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

test("cuentas caídas sin clientes: se listan solo esas y se retiran solo las marcadas", { skip: !chromium, timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-caidas-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const A = (m, p, body) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    await A("POST", "/api/admin/products", { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true });
    const add = async (email) => (await A("POST", "/api/admin/accounts", { productId: "dis", email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] })).account.id;
    const caida = await add("caida@ejemplo.lat"), conCliente = await add("concliente@ejemplo.lat"), viva = await add("viva@ejemplo.lat");
    const otra1 = await add("otra1@ejemplo.lat"), otra2 = await add("otra2@ejemplo.lat");
    // 10 más, para que la lista pase su alto máximo (como en la tienda real, con 16).
    const extras = []; for (let i = 1; i <= 10; i++) extras.push(await add(`extra${String(i).padStart(2, "0")}@ejemplo.lat`));
    // Un cliente en "conCliente": se le vende esa cuenta a mano.
    const ana = await A("POST", "/api/admin/customers", { name: "Ana", phone: "+59170011223" });
    const accs0 = await A("GET", "/api/admin/accounts");
    const slotCon = accs0.find((a) => a.id === conCliente).slots[0].id;
    await A("POST", "/api/admin/orders", { customerId: ana.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slotCon] });
    // Vencen con el proveedor: caida, conCliente, otra1 y otra2 (viva sigue al día).
    for (const id of [caida, conCliente, otra1, otra2, ...extras]) await A("POST", `/api/admin/accounts/${id}`, { supplierExpiresAt: Date.now() - 5 * DAY });
    const svc0 = await A("GET", "/api/admin/assignments");

    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    const dialogs = []; p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await p.goto(base + "/panel.html#cuentas");
    await p.fill("input[name=username]", "gabriel"); await p.fill("input[name=password]", "clave-del-dueño-123"); await p.press("input[name=password]", "Enter");
    await p.waitForSelector(".caidas");
    const rows = await p.locator(".caida-row b").allInnerTexts();
    assert.deepEqual(rows.sort(), ["caida@ejemplo.lat", ...Array.from({ length: 10 }, (_, i) => `extra${String(i + 1).padStart(2, "0")}@ejemplo.lat`), "otra1@ejemplo.lat", "otra2@ejemplo.lat"], "solo vencidas y sin clientes");
    const m = await p.evaluate(() => ({
      over: document.documentElement.scrollWidth > innerWidth + 1,
      small: [...document.querySelectorAll(".caidas button, .caida-row")].filter((x) => x.getBoundingClientRect().height < 44).length,
      // Con un nombre de producto largo, el texto de cada renglón entra en su renglón (no se pisa con el de abajo).
      pisado: [...document.querySelectorAll(".caida-row")].filter((r) => { const t = r.querySelector("span").getBoundingClientRect(), b = r.getBoundingClientRect(); return t.bottom > b.bottom + 1; }).length,
    }));
    assert.deepEqual(m, { over: false, small: 0, pisado: 0 });
    // Destilda otra2 y retira las otras dos.
    await p.uncheck(`.caida-sel[value="${otra2}"]`);
    await p.click('[data-caidas="1"]');
    await p.waitForFunction(() => document.querySelectorAll(".caida-row").length === 1, null, { timeout: 15_000 });
    assert.match(dialogs.at(-1), /¿Retirar 12 cuentas caídas\?/);
    const accs = await A("GET", "/api/admin/accounts");
    const st = (id) => accs.find((a) => a.id === id)?.status;
    assert.deepEqual([st(caida), st(otra1), st(otra2), st(conCliente), st(viva)], ["retired", "retired", "active", "active", "active"]);
    assert.ok(extras.every((id) => st(id) === "retired"));
    const svc1 = await A("GET", "/api/admin/assignments");
    assert.deepEqual(svc1.map((x) => [x.id, x.slotId, x.customerExpiresAt]), svc0.map((x) => [x.id, x.slotId, x.customerExpiresAt]), "ningún cliente cambia");
    assert.deepEqual(await p.locator(".caida-row b").allInnerTexts(), ["otra2@ejemplo.lat"], "queda la que se destildó");
    // "Funcionan: dejarlas como propias": otra2 queda sin vencimiento, en Propias, y vuelve a estar a la venta.
    const stock0 = (await A("GET", "/api/admin/stock")).dis?.available ?? 0;
    await p.click('[data-caidaspropias="1"]');
    await p.waitForFunction(() => !document.querySelector(".caidas"), null, { timeout: 15_000 });
    assert.match(dialogs.at(-1), /¿Dejar 1 cuenta como propias \(autopay, sin vencimiento\)\?/);
    const o2 = (await A("GET", "/api/admin/accounts")).find((a) => a.id === otra2);
    assert.deepEqual([o2.status, o2.supplierId, o2.supplierExpiresAt > Date.now() + 30000 * DAY], ["active", "propias", true]);
    assert.equal((await A("GET", "/api/admin/stock")).dis?.available ?? 0, stock0 + 1, "su perfil libre vuelve a la venta");
    assert.deepEqual((await A("GET", "/api/admin/assignments")).map((x) => [x.id, x.slotId, x.customerExpiresAt]), svc0.map((x) => [x.id, x.slotId, x.customerExpiresAt]), "ningún cliente cambia");
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
