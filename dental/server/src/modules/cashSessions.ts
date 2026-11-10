// Caja por sucursal y cajero (B-043, FI-01): apertura con fondo, cobros en efectivo dentro
// de la sesión, movimientos manuales de solo inserción, cierre con arqueo por billetes y
// monedas en Bs y revisión por gerencia. Una caja cerrada es inmutable (trigger en la base).
import { z } from "zod";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zMoney, zOptText } from "../lib/http.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { nextCounter, type Client } from "../lib/db.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../lib/rbac.js";
import { dayBounds } from "../lib/slots.js";
import { clinicZone } from "./agenda.js";

/** Billetes y monedas de Bolivia, en centavos. */
export const DENOMINATIONS: { cents: number; label: string; kind: "bill" | "coin" }[] = [
  { cents: 20000, label: "Bs 200", kind: "bill" },
  { cents: 10000, label: "Bs 100", kind: "bill" },
  { cents: 5000, label: "Bs 50", kind: "bill" },
  { cents: 2000, label: "Bs 20", kind: "bill" },
  { cents: 1000, label: "Bs 10", kind: "bill" },
  { cents: 500, label: "Bs 5", kind: "coin" },
  { cents: 200, label: "Bs 2", kind: "coin" },
  { cents: 100, label: "Bs 1", kind: "coin" },
  { cents: 50, label: "50 ctvs", kind: "coin" },
  { cents: 20, label: "20 ctvs", kind: "coin" },
  { cents: 10, label: "10 ctvs", kind: "coin" },
];
// Copia local (evita la importación circular con billing.ts).
const METHOD_LABELS: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", qr: "QR", card: "Tarjeta" };
const DENOM_SET = new Set(DENOMINATIONS.map((d) => String(d.cents)));

export const MOVEMENT_CATEGORIES: Record<string, string> = {
  change: "Cambio / sencillo",
  petty_expense: "Gasto menor",
  deposit: "Depósito o entrega a gerencia",
  refund: "Devolución a paciente",
  other: "Otro",
};

/** Gerencia y contabilidad ven todas las cajas y revisan cierres. */
export const isCashManager = (a: AuthCtx) => a.permissions.has("payments.verify") || a.permissions.has("clinic.manage");

export async function requireCashSessionSetting(c: Client, clinicId: string): Promise<boolean> {
  const r = await c.query<{ v: boolean }>("SELECT COALESCE((settings->>'requireCashSession')::boolean, false) AS v FROM clinics WHERE id = $1", [clinicId]);
  return !!r.rows[0]?.v;
}

/**
 * Antes de registrar un cobro en efectivo: si la clínica exige caja y quien cobra no tiene una
 * abierta en esa sucursal, responde 409. Bloquea la sesión (FOR SHARE) para que no se cierre
 * mientras se registra el cobro; el trigger de la base vincula el pago a esa sesión.
 */
export async function assertCashSessionForPayment(c: Client, auth: AuthCtx, branchId: string, method: string): Promise<void> {
  if (method !== "cash") return;
  const open = await c.query("SELECT id FROM cash_sessions WHERE branch_id = $1 AND cashier_id = $2 AND status = 'open' FOR SHARE", [branchId, auth.userId]);
  if (open.rowCount) return;
  if (await requireCashSessionSetting(c, auth.clinicId!)) {
    throw conflict("Abre tu caja en esta sucursal antes de registrar cobros en efectivo (Caja → Mi caja).", "cash_session_required");
  }
}

/** Valida el arqueo y devuelve el total contado en centavos. */
export function countTotal(counts: Record<string, number>): number {
  let total = 0;
  for (const [k, n] of Object.entries(counts)) {
    if (!DENOM_SET.has(k)) throw badRequest(`Denominación inválida: ${k}`);
    if (!Number.isInteger(n) || n < 0 || n > 100000) throw badRequest("Las cantidades del arqueo deben ser números enteros entre 0 y 100 000");
    total += Number(k) * n;
  }
  return total;
}

