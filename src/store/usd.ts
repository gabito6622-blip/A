// Lista de precios en dólares (revendedores de Panamá y Paraguay que pagan en USDT).
//
// Regla de plata (docs/DECISIONES: "saldo en dólares"):
//  - Una lista con `currency: "USD"` tiene sus precios en centavos de dólar (US$ 3,50 = 350).
//  - Un cliente en esa lista ("cliente en dólares") ve, compra, renueva y guarda su saldo en US$.
//    Su libro de saldo va en centavos de dólar: recarga 20 USDT → +2000; compra US$ 7 → -700.
//  - Cada pedido suyo guarda lo cobrado en US$ (`order.usd`, y `item.usd` por unidad) y además
//    `order.total` / `item.unitPrice` en Bs con la tasa de ESE momento (`usdtQuote.rate`). Así todo lo
//    del dueño (Finanzas, Dashboard, Cómo van, Que vuelvan) sigue sumando solo Bs.
//  - Nunca se suman dos monedas en una cifra: los saldos en US$ se convierten con la tasa de hoy o
//    se muestran aparte.
// 1 USDT = 1 US$. La tasa `settings.usdt.rate` = cuántos Bs vale 1 USDT (la cambia el dueño).
import type { Cents, Customer, Id, Order, OrderItem } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";

export type WalletCurrency = "BOB" | "USD";

export const USD = { code: "USD" as const, symbol: "US$", decimals: 2 as const };
export const NO_RATE = "La tienda todavía no tiene la tasa del dólar";

/** Moneda de una lista de precios ("final" y "revendedor" siempre en Bs). */
export const groupCurrency = (e: Engine, groupId: Id | undefined): WalletCurrency =>
  groupId && e.s.priceGroups[groupId]?.currency === "USD" ? "USD" : "BOB";

/** Moneda de compra y de saldo de un cliente: la de su lista de precios. */
export function walletCurrency(e: Engine, c: Customer | Id | undefined): WalletCurrency {
  const cu = typeof c === "string" ? e.s.customers[c] : c;
  return groupCurrency(e, cu?.priceGroupId);
}
export const isUsd = (e: Engine, c: Customer | Id | undefined) => walletCurrency(e, c) === "USD";

/** Tasa de hoy (Bs por 1 USDT) o 0 si no hay. */
export const rateNow = (e: Engine): number => {
  const r = Number(e.s.settings.usdt?.rate ?? 0);
  return Number.isFinite(r) && r > 0 ? r : 0;
};

/** Tasa de hoy o error claro: un cliente en dólares no compra ni recarga sin tasa. */
export function requireRate(e: Engine): number {
  const r = rateNow(e);
  if (!r) throw new DomainError("VALIDATION", NO_RATE);
  return r;
}

/** Centavos de dólar → centavos de Bs, redondeado al centavo (aritmética entera: 700 × 9,85 = 6895). */
export function usdToBs(usdCents: Cents, rate: number): Cents {
  const r4 = Math.round(rate * 10_000);
  return Math.round((usdCents * r4) / 10_000);
}

/**
 * Centavos de Bs → centavos de dólar. `up` para cobrarle al cliente (la tienda nunca pierde un
 * centavo por redondeo), `down` para acreditarle.
 */
export function bsToUsd(bsCents: Cents, rate: number, dir: "up" | "down"): Cents {
  const r4 = Math.round(rate * 10_000), a = Math.round(bsCents) * 10_000;
  // División entera exacta (sin errores de coma flotante): cociente y resto.
  const rest = a % r4, q = (a - rest) / r4;
  return dir === "up" && rest > 0 ? q + 1 : q;
}

/**
 * Un monto de la tienda en Bs (alquiler de la página, premio por referido) llevado a la moneda del
 * saldo de ese cliente. En Bs, igual; en dólares, con la tasa de hoy (sin tasa: error claro).
 */
export function bsToWallet(e: Engine, customerId: Id, bsCents: Cents, dir: "up" | "down"): Cents {
  if (!isUsd(e, customerId)) return bsCents;
  return bsToUsd(bsCents, requireRate(e), dir);
}

/** Moneda en la que se cobró un pedido (lo que se movió en el saldo de quien pagó). */
export const orderCurrency = (o: Order): WalletCurrency => (o.usd !== undefined ? "USD" : "BOB");
/** Lo que pagó quien pagó, en SU moneda (US$ si fue en dólares; si no, Bs). */
export const paidTotal = (o: Order): Cents => o.usd ?? o.total;
/** Precio unitario de un ítem en la moneda de quien pagó. */
export const paidUnit = (it: OrderItem): Cents => it.usd ?? it.unitPrice;

/**
 * Lo que se le devuelve al saldo de quien pagó un pedido. Si su saldo sigue en la moneda del pedido,
 * va igual; si cambió de lista (pasó de Bs a US$ o al revés), se convierte con la tasa de hoy.
 */
export function refundToWallet(e: Engine, customerId: Id, o: Order): Cents {
  const from = orderCurrency(o), to = walletCurrency(e, customerId);
  const amt = paidTotal(o);
  if (from === to) return amt;
  const r = requireRate(e);
  return to === "USD" ? bsToUsd(o.total, r, "down") : usdToBs(amt, r);
}

/** Pedidos de un cliente que todavía pueden mover plata (pagos por revisar o recargas sin aprobar). */
export const pendingOrdersOf = (e: Engine, customerId: Id) => Object.values(e.s.orders)
  .filter((o) => (o.payerId === customerId || o.customerId === customerId) && (o.status === "awaiting_payment" || o.status === "payment_review"));

/** Saldos de varios clientes en una sola cifra en Bs: los de dólares se convierten con la tasa de hoy. */
export function sumBalancesBs(e: Engine, ids: Id[], balanceOf: (id: Id) => Cents): { bs: Cents; usd: Cents; usdAsBs: Cents; rate: number } {
  let bs = 0, usd = 0;
  for (const id of ids) {
    const b = balanceOf(id);
    if (isUsd(e, id)) usd += b; else bs += b;
  }
  const rate = rateNow(e);
  const usdAsBs = rate ? usdToBs(usd, rate) : 0;
  return { bs, usd, usdAsBs, rate };
}

/** Moneda que el navegador usa para mostrar la plata de este cliente (`/api/me`). */
export function currencyView(e: Engine, c: Customer | undefined) {
  if (isUsd(e, c)) return { code: "USD" as const, symbol: USD.symbol, decimals: 2 as const, rate: rateNow(e) || null };
  return { code: "BOB" as const, symbol: e.s.settings.currencySymbol || "Bs", decimals: 2 as const, rate: null };
}
