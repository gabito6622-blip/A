// «Tu ganancia real» del revendedor, mes a mes (revisión de 3 meses, 14/11/2026).
//
// Primera versión (13/11): sumaba lo que pagó este mes por SUS alquileres y lo que «cobra por mes» por los perfiles (los
// precios anotados). En la simulación de 3 meses no coincidía con la realidad: contaba plata que todavía le debían y
// castigaba renovar temprano (pagar el 28/08 la cuenta de septiembre pesaba en agosto).
// Ahora, por mes calendario de Bolivia:
//  - Cobraste = lo que de verdad le pagaron: cobros de perfiles («Me pagó», «Renovó», anotado pagado; cuadernoPlata.ts)
//    + clientes registrados (ventas cobradas en el momento + pagos de su libreta «Quién me debe»).
//  - Te costó = sus alquileres repartidos según los días que CUBREN en ese mes (no según el día que pagó) + lo que le
//    costaron las ventas a sus clientes registrados.
//  - Ganancia real = cobraste − te costó.
// Cada mes que termina queda guardado («cierre»: con cuántos perfiles y cuentas tenía y cuánto le debían ese día).
// Solo lee lo suyo. Un revendedor de otro país (dos monedas) no lo resta: se muestra por separado.
import type { Actor, Cents, Customer, Id, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY, boMonthKey, boMonthStart } from "./time.js";
import { orderCurrency, paidTotal, walletCurrency } from "./usd.js";
import { isForeign, listPriceMine } from "./country.js";
import { cobrosOf, subMoney } from "./cuadernoPlata.js";

/** Cierre de un mes (se guarda una vez, cuando el mes termina). */
export interface MonthClose {
  key: string;
  /** Cobraste: perfiles + clientes registrados. */
  cobros: Cents;
  cobrosPerfiles: Cents;
  cobrosClientes: Cents;
  /** Sus alquileres de la tienda, por los días de ese mes que cubren. */
  alquileres: Cents;
  /** Lo que le costaron las ventas a sus clientes registrados. */
  ventas: Cents;
  ganancia: Cents;
  /** Foto del día del cierre. */
  perfiles: number;
  cuentas: number;
  deuda: Cents;
  closedAt: number;
}

const own = (e: Engine, me: Customer, cur: string) => (o: Order) =>
  o.status === "fulfilled" && (o.kind === "sale" || o.kind === "renewal") && !o.trial && o.channel !== "import"
  && (o.payerId ?? o.customerId) === me.id && o.customerId === me.id && orderCurrency(o) === cur;

/** Reparte `total` centavos entre partes según sus pesos, sin perder ni sumar un centavo. */
function split(total: Cents, weights: number[]): Cents[] {
  const sum = weights.reduce((t, w) => t + w, 0);
  if (!sum) return weights.map(() => 0);
  const raw = weights.map((w) => (total * w) / sum), out = raw.map(Math.floor);
  let left = total - out.reduce((t, x) => t + x, 0);
  raw.map((r, i) => [r - Math.floor(r), i] as const).sort((a, b) => b[0] - a[0]).forEach(([, i]) => { if (left-- > 0) out[i]++; });
  return out;
}

