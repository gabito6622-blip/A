// Programador de mensajes automáticos (WA-02, WA-05, WA-07, WA-08).
//
// Cada ejecución, por clínica y en una transacción con RLS:
//   1. Anula lo pendiente que ya no corresponde (cita cancelada o reprogramada, control agendado,
//      presupuesto respondido, regla desactivada).
//   2. Planifica: calcula los mensajes de cada regla activa y los guarda en message_jobs con una
//      clave única (regla + cita + hora). Repetir la ejecución no duplica nada.
//   3. Despacha lo que ya toca: verifica de nuevo la cita, el consentimiento por finalidad, el
//      teléfono, el horario de silencio y el tope diario; arma el texto y lo deja en la bandeja
//      (lib/messaging.ts), que fuera de producción solo SIMULA.
// Todo lo que se omite queda registrado con su motivo (y en la auditoría).
import { DateTime } from "luxon";
import { randomUUID } from "node:crypto";
import { loadConfig, type Config } from "../../config.js";
import type { Client, Db } from "../../lib/db.js";
import { withTenant } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { normalizePhone } from "../../lib/text.js";
import { createMessenger, type Messenger } from "../../lib/messaging.js";
import { messagingConsent } from "../consents.js";
import { renderTemplate, usedVariables, type Purpose, type Trigger, type Variable } from "./templates.js";
import { DEFAULT_QUIET, MIN_LEAD_MINUTES, fmtLocal, hhmm, isQuiet, localDay, nextAllowed, nextDayStart, planSendAt, type QuietHours } from "./timing.js";
import { whatsappProviderFromEnv } from "./whatsapp.js";
import { confirmTokenHash, signConfirmToken } from "./tokens.js";

export interface MessagingSettings { quiet: QuietHours; maxPerDay: number }
export const DEFAULT_MAX_PER_DAY = 2;
/** Ventana anti-repetición: una cita no recibe dos avisos en menos de 12 h. */
export const ANTI_SPAM_HOURS = 12;
/** Horizonte de planificación (los mensajes aparecen como «Programado» con esta anticipación). */
const PLAN_HORIZON = "3 days";
/** Hora local a la que se envían los avisos de control pendiente. */
const RECALL_SEND_HOUR = 10;

export interface SchedulerDeps {
  cfg: Pick<Config, "publicUrl" | "secretKey" | "isProduction">;
  messenger: Messenger;
}
export interface RunSummary { clinics: number; planned: number; cancelled: number; sent: number; skipped: number; deferred: number }
type Actor = { clinicId: string; userId: string | null; ip: string | null };

/** Bandeja de mensajes con el proveedor real solo si corresponde (producción + credenciales). */
export function messagingMessenger(cfg: Pick<Config, "isProduction">): Messenger {
  return createMessenger(cfg, { provider: whatsappProviderFromEnv() });
}

let defaultDeps: SchedulerDeps | null = null;
function getDefaultDeps(): SchedulerDeps {
  if (!defaultDeps) { const cfg = loadConfig(); defaultDeps = { cfg, messenger: messagingMessenger(cfg) }; }
  return defaultDeps;
}

export async function loadMessagingSettings(c: Client, clinicId: string): Promise<MessagingSettings> {
  const r = (await c.query<{ quiet_start: string; quiet_end: string; max_per_patient_day: number }>(
    "SELECT quiet_start::text, quiet_end::text, max_per_patient_day FROM messaging_settings WHERE clinic_id = $1", [clinicId])).rows[0];
  return r ? { quiet: { start: hhmm(r.quiet_start), end: hhmm(r.quiet_end) }, maxPerDay: r.max_per_patient_day } : { quiet: { ...DEFAULT_QUIET }, maxPerDay: DEFAULT_MAX_PER_DAY };
}

const PRIORITY: Record<Trigger, number> = { appointment_created: 1, appointment_reminder: 2, after_visit: 3, recall_due: 4, budget_unanswered: 5 };
const APPT_TRIGGERS: Trigger[] = ["appointment_created", "appointment_reminder"];

/**
 * Ejecuta el programador una vez para todas las clínicas con reglas activas (o las indicadas).
 * `now` es inyectable para las pruebas. Idempotente: dos ejecuciones seguidas no duplican mensajes.
 */
