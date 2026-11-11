// Consentimientos versionados y documentos firmados (solo inserción).
//
// - Las plantillas tienen versión: editar = crear una versión nueva (la anterior queda para la historia).
// - Cada firma guarda una COPIA del texto exacto, el firmante, la decisión y un hash SHA-256 del conjunto.
// - Los consentimientos de recordatorios y marketing actualizan las marcas de la ficha del paciente.
// Los textos modelo son referenciales y deben ser revisados por asesoría legal antes de usarse.
import { createHash } from "node:crypto";
import { z } from "zod";
import type { Route } from "../lib/http.js";
import { zId, zIdParams, zOptText } from "../lib/http.js";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../lib/rbac.js";

export const KINDS = ["data_processing", "reminders", "marketing", "informed_consent"] as const;
export type Kind = (typeof KINDS)[number];
export const KIND_LABELS: Record<Kind, string> = {
  data_processing: "Tratamiento de datos personales y de salud",
  reminders: "Recordatorios por WhatsApp/SMS",
  marketing: "Promociones y novedades",
  informed_consent: "Consentimiento informado",
};

const DISCLAIMER = "\n\n[Texto modelo referencial. Debe ser revisado por la asesoría legal de la clínica antes de usarse.]";

export const DEFAULT_TEMPLATES: { kind: Kind; title: string; category: string | null; body: string }[] = [
  {
    kind: "data_processing", title: "Aviso de privacidad y tratamiento de datos", category: null,
    body: `Yo, {paciente}, autorizo a {clinica} a registrar y conservar mis datos personales y de salud con la finalidad de brindarme atención odontológica, llevar mi expediente clínico, gestionar citas, presupuestos y pagos.

Entiendo que:
- Mis datos solo serán accesibles por personal autorizado de la clínica según su función.
- El expediente clínico se conserva por el plazo que exige la normativa sanitaria y no se elimina.
- Los proveedores tecnológicos de la clínica (sistema de gestión y alojamiento) tratan los datos por cuenta de la clínica y con medidas de seguridad.
- Puedo solicitar acceso a mis datos y la corrección de datos inexactos.

Fecha: {fecha}.${DISCLAIMER}`,
  },
  {
    kind: "reminders", title: "Recordatorios de citas", category: null,
    body: `Yo, {paciente}, autorizo a {clinica} a enviarme recordatorios y confirmaciones de mis citas por WhatsApp o SMS al número registrado. Los mensajes no incluirán información sobre mi diagnóstico o tratamiento. Puedo retirar esta autorización en cualquier momento. Fecha: {fecha}.${DISCLAIMER}`,
  },
  {
    kind: "marketing", title: "Promociones y novedades", category: null,
    body: `Yo, {paciente}, autorizo a {clinica} a enviarme promociones, campañas preventivas y novedades. Cada mensaje incluirá la forma de darme de baja. Fecha: {fecha}.${DISCLAIMER}`,
  },
  {
    kind: "informed_consent", title: "Consentimiento informado general", category: "General",
    body: `Yo, {paciente}, declaro que el/la profesional me explicó en lenguaje comprensible el diagnóstico, el tratamiento propuesto ({procedimiento}), sus beneficios, riesgos frecuentes y graves, alternativas (incluida la de no tratarme) y cuidados posteriores, y que pude hacer preguntas.

Acepto voluntariamente el tratamiento y sé que puedo revocar este consentimiento antes de su realización.

Fecha: {fecha}.${DISCLAIMER}`,
  },
  {
    kind: "informed_consent", title: "Consentimiento para extracción dental", category: "Cirugía",
    body: `Yo, {paciente}, autorizo la extracción de la(s) pieza(s) indicada(s) ({procedimiento}). Se me informó de riesgos como dolor, inflamación, sangrado, infección (alveolitis), lesión de piezas vecinas, comunicación con el seno maxilar o alteración temporal de la sensibilidad, y de las indicaciones posoperatorias.

Informé mis antecedentes médicos, alergias y medicamentos (incluidos anticoagulantes).

Fecha: {fecha}.${DISCLAIMER}`,
  },
  {
    kind: "informed_consent", title: "Consentimiento para endodoncia", category: "Endodoncia",
    body: `Yo, {paciente}, autorizo el tratamiento de conducto ({procedimiento}). Se me informó que el pronóstico no es 100% seguro, que puede requerir varias sesiones, que puede haber molestias posoperatorias, fractura de instrumentos o de la pieza, y que posteriormente la pieza puede necesitar una restauración o corona.

Fecha: {fecha}.${DISCLAIMER}`,
  },
];

