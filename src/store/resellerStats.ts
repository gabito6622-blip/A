// "📈 Cómo van tus revendedores": para el dueño, quién crece, quién baja y quién se le está por ir.
//
// FUENTE ÚNICA DE "LO QUE TE PAGÓ": los pedidos entregados (`fulfilled`) de venta o renovación
// donde el revendedor es quien paga (`payerId`), con la fecha en que se entregaron (`updatedAt`).
// Es la misma regla que usan Dashboard y Finanzas (sin recargas, sin pruebas gratis, sin lo
// importado de un Excel). No se usa el libro de saldo: una renovación pagada con saldo deja un
// pedido Y un movimiento "renewal" (y antes una recarga "topup"); sumar dos de esas fuentes la
// contaría dos o tres veces. Con un solo pedido por renovación, se cuenta una sola vez, pague con
// saldo, QR o efectivo.
//
// PRIVACIDAD (docs/DECISIONES.md): el dueño no ve lo que el revendedor anota de SUS clientes
// (`assignment.subs`, `assignment.rcontrol`). Acá no se leen ni se devuelven; tampoco nombres,
// teléfonos o correos de los clientes del revendedor, ni datos de las cuentas. Solo totales.
import type { Actor, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DAY, HOUR, MINUTE } from "./time.js";
import { effectivePrice } from "./admin.js";

/** Ventana para "últimos 30 días" (renovaciones, caídos, crecimiento). */
export const WINDOW_DAYS = 30;
/** Un revendedor creado hace menos de esto es "nuevo". */
export const NEW_DAYS = 30;
/** "Vence en 7 días". */
export const DUE_DAYS = 7;
/** Proyección: lo que vence en estos días, si lo renuevan todo. */
export const PROJECTION_DAYS = 30;
/** Creciendo: pagó al menos +20 % que en los 30 días anteriores… */
export const GROW_PCT = 20;
/** Bajando: pagó al menos −20 % que en los 30 días anteriores… */
export const DROP_PCT = 20;
/** …y la diferencia es de al menos Bs 30 (un alquiler suelto no lo cambia de estado). */
export const MIN_CHANGE: Cents = 3000;
/** Bajando también si se le cayeron al menos 2 alquileres y más de los que renovó. */
export const DROPPED_MIN = 2;
/** Concentración: cuánto pesan los 3 que más te pagan. */
export const TOP_N = 3;
/** Bolivia es UTC−4 todo el año (sin horario de verano): el mes empieza a las 04:00 UTC del día 1. */
export const BO_OFFSET = 4 * HOUR;

export type ResellerTrend = "nuevo" | "creciendo" | "estable" | "bajando" | "dormido";

/** Inicio (ms) del mes calendario de Bolivia que contiene `t`, corrido `add` meses. */
export function boMonthStart(t: number, add = 0): number {
  const d = new Date(t - BO_OFFSET);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + add, 1) + BO_OFFSET;
}

const shortName = (n: string) => n.replace(/\s*\(alquiler revendedores\)\s*$/i, "");
const pct = (cur: number, base: number) => (base > 0 ? Math.round(((cur - base) / base) * 100) : null);

/**
 * Regla del estado (en orden; gana la primera que se cumple):
 *  1. nuevo:     lo creaste hace menos de NEW_DAYS días.
 *  2. dormido:   no te pagó nada en los últimos 30 días y no tiene ningún alquiler activo.
 *  3. creciendo: en los últimos 30 días te pagó ≥ GROW_PCT % más que en los 30 anteriores (y ≥ MIN_CHANGE más).
 *  4. bajando:   te pagó ≥ DROP_PCT % menos (y ≥ MIN_CHANGE menos), o se le cayeron ≥ DROPPED_MIN
 *                alquileres y más de los que renovó.
 *  5. estable:   el resto.
 * Se comparan 30 días contra 30 días (no el mes calendario) para que el día 3 del mes no parezca que todos bajan.
 */
export function trendOf(x: { createdAt: number; paid30: Cents; prev30: Cents; activeCount: number; dropped: number; renewals: number }, now: number): ResellerTrend {
  if (x.createdAt > now - NEW_DAYS * DAY) return "nuevo";
  if (x.paid30 <= 0 && x.activeCount === 0) return "dormido";
  const diff = x.paid30 - x.prev30;
  if (diff >= MIN_CHANGE && x.paid30 * 100 >= x.prev30 * (100 + GROW_PCT)) return "creciendo";
  if (-diff >= MIN_CHANGE && x.paid30 * 100 <= x.prev30 * (100 - DROP_PCT)) return "bajando";
  if (x.dropped >= DROPPED_MIN && x.dropped > x.renewals) return "bajando";
  return "estable";
}

type Order = Engine["s"]["orders"][string];

