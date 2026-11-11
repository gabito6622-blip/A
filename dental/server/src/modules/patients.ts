import { z } from "zod";
import ExcelJS from "exceljs";
import type { Route } from "../lib/http.js";
import { zDate, zIdParams, zOptText } from "../lib/http.js";
import { AppError, badRequest, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { nextCounter, type Client } from "../lib/db.js";
import { normalize, normalizePhone } from "../lib/text.js";
import type { AuthCtx } from "../lib/rbac.js";
import { recordConsentFlag } from "./consents.js";
import { patientMoney } from "./budgets-v2-core.js";
import { createRelationship, prefillGuardian, zFamilyLink } from "./experience/family.js";

export const PATIENT_COLUMNS = `p.id, p.record_number AS "recordNumber", p.first_name AS "firstName", p.last_name AS "lastName",
  p.document_type AS "documentType", p.document_number AS "documentNumber", p.document_issued AS "documentIssued",
  p.birth_date AS "birthDate", p.sex, p.phone, p.email, p.address, p.city, p.occupation,
  p.guardian_name AS "guardianName", p.guardian_phone AS "guardianPhone", p.guardian_relationship AS "guardianRelationship",
  p.referral_source AS "referralSource", p.notes, p.preferred_branch_id AS "preferredBranchId",
  p.consent_reminders AS "consentReminders", p.consent_marketing AS "consentMarketing", p.consent_updated_at AS "consentUpdatedAt",
  p.created_at AS "createdAt", p.archived_at AS "archivedAt"`;

export const patientBody = z.object({
  firstName: z.string().trim().min(1, "Nombre obligatorio").max(80),
  lastName: z.string().trim().min(1, "Apellido obligatorio").max(80),
  documentType: z.enum(["CI", "PASAPORTE", "CE", "OTRO", "SIN"]).default("CI"),
  documentNumber: zOptText(30),
  documentIssued: zOptText(10),
  birthDate: zDate.nullish().transform((v) => v ?? null),
  sex: z.enum(["F", "M", "X"]).nullish().transform((v) => v ?? null),
  phone: zOptText(30),
  email: z.email("Correo inválido").nullish().or(z.literal("")).transform((v) => (v ? v.toLowerCase() : null)),
  address: zOptText(200),
  city: zOptText(80),
  occupation: zOptText(80),
  guardianName: zOptText(120),
  guardianPhone: zOptText(30),
  guardianRelationship: zOptText(40),
  referralSource: zOptText(80),
  notes: zOptText(2000),
  preferredBranchId: z.uuid().nullish().transform((v) => v ?? null),
  consentReminders: z.boolean().default(false),
  consentMarketing: z.boolean().default(false),
});
export type PatientInput = z.infer<typeof patientBody>;

function searchText(p: Pick<PatientInput, "firstName" | "lastName" | "documentNumber" | "phone">, recordNumber: number) {
  return normalize(`${p.firstName} ${p.lastName} ${p.documentNumber ?? ""} ${p.phone ?? ""} ${recordNumber}`);
}

function isMinor(birthDate: string | null): boolean {
  if (!birthDate) return false;
  const b = new Date(birthDate + "T00:00:00Z");
  const now = new Date();
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) age--;
  return age < 18;
}

function validatePatient(p: PatientInput) {
  if (p.documentType !== "SIN" && !p.documentNumber) throw badRequest("Indica el número de documento o elige 'Sin documento'");
  if (p.birthDate && p.birthDate > new Date().toISOString().slice(0, 10)) throw badRequest("La fecha de nacimiento no puede ser futura");
  if (isMinor(p.birthDate) && !p.guardianName) throw badRequest("Para menores de edad indica el nombre del responsable");
}

/**
 * Posibles duplicados: mismo documento, mismo teléfono, o nombre muy parecido + misma fecha de nacimiento.
 * Un celular compartido con un familiar declarado (R2-39) se informa como «mismo celular, familiar declarado»
 * y no bloquea el registro (declaredFamily = true).
 */
