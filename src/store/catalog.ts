// Catálogo, grupos de precios, proveedores y clientes.
import { cleanLook } from "./look.js";
import type { Actor, Cents, Customer, Id, PriceGroup, Product, StoreSettings, Supplier } from "./types.js";
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
  if (p.color !== undefined && !/^#[0-9a-fA-F]{6}$/.test(p.color)) throw new DomainError("VALIDATION", "Color: formato #RRGGBB");
  if ((p.description?.length ?? 0) > 200 || (p.category?.length ?? 0) > 40) throw new DomainError("VALIDATION", "Descripción o categoría demasiado largas");
  return e.tx(() => {
    const id = p.id ?? e.id("prd");
    const prev = e.s.products[id];
    // Solo campos conocidos; la imagen se cambia aparte y se conserva al editar.
    const prod: Product = {
      id, name: p.name.trim(), kind: p.kind, durationDays: p.durationDays, price: p.price, published: !!p.published,
      ...(p.category !== undefined ? { category: p.category } : {}), ...(p.description !== undefined ? { description: p.description } : {}),
      ...(p.color !== undefined ? { color: p.color } : {}), ...(prev?.imageFileRef ? { imageFileRef: prev.imageFileRef } : {}),
      ...(p.resellersOnly ? { resellersOnly: true } : {}),
    };
    if (p.profileDefaults !== undefined) {
      if (!Array.isArray(p.profileDefaults) || p.profileDefaults.length > 20) throw new DomainError("VALIDATION", "Hasta 20 perfiles por defecto");
      const defs = p.profileDefaults.map((d) => {
        const label = String(d?.label ?? "").trim().slice(0, 40);
        if (!label) throw new DomainError("VALIDATION", "Cada perfil por defecto necesita un nombre");
        const pin = String(d?.pin ?? "").replace(/\D/g, "").slice(0, 8);
        return pin ? { label, pin } : { label };
      });
      if (defs.length) prod.profileDefaults = defs;
    } else if (prev?.profileDefaults) prod.profileDefaults = prev.profileDefaults;
    if (!["profile", "full_account", "invite", "combo"].includes(prod.kind)) throw new DomainError("VALIDATION", "Tipo de producto inválido");
    const sn = p.saleNote !== undefined ? p.saleNote : prev?.saleNote;
    if (typeof sn === "string" && sn.trim()) {
      if (sn.length > 200) throw new DomainError("VALIDATION", "La regla al vender es demasiado larga (máx. 200)");
      prod.saleNote = sn.trim();
    }
    // Componentes del combo: apps que incluye (para detectar "armá tu combo" igual a uno existente).
    if (prod.kind === "combo") {
      const src = p.comboProductIds !== undefined ? p.comboProductIds : prev?.comboProductIds;
      if (Array.isArray(src) && src.length) {
        const ids = [...new Set(src.map(String))];
        if (ids.length > 8) throw new DomainError("VALIDATION", "Un combo incluye hasta 8 apps");
        for (const cid of ids) {
          const cp = e.s.products[cid];
          if (!cp || cp.kind === "combo") throw new DomainError("VALIDATION", "Cada app del combo debe ser un producto que no sea combo");
        }
        prod.comboProductIds = ids;
      }
    }
    e.s.products[id] = prod;
    e.audit(actor, "product.upsert", "product", id, { price: p.price, published: p.published });
    return prod;
  });
}

/** Cambia (o quita, con null) la imagen de un producto. Devuelve el archivo anterior para borrarlo. */
export function setProductImage(e: Engine, actor: Actor, productId: Id, fileRef: string | null): string | undefined {
  authorize(actor, "catalog.manage");
  return e.tx(() => {
    const p = e.get("products", productId);
    const old = p.imageFileRef;
    if (fileRef) p.imageFileRef = fileRef;
    else delete p.imageFileRef;
    e.audit(actor, "product.image", "product", p.id, { removed: !fileRef });
    return old;
  });
}

