// Medición de tiempos de respuesta con la app real (fastify.inject: rutas, permisos, RLS y
// serialización incluidos; sin red). No corre en CI. Requiere la base de scripts/perf-seed.ts.
//
//   PERF_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/dental_perf npx tsx scripts/perf-bench.ts
//
// Opciones (variables de entorno): PERF_REPS (repeticiones medidas, 15), PERF_WARMUP (2),
// PERF_ONLY (filtra por nombre, p. ej. "Panel"), PERF_OUT (guarda el resultado en JSON).
// Objetivo orientativo: p95 < 300 ms en pantallas diarias y < 2 s en informes mensuales.
import { writeFileSync } from "node:fs";
import { DateTime } from "luxon";

const url = process.env.PERF_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_perf";
process.env.DATABASE_URL = url;
process.env.DENTAL_DISABLE_RATE_LIMIT = "1";
const REPS = Number(process.env.PERF_REPS ?? 15);
const WARMUP = Number(process.env.PERF_WARMUP ?? 2);
const ONLY = process.env.PERF_ONLY ?? "";

const { loadConfig } = await import("../server/src/config.js");
const { createDb } = await import("../server/src/lib/db.js");
const { buildApp } = await import("../server/src/app.js");
const { MemoryMailer } = await import("../server/src/lib/mailer.js");

const PASSWORD = "Rendimiento2026";
const cfg = loadConfig();
const db = createDb(cfg.databaseUrl);
const app = await buildApp(cfg, db, { mailer: new MemoryMailer() });
await app.ready();

async function session(email: string) {
  const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { email, password: PASSWORD } });
  if (r.statusCode !== 200) throw new Error(`No se pudo ingresar como ${email}: ${r.body}. ¿Corriste scripts/perf-seed.ts?`);
  return String(r.headers["set-cookie"]).split(";")[0]!;
}

const q = async <T = any>(sql: string, p: unknown[] = []) => (await db.adminPool.query(sql, p)).rows as T[];
const owner = await session("duena@perf.dentalia.test");
const recep = await session("recepcion1@perf.dentalia.test");
const dentist = await session("odonto11@perf.dentalia.test");
const branch = (await q("SELECT id FROM branches WHERE code = 'S1'"))[0].id as string;
const dentistId = (await q("SELECT id FROM users WHERE email = 'odonto11@perf.dentalia.test'"))[0].id as string;
// Paciente con historia larga (muchas citas, presupuestos y pagos) y uno cualquiera.
const heavy = (await q(`SELECT a.patient_id AS id FROM appointments a
                         WHERE a.patient_id IN (SELECT b.patient_id FROM budgets b WHERE b.status = 'completed')
                         GROUP BY a.patient_id ORDER BY count(*) DESC LIMIT 1`))[0].id as string;
const someone = (await q("SELECT id, last_name FROM patients ORDER BY record_number OFFSET 54321 LIMIT 1"))[0];
const zone = "America/La_Paz";
const now = DateTime.now().setZone(zone);
// Un día hábil (lunes a sábado) de esta semana o la siguiente.
let day = now.startOf("day");
while (day.weekday === 7) day = day.plus({ days: 1 });
const dayISO = day.toISODate()!;
const monday = day.startOf("week").toISODate()!;
const prevMonth = now.minus({ months: 1 });
const mFrom = prevMonth.startOf("month").toISODate()!, mTo = prevMonth.endOf("month").toISODate()!;
const dFrom = day.startOf("day").toUTC().toISO()!, dTo = day.endOf("day").toUTC().toISO()!;

