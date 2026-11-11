// Respaldo programado y simulacro de restauración (Equipo V).
//   npm run backup:run                    → respaldo cifrado + retención (7 diarios, 4 semanales, 12 mensuales)
//   npm run backup:run -- --no-prune      → sin aplicar la retención
//   npm run backup:verify                 → restaura el último respaldo en una base temporal y lo verifica
//   npm run backup:verify -- --name dental-20261111T071500Z
//   … -- --json                           → resultado en JSON
// En la imagen de producción (sin tsx): node server/dist/cli/backup.js run | verify
// Código de salida: 0 bien; 1 falló (queda registrado en backup_runs y se avisa a la plataforma).
import { loadConfig } from "../config.js";
import { createDb } from "../lib/db.js";
import { createMailer } from "../lib/mailer.js";
import { runBackup } from "../modules/ops/backup.js";
import { loadOpsConfig } from "../modules/ops/config.js";
import { processAlerts, type AlertCondition } from "../modules/ops/alerts.js";
import { runVerify } from "../modules/ops/verify.js";

const [cmd, ...rest] = process.argv.slice(2);
const args = new Set(rest.filter((a) => a.startsWith("--")));
const nameIdx = rest.indexOf("--name");
const name = nameIdx >= 0 ? rest[nameIdx + 1] : undefined;
const allowed = cmd === "run" ? ["--no-prune", "--json"] : ["--name", "--json"];
const unknown = [...args].filter((a) => !allowed.includes(a));
if (!["run", "verify"].includes(cmd ?? "") || unknown.length || (nameIdx >= 0 && !/^dental-\d{8}T\d{6}Z$/.test(name ?? ""))) {
  console.error("Uso: backup.ts run [--no-prune] [--json] | backup.ts verify [--name dental-AAAAMMDDTHHMMSSZ] [--json]");
  process.exit(1);
}

let cfg, ops;
try {
  cfg = loadConfig();
  ops = loadOpsConfig(cfg);
} catch (e) {
  console.error(`Configuración inválida: ${(e as Error).message}`);
  process.exit(1);
}
if (args.has("--no-prune")) ops.backup.prune = false;
const db = createDb(cfg.databaseUrl);
const log = args.has("--json") ? () => {} : (m: string) => console.log(m);
try {
  const out = cmd === "run"
    ? await runBackup({ pool: db.adminPool, ops, log })
    : await runVerify({ pool: db.adminPool, ops, log, name });
  if (args.has("--json")) console.log(JSON.stringify(out, null, 2));
  if (!out.ok) {
    process.exitCode = 1;
    // Aviso inmediato a la plataforma (con la misma deduplicación que el monitor; simulado fuera de producción).
    const cond: AlertCondition = cmd === "run"
      ? { key: "backup_failed", severity: "critical", title: "El último respaldo falló", message: `El respaldo falló. Motivo: ${out.error}.` }
      : { key: "verify_failed", severity: "critical", title: "El último simulacro de restauración falló", message: `El simulacro de restauración${out.name ? ` de ${out.name}` : ""} falló. Motivo: ${out.error}.` };
    await processAlerts(db.adminPool, [cond], { ops, mailer: createMailer(cfg), log: (m) => console.error(m), outbox: [] }, new Date(), []).catch((e) => console.error(`No se pudo enviar la alerta: ${(e as Error).message}`));
  }
} catch (e) {
  console.error(`Error: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
