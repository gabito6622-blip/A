// Página propia de cada revendedor: /r/<slug>.
// - El revendedor elige su estilo, textos, logo, portada, precios y qué productos mostrar.
// - Es una vitrina: sus clientes le piden por WhatsApp al revendedor; él vende desde su panel con su saldo.
// - Nunca muestra el costo del revendedor, solo SU precio de venta. Sin precio cargado, el producto no aparece.
// - La tienda puede apagar todas las páginas o bloquear una en particular.
import type { Actor, Customer, Id, ResellerShop, Testimonial } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { cleanLook } from "./look.js";
import { balance } from "./wallet.js";

const RESERVED = new Set(["api", "panel", "admin", "r", "www", "tienda", "store", "login", "static", "assets", "gabriel", "gabrielstore", "soporte", "ayuda"]);

function slugify(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
}

function me(e: Engine, actor: Actor): Customer {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const c = e.get("customers", actor.customerId);
  if (c.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return c;
}

function defaults(e: Engine, c: Customer): ResellerShop {
  let base = slugify(c.name) || "tienda";
  if (base.length < 3 || RESERVED.has(base)) base = `tienda-${base}`.slice(0, 30);
  let slug = base;
  for (let i = 2; Object.values(e.s.customers).some((x) => x.id !== c.id && x.shop?.slug === slug); i++) slug = `${base.slice(0, 26)}-${i}`;
  return {
    slug, enabled: false, title: c.name, whatsapp: c.phone.replace(/\D/g, ""),
    accentColor: "#7c5cff", accent2Color: "#00d4ff", backgroundColor: "#0b0b14", bgStyle: "glow", cardStyle: "glass",
    fontFamily: "poppins", headingFont: "poppins", corners: "round",
    heroTitle: "Tus plataformas favoritas,", heroHighlight: "al mejor precio.", heroText: "Netflix, Spotify, Disney+ y más. Pedí por WhatsApp y te lo activo al toque.",
    heroChip: "✦ Entrega inmediata", heroTicks: "Atención rápida, Garantía, Precios en Bs",
  };
}

/** Configuración actual de la página del revendedor (con valores iniciales si nunca la armó). */
export function myShop(e: Engine, actor: Actor) {
  const c = me(e, actor);
  const s = c.shop ?? defaults(e, c);
  return { ...structuredClone(s), saved: !!c.shop, hasLogo: !!s.logoFileRef, hasBanner: !!s.bannerFileRef, allowed: e.s.settings.resellerShops !== false };
}

export function updateMyShop(e: Engine, actor: Actor, patch: Record<string, unknown>) {
  const c = me(e, actor);
  applyShop(e, actor, c, patch);
  return myShop(e, actor);
}

/** El dueño (o su equipo) arma la página de un revendedor: dirección, nombre, WhatsApp y si está publicada. */
export function setupShopFor(e: Engine, actor: Actor, customerId: Id, patch: Record<string, unknown>) {
  authorize(actor, "customer.manage");
  const c = e.get("customers", customerId);
  if (c.kind !== "reseller") throw new DomainError("VALIDATION", "Primero pasalo a revendedor");
  const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => ["slug", "title", "whatsapp", "enabled"].includes(k)));
  applyShop(e, actor, c, allowed);
  const s = e.s.customers[customerId].shop!;
  return { slug: s.slug, title: s.title, enabled: s.enabled, whatsapp: s.whatsapp };
}

/** Revendedores con su página, saldo y servicios (para el panel). */
export function resellersOverview(e: Engine, actor: Actor) {
  authorize(actor, "customer.manage");
  const active = Object.values(e.s.assignments).filter((a) => a.status === "active");
  return Object.values(e.s.customers).filter((c) => c.kind === "reseller").map((c) => {
    const s = c.shop ?? defaults(e, c);
    const mine = active.filter((a) => a.customerId === c.id || e.s.customers[a.customerId]?.resellerId === c.id);
    return {
      id: c.id, name: c.name, phone: c.phone, createdAt: c.createdAt, balance: balance(e, c.id),
      codeLink: !!c.codeLink, services: mine.length, clients: Object.values(e.s.customers).filter((x) => x.resellerId === c.id).length,
      shop: { slug: s.slug, title: s.title, enabled: !!c.shop?.enabled, saved: !!c.shop, blocked: !!c.shop?.blocked },
    };
  }).sort((a, b) => b.createdAt - a.createdAt);
}

