import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, createClinic, createPatient, fullSchedule, future, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
let owner: Agent, rec: Agent, acct: Agent;
let dent: { id: string; email: string };

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 3 });
  owner = await login(env.app, K.ownerEmail);
  dent = await addUser(env.db, K.clinicId, "dentist", { allBranches: true, commissionPct: 40 });
  for (const b of K.branches) await fullSchedule(env.db, K.clinicId, dent.id, b);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] })).email);
  acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  const d = await login(env.app, dent.email);
  // Sucursal 1: tratamiento de 300 Bs, cobrado 200 en efectivo + 100 por QR pendiente
  const p = await createPatient(owner);
  const bud = await d.post("/api/budgets", { branchId: K.branches[0], patientId: p, dentistId: dent.id, items: [{ procedureId: await procedureId(env.db, K.clinicId, "CON-01"), unitPriceCents: 30000 }] });
  await owner.post(`/api/budgets/${bud.body.id}/status`, { status: "presented" });
  await owner.post(`/api/budgets/${bud.body.id}/status`, { status: "accepted" });
  const item = (await owner.get(`/api/budgets/${bud.body.id}`)).body.items[0];
  await d.post(`/api/budget-items/${item.id}/perform`, {});
  await rec.post("/api/payments", { branchId: K.branches[0], patientId: p, amountCents: 20000, method: "cash", idempotencyKey: "r-1-cash" });
  await rec.post("/api/payments", { branchId: K.branches[0], patientId: p, amountCents: 10000, method: "qr", bankReference: "QR-R-1", idempotencyKey: "rep-1-qr-key" });
  // Sucursal 2: un pago adelantado de 50 Bs
  await owner.post("/api/payments", { branchId: K.branches[1], patientId: p, amountCents: 5000, method: "cash", idempotencyKey: "r-2-cash" });
  // Citas futuras en sucursal 3
  await owner.post("/api/appointments", { branchId: K.branches[2], dentistId: dent.id, patientId: p, startsAt: future(1, 9), durationMin: 60 });
});
afterAll(async () => teardown(env));

describe("panel y reportes", () => {
  it("el panel del propietario cuadra exactamente con los movimientos", async () => {
    const r = (await owner.get("/api/reports/dashboard")).body;
    const b1 = r.branches.find((x: any) => x.branchId === K.branches[0]);
    const b2 = r.branches.find((x: any) => x.branchId === K.branches[1]);
    expect(b1).toMatchObject({ collectedCents: 20000, productionCents: 30000, pendingVerificationCents: 10000 });
    expect(b2).toMatchObject({ collectedCents: 5000, productionCents: 0 });
    expect(r.totals.collectedCents).toBe(25000);
    // saldo: 30000 cargado - 25000 confirmado = 5000 por cobrar
    expect(r.finance.receivableCents).toBe(5000);
  });

  it("recepción ve indicadores operativos de SU sucursal y sin montos", async () => {
    const r = (await rec.get("/api/reports/dashboard")).body;
    expect(r.financial).toBe(false);
    expect(r.branches).toHaveLength(1);
    expect(r.branches[0].collectedCents).toBeUndefined();
    expect((await rec.get("/api/reports/receivables")).status).toBe(403);
  });

  it("contabilidad accede al panel financiero y a la producción por profesional con comisión", async () => {
    expect((await acct.get("/api/reports/finance-dashboard")).status).toBe(200);
    const prod = (await acct.get("/api/reports/production-by-dentist")).body;
    expect(prod[0]).toMatchObject({ productionCents: 30000, commissionPct: 40, commissionCents: 12000 });
  });

  it("exporta pagos a Excel", async () => {
    const r = await acct.get("/api/reports/payments.xlsx");
    expect(r.status).toBe(200);
    expect(String(r.headers["content-type"])).toMatch(/spreadsheetml/);
  });
});
