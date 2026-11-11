// Gastos por sucursal (R2-41, FI-05 parcial): categorías, comprobante, recurrentes mensuales
// que se generan como borrador y anulación con motivo (solo inserción).
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../../lib/http.js";
import type { Client } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { allowedBranches, canAccessBranch, requireBranch, type AuthCtx } from "../../lib/rbac.js";
import { CATEGORIES, CATEGORY_LABELS, localToday, monthRange, zMonth } from "./common.js";
import { addSheet, bsCell, newWorkbook, sendXlsx } from "./xlsx.js";
import { mainShareIndex, parseShares, requireShareBranches, saveShares, scopeOf, zShares } from "./shares.js";

const zAmount = z.number().int("Monto en centavos (entero)").min(1, "El monto debe ser mayor que cero").max(100_000_000_000, "Monto demasiado alto");
const zCategory = z.enum(CATEGORIES, { message: "Elige una categoría" });
const zDescription = z.string().trim().min(3, "Describe el gasto (mínimo 3 caracteres)").max(200, "Máximo 200 caracteres");

const zExpense = z.object({
  branchId: zId,
  category: zCategory,
  description: zDescription,
  amountCents: zAmount,
  expenseDate: zDate,
  supplier: zOptText(120),
  receiptRef: zOptText(120),
  notes: zOptText(500),
  asDraft: z.boolean().default(false),
  idempotencyKey: z.string().trim().min(8).max(80).optional(),
  // Gasto compartido (B-083): % por sucursal que suma 100. Vacío o ausente = solo `branchId`.
  shares: zShares,
});

const zListQuery = z.object({
  month: zMonth.optional(),
  branchId: zId.optional(),
  category: zCategory.optional(),
  status: z.enum(["all", "draft", "confirmed", "voided"]).default("all"),
});
export type ExpenseQuery = z.infer<typeof zListQuery>;

export const EXPENSE_COLS = `e.id, e.branch_id AS "branchId", b.name AS "branchName", e.category, e.description, e.amount_cents AS "amountCents",
  e.expense_date AS "expenseDate", e.supplier, e.receipt_ref AS "receiptRef", e.notes, e.status, e.recurring_id AS "recurringId",
  e.period_month AS "periodMonth", e.created_at AS "createdAt", cu.full_name AS "createdByName", e.confirmed_at AS "confirmedAt",
  v.reason AS "voidReason", v.voided_at AS "voidedAt", vu.full_name AS "voidedByName",
  COALESCE((SELECT json_agg(json_build_object('branchId', s.branch_id, 'branchName', sb.name, 'percentBp', s.percent_bp, 'amountCents', s.amount_cents)
                            ORDER BY s.percent_bp DESC, sb.code)
              FROM expense_shares s JOIN branches sb ON sb.id = s.branch_id WHERE s.expense_id = e.id), '[]'::json) AS shares,
  (SELECT count(*)::int FROM expense_attachments a WHERE a.expense_id = e.id) AS "attachmentCount"`;
const EXPENSE_FROM = `expenses e JOIN branches b ON b.id = e.branch_id JOIN users cu ON cu.id = e.created_by
  LEFT JOIN expense_voids v ON v.expense_id = e.id LEFT JOIN users vu ON vu.id = v.voided_by`;

type ShareRow = { branchId: string; branchName: string; percentBp: number; amountCents: number };
interface ExpenseRow {
  id: string; branchId: string; branchName: string; category: string; description: string; amountCents: number; expenseDate: string;
  supplier: string | null; receiptRef: string | null; notes: string | null; status: string; recurringId: string | null; voidReason: string | null;
  attachmentCount: number; shares: ShareRow[]; state: string; stateLabel: string; categoryLabel: string; [k: string]: unknown;
}
const decorate = (x: Record<string, any>): ExpenseRow => ({
  ...x,
  amountCents: Number(x.amountCents),
  shares: (x.shares ?? []).map((s: ShareRow) => ({ ...s, percentBp: Number(s.percentBp), amountCents: Number(s.amountCents) })),
  categoryLabel: CATEGORY_LABELS[x.category] ?? x.category,
  state: x.voidedAt ? "voided" : x.status,
  stateLabel: x.voidedAt ? "Anulado" : x.status === "draft" ? "Borrador" : "Confirmado",
}) as ExpenseRow;

