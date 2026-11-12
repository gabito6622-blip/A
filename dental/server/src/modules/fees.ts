// Liquidación de honorarios por profesional (B-044, FI-03) y resultado por sucursal (FI-04, versión inicial).
//
// Reglas:
//  * Cada profesional tiene una base: "producción" (tratamientos realizados por él: charges.dentist_id)
//    o "cobrado" (pagos confirmados de presupuestos cuyo profesional es él: budgets.dentist_id).
//  * Una regla general y excepciones por categoría de prestación: porcentaje o monto fijo por unidad,
//    con descuento opcional de laboratorio y materiales por unidad (solo con base producción).
//  * Opción "costo real de laboratorio" (deduct_actual_lab_cost, B-063): la línea de un tratamiento descuenta
//    el costo de las órdenes de laboratorio vinculadas a su ítem de presupuesto (no canceladas ni en borrador,
//    con costo). Si el ítem tiene varias sesiones, el costo se descuenta una sola vez, en orden, sin superar
//    la base de cada línea. Sin órdenes vinculadas con costo, se usa el monto fijo por unidad.
//  * Base "cobrado" (B-082: también los pagos de empresas aplicados a los cargos de los presupuestos del
//    profesional, una línea exacta por aplicación pago × cargo, sin doble conteo con lo del paciente):
//    cada pago del paciente se reparte entre las categorías del presupuesto en proporción a sus
//    importes (método del mayor resto, sin perder centavos). Los pagos SIN presupuesto no se atribuyen
//    a ningún profesional: se informan aparte como "cobros sin presupuesto" para que administración decida.
//  * Período: borrador (cálculo en vivo) → cerrado (copia inmutable línea por línea).
//    Si después del cierre se anula un cargo o un pago ya liquidado, el ajuste (negativo) entra en la
//    siguiente liquidación del profesional; la cerrada nunca se edita.
import { z } from "zod";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../lib/http.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";
import { allowedBranches, hasAllBranches, type AuthCtx } from "../lib/rbac.js";
import { dayBounds } from "../lib/slots.js";
import { clinicZone } from "./agenda.js";
import { resolveRange } from "./reports.js";
import { xlsxBuffer } from "../lib/xlsxSafe.js";

export interface FeeRule { category: string | null; mode: "percent" | "fixed"; percentBp: number | null; fixedCents: number | null; deductCents: number; deductActualLab?: boolean }
export type FeeBase = "production" | "collected";

export const BASE_LABELS: Record<FeeBase, string> = { production: "Producción (tratamientos realizados)", collected: "Cobrado (pagos confirmados del paciente y de empresas en convenio)" };
const KIND_LABELS: Record<string, string> = { production: "Tratamiento", collected: "Cobro", collected_payer: "Cobro de empresa", adjustment: "Ajuste" };

/** Honorario de una línea (centavos, redondeo al centavo más cercano).
 *  `actualLabCents`: costo real de laboratorio a descontar (reemplaza al monto fijo por unidad). */
export function feeFor(baseCents: number, quantity: number, rule: FeeRule, actualLabCents: number | null = null): { feeCents: number; deductCents: number } {
  if (rule.mode === "fixed") return { feeCents: (rule.fixedCents ?? 0) * quantity, deductCents: 0 };
  const net = Math.max(0, baseCents - (actualLabCents ?? rule.deductCents * quantity));
  return { feeCents: Math.floor((net * (rule.percentBp ?? 0) + 5000) / 10000), deductCents: baseCents - net };
}

/** Reparte `amount` en proporción a `weights` sin perder centavos (método del mayor resto). */
export function allocate(amount: number, weights: number[]): number[] {
  const W = weights.reduce((s, w) => s + BigInt(Math.max(0, w)), 0n);
  if (W === 0n) return weights.map((_, i) => (i === 0 ? amount : 0));
  const A = BigInt(amount);
  const parts = weights.map((w) => (A * BigInt(Math.max(0, w))) / W);
  const rems = weights.map((w, i) => ({ i, r: (A * BigInt(Math.max(0, w))) % W }));
  let left = Number(A - parts.reduce((s, p) => s + p, 0n));
  rems.sort((a, b) => (b.r > a.r ? 1 : b.r < a.r ? -1 : a.i - b.i));
  for (const { i } of rems) { if (left <= 0) break; parts[i]! += 1n; left--; }
  return parts.map(Number);
}

export function pickRule(rules: FeeRule[], category: string | null): FeeRule | undefined {
  return rules.find((r) => r.category !== null && r.category === category) ?? rules.find((r) => r.category === null);
}

function requireFeesAccess(auth: AuthCtx) {
  if (!hasAllBranches(auth)) throw forbidden("Los honorarios se gestionan con acceso a todas las sucursales");
}
const canClose = (a: AuthCtx) => a.permissions.has("staff.manage") || a.permissions.has("clinic.manage");

async function loadConfig(c: Client, dentistId: string): Promise<{ base: FeeBase; rules: FeeRule[] } | null> {
  const p = (await c.query<{ base: FeeBase }>("SELECT base FROM fee_profiles WHERE dentist_id = $1", [dentistId])).rows[0];
  if (!p) return null;
  const rules = (await c.query<FeeRule>(
    `SELECT category, mode, percent_bp AS "percentBp", fixed_cents AS "fixedCents", deduct_cents AS "deductCents", deduct_actual_lab_cost AS "deductActualLab"
       FROM fee_rules WHERE dentist_id = $1 ORDER BY category NULLS FIRST`, [dentistId])).rows;
  return { base: p.base, rules };
}

export interface Line {
  kind: "production" | "collected" | "collected_payer" | "adjustment";
  branchId: string; branchName?: string; patientId: string | null; patientName?: string | null;
  chargeId: string | null; paymentId: string | null; adjustsLineId: string | null;
  /** Aplicación de un pago de empresa (convenio) a un cargo: base «cobrado» (B-082). */
  payerAllocationId?: string | null;
  occurredAt: Date | string; description: string; category: string | null; quantity: number;
  baseCents: number; deductCents: number; mode: "percent" | "fixed" | null; percentBp: number | null; fixedCents: number | null; feeCents: number;
  /** Parte del descuento que es costo real de laboratorio (null = monto fijo por unidad o sin descuento). */
  labActualCents?: number | null;
}

