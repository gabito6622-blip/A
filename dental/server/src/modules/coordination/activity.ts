// Diario de actividad del personal (R2-37): quién hizo qué y cuándo, en lenguaje claro.
//
//  * No duplica datos: se construye sobre `audit_log` (de solo inserción, nadie puede borrarla) con
//    el diccionario de `phrases.ts`.
//  * De `data` solo sale de la base una lista blanca de campos estructurados; textos libres y datos
//    clínicos nunca llegan a la frase ni a la respuesta.
//  * Orden por fecha y, a igual fecha, por id. Paginación por cursor (fecha con microsegundos + id):
//    estable aunque se sigan agregando filas mientras se navega, y rápida con decenas de miles de
//    filas (índice clinic_id, created_at DESC, id DESC).
//  * Sucursal: quien tiene acceso a todas ve todo; quien tiene acceso limitado ve las filas de sus
//    sucursales y las que no son de una sucursal (acciones de la clínica).
import { z } from "zod";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import type { Route } from "../../lib/http.js";
import { zDate, zId } from "../../lib/http.js";
import { badRequest } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { Client } from "../../lib/db.js";
import { allowedBranches, requireBranch, ROLE_LABELS, type AuthCtx, type Role } from "../../lib/rbac.js";
import { dayBounds } from "../../lib/slots.js";
import { clinicZone } from "../agenda.js";
import { ACTIVITY_TYPES, KNOWN_PREFIXES, phrase, prefixesOf, typeOfAction, type ActivityType } from "./phrases.js";
import { xlsxBuffer } from "../../lib/xlsxSafe.js";

const UUID_RE = "^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$";
/** Campos de `data` que pueden salir de la base (estructurados, nunca texto libre ni clínico). */
const SAFE_KEYS = ["amountCents", "method", "from", "to", "number", "role", "count", "decision", "outcome", "receipt",
  "assignee", "priority", "startsAt", "differenceCents", "durationMin"];
const SAFE_DATA = `jsonb_strip_nulls(jsonb_build_object(${SAFE_KEYS.map((k) => `'${k}', a.data->'${k}'`).join(", ")}))`;

/** Paciente de la fila según la entidad auditada (o el patientId de los datos). */
const PATIENT_OF = `COALESCE(CASE
    WHEN pg.eid IS NULL THEN NULL
    WHEN pg.entity = 'patient' THEN pg.eid
    WHEN pg.entity = 'payment' THEN (SELECT x.patient_id FROM payments x WHERE x.id = pg.eid)
    WHEN pg.entity = 'appointment' THEN (SELECT x.patient_id FROM appointments x WHERE x.id = pg.eid)
    WHEN pg.entity = 'budget' THEN (SELECT x.patient_id FROM budgets x WHERE x.id = pg.eid)
    WHEN pg.entity = 'budget_item' THEN (SELECT bu.patient_id FROM budget_items x JOIN budgets bu ON bu.id = x.budget_id WHERE x.id = pg.eid)
    WHEN pg.entity = 'charge' THEN (SELECT x.patient_id FROM charges x WHERE x.id = pg.eid)
    WHEN pg.entity = 'recall' THEN (SELECT x.patient_id FROM recalls x WHERE x.id = pg.eid)
    WHEN pg.entity = 'waitlist' THEN (SELECT x.patient_id FROM waitlist_entries x WHERE x.id = pg.eid)
    WHEN pg.entity = 'lab_order' THEN (SELECT x.patient_id FROM lab_orders x WHERE x.id = pg.eid)
    WHEN pg.entity = 'task' THEN (SELECT x.patient_id FROM staff_tasks x WHERE x.id = pg.eid)
    WHEN pg.entity = 'perio_exam' THEN (SELECT x.patient_id FROM perio_exams x WHERE x.id = pg.eid)
    WHEN pg.entity = 'clinical_document' THEN (SELECT x.patient_id FROM clinical_documents x WHERE x.id = pg.eid)
  END, pg.data_pid)`;

export const activityQuery = z.object({
  userId: zId.optional(),
  branchId: zId.optional(),
  type: z.enum(Object.keys(ACTIVITY_TYPES) as [ActivityType, ...ActivityType[]]).optional(),
  from: zDate.optional(),
  to: zDate.optional(),
});
type ActivityFilters = z.infer<typeof activityQuery>;

