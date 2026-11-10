// Citas recurrentes (R2-30): vista previa con disponibilidad de cada ocurrencia, conflictos con
// el hueco libre más cercano, guardado de las libres en una sola transacción con un id de serie,
// y operaciones "solo esta" / "esta y las siguientes" (cancelar y reprogramar).
//
// La detección de conflictos reutiliza assertBookable (sucursal, profesional, consultorio, bloqueos
// y horario) y consulta los solapes de profesional, consultorio y paciente igual que las
// restricciones EXCLUDE de la base. La base sigue siendo la garantía final: cada inserción va en un
// SAVEPOINT y un solape detectado recién por la base (carrera con otra recepción) se informa como
// conflicto sin abortar las demás.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../lib/http.js";
import { AppError, badRequest, conflict, forbidden, fromPgError, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";
import { requireBranch, type AuthCtx } from "../lib/rbac.js";
import { dayBounds, type Interval } from "../lib/slots.js";
import { generateOccurrences, RecurrenceError, shiftLike, MAX_OCCURRENCES } from "../lib/recurrence.js";
import { assertBookable, clinicZone, dayAvailability } from "./agenda.js";
import { afterAppointmentStatusChange, linkRecallOnBooking, recordAppointmentEvent } from "./appointmentEvents.js";
import { appointmentTypeDefaults } from "./appointmentTypes.js";

const zDateTime = z.iso.datetime({ offset: true, message: "Fecha y hora inválidas (ISO 8601)" });

export interface SlotRequest {
  branchId: string;
  dentistId: string;
  chairId: string | null;
  patientId: string;
  startsAt: Date;
  endsAt: Date;
  allowOutsideSchedule: boolean;
}
export interface SlotConflict { code: string; message: string }

const OVERLAP_MESSAGES = {
  dentist: { code: "appointment_overlap_dentist", message: "El profesional ya tiene una cita en ese horario" },
  chair: { code: "appointment_overlap_chair", message: "El consultorio ya está ocupado en ese horario" },
  patient: { code: "appointment_overlap_patient", message: "El paciente ya tiene otra cita en ese horario" },
} as const;

/**
 * ¿Se puede agendar este horario? null = libre; si no, el motivo en español.
 * Los errores que valen para toda la serie (permisos, profesional de otra sucursal) se lanzan.
 */
export async function slotConflict(c: Client, auth: AuthCtx, zone: string, s: SlotRequest, excludeIds: string[] = []): Promise<SlotConflict | null> {
  if (s.startsAt.getTime() < Date.now()) return { code: "past", message: "Esa fecha y hora ya pasaron" };
  try {
    await assertBookable(c, auth, zone, s);
  } catch (e) {
    if (e instanceof AppError && e.status === 409) return { code: e.code, message: e.message };
    throw e;
  }
  const r = await c.query<{ d: boolean; ch: boolean; p: boolean }>(
    `SELECT dentist_id = $3 AS d, ($4::uuid IS NOT NULL AND chair_id = $4) AS ch, patient_id = $5 AS p
       FROM appointments
      WHERE status NOT IN ('cancelled','no_show') AND starts_at < $2 AND ends_at > $1
        AND (dentist_id = $3 OR ($4::uuid IS NOT NULL AND chair_id = $4) OR patient_id = $5)
        AND NOT (id = ANY($6::uuid[]))`,
    [s.startsAt, s.endsAt, s.dentistId, s.chairId, s.patientId, excludeIds],
  );
  if (r.rows.some((x) => x.d)) return { ...OVERLAP_MESSAGES.dentist };
  if (r.rows.some((x) => x.ch)) return { ...OVERLAP_MESSAGES.chair };
  if (r.rows.some((x) => x.p)) return { ...OVERLAP_MESSAGES.patient };
  return null;
}

const SUGGEST_OFFSETS = [0, 1, -1, 2, -2, 3, -3, 4, -4, 5, -5, 6, -6, 7, -7];

/**
 * Hueco libre más cercano para el mismo profesional, consultorio y paciente: primero el mismo día
 * (la hora más cercana), luego ±1…7 días. Usa dayAvailability (horario, bloqueos y citas del
 * profesional en cualquier sucursal) y descarta los que chocan con el consultorio, el paciente o
 * con otras ocurrencias ya elegidas de la misma serie (`taken`).
 */
export async function suggestSlot(c: Client, zone: string, s: SlotRequest, excludeIds: string[], taken: Interval[]): Promise<{ startsAt: string; endsAt: string } | null> {
  const durMs = s.endsAt.getTime() - s.startsAt.getTime();
  const base = DateTime.fromJSDate(s.startsAt, { zone });
  const today = DateTime.now().setZone(zone).startOf("day");
  for (const off of SUGGEST_OFFSETS) {
    const day = base.plus({ days: off });
    if (day.startOf("day") < today) continue;
    const date = day.toISODate()!;
    const av = await dayAvailability(c, zone, date, s.branchId, { dentistId: s.dentistId, durationMin: durMs / 60_000, stepMin: 15 });
    const mine = av.find((a) => a.dentistId === s.dentistId);
    if (!mine?.slots.length) continue;
    const [ds, de] = dayBounds(date, zone);
    const busy: Interval[] = (await c.query<{ s: Date; e: Date }>(
      `SELECT starts_at AS s, ends_at AS e FROM appointments
        WHERE status NOT IN ('cancelled','no_show') AND starts_at < $2 AND ends_at > $1
          AND (patient_id = $3 OR ($4::uuid IS NOT NULL AND chair_id = $4)) AND NOT (id = ANY($5::uuid[]))`,
      [ds, de, s.patientId, s.chairId, excludeIds],
    )).rows.map((x) => [+x.s, +x.e] as Interval);
    const all = busy.concat(taken);
    const target = day.toMillis();
    let best: number | null = null;
    for (const iso of mine.slots) {
      const t = Date.parse(iso);
      if (all.some(([bs, be]) => t < be && t + durMs > bs)) continue;
      if (best === null || Math.abs(t - target) < Math.abs(best - target)) best = t;
    }
    if (best !== null) return { startsAt: new Date(best).toISOString(), endsAt: new Date(best + durMs).toISOString() };
  }
  return null;
}

const seriesBody = z.object({
  branchId: zId,
  dentistId: zId,
  chairId: zId.nullish().transform((v) => v ?? null),
  patientId: zId,
  appointmentTypeId: zId.nullish().transform((v) => v ?? null),
  procedureId: zId.nullish().transform((v) => v ?? null),
  startsAt: zDateTime,
  durationMin: z.number().int().min(5).max(480).optional(),
  reason: zOptText(200),
  notes: zOptText(1000),
  source: z.enum(["reception", "phone", "whatsapp"]).default("reception"),
  frequency: z.enum(["weekly", "monthly"], { message: "Frecuencia inválida (semanal o mensual)" }),
  interval: z.number().int().min(1, "El intervalo mínimo es 1").max(26, "El intervalo máximo es 26"),
  count: z.number().int().min(1, "La serie debe tener al menos 1 cita").max(MAX_OCCURRENCES, `La serie puede tener hasta ${MAX_OCCURRENCES} citas`).nullish(),
  until: zDate.nullish(),
  allowOutsideSchedule: z.boolean().default(false),
});
type SeriesBody = z.infer<typeof seriesBody>;

interface Plan {
  zone: string;
  durationMin: number;
  procedureId: string | null;
  starts: string[];
}

async function planSeries(c: Client, auth: AuthCtx, body: SeriesBody, explicit?: string[]): Promise<Plan> {
  requireBranch(auth, body.branchId);
  if (body.allowOutsideSchedule && !auth.permissions.has("clinic.manage") && auth.membership!.role !== "dentist") {
    throw forbidden("Solo administración o el propio profesional pueden agendar fuera de horario");
  }
  const zone = await clinicZone(c, auth.clinicId!);
  const pt = (await c.query<{ archived_at: Date | null }>("SELECT archived_at FROM patients WHERE id = $1", [body.patientId])).rows[0];
  if (!pt) throw badRequest("El paciente no existe");
  if (pt.archived_at) throw badRequest("El paciente está archivado");
  const td = await appointmentTypeDefaults(c, body);
  let durationMin = td.durationMin;
  if (!durationMin && td.procedureId) {
    durationMin = (await c.query<{ duration_min: number }>("SELECT duration_min FROM procedures WHERE id = $1", [td.procedureId])).rows[0]?.duration_min;
    if (durationMin === undefined) throw badRequest("La prestación no existe");
  }
  let starts: string[];
  if (body.frequency === "monthly" && body.interval > 12) throw badRequest("El intervalo debe ser de 1 a 12 meses");
  try {
    starts = generateOccurrences(body.startsAt, zone, { frequency: body.frequency, interval: body.interval, count: body.count ?? null, until: body.until ?? null });
  } catch (e) {
    if (e instanceof RecurrenceError) throw badRequest(e.message);
    throw e;
  }
  if (explicit) {
    // Las fechas elegidas por la persona (originales o el hueco sugerido) reemplazan a las generadas.
    const uniq = [...new Set(explicit.map((s) => new Date(s).toISOString()))].sort();
    if (uniq.length !== explicit.length) throw badRequest("Hay ocurrencias repetidas en la serie");
    starts = uniq;
  }
  return { zone, durationMin: durationMin ?? 30, procedureId: td.procedureId, starts };
}

function slotOf(body: SeriesBody, startISO: string, durationMin: number): SlotRequest {
  const startsAt = new Date(startISO);
  return {
    branchId: body.branchId, dentistId: body.dentistId, chairId: body.chairId, patientId: body.patientId,
    startsAt, endsAt: new Date(startsAt.getTime() + durationMin * 60_000), allowOutsideSchedule: body.allowOutsideSchedule,
  };
}

/** Revisa cada ocurrencia y propone el hueco libre más cercano para las que chocan. */
async function reviewOccurrences(c: Client, auth: AuthCtx, zone: string, slots: SlotRequest[], excludeIds: string[] = []) {
  const checks: { slot: SlotRequest; conflict: SlotConflict | null }[] = [];
  for (const slot of slots) checks.push({ slot, conflict: await slotConflict(c, auth, zone, slot, excludeIds) });
  // Las ocurrencias libres y las sugerencias ya elegidas no deben chocar con una nueva sugerencia.
  const taken: Interval[] = checks.filter((x) => !x.conflict).map((x) => [x.slot.startsAt.getTime(), x.slot.endsAt.getTime()]);
  const out = [];
  for (const [i, x] of checks.entries()) {
    let suggestion: { startsAt: string; endsAt: string } | null = null;
    if (x.conflict && x.conflict.code !== "past") {
      suggestion = await suggestSlot(c, zone, x.slot, excludeIds, taken);
      if (suggestion) taken.push([Date.parse(suggestion.startsAt), Date.parse(suggestion.endsAt)]);
    }
    out.push({
      index: i + 1, startsAt: x.slot.startsAt.toISOString(), endsAt: x.slot.endsAt.toISOString(),
      ok: !x.conflict, conflict: x.conflict, suggestion,
    });
  }
  return out;
}

async function loadSeries(c: Client, auth: AuthCtx, id: string) {
  const s = (await c.query<{ id: string; branch_id: string; patient_id: string; dentist_id: string }>(
    "SELECT id, branch_id, patient_id, dentist_id FROM appointment_series WHERE id = $1", [id])).rows[0];
  if (!s) throw notFound("Serie de citas");
  requireBranch(auth, s.branch_id);
  return s;
}

/** Citas de la serie afectadas por "solo esta" o "esta y las siguientes" (solo agendadas o confirmadas). */
async function seriesTargets(c: Client, auth: AuthCtx, seriesId: string, fromId: string, scope: "this" | "following") {
  const from = (await c.query<{ id: string; series_id: string | null; starts_at: Date; status: string }>(
    "SELECT id, series_id, starts_at, status FROM appointments WHERE id = $1", [fromId])).rows[0];
  if (!from || from.series_id !== seriesId) throw notFound("Cita de la serie");
  if (!["scheduled", "confirmed"].includes(from.status)) throw conflict("Esa cita ya no está agendada; elige otra de la serie", "invalid_status");
  const rows = (await c.query<{ id: string; branch_id: string; chair_id: string | null; dentist_id: string; patient_id: string; starts_at: Date; ends_at: Date; status: string; series_index: number }>(
    `SELECT id, branch_id, chair_id, dentist_id, patient_id, starts_at, ends_at, status, series_index FROM appointments
      WHERE series_id = $1 AND status IN ('scheduled','confirmed') AND ($2 = 'following' OR id = $3) AND starts_at >= $4
      ORDER BY starts_at FOR UPDATE`,
    [seriesId, scope, fromId, from.starts_at],
  )).rows;
  for (const r of rows) {
    requireBranch(auth, r.branch_id);
    if (auth.membership!.role === "dentist" && r.dentist_id !== auth.userId) throw forbidden("Solo puedes modificar tu propia agenda");
  }
  return { from, rows };
}

export function appointmentSeriesRoutes(route: Route) {
  route({
    method: "POST", url: "/api/appointment-series/preview",
    summary: "Vista previa de una serie de citas: cada ocurrencia con su disponibilidad, el conflicto en español y el hueco libre más cercano",
    tags: ["agenda"], perm: "agenda.write", body: seriesBody,
    handler: async ({ c, auth, body }) => {
      const plan = await planSeries(c, auth, body);
      const occurrences = await reviewOccurrences(c, auth, plan.zone, plan.starts.map((s) => slotOf(body, s, plan.durationMin)));
      return {
        durationMin: plan.durationMin, procedureId: plan.procedureId, zone: plan.zone, occurrences,
        summary: { total: occurrences.length, free: occurrences.filter((o) => o.ok).length, conflicts: occurrences.filter((o) => !o.ok).length },
      };
    },
  });

  route({
    method: "POST", url: "/api/appointment-series",
    summary: "Agendar una serie: guarda en una transacción las ocurrencias libres (con un id de serie) e informa las que chocan. Idempotente con idempotencyKey",
    tags: ["agenda"], perm: "agenda.write",
    body: seriesBody.extend({
      occurrences: z.array(z.object({ startsAt: zDateTime })).min(1, "La serie no tiene citas").max(MAX_OCCURRENCES, `La serie puede tener hasta ${MAX_OCCURRENCES} citas`).optional(),
      idempotencyKey: z.string().min(8).max(80).optional(),
    }),
    handler: async ({ c, auth, body }) => {
      if (body.idempotencyKey) {
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':series:' || $2, 0))", [auth.clinicId, body.idempotencyKey]);
        const ex = (await c.query<{ id: string }>("SELECT id FROM appointment_series WHERE idempotency_key = $1", [body.idempotencyKey])).rows[0];
        if (ex) {
          const created = (await c.query("SELECT id, starts_at AS \"startsAt\" FROM appointments WHERE series_id = $1 ORDER BY starts_at", [ex.id])).rows;
          return { seriesId: ex.id, duplicate: true, created, skipped: [] };
        }
      }
      const plan = await planSeries(c, auth, body, body.occurrences?.map((o) => o.startsAt));
      const seriesId = (await c.query<{ id: string }>(
        `INSERT INTO appointment_series (clinic_id, branch_id, patient_id, dentist_id, chair_id, appointment_type_id, procedure_id, frequency, interval_n,
            count_n, until_date, first_starts_at, duration_min, reason, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
        [auth.clinicId, body.branchId, body.patientId, body.dentistId, body.chairId, body.appointmentTypeId, plan.procedureId, body.frequency, body.interval,
          body.count ?? null, body.count ? null : body.until, plan.starts[0], plan.durationMin, body.reason, body.idempotencyKey ?? null, auth.userId],
      )).rows[0]!.id;
      const created: { id: string; startsAt: string; index: number }[] = [];
      const skipped: { index: number; startsAt: string; code: string; message: string }[] = [];
      for (const [i, start] of plan.starts.entries()) {
        const slot = slotOf(body, start, plan.durationMin);
        const cf = await slotConflict(c, auth, plan.zone, slot);
        if (cf) { skipped.push({ index: i + 1, startsAt: slot.startsAt.toISOString(), ...cf }); continue; }
        await c.query("SAVEPOINT series_occ");
        try {
          const id = (await c.query<{ id: string }>(
            `INSERT INTO appointments (clinic_id, branch_id, chair_id, dentist_id, patient_id, procedure_id, appointment_type_id, series_id, series_index,
                starts_at, ends_at, reason, notes, source, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
            [auth.clinicId, body.branchId, body.chairId, body.dentistId, body.patientId, plan.procedureId, body.appointmentTypeId, seriesId, i + 1,
              slot.startsAt, slot.endsAt, body.reason, body.notes, body.source, auth.userId],
          )).rows[0]!.id;
          await c.query("RELEASE SAVEPOINT series_occ");
          created.push({ id, startsAt: slot.startsAt.toISOString(), index: i + 1 });
        } catch (e) {
          await c.query("ROLLBACK TO SAVEPOINT series_occ");
          const mapped = fromPgError(e);
          if (!mapped || mapped.status !== 409) throw e;
          skipped.push({ index: i + 1, startsAt: slot.startsAt.toISOString(), code: mapped.code, message: mapped.message });
        }
      }
      if (!created.length) throw conflict("Ninguna cita de la serie quedó libre; revisa los conflictos y elige otros horarios", "series_all_conflicts");
      for (const [k, a] of created.entries()) {
        await audit(c, auth, "appointment.created", "appointment", a.id, { startsAt: a.startsAt, dentistId: body.dentistId, patientId: body.patientId, seriesId, seriesIndex: a.index }, body.branchId);
        await recordAppointmentEvent(c, auth, { appointmentId: a.id, branchId: body.branchId, from: null, to: "scheduled" });
        // Vínculo automático con un control pendiente: solo la primera cita de la serie.
        if (k === 0) await linkRecallOnBooking(c, auth, { appointmentId: a.id, patientId: body.patientId, procedureId: plan.procedureId, startsAt: new Date(a.startsAt), zone: plan.zone, recallId: undefined });
      }
      await audit(c, auth, "appointment_series.created", "appointment_series", seriesId,
        { frequency: body.frequency, interval: body.interval, count: body.count ?? null, until: body.until ?? null, created: created.length, skipped: skipped.length, patientId: body.patientId }, body.branchId);
      return { seriesId, created, skipped };
    },
  });

  route({
    method: "GET", url: "/api/appointment-series/:id", summary: "Serie de citas: regla y citas (con su estado)", tags: ["agenda"], perm: "agenda.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      await loadSeries(c, auth, params.id);
      const s = (await c.query(
        `SELECT s.id, s.frequency, s.interval_n AS interval, s.count_n AS count, s.until_date AS until, s.first_starts_at AS "firstStartsAt",
                s.duration_min AS "durationMin", s.patient_id AS "patientId", s.dentist_id AS "dentistId", s.branch_id AS "branchId", s.created_at AS "createdAt"
           FROM appointment_series s WHERE s.id = $1`, [params.id])).rows[0];
      const appointments = (await c.query(
        `SELECT id, series_index AS "index", starts_at AS "startsAt", ends_at AS "endsAt", status FROM appointments WHERE series_id = $1 ORDER BY starts_at`, [params.id])).rows;
      return { ...s, appointments };
    },
  });

  route({
    method: "POST", url: "/api/appointment-series/:id/cancel", summary: "Cancelar \"solo esta\" o \"esta y las siguientes\" citas de la serie (con motivo)", tags: ["agenda"], perm: "agenda.write",
    params: zIdParams,
    body: z.object({ fromAppointmentId: zId, scope: z.enum(["this", "following"]), reason: z.string().trim().min(3, "Indica el motivo de la cancelación").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const s = await loadSeries(c, auth, params.id);
      const { rows } = await seriesTargets(c, auth, params.id, body.fromAppointmentId, body.scope);
      for (const r of rows) {
        await c.query("UPDATE appointments SET status = 'cancelled', cancel_reason = $2, cancelled_at = now(), updated_at = now() WHERE id = $1", [r.id, body.reason]);
        await audit(c, auth, "appointment.status", "appointment", r.id, { from: r.status, to: "cancelled", reason: body.reason, seriesId: params.id, scope: body.scope }, r.branch_id);
        await afterAppointmentStatusChange(c, auth, { appointmentId: r.id, branchId: r.branch_id, from: r.status, to: "cancelled", reason: body.reason });
      }
      await audit(c, auth, "appointment_series.cancelled", "appointment_series", params.id, { scope: body.scope, fromAppointmentId: body.fromAppointmentId, cancelled: rows.length }, s.branch_id);
      return { cancelled: rows.length, ids: rows.map((r) => r.id) };
    },
  });

  route({
    method: "POST", url: "/api/appointment-series/:id/reschedule",
    summary: "Reprogramar \"solo esta\" o \"esta y las siguientes\": mueve cada cita los mismos días y a la nueva hora. preview=true solo revisa; al guardar, las que chocan quedan en su horario y se informan",
    tags: ["agenda"], perm: "agenda.write", params: zIdParams,
    body: z.object({
      fromAppointmentId: zId, scope: z.enum(["this", "following"]), startsAt: zDateTime,
      durationMin: z.number().int().min(5).max(480).optional(), preview: z.boolean().default(false),
    }),
    handler: async ({ c, auth, params, body }) => {
      await loadSeries(c, auth, params.id);
      const zone = await clinicZone(c, auth.clinicId!);
      const { from, rows } = await seriesTargets(c, auth, params.id, body.fromAppointmentId, body.scope);
      const fromISO = from.starts_at.toISOString();
      const ids = rows.map((r) => r.id);
      const moves = rows.map((r) => {
        const startsAt = new Date(shiftLike(r.starts_at.toISOString(), fromISO, body.startsAt, zone));
        const dur = body.durationMin ? body.durationMin * 60_000 : r.ends_at.getTime() - r.starts_at.getTime();
        return { r, slot: { branchId: r.branch_id, dentistId: r.dentist_id, chairId: r.chair_id, patientId: r.patient_id, startsAt, endsAt: new Date(startsAt.getTime() + dur), allowOutsideSchedule: false } as SlotRequest };
      });
      if (body.preview) {
        const review = await reviewOccurrences(c, auth, zone, moves.map((m) => m.slot), ids);
        return {
          occurrences: review.map((o, i) => ({ ...o, appointmentId: moves[i]!.r.id, index: moves[i]!.r.series_index, fromStartsAt: moves[i]!.r.starts_at.toISOString() })),
          summary: { total: review.length, free: review.filter((o) => o.ok).length, conflicts: review.filter((o) => !o.ok).length },
        };
      }
      // Hacia adelante se mueve primero la última (y al revés) para que una cita no choque con el lugar que deja otra de la serie.
      const forward = Date.parse(body.startsAt) > from.starts_at.getTime();
      const ordered = forward ? [...moves].reverse() : moves;
      const moved: { id: string; startsAt: string }[] = [];
      const skipped: { id: string; startsAt: string; code: string; message: string }[] = [];
      for (const m of ordered) {
        const cf = await slotConflict(c, auth, zone, m.slot, ids);
        if (cf) { skipped.push({ id: m.r.id, startsAt: m.slot.startsAt.toISOString(), ...cf }); continue; }
        await c.query("SAVEPOINT series_move");
        try {
          await c.query(
            `UPDATE appointments SET starts_at = $2, ends_at = $3, reschedule_count = reschedule_count + 1, status = 'scheduled', confirmed_at = NULL, updated_at = now()
              WHERE id = $1`, [m.r.id, m.slot.startsAt, m.slot.endsAt]);
          await c.query("RELEASE SAVEPOINT series_move");
        } catch (e) {
          await c.query("ROLLBACK TO SAVEPOINT series_move");
          const mapped = fromPgError(e);
          if (!mapped || mapped.status !== 409) throw e;
          skipped.push({ id: m.r.id, startsAt: m.slot.startsAt.toISOString(), code: mapped.code, message: mapped.message });
          continue;
        }
        if (m.r.status !== "scheduled") await recordAppointmentEvent(c, auth, { appointmentId: m.r.id, branchId: m.r.branch_id, from: m.r.status, to: "scheduled", reason: "Reprogramada (serie)" });
        await audit(c, auth, "appointment.rescheduled", "appointment", m.r.id,
          { from: { startsAt: m.r.starts_at, dentistId: m.r.dentist_id, branchId: m.r.branch_id }, to: { startsAt: m.slot.startsAt, dentistId: m.r.dentist_id, branchId: m.r.branch_id }, seriesId: params.id, scope: body.scope },
          m.r.branch_id);
        moved.push({ id: m.r.id, startsAt: m.slot.startsAt.toISOString() });
      }
      if (!moved.length && skipped.length) throw conflict(skipped[0]!.message, skipped[0]!.code);
      return { moved: moved.reverse().sort((a, b) => a.startsAt.localeCompare(b.startsAt)), skipped };
    },
  });
}
