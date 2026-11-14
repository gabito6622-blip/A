// Se cortó debiendo (revisión de 3 meses como Gabriel, 16/11/2026). Un cliente al que le fiaste el mes (venta o
// renovación fiada) y que no volvió: al cortarse solo, el alquiler dejaba de estar activo y su deuda desaparecía del
// Fiado (el Fiado solo miraba alquileres activos). Ahora, al cortarse, lo que debía pasa a SU libreta del fiado, con la
// fecha en que vencía, y la plata entra por ahí cuando pague (no se cuenta dos veces).
import type { Actor, Assignment, Cents, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { owedByPayLater, payLaterToFiado, sharesOf } from "./plata.js";

/** Pasa al fiado del dueño lo que debía un alquiler que se corta. Devuelve el monto (0 si no debía). Dentro de `tx`. */
export function debtToFiadoOnCut(e: Engine, actor: Actor, a: Assignment): Cents {
  if (a.trial) return 0;
  // Ya está en el fiado (lo pasaste a mano): no se repite.
  if ((e.s.fiado ?? []).some((x) => !x.creditorId && x.kind === "cargo" && x.assignmentId === a.id)) return 0;
  const owed = owedByPayLater(e, a.id);
  if (!owed || owed <= 0) return 0;
  const slot = e.s.slots[a.slotId];
  (e.s.fiado ??= []).push({
    id: e.id("fia"), customerId: a.customerId, kind: "cargo", amount: owed, at: e.now(), by: actor.id, assignmentId: a.id, dueAt: a.customerExpiresAt,
    note: `${e.s.products[a.productId]?.name ?? "Servicio"}${slot ? ` · ${slot.label}` : ""} (se cortó sin pagar)`.slice(0, 120),
  });
  payLaterToFiado(e, a.id);
  e.audit(actor, "fiado.cut_debt", "customer", a.customerId, { assignmentId: a.id, amount: owed });
  return owed;
}

/**
 * «Renovar» fiado de un alquiler que YA está en el fiado (lo pasaste antes o pagó una parte): la renovación nueva
 * también va a su libreta. Antes quedaba afuera: el Fiado mostraba menos de lo que debía y, al pagar todo, esa
 * renovación se contaba dos veces en Finanzas (por el pago del fiado y por la marca «pagado» del Control).
 */
export function fiadaRenewalToBook(e: Engine, actor: Actor, o: Order, a: Assignment): Cents {
  if (!o.payLater || o.payLater.fiado?.includes(a.id)) return 0;
  const linked = (e.s.fiado ?? []).find((x) => !x.creditorId && x.kind === "cargo" && x.assignmentId === a.id);
  if (!linked) return 0;
  const amount = sharesOf(e, o).get(a.id) ?? o.total;
  if (!(amount > 0)) return 0;
  const slot = e.s.slots[a.slotId];
  (e.s.fiado ??= []).push({
    id: e.id("fia"), customerId: linked.customerId, kind: "cargo", amount, at: e.now(), by: actor.id, assignmentId: a.id, dueAt: a.customerExpiresAt,
    note: `${e.s.products[a.productId]?.name ?? "Servicio"}${slot ? ` · ${slot.label}` : ""} (renovación fiada)`.slice(0, 120),
  });
  o.payLater.fiado = [...(o.payLater.fiado ?? []), a.id];
  e.audit(actor, "fiado.renewal", "customer", linked.customerId, { assignmentId: a.id, amount, orderId: o.id });
  return amount;
}