interface SettlementRow { id: string; dentist_id: string; period_start: string; period_end: string; status: string }

/** Calcula las líneas de una liquidación (borrador) con las reglas vigentes. */
export async function computeLines(c: Client, clinicId: string, s: SettlementRow) {
  const cfg = await loadConfig(c, s.dentist_id);
  if (!cfg) throw conflict("Configura primero la regla de honorarios de este profesional", "fee_rules_missing");
  const zone = await clinicZone(c, clinicId);
  const from = dayBounds(s.period_start, zone)[0];
  const to = dayBounds(s.period_end, zone)[1];
  const lines: Line[] = [];
  const ruleCols = (r: FeeRule | undefined) => ({ mode: r?.mode ?? null, percentBp: r?.percentBp ?? null, fixedCents: r?.fixedCents ?? null });

  if (cfg.base === "production") {
    // Cargos positivos del profesional en el período, no anulados y no liquidados antes.
    const rows = (await c.query(
      `SELECT ch.id, ch.budget_item_id, ch.branch_id, br.name AS branch_name, ch.patient_id, pt.first_name || ' ' || pt.last_name AS patient_name, ch.description,
              ch.amount_cents, ch.created_at, pr.category, COALESCE(bi.quantity, 1) AS quantity
         FROM charges ch JOIN branches br ON br.id = ch.branch_id JOIN patients pt ON pt.id = ch.patient_id
         LEFT JOIN budget_items bi ON bi.id = ch.budget_item_id LEFT JOIN procedures pr ON pr.id = bi.procedure_id
        WHERE ch.dentist_id = $1 AND ch.amount_cents > 0 AND ch.created_at >= $2 AND ch.created_at < $3
          AND NOT EXISTS (SELECT 1 FROM charges v WHERE v.voids_charge_id = ch.id)
          AND NOT EXISTS (SELECT 1 FROM fee_settlement_lines l WHERE l.charge_id = ch.id AND l.kind = 'production')
        ORDER BY ch.created_at, ch.id`, [s.dentist_id, from, to])).rows;
    const labLeft = await actualLabRemaining(c, rows.filter((r) => r.budget_item_id && pickRule(cfg.rules, r.category)?.deductActualLab).map((r) => r.budget_item_id));
    for (const r of rows) {
      const rule = pickRule(cfg.rules, r.category);
      const left = rule?.deductActualLab && rule.mode === "percent" && r.budget_item_id ? labLeft.get(r.budget_item_id) : undefined;
      const f = rule ? feeFor(Number(r.amount_cents), r.quantity, rule, left ?? null) : { feeCents: 0, deductCents: 0 };
      if (left !== undefined) labLeft.set(r.budget_item_id, left - f.deductCents);
      lines.push({
        kind: "production", branchId: r.branch_id, branchName: r.branch_name, patientId: r.patient_id, patientName: r.patient_name,
        chargeId: r.id, paymentId: null, adjustsLineId: null, occurredAt: r.created_at, description: r.description, category: r.category,
        quantity: r.quantity, baseCents: Number(r.amount_cents), deductCents: f.deductCents, ...ruleCols(rule), feeCents: f.feeCents,
        labActualCents: left !== undefined ? f.deductCents : null,
      });
    }
  } else {
    // Pagos confirmados (por fecha de confirmación) de presupuestos del profesional.
    const pays = (await c.query(
      `SELECT p.id, p.branch_id, br.name AS branch_name, p.patient_id, pt.first_name || ' ' || pt.last_name AS patient_name, p.amount_cents,
              COALESCE(p.verified_at, p.received_at) AS at, p.receipt_number, b.number AS budget_number, p.budget_id
         FROM payments p JOIN budgets b ON b.id = p.budget_id JOIN branches br ON br.id = p.branch_id JOIN patients pt ON pt.id = p.patient_id
        WHERE b.dentist_id = $1 AND p.status = 'confirmed' AND COALESCE(p.verified_at, p.received_at) >= $2 AND COALESCE(p.verified_at, p.received_at) < $3
          AND NOT EXISTS (SELECT 1 FROM fee_settlement_lines l WHERE l.payment_id = p.id AND l.kind = 'collected')
        ORDER BY at, p.id`, [s.dentist_id, from, to])).rows;
    const budgetIds = [...new Set(pays.map((p) => p.budget_id as string))];
    const weights = budgetIds.length ? (await c.query<{ budget_id: string; category: string; total: number }>(
      `SELECT bi.budget_id, pr.category, sum(bi.unit_price_cents * bi.quantity - bi.discount_cents) AS total
         FROM budget_items bi JOIN procedures pr ON pr.id = bi.procedure_id
        WHERE bi.budget_id = ANY($1) AND bi.status <> 'cancelled' GROUP BY bi.budget_id, pr.category ORDER BY pr.category`, [budgetIds])).rows : [];
    for (const p of pays) {
      const cats = weights.filter((w) => w.budget_id === p.budget_id && Number(w.total) > 0);
      const parts = cats.length ? allocate(Number(p.amount_cents), cats.map((w) => Number(w.total))) : [Number(p.amount_cents)];
      parts.forEach((amt, i) => {
        const category = cats.length ? cats[i]!.category : null;
        const rule = pickRule(cfg.rules, category);
        const f = rule ? feeFor(amt, 1, { ...rule, deductCents: 0 }) : { feeCents: 0, deductCents: 0 };
        lines.push({
          kind: "collected", branchId: p.branch_id, branchName: p.branch_name, patientId: p.patient_id, patientName: p.patient_name,
          chargeId: null, paymentId: p.id, adjustsLineId: null, occurredAt: p.at,
          description: `Recibo N° ${p.receipt_number} · presupuesto N° ${p.budget_number}${cats.length > 1 ? ` (parte ${category})` : ""}`,
          category, quantity: 1, baseCents: amt, deductCents: 0, ...ruleCols(rule), feeCents: f.feeCents,
        });
      });
    }
    // Pagos de empresas (convenios) confirmados, aplicados a cargos de presupuestos del profesional (B-082).
    // Cada aplicación (pago × cargo) es dinero distinto de lo que pagó el paciente: lo del paciente es su parte
    // (pagos arriba) y lo de la empresa es la porción del convenio, así que no hay doble conteo. La aplicación ya
    // está en centavos exactos por cargo y cada cargo tiene una sola categoría: la base suma el pago al centavo.
    const payer = (await c.query(
      `SELECT x.id, x.amount_cents, ch.id AS charge_id, ch.branch_id, br.name AS branch_name, ch.patient_id, pt.first_name || ' ' || pt.last_name AS patient_name,
              COALESCE(pp.verified_at, pp.received_at) AS at, pp.number, a.name AS agreement_name, pr.category, COALESCE(bi.description, ch.description) AS service
         FROM payer_payment_allocations x JOIN payer_payments pp ON pp.id = x.payment_id JOIN agreements a ON a.id = pp.agreement_id
         JOIN charges ch ON ch.id = x.charge_id JOIN branches br ON br.id = ch.branch_id JOIN patients pt ON pt.id = ch.patient_id
         LEFT JOIN budget_items bi ON bi.id = ch.budget_item_id LEFT JOIN budgets b ON b.id = bi.budget_id LEFT JOIN procedures pr ON pr.id = bi.procedure_id
        WHERE COALESCE(b.dentist_id, ch.dentist_id) = $1 AND pp.status = 'confirmed'
          AND COALESCE(pp.verified_at, pp.received_at) >= $2 AND COALESCE(pp.verified_at, pp.received_at) < $3
          AND NOT EXISTS (SELECT 1 FROM fee_settlement_lines l WHERE l.payer_allocation_id = x.id AND l.kind = 'collected_payer')
        ORDER BY at, pp.number, ch.created_at, x.id`, [s.dentist_id, from, to])).rows;
    for (const p of payer) {
      const amt = Number(p.amount_cents);
      const rule = pickRule(cfg.rules, p.category ?? null);
      const f = rule ? feeFor(amt, 1, { ...rule, deductCents: 0 }) : { feeCents: 0, deductCents: 0 };
      lines.push({
        kind: "collected_payer", branchId: p.branch_id, branchName: p.branch_name, patientId: p.patient_id, patientName: p.patient_name,
        chargeId: p.charge_id, paymentId: null, adjustsLineId: null, payerAllocationId: p.id, occurredAt: p.at,
        description: `Pago N° ${p.number} de ${p.agreement_name} · ${p.service}`,
        category: p.category ?? null, quantity: 1, baseCents: amt, deductCents: 0, ...ruleCols(rule), feeCents: f.feeCents,
      });
    }
  }

  // Ajustes: líneas de liquidaciones cerradas ANTERIORES cuyo cargo o pago se anuló después; aún sin ajustar.
  const adj = (await c.query(
    `SELECT l.id, l.kind, l.branch_id, br.name AS branch_name, l.patient_id, pt.first_name || ' ' || pt.last_name AS patient_name, l.description, l.category,
            l.quantity, l.base_cents, l.fee_cents, s.period_start, s.period_end,
            COALESCE(CASE WHEN l.kind = 'production' THEN (SELECT v.created_at FROM charges v WHERE v.voids_charge_id = l.charge_id) END, now()) AS voided_at
       FROM fee_settlement_lines l JOIN fee_settlements s ON s.id = l.settlement_id JOIN branches br ON br.id = l.branch_id
       LEFT JOIN patients pt ON pt.id = l.patient_id
      WHERE s.dentist_id = $1 AND s.status = 'closed' AND s.period_end < $2::date AND l.kind IN ('production','collected','collected_payer') AND l.fee_cents <> 0
        AND NOT EXISTS (SELECT 1 FROM fee_settlement_lines a WHERE a.adjusts_line_id = l.id)
        AND ((l.kind = 'production' AND EXISTS (SELECT 1 FROM charges v WHERE v.voids_charge_id = l.charge_id))
          OR (l.kind = 'collected' AND EXISTS (SELECT 1 FROM payments p WHERE p.id = l.payment_id AND p.status = 'voided'))
          OR (l.kind = 'collected_payer' AND EXISTS (SELECT 1 FROM payer_payment_allocations x JOIN payer_payments pp ON pp.id = x.payment_id
                                                      WHERE x.id = l.payer_allocation_id AND pp.status = 'voided')))
      ORDER BY s.period_start, l.occurred_at`, [s.dentist_id, s.period_start])).rows;
  for (const a of adj) {
    const fmt = (d: string) => DateTime.fromISO(d).toFormat("dd/MM/yyyy");
    lines.push({
      kind: "adjustment", branchId: a.branch_id, branchName: a.branch_name, patientId: a.patient_id, patientName: a.patient_name,
      chargeId: null, paymentId: null, adjustsLineId: a.id, occurredAt: a.voided_at,
      description: `Anulación de «${a.description}» liquidado en el período ${fmt(a.period_start)}–${fmt(a.period_end)}`,
      category: a.category, quantity: a.quantity, baseCents: -Number(a.base_cents), deductCents: 0, mode: null, percentBp: null, fixedCents: null,
      feeCents: -Number(a.fee_cents),
    });
  }
  return { cfg, lines, from, to };
}

