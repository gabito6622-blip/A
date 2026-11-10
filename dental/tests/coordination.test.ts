// Coordinación del equipo: tareas internas, llamadas, diario de actividad y tarjetas del Inicio.
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { DateTime } from "luxon";
import { withTenant } from "../server/src/lib/db.js";
import { addUser, createClinic, createPatient, fullSchedule, login, setupEnv, teardown, type Agent, type Env, type TestClinic } from "./helpers.js";

let env: Env;
let K: TestClinic, OTHER: TestClinic;
let owner: Agent, rec0: Agent, rec1: Agent, dent: Agent, support: Agent, asst: Agent, acct: Agent, otherOwner: Agent;
let U: Record<"rec0" | "rec1" | "dent" | "support" | "asst" | "acct", { id: string; email: string }>;
let P: string; // Juan Pérez (ficticio)
const ZONE = "America/La_Paz";
const B0 = () => K.branches[0]!;
const B1 = () => K.branches[1]!;
const today = () => DateTime.now().setZone(ZONE).toISODate()!;
const inDays = (n: number) => DateTime.now().setZone(ZONE).plus({ days: n }).toISODate()!;

const newTask = async (a: Agent, over: Record<string, unknown> = {}) => {
  const r = await a.post("/api/tasks", { branchId: B0(), title: "Revisar la orden de laboratorio", assigneeUserId: U.dent.id, dueDate: inDays(1), ...over });
  if (r.status !== 200) throw new Error(`task ${r.status} ${JSON.stringify(r.body)}`);
  return r.body.id as string;
};
const task = async (id: string) => (await env.db.adminPool.query("SELECT * FROM staff_tasks WHERE id = $1", [id])).rows[0];

beforeAll(async () => {
  env = await setupEnv();
  K = await createClinic(env.db, { branches: 2 });
  OTHER = await createClinic(env.db, { branches: 1 });
  U = {
    rec0: await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[0]!] }),
    rec1: await addUser(env.db, K.clinicId, "receptionist", { branchIds: [K.branches[1]!] }),
    dent: await addUser(env.db, K.clinicId, "dentist", { branchIds: [K.branches[0]!] }),
    support: await addUser(env.db, K.clinicId, "support", { branchIds: [K.branches[0]!] }),
    asst: await addUser(env.db, K.clinicId, "assistant", { branchIds: [K.branches[0]!] }),
    acct: await addUser(env.db, K.clinicId, "accountant", { allBranches: true }),
  };
  await env.db.adminPool.query("UPDATE users SET full_name = 'Ana Recepción' WHERE id = $1", [U.rec0.id]);
  await env.db.adminPool.query("UPDATE users SET full_name = 'Dra. Paula Prueba (odontóloga)' WHERE id = $1", [U.dent.id]);
  await fullSchedule(env.db, K.clinicId, U.dent.id, K.branches[0]!);
  owner = await login(env.app, K.ownerEmail);
  rec0 = await login(env.app, U.rec0.email);
  rec1 = await login(env.app, U.rec1.email);
  dent = await login(env.app, U.dent.email);
  support = await login(env.app, U.support.email);
  asst = await login(env.app, U.asst.email);
  acct = await login(env.app, U.acct.email);
  otherOwner = await login(env.app, OTHER.ownerEmail);
  P = await createPatient(owner, { firstName: "Juan", lastName: "Pérez Mamani", preferredBranchId: K.branches[0] });
});
afterAll(async () => teardown(env));