/**
 * ¿Cada renovación fue a tiempo o tarde (pidió renovar cuando ya había vencido)?
 * Desde esta versión el pedido guarda `renewal.prevExpiresAt` y la respuesta es exacta. Para
 * renovaciones viejas sin ese dato se reconstruye hacia atrás desde el vencimiento actual: si
 * después de renovar quedó `vencimiento − días > momento de la renovación`, ya estaba vigente
 * (a tiempo); si quedó justo en `momento + días`, renovó vencido (tarde). Si hubo un cambio de
 * fecha a mano en el medio o una renovación tarde más nueva, no se puede saber: no se cuenta.
 */
function renewalTiming(e: Engine, asgId: Id, list: Order[]): Map<Id, "on_time" | "late"> {
  const out = new Map<Id, "on_time" | "late">();
  const a = e.s.assignments[asgId];
  if (!a) return out;
  const dur = (e.s.products[a.productId]?.durationDays ?? 30) * DAY;
  const changes = a.history.filter((h) => h.event === "date_changed").map((h) => h.at);
  let post: number | null = a.customerExpiresAt;
  let after = Infinity; // momento de la renovación ya procesada (la más nueva)
  for (const o of [...list].sort((x, y) => y.updatedAt - x.updatedAt)) {
    const t = o.updatedAt;
    if (changes.some((c) => c >= t && c < after)) post = null;
    const prev = o.renewal?.prevExpiresAt;
    if (prev !== undefined) {
      out.set(o.id, prev < o.createdAt ? "late" : "on_time");
      post = prev;
    } else if (post !== null) {
      const pre: number = post - (o.renewal?.periods ?? 1) * dur;
      if (pre > t + MINUTE) { out.set(o.id, "on_time"); post = pre; }
      else { out.set(o.id, "late"); post = null; }
    }
    after = t;
  }
  return out;
}

