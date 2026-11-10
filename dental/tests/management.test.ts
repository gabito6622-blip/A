import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { allocate } from "../server/src/modules/management/common.js";
import { pairPunches, type Punch } from "../server/src/modules/management/timeclock.js";
import { previousPeriod } from "../server/src/modules/management/compare.js";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let F: TestClinic, G: TestClinic;
let owner: Agent, gOwner: Agent, rec: Agent, dent: Agent, acct: Agent, limitedAdmin: Agent, support: Agent;
let recId: string, dentId: string, supportId: string;
let P1: string, P2: string, P3: string;
const ZONE = "America/La_Paz";
const MONTH = "2026-03";
const B0 = () => F.branches[0]!, B1 = () => F.branches[1]!;
const q = (sql: string, p: unknown[] = []) => env.db.adminPool.query(sql, p);
const today = () => DateTime.now().setZone(ZONE).toISODate()!;
const thisMonth = () => DateTime.now().setZone(ZONE).toFormat("yyyy-MM");

async function xlsx(a: Agent, url: string) {
  const r = await env.app.inject({ method: "GET", url, headers: { cookie: a.cookie } });
  expect(r.statusCode, `${url}: ${r.body.slice(0, 200)}`).toBe(200);
  expect(String(r.headers["content-type"])).toContain("spreadsheetml");
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
  return wb;
}
/** Fila cuyo primer valor coincide (o contiene) el texto. */
function rowOf(ws: ExcelJS.Worksheet, first: string): unknown[] {
  let out: unknown[] | null = null;
  ws.eachRow((row) => { const v = row.values as unknown[]; if (!out && typeof v[1] === "string" && (v[1] as string).startsWith(first)) out = v.slice(1); });
  if (!out) throw new Error(`Sin fila «${first}» en ${ws.name}`);
  return out;
}

