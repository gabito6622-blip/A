// Registro de ejecuciones de respaldo y simulacro (tabla global backup_runs, sin datos de pacientes)
// y utilidades para invocar pg_dump / pg_restore sin exponer la contraseña ni datos de filas.
import { spawn, type ChildProcess } from "node:child_process";
import { hostname } from "node:os";
import { join } from "node:path";
import type pg from "pg";

export type RunKind = "backup" | "verify";

/** Una ejecución «en curso» más vieja que esto se considera interrumpida (el proceso murió). */
export const STALE_RUN_HOURS = 6;

export async function startRun(pool: pg.Pool, kind: RunKind, now: Date): Promise<string> {
  await pool.query(
    `UPDATE backup_runs SET status = 'failed', finished_at = $2, error_summary = 'Interrumpido: el proceso terminó sin registrar el resultado'
      WHERE kind = $1 AND status = 'running' AND started_at < $2::timestamptz - make_interval(hours => $3)`,
    [kind, now, STALE_RUN_HOURS]);
  const r = await pool.query<{ id: string }>("INSERT INTO backup_runs (kind, started_at, host) VALUES ($1, $2, $3) RETURNING id", [kind, now, hostname().slice(0, 120)]);
  return r.rows[0]!.id;
}

export interface RunResult {
  backupName?: string | null;
  storage?: "local" | "s3" | null;
  encrypted?: boolean | null;
  sizeBytes?: number | null;
  sha256?: string | null;
  filesIncluded?: boolean | null;
  tablesCount?: number | null;
  rowsTotal?: number | null;
  prunedCount?: number | null;
  details?: Record<string, unknown>;
}

export async function finishRun(pool: pg.Pool, id: string, ok: boolean, res: RunResult, error: string | null, now: Date) {
  await pool.query(
    `UPDATE backup_runs SET status = $2, finished_at = $3, backup_name = $4, storage = $5, encrypted = $6, size_bytes = $7, sha256 = $8,
            files_included = $9, tables_count = $10, rows_total = $11, pruned_count = $12, details = $13, error_summary = $14
      WHERE id = $1`,
    [id, ok ? "ok" : "failed", now, res.backupName ?? null, res.storage ?? null, res.encrypted ?? null, res.sizeBytes ?? null, res.sha256 ?? null,
      res.filesIncluded ?? null, res.tablesCount ?? null, res.rowsTotal ?? null, res.prunedCount ?? null, JSON.stringify(res.details ?? {}),
      ok ? null : (error ?? "Error desconocido").slice(0, 500)]);
}

/**
 * Resumen de un error apto para el registro y las alertas: sin líneas DETAIL/CONTEXT/QUERY de
 * PostgreSQL (traen valores de filas, p. ej. «Key (document_number)=(1234567)»), sin URLs de
 * conexión y con 300 caracteres como máximo.
 */
export function summarizeError(e: unknown): string {
  const raw = e instanceof Error ? e.message : String(e ?? "Error desconocido");
  const lines = raw.split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l && !/^(?:pg_(?:dump|restore): )?(?:error: )?(?:DETAIL|DETALLE|CONTEXT|CONTEXTO|HINT|QUERY|STATEMENT|SENTENCIA|LINE \d+|L[IÍ]NEA \d+)\b/i.test(l))
    .filter((l) => !/^pg_restore: (?:from TOC entry|desde la entrada TOC)/i.test(l));
  return lines.join(" · ")
    .replace(/Key \([^)]*\)=\([^)]*\)/g, "Key (…)=(…)")
    .replace(/postgres(?:ql)?:\/\/\S+/gi, "postgres://[omitido]")
    .replace(/password=\S+/gi, "password=[omitido]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 300) || "Error desconocido";
}

// ---------------- pg_dump / pg_restore ----------------
/** Cadena de conexión sin contraseña + PGPASSWORD (la contraseña no queda en la lista de procesos). */
export function pgConn(url: string): { dbname: string; env: NodeJS.ProcessEnv } {
  const u = new URL(url);
  const password = decodeURIComponent(u.password);
  u.password = "";
  return { dbname: u.toString(), env: { ...process.env, ...(password ? { PGPASSWORD: password } : {}), PGCONNECT_TIMEOUT: "15" } };
}

export function pgBin(dir: string | null, name: "pg_dump" | "pg_restore") {
  return dir ? join(dir, name) : name;
}

/** Ejecuta un binario; el error lleva la salida de error RESUMIDA (ver summarizeError). */
export function spawnTool(bin: string, args: string[], env: NodeJS.ProcessEnv): { child: ChildProcess; done: Promise<void> } {
  const child = spawn(bin, args, { env, stdio: ["pipe", "pipe", "pipe"] });
  let stderr = "";
  child.stderr!.on("data", (d: Buffer) => { if (stderr.length < 20_000) stderr += d.toString(); });
  const done = new Promise<void>((resolve, reject) => {
    child.on("error", (e) => {
      reject(new Error((e as NodeJS.ErrnoException).code === "ENOENT"
        ? `No se encontró ${bin}. Instala el cliente de PostgreSQL (misma versión mayor que el servidor o más nueva) o indica su carpeta en BACKUP_PG_BIN`
        : `${bin}: ${e.message}`));
    });
    child.on("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${bin.split("/").pop()} terminó con error (${signal ?? code}): ${summarizeError(stderr)}`));
    });
  });
  return { child, done };
}
