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
 * Suma `periods` períodos de `durationDays` a `from`. Pedido del dueño (14/11/2026): «Es de un mes: si vence el 12 de
 * enero, el siguiente mes es hasta el 12 de febrero». Los productos de 30, 60, 90, 180… días cuentan MESES de
 * calendario (mismo día del mes siguiente, a la misma hora de Bolivia; si ese día no existe, el último del mes: el 31/01
 * pasa al 28 o 29/02). Los demás (7, 15 días…) siguen contando días.
 */
export function addPeriods(from: number, durationDays: number, periods = 1): number {
  const days = Math.max(0, durationDays) * Math.max(0, periods);
  if (!(durationDays > 0) || durationDays % 30 !== 0) return from + days * DAY;
  const months = (durationDays / 30) * periods;
  const local = new Date(from - BO_OFFSET);
  const y = local.getUTCFullYear(), m = local.getUTCMonth() + months, d = local.getUTCDate();
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const t = Date.UTC(y, m, Math.min(d, lastDay), local.getUTCHours(), local.getUTCMinutes(), local.getUTCSeconds(), local.getUTCMilliseconds());
  return t + BO_OFFSET;
}

/** «1 mes», «3 meses», «15 días»: cómo se dice el período de un producto al cliente. */
export function periodText(durationDays: number, periods = 1): string {
  if (durationDays > 0 && durationDays % 30 === 0) { const n = (durationDays / 30) * periods; return n === 1 ? "1 mes" : `${n} meses`; }
  const n = durationDays * periods; return n === 1 ? "1 día" : `${n} días`;
}