export async function runSchedulerOnce(db: Db, now: Date = new Date(), opts: Partial<SchedulerDeps> & { clinicIds?: string[] } = {}): Promise<RunSummary> {
  const deps: SchedulerDeps = { ...getDefaultDeps(), ...(opts.cfg ? { cfg: opts.cfg } : {}), ...(opts.messenger ? { messenger: opts.messenger } : {}) };
  const ids = opts.clinicIds ?? (await db.appPool.query<{ id: string }>("SELECT messaging_active_clinics() AS id")).rows.map((r) => r.id);
  const total: RunSummary = { clinics: 0, planned: 0, cancelled: 0, sent: 0, skipped: 0, deferred: 0 };
  for (const clinicId of ids) {
    try {
      const s = await withTenant(db.appPool, { clinicId, userId: null }, (c) => runForClinic(c, clinicId, now, deps));
      total.clinics++;
      for (const k of ["planned", "cancelled", "sent", "skipped", "deferred"] as const) total[k] += s[k];
    } catch (e) {
      // Un error en una clínica no detiene a las demás (sin datos personales en el registro).
      console.error(`[mensajes] Error al procesar la clínica ${clinicId}: ${(e as Error).message}`);
    }
  }
  return total;
}

/** Ejecuta las tres etapas para una clínica dentro de la transacción recibida (RLS ya fijado). */
export async function runForClinic(c: Client, clinicId: string, now: Date, deps: SchedulerDeps, actor?: Actor): Promise<RunSummary> {
  // Dos procesos a la vez (dos servidores, o el botón y el intervalo) se esperan uno al otro.
  await c.query("SELECT pg_advisory_xact_lock(hashtextextended('messaging:' || $1, 0))", [clinicId]);
  const who: Actor = actor ?? { clinicId, userId: null, ip: null };
  const summary: RunSummary = { clinics: 1, planned: 0, cancelled: 0, sent: 0, skipped: 0, deferred: 0 };
  const cl = (await c.query<{ name: string; slug: string; timezone: string; portal: boolean | null }>(
    "SELECT c.name, c.slug, c.timezone, ps.enabled AS portal FROM clinics c LEFT JOIN portal_settings ps ON ps.clinic_id = c.id WHERE c.id = $1", [clinicId])).rows[0];
  if (!cl) return summary;
  const zone = cl.timezone;
  const settings = await loadMessagingSettings(c, clinicId);
  summary.cancelled += await reconcile(c, now);
  summary.planned += await plan(c, clinicId, now, zone, settings);
  const d = await dispatch(c, { clinicId, now, zone, settings, deps, clinic: { name: cl.name, slug: cl.slug, portal: !!cl.portal }, who });
  summary.sent += d.sent; summary.skipped += d.skipped; summary.deferred += d.deferred; summary.cancelled += d.cancelled;
  if (actor?.userId || summary.sent || summary.skipped) {
    await audit(c, who as never, actor?.userId ? "messaging.run_manual" : "messaging.scheduler_run", "clinic", clinicId, { ...summary, now: now.toISOString() });
  }
  return summary;
}

// ---------------- 1. Anular lo que ya no corresponde ----------------
async function reconcile(c: Client, now: Date): Promise<number> {
  const r = await c.query(
    `UPDATE message_jobs j SET status = 'cancelled', updated_at = now(), status_reason = x.reason
       FROM (
         SELECT j2.id,
           CASE
             WHEN NOT r.active THEN 'Regla desactivada'
             WHEN j2.appointment_id IS NOT NULL AND a.status IN ('cancelled','no_show') THEN 'Cita cancelada'
             WHEN r.trigger IN ('appointment_created','appointment_reminder') AND a.status NOT IN ('scheduled','confirmed') THEN 'La cita ya no está pendiente'
             WHEN r.trigger IN ('appointment_created','appointment_reminder') AND a.starts_at <> j2.anchor_at THEN 'Cita reprogramada: se programa un aviso para la nueva hora'
             WHEN r.trigger IN ('appointment_created','appointment_reminder') AND a.starts_at <= $1 THEN 'La cita ya pasó'
             WHEN j2.recall_id IS NOT NULL AND rc.status <> 'pending' THEN 'El control ya se agendó o se cerró'
             WHEN j2.recall_id IS NOT NULL AND rc.due_date <> (j2.anchor_at AT TIME ZONE cl.timezone)::date THEN 'Cambió la fecha del control'
             WHEN j2.budget_id IS NOT NULL AND b.status <> 'presented' THEN 'El presupuesto ya tiene respuesta'
           END AS reason
           FROM message_jobs j2 JOIN message_rules r ON r.id = j2.rule_id JOIN clinics cl ON cl.id = j2.clinic_id
           LEFT JOIN appointments a ON a.id = j2.appointment_id LEFT JOIN recalls rc ON rc.id = j2.recall_id LEFT JOIN budgets b ON b.id = j2.budget_id
          WHERE j2.status = 'pending'
       ) x
      WHERE j.id = x.id AND x.reason IS NOT NULL`,
    [now]);
  return r.rowCount ?? 0;
}

