// Horario de atención de la tienda (revisión «en el lugar de ~30 clientes», 14/11/2026). Sin imports: lo usan
// hablar.js (botón «💬 Hablar con una persona») y despues-pago.js («antes de las HH:MM»), y se prueba en Node.
//
// De dónde sale el horario, en este orden:
//   1. el horario de atención de personas del bot de WhatsApp (Panel → WhatsApp → «Avisar fuera de horario»);
//   2. el texto de la franja de arriba («Atención 8:00 a 22:00»), si se entiende;
//   3. en la tienda, de 8 a 22 h (lo que ya decía «Lo revisamos en 10–30 minutos»). En la página de un revendedor
//      sin horario escrito no se inventa ninguno.

export const TZ = "America/La_Paz";
/** Minutos que tardamos en revisar un comprobante dentro del horario. */
export const REVIEW_MIN = 30;

/** El horario { from, to } en horas enteras (to puede ser 24), o null si no hay. */
export function hoursOf(settings, isStore = true) {
  const ok = (h) => h && Number.isInteger(h.from) && Number.isInteger(h.to) && h.from >= 0 && h.to <= 24 && h.from < h.to;
  if (ok(settings?.attendHours)) return { from: settings.attendHours.from, to: settings.attendHours.to };
  const m = String(settings?.storeHours ?? "").match(/(\d{1,2})(?:[:.](\d{2}))?\s*(?:h|hs|hrs)?\.?\s*(?:a|al|-|–|hasta)\s*(?:las\s*)?(\d{1,2})(?:[:.](\d{2}))?/i);
  if (m) { const h = { from: +m[1], to: +m[3] }; if (ok(h)) return h; }
  return isStore ? { from: 8, to: 22 } : null;
}

/** Minutos desde la medianoche en Bolivia para el instante `t`. */
export function localMinutes(t, tz = TZ) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(t)).map((x) => [x.type, x.value]));
  return (+p.hour % 24) * 60 + +p.minute;
}
/** «14:05» en Bolivia. */
export function hhmm(t, tz = TZ) {
  return new Intl.DateTimeFormat("es-BO", { timeZone: tz, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));
}
/** «8:00» o «8:30». */
export const hourText = (h) => `${Math.floor(h)}:${String(Math.round((h % 1) * 60)).padStart(2, "0")}`;

/** ¿Está atendiendo una persona ahora? Sin horario, siempre que sí. */
export function isOpen(h, t = Date.now()) {
  if (!h) return true;
  const m = localMinutes(t);
  return m >= h.from * 60 && m < h.to * 60;
}

/** Cuándo vuelve a abrir (milisegundos) si ahora está cerrado; `t` si está abierto. */
export function nextOpen(h, t = Date.now()) {
  if (isOpen(h, t)) return t;
  const m = localMinutes(t), open = h.from * 60;
  const wait = m < open ? open - m : 24 * 60 - m + open;
  return t + wait * 60_000 - (t % 60_000);
}

/** «Te respondemos desde las 8:00» (o «mañana desde las 8:00»), o "" si ahora atendemos. */
export function closedText(h, t = Date.now()) {
  if (!h || isOpen(h, t)) return "";
  return `Te respondemos ${localMinutes(t) >= h.to * 60 ? "mañana " : ""}desde las ${hourText(h.from)}`;
}
/** «de 8 a 22 h». */
export const rangeText = (h) => (h ? `de ${h.from} a ${h.to} h` : "");

/**
 * Hasta cuándo debería estar revisado un comprobante subido a las `sentAt`: 30 minutos de horario de atención
 * desde que lo subió (no desde que el cliente mira la pantalla). Si lo subió fuera de horario, cuenta desde que abrimos.
 */
export function reviewDeadline(sentAt, h) {
  if (!sentAt) return null;
  return nextOpen(h, sentAt) + REVIEW_MIN * 60_000;
}

/** Día en Bolivia («2026-11-14»), para saber si algo es hoy o mañana. */
export function dayKey(t, tz = TZ) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(t));
}
