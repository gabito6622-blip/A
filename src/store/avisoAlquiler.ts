// Aviso al revendedor ANTES del corte de SUS alquileres con la tienda (revisión de 3 meses, 14/11/2026).
//
// Antes el corte automático (`closeExpired`: vencimiento + 2 días de gracia) le cortaba a un revendedor su Disney de la
// tienda sin que nadie le avisara: sus clientes se quedaban sin servicio. Ahora:
//  - en GaboHub, un cartel «Tu Disney de la tienda vence el dd/mm y se corta el dd/mm» desde 3 días antes, con el botón
//    para renovar (con saldo o QR);
//  - un aviso al celular (push) 3 días antes y el día del vencimiento (lo manda el servidor una vez por día).
//  - si ya mandó el comprobante de la renovación y está por revisarse, NO se corta (`paidInReview`): no se corta algo pagado.
// Solo lee: no cambia nada ni le escribe a nadie por WhatsApp.
import type { Actor, Assignment, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart, boParts } from "./time.js";
import { renewPriceFor } from "./catalog.js";
import { canRenewHere } from "./renovarVarias.js";
import { renewableNow } from "./orders.js";
import { cutAtOf } from "./dia.js";

/** Desde cuántos días antes del vencimiento aparece el cartel (y el primer aviso al celular). */
export const ALERT_DAYS = 3;
/** Un comprobante por revisar frena el corte, pero no para siempre: a lo sumo estos días desde que lo mandó. */
export const REVIEW_HOLD_DAYS = 5;

/** dd/mm de Bolivia (siempre con dos cifras). */
const fdm = (t: number) => { const p = boParts(t); return `${String(p.d).padStart(2, "0")}/${String(p.m + 1).padStart(2, "0")}`; };
const short = (n: string) => n.replace(/\s*\(alquiler revendedores\)\s*$/i, "");

/** ¿Este servicio tiene una renovación con comprobante por revisar (mandado hace poco)? Entonces no se corta todavía. */
export function paidInReview(e: Engine, a: Pick<Assignment, "id">): boolean {
  const now = e.now();
  return Object.values(e.s.orders).some((o) => o.kind === "renewal" && o.renewal?.assignmentId === a.id && o.status === "payment_review"
    && !!o.evidence && now - o.evidence.submittedAt < REVIEW_HOLD_DAYS * DAY);
}

/** Días que faltan para el vencimiento, contados por día de Bolivia (0 = vence hoy; negativo = ya venció). */
const daysLeft = (exp: number, now: number) => Math.round((boDayStart(exp) - boDayStart(now)) / DAY);

/** Sus alquileres con la tienda que vencen en ALERT_DAYS días o menos (o vencidos sin cortar todavía). */
export function storeRentAlerts(e: Engine, customerId: Id, now: number = e.now()) {
  return Object.values(e.s.assignments)
    .filter((a) => a.customerId === customerId && a.status === "active" && !a.holdOpen && !a.trial && daysLeft(a.customerExpiresAt, now) <= ALERT_DAYS)
    .sort((x, y) => x.customerExpiresAt - y.customerExpiresAt)
    .map((a) => {
      const can = canRenewHere(e, customerId, a), ok = can && renewableNow(e, a);
      return {
        assignmentId: a.id, productId: a.productId, product: short(e.s.products[a.productId]?.name ?? "Servicio"),
        expiresAt: a.customerExpiresAt, cutAt: cutAtOf(a) ?? a.customerExpiresAt, daysLeft: daysLeft(a.customerExpiresAt, now),
        price: renewPriceFor(e, customerId, a), canRenew: ok, inReview: paidInReview(e, a),
        // El texto del cartel, igual al del aviso al celular.
        text: `Tu ${short(e.s.products[a.productId]?.name ?? "servicio")} de la tienda ${daysLeft(a.customerExpiresAt, now) < 0 ? "venció" : "vence"} el ${fdm(a.customerExpiresAt)} y se corta el ${fdm(cutAtOf(a) ?? a.customerExpiresAt)}`,
      };
    });
}

/** Para el cartel de GaboHub: solo el revendedor (o cliente) logueado, solo lo suyo. */
export function myStoreRentAlerts(e: Engine, actor: Actor) {
  if (!actor.customerId || (actor.role !== "reseller" && actor.role !== "customer")) throw new DomainError("FORBIDDEN", "Solo para clientes y revendedores");
  const list = storeRentAlerts(e, actor.customerId);
  return { list, total: list.filter((x) => x.canRenew && !x.inReview).reduce((t, x) => t + x.price, 0) };
}

/**
 * Aviso al celular del día (o null): 3 días antes y el día del vencimiento de algún alquiler suyo con la tienda.
 * El servidor lo manda una sola vez por día.
 */
export function storeRentPush(e: Engine, customerId: Id, now: number = e.now()): { title: string; body: string; url: string } | null {
  const due = storeRentAlerts(e, customerId, now).filter((x) => !x.inReview && (x.daysLeft === ALERT_DAYS || x.daysLeft === 0));
  if (!due.length) return null;
  const first = due[0];
  return {
    title: due.length === 1 ? `⏰ ${first.text}` : `⏰ ${due.length} cuentas tuyas de la tienda vencen pronto`,
    body: due.length === 1 ? (first.canRenew ? "Renovala desde GaboHub para que tus clientes no se queden sin servicio." : "Escribile a la tienda para renovarla.")
      : `${due.slice(0, 3).map((x) => `${x.product} (vence ${fdm(x.expiresAt)}, se corta ${fdm(x.cutAt)})`).join(" · ")}${due.length > 3 ? "…" : ""}`,
    url: "/hub#cuentas",
  };
}
