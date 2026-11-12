// Recetas, certificados y derivaciones (R2-40) y PDF con huella de documentos existentes (B-064).
//
// - Emitir CONGELA el documento: instantánea completa (membrete, paciente, emisor con matrícula,
//   contenido) + SHA-256 + PDF guardado, todo de solo inserción. Corregir = anular con motivo y reemitir.
// - Aviso de alergias NO bloqueante: si una línea coincide con las alergias de la última historia,
//   el servidor exige que el profesional marque "Revisé la alergia" (y lo deja registrado).
// - Cada descarga queda en la auditoría. La página pública /verificar/:code solo dice si el
//   documento existe y está íntegro (tipo, fecha y clínica), sin datos del paciente.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Config } from "../config.js";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../lib/http.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { nextCounter, type Client } from "../lib/db.js";
import { requireBranch, type AuthCtx } from "../lib/rbac.js";
import { allergyWarnings } from "../lib/allergies.js";
import { interactionWarnings, type InteractionHistory } from "../lib/interactions.js";
import { formatVerifyCode, normalizeVerifyCode, snapshotHash } from "../lib/pdf.js";
import { budgetSnapshot, consentSnapshot, findPdf, letterheadData, patientSnap, receiptSnapshot, sendPdf, storePdf, verifyRow, type PdfRow } from "./documents-core.js";
import type { ClinicalSnapshot, RxLine } from "./documents-pdf.js";

// ---------------- Plantillas de certificados ----------------
export interface TemplateField { key: string; label: string; type: "date" | "time" | "text" | "textarea" | "number" | "select"; required: boolean; options?: string[]; hint?: string }
export const CERT_TEMPLATES: Record<"attendance" | "rest" | "treatment" | "referral", { kind: "certificate" | "referral"; title: string; body: string; fields: TemplateField[] }> = {
  attendance: {
    kind: "certificate", title: "Certificado de atención odontológica",
    body: "Certifico que {paciente}, {documento}, fue atendido(a) en {clinica}, sucursal {sucursal}, el {attendedOn}{horario}, por: {reason}.\n\nSe extiende el presente certificado a solicitud del interesado(a), para los fines que convengan.",
    fields: [
      { key: "attendedOn", label: "Fecha de la atención", type: "date", required: true },
      { key: "timeFrom", label: "Hora de inicio", type: "time", required: false },
      { key: "timeTo", label: "Hora de fin", type: "time", required: false },
      { key: "reason", label: "Motivo de la atención", type: "text", required: true, hint: "Ej.: control y profilaxis" },
    ],
  },
  rest: {
    kind: "certificate", title: "Certificado de reposo",
    body: "Certifico que {paciente}, {documento}, fue atendido(a) en {clinica} el {attendedOn} por: {reason}.\n\nPor indicación profesional requiere reposo de {restDays} día(s), desde el {restFrom} hasta el {restTo}, inclusive.\n\nSe extiende el presente certificado a solicitud del interesado(a), para los fines que convengan.",
    fields: [
      { key: "attendedOn", label: "Fecha de la atención", type: "date", required: true },
      { key: "reason", label: "Motivo o procedimiento", type: "text", required: true, hint: "Ej.: extracción quirúrgica de la pieza 38" },
      { key: "restDays", label: "Días de reposo", type: "number", required: true },
      { key: "restFrom", label: "Reposo desde", type: "date", required: true },
    ],
  },
  treatment: {
    kind: "certificate", title: "Constancia de tratamiento odontológico",
    body: "Hago constar que {paciente}, {documento}, {status} tratamiento odontológico en {clinica} desde el {startedOn}, que comprende: {treatment}.\n\nSe extiende la presente constancia a solicitud del interesado(a), para los fines que convengan.",
    fields: [
      { key: "status", label: "Situación", type: "select", required: true, options: ["se encuentra en", "concluyó su"] },
      { key: "startedOn", label: "Inicio del tratamiento", type: "date", required: true },
      { key: "treatment", label: "Tratamiento", type: "textarea", required: true, hint: "Ej.: ortodoncia fija con controles mensuales" },
    ],
  },
  referral: {
    kind: "referral", title: "Derivación a especialista",
    body: "Estimado(a) colega{recipient}:\n\nDerivo a {paciente}, {documento}, de {edad}, para valoración y tratamiento por {specialty}.\n\nMotivo de la derivación: {reason}\n\nResumen clínico: {summary}\n\nAgradeceré su valoración y la contrarreferencia con sus hallazgos y conducta.",
    fields: [
      { key: "specialty", label: "Especialidad", type: "text", required: true, hint: "Ej.: Cirugía bucomaxilofacial" },
      { key: "recipient", label: "Profesional o centro de destino (opcional)", type: "text", required: false },
      { key: "reason", label: "Motivo de la derivación", type: "text", required: true },
      { key: "summary", label: "Resumen clínico", type: "textarea", required: true, hint: "Hallazgos, estudios y tratamientos realizados" },
    ],
  },
};
type TemplateId = keyof typeof CERT_TEMPLATES;
const TEMPLATE_IDS = ["attendance", "rest", "treatment", "referral"] as const;

