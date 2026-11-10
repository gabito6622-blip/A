// Tipos de cita, citas recurrentes (detección de conflictos), operaciones de serie,
// vista semanal / ocupación y línea de tiempo del paciente (R2-18, R2-19, R2-30).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { generateOccurrences, shiftLike } from "../server/src/lib/recurrence.js";
import { addUser, createClinic, createPatient, fullSchedule, future, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

const ZONE = "America/La_Paz";
let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, rec: Agent, recB1: Agent, dentA: Agent, dentB: Agent, owner2: Agent;
let dent1: { id: string; email: string }, dent2: { id: string; email: string };
const B0 = () => K.branches[0]!;
const B1 = () => K.branches[1]!;
const at = (iso: string, k: number, unit: "months" | "weeks" | "days" = "months") => DateTime.fromISO(iso, { zone: ZONE }).plus({ [unit]: k }).toISO()!;

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 2 });
  K2 = await createClinic(env.db, { branches: 1 });
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  dent1 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [B0()] });
  dent2 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [B0(), B1()] });
  await fullSchedule(env.db, K.clinicId, dent1.id, B0());
  await fullSchedule(env.db, K.clinicId, dent2.id, B0());
  await fullSchedule(env.db, K.clinicId, dent2.id, B1());
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B0()] })).email);
  recB1 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B1()] })).email);
  dentA = await login(env.app, dent1.email);
  dentB = await login(env.app, dent2.email);
});
afterAll(async () => teardown(env));

describe("recurrencia (función pura)", () => {
  it("mensual desde el 31: último día de los meses cortos y vuelve al 31", () => {
    const occ = generateOccurrences("2027-01-31T10:00:00-04:00", ZONE, { frequency: "monthly", interval: 1, count: 3 });
    expect(occ.map((o) => DateTime.fromISO(o, { zone: ZONE }).toFormat("yyyy-MM-dd HH:mm"))).toEqual(["2027-01-31 10:00", "2027-02-28 10:00", "2027-03-31 10:00"]);
  });
  it("cada 2 semanas hasta una fecha (inclusive)", () => {
    const occ = generateOccurrences("2027-03-01T08:30:00-04:00", ZONE, { frequency: "weekly", interval: 2, until: "2027-03-29" });
    expect(occ.map((o) => DateTime.fromISO(o, { zone: ZONE }).toISODate())).toEqual(["2027-03-01", "2027-03-15", "2027-03-29"]);
  });
  it("nunca recorta en silencio: más de 52 citas es un error con la cantidad", () => {
    expect(() => generateOccurrences("2027-01-04T08:00:00-04:00", ZONE, { frequency: "weekly", interval: 1, until: "2028-06-30" })).toThrow(/tendría 78 citas; el máximo es 52/);
    expect(() => generateOccurrences("2027-01-04T08:00:00-04:00", ZONE, { frequency: "weekly", interval: 1, count: 53 })).toThrow(/hasta 52|de 1 a 52/);
    expect(() => generateOccurrences("2027-01-04T08:00:00-04:00", ZONE, { frequency: "monthly", interval: 1 })).toThrow(/cuántas veces/);
    expect(generateOccurrences("2027-01-04T08:00:00-04:00", ZONE, { frequency: "weekly", interval: 1, count: 52 })).toHaveLength(52);
  });
  it("esta y las siguientes: mismos días de diferencia y la nueva hora local", () => {
    expect(DateTime.fromISO(shiftLike("2027-05-10T14:00:00.000Z", "2027-04-10T13:00:00.000Z", "2027-04-11T15:30:00-04:00", ZONE), { zone: ZONE }).toFormat("yyyy-MM-dd HH:mm"))
      .toBe("2027-05-11 15:30");
  });
});

