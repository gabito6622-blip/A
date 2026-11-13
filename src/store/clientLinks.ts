// Link de cobro para los clientes REGISTRADOS del revendedor (13/11/2026). Hasta hoy solo los perfiles
// repartidos tenían /c/<token>; sus clientes con cuenta en la tienda recibían el monto por mensaje pero no
// tenían dónde ver el QR del revendedor ni tocar «Ya pagué». Misma página pública, misma lista cerrada de
// campos (subLinks.publicView), mismas reglas: nada de la cuenta, ni costos, ni teléfono, ni ids.
// El token vive en `assignment.rlink` (campo opcional nuevo) y muere si el alquiler se pasa a otro revendedor.
import { randomBytes } from "node:crypto";
import type { Actor, Assignment, Customer, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { listPriceMine, localeOf } from "./country.js";

const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const newToken = () => randomBytes(24).toString("base64url");

/** Índice token → assignmentId por estado (ver subLinks.ts: se rearma si cambia `e.s`). */
const indexes = new WeakMap<Engine, { state: object; map: Map<string, Id> }>();
function index(e: Engine): Map<string, Id> {
  let x = indexes.get(e);
  if (!x || x.state !== e.s) {
    const map = new Map<string, Id>();
    for (const a of Object.values(e.s.assignments)) if (a.rlink) map.set(a.rlink.token, a.id);
    x = { state: e.s, map };
    indexes.set(e, x);
  }
  return x.map;
}

function reseller(e: Engine, actor: Actor): Customer {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return e.get("customers", actor.customerId);
}
function mine(e: Engine, me: Customer, assignmentId: Id): Assignment {
  const a = e.get("assignments", assignmentId);
  if (a.status !== "active" || e.s.customers[a.customerId]?.resellerId !== me.id) throw new DomainError("FORBIDDEN", "Ese servicio no es de un cliente tuyo");
  return a;
}

/** Crea el link de cobro del servicio de un cliente registrado (o devuelve el que ya tiene). */
export function clientLink(e: Engine, actor: Actor, assignmentId: Id) {
  const me = reseller(e, actor);
  return e.tx(() => {
    const a = mine(e, me, assignmentId);
    if (a.rlink) return { token: a.rlink.token, created: false };
    let token = newToken();
    while (index(e).has(token)) token = newToken();
    a.rlink = { token, by: me.id, at: e.now() };
    index(e).set(token, a.id);
    e.audit(actor, "reseller.client_link", "assignment", a.id);
    return { token, created: true };
  });
}

/** Invalida el link: deja de servir al instante. */
export function revokeClientLink(e: Engine, actor: Actor, assignmentId: Id) {
  const me = reseller(e, actor);
  return e.tx(() => {
    const a = mine(e, me, assignmentId);
    if (!a.rlink) return { ok: true as const, revoked: false };
    index(e).delete(a.rlink.token);
    delete a.rlink;
    e.audit(actor, "reseller.client_link_revoke", "assignment", a.id);
    return { ok: true as const, revoked: true };
  });
}

/** Alquiler vigente de un token de cliente registrado, o undefined (no es de este tipo o ya no sirve). */
export function clientLinkTarget(e: Engine, token: unknown): { a: Assignment; c: Customer; me: Customer } | undefined {
  const t = typeof token === "string" ? token : "";
  const id = TOKEN_RE.test(t) ? index(e).get(t) : undefined;
  const a = id ? e.s.assignments[id] : undefined;
  if (!a || a.rlink?.token !== t || a.status !== "active") return undefined;
  const c = e.s.customers[a.customerId], me = e.s.customers[a.rlink.by];
  // Si la tienda le pasó el cliente a otro revendedor (o lo dejó directo), el link del revendedor viejo muere.
  if (!c || !me || me.kind !== "reseller" || c.resellerId !== me.id) return undefined;
  return { a, c, me };
}

const commercial = (name: string) => name.replace(/\s*[([][^)\]]*[)\]]/g, " ").replace(/\s{2,}/g, " ").trim() || "Tu servicio";

/** La misma lista cerrada de campos que el link de los perfiles repartidos; undefined si no es un token de este tipo. */
export function clientLinkView(e: Engine, token: unknown) {
  const r = clientLinkTarget(e, token);
  if (!r) return undefined;
  const { a, c, me } = r;
  return {
    name: c.name.trim().split(/\s+/)[0] ?? "",
    label: "",
    product: commercial(e.s.products[a.productId]?.name ?? ""),
    expiresAt: a.customerExpiresAt,
    price: a.rcontrol?.price ?? listPriceMine(e, me, a.productId) ?? null,
    pay: a.rcontrol?.payStatus ?? "pagado",
    seller: (me.shop?.title || me.name || "").trim(),
    sellerWhatsapp: String(me.shop?.whatsapp || me.phone || "").replace(/\D/g, ""),
    hasQr: !!(me.shop && !me.shop.blocked && me.shop.qrFileRef),
    currency: localeOf(e, me).symbol,
  };
}

/** QR del revendedor de ese link; null si el token no es de este tipo. */
export function clientLinkQr(e: Engine, token: unknown): string | undefined | null {
  const r = clientLinkTarget(e, token);
  if (!r) return null;
  return r.me.shop && !r.me.shop.blocked ? r.me.shop.qrFileRef : undefined;
}
