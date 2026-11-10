// Tipos de cita configurables por clínica (R2-19): nombre, color, duración por defecto,
// prestación sugerida y activo. Al abrir la agenda por primera vez la clínica recibe los
// seis tipos sugeridos; luego cada clínica los ajusta (no se borran, se desactivan).
import { z } from "zod";
import type { Route } from "../lib/http.js";
import { zId, zIdParams } from "../lib/http.js";
import { badRequest, conflict, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";

export const DEFAULT_APPOINTMENT_TYPES: { name: string; color: string; minutes: number; procedureCode: string | null }[] = [
  { name: "Primera vez", color: "#2563eb", minutes: 45, procedureCode: "CON-01" },
  { name: "Control", color: "#0e8a7e", minutes: 30, procedureCode: null },
  { name: "Urgencia", color: "#dc2626", minutes: 30, procedureCode: null },
  { name: "Ortodoncia", color: "#7c3aed", minutes: 30, procedureCode: "ORT-01" },
  { name: "Cirugía", color: "#c2410c", minutes: 60, procedureCode: "CIR-01" },
  { name: "Higiene", color: "#0891b2", minutes: 45, procedureCode: "PRE-01" },
];

/** Crea los tipos sugeridos si la clínica todavía no tiene ninguno (idempotente). */
export async function ensureDefaultTypes(c: Client, clinicId: string): Promise<void> {
  const has = await c.query("SELECT 1 FROM appointment_types WHERE clinic_id = $1 LIMIT 1", [clinicId]);
  if (has.rowCount) return;
  let pos = 0;
  for (const t of DEFAULT_APPOINTMENT_TYPES) {
    await c.query(
      `INSERT INTO appointment_types (clinic_id, name, color, default_duration_min, procedure_id, position)
       VALUES ($1, $2, $3, $4, (SELECT id FROM procedures WHERE clinic_id = $1 AND code = $5), $6)
       ON CONFLICT DO NOTHING`,
      [clinicId, t.name, t.color, t.minutes, t.procedureCode, ++pos],
    );
  }
}

const TYPE_COLUMNS = `t.id, t.name, t.color, t.default_duration_min AS "defaultDurationMin", t.procedure_id AS "procedureId",
  p.name AS "procedureName", t.active, t.position`;

/**
 * Valores por defecto que aporta el tipo al agendar: duración (si no se indicó) y prestación
 * sugerida (si no se indicó). Rechaza tipos inexistentes (o de otra clínica: RLS) o inactivos.
 */
export async function appointmentTypeDefaults(
  c: Client,
  b: { appointmentTypeId?: string | null; durationMin?: number; endsAt?: string; procedureId: string | null },
): Promise<{ durationMin?: number; procedureId: string | null }> {
  if (!b.appointmentTypeId) return { durationMin: b.durationMin, procedureId: b.procedureId };
  const t = (await c.query<{ active: boolean; default_duration_min: number; procedure_id: string | null }>(
    "SELECT active, default_duration_min, procedure_id FROM appointment_types WHERE id = $1", [b.appointmentTypeId])).rows[0];
  if (!t) throw badRequest("El tipo de cita no existe");
  if (!t.active) throw badRequest("El tipo de cita está desactivado");
  return {
    durationMin: b.durationMin ?? (b.endsAt ? undefined : t.default_duration_min),
    procedureId: b.procedureId ?? t.procedure_id,
  };
}

const zColor = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Color inválido (formato #RRGGBB)");
const typeBody = z.object({
  name: z.string().trim().min(2, "El nombre debe tener al menos 2 caracteres").max(60, "El nombre admite hasta 60 caracteres"),
  color: zColor,
  defaultDurationMin: z.number().int("La duración debe ser un número entero de minutos").min(5, "La duración mínima es 5 minutos").max(480, "La duración máxima es 480 minutos"),
  procedureId: zId.nullish().transform((v) => v ?? null),
  active: z.boolean().default(true),
  position: z.number().int().min(0).max(999).optional(),
});

async function assertNameFree(c: Client, name: string, exceptId: string | null) {
  const dup = await c.query("SELECT 1 FROM appointment_types WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2)", [name, exceptId]);
  if (dup.rowCount) throw conflict("Ya existe un tipo de cita con ese nombre", "duplicate_name");
}

async function assertProcedure(c: Client, procedureId: string | null) {
  if (!procedureId) return;
  const p = await c.query("SELECT 1 FROM procedures WHERE id = $1", [procedureId]);
  if (!p.rowCount) throw badRequest("La prestación sugerida no existe");
}

export function appointmentTypeRoutes(route: Route) {
  route({
    method: "GET", url: "/api/appointment-types", summary: "Tipos de cita de la clínica (activos; all=1 incluye los desactivados)", tags: ["agenda"], perm: "agenda.read",
    query: z.object({ all: z.enum(["1", "0"]).optional() }),
    handler: async ({ c, auth, query }) => {
      await ensureDefaultTypes(c, auth.clinicId!);
      return (await c.query(
        `SELECT ${TYPE_COLUMNS} FROM appointment_types t LEFT JOIN procedures p ON p.id = t.procedure_id
          WHERE ($1::boolean OR t.active) ORDER BY t.position, t.name`, [query.all === "1"])).rows;
    },
  });

  route({
    method: "POST", url: "/api/appointment-types", summary: "Crear un tipo de cita", tags: ["agenda"], perm: "clinic.manage", body: typeBody,
    handler: async ({ c, auth, body }) => {
      await assertNameFree(c, body.name, null);
      await assertProcedure(c, body.procedureId);
      const pos = body.position ?? (await c.query<{ n: number }>("SELECT COALESCE(max(position), 0) + 1 AS n FROM appointment_types")).rows[0]!.n;
      const r = await c.query<{ id: string }>(
        `INSERT INTO appointment_types (clinic_id, name, color, default_duration_min, procedure_id, active, position, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [auth.clinicId, body.name, body.color, body.defaultDurationMin, body.procedureId, body.active, pos, auth.userId],
      );
      const id = r.rows[0]!.id;
      await audit(c, auth, "appointment_type.created", "appointment_type", id, { name: body.name, color: body.color, defaultDurationMin: body.defaultDurationMin });
      return { id };
    },
  });

  route({
    method: "PUT", url: "/api/appointment-types/:id", summary: "Editar un tipo de cita (o desactivarlo: no se borra)", tags: ["agenda"], perm: "clinic.manage",
    params: zIdParams, body: typeBody,
    handler: async ({ c, auth, params, body }) => {
      const cur = (await c.query("SELECT name, color, default_duration_min, procedure_id, active, position FROM appointment_types WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!cur) throw notFound("Tipo de cita");
      await assertNameFree(c, body.name, params.id);
      await assertProcedure(c, body.procedureId);
      await c.query(
        `UPDATE appointment_types SET name = $2, color = $3, default_duration_min = $4, procedure_id = $5, active = $6,
                position = COALESCE($7, position), updated_at = now() WHERE id = $1`,
        [params.id, body.name, body.color, body.defaultDurationMin, body.procedureId, body.active, body.position ?? null],
      );
      await audit(c, auth, "appointment_type.updated", "appointment_type", params.id, { from: cur, to: body });
      return { ok: true };
    },
  });
}

/** Demo: tipos sugeridos y tipo de las citas ficticias según su prestación. Solo para la semilla. */
export async function seedAppointmentTypesDemo(c: Client, clinicId: string) {
  await ensureDefaultTypes(c, clinicId);
  await c.query(
    `UPDATE appointments a SET appointment_type_id = t.id
       FROM procedures p, appointment_types t
      WHERE a.clinic_id = $1 AND p.id = a.procedure_id AND t.clinic_id = a.clinic_id AND a.appointment_type_id IS NULL
        AND t.name = CASE WHEN p.code = 'CON-01' THEN 'Primera vez' WHEN p.code = 'ORT-01' THEN 'Ortodoncia'
                          WHEN p.code LIKE 'CIR-%' THEN 'Cirugía' WHEN p.code IN ('PRE-01','PRE-02','PER-01') THEN 'Higiene' ELSE 'Control' END`,
    [clinicId],
  );
}