describe("tipos de cita", () => {
  it("la clínica recibe los 6 tipos sugeridos al abrir la agenda", async () => {
    const r = await rec.get("/api/appointment-types");
    expect(r.status).toBe(200);
    expect(r.body.map((t: any) => t.name)).toEqual(["Primera vez", "Control", "Urgencia", "Ortodoncia", "Cirugía", "Higiene"]);
    expect(r.body.find((t: any) => t.name === "Ortodoncia").procedureId).toBe(await procedureId(env.db, K.clinicId, "ORT-01"));
  });

  it("CRUD con validación, nombre único y solo administración", async () => {
    const ok = await owner.post("/api/appointment-types", { name: "Endodoncia", color: "#AABBCC", defaultDurationMin: 90 });
    expect(ok.status).toBe(200);
    const list = (await owner.get("/api/appointment-types")).body;
    expect(list.find((t: any) => t.id === ok.body.id)).toMatchObject({ color: "#aabbcc", defaultDurationMin: 90 });
    expect((await owner.post("/api/appointment-types", { name: "endodoncia", color: "#112233", defaultDurationMin: 30 })).body.error.code).toBe("duplicate_name");
    const badColor = await owner.post("/api/appointment-types", { name: "Rojo", color: "red", defaultDurationMin: 30 });
    expect(badColor.status).toBe(400);
    expect(badColor.body.error.message).toMatch(/Color inválido/);
    expect((await owner.post("/api/appointment-types", { name: "Larga", color: "#112233", defaultDurationMin: 600 })).status).toBe(400);
    expect((await rec.post("/api/appointment-types", { name: "Recepción", color: "#112233", defaultDurationMin: 30 })).status).toBe(403);
    expect((await rec.put(`/api/appointment-types/${ok.body.id}`, { name: "X1", color: "#112233", defaultDurationMin: 30 })).status).toBe(403);
    const off = await owner.put(`/api/appointment-types/${ok.body.id}`, { name: "Endodoncia", color: "#aabbcc", defaultDurationMin: 90, active: false });
    expect(off.status).toBe(200);
    expect((await owner.get("/api/appointment-types")).body.some((t: any) => t.id === ok.body.id)).toBe(false);
    expect((await owner.get("/api/appointment-types?all=1")).body.some((t: any) => t.id === ok.body.id)).toBe(true);
    const p = await createPatient(owner);
    const r = await owner.post("/api/appointments", { branchId: B0(), dentistId: dent1.id, patientId: p, startsAt: future(30, 8), appointmentTypeId: ok.body.id });
    expect(r.status).toBe(400);
    expect(r.body.error.message).toBe("El tipo de cita está desactivado");
  });

  it("el tipo precarga la duración y la prestación sugerida; la duración indicada manda", async () => {
    const types = (await rec.get("/api/appointment-types")).body;
    const cir = types.find((t: any) => t.name === "Cirugía");
    const p = await createPatient(rec);
    const r = await rec.post("/api/appointments", { branchId: B0(), dentistId: dent1.id, patientId: p, startsAt: future(31, 10), appointmentTypeId: cir.id });
    expect(r.status).toBe(200);
    const a = (await rec.get(`/api/appointments/${r.body.id}`)).body;
    expect((Date.parse(a.endsAt) - Date.parse(a.startsAt)) / 60_000).toBe(60);
    expect(a.procedureId).toBe(await procedureId(env.db, K.clinicId, "CIR-01"));
    expect(a).toMatchObject({ typeName: "Cirugía", typeColor: "#c2410c", appointmentTypeId: cir.id });
    const r2 = await rec.post("/api/appointments", { branchId: B0(), dentistId: dent1.id, patientId: p, startsAt: future(31, 14), appointmentTypeId: cir.id, durationMin: 20 });
    const a2 = (await rec.get(`/api/appointments/${r2.body.id}`)).body;
    expect((Date.parse(a2.endsAt) - Date.parse(a2.startsAt)) / 60_000).toBe(20);
    // Cambiar el tipo desde la reprogramación/edición
    const ctrl = types.find((t: any) => t.name === "Control");
    expect((await rec.patch(`/api/appointments/${r2.body.id}`, { appointmentTypeId: ctrl.id })).status).toBe(200);
    expect((await rec.get(`/api/appointments/${r2.body.id}`)).body.typeName).toBe("Control");
  });
});

