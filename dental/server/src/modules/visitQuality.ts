// Tiempos de la cita e informe de calidad operativa (espera, puntualidad, duración real),
// y citas pasadas que quedaron sin cerrar (se resuelven a mano: nunca se cierran solas).
import { z } from "zod";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams } from "../lib/http.js";
import { AppError, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../lib/rbac.js";
import { STATUS_LABELS } from "./agenda.js";
import { resolveRange } from "./reports.js";
import { afterAppointmentStatusChange } from "./appointmentEvents.js";
import { xlsxBuffer } from "../lib/xlsxSafe.js";

const r1 = (v: unknown) => (v == null ? null : Math.round(Number(v) * 10) / 10);
const pct = (n: number, d: number) => (d ? Math.round((n / d) * 1000) / 10 : null);

export interface QualityRow {
  total: number; completed: number; noShow: number; cancelled: number;
  /** No asistió / (atendidas + no asistió), igual que el panel. */
  noShowRate: number | null;
  /** Canceladas / total de citas del período. */
  cancellationRate: number | null;
  wait: { n: number; mean: number | null; median: number | null; p90: number | null; buckets: { upTo5: number; upTo10: number; upTo20: number; over20: number } };
  punctuality: { n: number; meanMin: number | null; medianMin: number | null; early: number; onTime: number; late: number; veryLate: number; onTimePct: number | null };
  duration: { n: number; realMean: number | null; plannedMean: number | null; overrunMean: number | null; over: number; under: number; overPct: number | null };
}

/**
 * Cálculo en SQL sobre los eventos de la cita:
 *  - espera = primer "en atención" − primera "llegada";
 *  - puntualidad = llegada − hora agendada (negativo = llegó antes);
 *  - duración real = "atendida" − "en atención" (no cuentan los cierres retroactivos).
 * Mediana y P90 con percentile_cont (interpolación lineal).
 */
export async function visitQualityData(c: Client, auth: AuthCtx, q: { from?: string; to?: string; branchId?: string; dentistId?: string }) {
  if (q.branchId) requireBranch(auth, q.branchId);
  const range = await resolveRange(c, auth, q.from, q.to);
  const r = await c.query(
    `WITH base AS (
       SELECT a.id, a.branch_id, a.dentist_id, a.status, a.starts_at, a.ends_at, a.arrived_at
         FROM appointments a
        WHERE a.starts_at >= $1 AND a.starts_at < $2 AND ($3::uuid[] IS NULL OR a.branch_id = ANY($3))
          AND ($4::uuid IS NULL OR a.branch_id = $4) AND ($5::uuid IS NULL OR a.dentist_id = $5)
     ), ev AS (
       SELECT e.appointment_id,
              min(e.occurred_at) FILTER (WHERE e.to_status = 'arrived' AND NOT e.retroactive) AS arrived,
              min(e.occurred_at) FILTER (WHERE e.to_status = 'in_progress' AND NOT e.retroactive) AS started,
              max(e.occurred_at) FILTER (WHERE e.to_status = 'completed' AND NOT e.retroactive) AS finished
         FROM appointment_events e WHERE e.appointment_id IN (SELECT id FROM base) GROUP BY e.appointment_id
     ), m AS (
       SELECT b.*, x.arrival, x.started, x.finished,
              CASE WHEN x.started >= x.arrival THEN extract(epoch FROM x.started - x.arrival) / 60 END AS wait_min,
              extract(epoch FROM x.arrival - b.starts_at) / 60 AS punct_min,
              CASE WHEN b.status = 'completed' AND x.finished >= x.started THEN extract(epoch FROM x.finished - x.started) / 60 END AS real_min,
              extract(epoch FROM b.ends_at - b.starts_at) / 60 AS planned_min
         FROM base b LEFT JOIN ev ON ev.appointment_id = b.id
         CROSS JOIN LATERAL (SELECT COALESCE(ev.arrived, b.arrived_at) AS arrival, ev.started, ev.finished) x
     )
     SELECT GROUPING(branch_id) AS g_branch, GROUPING(dentist_id) AS g_dentist, branch_id, dentist_id,
            count(*)::int AS total,
            count(*) FILTER (WHERE status = 'completed')::int AS completed,
            count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            count(wait_min)::int AS wait_n, avg(wait_min) AS wait_mean,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY wait_min) AS wait_median,
            percentile_cont(0.9) WITHIN GROUP (ORDER BY wait_min) AS wait_p90,
            count(*) FILTER (WHERE wait_min <= 5)::int AS wait_5,
            count(*) FILTER (WHERE wait_min > 5 AND wait_min <= 10)::int AS wait_10,
            count(*) FILTER (WHERE wait_min > 10 AND wait_min <= 20)::int AS wait_20,
            count(*) FILTER (WHERE wait_min > 20)::int AS wait_over,
            count(punct_min)::int AS punct_n, avg(punct_min) AS punct_mean,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY punct_min) AS punct_median,
            count(*) FILTER (WHERE punct_min < -5)::int AS early,
            count(*) FILTER (WHERE punct_min >= -5 AND punct_min <= 5)::int AS on_time,
            count(*) FILTER (WHERE punct_min > 5 AND punct_min <= 15)::int AS late,
            count(*) FILTER (WHERE punct_min > 15)::int AS very_late,
            count(real_min)::int AS dur_n, avg(real_min) AS real_mean,
            avg(planned_min) FILTER (WHERE real_min IS NOT NULL) AS planned_mean,
            avg(real_min - planned_min) AS overrun_mean,
            count(*) FILTER (WHERE real_min > planned_min)::int AS over,
            count(*) FILTER (WHERE real_min < planned_min)::int AS under
       FROM m GROUP BY GROUPING SETS ((), (branch_id), (dentist_id))`,
    [range.from, range.to, allowedBranches(auth), q.branchId ?? null, q.dentistId ?? null],
  );
  const shape = (x: any): QualityRow => ({
    total: x.total, completed: x.completed, noShow: x.no_show, cancelled: x.cancelled,
    noShowRate: pct(x.no_show, x.completed + x.no_show),
    cancellationRate: pct(x.cancelled, x.total),
    wait: { n: x.wait_n, mean: r1(x.wait_mean), median: r1(x.wait_median), p90: r1(x.wait_p90), buckets: { upTo5: x.wait_5, upTo10: x.wait_10, upTo20: x.wait_20, over20: x.wait_over } },
    punctuality: { n: x.punct_n, meanMin: r1(x.punct_mean), medianMin: r1(x.punct_median), early: x.early, onTime: x.on_time, late: x.late, veryLate: x.very_late, onTimePct: pct(x.on_time, x.punct_n) },
    duration: { n: x.dur_n, realMean: r1(x.real_mean), plannedMean: r1(x.planned_mean), overrunMean: r1(x.overrun_mean), over: x.over, under: x.under, overPct: pct(x.over, x.dur_n) },
  });
  const branches = new Map((await c.query<{ id: string; name: string }>("SELECT id, name FROM branches")).rows.map((b) => [b.id, b.name]));
  const dentists = new Map((await c.query<{ id: string; name: string }>("SELECT u.id, u.full_name AS name FROM memberships m JOIN users u ON u.id = m.user_id")).rows.map((d) => [d.id, d.name]));
  const empty = { total: 0, completed: 0, no_show: 0, cancelled: 0, wait_n: 0, wait_5: 0, wait_10: 0, wait_20: 0, wait_over: 0, punct_n: 0, early: 0, on_time: 0, late: 0, very_late: 0, dur_n: 0, over: 0, under: 0 };
  const totalRow = r.rows.find((x) => x.g_branch === 1 && x.g_dentist === 1) ?? empty;
  return {
    range: { from: range.fromDate, to: DateTime.fromISO(range.toDateExclusive).minus({ days: 1 }).toISODate(), timezone: range.zone },
    total: shape(totalRow),
    byBranch: r.rows.filter((x) => x.g_branch === 0).map((x) => ({ branchId: x.branch_id, branchName: branches.get(x.branch_id) ?? "—", ...shape(x) }))
      .sort((a, b) => a.branchName.localeCompare(b.branchName)),
    byDentist: r.rows.filter((x) => x.g_dentist === 0).map((x) => ({ dentistId: x.dentist_id, dentistName: dentists.get(x.dentist_id) ?? "—", ...shape(x) }))
      .sort((a, b) => a.dentistName.localeCompare(b.dentistName)),
  };
}

const OPEN_STATUSES = ["scheduled", "confirmed", "arrived", "in_progress"];
/** Resoluciones de un clic permitidas para una cita pasada según su estado. */
export const RESOLUTIONS: Record<string, ("no_show" | "completed")[]> = {
  scheduled: ["no_show", "completed"], confirmed: ["no_show", "completed"], arrived: ["completed"], in_progress: ["completed"],
};

export function visitQualityRoutes(route: Route) {
  const reportQuery = z.object({ from: zDate.optional(), to: zDate.optional(), branchId: zId.optional(), dentistId: zId.optional() });

  route({
    method: "GET", url: "/api/reports/visit-quality",
    summary: "Calidad de la atención por sucursal y profesional: espera (media, mediana, P90), puntualidad, duración real frente a la planificada, inasistencia y cancelación",
    tags: ["reportes"], perm: "reports.operational", query: reportQuery,
    handler: async ({ c, auth, query }) => visitQualityData(c, auth, query),
  });

  route({
    method: "GET", url: "/api/reports/visit-quality.xlsx", summary: "Exportar el informe de calidad de la atención a Excel", tags: ["reportes"], perm: "reports.operational", raw: true,
    query: reportQuery,
    handler: async ({ c, auth, query, reply }) => {
      const d = await visitQualityData(c, auth, query);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Calidad");
      ws.addRow([`Calidad de la atención · ${d.range.from} a ${d.range.to}`]).font = { bold: true };
      ws.addRow(["Grupo", "Nombre", "Citas", "Atendidas", "No asistió", "Canceladas", "% no asistió", "% canceladas",
        "Espera: muestras", "Espera media (min)", "Espera mediana (min)", "Espera P90 (min)",
        "Puntualidad: muestras", "Llegada media vs hora (min)", "% puntuales (±5 min)",
        "Duración: muestras", "Real media (min)", "Planificada media (min)", "Sobrepaso medio (min)", "% que se pasó"]).font = { bold: true };
      const add = (group: string, name: string, x: QualityRow) => ws.addRow([group, name, x.total, x.completed, x.noShow, x.cancelled, x.noShowRate, x.cancellationRate,
        x.wait.n, x.wait.mean, x.wait.median, x.wait.p90, x.punctuality.n, x.punctuality.meanMin, x.punctuality.onTimePct,
        x.duration.n, x.duration.realMean, x.duration.plannedMean, x.duration.overrunMean, x.duration.overPct]);
      add("Total", "Todas", d.total);
      for (const b of d.byBranch) add("Sucursal", b.branchName, b);
      for (const p of d.byDentist) add("Profesional", p.dentistName, p);
      ws.columns.forEach((col) => (col.width = 16));
      await audit(c, auth, "report.exported", "visit_quality", null, { from: d.range.from, to: d.range.to, branchId: query.branchId ?? null });
      reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="calidad-atencion-${d.range.from}.xlsx"`)
        .send(await xlsxBuffer(wb));
    },
  });

  route({
    method: "GET", url: "/api/appointments/unclosed",
    summary: "Citas pasadas sin cerrar (agendadas, confirmadas, en sala de espera o en atención cuya hora de fin ya pasó)",
    tags: ["agenda"], perm: "agenda.read",
    query: z.object({
      branchId: zId.optional(),
      days: z.coerce.number().int().min(1).max(365).default(60),
      graceMin: z.coerce.number().int().min(0).max(720).default(60),
    }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const r = await c.query(
        `SELECT a.id, a.branch_id AS "branchId", b.name AS "branchName", a.status, a.starts_at AS "startsAt", a.ends_at AS "endsAt",
                a.patient_id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName", u.full_name AS "dentistName",
                pr.name AS "procedureName", a.reason
           FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN users u ON u.id = a.dentist_id JOIN branches b ON b.id = a.branch_id
           LEFT JOIN procedures pr ON pr.id = a.procedure_id
          WHERE a.status = ANY($1) AND a.ends_at < now() - make_interval(mins => $2) AND a.starts_at > now() - make_interval(days => $3)
            AND ($4::uuid IS NULL OR a.branch_id = $4) AND ($5::uuid[] IS NULL OR a.branch_id = ANY($5))
          ORDER BY a.starts_at LIMIT 300`,
        [OPEN_STATUSES, query.graceMin, query.days, query.branchId ?? null, allowedBranches(auth)],
      );
      return r.rows.map((x) => ({ ...x, statusLabel: STATUS_LABELS[x.status], resolutions: RESOLUTIONS[x.status] ?? [] }));
    },
  });

  route({
    method: "POST", url: "/api/appointments/:id/resolve",
    summary: "Cerrar a mano una cita pasada: no asistió o atendida (queda marcado como cierre posterior; no se usa para medir tiempos)",
    tags: ["agenda"], perm: "agenda.write", params: zIdParams,
    body: z.object({ resolution: z.enum(["no_show", "completed"]) }),
    handler: async ({ c, auth, params, body }) => {
      const cur = (await c.query<{ status: string; branch_id: string; dentist_id: string; ends_at: Date }>(
        "SELECT status, branch_id, dentist_id, ends_at FROM appointments WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!cur) throw notFound("Cita");
      requireBranch(auth, cur.branch_id);
      if (cur.ends_at.getTime() > Date.now()) throw new AppError(409, "not_past", "La cita todavía no terminó: usa los botones de la sala de espera");
      if (!(RESOLUTIONS[cur.status] ?? []).includes(body.resolution)) {
        throw new AppError(409, "invalid_transition", `No se puede marcar como "${STATUS_LABELS[body.resolution]}" una cita "${STATUS_LABELS[cur.status]}"`);
      }
      await c.query(
        `UPDATE appointments SET status = $2, updated_at = now() ${body.resolution === "completed" ? ", completed_at = now()" : ""} WHERE id = $1`,
        [params.id, body.resolution],
      );
      await audit(c, auth, "appointment.resolved", "appointment", params.id, { from: cur.status, to: body.resolution }, cur.branch_id);
      await afterAppointmentStatusChange(c, auth, { appointmentId: params.id, branchId: cur.branch_id, from: cur.status, to: body.resolution, reason: "Cierre de cita pasada", retroactive: true });
      return { ok: true };
    },
  });
}
