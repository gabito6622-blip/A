// Semilla de demostración (datos ficticios): tipos de cita, tipo de las citas demo según su
// prestación y una serie mensual de controles de ortodoncia en Cochabamba a las 18:30
// (horario que la agenda demo deja libre).
import type pg from "pg";
import { DateTime } from "luxon";
import { seedAppointmentTypesDemo } from "./appointmentTypes.js";

export async function seedAgendaPlusDemo(pool: pg.Pool, clinicId: string) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await seedAppointmentTypesDemo(c, clinicId);
    const ctx = (await c.query<{ branch_id: string; dentist_id: string; type_id: string; proc_id: string | null; patient_id: string; owner_id: string }>(
      `SELECT b.id AS branch_id, m.user_id AS dentist_id, t.id AS type_id, t.procedure_id AS proc_id,
              (SELECT id FROM patients WHERE clinic_id = $1 ORDER BY record_number LIMIT 1) AS patient_id,
              (SELECT user_id FROM memberships WHERE clinic_id = $1 AND role = 'owner' LIMIT 1) AS owner_id
         FROM branches b JOIN memberships m ON m.clinic_id = b.clinic_id AND m.is_professional AND b.id = ANY(m.branch_ids)
         JOIN appointment_types t ON t.clinic_id = b.clinic_id AND t.name = 'Ortodoncia'
        WHERE b.clinic_id = $1 AND b.code = 'CBB' LIMIT 1`, [clinicId])).rows[0];
    if (!ctx?.patient_id) { await c.query("COMMIT"); return { series: 0, appointments: 0 }; }
    const zone = "America/La_Paz";
    let first = DateTime.now().setZone(zone).plus({ days: 3 }).set({ hour: 18, minute: 30, second: 0, millisecond: 0 });
    while (first.weekday > 5) first = first.plus({ days: 1 });
    const seriesId = (await c.query<{ id: string }>(
      `INSERT INTO appointment_series (clinic_id, branch_id, patient_id, dentist_id, appointment_type_id, procedure_id, frequency, interval_n, count_n,
          first_starts_at, duration_min, reason, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,'monthly',1,6,$7,30,'Controles mensuales de ortodoncia',$8) RETURNING id`,
      [clinicId, ctx.branch_id, ctx.patient_id, ctx.dentist_id, ctx.type_id, ctx.proc_id, first.toJSDate(), ctx.owner_id])).rows[0]!.id;
    let n = 0;
    for (let k = 0; k < 6; k++) {
      const s = first.plus({ months: k });
      if (s.weekday > 5) continue; // fin de semana: esa ocurrencia no se agenda (como un conflicto)
      await c.query("SAVEPOINT demo_occ");
      try {
        await c.query(
          `INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, procedure_id, appointment_type_id, series_id, series_index, starts_at, ends_at, reason, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'Control mensual de ortodoncia',$11)`,
          [clinicId, ctx.branch_id, ctx.dentist_id, ctx.patient_id, ctx.proc_id, ctx.type_id, seriesId, k + 1, s.toJSDate(), s.plus({ minutes: 30 }).toJSDate(), ctx.owner_id]);
        await c.query("RELEASE SAVEPOINT demo_occ");
        n++;
      } catch {
        await c.query("ROLLBACK TO SAVEPOINT demo_occ");
      }
    }
    await c.query("COMMIT");
    return { series: 1, appointments: n };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