describe("tareas internas: ciclo de vida", () => {
  it("recepción crea una tarea para el odontólogo; él la toma y la marca hecha; los cierres no se reabren", async () => {
    const id = await newTask(rec0, { detail: "Está en la bandeja desde ayer.", priority: "high" });
    const mine = (await dent.get("/api/tasks?scope=mine")).body;
    const t = mine.find((x: any) => x.id === id);
    expect(t).toMatchObject({ status: "open", statusLabel: "Abierta", priority: "high", priorityLabel: "Alta", assigneeName: "Dra. Paula Prueba (odontóloga)", canTake: true, canDone: true, canCancel: false });
    expect(t.dueLocal).toMatch(/23:59$/);
    // Recepción la ve en "creadas por mí", no en "mis tareas"
    expect((await rec0.get("/api/tasks?scope=created")).body.some((x: any) => x.id === id)).toBe(true);
    expect((await rec0.get("/api/tasks?scope=mine")).body.some((x: any) => x.id === id)).toBe(false);
    // Otra persona no puede tomarla
    expect((await asst.post(`/api/tasks/${id}/take`, {})).status).toBe(403);
    expect((await dent.post(`/api/tasks/${id}/take`, {})).status).toBe(200);
    expect(await task(id)).toMatchObject({ status: "taken", taken_by: U.dent.id });
    expect((await dent.post(`/api/tasks/${id}/take`, {})).status).toBe(409);
    expect((await dent.post(`/api/tasks/${id}/done`, { note: "Firmada y enviada." })).status).toBe(200);
    expect(await task(id)).toMatchObject({ status: "done", done_by: U.dent.id });
    expect((await dent.post(`/api/tasks/${id}/release`, {})).status).toBe(409);
    expect((await rec0.post(`/api/tasks/${id}/cancel`, { reason: "Ya no hace falta" })).status).toBe(409);
    expect((await rec0.patch(`/api/tasks/${id}`, { title: "Otro título" })).status).toBe(409);
    const detail = (await rec0.get(`/api/tasks/${id}`)).body;
    expect(detail.comments.map((c: any) => c.body)).toEqual(["Firmada y enviada."]);
    // Ni el dueño de la base puede reabrirla, borrarla ni cambiar sus comentarios
    await expect(env.db.adminPool.query("UPDATE staff_tasks SET status = 'open' WHERE id = $1", [id])).rejects.toThrow(/cerrada/);
    await expect(env.db.adminPool.query("DELETE FROM staff_tasks WHERE id = $1", [id])).rejects.toThrow(/no se eliminan/);
    await expect(env.db.adminPool.query("UPDATE staff_task_comments SET body = 'x' WHERE task_id = $1", [id])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM staff_task_comments WHERE task_id = $1", [id])).rejects.toThrow(/solo inserción/);
  });

  it("una tarea asignada a un rol la ve y la toma cualquiera del rol; quien la tomó puede soltarla", async () => {
    const id = await newTask(rec0, { assigneeUserId: null, assigneeRole: "assistant", title: "Reponer guantes en el Consultorio 2" });
    expect((await asst.get("/api/tasks")).body.find((x: any) => x.id === id)).toMatchObject({ assigneeLabel: "Asistente (cualquiera del rol)", canTake: true });
    expect((await dent.get("/api/tasks")).body.some((x: any) => x.id === id)).toBe(false);
    expect((await dent.post(`/api/tasks/${id}/take`, {})).status).toBe(403);
    expect((await asst.post(`/api/tasks/${id}/take`, {})).status).toBe(200);
    expect((await rec0.post(`/api/tasks/${id}/release`, {})).status).toBe(403);
    expect((await asst.post(`/api/tasks/${id}/release`, {})).status).toBe(200);
    expect(await task(id)).toMatchObject({ status: "open", taken_by: null });
    // Comentarios de solo inserción visibles en el detalle
    expect((await asst.post(`/api/tasks/${id}/comments`, { body: "Faltan baberos también." })).status).toBe(200);
    expect((await asst.post(`/api/tasks/${id}/comments`, { body: "   " })).status).toBe(400);
    expect((await rec0.get(`/api/tasks/${id}`)).body).toMatchObject({ commentCount: 1, comments: [{ body: "Faltan baberos también." }] });
    expect((await asst.post(`/api/tasks/${id}/done`, {})).status).toBe(200);
  });

  it("cancelar exige motivo y solo lo hace quien la creó o administración; editar reasigna", async () => {
    const id = await newTask(rec0);
    expect((await dent.post(`/api/tasks/${id}/cancel`, { reason: "No corresponde" })).status).toBe(403);
    expect((await rec0.post(`/api/tasks/${id}/cancel`, { reason: "" })).status).toBe(400);
    // Reasignar una tarea tomada la vuelve a dejar abierta
    expect((await dent.post(`/api/tasks/${id}/take`, {})).status).toBe(200);
    expect((await rec0.patch(`/api/tasks/${id}`, { assigneeRole: "assistant", assigneeUserId: null, priority: "high" })).status).toBe(200);
    expect(await task(id)).toMatchObject({ status: "open", taken_by: null, assignee_role: "assistant", assignee_user_id: null, priority: "high" });
    expect((await owner.post(`/api/tasks/${id}/cancel`, { reason: "Se resolvió por teléfono" })).status).toBe(200);
    expect(await task(id)).toMatchObject({ status: "cancelled", cancel_reason: "Se resolvió por teléfono" });
    const audits = (await env.db.adminPool.query("SELECT action FROM audit_log WHERE entity = 'task' AND entity_id = $1 ORDER BY id", [id])).rows.map((r) => r.action);
    expect(audits).toEqual(["task.created", "task.taken", "task.updated", "task.cancelled"]);
  });

  it("valida asignación, vencimiento, título y sucursal con mensajes claros", async () => {
    const base = { branchId: B0(), title: "Llamar al técnico del autoclave", dueDate: inDays(2) };
    const both = await rec0.post("/api/tasks", { ...base, assigneeUserId: U.dent.id, assigneeRole: "assistant" });
    expect(both.status).toBe(400);
    expect(both.body.error.message).toMatch(/persona o a un rol/);
    expect((await rec0.post("/api/tasks", base)).status).toBe(400);
    const otherBranch = await rec0.post("/api/tasks", { ...base, assigneeUserId: U.rec1.id });
    expect(otherBranch.status).toBe(400);
    expect(otherBranch.body.error.message).toMatch(/no trabaja en la sucursal/);
    const past = await rec0.post("/api/tasks", { ...base, assigneeUserId: U.dent.id, dueDate: inDays(-1) });
    expect(past.status).toBe(400);
    expect(past.body.error.message).toMatch(/anterior a hoy/);
    expect((await rec0.post("/api/tasks", { ...base, assigneeUserId: U.dent.id, title: "ok" })).status).toBe(400);
    expect((await rec0.post("/api/tasks", { ...base, assigneeUserId: U.dent.id, title: "x".repeat(141) })).status).toBe(400);
    expect((await rec0.post("/api/tasks", { ...base, assigneeRole: "accountant" })).status).toBe(200); // contabilidad tiene todas las sucursales
    expect((await rec1.post("/api/tasks", { ...base, assigneeUserId: U.dent.id })).status).toBe(403);
    expect((await rec0.post("/api/tasks", { ...base, assigneeUserId: U.dent.id, dueDate: today(), dueTime: "25:00" })).status).toBe(400);
    // Las personas y roles asignables dicen quién puede ver pacientes
    const as = (await support.get(`/api/tasks/assignees?branchId=${B0()}`)).body;
    expect(as.people.find((p: any) => p.userId === U.support.id)).toMatchObject({ roleLabel: "Limpieza y apoyo", canSeePatients: false });
    expect(as.roles.find((r: any) => r.role === "dentist")).toMatchObject({ canSeePatients: true });
    expect((await support.get(`/api/tasks/assignees?branchId=${B1()}`)).status).toBe(403);
  });
});

describe("tareas: permisos y pacientes", () => {
  it("limpieza usa las tareas sin ver pacientes: la tarea ligada a un paciente no filtra datos", async () => {
    // Limpieza crea y recibe tareas sin paciente
    expect((await support.post("/api/tasks", { branchId: B0(), title: "Falta jabón en el baño", assigneeRole: "receptionist" })).status).toBe(200);
    const forCleaner = await newTask(rec0, { assigneeUserId: U.support.id, title: "Desinfección profunda del Consultorio 1" });
    expect((await support.get("/api/tasks")).body.find((x: any) => x.id === forCleaner)).toMatchObject({ canTake: true, canDone: true });
    expect((await support.post(`/api/tasks/${forCleaner}/done`, {})).status).toBe(200);
    // Una tarea con paciente no se puede asignar a limpieza (ni a la persona ni al rol)
    const toCleaner = await rec0.post("/api/tasks", { branchId: B0(), title: "Llamar al paciente", assigneeUserId: U.support.id, patientId: P });
    expect(toCleaner.status).toBe(400);
    expect(toCleaner.body.error.message).toMatch(/no tiene acceso a pacientes/);
    expect((await rec0.post("/api/tasks", { branchId: B0(), title: "Llamar al paciente", assigneeRole: "support", patientId: P })).status).toBe(400);
    // Limpieza no puede ligar una tarea a un paciente
    expect((await support.post("/api/tasks", { branchId: B0(), title: "Llamar al paciente", assigneeRole: "receptionist", patientId: P })).status).toBe(403);
    // En el tablero ve la tarea, pero sin paciente, sin detalle y sin comentarios
    const id = await newTask(rec0, { assigneeUserId: null, assigneeRole: "receptionist", patientId: P, title: "Confirmar el control", detail: "Juan prefiere por la tarde, alergia a la penicilina." });
    expect((await rec0.post(`/api/tasks/${id}/comments`, { body: "Le dejé un mensaje a Juan Pérez." })).status).toBe(200);
    const board = (await support.get(`/api/tasks?scope=branch&branchId=${B0()}`)).body;
    const seen = board.find((x: any) => x.id === id);
    expect(seen).toMatchObject({ patientName: "Paciente (sin acceso)", patientId: null, detail: null, detailHidden: true, hasPatient: true, canTake: false, canComment: false });
    const one = (await support.get(`/api/tasks/${id}`)).body;
    expect(one).toMatchObject({ comments: [], commentsHidden: true, patientName: "Paciente (sin acceso)" });
    for (const body of [board, one]) {
      const s = JSON.stringify(body);
      expect(s).not.toContain("Pérez");
      expect(s).not.toContain("penicilina");
      expect(s).not.toContain(P);
    }
    expect((await support.post(`/api/tasks/${id}/comments`, { body: "hola" })).status).toBe(403);
    expect((await support.post(`/api/tasks/${id}/take`, {})).status).toBe(403);
    // Recepción sí ve el paciente y el detalle
    expect((await rec0.get(`/api/tasks/${id}`)).body).toMatchObject({ patientName: "Juan Pérez Mamani", patientId: P, detailHidden: false });
    // Limpieza sigue sin acceso a pacientes ni a la agenda
    expect((await support.get("/api/patients")).status).toBe(403);
    expect((await support.get(`/api/patients/${P}/calls`)).status).toBe(403);
  });

  it("una tarea ligada a una cita queda ligada a su paciente; la cita de otro paciente se rechaza", async () => {
    const other = await createPatient(owner);
    const start = DateTime.now().setZone(ZONE).plus({ days: 3 }).set({ hour: 10, minute: 0, second: 0, millisecond: 0 });
    const appt = (await env.db.adminPool.query(
      "INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [K.clinicId, B0(), U.dent.id, P, start.toJSDate(), start.plus({ minutes: 30 }).toJSDate()])).rows[0].id;
    const id = await newTask(rec0, { appointmentId: appt, title: "Preparar el consentimiento para la cita" });
    expect(await task(id)).toMatchObject({ patient_id: P, appointment_id: appt });
    expect((await rec0.post("/api/tasks", { branchId: B0(), title: "Mezcla", assigneeUserId: U.dent.id, appointmentId: appt, patientId: other })).status).toBe(400);
    await expect(env.db.adminPool.query("UPDATE staff_tasks SET patient_id = $2 WHERE id = $1", [id, other])).rejects.toThrow(/origen/);
  });
});

describe("registro de llamadas", () => {
  it("se registra desde la ficha con resultado y duración, aparece en el historial y no se modifica", async () => {
    const r = await rec0.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "answered", durationMin: 3, note: "Confirma que vendrá." });
    expect(r.status).toBe(200);
    expect(r.body.taskId).toBeNull();
    const list = (await rec0.get(`/api/patients/${P}/calls`)).body;
    expect(list[0]).toMatchObject({ outcome: "answered", outcomeLabel: "Contestó", durationMin: 3, note: "Confirma que vendrá.", userName: "Ana Recepción" });
    const tl = (await rec0.get(`/api/patients/${P}/timeline?limit=100`)).body;
    const item = tl.items.find((i: any) => i.kind === "call");
    expect(item).toMatchObject({ title: "Llamada: contestó", category: "recalls", actor: "Ana Recepción" });
    expect(item.detail).toContain("3 min");
    // El odontólogo (agenda.read) también la ve en el historial
    expect((await dent.get(`/api/patients/${P}/timeline?types=recalls`)).body.items.some((i: any) => i.kind === "call")).toBe(true);
    await expect(env.db.adminPool.query("UPDATE patient_calls SET outcome = 'no_answer' WHERE id = $1", [r.body.id])).rejects.toThrow(/solo inserción/);
    await expect(env.db.adminPool.query("DELETE FROM patient_calls WHERE id = $1", [r.body.id])).rejects.toThrow(/solo inserción/);
  });

  it("'pidió volver a llamar' crea una tarea opcional ligada a la llamada; los datos se validan", async () => {
    const r = await rec0.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "call_back", durationMin: 1, followUp: { dueDate: inDays(1), dueTime: "17:30" } });
    expect(r.status).toBe(200);
    const t = await task(r.body.taskId);
    expect(t).toMatchObject({ source: "call", source_call_id: r.body.id, patient_id: P, assignee_user_id: U.rec0.id, title: "Volver a llamar al paciente" });
    expect(DateTime.fromJSDate(t.due_at, { zone: ZONE }).toFormat("HH:mm")).toBe("17:30");
    expect((await rec0.get(`/api/patients/${P}/calls`)).body[0].taskId).toBe(r.body.taskId);
    // Seguimiento solo con "pidió volver a llamar"
    expect((await rec0.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "answered", followUp: { dueDate: inDays(1) } })).status).toBe(400);
    expect((await rec0.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "busy" })).status).toBe(400);
    expect((await rec0.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "answered", durationMin: -1 })).status).toBe(400);
    expect((await rec0.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "answered", note: "x".repeat(501) })).status).toBe(400);
    expect((await rec1.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "answered" })).status).toBe(403);
    // Una cita de otro paciente no se acepta
    const other = await createPatient(owner);
    const start = DateTime.now().setZone(ZONE).plus({ days: 4 }).set({ hour: 11, minute: 0, second: 0, millisecond: 0 });
    const appt = (await env.db.adminPool.query(
      "INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [K.clinicId, B0(), U.dent.id, other, start.toJSDate(), start.plus({ minutes: 30 }).toJSDate()])).rows[0].id;
    expect((await rec0.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "answered", appointmentId: appt })).status).toBe(400);
    // Desde la cita: queda vinculada y el historial muestra la hora de la cita
    const fromAppt = await rec0.post(`/api/patients/${other}/calls`, { branchId: B0(), outcome: "no_answer", appointmentId: appt });
    expect(fromAppt.status).toBe(200);
    const tl = (await rec0.get(`/api/patients/${other}/timeline`)).body.items.find((i: any) => i.kind === "call");
    expect(tl.detail).toContain(start.toFormat("dd/MM/yyyy HH:mm"));
  });
});

