import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../lib/http.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../lib/rbac.js";
import { dayBounds, isoWeekday, slotStarts, subtract, workIntervalsForDay, type Interval } from "../lib/slots.js";
import { afterAppointmentStatusChange, linkRecallOnBooking, recordAppointmentEvent } from "./appointmentEvents.js";
import { appointmentTypeDefaults } from "./appointmentTypes.js";

export async function clinicZone(c: Client, clinicId: string): Promise<string> {
  return (await c.query<{ timezone: string }>("SELECT timezone FROM clinics WHERE id = $1", [clinicId])).rows[0]?.timezone ?? "America/La_Paz";
}

const APPT_COLUMNS = `a.id, a.branch_id AS "branchId", a.chair_id AS "chairId", a.dentist_id AS "dentistId", a.patient_id AS "patientId",
  a.procedure_id AS "procedureId", a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status, a.reason, a.notes, a.source,
  a.cancel_reason AS "cancelReason", a.reschedule_count AS "rescheduleCount", a.confirmed_at AS "confirmedAt", a.arrived_at AS "arrivedAt",
  p.first_name || ' ' || p.last_name AS "patientName", p.phone AS "patientPhone", p.record_number AS "recordNumber",
  u.full_name AS "dentistName", m.color AS "dentistColor", ch.name AS "chairName", pr.name AS "procedureName",
  a.appointment_type_id AS "appointmentTypeId", aty.name AS "typeName", aty.color AS "typeColor", a.series_id AS "seriesId", a.series_index AS "seriesIndex"`;
const APPT_FROM = `FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = a.dentist_id
  JOIN memberships m ON m.clinic_id = a.clinic_id AND m.user_id = a.dentist_id
  LEFT JOIN chairs ch ON ch.id = a.chair_id LEFT JOIN procedures pr ON pr.id = a.procedure_id
  LEFT JOIN appointment_types aty ON aty.id = a.appointment_type_id`;

/** Transiciones de estado permitidas. */
export const TRANSITIONS: Record<string, string[]> = {
  scheduled: ["confirmed", "arrived", "cancelled", "no_show"],
  confirmed: ["arrived", "cancelled", "no_show", "scheduled"],
  arrived: ["in_progress", "completed", "cancelled"],
  in_progress: ["completed"],
  completed: [],
  cancelled: [],
  no_show: [],
};

export const STATUS_LABELS: Record<string, string> = {
  scheduled: "Agendada", confirmed: "Confirmada", arrived: "En sala de espera", in_progress: "En atención",
  completed: "Atendida", cancelled: "Cancelada", no_show: "No asistió",
};

interface Busy { dentistId: string; start: number; end: number }