export async function seedConsentTemplates(c: Client, clinicId: string, userId: string | null) {
  for (const t of DEFAULT_TEMPLATES) {
    await c.query(
      `INSERT INTO consent_templates (clinic_id, kind, title, body, version, category, created_by) VALUES ($1,$2,$3,$4,1,$5,$6)
       ON CONFLICT (clinic_id, kind, title, version) DO NOTHING`,
      [clinicId, t.kind, t.title, t.body, t.category, userId],
    );
  }
}

export function render(body: string, vars: Record<string, string>) {
  return body.replace(/\{(\w+)\}/g, (m, k: string) => vars[k] ?? m);
}

export function contentHash(d: { kind: string; title: string; body: string; decision: string; signerName: string; signerDocument: string | null; signerRelationship: string; signedAt: string; signaturePng: string | null }) {
  const sig = d.signaturePng ? createHash("sha256").update(d.signaturePng).digest("hex") : null;
  const canonical = JSON.stringify([d.kind, d.title, d.body, d.decision, d.signerName, d.signerDocument, d.signerRelationship, d.signedAt, sig]);
  return createHash("sha256").update(canonical).digest("hex");
}

async function defaultBranch(c: Client, auth: AuthCtx, preferred?: string | null): Promise<string> {
  const allowed = allowedBranches(auth);
  if (preferred && (allowed === null || allowed.includes(preferred))) return preferred;
  if (allowed && allowed[0]) return allowed[0];
  const b = (await c.query<{ id: string }>("SELECT id FROM branches WHERE active ORDER BY code LIMIT 1")).rows[0];
  if (!b) throw badRequest("La clínica no tiene sucursales");
  return b.id;
}

function canSign(auth: AuthCtx, kind: Kind) {
  return kind === "informed_consent"
    ? auth.permissions.has("clinical.write") || auth.permissions.has("budgets.write")
    : auth.permissions.has("patients.write");
}
function canView(auth: AuthCtx, kind: Kind) {
  return kind === "informed_consent" ? auth.permissions.has("clinical.read") || auth.permissions.has("budgets.read") : auth.permissions.has("patients.read");
}

