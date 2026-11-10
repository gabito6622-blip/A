import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { addUser, createClinic, createPatient, fullSchedule, future, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, OTHER: TestClinic;
let owner: Agent;
let d1: { id: string; email: string }, d2: { id: string; email: string };
let pa: string, pb: string;

/** Hora local de La Paz del día de prueba (lunes 2 de marzo de 2026). */
const at = (hhmm: string, day = "2026-03-02") => DateTime.fromISO(`${day}T${hhmm}`, { zone: "America/La_Paz" }).toJSDate();

/** Inserta una cita pasada con sus eventos exactos (como si se hubieran registrado en su momento). */
async function seedAppt(clinicId: string, o: { branch: string; dentist: string; patient: string; start: string; minutes: number; status: string; day?: string;
  events?: [to: string, hhmm: string, retroactive?: boolean][] }) {
  const s = at(o.start, o.day);
  const id = (await env.db.adminPool.query<{ id: string }>(
    `INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
    [clinicId, o.branch, o.dentist, o.patient, s, new Date(s.getTime() + o.minutes * 60_000), o.status])).rows[0]!.id;
  let from: string | null = null;
  for (const [to, hhmm, retro] of [["scheduled", "07:00"] as [string, string], ...(o.events ?? [])]) {
    await env.db.adminPool.query(
      `INSERT INTO appointment_events (clinic_id, appointment_id, branch_id, from_status, to_status, retroactive, occurred_at) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [clinicId, id, o.branch, from, to, !!retro, at(hhmm, o.day)]);
    from = to;
  }
  return id;
}

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 2 });
  OTHER = await createClinic(env.db, { branches: 1 });
  owner = await login(env.app, K.ownerEmail);
  d1 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] });
  d2 = await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[1]!] });
  await fullSchedule(env.db, K.clinicId, d1.id, K.branches[0]!);
  await fullSchedule(env.db, K.clinicId, d2.id, K.branches[1]!);
  pa = await createPatient(owner);
  pb = await createPatient(owner);
  const [b1, b2] = K.branches as [string, string];
  // Sucursal 1 (d1), citas de 30 min
  await seedAppt(K.clinicId, { branch: b1, dentist: d1.id, patient: pa, start: "09:00", minutes: 30, status: "completed",
    events: [["arrived", "08:55"], ["in_progress", "09:05"], ["completed", "09:40"]] });        // espera 10, puntual (-5), real 35
  await seedAppt(K.clinicId, { branch: b1, dentist: d1.id, patient: pa, start: "10:00", minutes: 30, status: "completed",
    events: [["arrived", "10:10"], ["in_progress", "10:12"], ["completed", "10:32"]] });        // espera 2, tarde (+10), real 20
  await seedAppt(K.clinicId, { branch: b1, dentist: d1.id, patient: pa, start: "11:00", minutes: 30, status: "completed",
    events: [["confirmed", "08:00"], ["arrived", "10:40"], ["in_progress", "11:00"], ["completed", "11:30"]] }); // espera 20, temprano (-20), real 30
  await seedAppt(K.clinicId, { branch: b1, dentist: d1.id, patient: pa, start: "12:00", minutes: 30, status: "no_show", events: [["no_show", "12:40"]] });
  await seedAppt(K.clinicId, { branch: b1, dentist: d1.id, patient: pa, start: "14:00", minutes: 30, status: "cancelled", events: [["cancelled", "08:30"]] });
  // Sucursal 2 (d2)
  await seedAppt(K.clinicId, { branch: b2, dentist: d2.id, patient: pb, start: "09:00", minutes: 60, status: "completed",
    events: [["arrived", "09:20"], ["in_progress", "09:50"], ["completed", "10:50"]] });        // espera 30, muy tarde (+20), real 60 = planificado
  await seedAppt(K.clinicId, { branch: b2, dentist: d2.id, patient: pb, start: "11:00", minutes: 30, status: "completed",
    events: [["completed", "18:00", true]] });                                                  // cierre retroactivo: no aporta tiempos
  await seedAppt(K.clinicId, { branch: b2, dentist: d2.id, patient: pb, start: "12:00", minutes: 30, status: "no_show", events: [["no_show", "13:00"]] });
  // Fuera del rango y de otra clínica: no deben contar
  await seedAppt(K.clinicId, { branch: b1, dentist: d1.id, patient: pa, start: "09:00", day: "2026-03-05", minutes: 30, status: "completed",
    events: [["arrived", "09:00"], ["in_progress", "10:30"], ["completed", "11:00"]] });
  const ownerB = await login(env.app, OTHER.ownerEmail);
  const dB = await addUser(env.db, OTHER.clinicId, "dentist", { allBranches: true });
  await seedAppt(OTHER.clinicId, { branch: OTHER.branches[0]!, dentist: dB.id, patient: await createPatient(ownerB), start: "09:00", minutes: 30, status: "completed",
    events: [["arrived", "09:00"], ["in_progress", "11:00"], ["completed", "11:10"]] });
});
afterAll(async () => teardown(env));

