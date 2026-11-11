// Encuesta de satisfacción (NPS) y llegada con QR (R2-31).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomUUID } from "node:crypto";
import { DateTime } from "luxon";
import { loadConfig } from "../server/src/config.js";
import { withTenant } from "../server/src/lib/db.js";
import { runSchedulerOnce } from "../server/src/modules/messaging/index.js";
import { confirmTokenHash, signConfirmToken } from "../server/src/modules/messaging/tokens.js";
import { computeNps } from "../server/src/modules/experience/surveys.js";
import { MAX_FAILED_PER_DEVICE, windowState } from "../server/src/modules/experience/checkin.js";
import { signToken, verifyToken } from "../server/src/modules/experience/tokens.js";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, owner2: Agent, rec: Agent, recOther: Agent, dentist: { id: string; email: string };
const cfg = loadConfig();
const B = () => K.branches[0]!;
const ZONE = "America/La_Paz";

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { name: "Clínica Sonrisas QR" });
  K2 = await createClinic(env.db, { name: "Clínica Vecina" });
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  rec = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B()] })).email);
  recOther = await login(env.app, (await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[1]!] })).email);
  dentist = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
});
afterAll(async () => teardown(env));

/** Cita insertada directamente (las pruebas no dependen del horario del día). */
async function appt(patientId: string, startsAt: Date, status = "scheduled", branchId = B(), clinic = K, dentistId?: string) {
  // Un profesional nuevo por cita: las citas de prueba nunca chocan entre sí.
  dentistId ??= (await addUser(env.db, clinic.clinicId, "dentist", { allBranches: true })).id;
  const r = await env.db.adminPool.query<{ id: string }>(
    `INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, completed_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, CASE WHEN $7 = 'completed' THEN $6::timestamptz END) RETURNING id`,
    [clinic.clinicId, branchId, dentistId, patientId, startsAt, new Date(startsAt.getTime() + 30 * 60_000), status]);
  return r.rows[0]!.id;
}
const pub = async (method: "GET" | "POST", url: string, payload?: unknown, headers: Record<string, string> = { "x-portal": "1" }) => {
  const r = await env.app.inject({ method, url, payload: payload as object, headers: method === "POST" ? headers : {} });
  let body: any = null; try { body = r.json(); } catch { body = r.body; }
  return { status: r.statusCode, body, raw: r.body };
};

describe("NPS (unidad)", () => {
  it("calcula promotores, pasivos, detractores y el NPS redondeado", () => {
    expect(computeNps([])).toMatchObject({ answered: 0, nps: null });
    expect(computeNps([10, 10, 9])).toMatchObject({ promoters: 3, detractors: 0, nps: 100 });
    expect(computeNps([10, 9, 8, 7, 6, 0])).toMatchObject({ promoters: 2, passives: 2, detractors: 2, nps: 0 });
    expect(computeNps([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10])).toMatchObject({ promoters: 2, detractors: 7, passives: 2, nps: -45 });
    expect(computeNps([6])).toMatchObject({ nps: -100 });
  });
  it("los tokens firmados no sirven para otro propósito ni alterados", () => {
    const t = signToken(cfg.secretKey, "encuesta", K.clinicId, randomUUID());
    expect(verifyToken(cfg.secretKey, "encuesta", t)?.clinicId).toBe(K.clinicId);
    expect(verifyToken(cfg.secretKey, "llegada", t)).toBeNull();
    expect(verifyToken(cfg.secretKey, "encuesta", t.slice(0, -2) + "AA")).toBeNull();
  });
});