/** Costo real de laboratorio aún no descontado por ítem de presupuesto (solo ítems con órdenes con costo).
 *  Resta lo ya descontado en liquidaciones cerradas (líneas de cargos no anulados). */
export async function actualLabRemaining(c: Client, itemIds: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!itemIds.length) return out;
  const ids = [...new Set(itemIds)];
  const cost = (await c.query<{ id: string; v: number }>(
    `SELECT o.budget_item_id AS id, sum(o.cost_cents + COALESCE((SELECT sum(e.amount_cents) FROM lab_order_extra_costs e WHERE e.order_id = o.id), 0)) AS v FROM lab_orders o
      WHERE o.budget_item_id = ANY($1) AND o.status NOT IN ('draft','cancelled') AND o.cost_cents IS NOT NULL GROUP BY o.budget_item_id`, [ids])).rows;
  const used = (await c.query<{ id: string; v: number }>(
    `SELECT ch.budget_item_id AS id, sum(l.lab_actual_cents) AS v FROM fee_settlement_lines l JOIN charges ch ON ch.id = l.charge_id
      WHERE ch.budget_item_id = ANY($1) AND l.kind = 'production' AND l.lab_actual_cents IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM charges v WHERE v.voids_charge_id = ch.id) GROUP BY ch.budget_item_id`, [ids])).rows;
  for (const r of cost) out.set(r.id, Math.max(0, Number(r.v) - Number(used.find((u) => u.id === r.id)?.v ?? 0)));
  return out;
}