describe("eventos de la cita (solo inserción)", () => {
  it("la creación y cada cambio de estado guardan de → a, usuario, sucursal y hora", async () => {
    const p = await createPatient(owner);
    const id = (await owner.post("/api/appointments", { branchId: K.branches[0], dentistId: d1.id, patientId: p, startsAt: future(3, 9), durationMin: 30 })).body.id;
    for (const s of ["confirmed", "arrived", "in_progress", "completed"]) expect((await owner.post(`/api/appointments/${id}/status`, { status: s })).status).toBe(200);
    const ev = (await env.db.adminPool.query(
      "SELECT from_status, to_status, user_id, branch_id, retroactive FROM appointment_events WHERE appointment_id = $1 ORDER BY occurred_at, to_status", [id])).rows;
    expect(ev.map((e) => [e.from_status, e.to_status])).toEqual([[null, "scheduled"], ["scheduled", "confirmed"], ["confirmed", "arrived"], ["arrived", "in_progress"], ["in_progress", "completed"]]);
    expect(ev.every((e) => e.user_id === K.ownerId && e.branch_id === K.branches[0] && e.retroactive === false)).toBe(true);
  });

  it("una transición inválida no deja evento", async () => {
    const p = await createPatient(owner);
    const id = (await owner.post("/api/appointments", { branchId: K.branches[0], dentistId: d1.id, patientId: p, startsAt: future(3, 11), durationMin: 30 })).body.id;
    expect((await owner.post(`/api/appointments/${id}/status`, { status: "completed" })).status).toBe(409);
    const n = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointment_events WHERE appointment_id = $1", [id])).rows[0].n;
    expect(n).toBe(1);
  });

  it("reprogramar una cita confirmada registra el paso de vuelta a agendada", async () => {
    const p = await createPatient(owner);
    const id = (await owner.post("/api/appointments", { branchId: K.branches[0], dentistId: d1.id, patientId: p, startsAt: future(4, 9), durationMin: 30 })).body.id;
    await owner.post(`/api/appointments/${id}/status`, { status: "confirmed" });
    expect((await owner.patch(`/api/appointments/${id}`, { startsAt: future(4, 15) })).status).toBe(200);
    const last = (await env.db.adminPool.query("SELECT from_status, to_status FROM appointment_events WHERE appointment_id = $1 ORDER BY occurred_at DESC LIMIT 1", [id])).rows[0];
    expect(last).toEqual({ from_status: "confirmed", to_status: "scheduled" });
  });

  it("los eventos no se pueden modificar ni borrar (ni siquiera el dueño de la base)", async () => {
    await expect(env.db.adminPool.query("UPDATE appointment_events SET to_status = 'completed'")).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM appointment_events")).rejects.toThrow(/solo inserción/);
    await expect(withTenant(env.db.appPool, { clinicId: K.clinicId, userId: null }, (c) => c.query("DELETE FROM appointment_events"))).rejects.toThrow(/permission denied|solo inserción/);
  });
});

