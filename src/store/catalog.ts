// Catálogo, grupos de precios, proveedores y clientes.
import { cleanLook } from "./look.js";
import type { Actor, Cents, Customer, Id, PriceGroup, Product, StoreSettings, Supplier, ConsentVia } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, can, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { dialFor } from "./country.js";
import { groupCurrency, isUsd, pendingOrdersOf } from "./usd.js";

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
    if (!["profile", "full_account", "invite", "combo", "iptv"].includes(prod.kind)) throw new DomainError("VALIDATION", "Tipo de producto inválido");
    const sn = p.saleNote !== undefined ? p.saleNote : prev?.saleNote;
    if (typeof sn === "string" && sn.trim()) {
      if (sn.length > 200) throw new DomainError("VALIDATION", "La regla al vender es demasiado larga (máx. 200)");
      prod.saleNote = sn.trim();
    }
    // "Cómo verlo": guía de instalación que recibe el cliente (app, enlace de descarga, pasos).
    const g = p.guide !== undefined ? p.guide : prev?.guide;
    if (g && typeof g === "object") {
      const app = String(g.app ?? "").trim().slice(0, 60);
      const link = String(g.link ?? "").trim().slice(0, 300);
      const steps = String(g.steps ?? "").trim().slice(0, 600);
      if (link && !/^https?:\/\/\S+$/.test(link)) throw new DomainError("VALIDATION", "El enlace de la guía debe empezar con http(s)://");
      if (app || link || steps) prod.guide = { ...(app ? { app } : {}), ...(link ? { link } : {}), ...(steps ? { steps } : {}) };
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
  if (patch.currencySymbol !== undefined) {
    const s = String(patch.currencySymbol).trim().slice(0, 6);
    if (!s) throw new DomainError("VALIDATION", "Poné el símbolo de la moneda (ej.: US$, Bs)");
    patch.currencySymbol = s;
  }
  if (patch.usdt !== undefined) {
    const u = patch.usdt as Record<string, unknown>;
    if (!u || typeof u !== "object") throw new DomainError("VALIDATION", "Configuración de USDT inválida");
    const address = u.address != null ? String(u.address).trim() : "";
    const payId = u.payId != null ? String(u.payId).trim() : "";
    const network = u.network != null ? String(u.network).trim() : "";
    const note = u.note != null ? String(u.note).trim() : "";
    const rate = u.rate != null && u.rate !== "" ? Number(u.rate) : 0;
    const enabled = !!u.enabled;
    if (address && address.length > 120) throw new DomainError("VALIDATION", "La dirección de USDT es muy larga");
    if (payId && !/^[A-Za-z0-9@._-]{3,64}$/.test(payId)) throw new DomainError("VALIDATION", "El Pay ID no parece válido");
    if (network.length > 20 || note.length > 300) throw new DomainError("VALIDATION", "Red o nota de USDT muy larga");
    if (rate !== 0 && !(rate > 0 && rate <= 1000)) throw new DomainError("VALIDATION", "Poné cuántos Bs vale 1 USDT (ej. 13)");
    if (enabled && !address && !payId) throw new DomainError("VALIDATION", "Para aceptar USDT cargá una dirección o un Pay ID");
    if (enabled && !(rate > 0)) throw new DomainError("VALIDATION", "Para aceptar USDT poné la tasa Bs→USDT");
    const r = Math.round(rate * 100) / 100, prev = e.s.settings.usdt;
    // Dólar flexible: se anota cuándo cambió la tasa, para avisar si quedó vieja.
    const rateAt = r > 0 && r !== prev?.rate ? e.now() : prev?.rateAt;
    patch.usdt = { enabled, address: address || undefined, network: network || undefined, payId: payId || undefined, rate: r, ...(rateAt ? { rateAt } : {}), note: note || undefined };
  }
  if (patch.platformName !== undefined && (!String(patch.platformName).trim() || String(patch.platformName).length > 40)) throw new DomainError("VALIDATION", "Nombre de la plataforma: de 1 a 40 letras");
  if (patch.shopRent !== undefined) {
    const r = patch.shopRent as unknown as Record<string, unknown>;
    const ok = r && typeof r === "object" && Number.isInteger(r.price) && (r.price as number) >= 0 && (r.price as number) <= 1_000_000
      && Number.isInteger(r.freeIfSpent) && (r.freeIfSpent as number) >= 0 && Number.isInteger(r.graceDays) && (r.graceDays as number) >= 0 && (r.graceDays as number) <= 30
      && (r.scope === undefined || r.scope === "page" || r.scope === "all")
      && (r.priceUsd === undefined || r.priceUsd === null || (Number.isInteger(r.priceUsd) && (r.priceUsd as number) >= 0 && (r.priceUsd as number) <= 100_000))
      && (r.trialDays === undefined || r.trialDays === null || (Number.isInteger(r.trialDays) && (r.trialDays as number) >= 0 && (r.trialDays as number) <= 90))
      && (r.basicPrice === undefined || r.basicPrice === null || (Number.isInteger(r.basicPrice) && (r.basicPrice as number) >= 0 && (r.basicPrice as number) <= (r.price as number)))
      && (r.basicPriceUsd === undefined || r.basicPriceUsd === null || (Number.isInteger(r.basicPriceUsd) && (r.basicPriceUsd as number) >= 0 && (r.basicPriceUsd as number) <= 100_000))
      && (r.sellerPrice === undefined || r.sellerPrice === null || (Number.isInteger(r.sellerPrice) && (r.sellerPrice as number) >= 0 && (r.sellerPrice as number) <= (r.price as number)))
      && (r.sellerPriceUsd === undefined || r.sellerPriceUsd === null || (Number.isInteger(r.sellerPriceUsd) && (r.sellerPriceUsd as number) >= 0 && (r.sellerPriceUsd as number) <= 100_000));
    if (!ok) throw new DomainError("VALIDATION", "Alquiler inválido (precio, mínimo de compras, días de gracia, quién paga, precio en dólares, días de prueba de 0 a 90 o plan Vendedor más caro que el Negocio)");
    patch.shopRent = { enabled: !!r.enabled, price: r.price as number, freeIfSpent: r.freeIfSpent as number, graceDays: r.graceDays as number,
      ...(r.scope === "all" ? { scope: "all" as const } : {}), ...(Number.isInteger(r.priceUsd) ? { priceUsd: r.priceUsd as number } : {}),
      ...(Number.isInteger(r.trialDays) && (r.trialDays as number) > 0 ? { trialDays: r.trialDays as number } : {}),
      // Vendedor: se guarda en `sellerPrice`; `basicPrice` (nombre viejo) se acepta y se traduce para no perder el precio ya puesto.
      ...(Number.isInteger(r.sellerPrice) ? { sellerPrice: r.sellerPrice as number } : Number.isInteger(r.basicPrice) ? { sellerPrice: r.basicPrice as number } : {}),
      ...(Number.isInteger(r.sellerPriceUsd) ? { sellerPriceUsd: r.sellerPriceUsd as number } : Number.isInteger(r.basicPriceUsd) ? { sellerPriceUsd: r.basicPriceUsd as number } : {}) };
  }
  if (patch.resellerMarginPct !== undefined && !(Number.isInteger(patch.resellerMarginPct) && patch.resellerMarginPct >= 0 && patch.resellerMarginPct <= 300)) throw new DomainError("VALIDATION", "Ganancia sugerida: de 0 a 300 %");
  if (patch.referralBonus !== undefined && !(Number.isInteger(patch.referralBonus) && patch.referralBonus >= 0 && patch.referralBonus <= 1_000_000)) throw new DomainError("VALIDATION", "Premio por referido: de Bs 0 a Bs 10.000");
  if (patch.comboDiscounts !== undefined) {
    const d = patch.comboDiscounts;
    if (!Array.isArray(d) || d.length !== 3 || d.some((v) => !Number.isInteger(v) || v < 0 || v > 100000)) throw new DomainError("VALIDATION", "Descuentos del combo inválidos (de Bs 0 a Bs 1000)");
  }
  if (patch.ticketReplies !== undefined) {
    const l = patch.ticketReplies;
    if (!Array.isArray(l) || l.length > 10 || l.some((x) => typeof x !== "string" || !x.trim() || x.length > 200)) throw new DomainError("VALIDATION", "Respuestas guardadas: hasta 10, de 1 a 200 letras cada una");
    patch.ticketReplies = l.map((x) => x.trim());
  }
  if (patch.secretaryMsg !== undefined) {
    const m = patch.secretaryMsg as Record<string, unknown>;
    if (!m || typeof m !== "object") throw new DomainError("VALIDATION", "Mensajes de la secretaria inválidos");
    const out: { cobrar?: string; avisar?: string; deben?: string } = {};
    for (const k of ["cobrar", "avisar", "deben"] as const) {
      const v = m[k];
      if (v === undefined || v === null || v === "") continue;
      if (typeof v !== "string" || v.length > 500) throw new DomainError("VALIDATION", "Cada mensaje de la secretaria va hasta 500 letras");
      out[k] = v.trim();
    }
    patch.secretaryMsg = out;
  }
  if (patch.renewLink !== undefined) {
    const r = patch.renewLink as Record<string, unknown>;
    const hours = r?.hours === undefined || r?.hours === null || r?.hours === "" ? 48 : Number(r.hours);
    if (!r || typeof r !== "object" || (r.access !== undefined && r.access !== "renew" && r.access !== "full") || !Number.isInteger(hours) || hours < 1 || hours > 168) throw new DomainError("VALIDATION", "Links de renovación inválidos (acceso renew/full, duración de 1 a 168 horas)");
    patch.renewLink = { enabled: !!r.enabled, access: r.access === "full" ? "full" : "renew", hours };
  }
  const look = cleanLook(patch as Record<string, unknown>);
  return e.tx(() => {
    const allowed = (["storeName", "whatsapp", "qrFileRef", "paymentNote", "logoFileRef", "bannerFileRef", "resellerShops", "resellerProgramPrices", "alwaysAvailable", "resellerOnlyCatalog", "platformName", "comboDiscounts", "shopRent", "resellerMarginPct", "referralBonus", "usdt", "currencySymbol", "ticketReplies", "secretaryMsg", "renewLink"] as const).filter((k) => patch[k] !== undefined);
    for (const k of allowed) (e.s.settings as unknown as Record<string, unknown>)[k] = typeof patch[k] === "string" ? (patch[k] as string).trim() : patch[k];
    Object.assign(e.s.settings, look);
    allowed.push(...(Object.keys(look) as never[]));
    e.audit(actor, "settings.update", "settings", "store", { fields: allowed.join(",") });
    return structuredClone(e.s.settings);
  });
}

