// Semilla de demostración (datos ficticios) de la coordinación del equipo: tareas internas entre
// recepción, odontólogos, asistente y limpieza en La Paz Centro; llamadas registradas; algunos
// eventos de auditoría para que el diario de actividad tenga contenido; y, si todavía quedan citas
// hoy, una cancelada con un paciente en lista de espera para mostrar la tarjeta "Se liberó un hueco".
import type pg from "pg";
import { DateTime } from "luxon";

const ZONE = "America/La_Paz";

export async function seedCoordinationDemo(pool: pg.Pool, clinicId: string) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const q = async <T = any>(sql: string, params: unknown[] = []) => (await c.query(sql, params)).rows as T[];
    const user = async (email: string) => (await q<{ id: string }>("SELECT id FROM users WHERE email = $1", [email]))[0]?.id;
    const lpz = (await q<{ id: string }>("SELECT id FROM branches WHERE clinic_id = $1 AND code = 'LPZ'", [clinicId]))[0]?.id;
    const rec = await user("recepcion.lpz@demo.local");
    const mendoza = await user("dr.mendoza@demo.local");
    const vargas = await user("dra.vargas@demo.local");
    const owner = await user("propietaria@demo.local");
    const cleaner = await user("limpieza.lpz@demo.local");
    if (!lpz || !rec || !mendoza || !vargas || !owner || !cleaner) { await c.query("ROLLBACK"); return { tasks: 0, calls: 0 }; }
    const now = DateTime.now().setZone(ZONE);
    const patients = await q<{ id: string; phone: string | null }>(
      "SELECT id, phone FROM patients WHERE clinic_id = $1 AND preferred_branch_id = $2 ORDER BY record_number LIMIT 8", [clinicId, lpz]);
    const pat = (i: number) => patients[i % Math.max(1, patients.length)]?.id ?? null;
    const log = (userId: string, action: string, entityId: string, data: Record<string, unknown>, at: DateTime, entity = "task") =>
      c.query("INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)",
        [clinicId, userId, action, entity, entityId, lpz, JSON.stringify(data), at.toJSDate()]);

    // ---------------- Tareas ----------------
    interface T { by: string; to?: string; role?: string; title: string; detail?: string; due?: DateTime | null; prio?: "normal" | "high"; patient?: string | null; created: DateTime; assignee: string }
    const defs: T[] = [
      { by: rec, to: mendoza, assignee: "Dr. Luis Mendoza", title: "Revisar y firmar la orden de laboratorio pendiente", detail: "Está en la bandeja de recepción desde ayer.", due: now.plus({ days: 1 }).set({ hour: 12, minute: 0 }), created: now.minus({ hours: 3 }) },
      { by: rec, role: "assistant", assignee: "Asistente", title: "Reponer guantes y baberos en el Consultorio 2", due: now.minus({ days: 1 }).set({ hour: 18, minute: 0 }), created: now.minus({ days: 2 }) },
      { by: vargas, role: "receptionist", assignee: "Recepción", title: "Confirmar por teléfono el control del paciente", detail: "Preguntar si prefiere mañana o tarde.", due: now.set({ hour: 23, minute: 59 }), prio: "high", patient: pat(1), created: now.minus({ hours: 5 }) },
      { by: owner, to: cleaner, assignee: "Rosa Mamani", title: "Desinfección profunda del Consultorio 3 el sábado", due: now.plus({ days: 3 }).set({ hour: 12, minute: 0 }), created: now.minus({ days: 1 }) },
      { by: rec, role: "dentist", assignee: "Odontólogo", title: "Actualizar el horario de vacaciones de diciembre", due: null, created: now.minus({ days: 4 }) },
    ];
    const ids: string[] = [];
    for (const d of defs) {
      const id = (await q<{ id: string }>(
        `INSERT INTO staff_tasks (clinic_id, branch_id, title, detail, assignee_user_id, assignee_role, due_at, priority, patient_id, created_by, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11) RETURNING id`,
        [clinicId, lpz, d.title, d.detail ?? null, d.to ?? null, d.role ?? null, d.due?.toJSDate() ?? null, d.prio ?? "normal", d.patient ?? null, d.by, d.created.toJSDate()]))[0]!.id;
      ids.push(id);
      await log(d.by, "task.created", id, { assignee: d.assignee, priority: d.prio ?? "normal", patientId: d.patient ?? null }, d.created);
    }
    // La asistente tomó la de guantes (sigue pendiente y vencida); la de vacaciones ya está hecha.
    const asst = await user("asistente@demo.local");
    if (asst) {
      await c.query("UPDATE staff_tasks SET status = 'taken', taken_by = $2, taken_at = $3 WHERE id = $1", [ids[1], asst, now.minus({ days: 1, hours: 2 }).toJSDate()]);
      await log(asst, "task.taken", ids[1]!, { from: "open" }, now.minus({ days: 1, hours: 2 }));
      await c.query("INSERT INTO staff_task_comments (clinic_id, task_id, body, author_id, created_at) VALUES ($1,$2,$3,$4,$5)",
        [clinicId, ids[1], "Faltan baberos en almacén; pedí reposición.", asst, now.minus({ days: 1, hours: 1 }).toJSDate()]);
    }
    await c.query("UPDATE staff_tasks SET status = 'done', done_by = $2, done_at = $3 WHERE id = $1", [ids[4], mendoza, now.minus({ days: 2 }).toJSDate()]);
    await log(mendoza, "task.done", ids[4]!, { from: "open" }, now.minus({ days: 2 }));
    await c.query("INSERT INTO staff_task_comments (clinic_id, task_id, body, author_id, created_at) VALUES ($1,$2,$3,$4,$5)",
      [clinicId, ids[4], "Listo, quedó cargado del 20 al 31 de diciembre.", mendoza, now.minus({ days: 2 }).toJSDate()]);

    // ---------------- Llamadas ----------------
    const outcomes = ["answered", "no_answer", "answered", "wrong_number", "call_back", "answered"] as const;
    const notes = ["Confirma asistencia.", null, "Pide factura a nombre de la empresa.", "El número es de otra persona.", "Pide que lo llamemos después de las 17:00.", null];
    let calls = 0;
    for (let i = 0; i < outcomes.length; i++) {
      const p = patients[i];
      if (!p) break;
      const at = now.minus({ days: i, hours: 1 + i });
      const callId = (await q<{ id: string }>(
        `INSERT INTO patient_calls (clinic_id, branch_id, patient_id, phone, outcome, duration_min, note, user_id, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [clinicId, lpz, p.id, p.phone, outcomes[i], outcomes[i] === "no_answer" ? 0 : 1 + (i % 4), notes[i], rec, at.toJSDate()]))[0]!.id;
      calls++;
      let taskId: string | null = null;
      if (outcomes[i] === "call_back") {
        taskId = (await q<{ id: string }>(
          `INSERT INTO staff_tasks (clinic_id, branch_id, title, assignee_user_id, due_at, patient_id, source, source_call_id, created_by, created_at, updated_at)
           VALUES ($1,$2,'Volver a llamar al paciente',$3,$4,$5,'call',$6,$3,$7,$7) RETURNING id`,
          [clinicId, lpz, rec, now.plus({ days: 1 }).set({ hour: 17, minute: 30 }).toJSDate(), p.id, callId, at.toJSDate()]))[0]!.id;
        await log(rec, "task.created", taskId, { assignee: "Recepción LPZ", priority: "normal", patientId: p.id, source: "call" }, at);
      }
      await log(rec, "call.logged", p.id, { callId, outcome: outcomes[i], taskId }, at, "patient");
    }

    // ---------------- Diario: pagos y citas recientes registrados por recepción ----------------
    const pays = await q<{ id: string; amount_cents: number; method: string; status: string; receipt_number: number; received_at: Date; branch_id: string; code: string }>(
      `SELECT p.id, p.amount_cents, p.method, p.status, p.receipt_number, p.received_at, p.branch_id, b.code FROM payments p JOIN branches b ON b.id = p.branch_id
        WHERE p.clinic_id = $1 AND p.received_at > now() - interval '30 days' ORDER BY p.received_at DESC LIMIT 15`, [clinicId]);
    for (const p of pays) {
      const by = await user(`recepcion.${p.code.toLowerCase()}@demo.local`);
      if (!by) continue;
      await c.query("INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, created_at) VALUES ($1,$2,'payment.created','payment',$3,$4,$5,$6)",
        [clinicId, by, p.id, p.branch_id, JSON.stringify({ amountCents: p.amount_cents, method: p.method, status: p.status, receipt: p.receipt_number }), p.received_at]);
    }

    // ---------------- Hueco liberado hoy (si quedan citas por delante) ----------------
    // Se cancela la segunda cita pendiente de hoy (nunca la única), para no vaciar la sala de espera de la demo.
    const freed = (await q<{ id: string; patient_id: string; starts_at: Date; status: string }>(
      `SELECT a.id, a.patient_id, a.starts_at, a.status FROM appointments a
        WHERE a.clinic_id = $1 AND a.branch_id = $2 AND a.status IN ('scheduled','confirmed') AND a.series_id IS NULL
          AND a.starts_at > now() + interval '90 minutes' AND a.starts_at < $3 ORDER BY a.starts_at LIMIT 2`,
      [clinicId, lpz, now.endOf("day").toJSDate()]))[1];
    if (freed) {
      await c.query("UPDATE appointments SET status = 'cancelled', cancel_reason = 'El paciente avisó que no puede venir', cancelled_at = now(), updated_at = now() WHERE id = $1", [freed.id]);
      await c.query("INSERT INTO appointment_events (clinic_id, appointment_id, branch_id, from_status, to_status, user_id, reason) VALUES ($1,$2,$3,$4,'cancelled',$5,'El paciente avisó que no puede venir')",
        [clinicId, freed.id, lpz, freed.status, rec]);
      await log(rec, "appointment.status", freed.id, { from: freed.status, to: "cancelled" }, now, "appointment");
      const waiting = (await q<{ id: string }>(
        `SELECT p.id FROM patients p WHERE p.clinic_id = $1 AND p.id <> $2
            AND NOT EXISTS (SELECT 1 FROM appointments x WHERE x.patient_id = p.id AND x.starts_at::date = $3::date)
          ORDER BY p.record_number DESC LIMIT 1`, [clinicId, freed.patient_id, freed.starts_at]))[0];
      if (waiting) {
        await c.query(
          `INSERT INTO waitlist_entries (clinic_id, branch_id, patient_id, duration_min, earliest_date, preferred_period, priority, notes, created_by)
           VALUES ($1,$2,$3,30,$4,'any',2,'Quiere adelantar su cita si se libera un horario',$5)`, [clinicId, lpz, waiting.id, now.toISODate(), rec]);
      }
    }
    await c.query("COMMIT");
    return { tasks: defs.length + 1, calls };
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}
