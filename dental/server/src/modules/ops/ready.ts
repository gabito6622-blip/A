// Disponibilidad del servicio (/api/ready): base de datos, migraciones al día y almacenamiento de
// archivos escribible. La respuesta pública solo dice si está listo; el detalle lo ve la plataforma.
import { randomBytes } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { Db } from "../../lib/db.js";
import { S3ObjectClient } from "../../lib/filestore-s3.js";
import type { OpsConfig } from "./config.js";
import { migrationFiles } from "./backup.js";
import { summarizeError } from "./runs.js";

export interface ReadyCheck { ok: boolean; detail: string }
export interface ReadyResult { ok: boolean; checkedAt: string; checks: { database: ReadyCheck; migrations: ReadyCheck; storage: ReadyCheck } }

const withTimeout = <T>(p: Promise<T>, ms: number, what: string) =>
  Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new Error(`${what}: sin respuesta en ${ms / 1000} s`)), ms).unref())]);

/** Prueba de escritura real en el almacenamiento de archivos clínicos (archivo/objeto efímero fuera de las claves de clínica). */
export async function probeStorage(ops: Pick<OpsConfig, "filesDriver" | "filesDir" | "filesS3">): Promise<ReadyCheck> {
  const name = `.salud-${randomBytes(6).toString("hex")}`;
  try {
    if (ops.filesDriver === "s3") {
      if (!ops.filesS3) return { ok: false, detail: "S3 sin configurar" };
      const c = new S3ObjectClient({ ...ops.filesS3, timeoutMs: 5000 });
      await c.putObject(name, Buffer.from("ok"));
      await c.deleteObject(name);
      return { ok: true, detail: "S3: escritura y borrado de prueba correctos" };
    }
    await mkdir(ops.filesDir, { recursive: true, mode: 0o700 });
    const p = join(ops.filesDir, name);
    await writeFile(p, "ok", { flag: "wx", mode: 0o600 });
    await rm(p, { force: true });
    return { ok: true, detail: "disco: escritura de prueba correcta" };
  } catch (e) {
    return { ok: false, detail: `no se puede escribir: ${summarizeError(e)}` };
  }
}

export class Readiness {
  private storageCache: { at: number; check: ReadyCheck } | null = null;
  private last: { at: number; result: ReadyResult } | null = null;
  private readonly expected = migrationFiles();
  constructor(private readonly db: Db, private readonly ops: OpsConfig, private readonly opts: { cacheMs?: number; storageCacheMs?: number } = {}) {}

  async check(now = Date.now()): Promise<ReadyResult> {
    if (this.last && now - this.last.at < (this.opts.cacheMs ?? 5000)) return this.last.result;
    const database: ReadyCheck = await withTimeout(this.db.appPool.query("SELECT 1"), 3000, "base de datos")
      .then(() => ({ ok: true, detail: "responde" }), (e) => ({ ok: false, detail: summarizeError(e) }));
    let migrations: ReadyCheck;
    if (!database.ok) migrations = { ok: false, detail: "sin base de datos" };
    else {
      migrations = await withTimeout(this.db.adminPool.query<{ name: string }>("SELECT name FROM schema_migrations"), 3000, "migraciones").then((r) => {
        const applied = new Set(r.rows.map((x) => x.name));
        const pending = this.expected.filter((f) => !applied.has(f));
        return pending.length ? { ok: false, detail: `pendientes: ${pending.join(", ")}` } : { ok: true, detail: `${applied.size} aplicadas` };
      }, (e) => ({ ok: false, detail: summarizeError(e) }));
    }
    if (!this.storageCache || now - this.storageCache.at >= (this.opts.storageCacheMs ?? 60_000) || !this.storageCache.check.ok) {
      this.storageCache = { at: now, check: await withTimeout(probeStorage(this.ops), 8000, "almacenamiento").catch((e) => ({ ok: false, detail: summarizeError(e) })) };
    }
    const result: ReadyResult = { ok: database.ok && migrations.ok && this.storageCache.check.ok, checkedAt: new Date(now).toISOString(), checks: { database, migrations, storage: this.storageCache.check } };
    this.last = { at: now, result };
    return result;
  }

  reset() { this.last = null; this.storageCache = null; }
}
