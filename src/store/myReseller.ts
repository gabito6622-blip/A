// El cliente de un revendedor renueva con SU revendedor, no directo con la tienda (decisión del dueño, 11/11):
// así los revendedores confían en que la tienda no les saca la clientela, y el cliente no ve dos precios.
import type { Customer, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { findBySlug } from "./resellerShop.js";

export interface MyReseller { name: string; whatsapp: string; page: string | null }

/** Revendedor que atiende a este cliente (si lo tiene y está activo como revendedor). */
export function resellerOf(e: Engine, customerId: Id): Customer | undefined {
  const c = e.s.customers[customerId];
  const r = c?.resellerId ? e.s.customers[c.resellerId] : undefined;
  return r && r.kind === "reseller" ? r : undefined;
}

/** Cómo contactarlo: nombre de su tienda, su WhatsApp (solo dígitos) y su página si está publicada. */
export function resellerContact(e: Engine, customerId: Id): MyReseller | undefined {
  const r = resellerOf(e, customerId);
  if (!r) return undefined;
  const shop = r.shop;
  const page = shop?.slug && findBySlug(e, shop.slug) === r ? `/r/${shop.slug}` : null;
  return { name: (page && shop?.title) || r.name, whatsapp: (shop?.whatsapp || r.phone || "").replace(/\D/g, ""), page };
}
