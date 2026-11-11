// Configuración leída de variables de entorno. Nunca se escriben secretos en el código.
import { loadFilesConfig, type StorageDriver } from "./lib/filestore.js";
import type { S3Config } from "./lib/filestore-s3.js";
import { hkdf32, type KeyRing } from "./lib/keys.js";
export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  isProduction: boolean;
  /** Sirve el frontend compilado (web/dist) si existe. */
  staticDir: string | null;
  sessionTtlHours: number;
  /**
   * Cuántos proxies delante del servidor se confían para X-Forwarded-For (Railway y la mayoría de
   * PaaS: 1). Nunca «todos»: con `true` la IP saldría del primer valor de la cabecera, que escribe el
   * cliente, y cualquiera evadiría los límites por IP (login, códigos, enlaces públicos).
   */
  trustProxy: number | false;
  /** Carpeta privada para archivos clínicos (radiografías, fotos). */
  filesDir: string;
  /** Dónde se guardan los archivos nuevos: disco (local) o S3 compatible (DENTAL_FILES_DRIVER). */
  filesDriver: StorageDriver;
  s3: S3Config | null;
  /** Desactiva el límite de intentos de login (solo pruebas automatizadas). */
  disableRateLimit: boolean;
  /**
   * Claves separadas por uso (B-094), cada una con rotación (vigente + anterior):
   *  * mfa: cifra el secreto de la verificación en dos pasos (DENTAL_MFA_KEY);
   *  * link: firma enlaces y códigos (archivos, desbloqueo, confirmación, encuestas, QR, portal) (DENTAL_LINK_KEY).
   */
  keys: { mfa: KeyRing; link: KeyRing };
  /** URL pública de la aplicación (enlaces en correos). */
  publicUrl: string;
  /** smtp(s)://usuario:clave@host:puerto — sin esto los correos solo se registran en desarrollo. */
  smtpUrl: string | null;
  mailFrom: string;
}

/** Clave de 32 bytes en hex (64 caracteres) o base64; null si no está definida. */
export function parseKey(name: string, raw: string | undefined): Buffer | null {
  if (raw === undefined || raw.trim() === "") return null;
  const v = raw.trim();
  const k = /^[0-9a-f]{64}$/i.test(v) ? Buffer.from(v, "hex") : /^[A-Za-z0-9+/_-]+={0,2}$/.test(v) ? Buffer.from(v, "base64") : Buffer.alloc(0);
  if (k.length !== 32) throw new Error(`${name} debe tener 32 bytes (64 caracteres hex o base64). Genérala con: openssl rand -hex 32`);
  return k;
}

/** Clave fija conocida, SOLO para desarrollo y pruebas (nunca en producción). */
const DEV_BASE_KEY = Buffer.alloc(32, 7);

/**
 * Lee las claves por uso y su rotación.
 *  * Producción: DENTAL_MFA_KEY y DENTAL_LINK_KEY obligatorias y distintas (error claro al arrancar).
 *  * Fuera de producción: si faltan, se derivan con HKDF de DENTAL_SECRET_KEY (o de la clave fija de
 *    desarrollo) y la clave base queda como «anterior», para que los secretos y enlaces ya creados
 *    en los entornos existentes sigan funcionando.
 *  * *_PREVIOUS: clave anterior, solo para verificar o descifrar durante la rotación.
 */
export function loadKeys(env: NodeJS.ProcessEnv, isProduction: boolean): { mfa: KeyRing; link: KeyRing } {
  const mfa = parseKey("DENTAL_MFA_KEY", env.DENTAL_MFA_KEY);
  const link = parseKey("DENTAL_LINK_KEY", env.DENTAL_LINK_KEY);
  const mfaPrev = parseKey("DENTAL_MFA_KEY_PREVIOUS", env.DENTAL_MFA_KEY_PREVIOUS);
  const linkPrev = parseKey("DENTAL_LINK_KEY_PREVIOUS", env.DENTAL_LINK_KEY_PREVIOUS);
  if (isProduction) {
    const missing = [!mfa && "DENTAL_MFA_KEY", !link && "DENTAL_LINK_KEY"].filter(Boolean);
    if (missing.length) {
      throw new Error(
        `Falta ${missing.join(" y ")} (obligatorias en producción, 32 bytes: openssl rand -hex 32). ` +
        "Si venías usando DENTAL_SECRET_KEY, genera dos claves nuevas y pon el valor anterior en DENTAL_MFA_KEY_PREVIOUS y DENTAL_LINK_KEY_PREVIOUS.",
      );
    }
    if (mfa!.equals(link!)) throw new Error("DENTAL_MFA_KEY y DENTAL_LINK_KEY deben ser distintas: una cifra los 2 pasos y la otra firma los enlaces.");
    return { mfa: { current: mfa!, previous: mfaPrev }, link: { current: link!, previous: linkPrev } };
  }
  const base = parseKey("DENTAL_SECRET_KEY", env.DENTAL_SECRET_KEY) ?? DEV_BASE_KEY;
  const ring = (cur: Buffer | null, prev: Buffer | null, info: string): KeyRing =>
    cur ? { current: cur, previous: prev } : { current: hkdf32(base, info), previous: prev ?? base };
  const out = { mfa: ring(mfa, mfaPrev, "dentalia:mfa:v1"), link: ring(link, linkPrev, "dentalia:link:v1") };
  if (out.mfa.current.equals(out.link.current)) throw new Error("DENTAL_MFA_KEY y DENTAL_LINK_KEY deben ser distintas.");
  return out;
}

/** TRUST_PROXY = número de saltos de proxy confiables (0 = ninguno). En producción, 1 por defecto. */
export function parseTrustProxy(raw: string | undefined, isProduction: boolean): number | false {
  if (raw === undefined || raw === "") return isProduction ? 1 : false;
  if (!/^\d{1,2}$/.test(raw)) throw new Error("TRUST_PROXY debe ser la cantidad de proxies confiables (por ejemplo 1)");
  const n = Number(raw);
  return n > 0 ? n : false;
}

/**
 * Opción trustProxy de Fastify para N saltos: confía en el par directo y en los N-1 siguientes, y
 * toma como IP del cliente la que agregó el último proxy confiable (igual que Express con un número).
 * Fastify trata un número como «no confiar en nadie», por eso se pasa una función.
 */
export function trustProxyOption(hops: number | false): false | ((addr: string, hop: number) => boolean) {
  return hops ? (_addr: string, hop: number) => hop < hops : false;
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
    trustProxy: parseTrustProxy(env.TRUST_PROXY, isProduction),
    filesDir: env.DENTAL_FILES_DIR ?? "./data/files",
    ...loadFilesConfig(env, isProduction),
    disableRateLimit: env.DENTAL_DISABLE_RATE_LIMIT === "1" && !isProduction,
    keys: loadKeys(env, isProduction),
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3100}`).replace(/\/$/, ""),
    smtpUrl: env.SMTP_URL ?? null,
    mailFrom: env.MAIL_FROM ?? "Dentalia <no-responder@localhost>",
  };
}
