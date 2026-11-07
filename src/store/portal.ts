// Portal privado de clientes y revendedores.
// Un cliente ve solo lo suyo; un revendedor ve lo suyo y lo de sus clientes.
// Cada vista de credenciales queda registrada en auditoría.
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { canActFor, normalizePhone, priceFor } from "./catalog.js";
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
          access: { email: acc.email, password: acc.password || "Pedila por WhatsApp", profile: slot.label, pin: slot.pin ?? null, passwordPending: !acc.password },
          canRenew: !!e.s.products[a.productId]?.published,
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
      return {
        id: c.id, name: c.name, phone: c.phone, services: act.length, nextExpiry: act.length ? Math.min(...act.map((a) => a.customerExpiresAt)) : null,
        whatsappConsent: c.whatsappConsent, note: c.resellerNote ?? "", createdAt: c.createdAt,
      };
    });
}

/** El revendedor corrige los datos de SUS clientes (no el tipo ni los precios). */
export function updateMyClient(e: Engine, actor: Actor, customerId: Id, patch: { name?: string; phone?: string; whatsappConsent?: boolean; note?: string }) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  if (patch.name !== undefined && (typeof patch.name !== "string" || !patch.name.trim() || patch.name.length > 80)) throw new DomainError("VALIDATION", "Nombre inválido");
  if (patch.note !== undefined && (typeof patch.note !== "string" || patch.note.length > 300)) throw new DomainError("VALIDATION", "Nota: máximo 300 letras");
  return e.tx(() => {
    const c = e.s.customers[customerId];
    if (!c || c.resellerId !== actor.customerId) throw new DomainError("FORBIDDEN", "Ese cliente no es tuyo");
    const changed: string[] = [];
    if (patch.phone !== undefined) {
      const phone = normalizePhone(String(patch.phone));
      if (phone.replace(/\D/g, "").length < 7) throw new DomainError("VALIDATION", "Teléfono inválido");
      if (phone !== c.phone) {
        if (Object.values(e.s.customers).some((x) => x.id !== c.id && x.phone === phone)) throw new DomainError("VALIDATION", "Ya existe un cliente con ese teléfono");
        c.phone = phone; changed.push("phone");
      }
    }
    if (patch.name !== undefined && patch.name.trim() !== c.name) { c.name = patch.name.trim(); changed.push("name"); }
    if (patch.whatsappConsent !== undefined && !!patch.whatsappConsent !== c.whatsappConsent) { c.whatsappConsent = !!patch.whatsappConsent; changed.push("whatsappConsent"); }
    if (patch.note !== undefined && patch.note.trim() !== (c.resellerNote ?? "")) { c.resellerNote = patch.note.trim() || undefined; changed.push("note"); }
    e.audit(actor, "reseller.client_update", "customer", c.id, { fields: changed.join(",") });
    return { id: c.id, name: c.name, phone: c.phone, whatsappConsent: c.whatsappConsent, note: c.resellerNote ?? "" };
  });
}

/** Precios de venta del revendedor a sus clientes (null borra). Sirven para su lista de precios y su ganancia. */
export function setMyPrices(e: Engine, actor: Actor, prices: Record<Id, number | null>) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  if (!prices || typeof prices !== "object" || Object.keys(prices).length > 200) throw new DomainError("VALIDATION", "Lista de precios inválida");
  for (const [pid, v] of Object.entries(prices)) {
    if (!e.s.products[pid]) throw new DomainError("NOT_FOUND", `Producto inexistente: ${pid}`);
    if (v !== null && !(Number.isInteger(v) && v >= 0 && v <= 10_000_000)) throw new DomainError("VALIDATION", "Precio inválido");
  }
  return e.tx(() => {
    const c = e.get("customers", actor.customerId!);
    const next = { ...(c.resellerPrices ?? {}) };
    for (const [pid, v] of Object.entries(prices)) {
      if (v === null) delete next[pid];
      else next[pid] = v;
    }
    c.resellerPrices = next;
    e.audit(actor, "reseller.prices", "customer", c.id, { products: Object.keys(next).length });
    return structuredClone(next);
  });
}

/** Resumen para el revendedor: su costo, su precio de venta y la ganancia por producto. */
export function myPriceList(e: Engine, actor: Actor) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const me = e.get("customers", actor.customerId);
  return Object.values(e.s.products).filter((p) => p.published).map((p) => {
    const cost = priceFor(e, me.id, p.id);
    const sell = me.resellerPrices?.[p.id] ?? null;
    return { productId: p.id, name: p.name, durationDays: p.durationDays, cost, sell, profit: sell === null ? null : sell - cost };
  });
}
