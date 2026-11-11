// "🔔 Avisarme antes de que venza": qué le toca avisar hoy a cada cliente final y con qué texto.
//
// Dos tipos de cliente final:
//  - con cuenta (tienda o cliente de un revendedor): sus servicios activos a su nombre;
//  - sin cuenta, por el link de cobro /c/<token> (Repartir perfiles o Mis cuentas propias): el perfil
//    de ese link, leído con la MISMA vista pública del link (lista cerrada), nunca con más datos.
// Se avisa 3 días antes, 1 día antes y el día que vence (días de calendario en Bolivia).
//
// Privacidad: el texto lleva solo el nombre comercial de la app ("Disney+") y la fecha dd/mm.
// Nunca contraseñas, correos de cuentas, montos, costos ni datos de otros clientes. El cliente de un
// revendedor nunca ve el precio de la tienda: el aviso dice "Renová con <revendedor>".
// Este archivo no manda nada: el envío (Web Push, con su doble en pruebas) está en src/server/expiryPush.ts.
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { commercialName, publicView } from "./subLinks.js";
import { resellerContact, type MyReseller } from "./myReseller.js";

/** Días antes del vencimiento en que se avisa (pedido del encargo: 3, 1 y el mismo día). */
export const ALERT_DAYS: readonly number[] = [3, 1, 0];
const TZ = "America/La_Paz";

/** "2026-12-15": el día de calendario en Bolivia. */
export const laDay = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(new Date(t));
/** "15/12" en hora de Bolivia. */
export const ddmm = (t: number) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, day: "2-digit", month: "2-digit" }).formatToParts(new Date(t));
  return `${p.find((x) => x.type === "day")?.value}/${p.find((x) => x.type === "month")?.value}`;
};
/** Días de calendario (Bolivia) que faltan: 0 = vence hoy, 1 = mañana, negativo = ya venció. */
export function daysUntil(expiresAt: number, now: number): number {
  const d = (t: number) => { const [y, m, dd] = laDay(t).split("-").map(Number); return Date.UTC(y, m - 1, dd); };
  return Math.round((d(expiresAt) - d(now)) / 86_400_000);
}

export interface DueItem {
  /** Identifica el servicio para no repetir el aviso (no sale del servidor). */
  key: string;
  product: string;
  expiresAt: number;
  days: number;
}

/** Servicios a nombre de un cliente final que vencen en 3, 1 o 0 días. Los revendedores tienen su propio aviso. */
export function dueForCustomer(e: Engine, customerId: Id, now: number): { items: DueItem[]; via?: MyReseller } {
  const c = e.s.customers[customerId];
  if (!c || c.kind === "reseller") return { items: [] };
  const items: DueItem[] = [];
  for (const a of Object.values(e.s.assignments)) {
    if (a.customerId !== customerId || a.status !== "active") continue;
    const days = daysUntil(a.customerExpiresAt, now);
    if (a.customerExpiresAt <= now - 86_400_000 || !ALERT_DAYS.includes(days)) continue;
    items.push({ key: `a:${a.id}`, product: commercialName(e.s.products[a.productId]?.name ?? ""), expiresAt: a.customerExpiresAt, days });
  }
  items.sort((x, y) => x.expiresAt - y.expiresAt);
  const via = resellerContact(e, customerId);
  return { items, ...(via ? { via } : {}) };
}

/** Lo que vence de un link /c/<token>, leído con la vista pública (lista cerrada). null si el link ya no sirve. */
export function dueForToken(e: Engine, token: string, now: number): { item: DueItem | null; seller: string } | null {
  let v: { product: string; expiresAt: number; seller: string };
  try { v = publicView(e, token); } catch (err) { if (err instanceof DomainError && err.code === "NOT_FOUND") return null; throw err; }
  const days = daysUntil(v.expiresAt, now);
  const item = ALERT_DAYS.includes(days) && v.expiresAt > now - 86_400_000 ? { key: `t:${token}`, product: v.product, expiresAt: v.expiresAt, days } : null;
  return { item, seller: v.seller };
}

/** true si el link /c/<token> sigue sirviendo (no revocado, ni borrado, ni pasado a otro revendedor). */
export function tokenAlive(e: Engine, token: string): boolean {
  try { publicView(e, token); return true; } catch (err) { if (err instanceof DomainError && err.code === "NOT_FOUND") return false; throw err; }
}

const when = (d: number) => (d === 0 ? "hoy" : d === 1 ? "mañana" : `en ${d} días`);

/**
 * Título y texto del aviso. Uno solo: "Tu Disney+ vence mañana (15/12)". Varios: agrupados en un aviso.
 * `via.seller`: el cliente renueva con su revendedor ("Renová con Rosa TV"), sin precio. `via.action` dice
 * qué abre el toque: su WhatsApp, su página, el link de cobro o nada.
 */
export function alertText(items: DueItem[], via?: { seller?: string; action: "write" | "page" | "pay" | "none" }): { title: string; body: string } {
  const who = via?.seller?.trim();
  const tap = { write: "Tocá para escribirle.", page: "Tocá para ver su página.", pay: "Tocá para ver cómo pagar.", none: "" }[via?.action ?? "none"];
  const tail = who ? `Renová con ${who}.${tap ? ` ${tap}` : ""}` : via?.action === "pay" ? "Tocá para ver cómo renovar." : "Tocá para renovar.";
  if (items.length === 1) {
    const it = items[0];
    return { title: `🔔 Tu ${it.product} vence ${when(it.days)} (${ddmm(it.expiresAt)})`.slice(0, 120), body: tail };
  }
  const list = items.slice(0, 3).map((it) => `${it.product} ${when(it.days)} (${ddmm(it.expiresAt)})`).join(" · ");
  return { title: `🔔 ${items.length} servicios tuyos vencen pronto`, body: `${list}${items.length > 3 ? "…" : ""}. ${tail}`.slice(0, 180) };
}

/** Texto para el WhatsApp con el que el cliente de un revendedor le pide renovar (sin precio de la tienda). */
export function renewWaText(items: DueItem[]): string {
  return `Hola, quiero renovar ${items.map((it) => `mi ${it.product} (vence el ${ddmm(it.expiresAt)})`).join(" y ")}.`;
}

/**
 * Los links de cobro del propio revendedor (Repartir perfiles y Mis cuentas propias), para marcar quién
 * tiene avisos. Solo lo suyo: nunca recorre lo de otro revendedor.
 */
export function myLinkTokens(e: Engine, actor: Actor): { subs: { id: string; token: string }[]; own: { id: string; token: string }[] } {
  authorize(actor, "reseller.own_stock");
  const me = actor.customerId ? e.s.customers[actor.customerId] : undefined;
  if (!me || me.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const subs: { id: string; token: string }[] = [];
  for (const a of Object.values(e.s.assignments)) {
    if (a.customerId !== me.id || a.status !== "active") continue;
    for (const s of a.subs ?? []) if (s.link && s.link.by === me.id) subs.push({ id: `${a.id}|${s.id}`, token: s.link.token });
  }
  const own = (e.s.ownStock?.[me.id]?.sales ?? []).filter((s) => s.link).map((s) => ({ id: s.id, token: s.link!.token }));
  return { subs, own };
}
