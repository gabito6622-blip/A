import { afterAll, beforeAll, describe, expect, it } from "vitest";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { feeFor } from "../server/src/modules/fees.js";
import { initials, isValidFdi, orderLabel } from "../server/src/modules/lab.js";
import { allocateFifo } from "../server/src/modules/labPayables.js";
import { addUser, createClinic, createPatient, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let F: TestClinic, G: TestClinic;
let owner: Agent, gOwner: Agent, dent: Agent, rec: Agent, recB1: Agent, asst: Agent, acct: Agent, limitedAdmin: Agent, support: Agent;
let dentId: string, patient: string, patient2: string, labA: string, labB: string;
const ZONE = "America/La_Paz";
const today = () => DateTime.now().setZone(ZONE).toISODate()!;
const dayOffset = (n: number) => DateTime.now().setZone(ZONE).plus({ days: n }).toISODate()!;
const B0 = () => F.branches[0]!, B1 = () => F.branches[1]!;

async function newOrder(a: Agent, over: Record<string, unknown> = {}) {
  const r = await a.post("/api/lab/orders", {
    patientId: patient, labId: labA, dentistId: dentId, branchId: B0(), workType: "crown", teeth: [11], shade: "A2", impression: "digital", material: "Zirconio", ...over,
  });
  if (r.status !== 200) throw new Error(`newOrder ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
}
const tr = (a: Agent, id: string, to: string, extra: Record<string, unknown> = {}) => a.post(`/api/lab/orders/${id}/transition`, { to, ...extra });
async function receive(a: Agent, id: string, costCents: number, date?: string) {
  expect((await tr(a, id, "sent", date ? { date } : {})).status).toBe(200);
  const r = await tr(a, id, "received", { costCents, ...(date ? { date } : {}) });
  expect(r.status).toBe(200);
}

beforeAll(async () => {
  env = await setupEnv();
  F = await createClinic(env.db);
  G = await createClinic(env.db, { name: "Clínica G" });
  owner = await login(env.app, F.ownerEmail);
  gOwner = await login(env.app, G.ownerEmail);
  const d = await addUser(env.db, F.clinicId, "dentist", { allBranches: true });
  dentId = d.id;
  dent = await login(env.app, d.email);
  rec = await login(env.app, (await addUser(env.db, F.clinicId, "receptionist", { branchIds: [F.branches[0]!] })).email);
  recB1 = await login(env.app, (await addUser(env.db, F.clinicId, "receptionist", { branchIds: [F.branches[1]!] })).email);
  asst = await login(env.app, (await addUser(env.db, F.clinicId, "assistant", { branchIds: [F.branches[0]!] })).email);
  acct = await login(env.app, (await addUser(env.db, F.clinicId, "accountant", { allBranches: true })).email);
  limitedAdmin = await login(env.app, (await addUser(env.db, F.clinicId, "admin", { branchIds: [F.branches[0]!] })).email);
  support = await login(env.app, (await addUser(env.db, F.clinicId, "support", { branchIds: [F.branches[0]!] })).email);
  patient = await createPatient(owner, { firstName: "María José", lastName: "Mamani Quispe" });
  patient2 = await createPatient(owner);
});
afterAll(async () => teardown(env));

describe("funciones puras", () => {
  it("valida FDI, etiqueta el trabajo, minimiza el nombre y reparte pagos FIFO sin perder centavos", () => {
    expect([11, 18, 48, 51, 85].every(isValidFdi)).toBe(true);
    expect([10, 19, 49, 56, 91, 9].some(isValidFdi)).toBe(false);
    expect(orderLabel("crown", [11])).toBe("corona 11");
    expect(orderLabel("bridge", [14, 15, 16])).toBe("puente 14, 15, 16");
    expect(orderLabel("other", [], "Guarda oclusal")).toBe("Guarda oclusal");
    expect(initials("María José", "Mamani Quispe")).toBe("M. J. M. Q.");
    expect(allocateFifo(30000, [{ id: "a", outstandingCents: 25000 }, { id: "b", outstandingCents: 30050 }])).toEqual({
      allocations: [{ orderId: "a", amountCents: 25000 }, { orderId: "b", amountCents: 5000 }], unallocated: 0,
    });
  });
  it("el costo real de laboratorio reemplaza al monto fijo por unidad y nunca supera la base", () => {
    const rule = { category: null, mode: "percent" as const, percentBp: 5000, fixedCents: null, deductCents: 10000, deductActualLab: true };
    expect(feeFor(250000, 1, rule, 80000)).toEqual({ feeCents: 85000, deductCents: 80000 });
    expect(feeFor(60000, 2, rule, null)).toEqual({ feeCents: 20000, deductCents: 20000 });
    expect(feeFor(100000, 1, rule, 120000)).toEqual({ feeCents: 0, deductCents: 100000 });
    expect(feeFor(33333, 1, { ...rule, percentBp: 3550 }, 0)).toEqual({ feeCents: 11833, deductCents: 0 }); // 11833,2
  });
});

describe("laboratorios (catálogo)", () => {
  it("solo gestión de la clínica crea y edita; nombre único; lista de precios por tipo", async () => {
    const r = await owner.post("/api/lab/labs", { name: "Laboratorio Andes", contactName: "Téc. Pérez", whatsapp: "+59170000001", priceList: { crown: 45000, bridge: 40000 } });
    expect(r.status).toBe(200);
    labA = r.body.id;
    labB = (await owner.post("/api/lab/labs", { name: "Dental Lab Illimani" })).body.id;
    expect((await owner.post("/api/lab/labs", { name: "Laboratorio Andes" })).status).toBe(409);
    expect((await owner.post("/api/lab/labs", { name: "X", priceList: { crown: -1 } })).status).toBe(400);
    expect((await owner.post("/api/lab/labs", { name: "Lab Z", priceList: { implant: 100 } })).status).toBe(400);
    expect((await rec.post("/api/lab/labs", { name: "Otro lab" })).status).toBe(403);
    expect((await dent.post("/api/lab/labs", { name: "Otro lab" })).status).toBe(403);
    expect((await dent.patch(`/api/lab/labs/${labA}`, { active: false })).status).toBe(403);
    expect((await owner.patch(`/api/lab/labs/${labB}`, { phone: "2-2440000" })).status).toBe(200);
    const list = (await rec.get("/api/lab/labs")).body;
    expect(list.map((l: any) => l.name)).toEqual(["Dental Lab Illimani", "Laboratorio Andes"]);
    expect(list.find((l: any) => l.id === labA).priceList).toEqual({ crown: 45000, bridge: 40000 });
    expect(list.find((l: any) => l.id === labB).priceList).toEqual({}); // editar el teléfono no borra la lista
    expect((await support.get("/api/lab/labs")).status).toBe(403);
  });
});

describe("órdenes: flujo de estados", () => {
  let id: string;
  it("crea en borrador con piezas FDI y color Vita; valida datos", async () => {
    id = await newOrder(dent, { teeth: [21, 11, 11], promisedOn: dayOffset(7), instructions: "Margen subgingival en vestibular" });
    const o = (await dent.get(`/api/lab/orders/${id}`)).body;
    expect(o).toMatchObject({ status: "draft", teeth: [11, 21], shade: "A2", label: "corona 11, 21", patientInitials: "M. J. M. Q.", labName: "Laboratorio Andes" });
    expect(o.transitions).toEqual(["sent", "cancelled"]);
    expect(o.events.map((e: any) => e.toStatus)).toEqual(["draft"]);
    const bad = async (over: Record<string, unknown>) => (await dent.post("/api/lab/orders", { patientId: patient, labId: labA, dentistId: dentId, branchId: B0(), workType: "crown", ...over })).status;
    expect(await bad({ teeth: [19] })).toBe(400);
    expect(await bad({ shade: "A5" })).toBe(400);
    expect(await bad({ workType: "implante" })).toBe(400);
    expect(await bad({ workType: "other" })).toBe(400); // falta la descripción
    expect(await bad({ costCents: -5 })).toBe(400);
    expect(await bad({ attachmentUrl: "javascript:alert(1)" })).toBe(400);
    expect(await bad({ send: true, promisedOn: dayOffset(-1) })).toBe(400); // prometida antes del envío
    expect(await bad({ dentistId: F.ownerId })).toBe(400); // la propietaria no es profesional
  });

  it("recorre enviado → en proceso → recibido → ajuste (con motivo) → recibido → entregado, con historial inmutable", async () => {
    expect((await tr(dent, id, "received", { costCents: 45000 })).status).toBe(409); // borrador → recibido no
    expect((await tr(dent, id, "sent")).status).toBe(200);
    expect((await tr(dent, id, "in_process")).status).toBe(200);
    expect((await tr(dent, id, "received")).status).toBe(400); // sin costo
    expect((await dent.patch(`/api/lab/orders/${id}`, { costCents: 46000 })).status).toBe(200); // editable antes de recibir
    expect((await tr(rec, id, "received")).status).toBe(200); // recepción registra la llegada con el costo cargado
    expect((await tr(dent, id, "adjustment")).status).toBe(400); // sin motivo
    expect((await tr(dent, id, "adjustment", { reason: "Contacto proximal abierto", promisedOn: dayOffset(3) })).status).toBe(200);
    expect((await tr(dent, id, "delivered")).status).toBe(409); // en ajuste no se entrega
    expect((await tr(dent, id, "received")).status).toBe(200);
    expect((await tr(dent, id, "delivered")).status).toBe(200);
    const o = (await dent.get(`/api/lab/orders/${id}`)).body;
    expect(o).toMatchObject({ status: "delivered", costCents: 46000, receivedOn: today(), deliveredOn: today(), canEdit: false, transitions: [] });
    expect(o.events.map((e: any) => e.toStatus)).toEqual(["draft", "sent", "in_process", "received", "adjustment", "received", "delivered"]);
    expect(o.events.find((e: any) => e.toStatus === "adjustment").reason).toBe("Contacto proximal abierto");
    expect(o.events.every((e: any) => e.byName)).toBe(true);
    expect((await tr(dent, id, "cancelled", { reason: "Paciente desiste" })).status).toBe(409);
    expect((await dent.patch(`/api/lab/orders/${id}`, { instructions: "x" })).status).toBe(409);
    // Eventos: solo inserción incluso para el dueño de la base
    await expect(env.db.adminPool.query("UPDATE lab_order_events SET reason = 'x' WHERE order_id = $1", [id])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM lab_orders WHERE id = $1", [id])).rejects.toThrow(/no se eliminan/);
  });

  it("el costo es editable hasta la recepción e inmutable después (API y base de datos)", async () => {
    const o2 = await newOrder(dent, { costCents: 30000 });
    await receive(dent, o2, 31000);
    expect((await dent.get(`/api/lab/orders/${o2}`)).body.costCents).toBe(31000);
    const p = await dent.patch(`/api/lab/orders/${o2}`, { costCents: 1 });
    expect(p.status).toBe(409);
    expect(p.body.error.code).toBe("lab_cost_locked");
    expect((await dent.patch(`/api/lab/orders/${o2}`, { labId: labB })).status).toBe(409);
    expect((await dent.patch(`/api/lab/orders/${o2}`, { instructions: "Pulir bien" })).status).toBe(200); // lo demás sí
    await expect(env.db.adminPool.query("UPDATE lab_orders SET cost_cents = 1 WHERE id = $1", [o2])).rejects.toThrow(/costo/);
    await expect(env.db.adminPool.query("UPDATE lab_orders SET status = 'draft' WHERE id = $1", [o2])).rejects.toThrow(/no permitido/);
    expect((await tr(dent, o2, "adjustment", { reason: "Color más claro" })).status).toBe(200);
    expect((await tr(dent, o2, "received", { costCents: 99999 })).status).toBe(409); // el reingreso no cambia el costo
    expect((await tr(dent, o2, "received")).status).toBe(200);
    expect((await dent.get(`/api/lab/orders/${o2}`)).body.costCents).toBe(31000);
  });

  it("cancelar exige motivo y solo antes de recibir; fechas futuras rechazadas", async () => {
    const o3 = await newOrder(dent);
    expect((await tr(dent, o3, "cancelled")).status).toBe(400);
    expect((await tr(dent, o3, "sent", { date: dayOffset(2) })).status).toBe(400);
    expect((await tr(dent, o3, "cancelled", { reason: "Se cambió el plan de tratamiento" })).status).toBe(200);
    expect((await tr(dent, o3, "sent")).status).toBe(409);
  });
});

describe("alertas, ficha del paciente y pista de la agenda", () => {
  let late: string, onTime: string, ready: string;
  it("detecta atrasadas contra la fecha prometida", async () => {
    late = await newOrder(dent, { patientId: patient2, workType: "bridge", teeth: [14, 15, 16], send: true, sentOn: dayOffset(-10), promisedOn: dayOffset(-2) });
    onTime = await newOrder(dent, { patientId: patient2, workType: "veneer", teeth: [21], send: true, promisedOn: dayOffset(5) });
    const today0 = await newOrder(dent, { patientId: patient2, workType: "inlay", teeth: [36], send: true, sentOn: dayOffset(-3), promisedOn: today() });
    const ids = (await rec.get("/api/lab/orders?overdue=1")).body.map((o: any) => o.id);
    expect(ids).toContain(late);
    expect(ids).not.toContain(onTime);
    expect(ids).not.toContain(today0); // vence hoy: aún no está atrasada
    const al = (await rec.get("/api/lab/alerts")).body;
    expect(al.overdue.map((o: any) => o.id)).toEqual([late]);
    // Al recibirla deja de estar atrasada
    expect((await tr(rec, late, "received", { costCents: 120000 })).status).toBe(200);
    expect((await rec.get("/api/lab/orders?overdue=1")).body.map((o: any) => o.id)).not.toContain(late);
  });

  it("«recibido sin cita de colocación» hasta que el paciente tenga una cita posterior", async () => {
    ready = late;
    let al = (await rec.get("/api/lab/alerts")).body;
    expect(al.readyNoAppointment.map((o: any) => o.id)).toContain(ready);
    const start = DateTime.now().setZone(ZONE).plus({ days: 2 }).set({ hour: 10, minute: 0 });
    await env.db.adminPool.query(
      `INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status) VALUES ($1,$2,$3,$4,$5,$6,'scheduled')`,
      [F.clinicId, B0(), dentId, patient2, start.toJSDate(), start.plus({ minutes: 45 }).toJSDate()]);
    al = (await rec.get("/api/lab/alerts")).body;
    expect(al.readyNoAppointment.map((o: any) => o.id)).not.toContain(ready);
    expect((await rec.get("/api/lab/orders?readyNoAppointment=1")).body.map((o: any) => o.id)).not.toContain(ready);
  });

  it("la ficha lista los trabajos del paciente y la agenda recibe la pista «listo» y el aviso de fecha prometida", async () => {
    const list = (await rec.get(`/api/lab/orders?patientId=${patient2}`)).body;
    expect(list.length).toBe(3);
    const h = (await rec.get(`/api/lab/patients/${patient2}/hints?date=${dayOffset(1)}`)).body;
    expect(h.ready.map((x: any) => x.label)).toEqual(["puente 14, 15, 16"]);
    const v = h.pending.find((x: any) => x.id === onTime);
    expect(v).toMatchObject({ label: "carilla 21", beforePromised: true, lab: "Laboratorio Andes" });
    const later = (await rec.get(`/api/lab/patients/${patient2}/hints?date=${dayOffset(10)}`)).body;
    expect(later.pending.find((x: any) => x.id === onTime).beforePromised).toBe(false);
  });
});

describe("permisos y sucursales", () => {
  it("lectura con historia clínica o presupuestos; escritura con clinical.write o budgets.write", async () => {
    const id = await newOrder(rec, { branchId: B0() }); // recepción: budgets.write
    expect((await asst.get(`/api/lab/orders/${id}`)).status).toBe(200); // asistente: clinical.read
    expect((await asst.post("/api/lab/orders", { patientId: patient, labId: labA, dentistId: dentId, branchId: B0(), workType: "crown" })).status).toBe(403);
    expect((await tr(asst, id, "sent")).status).toBe(403);
    expect((await acct.get("/api/lab/orders")).status).toBe(200); // contabilidad: budgets.read
    expect((await acct.post("/api/lab/orders", { patientId: patient, labId: labA, dentistId: dentId, branchId: B0(), workType: "crown" })).status).toBe(403);
    expect((await support.get("/api/lab/orders")).status).toBe(403);
    expect((await support.get(`/api/lab/patients/${patient}/hints`)).status).toBe(403);
  });

  it("las órdenes respetan las sucursales permitidas", async () => {
    const id = await newOrder(dent, { branchId: B0() });
    expect((await recB1.get(`/api/lab/orders/${id}`)).status).toBe(404);
    expect((await recB1.get("/api/lab/orders")).body.some((o: any) => o.id === id)).toBe(false);
    expect((await tr(recB1, id, "sent")).status).toBe(404);
    expect((await recB1.post("/api/lab/orders", { patientId: patient, labId: labA, dentistId: dentId, branchId: B0(), workType: "crown" })).status).toBe(403);
    expect((await rec.patch(`/api/lab/orders/${id}`, { branchId: B1() })).status).toBe(403); // no puede moverla a otra sucursal
    expect((await recB1.get(`/api/lab/orders?branchId=${B0()}`)).status).toBe(403);
  });

  it("pagos al laboratorio: payments.verify o clinic.manage, con todas las sucursales", async () => {
    expect((await acct.get("/api/lab/payables")).status).toBe(200);
    expect((await owner.get("/api/lab/payables")).status).toBe(200);
    expect((await rec.get("/api/lab/payables")).status).toBe(403);
    expect((await dent.get("/api/lab/payables")).status).toBe(403);
    expect((await limitedAdmin.get("/api/lab/payables")).status).toBe(403);
    expect((await rec.post("/api/lab/payments", { labId: labB, amountCents: 100, paidOn: today(), method: "cash" })).status).toBe(403);
  });
});

describe("por pagar al laboratorio", () => {
  let o1: string, o2: string, o3: string;
  it("suma lo recibido no pagado y aplica pagos parciales, FIFO y validaciones", async () => {
    o1 = await newOrder(dent, { labId: labB, teeth: [26] });
    o2 = await newOrder(dent, { labId: labB, workType: "removable", teeth: [] });
    o3 = await newOrder(dent, { labId: labB, workType: "splint", teeth: [] }); // enviado, no recibido
    await receive(dent, o1, 45000, dayOffset(-5));
    await receive(dent, o2, 30050, dayOffset(-1));
    expect((await tr(dent, o3, "sent")).status).toBe(200);
    let p = (await acct.get(`/api/lab/payables?labId=${labB}`)).body;
    expect(p.orders.map((o: any) => o.id)).toEqual([o1, o2]);
    expect(p.totalCents).toBe(75050);
    expect(p.labs).toEqual([{ labId: labB, labName: "Dental Lab Illimani", orders: 2, outstandingCents: 75050 }]);
    expect(p.orders[0].patient).toMatch(/^M\. J\. M\. Q\. · ficha \d+$/);

    const pay = (b: Record<string, unknown>) => acct.post("/api/lab/payments", { labId: labB, paidOn: today(), method: "transfer", ...b });
    expect((await pay({ amountCents: 20000, reference: "TRX-1", allocations: [{ orderId: o3, amountCents: 20000 }] })).status).toBe(400); // no recibida
    expect((await pay({ amountCents: 50000, reference: "TRX-1", allocations: [{ orderId: o1, amountCents: 50000 }] })).status).toBe(400); // excede la orden
    expect((await pay({ amountCents: 30000, reference: "TRX-1", allocations: [{ orderId: o1, amountCents: 20000 }] })).status).toBe(400); // suma distinta
    expect((await pay({ amountCents: 20000, allocations: [{ orderId: o1, amountCents: 20000 }] })).status).toBe(400); // falta referencia
    expect((await pay({ amountCents: 20000, reference: "TRX-1", paidOn: dayOffset(1) })).status).toBe(400); // fecha futura
    let r = await pay({ amountCents: 20000, reference: "TRX-1", allocations: [{ orderId: o1, amountCents: 20000 }] });
    expect(r.status).toBe(200);
    expect(r.body.pendingAfterCents).toBe(55050);
    expect((await pay({ amountCents: 100, reference: "TRX-1" })).status).toBe(409); // referencia repetida
    expect((await pay({ amountCents: 55051, reference: "TRX-2" })).status).toBe(400); // más que lo pendiente
    r = await acct.post("/api/lab/payments", { labId: labB, paidOn: today(), method: "cash", amountCents: 30000 });
    expect(r.status).toBe(200);
    expect(r.body.allocations).toEqual([{ orderId: o1, amountCents: 25000 }, { orderId: o2, amountCents: 5000 }]);
    p = (await acct.get(`/api/lab/payables?labId=${labB}`)).body;
    expect(p.orders.map((o: any) => [o.id, o.outstandingCents])).toEqual([[o2, 25050]]);
    expect(p.totalCents).toBe(25050);
    expect((await dent.get(`/api/lab/orders/${o1}`)).body.outstandingCents).toBe(0);
    // Pagos: solo inserción
    await expect(env.db.adminPool.query("UPDATE lab_payments SET amount_cents = 1 WHERE lab_id = $1", [labB])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM lab_payment_allocations WHERE order_id = $1", [o1])).rejects.toThrow(/solo inserción/);
    // La base también impide imputar más que el costo
    await expect(env.db.adminPool.query(
      `INSERT INTO lab_payment_allocations (clinic_id, payment_id, order_id, amount_cents) SELECT clinic_id, id, $1, 1 FROM lab_payments WHERE lab_id = $2 LIMIT 1`,
      [o1, labB])).rejects.toThrow(/excede/);
  });

  it("estado de cuenta por laboratorio y período, y exportaciones a Excel con los mismos totales", async () => {
    // Período que empieza ayer: la orden 1 (hace 5 días) va al saldo inicial
    const s = (await acct.get(`/api/lab/statement?labId=${labB}&from=${dayOffset(-1)}&to=${today()}`)).body;
    expect(s.openingCents).toBe(45000);
    expect(s.debitCents).toBe(30050);
    expect(s.creditCents).toBe(50000);
    expect(s.closingCents).toBe(25050);
    expect(s.movements.map((m: any) => [m.kind, m.debitCents || -m.creditCents, m.balanceCents])).toEqual([
      ["order", 30050, 75050], ["payment", -20000, 55050], ["payment", -30000, 25050],
    ]);
    expect((await acct.get(`/api/lab/statement?labId=${labB}&from=${today()}&to=${dayOffset(-1)}`)).status).toBe(400);
    expect((await rec.get(`/api/lab/statement?labId=${labB}&from=${today()}&to=${today()}`)).status).toBe(403);

    const xl = await env.app.inject({ method: "GET", url: `/api/lab/statement.xlsx?labId=${labB}&from=${dayOffset(-1)}&to=${today()}`, headers: { cookie: acct.cookie } });
    expect(xl.statusCode).toBe(200);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(xl.rawPayload as unknown as ArrayBuffer);
    const ws = wb.getWorksheet("Estado de cuenta")!;
    const last = ws.getRow(ws.rowCount);
    expect([last.getCell(3).value, last.getCell(4).value, last.getCell(5).value]).toEqual([300.5, 500, 250.5]);

    const px = await env.app.inject({ method: "GET", url: "/api/lab/payables.xlsx", headers: { cookie: owner.cookie } });
    expect(px.statusCode).toBe(200);
    const wb2 = new ExcelJS.Workbook();
    await wb2.xlsx.load(px.rawPayload as unknown as ArrayBuffer);
    const ws2 = wb2.getWorksheet("Por pagar")!;
    const total = (await owner.get("/api/lab/payables")).body.totalCents;
    expect(ws2.getRow(ws2.rowCount).getCell(9).value).toBe(total / 100);
    const pays = (await acct.get(`/api/lab/payments?labId=${labB}`)).body;
    expect(pays.map((p: any) => p.amountCents)).toEqual([30000, 20000]);
    expect(pays[0].orders).toEqual([{ number: expect.any(Number), amountCents: 25000 }, { number: expect.any(Number), amountCents: 5000 }]);
  });
});

describe("aislamiento entre clínicas", () => {
  it("otra clínica no ve ni referencia laboratorios, órdenes, eventos ni pagos", async () => {
    const id = (await dent.get("/api/lab/orders")).body[0].id;
    expect((await gOwner.get(`/api/lab/orders/${id}`)).status).toBe(404);
    expect((await gOwner.get("/api/lab/orders")).body).toEqual([]);
    expect((await gOwner.get("/api/lab/labs")).body).toEqual([]);
    expect((await gOwner.get("/api/lab/payables")).body.totalCents).toBe(0);
    expect((await gOwner.get(`/api/lab/statement?labId=${labB}&from=${dayOffset(-30)}&to=${today()}`)).status).toBe(404);
    expect((await gOwner.patch(`/api/lab/labs/${labA}`, { active: false })).status).toBe(404);
    expect((await gOwner.post("/api/lab/payments", { labId: labB, amountCents: 100, paidOn: today(), method: "cash" })).status).toBe(404);
    const gp = await createPatient(gOwner);
    const gDent = await addUser(env.db, G.clinicId, "dentist", { allBranches: true });
    // Laboratorio ajeno → no existe para G
    expect((await gOwner.post("/api/lab/orders", { patientId: gp, labId: labA, dentistId: gDent.id, branchId: G.branches[0], workType: "crown" })).status).toBe(400);
    // SQL directo con el contexto de G: 0 filas en todas las tablas nuevas
    const counts = await withTenant(env.db.appPool, { clinicId: G.clinicId, userId: G.ownerId }, async (c) => {
      const out: Record<string, number> = {};
      for (const t of ["labs", "lab_orders", "lab_order_events", "lab_payments", "lab_payment_allocations"]) out[t] = (await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n;
      return out;
    });
    expect(counts).toEqual({ labs: 0, lab_orders: 0, lab_order_events: 0, lab_payments: 0, lab_payment_allocations: 0 });
    // INSERT con clinic_id ajeno → rechazado por RLS
    await expect(withTenant(env.db.appPool, { clinicId: G.clinicId, userId: G.ownerId }, (c) =>
      c.query("INSERT INTO labs (clinic_id, name) VALUES ($1, 'Intruso')", [F.clinicId]))).rejects.toThrow(/row-level security/);
    // FK compuesta: una orden de G no puede apuntar al laboratorio de F (ni con el rol dueño)
    await expect(env.db.adminPool.query(
      `INSERT INTO lab_orders (clinic_id, number, lab_id, patient_id, dentist_id, branch_id, work_type, created_by) VALUES ($1, 999, $2, $3, $4, $5, 'crown', $6)`,
      [G.clinicId, labA, gp, gDent.id, G.branches[0], G.ownerId])).rejects.toThrow(/foreign key/);
  });
});

describe("honorarios con costo real de laboratorio", () => {
  const now = DateTime.now().setZone(ZONE);
  const month = (k: number) => {
    const s = now.minus({ months: k }).startOf("month");
    return { start: s.toISODate()!, end: s.endOf("month").toISODate()!, at: (day: number) => s.set({ day, hour: 12 }).toJSDate() };
  };
  const P1 = month(2), P2 = month(1);
  let seq = 5000, fd: string, fdA: Agent;
  const q = (sql: string, p: unknown[]) => env.db.adminPool.query(sql, p);
  async function item(code: string, price: number, qty = 1) {
    const b = (await q(`INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status) VALUES ($1,$2,$3,$4,$5,'accepted') RETURNING id`,
      [F.clinicId, ++seq, B0(), patient, fd])).rows[0].id;
    return (await q(`INSERT INTO budget_items (clinic_id, budget_id, procedure_id, description, quantity, unit_price_cents, status) VALUES ($1,$2,$3,$4,$5,$6,'done') RETURNING id`,
      [F.clinicId, b, await procedureId(env.db, F.clinicId, code), code, qty, price])).rows[0].id as string;
  }
  async function charge(itemId: string | null, amount: number, at: Date) {
    return (await q(`INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, dentist_id, description, amount_cents, created_by, created_at)
       VALUES ($1,$2,$3,$4,$5,'Tratamiento',$6,$5,$7) RETURNING id`, [F.clinicId, B0(), patient, itemId, fd, amount, at])).rows[0].id as string;
  }
  async function labFor(itemId: string, cost: number, cancel = false) {
    const id = await newOrder(fdA, { budgetItemId: itemId, labId: labA });
    if (cancel) { expect((await tr(fdA, id, "cancelled", { reason: "Se repite la toma" })).status).toBe(200); return; }
    await receive(fdA, id, cost);
  }

  it("valida la opción: solo porcentaje con base producción", async () => {
    const u = await addUser(env.db, F.clinicId, "dentist", { allBranches: true });
    fd = u.id; fdA = await login(env.app, u.email);
    expect((await owner.put(`/api/fees/config/${fd}`, { base: "collected", rules: [{ mode: "percent", percent: 40, deductActualLab: true }] })).status).toBe(400);
    expect((await owner.put(`/api/fees/config/${fd}`, { base: "production", rules: [{ mode: "fixed", fixedCents: 1000, deductActualLab: true }] })).status).toBe(400);
    const r = await owner.put(`/api/fees/config/${fd}`, {
      base: "production", rules: [{ mode: "percent", percent: 50, deductCents: 10000, deductActualLab: true }, { category: "Operatoria", mode: "percent", percent: 40, deductCents: 500 }],
    });
    expect(r.status).toBe(200);
    const cfg = (await owner.get("/api/fees/config")).body.professionals.find((p: any) => p.dentistId === fd);
    expect(cfg.rules[0]).toMatchObject({ category: null, deductActualLab: true, deductCents: 10000 });
    expect(cfg.rules[1]).toMatchObject({ category: "Operatoria", deductActualLab: false });
  });

  let crownItem: string, sessionItem: string, s1: string;
  it("descuenta el costo real de las órdenes vinculadas; sin órdenes, el monto fijo por unidad (centavos exactos)", async () => {
    crownItem = await item("PRO-01", 250000);
    await labFor(crownItem, 80000);
    await labFor(crownItem, 0, true); // cancelada: no cuenta
    const chCrown = await charge(crownItem, 250000, P1.at(3));
    const plain = await item("PRO-01", 30000, 2);
    const chPlain = await charge(plain, 60000, P1.at(4));
    const cancelledOnly = await item("PRO-01", 50000);
    await labFor(cancelledOnly, 0, true);
    const chCancelled = await charge(cancelledOnly, 50000, P1.at(5));
    const opItem = await item("OPE-01", 25000); // categoría con regla propia sin costo real
    await labFor(opItem, 9000);
    const chOp = await charge(opItem, 25000, P1.at(6));
    // Ítem en sesiones: costo de laboratorio 120000 repartido entre las sesiones, una sola vez
    sessionItem = await item("PRO-01", 350000);
    await labFor(sessionItem, 70000);
    await labFor(sessionItem, 50000);
    const chS1 = await charge(sessionItem, 100000, P1.at(7));
    const chS2 = await charge(sessionItem, 150000, P1.at(8));

    s1 = (await owner.post("/api/fees/settlements", { dentistId: fd, periodStart: P1.start, periodEnd: P1.end })).body.id;
    const d = (await owner.get(`/api/fees/settlements/${s1}`)).body;
    const by = (id: string) => d.lines.find((l: any) => l.chargeId === id);
    expect(by(chCrown)).toMatchObject({ deductCents: 80000, labActualCents: 80000, feeCents: 85000 });
    expect(by(chPlain)).toMatchObject({ deductCents: 20000, labActualCents: null, feeCents: 20000 });
    expect(by(chCancelled)).toMatchObject({ deductCents: 10000, labActualCents: null, feeCents: 20000 });
    expect(by(chOp)).toMatchObject({ deductCents: 500, labActualCents: null, feeCents: 9800 });
    expect(by(chS1)).toMatchObject({ deductCents: 100000, labActualCents: 100000, feeCents: 0 });
    expect(by(chS2)).toMatchObject({ deductCents: 20000, labActualCents: 20000, feeCents: 65000 });
    expect(d.feeTotalCents).toBe(85000 + 20000 + 20000 + 9800 + 0 + 65000);

    // Al cerrar se guarda la parte de costo real por línea
    const c = await owner.post(`/api/fees/settlements/${s1}/close`, {});
    expect(c.status).toBe(200);
    expect(c.body.feeTotalCents).toBe(199800);
    const stored = (await q("SELECT charge_id, lab_actual_cents FROM fee_settlement_lines WHERE settlement_id = $1 AND lab_actual_cents IS NOT NULL ORDER BY lab_actual_cents", [s1])).rows;
    expect(stored.map((r: any) => Number(r.lab_actual_cents))).toEqual([20000, 80000, 100000]);
  });

  it("en el período siguiente no vuelve a descontar el costo ya liquidado del mismo ítem", async () => {
    const chS3 = await charge(sessionItem, 100000, P2.at(3));
    const s2 = (await owner.post("/api/fees/settlements", { dentistId: fd, periodStart: P2.start, periodEnd: P2.end })).body.id;
    const d = (await owner.get(`/api/fees/settlements/${s2}`)).body;
    expect(d.lines.find((l: any) => l.chargeId === chS3)).toMatchObject({ deductCents: 0, labActualCents: 0, feeCents: 50000 });
  });
});