describe("diario de actividad", () => {
  it("traduce las acciones a frases claras y oculta lo clínico", async () => {
    const pay = await rec0.post("/api/payments", { branchId: B0(), patientId: P, amountCents: 15000, method: "qr", bankReference: `QR-${randomUUID().slice(0, 8)}`, idempotencyKey: randomUUID() });
    expect(pay.status).toBe(200);
    expect((await dent.post(`/api/patients/${P}/notes`, { branchId: B0(), body: "SECRETO-CLINICO: dolor agudo en pieza 16", diagnosis: "Pulpitis irreversible" })).status).toBe(200);
    expect((await dent.post(`/api/patients/${P}/odontogram`, { tooth: 16, surfaces: ["O"], condition: "caries", state: "existing", notes: "SECRETO-ODONTO" })).status).toBe(200);
    expect((await rec0.post("/api/payments", { branchId: B0(), patientId: P, amountCents: 5000, method: "cash", notes: "SECRETO-NOTA-PAGO", idempotencyKey: randomUUID() })).status).toBe(200);
    const d = (await owner.get("/api/activity?limit=100")).body;
    const phrases = d.items.map((i: any) => i.phrase);
    expect(phrases).toContain("Ana Recepción registró un pago QR de Bs 150,00 a Juan P.");
    expect(phrases).toContain("Ana Recepción registró un pago en efectivo de Bs 50,00 a Juan P.");
    expect(phrases).toContain("Dra. Paula Prueba registró una nota clínica de Juan P.");
    expect(phrases).toContain("Dra. Paula Prueba registró un hallazgo en el odontograma de Juan P.");
    expect(phrases).toContain("Ana Recepción registró una llamada a Juan P. (contestó)");
    expect(phrases.some((p: string) => /^Ana Recepción creó una tarea para Dra\. Paula Prueba/.test(p))).toBe(true);
    const s = JSON.stringify(d);
    for (const secret of ["SECRETO", "Pulpitis", "caries", "Caries", "pieza 16", "Confirma que vendrá", "penicilina", "Pérez"]) expect(s).not.toContain(secret);
    const item = d.items.find((i: any) => i.phrase.includes("pago QR"));
    expect(item).toMatchObject({ typeLabel: "Cobros y caja", branchName: "Sucursal 1", actorRole: "Recepción" });
    expect(item).not.toHaveProperty("data");
    // Acción desconocida: frase genérica sin datos
    await env.db.adminPool.query("INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, data) VALUES ($1,$2,'inventory.algo_nuevo','inv_item',NULL,$3)",
      [K.clinicId, U.asst.id, JSON.stringify({ note: "SECRETO-INV" })]);
    const inv = (await owner.get("/api/activity?type=inventory&limit=5")).body.items[0];
    expect(inv.phrase).toMatch(/hizo un movimiento de inventario$/);
    expect(JSON.stringify(inv)).not.toContain("SECRETO");
  });

  it("filtra por persona, sucursal, tipo y fechas; exporta a Excel; solo propietario o administración", async () => {
    const byRec = (await owner.get(`/api/activity?userId=${U.rec0.id}&limit=200`)).body.items;
    expect(byRec.length).toBeGreaterThan(0);
    expect(byRec.every((i: any) => i.userId === U.rec0.id)).toBe(true);
    const pays = (await owner.get("/api/activity?type=payments")).body.items;
    expect(pays.length).toBeGreaterThanOrEqual(2);
    expect(pays.every((i: any) => i.type === "payments")).toBe(true);
    expect((await owner.get(`/api/activity?branchId=${B1()}`)).body.items.every((i: any) => i.branchName === "Sucursal 2")).toBe(true);
    expect((await owner.get(`/api/activity?from=${inDays(1)}`)).body.items).toEqual([]);
    expect((await owner.get(`/api/activity?from=${today()}&to=${today()}&type=payments`)).body.items.length).toBe(pays.length);
    expect((await owner.get(`/api/activity?from=${today()}&to=${inDays(-1)}`)).status).toBe(400);
    expect((await owner.get("/api/activity?type=desconocido")).status).toBe(400);
    expect((await owner.get("/api/activity?cursor=bm9wZQ")).status).toBe(400);
    for (const a of [rec0, dent, support, acct]) expect((await a.get("/api/activity")).status).toBe(403);
    const opts = (await owner.get("/api/activity/options")).body;
    expect(opts.people.some((p: any) => p.userId === U.rec0.id)).toBe(true);
    expect(opts.types.find((t: any) => t.id === "clinical")).toMatchObject({ label: "Atención clínica" });
    const x = await owner.get(`/api/activity.xlsx?type=payments`);
    expect(x.status).toBe(200);
    expect(String(x.headers["content-type"])).toContain("spreadsheetml");
    // La auditoría de la exportación se confirma al cerrar la transacción (justo después de enviar el archivo).
    let exported = 0;
    for (let i = 0; i < 20 && !exported; i++) {
      exported = (await env.db.adminPool.query("SELECT 1 FROM audit_log WHERE clinic_id = $1 AND action = 'activity.exported'", [K.clinicId])).rowCount ?? 0;
      if (!exported) await new Promise((r) => setTimeout(r, 50));
    }
    expect(exported).toBe(1);
  });

  it("cursor estable y rápido con más de 10 000 filas de auditoría", async () => {
    const N = 10_500;
    await env.db.adminPool.query(
      `INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, created_at)
       SELECT $1, CASE WHEN g % 3 = 0 THEN $2::uuid ELSE $3::uuid END, CASE WHEN g % 2 = 0 THEN 'patient.viewed' ELSE 'appointment.status' END,
              CASE WHEN g % 2 = 0 THEN 'patient' ELSE 'appointment' END, $4, $5, jsonb_build_object('from','scheduled','to','confirmed'),
              now() - make_interval(secs => g)
         FROM generate_series(1, $6::int) g`,
      [K.clinicId, U.rec0.id, U.dent.id, P, B0(), N]);
    // Ruido de otra clínica: nunca debe aparecer
    await env.db.adminPool.query(
      `INSERT INTO audit_log (clinic_id, user_id, action, entity, data) SELECT $1, NULL, 'patient.viewed', 'patient', '{}'::jsonb FROM generate_series(1, 500)`, [OTHER.clinicId]);
    const total = Number((await env.db.adminPool.query("SELECT count(*) FROM audit_log WHERE clinic_id = $1", [K.clinicId])).rows[0].count);
    expect(total).toBeGreaterThan(N);
    const seen = new Set<string>();
    const order: string[] = [];
    let cursor: string | null = null;
    let pages = 0, slowest = 0;
    const t0 = Date.now();
    do {
      const s = Date.now();
      const r: { status: number; body: any } = await owner.get(`/api/activity?limit=200${cursor ? `&cursor=${cursor}` : ""}`);
      slowest = Math.max(slowest, Date.now() - s);
      expect(r.status).toBe(200);
      for (const i of r.body.items) {
        expect(seen.has(i.id)).toBe(false);
        seen.add(i.id);
        order.push(`${i.atKey}|${i.id.padStart(18, "0")}`);
      }
      // Filas nuevas a mitad de la navegación no desordenan ni duplican las páginas siguientes
      if (pages === 3) await rec0.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "no_answer" });
      cursor = r.body.nextCursor;
      pages++;
    } while (cursor && pages < 200);
    expect(seen.size).toBe(total);
    expect(order).toEqual([...order].sort((a, b) => (a < b ? 1 : a > b ? -1 : 0)));
    expect(slowest).toBeLessThan(1500);
    expect(Date.now() - t0).toBeLessThan(30_000);
    // Filtro por persona sobre el volumen grande
    const s = Date.now();
    const dentOnly = (await owner.get(`/api/activity?userId=${U.dent.id}&limit=200`)).body;
    expect(Date.now() - s).toBeLessThan(1500);
    expect(dentOnly.items.every((i: any) => i.userId === U.dent.id)).toBe(true);
    expect(dentOnly.nextCursor).not.toBeNull();
  });
});