function applyShop(e: Engine, actor: Actor, c: Customer, patch: Record<string, unknown>) {
  const look = cleanLook(patch);
  const p: Partial<ResellerShop> = {};
  if (patch.slug !== undefined) {
    const slug = String(patch.slug).trim().toLowerCase();
    if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(slug)) throw new DomainError("VALIDATION", "Dirección: de 3 a 30 letras minúsculas, números o guiones (sin espacios)");
    if (RESERVED.has(slug)) throw new DomainError("VALIDATION", "Esa dirección está reservada, probá otra");
    if (Object.values(e.s.customers).some((x) => x.id !== c.id && x.shop?.slug === slug)) throw new DomainError("VALIDATION", "Esa dirección ya la usa otro revendedor");
    p.slug = slug;
  }
  if (patch.title !== undefined) {
    const t = String(patch.title).trim();
    if (!t || t.length > 40) throw new DomainError("VALIDATION", "Nombre de tu página: de 1 a 40 letras");
    p.title = t;
  }
  if (patch.whatsapp !== undefined) {
    const w = String(patch.whatsapp).replace(/\D/g, "");
    if (!/^\d{8,15}$/.test(w)) throw new DomainError("VALIDATION", "WhatsApp: con código de país, p. ej. 59170000000");
    p.whatsapp = w.length === 8 ? "591" + w : w;
  }
  if (patch.enabled !== undefined) p.enabled = !!patch.enabled;
  if (patch.products !== undefined) {
    if (!Array.isArray(patch.products) || patch.products.length > 200) throw new DomainError("VALIDATION", "Lista de productos inválida");
    for (const id of patch.products) if (typeof id !== "string" || !e.s.products[id]) throw new DomainError("NOT_FOUND", `Producto inexistente: ${String(id)}`);
    p.products = [...new Set(patch.products as string[])];
  }
  return e.tx(() => {
    const cur = c.shop ?? defaults(e, c);
    if (p.enabled && e.s.settings.resellerShops === false) throw new DomainError("FORBIDDEN", "La tienda no tiene habilitadas las páginas de revendedores");
    c.shop = { ...cur, ...look, ...p };
    e.audit(actor, "reseller.shop_update", "customer", c.id, { fields: [...Object.keys(look), ...Object.keys(p)].join(","), slug: c.shop.slug });
  });
}

/** Cambia el logo o la portada. Devuelve el archivo anterior para borrarlo. */
export function setMyShopImage(e: Engine, actor: Actor, kind: "logo" | "banner", fileRef: string | null): string | undefined {
  const c = me(e, actor);
  return e.tx(() => {
    const cur = c.shop ?? defaults(e, c);
    const key = kind === "logo" ? "logoFileRef" : "bannerFileRef";
    const old = cur[key];
    c.shop = { ...cur, [key]: fileRef ?? undefined };
    if (!fileRef) delete c.shop[key];
    e.audit(actor, `reseller.shop_${kind}`, "customer", c.id, { removed: !fileRef });
    return old;
  });
}

/** El staff destaca (o no) la página de un revendedor en el directorio. */
export function setShopFeatured(e: Engine, actor: Actor, customerId: Id, featured: boolean) {
  authorize(actor, "catalog.manage");
  return e.tx(() => {
    const c = e.get("customers", customerId);
    if (!c.shop) throw new DomainError("NOT_FOUND", "Ese revendedor no armó su página");
    c.shop.featured = !!featured;
    e.audit(actor, featured ? "reseller.shop_feature" : "reseller.shop_unfeature", "customer", c.id, { slug: c.shop.slug });
    return { slug: c.shop.slug, featured: c.shop.featured };
  });
}

