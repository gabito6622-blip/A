// Arreglos de FINANZAS (14/11/2026), pedidos por el dueño después de revisar su plata en el panel:
//  6. los meses cerrados también restan el costo estimado de las cuentas (o dicen «sin costos anotados»), y la
//     comparativa con el mes anterior usa la misma regla;
//  7. el Excel del negocio da la misma ganancia que el panel (con la fila del costo de cuentas) y el precio real
//     en la hoja Vencimientos;
//  8. lo que se cobra de un fiado suma a «Entró» el día del pago, sin contar dos veces el mismo alquiler;
//  9. «Cómo van»: ganancia estimada y deuda por revendedor, todo «este mes»;
// 10. meses con nombre largo, nunca «jun 26» ni «2026-11» a la vista.
// Datos ficticios, reloj controlado, carpetas temporales. Nada real.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { createStore } from "../dist/store/index.js";
import { overview as comoVan } from "../dist/store/resellerStats.js";
import { incomeEvents } from "../dist/store/income.js";
import { accountsEstimateMonth } from "../dist/store/finanzasCostos.js";
import { businessReport } from "../dist/server/reportXlsx.js";
import { createApp } from "../dist/server/app.js";

let chromium = null;
try { chromium = createRequire(import.meta.url)("playwright").chromium; } catch { /* sin navegador */ }
const hasPy = (() => { if (process.env.GS_TEST_NO_PY) return false; try { execFileSync("python3", ["-I", "-c", "import openpyxl"], { stdio: "ignore" }); return true; } catch { return false; } })();

const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" };
const SEP1 = Date.UTC(2026, 8, 1, 4), OCT1 = Date.UTC(2026, 9, 1, 4), NOV1 = Date.UTC(2026, 10, 1, 4);
const NOW = NOV1 + 13 * DAY + 14 * HOUR; // 14/11/2026 14:00 en Bolivia