/** Marcadores que se completan solos al emitir (además de los campos de cada plantilla). */
const COMMON_PLACEHOLDERS = ["paciente", "documento", "edad", "clinica", "sucursal", "profesional", "matricula", "fecha"];
const DERIVED: Partial<Record<TemplateId, string[]>> = { attendance: ["horario"], rest: ["restTo"] };
export const placeholdersOf = (t: TemplateId) => [...COMMON_PLACEHOLDERS, ...CERT_TEMPLATES[t].fields.map((f) => f.key), ...(DERIVED[t] ?? [])];
export function unknownPlaceholders(t: TemplateId, body: string) {
  const ok = new Set(placeholdersOf(t));
  return [...new Set((body.match(/\{[^{}\s]{1,40}\}/g) ?? []).filter((m) => !ok.has(m.slice(1, -1))))];
}

/** Texto vigente de cada plantilla en la clínica: la última versión guardada o el texto base. */
async function effectiveTemplates(c: Client) {
  const rows = (await c.query<{ template: TemplateId; version: number; title: string; body: string; is_default: boolean; created_at: Date }>(
    `SELECT DISTINCT ON (template) template, version, title, body, is_default, created_at FROM certificate_template_versions ORDER BY template, version DESC`)).rows;
  return (Object.entries(CERT_TEMPLATES) as [TemplateId, (typeof CERT_TEMPLATES)[TemplateId]][]).map(([id, t]) => {
    const v = rows.find((r) => r.template === id);
    return {
      id, ...t, title: v?.title ?? t.title, body: v?.body ?? t.body, version: v?.version ?? 0, customized: !!v && !v.is_default,
      updatedAt: v?.created_at ?? null, placeholders: placeholdersOf(id), baseTitle: t.title, baseBody: t.body,
    };
  });
}

const KIND_PREFIX: Record<string, string> = { prescription: "R", certificate: "C", referral: "D" };
const docNumber = (kind: string, n: number) => `${KIND_PREFIX[kind]}-${String(n).padStart(6, "0")}`;

async function issuerInfo(c: Client, auth: AuthCtx) {
  const r = (await c.query<{ license: string | null }>("SELECT professional_license AS license FROM memberships WHERE user_id = $1 AND clinic_id = $2", [auth.userId, auth.clinicId])).rows[0];
  return { name: auth.fullName, license: r?.license?.trim() || null };
}

async function latestHistory(c: Client, patientId: string) {
  return (await c.query<{ data: InteractionHistory & { allergies?: string | null }; recorded_at: Date }>(
    "SELECT data, recorded_at FROM medical_histories WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1", [patientId])).rows[0];
}
async function latestAllergies(c: Client, patientId: string) {
  const mh = await latestHistory(c, patientId);
  return { hasHistory: !!mh, allergies: mh?.data?.allergies?.trim() || null, recordedAt: mh?.recorded_at ?? null };
}

const zLine = z.object({
  medicationId: zId.nullish().transform((v) => v ?? null),
  drug: z.string().trim().min(2, "Escribe el medicamento").max(160),
  presentation: zOptText(120),
  dose: z.string().trim().min(1, "Indica la dosis").max(80),
  frequency: z.string().trim().min(1, "Indica la frecuencia").max(80),
  duration: z.string().trim().min(1, "Indica la duración").max(60),
  instructions: zOptText(300),
});

async function linesWithTags(c: Client, lines: z.infer<typeof zLine>[]) {
  const ids = lines.map((l) => l.medicationId).filter(Boolean) as string[];
  const meds = ids.length ? (await c.query<{ id: string; allergy_tags: string[]; generic_name: string }>(
    "SELECT id, allergy_tags, generic_name FROM medications WHERE id = ANY($1)", [ids])).rows : [];
  return lines.map((l) => {
    const m = meds.find((x) => x.id === l.medicationId);
    if (l.medicationId && !m) throw badRequest("Un medicamento del catálogo no existe");
    return { name: `${l.drug}${m && !l.drug.toLowerCase().includes(m.generic_name.toLowerCase()) ? ` ${m.generic_name}` : ""}`, tags: m?.allergy_tags ?? [] };
  });
}

const zAck = z.boolean().default(false);

