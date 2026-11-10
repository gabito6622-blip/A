// Cálculo de horarios de envío en la zona de la clínica: horario de silencio (por defecto
// 20:00–08:00 America/La_Paz) y día local para el tope diario. Funciones puras y probadas.
import { DateTime } from "luxon";

export interface QuietHours { start: string; end: string } // "HH:MM"

export const DEFAULT_QUIET: QuietHours = { start: "20:00", end: "08:00" };
/** Margen mínimo entre el aviso y el inicio de la cita. */
export const MIN_LEAD_MINUTES = 30;
/** Si el aviso caería en silencio y moverlo a la mañana lo deja sin margen, se adelanta a antes del silencio. */
export const PULL_BACK_MINUTES = 15;

const mins = (hhmm: string) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h! * 60 + m!;
};
const at = (d: DateTime, hhmm: string) => {
  const m = mins(hhmm);
  return d.set({ hour: Math.floor(m / 60), minute: m % 60, second: 0, millisecond: 0 });
};

export function isQuiet(ms: number, zone: string, q: QuietHours): boolean {
  const s = mins(q.start), e = mins(q.end);
  if (s === e) return false;
  const t = DateTime.fromMillis(ms, { zone });
  const x = t.hour * 60 + t.minute;
  return s > e ? x >= s || x < e : x >= s && x < e;
}

/** Primer instante permitido en o después de ms. */
export function nextAllowed(ms: number, zone: string, q: QuietHours): number {
  if (!isQuiet(ms, zone, q)) return ms;
  const t = DateTime.fromMillis(ms, { zone });
  const endToday = at(t, q.end);
  return (endToday.toMillis() > ms ? endToday : endToday.plus({ days: 1 })).toMillis();
}

/** Inicio del período de silencio que contiene ms (se asume isQuiet). */
function quietWindowStart(ms: number, zone: string, q: QuietHours): number {
  const t = DateTime.fromMillis(ms, { zone });
  const startToday = at(t, q.start);
  return (startToday.toMillis() <= ms ? startToday : startToday.minus({ days: 1 })).toMillis();
}

/**
 * Hora real de envío para un mensaje que corresponde enviar en dueMs:
 *  - fuera del silencio, se envía a su hora;
 *  - dentro del silencio, pasa a la siguiente hora permitida;
 *  - si eso lo deja a menos de 30 min de la cita (deadline), se adelanta a 15 min antes de que empiece el silencio.
 */
export function planSendAt(dueMs: number, zone: string, q: QuietHours, deadlineMs?: number | null): { sendAt: number; deferred: boolean; pulledBack: boolean } {
  const next = nextAllowed(dueMs, zone, q);
  if (next === dueMs) return { sendAt: dueMs, deferred: false, pulledBack: false };
  if (deadlineMs != null && next > deadlineMs - MIN_LEAD_MINUTES * 60_000) {
    return { sendAt: quietWindowStart(dueMs, zone, q) - PULL_BACK_MINUTES * 60_000, deferred: false, pulledBack: true };
  }
  return { sendAt: next, deferred: true, pulledBack: false };
}

/** Día local (AAAA-MM-DD) e intervalo [inicio, fin) de ese día en la zona de la clínica. */
export function localDay(ms: number, zone: string): { date: string; start: Date; end: Date } {
  const d = DateTime.fromMillis(ms, { zone }).startOf("day");
  return { date: d.toISODate()!, start: d.toJSDate(), end: d.plus({ days: 1 }).toJSDate() };
}

/** Primera hora permitida del día siguiente (para mensajes que superan el tope diario). */
export function nextDayStart(ms: number, zone: string, q: QuietHours): number {
  const tomorrow = DateTime.fromMillis(ms, { zone }).plus({ days: 1 }).startOf("day");
  return nextAllowed(tomorrow.toMillis(), zone, q);
}

/** "HH:MM:SS" de PostgreSQL → "HH:MM". */
export const hhmm = (t: string) => t.slice(0, 5);

export function fmtLocal(ms: number | Date, zone: string) {
  const dt = (ms instanceof Date ? DateTime.fromJSDate(ms) : DateTime.fromMillis(ms)).setZone(zone).setLocale("es");
  const day = dt.toFormat("cccc d 'de' LLLL");
  return { date: day, time: dt.toFormat("HH:mm") };
}
