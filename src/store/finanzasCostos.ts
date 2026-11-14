// Costo de las cuentas por mes (arreglos de Finanzas, 14/11/2026).
//
// Antes solo el mes en curso restaba el costo estimado de las cuentas: los meses cerrados salían con
// «te quedó» = todo lo que entró (100 % de ganancia) y la comparativa con el mes anterior mezclaba un
// mes con costos y otro sin. Ahora TODOS los meses usan la misma regla:
//  - una cuenta cuenta en un mes si ya estaba cargada antes de que termine ese mes, no venció con el
//    proveedor antes del día 1 y no estaba retirada al terminar el mes (las retiradas, según la auditoría);
//  - vale su costo mensual (si se paga en dólares, a la tasa de hoy: es un estimado);
//  - si ese mes ya anotaste un gasto de esa cuenta («Ya la pagué» / «Pagué la renovación»), no se cuenta de nuevo;
//  - si ese mes no había ninguna cuenta con costo ni gastos de cuentas, el mes queda marcado «sin costos
//    anotados» (`sinCostos`) en vez de mostrar una ganancia del 100 % que no es real.
// 15/11/2026 (equipo 1, «la plata coincide»):
//  - un pago por VARIOS meses («Pagué la renovación» con 3 meses, o «Ya la pagué» de una cuenta que vence en 3 meses)
//    cubre esos meses: la cuenta no se vuelve a estimar en ellos (antes salía Bs 210 + 70 + 70);
//  - una devolución del proveedor no cuenta como «ya la pagué»;
//  - una cuenta en dólares se estima con la ÚLTIMA tasa que anotaste al pagarla (la de tu tarjeta), no la del USDT.
import type { Account, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { boMonthKey } from "./time.js";
import { rateNow, usdToBs } from "./usd.js";
import { coversMonth } from "./gastos.js";

/** La última tasa que anotaste al pagar esa cuenta en dólares (si nunca la anotaste, `undefined`). */
export function lastPaidRate(e: Engine, accountId: Id | undefined): number | undefined {
  if (!accountId) return undefined;
  let best: { at: number; rate: number } | undefined;
  for (const x of e.s.expenses ?? []) if (x.accountId === accountId && !x.refund && x.usd && x.rate && (!best || x.at >= best.at)) best = { at: x.at, rate: x.rate };
  return best?.rate;
}

/**
 * Lo que cuesta una cuenta por mes, en Bs. Si la pagás en dólares con la tarjeta (`costUsd`), vale lo
 * que son esos dólares a la última tasa que anotaste al pagarla (si no hay, la de hoy); si no, el costo en Bs.
 */
export function accountCostBs(e: Engine, a: Pick<Account, "cost" | "costUsd"> & { id?: Id }): Cents {
  const r = a.costUsd ? lastPaidRate(e, a.id) ?? rateNow(e) : 0;
  return a.costUsd && r ? usdToBs(a.costUsd, r) : a.cost;
}

/** Inicio y fin (excluido) de un mes «AAAA-MM» de Bolivia. */
export function monthBounds(key: string): { start: number; end: number } {
  const [y, m] = key.split("-").map(Number);
  return { start: Date.UTC(y, m - 1, 1, 4), end: Date.UTC(y, m, 1, 4) };
}

/** Cuándo se retiró cada cuenta (la última «account.retire» de la auditoría). */
function retiredAt(e: Engine): Map<Id, number> {
  const out = new Map<Id, number>();
  for (const ev of e.s.audit ?? []) if (ev.action === "account.retire" && ev.entity === "account") out.set(ev.entityId, ev.at);
  return out;
}

export interface CostEstimate {
  /** Costo estimado de las cuentas de ese mes que no anotaste como gasto. */
  amount: Cents;
  /** Cuántas cuentas entran en ese estimado. */
  count: number;
  /** Ese mes no había cuentas con costo ni gastos de cuentas: no se puede decir cuánto ganaste de verdad. */
  sinCostos: boolean;
  /** Cuánto se estimó de cada cuenta (para «Proveedores»). */
  byAccount: { accountId: Id; amount: Cents }[];
}

/** Costo ESTIMADO de las cuentas de un mes («AAAA-MM»), con la misma regla para el mes en curso y los cerrados. */
export function accountsEstimateMonth(e: Engine, key: string, now: number = e.now()): CostEstimate {
  const { start, end } = monthBounds(key);
  const delMes = (e.s.expenses ?? []).filter((x) => x.accountId && boMonthKey(x.at) === key);
  // Pagada ese mes: un gasto de ese mes o un pago anterior por varios meses que lo cubre.
  const paid = new Set((e.s.expenses ?? []).filter((x) => coversMonth(x, key)).map((x) => x.accountId));
  const retired = retiredAt(e);
  let amount = 0, count = 0, conCosto = 0;
  const byAccount: { accountId: Id; amount: Cents }[] = [];
  for (const a of Object.values(e.s.accounts)) {
    if (a.createdAt >= end || a.createdAt > now || a.supplierExpiresAt < start) continue;
    // Una cuenta retirada cuesta en los meses en que estuvo viva, también el mes en que se retiró (15/11/2026: ese
    // mes ya la habías pagado; antes desaparecía del costo y el mes salía con más ganancia).
    if (a.status === "retired") { const r = retired.get(a.id); if (r === undefined || r < start) continue; }
    const cost = accountCostBs(e, a);
    if (!(cost > 0)) continue;
    conCosto++;
    if (paid.has(a.id)) continue;
    amount += cost; count++;
    byAccount.push({ accountId: a.id, amount: cost });
  }
  return { amount, count, sinCostos: conCosto === 0 && delMes.length === 0, byAccount };
}