export function upsertPriceGroup(e: Engine, actor: Actor, g: PriceGroup): PriceGroup {
  authorize(actor, "catalog.manage");
  if (!g || typeof g !== "object" || !g.id || typeof g.id !== "string" || !g.prices || typeof g.prices !== "object") throw new DomainError("VALIDATION", "Lista de precios inválida");
  Object.values(g.prices).forEach((v) => money(v, "precio del grupo"));
  // Moneda de la lista: "USD" (precios en centavos de dólar) o Bs (sin campo). Si no la manda, queda la que tenía.
  const raw = (g as { currency?: unknown }).currency;
  if (raw !== undefined && raw !== null && raw !== "" && raw !== "USD" && raw !== "BOB") throw new DomainError("VALIDATION", "Moneda de la lista: Bs o US$");
  return e.tx(() => {
    const prev = e.s.priceGroups[g.id];
    const currency: "USD" | undefined = raw === undefined || raw === null ? prev?.currency : raw === "USD" ? "USD" : undefined;
    if (currency === "USD" && (g.id === "final" || g.id === "revendedor")) throw new DomainError("VALIDATION", "La lista base y la de revendedores van en Bs: creá una lista aparte en dólares");
    if (prev && (prev.currency ?? "BOB") !== (currency ?? "BOB")) {
      // Cambiar la moneda de una lista cambia la moneda del saldo de todos sus clientes: solo sin plata en juego.
      const busy = Object.values(e.s.customers).filter((c) => c.priceGroupId === g.id && (e.s.ledger.some((l) => l.customerId === c.id) || pendingOrdersOf(e, c.id).length));
      if (busy.length) throw new DomainError("INVALID_STATE", `No se puede cambiar la moneda: ${busy.length} cliente(s) de esta lista ya tienen movimientos de saldo o pagos pendientes. Creá una lista nueva en la otra moneda.`);
    }
    const next: PriceGroup = { id: g.id, name: String(g.name ?? prev?.name ?? g.id).trim().slice(0, 60) || g.id, prices: { ...g.prices }, ...(currency ? { currency } : {}) };
    e.s.priceGroups[g.id] = next;
    e.audit(actor, "price_group.upsert", "price_group", g.id, { products: Object.keys(g.prices).length, ...(currency ? { currency } : {}) });
    return structuredClone(next);
  });
}

