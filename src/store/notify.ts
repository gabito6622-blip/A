// Mensajes de WhatsApp por bandeja de salida (outbox).
// - Solo plantillas fijas; ningún parámetro puede llevar contraseñas, PIN ni códigos.
// - Sin consentimiento del cliente no se envía (queda "skipped_no_consent").
// - El envío real lo hace un transporte autorizado (WhatsApp Cloud API u otro) en `flush`.
import type { Actor, Id, OutboxMessage, TemplateId } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

const TEMPLATES: Record<TemplateId, string> = {
  order_received: "Hola {name}, registramos tu pedido #{order} por {total}. Estamos verificando el pago y te avisamos al confirmarlo.",
  order_confirmed: "Gabriel Store: tu pedido #{order} fue confirmado. Tus accesos están en tu área privada → Mis cuentas.",
  payment_rejected: "Gabriel Store: no pudimos verificar el pago del pedido #{order}. Respondé este mensaje si ya pagaste.",
  topup_approved: "Gabriel Store: acreditamos {amount} a tu saldo. Saldo actual: {balance}.",
  renewal_confirmed: "Gabriel Store: renovamos {product}. Nuevo vencimiento: {date}.",
  expiry_reminder: "Hola {name}, tu {product} vence el {date}. Podés renovarlo desde Mis cuentas.",
  replacement_done: "Gabriel Store: cambiamos el acceso de tu {product}. Mirá los datos nuevos en Mis cuentas.",
};

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
    status: c.whatsappConsent ? "queued" : "skipped_no_consent", createdAt: e.now(),
  };
  e.s.outbox.push(m);
  return m;
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