describe("encuesta de satisfacción", () => {
  let patient: string, apptId: string, url: string, token: string;
  beforeAll(async () => {
    patient = await createPatient(owner, { firstName: "Valentina", lastName: "Secreta Nps", consentReminders: true });
  });

  it("solo para citas atendidas; el enlace es de un solo uso y no muestra datos clínicos ni el nombre", async () => {
    apptId = await appt(patient, new Date(Date.now() - 3 * 3_600_000), "scheduled");
    await env.db.adminPool.query("UPDATE appointments SET procedure_id = (SELECT id FROM procedures WHERE clinic_id = $1 AND code = 'PRE-01'), reason = 'Dolor muela 36' WHERE id = $2", [K.clinicId, apptId]);
    expect((await rec.post(`/api/appointments/${apptId}/survey-link`)).status).toBe(409);
    await env.db.adminPool.query("UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = $1", [apptId]);
    expect((await recOther.post(`/api/appointments/${apptId}/survey-link`)).status).toBe(403);
    const l = await rec.post(`/api/appointments/${apptId}/survey-link`);
    expect(l.status, JSON.stringify(l.body)).toBe(200);
    url = l.body.url; token = url.split("/e/")[1];
    // Pedirlo de nuevo devuelve el mismo enlace (no crea otra encuesta)
    expect((await rec.post(`/api/appointments/${apptId}/survey-link`)).body.url).toBe(url);
    const v = await pub("GET", `/api/public/encuesta/${token}`);
    expect(v.status).toBe(200);
    expect(v.body).toMatchObject({ state: "open", clinicName: "Clínica Sonrisas QR", branchName: "Sucursal 1" });
    for (const leak of ["Valentina", "Secreta", "Profilaxis", "Dolor", "36", dentist.email, "procedure", "patient"]) expect(v.raw).not.toContain(leak);
    // Sin cabecera del portal, rechazado
    expect((await pub("POST", `/api/public/encuesta/${token}`, { score: 9 }, {})).status).toBe(403);
    expect((await pub("POST", `/api/public/encuesta/${token}`, { score: 11 })).status).toBe(400);
    const ans = await pub("POST", `/api/public/encuesta/${token}`, { score: 4, comment: "  Esperé mucho\u0007 " });
    expect(ans.status, ans.raw).toBe(200);
    expect(ans.body).toMatchObject({ ok: true, detractor: true });
    const again = await pub("POST", `/api/public/encuesta/${token}`, { score: 10 });
    expect(again.status).toBe(409);
    expect((await pub("GET", `/api/public/encuesta/${token}`)).body.state).toBe("answered");
    const row = (await env.db.adminPool.query("SELECT score, comment FROM satisfaction_surveys WHERE appointment_id = $1", [apptId])).rows[0];
    expect(row).toEqual({ score: 4, comment: "Esperé mucho" });
    // La base impide cambiar la respuesta
    await expect(env.db.adminPool.query("UPDATE satisfaction_surveys SET score = 10 WHERE appointment_id = $1", [apptId])).rejects.toThrow(/no se modifica/);
    // Ya respondida: no se emite otro enlace
    expect((await rec.post(`/api/appointments/${apptId}/survey-link`)).body.error.code).toBe("survey_answered");
    // Token alterado o de otro tipo
    expect((await pub("GET", `/api/public/encuesta/${token.slice(0, -3)}abc`)).status).toBe(404);
    expect((await pub("GET", `/api/public/encuesta/${signToken(cfg.secretKey, "llegada", K.clinicId, randomUUID())}`)).status).toBe(404);
  });

  it("vence a los 14 días", async () => {
    const p = await createPatient(owner, {});
    const a = await appt(p, new Date(Date.now() - 5 * 3_600_000), "completed");
    const l = await rec.post(`/api/appointments/${a}/survey-link`);
    await env.db.adminPool.query("UPDATE satisfaction_surveys SET expires_at = now() - interval '1 minute' WHERE appointment_id = $1", [a]);
    const t = l.body.url.split("/e/")[1];
    expect((await pub("GET", `/api/public/encuesta/${t}`)).body.state).toBe("expired");
    expect((await pub("POST", `/api/public/encuesta/${t}`, { score: 9 })).status).toBe(410);
  });

  it("panel por sucursal y profesional; el detractor queda como aviso hasta el seguimiento", async () => {
    const d2 = await addUser(env.db, K.clinicId, "dentist", { allBranches: true });
    const answers: [number, string, string][] = [[10, B(), dentist.id], [9, B(), dentist.id], [8, K.branches[1]!, d2.id], [10, K.branches[1]!, d2.id]];
    for (const [i, [score, br, dn]] of answers.entries()) {
      const p = await createPatient(owner, {});
      const a = await appt(p, new Date(Date.now() - (6 + i) * 3_600_000), "completed", br, K, dn);
      const l = await owner.post(`/api/appointments/${a}/survey-link`);
      expect((await pub("POST", `/api/public/encuesta/${l.body.url.split("/e/")[1]}`, { score })).status).toBe(200);
    }
    const s = await owner.get("/api/surveys/summary");
    expect(s.status).toBe(200);
    // Respuestas: 4 (detractor) + 10 + 9 + 8 + 10 → 3 promotores, 1 pasivo, 1 detractor → NPS 40
    expect(s.body.overall).toMatchObject({ answered: 5, promoters: 3, passives: 1, detractors: 1, nps: 40 });
    expect(s.body.sent).toBe(6);
    const b1 = s.body.byBranch.find((x: any) => x.id === B());
    expect(b1).toMatchObject({ answered: 3, nps: 33 }); // 4, 10, 9
    expect(s.body.byDentist.find((x: any) => x.id === d2.id)).toMatchObject({ answered: 2, nps: 50 });
    expect(s.body.alerts).toHaveLength(1);
    expect(s.body.alerts[0]).toMatchObject({ score: 4, comment: "Esperé mucho", patientId: patient });
    expect(s.body.tasksModule).toBe(false);
    const fb = (await owner.get(`/api/surveys/summary?branchId=${K.branches[1]}`)).body;
    expect(fb.overall.answered).toBe(2);
    // Seguimiento (una sola vez)
    const id = s.body.alerts[0].id;
    expect((await owner.post(`/api/surveys/${id}/followup`, { note: "x" })).status).toBe(400);
    expect((await owner.post(`/api/surveys/${id}/followup`, { note: "Llamamos y pedimos disculpas" })).status).toBe(200);
    expect((await owner.post(`/api/surveys/${id}/followup`, { note: "Otra vez" })).status).toBe(409);
    expect((await owner.get("/api/surveys/summary")).body.alerts).toHaveLength(0);
    // Historial del paciente: solo para quien ve el panel
    const tl = (await owner.get(`/api/patients/${patient}/timeline?types=feedback`)).body;
    expect(tl.items[0].title).toMatch(/4\/10 \(detractor\)/);
    expect((await rec.get(`/api/patients/${patient}/timeline`)).body.available.map((x: any) => x.id)).not.toContain("feedback");
    // Permisos y aislamiento
    expect((await rec.get("/api/surveys/summary")).status).toBe(403);
    expect((await rec.post(`/api/surveys/${id}/followup`, { note: "Hola mundo" })).status).toBe(403);
    expect((await owner2.get("/api/surveys/summary")).body.overall.answered).toBe(0);
    expect((await owner2.post(`/api/surveys/${id}/followup`, { note: "Ajena ajena" })).status).toBe(404);
    expect((await owner2.post(`/api/appointments/${apptId}/survey-link`)).status).toBe(404);
    const rows = await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) => c.query("SELECT * FROM satisfaction_surveys"));
    expect(rows.rowCount).toBe(0);
  });

  it("regla automática nueva (desactivada por defecto): exige {enlace_encuesta}, envía un enlace por cita y nunca a quien ya respondió", async () => {
    const st = await owner.get("/api/messaging/settings");
    expect(st.body.triggers.map((t: any) => t.id)).toContain("satisfaction_survey");
    const noLink = await owner.post("/api/messaging/templates", { name: "Encuesta sin enlace", purpose: "reminders", body: "Hola {nombre}, gracias por venir" });
    const bad = await owner.post("/api/messaging/rules", { name: "Encuesta mala", trigger: "satisfaction_survey", offsetMinutes: 60, branchId: null, templateId: noLink.body.id, active: true });
    expect(bad.status).toBe(400);
    expect(bad.body.error.message).toMatch(/enlace_encuesta/);
    // {enlace_encuesta} no está disponible para otros disparadores
    const tpl = await owner.post("/api/messaging/templates", { name: "Encuesta", purpose: "reminders", body: "Hola {nombre}, ¿cómo te atendimos en {clinica}? {enlace_encuesta}" });
    expect(tpl.status, JSON.stringify(tpl.body)).toBe(200);
    expect((await owner.post("/api/messaging/rules", { name: "Mal uso", trigger: "after_visit", offsetMinutes: 60, branchId: null, templateId: tpl.body.id, active: true })).status).toBe(400);
    const rule = await owner.post("/api/messaging/rules", { name: "Encuesta 1 h", trigger: "satisfaction_survey", offsetMinutes: 60, branchId: null, templateId: tpl.body.id, active: true });
    expect(rule.status, JSON.stringify(rule.body)).toBe(200);
    const p = await createPatient(owner, { firstName: "Auto", consentReminders: true });
    const a = await appt(p, new Date(Date.now() - 90 * 60_000), "scheduled");
    await env.db.adminPool.query("UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = $1", [a]);
    const now = DateTime.now().setZone(ZONE).plus({ days: 1 }).set({ hour: 11, minute: 0 }).toJSDate();
    await runSchedulerOnce(env.db, now, { clinicIds: [K.clinicId] });
    const msgs = (await env.db.adminPool.query("SELECT body, status, template FROM outbound_messages WHERE patient_id = $1", [p])).rows;
    expect(msgs).toHaveLength(1);
    expect(msgs[0].template).toBe("auto.satisfaction_survey");
    expect(msgs[0].status).toBe("simulated");
    const link = /\/e\/([A-Za-z0-9_.-]+)/.exec(msgs[0].body)![1]!;
    const sv = (await env.db.adminPool.query("SELECT source, job_id FROM satisfaction_surveys WHERE appointment_id = $1", [a])).rows[0];
    expect(sv.source).toBe("auto");
    expect(sv.job_id).toBeTruthy();
    expect((await pub("POST", `/api/public/encuesta/${link}`, { score: 10 })).status).toBe(200);
    // Repetir el programador no duplica; y una cita ya respondida no se vuelve a planificar
    await runSchedulerOnce(env.db, now, { clinicIds: [K.clinicId] });
    expect((await env.db.adminPool.query("SELECT count(*)::int AS n FROM outbound_messages WHERE patient_id = $1", [p])).rows[0].n).toBe(1);
    // Sin consentimiento de recordatorios: se omite
    const p2 = await createPatient(owner, { consentReminders: false });
    const a2 = await appt(p2, new Date(Date.now() - 90 * 60_000), "scheduled");
    await env.db.adminPool.query("UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = $1", [a2]);
    await runSchedulerOnce(env.db, now, { clinicIds: [K.clinicId] });
    const j = (await env.db.adminPool.query("SELECT status, status_reason FROM message_jobs WHERE appointment_id = $1", [a2])).rows[0];
    expect(j.status).toBe("skipped");
    expect(j.status_reason).toMatch(/consentimiento/);
    await owner.put(`/api/messaging/rules/${rule.body.id}`, { name: "Encuesta 1 h", trigger: "satisfaction_survey", offsetMinutes: 60, branchId: null, templateId: tpl.body.id, channel: "whatsapp", active: false });
  });
});