/** Precio calculado en el servidor: nunca se acepta el precio que manda el cliente. */
export function priceFor(e: Engine, customerId: Id, productId: Id): Cents {
  const c = e.get("customers", customerId);
  const p = e.get("products", productId);
  const g = e.s.priceGroups[c.priceGroupId];
  // Lista en dólares: solo su precio en US$; nunca se cae al precio en Bs.
  if (g?.currency === "USD") {
    const v = g.prices[productId];
    if (v === undefined) throw new DomainError("NOT_FOUND", `${p.name} no tiene precio en la lista "${g.name}"`);
    return v;
  }
  return g?.prices[productId] ?? p.price;
}

/**
 * Con quién está acordado el precio del Control de un servicio: el revendedor si el cliente es de un
 * revendedor; si no, el propio cliente. El precio acordado es SU precio (para un revendedor, su costo).
 */
export function agreedPayerOf(e: Engine, customerId: Id): Id {
  const c = e.s.customers[customerId];
  return c?.resellerId && e.s.customers[c.resellerId] ? c.resellerId : customerId;
}

/**
 * Lo que le cuesta a quien paga renovar un servicio (mismo criterio que orders.renew): en Bs, el precio
 * acordado del Control o el de su lista; en dólares, el acordado en US$ o el de su lista en US$ (0 si no
 * tiene precio: no lo renueva). El precio acordado vale solo para quien lo acordó: el cliente final de un
 * revendedor nunca ve ni paga el precio acordado con su revendedor (es el costo del revendedor).
 */
