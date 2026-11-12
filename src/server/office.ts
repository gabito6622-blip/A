// 🏢 Mi oficina: la pantalla animada de los asistentes. No hace trabajo nuevo: muestra lo que los
// asistentes YA hacen, con datos reales.
//
// - 4 asistentes con Claude: revisor de comprobantes, atención por WhatsApp, asistente del dueño y vigilante.
// - 2 ayudantes sin IA (gratis): el lector de códigos y el cartero de los avisos de vencimiento.
//
// De dónde sale cada cosa:
// - Comprobantes y WhatsApp no dejaban rastro con fecha, así que anotan acá lo que hacen (`office_feed`,
//   junto a los secretos: no va en el estado, ni en las exportaciones, ni en los respaldos descargables).
//   Se guardan como mucho 80 anotaciones de los últimos 7 días.
// - Vigilante, códigos, reporte del día y cartero se leen de lo que ya se guarda.
//
// Los textos nunca llevan contraseñas, correos de cuentas, códigos ni montos de costo: solo el primer
// nombre del cliente, la plataforma y qué pasó.
import type { GabrielStore } from "../store/index.js";
import type { Db } from "./db.js";
import { ALERT_TEXT } from "../store/watch.js";

export const OFFICE_AGENTS = ["receipts", "whatsapp", "daily", "watch", "codes", "cartero"] as const;
export type OfficeAgentId = (typeof OFFICE_AGENTS)[number];
export type Tone = "ok" | "warn" | "bad" | "info";
export interface OfficeEvent { a: OfficeAgentId; at: number; text: string; tone: Tone }

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { actor?: any };
type Route = (method: string, path: string, who: Who, handler: (c: Ctx) => unknown) => void;

export interface OfficeDeps {
  route: Route;
  store: GabrielStore;
  db: Db;
  now: () => number;
  hasKey: () => boolean;
  aiOn: (k: "receipts" | "whatsapp" | "daily" | "watch") => boolean;
  aiMonth: () => { spentUsd: number; monthlyLimitUsd: number; calls: number; model: string; modelLabel: string };
  aiDaily: () => { at: number; day: string } | null;
  pushOn: () => boolean;
  mailOn: () => boolean;
  expiryStats: () => { day: string; sent: number; lastAt?: number };
  forbidden: (msg: string) => never;
}

const KEY = "office_feed", MAX = 80, KEEP_MS = 7 * 86_400_000;
const laDay = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz" }).format(new Date(t));
const laHour = (t: number) => Number(new Intl.DateTimeFormat("en-GB", { timeZone: "America/La_Paz", hour: "2-digit", hourCycle: "h23" }).format(new Date(t)));
/** Solo el primer nombre, cortito y sin caracteres raros. */
export const firstName = (name: string | undefined) => (String(name ?? "").trim().split(/\s+/)[0] || "un cliente").replace(/[<>]/g, "").slice(0, 20);