describe("detractor → tarea de seguimiento para gerencia", () => {
  async function answer(score: number, comment?: string) {
    const p = await createPatient(owner, { firstName: "Rosa", lastName: `Tarea ${score} ${randomUUID().slice(0, 4)}` });
    const a = await appt(p, new Date(Date.now() - 5 * 3_600_000), "completed");
    const l = await owner.post(`/api/appointments/${a}/survey-link`);
    const token = l.body.url.split("/e/")[1];
    expect((await pub("POST", `/api/public/encuesta/${token}`, { score, comment })).status).toBe(200);
    const sid = (await env.db.adminPool.query<{ id: string }>("SELECT id FROM satisfaction_surveys WHERE appointment_id = $1", [a])).rows[0]!.id;
    const task = (await env.db.adminPool.query("SELECT * FROM staff_tasks WHERE source_survey_id = $1", [sid])).rows[0];
    return { patient: p, sid, task };
  }

  it("una nota de 0 a 6 crea una tarea de prioridad alta para gerencia, ligada al paciente y sin el comentario", async () => {
    const { patient, task } = await answer(3, "Me dolió mucho la muela");
    expect(task).toMatchObject({ source: "survey", priority: "high", status: "open", assignee_role: "owner", patient_id: patient, created_by: null });
    expect(task.title).toMatch(/3\/10/);
    expect(`${task.title} ${task.detail}`).not.toMatch(/muela|dolió/);
    const d = await owner.get(`/api/tasks/${task.id}`);
    expect(d.status, JSON.stringify(d.body)).toBe(200);
    expect(JSON.stringify(d.body)).toContain("Encuesta de satisfacción");
  });

  it("una nota de 7 a 10 no crea tarea", async () => {
    expect((await answer(7)).task).toBeUndefined();
    expect((await answer(10)).task).toBeUndefined();
  });

  it("completar la tarea registra el seguimiento de la encuesta, y el seguimiento cierra la tarea", async () => {
    const a = await answer(2);
    const done = await owner.post(`/api/tasks/${a.task.id}/done`, { note: "Llamamos y reprogramamos una revisión" });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    const s1 = (await env.db.adminPool.query("SELECT followup_done_at, followup_note FROM satisfaction_surveys WHERE id = $1", [a.sid])).rows[0];
    expect(s1.followup_done_at).not.toBeNull();
    expect(s1.followup_note).toBe("Llamamos y reprogramamos una revisión");

    const b = await answer(5);
    expect((await owner.post(`/api/surveys/${b.sid}/followup`, { note: "Pedimos disculpas por la espera" })).status).toBe(200);
    const t = (await env.db.adminPool.query("SELECT status, done_by FROM staff_tasks WHERE id = $1", [b.task.id])).rows[0];
    expect(t.status).toBe("done");
    expect(t.done_by).not.toBeNull();
  });

  it("la base impide cambiar el origen de la tarea y otra clínica no la ve", async () => {
    const a = await answer(1);
    await expect(env.db.adminPool.query("UPDATE staff_tasks SET source_survey_id = NULL, source = 'manual' WHERE id = $1", [a.task.id])).rejects.toThrow(/no se modifica/);
    await expect(env.db.adminPool.query(
      "INSERT INTO staff_tasks (clinic_id, branch_id, title, assignee_role, source) VALUES ($1,$2,'Sin autor','owner','manual')", [K.clinicId, B()])).rejects.toThrow(/staff_tasks_creator/);
    expect((await owner2.get(`/api/tasks/${a.task.id}`)).status).toBe(404);
  });
});

