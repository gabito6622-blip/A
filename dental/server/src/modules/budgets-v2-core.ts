// Presupuestos v2 (B-045): cálculo de descuentos, sesiones, saldo único y ayudas que
// usa billing.ts. Todo en centavos enteros; nada de decimales flotantes en los montos.
import { z } from "zod";
import { AppError, badRequest, conflict } from "../lib/errors.js";
import type { Client } from "../lib/db.js";
import type { AuthCtx } from "../lib/rbac.js";
import { CONDITIONS } from "./clinical.js";

// ---------------------------------------------------------------------------
// Aritmética de descuentos
// ---------------------------------------------------------------------------

/** Porcentaje con hasta 2 decimales (p. ej. 12.5) → centésimas de punto (1250), sin errores de coma flotante. */
export function percentToBp(pct: number): number {
  return Math.round(pct * 100);
}

/** Aplica un porcentaje a un monto en centavos, redondeando al centavo (mitad hacia arriba). */
export function percentOf(cents: number, pct: number): number {
  const bp = BigInt(percentToBp(pct));
  return Number((BigInt(cents) * bp + 5000n) / 10000n);
}

/**
 * Reparte `total` en proporción a `weights`, redondeando cada parte al centavo; el residuo
 * del redondeo va a la última línea con peso. Si `cap` es verdadero, ninguna parte supera su
 * peso ni es negativa (descuento global: nunca más que el neto de la línea).
 * Invariante: la suma de las partes es exactamente `total`.
 */
export function prorate(total: number, weights: number[], cap = false): number[] {
  const n = weights.length;
  const shares = new Array<number>(n).fill(0);
  if (!n || total === 0) return shares;
  const W = weights.reduce((s, w) => s + w, 0);
  if (cap && total > W) throw new Error("prorate: el total supera la suma de los pesos");
  let last = -1;
  for (let i = n - 1; i >= 0; i--) if (weights[i]! > 0) { last = i; break; }
  if (last === -1) { shares[n - 1] = total; return shares; }
  let acc = 0;
  for (let i = 0; i < n; i++) {
    if (i === last) continue;
    // round(total * w / W) en enteros: floor((2·total·w + W) / (2·W))
    shares[i] = Number((2n * BigInt(total) * BigInt(weights[i]!) + BigInt(W)) / (2n * BigInt(W)));
    acc += shares[i]!;
  }
  shares[last] = total - acc;
  if (cap) {
    // Corrige casos extremos de redondeo para respetar 0 ≤ parte ≤ peso, moviendo centavos
    // desde/hacia las líneas anteriores (siempre es posible porque total ≤ W).
    let excess = shares[last]! - Math.min(Math.max(shares[last]!, 0), weights[last]!);
    shares[last] = shares[last]! - excess;
    for (let i = n - 1; i >= 0 && excess !== 0; i--) {
      if (i === last) continue;
      if (excess > 0) { const room = weights[i]! - shares[i]!; const d = Math.min(room, excess); shares[i] = shares[i]! + d; excess -= d; }
      else { const d = Math.min(shares[i]!, -excess); shares[i] = shares[i]! - d; excess += d; }
    }
  }
  return shares;
}

// ---------------------------------------------------------------------------
// Validación de descuentos (zod) y descuento por línea
// ---------------------------------------------------------------------------
const twoDecimals = (v: number) => Math.abs(v * 100 - Math.round(v * 100)) < 1e-6;
export const zPercent = z.number({ message: "Porcentaje inválido" })
  .min(0, "El descuento no puede ser negativo")
  .max(100, "El descuento no puede superar el 100 %")
  .refine(twoDecimals, "El porcentaje admite hasta 2 decimales");

export const zGlobalDiscount = z.object({
  kind: z.enum(["none", "percent", "amount"]),
  value: z.number().min(0, "El descuento no puede ser negativo").default(0),
}).superRefine((d, ctx) => {
  if (d.kind === "percent" && (d.value > 100 || !twoDecimals(d.value))) ctx.addIssue({ code: "custom", path: ["value"], message: "El descuento global va de 0 a 100 % (hasta 2 decimales)" });
  if (d.kind === "amount" && !Number.isInteger(d.value)) ctx.addIssue({ code: "custom", path: ["value"], message: "Monto en centavos (entero)" });
});
export type GlobalDiscount = z.infer<typeof zGlobalDiscount>;

