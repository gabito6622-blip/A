// Bandeja de mensajes salientes (WhatsApp, SMS, correo) — base para WA-01.
//
// Reglas:
//  * Fuera de producción NUNCA sale un mensaje: se guarda con estado 'simulated' y se puede
//    ver en la página "Mensajes" (ahí aparecen, por ejemplo, los códigos de un solo uso).
//  * En producción sin proveedor configurado el mensaje queda 'queued' y en el registro del
//    servidor solo se anota que hay un mensaje en cola, sin su contenido.
//  * Los mensajes sensibles (códigos de un solo uso) se guardan enmascarados en producción:
//    ni el personal de la clínica puede leer un código ajeno.
//  * Integración real (WhatsApp Cloud API u otro): implementar MessageProvider y pasarlo a
//    createMessenger. El adaptador de WhatsApp Cloud API está en modules/messaging/whatsapp.ts y
//    solo se activa en producción con WHATSAPP_TOKEN y WHATSAPP_PHONE_ID.
import type { Config } from "../config.js";
import type { Client } from "./db.js";

export type Channel = "whatsapp" | "sms" | "email";
export type Purpose = "transactional" | "otp" | "reminders" | "marketing";
export type MessageStatus = "queued" | "simulated" | "sent" | "delivered" | "read" | "failed";

/** Plantilla aprobada por el proveedor (p. ej. Meta) y sus parámetros en orden. */
export interface ProviderTemplate { name: string; language: string; params: string[] }

export interface OutboundMessage {
  clinicId: string;
  branchId?: string | null;
  patientId?: string | null;
  channel: Channel;
  recipient: string;
  /** Identificador de la plantilla, p. ej. "portal.otp" (minúsculas, puntos y guiones bajos). */
  template: string;
  purpose: Purpose;
  body: string;
  /** Contiene un secreto (código de un solo uso): en producción se guarda enmascarado. */
  sensitive?: boolean;
  relatedEntity?: string | null;
  relatedId?: string | null;
  /** Clave única por clínica: un segundo intento con la misma clave es rechazado por la base (sin duplicados). */
  dedupeKey?: string | null;
  /** Reintento de un mensaje fallido (el original no se modifica). */
  retryOf?: string | null;
  /** Plantilla aprobada del proveedor (mensajes automáticos por WhatsApp Cloud API). */
  providerTemplate?: ProviderTemplate | null;
}

/** Adaptador para un proveedor real (por ejemplo, WhatsApp Cloud API: modules/messaging/whatsapp.ts). */
export interface MessageProvider {
  readonly name: string;
  send(m: { channel: Channel; recipient: string; template: string; body: string; providerTemplate?: ProviderTemplate | null }): Promise<{ providerMessageId: string }>;
}

export interface Messenger {
  /** "simulate" fuera de producción; "queue" en producción sin proveedor; "provider" con proveedor. */
  readonly mode: "simulate" | "queue" | "provider";
  enqueue(c: Client, m: OutboundMessage): Promise<{ id: string; status: MessageStatus }>;
}

/** Enmascara dígitos de secretos: "Tu código es 123456" → "Tu código es ******". */
export function redactSecrets(body: string): string {
  return body.replace(/\d{4,}/g, (m) => "*".repeat(m.length));
}

export function createMessenger(
  cfg: Pick<Config, "isProduction">,
  opts: { provider?: MessageProvider | null; log?: (msg: string) => void } = {},
): Messenger {
  const log = opts.log ?? ((m: string) => console.log(m));
  const provider = cfg.isProduction ? opts.provider ?? null : null;
  const mode: Messenger["mode"] = !cfg.isProduction ? "simulate" : provider ? "provider" : "queue";

  async function insert(c: Client, m: OutboundMessage, status: MessageStatus) {
    const stored = m.sensitive && cfg.isProduction ? redactSecrets(m.body) : m.body;
    const r = await c.query<{ id: string }>(
      `INSERT INTO outbound_messages (clinic_id, branch_id, patient_id, channel, recipient, template, purpose, body, status, provider, related_entity, related_id, dedupe_key, retry_of)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
      [m.clinicId, m.branchId ?? null, m.patientId ?? null, m.channel, m.recipient, m.template, m.purpose, stored, status,
        provider?.name ?? null, m.relatedEntity ?? null, m.relatedId ?? null, m.dedupeKey ?? null, m.retryOf ?? null],
    );
    return r.rows[0]!.id;
  }

  return {
    mode,
    async enqueue(c, m) {
      if (mode === "simulate") {
        return { id: await insert(c, m, "simulated"), status: "simulated" };
      }
      if (mode === "queue") {
        const id = await insert(c, m, "queued");
        // Sin contenido ni destinatario en el registro (pueden contener códigos o datos personales).
        log(`[mensajes] Proveedor no configurado: mensaje ${id} (${m.channel}, ${m.template}) queda en cola sin enviarse.`);
        return { id, status: "queued" };
      }
      const id = await insert(c, m, "queued");
      try {
        const res = await provider!.send({ channel: m.channel, recipient: m.recipient, template: m.template, body: m.body, providerTemplate: m.providerTemplate ?? null });
        await c.query("UPDATE outbound_messages SET status = 'sent', provider_message_id = $2, sent_at = now() WHERE id = $1", [id, res.providerMessageId]);
        return { id, status: "sent" };
      } catch (e) {
        await c.query("UPDATE outbound_messages SET status = 'failed', error = $2 WHERE id = $1", [id, String((e as Error).message ?? e).slice(0, 300)]);
        return { id, status: "failed" };
      }
    },
  };
}

export const MESSAGE_STATUS_LABELS: Record<MessageStatus, string> = {
  queued: "En cola (sin enviar)", simulated: "Simulado (no enviado)", sent: "Enviado", delivered: "Entregado", read: "Leído", failed: "Falló",
};
