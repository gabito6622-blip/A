// Tarjetas proactivas del Inicio (R2-44) y "citas pasadas sin cerrar" en el Inicio (B-065).
//
//  * "Se liberó un hueco hoy a las 10:15 con la Dra. X": citas de hoy canceladas o reprogramadas a
//    otro horario cuyo hueco sigue libre, con candidatos de la lista de espera y de los controles
//    pendientes que encajan. La tarjeta SOLO propone: la persona abre el diálogo de la cita ya
//    prellenado y confirma. Nunca agenda sola y nunca propone cancelar a nadie.
//  * "N citas pasadas sin cerrar", "N tareas vencidas" y "N trabajos de laboratorio listos sin cita
//    de colocación", cada una solo si el rol tiene el permiso correspondiente.
//  * Todo se limita a las sucursales permitidas (y a la elegida arriba, si hay una). El odontólogo
//    ve solo lo suyo (sus huecos, sus citas sin cerrar y sus trabajos de laboratorio).
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../../lib/http.js";
import { zId } from "../../lib/http.js";
import type { Client } from "../../lib/db.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../../lib/rbac.js";
import { dayBounds } from "../../lib/slots.js";
import { clinicZone } from "../agenda.js";
import { LAB_READ } from "../lab.js";
import { presentTask, TASK_FROM, TASK_ORDER, taskColumns } from "./tasks.js";

const OPEN_STATUSES = ["scheduled", "confirmed", "arrived", "in_progress"];
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

interface Slot { branch_id: string; branch_name: string; dentist_id: string; dentist_name: string; starts_at: Date; ends_at: Date }
interface Candidate { source: "waitlist" | "recall"; id: string; patientId: string; patientName: string; reason: string | null; durationMin: number; procedureId: string | null }

