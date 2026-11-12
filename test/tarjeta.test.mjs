// 💳 Cuentas que se pagan en dólares con tarjeta (pedido del dueño, 12/11/2026): cada cuenta guarda cuánto cobra
// por mes en US$; "Pagué la renovación" calcula los Bs con la tasa del día (editable) y guarda dólares, tasa y Bs;
// Finanzas muestra los próximos cobros de la tarjeta. Datos ficticios; nada real.
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

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), "gs-tarjeta-"));
  const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
  app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
  const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
  const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
  const R = (m, p, body) => fetch(base + p, { method: m, headers: { "content-type": "application/json", cookie: ck }, body: body ? JSON.stringify(body) : undefined });
  const A = async (m, p, body) => (await R(m, p, body)).json();
  await A("POST", "/api/admin/settings", { usdt: { enabled: false, rate: 11.71 } });
  await A("POST", "/api/admin/products", { id: "nf", name: "Netflix (revendedores)", kind: "full_account", durationDays: 30, price: 25000, published: true });
  const acc = (await A("POST", "/api/admin/accounts", { productId: "nf", email: "nf.tarjeta@ejemplo.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 5 * DAY, cost: 18000, profiles: [{ label: "Cuenta completa" }] })).account.id;
  return { dir, app, base, R, A, acc, close: async () => { await app.close(); rmSync(dir, { recursive: true, force: true }); } };
}

test("la cuenta guarda su costo en dólares y el pago guarda dólares, tasa y bolivianos", async () => {
  const s = await setup();
  try {
    assert.equal((await s.R("POST", `/api/admin/accounts/${s.acc}`, { costUsd: 1549 })).status, 200);
    let a = (await s.A("GET", "/api/admin/accounts")).find((x) => x.id === s.acc);
    assert.equal(a.costUsd, 1549);
    assert.equal((await s.R("POST", `/api/admin/accounts/${s.acc}`, { costUsd: -5 })).status, 400);
    assert.equal((await s.R("POST", `/api/admin/accounts/${s.acc}`, { costUsd: 200000 })).status, 400, "hasta US$ 1000");
    // Dólares sin tasa: no.
    assert.equal((await s.R("POST", `/api/admin/accounts/${s.acc}/renew-paid`, { amount: 18139, usd: 1549 })).status, 400);
    const r = await s.A("POST", `/api/admin/accounts/${s.acc}/renew-paid`, { amount: 18139, months: 1, usd: 1549, rate: 11.71 });
    assert.deepEqual([r.expense.amount, r.expense.usd, r.expense.rate], [18139, 1549, 11.71]);
    assert.match(r.expense.note, /US\$ 15\.49 × 11\.71/);
    a = (await s.A("GET", "/api/admin/accounts")).find((x) => x.id === s.acc);
    assert.deepEqual([a.cost, a.costUsd], [18139, 1549], "el costo del mes queda en Bs y en US$");
    // Dos meses juntos: el costo por mes sigue siendo el de un mes.
    await s.A("POST", `/api/admin/accounts/${s.acc}/renew-paid`, { amount: 37176, months: 2, usd: 3098, rate: 12 });
    a = (await s.A("GET", "/api/admin/accounts")).find((x) => x.id === s.acc);
    assert.deepEqual([a.cost, a.costUsd], [18588, 1549]);
    // Sin dólares sigue funcionando como siempre.
    const plain = await s.A("POST", `/api/admin/accounts/${s.acc}/renew-paid`, { amount: 18000 });
    assert.equal(plain.expense.usd, undefined);
    // Quitar el costo en dólares.
    await s.A("POST", `/api/admin/accounts/${s.acc}`, { costUsd: 0 });
    assert.equal((await s.A("GET", "/api/admin/accounts")).find((x) => x.id === s.acc).costUsd, undefined);
  } finally { await s.close(); }
});

test("navegador: editar en dólares, «Pagué la renovación» calcula los Bs y Finanzas muestra los próximos cobros", { skip: !chromium, timeout: 180_000 }, async () => {
  const s = await setup();
  const b = await chromium.launch();
  try {
    const ctx = await b.newContext({ viewport: { width: 360, height: 780 } });
    await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
    const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
    await p.goto(base(s) + "/panel.html#cuentas");
    await p.fill("input[name=username]", "gabriel"); await p.fill("input[name=password]", "clave-del-dueño-123"); await p.press("input[name=password]", "Enter");
    await p.waitForSelector(`[data-editaccopen="${s.acc}"]`);
    await p.click(`[data-editaccopen="${s.acc}"]`);
    await p.waitForSelector(`form[data-editacc="${s.acc}"] input[name=costUsd]`);
    await p.fill(`form[data-editacc="${s.acc}"] input[name=costUsd]`, "15,49");
    await p.click(`form[data-editacc="${s.acc}"] button[type=submit]`);
    await p.waitForFunction(async (id) => (await fetch("/api/admin/accounts").then((r) => r.json())).find((x) => x.id === id)?.costUsd === 1549, s.acc, { timeout: 15_000 });
    // La tarjeta de "Pagué la renovación" con dólares, tasa del día y Bs.
    await p.click(`[data-editaccopen="${s.acc}"]`).catch(() => {});
    await p.waitForSelector(`form[data-renewpaid="${s.acc}"] input[name=usd]`);
    const f = `form[data-renewpaid="${s.acc}"]`;
    assert.deepEqual([await p.inputValue(`${f} input[name=usd]`), await p.inputValue(`${f} input[name=rate]`), await p.inputValue(`${f} input[name=amount]`)], ["15.49", "11.71", "181.39"]);
    await p.selectOption(`${f} select[name=months]`, "2");
    assert.deepEqual([await p.inputValue(`${f} input[name=usd]`), await p.inputValue(`${f} input[name=amount]`)], ["30.98", "362.78"], "2 meses: el doble");
    await p.fill(`${f} input[name=rate]`, "12");
    assert.equal(await p.inputValue(`${f} input[name=amount]`), "371.76", "si el banco cobró otra tasa, se recalcula");
    const m = await p.evaluate(() => ({ over: document.documentElement.scrollWidth > innerWidth + 1 }));
    assert.deepEqual(m, { over: false });
    await p.click(`${f} button[type=submit]`);
    await p.waitForFunction(async () => (await fetch("/api/admin/finance?months=1").then((r) => r.json())).expenses?.some((x) => x.usd === 3098), null, { timeout: 15_000 });
    const exp = (await s.A("GET", "/api/admin/finance?months=1")).expenses.find((x) => x.usd === 3098);
    assert.deepEqual([exp.amount, exp.rate], [37176, 12]);
    // Finanzas: el próximo cobro (la fecha corrió 2 meses, así que en 30 días no hay; se ve el aviso correcto).
    await p.evaluate(() => { location.hash = "finanzas"; document.querySelector('#menu [data-go="finanzas"]').click(); });
    await p.waitForSelector(".tjcard");
    assert.match(await p.locator(".tjcard").innerText(), /Ninguna cuenta en dólares se cobra en los próximos 30 días/);
    // Otra cuenta en dólares que se cobra en 3 días: aparece con US$ y ≈ Bs.
    const acc2 = (await s.A("POST", "/api/admin/accounts", { productId: "nf", email: "nf.dos@ejemplo.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 3 * DAY, cost: 18000, profiles: [{ label: "Cuenta completa" }] })).account.id;
    await s.A("POST", `/api/admin/accounts/${acc2}`, { costUsd: 1000 });
    await p.evaluate(() => { document.querySelector('#menu [data-go="fiado"]').click(); });
    await p.waitForTimeout(400);
    await p.evaluate(() => { location.hash = "finanzas"; document.querySelector('#menu [data-go="finanzas"]').click(); });
    await p.waitForFunction(() => /US\$ 10,00/.test(document.querySelector(".tjcard")?.innerText ?? ""), null, { timeout: 15_000 });
    const txt = await p.locator(".tjcard").innerText();
    assert.match(txt, /1 cuenta/);
    assert.match(txt, /≈ Bs 117/);
    assert.match(txt, /Total 30 días: US\$ 10,00/);
    assert.deepEqual(errs, []);
    await ctx.close();
  } finally { await b.close(); await s.close(); }
});

function base(s) { return s.base; }