interface Totals { floatCents: number; cashInCents: number; voidedCents: number; movementsInCents: number; movementsOutCents: number; expectedCents: number }

/** Esperado = fondo + cobros en efectivo recibidos − anulados + ingresos − egresos (todo en centavos). */
export async function liveTotals(c: Client, sessionId: string): Promise<Totals> {
  const r = (await c.query<{ f: number; cin: number; vo: number; mi: number; mo: number }>(
    `SELECT s.opening_float_cents AS f,
            COALESCE((SELECT sum(amount_cents) FROM payments WHERE cash_session_id = s.id AND status IN ('confirmed','voided')),0) AS cin,
            COALESCE((SELECT sum(amount_cents) FROM payments WHERE cash_session_id = s.id AND status = 'voided'),0) AS vo,
            COALESCE((SELECT sum(amount_cents) FROM cash_movements WHERE session_id = s.id AND kind = 'in'),0) AS mi,
            COALESCE((SELECT sum(amount_cents) FROM cash_movements WHERE session_id = s.id AND kind = 'out'),0) AS mo
       FROM cash_sessions s WHERE s.id = $1`, [sessionId])).rows[0];
  if (!r) throw notFound("Caja");
  const t = { floatCents: Number(r.f), cashInCents: Number(r.cin), voidedCents: Number(r.vo), movementsInCents: Number(r.mi), movementsOutCents: Number(r.mo) };
  return { ...t, expectedCents: t.floatCents + t.cashInCents - t.voidedCents + t.movementsInCents - t.movementsOutCents };
}

const SESSION_COLS = `s.id, s.number, s.branch_id AS "branchId", b.name AS "branchName", s.cashier_id AS "cashierId", u.full_name AS "cashierName",
  s.status, s.opening_float_cents AS "openingFloatCents", s.opening_note AS "openingNote", s.opened_at AS "openedAt",
  s.closed_at AS "closedAt", cb.full_name AS "closedByName", s.count_detail AS "countDetail", s.cash_in_cents AS "cashInCents",
  s.voided_cents AS "voidedCents", s.movements_in_cents AS "movementsInCents", s.movements_out_cents AS "movementsOutCents",
  s.expected_cents AS "expectedCents", s.counted_cents AS "countedCents", s.difference_cents AS "differenceCents", s.close_note AS "closeNote",
  r.note AS "reviewNote", r.reviewed_at AS "reviewedAt", ru.full_name AS "reviewedByName"`;
const SESSION_FROM = `cash_sessions s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.cashier_id
  LEFT JOIN users cb ON cb.id = s.closed_by LEFT JOIN cash_session_reviews r ON r.session_id = s.id LEFT JOIN users ru ON ru.id = r.reviewed_by`;

