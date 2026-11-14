// «👤 Pasar a otro» un alquiler (revisión de 3 meses, 14/11/2026).
//
// Antes, al pasar el Disney de Luis (que no pagaba) a Ana:
//  - el Control seguía «Pendiente»: Ana aparecía debiendo lo que debía Luis, y a Luis se le borraba la deuda;
//  - la libreta de Luis (a quién le había dado cada perfil y su precio) se borraba para siempre;
//  - si el dueño se había equivocado de persona («le vendí a Carla Mamani en vez de a Carla Mendoza»), la cuenta
//    pasaba pero el pedido y la plata seguían a nombre de la persona equivocada.
// Ahora:
//  - el Control del dueño arranca de cero para el nuevo (sin estado de pago ni precio acordado con el anterior);
//  - lo que el anterior quedó debiendo pasa a SU fiado (no se pierde y no lo hereda el nuevo);
//  - la libreta del anterior (`subs`, `rcontrol`) se GUARDA aparte (`state.transferBooks`, nadie más la ve) y vuelve
//    sola si el alquiler vuelve a él;
//  - con «Fue un error: pasar también el cobro» (`moveCharge`) el pedido (y su ingreso) pasa a la persona correcta,
//    con el Control tal cual (es la misma venta). Si se pagó con saldo, se le devuelve al equivocado y se descuenta
//    del correcto (si no le alcanza, no se hace nada y se avisa).
// `transferPreview` dice todo esto ANTES de confirmar.
import type { Actor, Assignment, Cents, Id, Order, RentalControl, TransferBook } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY } from "./time.js";
import { effectivePrice } from "./admin.js";
import { addCharge } from "./fiado.js";
import { queue } from "./notify.js";
import { pubAssignment } from "./orders.js";
import { balance, post } from "./wallet.js";
import { isUsd, paidTotal } from "./usd.js";

const fdate = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));
const fmt = (c: Cents) => `Bs ${(c / 100).toFixed(2)}`;
const books = (e: Engine) => (e.s.transferBooks ??= {});
const bookKey = (assignmentId: Id, customerId: Id) => `${assignmentId}|${customerId}`;
/** Cargos del fiado del DUEÑO atados a este alquiler (no la libreta de un revendedor). */
const linkedCharges = (e: Engine, a: Assignment) => (e.s.fiado ?? []).filter((x) => !x.creditorId && x.kind === "cargo" && x.assignmentId === a.id);
const unpaid = (c?: RentalControl) => !!c?.payStatus && c.payStatus !== "pagado";
/** Pedidos que se llevan con «Fue un error»: la venta y las renovaciones de este alquiler a nombre del anterior. */
const ordersOf = (e: Engine, a: Assignment, from: Id): Order[] => Object.values(e.s.orders).filter((o) => o.status === "fulfilled" && o.customerId === from
  && (o.kind === "sale" || o.kind === "renewal") && (o.renewal?.assignmentId === a.id || (o.kind === "sale" && o.assignmentIds.includes(a.id))));

