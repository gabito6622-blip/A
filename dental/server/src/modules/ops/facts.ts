// «Hechos» de una base que se guardan con el respaldo y se vuelven a medir en el simulacro:
// conteo de filas por tabla, migraciones aplicadas y una muestra de saldos con patient_money_v.
// Nada de esto identifica a un paciente: la muestra se guarda como huella SHA-256.
import { createHash } from "node:crypto";
import type pg from "pg";

export interface DbFacts {
  tables: Record<string, number>;
  migrations: { name: string; checksum: string }[];
  balances: { patients: number; sampleSize: number; sampleDigest: string; aggregateDigest: string };
}

type Q = Pick<pg.ClientBase, "query">;
const ident = (s: string) => `"${s.replace(/"/g, '""')}"`;
export const BALANCE_SAMPLE = 25;

export async function collectFacts(c: Q, salt: string): Promise<DbFacts> {
  const names = (await c.query<{ t: string }>(
    `SELECT c.relname AS t FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' ORDER BY 1`)).rows.map((r) => r.t);
  const tables: Record<string, number> = {};
  if (names.length) {
    const sql = names.map((t, i) => `SELECT ${i} AS i, count(*)::bigint AS n FROM public.${ident(t)}`).join(" UNION ALL ");
    for (const r of (await c.query<{ i: number; n: string | number }>(sql)).rows) tables[names[r.i]!] = Number(r.n);
  }
  const migrations = names.includes("schema_migrations")
    ? (await c.query<{ name: string; checksum: string }>("SELECT name, checksum FROM schema_migrations ORDER BY name")).rows
    : [];
  // Muestra determinista (misma sal → mismos pacientes en la base restaurada) y agregados.
  const agg = (await c.query<{ patients: number; nonzero: number; total: string | number }>(
    `SELECT count(*)::int AS patients, count(*) FILTER (WHERE balance_cents <> 0)::int AS nonzero, COALESCE(sum(balance_cents), 0)::bigint AS total
       FROM patient_money_v`)).rows[0]!;
  const sample = (await c.query<{ patient_id: string; balance_cents: string | number }>(
    `SELECT patient_id, balance_cents FROM patient_money_v ORDER BY md5(patient_id::text || $1), patient_id LIMIT ${BALANCE_SAMPLE}`, [salt])).rows;
  const sampleDigest = createHash("sha256").update(sample.map((r) => `${r.patient_id}:${Number(r.balance_cents)}`).sort().join("\n")).digest("hex");
  const aggregateDigest = createHash("sha256").update(`${agg.patients}:${agg.nonzero}:${Number(agg.total)}`).digest("hex");
  return { tables, migrations, balances: { patients: agg.patients, sampleSize: sample.length, sampleDigest, aggregateDigest } };
}

/** Diferencias de conteo (tabla: esperado → obtenido). */
export function diffCounts(expected: Record<string, number>, actual: Record<string, number>): string[] {
  const out: string[] = [];
  for (const t of new Set([...Object.keys(expected), ...Object.keys(actual)])) {
    if (expected[t] !== actual[t]) out.push(`${t}: ${expected[t] ?? "no existía"} → ${actual[t] ?? "no existe"}`);
  }
  return out.sort();
}
