// "Mi día" del profesional: sus pacientes de hoy con alertas médicas y tratamientos pendientes.
import { z } from "zod";
import type { Route } from "../lib/http.js";
import { zDate } from "../lib/http.js";
import { dayBounds } from "../lib/slots.js";
import { clinicZone, STATUS_LABELS } from "./agenda.js";

export function myDayRoutes(route: Route) {
  route({
    method: "GET", url: "/api/my-day", summary: "Agenda del día del profesional con alertas médicas y tratamientos pendientes", tags: ["agenda"], perm: "agenda.read",
    query: z.object({ date: zDate.optional() }),
    handler: async ({ c, auth, query }) => {
      if (!auth.membership!.isProfessional) return { professional: false, appointments: [] };
      const zone = await clinicZone(c, auth.clinicId!);
      const date = query.date ?? new Date().toLocaleDateString("en-CA", { timeZone: zone });
      const [s, e] = dayBounds(date, zone);
      const clinical = auth.permissions.has("clinical.read");
      const rows = (await c.query(
        `SELECT a.id, a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status, a.reason, a.patient_id AS "patientId",
                p.first_name || ' ' || p.last_name AS "patientName", p.birth_date AS "birthDate", b.name AS "branchName", ch.name AS "chairName",
                pr.name AS "procedureName",
                (SELECT count(*)::int FROM budget_items i JOIN budgets bu ON bu.id = i.budget_id
                  WHERE bu.patient_id = a.patient_id AND bu.status = 'accepted' AND i.status = 'pending') AS "pendingTreatments",
                (SELECT max(x.starts_at) FROM appointments x WHERE x.patient_id = a.patient_id AND x.status = 'completed' AND x.starts_at < a.starts_at) AS "lastVisit",
                ${clinical ? `(SELECT m.data FROM medical_histories m WHERE m.patient_id = a.patient_id ORDER BY m.recorded_at DESC LIMIT 1)` : "NULL"} AS history
           FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN branches b ON b.id = a.branch_id
           LEFT JOIN chairs ch ON ch.id = a.chair_id LEFT JOIN procedures pr ON pr.id = a.procedure_id
          WHERE a.dentist_id = $1 AND a.starts_at >= $2 AND a.starts_at < $3 AND a.status <> 'cancelled'
          ORDER BY a.starts_at`, [auth.userId, s, e])).rows;
      return {
        professional: true, date,
        appointments: rows.map(({ history, ...r }) => {
          const h = (history ?? {}) as { allergies?: string; anticoagulants?: boolean; pregnant?: boolean; conditions?: string[] };
          const alerts = [h.allergies ? `Alergias: ${h.allergies}` : null, h.anticoagulants ? "Anticoagulantes" : null, h.pregnant ? "Embarazo" : null, ...(h.conditions ?? [])].filter(Boolean);
          return { ...r, statusLabel: STATUS_LABELS[r.status], alerts, firstVisit: !r.lastVisit };
        }),
      };
    },
  });
}