describe("llegada con QR", () => {
  let token: string, pointId: string;
  const birth = "1991-07-15";
  let patient: string, phone: string;
  beforeAll(async () => {
    phone = `7${Math.floor(1000000 + Math.random() * 8999999)}`;
    patient = await createPatient(owner, { firstName: "Llegada", lastName: "Paciente Qr", phone, birthDate: birth });
  });

  it("ventana −60/+30 minutos (unidad)", () => {
    const s = new Date("2026-11-10T14:00:00Z");
    expect(windowState(s, +new Date("2026-11-10T12:59:00Z"))).toBe("early");
    expect(windowState(s, +new Date("2026-11-10T13:00:00Z"))).toBe("open");
    expect(windowState(s, +new Date("2026-11-10T14:30:00Z"))).toBe("open");
    expect(windowState(s, +new Date("2026-11-10T14:31:00Z"))).toBe("late");
  });

  it("solo administración crea el QR de su sucursal; la página no muestra datos personales", async () => {
    expect((await rec.post("/api/checkin/points", { branchId: B() })).status).toBe(403);
    const r = await owner.post("/api/checkin/points", { branchId: B() });
    expect(r.status).toBe(200);
    pointId = r.body.id;
    token = r.body.url.split("/llegada/")[1];
    const list = (await owner.get("/api/checkin/points")).body;
    const mine = list.find((x: any) => x.branchId === B());
    expect(mine.qrSvg).toMatch(/^<svg/);
    expect(mine.url).toBe(r.body.url);
    const g = await pub("GET", `/api/public/llegada/${token}`);
    expect(g.body).toMatchObject({ clinicName: "Clínica Sonrisas QR", branchName: "Sucursal 1" });
    expect(Object.keys(g.body).sort()).toEqual(["branchName", "clinicName", "windowAfter", "windowBefore"]);
    expect((await owner2.post("/api/checkin/points", { branchId: B() })).status).toBe(404);
  });

  it("con cita en la ventana queda «Llegó»; reescanear es idempotente", async () => {
    const a = await appt(patient, new Date(Date.now() + 10 * 60_000));
    const ok = await pub("POST", `/api/public/llegada/${token}`, { phoneLast4: phone.slice(-4), birthDate: birth });
    expect(ok.status, ok.raw).toBe(200);
    expect(ok.body.state).toBe("arrived");
    for (const leak of ["Llegada", "Paciente", phone]) expect(ok.raw).not.toContain(leak);
    const st = (await env.db.adminPool.query("SELECT status, arrived_at FROM appointments WHERE id = $1", [a])).rows[0];
    expect(st.status).toBe("arrived");
    const again = await pub("POST", `/api/public/llegada/${token}`, { phoneLast4: phone.slice(-4), birthDate: birth });
    expect(again.body.state).toBe("already");
    const st2 = (await env.db.adminPool.query("SELECT status, arrived_at FROM appointments WHERE id = $1", [a])).rows[0];
    expect(+st2.arrived_at).toBe(+st.arrived_at);
    const ev = (await env.db.adminPool.query("SELECT to_status, reason, user_id FROM appointment_events WHERE appointment_id = $1 AND to_status = 'arrived'", [a])).rows;
    expect(ev).toHaveLength(1);
    expect(ev[0].reason).toMatch(/QR/);
    // La sala de espera (agenda) lo muestra como «Llegó»
    const day = await rec.get(`/api/appointments?from=${encodeURIComponent(new Date(Date.now() - 3_600_000).toISOString())}&to=${encodeURIComponent(new Date(Date.now() + 3_600_000).toISOString())}&branchId=${B()}`);
    expect(day.body.find((x: any) => x.id === a).status).toBe("arrived");
    await env.db.adminPool.query("UPDATE appointments SET status = 'completed', completed_at = now() WHERE id = $1", [a]);
  });

  it("fuera de la ventana solo informa la hora (antes y después)", async () => {
    const p = await createPatient(owner, { phone, birthDate: "1975-03-03", firstName: "Otra" });
    const early = await appt(p, new Date(Date.now() + 3 * 3_600_000));
    const e = await pub("POST", `/api/public/llegada/${token}`, { phoneLast4: phone.slice(-4), birthDate: "1975-03-03" });
    expect(e.body.state).toBe("early");
    expect(e.body.message).toMatch(/Puedes registrar tu llegada desde las/);
    expect((await env.db.adminPool.query("SELECT status FROM appointments WHERE id = $1", [early])).rows[0].status).toBe("scheduled");
    await env.db.adminPool.query("UPDATE appointments SET status = 'cancelled', cancel_reason = 'prueba' WHERE id = $1", [early]);
    const late = await appt(p, new Date(Date.now() - 45 * 60_000));
    const l = await pub("POST", `/api/public/llegada/${token}`, { phoneLast4: phone.slice(-4), birthDate: "1975-03-03" });
    expect(l.body.state).toBe("late");
    expect((await env.db.adminPool.query("SELECT status FROM appointments WHERE id = $1", [late])).rows[0].status).toBe("scheduled");
  });

  it("el tutor legal identifica al menor con su celular; otra sucursal no registra", async () => {
    const tutorPhone = `7${Math.floor(1000000 + Math.random() * 8999999)}`;
    const tutor = await createPatient(owner, { phone: tutorPhone, birthDate: "1980-01-01" });
    const kidBirth = DateTime.now().minus({ years: 7 }).toISODate()!;
    const kid = await createPatient(owner, { documentType: "SIN", documentNumber: null, phone: null, birthDate: kidBirth, guardianName: "Otro", guardianPhone: "70000002" });
    await owner.post(`/api/patients/${kid}/relationships`, { relatedPatientId: tutor, relation: "guardian", legalGuardian: true });
    await env.db.adminPool.query("UPDATE patients SET guardian_phone = NULL WHERE id = $1", [kid]);
    const a = await appt(kid, new Date(Date.now() + 5 * 60_000), "scheduled", K.branches[1]!);
    const other = await owner.post("/api/checkin/points", { branchId: K.branches[1] });
    const tok2 = other.body.url.split("/llegada/")[1];
    // En la sucursal 1 no hay cita: no encontrado
    const wrong = await pub("POST", `/api/public/llegada/${token}`, { phoneLast4: tutorPhone.slice(-4), birthDate: kidBirth });
    expect(wrong.status).toBe(404);
    const ok = await pub("POST", `/api/public/llegada/${tok2}`, { phoneLast4: tutorPhone.slice(-4), birthDate: kidBirth });
    expect(ok.body.state).toBe("arrived");
    expect((await env.db.adminPool.query("SELECT status FROM appointments WHERE id = $1", [a])).rows[0].status).toBe("arrived");
  });

  it("desde el enlace del recordatorio: abrir no registra; pulsar el botón sí", async () => {
    const p = await createPatient(owner, {});
    const a = await appt(p, new Date(Date.now() + 15 * 60_000));
    const tokenId = randomUUID();
    const t = signConfirmToken(cfg.secretKey, K.clinicId, tokenId);
    const starts = (await env.db.adminPool.query("SELECT starts_at FROM appointments WHERE id = $1", [a])).rows[0].starts_at;
    await env.db.adminPool.query("INSERT INTO message_confirm_tokens (id, clinic_id, appointment_id, token_hash, starts_at, expires_at) VALUES ($1,$2,$3,$4,$5,$5)",
      [tokenId, K.clinicId, a, confirmTokenHash(t), starts]);
    const g = await pub("GET", `/api/public/llegada-recordatorio/${t}`);
    expect(g.body).toMatchObject({ state: "open", branchName: "Sucursal 1" });
    expect((await env.db.adminPool.query("SELECT status FROM appointments WHERE id = $1", [a])).rows[0].status).toBe("scheduled");
    expect((await pub("POST", `/api/public/llegada-recordatorio/${t}`, {}, {})).status).toBe(403);
    const r = await pub("POST", `/api/public/llegada-recordatorio/${t}`, {});
    expect(r.body.state).toBe("arrived");
    expect((await pub("POST", `/api/public/llegada-recordatorio/${t}`, {})).body.state).toBe("already");
  });

  it("límite de intentos: tras 5 fallos el dispositivo queda bloqueado aunque luego acierte", async () => {
    const p = await createPatient(owner, { phone: "71112222", birthDate: "1999-09-09" });
    await appt(p, new Date(Date.now() + 5 * 60_000));
    // Fallos previos de este dispositivo en la sucursal (pruebas anteriores) también cuentan.
    const prev = (await env.db.adminPool.query("SELECT count(*)::int AS n FROM checkin_attempts WHERE branch_id = $1 AND outcome = 'not_found'", [B()])).rows[0].n;
    for (let i = prev; i < MAX_FAILED_PER_DEVICE; i++) {
      const r = await pub("POST", `/api/public/llegada/${token}`, { phoneLast4: "0000", birthDate: "1999-09-09" });
      expect(r.status).toBe(404);
      expect(r.body.message).toMatch(/No encontramos/);
    }
    const blocked = await pub("POST", `/api/public/llegada/${token}`, { phoneLast4: "2222", birthDate: "1999-09-09" });
    expect(blocked.status).toBe(429);
    const log = (await env.db.adminPool.query("SELECT outcome FROM checkin_attempts WHERE point_id = $1 ORDER BY id DESC LIMIT 1", [pointId])).rows[0];
    expect(log.outcome).toBe("blocked");
    await expect(env.db.adminPool.query("DELETE FROM checkin_attempts WHERE point_id = $1", [pointId])).rejects.toThrow(/solo inserción/);
    expect((await pub("POST", `/api/public/llegada/${token}`, { phoneLast4: "12", birthDate: "1999-09-09" })).status).toBe(400);
  });

  it("renovar el QR invalida el anterior; aislamiento entre clínicas", async () => {
    const r = await owner.post("/api/checkin/points", { branchId: B() });
    expect(r.body.renewed).toBe(true);
    expect((await pub("GET", `/api/public/llegada/${token}`)).status).toBe(404);
    expect((await pub("GET", `/api/public/llegada/${r.body.url.split("/llegada/")[1]}`)).status).toBe(200);
    // Un token de llegada firmado con el id de otra clínica no encuentra nada
    const fake = signToken(cfg.secretKey, "llegada", K2.clinicId, r.body.id);
    expect((await pub("GET", `/api/public/llegada/${fake}`)).status).toBe(404);
    expect((await owner2.get("/api/checkin/points")).body.every((x: any) => x.pointId === null)).toBe(true);
    for (const t of ["checkin_points", "checkin_attempts"]) {
      const rows = await withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) => c.query(`SELECT * FROM ${t}`));
      expect(rows.rowCount).toBe(0);
    }
    await expect(withTenant(env.db.appPool, { clinicId: K2.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO checkin_points (id, clinic_id, branch_id) VALUES ($1,$2,$3)", [randomUUID(), K.clinicId, B()]))).rejects.toThrow(/row-level security/);
  });
});
