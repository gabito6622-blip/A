// Diagnóstico de carga (no corre en CI): llama una ruta con la app real y lista las consultas SQL
// más lentas que ejecutó, con su EXPLAIN (ANALYZE, BUFFERS) opcional.
//
//   PERF_DATABASE_URL=… npx tsx scripts/perf-trace.ts "/api/activity" [--explain] [--as=recepcion1@perf.dentalia.test]
import pg from "pg";

const url = process.env.PERF_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_perf";
process.env.DATABASE_URL = url;
process.env.DENTAL_DISABLE_RATE_LIMIT = "1";
const target = process.argv[2];
if (!target) throw new Error("Indica la ruta, p. ej. /api/activity");
const explain = process.argv.includes("--explain");
const as = process.argv.find((a) => a.startsWith("--as="))?.slice(5) ?? "duena@perf.dentalia.test";

const { loadConfig } = await import("../server/src/config.js");
const { createDb } = await import("../server/src/lib/db.js");
const { buildApp } = await import("../server/src/app.js");
const { MemoryMailer } = await import("../server/src/lib/mailer.js");

const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
const app = await buildApp(cfg, db, { mailer: new MemoryMailer() });
await app.ready();
const login = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email: as, password: "Rendimiento2026" } });
const cookie = String(login.headers["set-cookie"]).split(";")[0]!;

type Q = { sql: string; params: unknown[]; ms: number; clinic: string | null };
const seen: Q[] = [];
let clinic: string | null = null;
const orig = pg.Client.prototype.query as (...a: any[]) => any;
(pg.Client.prototype as any).query = function (this: unknown, text: any, params?: any, cb?: any) {
  const sql = typeof text === "string" ? text : text?.text;
  const vals = typeof text === "string" ? params : text?.values;
  if (typeof sql === "string" && sql.includes("set_config('app.clinic_id'") && Array.isArray(vals)) clinic = vals[0] || clinic;
  const t = performance.now();
  const r = orig.call(this, text, params, cb);
  if (r && typeof r.then === "function" && typeof sql === "string") {
    r.then(() => seen.push({ sql, params: vals ?? [], ms: performance.now() - t, clinic }), () => {});
  }
  return r;
};

await app.inject({ method: "GET", url: target, headers: { cookie } }); // calentamiento
seen.length = 0;
const t = performance.now();
const res = await app.inject({ method: "GET", url: target, headers: { cookie } });
console.log(`${target} → ${res.statusCode} en ${(performance.now() - t).toFixed(0)} ms, ${seen.length} consultas`);
(pg.Client.prototype as any).query = orig;
const top = [...seen].sort((a, b) => b.ms - a.ms).slice(0, 4);
for (const q of top) {
  console.log(`\n--- ${q.ms.toFixed(1)} ms ---\n${q.sql.replace(/\s+/g, " ").slice(0, 900)}`);
  if (explain && /^\s*(SELECT|WITH)/i.test(q.sql)) {
    const c = await db.appPool.connect();
    try {
      await c.query("BEGIN");
      await c.query("SELECT set_config('app.clinic_id', $1, true)", [q.clinic ?? ""]);
      const plan = await c.query(`EXPLAIN (ANALYZE, BUFFERS) ${q.sql}`, q.params as unknown[]);
      console.log(plan.rows.map((r: any) => r["QUERY PLAN"]).join("\n"));
      await c.query("ROLLBACK");
    } finally { c.release(); }
  }
}
await app.close();
await db.close();
