// Respaldo programado y simulacro de restauración (Equipo V), de punta a punta con una base PEQUEÑA
// propia (dental_restore_v_src) y pg_dump/pg_restore reales:
//  * respaldo cifrado (formato de scripts/backup.sh) con archivos clínicos, a carpeta local y a un
//    S3 FALSO (127.0.0.1) bajo su prefijo; manifiesto con conteos y huella de saldos;
//  * el simulacro restaura en dental_restore_v_*, verifica migraciones, conteos, saldos y RLS, registra
//    el resultado y borra la base temporal; detecta un respaldo dañado y una clave equivocada;
//  * scripts/restore.sh restaura un respaldo hecho por la CLI (compatibilidad de formato);
//  * en producción, sin BACKUP_PASSPHRASE, falla con un mensaje claro y queda registrado.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { loadConfig } from "../server/src/config.js";
import { createDb, type Db } from "../server/src/lib/db.js";
import { migrate } from "../server/src/lib/migrate.js";
import { buildApp } from "../server/src/app.js";
import { MemoryMailer } from "../server/src/lib/mailer.js";
import { loadOpsConfig, type OpsConfig } from "../server/src/modules/ops/config.js";
import { runBackup } from "../server/src/modules/ops/backup.js";
import { runVerify } from "../server/src/modules/ops/verify.js";
import { LocalBackupStorage, S3BackupStorage } from "../server/src/modules/ops/storage.js";
import { createClinic, createPatient, login } from "./helpers.js";
import { startFakeS3, type FakeS3 } from "./fake-s3.js";

const hasTools = ["pg_dump", "pg_restore", "tar"].every((b) => spawnSync(b, ["--version"]).status === 0) && spawnSync("openssl", ["version"]).status === 0;
const base = new URL(process.env.DATABASE_URL!);
const urlFor = (name: string) => { const u = new URL(base); u.pathname = `/${name}`; return u.toString(); };
const SRC = "dental_restore_v_src";
const admin = urlFor("postgres");
const PASS = "frase-de-prueba-larga-0123456789";

async function sql(url: string, q: string, p: unknown[] = []) {
  const c = new pg.Client({ connectionString: url });
  await c.connect();
  try { return (await c.query(q, p)).rows; } finally { await c.end(); }
}
const restoreDbs = async () => (await sql(admin, "SELECT datname FROM pg_database WHERE datname LIKE 'dental_restore_v\\_%' AND datname <> $1", [SRC])).map((r) => r.datname as string);

let db: Db;
let work: string;
let filesDir: string;
let clinicA = "";
let clock = new Date("2026-11-10T07:15:00Z");
const now = () => clock;

function opsFor(over: { dir?: string; passphrase?: string | null; production?: boolean } = {}): OpsConfig {
  const cfg = loadConfig({ ...process.env, DATABASE_URL: urlFor(SRC), DENTAL_FILES_DIR: filesDir, NODE_ENV: "development" });
  const ops = loadOpsConfig(cfg, { BACKUP_DIR: over.dir ?? join(work, "respaldos"), BACKUP_VERIFY_DB_PREFIX: "dental_restore_v", BACKUP_STORAGE: "local" });
  ops.backup.passphrase = over.passphrase === undefined ? PASS : over.passphrase;
  ops.isProduction = !!over.production;
  return ops;
}

