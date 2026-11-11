// Convenios, pagador distinto, pendiente de facturar y conciliación bancaria (R2-32, B-021).
import { randomUUID } from "node:crypto";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { withTenant } from "../server/src/lib/db.js";
import { applyMapping, parseAmountCell, parseCsv, parseDateCell, readTable, suggestMapping } from "../server/src/modules/agreements/statementFile.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, O: TestClinic;
let owner: Agent, admin: Agent, acct: Agent, rec: Agent, dent: Agent, otherOwner: Agent;
let dentId: string;
const B = () => K.branches[0]!;
const key = () => `ag-${randomUUID()}`;
const today = () => DateTime.now().setZone("America/La_Paz").toISODate()!;
const P: Record<string, string> = {};

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  O = await createClinic(env.db, { name: "Otra clínica" });
  owner = await login(env.app, K.ownerEmail);
  otherOwner = await login(env.app, O.ownerEmail);
  admin = await login(env.app, (await addUser(env.db, K.clinicId, "admin", { allBranches: true })).email);
  acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
  const d = await addUser(env.db, K.clinicId, "dentist", { branchIds: [B()] });
  dentId = d.id;
  dent = await login(env.app, d.email);
  for (const code of ["OPE-01", "END-01", "PRE-01", "CIR-01", "PRO-01"]) P[code] = await procedureId(env.db, K.clinicId, code);
});
afterAll(async () => teardown(env));

