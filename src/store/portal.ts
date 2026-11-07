// Portal privado de clientes y revendedores.
// Un cliente ve solo lo suyo; un revendedor ve lo suyo y lo de sus clientes.
// Cada vista de credenciales queda registrada en auditoría.
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { canActFor } from "./catalog.js";
import { balance } from "./wallet.js";

function visibleCustomers(e: Engine, actor: Actor): Id[] {
  if (!actor.customerId) throw new DomainError("FORBIDDEN", "El portal es para clientes y revendedores");
  const own = [actor.customerId];
  if (actor.role === "reseller") {
    own.push(...Object.values(e.s.customers).filter((c) => c.resellerId === actor.customerId).map((c) => c.id));
  }
  return own;
}

export function myServices(e: Engine, actor: Actor, customerId?: Id) {
  if (isStaff(actor)) throw new DomainError("FORBIDDEN", "El staff usa el panel, no el portal");
  const ids = customerId ? [customerId] : visibleCustomers(e, actor);
  for (const id of ids) if (!canActFor(e, actor, id)) throw new DomainError("FORBIDDEN", "No podés ver servicios de otro cliente");
  return e.tx(() => {
    const out = Object.values(e.s.assignments)
      .filter((a) => ids.includes(a.customerId) && a.status === "active")
      .sort((x, y) => x.customerExpiresAt - y.customerExpiresAt)
      .map((a) => {
        const slot = e.s.slots[a.slotId];
        const acc = e.s.accounts[slot.accountId];
        return {
          assignmentId: a.id, customerId: a.customerId, customerName: e.s.customers[a.customerId].name,
          productId: a.productId, product: e.s.products[a.productId].name, expiresAt: a.customerExpiresAt,
          daysLeft: Math.ceil((a.customerExpiresAt - e.now()) / 86_400_000),
          access: { email: acc.email, password: acc.password, profile: slot.label, pin: slot.pin ?? null },
        };
      });
    if (out.length) e.audit(actor, "credentials.view", "assignment", out.map((o) => o.assignmentId).join(","));
    return out;
  });
}

export function myOrders(e: Engine, actor: Actor) {
  const ids = visibleCustomers(e, actor);
  return Object.values(e.s.orders)
    .filter((o) => ids.includes(o.customerId) || o.payerId === actor.customerId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((o) => ({ id: o.id, kind: o.kind, status: o.status, total: o.total, method: o.paymentMethod, customerId: o.customerId, createdAt: o.createdAt }));
}

export function myBalance(e: Engine, actor: Actor) {
  if (!actor.customerId) throw new DomainError("FORBIDDEN", "Solo clientes y revendedores tienen saldo");
  return balance(e, actor.customerId);
}

/** Clientes de un revendedor, con su próximo vencimiento. */
export function myCustomers(e: Engine, actor: Actor) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return Object.values(e.s.customers)
    .filter((c) => c.resellerId === actor.customerId)
    .map((c) => {
      const act = Object.values(e.s.assignments).filter((a) => a.customerId === c.id && a.status === "active");
      return { id: c.id, name: c.name, phone: c.phone, services: act.length, nextExpiry: act.length ? Math.min(...act.map((a) => a.customerExpiresAt)) : null };
    });
}