export async function findDuplicates(c: Client, p: Partial<PatientInput>, excludeId: string | null = null, familyOf: string | null = null) {
  const name = normalize(`${p.firstName ?? ""} ${p.lastName ?? ""}`);
  const phone = normalizePhone(p.phone ?? null);
  const r = await c.query(
    `SELECT p.id, p.record_number AS "recordNumber", p.first_name AS "firstName", p.last_name AS "lastName",
            p.document_number AS "documentNumber", p.phone, p.birth_date AS "birthDate",
            CASE WHEN $1::text IS NOT NULL AND p.document_number = $1 THEN 'documento'
                 WHEN $2::text IS NOT NULL AND p.phone = $2 AND fam.declared THEN 'mismo celular, familiar declarado'
                 WHEN $2::text IS NOT NULL AND p.phone = $2 THEN 'teléfono'
                 ELSE 'nombre' END AS reason,
            fam.declared AND ($1::text IS NULL OR p.document_number IS DISTINCT FROM $1) AS "declaredFamily"
       FROM patients p
       CROSS JOIN LATERAL (SELECT (p.id = $6::uuid OR EXISTS (SELECT 1 FROM patient_relationships r WHERE r.ended_at IS NULL
                  AND ((r.person_a = p.id AND r.person_b IN ($5::uuid, $6::uuid)) OR (r.person_b = p.id AND r.person_a IN ($5::uuid, $6::uuid))))) IS TRUE AS declared) fam
      WHERE p.archived_at IS NULL AND ($5::uuid IS NULL OR p.id <> $5)
        AND (($1::text IS NOT NULL AND p.document_number = $1)
          OR ($2::text IS NOT NULL AND p.phone = $2)
          OR (length($3) > 5 AND word_similarity($3, p.search_text) > 0.75 AND ($4::date IS NULL OR p.birth_date IS NULL OR p.birth_date = $4)))
      LIMIT 5`,
    [p.documentNumber ?? null, phone, name, p.birthDate ?? null, excludeId, familyOf],
  );
  return r.rows;
}

export async function insertPatient(c: Client, auth: AuthCtx, body: PatientInput) {
  validatePatient(body);
  const recordNumber = await nextCounter(c, auth.clinicId!, "patient");
  const phone = normalizePhone(body.phone);
  const r = await c.query<{ id: string }>(
    `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, document_number, document_issued, birth_date, sex,
        phone, email, address, city, occupation, guardian_name, guardian_phone, guardian_relationship, referral_source, notes,
        preferred_branch_id, consent_reminders, consent_marketing, consent_updated_at, search_text, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22, CASE WHEN $21 OR $22 THEN now() END, $23, $24)
     RETURNING id`,
    [
      auth.clinicId, recordNumber, body.firstName, body.lastName, body.documentType, body.documentNumber, body.documentIssued, body.birthDate,
      body.sex, phone, body.email, body.address, body.city, body.occupation, body.guardianName, normalizePhone(body.guardianPhone),
      body.guardianRelationship, body.referralSource, body.notes, body.preferredBranchId, body.consentReminders, body.consentMarketing,
      searchText({ ...body, phone }, recordNumber), auth.userId,
    ],
  );
  return { id: r.rows[0]!.id, recordNumber };
}

const IMPORT_HEADERS: Record<string, keyof PatientInput> = {
  nombre: "firstName", nombres: "firstName", apellido: "lastName", apellidos: "lastName",
  ci: "documentNumber", documento: "documentNumber", "numero de documento": "documentNumber", "nro documento": "documentNumber",
  expedido: "documentIssued", "fecha de nacimiento": "birthDate", nacimiento: "birthDate", sexo: "sex",
  telefono: "phone", celular: "phone", whatsapp: "phone", correo: "email", email: "email", direccion: "address", ciudad: "city",
  ocupacion: "occupation", responsable: "guardianName", "telefono responsable": "guardianPhone", notas: "notes", observaciones: "notes",
};

function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === "object") {
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("richText" in v) return v.richText.map((t) => t.text).join("");
    return "";
  }
  return String(v).trim();
}