export function renewPriceFor(e: Engine, payerId: Id, a: { customerId?: Id; productId: Id; control?: { price?: Cents; priceUsd?: Cents } }): Cents {
  const agreed = !a.customerId || agreedPayerOf(e, a.customerId) === payerId ? a.control : undefined;
  if (isUsd(e, payerId)) return agreed?.priceUsd ?? e.s.priceGroups[e.s.customers[payerId].priceGroupId]?.prices[a.productId] ?? 0;
  return agreed?.price ?? priceFor(e, payerId, a.productId);
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
/**
 * Teléfono como lo escribe la gente → con código de país, para que el link de WhatsApp funcione y no
 * se repitan clientes. `dial` es el código del país de quien lo carga (sin "+"):
 *  - Bolivia (por defecto): "70099111", "591 70099111" → "+59170099111"; lo demás queda como estaba.
 *  - Otro país (p. ej. Paraguay, 595): "0981 123 456", "981-123-456", "595981123456" → "+595981123456".
 * Un número que ya empieza con "+" no se toca (salvo el 0 de más: "+595 0981…" → "+595981…").
 */
export function phoneWithCountry(p: string, dial = "591"): string {
  const n = normalizePhone(p), d = n.replace(/\D/g, "");
  if (dial === "591") {
    if (!n.startsWith("+") && /^[67]\d{7}$/.test(d)) return `+591${d}`;
    if (!n.startsWith("+") && /^591[67]\d{7}$/.test(d)) return `+${d}`;
    return n;
  }
  if (n.startsWith("+")) return d.startsWith(`${dial}0`) && d.length > dial.length + 8 ? `+${dial}${d.slice(dial.length + 1)}` : n;
  if (!d) return n;
  if (d.startsWith("00") && d.length > 10) return `+${d.slice(2)}`;
  if (d.startsWith(dial) && d.length - dial.length >= 8) return `+${d}`;
  const local = d.replace(/^0+/, "");
  return local.length >= 6 && local.length <= 11 ? `+${dial}${local}` : n;
}

/** Clave para comparar números: con código de país (completo) o, si no lo tiene, solo los dígitos. */
function phoneKey(p: string): { full: boolean; d: string } {
  const n = phoneWithCountry(p);
  return n.startsWith("+") ? { full: true, d: n.replace(/\D/g, "") } : { full: false, d: n.replace(/\D/g, "").replace(/^0+/, "") };
}
/**
 * ¿Son el mismo número? Si los dos tienen código de país, tienen que ser iguales completos (así un
 * boliviano +591 71234567 y un paraguayo +595 971234567 nunca se confunden, aunque terminen igual).
 * Si a alguno le falta el código (datos viejos), se compara por los últimos 8 dígitos, como antes.
 */
export function samePhone(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const x = phoneKey(a), y = phoneKey(b);
  if (x.d.length < 7 || y.d.length < 7) return false;
  if (x.full && y.full) return x.d === y.d;
  return x.d.length >= 8 && y.d.length >= 8 && x.d.slice(-8) === y.d.slice(-8);
}
/** ¿Ya hay otro cliente con este número? (ver `samePhone`). */
export function phoneTaken(e: Engine, phone: string, exceptId?: Id): boolean {
  if (phone.replace(/\D/g, "").length < 7) return false;
  return Object.values(e.s.customers).some((x) => x.id !== exceptId && !!x.phone && samePhone(x.phone, phone));
}

export function findCustomerByPhone(e: Engine, phone: string) {
  const n = normalizePhone(phone);
  let c = Object.values(e.s.customers).find((x) => x.phone === n);
  if (!c) {
    // Tolerante: "70012345", "59170012345" y "+591 70012345" son el mismo número (si no hay dudas).
    const m = n.replace(/\D/g, "").length >= 8 ? Object.values(e.s.customers).filter((x) => x.phone && samePhone(x.phone, n)) : [];
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
    const cust: Customer = { id, name: input.name.trim(), phone, kind: "customer", priceGroupId: "final", whatsappConsent: !!input.whatsappConsent, createdAt: e.now(), ...(input.whatsappConsent ? { whatsappConsentAt: e.now(), whatsappConsentVia: "registro" as const } : {}) };
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
      // Un cliente en dólares sigue en su lista (cambiarla movería la moneda de su saldo).
      if (!isUsd(e, c)) c.priceGroupId = kind === "reseller" ? "revendedor" : "final";
      changed++;
    }
    e.audit(actor, "customer.bulk_kind", "customer", ids === "all" ? "*" : ids.join(",").slice(0, 200), { kind, changed });
    return { changed, skipped };
  });
}

