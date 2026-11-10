import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { addUser, createClinic, createPatient, fullSchedule, future, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, OTHER: TestClinic;
let owner: Agent, rec2: Agent;
let dent: { id: string; email: string };
let PRE: string, END: string;
const ZONE = "America/La_Paz";
const today = () => DateTime.now().setZone(ZONE).startOf("day");
const inDays = (n: number) => today().plus({ days: n }).toISODate()!;

const book = async (a: Agent, patientId: string, days: number, hour: number, over: Record<string, unknown> = {}) => {
  const r = await a.post("/api/appointments", { branchId: K.branches[0], dentistId: dent.id, patientId, startsAt: future(days, hour), durationMin: 30, ...over });
  if (r.status !== 200) throw new Error(`book ${r.status} ${JSON.stringify(r.body)}`);
  return r.body as { id: string; recall: { linkedRecallId: string | null; candidates: number } };
};
const complete = async (a: Agent, id: string) => {
  for (const s of ["arrived", "in_progress", "completed"]) expect((await a.post(`/api/appointments/${id}/status`, { status: s })).status).toBe(200);
};
const recall = async (id: string) => (await env.db.adminPool.query("SELECT * FROM recalls WHERE id = $1", [id])).rows[0];
const manual = async (a: Agent, patientId: string, over: Record<string, unknown> = {}) => {
  const r = await a.post("/api/recalls", { patientId, branchId: K.branches[0], reason: "Control general", dueDate: inDays(20), ...over });
  if (r.status !== 200) throw new Error(`recall ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
};

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 2 });
  OTHER = await createClinic(env.db, { branches: 1 });
  owner = await login(env.app, K.ownerEmail);
  dent = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
  for (const b of K.branches) await fullSchedule(env.db, K.clinicId, dent.id, b);
  rec2 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[1]!] })).email);
  PRE = await procedureId(env.db, K.clinicId, "PRE-01");
  END = await procedureId(env.db, K.clinicId, "END-01");
});
afterAll(async () => teardown(env));

describe("intervalo de control por prestación", () => {
  it("el catálogo inicial trae intervalos sugeridos y se editan desde Prestaciones", async () => {
    const list = (await owner.get("/api/procedures")).body;
    const byCode = Object.fromEntries(list.map((p: any) => [p.code, p.recallMonths]));
    expect(byCode).toMatchObject({ "PRE-01": 6, "ORT-01": 1, "IMP-01": 6, "END-01": 12, "CON-01": null });
    const p = list.find((x: any) => x.code === "RX-01");
    const base = { code: p.code, name: p.name, category: p.category, priceCents: p.priceCents, durationMin: p.durationMin, scope: p.scope };
    expect((await owner.put(`/api/procedures/${p.id}`, { ...base, recallMonths: 0 })).status).toBe(400);
    expect((await owner.put(`/api/procedures/${p.id}`, { ...base, recallMonths: 24 })).status).toBe(200);
    expect((await owner.get("/api/procedures")).body.find((x: any) => x.id === p.id).recallMonths).toBe(24);
    // sin el campo no cambia; con null se quita
    await owner.put(`/api/procedures/${p.id}`, base);
    expect((await owner.get("/api/procedures")).body.find((x: any) => x.id === p.id).recallMonths).toBe(24);
    await owner.put(`/api/procedures/${p.id}`, { ...base, recallMonths: null });
    expect((await owner.get("/api/procedures")).body.find((x: any) => x.id === p.id).recallMonths).toBeNull();
  });
});

describe("ciclo de vida del control", () => {
  it("al atender una profilaxis se propone un control a 6 meses; agendarlo lo marca agendado y atenderlo, hecho", async () => {
    const p = await createPatient(owner);
    const a = await book(owner, p, 1, 9, { procedureId: PRE });
    await complete(owner, a.id);
    const sug = (await owner.get(`/api/recalls/suggestion?appointmentId=${a.id}`)).body;
    expect(sug.suggested).toMatchObject({ reason: "Profilaxis (limpieza dental)", months: 6, procedureId: PRE });
    const created = await owner.post("/api/recalls", { patientId: p, sourceAppointmentId: a.id, reason: sug.suggested.reason, months: 6, procedureId: PRE });
    expect(created.status).toBe(200);
    const apptDate = DateTime.fromISO(future(1, 9)).setZone(ZONE);
    expect(created.body.dueDate).toBe(apptDate.plus({ months: 6 }).toISODate());
    const r = await recall(created.body.id);
    expect(r).toMatchObject({ status: "pending", origin: "completion", branch_id: K.branches[0], dentist_id: dent.id });
    // segundo clic: no se duplica
    const again = await owner.post("/api/recalls", { patientId: p, sourceAppointmentId: a.id, reason: "x control", months: 6 });
    expect(again.status).toBe(409);
    // la propuesta ya lo muestra creado
    expect((await owner.get(`/api/recalls/suggestion?appointmentId=${a.id}`)).body.alreadyCreated.id).toBe(created.body.id);
    // agendar al paciente cerca de la fecha objetivo lo vincula solo
    const days = Math.round(DateTime.fromISO(created.body.dueDate, { zone: ZONE }).diff(today(), "days").days) - 10;
    const b = await book(owner, p, days, 10, { procedureId: PRE });
    expect(b.recall).toEqual({ linkedRecallId: created.body.id, candidates: 1 });
    expect(await recall(created.body.id)).toMatchObject({ status: "scheduled", appointment_id: b.id });
    await complete(owner, b.id);
    expect((await recall(created.body.id)).status).toBe("done");
  });

  it("solo se programa desde una cita atendida", async () => {
    const p = await createPatient(owner);
    const a = await book(owner, p, 2, 9);
    const r = await owner.post("/api/recalls", { patientId: p, sourceAppointmentId: a.id, reason: "Control", months: 6 });
    expect(r.status).toBe(409);
  });

  it("\"Ahora no\" queda registrado en la auditoría", async () => {
    const p = await createPatient(owner);
    const a = await book(owner, p, 2, 11);
    await complete(owner, a.id);
    expect((await owner.post("/api/recalls/skip", { appointmentId: a.id })).status).toBe(200);
    const n = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM audit_log WHERE action = 'recall.skipped' AND entity_id = $1", [a.id])).rows[0].n;
    expect(n).toBe(1);
  });

  it("si la cita vinculada se cancela o no asiste, el control vuelve a pendiente", async () => {
    const p = await createPatient(owner);
    const id = await manual(owner, p);
    const a = await book(owner, p, 3, 9);
    expect(a.recall.linkedRecallId).toBe(id);
    expect((await owner.post(`/api/appointments/${a.id}/status`, { status: "cancelled", reason: "Viaje" })).status).toBe(200);
    expect(await recall(id)).toMatchObject({ status: "pending", appointment_id: null });
  });

  it("valida fechas y motivo", async () => {
    const p = await createPatient(owner);
    expect((await owner.post("/api/recalls", { patientId: p, branchId: K.branches[0], reason: "Control", dueDate: inDays(-3) })).status).toBe(400);
    expect((await owner.post("/api/recalls", { patientId: p, branchId: K.branches[0], reason: "Control" })).status).toBe(400);
    expect((await owner.post("/api/recalls", { patientId: p, branchId: K.branches[0], reason: "x", months: 6 })).status).toBe(400);
    expect((await owner.post("/api/recalls", { patientId: p, branchId: K.branches[0], reason: "Control", months: 61 })).status).toBe(400);
  });
});

describe("vínculo automático cita ↔ control", () => {
  it("con 2 controles compatibles no elige solo: se pide elegir", async () => {
    const p = await createPatient(owner);
    const r1 = await manual(owner, p, { reason: "Control de encías" });
    const r2 = await manual(owner, p, { reason: "Control de resina", dueDate: inDays(30) });
    const cands = (await owner.get(`/api/recalls/candidates?patientId=${p}&date=${inDays(4)}`)).body;
    expect(cands.map((x: any) => x.id)).toEqual([r1, r2]);
    const a = await book(owner, p, 4, 9);
    expect(a.recall).toEqual({ linkedRecallId: null, candidates: 2 });
    expect((await recall(r1)).status).toBe("pending");
    // la persona elige
    const b = await book(owner, p, 4, 10, { recallId: r2 });
    expect(b.recall.linkedRecallId).toBe(r2);
    expect(await recall(r2)).toMatchObject({ status: "scheduled", appointment_id: b.id });
    // ya no está pendiente: no se puede volver a elegir
    const c = await owner.post("/api/appointments", { branchId: K.branches[0], dentistId: dent.id, patientId: p, startsAt: future(4, 11), durationMin: 30, recallId: r2 });
    expect(c.status).toBe(409);
  });

  it("recallId null no vincula aunque haya uno compatible", async () => {
    const p = await createPatient(owner);
    const id = await manual(owner, p);
    const a = await book(owner, p, 5, 9, { recallId: null });
    expect(a.recall.linkedRecallId).toBeNull();
    expect((await recall(id)).status).toBe("pending");
  });

  it("no vincula si la prestación no coincide o la cita es muy anterior a la fecha objetivo", async () => {
    const p = await createPatient(owner);
    const endo = await manual(owner, p, { procedureId: END, reason: "Control de endodoncia" });
    const far = await manual(owner, p, { dueDate: inDays(200), reason: "Control anual" });
    const a = await book(owner, p, 5, 11, { procedureId: PRE });
    expect(a.recall).toEqual({ linkedRecallId: null, candidates: 0 });
    expect((await recall(endo)).status).toBe("pending");
    expect((await recall(far)).status).toBe("pending");
  });

  it("no se puede elegir un control de otro paciente", async () => {
    const p = await createPatient(owner);
    const q = await createPatient(owner);
    const id = await manual(owner, q);
    const r = await owner.post("/api/appointments", { branchId: K.branches[0], dentistId: dent.id, patientId: p, startsAt: future(6, 9), durationMin: 30, recallId: id });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("recall_mismatch");
  });
});

describe("intentos de contacto", () => {
  it("3 intentos sin éxito pasan el control a \"revisar\"; reactivar reinicia la cuenta", async () => {
    const p = await createPatient(owner);
    const id = await manual(owner, p);
    const att = (channel: string, outcome: string) => owner.post(`/api/recalls/${id}/attempts`, { channel, outcome, note: "prueba" });
    expect((await att("call", "no_answer")).body).toMatchObject({ status: "pending", failedAttempts: 1 });
    expect((await att("whatsapp", "other")).body).toMatchObject({ status: "pending", failedAttempts: 1 });
    expect((await att("call", "voicemail")).body).toMatchObject({ status: "pending", failedAttempts: 2 });
    expect((await att("sms", "wrong_number")).body).toMatchObject({ status: "review", statusLabel: "Revisar", failedAttempts: 3 });
    expect((await recall(id)).status).toBe("review");
    const hist = (await owner.get(`/api/recalls/${id}/attempts`)).body;
    expect(hist).toHaveLength(4);
    expect(hist[0]).toMatchObject({ channel: "sms", outcome: "wrong_number", outcomeLabel: "Número equivocado", channelLabel: "SMS" });
    expect((await owner.patch(`/api/recalls/${id}`, { reactivate: true })).status).toBe(200);
    expect((await att("call", "no_answer")).body).toMatchObject({ status: "pending", failedAttempts: 1 });
    expect((await owner.patch(`/api/recalls/${id}`, { reactivate: true })).status).toBe(409);
  });

  it("los intentos son de solo inserción y se validan", async () => {
    const p = await createPatient(owner);
    const id = await manual(owner, p);
    expect((await owner.post(`/api/recalls/${id}/attempts`, { channel: "fax", outcome: "no_answer" })).status).toBe(400);
    expect((await owner.post(`/api/recalls/${id}/attempts`, { channel: "call", outcome: "no_answer", note: "x".repeat(501) })).status).toBe(400);
    await owner.post(`/api/recalls/${id}/attempts`, { channel: "call", outcome: "declined" });
    await expect(env.db.adminPool.query("UPDATE recall_attempts SET outcome = 'scheduled' WHERE recall_id = $1", [id])).rejects.toThrow(/solo inserción/);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("DELETE FROM recall_attempts WHERE recall_id = $1", [id]))).rejects.toThrow(/permission denied|solo inserción/);
  });

  it("descartar exige motivo; un control descartado o agendado no recibe intentos", async () => {
    const p = await createPatient(owner);
    const id = await manual(owner, p);
    expect((await owner.post(`/api/recalls/${id}/dismiss`, { reason: "" })).status).toBe(400);
    expect((await owner.post(`/api/recalls/${id}/dismiss`, { reason: "Se mudó a otra ciudad" })).status).toBe(200);
    expect(await recall(id)).toMatchObject({ status: "dismissed", dismiss_reason: "Se mudó a otra ciudad" });
    expect((await owner.post(`/api/recalls/${id}/attempts`, { channel: "call", outcome: "no_answer" })).status).toBe(409);
    const id2 = await manual(owner, p);
    await book(owner, p, 7, 9);
    expect((await recall(id2)).status).toBe("scheduled");
    const d = await owner.post(`/api/recalls/${id2}/dismiss`, { reason: "Ya no" });
    expect(d.status).toBe(409);
    expect(d.body.error.message).toMatch(/cita agendada/);
  });
});

describe("cola de controles y contadores", () => {
  it("cuenta vencen esta semana, atrasados, agendados y conversión del mes", async () => {
    // Clínica nueva para contar exacto
    const C = await createClinic(env.db, { branches: 1 });
    const o = await login(env.app, C.ownerEmail);
    const d = await addUser(env.db, C.clinicId, "dentist", { allBranches: true });
    await fullSchedule(env.db, C.clinicId, d.id, C.branches[0]!);
    const consent = await createPatient(o, { consentReminders: true });
    const noConsent = await createPatient(o, { consentReminders: false });
    const month = today().toFormat("yyyy-MM");
    const ins = (patient: string, due: string, status = "pending", extra = "") => env.db.adminPool.query(
      `INSERT INTO recalls (clinic_id, patient_id, branch_id, reason, due_date, status ${extra ? ", dismiss_reason" : ""}) VALUES ($1,$2,$3,'Higiene dental',$4,$5 ${extra ? ", $6" : ""}) RETURNING id`,
      extra ? [C.clinicId, patient, C.branches[0], due, status, extra] : [C.clinicId, patient, C.branches[0], due, status]).then((r) => r.rows[0].id as string);
    const firstOfMonth = today().startOf("month");
    await ins(consent, inDays(2));                                    // vence esta semana (si cae en el mes, también cuenta en el mes)
    await ins(consent, today().minus({ months: 2 }).toISODate()!);   // atrasado de otro mes
    await ins(noConsent, firstOfMonth.minus({ days: 1 }).toISODate()!); // atrasado del mes anterior
    await ins(consent, today().plus({ months: 3 }).toISODate()!);    // futuro
    await ins(noConsent, firstOfMonth.plus({ days: 20 }).toISODate()!, "dismissed", "Paciente se mudó");
    const sched = await ins(consent, firstOfMonth.plus({ days: 25 }).toISODate()!);
    await o.post("/api/appointments", { branchId: C.branches[0], dentistId: d.id, patientId: consent, startsAt: future(3, 9), durationMin: 30, recallId: sched });
    const r = await o.get(`/api/recalls?month=${month}`);
    expect(r.status).toBe(200);
    const due2InMonth = DateTime.fromISO(inDays(2)).toFormat("yyyy-MM") === month;
    expect(r.body.counters).toMatchObject({ dueThisWeek: 1, overdue: 2, scheduled: 1 });
    // conversión = (agendados + hechos) / controles del mes sin descartados
    expect(r.body.counters.conversion).toEqual({ numerator: 1, denominator: due2InMonth ? 2 : 1, pct: due2InMonth ? 50 : 100 });
    // la vista "activos" muestra pendientes del mes + atrasados; sin el agendado ni el descartado
    expect(r.body.items.every((x: any) => ["pending", "review"].includes(x.status))).toBe(true);
    expect(r.body.items).toHaveLength(due2InMonth ? 3 : 2);
    expect((await o.get(`/api/recalls?month=${month}&overdue=0`)).body.items).toHaveLength(due2InMonth ? 1 : 0);
    expect((await o.get(`/api/recalls?month=${month}&status=scheduled`)).body.items).toHaveLength(1);
    // WhatsApp solo con consentimiento y sin datos clínicos
    const items = r.body.items;
    const withC = items.find((x: any) => x.patientId === consent && x.status === "pending");
    expect(withC.whatsappUrl).toMatch(/^https:\/\/wa\.me\/\d+\?text=/);
    expect(decodeURIComponent(withC.whatsappUrl)).not.toContain("Higiene");
    const without = items.find((x: any) => x.patientId === noConsent && x.status === "pending");
    expect(without.whatsappUrl).toBeNull();
    expect(without.whatsappBlocked).toBe("Sin consentimiento para mensajes");
    // ficha del paciente
    const mine = (await o.get(`/api/patients/${consent}/recalls`)).body;
    expect(mine.length).toBe(4);
  });

  it("los pacientes archivados salen de la cola activa", async () => {
    const p = await createPatient(owner);
    await manual(owner, p, { reason: "Control archivado" });
    expect((await owner.post(`/api/patients/${p}/archive`, { archived: true })).status).toBe(200);
    const items = (await owner.get("/api/recalls?status=active")).body.items;
    expect(items.find((x: any) => x.patientId === p)).toBeUndefined();
    expect((await owner.post("/api/recalls", { patientId: p, branchId: K.branches[0], reason: "Control", months: 6 })).status).toBe(409);
  });
});

describe("permisos y aislamiento", () => {
  it("contabilidad no ve controles; asistente sí puede registrar intentos", async () => {
    const acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
    expect((await acct.get("/api/recalls")).status).toBe(403);
    const p = await createPatient(owner);
    const id = await manual(owner, p);
    const asis = await login(env.app, (await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] })).email);
    expect((await asis.post(`/api/recalls/${id}/attempts`, { channel: "in_person", outcome: "other" })).status).toBe(200);
  });

  it("recepción de otra sucursal no ve ni modifica controles ajenos", async () => {
    const p = await createPatient(owner);
    const id = await manual(owner, p, { reason: "Control sucursal 1" });
    const items = (await rec2.get("/api/recalls?status=all")).body.items;
    expect(items.find((x: any) => x.id === id)).toBeUndefined();
    expect((await rec2.post(`/api/recalls/${id}/attempts`, { channel: "call", outcome: "no_answer" })).status).toBe(403);
    expect((await rec2.post(`/api/recalls/${id}/dismiss`, { reason: "No corresponde" })).status).toBe(403);
    expect((await rec2.post("/api/recalls", { patientId: p, branchId: K.branches[0], reason: "Control", months: 6 })).status).toBe(403);
    expect((await rec2.get(`/api/recalls?branchId=${K.branches[0]}`)).status).toBe(403);
  });

  it("otra clínica no ve ni toca los controles (API y SQL con RLS)", async () => {
    const p = await createPatient(owner);
    const id = await manual(owner, p);
    await owner.post(`/api/recalls/${id}/attempts`, { channel: "call", outcome: "no_answer" });
    const b = await login(env.app, OTHER.ownerEmail);
    expect((await b.get("/api/recalls?status=all")).body.items).toHaveLength(0);
    expect((await b.get(`/api/recalls/${id}/attempts`)).status).toBe(404);
    expect((await b.post(`/api/recalls/${id}/attempts`, { channel: "call", outcome: "no_answer" })).status).toBe(404);
    expect((await b.get(`/api/patients/${p}/recalls`)).status).toBe(404);
    const counts = await withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: null }, async (c) => ({
      recalls: (await c.query("SELECT count(*)::int AS n FROM recalls WHERE clinic_id = $1", [K.clinicId])).rows[0].n,
      attempts: (await c.query("SELECT count(*)::int AS n FROM recall_attempts WHERE clinic_id = $1", [K.clinicId])).rows[0].n,
    }));
    expect(counts).toEqual({ recalls: 0, attempts: 0 });
    await expect(withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: OTHER.ownerId }, (c) =>
      c.query("INSERT INTO recall_attempts (clinic_id, recall_id, channel, outcome, user_id) VALUES ($1,$2,'call','no_answer',$3)", [K.clinicId, id, OTHER.ownerId]),
    )).rejects.toThrow(/row-level security/);
    await expect(withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: OTHER.ownerId }, (c) =>
      c.query("INSERT INTO recalls (clinic_id, patient_id, branch_id, reason, due_date) VALUES ($1,$2,$3,'Robo','2027-01-01')", [OTHER.clinicId, p, OTHER.branches[0]]),
    )).rejects.toThrow(/foreign key/);
    // un UPDATE con contexto ajeno no afecta nada
    const n = await withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: null }, async (c) =>
      (await c.query("UPDATE recalls SET status = 'dismissed', dismiss_reason = 'x' WHERE id = $1", [id])).rowCount);
    expect(n).toBe(0);
  });
});