/** Tienda: Netflix (perfil, 5 por cuenta) y Disney (cuenta completa); un revendedor y un cliente final. */
function world(start = SEP1 + 10 * DAY) {
  const clock = { t: start, now() { return this.t; } };
  const s = createStore({ clock });
  const at = (t) => { clock.t = t; };
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertProduct(owner, { id: "disney", name: "Disney cuenta", kind: "full_account", durationDays: 30, price: 6900, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 3000, disney: 6600 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
  const rev = s.catalog.createCustomer(owner, { name: "Ari Revende", phone: "+59170000001", kind: "reseller", priceGroupId: "revendedor" });
  const fin = s.catalog.createCustomer(owner, { name: "Carla Final", phone: "+59170000002" });
  const acc = (productId, email, cost, profiles, exp = start + 400 * DAY) => s.inventory.addAccount(owner, { productId, supplierId: "prov", email, password: "Clave#Secreta1", supplierExpiresAt: exp, cost, profiles });
  const buy = (cid, productId, t) => { at(t); return s.orders.create(owner, { customerId: cid, items: [{ productId, qty: 1 }], paymentMethod: "cash" }); };
  return { s, clock, at, rev, fin, acc, buy };
}

describe("6 · meses cerrados con el costo de las cuentas", () => {
  test("la regla, mes por mes", () => {
    const w = world(SEP1 + 2 * DAY);
    const { s, at } = w;
    at(SEP1 + 2 * DAY);
    w.acc("netflix", "nf1@x.lat", 4000, [1, 2, 3, 4, 5].map((k) => ({ label: `P${k}` })));
    at(OCT1 + 4 * DAY);
    const dis = w.acc("disney", "dis1@x.lat", 2500, [{ label: "Cuenta completa" }]);
    w.acc("disney", "gratis@x.lat", 0, [{ label: "Cuenta completa" }]); // sin costo: no suma
    // Septiembre: Carla compra Netflix (Bs 35). Octubre: Ari compra Disney (Bs 66) y Carla Netflix (Bs 35).
    w.buy(w.fin.id, "netflix", SEP1 + 5 * DAY);
    w.buy(w.rev.id, "disney", OCT1 + 6 * DAY); w.buy(w.fin.id, "netflix", OCT1 + 7 * DAY);
    // En octubre anotaste «Pagué la renovación» de la de Disney: esa ya no se estima en octubre.
    at(OCT1 + 8 * DAY); s.finance.payRenewal(owner, dis.account.id, { amount: 2500 });
    at(NOW);
    const oct = s.finance.monthClose(owner, "2026-10");
    assert.equal(oct.closed, true);
    assert.equal(oct.ingresos, 6600 + 3500);
    assert.equal(oct.gastos, 2500, "la renovación de Disney anotada");
    assert.equal(oct.cuentasEstimado, 4000, "solo la de Netflix sin anotar (la de Disney ya se anotó, la gratis no suma)");
    assert.equal(oct.gananciaEstimada, 6600 + 3500 - 2500 - 4000);
    assert.notEqual(oct.gananciaEstimada, oct.ingresos, "ya no sale 100 % de ganancia");
    assert.equal(oct.sinCostos, false);
    // Septiembre (el anterior) con la misma regla: la de Netflix ya estaba; la de Disney todavía no.
    assert.equal(oct.prev.label, "septiembre 2026", "el mes anterior con nombre largo, no «2026-09»");
    assert.equal(oct.prev.cuentasEstimado, 4000);
    assert.equal(oct.prev.gananciaEstimada, 3500 - 4000);
    assert.equal(oct.vs.ganancia, oct.gananciaEstimada - oct.prev.gananciaEstimada, "la comparativa compara ganancias con la misma regla");
    // Agosto: no había cuentas ni gastos de cuentas → «sin costos anotados».
    const ago = s.finance.monthClose(owner, "2026-08");
    assert.deepEqual([ago.cuentasEstimado, ago.sinCostos], [0, true]);
    // Noviembre (en curso): la misma función que Finanzas («🔑 Cuentas (estimado)»).
    const nov = s.finance.monthClose(owner, "2026-11");
    const rep = s.finance.report(owner, 6);
    assert.equal(nov.cuentasEstimado, rep.current.cuentasEstimado);
    assert.equal(nov.cuentasEstimado, 4000 + 2500, "en noviembre ninguna se anotó todavía");
    // Las barras de los 6 meses: cada mes con su ganancia estimada; el último = «Te quedó» de arriba.
    const byKey = Object.fromEntries(rep.months.map((m) => [m.key, m]));
    assert.equal(byKey["2026-10"].gananciaEstimada, oct.gananciaEstimada);
    assert.equal(byKey["2026-09"].gananciaEstimada, oct.prev.gananciaEstimada);
    assert.equal(byKey["2026-08"].sinCostos, true);
    assert.equal(rep.months.at(-1).gananciaEstimada, rep.current.gananciaEstimada);
    assert.equal(rep.months.at(-1).longLabel, "noviembre 2026");
  });

  test("una cuenta retirada cuenta en los meses en que estaba viva, no después", () => {
    const w = world(SEP1 + DAY);
    const { s, at } = w;
    const a = w.acc("netflix", "caida@x.lat", 3000, [{ label: "P1" }]);
    at(OCT1 + 10 * DAY); s.orders.replaceAccount(owner, a.account.id, "Cuenta caída");
    at(NOW);
    assert.equal(s.engine.s.accounts[a.account.id].status, "retired");
    assert.equal(accountsEstimateMonth(s.engine, "2026-09").amount, 3000, "en septiembre estaba viva");
    assert.equal(accountsEstimateMonth(s.engine, "2026-10").amount, 0, "se retiró en octubre");
    assert.equal(accountsEstimateMonth(s.engine, "2026-11").amount, 0);
  });
});

describe("8 · lo que se cobra de un fiado suma a «Entró»", () => {
  test("pago de un fiado suelto: entra el día del pago (también si es una parte)", () => {
    const w = world(NOV1 + DAY);
    const { s, at } = w;
    at(NOV1 + 2 * DAY); s.fiado.charge(owner, { customerId: w.fin.id, amount: 5000, note: "préstamo" });
    const before = s.finance.report(owner, 1).current.ingresos;
    at(NOV1 + 5 * DAY); s.fiado.pay(owner, { customerId: w.fin.id, amount: 2000, note: "una parte" });
    at(NOW);
    const r = s.finance.report(owner, 1).current;
    assert.equal(r.ingresos - before, 2000, "suma lo que entró, aunque sea una parte");
    assert.equal(r.delFiado, 2000);
    const ev = incomeEvents(s.engine).filter((x) => x.source === "fiado");
    assert.deepEqual(ev.map((x) => [x.at, x.amount, x.kind]), [[NOV1 + 5 * DAY, 2000, "fiado"]], "el día del pago");
    const c = s.finance.monthClose(owner);
    assert.deepEqual([c.delFiado, c.cobrosFiado], [2000, 1]);
    // El resumen del dashboard (misma fuente) también lo cuenta como plata que entró.
    const sum = s.stats.summary(owner, { from: NOV1, to: NOW + 1 });
    assert.equal(sum.revenue, r.ingresos);
  });

  test("un alquiler del Control pasado al fiado y después pagado cuenta UNA vez (marca vieja sin anotación)", () => {
    const w = world(NOV1 + DAY);
    const { s, at } = w;
    w.acc("disney", "d1@x.lat", 2000, [{ label: "Cuenta completa" }]);
    const o = w.buy(w.rev.id, "disney", NOV1 + DAY); // pedido: Bs 66 entra hoy
    const asg = o.assignmentIds[0];
    // Pasan 30 días… no: se corrige la fecha para que su período siguiente esté sin pagar.
    at(NOV1 + 3 * DAY);
    s.engine.tx(() => { s.engine.s.assignments[asg].control = { payStatus: "pendiente", price: 6600 }; }); // marca vieja (sin paidLog)
    s.engine.s.assignments[asg].customerExpiresAt = NOV1 + 40 * DAY; // otro período (lejos del pedido)
    const base = sumIncome(s);
    assert.deepEqual(s.fiado.fromControl(owner, w.rev.id), { added: 1, amount: 6600 });
    at(NOV1 + 6 * DAY); s.fiado.pay(owner, { customerId: w.rev.id, amount: 6600, note: "QR" });
    assert.equal(s.engine.s.assignments[asg].control.payStatus, "pagado", "el Control pasa solo a Pagado");
    at(NOW);
    assert.equal(sumIncome(s) - base, 6600, "entra una sola vez: el pago del fiado (la marca del Control no suma)");
    assert.equal(incomeEvents(s.engine).filter((x) => x.assignmentId === asg && x.source === "control").length, 0);
  });

  test("con la marca nueva (paidLog): marcar pagado en el Control y además pagar el fiado no duplica", () => {
    const w = world(NOV1 + DAY);
    const { s, at } = w;
    w.acc("disney", "d1@x.lat", 2000, [{ label: "Cuenta completa" }]);
    const o = w.buy(w.fin.id, "disney", NOV1 + DAY);
    const asg = o.assignmentIds[0];
    s.engine.s.assignments[asg].customerExpiresAt = NOV1 + 45 * DAY;
    at(NOV1 + 2 * DAY); s.orders.setControl(owner, asg, { payStatus: "pendiente", price: 6900 });
    s.fiado.fromControl(owner, w.fin.id);
    const base = sumIncome(s);
    at(NOV1 + 4 * DAY); s.fiado.pay(owner, { customerId: w.fin.id, amount: 6900 });
    // El dueño, además, lo marca «pagado» a mano en el Control (queda anotado en paidLog): no se cuenta dos veces.
    at(NOV1 + 5 * DAY); s.orders.setControl(owner, asg, { payStatus: "pendiente" }); s.orders.setControl(owner, asg, { payStatus: "pagado" });
    at(NOW);
    assert.equal(sumIncome(s) - base, 6900, "una sola vez");
  });

  test("la libreta de un revendedor (lo que le deben SUS clientes) no es plata de la tienda", () => {
    const w = world(NOV1 + DAY);
    const { s, at } = w;
    const AR = { id: "u_ari", role: "reseller", customerId: w.rev.id };
    const cli = s.catalog.createCustomer(AR, { name: "Cliente de Ari", phone: "+59170000009" });
    s.fiado.charge(AR, { customerId: cli.id, amount: 3000 });
    const base = sumIncome(s);
    at(NOV1 + 3 * DAY); s.fiado.pay(AR, { customerId: cli.id, amount: 3000 });
    at(NOW);
    assert.equal(sumIncome(s), base);
  });
});

describe("9 · Cómo van: ganancia estimada y deuda, todo «este mes»", () => {
  test("por revendedor y en total; la deuda es la misma que la pantalla Fiado", () => {
    const w = world(OCT1 + DAY);
    const { s, at } = w;
    // Netflix: Bs 40 por mes, 5 perfiles → Bs 8 por perfil. Disney: Bs 20 la cuenta.
    w.acc("netflix", "nf@x.lat", 4000, [1, 2, 3, 4, 5].map((k) => ({ label: `P${k}` })));
    for (const k of [1, 2, 3]) w.acc("disney", `d${k}@x.lat`, 2000, [{ label: "Cuenta completa" }]);
    const beto = s.catalog.createCustomer(owner, { name: "Beto Revende", phone: "+59170000003", kind: "reseller", priceGroupId: "revendedor" });
    w.buy(w.rev.id, "disney", OCT1 + 20 * DAY); // octubre: no cuenta para «este mes»
    w.buy(w.rev.id, "netflix", NOV1 + 2 * DAY); // Bs 30 − Bs 8
    const o = w.buy(w.rev.id, "disney", NOV1 + 3 * DAY); // Bs 66 − Bs 20
    // Beto debe: un fiado de Bs 50 y un alquiler marcado «No pagó» en el Control (sin pasar al fiado).
    const ob = w.buy(beto.id, "disney", NOV1 + 4 * DAY);
    at(NOV1 + 5 * DAY);
    s.fiado.charge(owner, { customerId: beto.id, amount: 5000, note: "préstamo" });
    s.orders.setControl(owner, ob.assignmentIds[0], { payStatus: "no_pago", price: 6600 });
    at(NOW);
    const d = comoVan(s.engine, owner, NOW);
    const ari = d.list.find((r) => r.id === w.rev.id), b = d.list.find((r) => r.id === beto.id);
    assert.equal(ari.thisMonth, 3000 + 6600);
    assert.deepEqual([ari.month.paid, ari.month.cost, ari.month.profit], [9600, 800 + 2000, 9600 - 2800]);
    assert.deepEqual(ari.debt, { fiado: 0, pending: 0, pendingCount: 0, total: 0 });
    assert.deepEqual([b.debt.fiado, b.debt.pending, b.debt.total], [5000, 6600, 11600]);
    const fo = s.fiado.overview(owner).rows.find((r) => r.customerId === beto.id);
    assert.deepEqual([fo.owed, fo.unlinked.amount], [b.debt.fiado, b.debt.pending], "los mismos números que Fiado");
    assert.equal(d.totals.debt.total, 11600);
    assert.equal(d.totals.debt.people, 1);
    assert.equal(d.totals.month.paid, d.totals.thisMonth);
    assert.equal(d.totals.month.profit, d.list.reduce((t, r) => t + r.month.profit, 0));
    assert.deepEqual(d.list.map((r) => r.id).slice(0, 2), [w.rev.id, beto.id], "ordenados por lo que te pagaron este mes");
    // Si Beto paga su fiado, suma a lo que te pagó este mes.
    const before = d.list.find((r) => r.id === beto.id).thisMonth;
    s.fiado.pay(owner, { customerId: beto.id, amount: 5000 });
    const d2 = comoVan(s.engine, owner, NOW);
    const b2 = d2.list.find((r) => r.id === beto.id);
    assert.equal(b2.thisMonth - before, 5000);
    assert.equal(b2.month.fromFiado, 5000);
    assert.equal(b2.debt.fiado, 0);
    // Privacidad: nada de lo que el revendedor anota de sus clientes.
    assert.ok(!/rcontrol|subs|Clave#/.test(JSON.stringify(d2)));
  });
});

function sumIncome(s) { return incomeEvents(s.engine).reduce((t, x) => t + x.amount, 0); }

describe("7 y 10 · Excel del negocio = panel", () => {
  test("misma ganancia que Finanzas (con el costo de las cuentas), precio real en Vencimientos y meses con nombre largo", () => {
    const w = world(OCT1 + DAY);
    const { s, at } = w;
    w.acc("netflix", "nf@x.lat", 4000, [1, 2, 3, 4, 5].map((k) => ({ label: `P${k}` })));
    w.acc("disney", "d1@x.lat", 2000, [{ label: "Cuenta completa" }]);
    w.buy(w.rev.id, "disney", NOV1 + 2 * DAY); // el revendedor: precio de su lista (Bs 66), sin precio en el Control
    w.buy(w.fin.id, "netflix", NOV1 + 3 * DAY);
    at(NOV1 + 4 * DAY); s.finance.addExpense(owner, 1500, "publicidad");
    at(NOW);
    const cur = s.finance.report(owner, 1).current;
    const { file } = businessReport(s, owner, { from: NOV1, to: NOW });
    const raw = file.toString("utf8");
    assert.ok(raw.includes("Costo estimado de cuentas"), "fila del costo de las cuentas en la portada");
    assert.ok(raw.includes("B6-B7-B8"), "Te quedó = ingresos − gastos − costo de las cuentas");
    assert.ok(raw.includes("noviembre 2026") && raw.includes("octubre 2026"), "meses con nombre largo");
    assert.ok(!/>(ene|feb|mar|abr|may|jun|jul|ago|sep|oct|nov|dic) \d{2,4}</.test(raw), "nunca «nov 26»");
    if (!hasPy) return;
    const dir = mkdtempSync(join(tmpdir(), "gs-equipoC-"));
    try {
      const f = join(dir, "r.xlsx"); writeFileSync(f, file);
      const py = `
import openpyxl, json, sys
wb = openpyxl.load_workbook(sys.argv[1])
p = wb["Portada"]; v = wb["Vencimientos"]; r = wb["Resumen"]; ve = wb["Ventas"]
kp = {p.cell(i,1).value: p.cell(i,2).value for i in range(6, 20)}
rows = [[c.value for c in x] for x in v.iter_rows(min_row=5, max_row=v.max_row)]
res = [[c.value for c in x] for x in r.iter_rows(min_row=5, max_row=r.max_row)]
vsum = sum((x[5] or 0) for x in ve.iter_rows(min_row=5, max_row=ve.max_row-1, values_only=True) if isinstance(x[5], (int, float)))
print(json.dumps({"kp": kp, "venc": rows, "res": res, "vsum": vsum}, default=str))`;
      const out = JSON.parse(execFileSync("python3", ["-I", "-c", py, f], { encoding: "utf8" }));
      assert.equal(out.kp["Te quedó"], "=B6-B7-B8");
      const ingresos = Math.round(out.vsum * 100), gastos = Math.round(out.kp["Gastos del período"] * 100), cuentas = Math.round(out.kp["Costo estimado de cuentas"] * 100);
      assert.equal(ingresos, cur.ingresos); assert.equal(gastos, cur.gastos); assert.equal(cuentas, cur.cuentasEstimado);
      assert.equal(ingresos - gastos - cuentas, cur.gananciaEstimada, "la misma ganancia que «Te quedó» del panel");
      // Vencimientos: el precio que muestra el panel (lista del revendedor / producto), no Bs 0.
      const prices = Object.fromEntries(out.venc.map((x) => [x[0], x[8]]));
      assert.equal(prices["Ari Revende"], 66, "precio de la lista del revendedor");
      assert.equal(prices["Carla Final"], 35, "precio del producto");
      // Resumen mensual: el mes en curso con su costo de cuentas y la fórmula que lo resta.
      const nov = out.res.find((x) => x[0] === "noviembre 2026");
      assert.ok(nov, "fila «noviembre 2026»");
      assert.equal(Math.round(nov[6] * 100), cur.cuentasEstimado);
      assert.match(String(nov[7]), /^=B\d+-F\d+-G\d+$/);
    } finally { rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("pantallas a 360 px: Finanzas y Cómo van", () => {
  test("barras con mes en palabras, «sin costos» en los meses sin datos y «este mes» en Cómo van", { skip: !chromium && "Playwright no está instalado", timeout: 180_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-equipoC-"));
    const app = createApp({ dataDir: dir, staticDir: resolve("public"), jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    const s = app.store;
    s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
    s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { netflix: 3000 } });
    s.inventory.addAccount(owner, { productId: "netflix", email: "nf@x.lat", password: "Clave#Secreta1", supplierExpiresAt: Date.now() + 60 * DAY, cost: 4000, profiles: [1, 2, 3, 4, 5].map((k) => ({ label: `P${k}` })) });
    const rev = s.catalog.createCustomer(owner, { name: "Ari Revende", phone: "+59170000001", kind: "reseller", priceGroupId: "revendedor" });
    s.orders.create(owner, { customerId: rev.id, items: [{ productId: "netflix", qty: 1 }], paymentMethod: "cash" });
    s.fiado.charge(owner, { customerId: rev.id, amount: 5000, note: "préstamo" });
    const b = await chromium.launch();
    try {
      for (const scheme of ["light", "dark"]) {
        const ctx = await b.newContext({ viewport: { width: 360, height: 780 }, colorScheme: scheme });
        await ctx.route(/fonts\.(googleapis|gstatic)/, (r) => r.abort());
        const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
        await p.goto(base + "/panel.html#finanzas");
        await p.fill("input[name=username]", "gabriel"); await p.fill("input[name=password]", "clave-del-dueño-123"); await p.press("input[name=password]", "Enter");
        await p.waitForSelector(".finchart .finbar");
        const fin = await p.evaluate(() => ({
          labels: [...document.querySelectorAll(".finbar > small")].map((x) => x.textContent.trim()),
          over: document.documentElement.scrollWidth > innerWidth + 1,
          cierre: document.querySelector(".cierre")?.textContent ?? "",
        }));
        assert.equal(fin.over, false, `${scheme}: sin desborde`);
        assert.ok(fin.labels.some((l) => l.startsWith("noviembre") || l.startsWith(new Date().toLocaleDateString("es-BO", { month: "long" }))), `${scheme}: el mes en palabras (${fin.labels})`);
        assert.ok(fin.labels.every((l) => !/^[a-z]{3} \d{2}$/.test(l) && !/\d{4}-\d{2}/.test(l)), `${scheme}: nunca «jun 26» ni «2026-11» (${fin.labels})`);
        assert.ok(fin.labels.some((l) => /sin costos/.test(l)), `${scheme}: los meses sin cuentas dicen «sin costos»`);
        assert.ok(!/\d{4}-\d{2}/.test(fin.cierre), `${scheme}: el cierre no muestra «2026-10»`);
        await p.goto(base + "/panel.html#comovan"); await p.reload(); // solo cambia el «#»: hay que recargar
        await p.waitForSelector(".cv-head");
        const cv = await p.evaluate(() => ({ text: document.querySelector("main")?.textContent ?? document.body.textContent, over: document.documentElement.scrollWidth > innerWidth + 1 }));
        assert.equal(cv.over, false, `${scheme}: Cómo van sin desborde`);
        assert.match(cv.text, /Este mes/); assert.match(cv.text, /Ganancia estimada este mes/); assert.match(cv.text, /Te deben hoy/);
        assert.ok(!/30 días\)/.test(cv.text), "ya no mezcla «30 días» en los montos");
        await p.click("details.cv-row > summary");
        assert.match(await p.locator("details.cv-row[open]").innerText(), /Te debe[\s\S]*Bs 50/);
        assert.deepEqual(errs, [], `${scheme}: sin errores de consola`);
        await ctx.close();
      }
    } finally { await b.close(); await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});

describe("cierre.xlsx sin «2026-10» a la vista", () => {
  test("el mes anterior con nombre y la hoja con el mes en palabras", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-equipoC-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
    try {
      const ck = (await fetch(base + "/api/auth/staff/login", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ username: "gabriel", password: "clave-del-dueño-123" }) })).headers.get("set-cookie").split(";")[0];
      const r = await fetch(base + "/api/admin/finance/cierre.xlsx?month=2026-10", { headers: { cookie: ck } });
      assert.equal(r.status, 200);
      const raw = Buffer.from(await r.arrayBuffer()).toString("utf8");
      assert.ok(raw.includes("septiembre 2026") && raw.includes("Cierre octubre 2026"), "nombres largos");
      assert.ok(!/>2026-\d{2}</.test(raw), "sin «2026-09» en las celdas");
      assert.ok(raw.includes("sin costos anotados"), "un mes sin cuentas lo dice");
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
