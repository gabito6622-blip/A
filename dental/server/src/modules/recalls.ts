// Controles ("volver a citar"): cola mensual por sucursal, intentos de contacto,
// propuesta "Próximo control" al atender y vínculo automático con la cita.
// Los controles solo organizan la cola: no envían mensajes. WhatsApp es un enlace wa.me
// que la persona abre a mano, solo con consentimiento y sin datos clínicos.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../lib/http.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../lib/rbac.js";
import { clinicZone } from "./agenda.js";
import { compatibleRecalls } from "./appointmentEvents.js";
import { normalize } from "../lib/text.js";

export const RECALL_STATUS_LABELS: Record<string, string> = {
  pending: "Pendiente", scheduled: "Agendado", done: "Hecho", dismissed: "Descartado", review: "Revisar",
};
export const CHANNEL_LABELS: Record<string, string> = { call: "Llamada", whatsapp: "WhatsApp", sms: "SMS", in_person: "En persona" };
export const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "No contesta", voicemail: "Buzón de voz", scheduled: "Agendó", declined: "No desea", wrong_number: "Número equivocado", other: "Otro",
};
/** Resultados que cuentan como intento sin éxito. */
export const FAILED_OUTCOMES = ["no_answer", "voicemail", "declined", "wrong_number"];
/** Con este número de intentos sin éxito el control pasa a "revisar". */
export const MAX_FAILED_ATTEMPTS = 3;
export const DEFAULT_RECALL_MONTHS = 6;

const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido (AAAA-MM)");

const RECALL_COLUMNS = `r.id, r.patient_id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName", p.first_name AS "patientFirstName",
  p.phone AS "patientPhone", p.consent_reminders AS "consentReminders", p.archived_at IS NOT NULL AS "patientArchived",
  r.branch_id AS "branchId", b.name AS "branchName", r.procedure_id AS "procedureId", pr.name AS "procedureName",
  r.dentist_id AS "dentistId", du.full_name AS "dentistName", r.reason, r.due_date AS "dueDate", to_char(r.due_month, 'YYYY-MM') AS "dueMonth",
  r.priority, r.status, r.origin, r.note, r.dismiss_reason AS "dismissReason", r.appointment_id AS "appointmentId", ap.starts_at AS "appointmentStartsAt",
  r.source_appointment_id AS "sourceAppointmentId", r.created_at AS "createdAt",
  (SELECT count(*)::int FROM recall_attempts t WHERE t.recall_id = r.id) AS attempts,
  (SELECT count(*)::int FROM recall_attempts t WHERE t.recall_id = r.id AND t.outcome = ANY('{${FAILED_OUTCOMES.join(",")}}')
      AND t.created_at > COALESCE(r.attempts_reset_at, '-infinity')) AS "failedAttempts",
  (SELECT json_build_object('channel', t.channel, 'outcome', t.outcome, 'note', t.note, 'createdAt', t.created_at, 'userName', tu.full_name)
     FROM recall_attempts t JOIN users tu ON tu.id = t.user_id WHERE t.recall_id = r.id ORDER BY t.created_at DESC LIMIT 1) AS "lastAttempt"`;
const RECALL_FROM = `FROM recalls r JOIN patients p ON p.id = r.patient_id JOIN branches b ON b.id = r.branch_id
  LEFT JOIN procedures pr ON pr.id = r.procedure_id LEFT JOIN users du ON du.id = r.dentist_id LEFT JOIN appointments ap ON ap.id = r.appointment_id`;

