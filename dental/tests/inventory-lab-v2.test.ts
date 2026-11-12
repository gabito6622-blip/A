// v0.9 · B-072 (anular transferencias, consumo real frente al estándar) y B-073 (anular pagos a laboratorio).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, owner2: Agent, asstA: Agent, asstB: Agent, acct: Agent, dent: Agent;
let dentId: string;
const B0 = () => K.branches[0]!;
const B1 = () => K.branches[1]!;
const ZONE = "America/La_Paz";
const today = () => DateTime.now().setZone(ZONE).toISODate()!;
let n = 0;
const sku = () => `V9-${Date.now().toString(36).toUpperCase()}-${n++}`;

async function item(over: Record<string, unknown> = {}) {
  const r = await owner.post("/api/inventory/items", { sku: sku(), name: `Insumo v9 ${n}`, category: "Pruebas", useUnit: "unidad", purchaseUnit: "caja", purchaseFactor: 10, tracksLots: false, ...over });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}
async function receive(agent: Agent, branchId: string, itemId: string, qty: number, unitPriceCents = 50) {
  const r = await agent.post("/api/inventory/receipts", { branchId, itemId, qty, unit: "use", unitPriceCents });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
}
const stockOf = async (itemId: string, branchId: string) =>
  Number((await env.db.adminPool.query("SELECT coalesce((SELECT qty_on_hand FROM inv_stock WHERE item_id = $1 AND branch_id = $2), 0) AS q", [itemId, branchId])).rows[0].q);

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  K2 = await createClinic(env.db, { name: "Otra clínica v9" });
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  asstA = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] })).email);
  asstB = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[1]!] })).email);
  acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
  const d = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
  dentId = d.id;
  dent = await login(env.app, d.email);
});
afterAll(async () => teardown(env));

