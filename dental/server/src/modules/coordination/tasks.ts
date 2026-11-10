// Tareas internas del equipo (R2-36): relevos entre recepción, asistentes, odontólogos y limpieza.
//
//  * Cada tarea pertenece a una sucursal y se asigna a una persona O a un rol.
//  * Estados: abierta → tomada → hecha, o cancelada con motivo (la base valida las transiciones
//    con un trigger y no permite borrar). Los comentarios son de solo inserción.
//  * Vínculo opcional a un paciente o a una cita. Quien no tiene `patients.read` (p. ej. limpieza)
//    ve "Paciente (sin acceso)" y no recibe el detalle ni los comentarios de esas tareas; además, una
//    tarea con paciente no se puede asignar a una persona o rol sin acceso a pacientes.
//  * Todos los roles usan el módulo con el permiso `tasks.use`; los listados se filtran por las
//    sucursales permitidas y cada escritura pasa por `requireBranch` y `audit`.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../../lib/http.js";
import { AppError, badRequest, forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { Client } from "../../lib/db.js";
import { allowedBranches, permissionsFor, requireBranch, ROLE_LABELS, ROLES, type AuthCtx, type Role } from "../../lib/rbac.js";
import { clinicZone } from "../agenda.js";

export const TASK_STATUS_LABELS: Record<string, string> = { open: "Abierta", taken: "Tomada", done: "Hecha", cancelled: "Cancelada" };
export const PRIORITY_LABELS: Record<string, string> = { normal: "Normal", high: "Alta" };
export const NO_ACCESS_PATIENT = "Paciente (sin acceso)";

const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)");
const zTitle = z.string().trim().min(3, "Escribe un título de al menos 3 caracteres").max(140, "El título admite hasta 140 caracteres");

export const taskInput = z.object({
  branchId: zId,
  title: zTitle,
  detail: zOptText(2000),
  assigneeUserId: zId.nullish(),
  assigneeRole: z.enum(ROLES).nullish(),
  dueDate: zDate.nullish(),
  dueTime: zTime.nullish(),
  priority: z.enum(["normal", "high"]).default("normal"),
  patientId: zId.nullish(),
  appointmentId: zId.nullish(),
});
export type TaskInput = z.infer<typeof taskInput>;

const canPatients = (auth: AuthCtx) => auth.permissions.has("patients.read");
const isManager = (auth: AuthCtx) => auth.permissions.has("clinic.manage");

interface TaskRow {
  id: string; branchId: string; branchName: string; title: string; detail: string | null;
  assigneeUserId: string | null; assigneeName: string | null; assigneeRole: Role | null;
  dueAt: Date | null; priority: string; patientId: string | null; patientName: string | null;
  appointmentId: string | null; appointmentAt: Date | null; status: string; source: string;
  takenBy: string | null; takenByName: string | null; takenAt: Date | null;
  doneBy: string | null; doneByName: string | null; doneAt: Date | null;
  cancelledByName: string | null; cancelledAt: Date | null; cancelReason: string | null;
  createdBy: string; createdByName: string; createdAt: Date; updatedAt: Date; commentCount: number; overdue: boolean;
}

/** Columnas de la tarea. El nombre del paciente solo se consulta si el rol puede ver pacientes. */
export function taskColumns(auth: AuthCtx) {
  return `t.id, t.branch_id AS "branchId", b.name AS "branchName", t.title, t.detail,
    t.assignee_user_id AS "assigneeUserId", au.full_name AS "assigneeName", t.assignee_role AS "assigneeRole",
    t.due_at AS "dueAt", t.priority, t.patient_id AS "patientId",
    ${canPatients(auth) ? `(SELECT p.first_name || ' ' || p.last_name FROM patients p WHERE p.id = t.patient_id)` : "NULL::text"} AS "patientName",
    t.appointment_id AS "appointmentId",
    ${auth.permissions.has("agenda.read") ? `(SELECT ap.starts_at FROM appointments ap WHERE ap.id = t.appointment_id)` : "NULL::timestamptz"} AS "appointmentAt",
    t.status, t.source, t.taken_by AS "takenBy", tu.full_name AS "takenByName", t.taken_at AS "takenAt",
    t.done_by AS "doneBy", du.full_name AS "doneByName", t.done_at AS "doneAt",
    xu.full_name AS "cancelledByName", t.cancelled_at AS "cancelledAt", t.cancel_reason AS "cancelReason",
    t.created_by AS "createdBy", cu.full_name AS "createdByName", t.created_at AS "createdAt", t.updated_at AS "updatedAt",
    (SELECT count(*) FROM staff_task_comments k WHERE k.task_id = t.id)::int AS "commentCount",
    (t.status IN ('open','taken') AND t.due_at IS NOT NULL AND t.due_at < now()) AS overdue`;
}
export const TASK_FROM = `FROM staff_tasks t JOIN branches b ON b.id = t.branch_id
  LEFT JOIN users au ON au.id = t.assignee_user_id LEFT JOIN users tu ON tu.id = t.taken_by
  LEFT JOIN users du ON du.id = t.done_by LEFT JOIN users xu ON xu.id = t.cancelled_by JOIN users cu ON cu.id = t.created_by`;