function decorate(x: any, clinicName: string) {
  const active = x.status === "pending" || x.status === "review";
  // Mensaje sin datos clínicos: no menciona el motivo ni la prestación.
  const text = `Hola ${x.patientFirstName}, te escribimos de ${clinicName} (${x.branchName}). Ya es momento de tu próximo control. ¿Te ayudamos a agendar una cita? Responde este mensaje y coordinamos el día y la hora.`;
  const phone = String(x.patientPhone ?? "").replace(/\D/g, "");
  const canWhatsapp = active && !!x.consentReminders && phone.length >= 7 && !x.patientArchived;
  const { patientFirstName: _f, ...rest } = x;
  return {
    ...rest,
    statusLabel: RECALL_STATUS_LABELS[x.status],
    whatsappUrl: canWhatsapp ? `https://wa.me/${phone}?text=${encodeURIComponent(text)}` : null,
    whatsappBlocked: !active ? null : x.patientArchived ? "Paciente archivado" : !x.consentReminders ? "Sin consentimiento para mensajes" : phone.length < 7 ? "Sin celular" : null,
  };
}

async function clinicName(c: Client, clinicId: string) {
  return (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [clinicId])).rows[0]!.name;
}

async function loadRecall(c: Client, auth: AuthCtx, id: string, lock = false) {
  const r = (await c.query<{ id: string; status: string; branch_id: string; patient_id: string; attempts_reset_at: Date | null }>(
    `SELECT id, status, branch_id, patient_id, attempts_reset_at FROM recalls WHERE id = $1 ${lock ? "FOR UPDATE" : ""}`, [id])).rows[0];
  if (!r) throw notFound("Control");
  requireBranch(auth, r.branch_id);
  return r;
}

/** Datos de la propuesta "Próximo control" para una cita atendida. */
export async function recallSuggestion(c: Client, auth: AuthCtx, appointmentId: string) {
  const zone = await clinicZone(c, auth.clinicId!);
  const a = (await c.query<{ id: string; patient_id: string; patient_name: string; branch_id: string; dentist_id: string; starts_at: Date; status: string; procedure_id: string | null }>(
    `SELECT a.id, a.patient_id, p.first_name || ' ' || p.last_name AS patient_name, a.branch_id, a.dentist_id, a.starts_at, a.status, a.procedure_id
       FROM appointments a JOIN patients p ON p.id = a.patient_id WHERE a.id = $1`, [appointmentId])).rows[0];
  if (!a) throw notFound("Cita");
  requireBranch(auth, a.branch_id);
  const day = DateTime.fromJSDate(a.starts_at, { zone }).startOf("day");
  // Prestación de la cita + tratamientos realizados ese día al paciente.
  const procs = (await c.query<{ id: string; name: string; recall_months: number | null; from_appt: boolean }>(
    `SELECT pr.id, pr.name, pr.recall_months, bool_or(src = 'appt') AS from_appt FROM (
        SELECT $2::uuid AS procedure_id, 'appt' AS src
        UNION ALL
        SELECT bi.procedure_id, 'done' FROM budget_items bi JOIN budgets bu ON bu.id = bi.budget_id
         WHERE bu.patient_id = $1 AND bi.status = 'done' AND bi.performed_at >= $3 AND bi.performed_at < $4
      ) s JOIN procedures pr ON pr.id = s.procedure_id
      GROUP BY pr.id, pr.name, pr.recall_months ORDER BY pr.recall_months NULLS LAST, pr.name`,
    [a.patient_id, a.procedure_id, day.toJSDate(), day.plus({ days: 1 }).toJSDate()],
  )).rows;
  const options = procs.map((p) => ({ procedureId: p.id, name: p.name, months: p.recall_months ?? DEFAULT_RECALL_MONTHS, configured: p.recall_months != null }));
  const best = options.find((o) => o.configured) ?? options[0] ?? null;
  const existing = (await c.query(
    `SELECT id, reason, due_date AS "dueDate", status FROM recalls WHERE patient_id = $1 AND status IN ('pending','review','scheduled') AND (source_appointment_id IS DISTINCT FROM $2) ORDER BY due_date`,
    [a.patient_id, a.id])).rows;
  const already = (await c.query(`SELECT id, reason, due_date AS "dueDate", status FROM recalls WHERE source_appointment_id = $1`, [a.id])).rows[0] ?? null;
  return {
    appointment: { id: a.id, patientId: a.patient_id, patientName: a.patient_name, branchId: a.branch_id, dentistId: a.dentist_id, date: day.toISODate(), status: a.status },
    suggested: { reason: best?.name ?? "Control general", months: best?.months ?? DEFAULT_RECALL_MONTHS, procedureId: best?.procedureId ?? null },
    options, existing, alreadyCreated: already,
  };
}