// ---------------- 2. Planificar ----------------
interface RuleRow { id: string; branch_id: string | null; trigger: Trigger; offset_minutes: number; procedure_id: string | null; active_since: Date }
interface Candidate { branchId: string; patientId: string; appointmentId?: string; recallId?: string; budgetId?: string; key: string; anchor: Date; due: number; deadline?: number }

async function plan(c: Client, clinicId: string, now: Date, zone: string, settings: MessagingSettings): Promise<number> {
  const rules = (await c.query<RuleRow>(
    "SELECT id, branch_id, trigger, offset_minutes, procedure_id, active_since FROM message_rules WHERE active ORDER BY created_at")).rows;
  let n = 0;
  for (const rule of rules) {
    for (const cand of await candidates(c, rule, now, zone)) {
      const base = Math.max(cand.due, now.getTime());
      const p = planSendAt(base, zone, settings.quiet, cand.deadline);
      const reason = p.pulledBack ? `Adelantado a las ${fmtLocal(p.sendAt, zone).time} por el horario de silencio`
        : p.deferred ? `Horario de silencio: se envía a las ${fmtLocal(p.sendAt, zone).time}` : null;
      const r = await c.query(
        `INSERT INTO message_jobs (clinic_id, rule_id, branch_id, patient_id, appointment_id, recall_id, budget_id, dedupe_key, anchor_at, due_at, send_at, status_reason)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
         ON CONFLICT (clinic_id, dedupe_key) DO UPDATE SET status = 'pending', status_reason = EXCLUDED.status_reason, send_at = EXCLUDED.send_at, updated_at = now()
           WHERE message_jobs.status = 'cancelled'`,
        [clinicId, rule.id, cand.branchId, cand.patientId, cand.appointmentId ?? null, cand.recallId ?? null, cand.budgetId ?? null,
          cand.key, cand.anchor, new Date(cand.due), new Date(p.sendAt), reason]);
      n += r.rowCount ?? 0;
    }
  }
  return n;
}

