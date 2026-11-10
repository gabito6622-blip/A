// Datos de demostración (100 % ficticios) de tiempos de la cita, controles e intentos.
// Se llama desde la semilla demo después de crear las citas. Determinista: mismos datos en cada ejecución.
import type pg from "pg";
import { DateTime } from "luxon";

const ZONE = "America/La_Paz";
const MIN = 60_000;

export async function seedRecallsDemo(pool: pg.Pool, clinicId: string) {
  let seed = 7_302_026;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const between = (a: number, b: number) => a + Math.floor(rnd() * (b - a + 1));
  const now = Date.now();
  const q = <T extends pg.QueryResultRow = any>(sql: string, p: unknown[] = []) => pool.query<T>(sql, p);
  const today = DateTime.now().setZone(ZONE).startOf("day");

  // 1) Algunas citas de los últimos días quedan "sin cerrar" (para la lista de la sala de espera).
  const recent = (await q<{ id: string; branch_code: string }>(
    `SELECT a.id, b.code AS branch_code FROM appointments a JOIN branches b ON b.id = a.branch_id
      WHERE a.clinic_id = $1 AND a.status = 'completed' AND a.starts_at >= $2 AND a.starts_at < $3 ORDER BY a.starts_at, a.id`,
    [clinicId, today.minus({ days: 3 }).toJSDate(), today.toJSDate()])).rows;
  const lpz = recent.filter((r) => r.branch_code === "LPZ").slice(0, 2);
  const other = recent.filter((r) => r.branch_code !== "LPZ").slice(0, 2);
  const unclosed = [...lpz, ...other];
  const unclosedStatus = ["confirmed", "arrived", "scheduled", "in_progress"];
  for (const [i, u] of unclosed.entries()) await q("UPDATE appointments SET status = $2 WHERE id = $1", [u.id, unclosedStatus[i % 4]]);

  // 2) Eventos de estado con horas plausibles (llegada, espera, duración).
  const appts = (await q<{ id: string; branch_id: string; status: string; starts_at: Date; ends_at: Date }>(
    "SELECT id, branch_id, status, starts_at, ends_at FROM appointments WHERE clinic_id = $1 ORDER BY starts_at, id", [clinicId])).rows;
  const ev = { appt: [] as string[], branch: [] as string[], from: [] as (string | null)[], to: [] as string[], at: [] as Date[] };
  const clamp = (t: number) => new Date(Math.min(t, now - MIN));
  const push = (a: { id: string; branch_id: string }, from: string | null, to: string, t: number) => {
    ev.appt.push(a.id); ev.branch.push(a.branch_id); ev.from.push(from); ev.to.push(to); ev.at.push(clamp(t));
  };
  for (const a of appts) {
    const start = a.starts_at.getTime();
    const planned = a.ends_at.getTime() - start;
    let cur = "scheduled";
    push(a, null, "scheduled", start - between(1, 14) * 86_400_000);
    const go = (to: string, t: number) => { push(a, cur, to, t); cur = to; };
    if (a.status === "confirmed" || (["arrived", "in_progress", "completed"].includes(a.status) && rnd() < 0.5)) go("confirmed", start - between(18, 30) * 3_600_000);
    if (["arrived", "in_progress", "completed"].includes(a.status)) {
      // Llegada: la mayoría puntual, algunos temprano y otros tarde.
      const r = rnd();
      const arrival = start + (r < 0.25 ? -between(6, 15) : r < 0.75 ? between(-5, 5) : r < 0.92 ? between(6, 15) : between(16, 30)) * MIN;
      go("arrived", arrival);
      if (a.status !== "arrived") {
        const wait = (rnd() < 0.6 ? between(0, 8) : rnd() < 0.8 ? between(9, 20) : between(21, 40)) * MIN;
        const started = Math.max(arrival, start - 5 * MIN) + wait;
        go("in_progress", started);
        if (a.status === "completed") go("completed", started + Math.round(planned * (0.75 + rnd() * 0.6)));
      }
      await q("UPDATE appointments SET arrived_at = $2, completed_at = $3 WHERE id = $1",
        [a.id, clamp(arrival), a.status === "completed" ? ev.at[ev.at.length - 1] : null]);
    } else if (a.status === "no_show") go("no_show", start + between(20, 60) * MIN);
    else if (a.status === "cancelled") go("cancelled", start - between(2, 48) * 3_600_000);
  }
  // Orden temporal coherente dentro de cada cita (las horas recortadas al "ahora" pueden coincidir).
  for (let i = 1; i < ev.appt.length; i++) {
    if (ev.appt[i] === ev.appt[i - 1] && ev.at[i]! <= ev.at[i - 1]!) ev.at[i] = new Date(ev.at[i - 1]!.getTime() + 1000);
  }
  await q(
    `INSERT INTO appointment_events (clinic_id, appointment_id, branch_id, from_status, to_status, occurred_at)
     SELECT $1, * FROM unnest($2::uuid[], $3::uuid[], $4::text[], $5::text[], $6::timestamptz[])`,
    [clinicId, ev.appt, ev.branch, ev.from, ev.to, ev.at],
  );

  // 3) Controles: "Próximo control" de citas atendidas con prestación que tiene intervalo.
  const done = (await q<{ id: string; patient_id: string; branch_id: string; dentist_id: string; starts_at: Date; procedure_id: string; name: string; months: number }>(
    `SELECT a.id, a.patient_id, a.branch_id, a.dentist_id, a.starts_at, a.procedure_id, pr.name, pr.recall_months AS months
       FROM appointments a JOIN procedures pr ON pr.id = a.procedure_id
      WHERE a.clinic_id = $1 AND a.status = 'completed' AND pr.recall_months IS NOT NULL ORDER BY a.starts_at, a.id`, [clinicId])).rows;
  const recallIds: { id: string; branch_id: string; patient_id: string; due: string }[] = [];
  const pendingByPatient = new Set<string>();
  for (const a of done) {
    if (rnd() < 0.3) continue; // "Ahora no"
    const due = DateTime.fromJSDate(a.starts_at, { zone: ZONE }).plus({ months: a.months }).toISODate()!;
    const r = await q<{ id: string }>(
      `INSERT INTO recalls (clinic_id, patient_id, branch_id, procedure_id, dentist_id, reason, due_date, priority, origin, source_appointment_id, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,'completion',$9,$10) ON CONFLICT DO NOTHING RETURNING id`,
      [clinicId, a.patient_id, a.branch_id, a.procedure_id, a.dentist_id, a.name, due, rnd() < 0.15 ? "high" : "normal", a.id, a.starts_at]);
    if (r.rows[0]) { recallIds.push({ id: r.rows[0].id, branch_id: a.branch_id, patient_id: a.patient_id, due }); pendingByPatient.add(a.patient_id); }
  }
  // Controles cargados a mano con fecha ya vencida o cercana (pacientes que vinieron hace meses).
  const pts = (await q<{ id: string; branch_id: string }>(
    `SELECT id, preferred_branch_id AS branch_id FROM patients WHERE clinic_id = $1 AND preferred_branch_id IS NOT NULL ORDER BY record_number`, [clinicId])).rows
    .filter((p) => !pendingByPatient.has(p.id));
  const reasons = ["Higiene dental", "Revisión general", "Control de ortodoncia", "Revisión de implante", "Control postoperatorio"];
  const manual: typeof recallIds = [];
  for (const [i, p] of pts.slice(0, 24).entries()) {
    const due = today.plus({ days: i < 12 ? -between(1, 50) : between(0, 25) }).toISODate()!;
    const r = await q<{ id: string }>(
      `INSERT INTO recalls (clinic_id, patient_id, branch_id, reason, due_date, priority, origin, note, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,'manual',$7, now() - interval '120 days') RETURNING id`,
      [clinicId, p.id, p.branch_id, reasons[i % reasons.length], due, i % 5 === 0 ? "high" : i % 7 === 0 ? "low" : "normal", i % 4 === 0 ? "Prefiere que lo llamen por la tarde" : null]);
    manual.push({ id: r.rows[0]!.id, branch_id: p.branch_id, patient_id: p.id, due });
  }
  // 4) Intentos de contacto (solo inserción) hechos por la recepción de cada sucursal.
  const staff = new Map((await q<{ branch_id: string; user_id: string }>(
    `SELECT unnest(branch_ids) AS branch_id, user_id FROM memberships WHERE clinic_id = $1 AND role = 'receptionist'`, [clinicId])).rows.map((r) => [r.branch_id, r.user_id]));
  const owner = (await q<{ user_id: string }>("SELECT user_id FROM memberships WHERE clinic_id = $1 AND role = 'owner' LIMIT 1", [clinicId])).rows[0]!.user_id;
  const attempt = (r: { id: string; branch_id: string }, channel: string, outcome: string, daysAgo: number, note: string | null = null) =>
    q(`INSERT INTO recall_attempts (clinic_id, recall_id, channel, outcome, note, user_id, created_at) VALUES ($1,$2,$3,$4,$5,$6, now() - make_interval(days => $7))`,
      [clinicId, r.id, channel, outcome, note, staff.get(r.branch_id) ?? owner, daysAgo]);
  for (const [i, r] of manual.slice(0, 12).entries()) {
    if (i === 0) {
      // Tres intentos sin éxito → "revisar"
      await attempt(r, "call", "no_answer", 9); await attempt(r, "whatsapp", "no_answer", 6); await attempt(r, "call", "voicemail", 2, "Dejamos mensaje de voz");
      await q("UPDATE recalls SET status = 'review' WHERE id = $1", [r.id]);
    } else if (i === 1) {
      await attempt(r, "call", "declined", 4, "Se atiende en otra ciudad");
      await q("UPDATE recalls SET status = 'dismissed', dismiss_reason = 'Se mudó a otra ciudad', dismissed_at = now() WHERE id = $1", [r.id]);
    } else if (i % 3 === 0) await attempt(r, "call", "no_answer", between(1, 8));
    else if (i % 3 === 1) await attempt(r, rnd() < 0.5 ? "whatsapp" : "call", rnd() < 0.5 ? "voicemail" : "other", between(1, 8), "Volver a llamar la próxima semana");
  }
  // 5) Algunos ya agendados (vinculados a una cita futura del paciente) y otros hechos.
  const future = (await q<{ id: string; patient_id: string; branch_id: string; starts_at: Date }>(
    `SELECT DISTINCT ON (patient_id) id, patient_id, branch_id, starts_at FROM appointments
      WHERE clinic_id = $1 AND status IN ('scheduled','confirmed') AND starts_at > now() ORDER BY patient_id, starts_at`, [clinicId])).rows;
  // Controles cuya cita ya está agendada (vinculados a la próxima cita del paciente).
  for (const f of future.filter((x) => !pendingByPatient.has(x.patient_id)).slice(0, 8)) {
    await q(`INSERT INTO recalls (clinic_id, patient_id, branch_id, reason, due_date, status, origin, appointment_id, scheduled_at, created_at)
             VALUES ($1,$2,$3,'Revisión general',$4,'scheduled','manual',$5, now() - interval '3 days', now() - interval '150 days')`,
      [clinicId, f.patient_id, f.branch_id, DateTime.fromJSDate(f.starts_at, { zone: ZONE }).toISODate(), f.id]);
  }
  const pastDone = (await q<{ id: string; patient_id: string; branch_id: string; starts_at: Date }>(
    `SELECT id, patient_id, branch_id, starts_at FROM appointments WHERE clinic_id = $1 AND status = 'completed' AND starts_at > now() - interval '20 days' ORDER BY starts_at DESC, id LIMIT 6`, [clinicId])).rows;
  for (const a of pastDone) {
    await q(`INSERT INTO recalls (clinic_id, patient_id, branch_id, reason, due_date, status, origin, appointment_id, scheduled_at, done_at, created_at)
             VALUES ($1,$2,$3,'Revisión general',$4,'done','manual',$5,$6,$6, now() - interval '200 days')`,
      [clinicId, a.patient_id, a.branch_id, DateTime.fromJSDate(a.starts_at, { zone: ZONE }).toISODate(), a.id, a.starts_at]);
  }
  return { events: ev.appt.length, recalls: recallIds.length + manual.length + pastDone.length + Math.min(8, future.length), unclosed: unclosed.length };
}
