// 🧭 Ver antes de confirmar (etapa 5): lo que el panel muestra ANTES (nueva fecha al renovar, perfil que toca en
// "Automático", perfiles libres para reemplazar) tiene que ser exactamente lo que el servidor hace DESPUÉS.
// Datos ficticios; navegador (se salta sin Playwright).
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

test("lo que se ve antes es lo que pasa después: renovar, automático al vender, reemplazar y el freno del proveedor", { skip: !chromium, timeout: 180_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-guiado-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const b = await chromium.launch();
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const A = (m, p, body) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: body ? JSON.stringify(body) : undefined }).then((r) => r.json());
    await A("POST", "/api/admin/products", { id: "disney", name: "Disney+", kind: "profile", durationDays: 30, price: 3500, published: true });
    await A("POST", "/api/admin/products", { id: "max", name: "Max", kind: "profile", durationDays: 30, price: 2500, published: true });
    await A("POST", "/api/admin/suppliers", { id: "andes", name: "Andes", active: true });
    // Dos cuentas de Disney: la que vence antes con el proveedor es la que el servidor usa primero.
    await A("POST", "/api/admin/accounts", { productId: "disney", supplierId: "andes", email: "dis.tarde@ejemplo.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 120 * DAY, cost: 2000, profiles: [{ label: "Perfil A" }, { label: "Perfil B" }] });
    await A("POST", "/api/admin/accounts", { productId: "disney", supplierId: "andes", email: "dis.pronto@ejemplo.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 70 * DAY, cost: 2000, profiles: [{ label: "Perfil 1" }, { label: "Perfil 2" }] });
    // Una cuenta de Max que vence en 20 días: renovar +30 días se pasaría del proveedor.
    await A("POST", "/api/admin/accounts", { productId: "max", supplierId: "andes", email: "max@ejemplo.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 20 * DAY, cost: 1500, profiles: [{ label: "Perfil 1" }] });
    const ana = await A("POST", "/api/admin/customers", { name: "Ana Quispe", phone: "+59170011223" });

    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    const dialogs = []; p.on("dialog", (d) => { dialogs.push(d.message()); d.accept(); });
    await p.goto(base + "/panel.html#vender");
    await p.fill("input[name=username]", "gabriel"); await p.fill("input[name=password]", "clave-del-dueño-123"); await p.press("input[name=password]", "Enter");

    // 1) Vender, "Automático": el panel dice qué perfil le toca…
    await p.waitForSelector('[data-pick="disney"]');
    await p.click('[data-pick="disney"]');
    await p.waitForSelector('#profPick .ppchip[data-slot=""]');
    const auto = await p.locator('#profPick .ppchip[data-slot=""]').innerText();
    assert.match(auto, /le toca Perfil 1 de dis\.pronto@ejemplo\.lat/);
    // …y el servidor entrega justo ese (venta automática, sin elegir perfil).
    await A("POST", "/api/admin/orders", { customerId: ana.id, items: [{ productId: "disney", qty: 1 }], paymentMethod: "cash" });
    await A("POST", "/api/admin/orders", { customerId: ana.id, items: [{ productId: "max", qty: 1 }], paymentMethod: "cash" });
    const svcs = await A("GET", `/api/admin/assignments?customerId=${ana.id}`);
    const dis = svcs.find((x) => x.productId === "disney"), max = svcs.find((x) => x.productId === "max");
    assert.deepEqual([dis.email, dis.profile], ["dis.pronto@ejemplo.lat", "Perfil 1"], "el automático del panel = el del servidor");

    // 2) Ficha: "Si renovás: vence el …" y después el servidor pone esa misma fecha.
    await p.evaluate(() => { location.hash = "clientes"; document.querySelector('#menu [data-go="clientes"]').click(); });
    await p.waitForSelector("details.rcli");
    await p.click(`details.rcli[data-cid="${ana.id}"] > summary`);
    await p.waitForSelector(`[data-fxslot="${ana.id}"] .fx-svc`);
    const fx = `[data-fxslot="${ana.id}"]`;
    const cards = p.locator(`${fx} .fx-svc`);
    const disCard = cards.filter({ hasText: "Disney+" }), maxCard = cards.filter({ hasText: "Max" });
    const said = (await disCard.locator(".fx-prev").innerText()).match(/vence el (\d\d\/\d\d\/\d{4})/)[1];
    assert.match(await maxCard.locator(".fx-prev").innerText(), /⚠️ \+30 días se pasaría de la fecha del proveedor/, "avisa el freno del proveedor antes de tocar");
    // Reemplazar: cuántos libres hay (3 de Disney: A, B y Perfil 2).
    await disCard.locator(".fx-more summary").click();
    assert.match(await disCard.locator(".fx-hint").innerText(), /Hay 3 perfiles libres de Disney\+/);
    await maxCard.locator(".fx-more summary").click();
    assert.match(await maxCard.locator(".fx-hint").innerText(), /No hay perfiles libres de Max/);
    await disCard.locator(`[data-renew="${dis.id}"]`).click();
    await p.waitForFunction(async ([cid, prev]) => {
      const r = await fetch(`/api/admin/assignments?customerId=${cid}`).then((x) => x.json()); return r.find((x) => x.productId === "disney").customerExpiresAt > prev;
    }, [ana.id, dis.customerExpiresAt], { timeout: 15_000 });
    const now = (await A("GET", `/api/admin/assignments?customerId=${ana.id}`)).find((x) => x.productId === "disney");
    const real = new Date(now.customerExpiresAt).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
    assert.equal(said, real, "la fecha que mostró antes es la que quedó");
    assert.match(dialogs.at(-1), /¿Renovar Disney\+ de Ana Quispe[\s\S]*→/, "pide confirmar con la fecha nueva");

    // 3) Max: el panel avisó; decisión (b) del 14/11: si el dueño confirma, se anota igual y la cuenta queda en «Proveedores por renovar».
    await p.click(`${fx} [data-renew="${max.id}"]`).catch(() => {});
    await p.waitForTimeout(1500);
    assert.match(dialogs.at(-1), /pasa la del proveedor[\s\S]*Proveedores por renovar/);
    assert.equal((await A("GET", `/api/admin/assignments?customerId=${ana.id}`)).find((x) => x.productId === "max").customerExpiresAt, max.customerExpiresAt + 30 * 864e5);
    assert.equal((await A("GET", "/api/admin/secretaria")).counts.proveedores, 1);

    // 4) Pantalla Renovar: cada "+1 período" muestra su nueva fecha o el aviso.
    await p.evaluate(() => { location.hash = "renovar"; document.querySelector('#menu [data-go="renovar"]').click(); });
    await p.waitForSelector("[data-renewsel]");
    const txt = await p.locator("#pout").innerText();
    // Max (vence en 20 días) y Disney ya renovado (11/01 → +30 se pasaría del 21/01 del proveedor): los dos avisan.
    assert.equal((txt.match(/se pasa del proveedor/g) ?? []).length, 2);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