async function candidates(c: Client, rule: RuleRow, now: Date, zone: string): Promise<Candidate[]> {
  const off = rule.offset_minutes * 60_000;
  const since = rule.active_since;
  switch (rule.trigger) {
    case "appointment_created": {
      const rows = (await c.query<{ id: string; branch_id: string; patient_id: string; starts_at: Date; created_at: Date; updated_at: Date; reschedule_count: number }>(
        `SELECT a.id, a.branch_id, a.patient_id, a.starts_at, a.created_at, a.updated_at, a.reschedule_count FROM appointments a
          WHERE a.status IN ('scheduled','confirmed') AND a.starts_at > $1 AND a.created_at <= $1
            AND ($2::uuid IS NULL OR a.branch_id = $2)
            AND (a.created_at >= $3 OR (a.reschedule_count > 0 AND a.updated_at >= $3))
            AND a.created_at > $1::timestamptz - interval '7 days'`,
        [now, rule.branch_id, since])).rows;
      return rows.map((a) => ({
        branchId: a.branch_id, patientId: a.patient_id, appointmentId: a.id, anchor: a.starts_at,
        key: `${rule.id}:cita:${a.id}:${a.starts_at.toISOString()}`,
        due: (a.reschedule_count > 0 && a.updated_at > a.created_at ? a.updated_at : a.created_at).getTime() + off,
        deadline: a.starts_at.getTime(),
      }));
    }
    case "appointment_reminder": {
      const rows = (await c.query<{ id: string; branch_id: string; patient_id: string; starts_at: Date }>(
        `SELECT a.id, a.branch_id, a.patient_id, a.starts_at FROM appointments a
          WHERE a.status IN ('scheduled','confirmed') AND a.starts_at > $1 AND a.starts_at <= $1::timestamptz + interval '14 days'
            AND a.starts_at - make_interval(mins => $3) <= $1::timestamptz + interval '${PLAN_HORIZON}'
            AND a.starts_at - make_interval(mins => $3) > $1::timestamptz - interval '14 days'
            AND ($2::uuid IS NULL OR a.branch_id = $2)`,
        [now, rule.branch_id, rule.offset_minutes])).rows;
      return rows
        // Un recordatorio solo tiene sentido con margen antes de la cita.
        .filter((a) => a.starts_at.getTime() - now.getTime() > MIN_LEAD_MINUTES * 60_000)
        .map((a) => ({
          branchId: a.branch_id, patientId: a.patient_id, appointmentId: a.id, anchor: a.starts_at,
          key: `${rule.id}:cita:${a.id}:${a.starts_at.toISOString()}`, due: a.starts_at.getTime() - off, deadline: a.starts_at.getTime(),
        }));
    }
    case "after_visit": {
      const rows = (await c.query<{ id: string; branch_id: string; patient_id: string; completed_at: Date }>(
        `SELECT a.id, a.branch_id, a.patient_id, a.completed_at FROM appointments a
          WHERE a.status = 'completed' AND a.completed_at IS NOT NULL AND a.completed_at >= $3
            AND a.completed_at + make_interval(mins => $4) <= $1::timestamptz + interval '${PLAN_HORIZON}'
            AND a.completed_at > $1::timestamptz - interval '120 days'
            AND ($2::uuid IS NULL OR a.branch_id = $2) AND ($5::uuid IS NULL OR a.procedure_id = $5)`,
        [now, rule.branch_id, since, rule.offset_minutes, rule.procedure_id])).rows;
      return rows.map((a) => ({
        branchId: a.branch_id, patientId: a.patient_id, appointmentId: a.id, anchor: a.completed_at,
        key: `${rule.id}:visita:${a.id}`, due: a.completed_at.getTime() + off,
      }));
    }
    case "recall_due": {
      const today = DateTime.fromJSDate(now, { zone }).toISODate()!;
      const days = Math.ceil(rule.offset_minutes / 1440);
      const rows = (await c.query<{ id: string; branch_id: string; patient_id: string; due_date: string }>(
        `SELECT r.id, r.branch_id, r.patient_id, r.due_date FROM recalls r
          WHERE r.status = 'pending' AND r.due_date >= $1::date AND r.due_date <= $1::date + ($3::int + 3)
            AND ($2::uuid IS NULL OR r.branch_id = $2)`,
        [today, rule.branch_id, days])).rows;
      return rows.flatMap((r) => {
        const anchor = DateTime.fromISO(r.due_date, { zone }).set({ hour: RECALL_SEND_HOUR });
        const due = anchor.toMillis() - off;
        // Sin envíos retroactivos masivos al activar la regla (margen de una semana).
        if (due < since.getTime() - 7 * 86_400_000) return [];
        return [{ branchId: r.branch_id, patientId: r.patient_id, recallId: r.id, anchor: anchor.toJSDate(), key: `${rule.id}:control:${r.id}:${r.due_date}`, due }];
      });
    }
    case "budget_unanswered": {
      const rows = (await c.query<{ id: string; branch_id: string; patient_id: string; presented_at: Date }>(
        `SELECT b.id, b.branch_id, b.patient_id, b.presented_at FROM budgets b
          WHERE b.status = 'presented' AND b.presented_at IS NOT NULL
            AND b.presented_at + make_interval(mins => $3) >= $4
            AND b.presented_at + make_interval(mins => $3) <= $1::timestamptz + interval '${PLAN_HORIZON}'
            AND ($2::uuid IS NULL OR b.branch_id = $2)`,
        [now, rule.branch_id, rule.offset_minutes, since])).rows;
      return rows.map((b) => ({
        branchId: b.branch_id, patientId: b.patient_id, budgetId: b.id, anchor: b.presented_at,
        key: `${rule.id}:presupuesto:${b.id}:${b.presented_at.toISOString()}`, due: b.presented_at.getTime() + off,
      }));
    }
  }
}

// ---------------- 3. Despachar ----------------
interface DueJob {
  id: string; rule_id: string; branch_id: string; patient_id: string; appointment_id: string | null; recall_id: string | null; budget_id: string | null;
  dedupe_key: string; anchor_at: Date; send_at: Date; trigger: Trigger; channel: "whatsapp" | "sms"; template_id: string; rule_active: boolean;
  purpose: Purpose; meta_template_name: string | null; meta_language: string; template_active: boolean;
}