async function newAgreement(over: Record<string, unknown> = {}) {
  const r = await owner.post("/api/agreements", {
    name: `Empresa Ficticia ${randomUUID().slice(0, 6)}`, kind: "company", taxId: "1020304050", billingName: "Empresa Ficticia S.R.L.",
    validFrom: DateTime.fromISO(today()).minus({ months: 1 }).toISODate(), companySharePercent: 70, rules: [], ...over,
  });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body;
}
async function enroll(patientId: string, agreementId: string, a: Agent = rec, over: Record<string, unknown> = {}) {
  const r = await a.post(`/api/patients/${patientId}/agreements`, { agreementId, memberNumber: `AF-${randomUUID().slice(0, 5)}`, validFrom: DateTime.fromISO(today()).minus({ days: 10 }).toISODate(), ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}
async function acceptedBudget(patientId: string, items: Record<string, unknown>[]) {
  const r = await owner.post("/api/budgets", { branchId: B(), patientId, dentistId: dentId, items });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  await owner.post(`/api/budgets/${r.body.id}/status`, { status: "presented" });
  await owner.post(`/api/budgets/${r.body.id}/status`, { status: "accepted" });
  return (await owner.get(`/api/budgets/${r.body.id}`)).body;
}
async function perform(itemId: string) {
  const r = await dent.post(`/api/budget-items/${itemId}/perform`, {});
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.chargeId as string;
}
const charge = async (id: string) => (await env.db.adminPool.query("SELECT amount_cents, third_party_cents, payer_agreement_id FROM charges WHERE id = $1", [id])).rows[0];
const money = async (patientId: string) => (await env.db.adminPool.query(
  `SELECT m.*, (SELECT COALESCE(sum(amount_cents),0)::bigint FROM charges WHERE patient_id = $1) AS total_charges,
          (SELECT COALESCE(sum(third_party_cents),0)::bigint FROM charges WHERE patient_id = $1) AS third
     FROM patient_money($1) m`, [patientId])).rows[0];

// ---------------------------------------------------------------------------
describe("convenios: precios copiados en la línea", () => {
  let ag: any, patient: string, budget: any;

  it("aplica precio especial, % por categoría y % general, y guarda la copia (precio de lista incluido)", async () => {
    ag = await newAgreement({
      defaultDiscountPercent: 5,
      rules: [{ procedureId: P["OPE-01"], priceCents: 12345 }, { category: "Endodoncia", discountPercent: 15 }],
    });
    expect(ag.rules).toHaveLength(2);
    patient = await createPatient(owner);
    await enroll(patient, ag.id);
    const prices = (await rec.get(`/api/patients/${patient}/agreement-prices`)).body;
    expect(prices.agreement).toMatchObject({ id: ag.id, companySharePercent: 70 });
    expect(prices.prices.find((p: any) => p.procedureId === P["OPE-01"]).unitPriceCents).toBe(12345);

    budget = await acceptedBudget(patient, [
      { procedureId: P["OPE-01"], tooth: 36, surfaces: ["O"] },
      { procedureId: P["END-01"], tooth: 21 },
      { procedureId: P["PRE-01"] },
    ]);
    const [ope, end, pre] = budget.items;
    expect([ope.unitPriceCents, end.unitPriceCents, pre.unitPriceCents]).toEqual([12345, 76500, 19000]);
    expect([ope.listUnitPriceCents, end.listUnitPriceCents, pre.listUnitPriceCents]).toEqual([25000, 90000, 20000]);
    expect(ope.agreementNote).toMatch(/precio especial/);
    expect(end.agreementNote).toMatch(/15 % en Endodoncia/);
    expect(pre.agreementNote).toMatch(/5 %/);
    expect(budget.agreementName).toBe(ag.name);
  });

  it("cambiar el convenio NO altera presupuestos hechos; los nuevos toman el precio nuevo", async () => {
    const upd = await owner.put(`/api/agreements/${ag.id}`, { ...ag, taxId: ag.taxId, validTo: null, companyCapCents: null, rules: [{ procedureId: P["OPE-01"], priceCents: 11111 }] });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    const again = (await owner.get(`/api/budgets/${budget.id}`)).body;
    expect(again.items[0].unitPriceCents).toBe(12345);
    expect(again.items[0].companySharePercent).toBe(70);
    const b2 = await owner.post("/api/budgets", { branchId: B(), patientId: patient, dentistId: dentId, items: [{ procedureId: P["OPE-01"], tooth: 11, surfaces: ["M"] }] });
    const d2 = (await owner.get(`/api/budgets/${b2.body.id}`)).body;
    expect(d2.items[0].unitPriceCents).toBe(11111);
    // La base congela la copia del convenio en un presupuesto presentado.
    await expect(env.db.adminPool.query("UPDATE budget_items SET company_share_percent = 10 WHERE id = $1", [budget.items[0].id])).rejects.toThrow(/convenio/);
    // Una nueva versión conserva la copia (no toma el precio nuevo).
    await owner.post(`/api/budgets/${b2.body.id}/status`, { status: "presented" });
    await owner.put(`/api/agreements/${ag.id}`, { ...ag, validTo: null, companyCapCents: null, rules: [{ procedureId: P["OPE-01"], priceCents: 10000 }] });
    const v = await owner.post(`/api/budgets/${b2.body.id}/versions`, { confirm: true });
    expect(v.status).toBe(200);
    const dv = (await owner.get(`/api/budgets/${v.body.id}`)).body;
    expect(dv.items[0]).toMatchObject({ unitPriceCents: 11111, listUnitPriceCents: 25000, companySharePercent: 70 });
  });

  it("un precio manual se respeta y se puede presupuestar sin convenio", async () => {
    const r = await owner.post("/api/budgets", { branchId: B(), patientId: patient, dentistId: dentId, items: [
      { procedureId: P["PRE-01"], unitPriceCents: 15000 }, { procedureId: P["PRE-01"], applyAgreement: false }] });
    const d = (await owner.get(`/api/budgets/${r.body.id}`)).body;
    expect(d.items[0]).toMatchObject({ unitPriceCents: 15000, agreementNote: expect.stringMatching(/precio manual/) });
    expect(d.items[1].unitPriceCents).toBe(20000);
    expect(d.items[1].agreementNote).toBeUndefined();
  });

  it("afiliaciones: sin superposición, baja con motivo y validaciones claras", async () => {
    const p2 = await createPatient(owner);
    const pa = await enroll(p2, ag.id);
    const dup = await rec.post(`/api/patients/${p2}/agreements`, { agreementId: ag.id, memberNumber: "X1", validFrom: today() });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("agreement_overlap");
    expect((await rec.post(`/api/patient-agreements/${pa}/end`, { endDate: today(), reason: "x" })).status).toBe(400);
    expect((await rec.post(`/api/patient-agreements/${pa}/end`, { endDate: today(), reason: "Dejó la empresa" })).status).toBe(200);
    const list = (await rec.get(`/api/patients/${p2}/agreements`)).body;
    expect(list[0]).toMatchObject({ endReason: "Dejó la empresa", validTo: today() });
    const bad = await owner.post("/api/agreements", { name: "Mal", validFrom: "2026-05-01", validTo: "2026-04-01", rules: [{ category: "Cirugía", priceCents: 100 }] });
    expect(bad.status).toBe(400);
    const badCat = await owner.post("/api/agreements", { name: "Cat inexistente", validFrom: "2026-01-01", rules: [{ category: "Astrología", discountPercent: 10 }] });
    expect(badCat.status).toBe(400);
    expect(badCat.body.error.message).toMatch(/no existe/);
  });
});

// ---------------------------------------------------------------------------
describe("pagador distinto: copago al centavo, tope anual y saldo del paciente", () => {
  let ag: any, patient: string, budget: any, cOpe: string, cEnd: string;

  it("la porción de la empresa se calcula al centavo con centavos impares (70 % de 123,45 = 86,42)", async () => {
    ag = await newAgreement({ rules: [{ procedureId: P["OPE-01"], priceCents: 12345 }, { category: "Endodoncia", discountPercent: 15 }] });
    patient = await createPatient(owner);
    await enroll(patient, ag.id);
    budget = await acceptedBudget(patient, [{ procedureId: P["OPE-01"], tooth: 36, surfaces: ["O"] }, { procedureId: P["END-01"], tooth: 21 }]);
    cOpe = await perform(budget.items[0].id);
    const ch = await charge(cOpe);
    expect(ch).toMatchObject({ amount_cents: 12345, third_party_cents: 8642, payer_agreement_id: ag.id });
    // La aplicación no puede fijar la porción: el trigger la recalcula.
    await withTenant(env.db.appPool, { clinicId: K.clinicId, userId: K.ownerId }, async (c) => {
      const r = await c.query(`INSERT INTO charges (clinic_id, branch_id, patient_id, description, amount_cents, created_by, payer_agreement_id, third_party_cents)
                               VALUES ($1,$2,$3,'Cargo suelto',1001,$4,$5,1000) RETURNING third_party_cents, payer_agreement_id`, [K.clinicId, B(), patient, K.ownerId, ag.id]);
      expect(r.rows[0]).toMatchObject({ third_party_cents: 0, payer_agreement_id: null });
      await c.query("ROLLBACK"); await c.query("BEGIN");
    });
  });

  it("patient_money excluye la parte de la empresa y el total cuadra (paciente + empresa = cargos)", async () => {
    const m = await money(patient);
    expect(Number(m.charged_cents)).toBe(3703);
    expect(Number(m.balance_cents)).toBe(3703);
    expect(Number(m.charged_cents) + Number(m.third)).toBe(Number(m.total_charges));
    const acc = (await owner.get(`/api/patients/${patient}/account`)).body;
    expect(acc.balanceCents).toBe(3703);
    expect(acc.charges[0]).toMatchObject({ thirdPartyCents: 8642, payerName: ag.name });
    const ficha = (await owner.get(`/api/patients/${patient}`)).body;
    expect(ficha.account.balance).toBe(3703);
  });

  it("el paciente no puede pagar la parte de la empresa en el presupuesto", async () => {
    const d = (await owner.get(`/api/budgets/${budget.id}`)).body;
    // 8642 cargado + 70 % de 76 500 estimado = 62 192 de la empresa; el paciente 88 845 − 62 192 = 26 653.
    expect(d.companyCents).toBe(62192);
    expect(d.patientShareCents).toBe(26653);
    expect(d.remainingCents).toBe(26653);
    const over = await owner.post("/api/payments", { branchId: B(), patientId: patient, budgetId: budget.id, amountCents: 26654, method: "cash", idempotencyKey: key() });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe("overpayment");
    const ok = await owner.post("/api/payments", { branchId: B(), patientId: patient, budgetId: budget.id, amountCents: 26653, method: "cash", idempotencyKey: key() });
    expect(ok.status).toBe(200);
    cEnd = await perform(budget.items[1].id);
    expect(await charge(cEnd)).toMatchObject({ amount_cents: 76500, third_party_cents: 53550 });
    const m = await money(patient);
    expect(Number(m.charged_cents)).toBe(3703 + 22950);
    expect(Number(m.balance_cents)).toBe(0); // el paciente pagó exactamente su parte
  });

  it("tope anual por paciente: 50 % hasta 100,01 Bs; el excedente lo paga el paciente; anular libera el tope", async () => {
    const capAg = await newAgreement({ companySharePercent: 50, companyCapCents: 10001, rules: [{ procedureId: P["CIR-01"], priceCents: 12345 }] });
    const p = await createPatient(owner);
    await enroll(p, capAg.id);
    const b = await acceptedBudget(p, [{ procedureId: P["CIR-01"], tooth: 18 }, { procedureId: P["CIR-01"], tooth: 28 }, { procedureId: P["CIR-01"], tooth: 38 }]);
    const c1 = await perform(b.items[0].id);
    const c2 = await perform(b.items[1].id);
    const c3 = await perform(b.items[2].id);
    expect((await charge(c1)).third_party_cents).toBe(6173); // 61,725 → 61,73 (mitad hacia arriba)
    expect((await charge(c2)).third_party_cents).toBe(3828); // 100,01 − 61,73
    expect(await charge(c3)).toMatchObject({ third_party_cents: 0, payer_agreement_id: null });
    expect(Number((await money(p)).charged_cents)).toBe(3 * 12345 - 10001);
    const list = (await owner.get(`/api/patients/${p}/agreements`)).body;
    expect(list[0].companyUsedThisYearCents).toBe(10001);
    // Anular el segundo cargo: asiento negativo con la misma porción → el tope vuelve a tener 38,28.
    const v = await owner.post(`/api/charges/${c2}/void`, { reason: "Error de registro" });
    const vc = (await env.db.adminPool.query("SELECT third_party_cents FROM charges WHERE id = $1", [v.body.id])).rows[0];
    expect(Number(vc.third_party_cents)).toBe(-3828);
    const again = await perform(b.items[1].id);
    expect((await charge(again)).third_party_cents).toBe(3828);
  });

  it("afiliación vencida o convenio inactivo: paga todo el paciente", async () => {
    const ag2 = await newAgreement({ rules: [] });
    const p = await createPatient(owner);
    const pa = await enroll(p, ag2.id);
    const b = await acceptedBudget(p, [{ procedureId: P["PRE-01"] }]);
    await rec.post(`/api/patient-agreements/${pa}/end`, { endDate: DateTime.fromISO(today()).minus({ days: 1 }).toISODate(), reason: "Fin de contrato laboral" });
    const ch = await perform(b.items[0].id);
    expect((await charge(ch)).third_party_cents).toBe(0);
    expect(Number((await money(p)).balance_cents)).toBe(20000);
  });

  // ---------------- pagos de la empresa ----------------
  let payId: string;
  it("pago de la empresa aplicado a varios cargos: queda por verificar y otra persona lo confirma", async () => {
    const open = (await admin.get(`/api/agreements/${ag.id}/charges`)).body;
    expect(open.map((x: any) => x.dueCents).sort()).toEqual([53550, 8642].sort());
    const ref = `TRF-EMP-${randomUUID().slice(0, 6)}`;
    const body = { branchId: B(), amountCents: 28642, method: "transfer", bankReference: ref, idempotencyKey: key(),
      allocations: [{ chargeId: cOpe, amountCents: 8642 }, { chargeId: cEnd, amountCents: 20000 }] };
    const mismatch = await admin.post(`/api/agreements/${ag.id}/payments`, { ...body, idempotencyKey: key(), amountCents: 28643 });
    expect(mismatch.status).toBe(400);
    expect(mismatch.body.error.code).toBe("allocation_mismatch");
    const exceeds = await admin.post(`/api/agreements/${ag.id}/payments`, { ...body, idempotencyKey: key(), amountCents: 60000, allocations: [{ chargeId: cEnd, amountCents: 60000 }] });
    expect(exceeds.status).toBe(409);
    expect(exceeds.body.error.code).toBe("allocation_exceeds");
    const r = await admin.post(`/api/agreements/${ag.id}/payments`, body);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.status).toBe("pending_verification");
    payId = r.body.id;
    const dup = await admin.post(`/api/agreements/${ag.id}/payments`, body);
    expect(dup.body).toMatchObject({ id: payId, duplicate: true });
    // Mientras está por verificar, lo aplicado no se puede volver a aplicar
    const again = await admin.post(`/api/agreements/${ag.id}/payments`, { ...body, idempotencyKey: key(), bankReference: `${ref}-2`, amountCents: 8642, allocations: [{ chargeId: cOpe, amountCents: 8642 }] });
    expect(again.status).toBe(409);
    // Control dual
    const self = await admin.post(`/api/payer-payments/${payId}/verify`, { decision: "confirmed" });
    expect(self.status).toBe(403);
    expect((await acct.post(`/api/payer-payments/${payId}/verify`, { decision: "confirmed" })).status).toBe(200);
    const rx = (await acct.get("/api/payers/receivables")).body.find((x: any) => x.id === ag.id);
    expect(rx).toMatchObject({ billedCents: 62192, paidCents: 28642, pendingCents: 0, balanceCents: 33550, openCharges: 1 });
    // El saldo del paciente no cambia con el pago de la empresa.
    expect(Number((await money(patient)).balance_cents)).toBe(0);
  });

  it("la referencia bancaria es única también entre pagos de pacientes y de empresas", async () => {
    const ref = `QR-CRUCE-${randomUUID().slice(0, 6)}`;
    expect((await owner.post("/api/payments", { branchId: B(), patientId: patient, amountCents: 1000, method: "qr", bankReference: ref, idempotencyKey: key() })).status).toBe(200);
    const r = await admin.post(`/api/agreements/${ag.id}/payments`, { branchId: B(), amountCents: 1000, method: "qr", bankReference: ref, idempotencyKey: key(), allocations: [{ chargeId: cEnd, amountCents: 1000 }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("duplicate_bank_reference");
  });

  it("estado de cuenta de la empresa: saldo inicial, movimientos y saldo final; Excel y PDF con verificación", async () => {
    const st = (await acct.get(`/api/agreements/${ag.id}/statement?from=${today()}&to=${today()}`)).body;
    expect(st).toMatchObject({ openingCents: 0, debitCents: 62192, creditCents: 28642, closingCents: 33550 });
    expect(st.movements.at(-1).balanceCents).toBe(33550);
    expect(st.movements.filter((m: any) => m.kind === "charge").every((m: any) => m.memberNumber)).toBe(true);
    const later = (await acct.get(`/api/agreements/${ag.id}/statement?from=${DateTime.fromISO(today()).plus({ days: 1 }).toISODate()}&to=${DateTime.fromISO(today()).plus({ days: 2 }).toISODate()}`)).body;
    expect(later).toMatchObject({ openingCents: 33550, closingCents: 33550, movements: [] });
    const x = await env.app.inject({ method: "GET", url: `/api/agreements/${ag.id}/statement.xlsx?from=${today()}&to=${today()}`, headers: { cookie: acct.cookie } });
    expect(x.statusCode).toBe(200);
    expect(String(x.headers["content-type"])).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    const vals = wb.worksheets[0]!.getSheetValues().flat().filter((v) => typeof v === "number");
    expect(vals).toContain(335.5);
    const pdf = await env.app.inject({ method: "GET", url: `/api/agreements/${ag.id}/statement.pdf?from=${today()}&to=${today()}`, headers: { cookie: acct.cookie } });
    expect(pdf.statusCode).toBe(200);
    expect(pdf.rawPayload.subarray(0, 4).toString()).toBe("%PDF");
    const code = String(pdf.headers["x-verify-code"]);
    const ver = await env.app.inject({ method: "GET", url: `/api/public/verify/${code}` });
    expect(ver.json()).toMatchObject({ found: true, intact: true, kind: "payer_statement", kindLabel: "Estado de cuenta de convenio" });
  });

  it("anular un pago confirmado de la empresa devuelve el saldo a los cargos", async () => {
    expect((await acct.post(`/api/payer-payments/${payId}/void`, { reason: "Error" })).status).toBe(403); // contabilidad no anula
    expect((await owner.post(`/api/payer-payments/${payId}/void`, { reason: "Transferencia devuelta" })).status).toBe(200);
    const rx = (await acct.get("/api/payers/receivables")).body.find((x: any) => x.id === ag.id);
    expect(rx.balanceCents).toBe(62192);
    await expect(env.db.adminPool.query("UPDATE payer_payments SET amount_cents = 1 WHERE id = $1", [payId])).rejects.toThrow(/no se modifican/);
    await expect(env.db.adminPool.query("DELETE FROM payer_payment_allocations WHERE payment_id = $1", [payId])).rejects.toThrow(/solo inserción/);
  });

  // ---------------- pendiente de facturar ----------------
  it("facturación parcial: por pagador, nunca más de lo pendiente; anular libera", async () => {
    const inv = (await owner.get(`/api/budgets/${budget.id}/invoiceable`)).body;
    expect(inv.buyers.agreement).toMatchObject({ taxId: "1020304050", docType: "NIT" });
    const ope = inv.lines.find((l: any) => l.itemId === budget.items[0].id);
    expect(ope).toMatchObject({ netCents: 12345, companyCents: 8642, patientCents: 3703, pendingCompanyCents: 8642, pendingPatientCents: 3703 });
    const base = { budgetId: budget.id, billTo: "agreement", buyerDocType: "NIT", buyerTaxId: "1020304050", buyerName: "Empresa Ficticia S.R.L." };
    const ok = await rec.post("/api/invoice-requests", { ...base, lines: [{ budgetItemId: ope.itemId, amountCents: 8642 }] });
    expect(ok.status, JSON.stringify(ok.body)).toBe(200);
    const more = await rec.post("/api/invoice-requests", { ...base, lines: [{ budgetItemId: ope.itemId, amountCents: 1 }] });
    expect(more.status).toBe(409);
    expect(more.body.error.code).toBe("invoice_exceeds");
    const pat = { budgetId: budget.id, billTo: "patient", buyerDocType: "CI", buyerTaxId: "4567890", buyerName: "Paciente Prueba" };
    expect((await rec.post("/api/invoice-requests", { ...pat, lines: [{ budgetItemId: ope.itemId, amountCents: 3704 }] })).status).toBe(409);
    const fam = await rec.post("/api/invoice-requests", { ...pat, billTo: "other", buyerName: "Madre responsable", lines: [{ budgetItemId: ope.itemId, amountCents: 3703 }] });
    expect(fam.status).toBe(200);
    expect((await rec.post("/api/invoice-requests", { ...pat, buyerDocType: "NIT", buyerTaxId: "12A", lines: [{ budgetItemId: budget.items[1].id, amountCents: 100 }] })).status).toBe(400);
    const list = (await acct.get(`/api/invoice-requests?budgetId=${budget.id}`)).body;
    expect(list.map((x: any) => x.statusLabel)).toEqual(["Pendiente de facturar", "Pendiente de facturar"]);
    expect((await rec.post(`/api/invoice-requests/${ok.body.id}/cancel`, { reason: "Datos de NIT errados" })).status).toBe(403);
    expect((await owner.post(`/api/invoice-requests/${ok.body.id}/cancel`, { reason: "Datos de NIT errados" })).status).toBe(200);
    expect((await rec.post("/api/invoice-requests", { ...base, lines: [{ budgetItemId: ope.itemId, amountCents: 8642 }] })).status).toBe(200);
    // Defensa en la base: aunque la app fallara, no se marca más que la línea.
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: K.ownerId }, (c) =>
      c.query("INSERT INTO invoice_request_lines (clinic_id, request_id, budget_item_id, description, amount_cents) VALUES ($1,$2,$3,'x',1)", [K.clinicId, fam.body.id, ope.itemId]),
    )).rejects.toThrow(/más de lo pendiente/);
    await expect(env.db.adminPool.query("UPDATE invoice_requests SET total_cents = 1 WHERE id = $1", [fam.body.id])).rejects.toThrow(/anularse/);
  });

  it("facturación por sesión y solo de presupuestos aceptados", async () => {
    const tpl = await owner.put(`/api/procedures/${P["PRO-01"]}/sessions`, { sessions: [{ name: "Toma de medidas", amountCents: 100000 }, { name: "Colocación", amountCents: 150000 }] });
    expect(tpl.status).toBe(200);
    const p = await createPatient(owner);
    const draft = await owner.post("/api/budgets", { branchId: B(), patientId: p, dentistId: dentId, items: [{ procedureId: P["PRO-01"], tooth: 16 }] });
    const pend = { budgetId: draft.body.id, billTo: "patient", buyerDocType: "CI", buyerTaxId: "123", buyerName: "Paciente" };
    expect((await rec.post("/api/invoice-requests", { ...pend, lines: [{ budgetItemId: (await owner.get(`/api/budgets/${draft.body.id}`)).body.items[0].id, amountCents: 100 }] })).body.error.code).toBe("budget_not_accepted");
    const b = await acceptedBudget(p, [{ procedureId: P["PRO-01"], tooth: 26 }]);
    const inv = (await owner.get(`/api/budgets/${b.id}/invoiceable`)).body;
    const s1 = inv.lines[0].sessions[0];
    expect(s1.amountCents).toBe(100000);
    const base = { budgetId: b.id, billTo: "patient", buyerDocType: "CI", buyerTaxId: "123", buyerName: "Paciente" };
    expect((await rec.post("/api/invoice-requests", { ...base, lines: [{ budgetItemId: inv.lines[0].itemId, sessionId: s1.id, amountCents: 100001 }] })).status).toBe(409);
    expect((await rec.post("/api/invoice-requests", { ...base, lines: [{ budgetItemId: inv.lines[0].itemId, sessionId: s1.id, amountCents: 100000 }] })).status).toBe(200);
    const after = (await owner.get(`/api/budgets/${b.id}/invoiceable`)).body;
    expect(after.lines[0]).toMatchObject({ pendingPatientCents: 150000 });
    expect(after.lines[0].sessions[0].pendingCents).toBe(0);
    await owner.put(`/api/procedures/${P["PRO-01"]}/sessions`, { sessions: [] });
  });

  it("la línea de tiempo del paciente muestra la afiliación, la parte del convenio y lo marcado para facturar", async () => {
    const t = (await owner.get(`/api/patients/${patient}/timeline`)).body;
    const titles = t.items.map((i: any) => `${i.title} ${i.detail ?? ""}`).join("\n");
    expect(titles).toMatch(/Afiliado al convenio/);
    expect(titles).toMatch(/paga el convenio 86,42 Bs/);
    expect(titles).toMatch(/pendiente de facturar/);
  });
});

// ---------------------------------------------------------------------------
describe("lectura del extracto (CSV y Excel)", () => {
  it("montos y fechas en formatos bolivianos y de banco", () => {
    expect(parseAmountCell("1.234,56")).toBe(123456);
    expect(parseAmountCell("1,234.56")).toBe(123456);
    expect(parseAmountCell("Bs 150,5")).toBe(15050);
    expect(parseAmountCell("-15,00")).toBe(-1500);
    expect(parseAmountCell("(20.00)")).toBe(-2000);
    expect(parseAmountCell("1.234")).toBe(123400);
    expect(parseAmountCell(99.99)).toBe(9999);
    expect(parseAmountCell("abc")).toBeNull();
    expect(parseDateCell("05/11/2026")).toBe("2026-11-05");
    expect(parseDateCell("2026-11-05")).toBe("2026-11-05");
    expect(parseDateCell("11/05/2026", "mdy")).toBe("2026-11-05");
    expect(parseDateCell("31/02/2026")).toBeNull();
    expect(parseDateCell(46331)).toBe("2026-11-05");
  });

  it("CSV con comillas y punto y coma; detecta la fila de títulos aunque haya un encabezado del banco", () => {
    const rows = parseCsv('﻿Banco Ficticio S.A.;;;\nFecha;Descripción;Nro. operación;Abono\n05/11/2026;"Pago; con punto y coma";OP-1;"1.500,00"\n');
    expect(rows).toHaveLength(3);
    const m = suggestMapping(rows)!;
    expect(m).toMatchObject({ headerRow: 1, date: 0, description: 1, reference: 2, amount: 3 });
    const parsed = applyMapping(rows, m);
    expect(parsed[0]).toMatchObject({ date: "2026-11-05", description: "Pago; con punto y coma", reference: "OP-1", amountCents: 150000, status: "ok" });
  });

  it("Excel (.xlsx): fechas y montos numéricos; filas idénticas tienen huellas distintas", async () => {
    const wb = new ExcelJS.Workbook();
    const ws = wb.addWorksheet("Extracto");
    ws.addRow(["Fecha", "Concepto", "Referencia", "Importe"]);
    ws.addRow([new Date(Date.UTC(2026, 10, 5)), "Depósito", "D-1", 250.75]);
    ws.addRow([new Date(Date.UTC(2026, 10, 5)), "Depósito", "D-1", 250.75]);
    const rows = await readTable(Buffer.from(await wb.xlsx.writeBuffer()));
    const parsed = applyMapping(rows, suggestMapping(rows)!);
    expect(parsed.map((r) => r.amountCents)).toEqual([25075, 25075]);
    expect(parsed[0]!.hash).not.toBe(parsed[1]!.hash);
  });
});

// ---------------------------------------------------------------------------
describe("conciliación bancaria por extracto", () => {
  let patient: string, pExact: string, pSugg: string, pAdmin: string;
  const refExact = `QR-${randomUUID().slice(0, 6).toUpperCase()}`;
  const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64");
  let csv: string;

  beforeAll(async () => {
    patient = await createPatient(owner);
    const d = DateTime.fromISO(today()).toFormat("dd/MM/yyyy");
    pExact = (await rec.post("/api/payments", { branchId: B(), patientId: patient, amountCents: 15050, method: "qr", bankReference: refExact, idempotencyKey: key() })).body.id;
    pSugg = (await rec.post("/api/payments", { branchId: B(), patientId: patient, amountCents: 23333, method: "transfer", bankReference: `TRX-${randomUUID().slice(0, 6)}`, idempotencyKey: key() })).body.id;
    pAdmin = (await admin.post("/api/payments", { branchId: B(), patientId: patient, amountCents: 47777, method: "transfer", bankReference: `ADM-${randomUUID().slice(0, 6)}`, idempotencyKey: key() })).body.id;
    csv = [
      "Banco Ficticio S.A. · Extracto de cuenta (datos inventados)",
      "Fecha;Descripción;Referencia;Abono",
      `${d};Pago QR cliente;${refExact.toLowerCase()};150,50`,
      `${d};Transferencia recibida;OTRA-REF-1;233,33`,
      `${d};Transferencia administración;OTRA-REF-2;477,77`,
      `${d};Depósito sin identificar;ZZZ-1;999,99`,
      `${d};Depósito sin identificar;ZZZ-1;999,99`,
      `${d};Comisión de mantenimiento;;-15,00`,
      "fecha rota;Fila mala;;abc",
    ].join("\n");
  });

  it("recepción no concilia ni ve extractos", async () => {
    expect((await rec.post("/api/bank-statements/preview", { fileBase64: b64(csv), fileName: "ext.csv" })).status).toBe(403);
    expect((await rec.get("/api/bank-lines")).status).toBe(403);
    expect((await dent.get("/api/bank-statements")).status).toBe(403);
  });

  let lines: any[];
  it("vista previa: mapea columnas, detecta exacta y sugerida, débitos y errores, sin guardar nada", async () => {
    const pv = await acct.post("/api/bank-statements/preview", { fileBase64: b64(csv), fileName: "ext.csv" });
    expect(pv.status, JSON.stringify(pv.body)).toBe(200);
    expect(pv.body.mapping).toMatchObject({ headerRow: 1, date: 0, description: 1, reference: 2, amount: 3 });
    expect(pv.body.summary).toMatchObject({ total: 7, credits: 5, debits: 1, errors: 1, duplicates: 0, toImport: 5, exact: 1, suggested: 2 });
    expect(Number((await env.db.adminPool.query("SELECT count(*) FROM bank_statement_lines WHERE clinic_id = $1", [K.clinicId])).rows[0].count)).toBe(0);
  });

  it("importar guarda los abonos sin verificar ningún pago; reimportar no duplica", async () => {
    const r = await acct.post("/api/bank-statements", { fileBase64: b64(csv), fileName: "ext.csv", accountLabel: "Banco Ficticio cta. 1-234" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ imported: 5, duplicates: 0, skipped: 2 });
    const st = (await env.db.adminPool.query("SELECT status FROM payments WHERE id = ANY($1)", [[pExact, pSugg, pAdmin]])).rows;
    expect(st.every((x) => x.status === "pending_verification")).toBe(true); // nunca se verifica solo
    const again = await acct.post("/api/bank-statements", { fileBase64: b64(csv), fileName: "ext-copia.csv", accountLabel: "Banco Ficticio cta. 1-234" });
    expect(again.body).toMatchObject({ imported: 0, duplicates: 5 });
    const pv = await acct.post("/api/bank-statements/preview", { fileBase64: b64(csv), fileName: "ext.csv" });
    expect(pv.body.summary).toMatchObject({ duplicates: 5, toImport: 0 });
    const list = (await acct.get("/api/bank-statements")).body;
    expect(list[0]).toMatchObject({ importedRows: 0, duplicateRows: 5 });
    lines = (await acct.get("/api/bank-lines?status=unmatched")).body;
    expect(lines).toHaveLength(5);
  });

  it("confirmar la exacta verifica el pago (por quien concilia); el movimiento y el pago no se usan dos veces", async () => {
    const lx = lines.find((l) => l.amountCents === 15050);
    expect(lx.candidates[0]).toMatchObject({ id: pExact, matchKind: "exact", canConfirm: true });
    const r = await acct.post(`/api/bank-lines/${lx.id}/match`, { paymentId: pExact });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.matchKind).toBe("exact");
    const p = (await env.db.adminPool.query("SELECT status, verified_by, status_reason FROM payments WHERE id = $1", [pExact])).rows[0];
    expect(p.status).toBe("confirmed");
    expect(p.status_reason).toMatch(/Conciliado con el extracto/);
    expect((await acct.post(`/api/bank-lines/${lx.id}/match`, { paymentId: pSugg })).body.error.code).toBe("line_used");
    const other = lines.find((l) => l.amountCents === 99999);
    expect((await acct.post(`/api/bank-lines/${other.id}/match`, { paymentId: pExact })).status).toBe(409);
  });

  it("sugerida por monto y fecha: se confirma solo si una persona lo decide; montos distintos no se emparejan", async () => {
    const ls = lines.find((l) => l.amountCents === 23333);
    expect(ls.candidates[0]).toMatchObject({ id: pSugg, matchKind: "suggested" });
    const wrong = lines.find((l) => l.amountCents === 99999);
    const mm = await acct.post(`/api/bank-lines/${wrong.id}/match`, { paymentId: pSugg });
    expect(mm.body.error.code).toBe("amount_mismatch");
    const r = await acct.post(`/api/bank-lines/${ls.id}/match`, { paymentId: pSugg });
    expect(r.body.matchKind).toBe("suggested");
    expect((await env.db.adminPool.query("SELECT status FROM payments WHERE id = $1", [pSugg])).rows[0].status).toBe("confirmed");
  });

  it("control dual: quien registró el pago no lo concilia; los movimientos sin pago quedan para revisión o se descartan con motivo", async () => {
    const la = lines.find((l) => l.amountCents === 47777);
    const self = await admin.post(`/api/bank-lines/${la.id}/match`, { paymentId: pAdmin });
    expect(self.status).toBe(403);
    const fresh = (await admin.get("/api/bank-lines?status=unmatched")).body.find((l: any) => l.id === la.id);
    expect(fresh.candidates[0]).toMatchObject({ canConfirm: false, blockedReason: expect.stringMatching(/control dual/) });
    expect((await acct.post(`/api/bank-lines/${la.id}/match`, { paymentId: pAdmin })).status).toBe(200);
    const unk = lines.filter((l) => l.amountCents === 99999);
    expect(unk[0].candidates).toEqual([]);
    expect((await acct.post(`/api/bank-lines/${unk[0].id}/ignore`, { reason: "no" })).status).toBe(400);
    expect((await acct.post(`/api/bank-lines/${unk[0].id}/ignore`, { reason: "Depósito de la propia clínica" })).status).toBe(200);
    const left = (await acct.get("/api/bank-lines?status=unmatched")).body;
    expect(left.map((l: any) => l.id)).toEqual([unk[1].id]);
    await expect(env.db.adminPool.query("UPDATE bank_statement_lines SET amount_cents = 1 WHERE id = $1", [unk[1].id])).rejects.toThrow(/no se modifican/);
    await expect(env.db.adminPool.query("DELETE FROM bank_statements WHERE clinic_id = $1", [K.clinicId])).rejects.toThrow(/solo inserción/);
  });

  it("concilia también pagos de empresas por verificar", async () => {
    const ag = await newAgreement({ rules: [] });
    const p = await createPatient(owner);
    await enroll(p, ag.id);
    const b = await acceptedBudget(p, [{ procedureId: P["PRE-01"] }]);
    const ch = await perform(b.items[0].id);
    const ref = `EMP-${randomUUID().slice(0, 6)}`;
    const pay = await admin.post(`/api/agreements/${ag.id}/payments`, { branchId: B(), amountCents: 14000, method: "transfer", bankReference: ref, idempotencyKey: key(), allocations: [{ chargeId: ch, amountCents: 14000 }] });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const d = DateTime.fromISO(today()).toFormat("dd/MM/yyyy");
    await acct.post("/api/bank-statements", { fileBase64: b64(`Fecha,Detalle,Referencia,Monto\n${d},Pago empresa,${ref},140.00\n`), fileName: "e2.csv", accountLabel: "Banco Ficticio" });
    const line = (await acct.get("/api/bank-lines?status=unmatched")).body.find((l: any) => l.reference === ref);
    expect(line.candidates[0]).toMatchObject({ kind: "payer_payment", id: pay.body.id, matchKind: "exact" });
    expect((await acct.post(`/api/bank-lines/${line.id}/match`, { payerPaymentId: pay.body.id })).status).toBe(200);
    expect((await acct.get("/api/payers/receivables")).body.find((x: any) => x.id === ag.id)).toMatchObject({ paidCents: 14000, balanceCents: 0 });
  });
});

