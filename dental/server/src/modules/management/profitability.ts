// Rentabilidad mensual por sucursal y por sillón (R2-41, B-033, FI-04).
// Cada número sale de una fuente real del sistema; si una fuente no tiene datos para el mes
// se devuelve null ("sin datos") y el margen se marca como parcial, en lugar de inventar un 0.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zId } from "../../lib/http.js";
import type { Client } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../../lib/rbac.js";
import { allocate, CATEGORIES, CATEGORY_LABELS, monthRange, monthRangeIn, pctChange, zMonth, type MonthRange } from "./common.js";
import { addSheet, bsCell, newWorkbook, sendXlsx } from "./xlsx.js";
import { DateTime } from "luxon";

/** Conceptos del estado de resultados, en orden. */
export const LINES = ["productionCents", "collectedCents", "labCents", "materialsCents", "feesCents", "pettyCashCents", "expensesCents"] as const;
export type Line = (typeof LINES)[number];
export const COST_LINES = ["labCents", "materialsCents", "feesCents", "pettyCashCents", "expensesCents"] as const;
type CostLine = (typeof COST_LINES)[number];

export const LINE_LABELS: Record<Line, string> = {
  productionCents: "Producción",
  collectedCents: "Cobrado",
  labCents: "Costo de laboratorio",
  materialsCents: "Costo de materiales",
  feesCents: "Honorarios liquidados",
  pettyCashCents: "Gastos menores de caja",
  expensesCents: "Gastos de la sucursal",
};

/** De dónde sale cada número (se muestra en la pantalla y en la exportación). */
export const LINE_SOURCES: Record<Line | "marginCents" | "cashMarginCents", string> = {
  productionCents: "Suma de los tratamientos realizados en el mes en la sucursal (cargos de la cuenta del paciente), menos las anulaciones del mes. Es el mismo número del Panel.",
  collectedCents: "Pagos confirmados en el mes, de pacientes y de empresas de convenio (efectivo al recibirlo; transferencia, QR y tarjeta al verificarse en el banco). Lo que paga una empresa cuenta en la sucursal de cada cargo que cubre. Los pendientes de verificación no cuentan.",
  labCents: "Costo de las órdenes de laboratorio recibidas en el mes en la sucursal (módulo Laboratorio). «Sin datos» si la clínica no registró laboratorios.",
  materialsCents: "Consumos de inventario del mes en la sucursal, valorizados al costo del lote registrado en cada salida, o al costo actual del lote si la salida no lo guardó (módulo Inventario: consumo estándar por tratamiento y consumos manuales). «Sin datos» si la sucursal no usa el inventario.",
  feesCents: "Honorarios de las liquidaciones CERRADAS cuyo período cae dentro del mes, por la sucursal de cada línea (módulo Honorarios). «Sin datos» si no hay liquidaciones cerradas del mes.",
  pettyCashCents: "Egresos de caja con concepto «gasto menor» registrados en las cajas de la sucursal en el mes. «Sin datos» si la sucursal no abrió cajas en el mes. No registres el mismo gasto también en Gastos.",
  expensesCents: "Gastos confirmados y no anulados con fecha del mes (pestaña Gastos: alquiler, sueldos, servicios, etc.). Un gasto compartido entre sucursales cuenta en cada una por su parte del reparto. «Sin datos» si no hay ningún gasto confirmado del mes.",
  marginCents: "Producción − laboratorio − materiales − honorarios − gastos menores − gastos. Si falta alguna fuente, el margen es parcial y se indica cuál falta.",
  cashMarginCents: "Igual que el margen, pero partiendo de lo cobrado en lugar de la producción.",
};

export const CHAIR_NOTE = "Producción del sillón: cada tratamiento se atribuye al consultorio de la cita atendida del mismo paciente ese día en la sucursal (prefiriendo la del mismo profesional). "
  + "Si no hay cita con consultorio, va a «Sin sillón identificado». Laboratorio, materiales y honorarios se reparten según la producción de cada sillón; "
  + "los gastos y gastos menores, según las horas de citas atendidas en cada sillón. El reparto es exacto al centavo: la suma de los sillones es el total de la sucursal.";