describe("informe de calidad de la atención", () => {
  const Q = "/api/reports/visit-quality?from=2026-03-02&to=2026-03-02";

  it("los totales cuadran exactamente con las citas sembradas", async () => {
    const r = await owner.get(Q);
    expect(r.status).toBe(200);
    const t = r.body.total;
    expect(t).toMatchObject({ total: 8, completed: 5, noShow: 2, cancelled: 1, noShowRate: 28.6, cancellationRate: 12.5 });
    // Esperas [2, 10, 20, 30]: media 15,5; mediana 15; P90 = 20 + 0,7 × 10 = 27
    expect(t.wait).toEqual({ n: 4, mean: 15.5, median: 15, p90: 27, buckets: { upTo5: 1, upTo10: 1, upTo20: 1, over20: 1 } });
    // Llegada frente a la hora agendada: [-5, +10, -20, +20]
    expect(t.punctuality).toEqual({ n: 4, meanMin: 1.3, medianMin: 2.5, early: 1, onTime: 1, late: 1, veryLate: 1, onTimePct: 25 });
    // Real [35, 20, 30, 60] frente a planificado [30, 30, 30, 60]; el cierre retroactivo no cuenta
    expect(t.duration).toEqual({ n: 4, realMean: 36.3, plannedMean: 37.5, overrunMean: -1.2, over: 1, under: 1, overPct: 25 });
  });

  it("por sucursal y por profesional", async () => {
    const r = (await owner.get(Q)).body;
    const b1 = r.byBranch.find((x: any) => x.branchId === K.branches[0]);
    const b2 = r.byBranch.find((x: any) => x.branchId === K.branches[1]);
    expect(b1).toMatchObject({ total: 5, completed: 3, noShow: 1, cancelled: 1, noShowRate: 25, cancellationRate: 20 });
    expect(b1.wait).toMatchObject({ n: 3, mean: 10.7, median: 10, p90: 18 });
    expect(b2).toMatchObject({ total: 3, completed: 2, noShow: 1, cancelled: 0, noShowRate: 33.3 });
    expect(b2.wait).toMatchObject({ n: 1, mean: 30, median: 30, p90: 30 });
    expect(b2.duration).toMatchObject({ n: 1, realMean: 60, plannedMean: 60, overrunMean: 0 });
    const dd1 = r.byDentist.find((x: any) => x.dentistId === d1.id);
    expect(dd1).toMatchObject({ total: 5, wait: { n: 3, median: 10 } });
    // Filtro por sucursal y por profesional
    expect((await owner.get(`${Q}&branchId=${K.branches[1]}`)).body.total.total).toBe(3);
    expect((await owner.get(`${Q}&dentistId=${d1.id}`)).body.total.wait.median).toBe(10);
  });

  it("recepción solo ve sus sucursales; odontólogo y contabilidad no acceden", async () => {
    const rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[1]!] })).email);
    const r = (await rec.get(Q)).body;
    expect(r.total.total).toBe(3);
    expect(r.byBranch).toHaveLength(1);
    expect((await rec.get(`${Q}&branchId=${K.branches[0]}`)).status).toBe(403);
    expect((await (await login(env.app, d1.email)).get(Q)).status).toBe(403);
    const acct = await login(env.app, (await addUser(env.db, K.clinicId, "accountant", { allBranches: true })).email);
    expect((await acct.get(Q)).status).toBe(403);
  });

  it("otra clínica no ve estos datos (solo los suyos)", async () => {
    const b = await login(env.app, OTHER.ownerEmail);
    const r = (await b.get(Q)).body;
    expect(r.total.total).toBe(1);
    expect(r.total.wait.median).toBe(120);
  });

  it("exporta el informe a Excel", async () => {
    const r = await owner.get(`/api/reports/visit-quality.xlsx?from=2026-03-02&to=2026-03-02`);
    expect(r.status).toBe(200);
    expect(String(r.headers["content-type"])).toMatch(/spreadsheetml/);
  });
});

