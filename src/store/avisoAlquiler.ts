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
import { myPendingQr, myRequests, openRequestOf, pendingRenewalOf, renewRequestHold } from "./renovarSinTrabas.js";

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
      const can = canRenewHere(e, customerId, a), supplierOk = renewableNow(e, a), ok = can && supplierOk;
      const cutAt = cutAtOf(a) ?? a.customerExpiresAt, cutDays = daysLeft(cutAt, now), dl = daysLeft(a.customerExpiresAt, now);
      const name = short(e.s.products[a.productId]?.name ?? "servicio");
      // R2 (14/11): por qué no entra en «Renovar las N», el pedido de renovación y la renovación que espera el QR.
      const req = openRequestOf(e, a.id), pend = pendingRenewalOf(e, a.id), held = renewRequestHold(e, a);
      const why = !can ? "store" as const : !supplierOk ? "supplier" as const : undefined;
      return {
        assignmentId: a.id, productId: a.productId, product: short(e.s.products[a.productId]?.name ?? "Servicio"),
        expiresAt: a.customerExpiresAt, cutAt, daysLeft: dl, cutDaysLeft: cutDays,
        price: renewPriceFor(e, customerId, a), canRenew: ok && !pend, inReview: paidInReview(e, a),
        ...(why ? { why } : {}), ...(req ? { request: { id: req.id, createdAt: req.createdAt } } : {}), ...(held ? { held: true } : {}),
        ...(pend ? { pendingOrderId: pend.id, pendingStatus: pend.status } : {}),
        // El texto del cartel, igual al del aviso al celular. El día del corte: «Hoy se corta tu HBO».
        text: cutDays === 0 && !held ? `✂️ Hoy se corta tu ${name} de la tienda (venció el ${fdm(a.customerExpiresAt)})`
          : `Tu ${name} de la tienda ${dl < 0 ? "venció" : "vence"} el ${fdm(a.customerExpiresAt)} y se corta el ${fdm(cutAt)}`,
      };
    });
}

/** Para el cartel de GaboHub: solo el revendedor (o cliente) logueado, solo lo suyo. */
export function myStoreRentAlerts(e: Engine, actor: Actor) {
  if (!actor.customerId || (actor.role !== "reseller" && actor.role !== "customer")) throw new DomainError("FORBIDDEN", "Solo para clientes y revendedores");
  const list = storeRentAlerts(e, actor.customerId);
  return {
    list, total: list.filter((x) => x.canRenew && !x.inReview).reduce((t, x) => t + x.price, 0),
    // Sus renovaciones por QR esperando comprobante (para «Pagá Bs X con un solo QR») y sus pedidos de renovación.
    pending: myPendingQr(e, actor.customerId), requests: myRequests(e, actor),
  };
}

/**
 * Aviso al celular del día (o null): 3 días antes y el día del vencimiento de algún alquiler suyo con la tienda.
 * El servidor lo manda una sola vez por día.
 */
export function storeRentPush(e: Engine, customerId: Id, now: number = e.now()): { title: string; body: string; url: string } | null {
  const alerts = storeRentAlerts(e, customerId, now).filter((x) => !x.inReview);
  // El día del corte va solo y primero: «✂️ Hoy se corta tu HBO» (R2, 14/11). Si pidió la renovación, no se corta.
  const cut = alerts.filter((x) => x.cutDaysLeft === 0 && !x.held);
  if (cut.length) {
    return {
      title: cut.length === 1 ? `✂️ Hoy se corta tu ${cut[0].product} de la tienda` : `✂️ Hoy se cortan ${cut.length} cuentas tuyas de la tienda`,
      body: `${cut.length === 1 ? "" : `${cut.map((x) => x.product).join(", ")}. `}${cut.some((x) => x.canRenew) ? "Renovala ya desde GaboHub para que tus clientes no se queden sin servicio." : "Tocá «📩 Pedir renovación» en GaboHub: mientras la tienda la renueva no se corta."}`,
      url: "/hub#inicio",
    };
  }
  const due = alerts.filter((x) => x.daysLeft === ALERT_DAYS || x.daysLeft === 0);
  if (!due.length) return null;
  const first = due[0];
  return {
    title: due.length === 1 ? `⏰ ${first.text}` : `⏰ ${due.length} cuentas tuyas de la tienda vencen pronto`,
    body: due.length === 1 ? (first.canRenew ? "Renovala desde GaboHub para que tus clientes no se queden sin servicio." : first.why === "supplier" ? (first.request ? "Ya pediste la renovación: la tienda primero renueva con su proveedor." : "Tocá «📩 Pedir renovación» en GaboHub: la tienda primero renueva con su proveedor.") : "Escribile a la tienda para renovarla.")
      : `${due.slice(0, 3).map((x) => `${x.product} (vence ${fdm(x.expiresAt)}, se corta ${fdm(x.cutAt)})`).join(" · ")}${due.length > 3 ? "…" : ""}`,
    url: "/hub#cuentas",
  };
}