/** Reporte completo de una caja: resumen, arqueo, cobros, otros medios (referencia) y movimientos. */
export async function sessionReport(c: Client, id: string) {
  const s = (await c.query(`SELECT ${SESSION_COLS} FROM ${SESSION_FROM} WHERE s.id = $1`, [id])).rows[0];
  if (!s) throw notFound("Caja");
  const totals = s.status === "open"
    ? await liveTotals(c, id)
    : { floatCents: s.openingFloatCents, cashInCents: s.cashInCents, voidedCents: s.voidedCents, movementsInCents: s.movementsInCents, movementsOutCents: s.movementsOutCents, expectedCents: s.expectedCents };
  const payments = (await c.query(
    `SELECT p.id, p.receipt_number AS "receiptNumber", p.amount_cents AS "amountCents", p.status, p.received_at AS "receivedAt",
            pt.first_name || ' ' || pt.last_name AS "patientName", p.patient_id AS "patientId", p.status_reason AS "statusReason"
       FROM payments p JOIN patients pt ON pt.id = p.patient_id WHERE p.cash_session_id = $1 ORDER BY p.received_at`, [id])).rows;
  // Otros medios recibidos por el mismo cajero en la sucursal durante la sesión: solo referencia, no cuentan en el arqueo.
  const others = (await c.query(
    `SELECT p.id, p.receipt_number AS "receiptNumber", p.amount_cents AS "amountCents", p.method, p.status, p.bank_reference AS "bankReference",
            p.received_at AS "receivedAt", pt.first_name || ' ' || pt.last_name AS "patientName"
       FROM payments p JOIN patients pt ON pt.id = p.patient_id
      WHERE p.method <> 'cash' AND p.branch_id = $1 AND p.received_by = $2 AND p.received_at >= $3 AND p.received_at < COALESCE($4::timestamptz, now() + interval '1 minute')
      ORDER BY p.received_at`, [s.branchId, s.cashierId, s.openedAt, s.closedAt])).rows.map((p) => ({ ...p, methodLabel: METHOD_LABELS[p.method] }));
  const movements = (await c.query(
    `SELECT m.id, m.kind, m.category, m.amount_cents AS "amountCents", m.reason, m.created_at AS "createdAt", u.full_name AS "createdByName"
       FROM cash_movements m JOIN users u ON u.id = m.created_by WHERE m.session_id = $1 ORDER BY m.created_at`, [id])).rows
    .map((m) => ({ ...m, categoryLabel: MOVEMENT_CATEGORIES[m.category] }));
  const count = s.countDetail
    ? DENOMINATIONS.map((d) => ({ ...d, quantity: Number(s.countDetail[String(d.cents)] ?? 0), subtotalCents: d.cents * Number(s.countDetail[String(d.cents)] ?? 0) }))
    : null;
  return { ...s, totals, payments, others, movements, count };
}

function canSee(auth: AuthCtx, s: { cashierId: string; branchId: string }) {
  requireBranch(auth, s.branchId);
  if (s.cashierId !== auth.userId && !isCashManager(auth)) throw notFound("Caja");
}

