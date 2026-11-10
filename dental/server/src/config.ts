// Configuración leída de variables de entorno. Nunca se escriben secretos en el código.
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
  /** Desactiva el límite de intentos de login (solo pruebas automatizadas). */
  disableRateLimit: boolean;
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
    disableRateLimit: env.DENTAL_DISABLE_RATE_LIMIT === "1" && !isProduction,
  };
}
