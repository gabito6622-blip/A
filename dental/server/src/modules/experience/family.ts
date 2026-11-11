// Relaciones familiares entre pacientes (R2-39): tutor/madre/padre ↔ hijo/a, cónyuge, hermano/a, otro.
//
//  * Una sola fila por par (la base impide el duplicado aunque se declare al revés).
//  * El tutor legal de un paciente es único; al marcarlo se copian su nombre y celular a los campos
//    «responsable» de la ficha (guardian_*), que ya usan el portal, los recordatorios y el enlace
//    del presupuesto. Así se extiende lo existente en lugar de duplicarlo.
//  * Tarjeta «Familia»: saldos con patient_money() (solo con permiso de cobros o presupuestos) y
//    próximas citas (solo con permiso de agenda).
//  * Agendar a varios miembros seguidos (hermanos): una transacción, todo o nada, con las mismas
//    validaciones de la agenda (horario, sucursal, solapes por restricción EXCLUDE).
import { z } from "zod";
import { DateTime } from "luxon";
import type { Client } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import { zDate, zId, zIdParams } from "../../lib/http.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { assertBookable, clinicZone, dayAvailability } from "../agenda.js";
import { recordAppointmentEvent } from "../appointmentEvents.js";
import { patientMoney } from "../budgets-v2-core.js";

const TAGS = ["familia"];

export const RELATIONS = ["mother", "father", "guardian", "child", "spouse", "sibling", "other"] as const;
export type Relation = (typeof RELATIONS)[number];
export const RELATION_LABELS: Record<Relation, string> = {
  mother: "Madre", father: "Padre", guardian: "Tutor/a", child: "Hijo/a", spouse: "Cónyuge", sibling: "Hermano/a", other: "Otro familiar",
};
const PARENT_LABEL: Record<string, string> = { madre: "Madre", padre: "Padre", tutor: "Tutor/a" };

export interface RelRow { id: string; person_a: string; person_b: string; kind: "parent" | "spouse" | "sibling" | "other"; parent_label: string | null; other_label: string | null; legal_guardian: boolean }

/** Cómo se llama al otro miembro desde el punto de vista de `me`. */
export function relationLabel(r: Pick<RelRow, "person_a" | "kind" | "parent_label" | "other_label">, me: string): string {
  switch (r.kind) {
    case "parent": return r.person_a === me ? "Hijo/a" : (r.parent_label ? PARENT_LABEL[r.parent_label]! : "Madre/padre");
    case "spouse": return "Cónyuge";
    case "sibling": return "Hermano/a";
    default: return r.other_label ? r.other_label.charAt(0).toUpperCase() + r.other_label.slice(1) : "Otro familiar";
  }
}

/** Convierte «el familiar es [relación] del paciente» en una fila canónica (a, b, kind, etiqueta). */
export function canonical(patientId: string, relatedId: string, relation: Relation, patientSex: string | null, otherLabel: string | null) {
  switch (relation) {
    case "mother": case "father": case "guardian":
      return { a: relatedId, b: patientId, kind: "parent" as const, parentLabel: relation === "mother" ? "madre" : relation === "father" ? "padre" : "tutor", otherLabel: null };
    case "child":
      return { a: patientId, b: relatedId, kind: "parent" as const, parentLabel: patientSex === "F" ? "madre" : patientSex === "M" ? "padre" : null, otherLabel: null };
    case "spouse": return { a: patientId, b: relatedId, kind: "spouse" as const, parentLabel: null, otherLabel: null };
    case "sibling": return { a: patientId, b: relatedId, kind: "sibling" as const, parentLabel: null, otherLabel: null };
    default: return { a: patientId, b: relatedId, kind: "other" as const, parentLabel: null, otherLabel };
  }
}

const ageOf = (birth: string | null, zone = "America/La_Paz") => {
  if (!birth) return null;
  return Math.floor(DateTime.now().setZone(zone).diff(DateTime.fromISO(birth, { zone }), "years").years);
};

export const zFamilyLink = z.object({
  relatedPatientId: zId,
  relation: z.enum(RELATIONS, { message: "Elige la relación" }),
  otherLabel: z.string().trim().max(40).nullish().transform((v) => (v ? v : null)),
  legalGuardian: z.boolean().default(false),
});
export type FamilyLink = z.infer<typeof zFamilyLink>;

