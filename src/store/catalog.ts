// Catálogo, grupos de precios, proveedores y clientes.
import type { Actor, Cents, Customer, Id, PriceGroup, Product, Supplier } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, can, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";

const money = (n: number, what: string) => {
  if (!Number.isInteger(n) || n < 0) throw new DomainError("VALIDATION", `${what} debe ser un entero >= 0 (centavos)`);
};

export function upsertProduct(e: Engine, actor: Actor, p: Omit<Product, "id"> & { id?: Id }): Product {
  authorize(actor, "catalog.manage");
  money(p.price, "price");
  if (!p.name?.trim()) throw new DomainError("VALIDATION", "El producto necesita nombre");
  if (!Number.isInteger(p.durationDays) || p.durationDays <= 0) throw new DomainError("VALIDATION", "durationDays inválido");
  return e.tx(() => {
    const id = p.id ?? e.id("prd");
    const prod: Product = { ...p, id };
    e.s.products[id] = prod;
    e.audit(actor, "product.upsert", "product", id, { price: p.price, published: p.published });
    return prod;
  });
}

export function upsertPriceGroup(e: Engine, actor: Actor, g: PriceGroup): PriceGroup {
  authorize(actor, "catalog.manage");
  Object.values(g.prices).forEach((v) => money(v, "precio del grupo"));
  return e.tx(() => {
    e.s.priceGroups[g.id] = structuredClone(g);
    e.audit(actor, "price_group.upsert", "price_group", g.id, { products: Object.keys(g.prices).length });
    return g;
  });
}

/** Precio calculado en el servidor: nunca se acepta el precio que manda el cliente. */
export function priceFor(e: Engine, customerId: Id, productId: Id): Cents {
  const c = e.get("customers", customerId);
  const p = e.get("products", productId);
  const g = e.s.priceGroups[c.priceGroupId];
  return g?.prices[productId] ?? p.price;
}

export function upsertSupplier(e: Engine, actor: Actor, s: Omit<Supplier, "id"> & { id?: Id }): Supplier {
  authorize(actor, "supplier.manage");
  return e.tx(() => {
    const id = s.id ?? e.id("sup");
    e.s.suppliers[id] = { ...s, id };
    e.audit(actor, "supplier.upsert", "supplier", id, { active: s.active });
    return e.s.suppliers[id];
  });
}

/** Teléfono normalizado: solo dígitos y un "+" inicial opcional. */
export const normalizePhone = (p: string) => String(p ?? "").replace(/[^\d+]/g, "").replace(/(?!^)\+/g, "");

export function findCustomerByPhone(e: Engine, phone: string) {
  const n = normalizePhone(phone);
  const c = Object.values(e.s.customers).find((x) => x.phone === n);
  return c ? structuredClone(c) : undefined;
}

/** Alta desde la tienda, después de verificar el teléfono con un código. Siempre cliente final. */
export function selfRegister(e: Engine, input: { name: string; phone: string; whatsappConsent: boolean }): Customer {
  const system: Actor = { id: "system:registro", role: "system" };
  const phone = normalizePhone(input.phone);
  if (!input.name?.trim() || input.name.length > 80 || phone.replace(/\D/g, "").length < 7) throw new DomainError("VALIDATION", "Nombre y teléfono son obligatorios");
  return e.tx(() => {
    if (Object.values(e.s.customers).some((x) => x.phone === phone)) throw new DomainError("VALIDATION", "Ya existe un cliente con ese teléfono");
    const id = e.id("cus");
    const cust: Customer = { id, name: input.name.trim(), phone, kind: "customer", priceGroupId: "final", whatsappConsent: !!input.whatsappConsent, createdAt: e.now() };
    e.s.customers[id] = cust;
    e.audit(system, "customer.self_register", "customer", id, { whatsappConsent: cust.whatsappConsent });
    return structuredClone(cust);
  });
}

export interface NewCustomer {
  name: string;
  phone: string;
  email?: string;
  kind?: "customer" | "reseller";
  priceGroupId?: Id;
  whatsappConsent?: boolean;
}

/**
 * Staff crea cualquier cliente o revendedor. Un revendedor solo crea clientes propios,
 * siempre con el grupo "final" y nunca otros revendedores.
 */
export function createCustomer(e: Engine, actor: Actor, c: NewCustomer): Customer {
  const phone = normalizePhone(c.phone);
  if (!c.name?.trim() || phone.replace(/\D/g, "").length < 7) throw new DomainError("VALIDATION", "Nombre y teléfono son obligatorios");
  let resellerId: Id | undefined;
  if (isStaff(actor)) {
    authorize(actor, "customer.manage");
    if (c.kind === "reseller" && actor.role === "seller") throw new DomainError("FORBIDDEN", "Solo admin u owner crean revendedores");
  } else {
    authorize(actor, "customer.create_own");
    if (c.kind === "reseller" || c.priceGroupId) throw new DomainError("FORBIDDEN", "Un revendedor solo crea clientes finales");
    resellerId = actor.customerId;
  }
  return e.tx(() => {
    if (Object.values(e.s.customers).some((x) => x.phone === phone)) throw new DomainError("VALIDATION", "Ya existe un cliente con ese teléfono");
    const groupId = c.priceGroupId ?? "final";
    if (!e.s.priceGroups[groupId]) throw new DomainError("NOT_FOUND", `Grupo de precios ${groupId} no existe`);
    const id = e.id("cus");
    const cust: Customer = {
      id, name: c.name.trim(), phone, email: c.email, kind: c.kind ?? "customer", resellerId,
      priceGroupId: groupId, whatsappConsent: c.whatsappConsent ?? false, createdAt: e.now(),
    };
    e.s.customers[id] = cust;
    e.audit(actor, "customer.create", "customer", id, { kind: cust.kind, resellerId });
    return cust;
  });
}

export function setWhatsappConsent(e: Engine, actor: Actor, customerId: Id, consent: boolean): void {
  const self = actor.customerId === customerId;
  if (!self && !can(actor, "customer.manage")) throw new DomainError("FORBIDDEN", "No podés cambiar el consentimiento de otro cliente");
  e.tx(() => {
    e.get("customers", customerId).whatsappConsent = consent;
    e.audit(actor, consent ? "consent.granted" : "consent.revoked", "customer", customerId);
  });
}

/** ¿Puede `actor` operar sobre el cliente `customerId`? (él mismo, su revendedor o staff). */
export function canActFor(e: Engine, actor: Actor, customerId: Id): boolean {
  if (isStaff(actor)) return true;
  if (!actor.customerId) return false;
  if (actor.customerId === customerId) return true;
  const c = e.s.customers[customerId];
  return actor.role === "reseller" && !!c && c.resellerId === actor.customerId;
}

export function publicCatalog(e: Engine, customerId?: Id) {
  return Object.values(e.s.products)
    .filter((p) => p.published)
    .map((p) => ({
      id: p.id, name: p.name, kind: p.kind, durationDays: p.durationDays,
      price: customerId ? priceFor(e, customerId, p.id) : p.price,
      available: Object.values(e.s.slots).filter((s) => s.productId === p.id && s.status === "available").length,
    }));
}
