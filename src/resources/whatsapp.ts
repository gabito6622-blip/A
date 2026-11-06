import { Http, MemoryTokenStore, type HttpOptions } from "../http.js";
import type { Body, Id, Query } from "../types.js";

/**
 * Configuración del gateway de WhatsApp. Proviene del plugin `self.ws` de la
 * cuenta (`GET /account-plugins?name=self.ws&status=ACTIVE` → `data[0]`), que
 * expone `{ url, referenceId, token }`. Confirmado por decompilación del front:
 *
 *   $i(t) = axios.create({ baseURL: t.url,
 *                          headers: { "Content-Type": "application/json",
 *                                     "x-api-key": t.token } })
 */
export interface WhatsAppPlugin {
  /** Base URL del gateway (axios baseURL). */
  url: string;
  /** Identificador de sesión del vendedor; se pasa como `session` en cada llamada. */
  referenceId: string;
  /** Clave del gateway, enviada en el header `x-api-key`. */
  token: string;
  [k: string]: unknown;
}

/**
 * Cliente del gateway de mensajería (WhatsApp). Base URL y auth son propios del
 * plugin, distintos de la API principal del CRM.
 */
export class WhatsAppClient {
  readonly http: Http;
  readonly referenceId: string;

  constructor(plugin: WhatsAppPlugin, opts: Omit<HttpOptions, "baseUrl" | "tokens" | "defaultHeaders"> = {}) {
    this.referenceId = plugin.referenceId;
    this.http = new Http({
      ...opts,
      baseUrl: plugin.url,
      tokens: new MemoryTokenStore(), // sin Bearer; el gateway usa x-api-key
      defaultHeaders: { "x-api-key": plugin.token },
    });
  }

  /** Estado / ciclo de vida de la sesión de WhatsApp. */
  sessions = {
    status: <T = unknown>() => this.http.get<T>(`/sessions/${this.referenceId}`),
    start: <T = unknown>(b?: Body) => this.http.post<T>(`/sessions/${this.referenceId}/start`, b),
    restart: <T = unknown>(b?: Body) => this.http.post<T>(`/sessions/${this.referenceId}/restart`, b),
    logout: <T = unknown>(b?: Body) => this.http.post<T>(`/sessions/${this.referenceId}/logout`, b),
    /** QR de vinculación del dispositivo. */
    qr: <T = unknown>() => this.http.get<T>(`/${this.referenceId}/auth/qr`),
  };

  /** Chats y mensajes. */
  chats = {
    overview: <T = unknown>(q?: Query) => this.http.get<T>(`/${this.referenceId}/chats/overview`, q),
    messages: <T = unknown>(chatId: Id, q?: Query) =>
      this.http.get<T>(`/${this.referenceId}/chats/${chatId}/messages`, q),
    message: <T = unknown>(chatId: Id, messageId: Id) =>
      this.http.get<T>(`/${this.referenceId}/chats/${chatId}/messages/${messageId}`),
    markRead: <T = unknown>(chatId: Id, b?: Body) =>
      this.http.post<T>(`/${this.referenceId}/chats/${chatId}/messages/read`, b),
  };

  /** Resolución de LIDs (linked ids) de contactos. */
  lids = {
    byId: <T = unknown>(id: Id) => this.http.get<T>(`/${this.referenceId}/lids/${id}`),
    byPhone: <T = unknown>(phone: string) =>
      this.http.get<T>(`/${this.referenceId}/lids/pn/${phone.replace(/\D/g, "")}`),
  };

  /** Contactos (observados en el gateway, con `session` en query). */
  contacts = {
    all: <T = unknown>(params?: Query) =>
      this.http.get<T>("/contacts/all", { session: this.referenceId, ...(params ?? {}) }),
    profilePicture: <T = unknown>(contactId: Id) =>
      this.http.get<T>("/contacts/profile-picture", { session: this.referenceId, contactId }),
  };

  // ---- Envío de mensajes ----
  // Payload de sendText confirmado: { session, chatId, text }.

  sendText<T = unknown>(chatId: Id, text: string) {
    return this.http.post<T>("/sendText", { session: this.referenceId, chatId, text });
  }
  /** Para media, el cuerpo exacto no está verificado; `extra` se mezcla al payload. */
  sendImage<T = unknown>(chatId: Id, extra: Body = {}) {
    return this.http.post<T>("/sendImage", { session: this.referenceId, chatId, ...extra });
  }
  sendVideo<T = unknown>(chatId: Id, extra: Body = {}) {
    return this.http.post<T>("/sendVideo", { session: this.referenceId, chatId, ...extra });
  }
  sendVoice<T = unknown>(chatId: Id, extra: Body = {}) {
    return this.http.post<T>("/sendVoice", { session: this.referenceId, chatId, ...extra });
  }
  sendFile<T = unknown>(chatId: Id, extra: Body = {}) {
    return this.http.post<T>("/sendFile", { session: this.referenceId, chatId, ...extra });
  }
  startTyping<T = unknown>(chatId: Id) {
    return this.http.post<T>("/startTyping", { session: this.referenceId, chatId });
  }
  stopTyping<T = unknown>(chatId: Id) {
    return this.http.post<T>("/stopTyping", { session: this.referenceId, chatId });
  }
}
