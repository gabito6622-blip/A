// Chequeo previo a publicar (B-100): revisa la configuración de PRODUCCIÓN sin mostrar ningún valor
// secreto y dice qué falta. No cambia nada (solo lee la base, si la puede alcanzar).
//
//   NODE_ENV=production … npm run preflight
//   En la imagen: node server/dist/cli/preflight.js
//
// Código de salida: 0 si no hay errores (puede haber avisos); 1 si algo impide publicar.
import { spawnSync } from "node:child_process";
import pg from "pg";
import { loadConfig } from "../config.js";
import { loadOpsConfig } from "../modules/ops/config.js";
import { migrationFiles } from "../modules/ops/backup.js";
import { pgBin } from "../modules/ops/runs.js";

type Level = "ok" | "warn" | "error";
const results: { level: Level; text: string }[] = [];
const add = (level: Level, text: string) => results.push({ level, text });
const has = (k: string) => !!process.env[k] && process.env[k]!.trim() !== "";

export async function preflight(): Promise<{ level: Level; text: string }[]> {
  results.length = 0;
  const env = process.env;
  if (env.NODE_ENV !== "production") add("error", "NODE_ENV debe ser «production» en el servidor publicado.");

  // Configuración general y claves (loadConfig ya exige claves distintas en producción).
  let cfg: ReturnType<typeof loadConfig> | null = null;
  try {
    cfg = loadConfig();
    add("ok", "Claves DENTAL_MFA_KEY y DENTAL_LINK_KEY presentes y distintas.");
  } catch (e) {
    add("error", `Configuración: ${(e as Error).message}`);
  }
  if (!has("DATABASE_URL")) add("error", "Falta DATABASE_URL (la base PostgreSQL).");
  if (!has("PUBLIC_URL")) add("error", "Falta PUBLIC_URL (la dirección pública con https://, para los enlaces de los correos).");
  else if (!/^https:\/\//.test(env.PUBLIC_URL!)) add("error", "PUBLIC_URL debe empezar con https://.");
  else add("ok", "PUBLIC_URL con https.");
  if (!has("SMTP_URL")) add("error", "Falta SMTP_URL: sin correo no llegan la recuperación de contraseña, el desbloqueo ni las alertas.");
  else add("ok", "Correo saliente configurado (SMTP_URL).");
  if (!has("TRUST_PROXY")) add("warn", "TRUST_PROXY no está definido: en Railway la imagen usa 1 (un proxy). Revísalo si cambias de proveedor.");

  // Respaldos y alertas.
  if (cfg) {
    try {
      const ops = loadOpsConfig(cfg);
      if (!ops.backup.passphrase) add("error", "Falta BACKUP_PASSPHRASE: en producción los respaldos van cifrados. Guárdala también FUERA del servidor.");
      else if (ops.backup.passphrase.length < 20) add("error", "BACKUP_PASSPHRASE es demasiado corta (mínimo 20 caracteres).");
      else add("ok", "Frase de cifrado de respaldos presente.");
      if (ops.backup.target.kind === "s3") add("ok", "Respaldos a un almacenamiento S3 (fuera del servidor).");
      else add("warn", "Respaldos en una carpeta local del servidor: si el servidor se pierde, se pierden también. Recomendado: BACKUP_S3_* en otra cuenta o bucket.");
      if (!ops.alerts.extraEmails?.length) add("warn", "ALERT_EMAILS vacío: las alertas solo llegan a los administradores de plataforma. Agrega al menos un correo que alguien lea.");
      else add("ok", `Alertas a ${ops.alerts.extraEmails.length} correo(s) además de la plataforma.`);
    } catch (e) {
      add("error", `Respaldos o alertas: ${(e as Error).message}`);
    }
    if ((cfg.filesDriver ?? "local") === "local") add("warn", `Archivos clínicos en disco (${cfg.filesDir}): monta un volumen persistente ahí (Railway: Volumes → /data).`);
    else add("ok", "Archivos clínicos en almacenamiento S3.");
  }
  if (has("WHATSAPP_TOKEN") !== has("WHATSAPP_PHONE_ID")) add("error", "WhatsApp a medias: hacen falta WHATSAPP_TOKEN y WHATSAPP_PHONE_ID juntos (o ninguno).");
  else if (has("WHATSAPP_TOKEN")) {
    add("ok", "WhatsApp configurado: los mensajes saldrán desde la cola.");
    if (!has("WHATSAPP_APP_SECRET")) add("error", "Falta WHATSAPP_APP_SECRET: sin él no se pueden verificar los avisos de Meta (estados y respuestas).");
  } else add("warn", "Sin WhatsApp: los mensajes quedan en cola sin enviarse hasta configurarlo.");

  // Herramientas de respaldo en la imagen.
  for (const tool of ["pg_dump", "pg_restore"] as const) {
    const r = spawnSync(pgBin(env.BACKUP_PG_BIN ?? null, tool), ["--version"], { encoding: "utf8" });
    if (r.status === 0) add("ok", `${tool} disponible (${String(r.stdout).trim()}).`);
    else add("error", `${tool} no está instalado: sin él no hay respaldos ni simulacro.`);
  }

  // Base: conexión, versión y migraciones (solo lectura).
  if (cfg && has("DATABASE_URL")) {
    const client = new pg.Client({ connectionString: cfg.databaseUrl, connectionTimeoutMillis: 8000 });
    try {
      await client.connect();
      const v = (await client.query<{ v: string }>("SELECT current_setting('server_version') AS v")).rows[0]!.v;
      add("ok", `Base de datos alcanzable (PostgreSQL ${v}).`);
      const dump = spawnSync(pgBin(env.BACKUP_PG_BIN ?? null, "pg_dump"), ["--version"], { encoding: "utf8" });
      const dumpMajor = Number(/(\d+)\./.exec(String(dump.stdout))?.[1] ?? 0);
      if (dumpMajor && dumpMajor < Number(v.split(".")[0])) add("error", `pg_dump ${dumpMajor} es más viejo que el servidor (${v}): instala un cliente igual o más nuevo.`);
      const exists = (await client.query("SELECT to_regclass('public.schema_migrations') AS t")).rows[0].t;
      const applied = exists ? new Set((await client.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name)) : new Set<string>();
      const pending = migrationFiles().filter((f) => !applied.has(f));
      if (pending.length) add("warn", `${pending.length} migración(es) pendiente(s): se aplican al arrancar (MIGRATE_ON_START). Haz un respaldo antes.`);
      else add("ok", "Migraciones al día.");
      if (exists) {
        const admins = (await client.query<{ n: number }>("SELECT count(*)::int AS n FROM users WHERE is_platform_admin AND disabled_at IS NULL")).rows[0]!.n;
        if (!admins) add("warn", "No hay administrador de plataforma: nadie verá el panel «Estado del sistema» ni recibirá alertas por esa vía.");
      }
    } catch (e) {
      add("error", `No se pudo conectar a la base: ${(e as Error).message.replace(/postgres(ql)?:\/\/[^\s]+/g, "<DATABASE_URL>")}`);
    } finally {
      await client.end().catch(() => {});
    }
  }
  return [...results];
}

const isMain = process.argv[1] && /preflight\.(ts|js)$/.test(process.argv[1]);
if (isMain) {
  const out = await preflight();
  const icon: Record<Level, string> = { ok: "✔", warn: "⚠", error: "✘" };
  for (const r of out) console.log(`${icon[r.level]} ${r.text}`);
  const errors = out.filter((r) => r.level === "error").length;
  const warns = out.filter((r) => r.level === "warn").length;
  console.log(errors ? `\n✘ ${errors} problema(s) impiden publicar; ${warns} aviso(s).` : `\n✔ Listo para publicar${warns ? ` (con ${warns} aviso(s) para revisar)` : ""}.`);
  process.exit(errors ? 1 : 0);
}
