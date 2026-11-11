// Retención de respaldos (abuelo-padre-hijo): se conserva el más reciente de cada uno de los
// últimos N días, M semanas y K meses que tienen respaldo (por defecto 7/4/12), contados en la zona
// de la clínica. Nunca se borra el respaldo completo más reciente. Un juego sin manifiesto (subida
// interrumpida) no cuenta como válido y se borra pasadas `incompleteMaxAgeHours`.
import { DateTime } from "luxon";
import type { RetentionPolicy } from "./config.js";
import { BACKUP_FILE_RE, type BackupObject } from "./storage.js";

export const ZONE = "America/La_Paz";

export interface BackupSet {
  /** dental-AAAAMMDDTHHMMSSZ */
  name: string;
  stamp: string;
  date: Date;
  files: BackupObject[];
  sizeBytes: number;
  /** Tiene manifiesto (se escribe al final: el juego se subió completo). */
  complete: boolean;
}

export const stampOf = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
export function parseStamp(stamp: string): Date {
  const m = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})Z$/.exec(stamp);
  if (!m) throw new Error(`Marca de tiempo inválida: ${stamp}`);
  return new Date(Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +m[6]!));
}

export function groupSets(objects: BackupObject[]): BackupSet[] {
  const by = new Map<string, BackupSet>();
  for (const o of objects) {
    const m = BACKUP_FILE_RE.exec(o.name);
    if (!m) continue;
    const stamp = m[1]!;
    let s = by.get(stamp);
    if (!s) { s = { name: `dental-${stamp}`, stamp, date: parseStamp(stamp), files: [], sizeBytes: 0, complete: false }; by.set(stamp, s); }
    s.files.push(o);
    if (!o.name.endsWith(".sha256") && !o.name.endsWith(".manifest.json")) s.sizeBytes += o.size;
    if (o.name === `dental-${stamp}.manifest.json`) s.complete = true;
  }
  return [...by.values()].sort((a, b) => b.date.getTime() - a.date.getTime());
}

export interface RetentionPlan {
  keep: { set: BackupSet; reasons: string[] }[];
  remove: { set: BackupSet; reason: string }[];
}

export function planRetention(sets: BackupSet[], policy: RetentionPolicy, now: Date, opts: { incompleteMaxAgeHours?: number; zone?: string } = {}): RetentionPlan {
  const zone = opts.zone ?? ZONE;
  const maxIncomplete = (opts.incompleteMaxAgeHours ?? 48) * 3600_000;
  const sorted = [...sets].sort((a, b) => b.date.getTime() - a.date.getTime());
  const complete = sorted.filter((s) => s.complete);
  const reasons = new Map<string, string[]>();
  const mark = (s: BackupSet, r: string) => { const l = reasons.get(s.stamp) ?? []; l.push(r); reasons.set(s.stamp, l); };

  const bucket = (n: number, label: string, keyOf: (d: DateTime) => string) => {
    const seen = new Set<string>();
    for (const s of complete) {
      if (seen.size >= n) break;
      const k = keyOf(DateTime.fromJSDate(s.date, { zone }));
      if (seen.has(k)) continue;
      seen.add(k);
      mark(s, `${label} ${k}`);
    }
  };
  bucket(policy.daily, "diario", (d) => d.toISODate()!);
  bucket(policy.weekly, "semanal", (d) => `${d.weekYear}-S${String(d.weekNumber).padStart(2, "0")}`);
  bucket(policy.monthly, "mensual", (d) => d.toFormat("yyyy-MM"));
  // Nunca el más reciente válido (aunque la política tuviera 0 en todo).
  if (complete[0]) mark(complete[0], "el más reciente");

  const plan: RetentionPlan = { keep: [], remove: [] };
  for (const s of sorted) {
    const r = reasons.get(s.stamp);
    if (r) { plan.keep.push({ set: s, reasons: r }); continue; }
    if (!s.complete) {
      // Incompleto: puede ser una subida en curso; solo se descarta cuando es viejo.
      if (now.getTime() - s.date.getTime() < maxIncomplete) plan.keep.push({ set: s, reasons: ["incompleto reciente (puede estar subiéndose)"] });
      else plan.remove.push({ set: s, reason: "incompleto (sin manifiesto) y antiguo" });
      continue;
    }
    plan.remove.push({ set: s, reason: "fuera de la política de retención" });
  }
  return plan;
}
