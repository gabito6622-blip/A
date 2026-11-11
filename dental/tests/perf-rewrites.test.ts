// Regresión de las reescrituras de rendimiento (Equipo Q, migración 0022): mismo resultado que antes
// y el mismo aislamiento entre clínicas.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let A: TestClinic, B: TestClinic;
let ownerA: Agent;
let pDebt: string, pPaid: string, pNothing: string, pB: string, pOpening: string;
const key = () => `perf-${Math.random().toString(36).slice(2)}`;

beforeAll(async () => {
  env = await setupEnv();
  A = await createClinic(env.db);
  B = await createClinic(env.db);
  ownerA = await login(env.app, A.ownerEmail);
  const dent = await addUser(env.db, A.clinicId, "dentist", { allBranches: true });
  const d = await login(env.app, dent.email);
  const proc = await procedureId(env.db, A.clinicId, "PRE-01");
  const mk = async (first: string, last: string, ci: string, price: number, pays: { amount: number; method: string; budget: boolean }[]) => {
    const p = await createPatient(ownerA, { firstName: first, lastName: last, documentNumber: ci });
    const b = await d.post("/api/budgets", { branchId: A.branches[0], patientId: p, dentistId: dent.id, items: [{ procedureId: proc, unitPriceCents: price }, { procedureId: proc, unitPriceCents: 1000 }] });
    await ownerA.post(`/api/budgets/${b.body.id}/status`, { status: "presented" });
    await ownerA.post(`/api/budgets/${b.body.id}/status`, { status: "accepted" });
    const full = (await ownerA.get(`/api/budgets/${b.body.id}`)).body;
    await d.post(`/api/budget-items/${full.items[0].id}/perform`, {});
    for (const x of pays) {
      const r = await ownerA.post("/api/payments", { branchId: A.branches[0], patientId: p, ...(x.budget ? { budgetId: b.body.id } : {}), amountCents: x.amount, method: x.method,
        ...(x.method === "cash" ? {} : { bankReference: key() }), idempotencyKey: key() });
      if (r.status !== 200) throw new Error(JSON.stringify(r.body));
    }
    return p;
  };
  pDebt = await mk("Rosario", "Quispe Mamani", "4411223", 20000, [{ amount: 5000, method: "cash", budget: true }, { amount: 3000, method: "transfer", budget: true }]);
  pPaid = await mk("Teodoro", "Villca Apaza", "5522334", 8000, [{ amount: 8000, method: "cash", budget: true }, { amount: 500, method: "cash", budget: false }]);
  pNothing = await createPatient(ownerA, { firstName: "Casimira", lastName: "Choque", documentNumber: "6633445" });
  pOpening = await createPatient(ownerA, { firstName: "Importada", lastName: "Saldo Inicial", documentNumber: "6633446" });
  await env.db.adminPool.query("INSERT INTO opening_balances (clinic_id, patient_id, amount_cents, cutoff_date, created_by) VALUES ($1,$2,7000,'2026-01-31',$3)",
    [A.clinicId, pOpening, A.ownerId]);
  pB = await createPatient(await login(env.app, B.ownerEmail), { firstName: "Rosario", lastName: "Quispe Mamani", documentNumber: "4411224" });
}, 60_000);
afterAll(async () => teardown(env));

/** Fórmula de referencia del saldo, por paciente (0019 + saldos iniciales de 0021 + traslados de 0024),
 *  escrita aparte para comprobar que la vista y la función dan exactamente lo mismo. */
const OLD_FORMULA = `
  WITH ch AS (SELECT (COALESCE((SELECT sum(amount_cents - third_party_cents) FROM charges WHERE patient_id = $1), 0)
                    + COALESCE((SELECT sum(amount_cents) FROM payer_transfers WHERE patient_id = $1), 0))::bigint AS v),
       ob AS (SELECT COALESCE(sum(amount_cents), 0)::bigint AS v FROM opening_balances WHERE patient_id = $1),
       pay AS (SELECT COALESCE(sum(amount_cents) FILTER (WHERE status = 'confirmed'), 0)::bigint AS paid,
                      COALESCE(sum(amount_cents) FILTER (WHERE status = 'confirmed' AND budget_id IS NULL), 0)::bigint AS on_account,
                      COALESCE(sum(amount_cents) FILTER (WHERE status = 'pending_verification'), 0)::bigint AS pending,
                      max(received_at) FILTER (WHERE status = 'confirmed') AS last_at FROM payments WHERE patient_id = $1),
       bud AS (SELECT COALESCE(sum(i.net_cents), 0)::bigint AS v FROM budget_items i JOIN budgets b ON b.id = i.budget_id
                WHERE b.patient_id = $1 AND b.status IN ('accepted','completed') AND i.status <> 'cancelled')
  SELECT bud.v AS budgeted_cents, ch.v AS charged_cents, pay.paid AS paid_cents, pay.on_account AS on_account_cents, pay.pending AS pending_cents,
         ch.v + ob.v - pay.paid AS balance_cents, pay.last_at AS last_payment_at, ob.v AS opening_cents FROM ch, ob, pay, bud`;