export function createOffice(d: OfficeDeps) {
  const { db, store, now } = d;
  const e = store.engine;
  const read = (): OfficeEvent[] => { try { const l = JSON.parse(db.getSecret(KEY) ?? "[]"); return Array.isArray(l) ? l : []; } catch { return []; } };

  /** Anota algo que hizo un asistente (los que no dejaban rastro propio). */
  function note(a: OfficeAgentId, text: string, tone: Tone = "info"): void {
    const t = now();
    const list = read().filter((x) => t - x.at < KEEP_MS);
    list.push({ a, at: t, text: text.slice(0, 140), tone });
    db.setSecret(KEY, JSON.stringify(list.slice(-MAX)), t);
  }

  /** Lo que ya está guardado en otros lados, como eventos de la oficina (últimos 7 días). */
  function derived(): OfficeEvent[] {
    const t = now(), out: OfficeEvent[] = [];
    for (const al of e.s.accountAlerts ?? []) {
      if (t - al.at > KEEP_MS) continue;
      const acc = e.s.accounts[al.accountId];
      const prod = acc ? e.s.products[acc.productId]?.name ?? "Una cuenta" : "Una cuenta";
      const severe = al.kind !== "new_device" && al.kind !== "other";
      // La alarma suena solo mientras no lo viste en Notificaciones.
      out.push({ a: "watch", at: al.at, text: `${prod}: ${ALERT_TEXT[al.kind]}.${al.seen ? " (Ya lo viste.)" : " ¡Miralo!"}`, tone: al.seen ? "info" : severe ? "bad" : "warn" });
    }
    for (const c of e.s.codes ?? []) {
      if (t - c.receivedAt > KEEP_MS) continue;
      const acc = Object.values(e.s.accounts).find((x) => x.email.toLowerCase() === c.to);
      const prod = acc ? e.s.products[acc.productId]?.name ?? "" : "";
      out.push({ a: "codes", at: c.receivedAt, text: prod ? `Llegó un código de ${prod}. Ya está en el Panel de códigos.` : "Llegó un código nuevo. Ya está en el Panel de códigos.", tone: "ok" });
    }
    const daily = d.aiDaily();
    if (daily && t - daily.at < KEEP_MS) out.push({ a: "daily", at: daily.at, text: "Te armé el reporte del día 📋. Está en Inicio.", tone: "ok" });
    const ex = d.expiryStats();
    // La hora del evento es la del último aviso real (no "ahora"): si fuera "ahora", la oficina vería un evento
    // nuevo cada 20 s, Tito saltaría todo el día y se redibujaría toda la pantalla. Sin hora guardada (avisos de
    // antes de este cambio), se usa una fija del día: las 9 de Bolivia, cuando reparte.
    if (ex.day === laDay(t) && ex.sent > 0) out.push({ a: "cartero", at: ex.lastAt ?? Date.parse(`${ex.day}T09:00:00-04:00`), text: `Hoy mandé ${ex.sent} aviso${ex.sent === 1 ? "" : "s"} de vencimiento al celular de tus clientes.`, tone: "ok" });
    return out;
  }

  function view(role: string) {
    const t = now(), today = laDay(t);
    const all = [...read(), ...derived()].filter((x) => t - x.at < KEEP_MS).sort((a, b) => b.at - a.at);
    const key = d.hasKey();
    const on: Record<OfficeAgentId, boolean> = {
      receipts: key && d.aiOn("receipts"), whatsapp: key && d.aiOn("whatsapp"), daily: key && d.aiOn("daily"), watch: true,
      // Si llegó un código en las últimas 24 h, el lector está trabajando aunque el buzón no tenga clave guardada acá.
      codes: d.mailOn() || (e.s.codes ?? []).some((c) => t - c.receivedAt < 86_400_000), cartero: d.pushOn(),
    };
    const agents = OFFICE_AGENTS.map((id) => {
      const mine = all.filter((x) => x.a === id);
      const todayN = id === "cartero" ? (d.expiryStats().day === today ? d.expiryStats().sent : 0) : mine.filter((x) => laDay(x.at) === today).length;
      return { id, on: on[id], ai: id === "receipts" || id === "whatsapp" || id === "daily" || id === "watch", aiOn: id === "watch" ? key && d.aiOn("watch") : undefined, today: todayN, last: mine[0] ?? null, recent: mine.slice(0, 8) };
    });
    const m = d.aiMonth();
    return {
      now: t, hour: laHour(t), day: today, hasKey: key, agents,
      feed: all.slice(0, 30),
      // La plata de Claude: solo el dueño.
      ai: role === "owner" ? { spentUsd: m.spentUsd, limitUsd: m.monthlyLimitUsd, calls: m.calls, model: m.modelLabel } : null,
    };
  }

  d.route("GET", "/api/admin/office", "staff", (c) => {
    const role = c.actor?.role;
    if (role !== "owner" && role !== "admin") d.forbidden("La oficina la ven el dueño y los admin");
    return view(role);
  });

  return { note, view };
}