/** Orden: vencidas primero, luego prioridad alta, luego por vencimiento. */
export const TASK_ORDER = `ORDER BY (t.status IN ('open','taken')) DESC, (t.status IN ('open','taken') AND t.due_at < now()) DESC,
  (t.priority = 'high') DESC, t.due_at NULLS LAST, t.created_at DESC`;

function isAssignee(auth: AuthCtx, t: Pick<TaskRow, "assigneeUserId" | "assigneeRole">) {
  return t.assigneeUserId === auth.userId || (!!t.assigneeRole && t.assigneeRole === auth.membership!.role);
}

/** Lo que la persona puede hacer con la tarea (el servidor vuelve a validarlo en cada acción). */
export function taskAbilities(auth: AuthCtx, t: Pick<TaskRow, "status" | "assigneeUserId" | "assigneeRole" | "takenBy" | "createdBy" | "patientId">) {
  const active = t.status === "open" || t.status === "taken";
  const hidden = !!t.patientId && !canPatients(auth);
  const mine = isAssignee(auth, t);
  return {
    canTake: !hidden && t.status === "open" && (mine || isManager(auth)),
    canRelease: !hidden && t.status === "taken" && (t.takenBy === auth.userId || isManager(auth)),
    canDone: !hidden && active && (mine || t.takenBy === auth.userId || t.createdBy === auth.userId || isManager(auth)),
    canCancel: !hidden && active && (t.createdBy === auth.userId || isManager(auth)),
    canEdit: !hidden && active && (t.createdBy === auth.userId || isManager(auth)),
    canComment: !hidden,
  };
}

/** Presenta la tarea para la persona: oculta lo ligado a pacientes si no tiene acceso. */
export function presentTask(auth: AuthCtx, zone: string, r: TaskRow) {
  const hidden = !!r.patientId && !canPatients(auth);
  const fmt = (d: Date | null) => (d ? DateTime.fromJSDate(d, { zone }).toFormat("dd/MM/yyyy HH:mm") : null);
  return {
    ...r,
    detail: hidden ? null : r.detail,
    detailHidden: hidden && !!r.detail,
    patientId: hidden ? null : r.patientId,
    patientName: r.patientId ? (hidden ? NO_ACCESS_PATIENT : r.patientName) : null,
    hasPatient: !!r.patientId,
    appointmentId: hidden ? null : r.appointmentId,
    statusLabel: TASK_STATUS_LABELS[r.status],
    priorityLabel: PRIORITY_LABELS[r.priority],
    assigneeLabel: r.assigneeName ?? (r.assigneeRole ? `${ROLE_LABELS[r.assigneeRole]} (cualquiera del rol)` : "—"),
    assigneeRoleLabel: r.assigneeRole ? ROLE_LABELS[r.assigneeRole] : null,
    dueLocal: fmt(r.dueAt),
    appointmentLocal: hidden ? null : fmt(r.appointmentAt),
    ...taskAbilities(auth, r),
  };
}

