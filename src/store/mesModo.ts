// ¿Cómo cuenta un mes cada quien? (pedido del dueño, 14/11/2026: «Sería mejor que cada quien decida, porque yo doy de
// mes a mes, pero otros revendedores sí hacen 30 días»).
//  - La tienda (lo que vende y renueva: clientes finales y alquileres a revendedores, vistas previas, link de renovar y
//    textos): `settings.monthMode`. Sin valor = "calendar" (del 13/12 al 13/01), lo que eligió el dueño.
//  - Cada revendedor, para lo que ÉL anota de SUS clientes (perfiles repartidos del cuaderno, cuentas propias):
//    `customer.monthMode`. Sin valor = "days" (30 días justos, como siempre: a los que ya trabajan así no les cambia nada).
// El ajuste de uno nunca toca a otro ni a la tienda.
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { MONTH_MODES, addPeriods, periodText, subPeriods, type MonthMode } from "./time.js";

/** Cómo cuenta un mes la tienda. */
export const storeMonthMode = (e: Engine): MonthMode => e.s.settings.monthMode ?? "calendar";

/** Cómo cuenta un mes este revendedor para SUS clientes. */
export const resellerMonthMode = (e: Engine, resellerId: Id | undefined): MonthMode => (resellerId ? e.s.customers[resellerId]?.monthMode : undefined) ?? "days";

/** Valida lo que llega de un formulario ("calendar" o "days"). */
export function parseMonthMode(v: unknown): MonthMode {
  if (typeof v !== "string" || !MONTH_MODES.includes(v as MonthMode)) throw new DomainError("VALIDATION", "Elegí cómo contás un mes: del mismo día al mismo día, o 30 días");
  return v as MonthMode;
}

function resellerOf(e: Engine, actor: Actor) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const c = e.get("customers", actor.customerId);
  if (c.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return c;
}

/** Lo que ve el revendedor en su ajuste. */
export function myMonthMode(e: Engine, actor: Actor): { mode: MonthMode } {
  const c = resellerOf(e, actor);
  return { mode: resellerMonthMode(e, c.id) };
}

/** El revendedor elige cómo cuenta un mes para SUS clientes. Solo el suyo. */
export function setMyMonthMode(e: Engine, actor: Actor, raw: { mode?: unknown }): { mode: MonthMode } {
  const c = resellerOf(e, actor);
  const mode = parseMonthMode(raw?.mode);
  return e.tx(() => {
    const cur = e.s.customers[c.id];
    // "days" es lo de siempre para un revendedor: no se guarda nada.
    if (mode === "days") delete cur.monthMode; else cur.monthMode = mode;
    e.audit(actor, "reseller.month_mode", "customer", cur.id, { mode });
    return { mode };
  });
}

/** Un período (o `periods`) de la tienda desde `from`, con el modo de la tienda. */
export const storeAddPeriods = (e: Engine, from: number, durationDays: number, periods = 1): number => addPeriods(from, durationDays, periods, storeMonthMode(e));
/** Dónde empezó el período de la tienda que termina en `to`. */
export const storeSubPeriods = (e: Engine, to: number, durationDays: number, periods = 1): number => subPeriods(to, durationDays, periods, storeMonthMode(e));
/** «1 mes» o «30 días», según cómo cuenta la tienda. */
export const storePeriodText = (e: Engine, durationDays: number, periods = 1): string => periodText(durationDays, periods, storeMonthMode(e));