type Money = number | null;
export interface BranchProfit {
  branchId: string; branchName: string; code: string;
  productionCents: number; collectedCents: number;
  labCents: Money; materialsCents: Money; feesCents: Money; pettyCashCents: Money; expensesCents: Money;
  marginCents: number; cashMarginCents: number; marginPct: number | null; missing: Line[]; complete: boolean;
  expensesByCategory: { category: string; label: string; amountCents: number }[];
  draftExpenses: number; unsettledProfessionals: number;
  chairs?: ChairProfit[];
}
export interface ChairProfit {
  chairId: string | null; chairName: string; productionCents: number; attendedMinutes: number; productionPerHourCents: number | null;
  labCents: Money; materialsCents: Money; feesCents: Money; pettyCashCents: Money; expensesCents: Money; marginCents: number;
}

const byBranch = (rows: { branch_id: string; v: number | string | null }[]) => new Map(rows.map((r) => [r.branch_id, Math.round(Number(r.v ?? 0))]));

async function computeMonth(c: Client, auth: AuthCtx, range: MonthRange, branchIds: string[], withChairs: boolean) {
  const p = [range.from, range.to, branchIds];
  const production = byBranch((await c.query(
    `SELECT branch_id, sum(amount_cents) AS v FROM charges WHERE created_at >= $1 AND created_at < $2 AND branch_id = ANY($3) GROUP BY branch_id`, p)).rows);
  // Cobrado = pagos de pacientes + pagos de empresas de convenio (B-097), confirmados en el mes. Lo de
  // una empresa se atribuye a la sucursal de cada cargo que paga (asignación); lo que no se asignó
  // a cargos, a la sucursal donde se registró el pago. Sin doble conteo: un pago de empresa no es un
  // pago del paciente (la porción de la empresa nunca entra al saldo del paciente).
  const collected = byBranch((await c.query(
    `WITH pp AS (SELECT id, branch_id, amount_cents FROM payer_payments
                  WHERE status = 'confirmed' AND COALESCE(verified_at, received_at) >= $1 AND COALESCE(verified_at, received_at) < $2),
          payer AS (
            SELECT ch.branch_id, sum(a.amount_cents) AS v FROM payer_payment_allocations a JOIN pp ON pp.id = a.payment_id JOIN charges ch ON ch.id = a.charge_id GROUP BY ch.branch_id
            UNION ALL
            SELECT pp.branch_id, pp.amount_cents - COALESCE((SELECT sum(a.amount_cents) FROM payer_payment_allocations a WHERE a.payment_id = pp.id), 0) FROM pp),
          patient AS (
            SELECT branch_id, sum(amount_cents) AS v FROM payments WHERE status = 'confirmed' AND COALESCE(verified_at, received_at) >= $1
               AND COALESCE(verified_at, received_at) < $2 GROUP BY branch_id)
     SELECT branch_id, sum(v) AS v FROM (SELECT * FROM patient UNION ALL SELECT * FROM payer) x WHERE branch_id = ANY($3) GROUP BY branch_id`, p)).rows);
  // Laboratorio
  const hasLabs = !!(await c.query("SELECT 1 FROM labs LIMIT 1")).rowCount;
  const lab = byBranch((await c.query(
    `SELECT branch_id, sum(cost_cents) AS v FROM lab_orders
      WHERE status <> 'cancelled' AND received_on >= $1::date AND received_on < $2::date AND cost_cents IS NOT NULL AND branch_id = ANY($3)
      GROUP BY branch_id`, [range.fromDate, range.toDateExclusive, branchIds])).rows);
  // Materiales
  const invBranches = new Set((await c.query<{ branch_id: string }>("SELECT DISTINCT branch_id FROM inv_stock WHERE branch_id = ANY($1)", [branchIds])).rows.map((r) => r.branch_id));
  const materials = byBranch((await c.query(
    `SELECT m.branch_id, sum(-m.qty * coalesce(m.unit_cost, l.unit_cost, 0)) AS v FROM inv_movements m JOIN inv_lots l ON l.id = m.lot_id
      WHERE m.kind = 'consumption' AND m.created_at >= $1 AND m.created_at < $2 AND m.branch_id = ANY($3) GROUP BY m.branch_id`, p)).rows);
  // Honorarios (misma regla que «Resultado por sucursal»: liquidaciones cerradas con período dentro del rango)
  const closedSettlements = (await c.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM fee_settlements WHERE status = 'closed' AND period_start >= $1::date AND period_end <= $2::date", [range.fromDate, range.toDate])).rows[0]!.n;
  const fees = byBranch((await c.query(
    `SELECT l.branch_id, sum(l.fee_cents) AS v FROM fee_settlement_lines l JOIN fee_settlements s ON s.id = l.settlement_id
      WHERE s.status = 'closed' AND s.period_start >= $1::date AND s.period_end <= $2::date AND l.branch_id = ANY($3) GROUP BY l.branch_id`,
    [range.fromDate, range.toDate, branchIds])).rows);
  const unsettled = byBranch((await c.query(
    `SELECT ch.branch_id, count(DISTINCT ch.dentist_id) AS v FROM charges ch
      WHERE ch.created_at >= $1 AND ch.created_at < $2 AND ch.branch_id = ANY($3) AND ch.dentist_id IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM fee_settlements s WHERE s.status = 'closed' AND s.dentist_id = ch.dentist_id
                         AND s.period_start >= $4::date AND s.period_end <= $5::date)
      GROUP BY ch.branch_id`, [...p, range.fromDate, range.toDate])).rows);
  // Gastos menores de caja
  const cashBranches = new Set((await c.query<{ branch_id: string }>(
    "SELECT DISTINCT branch_id FROM cash_sessions WHERE opened_at < $2 AND (closed_at IS NULL OR closed_at >= $1) AND branch_id = ANY($3)", p)).rows.map((r) => r.branch_id));
  const petty = byBranch((await c.query(
    `SELECT s.branch_id, sum(m.amount_cents) AS v FROM cash_movements m JOIN cash_sessions s ON s.id = m.session_id
      WHERE m.kind = 'out' AND m.category = 'petty_expense' AND m.created_at >= $1 AND m.created_at < $2 AND s.branch_id = ANY($3) GROUP BY s.branch_id`, p)).rows);
  // Gastos (un gasto compartido cuenta en cada sucursal por su parte del reparto, exacta al centavo: B-083)
  const EXP_PARTS = `(SELECT e.id, e.status, e.category, e.expense_date, COALESCE(s.branch_id, e.branch_id) AS branch_id, COALESCE(s.amount_cents, e.amount_cents) AS amount_cents
                        FROM expenses e LEFT JOIN expense_shares s ON s.expense_id = e.id
                       WHERE NOT EXISTS (SELECT 1 FROM expense_voids x WHERE x.expense_id = e.id)) e`;
  const expRows = (await c.query<{ branch_id: string; category: string; v: number; n: number }>(
    `SELECT e.branch_id, e.category, sum(e.amount_cents) AS v, count(*)::int AS n FROM ${EXP_PARTS}
      WHERE e.status = 'confirmed' AND e.expense_date >= $1::date AND e.expense_date < $2::date AND e.branch_id = ANY($3)
      GROUP BY e.branch_id, e.category`, [range.fromDate, range.toDateExclusive, branchIds])).rows;
  const drafts = byBranch((await c.query(
    `SELECT e.branch_id, count(*) AS v FROM ${EXP_PARTS} WHERE e.status = 'draft'
        AND e.expense_date >= $1::date AND e.expense_date < $2::date AND e.branch_id = ANY($3) GROUP BY e.branch_id`,
    [range.fromDate, range.toDateExclusive, branchIds])).rows);

  const result = new Map<string, Omit<BranchProfit, "branchId" | "branchName" | "code">>();
  for (const b of branchIds) {
    const exp = expRows.filter((r) => r.branch_id === b);
    const line: Record<Line, Money> = {
      productionCents: production.get(b) ?? 0,
      collectedCents: collected.get(b) ?? 0,
      labCents: hasLabs ? lab.get(b) ?? 0 : null,
      materialsCents: invBranches.has(b) ? materials.get(b) ?? 0 : null,
      feesCents: closedSettlements > 0 ? fees.get(b) ?? 0 : null,
      pettyCashCents: cashBranches.has(b) ? petty.get(b) ?? 0 : null,
      expensesCents: exp.length ? exp.reduce((s, r) => s + Number(r.v), 0) : null,
    };
    const costs = COST_LINES.reduce((s, k) => s + (line[k] ?? 0), 0);
    const missing = COST_LINES.filter((k) => line[k] == null) as Line[];
    const marginCents = line.productionCents! - costs;
    result.set(b, {
      productionCents: line.productionCents!, collectedCents: line.collectedCents!,
      labCents: line.labCents, materialsCents: line.materialsCents, feesCents: line.feesCents, pettyCashCents: line.pettyCashCents, expensesCents: line.expensesCents,
      marginCents, cashMarginCents: line.collectedCents! - costs,
      marginPct: line.productionCents ? Math.round((marginCents / line.productionCents) * 1000) / 10 : null,
      missing, complete: missing.length === 0,
      expensesByCategory: CATEGORIES.map((k) => ({ category: k, label: CATEGORY_LABELS[k]!, amountCents: Number(exp.find((r) => r.category === k)?.v ?? 0) })).filter((x) => x.amountCents > 0),
      draftExpenses: drafts.get(b) ?? 0,
      unsettledProfessionals: unsettled.get(b) ?? 0,
    });
  }
  if (withChairs) {
    for (const b of branchIds) result.get(b)!.chairs = await chairBreakdown(c, range, b, result.get(b)!);
  }
  return result;
}

/** Desglose por sillón con reparto exacto (la suma de los sillones = total de la sucursal). */
async function chairBreakdown(c: Client, range: MonthRange, branchId: string, totals: Omit<BranchProfit, "branchId" | "branchName" | "code">): Promise<ChairProfit[]> {
  const chairs = (await c.query<{ id: string; name: string; active: boolean }>(
    "SELECT id, name, active FROM chairs WHERE branch_id = $1 ORDER BY name", [branchId])).rows;
  // Atribución de cada cargo a un consultorio (ver CHAIR_NOTE). Las anulaciones siguen al cargo original.
  const prod = (await c.query<{ chair_id: string | null; v: number }>(
    `SELECT x.chair_id, sum(x.amount_cents) AS v FROM (
       SELECT ch.amount_cents,
              (SELECT a.chair_id FROM appointments a
                WHERE a.patient_id = o.patient_id AND a.branch_id = o.branch_id AND a.chair_id IS NOT NULL
                  AND a.status IN ('arrived','in_progress','completed')
                  AND (a.starts_at AT TIME ZONE $4)::date = (o.created_at AT TIME ZONE $4)::date
                ORDER BY (a.dentist_id IS NOT DISTINCT FROM o.dentist_id) DESC, abs(extract(epoch FROM a.starts_at - o.created_at)), a.id
                LIMIT 1) AS chair_id
         FROM charges ch LEFT JOIN charges orig ON orig.id = ch.voids_charge_id
         CROSS JOIN LATERAL (SELECT COALESCE(orig.patient_id, ch.patient_id) AS patient_id, COALESCE(orig.branch_id, ch.branch_id) AS branch_id,
                                    COALESCE(orig.created_at, ch.created_at) AS created_at, COALESCE(orig.dentist_id, ch.dentist_id) AS dentist_id) o
        WHERE ch.branch_id = $3 AND ch.created_at >= $1 AND ch.created_at < $2) x
     GROUP BY x.chair_id`, [range.from, range.to, branchId, range.zone])).rows;
  const minutes = (await c.query<{ chair_id: string; v: number }>(
    `SELECT chair_id, sum(extract(epoch FROM ends_at - starts_at) / 60)::int AS v FROM appointments
      WHERE branch_id = $3 AND chair_id IS NOT NULL AND status = 'completed' AND starts_at >= $1 AND starts_at < $2 GROUP BY chair_id`,
    [range.from, range.to, branchId])).rows;
  const slots: { chairId: string | null; chairName: string; productionCents: number; attendedMinutes: number }[] = chairs
    .map((ch) => ({ chairId: ch.id, chairName: ch.name, productionCents: Math.round(Number(prod.find((r) => r.chair_id === ch.id)?.v ?? 0)), attendedMinutes: Number(minutes.find((r) => r.chair_id === ch.id)?.v ?? 0) }))
    .filter((s, i) => chairs[i]!.active || s.productionCents !== 0 || s.attendedMinutes > 0);
  slots.push({ chairId: null, chairName: "Sin sillón identificado", productionCents: Math.round(Number(prod.find((r) => r.chair_id == null)?.v ?? 0)), attendedMinutes: 0 });
  const last = slots.length - 1;
  const spread = (total: Money, weights: number[]): Money[] => {
    if (total == null) return slots.map(() => null);
    const a = allocate(total, weights);
    return a ?? slots.map((_, i) => (i === last ? total : 0)); // sin base de reparto: queda en «sin sillón»
  };
  const prodW = slots.map((s) => s.productionCents);
  const timeW = slots.map((s) => s.attendedMinutes);
  const alloc: Record<CostLine, Money[]> = {
    labCents: spread(totals.labCents, prodW), materialsCents: spread(totals.materialsCents, prodW), feesCents: spread(totals.feesCents, prodW),
    pettyCashCents: spread(totals.pettyCashCents, timeW), expensesCents: spread(totals.expensesCents, timeW),
  };
  return slots.map((s, i) => {
    const costs = COST_LINES.reduce((sum, k) => sum + (alloc[k][i] ?? 0), 0);
    return {
      ...s,
      productionPerHourCents: s.attendedMinutes ? Math.round((s.productionCents * 60) / s.attendedMinutes) : null,
      labCents: alloc.labCents[i]!, materialsCents: alloc.materialsCents[i]!, feesCents: alloc.feesCents[i]!,
      pettyCashCents: alloc.pettyCashCents[i]!, expensesCents: alloc.expensesCents[i]!,
      marginCents: s.productionCents - costs,
    };
  }).filter((s, i) => i !== last || s.productionCents !== 0 || COST_LINES.some((k) => (s[k] ?? 0) !== 0));
}

const sumMoney = (vals: Money[]): Money => (vals.every((v) => v == null) ? null : vals.reduce<number>((s, v) => s + (v ?? 0), 0));

export async function profitability(c: Client, auth: AuthCtx, q: { month?: string; branchId?: string }) {
  if (q.branchId) requireBranch(auth, q.branchId);
  const range = await monthRange(c, auth, q.month);
  const allowed = allowedBranches(auth);
  const branches = (await c.query<{ id: string; name: string; code: string }>(
    "SELECT id, name, code FROM branches WHERE active AND ($1::uuid[] IS NULL OR id = ANY($1)) AND ($2::uuid IS NULL OR id = $2) ORDER BY code",
    [allowed, q.branchId ?? null])).rows;
  const ids = branches.map((b) => b.id);
  const cur = await computeMonth(c, auth, range, ids, true);
  const prevMonth = DateTime.fromISO(`${range.month}-01`).minus({ months: 1 }).toFormat("yyyy-MM");
  const prevRange = monthRangeIn(range.zone, prevMonth);
  const prev = await computeMonth(c, auth, prevRange, ids, false);
  const rows: BranchProfit[] = branches.map((b) => ({ branchId: b.id, branchName: b.name, code: b.code, ...cur.get(b.id)! }));
  const prevRows = branches.map((b) => prev.get(b.id)!);
  const total = {
    productionCents: rows.reduce((s, r) => s + r.productionCents, 0),
    collectedCents: rows.reduce((s, r) => s + r.collectedCents, 0),
    ...Object.fromEntries(COST_LINES.map((k) => [k, sumMoney(rows.map((r) => r[k]))])) as Record<CostLine, Money>,
    marginCents: rows.reduce((s, r) => s + r.marginCents, 0),
    cashMarginCents: rows.reduce((s, r) => s + r.cashMarginCents, 0),
    missing: [...new Set(rows.flatMap((r) => r.missing))],
    expensesByCategory: CATEGORIES.map((k) => ({ category: k, label: CATEGORY_LABELS[k]!, amountCents: rows.reduce((s, r) => s + (r.expensesByCategory.find((x) => x.category === k)?.amountCents ?? 0), 0) })).filter((x) => x.amountCents > 0),
  };
  const prevTotal = { productionCents: prevRows.reduce((s, r) => s + r.productionCents, 0), collectedCents: prevRows.reduce((s, r) => s + r.collectedCents, 0), marginCents: prevRows.reduce((s, r) => s + r.marginCents, 0) };
  return {
    month: range.month, label: range.label, from: range.fromDate, to: range.toDate,
    previous: { month: prevMonth, label: prevRange.label, total: prevTotal },
    branches: rows.map((r, i) => ({
      ...r,
      variation: {
        productionPct: pctChange(r.productionCents, prevRows[i]!.productionCents),
        collectedPct: pctChange(r.collectedCents, prevRows[i]!.collectedCents),
        marginPct: pctChange(r.marginCents, prevRows[i]!.marginCents),
      },
    })),
    total: {
      ...total,
      marginPct: total.productionCents ? Math.round((total.marginCents / total.productionCents) * 1000) / 10 : null,
      complete: total.missing.length === 0,
      variation: { productionPct: pctChange(total.productionCents, prevTotal.productionCents), collectedPct: pctChange(total.collectedCents, prevTotal.collectedCents), marginPct: pctChange(total.marginCents, prevTotal.marginCents) },
    },
    lineLabels: LINE_LABELS, sources: LINE_SOURCES, chairNote: CHAIR_NOTE,
  };
}

const zQuery = z.object({ month: zMonth.optional(), branchId: zId.optional() });

export function profitabilityRoutes(route: Route) {
  route({
    method: "GET", url: "/api/management/profitability", summary: "Rentabilidad mensual por sucursal y por sillón: producción, cobrado, laboratorio, materiales, honorarios, gastos y margen, con la fuente de cada número", tags: ["gestión"],
    perm: "reports.financial", query: zQuery,
    handler: async ({ c, auth, query }) => profitability(c, auth, query),
  });

  route({
    method: "GET", url: "/api/management/profitability.xlsx", summary: "Exportar a Excel la rentabilidad del mes (mismos filtros y totales que la pantalla)", tags: ["gestión"],
    perm: "reports.financial", query: zQuery, raw: true,
    handler: async ({ c, auth, query, reply }) => {
      const d = await profitability(c, auth, query);
      const wb = newWorkbook();
      const concept = [...LINES, "marginCents", "cashMarginCents"] as const;
      const label = (k: (typeof concept)[number]) => (k === "marginCents" ? "Margen (sobre producción)" : k === "cashMarginCents" ? "Margen de caja (sobre lo cobrado)" : LINE_LABELS[k]);
      const consolidated = d.branches.length > 1;
      addSheet(wb, "Por sucursal",
        [{ header: "Concepto", width: 34 }, ...d.branches.map((b) => ({ header: b.branchName, money: true })), ...(consolidated ? [{ header: "Consolidado", money: true }] : []), { header: "De dónde sale", width: 90 }],
        concept.map((k) => [label(k), ...d.branches.map((b) => bsCell((b as any)[k])), ...(consolidated ? [bsCell((d.total as any)[k])] : []), LINE_SOURCES[k]]),
        { title: `Rentabilidad · ${d.label}`, notes: [
          "Celda vacía = sin datos para esa fuente en el mes (no se asume cero).",
          ...d.branches.filter((b) => !b.complete).map((b) => `${b.branchName}: margen parcial, falta ${b.missing.map((m) => LINE_LABELS[m].toLowerCase()).join(", ")}.`),
        ] });
      const chairRows = d.branches.flatMap((b) => (b.chairs ?? []).map((ch) => [b.branchName, ch.chairName, bsCell(ch.productionCents), Math.round((ch.attendedMinutes / 60) * 100) / 100,
        bsCell(ch.productionPerHourCents), bsCell(ch.labCents), bsCell(ch.materialsCents), bsCell(ch.feesCents), bsCell(ch.pettyCashCents), bsCell(ch.expensesCents), bsCell(ch.marginCents)]));
      addSheet(wb, "Por sillón", [
        { header: "Sucursal" }, { header: "Sillón" }, { header: "Producción", money: true }, { header: "Horas atendidas", fmt: "0.00" }, { header: "Producción por hora", money: true },
        { header: "Laboratorio", money: true }, { header: "Materiales", money: true }, { header: "Honorarios", money: true }, { header: "Gastos menores", money: true },
        { header: "Gastos", money: true }, { header: "Margen", money: true },
      ], chairRows, { totals: ["Total", "", bsCell(d.total.productionCents), "", "", bsCell(d.total.labCents), bsCell(d.total.materialsCents), bsCell(d.total.feesCents),
        bsCell(d.total.pettyCashCents), bsCell(d.total.expensesCents), bsCell(d.total.marginCents)], notes: [CHAIR_NOTE] });
      addSheet(wb, "Gastos por categoría", [{ header: "Sucursal" }, { header: "Categoría", width: 28 }, { header: "Monto (Bs)", money: true }],
        d.branches.flatMap((b) => b.expensesByCategory.map((x) => [b.branchName, x.label, bsCell(x.amountCents)])),
        { totals: ["Total", "", bsCell(d.total.expensesCents)] });
      await audit(c, auth, "report.exported", "profitability", null, { month: d.month, branchId: query.branchId ?? null });
      await sendXlsx(reply, wb, `rentabilidad-${d.month}`);
    },
  });
}
