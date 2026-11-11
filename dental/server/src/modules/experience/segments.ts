// Etiquetas, segmentos guardados y campañas manuales (R2-38).
//
//  * Etiquetas por clínica con color; se asignan en la ficha.
//  * Segmento = filtros guardados (etiquetas, edad, última visita, saldo, sucursal, tratamiento
//    pendiente, control vencido). La lista se calcula al consultar; se exporta con patients.export.
//    Los filtros de saldo, tratamiento pendiente y control vencido exigen el permiso que ya protege
//    ese dato (cobros/presupuestos, presupuestos y agenda).
//  * Campaña manual: un mensaje SIN datos clínicos (solo {nombre} y {clinica}) que se deja en la
//    bandeja de lib/messaging.ts (fuera de producción, simulado) SOLO para quien aceptó promociones y
//    no se dio de baja. La vista previa explica cuántos se excluyen y por qué; enviar exige confirmar
//    el número exacto y respeta un tope por campaña y el horario de silencio.
import { z } from "zod";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import type { Config } from "../../config.js";
import type { Client } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams } from "../../lib/http.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { requireBranch, type AuthCtx } from "../../lib/rbac.js";
import type { Messenger } from "../../lib/messaging.js";
import { normalizePhone } from "../../lib/text.js";
import { clinicZone } from "../agenda.js";
import { loadMessagingSettings } from "../messaging/scheduler.js";
import { OPT_OUT_LINE, renderTemplate, validateTemplate } from "../messaging/templates.js";
import { isQuiet } from "../messaging/timing.js";

const TAGS = ["etiquetas y segmentos"];
/** Tope de destinatarios por campaña: un segmento más grande se debe dividir. */
export const MAX_CAMPAIGN_RECIPIENTS = 300;
/** Nadie recibe dos campañas en menos de 7 días. */
export const CAMPAIGN_COOLDOWN_DAYS = 7;
/** Variables permitidas en una campaña (nada clínico ni de la cita). */
export const CAMPAIGN_VARIABLES = ["nombre", "clinica"] as const;