/** Sucursales del gasto: las del reparto o la única. */
const branchesOf = (e: { branchId: string; shares: ShareRow[] }) => (e.shares.length ? e.shares.map((s) => s.branchId) : [e.branchId]);

/** Parte del gasto que corresponde a las sucursales del alcance (null = todas). */
const scopedCents = (e: { branchId: string; amountCents: number; shares: ShareRow[] }, scope: string[] | null) =>
  !e.shares.length ? (scope === null || scope.includes(e.branchId) ? e.amountCents : 0)
    : e.shares.filter((s) => scope === null || scope.includes(s.branchId)).reduce((a, s) => a + s.amountCents, 0);

/** Lista y totales de gastos del mes (lo usan la pantalla y la exportación: mismos filtros, mismos totales).
 *  Un gasto compartido aparece en cada sucursal del reparto; los totales cuentan solo la parte de las
 *  sucursales del alcance (la filtrada o las permitidas), así cuadran con la rentabilidad. */
export async function expenseList(c: Client, auth: AuthCtx, q: ExpenseQuery) {
  if (q.branchId) requireBranch(auth, q.branchId);
  const range = await monthRange(c, auth, q.month);
  const allowed = allowedBranches(auth);
  const scope = scopeOf(auth, q.branchId);
  const rows = (await c.query(
    `SELECT ${EXPENSE_COLS} FROM ${EXPENSE_FROM}
      WHERE e.expense_date >= $1::date AND e.expense_date < $2::date
        AND ($3::uuid IS NULL OR e.branch_id = $3 OR EXISTS (SELECT 1 FROM expense_shares s WHERE s.expense_id = e.id AND s.branch_id = $3))
        AND ($4::uuid[] IS NULL OR e.branch_id = ANY($4) OR EXISTS (SELECT 1 FROM expense_shares s WHERE s.expense_id = e.id AND s.branch_id = ANY($4)))
        AND ($5::text IS NULL OR e.category = $5)
      ORDER BY e.expense_date DESC, e.created_at DESC`,
    [range.fromDate, range.toDateExclusive, q.branchId ?? null, allowed, q.category ?? null])).rows.map(decorate)
    .map((r) => ({ ...r, scopeCents: scopedCents(r, scope), canEdit: branchesOf(r).every((b) => canAccessBranch(auth, b)) }));
  const items = q.status === "all" ? rows : rows.filter((r) => r.state === q.status);
  const confirmed = rows.filter((r) => r.state === "confirmed");
  const byCategory = CATEGORIES.map((k) => ({
    category: k, label: CATEGORY_LABELS[k]!, amountCents: confirmed.filter((r) => r.category === k).reduce((s, r) => s + r.scopeCents, 0),
  })).filter((x) => x.amountCents > 0);
  const recurringPending = (await c.query<{ n: number }>(
    `SELECT count(*)::int AS n FROM expense_recurring r
      WHERE r.active AND r.starts_month <= $1::date AND (r.ends_month IS NULL OR r.ends_month >= $1::date)
        AND ($2::uuid IS NULL OR r.branch_id = $2) AND ($3::uuid[] IS NULL OR r.branch_id = ANY($3))
        AND NOT EXISTS (SELECT 1 FROM expenses e WHERE e.recurring_id = r.id AND e.period_month = $1::date)`,
    [range.fromDate, q.branchId ?? null, allowed])).rows[0]!.n;
  return {
    month: range.month, label: range.label, from: range.fromDate, to: range.toDate,
    items,
    totals: {
      confirmedCents: confirmed.reduce((s, r) => s + r.scopeCents, 0),
      confirmedCount: confirmed.length,
      draftCents: rows.filter((r) => r.state === "draft").reduce((s, r) => s + r.scopeCents, 0),
      draftCount: rows.filter((r) => r.state === "draft").length,
      voidedCount: rows.filter((r) => r.state === "voided").length,
      listedCents: items.reduce((s, r) => s + r.scopeCents, 0),
      listedFullCents: items.reduce((s, r) => s + r.amountCents, 0),
      sharedCount: items.filter((r) => r.shares.length).length,
      byCategory,
    },
    recurringPending,
  };
}