const zCursor = z.string().max(80).regex(/^[A-Za-z0-9_-]+$/, "Cursor inválido");
const encodeCursor = (atKey: string, id: string) => Buffer.from(`${atKey}|${id}`, "utf8").toString("base64url");
function decodeCursor(s: string): [string, string] {
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|(\d{1,18})$/.exec(Buffer.from(s, "base64url").toString("utf8"));
  if (!m) throw badRequest("Cursor inválido");
  return [m[1]!, m[2]!];
}

interface ActivityRow {
  id: string; created_at: Date; at_key: string; user_id: string | null; action: string; branch_id: string | null; d: Record<string, any>;
  actor_name: string | null; actor_role: Role | null; branch_name: string | null; target_name: string | null; patient_short: string | null;
}

/** Filas del diario (más recientes primero) con la frase ya armada. */
export async function activityRows(c: Client, auth: AuthCtx, f: ActivityFilters, opts: { cursor?: string | null; limit: number }) {
  if (f.branchId) requireBranch(auth, f.branchId);
  const zone = await clinicZone(c, auth.clinicId!);
  if (f.from && f.to && f.from > f.to) throw badRequest("from: la fecha inicial es posterior a la final");
  const fromTs = f.from ? dayBounds(f.from, zone)[0] : null;
  const toTs = f.to ? dayBounds(f.to, zone)[1] : null;
  const prefixes = f.type ? prefixesOf(f.type) : null;
  const cur = opts.cursor ? decodeCursor(opts.cursor) : null;
  const rows = (await c.query<ActivityRow>(
    `WITH pg AS (
       SELECT a.id, a.created_at, a.user_id, a.action, a.entity, a.branch_id, ${SAFE_DATA} AS d,
              CASE WHEN a.entity_id ~ '${UUID_RE}' THEN a.entity_id::uuid END AS eid,
              CASE WHEN a.data->>'patientId' ~ '${UUID_RE}' THEN (a.data->>'patientId')::uuid END AS data_pid
         FROM audit_log a
        WHERE a.clinic_id = $1
          AND ($2::timestamptz IS NULL OR (a.created_at, a.id) < ($2::timestamptz, $13::bigint))
          AND ($3::uuid IS NULL OR a.user_id = $3)
          AND ($4::uuid IS NULL OR a.branch_id = $4)
          AND ($5::uuid[] IS NULL OR a.branch_id IS NULL OR a.branch_id = ANY($5))
          AND ($6::text[] IS NULL OR split_part(a.action, '.', 1) = ANY($6)
               OR ($7::boolean AND NOT split_part(a.action, '.', 1) = ANY($8::text[])))
          AND ($9::timestamptz IS NULL OR a.created_at >= $9) AND ($10::timestamptz IS NULL OR a.created_at < $10)
        ORDER BY a.created_at DESC, a.id DESC
        LIMIT $11
     )
     SELECT pg.id::text AS id, pg.created_at, to_char(pg.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_key, pg.user_id, pg.action, pg.branch_id, pg.d,
            u.full_name AS actor_name, m.role AS actor_role, b.name AS branch_name,
            (SELECT tu.full_name FROM users tu WHERE pg.entity = 'user' AND tu.id = pg.eid) AS target_name,
            CASE WHEN $12::boolean THEN pt.first_name || ' ' || left(pt.last_name, 1) || '.' END AS patient_short
       FROM pg LEFT JOIN users u ON u.id = pg.user_id LEFT JOIN branches b ON b.id = pg.branch_id
       LEFT JOIN memberships m ON m.clinic_id = $1 AND m.user_id = pg.user_id
       -- El paciente se resuelve primero y luego se une por su clave (con 100 000 pacientes, la
       -- subconsulta «WHERE p.id = COALESCE(CASE …)» recorría la tabla completa por cada fila).
       LEFT JOIN LATERAL (SELECT ${PATIENT_OF} AS pid) px ON $12::boolean
       LEFT JOIN patients pt ON pt.id = px.pid
      ORDER BY pg.created_at DESC, pg.id DESC`,
    [auth.clinicId, cur?.[0] ?? null, f.userId ?? null, f.branchId ?? null, allowedBranches(auth),
      prefixes, f.type === "other", KNOWN_PREFIXES, fromTs, toTs, opts.limit, auth.permissions.has("patients.read"), cur?.[1] ?? null],
  )).rows;
  return rows.map((r) => {
    const actor = r.actor_name ? r.actor_name.replace(/\s*\([^)]*\)\s*$/, "") : r.action.startsWith("portal.") ? "El paciente (portal)" : "El sistema";
    const type = typeOfAction(r.action);
    const at = DateTime.fromJSDate(r.created_at, { zone });
    return {
      id: r.id, atKey: r.at_key, at: r.created_at.toISOString(), local: at.toFormat("dd/MM/yyyy HH:mm"), date: at.toISODate(), time: at.toFormat("HH:mm"),
      userId: r.user_id, actorName: r.actor_name, actorRole: r.actor_role ? ROLE_LABELS[r.actor_role] : null,
      branchName: r.branch_name, type, typeLabel: ACTIVITY_TYPES[type], action: r.action,
      phrase: phrase(r.action, { actor, patient: r.patient_short, target: r.target_name, d: r.d ?? {}, zone }),
    };
  });
}