/** La lista "revendedor" se crea sola la primera vez (sin precios propios usa el precio normal). Debe llamarse dentro de `tx`. */
export function ensureResellerGroup(e: Engine, id: Id): void {
  if (id === "revendedor" && !e.s.priceGroups.revendedor) e.s.priceGroups.revendedor = { id: "revendedor", name: "Revendedor", prices: {} };
}

export function createCustomer(e: Engine, actor: Actor, c: NewCustomer & { allowNoPhone?: boolean }): Customer {
  // El revendedor de otro país carga a sus clientes con SU código (Paraguay: 0981… → +595981…).
  const phone = phoneWithCountry(c.phone, dialFor(e, actor));
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
    if (phone && phoneTaken(e, phone)) throw new DomainError("VALIDATION", "Ya existe un cliente con ese teléfono");
    const email = c.email ? String(c.email).trim().toLowerCase() : undefined;
    // Un correo es de una sola persona: si no, alguien podría "adueñarse" del correo de otro.
    if (email && Object.values(e.s.customers).some((x) => (x.email ?? "").toLowerCase() === email)) throw new DomainError("VALIDATION", "Ese correo ya lo usa otra cuenta");
    const groupId = c.priceGroupId ?? "final";
    ensureResellerGroup(e, groupId);
    if (!e.s.priceGroups[groupId]) throw new DomainError("NOT_FOUND", `Grupo de precios ${groupId} no existe`);
    const id = e.id("cus");
    const cust: Customer = {
      id, name: c.name.trim(), phone, email, kind: c.kind ?? "customer", resellerId,
      priceGroupId: groupId, whatsappConsent: c.whatsappConsent ?? false, createdAt: e.now(),
      ...(c.whatsappConsent ? { whatsappConsentAt: e.now(), whatsappConsentVia: (actor.role === "reseller" ? "revendedor" : "panel") as ConsentVia } : {}),
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
  tag?: string;
}

/** Etiquetas de cliente que se pueden marcar (color para verlas de un vistazo). */
export const CUSTOMER_TAGS = ["vip", "moroso", "nuevo", "mayorista", "regalo"] as const;

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
    if (patch.tag !== undefined) {
      const t = String(patch.tag).trim().toLowerCase();
      if (t && !(CUSTOMER_TAGS as readonly string[]).includes(t)) throw new DomainError("VALIDATION", "Etiqueta inválida");
      if (t !== (c.tag ?? "")) { c.tag = t || undefined; changed.push("tag"); }
    }
    if (patch.kind !== undefined && patch.kind !== c.kind) {
      if (patch.kind === "customer" && Object.values(e.s.customers).some((x) => x.resellerId === c.id)) throw new DomainError("INVALID_STATE", "Este revendedor tiene clientes propios; no se puede pasar a cliente final");
      c.kind = patch.kind; changed.push("kind");
    }
    if (patch.priceGroupId !== undefined && patch.priceGroupId !== c.priceGroupId) {
      ensureResellerGroup(e, patch.priceGroupId);
      if (!e.s.priceGroups[patch.priceGroupId]) throw new DomainError("NOT_FOUND", "Grupo de precios inexistente");
      const from = groupCurrency(e, c.priceGroupId), to = groupCurrency(e, patch.priceGroupId);
      if (from !== to) {
        // Su saldo pasaría de Bs a US$ (o al revés): solo con saldo en 0 y sin pagos por revisar, así nunca se mezclan monedas.
        const bal = e.s.ledger.reduce((t, l) => (l.customerId === c.id ? t + l.amount : t), 0);
        const what = to === "USD" ? "a dólares" : "a Bs";
        if (bal !== 0) throw new DomainError("INVALID_STATE", `No se puede cambiar de lista: su saldo pasaría ${what} y tiene saldo. Dejalo en 0 (ajuste de saldo) y volvé a probar.`);
        if (pendingOrdersOf(e, c.id).length) throw new DomainError("INVALID_STATE", `No se puede cambiar de lista: su saldo pasaría ${what} y tiene pagos por revisar. Aprobalos o rechazalos primero.`);
      }
      c.priceGroupId = patch.priceGroupId; changed.push("priceGroupId");
    }
    e.audit(actor, "customer.update", "customer", c.id, { fields: changed.join(",") });
    return structuredClone(c);
  });
}

