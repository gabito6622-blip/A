// Utilidades comunes del módulo de gestión (mes en la zona de la clínica, reparto exacto de centavos).
import { z } from "zod";
import { DateTime } from "luxon";
import type { Client } from "../../lib/db.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { badRequest } from "../../lib/errors.js";
import { clinicZone } from "../agenda.js";

export const zMonth = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido (AAAA-MM)");

export interface MonthRange {
  zone: string;
  month: string;          // AAAA-MM
  from: Date;             // inicio del mes (zona de la clínica)
  to: Date;               // inicio del mes siguiente
  fromDate: string;       // AAAA-MM-01
  toDateExclusive: string;
  toDate: string;         // último día del mes
  label: string;          // "Noviembre de 2026"
}

export function monthRangeIn(zone: string, month: string): MonthRange {
  const f = DateTime.fromISO(`${month}-01`, { zone });
  if (!f.isValid) throw badRequest("Mes inválido (AAAA-MM)");
  const t = f.plus({ months: 1 });
  const raw = f.setLocale("es").toFormat("LLLL 'de' yyyy");
  return {
    zone, month, from: f.toJSDate(), to: t.toJSDate(), fromDate: f.toISODate()!, toDateExclusive: t.toISODate()!,
    toDate: t.minus({ days: 1 }).toISODate()!, label: raw.charAt(0).toUpperCase() + raw.slice(1),
  };
}

export async function monthRange(c: Client, auth: AuthCtx, month?: string): Promise<MonthRange> {
  const zone = await clinicZone(c, auth.clinicId!);
  return monthRangeIn(zone, month ?? DateTime.now().setZone(zone).toFormat("yyyy-MM"));
}

export async function localToday(c: Client, auth: AuthCtx): Promise<string> {
  const zone = await clinicZone(c, auth.clinicId!);
  return DateTime.now().setZone(zone).toISODate()!;
}

/**
 * Reparte `total` centavos en proporción a `weights` sin perder ni inventar centavos
 * (método del mayor resto). Si todos los pesos son 0 devuelve null (no hay base para repartir).
 */
export function allocate(total: number, weights: number[]): number[] | null {
  const w = weights.map((x) => (x > 0 ? x : 0));
  const sum = w.reduce((s, x) => s + x, 0);
  if (sum <= 0) return null;
  const sign = total < 0 ? -1 : 1;
  const abs = Math.abs(total);
  const raw = w.map((x) => (abs * x) / sum);
  const out = raw.map(Math.floor);
  let rest = abs - out.reduce((s, x) => s + x, 0);
  const order = raw.map((x, i) => ({ i, frac: x - Math.floor(x) })).sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; rest > 0 && k < order.length; k++, rest--) out[order[k]!.i]! += 1;
  return out.map((x) => x * sign);
}

/** Variación porcentual con un decimal; null si no hay base de comparación. */
export const pctChange = (cur: number | null | undefined, prev: number | null | undefined) =>
  cur == null || prev == null || prev === 0 ? null : Math.round(((cur - prev) / Math.abs(prev)) * 1000) / 10;

export const CATEGORY_LABELS: Record<string, string> = {
  rent: "Alquiler", salaries: "Sueldos", utilities: "Servicios básicos", supplies: "Insumos fuera de inventario",
  marketing: "Marketing", maintenance: "Mantenimiento", taxes: "Impuestos", other: "Otros",
};
export const CATEGORIES = Object.keys(CATEGORY_LABELS) as [string, ...string[]];
