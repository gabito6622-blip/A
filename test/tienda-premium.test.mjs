// Premium 2.0 · etapa 5 "Tienda premium" (12/11/2026). Datos ficticios; nunca sale un WhatsApp ni un pago real.
//  1. Un pago rechazado guarda el motivo y el cliente lo ve en su historial (con qué hacer); su revendedor-pagador no.
//  2. La tienda a 360 px: «Mis cuentas» muestra el estado de cada pedido (pasos, rechazado con motivo, entregado) y
//     «Saldo» guía la recarga en 3 pasos; sin desborde, botones de 44 px y letra de 12 px o más.
//  3. Estilo «Premium 2.0» elegible en Apariencia (la paleta de tema.css), con contraste suficiente.
//  4. Dashboard del panel: los textos que daban menos de 4,5:1 («30 días», letras de los servicios) ya se leen.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";
import { THEMES, lookColors } from "../public/common.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");
const DAY = 864e5;
const owner = { id: "u_owner", role: "owner" }, admin = { id: "u_admin", role: "admin" };
const as = (c) => ({ id: "u_" + c.id, role: c.kind === "reseller" ? "reseller" : "customer", customerId: c.id });

describe("etapa 5 · tienda premium (núcleo)", () => {
  test("el rechazo guarda el motivo; el cliente lo ve en sus pedidos; el cliente de un revendedor no ve el del pedido que pagó su revendedor", () => {
    const clock = { t: Date.UTC(2026, 10, 12, 15), now() { return this.t; } };
    const s = createStore({ clock });
    s.catalog.upsertProduct(owner, { id: "nf", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertSupplier(owner, { id: "andes", name: "Andes", active: true });
    s.inventory.addAccount(owner, { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: clock.t + 90 * DAY, cost: 2000, profiles: [1, 2, 3].map((i) => ({ label: `P${i}` })) });
    const ana = s.catalog.createCustomer(owner, { name: "Ana", phone: "+59170000001" });
    const o = s.orders.create(as(ana), { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr" });
    s.orders.submitEvidence(as(ana), o.id, { fileRef: "up/1.jpg", declaredReference: "OP-1", hash: "h1" });
    assert.throws(() => s.orders.rejectPayment(admin, o.id, "   "), (e) => e instanceof DomainError && e.code === "VALIDATION");
    s.orders.rejectPayment(admin, o.id, "  Comprobante borroso: no se lee el monto  ");
    const mine = s.portal.orders(as(ana)).find((x) => x.id === o.id);
    assert.deepEqual([mine.status, mine.rejectReason], ["rejected", "Comprobante borroso: no se lee el monto"]);
    // Cliente de un revendedor: el pedido lo pagó el revendedor → solo estado, sin motivo ni monto.
    const rev = s.catalog.createCustomer(owner, { name: "Rosa Rev", phone: "+59170000002", kind: "reseller" });
    const cli = s.catalog.createCustomer(as(rev), { name: "Cliente de Rosa", phone: "+59170000003" });
    const o2 = s.orders.create(as(rev), { customerId: cli.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr" });
    s.orders.rejectPayment(admin, o2.id, "pago no llegó");
    const seen = s.portal.orders(as(cli)).find((x) => x.id === o2.id);
    assert.deepEqual([seen.status, seen.paidBy, seen.total, seen.rejectReason], ["rejected", "reseller", null, undefined], "el cliente final no ve el motivo del pago de su revendedor");
    assert.equal(s.portal.orders(as(rev)).find((x) => x.id === o2.id).rejectReason, "pago no llegó", "el revendedor (que pagó) sí");
  });

  test("estilo «Premium 2.0» elegible: primero en la lista y con contraste suficiente", () => {
    assert.equal(THEMES[0].id, "premium");
    const c = lookColors(THEMES[0].look);
    assert.ok(c.onRatio >= 4.5 && c.textRatio >= 4.5, `botón ${c.onRatio.toFixed(2)}:1 · texto ${c.textRatio.toFixed(2)}:1`);
    assert.deepEqual([THEMES[0].look.backgroundColor, THEMES[0].look.accent2Color], ["#070b16", "#22d3ee"], "fondo y cian de tema.css");
  });
});

describe("etapa 5 · tienda premium (navegador)", () => {
  let dir, app, base, ownerCk, ana, anaCk;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-tienda5-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    ownerCk = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    await post("/api/admin/products", { id: "nf", name: "Netflix Premium", kind: "profile", durationDays: 30, price: 4000, published: true }, ownerCk);
    await post("/api/admin/products", { id: "dis", name: "Disney+", kind: "profile", durationDays: 30, price: 3500, published: true }, ownerCk);
    await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, ownerCk);
    for (const [pid, email] of [["nf", "nf1@x.lat"], ["dis", "dis1@x.lat"]]) await post("/api/admin/accounts", { productId: pid, supplierId: "andes", email, password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [1, 2, 3, 4, 5].map((i) => ({ label: `Perfil ${i}` })) }, ownerCk);
    await post("/api/admin/settings", { storeName: "Gabriel Store", whatsapp: "59170000000", paymentNote: "Banco Demo" }, ownerCk);
    await post("/api/admin/settings/qr", { contentBase64: PNG }, ownerCk);
    ana = await (await post("/api/admin/customers", { name: "Ana Prueba", phone: "+59170011223" }, ownerCk)).json();
    await post(`/api/admin/customers/${ana.id}/login-pin`, { pin: "2468" }, ownerCk);
    anaCk = (await post("/api/auth/customer/pin", { phone: ana.phone, pin: "2468" })).headers.get("set-cookie").split(";")[0];
    // Cuatro pedidos, uno por estado: esperando pago (QR sin comprobante), en revisión, rechazado con motivo, entregado.
    await post("/api/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr", idempotencyKey: "k1" }, anaCk);
    const o2 = await (await post("/api/orders", { customerId: ana.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "qr", idempotencyKey: "k2" }, anaCk)).json();
    await post(`/api/orders/${o2.id}/evidence`, { contentBase64: PNG, declaredReference: "OP-2" }, anaCk);
    const o3 = await (await post("/api/orders", { customerId: ana.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "qr", idempotencyKey: "k3" }, anaCk)).json();
    await post(`/api/orders/${o3.id}/evidence`, { contentBase64: Buffer.from("89504e470d0a1a0a0000000d49484452000000020000000208060000ff", "hex").toString("base64"), declaredReference: "OP-3" }, anaCk);
    await post(`/api/admin/orders/${o3.id}/reject`, { reason: "Comprobante borroso: no se lee el monto" }, ownerCk);
    await post("/api/admin/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }, ownerCk);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("Mis cuentas y Saldo a 360 px: estados claros, recarga en 3 pasos, sin desborde, 44 px y letra ≥ 12 px", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
      await ctx.route(/wa\.me|whatsapp\.com|fonts\.(googleapis|gstatic)/, (r) => r.abort());
      const [n, v] = anaCk.split("=");
      await ctx.addCookies([{ name: n, value: v, url: base }]);
      const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
      const measure = () => p.evaluate(() => {
        const vis = (x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(x).visibility !== "hidden"; };
        return {
          over: document.documentElement.scrollWidth > innerWidth + 1,
          small: [...document.querySelectorAll("#sout button, #sout a.sbtn, .bnav button, #sout input[type=submit]")].filter((x) => vis(x) && x.getBoundingClientRect().height < 44).map((x) => (x.textContent || "?").trim().slice(0, 30)),
          tiny: [...document.querySelectorAll("#sout *")].filter((x) => vis(x) && !x.closest(".pt, .tkgrid, .skeleton") && [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 12).map((x) => x.textContent.trim().slice(0, 30)),
          text: document.querySelector("#sout").innerText.replace(/\s+/g, " "),
        };
      });
      await p.goto(base + "/tienda/#cuentas");
      await p.waitForFunction(() => /Historial de pedidos/.test(document.body.innerText));
      let m = await measure();
      for (const t of ["Esperando pago", "Revisando pago", "Estamos verificando tu pago", "Rechazado", "Motivo: Comprobante borroso", "hacé el pedido de nuevo", "Entregado"]) assert.ok(m.text.includes(t), `Mis cuentas tiene que decir «${t}»`);
      assert.equal(m.over, false, "Mis cuentas sin desborde"); assert.deepEqual(m.small, [], "botones de 44 px"); assert.deepEqual(m.tiny, [], "letra ≥ 12 px");
      await p.goto("about:blank"); await p.goto(base + "/tienda/#recargas"); // en celular «Saldo» está en el menú Más: se entra por el enlace
      await p.waitForFunction(() => /Solicitar recarga/.test(document.body.innerText));
      m = await measure();
      for (const t of ["1 · ELEGÍ CUÁNTO", "2 · PAGÁ", "3 · SUBÍ EL COMPROBANTE"]) assert.ok(m.text.toUpperCase().includes(t), `Saldo tiene que guiar: «${t}»`);
      assert.equal(m.over, false, "Saldo sin desborde"); assert.deepEqual(m.small, [], "Saldo: botones de 44 px"); assert.deepEqual(m.tiny, [], "Saldo: letra ≥ 12 px");
      assert.deepEqual(errs, []);
      await ctx.close();
    } finally { await b.close(); }
  });

  test("Dashboard del panel: «30 días» y las letras de los servicios se leen (≥ 4,5:1), en claro y en oscuro", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      const [n, v] = ownerCk.split("=");
      for (const theme of ["light", "dark"]) {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
        await ctx.addCookies([{ name: n, value: v, url: base }]);
        await ctx.addInitScript((th) => { try { localStorage.setItem("gs-panel-theme", th); } catch { /* */ } }, theme);
        const p = await ctx.newPage();
        await p.goto(base + "/panel.html#dashboard");
        await p.waitForSelector(".svcic", { timeout: 20_000 });
        const low = await p.evaluate(() => {
          const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g); const [r, g, b] = m.slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
          const bgOf = (x) => { let e = x; while (e) { const c = getComputedStyle(e).backgroundColor; if (c && !/rgba\(0, 0, 0, 0\)/.test(c) && c !== "transparent") return c; e = e.parentElement; } return getComputedStyle(document.body).backgroundColor; };
          // Los iconos de servicio tienen fondo degradado pastel (--c mezclado con blanco al 45 % y al 28 %): se mide
          // contra la punta MÁS OSCURA (45 % de color), que es la peor para un texto oscuro.
          const pastel = (x) => { const hex = getComputedStyle(x).getPropertyValue("--c").trim(); const m = /^#([0-9a-f]{6})$/i.exec(hex); if (!m) return null; const n = parseInt(m[1], 16); const ch = (s) => Math.round(((n >> s) & 255) * 0.45 + 255 * 0.55); return `rgb(${ch(16)}, ${ch(8)}, ${ch(0)})`; };
          return [...document.querySelectorAll(".seg button, .svcic")].map((x) => {
            const bg = x.classList.contains("svcic") ? pastel(x) ?? bgOf(x) : bgOf(x);
            return [x.textContent.trim(), Number(ratio(getComputedStyle(x).color, bg).toFixed(2))];
          }).filter(([, r]) => r < 4.5);
        });
        assert.deepEqual(low, [], `${theme}: textos con poco contraste`);
        await ctx.close();
      }
    } finally { await b.close(); }
  });
});
