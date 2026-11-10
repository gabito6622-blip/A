// Diccionario de acciones de la auditoría → frases en lenguaje claro para el diario de actividad
// (R2-37). Reglas:
//  * La frase solo usa datos estructurados que la consulta deja pasar (montos, método, estados,
//    números, rol). NUNCA textos libres (motivos, notas, títulos) ni datos clínicos (diagnóstico,
//    pieza, hallazgo, antecedentes): de lo clínico solo se dice que "registró una nota clínica de…".
//  * El paciente aparece abreviado ("Juan P.") y solo si quien consulta puede ver pacientes.
//  * Una acción que no está en el diccionario recibe una frase genérica por su tipo.
import { DateTime } from "luxon";
import { ROLE_LABELS, type Role } from "../../lib/rbac.js";
import { STATUS_LABELS } from "../agenda.js";
import { BUDGET_LABELS } from "../billing.js";
import { LAB_STATUS_LABELS, type LabStatus } from "../lab.js";
import { CALL_OUTCOME_LABELS } from "./calls.js";

export const ACTIVITY_TYPES = {
  patients: "Pacientes", agenda: "Agenda y controles", payments: "Cobros y caja", budgets: "Presupuestos y tratamientos",
  clinical: "Atención clínica", tasks: "Tareas y llamadas", lab: "Laboratorio", inventory: "Inventario", biosafety: "Bioseguridad",
  messaging: "Mensajes", staff: "Personal y configuración", access: "Accesos y seguridad", reports: "Reportes y exportaciones",
  portal: "Portal del paciente", other: "Otros",
} as const;
export type ActivityType = keyof typeof ACTIVITY_TYPES;

/** Prefijo de la acción (antes del primer punto) → tipo del diario. */
export const PREFIX_TYPE: Record<string, ActivityType> = {
  patient: "patients", document: "patients", consent: "patients",
  appointment: "agenda", appointment_series: "agenda", waitlist: "agenda", recall: "agenda",
  payment: "payments", charge: "payments", cash_session: "payments", cash_movement: "payments", fee_settlement: "payments",
  budget: "budgets", treatment: "budgets",
  medical_history: "clinical", odontogram: "clinical", clinical_note: "clinical", perio: "clinical",
  prescription: "clinical", certificate: "clinical", referral: "clinical",
  task: "tasks", call: "tasks",
  lab: "lab", lab_order: "lab",
  inventory: "inventory",
  biosafety: "biosafety",
  messaging: "messaging",
  staff: "staff", branch: "staff", chair: "staff", clinic: "staff", procedure: "staff", appointment_type: "staff",
  consent_template: "staff", medication: "staff", schedule: "staff", fee_rules: "staff",
  auth: "access",
  report: "reports", pdf: "reports", activity: "reports",
  portal: "portal",
  assistant: "other",
};
export const typeOfAction = (action: string): ActivityType => PREFIX_TYPE[action.split(".")[0]!] ?? "other";
/** Prefijos que corresponden a un tipo (para filtrar en SQL). */
export const prefixesOf = (t: ActivityType) => Object.entries(PREFIX_TYPE).filter(([, v]) => v === t).map(([k]) => k);
export const KNOWN_PREFIXES = Object.keys(PREFIX_TYPE);

export interface PhraseCtx {
  actor: string;
  /** Paciente abreviado ("Juan P.") o null si no hay o no se puede mostrar. */
  patient: string | null;
  /** Nombre de la persona del equipo afectada (altas y cambios de personal). */
  target: string | null;
  /** Solo los campos estructurados de la lista blanca. */
  d: Record<string, any>;
  zone: string;
}

const money = (cents: unknown) =>
  typeof cents === "number" || (typeof cents === "string" && /^-?\d+$/.test(cents))
    ? `Bs ${new Intl.NumberFormat("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Math.abs(Number(cents)) / 100)}`
    : null;
const METHOD_PHRASE: Record<string, string> = { cash: "en efectivo", transfer: "por transferencia", qr: "QR", card: "con tarjeta" };
const de = (x: PhraseCtx) => (x.patient ? ` de ${x.patient}` : " de un paciente");
const a = (x: PhraseCtx) => (x.patient ? ` a ${x.patient}` : " a un paciente");
const para = (x: PhraseCtx) => (x.patient ? ` para ${x.patient}` : "");
const when = (x: PhraseCtx, iso: unknown) => {
  if (typeof iso !== "string") return "";
  const d = DateTime.fromISO(iso, { zone: x.zone });
  return d.isValid ? ` para el ${d.toFormat("dd/MM")} a las ${d.toFormat("HH:mm")}` : "";
};
const num = (v: unknown) => (typeof v === "number" || (typeof v === "string" && /^\d+$/.test(v)) ? ` N° ${v}` : "");
const role = (r: unknown) => (typeof r === "string" && r in ROLE_LABELS ? ROLE_LABELS[r as Role] : null);

