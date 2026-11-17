// ▶ Cobrar uno por uno con link de pago y ↩️ Deshacer «Me pagó todo» (17/11/2026). El dueño pidió que su panel le ahorre
// tiempo: avisar a todos los que vencen en una sola pasada (nada se manda solo) y poder deshacer «Me pagó todo» si se
// equivoca. Datos ficticios. CU_SHOTS=<carpeta> guarda capturas.
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

test("cobrar uno por uno (Tablero) y deshacer «Me pagó todo» (todo o nada)", { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-cobrouno-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 7000, published: true, resellersOnly: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  for (let i = 0; i < 8; i++) s.inventory.addAccount(owner, { productId: "dis", supplierId: "p", email: `c${i}@ficticio.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 300 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  const mk = (name, phone) => s.catalog.createCustomer(owner, { name, phone, kind: "reseller", priceGroupId: "revendedor" });
  const oby = mk("oby · Ovidio Nina", "+59170000001"), ari = mk("ARIt · Aracely Ficticia", "+59170000002"), lejos = mk("Lejos Ficticio", "+59170000003"), sinTel = mk("Sin Teléfono", "+59170000004");
  let k = 0;
  const rent = (c, days) => { const o = s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "r" + k++ }); const id = o.assignmentIds[0]; s.orders.setExpiry(owner, id, Date.now() + days * DAY); s.orders.setControl(owner, id, { price: 6900, payStatus: "pagado" }); return id; };
  const o1 = rent(oby, 1), o2 = rent(oby, 2), o3 = rent(oby, -1), a1 = rent(ari, 3), l1 = rent(lejos, 12), n1 = rent(sinTel, 1);
  void l1; void n1;
  e.s.customers[sinTel.id].phone = ""; // sin WhatsApp cargado: no entra en «uno por uno»
  s.catalog.updateSettings(owner, { renewLink: { enabled: true, access: "renew", hours: 48 } });
  const A = (id) => JSON.stringify(e.s.assignments[id]);
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (m, p, body, ck) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})), r }; };
    const staff = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).r.headers.get("set-cookie").split(";")[0];

    // ---- ↩️ Deshacer «Me pagó todo» ----
    const due = (await call("GET", `/api/admin/resellers/${oby.id}/due`, null, staff)).json;
    const ids = due.rows.filter((x) => !x.blocked).map((x) => x.assignmentId);
    assert.equal(ids.length, 3, JSON.stringify(due.rows));
    const antes = Object.fromEntries(ids.map((id) => [id, A(id)]));
    const pa = await call("POST", `/api/admin/resellers/${oby.id}/paid-all`, { ids, total: due.total, idempotencyKey: "pa1" }, staff);
    assert.equal(pa.status, 200, JSON.stringify(pa.json));
    assert.deepEqual([...pa.json.undoIds].sort(), [...ids].sort());
    assert.ok(ids.every((id) => A(id) !== antes[id]), "se renovaron");
    // Reintento con la misma llave: no cobra de nuevo ni pisa el «Deshacer» del primero.
    const again = await call("POST", `/api/admin/resellers/${oby.id}/paid-all`, { ids, total: due.total, idempotencyKey: "pa1" }, staff);
    assert.equal(again.status, 200); assert.deepEqual(again.json.undoIds, []);
    const lista = (await call("GET", "/api/admin/undo-pay", null, staff)).json;
    assert.equal(lista.filter((u) => ids.includes(u.assignmentId)).length, 3, "en Cobros recientes, de a uno");
    const un = await call("POST", "/api/admin/undo-pay-many", { ids }, staff);
    assert.equal(un.status, 200, JSON.stringify(un.json)); assert.equal(un.json.count, 3);
    for (const id of ids) assert.equal(A(id), antes[id], "vuelve exactamente a como estaba");
    assert.ok(e.s.audit.filter((x) => x.action === "payment.undo").length >= 3);
    assert.notEqual((await call("POST", "/api/admin/undo-pay-many", { ids }, staff)).status, 200, "no se deshace dos veces");
    // Todo o nada: si uno cambió después, no se deshace ninguno.
    const due2 = (await call("GET", `/api/admin/resellers/${oby.id}/due`, null, staff)).json;
    const pa2 = await call("POST", `/api/admin/resellers/${oby.id}/paid-all`, { ids, total: due2.total, idempotencyKey: "pa2" }, staff);
    assert.equal(pa2.status, 200);
    const despues = Object.fromEntries(ids.map((id) => [id, A(id)]));
    s.orders.setExpiry(owner, o2, e.s.assignments[o2].customerExpiresAt + DAY);
    const tras = A(o2);
    const fail = await call("POST", "/api/admin/undo-pay-many", { ids }, staff);
    assert.notEqual(fail.status, 200); assert.match(fail.json.message, /No se deshizo ninguno/);
    assert.equal(A(o1), despues[o1]); assert.equal(A(o3), despues[o3]); assert.equal(A(o2), tras);

    if (chromium) {
      const shots = process.env.CU_SHOTS;
      const b = await chromium.launch();
      try {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1, timezoneId: "America/La_Paz" });
        const [n, v] = staff.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
        await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
        p.on("dialog", (d) => d.accept());
        // ▶ Cobrar uno por uno: Aracely (vence en 3 días) y quien venció; no «Lejos» (12 días) ni quien no tiene WhatsApp.
        s.orders.setExpiry(owner, o1, Date.now() + 1 * DAY); // oby vuelve a tener una por vencer
        await p.goto(base + "/panel.html#tablero"); await p.reload();
        const seq = p.locator("[data-tbseq]");
        await seq.waitFor();
        assert.match(await seq.innerText(), /2 revendedores/);
        assert.ok((await seq.boundingBox()).height >= 44);
        await seq.click();
        await p.locator("#cobSeqBox [data-cobswa]").waitFor();
        assert.match(await p.locator("#cobSeqBox h3").innerText(), /1 de 2/);
        const txt1 = await p.locator("#cobSeqBox pre").innerText();
        assert.match(txt1, /Renová y pagá con QR acá: http:\/\/127\.0\.0\.1:\d+\/tienda\/#renovar=/);
        if (shots) await p.screenshot({ path: `${shots}/uno-por-uno.png` });
        const who1 = /Ovidio/.test(txt1) ? oby : ari;
        const pop = p.waitForEvent("popup").catch(() => null);
        await p.locator("#cobSeqBox [data-cobswa]").click();
        await pop;
        await p.waitForFunction(() => true);
        await new Promise((r) => setTimeout(r, 400));
        const marked = Object.values(e.s.assignments).filter((a) => a.customerId === who1.id && a.control?.noticed);
        assert.ok(marked.length >= 1, "queda como avisado (Ya le avisé)");
        await p.locator("#cobSeqBox [data-cobsnext]").click();
        await p.locator("#cobSeqBox [data-cobswa]").waitFor();
        assert.match(await p.locator("#cobSeqBox h3").innerText(), /2 de 2/);
        assert.doesNotMatch(await p.locator("#cobSeqBox").innerText(), /Lejos|Sin Teléfono/);
        await p.locator("#cobSeqBox [data-cobsnext]").click();
        await p.locator("#cobSeqBox").getByText(/Listo/).waitFor();
        await p.locator("#cobSeqBox [data-cobsclose]").first().click();
        // ↩️ «Me pagó todo» desde el Tablero → barra «Deshacer los N».
        const before = A(a1);
        await p.locator(`[data-rmpaid="${ari.id}"]`).click();
        await p.locator("[data-rmpaidok]").click();
        await p.locator("[data-qundomany]").waitFor();
        assert.notEqual(A(a1), before);
        if (shots) await p.screenshot({ path: `${shots}/deshacer-todo.png` });
        await p.locator("[data-tbavclose]").first().click().catch(() => {});
        await p.locator("[data-qundomany]").click();
        await p.waitForFunction(() => !document.querySelector("[data-qundomany]"));
        assert.equal(A(a1), before, "deshecho desde la pantalla");
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        assert.deepEqual(errs, []);
        await ctx.close();
      } finally { await b.close(); }
    }
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
