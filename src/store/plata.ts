// La plata como la maneja un humano (15/11/2026, equipo 1 «la plata coincide»):
//
// 1. Venta o renovación FIADA. «⏳ Pendiente» en Vender, o «Renovar» en el Control de un alquiler que figura pendiente:
//    el pedido queda entregado pero con `payLater` y NO cuenta como «Entró». Cuando el alquiler pasa a «Pagado» en el
//    Control, ese pedido cuenta UNA vez, el día del cobro, por lo que de verdad se cobró (su total, con meses y cupón).
//    Si la deuda pasó a la libreta del Fiado, la plata entra por el pago del fiado y el pedido no cuenta nunca.
// 2. Corregir el monto de una venta ya hecha (dueño o admin, con motivo, queda en la Auditoría).
// 3. Devolver plata a un cliente (a su saldo o en efectivo): resta de «Entró» el día que se devolvió. Así, cuando el
//    cliente usa ese saldo, lo que «entra» de nuevo no se cuenta dos veces.
import type { Actor, Assignment, Cents, Id, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { boMonthKey } from "./time.js";
import { effectivePrice } from "./admin.js";

const fdate = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));

/** Servicios de un pedido (una renovación tiene uno; una venta, uno por perfil). */
export const servicesOf = (o: Order): Id[] => (o.renewal ? [o.renewal.assignmentId] : o.assignmentIds ?? []);

/** Cuánto del total de un pedido le toca a cada servicio (por el precio de su app); suma exacto el total. */
export function sharesOf(e: Engine, o: Order): Map<Id, Cents> {
  const ids = servicesOf(o), out = new Map<Id, Cents>();
  if (ids.length <= 1) { if (ids[0]) out.set(ids[0], o.total); return out; }
  const w = ids.map((id) => Math.max(1, e.s.products[e.s.assignments[id]?.productId ?? ""]?.price ?? 1));
  const wt = w.reduce((t, x) => t + x, 0);
  let left = o.total;
  ids.forEach((id, i) => { const v = i === ids.length - 1 ? left : Math.round((o.total * w[i]) / wt); out.set(id, v); left -= v; });
  return out;
}

const pendingCtl = (a: Assignment | undefined) => !!a?.control?.payStatus && a.control.payStatus !== "pagado";

/** Venta fiada desde Vender: el pedido no cuenta hasta que se cobra y sus servicios quedan «Pendiente» en el Control. */
export function markPayLater(e: Engine, actor: Actor, o: Order): void {
  if (o.status !== "fulfilled" || o.paymentMethod !== "cash") return;
  o.payLater = { at: e.now() };
  for (const id of servicesOf(o)) {
    const a = e.s.assignments[id];
    if (a) a.control = { ...(a.control ?? {}), payStatus: "pendiente" };
  }
  e.audit(actor, "order.pay_later", "order", o.id, { total: o.total });
}

/** «Renovar» (en efectivo) de un alquiler que figura «Pendiente» o «No pagó» en el Control: la renovación queda fiada. */
export function payLaterIfPending(e: Engine, actor: Actor, o: Order, a: Assignment): void {
  if (o.paymentMethod === "cash" && pendingCtl(a)) markPayLater(e, actor, o);
}

/**
 * Lo marcaste «Pendiente» o «No pagó» en el Control después de anotarlo como cobrado (vendiste como pagado y no te pagó,
 * o lo anotaste tarde): el pedido en efectivo de ESE período queda fiado y deja de contar hasta que se cobre.
 * Mismo período = el pedido se entregó desde 20 días antes del inicio del período (`from`) en adelante.
 * Si el período ya termina (vence en 3 días o menos, o ya venció), «Pendiente» habla del PRÓXIMO mes (lo vas a renovar
 * fiado): no se toca lo que ya te pagó; la renovación que hagas queda fiada (payLaterIfPending).
 */
export function payLaterFromControl(e: Engine, actor: Actor, a: Assignment, from: number): void {
  if (a.customerExpiresAt - e.now() <= 3 * 86_400_000) return;
  for (const o of Object.values(e.s.orders)) {
    if (o.payLater || o.status !== "fulfilled" || o.paymentMethod !== "cash" || o.trial || o.channel === "import" || o.kind === "topup") continue;
    if (!servicesOf(o).includes(a.id) || o.updatedAt < from - 20 * 86_400_000) continue;
    o.payLater = { at: e.now() };
    e.audit(actor, "order.pay_later", "order", o.id, { total: o.total, via: "control" });
  }
}

/** Pedidos fiados de un servicio que todavía no se cobraron (ni pasaron al fiado). */
export function unpaidOrdersOf(e: Engine, assignmentId: Id): Order[] {
  return Object.values(e.s.orders).filter((o) => o.payLater && o.status === "fulfilled" && !o.trial && servicesOf(o).includes(assignmentId)
    && !o.payLater.paid?.[assignmentId] && !o.payLater.fiado?.includes(assignmentId));
}

/** Lo que te debe un servicio fiado: su parte de los pedidos sin cobrar. `undefined` si no hay pedido fiado. */
export function owedByPayLater(e: Engine, assignmentId: Id): Cents | undefined {
  const l = unpaidOrdersOf(e, assignmentId);
  return l.length ? l.reduce((t, o) => t + (sharesOf(e, o).get(assignmentId) ?? 0), 0) : undefined;
}