/** Lo que le cuestan sus alquileres, mes por mes («YYYY-MM» → centavos), según los días que cubre cada pago. */
export function rentalCostByMonth(e: Engine, me: Customer): Map<string, { cost: Cents; payments: number }> {
  const cur = walletCurrency(e, me), out = new Map<string, { cost: Cents; payments: number }>();
  const byAssignment = new Map<Id, Order[]>();
  for (const o of Object.values(e.s.orders)) if (own(e, me, cur)(o)) for (const id of o.assignmentIds) (byAssignment.get(id) ?? byAssignment.set(id, []).get(id)!).push(o);
  for (const [aid, orders] of byAssignment) {
    const a = e.s.assignments[aid];
    if (!a) continue;
    const P = (e.s.products[a.productId]?.durationDays ?? 30) * DAY;
    let end: number | undefined;
    for (const o of orders.sort((x, y) => x.updatedAt - y.updatedAt)) {
      const it = o.items.find((x) => x.productId === a.productId) ?? o.items[0];
      const periods = Math.max(1, o.kind === "renewal" ? it?.qty ?? 1 : o.periods ?? 1);
      const cost = Math.round(paidTotal(o) / Math.max(1, o.assignmentIds.length));
      // Venta: desde que arrancó. Renovación: sigue donde terminaba (renovar temprano no adelanta el gasto); si ya se
      // había cortado hace días y volvió, desde el día que pagó.
      const from = o.kind === "sale" || end === undefined ? (o.kind === "sale" ? a.startsAt : o.updatedAt) : o.updatedAt <= end + 3 * DAY ? end : o.updatedAt;
      const to = from + P * periods;
      end = to;
      const months: string[] = [], weights: number[] = [];
      for (let m0 = boMonthStart(from); m0 < to; m0 = boMonthStart(m0, 1)) {
        const w = Math.min(to, boMonthStart(m0, 1)) - Math.max(from, m0);
        if (w > 0) { months.push(boMonthKey(m0)); weights.push(w); }
      }
      split(cost, weights).forEach((c, i) => { const r = out.get(months[i]) ?? { cost: 0, payments: 0 }; r.cost += c; out.set(months[i], r); });
      const k = boMonthKey(o.updatedAt), r = out.get(k) ?? { cost: 0, payments: 0 }; r.payments++; out.set(k, r);
    }
  }
  return out;
}

/** Ventas a sus clientes registrados: lo cobrado en el momento y lo que le costaron, por mes; y los pagos de su libreta. */
function clientsByMonth(e: Engine, me: Customer): Map<string, { cobros: Cents; ventas: Cents }> {
  const cur = walletCurrency(e, me), out = new Map<string, { cobros: Cents; ventas: Cents }>();
  const add = (k: string, f: "cobros" | "ventas", v: Cents) => { const r = out.get(k) ?? { cobros: 0, ventas: 0 }; r[f] += v; out.set(k, r); };
  const mine = Object.values(e.s.orders).filter((o) => o.payerId === me.id && o.customerId !== me.id && o.status === "fulfilled" && (o.kind === "sale" || o.kind === "renewal") && orderCurrency(o) === cur)
    .sort((x, y) => x.updatedAt - y.updatedAt);
  const charges = (e.s.fiado ?? []).filter((x) => x.creditorId === me.id && x.kind === "cargo" && x.assignmentId);
  for (const o of mine) {
    const k = boMonthKey(o.updatedAt);
    add(k, "ventas", paidTotal(o));
    for (const it of o.items) {
      const a = o.assignmentIds.map((id) => e.s.assignments[id]).find((x) => x && x.productId === it.productId);
      const units = o.kind === "renewal" ? 1 : it.qty, periods = o.kind === "renewal" ? it.qty : o.periods ?? 1;
      const sell = a?.rcontrol?.price ?? listPriceMine(e, me, it.productId);
      if (sell === undefined) continue;
      // Si después de esta venta (y antes de la siguiente de ese servicio) quedó fiado, la plata entra por la libreta.
      const next = a ? mine.find((x) => x.updatedAt > o.updatedAt && x.assignmentIds.includes(a.id))?.updatedAt ?? Infinity : Infinity;
      if (a && charges.some((c) => c.assignmentId === a.id && c.at >= o.updatedAt && c.at < next)) continue;
      add(k, "cobros", sell * units * periods);
    }
  }
  for (const x of e.s.fiado ?? []) if (x.creditorId === me.id && x.kind === "pago") add(boMonthKey(x.at), "cobros", x.amount);
  return out;
}

/** Los números de un mes (en curso o cerrado), calculados ahora. */
export function monthNumbers(e: Engine, me: Customer, key: string, cache?: { rent: ReturnType<typeof rentalCostByMonth>; cli: ReturnType<typeof clientsByMonth> }) {
  const rent = cache?.rent ?? rentalCostByMonth(e, me), cli = cache?.cli ?? clientsByMonth(e, me);
  const [y, m] = key.split("-").map(Number);
  const m0 = Date.UTC(y, m - 1, 1) + 4 * 3_600_000, m1 = boMonthStart(m0, 1);
  const cobrosPerfiles = cobrosOf(e, me.id, m0, m1), cobrosClientes = cli.get(key)?.cobros ?? 0;
  const alquileres = rent.get(key)?.cost ?? 0, ventas = cli.get(key)?.ventas ?? 0;
  const cobros = cobrosPerfiles + cobrosClientes;
  return { key, cobros, cobrosPerfiles, cobrosClientes, alquileres, payments: rent.get(key)?.payments ?? 0, ventas, ganancia: cobros - alquileres - ventas };
}

