// Configuración leída de variables de entorno. Nunca se escriben secretos en el código.
import { loadFilesConfig, type StorageDriver } from "./lib/filestore.js";
import type { S3Config } from "./lib/filestore-s3.js";
export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  isProduction: boolean;
  /** Sirve el frontend compilado (web/dist) si existe. */
  staticDir: string | null;
  sessionTtlHours: number;
  /** Confiar en X-Forwarded-For (Railway y la mayoría de PaaS van detrás de un proxy). */
  trustProxy: boolean;
  /** Carpeta privada para archivos clínicos (radiografías, fotos). */
  filesDir: string;
  /** Dónde se guardan los archivos nuevos: disco (local) o S3 compatible (DENTAL_FILES_DRIVER). */
  filesDriver: StorageDriver;
  s3: S3Config | null;
  /** Desactiva el límite de intentos de login (solo pruebas automatizadas). */
  disableRateLimit: boolean;
  /** Clave de 32 bytes (hex o base64) para cifrar secretos de la verificación en dos pasos. */
  secretKey: Buffer;
  /** URL pública de la aplicación (enlaces en correos). */
  publicUrl: string;
  /** smtp(s)://usuario:clave@host:puerto — sin esto los correos solo se registran en desarrollo. */
  smtpUrl: string | null;
  mailFrom: string;
}

function parseKey(raw: string | undefined, isProduction: boolean): Buffer {
  if (raw) {
    const k = /^[0-9a-f]{64}$/i.test(raw) ? Buffer.from(raw, "hex") : Buffer.from(raw, "base64");
    if (k.length !== 32) throw new Error("DENTAL_SECRET_KEY debe tener 32 bytes (64 caracteres hex o base64)");
    return k;
  }
  if (isProduction) throw new Error("DENTAL_SECRET_KEY es obligatorio en producción");
  // Solo desarrollo y pruebas: clave fija conocida. Nunca usar en producción.
  return Buffer.alloc(32, 7);
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const databaseUrl = env.DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_dev";
  const isProduction = env.NODE_ENV === "production";
  if (isProduction && !env.DATABASE_URL) throw new Error("DATABASE_URL es obligatorio en producción");
  return {
    databaseUrl,
    port: Number(env.PORT ?? 3100),
    host: env.HOST ?? "0.0.0.0",
    isProduction,
    staticDir: env.DENTAL_STATIC_DIR ?? null,
    sessionTtlHours: Number(env.SESSION_TTL_HOURS ?? 12),
    trustProxy: env.TRUST_PROXY === "1" || isProduction,
    filesDir: env.DENTAL_FILES_DIR ?? "./data/files",
    ...loadFilesConfig(env, isProduction),
    disableRateLimit: env.DENTAL_DISABLE_RATE_LIMIT === "1" && !isProduction,
    secretKey: parseKey(env.DENTAL_SECRET_KEY, isProduction),
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3100}`).replace(/\/$/, ""),
    smtpUrl: env.SMTP_URL ?? null,
    mailFrom: env.MAIL_FROM ?? "Dentalia <no-responder@localhost>",
  };
}
