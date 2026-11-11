// Convenios y gastos, segunda parte (B-082, B-083): traslado al paciente de la porción impaga de la
// empresa, pagos de empresas en efectivo en la caja, cuentas por cobrar con antigüedad, honorarios
// «por cobro» con pagos de empresas, gastos compartidos entre sucursales y comprobante adjunto.
import { randomUUID } from "node:crypto";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { loadConfig } from "../server/src/config.js";
import { encodePng } from "../server/src/lib/png.js";
import { signFileToken } from "../server/src/modules/clinicalFiles-core.js";
import { ageDebits, bucketOf } from "../server/src/modules/agreements/aging.js";
import { parseShares, splitByPercent } from "../server/src/modules/management/shares.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

const FILES_DIR = mkdtempSync(join(tmpdir(), "dental-receipts-test-"));
process.env.DENTAL_FILES_DIR = FILES_DIR;
process.env.DENTAL_FILES_MAX_MB = "1";

const ZONE = "America/La_Paz";
const todayIso = () => DateTime.now().setZone(ZONE).toISODate()!;
/** Mediodía (La Paz) de hace `n` días. */
const daysAgo = (n: number) => DateTime.now().setZone(ZONE).startOf("day").minus({ days: n }).set({ hour: 12 }).toJSDate();

let env: Env;
let K: TestClinic, O: TestClinic, Z: TestClinic;
let owner: Agent, admin: Agent, limitedAdmin: Agent, acct: Agent, acctLimited: Agent, rec: Agent, dent: Agent, otherOwner: Agent, zOwner: Agent, zRec: Agent, zAcctLimited: Agent;
let dentId: string;
let seq = 5000;
const B0 = () => K.branches[0]!, B1 = () => K.branches[1]!;
const q = (sql: string, p: unknown[] = []) => env.db.adminPool.query(sql, p);

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  O = await createClinic(env.db, { name: "Otra clínica" });
  Z = await createClinic(env.db, { name: "Clínica antigüedad" });
  owner = await login(env.app, K.ownerEmail);
  otherOwner = await login(env.app, O.ownerEmail);
  zOwner = await login(env.app, Z.ownerEmail);
  admin = await login(env.app, (await addUser(env.db, K.clinicId, "admin", { allBranches: true })).email);
  limitedAdmin = await login(env.app, (await addUser(env.db, K.clinicId, "admin", { branchIds: [K.branches[0]!] })).email);
  acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  acctLimited = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { branchIds: [K.branches[0]!] })).email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  const d = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
  dentId = d.id;
  dent = await login(env.app, d.email);
  zRec = await login(env.app, (await addUser(env.db, Z.clinicId, "receptionist", { branchIds: [Z.branches[0]!] })).email);
  zAcctLimited = await login(env.app, (await addUser(env.db, Z.clinicId, "accountant", { branchIds: [Z.branches[0]!] })).email);
});
afterAll(async () => {
  await teardown(env);
  rmSync(FILES_DIR, { recursive: true, force: true });
});