/** Copia nombre y celular del tutor legal a los campos «responsable» del paciente a su cargo. */
async function syncGuardianFields(c: Client, guardianId: string, wardId: string, label: string | null) {
  await c.query(
    `UPDATE patients w SET guardian_name = g.first_name || ' ' || g.last_name, guardian_phone = COALESCE(g.phone, w.guardian_phone),
            guardian_relationship = $3, updated_at = now()
       FROM patients g WHERE g.id = $1 AND w.id = $2`,
    [guardianId, wardId, label ? PARENT_LABEL[label] ?? "Tutor/a" : "Tutor/a"]);
}

/**
 * Crea una relación (usada por la ficha y al registrar a un familiar con el mismo celular).
 * Valida existencia, que no exista ya el par (en cualquier sentido), un solo tutor legal y fechas coherentes.
 */
export async function createRelationship(c: Client, auth: AuthCtx, patientId: string, link: FamilyLink) {
  if (patientId === link.relatedPatientId) throw badRequest("Elige a otro paciente: una persona no puede ser familiar de sí misma");
  const ps = (await c.query<{ id: string; sex: string | null; birth_date: string | null; first_name: string; archived_at: Date | null }>(
    "SELECT id, sex, birth_date, first_name, archived_at FROM patients WHERE id = ANY($1::uuid[])", [[patientId, link.relatedPatientId]])).rows;
  const me = ps.find((p) => p.id === patientId);
  const other = ps.find((p) => p.id === link.relatedPatientId);
  if (!me) throw notFound("Paciente");
  if (!other) throw notFound("Familiar");
  if (other.archived_at) throw badRequest("Ese paciente está archivado");
  if (link.relation === "other" && !link.otherLabel) throw new AppError(400, "validation", "Escribe el parentesco (por ejemplo: abuela, tío)", [{ path: "otherLabel", message: "Escribe el parentesco (por ejemplo: abuela, tío)" }]);
  const k = canonical(patientId, link.relatedPatientId, link.relation, me.sex, link.otherLabel);
  if (link.legalGuardian && k.kind !== "parent") throw badRequest("Solo una madre, un padre o un tutor puede ser tutor legal");
  if (k.kind === "parent") {
    const parent = k.a === patientId ? me : other, child = k.a === patientId ? other : me;
    if (parent.birth_date && child.birth_date && parent.birth_date >= child.birth_date) {
      throw badRequest(`Las fechas de nacimiento no cuadran: ${parent.first_name} no puede ser madre, padre o tutor de alguien mayor`);
    }
  }
  const existing = (await c.query<RelRow>(
    "SELECT * FROM patient_relationships WHERE ended_at IS NULL AND least(person_a, person_b) = least($1::uuid, $2::uuid) AND greatest(person_a, person_b) = greatest($1::uuid, $2::uuid)",
    [patientId, link.relatedPatientId])).rows[0];
  if (existing) throw conflict(`Ya están vinculados como «${relationLabel(existing, patientId)}». Cierra esa relación si necesitas cambiarla.`, "duplicate_relationship");
  if (link.legalGuardian) {
    const g = (await c.query("SELECT 1 FROM patient_relationships WHERE person_b = $1 AND legal_guardian AND ended_at IS NULL", [k.b])).rowCount;
    if (g) throw conflict("Ese paciente ya tiene un tutor legal. Quita la marca del actual antes de elegir otro.", "guardian_exists");
  }
  const r = await c.query<{ id: string }>(
    `INSERT INTO patient_relationships (clinic_id, person_a, person_b, kind, parent_label, other_label, legal_guardian, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
    [auth.clinicId, k.a, k.b, k.kind, k.parentLabel, k.otherLabel, link.legalGuardian, auth.userId]);
  const id = r.rows[0]!.id;
  if (link.legalGuardian) await syncGuardianFields(c, k.a, k.b, k.parentLabel);
  await audit(c, auth, "patient.relationship_added", "patient", patientId,
    { relationshipId: id, relatedPatientId: link.relatedPatientId, relation: link.relation, legalGuardian: link.legalGuardian });
  return { id };
}

/**
 * Al registrar a un menor junto con su madre, padre o tutor (ya paciente), completa los datos del
 * responsable de la ficha con los del familiar si no se escribieron.
 */
export async function prefillGuardian(c: Client, body: { family?: FamilyLink; guardianName: string | null; guardianPhone: string | null; guardianRelationship: string | null }) {
  const f = body.family;
  if (!f || !["mother", "father", "guardian"].includes(f.relation) || body.guardianName) return;
  const g = (await c.query<{ name: string; phone: string | null }>("SELECT first_name || ' ' || last_name AS name, phone FROM patients WHERE id = $1", [f.relatedPatientId])).rows[0];
  if (!g) return;
  body.guardianName = g.name;
  body.guardianPhone = body.guardianPhone ?? g.phone;
  body.guardianRelationship = body.guardianRelationship ?? RELATION_LABELS[f.relation];
}

interface Member {
  patientId: string; name: string; recordNumber: number; birthDate: string | null; age: number | null; isMinor: boolean; phone: string | null;
  relation: string; relationshipId: string | null; derived: boolean; isLegalGuardian: boolean; isWard: boolean; samePhone: boolean;
  balanceCents?: number; pendingVerificationCents?: number; nextAppointment?: { startsAt: string; branchName: string; dentistName: string; status: string } | null;
}

export async function familyMembers(c: Client, auth: AuthCtx, patientId: string): Promise<Member[]> {
  const me = (await c.query<{ phone: string | null }>("SELECT phone FROM patients WHERE id = $1", [patientId])).rows[0];
  if (!me) throw notFound("Paciente");
  const direct = (await c.query<RelRow>(
    "SELECT * FROM patient_relationships WHERE ended_at IS NULL AND (person_a = $1 OR person_b = $1) ORDER BY created_at", [patientId])).rows;
  // Hermanos por una madre, padre o tutor en común (aunque no se hayan declarado entre sí).
  const siblings = (await c.query<{ id: string }>(
    `SELECT DISTINCT s.person_b AS id FROM patient_relationships mine JOIN patient_relationships s ON s.person_a = mine.person_a AND s.kind = 'parent' AND s.ended_at IS NULL
      WHERE mine.person_b = $1 AND mine.kind = 'parent' AND mine.ended_at IS NULL AND s.person_b <> $1`, [patientId])).rows.map((r) => r.id);
  const entries = new Map<string, Pick<Member, "relation" | "relationshipId" | "derived" | "isLegalGuardian" | "isWard">>();
  for (const r of direct) {
    const other = r.person_a === patientId ? r.person_b : r.person_a;
    entries.set(other, {
      relation: relationLabel(r, patientId), relationshipId: r.id, derived: false,
      isLegalGuardian: r.legal_guardian && r.person_b === patientId, isWard: r.legal_guardian && r.person_a === patientId,
    });
  }
  for (const s of siblings) if (!entries.has(s)) entries.set(s, { relation: "Hermano/a", relationshipId: null, derived: true, isLegalGuardian: false, isWard: false });
  if (!entries.size) return [];
  const rows = (await c.query<{ id: string; first_name: string; last_name: string; record_number: number; birth_date: string | null; phone: string | null; archived_at: Date | null }>(
    "SELECT id, first_name, last_name, record_number, birth_date, phone, archived_at FROM patients WHERE id = ANY($1::uuid[])", [[...entries.keys()]])).rows;
  const money = auth.permissions.has("payments.read") || auth.permissions.has("budgets.read");
  const agenda = auth.permissions.has("agenda.read");
  const out: Member[] = [];
  for (const p of rows) {
    if (p.archived_at) continue;
    const e = entries.get(p.id)!;
    const age = ageOf(p.birth_date);
    const m: Member = {
      patientId: p.id, name: `${p.first_name} ${p.last_name}`, recordNumber: p.record_number, birthDate: p.birth_date, age, isMinor: age !== null && age < 18,
      phone: p.phone, samePhone: !!p.phone && p.phone === me.phone, ...e,
    };
    if (money) {
      const pm = await patientMoney(c, p.id);
      m.balanceCents = pm.balanceCents;
      m.pendingVerificationCents = pm.pendingVerificationCents;
    }
    if (agenda) {
      m.nextAppointment = (await c.query(
        `SELECT a.starts_at AS "startsAt", b.name AS "branchName", u.full_name AS "dentistName", a.status
           FROM appointments a JOIN branches b ON b.id = a.branch_id JOIN users u ON u.id = a.dentist_id
          WHERE a.patient_id = $1 AND a.starts_at > now() AND a.status NOT IN ('cancelled','no_show','completed') ORDER BY a.starts_at LIMIT 1`, [p.id])).rows[0] ?? null;
    }
    out.push(m);
  }
  const order = (m: Member) => (m.isLegalGuardian ? 0 : m.relation === "Madre" || m.relation === "Padre" || m.relation === "Madre/padre" || m.relation === "Tutor/a" ? 1 : m.relation === "Cónyuge" ? 2 : m.relation === "Hijo/a" ? 3 : m.relation === "Hermano/a" ? 4 : 5);
  return out.sort((x, y) => order(x) - order(y) || (y.age ?? 0) - (x.age ?? 0));
}

const zMember = z.object({ patientId: zId, durationMin: z.number().int().min(5).max(240), procedureId: zId.nullish().transform((v) => v ?? null) });

export function familyRoutes(route: Route) {
  route({
    method: "GET", url: "/api/patients/:id/family", summary: "Familia del paciente: relaciones declaradas, hermanos por un tutor en común, saldos y próximas citas según permisos",
    tags: TAGS, perm: "patients.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const members = await familyMembers(c, auth, params.id);
      const money = auth.permissions.has("payments.read") || auth.permissions.has("budgets.read");
      const totalBalance = money ? members.reduce((s, m) => s + Math.max(0, m.balanceCents ?? 0), 0) : null;
      return { members, canSeeMoney: money, canSeeAgenda: auth.permissions.has("agenda.read"), familyBalanceCents: totalBalance };
    },
  });

  route({
    method: "POST", url: "/api/patients/:id/relationships", summary: "Declarar un familiar: «el familiar es [madre, padre, tutor/a, hijo/a, cónyuge, hermano/a u otro] del paciente»",
    tags: TAGS, perm: "patients.write", params: zIdParams, body: zFamilyLink,
    handler: async ({ c, auth, params, body }) => createRelationship(c, auth, params.id, body),
  });

  route({
    method: "PATCH", url: "/api/relationships/:id", summary: "Marcar o quitar al tutor legal de una relación madre/padre/tutor → hijo/a",
    tags: TAGS, perm: "patients.write", params: zIdParams, body: z.object({ legalGuardian: z.boolean() }),
    handler: async ({ c, auth, params, body }) => {
      const r = (await c.query<RelRow>("SELECT * FROM patient_relationships WHERE id = $1 AND ended_at IS NULL FOR UPDATE", [params.id])).rows[0];
      if (!r) throw notFound("Relación");
      if (r.kind !== "parent") throw badRequest("Solo una madre, un padre o un tutor puede ser tutor legal");
      if (r.legal_guardian === body.legalGuardian) return { ok: true };
      if (body.legalGuardian) {
        const g = (await c.query("SELECT 1 FROM patient_relationships WHERE person_b = $1 AND legal_guardian AND ended_at IS NULL", [r.person_b])).rowCount;
        if (g) throw conflict("Ese paciente ya tiene un tutor legal. Quita la marca del actual antes de elegir otro.", "guardian_exists");
      }
      await c.query("UPDATE patient_relationships SET legal_guardian = $2 WHERE id = $1", [params.id, body.legalGuardian]);
      if (body.legalGuardian) await syncGuardianFields(c, r.person_a, r.person_b, r.parent_label);
      await audit(c, auth, body.legalGuardian ? "patient.guardian_set" : "patient.guardian_unset", "patient", r.person_b, { relationshipId: r.id, guardianId: r.person_a });
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/relationships/:id/end", summary: "Cerrar una relación familiar (queda en el historial; no se borra)",
    tags: TAGS, perm: "patients.write", params: zIdParams, body: z.object({ reason: z.string().trim().min(3, "Indica el motivo").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const r = (await c.query<RelRow>("SELECT * FROM patient_relationships WHERE id = $1 AND ended_at IS NULL FOR UPDATE", [params.id])).rows[0];
      if (!r) throw notFound("Relación");
      await c.query("UPDATE patient_relationships SET ended_at = now(), ended_by = $2, legal_guardian = false WHERE id = $1", [params.id, auth.userId]);
      await audit(c, auth, "patient.relationship_ended", "patient", r.person_a, { relationshipId: r.id, otherPatientId: r.person_b, reason: body.reason, wasLegalGuardian: r.legal_guardian });
      return { ok: true };
    },
  });

  // ---------------- Agendar a varios miembros seguidos ----------------
  route({
    method: "GET", url: "/api/family/slots", summary: "Horarios libres para atender seguidos a varios familiares (suma de duraciones) con un profesional",
    tags: TAGS, perm: "agenda.read",
    query: z.object({ branchId: zId, date: zDate, dentistId: zId.optional(), totalMin: z.coerce.number().int().min(5).max(600) }),
    handler: async ({ c, auth, query }) => {
      const zone = await clinicZone(c, auth.clinicId!);
      const days = await dayAvailability(c, zone, query.date, query.branchId, { dentistId: query.dentistId ?? null, durationMin: query.totalMin });
      return days.map((d) => ({ dentistId: d.dentistId, dentistName: d.dentistName, slots: d.slots }));
    },
  });

  route({
    method: "POST", url: "/api/family/appointments", summary: "Agendar a varios familiares seguidos (todo o nada): cada cita empieza cuando termina la anterior",
    tags: TAGS, perm: "agenda.write",
    body: z.object({
      branchId: zId, dentistId: zId, chairId: zId.nullish().transform((v) => v ?? null),
      startsAt: z.iso.datetime({ offset: true, message: "Fecha y hora inválidas" }),
      members: z.array(zMember).min(1, "Elige al menos a un familiar").max(6, "Máximo 6 citas seguidas"),
      reason: z.string().trim().max(300).nullish().transform((v) => v || null),
      idempotencyKey: z.string().min(8).max(80),
    }),
    handler: async ({ c, auth, body }) => {
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':family:' || $2, 0))", [auth.clinicId, body.idempotencyKey]);
      const keys = body.members.map((_, i) => `${body.idempotencyKey}:${i}`);
      const prev = (await c.query<{ id: string }>("SELECT id FROM appointments WHERE idempotency_key = ANY($1::text[]) ORDER BY starts_at", [keys])).rows;
      if (prev.length) return { ids: prev.map((r) => r.id), duplicate: true };
      const ids = new Set(body.members.map((m) => m.patientId));
      if (ids.size !== body.members.length) throw badRequest("Cada familiar aparece una sola vez");
      const found = (await c.query<{ id: string }>("SELECT id FROM patients WHERE id = ANY($1::uuid[]) AND archived_at IS NULL", [[...ids]])).rowCount;
      if (found !== ids.size) throw notFound("Paciente");
      const zone = await clinicZone(c, auth.clinicId!);
      let t = new Date(body.startsAt);
      if (t.getTime() < Date.now() - 15 * 60_000) throw badRequest("No se puede agendar en el pasado");
      const created: { id: string; patientId: string; startsAt: Date; endsAt: Date }[] = [];
      for (const [i, m] of body.members.entries()) {
        const end = new Date(t.getTime() + m.durationMin * 60_000);
        await assertBookable(c, auth, zone, { branchId: body.branchId, dentistId: body.dentistId, chairId: body.chairId, startsAt: t, endsAt: end, allowOutsideSchedule: false });
        const r = await c.query<{ id: string }>(
          `INSERT INTO appointments (clinic_id, branch_id, chair_id, dentist_id, patient_id, procedure_id, starts_at, ends_at, reason, source, idempotency_key, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'reception',$10,$11) RETURNING id`,
          [auth.clinicId, body.branchId, body.chairId, body.dentistId, m.patientId, m.procedureId, t, end, body.reason, keys[i], auth.userId]);
        const id = r.rows[0]!.id;
        await audit(c, auth, "appointment.created", "appointment", id, { startsAt: t, endsAt: end, dentistId: body.dentistId, patientId: m.patientId, family: true }, body.branchId);
        await recordAppointmentEvent(c, auth, { appointmentId: id, branchId: body.branchId, from: null, to: "scheduled", reason: "Agendada junto con su familia" });
        created.push({ id, patientId: m.patientId, startsAt: t, endsAt: end });
        t = end;
      }
      return { ids: created.map((x) => x.id), appointments: created };
    },
  });
}