describe("citas pasadas sin cerrar", () => {
  let open1: string, open2: string, open3: string;
  beforeAll(async () => {
    const y = DateTime.now().setZone("America/La_Paz").minus({ days: 1 }).toISODate()!;
    const p = await createPatient(owner);
    open1 = await seedAppt(K.clinicId, { branch: K.branches[0]!, dentist: d1.id, patient: p, start: "08:00", minutes: 30, day: y, status: "confirmed", events: [["confirmed", "07:30"]] });
    open2 = await seedAppt(K.clinicId, { branch: K.branches[0]!, dentist: d1.id, patient: p, start: "09:00", minutes: 30, day: y, status: "in_progress",
      events: [["arrived", "08:58"], ["in_progress", "09:02"]] });
    open3 = await seedAppt(K.clinicId, { branch: K.branches[1]!, dentist: d2.id, patient: p, start: "10:00", minutes: 30, day: y, status: "scheduled" });
  });

  it("lista las citas pasadas abiertas, sin cerrarlas solas", async () => {
    const r = await owner.get("/api/appointments/unclosed");
    expect(r.status).toBe(200);
    const ids = r.body.map((x: any) => x.id);
    expect(ids).toEqual(expect.arrayContaining([open1, open2, open3]));
    expect(r.body.find((x: any) => x.id === open1).resolutions).toEqual(["no_show", "completed"]);
    expect(r.body.find((x: any) => x.id === open2).resolutions).toEqual(["completed"]);
    const st = (await env.db.adminPool.query("SELECT status FROM appointments WHERE id = $1", [open1])).rows[0].status;
    expect(st).toBe("confirmed");
    // filtrado por sucursal permitida
    const rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[1]!] })).email);
    expect((await rec.get("/api/appointments/unclosed")).body.map((x: any) => x.id)).toEqual([open3]);
    expect((await rec.post(`/api/appointments/${open1}/resolve`, { resolution: "no_show" })).status).toBe(403);
  });

  it("se resuelven en un clic y el cierre queda marcado como posterior", async () => {
    expect((await owner.post(`/api/appointments/${open1}/resolve`, { resolution: "no_show" })).status).toBe(200);
    expect((await owner.post(`/api/appointments/${open2}/resolve`, { resolution: "no_show" })).status).toBe(409);
    expect((await owner.post(`/api/appointments/${open2}/resolve`, { resolution: "completed" })).status).toBe(200);
    const ev = (await env.db.adminPool.query("SELECT from_status, to_status, retroactive FROM appointment_events WHERE appointment_id = $1 ORDER BY occurred_at DESC LIMIT 1", [open2])).rows[0];
    expect(ev).toEqual({ from_status: "in_progress", to_status: "completed", retroactive: true });
    const ids = (await owner.get("/api/appointments/unclosed")).body.map((x: any) => x.id);
    expect(ids).not.toContain(open1);
    expect(ids).not.toContain(open2);
    expect(ids).toContain(open3);
  });

  it("no se resuelve una cita que todavía no terminó", async () => {
    const p = await createPatient(owner);
    const id = (await owner.post("/api/appointments", { branchId: K.branches[0], dentistId: d1.id, patientId: p, startsAt: future(2, 9), durationMin: 30 })).body.id;
    const r = await owner.post(`/api/appointments/${id}/resolve`, { resolution: "no_show" });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe("not_past");
  });
});

describe("aislamiento de appointment_events", () => {
  it("con el contexto de otra clínica no se ven eventos ajenos ni se pueden insertar", async () => {
    const n = await withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: null }, async (c) =>
      (await c.query("SELECT count(*)::int AS n FROM appointment_events WHERE clinic_id = $1", [K.clinicId])).rows[0].n);
    expect(n).toBe(0);
    const appt = (await env.db.adminPool.query("SELECT id FROM appointments WHERE clinic_id = $1 LIMIT 1", [K.clinicId])).rows[0].id;
    await expect(withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO appointment_events (clinic_id, appointment_id, branch_id, to_status) VALUES ($1,$2,$3,'arrived')", [K.clinicId, appt, K.branches[0]]),
    )).rejects.toThrow(/row-level security/);
    // y una fila propia no puede apuntar a una cita de otra clínica (FK compuesta)
    await expect(withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO appointment_events (clinic_id, appointment_id, branch_id, to_status) VALUES ($1,$2,$3,'arrived')", [OTHER.clinicId, appt, OTHER.branches[0]]),
    )).rejects.toThrow(/foreign key/);
  });
});