/** Qué va a pasar al pasar este alquiler a `toCustomerId` (para la confirmación). No cambia nada. */
export function transferPreview(e: Engine, actor: Actor, assignmentId: Id, toCustomerId: Id) {
  authorize(actor, "assignment.replace");
  const a = e.get("assignments", assignmentId);
  const to = e.get("customers", toCustomerId);
  const from = e.s.customers[a.customerId];
  const debt = unpaid(a.control) && !linkedCharges(e, a).length ? effectivePrice(e, a) : 0;
  const orders = ordersOf(e, a, a.customerId);
  const back = books(e)[bookKey(a.id, to.id)];
  const lines: string[] = [
    `${to.name} recibe el mismo perfil y la misma fecha (vence el ${fdate(a.customerExpiresAt)}).`,
    `Su Control arranca de cero: sin deuda ni precio acordado con ${from?.name ?? "el anterior"}.`,
    debt ? `Lo que debía ${from?.name ?? "el anterior"} (${fmt(debt)}) queda en SU fiado.` : "",
    a.subs?.length || a.rcontrol ? `La libreta de ${from?.name ?? "el anterior"} (${a.subs?.length ?? 0} perfil(es) anotados) se guarda: vuelve si la cuenta vuelve a él.` : "",
    back ? `Vuelve la libreta que ${to.name} tenía en esta cuenta (${back.subs?.length ?? 0} perfil(es)).` : "",
  ].filter(Boolean);
  return {
    from: { id: from?.id ?? a.customerId, name: from?.name ?? "?" }, to: { id: to.id, name: to.name },
    lines, debt, savesBook: !!(a.subs?.length || a.rcontrol), restoresBook: !!back,
    // «Fue un error: pasar también el cobro»: qué pedidos y cuánto se llevaría.
    charge: { orders: orders.map((o) => ({ id: o.id, total: o.total, kind: o.kind, method: o.paymentMethod })), total: orders.reduce((t, o) => t + o.total, 0),
      blocked: linkedCharges(e, a).length ? `Este alquiler está en el fiado de ${from?.name ?? "el anterior"}: borrá ese cargo primero` : orders.find((o) => o.kind === "sale" && o.assignmentIds.length > 1) ? "La venta tiene más de un perfil: pasá el cobro a mano" : null },
  };
}

