import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { allocate, feeFor } from "../server/src/modules/fees.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let F: TestClinic, G: TestClinic;
let owner: Agent, acct: Agent, rec: Agent, d1A: Agent, d2A: Agent, gOwner: Agent, limitedAdmin: Agent;
let d1: { id: string }, d2: { id: string };
let patient: string;
const ZONE = "America/La_Paz";
const now = DateTime.now().setZone(ZONE);
const month = (k: number) => {
  const s = now.minus({ months: k }).startOf("month");
  return { start: s.toISODate()!, end: s.endOf("month").toISODate()!, at: (day: number, hour = 12) => s.set({ day, hour }).toJSDate() };
};
const P1 = month(2), P2 = month(1), P0 = month(3);
const B0 = () => F.branches[0]!, B1 = () => F.branches[1]!;
let seq = 1000;

/** Presupuesto aceptado con ítems; los marcados `doneAt` generan su cargo con esa fecha (datos históricos). */
async function budget(dentistId: string, items: { code: string; price: number; qty?: number; doneAt?: Date; branch?: string }[], branch = B0()) {
  const q = (sql: string, p: unknown[]) => env.db.adminPool.query(sql, p);
  const b = (await q(`INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status) VALUES ($1,$2,$3,$4,$5,'accepted') RETURNING id`,
    [F.clinicId, ++seq, branch, patient, dentistId])).rows[0].id as string;
  const charges: string[] = [];
  for (const it of items) {
    const pid = await procedureId(env.db, F.clinicId, it.code);
    const item = (await q(`INSERT INTO budget_items (clinic_id, budget_id, procedure_id, description, quantity, unit_price_cents, status, performed_by, performed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [F.clinicId, b, pid, it.code, it.qty ?? 1, it.price, it.doneAt ? "done" : "pending", it.doneAt ? dentistId : null, it.doneAt ?? null])).rows[0].id;
    if (it.doneAt) {
      charges.push((await q(`INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, dentist_id, description, amount_cents, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$5,$8) RETURNING id`, [F.clinicId, it.branch ?? branch, patient, item, dentistId, it.code, it.price * (it.qty ?? 1), it.doneAt])).rows[0].id);
    }
  }
  return { id: b, charges };
}
async function payment(budgetId: string | null, amount: number, receivedAt: Date, opts: { status?: string; verifiedAt?: Date; method?: string; branch?: string } = {}) {
  const r = await env.db.adminPool.query(
    `INSERT INTO payments (clinic_id, receipt_number, branch_id, patient_id, budget_id, amount_cents, method, status, bank_reference, idempotency_key, received_by, received_at, verified_by, verified_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
    [F.clinicId, ++seq, opts.branch ?? B0(), patient, budgetId, amount, opts.method ?? "cash", opts.status ?? "confirmed", (opts.method ?? "cash") === "cash" ? null : `T-${seq}`,
      randomUUID(), F.ownerId, receivedAt, opts.status === "pending_verification" ? null : F.ownerId, opts.status === "pending_verification" ? null : opts.verifiedAt ?? receivedAt]);
  return r.rows[0].id as string;
}

let A: { charges: string[] }, voidedInPeriod: string, Y: string;
beforeAll(async () => {
  env = await setupEnv();
  F = await createClinic(env.db);
  G = await createClinic(env.db, { name: "Clínica G" });
  owner = await login(env.app, F.ownerEmail);
  gOwner = await login(env.app, G.ownerEmail);
  acct = await login(env.app, (await addUser(env.db, F.clinicId, "accountant", { allBranches: true })).email);
  rec = await login(env.app, (await addUser(env.db, F.clinicId, "receptionist", { branchIds: [F.branches[0]!] })).email);
  limitedAdmin = await login(env.app, (await addUser(env.db, F.clinicId, "admin", { branchIds: [F.branches[0]!] })).email);
  const u1 = await addUser(env.db, F.clinicId, "dentist", { allBranches: true, commissionPct: 40 });
  const u2 = await addUser(env.db, F.clinicId, "dentist", { allBranches: true });
  d1 = u1; d2 = u2;
  d1A = await login(env.app, u1.email);
  d2A = await login(env.app, u2.email);
  patient = await createPatient(owner);

  // D1 (producción) — período P1
  A = await budget(d1.id, [{ code: "OPE-01", price: 25000, doneAt: P1.at(3) }]);
  await budget(d1.id, [
    { code: "END-01", price: 90000, doneAt: P1.at(4) },
    { code: "PRO-01", price: 250000, doneAt: P1.at(5) },
    { code: "OPE-01", price: 33333, doneAt: P1.at(6), branch: B1() },
    { code: "PRE-03", price: 9001, qty: 3, doneAt: P1.at(7) },
  ]);
  const v = await budget(d1.id, [{ code: "OPE-02", price: 35000, doneAt: P1.at(8) }]);
  voidedInPeriod = v.charges[0]!;
  await env.db.adminPool.query(`INSERT INTO charges (clinic_id, branch_id, patient_id, description, amount_cents, voids_charge_id, created_by, created_at)
     VALUES ($1,$2,$3,'Anulación: error',-35000,$4,$5,$6)`, [F.clinicId, B0(), patient, voidedInPeriod, F.ownerId, P1.at(9)]);
  await budget(d1.id, [{ code: "OPE-01", price: 10001, doneAt: P2.at(10) }]); // P2
  const d1b = await budget(d1.id, [{ code: "CON-01", price: 7000 }]);
  await payment(d1b.id, 7000, P1.at(11)); // cobro de un presupuesto de D1: no es de D2

  // D2 (cobrado) — período P1
  const x = await budget(d2.id, [{ code: "ORT-01", price: 30000 }, { code: "OPE-01", price: 10000 }]);
  await payment(x.id, 10001, P1.at(12));
  const z = await budget(d2.id, [{ code: "CON-01", price: 20000 }]);
  Y = await payment(z.id, 20000, P0.at(28), { method: "transfer", verifiedAt: P1.at(5) }); // recibido antes, confirmado en P1
  await payment(z.id, 1500, P1.at(13), { method: "qr", status: "pending_verification" }); // sin confirmar: no cuenta
  await payment(null, 5000, P1.at(14)); // sin presupuesto: no se atribuye
});
afterAll(async () => teardown(env));

describe("cálculo (funciones puras)", () => {
  it("porcentaje redondea al centavo, el fijo es por unidad y el laboratorio se descuenta antes", () => {
    expect(feeFor(33333, 1, { category: null, mode: "percent", percentBp: 4000, fixedCents: null, deductCents: 0 }).feeCents).toBe(13333);
    expect(feeFor(10001, 1, { category: null, mode: "percent", percentBp: 3550, fixedCents: null, deductCents: 0 }).feeCents).toBe(3550); // 3550,355
    expect(feeFor(1, 1, { category: null, mode: "percent", percentBp: 5000, fixedCents: null, deductCents: 0 }).feeCents).toBe(1); // 0,5 → 1
    expect(feeFor(27003, 3, { category: null, mode: "fixed", percentBp: null, fixedCents: 3000, deductCents: 0 }).feeCents).toBe(9000);
    expect(feeFor(250000, 1, { category: null, mode: "percent", percentBp: 5000, fixedCents: null, deductCents: 50000 })).toEqual({ feeCents: 100000, deductCents: 50000 });
    expect(feeFor(100, 1, { category: null, mode: "percent", percentBp: 5000, fixedCents: null, deductCents: 500 })).toEqual({ feeCents: 0, deductCents: 100 });
  });
  it("el reparto proporcional no pierde centavos", () => {
    expect(allocate(10001, [10000, 30000])).toEqual([2500, 7501]);
    expect(allocate(100, [1, 1, 1])).toEqual([34, 33, 33]);
    const big = allocate(999_999_999, [999_999_937, 3, 999_999_929]);
    expect(big.reduce((s, x) => s + x, 0)).toBe(999_999_999);
  });
});

describe("reglas de honorarios", () => {
  it("valida regla general única, categorías sin repetir, porcentajes y base cobrado sin montos fijos", async () => {
    const put = (a: Agent, id: string, body: unknown) => a.put(`/api/fees/config/${id}`, body);
    expect((await put(owner, d1.id, { base: "production", rules: [{ mode: "percent", percent: 40 }, { mode: "percent", percent: 30 }] })).status).toBe(400);
    expect((await put(owner, d1.id, { base: "production", rules: [{ mode: "percent", percent: 40 }, { category: "Cirugía", mode: "percent", percent: 1 }, { category: "Cirugía", mode: "percent", percent: 2 }] })).status).toBe(400);
    expect((await put(owner, d1.id, { base: "production", rules: [{ mode: "percent", percent: 33.333 }] })).status).toBe(400);
    expect((await put(owner, d1.id, { base: "production", rules: [{ mode: "percent", percent: 140 }] })).status).toBe(400);
    expect((await put(owner, d2.id, { base: "collected", rules: [{ mode: "fixed", fixedCents: 1000 }] })).status).toBe(400);
    expect((await put(acct, d1.id, { base: "production", rules: [{ mode: "percent", percent: 40 }] })).status).toBe(403); // contabilidad no gestiona personal
    expect((await put(owner, d1.id, {
      base: "production",
      rules: [
        { mode: "percent", percent: 40 },
        { category: "Endodoncia", mode: "fixed", fixedCents: 30000 },
        { category: "Prótesis", mode: "percent", percent: 50, deductCents: 50000 },
      ],
    })).status).toBe(200);
    expect((await put(owner, d2.id, { base: "collected", rules: [{ mode: "percent", percent: 30 }, { category: "Ortodoncia", mode: "percent", percent: 50 }] })).status).toBe(200);
    const cfg = (await acct.get("/api/fees/config")).body;
    expect(cfg.professionals.find((p: any) => p.dentistId === d1.id).rules).toHaveLength(3);
    expect(cfg.categories).toContain("Endodoncia");
  });
});

let s1: string, s2: string, s1b: string;
describe("liquidación base producción", () => {
  it("el borrador calcula línea por línea; el cierre guarda la misma copia", async () => {
    const r = await acct.post("/api/fees/settlements", { dentistId: d1.id, periodStart: P1.start, periodEnd: P1.end });
    expect(r.status).toBe(200);
    s1 = r.body.id;
    const d = (await acct.get(`/api/fees/settlements/${s1}`)).body;
    expect(d.status).toBe("draft");
    expect(d.canClose).toBe(false);
    const fees = Object.fromEntries(d.lines.map((l: any) => [`${l.description}|${l.baseCents}`, l.feeCents]));
    expect(fees).toEqual({
      "OPE-01|25000": 10000,       // 40 %
      "END-01|90000": 30000,       // fijo Bs 300 por Endodoncia
      "PRO-01|250000": 100000,     // 50 % de (2500 − 500 laboratorio)
      "OPE-01|33333": 13333,       // 40 % redondeado al centavo
      "PRE-03|27003": 10801,       // 40 % sobre 3 unidades
    }); // el cargo anulado dentro del período y el de P2 no entran
    expect(d).toMatchObject({ baseTotalCents: 425336, feeTotalCents: 164134, adjustmentsCents: 0, totalCents: 164134 });
    expect((await acct.post(`/api/fees/settlements/${s1}/close`, {})).status).toBe(403); // contabilidad prepara, no cierra
    const c = await owner.post(`/api/fees/settlements/${s1}/close`, { note: "Pagado por transferencia" });
    expect(c.status).toBe(200);
    expect(c.body).toMatchObject({ status: "closed", totalCents: 164134, lineCount: 5, base: "production" });
    expect(c.body.rulesSnapshot.rules).toHaveLength(3);
  });

  it("la cerrada es inmutable y no se superpone otra en el mismo período", async () => {
    expect((await owner.post(`/api/fees/settlements/${s1}/close`, {})).status).toBe(409);
    expect((await owner.post(`/api/fees/settlements/${s1}/discard`, {})).status).toBe(409);
    const ov = await owner.post("/api/fees/settlements", { dentistId: d1.id, periodStart: P1.end, periodEnd: P2.start });
    expect(ov.status).toBe(409);
    expect(ov.body.error.code).toBe("settlement_overlap");
    await expect(env.db.adminPool.query("UPDATE fee_settlements SET total_cents = 0, fee_total_cents = 0 WHERE id = $1", [s1])).rejects.toThrow(/no se modifica/);
    await expect(env.db.adminPool.query("DELETE FROM fee_settlements WHERE id = $1", [s1])).rejects.toThrow(/no se modifica/);
    await expect(env.db.adminPool.query("UPDATE fee_settlement_lines SET fee_cents = 0 WHERE settlement_id = $1", [s1])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM fee_settlement_lines WHERE settlement_id = $1", [s1])).rejects.toThrow(/solo inserción/);
    const line = (await env.db.adminPool.query("SELECT * FROM fee_settlement_lines WHERE settlement_id = $1 LIMIT 1", [s1])).rows[0];
    await expect(env.db.adminPool.query(
      "INSERT INTO fee_settlement_lines (clinic_id, settlement_id, kind, branch_id, charge_id, occurred_at, description, base_cents, fee_cents) VALUES ($1,$2,'production',$3,$4,now(),'x',1,1)",
      [F.clinicId, s1, line.branch_id, line.charge_id])).rejects.toThrow();
  });

  it("un cargo anulado después del cierre se ajusta en el período siguiente, nunca en el cerrado", async () => {
    expect((await owner.post(`/api/charges/${A.charges[0]}/void`, { reason: "Tratamiento repetido sin costo" })).status).toBe(200);
    const closed = (await owner.get(`/api/fees/settlements/${s1}`)).body;
    expect(closed.totalCents).toBe(164134);
    expect(closed.lines).toHaveLength(5);
    const r = await owner.post("/api/fees/settlements", { dentistId: d1.id, periodStart: P2.start, periodEnd: P2.end });
    s2 = r.body.id;
    const d = (await owner.get(`/api/fees/settlements/${s2}`)).body;
    expect(d.lines.map((l: any) => [l.kind, l.feeCents])).toEqual([["production", 4000], ["adjustment", -10000]]);
    expect(d).toMatchObject({ feeTotalCents: 4000, adjustmentsCents: -10000, totalCents: -6000 });
    const c = await owner.post(`/api/fees/settlements/${s2}/close`, {});
    expect(c.body.totalCents).toBe(-6000);
    // Ya ajustado: no se repite en el período siguiente
    const cur = await owner.post("/api/fees/settlements", { dentistId: d1.id, periodStart: now.startOf("month").toISODate(), periodEnd: now.endOf("month").toISODate() });
    const dc = (await owner.get(`/api/fees/settlements/${cur.body.id}`)).body;
    expect(dc.adjustmentsCents).toBe(0);
    const early = await owner.post(`/api/fees/settlements/${cur.body.id}/close`, {});
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("period_not_ended");
    expect((await owner.post(`/api/fees/settlements/${cur.body.id}/discard`, {})).status).toBe(200);
  });
});

describe("liquidación base cobrado", () => {
  it("reparte cada pago entre las categorías del presupuesto y usa la fecha de confirmación", async () => {
    s1b = (await acct.post("/api/fees/settlements/bulk", { periodStart: P1.start, periodEnd: P1.end })).body && (await acct.get(`/api/fees/settlements?dentistId=${d2.id}`)).body[0].id;
    const d = (await acct.get(`/api/fees/settlements/${s1b}`)).body;
    expect(d.base).toBe("collected");
    expect(d.lines.map((l: any) => [l.category, l.baseCents, l.feeCents])).toEqual([
      ["Diagnóstico", 20000, 6000],  // transferencia recibida en P0, confirmada en P1 → 30 %
      ["Operatoria", 2500, 750],     // 10 001 repartido 1:3 → 2 500 / 7 501
      ["Ortodoncia", 7501, 3751],    // 50 % de 75,01 = 37,505 → 37,51
    ]);
    expect(d).toMatchObject({ baseTotalCents: 30001, feeTotalCents: 10501, totalCents: 10501 });
    expect(d.unassigned).toEqual({ count: 1, cents: 5000 }); // cobro sin presupuesto: informado, no atribuido
    expect((await owner.post(`/api/fees/settlements/${s1b}/close`, {})).status).toBe(200);
  });

  it("un pago anulado después del cierre se descuenta en el período siguiente", async () => {
    expect((await owner.post(`/api/payments/${Y}/void`, { reason: "Devolución" })).status).toBe(200);
    const r = await owner.post("/api/fees/settlements", { dentistId: d2.id, periodStart: P2.start, periodEnd: P2.end });
    const d = (await owner.get(`/api/fees/settlements/${r.body.id}`)).body;
    expect(d.lines.map((l: any) => [l.kind, l.feeCents])).toEqual([["adjustment", -6000]]);
    expect((await owner.get(`/api/fees/settlements/${s1b}`)).body.totalCents).toBe(10501);
    expect((await owner.post(`/api/fees/settlements/${r.body.id}/close`, {})).status).toBe(200);
  });
});

describe("exportación, vista del profesional y permisos", () => {
  it("exporta a Excel con el total exacto", async () => {
    const r = await env.app.inject({ method: "GET", url: `/api/fees/settlements/${s1}/export.xlsx`, headers: { cookie: owner.cookie } });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toContain("spreadsheetml");
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(r.rawPayload as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Liquidación")!;
    let total: unknown = null;
    ws.eachRow((row) => { if (row.getCell(3).value === "Total a pagar (Bs)") total = row.getCell(4).value; });
    expect(total).toBe(1641.34);
    expect(ws.rowCount).toBe(9 + 5);
  });

  it("el profesional ve solo sus liquidaciones cerradas, de solo lectura", async () => {
    const mine = (await d1A.get("/api/fees/mine")).body as any[];
    expect(mine.map((s) => s.id).sort()).toEqual([s1, s2].sort());
    expect((await d1A.get(`/api/fees/mine/${s1}`)).body.lines).toHaveLength(5);
    expect((await d1A.get(`/api/fees/mine/${s1b}`)).status).toBe(404); // de otro profesional
    const draft = await owner.post("/api/fees/settlements", { dentistId: d2.id, periodStart: P0.start, periodEnd: P0.end });
    expect((await d2A.get(`/api/fees/mine/${draft.body.id}`)).status).toBe(404); // borrador: no visible
    const x = await env.app.inject({ method: "GET", url: `/api/fees/mine/${s1}/export.xlsx`, headers: { cookie: d1A.cookie } });
    expect(x.statusCode).toBe(200);
    expect((await d1A.get("/api/fees/settlements")).status).toBe(403);
    expect((await d1A.get(`/api/fees/settlements/${s1}`)).status).toBe(403);
    expect((await d1A.post(`/api/fees/settlements/${draft.body.id}/close`, {})).status).toBe(403);
  });

  it("recepción no ve honorarios; quien no tiene todas las sucursales tampoco los gestiona", async () => {
    expect((await rec.get("/api/fees/settlements")).status).toBe(403);
    expect((await rec.get("/api/fees/mine")).status).toBe(403);
    expect((await rec.get("/api/fees/branch-results")).status).toBe(403);
    expect((await limitedAdmin.get("/api/fees/settlements")).status).toBe(403);
  });
});

describe("resultado por sucursal", () => {
  it("cobrado, producción y honorarios liquidados por sucursal y consolidado", async () => {
    const r = (await acct.get(`/api/fees/branch-results?from=${P1.start}&to=${P1.end}`)).body;
    const b0 = r.branches.find((b: any) => b.branchId === B0());
    const b1 = r.branches.find((b: any) => b.branchId === B1());
    // Producción P1: cargos menos la anulación dentro del período (la anulación posterior cae en hoy)
    expect(b0.productionCents).toBe(25000 + 90000 + 250000 + 27003);
    expect(b1.productionCents).toBe(33333);
    // Cobrado P1 (confirmados por fecha de confirmación; el pago Y se anuló después)
    expect(b0.collectedCents).toBe(7000 + 10001 + 5000);
    expect(b0.pendingVerificationCents).toBe(1500);
    expect(b0.feesCents).toBe(164134 - 13333 + 10501);
    expect(b1.feesCents).toBe(13333);
    expect(r.total.feesCents).toBe(164134 + 10501);
    expect(r.total.resultCents).toBe(r.total.collectedCents - r.total.feesCents - r.total.pettyExpensesCents);
    expect(r.closedSettlements).toBe(2);
    expect(r.previousRange).toEqual({ from: P0.start, to: P0.end }); // mes calendario anterior
    // Recepción limitada: no accede; un admin de una sola sucursal solo ve la suya
    const lim = (await limitedAdmin.get(`/api/fees/branch-results?from=${P1.start}&to=${P1.end}`)).body;
    expect(lim.branches.map((b: any) => b.branchId)).toEqual([B0()]);
  });
});

describe("aislamiento entre clínicas (honorarios)", () => {
  it("otra clínica no ve ni modifica reglas ni liquidaciones de F", async () => {
    expect((await gOwner.get(`/api/fees/settlements/${s1}`)).status).toBe(404);
    expect((await gOwner.get("/api/fees/settlements")).body).toEqual([]);
    expect((await gOwner.put(`/api/fees/config/${d1.id}`, { base: "production", rules: [{ mode: "percent", percent: 99 }] })).status).toBe(404);
    expect((await gOwner.post("/api/fees/settlements", { dentistId: d1.id, periodStart: P0.start, periodEnd: P0.end })).status).toBe(409); // sin reglas en G
    expect((await gOwner.post(`/api/fees/settlements/${s1}/close`, {})).status).toBe(404);
    expect((await env.app.inject({ method: "GET", url: `/api/fees/settlements/${s1}/export.xlsx`, headers: { cookie: gOwner.cookie } })).statusCode).toBe(404);
    const counts = await withTenant(env.db.appPool, { clinicId: G.clinicId, userId: null }, async (c) => ({
      p: (await c.query("SELECT count(*)::int AS n FROM fee_profiles")).rows[0].n,
      r: (await c.query("SELECT count(*)::int AS n FROM fee_rules")).rows[0].n,
      s: (await c.query("SELECT count(*)::int AS n FROM fee_settlements")).rows[0].n,
      l: (await c.query("SELECT count(*)::int AS n FROM fee_settlement_lines")).rows[0].n,
    }));
    expect(counts).toEqual({ p: 0, r: 0, s: 0, l: 0 });
    await expect(withTenant(env.db.appPool, { clinicId: G.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO fee_profiles (clinic_id, dentist_id, base) VALUES ($1,$2,'production')", [F.clinicId, d1.id]))).rejects.toThrow(/row-level security/);
  });
});