describe("tarjetas proactivas del Inicio", () => {
  const cards = async (a: Agent, q = "") => (await a.get(`/api/home/cards${q}`)).body;

  it("tareas vencidas en el Inicio de quien corresponde", async () => {
    const id = await newTask(rec0, { title: "Revisar la radiografía pendiente", assigneeUserId: U.dent.id });
    await env.db.adminPool.query("UPDATE staff_tasks SET due_at = now() - interval '2 hours' WHERE id = $1", [id]);
    const d = await cards(dent);
    expect(d.myTasks.items.find((t: any) => t.id === id)).toMatchObject({ overdue: true });
    expect(d.cards.find((c: any) => c.id === "overdue_tasks")).toMatchObject({ count: 1, title: "1 tarea vencida a tu cargo", link: "/tareas" });
    expect((await cards(asst)).cards.some((c: any) => c.id === "overdue_tasks")).toBe(false);
    // Administración ve las vencidas del equipo
    expect((await cards(owner)).cards.find((c: any) => c.id === "team_overdue_tasks").count).toBeGreaterThanOrEqual(1);
    expect((await dent.post(`/api/tasks/${id}/done`, {})).status).toBe(200);
    expect((await cards(dent)).cards.some((c: any) => c.id === "overdue_tasks")).toBe(false);
    // Limpieza recibe sus tareas pero ninguna tarjeta de agenda ni de laboratorio
    const sup = await cards(support);
    expect(sup.cards.every((c: any) => c.kind === "overdue_tasks")).toBe(true);
  });

  it("citas pasadas sin cerrar y trabajos de laboratorio listos, según rol y sucursal", async () => {
    const y = DateTime.now().setZone(ZONE).minus({ days: 1 }).set({ hour: 9, minute: 0, second: 0, millisecond: 0 });
    await env.db.adminPool.query(
      "INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at, status) VALUES ($1,$2,$3,$4,$5,$6,'confirmed')",
      [K.clinicId, B0(), U.dent.id, P, y.toJSDate(), y.plus({ minutes: 30 }).toJSDate()]);
    expect((await cards(owner)).cards.find((c: any) => c.id === "unclosed")).toMatchObject({ count: 1, title: "1 cita pasada sin cerrar", link: "/sala-espera" });
    expect((await cards(dent)).cards.find((c: any) => c.id === "unclosed").count).toBe(1);
    expect((await cards(rec1)).cards.some((c: any) => c.id === "unclosed")).toBe(false);
    expect((await cards(owner, `?branchId=${B1()}`)).cards.some((c: any) => c.id === "unclosed")).toBe(false);
    expect((await cards(rec1, `?branchId=${B0()}`)).cards).toBeUndefined();
    expect((await rec1.get(`/api/home/cards?branchId=${B0()}`)).status).toBe(403);

    const L = await createPatient(owner, { firstName: "Corona", lastName: "Ficticia" });
    const lab = (await env.db.adminPool.query("INSERT INTO labs (clinic_id, name) VALUES ($1,'Laboratorio Ficticio') RETURNING id", [K.clinicId])).rows[0].id;
    await env.db.adminPool.query(
      `INSERT INTO lab_orders (clinic_id, number, lab_id, patient_id, dentist_id, branch_id, work_type, status, sent_on, received_on, cost_cents, created_by)
       VALUES ($1, 1, $2, $3, $4, $5, 'crown', 'received', current_date - 5, current_date, 30000, $4)`, [K.clinicId, lab, L, U.dent.id, B0()]);
    const ready = (await cards(dent)).cards.find((c: any) => c.id === "lab_ready");
    expect(ready).toMatchObject({ count: 1, title: "1 trabajo de laboratorio listo sin cita de colocación" });
    expect((await cards(rec0)).cards.some((c: any) => c.id === "lab_ready")).toBe(true);
    expect((await cards(rec1)).cards.some((c: any) => c.id === "lab_ready")).toBe(false);
    expect((await cards(support)).cards.some((c: any) => c.id === "lab_ready")).toBe(false);
  });

  const left = () => DateTime.now().setZone(ZONE).endOf("day").diffNow("minutes").minutes;
  it.runIf(left() > 90)("hueco liberado hoy: candidatos de la lista de espera y de controles, sin otra sucursal y sin agendar solo", async () => {
    const start = DateTime.now().setZone(ZONE).plus({ minutes: 40 }).set({ second: 0, millisecond: 0 });
    const s = start.set({ minute: start.minute - (start.minute % 5) });
    const A = await createPatient(owner, { firstName: "Cancelado", lastName: "Ficticio" });
    const W = await createPatient(owner, { firstName: "Espera", lastName: "Ficticia" });
    const R = await createPatient(owner, { firstName: "Control", lastName: "Ficticio" });
    const X = await createPatient(owner, { firstName: "Otra", lastName: "Sucursal" });
    const appt = (await env.db.adminPool.query(
      "INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, starts_at, ends_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
      [K.clinicId, B0(), U.dent.id, A, s.toJSDate(), s.plus({ minutes: 30 }).toJSDate()])).rows[0].id;
    expect((await rec0.post(`/api/appointments/${appt}/status`, { status: "cancelled", reason: "El paciente avisó" })).status).toBe(200);
    expect((await rec0.post("/api/waitlist", { branchId: B0(), patientId: W, durationMin: 30, earliestDate: today() })).status).toBe(200);
    expect((await rec1.post("/api/waitlist", { branchId: B1(), patientId: X, durationMin: 30 })).status).toBe(200);
    expect((await rec0.post("/api/recalls", { patientId: R, branchId: B0(), reason: "Control de limpieza", dueDate: inDays(10) })).status).toBe(200);

    const d = await cards(rec0);
    const slot = d.cards.find((c: any) => c.kind === "freed_slot" && c.slot.startsAt === s.toJSDate().toISOString());
    expect(slot).toBeTruthy();
    expect(slot.title).toBe(`Se liberó un hueco hoy a las ${s.toFormat("HH:mm")} con Dra. Paula Prueba (odontóloga)`);
    expect(slot.slot).toMatchObject({ branchId: B0(), dentistId: U.dent.id, durationMin: 30, date: today(), time: s.toFormat("HH:mm") });
    const names = slot.slot.candidates.map((x: any) => x.patientName);
    expect(names).toContain("Espera Ficticia");
    expect(names).toContain("Control Ficticio");
    expect(names).not.toContain("Otra Sucursal");
    expect(names).not.toContain("Cancelado Ficticio");
    expect(slot.slot.candidates.find((x: any) => x.patientName === "Control Ficticio")).toMatchObject({ source: "recall", reason: "Control de limpieza" });
    expect(JSON.stringify(d.cards)).not.toMatch(/cancelar/i);
    // La tarjeta solo propone: no se creó ninguna cita
    expect((await env.db.adminPool.query("SELECT count(*)::int AS n FROM appointments WHERE patient_id = ANY($1)", [[W, R]])).rows[0].n).toBe(0);
    // Otra sucursal, limpieza y contabilidad no la ven; el odontólogo ve su propio hueco
    expect((await cards(rec1)).cards.some((c: any) => c.kind === "freed_slot")).toBe(false);
    expect((await cards(support)).cards.some((c: any) => c.kind === "freed_slot")).toBe(false);
    expect((await cards(acct)).cards.some((c: any) => c.kind === "freed_slot")).toBe(false);
    expect((await cards(dent)).cards.some((c: any) => c.kind === "freed_slot")).toBe(true);
    // Cuando una persona agenda el hueco, la tarjeta desaparece
    const booked = await owner.post("/api/appointments", { branchId: B0(), dentistId: U.dent.id, patientId: W, startsAt: s.toISO(), durationMin: 30, allowOutsideSchedule: true });
    expect(booked.status, JSON.stringify(booked.body)).toBe(200);
    expect((await cards(rec0)).cards.some((c: any) => c.kind === "freed_slot" && c.slot.startsAt === s.toJSDate().toISOString())).toBe(false);
  });
});

