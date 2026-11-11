// Pequeños pendientes de uso diario (B-084): contador de tareas del menú (mías + de mi rol, vencidas,
// por sucursal y por clínica) y envío manual de la encuesta desde la cita atendida (permiso,
// sucursal, consentimiento y mensaje sin datos clínicos).
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { addUser, createClinic, createPatient, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, K2: TestClinic;
let owner: Agent, owner2: Agent, rec: Agent, rec2: Agent, recOther: Agent, dentist: Agent, support: Agent, accountant: Agent;
let ids: Record<string, string>;
const B0 = () => K.branches[0]!;
const tomorrow = () => new Date(Date.now() + 86_400_000).toLocaleDateString("en-CA", { timeZone: "America/La_Paz" });

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db);
  K2 = await createClinic(env.db);
  owner = await login(env.app, K.ownerEmail);
  owner2 = await login(env.app, K2.ownerEmail);
  const u = {
    rec: await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B0()] }),
    rec2: await addUser(env.db, K.clinicId, "receptionist", { branchIds: [B0()] }),
    recOther: await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[1]!] }),
    dentist: await addUser(env.db, K.clinicId, "dentist", { branchIds: [B0()] }),
    support: await addUser(env.db, K.clinicId, "support", { branchIds: [B0()] }),
    accountant: await addUser(env.db, K.clinicId, "accountant", { allBranches: true }),
  };
  ids = Object.fromEntries(Object.entries(u).map(([k, v]) => [k, v.id]));
  [rec, rec2, recOther, dentist, support, accountant] = await Promise.all([u.rec, u.rec2, u.recOther, u.dentist, u.support, u.accountant].map((x) => login(env.app, x.email)));
});
afterAll(async () => teardown(env));

const count = async (a: Agent) => { const r = await a.get("/api/tasks/pending-count"); expect(r.status).toBe(200); return r.body as { total: number; overdue: number }; };
async function task(a: Agent, body: Record<string, unknown>) {
  const r = await a.post("/api/tasks", { branchId: B0(), title: "Tarea de prueba", ...body });
  expect(r.status, JSON.stringify(r.body)).toBe(200);
  return r.body.id as string;
}

describe("contador de tareas pendientes", () => {
  let roleTask: string, recK2: Agent;
  it("cuenta las mías, las de mi rol sin tomar y las que tomé; resalta vencidas; respeta sucursales y clínicas", async () => {
    expect(await count(rec)).toEqual({ total: 0, overdue: 0 });
    await task(owner, { assigneeUserId: ids.rec });                                        // a: a mí
    roleTask = await task(owner, { assigneeRole: "receptionist" });                         // b: a mi rol
    const taken = await task(owner, { assigneeRole: "receptionist" });                      // c: la toma rec2
    expect((await rec2.post(`/api/tasks/${taken}/take`, {})).status).toBe(200);
    await task(owner, { assigneeRole: "receptionist", branchId: K.branches[1] });           // d: otra sucursal
    const late = await task(owner, { assigneeUserId: ids.dentist, dueDate: tomorrow() });   // e: vencida
    await env.db.adminPool.query("UPDATE staff_tasks SET due_at = now() - interval '2 hours' WHERE id = $1", [late]);
    const done = await task(owner, { assigneeUserId: ids.rec });                            // f: hecha
    expect((await rec.post(`/api/tasks/${done}/done`, {})).status).toBe(200);
    recK2 = await login(env.app, (await addUser(env.db, K2.clinicId, "receptionist", { allBranches: true })).email);
    expect((await owner2.post("/api/tasks", { branchId: K2.branches[0], title: "De otra clínica", assigneeRole: "receptionist" })).status).toBe(200); // g

    expect(await count(rec)).toEqual({ total: 2, overdue: 0 });      // a + b
    expect(await count(rec2)).toEqual({ total: 2, overdue: 0 });     // b + c (tomada por ella)
    expect(await count(recOther)).toEqual({ total: 1, overdue: 0 }); // d
    expect(await count(dentist)).toEqual({ total: 1, overdue: 1 });  // e, vencida
    expect(await count(support)).toEqual({ total: 0, overdue: 0 });
    expect(await count(owner)).toEqual({ total: 0, overdue: 0 });    // creó todas, pero no le esperan a él
  });

  it("al tomar una tarea del rol deja de contar para el resto del rol", async () => {
    expect((await rec.post(`/api/tasks/${roleTask}/take`, {})).status).toBe(200);
    expect(await count(rec)).toEqual({ total: 2, overdue: 0 });  // a + b (tomada por mí)
    expect(await count(rec2)).toEqual({ total: 1, overdue: 0 }); // solo c
  });

  it("requiere sesión; cada clínica cuenta solo lo suyo", async () => {
    expect((await env.app.inject({ method: "GET", url: "/api/tasks/pending-count" })).statusCode).toBe(401);
    expect(await count(recK2)).toEqual({ total: 1, overdue: 0 }); // solo g
  });
});

