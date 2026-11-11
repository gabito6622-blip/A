// Bandeja de respuestas de los pacientes para recepción (B-070).
//
// Las respuestas por WhatsApp que no son «BAJA» llegan a inbound_messages con la sucursal del
// mensaje original (0025). Recepción las ve solo de sus sucursales (las que no tienen sucursal, solo
// quien ve todas), las marca «atendida» (con nota opcional) o las reabre. Cada cambio es un evento
// de solo inserción (inbound_message_events, 0029): el estado es el último evento.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zIdParams, zOptText } from "../../lib/http.js";
import { AppError, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { allowedBranches } from "../../lib/rbac.js";
import type { Client } from "../../lib/db.js";

const STATE = `LEFT JOIN LATERAL (SELECT e.kind, e.note, e.created_at, e.user_id FROM inbound_message_events e
                 WHERE e.message_id = i.id ORDER BY e.created_at DESC, e.id DESC LIMIT 1) ev ON true`;
const VISIBLE = `i.kind = 'other' AND ($1::uuid[] IS NULL OR i.branch_id = ANY($1))`;

async function loadReply(c: Client, id: string, allowed: string[] | null) {
  const r = (await c.query<{ id: string; branch_id: string | null; handled: boolean }>(
    `SELECT i.id, i.branch_id, (ev.kind IS NOT DISTINCT FROM 'handled') AS handled FROM inbound_messages i ${STATE}
      WHERE i.id = $2 AND ${VISIBLE}`, [allowed, id])).rows[0];
  if (!r) throw notFound("Respuesta");
  return r;
}

export function messagingReplyRoutes(route: Route) {
  route({
    method: "GET", url: "/api/messaging/replies",
    summary: "Respuestas de los pacientes (no «BAJA») de las sucursales permitidas, pendientes o atendidas", tags: ["mensajes"], perm: "patients.read",
    query: z.object({ status: z.enum(["pending", "handled", "all"]).default("pending"), limit: z.coerce.number().int().min(1).max(200).default(100) }),
    handler: async ({ c, auth, query }) => (await c.query(
      `SELECT i.id, i.body, i.sender, i.created_at AS "createdAt", i.patient_id AS "patientId",
              p.first_name || ' ' || p.last_name AS "patientName", b.name AS "branchName",
              (ev.kind IS NOT DISTINCT FROM 'handled') AS handled,
              CASE WHEN ev.kind = 'handled' THEN ev.created_at END AS "handledAt",
              CASE WHEN ev.kind = 'handled' THEN u.full_name END AS "handledBy",
              CASE WHEN ev.kind = 'handled' THEN ev.note END AS "handledNote"
         FROM inbound_messages i ${STATE}
         LEFT JOIN patients p ON p.id = i.patient_id LEFT JOIN branches b ON b.id = i.branch_id LEFT JOIN users u ON u.id = ev.user_id
        WHERE ${VISIBLE} AND ($2 = 'all' OR ($2 = 'handled') = (ev.kind IS NOT DISTINCT FROM 'handled'))
        ORDER BY i.created_at DESC LIMIT $3`,
      [allowedBranches(auth), query.status, query.limit])).rows,
  });

  route({
    method: "GET", url: "/api/messaging/replies/count", summary: "Cantidad de respuestas pendientes de atender (para el menú)", tags: ["mensajes"], perm: "patients.read",
    handler: async ({ c, auth }) => (await c.query<{ pending: number }>(
      `SELECT count(*)::int AS pending FROM inbound_messages i ${STATE} WHERE ${VISIBLE} AND ev.kind IS DISTINCT FROM 'handled'`,
      [allowedBranches(auth)])).rows[0]!,
  });

  for (const action of ["handled", "reopen"] as const) {
    route({
      method: "POST", url: `/api/messaging/replies/:id/${action}`,
      summary: action === "handled" ? "Marcar una respuesta como atendida (con nota opcional)" : "Volver a dejar pendiente una respuesta atendida",
      tags: ["mensajes"], perm: "patients.write", params: zIdParams,
      body: z.object({ note: zOptText(300) }),
      handler: async ({ c, auth, params, body }) => {
        const r = await loadReply(c, params.id, allowedBranches(auth));
        if (action === "handled" && r.handled) throw new AppError(409, "already_handled", "Esta respuesta ya estaba atendida");
        if (action === "reopen" && !r.handled) throw new AppError(409, "not_handled", "Esta respuesta ya está pendiente");
        await c.query("INSERT INTO inbound_message_events (clinic_id, message_id, kind, note, user_id) VALUES ($1,$2,$3,$4,$5)",
          [auth.clinicId, params.id, action === "handled" ? "handled" : "reopened", body.note, auth.userId]);
        await audit(c, auth, action === "handled" ? "inbound_message.handled" : "inbound_message.reopened", "inbound_message", params.id, { note: body.note }, r.branch_id);
        return { ok: true };
      },
    });
  }
}
