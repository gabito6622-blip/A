// Barrido de archivos clínicos huérfanos (B-081).
//   npm run files:sweep                 → simulación (no borra nada; equivale a --dry-run)
//   npm run files:sweep -- --apply      → borra huérfanos con más de 24 h
//   npm run files:sweep -- --json       → informe en JSON
// En la imagen de producción (sin tsx): node server/dist/cli/filesSweep.js [--apply] [--json]
// Código de salida: 0 bien; 2 si hay filas cuyo archivo falta (para alertar desde un cron); 1 error.
import { loadConfig } from "../config.js";
import { createDb } from "../lib/db.js";
import { createFileStore } from "../lib/filestore.js";
import { formatSweepReport, sweepFiles } from "../modules/clinicalFilesSweep.js";

const args = new Set(process.argv.slice(2));
const unknown = [...args].filter((a) => !["--apply", "--dry-run", "--json"].includes(a));
if (unknown.length || (args.has("--apply") && args.has("--dry-run"))) {
  console.error(`Uso: files:sweep [--dry-run | --apply] [--json]${unknown.length ? ` (opción desconocida: ${unknown.join(" ")})` : ""}`);
  process.exit(1);
}
const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
try {
  const report = await sweepFiles(db.adminPool, createFileStore(cfg), { apply: args.has("--apply") });
  console.log(args.has("--json") ? JSON.stringify(report, null, 2) : formatSweepReport(report));
  if (report.missing.length) process.exitCode = 2;
} catch (e) {
  console.error(`No se pudo completar el barrido: ${(e as Error).message}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
