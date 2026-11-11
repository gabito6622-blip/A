// Semilla de CARGA (no corre en CI): llena una base aparte con el volumen de una clínica grande
// para medir los tiempos de respuesta (ver scripts/perf-bench.ts).
//
//   PERF_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:5432/dental_perf npx tsx scripts/perf-seed.ts
//
// Crea DESDE CERO la base indicada (su nombre debe contener "perf"; se borra si existe), aplica las
// migraciones y genera, con datos 100 % ficticios:
//   * 1 clínica, 5 sucursales, 4 consultorios por sucursal, 20 odontólogos, recepción, administración y contabilidad;
//   * ~100 000 pacientes; ~600 000 citas en 5 años (cada consultorio con turnos de 30 min, lunes a sábado);
//   * presupuestos (60 000), tratamientos, cargos y pagos proporcionales;
//   * ~1 000 000 de filas de auditoría.
// La carga masiva usa INSERT … SELECT generate_series con session_replication_role = replica (sin
// triggers ni chequeos de FK, que se respetan por construcción): tarda unos minutos.
// Variables opcionales: PERF_PATIENTS (100000), PERF_YEARS (5), PERF_BUDGETS (60000), PERF_AUDIT (1000000).
import pg from "pg";
import { migrate } from "../server/src/lib/migrate.js";
import { hashPassword } from "../server/src/lib/password.js";
import { seedCatalog } from "../server/src/lib/catalog.js";
import { seedConsentTemplates } from "../server/src/modules/consents.js";
import type { Client } from "../server/src/lib/db.js";

export const PERF_PASSWORD = "Rendimiento2026";
export const PERF_OWNER = "duena@perf.dentalia.test";

const url = new URL(process.env.PERF_DATABASE_URL ?? "postgres://postgres:postgres@127.0.0.1:5432/dental_perf");
const dbName = url.pathname.slice(1);
const N_PATIENTS = Number(process.env.PERF_PATIENTS ?? 100_000);
const YEARS = Number(process.env.PERF_YEARS ?? 5);
const N_BUDGETS = Number(process.env.PERF_BUDGETS ?? 60_000);
const N_AUDIT = Number(process.env.PERF_AUDIT ?? 1_000_000);

const FIRST = ["María", "José", "Juan", "Ana", "Luis", "Carmen", "Carlos", "Rosa", "Jorge", "Patricia", "Miguel", "Silvia", "Fernando", "Lucía",
  "Ricardo", "Elena", "Roberto", "Gabriela", "Mario", "Daniela", "Víctor", "Andrea", "Raúl", "Verónica", "Hugo", "Mónica", "Álvaro", "Paola",
  "Sergio", "Claudia", "René", "Ximena", "Óscar", "Valeria", "Marcelo", "Natalia", "Edwin", "Jimena", "Wilson", "Noemí"];
const LAST = ["Mamani", "Quispe", "Flores", "Choque", "Condori", "Gutiérrez", "Rojas", "Vargas", "Fernández", "López", "Pérez", "García",
  "Rodríguez", "Martínez", "Sánchez", "Torrez", "Limachi", "Huanca", "Apaza", "Ticona", "Cruz", "Romero", "Morales", "Ortiz", "Castillo",
  "Aguilar", "Medina", "Salazar", "Villca", "Callisaya", "Paz", "Soliz", "Zeballos", "Arce", "Montaño", "Cáceres", "Guzmán", "Rivera"];
const CITIES = ["La Paz", "El Alto", "Cochabamba", "Santa Cruz", "Sucre"];

