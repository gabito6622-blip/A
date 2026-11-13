// Premium 2.0 · etapa 9 "Finanzas pro" (13/11/2026). Cierre de mes con la misma fuente de ingresos que Inicio y Finanzas,
// comparado con el mes anterior, con quién te pagó más y las apps que más dejaron; y su Excel. Datos ficticios.
import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createStore, DomainError } from "../dist/store/index.js";
import { createApp } from "../dist/server/app.js";
import { boMonthStart } from "../dist/store/time.js";

const DAY = 864e5, HOUR = 36e5;
const owner = { id: "u_owner", role: "owner" }, seller = { id: "u_seller", role: "seller" };
const err = (code) => (e) => e instanceof DomainError && e.code === code;
const NOV1 = Date.UTC(2026, 10, 1, 4), NOW = NOV1 + 12 * DAY + 14 * HOUR; // 13/11 14:00 Bolivia

function world() {
  const clock = { t: NOV1 - 40 * DAY, now() { return this.t; } };
  const s = createStore({ clock });
  s.catalog.upsertProduct(owner, { id: "disney-alq", name: "Disney (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true, resellersOnly: true });
  s.catalog.upsertProduct(owner, { id: "netflix", name: "Netflix perfil", kind: "profile", durationDays: 30, price: 3500, published: true });
  s.catalog.upsertPriceGroup(owner, { id: "revendedor", name: "Revendedor", prices: { "disney-alq": 6600, netflix: 3000 } });
  s.catalog.upsertSupplier(owner, { id: "prov", name: "Proveedor", active: true });
  for (let i = 0; i < 6; i++) s.inventory.addAccount(owner, { productId: "disney-alq", supplierId: "prov", email: `dis${i}@x.lat`, password: "Clave#Secreta1", supplierExpiresAt: clock.t + 500 * DAY, cost: 2000, profiles: [{ label: "Cuenta completa" }] });
  s.inventory.addAccount(owner, { productId: "netflix", supplierId: "prov", email: "nf@x.lat", password: "Clave#Secreta1", supplierExpiresAt: clock.t + 500 * DAY, cost: 2500, profiles: [1, 2, 3, 4, 5].map((k) => ({ label: `P${k}` })) });
  const at = (t) => { clock.t = t; };
  const rev = s.catalog.createCustomer(owner, { name: "ARIt", phone: "+59170000001", kind: "reseller", priceGroupId: "revendedor" });
  const fin = s.catalog.createCustomer(owner, { name: "Carla Final", phone: "+59170000002" });
  const buy = (cid, productId, t) => { at(t); return s.orders.create(owner, { customerId: cid, items: [{ productId, qty: 1 }], paymentMethod: "cash" }); };
  return { s, clock, at, rev, fin, buy };
}

describe("etapa 9 · finanzas pro", () => {
  test("cierre del mes: mismos ingresos que Finanzas, por origen, gastos, ganancia, comparativa, top apps y quién pagó más", () => {
    const w = world();
    const { s, at, rev, fin } = w;
    // Octubre: 2 ventas (Bs 66 + Bs 35) y un gasto de Bs 20. Noviembre: 1 venta Bs 66, 1 renovación Bs 66, 1 cobro del Control Bs 50, gasto Bs 30.
    w.buy(rev.id, "disney-alq", NOV1 - 10 * DAY); w.buy(fin.id, "netflix", NOV1 - 9 * DAY);
    at(NOV1 - 8 * DAY); s.finance.addExpense(owner, 2000, "internet");
    const o1 = w.buy(rev.id, "disney-alq", NOV1 + 1 * DAY);
    at(NOV1 + 3 * DAY); s.orders.renew(owner, o1.assignmentIds[0], { paymentMethod: "cash" });
    const o4 = w.buy(rev.id, "disney-alq", NOV1 - 45 * DAY);
    at(NOV1 - 15 * DAY); s.orders.setExpiry(owner, o4.assignmentIds[0], NOV1 + 15 * DAY);
    at(NOV1 + 4 * DAY); s.orders.setControl(owner, o4.assignmentIds[0], { price: 5000, payStatus: "pagado" });
    at(NOV1 + 5 * DAY); s.finance.addExpense(owner, 3000, "luz");
    at(NOW);
    const c = s.finance.monthClose(owner);
    assert.deepEqual([c.month, c.label, c.closed], ["2026-11", "noviembre 2026", false]);
    assert.equal(c.ingresos, s.finance.report(owner, 1).current.ingresos, "el mismo número que Finanzas");
    assert.deepEqual([c.ingresos, c.dePedidos, c.delControl], [6600 + 6600 + 5000, 13200, 5000]);
    assert.deepEqual([c.ventas, c.renovaciones, c.cobrosControl], [1, 1, 1]);
    assert.deepEqual([c.gastos, c.ganancia], [3000, 18200 - 3000]);
    assert.deepEqual([c.prev.key, c.prev.ingresos, c.prev.gastos, c.prev.ganancia], ["2026-10", 6600 + 3500, 2000, 8100]);
    assert.deepEqual([c.vs.ingresos, c.vs.ingresosPct], [18200 - 10100, 80]);
    assert.deepEqual(c.topPayers.map((p) => [p.name, p.kind, p.amount]), [["ARIt", "reseller", 18200]], "ARIt pagó todo noviembre");
    assert.equal(c.topApps[0].productId, "disney-alq"); assert.equal(c.topApps[0].ingresos, 18200);
    assert.equal(c.months[0].key, "2026-11"); assert.equal(c.months.length, 12);
    assert.ok(c.cuentasEstimado > 0 && c.gananciaEstimada === c.ganancia - c.cuentasEstimado, "el mes en curso trae el estimado de cuentas");
    // Octubre cerrado: sin estimado; su comparativa es contra septiembre.
    const oct = s.finance.monthClose(owner, "2026-10");
    assert.deepEqual([oct.closed, oct.ingresos, oct.cuentasEstimado, oct.prev.key], [true, 10100, 0, "2026-09"]);
    assert.equal(oct.start, boMonthStart(NOV1 - DAY)); assert.equal(oct.end, NOV1);
    assert.equal(s.finance.monthClose(owner, "2027-05").month, "2026-11", "un mes futuro vuelve al actual");
    assert.equal(s.finance.monthClose(owner, "cualquiera").month, "2026-11", "un mes mal escrito vuelve al actual");
    assert.throws(() => s.finance.monthClose(seller), err("FORBIDDEN"), "Atención no ve finanzas");
  });

  test("por la API: /api/admin/finance/cierre y su Excel (solo con sesión del dueño)", async () => {
    const dir = mkdtempSync(join(tmpdir(), "gs-fin9-"));
    const app = createApp({ dataDir: dir, jobs: false, log: () => {} });
    try {
      app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
      const base = `http://127.0.0.1:${await app.listen(0, "127.0.0.1")}`;
      const post = (p, body, ck) => fetch(base + p, { method: "POST", headers: { "content-type": "application/json", ...(ck ? { cookie: ck } : {}) }, body: JSON.stringify(body) });
      const ck = (await post("/api/auth/staff/login", { username: "gabriel", password: "clave-del-dueño-123" })).headers.get("set-cookie").split(";")[0];
      await post("/api/admin/products", { id: "nf", name: "Netflix", kind: "profile", durationDays: 30, price: 3500, published: true }, ck);
      await post("/api/admin/suppliers", { id: "andes", name: "Andes", active: true }, ck);
      await post("/api/admin/accounts", { productId: "nf", supplierId: "andes", email: "nf@x.lat", password: "Clave-Larga#1", supplierExpiresAt: Date.now() + 90 * DAY, cost: 2500, profiles: [{ label: "P1" }] }, ck);
      const ana = await (await post("/api/admin/customers", { name: "Ana", phone: "+59170000001" }, ck)).json();
      await post("/api/admin/orders", { customerId: ana.id, items: [{ productId: "nf", qty: 1 }], paymentMethod: "cash" }, ck);
      const r = await fetch(base + "/api/admin/finance/cierre", { headers: { cookie: ck } });
      assert.equal(r.status, 200);
      const d = await r.json();
      assert.equal(d.ingresos, 3500); assert.equal(d.topPayers[0].name, "Ana");
      const x = await fetch(base + `/api/admin/finance/cierre.xlsx?month=${d.month}`, { headers: { cookie: ck } });
      assert.equal(x.status, 200);
      assert.match(x.headers.get("content-disposition") ?? "", /cierre-\d{4}-\d{2}\.xlsx/);
      const buf = Buffer.from(await x.arrayBuffer());
      assert.equal(buf.subarray(0, 2).toString(), "PK", "es un .xlsx (zip)");
      assert.equal((await fetch(base + "/api/admin/finance/cierre")).status, 401);
    } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
  });
});
