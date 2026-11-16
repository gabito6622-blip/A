/**
 * 💲 Precios del día (16/11/2026). El dueño: «quiero poner el precio de las cuentas nuevas y de la renovación…
 * le voy a poner el precio actualizado del día; en dólares se mantiene a 7 para los extranjeros».
 *
 * - «Nueva» = la lista «revendedor» (lo que paga un revendedor por una cuenta nueva).
 * - «Renovación» = el precio que pasan a tener los alquileres de los revendedores que pagan en Bs. Se aplica con
 *   una vista previa («Aracely: 65 → 69») y quien tenga «📌 precio fijo» conserva el suyo.
 * - No se tocan los clientes finales (su precio es el que acordaron) ni los que pagan en dólares (su lista en US$).
 * - Un alquiler sin precio acordado renueva al precio del día (effectivePrice / renewPriceFor / renew).
 */
import type { Actor, Assignment, Cents, Customer, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { isUsd } from "./usd.js";

/** Precio del día de renovación para quien paga (solo revendedor en Bs y sin precio fijo). */
export function dayRenewFor(e: Engine, payer: Customer | undefined, productId: Id): Cents | undefined {
  if (!payer || payer.kind !== "reseller" || payer.fixedPrice || isUsd(e, payer)) return undefined;
  return e.s.dayPrices?.[productId]?.renew;
}

const rentalProducts = (e: Engine) => Object.values(e.s.products)
  .filter((p) => p.resellersOnly || e.s.priceGroups.revendedor?.prices[p.id] !== undefined && /alquiler/i.test(p.name))
  .sort((a, b) => a.name.localeCompare(b.name));

/** Lo que muestra la tarjeta «💲 Precios del día». */
export function dayPricesView(e: Engine, actor: Actor) {
  authorize(actor, "catalog.manage");
  const rev = e.s.priceGroups.revendedor;
  return {
    products: rentalProducts(e).map((p) => ({ id: p.id, name: p.name, nueva: rev?.prices[p.id] ?? p.price, renov: e.s.dayPrices?.[p.id]?.renew ?? null, at: e.s.dayPrices?.[p.id]?.at ?? null })),
    usdLists: Object.values(e.s.priceGroups).filter((g) => g.currency === "USD").map((g) => g.name),
  };
}

type Input = Record<string, { nueva?: unknown; renov?: unknown }>;
const money = (v: unknown, what: string): Cents | undefined => {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Math.round(Number(v));
  if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) throw new DomainError("VALIDATION", `${what}: precio inválido`);
  return n;
};
function parse(e: Engine, input: unknown) {
  const out: Record<Id, { nueva?: Cents; renov?: Cents }> = {};
  const ok = new Set(rentalProducts(e).map((p) => p.id));
  for (const [pid, v] of Object.entries((input ?? {}) as Input)) {
    if (!ok.has(pid)) throw new DomainError("VALIDATION", "Ese producto no es de alquiler a revendedores");
    const name = e.s.products[pid].name;
    out[pid] = { nueva: money(v?.nueva, name), renov: money(v?.renov, name) };
  }
  return out;
}
const payerOfA = (e: Engine, a: Assignment): Customer | undefined => {
  const c = e.s.customers[a.customerId];
  return c?.resellerId && e.s.customers[c.resellerId] ? e.s.customers[c.resellerId] : c;
};

/** Quién cambia de precio si se aplica: por revendedor, de cuánto a cuánto. No cambia nada. */
export function dayPricesPreview(e: Engine, actor: Actor, input: unknown, current: (a: Assignment) => Cents) {
  authorize(actor, "catalog.manage");
  const p = parse(e, input);
  const by = new Map<Id, { payerId: Id; name: string; fixed: boolean; items: { id: Id; productId: Id; from: Cents; to: Cents }[] }>();
  let usd = 0, finales = 0;
  for (const a of Object.values(e.s.assignments)) {
    const to = a.status === "active" ? p[a.productId]?.renov : undefined;
    if (to === undefined) continue;
    const payer = payerOfA(e, a);
    if (!payer) continue;
    if (payer.kind !== "reseller") { finales++; continue; }
    if (isUsd(e, payer)) { usd++; continue; }
    const g = by.get(payer.id) ?? { payerId: payer.id, name: payer.name, fixed: !!payer.fixedPrice, items: [] };
    g.items.push({ id: a.id, productId: a.productId, from: current(a), to });
    by.set(payer.id, g);
  }
  const payers = [...by.values()].map((g) => ({ ...g, changes: g.items.filter((x) => x.from !== x.to).length }))
    .sort((x, y) => Number(y.changes > 0) - Number(x.changes > 0) || x.name.localeCompare(y.name));
  return { payers, skipped: { usd, finales }, prices: p };
}

/** Aplica los precios del día. `keep`: revendedores que conservan su precio (📌 precio fijo). */
export function applyDayPrices(e: Engine, actor: Actor, input: unknown, keep: unknown, current: (a: Assignment) => Cents) {
  authorize(actor, "catalog.manage");
  const keepSet = new Set(Array.isArray(keep) ? keep.map(String) : []);
  return e.tx(() => {
    const pv = dayPricesPreview(e, actor, input, current);
    const rev = (e.s.priceGroups.revendedor ??= { id: "revendedor", name: "Revendedor", prices: {} });
    for (const [pid, v] of Object.entries(pv.prices)) {
      if (v.nueva !== undefined) rev.prices[pid] = v.nueva;
      if (v.renov !== undefined) (e.s.dayPrices ??= {})[pid] = { renew: v.renov, at: e.now(), by: actor.id };
    }
    const changed: { id: Id; from: Cents; to: Cents }[] = [];
    for (const g of pv.payers) {
      const c = e.s.customers[g.payerId];
      if (keepSet.has(g.payerId)) c.fixedPrice = true; else delete c.fixedPrice;
      if (keepSet.has(g.payerId)) continue;
      for (const x of g.items) {
        if (x.from === x.to && e.s.assignments[x.id].control?.price === x.to) continue;
        const a = e.s.assignments[x.id];
        a.control = { ...(a.control ?? {}), price: x.to };
        changed.push({ id: x.id, from: x.from, to: x.to });
      }
    }
    e.audit(actor, "prices.day", "product", Object.keys(pv.prices).join(","), {
      prices: pv.prices, kept: [...keepSet], changed: changed.slice(0, 400),
    });
    return { changed: changed.filter((x) => x.from !== x.to).length, kept: pv.payers.filter((g) => keepSet.has(g.payerId)).length, skipped: pv.skipped };
  });
}
