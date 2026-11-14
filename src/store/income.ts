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
//  3. (14/11/2026) Un pago del FIADO del dueño («💵 Me pagó» en Fiado), el día que lo anotaste. Para no contar dos
//     veces el mismo alquiler: si un cargo del fiado que vino del Control (con `assignmentId`) quedó pagado (aunque sea
//     en parte), la marca «pagado» de ese mismo período en el Control ya no suma: la plata entró por el fiado.
//     Mismo período = el vencimiento del cargo está a menos de DEDUPE_DAYS días del fin del período marcado.
//     La libreta de cada revendedor (lo que le deben SUS clientes) no es plata de la tienda: no cuenta.
//  4. (15/11/2026) Venta o renovación FIADA (`order.payLater`, plata.ts): no cuenta al entregarse; cuenta su parte de
//     cada servicio el día que ese servicio pasó a «Pagado» en el Control (y esa marca del Control no suma aparte).
//     Si la deuda pasó al Fiado, cuenta el pago del fiado y el pedido no.
//  5. (15/11/2026) Plata devuelta a un cliente («↩️ Devolver», a su saldo o en efectivo): resta, el día que se devolvió.
//     Así lo que el cliente paga después con ese saldo no se cuenta dos veces.
import type { Cents, FiadoEntry, Id, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY } from "./time.js";
import { effectivePrice, payerOf } from "./admin.js";
import { servicesOf, sharesOf } from "./plata.js";

/** Un cobro del Control a menos de estos días de un pedido del mismo servicio es el mismo pago. */
export const DEDUPE_DAYS = 20;

export interface IncomeItem { productId: Id; qty: number; amount: Cents }
export interface IncomeEvent {
  at: number;
  amount: Cents;
  source: "order" | "control" | "fiado" | "refund";
  kind: "sale" | "renewal" | "control" | "fiado" | "refund";
  /** Quién pagó: el revendedor si el servicio es de un cliente suyo; si no, el cliente. */
  payerId: Id;
  customerId: Id;
  orderId?: Id;
  assignmentId?: Id;
  /** El pago del fiado (solo `source: "fiado"`). */
  fiadoEntryId?: Id;
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
  /** Períodos cobrados de pedidos fiados, por servicio (esa marca del Control ya está en el pedido). */
  const laterFrom = new Map<Id, number[]>();
  for (const o of Object.values(e.s.orders)) {
    if (!countsAsIncome(o)) continue;
    const sub = o.items.reduce((t, it) => t + it.qty * it.unitPrice, 0);
    const itemsFor = (amount: Cents, withQty: boolean) => o.items.map((it) => ({ productId: it.productId, qty: withQty ? it.qty : 0, amount: sub > 0 ? Math.round((amount * it.qty * it.unitPrice) / sub) : 0 }));
    const base = { source: "order" as const, kind: o.kind === "renewal" ? "renewal" as const : "sale" as const, payerId: o.payerId ?? o.customerId, customerId: o.customerId, orderId: o.id, order: o };
    if (o.payLater) {
      // Fiada: cuenta lo cobrado de cada servicio, el día del cobro (las unidades, con el primer cobro).
      const shares = sharesOf(e, o);
      const paid = Object.entries(o.payLater.paid ?? {}).filter(([id]) => shares.has(id) && !o.payLater!.fiado?.includes(id)).sort((x, y) => x[1].at - y[1].at);
      paid.forEach(([id, p], i) => {
        laterFrom.set(id, [...(laterFrom.get(id) ?? []), p.from]);
        if (p.at > now) return;
        const amount = shares.get(id) ?? 0;
        out.push({ ...base, at: p.at, amount, assignmentId: id, items: itemsFor(amount, i === 0) });
      });
      continue;
    }
    for (const id of servicesOf(o)) orderTimes.set(id, [...(orderTimes.get(id) ?? []), o.updatedAt]);
    if (o.updatedAt > now) continue;
    out.push({ ...base, at: o.updatedAt, amount: o.total, items: itemsFor(o.total, true) });
  }
  const fiado = fiadoPayments(e, now);
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
      // Ese período se cobró como pedido fiado: ya cuenta el pedido (con su monto de verdad).
      if ((laterFrom.get(a.id) ?? []).includes(m.from)) continue;
      if (near.some((ot) => Math.abs(ot - t) < DEDUPE_DAYS * DAY || Math.abs(ot - m.from) < DEDUPE_DAYS * DAY)) continue;
      // Ese período se pagó por el fiado: ya cuenta el pago del fiado.
      if ((fiado.paidCharges.get(a.id) ?? []).some((ch) => ch.dueAt !== undefined ? Math.abs(ch.dueAt - (m.from + dur)) < DEDUPE_DAYS * DAY : Math.abs(ch.at - t) < DEDUPE_DAYS * DAY || Math.abs(ch.at - m.from) < DEDUPE_DAYS * DAY)) continue;
      out.push({ at: t, amount: m.amount, source: "control", kind: "control", payerId, customerId: a.customerId, assignmentId: a.id, items: [{ productId: a.productId, qty: 1, amount: m.amount }] });
    }
  }
  out.push(...fiado.events);
  // Plata devuelta a clientes (a su saldo o en efectivo): resta el día que se devolvió.
  for (const r of e.s.customerRefunds ?? []) {
    if (r.at > now || !(r.amount > 0)) continue;
    const a = r.assignmentId ? e.s.assignments[r.assignmentId] : undefined;
    out.push({ at: r.at, amount: -r.amount, source: "refund", kind: "refund", payerId: payerOf(e, r.customerId)?.id ?? r.customerId, customerId: r.customerId,
      ...(r.assignmentId ? { assignmentId: r.assignmentId } : {}), items: a ? [{ productId: a.productId, qty: 0, amount: -r.amount }] : [] });
  }
  return out.sort((x, y) => x.at - y.at);
}

