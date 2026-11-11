// Configuración leída de variables de entorno. Nunca se escriben secretos en el código.
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
    disableRateLimit: env.DENTAL_DISABLE_RATE_LIMIT === "1" && !isProduction,
    secretKey: parseKey(env.DENTAL_SECRET_KEY, isProduction),
    publicUrl: (env.PUBLIC_URL ?? `http://localhost:${env.PORT ?? 3100}`).replace(/\/$/, ""),
    smtpUrl: env.SMTP_URL ?? null,
    mailFrom: env.MAIL_FROM ?? "Dentalia <no-responder@localhost>",
  };
}
