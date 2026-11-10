// Control de acceso por rol (RBAC). Toda operación sensible pasa por `authorize`.
import type { Actor, Role } from "./types.js";
import { DomainError } from "./errors.js";

export type Permission =
  | "catalog.manage"
  | "inventory.manage"
  | "inventory.view_secrets"
  | "supplier.manage"
  | "customer.manage"
  | "customer.create_own"
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
  "customer.create_own": ["reseller"],
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

export function can(actor: Actor, perm: Permission): boolean {
  return MATRIX[perm].includes(actor.role);
}

export function authorize(actor: Actor, perm: Permission): void {
  if (!can(actor, perm)) throw new DomainError("FORBIDDEN", `El rol ${actor.role} no puede ${perm}`);
}

export const isStaff = (a: Actor) => a.role === "owner" || a.role === "admin" || a.role === "seller";
