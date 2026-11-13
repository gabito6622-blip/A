// Mensajes de WhatsApp por bandeja de salida (outbox).
// - Solo plantillas fijas; ningún parámetro puede llevar contraseñas, PIN ni códigos.
// - Sin consentimiento del cliente no se envía (queda "skipped_no_consent").
// - El envío real lo hace un transporte autorizado (WhatsApp Cloud API u otro) en `flush`.
import type { Actor, Id, OutboxMessage, StaffAlertSettings, TemplateId } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

export const TEMPLATES: Record<TemplateId, string> = {
  staff_payment_review: "Gabriel Store: nuevo pago para revisar. Pedido #{order} de {name} por {total}. Entrá al panel → Aprobación de ventas.",
  staff_supplier_expiry: "Gabriel Store: {count} cuenta(s) vencen con el proveedor: {list}. Renovalas o cambiá los datos en el panel → Cuentas.",
  order_received: "Hola {name}, registramos tu pedido #{order} por {total}. Estamos verificando el pago y te avisamos al confirmarlo.",
  order_confirmed: "Gabriel Store: tu pedido #{order} fue confirmado. Tus accesos están en tu área privada → Mis cuentas.",
  payment_rejected: "Gabriel Store: no pudimos verificar el pago del pedido #{order}. Respondé este mensaje si ya pagaste.",
  topup_approved: "Gabriel Store: acreditamos {amount} a tu saldo. Saldo actual: {balance}.",
  renewal_confirmed: "Gabriel Store: renovamos {product}. Nuevo vencimiento: {date}.",
  expiry_reminder: "Hola {name}, tu {product} vence el {date}. Podés renovarlo desde Mis cuentas.",
  replacement_done: "Gabriel Store: cambiamos el acceso de tu {product}. Mirá los datos nuevos en Mis cuentas.",
  access_updated: "Gabriel Store: actualizamos los datos de acceso de tu {product}. Mirá la clave nueva en Mis cuentas.",
  access_transferred: "Gabriel Store: te asignamos {product} (vence el {date}). Tus accesos están en Mis cuentas.",
};

