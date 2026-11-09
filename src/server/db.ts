// Persistencia en SQLite (incluido en Node 22, sin dependencias externas).
//
// Diseño: el núcleo vive en memoria y cada transacción confirmada se guarda como una versión
// nueva del estado completo, ANTES de responder al cliente. Se conservan las últimas versiones
// como respaldo para volver atrás. Pensado para una tienda en un solo servidor (miles de
// cuentas y pedidos); para más volumen, el paso siguiente es un esquema por tablas.
//
// Un solo proceso puede abrir la base: un lock exclusivo evita dos servidores escribiendo a la vez.
import { DatabaseSync } from "node:sqlite";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { State } from "../store/index.js";

export interface SessionRow {
  tokenHash: string;
  /** "link" = enlace de acceso de un solo uso que el staff le manda al cliente. */
  kind: "staff" | "customer" | "link";
  subjectId: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Cifrado de las contraseñas de las cuentas dentro del estado guardado (AES-256-GCM).
 * Con clave, cada `password` de una cuenta se guarda como "enc1:<base64(iv|tag|texto)>".
 * La clave NO está en la base ni en los respaldos: viene de la variable GS_DATA_KEY.
 */
const ENC = "enc1:";
const isAccount = (o: unknown): o is { email: string; supplierId: string; password: string } =>
  !!o && typeof o === "object" && "email" in o && "supplierId" in o && "password" in o;

export class Db {
  private db: DatabaseSync;
  private keep: number;
  private key: Buffer | null;

