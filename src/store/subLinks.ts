// Link de cobro: cada perfil repartido puede tener una página propia (/c/<token>) que el revendedor le
// manda a SU cliente: cuándo vence, cuánto es, el QR del revendedor y un botón "Ya pagué" a su WhatsApp.
// Solo el revendedor dueño del alquiler crea o cambia el link. La página pública muestra lo mínimo: nada
// de la cuenta (correo, contraseña, PIN), ni costos, ni el teléfono del cliente, ni otros perfiles, ni ids.
import { randomBytes } from "node:crypto";
import type { Actor, Assignment, Id, SubRental } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { me, rental } from "./subRentals.js";
import { linkQr as ownLinkQr, linkView as ownLinkView } from "./ownStock.js";
import { localeOf } from "./country.js";
import { codesMode } from "./codigosSolos.js";

/** Mismo texto para todo lo que no sirve (no existe, cambiado, borrado): no dice cuál fue el motivo. */
export const LINK_GONE = "Este link ya no sirve. Pedile uno nuevo a quien te vendió.";
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
/** 24 bytes al azar = 192 bits, en base64url (32 letras). */
const newToken = () => randomBytes(24).toString("base64url");

/**
 * Índice token → [asignación, perfil] en memoria, uno por motor.
 * Por qué así: el link se abre muchas veces y desde afuera (también con tokens inventados), y recorrer
 * todas las asignaciones en cada visita crece con la tienda. El índice se arma una vez recorriendo las
 * asignaciones que tienen perfiles y se vuelve a armar solo si cambia el objeto del estado (un rollback
 * reemplaza `e.s`), así nunca queda con datos de una transacción deshecha. Cada acierto se vuelve a
 * comprobar contra el estado real (el perfil sigue ahí, con ese mismo token), así un link revocado o
 * borrado no sirve aunque el índice lo tenga todavía. Un token que no está no provoca recorrido.
 */
const indexes = new WeakMap<Engine, { state: object; map: Map<string, [Id, Id]> }>();
function index(e: Engine): Map<string, [Id, Id]> {
  let x = indexes.get(e);
  if (!x || x.state !== e.s) {
    const map = new Map<string, [Id, Id]>();
    for (const a of Object.values(e.s.assignments)) for (const s of a.subs ?? []) if (s.link) map.set(s.link.token, [a.id, s.id]);
    x = { state: e.s, map };
    indexes.set(e, x);
  }
  return x.map;
}

function ownSub(e: Engine, actor: Actor, assignmentId: Id, subId: Id) {
  const c = me(e, actor);
  const a = rental(e, c.id, assignmentId);
  const s = (a.subs ?? []).find((x) => x.id === subId);
  if (!s) throw new DomainError("NOT_FOUND", "Ese perfil no existe");
  return { c, a, s };
}

/** Crea el link de cobro de un perfil repartido (o devuelve el que ya tiene). */
export function subLink(e: Engine, actor: Actor, assignmentId: Id, subId: Id) {
  return e.tx(() => {
    const { c, a, s } = ownSub(e, actor, assignmentId, subId);
    if (s.link) return { token: s.link.token, created: false };
    let token = newToken();
    while (index(e).has(token)) token = newToken();
    s.link = { token, by: c.id, at: e.now() };
    index(e).set(token, [a.id, s.id]);
    e.audit(actor, "reseller.sub_link", "assignment", a.id, { sub: s.id });
    return { token, created: true };
  });
}

/** Invalida el link: deja de servir al instante. Un subLink después crea otro distinto. */
export function revokeSubLink(e: Engine, actor: Actor, assignmentId: Id, subId: Id) {
  return e.tx(() => {
    const { a, s } = ownSub(e, actor, assignmentId, subId);
    if (!s.link) return { ok: true as const, revoked: false };
    index(e).delete(s.link.token);
    delete s.link;
    e.audit(actor, "reseller.sub_link_revoke", "assignment", a.id, { sub: s.id });
    return { ok: true as const, revoked: true };
  });
}

/** "Disney+ (alquiler revendedores)" → "Disney+": sin aclaraciones internas de la tienda. */
export function commercialName(name: string): string {
  const n = String(name ?? "")
    .replace(/\s*[([][^)\]]*[)\]]/g, " ")
    .replace(/\bcuentas?\s+complet[ao]s?\b/gi, " ")
    .replace(/\b(alquiler(es)?|revendedor(es)?|reventa|mayorista|x\s*mayor|al\s+por\s+mayor|interno|interna|uso\s+interno)\b/gi, " ")
    .replace(/\s{2,}/g, " ")
    .replace(/^[\s\-–—|·:,/]+|[\s\-–—|·:,/]+$/g, "")
    .trim();
  return n || "Tu servicio";
}

