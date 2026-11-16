// 🔗 Cobrar con link de pago y 🎁 días de regalo al aprobar (16/11/2026). El dueño: el cobro lleva un link; el cliente
// paga con el QR; al aprobar se renueva solo, y al aprobar puede sumar días de regalo. Nada se manda solo. Datos ficticios.
// CL_SHOTS=<carpeta> guarda capturas.
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

test("cobrar con link de pago (Tablero y Mis hojas) y días de regalo al aprobar", { timeout: 240_000 }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-cobrolink-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const s = app.store, e = s.engine, owner = { id: Object.keys(e.s.staff)[0], role: "owner" };
  s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 7000, published: true, resellersOnly: true });
  s.catalog.upsertSupplier(owner, { id: "p", name: "Prov", active: true });
  for (let i = 0; i < 4; i++) s.inventory.addAccount(owner, { productId: "dis", supplierId: "p", email: `c${i}@ficticio.lat`, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 300 * DAY, cost: 0, profiles: [{ label: "Cuenta completa" }] });
  const oby = s.catalog.createCustomer(owner, { name: "oby · Ovidio Nina", phone: "+59170000001", kind: "reseller", priceGroupId: "revendedor" });
  let k = 0;
  const rent = (days) => { const o = s.orders.create(owner, { customerId: oby.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "r" + k++ }); const id = o.assignmentIds[0]; s.orders.setExpiry(owner, id, Date.now() + days * DAY); s.orders.setControl(owner, id, { price: 6900, payStatus: "pagado" }); return id; };
  const a1 = rent(1), a2 = rent(2), a3 = rent(-1);
  const A = (id) => e.s.assignments[id];
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  try {
    const call = async (m, p, body, ck) => { const r = await fetch(base + p, { method: m, headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => ({})), r }; };
    const staff = (await call("POST", "/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).r.headers.get("set-cookie").split(";")[0];

    // ---- 🎁 Días de regalo al aprobar ----
    const ord = s.orders.renew(owner, a3, { paymentMethod: "qr", idempotencyKey: "qr1" }).order;
    assert.equal(ord.status, "awaiting_payment");
    const antes = A(a3).customerExpiresAt;
    assert.equal((await call("POST", `/api/admin/orders/${ord.id}/approve`, { confirmedReference: "REF-1", bonusDays: 40 }, staff)).status, 400, "hasta 31");
    const ap = await call("POST", `/api/admin/orders/${ord.id}/approve`, { confirmedReference: "REF-1", bonusDays: 3, idempotencyKey: "ap1" }, staff);
    assert.equal(ap.status, 200, JSON.stringify(ap.json));
    assert.equal(ap.json.bonusDays, 3);
    const sinRegalo = Date.UTC(new Date(antes).getUTCFullYear(), new Date(antes).getUTCMonth() + 1, new Date(antes).getUTCDate(), new Date(antes).getUTCHours(), new Date(antes).getUTCMinutes());
    const diff = Math.round((A(a3).customerExpiresAt - antes) / DAY);
    assert.ok(diff >= 28 + 3 && diff <= 31 + 3, `1 mes + 3 días (fueron ${diff})`);
    void sinRegalo;
    assert.ok(A(a3).history.some((h) => /3 días de regalo/.test(h.note ?? "") ) || e.s.audit.some((x) => JSON.stringify(x.data ?? {}).includes("días de regalo")), "queda anotado");

    if (chromium) {
      const shots = process.env.CL_SHOTS;
      const b = await chromium.launch();
      try {
        const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: shots ? 2 : 1, timezoneId: "America/La_Paz" });
        const [n, v] = staff.split("="); await ctx.addCookies([{ name: n, value: v, url: base }]);
        await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
        // Links apagados: el mensaje va sin link y avisa cómo prenderlos.
        await p.goto(base + "/panel.html#tablero");
        await p.locator(`[data-tblink="${oby.id}"]`).click();
        await p.locator("#cobLinkBox").waitFor();
        assert.match(await p.locator("#cobLinkBox").innerText(), /Los links de pago están apagados[\s\S]*Hola Ovidio 👋\nTe paso tus cuentas para renovar:/);
        await p.locator("#cobLinkBox [data-cobclose]").first().click();
        // Prendidos: un link por cuenta, el total y «Abrir WhatsApp» (no se manda solo).
        s.catalog.updateSettings(owner, { renewLink: { enabled: true, access: "renew", hours: 48 } });
        await p.reload();
        await p.locator(`[data-tblink="${oby.id}"]`).click();
        await p.locator("#cobLinkBox [data-cobwa]").waitFor();
        const txt = await p.locator("#cobLinkBox pre").innerText();
        assert.equal((txt.match(/Renová y pagá con QR acá: http:\/\/127\.0\.0\.1:\d+\/tienda\/#renovar=[\w-]+/g) ?? []).length, 2, txt);
        assert.match(txt, /Total: Bs 138/);
        const href = await p.locator("#cobLinkBox [data-cobwa]").getAttribute("href");
        assert.match(decodeURIComponent(href), /^https:\/\/wa\.me\/59170000001\?text=Hola Ovidio/);
        if (shots) await p.screenshot({ path: `${shots}/cobrar-con-link.png` });
        // El link abre la renovación de esa cuenta en la tienda.
        const link = txt.match(/http:\/\/127\.0\.0\.1:\d+\/tienda\/#renovar=([\w-]+)/)[0];
        const pc = await ctx.newPage();
        await pc.goto(link);
        await pc.waitForFunction(() => /Disney/.test(document.body.innerText) && /69/.test(document.body.innerText), null, { timeout: 15_000 });
        await pc.close();
        await p.locator("#cobLinkBox [data-cobclose]").first().click();
        // Mis hojas: el mismo botón en la fila.
        await p.goto(base + "/panel.html#hojas"); await p.reload();
        await p.locator(".hjt tbody tr").first().click();
        await p.locator("#hjsheet [data-hjlink]").click();
        await p.locator("#cobLinkBox pre").waitFor();
        assert.match(await p.locator("#cobLinkBox pre").innerText(), /Te paso tu cuenta para renovar:\n• Disney[\s\S]*Renová y pagá con QR acá: http/);
        await p.locator("#cobLinkBox [data-cobclose]").first().click();
        // Aprobar pagos: el selector «🎁» está junto a «Aprobar».
        s.orders.renew(owner, a1, { paymentMethod: "qr", idempotencyKey: "qr2" });
        await p.goto(base + "/panel.html#aprobacion"); await p.reload();
        await p.locator('[data-tab="aprob:awaiting_payment"]').click();
        await p.locator('form[data-approve] select[name="bonus"]').first().waitFor();
        if (shots) await p.screenshot({ path: `${shots}/aprobar-regalo.png` });
        assert.equal(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
        assert.deepEqual(errs, []);
        await ctx.close();
      } finally { await b.close(); }
    }
    void a2;
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