/** Lo que te debe un alquiler marcado sin pagar: lo fiado (con sus meses) o, si no hay pedido fiado, su precio real. */
export const owedFor = (e: Engine, a: Assignment): Cents => owedByPayLater(e, a.id) ?? effectivePrice(e, a);

/** El alquiler pasó a «Pagado» en el Control: sus pedidos fiados se cobraron hoy (período `from`). */
export function settlePayLater(e: Engine, assignmentId: Id, from: number): void {
  for (const o of unpaidOrdersOf(e, assignmentId)) o.payLater!.paid = { ...(o.payLater!.paid ?? {}), [assignmentId]: { at: e.now(), from } };
}

/** Volvió de «Pagado» a «Pendiente» (te equivocaste): se deshace el cobro de ESE período. */
export function unsettlePayLater(e: Engine, assignmentId: Id, from: number): void {
  for (const o of Object.values(e.s.orders)) {
    const p = o.payLater?.paid?.[assignmentId];
    if (p && p.from === from) { delete o.payLater!.paid![assignmentId]; }
  }
}

/** La deuda de ese servicio pasó a la libreta del Fiado (o volvió, con `back`). */
export function payLaterToFiado(e: Engine, assignmentId: Id, back = false): void {
  for (const o of Object.values(e.s.orders)) {
    if (!o.payLater || !servicesOf(o).includes(assignmentId) || o.payLater.paid?.[assignmentId]) continue;
    const l = new Set(o.payLater.fiado ?? []);
    if (back) l.delete(assignmentId); else l.add(assignmentId);
    if (l.size) o.payLater.fiado = [...l]; else delete o.payLater.fiado;
  }
}

/* ---------------- Corregir el monto de una venta ---------------- */

function fixable(o: Order | undefined): string | null {
  if (!o) return "Pedido no encontrado";
  if (o.status !== "fulfilled" || (o.kind !== "sale" && o.kind !== "renewal")) return "Solo se corrigen ventas o renovaciones entregadas";
  if (o.trial || o.channel === "import") return "Esa venta no cuenta como plata";
  if (o.paymentMethod === "balance") return "Se pagó con saldo: para devolver la diferencia usá «↩️ Devolver» o ajustá el saldo";
  if (o.usd !== undefined) return "Esa venta fue en dólares: no se corrige en Bs";
  return null;
}

/** Corregir el monto de una venta (dueño o admin, con motivo). Finanzas, Cierre y el Excel usan el corregido. */
export function amendOrderTotal(e: Engine, actor: Actor, orderId: Id, input: { total?: unknown; reason?: unknown }) {
  authorize(actor, "payment.review");
  const total = Math.round(Number(input.total));
  if (!Number.isInteger(total) || total < 0 || total > 10_000_000) throw new DomainError("VALIDATION", "Monto inválido");
  const reason = String(input.reason ?? "").trim();
  if (reason.length < 3 || reason.length > 120) throw new DomainError("VALIDATION", "Escribí el motivo (de 3 a 120 letras)");
  return e.tx(() => {
    const o = e.s.orders[orderId];
    const why = fixable(o);
    if (why) throw new DomainError(o ? "INVALID_STATE" : "NOT_FOUND", why);
    if (o.total === total) throw new DomainError("VALIDATION", "Es el mismo monto");
    const from = o.total;
    o.total = total;
    o.amended = [...(o.amended ?? []), { at: e.now(), by: actor.id, from, to: total, reason }].slice(-10);
    e.audit(actor, "order.amend", "order", o.id, { from, to: total, reason });
    return { orderId: o.id, from, total };
  });
}

/**
 * ¿Cambiaste el precio del Control de un alquiler que se vendió o renovó este mes? La venta de ese mes, para ofrecer
 * corregirla también (solo pedidos de un servicio, en Bs y no pagados con saldo). `suggested` = precio × meses.
 */
export function saleToFix(e: Engine, actor: Actor, assignmentId: Id) {
  authorize(actor, "payment.review");
  const a = e.get("assignments", assignmentId);
  const key = boMonthKey(e.now());
  const o = Object.values(e.s.orders).filter((x) => !fixable(x) && servicesOf(x).length === 1 && servicesOf(x)[0] === a.id && boMonthKey(x.updatedAt) === key)
    .sort((x, y) => y.updatedAt - x.updatedAt)[0];
  if (!o) return null;
  const months = o.renewal ? o.items[0]?.qty ?? 1 : (o.periods ?? 1) * (o.items[0]?.qty ?? 1);
  const price = a.control?.price ?? effectivePrice(e, a);
  return { orderId: o.id, kind: o.kind, at: o.updatedAt, date: fdate(o.updatedAt), total: o.total, months, suggested: price * months };
}

/* ---------------- Devolver plata a un cliente ---------------- */

/** Anota plata devuelta a un cliente (saldo o efectivo). Resta de «Entró» el día de hoy. La llama refundAssignment. */
export function recordCustomerRefund(e: Engine, actor: Actor, input: { customerId: Id; assignmentId?: Id; amountBs: Cents; via: "saldo" | "efectivo"; usd?: Cents; note?: string }): void {
  if (!(input.amountBs > 0)) return;
  (e.s.customerRefunds ??= []).push({ id: e.id("dev"), at: e.now(), by: actor.id, customerId: input.customerId, ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}),
    amount: input.amountBs, via: input.via, ...(input.usd ? { usd: input.usd } : {}), ...(input.note ? { note: input.note.slice(0, 120) } : {}) });
}
