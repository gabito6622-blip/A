// Ganchos de la agenda: registro inmutable de cada cambio de estado de una cita y
// vínculo automático cita ↔ control. Los llama agenda.ts dentro de la misma transacción.
import { DateTime } from "luxon";
import type { Client } from "../lib/db.js";
import { conflict } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { AuthCtx } from "../lib/rbac.js";

type Actor = Pick<AuthCtx, "userId" | "clinicId" | "ip">;

/** Inserta un evento de la cita (de → a). Tabla de solo inserción. */
export async function recordAppointmentEvent(
  c: Client,
  auth: Actor,
  e: { appointmentId: string; branchId: string; from: string | null; to: string; reason?: string | null; retroactive?: boolean },
) {
  await c.query(
    `INSERT INTO appointment_events (clinic_id, appointment_id, branch_id, from_status, to_status, user_id, reason, retroactive)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [auth.clinicId, e.appointmentId, e.branchId, e.from, e.to, auth.userId, e.reason ?? null, e.retroactive ?? false],
  );
}

/**
 * Después de un cambio de estado: evento + efecto en el control vinculado.
 *  - atendida → el control agendado pasa a "hecho";
 *  - cancelada o no asistió → el control vuelve a "pendiente" (regresa a la cola de llamadas).
 */
export async function afterAppointmentStatusChange(
  c: Client,
  auth: Actor,
  e: { appointmentId: string; branchId: string; from: string; to: string; reason?: string | null; retroactive?: boolean },
) {
  await recordAppointmentEvent(c, auth, e);
  if (e.to === "completed") {
    const r = await c.query<{ id: string; branch_id: string }>(
      `UPDATE recalls SET status = 'done', done_at = now(), updated_at = now()
        WHERE appointment_id = $1 AND status = 'scheduled' RETURNING id, branch_id`,
      [e.appointmentId],
    );
    for (const x of r.rows) await audit(c, auth, "recall.done", "recall", x.id, { appointmentId: e.appointmentId }, x.branch_id);
  } else if (e.to === "cancelled" || e.to === "no_show") {
    const r = await c.query<{ id: string; branch_id: string }>(
      `UPDATE recalls SET status = 'pending', appointment_id = NULL, scheduled_at = NULL, updated_at = now()
        WHERE appointment_id = $1 AND status = 'scheduled' RETURNING id, branch_id`,
      [e.appointmentId],
    );
    for (const x of r.rows) await audit(c, auth, "recall.unlinked", "recall", x.id, { appointmentId: e.appointmentId, appointmentStatus: e.to }, x.branch_id);
  }
}

/** Ventana de compatibilidad: una cita sirve para un control si no es más de 2 meses anterior a su fecha objetivo. */
export const RECALL_EARLY_WINDOW_MONTHS = 2;

/**
 * Controles pendientes (o en revisión) del paciente que una cita puede cubrir:
 * misma prestación (o alguna de las dos sin prestación) y fecha objetivo hasta 2 meses después de la cita.
 */
export async function compatibleRecalls(c: Client, a: { patientId: string; procedureId: string | null; date: string }, lock = false) {
  return (
    await c.query<{ id: string; reason: string; due_date: string; branch_id: string; status: string }>(
      `SELECT id, reason, due_date, branch_id, status FROM recalls
        WHERE patient_id = $1 AND status IN ('pending','review')
          AND ($2::uuid IS NULL OR procedure_id IS NULL OR procedure_id = $2)
          AND due_date <= ($3::date + make_interval(months => $4))::date
        ORDER BY due_date, created_at ${lock ? "FOR UPDATE" : ""}`,
      [a.patientId, a.procedureId, a.date, RECALL_EARLY_WINDOW_MONTHS],
    )
  ).rows;
}

/**
 * Al agendar: si se indica recallId se vincula ese control; si es undefined y hay exactamente
 * un control compatible, se vincula solo; con 2 o más no se elige por la persona (se informa).
 * recallId = null: no vincular.
 */
export async function linkRecallOnBooking(
  c: Client,
  auth: Actor,
  a: { appointmentId: string; patientId: string; procedureId: string | null; startsAt: Date; zone: string; recallId: string | null | undefined },
): Promise<{ linkedRecallId: string | null; candidates: number }> {
  if (a.recallId === null) return { linkedRecallId: null, candidates: 0 };
  let target: string | null = null;
  let candidates = 0;
  if (a.recallId) {
    const r = (await c.query<{ patient_id: string; status: string }>("SELECT patient_id, status FROM recalls WHERE id = $1 FOR UPDATE", [a.recallId])).rows[0];
    if (!r || r.patient_id !== a.patientId) throw conflict("El control elegido no corresponde a este paciente", "recall_mismatch");
    if (!["pending", "review"].includes(r.status)) throw conflict("El control elegido ya no está pendiente", "recall_not_pending");
    target = a.recallId;
    candidates = 1;
  } else {
    const date = DateTime.fromJSDate(a.startsAt, { zone: a.zone }).toISODate()!;
    const list = await compatibleRecalls(c, { patientId: a.patientId, procedureId: a.procedureId, date }, true);
    candidates = list.length;
    if (list.length === 1) target = list[0]!.id;
  }
  if (!target) return { linkedRecallId: null, candidates };
  const u = await c.query<{ branch_id: string }>(
    `UPDATE recalls SET status = 'scheduled', appointment_id = $2, scheduled_at = now(), updated_at = now() WHERE id = $1 RETURNING branch_id`,
    [target, a.appointmentId],
  );
  await audit(c, auth, "recall.scheduled", "recall", target, { appointmentId: a.appointmentId, automatic: !a.recallId }, u.rows[0]!.branch_id);
  return { linkedRecallId: target, candidates };
}