/** Opiniones de revendedores para /revendedores. Solo el dueño o un admin las cargan. */
export function setTestimonials(e: Engine, actor: Actor, list: unknown): Testimonial[] {
  authorize(actor, "catalog.manage");
  if (!Array.isArray(list) || list.length > 12) throw new DomainError("VALIDATION", "Hasta 12 opiniones");
  const clean = list.map((t, i): Testimonial => {
    const o = (t ?? {}) as Record<string, unknown>;
    const name = String(o.name ?? "").trim(), text = String(o.text ?? "").trim(), business = String(o.business ?? "").trim();
    if (!name || name.length > 60) throw new DomainError("VALIDATION", `Opinión ${i + 1}: el nombre va de 1 a 60 letras`);
    if (!text || text.length > 400) throw new DomainError("VALIDATION", `Opinión ${i + 1}: el texto va de 1 a 400 letras`);
    if (business.length > 60) throw new DomainError("VALIDATION", `Opinión ${i + 1}: la tienda va hasta 60 letras`);
    const rating = o.rating === undefined || o.rating === null || o.rating === "" ? undefined : Number(o.rating);
    if (rating !== undefined && !(Number.isInteger(rating) && rating >= 1 && rating <= 5)) throw new DomainError("VALIDATION", `Opinión ${i + 1}: estrellas de 1 a 5`);
    return { name, text, ...(business ? { business } : {}), ...(rating ? { rating } : {}) };
  });
  return e.tx(() => {
    e.s.settings.testimonials = clean;
    e.audit(actor, "testimonials.update", "settings", "testimonials", { count: clean.length });
    return structuredClone(clean);
  });
}

/** El staff bloquea o desbloquea la página de un revendedor. */
export function setShopBlocked(e: Engine, actor: Actor, customerId: Id, blocked: boolean) {
  authorize(actor, "catalog.manage");
  return e.tx(() => {
    const c = e.get("customers", customerId);
    if (!c.shop) throw new DomainError("NOT_FOUND", "Ese revendedor no armó su página");
    c.shop.blocked = !!blocked;
    e.audit(actor, blocked ? "reseller.shop_block" : "reseller.shop_unblock", "customer", c.id, { slug: c.shop.slug });
    return { slug: c.shop.slug, blocked: c.shop.blocked };
  });
}

function findBySlug(e: Engine, slug: string): Customer | undefined {
  const c = Object.values(e.s.customers).find((x) => x.shop?.slug === String(slug).toLowerCase());
  if (!c || c.kind !== "reseller" || !c.shop?.enabled || c.shop.blocked || e.s.settings.resellerShops === false) return undefined;
  return c;
}

/** Datos públicos de la página (sin costos ni datos internos). `preview` deja verla al propio revendedor aunque esté apagada. */
export function publicShop(e: Engine, slug: string, viewer?: Actor) {
  let c = findBySlug(e, slug);
  if (!c && viewer?.role === "reseller") {
    const own = viewer.customerId ? e.s.customers[viewer.customerId] : undefined;
    if (own?.shop?.slug === String(slug).toLowerCase() && !own.shop.blocked) c = own;
  }
  if (!c) throw new DomainError("NOT_FOUND", "Esta página no existe o no está publicada");
  const s = c.shop!;
  const stock: Record<Id, number> = {};
  for (const sl of Object.values(e.s.slots)) if (sl.status === "available") stock[sl.productId] = (stock[sl.productId] ?? 0) + 1;
  const show = s.products?.length ? new Set(s.products) : null;
  const products = Object.values(e.s.products)
    .filter((p) => p.published && c!.resellerPrices?.[p.id] !== undefined && (!show || show.has(p.id)))
    .map((p) => ({ id: p.id, name: p.name, category: p.category ?? "Otros", description: p.description ?? "", color: p.color ?? "#3984ff", hasImage: !!p.imageFileRef, kind: p.kind, durationDays: p.durationDays, price: c!.resellerPrices![p.id], available: Math.min(stock[p.id] ?? 0, 20) }));
  const look: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(s)) if (!["slug", "enabled", "blocked", "logoFileRef", "bannerFileRef", "products", "whatsapp", "title"].includes(k)) look[k] = v;
  return {
    slug: s.slug, title: s.title, whatsapp: s.whatsapp, hasLogo: !!s.logoFileRef, hasBanner: !!s.bannerFileRef, published: s.enabled,
    ...look, products,
  };
}