const t0 = Date.now();
const step = (m: string) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1).padStart(6)} s] ${m}`);

async function main() {
  if (!/perf/.test(dbName)) throw new Error("La base de carga debe contener 'perf' en su nombre (se borra y se crea de nuevo)");
  const adminUrl = new URL(url);
  adminUrl.pathname = "/postgres";
  const a = new pg.Client({ connectionString: adminUrl.toString() });
  await a.connect();
  await a.query(`DROP DATABASE IF EXISTS "${dbName}" WITH (FORCE)`);
  await a.query(`CREATE DATABASE "${dbName}"`);
  await a.end();
  const pool = new pg.Pool({ connectionString: url.toString(), max: 2 });
  await migrate(pool);
  step("migraciones aplicadas");

  const c = (await pool.connect()) as unknown as Client;
  const q = async <T = any>(sql: string, p: unknown[] = []) => (await c.query(sql, p)).rows as T[];
  try {
    const pw = await hashPassword(PERF_PASSWORD);
    const plan = (await q("INSERT INTO plans (code, name, max_branches, max_users, price_cents) VALUES ('perf','Carga',10,200,0) RETURNING id"))[0].id;
    const clinicId = (await q("INSERT INTO clinics (slug, name, plan_id, status) VALUES ('clinica-carga','Clínica de Carga (ficticia)',$1,'active') RETURNING id", [plan]))[0].id as string;
    const mkUser = async (email: string, name: string, role: string, o: { all?: boolean; branches?: string[]; pro?: boolean; pct?: number } = {}) => {
      const id = (await q("INSERT INTO users (email, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id", [email, name, pw]))[0].id as string;
      await q("INSERT INTO memberships (clinic_id, user_id, role, all_branches, branch_ids, is_professional, commission_pct) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [clinicId, id, role, o.all ?? false, o.branches ?? [], o.pro ?? false, o.pct ?? null]);
      return id;
    };
    const owner = await mkUser(PERF_OWNER, "Dueña Carga", "owner", { all: true });
    await mkUser("admin@perf.dentalia.test", "Administración Carga", "admin", { all: true });
    await mkUser("conta@perf.dentalia.test", "Contabilidad Carga", "accountant", { all: true });
    const branches: string[] = [], chairs: { id: string; branch: string; dentist: string; rec: string }[] = [];
    const hours = JSON.stringify(Object.fromEntries([1, 2, 3, 4, 5, 6].map((d) => [String(d), [["08:00", "18:00"]]])));
    for (let b = 0; b < 5; b++) {
      const bid = (await q("INSERT INTO branches (clinic_id, code, name, city, opening_hours) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [clinicId, `S${b + 1}`, `Sucursal ${CITIES[b]}`, CITIES[b], hours]))[0].id as string;
      branches.push(bid);
      const rec = await mkUser(`recepcion${b + 1}@perf.dentalia.test`, `Recepción ${b + 1}`, "receptionist", { branches: [bid] });
      for (let k = 0; k < 4; k++) {
        const ch = (await q("INSERT INTO chairs (clinic_id, branch_id, name) VALUES ($1,$2,$3) RETURNING id", [clinicId, bid, `Consultorio ${k + 1}`]))[0].id as string;
        const dent = await mkUser(`odonto${b + 1}${k + 1}@perf.dentalia.test`, `Dr(a). ${LAST[b * 4 + k]} ${FIRST[b * 4 + k]}`, "dentist", { branches: [bid], pro: true, pct: 30 });
        for (let d = 1; d <= 6; d++) {
          await q("INSERT INTO dentist_schedules (clinic_id, dentist_id, branch_id, weekday, start_time, end_time, chair_id) VALUES ($1,$2,$3,$4,'08:00','18:00',$5)", [clinicId, dent, bid, d, ch]);
        }
        chairs.push({ id: ch, branch: bid, dentist: dent, rec });
      }
    }
    await seedCatalog(c, clinicId);
    await seedConsentTemplates(c, clinicId, null);
    step("clínica, 5 sucursales, 20 consultorios, personal y catálogo");

    await q("SET session_replication_role = replica");
    await q("SET maintenance_work_mem = '256MB'");
    await q("CREATE TEMP TABLE perf_chairs (ci int, chair_id uuid, branch_id uuid, dentist_id uuid, rec_id uuid)");
    for (const [i, ch] of chairs.entries()) await q("INSERT INTO perf_chairs VALUES ($1,$2,$3,$4,$5)", [i, ch.id, ch.branch, ch.dentist, ch.rec]);
    await q("CREATE TEMP TABLE perf_procs AS SELECT row_number() OVER (ORDER BY code) - 1 AS pi, id, name, price_cents, duration_min FROM procedures WHERE clinic_id = $1", [clinicId]);
    const nProcs = (await q("SELECT count(*)::int AS n FROM perf_procs"))[0].n as number;

    // ---------------- Pacientes ----------------
    await q(
      `INSERT INTO patients (clinic_id, record_number, first_name, last_name, document_type, document_number, document_issued, birth_date, sex, phone,
                             city, preferred_branch_id, consent_reminders, consent_marketing, search_text, created_by, created_at, updated_at)
       SELECT $1, g, f.fn, f.ln, 'CI', (3000000 + g * 7)::text, 'LP', date '1945-01-01' + ((g * 7919) % 27000), CASE WHEN g % 2 = 0 THEN 'F' ELSE 'M' END,
              '+5917' || lpad(((g::bigint * 104729) % 10000000)::text, 7, '0'), ($4::text[])[1 + g % 5], ($5::uuid[])[1 + g % 5], g % 4 <> 0, g % 3 = 0,
              translate(lower(f.fn || ' ' || f.ln || ' ' || (3000000 + g * 7)::text || ' +5917' || lpad(((g::bigint * 104729) % 10000000)::text, 7, '0') || ' ' || g), 'áéíóúüñ', 'aeiouun'),
              $6, now() - make_interval(days => ($7 * 365 * (g::numeric / $8))::int), now()
         FROM generate_series(1, $8) g
         CROSS JOIN LATERAL (SELECT $2::text[] AS fa, $3::text[] AS la) arr
         CROSS JOIN LATERAL (SELECT arr.fa[1 + (g * 31) % cardinality(arr.fa)] AS fn,
                                    arr.la[1 + (g * 17) % cardinality(arr.la)] || ' ' || arr.la[1 + (g * 53) % cardinality(arr.la)] AS ln) f`,
      [clinicId, FIRST, LAST, CITIES, branches, owner, YEARS, N_PATIENTS]);
    await q("INSERT INTO counters (clinic_id, name, value) VALUES ($1, 'patient', $2)", [clinicId, N_PATIENTS]);
    await q("CREATE TEMP TABLE perf_pat AS SELECT (record_number - 1)::int AS i, id, preferred_branch_id FROM patients WHERE clinic_id = $1", [clinicId]);
    await q("CREATE UNIQUE INDEX ON perf_pat (i)");
    step(`${N_PATIENTS.toLocaleString("es-BO")} pacientes`);

    // ---------------- Citas (grilla de 30 min por consultorio; un paciente distinto por turno) ----------------
    await q(
      `INSERT INTO appointments (clinic_id, branch_id, chair_id, dentist_id, patient_id, procedure_id, starts_at, ends_at, status, source,
                                 created_by, created_at, updated_at, confirmed_at, arrived_at, completed_at, cancelled_at, cancel_reason)
       SELECT $1, x.branch_id, x.chair_id, x.dentist_id, p.id, pr.id, x.st, x.st + interval '30 minutes', x.status,
              (ARRAY['reception','phone','whatsapp','portal','walk_in'])[1 + x.h % 5], x.rec_id, x.st - make_interval(days => (1 + x.h % 20)::int), x.st,
              CASE WHEN x.status IN ('confirmed','completed') THEN x.st - interval '1 day' END,
              CASE WHEN x.status = 'completed' THEN x.st - make_interval(mins => (x.h % 15)::int) END,
              CASE WHEN x.status = 'completed' THEN x.st + make_interval(mins => (25 + x.h % 15)::int) END,
              CASE WHEN x.status = 'cancelled' THEN x.st - interval '2 days' END,
              CASE WHEN x.status = 'cancelled' THEN 'El paciente avisó que no puede' END
         FROM (
           SELECT g.*, (g.seq * 48271) % 100 AS h,
                  CASE WHEN g.st < now() THEN
                         CASE WHEN (g.seq * 48271) % 100 < 6 THEN 'no_show' WHEN (g.seq * 48271) % 100 < 13 THEN 'cancelled' ELSE 'completed' END
                       ELSE CASE WHEN (g.seq * 48271) % 100 < 5 THEN 'cancelled' WHEN (g.seq * 48271) % 100 < 35 THEN 'confirmed' ELSE 'scheduled' END END AS status
             FROM (
               SELECT ((d.day + time '08:00' + s.s * interval '30 minutes') AT TIME ZONE 'America/La_Paz') AS st, ch.*,
                      row_number() OVER (ORDER BY d.day, s.s, ch.ci) AS seq
                 FROM (SELECT dd::date AS day FROM generate_series((current_date - ($2::int * 365 - 30))::timestamp, (current_date + 30)::timestamp, interval '1 day') dd
                        WHERE extract(isodow FROM dd) < 7) d
                 CROSS JOIN generate_series(0, 19) s(s)
                 CROSS JOIN perf_chairs ch
             ) g
         ) x
         JOIN perf_pat p ON p.i = (x.seq * 7919) % $3
         JOIN perf_procs pr ON pr.pi = (x.seq * 13) % $4
        WHERE (x.seq * 2654435761) % 100 >= 4`,
      [clinicId, YEARS, N_PATIENTS, nProcs]);
    const nAppts = (await q("SELECT count(*)::int AS n FROM appointments"))[0].n as number;
    step(`${nAppts.toLocaleString("es-BO")} citas`);

    // ---------------- Presupuestos, tratamientos, cargos y pagos ----------------
    await q(
      `INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, status, installments, created_by, created_at, presented_at, decided_at, valid_until)
       SELECT $1, b.n, p.preferred_branch_id, p.id, ch.dentist_id, b.status, 1 + b.n % 3, ch.dentist_id, b.at,
              CASE WHEN b.status <> 'draft' THEN b.at + interval '1 hour' END,
              CASE WHEN b.status IN ('accepted','completed','rejected') THEN b.at + interval '2 days' END, (b.at + interval '30 days')::date
         FROM (SELECT g AS n, (g * 7) % $3 AS pi,
                      CASE WHEN g % 10 < 4 THEN 'completed' WHEN g % 10 < 6 THEN 'accepted' WHEN g % 10 < 8 THEN 'presented' WHEN g % 10 = 8 THEN 'rejected' ELSE 'draft' END AS status,
                      now() - make_interval(days => ($4 * 365 * (1 - g::numeric / $2))::int + 3) AS at
                 FROM generate_series(1, $2) g) b
         JOIN perf_pat p ON p.i = b.pi
         JOIN perf_chairs ch ON ch.branch_id = p.preferred_branch_id AND ch.ci % 4 = b.n % 4`,
      [clinicId, N_BUDGETS, N_PATIENTS, YEARS]);
    await q("INSERT INTO counters (clinic_id, name, value) VALUES ($1, 'budget', $2)", [clinicId, N_BUDGETS]);
    await q(
      `INSERT INTO budget_items (clinic_id, budget_id, procedure_id, tooth, description, quantity, unit_price_cents, status, performed_by, performed_at, position)
       SELECT $1, b.id, pr.id, CASE WHEN k % 2 = 0 THEN 11 + (b.number % 7) END, pr.name, 1, pr.price_cents,
              CASE WHEN b.status = 'completed' OR (b.status = 'accepted' AND k = 1) THEN 'done' ELSE 'pending' END,
              CASE WHEN b.status = 'completed' OR (b.status = 'accepted' AND k = 1) THEN b.dentist_id END,
              CASE WHEN b.status = 'completed' OR (b.status = 'accepted' AND k = 1) THEN b.created_at + make_interval(days => (5 + k * 7)::int) END, k
         FROM budgets b CROSS JOIN LATERAL generate_series(1, 1 + b.number % 4) k
         JOIN perf_procs pr ON pr.pi = (b.number * 11 + k * 5) % $2
        WHERE b.clinic_id = $1`, [clinicId, nProcs]);
    await q(
      `INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, dentist_id, description, amount_cents, created_by, created_at)
       SELECT $1, b.branch_id, b.patient_id, i.id, i.performed_by, i.description, i.net_cents, i.performed_by, i.performed_at
         FROM budget_items i JOIN budgets b ON b.id = i.budget_id WHERE i.status = 'done' AND i.net_cents > 0`, [clinicId]);
    // Pagos: los presupuestos terminados quedan pagados casi siempre; los aceptados, en parte.
    await q(
      `INSERT INTO payments (clinic_id, receipt_number, branch_id, patient_id, budget_id, amount_cents, method, status, bank_reference,
                             idempotency_key, received_by, received_at, verified_by, verified_at)
       SELECT $1, row_number() OVER (ORDER BY x.at, x.budget_id, x.part), x.branch_id, x.patient_id, x.budget_id, x.amount, x.method,
              CASE WHEN x.method = 'cash' THEN 'confirmed' WHEN x.h < 8 AND x.at > now() - interval '20 days' THEN 'pending_verification' ELSE 'confirmed' END,
              CASE WHEN x.method <> 'cash' THEN 'OP-' || x.number || '-' || x.part END,
              'perf-' || x.number || '-' || x.part, ch.rec_id, x.at,
              CASE WHEN x.method <> 'cash' THEN ch.rec_id END, CASE WHEN x.method <> 'cash' THEN x.at + interval '1 day' END
         FROM (
           SELECT b.id AS budget_id, b.number, b.branch_id, b.patient_id, part,
                  CASE WHEN b.status = 'completed' THEN t.total / 2 ELSE t.total / 4 END AS amount,
                  (ARRAY['cash','cash','cash','transfer','qr','card','cash','transfer','qr','cash'])[1 + (b.number + part) % 10] AS method,
                  (b.number * 31 + part) % 100 AS h, b.created_at + make_interval(days => (3 + part * 10)::int) AS at
             FROM budgets b
             JOIN LATERAL (SELECT sum(net_cents) AS total FROM budget_items i WHERE i.budget_id = b.id) t ON true
             CROSS JOIN generate_series(1, 2) part
            WHERE b.status IN ('completed','accepted') AND (b.status = 'completed' AND b.number % 12 <> 0 OR part = 1) AND t.total >= 4
         ) x
         JOIN perf_chairs ch ON ch.branch_id = x.branch_id AND ch.ci % 4 = 0
        WHERE x.at < now()`, [clinicId]);
    const nPay = (await q("SELECT count(*)::int AS n, max(receipt_number) AS m FROM payments"))[0];
    await q("INSERT INTO counters (clinic_id, name, value) VALUES ($1, 'receipt', $2)", [clinicId, nPay.m ?? 0]);
    const nItems = (await q("SELECT (SELECT count(*) FROM budget_items)::int AS i, (SELECT count(*) FROM charges)::int AS c"))[0];
    step(`${N_BUDGETS.toLocaleString("es-BO")} presupuestos, ${nItems.i.toLocaleString("es-BO")} tratamientos, ${nItems.c.toLocaleString("es-BO")} cargos, ${nPay.n.toLocaleString("es-BO")} pagos`);

    // ---------------- Auditoría (~1 millón de filas) ----------------
    await q(
      `INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, ip, created_at)
       SELECT a.clinic_id, a.created_by, 'appointment.created', 'appointment', a.id::text, a.branch_id,
              jsonb_build_object('startsAt', a.starts_at, 'dentistId', a.dentist_id, 'patientId', a.patient_id), '10.0.0.1', a.created_at
         FROM appointments a`);
    await q(
      `INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, ip, created_at)
       SELECT p.clinic_id, p.received_by, 'payment.created', 'payment', p.id::text, p.branch_id,
              jsonb_build_object('amountCents', p.amount_cents, 'method', p.method, 'status', p.status, 'receipt', p.receipt_number), '10.0.0.1', p.received_at
         FROM payments p`);
    await q(
      `INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, ip, created_at)
       SELECT p.clinic_id, p.created_by, 'patient.created', 'patient', p.id::text, p.preferred_branch_id, jsonb_build_object('recordNumber', p.record_number), '10.0.0.1', p.created_at
         FROM patients p`);
    const have = (await q("SELECT count(*)::int AS n FROM audit_log"))[0].n as number;
    if (have < N_AUDIT) {
      await q(
        `INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, ip, created_at)
         SELECT $1, ch.rec_id, 'auth.login', 'user', ch.rec_id::text, NULL, '{}'::jsonb, '10.0.0.' || (g % 250), now() - make_interval(secs => (g::numeric / $2 * $3 * 365 * 86400)::int)
           FROM generate_series(1, $2) g JOIN perf_chairs ch ON ch.ci = (g * 4) % 20`,
        [clinicId, N_AUDIT - have, YEARS]);
    }
    step(`${(await q("SELECT count(*)::int AS n FROM audit_log"))[0].n.toLocaleString("es-BO")} filas de auditoría`);

    await q("SET session_replication_role = origin");
    await q("VACUUM (ANALYZE)").catch(async () => { await q("ANALYZE"); });
    const sizes = await q(`SELECT relname, pg_size_pretty(pg_total_relation_size(c.oid)) AS size FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                            WHERE n.nspname = 'public' AND relkind = 'r' ORDER BY pg_total_relation_size(c.oid) DESC LIMIT 6`);
    step(`ANALYZE listo. Tablas más grandes: ${sizes.map((s) => `${s.relname} ${s.size}`).join(", ")}`);
    console.log(`\nListo. Ingresa con ${PERF_OWNER} / ${PERF_PASSWORD} (datos ficticios) o corre scripts/perf-bench.ts.`);
  } finally {
    c.release();
    await pool.end();
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