/** Miembros activos que trabajan en la sucursal (para asignar tareas). */
async function branchMembers(c: Client, branchId: string) {
  return (await c.query<{ userId: string; fullName: string; role: Role; isProfessional: boolean }>(
    `SELECT m.user_id AS "userId", u.full_name AS "fullName", m.role, m.is_professional AS "isProfessional"
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.clinic_id = app_clinic_id() AND m.active AND u.disabled_at IS NULL
        AND (m.all_branches OR m.role = 'owner' OR $1 = ANY(m.branch_ids))
      ORDER BY u.full_name`, [branchId])).rows;
}

async function dueAtFrom(c: Client, auth: AuthCtx, dueDate: string | null | undefined, dueTime: string | null | undefined, checkPast: boolean) {
  if (!dueDate) {
    if (dueTime) throw badRequest("dueDate: indica la fecha de vencimiento si indicas una hora");
    return null;
  }
  const zone = await clinicZone(c, auth.clinicId!);
  const d = DateTime.fromISO(`${dueDate}T${dueTime ?? "23:59"}`, { zone });
  if (!d.isValid) throw badRequest("dueDate: fecha de vencimiento inválida");
  const today = DateTime.now().setZone(zone).toISODate()!;
  if (checkPast && dueDate < today) throw badRequest("dueDate: el vencimiento no puede ser anterior a hoy");
  if (d > DateTime.now().plus({ years: 2 })) throw badRequest("dueDate: el vencimiento no puede pasar de 2 años");
  return d.toJSDate();
}

/** Valida la asignación (persona o rol) contra la sucursal y el vínculo con un paciente. */
async function validateAssignee(c: Client, branchId: string, a: { assigneeUserId?: string | null; assigneeRole?: Role | null }, withPatient: boolean) {
  if (!!a.assigneeUserId === !!a.assigneeRole) throw badRequest("assigneeUserId: asigna la tarea a una persona o a un rol (uno de los dos)");
  const members = await branchMembers(c, branchId);
  if (a.assigneeUserId) {
    const m = members.find((x) => x.userId === a.assigneeUserId);
    if (!m) throw badRequest("assigneeUserId: esa persona no trabaja en la sucursal de la tarea o no está activa");
    if (withPatient && !permissionsFor(m.role, m.isProfessional).has("patients.read")) {
      throw badRequest("assigneeUserId: la tarea está ligada a un paciente y esa persona no tiene acceso a pacientes");
    }
    return { assigneeUserId: m.userId, assigneeRole: null, label: m.fullName };
  }
  const role = a.assigneeRole!;
  if (!members.some((m) => m.role === role)) throw badRequest(`assigneeRole: nadie con el rol ${ROLE_LABELS[role]} trabaja en esa sucursal`);
  if (withPatient && !permissionsFor(role, false).has("patients.read")) {
    throw badRequest(`assigneeRole: la tarea está ligada a un paciente y el rol ${ROLE_LABELS[role]} no tiene acceso a pacientes`);
  }
  return { assigneeUserId: null, assigneeRole: role, label: ROLE_LABELS[role] };
}

/** Crea una tarea (también la usa el registro de llamadas para "volver a llamar"). */
export async function createTask(c: Client, auth: AuthCtx, body: TaskInput, opts: { source?: "manual" | "call"; sourceCallId?: string } = {}) {
  requireBranch(auth, body.branchId);
  const br = (await c.query<{ active: boolean }>("SELECT active FROM branches WHERE id = $1", [body.branchId])).rows[0];
  if (!br || !br.active) throw badRequest("branchId: la sucursal no existe o está inactiva");
  let patientId = body.patientId ?? null;
  const appointmentId = body.appointmentId ?? null;
  if ((patientId || appointmentId) && !canPatients(auth)) throw forbidden("No tienes acceso a pacientes para ligar la tarea a uno");
  if (appointmentId) {
    if (!auth.permissions.has("agenda.read")) throw forbidden("No tienes acceso a la agenda para ligar la tarea a una cita");
    const ap = (await c.query<{ patient_id: string; branch_id: string }>("SELECT patient_id, branch_id FROM appointments WHERE id = $1", [appointmentId])).rows[0];
    if (!ap) throw badRequest("appointmentId: la cita no existe");
    requireBranch(auth, ap.branch_id);
    if (patientId && patientId !== ap.patient_id) throw badRequest("appointmentId: la cita es de otro paciente");
    patientId = ap.patient_id;
  }
  if (patientId) {
    const p = (await c.query("SELECT 1 FROM patients WHERE id = $1", [patientId])).rows[0];
    if (!p) throw badRequest("patientId: el paciente no existe");
  }
  const who = await validateAssignee(c, body.branchId, body, !!patientId);
  const dueAt = await dueAtFrom(c, auth, body.dueDate, body.dueTime, true);
  const id = (await c.query<{ id: string }>(
    `INSERT INTO staff_tasks (clinic_id, branch_id, title, detail, assignee_user_id, assignee_role, due_at, priority, patient_id, appointment_id,
                              source, source_call_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id`,
    [auth.clinicId, body.branchId, body.title, body.detail ?? null, who.assigneeUserId, who.assigneeRole, dueAt, body.priority,
      patientId, appointmentId, opts.source ?? "manual", opts.sourceCallId ?? null, auth.userId])).rows[0]!.id;
  // Auditoría sin textos libres (el título y el detalle no van al diario).
  await audit(c, auth, "task.created", "task", id, {
    assignee: who.label, assigneeUserId: who.assigneeUserId, assigneeRole: who.assigneeRole, priority: body.priority,
    dueAt, patientId, source: opts.source ?? "manual",
  }, body.branchId);
  return id;
}