const APPT_STATUS_PHRASE: Record<string, (x: PhraseCtx) => string> = {
  confirmed: (x) => `confirmó la cita${de(x)}`,
  arrived: (x) => `marcó la llegada${de(x)} a la sala de espera`,
  in_progress: (x) => `pasó al sillón${a(x)}`,
  completed: (x) => `marcó como atendida la cita${de(x)}`,
  cancelled: (x) => `canceló la cita${de(x)}`,
  no_show: (x) => `marcó que no asistió${x.patient ? ` ${x.patient}` : " un paciente"} a su cita`,
  scheduled: (x) => `volvió a dejar agendada la cita${de(x)}`,
};
const DOC_NAMES: Record<string, string> = { prescription: "una receta", certificate: "un certificado", referral: "una derivación" };

type Fn = (x: PhraseCtx) => string;
const P: Record<string, Fn> = {
  // Pacientes
  "patient.created": (x) => `registró al paciente nuevo${x.patient ? ` ${x.patient}` : ""}`,
  "patient.updated": (x) => `actualizó los datos${de(x)}`,
  "patient.viewed": (x) => `abrió la ficha${de(x)}`,
  "patient.timeline_viewed": (x) => `consultó el historial${de(x)}`,
  "patient.archived": (x) => `archivó la ficha${de(x)}`,
  "patient.restored": (x) => `reactivó la ficha${de(x)}`,
  "patient.exported": (x) => `exportó el padrón de pacientes a Excel${typeof x.d.count === "number" ? ` (${x.d.count} pacientes)` : ""}`,
  "patient.imported": () => "importó pacientes desde Excel",
  "document.signed": (x) => `registró la firma de un documento${de(x)}`,
  "document.viewed": (x) => `abrió un documento firmado${de(x)}`,
  "consent.revoked_by_patient": (x) => `registró que${x.patient ? ` ${x.patient}` : " un paciente"} revocó un consentimiento`,
  // Atención clínica (sin contenido clínico)
  "medical_history.recorded": (x) => `actualizó los antecedentes médicos${de(x)}`,
  "odontogram.viewed": (x) => `consultó el odontograma${de(x)}`,
  "odontogram.recorded": (x) => `registró un hallazgo en el odontograma${de(x)}`,
  "odontogram.voided": (x) => `anuló un registro del odontograma${de(x)}`,
  "clinical_note.created": (x) => `registró una nota clínica${de(x)}`,
  "clinical_note.amended": (x) => `agregó una enmienda a una nota clínica${de(x)}`,
  "perio.started": (x) => `empezó un periodontograma${de(x)}`,
  "perio.amendment_started": (x) => `empezó una corrección del periodontograma${de(x)}`,
  "perio.saved": (x) => `guardó avances del periodontograma${de(x)}`,
  "perio.closed": (x) => `cerró el periodontograma${de(x)}`,
  "perio.discarded": (x) => `descartó un borrador de periodontograma${de(x)}`,
  "perio.viewed": (x) => `consultó un periodontograma${de(x)}`,
  "perio.list_viewed": (x) => `consultó los periodontogramas${de(x)}`,
  "perio.compared": (x) => `comparó periodontogramas${de(x)}`,
  // Agenda y controles
  "appointment.created": (x) => `agendó una cita${para(x)}${when(x, x.d.startsAt)}`,
  "appointment.rescheduled": (x) => `reprogramó la cita${de(x)}${when(x, x.d.to?.startsAt)}`,
  "appointment.updated": (x) => `editó los datos de la cita${de(x)}`,
  "appointment.status": (x) => (APPT_STATUS_PHRASE[x.d.to] ?? ((y: PhraseCtx) => `cambió el estado de la cita${de(y)}`))(x),
  "appointment.resolved": (x) => `cerró una cita pasada${de(x)} como «${STATUS_LABELS[x.d.to] ?? "cerrada"}»`,
  "appointment_series.created": (x) => `agendó una serie de citas${para(x)}`,
  "appointment_series.cancelled": (x) => `canceló citas de una serie${de(x)}`,
  "waitlist.added": (x) => `anotó${x.patient ? ` a ${x.patient}` : " a un paciente"} en la lista de espera`,
  "waitlist.booked": (x) => `agendó${x.patient ? ` a ${x.patient}` : " a un paciente"} desde la lista de espera`,
  "waitlist.cancelled": (x) => `quitó${x.patient ? ` a ${x.patient}` : " a un paciente"} de la lista de espera`,
  "recall.created": (x) => `programó un control${para(x)}`,
  "recall.attempt": (x) => `registró un intento de contacto${para(x)}`,
  "recall.done": (x) => `marcó como cumplido el control${de(x)}`,
  "recall.dismissed": (x) => `descartó el control${de(x)}`,
  "recall.review": (x) => `pasó a revisar el control${de(x)}`,
  "recall.scheduled": (x) => `vinculó una cita al control${de(x)}`,
  "recall.updated": (x) => `editó el control${de(x)}`,
  "recall.reactivated": (x) => `reactivó el control${de(x)}`,
  "recall.unlinked": (x) => `desvinculó la cita del control${de(x)}`,
  "recall.skipped": (x) => `decidió no programar un control${para(x)}`,
  "schedule.blocked": () => "bloqueó un horario de la agenda",
  "schedule.replaced": (x) => `cambió el horario de atención${x.target ? ` de ${x.target}` : ""}`,
  // Cobros y caja
  "payment.created": (x) => `registró un pago ${METHOD_PHRASE[x.d.method] ?? ""} de ${money(x.d.amountCents) ?? "un monto"}${a(x)}`.replace("  ", " "),
  "payment.confirmed": (x) => `confirmó en el banco un pago de ${money(x.d.amountCents) ?? "un monto"}${de(x)}`,
  "payment.rejected": (x) => `rechazó un pago de ${money(x.d.amountCents) ?? "un monto"}${de(x)} tras verificar en el banco`,
  "payment.voided": (x) => `anuló un pago de ${money(x.d.amountCents) ?? "un monto"}${de(x)}`,
  "charge.voided": (x) => `anuló un cargo de ${money(x.d.amountCents) ?? "un monto"}${de(x)}`,
  "cash_session.opened": (x) => `abrió la caja${num(x.d.number)}`,
  "cash_session.closed": (x) => (typeof x.d.differenceCents === "number" && x.d.differenceCents !== 0
    ? `cerró la caja con un ${x.d.differenceCents < 0 ? "faltante" : "sobrante"} de ${money(x.d.differenceCents)}`
    : "cerró la caja sin diferencias"),
  "cash_session.reviewed": () => "revisó un cierre de caja",
  "cash_movement.created": (x) => `registró un movimiento de caja${money(x.d.amountCents) ? ` de ${money(x.d.amountCents)}` : ""}`,
  "fee_settlement.created": () => "preparó una liquidación de honorarios",
  "fee_settlement.closed": () => "cerró una liquidación de honorarios",
  "fee_settlement.discarded": () => "descartó un borrador de liquidación de honorarios",
  "fee_settlement.exported": () => "exportó una liquidación de honorarios",
  // Presupuestos y tratamientos
  "budget.created": (x) => `creó el presupuesto${num(x.d.number)}${para(x)}`,
  "budget.status": (x) => `marcó como «${(BUDGET_LABELS[x.d.to] ?? "actualizado").toLowerCase()}» el presupuesto${de(x)}`,
  "budget.items_replaced": (x) => `modificó los tratamientos del presupuesto${de(x)}`,
  "budget.terms_changed": (x) => `cambió las condiciones del presupuesto${de(x)}`,
  "budget.link_created": (x) => `creó el enlace del presupuesto${de(x)} para el paciente`,
  "budget.link_revoked": (x) => `revocó el enlace del presupuesto${de(x)}`,
  "budget.delivered": (x) => `entregó el presupuesto${a(x)}`,
  "budget.version_created": (x) => `creó una nueva versión del presupuesto${de(x)}`,
  "budget.follow_up": (x) => `registró un seguimiento del presupuesto${de(x)}`,
  "treatment.performed": (x) => `registró un tratamiento realizado${a(x)}${money(x.d.amountCents) ? ` (${money(x.d.amountCents)})` : ""}`,
  "treatment.session_performed": (x) => `registró una sesión de tratamiento${a(x)}${money(x.d.amountCents) ? ` (${money(x.d.amountCents)})` : ""}`,
  "treatment.cancelled": (x) => `anuló un tratamiento pendiente${de(x)}`,
  // Tareas y llamadas
  "task.created": (x) => `creó una tarea${typeof x.d.assignee === "string" ? ` para ${x.d.assignee}` : ""}${x.d.priority === "high" ? " (prioridad alta)" : ""}`,
  "task.updated": () => "editó una tarea",
  "task.taken": () => "tomó una tarea",
  "task.released": () => "soltó una tarea",
  "task.done": () => "marcó una tarea como hecha",
  "task.cancelled": () => "canceló una tarea",
  "task.commented": () => "comentó una tarea",
  "call.logged": (x) => `registró una llamada${a(x)}${CALL_OUTCOME_LABELS[x.d.outcome] ? ` (${CALL_OUTCOME_LABELS[x.d.outcome]!.toLowerCase()})` : ""}`,
  // Laboratorio
  "lab.created": () => "registró un laboratorio",
  "lab.updated": () => "actualizó los datos de un laboratorio",
  "lab.payment_registered": (x) => `registró un pago al laboratorio${money(x.d.amountCents) ? ` de ${money(x.d.amountCents)}` : ""}`,
  "lab.payables_exported": () => "exportó las cuentas por pagar de laboratorio",
  "lab.statement_exported": () => "exportó el estado de cuenta de un laboratorio",
  "lab_order.created": (x) => `creó la orden de laboratorio${num(x.d.number)}${para(x)}`,
  "lab_order.updated": (x) => `editó la orden de laboratorio${num(x.d.number)}`,
  "lab_order.status": (x) => `pasó la orden de laboratorio${num(x.d.number)}${de(x)} a «${LAB_STATUS_LABELS[x.d.to as LabStatus] ?? "otro estado"}»`,
  // Inventario
  "inventory.item_created": () => "agregó un artículo al inventario",
  "inventory.item_updated": () => "editó un artículo del inventario",
  "inventory.adjusted": () => "ajustó el stock de un artículo",
  "inventory.receipt": () => "registró un ingreso de materiales",
  "inventory.consumed": () => "registró un consumo de materiales",
  "inventory.treatment_consumed": () => "descontó materiales por un tratamiento",
  "inventory.pending_consumption": () => "dejó un consumo de materiales pendiente de regularizar",
  "inventory.pending_resolved": () => "regularizó un consumo pendiente",
  "inventory.transfer_sent": () => "envió una transferencia de materiales a otra sucursal",
  "inventory.transfer_received": () => "recibió una transferencia de materiales",
  "inventory.count_created": () => "empezó un conteo físico",
  "inventory.count_updated": () => "avanzó un conteo físico",
  "inventory.count_approved": () => "aprobó un conteo físico",
  "inventory.count_cancelled": () => "canceló un conteo físico",
  "inventory.po_created": () => "creó una orden de compra",
  "inventory.po_updated": () => "editó una orden de compra",
  "inventory.po_sent": () => "envió una orden de compra",
  "inventory.po_received": () => "recibió una orden de compra",
  "inventory.po_closed": () => "cerró una orden de compra",
  "inventory.po_cancelled": () => "canceló una orden de compra",
  "inventory.supplier_created": () => "registró un proveedor",
  "inventory.supplier_updated": () => "editó un proveedor",
  "inventory.materials_updated": () => "cambió los materiales estándar de una prestación",
  // Bioseguridad
  "biosafety.cleaning": () => "registró una limpieza",
  "biosafety.cycle": () => "registró un ciclo de esterilización",
  "biosafety.cycle_failed": () => "registró un ciclo de esterilización con indicador químico fallido",
  "biosafety.bio": () => "registró el resultado de un indicador biológico",
  "biosafety.bio_failed": () => "registró un indicador biológico fallido",
  "biosafety.sterilizer_created": () => "registró un autoclave",
  "biosafety.sterilizer_updated": () => "editó un autoclave",
  // Mensajes
  "messaging.rule_created": () => "creó una regla de mensajes automáticos",
  "messaging.rule_updated": () => "editó una regla de mensajes automáticos",
  "messaging.template_created": () => "creó una plantilla de mensaje",
  "messaging.template_updated": () => "editó una plantilla de mensaje",
  "messaging.settings_updated": () => "cambió la configuración de mensajes",
  "messaging.retried": () => "reintentó el envío de un mensaje",
  "messaging.skipped": () => "omitió un mensaje programado",
  "messaging.confirmed_by_link": (x) => `confirmó la cita${de(x)} por el enlace de confirmación`,
  "messaging.reschedule_requested": (x) => `pidió reprogramar la cita${de(x)} por el enlace`,
  // Personal y configuración
  "staff.added": (x) => `agregó${x.target ? ` a ${x.target}` : " a una persona"} al equipo${role(x.d.role) ? ` como ${role(x.d.role)}` : ""}`,
  "staff.updated": (x) => `actualizó el acceso${x.target ? ` de ${x.target}` : " de una persona"}${role(x.d.to) ? ` (${role(x.d.to)})` : ""}`,
  "staff.password_reset": (x) => `emitió una contraseña temporal${x.target ? ` para ${x.target}` : ""}`,
  "branch.created": () => "creó una sucursal",
  "branch.updated": () => "editó los datos de una sucursal",
  "chair.created": () => "agregó un consultorio",
  "chair.updated": () => "editó un consultorio",
  "clinic.updated": () => "editó los datos de la clínica",
  "procedure.created": () => "agregó una prestación al catálogo",
  "procedure.updated": () => "editó una prestación del catálogo",
  "procedure.sessions_changed": () => "cambió las sesiones de una prestación",
  "appointment_type.created": () => "creó un tipo de cita",
  "appointment_type.updated": () => "editó un tipo de cita",
  "consent_template.versioned": () => "publicó una nueva versión de una plantilla de consentimiento",
  "consent_template.active": () => "activó o desactivó una plantilla de consentimiento",
  "medication.created": () => "agregó un medicamento al catálogo",
  "medication.updated": () => "editó un medicamento del catálogo",
  "medication.seeded": () => "cargó el catálogo inicial de medicamentos",
  "fee_rules.updated": () => "cambió las reglas de honorarios de un profesional",
  // Accesos
  "auth.login": () => "inició sesión",
  "auth.login_recovery_code": () => "inició sesión con un código de recuperación",
  "auth.password_ok_mfa_pending": () => "ingresó su contraseña (faltaba el segundo paso)",
  "auth.switch_clinic": () => "entró a la clínica",
  "auth.password_changed": () => "cambió su contraseña",
  "auth.password_reset": () => "restableció su contraseña",
  "auth.mfa_enabled": () => "activó la verificación en dos pasos",
  "auth.mfa_disabled": () => "desactivó la verificación en dos pasos",
  "auth.mfa_recovery_regenerated": () => "generó nuevos códigos de recuperación",
  // Reportes
  "report.exported": () => "exportó un reporte a Excel",
  "pdf.downloaded": () => "descargó un documento PDF",
  "activity.exported": () => "exportó el diario de actividad a Excel",
  // Portal
  "portal.booking_created": (x) => `reservó una cita desde el portal${para(x)}`,
  "portal.request_approved": (x) => `aprobó una solicitud de reserva${de(x)}`,
  "portal.request_rejected": (x) => `rechazó una solicitud de reserva${de(x)}`,
  "portal.request_cancelled": (x) => `canceló una solicitud de reserva${de(x)}`,
  "portal.settings_updated": () => "cambió la configuración de la reserva en línea",
  "portal.login": () => "ingresó al portal del paciente",
  "portal.appointment_cancelled": () => "canceló su cita desde el portal",
  "portal.appointment_rescheduled": () => "reprogramó su cita desde el portal",
  // Otros
  "assistant.tool": () => "usó el asistente",
};
for (const k of ["prescription", "certificate", "referral"]) {
  P[`${k}.issued`] = (x) => `emitió ${DOC_NAMES[k]}${para(x)}`;
  P[`${k}.voided`] = (x) => `anuló ${DOC_NAMES[k]}${de(x)}`;
}

const GENERIC: Record<ActivityType, string> = {
  patients: "hizo un cambio en la ficha de un paciente", agenda: "hizo un cambio en la agenda", payments: "hizo una operación de cobros o caja",
  budgets: "hizo un cambio en un presupuesto", clinical: "registró información clínica", tasks: "hizo un cambio en las tareas",
  lab: "hizo un cambio en laboratorio", inventory: "hizo un movimiento de inventario", biosafety: "hizo un registro de bioseguridad",
  messaging: "hizo un cambio en los mensajes", staff: "cambió la configuración", access: "hizo una operación de acceso",
  reports: "exportó información", portal: "hizo una operación en el portal del paciente", other: "realizó una operación",
};

/** Frase completa: "Ana registró un pago QR de Bs 150,00 a Juan P." */
export function phrase(action: string, x: PhraseCtx): string {
  const fn = P[action];
  const body = fn ? fn(x) : GENERIC[typeOfAction(action)];
  return `${x.actor} ${body.replace(/\s{2,}/g, " ").trim()}`;
}

export const KNOWN_ACTIONS = () => Object.keys(P);
