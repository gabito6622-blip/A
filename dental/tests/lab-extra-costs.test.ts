// B-111: costo adicional de un trabajo de laboratorio reenviado o repetido (movimiento aparte, con fecha).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, owner2: Agent, dent: Agent, acct: Agent, recB1: Agent;
let dentId: string, lab: string, order: string;
const today = () => DateTime.now().setZone("America/La_Paz").toISODate()!;
const B0 = () => K.branches[0]!;

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  K2 = await createClinic(env.db, { name: "Otra clínica" });
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  const d = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
  dentId = d.id;
  dent = await login(env.app, d.email);
  acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  recB1 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[1]!] })).email);
  lab = (await owner.post("/api/lab/labs", { name: "Laboratorio Reenvíos" })).body.id;
  const patient = await createPatient(owner);
  const o = await dent.post("/api/lab/orders", { patientId: patient, labId: lab, dentistId: dentId, branchId: B0(), workType: "crown", teeth: [21], shade: "A2", impression: "digital", material: "Zirconio" });
  expect(o.status, JSON.stringify(o.body)).toBe(200);
  order = o.body.id;
  const tr = (to: string, extra: Record<string, unknown> = {}) => dent.post(`/api/lab/orders/${order}/transition`, { to, ...extra });
  expect((await tr("sent")).status).toBe(200);
  expect((await tr("received", { costCents: 40000 })).status).toBe(200);
});
afterAll(async () => teardown(env));

const detail = async () => (await dent.get(`/api/lab/orders/${order}`)).body;
const due = async () => ((await acct.get(`/api/lab/payables?labId=${lab}`)).body.orders.find((x: any) => x.id === order)?.outstandingCents ?? 0);
const tr = (a: Agent, to: string, extra: Record<string, unknown> = {}) => a.post(`/api/lab/orders/${order}/transition`, { to, ...extra });

describe("costo adicional por reenvío (B-111)", () => {
  it("se registra al recibir el trabajo que volvió del ajuste y suma a lo que se debe", async () => {
    expect((await acct.post("/api/lab/payments", { labId: lab, paidOn: today(), method: "cash", amountCents: 40000 })).status).toBe(200);
    expect(await due()).toBe(0);
    // Fuera de un reenvío no se acepta
    expect((await tr(dent, "delivered", { extraCostCents: 100 })).status).toBe(400);
    expect((await tr(dent, "adjustment", { reason: "Color no coincide" })).status).toBe(200);
    expect((await tr(recB1, "received", { extraCostCents: 5000 })).status).toBe(404); // otra sucursal: la orden no se ve
    const r = await tr(dent, "received", { extraCostCents: 5000, extraCostReason: "Repetición por cambio de color" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    const d = await detail();
    expect(d).toMatchObject({ costCents: 40000, extraCostCents: 5000, totalCostCents: 45000, outstandingCents: 5000 });
    expect(d.extraCosts).toHaveLength(1);
    expect(d.extraCosts[0]).toMatchObject({ amountCents: 5000, chargedOn: today(), reason: "Repetición por cambio de color" });
    expect(await due()).toBe(5000);
  });

  it("el estado de cuenta lo muestra en su fecha y el tope de pago lo incluye", async () => {
    const st = (await acct.get(`/api/lab/statement?labId=${lab}&from=${today()}&to=${today()}`)).body;
    const extra = st.movements.find((m: any) => m.kind === "extra");
    expect(extra).toMatchObject({ debitCents: 5000, date: today() });
    expect(extra.description).toMatch(/reenvío: Repetición por cambio de color/);
    expect(st.closingCents).toBe(5000);
    const tomorrow = DateTime.fromISO(today()).plus({ days: 1 }).toISODate();
    const later = (await acct.get(`/api/lab/statement?labId=${lab}&from=${tomorrow}&to=${tomorrow}`)).body;
    expect(later.openingCents).toBe(5000); // el saldo inicial posterior lo arrastra
    expect((await acct.post("/api/lab/payments", { labId: lab, paidOn: today(), method: "cash", amountCents: 5001 })).status).toBe(400);
    expect((await acct.post("/api/lab/payments", { labId: lab, paidOn: today(), method: "cash", amountCents: 5000 })).status).toBe(200);
    expect(await due()).toBe(0);
  });

  it("entra en la rentabilidad del mes de la sucursal", async () => {
    const month = today().slice(0, 7);
    const d = (await owner.get(`/api/management/profitability?month=${month}`)).body;
    const b = d.branches.find((x: any) => x.branchId === B0());
    expect(b.labCents).toBe(45000);
  });

  it("correcciones con monto negativo: no por debajo de lo pagado ni del cero; permisos y aislamiento", async () => {
    const url = `/api/lab/orders/${order}/extra-costs`;
    expect((await dent.post(url, { amountCents: 0, reason: "nada" })).status).toBe(400);
    expect((await dent.post(url, { amountCents: -1000, reason: "x" })).status).toBe(400);
    const below = await dent.post(url, { amountCents: -1000, reason: "Descuento acordado" });
    expect(below.status).toBe(409); // ya está todo pagado: anular el pago antes
    expect(below.body.error.message).toMatch(/pagado/);
    expect((await acct.post(url, { amountCents: 1000, reason: "Envío urgente" })).status).toBe(403); // contabilidad no edita órdenes
    expect((await owner2.post(url, { amountCents: 1000, reason: "Ajena" })).status).toBe(404);
    expect((await recB1.post(url, { amountCents: 1000, reason: "Otra sucursal" })).status).toBe(404);
    expect((await dent.post(url, { amountCents: 1500, reason: "Envío urgente" })).status).toBe(200);
    expect(await due()).toBe(1500);
    expect((await dent.post(url, { amountCents: -7000, reason: "Corrección" })).status).toBe(409); // dejaría el adicional en negativo
    expect((await dent.post(url, { amountCents: -1500, reason: "Se cargó por error" })).status).toBe(200);
    expect(await due()).toBe(0);
    expect((await detail()).extraCosts.map((x: any) => x.amountCents)).toEqual([5000, 1500, -1500]);
    // Solo inserción
    await expect(env.db.adminPool.query("UPDATE lab_order_extra_costs SET amount_cents = 1 WHERE order_id = $1", [order])).rejects.toThrow();
    await expect(env.db.adminPool.query("DELETE FROM lab_order_extra_costs WHERE order_id = $1", [order])).rejects.toThrow();
    const au = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM audit_log WHERE entity_id = $1 AND action = 'lab_order.extra_cost'", [order])).rows[0].n;
    expect(au).toBe(2);
  });

  it("una orden sin recibir no acepta costo adicional", async () => {
    const patient = await createPatient(owner);
    const o = (await dent.post("/api/lab/orders", { patientId: patient, labId: lab, dentistId: dentId, branchId: B0(), workType: "crown", teeth: [11], shade: "A1", impression: "digital", material: "Zirconio" })).body.id;
    expect((await dent.post(`/api/lab/orders/${o}/extra-costs`, { amountCents: 1000, reason: "Antes de tiempo" })).status).toBe(409);
  });
});