interface Case { name: string; kind: "diaria" | "informe"; url: string; cookie: string }
const C = (name: string, kind: Case["kind"], url: string, cookie = owner): Case => ({ name, kind, url, cookie });
const cases: Case[] = [
  C("Buscar paciente por apellido", "diaria", `/api/patients?q=${encodeURIComponent(someone.last_name.split(" ")[0])}`, recep),
  C("Buscar paciente por nombre y apellido", "diaria", `/api/patients?q=${encodeURIComponent("maria mamani")}`, recep),
  C("Buscar paciente por CI", "diaria", "/api/patients?q=3054321", recep),
  C("Lista de pacientes (sin filtro)", "diaria", "/api/patients", recep),
  C("Ficha del paciente", "diaria", `/api/patients/${heavy}`, recep),
  C("Cuenta del paciente", "diaria", `/api/patients/${heavy}/account`, recep),
  C("Historial del paciente (timeline)", "diaria", `/api/patients/${heavy}/timeline`, owner),
  C("Agenda del día (sucursal)", "diaria", `/api/appointments?from=${encodeURIComponent(dFrom)}&to=${encodeURIComponent(dTo)}&branchId=${branch}`, recep),
  C("Agenda de la semana", "diaria", `/api/agenda/week?branchId=${branch}&from=${monday}`, recep),
  C("Ocupación del mes (mini calendario)", "diaria", `/api/agenda/occupancy?branchId=${branch}&month=${now.toFormat("yyyy-MM")}`, recep),
  C("Disponibilidad del día", "diaria", `/api/availability?date=${dayISO}&branchId=${branch}`, recep),
  C("Mi día (odontólogo)", "diaria", "/api/my-day", dentist),
  C("Inicio: tarjetas", "diaria", "/api/home/cards", recep),
  C("Caja del día", "diaria", `/api/cash-summary?date=${dayISO}`, owner),
  C("Pagos por verificar", "diaria", "/api/payments?status=pending_verification", owner),
  C("Presupuestos presentados", "diaria", "/api/budgets?status=presented", owner),
  C("Diario de actividad (1.ª página)", "diaria", "/api/activity", owner),
  C("Diario de actividad por sucursal", "diaria", `/api/activity?branchId=${branch}`, owner),
  C("Auditoría", "diaria", "/api/audit", owner),
  C("Panel del mes", "informe", `/api/reports/dashboard?from=${mFrom}&to=${mTo}`, owner),
  C("Panel con comparación", "informe", `/api/reports/dashboard-compare?from=${mFrom}&to=${mTo}`, owner),
  C("Producción por profesional (mes)", "informe", `/api/reports/production-by-dentist?from=${mFrom}&to=${mTo}`, owner),
  C("Cuentas por cobrar", "informe", "/api/reports/receivables", owner),
  C("Pacientes sin próxima cita", "informe", "/api/reports/patients-without-next-appointment", owner),
  C("Calidad de la atención (mes)", "informe", `/api/reports/visit-quality?from=${mFrom}&to=${mTo}`, owner),
  C("Embudo de presupuestos", "informe", "/api/budget-funnel", owner),
  C("Exportar pagos del mes (Excel)", "informe", `/api/reports/payments.xlsx?from=${mFrom}&to=${mTo}`, owner),
  C("Exportar pacientes (Excel, 100 000)", "informe", "/api/patients/export.xlsx", owner),
].filter((c) => !ONLY || c.name.toLowerCase().includes(ONLY.toLowerCase()));

const pct = (xs: number[], p: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.ceil((p / 100) * s.length) - 1)]!;
};

const results: { name: string; kind: string; status: number; p50: number; p95: number; max: number; bytes: number; ok: boolean }[] = [];
for (const k of cases) {
  const times: number[] = [];
  let status = 0, bytes = 0;
  const reps = k.url.includes("export.xlsx") ? Math.min(REPS, 5) : REPS;
  for (let i = 0; i < WARMUP + reps; i++) {
    const t = performance.now();
    const r = await app.inject({ method: "GET", url: k.url, headers: { cookie: k.cookie } });
    const ms = performance.now() - t;
    status = r.statusCode;
    bytes = r.rawPayload.length;
    if (status !== 200) { console.error(`${k.name}: ${status} ${r.body.slice(0, 300)}`); break; }
    if (i >= WARMUP) times.push(ms);
  }
  if (!times.length) { results.push({ name: k.name, kind: k.kind, status, p50: NaN, p95: NaN, max: NaN, bytes, ok: false }); continue; }
  const p50 = pct(times, 50), p95 = pct(times, 95);
  const ok = p95 < (k.kind === "diaria" ? 300 : 2000);
  results.push({ name: k.name, kind: k.kind, status, p50, p95, max: Math.max(...times), bytes, ok });
  console.log(`${ok ? "✓" : "✗"} ${k.name.padEnd(42)} p50 ${p50.toFixed(0).padStart(6)} ms  p95 ${p95.toFixed(0).padStart(6)} ms  (${k.kind}, ${(bytes / 1024).toFixed(0)} kB)`);
}

const counts = (await q(`SELECT (SELECT count(*) FROM patients)::int AS patients, (SELECT count(*) FROM appointments)::int AS appointments,
  (SELECT count(*) FROM budgets)::int AS budgets, (SELECT count(*) FROM charges)::int AS charges, (SELECT count(*) FROM payments)::int AS payments,
  (SELECT count(*) FROM audit_log)::int AS audit`))[0];
console.log(`\nVolumen: ${JSON.stringify(counts)}`);
console.log("\n| Endpoint | Tipo | p50 (ms) | p95 (ms) | Objetivo |\n|---|---|---:|---:|---|");
for (const r of results) console.log(`| ${r.name} | ${r.kind} | ${r.p50.toFixed(0)} | ${r.p95.toFixed(0)} | ${r.ok ? "cumple" : "NO cumple"} |`);
if (process.env.PERF_OUT) writeFileSync(process.env.PERF_OUT, JSON.stringify({ at: new Date().toISOString(), counts, results }, null, 2));
await app.close();
await db.close();
