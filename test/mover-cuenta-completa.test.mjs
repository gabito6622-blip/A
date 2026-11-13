// «↔️ Mover todos a otra cuenta» (13/11/2026): un Netflix se cae y el dueño pasa a TODOS sus clientes a otra cuenta
// elegida, de una vez. Cada cliente conserva su fecha; si el perfil nuevo se llama igual (Perfil 1 → Perfil 1) se respeta;
// los perfiles viejos quedan apartados; queda la nota «↔️ …» en cada Control. Todo o nada. Datos ficticios.
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

test("mover todos los clientes de un Netflix caído a otra cuenta: mismas fechas, mismos nombres de perfil, todo o nada; en el celular", { timeout: 120_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-moveall-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  let b;
  try {
    const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
    const A = async (m, p, body) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
    const J = async (m, p, body) => (await A(m, p, body)).json;
    await J("POST", "/api/admin/products", { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true });
    await J("POST", "/api/admin/products", { id: "dis", name: "Disney+", kind: "full_account", durationDays: 30, price: 6900, published: true });
    const prof5 = [1, 2, 3, 4, 5].map((i) => ({ label: `Perfil ${i}`, pin: `${i}${i}${i}${i}` }));
    const add = async (productId, email, profiles) => { await J("POST", "/api/admin/accounts", { productId, email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 60 * DAY, cost: 2000, profiles }); return (await J("GET", "/api/admin/accounts")).find((a) => a.email === email); };
    const caida = await add("nf", "nf-caida@ejemplo.lat", prof5);
    const nueva = await add("nf", "nf-nueva@ejemplo.lat", prof5);
    const chica = await add("nf", "nf-chica@ejemplo.lat", prof5.slice(0, 2));
    const disney = await add("dis", "dis@ejemplo.lat", [{ label: "Cuenta completa" }]);
    // Tres clientes en la caída: Perfil 1, 3 y 5, con fechas distintas y una nota.
    const slot = (acc, label) => acc.slots.find((s) => s.label === label).id;
    const clientes = [];
    for (const [i, [name, label, dias]] of [["Ana Ficticia", "Perfil 1", 10], ["Beto Ficticio", "Perfil 3", 20], ["Caro Ficticia", "Perfil 5", 25]].entries()) {
      const c = await J("POST", "/api/admin/customers", { name, phone: `+5916000000${i + 1}` });
      const o = await J("POST", "/api/admin/orders", { customerId: c.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slot(caida, label)] });
      await J("POST", `/api/admin/assignments/${o.assignmentIds[0]}/expiry`, { expiresAt: Date.now() + dias * DAY, note: "ajuste" });
      clientes.push({ id: c.id, name, label, aid: o.assignmentIds[0] });
    }
    await J("POST", `/api/admin/assignments/${clientes[1].aid}/control`, { note: "paga por QR" });
    // En la nueva, el Perfil 3 ya está ocupado por otro cliente: Beto tiene que caer en otro perfil, los demás en el suyo.
    const otro = await J("POST", "/api/admin/customers", { name: "Otro Cliente", phone: "+59160000009" });
    await J("POST", "/api/admin/orders", { customerId: otro.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slot(nueva, "Perfil 3")] });
    // Y el Perfil 4 de la nueva está apartado: también sirve.
    assert.equal((await A("POST", `/api/admin/slots/${slot(nueva, "Perfil 4")}/status`, { status: "quarantined", note: "revisar" })).status, 200);
    const before = Object.fromEntries((await J("GET", "/api/admin/assignments")).map((x) => [x.id, x]));

    // Errores: misma cuenta, otra plataforma, perfiles insuficientes (todo o nada: nadie se mueve).
    let r = await A("POST", `/api/admin/accounts/${caida.id}/move-all`, { toAccountId: caida.id, reason: "x" });
    assert.equal(r.status, 400); assert.match(r.json.message, /la misma/);
    r = await A("POST", `/api/admin/accounts/${caida.id}/move-all`, { toAccountId: disney.id, reason: "x" });
    assert.equal(r.status, 400); assert.match(r.json.message, /otra plataforma/);
    r = await A("POST", `/api/admin/accounts/${caida.id}/move-all`, { toAccountId: chica.id, reason: "x" });
    assert.equal(r.status, 409, JSON.stringify(r.json)); assert.match(r.json.message, /2 perfil\(es\) libre\(s\) y hay que mover 3/);
    const mid = (await J("GET", "/api/admin/assignments")).filter((x) => x.email === "nf-caida@ejemplo.lat");
    assert.equal(mid.length, 3, "con el error no se movió nadie");

    // El cambio real.
    r = await A("POST", `/api/admin/accounts/${caida.id}/move-all`, { toAccountId: nueva.id, reason: "Netflix caído" });
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.deepEqual([r.json.from, r.json.to, r.json.moved.length], ["nf-caida@ejemplo.lat", "nf-nueva@ejemplo.lat", 3]);
    const after = Object.fromEntries((await J("GET", "/api/admin/assignments")).map((x) => [x.id, x]));
    for (const c of clientes) {
      const a = after[c.aid];
      assert.equal(a.email, "nf-nueva@ejemplo.lat", c.name);
      assert.equal(a.customerExpiresAt, before[c.aid].customerExpiresAt, `${c.name} conserva su fecha`);
      assert.match(a.control.note, /^↔️ \d{2}\/\d{2}\/\d{4}: de nf-caida@ejemplo\.lat a nf-nueva@ejemplo\.lat/);
    }
    assert.equal(after[clientes[0].aid].profile, "Perfil 1", "mismo nombre de perfil cuando está libre");
    assert.equal(after[clientes[2].aid].profile, "Perfil 5");
    assert.notEqual(after[clientes[1].aid].profile, "Perfil 3", "el Perfil 3 estaba ocupado: Beto va a otro");
    assert.match(after[clientes[1].aid].control.note, /· paga por QR$/, "la nota anterior se conserva");
    const accs = await J("GET", "/api/admin/accounts");
    const st = (email) => Object.fromEntries(accs.find((a) => a.email === email).slots.map((s) => [s.label, s.status]));
    assert.deepEqual([st("nf-caida@ejemplo.lat")["Perfil 1"], st("nf-caida@ejemplo.lat")["Perfil 3"], st("nf-caida@ejemplo.lat")["Perfil 5"]], ["quarantined", "quarantined", "quarantined"], "los viejos quedan apartados");
    assert.equal(Object.values(st("nf-nueva@ejemplo.lat")).filter((s) => s === "assigned").length, 4, "3 movidos + el que ya estaba");
    const dlv = await J("GET", `/api/admin/assignments/${clientes[0].aid}/delivery`);
    assert.match(dlv.message, /nf-nueva@ejemplo\.lat/); assert.match(dlv.message, /1111/, "PIN del perfil nuevo");

    // Celular: desde la tarjeta de la cuenta, «Mover todos a otra cuenta» con la lista de destinos que alcanzan.
    if (!chromium) return;
    const c2 = await add("nf", "nf-caida2@ejemplo.lat", prof5), c3 = await add("nf", "nf-destino@ejemplo.lat", prof5);
    const dani = await J("POST", "/api/admin/customers", { name: "Dani Ficticio", phone: "+59160000011" });
    const o2 = await J("POST", "/api/admin/orders", { customerId: dani.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash", preferredSlotIds: [slot(c2, "Perfil 2")] });
    b = await chromium.launch();
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
    const [n, v] = ck.split("=");
    await ctx.addCookies([{ name: n, value: v, url: base }]);
    await ctx.addInitScript(() => { try { localStorage.setItem("gs-acc-view", "clasica"); } catch { /* sin almacenamiento */ } }); // vista clásica: las tarjetas a la vista
    const page = await ctx.newPage(); const errs = []; page.on("pageerror", (e) => errs.push(e.message)); page.on("dialog", (d) => d.accept());
    await page.goto(base + "/panel.html#cuentas");
    // La tarjeta cuyo encabezado es esa cuenta (otras tarjetas la nombran adentro, en la lista de destinos).
    const card = page.locator("article", { hasText: /^[\s\S]{0,80}nf-caida2@ejemplo\.lat/ }).first();
    await card.waitFor({ timeout: 20_000 });
    await card.locator("summary", { hasText: "Mover todos a otra cuenta (1)" }).click();
    const sel = card.locator('form[data-moveall] select[name="to"]');
    const texts = await sel.locator("option").allInnerTexts();
    assert.ok(texts.some((t) => t.startsWith("nf-destino@ejemplo.lat")), `ofrece la de destino: ${texts}`);
    assert.ok(!texts.some((t) => t.includes("dis@")), "no ofrece Disney");
    await sel.selectOption({ label: texts.find((t) => t.startsWith("nf-destino@ejemplo.lat")) });
    await card.locator('form[data-moveall] button[type="submit"]').click();
    await page.waitForFunction(() => location.hash === "#control", null, { timeout: 15_000 });
    await page.locator("article", { hasText: "Dani Ficticio" }).first().waitFor({ timeout: 15_000 });
    const fin = (await J("GET", "/api/admin/assignments")).find((x) => x.id === o2.assignmentIds[0]);
    assert.deepEqual([fin.email, fin.profile], ["nf-destino@ejemplo.lat", "Perfil 2"]);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= 360), "sin desborde");
    assert.deepEqual(errs, []);
  } finally {
    await b?.close(); await app.close(); rmSync(dir, { recursive: true, force: true });
  }
});
