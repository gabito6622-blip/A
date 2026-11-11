// Convenios y pagador distinto (R2-32): precios del convenio, copia en la línea del presupuesto
// y parte que paga la empresa. Todo en centavos enteros.
//
// La porción del tercero de cada cargo la calcula la base al insertarlo (trigger
// charges_third_party de la migración 0019), con la copia guardada en la línea, el tope anual
// por paciente y la vigencia de la afiliación. Aquí solo se ESTIMA la parte de lo aún no
// realizado (para limitar lo que paga el paciente sobre un presupuesto y para facturar).
import { DateTime } from "luxon";
import type { Client } from "../../lib/db.js";
import { percentOf } from "../budgets-v2-core.js";

export const AGREEMENT_KINDS: Record<string, string> = { company: "Empresa", school: "Colegio", association: "Asociación", other: "Otro" };

export interface AgreementCtx {
  agreementId: string;
  patientAgreementId: string;
  name: string;
  memberNumber: string;
  defaultDiscountPercent: number;
  companySharePercent: number;
  companyCapCents: number | null;
  byProcedure: Map<string, { priceCents: number | null; discountPercent: number | null }>;
  byCategory: Map<string, number>;
}

export async function clinicToday(c: Client): Promise<string> {
  const z = (await c.query<{ tz: string | null }>("SELECT timezone AS tz FROM clinics WHERE id = app_clinic_id()")).rows[0]?.tz ?? "America/La_Paz";
  return DateTime.now().setZone(z).toISODate()!;
}

/** Afiliación vigente del paciente en la fecha (convenio activo y vigente), con sus reglas de precio. */
export async function activeAgreementFor(c: Client, patientId: string, date: string): Promise<AgreementCtx | null> {
  const a = (await c.query(
    `SELECT pa.id AS pa_id, pa.member_number, a.id, a.name, a.default_discount_percent, a.company_share_percent, a.company_cap_cents
       FROM patient_agreements pa JOIN agreements a ON a.id = pa.agreement_id
      WHERE pa.patient_id = $1 AND a.active
        AND $2::date BETWEEN pa.valid_from AND COALESCE(pa.valid_to, 'infinity'::date)
        AND $2::date BETWEEN a.valid_from AND COALESCE(a.valid_to, 'infinity'::date)
      LIMIT 1`, [patientId, date])).rows[0];
  if (!a) return null;
  const rules = (await c.query<{ procedure_id: string | null; category: string | null; price_cents: number | null; discount_percent: number | null }>(
    "SELECT procedure_id, category, price_cents, discount_percent FROM agreement_rules WHERE agreement_id = $1", [a.id])).rows;
  const byProcedure = new Map<string, { priceCents: number | null; discountPercent: number | null }>();
  const byCategory = new Map<string, number>();
  for (const r of rules) {
    if (r.procedure_id) byProcedure.set(r.procedure_id, { priceCents: r.price_cents != null ? Number(r.price_cents) : null, discountPercent: r.discount_percent != null ? Number(r.discount_percent) : null });
    else if (r.category && r.discount_percent != null) byCategory.set(r.category.toLowerCase(), Number(r.discount_percent));
  }
  return {
    agreementId: a.id, patientAgreementId: a.pa_id, name: a.name, memberNumber: a.member_number,
    defaultDiscountPercent: Number(a.default_discount_percent), companySharePercent: Number(a.company_share_percent),
    companyCapCents: a.company_cap_cents != null ? Number(a.company_cap_cents) : null, byProcedure, byCategory,
  };
}

const pctTxt = (p: number) => `${String(p).replace(".", ",")} %`;

/** Precio del convenio para una prestación: precio fijo o % de la prestación > % de la categoría > % general > lista. */
export function agreementPrice(ag: AgreementCtx, proc: { id: string; category: string; price_cents: number }): { unitPriceCents: number; note: string } {
  const list = Number(proc.price_cents);
  const r = ag.byProcedure.get(proc.id);
  if (r?.priceCents != null) return { unitPriceCents: r.priceCents, note: `Convenio ${ag.name}: precio especial` };
  if (r?.discountPercent != null) return { unitPriceCents: list - percentOf(list, r.discountPercent), note: `Convenio ${ag.name}: −${pctTxt(r.discountPercent)}` };
  const cat = ag.byCategory.get(proc.category.toLowerCase());
  if (cat != null) return { unitPriceCents: list - percentOf(list, cat), note: `Convenio ${ag.name}: −${pctTxt(cat)} en ${proc.category}` };
  if (ag.defaultDiscountPercent > 0) return { unitPriceCents: list - percentOf(list, ag.defaultDiscountPercent), note: `Convenio ${ag.name}: −${pctTxt(ag.defaultDiscountPercent)}` };
  return { unitPriceCents: list, note: `Convenio ${ag.name}: precio de lista` };
}

