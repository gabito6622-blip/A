// Adaptador de WhatsApp Business Cloud API (Meta) y verificación del webhook.
//
// SEGURIDAD: este adaptador solo se crea cuando NODE_ENV=production Y existen WHATSAPP_TOKEN y
// WHATSAPP_PHONE_ID. En desarrollo y pruebas no existe proveedor: todo queda «simulado» en la
// bandeja (lib/messaging.ts) y nunca sale un mensaje real.
import { createHmac, timingSafeEqual } from "node:crypto";
import type { MessageProvider, ProviderTemplate } from "../../lib/messaging.js";

export const GRAPH_BASE = "https://graph.facebook.com";
export const GRAPH_VERSION = "v21.0";

/** Error transitorio: el despachador lo reintenta con espera creciente. */
const retryable = (msg: string) => Object.assign(new Error(msg), { retryable: true });

type FetchFn = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;

export interface WhatsAppOptions {
  token: string;
  phoneId: string;
  apiVersion?: string;
  baseUrl?: string;
  /** Inyectable para pruebas (fetch simulado, sin red). */
  fetch?: FetchFn;
  timeoutMs?: number;
}

/** Número de destino en el formato que pide Meta: solo dígitos con código de país (Bolivia 591 por defecto). */
export function toWhatsAppNumber(raw: string): string {
  const d = raw.replace(/\D/g, "");
  if (/^[67]\d{7}$/.test(d)) return `591${d}`;
  return d;
}

export class WhatsAppCloudProvider implements MessageProvider {
  readonly name = "whatsapp_cloud";
  private readonly fetchFn: FetchFn;
  constructor(private readonly opts: WhatsAppOptions) {
    if (!opts.token || !opts.phoneId) throw new Error("WhatsApp Cloud API: faltan WHATSAPP_TOKEN o WHATSAPP_PHONE_ID");
    this.fetchFn = opts.fetch ?? (globalThis.fetch as unknown as FetchFn);
  }

  /** Cuerpo de la petición: plantilla aprobada (mensajes iniciados por la clínica) o texto (solo dentro de la ventana de 24 h). */
  buildPayload(m: { recipient: string; body: string; providerTemplate?: ProviderTemplate | null }) {
    const to = toWhatsAppNumber(m.recipient);
    if (m.providerTemplate) {
      const t = m.providerTemplate;
      return {
        messaging_product: "whatsapp", recipient_type: "individual", to, type: "template",
        template: {
          name: t.name, language: { code: t.language },
          ...(t.params.length ? { components: [{ type: "body", parameters: t.params.map((text) => ({ type: "text", text })) }] } : {}),
        },
      };
    }
    return { messaging_product: "whatsapp", recipient_type: "individual", to, type: "text", text: { preview_url: false, body: m.body } };
  }

  async send(m: { channel: string; recipient: string; template: string; body: string; providerTemplate?: ProviderTemplate | null }) {
    if (m.channel !== "whatsapp") throw new Error(`Canal ${m.channel} no disponible en WhatsApp Cloud API`);
    const url = `${this.opts.baseUrl ?? GRAPH_BASE}/${this.opts.apiVersion ?? GRAPH_VERSION}/${encodeURIComponent(this.opts.phoneId)}/messages`;
    let res: Awaited<ReturnType<FetchFn>>;
    try {
      res = await this.fetchFn(url, {
        method: "POST",
        headers: { authorization: `Bearer ${this.opts.token}`, "content-type": "application/json" },
        body: JSON.stringify(this.buildPayload(m)),
        signal: AbortSignal.timeout(this.opts.timeoutMs ?? 10_000),
      });
    } catch (e) {
      // Sin respuesta (red caída o tiempo agotado): se reintenta más tarde (B-070).
      throw retryable(`No se pudo conectar con WhatsApp: ${(e as Error).message ?? e}`.slice(0, 300));
    }
    const data = await res.json().catch(() => null);
    if (!res.ok) {
      const err = data?.error;
      const msg = `WhatsApp rechazó el mensaje (${res.status}${err?.code ? `, código ${err.code}` : ""}): ${err?.message ?? "sin detalle"}`.slice(0, 300);
      // Límite de envíos (429) o falla del lado de Meta (5xx): transitorio. El resto (número inválido, plantilla) no.
      throw res.status === 429 || res.status >= 500 ? retryable(msg) : new Error(msg);
    }
    const id = data?.messages?.[0]?.id;
    if (!id) throw new Error("WhatsApp no devolvió el identificador del mensaje");
    return { providerMessageId: String(id) };
  }
}