async function newAgreement(a: Agent, over: Record<string, unknown> = {}) {
  const r = await a.post("/api/agreements", {
    name: `Empresa Ficticia ${randomUUID().slice(0, 6)}`, kind: "company", validFrom: DateTime.now().minus({ days: 400 }).toISODate(),
    companySharePercent: 70, patientTransferDays: 30, rules: [], ...over,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
async function enroll(a: Agent, patientId: string, agreementId: string) {
  const r = await a.post(`/api/patients/${patientId}/agreements`, { agreementId, memberNumber: `AF-${randomUUID().slice(0, 5)}`, validFrom: DateTime.now().minus({ days: 300 }).toISODate() });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}

/**
 * Tratamiento realizado con la copia del convenio en la línea (como al presupuestar) y su cargo con la fecha
 * indicada (datos históricos). La porción de la empresa la calcula el trigger de la base.
 */
async function companyCharge(t: TestClinic, o: { patient: string; agreementId: string; paId: string; share: number; amount: number; at?: Date; dentist?: string; branch?: string; code?: string; budget?: string }) {
  const dentist = o.dentist ?? t.ownerId;
  const budget = o.budget ?? (await q(`INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status) VALUES ($1,$2,$3,$4,$5,'accepted') RETURNING id`,
    [t.clinicId, ++seq, o.branch ?? t.branches[0], o.patient, dentist])).rows[0].id as string;
  const pid = await procedureId(env.db, t.clinicId, o.code ?? "OPE-01");
  const item = (await q(`INSERT INTO budget_items (clinic_id, budget_id, procedure_id, description, unit_price_cents, status, performed_by, performed_at,
                           agreement_id, patient_agreement_id, list_unit_price_cents, company_share_percent)
     VALUES ($1,$2,$3,'Tratamiento de prueba',$4,'done',$5,$6,$7,$8,$4,$9) RETURNING id`,
    [t.clinicId, budget, pid, o.amount, dentist, o.at ?? new Date(), o.agreementId, o.paId, o.share])).rows[0].id;
  const ch = (await q(`INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, dentist_id, description, amount_cents, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,'Tratamiento de prueba',$6,$5,COALESCE($7, now())) RETURNING id, third_party_cents`,
    [t.clinicId, o.branch ?? t.branches[0], o.patient, item, dentist, o.amount, o.at ?? null])).rows[0];
  return { id: ch.id as string, company: Number(ch.third_party_cents), budget, item: item as string };
}
const balance = async (patientId: string) => Number((await q("SELECT balance_cents FROM patient_money($1)", [patientId])).rows[0].balance_cents);
const companyBalance = async (a: Agent, agreementId: string) => (await a.get("/api/payers/receivables")).body.find((x: any) => x.id === agreementId)?.balanceCents ?? 0;

// ---------------------------------------------------------------------------
describe("porción impaga de la empresa → paciente", () => {
  let ag: any, patient: string, pa: string, c1: { id: string; company: number; budget: string }, c2: { id: string; company: number }, transferId: string;

  beforeAll(async () => {
    ag = await newAgreement(owner);
    patient = await createPatient(owner, { firstName: "Traslado" });
    pa = await enroll(owner, patient, ag.id);
    c1 = await companyCharge(K, { patient, agreementId: ag.id, paId: pa, share: 70, amount: 33333 });
    c2 = await companyCharge(K, { patient, agreementId: ag.id, paId: pa, share: 70, amount: 10001 });
  });

  it("el trigger calcula la porción al centavo y la cuenta de la empresa la refleja", async () => {
    expect(c1.company).toBe(23333); // 70 % de 333,33 = 233,331 → 233,33
    expect(c2.company).toBe(7001);  // 70 % de 100,01 = 70,007 → 70,01
    expect(await balance(patient)).toBe(33333 + 10001 - 23333 - 7001);
    expect(await companyBalance(admin, ag.id)).toBe(23333 + 7001);
  });

  it("no es automático ni libre: motivo obligatorio, plazo del convenio y solo gerencia con todas las sucursales", async () => {
    const url = `/api/payer-charges/${c1.id}/transfer`;
    const short = await admin.post(url, { cause: "rejected", reason: "no" });
    expect(short.status).toBe(400);
    expect((await admin.post(url, { cause: "rejected" })).status).toBe(400);
    const early = await admin.post(url, { cause: "overdue", reason: "La empresa no pagó" });
    expect(early.status).toBe(409);
    expect(early.body.error.code).toBe("not_overdue");
    expect(early.body.error.message).toMatch(/30 días/);
    expect((await rec.post(url, { cause: "rejected", reason: "La empresa rechazó" })).status).toBe(403);
    expect((await acct.post(url, { cause: "rejected", reason: "La empresa rechazó" })).status).toBe(403);
    expect((await limitedAdmin.post(url, { cause: "rejected", reason: "La empresa rechazó" })).status).toBe(403);
    expect((await otherOwner.post(url, { cause: "rejected", reason: "La empresa rechazó" })).status).toBe(404);
    expect(await balance(patient)).toBe(33333 + 10001 - 23333 - 7001);
  });

  it("trasladar: el paciente suma exactamente la porción y la empresa la resta (el total no cambia)", async () => {
    const before = { p: await balance(patient), c: await companyBalance(admin, ag.id) };
    const r = await admin.post(`/api/payer-charges/${c1.id}/transfer`, { cause: "rejected", reason: "La empresa rechazó la cobertura de la resina" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    transferId = r.body.id;
    expect(r.body.amountCents).toBe(23333);
    const after = { p: await balance(patient), c: await companyBalance(admin, ag.id) };
    expect(after.p - before.p).toBe(23333);
    expect(before.c - after.c).toBe(23333);
    expect(after.p + after.c).toBe(before.p + before.c);
    // La ficha (cuenta y aviso) usa el mismo saldo.
    const acc = (await rec.get(`/api/patients/${patient}/account`)).body;
    expect(acc.balanceCents).toBe(after.p);
    const notice = (await rec.get(`/api/patients/${patient}/payer-transfers`)).body;
    expect(notice.netCents).toBe(23333);
    expect(notice.items[0]).toMatchObject({ agreementName: ag.name, amountCents: 23333, cause: "rejected", reason: "La empresa rechazó la cobertura de la resina", reversed: false });
    const tl = (await owner.get(`/api/patients/${patient}/timeline`)).body.items;
    expect(tl.some((i: any) => i.kind === "agreement.transfer" && /pasó al saldo del paciente/.test(i.title))).toBe(true);
    // Estado de cuenta de la empresa: el traslado es un haber y el saldo final cuadra con la cuenta por cobrar.
    const st = (await admin.get(`/api/agreements/${ag.id}/statement?from=${todayIso()}&to=${todayIso()}`)).body;
    expect(st.movements.some((m: any) => m.kind === "transfer" && m.creditCents === 23333)).toBe(true);
    expect(st.closingCents).toBe(after.c);
    // En el presupuesto, lo que puede pagar el paciente sube en lo trasladado.
    const b = (await owner.get(`/api/budgets/${c1.budget}`)).body;
    expect(b.companyCents).toBe(0);
  });

  it("sin traslados dobles: ni por la API, ni en paralelo, ni directo en la base", async () => {
    const again = await admin.post(`/api/payer-charges/${c1.id}/transfer`, { cause: "rejected", reason: "Segundo intento" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("nothing_to_transfer");
    await expect(q(`INSERT INTO payer_transfers (clinic_id, charge_id, agreement_id, patient_id, branch_id, amount_cents, cause, reason, created_by)
                    VALUES ($1,$2,$3,$4,$5,1,'rejected','Directo en la base',$6)`, [K.clinicId, c1.id, ag.id, patient, B0(), K.ownerId])).rejects.toThrow(/supera la porción impaga/);
    // Dos pedidos simultáneos sobre el mismo cargo: solo uno pasa.
    const res = await Promise.all([1, 2].map(() => admin.post(`/api/payer-charges/${c2.id}/transfer`, { cause: "rejected", reason: "Rechazo de la empresa" })));
    expect(res.map((x) => x.status).sort()).toEqual([200, 409]);
    expect((await q("SELECT count(*)::int AS n FROM payer_transfers WHERE charge_id = $1", [c2.id])).rows[0].n).toBe(1);
  });

  it("lo trasladado ya no se cobra a la empresa ni deja anular el cargo; el registro es de solo inserción", async () => {
    const pay = await admin.post(`/api/agreements/${ag.id}/payments`, {
      branchId: B0(), amountCents: 100, method: "transfer", bankReference: `T-${randomUUID().slice(0, 6)}`, idempotencyKey: randomUUID(), allocations: [{ chargeId: c1.id, amountCents: 100 }] });
    expect(pay.status).toBe(409);
    expect(pay.body.error.code).toBe("allocation_exceeds");
    const v = await owner.post(`/api/charges/${c1.id}/void`, { reason: "Error de carga" });
    expect(v.status).toBe(409);
    expect(v.body.error.code).toBe("has_payer_transfer");
    await expect(q(`INSERT INTO charges (clinic_id, branch_id, patient_id, description, amount_cents, voids_charge_id, created_by) VALUES ($1,$2,$3,'x',-33333,$4,$5)`,
      [K.clinicId, B0(), patient, c1.id, K.ownerId])).rejects.toThrow(/revierte primero el traslado/);
    await expect(q("UPDATE payer_transfers SET amount_cents = 1 WHERE id = $1", [transferId])).rejects.toThrow(/solo inserción/);
    await expect(q("DELETE FROM payer_transfers WHERE id = $1", [transferId])).rejects.toThrow(/solo inserción/);
  });

  it("se revierte solo con otro movimiento y una sola vez; después se puede volver a trasladar", async () => {
    const before = { p: await balance(patient), c: await companyBalance(admin, ag.id) };
    expect((await admin.post(`/api/payer-transfers/${transferId}/reverse`, { reason: "x" })).status).toBe(400);
    expect((await rec.post(`/api/payer-transfers/${transferId}/reverse`, { reason: "La empresa sí lo cubre" })).status).toBe(403);
    const r = await admin.post(`/api/payer-transfers/${transferId}/reverse`, { reason: "La empresa aceptó pagarlo" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await balance(patient)).toBe(before.p - 23333);
    expect(await companyBalance(admin, ag.id)).toBe(before.c + 23333);
    const twice = await admin.post(`/api/payer-transfers/${transferId}/reverse`, { reason: "Otra vez" });
    expect(twice.status).toBe(409);
    expect(twice.body.error.code).toBe("already_reversed");
    expect((await admin.post(`/api/payer-transfers/${r.body.id}/reverse`, { reason: "Revertir la reversión" })).status).toBe(409);
    expect((await q("SELECT count(*)::int AS n FROM payer_transfers WHERE charge_id = $1", [c1.id])).rows[0].n).toBe(2); // el original se conserva
    // Traslado parcial: no más que lo impago.
    const big = await admin.post(`/api/payer-charges/${c1.id}/transfer`, { cause: "rejected", reason: "Rechazo parcial", amountCents: 23334 });
    expect(big.status).toBe(409);
    expect(big.body.error.code).toBe("transfer_exceeds");
    expect((await admin.post(`/api/payer-charges/${c1.id}/transfer`, { cause: "rejected", reason: "Rechazo parcial", amountCents: 1 })).status).toBe(200);
    expect((await admin.get(`/api/agreements/${ag.id}/transferable`)).body.charges.find((x: any) => x.id === c1.id).openCents).toBe(23332);
  });

  it("por vencida: respeta el plazo del convenio al día exacto", async () => {
    const at29 = await companyCharge(K, { patient, agreementId: ag.id, paId: pa, share: 70, amount: 5000, at: daysAgo(29) });
    const at30 = await companyCharge(K, { patient, agreementId: ag.id, paId: pa, share: 70, amount: 5000, at: daysAgo(30) });
    const list = (await admin.get(`/api/agreements/${ag.id}/transferable`)).body;
    expect(list.patientTransferDays).toBe(30);
    expect(list.charges.find((x: any) => x.id === at29.id)).toMatchObject({ ageDays: 29, overdueForTransfer: false, daysLeft: 1 });
    expect(list.charges.find((x: any) => x.id === at30.id)).toMatchObject({ ageDays: 30, overdueForTransfer: true });
    expect((await admin.post(`/api/payer-charges/${at29.id}/transfer`, { cause: "overdue", reason: "Vencida sin pago" })).status).toBe(409);
    expect((await admin.post(`/api/payer-charges/${at30.id}/transfer`, { cause: "overdue", reason: "Vencida sin pago" })).status).toBe(200);
    const rx = (await admin.get("/api/payers/receivables")).body.find((x: any) => x.id === ag.id);
    expect(rx.transferableCharges).toBe(0);
    expect(rx.balanceCents).toBe(rx.billedCents - rx.transferredCents - rx.paidCents);
  });
});

// ---------------------------------------------------------------------------
describe("pago de la empresa en efectivo: entra a la caja abierta de quien lo recibe", () => {
  let ag: any, patient: string, ch: { id: string; company: number }, session: any, payId: string;

  beforeAll(async () => {
    ag = await newAgreement(owner, { companySharePercent: 50 });
    patient = await createPatient(owner, { firstName: "Efectivo" });
    const pa = await enroll(owner, patient, ag.id);
    ch = await companyCharge(K, { patient, agreementId: ag.id, paId: pa, share: 50, amount: 12345 });
    session = (await admin.post("/api/cash-sessions", { branchId: B0(), openingFloatCents: 10000 })).body;
    expect(session.id).toBeTruthy();
  });

  it("queda confirmado al recibirlo (sin referencia bancaria) y suma al esperado de la caja", async () => {
    expect(ch.company).toBe(6173); // 50 % de 123,45 = 61,725 → 61,73
    const r = await admin.post(`/api/agreements/${ag.id}/payments`, { branchId: B0(), amountCents: 6173, method: "cash", idempotencyKey: randomUUID(), allocations: [{ chargeId: ch.id, amountCents: 6173 }] });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ status: "confirmed", cashSessionId: session.id });
    payId = r.body.id;
    const s = (await admin.get(`/api/cash-sessions/${session.id}`)).body;
    expect(s.totals.expectedCents).toBe(10000 + 6173);
    expect(s.payments.find((p: any) => p.id === payId)).toMatchObject({ fromPayer: true, amountCents: 6173, patientName: `Empresa: ${ag.name}` });
    const rx = (await admin.get("/api/payers/receivables")).body.find((x: any) => x.id === ag.id);
    expect(rx).toMatchObject({ paidCents: 6173, pendingCents: 0, balanceCents: 0 });
    // Nunca aparece para verificar en el banco ni en la conciliación.
    expect((await acct.get("/api/payer-payments?status=pending_verification")).body.some((p: any) => p.id === payId)).toBe(false);
    await expect(q("UPDATE payer_payments SET cash_session_id = NULL WHERE id = $1", [payId])).rejects.toThrow(/caja de un cobro/);
  });

  it("transferencia o QR siguen pidiendo referencia y verificación; el efectivo no puede quedar «por verificar»", async () => {
    const r = await admin.post(`/api/agreements/${ag.id}/payments`, { branchId: B0(), amountCents: 1, method: "qr", idempotencyKey: randomUUID(), allocations: [{ chargeId: ch.id, amountCents: 1 }] });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toMatch(/referencia bancaria/);
    await expect(q(`INSERT INTO payer_payments (clinic_id, number, agreement_id, branch_id, amount_cents, method, status, idempotency_key, received_by)
                    VALUES ($1, 999999, $2, $3, 100, 'cash', 'pending_verification', $4, $5)`, [K.clinicId, ag.id, B0(), randomUUID(), K.ownerId])).rejects.toThrow(/cash_confirmed/);
  });

  it("anular el pago en efectivo lo saca del esperado; con caja obligatoria no se cobra sin caja abierta", async () => {
    expect((await owner.post(`/api/payer-payments/${payId}/void`, { reason: "Se devolvió el efectivo" })).status).toBe(200);
    expect((await admin.get(`/api/cash-sessions/${session.id}`)).body.totals.expectedCents).toBe(10000);
    expect((await owner.put("/api/cash-sessions/settings", { requireCashSession: true })).status).toBe(200);
    const r = await owner.post(`/api/agreements/${ag.id}/payments`, { branchId: B1(), amountCents: 6173, method: "cash", idempotencyKey: randomUUID(), allocations: [{ chargeId: ch.id, amountCents: 6173 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("cash_session_required");
    await owner.put("/api/cash-sessions/settings", { requireCashSession: false });
    const close = await admin.post(`/api/cash-sessions/${session.id}/close`, { counts: { "10000": 1 }, note: null });
    expect(close.status, JSON.stringify(close.body)).toBe(200);
    expect(close.body).toMatchObject({ status: "closed", expectedCents: 10000, differenceCents: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("cuentas por cobrar generales con antigüedad (paciente y empresa por separado)", () => {
  let ag: any, pa: string, pb: string, paId: string, old: { id: string; company: number };

  it("tramos: función pura con fechas límite 30/31, 60/61 y 90/91", () => {
    expect([0, 30, 31, 60, 61, 90, 91, 400].map(bucketOf)).toEqual(["d0_30", "d0_30", "d31_60", "d31_60", "d61_90", "d61_90", "d90_plus", "d90_plus"]);
    const r = ageDebits("2026-11-11", [{ key: "a", date: "2026-08-01", cents: 500 }, { key: "b", date: "2026-11-01", cents: 300 }], 600);
    expect(r.buckets).toEqual({ d0_30: 200, d31_60: 0, d61_90: 0, d90_plus: 0 }); // los pagos se aplican a lo más antiguo
  });

  beforeAll(async () => {
    ag = await newAgreement(zOwner, { companySharePercent: 50, patientTransferDays: 30 });
    pa = await createPatient(zOwner, { firstName: "Afiliado" });
    pb = await createPatient(zOwner, { firstName: "Particular" });
    paId = await enroll(zOwner, pa, ag.id);
    // Particular: cargos a 30, 31, 60, 61, 90 y 91 días y un pago de 15 Bs.
    for (const [days, cents] of [[30, 1000], [31, 2000], [60, 4000], [61, 8000], [90, 16000], [91, 32000], [45, 500]] as const) {
      await q(`INSERT INTO charges (clinic_id, branch_id, patient_id, description, amount_cents, created_by, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
        [Z.clinicId, Z.branches[0], pb, `Cargo a ${days} días`, cents, Z.ownerId, daysAgo(days)]);
    }
    // El cargo de 45 días se anuló: no cuenta en ningún tramo.
    const c45 = (await q("SELECT id FROM charges WHERE patient_id = $1 AND amount_cents = 500", [pb])).rows[0].id;
    expect((await zOwner.post(`/api/charges/${c45}/void`, { reason: "Error de carga" })).status).toBe(200);
    const pay = await zOwner.post("/api/payments", { branchId: Z.branches[0], patientId: pb, amountCents: 1500, method: "cash", idempotencyKey: randomUUID() });
    expect(pay.status).toBe(200);
    // Afiliado: dos cargos con porción de la empresa (50 %), a 10 y a 100 días.
    await companyCharge(Z, { patient: pa, agreementId: ag.id, paId, share: 50, amount: 10001, at: daysAgo(10) });
    old = await companyCharge(Z, { patient: pa, agreementId: ag.id, paId, share: 50, amount: 3333, at: daysAgo(100) });
  });

  it("al día de hoy: tramos exactos y totales iguales a patient_money y a la cuenta de las empresas", async () => {
    const r = await zOwner.get("/api/reports/receivables-aging");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = r.body;
    const b = d.patients.find((x: any) => x.patientId === pb);
    expect(b).toMatchObject({ d0_30: 1000, d31_60: 6000, d61_90: 24000, d90_plus: 30500, totalCents: 61500, oldestDays: 91 });
    const a = d.patients.find((x: any) => x.patientId === pa);
    expect(a).toMatchObject({ d0_30: 5000, d31_60: 0, d61_90: 0, d90_plus: 1666, totalCents: 6666 });
    expect(d.companies).toHaveLength(1);
    expect(d.companies[0]).toMatchObject({ agreementId: ag.id, d0_30: 5001, d90_plus: 1667, totalCents: 6668, charges: 2, patients: 1 });
    expect(d.totals.patients.totalCents).toBe(await balance(pb) + await balance(pa));
    const rx = (await zOwner.get("/api/payers/receivables")).body;
    expect(d.totals.companies.totalCents).toBe(rx.reduce((s: number, x: any) => s + x.balanceCents, 0));
    expect(d.totals.general.totalCents).toBe(61500 + 6666 + 6668);
  });

  it("los saldos iniciales importados (deuda y a favor) entran en la antigüedad y cuadran con patient_money", async () => {
    const pc = await createPatient(zOwner, { firstName: "Importado", lastName: "Deuda" });
    const pd = await createPatient(zOwner, { firstName: "Importado", lastName: "Afavor" });
    const cutoff = DateTime.now().setZone(ZONE).minus({ days: 75 }).toISODate()!;
    const ins = (patient: string, cents: number) => q(
      "INSERT INTO opening_balances (clinic_id, patient_id, amount_cents, cutoff_date, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [Z.clinicId, patient, cents, cutoff, Z.ownerId]);
    const debt = (await ins(pc, 7000)).rows[0].id;
    await ins(pd, -2000);
    await q(`INSERT INTO charges (clinic_id, branch_id, patient_id, description, amount_cents, created_by, created_at) VALUES ($1,$2,$3,'Cargo reciente',5000,$4,$5)`,
      [Z.clinicId, Z.branches[0], pd, Z.ownerId, daysAgo(10)]);
    let d = (await zOwner.get("/api/reports/receivables-aging")).body;
    expect(d.patients.find((x: any) => x.patientId === pc)).toMatchObject({ d61_90: 7000, totalCents: 7000, oldestDays: 75 });
    expect(d.patients.find((x: any) => x.patientId === pd)).toMatchObject({ d0_30: 3000, totalCents: 3000 });
    expect(7000).toBe(await balance(pc));
    expect(3000).toBe(await balance(pd));
    // Anular el saldo inicial lo quita de la antigüedad (el paciente ya no figura con deuda).
    expect((await zOwner.post(`/api/opening-balances/${debt}/void`, { reason: "Cargado por error" })).status).toBe(200);
    d = (await zOwner.get("/api/reports/receivables-aging")).body;
    expect(d.patients.find((x: any) => x.patientId === pc)?.totalCents ?? 0).toBe(0);
    expect(await balance(pc)).toBe(0);
  });

  it("el traslado al paciente cambia de cuenta sin cambiar el total general", async () => {
    const before = (await zOwner.get("/api/reports/receivables-aging")).body.totals.general.totalCents;
    expect((await zOwner.post(`/api/payer-charges/${old.id}/transfer`, { cause: "overdue", reason: "Vencida hace más de 90 días" })).status).toBe(200);
    const d = (await zOwner.get("/api/reports/receivables-aging")).body;
    expect(d.totals.general.totalCents).toBe(before);
    expect(d.companies[0]).toMatchObject({ d0_30: 5001, d90_plus: 0, totalCents: 5001 });
    // Lo trasladado se cuenta desde la fecha del traslado.
    expect(d.patients.find((x: any) => x.patientId === pa)).toMatchObject({ d0_30: 5000 + 1667, d90_plus: 1666, totalCents: 6666 + 1667 });
  });

  it("a una fecha de corte pasada: solo lo registrado hasta ese día y la antigüedad a esa fecha", async () => {
    const asOf = DateTime.fromISO(todayIso()).minus({ days: 31 }).toISODate()!;
    const d = (await zOwner.get(`/api/reports/receivables-aging?asOf=${asOf}`)).body;
    expect(d.asOf).toBe(asOf);
    // Los cargos de 31, 45, 60, 61, 90 y 91 días tienen 0, 14, 29, 30, 59 y 60 días; el de 30 días, la anulación del de 45 y el pago son posteriores.
    expect(d.patients.find((x: any) => x.patientId === pb)).toMatchObject({ d0_30: 14500, d31_60: 48000, d61_90: 0, d90_plus: 0, totalCents: 62500 });
    expect(d.companies[0]).toMatchObject({ d61_90: 1667, totalCents: 1667 });
    expect(d.patients.find((x: any) => x.patientId === pa)).toMatchObject({ d61_90: 1666, totalCents: 1666 });
    const fut = await zOwner.get(`/api/reports/receivables-aging?asOf=${DateTime.fromISO(todayIso()).plus({ days: 1 }).toISODate()}`);
    expect(fut.status).toBe(400);
  });

  it("Excel con los mismos totales; permisos financieros; sin acceso a todas las sucursales no se ven las empresas", async () => {
    const d = (await zOwner.get("/api/reports/receivables-aging")).body;
    const res = await env.app.inject({ method: "GET", url: "/api/reports/receivables-aging.xlsx", headers: { cookie: zOwner.cookie } });
    expect(res.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    const rowOf = (name: string, label: string) => { let out: unknown[] = []; wb.getWorksheet(name)!.eachRow((r) => { const v = r.values as unknown[]; if (v[1] === label) out = v.slice(1); }); return out; };
    expect(rowOf("Resumen", "Total general")).toEqual(["Total general", ...["d0_30", "d31_60", "d61_90", "d90_plus", "totalCents"].map((k) => d.totals.general[k] / 100)]);
    expect(rowOf("Pacientes", "Total pacientes").at(-1)).toBe(d.totals.patients.totalCents / 100);
    expect(rowOf("Empresas", "Total empresas").at(-1)).toBe(d.totals.companies.totalCents / 100);
    expect((await zRec.get("/api/reports/receivables-aging")).status).toBe(403);
    const lim = (await zAcctLimited.get("/api/reports/receivables-aging")).body;
    expect(lim.companies).toBeNull();
    expect(lim.totals.companies).toBeNull();
    expect(lim.totals.patients.totalCents).toBe(d.totals.patients.totalCents);
    // Otra clínica no ve estos saldos.
    const other = (await otherOwner.get("/api/reports/receivables-aging")).body;
    expect(other.patients.some((x: any) => x.patientId === pb || x.patientId === pa)).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("honorarios «por cobro» con pagos de empresas (al centavo, sin doble conteo)", () => {
  const prev = DateTime.now().setZone(ZONE).minus({ months: 1 }).startOf("month");
  const at = (day: number, hour = 12) => prev.set({ day, hour }).toJSDate();
  let dFee: { id: string; email: string }, ag: any, patient: string, payer: string, charges: { id: string; company: number }[] = [], settlementId: string;

  beforeAll(async () => {
    dFee = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
    const cfg = await owner.put(`/api/fees/config/${dFee.id}`, { base: "collected", rules: [{ category: null, mode: "percent", percent: 33.33 }] });
    expect(cfg.status, JSON.stringify(cfg.body)).toBe(200);
    ag = await newAgreement(owner);
    patient = await createPatient(owner, { firstName: "Honorarios" });
    const pa = await enroll(owner, patient, ag.id);
    const budget = (await q(`INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status) VALUES ($1,$2,$3,$4,$5,'accepted') RETURNING id`,
      [K.clinicId, ++seq, B0(), patient, dFee.id])).rows[0].id as string;
    for (const [amount, code, branch, hour] of [[33333, "OPE-01", B0(), 9], [10001, "PRE-01", B1(), 10], [7777, "END-01", B0(), 11]] as const) {
      charges.push(await companyCharge(K, { patient, agreementId: ag.id, paId: pa, share: 70, amount, at: at(5, hour), dentist: dFee.id, code, budget, branch }));
    }
    const company = charges.reduce((s, c) => s + c.company, 0);
    // La empresa paga sus porciones (confirmado el día 10) y el paciente paga la suya.
    payer = (await q(`INSERT INTO payer_payments (clinic_id, number, agreement_id, branch_id, amount_cents, method, status, bank_reference, idempotency_key, received_by, received_at, verified_by, verified_at)
       VALUES ($1,$2,$3,$4,$5,'transfer','confirmed',$6,$7,$8,$9,$10,$9) RETURNING id`,
      [K.clinicId, ++seq, ag.id, B0(), company, `HON-${seq}`, randomUUID(), K.ownerId, at(10), dentId])).rows[0].id;
    for (const c of charges) await q("INSERT INTO payer_payment_allocations (clinic_id, payment_id, charge_id, amount_cents) VALUES ($1,$2,$3,$4)", [K.clinicId, payer, c.id, c.company]);
    await q(`INSERT INTO payments (clinic_id, receipt_number, branch_id, patient_id, budget_id, amount_cents, method, status, idempotency_key, received_by, received_at, verified_by, verified_at)
       VALUES ($1,$2,$3,$4,$5,$6,'cash','confirmed',$7,$8,$9,$8,$9)`, [K.clinicId, ++seq, B0(), patient, budget, 51111 - company, randomUUID(), K.ownerId, at(11)]);
  });

  it("cada aplicación del pago de la empresa es una línea exacta; con lo del paciente suma la producción", async () => {
    expect(charges.map((c) => c.company)).toEqual([23333, 7001, 5444]);
    const r = await owner.post("/api/fees/settlements", { dentistId: dFee.id, periodStart: prev.toISODate(), periodEnd: prev.endOf("month").toISODate() });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    settlementId = r.body.id;
    const d = (await owner.get(`/api/fees/settlements/${settlementId}`)).body;
    const payerLines = d.lines.filter((l: any) => l.kind === "collected_payer");
    const patientLines = d.lines.filter((l: any) => l.kind === "collected");
    expect(payerLines.map((l: any) => l.baseCents)).toEqual([23333, 7001, 5444]);
    // Honorario 33,33 % redondeado al centavo, línea por línea.
    expect(payerLines.map((l: any) => l.feeCents)).toEqual([7777, 2333, 1814]);
    expect(payerLines.map((l: any) => l.payerAllocationId).every(Boolean)).toBe(true);
    // La sucursal de la línea es la del tratamiento (la segunda línea es de la sucursal 2).
    expect(payerLines[1].branchId).toBe(B1());
    expect(patientLines.reduce((s: number, l: any) => s + l.baseCents, 0)).toBe(15333);
    expect(d.baseTotalCents).toBe(51111); // sin doble conteo: paciente + empresa = producción
    expect(d.feeTotalCents).toBe(d.lines.reduce((s: number, l: any) => s + l.feeCents, 0));
  });

  it("se liquida una sola vez y, si la empresa anula el pago, el ajuste va al período siguiente", async () => {
    const close = await owner.post(`/api/fees/settlements/${settlementId}/close`, { note: null });
    expect(close.status, JSON.stringify(close.body)).toBe(200);
    const saved = (await q("SELECT count(*)::int AS n FROM fee_settlement_lines WHERE settlement_id = $1 AND kind = 'collected_payer'", [settlementId])).rows[0].n;
    expect(saved).toBe(3);
    const alloc = (await q("SELECT payer_allocation_id FROM fee_settlement_lines WHERE settlement_id = $1 AND kind = 'collected_payer' LIMIT 1", [settlementId])).rows[0].payer_allocation_id;
    // Ni siquiera directo en la base: otra liquidación (borrador) no puede volver a liquidar la misma aplicación.
    const older = prev.minus({ months: 1 });
    const draft = await owner.post("/api/fees/settlements", { dentistId: dFee.id, periodStart: older.toISODate(), periodEnd: older.endOf("month").toISODate() });
    await expect(q(`INSERT INTO fee_settlement_lines (clinic_id, settlement_id, kind, branch_id, occurred_at, description, base_cents, fee_cents, payer_allocation_id)
                    VALUES ($1,$2,'collected_payer',$3,now(),'dup',1,1,$4)`, [K.clinicId, draft.body.id, B0(), alloc])).rejects.toThrow(/fee_lines_payer_alloc_once/);
    expect((await owner.post(`/api/payer-payments/${payer}/void`, { reason: "La empresa revirtió la transferencia" })).status).toBe(200);
    const cur = await owner.post("/api/fees/settlements", { dentistId: dFee.id, periodStart: DateTime.now().setZone(ZONE).startOf("month").toISODate(), periodEnd: todayIso() });
    const d = (await owner.get(`/api/fees/settlements/${cur.body.id}`)).body;
    expect(d.lines.filter((l: any) => l.kind === "collected_payer")).toHaveLength(0);
    const adj = d.lines.filter((l: any) => l.kind === "adjustment");
    expect(adj.map((l: any) => l.feeCents).sort((a: number, b: number) => a - b)).toEqual([-7777, -2333, -1814]);
    expect(d.adjustmentsCents).toBe(-(7777 + 2333 + 1814));
  });
});

// ---------------------------------------------------------------------------
describe("gastos compartidos entre sucursales", () => {
  const month = () => todayIso().slice(0, 7);
  const prof = async (a: Agent = owner) => {
    const d = (await a.get(`/api/management/profitability?month=${month()}`)).body;
    return Object.fromEntries(d.branches.map((b: any) => [b.branchId, b.expensesCents ?? 0])) as Record<string, number>;
  };
  let shared: any;

  it("reparto exacto al centavo con el residuo en la sucursal de mayor porcentaje", () => {
    expect(splitByPercent(10001, [5000, 5000])).toEqual([5001, 5000]);           // empate: la primera
    expect(splitByPercent(10001, [3333, 3333, 3334])).toEqual([3333, 3333, 3335]); // el residuo va al 33,34 %
    expect(splitByPercent(100001, [4000, 6000])).toEqual([40000, 60001]);
    expect(splitByPercent(1, [2500, 2500, 5000])).toEqual([0, 0, 1]);
    for (const amount of [1, 7, 99999, 123457, 100_000_000_000]) {
      const parts = splitByPercent(amount, [1234, 3333, 5433]);
      expect(parts.reduce((s, x) => s + x, 0)).toBe(amount);
    }
    expect(() => parseShares([{ branchId: randomUUID(), percent: 60 }, { branchId: randomUUID(), percent: 30 }])).toThrow(/sumar 100/);
    expect(() => parseShares([{ branchId: randomUUID(), percent: 33.333 }, { branchId: randomUUID(), percent: 66.667 }])).toThrow(/2 decimales/);
    const same = randomUUID();
    expect(() => parseShares([{ branchId: same, percent: 50 }, { branchId: same, percent: 50 }])).toThrow(/dos veces/);
    expect(() => parseShares([{ branchId: same, percent: 99.99 }])).toThrow(/dos o más/);
    expect(parseShares([])).toBeNull();
  });

  it("se registra repartido y la rentabilidad de cada sucursal sube exactamente su parte", async () => {
    const before = await prof();
    const r = await admin.post("/api/expenses", {
      branchId: B1(), category: "marketing", description: "Campaña de radio compartida", amountCents: 100001, expenseDate: todayIso(),
      shares: [{ branchId: B0(), percent: 40 }, { branchId: B1(), percent: 60 }],
    });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    shared = r.body;
    expect(shared.branchId).toBe(B1()); // principal = mayor porcentaje
    expect(shared.state).toBe("confirmed");
    expect(shared.shares).toEqual([
      expect.objectContaining({ branchId: B1(), percentBp: 6000, amountCents: 60001 }),
      expect.objectContaining({ branchId: B0(), percentBp: 4000, amountCents: 40000 }),
    ]);
    const after = await prof();
    expect(after[B0()]! - before[B0()]!).toBe(40000);
    expect(after[B1()]! - before[B1()]!).toBe(60001);
    // Lista de la sucursal 1: aparece, pero cuenta solo su parte.
    const l0 = (await admin.get(`/api/expenses?month=${month()}&branchId=${B0()}`)).body;
    const row = l0.items.find((x: any) => x.id === shared.id);
    expect(row).toMatchObject({ amountCents: 100001, scopeCents: 40000 });
    const all = (await admin.get(`/api/expenses?month=${month()}`)).body;
    expect(all.items.find((x: any) => x.id === shared.id).scopeCents).toBe(100001);
    // Excel con la misma parte.
    const res = await env.app.inject({ method: "GET", url: `/api/expenses.xlsx?month=${month()}&branchId=${B0()}`, headers: { cookie: admin.cookie } });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(res.rawPayload as unknown as ArrayBuffer);
    let total: unknown[] = [];
    wb.getWorksheet("Gastos")!.eachRow((r2) => { const v = r2.values as unknown[]; if (v[1] === "Total de la lista") total = v; });
    expect(total[11]).toBe(l0.totals.listedCents / 100);
  });

  it("validaciones, permisos por sucursal e inmutabilidad del reparto", async () => {
    const base = { branchId: B0(), category: "rent", description: "Alquiler compartido", amountCents: 5000, expenseDate: todayIso() };
    const bad = await admin.post("/api/expenses", { ...base, shares: [{ branchId: B0(), percent: 50 }, { branchId: B1(), percent: 49.99 }] });
    expect(bad.status).toBe(400);
    expect(bad.body.error.details[0].path).toBe("shares");
    expect((await limitedAdmin.post("/api/expenses", { ...base, shares: [{ branchId: B0(), percent: 50 }, { branchId: B1(), percent: 50 }] })).status).toBe(403);
    expect((await rec.post("/api/expenses", { ...base, shares: [{ branchId: B0(), percent: 50 }, { branchId: B1(), percent: 50 }] })).status).toBe(403);
    // Quien ve solo la sucursal 1 lo ve con su parte, pero no lo modifica.
    const lim = (await limitedAdmin.get(`/api/expenses?month=${month()}`)).body.items.find((x: any) => x.id === shared.id);
    expect(lim).toMatchObject({ scopeCents: 40000, canEdit: false });
    expect((await limitedAdmin.post(`/api/expenses/${shared.id}/void`, { reason: "No corresponde" })).status).toBe(403);
    await expect(q("UPDATE expense_shares SET amount_cents = 1 WHERE expense_id = $1", [shared.id])).rejects.toThrow(/no se modifica/);
    await expect(q("DELETE FROM expense_shares WHERE expense_id = $1", [shared.id])).rejects.toThrow(/no se modifica/);
    // Un borrador: la base exige 100 % y el monto exacto al confirmar la transacción.
    const draft = (await admin.post("/api/expenses", { ...base, asDraft: true, shares: [{ branchId: B0(), percent: 50 }, { branchId: B1(), percent: 50 }] })).body;
    expect(draft.shares.map((s: any) => s.amountCents)).toEqual([2500, 2500]);
    await expect(q("UPDATE expense_shares SET percent_bp = 4000 WHERE expense_id = $1 AND branch_id = $2", [draft.id, B1()])).rejects.toThrow(/sumar 100 %/);
    await expect(q("UPDATE expenses SET amount_cents = 5001 WHERE id = $1", [draft.id])).rejects.toThrow(/monto exacto/);
    // Editar el borrador recalcula el reparto; quitarlo lo deja en una sola sucursal.
    const ed = await admin.put(`/api/expenses/${draft.id}`, { ...base, amountCents: 5001, shares: [{ branchId: B0(), percent: 33.33 }, { branchId: B1(), percent: 66.67 }] });
    expect(ed.status, JSON.stringify(ed.body)).toBe(200);
    expect(ed.body.shares.map((s: any) => [s.percentBp, s.amountCents])).toEqual([[6667, 3335], [3333, 1666]]);
    const single = await admin.put(`/api/expenses/${draft.id}`, { ...base, shares: [] });
    expect(single.body.shares).toEqual([]);
  });

  it("al anularlo deja de contar en ambas sucursales", async () => {
    const before = await prof();
    expect((await admin.post(`/api/expenses/${shared.id}/void`, { reason: "Campaña cancelada" })).status).toBe(200);
    const after = await prof();
    expect(before[B0()]! - after[B0()]!).toBe(40000);
    expect(before[B1()]! - after[B1()]!).toBe(60001);
  });
});

// ---------------------------------------------------------------------------
describe("comprobante adjunto del gasto", () => {
  let expense: any, sharedExp: any, attId: string;
  let n = 0;
  const png = () => { const k = ++n; return encodePng(20, 12, (x, y) => [(x * 9 + k) % 256, (y * 11 + k * 5) % 256, (k * 17) % 256]); };
  const PDF = () => Buffer.from(`%PDF-1.4\n% factura de prueba ${++n}\n%%EOF\n`);
  async function upload(a: Agent, id: string, buf: Buffer, name = "factura.png") {
    const r = await env.app.inject({
      method: "POST", url: `/api/expenses/${id}/attachments`,
      headers: { cookie: a.cookie, "x-csrf-token": a.csrf, "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(name) }, payload: buf,
    });
    let body: any = null;
    try { body = r.json(); } catch { body = r.body; }
    return { status: r.statusCode, body };
  }
  const fetchRaw = async (a: Agent, url: string) => { const r = await env.app.inject({ method: "GET", url, headers: { cookie: a.cookie } }); return { status: r.statusCode, buf: r.rawPayload, headers: r.headers }; };

  beforeAll(async () => {
    expense = (await admin.post("/api/expenses", { branchId: B0(), category: "utilities", description: "Luz de la sucursal", amountCents: 45678, expenseDate: todayIso() })).body;
    sharedExp = (await admin.post("/api/expenses", { branchId: B0(), category: "utilities", description: "Internet compartido", amountCents: 30000, expenseDate: todayIso(),
      shares: [{ branchId: B0(), percent: 50 }, { branchId: B1(), percent: 50 }] })).body;
  });

  it("adjunta una imagen real (verificada por firma) y se ve con un enlace firmado", async () => {
    const img = png();
    const r = await upload(admin, expense.id, img, "Factura luz «octubre».png");
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.mimeType).toBe("image/png");
    attId = r.body.id;
    const list = (await acct.get(`/api/expenses/${expense.id}/attachments`)).body;
    expect(list.items).toHaveLength(1);
    expect(list.items[0]).toMatchObject({ originalName: "Factura luz «octubre».png", isImage: true, typeLabel: "PNG" });
    const got = await fetchRaw(acct, list.items[0].viewUrl);
    expect(got.status).toBe(200);
    expect(got.headers["content-type"]).toBe("image/png");
    expect(got.headers["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(got.buf, img)).toBe(0);
    expect((await admin.get(`/api/expenses?month=${todayIso().slice(0, 7)}`)).body.items.find((x: any) => x.id === expense.id).attachmentCount).toBe(1);
    const pdf = await upload(admin, expense.id, PDF(), "factura.pdf");
    expect(pdf.body.mimeType).toBe("application/pdf");
    // Los bytes quedan en su propia carpeta, separada de los archivos de pacientes.
    const files: string[] = [];
    const walk = (d: string) => { for (const e of readdirSync(d)) { const p = join(d, e); statSync(p).isDirectory() ? walk(p) : files.push(p); } };
    walk(FILES_DIR);
    expect(files.length).toBe(2);
    expect(files.every((f) => f.startsWith(join(FILES_DIR, "comprobantes-gastos")))).toBe(true);
    const audits = (await q("SELECT count(*)::int AS n FROM audit_log WHERE action = 'expense.attachment_viewed' AND entity_id = $1", [expense.id])).rows[0].n;
    expect(audits).toBe(1);
  });

  it("rechaza tipos no permitidos (por firma, no por nombre), vacíos, duplicados y demasiado grandes", async () => {
    const html = await upload(admin, expense.id, Buffer.from("<!doctype html><script>alert(1)</script>"), "factura.png");
    expect(html.status).toBe(415);
    expect(html.body.error.message).toMatch(/JPG, PNG o WebP\) o un PDF/);
    const dicom = await upload(admin, expense.id, Buffer.concat([Buffer.alloc(128), Buffer.from("DICM"), Buffer.alloc(64, 2)]), "rx.dcm");
    expect(dicom.status).toBe(415);
    expect((await upload(admin, expense.id, Buffer.alloc(0))).status).toBe(400);
    const img = png();
    expect((await upload(admin, expense.id, img)).status).toBe(200);
    const dup = await upload(admin, expense.id, img);
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("duplicate_file");
    expect((await upload(admin, expense.id, Buffer.concat([Buffer.from("%PDF-1.4\n"), Buffer.alloc(1024 * 1024 + 10, 32)]))).status).toBe(413);
  });

  it("permisos financieros: recepción y odontología no ven ni adjuntan; sucursal parcial solo ve", async () => {
    expect((await rec.get(`/api/expenses/${expense.id}/attachments`)).status).toBe(403);
    expect((await upload(rec, expense.id, png())).status).toBe(403);
    expect((await upload(dent, expense.id, png())).status).toBe(403);
    expect((await fetchRaw(dent, `/api/expense-attachments/${attId}/link`)).status).toBe(403);
    // Gasto compartido S1+S2: quien ve solo S1 puede ver los comprobantes, pero no adjuntar.
    expect((await upload(admin, sharedExp.id, PDF())).status).toBe(200);
    expect((await acctLimited.get(`/api/expenses/${sharedExp.id}/attachments`)).status).toBe(200);
    expect((await upload(limitedAdmin, sharedExp.id, png())).status).toBe(403);
    // Un gasto solo de S2 no se ve desde S1.
    const s2 = (await admin.post("/api/expenses", { branchId: B1(), category: "other", description: "Gasto solo S2", amountCents: 100, expenseDate: todayIso() })).body;
    expect((await acctLimited.get(`/api/expenses/${s2.id}/attachments`)).status).toBe(404);
    // Anulado: no admite comprobantes.
    await admin.post(`/api/expenses/${s2.id}/void`, { reason: "Registrado por error" });
    const v = await upload(admin, s2.id, png());
    expect(v.status).toBe(409);
    expect(v.body.error.code).toBe("expense_voided");
    await expect(q("UPDATE expense_attachments SET original_name = 'x' WHERE id = $1", [attId])).rejects.toThrow(/solo inserción/);
  });

  it("los enlaces son personales, de la clínica y no sirven los de archivos clínicos", async () => {
    const link = (await acct.get(`/api/expense-attachments/${attId}/link?purpose=download`)).body;
    expect((await fetchRaw(acct, link.url)).status).toBe(200);
    expect((await fetchRaw(admin, link.url)).status).toBe(403); // otra persona
    expect((await fetchRaw(otherOwner, link.url)).status).toBe(403); // otra clínica
    const cfg = loadConfig();
    const me = (await env.app.inject({ method: "GET", url: "/api/auth/me", headers: { cookie: acct.cookie } })).json();
    const clinical = signFileToken(cfg.keys.link, { f: attId, c: K.clinicId, u: me.user.id, p: "download" });
    const r = await fetchRaw(acct, `/api/expense-attachments/${attId}/content?t=${encodeURIComponent(clinical.token)}`);
    expect(r.status).toBe(403);
    expect((await fetchRaw(acct, `/api/expense-attachments/${attId}/content?t=abc.def`)).status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe("aislamiento entre clínicas en las tablas nuevas", () => {
  it("otra clínica no ve traslados, repartos ni comprobantes (API y RLS)", async () => {
    const counts = await withTenant(env.db.appPool, { clinicId: O.clinicId, userId: O.ownerId }, async (c) => (await c.query(
      `SELECT (SELECT count(*) FROM payer_transfers)::int AS t, (SELECT count(*) FROM expense_shares)::int AS s, (SELECT count(*) FROM expense_attachments)::int AS a`)).rows[0]);
    expect(counts).toEqual({ t: 0, s: 0, a: 0 });
    const mine = await withTenant(env.db.appPool, { clinicId: K.clinicId, userId: K.ownerId }, async (c) => (await c.query(
      `SELECT (SELECT count(*) FROM payer_transfers)::int AS t, (SELECT count(*) FROM expense_shares)::int AS s, (SELECT count(*) FROM expense_attachments)::int AS a`)).rows[0]);
    expect(mine.t).toBeGreaterThan(0);
    expect(mine.s).toBeGreaterThan(0);
    expect(mine.a).toBeGreaterThan(0);
    const t = (await q("SELECT id, patient_id FROM payer_transfers WHERE clinic_id = $1 AND reverses_id IS NULL LIMIT 1", [K.clinicId])).rows[0];
    expect((await otherOwner.post(`/api/payer-transfers/${t.id}/reverse`, { reason: "Intento ajeno" })).status).toBe(404);
    expect((await otherOwner.get(`/api/patients/${t.patient_id}/payer-transfers`)).status).toBe(404);
    expect((await otherOwner.get("/api/payer-transfers")).body).toEqual([]);
    const e = (await q("SELECT expense_id FROM expense_shares WHERE clinic_id = $1 LIMIT 1", [K.clinicId])).rows[0];
    expect((await otherOwner.get(`/api/expenses/${e.expense_id}/attachments`)).status).toBe(404);
    // Insertar con la clínica ajena: RLS lo impide.
    await expect(withTenant(env.db.appPool, { clinicId: O.clinicId, userId: O.ownerId }, (c) =>
      c.query("INSERT INTO expense_shares (clinic_id, expense_id, branch_id, percent_bp, amount_cents) VALUES ($1,$2,$3,5000,1)", [K.clinicId, e.expense_id, B0()]))).rejects.toThrow();
  });
});