// ---------------------------------------------------------------------------
describe("permisos y aislamiento entre clínicas", () => {
  let ag: any;
  beforeAll(async () => { ag = await newAgreement({ rules: [{ category: "Cirugía", discountPercent: 10 }] }); });

  it("recepción: ve convenios y afilia, pero no crea convenios ni ve cuentas de empresas (una sucursal)", async () => {
    expect((await rec.get("/api/agreements")).status).toBe(200);
    expect((await rec.post("/api/agreements", { name: "Intento", validFrom: today() })).status).toBe(403);
    expect((await rec.get("/api/payers/receivables")).status).toBe(403);
    expect((await rec.get(`/api/agreements/${ag.id}/statement?from=${today()}&to=${today()}`)).status).toBe(403);
    expect((await dent.post("/api/invoice-requests", { budgetId: randomUUID(), billTo: "patient", buyerDocType: "CI", buyerTaxId: "1", buyerName: "Xx", lines: [{ budgetItemId: randomUUID(), amountCents: 1 }] })).status).toBe(403);
    expect((await acct.post("/api/agreements", { name: "Contabilidad no", validFrom: today() })).status).toBe(403);
  });

  it("otra clínica no ve ni usa convenios, pagos, solicitudes ni movimientos ajenos", async () => {
    expect((await otherOwner.get(`/api/agreements/${ag.id}`)).status).toBe(404);
    expect((await otherOwner.get("/api/agreements")).body).toEqual([]);
    expect((await otherOwner.get("/api/bank-lines?status=matched")).body).toEqual([]);
    expect((await otherOwner.get("/api/invoice-requests")).body).toEqual([]);
    expect((await otherOwner.get("/api/payer-payments")).body).toEqual([]);
    const pO = await createPatient(otherOwner);
    const cross = await otherOwner.post(`/api/patients/${pO}/agreements`, { agreementId: ag.id, memberNumber: "X", validFrom: today() });
    expect(cross.status).toBe(404);
    const tables = ["agreements", "agreement_rules", "patient_agreements", "payer_payments", "payer_payment_allocations", "payer_statements",
      "invoice_requests", "invoice_request_lines", "bank_statements", "bank_statement_lines"];
    await withTenant(env.db.appPool, { clinicId: O.clinicId, userId: null }, async (c) => {
      for (const t of tables) {
        const n = (await c.query(`SELECT count(*)::int AS n FROM ${t} WHERE clinic_id = $1`, [K.clinicId])).rows[0].n;
        expect(n, t).toBe(0);
      }
    });
    const real = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM bank_statement_lines WHERE clinic_id = $1", [K.clinicId])).rows[0].n;
    expect(real).toBeGreaterThan(0);
    await expect(withTenant(env.db.appPool, { clinicId: O.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO agreements (clinic_id, name, valid_from) VALUES ($1, 'Intrusa', '2026-01-01')", [K.clinicId]))).rejects.toThrow(/row-level security/);
    // FK compuesta: un paciente de O no puede apuntar a un convenio de K
    await expect(withTenant(env.db.appPool, { clinicId: O.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO patient_agreements (clinic_id, patient_id, agreement_id, member_number, valid_from) VALUES ($1,$2,$3,'X','2026-01-01')", [O.clinicId, pO, ag.id]))).rejects.toThrow();
  });
});