/** Registra el cambio de una marca de consentimiento hecho desde la ficha (sin firma, por el personal). */
export async function recordConsentFlag(c: Client, auth: AuthCtx, patient: { id: string; name: string; preferredBranchId: string | null }, kind: "reminders" | "marketing", granted: boolean) {
  const t = (await c.query<{ id: string; title: string; body: string; version: number }>(
    "SELECT id, title, body, version FROM consent_templates WHERE kind = $1 AND active ORDER BY version DESC LIMIT 1", [kind])).rows[0];
  const clinic = (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!.name;
  const title = t?.title ?? KIND_LABELS[kind];
  const signedAt = new Date().toISOString();
  const body = render(t?.body ?? KIND_LABELS[kind], { paciente: patient.name, clinica: clinic, fecha: signedAt.slice(0, 10), procedimiento: "—" });
  const decision = granted ? "granted" : "revoked";
  const hash = contentHash({ kind, title, body, decision, signerName: patient.name, signerDocument: null, signerRelationship: "self", signedAt, signaturePng: null });
  await c.query(
    `INSERT INTO signed_documents (clinic_id, patient_id, branch_id, template_id, kind, title, body, template_version, decision, method, signer_name, signer_relationship, content_hash, recorded_by, signed_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'staff_registered',$10,'self',$11,$12,$13,'Registrado por el personal desde la ficha (sin firma)')`,
    [auth.clinicId, patient.id, await defaultBranch(c, auth, patient.preferredBranchId), t?.id ?? null, kind, title, body, t?.version ?? null, decision, patient.name, hash, auth.userId, signedAt],
  );
}

/**
 * Consentimiento vigente para mensajes (recordatorios y marketing): la marca de la ficha y,
 * además, que el último documento de ese tipo no sea una revocación o un rechazo.
 */
export async function messagingConsent(c: Client, patientId: string): Promise<{ reminders: boolean; marketing: boolean }> {
  const p = (await c.query<{ consent_reminders: boolean; consent_marketing: boolean }>(
    "SELECT consent_reminders, consent_marketing FROM patients WHERE id = $1", [patientId])).rows[0];
  if (!p) return { reminders: false, marketing: false };
  const last = (await c.query<{ kind: string; decision: string }>(
    "SELECT DISTINCT ON (kind) kind, decision FROM signed_documents WHERE patient_id = $1 AND kind IN ('reminders','marketing') ORDER BY kind, signed_at DESC",
    [patientId])).rows;
  const ok = (k: "reminders" | "marketing", flag: boolean) => flag && !["revoked", "refused"].includes(last.find((x) => x.kind === k)?.decision ?? "");
  return { reminders: ok("reminders", p.consent_reminders), marketing: ok("marketing", p.consent_marketing) };
}

/**
 * Revocación hecha por el propio paciente (portal "Dejar de recibir mensajes" o respuesta «BAJA»):
 * documento inmutable con método 'online_checkbox' (sin personal que la registre) y marca de la ficha en falso.
 */
export async function recordPatientRevocation(
  c: Client, actor: Pick<AuthCtx, "userId" | "clinicId" | "ip">,
  p: { patientId: string; branchId: string; kind: "reminders" | "marketing"; notes: string },
): Promise<boolean> {
  const pat = (await c.query<{ name: string; birth_date: string | null; guardian_name: string | null; consent_reminders: boolean; consent_marketing: boolean }>(
    "SELECT first_name || ' ' || last_name AS name, birth_date, guardian_name, consent_reminders, consent_marketing FROM patients WHERE id = $1", [p.patientId])).rows[0];
  if (!pat) throw notFound("Paciente");
  const current = p.kind === "reminders" ? pat.consent_reminders : pat.consent_marketing;
  const lastDecision = (await c.query<{ decision: string }>(
    "SELECT decision FROM signed_documents WHERE patient_id = $1 AND kind = $2 ORDER BY signed_at DESC LIMIT 1", [p.patientId, p.kind])).rows[0]?.decision;
  if (!current && lastDecision !== "granted") return false; // ya no recibía: nada que revocar
  const minor = pat.birth_date ? new Date(pat.birth_date).getTime() > Date.now() - 18 * 365.25 * 86_400_000 : false;
  const signerName = minor ? pat.guardian_name ?? `Responsable de ${pat.name}` : pat.name;
  const relationship = minor ? "guardian" : "self";
  const t = (await c.query<{ id: string; title: string; body: string; version: number }>(
    "SELECT id, title, body, version FROM consent_templates WHERE kind = $1 AND active ORDER BY version DESC LIMIT 1", [p.kind])).rows[0];
  const clinic = (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [actor.clinicId])).rows[0]?.name ?? "";
  const title = t?.title ?? KIND_LABELS[p.kind];
  const signedAt = new Date().toISOString();
  const body = render(t?.body ?? KIND_LABELS[p.kind], { paciente: pat.name, clinica: clinic, fecha: signedAt.slice(0, 10), procedimiento: "—" });
  const hash = contentHash({ kind: p.kind, title, body, decision: "revoked", signerName, signerDocument: null, signerRelationship: relationship, signedAt, signaturePng: null });
  await c.query(
    `INSERT INTO signed_documents (clinic_id, patient_id, branch_id, template_id, kind, title, body, template_version, decision, method, signer_name,
        signer_relationship, content_hash, recorded_by, signed_at, notes)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'revoked','online_checkbox',$9,$10,$11,NULL,$12,$13)`,
    [actor.clinicId, p.patientId, p.branchId, t?.id ?? null, p.kind, title, body, t?.version ?? null, signerName, relationship, hash, signedAt, p.notes]);
  const col = p.kind === "reminders" ? "consent_reminders" : "consent_marketing";
  await c.query(`UPDATE patients SET ${col} = false, consent_updated_at = now(), updated_at = now() WHERE id = $1`, [p.patientId]);
  await audit(c, actor, "consent.revoked_by_patient", "patient", p.patientId, { kind: p.kind, method: "online_checkbox", notes: p.notes }, p.branchId);
  return true;
}

