// Contador de tareas pendientes para el menú (B-084): una consulta liviana que la interfaz pide al
// navegar (como mucho cada 30 s) para mostrar el número junto a «Tareas».
//
// Cuenta lo que espera una acción MÍA, en mis sucursales:
//   * abiertas o tomadas asignadas a mí;
//   * abiertas asignadas a mi rol (si alguien del rol ya la tomó, deja de contar para el resto);
//   * las que tomé yo (aunque estuvieran asignadas a otra persona o rol).
// «Vencidas» = de esas, las que tienen vencimiento pasado (la interfaz las resalta).
import type { Route } from "../../lib/http.js";
import { allowedBranches } from "../../lib/rbac.js";

export function taskCountRoutes(route: Route) {
  route({
    method: "GET", url: "/api/tasks/pending-count",
    summary: "Cuántas tareas esperan una acción mía (asignadas a mí, a mi rol sin tomar, o tomadas por mí) y cuántas están vencidas",
    tags: ["tareas"], perm: "tasks.use",
    handler: async ({ c, auth }) => {
      const r = (await c.query<{ total: number; overdue: number }>(
        `SELECT count(*)::int AS total, count(*) FILTER (WHERE t.due_at IS NOT NULL AND t.due_at < now())::int AS overdue
           FROM staff_tasks t
          WHERE t.status IN ('open','taken')
            AND ($1::uuid[] IS NULL OR t.branch_id = ANY($1))
            AND (t.assignee_user_id = $2
                 OR t.taken_by = $2
                 OR (t.assignee_role = $3 AND t.status = 'open'))`,
        [allowedBranches(auth), auth.userId, auth.membership!.role])).rows[0]!;
      return { total: r.total, overdue: r.overdue };
    },
  });
}