/** Calcula el descuento de una línea a partir de un monto o de un porcentaje (uno solo). */
export function lineDiscount(grossCents: number, it: { discountCents?: number; discountPercent?: number | null }): { discountCents: number; discountPercent: number | null } {
  const pct = it.discountPercent ?? null;
  if (pct !== null && it.discountCents) throw badRequest("Indica el descuento de la línea en % o en Bs, no ambos");
  const cents = pct !== null ? percentOf(grossCents, pct) : it.discountCents ?? 0;
  if (cents > grossCents) throw badRequest("El descuento de una línea no puede superar su importe");
  return { discountCents: cents, discountPercent: pct };
}

// ---------------------------------------------------------------------------
// Recalcular presupuesto (borrador): descuento global prorrateado y sesiones
// ---------------------------------------------------------------------------
interface TemplateSession { name: string; amountCents: number }

/**
 * Recalcula el reparto del descuento global y el importe de las sesiones. Solo en borrador.
 * Si `gd` viene, primero cambia la configuración del descuento global.
 */
export async function recalcBudget(c: Client, budgetId: string, gd?: GlobalDiscount | null): Promise<void> {
  const b = (await c.query<{ status: string; discount_cents: number; global_discount_percent: number | null }>(
    "SELECT status, discount_cents, global_discount_percent FROM budgets WHERE id = $1 FOR UPDATE", [budgetId])).rows[0];
  if (!b) throw new AppError(404, "not_found", "Presupuesto no encontrado");
  if (b.status !== "draft") throw conflict("Solo se cambian importes en borrador; crea una nueva versión", "invalid_status");
  let pct = b.global_discount_percent;
  let amount = b.discount_cents;
  if (gd) {
    pct = gd.kind === "percent" ? gd.value : null;
    amount = gd.kind === "amount" ? gd.value : 0;
  }
  const items = (await c.query<{ id: string; pre: number; status: string }>(
    `SELECT id, unit_price_cents * quantity - discount_cents AS pre, status FROM budget_items
      WHERE budget_id = $1 ORDER BY position, id`, [budgetId])).rows;
  const active = items.filter((i) => i.status !== "cancelled");
  const sumNet = active.reduce((s, i) => s + Number(i.pre), 0);
  const G = pct !== null ? percentOf(sumNet, pct) : amount;
  if (G > sumNet) {
    throw new AppError(400, "discount_exceeds_total", `El descuento global (${fmtBs(G)}) supera el total de las líneas (${fmtBs(sumNet)})`);
  }
  const shares = prorate(G, active.map((i) => Number(i.pre)), true);
  // Primero se ponen en cero (evita violar el neto ≥ 0 a mitad del cambio) y luego se asigna.
  await c.query("UPDATE budget_items SET global_discount_cents = 0 WHERE budget_id = $1 AND global_discount_cents <> 0", [budgetId]);
  for (let k = 0; k < active.length; k++) {
    if (shares[k]) await c.query("UPDATE budget_items SET global_discount_cents = $2 WHERE id = $1", [active[k]!.id, shares[k]]);
  }
  await c.query("UPDATE budgets SET discount_cents = $2, global_discount_percent = $3 WHERE id = $1", [budgetId, G, pct]);
  await syncSessions(c, budgetId);
}

/** Crea las sesiones de las líneas cuya prestación tiene plantilla y reparte el neto entre ellas. */
async function syncSessions(c: Client, budgetId: string) {
  const items = (await c.query<{ id: string; clinic_id: string; net: number; template: TemplateSession[] | null; n: number }>(
    `SELECT i.id, i.clinic_id, i.net_cents AS net, pr.session_template AS template,
            (SELECT count(*)::int FROM budget_item_sessions s WHERE s.budget_item_id = i.id) AS n
       FROM budget_items i JOIN procedures pr ON pr.id = i.procedure_id
      WHERE i.budget_id = $1 AND i.status = 'pending' ORDER BY i.position, i.id`, [budgetId])).rows;
  for (const it of items) {
    if (!it.n && it.template?.length) {
      let pos = 0;
      for (const s of it.template) {
        await c.query(
          "INSERT INTO budget_item_sessions (clinic_id, budget_item_id, position, name, weight_cents, amount_cents) VALUES ($1,$2,$3,$4,$5,0)",
          [it.clinic_id, it.id, ++pos, s.name, s.amountCents]);
      }
    }
    await rescaleSessions(c, it.id, Number(it.net));
  }
}

