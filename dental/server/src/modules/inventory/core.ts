// Inventario: núcleo compartido (lotes, movimientos, FEFO, consumo por tratamiento, alertas y costos).
//
// Regla de oro: los saldos SOLO cambian insertando filas en inv_movements; el trigger
// inv_apply_movement (migración 0010) los aplica al lote y al stock de la sucursal.
// Toda salida de stock bloquea primero la fila inv_stock (insumo, sucursal) para serializar
// operaciones concurrentes sobre el mismo insumo sin bloqueos cruzados.
import { z } from "zod";
import type { Client } from "../../lib/db.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { zDate } from "../../lib/http.js";
import { clinicZone } from "../agenda.js";

// ---------------------------------------------------------------------------
// Cantidades: se validan con hasta 3 decimales y se calculan en milésimas (enteros)
// ---------------------------------------------------------------------------
const threeDecimals = (v: number) => Math.abs(Math.round(v * 1000) - v * 1000) < 1e-6;
export const zQty = z.number({ message: "Indica una cantidad" })
  .positive("La cantidad debe ser mayor que cero")
  .max(1_000_000, "La cantidad es demasiado grande")
  .refine(threeDecimals, "Usa como máximo 3 decimales");
export const zQtyZero = z.number({ message: "Indica una cantidad" })
  .min(0, "La cantidad no puede ser negativa")
  .max(1_000_000, "La cantidad es demasiado grande")
  .refine(threeDecimals, "Usa como máximo 3 decimales");
export const zOptDate = zDate.nullish().transform((v) => v ?? null);

export const toMilli = (n: number | string) => Math.round(Number(n) * 1000);
export const fromMilli = (m: number) => (m / 1000).toFixed(3);
/** Número legible en español (hasta 3 decimales, sin ceros sobrantes). */
export const fmtQty = (n: number | string) => {
  const v = Math.round(Number(n) * 1000) / 1000;
  return v.toLocaleString("es-BO", { maximumFractionDigits: 3 });
};

export const MOVEMENT_LABELS: Record<string, string> = {
  purchase: "Compra", consumption: "Consumo", adjustment: "Ajuste", transfer_out: "Envío a otra sucursal", transfer_in: "Recepción de transferencia",
};
export const REASON_LABELS: Record<string, string> = { count: "Conteo", breakage: "Rotura", expiry: "Vencimiento", other: "Otro" };
export const PER_LABELS: Record<string, string> = { treatment: "por tratamiento", tooth: "por pieza", surface: "por superficie" };

export interface ItemRow {
  id: string; sku: string; name: string; use_unit: string; purchase_unit: string; purchase_factor: number; tracks_lots: boolean; active: boolean;
}

export async function getItem(c: Client, itemId: string): Promise<ItemRow> {
  const it = (await c.query<ItemRow>(
    "SELECT id, sku, name, use_unit, purchase_unit, purchase_factor, tracks_lots, active FROM inv_items WHERE id = $1", [itemId])).rows[0];
  if (!it) throw notFound("Insumo");
  return it;
}

/** Una compra no ingresa lotes ya vencidos (se rechazan al proveedor). */
export async function assertNotExpired(c: Client, clinicId: string, expiresOn: string | null | undefined, path: string) {
  if (expiresOn && expiresOn < (await localToday(c, clinicId))) {
    throw new AppError(400, "validation", "Ese lote ya está vencido: no lo ingreses al stock (recházalo)", [{ path, message: "Lote vencido" }]);
  }
}

export async function assertBranch(c: Client, branchId: string) {
  if (!(await c.query("SELECT 1 FROM branches WHERE id = $1 AND active", [branchId])).rowCount) throw notFound("Sucursal");
}

export async function localToday(c: Client, clinicId: string): Promise<string> {
  const zone = await clinicZone(c, clinicId);
  return new Date().toLocaleDateString("en-CA", { timeZone: zone });
}

