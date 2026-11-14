// Arranque del revendedor nuevo (revisión de 3 meses, 15/11/2026): primeros pasos que se tachan solos,
// la dirección de su página sacada del nombre de su TIENDA y las plataformas reales de su link de códigos.
// Solo lee lo del propio revendedor (sesión → actor); nada de otro revendedor.
import type { Actor, Customer, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { isIndependent } from "./catalog.js";
import { balance } from "./wallet.js";
import { RESERVED, pageAllowed, slugify } from "./resellerShop.js";

function me(e: Engine, actor: Actor): Customer {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const c = e.get("customers", actor.customerId);
  if (c.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return c;
}

/** ¿Ya vendió algo? Una compra a la tienda (para él o un cliente), una venta de sus cuentas propias o un perfil repartido. */
function hasSold(e: Engine, c: Customer): boolean {
  for (const o of Object.values(e.s.orders)) if (o.kind !== "topup" && o.status === "fulfilled" && (o.payerId ?? o.customerId) === c.id) return true;
  if ((e.s.ownStock?.[c.id]?.sales.length ?? 0) > 0) return true;
  for (const a of Object.values(e.s.assignments)) if (a.customerId === c.id && (a.subs?.length ?? 0) > 0) return true;
  return false;
}

/**
 * Primeros pasos del revendedor: 1) recargá saldo (solo si le compra a la tienda), 2) primera venta, 3) tu página.
 * `page`: "ask" = no tiene permiso (pedísela a la tienda) · "build" = puede armarla · "done" = publicada.
 */
export function firstSteps(e: Engine, actor: Actor) {
  const c = me(e, actor);
  const indep = isIndependent(c);
  const sale = hasSold(e, c);
  const topup = !indep && (sale || balance(e, c.id) > 0 || Object.values(e.s.orders).some((o) => o.kind === "topup" && o.status === "fulfilled" && o.customerId === c.id));
  const allowed = pageAllowed(e, c) && e.s.settings.resellerShops !== false;
  const page = !allowed ? "ask" as const : c.shop?.enabled ? "done" as const : "build" as const;
  return { independent: indep, buys: !indep, topup, sale, page, pageSaved: !!c.shop };
}

/** Propone una dirección libre a partir del nombre de la tienda («Ana TV» → ana-tv; si está usada, ana-tv-2). */
export function suggestSlug(e: Engine, actor: Actor, text: unknown) {
  const c = me(e, actor);
  if (!pageAllowed(e, c)) throw new DomainError("FORBIDDEN", "Tu plan es solo panel: la tienda todavía no te habilitó tu página propia.");
  let base = slugify(String(text ?? "")) || slugify(c.name) || "tienda";
  if (base.length < 3 || RESERVED.has(base)) base = `tienda-${base}`.slice(0, 30).replace(/-+$/, "");
  const taken = (s: string) => Object.values(e.s.customers).some((x) => x.id !== c.id && x.shop?.slug === s);
  let slug = base;
  for (let i = 2; taken(slug); i++) slug = `${base.slice(0, 26).replace(/-+$/, "")}-${i}`;
  return { slug, base, free: slug === base, current: c.shop?.slug ?? null };
}

/** «Netflix 1 perfil» → Netflix, «Max (HBO)» → Max, «Disney+ perfil» → Disney+. */
export function platformOf(name: string): string {
  const n = name.replace(/\(.*?\)/g, " ").replace(/\s+/g, " ").trim();
  const known = ["Netflix", "Disney+", "Max", "HBO Max", "Prime Video", "Amazon Prime", "Spotify", "YouTube", "Crunchyroll", "Paramount+", "Apple TV", "Star+", "Vix", "Canva", "ChatGPT", "Deezer", "Tidal", "Flujo TV", "Magis TV"];
  const low = n.toLowerCase();
  const hit = known.find((k) => low.startsWith(k.toLowerCase()));
  if (hit) return hit === "HBO Max" ? "Max" : hit;
  return n.split(" ")[0] ?? n;
}

/** Plataformas de las cuentas activas del dueño del link (y de sus clientes, si es revendedor). Sin correos ni claves. */
export function codePlatforms(e: Engine, customerId: Id): string[] {
  const out = new Set<string>();
  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active" || (a.customerId !== customerId && e.s.customers[a.customerId]?.resellerId !== customerId)) continue;
    const name = e.s.products[e.s.slots[a.slotId]?.productId ?? a.productId]?.name;
    if (name) out.add(platformOf(name));
  }
  return [...out].sort();
}
