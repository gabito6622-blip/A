import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
let owner: Agent, rec: Agent, acct: Agent, dentA: Agent;
let dent: { id: string; email: string };
let patient: string;
const B = () => K.branches[0]!;
let n = 0;
const key = () => `pay-${Date.now()}-${n++}`;

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  dent = await addUser(env.db, K.clinicId, "dentist", { branchIds: [B()], commissionPct: 30 });
  dentA = await login(env.app, dent.email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
  acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  patient = await createPatient(owner);
});
afterAll(async () => teardown(env));

async function acceptedBudget(items: { code: string; tooth?: number; surfaces?: string[]; discountCents?: number; unitPriceCents?: number }[]) {
  const body = {
    branchId: B(), patientId: patient, dentistId: dent.id, installments: 3,
    items: await Promise.all(items.map(async (i) => ({ procedureId: await procedureId(env.db, K.clinicId, i.code), tooth: i.tooth ?? null, surfaces: i.surfaces ?? [], discountCents: i.discountCents ?? 0, unitPriceCents: i.unitPriceCents }))),
  };
  const r = await dentA.post("/api/budgets", body);
  expect(r.status).toBe(200);
  expect((await rec.post(`/api/budgets/${r.body.id}/status`, { status: "presented" })).status).toBe(200);
  expect((await rec.post(`/api/budgets/${r.body.id}/status`, { status: "accepted", note: "Firmado" })).status).toBe(200);
  return (await owner.get(`/api/budgets/${r.body.id}`)).body;
}

describe("presupuestos y tratamientos", () => {
  it("calcula totales con descuentos y plan de cuotas exacto (centavos)", async () => {
    const b = await acceptedBudget([
      { code: "OPE-01", tooth: 16, surfaces: ["O"], unitPriceCents: 25000, discountCents: 1000 },
      { code: "END-01", tooth: 11, unitPriceCents: 90001 },
    ]);
    expect(b.totalCents).toBe(24000 + 90001);
    expect(b.installmentPlan).toHaveLength(3);
    expect(b.installmentPlan.reduce((s: number, x: number) => s + x, 0)).toBe(b.totalCents);
  });

  it("exige pieza y superficies cuando la prestación lo requiere", async () => {
    const r = await dentA.post("/api/budgets", { branchId: B(), patientId: patient, dentistId: dent.id, items: [{ procedureId: await procedureId(env.db, K.clinicId, "OPE-01"), tooth: 16 }] });
    expect(r.status).toBe(400);
  });

  it("no se realizan tratamientos de un presupuesto no aceptado", async () => {
    const r = await dentA.post("/api/budgets", { branchId: B(), patientId: patient, dentistId: dent.id, items: [{ procedureId: await procedureId(env.db, K.clinicId, "PRE-01") }] });
    const b = (await owner.get(`/api/budgets/${r.body.id}`)).body;
    const res = await dentA.post(`/api/budget-items/${b.items[0].id}/perform`, {});
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("budget_not_accepted");
  });

  it("realizar genera UN cargo y marca el odontograma (planificado → realizado)", async () => {
    const b = await acceptedBudget([{ code: "END-01", tooth: 21, unitPriceCents: 90000 }]);
    const item = b.items[0];
    let odo = (await dentA.get(`/api/patients/${patient}/odontogram`)).body;
    expect(odo.active.some((e: any) => e.tooth === 21 && e.state === "planned")).toBe(true);
    const results = await Promise.all([dentA.post(`/api/budget-items/${item.id}/perform`, {}), dentA.post(`/api/budget-items/${item.id}/perform`, {})]);
    expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    const charges = await env.db.adminPool.query("SELECT amount_cents FROM charges WHERE budget_item_id = $1", [item.id]);
    expect(charges.rows).toEqual([{ amount_cents: 90000 }]);
    odo = (await dentA.get(`/api/patients/${patient}/odontogram`)).body;
    expect(odo.active.filter((e: any) => e.tooth === 21).map((e: any) => e.state)).toEqual(["completed"]);
    expect((await owner.get(`/api/budgets/${b.id}`)).body.status).toBe("completed");
  });

  it("recepción no puede marcar tratamientos como realizados", async () => {
    const b = await acceptedBudget([{ code: "PRE-01" }]);
    expect((await rec.post(`/api/budget-items/${b.items[0].id}/perform`, {})).status).toBe(403);
  });
});