/** Crea (si falta) y bloquea la fila de stock del insumo en la sucursal. */
export async function lockStock(c: Client, clinicId: string, itemId: string, branchId: string): Promise<{ qty: number; min: number }> {
  await c.query(
    "INSERT INTO inv_stock (clinic_id, item_id, branch_id) VALUES ($1,$2,$3) ON CONFLICT (item_id, branch_id) DO NOTHING",
    [clinicId, itemId, branchId]);
  const r = (await c.query<{ qty_on_hand: number; min_qty: number }>(
    "SELECT qty_on_hand, min_qty FROM inv_stock WHERE item_id = $1 AND branch_id = $2 FOR UPDATE", [itemId, branchId])).rows[0]!;
  return { qty: Number(r.qty_on_hand), min: Number(r.min_qty) };
}

/** Lote implícito (sin código) de un insumo que no maneja lotes. */
export async function implicitLot(c: Client, clinicId: string, itemId: string, branchId: string): Promise<string> {
  const found = (await c.query<{ id: string }>(
    "SELECT id FROM inv_lots WHERE item_id = $1 AND branch_id = $2 AND lot_code IS NULL", [itemId, branchId])).rows[0];
  if (found) return found.id;
  return (await c.query<{ id: string }>(
    "INSERT INTO inv_lots (clinic_id, item_id, branch_id) VALUES ($1,$2,$3) RETURNING id", [clinicId, itemId, branchId])).rows[0]!.id;
}

/**
 * Lote donde entra mercadería: para insumos con lotes se exige código y vencimiento;
 * si el código ya existe en la sucursal, el vencimiento debe coincidir.
 */
export async function lotForIncoming(c: Client, clinicId: string, item: ItemRow, branchId: string,
  lotCode: string | null | undefined, expiresOn: string | null | undefined, supplierId: string | null = null,
  field = ""): Promise<string> {
  await lockStock(c, clinicId, item.id, branchId);
  if (!item.tracks_lots) {
    if (lotCode || expiresOn) throw new AppError(400, "validation", `«${item.name}» no se maneja por lotes: deja vacíos el lote y el vencimiento`, [{ path: `${field}lotCode`, message: "Este insumo no usa lotes" }]);
    return implicitLot(c, clinicId, item.id, branchId);
  }
  const code = (lotCode ?? "").trim();
  if (!code) throw new AppError(400, "validation", `Indica el número de lote de «${item.name}»`, [{ path: `${field}lotCode`, message: "Indica el número de lote" }]);
  if (!expiresOn) throw new AppError(400, "validation", `Indica el vencimiento del lote de «${item.name}»`, [{ path: `${field}expiresOn`, message: "Indica la fecha de vencimiento" }]);
  const ex = (await c.query<{ id: string; expires_on: string | null }>(
    "SELECT id, expires_on FROM inv_lots WHERE item_id = $1 AND branch_id = $2 AND lower(lot_code) = lower($3)", [item.id, branchId, code])).rows[0];
  if (ex) {
    if (ex.expires_on !== expiresOn) {
      throw new AppError(409, "lot_expiry_mismatch", `El lote ${code} ya existe en esta sucursal con vencimiento ${ex.expires_on ?? "sin fecha"}. Revisa la fecha o usa otro número de lote.`,
        [{ path: `${field}expiresOn`, message: `El lote ya existe con vencimiento ${ex.expires_on}` }]);
    }
    return ex.id;
  }
  return (await c.query<{ id: string }>(
    "INSERT INTO inv_lots (clinic_id, item_id, branch_id, lot_code, expires_on, supplier_id) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
    [clinicId, item.id, branchId, code, expiresOn, supplierId])).rows[0]!.id;
}

export interface MovementInput {
  itemId: string; branchId: string; lotId: string; kind: string; qtyMilli: number; unitCost?: number | null;
  reason?: string | null; note?: string | null; poReceiptId?: string | null; transferId?: string | null; countId?: string | null;
  budgetItemId?: string | null; appointmentId?: string | null; pendingId?: string | null;
}