function parseDate(s: string): string | null {
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/); // dd/mm/aaaa
  if (m) return `${m[3]}-${m[2]!.padStart(2, "0")}-${m[1]!.padStart(2, "0")}`;
  return null;
}

export function patientRoutes(route: Route) {
  route({
    method: "GET", url: "/api/patients", summary: "Buscar pacientes (nombre, CI, teléfono o N° de ficha)", tags: ["pacientes"], perm: "patients.read",
    query: z.object({ q: z.string().max(100).optional(), limit: z.coerce.number().int().min(1).max(200).default(50), offset: z.coerce.number().int().min(0).default(0), archived: z.enum(["1", "0"]).optional() }),
    handler: async ({ c, query }) => {
      const q = normalize(query.q);
      const tokens = q ? q.split(" ").filter(Boolean).map((t) => `%${t.replace(/[%_\\]/g, "")}%`) : [];
      const r = await c.query(
        `SELECT ${PATIENT_COLUMNS},
                (SELECT min(a.starts_at) FROM appointments a WHERE a.patient_id = p.id AND a.starts_at > now() AND a.status NOT IN ('cancelled','no_show')) AS "nextAppointment",
                count(*) OVER() AS total
           FROM patients p
          WHERE ($1 = '' OR p.search_text LIKE ALL($5::text[]) OR word_similarity($1, p.search_text) > 0.7)
            AND (($4::boolean AND p.archived_at IS NOT NULL) OR (NOT $4::boolean AND p.archived_at IS NULL))
          ORDER BY CASE WHEN $1 = '' THEN 0 ELSE 1 - word_similarity($1, p.search_text) END, p.last_name, p.first_name
          LIMIT $2 OFFSET $3`,
        [q, query.limit, query.offset, query.archived === "1", tokens],
      );
      return { total: Number(r.rows[0]?.total ?? 0), items: r.rows.map(({ total, ...x }) => x) };
    },
  });

  route({
    method: "POST", url: "/api/patients/check-duplicates", summary: "Detectar posibles duplicados antes de registrar", tags: ["pacientes"], perm: "patients.write",
    body: patientBody.partial().extend({ excludeId: z.uuid().optional() }),
    handler: async ({ c, body }) => ({ duplicates: await findDuplicates(c, body, body.excludeId ?? null) }),
  });

  route({
    method: "POST", url: "/api/patients", summary: "Registrar paciente", tags: ["pacientes"], perm: "patients.write",
    body: patientBody.extend({ allowDuplicate: z.boolean().default(false), family: zFamilyLink.optional() }),
    handler: async ({ c, auth, body }) => {
      if (!body.allowDuplicate) {
        // El celular compartido con el familiar que se declara al registrar no es un duplicado.
        const d = (await findDuplicates(c, body, null, body.family?.relatedPatientId ?? null)).filter((x) => !x.declaredFamily);
        if (d.length) throw new AppError(409, "possible_duplicate", "Hay pacientes parecidos ya registrados", { duplicates: d });
      }
      if (body.family) await prefillGuardian(c, body);
      const res = await insertPatient(c, auth, body);
      if (body.family) await createRelationship(c, auth, res.id, body.family);
      const who = { id: res.id, name: `${body.firstName} ${body.lastName}`, preferredBranchId: body.preferredBranchId };
      if (body.consentReminders) await recordConsentFlag(c, auth, who, "reminders", true);
      if (body.consentMarketing) await recordConsentFlag(c, auth, who, "marketing", true);
      await audit(c, auth, "patient.created", "patient", res.id, { recordNumber: res.recordNumber });
      return res;
    },
  });

  route({
    method: "GET", url: "/api/patients/:id", summary: "Ficha del paciente (resumen)", tags: ["pacientes"], perm: "patients.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const p = (await c.query(`SELECT ${PATIENT_COLUMNS} FROM patients p WHERE p.id = $1`, [params.id])).rows[0];
      if (!p) throw notFound("Paciente");
      // R2-11: mismo cálculo que la cuenta del paciente y las cuentas por cobrar.
      const balance = auth.permissions.has("payments.read") || auth.permissions.has("budgets.read")
        ? await patientMoney(c, params.id).then((m) => ({ ...m, balance: m.balanceCents, pending: m.pendingVerificationCents }))
        : null;
      const appts = (
        await c.query(
          `SELECT a.id, a.starts_at AS "startsAt", a.ends_at AS "endsAt", a.status, a.reason, b.name AS "branchName", u.full_name AS "dentistName"
             FROM appointments a JOIN branches b ON b.id = a.branch_id JOIN users u ON u.id = a.dentist_id
            WHERE a.patient_id = $1 ORDER BY a.starts_at DESC LIMIT 20`,
          [params.id],
        )
      ).rows;
      let alerts: string[] = [];
      if (auth.permissions.has("clinical.read")) {
        const mh = (await c.query<{ data: Record<string, unknown> }>("SELECT data FROM medical_histories WHERE patient_id = $1 ORDER BY recorded_at DESC LIMIT 1", [params.id])).rows[0];
        if (mh) {
          const d = mh.data as { allergies?: string; conditions?: string[]; anticoagulants?: boolean; pregnant?: boolean };
          if (d.allergies) alerts.push(`Alergias: ${d.allergies}`);
          if (d.anticoagulants) alerts.push("Toma anticoagulantes");
          if (d.pregnant) alerts.push("Embarazo");
          for (const cond of d.conditions ?? []) alerts.push(cond);
        }
      }
      await audit(c, auth, "patient.viewed", "patient", params.id);
      return { patient: p, account: balance, appointments: appts, alerts };
    },
  });

  route({
    method: "PUT", url: "/api/patients/:id", summary: "Editar datos del paciente", tags: ["pacientes"], perm: "patients.write", params: zIdParams, body: patientBody,
    handler: async ({ c, auth, body, params }) => {
      validatePatient(body);
      const prev = (await c.query<{ record_number: number; consent_reminders: boolean; consent_marketing: boolean }>(
        "SELECT record_number, consent_reminders, consent_marketing FROM patients WHERE id = $1", [params.id])).rows[0];
      if (!prev) throw notFound("Paciente");
      const phone = normalizePhone(body.phone);
      const consentChanged = prev.consent_reminders !== body.consentReminders || prev.consent_marketing !== body.consentMarketing;
      await c.query(
        `UPDATE patients SET first_name=$2, last_name=$3, document_type=$4, document_number=$5, document_issued=$6, birth_date=$7, sex=$8,
            phone=$9, email=$10, address=$11, city=$12, occupation=$13, guardian_name=$14, guardian_phone=$15, guardian_relationship=$16,
            referral_source=$17, notes=$18, preferred_branch_id=$19, consent_reminders=$20, consent_marketing=$21,
            consent_updated_at = CASE WHEN $22 THEN now() ELSE consent_updated_at END, search_text=$23, updated_at=now()
          WHERE id=$1`,
        [
          params.id, body.firstName, body.lastName, body.documentType, body.documentNumber, body.documentIssued, body.birthDate, body.sex,
          phone, body.email, body.address, body.city, body.occupation, body.guardianName, normalizePhone(body.guardianPhone), body.guardianRelationship,
          body.referralSource, body.notes, body.preferredBranchId, body.consentReminders, body.consentMarketing, consentChanged,
          searchText({ ...body, phone }, prev.record_number),
        ],
      );
      const who = { id: params.id, name: `${body.firstName} ${body.lastName}`, preferredBranchId: body.preferredBranchId };
      if (prev.consent_reminders !== body.consentReminders) await recordConsentFlag(c, auth, who, "reminders", body.consentReminders);
      if (prev.consent_marketing !== body.consentMarketing) await recordConsentFlag(c, auth, who, "marketing", body.consentMarketing);
      await audit(c, auth, "patient.updated", "patient", params.id, consentChanged ? { consentReminders: body.consentReminders, consentMarketing: body.consentMarketing } : {});
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/patients/:id/archive", summary: "Archivar paciente (no se borra: el expediente se conserva)", tags: ["pacientes"], perm: "patients.write", params: zIdParams,
    body: z.object({ archived: z.boolean() }),
    handler: async ({ c, auth, params, body }) => {
      const r = await c.query("UPDATE patients SET archived_at = CASE WHEN $2 THEN now() ELSE NULL END, updated_at = now() WHERE id = $1", [params.id, body.archived]);
      if (!r.rowCount) throw notFound("Paciente");
      await audit(c, auth, body.archived ? "patient.archived" : "patient.restored", "patient", params.id);
      return { ok: true };
    },
  });

  // ---------------- Antecedentes médicos ----------------
  const zHistory = z.object({
    allergies: zOptText(500),
    medications: zOptText(500),
    conditions: z.array(z.string().trim().max(80)).max(30).default([]),
    anticoagulants: z.boolean().default(false),
    pregnant: z.boolean().default(false),
    smoker: z.boolean().default(false),
    bloodPressure: zOptText(20),
    observations: zOptText(2000),
  });

  route({
    method: "GET", url: "/api/patients/:id/medical-history", summary: "Antecedentes médicos (versión vigente e historial)", tags: ["clínico"], perm: "clinical.read", params: zIdParams,
    handler: async ({ c, params }) =>
      (
        await c.query(
          `SELECT m.id, m.data, m.recorded_at AS "recordedAt", u.full_name AS "recordedBy"
             FROM medical_histories m JOIN users u ON u.id = m.recorded_by WHERE m.patient_id = $1 ORDER BY m.recorded_at DESC LIMIT 20`,
          [params.id],
        )
      ).rows,
  });

  route({
    method: "POST", url: "/api/patients/:id/medical-history", summary: "Registrar nueva versión de antecedentes médicos", tags: ["clínico"], perm: "clinical.write", params: zIdParams, body: zHistory,
    handler: async ({ c, auth, params, body }) => {
      const r = await c.query<{ id: string }>(
        "INSERT INTO medical_histories (clinic_id, patient_id, data, recorded_by) VALUES ($1,$2,$3,$4) RETURNING id",
        [auth.clinicId, params.id, JSON.stringify(body), auth.userId],
      );
      await audit(c, auth, "medical_history.recorded", "patient", params.id);
      return { id: r.rows[0]!.id };
    },
  });

  // ---------------- Importación desde Excel ----------------
  route({
    method: "POST", url: "/api/patients/import", summary: "Importar pacientes desde Excel (.xlsx). dryRun=true solo valida y muestra el resultado.",
    tags: ["pacientes"], perm: "patients.import",
    body: z.object({ fileBase64: z.string().max(14_000_000), dryRun: z.boolean().default(true) }),
    handler: async ({ c, auth, body }) => {
      const wb = new ExcelJS.Workbook();
      try {
        await wb.xlsx.load(Buffer.from(body.fileBase64, "base64") as unknown as ArrayBuffer);
      } catch {
        throw badRequest("El archivo no es un Excel (.xlsx) válido");
      }
      const ws = wb.worksheets[0];
      if (!ws) throw badRequest("El archivo no tiene hojas");
      const header = (ws.getRow(1).values as ExcelJS.CellValue[]).map((v) => normalize(cellText(v)));
      const map = new Map<number, keyof PatientInput>();
      header.forEach((h, i) => { const k = IMPORT_HEADERS[h]; if (k) map.set(i, k); });
      if (![...map.values()].includes("firstName") || ![...map.values()].includes("lastName")) {
        throw badRequest("La primera fila debe tener columnas 'Nombre' y 'Apellido' (opcionales: CI, Expedido, Fecha de nacimiento, Sexo, Teléfono, Correo, Dirección, Ciudad, Notas)");
      }
      if (ws.rowCount > 5001) throw badRequest("Máximo 5000 filas por importación");
      const results: { row: number; status: "ok" | "error" | "duplicate"; message?: string; recordNumber?: number }[] = [];
      const seenDocs = new Set<string>();
      for (let i = 2; i <= ws.rowCount; i++) {
        const row = ws.getRow(i);
        const raw: Record<string, unknown> = {};
        for (const [col, key] of map) raw[key] = cellText(row.getCell(col).value) || null;
        if (!raw.firstName && !raw.lastName) continue;
        raw.birthDate = raw.birthDate ? parseDate(String(raw.birthDate)) : null;
        const sx = String(raw.sex ?? "").toUpperCase();
        raw.sex = sx.startsWith("F") ? "F" : sx.startsWith("M") ? "M" : null;
        raw.documentType = raw.documentNumber ? "CI" : "SIN";
        const parsed = patientBody.safeParse(raw);
        if (!parsed.success) {
          results.push({ row: i, status: "error", message: parsed.error.issues.map((x) => x.message).join("; ") });
          continue;
        }
        const p = parsed.data;
        if (p.documentNumber) {
          if (seenDocs.has(p.documentNumber)) { results.push({ row: i, status: "duplicate", message: "Documento repetido en el archivo" }); continue; }
          seenDocs.add(p.documentNumber);
        }
        const dups = await findDuplicates(c, p);
        if (dups.some((d) => d.reason === "documento")) { results.push({ row: i, status: "duplicate", message: `Ya existe (ficha ${dups[0]!.recordNumber})` }); continue; }
        if (body.dryRun) {
          try { validatePatient(p); results.push({ row: i, status: "ok" }); } catch (e) { results.push({ row: i, status: "error", message: (e as Error).message }); }
          continue;
        }
        try {
          await c.query("SAVEPOINT imp");
          const res = await insertPatient(c, auth, p);
          await c.query("RELEASE SAVEPOINT imp");
          results.push({ row: i, status: "ok", recordNumber: res.recordNumber });
        } catch (e) {
          await c.query("ROLLBACK TO SAVEPOINT imp");
          results.push({ row: i, status: "error", message: (e as Error).message });
        }
      }
      const summary = {
        dryRun: body.dryRun,
        ok: results.filter((r) => r.status === "ok").length,
        duplicates: results.filter((r) => r.status === "duplicate").length,
        errors: results.filter((r) => r.status === "error").length,
      };
      if (!body.dryRun) await audit(c, auth, "patient.imported", "patient", null, summary);
      return { summary, results };
    },
  });

  // ---------------- Exportación ----------------
  route({
    method: "GET", url: "/api/patients/export.xlsx", summary: "Exportar padrón de pacientes (Excel)", tags: ["pacientes"], perm: "patients.export", raw: true,
    handler: async ({ c, auth, reply }) => {
      const r = await c.query(`SELECT ${PATIENT_COLUMNS} FROM patients p WHERE p.archived_at IS NULL ORDER BY p.record_number`);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Pacientes");
      ws.columns = [
        { header: "Ficha", key: "recordNumber", width: 8 }, { header: "Nombre", key: "firstName", width: 20 },
        { header: "Apellido", key: "lastName", width: 22 }, { header: "Documento", key: "documentNumber", width: 14 },
        { header: "Expedido", key: "documentIssued", width: 9 }, { header: "Fecha de nacimiento", key: "birthDate", width: 14 },
        { header: "Sexo", key: "sex", width: 6 }, { header: "Teléfono", key: "phone", width: 15 }, { header: "Correo", key: "email", width: 26 },
        { header: "Ciudad", key: "city", width: 14 }, { header: "Acepta recordatorios", key: "consentReminders", width: 12 },
      ];
      ws.getRow(1).font = { bold: true };
      // Evita inyección de fórmulas al abrir en Excel
      const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@]/.test(v) ? `'${v}` : v);
      for (const p of r.rows) ws.addRow(Object.fromEntries(Object.entries(p).map(([k, v]) => [k, k === "consentReminders" ? (v ? "Sí" : "No") : safe(v)])));
      await audit(c, auth, "patient.exported", "patient", null, { count: r.rowCount });
      const buf = await wb.xlsx.writeBuffer();
      reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="pacientes-${new Date().toISOString().slice(0, 10)}.xlsx"`)
        .send(Buffer.from(buf));
    },
  });
}