describe("citas recurrentes: detección de conflictos", () => {
  let p1: string, p2: string, p3: string;
  let start: string;
  const chair = () => K.chairs[0]![0]!;
  let preview: any;

  beforeAll(async () => {
    p1 = await createPatient(owner); p2 = await createPatient(owner); p3 = await createPatient(owner);
    start = future(10, 9);
    // occ 2: el paciente ya tiene cita en otra sucursal con otro profesional
    expect((await owner.post("/api/appointments", { branchId: B1(), dentistId: dent2.id, patientId: p1, startsAt: at(start, 1), durationMin: 30 })).status).toBe(200);
    // occ 3: el profesional ya atiende a otro paciente
    expect((await owner.post("/api/appointments", { branchId: B0(), dentistId: dent1.id, patientId: p2, startsAt: at(start, 2), durationMin: 30 })).status).toBe(200);
    // occ 4: bloqueo del profesional (curso)
    const s4 = DateTime.fromISO(at(start, 3), { zone: ZONE });
    await env.db.adminPool.query("INSERT INTO schedule_blocks (clinic_id, dentist_id, branch_id, starts_at, ends_at, reason, created_by) VALUES ($1,$2,$3,$4,$5,'Curso de ortodoncia',$6)",
      [K.clinicId, dent1.id, B0(), s4.set({ hour: 8 }).toJSDate(), s4.set({ hour: 12 }).toJSDate(), K.ownerId]);
    // occ 5: el consultorio está ocupado por otro profesional
    expect((await owner.post("/api/appointments", { branchId: B0(), dentistId: dent2.id, chairId: chair(), patientId: p3, startsAt: at(start, 4), durationMin: 30 })).status).toBe(200);
  });

  const rule = () => ({ branchId: B0(), dentistId: dent1.id, chairId: chair(), patientId: p1, startsAt: start, durationMin: 30, frequency: "monthly", interval: 1, count: 6 });

  it("la vista previa marca cada conflicto con su motivo y sugiere el hueco libre más cercano", async () => {
    const r = await rec.post("/api/appointment-series/preview", rule());
    expect(r.status).toBe(200);
    preview = r.body;
    expect(preview.summary).toEqual({ total: 6, free: 2, conflicts: 4 });
    expect(preview.occurrences.map((o: any) => o.ok)).toEqual([true, false, false, false, false, true]);
    expect(preview.occurrences.map((o: any) => o.conflict?.code ?? null)).toEqual([null, "appointment_overlap_patient", "appointment_overlap_dentist", "blocked", "appointment_overlap_chair", null]);
    expect(preview.occurrences[1].conflict.message).toBe("El paciente ya tiene otra cita en ese horario");
    expect(preview.occurrences[3].conflict.message).toMatch(/Horario bloqueado: Curso de ortodoncia/);
    for (const o of preview.occurrences.filter((x: any) => !x.ok)) {
      expect(o.suggestion).not.toBeNull();
      // mismo día (hay huecos libres ese día)
      expect(DateTime.fromISO(o.suggestion.startsAt, { zone: ZONE }).toISODate()).toBe(DateTime.fromISO(o.startsAt, { zone: ZONE }).toISODate());
    }
    // el más cercano a las 09:00 cuando el profesional está ocupado 09:00–09:30 es 08:30 (fin exclusivo)
    expect(DateTime.fromISO(preview.occurrences[2].suggestion.startsAt, { zone: ZONE }).toFormat("HH:mm")).toBe("08:30");
    // con el bloqueo 08:00–12:00 el más cercano es 07:30
    expect(DateTime.fromISO(preview.occurrences[3].suggestion.startsAt, { zone: ZONE }).toFormat("HH:mm")).toBe("07:30");
  });

  it("valida la regla: más de 52, sin fin y fecha límite anterior se rechazan con mensaje claro", async () => {
    const r1 = await rec.post("/api/appointment-series/preview", { ...rule(), count: undefined, frequency: "weekly", until: DateTime.fromISO(start).plus({ weeks: 60 }).toISODate() });
    expect(r1.status).toBe(400);
    expect(r1.body.error.message).toMatch(/tendría 61 citas; el máximo es 52/);
    expect((await rec.post("/api/appointment-series/preview", { ...rule(), count: 53 })).status).toBe(400);
    expect((await rec.post("/api/appointment-series/preview", { ...rule(), count: undefined })).body.error.message).toMatch(/cuántas veces/);
    expect((await rec.post("/api/appointment-series/preview", { ...rule(), count: undefined, until: "2020-01-01" })).body.error.message).toMatch(/anterior a la primera/);
    expect((await rec.post("/api/appointment-series/preview", { ...rule(), interval: 13 })).body.error.message).toMatch(/1 a 12 meses/);
  });

  it("guarda las libres y las sugeridas en una transacción con un id de serie", async () => {
    const occurrences = preview.occurrences.map((o: any) => ({ startsAt: o.ok ? o.startsAt : o.suggestion.startsAt }));
    const r = await rec.post("/api/appointment-series", { ...rule(), occurrences, idempotencyKey: "series-key-0001" });
    expect(r.status).toBe(200);
    expect(r.body.created).toHaveLength(6);
    expect(r.body.skipped).toHaveLength(0);
    const again = await rec.post("/api/appointment-series", { ...rule(), occurrences, idempotencyKey: "series-key-0001" });
    expect(again.body).toMatchObject({ seriesId: r.body.seriesId, duplicate: true });
    const s = (await rec.get(`/api/appointment-series/${r.body.seriesId}`)).body;
    expect(s.appointments.map((a: any) => a.index)).toEqual([1, 2, 3, 4, 5, 6]);
    const rows = (await env.db.adminPool.query("SELECT DISTINCT series_id FROM appointments WHERE patient_id = $1 AND series_id IS NOT NULL", [p1])).rows;
    expect(rows).toHaveLength(1);
  });

  it("si todas chocan no se guarda nada (ni la serie)", async () => {
    const before = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointment_series WHERE clinic_id = $1", [K.clinicId])).rows[0].n;
    const r = await rec.post("/api/appointment-series", rule());
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("series_all_conflicts");
    const after = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointment_series WHERE clinic_id = $1", [K.clinicId])).rows[0].n;
    expect(after).toBe(before);
  });

  it("sin elegir alternativas guarda solo las libres e informa las que chocan", async () => {
    const p = await createPatient(owner);
    const s = future(12, 15);
    expect((await owner.post("/api/appointments", { branchId: B0(), dentistId: dent2.id, patientId: p2, startsAt: at(s, 2, "weeks"), durationMin: 30 })).status).toBe(200);
    const r = await rec.post("/api/appointment-series", { branchId: B0(), dentistId: dent2.id, patientId: p, startsAt: s, durationMin: 30, frequency: "weekly", interval: 1, count: 4 });
    expect(r.status).toBe(200);
    expect(r.body.created.map((c: any) => c.index)).toEqual([1, 2, 4]);
    expect(r.body.skipped).toEqual([expect.objectContaining({ index: 3, code: "appointment_overlap_dentist" })]);
  });

  it("una ocurrencia en el pasado es un conflicto, y fuera del horario también", async () => {
    const p = await createPatient(owner);
    const r = await rec.post("/api/appointment-series/preview", { branchId: B0(), dentistId: dent1.id, patientId: p, startsAt: future(-5, 22), durationMin: 30, frequency: "weekly", interval: 1, count: 3 });
    expect(r.status).toBe(200);
    expect(r.body.occurrences.map((o: any) => o.conflict?.code)).toEqual(["past", "outside_schedule", "outside_schedule"]);
    expect(r.body.occurrences[0].suggestion).toBeNull();
    expect(r.body.occurrences[1].suggestion).not.toBeNull();
  });

  it("permisos: recepción de otra sucursal no agenda series aquí; el odontólogo solo en su agenda", async () => {
    const p = await createPatient(owner);
    expect((await recB1.post("/api/appointment-series/preview", { ...rule(), patientId: p })).status).toBe(403);
    expect((await dentB.post("/api/appointment-series/preview", { ...rule(), patientId: p })).status).toBe(403);
    expect((await env.app.inject({ method: "POST", url: "/api/appointment-series/preview", payload: rule() })).statusCode).toBe(401);
  });
});

