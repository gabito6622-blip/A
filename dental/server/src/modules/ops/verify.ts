// Simulacro de restauración (npm run backup:verify).
//
// Toma el último juego de respaldo completo, comprueba su SHA-256, lo descifra en streaming, lo
// restaura en una base TEMPORAL `dental_restore_*` y verifica:
//   1. integridad (SHA-256 del archivo = manifiesto = .sha256), clave correcta y firma HMAC del
//      manifiesto (detecta un archivo alterado aunque se reescriban sus huellas);
//   2. migraciones completas (las mismas que tenía la base al respaldar, sin pendientes);
//   3. conteo de filas por tabla idéntico al registrado al respaldar;
//   4. una muestra de saldos con patient_money_v (huella idéntica);
//   5. RLS activo: toda tabla con clinic_id tiene RLS y dental_app sin clínica no ve pacientes;
//   6. el paquete de archivos clínicos (si hay): SHA-256, clave y cantidad de archivos.
// Registra el resultado en backup_runs (kind = verify) y SIEMPRE borra la base temporal.
import { randomBytes } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import pg from "pg";
import type { OpsConfig } from "./config.js";
import { readManifest, type Manifest } from "./backup.js";
import { BackupError, decryptor, manifestMacMatches, passphraseMatches, sha256File } from "./crypto.js";
import { collectFacts, diffCounts } from "./facts.js";
import { groupSets } from "./retention.js";
import { finishRun, pgBin, pgConn, spawnTool, startRun, summarizeError } from "./runs.js";
import { createBackupStorage, type BackupStorage } from "./storage.js";

export interface VerifyCheck { id: string; label: string; ok: boolean; detail: string }

export interface VerifyDeps {
  /** Pool del rol dueño de la base principal (donde se registra el resultado). */
  pool: pg.Pool;
  ops: OpsConfig;
  storage?: BackupStorage;
  now?: () => Date;
  log?: (m: string) => void;
  /** Verificar un juego concreto en lugar del último. */
  name?: string;
}

export interface VerifyOutcome { ok: boolean; runId: string; name: string | null; checks: VerifyCheck[]; error: string | null; restoreDb: string | null }

const DB_NAME_RE = /^dental_restore[a-z0-9_]{0,48}$/;

async function adminQuery(url: string, sql: string) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { await c.query(sql); } finally { await c.end(); }
}

async function expectedSha(path: string): Promise<string | null> {
  try { return (await readFile(path, "utf8")).trim().split(/\s+/)[0] ?? null; } catch { return null; }
}