/** Orden de los parámetros de una plantilla ({{1}}, {{2}}… en Meta). */
export function templateParamOrder(t: TemplateId): string[] {
  return [...TEMPLATES[t].matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/** Texto de la plantilla con {{1}}, {{2}}… para copiar y crear en Meta. */
export function metaTemplateBody(t: TemplateId): string {
  let i = 0;
  return TEMPLATES[t].replace(/\{(\w+)\}/g, () => `{{${++i}}}`);
}

/** Registra el resultado de un envío automático. Tras 5 intentos fallidos queda como "failed". */
export function markSendResult(e: Engine, actor: Actor, messageId: Id, r: { ok: true; waId?: string } | { ok: false; error: string; retry: boolean }): void {
  authorize(actor, "notify.flush");
  e.tx(() => {
    const m = e.s.outbox.find((x) => x.id === messageId);
    if (!m) return;
    m.attempts = (m.attempts ?? 0) + 1;
    if (r.ok) {
      m.status = "sent";
      m.waId = r.waId;
      delete m.error;
    } else {
      m.error = r.error;
      if (!r.retry || m.attempts >= 5) m.status = "failed";
    }
  });
}

const FORBIDDEN_PARAM = /pass|password|pin|secret|token|code|codigo|clave/i;

export function render(template: TemplateId, params: Record<string, string>): string {
  for (const k of Object.keys(params)) {
    if (FORBIDDEN_PARAM.test(k)) throw new DomainError("SENSITIVE_DATA", `El parámetro "${k}" no puede ir en un mensaje`);
  }
  return TEMPLATES[template].replace(/\{(\w+)\}/g, (_, k: string) => {
    if (!(k in params)) throw new DomainError("VALIDATION", `Falta el parámetro ${k} para ${template}`);
    return params[k];
  });
}

/** Encola un mensaje. Debe llamarse dentro de `tx`. */
export function queue(e: Engine, customerId: Id, template: TemplateId, params: Record<string, string>): OutboxMessage {
  const c = e.get("customers", customerId);
  const text = render(template, params);
  // Defensa extra: si por error el texto incluye una contraseña conocida, se bloquea.
  for (const a of Object.values(e.s.accounts)) {
    if (a.password && text.includes(a.password)) throw new DomainError("SENSITIVE_DATA", "El mensaje contiene una contraseña");
  }
  const m: OutboxMessage = {
    id: e.id("msg"), customerId, to: c.phone, template, params, text,
    status: c.whatsappConsent && c.phone ? "queued" : "skipped_no_consent", createdAt: e.now(),
    ...(c.phone ? {} : { error: "El cliente no tiene WhatsApp cargado" }),
  };
  e.s.outbox.push(m);
  return m;
}

export const DEFAULT_STAFF_ALERTS: StaffAlertSettings = { phone: "", payments: true, supplierExpiry: true, supplierDaysBefore: 2 };
export const staffAlertSettings = (e: Engine): StaffAlertSettings => ({ ...DEFAULT_STAFF_ALERTS, ...(e.s.settings.staffAlerts ?? {}) });

/** Encola un aviso para el dueño (si cargó su WhatsApp). Debe llamarse dentro de `tx`. */
export function queueStaff(e: Engine, template: TemplateId, params: Record<string, string>): OutboxMessage | undefined {
  const to = staffAlertSettings(e).phone;
  if (!to) return undefined;
  const m: OutboxMessage = { id: e.id("msg"), customerId: "staff", to, template, params, text: render(template, params), status: "queued", createdAt: e.now() };
  e.s.outbox.push(m);
  return m;
}

/** Mientras no haya WhatsApp automático: el staff lo manda a mano y lo marca como enviado. */
export function markSentManually(e: Engine, actor: Actor, messageId: Id, opts: { force?: boolean; reason?: string } = {}): OutboxMessage {
  authorize(actor, "notify.flush");
  return e.tx(() => {
    const m = e.s.outbox.find((x) => x.id === messageId);
    if (!m) throw new DomainError("NOT_FOUND", "Mensaje inexistente");
    if (m.status !== "queued" && m.status !== "failed" && m.status !== "skipped_no_consent") throw new DomainError("INVALID_STATE", "El mensaje ya se envió");
    // Sin permiso del cliente no se marca como enviado "por las dudas": solo el dueño, diciendo por qué (p. ej. "me lo pidió
    // por WhatsApp"), y queda en la auditoría. Lo correcto es activarle el permiso en su ficha.
    if (m.status === "skipped_no_consent") {
      const why = String(opts.reason ?? "").trim();
      if (!opts.force || why.length < 4) throw new DomainError("NO_CONSENT", "El cliente no aceptó avisos. Activale el permiso en su ficha o, si te lo pidió, el dueño puede marcarlo igual diciendo por qué.");
      if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Solo el dueño puede marcar como enviado un aviso sin permiso del cliente");
      e.audit(actor, "outbox.sent_without_consent", "outbox", m.id, { reason: why.slice(0, 200) });
    }
    m.status = "sent_manually";
    e.audit(actor, "outbox.sent_manually", "outbox", m.id);
    return structuredClone(m);
  });
}

export interface WhatsAppTransport {
  send(to: string, text: string): Promise<void>;
}

/** Envía lo encolado con un transporte autorizado. Errores quedan registrados por mensaje. */
export async function flush(e: Engine, actor: Actor, transport: WhatsAppTransport) {
  authorize(actor, "notify.flush");
  const pending = e.s.outbox.filter((m) => m.status === "queued").map((m) => m.id);
  let sent = 0, failed = 0;
  for (const id of pending) {
    const m = e.s.outbox.find((x) => x.id === id);
    if (!m || m.status !== "queued") continue;
    let error: string | undefined;
    try {
      await transport.send(m.to, m.text);
      sent++;
    } catch (err) {
      error = (err as Error).message;
      failed++;
    }
    // El estado se busca de nuevo: durante el `await` pudo haber otras transacciones.
    e.tx(() => {
      const cur = e.s.outbox.find((x) => x.id === id);
      if (cur) Object.assign(cur, error ? { status: "failed", error } : { status: "sent" });
    });
  }
  e.tx(() => e.audit(actor, "outbox.flush", "outbox", "*", { sent, failed }));
  return { sent, failed };
}