/** Intervalos de trabajo y ocupación de los profesionales de una sucursal en un día. */
export async function dayAvailability(
  c: Client,
  zone: string,
  date: string,
  branchId: string,
  opts: { dentistId?: string | null; durationMin: number; stepMin?: number; excludeAppointmentId?: string | null },
) {
  const weekday = isoWeekday(date, zone);
  const [dayStart, dayEnd] = dayBounds(date, zone);
  const sch = await c.query<{ dentist_id: string; start: string; end: string; full_name: string }>(
    `SELECT s.dentist_id, to_char(s.start_time,'HH24:MI') AS start, to_char(s.end_time,'HH24:MI') AS "end", u.full_name
       FROM dentist_schedules s JOIN memberships m ON m.clinic_id = s.clinic_id AND m.user_id = s.dentist_id AND m.active AND m.is_professional
       JOIN users u ON u.id = s.dentist_id
      WHERE s.branch_id = $1 AND s.weekday = $2 AND ($3::uuid IS NULL OR s.dentist_id = $3)`,
    [branchId, weekday, opts.dentistId ?? null],
  );
  const dentists = new Map<string, { name: string; ranges: { start: string; end: string }[] }>();
  for (const r of sch.rows) {
    const d = dentists.get(r.dentist_id) ?? { name: r.full_name, ranges: [] };
    d.ranges.push({ start: r.start, end: r.end });
    dentists.set(r.dentist_id, d);
  }
  if (!dentists.size) return [];
  const ids = [...dentists.keys()];
  // Ocupado: citas activas del profesional en CUALQUIER sucursal + bloqueos
  const busyRows = await c.query<{ dentist_id: string | null; s: Date; e: Date }>(
    `SELECT dentist_id, starts_at AS s, ends_at AS e FROM appointments
      WHERE dentist_id = ANY($1) AND status NOT IN ('cancelled','no_show') AND starts_at < $3 AND ends_at > $2 AND ($4::uuid IS NULL OR id <> $4)
     UNION ALL
     SELECT dentist_id, starts_at, ends_at FROM schedule_blocks
      WHERE (dentist_id = ANY($1) OR (dentist_id IS NULL AND branch_id = $5)) AND (branch_id IS NULL OR branch_id = $5)
        AND starts_at < $3 AND ends_at > $2`,
    [ids, dayStart, dayEnd, opts.excludeAppointmentId ?? null, branchId],
  );
  const busy: Busy[] = busyRows.rows.flatMap((r) =>
    r.dentist_id ? [{ dentistId: r.dentist_id, start: +r.s, end: +r.e }] : ids.map((id) => ({ dentistId: id, start: +r.s, end: +r.e })),
  );
  const now = Date.now();
  return ids.map((id) => {
    const d = dentists.get(id)!;
    const work = workIntervalsForDay(date, zone, d.ranges);
    const free = subtract(work, busy.filter((b) => b.dentistId === id).map((b) => [b.start, b.end] as Interval));
    const starts = slotStarts(free, opts.durationMin, opts.stepMin ?? 15, now);
    return { dentistId: id, dentistName: d.name, work, free, slots: starts.map((t) => new Date(t).toISOString()) };
  });
}

export async function assertBookable(
  c: Client,
  auth: AuthCtx,
  zone: string,
  a: { branchId: string; dentistId: string; chairId: string | null; startsAt: Date; endsAt: Date; allowOutsideSchedule: boolean; excludeId?: string },
) {
  requireBranch(auth, a.branchId);
  const br = (await c.query<{ active: boolean }>("SELECT active FROM branches WHERE id = $1", [a.branchId])).rows[0];
  if (!br || !br.active) throw badRequest("La sucursal no existe o está inactiva");
  if (auth.membership!.role === "dentist" && a.dentistId !== auth.userId) throw forbidden("Solo puedes agendar en tu propia agenda");
  const m = (await c.query<{ is_professional: boolean; active: boolean; all_branches: boolean; branch_ids: string[]; role: string }>(
    "SELECT is_professional, active, all_branches, branch_ids, role FROM memberships WHERE clinic_id = $1 AND user_id = $2",
    [auth.clinicId, a.dentistId],
  )).rows[0];
  if (!m || !m.active || !m.is_professional) throw badRequest("El profesional no existe o no atiende pacientes");
  if (!(m.all_branches || m.role === "owner" || m.branch_ids.includes(a.branchId))) throw badRequest("El profesional no atiende en esa sucursal");
  if (a.chairId) {
    const ch = (await c.query<{ branch_id: string; active: boolean }>("SELECT branch_id, active FROM chairs WHERE id = $1", [a.chairId])).rows[0];
    if (!ch || !ch.active || ch.branch_id !== a.branchId) throw badRequest("El consultorio no pertenece a la sucursal");
  }
  const blocks = await c.query(
    `SELECT reason FROM schedule_blocks WHERE starts_at < $2 AND ends_at > $1
       AND (dentist_id = $3 OR (dentist_id IS NULL AND branch_id = $4)) AND (branch_id IS NULL OR branch_id = $4) LIMIT 1`,
    [a.startsAt, a.endsAt, a.dentistId, a.branchId],
  );
  if (blocks.rowCount) throw conflict(`Horario bloqueado: ${blocks.rows[0].reason}`, "blocked");
  if (!a.allowOutsideSchedule) {
    const start = DateTime.fromJSDate(a.startsAt, { zone });
    const end = DateTime.fromJSDate(a.endsAt, { zone });
    if (start.toISODate() !== end.minus({ milliseconds: 1 }).toISODate()) throw conflict("La cita debe empezar y terminar el mismo día", "outside_schedule");
    const ok = await c.query(
      `SELECT 1 FROM dentist_schedules WHERE dentist_id = $1 AND branch_id = $2 AND weekday = $3 AND start_time <= $4::time AND end_time >= $5::time`,
      [a.dentistId, a.branchId, start.weekday, start.toFormat("HH:mm:ss"), end.toFormat("HH:mm:ss") === "00:00:00" ? "24:00:00" : end.toFormat("HH:mm:ss")],
    );
    if (!ok.rowCount) throw conflict("Fuera del horario de atención del profesional en esa sucursal", "outside_schedule");
  }
}

