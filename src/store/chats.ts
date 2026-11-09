// Conversaciones de WhatsApp: mensajes entrantes y salientes por número, ventana de 24 h
// y derivación a una persona. Las usa el bot y la bandeja del panel.
import type { Actor, ChatMessage, ChatThread, Id, WhatsAppBotSettings, BotQuickReply } from "./types.js";
import type { Engine } from "./engine.js";
import { HOUR } from "./time.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

const MAX_MESSAGES_PER_THREAD = 300;
/** Meta manda "59170011223"; los clientes se guardan como "+59170011223". */
export const e164 = (p: string) => "+" + String(p ?? "").replace(/\D/g, "");
export const WINDOW_MS = 24 * HOUR;

function thread(e: Engine, phone: string): ChatThread {
  const p = e164(phone);
  let t = e.s.chats[p];
  if (!t) {
    t = { phone: p, needsHuman: false, unread: 0, messages: [] };
    e.s.chats[p] = t;
  }
  if (!t.customerId) t.customerId = Object.values(e.s.customers).find((c) => c.phone === p)?.id;
  return t;
}

function push(e: Engine, t: ChatThread, m: Omit<ChatMessage, "id">): ChatMessage {
  const msg: ChatMessage = { id: e.id("chm"), ...m };
  t.messages.push(msg);
  if (t.messages.length > MAX_MESSAGES_PER_THREAD) t.messages.splice(0, t.messages.length - MAX_MESSAGES_PER_THREAD);
  return msg;
}

/** ¿Se puede responder con texto libre? (el cliente escribió en las últimas 24 h) */
export const inWindow = (e: Engine, phone: string) => {
  const t = e.s.chats[e164(phone)];
  return !!t?.lastInboundAt && e.now() - t.lastInboundAt < WINDOW_MS;
};

/** Mensaje que llegó del cliente (desde el webhook de Meta). Ignora repetidos por `waId`. */
export function recordInbound(e: Engine, msg: { phone: string; text: string; waId: string; name?: string; at?: number }): { thread: ChatThread; duplicate: boolean } {
  return e.tx(() => {
    const t = thread(e, msg.phone);
    if (t.messages.some((m) => m.waId === msg.waId)) return { thread: structuredClone(t), duplicate: true };
    if (msg.name) t.name = msg.name.slice(0, 80);
    t.lastInboundAt = e.now();
    t.unread++;
    push(e, t, { direction: "in", by: "cliente", text: msg.text.slice(0, 4000), at: msg.at ?? e.now(), waId: msg.waId });
    return { thread: structuredClone(t), duplicate: false };
  });
}

export function recordOutbound(e: Engine, phone: string, m: { text: string; by: "bot" | "staff" | "sistema"; waId?: string; error?: string }): ChatMessage {
  return e.tx(() => {
    const t = thread(e, phone);
    return structuredClone(push(e, t, { direction: "out", by: m.by, text: m.text.slice(0, 4000), at: e.now(), waId: m.waId, status: m.error ? "failed" : "sent", error: m.error }));
  });
}

/** Estado de entrega que informa Meta (enviado, entregado, leído, fallido). */
export function recordStatus(e: Engine, waId: string, status: "sent" | "delivered" | "read" | "failed", error?: string): void {
  e.tx(() => {
    for (const t of Object.values(e.s.chats)) {
      const m = t.messages.find((x) => x.waId === waId);
      if (m) {
        const rank = { sent: 1, delivered: 2, read: 3, failed: 4 };
        if (rank[status] >= rank[m.status ?? "sent"]) m.status = status;
        if (error) m.error = error;
        return;
      }
    }
  });
}

/** El cliente pidió una persona: el bot se calla por unas horas y el chat queda marcado. */
export function requestHuman(e: Engine, phone: string, pauseHours: number): void {
  e.tx(() => {
    const t = thread(e, phone);
    t.needsHuman = true;
    t.botPausedUntil = e.now() + pauseHours * HOUR;
  });
}

export const botPaused = (e: Engine, phone: string) => {
  const t = e.s.chats[e164(phone)];
  return !!t?.botPausedUntil && t.botPausedUntil > e.now();
};

/* ---------------- panel ---------------- */

export function listChats(e: Engine, actor: Actor) {
  authorize(actor, "customer.manage");
  return Object.values(e.s.chats)
    .map((t) => {
      const last = t.messages.at(-1);
      return {
        phone: t.phone, name: t.name, customerId: t.customerId, customerName: t.customerId ? e.s.customers[t.customerId]?.name : undefined,
        needsHuman: t.needsHuman, botPaused: !!t.botPausedUntil && t.botPausedUntil > e.now(), unread: t.unread,
        inWindow: !!t.lastInboundAt && e.now() - t.lastInboundAt < WINDOW_MS,
        windowEndsAt: t.lastInboundAt ? t.lastInboundAt + WINDOW_MS : null,
        lastText: last?.text.slice(0, 120) ?? "", lastAt: last?.at ?? 0,
      };
    })
    .sort((a, b) => Number(b.needsHuman) - Number(a.needsHuman) || b.lastAt - a.lastAt);
}