/** Convenio vigente HOY para el paciente del presupuesto (al presupuestar). */
export async function budgetAgreementContext(c: Client, budgetId: string): Promise<AgreementCtx | null> {
  const b = (await c.query<{ patient_id: string }>("SELECT patient_id FROM budgets WHERE id = $1", [budgetId])).rows[0];
  if (!b) return null;
  return activeAgreementFor(c, b.patient_id, await clinicToday(c));
}

/**
 * Para billing.ts (insertar líneas): precio unitario y columnas de la copia del convenio.
 * Si se indica un precio manual se respeta; la parte de la empresa se copia igual.
 */
export function agreementLineFields(
  ag: AgreementCtx | null, apply: boolean, proc: { id: string; category: string; price_cents: number }, manualUnit: number | undefined,
): { unit: number; cols: [string | null, string | null, number | null, string | null, number | null, number | null] } {
  if (!ag || !apply) return { unit: manualUnit ?? Number(proc.price_cents), cols: [null, null, null, null, null, null] };
  const p = agreementPrice(ag, proc);
  const unit = manualUnit ?? p.unitPriceCents;
  const note = unit === p.unitPriceCents ? p.note : `Convenio ${ag.name}: precio manual`;
  return {
    unit,
    cols: [ag.agreementId, ag.patientAgreementId, Number(proc.price_cents), note.slice(0, 160), ag.companySharePercent || null, ag.companySharePercent ? ag.companyCapCents : null],
  };
}

export const AGREEMENT_INSERT_COLS = "agreement_id, patient_agreement_id, list_unit_price_cents, agreement_note, company_share_percent, company_cap_cents";

// ---------------------------------------------------------------------------
// Parte de la empresa en un presupuesto (realizada + estimada de lo pendiente)
// ---------------------------------------------------------------------------
export interface ItemShare {
  itemId: string; netCents: number; status: string; agreementId: string | null; agreementName: string | null;
  listUnitPriceCents: number | null; agreementNote: string | null; companySharePercent: number | null;
  chargedCents: number; chargedCompanyCents: number; estimatedCompanyCents: number; companyCents: number;
}

/** Parte de la empresa por línea: lo ya cargado (exacto) + estimado de lo pendiente (con el saldo del tope anual). */
export async function budgetItemShares(c: Client, budgetId: string): Promise<ItemShare[]> {
  const rows = (await c.query(
    `SELECT i.id, i.net_cents, i.status, i.agreement_id, a.name AS agreement_name, i.list_unit_price_cents, i.agreement_note, i.company_share_percent,
            i.company_cap_cents, b.patient_id,
            COALESCE(x.charged, 0) AS charged,
            -- Porción de la empresa ya cargada, menos lo trasladado al paciente (B-082): eso lo paga el paciente.
            COALESCE(x.tp, 0) - COALESCE((SELECT sum(t.amount_cents) FROM payer_transfers t JOIN charges o ON o.id = t.charge_id WHERE o.budget_item_id = i.id), 0) AS tp,
            EXISTS (SELECT 1 FROM patient_agreements pa JOIN agreements ag ON ag.id = pa.agreement_id
                     WHERE pa.id = i.patient_agreement_id AND ag.active AND $2::date BETWEEN pa.valid_from AND COALESCE(pa.valid_to, 'infinity'::date)
                       AND $2::date BETWEEN ag.valid_from AND COALESCE(ag.valid_to, 'infinity'::date)) AS valid_now
       FROM budget_items i JOIN budgets b ON b.id = i.budget_id LEFT JOIN agreements a ON a.id = i.agreement_id
       LEFT JOIN LATERAL (
         SELECT sum(ch.amount_cents) AS charged, sum(ch.third_party_cents) AS tp FROM charges ch
          WHERE ch.budget_item_id = i.id OR ch.voids_charge_id IN (SELECT o.id FROM charges o WHERE o.budget_item_id = i.id)) x ON true
      WHERE i.budget_id = $1 ORDER BY i.position, i.id`, [budgetId, await clinicToday(c)])).rows;
  const out: ItemShare[] = rows.map((r) => {
    const net = Number(r.net_cents), charged = Number(r.charged), tp = Number(r.tp);
    const pct = r.company_share_percent != null ? Number(r.company_share_percent) : null;
    const remaining = r.status === "cancelled" ? 0 : Math.max(net - charged, 0);
    const est = pct && r.valid_now ? percentOf(remaining, pct) : 0;
    return {
      itemId: r.id, netCents: net, status: r.status, agreementId: r.agreement_id, agreementName: r.agreement_name,
      listUnitPriceCents: r.list_unit_price_cents != null ? Number(r.list_unit_price_cents) : null, agreementNote: r.agreement_note,
      companySharePercent: pct, chargedCents: charged, chargedCompanyCents: tp, estimatedCompanyCents: est, companyCents: tp + est,
    };
  });
  // Tope anual: lo estimado no puede superar lo que le queda al paciente en el convenio este año.
  const caps = new Map<string, { cap: number; patientId: string }>();
  for (const r of rows) if (r.agreement_id && r.company_cap_cents != null) caps.set(r.agreement_id, { cap: Number(r.company_cap_cents), patientId: r.patient_id });
  for (const [agreementId, { cap, patientId }] of caps) {
    const used = await companyUsedThisYear(c, patientId, agreementId);
    let room = Math.max(cap - used, 0);
    for (const s of out.filter((x) => x.agreementId === agreementId)) {
      const e = Math.min(s.estimatedCompanyCents, room);
      room -= e;
      s.estimatedCompanyCents = e;
      s.companyCents = s.chargedCompanyCents + e;
    }
  }
  return out;
}