export function recallRoutes(route: Route) {
  // ---------------- Cola de controles ----------------
  route({
    method: "GET", url: "/api/recalls", summary: "Controles por sucursal y mes, con contadores (vencen esta semana, atrasados, agendados y conversión)", tags: ["controles"], perm: "agenda.read",
    query: z.object({
      branchId: zId.optional(), month: zMonth.optional(),
      status: z.enum(["active", "all", "pending", "scheduled", "done", "dismissed", "review"]).default("active"),
      priority: z.enum(["low", "normal", "high"]).optional(),
      overdue: z.enum(["1", "0"]).default("1"),
      q: z.string().trim().max(80).optional(),
    }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const today = DateTime.now().setZone(zone).startOf("day");
      const month = query.month ?? today.toFormat("yyyy-MM");
      const monthStart = `${month}-01`;
      const scope = [query.branchId ?? null, allowedBranches(auth)];
      const cnt = (await c.query(
        `SELECT count(*) FILTER (WHERE r.status IN ('pending','review') AND r.due_date >= $3::date AND r.due_date < $3::date + 7)::int AS due_week,
                count(*) FILTER (WHERE r.status IN ('pending','review') AND r.due_date < $3::date)::int AS overdue,
                count(*) FILTER (WHERE r.status = 'scheduled' AND r.due_month = $4::date)::int AS scheduled,
                count(*) FILTER (WHERE r.status IN ('scheduled','done') AND r.due_month = $4::date)::int AS converted,
                count(*) FILTER (WHERE r.status <> 'dismissed' AND r.due_month = $4::date)::int AS due_month
           FROM recalls r JOIN patients p ON p.id = r.patient_id
          WHERE p.archived_at IS NULL AND ($1::uuid IS NULL OR r.branch_id = $1) AND ($2::uuid[] IS NULL OR r.branch_id = ANY($2))`,
        [...scope, today.toISODate(), monthStart])).rows[0];
      const statuses = query.status === "active" ? ["pending", "review"] : query.status === "all" ? null : [query.status];
      const withOverdue = query.overdue === "1" && (query.status === "active" || query.status === "pending" || query.status === "review");
      const like = query.q ? `%${normalize(query.q)}%` : null;
      const rows = (await c.query(
        `SELECT ${RECALL_COLUMNS} ${RECALL_FROM}
          WHERE ($1::uuid IS NULL OR r.branch_id = $1) AND ($2::uuid[] IS NULL OR r.branch_id = ANY($2))
            AND (r.due_month = $3::date OR ($4::boolean AND r.due_month < $3::date))
            AND ($5::text[] IS NULL OR r.status = ANY($5)) AND ($6::text IS NULL OR r.priority = $6)
            AND ($7::text IS NULL OR p.search_text LIKE $7)
            AND (p.archived_at IS NULL OR $5::text[] IS NULL)
          ORDER BY CASE r.priority WHEN 'high' THEN 0 WHEN 'normal' THEN 1 ELSE 2 END, r.due_date, p.last_name
          LIMIT 500`,
        [...scope, monthStart, withOverdue, statuses, query.priority ?? null, like])).rows;
      const name = await clinicName(c, auth.clinicId!);
      return {
        month, today: today.toISODate(),
        counters: {
          dueThisWeek: cnt.due_week, overdue: cnt.overdue, scheduled: cnt.scheduled,
          conversion: { numerator: cnt.converted, denominator: cnt.due_month, pct: cnt.due_month ? Math.round((cnt.converted / cnt.due_month) * 1000) / 10 : null },
        },
        items: rows.map((x) => decorate(x, name)),
      };
    },
  });

  route({
    method: "GET", url: "/api/patients/:id/recalls", summary: "Controles del paciente (todos los estados)", tags: ["controles"], perm: "agenda.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const p = (await c.query("SELECT 1 FROM patients WHERE id = $1", [params.id])).rowCount;
      if (!p) throw notFound("Paciente");
      const rows = (await c.query(
        `SELECT ${RECALL_COLUMNS} ${RECALL_FROM} WHERE r.patient_id = $1 AND ($2::uuid[] IS NULL OR r.branch_id = ANY($2))
          ORDER BY CASE WHEN r.status IN ('pending','review','scheduled') THEN 0 ELSE 1 END, r.due_date DESC LIMIT 100`,
        [params.id, allowedBranches(auth)])).rows;
      const name = await clinicName(c, auth.clinicId!);
      return rows.map((x) => decorate(x, name));
    },
  });

  route({
    method: "GET", url: "/api/recalls/candidates", summary: "Controles pendientes del paciente que una cita puede cubrir (para elegir al agendar)", tags: ["controles"], perm: "agenda.read",
    query: z.object({ patientId: zId, procedureId: zId.optional(), date: zDate }),
    handler: async ({ c, query }) =>
      (await compatibleRecalls(c, { patientId: query.patientId, procedureId: query.procedureId ?? null, date: query.date })).map((r) => ({
        id: r.id, reason: r.reason, dueDate: r.due_date, status: r.status, statusLabel: RECALL_STATUS_LABELS[r.status],
      })),
  });

  route({
    method: "GET", url: "/api/recalls/suggestion", summary: "Propuesta de \"Próximo control\" para una cita atendida (motivo y meses según la prestación)", tags: ["controles"], perm: "agenda.write",
    query: z.object({ appointmentId: zId }),
    handler: async ({ c, auth, query }) => recallSuggestion(c, auth, query.appointmentId),
  });

  route({
    method: "POST", url: "/api/recalls/skip", summary: "\"Ahora no\": registra que no se programó control al atender la cita", tags: ["controles"], perm: "agenda.write",
    body: z.object({ appointmentId: zId }),
    handler: async ({ c, auth, body }) => {
      const a = (await c.query<{ branch_id: string; patient_id: string }>("SELECT branch_id, patient_id FROM appointments WHERE id = $1", [body.appointmentId])).rows[0];
      if (!a) throw notFound("Cita");
      requireBranch(auth, a.branch_id);
      await audit(c, auth, "recall.skipped", "appointment", body.appointmentId, { patientId: a.patient_id }, a.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/recalls", summary: "Programar un control (desde \"Próximo control\" al atender o a mano desde la ficha)", tags: ["controles"], perm: "agenda.write",
    body: z.object({
      patientId: zId,
      branchId: zId.optional(),
      sourceAppointmentId: zId.optional(),
      procedureId: zId.nullish().transform((v) => v ?? null),
      dentistId: zId.nullish().transform((v) => v ?? null),
      reason: z.string().trim().min(2, "Indica el motivo del control").max(200, "Máximo 200 caracteres"),
      months: z.number().int().min(1, "Mínimo 1 mes").max(60, "Máximo 60 meses").optional(),
      dueDate: zDate.optional(),
      priority: z.enum(["low", "normal", "high"]).default("normal"),
      note: zOptText(500),
    }),
    handler: async ({ c, auth, body }) => {
      const zone = await clinicZone(c, auth.clinicId!);
      const pt = (await c.query<{ archived_at: Date | null }>("SELECT archived_at FROM patients WHERE id = $1", [body.patientId])).rows[0];
      if (!pt) throw notFound("Paciente");
      if (pt.archived_at) throw conflict("El paciente está archivado", "patient_archived");
      let branchId = body.branchId ?? null;
      let base = DateTime.now().setZone(zone).startOf("day");
      let dentistId = body.dentistId;
      if (body.sourceAppointmentId) {
        const a = (await c.query<{ patient_id: string; branch_id: string; status: string; starts_at: Date; dentist_id: string }>(
          "SELECT patient_id, branch_id, status, starts_at, dentist_id FROM appointments WHERE id = $1", [body.sourceAppointmentId])).rows[0];
        if (!a) throw notFound("Cita");
        if (a.patient_id !== body.patientId) throw badRequest("La cita no corresponde a este paciente");
        if (a.status !== "completed") throw conflict("Solo se programa el próximo control de una cita atendida", "invalid_status");
        if ((await c.query("SELECT 1 FROM recalls WHERE source_appointment_id = $1", [body.sourceAppointmentId])).rowCount) {
          throw conflict("Ya se programó un control para esta cita", "recall_exists");
        }
        branchId = a.branch_id;
        base = DateTime.fromJSDate(a.starts_at, { zone }).startOf("day");
        dentistId ??= a.dentist_id;
      }
      if (!branchId) throw badRequest("Indica la sucursal");
      requireBranch(auth, branchId);
      if (!body.dueDate && !body.months) throw badRequest("Indica en cuántos meses o la fecha del control");
      const due = body.dueDate ? DateTime.fromISO(body.dueDate, { zone }) : base.plus({ months: body.months! });
      if (due < base) throw badRequest("La fecha del control no puede ser anterior a hoy");
      if (due > base.plus({ years: 5 })) throw badRequest("La fecha del control no puede superar 5 años");
      const r = await c.query<{ id: string }>(
        `INSERT INTO recalls (clinic_id, patient_id, branch_id, procedure_id, dentist_id, reason, due_date, priority, origin, source_appointment_id, note, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [auth.clinicId, body.patientId, branchId, body.procedureId, dentistId, body.reason, due.toISODate(), body.priority,
          body.sourceAppointmentId ? "completion" : "manual", body.sourceAppointmentId ?? null, body.note, auth.userId],
      );
      const id = r.rows[0]!.id;
      await audit(c, auth, "recall.created", "recall", id, { patientId: body.patientId, dueDate: due.toISODate(), reason: body.reason, sourceAppointmentId: body.sourceAppointmentId ?? null }, branchId);
      return { id, dueDate: due.toISODate() };
    },
  });

  route({
    method: "PATCH", url: "/api/recalls/:id", summary: "Editar un control (motivo, fecha, prioridad, nota) o reactivarlo desde \"revisar\"", tags: ["controles"], perm: "agenda.write", params: zIdParams,
    body: z.object({
      reason: z.string().trim().min(2).max(200).optional(), dueDate: zDate.optional(), priority: z.enum(["low", "normal", "high"]).optional(),
      note: zOptText(500).optional(), reactivate: z.literal(true).optional(),
    }),
    handler: async ({ c, auth, params, body }) => {
      const r = await loadRecall(c, auth, params.id, true);
      if (["done", "dismissed"].includes(r.status)) throw conflict(`El control está "${RECALL_STATUS_LABELS[r.status]}" y ya no se edita`, "invalid_status");
      if (body.reactivate && r.status !== "review") throw conflict("Solo se reactivan controles en \"revisar\"", "invalid_status");
      await c.query(
        `UPDATE recalls SET reason = COALESCE($2, reason), due_date = COALESCE($3::date, due_date), priority = COALESCE($4, priority),
                note = CASE WHEN $5::boolean THEN $6 ELSE note END,
                status = CASE WHEN $7::boolean THEN 'pending' ELSE status END,
                attempts_reset_at = CASE WHEN $7::boolean THEN now() ELSE attempts_reset_at END, updated_at = now()
          WHERE id = $1`,
        [params.id, body.reason ?? null, body.dueDate ?? null, body.priority ?? null, body.note !== undefined, body.note ?? null, !!body.reactivate],
      );
      await audit(c, auth, body.reactivate ? "recall.reactivated" : "recall.updated", "recall", params.id, body, r.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/recalls/:id/dismiss", summary: "Descartar un control con motivo (no se borra)", tags: ["controles"], perm: "agenda.write", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3, "Indica el motivo (mínimo 3 caracteres)").max(300, "Máximo 300 caracteres") }),
    handler: async ({ c, auth, params, body }) => {
      const r = await loadRecall(c, auth, params.id, true);
      if (!["pending", "review"].includes(r.status)) {
        throw conflict(r.status === "scheduled" ? "El control tiene una cita agendada: cancela la cita primero" : `El control ya está "${RECALL_STATUS_LABELS[r.status]}"`, "invalid_status");
      }
      await c.query("UPDATE recalls SET status = 'dismissed', dismiss_reason = $2, dismissed_at = now(), updated_at = now() WHERE id = $1", [params.id, body.reason]);
      await audit(c, auth, "recall.dismissed", "recall", params.id, { reason: body.reason }, r.branch_id);
      return { ok: true };
    },
  });

  // ---------------- Intentos de contacto ----------------
  route({
    method: "GET", url: "/api/recalls/:id/attempts", summary: "Historial de intentos de contacto de un control", tags: ["controles"], perm: "agenda.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      await loadRecall(c, auth, params.id);
      const rows = (await c.query(
        `SELECT t.id, t.channel, t.outcome, t.note, t.created_at AS "createdAt", u.full_name AS "userName"
           FROM recall_attempts t JOIN users u ON u.id = t.user_id WHERE t.recall_id = $1 ORDER BY t.created_at DESC`, [params.id])).rows;
      return rows.map((x) => ({ ...x, channelLabel: CHANNEL_LABELS[x.channel], outcomeLabel: OUTCOME_LABELS[x.outcome] }));
    },
  });

  route({
    method: "POST", url: "/api/recalls/:id/attempts", summary: "Registrar un intento de contacto (3 intentos sin éxito pasan el control a \"revisar\")", tags: ["controles"], perm: "agenda.write", params: zIdParams,
    body: z.object({
      channel: z.enum(["call", "whatsapp", "sms", "in_person"]),
      outcome: z.enum(["no_answer", "voicemail", "scheduled", "declined", "wrong_number", "other"]),
      note: zOptText(500),
    }),
    handler: async ({ c, auth, params, body }) => {
      const r = await loadRecall(c, auth, params.id, true);
      if (!["pending", "review"].includes(r.status)) {
        throw new AppError(409, "invalid_status", `No se registran intentos en un control "${RECALL_STATUS_LABELS[r.status]}"`);
      }
      const ins = await c.query<{ id: string }>(
        "INSERT INTO recall_attempts (clinic_id, recall_id, channel, outcome, note, user_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [auth.clinicId, params.id, body.channel, body.outcome, body.note, auth.userId],
      );
      const failed = (await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM recall_attempts WHERE recall_id = $1 AND outcome = ANY($2) AND created_at > COALESCE($3::timestamptz, '-infinity')`,
        [params.id, FAILED_OUTCOMES, r.attempts_reset_at])).rows[0]!.n;
      let status = r.status;
      if (status === "pending" && failed >= MAX_FAILED_ATTEMPTS) {
        status = "review";
        await c.query("UPDATE recalls SET status = 'review', updated_at = now() WHERE id = $1", [params.id]);
        await audit(c, auth, "recall.review", "recall", params.id, { failedAttempts: failed }, r.branch_id);
      }
      await audit(c, auth, "recall.attempt", "recall", params.id, { attemptId: ins.rows[0]!.id, channel: body.channel, outcome: body.outcome }, r.branch_id);
      return { id: ins.rows[0]!.id, status, statusLabel: RECALL_STATUS_LABELS[status], failedAttempts: failed };
    },
  });
}