export async function runVerify(deps: VerifyDeps): Promise<VerifyOutcome> {
  const { pool, ops } = deps;
  const now = deps.now ?? (() => new Date());
  const log = deps.log ?? (() => {});
  const runId = await startRun(pool, "verify", now());
  const started = Date.now();
  const checks: VerifyCheck[] = [];
  const outcome: VerifyOutcome = { ok: false, runId, name: null, checks, error: null, restoreDb: null };
  const check = (id: string, label: string, ok: boolean, detail: string) => { checks.push({ id, label, ok, detail }); log(`${ok ? "✔" : "✘"} ${label}: ${detail}`); return ok; };
  let tmp: string | null = null;
  let restoreDb: string | null = null;
  let manifest: Manifest | null = null;
  const storage = deps.storage ?? createBackupStorage(ops.backup.target);
  try {
    const sets = groupSets(await storage.list()).filter((s) => s.complete);
    const set = deps.name ? sets.find((s) => s.name === deps.name) : sets[0];
    if (!set) throw new BackupError("no_backup", deps.name ? `No existe el respaldo completo ${deps.name}` : `No hay respaldos completos en ${storage.label}`);
    outcome.name = set.name;
    tmp = await mkdtemp(join(tmpdir(), "dental-verify-"));
    const has = (f: string) => set.files.some((x) => x.name === f);
    await storage.download(`${set.name}.manifest.json`, join(tmp, "manifest.json"));
    manifest = readManifest(join(tmp, "manifest.json"));
    if (manifest.name !== set.name) throw new BackupError("bad_manifest", "El manifiesto no corresponde a este respaldo");
    log(`Simulacro de restauración de ${set.name} (${storage.label})…`);

    // ---- 1. Integridad y clave ----
    const dbPath = join(tmp, manifest.database.file);
    await storage.download(manifest.database.file, dbPath);
    const actual = await sha256File(dbPath);
    const sidecar = has(`${manifest.database.file}.sha256`) ? (await storage.download(`${manifest.database.file}.sha256`, join(tmp, "db.sha256")), await expectedSha(join(tmp, "db.sha256"))) : null;
    if (!check("integridad", "Integridad del archivo de la base", actual === manifest.database.sha256 && (sidecar === null || sidecar === actual),
      actual === manifest.database.sha256 ? "la huella SHA-256 coincide" : "la huella SHA-256 NO coincide con la registrada: el archivo está dañado o fue modificado")) {
      throw new BackupError("corrupt", "El respaldo está dañado: la huella SHA-256 del archivo de la base no coincide con la registrada");
    }
    const passphrase = ops.backup.passphrase;
    if (manifest.encrypted) {
      if (!passphrase) throw new BackupError("no_passphrase", "El respaldo está cifrado: define BACKUP_PASSPHRASE para verificarlo");
      const keyOk = await passphraseMatches(dbPath, passphrase, "dump");
      if (!check("clave", "Clave de descifrado", keyOk, keyOk ? "la clave descifra el respaldo" : "la clave no descifra este respaldo")) {
        throw new BackupError("wrong_passphrase", "La clave (BACKUP_PASSPHRASE) no corresponde a este respaldo");
      }
      // Firma del manifiesto: detecta un archivo alterado aunque alguien haya reescrito sus huellas.
      const macOk = await manifestMacMatches(passphrase, manifest, manifest.mac);
      if (!check("autenticidad", "Firma del respaldo", macOk, macOk ? "la firma con la clave del respaldo coincide" : "la firma NO coincide: el respaldo o su manifiesto fueron modificados")) {
        throw new BackupError("tampered", "El respaldo fue modificado: la firma del manifiesto no coincide con la clave del respaldo");
      }
    }

    // ---- 2. Restauración en una base temporal ----
    restoreDb = `${ops.backup.verifyDbPrefix}_${set.stamp.toLowerCase()}_${randomBytes(3).toString("hex")}`;
    if (!DB_NAME_RE.test(restoreDb)) throw new Error("Nombre de base temporal inválido");
    outcome.restoreDb = restoreDb;
    await adminQuery(ops.backup.verifyAdminUrl, `CREATE DATABASE "${restoreDb}"`);
    // El rol de la app debe existir en el servidor de destino (las políticas RLS y los GRANT lo nombran).
    await adminQuery(ops.backup.verifyAdminUrl, "DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dental_app') THEN CREATE ROLE dental_app NOLOGIN NOSUPERUSER NOBYPASSRLS; END IF; END $$");
    const restoreUrl = new URL(ops.backup.verifyAdminUrl);
    restoreUrl.pathname = `/${restoreDb}`;
    const conn = pgConn(restoreUrl.toString());
    const restore = spawnTool(pgBin(ops.backup.pgBinDir, "pg_restore"), ["--no-owner", "--exit-on-error", `--dbname=${conn.dbname}`], conn.env);
    const stages: Transform[] = manifest.encrypted ? [decryptor(passphrase!)] : [];
    // Si pg_restore se detiene antes de leerlo todo, la tubería se corta (EPIPE): el error útil es el suyo.
    const feed = pipeline([createReadStream(dbPath), ...stages, restore.child.stdin!]).catch((e) => e as Error);
    const restoreErr = await restore.done.then(() => null, (e: Error) => e);
    const feedErr = await feed;
    if (feedErr instanceof BackupError) throw feedErr;
    if (restoreErr) throw restoreErr;
    if (feedErr instanceof Error && (feedErr as NodeJS.ErrnoException).code !== "EPIPE") throw feedErr;
    check("restauracion", "Restauración en base temporal", true, `restaurado en ${restoreDb}`);

    // ---- 3 a 5. Verificaciones sobre la base restaurada ----
    const owner = new pg.Client({ connectionString: restoreUrl.toString() });
    await owner.connect();
    try {
      const facts = await collectFacts(owner, set.name);
      const sameMigrations = JSON.stringify(facts.migrations) === JSON.stringify(manifest.migrations);
      check("migraciones", "Migraciones completas", sameMigrations && manifest.pendingMigrations.length === 0,
        !sameMigrations ? "las migraciones restauradas no coinciden con las registradas al respaldar"
          : manifest.pendingMigrations.length ? `la base tenía migraciones pendientes al respaldar: ${manifest.pendingMigrations.join(", ")}`
            : `${facts.migrations.length} migraciones, todas aplicadas`);
      const diffs = diffCounts(manifest.tables, facts.tables);
      check("conteos", "Conteo de filas por tabla", diffs.length === 0,
        diffs.length ? `${diffs.length} tablas con diferencias: ${diffs.slice(0, 5).join("; ")}${diffs.length > 5 ? "…" : ""}`
          : `${Object.keys(facts.tables).length} tablas, ${Object.values(facts.tables).reduce((s, n) => s + n, 0)} filas: iguales a las registradas`);
      const b = manifest.balances;
      const sameBalances = facts.balances.sampleDigest === b.sampleDigest && facts.balances.aggregateDigest === b.aggregateDigest && facts.balances.patients === b.patients;
      check("saldos", "Muestra de saldos (patient_money_v)", sameBalances,
        sameBalances ? `${facts.balances.sampleSize} saldos de muestra y el total de ${facts.balances.patients} pacientes coinciden` : "los saldos restaurados no coinciden con los registrados al respaldar");

      const noRls = (await owner.query<{ t: string }>(
        `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
          WHERE n.nspname = 'public' AND c.relkind = 'r' AND NOT c.relrowsecurity AND c.relname <> 'sessions'
            AND EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid AND a.attname = 'clinic_id' AND NOT a.attisdropped) ORDER BY 1`)).rows.map((r) => r.t);
      const role = (await owner.query<{ bypass: boolean }>("SELECT rolbypassrls AS bypass FROM pg_roles WHERE rolname = 'dental_app'")).rows[0];
      const top = (await owner.query<{ clinic_id: string; n: number }>("SELECT clinic_id, count(*)::int AS n FROM patients GROUP BY 1 ORDER BY 2 DESC LIMIT 1")).rows[0];
      let hidden = 0;
      let visible = top?.n ?? 0;
      const app = new pg.Client({ connectionString: restoreUrl.toString(), options: "-c role=dental_app" });
      await app.connect();
      try {
        await app.query("BEGIN");
        await app.query("SELECT set_config('app.clinic_id', '', true), set_config('app.user_id', '', true)");
        hidden = (await app.query<{ n: number }>("SELECT count(*)::int AS n FROM patients")).rows[0]!.n;
        if (top) {
          await app.query("SELECT set_config('app.clinic_id', $1, true)", [top.clinic_id]);
          visible = (await app.query<{ n: number }>("SELECT count(*)::int AS n FROM patients")).rows[0]!.n;
        }
        await app.query("ROLLBACK");
      } finally { await app.end(); }
      const rlsOk = noRls.length === 0 && role?.bypass === false && hidden === 0 && visible === (top?.n ?? 0);
      check("rls", "Aislamiento por clínica (RLS)", rlsOk,
        rlsOk ? "RLS activo en todas las tablas con clinic_id; sin clínica no se ve ningún paciente y cada clínica ve solo los suyos"
          : noRls.length ? `tablas sin RLS: ${noRls.join(", ")}` : role?.bypass !== false ? "el rol dental_app no existe o salta RLS" : "dental_app ve pacientes que no le corresponden");
    } finally { await owner.end(); }

    // ---- 6. Archivos clínicos ----
    if (manifest.files) {
      const fPath = join(tmp, manifest.files.file);
      await storage.download(manifest.files.file, fPath);
      const fsha = await sha256File(fPath);
      let detail = "";
      let ok = fsha === manifest.files.sha256;
      if (!ok) detail = "la huella SHA-256 del paquete de archivos NO coincide";
      if (ok && manifest.encrypted && !(await passphraseMatches(fPath, passphrase!, "gzip"))) { ok = false; detail = "la clave no descifra el paquete de archivos"; }
      if (ok) {
        const list = spawnTool("tar", ["-tzf", "-"], process.env);
        let out = "";
        list.child.stdout!.on("data", (d: Buffer) => { out += d.toString(); });
        const feedFiles = pipeline([createReadStream(fPath), ...(manifest.encrypted ? [decryptor(passphrase!)] : []), list.child.stdin!]).catch((e) => e as Error);
        const tarErr = await list.done.then(() => null, (e: Error) => e);
        const fErr = await feedFiles;
        const entries = out.split("\n").filter((l) => l && !l.endsWith("/")).length;
        if (tarErr || fErr) { ok = false; detail = `el paquete de archivos no se puede leer: ${summarizeError(tarErr ?? fErr)}`; }
        else if (entries !== manifest.files.entries) { ok = false; detail = `el paquete tiene ${entries} archivos y se registraron ${manifest.files.entries}`; }
        else detail = `${entries} archivos clínicos legibles`;
      }
      check("archivos", "Paquete de archivos clínicos", ok, detail);
    }

    const failed = checks.filter((c) => !c.ok);
    outcome.ok = failed.length === 0;
    if (!outcome.ok) outcome.error = summarizeError(`Falló: ${failed.map((c) => `${c.label} (${c.detail})`).join("; ")}`);
  } catch (e) {
    outcome.error = summarizeError(e);
    if (!checks.some((c) => !c.ok)) check("error", "Simulacro", false, outcome.error);
  } finally {
    if (restoreDb) await adminQuery(ops.backup.verifyAdminUrl, `DROP DATABASE IF EXISTS "${restoreDb}" WITH (FORCE)`).catch((e) => log(`Aviso: no se pudo borrar la base temporal ${restoreDb}: ${summarizeError(e)}`));
    if (tmp) await rm(tmp, { recursive: true, force: true }).catch(() => {});
  }
  await finishRun(pool, runId, outcome.ok, {
    backupName: outcome.name, storage: storage.kind, encrypted: manifest?.encrypted ?? null, sizeBytes: manifest ? manifest.database.sizeBytes + (manifest.files?.sizeBytes ?? 0) : null,
    sha256: manifest?.database.sha256 ?? null, filesIncluded: manifest ? !!manifest.files : null,
    tablesCount: manifest ? Object.keys(manifest.tables).length : null, rowsTotal: manifest ? Object.values(manifest.tables).reduce((s, n) => s + n, 0) : null,
    details: { checks, durationMs: Date.now() - started, restoreDb, backupCreatedAt: manifest?.createdAt ?? null },
  }, outcome.error, now());
  log(outcome.ok ? `Simulacro correcto: ${outcome.name} se restauró y verificó.` : `Simulacro FALLIDO: ${outcome.error}`);
  return outcome;
}