/**
 * Pagos del fiado del dueño como ingresos, y qué cargos que vinieron del Control quedaron pagados (para no contar
 * además su marca del Control). Los pagos cubren primero el cargo más viejo, igual que la pantalla Fiado. Si un pago
 * termina de cubrir el cargo de un alquiler, ese producto suma una unidad (para «Por producto» y el costo estimado).
 */
function fiadoPayments(e: Engine, now: number): { events: IncomeEvent[]; paidCharges: Map<Id, FiadoEntry[]> } {
  const events: IncomeEvent[] = [];
  const paidCharges = new Map<Id, FiadoEntry[]>();
  const byCustomer = new Map<Id, FiadoEntry[]>();
  for (const x of e.s.fiado ?? []) if (!x.creditorId && x.at <= now) byCustomer.set(x.customerId, [...(byCustomer.get(x.customerId) ?? []), x]);
  for (const [customerId, list] of byCustomer) {
    const charges = list.filter((x) => x.kind === "cargo").sort((a, b) => a.at - b.at).map((c) => ({ c, left: c.amount }));
    let i = 0;
    for (const p of list.filter((x) => x.kind === "pago").sort((a, b) => a.at - b.at)) {
      let rem = p.amount;
      const items: IncomeItem[] = [];
      while (rem > 0 && i < charges.length) {
        const ch = charges[i], take = Math.min(rem, ch.left);
        ch.left -= take; rem -= take;
        const asg = ch.c.assignmentId ? e.s.assignments[ch.c.assignmentId] : undefined;
        if (asg) {
          items.push({ productId: asg.productId, qty: ch.left === 0 ? 1 : 0, amount: take });
          const l = paidCharges.get(asg.id) ?? [];
          if (!l.includes(ch.c)) paidCharges.set(asg.id, [...l, ch.c]);
        }
        if (ch.left === 0) i++;
      }
      events.push({ at: p.at, amount: p.amount, source: "fiado", kind: "fiado", payerId: customerId, customerId, fiadoEntryId: p.id, items });
    }
  }
  return { events, paidCharges };
}

/** Suma de lo que entró entre dos fechas (`from` incluido, `to` excluido). */
export const incomeBetween = (events: IncomeEvent[], from: number, to: number) => events.filter((x) => x.at >= from && x.at < to);
export const sumIncome = (events: IncomeEvent[]): Cents => events.reduce((t, x) => t + x.amount, 0);
