// Lista de precios de los revendedores (revisión de 3 meses, 14/11/2026).
//
// Antes, al aprobar una solicitud el revendedor quedaba en la lista «revendedor» aunque estuviera vacía (los demás
// estaban en otra lista con precios): le cobraron Bs 90 por un Disney que a los demás les sale Bs 69, sin aviso.
// Ahora: al aprobar se elige la lista (viene marcada la que usan los demás revendedores) y nunca queda una vacía si hay
// otra con precios; y al vender, si su lista no tiene precio para ese producto, se avisa (`missingListPrices`).
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

const count = (e: Engine, gid: Id) => Object.keys(e.s.priceGroups[gid]?.prices ?? {}).length;

/** La lista que conviene para un revendedor nuevo: la que más usan los revendedores (con precios); si no, la que más precios tiene. */
export function suggestedResellerGroup(e: Engine): Id {
  const uses = new Map<Id, number>();
  for (const c of Object.values(e.s.customers)) if (c.kind === "reseller" && count(e, c.priceGroupId) > 0 && e.s.priceGroups[c.priceGroupId]?.currency !== "USD") uses.set(c.priceGroupId, (uses.get(c.priceGroupId) ?? 0) + 1);
  const best = [...uses].sort((a, b) => b[1] - a[1] || count(e, b[0]) - count(e, a[0]))[0]?.[0];
  if (best) return best;
  const any = Object.values(e.s.priceGroups).filter((g) => g.id !== "final" && g.currency !== "USD" && count(e, g.id) > 0).sort((a, b) => count(e, b.id) - count(e, a.id))[0];
  return any?.id ?? "revendedor";
}

/** Las listas para elegir al aprobar (sin las de dólares: esas se ponen desde la ficha). */
export function approveOptions(e: Engine, actor: Actor) {
  authorize(actor, "reseller.manage");
  const users = (gid: Id) => Object.values(e.s.customers).filter((c) => c.kind === "reseller" && c.priceGroupId === gid).length;
  const groups = Object.values(e.s.priceGroups).filter((g) => g.id !== "final" && g.currency !== "USD")
    .map((g) => ({ id: g.id, name: g.name, prices: count(e, g.id), resellers: users(g.id) }))
    .sort((a, b) => b.resellers - a.resellers || b.prices - a.prices);
  if (!groups.some((g) => g.id === "revendedor")) groups.push({ id: "revendedor", name: "Revendedor", prices: 0, resellers: 0 });
  return { groups, suggested: suggestedResellerGroup(e) };
}

/** Valida la lista elegida al aprobar: tiene que existir y no estar vacía si hay otra con precios. Devuelve el id a usar. */
export function pickResellerGroup(e: Engine, raw: unknown): Id {
  const gid = raw === undefined || raw === null || raw === "" ? suggestedResellerGroup(e) : String(raw);
  if (gid !== "revendedor" && !e.s.priceGroups[gid]) throw new DomainError("NOT_FOUND", "Esa lista de precios no existe");
  if (e.s.priceGroups[gid]?.currency === "USD") throw new DomainError("VALIDATION", "Las listas en dólares se ponen desde su ficha, después de aprobar");
  const other = suggestedResellerGroup(e);
  if (count(e, gid) === 0 && count(e, other) > 0) throw new DomainError("VALIDATION", `Esa lista no tiene precios: le cobrarías el precio de la tienda. Elegí «${e.s.priceGroups[other]?.name ?? other}».`);
  return gid;
}

/** Productos que un revendedor compra sin precio en su lista (se le cobraría el precio de la tienda). */
export function missingListPrices(e: Engine, payerId: Id, productIds: Id[]) {
  const c = e.s.customers[payerId];
  if (!c || c.kind !== "reseller") return [];
  const g = e.s.priceGroups[c.priceGroupId];
  return [...new Set(productIds)].filter((pid) => g?.prices[pid] === undefined && e.s.products[pid])
    .map((pid) => ({ productId: pid, name: e.s.products[pid].name, price: e.s.products[pid].price, list: g?.name ?? c.priceGroupId }));
}