describe.skipIf(!hasTools)("respaldo programado y simulacro de restauración", () => {
  beforeAll(async () => {
    await sql(admin, `DROP DATABASE IF EXISTS ${SRC} WITH (FORCE)`);
    await sql(admin, `CREATE DATABASE ${SRC}`);
    db = createDb(urlFor(SRC));
    await migrate(db.adminPool);
    work = mkdtempSync(join(tmpdir(), "ops-v-"));
    filesDir = join(work, "archivos");
    // Base pequeña: 2 clínicas, pacientes con saldo inicial y 2 archivos clínicos «en disco».
    const cfg = loadConfig({ ...process.env, DATABASE_URL: urlFor(SRC) });
    const app = await buildApp(cfg, db, { mailer: new MemoryMailer() });
    await app.ready();
    const A = await createClinic(db);
    const B = await createClinic(db);
    clinicA = A.clinicId;
    for (const K of [A, B]) {
      const owner = await login(app, K.ownerEmail);
      for (let i = 0; i < 4; i++) {
        const pid = await createPatient(owner, { firstName: `Saldo${i}` });
        await db.adminPool.query("INSERT INTO opening_balances (clinic_id, patient_id, amount_cents, cutoff_date, created_by) VALUES ($1,$2,$3,'2026-01-31',$4)", [K.clinicId, pid, (i + 1) * 1050, K.ownerId]);
      }
    }
    await app.close();
    mkdirSync(join(filesDir, A.clinicId, "2026"), { recursive: true });
    writeFileSync(join(filesDir, A.clinicId, "2026", "a".repeat(32)), Buffer.from("radiografía ficticia"));
    writeFileSync(join(filesDir, A.clinicId, "2026", "b".repeat(32)), Buffer.from("foto ficticia"));
  }, 120_000);

  afterAll(async () => {
    await db?.close();
    for (const d of await restoreDbs()) await sql(admin, `DROP DATABASE IF EXISTS "${d}" WITH (FORCE)`);
    await sql(admin, `DROP DATABASE IF EXISTS ${SRC} WITH (FORCE)`);
    if (work) rmSync(work, { recursive: true, force: true });
  });

  it("en producción sin BACKUP_PASSPHRASE falla con un mensaje claro y queda registrado", async () => {
    const out = await runBackup({ pool: db.adminPool, ops: opsFor({ passphrase: null, production: true }), now });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Falta BACKUP_PASSPHRASE/);
    const run = (await db.adminPool.query("SELECT status, error_summary FROM backup_runs WHERE id = $1", [out.runId])).rows[0];
    expect(run).toEqual({ status: "failed", error_summary: expect.stringMatching(/cifrados/) });
    expect(readdirSafe(join(work, "respaldos"))).toEqual([]);
  });

  let first = "";
  it("respaldo cifrado con archivos clínicos, manifiesto y registro de la ejecución", async () => {
    const out = await runBackup({ pool: db.adminPool, ops: opsFor(), now });
    expect(out.error).toBeNull();
    expect(out.ok).toBe(true);
    first = out.name!;
    expect(first).toBe("dental-20261110T071500Z");
    const files = readdirSafe(join(work, "respaldos"));
    expect(files).toEqual([
      "dental-20261110T071500Z.dump.enc", "dental-20261110T071500Z.dump.enc.sha256", "dental-20261110T071500Z.manifest.json",
      "dental-files-20261110T071500Z.tar.gz.enc", "dental-files-20261110T071500Z.tar.gz.enc.sha256",
    ]);
    const dump = readFileSync(join(work, "respaldos", "dental-20261110T071500Z.dump.enc"));
    expect(dump.subarray(0, 8).toString("latin1")).toBe("Salted__"); // formato openssl enc
    expect(dump.includes(Buffer.from("Saldo0"))).toBe(false);          // nada en claro
    const m = JSON.parse(readFileSync(join(work, "respaldos", "dental-20261110T071500Z.manifest.json"), "utf8"));
    expect(m.encrypted).toBe(true);
    expect(m.tables.patients).toBe(8);
    expect(m.tables.opening_balances).toBe(8);
    expect(m.files.entries).toBe(2);
    expect(m.pendingMigrations).toEqual([]);
    expect(m.balances.patients).toBe(8);
    // El manifiesto no lleva datos de pacientes (ni nombres ni identificadores ni montos).
    const text = JSON.stringify(m);
    expect(text).not.toMatch(/Saldo\d|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
    const run = (await db.adminPool.query("SELECT status, backup_name, size_bytes::int AS size, sha256, files_included, tables_count, finished_at FROM backup_runs WHERE id = $1", [out.runId])).rows[0];
    expect(run).toMatchObject({ status: "ok", backup_name: first, sha256: m.database.sha256, files_included: true, finished_at: clock });
    expect(run.size).toBe(m.database.sizeBytes + m.files.sizeBytes);
    expect(run.tables_count).toBeGreaterThan(100);
  }, 60_000);

  it("openssl y scripts/restore.sh restauran el respaldo de la CLI (mismo formato que backup.sh)", async () => {
    const dir = join(work, "respaldos");
    const plain = execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", join(dir, `${first}.dump.enc`), "-pass", "env:BACKUP_PASSPHRASE"],
      { env: { ...process.env, BACKUP_PASSPHRASE: PASS }, maxBuffer: 1 << 30 });
    expect(plain.subarray(0, 5).toString("latin1")).toBe("PGDMP");
    const target = "dental_restore_v_compat";
    await sql(admin, `DROP DATABASE IF EXISTS ${target} WITH (FORCE)`);
    await sql(admin, `CREATE DATABASE ${target}`);
    try {
      execFileSync("bash", ["scripts/restore.sh", join(dir, `${first}.dump.enc`)], { env: { ...process.env, BACKUP_PASSPHRASE: PASS, TARGET_DATABASE_URL: urlFor(target) }, stdio: "pipe" });
      expect((await sql(urlFor(target), "SELECT count(*)::int AS n FROM patients"))[0].n).toBe(8);
      // El paquete de archivos también se abre con openssl + tar.
      const tarball = execFileSync("openssl", ["enc", "-d", "-aes-256-cbc", "-pbkdf2", "-iter", "200000", "-in", join(dir, `dental-files-20261110T071500Z.tar.gz.enc`), "-pass", "env:BACKUP_PASSPHRASE"], { env: { ...process.env, BACKUP_PASSPHRASE: PASS } });
      const list = execFileSync("tar", ["-tzf", "-"], { input: tarball }).toString().trim().split("\n").sort();
      expect(list).toEqual([`${clinicA}/2026/${"a".repeat(32)}`, `${clinicA}/2026/${"b".repeat(32)}`]);
    } finally { await sql(admin, `DROP DATABASE IF EXISTS ${target} WITH (FORCE)`); }
  }, 60_000);

  it("simulacro: restaura en dental_restore_v_*, verifica migraciones, conteos, saldos y RLS, y borra la base temporal", async () => {
    clock = new Date("2026-11-10T08:00:00Z");
    // Cambios DESPUÉS del respaldo: el simulacro compara con lo registrado al respaldar, no con la base actual.
    await db.adminPool.query("INSERT INTO plans (code, name, max_branches, max_users, price_cents) VALUES ('posterior', 'Posterior', 1, 1, 0)");
    const out = await runVerify({ pool: db.adminPool, ops: opsFor(), now });
    expect(out.error).toBeNull();
    expect(out.ok).toBe(true);
    expect(out.name).toBe(first);
    expect(out.restoreDb).toMatch(/^dental_restore_v_20261110t071500z_[0-9a-f]{6}$/);
    expect(out.checks.map((c) => [c.id, c.ok])).toEqual([
      ["integridad", true], ["clave", true], ["restauracion", true], ["migraciones", true], ["conteos", true], ["saldos", true], ["rls", true], ["archivos", true],
    ]);
    expect(await restoreDbs()).toEqual([]);
    const run = (await db.adminPool.query("SELECT kind, status, backup_name, details FROM backup_runs WHERE id = $1", [out.runId])).rows[0];
    expect(run).toMatchObject({ kind: "verify", status: "ok", backup_name: first });
    expect(run.details.checks).toHaveLength(8);
    expect(JSON.stringify(run.details)).not.toMatch(/Saldo\d/);
  }, 90_000);

  it("una clave equivocada se detecta, se registra como fallida y no deja bases temporales", async () => {
    const out = await runVerify({ pool: db.adminPool, ops: opsFor({ passphrase: "otra-frase-que-no-es-la-correcta" }), now });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/clave .*no corresponde/i);
    expect(out.checks.find((c) => c.id === "clave")?.ok).toBe(false);
    expect(await restoreDbs()).toEqual([]);
    expect((await db.adminPool.query("SELECT status FROM backup_runs WHERE id = $1", [out.runId])).rows[0].status).toBe("failed");
  }, 60_000);

  it("un respaldo dañado se detecta: por la huella y, aunque alguien reescriba la huella, al restaurar", async () => {
    // Copia del juego en otra carpeta para dañarla sin tocar el original.
    const bad = join(work, "dañado");
    mkdirSync(bad);
    for (const f of readdirSafe(join(work, "respaldos"))) writeFileSync(join(bad, f), readFileSync(join(work, "respaldos", f)));
    const file = join(bad, `${first}.dump.enc`);
    const buf = readFileSync(file);
    buf[Math.floor(buf.length / 2)]! ^= 0xff;
    writeFileSync(file, buf);
    const out = await runVerify({ pool: db.adminPool, ops: opsFor({ dir: bad }), now });
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/dañado/);
    expect(out.checks[0]).toMatchObject({ id: "integridad", ok: false });

    // Huellas «corregidas» por quien modificó el archivo: igual falla (descifrado o pg_restore).
    const { createHash } = await import("node:crypto");
    const sha = createHash("sha256").update(buf).digest("hex");
    writeFileSync(`${file}.sha256`, `${sha}  ${first}.dump.enc\n`);
    const mPath = join(bad, `${first}.manifest.json`);
    const m = JSON.parse(readFileSync(mPath, "utf8"));
    m.database.sha256 = sha;
    writeFileSync(mPath, JSON.stringify(m));
    const out2 = await runVerify({ pool: db.adminPool, ops: opsFor({ dir: bad }), now });
    expect(out2.ok).toBe(false);
    expect(out2.checks.find((c) => c.id === "integridad")?.ok).toBe(true);
    expect(out2.checks.some((c) => !c.ok)).toBe(true);
    expect(await restoreDbs()).toEqual([]);
  }, 90_000);

  it("si los conteos registrados no coinciden con lo restaurado, el simulacro falla y dice qué tabla", async () => {
    const odd = join(work, "conteos");
    mkdirSync(odd);
    for (const f of readdirSafe(join(work, "respaldos"))) writeFileSync(join(odd, f), readFileSync(join(work, "respaldos", f)));
    const mPath = join(odd, `${first}.manifest.json`);
    const m = JSON.parse(readFileSync(mPath, "utf8"));
    m.tables.patients = 9;
    writeFileSync(mPath, JSON.stringify(m));
    const out = await runVerify({ pool: db.adminPool, ops: opsFor({ dir: odd }), now });
    expect(out.ok).toBe(false);
    expect(out.checks.find((c) => c.id === "conteos")).toMatchObject({ ok: false, detail: expect.stringContaining("patients: 9 → 8") });
    expect(await restoreDbs()).toEqual([]);
  }, 90_000);

  it("respaldo a un S3 falso bajo su prefijo (sin tocar otras claves del bucket) y simulacro desde ahí", async () => {
    const s3: FakeS3 = await startFakeS3();
    try {
      // Una «clave clínica» en el mismo bucket: el respaldo no la toca ni la lista.
      s3.objects.set(`${clinicA}/2026/${"c".repeat(32)}`, { body: Buffer.from("x"), lastModified: new Date(), sse: null });
      const cfg = loadConfig({ ...process.env, DATABASE_URL: urlFor(SRC), DENTAL_FILES_DIR: filesDir });
      const ops = loadOpsConfig(cfg, {
        BACKUP_S3_ENDPOINT: s3.url, BACKUP_S3_REGION: s3.region, BACKUP_S3_BUCKET: s3.bucket, BACKUP_S3_ACCESS_KEY_ID: s3.accessKeyId,
        BACKUP_S3_SECRET_ACCESS_KEY: s3.secretAccessKey, BACKUP_S3_PREFIX: "respaldos/diarios/", BACKUP_VERIFY_DB_PREFIX: "dental_restore_v",
      });
      ops.backup.passphrase = PASS;
      expect(ops.backup.target.kind).toBe("s3");
      clock = new Date("2026-11-11T07:15:00Z");
      const out = await runBackup({ pool: db.adminPool, ops, now });
      expect(out.error).toBeNull();
      const keys = [...s3.objects.keys()].sort();
      expect(keys.filter((k) => k.startsWith("respaldos/diarios/"))).toHaveLength(5);
      expect(keys).toContain(`${clinicA}/2026/${"c".repeat(32)}`);
      expect(s3.objects.get("respaldos/diarios/dental-20261111T071500Z.manifest.json")?.sse).toBe("AES256");
      const storage = new S3BackupStorage(ops.backup.target as Extract<OpsConfig["backup"]["target"], { kind: "s3" }>);
      expect((await storage.list()).map((o) => o.name)).toHaveLength(5);
      const v = await runVerify({ pool: db.adminPool, ops, now });
      expect(v.error).toBeNull();
      expect(v.ok).toBe(true);
      expect(v.name).toBe("dental-20261111T071500Z");
    } finally { await s3.close(); }
  }, 120_000);

  it("la carpeta local solo contiene los respaldos (y la retención no toca archivos ajenos)", async () => {
    const dir = join(work, "respaldos");
    writeFileSync(join(dir, "notas-del-operador.txt"), "no borrar");
    const storage = new LocalBackupStorage(dir);
    expect((await storage.list()).every((o) => o.name.startsWith("dental-"))).toBe(true);
    clock = new Date("2027-03-01T07:15:00Z");
    const ops = opsFor();
    ops.backup.retention = { daily: 1, weekly: 0, monthly: 0 };
    const out = await runBackup({ pool: db.adminPool, ops, now });
    expect(out.ok).toBe(true);
    expect(out.pruned).toEqual([first]);
    expect(readdirSafe(dir).sort()).toEqual([
      "dental-20270301T071500Z.dump.enc", "dental-20270301T071500Z.dump.enc.sha256", "dental-20270301T071500Z.manifest.json",
      "dental-files-20270301T071500Z.tar.gz.enc", "dental-files-20270301T071500Z.tar.gz.enc.sha256", "notas-del-operador.txt",
    ]);
  }, 60_000);
});

function readdirSafe(dir: string): string[] {
  try { return readdirSync(dir).sort(); } catch { return []; }
}