/** Reparte el neto de la línea entre sus sesiones según los pesos de la plantilla (residuo a la última). */
export async function rescaleSessions(c: Client, itemId: string, netCents: number) {
  const ss = (await c.query<{ id: string; weight_cents: number }>(
    "SELECT id, weight_cents FROM budget_item_sessions WHERE budget_item_id = $1 ORDER BY position", [itemId])).rows;
  if (!ss.length) return;
  const amounts = prorate(netCents, ss.map((s) => Number(s.weight_cents)));
  for (let k = 0; k < ss.length; k++) await c.query("UPDATE budget_item_sessions SET amount_cents = $2 WHERE id = $1", [ss[k]!.id, amounts[k]]);
}

const fmtBs = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} Bs`;

// ---------------------------------------------------------------------------
// Sesiones realizadas → cargos (R2-09, R2-10)
// ---------------------------------------------------------------------------

/** Marca en el odontograma el tratamiento completado (y anula su "planificado"). */
export async function markOdontogramCompleted(c: Client, auth: AuthCtx, itemId: string, appointmentId: string | null, note: string | null) {
  const it = (await c.query<{ tooth: number | null; surfaces: string[]; cond: string | null; patient_id: string }>(
    `SELECT i.tooth, i.surfaces, pr.odontogram_condition AS cond, b.patient_id
       FROM budget_items i JOIN procedures pr ON pr.id = i.procedure_id JOIN budgets b ON b.id = i.budget_id WHERE i.id = $1`, [itemId])).rows[0];
  if (!it || !it.tooth || !it.cond || !CONDITIONS[it.cond]) return;
  const surf = CONDITIONS[it.cond]!.surface ? it.surfaces : [];
  if (CONDITIONS[it.cond]!.surface && !surf.length) return;
  await c.query(
    `INSERT INTO odontogram_entries (clinic_id, patient_id, tooth, surfaces, condition, state, budget_item_id, appointment_id, notes, recorded_by)
     VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8,$9)`,
    [auth.clinicId, it.patient_id, it.tooth, surf, it.cond, itemId, appointmentId, note, auth.userId]);
  const planned = (await c.query<{ id: string }>(
    `SELECT e.id FROM odontogram_entries e WHERE e.budget_item_id = $1 AND e.state = 'planned'
       AND NOT EXISTS (SELECT 1 FROM odontogram_entries v WHERE v.voids_entry_id = e.id)`, [itemId])).rows;
  for (const p of planned) {
    await c.query(
      `INSERT INTO odontogram_entries (clinic_id, patient_id, tooth, condition, state, notes, voids_entry_id, recorded_by) VALUES ($1,$2,$3,'void','existing','Realizado',$4,$5)`,
      [auth.clinicId, it.patient_id, it.tooth, p.id, auth.userId]);
  }
}

interface LockedItem { id: string; budget_id: string; branch_id: string; patient_id: string; description: string; tooth: number | null }

/** Inserta el cargo de una sesión, atribuido al profesional que la realizó. */
async function chargeSession(c: Client, auth: AuthCtx, it: LockedItem, s: { id: string; name: string; amount_cents: number }, dentistId: string): Promise<string | null> {
  if (Number(s.amount_cents) <= 0) return null;
  return (await c.query<{ id: string }>(
    `INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, session_id, dentist_id, description, amount_cents, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
    [auth.clinicId, it.branch_id, it.patient_id, it.id, s.id, dentistId,
      `${it.description}${it.tooth ? ` (pieza ${it.tooth})` : ""} · sesión: ${s.name}`, s.amount_cents, auth.userId])).rows[0]!.id;
}

/**
 * Para billing.ts: si la línea tiene sesiones, al marcarla "realizada" entera se cobran solo
 * las sesiones pendientes (una fila de cargo por sesión): nunca se cobra dos veces.
 * Devuelve null si la línea no tiene sesiones.
 */
export async function performPendingSessions(c: Client, auth: AuthCtx, itemId: string): Promise<{ chargeIds: string[]; amountCents: number } | null> {
  const ss = (await c.query<{ id: string; name: string; amount_cents: number; status: string }>(
    "SELECT id, name, amount_cents, status FROM budget_item_sessions WHERE budget_item_id = $1 ORDER BY position FOR UPDATE", [itemId])).rows;
  if (!ss.length) return null;
  const it = await lockedItem(c, itemId);
  const chargeIds: string[] = [];
  let amount = 0;
  for (const s of ss.filter((x) => x.status === "pending")) {
    await c.query("UPDATE budget_item_sessions SET status = 'done', performed_by = $2, performed_at = now() WHERE id = $1", [s.id, auth.userId]);
    const ch = await chargeSession(c, auth, it, s, auth.userId);
    if (ch) chargeIds.push(ch);
    amount += Number(s.amount_cents);
  }
  return { chargeIds, amountCents: amount };
}