describe("operaciones de serie: solo esta / esta y las siguientes", () => {
  let p: string, seriesId: string, ids: string[], start: string;
  beforeAll(async () => {
    p = await createPatient(owner);
    start = future(20, 16);
    const r = await rec.post("/api/appointment-series", { branchId: B0(), dentistId: dent1.id, patientId: p, startsAt: start, durationMin: 30, frequency: "weekly", interval: 1, count: 5 });
    expect(r.status).toBe(200);
    seriesId = r.body.seriesId;
    ids = r.body.created.map((c: any) => c.id);
    expect(ids).toHaveLength(5);
  });
  const status = async (id: string) => (await rec.get(`/api/appointments/${id}`)).body.status;

  it("cancelar solo esta", async () => {
    const r = await rec.post(`/api/appointment-series/${seriesId}/cancel`, { fromAppointmentId: ids[1], scope: "this", reason: "Paciente de viaje" });
    expect(r.body.cancelled).toBe(1);
    expect(await status(ids[1]!)).toBe("cancelled");
    expect(await status(ids[2]!)).toBe("scheduled");
  });

  it("cancelar esta y las siguientes deja intactas las anteriores", async () => {
    const r = await rec.post(`/api/appointment-series/${seriesId}/cancel`, { fromAppointmentId: ids[3], scope: "following", reason: "Terminó el tratamiento" });
    expect(r.body.cancelled).toBe(2);
    expect([await status(ids[0]!), await status(ids[2]!), await status(ids[3]!), await status(ids[4]!)]).toEqual(["scheduled", "scheduled", "cancelled", "cancelled"]);
    const ev = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = $1 AND to_status = 'cancelled'", [ids[4]])).rows[0].n;
    expect(ev).toBe(1);
    expect((await rec.post(`/api/appointment-series/${seriesId}/cancel`, { fromAppointmentId: ids[4], scope: "this", reason: "otra vez" })).body.error.code).toBe("invalid_status");
    expect((await rec.post(`/api/appointment-series/${seriesId}/cancel`, { fromAppointmentId: ids[0], scope: "this", reason: "" })).status).toBe(400);
  });

  it("reprogramar esta y las siguientes: vista previa con conflicto y guardado parcial", async () => {
    // Nueva hora: un día después a las 17:00. La ocurrencia 3 choca con otra cita del profesional.
    const newStart = DateTime.fromISO(start, { zone: ZONE }).plus({ days: 1 }).set({ hour: 17 }).toISO()!;
    const blocker = await createPatient(owner);
    expect((await owner.post("/api/appointments", { branchId: B0(), dentistId: dent1.id, patientId: blocker, startsAt: at(newStart, 2, "weeks"), durationMin: 30 })).status).toBe(200);
    const pv = await rec.post(`/api/appointment-series/${seriesId}/reschedule`, { fromAppointmentId: ids[0], scope: "following", startsAt: newStart, preview: true });
    expect(pv.status).toBe(200);
    expect(pv.body.occurrences.map((o: any) => [o.index, o.ok])).toEqual([[1, true], [3, false]]);
    expect(pv.body.occurrences[1].conflict.code).toBe("appointment_overlap_dentist");
    expect(pv.body.occurrences[1].suggestion).not.toBeNull();
    const r = await rec.post(`/api/appointment-series/${seriesId}/reschedule`, { fromAppointmentId: ids[0], scope: "following", startsAt: newStart });
    expect(r.status).toBe(200);
    expect(r.body.moved.map((m: any) => m.id)).toEqual([ids[0]]);
    expect(r.body.skipped.map((m: any) => m.id)).toEqual([ids[2]]);
    const a0 = (await rec.get(`/api/appointments/${ids[0]}`)).body;
    expect(DateTime.fromISO(a0.startsAt, { zone: ZONE }).toFormat("HH:mm")).toBe("17:00");
    expect(a0.rescheduleCount).toBe(1);
    const a2 = (await rec.get(`/api/appointments/${ids[2]}`)).body;
    expect(DateTime.fromISO(a2.startsAt, { zone: ZONE }).toFormat("HH:mm")).toBe("16:00");
  });

  it("mover una semana adelante toda la serie no choca consigo misma", async () => {
    const pp = await createPatient(owner);
    const s = future(40, 10);
    const r = await rec.post("/api/appointment-series", { branchId: B0(), dentistId: dent2.id, patientId: pp, startsAt: s, durationMin: 45, frequency: "weekly", interval: 1, count: 3 });
    const sid = r.body.seriesId;
    const first = r.body.created[0].id;
    const m = await rec.post(`/api/appointment-series/${sid}/reschedule`, { fromAppointmentId: first, scope: "following", startsAt: at(s, 1, "weeks") });
    expect(m.status).toBe(200);
    expect(m.body.moved).toHaveLength(3);
    expect(m.body.skipped).toHaveLength(0);
    const list = (await rec.get(`/api/appointment-series/${sid}`)).body.appointments;
    expect(list.map((a: any) => DateTime.fromISO(a.startsAt, { zone: ZONE }).toISODate())).toEqual([1, 2, 3].map((k) => DateTime.fromISO(at(s, k, "weeks")).setZone(ZONE).toISODate()));
  });

  it("permisos y pertenencia: otra sucursal 403, otro odontólogo 403, cita ajena a la serie 404", async () => {
    expect((await recB1.post(`/api/appointment-series/${seriesId}/cancel`, { fromAppointmentId: ids[0], scope: "this", reason: "No corresponde" })).status).toBe(403);
    expect((await dentB.post(`/api/appointment-series/${seriesId}/cancel`, { fromAppointmentId: ids[0], scope: "this", reason: "No corresponde" })).status).toBe(403);
    const other = await createPatient(owner);
    const single = await owner.post("/api/appointments", { branchId: B0(), dentistId: dent1.id, patientId: other, startsAt: future(50, 11), durationMin: 30 });
    expect((await rec.post(`/api/appointment-series/${seriesId}/cancel`, { fromAppointmentId: single.body.id, scope: "this", reason: "No corresponde" })).status).toBe(404);
    // el propio odontólogo sí puede
    expect((await dentA.post(`/api/appointment-series/${seriesId}/reschedule`, { fromAppointmentId: ids[0], scope: "this", startsAt: at(future(20, 18), 0), preview: true })).status).toBe(200);
  });
});