describe("saldo del paciente (patient_money sobre patient_money_v)", () => {
  it("da exactamente lo mismo que la fórmula anterior, por paciente y en la vista", async () => {
    await withTenant(env.db.appPool, { clinicId: A.clinicId, userId: null }, async (c) => {
      for (const p of [pDebt, pPaid, pNothing, pOpening]) {
        const old = (await c.query(OLD_FORMULA, [p])).rows[0];
        const now = (await c.query("SELECT * FROM patient_money($1)", [p])).rows[0];
        expect(now).toEqual(old);
        const v = (await c.query("SELECT budgeted_cents, charged_cents, paid_cents, on_account_cents, pending_cents, balance_cents, last_payment_at, opening_cents FROM patient_money_v WHERE patient_id = $1", [p])).rows[0];
        expect(v).toEqual(old);
      }
      const debt = (await c.query("SELECT * FROM patient_money($1)", [pDebt])).rows[0];
      expect(debt).toMatchObject({ charged_cents: 20000, paid_cents: 5000, pending_cents: 3000, balance_cents: 15000 });
      // Un paciente inexistente sigue dando una fila con ceros (como antes).
      const none = (await c.query("SELECT * FROM patient_money(gen_random_uuid())")).rows;
      expect(none).toEqual([{ budgeted_cents: 0, charged_cents: 0, paid_cents: 0, on_account_cents: 0, pending_cents: 0, balance_cents: 0, last_payment_at: null, opening_cents: 0 }]);
      // Saldo inicial importado: entra al saldo y se informa aparte.
      expect((await c.query("SELECT balance_cents, opening_cents FROM patient_money($1)", [pOpening])).rows[0]).toEqual({ balance_cents: 7000, opening_cents: 7000 });
    });
  });

  it("la vista respeta RLS de quien consulta: B no ve saldos de A ni A los de B", async () => {
    const n = await withTenant(env.db.appPool, { clinicId: B.clinicId, userId: null }, async (c) =>
      (await c.query("SELECT count(*)::int AS n FROM patient_money_v WHERE patient_id = ANY($1)", [[pDebt, pPaid, pNothing]])).rows[0].n);
    expect(n).toBe(0);
    const viaFn = await withTenant(env.db.appPool, { clinicId: B.clinicId, userId: null }, async (c) =>
      (await c.query("SELECT balance_cents FROM patient_money($1)", [pDebt])).rows[0].balance_cents);
    expect(viaFn).toBe(0);
  });

  it("panel y cuentas por cobrar usan el mismo saldo", async () => {
    const rec = (await ownerA.get("/api/reports/receivables")).body as any[];
    expect(rec.find((x) => x.patientId === pDebt)?.balanceCents).toBe(15000);
    expect(rec.find((x) => x.patientId === pPaid)).toBeUndefined();
    const dash = (await ownerA.get("/api/reports/dashboard")).body;
    // 150 Bs de pDebt + 70 Bs del saldo inicial importado de pOpening.
    expect(rec.find((x) => x.patientId === pOpening)?.balanceCents).toBe(7000);
    expect(dash.finance).toMatchObject({ receivableCents: 22000, patientsWithDebt: 2 });
  });
});

describe("búsqueda de pacientes con patient_search_ids()", () => {
  it("encuentra por apellido, por varias palabras sin tildes, por CI y con un error de tipeo", async () => {
    const ids = async (q: string) => ((await ownerA.get(`/api/patients?q=${encodeURIComponent(q)}`)).body.items as any[]).map((x) => x.id);
    expect(await ids("mamani")).toEqual([pDebt]);
    expect(await ids("ROSARIO quispe")).toEqual([pDebt]);
    expect(await ids("5522334")).toEqual([pPaid]);
    expect(await ids("Teodoro Villcaa")).toContain(pPaid);
    expect(await ids("inexistente")).toEqual([]);
    expect((await ownerA.get("/api/patients")).body.total).toBe(4);
  });

  it("solo devuelve pacientes de la clínica del contexto; sin contexto, nada", async () => {
    const run = (clinicId: string | null) => withTenant(env.db.appPool, { clinicId, userId: null }, async (c) =>
      (await c.query<{ id: string }>("SELECT patient_search_ids('rosario quispe', ARRAY['%quispe%','%rosario%']) AS id")).rows.map((r) => r.id));
    expect(await run(A.clinicId)).toEqual([pDebt]);
    expect(await run(B.clinicId)).toEqual([pB]);
    expect(await run(null)).toEqual([]);
  });
});