const zDateTime = z.iso.datetime({ offset: true, message: "Fecha y hora inválidas (ISO 8601)" });

export function agendaRoutes(route: Route) {
  route({
    method: "GET", url: "/api/appointments", summary: "Citas en un rango (filtradas por sucursales permitidas)", tags: ["agenda"], perm: "agenda.read",
    query: z.object({ from: zDateTime, to: zDateTime, branchId: zId.optional(), dentistId: zId.optional(), patientId: zId.optional(), includeCancelled: z.enum(["1", "0"]).optional() }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const days = (Date.parse(query.to) - Date.parse(query.from)) / 86_400_000;
      if (days < 0 || days > 62) throw badRequest("El rango debe ser de hasta 62 días");
      const r = await c.query(
        `SELECT ${APPT_COLUMNS} ${APPT_FROM}
          WHERE a.starts_at < $2 AND a.ends_at > $1 AND ($3::uuid IS NULL OR a.branch_id = $3) AND ($4::uuid IS NULL OR a.dentist_id = $4)
            AND ($5::uuid IS NULL OR a.patient_id = $5) AND ($6::uuid[] IS NULL OR a.branch_id = ANY($6))
            AND ($7::boolean OR a.status <> 'cancelled')
          ORDER BY a.starts_at`,
        [query.from, query.to, query.branchId ?? null, query.dentistId ?? null, query.patientId ?? null, allowedBranches(auth), query.includeCancelled === "1"],
      );
      return r.rows.map((x) => ({ ...x, statusLabel: STATUS_LABELS[x.status] }));
    },
  });

  route({
    method: "GET", url: "/api/availability", summary: "Horarios libres de una sucursal en un día", tags: ["agenda"], perm: "agenda.read",
    query: z.object({ date: zDate, branchId: zId, dentistId: zId.optional(), durationMin: z.coerce.number().int().min(5).max(480).default(30) }),
    handler: async ({ c, auth, query }) => {
      requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const res = await dayAvailability(c, zone, query.date, query.branchId, { dentistId: query.dentistId, durationMin: query.durationMin });
      return res.map(({ work, free, ...x }) => ({
        ...x,
        work: work.map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() })),
      }));
    },
  });

  route({
    method: "GET", url: "/api/availability/search", summary: "Próximos horarios libres (varios días) para una duración o prestación", tags: ["agenda"], perm: "agenda.read",
    query: z.object({
      branchId: zId.optional(), dentistId: zId.optional(), procedureId: zId.optional(),
      durationMin: z.coerce.number().int().min(5).max(480).optional(), from: zDate.optional(),
      days: z.coerce.number().int().min(1).max(31).default(7), period: z.enum(["any", "morning", "afternoon"]).default("any"),
      limit: z.coerce.number().int().min(1).max(50).default(10),
    }),
    handler: async ({ c, auth, query }) => {
      const zone = await clinicZone(c, auth.clinicId!);
      let duration = query.durationMin ?? 30;
      if (query.procedureId) {
        const p = (await c.query<{ duration_min: number }>("SELECT duration_min FROM procedures WHERE id = $1", [query.procedureId])).rows[0];
        if (!p) throw notFound("Prestación");
        duration = query.durationMin ?? p.duration_min;
      }
      const allowed = allowedBranches(auth);
      const branches = (await c.query<{ id: string; name: string }>(
        "SELECT id, name FROM branches WHERE active AND ($1::uuid IS NULL OR id = $1) AND ($2::uuid[] IS NULL OR id = ANY($2)) ORDER BY code",
        [query.branchId ?? null, allowed],
      )).rows;
      if (query.branchId && !branches.length) throw forbidden("No tienes acceso a esa sucursal");
      const start = query.from ? DateTime.fromISO(query.from, { zone }) : DateTime.now().setZone(zone).startOf("day");
      const found: { startsAt: string; endsAt: string; dentistId: string; dentistName: string; branchId: string; branchName: string }[] = [];
      for (let d = 0; d < query.days && found.length < query.limit; d++) {
        const date = start.plus({ days: d }).toISODate()!;
        for (const b of branches) {
          const av = await dayAvailability(c, zone, date, b.id, { dentistId: query.dentistId, durationMin: duration, stepMin: 30 });
          for (const dent of av) {
            for (const s of dent.slots) {
              const hour = DateTime.fromISO(s, { zone }).hour;
              if (query.period === "morning" && hour >= 13) continue;
              if (query.period === "afternoon" && hour < 13) continue;
              found.push({ startsAt: s, endsAt: new Date(Date.parse(s) + duration * 60_000).toISOString(), dentistId: dent.dentistId, dentistName: dent.dentistName, branchId: b.id, branchName: b.name });
            }
          }
        }
      }
      found.sort((a, b) => a.startsAt.localeCompare(b.startsAt));
      return { durationMin: duration, slots: found.slice(0, query.limit) };
    },
  });

  const apptBody = z.object({
    branchId: zId,
    chairId: zId.nullish().transform((v) => v ?? null),
    dentistId: zId,
    patientId: zId,
    procedureId: zId.nullish().transform((v) => v ?? null),
    appointmentTypeId: zId.nullish(),
    startsAt: zDateTime,
    durationMin: z.number().int().min(5).max(480).optional(),
    endsAt: zDateTime.optional(),
    reason: zOptText(200),
    notes: zOptText(1000),
    source: z.enum(["reception", "phone", "whatsapp", "portal", "walk_in", "assistant"]).default("reception"),
    allowOutsideSchedule: z.boolean().default(false),
    idempotencyKey: z.string().min(8).max(80).optional(),
  });

  async function resolveTimes(c: Client, b: { startsAt: string; endsAt?: string; durationMin?: number; procedureId: string | null }) {
    const startsAt = new Date(b.startsAt);
    let endsAt: Date;
    if (b.endsAt) endsAt = new Date(b.endsAt);
    else {
      let dur = b.durationMin;
      if (!dur && b.procedureId) dur = (await c.query<{ duration_min: number }>("SELECT duration_min FROM procedures WHERE id = $1", [b.procedureId])).rows[0]?.duration_min;
      endsAt = new Date(startsAt.getTime() + (dur ?? 30) * 60_000);
    }
    if (endsAt <= startsAt) throw badRequest("La hora de fin debe ser posterior al inicio");
    return { startsAt, endsAt };
  }

  route({
    method: "POST", url: "/api/appointments", summary: "Agendar cita (sin solapamientos, idempotente con idempotencyKey)", tags: ["agenda"], perm: "agenda.write",
    body: apptBody.extend({ recallId: zId.nullish() }),
    handler: async ({ c, auth, body }) => {
      if (body.idempotencyKey) {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':appt:' || $2, 0))", [auth.clinicId, body.idempotencyKey]);
        const ex = (await c.query<{ id: string }>("SELECT id FROM appointments WHERE idempotency_key = $1", [body.idempotencyKey])).rows[0];
        if (ex) return { id: ex.id, duplicate: true };
      }
      const zone = await clinicZone(c, auth.clinicId!);
      Object.assign(body, await appointmentTypeDefaults(c, body));
      const { startsAt, endsAt } = await resolveTimes(c, body);
      if (body.allowOutsideSchedule && !auth.permissions.has("clinic.manage") && auth.membership!.role !== "dentist") {
        throw forbidden("Solo administración o el propio profesional pueden agendar fuera de horario");
      }
      if (startsAt.getTime() < Date.now() - 15 * 60_000 && body.source !== "walk_in") throw badRequest("No se puede agendar en el pasado");
      await assertBookable(c, auth, zone, { ...body, startsAt, endsAt });
      const r = await c.query<{ id: string }>(
        `INSERT INTO appointments (clinic_id, branch_id, chair_id, dentist_id, patient_id, procedure_id, starts_at, ends_at, reason, notes, source, idempotency_key, created_by, appointment_type_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [auth.clinicId, body.branchId, body.chairId, body.dentistId, body.patientId, body.procedureId, startsAt, endsAt, body.reason, body.notes, body.source, body.idempotencyKey ?? null, auth.userId, body.appointmentTypeId ?? null],
      );
      const id = r.rows[0]!.id;
      await audit(c, auth, "appointment.created", "appointment", id, { startsAt, endsAt, dentistId: body.dentistId, patientId: body.patientId }, body.branchId);
      await recordAppointmentEvent(c, auth, { appointmentId: id, branchId: body.branchId, from: null, to: "scheduled" });
      const recall = await linkRecallOnBooking(c, auth, { appointmentId: id, patientId: body.patientId, procedureId: body.procedureId, startsAt, zone, recallId: body.recallId });
      return { id, recall };
    },
  });

  route({
    method: "GET", url: "/api/appointments/:id", summary: "Detalle de cita", tags: ["agenda"], perm: "agenda.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const a = (await c.query(`SELECT ${APPT_COLUMNS} ${APPT_FROM} WHERE a.id = $1`, [params.id])).rows[0];
      if (!a) throw notFound("Cita");
      requireBranch(auth, a.branchId);
      return { ...a, statusLabel: STATUS_LABELS[a.status], allowedTransitions: TRANSITIONS[a.status] };
    },
  });

  route({
    method: "PATCH", url: "/api/appointments/:id", summary: "Reprogramar o editar cita", tags: ["agenda"], perm: "agenda.write", params: zIdParams,
    body: apptBody.omit({ patientId: true, idempotencyKey: true, source: true }).partial().extend({ allowOutsideSchedule: z.boolean().default(false) }),
    handler: async ({ c, auth, params, body }) => {
      const cur = (await c.query<{ branch_id: string; chair_id: string | null; dentist_id: string; starts_at: Date; ends_at: Date; status: string; procedure_id: string | null }>(
        "SELECT branch_id, chair_id, dentist_id, starts_at, ends_at, status, procedure_id FROM appointments WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!cur) throw notFound("Cita");
      requireBranch(auth, cur.branch_id);
      if (!["scheduled", "confirmed"].includes(cur.status)) throw conflict("Solo se pueden reprogramar citas agendadas o confirmadas", "invalid_status");
      if (auth.membership!.role === "dentist" && cur.dentist_id !== auth.userId) throw forbidden("Solo puedes modificar tu propia agenda");
      const next = {
        branchId: body.branchId ?? cur.branch_id,
        chairId: body.chairId !== undefined ? body.chairId : cur.chair_id,
        dentistId: body.dentistId ?? cur.dentist_id,
        procedureId: body.procedureId !== undefined ? body.procedureId : cur.procedure_id,
      };
      let startsAt = cur.starts_at, endsAt = cur.ends_at;
      if (body.startsAt) {
        const durMin = body.durationMin ?? (cur.ends_at.getTime() - cur.starts_at.getTime()) / 60_000;
        ({ startsAt, endsAt } = await resolveTimes(c, { startsAt: body.startsAt, endsAt: body.endsAt, durationMin: durMin, procedureId: null }));
        if (startsAt.getTime() < Date.now() - 15 * 60_000) throw badRequest("No se puede reprogramar al pasado");
      } else if (body.durationMin || body.endsAt) {
        ({ startsAt, endsAt } = await resolveTimes(c, { startsAt: cur.starts_at.toISOString(), endsAt: body.endsAt, durationMin: body.durationMin, procedureId: null }));
      }
      const timeChanged = startsAt.getTime() !== cur.starts_at.getTime() || endsAt.getTime() !== cur.ends_at.getTime() || next.dentistId !== cur.dentist_id || next.branchId !== cur.branch_id;
      if (timeChanged || next.chairId !== cur.chair_id) {
        const zone = await clinicZone(c, auth.clinicId!);
        await assertBookable(c, auth, zone, { ...next, startsAt, endsAt, allowOutsideSchedule: body.allowOutsideSchedule && (auth.permissions.has("clinic.manage") || auth.membership!.role === "dentist"), excludeId: params.id });
      }
      await c.query(
        `UPDATE appointments SET branch_id=$2, chair_id=$3, dentist_id=$4, procedure_id=$5, starts_at=$6, ends_at=$7,
            reason = CASE WHEN $8::boolean THEN $9 ELSE reason END, notes = CASE WHEN $10::boolean THEN $11 ELSE notes END,
            appointment_type_id = CASE WHEN $13::boolean THEN $14::uuid ELSE appointment_type_id END,
            reschedule_count = reschedule_count + CASE WHEN $12 THEN 1 ELSE 0 END,
            status = CASE WHEN $12 THEN 'scheduled' ELSE status END, confirmed_at = CASE WHEN $12 THEN NULL ELSE confirmed_at END,
            updated_at = now()
          WHERE id = $1`,
        [params.id, next.branchId, next.chairId, next.dentistId, next.procedureId, startsAt, endsAt, body.reason !== undefined, body.reason ?? null, body.notes !== undefined, body.notes ?? null, timeChanged, body.appointmentTypeId !== undefined, body.appointmentTypeId ?? null],
      );
      if (timeChanged && cur.status !== "scheduled") await recordAppointmentEvent(c, auth, { appointmentId: params.id, branchId: next.branchId, from: cur.status, to: "scheduled", reason: "Reprogramada" });
      await audit(c, auth, timeChanged ? "appointment.rescheduled" : "appointment.updated", "appointment", params.id,
        { from: { startsAt: cur.starts_at, dentistId: cur.dentist_id, branchId: cur.branch_id }, to: { startsAt, dentistId: next.dentistId, branchId: next.branchId } }, next.branchId);
      return { ok: true, rescheduled: timeChanged };
    },
  });

  route({
    method: "POST", url: "/api/appointments/:id/status", summary: "Cambiar estado (confirmar, llegó, atendido, cancelar, no asistió)", tags: ["agenda"], perm: "agenda.write", params: zIdParams,
    body: z.object({ status: z.enum(["scheduled", "confirmed", "arrived", "in_progress", "completed", "cancelled", "no_show"]), reason: zOptText(300) }),
    handler: async ({ c, auth, params, body }) => {
      const cur = (await c.query<{ status: string; branch_id: string; dentist_id: string }>("SELECT status, branch_id, dentist_id FROM appointments WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!cur) throw notFound("Cita");
      requireBranch(auth, cur.branch_id);
      if (!TRANSITIONS[cur.status]!.includes(body.status)) {
        throw new AppError(409, "invalid_transition", `No se puede pasar de "${STATUS_LABELS[cur.status]}" a "${STATUS_LABELS[body.status]}"`);
      }
      if (body.status === "cancelled" && !body.reason) throw badRequest("Indica el motivo de la cancelación");
      const stamp: Record<string, string> = { confirmed: "confirmed_at", arrived: "arrived_at", completed: "completed_at", cancelled: "cancelled_at" };
      const col = stamp[body.status];
      await c.query(
        `UPDATE appointments SET status = $2, updated_at = now(), cancel_reason = CASE WHEN $2 = 'cancelled' THEN $3 ELSE cancel_reason END
           ${col ? `, ${col} = now()` : ""} WHERE id = $1`,
        [params.id, body.status, body.reason],
      );
      await audit(c, auth, "appointment.status", "appointment", params.id, { from: cur.status, to: body.status, reason: body.reason }, cur.branch_id);
      await afterAppointmentStatusChange(c, auth, { appointmentId: params.id, branchId: cur.branch_id, from: cur.status, to: body.status, reason: body.reason });
      return { ok: true };
    },
  });

  // ---------------- Lista de espera ----------------
  route({
    method: "GET", url: "/api/waitlist", summary: "Lista de espera", tags: ["agenda"], perm: "agenda.read",
    query: z.object({ branchId: zId.optional(), status: z.enum(["waiting", "booked", "cancelled"]).default("waiting") }),
    handler: async ({ c, auth, query }) =>
      (
        await c.query(
          `SELECT w.id, w.branch_id AS "branchId", w.patient_id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName", p.phone,
                  w.dentist_id AS "dentistId", u.full_name AS "dentistName", w.procedure_id AS "procedureId", pr.name AS "procedureName",
                  w.duration_min AS "durationMin", w.earliest_date AS "earliestDate", w.latest_date AS "latestDate",
                  w.preferred_period AS "preferredPeriod", w.priority, w.notes, w.status, w.created_at AS "createdAt"
             FROM waitlist_entries w JOIN patients p ON p.id = w.patient_id LEFT JOIN users u ON u.id = w.dentist_id
             LEFT JOIN procedures pr ON pr.id = w.procedure_id
            WHERE w.status = $1 AND ($2::uuid IS NULL OR w.branch_id = $2) AND ($3::uuid[] IS NULL OR w.branch_id = ANY($3))
            ORDER BY w.priority DESC, w.created_at`,
          [query.status, query.branchId ?? null, allowedBranches(auth)],
        )
      ).rows,
  });

  route({
    method: "POST", url: "/api/waitlist", summary: "Agregar a lista de espera", tags: ["agenda"], perm: "agenda.write",
    body: z.object({
      branchId: zId, patientId: zId, dentistId: zId.nullish(), procedureId: zId.nullish(), durationMin: z.number().int().min(5).max(480).default(30),
      earliestDate: zDate.nullish(), latestDate: zDate.nullish(), preferredPeriod: z.enum(["any", "morning", "afternoon"]).default("any"),
      priority: z.number().int().min(0).max(5).default(0), notes: zOptText(500),
    }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      const r = await c.query<{ id: string }>(
        `INSERT INTO waitlist_entries (clinic_id, branch_id, patient_id, dentist_id, procedure_id, duration_min, earliest_date, latest_date, preferred_period, priority, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
        [auth.clinicId, body.branchId, body.patientId, body.dentistId ?? null, body.procedureId ?? null, body.durationMin, body.earliestDate ?? null, body.latestDate ?? null, body.preferredPeriod, body.priority, body.notes, auth.userId],
      );
      await audit(c, auth, "waitlist.added", "waitlist", r.rows[0]!.id, { patientId: body.patientId }, body.branchId);
      return { id: r.rows[0]!.id };
    },
  });

  route({
    method: "POST", url: "/api/waitlist/:id/status", summary: "Marcar entrada de lista de espera como agendada o cancelada", tags: ["agenda"], perm: "agenda.write", params: zIdParams,
    body: z.object({ status: z.enum(["booked", "cancelled"]), appointmentId: zId.optional() }),
    handler: async ({ c, auth, params, body }) => {
      // Alcance por sucursal ANTES de modificar (una entrada de otra sucursal no se toca).
      const cur = (await c.query<{ branch_id: string }>("SELECT branch_id FROM waitlist_entries WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!cur) throw notFound("Entrada de lista de espera");
      requireBranch(auth, cur.branch_id);
      const r = await c.query("UPDATE waitlist_entries SET status = $2, appointment_id = $3 WHERE id = $1 AND status = 'waiting' RETURNING branch_id", [params.id, body.status, body.appointmentId ?? null]);
      if (!r.rowCount) throw notFound("Entrada de lista de espera");
      await audit(c, auth, `waitlist.${body.status}`, "waitlist", params.id, {}, r.rows[0].branch_id);
      return { ok: true };
    },
  });

  route({
    method: "GET", url: "/api/waitlist/matches", summary: "Recuperar horarios libres: pacientes en espera que encajan en los huecos de un día", tags: ["agenda"], perm: "agenda.read",
    query: z.object({ date: zDate, branchId: zId }),
    handler: async ({ c, auth, query }) => {
      requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const entries = (await c.query<{ id: string; patient_id: string; name: string; dentist_id: string | null; duration_min: number; preferred_period: string; earliest_date: string | null; latest_date: string | null; priority: number }>(
        `SELECT w.id, w.patient_id, p.first_name || ' ' || p.last_name AS name, w.dentist_id, w.duration_min, w.preferred_period, w.earliest_date, w.latest_date, w.priority
           FROM waitlist_entries w JOIN patients p ON p.id = w.patient_id
          WHERE w.status = 'waiting' AND w.branch_id = $1 AND (w.earliest_date IS NULL OR w.earliest_date <= $2) AND (w.latest_date IS NULL OR w.latest_date >= $2)
          ORDER BY w.priority DESC, w.created_at`,
        [query.branchId, query.date],
      )).rows;
      const out = [];
      for (const e of entries) {
        const av = await dayAvailability(c, zone, query.date, query.branchId, { dentistId: e.dentist_id, durationMin: e.duration_min, stepMin: 15 });
        const slots = av.flatMap((d) => d.slots.map((s) => ({ startsAt: s, dentistId: d.dentistId, dentistName: d.dentistName })))
          .filter((s) => {
            const h = DateTime.fromISO(s.startsAt, { zone }).hour;
            return e.preferred_period === "any" || (e.preferred_period === "morning" ? h < 13 : h >= 13);
          })
          .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
          .slice(0, 3);
        if (slots.length) out.push({ waitlistId: e.id, patientId: e.patient_id, patientName: e.name, durationMin: e.duration_min, slots });
      }
      return out;
    },
  });

  // ---------------- Recordatorios ----------------
  route({
    method: "GET", url: "/api/reminders", summary: "Preparar recordatorios de un día (solo pacientes con consentimiento; envío manual por enlace wa.me)", tags: ["agenda"], perm: "agenda.read",
    query: z.object({ date: zDate, branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      const zone = await clinicZone(c, auth.clinicId!);
      const [s, e] = dayBounds(query.date, zone);
      const clinicName = (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!.name;
      const r = await c.query(
        `SELECT a.id, a.starts_at AS "startsAt", a.status, p.first_name AS "firstName", p.phone, p.consent_reminders AS consent,
                b.name AS "branchName", b.address, u.full_name AS "dentistName"
           FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN branches b ON b.id = a.branch_id JOIN users u ON u.id = a.dentist_id
          WHERE a.starts_at >= $1 AND a.starts_at < $2 AND a.status IN ('scheduled','confirmed')
            AND ($3::uuid IS NULL OR a.branch_id = $3) AND ($4::uuid[] IS NULL OR a.branch_id = ANY($4))
          ORDER BY a.starts_at`,
        [s, e, query.branchId ?? null, allowedBranches(auth)],
      );
      return r.rows.map((x) => {
        const when = DateTime.fromJSDate(x.startsAt, { zone }).setLocale("es");
        // Mensaje sin datos clínicos (solo fecha, hora y lugar).
        const text = `Hola ${x.firstName}, te recordamos tu cita en ${clinicName} (${x.branchName}${x.address ? `, ${x.address}` : ""}) el ${when.toFormat("cccc d 'de' LLLL")} a las ${when.toFormat("HH:mm")}. Responde SÍ para confirmar o escríbenos para reprogramar.`;
        const canSend = !!x.consent && !!x.phone;
        return {
          appointmentId: x.id, startsAt: x.startsAt, status: x.status, patientFirstName: x.firstName, branchName: x.branchName, dentistName: x.dentistName,
          consent: !!x.consent, hasPhone: !!x.phone,
          blockedReason: !x.consent ? "Sin consentimiento para recordatorios" : !x.phone ? "Sin teléfono" : null,
          message: text,
          whatsappUrl: canSend ? `https://wa.me/${String(x.phone).replace(/\D/g, "")}?text=${encodeURIComponent(text)}` : null,
        };
      });
    },
  });
}