export async function insertMovement(c: Client, auth: AuthCtx, m: MovementInput): Promise<string> {
  // Las salidas registran el costo del lote en ese momento (valorización del consumo)
  let cost = m.unitCost ?? null;
  if (cost == null && m.qtyMilli < 0) {
    cost = Number((await c.query<{ unit_cost: number }>("SELECT unit_cost FROM inv_lots WHERE id = $1", [m.lotId])).rows[0]?.unit_cost ?? 0);
  }
  return (await c.query<{ id: string }>(
    `INSERT INTO inv_movements (clinic_id, item_id, branch_id, lot_id, kind, qty, unit_cost, reason, note, po_receipt_id, transfer_id, count_id,
       budget_item_id, appointment_id, pending_id, created_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id`,
    [auth.clinicId, m.itemId, m.branchId, m.lotId, m.kind, fromMilli(m.qtyMilli), cost, m.reason ?? null, m.note ?? null,
      m.poReceiptId ?? null, m.transferId ?? null, m.countId ?? null, m.budgetItemId ?? null, m.appointmentId ?? null, m.pendingId ?? null, auth.userId],
  )).rows[0]!.id;
}

interface LotAvail { id: string; lot_code: string | null; expires_on: string | null; qty: number }

/** Lotes con saldo en orden FEFO (primero el que vence antes; sin vencimiento al final). */
async function fefoLots(c: Client, itemId: string, branchId: string): Promise<LotAvail[]> {
  return (await c.query<{ id: string; lot_code: string | null; expires_on: string | null; qty_on_hand: number }>(
    `SELECT id, lot_code, expires_on, qty_on_hand FROM inv_lots
      WHERE item_id = $1 AND branch_id = $2 AND qty_on_hand > 0
      ORDER BY expires_on NULLS LAST, created_at, id`, [itemId, branchId])).rows
    .map((l) => ({ id: l.id, lot_code: l.lot_code, expires_on: l.expires_on, qty: toMilli(l.qty_on_hand) }));
}

export interface TakeResult { takenMilli: number; missingMilli: number; movementIds: string[]; parts: { lotId: string; qtyMilli: number }[] }

/**
 * Saca stock de una sucursal: del lote elegido o por FEFO (salteando lotes vencidos).
 * strict=true rechaza con mensaje claro si no alcanza; strict=false saca lo que hay y devuelve el faltante.
 */