describe("vista semanal y ocupación", () => {
  it("devuelve el horario de cada día de la semana y la ocupación por día", async () => {
    const from = DateTime.now().setZone(ZONE).plus({ days: 7 }).toISODate()!;
    const w = await rec.get(`/api/agenda/week?branchId=${B0()}&from=${from}`);
    expect(w.status).toBe(200);
    expect(w.body.days).toHaveLength(7);
    expect(w.body.days.every((d: any) => d.work.length === 1)).toBe(true);
    expect(DateTime.fromISO(w.body.days[0].work[0].start, { zone: ZONE }).toFormat("HH:mm")).toBe("07:00");
    expect((await recB1.get(`/api/agenda/week?branchId=${B0()}&from=${from}`)).status).toBe(403);
    const day = DateTime.fromISO(future(31, 10), { zone: ZONE });
    const o = await rec.get(`/api/agenda/occupancy?branchId=${B0()}&month=${day.toFormat("yyyy-MM")}`);
    expect(o.status).toBe(200);
    const d = o.body.days.find((x: any) => x.date === day.toISODate());
    expect(d.count).toBeGreaterThanOrEqual(2);
    expect(d.ratio).toBeGreaterThan(0);
    expect(d.capacityMin).toBe(2 * 14 * 60);
    expect((await rec.get(`/api/agenda/occupancy?branchId=${B0()}&month=2026-13`)).status).toBe(400);
  });
});