/** Un gasto se ve si alguna de sus sucursales está permitida; se modifica solo con acceso a todas ellas. */
export async function loadExpense(c: Client, auth: AuthCtx, id: string, mode: "read" | "write" = "write") {
  const e = (await c.query(`SELECT ${EXPENSE_COLS} FROM ${EXPENSE_FROM} WHERE e.id = $1`, [id])).rows[0];
  if (!e) throw notFound("Gasto");
  const d = decorate(e);
  const branches = branchesOf(d);
  if (mode === "read") { if (!branches.some((b) => canAccessBranch(auth, b))) throw notFound("Gasto"); }
  else requireShareBranches(auth, branches);
  return d;
}

/** Sucursal principal y reparto a guardar (valida el acceso a cada sucursal). */
function resolveShares(auth: AuthCtx, body: { branchId: string; shares?: z.infer<typeof zShares> }) {
  const shares = parseShares(body.shares);
  if (!shares) { requireBranch(auth, body.branchId); return { branchId: body.branchId, shares: null }; }
  requireShareBranches(auth, shares.map((s) => s.branchId));
  return { branchId: shares[mainShareIndex(shares.map((s) => s.bp))]!.branchId, shares };
}

function checkDateForConfirm(date: string, today: string) {
  if (date > today) {
    throw new AppError(400, "validation", "Un gasto confirmado no puede tener fecha posterior a hoy. Guárdalo como borrador y confírmalo cuando se pague.",
      [{ path: "expenseDate", message: "La fecha es posterior a hoy" }]);
  }
}

/** Genera los borradores de los recurrentes del mes. Idempotente: nunca duplica (índice único por recurrente y mes). */
export async function generateRecurring(c: Client, auth: AuthCtx, month: string, branchId?: string | null) {
  const allowed = allowedBranches(auth);
  const r = await c.query<{ id: string; branch_id: string }>(
    `INSERT INTO expenses (clinic_id, branch_id, category, description, amount_cents, expense_date, supplier, status, recurring_id, period_month, created_by)
     SELECT r.clinic_id, r.branch_id, r.category, r.description, r.amount_cents,
            ($1::date + (r.day_of_month - 1)), r.supplier, 'draft', r.id, $1::date, $2
       FROM expense_recurring r
      WHERE r.active AND r.starts_month <= $1::date AND (r.ends_month IS NULL OR r.ends_month >= $1::date)
        AND ($3::uuid IS NULL OR r.branch_id = $3) AND ($4::uuid[] IS NULL OR r.branch_id = ANY($4))
     ON CONFLICT (recurring_id, period_month) WHERE recurring_id IS NOT NULL DO NOTHING
     RETURNING id, branch_id`,
    [`${month}-01`, auth.userId, branchId ?? null, allowed]);
  for (const x of r.rows) await audit(c, auth, "expense.generated", "expense", x.id, { month }, x.branch_id);
  return r.rowCount ?? 0;
}

