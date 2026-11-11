// Respaldo programado (npm run backup:run).
//
// Juego de respaldo `dental-AAAAMMDDTHHMMSSZ` (mismo formato que scripts/backup.sh):
//   dental-<s>.dump[.enc] + .sha256        pg_dump --format=custom --no-owner, cifrado AES-256-CBC
//                                          PBKDF2 200 000 (openssl enc) → scripts/restore.sh lo restaura
//   dental-files-<s>.tar.gz[.enc] + .sha256 archivos clínicos en disco (si los hay), empaquetados
//                                          DESPUÉS de la base: toda fila respaldada tiene su archivo
//   dental-<s>.manifest.json               se sube AL FINAL: conteos por tabla, migraciones y huella de
//                                          una muestra de saldos (sin datos de pacientes)
// Los conteos y el volcado salen de la MISMA instantánea (pg_export_snapshot + pg_dump --snapshot),
// así el simulacro puede exigir conteos idénticos aunque la base reciba escrituras mientras tanto.
import { readdirSync, readFileSync } from "node:fs";
import { mkdtemp, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { Readable } from "node:stream";
import type pg from "pg";
import { MIGRATIONS_DIR } from "../../lib/migrate.js";
import type { OpsConfig } from "./config.js";
import { BackupError, writeMaybeEncrypted } from "./crypto.js";
import { collectFacts, type DbFacts } from "./facts.js";
import { groupSets, planRetention, stampOf } from "./retention.js";
import { finishRun, pgBin, pgConn, spawnTool, startRun, summarizeError, type RunResult } from "./runs.js";
import { createBackupStorage, type BackupStorage } from "./storage.js";

export const CIPHER_LABEL = "openssl enc -aes-256-cbc -pbkdf2 -iter 200000 -salt (PBKDF2-HMAC-SHA256)";

export interface Manifest {
  format: 1;
  kind: "dentalia-backup";
  name: string;
  createdAt: string;
  app: { version: string; commit: string | null };
  encrypted: boolean;
  cipher: string | null;
  database: { file: string; sizeBytes: number; sha256: string; serverVersion: string };
  files: { file: string; sizeBytes: number; sha256: string; entries: number } | null;
  filesNote: string | null;
  migrations: DbFacts["migrations"];
  /** Migraciones del código que la base aún no tenía al respaldar. */
  pendingMigrations: string[];
  tables: DbFacts["tables"];
  balances: DbFacts["balances"];
}

export interface BackupDeps {
  /** Pool del rol dueño de la base a respaldar (registra la ejecución en backup_runs). */
  pool: pg.Pool;
  ops: OpsConfig;
  storage?: BackupStorage;
  now?: () => Date;
  log?: (m: string) => void;
  /** Pruebas: carpeta de archivos clínicos distinta de la configurada. */
  filesDir?: string;
}

export interface BackupOutcome {
  ok: boolean;
  runId: string;
  name: string | null;
  sizeBytes: number;
  sha256: string | null;
  filesIncluded: boolean;
  pruned: string[];
  error: string | null;
}

export function migrationFiles(): string[] {
  return readdirSync(MIGRATIONS_DIR).filter((f) => /^\d{4}_.+\.sql$/.test(f)).sort();
}

async function listFiles(root: string): Promise<string[] | null> {
  const out: string[] = [];
  const walk = async (dir: string) => {
    for (const e of await readdir(dir, { withFileTypes: true })) {
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile()) out.push(relative(root, p));
    }
  };
  try { await walk(root); } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw e;
  }
  return out.sort();
}

