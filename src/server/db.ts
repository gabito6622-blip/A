// Persistencia en SQLite (incluido en Node 22, sin dependencias externas).
//
// Diseño: el núcleo vive en memoria y cada transacción confirmada se guarda como una versión
// nueva del estado completo, ANTES de responder al cliente. Se conservan las últimas versiones
// como respaldo para volver atrás. Pensado para una tienda en un solo servidor (miles de
// cuentas y pedidos); para más volumen, el paso siguiente es un esquema por tablas.
//
// Un solo proceso puede abrir la base: un lock exclusivo evita dos servidores escribiendo a la vez.
import { DatabaseSync } from "node:sqlite";
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

export class Db {
  private db: DatabaseSync;
  private keep: number;

  constructor(file: string, opts: { keepVersions?: number } = {}) {
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
    // Lock de escritura exclusivo mientras el proceso viva: un segundo servidor sobre el mismo
    // archivo falla al arrancar en vez de pisar datos.
    if (file !== ":memory:") {
      this.db.exec("PRAGMA locking_mode = EXCLUSIVE;");
      this.db.exec("BEGIN EXCLUSIVE; COMMIT;");
    }
  }

  loadLatest(): State | undefined {
    const row = this.db.prepare("SELECT state FROM state_versions ORDER BY version DESC LIMIT 1").get() as { state: string } | undefined;
    return row ? (JSON.parse(row.state) as State) : undefined;
  }

  /** Guarda una versión nueva del estado. Lanza si el disco falla (el núcleo deshace la transacción). */
  saveState(state: State, at: number): number {
    const res = this.db.prepare("INSERT INTO state_versions (saved_at, state) VALUES (?, ?)").run(at, JSON.stringify(state));
    const version = Number(res.lastInsertRowid);
    if (version % 25 === 0) this.db.prepare("DELETE FROM state_versions WHERE version <= ?").run(version - this.keep);
    return version;
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
