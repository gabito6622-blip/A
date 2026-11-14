// Horario de atención para el cliente (pantalla de fallas): «Atendemos de 08:00 a 22:00. Ahora estamos cerrados: te
// respondemos desde las 08:00». Usa el horario que el dueño puso para el bot de WhatsApp («Avisar fuera de horario»);
// si no puso ninguno, el de 8 a 22 que la tienda ya muestra al pagar con QR (shop.js) y en sus preguntas frecuentes.
import type { Engine } from "./engine.js";
import { botSettings } from "./chats.js";

export const DEFAULT_HOURS = { from: 8, to: 22 } as const;
const TZ = "America/La_Paz";
const hm = (h: number) => `${String(h % 24).padStart(2, "0")}:00`;

export function attentionHours(e: Engine, now: number = e.now()) {
  const h = botSettings(e).humanHours ?? DEFAULT_HOURS;
  const p = new Intl.DateTimeFormat("en-US", { timeZone: TZ, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(new Date(now));
  const hour = Number(p.find((x) => x.type === "hour")?.value ?? 0);
  const open = hour >= h.from && hour < h.to;
  // Cerrado: abre hoy más tarde (de madrugada) o mañana (de noche).
  const when = open ? null : hour < h.from ? "today" : "tomorrow";
  return { from: hm(h.from), to: hm(h.to), open, ...(when ? { opensAt: hm(h.from), opensWhen: when } : {}) };
}