export function shopImage(e: Engine, slug: string, kind: "logo" | "banner", viewer?: Actor): string | undefined {
  let c = findBySlug(e, slug);
  if (!c && viewer?.customerId) {
    const own = e.s.customers[viewer.customerId];
    if (own?.shop?.slug === slug) c = own;
  }
  return kind === "logo" ? c?.shop?.logoFileRef : c?.shop?.bannerFileRef;
}

/** Para el panel: todas las páginas de revendedores. */
export function listShops(e: Engine, actor: Actor) {
  authorize(actor, "catalog.manage");
  return Object.values(e.s.customers).filter((c) => c.shop).map((c) => ({ customerId: c.id, name: c.name, slug: c.shop!.slug, title: c.shop!.title, enabled: c.shop!.enabled, blocked: !!c.shop!.blocked, featured: !!c.shop!.featured }));
}

/**
 * Datos públicos para la página /revendedores (la que convence a nuevos revendedores).
 * Todo sale de datos reales: catálogo, precio de revendedor (si el dueño lo permite) y páginas publicadas.
 */
export function programInfo(e: Engine) {
  const st = e.s.settings;
  const published = Object.values(e.s.products).filter((p) => p.published && !p.resellersOnly);
  // Grupo de precios de revendedor: el que más usan los revendedores; si no, el llamado "revendedor".
  const count: Record<Id, number> = {};
  for (const c of Object.values(e.s.customers)) if (c.kind === "reseller") count[c.priceGroupId] = (count[c.priceGroupId] ?? 0) + 1;
  const gid = Object.entries(count).sort((a, b) => b[1] - a[1])[0]?.[0] ?? (e.s.priceGroups.revendedor ? "revendedor" : undefined);
  const group = gid ? e.s.priceGroups[gid] : undefined;
  const showPrices = st.resellerProgramPrices !== false && !!group;
  const shopsOn = st.resellerShops !== false;
  const shops = shopsOn ? Object.values(e.s.customers)
    .filter((c) => c.kind === "reseller" && c.shop?.enabled && !c.shop.blocked)
    .sort((a, b) => Number(!!b.shop!.featured) - Number(!!a.shop!.featured))
    .slice(0, 60)
    .map((c) => {
      const sh = c.shop!;
      const show = sh.products?.length ? new Set(sh.products) : null;
      const cats = [...new Set(published.filter((p) => c.resellerPrices?.[p.id] !== undefined && (!show || show.has(p.id))).map((p) => p.category ?? "Otros"))].slice(0, 4);
      return {
        slug: sh.slug, title: sh.title, featured: !!sh.featured, hasLogo: !!sh.logoFileRef, hasBanner: !!sh.bannerFileRef, tagline: (sh.heroChip || sh.heroText || "").slice(0, 90), tags: cats,
        accentColor: sh.accentColor, accent2Color: sh.accent2Color, backgroundColor: sh.backgroundColor, headingFont: sh.headingFont,
      };
    }) : [];
  return {
    storeName: st.storeName, whatsapp: st.whatsapp, showPrices, shopsEnabled: shopsOn, testimonials: structuredClone(st.testimonials ?? []),
    stats: { products: published.length, categories: new Set(published.map((p) => p.category ?? "Otros")).size, shops: shops.length },
    products: showPrices ? published.filter((p) => group!.prices[p.id] !== undefined && group!.prices[p.id] < p.price)
      .map((p) => ({ id: p.id, name: p.name, category: p.category ?? "Otros", color: p.color ?? "#3984ff", durationDays: p.durationDays, public: p.price, reseller: group!.prices[p.id] }))
      .sort((a, b) => (b.public - b.reseller) - (a.public - a.reseller)).slice(0, 12) : [],
    shops,
  };
}
