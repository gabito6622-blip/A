// Convenios con empresas, colegios y asociaciones; afiliación de pacientes; precios del convenio.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zDate, zId, zIdParams, zMoney, zOptText } from "../../lib/http.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { Client } from "../../lib/db.js";
import { zPercent } from "../budgets-v2-core.js";
import { AGREEMENT_KINDS, activeAgreementFor, agreementPrice, clinicToday, companyUsedThisYear } from "./core.js";

const zRule = z.object({
  procedureId: zId.nullish().transform((v) => v ?? null),
  category: z.string().trim().max(60).nullish().transform((v) => v || null),
  priceCents: zMoney.nullish().transform((v) => v ?? null),
  discountPercent: zPercent.nullish().transform((v) => v ?? null),
}).superRefine((r, ctx) => {
  if (!!r.procedureId === !!r.category) ctx.addIssue({ code: "custom", path: ["procedureId"], message: "Cada regla es para una prestación o para una categoría" });
  if ((r.priceCents === null) === (r.discountPercent === null)) ctx.addIssue({ code: "custom", path: ["priceCents"], message: "Indica un precio especial o un % de descuento (uno solo)" });
  if (r.category && r.priceCents !== null) ctx.addIssue({ code: "custom", path: ["priceCents"], message: "Para una categoría solo se admite un % de descuento" });
});

const zAgreement = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del convenio").max(120),
  kind: z.enum(["company", "school", "association", "other"]).default("company"),
  taxId: z.string().trim().regex(/^[0-9]{5,15}$/, "El NIT tiene solo números (5 a 15 dígitos)").nullish().or(z.literal("")).transform((v) => v || null),
  billingName: zOptText(160),
  contactName: zOptText(120),
  contactPhone: zOptText(30),
  contactEmail: z.email("Correo inválido").nullish().or(z.literal("")).transform((v) => v || null),
  validFrom: zDate,
  validTo: zDate.nullish().or(z.literal("")).transform((v) => v || null),
  defaultDiscountPercent: zPercent.default(0),
  companySharePercent: zPercent.default(0),
  companyCapCents: zMoney.refine((v) => v > 0, "El tope debe ser mayor a cero").nullish().transform((v) => v ?? null),
  paymentTermsDays: z.number().int().min(0).max(180).default(30),
  notes: zOptText(1000),
  active: z.boolean().default(true),
  rules: z.array(zRule).max(200).default([]),
}).superRefine((a, ctx) => {
  if (a.validTo && a.validTo < a.validFrom) ctx.addIssue({ code: "custom", path: ["validTo"], message: "La vigencia termina antes de empezar" });
  if (a.companyCapCents && !a.companySharePercent) ctx.addIssue({ code: "custom", path: ["companyCapCents"], message: "El tope solo aplica si la empresa paga un porcentaje" });
});

const COLS = `a.id, a.name, a.kind, a.tax_id AS "taxId", a.billing_name AS "billingName", a.contact_name AS "contactName", a.contact_phone AS "contactPhone",
  a.contact_email AS "contactEmail", a.valid_from AS "validFrom", a.valid_to AS "validTo", a.default_discount_percent AS "defaultDiscountPercent",
  a.company_share_percent AS "companySharePercent", a.company_cap_cents AS "companyCapCents", a.payment_terms_days AS "paymentTermsDays",
  a.notes, a.active, a.created_at AS "createdAt", a.updated_at AS "updatedAt"`;

