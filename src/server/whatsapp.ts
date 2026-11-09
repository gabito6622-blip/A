// WhatsApp Cloud API (oficial de Meta): envío de mensajes, firma del webhook y lectura de eventos.
// Docs de referencia: developers.facebook.com/docs/whatsapp/cloud-api
import { createHmac, timingSafeEqual } from "node:crypto";

export class WaError extends Error {
  constructor(message: string, public status: number, public code: number | undefined, public retryable: boolean) {
    super(message);
    this.name = "WaError";
  }
}

export interface CloudConfig {
  phoneNumberId: string;
  apiVersion: string;
  accessToken: string;
}

type Fetch = typeof fetch;

export class WhatsAppCloud {
  constructor(private cfg: CloudConfig, private fetchImpl: Fetch = fetch, private base = "https://graph.facebook.com") {}

  /** Texto libre: solo si el cliente escribió en las últimas 24 h. */
  sendText(to: string, body: string) {
    return this.post({ messaging_product: "whatsapp", recipient_type: "individual", to: digits(to), type: "text", text: { preview_url: true, body: body.slice(0, 4096) } });
  }

  /** Plantilla aprobada por Meta (para avisos fuera de la ventana de 24 h). */
  sendTemplate(to: string, name: string, lang: string, bodyParams: string[], opts: { copyCodeButton?: string } = {}) {
    const components: unknown[] = [];
    if (bodyParams.length) components.push({ type: "body", parameters: bodyParams.map((t) => ({ type: "text", text: t })) });
    // Plantillas de autenticación con botón "Copiar código": el código va también en el botón.
    if (opts.copyCodeButton) components.push({ type: "button", sub_type: "url", index: "0", parameters: [{ type: "text", text: opts.copyCodeButton }] });
    return this.post({ messaging_product: "whatsapp", to: digits(to), type: "template", template: { name, language: { code: lang }, components } });
  }

  /** Imagen por link público (p. ej. el QR de cobro). */
  sendImage(to: string, link: string, caption?: string) {
    return this.post({ messaging_product: "whatsapp", to: digits(to), type: "image", image: { link, caption } });
  }

  /** Marca como leído el mensaje del cliente (los tildes azules). */
  markRead(waId: string) {
    return this.post({ messaging_product: "whatsapp", status: "read", message_id: waId }).catch(() => undefined);
  }

  private async post(payload: unknown): Promise<{ waId?: string }> {
    const url = `${this.base}/${this.cfg.apiVersion}/${this.cfg.phoneNumberId}/messages`;
    let r: Response;
    try {
      r = await this.fetchImpl(url, {
        method: "POST",
        headers: { Authorization: `Bearer ${this.cfg.accessToken}`, "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(15_000),
      });
    } catch (e) {
      throw new WaError(`Sin conexión con Meta: ${(e as Error).message}`, 0, undefined, true);
    }
    const j = (await r.json().catch(() => ({}))) as { error?: { message?: string; code?: number; error_data?: { details?: string } }; messages?: { id: string }[] };
    if (!r.ok) {
      const msg = j.error?.error_data?.details || j.error?.message || `HTTP ${r.status}`;
      throw new WaError(explain(j.error?.code, msg), r.status, j.error?.code, r.status >= 500 || r.status === 429);
    }
    return { waId: j.messages?.[0]?.id };
  }
}

const digits = (p: string) => String(p).replace(/\D/g, "");

/** Mensajes de error de Meta más comunes, en criollo. */
function explain(code: number | undefined, msg: string): string {
  const known: Record<number, string> = {
    190: "El token de acceso venció o es inválido. Generá uno permanente (usuario del sistema) y cargalo de nuevo.",
    131047: "Pasaron más de 24 h desde el último mensaje del cliente: hace falta una plantilla aprobada.",
    132001: "La plantilla no existe o no está aprobada en ese idioma.",
    131026: "No se pudo entregar: el número no tiene WhatsApp o no aceptó los términos.",
    131030: "Ese número no está en la lista de prueba de tu app (agregalo en Meta o pasá la app a producción).",
    100: "Algún dato del envío es inválido (revisá el Phone number ID).",
    10: "La app no tiene permiso para este número (revisá los permisos del token).",
  };
  return code && known[code] ? `${known[code]} (Meta: ${msg})` : `Meta: ${msg}`;
}

/** Verifica la firma X-Hub-Signature-256 que Meta pone en cada webhook (HMAC-SHA256 con el App Secret). */
export function verifySignature(raw: Buffer, header: string | undefined, appSecret: string): boolean {
  if (!header?.startsWith("sha256=") || !appSecret) return false;
  const expected = Buffer.from(createHmac("sha256", appSecret).update(raw).digest("hex"), "utf8");
  const got = Buffer.from(header.slice(7), "utf8");
  return expected.length === got.length && timingSafeEqual(expected, got);
}

export interface InboundMessage {
  from: string;
  waId: string;
  name?: string;
  text: string;
  type: string;
  timestamp: number;
  phoneNumberId?: string;
}
export interface StatusUpdate {
  waId: string;
  status: "sent" | "delivered" | "read" | "failed";
  error?: string;
}

/** Saca mensajes y estados del cuerpo del webhook. Ignora lo que no entiende. */
export function parseWebhook(body: any): { messages: InboundMessage[]; statuses: StatusUpdate[] } {
  const messages: InboundMessage[] = [];
  const statuses: StatusUpdate[] = [];
  if (body?.object !== "whatsapp_business_account") return { messages, statuses };
  for (const entry of body.entry ?? []) {
    for (const ch of entry.changes ?? []) {
      if (ch.field !== "messages") continue;
      const v = ch.value ?? {};
      const names = new Map<string, string>((v.contacts ?? []).map((c: any) => [String(c.wa_id), String(c.profile?.name ?? "")]));
      for (const m of v.messages ?? []) {
        const text =
          m.type === "text" ? m.text?.body
          : m.type === "button" ? m.button?.text
          : m.type === "interactive" ? m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title
          : `[${{ image: "imagen", audio: "audio", video: "video", document: "documento", sticker: "sticker", location: "ubicación", contacts: "contacto", reaction: "reacción" }[m.type as string] ?? m.type}]`;
        messages.push({ from: String(m.from), waId: String(m.id), name: names.get(String(m.from)) || undefined, text: String(text ?? ""), type: String(m.type), timestamp: Number(m.timestamp) * 1000, phoneNumberId: v.metadata?.phone_number_id });
      }
      for (const st of v.statuses ?? []) {
        if (["sent", "delivered", "read", "failed"].includes(st.status)) statuses.push({ waId: String(st.id), status: st.status, error: st.errors?.[0]?.title ?? st.errors?.[0]?.message });
      }
    }
  }
  return { messages, statuses };
}
