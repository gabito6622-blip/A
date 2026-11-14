// Control de acceso por rol (RBAC). Toda operación sensible pasa por `authorize`.
import type { Actor, Role } from "./types.js";
import { DomainError } from "./errors.js";

export type Permission =
  | "catalog.manage"
  | "inventory.manage"
  | "inventory.view_secrets"
  | "supplier.manage"
  | "customer.manage"
  | "reseller.manage"
  | "customer.create_own"
  | "reseller.own_stock"
  | "order.create_any"
  | "order.create_self"
  | "payment.review"
  | "payment.gateway"
  | "assignment.renew_any"
  | "assignment.renew_beyond_supplier"
  | "assignment.replace"
  | "wallet.adjust"
  | "stats.view"
  | "audit.view"
  | "codes.configure"
  | "codes.ingest"
  | "notify.flush";

const MATRIX: Record<Permission, Role[]> = {
  "catalog.manage": ["owner", "admin"],
  "inventory.manage": ["owner", "admin"],
  "inventory.view_secrets": ["owner", "admin"],
  "supplier.manage": ["owner", "admin"],
  "customer.manage": ["owner", "admin", "seller"],
  // Aprobar revendedores, darles la página premium o armarla: solo dueño o admin (Atención no).
  "reseller.manage": ["owner", "admin"],
  "customer.create_own": ["reseller"],
  // "Mis cuentas propias": solo el revendedor; el dueño y su equipo no las ven (ownStock.ts).
  "reseller.own_stock": ["reseller"],
  "order.create_any": ["owner", "admin", "seller"],
  "order.create_self": ["customer", "reseller"],
  "payment.review": ["owner", "admin"],
  // Confirmación automática de una pasarela (Binance Pay) desde el webhook firmado: la corre el sistema.
  "payment.gateway": ["system", "owner"],
  "assignment.renew_any": ["owner", "admin", "seller"],
  "assignment.renew_beyond_supplier": ["owner"],
  "assignment.replace": ["owner", "admin"],
  "wallet.adjust": ["owner"],
  "stats.view": ["owner", "admin"],
  "audit.view": ["owner"],
  "codes.configure": ["owner"],
  "codes.ingest": ["system", "owner"],
  "notify.flush": ["system", "owner", "admin"],
};

/**
 * La llave del asistente entra como un admin (decisión del dueño, 14/11/2026: «vos sos mi asistente de todo mi panel,
 * sí tenés derecho»). Lo único que no toca son los usuarios y permisos, que se frenan por ruta en
 * src/server/teamSecurity.ts. La lista queda por si el dueño quiere quitarle algún permiso más adelante.
 */
export const ASSISTANT_DENY: readonly Permission[] = [];

export function can(actor: Actor, perm: Permission): boolean {
  if (actor.assistant && ASSISTANT_DENY.includes(perm)) return false;
  return MATRIX[perm].includes(actor.role);
}

export function authorize(actor: Actor, perm: Permission): void {
  if (!can(actor, perm)) throw new DomainError("FORBIDDEN", actor.assistant ? "La llave del asistente no puede hacer esto: lo hace el dueño desde su panel" : `El rol ${actor.role} no puede ${perm}`);
}

export const isStaff = (a: Actor) => a.role === "owner" || a.role === "admin" || a.role === "seller";
