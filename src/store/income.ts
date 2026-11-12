// FUENTE ÚNICA DE "LO QUE ENTRÓ" (Premium 2.0, etapa 2). La usan Inicio (dashboard), Finanzas,
// el resumen (/api/admin/stats) y "Cómo van tus revendedores", así los tres muestran el mismo número.
//
// Un ingreso es una de dos cosas:
//  1. Un pedido entregado (`fulfilled`) de venta o renovación, en la fecha en que se entregó
//     (`updatedAt`). Sin recargas (la plata entra una sola vez: cuando se recarga, no cuando se gasta),
//     sin pruebas gratis y sin lo importado de un Excel (eso no es plata que entró ahora).
//  2. Un cobro marcado 💵 "cobrado" en el Control, sin pedido (efectivo, QR directo al dueño):
//     - las marcas nuevas guardan fecha, período y monto (`control.paidLog`);
//     - las marcas viejas (sin anotación) cuentan una vez, el día que empezó ese período
//       (vencimiento − duración), con el precio del Control.
//     Para no contar dos veces el mismo mes: si ese servicio tiene un pedido que cuenta a menos de
//     DEDUPE_DAYS días del cobro marcado, la marca no suma (ya está el pedido).
import type { Cents, Id, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY } from "./time.js";
import { effectivePrice, payerOf } from "./admin.js";

/** Un cobro del Control a menos de estos días de un pedido del mismo servicio es el mismo pago. */
export const DEDUPE_DAYS = 20;

export interface IncomeItem { productId: Id; qty: number; amount: Cents }
export interface IncomeEvent {
  at: number;
  amount: Cents;
  source: "order" | "control";
  kind: "sale" | "renewal" | "control";
  /** Quién pagó: el revendedor si el servicio es de un cliente suyo; si no, el cliente. */
  payerId: Id;
  customerId: Id;
  orderId?: Id;
  assignmentId?: Id;
  order?: Order;
  /** El total repartido entre los productos del pedido (los cupones y combos se reparten por precio). */
  items: IncomeItem[];
}

/** ¿Este pedido es plata que entró? (entregado, no recarga, no prueba, no importado). */
export const countsAsIncome = (o: Order): boolean => o.status === "fulfilled" && o.kind !== "topup" && !o.trial && o.channel !== "import";

export function incomeEvents(e: Engine, now: number = e.now()): IncomeEvent[] {
  const out: IncomeEvent[] = [];
  /** Cuándo se pagó cada servicio con un pedido (para no contar además su marca del Control). */
  const orderTimes = new Map<Id, number[]>();
  for (const o of Object.values(e.s.orders)) {
    if (!countsAsIncome(o)) continue;
    for (const id of o.renewal ? [o.renewal.assignmentId] : o.assignmentIds ?? []) orderTimes.set(id, [...(orderTimes.get(id) ?? []), o.updatedAt]);
    if (o.updatedAt > now) continue;
    const sub = o.items.reduce((t, it) => t + it.qty * it.unitPrice, 0);
    const items = o.items.map((it) => ({ productId: it.productId, qty: it.qty, amount: sub > 0 ? Math.round((o.total * it.qty * it.unitPrice) / sub) : 0 }));
    out.push({ at: o.updatedAt, amount: o.total, source: "order", kind: o.kind === "renewal" ? "renewal" : "sale", payerId: o.payerId ?? o.customerId, customerId: o.customerId, orderId: o.id, order: o, items });
  }
  for (const a of Object.values(e.s.assignments)) {
    const c = a.control;
    if (!c || a.trial) continue;
    const dur = (e.s.products[a.productId]?.durationDays ?? 30) * DAY;
    const marks = c.paidLog?.length ? c.paidLog
      : c.payStatus === "pagado" ? [{ at: Math.min(a.customerExpiresAt - dur, now), from: a.customerExpiresAt - dur, amount: effectivePrice(e, a) }] : [];
    if (!marks.length) continue;
    const near = orderTimes.get(a.id) ?? [];
    const payerId = payerOf(e, a.customerId)?.id ?? a.customerId;
    for (const m of marks) {
      // La fecha del cobro: cuando lo marcaste; en las marcas viejas, cuando empezó el período.
      const t = c.paidLog?.length ? m.at : Math.min(m.from, now);
      if (t > now || !(m.amount > 0)) continue;
      if (near.some((ot) => Math.abs(ot - t) < DEDUPE_DAYS * DAY || Math.abs(ot - m.from) < DEDUPE_DAYS * DAY)) continue;
      out.push({ at: t, amount: m.amount, source: "control", kind: "control", payerId, customerId: a.customerId, assignmentId: a.id, items: [{ productId: a.productId, qty: 1, amount: m.amount }] });
    }
  }
  return out.sort((x, y) => x.at - y.at);
}

/** Suma de lo que entró entre dos fechas (`from` incluido, `to` excluido). */
export const incomeBetween = (events: IncomeEvent[], from: number, to: number) => events.filter((x) => x.at >= from && x.at < to);
export const sumIncome = (events: IncomeEvent[]): Cents => events.reduce((t, x) => t + x.amount, 0);
