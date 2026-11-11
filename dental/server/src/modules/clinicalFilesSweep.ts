// Barrido de archivos huérfanos del almacenamiento de archivos clínicos (B-081).
//
// Compara lo que hay en el almacenamiento (disco o bucket S3) con lo que la base referencia
// (clinical_files y clinical_file_thumbs, de todas las clínicas: corre con el rol dueño):
//   * huérfanos: objetos sin fila. Pasan cuando una subida se cortó entre guardar los bytes y el
//     COMMIT (el servidor intenta borrarlos, pero un corte de luz no avisa).
//   * faltantes: filas cuyo objeto no está (archivo perdido: hay que restaurarlo del respaldo).
//   * ajenos: objetos con un nombre que no es una clave de Dentalia (temporales, otras apps).
// Por defecto es una SIMULACIÓN (--dry-run): solo informa. Con --apply borra únicamente huérfanos
// con clave válida y más de 24 horas, y antes de borrar cada uno vuelve a confirmar en la base que
// nadie lo referencia. Nunca borra filas (son de solo inserción) ni objetos ajenos.
import type pg from "pg";
import { KEY_RE, type FileStore } from "../lib/filestore.js";

export const SWEEP_MIN_AGE_HOURS = 24;

export interface SweepOrphan { key: string; sizeBytes: number; modifiedAt: string; ageHours: number; deletable: boolean }
export interface SweepMissing { table: "clinical_files" | "clinical_file_thumbs"; id: string; clinicId: string; key: string }
export interface SweepReport {
  mode: "dry-run" | "apply";
  driver: string;
  minAgeHours: number;
  scanned: number;
  referenced: number;
  orphans: SweepOrphan[];
  missing: SweepMissing[];
  foreign: string[];
  deleted: string[];
  /** Filas guardadas con otro controlador (no se revisan en este barrido). */
  otherDriverRows: number;
}

const REFERENCED_SQL = `
  SELECT 'clinical_files' AS t, id, clinic_id, storage_key, storage_driver FROM clinical_files
  UNION ALL
  SELECT 'clinical_file_thumbs', id, clinic_id, storage_key, storage_driver FROM clinical_file_thumbs`;

export async function sweepFiles(
  pool: pg.Pool, store: FileStore,
  opts: { apply?: boolean; now?: Date; minAgeHours?: number } = {},
): Promise<SweepReport> {
  const now = opts.now ?? new Date();
  // Nunca menos de 24 h: una subida en curso guarda los bytes antes de su fila.
  const minAgeHours = Math.max(SWEEP_MIN_AGE_HOURS, opts.minAgeHours ?? SWEEP_MIN_AGE_HOURS);
  const rows = (await pool.query<{ t: SweepMissing["table"]; id: string; clinic_id: string; storage_key: string; storage_driver: string }>(REFERENCED_SQL)).rows;
  const mine = rows.filter((r) => r.storage_driver === store.driver);
  const referenced = new Set(mine.map((r) => r.storage_key));
  const allKeys = new Set(rows.map((r) => r.storage_key));

  const seen = new Set<string>();
  const orphans: SweepOrphan[] = [];
  const foreign: string[] = [];
  let scanned = 0;
  for await (const o of store.list()) {
    scanned++;
    seen.add(o.key);
    if (!KEY_RE.test(o.key)) { foreign.push(o.key); continue; }
    if (referenced.has(o.key) || allKeys.has(o.key)) continue;
    const ageHours = Math.floor(((now.getTime() - o.modifiedAt.getTime()) / 3_600_000) * 10) / 10;
    orphans.push({ key: o.key, sizeBytes: o.size, modifiedAt: o.modifiedAt.toISOString(), ageHours, deletable: ageHours >= minAgeHours });
  }
  const missing: SweepMissing[] = mine.filter((r) => !seen.has(r.storage_key)).map((r) => ({ table: r.t, id: r.id, clinicId: r.clinic_id, key: r.storage_key }));

  const deleted: string[] = [];
  if (opts.apply) {
    for (const o of orphans) {
      if (!o.deletable) continue;
      // Segunda verificación justo antes de borrar (una fila pudo aparecer durante el barrido).
      const still = await pool.query(
        "SELECT 1 FROM clinical_files WHERE storage_key = $1 UNION ALL SELECT 1 FROM clinical_file_thumbs WHERE storage_key = $1 LIMIT 1", [o.key]);
      if (still.rowCount) continue;
      await store.remove(o.key);
      deleted.push(o.key);
    }
  }
  return {
    mode: opts.apply ? "apply" : "dry-run", driver: store.driver, minAgeHours, scanned, referenced: referenced.size,
    orphans, missing, foreign, deleted, otherDriverRows: rows.length - mine.length,
  };
}

const fmtBytes = (n: number) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`).replace(".", ",");

/** Resumen en español para la consola. */
export function formatSweepReport(r: SweepReport): string {
  const lines: string[] = [];
  lines.push(`Barrido de archivos clínicos (${r.driver === "s3" ? "almacenamiento S3" : "disco"}) — ${r.mode === "apply" ? "MODO BORRAR (--apply)" : "simulación: no se borra nada"}`);
  lines.push(`Objetos revisados: ${r.scanned} · Referenciados por la base: ${r.referenced}`);
  const deletable = r.orphans.filter((o) => o.deletable);
  lines.push(`Huérfanos (sin fila en la base): ${r.orphans.length} — ${deletable.length} con más de ${r.minAgeHours} h (${fmtBytes(deletable.reduce((s, o) => s + o.sizeBytes, 0))})`);
  for (const o of r.orphans.slice(0, 50)) lines.push(`  ${o.deletable ? "•" : "·"} ${o.key} (${fmtBytes(o.sizeBytes)}, ${o.ageHours} h)${o.deletable ? "" : " — reciente: se conserva"}`);
  if (r.orphans.length > 50) lines.push(`  … y ${r.orphans.length - 50} más`);
  if (r.mode === "apply") lines.push(`Borrados: ${r.deleted.length}`);
  else if (deletable.length) lines.push("Para borrarlos, vuelve a ejecutar con --apply.");
  lines.push(`Filas sin archivo en el almacenamiento: ${r.missing.length}${r.missing.length ? " — restáuralos desde el respaldo:" : ""}`);
  for (const m of r.missing.slice(0, 50)) lines.push(`  ! ${m.table === "clinical_files" ? "archivo" : "miniatura"} ${m.id} (clínica ${m.clinicId}) → ${m.key}`);
  if (r.foreign.length) lines.push(`Objetos ajenos (no son claves de Dentalia; nunca se borran): ${r.foreign.length}`);
  if (r.otherDriverRows) lines.push(`Filas guardadas con otro controlador (no revisadas en este barrido): ${r.otherDriverRows}`);
  return lines.join("\n");
}