describe("pagos y cuenta del paciente", () => {
  it("efectivo queda confirmado; transferencia queda pendiente y no reduce el saldo hasta verificarse", async () => {
    const p = await createPatient(owner);
    const b = await (async () => {
      const r = await dentA.post("/api/budgets", { branchId: B(), patientId: p, dentistId: dent.id, items: [{ procedureId: await procedureId(env.db, K.clinicId, "PRE-01"), unitPriceCents: 20000 }] });
      await rec.post(`/api/budgets/${r.body.id}/status`, { status: "presented" });
      await rec.post(`/api/budgets/${r.body.id}/status`, { status: "accepted" });
      return (await owner.get(`/api/budgets/${r.body.id}`)).body;
    })();
    await dentA.post(`/api/budget-items/${b.items[0].id}/perform`, {});
    const cash = await rec.post("/api/payments", { branchId: B(), patientId: p, budgetId: b.id, amountCents: 5000, method: "cash", idempotencyKey: key() });
    expect(cash.body.status).toBe("confirmed");
    const tr = await rec.post("/api/payments", { branchId: B(), patientId: p, budgetId: b.id, amountCents: 15000, method: "transfer", bankReference: `OP-${Date.now()}`, idempotencyKey: key() });
    expect(tr.body.status).toBe("pending_verification");
    let acc = (await rec.get(`/api/patients/${p}/account`)).body;
    expect(acc).toMatchObject({ chargedCents: 20000, paidCents: 5000, pendingVerificationCents: 15000, balanceCents: 15000 });
    // Quien registró no puede verificar su propio pago; recepción no tiene permiso
    expect((await rec.post(`/api/payments/${tr.body.id}/verify`, { decision: "confirmed" })).status).toBe(403);
    expect((await acct.post(`/api/payments/${tr.body.id}/verify`, { decision: "confirmed" })).status).toBe(200);
    expect((await acct.post(`/api/payments/${tr.body.id}/verify`, { decision: "confirmed" })).status).toBe(409);
    acc = (await rec.get(`/api/patients/${p}/account`)).body;
    expect(acc).toMatchObject({ paidCents: 20000, pendingVerificationCents: 0, balanceCents: 0 });
  });

  it("control dual: quien registra un pago no puede verificarlo (salvo el propietario)", async () => {
    const admin = await login(env.app, (await addUser(env.db, K.clinicId, "admin", { allBranches: true })).email);
    const r = await admin.post("/api/payments", { branchId: B(), patientId: patient, amountCents: 1000, method: "qr", bankReference: `QR-${Date.now()}`, idempotencyKey: key() });
    const v = await admin.post(`/api/payments/${r.body.id}/verify`, { decision: "confirmed" });
    expect(v.status).toBe(403);
  });

  it("la misma referencia bancaria no se registra dos veces", async () => {
    const ref = `DUP-${Date.now()}`;
    expect((await rec.post("/api/payments", { branchId: B(), patientId: patient, amountCents: 1000, method: "transfer", bankReference: ref, idempotencyKey: key() })).status).toBe(200);
    const r = await rec.post("/api/payments", { branchId: B(), patientId: patient, amountCents: 1000, method: "transfer", bankReference: ref, idempotencyKey: key() });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("duplicate_bank_reference");
  });

  it("transferencia/QR sin referencia bancaria se rechaza", async () => {
    expect((await rec.post("/api/payments", { branchId: B(), patientId: patient, amountCents: 1000, method: "qr", idempotencyKey: key() })).status).toBe(400);
  });

  it("idempotencia: el doble envío devuelve el mismo pago; datos distintos con la misma clave se rechazan", async () => {
    const k = key();
    const body = { branchId: B(), patientId: patient, amountCents: 3000, method: "cash", idempotencyKey: k };
    const [a, b2] = await Promise.all([rec.post("/api/payments", body), rec.post("/api/payments", body)]);
    const ok = [a, b2].filter((x) => x.status === 200);
    expect(ok.length).toBeGreaterThanOrEqual(1);
    const rows = await env.db.adminPool.query("SELECT count(*)::int AS n FROM payments WHERE idempotency_key = $1", [k]);
    expect(rows.rows[0].n).toBe(1);
    expect((await rec.post("/api/payments", { ...body, amountCents: 9999 })).body.error.code).toBe("idempotency_mismatch");
  });

  it("no permite pagar más que el saldo del presupuesto", async () => {
    const b = await acceptedBudget([{ code: "PRE-02", unitPriceCents: 8000 }]);
    const r = await rec.post("/api/payments", { branchId: B(), patientId: patient, budgetId: b.id, amountCents: 8001, method: "cash", idempotencyKey: key() });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("overpayment");
  });

  it("anular un cargo devuelve el tratamiento a pendiente y ajusta el saldo; un cargo no se anula dos veces", async () => {
    const p = await createPatient(owner);
    const r = await dentA.post("/api/budgets", { branchId: B(), patientId: p, dentistId: dent.id, items: [{ procedureId: await procedureId(env.db, K.clinicId, "CON-01"), unitPriceCents: 10000 }] });
    await rec.post(`/api/budgets/${r.body.id}/status`, { status: "presented" });
    await rec.post(`/api/budgets/${r.body.id}/status`, { status: "accepted" });
    const b = (await owner.get(`/api/budgets/${r.body.id}`)).body;
    const perf = await dentA.post(`/api/budget-items/${b.items[0].id}/perform`, {});
    expect((await rec.post(`/api/charges/${perf.body.chargeId}/void`, { reason: "error" })).status).toBe(403);
    expect((await owner.post(`/api/charges/${perf.body.chargeId}/void`, { reason: "Registrado por error" })).status).toBe(200);
    expect((await owner.post(`/api/charges/${perf.body.chargeId}/void`, { reason: "otra vez" })).status).toBe(409);
    expect((await owner.get(`/api/patients/${p}/account`)).body.balanceCents).toBe(0);
    const b2 = (await owner.get(`/api/budgets/${r.body.id}`)).body;
    expect(b2.items[0].status).toBe("pending");
    expect(b2.status).toBe("accepted");
    expect((await dentA.post(`/api/budget-items/${b.items[0].id}/perform`, {})).status).toBe(200);
    expect((await owner.get(`/api/patients/${p}/account`)).body.balanceCents).toBe(10000);
  });

  it("la caja del día suma por medio y estado", async () => {
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });
    const r = await owner.get(`/api/cash-summary?date=${today}&branchId=${B()}`);
    const cash = r.body.filter((x: any) => x.method === "cash" && x.status === "confirmed");
    expect(cash.length).toBe(1);
    expect(cash[0].amountCents).toBeGreaterThan(0);
  });
});