async function loadTask(c: Client, auth: AuthCtx, id: string, lock = false) {
  const t = (await c.query<TaskRow>(`SELECT ${taskColumns(auth)} ${TASK_FROM} WHERE t.id = $1 ${lock ? "FOR UPDATE OF t" : ""}`, [id])).rows[0];
  if (!t) throw notFound("Tarea");
  requireBranch(auth, t.branchId);
  return t;
}

const stateError = (msg: string) => new AppError(409, "invalid_transition", msg);

export function taskRoutes(route: Route) {
  route({
    method: "GET", url: "/api/tasks",
    summary: "Tareas internas: «mis tareas» (asignadas a mí o a mi rol, o tomadas por mí), creadas por mí o el tablero de una sucursal",
    tags: ["tareas"], perm: "tasks.use",
    query: z.object({
      scope: z.enum(["mine", "created", "branch"]).default("mine"),
      branchId: zId.optional(),
      status: z.enum(["active", "done", "cancelled", "all"]).default("active"),
    }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const statuses = query.status === "active" ? ["open", "taken"] : query.status === "all" ? ["open", "taken", "done", "cancelled"] : [query.status];
      const scopeSql = query.scope === "mine"
        ? `AND (t.assignee_user_id = $4 OR t.assignee_role = $5 OR t.taken_by = $4)`
        : query.scope === "created" ? `AND t.created_by = $4 AND $5::text IS NOT NULL` : `AND ($4::uuid IS NOT NULL OR $5::text IS NOT NULL)`;
      const rows = (await c.query<TaskRow>(
        `SELECT ${taskColumns(auth)} ${TASK_FROM}
          WHERE t.status = ANY($1) AND ($2::uuid[] IS NULL OR t.branch_id = ANY($2)) AND ($3::uuid IS NULL OR t.branch_id = $3) ${scopeSql}
            AND (t.status IN ('open','taken') OR COALESCE(t.done_at, t.cancelled_at) > now() - interval '60 days')
          ${TASK_ORDER} LIMIT 300`,
        [statuses, allowedBranches(auth), query.branchId ?? null, auth.userId, auth.membership!.role])).rows;
      return rows.map((r) => presentTask(auth, zone, r));
    },
  });

  route({
    method: "GET", url: "/api/tasks/assignees", summary: "Personas y roles a los que se puede asignar una tarea en una sucursal",
    tags: ["tareas"], perm: "tasks.use", query: z.object({ branchId: zId }),
    handler: async ({ c, auth, query }) => {
      requireBranch(auth, query.branchId);
      if (!(await c.query("SELECT 1 FROM branches WHERE id = $1", [query.branchId])).rowCount) throw notFound("Sucursal");
      const members = await branchMembers(c, query.branchId);
      const roles = ROLES.filter((r) => members.some((m) => m.role === r));
      return {
        people: members.map((m) => ({
          userId: m.userId, fullName: m.fullName, role: m.role, roleLabel: ROLE_LABELS[m.role],
          canSeePatients: permissionsFor(m.role, m.isProfessional).has("patients.read"),
        })),
        roles: roles.map((r) => ({ role: r, label: ROLE_LABELS[r], canSeePatients: permissionsFor(r, false).has("patients.read") })),
      };
    },
  });

  route({
    method: "GET", url: "/api/tasks/:id", summary: "Detalle de una tarea con sus comentarios", tags: ["tareas"], perm: "tasks.use", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const t = await loadTask(c, auth, params.id);
      const zone = await clinicZone(c, auth.clinicId!);
      const hidden = !!t.patientId && !canPatients(auth);
      const comments = hidden ? [] : (await c.query(
        `SELECT k.id, k.body, k.created_at AS "createdAt", u.full_name AS "authorName", k.author_id AS "authorId"
           FROM staff_task_comments k JOIN users u ON u.id = k.author_id WHERE k.task_id = $1 ORDER BY k.created_at, k.id`, [params.id])).rows;
      return { ...presentTask(auth, zone, t), comments, commentsHidden: hidden };
    },
  });

  route({
    method: "POST", url: "/api/tasks", summary: "Crear una tarea interna (asignada a una persona o a un rol de la sucursal)", tags: ["tareas"], perm: "tasks.use",
    body: taskInput,
    handler: async ({ c, auth, body }) => ({ id: await createTask(c, auth, body) }),
  });

  route({
    method: "PATCH", url: "/api/tasks/:id", summary: "Editar una tarea abierta o tomada (quien la creó o administración)", tags: ["tareas"], perm: "tasks.use",
    params: zIdParams,
    body: z.object({
      title: zTitle.optional(), detail: zOptText(2000).optional(), assigneeUserId: zId.nullish(), assigneeRole: z.enum(ROLES).nullish(),
      dueDate: zDate.nullish(), dueTime: zTime.nullish(), priority: z.enum(["normal", "high"]).optional(),
    }),
    handler: async ({ c, auth, params, body }) => {
      const t = await loadTask(c, auth, params.id, true);
      if (!taskAbilities(auth, t).canEdit) {
        if (t.status === "done" || t.status === "cancelled") throw stateError("La tarea está cerrada y ya no se edita");
        throw forbidden("Solo quien creó la tarea o administración pueden editarla");
      }
      const set: Record<string, unknown> = {};
      if (body.title !== undefined) set.title = body.title;
      if (body.detail !== undefined) set.detail = body.detail;
      if (body.priority !== undefined) set.priority = body.priority;
      if (body.dueDate !== undefined) set.due_at = await dueAtFrom(c, auth, body.dueDate, body.dueTime, false);
      let reassigned = false;
      if (body.assigneeUserId !== undefined || body.assigneeRole !== undefined) {
        const who = await validateAssignee(c, t.branchId, { assigneeUserId: body.assigneeUserId ?? null, assigneeRole: body.assigneeRole ?? null }, !!t.patientId);
        reassigned = who.assigneeUserId !== t.assigneeUserId || who.assigneeRole !== t.assigneeRole;
        set.assignee_user_id = who.assigneeUserId;
        set.assignee_role = who.assigneeRole;
        // Al reasignar una tarea tomada, vuelve a quedar abierta para la nueva persona o rol.
        if (reassigned && t.status === "taken") Object.assign(set, { status: "open", taken_by: null, taken_at: null });
      }
      const keys = Object.keys(set);
      if (!keys.length) return { ok: true };
      await c.query(`UPDATE staff_tasks SET ${keys.map((k, i) => `${k} = $${i + 2}`).join(", ")}, updated_at = now() WHERE id = $1`,
        [params.id, ...keys.map((k) => set[k])]);
      await audit(c, auth, "task.updated", "task", params.id, { fields: keys, reassigned, assigneeUserId: set.assignee_user_id, assigneeRole: set.assignee_role }, t.branchId);
      return { ok: true };
    },
  });

  const transition = (action: "take" | "release" | "done") => route({
    method: "POST", url: `/api/tasks/:id/${action}`,
    summary: action === "take" ? "Tomar una tarea abierta (queda a mi cargo)" : action === "release" ? "Soltar una tarea tomada (vuelve a abierta)" : "Marcar una tarea como hecha",
    tags: ["tareas"], perm: "tasks.use", params: zIdParams,
    body: z.object({ note: zOptText(1000) }),
    handler: async ({ c, auth, params, body }) => {
      const t = await loadTask(c, auth, params.id, true);
      const ab = taskAbilities(auth, t);
      if (t.status === "done" || t.status === "cancelled") throw stateError(`La tarea ya está ${TASK_STATUS_LABELS[t.status]!.toLowerCase()}`);
      if (action === "take") {
        if (t.status !== "open") throw stateError(`La tarea ya fue tomada por ${t.takenByName ?? "otra persona"}`);
        if (!ab.canTake) throw forbidden("Esta tarea está asignada a otra persona o a otro rol");
        await c.query("UPDATE staff_tasks SET status = 'taken', taken_by = $2, taken_at = now(), updated_at = now() WHERE id = $1", [params.id, auth.userId]);
      } else if (action === "release") {
        if (t.status !== "taken") throw stateError("Solo se puede soltar una tarea tomada");
        if (!ab.canRelease) throw forbidden("Solo quien tomó la tarea o administración pueden soltarla");
        await c.query("UPDATE staff_tasks SET status = 'open', taken_by = NULL, taken_at = NULL, updated_at = now() WHERE id = $1", [params.id]);
      } else {
        if (!ab.canDone) throw forbidden("Esta tarea está asignada a otra persona o a otro rol");
        await c.query("UPDATE staff_tasks SET status = 'done', done_by = $2, done_at = now(), updated_at = now() WHERE id = $1", [params.id, auth.userId]);
      }
      if (body.note) await c.query("INSERT INTO staff_task_comments (clinic_id, task_id, body, author_id) VALUES ($1,$2,$3,$4)", [auth.clinicId, params.id, body.note, auth.userId]);
      const verb = action === "take" ? "taken" : action === "release" ? "released" : "done";
      await audit(c, auth, `task.${verb}`, "task", params.id, { from: t.status }, t.branchId);
      return { ok: true };
    },
  });
  transition("take");
  transition("release");
  transition("done");

  route({
    method: "POST", url: "/api/tasks/:id/cancel", summary: "Cancelar una tarea con motivo (quien la creó o administración)", tags: ["tareas"], perm: "tasks.use",
    params: zIdParams, body: z.object({ reason: z.string().trim().min(3, "Indica el motivo (al menos 3 caracteres)").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const t = await loadTask(c, auth, params.id, true);
      if (t.status === "done" || t.status === "cancelled") throw stateError(`La tarea ya está ${TASK_STATUS_LABELS[t.status]!.toLowerCase()}`);
      if (!taskAbilities(auth, t).canCancel) throw forbidden("Solo quien creó la tarea o administración pueden cancelarla");
      await c.query("UPDATE staff_tasks SET status = 'cancelled', cancelled_by = $2, cancelled_at = now(), cancel_reason = $3, updated_at = now() WHERE id = $1",
        [params.id, auth.userId, body.reason]);
      await audit(c, auth, "task.cancelled", "task", params.id, { from: t.status }, t.branchId);
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/tasks/:id/comments", summary: "Agregar un comentario a la tarea (los comentarios no se editan ni se borran)", tags: ["tareas"], perm: "tasks.use",
    params: zIdParams, body: z.object({ body: z.string().trim().min(1, "Escribe el comentario").max(1000, "El comentario admite hasta 1000 caracteres") }),
    handler: async ({ c, auth, params, body }) => {
      const t = await loadTask(c, auth, params.id);
      if (!taskAbilities(auth, t).canComment) throw forbidden("La tarea está ligada a un paciente y no tienes acceso a pacientes");
      const r = await c.query<{ id: string }>("INSERT INTO staff_task_comments (clinic_id, task_id, body, author_id) VALUES ($1,$2,$3,$4) RETURNING id",
        [auth.clinicId, params.id, body.body, auth.userId]);
      await audit(c, auth, "task.commented", "task", params.id, { commentId: r.rows[0]!.id }, t.branchId);
      return { id: r.rows[0]!.id };
    },
  });
}
