// Configuración de la operación diaria (respaldos, simulacros, monitoreo y alertas), leída de
// variables de entorno. Nunca se escriben secretos en el código ni en los registros.
import { readFileSync } from "node:fs";
import { dirname, join, relative, resolve, isAbsolute } from "node:path";
import { fileURLToPath } from "node:url";
import type { Config } from "../../config.js";
import type { S3Config } from "../../lib/filestore-s3.js";

export interface RetentionPolicy { daily: number; weekly: number; monthly: number }

export type BackupTarget =
  | { kind: "local"; dir: string }
  | { kind: "s3"; s3: S3Config; prefix: string };

export interface OpsConfig {
  isProduction: boolean;
  databaseUrl: string;
  filesDir: string;
  filesDriver: Config["filesDriver"];
  filesS3: S3Config | null;
  publicUrl: string;
  backup: {
    passphrase: string | null;
    target: BackupTarget;
    retention: RetentionPolicy;
    prune: boolean;
    /** Juegos sin manifiesto (subida interrumpida) se borran pasadas estas horas. */
    incompleteMaxAgeHours: number;
    /** Servidor donde se crea la base temporal del simulacro (base «postgres» de ese servidor). */
    verifyAdminUrl: string;
    /** Prefijo de la base temporal: siempre empieza con «dental_restore». */
    verifyDbPrefix: string;
    /** Carpeta de pg_dump/pg_restore (si no están en el PATH). */
    pgBinDir: string | null;
  };
  alerts: {
    backupMaxAgeHours: number;
    verifyMaxAgeDays: number;
    errors5xxThreshold: number;
    errors5xxWindowMinutes: number;
    repeatHours: number;
    webhookUrl: string | null;
    extraEmails: string[];
    monitorEnabled: boolean;
    monitorIntervalMs: number;
  };
  slowMs: number;
  version: string;
  commit: string | null;
}

export const DEFAULT_RETENTION: RetentionPolicy = { daily: 7, weekly: 4, monthly: 12 };
const PREFIX_RE = /^[a-z0-9][a-z0-9._-]*(\/[a-z0-9][a-z0-9._-]*)*\/$/;
const UUID_START = /^[0-9a-f]{8}-[0-9a-f]{4}-/;

function int(env: NodeJS.ProcessEnv, name: string, def: number, min: number, max: number): number {
  const raw = env[name];
  if (raw === undefined || raw.trim() === "") return def;
  if (!/^\d+$/.test(raw.trim())) throw new Error(`${name} debe ser un número entero`);
  const n = Number(raw.trim());
  if (n < min || n > max) throw new Error(`${name} debe estar entre ${min} y ${max}`);
  return n;
}
const flag = (v: string | undefined, def: boolean) => (v == null || v.trim() === "" ? def : !["0", "false", "no", "off"].includes(v.trim().toLowerCase()));

let pkgVersion: string | null = null;
export function appVersion(): string {
  if (pkgVersion) return pkgVersion;
  try {
    // server/src/modules/ops → dental/package.json (igual desde server/dist/modules/ops).
    const p = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..", "package.json");
    pkgVersion = String(JSON.parse(readFileSync(p, "utf8")).version ?? "desconocida");
  } catch { pkgVersion = "desconocida"; }
  return pkgVersion;
}

/** Configuración S3 de los respaldos: BACKUP_S3_* y, lo que falte, de DENTAL_S3_*. */
function backupS3(env: NodeJS.ProcessEnv, isProduction: boolean): S3Config | null {
  const v = (k: string) => (env[`BACKUP_S3_${k}`] ?? env[`DENTAL_S3_${k}`] ?? "").trim();
  const endpoint = v("ENDPOINT").replace(/\/+$/, "");
  const bucket = v("BUCKET");
  const id = v("ACCESS_KEY_ID");
  const secret = env.BACKUP_S3_SECRET_ACCESS_KEY ?? env.DENTAL_S3_SECRET_ACCESS_KEY ?? "";
  if (!endpoint || !bucket || !id || !secret) return null;
  let url: URL;
  try { url = new URL(endpoint); } catch { throw new Error("BACKUP_S3_ENDPOINT no es una URL válida"); }
  const local = ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && (local || !isProduction))) throw new Error("BACKUP_S3_ENDPOINT debe usar https:// en producción");
  const sse = v("SSE") || "AES256";
  if (!["AES256", "off", "none"].includes(sse)) throw new Error("BACKUP_S3_SSE debe ser «AES256» u «off»");
  return {
    endpoint, region: v("REGION") || "us-east-1", bucket, accessKeyId: id, secretAccessKey: secret,
    pathStyle: flag(env.BACKUP_S3_PATH_STYLE ?? env.DENTAL_S3_PATH_STYLE, true), sse: sse === "AES256" ? "AES256" : null,
    conditionalPut: flag(env.BACKUP_S3_CONDITIONAL_PUT ?? env.DENTAL_S3_CONDITIONAL_PUT, true), timeoutMs: 120_000,
  };
}