/** Huecos liberados hoy que siguen libres (citas canceladas o movidas a otro horario). */
async function freedSlots(c: Client, auth: AuthCtx, zone: string, branchId: string | null, dentistId: string | null) {
  const today = DateTime.now().setZone(zone).toISODate()!;
  const [, dayEnd] = dayBounds(today, zone);
  const rows = (await c.query<Slot>(
    `WITH freed AS (
       SELECT a.branch_id, a.dentist_id, a.starts_at, a.ends_at
         FROM appointments a
        WHERE a.status = 'cancelled' AND a.starts_at > now() AND a.starts_at < $1
       UNION
       SELECT x.branch_id, x.dentist_id, x.starts_at, x.ends_at FROM (
         SELECT (l.data->'from'->>'branchId')::uuid AS branch_id, (l.data->'from'->>'dentistId')::uuid AS dentist_id,
                (l.data->'from'->>'startsAt')::timestamptz AS starts_at,
                (l.data->'from'->>'startsAt')::timestamptz + (ap.ends_at - ap.starts_at) AS ends_at
           FROM audit_log l JOIN appointments ap ON ap.id::text = l.entity_id
          WHERE l.clinic_id = app_clinic_id() AND l.action = 'appointment.rescheduled' AND l.created_at > now() - interval '45 days'
            AND l.data->'from'->>'startsAt' IS NOT NULL AND l.data->'from'->>'dentistId' IS NOT NULL AND l.data->'from'->>'branchId' IS NOT NULL
       ) x WHERE x.starts_at > now() AND x.starts_at < $1
     ), slots AS (
       SELECT DISTINCT ON (f.dentist_id, f.starts_at) f.* FROM freed f
        WHERE ($2::uuid[] IS NULL OR f.branch_id = ANY($2)) AND ($3::uuid IS NULL OR f.branch_id = $3) AND ($4::uuid IS NULL OR f.dentist_id = $4)
          AND NOT EXISTS (SELECT 1 FROM appointments o WHERE o.dentist_id = f.dentist_id AND o.status NOT IN ('cancelled','no_show')
                            AND o.starts_at < f.ends_at AND o.ends_at > f.starts_at)
          AND NOT EXISTS (SELECT 1 FROM schedule_blocks k WHERE k.starts_at < f.ends_at AND k.ends_at > f.starts_at
                            AND (k.dentist_id = f.dentist_id OR (k.dentist_id IS NULL AND k.branch_id = f.branch_id))
                            AND (k.branch_id IS NULL OR k.branch_id = f.branch_id))
          AND EXISTS (SELECT 1 FROM memberships m WHERE m.clinic_id = app_clinic_id() AND m.user_id = f.dentist_id AND m.active AND m.is_professional)
        ORDER BY f.dentist_id, f.starts_at, f.ends_at DESC
     )
     SELECT s.*, b.name AS branch_name, u.full_name AS dentist_name FROM slots s
       JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.dentist_id
      ORDER BY s.starts_at LIMIT 3`,
    [dayEnd, allowedBranches(auth), branchId, dentistId])).rows;
  const out = [];
  for (const s of rows) {
    const minutes = Math.round((s.ends_at.getTime() - s.starts_at.getTime()) / 60_000);
    const hour = DateTime.fromJSDate(s.starts_at, { zone }).hour;
    const waitlist = (await c.query<Candidate>(
      `SELECT 'waitlist' AS source, w.id, w.patient_id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName",
              pr.name AS reason, w.duration_min AS "durationMin", w.procedure_id AS "procedureId"
         FROM waitlist_entries w JOIN patients p ON p.id = w.patient_id LEFT JOIN procedures pr ON pr.id = w.procedure_id
        WHERE w.status = 'waiting' AND w.branch_id = $1 AND (w.dentist_id IS NULL OR w.dentist_id = $2) AND w.duration_min <= $3
          AND (w.earliest_date IS NULL OR w.earliest_date <= $4::date) AND (w.latest_date IS NULL OR w.latest_date >= $4::date)
          AND (w.preferred_period = 'any' OR (w.preferred_period = 'morning') = ($5::int < 13))
          AND p.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM appointments x WHERE x.patient_id = w.patient_id AND x.status NOT IN ('cancelled','no_show')
                            AND x.starts_at < $7 AND x.ends_at > $6)
        ORDER BY w.priority DESC, w.created_at LIMIT 3`,
      [s.branch_id, s.dentist_id, minutes, DateTime.fromJSDate(s.starts_at, { zone }).toISODate(), hour, s.starts_at, s.ends_at])).rows;
    const recalls = (await c.query<Candidate>(
      `SELECT 'recall' AS source, r.id, r.patient_id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName",
              r.reason, COALESCE(pr.duration_min, 30) AS "durationMin", r.procedure_id AS "procedureId"
         FROM recalls r JOIN patients p ON p.id = r.patient_id LEFT JOIN procedures pr ON pr.id = r.procedure_id
        WHERE r.status = 'pending' AND r.branch_id = $1 AND (r.dentist_id IS NULL OR r.dentist_id = $2)
          AND COALESCE(pr.duration_min, 30) <= $3 AND r.due_date <= ($4::date + 30) AND p.archived_at IS NULL
          AND NOT EXISTS (SELECT 1 FROM appointments x WHERE x.patient_id = r.patient_id AND x.status IN ('scheduled','confirmed') AND x.starts_at > now())
          AND NOT EXISTS (SELECT 1 FROM appointments x WHERE x.patient_id = r.patient_id AND x.status NOT IN ('cancelled','no_show')
                            AND x.starts_at < $6 AND x.ends_at > $5)
        ORDER BY r.due_date, (r.priority = 'high') DESC LIMIT 4`,
      [s.branch_id, s.dentist_id, minutes, DateTime.fromJSDate(s.starts_at, { zone }).toISODate(), s.starts_at, s.ends_at])).rows;
    const seen = new Set(waitlist.map((w) => w.patientId));
    const candidates = [...waitlist, ...recalls.filter((r) => !seen.has(r.patientId))].slice(0, 5);
    const time = DateTime.fromJSDate(s.starts_at, { zone }).toFormat("HH:mm");
    out.push({
      id: `slot:${s.dentist_id}:${s.starts_at.toISOString()}`, kind: "freed_slot" as const,
      title: `Se liberó un hueco hoy a las ${time} con ${s.dentist_name}`,
      detail: candidates.length
        ? `${s.branch_name} · ${minutes} min · ${plural(candidates.length, "paciente podría ocuparlo", "pacientes podrían ocuparlo")}`
        : `${s.branch_name} · ${minutes} min · sin candidatos en la lista de espera ni en controles`,
      slot: {
        branchId: s.branch_id, branchName: s.branch_name, dentistId: s.dentist_id, dentistName: s.dentist_name,
        startsAt: s.starts_at.toISOString(), endsAt: s.ends_at.toISOString(), date: DateTime.fromJSDate(s.starts_at, { zone }).toISODate(), time, durationMin: minutes,
        candidates: candidates.map((x) => ({ ...x, sourceLabel: x.source === "waitlist" ? "Lista de espera" : "Control pendiente" })),
      },
    });
  }
  return out;
}

