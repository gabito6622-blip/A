// Apoyo de la vista semanal (B-015) y del mini calendario: horario de atención por día y
// ocupación por día del mes. Las citas se leen con GET /api/appointments (rango de fechas).
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { zDate, zId } from "../lib/http.js";
import { badRequest } from "../lib/errors.js";
import { requireBranch } from "../lib/rbac.js";
import { mergeIntervals, workIntervalsForDay } from "../lib/slots.js";
import { clinicZone } from "./agenda.js";

export function agendaViewRoutes(route: Route) {
  route({
    method: "GET", url: "/api/agenda/week",
    summary: "Marco de la vista semanal: horario de atención (unión de los profesionales o el elegido) y bloqueos por día de una sucursal",
    tags: ["agenda"], perm: "agenda.read",
    query: z.object({ branchId: zId, from: zDate, days: z.coerce.number().int().min(1).max(14).default(7), dentistId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const sch = (await c.query<{ weekday: number; start: string; end: string; dentist_id: string }>(
        `SELECT s.weekday, to_char(s.start_time,'HH24:MI') AS start, to_char(s.end_time,'HH24:MI') AS "end", s.dentist_id
           FROM dentist_schedules s JOIN memberships m ON m.clinic_id = s.clinic_id AND m.user_id = s.dentist_id AND m.active AND m.is_professional
          WHERE s.branch_id = $1 AND ($2::uuid IS NULL OR s.dentist_id = $2)`,
        [query.branchId, query.dentistId ?? null],
      )).rows;
      const first = DateTime.fromISO(query.from, { zone }).startOf("day");
      const last = first.plus({ days: query.days });
      const dentists = [...new Set(sch.map((s) => s.dentist_id))];
      const blocks = (await c.query<{ s: Date; e: Date; reason: string; dentist_id: string | null }>(
        `SELECT starts_at AS s, ends_at AS e, reason, dentist_id FROM schedule_blocks
          WHERE starts_at < $2 AND ends_at > $1
            AND ((dentist_id IS NULL AND branch_id = $3) OR (dentist_id = ANY($4::uuid[]) AND (branch_id IS NULL OR branch_id = $3)))
            AND ($5::uuid IS NULL OR dentist_id IS NULL OR dentist_id = $5)`,
        [first.toJSDate(), last.toJSDate(), query.branchId, dentists, query.dentistId ?? null],
      )).rows;
      const days = [];
      for (let i = 0; i < query.days; i++) {
        const d = first.plus({ days: i });
        const date = d.toISODate()!;
        const work = mergeIntervals(workIntervalsForDay(date, zone, sch.filter((s) => s.weekday === d.weekday)));
        const ds = d.toMillis(), de = d.plus({ days: 1 }).toMillis();
        days.push({
          date, weekday: d.weekday,
          work: work.map(([s, e]) => ({ start: new Date(s).toISOString(), end: new Date(e).toISOString() })),
          blocks: blocks.filter((b) => +b.s < de && +b.e > ds).map((b) => ({ start: b.s, end: b.e, reason: b.reason, dentistId: b.dentist_id })),
        });
      }
      return { zone, days };
    },
  });

  route({
    method: "GET", url: "/api/agenda/occupancy",
    summary: "Ocupación por día de un mes (minutos agendados sobre minutos de atención) para el mini calendario",
    tags: ["agenda"], perm: "agenda.read",
    query: z.object({
      branchId: zId, month: z.string().regex(/^\d{4}-\d{2}$/, "Mes inválido (AAAA-MM)"),
      dentistId: zId.optional(), chairId: zId.optional(),
    }),
    handler: async ({ c, auth, query }) => {
      requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const start = DateTime.fromISO(`${query.month}-01`, { zone }).startOf("month");
      if (!start.isValid) throw badRequest("Mes inválido (AAAA-MM)");
      const end = start.plus({ months: 1 });
      const sch = (await c.query<{ weekday: number; start: string; end: string }>(
        `SELECT s.weekday, to_char(s.start_time,'HH24:MI') AS start, to_char(s.end_time,'HH24:MI') AS "end"
           FROM dentist_schedules s JOIN memberships m ON m.clinic_id = s.clinic_id AND m.user_id = s.dentist_id AND m.active AND m.is_professional
          WHERE s.branch_id = $1 AND ($2::uuid IS NULL OR s.dentist_id = $2)`,
        [query.branchId, query.dentistId ?? null],
      )).rows;
      // Capacidad: con consultorio elegido, el horario de la sucursal (unión); si no, la suma de los profesionales.
      const booked = new Map<string, { min: number; n: number }>();
      for (const r of (await c.query<{ d: string; min: number; n: number }>(
        `SELECT to_char(starts_at AT TIME ZONE $4, 'YYYY-MM-DD') AS d, sum(extract(epoch FROM ends_at - starts_at) / 60)::int AS min, count(*)::int AS n
           FROM appointments
          WHERE branch_id = $1 AND starts_at >= $2 AND starts_at < $3 AND status NOT IN ('cancelled','no_show')
            AND ($5::uuid IS NULL OR dentist_id = $5) AND ($6::uuid IS NULL OR chair_id = $6)
          GROUP BY 1`,
        [query.branchId, start.toJSDate(), end.toJSDate(), zone, query.dentistId ?? null, query.chairId ?? null],
      )).rows) booked.set(r.d, { min: r.min, n: r.n });
      const days = [];
      for (let d = start; d < end; d = d.plus({ days: 1 })) {
        const date = d.toISODate()!;
        const ranges = sch.filter((s) => s.weekday === d.weekday);
        const work = workIntervalsForDay(date, zone, ranges);
        const capacityMin = (query.chairId ? mergeIntervals(work) : work).reduce((t, [s, e]) => t + (e - s) / 60_000, 0);
        const b = booked.get(date) ?? { min: 0, n: 0 };
        days.push({
          date, bookedMin: b.min, count: b.n, capacityMin: Math.round(capacityMin),
          ratio: capacityMin > 0 ? Math.min(1, Math.round((b.min / capacityMin) * 100) / 100) : null,
        });
      }
      return { month: query.month, days };
    },
  });
}
