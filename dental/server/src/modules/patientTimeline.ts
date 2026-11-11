// Línea de tiempo del paciente (R2-18, B-049): un solo endpoint que une citas y cambios de estado,
// notas clínicas, odontograma, presupuestos, cargos y pagos, documentos firmados, controles con sus
// intentos de contacto y mensajes salientes, en orden cronológico inverso.
//
//  * Cada fuente se incluye SOLO si el rol tiene el permiso correspondiente (recepción no recibe
//    nada clínico). El filtro se aplica al construir la consulta, no después.
//  * Paginación por cursor (fecha con microsegundos + id): estable aunque lleguen eventos nuevos.
//  * Las horas se devuelven en UTC y también formateadas en la zona de la clínica (America/La_Paz);
//    para citas se informa aparte la hora del evento y la hora de la cita (R2-17).
//  * Eventos repetidos seguidos (p. ej. varios intentos fallidos de abrir un enlace) se agrupan.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { zIdParams } from "../lib/http.js";
import { badRequest, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { AuthCtx, Permission } from "../lib/rbac.js";
import { clinicZone, STATUS_LABELS } from "./agenda.js";
import { CONDITIONS } from "./clinical.js";
import { BUDGET_LABELS, METHOD_LABELS } from "./billing.js";
import { FILE_KIND_LABELS } from "./clinicalFiles-core.js";
import { CALL_OUTCOME_LABELS } from "./coordination/calls.js";

export const TIMELINE_CATEGORIES = ["appointments", "notes", "odontogram", "budgets", "payments", "documents", "recalls", "messages", "files", "feedback"] as const;
export type TimelineCategory = (typeof TIMELINE_CATEGORIES)[number];

export const CATEGORY_LABELS: Record<TimelineCategory, string> = {
  appointments: "Citas", notes: "Notas clínicas", odontogram: "Odontograma", budgets: "Presupuestos",
  payments: "Cargos y pagos", documents: "Documentos firmados", recalls: "Controles y contactos", messages: "Mensajes",
  files: "Imágenes y archivos",
  feedback: "Encuestas de satisfacción",
};

/** Permiso que habilita cada fuente. */
const CATEGORY_PERM: Record<TimelineCategory, Permission> = {
  appointments: "agenda.read", notes: "clinical.read", odontogram: "clinical.read", budgets: "budgets.read",
  payments: "payments.read", documents: "patients.read", recalls: "agenda.read", messages: "patients.read",
  files: "clinical.read",
  // Los comentarios de la encuesta los lee propietario y administración (como el panel de satisfacción).
  feedback: "clinic.manage",
};

export function allowedCategories(auth: Pick<AuthCtx, "permissions">): TimelineCategory[] {
  return TIMELINE_CATEGORIES.filter((c) => auth.permissions.has(CATEGORY_PERM[c]));
}

// Columnas comunes: at, id, kind, cat, ref (jsonb), actor, branch, appt_at, amount
const SOURCES: Record<TimelineCategory, (o: { informed: boolean }) => string> = {
  appointments: () => `
    SELECT e.occurred_at AS at, 'ae:' || e.id AS id, CASE WHEN e.from_status IS NULL THEN 'appointment.created' ELSE 'appointment.status' END AS kind,
           'appointments' AS cat,
           jsonb_build_object('appointmentId', a.id, 'from', e.from_status, 'to', e.to_status, 'reason', e.reason, 'retroactive', e.retroactive,
             'dentist', du.full_name, 'procedure', pr.name, 'type', ty.name, 'typeColor', ty.color, 'seriesIndex', a.series_index) AS ref,
           u.full_name AS actor, b.name AS branch, a.starts_at AS appt_at, NULL::bigint AS amount
      FROM appointment_events e JOIN appointments a ON a.id = e.appointment_id JOIN branches b ON b.id = e.branch_id
      JOIN users du ON du.id = a.dentist_id LEFT JOIN users u ON u.id = e.user_id
      LEFT JOIN procedures pr ON pr.id = a.procedure_id LEFT JOIN appointment_types ty ON ty.id = a.appointment_type_id
     WHERE a.patient_id = $1
    UNION ALL
    SELECT a.created_at, 'ac:' || a.id, 'appointment.created', 'appointments',
           jsonb_build_object('appointmentId', a.id, 'dentist', du.full_name, 'procedure', pr.name, 'type', ty.name, 'typeColor', ty.color, 'seriesIndex', a.series_index),
           cu.full_name, b.name, a.starts_at, NULL::bigint
      FROM appointments a JOIN branches b ON b.id = a.branch_id JOIN users du ON du.id = a.dentist_id LEFT JOIN users cu ON cu.id = a.created_by
      LEFT JOIN procedures pr ON pr.id = a.procedure_id LEFT JOIN appointment_types ty ON ty.id = a.appointment_type_id
     WHERE a.patient_id = $1 AND NOT EXISTS (SELECT 1 FROM appointment_events e WHERE e.appointment_id = a.id AND e.from_status IS NULL)
    UNION ALL
    SELECT l.created_at, 'rs:' || l.id, 'appointment.rescheduled', 'appointments',
           jsonb_build_object('appointmentId', a.id, 'fromAt', l.data->'from'->>'startsAt', 'toAt', l.data->'to'->>'startsAt', 'dentist', du.full_name, 'seriesIndex', a.series_index),
           u.full_name, b.name, a.starts_at, NULL::bigint
      FROM audit_log l JOIN appointments a ON a.id::text = l.entity_id JOIN branches b ON b.id = a.branch_id JOIN users du ON du.id = a.dentist_id
      LEFT JOIN users u ON u.id = l.user_id
     WHERE l.entity = 'appointment' AND l.action = 'appointment.rescheduled' AND a.patient_id = $1`,
  notes: () => `
    SELECT n.created_at, 'cn:' || n.id, 'clinical.note', 'notes',
           jsonb_build_object('noteKind', n.kind, 'diagnosis', n.diagnosis, 'excerpt', left(n.body, 240), 'amends', n.amends_note_id IS NOT NULL),
           u.full_name, b.name, NULL::timestamptz, NULL::bigint
      FROM clinical_notes n JOIN users u ON u.id = n.author_id JOIN branches b ON b.id = n.branch_id
     WHERE n.patient_id = $1`,
  odontogram: () => `
    SELECT o.recorded_at, 'od:' || o.id, CASE WHEN o.voids_entry_id IS NULL THEN 'odontogram.entry' ELSE 'odontogram.void' END, 'odontogram',
           jsonb_build_object('tooth', o.tooth, 'surfaces', o.surfaces, 'condition', o.condition, 'state', o.state, 'notes', o.notes),
           u.full_name, NULL::text, NULL::timestamptz, NULL::bigint
      FROM odontogram_entries o JOIN users u ON u.id = o.recorded_by
     WHERE o.patient_id = $1`,
  budgets: () => `
    SELECT bu.created_at, 'bc:' || bu.id, 'budget.created', 'budgets',
           jsonb_build_object('budgetId', bu.id, 'number', bu.number, 'version', bu.version),
           u.full_name, br.name, NULL::timestamptz,
           (SELECT COALESCE(sum(i.net_cents), 0)::bigint FROM budget_items i WHERE i.budget_id = bu.id AND i.status <> 'cancelled')
      FROM budgets bu JOIN branches br ON br.id = bu.branch_id LEFT JOIN users u ON u.id = bu.created_by
     WHERE bu.patient_id = $1
    UNION ALL
    SELECT bu.presented_at, 'bp:' || bu.id, 'budget.presented', 'budgets', jsonb_build_object('budgetId', bu.id, 'number', bu.number, 'version', bu.version),
           NULL::text, br.name, NULL::timestamptz, NULL::bigint
      FROM budgets bu JOIN branches br ON br.id = bu.branch_id
     WHERE bu.patient_id = $1 AND bu.presented_at IS NOT NULL
    UNION ALL
    SELECT bu.decided_at, 'bd:' || bu.id, 'budget.decided', 'budgets',
           jsonb_build_object('budgetId', bu.id, 'number', bu.number, 'version', bu.version, 'status', bu.status, 'note', bu.decided_note),
           NULL::text, br.name, NULL::timestamptz, NULL::bigint
      FROM budgets bu JOIN branches br ON br.id = bu.branch_id
     WHERE bu.patient_id = $1 AND bu.decided_at IS NOT NULL
    UNION ALL
    SELECT e.created_at, 'be:' || e.id, 'budget.event', 'budgets',
           jsonb_build_object('budgetId', bu.id, 'number', bu.number, 'event', e.kind, 'channel', e.channel, 'reason', e.reason),
           COALESCE(au.full_name, CASE WHEN e.actor_user_id IS NULL THEN 'El paciente (enlace)' END), br.name, NULL::timestamptz, NULL::bigint
      FROM budget_events e JOIN budgets bu ON bu.id = e.budget_id JOIN branches br ON br.id = bu.branch_id LEFT JOIN users au ON au.id = e.actor_user_id
     WHERE bu.patient_id = $1 AND e.kind NOT IN ('accepted','rejected')`,
  payments: () => `
    SELECT ch.created_at, 'ch:' || ch.id, CASE WHEN ch.voids_charge_id IS NULL THEN 'charge' ELSE 'charge.void' END, 'payments',
           jsonb_build_object('description', ch.description, 'dentist', du.full_name, 'thirdParty', ch.third_party_cents),
           u.full_name, b.name, NULL::timestamptz, ch.amount_cents
      FROM charges ch JOIN users u ON u.id = ch.created_by JOIN branches b ON b.id = ch.branch_id LEFT JOIN users du ON du.id = ch.dentist_id
     WHERE ch.patient_id = $1
    UNION ALL
    SELECT p.received_at, 'py:' || p.id, 'payment.received', 'payments',
           jsonb_build_object('method', p.method, 'receipt', p.receipt_number, 'bankReference', p.bank_reference),
           u.full_name, b.name, NULL::timestamptz, p.amount_cents
      FROM payments p JOIN users u ON u.id = p.received_by JOIN branches b ON b.id = p.branch_id
     WHERE p.patient_id = $1
    UNION ALL
    SELECT p.verified_at, 'pv:' || p.id, 'payment.verified', 'payments',
           jsonb_build_object('method', p.method, 'receipt', p.receipt_number, 'decision', CASE WHEN p.status = 'rejected' THEN 'rejected' ELSE 'confirmed' END,
             'reason', CASE WHEN p.status = 'rejected' THEN p.status_reason END),
           u.full_name, b.name, NULL::timestamptz, p.amount_cents
      FROM payments p JOIN branches b ON b.id = p.branch_id LEFT JOIN users u ON u.id = p.verified_by
     WHERE p.patient_id = $1 AND p.verified_at IS NOT NULL AND p.method <> 'cash'
    UNION ALL
    SELECT l.created_at, 'pz:' || l.id, 'payment.voided', 'payments',
           jsonb_build_object('method', p.method, 'receipt', p.receipt_number, 'reason', l.data->>'reason'),
           u.full_name, b.name, NULL::timestamptz, p.amount_cents
      FROM audit_log l JOIN payments p ON p.id::text = l.entity_id JOIN branches b ON b.id = p.branch_id LEFT JOIN users u ON u.id = l.user_id
     WHERE l.entity = 'payment' AND l.action = 'payment.voided' AND p.patient_id = $1
    UNION ALL
    SELECT pa.created_at, 'pg:' || pa.id, 'agreement.enrolled', 'payments',
           jsonb_build_object('agreement', ag.name, 'memberNumber', pa.member_number, 'validFrom', pa.valid_from, 'validTo', pa.valid_to, 'endReason', pa.end_reason),
           u.full_name, NULL::text, NULL::timestamptz, NULL::bigint
      FROM patient_agreements pa JOIN agreements ag ON ag.id = pa.agreement_id LEFT JOIN users u ON u.id = pa.created_by
     WHERE pa.patient_id = $1
    UNION ALL
    SELECT ob.created_at, 'ob:' || ob.id, CASE WHEN ob.voids_id IS NULL THEN 'opening.balance' ELSE 'opening.balance.void' END, 'payments',
           jsonb_build_object('cutoff', ob.cutoff_date, 'notes', ob.notes, 'reason', ob.void_reason, 'debt', ob.amount_cents > 0),
           u.full_name, b.name, NULL::timestamptz, ob.amount_cents
      FROM opening_balances ob JOIN users u ON u.id = ob.created_by LEFT JOIN branches b ON b.id = ob.branch_id
     WHERE ob.patient_id = $1
    UNION ALL
    SELECT ir.created_at, 'ir:' || ir.id, 'invoice.requested', 'payments',
           jsonb_build_object('number', ir.number, 'billTo', ir.bill_to, 'buyer', ir.buyer_name, 'status', ir.status),
           u.full_name, b.name, NULL::timestamptz, ir.total_cents
      FROM invoice_requests ir JOIN users u ON u.id = ir.created_by JOIN branches b ON b.id = ir.branch_id
     WHERE ir.patient_id = $1
    UNION ALL
    SELECT t.created_at, 'pt:' || t.id, 'agreement.transfer', 'payments',
           jsonb_build_object('agreement', ag.name, 'cause', t.cause, 'reason', t.reason, 'service', COALESCE(bi.description, ch.description)),
           u.full_name, b.name, NULL::timestamptz, t.amount_cents
      FROM payer_transfers t JOIN agreements ag ON ag.id = t.agreement_id JOIN charges ch ON ch.id = t.charge_id
      LEFT JOIN budget_items bi ON bi.id = ch.budget_item_id JOIN users u ON u.id = t.created_by JOIN branches b ON b.id = t.branch_id
     WHERE t.patient_id = $1`,
  documents: ({ informed }) => `
    SELECT d.signed_at, 'sd:' || d.id, 'document', 'documents',
           jsonb_build_object('documentId', d.id, 'docKind', d.kind, 'title', d.title, 'decision', d.decision, 'method', d.method, 'signer', d.signer_name),
           COALESCE(u.full_name, 'El paciente (reserva web)'), b.name, NULL::timestamptz, NULL::bigint
      FROM signed_documents d JOIN branches b ON b.id = d.branch_id LEFT JOIN users u ON u.id = d.recorded_by
     WHERE d.patient_id = $1 ${informed ? "" : "AND d.kind <> 'informed_consent'"}`,
  recalls: () => `
    SELECT r.created_at, 'rc:' || r.id, 'recall.created', 'recalls', jsonb_build_object('reason', r.reason, 'dueDate', r.due_date, 'origin', r.origin),
           u.full_name, b.name, NULL::timestamptz, NULL::bigint
      FROM recalls r JOIN branches b ON b.id = r.branch_id LEFT JOIN users u ON u.id = r.created_by
     WHERE r.patient_id = $1
    UNION ALL
    SELECT r.done_at, 'rd:' || r.id, 'recall.done', 'recalls', jsonb_build_object('reason', r.reason, 'dueDate', r.due_date),
           NULL::text, b.name, NULL::timestamptz, NULL::bigint
      FROM recalls r JOIN branches b ON b.id = r.branch_id
     WHERE r.patient_id = $1 AND r.done_at IS NOT NULL
    UNION ALL
    SELECT r.dismissed_at, 'rx:' || r.id, 'recall.dismissed', 'recalls', jsonb_build_object('reason', r.reason, 'dismissReason', r.dismiss_reason),
           NULL::text, b.name, NULL::timestamptz, NULL::bigint
      FROM recalls r JOIN branches b ON b.id = r.branch_id
     WHERE r.patient_id = $1 AND r.dismissed_at IS NOT NULL
    UNION ALL
    SELECT t.created_at, 'ra:' || t.id, 'recall.attempt', 'recalls',
           jsonb_build_object('reason', r.reason, 'channel', t.channel, 'outcome', t.outcome, 'note', t.note),
           u.full_name, b.name, NULL::timestamptz, NULL::bigint
      FROM recall_attempts t JOIN recalls r ON r.id = t.recall_id JOIN branches b ON b.id = r.branch_id JOIN users u ON u.id = t.user_id
     WHERE r.patient_id = $1
    UNION ALL
    SELECT k.created_at, 'pc:' || k.id, 'call', 'recalls',
           jsonb_build_object('outcome', k.outcome, 'durationMin', k.duration_min, 'note', k.note, 'appointmentId', k.appointment_id),
           u.full_name, b.name, ap.starts_at, NULL::bigint
      FROM patient_calls k JOIN users u ON u.id = k.user_id JOIN branches b ON b.id = k.branch_id LEFT JOIN appointments ap ON ap.id = k.appointment_id
     WHERE k.patient_id = $1`,
  messages: () => `
    SELECT m.created_at, 'om:' || m.id, 'message', 'messages',
           jsonb_build_object('channel', m.channel, 'template', m.template, 'purpose', m.purpose, 'status', m.status,
             'body', CASE WHEN m.purpose = 'otp' THEN NULL ELSE left(m.body, 240) END, 'error', m.error),
           NULL::text, b.name, NULL::timestamptz, NULL::bigint
      FROM outbound_messages m LEFT JOIN branches b ON b.id = m.branch_id
     WHERE m.patient_id = $1`,
  // Imágenes y archivos (B-012): subidas y archivados/restaurados con motivo.
  files: () => `
    SELECT f.created_at, 'cf:' || f.id, 'file.uploaded', 'files',
           jsonb_build_object('fileId', f.id, 'fileKind', f.kind, 'teeth', f.teeth, 'takenOn', f.taken_on, 'description', left(f.description, 240)),
           u.full_name, b.name, NULL::timestamptz, NULL::bigint
      FROM clinical_files f JOIN branches b ON b.id = f.branch_id JOIN users u ON u.id = f.uploaded_by
     WHERE f.patient_id = $1
    UNION ALL
    SELECT e.created_at, 'fe:' || e.id, CASE WHEN e.kind = 'archived' THEN 'file.archived' ELSE 'file.restored' END, 'files',
           jsonb_build_object('fileId', f.id, 'fileKind', f.kind, 'teeth', f.teeth, 'reason', e.reason),
           u.full_name, b.name, NULL::timestamptz, NULL::bigint
      FROM clinical_file_events e JOIN clinical_files f ON f.id = e.file_id JOIN branches b ON b.id = f.branch_id JOIN users u ON u.id = e.user_id
     WHERE f.patient_id = $1`,
  feedback: () => `
    SELECT s.answered_at, 'sv:' || s.id, 'survey.answered', 'feedback',
           jsonb_build_object('score', s.score, 'comment', left(s.comment, 240), 'followup', s.followup_note),
           NULL::text, b.name, a.starts_at, NULL::bigint
      FROM satisfaction_surveys s JOIN branches b ON b.id = s.branch_id JOIN appointments a ON a.id = s.appointment_id
     WHERE s.patient_id = $1 AND s.answered_at IS NOT NULL`,
};

const NOTE_KINDS: Record<string, string> = { evolution: "Evolución", diagnosis: "Diagnóstico", prescription: "Receta", referral: "Derivación", consent: "Consentimiento", other: "Nota" };
const STATE_LABELS: Record<string, string> = { existing: "existente", planned: "planificado", completed: "realizado" };
const STATUS_EVENT_TITLES: Record<string, string> = {
  scheduled: "Cita vuelta a agendada", confirmed: "Cita confirmada", arrived: "Llegó a la clínica", in_progress: "Pasó al sillón (en atención)",
  completed: "Cita atendida", cancelled: "Cita cancelada", no_show: "No asistió a la cita",
};
const BUDGET_EVENT_LABELS: Record<string, string> = {
  link_created: "Enlace del presupuesto creado", link_revoked: "Enlace del presupuesto revocado", delivered: "Presupuesto entregado",
  whatsapp_opened: "WhatsApp del presupuesto abierto", verify_failed: "Verificación fallida en el enlace del presupuesto",
  link_locked: "Enlace del presupuesto bloqueado por intentos", viewed: "Presupuesto visto por el paciente",
  follow_up: "Seguimiento del presupuesto", version_created: "Nueva versión del presupuesto",
};
const CHANNEL_LABELS: Record<string, string> = {
  call: "Llamada", whatsapp: "WhatsApp", sms: "SMS", in_person: "En persona", email: "Correo", phone: "Teléfono", in_hand: "En mano", link: "Enlace", other: "Otro",
};
const OUTCOME_LABELS: Record<string, string> = {
  no_answer: "no contesta", voicemail: "buzón de voz", scheduled: "agendó", declined: "rechaza", wrong_number: "número errado", other: "otro resultado",
};
const DECISION_LABELS: Record<string, string> = { granted: "Firmado", refused: "Rechazado", revoked: "Revocado" };
const MSG_STATUS: Record<string, string> = { queued: "en cola", simulated: "simulado, no se envió", sent: "enviado", failed: "falló el envío" };

interface Row { at: Date; at_key: string; id: string; kind: string; cat: TimelineCategory; ref: Record<string, any>; actor: string | null; branch: string | null; appt_at: Date | null; amount: number | null }

export function describe(r: Pick<Row, "kind" | "ref" | "appt_at">, zone: string): { title: string; detail: string | null } {
  const f = (d: Date | string | null | undefined) => (d ? DateTime.fromJSDate(new Date(d), { zone }).toFormat("dd/MM/yyyy HH:mm") : "");
  const x = r.ref;
  const apptBits = () => [x.dentist, x.type, x.procedure, x.seriesIndex ? `serie, cita ${x.seriesIndex}` : null].filter(Boolean).join(" · ");
  switch (r.kind) {
    case "appointment.created":
      return { title: "Cita agendada", detail: `Para el ${f(r.appt_at)}${apptBits() ? ` · ${apptBits()}` : ""}` };
    case "appointment.status":
      return { title: STATUS_EVENT_TITLES[x.to] ?? `Cita: ${STATUS_LABELS[x.to] ?? x.to}`, detail: [`Cita del ${f(r.appt_at)}`, x.reason, x.retroactive ? "registrado después" : null].filter(Boolean).join(" · ") };
    case "appointment.rescheduled":
      return { title: "Cita reprogramada", detail: `De ${f(x.fromAt)} a ${f(x.toAt)}${x.dentist ? ` · ${x.dentist}` : ""}` };
    case "clinical.note":
      return { title: `${NOTE_KINDS[x.noteKind] ?? "Nota clínica"}${x.amends ? " (enmienda)" : ""}`, detail: [x.diagnosis ? `Dx: ${x.diagnosis}` : null, x.excerpt].filter(Boolean).join(" · ") };
    case "odontogram.entry":
    case "odontogram.void": {
      const cond = CONDITIONS[x.condition]?.label ?? x.condition;
      const surf = Array.isArray(x.surfaces) && x.surfaces.length ? ` · superficies ${x.surfaces.join(", ")}` : "";
      return {
        title: r.kind === "odontogram.void" ? `Odontograma: anulación en la pieza ${x.tooth}` : `Odontograma: pieza ${x.tooth}`,
        detail: `${cond} (${STATE_LABELS[x.state] ?? x.state})${surf}${x.notes ? ` · ${x.notes}` : ""}`,
      };
    }
    case "budget.created":
      return { title: `Presupuesto N° ${x.number}${x.version > 1 ? ` (versión ${x.version})` : ""} creado`, detail: null };
    case "budget.presented":
      return { title: `Presupuesto N° ${x.number} presentado al paciente`, detail: null };
    case "budget.decided":
      return { title: `Presupuesto N° ${x.number}: ${(BUDGET_LABELS[x.status] ?? x.status).toLowerCase()}`, detail: x.note ?? null };
    case "budget.event":
      return { title: `${BUDGET_EVENT_LABELS[x.event] ?? x.event} · N° ${x.number}`, detail: [x.channel ? CHANNEL_LABELS[x.channel] ?? x.channel : null, x.reason].filter(Boolean).join(" · ") || null };
    case "charge":
      return { title: `Cargo: ${x.description}`, detail: [x.dentist ? `Profesional: ${x.dentist}` : null, Number(x.thirdParty) > 0 ? `paga el convenio ${(Number(x.thirdParty) / 100).toFixed(2).replace(".", ",")} Bs` : null].filter(Boolean).join(" · ") || null };
    case "charge.void":
      return { title: `Anulación de cargo: ${x.description}`, detail: null };
    case "payment.received":
      return { title: `Pago recibido · ${METHOD_LABELS[x.method] ?? x.method}`, detail: `Recibo N° ${x.receipt}${x.method !== "cash" ? " · queda por verificar en el banco" : ""}` };
    case "payment.verified":
      return { title: x.decision === "rejected" ? "Pago rechazado tras verificar en el banco" : "Pago confirmado en el banco", detail: [`Recibo N° ${x.receipt}`, x.reason].filter(Boolean).join(" · ") };
    case "payment.voided":
      return { title: "Pago anulado", detail: [`Recibo N° ${x.receipt}`, x.reason].filter(Boolean).join(" · ") };
    case "agreement.enrolled":
      return {
        title: `Afiliado al convenio ${x.agreement}`,
        detail: [`N° de afiliado ${x.memberNumber}`, `desde ${String(x.validFrom).split("-").reverse().join("/")}`, x.validTo ? `hasta ${String(x.validTo).split("-").reverse().join("/")}` : null, x.endReason ? `baja: ${x.endReason}` : null].filter(Boolean).join(" · "),
      };
    case "opening.balance":
      return { title: x.debt ? "Saldo inicial del sistema anterior: deuda" : "Saldo inicial del sistema anterior: a favor del paciente", detail: [x.cutoff ? `Al ${DateTime.fromISO(String(x.cutoff)).toFormat("dd/MM/yyyy")}` : null, x.notes].filter(Boolean).join(" · ") || null };
    case "opening.balance.void":
      return { title: "Anulación del saldo inicial", detail: x.reason ?? null };
    case "agreement.transfer":
      return x.cause === "reversal"
        ? { title: `Se devolvió a ${x.agreement} una porción trasladada`, detail: [x.service, x.reason].filter(Boolean).join(" · ") }
        : { title: `${x.agreement} no pagó su parte: pasó al saldo del paciente`, detail: [x.service, x.cause === "rejected" ? "la empresa la rechazó" : "vencida sin pago", x.reason].filter(Boolean).join(" · ") };
    case "invoice.requested":
      return { title: `Marcado como pendiente de facturar (N° ${x.number})`, detail: `A nombre de ${x.buyer}${x.status === "cancelled" ? " · anulado" : ""} · aún no es una factura fiscal` };
    case "document":
      return { title: `${DECISION_LABELS[x.decision] ?? x.decision}: ${x.title}`, detail: x.signer ? `Firmante: ${x.signer}` : null };
    case "recall.created":
      return { title: `Control programado: ${x.reason}`, detail: x.dueDate ? `Para ${DateTime.fromISO(String(x.dueDate)).setLocale("es").toFormat("LLLL yyyy")}` : null };
    case "recall.done":
      return { title: `Control cumplido: ${x.reason}`, detail: null };
    case "recall.dismissed":
      return { title: `Control descartado: ${x.reason}`, detail: x.dismissReason ?? null };
    case "recall.attempt":
      return { title: `Intento de contacto: ${CHANNEL_LABELS[x.channel] ?? x.channel}, ${OUTCOME_LABELS[x.outcome] ?? x.outcome}`, detail: [x.reason, x.note].filter(Boolean).join(" · ") || null };
    case "call":
      return {
        title: `Llamada: ${CALL_OUTCOME_LABELS[x.outcome]?.toLowerCase() ?? x.outcome}`,
        detail: [x.durationMin != null ? `${x.durationMin} min` : null, r.appt_at ? `sobre la cita del ${f(r.appt_at)}` : null, x.note].filter(Boolean).join(" · ") || null,
      };
    case "message":
      return {
        title: `Mensaje por ${CHANNEL_LABELS[x.channel] ?? x.channel} (${MSG_STATUS[x.status] ?? x.status})`,
        detail: x.purpose === "otp" ? "Código de verificación (contenido oculto)" : x.body ?? null,
      };
    case "file.uploaded":
    case "file.archived":
    case "file.restored": {
      const label = FILE_KIND_LABELS[x.fileKind as keyof typeof FILE_KIND_LABELS] ?? "Archivo";
      const teeth = Array.isArray(x.teeth) && x.teeth.length ? `${x.teeth.length > 1 ? "Piezas" : "Pieza"} ${x.teeth.join(", ")}` : null;
      if (r.kind === "file.uploaded") {
        const taken = x.takenOn ? `Tomada el ${DateTime.fromISO(String(x.takenOn)).toFormat("dd/MM/yyyy")}` : null;
        return { title: `Imagen o archivo agregado: ${label}`, detail: [teeth, taken, x.description].filter(Boolean).join(" · ") || null };
      }
      return { title: `${r.kind === "file.archived" ? "Se archivó" : "Se restauró"}: ${label}`, detail: [teeth, x.reason].filter(Boolean).join(" · ") || null };
    }
    case "survey.answered":
      return {
        title: `Respondió la encuesta de satisfacción: ${x.score}/10${x.score <= 6 ? " (detractor)" : x.score >= 9 ? " (promotor)" : ""}`,
        detail: [`Visita del ${f(r.appt_at)}`, x.comment ? `«${x.comment}»` : null, x.followup ? `Seguimiento: ${x.followup}` : null].filter(Boolean).join(" · "),
      };
    default:
      return { title: r.kind, detail: null };
  }
}

const zCursor = z.string().max(200).regex(/^[A-Za-z0-9_-]+$/, "Cursor inválido");
const encodeCursor = (atKey: string, id: string) => Buffer.from(`${atKey}|${id}`, "utf8").toString("base64url");
function decodeCursor(s: string): [string, string] {
  const [at, id] = Buffer.from(s, "base64url").toString("utf8").split("|");
  if (!at || !id || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(at) || !/^[a-z]{2}:[0-9a-f-]{1,40}$/.test(id)) throw badRequest("Cursor inválido");
  return [at, id];
}

export function patientTimelineRoutes(route: Route) {
  route({
    method: "GET", url: "/api/patients/:id/timeline",
    summary: "Línea de tiempo del paciente: citas, notas, odontograma, presupuestos, cargos y pagos, documentos, controles y mensajes según los permisos del rol. Paginada por cursor",
    tags: ["pacientes"], perm: "patients.read", params: zIdParams,
    query: z.object({
      types: z.string().max(200).optional(),
      cursor: zCursor.optional(),
      limit: z.coerce.number().int().min(1).max(200).default(50),
    }),
    handler: async ({ c, auth, params, query }) => {
      const p = (await c.query("SELECT id FROM patients WHERE id = $1", [params.id])).rows[0];
      if (!p) throw notFound("Paciente");
      const allowed = allowedCategories(auth);
      let wanted = allowed;
      if (query.types) {
        const asked = query.types.split(",").map((t) => t.trim()).filter(Boolean);
        const unknown = asked.filter((t) => !(TIMELINE_CATEGORIES as readonly string[]).includes(t));
        if (unknown.length) throw badRequest(`Tipo de evento desconocido: ${unknown.join(", ")}`);
        // Lo que el rol no puede ver no se devuelve aunque se pida.
        wanted = allowed.filter((c) => asked.includes(c));
      }
      const zone = await clinicZone(c, auth.clinicId!);
      const informed = auth.permissions.has("clinical.read") || auth.permissions.has("budgets.read");
      const base = { zone, available: allowed.map((id) => ({ id, label: CATEGORY_LABELS[id] })) };
      if (!wanted.length) return { ...base, items: [], nextCursor: null };
      const [cAt, cId] = query.cursor ? decodeCursor(query.cursor) : [null, null];
      const union = wanted.map((cat) => SOURCES[cat]({ informed })).join("\nUNION ALL\n");
      const rows = (await c.query<Row>(
        `SELECT t.*, to_char(t.at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS at_key
           FROM (${union}) AS t (at, id, kind, cat, ref, actor, branch, appt_at, amount)
          WHERE t.at IS NOT NULL AND ($2::timestamptz IS NULL OR (t.at, t.id) < ($2::timestamptz, $3::text))
          ORDER BY t.at DESC, t.id DESC LIMIT $4`,
        [params.id, cAt, cId, query.limit + 1],
      )).rows;
      const page = rows.slice(0, query.limit);
      const last = page[page.length - 1];
      const nextCursor = rows.length > query.limit && last ? encodeCursor(last.at_key, last.id) : null;
      const fmt = (d: Date) => DateTime.fromJSDate(d, { zone }).toFormat("dd/MM/yyyy HH:mm");
      // Agrupa eventos idénticos consecutivos (mismo tipo, título y detalle).
      const items: any[] = [];
      for (const r of page) {
        const { title, detail } = describe(r, zone);
        const groupKey = `${r.kind}|${title}|${detail ?? ""}`;
        const prev = items[items.length - 1];
        if (prev && prev.groupKey === groupKey) {
          prev.count++;
          prev.firstAt = r.at.toISOString();
          prev.firstLocal = fmt(r.at);
          prev.ids.push(r.id);
          continue;
        }
        items.push({
          id: r.id, ids: [r.id], groupKey, count: 1, category: r.cat, categoryLabel: CATEGORY_LABELS[r.cat], kind: r.kind, title, detail,
          at: r.at.toISOString(), local: fmt(r.at), firstAt: r.at.toISOString(), firstLocal: fmt(r.at),
          appointmentAt: r.appt_at ? r.appt_at.toISOString() : null, appointmentLocal: r.appt_at ? fmt(r.appt_at) : null,
          actor: r.actor, branch: r.branch, amountCents: r.amount, ref: pickRef(r),
        });
      }
      if (!query.cursor) await audit(c, auth, "patient.timeline_viewed", "patient", params.id, { types: wanted });
      return { ...base, items, nextCursor };
    },
  });
}

/** Solo los identificadores útiles para enlazar (nunca el texto clínico completo). */
function pickRef(r: Row) {
  const x = r.ref;
  const out: Record<string, unknown> = {};
  for (const k of ["appointmentId", "budgetId", "documentId", "fileId", "typeColor", "status", "to", "decision"]) if (x[k] != null) out[k] = x[k];
  return out;
}