/** Lo que tiene hoy: cuentas alquiladas activas, perfiles anotados, lo que cobra por mes y lo que le deben de perfiles. */
function snapshot(e: Engine, me: Customer) {
  let revenue: Cents = 0, owed: Cents = 0, profiles = 0, accounts = 0;
  for (const a of Object.values(e.s.assignments)) {
    if (a.customerId !== me.id || a.status !== "active") continue;
    if (e.s.products[a.productId]?.kind === "full_account") accounts++;
    for (const s of a.subs ?? []) { profiles++; revenue += s.price ?? 0; owed += subMoney(e, a, s).owed; }
  }
  return { revenue, owed, profiles, accounts };
}

/** Para «Mis ganancias»: el mes en curso, los meses anteriores (los cerrados, como quedaron) y lo que tiene hoy. */
export function rentalsThisMonth(e: Engine, me: Customer, now: number = e.now()) {
  const cache = { rent: rentalCostByMonth(e, me), cli: clientsByMonth(e, me) };
  const cur = monthNumbers(e, me, boMonthKey(now), cache);
  const snap = snapshot(e, me);
  const closed = e.s.rcierres?.[me.id] ?? {};
  const history: (MonthClose & { closed: boolean; label?: string })[] = [];
  for (let i = 0; i < 6; i++) {
    const k = boMonthKey(boMonthStart(now, -i));
    if (closed[k]) { history.push({ ...closed[k], closed: true }); continue; }
    const n = monthNumbers(e, me, k, cache);
    if (i > 0 && !n.cobros && !n.alquileres && !n.ventas) continue;
    history.push({ ...n, perfiles: i === 0 ? snap.profiles : 0, cuentas: i === 0 ? snap.accounts : 0, deuda: 0, closedAt: 0, closed: false });
  }
  // `cost` = alquileres que cubren este mes; `revenue` = lo que cobra por mes por los perfiles anotados (lo esperado).
  return { cost: cur.alquileres, payments: cur.payments, revenue: snap.revenue, owed: snap.owed, profiles: snap.profiles, accounts: snap.accounts, month: cur, history };
}

/**
 * Cierre de mes (tarea diaria): para cada revendedor, guarda los meses que ya terminaron y no estaban guardados (hasta 3
 * para atrás). Idempotente: un mes guardado no se vuelve a tocar.
 */
export function closeMonths(e: Engine, actor: Actor, deudaOf: (resellerId: Id) => Cents): number {
  if (actor.role !== "system") return 0;
  const now = e.now(), curKey = boMonthKey(now);
  let n = 0;
  return e.tx(() => {
    for (const me of Object.values(e.s.customers)) {
      if (me.kind !== "reseller" || isForeign(e, me)) continue;
      const book = ((e.s.rcierres ??= {})[me.id] ??= {});
      let cache: { rent: ReturnType<typeof rentalCostByMonth>; cli: ReturnType<typeof clientsByMonth> } | undefined;
      for (let i = 1; i <= 3; i++) {
        const k = boMonthKey(boMonthStart(now, -i));
        if (k === curKey || book[k]) continue;
        cache ??= { rent: rentalCostByMonth(e, me), cli: clientsByMonth(e, me) };
        const m = monthNumbers(e, me, k, cache);
        if (!m.cobros && !m.alquileres && !m.ventas) continue;
        // La foto (perfiles, cuentas, deuda) es la de hoy: el primer día que corre la tarea después de que terminó el mes.
        const snap = i === 1 ? snapshot(e, me) : { profiles: 0, accounts: 0 };
        book[k] = { key: k, cobros: m.cobros, cobrosPerfiles: m.cobrosPerfiles, cobrosClientes: m.cobrosClientes, alquileres: m.alquileres, ventas: m.ventas, ganancia: m.ganancia,
          perfiles: snap.profiles, cuentas: snap.accounts, deuda: i === 1 ? deudaOf(me.id) : 0, closedAt: now };
        n++;
      }
      if (!Object.keys(book).length) delete e.s.rcierres![me.id];
    }
    return n;
  });
}
