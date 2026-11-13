// Premium 2.0 · etapa 7 "Mi Oficina 2.0" (13/11/2026). Propuesta 1 (nocturna) + línea de tiempo. Datos ficticios.
//  1. La API suma «Para hoy» (los conteos de Mi secretaria) y lo que hizo el dueño (aprobar, vender) a la línea de tiempo,
//     sin apellidos, montos de costo ni datos de cuentas. Los 6 asistentes siguen siendo 6.
//  2. En el navegador a 360 px: 6 escritorios con anillo y monitor, la línea de tiempo, sin desborde, botones de 44 px,
//     letra ≥ 12 px y globitos que se leen (≥ 4,5:1), en tema claro y oscuro.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const DAY = 864e5;
const PNG = Buffer.from("89504e470d0a1a0a0000000d4948445200000001000000010806000000", "hex").toString("base64");

describe("etapa 7 · oficina 2.0", () => {
  let dir, app, base, owner;
  const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
  const get = async (p, ck) => (await fetch(base + p, { headers: ck ? { cookie: ck } : {} })).json();
  before(async () => {
    dir = mkdtempSync(join(tmpdir(), "gs-of2-"));
    app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    owner = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
    await post("/api/admin/products", { id: "nf", name: "Netflix Premium", kind: "profile", durationDays: 30, price: 4000, published: true }, owner);
    await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, owner);
    await post("/api/admin/accounts", { productId: "nf", supplierId: "andes", email: "nf1@x.lat", password: "Clave-Secreta#99", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2000, profiles: [1, 2, 3].map((i) => ({ label: `Perfil ${i}` })), notes: "🔍 SEGUIMIENTO: cambiar la clave" }, owner);
    const ana = await (await post("/api/admin/customers", { name: "Ana Rojas Quispe", phone: "+59170011223" }, owner)).json();
    await post(`/api/admin/customers/${ana.id}/login-pin`, { pin: "2468" }, owner);
    const ck = (await post("/api/auth/customer/pin", { phone: ana.phone, pin: "2468" })).headers.get("set-cookie").split(";")[0];
    const o = await (await post("/api/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "qr", idempotencyKey: "k1" }, ck)).json();
    await post(`/api/orders/${o.id}/evidence`, { contentBase64: PNG, declaredReference: "OP-777" }, ck);
    await post(`/api/admin/orders/${o.id}/approve`, { confirmedReference: "BNB-777", idempotencyKey: "a1" }, owner);
    await post("/api/admin/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }, owner);
  });
  after(async () => { await app?.close(); rmSync(dir, { recursive: true, force: true }); });

  test("API: «Para hoy» con los conteos de la secretaria; lo que hizo el dueño entra a la línea de tiempo sin datos sensibles; siguen siendo 6", async () => {
    const d = await get("/api/admin/office", owner);
    assert.equal(d.agents.length, 6);
    assert.ok(d.pendientes && typeof d.pendientes.cobrar === "number", "trae los conteos");
    assert.equal(d.pendientes.claves, 1, "la cuenta con SEGUIMIENTO cuenta como clave por cambiar");
    const mine = d.feed.filter((x) => x.a === "owner");
    assert.ok(mine.some((x) => /Aprobaste el pago de Ana \(Netflix Premium\)/.test(x.text)), JSON.stringify(mine));
    assert.ok(mine.some((x) => /Vendiste Netflix Premium a Ana/.test(x.text)), JSON.stringify(mine));
    const texts = [...d.feed.map((x) => x.text), ...d.agents.flatMap((a) => a.recent.map((x) => x.text))].join(" | ");
    assert.ok(!/Rojas|Secreta#99|nf1@x\.lat|777|Bs 20|2000/.test(texts), `ni apellido, ni contraseña, ni correo, ni número de operación, ni costo: ${texts}`);
  });

  test("navegador a 360 px: sala nocturna con 6 anillos, línea de tiempo, Para hoy; sin desborde; 44 px; letra ≥ 12 px; globitos legibles (claro y oscuro)", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const b = await chromium.launch();
    try {
      const [n, v] = owner.split("=");
      for (const theme of ["dark", "light"]) {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, isMobile: true, hasTouch: true });
        await ctx.addCookies([{ name: n, value: v, url: base }]);
        await ctx.addInitScript((th) => { try { localStorage.setItem("gs-panel-theme", th); } catch { /* */ } }, theme);
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        await p.goto(base + "/panel.html#oficina");
        await p.waitForSelector(".of-desk", { timeout: 20_000 });
        await p.locator(".of-desk").first().click();
        await p.waitForSelector("#ofDetail");
        const m = await p.evaluate(() => {
          const vis = (x) => { const r = x.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
          const lum = (c) => { const m = c.match(/\d+(\.\d+)?/g); const [r, g, b] = m.slice(0, 3).map(Number).map((x) => { x /= 255; return x <= 0.03928 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
          const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05); };
          return {
            desks: document.querySelectorAll(".of-desk").length, rings: document.querySelectorAll(".of-ring svg").length, mons: document.querySelectorAll(".of-mon").length,
            tl: !!document.querySelector(".of-tl li"), today: /Para hoy/.test(document.getElementById("ofRoot").innerText), ticker: !!document.querySelector(".of-ticker"),
            over: document.documentElement.scrollWidth > innerWidth + 1,
            small: [...document.querySelectorAll("#ofRoot button")].filter((x) => vis(x) && x.getBoundingClientRect().height < 44).map((x) => x.textContent.trim().slice(0, 20)),
            tiny: [...document.querySelectorAll("#ofRoot *")].filter((x) => vis(x) && [...x.childNodes].some((c) => c.nodeType === 3 && c.textContent.trim()) && parseFloat(getComputedStyle(x).fontSize) < 12).map((x) => x.textContent.trim().slice(0, 20)),
            bub: [...document.querySelectorAll(".of-bub")].map((x) => Number(ratio(getComputedStyle(x).color, getComputedStyle(x).backgroundColor).toFixed(2))),
            room: getComputedStyle(document.querySelector(".of-wrap")).color,
          };
        });
        assert.equal(m.desks, 6, theme); assert.equal(m.rings, 6, theme); assert.equal(m.mons, 6, theme);
        assert.ok(m.tl, `${theme}: línea de tiempo con eventos`); assert.ok(m.today, `${theme}: tarjeta Para hoy`); assert.ok(m.ticker, `${theme}: ticker`);
        assert.equal(m.over, false, `${theme}: sin desborde`); assert.deepEqual(m.small, [], `${theme}: botones de 44 px`); assert.deepEqual(m.tiny, [], `${theme}: letra ≥ 12 px`);
        assert.ok(m.bub.length === 6 && m.bub.every((r) => r >= 4.5), `${theme}: globitos legibles ${m.bub.join(", ")}`);
        assert.deepEqual(errs, []);
        await ctx.close();
      }
    } finally { await b.close(); }
  });
});
