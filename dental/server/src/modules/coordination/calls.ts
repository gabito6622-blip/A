// Registro de llamadas al paciente (R2-42): el botón "Llamar" abre el marcador del teléfono (tel:)
// y después se registra el resultado, la duración (manual) y una nota NO clínica. Si el paciente
// pidió que lo vuelvan a llamar, se puede crear en el mismo paso una tarea de seguimiento.
// Las llamadas son de solo inserción y aparecen en el historial del paciente.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../../lib/http.js";
import { badRequest, forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { requireBranch, ROLES } from "../../lib/rbac.js";
import { clinicZone } from "../agenda.js";
import { createTask } from "./tasks.js";

export const CALL_OUTCOMES = ["answered", "no_answer", "wrong_number", "call_back"] as const;
export const CALL_OUTCOME_LABELS: Record<string, string> = {
  answered: "Contestó", no_answer: "No contestó", wrong_number: "Número equivocado", call_back: "Pidió que lo volvamos a llamar",
};

export function callRoutes(route: Route) {
  route({
    method: "POST", url: "/api/patients/:id/calls",
    summary: "Registrar una llamada al paciente (resultado, duración manual y nota no clínica); si pidió volver a llamar, crea una tarea opcional",
    tags: ["llamadas"], perm: "patients.read", params: zIdParams,
    body: z.object({
      branchId: zId,
      appointmentId: zId.nullish(),
      outcome: z.enum(CALL_OUTCOMES, { message: "Elige el resultado de la llamada" }),
      durationMin: z.number().int("La duración va en minutos enteros").min(0, "La duración no puede ser negativa").max(240, "La duración máxima es de 240 minutos").nullish(),
      note: zOptText(500),
      followUp: z.object({
        title: z.string().trim().min(3, "Escribe un título de al menos 3 caracteres").max(140).optional(),
        dueDate: zDate,
        dueTime: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)").nullish(),
        assigneeUserId: zId.nullish(),
        assigneeRole: z.enum(ROLES).nullish(),
        priority: z.enum(["normal", "high"]).default("normal"),
      }).nullish(),
    }),
    handler: async ({ c, auth, params, body }) => {
      requireBranch(auth, body.branchId);
      const p = (await c.query<{ phone: string | null; first_name: string }>("SELECT phone, first_name FROM patients WHERE id = $1", [params.id])).rows[0];
      if (!p) throw notFound("Paciente");
      if (body.appointmentId) {
        if (!auth.permissions.has("agenda.read")) throw forbidden("No tienes acceso a la agenda");
        const ap = (await c.query<{ patient_id: string; branch_id: string }>("SELECT patient_id, branch_id FROM appointments WHERE id = $1", [body.appointmentId])).rows[0];
        if (!ap || ap.patient_id !== params.id) throw badRequest("appointmentId: la cita no es de este paciente");
        requireBranch(auth, ap.branch_id);
      }
      if (body.followUp && body.outcome !== "call_back") throw badRequest("followUp: la tarea de seguimiento solo se crea cuando el paciente pidió que lo volvamos a llamar");
      const id = (await c.query<{ id: string }>(
        `INSERT INTO patient_calls (clinic_id, branch_id, patient_id, appointment_id, phone, outcome, duration_min, note, user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.clinicId, body.branchId, params.id, body.appointmentId ?? null, p.phone, body.outcome, body.durationMin ?? null, body.note, auth.userId])).rows[0]!.id;
      let taskId: string | null = null;
      if (body.followUp) {
        const f = body.followUp;
        const assignee = f.assigneeUserId || f.assigneeRole ? { assigneeUserId: f.assigneeUserId ?? null, assigneeRole: f.assigneeRole ?? null } : { assigneeUserId: auth.userId, assigneeRole: null };
        taskId = await createTask(c, auth, {
          branchId: body.branchId, title: f.title ?? "Volver a llamar al paciente", detail: null, ...assignee,
          dueDate: f.dueDate, dueTime: f.dueTime ?? null, priority: f.priority, patientId: params.id, appointmentId: body.appointmentId ?? null,
        }, { source: "call", sourceCallId: id });
      }
      // La nota no va a la auditoría (es texto libre); solo datos estructurados.
      await audit(c, auth, "call.logged", "patient", params.id, { callId: id, outcome: body.outcome, durationMin: body.durationMin ?? null, taskId, appointmentId: body.appointmentId ?? null }, body.branchId);
      return { id, taskId };
    },
  });

  route({
    method: "GET", url: "/api/patients/:id/calls", summary: "Llamadas registradas del paciente (más recientes primero)", tags: ["llamadas"], perm: "patients.read",
    params: zIdParams,
    handler: async ({ c, auth, params }) => {
      if (!(await c.query("SELECT 1 FROM patients WHERE id = $1", [params.id])).rowCount) throw notFound("Paciente");
      const zone = await clinicZone(c, auth.clinicId!);
      const rows = (await c.query(
        `SELECT k.id, k.outcome, k.duration_min AS "durationMin", k.note, k.phone, k.created_at AS "createdAt", k.appointment_id AS "appointmentId",
                u.full_name AS "userName", b.name AS "branchName",
                (SELECT t.id FROM staff_tasks t WHERE t.source_call_id = k.id) AS "taskId"
           FROM patient_calls k JOIN users u ON u.id = k.user_id JOIN branches b ON b.id = k.branch_id
          WHERE k.patient_id = $1 ORDER BY k.created_at DESC, k.id DESC LIMIT 100`, [params.id])).rows;
      return rows.map((r) => ({ ...r, outcomeLabel: CALL_OUTCOME_LABELS[r.outcome], local: DateTime.fromJSDate(r.createdAt, { zone }).toFormat("dd/MM/yyyy HH:mm") }));
    },
  });
}
