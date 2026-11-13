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