export async function takeStock(c: Client, auth: AuthCtx, o: {
  itemId: string; branchId: string; qtyMilli: number; lotId?: string | null; kind: "consumption" | "transfer_out" | "adjustment";
  reason?: string | null; note?: string | null; strict: boolean; budgetItemId?: string | null; appointmentId?: string | null;
  pendingId?: string | null; transferId?: string | null; countId?: string | null;
}): Promise<TakeResult> {
  const item = await getItem(c, o.itemId);
  await lockStock(c, auth.clinicId!, o.itemId, o.branchId);
  const today = await localToday(c, auth.clinicId!);
  let lots = await fefoLots(c, o.itemId, o.branchId);
  const unit = item.use_unit;
  if (o.lotId) {
    const chosen = (await c.query<{ id: string; branch_id: string; item_id: string; lot_code: string | null; expires_on: string | null; qty_on_hand: number }>(
      "SELECT id, branch_id, item_id, lot_code, expires_on, qty_on_hand FROM inv_lots WHERE id = $1", [o.lotId])).rows[0];
    if (!chosen || chosen.item_id !== o.itemId || chosen.branch_id !== o.branchId) {
      throw new AppError(400, "validation", "El lote elegido no corresponde a este insumo en esta sucursal", [{ path: "lotId", message: "Lote no válido" }]);
    }
    if (o.kind !== "adjustment" && chosen.expires_on && chosen.expires_on < today) {
      throw new AppError(409, "lot_expired", `El lote ${chosen.lot_code} venció el ${chosen.expires_on}. No se usa: regístralo como ajuste por vencimiento.`, [{ path: "lotId", message: "Lote vencido" }]);
    }
    lots = [{ id: chosen.id, lot_code: chosen.lot_code, expires_on: chosen.expires_on, qty: toMilli(chosen.qty_on_hand) }];
  } else if (o.kind !== "adjustment") {
    lots = lots.filter((l) => !l.expires_on || l.expires_on >= today);
  }
  const available = lots.reduce((s, l) => s + l.qty, 0);
  if (o.strict && available < o.qtyMilli) {
    const expiredOnly = !o.lotId && o.kind !== "adjustment"
      ? (await fefoLots(c, o.itemId, o.branchId)).filter((l) => l.expires_on && l.expires_on < today).reduce((s, l) => s + l.qty, 0) : 0;
    const where = o.lotId ? `en el lote ${lots[0]?.lot_code ?? "elegido"}` : "en esta sucursal";
    throw new AppError(409, "insufficient_stock",
      `Stock insuficiente de «${item.name}»: hay ${fmtQty(available / 1000)} ${unit} disponibles ${where} y pediste ${fmtQty(o.qtyMilli / 1000)}.` +
      (expiredOnly ? ` Además hay ${fmtQty(expiredOnly / 1000)} ${unit} vencidos que no se pueden usar.` : ""),
      [{ path: "qty", message: `Máximo disponible: ${fmtQty(available / 1000)} ${unit}` }]);
  }
  let left = o.qtyMilli;
  const res: TakeResult = { takenMilli: 0, missingMilli: 0, movementIds: [], parts: [] };
  for (const l of lots) {
    if (left <= 0) break;
    const q = Math.min(left, l.qty);
    if (q <= 0) continue;
    res.movementIds.push(await insertMovement(c, auth, {
      itemId: o.itemId, branchId: o.branchId, lotId: l.id, kind: o.kind, qtyMilli: -q, reason: o.reason, note: o.note,
      budgetItemId: o.budgetItemId, appointmentId: o.appointmentId, pendingId: o.pendingId, transferId: o.transferId, countId: o.countId,
    }));
    res.parts.push({ lotId: l.id, qtyMilli: q });
    res.takenMilli += q;
    left -= q;
  }
  res.missingMilli = Math.max(0, left);
  return res;
}

// ---------------------------------------------------------------------------
// Consumo estándar al realizar un tratamiento (IN-05). NUNCA bloquea el tratamiento.
// ---------------------------------------------------------------------------

/** Cantidad requerida según la regla (por tratamiento, por pieza o por superficie). */
export function requiredMilli(qty: number, per: string, line: { quantity: number; surfaces: string[] }): number {
  const base = toMilli(qty);
  const n = Math.max(1, Number(line.quantity) || 1);
  if (per === "tooth") return base * n;
  if (per === "surface") return base * Math.max(1, line.surfaces?.length ?? 0) * n;
  return base;
}

/**
 * Hook para billing.ts / budgets-v2.ts: descuenta los materiales estándar de la prestación en la
 * sucursal de la cita (o del presupuesto). Si falta stock, saca lo que hay y deja un "consumo pendiente".
 * Es idempotente por tratamiento y corre dentro de un SAVEPOINT: un error aquí jamás impide realizarlo.
 */
export async function consumeForTreatment(c: Client, auth: AuthCtx, o: { budgetItemId: string; appointmentId?: string | null; when?: boolean }): Promise<{ pending: number; movements: number } | null> {
  if (o.when === false) return null;
  await c.query("SAVEPOINT inv_consume");
  try {
    const out = await doConsume(c, auth, o.budgetItemId, o.appointmentId ?? null);
    await c.query("RELEASE SAVEPOINT inv_consume");
    return out;
  } catch (e) {
    await c.query("ROLLBACK TO SAVEPOINT inv_consume");
    console.warn("[inventario] no se pudo descontar materiales del tratamiento", o.budgetItemId, (e as Error).message);
    return null;
  }
}

