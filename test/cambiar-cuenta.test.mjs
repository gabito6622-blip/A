// «↔️ Cambiar de cuenta» (13/11/2026): el dueño pasa un cliente a UNA cuenta elegida (no a cualquiera libre), con la misma
// fecha de vencimiento. Vale un perfil libre o apartado de una cuenta activa de la misma plataforma. Queda anotado en la
// nota del Control (de qué correo a cuál y cuándo), que lee Mi secretaria. Datos ficticios en carpeta temporal.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;

test("cambiar de cuenta: misma fecha, perfil elegido (libre o apartado), nota para la secretaria; errores claros; en el celular", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-swap-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  let b;
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const A = async (m, p, body) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const J = async (m, p, body) => (await A(m, p, body)).json;
    await J("POST", "/api/admin/products", { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true });
    await J("POST", "/api/admin/products", { id: "nf", name: "Netflix completa (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 12000, published: true });
    const add = async (productId, email) => (await J("POST", "/api/admin/accounts", { productId, email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] })).account ?? (await J("GET", "/api/admin/accounts")).find((a) => a.email === email);
    const vieja = await add("dis", "vieja+rclad@ejemplo.lat"), nueva = await add("dis", "nueva+md1@ejemplo.lat"), otraNf = await add("nf", "otra@ejemplo.lat"), ocupada = await add("dis", "ocupada@ejemplo.lat");
    const accs = await J("GET", "/api/admin/accounts");
    const slotOf = (id) => accs.find((a) => a.id === id).slots[0].id;
    // La nueva está «apartada» (como una cuenta recién renovada que todavía no se revende).
    assert.equal((await A("POST", `/api/admin/slots/${slotOf(nueva.id)}/status`, { status: "quarantined", note: "renovada, por revisar" })).status, 200);
    const dani = await J("POST", "/api/admin/customers", { name: "Dani Ficticio", phone: "+59160000001", kind: "reseller" });
    const otro = await J("POST", "/api/admin/customers", { name: "Otro Cliente", phone: "+59160000002" });
    const accsV = await J("GET", "/api/admin/accounts");
    const o1 = await J("POST", "/api/admin/orders", { customerId: dani.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slotOf(vieja.id)] });
    await J("POST", "/api/admin/orders", { customerId: otro.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slotOf(ocupada.id)] });
    const aid = o1.assignmentIds[0];
    void accsV;
    const vence = Date.UTC(2026, 11, 12, 16); // 12/12/2026 (Bolivia)
    assert.equal((await A("POST", `/api/admin/assignments/${aid}/expiry`, { expiresAt: vence, note: "ya había renovado" })).status, 200);
    assert.equal((await A("POST", `/api/admin/assignments/${aid}/control`, { note: "paga puntual" })).status, 200);
    let before = (await J("GET", "/api/admin/assignments")).find((x) => x.id === aid);
    assert.equal(before.email, "vieja+rclad@ejemplo.lat");

    // Errores claros.
    let r = await A("POST", `/api/admin/assignments/${aid}/replace`, { toSlotId: slotOf(otraNf.id), reason: "x" });
    assert.equal(r.status, 400); assert.match(r.json.message, /otra plataforma/);
    r = await A("POST", `/api/admin/assignments/${aid}/replace`, { toSlotId: slotOf(ocupada.id), reason: "x" });
    assert.equal(r.status, 409); assert.match(r.json.message, /no está libre/);
    r = await A("POST", `/api/admin/assignments/${aid}/replace`, { toSlotId: slotOf(vieja.id), reason: "x" });
    assert.equal(r.status, 400); assert.match(r.json.message, /ya tiene/);

    // El cambio de verdad: a la cuenta elegida (apartada), misma fecha, nota para la secretaria.
    r = await A("POST", `/api/admin/assignments/${aid}/replace`, { toSlotId: slotOf(nueva.id), reason: "Cuenta renovada", oldSlot: "quarantined" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const after = (await J("GET", "/api/admin/assignments")).find((x) => x.id === aid);
    assert.equal(after.email, "nueva+md1@ejemplo.lat");
    assert.equal(after.customerExpiresAt, before.customerExpiresAt, "la fecha del cliente no cambia");
    assert.match(after.control.note, /^↔️ \d{2}\/\d{2}\/\d{4}: de vieja\+rclad@ejemplo\.lat a nueva\+md1@ejemplo\.lat · paga puntual$/);
    const accs2 = await J("GET", "/api/admin/accounts");
    assert.equal(accs2.find((a) => a.id === nueva.id).slots[0].status, "assigned");
    assert.equal(accs2.find((a) => a.id === vieja.id).slots[0].status, "quarantined", "la vieja queda apartada, no se revende sin revisar");
    const dlv = await J("GET", `/api/admin/assignments/${aid}/delivery`);
    assert.match(dlv.message, /nueva\+md1@ejemplo\.lat/); assert.match(dlv.message, /12\/12\/2026/);
    assert.ok(!dlv.message.includes("vieja+rclad"));

    // Desde el celular: la tarjeta del Control tiene «↔️ Cambiar de cuenta» y mueve con la cuenta elegida.
    if (!chromium) return;
    const libre2 = await add("dis", "libre2@ejemplo.lat");
    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    const [n, v] = ck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message));
    await page.goto(base + "/panel.html#control");
    const card = page.locator("article", { hasText: "Dani Ficticio" }).first();
    await card.waitFor({ timeout: 20_000 });
    await card.locator("summary", { hasText: "Cambiar de cuenta" }).click();
    const sel = card.locator('form[data-swapacc] select[name="to"]');
    const texts = await sel.locator("option").allInnerTexts();
    assert.ok(texts.some((t) => t.startsWith("libre2@ejemplo.lat")), `lista la libre: ${texts}`);
    assert.ok(!texts.some((t) => t.includes("nueva+md1")), "la que ya tiene no se ofrece");
    assert.ok(!texts.some((t) => t.includes("ocupada@")), "las ocupadas no se ofrecen");
    await sel.selectOption({ label: texts.find((t) => t.startsWith("libre2@ejemplo.lat")) });
    await card.locator('form[data-swapacc] button[type="submit"]').click();
    await page.waitForFunction((id) => !!document.body.innerText.includes("libre2@ejemplo.lat") && !document.querySelector(`form[data-swapacc="${id}"] select`)?.value, aid, { timeout: 15_000 }).catch(() => {});
    const final = (await J("GET", "/api/admin/assignments")).find((x) => x.id === aid);
    assert.equal(final.email, "libre2@ejemplo.lat");
    assert.equal(final.customerExpiresAt, before.customerExpiresAt);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), "sin desborde");
    assert.deepEqual(errs, []);
  } finally {
    await b?.close(); await app.close(); rmSync(dir, { recursive: true, force: true });
  }
});