  constructor(file: string, opts: { keepVersions?: number; dataKey?: string } = {}) {
    this.key = opts.dataKey ? createHash("sha256").update(opts.dataKey).digest() : null;
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.keep = opts.keepVersions ?? 50;
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA busy_timeout = 0;
      CREATE TABLE IF NOT EXISTS state_versions (
        version INTEGER PRIMARY KEY AUTOINCREMENT,
        saved_at INTEGER NOT NULL,
        state TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS platform (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        subject_id TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        expires_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS sessions_subject ON sessions(subject_id);
      CREATE TABLE IF NOT EXISTS secrets (
        name TEXT PRIMARY KEY,
        value TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `);
    // Multiempresa: cada empresa (tenant) guarda su propio estado. Las filas viejas quedan como "main".
    const cols = (this.db.prepare("PRAGMA table_info(state_versions)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("tenant")) {
      this.db.exec("ALTER TABLE state_versions ADD COLUMN tenant TEXT NOT NULL DEFAULT 'main'");
      this.db.exec("CREATE INDEX IF NOT EXISTS state_versions_tenant ON state_versions(tenant, version)");
    }
    // Lock de escritura exclusivo mientras el proceso viva: un segundo servidor sobre el mismo
    // archivo falla al arrancar en vez de pisar datos.
    if (file !== ":memory:") {
      this.db.exec("PRAGMA locking_mode = EXCLUSIVE;");
      this.db.exec("BEGIN EXCLUSIVE; COMMIT;");
    }
  }

  private encrypt(plain: string): string {
    const iv = randomBytes(12);
    const c = createCipheriv("aes-256-gcm", this.key!, iv);
    const ct = Buffer.concat([c.update(plain, "utf8"), c.final()]);
    return ENC + Buffer.concat([iv, c.getAuthTag(), ct]).toString("base64");
  }

  private decrypt(v: string): string {
    if (!this.key) throw new Error("Las contraseñas de las cuentas están cifradas y falta la clave GS_DATA_KEY. Volvé a cargar la misma clave en las variables del servidor.");
    const raw = Buffer.from(v.slice(ENC.length), "base64");
    const d = createDecipheriv("aes-256-gcm", this.key, raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    try {
      return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString("utf8");
    } catch {
      throw new Error("La clave GS_DATA_KEY no es la misma con la que se cifraron las contraseñas.");
    }
  }

  private parse(text: string): State {
    return JSON.parse(text, (k, v) => (k === "password" && typeof v === "string" && v.startsWith(ENC) ? this.decrypt(v) : v)) as State;
  }

  private serialize(state: State): string {
    if (!this.key) return JSON.stringify(state);
    // eslint-disable-next-line @typescript-eslint/no-this-alias
    const self = this;
    return JSON.stringify(state, function (this: unknown, k, v) {
      return k === "password" && typeof v === "string" && v && !v.startsWith(ENC) && isAccount(this) ? (Db.prototype.encrypt as (p: string) => string).call(self, v) : v;
    });
  }

  /** Con clave: cifra las contraseñas que hayan quedado legibles en versiones viejas. Devuelve cuántas versiones cambió. */
  encryptExisting(): number {
    if (!this.key) return 0;
    const rows = this.db.prepare("SELECT version, state FROM state_versions").all() as { version: number; state: string }[];
    let n = 0;
    const upd = this.db.prepare("UPDATE state_versions SET state = ? WHERE version = ?");
    for (const r of rows) {
      if (!/"password":"(?!enc1:)[^"]+"/.test(r.state)) continue;
      upd.run(this.serialize(this.parse(r.state)), r.version);
      n++;
    }
    return n;
  }

  /** Cifra un secreto suelto (p. ej. contraseña de aplicación del correo) si hay clave. */
  seal(v: string): string {
    return this.key ? this.encrypt(v) : v;
  }

  unseal(v: string): string {
    return v.startsWith(ENC) ? this.decrypt(v) : v;
  }

  get encrypted(): boolean {
    return !!this.key;
  }

  loadLatest(tenant = "main"): State | undefined {
    const row = this.db.prepare("SELECT state FROM state_versions WHERE tenant = ? ORDER BY version DESC LIMIT 1").get(tenant) as { state: string } | undefined;
    return row ? this.parse(row.state) : undefined;
  }

  /** Empresas (tenants) que tienen datos guardados. */
  tenants(): string[] {
    return (this.db.prepare("SELECT DISTINCT tenant FROM state_versions ORDER BY tenant").all() as { tenant: string }[]).map((r) => r.tenant);
  }

  /** Registro central del SaaS (lista de empresas, planes, suscripciones): un solo documento JSON. */
  loadPlatform<T>(): T | undefined {
    const row = this.db.prepare("SELECT value FROM platform WHERE key = 'registry'").get() as { value: string } | undefined;
    return row ? (JSON.parse(row.value) as T) : undefined;
  }

  savePlatform(data: unknown, at: number): void {
    this.db.prepare("INSERT INTO platform (key, value, updated_at) VALUES ('registry', ?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(JSON.stringify(data), at);
  }

  /** Guarda una versión nueva del estado. Lanza si el disco falla (el núcleo deshace la transacción). */
  saveState(state: State, at: number, tenant = "main"): number {
    const res = this.db.prepare("INSERT INTO state_versions (saved_at, state, tenant) VALUES (?, ?, ?)").run(at, this.serialize(state), tenant);
    const version = Number(res.lastInsertRowid);
    // Poda por empresa: deja las últimas `keep` versiones de ESA empresa.
    if (version % 25 === 0) {
      const old = this.db.prepare("SELECT version FROM state_versions WHERE tenant = ? ORDER BY version DESC LIMIT 1 OFFSET ?").get(tenant, this.keep) as { version: number } | undefined;
      if (old) this.db.prepare("DELETE FROM state_versions WHERE tenant = ? AND version <= ?").run(tenant, old.version);
    }
    return version;
  }

  /** Copia consistente de la base completa (estado, sesiones y claves) a otro archivo. */
  backupTo(file: string): void {
    this.db.prepare("VACUUM INTO ?").run(file);
  }

  versions(limit = 20): { version: number; savedAt: number; bytes: number }[] {
    return (this.db.prepare("SELECT version, saved_at AS savedAt, length(state) AS bytes FROM state_versions ORDER BY version DESC LIMIT ?").all(limit) as never[]);
  }

  putSession(s: SessionRow): void {
    this.db.prepare("INSERT INTO sessions (token_hash, kind, subject_id, created_at, expires_at) VALUES (?, ?, ?, ?, ?)").run(s.tokenHash, s.kind, s.subjectId, s.createdAt, s.expiresAt);
  }

  getSession(tokenHash: string, now: number): SessionRow | undefined {
    const r = this.db.prepare("SELECT token_hash AS tokenHash, kind, subject_id AS subjectId, created_at AS createdAt, expires_at AS expiresAt FROM sessions WHERE token_hash = ?").get(tokenHash) as SessionRow | undefined;
    if (!r) return undefined;
    if (r.expiresAt <= now) {
      this.deleteSession(tokenHash);
      return undefined;
    }
    return r;
  }

  deleteSession(tokenHash: string): void {
    this.db.prepare("DELETE FROM sessions WHERE token_hash = ?").run(tokenHash);
  }

  /** Cierra todas las sesiones de alguien (p. ej. al cambiar la contraseña o desactivarlo). */
  deleteSessionsOf(subjectId: string): void {
    this.db.prepare("DELETE FROM sessions WHERE subject_id = ?").run(subjectId);
  }

  purgeExpiredSessions(now: number): void {
    this.db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now);
  }

  /**
   * Claves de integraciones (token de Meta, etc.). Van en una tabla aparte del estado: no entran
   * en las versiones guardadas, ni en exportaciones, ni en la auditoría. Protegé el archivo .db.
   */
  setSecret(name: string, value: string | null, at: number): void {
    if (value === null || value === "") this.db.prepare("DELETE FROM secrets WHERE name = ?").run(name);
    else this.db.prepare("INSERT INTO secrets (name, value, updated_at) VALUES (?, ?, ?) ON CONFLICT(name) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at").run(name, value, at);
  }

  getSecret(name: string): string | undefined {
    return (this.db.prepare("SELECT value FROM secrets WHERE name = ?").get(name) as { value: string } | undefined)?.value;
  }

    close(): void {
    this.db.close();
  }
}