export function totalsOf(lines: Pick<Line, "kind" | "baseCents" | "feeCents">[]) {
  const regular = lines.filter((l) => l.kind !== "adjustment");
  const baseTotalCents = regular.reduce((s, l) => s + l.baseCents, 0);
  const feeTotalCents = regular.reduce((s, l) => s + l.feeCents, 0);
  const adjustmentsCents = lines.filter((l) => l.kind === "adjustment").reduce((s, l) => s + l.feeCents, 0);
  return { baseTotalCents, feeTotalCents, adjustmentsCents, totalCents: feeTotalCents + adjustmentsCents, lineCount: lines.length };
}

const HEAD_COLS = `s.id, s.dentist_id AS "dentistId", u.full_name AS "dentistName", m.professional_license AS "license", s.period_start AS "periodStart", s.period_end AS "periodEnd",
  s.status, s.base, s.rules_snapshot AS "rulesSnapshot", s.base_total_cents AS "baseTotalCents", s.fee_total_cents AS "feeTotalCents",
  s.adjustments_cents AS "adjustmentsCents", s.total_cents AS "totalCents", s.line_count AS "lineCount", s.note, s.created_at AS "createdAt",
  s.closed_at AS "closedAt", cu.full_name AS "closedByName"`;
const HEAD_FROM = `fee_settlements s JOIN users u ON u.id = s.dentist_id JOIN memberships m ON m.clinic_id = s.clinic_id AND m.user_id = s.dentist_id
  LEFT JOIN users cu ON cu.id = s.closed_by`;

/** Detalle de una liquidación: si está cerrada, la copia guardada; si es borrador, el cálculo en vivo. */
export async function settlementDetail(c: Client, clinicId: string, id: string) {
  const h = (await c.query(`SELECT ${HEAD_COLS} FROM ${HEAD_FROM} WHERE s.id = $1`, [id])).rows[0];
  if (!h) throw notFound("Liquidación");
  if (h.status === "closed") {
    const lines = (await c.query(
      `SELECT l.id, l.kind, l.branch_id AS "branchId", br.name AS "branchName", l.patient_id AS "patientId", pt.first_name || ' ' || pt.last_name AS "patientName",
              l.charge_id AS "chargeId", l.payment_id AS "paymentId", l.adjusts_line_id AS "adjustsLineId", l.occurred_at AS "occurredAt", l.description,
              l.category, l.quantity, l.base_cents AS "baseCents", l.deduct_cents AS "deductCents", l.mode, l.percent_bp AS "percentBp",
              l.fixed_cents AS "fixedCents", l.fee_cents AS "feeCents", l.lab_actual_cents AS "labActualCents", l.payer_allocation_id AS "payerAllocationId"
         FROM fee_settlement_lines l JOIN branches br ON br.id = l.branch_id LEFT JOIN patients pt ON pt.id = l.patient_id
        WHERE l.settlement_id = $1 ORDER BY (l.kind = 'adjustment'), l.occurred_at, l.id`, [id])).rows;
    return { ...h, baseLabel: BASE_LABELS[h.base as FeeBase], lines, unassigned: null };
  }
  const { cfg, lines, from, to } = await computeLines(c, clinicId, { id: h.id, dentist_id: h.dentistId, period_start: h.periodStart, period_end: h.periodEnd, status: h.status });
  let unassigned = null;
  if (cfg.base === "collected") {
    unassigned = (await c.query<{ count: number; cents: number }>(
      `SELECT count(*)::int AS count, COALESCE(sum(amount_cents),0) AS cents FROM payments
        WHERE budget_id IS NULL AND status = 'confirmed' AND COALESCE(verified_at, received_at) >= $1 AND COALESCE(verified_at, received_at) < $2`, [from, to])).rows[0];
  }
  return { ...h, base: cfg.base, baseLabel: BASE_LABELS[cfg.base], rulesSnapshot: cfg, ...totalsOf(lines), lines, unassigned };
}