export function overview(e: Engine, actor: Actor, now: number = e.now()) {
  // Son montos del negocio: dueño y admin. Atención (seller), revendedores y clientes no.
  authorize(actor, "stats.view");
  const s = e.s;
  const resellers = Object.values(s.customers).filter((c) => c.kind === "reseller");
  const isRes = new Set(resellers.map((c) => c.id));
  /** De qué revendedor es un servicio: el suyo o el de un cliente suyo. */
  const ownerOf = (customerId: Id): Id | undefined => (isRes.has(customerId) ? customerId : (() => { const r = s.customers[customerId]?.resellerId; return r && isRes.has(r) ? r : undefined; })());

  const m0 = boMonthStart(now), m1 = boMonthStart(now, -1);
  const prevToDateEnd = Math.min(m0, m1 + (now - m0));
  const w30 = now - WINDOW_DAYS * DAY, w60 = now - 2 * WINDOW_DAYS * DAY;

  type Row = {
    id: Id; name: string; phone: string; createdAt: number;
    thisMonth: Cents; prevMonth: Cents; prevMonthToDate: Cents; paid30: Cents; prev30: Cents;
    renewalsOnTime: number; renewalsLate: number; dropped: number; droppedAmount: Cents;
    due7: { count: number; amount: Cents }; due30: { count: number; amount: Cents };
    active: Record<Id, number>; activeCount: number; lastOrderAt: number | null;
  };
  const rows = new Map<Id, Row>(resellers.map((c) => [c.id, {
    id: c.id, name: c.name, phone: c.phone, createdAt: c.createdAt,
    thisMonth: 0, prevMonth: 0, prevMonthToDate: 0, paid30: 0, prev30: 0,
    renewalsOnTime: 0, renewalsLate: 0, dropped: 0, droppedAmount: 0,
    due7: { count: 0, amount: 0 }, due30: { count: 0, amount: 0 }, active: {}, activeCount: 0, lastOrderAt: null,
  }]));

  // 1) Lo que pagó: un pedido entregado = un pago (ver arriba por qué no el saldo).
  const renewalsByAsg = new Map<Id, Order[]>();
  for (const o of Object.values(s.orders)) {
    if (o.status !== "fulfilled" || o.kind === "topup" || o.trial || o.channel === "import") continue;
    const r = rows.get(o.payerId ?? o.customerId);
    if (!r || o.updatedAt > now) continue;
    const t = o.updatedAt;
    if (t >= m0) r.thisMonth += o.total;
    else if (t >= m1) { r.prevMonth += o.total; if (t < prevToDateEnd) r.prevMonthToDate += o.total; }
    if (t > w30) r.paid30 += o.total;
    else if (t > w60) r.prev30 += o.total;
    if (t > (r.lastOrderAt ?? 0)) r.lastOrderAt = t;
    if (o.kind === "renewal" && o.renewal) {
      const l = renewalsByAsg.get(o.renewal.assignmentId) ?? [];
      l.push(o);
      renewalsByAsg.set(o.renewal.assignmentId, l);
    }
  }
  // 2) Renovaciones de los últimos 30 días: a tiempo o tarde.
  for (const [asgId, list] of renewalsByAsg) {
    if (!list.some((o) => o.updatedAt > w30)) continue;
    const timing = renewalTiming(e, asgId, list);
    for (const o of list) {
      if (o.updatedAt <= w30) continue;
      const r = rows.get(o.payerId ?? o.customerId)!;
      const k = timing.get(o.id);
      if (k === "on_time") r.renewalsOnTime++;
      else if (k === "late") r.renewalsLate++;
    }
  }
  // 3) Servicios: activos hoy por producto, lo que vence pronto y lo que se le cayó.
  for (const a of Object.values(s.assignments)) {
    if (a.trial) continue;
    const rid = ownerOf(a.customerId);
    if (!rid) continue;
    const r = rows.get(rid)!;
    const exp = a.customerExpiresAt;
    if (a.status === "active" && !a.holdOpen && exp >= now) {
      r.active[a.productId] = (r.active[a.productId] ?? 0) + 1;
      r.activeCount++;
      const price = effectivePrice(e, a);
      if (exp <= now + DUE_DAYS * DAY) { r.due7.count++; r.due7.amount += price; }
      if (exp <= now + PROJECTION_DAYS * DAY) { r.due30.count++; r.due30.amount += price; }
    } else if ((a.status === "active" || a.status === "revoked") && !a.holdOpen && exp < now && exp >= w30) {
      // Venció en los últimos 30 días y sigue vencido: no lo renovó (al renovar, la fecha pasa adelante).
      r.dropped++;
      r.droppedAmount += effectivePrice(e, a);
    }
  }

  const list = [...rows.values()].map((r) => {
    const renewals = r.renewalsOnTime + r.renewalsLate;
    const status = trendOf({ ...r, renewals }, now);
    const active = Object.entries(r.active)
      .map(([productId, count]) => ({ productId, name: shortName(s.products[productId]?.name ?? "Servicio"), count }))
      .sort((x, y) => y.count - x.count || x.name.localeCompare(y.name));
    return {
      id: r.id, name: r.name, phone: r.phone, createdAt: r.createdAt, status,
      active, activeCount: r.activeCount,
      thisMonth: r.thisMonth, prevMonth: r.prevMonth, prevMonthToDate: r.prevMonthToDate,
      /** Variación de este mes contra el mes pasado a esta misma altura (Bs y %). */
      change: r.thisMonth - r.prevMonthToDate, changePct: pct(r.thisMonth, r.prevMonthToDate),
      paid30: r.paid30, prev30: r.prev30,
      renewalsOnTime: r.renewalsOnTime, renewalsLate: r.renewalsLate,
      dropped: r.dropped, droppedAmount: r.droppedAmount,
      due7: r.due7, lastOrderAt: r.lastOrderAt,
    };
  }).sort((x, y) => y.paid30 - x.paid30 || y.thisMonth - x.thisMonth || x.name.localeCompare(y.name));

  const sum = (f: (r: Row) => number) => [...rows.values()].reduce((t, r) => t + f(r), 0);
  const total30 = sum((r) => r.paid30);
  const top = list.slice(0, TOP_N).filter((r) => r.paid30 > 0);
  const top30 = top.reduce((t, r) => t + r.paid30, 0);
  const thisMonth = sum((r) => r.thisMonth), prevMonthToDate = sum((r) => r.prevMonthToDate);
  const byStatus: Record<ResellerTrend, number> = { nuevo: 0, creciendo: 0, estable: 0, bajando: 0, dormido: 0 };
  for (const r of list) byStatus[r.status]++;

  return {
    at: now,
    monthStart: m0,
    prevMonthStart: m1,
    rules: { windowDays: WINDOW_DAYS, newDays: NEW_DAYS, dueDays: DUE_DAYS, projectionDays: PROJECTION_DAYS, growPct: GROW_PCT, dropPct: DROP_PCT, minChange: MIN_CHANGE, droppedMin: DROPPED_MIN, topN: TOP_N },
    totals: {
      thisMonth, prevMonth: sum((r) => r.prevMonth), prevMonthToDate,
      change: thisMonth - prevMonthToDate, changePct: pct(thisMonth, prevMonthToDate),
      paid30: total30,
      due7: { count: sum((r) => r.due7.count), amount: sum((r) => r.due7.amount) },
      projection30: { count: sum((r) => r.due30.count), amount: sum((r) => r.due30.amount) },
      dropped: { count: sum((r) => r.dropped), amount: sum((r) => r.droppedAmount) },
      concentration: { topN: top.length, pct: total30 > 0 ? Math.round((top30 / total30) * 100) : null, amount: top30, names: top.map((r) => r.name) },
      byStatus,
      resellers: list.length,
    },
    list,
  };
}