export function homeRoutes(route: Route) {
  route({
    method: "GET", url: "/api/home/cards",
    summary: "Tarjetas proactivas del Inicio: huecos liberados con candidatos, citas pasadas sin cerrar, tareas vencidas y trabajos de laboratorio listos sin cita (según permisos y sucursales)",
    tags: ["inicio"], perm: "tasks.use", query: z.object({ branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const allowed = allowedBranches(auth);
      const branchId = query.branchId ?? null;
      const role = auth.membership!.role;
      const ownOnly = role === "dentist" ? auth.userId : null;
      const has = (p: Parameters<typeof auth.permissions.has>[0]) => auth.permissions.has(p);
      const cards: any[] = [];

      // Mis tareas (asignadas a mí, a mi rol o tomadas por mí) en las sucursales permitidas.
      const mine = (await c.query(
        `SELECT ${taskColumns(auth)} ${TASK_FROM}
          WHERE t.status IN ('open','taken') AND ($1::uuid[] IS NULL OR t.branch_id = ANY($1)) AND ($2::uuid IS NULL OR t.branch_id = $2)
            AND (t.assignee_user_id = $3 OR t.assignee_role = $4 OR t.taken_by = $3)
          ${TASK_ORDER} LIMIT 50`, [allowed, branchId, auth.userId, role])).rows.map((r: any) => presentTask(auth, zone, r));
      const myOverdue = mine.filter((t) => t.overdue).length;
      if (myOverdue) cards.push({ id: "overdue_tasks", kind: "overdue_tasks", count: myOverdue, title: `${plural(myOverdue, "tarea vencida", "tareas vencidas")} a tu cargo`, link: "/tareas" });
      if (has("clinic.manage")) {
        const team = (await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM staff_tasks t
            WHERE t.status IN ('open','taken') AND t.due_at < now() AND ($1::uuid[] IS NULL OR t.branch_id = ANY($1)) AND ($2::uuid IS NULL OR t.branch_id = $2)
              AND NOT (t.assignee_user_id IS NOT DISTINCT FROM $3 OR t.assignee_role IS NOT DISTINCT FROM $4 OR t.taken_by IS NOT DISTINCT FROM $3)`,
          [allowed, branchId, auth.userId, role])).rows[0]!.n;
        if (team) cards.push({ id: "team_overdue_tasks", kind: "overdue_tasks", count: team, title: `${plural(team, "tarea vencida", "tareas vencidas")} del equipo`, link: "/tareas?vista=sucursal" });
      }

      // Huecos liberados hoy (solo quien puede agendar y ver pacientes).
      if (has("agenda.write") && has("patients.read")) cards.push(...await freedSlots(c, auth, zone, branchId, ownOnly));

      // Citas pasadas sin cerrar (B-065), mismo criterio que la Sala de espera: 60 días, 60 min de gracia.
      if (has("agenda.read")) {
        const n = (await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM appointments a
            WHERE a.status = ANY($1) AND a.ends_at < now() - interval '60 minutes' AND a.starts_at > now() - interval '60 days'
              AND ($2::uuid[] IS NULL OR a.branch_id = ANY($2)) AND ($3::uuid IS NULL OR a.branch_id = $3) AND ($4::uuid IS NULL OR a.dentist_id = $4)`,
          [OPEN_STATUSES, allowed, branchId, ownOnly])).rows[0]!.n;
        if (n) cards.push({ id: "unclosed", kind: "unclosed", count: n, title: `${plural(n, "cita pasada sin cerrar", "citas pasadas sin cerrar")}`, detail: "Indica si el paciente fue atendido o no asistió.", link: "/sala-espera" });
      }

      // Trabajos de laboratorio listos sin cita de colocación (si el rol ve laboratorio).
      if (has("patients.read") && LAB_READ.some((p) => has(p))) {
        const n = (await c.query<{ n: number }>(
          `SELECT count(*)::int AS n FROM lab_orders o
            WHERE o.status = 'received' AND ($1::uuid[] IS NULL OR o.branch_id = ANY($1)) AND ($2::uuid IS NULL OR o.branch_id = $2) AND ($3::uuid IS NULL OR o.dentist_id = $3)
              AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = o.patient_id AND a.status NOT IN ('cancelled','no_show')
                AND a.starts_at >= COALESCE((SELECT max(e.created_at) FROM lab_order_events e WHERE e.order_id = o.id AND e.to_status = 'received'), o.received_on::timestamptz))`,
          [allowed, branchId, ownOnly])).rows[0]!.n;
        if (n) cards.push({ id: "lab_ready", kind: "lab_ready", count: n, title: `${plural(n, "trabajo de laboratorio listo", "trabajos de laboratorio listos")} sin cita de colocación`, link: "/laboratorio" });
      }

      return { cards, myTasks: { items: mine.slice(0, 6), total: mine.length, overdue: myOverdue } };
    },
  });
}