/** Cierre de la caja (también lo usa la semilla demo). Calcula esperado y diferencia en el servidor. */
export async function closeSession(
  c: Client, auth: Pick<AuthCtx, "userId" | "clinicId" | "ip">, id: string, counts: Record<string, number>, note: string | null, closedAt?: Date,
) {
  const s = (await c.query<{ status: string; branch_id: string }>("SELECT status, branch_id FROM cash_sessions WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!s) throw notFound("Caja");
  if (s.status !== "open") throw conflict("Esta caja ya está cerrada", "cash_session_closed");
  const counted = countTotal(counts);
  const t = await liveTotals(c, id);
  const diff = counted - t.expectedCents;
  if (diff !== 0 && (!note || note.trim().length < 5)) {
    throw new AppError(400, "note_required",
      `Hay una diferencia de ${(diff / 100).toFixed(2)} Bs (${diff < 0 ? "faltante" : "sobrante"}). Explica el motivo para cerrar la caja.`,
      { expectedCents: t.expectedCents, countedCents: counted, differenceCents: diff });
  }
  const detail = Object.fromEntries(DENOMINATIONS.map((d) => [String(d.cents), counts[String(d.cents)] ?? 0]));
  await c.query(
    `UPDATE cash_sessions SET status = 'closed', closed_at = COALESCE($2, now()), closed_by = $3, count_detail = $4, cash_in_cents = $5, voided_cents = $6,
            movements_in_cents = $7, movements_out_cents = $8, expected_cents = $9, counted_cents = $10, difference_cents = $11, close_note = $12
      WHERE id = $1`,
    [id, closedAt ?? null, auth.userId, JSON.stringify(detail), t.cashInCents, t.voidedCents, t.movementsInCents, t.movementsOutCents, t.expectedCents, counted, diff, note],
  );
  await audit(c, auth, "cash_session.closed", "cash_session", id, { expectedCents: t.expectedCents, countedCents: counted, differenceCents: diff, note }, s.branch_id);
  return { expectedCents: t.expectedCents, countedCents: counted, differenceCents: diff };
}

export async function openSession(
  c: Client, auth: Pick<AuthCtx, "userId" | "clinicId" | "ip">, branchId: string, floatCents: number, note: string | null, openedAt?: Date,
) {
  const ex = (await c.query<{ number: number; opened_at: Date }>(
    "SELECT number, opened_at FROM cash_sessions WHERE branch_id = $1 AND cashier_id = $2 AND status = 'open'", [branchId, auth.userId])).rows[0];
  if (ex) throw conflict(`Ya tienes una caja abierta en esta sucursal (N° ${ex.number}). Ciérrala antes de abrir otra.`, "cash_session_open");
  const number = await nextCounter(c, auth.clinicId!, "cash_session");
  try {
    const r = await c.query<{ id: string }>(
      `INSERT INTO cash_sessions (clinic_id, number, branch_id, cashier_id, opening_float_cents, opening_note, opened_at)
       VALUES ($1,$2,$3,$4,$5,$6, COALESCE($7, now())) RETURNING id`,
      [auth.clinicId, number, branchId, auth.userId, floatCents, note, openedAt ?? null]);
    await audit(c, auth, "cash_session.opened", "cash_session", r.rows[0]!.id, { number, openingFloatCents: floatCents }, branchId);
    return { id: r.rows[0]!.id, number };
  } catch (e) {
    if ((e as { constraint?: string }).constraint === "cash_sessions_one_open") throw conflict("Ya tienes una caja abierta en esta sucursal. Ciérrala antes de abrir otra.", "cash_session_open");
    throw e;
  }
}

export async function addMovement(
  c: Client, auth: Pick<AuthCtx, "userId" | "clinicId" | "ip">, sessionId: string,
  m: { kind: "in" | "out"; category: string; amountCents: number; reason: string }, createdAt?: Date,
) {
  const s = (await c.query<{ status: string; branch_id: string }>("SELECT status, branch_id FROM cash_sessions WHERE id = $1 FOR SHARE", [sessionId])).rows[0];
  if (!s) throw notFound("Caja");
  if (s.status !== "open") throw conflict("La caja está cerrada: no admite movimientos", "cash_session_closed");
  if (m.kind === "out") {
    const t = await liveTotals(c, sessionId);
    if (m.amountCents > t.expectedCents) throw conflict(`No hay suficiente efectivo en caja para ese egreso (en caja: ${(t.expectedCents / 100).toFixed(2)} Bs)`, "insufficient_cash");
  }
  const r = await c.query<{ id: string }>(
    `INSERT INTO cash_movements (clinic_id, session_id, kind, category, amount_cents, reason, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7, COALESCE($8, now())) RETURNING id`,
    [auth.clinicId, sessionId, m.kind, m.category, m.amountCents, m.reason, auth.userId, createdAt ?? null]);
  await audit(c, auth, "cash_movement.created", "cash_session", sessionId, { movementId: r.rows[0]!.id, ...m }, s.branch_id);
  return { id: r.rows[0]!.id };
}

const zCounts = z.record(z.string(), z.number().int().min(0).max(100000));

export function cashSessionRoutes(route: Route) {
  route({
    method: "GET", url: "/api/cash-sessions/denominations", summary: "Billetes y monedas de Bolivia para el arqueo, y conceptos de movimientos", tags: ["caja"], perm: "payments.read",
    handler: async () => ({ denominations: DENOMINATIONS, movementCategories: MOVEMENT_CATEGORIES }),
  });

  route({
    method: "GET", url: "/api/cash-sessions/settings", summary: "Configuración de caja de la clínica (exigir caja abierta para cobrar en efectivo)", tags: ["caja"], perm: "payments.read",
    handler: async ({ c, auth }) => ({ requireCashSession: await requireCashSessionSetting(c, auth.clinicId!) }),
  });

  route({
    method: "PUT", url: "/api/cash-sessions/settings", summary: "Exigir (o no) una caja abierta para registrar cobros en efectivo", tags: ["caja"], perm: "clinic.manage",
    body: z.object({ requireCashSession: z.boolean() }),
    handler: async ({ c, auth, body }) => {
      await c.query("UPDATE clinics SET settings = jsonb_set(settings, '{requireCashSession}', to_jsonb($2::boolean)) WHERE id = $1", [auth.clinicId, body.requireCashSession]);
      await audit(c, auth, "clinic.cash_settings", "clinic", auth.clinicId, body);
      return { requireCashSession: body.requireCashSession };
    },
  });

  route({
    method: "GET", url: "/api/cash-sessions/current", summary: "Mi caja abierta en la sucursal (o null), con el esperado al momento", tags: ["caja"], perm: "payments.create",
    query: z.object({ branchId: zId }),
    handler: async ({ c, auth, query }) => {
      requireBranch(auth, query.branchId);
      const s = (await c.query<{ id: string }>("SELECT id FROM cash_sessions WHERE branch_id = $1 AND cashier_id = $2 AND status = 'open'", [query.branchId, auth.userId])).rows[0];
      return { requireCashSession: await requireCashSessionSetting(c, auth.clinicId!), session: s ? await sessionReport(c, s.id) : null };
    },
  });

  route({
    method: "POST", url: "/api/cash-sessions", summary: "Abrir mi caja en una sucursal con un fondo inicial (cambio)", tags: ["caja"], perm: "payments.create",
    body: z.object({ branchId: zId, openingFloatCents: zMoney, note: zOptText(300) }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      const r = await openSession(c, auth, body.branchId, body.openingFloatCents, body.note);
      return sessionReport(c, r.id);
    },
  });

  route({
    method: "POST", url: "/api/cash-sessions/:id/movements", summary: "Registrar un ingreso o egreso manual de efectivo con motivo (no se edita ni se borra)", tags: ["caja"], perm: "payments.create", params: zIdParams,
    body: z.object({
      kind: z.enum(["in", "out"]),
      category: z.enum(["change", "petty_expense", "deposit", "refund", "other"]),
      amountCents: zMoney.refine((v) => v > 0, "El monto debe ser mayor a cero"),
      reason: z.string().trim().min(3, "Escribe el motivo (al menos 3 letras)").max(300),
    }),
    handler: async ({ c, auth, params, body }) => {
      const s = (await c.query<{ cashier_id: string; branch_id: string }>("SELECT cashier_id, branch_id FROM cash_sessions WHERE id = $1", [params.id])).rows[0];
      if (!s) throw notFound("Caja");
      requireBranch(auth, s.branch_id);
      if (s.cashier_id !== auth.userId) throw forbidden("Solo quien abrió la caja registra sus movimientos");
      await addMovement(c, auth, params.id, body);
      return sessionReport(c, params.id);
    },
  });

  route({
    method: "POST", url: "/api/cash-sessions/:id/close", summary: "Cerrar caja con arqueo por billetes y monedas. El servidor calcula esperado y diferencia; si no es cero exige un motivo.", tags: ["caja"], perm: "payments.create", params: zIdParams,
    body: z.object({ counts: zCounts, note: zOptText(1000) }),
    handler: async ({ c, auth, params, body }) => {
      const s = (await c.query<{ cashier_id: string; branch_id: string }>("SELECT cashier_id, branch_id FROM cash_sessions WHERE id = $1", [params.id])).rows[0];
      if (!s) throw notFound("Caja");
      requireBranch(auth, s.branch_id);
      if (s.cashier_id !== auth.userId && !isCashManager(auth)) throw forbidden("Solo quien abrió la caja (o gerencia) puede cerrarla");
      await closeSession(c, auth, params.id, body.counts, body.note);
      return sessionReport(c, params.id);
    },
  });

  route({
    method: "GET", url: "/api/cash-sessions", summary: "Historial de cajas (cada cajero ve las suyas; gerencia y contabilidad, todas)", tags: ["caja"], perm: "payments.read",
    query: z.object({ branchId: zId.optional(), status: z.enum(["open", "closed"]).optional(), from: zDate.optional(), to: zDate.optional(), cashierId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const from = query.from ? dayBounds(query.from, zone)[0] : null;
      const to = query.to ? dayBounds(query.to, zone)[1] : null;
      const cashier = isCashManager(auth) ? query.cashierId ?? null : auth.userId;
      const r = await c.query(
        `SELECT ${SESSION_COLS},
                CASE WHEN s.status = 'open' THEN s.opening_float_cents
                  + COALESCE((SELECT sum(amount_cents) FROM payments WHERE cash_session_id = s.id AND status = 'confirmed'),0)
                  + COALESCE((SELECT sum(CASE WHEN kind = 'in' THEN amount_cents ELSE -amount_cents END) FROM cash_movements WHERE session_id = s.id),0)
                END AS "liveExpectedCents"
           FROM ${SESSION_FROM}
          WHERE ($1::uuid IS NULL OR s.branch_id = $1) AND ($2::text IS NULL OR s.status = $2) AND ($3::timestamptz IS NULL OR s.opened_at >= $3)
            AND ($4::timestamptz IS NULL OR s.opened_at < $4) AND ($5::uuid IS NULL OR s.cashier_id = $5) AND ($6::uuid[] IS NULL OR s.branch_id = ANY($6))
          ORDER BY s.opened_at DESC LIMIT 200`,
        [query.branchId ?? null, query.status ?? null, from, to, cashier, allowedBranches(auth)],
      );
      return r.rows.map(({ countDetail: _cd, ...x }) => x);
    },
  });

  route({
    method: "GET", url: "/api/cash-sessions/:id", summary: "Reporte de una caja (resumen, arqueo, cobros, otros medios y movimientos)", tags: ["caja"], perm: "payments.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const rep = await sessionReport(c, params.id);
      canSee(auth, rep);
      return rep;
    },
  });

  route({
    method: "POST", url: "/api/cash-sessions/:id/review", summary: "Marcar el cierre como revisado por gerencia o contabilidad (con nota)", tags: ["caja"], perm: "payments.verify", params: zIdParams,
    body: z.object({ note: zOptText(1000) }),
    handler: async ({ c, auth, params, body }) => {
      const s = (await c.query<{ status: string; cashier_id: string; branch_id: string; difference_cents: number | null }>(
        "SELECT status, cashier_id, branch_id, difference_cents FROM cash_sessions WHERE id = $1", [params.id])).rows[0];
      if (!s) throw notFound("Caja");
      requireBranch(auth, s.branch_id);
      if (s.status !== "closed") throw conflict("Solo se revisan cajas cerradas", "cash_session_open");
      if (s.cashier_id === auth.userId && auth.membership!.role !== "owner") throw forbidden("Otra persona debe revisar tu propio cierre");
      if (s.difference_cents && !body.note) throw badRequest("El cierre tiene diferencia: anota qué se verificó");
      if ((await c.query("SELECT 1 FROM cash_session_reviews WHERE session_id = $1", [params.id])).rowCount) throw conflict("Esta caja ya fue revisada", "already_reviewed");
      await c.query("INSERT INTO cash_session_reviews (clinic_id, session_id, note, reviewed_by) VALUES ($1,$2,$3,$4)", [auth.clinicId, params.id, body.note, auth.userId]);
      await audit(c, auth, "cash_session.reviewed", "cash_session", params.id, { note: body.note }, s.branch_id);
      return sessionReport(c, params.id);
    },
  });
}
