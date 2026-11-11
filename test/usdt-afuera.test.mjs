// Revendedores de afuera (Paraguay, Panamá…) le pagan al dueño en USDT por Binance:
// recargan saldo con USDT, ven los montos también en USDT y no se les ofrece el QR de Bolivia.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { createRequire } from "node:module";
import { createStore } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const owner = { id: "u_owner", role: "owner" };
const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==", "base64");

test("recarga con USDT: solo si la tienda lo configuró; al aprobar se acredita en Bs", () => {
  const s = createStore();
  const py = s.catalog.createCustomer(owner, { name: "Py Rev", phone: "+595981123456", kind: "reseller" });
  const me = { id: "u_py", role: "reseller", customerId: py.id };
  assert.throws(() => s.orders.requestTopup(me, py.id, 10000, { fileRef: "a.png", declaredReference: "hash1" }, "usdt"), /todavía no recibe USDT/);
  s.catalog.updateSettings(owner, { usdt: { enabled: true, payId: "123456789", rate: 6.96 } });
  const o = s.orders.requestTopup(me, py.id, 10000, { fileRef: "a.png", declaredReference: "hash1" }, "usdt");
  assert.equal(o.paymentMethod, "usdt");
  assert.equal(o.status, "payment_review");
  s.orders.approvePayment(owner, o.id, { confirmedReference: "hash1" });
  assert.equal(s.wallet.balance(py.id), 10000, "el saldo queda en Bs");
  // Sin método explícito sigue siendo QR (nada cambia para Bolivia).
  assert.equal(s.orders.requestTopup(me, py.id, 5000, { fileRef: "b.png", declaredReference: "op2" }).paymentMethod, "qr");
});

test("en el navegador: revendedor de Paraguay ve USDT primero, montos en USDT y sin QR de Bolivia", { skip: !chromium && "Playwright no está instalado" }, async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-usdt-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const browser = await chromium.launch();
  try {
    const lr = await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) });
    const ck = lr.headers.get("set-cookie").split(";")[0];
    const A = (m, p, b) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: b ? JSON.stringify(b) : undefined }).then((r) => r.json());
    await A("POST", "/api/admin/settings", { usdt: { enabled: true, payId: "123456789", rate: 6.96 } });
    await A("POST", "/api/admin/settings/qr", { contentBase64: PNG.toString("base64") });
    await A("POST", "/api/admin/products", { id: "dis", name: "Disney+", kind: "full_account", durationDays: 30, price: 3400, published: true, resellersOnly: true });
    const py = await A("POST", "/api/admin/customers", { name: "Py Rev", phone: "+595981123456", kind: "reseller" });
    const bo = await A("POST", "/api/admin/customers", { name: "Bo Rev", phone: "+59171234567", kind: "reseller" });
    await A("POST", `/api/admin/customers/${py.id}/locale`, { country: "PY" });
    const login = async (phone, id) => {
      const { pin } = await A("POST", `/api/admin/customers/${id}/login-pin`, {});
      const r = await fetch(base + "/api/auth/customer/pin", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ phone, pin }) });
      const [name, value] = r.headers.get("set-cookie").split(";")[0].split("=");
      const ctx = await browser.newContext({ viewport: { width: 360, height: 800 }, isMobile: true });
      await ctx.addCookies([{ name, value, url: base }]);
      return ctx;
    };
    const errors = [];
    // Paraguay
    const cpy = await login("+595981123456", py.id);
    const p = await cpy.newPage(); p.on("pageerror", (e) => errors.push(e.message));
    await p.goto(base + "/hub#recargas"); await p.locator("#topup").waitFor();
    assert.equal(await p.locator('#topup input[name="tm"][value="qr"]').count(), 0, "sin QR de Bolivia");
    assert.ok(await p.locator('#topup input[name="tm"][value="usdt"]').isChecked());
    assert.match(await p.locator("#tmUsdt").innerText(), /14\.37 USDT/, "Bs 100 / 6,96 = 14,37 USDT");
    await p.locator('#topup input[name="pack"][value="20000"]').check();
    assert.match(await p.locator("#tmUsdt").innerText(), /28\.74 USDT/, "sigue al paquete elegido");
    assert.ok(!(await p.evaluate(() => document.documentElement.scrollWidth > innerWidth)));
    await p.goto(base + "/hub#precios"); await p.waitForTimeout(800);
    assert.match(await p.locator(".pgrid").innerText(), /≈ 4,89 USDT/, "Bs 34 en USDT");
    // Bolivia: igual que antes (QR primero, sin montos en USDT)
    const cbo = await login("+59171234567", bo.id);
    const q = await cbo.newPage(); q.on("pageerror", (e) => errors.push(e.message));
    await q.goto(base + "/hub#recargas"); await q.locator("#topup").waitFor();
    assert.ok(await q.locator('#topup input[name="tm"][value="qr"]').isChecked());
    assert.equal(await q.locator("#tmUsdt").isHidden(), true);
    assert.equal(await q.locator(".packs small.usdt").count(), 0);
    assert.deepEqual(errors, []);
  } finally { await browser.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