let charge = 0;
async function addCharge(branch: string, patient: string, amount: number, at: string, voids?: string) {
  return (await q(`INSERT INTO charges (clinic_id, branch_id, patient_id, dentist_id, description, amount_cents, voids_charge_id, created_by, created_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$4,$8) RETURNING id`, [F.clinicId, branch, patient, dentId, `Tratamiento ${++charge}`, amount, voids ?? null, at])).rows[0].id as string;
}
let receipt = 0;
async function addPayment(branch: string, patient: string, amount: number, method: string, status: string, receivedAt: string, verifiedAt: string | null) {
  receipt++;
  await q(`INSERT INTO payments (clinic_id, receipt_number, branch_id, patient_id, amount_cents, method, status, bank_reference, idempotency_key, received_by, received_at, verified_by, verified_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [F.clinicId, 9000 + receipt, branch, patient, amount, method, status, method === "cash" ? null : `REF-T-${receipt}`, `t-${receipt}`, dentId, receivedAt, verifiedAt ? dentId : null, verifiedAt]);
}

beforeAll(async () => {
  env = await setupEnv();
  F = await createClinic(env.db);
  G = await createClinic(env.db, { name: "Clínica G" });
  owner = await login(env.app, F.ownerEmail);
  gOwner = await login(env.app, G.ownerEmail);
  const r = await addUser(env.db, F.clinicId, "receptionist", { branchIds: [F.branches[0]!] });
  recId = r.id; rec = await login(env.app, r.email);
  const d = await addUser(env.db, F.clinicId, "dentist", { allBranches: true });
  dentId = d.id; dent = await login(env.app, d.email);
  acct = await login(env.app, (await addUser(env.db, F.clinicId, "accountant", { allBranches: true })).email);
  limitedAdmin = await login(env.app, (await addUser(env.db, F.clinicId, "admin", { branchIds: [F.branches[1]!] })).email);
  const s = await addUser(env.db, F.clinicId, "support", { branchIds: [F.branches[0]!] });
  supportId = s.id; support = await login(env.app, s.email);
  P1 = await createPatient(owner); P2 = await createPatient(owner); P3 = await createPatient(owner);
});
afterAll(async () => teardown(env));

describe("funciones puras", () => {
  it("reparte centavos sin perder ni inventar (mayor resto), con signo y sin base", () => {
    expect(allocate(45000, [100000, 50050, 20000])).toEqual([26463, 13245, 5292]);
    expect(allocate(1550, [60, 30, 0])).toEqual([1033, 517, 0]);
    expect(allocate(-100, [1, 1, 1])).toEqual([-34, -33, -33]);
    expect(allocate(100, [0, 0])).toBeNull();
    for (let i = 0; i < 200; i++) {
      const total = Math.floor(Math.random() * 1e7) - 3e6;
      const w = Array.from({ length: 1 + Math.floor(Math.random() * 6) }, () => Math.floor(Math.random() * 1000));
      const a = allocate(total, w);
      if (a) expect(a.reduce((s, x) => s + x, 0)).toBe(total);
    }
  });
  it("empareja marcas: turnos, salidas sin entrada, entradas abiertas y turnos demasiado largos", () => {
    const t = (h: number) => new Date(Date.UTC(2026, 2, 10, h));
    const p = (id: string, kind: "in" | "out", h: number, b = "b1"): Punch => ({ id, userId: "u", branchId: b, kind, at: t(h) });
    const r = pairPunches([p("1", "in", 12), p("2", "out", 20), p("3", "out", 21), p("4", "in", 22), p("5", "out", 23, "b2"), p("6", "in", 30), p("7", "out", 50)], t(60));
    expect(r.shifts.map((s) => s.minutes)).toEqual([480]);
    expect(r.issues.map((i) => i.type).sort()).toEqual(["branch_mismatch", "branch_mismatch", "missing_in", "too_long"]);
    const open = pairPunches([p("1", "in", 12)], t(14));
    expect(open.open).toHaveLength(1);
    expect(open.issues).toHaveLength(0);
    expect(pairPunches([p("1", "in", 12)], t(40)).issues[0]!.type).toBe("missing_out");
  });
  it("período anterior: meses completos → meses anteriores; si no, la misma cantidad de días", () => {
    expect(previousPeriod("2026-10-01", "2026-10-31")).toEqual({ from: "2026-09-01", to: "2026-09-30" });
    expect(previousPeriod("2026-01-01", "2026-03-31")).toEqual({ from: "2025-10-01", to: "2025-12-31" });
    expect(previousPeriod("2026-10-05", "2026-10-11")).toEqual({ from: "2026-09-28", to: "2026-10-04" });
  });
});

describe("gastos", () => {
  let confirmed: string, draft: string;
  it("registra un gasto confirmado y un borrador; valida monto, categoría y fecha", async () => {
    const r = await owner.post("/api/expenses", { branchId: B0(), category: "rent", description: "Alquiler local", amountCents: 650000, expenseDate: `${MONTH}-05`, supplier: "=HYPERLINK(\"x\")", receiptRef: "Factura 123" });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ state: "confirmed", amountCents: 650000, categoryLabel: "Alquiler" });
    confirmed = r.body.id;
    expect((await owner.post("/api/expenses", { branchId: B0(), category: "utilities", description: "Luz y agua", amountCents: 85075, expenseDate: `${MONTH}-20` })).status).toBe(200);
    draft = (await owner.post("/api/expenses", { branchId: B0(), category: "other", description: "Por confirmar", amountCents: 5000, expenseDate: `${MONTH}-25`, asDraft: true })).body.id;
    const bad = await owner.post("/api/expenses", { branchId: B0(), category: "rent", description: "x", amountCents: 0, expenseDate: `${MONTH}-05` });
    expect(bad.status).toBe(400);
    expect((await owner.post("/api/expenses", { branchId: B0(), category: "viajes", description: "Viaje", amountCents: 100, expenseDate: `${MONTH}-05` })).status).toBe(400);
    expect((await owner.post("/api/expenses", { branchId: B0(), category: "rent", description: "Alquiler", amountCents: 12.5, expenseDate: `${MONTH}-05` })).status).toBe(400);
    const future = DateTime.now().setZone(ZONE).plus({ days: 3 }).toISODate()!;
    const f = await owner.post("/api/expenses", { branchId: B0(), category: "rent", description: "Adelantado", amountCents: 100, expenseDate: future });
    expect(f.status).toBe(400);
    expect(f.body.error.details[0].path).toBe("expenseDate");
    // Idempotente
    const k = { branchId: B0(), category: "marketing", description: "Publicidad", amountCents: 10000, expenseDate: `${MONTH}-07`, idempotencyKey: "gasto-unico-123" };
    const a1 = await owner.post("/api/expenses", k), a2 = await owner.post("/api/expenses", k);
    expect(a1.body.id).toBe(a2.body.id);
  });

  it("anular pide motivo, es de solo inserción y no se repite; un confirmado no se edita", async () => {
    const mk = (await owner.get(`/api/expenses?month=${MONTH}&category=marketing`)).body.items[0];
    expect((await owner.post(`/api/expenses/${mk.id}/void`, { reason: "no" })).status).toBe(400);
    const v = await owner.post(`/api/expenses/${mk.id}/void`, { reason: "Se registró dos veces" });
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ state: "voided", voidReason: "Se registró dos veces" });
    expect((await owner.post(`/api/expenses/${mk.id}/void`, { reason: "Otra vez más" })).status).toBe(409);
    const put = await owner.put(`/api/expenses/${confirmed}`, { branchId: B0(), category: "rent", description: "Alquiler local", amountCents: 1, expenseDate: `${MONTH}-05` });
    expect(put.status).toBe(409);
    // Ni siquiera el dueño de la base modifica un gasto confirmado o una anulación
    await expect(q("UPDATE expenses SET amount_cents = 1 WHERE id = $1", [confirmed])).rejects.toThrow(/confirmado no se modifica/);
    await expect(q("DELETE FROM expenses WHERE id = $1", [confirmed])).rejects.toThrow(/no se eliminan/);
    await expect(q("UPDATE expense_voids SET reason = 'cambiado' WHERE expense_id = $1", [mk.id])).rejects.toThrow(/solo inserción/);
    await expect(q("UPDATE expenses SET description = 'cambiado' WHERE id = $1", [mk.id])).rejects.toThrow(/confirmado no se modifica/);
  });

  it("un borrador se edita y se confirma; luego ya no", async () => {
    const e = await owner.put(`/api/expenses/${draft}`, { branchId: B0(), category: "other", description: "Por confirmar (editado)", amountCents: 6000, expenseDate: `${MONTH}-25` });
    expect(e.status).toBe(200);
    expect(e.body.amountCents).toBe(6000);
    const list = (await owner.get(`/api/expenses?month=${MONTH}&branchId=${B0()}`)).body;
    expect(list.totals).toMatchObject({ confirmedCents: 735075, draftCount: 1, voidedCount: 1, draftCents: 6000 });
    // Se deja como borrador para la rentabilidad; otro borrador se confirma
    const d2 = (await owner.post("/api/expenses", { branchId: B1(), category: "other", description: "Borrador B1", amountCents: 700, expenseDate: "2026-02-10", asDraft: true })).body.id;
    expect((await owner.post(`/api/expenses/${d2}/confirm`)).body.state).toBe("confirmed");
    expect((await owner.post(`/api/expenses/${d2}/confirm`)).status).toBe(409);
  });

  it("recurrentes: generan borradores del mes sin duplicar, ni siquiera en paralelo", async () => {
    const mk = (branchId: string, desc: string, amountCents: number) => owner.post("/api/expenses/recurring", { branchId, category: "salaries", description: desc, amountCents, dayOfMonth: 5, startsMonth: "2026-01" });
    const t1 = (await mk(B0(), "Sueldo recepción", 380000)).body.id;
    await mk(B1(), "Sueldo recepción B1", 360000);
    expect((await owner.post("/api/expenses/recurring", { branchId: B0(), category: "rent", description: "Día inválido", amountCents: 1, dayOfMonth: 31, startsMonth: "2026-01" })).status).toBe(400);
    expect((await owner.get("/api/expenses?month=2026-01")).body.recurringPending).toBe(2);
    const runs = await Promise.all([1, 2, 3].map(() => owner.post("/api/expenses/recurring/generate", { month: "2026-01" })));
    expect(runs.map((r) => r.status)).toEqual([200, 200, 200]);
    expect(runs.reduce((s, r) => s + r.body.created, 0)).toBe(2);
    expect((await owner.post("/api/expenses/recurring/generate", { month: "2026-01" })).body.created).toBe(0);
    const jan = (await owner.get("/api/expenses?month=2026-01&status=draft")).body;
    expect(jan.recurringPending).toBe(0);
    const gen = jan.items.find((x: any) => x.recurringId === t1);
    expect(gen).toMatchObject({ expenseDate: "2026-01-05", state: "draft", amountCents: 380000 });
    // Anular el borrador de un mes no lo vuelve a generar
    expect((await owner.post(`/api/expenses/${gen.id}/void`, { reason: "No se pagó este mes" })).status).toBe(200);
    expect((await owner.post("/api/expenses/recurring/generate", { month: "2026-01" })).body.created).toBe(0);
    // Desactivar la plantilla: no genera más; los borradores existentes quedan
    expect((await owner.put(`/api/expenses/recurring/${t1}`, { category: "salaries", description: "Sueldo recepción", amountCents: 380000, dayOfMonth: 5, active: false })).status).toBe(200);
    expect((await owner.post("/api/expenses/recurring/generate", { month: "2026-02" })).body.created).toBe(1);
    // No se generan meses lejanos
    expect((await owner.post("/api/expenses/recurring/generate", { month: DateTime.now().plus({ months: 3 }).toFormat("yyyy-MM") })).status).toBe(400);
  });
});

describe("rentabilidad mensual (cuadra al centavo con datos sembrados)", () => {
  beforeAll(async () => {
    const [c00, c01] = F.chairs[0]!;
    // Citas atendidas (para atribuir producción y horas a cada sillón)
    await q(`INSERT INTO appointments (clinic_id, branch_id, chair_id, dentist_id, patient_id, starts_at, ends_at, status) VALUES
      ($1,$2,$3,$5,$6,'2026-03-10T13:00:00Z','2026-03-10T14:00:00Z','completed'),
      ($1,$2,$4,$5,$7,'2026-03-11T14:00:00Z','2026-03-11T14:30:00Z','completed')`, [F.clinicId, B0(), c00, c01, dentId, P1, P2]);
    // Producción
    await addCharge(B0(), P1, 100000, "2026-03-10T14:15:00Z");               // → Consultorio 1
    await addCharge(B0(), P2, 50050, "2026-03-11T15:00:00Z");                // → Consultorio 2
    await addCharge(B0(), P3, 20000, "2026-03-12T15:00:00Z");                // → sin sillón
    const toVoid = await addCharge(B0(), P1, 30000, "2026-03-10T15:00:00Z"); // → Consultorio 1
    await addCharge(B0(), P1, -30000, "2026-03-20T15:00:00Z", toVoid);       // anulación: sigue al original
    await addCharge(B0(), P1, 99999, "2026-03-01T03:30:00Z");                // 28-feb 23:30 en La Paz → febrero
    const chB1 = await addCharge(B1(), P1, 80000, "2026-03-15T15:00:00Z");
    await addCharge(B1(), P2, 1000, "2026-04-01T03:30:00Z");                 // 31-mar 23:30 en La Paz → marzo
    // Cobros
    await addPayment(B0(), P1, 70000, "cash", "confirmed", "2026-03-10T15:00:00Z", null);
    await addPayment(B0(), P1, 25025, "transfer", "confirmed", "2026-03-31T20:00:00Z", "2026-04-01T14:00:00Z"); // se confirma en abril
    await addPayment(B0(), P2, 11111, "qr", "pending_verification", "2026-03-15T15:00:00Z", null);
    await addPayment(B1(), P1, 40000, "qr", "confirmed", "2026-03-16T15:00:00Z", "2026-03-16T16:00:00Z");
    // Laboratorio
    const lab = (await q("INSERT INTO labs (clinic_id, name) VALUES ($1,'Lab Prueba') RETURNING id", [F.clinicId])).rows[0].id;
    let n = 0;
    const order = (branch: string, sent: string, received: string, cost: number) => q(
      `INSERT INTO lab_orders (clinic_id, number, lab_id, patient_id, dentist_id, branch_id, work_type, status, sent_on, received_on, cost_cents, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'crown','received',$7,$8,$9,$5)`, [F.clinicId, ++n, lab, P1, dentId, branch, sent, received, cost]);
    await order(B0(), "2026-03-01", "2026-03-05", 45000);
    await order(B1(), "2026-02-20", "2026-02-27", 9999);
    await order(B1(), "2026-03-10", "2026-03-20", 12345);
    // Inventario solo en la sucursal 0
    const item = (await q("INSERT INTO inv_items (clinic_id, sku, name, use_unit, purchase_unit) VALUES ($1,'RES-01','Resina','jeringa','caja') RETURNING id", [F.clinicId])).rows[0].id;
    await q("INSERT INTO inv_stock (clinic_id, item_id, branch_id) VALUES ($1,$2,$3)", [F.clinicId, item, B0()]);
    const lot = (await q("INSERT INTO inv_lots (clinic_id, item_id, branch_id) VALUES ($1,$2,$3) RETURNING id", [F.clinicId, item, B0()])).rows[0].id;
    const mv = (kind: string, qty: number, cost: number, at: string) => q(
      "INSERT INTO inv_movements (clinic_id, item_id, branch_id, lot_id, kind, qty, unit_cost, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [F.clinicId, item, B0(), lot, kind, qty, cost, at]);
    await mv("purchase", 10, 1234.5678, "2026-03-01T15:00:00Z");
    await mv("consumption", -3, 1234.5678, "2026-03-10T15:00:00Z");
    await mv("consumption", -0.5, 1000, "2026-03-11T15:00:00Z");
    await mv("consumption", -1, 1000, "2026-04-02T15:00:00Z"); // abril
    // Honorarios: liquidación cerrada de marzo
    const st = (await q("INSERT INTO fee_settlements (clinic_id, dentist_id, period_start, period_end, created_by) VALUES ($1,$2,'2026-03-01','2026-03-31',$3) RETURNING id", [F.clinicId, dentId, F.ownerId])).rows[0].id;
    const ch1 = (await q("SELECT id FROM charges WHERE clinic_id = $1 AND amount_cents = 100000", [F.clinicId])).rows[0].id;
    for (const [br, chg, fee] of [[B0(), ch1, 35000], [B1(), chB1, 28000]] as const) {
      await q(`INSERT INTO fee_settlement_lines (clinic_id, settlement_id, kind, branch_id, charge_id, occurred_at, description, base_cents, fee_cents)
               VALUES ($1,$2,'production',$3,$4,'2026-03-10T15:00:00Z','x',100000,$5)`, [F.clinicId, st, br, chg, fee]);
    }
    await q(`UPDATE fee_settlements SET status = 'closed', base = 'production', base_total_cents = 180000, fee_total_cents = 63000, adjustments_cents = 0,
             total_cents = 63000, line_count = 2, closed_by = $2, closed_at = now() WHERE id = $1`, [st, F.ownerId]);
    // Gasto menor de caja en la sucursal 0
    const ses = (await q("INSERT INTO cash_sessions (clinic_id, number, branch_id, cashier_id, opening_float_cents, opened_at) VALUES ($1,1,$2,$3,0,'2026-03-10T12:00:00Z') RETURNING id", [F.clinicId, B0(), dentId])).rows[0].id;
    await q("INSERT INTO cash_movements (clinic_id, session_id, kind, category, amount_cents, reason, created_by, created_at) VALUES ($1,$2,'out','petty_expense',1550,'Agua',$3,'2026-03-10T16:00:00Z')", [F.clinicId, ses, dentId]);
  });

  it("cada concepto por sucursal, el margen y el consolidado", async () => {
    const r = await owner.get(`/api/management/profitability?month=${MONTH}`);
    expect(r.status).toBe(200);
    const b0 = r.body.branches.find((b: any) => b.branchId === B0());
    const b1 = r.body.branches.find((b: any) => b.branchId === B1());
    expect(b0).toMatchObject({
      productionCents: 170050, collectedCents: 70000, labCents: 45000, materialsCents: 4204, feesCents: 35000, pettyCashCents: 1550, expensesCents: 735075,
      marginCents: 170050 - 820829, cashMarginCents: 70000 - 820829, complete: true, missing: [], draftExpenses: 1, unsettledProfessionals: 0,
    });
    expect(b0.expensesByCategory).toEqual([{ category: "rent", label: "Alquiler", amountCents: 650000 }, { category: "utilities", label: "Servicios básicos", amountCents: 85075 }]);
    // Sucursal 1: sin inventario, sin cajas y sin gastos del mes → «sin datos», no cero
    expect(b1).toMatchObject({ productionCents: 81000, collectedCents: 40000, labCents: 12345, materialsCents: null, feesCents: 28000, pettyCashCents: null, expensesCents: null,
      marginCents: 81000 - 40345, complete: false });
    expect(b1.missing.sort()).toEqual(["expensesCents", "materialsCents", "pettyCashCents"]);
    expect(r.body.total).toMatchObject({ productionCents: 251050, collectedCents: 110000, labCents: 57345, materialsCents: 4204, feesCents: 63000, marginCents: 170050 - 820829 + 40655, complete: false });
    // Comparación con febrero (producción de febrero en la sucursal 0: 99.999)
    expect(r.body.previous.month).toBe("2026-02");
    expect(b0.variation.productionPct).toBe(70.1);
    expect(r.body.sources.labCents).toMatch(/Laboratorio/);
  });

  it("por sillón: atribución por cita y reparto exacto (la suma de los sillones es la sucursal)", async () => {
    const b0 = (await owner.get(`/api/management/profitability?month=${MONTH}&branchId=${B0()}`)).body.branches[0];
    const ch = b0.chairs as any[];
    expect(ch.map((x) => [x.chairName, x.productionCents, x.attendedMinutes])).toEqual([
      ["Consultorio 1", 100000, 60], ["Consultorio 2", 50050, 30], ["Sin sillón identificado", 20000, 0],
    ]);
    for (const k of ["productionCents", "labCents", "materialsCents", "feesCents", "pettyCashCents", "expensesCents", "marginCents"]) {
      expect(ch.reduce((s, x) => s + x[k], 0), k).toBe(b0[k]);
    }
    expect(ch[0]).toMatchObject({ labCents: 26463, pettyCashCents: 1033, expensesCents: 490050, productionPerHourCents: 100000 });
    expect(ch[2].expensesCents).toBe(0);
    // Sucursal sin datos de materiales: también «sin datos» en cada sillón
    const b1 = (await owner.get(`/api/management/profitability?month=${MONTH}&branchId=${B1()}`)).body.branches[0];
    expect(b1.chairs.every((x: any) => x.materialsCents === null)).toBe(true);
    expect(b1.chairs.reduce((s: number, x: any) => s + x.marginCents, 0)).toBe(b1.marginCents);
  });

  it("la exportación a Excel tiene los mismos totales que la pantalla", async () => {
    const d = (await owner.get(`/api/management/profitability?month=${MONTH}`)).body;
    const wb = await xlsx(owner, `/api/management/profitability.xlsx?month=${MONTH}`);
    const ws = wb.getWorksheet("Por sucursal")!;
    const prod = rowOf(ws, "Producción");
    expect(prod.slice(1, 4)).toEqual([1700.5, 810, 2510.5]);
    const mat = rowOf(ws, "Costo de materiales");
    expect(mat[2] ?? null).toBeNull(); // sin datos en la sucursal 1: celda vacía
    expect(rowOf(ws, "Margen (sobre producción)")[3]).toBe(d.total.marginCents / 100);
    const chairs = wb.getWorksheet("Por sillón")!;
    expect(rowOf(chairs, "Total")[10]).toBe(d.total.marginCents / 100);
    expect(rowOf(wb.getWorksheet("Gastos por categoría")!, "Total")[2]).toBe(d.total.expensesCents / 100);
    // El proveedor con fórmula se exporta como texto
    const ex = await xlsx(owner, `/api/expenses.xlsx?month=${MONTH}&branchId=${B0()}`);
    const rows: unknown[] = [];
    ex.getWorksheet("Gastos")!.eachRow((row) => rows.push(...(row.values as unknown[])));
    expect(rows).toContain("'=HYPERLINK(\"x\")");
    expect(rowOf(ex.getWorksheet("Por categoría")!, "Total")[1]).toBe(7350.75);
  });

  it("una clínica sin laboratorio, inventario ni liquidaciones muestra «sin datos»", async () => {
    const r = (await gOwner.get(`/api/management/profitability?month=${MONTH}`)).body;
    expect(r.branches.every((b: any) => b.labCents === null && b.materialsCents === null && b.feesCents === null && b.expensesCents === null)).toBe(true);
    expect(r.total.productionCents).toBe(0);
  });
});

describe("fichaje", () => {
  it("sin la opción activa no se ficha; gerencia la activa", async () => {
    expect((await rec.get("/api/timeclock/me")).body.enabled).toBe(false);
    expect((await rec.post("/api/timeclock/punch", { branchId: B0(), kind: "in" })).status).toBe(403);
    expect((await rec.put(`/api/timeclock/staff/${recId}`, { enabled: true })).status).toBe(403);
    expect((await owner.put(`/api/timeclock/staff/${recId}`, { enabled: true })).status).toBe(200);
    expect((await owner.put(`/api/timeclock/staff/${supportId}`, { enabled: true })).status).toBe(200);
    // Un administrador de otra sucursal no activa a quien no trabaja en ella
    expect((await limitedAdmin.put(`/api/timeclock/staff/${recId}`, { enabled: true })).status).toBe(403);
    const staff = (await owner.get("/api/timeclock/staff")).body;
    expect(staff.find((s: any) => s.userId === recId).enabled).toBe(true);
  });

  it("entrada y salida con la hora del servidor, en orden y en la misma sucursal", async () => {
    const i = await rec.post("/api/timeclock/punch", { branchId: B0(), kind: "in" });
    expect(i.status).toBe(200);
    expect(i.body.open.branchId).toBe(B0());
    expect((await rec.post("/api/timeclock/punch", { branchId: B0(), kind: "in" })).body.error.code).toBe("already_in");
    expect((await rec.post("/api/timeclock/punch", { branchId: B1(), kind: "out" })).status).toBe(403); // no es su sucursal
    const o = await rec.post("/api/timeclock/punch", { branchId: B0(), kind: "out" });
    expect(o.status).toBe(200);
    expect(o.body.open).toBeNull();
    expect(o.body.todayEntries.map((e: any) => e.kind)).toEqual(["in", "out"]);
    expect((await rec.post("/api/timeclock/punch", { branchId: B0(), kind: "out" })).body.error.code).toBe("not_in");
    // Personal de limpieza también ficha (permiso para todos los roles)
    expect((await support.post("/api/timeclock/punch", { branchId: B0(), kind: "in" })).status).toBe(200);
  });

  it("las marcas no se editan ni se borran, y una marca propia no se antedata", async () => {
    const e = (await q("SELECT id FROM time_entries WHERE user_id = $1 LIMIT 1", [recId])).rows[0].id;
    await expect(q("UPDATE time_entries SET at = at - interval '1 hour' WHERE id = $1", [e])).rejects.toThrow(/solo inserción/);
    await expect(q("DELETE FROM time_entries WHERE id = $1", [e])).rejects.toThrow(/solo inserción/);
    await expect(withTenant(env.db.appPool, { clinicId: F.clinicId, userId: recId }, (c) => c.query("UPDATE time_entries SET at = now() WHERE id = $1", [e]))).rejects.toThrow(/permission denied|solo inserción/);
    await expect(withTenant(env.db.appPool, { clinicId: F.clinicId, userId: recId }, (c) => c.query(
      "INSERT INTO time_entries (clinic_id, user_id, branch_id, kind, at, source, recorded_by) VALUES ($1,$2,$3,'in', now() - interval '3 hours','self',$2)", [F.clinicId, recId, B0()]))).rejects.toThrow(/check constraint/);
  });

  it("gerencia corrige con motivo (marca nueva o anulación) y el informe del mes lo refleja", async () => {
    // Mes anterior (día 3): no se mezcla con las marcas de hoy, sea cual sea la fecha
    const prevStart = DateTime.now().setZone(ZONE).startOf("month").minus({ months: 1 });
    const month = prevStart.toFormat("yyyy-MM");
    const start = prevStart.plus({ days: 2, hours: 8 });
    // Turno olvidado: agrega entrada y salida de 8 h el primer día del mes
    expect((await rec.post("/api/timeclock/corrections", { userId: recId, branchId: B0(), kind: "in", at: start.toISO(), reason: "Olvidó marcar" })).status).toBe(403);
    expect((await owner.post("/api/timeclock/corrections", { userId: recId, branchId: B0(), kind: "in", at: start.toISO(), reason: "x" })).status).toBe(400);
    expect((await owner.post("/api/timeclock/corrections", { userId: recId, branchId: B0(), kind: "in", at: DateTime.now().plus({ days: 1 }).toISO(), reason: "Hora futura" })).status).toBe(400);
    expect((await owner.post("/api/timeclock/corrections", { userId: recId, branchId: B0(), kind: "in", at: start.toISO(), reason: "Olvidó marcar la entrada" })).status).toBe(200);
    const out = await owner.post("/api/timeclock/corrections", { userId: recId, branchId: B0(), kind: "out", at: start.plus({ hours: 8 }).toISO(), reason: "Olvidó marcar la salida" });
    expect(out.status).toBe(200);
    // Una salida equivocada se anula (queda la original y la anulación)
    const wrong = await owner.post("/api/timeclock/corrections", { userId: recId, branchId: B0(), kind: "out", at: start.plus({ hours: 9 }).toISO(), reason: "Marca equivocada" });
    expect((await owner.post(`/api/timeclock/entries/${wrong.body.id}/void`, { reason: "Se cargó por error" })).status).toBe(200);
    expect((await owner.post(`/api/timeclock/entries/${wrong.body.id}/void`, { reason: "Se cargó por error" })).status).toBe(409);
    const rep = (await owner.get(`/api/timeclock/report?month=${month}&branchId=${B0()}`)).body;
    const row = rep.rows.find((x: any) => x.userId === recId);
    expect(row).toMatchObject({ minutes: 480, shifts: 1, days: 1, hours: 8, issues: 0 });
    const entries = (await acct.get(`/api/timeclock/entries?month=${month}`)).body.items;
    expect(entries.find((x: any) => x.id === wrong.body.id).voidReason).toBe("Se cargó por error");
    // Exportación con los mismos totales
    const wb = await xlsx(owner, `/api/timeclock/report.xlsx?month=${month}&branchId=${B0()}`);
    expect(rowOf(wb.getWorksheet("Horas")!, "Total")[5]).toBe(rep.totals.hours);
  });
});

describe("permisos", () => {
  it("recepción y odontólogo no ven gastos, rentabilidad ni el informe de horas", async () => {
    for (const a of [rec, dent, support]) {
      for (const u of [`/api/expenses?month=${MONTH}`, `/api/management/profitability?month=${MONTH}`, "/api/expenses/recurring", `/api/timeclock/report?month=${MONTH}`,
        `/api/management/profitability.xlsx?month=${MONTH}`, `/api/expenses.xlsx?month=${MONTH}`, "/api/reports/receivables.xlsx", "/api/fees/branch-results.xlsx"]) {
        expect((await a.get(u)).status, u).toBe(403);
      }
      expect((await a.post("/api/expenses", { branchId: B0(), category: "rent", description: "Alquiler", amountCents: 100, expenseDate: `${MONTH}-05` })).status).toBe(403);
    }
    // Contabilidad sí ve y registra gastos y rentabilidad
    expect((await acct.get(`/api/management/profitability?month=${MONTH}`)).status).toBe(200);
    expect((await acct.post("/api/timeclock/corrections", { userId: recId, branchId: B0(), kind: "in", at: DateTime.now().minus({ hours: 2 }).toISO(), reason: "No puede corregir" })).status).toBe(403);
  });

  it("un administrador de una sucursal solo ve y escribe en la suya", async () => {
    const r = (await limitedAdmin.get(`/api/management/profitability?month=${MONTH}`)).body;
    expect(r.branches.map((b: any) => b.branchId)).toEqual([B1()]);
    expect((await limitedAdmin.get(`/api/management/profitability?month=${MONTH}&branchId=${B0()}`)).status).toBe(403);
    expect((await limitedAdmin.post("/api/expenses", { branchId: B0(), category: "rent", description: "Alquiler", amountCents: 100, expenseDate: `${MONTH}-05` })).status).toBe(403);
    const list = (await limitedAdmin.get(`/api/expenses?month=${MONTH}`)).body;
    expect(list.items.every((x: any) => x.branchId === B1())).toBe(true);
  });
});

describe("aislamiento entre clínicas en las tablas nuevas", () => {
  it("API: otra clínica no ve ni anula gastos ni marcas", async () => {
    const e = (await owner.get(`/api/expenses?month=${MONTH}`)).body.items[0];
    expect((await gOwner.get(`/api/expenses?month=${MONTH}`)).body.items).toHaveLength(0);
    expect((await gOwner.post(`/api/expenses/${e.id}/void`, { reason: "Intento ajeno" })).status).toBe(404);
    expect((await gOwner.post(`/api/expenses/${e.id}/confirm`)).status).toBe(404);
    // Sucursal de otra clínica: la FK compuesta lo rechaza
    expect((await gOwner.post("/api/expenses", { branchId: B0(), category: "rent", description: "Alquiler", amountCents: 100, expenseDate: `${MONTH}-05` })).status).toBe(400);
    const t = (await q("SELECT id FROM time_entries WHERE clinic_id = $1 AND kind <> 'void' LIMIT 1", [F.clinicId])).rows[0].id;
    expect((await gOwner.post(`/api/timeclock/entries/${t}/void`, { reason: "Intento ajeno" })).status).toBe(404);
    expect((await gOwner.post("/api/timeclock/corrections", { userId: recId, branchId: G.branches[0], kind: "in", at: DateTime.now().minus({ hours: 1 }).toISO(), reason: "Persona ajena" })).status).toBe(404);
    expect((await gOwner.put(`/api/timeclock/staff/${recId}`, { enabled: false })).status).toBe(404);
    expect((await gOwner.get(`/api/timeclock/report?month=${thisMonth()}`)).body.rows).toHaveLength(0);
  });

  it("SQL: con el contexto de otra clínica no se lee nada y no se inserta con un clinic_id ajeno", async () => {
    for (const t of ["expenses", "expense_voids", "expense_recurring", "timeclock_staff", "time_entries"]) {
      const n = await withTenant(env.db.appPool, { clinicId: G.clinicId, userId: G.ownerId }, (c) => c.query(`SELECT count(*)::int AS n FROM ${t}`));
      expect(n.rows[0].n, t).toBe(0);
      const own = await withTenant(env.db.appPool, { clinicId: F.clinicId, userId: F.ownerId }, (c) => c.query(`SELECT count(*)::int AS n FROM ${t}`));
      expect(own.rows[0].n, t).toBeGreaterThan(0);
    }
    await expect(withTenant(env.db.appPool, { clinicId: G.clinicId, userId: G.ownerId }, (c) => c.query(
      "INSERT INTO expenses (clinic_id, branch_id, category, description, amount_cents, expense_date, created_by, status) VALUES ($1,$2,'rent','Ajeno',100,'2026-03-01',$3,'draft')",
      [F.clinicId, B0(), G.ownerId]))).rejects.toThrow(/row-level security/);
    // FK compuesta: una fila de G no apunta a una sucursal de F (aunque se use el pool de administración)
    await expect(q("INSERT INTO expenses (clinic_id, branch_id, category, description, amount_cents, expense_date, created_by, status) VALUES ($1,$2,'rent','Cruzado',100,'2026-03-01',$3,'draft')",
      [G.clinicId, B0(), G.ownerId])).rejects.toThrow(/foreign key/);
    await expect(q("INSERT INTO time_entries (clinic_id, user_id, branch_id, kind, source, reason, recorded_by) VALUES ($1,$2,$3,'in','manager','Cruzado entre clínicas',$4)",
      [G.clinicId, recId, G.branches[0], G.ownerId])).rejects.toThrow(/foreign key/);
  });
});

describe("panel con rango libre y exportaciones de los informes existentes", () => {
  it("compara con el período anterior y da la variación % por sucursal", async () => {
    const r = await owner.get(`/api/reports/dashboard-compare?from=${MONTH}-01&to=${MONTH}-31`);
    expect(r.status).toBe(200);
    expect(r.body.previousRange).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    const b0 = r.body.branches.find((b: any) => b.branchId === B0());
    expect(b0.current.productionCents).toBe(170050);
    expect(b0.previous.productionCents).toBe(99999);
    expect(b0.variation.productionPct).toBe(70.1);
    const b1 = r.body.branches.find((b: any) => b.branchId === B1());
    expect(b1.variation.productionPct).toBeNull(); // febrero en cero: sin base
    // Rango libre de días
    const w = (await owner.get(`/api/reports/dashboard-compare?from=${MONTH}-10&to=${MONTH}-16`)).body;
    expect(w.previousRange).toEqual({ from: "2026-03-03", to: "2026-03-09" });
    // Recepción ve la comparación operativa sin montos; contabilidad usa la financiera
    const rr = (await rec.get(`/api/reports/dashboard-compare?from=${MONTH}-01&to=${MONTH}-31`)).body;
    expect(rr.financial).toBe(false);
    expect(rr.branches[0].current.productionCents).toBeUndefined();
    expect((await acct.get(`/api/reports/finance-dashboard-compare?from=${MONTH}-01&to=${MONTH}-31`)).status).toBe(200);
    expect((await acct.get(`/api/reports/dashboard-compare?from=${MONTH}-01&to=${MONTH}-31`)).status).toBe(403);
  });

  it("panel, producción, cuentas por cobrar y resultado por sucursal: los totales del Excel = pantalla", async () => {
    const d = (await owner.get(`/api/reports/dashboard?from=${MONTH}-01&to=${MONTH}-31`)).body;
    const wb = await xlsx(owner, `/api/reports/dashboard.xlsx?from=${MONTH}-01&to=${MONTH}-31`);
    const tot = rowOf(wb.getWorksheet("Panel por sucursal")!, "Total");
    expect(tot.slice(1, 3)).toEqual([d.totals.collectedCents / 100, d.totals.productionCents / 100]);
    expect(rowOf(wb.getWorksheet("Comparación")!, "Sucursal 1")[4]).toBe(1700.5);
    // Recepción exporta el panel operativo (sin columnas de dinero)
    const wr = await xlsx(rec, `/api/reports/dashboard.xlsx?from=${MONTH}-01&to=${MONTH}-31`);
    expect(rowOf(wr.getWorksheet("Panel por sucursal")!, "Sucursal").includes("Cobrado (Bs)")).toBe(false);

    const prod = (await owner.get(`/api/reports/production-by-dentist?from=${MONTH}-01&to=${MONTH}-31`)).body;
    const wp = await xlsx(owner, `/api/reports/production-by-dentist.xlsx?from=${MONTH}-01&to=${MONTH}-31`);
    expect(rowOf(wp.getWorksheet("Producción")!, "Total")[2]).toBe(prod.reduce((s: number, x: any) => s + Number(x.productionCents), 0) / 100);

    const rec2 = (await owner.get("/api/reports/receivables")).body;
    const wrc = await xlsx(owner, "/api/reports/receivables.xlsx");
    expect(rowOf(wrc.getWorksheet("Cuentas por cobrar")!, "Total")[2]).toBe(Math.round(rec2.reduce((s: number, x: any) => s + Number(x.balanceCents), 0)) / 100);
    expect(rec2.length).toBeGreaterThan(0);

    const br = (await owner.get(`/api/fees/branch-results?from=${MONTH}-01&to=${MONTH}-31`)).body;
    const wbr = await xlsx(owner, `/api/fees/branch-results.xlsx?from=${MONTH}-01&to=${MONTH}-31`);
    const res = rowOf(wbr.getWorksheet("Resultado")!, "Resultado (");
    expect(res[3]).toBe(br.total.resultCents / 100);
    expect(rowOf(wbr.getWorksheet("Resultado")!, "Honorarios")[3]).toBe(630);
  });

  it("controles, embudo, cajas, stock y pacientes sin próxima cita se exportan con los mismos filtros", async () => {
    const rc = (await owner.get(`/api/recalls?branchId=${B0()}&status=all`)).body;
    const wrc = await xlsx(owner, `/api/recalls.xlsx?branchId=${B0()}&status=all`);
    expect(rowOf(wrc.getWorksheet("Controles")!, "Total")[0]).toBe(`Total: ${rc.items.length}`);
    // Recepción de otra sucursal: el filtro por sucursal ajena se rechaza igual que en la pantalla
    expect((await env.app.inject({ method: "GET", url: `/api/recalls.xlsx?branchId=${B1()}`, headers: { cookie: rec.cookie } })).statusCode).toBe(403);

    const fun = (await owner.get("/api/budget-funnel?days=90")).body;
    const wf = await xlsx(owner, "/api/budget-funnel.xlsx?days=90");
    expect(rowOf(wf.getWorksheet("Conversión")!, "Presentados")[1]).toBe(fun.conversion.presented);

    const cs = (await owner.get(`/api/cash-sessions?branchId=${B0()}`)).body;
    const wcs = await xlsx(owner, `/api/cash-sessions.xlsx?branchId=${B0()}`);
    expect(rowOf(wcs.getWorksheet("Cajas")!, "Total")[6]).toBe(cs.reduce((s: number, x: any) => s + Number(x.openingFloatCents), 0) / 100);
    expect(cs.length).toBe(1);

    const stock = (await owner.get(`/api/inventory/stock?branchId=${B0()}`)).body;
    const ws = await xlsx(owner, `/api/inventory/stock.xlsx?branchId=${B0()}`);
    expect(rowOf(ws.getWorksheet("Stock")!, "Total")[8]).toBe(stock.items.reduce((s: number, x: any) => s + Number(x.valueCents), 0) / 100);
    expect(rowOf(ws.getWorksheet("Stock")!, "RES-01")[4]).toBe(5.5);

    const nn = (await owner.get("/api/reports/patients-without-next-appointment?months=36")).body;
    const wn = await xlsx(owner, "/api/reports/patients-without-next-appointment.xlsx?months=36");
    const total = nn.reduce((s: number, d: any) => s + d.patients, 0);
    expect(rowOf(wn.getWorksheet("Por profesional")!, "Total")[1]).toBe(total);
    expect(wn.getWorksheet("Pacientes")!.rowCount - 1).toBe(total);

    // Cada exportación queda en la auditoría
    const audits = (await q("SELECT entity FROM audit_log WHERE clinic_id = $1 AND action = 'report.exported'", [F.clinicId])).rows.map((r) => r.entity);
    for (const e of ["recalls", "budget_funnel", "cash_sessions", "inventory_stock", "receivables", "dashboard", "profitability", "expenses", "timeclock"]) expect(audits, e).toContain(e);
  });
});

void today;
