// Citas recurrentes: generación de ocurrencias (función pura, probada de forma aislada).
// Todo se calcula en la hora local de la clínica: "cada mes a las 10:00" sigue siendo 10:00.
import { DateTime } from "luxon";

export const MAX_OCCURRENCES = 52;

export interface RecurrenceRule {
  frequency: "weekly" | "monthly";
  /** Cada N semanas (1–26) o N meses (1–12). */
  interval: number;
  /** N veces (incluye la primera)… */
  count?: number | null;
  /** …o hasta esta fecha local inclusive (AAAA-MM-DD). */
  until?: string | null;
}

export class RecurrenceError extends Error {}

/**
 * Inicios de cada ocurrencia (ISO UTC). Cada una se calcula desde la primera, no desde la anterior:
 * una serie mensual que empieza el 31 cae el último día de los meses cortos y vuelve al 31 después.
 * Nunca recorta en silencio: si la regla produce más de 52 citas, lanza un error con la cantidad.
 */
export function generateOccurrences(firstStartISO: string, zone: string, rule: RecurrenceRule): string[] {
  const first = DateTime.fromISO(firstStartISO, { zone });
  if (!first.isValid) throw new RecurrenceError("Fecha de inicio inválida");
  const maxInterval = rule.frequency === "weekly" ? 26 : 12;
  if (!Number.isInteger(rule.interval) || rule.interval < 1 || rule.interval > maxInterval) {
    throw new RecurrenceError(rule.frequency === "weekly" ? "El intervalo debe ser de 1 a 26 semanas" : "El intervalo debe ser de 1 a 12 meses");
  }
  const hasCount = rule.count != null;
  const hasUntil = !!rule.until;
  if (hasCount === hasUntil) throw new RecurrenceError("Indica cuántas veces se repite o hasta qué fecha, no ambas");
  if (hasCount && (!Number.isInteger(rule.count) || rule.count! < 1 || rule.count! > MAX_OCCURRENCES)) {
    throw new RecurrenceError(`La serie puede tener de 1 a ${MAX_OCCURRENCES} citas`);
  }
  const step = (k: number) => (rule.frequency === "weekly" ? first.plus({ weeks: k * rule.interval }) : first.plus({ months: k * rule.interval }));
  const out: string[] = [];
  if (hasCount) {
    for (let k = 0; k < rule.count!; k++) out.push(step(k).toUTC().toISO()!);
    return out;
  }
  const until = DateTime.fromISO(rule.until!, { zone }).endOf("day");
  if (!until.isValid) throw new RecurrenceError("Fecha límite inválida");
  if (until < first) throw new RecurrenceError("La fecha límite es anterior a la primera cita");
  for (let k = 0; ; k++) {
    const t = step(k);
    if (t > until) break;
    if (out.length === MAX_OCCURRENCES) {
      let total = out.length;
      while (step(total) <= until) total++;
      throw new RecurrenceError(`Con esa fecha límite la serie tendría ${total} citas; el máximo es ${MAX_OCCURRENCES}. Acorta la fecha o usa un intervalo mayor.`);
    }
    out.push(t.toUTC().toISO()!);
  }
  return out;
}

/**
 * Traslada una ocurrencia según el cambio hecho en otra de la misma serie ("esta y las siguientes"):
 * mismos días de diferencia y la nueva hora local.
 */
export function shiftLike(occurrenceISO: string, fromISO: string, toISO: string, zone: string): string {
  const from = DateTime.fromISO(fromISO, { zone });
  const to = DateTime.fromISO(toISO, { zone });
  const days = Math.round(to.startOf("day").diff(from.startOf("day"), "days").days);
  const occ = DateTime.fromISO(occurrenceISO, { zone });
  return occ.plus({ days }).set({ hour: to.hour, minute: to.minute, second: 0, millisecond: 0 }).toUTC().toISO()!;
}