describe("aislamiento entre clínicas", () => {
  it("tareas, comentarios y llamadas de otra clínica no se ven ni se tocan", async () => {
    const id = await newTask(rec0, { title: "Tarea privada de la clínica K" });
    await rec0.post(`/api/tasks/${id}/comments`, { body: "comentario privado" });
    const call = (await rec0.post(`/api/patients/${P}/calls`, { branchId: B0(), outcome: "answered" })).body.id;
    expect((await otherOwner.get(`/api/tasks/${id}`)).status).toBe(404);
    expect((await otherOwner.post(`/api/tasks/${id}/done`, {})).status).toBe(404);
    expect((await otherOwner.post(`/api/tasks/${id}/comments`, { body: "x" })).status).toBe(404);
    expect((await otherOwner.get("/api/tasks?scope=branch")).body).toEqual([]);
    expect((await otherOwner.get(`/api/patients/${P}/calls`)).status).toBe(404);
    expect((await otherOwner.post(`/api/patients/${P}/calls`, { branchId: OTHER.branches[0], outcome: "answered" })).status).toBe(404);
    expect((await otherOwner.get(`/api/tasks/assignees?branchId=${B0()}`)).status).toBe(404);
    const diary = JSON.stringify((await otherOwner.get("/api/activity?limit=200")).body);
    expect(diary).not.toContain("Ana Recepción");
    expect(diary).not.toContain("Juan");
    const home = (await otherOwner.get("/api/home/cards")).body;
    expect(home.myTasks.total).toBe(0);
    expect(home.cards).toEqual([]);
    // SQL directo con el contexto de otra clínica: 0 filas; insertar con clinic_id ajeno: rechazado por RLS
    await withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: null }, async (c) => {
      for (const t of ["staff_tasks", "staff_task_comments", "patient_calls"]) {
        expect((await c.query(`SELECT count(*)::int AS n FROM ${t}`)).rows[0].n).toBe(0);
      }
    });
    await expect(withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO staff_tasks (clinic_id, branch_id, title, assignee_role, created_by) VALUES ($1,$2,'Intrusa','owner',$3)", [K.clinicId, B0(), U.rec0.id]))).rejects.toThrow(/row-level security/);
    await expect(withTenant(env.db.appPool, { clinicId: OTHER.clinicId, userId: null }, (c) =>
      c.query("INSERT INTO patient_calls (clinic_id, branch_id, patient_id, outcome, user_id) VALUES ($1,$2,$3,'answered',$4)", [K.clinicId, B0(), P, U.rec0.id]))).rejects.toThrow(/row-level security/);
    // FK compuesta: una tarea de la otra clínica no puede apuntar a un paciente de K
    await expect(env.db.adminPool.query(
      "INSERT INTO staff_tasks (clinic_id, branch_id, title, assignee_role, patient_id, created_by) VALUES ($1,$2,'Cruce','owner',$3,$4)",
      [OTHER.clinicId, OTHER.branches[0], P, OTHER.ownerId])).rejects.toThrow(/foreign key/);
    expect(call).toBeTruthy();
  });
});