/** Inserta el documento clínico congelado, su nota en la historia y su PDF. */
export async function issueClinicalDocument(c: Client, auth: AuthCtx, publicUrl: string, o: {
  patientId: string; branchId: string; kind: "prescription" | "certificate" | "referral"; template: TemplateId | null; title: string; summary: string;
  content: Partial<ClinicalSnapshot>; warnings: unknown[]; ack: boolean; reissueOfId: string | null; noteKind: string; noteBody: string;
}) {
  requireBranch(auth, o.branchId);
  const p = (await c.query<{ archived_at: Date | null }>("SELECT archived_at FROM patients WHERE id = $1", [o.patientId])).rows[0];
  if (!p) throw notFound("Paciente");
  let reissueOf: string | null = null;
  if (o.reissueOfId) {
    const r = (await c.query(
      `SELECT d.patient_id, d.kind, d.snapshot->>'docNumber' AS num, EXISTS (SELECT 1 FROM clinical_document_voids v WHERE v.document_id = d.id) AS voided,
              EXISTS (SELECT 1 FROM clinical_documents x WHERE x.reissue_of = d.id) AS reissued
         FROM clinical_documents d WHERE d.id = $1`, [o.reissueOfId])).rows[0];
    if (!r || r.patient_id !== o.patientId || r.kind !== o.kind) throw badRequest("El documento a reemplazar no corresponde a este paciente o tipo");
    if (!r.voided) throw conflict("Primero anula el documento con su motivo; luego se reemite corregido", "not_voided");
    if (r.reissued) throw conflict("Ese documento ya fue reemitido", "already_reissued");
    reissueOf = r.num;
  }
  const issuer = await issuerInfo(c, auth);
  const head = await letterheadData(c, o.branchId);
  const now = new Date();
  const n = await nextCounter(c, auth.clinicId!, `doc_${o.kind}`);
  const number = docNumber(o.kind, n);
  const snapshot = {
    type: o.kind, template: o.template, docNumber: number, title: o.title, issuedAt: now.toISOString(), ...head,
    patient: await patientSnap(c, o.patientId, now, head.clinic.timezone), issuer, reissueOf, voided: null, ...o.content,
  } as ClinicalSnapshot;
  const hash = snapshotHash(snapshot);
  const note = (await c.query<{ id: string }>(
    `INSERT INTO clinical_notes (clinic_id, patient_id, branch_id, kind, body, author_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
    [auth.clinicId, o.patientId, o.branchId, o.noteKind, `${o.title} ${number} emitido. ${o.noteBody}`.slice(0, 20000), auth.userId])).rows[0]!.id;
  const id = (await c.query<{ id: string }>(
    `INSERT INTO clinical_documents (clinic_id, patient_id, branch_id, kind, template, number, title, summary, snapshot, issuer_id, issuer_name, issuer_license,
        allergy_warnings, allergy_acknowledged, reissue_of, note_id, content_hash, issued_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18) RETURNING id`,
    [auth.clinicId, o.patientId, o.branchId, o.kind, o.template, n, o.title, o.summary.slice(0, 500), JSON.stringify(snapshot), auth.userId, issuer.name, issuer.license,
      JSON.stringify(o.warnings), o.ack, o.reissueOfId, note, hash, now])).rows[0]!.id;
  const { row } = await storePdf(c, {
    clinicId: auth.clinicId!, kind: o.kind, sourceId: id, variant: "original", docNumber: number, title: o.title, branchId: o.branchId, issuedAt: now,
    snapshot, generatedBy: auth.userId, publicUrl, issuer,
  });
  await audit(c, auth, `${o.kind}.issued`, "clinical_document", id, {
    number, patientId: o.patientId, contentHash: hash, verifyCode: row.verify_code, allergyWarnings: o.warnings, allergyAcknowledged: o.ack, reissueOf: o.reissueOfId,
  }, o.branchId);
  return { id, number, contentHash: hash, verifyCode: formatVerifyCode(row.verify_code), licenseMissing: !issuer.license };
}


export function documentRoutes(route: Route, cfg: Config) {
  // =====================================================================
  // Catálogo de medicamentos
  // =====================================================================
  const canSeeCatalog = (a: AuthCtx) => a.permissions.has("clinical.read") || a.permissions.has("clinic.manage");
  const zMed = z.object({
    genericName: z.string().trim().min(2, "Nombre genérico muy corto").max(120),
    presentation: z.string().trim().min(2, "Indica la presentación").max(120),
    defaultDose: zOptText(80), defaultFrequency: zOptText(80), defaultDuration: zOptText(60), defaultInstructions: zOptText(300),
    allergyTags: z.array(z.string().trim().toLowerCase().min(3).max(40)).max(12).default([]),
    active: z.boolean().default(true),
  });
  const MED_COLS = `id, generic_name AS "genericName", presentation, default_dose AS "defaultDose", default_frequency AS "defaultFrequency",
    default_duration AS "defaultDuration", default_instructions AS "defaultInstructions", allergy_tags AS "allergyTags", active, updated_at AS "updatedAt"`;

  route({
    method: "GET", url: "/api/medications", summary: "Catálogo de medicamentos de la clínica (requiere clinical.read o clinic.manage)", tags: ["documentos"],
    query: z.object({ all: z.enum(["1", "0"]).optional() }),
    handler: async ({ c, auth, query }) => {
      if (!canSeeCatalog(auth)) throw forbidden();
      return (await c.query(`SELECT ${MED_COLS} FROM medications WHERE ($1::boolean OR active) ORDER BY lower(generic_name), lower(presentation)`, [query.all === "1"])).rows;
    },
  });

  route({
    method: "POST", url: "/api/medications", summary: "Agregar un medicamento al catálogo", tags: ["documentos"], perm: "clinic.manage", body: zMed,
    handler: async ({ c, auth, body }) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO medications (clinic_id, generic_name, presentation, default_dose, default_frequency, default_duration, default_instructions, allergy_tags, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.clinicId, body.genericName, body.presentation, body.defaultDose, body.defaultFrequency, body.defaultDuration, body.defaultInstructions, body.allergyTags, body.active],
      ).catch((e) => { throw e?.code === "23505" ? conflict("Ya existe ese medicamento con esa presentación", "duplicate_medication") : e; });
      await audit(c, auth, "medication.created", "medication", r.rows[0]!.id, { genericName: body.genericName, presentation: body.presentation });
      return { id: r.rows[0]!.id };
    },
  });

  route({
    method: "PUT", url: "/api/medications/:id", summary: "Editar un medicamento (desactivar en vez de borrar: las recetas emitidas conservan su copia)", tags: ["documentos"],
    perm: "clinic.manage", params: zIdParams, body: zMed,
    handler: async ({ c, auth, params, body }) => {
      const before = (await c.query(`SELECT ${MED_COLS} FROM medications WHERE id = $1`, [params.id])).rows[0];
      if (!before) throw notFound("Medicamento");
      await c.query(
        `UPDATE medications SET generic_name=$2, presentation=$3, default_dose=$4, default_frequency=$5, default_duration=$6, default_instructions=$7,
            allergy_tags=$8, active=$9, updated_at=now() WHERE id=$1`,
        [params.id, body.genericName, body.presentation, body.defaultDose, body.defaultFrequency, body.defaultDuration, body.defaultInstructions, body.allergyTags, body.active],
      ).catch((e) => { throw e?.code === "23505" ? conflict("Ya existe ese medicamento con esa presentación", "duplicate_medication") : e; });
      await audit(c, auth, "medication.updated", "medication", params.id, { before, after: body });
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/medications/seed", summary: "Cargar los medicamentos del catálogo inicial que falten (no duplica ni reactiva)", tags: ["documentos"], perm: "clinic.manage",
    handler: async ({ c, auth }) => {
      const n = (await c.query<{ n: number }>("SELECT seed_medications($1) AS n", [auth.clinicId])).rows[0]!.n;
      await audit(c, auth, "medication.seeded", "medication", null, { added: n });
      return { added: n };
    },
  });

  // =====================================================================
  // Recetas, certificados y derivaciones
  // =====================================================================
  route({
    method: "GET", url: "/api/certificate-templates", summary: "Plantillas de certificados y derivaciones de la clínica (texto vigente, versión y marcadores; requiere clinical.read o clinic.manage)", tags: ["documentos"],
    handler: async ({ c, auth }) => {
      if (!canSeeCatalog(auth)) throw forbidden();
      return effectiveTemplates(c);
    },
  });

  route({
    method: "GET", url: "/api/certificate-templates/:template/versions", summary: "Historial de versiones del texto de una plantilla de certificado", tags: ["documentos"], perm: "clinic.manage",
    params: z.object({ template: z.enum(TEMPLATE_IDS) }),
    handler: async ({ c, params }) => (await c.query(
      `SELECT v.version, v.title, v.body, v.is_default AS "isDefault", v.note, v.created_at AS "createdAt", u.full_name AS "byName"
         FROM certificate_template_versions v JOIN users u ON u.id = v.created_by WHERE v.template = $1 ORDER BY v.version DESC LIMIT 100`, [params.template])).rows,
  });

  route({
    method: "POST", url: "/api/certificate-templates/:template/versions", summary: "Guardar una versión nueva del título y el texto de una plantilla (o volver al texto original)", tags: ["documentos"], perm: "clinic.manage",
    params: z.object({ template: z.enum(TEMPLATE_IDS) }),
    body: z.object({
      restoreDefault: z.boolean().default(false),
      title: z.string().trim().min(3, "Escribe el título").max(120).optional(),
      body: z.string().trim().min(20, "El texto es muy corto").max(5000, "El texto es muy largo").optional(),
      note: zOptText(300),
    }),
    handler: async ({ c, auth, params, body }) => {
      const base = CERT_TEMPLATES[params.template];
      const title = body.restoreDefault ? base.title : body.title;
      const text = body.restoreDefault ? base.body : body.body;
      if (!title || !text) throw badRequest("Escribe el título y el texto, o elige volver al texto original");
      const bad = unknownPlaceholders(params.template, text);
      if (bad.length) throw badRequest(`Marcadores que no existen en esta plantilla: ${bad.join(", ")}`, [{ path: "body", message: `Usa solo: ${placeholdersOf(params.template).map((x) => `{${x}}`).join(" ")}` }]);
      if (!text.includes("{paciente}")) throw badRequest("El texto debe incluir {paciente}", [{ path: "body", message: "Falta {paciente}" }]);
      const missing = base.fields.filter((f) => f.required && !text.includes(`{${f.key}}`) && !(f.key === "restFrom" && text.includes("{restTo}")));
      if (missing.length) throw badRequest(`El texto debe usar los datos obligatorios: ${missing.map((f) => `{${f.key}} (${f.label})`).join(", ")}`, [{ path: "body", message: "Faltan datos obligatorios" }]);
      await c.query("SELECT pg_advisory_xact_lock(hashtext('cert-tpl:' || $1 || ':' || $2))", [auth.clinicId, params.template]);
      const cur = (await c.query<{ version: number; title: string; body: string }>(
        "SELECT version, title, body FROM certificate_template_versions WHERE template = $1 ORDER BY version DESC LIMIT 1", [params.template])).rows[0];
      if ((cur ? cur.title === title && cur.body === text : title === base.title && text === base.body)) throw conflict("No hay cambios respecto del texto vigente", "no_changes");
      const version = (cur?.version ?? 0) + 1;
      await c.query(
        "INSERT INTO certificate_template_versions (clinic_id, template, version, title, body, is_default, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [auth.clinicId, params.template, version, title, text, title === base.title && text === base.body, body.note, auth.userId]);
      await audit(c, auth, "certificate_template.versioned", "certificate_template", null, { template: params.template, version, restoreDefault: body.restoreDefault });
      return { version };
    },
  });

  route({
    method: "GET", url: "/api/patients/:id/prescription-context", summary: "Datos para recetar: alergias de la última historia, edad del paciente y matrícula del profesional", tags: ["documentos"],
    perm: "clinical.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const tz = (await c.query<{ timezone: string }>("SELECT timezone FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!.timezone;
      const patient = await patientSnap(c, params.id, new Date(), tz);
      return { patient, ...(await latestAllergies(c, params.id)), issuer: await issuerInfo(c, auth), canIssue: auth.permissions.has("clinical.write") };
    },
  });

  route({
    method: "POST", url: "/api/patients/:id/allergy-check", summary: "Aviso de alergias (no bloqueante) para las líneas de una receta en preparación", tags: ["documentos"],
    perm: "clinical.read", params: zIdParams,
    body: z.object({ lines: z.array(z.object({ medicationId: zId.nullish().transform((v) => v ?? null), drug: z.string().trim().max(160) })).max(10) }),
    handler: async ({ c, params, body }) => {
      if (!(await c.query("SELECT 1 FROM patients WHERE id = $1", [params.id])).rowCount) throw notFound("Paciente");
      const mh = await latestHistory(c, params.id);
      const allergies = mh?.data?.allergies?.trim() || null;
      const valid = body.lines.map((l) => ({ ...l, drug: l.drug || "—", presentation: null, dose: "-", frequency: "-", duration: "-", instructions: null }));
      const tagged = await linesWithTags(c, valid);
      return { allergies, currentMedications: mh?.data?.medications?.trim() || null, warnings: allergyWarnings(allergies, tagged), interactions: interactionWarnings(mh?.data, tagged) };
    },
  });

  route({
    method: "GET", url: "/api/patients/:id/clinical-documents", summary: "Recetas, certificados y derivaciones emitidos del paciente", tags: ["documentos"], perm: "clinical.read", params: zIdParams,
    handler: async ({ c, params }) => (await c.query(
      `SELECT d.id, d.kind, d.template, d.title, d.summary, d.snapshot->>'docNumber' AS "docNumber", d.issued_at AS "issuedAt", d.issuer_name AS "issuerName",
              d.issuer_license AS "issuerLicense", d.allergy_acknowledged AS "allergyAcknowledged", jsonb_array_length(d.allergy_warnings) AS "allergyWarnings",
              d.reissue_of AS "reissueOf", b.name AS "branchName", v.voided_at AS "voidedAt", v.reason AS "voidReason", vu.full_name AS "voidedByName",
              (SELECT r.id FROM clinical_documents r WHERE r.reissue_of = d.id) AS "reissuedById",
              (SELECT p.verify_code FROM pdf_documents p WHERE p.kind = d.kind AND p.source_id = d.id AND p.variant = 'original') AS "verifyCode"
         FROM clinical_documents d JOIN branches b ON b.id = d.branch_id
         LEFT JOIN clinical_document_voids v ON v.document_id = d.id LEFT JOIN users vu ON vu.id = v.voided_by
        WHERE d.patient_id = $1 ORDER BY d.issued_at DESC LIMIT 300`, [params.id])).rows
      .map((r) => ({ ...r, verifyCode: r.verifyCode ? formatVerifyCode(r.verifyCode) : null, status: r.voidedAt ? "voided" : "valid" })),
  });

  route({
    method: "GET", url: "/api/clinical-documents/:id", summary: "Documento emitido con su contenido congelado (para reemitir corregido)", tags: ["documentos"], perm: "clinical.read", params: zIdParams,
    handler: async ({ c, params }) => {
      const d = (await c.query(
        `SELECT d.id, d.kind, d.template, d.patient_id AS "patientId", d.branch_id AS "branchId", d.snapshot, d.content_hash AS "contentHash", d.issued_at AS "issuedAt",
                v.voided_at AS "voidedAt", v.reason AS "voidReason"
           FROM clinical_documents d LEFT JOIN clinical_document_voids v ON v.document_id = d.id WHERE d.id = $1`, [params.id])).rows[0];
      if (!d) throw notFound("Documento");
      return { ...d, integrityOk: snapshotHash(d.snapshot) === d.contentHash };
    },
  });

  route({
    method: "POST", url: "/api/patients/:id/prescriptions", summary: "Emitir receta (queda congelada con su PDF y huella). Con posible alergia exige acknowledgeAllergy", tags: ["documentos"],
    perm: "clinical.write", params: zIdParams,
    body: z.object({
      branchId: zId,
      lines: z.array(zLine).min(1, "Agrega al menos un medicamento").max(10, "Máximo 10 medicamentos por receta"),
      indications: zOptText(2000),
      acknowledgeAllergy: zAck,
      reissueOfId: zId.nullish().transform((v) => v ?? null),
    }),
    handler: async ({ c, auth, params, body }) => {
      const mh = await latestHistory(c, params.id);
      const allergies = mh?.data?.allergies?.trim() || null;
      const tagged = await linesWithTags(c, body.lines);
      const warnings = allergyWarnings(allergies, tagged);
      // B-075: las interacciones solo AVISAN (no bloquean); quedan anotadas en la historia.
      const interactions = interactionWarnings(mh?.data, tagged);
      if (warnings.length && !body.acknowledgeAllergy) {
        throw new AppError(409, "allergy_ack_required",
          `Posible alergia: ${warnings.map((w) => `${w.drug} (declaró «${w.allergy}»)`).join(", ")}. Revisa y marca «Revisé la alergia» para emitir igualmente.`, { warnings });
      }
      const lines: RxLine[] = body.lines.map((l) => ({ drug: l.drug, presentation: l.presentation, dose: l.dose, frequency: l.frequency, duration: l.duration, instructions: l.instructions }));
      const summary = lines.map((l) => `${l.drug}${l.presentation ? ` ${l.presentation}` : ""}`).join(", ");
      const noteBody = lines.map((l, i) => `${i + 1}. ${l.drug}${l.presentation ? ` (${l.presentation})` : ""}: ${l.dose}, ${l.frequency}, ${l.duration}.`).join(" ")
        + (warnings.length ? ` Aviso de alergia revisado por el profesional (${warnings.map((w) => w.allergy).join(", ")}).` : "")
        + (interactions.length ? ` Aviso de interacción mostrado al emitir: ${interactions.map((w) => `${w.drug} con ${w.with} (${w.text})`).join("; ")}.` : "");
      const issued = await issueClinicalDocument(c, auth, cfg.publicUrl, {
        patientId: params.id, branchId: body.branchId, kind: "prescription", template: null, title: "Receta", summary,
        content: { lines, indications: body.indications, allergies }, warnings, ack: warnings.length > 0 && body.acknowledgeAllergy,
        reissueOfId: body.reissueOfId, noteKind: "prescription", noteBody,
      });
      return { ...issued, interactions };
    },
  });

  const zFieldVal = z.union([z.string().trim().max(2000), z.number()]).nullish();
  route({
    method: "POST", url: "/api/patients/:id/certificates", summary: "Emitir certificado o derivación desde una plantilla (texto final congelado con su PDF y huella)", tags: ["documentos"],
    perm: "clinical.write", params: zIdParams,
    body: z.object({
      branchId: zId,
      template: z.enum(TEMPLATE_IDS),
      fields: z.record(z.string().max(40), zFieldVal).default({}),
      body: z.string().trim().min(20, "El texto es muy corto").max(5000, "El texto es muy largo"),
      reissueOfId: zId.nullish().transform((v) => v ?? null),
    }),
    handler: async ({ c, auth, params, body }) => {
      const t = (await effectiveTemplates(c)).find((x) => x.id === body.template)!;
      const fields: Record<string, string | number | null> = {};
      for (const f of t.fields) {
        const v = body.fields[f.key];
        const empty = v === null || v === undefined || v === "";
        if (f.required && empty) throw badRequest(`Completa «${f.label}»`, [{ path: `fields.${f.key}`, message: "Obligatorio" }]);
        if (!empty && f.type === "date" && !zDate.safeParse(v).success) throw badRequest(`«${f.label}»: fecha inválida`);
        if (!empty && f.type === "number" && !(Number.isInteger(Number(v)) && Number(v) >= 1 && Number(v) <= 90)) throw badRequest(`«${f.label}»: entre 1 y 90`);
        if (!empty && f.type === "select" && !f.options!.includes(String(v))) throw badRequest(`«${f.label}»: opción inválida`);
        fields[f.key] = empty ? null : v!;
      }
      const left = body.body.match(/\{[a-zA-Z_]+\}/g);
      if (left) throw badRequest(`Falta completar en el texto: ${[...new Set(left)].join(", ")}`);
      if (body.template === "rest" && fields.restFrom) {
        fields.restTo = DateTime.fromISO(String(fields.restFrom)).plus({ days: Number(fields.restDays) - 1 }).toISODate();
      }
      const summary = body.template === "rest" ? `Reposo de ${fields.restDays} día(s) desde ${String(fields.restFrom).split("-").reverse().join("/")}`
        : body.template === "referral" ? `A ${fields.specialty}${fields.recipient ? ` (${fields.recipient})` : ""}: ${fields.reason}`
          : body.template === "attendance" ? `Atención del ${String(fields.attendedOn).split("-").reverse().join("/")}: ${fields.reason}`
            : `${fields.status} tratamiento: ${fields.treatment}`;
      return issueClinicalDocument(c, auth, cfg.publicUrl, {
        patientId: params.id, branchId: body.branchId, kind: t.kind, template: body.template, title: t.title, summary,
        content: { body: body.body, fields, templateVersion: t.version }, warnings: [], ack: false, reissueOfId: body.reissueOfId,
        noteKind: t.kind === "referral" ? "referral" : "other", noteBody: summary,
      });
    },
  });

  route({
    method: "POST", url: "/api/clinical-documents/:id/void", summary: "Anular un documento emitido con motivo (no se borra; se genera la copia marcada ANULADA)", tags: ["documentos"],
    perm: "clinical.write", params: zIdParams, body: z.object({ reason: z.string().trim().min(3, "Escribe el motivo").max(500) }),
    handler: async ({ c, auth, params, body }) => {
      const d = (await c.query("SELECT id, kind, branch_id, patient_id, snapshot, note_id, title FROM clinical_documents WHERE id = $1", [params.id])).rows[0];
      if (!d) throw notFound("Documento");
      requireBranch(auth, d.branch_id);
      const v = await c.query<{ voided_at: Date }>(
        "INSERT INTO clinical_document_voids (clinic_id, document_id, reason, voided_by) VALUES ($1,$2,$3,$4) ON CONFLICT ON CONSTRAINT clinical_document_void_once DO NOTHING RETURNING voided_at",
        [auth.clinicId, params.id, body.reason, auth.userId]);
      if (!v.rows[0]) throw conflict("Ese documento ya fue anulado", "already_voided");
      const snap = { ...(d.snapshot as ClinicalSnapshot), voided: { at: new Date(v.rows[0].voided_at).toISOString(), reason: body.reason, by: auth.fullName } };
      await storePdf(c, {
        clinicId: auth.clinicId!, kind: d.kind, sourceId: d.id, variant: "voided", docNumber: snap.docNumber, title: d.title, branchId: d.branch_id,
        issuedAt: new Date(snap.issuedAt), snapshot: snap, generatedBy: auth.userId, publicUrl: cfg.publicUrl, issuer: snap.issuer,
      });
      await c.query(
        "INSERT INTO clinical_notes (clinic_id, patient_id, branch_id, kind, body, amends_note_id, author_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [auth.clinicId, d.patient_id, d.branch_id, d.kind === "prescription" ? "prescription" : d.kind === "referral" ? "referral" : "other",
          `${d.title} ${snap.docNumber} ANULADO. Motivo: ${body.reason}`, d.note_id, auth.userId]);
      await audit(c, auth, `${d.kind}.voided`, "clinical_document", params.id, { number: snap.docNumber, reason: body.reason }, d.branch_id);
      return { ok: true };
    },
  });

  // =====================================================================
  // Descargas (cada una auditada)
  // =====================================================================
  async function logDownload(c: Client, auth: AuthCtx, row: PdfRow, created: boolean) {
    await audit(c, auth, "pdf.downloaded", row.kind, row.source_id, { verifyCode: row.verify_code, variant: row.variant, docNumber: row.doc_number, generated: created }, row.branch_id);
  }

  route({
    method: "GET", url: "/api/clinical-documents/:id/pdf", summary: "Descargar el PDF de una receta, certificado o derivación (la copia ANULADA si fue anulado)", tags: ["documentos"],
    perm: "clinical.read", params: zIdParams,
    handler: async ({ c, auth, params, reply }) => {
      const d = (await c.query<{ kind: "prescription" | "certificate" | "referral" }>("SELECT kind FROM clinical_documents WHERE id = $1", [params.id])).rows[0];
      if (!d) throw notFound("Documento");
      const row = (await findPdf(c, d.kind, params.id, "voided")) ?? (await findPdf(c, d.kind, params.id, "original"));
      if (!row) throw notFound("PDF");
      await logDownload(c, auth, row, false);
      return sendPdf(reply, row);
    },
  });

  route({
    method: "GET", url: "/api/budgets/:id/pdf", summary: "PDF del presupuesto aceptado (líneas, totales, cuotas, aceptación y firma). Se genera una vez y se guarda", tags: ["documentos"],
    perm: "budgets.read", params: zIdParams,
    handler: async ({ c, auth, params, reply }) => {
      const b = (await c.query<{ status: string; branch_id: string }>("SELECT status, branch_id FROM budgets WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!b) throw notFound("Presupuesto");
      requireBranch(auth, b.branch_id);
      const original = await findPdf(c, "budget", params.id, "original");
      let res: { row: PdfRow; created: boolean };
      if (b.status === "accepted" || b.status === "completed") {
        if (original) res = { row: original, created: false };
        else {
          const s = await budgetSnapshot(c, params.id);
          res = await storePdf(c, { clinicId: auth.clinicId!, kind: "budget", sourceId: params.id, variant: "original", docNumber: s.snap.docNumber, title: s.snap.title,
            branchId: s.branchId, issuedAt: s.issuedAt, snapshot: s.snap, generatedBy: auth.userId, publicUrl: cfg.publicUrl, signaturePng: s.signaturePng });
        }
      } else if (b.status === "cancelled" && original) {
        const snap = { ...original.snapshot, voided: { at: new Date().toISOString(), reason: "Presupuesto anulado por la clínica", by: auth.fullName } } as typeof original.snapshot;
        const sig = (await budgetSnapshot(c, params.id)).signaturePng;
        res = await storePdf(c, { clinicId: auth.clinicId!, kind: "budget", sourceId: params.id, variant: "voided", docNumber: original.doc_number, title: original.title,
          branchId: original.branch_id, issuedAt: new Date(original.issued_at), snapshot: snap, generatedBy: auth.userId, publicUrl: cfg.publicUrl, signaturePng: sig });
      } else throw conflict("El PDF se emite para presupuestos aceptados", "invalid_status");
      await logDownload(c, auth, res.row, res.created);
      return sendPdf(reply, res.row);
    },
  });

  route({
    method: "GET", url: "/api/consent-documents/:id/pdf", summary: "PDF del consentimiento firmado (texto, firma y huella SHA-256). Se genera una vez y se guarda", tags: ["documentos"],
    perm: "patients.read", params: zIdParams,
    handler: async ({ c, auth, params, reply }) => {
      const k = (await c.query<{ kind: string }>("SELECT kind FROM signed_documents WHERE id = $1", [params.id])).rows[0];
      const allowed = k && (k.kind === "informed_consent" ? auth.permissions.has("clinical.read") || auth.permissions.has("budgets.read") : true);
      if (!allowed) throw notFound("Documento");
      let res: { row: PdfRow; created: boolean };
      const existing = await findPdf(c, "consent", params.id, "original");
      if (existing) res = { row: existing, created: false };
      else {
        const s = await consentSnapshot(c, params.id);
        res = await storePdf(c, { clinicId: auth.clinicId!, kind: "consent", sourceId: params.id, variant: "original", docNumber: s.snap.docNumber, title: s.snap.title,
          branchId: s.branchId, issuedAt: s.issuedAt, snapshot: s.snap, generatedBy: auth.userId, publicUrl: cfg.publicUrl, signaturePng: s.signaturePng });
      }
      await logDownload(c, auth, res.row, res.created);
      return sendPdf(reply, res.row);
    },
  });

  route({
    method: "GET", url: "/api/payments/:id/receipt.pdf", summary: "Recibo de pago en PDF (no es factura fiscal). Solo pagos confirmados; un pago anulado sale marcado ANULADO", tags: ["documentos"],
    perm: "payments.read", params: zIdParams,
    handler: async ({ c, auth, params, reply }) => {
      const p = (await c.query<{ status: string; branch_id: string }>("SELECT status, branch_id FROM payments WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!p) throw notFound("Pago");
      requireBranch(auth, p.branch_id);
      if (p.status !== "confirmed" && p.status !== "voided") throw conflict("El recibo se emite cuando el pago está confirmado", "invalid_status");
      const variant = p.status === "voided" ? "voided" : "original";
      let res: { row: PdfRow; created: boolean };
      const existing = await findPdf(c, "receipt", params.id, variant);
      if (existing) res = { row: existing, created: false };
      else {
        const s = await receiptSnapshot(c, params.id);
        const snap = variant === "voided"
          ? { ...s.snap, voided: { at: new Date().toISOString(), reason: s.row.status_reason ?? "Pago anulado", by: auth.fullName } }
          : s.snap;
        res = await storePdf(c, { clinicId: auth.clinicId!, kind: "receipt", sourceId: params.id, variant, docNumber: s.snap.docNumber, title: s.snap.title,
          branchId: s.branchId, issuedAt: s.issuedAt, snapshot: snap, generatedBy: auth.userId, publicUrl: cfg.publicUrl });
      }
      await logDownload(c, auth, res.row, res.created);
      return sendPdf(reply, res.row);
    },
  });

  // =====================================================================
  // Verificación pública (sin sesión, sin datos del paciente)
  // =====================================================================
  route({
    method: "GET", url: "/api/public/verify/:code", access: "public", limit: { max: 30, timeWindow: "1 minute" },
    summary: "Verificar un documento por su código: existe, está íntegro, tipo, fecha y clínica (nunca datos del paciente)", tags: ["público"],
    params: z.object({ code: z.string().max(40) }),
    handler: async ({ c, params, reply }) => {
      const code = normalizeVerifyCode(params.code);
      const notFoundBody = { found: false, message: "No encontramos un documento con ese código. Revisa que esté bien escrito." };
      if (!code) { reply.code(404); return notFoundBody; }
      const clinicId = (await c.query<{ id: string | null }>("SELECT pdf_document_clinic($1) AS id", [code])).rows[0]?.id;
      if (!clinicId) { reply.code(404); return notFoundBody; }
      await c.query("SELECT set_config('app.clinic_id', $1, true)", [clinicId]);
      const row = (await c.query<PdfRow>("SELECT * FROM pdf_documents WHERE verify_code = $1", [code])).rows[0];
      if (!row) { reply.code(404); return notFoundBody; }
      const result = await verifyRow(c, row);
      await c.query(
        "INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, ip) VALUES ($1, NULL, 'pdf.verified', $2, $3, $4, $5, NULL)",
        [clinicId, row.kind, row.source_id, row.branch_id, JSON.stringify({ verifyCode: code, intact: result.intact, status: result.status, by: "verificación pública" })]);
      return { ...result, code: formatVerifyCode(code) };
    },
  });
}