export function setWhatsappConsent(e: Engine, actor: Actor, customerId: Id, consent: boolean, via?: ConsentVia): void {
  const self = actor.customerId === customerId;
  if (!self && !can(actor, "customer.manage")) throw new DomainError("FORBIDDEN", "No podés cambiar el consentimiento de otro cliente");
  // Por dónde llegó: lo dice quien llama; si no, se deduce de quién es el actor.
  const v: ConsentVia = via ?? (String(actor.id).startsWith("wa:") ? "whatsapp" : self ? "cliente" : actor.role === "reseller" ? "revendedor" : "panel");
  e.tx(() => {
    const c = e.get("customers", customerId);
    c.whatsappConsent = consent;
    c.whatsappConsentAt = e.now();
    c.whatsappConsentVia = v;
    e.audit(actor, consent ? "consent.granted" : "consent.revoked", "customer", customerId, { via: v });
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
export function visibleTo(e: Engine, p: { id?: Id; published: boolean; resellersOnly?: boolean }, customerId?: Id): boolean {
  if (!p.published) return false;
  // Cliente en dólares: solo ve lo que tiene precio en su lista (nunca un precio en Bs).
  if (customerId && isUsd(e, customerId)) {
    const g = e.s.priceGroups[e.s.customers[customerId].priceGroupId];
    const id = p.id;
    if (!id || g?.prices[id] === undefined) return false;
  }
  const isReseller = !!customerId && e.s.customers[customerId]?.kind === "reseller";
  // "Solo lo de revendedores": el revendedor compra únicamente los productos marcados para revendedores…
  // …o los que el dueño le puso precio en SU lista (ej. Flujo TV en la lista en dólares de Panamá y Paraguay).
  if (isReseller && e.s.settings.resellerOnlyCatalog) {
    const g = e.s.priceGroups[e.s.customers[customerId!].priceGroupId];
    return !!p.resellersOnly || (!!p.id && g?.id !== "revendedor" && g?.prices[p.id] !== undefined);
  }
  if (!p.resellersOnly) return true;
  return isReseller;
}

export function publicCatalog(e: Engine, customerId?: Id) {
  if (customerId && isUsd(e, customerId)) {
    // Cliente en dólares: precios de su lista en US$ (sin "precio público" en Bs al lado).
    return Object.values(e.s.products).filter((p) => visibleTo(e, p, customerId)).map((p) => ({
      id: p.id, name: p.name, kind: p.kind, durationDays: p.durationDays,
      category: p.category ?? "Otros", description: p.description ?? "", color: p.color ?? "#3984ff", hasImage: !!p.imageFileRef, resellersOnly: !!p.resellersOnly,
      price: priceFor(e, customerId, p.id), currency: "USD" as const,
      ...(p.kind === "combo" && p.comboProductIds?.length ? { comboParts: p.comboProductIds } : {}),
      available: Object.values(e.s.slots).filter((s) => s.productId === p.id && s.status === "available").length,
    }));
  }
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
