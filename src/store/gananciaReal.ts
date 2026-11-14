// «Mis ganancias» con sus alquileres de la tienda (revisión de 3 meses, 14/11/2026).
//
// Antes «Mis ganancias» decía «ganaste Bs 15» (40 que cobró por un Netflix − 25 que le costó) aunque ese mes le
// pagó Bs 124 a la tienda por sus cuentas completas y cobró Bs 80 por los perfiles: en realidad perdió Bs 29.
// Ahora suma, en la misma pantalla: lo que pagó este mes por SUS alquileres (pedidos entregados para él mismo) y lo
// que cobra por mes por los perfiles que reparte de ellos (su cuaderno). Ganancia real = cobra − le cuesta.
// Solo lee lo suyo. Un revendedor de otro país (dos monedas) no lo resta: se muestra por separado.
import type { Cents, Customer } from "./types.js";
import type { Engine } from "./engine.js";
import { boMonthStart } from "./time.js";
import { orderCurrency, paidTotal, walletCurrency } from "./usd.js";

export function rentalsThisMonth(e: Engine, me: Customer, now: number = e.now()) {
  const m0 = boMonthStart(now), cur = walletCurrency(e, me);
  let cost: Cents = 0, count = 0;
  for (const o of Object.values(e.s.orders)) {
    if (o.status !== "fulfilled" || (o.kind !== "sale" && o.kind !== "renewal") || o.trial || o.channel === "import") continue;
    if ((o.payerId ?? o.customerId) !== me.id || o.customerId !== me.id || o.updatedAt < m0 || o.updatedAt > now || orderCurrency(o) !== cur) continue;
    cost += paidTotal(o); count++;
  }
  // Lo que cobra por mes por los perfiles que reparte de sus cuentas completas activas (su cuaderno).
  let revenue: Cents = 0, owed: Cents = 0, profiles = 0;
  for (const a of Object.values(e.s.assignments)) {
    if (a.customerId !== me.id || a.status !== "active") continue;
    for (const s of a.subs ?? []) { profiles++; revenue += s.price ?? 0; if (s.pay !== "pagado") owed += s.price ?? 0; }
  }
  return { cost, payments: count, revenue, owed, profiles };
}