describe("enviar o copiar el enlace de la encuesta desde la cita atendida", () => {
  let withConsent: string, noConsent: string, apptA: string, apptB: string;
  async function completedAppt(patientId: string, branchId = B0()) {
    // Un profesional por cita: las citas de prueba no chocan entre sí.
    const dentistId = (await addUser(env.db, K.clinicId, "dentist", { allBranches: true })).id;
    const r = await env.db.adminPool.query<{ id: string }>(
      `INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status, completed_at, reason)
       VALUES ($1,$2,$3,$4, now() - interval '2 hours', now() - interval '90 minutes', 'completed', now() - interval '90 minutes', 'Endodoncia pieza 36') RETURNING id`,
      [K.clinicId, branchId, dentistId, patientId]);
    return r.rows[0]!.id;
  }
  beforeAll(async () => {
    withConsent = await createPatient(owner, { firstName: "Marcela", phone: "71234567", consentReminders: true });
    noConsent = await createPatient(owner, { firstName: "Julio", phone: "76543210", consentReminders: false });
    apptA = await completedAppt(withConsent);
    apptB = await completedAppt(noConsent);
  });

  it("con consentimiento: enlace wa.me con un mensaje sin datos clínicos", async () => {
    const r = await rec.post(`/api/appointments/${apptA}/survey-link`);
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body.url).toMatch(/\/e\/.+/);
    expect(r.body.blockedReason).toBeNull();
    expect(r.body.whatsappUrl).toMatch(/^https:\/\/wa\.me\/59171234567\?text=/);
    expect(r.body.message).toContain("Marcela");
    expect(r.body.message).toContain(r.body.url);
    // Sin el enlace ni el nombre aleatorio de la clínica de prueba (pueden contener «36» por azar).
    const text = String(r.body.message).replace(r.body.url, "").replace(/Clínica [0-9a-f]{8}/, "");
    expect(text).not.toMatch(/Endodoncia|36/);
    expect(decodeURIComponent(r.body.whatsappUrl.split("text=")[1])).toBe(r.body.message);
    // pedirlo otra vez devuelve el mismo enlace (un solo uso por cita)
    expect((await rec.post(`/api/appointments/${apptA}/survey-link`)).body.url).toBe(r.body.url);
  });

  it("sin consentimiento: se puede copiar el enlace, pero no se ofrece WhatsApp", async () => {
    const r = await rec.post(`/api/appointments/${apptB}/survey-link`);
    expect(r.status).toBe(200);
    expect(r.body.url).toBeTruthy();
    expect(r.body.whatsappUrl).toBeNull();
    expect(r.body.blockedReason).toMatch(/no aceptó recibir mensajes/);
  });

  it("permisos, sucursal y aislamiento", async () => {
    expect((await accountant.post(`/api/appointments/${apptA}/survey-link`)).status).toBe(403); // sin agenda.write
    expect((await support.post(`/api/appointments/${apptA}/survey-link`)).status).toBe(403);
    expect((await recOther.post(`/api/appointments/${apptA}/survey-link`)).status).toBe(403);   // otra sucursal
    expect((await owner2.post(`/api/appointments/${apptA}/survey-link`)).status).toBe(404);     // otra clínica
    expect((await dentist.post(`/api/appointments/${apptA}/survey-link`)).status).toBe(200);
  });
});