export function consentRoutes(route: Route) {
  // ---------------- Plantillas ----------------
  route({
    method: "GET", url: "/api/consent-templates", summary: "Plantillas de consentimiento vigentes (o todas las versiones)", tags: ["consentimientos"],
    query: z.object({ all: z.enum(["1", "0"]).optional(), kind: z.enum(KINDS).optional() }),
    handler: async ({ c, query }) =>
      (await c.query(
        `SELECT t.id, t.kind, t.title, t.body, t.version, t.category, t.active, t.created_at AS "createdAt",
                r.created_at AS "reviewedAt", ru.full_name AS "reviewedByName", r.note AS "reviewNote"
           FROM consent_templates t
           LEFT JOIN LATERAL (SELECT x.created_at, x.reviewed_by, x.note FROM consent_template_reviews x WHERE x.template_id = t.id ORDER BY x.created_at DESC LIMIT 1) r ON true
           LEFT JOIN users ru ON ru.id = r.reviewed_by
          WHERE ($1::boolean OR t.active) AND ($2::text IS NULL OR t.kind = $2) ORDER BY t.kind, t.title, t.version DESC`,
        [query.all === "1", query.kind ?? null])).rows.map((t) => ({ ...t, kindLabel: KIND_LABELS[t.kind as Kind] })),
  });

  route({
    method: "POST", url: "/api/consent-templates", summary: "Crear plantilla o nueva versión de una existente (la anterior se desactiva, no se borra)", tags: ["consentimientos"], perm: "clinic.manage",
    body: z.object({ kind: z.enum(KINDS), title: z.string().trim().min(3).max(150), body: z.string().trim().min(20).max(30000), category: zOptText(60) }),
    handler: async ({ c, auth, body }) => {
      const prev = (await c.query<{ v: number | null }>("SELECT max(version) AS v FROM consent_templates WHERE kind = $1 AND title = $2", [body.kind, body.title])).rows[0]!.v ?? 0;
      await c.query("UPDATE consent_templates SET active = false WHERE kind = $1 AND title = $2 AND active", [body.kind, body.title]);
      const r = await c.query<{ id: string }>(
        "INSERT INTO consent_templates (clinic_id, kind, title, body, version, category, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [auth.clinicId, body.kind, body.title, body.body, prev + 1, body.category, auth.userId]);
      await audit(c, auth, "consent_template.versioned", "consent_template", r.rows[0]!.id, { kind: body.kind, title: body.title, version: prev + 1 });
      return { id: r.rows[0]!.id, version: prev + 1 };
    },
  });

  route({
    method: "POST", url: "/api/consent-templates/:id/review",
    summary: "Marcar una versión de plantilla como revisada por la clínica (revisión interna: no declara validez legal)", tags: ["consentimientos"], perm: "clinic.manage", params: zIdParams,
    body: z.object({ note: zOptText(300) }),
    handler: async ({ c, auth, params, body }) => {
      const t = (await c.query<{ title: string; version: number }>("SELECT title, version FROM consent_templates WHERE id = $1", [params.id])).rows[0];
      if (!t) throw notFound("Plantilla");
      const r = (await c.query<{ id: string; created_at: Date }>(
        "INSERT INTO consent_template_reviews (clinic_id, template_id, reviewed_by, note) VALUES ($1,$2,$3,$4) RETURNING id, created_at",
        [auth.clinicId, params.id, auth.userId, body.note])).rows[0]!;
      await audit(c, auth, "consent_template.reviewed", "consent_template", params.id, { title: t.title, version: t.version, note: body.note });
      return { id: r.id, reviewedAt: r.created_at };
    },
  });

  route({
    method: "POST", url: "/api/consent-templates/:id/active", summary: "Activar o desactivar una plantilla", tags: ["consentimientos"], perm: "clinic.manage", params: zIdParams,
    body: z.object({ active: z.boolean() }),
    handler: async ({ c, auth, params, body }) => {
      const r = await c.query("UPDATE consent_templates SET active = $2 WHERE id = $1", [params.id, body.active]);
      if (!r.rowCount) throw notFound("Plantilla");
      await audit(c, auth, "consent_template.active", "consent_template", params.id, body);
      return { ok: true };
    },
  });

  // ---------------- Documentos del paciente ----------------
  route({
    method: "GET", url: "/api/patients/:id/documents", summary: "Consentimientos y documentos firmados del paciente (los que el rol puede ver)", tags: ["consentimientos"], perm: "patients.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const rows = (await c.query(
        `SELECT d.id, d.kind, d.title, d.template_version AS "templateVersion", d.decision, d.method, d.signer_name AS "signerName",
                d.signer_relationship AS "signerRelationship", d.signed_at AS "signedAt", d.content_hash AS "contentHash", d.budget_id AS "budgetId",
                COALESCE(u.full_name, 'El paciente (reserva web)') AS "recordedBy", b.name AS "branchName"
           FROM signed_documents d LEFT JOIN users u ON u.id = d.recorded_by JOIN branches b ON b.id = d.branch_id
          WHERE d.patient_id = $1 ORDER BY d.signed_at DESC`, [params.id])).rows;
      const visible = rows.filter((r) => canView(auth, r.kind));
      // Estado vigente por tipo (último registro)
      const current: Record<string, string> = {};
      for (const r of [...visible].reverse()) if (r.kind !== "informed_consent") current[r.kind] = r.decision;
      return { current, documents: visible.map((r) => ({ ...r, kindLabel: KIND_LABELS[r.kind as Kind] })) };
    },
  });

  route({
    method: "GET", url: "/api/documents/:id", summary: "Documento firmado completo (texto, firmante y firma) con verificación de integridad", tags: ["consentimientos"], perm: "patients.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const d = (await c.query(
        `SELECT d.*, COALESCE(u.full_name, 'El paciente (reserva web)') AS recorded_by_name, b.name AS branch_name, b.address AS branch_address, cl.name AS clinic_name,
                p.first_name || ' ' || p.last_name AS patient_name, p.record_number
           FROM signed_documents d LEFT JOIN users u ON u.id = d.recorded_by JOIN branches b ON b.id = d.branch_id
           JOIN clinics cl ON cl.id = d.clinic_id JOIN patients p ON p.id = d.patient_id WHERE d.id = $1`, [params.id])).rows[0];
      if (!d || !canView(auth, d.kind)) throw notFound("Documento");
      const expected = contentHash({
        kind: d.kind, title: d.title, body: d.body, decision: d.decision, signerName: d.signer_name, signerDocument: d.signer_document,
        signerRelationship: d.signer_relationship, signedAt: new Date(d.signed_at).toISOString(), signaturePng: d.signature_png,
      });
      await audit(c, auth, "document.viewed", "patient", d.patient_id, { documentId: d.id });
      return {
        id: d.id, kind: d.kind, kindLabel: KIND_LABELS[d.kind as Kind], title: d.title, body: d.body, templateVersion: d.template_version,
        decision: d.decision, method: d.method, signerName: d.signer_name, signerDocument: d.signer_document, signerRelationship: d.signer_relationship,
        signaturePng: d.signature_png, notes: d.notes, signedAt: d.signed_at, recordedBy: d.recorded_by_name, branchName: d.branch_name,
        branchAddress: d.branch_address, clinicName: d.clinic_name, patientName: d.patient_name, recordNumber: d.record_number,
        contentHash: d.content_hash, integrityOk: expected === d.content_hash,
      };
    },
  });

  route({
    method: "POST", url: "/api/patients/:id/documents", summary: "Registrar un consentimiento firmado (en pantalla o en papel) o su revocación", tags: ["consentimientos"], perm: "patients.read", params: zIdParams,
    body: z.object({
      templateId: zId,
      branchId: zId.optional(),
      decision: z.enum(["granted", "refused", "revoked"]),
      method: z.enum(["signature_pad", "paper_signed"]),
      signerName: z.string().trim().min(3).max(150),
      signerDocument: zOptText(30),
      signerRelationship: z.enum(["self", "guardian", "legal_representative"]).default("self"),
      signaturePng: z.string().max(400_000).nullish().transform((v) => v ?? null),
      procedure: zOptText(300),
      budgetId: zId.nullish().transform((v) => v ?? null),
      notes: zOptText(500),
    }),
    handler: async ({ c, auth, params, body }) => {
      const t = (await c.query<{ id: string; kind: Kind; title: string; body: string; version: number; active: boolean }>(
        "SELECT id, kind, title, body, version, active FROM consent_templates WHERE id = $1", [body.templateId])).rows[0];
      if (!t) throw notFound("Plantilla");
      if (!t.active) throw new AppError(409, "template_inactive", "Esa versión de la plantilla ya no está vigente");
      if (!canSign(auth, t.kind)) throw forbidden();
      if (body.method === "signature_pad" && !body.signaturePng?.startsWith("data:image/png;base64,")) throw badRequest("Falta la firma");
      const p = (await c.query<{ name: string; birth_date: string | null; preferred_branch_id: string | null; guardian_name: string | null }>(
        "SELECT first_name || ' ' || last_name AS name, birth_date, preferred_branch_id, guardian_name FROM patients WHERE id = $1", [params.id])).rows[0];
      if (!p) throw notFound("Paciente");
      const minor = p.birth_date ? new Date(p.birth_date).getTime() > Date.now() - 18 * 365.25 * 86_400_000 : false;
      if (minor && body.signerRelationship === "self") throw badRequest("El paciente es menor de edad: debe firmar su madre, padre o representante legal");
      if (body.budgetId) {
        const b = (await c.query<{ patient_id: string }>("SELECT patient_id FROM budgets WHERE id = $1", [body.budgetId])).rows[0];
        if (!b || b.patient_id !== params.id) throw badRequest("El presupuesto no corresponde al paciente");
      }
      const branchId = body.branchId ?? (await defaultBranch(c, auth, p.preferred_branch_id));
      requireBranch(auth, branchId);
      const clinic = (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!.name;
      const signedAt = new Date().toISOString();
      const text = render(t.body, { paciente: p.name, clinica: clinic, fecha: signedAt.slice(0, 10), procedimiento: body.procedure ?? "según presupuesto" });
      const hash = contentHash({ kind: t.kind, title: t.title, body: text, decision: body.decision, signerName: body.signerName, signerDocument: body.signerDocument, signerRelationship: body.signerRelationship, signedAt, signaturePng: body.signaturePng });
      const r = await c.query<{ id: string }>(
        `INSERT INTO signed_documents (clinic_id, patient_id, branch_id, template_id, kind, title, body, template_version, decision, method, signer_name, signer_document,
            signer_relationship, signature_png, budget_id, notes, content_hash, recorded_by, signed_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19) RETURNING id`,
        [auth.clinicId, params.id, branchId, t.id, t.kind, t.title, text, t.version, body.decision, body.method, body.signerName, body.signerDocument,
          body.signerRelationship, body.signaturePng, body.budgetId, body.notes, hash, auth.userId, signedAt],
      );
      if (t.kind === "reminders" || t.kind === "marketing") {
        const col = t.kind === "reminders" ? "consent_reminders" : "consent_marketing";
        await c.query(`UPDATE patients SET ${col} = $2, consent_updated_at = now(), updated_at = now() WHERE id = $1`, [params.id, body.decision === "granted"]);
      }
      await audit(c, auth, "document.signed", "patient", params.id, { documentId: r.rows[0]!.id, kind: t.kind, decision: body.decision, method: body.method }, branchId);
      return { id: r.rows[0]!.id, contentHash: hash };
    },
  });
}