async function loadAgreement(c: Client, id: string) {
  const a = (await c.query(`SELECT ${COLS} FROM agreements a WHERE a.id = $1`, [id])).rows[0];
  if (!a) throw notFound("Convenio");
  const rules = (await c.query(
    `SELECT r.id, r.procedure_id AS "procedureId", p.code AS "procedureCode", p.name AS "procedureName", p.price_cents AS "listPriceCents",
            r.category, r.price_cents AS "priceCents", r.discount_percent AS "discountPercent"
       FROM agreement_rules r LEFT JOIN procedures p ON p.id = r.procedure_id WHERE r.agreement_id = $1 ORDER BY r.category NULLS FIRST, p.code`, [id])).rows;
  const affiliates = (await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM patient_agreements WHERE agreement_id = $1 AND ended_at IS NULL
        AND (valid_to IS NULL OR valid_to >= $2::date)`, [id, await clinicToday(c)])).rows[0]!.n;
  return { ...a, kindLabel: AGREEMENT_KINDS[a.kind], rules, affiliates };
}

async function saveRules(c: Client, clinicId: string, agreementId: string, rules: z.infer<typeof zRule>[]) {
  const seenP = new Set<string>(), seenC = new Set<string>();
  for (const r of rules) {
    if (r.procedureId) { if (seenP.has(r.procedureId)) throw badRequest("Hay dos reglas para la misma prestación"); seenP.add(r.procedureId); }
    if (r.category) { const k = r.category.toLowerCase(); if (seenC.has(k)) throw badRequest(`Hay dos reglas para la categoría ${r.category}`); seenC.add(k); }
  }
  if (seenC.size) {
    const cats = new Set((await c.query<{ category: string }>("SELECT DISTINCT lower(category) AS category FROM procedures")).rows.map((x) => x.category));
    for (const k of seenC) if (!cats.has(k)) throw badRequest(`La categoría "${k}" no existe en el catálogo`);
  }
  await c.query("DELETE FROM agreement_rules WHERE agreement_id = $1", [agreementId]);
  for (const r of rules) {
    await c.query("INSERT INTO agreement_rules (clinic_id, agreement_id, procedure_id, category, price_cents, discount_percent) VALUES ($1,$2,$3,$4,$5,$6)",
      [clinicId, agreementId, r.procedureId, r.category, r.priceCents, r.discountPercent]);
  }
}

export function agreementCrudRoutes(route: Route) {
  route({
    method: "GET", url: "/api/agreements", summary: "Convenios de la clínica (empresas, colegios, asociaciones) con afiliados vigentes", tags: ["convenios"], perm: "patients.read",
    query: z.object({ active: z.enum(["1", "0"]).optional() }),
    handler: async ({ c, query }) => {
      const today = await clinicToday(c);
      const r = await c.query(
        `SELECT ${COLS},
                (SELECT count(*)::int FROM patient_agreements pa WHERE pa.agreement_id = a.id AND pa.ended_at IS NULL AND (pa.valid_to IS NULL OR pa.valid_to >= $2::date)) AS affiliates,
                (SELECT count(*)::int FROM agreement_rules r WHERE r.agreement_id = a.id) AS "rulesCount",
                ($2::date BETWEEN a.valid_from AND COALESCE(a.valid_to, 'infinity'::date)) AS "inForce"
           FROM agreements a WHERE ($1::boolean IS NULL OR a.active = $1) ORDER BY a.active DESC, a.name`,
        [query.active === undefined ? null : query.active === "1", today]);
      return r.rows.map((a) => ({ ...a, kindLabel: AGREEMENT_KINDS[a.kind] }));
    },
  });

  route({
    method: "GET", url: "/api/agreements/:id", summary: "Detalle del convenio con sus reglas de precio", tags: ["convenios"], perm: "patients.read", params: zIdParams,
    handler: async ({ c, params }) => loadAgreement(c, params.id),
  });

  route({
    method: "POST", url: "/api/agreements", summary: "Crear un convenio con su vigencia, reglas de precio y parte que paga la empresa", tags: ["convenios"], perm: "clinic.manage", body: zAgreement,
    handler: async ({ c, auth, body }) => {
      const id = (await c.query<{ id: string }>(
        `INSERT INTO agreements (clinic_id, name, kind, tax_id, billing_name, contact_name, contact_phone, contact_email, valid_from, valid_to,
            default_discount_percent, company_share_percent, company_cap_cents, payment_terms_days, notes, active, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [auth.clinicId, body.name, body.kind, body.taxId, body.billingName, body.contactName, body.contactPhone, body.contactEmail, body.validFrom, body.validTo,
          body.defaultDiscountPercent, body.companySharePercent, body.companyCapCents, body.paymentTermsDays, body.notes, body.active, auth.userId])).rows[0]!.id;
      await saveRules(c, auth.clinicId!, id, body.rules);
      await audit(c, auth, "agreement.created", "agreement", id, { name: body.name, rules: body.rules.length, companySharePercent: body.companySharePercent, companyCapCents: body.companyCapCents });
      return loadAgreement(c, id);
    },
  });

  route({
    method: "PUT", url: "/api/agreements/:id", summary: "Modificar un convenio (no cambia los presupuestos ya hechos: sus líneas guardan una copia)", tags: ["convenios"],
    perm: "clinic.manage", params: zIdParams, body: zAgreement,
    handler: async ({ c, auth, params, body }) => {
      const before = (await c.query("SELECT * FROM agreements WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!before) throw notFound("Convenio");
      const beforeRules = (await c.query("SELECT procedure_id, category, price_cents, discount_percent FROM agreement_rules WHERE agreement_id = $1", [params.id])).rows;
      await c.query(
        `UPDATE agreements SET name = $2, kind = $3, tax_id = $4, billing_name = $5, contact_name = $6, contact_phone = $7, contact_email = $8, valid_from = $9, valid_to = $10,
            default_discount_percent = $11, company_share_percent = $12, company_cap_cents = $13, payment_terms_days = $14, notes = $15, active = $16, updated_at = now()
          WHERE id = $1`,
        [params.id, body.name, body.kind, body.taxId, body.billingName, body.contactName, body.contactPhone, body.contactEmail, body.validFrom, body.validTo,
          body.defaultDiscountPercent, body.companySharePercent, body.companyCapCents, body.paymentTermsDays, body.notes, body.active]);
      await saveRules(c, auth.clinicId!, params.id, body.rules);
      await audit(c, auth, "agreement.updated", "agreement", params.id, { before: { ...before, rules: beforeRules }, after: body });
      return loadAgreement(c, params.id);
    },
  });

  // ---------------- Afiliación del paciente ----------------
  route({
    method: "GET", url: "/api/patients/:id/agreements", summary: "Afiliaciones del paciente a convenios (vigentes e históricas)", tags: ["convenios"], perm: "patients.read", params: zIdParams,
    handler: async ({ c, params }) => {
      const today = await clinicToday(c);
      const rows = (await c.query(
        `SELECT pa.id, pa.agreement_id AS "agreementId", a.name AS "agreementName", a.kind, pa.member_number AS "memberNumber", pa.holder_name AS "holderName",
                pa.valid_from AS "validFrom", pa.valid_to AS "validTo", pa.ended_at AS "endedAt", pa.end_reason AS "endReason", pa.created_at AS "createdAt",
                a.company_share_percent AS "companySharePercent", a.company_cap_cents AS "companyCapCents",
                (a.active AND $2::date BETWEEN pa.valid_from AND COALESCE(pa.valid_to, 'infinity'::date)
                  AND $2::date BETWEEN a.valid_from AND COALESCE(a.valid_to, 'infinity'::date)) AS "inForce"
           FROM patient_agreements pa JOIN agreements a ON a.id = pa.agreement_id
          WHERE pa.patient_id = $1 ORDER BY pa.valid_from DESC`, [params.id, today])).rows;
      for (const r of rows) {
        r.kindLabel = AGREEMENT_KINDS[r.kind];
        if (r.inForce && r.companyCapCents) r.companyUsedThisYearCents = await companyUsedThisYear(c, params.id, r.agreementId);
      }
      return rows;
    },
  });

  route({
    method: "POST", url: "/api/patients/:id/agreements", summary: "Afiliar al paciente a un convenio (N° de afiliado y vigencia)", tags: ["convenios"], perm: "patients.write", params: zIdParams,
    body: z.object({
      agreementId: zId,
      memberNumber: z.string().trim().min(1, "Escribe el N° de afiliado").max(40),
      holderName: zOptText(120),
      validFrom: zDate,
      validTo: zDate.nullish().or(z.literal("")).transform((v) => v || null),
    }),
    handler: async ({ c, auth, params, body }) => {
      if (body.validTo && body.validTo < body.validFrom) throw badRequest("La afiliación termina antes de empezar");
      const p = (await c.query("SELECT 1 FROM patients WHERE id = $1", [params.id])).rowCount;
      if (!p) throw notFound("Paciente");
      const a = (await c.query<{ active: boolean; name: string }>("SELECT active, name FROM agreements WHERE id = $1", [body.agreementId])).rows[0];
      if (!a) throw notFound("Convenio");
      if (!a.active) throw conflict("Ese convenio está inactivo", "agreement_inactive");
      try {
        await c.query("SAVEPOINT pa");
        const id = (await c.query<{ id: string }>(
          `INSERT INTO patient_agreements (clinic_id, patient_id, agreement_id, member_number, holder_name, valid_from, valid_to, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [auth.clinicId, params.id, body.agreementId, body.memberNumber, body.holderName, body.validFrom, body.validTo, auth.userId])).rows[0]!.id;
        await audit(c, auth, "patient.agreement_added", "patient", params.id, { agreementId: body.agreementId, agreement: a.name, memberNumber: body.memberNumber, validFrom: body.validFrom, validTo: body.validTo });
        return { id };
      } catch (e) {
        if ((e as { constraint?: string }).constraint === "patient_agreements_no_overlap") {
          await c.query("ROLLBACK TO SAVEPOINT pa");
          throw new AppError(409, "agreement_overlap", "El paciente ya tiene una afiliación en esas fechas. Da de baja la anterior primero.");
        }
        throw e;
      }
    },
  });

  route({
    method: "POST", url: "/api/patient-agreements/:id/end", summary: "Dar de baja una afiliación (desde la fecha indicada deja de aplicarse)", tags: ["convenios"], perm: "patients.write", params: zIdParams,
    body: z.object({ endDate: zDate, reason: z.string().trim().min(3, "Escribe el motivo").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const pa = (await c.query<{ patient_id: string; valid_from: string; valid_to: string | null; ended_at: Date | null }>(
        "SELECT patient_id, valid_from, valid_to, ended_at FROM patient_agreements WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!pa) throw notFound("Afiliación");
      if (pa.ended_at) throw conflict("Esa afiliación ya fue dada de baja", "already_ended");
      if (body.endDate < pa.valid_from) throw badRequest("La baja no puede ser anterior al inicio de la afiliación");
      const to = pa.valid_to && pa.valid_to < body.endDate ? pa.valid_to : body.endDate;
      await c.query("UPDATE patient_agreements SET valid_to = $2, ended_at = now(), ended_by = $3, end_reason = $4 WHERE id = $1", [params.id, to, auth.userId, body.reason]);
      await audit(c, auth, "patient.agreement_ended", "patient", pa.patient_id, { patientAgreementId: params.id, endDate: to, reason: body.reason });
      return { ok: true };
    },
  });

  route({
    method: "GET", url: "/api/patients/:id/agreement-prices", summary: "Convenio vigente del paciente y precios que se aplican al presupuestar", tags: ["convenios"], perm: "budgets.read", params: zIdParams,
    handler: async ({ c, params }) => {
      const ag = await activeAgreementFor(c, params.id, await clinicToday(c));
      if (!ag) return { agreement: null, prices: [] };
      const procs = (await c.query<{ id: string; category: string; price_cents: number }>("SELECT id, category, price_cents FROM procedures WHERE active ORDER BY code")).rows;
      return {
        agreement: {
          id: ag.agreementId, name: ag.name, memberNumber: ag.memberNumber, companySharePercent: ag.companySharePercent, companyCapCents: ag.companyCapCents,
          companyUsedThisYearCents: ag.companyCapCents ? await companyUsedThisYear(c, params.id, ag.agreementId) : null,
        },
        prices: procs.map((p) => ({ procedureId: p.id, listPriceCents: Number(p.price_cents), ...agreementPrice(ag, p) })),
      };
    },
  });
}