/** Resuelve un token a su perfil vigente. Cualquier problema → el mismo 404 genérico. */
function resolve(e: Engine, token: unknown): { a: Assignment; s: SubRental } {
  const t = typeof token === "string" ? token : "";
  const hit = TOKEN_RE.test(t) ? index(e).get(t) : undefined;
  const a = hit ? e.s.assignments[hit[0]] : undefined;
  const s = a?.subs?.find((x) => x.id === hit![1]);
  const c = a ? e.s.customers[a.customerId] : undefined;
  // El alquiler sigue activo, es una cuenta completa y es del mismo revendedor que creó el link
  // (si la tienda le pasó la cuenta a otro, el link muere: no se muestran datos con el nombre de otro).
  if (!a || !s || s.link?.token !== t || s.link.by !== a.customerId || a.status !== "active"
    || c?.kind !== "reseller" || e.s.products[a.productId]?.kind !== "full_account") throw new DomainError("NOT_FOUND", LINK_GONE);
  return { a, s };
}

const usableQr = (e: Engine, customerId: Id) => {
  const sh = e.s.customers[customerId]?.shop;
  return sh && !sh.blocked ? sh.qrFileRef : undefined;
};

/** Lo que ve el cliente del revendedor. Solo estos campos (lista cerrada). La ruta suma solo `alerts` (booleano: alguien activó los avisos de este link; ver expiryPush.ts). */
export function publicView(e: Engine, token: unknown) {
  // El mismo /c/<token> sirve para los clientes de "Mis cuentas propias" (misma lista cerrada de campos).
  const own = ownLinkView(e, token);
  if (own) return { ...own, codes: codesMode(e, token) };
  const { a, s } = resolve(e, token);
  const c = e.s.customers[a.customerId];
  const seller = (c.shop?.title || c.name || "").trim();
  return {
    name: s.name.trim().split(/\s+/)[0] ?? "",
    label: s.label,
    product: commercialName(e.s.products[a.productId]?.name ?? ""),
    expiresAt: s.expiresAt,
    price: s.price ?? null,
    pay: s.pay,
    seller,
    sellerWhatsapp: String(c.shop?.whatsapp || c.phone || "").replace(/\D/g, ""),
    hasQr: !!usableQr(e, c.id),
    // Solo si el PRODUCTO tiene logo (se pide por /api/cobro/<token>/logo, sin ids): nada del cliente.
    hasLogo: !!productLogo(e, a.productId),
    // Lo que le cobra a su cliente va en la moneda del revendedor (Bs si es de Bolivia).
    currency: localeOf(e, c).symbol,
    // "📩 Ver mi código de acceso" (codigosSolos.ts): "self" | "ask" | "off". Nada de la cuenta.
    codes: codesMode(e, token),
  };
}

/** Perfil vigente de un link, o undefined (para codigosSolos.ts; mismas reglas que la página). */
export function subLinkTarget(e: Engine, token: unknown): { a: Assignment; s: SubRental } | undefined {
  try { return resolve(e, token); } catch { return undefined; }
}

/** Archivo del QR del revendedor de ese link (aunque su página pública esté apagada), o undefined. */
export function publicQr(e: Engine, token: unknown): string | undefined {
  const own = ownLinkQr(e, token);
  if (own !== null) return own;
  const { a } = resolve(e, token);
  return usableQr(e, a.customerId);
}

/**
 * Logo del producto: el suyo, o el de la app del mismo nombre comercial ("Disney+ (alquiler revendedores)"
 * casi nunca tiene imagen propia y usa la de "Disney+"). Solo imágenes de productos, nada del cliente.
 */
function productLogo(e: Engine, productId: Id): string | undefined {
  const p = e.s.products[productId];
  if (!p) return undefined;
  if (p.imageFileRef) return p.imageFileRef;
  const name = commercialName(p.name).toLowerCase();
  return Object.values(e.s.products).find((x) => x.imageFileRef && x.kind !== "combo" && commercialName(x.name).toLowerCase() === name)?.imageFileRef;
}

/** Logo del producto de ese link (Disney, Prime…), o undefined. */
export function publicLogo(e: Engine, token: unknown): string | undefined {
  const { a } = resolve(e, token);
  return productLogo(e, a.productId);
}
