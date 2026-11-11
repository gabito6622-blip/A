// Gastos compartidos entre sucursales (B-083): reparto por porcentaje, exacto al centavo.
//
//  * Los porcentajes admiten hasta 2 decimales y deben sumar exactamente 100 % (se guardan en centésimos
//    de punto: 33,33 % = 3333).
//  * Cada sucursal recibe floor(monto × % / 100) y el residuo de centavos va a la sucursal con MAYOR
//    porcentaje (si empatan, a la primera de la lista). La suma de las partes es siempre el monto.
//  * La sucursal «principal» del gasto (expenses.branch_id) es la de mayor porcentaje.
//  * La base vuelve a comprobar al confirmar la transacción que el reparto suma 100 % y el monto exacto
//    (trigger expense_shares_total), y no deja cambiar el reparto de un gasto confirmado o anulado.
import { z } from "zod";
import { zId } from "../../lib/http.js";
import { AppError } from "../../lib/errors.js";
import type { Client } from "../../lib/db.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../../lib/rbac.js";

export const zShares = z.array(z.object({
  branchId: zId,
  percent: z.number({ message: "Escribe el porcentaje" }).gt(0, "Cada porcentaje debe ser mayor que 0").lt(100, "Cada porcentaje debe ser menor que 100"),
})).max(20, "Como máximo 20 sucursales").nullish();

export interface Share { branchId: string; bp: number }

const fail = (message: string) => new AppError(400, "validation", message, [{ path: "shares", message }]);

/** Valida el reparto (null = gasto de una sola sucursal). */
export function parseShares(input: z.infer<typeof zShares>): Share[] | null {
  if (!input || input.length === 0) return null;
  if (input.length < 2) throw fail("Un gasto compartido se reparte entre dos o más sucursales");
  const seen = new Set<string>();
  const out: Share[] = [];
  for (const s of input) {
    if (seen.has(s.branchId)) throw fail("Una sucursal aparece dos veces en el reparto");
    seen.add(s.branchId);
    const bp = Math.round(s.percent * 100);
    if (Math.abs(bp - s.percent * 100) > 1e-6) throw fail("Los porcentajes admiten como máximo 2 decimales");
    out.push({ branchId: s.branchId, bp });
  }
  const total = out.reduce((a, s) => a + s.bp, 0);
  if (total !== 10000) throw fail(`Los porcentajes deben sumar 100 % (suman ${(total / 100).toLocaleString("es-BO")} %)`);
  return out;
}

/** Índice de la sucursal con mayor porcentaje (la primera si hay empate). */
export const mainShareIndex = (bps: number[]) => bps.reduce((best, bp, i) => (bp > bps[best]! ? i : best), 0);

/** Reparte `amount` centavos según los porcentajes (centésimos de punto que suman 10 000). */
export function splitByPercent(amount: number, bps: number[]): number[] {
  const parts = bps.map((bp) => Number((BigInt(amount) * BigInt(bp)) / 10000n));
  const rest = amount - parts.reduce((a, x) => a + x, 0);
  parts[mainShareIndex(bps)]! += rest;
  return parts;
}

/** Reemplaza el reparto de un gasto en borrador (vacío = una sola sucursal). Devuelve la sucursal principal. */
export async function saveShares(c: Client, clinicId: string, expenseId: string, amount: number, shares: Share[] | null): Promise<void> {
  await c.query("DELETE FROM expense_shares WHERE expense_id = $1", [expenseId]);
  if (!shares) return;
  const parts = splitByPercent(amount, shares.map((s) => s.bp));
  for (let i = 0; i < shares.length; i++) {
    await c.query("INSERT INTO expense_shares (clinic_id, expense_id, branch_id, percent_bp, amount_cents) VALUES ($1,$2,$3,$4,$5)",
      [clinicId, expenseId, shares[i]!.branchId, shares[i]!.bp, parts[i]]);
  }
}

/** Quien registra o modifica un gasto compartido debe tener acceso a todas sus sucursales. */
export function requireShareBranches(auth: AuthCtx, branchIds: string[]) {
  for (const b of branchIds) requireBranch(auth, b);
}

/** Sucursales que cuentan en una consulta: la filtrada, las permitidas o todas (null). */
export function scopeOf(auth: AuthCtx, branchId?: string | null): string[] | null {
  if (branchId) return [branchId];
  return allowedBranches(auth);
}