/** Parte de la empresa ya cargada al paciente en el año calendario actual (zona de la clínica). */
export async function companyUsedThisYear(c: Client, patientId: string, agreementId: string): Promise<number> {
  return Number((await c.query<{ v: number }>(
    // Lo trasladado al paciente ya no lo paga la empresa: libera el tope (B-097, igual que charges_third_party de 0030).
    `WITH z AS (SELECT timezone AS tz FROM clinics WHERE id = app_clinic_id())
     SELECT (COALESCE((SELECT sum(ch.third_party_cents) FROM charges ch, z
                        WHERE ch.patient_id = $1 AND ch.payer_agreement_id = $2
                          AND date_part('year', ch.created_at AT TIME ZONE z.tz) = date_part('year', $3::date)), 0)
           - COALESCE((SELECT sum(t.amount_cents) FROM payer_transfers t JOIN charges c2 ON c2.id = t.charge_id, z
                        WHERE t.patient_id = $1 AND t.agreement_id = $2
                          AND date_part('year', c2.created_at AT TIME ZONE z.tz) = date_part('year', $3::date)), 0))::bigint AS v`,
    [patientId, agreementId, await clinicToday(c)])).rows[0]!.v);
}

/** Total de la empresa en un presupuesto (para limitar lo que paga el paciente). */
export async function budgetCompanyShareCents(c: Client, budgetId: string): Promise<number> {
  return (await budgetItemShares(c, budgetId)).filter((s) => s.status !== "cancelled").reduce((s, x) => s + x.companyCents, 0);
}

/** Para billing.ts (detalle del presupuesto): copia del convenio por línea y saldo a cargo del paciente. */
export async function agreementBudgetExtras(c: Client, budgetId: string, items: any[], totals: { totalCents: number; paidCents: number }) {
  const shares = await budgetItemShares(c, budgetId);
  for (const it of items) {
    const s = shares.find((x) => x.itemId === it.id);
    if (!s || !s.agreementId) continue;
    Object.assign(it, {
      agreementName: s.agreementName, agreementNote: s.agreementNote, listUnitPriceCents: s.listUnitPriceCents,
      companySharePercent: s.companySharePercent, companyCents: s.companyCents, companyEstimated: s.estimatedCompanyCents > 0,
    });
  }
  const companyCents = shares.filter((s) => s.status !== "cancelled").reduce((a, x) => a + x.companyCents, 0);
  const patientShareCents = totals.totalCents - companyCents;
  return {
    companyCents, patientShareCents,
    agreementName: shares.find((s) => s.agreementName)?.agreementName ?? null,
    remainingCents: patientShareCents - totals.paidCents,
  };
}