export function expenseRoutes(route: Route) {
  route({
    method: "GET", url: "/api/expenses", summary: "Gastos del mes por sucursal y categoría, con totales (confirmados, borradores y anulados) y recurrentes por generar", tags: ["gestión"],
    perm: "reports.financial", query: zListQuery,
    handler: async ({ c, auth, query }) => expenseList(c, auth, query),
  });

  route({
    method: "GET", url: "/api/expenses.xlsx", summary: "Exportar a Excel los gastos del mes (mismos filtros que la pantalla)", tags: ["gestión"],
    perm: "reports.financial", query: zListQuery, raw: true,
    handler: async ({ c, auth, query, reply }) => {
      const d = await expenseList(c, auth, query);
      const wb = newWorkbook();
      addSheet(wb, "Gastos", [
        { header: "Fecha", width: 12 }, { header: "Sucursal" }, { header: "Categoría", width: 24 }, { header: "Descripción", width: 34 },
        { header: "Proveedor" }, { header: "Comprobante" }, { header: "Estado", width: 12 }, { header: "Monto (Bs)", money: true }, { header: "Motivo de anulación", width: 30 },
        { header: "Reparto entre sucursales", width: 40 }, { header: "Parte que cuenta aquí (Bs)", money: true }, { header: "Archivos adjuntos", width: 10 },
      ], d.items.map((x) => [x.expenseDate, x.branchName, x.categoryLabel, x.description, x.supplier, x.receiptRef, x.stateLabel, bsCell(x.amountCents), x.voidReason,
        x.shares.map((s) => `${s.branchName} ${(s.percentBp / 100).toLocaleString("es-BO")} % = Bs ${(s.amountCents / 100).toFixed(2)}`).join("; ") || "", bsCell(x.scopeCents), x.attachmentCount]),
      { title: `Gastos · ${d.label}`, totals: ["Total de la lista", "", "", "", "", "", "", bsCell(d.totals.listedFullCents), "", "", bsCell(d.totals.listedCents), ""],
        notes: [`Confirmados: Bs ${(d.totals.confirmedCents / 100).toFixed(2)} (${d.totals.confirmedCount}). Borradores: ${d.totals.draftCount}. Anulados: ${d.totals.voidedCount}.`,
          "Solo los gastos confirmados y no anulados cuentan en la rentabilidad.",
          "Un gasto compartido cuenta en cada sucursal solo por su parte (columna «Parte que cuenta aquí»); los totales de la pantalla usan esa parte."] });
      addSheet(wb, "Por categoría", [{ header: "Categoría", width: 28 }, { header: "Confirmado (Bs)", money: true }],
        d.totals.byCategory.map((x) => [x.label, bsCell(x.amountCents)]), { totals: ["Total", bsCell(d.totals.confirmedCents)] });
      await audit(c, auth, "report.exported", "expenses", null, { month: d.month, branchId: query.branchId ?? null, rows: d.items.length });
      await sendXlsx(reply, wb, `gastos-${d.month}`);
    },
  });

  route({
    method: "POST", url: "/api/expenses",
    summary: "Registrar un gasto (confirmado o como borrador), de una sucursal o compartido por porcentaje entre varias (shares). Idempotente con idempotencyKey", tags: ["gestión"],
    perm: "reports.financial", body: zExpense,
    handler: async ({ c, auth, body }) => {
      const { branchId, shares } = resolveShares(auth, body);
      if (body.idempotencyKey) {
        const prev = (await c.query("SELECT id FROM expenses WHERE idempotency_key = $1", [body.idempotencyKey])).rows[0];
        if (prev) return loadExpense(c, auth, prev.id, "read");
      }
      if (!body.asDraft) checkDateForConfirm(body.expenseDate, await localToday(c, auth));
      // Se inserta como borrador para guardar el reparto (solo cambia en borrador) y luego se confirma.
      const id = (await c.query<{ id: string }>(
        `INSERT INTO expenses (clinic_id, branch_id, category, description, amount_cents, expense_date, supplier, receipt_ref, notes, status, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'draft',$10,$11) RETURNING id`,
        [auth.clinicId, branchId, body.category, body.description, body.amountCents, body.expenseDate, body.supplier, body.receiptRef, body.notes,
          body.idempotencyKey ?? null, auth.userId])).rows[0]!.id;
      await saveShares(c, auth.clinicId!, id, body.amountCents, shares);
      if (!body.asDraft) await c.query("UPDATE expenses SET status = 'confirmed', confirmed_by = $2, confirmed_at = now() WHERE id = $1", [id, auth.userId]);
      await audit(c, auth, body.asDraft ? "expense.drafted" : "expense.created", "expense", id,
        { category: body.category, amountCents: body.amountCents, expenseDate: body.expenseDate, shares: shares?.map((s) => ({ branchId: s.branchId, percentBp: s.bp })) ?? null }, branchId);
      return loadExpense(c, auth, id);
    },
  });

  route({
    method: "PUT", url: "/api/expenses/:id", summary: "Editar un borrador de gasto (los confirmados no se editan: se anulan)", tags: ["gestión"],
    perm: "reports.financial", params: zIdParams, body: zExpense.omit({ asDraft: true, idempotencyKey: true }),
    handler: async ({ c, auth, params, body }) => {
      const e = await loadExpense(c, auth, params.id);
      const { branchId, shares } = resolveShares(auth, body);
      if (e.state !== "draft") throw conflict("Solo se editan los borradores. Un gasto confirmado se anula y se registra de nuevo.", "not_draft");
      await c.query(
        `UPDATE expenses SET branch_id = $2, category = $3, description = $4, amount_cents = $5, expense_date = $6, supplier = $7, receipt_ref = $8, notes = $9 WHERE id = $1`,
        [params.id, branchId, body.category, body.description, body.amountCents, body.expenseDate, body.supplier, body.receiptRef, body.notes]);
      await saveShares(c, auth.clinicId!, params.id, body.amountCents, shares);
      await audit(c, auth, "expense.draft_updated", "expense", params.id,
        { before: { amountCents: e.amountCents, expenseDate: e.expenseDate, category: e.category, shares: e.shares.map((s) => ({ branchId: s.branchId, percentBp: s.percentBp })) },
          after: { amountCents: body.amountCents, expenseDate: body.expenseDate, category: body.category, shares: shares?.map((s) => ({ branchId: s.branchId, percentBp: s.bp })) ?? null } }, branchId);
      return loadExpense(c, auth, params.id);
    },
  });

  route({
    method: "POST", url: "/api/expenses/:id/confirm", summary: "Confirmar un borrador (por ejemplo, un recurrente generado). Desde ese momento cuenta en la rentabilidad y no se edita", tags: ["gestión"],
    perm: "reports.financial", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      await c.query("SELECT id FROM expenses WHERE id = $1 FOR UPDATE", [params.id]);
      const e = await loadExpense(c, auth, params.id);
      if (e.state !== "draft") throw conflict(e.state === "voided" ? "El gasto está anulado" : "El gasto ya estaba confirmado", "not_draft");
      checkDateForConfirm(e.expenseDate, await localToday(c, auth));
      await c.query("UPDATE expenses SET status = 'confirmed', confirmed_by = $2, confirmed_at = now() WHERE id = $1", [params.id, auth.userId]);
      await audit(c, auth, "expense.confirmed", "expense", params.id, { amountCents: e.amountCents }, e.branchId);
      return loadExpense(c, auth, params.id);
    },
  });

  route({
    method: "POST", url: "/api/expenses/:id/void", summary: "Anular un gasto (confirmado o borrador) con motivo. Queda en el historial; no se borra", tags: ["gestión"],
    perm: "reports.financial", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(5, "Escribe el motivo (mínimo 5 caracteres)").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      await c.query("SELECT id FROM expenses WHERE id = $1 FOR UPDATE", [params.id]);
      const e = await loadExpense(c, auth, params.id);
      if (e.state === "voided") throw conflict("El gasto ya estaba anulado", "already_voided");
      await c.query("INSERT INTO expense_voids (clinic_id, expense_id, reason, voided_by) VALUES ($1,$2,$3,$4)", [auth.clinicId, params.id, body.reason, auth.userId]);
      await audit(c, auth, "expense.voided", "expense", params.id, { reason: body.reason, amountCents: e.amountCents, wasStatus: e.status }, e.branchId);
      return loadExpense(c, auth, params.id);
    },
  });

  // ---------------- Recurrentes ----------------
  const zRecurring = z.object({
    branchId: zId, category: zCategory, description: zDescription, amountCents: zAmount, supplier: zOptText(120),
    dayOfMonth: z.number().int().min(1, "Día entre 1 y 28").max(28, "Día entre 1 y 28 (así existe en todos los meses)").default(1),
    startsMonth: zMonth,
  });
  const RECURRING_COLS = `r.id, r.branch_id AS "branchId", b.name AS "branchName", r.category, r.description, r.amount_cents AS "amountCents", r.supplier,
    r.day_of_month AS "dayOfMonth", to_char(r.starts_month, 'YYYY-MM') AS "startsMonth", to_char(r.ends_month, 'YYYY-MM') AS "endsMonth", r.active,
    (SELECT to_char(max(e.period_month), 'YYYY-MM') FROM expenses e WHERE e.recurring_id = r.id) AS "lastGenerated"`;

  route({
    method: "GET", url: "/api/expenses/recurring", summary: "Gastos fijos mensuales (plantillas que generan un borrador cada mes)", tags: ["gestión"],
    perm: "reports.financial", query: z.object({ branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const rows = (await c.query(
        `SELECT ${RECURRING_COLS} FROM expense_recurring r JOIN branches b ON b.id = r.branch_id
          WHERE ($1::uuid IS NULL OR r.branch_id = $1) AND ($2::uuid[] IS NULL OR r.branch_id = ANY($2))
          ORDER BY r.active DESC, b.name, r.category, r.description`, [query.branchId ?? null, allowedBranches(auth)])).rows;
      return rows.map((x) => ({ ...x, amountCents: Number(x.amountCents), categoryLabel: CATEGORY_LABELS[x.category] }));
    },
  });

  route({
    method: "POST", url: "/api/expenses/recurring", summary: "Crear un gasto fijo mensual", tags: ["gestión"],
    perm: "reports.financial", body: zRecurring,
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      const id = (await c.query<{ id: string }>(
        `INSERT INTO expense_recurring (clinic_id, branch_id, category, description, amount_cents, supplier, day_of_month, starts_month, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.clinicId, body.branchId, body.category, body.description, body.amountCents, body.supplier, body.dayOfMonth, `${body.startsMonth}-01`, auth.userId])).rows[0]!.id;
      await audit(c, auth, "expense_recurring.created", "expense_recurring", id, { category: body.category, amountCents: body.amountCents }, body.branchId);
      return { id };
    },
  });

  route({
    method: "PUT", url: "/api/expenses/recurring/:id", summary: "Editar o desactivar un gasto fijo (no cambia los borradores ya generados)", tags: ["gestión"],
    perm: "reports.financial", params: zIdParams,
    body: z.object({
      category: zCategory, description: zDescription, amountCents: zAmount, supplier: zOptText(120),
      dayOfMonth: z.number().int().min(1, "Día entre 1 y 28").max(28, "Día entre 1 y 28"), active: z.boolean(), endsMonth: zMonth.nullish(),
    }),
    handler: async ({ c, auth, params, body }) => {
      const r = (await c.query<{ branch_id: string; starts: string }>("SELECT branch_id, to_char(starts_month, 'YYYY-MM') AS starts FROM expense_recurring WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!r) throw notFound("Gasto fijo");
      requireBranch(auth, r.branch_id);
      if (body.endsMonth && body.endsMonth < r.starts) throw new AppError(400, "validation", "El último mes no puede ser anterior al primero", [{ path: "endsMonth", message: "Anterior al primer mes" }]);
      await c.query(
        `UPDATE expense_recurring SET category = $2, description = $3, amount_cents = $4, supplier = $5, day_of_month = $6, active = $7, ends_month = $8, updated_at = now() WHERE id = $1`,
        [params.id, body.category, body.description, body.amountCents, body.supplier, body.dayOfMonth, body.active, body.endsMonth ? `${body.endsMonth}-01` : null]);
      await audit(c, auth, "expense_recurring.updated", "expense_recurring", params.id, body, r.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/expenses/recurring/generate", summary: "Generar los borradores de los gastos fijos de un mes (no duplica los ya generados)", tags: ["gestión"],
    perm: "reports.financial", body: z.object({ month: zMonth, branchId: zId.nullish() }),
    handler: async ({ c, auth, body }) => {
      if (body.branchId) requireBranch(auth, body.branchId);
      const range = await monthRange(c, auth);
      const limit = DateTime.fromISO(`${range.month}-01`).plus({ months: 1 }).toFormat("yyyy-MM");
      if (body.month > limit) throw badRequest("Solo se generan los gastos fijos hasta el mes siguiente");
      return { created: await generateRecurring(c, auth, body.month, body.branchId ?? null) };
    },
  });
}
