import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { addUser, createClinic, createPatient, fullSchedule, future, login, procedureId, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic;
let owner: Agent;
let dent1: { id: string; email: string }, dent2: { id: string; email: string };
let p1: string, p2: string, p3: string;
const B = () => K.branches[0]!;

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 2 });
  owner = await login(env.app, K.ownerEmail);
  dent1 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
  dent2 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!, K.branches[1]!] });
  await fullSchedule(env.db, K.clinicId, dent1.id, B());
  await fullSchedule(env.db, K.clinicId, dent2.id, B());
  await fullSchedule(env.db, K.clinicId, dent2.id, K.branches[1]!);
  p1 = await createPatient(owner); p2 = await createPatient(owner); p3 = await createPatient(owner);
});
afterAll(async () => teardown(env));

const book = (a: Agent, over: Record<string, unknown>) =>
  a.post("/api/appointments", { branchId: B(), dentistId: dent1.id, patientId: p1, startsAt: future(5, 9), durationMin: 30, ...over });

describe("agenda: solapamientos garantizados por la base de datos", () => {
  it("agenda una cita válida", async () => {
    const r = await book(owner, { startsAt: future(5, 8) });
    expect(r.status).toBe(200);
  });

  it("rechaza el mismo profesional en un horario superpuesto (aunque sea otro paciente)", async () => {
    expect((await book(owner, { startsAt: future(6, 10), patientId: p1 })).status).toBe(200);
    const r = await book(owner, { startsAt: future(6, 10, 15), patientId: p2 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("appointment_overlap_dentist");
  });

  it("permite citas contiguas (fin exclusivo)", async () => {
    expect((await book(owner, { startsAt: future(6, 10, 30), patientId: p2 })).status).toBe(200);
  });

  it("rechaza el mismo consultorio ocupado por otro profesional", async () => {
    const chair = K.chairs[0]![0];
    expect((await book(owner, { startsAt: future(7, 11), chairId: chair, patientId: p1 })).status).toBe(200);
    const r = await book(owner, { startsAt: future(7, 11), chairId: chair, dentistId: dent2.id, patientId: p2 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("appointment_overlap_chair");
  });

  it("rechaza al mismo paciente en dos lugares a la vez (otra sucursal y profesional)", async () => {
    expect((await book(owner, { startsAt: future(8, 12), patientId: p3 })).status).toBe(200);
    const r = await book(owner, { startsAt: future(8, 12), patientId: p3, dentistId: dent2.id, branchId: K.branches[1] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("appointment_overlap_patient");
  });

  it("dos recepciones reservando el mismo horario a la vez: solo una gana", async () => {
    const rec1 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
    const rec2 = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
    const t = future(9, 15);
    const results = await Promise.all([
      book(rec1, { startsAt: t, patientId: p1 }), book(rec2, { startsAt: t, patientId: p2 }),
      book(rec1, { startsAt: t, patientId: p3 }), book(rec2, { startsAt: t, patientId: p1 }),
    ]);
    expect(results.filter((r) => r.status === 200)).toHaveLength(1);
    expect(results.filter((r) => r.status === 409)).toHaveLength(3);
  });

  it("la clave de idempotencia evita duplicar una cita por doble clic o reintento", async () => {
    const key = `idem-${Date.now()}`;
    const a = await book(owner, { startsAt: future(10, 9), idempotencyKey: key });
    const b = await book(owner, { startsAt: future(10, 9), idempotencyKey: key });
    expect(a.status).toBe(200);
    expect(b.body.id).toBe(a.body.id);
    expect(b.body.duplicate).toBe(true);
  });

  it("cancelar libera el horario", async () => {
    const t = future(11, 9);
    const a = await book(owner, { startsAt: t });
    expect((await owner.post(`/api/appointments/${a.body.id}/status`, { status: "cancelled" })).status).toBe(400); // sin motivo
    expect((await owner.post(`/api/appointments/${a.body.id}/status`, { status: "cancelled", reason: "Paciente avisó" })).status).toBe(200);
    expect((await book(owner, { startsAt: t, patientId: p2 })).status).toBe(200);
  });

  it("valida transiciones de estado", async () => {
    const a = await book(owner, { startsAt: future(12, 9) });
    const id = a.body.id;
    expect((await owner.post(`/api/appointments/${id}/status`, { status: "completed" })).status).toBe(409);
    expect((await owner.post(`/api/appointments/${id}/status`, { status: "confirmed" })).status).toBe(200);
    expect((await owner.post(`/api/appointments/${id}/status`, { status: "arrived" })).status).toBe(200);
    expect((await owner.post(`/api/appointments/${id}/status`, { status: "completed" })).status).toBe(200);
    const r = await owner.post(`/api/appointments/${id}/status`, { status: "cancelled", reason: "x" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("invalid_transition");
  });

  it("rechaza horarios fuera de la jornada del profesional y en el pasado", async () => {
    expect((await book(owner, { startsAt: future(13, 22) })).body.error.code).toBe("outside_schedule");
    expect((await book(owner, { startsAt: future(-1, 9) })).status).toBe(400);
  });

  it("respeta los bloqueos (vacaciones)", async () => {
    const s = future(14, 7), e = future(14, 21);
    expect((await owner.post("/api/schedule-blocks", { dentistId: dent1.id, startsAt: s, endsAt: e, reason: "Congreso" })).status).toBe(200);
    const r = await book(owner, { startsAt: future(14, 10) });
    expect(r.status).toBe(409);
    expect(r.body.error.message).toMatch(/Congreso/);
  });

  it("reprogramar valida el nuevo horario y cuenta la reprogramación", async () => {
    const a = await book(owner, { startsAt: future(15, 9) });
    const busy = await book(owner, { startsAt: future(15, 11), patientId: p2 });
    expect(busy.status).toBe(200);
    expect((await owner.patch(`/api/appointments/${a.body.id}`, { startsAt: future(15, 11) })).status).toBe(409);
    const ok = await owner.patch(`/api/appointments/${a.body.id}`, { startsAt: future(15, 13) });
    expect(ok.body.rescheduled).toBe(true);
    const d = await owner.get(`/api/appointments/${a.body.id}`);
    expect(d.body.rescheduleCount).toBe(1);
    expect(DateTime.fromISO(d.body.startsAt).toMillis()).toBe(DateTime.fromISO(future(15, 13)).toMillis());
  });

  it("la disponibilidad descuenta citas y la búsqueda encuentra horarios para una prestación", async () => {
    const date = DateTime.fromISO(future(16, 9)).setZone("America/La_Paz").toISODate();
    await book(owner, { startsAt: future(16, 9) });
    const av = await owner.get(`/api/availability?date=${date}&branchId=${B()}&dentistId=${dent1.id}&durationMin=30`);
    const slots: string[] = av.body[0].slots;
    expect(slots).not.toContain(new Date(future(16, 9)).toISOString());
    expect(slots).toContain(new Date(future(16, 9, 30)).toISOString());
    const proc = await procedureId(env.db, K.clinicId, "PRE-01");
    const s = await owner.get(`/api/availability/search?procedureId=${proc}&from=${date}&days=1&branchId=${B()}`);
    expect(s.body.durationMin).toBe(45);
    expect(s.body.slots.length).toBeGreaterThan(0);
  });

  it("recordatorios: solo con consentimiento y sin datos clínicos en el mensaje", async () => {
    const withConsent = await createPatient(owner, { consentReminders: true, firstName: "Rosa" });
    await book(owner, { startsAt: future(17, 9), patientId: withConsent, reason: "Endodoncia pieza 36" });
    await book(owner, { startsAt: future(17, 10), patientId: p2 });
    const date = DateTime.fromISO(future(17, 9)).setZone("America/La_Paz").toISODate();
    const r = await owner.get(`/api/reminders?date=${date}`);
    const rosa = r.body.find((x: any) => x.patientFirstName === "Rosa");
    const other = r.body.find((x: any) => x.patientFirstName !== "Rosa");
    expect(rosa.whatsappUrl).toMatch(/^https:\/\/wa\.me\/591/);
    expect(rosa.message).not.toMatch(/Endodoncia/);
    expect(other.whatsappUrl).toBeNull();
    expect(other.blockedReason).toMatch(/consentimiento/);
  });

  it("lista de espera: sugiere huecos libres para pacientes en espera", async () => {
    const date = DateTime.fromISO(future(18, 9)).setZone("America/La_Paz").toISODate();
    expect((await owner.post("/api/waitlist", { branchId: B(), patientId: p2, dentistId: dent1.id, durationMin: 30, preferredPeriod: "morning" })).status).toBe(200);
    const m = await owner.get(`/api/waitlist/matches?date=${date}&branchId=${B()}`);
    const match = m.body.find((x: any) => x.patientId === p2);
    expect(match.slots.length).toBeGreaterThan(0);
    for (const s of match.slots) expect(DateTime.fromISO(s.startsAt).setZone("America/La_Paz").hour).toBeLessThan(13);
  });
});

describe("agenda: permisos por rol y sucursal", () => {
  it("recepción de la sucursal 1 no agenda ni ve citas de la sucursal 2", async () => {
    const rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
    const r = await rec.post("/api/appointments", { branchId: K.branches[1], dentistId: dent2.id, patientId: p1, startsAt: future(20, 9), durationMin: 30 });
    expect(r.status).toBe(403);
    expect((await rec.get(`/api/appointments?from=${future(0, 0)}&to=${future(30, 0)}&branchId=${K.branches[1]}`)).status).toBe(403);
  });

  it("un odontólogo no agenda en la agenda de otro colega", async () => {
    const d1 = await login(env.app, dent1.email);
    const r = await d1.post("/api/appointments", { branchId: B(), dentistId: dent2.id, patientId: p1, startsAt: future(21, 9), durationMin: 30 });
    expect(r.status).toBe(403);
    expect((await d1.post("/api/appointments", { branchId: B(), dentistId: dent1.id, patientId: p1, startsAt: future(21, 9), durationMin: 30 })).status).toBe(200);
  });

  it("solo administración agenda fuera de horario", async () => {
    const rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
    expect((await book(rec, { startsAt: future(22, 22), allowOutsideSchedule: true })).status).toBe(403);
    expect((await book(owner, { startsAt: future(22, 22), allowOutsideSchedule: true })).status).toBe(200);
  });
});