async function lockedItem(c: Client, itemId: string): Promise<LockedItem> {
  return (await c.query(
    `SELECT i.id, i.budget_id, b.branch_id, b.patient_id, i.description, i.tooth
       FROM budget_items i JOIN budgets b ON b.id = i.budget_id WHERE i.id = $1`, [itemId])).rows[0];
}

/** Realiza UNA sesión: cargo propio con el profesional que la hizo; la línea se cierra con la última. */
export async function performSession(c: Client, auth: AuthCtx, sessionId: string, opts: { dentistId: string; appointmentId: string | null; note: string | null }) {
  const s0 = (await c.query<{ budget_item_id: string }>("SELECT budget_item_id FROM budget_item_sessions WHERE id = $1", [sessionId])).rows[0];
  if (!s0) throw new AppError(404, "not_found", "Sesión no encontrada");
  // Bloqueo de la línea primero (mismo orden que billing.ts) para serializar con "realizado".
  const item = (await c.query<{ status: string; b_status: string; branch_id: string }>(
    `SELECT i.status, b.status AS b_status, b.branch_id FROM budget_items i JOIN budgets b ON b.id = i.budget_id WHERE i.id = $1 FOR UPDATE OF i`,
    [s0.budget_item_id])).rows[0]!;
  const s = (await c.query<{ id: string; name: string; amount_cents: number; status: string; position: number }>(
    "SELECT id, name, amount_cents, status, position FROM budget_item_sessions WHERE id = $1 FOR UPDATE", [sessionId])).rows[0]!;
  if (item.b_status === "superseded") throw conflict("Esta versión del presupuesto fue reemplazada; trabaja sobre la versión vigente", "budget_superseded");
  if (item.b_status !== "accepted") throw conflict("El presupuesto debe estar aceptado para realizar tratamientos", "budget_not_accepted");
  if (item.status !== "pending" || s.status !== "pending") throw conflict("Esa sesión ya fue realizada o anulada", "invalid_status");
  await c.query("UPDATE budget_item_sessions SET status = 'done', performed_by = $2, performed_at = now() WHERE id = $1", [sessionId, opts.dentistId]);
  const it = await lockedItem(c, s0.budget_item_id);
  const chargeId = await chargeSession(c, auth, it, s, opts.dentistId);
  const left = (await c.query("SELECT 1 FROM budget_item_sessions WHERE budget_item_id = $1 AND status = 'pending'", [s0.budget_item_id])).rowCount;
  let itemDone = false;
  if (!left) {
    await c.query("UPDATE budget_items SET status = 'done', performed_by = $2, performed_at = now() WHERE id = $1", [s0.budget_item_id, opts.dentistId]);
    await markOdontogramCompleted(c, auth, s0.budget_item_id, opts.appointmentId, opts.note);
    itemDone = true;
    const pending = await c.query("SELECT 1 FROM budget_items WHERE budget_id = $1 AND status = 'pending'", [it.budget_id]);
    if (!pending.rowCount) await c.query("UPDATE budgets SET status = 'completed' WHERE id = $1", [it.budget_id]);
  }
  return { chargeId, itemDone, budgetId: it.budget_id, branchId: item.branch_id, itemId: s0.budget_item_id, amountCents: Number(s.amount_cents) };
}

/** Para billing.ts: al anular el cargo de una sesión, la sesión vuelve a quedar pendiente. */
export async function onChargeVoided(c: Client, chargeId: string) {
  await c.query(
    `UPDATE budget_item_sessions s SET status = 'pending', performed_by = NULL, performed_at = NULL
       FROM charges ch WHERE ch.id = $1 AND ch.session_id = s.id`, [chargeId]);
}

// ---------------------------------------------------------------------------
// Versiones: mensajes claros cuando la versión fue reemplazada
// ---------------------------------------------------------------------------
export async function supersededError(c: Client, budgetId: string): Promise<AppError> {
  const r = (await c.query<{ version: number }>(
    `SELECT n.version FROM budgets o JOIN budgets n ON n.number = o.number AND n.status <> 'superseded' WHERE o.id = $1`, [budgetId])).rows[0];
  return new AppError(409, "budget_superseded",
    `Esta versión fue reemplazada${r ? ` por la v${r.version}` : ""}: ya no se puede aceptar ni cobrar. Usa la versión vigente.`);
}