describe("inmutabilidad en la base de datos", () => {
  it("el monto de un pago no se puede modificar ni borrar, aun con SQL directo del rol de la app", async () => {
    const pay = (await env.db.adminPool.query("SELECT id FROM payments WHERE clinic_id = $1 LIMIT 1", [K.clinicId])).rows[0].id;
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("UPDATE payments SET amount_cents = 1 WHERE id = $1", [pay]))).rejects.toThrow(/permission denied/);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("DELETE FROM payments WHERE id = $1", [pay]))).rejects.toThrow(/permission denied/);
  });

  it("ni siquiera el dueño de la base puede alterar el monto (trigger)", async () => {
    const pay = (await env.db.adminPool.query("SELECT id FROM payments WHERE clinic_id = $1 LIMIT 1", [K.clinicId])).rows[0].id;
    await expect(env.db.adminPool.query("UPDATE payments SET amount_cents = 1 WHERE id = $1", [pay])).rejects.toThrow(/no se modifican/);
  });

  it("la auditoría y los cargos son de solo inserción", async () => {
    await expect(env.db.adminPool.query("UPDATE audit_log SET action = 'x' WHERE clinic_id = $1", [K.clinicId])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM charges WHERE clinic_id = $1", [K.clinicId])).rejects.toThrow(/solo inserción/);
  });

  it("cada operación financiera queda auditada", async () => {
    const r = await env.db.adminPool.query("SELECT DISTINCT action FROM audit_log WHERE clinic_id = $1", [K.clinicId]);
    const actions = r.rows.map((x) => x.action);
    for (const a of ["payment.created", "payment.confirmed", "treatment.performed", "charge.voided", "budget.status"]) expect(actions).toContain(a);
  });
});