export function updateSettings(e: Engine, actor: Actor, patch: Partial<Omit<StoreSettings, "currency">>): StoreSettings {
  authorize(actor, "catalog.manage");
  if (patch.storeName !== undefined && (!patch.storeName.trim() || patch.storeName.length > 60)) throw new DomainError("VALIDATION", "Nombre de tienda inválido");
  if (patch.whatsapp !== undefined && !/^\d{7,15}$/.test(patch.whatsapp)) throw new DomainError("VALIDATION", "WhatsApp: solo números con código de país, p. ej. 59170000000");
  if (patch.paymentNote !== undefined && patch.paymentNote.length > 300) throw new DomainError("VALIDATION", "La nota de pago es muy larga");
  if (patch.platformName !== undefined && (!String(patch.platformName).trim() || String(patch.platformName).length > 40)) throw new DomainError("VALIDATION", "Nombre de la plataforma: de 1 a 40 letras");
  if (patch.shopRent !== undefined) {
    const r = patch.shopRent as unknown as Record<string, unknown>;
    const ok = r && typeof r === "object" && Number.isInteger(r.price) && (r.price as number) >= 0 && (r.price as number) <= 1_000_000
      && Number.isInteger(r.freeIfSpent) && (r.freeIfSpent as number) >= 0 && Number.isInteger(r.graceDays) && (r.graceDays as number) >= 0 && (r.graceDays as number) <= 30;
    if (!ok) throw new DomainError("VALIDATION", "Alquiler inválido (precio, mínimo de compras y días de gracia)");
    patch.shopRent = { enabled: !!r.enabled, price: r.price as number, freeIfSpent: r.freeIfSpent as number, graceDays: r.graceDays as number };
  }
  if (patch.resellerMarginPct !== undefined && !(Number.isInteger(patch.resellerMarginPct) && patch.resellerMarginPct >= 0 && patch.resellerMarginPct <= 300)) throw new DomainError("VALIDATION", "Ganancia sugerida: de 0 a 300 %");
  if (patch.referralBonus !== undefined && !(Number.isInteger(patch.referralBonus) && patch.referralBonus >= 0 && patch.referralBonus <= 1_000_000)) throw new DomainError("VALIDATION", "Premio por referido: de Bs 0 a Bs 10.000");
  if (patch.comboDiscounts !== undefined) {
    const d = patch.comboDiscounts;
    if (!Array.isArray(d) || d.length !== 3 || d.some((v) => !Number.isInteger(v) || v < 0 || v > 100000)) throw new DomainError("VALIDATION", "Descuentos del combo inválidos (de Bs 0 a Bs 1000)");
  }
  const look = cleanLook(patch as Record<string, unknown>);
  return e.tx(() => {
    const allowed = (["storeName", "whatsapp", "qrFileRef", "paymentNote", "logoFileRef", "resellerShops", "resellerProgramPrices", "platformName", "comboDiscounts", "shopRent", "resellerMarginPct", "referralBonus"] as const).filter((k) => patch[k] !== undefined);
    for (const k of allowed) (e.s.settings as unknown as Record<string, unknown>)[k] = typeof patch[k] === "string" ? (patch[k] as string).trim() : patch[k];
    Object.assign(e.s.settings, look);
    allowed.push(...(Object.keys(look) as never[]));
    e.audit(actor, "settings.update", "settings", "store", { fields: allowed.join(",") });
    return structuredClone(e.s.settings);
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
  let c = Object.values(e.s.customers).find((x) => x.phone === n);
  if (!c) {
    // Tolerante: "70012345", "59170012345" y "+591 70012345" son el mismo número (si no hay dudas).
    const d = n.replace(/\D/g, "");
    const tail = d.slice(-8);
    const m = d.length >= 8 ? Object.values(e.s.customers).filter((x) => x.phone && x.phone.replace(/\D/g, "").slice(-8) === tail) : [];
    if (m.length === 1) c = m[0];
  }
  return c ? structuredClone(c) : undefined;
}

/** Alta desde la tienda, después de verificar el teléfono con un código. Siempre cliente final. */
/** Alta publica con correo (sin telefono). La contrasena se guarda aparte, cifrada, en el servidor. */
export function registerWithEmail(e: Engine, input: { name: string; email: string }): Customer {
  const system: Actor = { id: "system:registro", role: "system" };
  const email = String(input.email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("VALIDATION", "Correo invalido");
  if (!input.name?.trim() || input.name.length > 80) throw new DomainError("VALIDATION", "Escribi tu nombre");
  return e.tx(() => {
    if (Object.values(e.s.customers).some((c) => (c.email ?? "").toLowerCase() === email)) throw new DomainError("VALIDATION", "Ya existe una cuenta con ese correo. Inicia sesion o recupera tu contrasena.");
    const id = e.id("cus");
    const cust: Customer = { id, name: input.name.trim(), phone: "", email, kind: "customer", priceGroupId: "final", whatsappConsent: false, createdAt: e.now() };
    e.s.customers[id] = cust;
    e.audit(system, "customer.register_email", "customer", id, {});
    return structuredClone(cust);
  });
}

export function selfRegister(e: Engine, input: { name: string; phone: string; whatsappConsent: boolean }): Customer {
  const system: Actor = { id: "system:registro", role: "system" };
  const phone = normalizePhone(input.phone);
  if (!input.name?.trim() || input.name.length > 80 || phone.replace(/\D/g, "").length < 7) throw new DomainError("VALIDATION", "Nombre y teléfono son obligatorios");
  return e.tx(() => {
    if (phone && Object.values(e.s.customers).some((x) => x.phone === phone)) throw new DomainError("VALIDATION", "Ya existe un cliente con ese teléfono");
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
/** Cambia el tipo de varios clientes de una vez (o de todos). Solo dueño o admin. */
export function setCustomersKind(e: Engine, actor: Actor, ids: Id[] | "all", kind: "customer" | "reseller"): { changed: number; skipped: { id: Id; name: string; reason: string }[] } {
  authorize(actor, "customer.manage");
  if (actor.role === "seller") throw new DomainError("FORBIDDEN", "Solo admin u owner cambian el tipo de un cliente");
  if (kind !== "customer" && kind !== "reseller") throw new DomainError("VALIDATION", "Tipo inválido");
  if (ids !== "all" && (!Array.isArray(ids) || ids.length > 5000)) throw new DomainError("VALIDATION", "Lista de clientes inválida");
  return e.tx(() => {
    ensureResellerGroup(e, "revendedor");
    // Los clientes que creó un revendedor son clientes de él: no se tocan con "todos".
    const list = ids === "all" ? Object.values(e.s.customers).filter((c) => !c.resellerId) : ids.map((id) => e.get("customers", id));
    let changed = 0;
    const skipped: { id: Id; name: string; reason: string }[] = [];
    for (const c of list) {
      if (c.kind === kind) continue;
      if (kind === "customer" && Object.values(e.s.customers).some((x) => x.resellerId === c.id)) { skipped.push({ id: c.id, name: c.name, reason: "tiene clientes propios" }); continue; }
      c.kind = kind;
      c.priceGroupId = kind === "reseller" ? "revendedor" : "final";
      changed++;
    }
    e.audit(actor, "customer.bulk_kind", "customer", ids === "all" ? "*" : ids.join(",").slice(0, 200), { kind, changed });
    return { changed, skipped };
  });
}

/** La lista "revendedor" se crea sola la primera vez (sin precios propios usa el precio normal). Debe llamarse dentro de `tx`. */
function ensureResellerGroup(e: Engine, id: Id): void {
  if (id === "revendedor" && !e.s.priceGroups.revendedor) e.s.priceGroups.revendedor = { id: "revendedor", name: "Revendedor", prices: {} };
}

export function createCustomer(e: Engine, actor: Actor, c: NewCustomer & { allowNoPhone?: boolean }): Customer {
  const phone = normalizePhone(c.phone);
  if (!c.name?.trim()) throw new DomainError("VALIDATION", "Nombre y teléfono son obligatorios");
  if (!(c.allowNoPhone && !phone) && phone.replace(/\D/g, "").length < 7) throw new DomainError("VALIDATION", "Nombre y teléfono son obligatorios");
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
    if (phone && Object.values(e.s.customers).some((x) => x.phone === phone)) throw new DomainError("VALIDATION", "Ya existe un cliente con ese teléfono");
    const groupId = c.priceGroupId ?? "final";
    ensureResellerGroup(e, groupId);
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

export interface CustomerPatch {
  name?: string;
  phone?: string;
  email?: string;
  notes?: string;
  kind?: "customer" | "reseller";
  priceGroupId?: Id;
}

/** Editar cliente. Cambiar tipo o grupo de precios lo hacen solo admin u owner. */
export function updateCustomer(e: Engine, actor: Actor, customerId: Id, patch: CustomerPatch): Customer {
  authorize(actor, "customer.manage");
  if ((patch.kind !== undefined || patch.priceGroupId !== undefined) && actor.role === "seller") throw new DomainError("FORBIDDEN", "Solo admin u owner cambian el tipo o los precios de un cliente");
  if (patch.name !== undefined && (!patch.name.trim() || patch.name.length > 80)) throw new DomainError("VALIDATION", "Nombre inválido");
  if (patch.email !== undefined && patch.email !== "" && !/^[^@\s]+@[^@\s]+$/.test(patch.email)) throw new DomainError("VALIDATION", "Email inválido");
  if ((patch.notes?.length ?? 0) > 500) throw new DomainError("VALIDATION", "Notas: máximo 500 letras");
  return e.tx(() => {
    const c = e.get("customers", customerId);
    const changed: string[] = [];
    if (patch.phone !== undefined) {
      const phone = normalizePhone(patch.phone);
      if (phone.replace(/\D/g, "").length < 7) throw new DomainError("VALIDATION", "Teléfono inválido");
      if (phone !== c.phone) {
        if (Object.values(e.s.customers).some((x) => x.id !== c.id && x.phone === phone)) throw new DomainError("VALIDATION", "Ya existe un cliente con ese teléfono");
        c.phone = phone; changed.push("phone");
      }
    }
    if (patch.name !== undefined && patch.name.trim() !== c.name) { c.name = patch.name.trim(); changed.push("name"); }
    if (patch.email !== undefined && patch.email !== (c.email ?? "")) { c.email = patch.email || undefined; changed.push("email"); }
    if (patch.notes !== undefined && patch.notes.trim() !== (c.notes ?? "")) { c.notes = patch.notes.trim() || undefined; changed.push("notes"); }
    if (patch.kind !== undefined && patch.kind !== c.kind) {
      if (patch.kind === "customer" && Object.values(e.s.customers).some((x) => x.resellerId === c.id)) throw new DomainError("INVALID_STATE", "Este revendedor tiene clientes propios; no se puede pasar a cliente final");
      c.kind = patch.kind; changed.push("kind");
    }
    if (patch.priceGroupId !== undefined && patch.priceGroupId !== c.priceGroupId) {
      ensureResellerGroup(e, patch.priceGroupId);
      if (!e.s.priceGroups[patch.priceGroupId]) throw new DomainError("NOT_FOUND", "Grupo de precios inexistente");
      c.priceGroupId = patch.priceGroupId; changed.push("priceGroupId");
    }
    e.audit(actor, "customer.update", "customer", c.id, { fields: changed.join(",") });
    return structuredClone(c);
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

/** El propio cliente (o revendedor) fija o cambia su correo para entrar con contraseña. */
export function setOwnEmail(e: Engine, actor: Actor, email: string): Customer {
  if (!actor.customerId) throw new DomainError("FORBIDDEN", "Solo para clientes");
  const next = String(email ?? "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next)) throw new DomainError("VALIDATION", "Correo inválido");
  return e.tx(() => {
    if (Object.values(e.s.customers).some((c) => c.id !== actor.customerId && (c.email ?? "").toLowerCase() === next)) throw new DomainError("VALIDATION", "Ese correo ya lo usa otra cuenta");
    const c = e.get("customers", actor.customerId!);
    c.email = next;
    e.audit(actor, "customer.set_email", "customer", c.id, {});
    return structuredClone(c);
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

/** ¿Este cliente puede ver/comprar/renovar este producto desde la tienda? */
export function visibleTo(e: Engine, p: { published: boolean; resellersOnly?: boolean }, customerId?: Id): boolean {
  if (!p.published) return false;
  if (!p.resellersOnly) return true;
  return !!customerId && e.s.customers[customerId]?.kind === "reseller";
}

export function publicCatalog(e: Engine, customerId?: Id) {
  return Object.values(e.s.products)
    .filter((p) => visibleTo(e, p, customerId))
    .map((p) => ({
      id: p.id, name: p.name, kind: p.kind, durationDays: p.durationDays,
      category: p.category ?? "Otros", description: p.description ?? "", color: p.color ?? "#3984ff", hasImage: !!p.imageFileRef, resellersOnly: !!p.resellersOnly,
      price: customerId ? priceFor(e, customerId, p.id) : p.price,
      // Tiene precio especial para este cliente (revendedor): sale en su lista de precios.
      ...(customerId && e.s.priceGroups[e.s.customers[customerId]?.priceGroupId]?.prices[p.id] !== undefined ? { wholesale: true, publicPrice: p.price } : {}),
      ...(p.kind === "combo" && p.comboProductIds?.length ? { comboParts: p.comboProductIds } : {}),
      available: Object.values(e.s.slots).filter((s) => s.productId === p.id && s.status === "available").length,
    }));
}
