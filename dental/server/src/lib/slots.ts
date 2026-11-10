// Cálculo de horarios libres (función pura, probada de forma aislada).
import { DateTime } from "luxon";

export type Interval = [number, number]; // epoch ms [inicio, fin)

/** Une intervalos superpuestos o contiguos. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const s = [...list].filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Interval[] = [];
  for (const iv of s) {
    const last = out[out.length - 1];
    if (last && iv[0] <= last[1]) last[1] = Math.max(last[1], iv[1]);
    else out.push([iv[0], iv[1]]);
  }
  return out;
}

/** Resta intervalos ocupados a intervalos de trabajo. */
export function subtract(work: Interval[], busy: Interval[]): Interval[] {
  const b = mergeIntervals(busy);
  const out: Interval[] = [];
  for (const [ws, we] of mergeIntervals(work)) {
    let cur = ws;
    for (const [bs, be] of b) {
      if (be <= cur || bs >= we) continue;
      if (bs > cur) out.push([cur, bs]);
      cur = Math.max(cur, be);
      if (cur >= we) break;
    }
    if (cur < we) out.push([cur, we]);
  }
  return out;
}

/** Inicios posibles de una cita de `durationMin` minutos, alineados a `stepMin`. */
export function slotStarts(free: Interval[], durationMin: number, stepMin = 15, notBefore = 0): number[] {
  const dur = durationMin * 60_000;
  const step = stepMin * 60_000;
  const out: number[] = [];
  for (const [fs, fe] of free) {
    let t = Math.ceil(Math.max(fs, notBefore) / step) * step;
    for (; t + dur <= fe; t += step) out.push(t);
  }
  return out;
}

/** Intervalos de trabajo de un día local a partir de un horario semanal "HH:MM". */
export function workIntervalsForDay(dateISO: string, zone: string, ranges: { start: string; end: string }[]): Interval[] {
  return ranges.map((r) => {
    const s = DateTime.fromISO(`${dateISO}T${r.start}`, { zone });
    const e = DateTime.fromISO(`${dateISO}T${r.end}`, { zone });
    return [s.toMillis(), e.toMillis()] as Interval;
  });
}

export function isoWeekday(dateISO: string, zone: string): number {
  return DateTime.fromISO(dateISO, { zone }).weekday;
}

export function dayBounds(dateISO: string, zone: string): [Date, Date] {
  const s = DateTime.fromISO(dateISO, { zone }).startOf("day");
  return [s.toJSDate(), s.plus({ days: 1 }).toJSDate()];
}
