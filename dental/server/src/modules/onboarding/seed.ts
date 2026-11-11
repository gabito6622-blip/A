// Datos de demostración (100 % ficticios): una importación de saldos iniciales «del sistema anterior»
// para tres pacientes demo, con su lote y sus claves externas (así se ve cómo queda en la ficha y en
// el historial de importaciones).
import type pg from "pg";
import { DateTime } from "luxon";
import { createHash } from "node:crypto";

export async function seedOnboardingDemo(pool: pg.Pool, clinicId: string) {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  const owner = (await q("SELECT user_id FROM memberships WHERE clinic_id = $1 AND role = 'owner' LIMIT 1", [clinicId])).rows[0]?.user_id as string | undefined;
  if (!owner) return;
  const pts = (await q(
    `SELECT id, record_number, first_name || ' ' || last_name AS name, document_number FROM patients
      WHERE clinic_id = $1 AND record_number IN (85, 86, 87) ORDER BY record_number`, [clinicId])).rows as { id: string; record_number: number; name: string; document_number: string }[];
  if (pts.length < 3) return;
  const lpz = (await q("SELECT id FROM branches WHERE clinic_id = $1 AND code = 'LPZ'", [clinicId])).rows[0]?.id ?? null;
  const cutoff = DateTime.now().setZone("America/La_Paz").minus({ months: 1 }).endOf("month").toISODate()!;
  const amounts = [[35000, "Saldo de restauraciones (sistema anterior)", "S-0085"], [120000, "Ortodoncia: cuotas pendientes", "S-0086"], [-15000, "Adelanto para blanqueamiento", "S-0087"]] as const;
  const batchId = (await q("SELECT gen_random_uuid() AS id")).rows[0].id as string;
  const results = pts.map((p, i) => ({
    row: i + 2, status: "ok", ref: `Ficha ${p.record_number}`,
    values: { patientDoc: p.document_number, balance: (amounts[i]![0] / 100).toFixed(2).replace(".", ","), cutoffDate: cutoff, notes: amounts[i]![1], externalId: amounts[i]![2] },
  }));
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query(
      `INSERT INTO import_batches (id, clinic_id, kind, file_name, file_sha256, total_rows, created_count, duplicate_count, error_count, review_count, results, created_by, created_at)
       VALUES ($1,$2,'balances','saldos-sistema-anterior (demo).xlsx',$3,3,3,0,0,0,$4,$5, now() - interval '2 days')`,
      [batchId, clinicId, createHash("sha256").update(`demo-saldos-${clinicId}`).digest("hex"), JSON.stringify(results), owner]);
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i]!;
      const [cents, note, ext] = amounts[i]!;
      const ob = (await c.query(
        `INSERT INTO opening_balances (clinic_id, patient_id, branch_id, amount_cents, cutoff_date, notes, batch_id, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() - interval '2 days') RETURNING id`,
        [clinicId, p.id, lpz, cents, cutoff, note, batchId, owner])).rows[0].id;
      await c.query(
        `INSERT INTO import_records (clinic_id, batch_id, kind, external_key, source_row, patient_id, opening_balance_id, created_at)
         VALUES ($1,$2,'balances',$3,$4,$5,$6, now() - interval '2 days')`,
        [clinicId, batchId, `ext:${ext.toLowerCase()}`, i + 2, p.id, ob]);
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
