export const MINUTE = 60_000;
export const HOUR = 3_600_000;
export const DAY = 86_400_000;

/** Bolivia es UTC−4 todo el año (sin horario de verano): el día y el mes se cortan a las 04:00 UTC. */
export const BO_OFFSET = 4 * HOUR;
const pad2 = (n: number) => String(n).padStart(2, "0");
/** Año, mes (0-11) y día del calendario de Bolivia para un instante. */
export function boParts(t: number): { y: number; m: number; d: number } {
  const d = new Date(t - BO_OFFSET);
  return { y: d.getUTCFullYear(), m: d.getUTCMonth(), d: d.getUTCDate() };
}
/** Inicio (ms) del mes calendario de Bolivia que contiene `t`, corrido `add` meses. */
export function boMonthStart(t: number, add = 0): number {
  const p = boParts(t);
  return Date.UTC(p.y, p.m + add, 1) + BO_OFFSET;
}
/** Inicio (ms) del día de Bolivia que contiene `t`, corrido `add` días. */
export function boDayStart(t: number, add = 0): number {
  const p = boParts(t);
  return Date.UTC(p.y, p.m, p.d + add) + BO_OFFSET;
}
/** "AAAA-MM-DD" en Bolivia (no depende de la zona horaria del servidor). */
export const boDayKey = (t: number): string => { const p = boParts(t); return `${p.y}-${pad2(p.m + 1)}-${pad2(p.d)}`; };
/** "AAAA-MM" en Bolivia. */
export const boMonthKey = (t: number): string => { const p = boParts(t); return `${p.y}-${pad2(p.m + 1)}`; };

/**
 * Cómo se cuenta «un mes» (pedido del dueño, 14/11/2026: «Sería mejor que cada quien decida, porque yo doy de mes a mes,
 * pero otros revendedores sí hacen 30 días»):
 *  - "calendar": del mismo día al mismo día del mes siguiente (13/12 → 13/01). La tienda, por defecto;
 *  - "days": 30 días justos (13/12 → 12/01). Los revendedores, por defecto (lo de siempre).
 * Solo cambia los productos de 30, 60, 90… días; los de 7 o 15 días cuentan días en los dos modos.
 */
export type MonthMode = "calendar" | "days";
export const MONTH_MODES: readonly MonthMode[] = ["calendar", "days"];

/** ¿Este producto se cuenta por meses de calendario con este modo? */
export const isMonthly = (durationDays: number, mode: MonthMode): boolean => mode === "calendar" && durationDays > 0 && durationDays % 30 === 0;

/** Corre `months` meses (puede ser negativo) a la misma hora de Bolivia; si ese día no existe, el último del mes. */
function shiftMonths(t: number, months: number): number {
  const local = new Date(t - BO_OFFSET);
  const y = local.getUTCFullYear(), m = local.getUTCMonth() + months, d = local.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return Date.UTC(y, m, Math.min(d, lastDay), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds()) + BO_OFFSET;
}

/**
 * Suma `periods` períodos de `durationDays` a `from`. Con `mode` "calendar" los productos de 30, 60, 90… días cuentan
 * MESES de calendario («si vence el 12 de enero, el siguiente mes es hasta el 12 de febrero»; el 31/01 pasa al 28 o
 * 29/02). Con "days", y en los demás productos, se suman días como siempre.
 */
export function addPeriods(from: number, durationDays: number, periods: number, mode: MonthMode): number {
  if (!(durationDays > 0) || !(periods > 0)) return from;
  if (!isMonthly(durationDays, mode)) return from + durationDays * periods * DAY;
  return shiftMonths(from, (durationDays / 30) * periods);
}

/** Lo inverso de `addPeriods`: dónde empezó el período (o los `periods` períodos) que termina en `to`. */
export function subPeriods(to: number, durationDays: number, periods: number, mode: MonthMode): number {
  if (!(durationDays > 0) || !(periods > 0)) return to;
  if (!isMonthly(durationDays, mode)) return to - durationDays * periods * DAY;
  return shiftMonths(to, -(durationDays / 30) * periods);
}

/** «1 mes», «3 meses», «15 días» (o «30 días» con el modo "days"): cómo se dice el período de un producto. */
export function periodText(durationDays: number, periods: number, mode: MonthMode): string {
  if (isMonthly(durationDays, mode)) { const n = (durationDays / 30) * periods; return n === 1 ? "1 mes" : `${n} meses`; }
  const n = durationDays * periods; return n === 1 ? "1 día" : `${n} días`;
}