describe("B-072 · anular una transferencia en tránsito", () => {
  it("todo vuelve al origen con su costo; queda en el historial y en la auditoría", async () => {
    const id = await item();
    await receive(owner, B0(), id, 20, 70);
    const t = await asstA.post("/api/inventory/transfers", { fromBranchId: B0(), toBranchId: B1(), lines: [{ itemId: id, qty: 8 }] });
    expect(t.status, JSON.stringify(t.body)).toBe(200);
    const tid = t.body.id as string;
    expect(await stockOf(id, B0())).toBe(12);

    // Permisos y validación
    expect((await asstA.post(`/api/inventory/transfers/${tid}/cancel`, { reason: "No llegó" })).status).toBe(403); // sin inventory.manage
    expect((await owner.post(`/api/inventory/transfers/${tid}/cancel`, { reason: "x" })).status).toBe(400); // motivo corto
    expect((await owner2.post(`/api/inventory/transfers/${tid}/cancel`, { reason: "Ajena" })).status).toBe(404); // otra clínica

    const r = await owner.post(`/api/inventory/transfers/${tid}/cancel`, { reason: "Se envió por error" });
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(await stockOf(id, B0())).toBe(20);
    expect(await stockOf(id, B1())).toBe(0);
    const lot = (await env.db.adminPool.query("SELECT qty_on_hand, unit_cost FROM inv_lots WHERE item_id = $1 AND branch_id = $2", [id, B0()])).rows[0];
    expect(Number(lot.unit_cost)).toBe(70); // el costo promedio no se altera

    // Ya anulada: no se anula ni se recibe otra vez
    expect((await owner.post(`/api/inventory/transfers/${tid}/cancel`, { reason: "De nuevo" })).status).toBe(409);
    expect((await asstB.post(`/api/inventory/transfers/${tid}/receive`, { lines: [] })).status).toBeGreaterThanOrEqual(400);

    const list = (await owner.get("/api/inventory/transfers?status=cancelled")).body;
    const row = (Array.isArray(list) ? list : list.transfers ?? list.items).find((x: any) => x.id === tid);
    expect(row.status).toBe("cancelled");
    expect(row.cancelReason).toBe("Se envió por error");
    expect(row.cancelledAt).toBeTruthy();
    const au = (await env.db.adminPool.query("SELECT action FROM audit_log WHERE entity_id = $1 ORDER BY created_at", [tid])).rows.map((x) => x.action);
    expect(au).toContain("inventory.transfer_cancelled");
  });

  it("una transferencia recibida no se anula", async () => {
    const id = await item();
    await receive(owner, B0(), id, 5);
    const tid = (await asstA.post("/api/inventory/transfers", { fromBranchId: B0(), toBranchId: B1(), lines: [{ itemId: id, qty: 2 }] })).body.id;
    const lines = (await owner.get(`/api/inventory/transfers?status=in_transit`)).body;
    const tr = (Array.isArray(lines) ? lines : lines.transfers ?? lines.items).find((x: any) => x.id === tid);
    const rec = await asstB.post(`/api/inventory/transfers/${tid}/receive`, { lines: tr.lines.map((l: any) => ({ lineId: l.id, qtyReceived: l.qtySent })) });
    expect(rec.status, JSON.stringify(rec.body)).toBe(200);
    const r = await owner.post(`/api/inventory/transfers/${tid}/cancel`, { reason: "Tarde" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("not_in_transit");
  });
});

describe("B-072 · consumo real frente al estándar", () => {
  it("compara lo descontado y lo pendiente con el estándar, y exporta a Excel", async () => {
    const gloves = await item({ name: "Guantes v9", useUnit: "par" });
    const resin = await item({ name: "Resina v9", useUnit: "dosis" });
    await receive(owner, B0(), gloves, 50);
    const ope = await procedureId(env.db, K.clinicId, "OPE-02");
    expect((await owner.put(`/api/procedures/${ope}/materials`, { items: [{ itemId: gloves, qty: 1, per: "treatment" }, { itemId: resin, qty: 0.5, per: "surface" }] })).status).toBe(200);
    const patient = await createPatient(owner);
    const b = await dent.post("/api/budgets", { branchId: B0(), patientId: patient, dentistId: dentId, items: [{ procedureId: ope, tooth: 16, surfaces: ["O", "M"] }] });
    expect(b.status, JSON.stringify(b.body)).toBe(200);
    expect((await owner.post(`/api/budgets/${b.body.id}/status`, { status: "presented" })).status).toBe(200);
    expect((await owner.post(`/api/budgets/${b.body.id}/status`, { status: "accepted" })).status).toBe(200);
    const full = (await owner.get(`/api/budgets/${b.body.id}`)).body;
    expect((await dent.post(`/api/budget-items/${full.items[0].id}/perform`, {})).status).toBe(200);
    // Un par extra de guantes se gastó a mano (no queda en el informe: solo cuenta lo atado al tratamiento)

    const q = `from=${today()}&to=${today()}&branchId=${B0()}`;
    const r = await owner.get(`/api/inventory/consumption-report?${q}`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.treatments).toBeGreaterThanOrEqual(1);
    const g = r.body.items.find((x: any) => x.itemId === gloves);
    const s = r.body.items.find((x: any) => x.itemId === resin);
    expect(g).toMatchObject({ standardQty: 1, actualQty: 1, pendingQty: 0, differenceQty: 0, differencePct: 0, costCents: 50 });
    expect(s).toMatchObject({ standardQty: 1, actualQty: 0, pendingQty: 1, differenceQty: 0 }); // sin stock: queda pendiente

    // Otra sucursal (sin tratamientos) no los ve; fechas al revés → 400; sin inventory.read → 403
    const other = (await owner.get(`/api/inventory/consumption-report?from=${today()}&to=${today()}&branchId=${B1()}`)).body;
    expect(other.items.find((x: any) => x.itemId === gloves)).toBeUndefined();
    expect((await owner.get(`/api/inventory/consumption-report?from=${today()}&to=2000-01-01`)).status).toBe(400);
    expect((await asstB.get(`/api/inventory/consumption-report?${q}`)).status).toBe(403); // B0 no es su sucursal
    const foreign = (await owner2.get(`/api/inventory/consumption-report?from=${today()}&to=${today()}`)).body;
    expect(foreign.items).toEqual([]);

    const x = await env.app.inject({ method: "GET", url: `/api/inventory/consumption-report.xlsx?${q}`, headers: { cookie: owner.cookie } });
    expect(x.statusCode).toBe(200);
    expect(String(x.headers["content-type"])).toMatch(/spreadsheetml/);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(x.rawPayload as unknown as ArrayBuffer);
    const ws = wb.worksheets[0]!;
    const names: string[] = [];
    ws.eachRow((row) => names.push(String(row.getCell(2).value ?? "")));
    expect(names).toContain("Guantes v9");
  });
});

describe("B-073 · anular un pago a laboratorio", () => {
  let lab: string, order: string;
  beforeAll(async () => {
    lab = (await owner.post("/api/lab/labs", { name: `Lab v9 ${Date.now()}` })).body.id;
    const patient = await createPatient(owner);
    const o = await owner.post("/api/lab/orders", { patientId: patient, labId: lab, dentistId: dentId, branchId: B0(), workType: "crown", teeth: [11], shade: "A2", impression: "digital", material: "Zirconio" });
    expect(o.status, JSON.stringify(o.body)).toBe(200);
    order = o.body.id;
    expect((await owner.post(`/api/lab/orders/${order}/transition`, { to: "sent" })).status).toBe(200);
    expect((await owner.post(`/api/lab/orders/${order}/transition`, { to: "received", costCents: 40000 })).status).toBe(200);
  });

  it("el pago queda en el historial como anulado y la orden vuelve a deberse", async () => {
    const pay = await acct.post("/api/lab/payments", { labId: lab, paidOn: today(), method: "cash", amountCents: 40000 });
    expect(pay.status, JSON.stringify(pay.body)).toBe(200);
    const pid = pay.body.id as string;
    const due = async () => (await owner.get(`/api/lab/payables?labId=${lab}`)).body;
    const before = await due();
    expect(before.orders.find((o: any) => o.id === order)?.outstandingCents ?? 0).toBe(0);

    expect((await acct.post(`/api/lab/payments/${pid}/void`, { reason: "Pago duplicado" })).status).toBe(403); // contabilidad no anula
    expect((await asstA.post(`/api/lab/payments/${pid}/void`, { reason: "Pago duplicado" })).status).toBe(403);
    expect((await owner2.post(`/api/lab/payments/${pid}/void`, { reason: "Pago duplicado" })).status).toBe(404);
    expect((await owner.post(`/api/lab/payments/${pid}/void`, { reason: "x" })).status).toBe(400);

    const v = await owner.post(`/api/lab/payments/${pid}/void`, { reason: "Pago duplicado" });
    expect(v.status, JSON.stringify(v.body)).toBe(200);
    const again = await owner.post(`/api/lab/payments/${pid}/void`, { reason: "Pago duplicado" });
    expect(again.status).toBe(409);
    expect(again.body.error.code).toBe("already_voided");

    const after = await due();
    expect(after.orders.find((o: any) => o.id === order).outstandingCents).toBe(40000);
    const hist = (await owner.get(`/api/lab/payments?labId=${lab}`)).body.find((p: any) => p.id === pid);
    expect(hist.voidReason).toBe("Pago duplicado");
    expect(hist.voidedAt).toBeTruthy();
    const st = (await owner.get(`/api/lab/statement?labId=${lab}&from=${today()}&to=${today()}`)).body;
    expect(JSON.stringify(st)).not.toContain(pid); // el estado de cuenta no cuenta el pago anulado

    // Se puede volver a pagar lo que quedó pendiente
    const detail = (await owner.get(`/api/lab/orders/${order}`)).body;
    expect(detail.paidCents).toBe(0);
    expect(detail.payments[0].voidReason).toBe("Pago duplicado");
    const repay = await acct.post("/api/lab/payments", { labId: lab, paidOn: today(), method: "transfer", reference: "TRX-V9", amountCents: 40000 });
    expect(repay.status, JSON.stringify(repay.body)).toBe(200);

    // Solo inserción: la anulación no se edita ni se borra, ni siquiera desde la base
    await expect(env.db.adminPool.query("UPDATE lab_payment_voids SET reason = 'otro' WHERE payment_id = $1", [pid])).rejects.toThrow();
    await expect(env.db.adminPool.query("DELETE FROM lab_payment_voids WHERE payment_id = $1", [pid])).rejects.toThrow();
    const au = (await env.db.adminPool.query("SELECT action FROM audit_log WHERE entity_id = $1", [pid])).rows.map((x) => x.action);
    expect(au).toContain("lab.payment_voided");
  });
});