function isInside(child: string, parent: string) {
  const rel = relative(resolve(parent), resolve(child));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

export function loadOpsConfig(cfg: Config, env: NodeJS.ProcessEnv = process.env): OpsConfig {
  const isProduction = cfg.isProduction;
  // ---- Destino del respaldo ----
  const mode = (env.BACKUP_STORAGE ?? "auto").trim().toLowerCase();
  if (!["auto", "s3", "local"].includes(mode)) throw new Error("BACKUP_STORAGE debe ser «auto», «s3» o «local»");
  const s3 = mode === "local" ? null : backupS3(env, isProduction);
  if (mode === "s3" && !s3) throw new Error("BACKUP_STORAGE=s3 necesita BACKUP_S3_ENDPOINT, BACKUP_S3_BUCKET, BACKUP_S3_ACCESS_KEY_ID y BACKUP_S3_SECRET_ACCESS_KEY (o las DENTAL_S3_*)");
  let target: BackupTarget;
  if (s3) {
    const prefix = (env.BACKUP_S3_PREFIX ?? "respaldos/").trim();
    if (!PREFIX_RE.test(prefix)) throw new Error("BACKUP_S3_PREFIX debe ser una carpeta en minúsculas terminada en «/» (por ejemplo respaldos/)");
    if (UUID_START.test(prefix)) throw new Error("BACKUP_S3_PREFIX no puede parecerse a la carpeta de una clínica");
    target = { kind: "s3", s3, prefix };
  } else {
    const dir = resolve(env.BACKUP_DIR ?? "./backups");
    if (isInside(dir, cfg.filesDir) || isInside(cfg.filesDir, dir)) throw new Error("BACKUP_DIR no puede estar dentro de la carpeta de archivos clínicos (DENTAL_FILES_DIR) ni contenerla");
    target = { kind: "local", dir };
  }

  // ---- Simulacro de restauración ----
  const verifyAdminUrl = (() => {
    if (env.BACKUP_VERIFY_ADMIN_URL) return env.BACKUP_VERIFY_ADMIN_URL;
    const u = new URL(cfg.databaseUrl);
    u.pathname = "/postgres";
    return u.toString();
  })();
  const verifyDbPrefix = (env.BACKUP_VERIFY_DB_PREFIX ?? "dental_restore").trim();
  if (!/^dental_restore[a-z0-9_]{0,24}$/.test(verifyDbPrefix)) throw new Error("BACKUP_VERIFY_DB_PREFIX debe empezar con «dental_restore» (solo minúsculas, números y _)");

  // ---- Alertas ----
  const webhookUrl = env.ALERT_WEBHOOK_URL?.trim() || null;
  if (webhookUrl) {
    let u: URL;
    try { u = new URL(webhookUrl); } catch { throw new Error("ALERT_WEBHOOK_URL no es una URL válida"); }
    if (isProduction && u.protocol !== "https:") throw new Error("ALERT_WEBHOOK_URL debe usar https:// en producción");
    if (!/^https?:$/.test(u.protocol)) throw new Error("ALERT_WEBHOOK_URL debe ser http(s)");
  }
  const extraEmails = (env.ALERT_EMAILS ?? "").split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
  for (const e of extraEmails) if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) throw new Error(`ALERT_EMAILS tiene un correo inválido: ${e}`);

  const daily = int(env, "BACKUP_KEEP_DAILY", DEFAULT_RETENTION.daily, 1, 366);
  return {
    isProduction,
    databaseUrl: cfg.databaseUrl,
    filesDir: cfg.filesDir,
    filesDriver: cfg.filesDriver,
    filesS3: cfg.s3,
    publicUrl: cfg.publicUrl,
    backup: {
      passphrase: env.BACKUP_PASSPHRASE ? env.BACKUP_PASSPHRASE : null,
      target,
      retention: { daily, weekly: int(env, "BACKUP_KEEP_WEEKLY", DEFAULT_RETENTION.weekly, 0, 520), monthly: int(env, "BACKUP_KEEP_MONTHLY", DEFAULT_RETENTION.monthly, 0, 1200) },
      prune: flag(env.BACKUP_PRUNE, true),
      incompleteMaxAgeHours: 48,
      verifyAdminUrl,
      verifyDbPrefix,
      pgBinDir: env.BACKUP_PG_BIN?.trim() || null,
    },
    alerts: {
      backupMaxAgeHours: int(env, "ALERT_BACKUP_MAX_AGE_HOURS", 26, 1, 24 * 30),
      verifyMaxAgeDays: int(env, "ALERT_VERIFY_MAX_AGE_DAYS", 8, 1, 365),
      errors5xxThreshold: int(env, "ALERT_5XX_THRESHOLD", 20, 1, 1_000_000),
      errors5xxWindowMinutes: int(env, "ALERT_5XX_WINDOW_MINUTES", 10, 1, 24 * 60),
      repeatHours: int(env, "ALERT_REPEAT_HOURS", 6, 1, 24 * 7),
      webhookUrl,
      extraEmails,
      monitorEnabled: flag(env.OPS_MONITOR, isProduction),
      monitorIntervalMs: int(env, "OPS_MONITOR_INTERVAL_MS", 300_000, 10_000, 24 * 3600_000),
    },
    slowMs: int(env, "OPS_SLOW_MS", 1000, 1, 600_000),
    version: env.APP_VERSION?.trim() || appVersion(),
    commit: (env.RAILWAY_GIT_COMMIT_SHA ?? env.SOURCE_COMMIT ?? "").trim().slice(0, 12) || null,
  };
}

/** Descripción legible del destino (sin credenciales). */
export function targetLabel(t: BackupTarget): string {
  if (t.kind === "local") return `carpeta local ${t.dir}`;
  return `S3 ${t.s3.bucket}/${t.prefix} (${new URL(t.s3.endpoint).host})`;
}