describe("línea de tiempo del paciente", () => {
  let pt: string;
  let apptId: string;
  beforeAll(async () => {
    pt = await createPatient(owner, { firstName: "Historia" });
    const ctrl = (await rec.get("/api/appointment-types")).body.find((t: any) => t.name === "Control");
    const a = await rec.post("/api/appointments", { branchId: B0(), dentistId: dent1.id, patientId: pt, startsAt: future(3, 9), appointmentTypeId: ctrl.id });
    apptId = a.body.id;
    expect((await rec.post(`/api/appointments/${apptId}/status`, { status: "confirmed" })).status).toBe(200);
    expect((await rec.patch(`/api/appointments/${apptId}`, { startsAt: future(3, 11) })).status).toBe(200);
    expect((await dentA.post(`/api/patients/${pt}/notes`, { branchId: B0(), body: "Dolor en pieza 16 al frío. Se indica control." })).status).toBe(200);
    expect((await dentA.post(`/api/patients/${pt}/odontogram`, { tooth: 16, surfaces: ["O"], condition: "caries", state: "existing" })).status).toBe(200);
    const b = await owner.post("/api/budgets", { branchId: B0(), patientId: pt, dentistId: dent1.id, items: [{ procedureId: await procedureId(env.db, K.clinicId, "OPE-01"), tooth: 16, surfaces: ["O"] }] });
    expect(b.status).toBe(200);
    expect((await rec.post("/api/payments", { branchId: B0(), patientId: pt, amountCents: 5000, method: "cash", idempotencyKey: `tl-pay-${pt}` })).status).toBe(200);
    const tpl = (await owner.get("/api/consent-templates?kind=data_processing")).body[0];
    expect((await owner.post(`/api/patients/${pt}/documents`, { templateId: tpl.id, branchId: B0(), decision: "granted", method: "paper_signed", signerName: "Historia Prueba" })).status).toBe(200);
    const rc = await rec.post("/api/recalls", { patientId: pt, branchId: B0(), reason: "Control de caries", months: 6 });
    expect(rc.status).toBe(200);
    expect((await rec.post(`/api/recalls/${rc.body.id}/attempts`, { channel: "call", outcome: "no_answer" })).status).toBe(200);
    await env.db.adminPool.query(
      `INSERT INTO outbound_messages (clinic_id, branch_id, patient_id, channel, recipient, template, purpose, body, status)
       VALUES ($1,$2,$3,'whatsapp','+59170000000','agenda.reminder','reminders','Hola, te recordamos tu cita.','simulated')`, [K.clinicId, B0(), pt]);
    // Tres intentos fallidos idénticos en el enlace del presupuesto → se agrupan
    for (let i = 0; i < 3; i++) {
      await env.db.adminPool.query("INSERT INTO budget_events (clinic_id, budget_id, kind, created_at) VALUES ($1,$2,'verify_failed', now() + interval '1 hour' + make_interval(secs => $3))",
        [K.clinicId, b.body.id, i]);
    }
  });

  const all = async (a: Agent, q = "") => (await a.get(`/api/patients/${pt}/timeline?limit=200${q}`)).body;

  it("recepción no recibe nada clínico, ni aunque lo pida", async () => {
    const t = await all(rec);
    expect(t.zone).toBe(ZONE);
    expect(t.available.map((x: any) => x.id)).toEqual(["appointments", "budgets", "payments", "documents", "recalls", "messages"]);
    const cats = new Set(t.items.map((i: any) => i.category));
    expect(cats.has("notes") || cats.has("odontogram")).toBe(false);
    for (const c of ["appointments", "budgets", "payments", "documents", "recalls", "messages"]) expect(cats.has(c)).toBe(true);
    expect(JSON.stringify(t)).not.toContain("Dolor en pieza 16");
    expect((await all(rec, "&types=notes,odontogram")).items).toEqual([]);
    expect((await rec.get(`/api/patients/${pt}/timeline?types=secretos`)).status).toBe(400);
  });

  it("el odontólogo ve notas y odontograma, pero no cobros", async () => {
    const t = await all(dentA);
    const cats = new Set(t.items.map((i: any) => i.category));
    expect(cats.has("notes") && cats.has("odontogram")).toBe(true);
    expect(cats.has("payments")).toBe(false);
    expect(t.items.find((i: any) => i.category === "odontogram").title).toBe("Odontograma: pieza 16");
    expect(t.items.find((i: any) => i.category === "notes").detail).toContain("Dolor en pieza 16");
  });

  it("orden cronológico inverso, horas locales y agrupación de repetidos", async () => {
    const t = await all(owner);
    const ts = t.items.map((i: any) => Date.parse(i.at));
    expect([...ts].sort((a, b) => b - a)).toEqual(ts);
    const grouped = t.items.find((i: any) => i.title.startsWith("Verificación fallida"));
    expect(grouped.count).toBe(3);
    expect(t.items[0]).toBe(grouped);
    const created = t.items.find((i: any) => i.kind === "appointment.created");
    expect(created.detail).toMatch(/Control/);
    const moved = t.items.find((i: any) => i.kind === "appointment.rescheduled");
    expect(moved.detail).toMatch(/09:00 a .* 11:00/);
    expect(moved.appointmentLocal).toMatch(/ 11:00$/);
    expect(t.items.find((i: any) => i.title === "Cita confirmada")).toBeTruthy();
    expect(t.items.find((i: any) => i.title.startsWith("Intento de contacto: Llamada, no contesta"))).toBeTruthy();
    expect(t.items.find((i: any) => i.category === "payments" && i.amountCents === 5000)).toBeTruthy();
    expect(t.items.find((i: any) => i.kind === "message").detail).toBe("Hola, te recordamos tu cita.");
  });

  it("paginación por cursor sin repetir ni perder eventos", async () => {
    const full = (await all(owner)).items.flatMap((i: any) => i.ids);
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const r: any = await owner.get(`/api/patients/${pt}/timeline?limit=4${cursor ? `&cursor=${cursor}` : ""}`);
      expect(r.status).toBe(200);
      seen.push(...r.body.items.flatMap((i: any) => i.ids));
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor && pages < 50);
    expect(seen).toEqual(full);
    expect(pages).toBeGreaterThan(2);
    expect((await owner.get(`/api/patients/${pt}/timeline?cursor=bm9wZQ`)).status).toBe(400);
  });

  it("aislamiento: otra clínica no ve la línea de tiempo, los tipos ni las series", async () => {
    expect((await owner2.get(`/api/patients/${pt}/timeline`)).status).toBe(404);
    const mine = (await owner2.get("/api/appointment-types")).body;
    const theirs = (await owner.get("/api/appointment-types?all=1")).body;
    expect(mine.some((t: any) => theirs.some((x: any) => x.id === t.id))).toBe(false);
    expect((await owner2.put(`/api/appointment-types/${theirs[0].id}`, { name: "Robo", color: "#000000", defaultDurationMin: 30 })).status).toBe(404);
    const series = (await env.db.adminPool.query("SELECT id FROM appointment_series WHERE clinic_id = $1 LIMIT 1", [K.clinicId])).rows[0].id;
    expect((await owner2.get(`/api/appointment-series/${series}`)).status).toBe(404);
    // Agendar en la clínica 2 con un tipo de la clínica 1 → rechazado
    const d2 = await addUser(env.db, K2.clinicId, "dentist", { branchIds: [K2.branches[0]!] });
    await fullSchedule(env.db, K2.clinicId, d2.id, K2.branches[0]!);
    const p2 = await createPatient(owner2);
    const r = await owner2.post("/api/appointments", { branchId: K2.branches[0], dentistId: d2.id, patientId: p2, startsAt: future(9, 10), appointmentTypeId: theirs[0].id });
    expect(r.status).toBe(400);
    // SQL directo con el contexto de otra clínica: 0 filas, e INSERT con clinic_id ajeno rechazado por RLS
    await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, async (c) => {
      expect((await c.query("SELECT count(*)::int AS n FROM appointment_types WHERE clinic_id = $1", [K.clinicId])).rows[0].n).toBe(0);
      expect((await c.query("SELECT count(*)::int AS n FROM appointment_series WHERE clinic_id = $1", [K.clinicId])).rows[0].n).toBe(0);
    });
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO appointment_types (clinic_id, name, color) VALUES ($1, 'Intruso', '#000000')", [K.clinicId]))).rejects.toThrow(/row-level security/);
    // La serie es de solo inserción
    await expect(env.db.adminPool.query("UPDATE appointment_series SET duration_min = 10 WHERE id = $1", [series])).rejects.toThrow(/solo inserción/);
  });
});