export function activityRoutes(route: Route) {
  route({
    method: "GET", url: "/api/activity",
    summary: "Diario de actividad del personal en lenguaje claro (sobre la auditoría): filtros por persona, sucursal, tipo y fechas; paginado por cursor",
    tags: ["auditoría"], perm: "audit.read",
    query: activityQuery.extend({ cursor: zCursor.optional(), limit: z.coerce.number().int().min(1).max(200).default(50) }),
    handler: async ({ c, auth, query }) => {
      const rows = await activityRows(c, auth, query, { cursor: query.cursor, limit: query.limit + 1 });
      const items = rows.slice(0, query.limit);
      const last = items[items.length - 1];
      return { items, nextCursor: rows.length > query.limit && last ? encodeCursor(last.atKey, last.id) : null };
    },
  });

  route({
    method: "GET", url: "/api/activity/options", summary: "Personas, sucursales y tipos para filtrar el diario de actividad", tags: ["auditoría"], perm: "audit.read",
    handler: async ({ c, auth }) => {
      const people = (await c.query<{ userId: string; fullName: string; role: Role; active: boolean }>(
        `SELECT m.user_id AS "userId", u.full_name AS "fullName", m.role, m.active
           FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.clinic_id = $1 ORDER BY u.full_name`, [auth.clinicId])).rows;
      const allowed = allowedBranches(auth);
      const branches = (await c.query<{ id: string; name: string }>(
        "SELECT id, name FROM branches WHERE ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY name", [allowed])).rows;
      return {
        people: people.map((p) => ({ ...p, roleLabel: ROLE_LABELS[p.role] })),
        branches,
        types: Object.entries(ACTIVITY_TYPES).map(([id, label]) => ({ id, label })),
      };
    },
  });

  route({
    method: "GET", url: "/api/activity.xlsx", summary: "Exportar el diario de actividad a Excel con los mismos filtros (hasta 20 000 filas)", tags: ["auditoría"],
    perm: "audit.read", raw: true, query: activityQuery,
    handler: async ({ c, auth, query, reply }) => {
      const MAX = 20_000;
      const rows = await activityRows(c, auth, query, { limit: MAX + 1 });
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Actividad");
      ws.columns = [
        { header: "Fecha", key: "date", width: 12 }, { header: "Hora", key: "time", width: 8 }, { header: "Persona", key: "actorName", width: 28 },
        { header: "Rol", key: "actorRole", width: 16 }, { header: "Sucursal", key: "branchName", width: 18 }, { header: "Tipo", key: "typeLabel", width: 22 },
        { header: "Qué hizo", key: "phrase", width: 80 },
      ];
      ws.getRow(1).font = { bold: true };
      // Evita inyección de fórmulas al abrir en Excel.
      const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v ?? "");
      for (const r of rows.slice(0, MAX)) {
        ws.addRow({ date: r.date, time: r.time, actorName: safe(r.actorName ?? "El sistema"), actorRole: safe(r.actorRole), branchName: safe(r.branchName), typeLabel: r.typeLabel, phrase: safe(r.phrase) });
      }
      if (rows.length > MAX) ws.addRow({ phrase: `Se exportaron las ${MAX.toLocaleString("es-BO")} filas más recientes. Usa los filtros de fecha para exportar el resto.` });
      await audit(c, auth, "activity.exported", "audit_log", null, { count: Math.min(rows.length, MAX), filters: query });
      reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="actividad-${DateTime.now().toISODate()}.xlsx"`)
        .send(await xlsxBuffer(wb));
    },
  });
}