export function getChat(e: Engine, actor: Actor, phone: string): ChatThread {
  authorize(actor, "customer.manage");
  const t = e.s.chats[e164(phone)];
  if (!t) throw new DomainError("NOT_FOUND", "No hay conversación con ese número");
  return e.tx(() => {
    t.unread = 0;
    return structuredClone(t);
  });
}

/** Una persona tomó o soltó la conversación. */
export function setHumanMode(e: Engine, actor: Actor, phone: string, on: boolean, pauseHours = 12): void {
  authorize(actor, "customer.manage");
  e.tx(() => {
    const t = thread(e, phone);
    t.needsHuman = false;
    t.botPausedUntil = on ? e.now() + pauseHours * HOUR : undefined;
    e.audit(actor, on ? "chat.take" : "chat.release", "chat", t.phone);
  });
}

/* ---------------- configuración del bot ---------------- */

const DEFAULT_BOT: WhatsAppBotSettings = { enabled: false, phoneNumberId: "", apiVersion: "v21.0", humanPauseHours: 12, templates: {} };

export const botSettings = (e: Engine): WhatsAppBotSettings => ({ ...DEFAULT_BOT, ...(e.s.settings.whatsappBot ?? {}) });

export function updateBotSettings(e: Engine, actor: Actor, patch: Partial<WhatsAppBotSettings>): WhatsAppBotSettings {
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Solo el dueño configura el bot de WhatsApp");
  if (patch.phoneNumberId !== undefined && patch.phoneNumberId !== "" && !/^\d{6,20}$/.test(patch.phoneNumberId)) throw new DomainError("VALIDATION", "Phone number ID: solo números (lo ves en Meta → WhatsApp → Configuración de la API)");
  if (patch.apiVersion !== undefined && !/^v\d{1,2}\.\d$/.test(patch.apiVersion)) throw new DomainError("VALIDATION", "Versión de API: formato v21.0");
  if (patch.humanPauseHours !== undefined && !(Number.isInteger(patch.humanPauseHours) && patch.humanPauseHours >= 1 && patch.humanPauseHours <= 72)) throw new DomainError("VALIDATION", "Pausa: entre 1 y 72 horas");
  if (patch.welcome !== undefined && (typeof patch.welcome !== "string" || patch.welcome.length > 600)) throw new DomainError("VALIDATION", "Saludo: máximo 600 letras");
  let quick: BotQuickReply[] | undefined;
  if (patch.quickReplies !== undefined) {
    if (!Array.isArray(patch.quickReplies) || patch.quickReplies.length > 30) throw new DomainError("VALIDATION", "Respuestas propias: hasta 30");
    quick = patch.quickReplies.map((q, i) => {
      const keywords = (Array.isArray(q?.keywords) ? q.keywords : []).map((k) => String(k ?? "").trim().toLowerCase()).filter(Boolean);
      const answer = String(q?.answer ?? "").trim();
      if (!keywords.length || keywords.length > 15 || keywords.some((k) => k.length > 40)) throw new DomainError("VALIDATION", `Respuesta ${i + 1}: poné de 1 a 15 palabras clave (máx. 40 letras cada una)`);
      if (!answer || answer.length > 1000) throw new DomainError("VALIDATION", `Respuesta ${i + 1}: el texto debe tener entre 1 y 1000 letras`);
      if (keywords.some((k) => /^[0-9]$/.test(k))) throw new DomainError("VALIDATION", `Respuesta ${i + 1}: los números 0 a 9 ya son opciones del menú`);
      return { keywords, answer };
    });
  }
  if (patch.humanHours !== undefined && patch.humanHours !== null) {
    const h = patch.humanHours;
    const ok = (n: unknown) => Number.isInteger(n) && (n as number) >= 0 && (n as number) <= 24;
    if (!ok(h.from) || !ok(h.to) || h.from >= h.to) throw new DomainError("VALIDATION", "Horario de atención: de 0 a 24 y el inicio antes del fin");
  }
  if (patch.templates) {
    for (const [k, v] of Object.entries(patch.templates)) {
      if (v && (!/^[a-z0-9_]{1,512}$/.test(v.name) || !/^[a-z]{2}(_[A-Z]{2})?$/.test(v.lang))) throw new DomainError("VALIDATION", `Plantilla ${k}: nombre en minúsculas con guion bajo y idioma tipo es o es_AR`);
    }
  }
  return e.tx(() => {
    const cur = botSettings(e);
    const next: WhatsAppBotSettings = { ...cur, templates: patch.templates ? { ...patch.templates } : cur.templates };
    for (const k of ["enabled", "phoneNumberId", "apiVersion", "welcome", "humanPauseHours"] as const) {
      if (patch[k] !== undefined) (next as unknown as Record<string, unknown>)[k] = patch[k];
    }
    if (quick) next.quickReplies = quick;
    if (patch.humanHours === null) delete next.humanHours;
    else if (patch.humanHours) next.humanHours = { from: patch.humanHours.from, to: patch.humanHours.to };
    if (next.enabled && !next.phoneNumberId) throw new DomainError("VALIDATION", "Para encender el bot falta el Phone number ID");
    e.s.settings.whatsappBot = next;
    e.audit(actor, "whatsapp.settings", "settings", "whatsapp", { enabled: next.enabled, templates: Object.keys(next.templates).length });
    return structuredClone(next);
  });
}

export type { Id };