const zColor = z.string().trim().toLowerCase().regex(/^#[0-9a-f]{6}$/, "Color inválido (formato #RRGGBB)");
const zTagName = z.string().trim().min(2, "Escribe un nombre (al menos 2 caracteres)").max(40, "Máximo 40 caracteres");

export const zFilters = z.object({
  tagIds: z.array(zId).max(20).default([]),
  tagMode: z.enum(["any", "all"]).default("any"),
  ageMin: z.number().int().min(0).max(120).nullish().transform((v) => v ?? null),
  ageMax: z.number().int().min(0).max(120).nullish().transform((v) => v ?? null),
  /** Última visita atendida hace menos de N días. */
  visitedWithinDays: z.number().int().min(1).max(3650).nullish().transform((v) => v ?? null),
  /** Sin visitas atendidas en los últimos N días (o nunca). */
  noVisitDays: z.number().int().min(1).max(3650).nullish().transform((v) => v ?? null),
  balance: z.enum(["any", "debt", "credit", "clear"]).default("any"),
  minDebtCents: z.number().int().min(0).max(10_000_000_00).nullish().transform((v) => v ?? null),
  branchId: zId.nullish().transform((v) => v ?? null),
  pendingTreatment: z.boolean().default(false),
  overdueRecall: z.boolean().default(false),
}).superRefine((f, x) => {
  if (f.ageMin != null && f.ageMax != null && f.ageMin > f.ageMax) x.addIssue({ code: "custom", path: ["ageMax"], message: "La edad máxima debe ser mayor o igual a la mínima" });
  if (f.visitedWithinDays != null && f.noVisitDays != null) x.addIssue({ code: "custom", path: ["noVisitDays"], message: "Elige «visitó hace menos de» o «sin visitas hace más de», no ambos" });
  if (f.minDebtCents != null && f.balance !== "debt") x.addIssue({ code: "custom", path: ["minDebtCents"], message: "El monto mínimo solo aplica a «con deuda»" });
});
export type Filters = z.infer<typeof zFilters>;

/** Comprueba que el rol pueda usar cada filtro (sin filtrar por datos que no puede ver). */
function checkFilterPerms(auth: AuthCtx, f: Filters) {
  const has = (p: Parameters<AuthCtx["permissions"]["has"]>[0]) => auth.permissions.has(p);
  if (f.balance !== "any" && !(has("payments.read") || has("budgets.read"))) throw forbidden("No tienes permiso para filtrar por saldo");
  if (f.pendingTreatment && !has("budgets.read")) throw forbidden("No tienes permiso para filtrar por tratamiento pendiente");
  if (f.overdueRecall && !has("agenda.read")) throw forbidden("No tienes permiso para filtrar por controles vencidos");
  if (f.branchId) requireBranch(auth, f.branchId);
}

export interface SegmentRow {
  id: string; recordNumber: number; firstName: string; lastName: string; birthDate: string | null; age: number | null; phone: string | null;
  branchName: string | null; tags: { id: string; name: string; color: string }[]; lastVisit: string | null; balanceCents?: number;
  consentMarketing: boolean;
}

/** Pacientes del segmento (archivados nunca). Límite defensivo de 5000 filas. */
export async function runSegment(c: Client, auth: AuthCtx, f: Filters, opts: { limit?: number } = {}): Promise<{ total: number; items: SegmentRow[] }> {
  checkFilterPerms(auth, f);
  const zone = await clinicZone(c, auth.clinicId!);
  const today = DateTime.now().setZone(zone).toISODate()!;
  const where: string[] = ["p.archived_at IS NULL", "$1::date IS NOT NULL"];
  const params: unknown[] = [today];
  const add = (v: unknown) => { params.push(v); return `$${params.length}`; };
  if (f.tagIds.length) {
    const t = add(f.tagIds);
    where.push(f.tagMode === "all"
      ? `(SELECT count(DISTINCT l.tag_id) FROM patient_tag_links l WHERE l.patient_id = p.id AND l.tag_id = ANY(${t}::uuid[])) = cardinality(${t}::uuid[])`
      : `EXISTS (SELECT 1 FROM patient_tag_links l WHERE l.patient_id = p.id AND l.tag_id = ANY(${t}::uuid[]))`);
  }
  if (f.ageMin != null) where.push(`p.birth_date IS NOT NULL AND p.birth_date <= ($1::date - make_interval(years => ${add(f.ageMin)}::int))`);
  if (f.ageMax != null) where.push(`p.birth_date IS NOT NULL AND p.birth_date > ($1::date - make_interval(years => ${add(f.ageMax)}::int + 1))`);
  if (f.visitedWithinDays != null) where.push(`lv.last_visit >= now() - make_interval(days => ${add(f.visitedWithinDays)}::int)`);
  if (f.noVisitDays != null) where.push(`(lv.last_visit IS NULL OR lv.last_visit < now() - make_interval(days => ${add(f.noVisitDays)}::int))`);
  if (f.branchId) {
    const b = add(f.branchId);
    where.push(`(p.preferred_branch_id = ${b} OR EXISTS (SELECT 1 FROM appointments a WHERE a.patient_id = p.id AND a.branch_id = ${b} AND a.status NOT IN ('cancelled','no_show')))`);
  }
  if (f.pendingTreatment) {
    where.push(`EXISTS (SELECT 1 FROM budget_items i JOIN budgets bu ON bu.id = i.budget_id WHERE bu.patient_id = p.id AND bu.status = 'accepted' AND i.status = 'pending')`);
  }
  if (f.overdueRecall) where.push(`EXISTS (SELECT 1 FROM recalls r WHERE r.patient_id = p.id AND r.status IN ('pending','review') AND r.due_date < $1::date)`);
  const withMoney = f.balance !== "any" || auth.permissions.has("payments.read") || auth.permissions.has("budgets.read");
  if (f.balance === "debt") where.push(`m.balance_cents > ${f.minDebtCents ? add(f.minDebtCents) : "0"}`);
  if (f.balance === "credit") where.push("m.balance_cents < 0");
  if (f.balance === "clear") where.push("m.balance_cents = 0");
  const limit = add(Math.min(opts.limit ?? 5000, 5000));
  const r = await c.query(
    `SELECT p.id, p.record_number AS "recordNumber", p.first_name AS "firstName", p.last_name AS "lastName", p.birth_date AS "birthDate",
            p.phone, br.name AS "branchName", p.consent_marketing AS "consentMarketing", lv.last_visit AS "lastVisit",
            ${withMoney ? `m.balance_cents AS "balanceCents",` : ""}
            COALESCE((SELECT json_agg(json_build_object('id', t.id, 'name', t.name, 'color', t.color) ORDER BY t.name)
                        FROM patient_tag_links l JOIN patient_tags t ON t.id = l.tag_id WHERE l.patient_id = p.id), '[]') AS tags,
            count(*) OVER() AS total
       FROM patients p
       LEFT JOIN branches br ON br.id = p.preferred_branch_id
       LEFT JOIN LATERAL (SELECT max(a.starts_at) AS last_visit FROM appointments a WHERE a.patient_id = p.id AND a.status = 'completed') lv ON true
       ${withMoney ? "LEFT JOIN LATERAL (SELECT balance_cents FROM patient_money(p.id)) m ON true" : ""}
      WHERE ${where.join(" AND ")}
      ORDER BY p.last_name, p.first_name
      LIMIT ${limit}`, params);
  const canMoney = auth.permissions.has("payments.read") || auth.permissions.has("budgets.read");
  const items = r.rows.map(({ total, ...x }) => {
    const age = x.birthDate ? Math.floor(DateTime.fromISO(today).diff(DateTime.fromISO(x.birthDate), "years").years) : null;
    if (!canMoney) delete x.balanceCents;
    return { ...x, age } as SegmentRow;
  });
  return { total: Number(r.rows[0]?.total ?? 0), items };
}

// ---------------- Campañas: elegibilidad ----------------
export type ExclusionReason = "minor" | "opted_out" | "no_consent" | "no_phone" | "shared_phone" | "cooldown";
export const EXCLUSION_LABELS: Record<ExclusionReason, string> = {
  minor: "Menor de edad (no recibe promociones)",
  opted_out: "Se dio de baja de las promociones",
  no_consent: "No aceptó recibir promociones",
  no_phone: "Sin celular registrado",
  shared_phone: "Mismo celular que otro destinatario (familia): recibe un solo mensaje",
  cooldown: `Recibió otra campaña en los últimos ${CAMPAIGN_COOLDOWN_DAYS} días`,
};

export interface Eligibility { eligible: { id: string; firstName: string; phone: string }[]; excluded: { id: string; reason: ExclusionReason }[] }

export async function campaignEligibility(c: Client, patients: SegmentRow[]): Promise<Eligibility> {
  const ids = patients.map((p) => p.id);
  if (!ids.length) return { eligible: [], excluded: [] };
  const info = new Map((await c.query<{ id: string; flag: boolean; last: string | null; recent: boolean }>(
    `SELECT p.id, p.consent_marketing AS flag,
            (SELECT d.decision FROM signed_documents d WHERE d.patient_id = p.id AND d.kind = 'marketing' ORDER BY d.signed_at DESC LIMIT 1) AS last,
            EXISTS (SELECT 1 FROM marketing_campaign_recipients r WHERE r.patient_id = p.id AND r.status = 'queued'
                     AND r.created_at > now() - make_interval(days => $2::int)) AS recent
       FROM patients p WHERE p.id = ANY($1::uuid[])`, [ids, CAMPAIGN_COOLDOWN_DAYS])).rows.map((r) => [r.id, r]));
  // Celulares que ya recibieron una campaña hace poco (aunque fuera para otro miembro de la familia).
  const recentPhones = new Set((await c.query<{ recipient: string }>(
    `SELECT DISTINCT recipient FROM outbound_messages WHERE template = 'campaign.manual' AND created_at > now() - make_interval(days => $1::int)`,
    [CAMPAIGN_COOLDOWN_DAYS])).rows.map((r) => r.recipient));
  const out: Eligibility = { eligible: [], excluded: [] };
  const phones = new Set<string>();
  // Orden estable: adultos primero por apellido (como la lista), así el titular del celular recibe el mensaje.
  for (const p of patients) {
    const x = info.get(p.id)!;
    const phone = normalizePhone(p.phone);
    let reason: ExclusionReason | null = null;
    if (p.age !== null && p.age < 18) reason = "minor";
    else if (x.last === "revoked") reason = "opted_out";
    else if (!x.flag || x.last === "refused") reason = "no_consent";
    else if (!phone || phone.replace(/\D/g, "").length < 7) reason = "no_phone";
    else if (x.recent || recentPhones.has(phone)) reason = "cooldown";
    else if (phones.has(phone)) reason = "shared_phone";
    if (reason) { out.excluded.push({ id: p.id, reason }); continue; }
    phones.add(phone!);
    out.eligible.push({ id: p.id, firstName: p.firstName, phone: phone! });
  }
  return out;
}

function validateCampaignBody(body: string) {
  const v = validateTemplate(body, { purpose: "marketing" });
  const errors = v.errors.map((e) => e.message);
  for (const m of body.matchAll(/\{([^{}]*)\}/g)) {
    const name = m[1]!.trim();
    if (name && !(CAMPAIGN_VARIABLES as readonly string[]).includes(name) && !errors.some((e) => e.includes(`{${name}}`))) {
      errors.push(`En una campaña solo se puede usar ${CAMPAIGN_VARIABLES.map((x) => `{${x}}`).join(" y ")}: quita {${name}}`);
    }
  }
  return { errors, warnings: v.warnings };
}

const zCampaignBase = z.object({
  name: z.string().trim().min(3, "Escribe un nombre para la campaña (al menos 3 caracteres)").max(80),
  segmentId: zId.nullish().transform((v) => v ?? null),
  filters: zFilters.optional(),
  body: z.string().max(5000),
});

async function campaignTarget(c: Client, auth: AuthCtx, b: z.infer<typeof zCampaignBase>) {
  let filters = b.filters ?? null;
  if (b.segmentId) {
    const s = (await c.query<{ filters: unknown }>("SELECT filters FROM patient_segments WHERE id = $1 AND archived_at IS NULL", [b.segmentId])).rows[0];
    if (!s) throw notFound("Segmento");
    filters = zFilters.parse(s.filters);
  }
  if (!filters) throw badRequest("Elige un segmento o define los filtros");
  const seg = await runSegment(c, auth, filters);
  if (seg.total > seg.items.length) throw badRequest("El segmento es demasiado grande. Agrega filtros para acotarlo.");
  const elig = await campaignEligibility(c, seg.items);
  return { filters, seg, elig };
}

function summary(excluded: Eligibility["excluded"]) {
  const counts: Partial<Record<ExclusionReason, number>> = {};
  for (const e of excluded) counts[e.reason] = (counts[e.reason] ?? 0) + 1;
  return (Object.keys(EXCLUSION_LABELS) as ExclusionReason[]).filter((k) => counts[k]).map((k) => ({ reason: k, label: EXCLUSION_LABELS[k], count: counts[k]! }));
}

export function segmentRoutes(route: Route, cfg: Config, messenger: Messenger) {
  // ---------------- Etiquetas ----------------
  route({
    method: "GET", url: "/api/patient-tags", summary: "Etiquetas de la clínica con la cantidad de pacientes", tags: TAGS, perm: "patients.read",
    handler: async ({ c }) => (await c.query(
      `SELECT t.id, t.name, t.color, t.active, (SELECT count(*)::int FROM patient_tag_links l JOIN patients p ON p.id = l.patient_id
                                                  WHERE l.tag_id = t.id AND p.archived_at IS NULL) AS patients
         FROM patient_tags t ORDER BY t.active DESC, lower(t.name)`)).rows,
  });

  const zTag = z.object({ name: zTagName, color: zColor.default("#0f766e") });
  const tagConflict = async (c: Client, name: string, exceptId: string | null) => {
    const ex = (await c.query("SELECT 1 FROM patient_tags WHERE lower(name) = lower($1) AND ($2::uuid IS NULL OR id <> $2)", [name, exceptId])).rowCount;
    if (ex) throw new AppError(409, "duplicate_tag", "Ya existe una etiqueta con ese nombre", [{ path: "name", message: "Ya existe una etiqueta con ese nombre" }]);
  };
  route({
    method: "POST", url: "/api/patient-tags", summary: "Crear una etiqueta (por ejemplo «Ortodoncia activa», «Empresa X», «VIP»)", tags: TAGS, perm: "patients.write", body: zTag,
    handler: async ({ c, auth, body }) => {
      await tagConflict(c, body.name, null);
      const r = await c.query<{ id: string }>("INSERT INTO patient_tags (clinic_id, name, color, created_by) VALUES ($1,$2,$3,$4) RETURNING id", [auth.clinicId, body.name, body.color, auth.userId]);
      await audit(c, auth, "patient_tag.created", "patient_tag", r.rows[0]!.id, body);
      return { id: r.rows[0]!.id };
    },
  });
  route({
    method: "PUT", url: "/api/patient-tags/:id", summary: "Renombrar, cambiar el color o desactivar una etiqueta", tags: TAGS, perm: "patients.write", params: zIdParams,
    body: zTag.extend({ active: z.boolean().default(true) }),
    handler: async ({ c, auth, params, body }) => {
      await tagConflict(c, body.name, params.id);
      const r = await c.query("UPDATE patient_tags SET name = $2, color = $3, active = $4 WHERE id = $1", [params.id, body.name, body.color, body.active]);
      if (!r.rowCount) throw notFound("Etiqueta");
      await audit(c, auth, "patient_tag.updated", "patient_tag", params.id, body);
      return { ok: true };
    },
  });
  route({
    method: "GET", url: "/api/patients/:id/tags", summary: "Etiquetas del paciente", tags: TAGS, perm: "patients.read", params: zIdParams,
    handler: async ({ c, params }) => (await c.query(
      "SELECT t.id, t.name, t.color FROM patient_tag_links l JOIN patient_tags t ON t.id = l.tag_id WHERE l.patient_id = $1 ORDER BY lower(t.name)", [params.id])).rows,
  });
  route({
    method: "PUT", url: "/api/patients/:id/tags", summary: "Definir las etiquetas del paciente (lista completa)", tags: TAGS, perm: "patients.write", params: zIdParams,
    body: z.object({ tagIds: z.array(zId).max(30, "Máximo 30 etiquetas") }),
    handler: async ({ c, auth, params, body }) => {
      const p = (await c.query("SELECT 1 FROM patients WHERE id = $1", [params.id])).rowCount;
      if (!p) throw notFound("Paciente");
      const want = [...new Set(body.tagIds)];
      const valid = (await c.query<{ id: string }>("SELECT id FROM patient_tags WHERE id = ANY($1::uuid[]) AND active", [want])).rows.map((r) => r.id);
      if (valid.length !== want.length) throw badRequest("Alguna etiqueta no existe o está desactivada");
      const cur = (await c.query<{ tag_id: string }>("SELECT tag_id FROM patient_tag_links WHERE patient_id = $1", [params.id])).rows.map((r) => r.tag_id);
      const added = want.filter((t) => !cur.includes(t)), removed = cur.filter((t) => !want.includes(t));
      if (removed.length) await c.query("DELETE FROM patient_tag_links WHERE patient_id = $1 AND tag_id = ANY($2::uuid[])", [params.id, removed]);
      for (const t of added) await c.query("INSERT INTO patient_tag_links (clinic_id, patient_id, tag_id, created_by) VALUES ($1,$2,$3,$4)", [auth.clinicId, params.id, t, auth.userId]);
      if (added.length || removed.length) await audit(c, auth, "patient.tags_changed", "patient", params.id, { added, removed });
      return { ok: true, added: added.length, removed: removed.length };
    },
  });

  // ---------------- Segmentos ----------------
  route({
    method: "GET", url: "/api/segments", summary: "Segmentos guardados", tags: TAGS, perm: "patients.read",
    handler: async ({ c }) => (await c.query(
      `SELECT s.id, s.name, s.filters, s.updated_at AS "updatedAt", u.full_name AS "createdBy"
         FROM patient_segments s LEFT JOIN users u ON u.id = s.created_by WHERE s.archived_at IS NULL ORDER BY lower(s.name)`)).rows,
  });
  route({
    method: "POST", url: "/api/segments/preview", summary: "Calcular un segmento (sin guardarlo): cantidad y primeros 100 pacientes", tags: TAGS, perm: "patients.read",
    body: z.object({ filters: zFilters }),
    handler: async ({ c, auth, body }) => {
      const r = await runSegment(c, auth, body.filters);
      return { total: r.total, items: r.items.slice(0, 100) };
    },
  });
  route({
    method: "GET", url: "/api/segments/:id/patients", summary: "Pacientes de un segmento guardado (primeros 100)", tags: TAGS, perm: "patients.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const s = (await c.query<{ filters: unknown; name: string }>("SELECT name, filters FROM patient_segments WHERE id = $1 AND archived_at IS NULL", [params.id])).rows[0];
      if (!s) throw notFound("Segmento");
      const r = await runSegment(c, auth, zFilters.parse(s.filters));
      return { name: s.name, total: r.total, items: r.items.slice(0, 100) };
    },
  });
  const zSegment = z.object({ name: z.string().trim().min(3, "Escribe un nombre (al menos 3 caracteres)").max(80), filters: zFilters });
  const segConflict = async (c: Client, name: string, exceptId: string | null) => {
    const ex = (await c.query("SELECT 1 FROM patient_segments WHERE lower(name) = lower($1) AND archived_at IS NULL AND ($2::uuid IS NULL OR id <> $2)", [name, exceptId])).rowCount;
    if (ex) throw new AppError(409, "duplicate_segment", "Ya existe un segmento con ese nombre", [{ path: "name", message: "Ya existe un segmento con ese nombre" }]);
  };
  route({
    method: "POST", url: "/api/segments", summary: "Guardar un segmento (filtros)", tags: TAGS, perm: "patients.write", body: zSegment,
    handler: async ({ c, auth, body }) => {
      checkFilterPerms(auth, body.filters);
      await segConflict(c, body.name, null);
      const r = await c.query<{ id: string }>("INSERT INTO patient_segments (clinic_id, name, filters, created_by) VALUES ($1,$2,$3,$4) RETURNING id",
        [auth.clinicId, body.name, JSON.stringify(body.filters), auth.userId]);
      await audit(c, auth, "segment.created", "segment", r.rows[0]!.id, { name: body.name, filters: body.filters });
      return { id: r.rows[0]!.id };
    },
  });
  route({
    method: "PUT", url: "/api/segments/:id", summary: "Cambiar el nombre o los filtros de un segmento", tags: TAGS, perm: "patients.write", params: zIdParams, body: zSegment,
    handler: async ({ c, auth, params, body }) => {
      checkFilterPerms(auth, body.filters);
      await segConflict(c, body.name, params.id);
      const r = await c.query("UPDATE patient_segments SET name = $2, filters = $3, updated_at = now() WHERE id = $1 AND archived_at IS NULL", [params.id, body.name, JSON.stringify(body.filters)]);
      if (!r.rowCount) throw notFound("Segmento");
      await audit(c, auth, "segment.updated", "segment", params.id, { name: body.name, filters: body.filters });
      return { ok: true };
    },
  });
  route({
    method: "POST", url: "/api/segments/:id/archive", summary: "Quitar un segmento de la lista (las campañas enviadas lo conservan)", tags: TAGS, perm: "patients.write", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const r = await c.query("UPDATE patient_segments SET archived_at = now(), updated_at = now() WHERE id = $1 AND archived_at IS NULL", [params.id]);
      if (!r.rowCount) throw notFound("Segmento");
      await audit(c, auth, "segment.archived", "segment", params.id);
      return { ok: true };
    },
  });
  route({
    method: "GET", url: "/api/segments/:id/export.xlsx", summary: "Exportar la lista de un segmento (Excel)", tags: TAGS, perm: "patients.export", params: zIdParams, raw: true,
    handler: async ({ c, auth, params, reply }) => {
      const s = (await c.query<{ filters: unknown; name: string }>("SELECT name, filters FROM patient_segments WHERE id = $1 AND archived_at IS NULL", [params.id])).rows[0];
      if (!s) throw notFound("Segmento");
      const r = await runSegment(c, auth, zFilters.parse(s.filters));
      const money = auth.permissions.has("payments.read") || auth.permissions.has("budgets.read");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Segmento");
      ws.columns = [
        { header: "Ficha", key: "recordNumber", width: 8 }, { header: "Nombre", key: "firstName", width: 18 }, { header: "Apellido", key: "lastName", width: 22 },
        { header: "Edad", key: "age", width: 6 }, { header: "Celular", key: "phone", width: 15 }, { header: "Sucursal habitual", key: "branchName", width: 18 },
        { header: "Etiquetas", key: "tags", width: 26 }, { header: "Última visita", key: "lastVisit", width: 13 },
        ...(money ? [{ header: "Saldo (Bs)", key: "balance", width: 12 }] : []), { header: "Acepta promociones", key: "consentMarketing", width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);
      const zone = await clinicZone(c, auth.clinicId!);
      for (const p of r.items) {
        ws.addRow({
          recordNumber: p.recordNumber, firstName: safe(p.firstName), lastName: safe(p.lastName), age: p.age, phone: safe(p.phone), branchName: safe(p.branchName),
          tags: safe(p.tags.map((t) => t.name).join(", ")), lastVisit: p.lastVisit ? DateTime.fromJSDate(new Date(p.lastVisit), { zone }).toFormat("dd/MM/yyyy") : "",
          balance: p.balanceCents != null ? p.balanceCents / 100 : undefined, consentMarketing: p.consentMarketing ? "Sí" : "No",
        });
      }
      await audit(c, auth, "segment.exported", "segment", params.id, { count: r.items.length });
      const buf = await wb.xlsx.writeBuffer();
      const fname = s.name.normalize("NFD").replace(/[^\w-]+/g, "-").replace(/-+/g, "-").slice(0, 40).toLowerCase() || "segmento";
      reply.header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="segmento-${fname}.xlsx"`).send(Buffer.from(buf));
    },
  });

  // ---------------- Campañas manuales ----------------
  route({
    method: "POST", url: "/api/campaigns/preview", summary: "Vista previa de una campaña: a cuántos llega, cuántos se excluyen y por qué, y el texto final", tags: TAGS, perm: "clinic.manage",
    body: zCampaignBase,
    handler: async ({ c, auth, body }) => {
      const { seg, elig } = await campaignTarget(c, auth, body);
      const v = validateCampaignBody(body.body);
      const cl = (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!;
      const settings = await loadMessagingSettings(c, auth.clinicId!);
      const zone = await clinicZone(c, auth.clinicId!);
      return {
        segmentTotal: seg.total, eligible: elig.eligible.length, excluded: elig.excluded.length, reasons: summary(elig.excluded),
        cap: MAX_CAMPAIGN_RECIPIENTS, overCap: elig.eligible.length > MAX_CAMPAIGN_RECIPIENTS,
        quietNow: isQuiet(Date.now(), zone, settings.quiet), quiet: settings.quiet,
        errors: v.errors, warnings: v.warnings, optOutLine: OPT_OUT_LINE, mode: messenger.mode,
        example: v.errors.length ? null : renderTemplate(body.body, { nombre: elig.eligible[0]?.firstName ?? "Lucía", clinica: cl.name }, "marketing"),
      };
    },
  });

  route({
    method: "POST", url: "/api/campaigns", summary: "Enviar una campaña manual: confirma el número exacto de destinatarios; solo con consentimiento de promociones y sin baja",
    tags: TAGS, perm: "clinic.manage",
    body: zCampaignBase.extend({ confirmCount: z.number().int().min(1, "No hay destinatarios para confirmar") }),
    handler: async ({ c, auth, body }) => {
      // Dos envíos simultáneos de la misma clínica se esperan (el enfriamiento de 7 días evita el doble mensaje).
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('campaign:' || $1, 0))", [auth.clinicId]);
      const v = validateCampaignBody(body.body);
      if (v.errors.length) throw new AppError(400, "validation", v.errors[0]!, v.errors.map((m) => ({ path: "body", message: m })));
      const { filters, elig } = await campaignTarget(c, auth, body);
      const n = elig.eligible.length;
      if (!n) throw conflict("Nadie del segmento puede recibir esta campaña (revisa los motivos de exclusión)", "no_recipients");
      if (n > MAX_CAMPAIGN_RECIPIENTS) throw conflict(`La campaña llegaría a ${n} personas y el tope es ${MAX_CAMPAIGN_RECIPIENTS}. Divide el segmento con más filtros.`, "over_cap");
      if (n !== body.confirmCount) throw new AppError(409, "count_changed", `El número de destinatarios cambió: ahora son ${n}. Revisa la vista previa y confirma de nuevo.`, { eligible: n });
      const zone = await clinicZone(c, auth.clinicId!);
      const settings = await loadMessagingSettings(c, auth.clinicId!);
      if (isQuiet(Date.now(), zone, settings.quiet)) {
        throw conflict(`Es horario de silencio (${settings.quiet.start} a ${settings.quiet.end}). Envía la campaña después de las ${settings.quiet.end}.`, "quiet_hours");
      }
      const cl = (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!;
      const reasons = summary(elig.excluded);
      const camp = (await c.query<{ id: string }>(
        `INSERT INTO marketing_campaigns (clinic_id, segment_id, name, body, channel, filters, recipients, excluded, excluded_summary, delivery_mode, created_by)
         VALUES ($1,$2,$3,$4,'whatsapp',$5,$6,$7,$8,$9,$10) RETURNING id`,
        [auth.clinicId, body.segmentId, body.name, body.body, JSON.stringify(filters), n, elig.excluded.length,
          JSON.stringify(Object.fromEntries(reasons.map((r) => [r.reason, r.count]))), messenger.mode, auth.userId])).rows[0]!.id;
      for (const p of elig.eligible) {
        const text = renderTemplate(body.body, { nombre: p.firstName, clinica: cl.name }, "marketing");
        const msg = await messenger.enqueue(c, {
          clinicId: auth.clinicId!, patientId: p.id, channel: "whatsapp", recipient: p.phone, template: "campaign.manual", purpose: "marketing", body: text,
          relatedEntity: "campaign", relatedId: camp, dedupeKey: `campaign:${camp}:${p.id}`,
        });
        await c.query("INSERT INTO marketing_campaign_recipients (clinic_id, campaign_id, patient_id, status, message_id) VALUES ($1,$2,$3,'queued',$4)",
          [auth.clinicId, camp, p.id, msg.id]);
      }
      for (const e of elig.excluded) {
        await c.query("INSERT INTO marketing_campaign_recipients (clinic_id, campaign_id, patient_id, status, reason) VALUES ($1,$2,$3,'excluded',$4)",
          [auth.clinicId, camp, e.id, EXCLUSION_LABELS[e.reason]]);
      }
      await audit(c, auth, "campaign.sent", "campaign", camp, { name: body.name, recipients: n, excluded: elig.excluded.length, mode: messenger.mode, segmentId: body.segmentId });
      return { id: camp, recipients: n, excluded: elig.excluded.length, mode: messenger.mode };
    },
  });

  route({
    method: "GET", url: "/api/campaigns", summary: "Campañas enviadas", tags: TAGS, perm: "clinic.manage",
    handler: async ({ c }) => (await c.query(
      `SELECT k.id, k.name, k.body, k.recipients, k.excluded, k.excluded_summary AS "excludedSummary", k.delivery_mode AS "mode", k.created_at AS "createdAt",
              u.full_name AS "createdBy", s.name AS "segmentName"
         FROM marketing_campaigns k JOIN users u ON u.id = k.created_by LEFT JOIN patient_segments s ON s.id = k.segment_id
        ORDER BY k.created_at DESC LIMIT 100`)).rows.map((r) => ({
          ...r, excludedReasons: Object.entries(r.excludedSummary as Record<string, number>).map(([k, n]) => ({ reason: k, label: EXCLUSION_LABELS[k as ExclusionReason] ?? k, count: n })),
        })),
  });

  route({
    method: "GET", url: "/api/campaigns/:id", summary: "Detalle de una campaña: destinatarios y excluidos con su motivo", tags: TAGS, perm: "clinic.manage", params: zIdParams,
    handler: async ({ c, params }) => {
      const k = (await c.query(`SELECT id, name, body, recipients, excluded, created_at AS "createdAt", delivery_mode AS "mode" FROM marketing_campaigns WHERE id = $1`, [params.id])).rows[0];
      if (!k) throw notFound("Campaña");
      const rows = (await c.query(
        `SELECT r.patient_id AS "patientId", p.first_name || ' ' || p.last_name AS name, p.record_number AS "recordNumber", r.status, r.reason, m.status AS "messageStatus"
           FROM marketing_campaign_recipients r JOIN patients p ON p.id = r.patient_id LEFT JOIN outbound_messages m ON m.id = r.message_id
          WHERE r.campaign_id = $1 ORDER BY r.status DESC, p.last_name`, [params.id])).rows;
      return { ...k, rows };
    },
  });
}