/** Proveedor real solo en producción y con credenciales; en cualquier otro caso null (simulador). */
export function whatsappProviderFromEnv(env: NodeJS.ProcessEnv = process.env, fetchFn?: FetchFn): WhatsAppCloudProvider | null {
  if (env.NODE_ENV !== "production") return null;
  if (!env.WHATSAPP_TOKEN || !env.WHATSAPP_PHONE_ID) return null;
  return new WhatsAppCloudProvider({ token: env.WHATSAPP_TOKEN, phoneId: env.WHATSAPP_PHONE_ID, apiVersion: env.WHATSAPP_API_VERSION, fetch: fetchFn });
}

/** Verifica X-Hub-Signature-256 ("sha256=<hex>") = HMAC-SHA256 del cuerpo crudo con WHATSAPP_APP_SECRET. */
export function verifyWebhookSignature(raw: Buffer, header: string | string[] | undefined, secret: string): boolean {
  if (!secret || typeof header !== "string") return false;
  const m = /^sha256=([0-9a-f]{64})$/i.exec(header.trim());
  if (!m) return false;
  const expected = createHmac("sha256", secret).update(raw).digest();
  const given = Buffer.from(m[1]!, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}

export function signWebhookBody(raw: Buffer | string, secret: string): string {
  return `sha256=${createHmac("sha256", secret).update(raw).digest("hex")}`;
}

// ---------------- Lectura del webhook ----------------
export interface WebhookStatus { providerMessageId: string; status: "sent" | "delivered" | "read" | "failed"; error: string | null; at: Date | null }
export interface WebhookInbound { providerMessageId: string; from: string; text: string }

/** Extrae estados de entrega y mensajes entrantes del formato de Meta (ignora lo que no entiende). */
export function parseWebhook(payload: any): { statuses: WebhookStatus[]; inbound: WebhookInbound[] } {
  const statuses: WebhookStatus[] = [];
  const inbound: WebhookInbound[] = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const ch of Array.isArray(entry?.changes) ? entry.changes : []) {
      const v = ch?.value ?? {};
      for (const s of Array.isArray(v.statuses) ? v.statuses : []) {
        if (typeof s?.id !== "string" || !["sent", "delivered", "read", "failed"].includes(s.status)) continue;
        const e = Array.isArray(s.errors) ? s.errors[0] : null;
        statuses.push({
          providerMessageId: s.id, status: s.status,
          error: e ? String(e.title ?? e.message ?? e.code ?? "Error del proveedor").slice(0, 300) : null,
          at: s.timestamp ? new Date(Number(s.timestamp) * 1000) : null,
        });
      }
      for (const m of Array.isArray(v.messages) ? v.messages : []) {
        if (typeof m?.from !== "string" || typeof m?.id !== "string") continue;
        const text = m.type === "text" ? m.text?.body : m.type === "button" ? (m.button?.text ?? m.button?.payload) : m.type === "interactive" ? (m.interactive?.button_reply?.title ?? m.interactive?.list_reply?.title) : null;
        inbound.push({ providerMessageId: m.id, from: m.from, text: String(text ?? `[${m.type ?? "mensaje"}]`).slice(0, 1000) });
      }
    }
  }
  return { statuses, inbound };
}

/** ¿El paciente pidió la baja? («BAJA», «STOP», «Baja por favor»…) */
export function isOptOut(text: string): boolean {
  const t = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").trim().toUpperCase();
  return /^(BAJA|STOP|DARME DE BAJA|NO MAS MENSAJES|CANCELAR SUSCRIPCION)\b/.test(t);
}