// ---------------------------------------------------------------------------
// Dinero: una sola fuente para el paciente (R2-11) y para el presupuesto
// ---------------------------------------------------------------------------
export interface PatientMoney {
  budgetedCents: number; chargedCents: number; paidCents: number; onAccountCents: number;
  pendingVerificationCents: number; balanceCents: number; lastPaymentAt: string | null;
  /** Saldo inicial traído del sistema anterior (>0 deuda, <0 a favor); ya está sumado en balanceCents. */
  openingCents: number;
}

/** Saldo del paciente: presupuestado, realizado, cobrado, a cuenta, por verificar y deuda. */
export async function patientMoney(c: Client, patientId: string): Promise<PatientMoney> {
  const r = (await c.query(
    `SELECT budgeted_cents AS "budgetedCents", charged_cents AS "chargedCents", paid_cents AS "paidCents", on_account_cents AS "onAccountCents",
            pending_cents AS "pendingVerificationCents", balance_cents AS "balanceCents", last_payment_at AS "lastPaymentAt",
            opening_cents AS "openingCents"
       FROM patient_money($1)`, [patientId])).rows[0];
  return r as PatientMoney;
}

/** Dinero de un presupuesto: total neto, realizado (cargos de sus líneas, con anulaciones), pagado y por verificar. */
export async function budgetMoney(c: Client, budgetId: string) {
  return (await c.query<{ totalCents: number; performedCents: number; paidCents: number; pendingCents: number }>(
    `SELECT COALESCE((SELECT sum(net_cents) FROM budget_items WHERE budget_id = $1 AND status <> 'cancelled'),0)::bigint AS "totalCents",
            COALESCE((SELECT sum(ch.amount_cents) FROM charges ch JOIN budget_items i ON i.id = ch.budget_item_id WHERE i.budget_id = $1),0)::bigint AS "performedCents",
            COALESCE((SELECT sum(amount_cents) FROM payments WHERE budget_id = $1 AND status = 'confirmed'),0)::bigint AS "paidCents",
            COALESCE((SELECT sum(amount_cents) FROM payments WHERE budget_id = $1 AND status = 'pending_verification'),0)::bigint AS "pendingCents"`,
    [budgetId])).rows[0]!;
}

/** Datos extra del detalle del presupuesto (versión, desglose de descuentos y sesiones por línea). */
export async function budgetExtras(c: Client, b: { id: string; items: any[] }) {
  const h = (await c.query(
    `SELECT b.version, b.global_discount_percent AS "globalDiscountPercent", b.discount_cents AS "globalDiscountCents", b.superseded_at AS "supersededAt",
            (SELECT n.id FROM budgets n WHERE n.number = b.number AND n.status <> 'superseded' AND n.id <> b.id) AS "latestVersionId",
            (SELECT max(v.version) FROM budgets v WHERE v.number = b.number) AS "versionsCount",
            (SELECT min(created_at) FROM budget_events e WHERE e.budget_id = b.id AND e.kind = 'viewed') AS "firstViewedAt",
            (SELECT row_to_json(x) FROM (SELECT e.signer_name AS "signerName", e.signer_relationship AS "signerRelationship", e.created_at AS "at",
                    e.content_hash AS "contentHash", e.signature_png IS NOT NULL AS "hasSignature"
               FROM budget_events e WHERE e.budget_id = b.id AND e.kind = 'accepted' ORDER BY e.created_at DESC LIMIT 1) x) AS "onlineAcceptance"
       FROM budgets b WHERE b.id = $1`, [b.id])).rows[0];
  const sessions = (await c.query(
    `SELECT s.id, s.budget_item_id AS "itemId", s.position, s.name, s.amount_cents AS "amountCents", s.status, s.performed_at AS "performedAt",
            u.full_name AS "performedByName"
       FROM budget_item_sessions s JOIN budget_items i ON i.id = s.budget_item_id LEFT JOIN users u ON u.id = s.performed_by
      WHERE i.budget_id = $1 ORDER BY s.position`, [b.id])).rows;
  const active = b.items.filter((i) => i.status !== "cancelled");
  const subtotalCents = active.reduce((s, i) => s + Number(i.grossCents), 0);
  const lineDiscountCents = active.reduce((s, i) => s + Number(i.discountCents), 0);
  for (const it of b.items) it.sessions = sessions.filter((s) => s.itemId === it.id);
  return {
    version: h.version, versionsCount: h.versionsCount, latestVersionId: h.latestVersionId, isLatest: !h.latestVersionId, supersededAt: h.supersededAt,
    subtotalCents, lineDiscountCents, globalDiscountCents: Number(h.globalDiscountCents), globalDiscountPercent: h.globalDiscountPercent,
    firstViewedAt: h.firstViewedAt, onlineAcceptance: h.onlineAcceptance,
  };
}