export function transferAssignment(e: Engine, actor: Actor, assignmentId: Id, toCustomerId: Id, reason: string, opts: { moveCharge?: boolean } = {}): Assignment {
  authorize(actor, "assignment.replace");
  if (!reason?.trim()) throw new DomainError("VALIDATION", "Indicá el motivo de la transferencia");
  return e.tx(() => {
    const a = e.get("assignments", assignmentId);
    if (a.status !== "active") throw new DomainError("INVALID_STATE", "Solo se transfieren servicios activos");
    const to = e.get("customers", toCustomerId);
    if (to.id === a.customerId) throw new DomainError("VALIDATION", "El servicio ya es de ese cliente");
    const fromId = a.customerId, from = e.s.customers[fromId];
    const moved: Id[] = [];
    let debt: Cents = 0;
    if (opts.moveCharge) {
      // «Fue un error»: la misma venta, a la persona correcta. El Control queda como está.
      const pv = transferPreview(e, actor, a.id, to.id);
      if (pv.charge.blocked) throw new DomainError("INVALID_STATE", pv.charge.blocked);
      for (const o of ordersOf(e, a, fromId)) {
        const payer = o.payerId ?? o.customerId;
        if (o.paymentMethod === "balance" && payer === fromId) {
          if (isUsd(e, fromId) !== isUsd(e, to.id)) throw new DomainError("VALIDATION", "Pagan en monedas distintas: pasalo sin «Fue un error» y arreglá el saldo a mano");
          const amt = paidTotal(o);
          post(e, actor, fromId, amt, "refund", o.id, `Se pasó a ${to.name}: era de otra persona`);
          if (balance(e, to.id) < amt) throw new DomainError("INSUFFICIENT_BALANCE", `${to.name} no tiene saldo para ese pedido (${fmt(amt)}): pasalo sin «Fue un error» y cobrale aparte`);
          post(e, actor, to.id, -amt, "purchase", o.id, `Pasado desde ${from?.name ?? "otro cliente"}`);
        }
        o.customerId = to.id;
        if (payer === fromId) o.payerId = to.id;
        moved.push(o.id);
      }
    } else {
      // Lo que debía el anterior queda en SU fiado (no lo hereda el nuevo).
      if (unpaid(a.control) && !linkedCharges(e, a).length) {
        debt = effectivePrice(e, a);
        if (debt > 0) addCharge(e, actor, { customerId: fromId, amount: debt, dueAt: a.customerExpiresAt, note: `${e.s.products[a.productId]?.name ?? "Servicio"} (se pasó a ${to.name})`.slice(0, 120) });
      }
      // Control del dueño: arranca de cero para el nuevo. El historial de cobros (paidLog) queda para Finanzas.
      const c: RentalControl = { ...(a.control ?? {}) };
      if (c.payStatus === "pagado" && !c.paidLog?.length) {
        // Marca vieja sin anotación: se pasa a anotación para que lo cobrado no desaparezca de Finanzas.
        const dur = (e.s.products[a.productId]?.durationDays ?? 30) * DAY, start = a.customerExpiresAt - dur;
        c.paidLog = [{ at: Math.min(start, e.now()), from: start, amount: effectivePrice(e, a) }];
      }
      // Lo que ya se cobró sigue a nombre de quien pagó (Finanzas, Cómo van), no del nuevo (revisión de 3 meses, 16/11/2026).
      if (c.paidLog?.length) c.paidLog = c.paidLog.map((p) => (p.customerId ? p : { ...p, customerId: fromId }));
      const keep: TransferBook = { at: e.now(), ...(a.subs?.length ? { subs: a.subs } : {}), ...(a.rcontrol ? { rcontrol: a.rcontrol } : {}),
        ...(c.price !== undefined ? { price: c.price } : {}), ...(c.priceUsd !== undefined ? { priceUsd: c.priceUsd } : {}), ...(c.seller ? { seller: c.seller } : {}) };
      delete c.payStatus; delete c.price; delete c.priceUsd; delete c.seller; delete c.noticed;
      a.control = c;
      if (keep.subs || keep.rcontrol || keep.price !== undefined || keep.priceUsd !== undefined || keep.seller) books(e)[bookKey(a.id, fromId)] = keep;
    }
    // La libreta del revendedor (a quién le dio cada perfil) nunca viaja con la cuenta: se guarda para él.
    const dropped = a.subs?.length ?? 0;
    if (opts.moveCharge && (a.subs?.length || a.rcontrol)) books(e)[bookKey(a.id, fromId)] = { at: e.now(), ...(a.subs?.length ? { subs: a.subs } : {}), ...(a.rcontrol ? { rcontrol: a.rcontrol } : {}) };
    delete a.subs; delete a.rcontrol;
    // Si el alquiler vuelve a alguien que ya lo tuvo, recupera su libreta y el precio acordado con él.
    const back = books(e)[bookKey(a.id, to.id)];
    if (back) {
      if (back.subs?.length) a.subs = back.subs;
      if (back.rcontrol) a.rcontrol = back.rcontrol;
      if (!opts.moveCharge) {
        const c: RentalControl = { ...(a.control ?? {}) };
        if (back.price !== undefined) c.price = back.price;
        if (back.priceUsd !== undefined) c.priceUsd = back.priceUsd;
        if (back.seller) c.seller = back.seller;
        a.control = c;
      }
      delete books(e)[bookKey(a.id, to.id)];
    }
    // «Fue un error»: lo cobrado también era de la persona correcta.
    if (opts.moveCharge && a.control?.paidLog?.length) a.control = { ...a.control, paidLog: a.control.paidLog.map((p) => (!p.customerId || p.customerId === fromId ? { ...p, customerId: to.id } : p)) };
    a.customerId = to.id;
    a.history.push({ at: e.now(), by: actor.id, event: "transferred", slotId: a.slotId, note: `de ${from?.name ?? "?"} a ${to.name}: ${reason.trim()}${opts.moveCharge ? " (con el cobro)" : ""}` });
    queue(e, to.id, "access_transferred", { product: e.s.products[a.productId].name, date: fdate(a.customerExpiresAt) });
    e.audit(actor, "assignment.transfer", "assignment", a.id, { from: fromId, to: to.id, reason, ...(dropped ? { subsDropped: dropped, subsSaved: dropped } : {}), ...(debt ? { debtToPrevious: debt } : {}), ...(moved.length ? { ordersMoved: moved.join(",") } : {}), ...(back ? { bookRestored: true } : {}) });
    return { ...pubAssignment(a), transfer: { debtToPrevious: debt, bookSaved: dropped > 0, bookRestored: !!back, ordersMoved: moved } } as Assignment;
  });
}
