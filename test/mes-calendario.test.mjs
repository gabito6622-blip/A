// «1 mes» es del mismo día al mismo día del mes siguiente (14/11/2026). El dueño: «Es de un mes: si vence el 12 de
// enero, siguiente mes es hasta el 12 de febrero». Antes se sumaban 30 días (vencía el 13/12 → nueva fecha 12/01).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { addPeriods, periodText } from "../dist/store/time.js";
import { createApp } from "../dist/server/app.js";

// 23:59 de Bolivia (UTC−4) del día d/m/y.
const bo = (y, m, d, h = 23, mi = 59) => Date.UTC(y, m - 1, d, h + 4, mi);
const dm = (t) => { const x = new Date(t - 4 * 3_600_000); return `${String(x.getUTCDate()).padStart(2, "0")}/${String(x.getUTCMonth() + 1).padStart(2, "0")}/${x.getUTCFullYear()}`; };

test("1 mes = mismo día del mes siguiente, a la misma hora de Bolivia", () => {
  assert.equal(dm(addPeriods(bo(2026, 12, 13), 30)), "13/01/2027", "el caso de oby: 13/12 → 13/01");
  assert.equal(dm(addPeriods(bo(2027, 1, 12), 30)), "12/02/2027", "el ejemplo del dueño");
  assert.equal(addPeriods(bo(2027, 1, 12), 30), bo(2027, 2, 12), "misma hora");
  assert.equal(dm(addPeriods(bo(2027, 1, 31), 30)), "28/02/2027", "si el día no existe, el último del mes");
  assert.equal(dm(addPeriods(bo(2028, 1, 31), 30)), "29/02/2028", "año bisiesto");
  assert.equal(dm(addPeriods(bo(2026, 11, 14), 90)), "14/02/2027", "3 meses");
  assert.equal(dm(addPeriods(bo(2026, 11, 14), 30, 3)), "14/02/2027", "3 períodos de 1 mes");
  assert.equal(addPeriods(bo(2026, 11, 14), 7), bo(2026, 11, 21), "los de 7 días siguen contando días");
  assert.equal(periodText(30), "1 mes"); assert.equal(periodText(90), "3 meses"); assert.equal(periodText(15), "15 días");
});

test("venta y renovación cuentan meses de calendario; el link de renovar dice «1 mes» y muestra el correo", async () => {
  const dir = mkdtempSync(join(tmpdir(), "gs-mes-"));
  const clock = { t: bo(2026, 12, 13, 10, 0), now() { return this.t; } };
  const app = createApp({ dataDir: dir, jobs: false, log: () => {}, clock });
  try {
    app.bootstrapOwner("gabriel", "Gabriel", "clave-del-dueño-123");
    const s = app.store, owner = { id: Object.keys(s.engine.s.staff)[0], role: "owner" };
    s.catalog.upsertProduct(owner, { id: "dis", name: "Disney Premium + ESPN (alquiler revendedores)", kind: "full_account", durationDays: 30, price: 6900, published: true });
    s.catalog.upsertSupplier(owner, { id: "a", name: "A", active: true });
    s.inventory.addAccount(owner, { productId: "dis", supplierId: "a", email: "ficticia+liz@x.lat", password: "Clave-Larga#1", supplierExpiresAt: bo(2027, 6, 1), cost: 0, profiles: [{ label: "Cuenta completa" }] });
    const c = s.catalog.createCustomer(owner, { name: "Oby Prueba", phone: "+59177000001" });
    const aid = s.orders.create(owner, { customerId: c.id, items: [{ productId: "dis", qty: 1 }], paymentMethod: "cash", idempotencyKey: "v" }).assignmentIds[0];
    assert.equal(dm(s.engine.s.assignments[aid].customerExpiresAt), "13/01/2027", "vendido el 13/12 → vence el 13/01");
    clock.t = bo(2027, 1, 10, 10, 0);
    s.orders.renew(owner, aid, { periods: 1, paymentMethod: "cash", idempotencyKey: "r1" });
    assert.equal(dm(s.engine.s.assignments[aid].customerExpiresAt), "13/02/2027", "renovado antes de vencer: del 13/01 al 13/02");
  } finally { await app.close(); rmSync(dir, { recursive: true, force: true }); }
});