export async function runBackup(deps: BackupDeps): Promise<BackupOutcome> {
  const { pool, ops } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const passphrase = ops.backup.passphrase;
  const runId = await startRun(pool, "backup", now());
  const result: RunResult = { storage: ops.backup.target.kind, encrypted: !!passphrase };
  const outcome: BackupOutcome = { ok: false, runId, name: null, sizeBytes: 0, sha256: null, filesIncluded: false, pruned: [], error: null };
  let tmp: string | null = null;
  try {
    if (ops.isProduction && !passphrase) {
      throw new BackupError("no_passphrase", "Falta BACKUP_PASSPHRASE: en producción los respaldos deben ir cifrados. Defínela (y guárdala fuera del servidor y de los respaldos) y vuelve a ejecutar.");
    }
    if (passphrase && ops.isProduction && passphrase.length < 16) {
      throw new BackupError("weak_passphrase", "BACKUP_PASSPHRASE es demasiado corta: usa al menos 16 caracteres (p. ej. openssl rand -base64 32).");
    }
    const storage = deps.storage ?? createBackupStorage(ops.backup.target);
    const started = now();
    const stamp = stampOf(started);
    const name = `dental-${stamp}`;
    result.backupName = name;
    outcome.name = name;
    tmp = await mkdtemp(join(tmpdir(), "dental-bk-"));
    const ext = passphrase ? ".dump.enc" : ".dump";
    const dbFile = `${name}${ext}`;
    log(`Respaldo ${name}: volcando la base…`);

    // ---- Base de datos: hechos + volcado desde la misma instantánea ----
    const snap = await pool.connect();
    let facts: DbFacts;
    let serverVersion: string;
    let db: { size: number; sha256: string };
    try {
      await snap.query("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY");
      const snapshotId = (await snap.query<{ s: string }>("SELECT pg_export_snapshot() AS s")).rows[0]!.s;
      serverVersion = (await snap.query<{ v: string }>("SHOW server_version")).rows[0]!.v;
      facts = await collectFacts(snap, name);
      const conn = pgConn(ops.databaseUrl);
      const dump = spawnTool(pgBin(ops.backup.pgBinDir, "pg_dump"), ["--format=custom", "--no-owner", `--snapshot=${snapshotId}`, `--dbname=${conn.dbname}`], conn.env);
      dump.child.stdin!.end();
      const [w] = await Promise.all([writeMaybeEncrypted(dump.child.stdout as Readable, join(tmp, dbFile), passphrase), dump.done]);
      db = w;
      await snap.query("COMMIT");
    } catch (e) {
      await snap.query("ROLLBACK").catch(() => {});
      throw e;
    } finally { snap.release(); }
    await writeFile(join(tmp, `${dbFile}.sha256`), `${db.sha256}  ${dbFile}\n`, { mode: 0o600 });

    // ---- Archivos clínicos en disco (después de la base) ----
    const filesDir = deps.filesDir ?? ops.filesDir;
    let files: Manifest["files"] = null;
    let filesNote: string | null = null;
    const list = await listFiles(filesDir);
    if (ops.filesDriver === "s3") filesNote = "Los archivos clínicos están en S3: su respaldo es el versionado del bucket.";
    if (list && (ops.filesDriver === "local" || list.length > 0)) {
      if (ops.filesDriver === "s3") filesNote += " Quedaban archivos antiguos en disco: se empaquetaron también.";
      const farFile = `dental-files-${stamp}.tar.gz${passphrase ? ".enc" : ""}`;
      log(`Respaldo ${name}: empaquetando ${list.length} archivos clínicos…`);
      const tar = spawnTool("tar", ["-C", filesDir, "-czf", "-", "--null", "-T", "-"], process.env);
      tar.child.stdin!.end(Buffer.from(list.map((f) => `${f}\0`).join("")));
      const [w] = await Promise.all([writeMaybeEncrypted(tar.child.stdout as Readable, join(tmp, farFile), passphrase), tar.done]);
      await writeFile(join(tmp, `${farFile}.sha256`), `${w.sha256}  ${farFile}\n`, { mode: 0o600 });
      files = { file: farFile, sizeBytes: w.size, sha256: w.sha256, entries: list.length };
    } else if (!list && ops.filesDriver === "local") {
      filesNote = "La carpeta de archivos clínicos no existe todavía: no había archivos que respaldar.";
    }

    // ---- Manifiesto ----
    const applied = new Set(facts.migrations.map((m) => m.name));
    const manifest: Manifest = {
      format: 1, kind: "dentalia-backup", name, createdAt: started.toISOString(),
      app: { version: ops.version, commit: ops.commit },
      encrypted: !!passphrase, cipher: passphrase ? CIPHER_LABEL : null,
      database: { file: dbFile, sizeBytes: db.size, sha256: db.sha256, serverVersion },
      files, filesNote,
      migrations: facts.migrations,
      pendingMigrations: migrationFiles().filter((f) => !applied.has(f)),
      tables: facts.tables,
      balances: facts.balances,
    };
    await writeFile(join(tmp, `${name}.manifest.json`), JSON.stringify(manifest, null, 2), { mode: 0o600 });

    // ---- Subida (manifiesto al final: marca el juego como completo) ----
    log(`Respaldo ${name}: guardando en ${storage.label}…`);
    const uploads = [dbFile, `${dbFile}.sha256`, ...(files ? [files.file, `${files.file}.sha256`] : []), `${name}.manifest.json`];
    for (const f of uploads) await storage.upload(f, join(tmp, f));

    outcome.sizeBytes = db.size + (files?.sizeBytes ?? 0);
    outcome.sha256 = db.sha256;
    outcome.filesIncluded = !!files;
    Object.assign(result, {
      sizeBytes: outcome.sizeBytes, sha256: db.sha256, filesIncluded: !!files, tablesCount: Object.keys(facts.tables).length,
      rowsTotal: Object.values(facts.tables).reduce((s, n) => s + n, 0),
    });
    const details: Record<string, unknown> = { databaseBytes: db.size, filesBytes: files?.sizeBytes ?? 0, filesEntries: files?.entries ?? 0, filesNote, target: storage.label, migrations: facts.migrations.length };

    // ---- Retención ----
    if (ops.backup.prune) {
      try {
        outcome.pruned = await pruneBackups(storage, ops, now(), log);
        result.prunedCount = outcome.pruned.length;
        details.pruned = outcome.pruned;
      } catch (e) {
        details.pruneError = summarizeError(e);
        log(`Aviso: no se pudo aplicar la retención: ${details.pruneError}`);
      }
    }
    result.details = details;
    await finishRun(pool, runId, true, result, null, now());
    outcome.ok = true;
    log(`Respaldo ${name} completo (${(outcome.sizeBytes / 1024 / 1024).toFixed(1)} MB${files ? `, ${files.entries} archivos clínicos` : ""}).`);
    return outcome;
  } catch (e) {
    outcome.error = summarizeError(e);
    await finishRun(pool, runId, false, result, outcome.error, now()).catch(() => {});
    log(`El respaldo falló: ${outcome.error}`);
    return outcome;
  } finally {
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
}

/** Aplica la política de retención: borra solo juegos descartados, dentro del destino propio. */
export async function pruneBackups(storage: BackupStorage, ops: OpsConfig, now: Date, log: (m: string) => void = () => {}): Promise<string[]> {
  const sets = groupSets(await storage.list());
  const plan = planRetention(sets, ops.backup.retention, now, { incompleteMaxAgeHours: ops.backup.incompleteMaxAgeHours });
  const removed: string[] = [];
  for (const { set, reason } of plan.remove) {
    // El manifiesto primero: si el borrado se corta, el juego queda «incompleto», nunca «completo» a medias.
    const files = [...set.files].sort((a, b) => Number(b.name.endsWith(".manifest.json")) - Number(a.name.endsWith(".manifest.json")));
    for (const f of files) await storage.remove(f.name);
    removed.push(set.name);
    log(`Retención: borrado ${set.name} (${reason}).`);
  }
  return removed;
}

export function readManifest(path: string): Manifest {
  const m = JSON.parse(readFileSync(path, "utf8")) as Manifest;
  if (m.format !== 1 || m.kind !== "dentalia-backup" || !m.database?.file || !m.tables) throw new BackupError("bad_manifest", "El manifiesto del respaldo no tiene el formato esperado");
  return m;
}
