import type { Http } from "../http.js";
import type { Body, Id, Query } from "../types.js";

/**
 * Gateway de mensajería tipo WhatsApp. Las rutas van bajo la misma baseURL y
 * están indexadas por `referenceId` (identificador de sesión del vendedor).
 * Observado estáticamente en el front.
 */
export function whatsappResources(http: Http) {
  return {
    /** Operaciones de sesión de WhatsApp. */
    sessions: {
      status: <T = unknown>(referenceId: Id) => http.get<T>(`/sessions/${referenceId}`),
      start: <T = unknown>(referenceId: Id, b?: Body) => http.post<T>(`/sessions/${referenceId}/start`, b),
      restart: <T = unknown>(referenceId: Id, b?: Body) => http.post<T>(`/sessions/${referenceId}/restart`, b),
      logout: <T = unknown>(referenceId: Id, b?: Body) => http.post<T>(`/sessions/${referenceId}/logout`, b),
      /** QR de vinculación del dispositivo. */
      qr: <T = unknown>(referenceId: Id) => http.get<T>(`/${referenceId}/auth/qr`),
    },

    /** Chats y mensajes. */
    chats: {
      overview: <T = unknown>(referenceId: Id, q?: Query) =>
        http.get<T>(`/${referenceId}/chats/overview`, q),
      messages: <T = unknown>(referenceId: Id, chatId: Id, q?: Query) =>
        http.get<T>(`/${referenceId}/chats/${chatId}/messages`, q),
      message: <T = unknown>(referenceId: Id, chatId: Id, messageId: Id) =>
        http.get<T>(`/${referenceId}/chats/${chatId}/messages/${messageId}`),
      markRead: <T = unknown>(referenceId: Id, chatId: Id, b?: Body) =>
        http.post<T>(`/${referenceId}/chats/${chatId}/messages/read`, b),
    },

    /** Resolución de LIDs (linked ids) de contactos. */
    lids: {
      byId: <T = unknown>(referenceId: Id, id: Id) => http.get<T>(`/${referenceId}/lids/${id}`),
      byPhone: <T = unknown>(referenceId: Id, phone: string) =>
        http.get<T>(`/${referenceId}/lids/pn/${phone.replace(/\D/g, "")}`),
    },

    /** Envío de mensajes (cuerpo exacto no verificado). */
    sendText: <T = unknown>(b: Body) => http.post<T>("/sendText", b),
    sendImage: <T = unknown>(b: Body | FormData) => http.post<T>("/sendImage", b),
    sendVideo: <T = unknown>(b: Body | FormData) => http.post<T>("/sendVideo", b),
    sendVoice: <T = unknown>(b: Body | FormData) => http.post<T>("/sendVoice", b),
    sendFile: <T = unknown>(b: Body | FormData) => http.post<T>("/sendFile", b),
    startTyping: <T = unknown>(b: Body) => http.post<T>("/startTyping", b),
    stopTyping: <T = unknown>(b: Body) => http.post<T>("/stopTyping", b),
  };
}