interface DispatchCtx {
  clinicId: string; now: Date; zone: string; settings: MessagingSettings; deps: SchedulerDeps;
  clinic: { name: string; slug: string; portal: boolean }; who: Actor;
}

async function dispatch(c: Client, x: DispatchCtx) {
  const out = { sent: 0, skipped: 0, deferred: 0, cancelled: 0 };
  const jobs = (await c.query<DueJob>(
    `SELECT j.id, j.rule_id, j.branch_id, j.patient_id, j.appointment_id, j.recall_id, j.budget_id, j.dedupe_key, j.anchor_at, j.send_at,
            r.trigger, r.channel, r.template_id, r.active AS rule_active, t.purpose, t.meta_template_name, t.meta_language, t.active AS template_active
       FROM message_jobs j JOIN message_rules r ON r.id = j.rule_id JOIN message_templates t ON t.id = r.template_id
      WHERE j.status = 'pending' AND j.send_at <= $1
      ORDER BY (CASE r.trigger WHEN 'appointment_created' THEN 1 WHEN 'appointment_reminder' THEN 2 WHEN 'after_visit' THEN 3 WHEN 'recall_due' THEN 4 ELSE 5 END)
               + (CASE t.purpose WHEN 'marketing' THEN 10 ELSE 0 END), j.send_at
      LIMIT 500 FOR UPDATE OF j SKIP LOCKED`,
    [x.now])).rows;
  if (!jobs.length) return out;
  const nowMs = x.now.getTime();

  // Horario de silencio: nada sale; se mueve a la próxima hora permitida.
  if (isQuiet(nowMs, x.zone, x.settings.quiet)) {
    const next = nextAllowed(nowMs, x.zone, x.settings.quiet);
    await c.query(
      "UPDATE message_jobs SET send_at = $2, status_reason = $3, updated_at = now() WHERE id = ANY($1::uuid[])",
      [jobs.map((j) => j.id), new Date(next), `Horario de silencio: se envía a las ${fmtLocal(next, x.zone).time}`]);
    out.deferred += jobs.length;
    return out;
  }

  const finish = async (j: DueJob, status: "skipped" | "cancelled", reason: string) => {
    await c.query("UPDATE message_jobs SET status = $2, status_reason = $3, processed_at = $4, updated_at = now() WHERE id = $1", [j.id, status, reason, x.now]);
    if (status === "skipped") {
      await audit(c, x.who as never, "messaging.skipped", "message_job", j.id, { reason, patientId: j.patient_id, ruleId: j.rule_id, purpose: j.purpose }, j.branch_id);
      out.skipped++;
    } else out.cancelled++;
  };
  const day = localDay(nowMs, x.zone);

  for (const j of jobs) {
    if (!j.rule_active) { await finish(j, "cancelled", "Regla desactivada"); continue; }
    if (!j.template_active) { await finish(j, "skipped", "La plantilla está desactivada"); continue; }

    // Contexto según el disparador (y verificación final: nada desactualizado sale).
    const vars: Partial<Record<Variable, string>> = { clinica: x.clinic.name };
    let deadline: number | null = null;
    let appt: { status: string; starts_at: Date; dentist: string } | null = null;
    if (j.appointment_id) {
      appt = (await c.query<{ status: string; starts_at: Date; dentist: string }>(
        "SELECT a.status, a.starts_at, u.full_name AS dentist FROM appointments a JOIN users u ON u.id = a.dentist_id WHERE a.id = $1", [j.appointment_id])).rows[0] ?? null;
      if (!appt) { await finish(j, "cancelled", "La cita ya no existe"); continue; }
      if (APPT_TRIGGERS.includes(j.trigger)) {
        if (["cancelled", "no_show"].includes(appt.status)) { await finish(j, "cancelled", "Cita cancelada"); continue; }
        if (!["scheduled", "confirmed"].includes(appt.status)) { await finish(j, "cancelled", "La cita ya no está pendiente"); continue; }
        if (appt.starts_at.getTime() !== j.anchor_at.getTime()) { await finish(j, "cancelled", "Cita reprogramada: se programa un aviso para la nueva hora"); continue; }
        if (appt.starts_at.getTime() <= nowMs) { await finish(j, "cancelled", "La cita ya pasó"); continue; }
        deadline = appt.starts_at.getTime();
      }
      const w = fmtLocal(appt.starts_at, x.zone);
      Object.assign(vars, { fecha: w.date, hora: w.time, profesional: appt.dentist });
    }
    let recallProcedure: string | null = null;
    if (j.recall_id) {
      const r = (await c.query<{ status: string; due_date: string; procedure_id: string | null; dentist: string | null }>(
        "SELECT r.status, r.due_date, r.procedure_id, u.full_name AS dentist FROM recalls r LEFT JOIN users u ON u.id = r.dentist_id WHERE r.id = $1", [j.recall_id])).rows[0];
      if (!r || r.status !== "pending") { await finish(j, "cancelled", "El control ya se agendó o se cerró"); continue; }
      recallProcedure = r.procedure_id;
      Object.assign(vars, { fecha: fmtLocal(DateTime.fromISO(r.due_date, { zone: x.zone }).toMillis(), x.zone).date, profesional: r.dentist ?? "nuestro equipo" });
    }
    if (j.budget_id) {
      const b = (await c.query<{ status: string; presented_at: Date; dentist: string }>(
        "SELECT b.status, b.presented_at, u.full_name AS dentist FROM budgets b JOIN users u ON u.id = b.dentist_id WHERE b.id = $1", [j.budget_id])).rows[0];
      if (!b || b.status !== "presented") { await finish(j, "cancelled", "El presupuesto ya tiene respuesta"); continue; }
      Object.assign(vars, { fecha: fmtLocal(b.presented_at, x.zone).date, profesional: b.dentist });
    }

    // Paciente, finalidad y teléfono.
    const p = (await c.query<{ first_name: string; phone: string | null; guardian_phone: string | null; archived_at: Date | null }>(
      "SELECT first_name, phone, guardian_phone, archived_at FROM patients WHERE id = $1", [j.patient_id])).rows[0];
    if (!p || p.archived_at) { await finish(j, "skipped", "Paciente archivado"); continue; }
    const consent = await messagingConsent(c, j.patient_id);
    if (!consent[j.purpose]) {
      const last = (await c.query<{ decision: string }>(
        "SELECT decision FROM signed_documents WHERE patient_id = $1 AND kind = $2 ORDER BY signed_at DESC LIMIT 1", [j.patient_id, j.purpose])).rows[0]?.decision;
      const what = j.purpose === "reminders" ? "los recordatorios" : "las promociones (marketing)";
      await finish(j, "skipped", last === "revoked" ? `El paciente se dio de baja de ${what}` : `Sin consentimiento para ${what}`);
      continue;
    }
    const phone = normalizePhone(p.phone ?? p.guardian_phone);
    if (!phone || phone.replace(/\D/g, "").length < 7) { await finish(j, "skipped", "El paciente no tiene celular registrado"); continue; }

    // Un aviso claro, no cinco: misma cita con otro mensaje hace poco.
    if (j.appointment_id && APPT_TRIGGERS.includes(j.trigger)) {
      const recent = (await c.query(
        `SELECT 1 FROM message_jobs WHERE appointment_id = $1 AND id <> $2 AND status = 'done' AND processed_at > $3::timestamptz - make_interval(hours => $4)`,
        [j.appointment_id, j.id, x.now, ANTI_SPAM_HOURS])).rowCount;
      if (recent) { await finish(j, "skipped", `Ya recibió un mensaje de esta cita hace menos de ${ANTI_SPAM_HOURS} horas`); continue; }
    }

    // Tope diario por paciente (día local de la clínica).
    const today = (await c.query<{ n: number }>(
      "SELECT count(*)::int AS n FROM message_jobs WHERE patient_id = $1 AND status = 'done' AND processed_at >= $2 AND processed_at < $3",
      [j.patient_id, day.start, day.end])).rows[0]!.n;
    if (today >= x.settings.maxPerDay) {
      const next = nextDayStart(nowMs, x.zone, x.settings.quiet);
      if (deadline != null && next > deadline - MIN_LEAD_MINUTES * 60_000) {
        await finish(j, "skipped", `Tope diario de ${x.settings.maxPerDay} mensaje(s) por paciente alcanzado`);
      } else {
        await c.query("UPDATE message_jobs SET send_at = $2, status_reason = $3, updated_at = now() WHERE id = $1",
          [j.id, new Date(next), `Tope diario de ${x.settings.maxPerDay} mensaje(s) alcanzado: se envía mañana`]);
        out.deferred++;
      }
      continue;
    }

    // Texto: última versión de la plantilla con los datos de la sucursal.
    const tv = (await c.query<{ id: string; body: string }>(
      "SELECT id, body FROM message_template_versions WHERE template_id = $1 ORDER BY version DESC LIMIT 1", [j.template_id])).rows[0];
    if (!tv) { await finish(j, "skipped", "La plantilla no tiene texto"); continue; }
    const br = (await c.query<{ name: string; address: string | null; city: string | null; phone: string | null; whatsapp: string | null }>(
      "SELECT b.name, b.address, b.city, b.phone, s.whatsapp FROM branches b LEFT JOIN portal_branch_settings s ON s.branch_id = b.id WHERE b.id = $1", [j.branch_id])).rows[0]!;
    const tel = br.whatsapp ?? br.phone ?? "";
    const base = x.deps.cfg.publicUrl;
    let portalLink: string;
    if (!x.clinic.portal) portalLink = tel ? `escríbenos al ${tel}` : "";
    else if (j.trigger === "recall_due") {
      const q = new URLSearchParams({ sucursal: j.branch_id, ...(recallProcedure ? { servicio: recallProcedure } : {}) });
      portalLink = `${base}/reservar/${x.clinic.slug}?${q.toString()}`;
    } else portalLink = `${base}/mi-cuenta/${x.clinic.slug}`;
    Object.assign(vars, {
      nombre: p.first_name, sucursal: br.name, direccion: br.address ?? br.city ?? "", telefono_sucursal: tel, enlace_portal: portalLink,
    });
    const used = usedVariables(tv.body);
    if (used.includes("enlace_confirmar") && j.appointment_id && appt) {
      const tokenId = randomUUID();
      const token = signConfirmToken(x.deps.cfg.secretKey, x.clinicId, tokenId);
      await c.query(
        `INSERT INTO message_confirm_tokens (id, clinic_id, appointment_id, job_id, token_hash, starts_at, expires_at) VALUES ($1,$2,$3,$4,$5,$6,$6)`,
        [tokenId, x.clinicId, j.appointment_id, j.id, confirmTokenHash(token), appt.starts_at]);
      vars.enlace_confirmar = `${base}/c/${token}`;
    }
    const body = renderTemplate(tv.body, vars, j.purpose);
    const msg = await x.deps.messenger.enqueue(c, {
      clinicId: x.clinicId, branchId: j.branch_id, patientId: j.patient_id, channel: j.channel, recipient: phone,
      template: `auto.${j.trigger}`, purpose: j.purpose, body,
      relatedEntity: j.appointment_id ? "appointment" : j.recall_id ? "recall" : "budget",
      relatedId: j.appointment_id ?? j.recall_id ?? j.budget_id, dedupeKey: j.dedupe_key,
      providerTemplate: j.meta_template_name ? { name: j.meta_template_name, language: j.meta_language, params: used.map((v) => vars[v as Variable] ?? "") } : null,
    });
    await c.query(
      "UPDATE message_jobs SET status = 'done', status_reason = NULL, message_id = $2, template_version_id = $3, processed_at = $4, updated_at = now() WHERE id = $1",
      [j.id, msg.id, tv.id, x.now]);
    out.sent++;
  }
  return out;
}

/** Inicia el programador en el proceso (setInterval). Lo activa main.ts con MESSAGING_SCHEDULER=1. */
export function startMessagingScheduler(db: Db, cfg: Config, intervalMs = Number(process.env.MESSAGING_SCHEDULER_INTERVAL_MS ?? 60_000)): () => void {
  const deps: SchedulerDeps = { cfg, messenger: messagingMessenger(cfg) };
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const s = await runSchedulerOnce(db, new Date(), deps);
      if (s.sent || s.skipped || s.cancelled) console.log(`[mensajes] ${s.sent} a la bandeja, ${s.skipped} omitidos, ${s.cancelled} anulados, ${s.deferred} postergados`);
    } catch (e) {
      console.error(`[mensajes] El programador falló: ${(e as Error).message}`);
    } finally {
      running = false;
    }
  };
  const every = Math.max(10_000, intervalMs);
  const h = setInterval(tick, every);
  h.unref?.();
  setTimeout(tick, 5_000).unref?.();
  console.log(`[mensajes] Programador de mensajes automáticos activo (cada ${Math.round(every / 1000)} s; modo ${deps.messenger.mode}).`);
  return () => clearInterval(h);
}