async function doConsume(c: Client, auth: AuthCtx, budgetItemId: string, appointmentId: string | null) {
  const line = (await c.query<{ procedure_id: string; quantity: number; surfaces: string[]; branch_id: string }>(
    `SELECT i.procedure_id, i.quantity, i.surfaces, b.branch_id
       FROM budget_items i JOIN budgets b ON b.id = i.budget_id WHERE i.id = $1`, [budgetItemId])).rows[0];
  if (!line) return null;
  const mats = (await c.query<{ item_id: string; qty: number; per: string }>(
    `SELECT m.item_id, m.qty, m.per FROM inv_procedure_materials m JOIN inv_items it ON it.id = m.item_id
      WHERE m.procedure_id = $1 AND it.active ORDER BY m.item_id`, [line.procedure_id])).rows;
  if (!mats.length) return null;
  let branchId = line.branch_id;
  let apptId: string | null = null;
  if (appointmentId) {
    const a = (await c.query<{ branch_id: string }>("SELECT branch_id FROM appointments WHERE id = $1", [appointmentId])).rows[0];
    if (a) { branchId = a.branch_id; apptId = appointmentId; }
  }
  const mark = await c.query(
    `INSERT INTO inv_treatment_consumptions (budget_item_id, clinic_id, branch_id, appointment_id, created_by)
     VALUES ($1,$2,$3,$4,$5) ON CONFLICT (budget_item_id) DO NOTHING`, [budgetItemId, auth.clinicId, branchId, apptId, auth.userId]);
  if (!mark.rowCount) return { pending: 0, movements: 0 }; // ya descontado antes (p. ej. tras anular y volver a realizar)
  let pending = 0, movements = 0;
  for (const m of mats) {
    const need = requiredMilli(Number(m.qty), m.per, line);
    const r = await takeStock(c, auth, {
      itemId: m.item_id, branchId, qtyMilli: need, kind: "consumption", strict: false, budgetItemId, appointmentId: apptId,
      note: "Consumo estándar del tratamiento",
    });
    movements += r.movementIds.length;
    if (r.missingMilli > 0) {
      const p = (await c.query<{ id: string }>(
        `INSERT INTO inv_pending_consumptions (clinic_id, branch_id, item_id, budget_item_id, appointment_id, qty_missing, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [auth.clinicId, branchId, m.item_id, budgetItemId, apptId, fromMilli(r.missingMilli), auth.userId])).rows[0]!.id;
      pending++;
      await audit(c, auth, "inventory.pending_consumption", "inv_pending_consumption", p, { itemId: m.item_id, budgetItemId, qtyMissing: r.missingMilli / 1000 }, branchId);
    }
  }
  await audit(c, auth, "inventory.treatment_consumed", "budget_item", budgetItemId, { movements, pending }, branchId);
  return { pending, movements };
}

/**
 * Costo de materiales de un tratamiento (para futuros informes de rentabilidad), en centavos.
 * Usa el costo del lote registrado en cada movimiento de consumo; lo pendiente se estima con el
 * costo promedio actual del insumo en la sucursal.
 */
export async function materialCostForTreatment(c: Client, budgetItemId: string): Promise<{ costCents: number; pendingCostCents: number; lines: { itemId: string; name: string; qty: number; costCents: number }[] }> {
  const rows = (await c.query<{ item_id: string; name: string; qty: number; cost: number }>(
    `SELECT m.item_id, it.name, sum(-m.qty) AS qty, sum(-m.qty * coalesce(m.unit_cost, 0)) AS cost
       FROM inv_movements m JOIN inv_items it ON it.id = m.item_id
      WHERE m.budget_item_id = $1 AND m.kind = 'consumption' GROUP BY m.item_id, it.name ORDER BY it.name`, [budgetItemId])).rows;
  const pend = (await c.query<{ cost: number }>(
    `SELECT coalesce(sum(p.qty_missing * coalesce((
        SELECT sum(l.qty_on_hand * l.unit_cost) / nullif(sum(l.qty_on_hand), 0) FROM inv_lots l WHERE l.item_id = p.item_id AND l.branch_id = p.branch_id), 0)), 0) AS cost
       FROM inv_pending_consumptions p WHERE p.budget_item_id = $1 AND p.resolved_at IS NULL`, [budgetItemId])).rows[0]!;
  const lines = rows.map((r) => ({ itemId: r.item_id, name: r.name, qty: Number(r.qty), costCents: Math.round(Number(r.cost)) }));
  return { costCents: lines.reduce((s, l) => s + l.costCents, 0), pendingCostCents: Math.round(Number(pend.cost)), lines };
}

// ---------------------------------------------------------------------------
// Alertas por sucursal (IN-06)
// ---------------------------------------------------------------------------
export interface Alert {
  type: "below_min" | "expired" | "expiring" | "pending_consumption";
  bucket?: 30 | 60 | 90;
  branchId: string; branchName: string; itemId: string; itemName: string; sku: string; unit: string;
  qty?: number; minQty?: number; lotId?: string; lotCode?: string | null; expiresOn?: string; daysLeft?: number;
  pendingId?: string; qtyMissing?: number; createdAt?: string;
}

/** branches = null → todas las sucursales de la clínica. */
export async function computeAlerts(c: Client, clinicId: string, branches: string[] | null): Promise<Alert[]> {
  const today = await localToday(c, clinicId);
  const scope = branches === null ? "TRUE" : "s.branch_id = ANY($1::uuid[])";
  const params = branches === null ? [] : [branches];
  const out: Alert[] = [];
  const low = (await c.query(
    `SELECT s.branch_id, b.name AS branch_name, s.item_id, it.name, it.sku, it.use_unit, s.qty_on_hand, s.min_qty
       FROM inv_stock s JOIN inv_items it ON it.id = s.item_id JOIN branches b ON b.id = s.branch_id
      WHERE ${scope} AND it.active AND s.min_qty > 0 AND s.qty_on_hand < s.min_qty ORDER BY b.name, it.name`, params)).rows;
  for (const r of low) out.push({ type: "below_min", branchId: r.branch_id, branchName: r.branch_name, itemId: r.item_id, itemName: r.name, sku: r.sku, unit: r.use_unit, qty: Number(r.qty_on_hand), minQty: Number(r.min_qty) });
  const lots = (await c.query(
    `SELECT l.id, l.lot_code, l.expires_on, (l.expires_on - $${params.length + 1}::date) AS days_left, l.qty_on_hand, s.branch_id, b.name AS branch_name,
            l.item_id, it.name, it.sku, it.use_unit
       FROM inv_lots l JOIN inv_stock s ON s.item_id = l.item_id AND s.branch_id = l.branch_id
       JOIN inv_items it ON it.id = l.item_id JOIN branches b ON b.id = l.branch_id
      WHERE ${scope} AND l.qty_on_hand > 0 AND l.expires_on IS NOT NULL AND l.expires_on <= $${params.length + 1}::date + 90
      ORDER BY l.expires_on, it.name`, [...params, today])).rows;
  for (const r of lots) {
    const d = Number(r.days_left);
    out.push({
      type: d < 0 ? "expired" : "expiring", bucket: d < 0 ? undefined : d <= 30 ? 30 : d <= 60 ? 60 : 90,
      branchId: r.branch_id, branchName: r.branch_name, itemId: r.item_id, itemName: r.name, sku: r.sku, unit: r.use_unit,
      qty: Number(r.qty_on_hand), lotId: r.id, lotCode: r.lot_code, expiresOn: r.expires_on, daysLeft: d,
    });
  }
  const pend = (await c.query(
    `SELECT p.id, p.branch_id, b.name AS branch_name, p.item_id, it.name, it.sku, it.use_unit, p.qty_missing, p.created_at
       FROM inv_pending_consumptions p JOIN inv_items it ON it.id = p.item_id JOIN branches b ON b.id = p.branch_id
      WHERE ${scope.replace("s.", "p.")} AND p.resolved_at IS NULL ORDER BY p.created_at`, params)).rows;
  for (const r of pend) out.push({ type: "pending_consumption", branchId: r.branch_id, branchName: r.branch_name, itemId: r.item_id, itemName: r.name, sku: r.sku, unit: r.use_unit, pendingId: r.id, qtyMissing: Number(r.qty_missing), createdAt: r.created_at });
  return out;
}

export function badQty(msg: string, path = "qty") {
  return new AppError(400, "validation", msg, [{ path, message: msg }]);
}
export { badRequest, conflict, notFound };