/** Cierra la liquidación: guarda las líneas y los totales (inmutables desde ese momento). */
export async function closeSettlement(c: Client, auth: Pick<AuthCtx, "userId" | "clinicId" | "ip">, id: string, note: string | null, opts: { allowOpenPeriod?: boolean } = {}) {
  const s = (await c.query<SettlementRow>("SELECT id, dentist_id, period_start, period_end, status FROM fee_settlements WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!s) throw notFound("Liquidación");
  if (s.status !== "draft") throw conflict("Esta liquidación ya está cerrada", "settlement_closed");
  const zone = await clinicZone(c, auth.clinicId!);
  const today = DateTime.now().setZone(zone).toISODate()!;
  if (!opts.allowOpenPeriod && s.period_end >= today) throw conflict("Solo se cierran períodos ya terminados (la fecha final debe ser anterior a hoy)", "period_not_ended");
  const { cfg, lines } = await computeLines(c, auth.clinicId!, s);
  if (lines.length) {
    await c.query(
      `INSERT INTO fee_settlement_lines (clinic_id, settlement_id, kind, branch_id, patient_id, charge_id, payment_id, adjusts_line_id, occurred_at, description,
                                         category, quantity, base_cents, deduct_cents, mode, percent_bp, fixed_cents, fee_cents, lab_actual_cents, payer_allocation_id)
       SELECT $1, $2, x.kind, x."branchId", x."patientId", x."chargeId", x."paymentId", x."adjustsLineId", x."occurredAt", x.description,
              x.category, x.quantity, x."baseCents", x."deductCents", x.mode, x."percentBp", x."fixedCents", x."feeCents", x."labActualCents", x."payerAllocationId"
         FROM jsonb_to_recordset($3::jsonb) AS x(kind text, "branchId" uuid, "patientId" uuid, "chargeId" uuid, "paymentId" uuid, "adjustsLineId" uuid,
              "occurredAt" timestamptz, description text, category text, quantity int, "baseCents" bigint, "deductCents" bigint, mode text,
              "percentBp" int, "fixedCents" bigint, "feeCents" bigint, "labActualCents" bigint, "payerAllocationId" uuid)`,
      [auth.clinicId, id, JSON.stringify(lines.map(({ branchName: _b, patientName: _p, ...l }) => l))],
    );
  }
  const t = totalsOf(lines);
  await c.query(
    `UPDATE fee_settlements SET status = 'closed', base = $2, rules_snapshot = $3, base_total_cents = $4, fee_total_cents = $5, adjustments_cents = $6,
            total_cents = $7, line_count = $8, note = $9, closed_by = $10, closed_at = now() WHERE id = $1`,
    [id, cfg.base, JSON.stringify(cfg), t.baseTotalCents, t.feeTotalCents, t.adjustmentsCents, t.totalCents, t.lineCount, note, auth.userId],
  );
  await audit(c, auth, "fee_settlement.closed", "fee_settlement", id, { dentistId: s.dentist_id, period: [s.period_start, s.period_end], ...t });
  return t;
}

async function createDraft(c: Client, auth: AuthCtx, dentistId: string, periodStart: string, periodEnd: string) {
  if (periodEnd < periodStart) throw badRequest("La fecha final debe ser igual o posterior a la inicial");
  if (!(await c.query("SELECT 1 FROM fee_profiles WHERE dentist_id = $1", [dentistId])).rowCount) throw conflict("Configura primero la regla de honorarios de este profesional", "fee_rules_missing");
  const ov = await c.query(
    "SELECT 1 FROM fee_settlements WHERE dentist_id = $1 AND daterange(period_start, period_end, '[]') && daterange($2::date, $3::date, '[]')", [dentistId, periodStart, periodEnd]);
  if (ov.rowCount) throw conflict("Ya existe una liquidación de este profesional que se superpone con ese período", "settlement_overlap");
  try {
    const r = await c.query<{ id: string }>(
      "INSERT INTO fee_settlements (clinic_id, dentist_id, period_start, period_end, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [auth.clinicId, dentistId, periodStart, periodEnd, auth.userId]);
    await audit(c, auth, "fee_settlement.created", "fee_settlement", r.rows[0]!.id, { dentistId, periodStart, periodEnd });
    return r.rows[0]!.id;
  } catch (e) {
    if ((e as { constraint?: string }).constraint === "fee_settlements_no_overlap") throw conflict("Ya existe una liquidación de este profesional que se superpone con ese período", "settlement_overlap");
    throw e;
  }
}

async function exportXlsx(c: Client, auth: AuthCtx, id: string, reply: import("fastify").FastifyReply) {
  const d = await settlementDetail(c, auth.clinicId!, id);
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet("Liquidación");
  const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v); // evita inyección de fórmulas
  ws.addRow([`Liquidación de honorarios${d.status === "draft" ? " (BORRADOR, no definitiva)" : ""}`]).font = { bold: true, size: 13 };
  ws.addRow(["Profesional", safe(d.dentistName), "Matrícula", safe(d.license ?? "")]);
  ws.addRow(["Período", `${d.periodStart} a ${d.periodEnd}`, "Base", d.baseLabel]);
  ws.addRow(["Estado", d.status === "closed" ? `Cerrada el ${DateTime.fromJSDate(new Date(d.closedAt)).setZone("America/La_Paz").toFormat("dd/MM/yyyy HH:mm")} por ${d.closedByName}` : "Borrador"]);
  ws.addRow([]);
  ws.addRow(["Base total (Bs)", d.baseTotalCents / 100, "Honorarios (Bs)", d.feeTotalCents / 100]);
  ws.addRow(["Ajustes (Bs)", d.adjustmentsCents / 100, "Total a pagar (Bs)", d.totalCents / 100]).font = { bold: true };
  ws.addRow([]);
  const head = ws.addRow(["Fecha", "Tipo", "Sucursal", "Paciente", "Detalle", "Categoría", "Cant.", "Base (Bs)", "Lab./materiales (Bs)", "Regla", "Honorario (Bs)"]);
  head.font = { bold: true };
  for (const l of d.lines as Line[]) {
    const rule = l.mode === "percent" ? `${(l.percentBp ?? 0) / 100} %` : l.mode === "fixed" ? `Fijo Bs ${((l.fixedCents ?? 0) / 100).toFixed(2)} c/u` : "—";
    ws.addRow([
      DateTime.fromJSDate(new Date(l.occurredAt)).setZone("America/La_Paz").toFormat("yyyy-MM-dd"), KIND_LABELS[l.kind], safe(l.branchName), safe(l.patientName ?? ""),
      safe(l.description), safe(l.category ?? "General"), l.quantity, l.baseCents / 100, l.deductCents / 100, rule, l.feeCents / 100,
    ]);
  }
  [8, 9, 11].forEach((i) => (ws.getColumn(i).numFmt = "#,##0.00"));
  ws.getColumn(2).numFmt = "#,##0.00";
  ws.getColumn(4).numFmt = "#,##0.00";
  ws.columns.forEach((col, i) => (col.width = i === 4 ? 46 : 16));
  await audit(c, auth, "fee_settlement.exported", "fee_settlement", id, { lines: d.lines.length });
  const name = `honorarios-${String(d.dentistName).normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-${d.periodStart}.xlsx`;
  reply
    .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .header("content-disposition", `attachment; filename="${name}"`)
    .send(await xlsxBuffer(wb));
}

/** Resultado por sucursal (FI-04 inicial): cobrado, producción, gastos menores de caja y honorarios liquidados. */
export async function branchResults(c: Client, auth: AuthCtx, from?: string, to?: string) {
  const range = await resolveRange(c, auth, from, to);
  const allowed = allowedBranches(auth);
  const compute = async (f: Date, t: Date, fromDate: string, toDateIncl: string) => {
    const p = [f, t, allowed];
    const collected = (await c.query(
      `SELECT branch_id, sum(amount_cents) AS v FROM payments WHERE status = 'confirmed' AND COALESCE(verified_at, received_at) >= $1
          AND COALESCE(verified_at, received_at) < $2 AND ($3::uuid[] IS NULL OR branch_id = ANY($3)) GROUP BY branch_id`, p)).rows;
    const pending = (await c.query(
      `SELECT branch_id, sum(amount_cents) AS v FROM payments WHERE status = 'pending_verification' AND received_at >= $1 AND received_at < $2
          AND ($3::uuid[] IS NULL OR branch_id = ANY($3)) GROUP BY branch_id`, p)).rows;
    const production = (await c.query(
      `SELECT branch_id, sum(amount_cents) AS v FROM charges WHERE created_at >= $1 AND created_at < $2 AND ($3::uuid[] IS NULL OR branch_id = ANY($3)) GROUP BY branch_id`, p)).rows;
    const petty = (await c.query(
      `SELECT s.branch_id, sum(m.amount_cents) AS v FROM cash_movements m JOIN cash_sessions s ON s.id = m.session_id
        WHERE m.kind = 'out' AND m.category = 'petty_expense' AND m.created_at >= $1 AND m.created_at < $2 AND ($3::uuid[] IS NULL OR s.branch_id = ANY($3))
        GROUP BY s.branch_id`, p)).rows;
    const fees = (await c.query(
      `SELECT l.branch_id, sum(l.fee_cents) AS v FROM fee_settlement_lines l JOIN fee_settlements s ON s.id = l.settlement_id
        WHERE s.status = 'closed' AND s.period_start >= $1::date AND s.period_end <= $2::date AND ($3::uuid[] IS NULL OR l.branch_id = ANY($3))
        GROUP BY l.branch_id`, [fromDate, toDateIncl, allowed])).rows;
    const settlements = (await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM fee_settlements WHERE status = 'closed' AND period_start >= $1::date AND period_end <= $2::date", [fromDate, toDateIncl])).rows[0]!.n;
    return { collected, pending, production, petty, fees, settlements };
  };
  const toIncl = DateTime.fromISO(range.toDateExclusive).minus({ days: 1 }).toISODate()!;
  const cur = await compute(range.from, range.to, range.fromDate, toIncl);
  // Período anterior: los meses calendario previos si el rango son meses completos; si no, la misma cantidad de días.
  const fStart = DateTime.fromISO(range.fromDate, { zone: range.zone });
  const tEnd = DateTime.fromISO(range.toDateExclusive, { zone: range.zone });
  const prevFrom = fStart.day === 1 && tEnd.day === 1
    ? fStart.minus({ months: Math.round(tEnd.diff(fStart, "months").months) })
    : fStart.minus({ days: Math.round(tEnd.diff(fStart, "days").days) });
  const prev = await compute(prevFrom.toJSDate(), range.from, prevFrom.toISODate()!, DateTime.fromISO(range.fromDate).minus({ days: 1 }).toISODate()!);
  const branches = (await c.query<{ id: string; name: string; code: string }>(
    "SELECT id, name, code FROM branches WHERE active AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY code", [allowed])).rows;
  const val = (rows: { branch_id: string; v: number }[], id: string) => Number(rows.find((r) => r.branch_id === id)?.v ?? 0);
  const row = (d: Awaited<ReturnType<typeof compute>>, id: string) => {
    const collectedCents = val(d.collected, id), productionCents = val(d.production, id), pettyExpensesCents = val(d.petty, id), feesCents = val(d.fees, id);
    return { collectedCents, pendingVerificationCents: val(d.pending, id), productionCents, pettyExpensesCents, feesCents, resultCents: collectedCents - feesCents - pettyExpensesCents };
  };
  const sum = (rows: ReturnType<typeof row>[]) => {
    const keys = ["collectedCents", "pendingVerificationCents", "productionCents", "pettyExpensesCents", "feesCents", "resultCents"] as const;
    return Object.fromEntries(keys.map((k) => [k, rows.reduce((s, r) => s + r[k], 0)])) as ReturnType<typeof row>;
  };
  const rows = branches.map((b) => ({ branchId: b.id, branchName: b.name, code: b.code, ...row(cur, b.id) }));
  const total = sum(rows);
  const prevTotal = sum(branches.map((b) => row(prev, b.id)));
  const pct = (a: number, b: number) => (b ? Math.round(((a - b) / Math.abs(b)) * 1000) / 10 : null);
  return {
    range: { from: range.fromDate, to: toIncl },
    previousRange: { from: prevFrom.toISODate(), to: DateTime.fromISO(range.fromDate).minus({ days: 1 }).toISODate() },
    branches: rows, total, previousTotal: prevTotal,
    variationPct: { collected: pct(total.collectedCents, prevTotal.collectedCents), production: pct(total.productionCents, prevTotal.productionCents), result: pct(total.resultCents, prevTotal.resultCents) },
    closedSettlements: cur.settlements,
  };
}

const zRule = z.object({
  category: z.string().trim().min(1).max(60).nullish().transform((v) => v ?? null),
  mode: z.enum(["percent", "fixed"]),
  percent: z.number().min(0, "El porcentaje va de 0 a 100").max(100, "El porcentaje va de 0 a 100").nullish(),
  fixedCents: z.number().int().min(0).max(10_000_000_00).nullish(),
  deductCents: z.number().int().min(0).max(10_000_000_00).default(0),
  deductActualLab: z.boolean().default(false),
});

export function feeRoutes(route: Route) {
  route({
    method: "GET", url: "/api/fees/config", summary: "Reglas de honorarios por profesional y categorías de prestación disponibles", tags: ["honorarios"], perm: "reports.financial",
    handler: async ({ c, auth }) => {
      requireFeesAccess(auth);
      const pros = (await c.query(
        `SELECT m.user_id AS "dentistId", u.full_name AS "dentistName", m.role, m.commission_pct AS "commissionPct", fp.base, fp.notes, fp.updated_at AS "updatedAt",
                COALESCE((SELECT json_agg(json_build_object('category', r.category, 'mode', r.mode, 'percentBp', r.percent_bp, 'fixedCents', r.fixed_cents, 'deductCents', r.deduct_cents, 'deductActualLab', r.deduct_actual_lab_cost)
                                 ORDER BY r.category NULLS FIRST) FROM fee_rules r WHERE r.dentist_id = m.user_id), '[]') AS rules
           FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN fee_profiles fp ON fp.dentist_id = m.user_id
          WHERE m.is_professional AND m.active ORDER BY u.full_name`)).rows;
      const categories = (await c.query<{ category: string }>("SELECT DISTINCT category FROM procedures WHERE active ORDER BY category")).rows.map((r) => r.category);
      return { professionals: pros, categories, baseLabels: BASE_LABELS };
    },
  });

  route({
    method: "PUT", url: "/api/fees/config/:id", summary: "Definir la base y las reglas de honorarios de un profesional (regla general + excepciones por categoría)", tags: ["honorarios"], perm: "staff.manage", params: zIdParams,
    body: z.object({ base: z.enum(["production", "collected"]), notes: zOptText(500), rules: z.array(zRule).min(1).max(40) }),
    handler: async ({ c, auth, params, body }) => {
      requireFeesAccess(auth);
      const m = (await c.query("SELECT 1 FROM memberships WHERE user_id = $1 AND clinic_id = $2 AND is_professional", [params.id, auth.clinicId])).rowCount;
      if (!m) throw notFound("Profesional");
      const general = body.rules.filter((r) => r.category === null);
      if (general.length !== 1) throw badRequest("Debe haber exactamente una regla general (sin categoría)");
      const cats = body.rules.map((r) => r.category).filter(Boolean);
      if (new Set(cats).size !== cats.length) throw badRequest("Hay categorías repetidas en las excepciones");
      const rules = body.rules.map((r, i) => {
        if (r.mode === "percent" && (r.percent == null)) throw badRequest(`Regla ${i + 1}: indica el porcentaje`, { index: i, field: "percent" });
        if (r.mode === "fixed" && (r.fixedCents == null)) throw badRequest(`Regla ${i + 1}: indica el monto fijo`, { index: i, field: "fixedCents" });
        if (r.mode === "fixed" && body.base === "collected") throw badRequest("Con base «cobrado» solo se usan porcentajes (el monto fijo es por tratamiento realizado)", { index: i, field: "mode" });
        if (r.deductCents && body.base === "collected") throw badRequest("El descuento de laboratorio y materiales solo aplica con base «producción»", { index: i, field: "deductCents" });
        if (r.deductActualLab && (body.base === "collected" || r.mode !== "percent")) throw badRequest("El costo real de laboratorio solo se descuenta en reglas por porcentaje con base «producción»", { index: i, field: "deductActualLab" });
        if (r.mode === "percent" && Math.abs(Math.round(r.percent! * 100) - r.percent! * 100) > 1e-6) {
          throw badRequest(`Regla ${i + 1}: el porcentaje admite como máximo 2 decimales`, { index: i, field: "percent" });
        }
        return { category: r.category, mode: r.mode, percentBp: r.mode === "percent" ? Math.round(r.percent! * 100) : null, fixedCents: r.mode === "fixed" ? r.fixedCents! : null, deductCents: r.deductCents, deductActualLab: r.deductActualLab };
      });
      await c.query(
        `INSERT INTO fee_profiles (clinic_id, dentist_id, base, notes, updated_by) VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (clinic_id, dentist_id) DO UPDATE SET base = EXCLUDED.base, notes = EXCLUDED.notes, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [auth.clinicId, params.id, body.base, body.notes, auth.userId]);
      await c.query("DELETE FROM fee_rules WHERE dentist_id = $1", [params.id]);
      for (const r of rules) {
        await c.query("INSERT INTO fee_rules (clinic_id, dentist_id, category, mode, percent_bp, fixed_cents, deduct_cents, deduct_actual_lab_cost) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
          [auth.clinicId, params.id, r.category, r.mode, r.percentBp, r.fixedCents, r.deductCents, r.deductActualLab]);
      }
      await audit(c, auth, "fee_rules.updated", "membership", params.id, { base: body.base, rules });
      return { ok: true };
    },
  });

  route({
    method: "GET", url: "/api/fees/settlements", summary: "Liquidaciones de honorarios (filtros: período, profesional, estado)", tags: ["honorarios"], perm: "reports.financial",
    query: z.object({ from: zDate.optional(), to: zDate.optional(), dentistId: zId.optional(), status: z.enum(["draft", "closed"]).optional() }),
    handler: async ({ c, auth, query }) => {
      requireFeesAccess(auth);
      const rows = (await c.query(
        `SELECT ${HEAD_COLS} FROM ${HEAD_FROM}
          WHERE ($1::date IS NULL OR s.period_end >= $1) AND ($2::date IS NULL OR s.period_start <= $2) AND ($3::uuid IS NULL OR s.dentist_id = $3)
            AND ($4::text IS NULL OR s.status = $4)
          ORDER BY s.period_start DESC, u.full_name LIMIT 300`, [query.from ?? null, query.to ?? null, query.dentistId ?? null, query.status ?? null])).rows;
      // Los borradores muestran el total calculado en vivo.
      for (const r of rows) {
        if (r.status !== "draft") continue;
        try {
          const { cfg, lines } = await computeLines(c, auth.clinicId!, { id: r.id, dentist_id: r.dentistId, period_start: r.periodStart, period_end: r.periodEnd, status: r.status });
          Object.assign(r, { base: cfg.base, ...totalsOf(lines) });
        } catch { /* sin reglas: se muestra sin totales */ }
      }
      return rows.map((r) => ({ ...r, baseLabel: r.base ? BASE_LABELS[r.base as FeeBase] : null, rulesSnapshot: undefined }));
    },
  });

  route({
    method: "POST", url: "/api/fees/settlements", summary: "Crear el borrador de liquidación de un profesional para un período", tags: ["honorarios"], perm: "reports.financial",
    body: z.object({ dentistId: zId, periodStart: zDate, periodEnd: zDate }),
    handler: async ({ c, auth, body }) => {
      requireFeesAccess(auth);
      const id = await createDraft(c, auth, body.dentistId, body.periodStart, body.periodEnd);
      return { id };
    },
  });

  route({
    method: "POST", url: "/api/fees/settlements/bulk", summary: "Crear borradores para todos los profesionales con reglas (omite a quienes ya tienen el período)", tags: ["honorarios"], perm: "reports.financial",
    body: z.object({ periodStart: zDate, periodEnd: zDate }),
    handler: async ({ c, auth, body }) => {
      requireFeesAccess(auth);
      if (body.periodEnd < body.periodStart) throw badRequest("La fecha final debe ser igual o posterior a la inicial");
      const pros = (await c.query<{ dentist_id: string; overlap: boolean }>(
        `SELECT fp.dentist_id, EXISTS (SELECT 1 FROM fee_settlements s WHERE s.dentist_id = fp.dentist_id
                  AND daterange(s.period_start, s.period_end, '[]') && daterange($1::date, $2::date, '[]')) AS overlap
           FROM fee_profiles fp JOIN memberships m ON m.clinic_id = fp.clinic_id AND m.user_id = fp.dentist_id WHERE m.active`, [body.periodStart, body.periodEnd])).rows;
      let created = 0;
      for (const p of pros) if (!p.overlap) { await createDraft(c, auth, p.dentist_id, body.periodStart, body.periodEnd); created++; }
      return { created, skipped: pros.length - created };
    },
  });

  route({
    method: "GET", url: "/api/fees/settlements/:id", summary: "Detalle de una liquidación con sus líneas por tratamiento o cobro", tags: ["honorarios"], perm: "reports.financial", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      requireFeesAccess(auth);
      return { ...(await settlementDetail(c, auth.clinicId!, params.id)), canClose: canClose(auth) };
    },
  });

  route({
    method: "POST", url: "/api/fees/settlements/:id/close", summary: "Cerrar la liquidación: guarda una copia inmutable línea por línea (requiere gestión de personal o de la clínica)", tags: ["honorarios"], perm: "reports.financial", params: zIdParams,
    body: z.object({ note: zOptText(500) }),
    handler: async ({ c, auth, params, body }) => {
      requireFeesAccess(auth);
      if (!canClose(auth)) throw forbidden("Solo administración (gestión de personal o de la clínica) cierra liquidaciones");
      await closeSettlement(c, auth, params.id, body.note);
      return { ...(await settlementDetail(c, auth.clinicId!, params.id)), canClose: true };
    },
  });

  route({
    method: "POST", url: "/api/fees/settlements/:id/discard", summary: "Descartar un borrador de liquidación (las cerradas no se eliminan)", tags: ["honorarios"], perm: "reports.financial", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      requireFeesAccess(auth);
      const s = (await c.query<{ status: string; dentist_id: string }>("SELECT status, dentist_id FROM fee_settlements WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!s) throw notFound("Liquidación");
      if (s.status !== "draft") throw conflict("Una liquidación cerrada no se elimina; los ajustes van al período siguiente", "settlement_closed");
      await c.query("DELETE FROM fee_settlements WHERE id = $1", [params.id]);
      await audit(c, auth, "fee_settlement.discarded", "fee_settlement", params.id, { dentistId: s.dentist_id });
      return { ok: true };
    },
  });

  route({
    method: "GET", url: "/api/fees/settlements/:id/export.xlsx", summary: "Exportar una liquidación a Excel", tags: ["honorarios"], perm: "reports.financial", params: zIdParams, raw: true,
    handler: async ({ c, auth, params, reply }) => {
      requireFeesAccess(auth);
      await exportXlsx(c, auth, params.id, reply);
    },
  });

  // ---- Vista del profesional: solo sus liquidaciones cerradas, de solo lectura ----
  route({
    method: "GET", url: "/api/fees/mine", summary: "Mis liquidaciones de honorarios cerradas", tags: ["honorarios"], perm: "treatments.perform",
    handler: async ({ c, auth }) =>
      (await c.query(`SELECT ${HEAD_COLS} FROM ${HEAD_FROM} WHERE s.dentist_id = $1 AND s.status = 'closed' ORDER BY s.period_start DESC`, [auth.userId])).rows
        .map((r) => ({ ...r, baseLabel: BASE_LABELS[r.base as FeeBase], rulesSnapshot: undefined })),
  });

  const mine = async (c: Client, auth: AuthCtx, id: string) => {
    const s = (await c.query<{ dentist_id: string; status: string }>("SELECT dentist_id, status FROM fee_settlements WHERE id = $1", [id])).rows[0];
    if (!s || s.dentist_id !== auth.userId || s.status !== "closed") throw notFound("Liquidación");
  };
  route({
    method: "GET", url: "/api/fees/mine/:id", summary: "Detalle de una de mis liquidaciones cerradas", tags: ["honorarios"], perm: "treatments.perform", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      await mine(c, auth, params.id);
      return { ...(await settlementDetail(c, auth.clinicId!, params.id)), canClose: false };
    },
  });
  route({
    method: "GET", url: "/api/fees/mine/:id/export.xlsx", summary: "Exportar a Excel una de mis liquidaciones cerradas", tags: ["honorarios"], perm: "treatments.perform", params: zIdParams, raw: true,
    handler: async ({ c, auth, params, reply }) => {
      await mine(c, auth, params.id);
      await exportXlsx(c, auth, params.id, reply);
    },
  });

  route({
    method: "GET", url: "/api/fees/branch-results", summary: "Resultado por sucursal: cobrado, producción, gastos menores y honorarios liquidados, con consolidado y período anterior", tags: ["honorarios", "reportes"], perm: "reports.financial",
    query: z.object({ from: zDate.optional(), to: zDate.optional() }),
    handler: async ({ c, auth, query }) => branchResults(c, auth, query.from, query.to),
  });
}
