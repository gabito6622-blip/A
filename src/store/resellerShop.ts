// Página propia de cada revendedor: /r/<slug>.
// - El revendedor elige su estilo, textos, logo, portada, precios y qué productos mostrar.
// - Es una vitrina: sus clientes le piden por WhatsApp al revendedor; él vende desde su panel con su saldo.
// - Nunca muestra el costo del revendedor, solo SU precio de venta. Sin precio cargado, el producto no aparece.
// - La tienda puede apagar todas las páginas o bloquear una en particular.
import type { Actor, Cents, Customer, Id, ResellerApp, ResellerCombo, ResellerShop, ShopRent, Testimonial } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { cleanLook } from "./look.js";
import { balance, post } from "./wallet.js";
import { DAY } from "./time.js";
import { normalizePhone } from "./catalog.js";

export const DEFAULT_RENT: ShopRent = { enabled: false, price: 3000, freeIfSpent: 20000, graceDays: 3 };
const rentCfg = (e: Engine): ShopRent => e.s.settings.shopRent ?? DEFAULT_RENT;
/** Lo que compró el revendedor (pagado por él) en los últimos 30 días. */
const spent30 = (e: Engine, id: Id) => Object.values(e.s.orders)
  .filter((o) => o.payerId === id && o.status === "fulfilled" && o.kind !== "topup" && o.channel !== "import" && e.now() - o.updatedAt <= 30 * DAY)
  .reduce((t, o) => t + o.total, 0);

/** Estado del alquiler de la página para mostrarle al revendedor. */
export function rentInfo(e: Engine, c: Customer) {
  const r = rentCfg(e);
  if (!r.enabled) return { enabled: false as const };
  return { enabled: true as const, price: r.price, freeIfSpent: r.freeIfSpent, graceDays: r.graceDays, paidUntil: c.shop?.paidUntil, suspended: !!c.shop?.suspended, spent30: spent30(e, c.id) };
}

/** Cobra un mes de alquiler (o lo da gratis por compras). Debe correr dentro de tx. */
function renewRent(e: Engine, actor: Actor, c: Customer): "free" | "charged" | "no_balance" {
  const r = rentCfg(e), s = c.shop!;
  const from = Math.max(s.paidUntil ?? e.now(), e.now() - 30 * DAY);
  if (r.freeIfSpent > 0 && spent30(e, c.id) >= r.freeIfSpent) {
    s.paidUntil = Math.max(from, e.now()) + 30 * DAY;
    delete s.suspended;
    e.audit(actor, "reseller.shop_rent_free", "customer", c.id, { until: s.paidUntil });
    return "free";
  }
  if (r.price === 0 || balance(e, c.id) >= r.price) {
    if (r.price > 0) post(e, actor, c.id, -r.price, "shop_rent", s.slug, "Alquiler de tu página (30 días)");
    s.paidUntil = Math.max(from, e.now()) + 30 * DAY;
    delete s.suspended;
    return "charged";
  }
  return "no_balance";
}

/**
 * Tarea diaria: cobra el alquiler de las páginas vencidas. Si no hay saldo, la página sigue
 * publicada los días de gracia y después se apaga sola; se prende sola apenas recarga y paga.
 */
export function chargeShopRents(e: Engine, actor: Actor) {
  const r = rentCfg(e);
  const now = e.now();
  const shops = Object.values(e.s.customers).filter((c) => c.kind === "reseller" && c.shop?.enabled && !c.shop.blocked);
  const due = r.enabled ? shops.filter((c) => (c.shop!.paidUntil ?? 0) <= now) : shops.filter((c) => c.shop!.suspended);
  const out = { charged: 0, free: 0, suspended: 0, started: 0 };
  if (!due.length) return out;
  e.tx(() => {
    for (const c of due) {
      const s = c.shop!;
      if (!r.enabled) { delete s.suspended; continue; }
      if (s.paidUntil === undefined) {
        // Primera vez: se cobra ya si puede; si no, vence hoy y corren los días de gracia.
        out.started++;
        const first = renewRent(e, actor, c);
        if (first === "no_balance") s.paidUntil = now;
        continue;
      }
      const res = renewRent(e, actor, c);
      if (res === "charged") out.charged++;
      else if (res === "free") out.free++;
      else if (!s.suspended && now > s.paidUntil + r.graceDays * DAY) {
        s.suspended = true;
        e.audit(actor, "reseller.shop_suspend", "customer", c.id, { reason: "rent" });
        out.suspended++;
      }
    }
  });
  return out;
}

/** El revendedor paga el mes ahora (desde su panel). */
export function payMyShopRent(e: Engine, actor: Actor) {
  const c = me(e, actor);
  if (!rentCfg(e).enabled) throw new DomainError("VALIDATION", "Tu página no tiene alquiler");
  if (!c.shop) throw new DomainError("VALIDATION", "Primero armá tu página");
  return e.tx(() => {
    const res = renewRent(e, actor, c);
    if (res === "no_balance") throw new DomainError("INSUFFICIENT_BALANCE", `Te falta saldo: el mes cuesta ${(rentCfg(e).price / 100).toFixed(0)} Bs`);
    return rentInfo(e, c);
  });
}

/* ---------------- Solicitudes para ser revendedor ---------------- */

export function applyReseller(e: Engine, input: { name: unknown; phone: unknown; note?: unknown; ref?: unknown }): { ok: true; already?: "reseller" | "pending" } {
  const name = String(input.name ?? "").trim().slice(0, 80);
  const phone = normalizePhone(String(input.phone ?? ""));
  if (!name || phone.replace(/\D/g, "").length < 7) throw new DomainError("VALIDATION", "Escribí tu nombre y tu WhatsApp con código de país");
  const note = String(input.note ?? "").trim().slice(0, 300);
  // Referido: solo vale si apunta a un revendedor existente y no es uno mismo.
  const refId = String(input.ref ?? "").trim();
  const ref = refId && e.s.customers[refId]?.kind === "reseller" && e.s.customers[refId]?.phone !== phone ? refId : undefined;
  const existing = Object.values(e.s.customers).find((c) => c.phone === phone);
  if (existing?.kind === "reseller") return { ok: true, already: "reseller" };
  const apps = (e.s.resellerApps ??= {});
  if (Object.values(apps).some((a) => a.phone === phone && a.status === "pending")) return { ok: true, already: "pending" };
  if (Object.values(apps).filter((a) => a.status === "pending").length >= 300) throw new DomainError("VALIDATION", "Hay muchas solicitudes pendientes. Escribinos por WhatsApp.");
  const sys: Actor = { id: "system:solicitud", role: "system" };
  e.tx(() => {
    const a: ResellerApp = { id: e.id("app"), name, phone, ...(note ? { note } : {}), ...(ref ? { ref } : {}), createdAt: e.now(), status: "pending" };
    e.s.resellerApps[a.id] = a;
    e.audit(sys, "reseller.apply", "reseller_app", a.id, ref ? { ref } : {});
  });
  return { ok: true };
}

export function listApps(e: Engine, actor: Actor) {
  authorize(actor, "customer.manage");
  return Object.values(e.s.resellerApps ?? {}).sort((a, b) => b.createdAt - a.createdAt).slice(0, 100).map((a) => ({ ...a, existingCustomer: !!Object.values(e.s.customers).find((c) => c.phone === a.phone) }));
}

/** Aprueba: crea el revendedor (o pasa a revendedor al cliente que ya existía) y devuelve su id. */
export function approveApp(e: Engine, actor: Actor, id: Id): { customerId: Id; name: string; phone: string } {
  authorize(actor, "customer.manage");
  return e.tx(() => {
    const a = e.get("resellerApps", id);
    if (a.status !== "pending") throw new DomainError("INVALID_STATE", "Esa solicitud ya se resolvió");
    let c = Object.values(e.s.customers).find((x) => x.phone === a.phone);
    const wasReseller = c?.kind === "reseller";
    if (c) { c.kind = "reseller"; c.priceGroupId = "revendedor"; }
    else {
      c = { id: e.id("cus"), name: a.name, phone: a.phone, kind: "reseller", priceGroupId: "revendedor", whatsappConsent: true, createdAt: e.now() } as Customer;
      e.s.customers[c.id] = c;
    }
    if (!e.s.priceGroups.revendedor) e.s.priceGroups.revendedor = { id: "revendedor", name: "Revendedor", prices: {} };
    a.status = "approved"; a.customerId = c.id; a.decidedBy = actor.id; a.decidedAt = e.now();
    e.audit(actor, "reseller.approve", "reseller_app", a.id, { customerId: c.id });
    // Premio por referido: se paga una sola vez, al convertir en revendedor a alguien que no lo era,
    // si la solicitud trae un referidor válido (y no es él mismo) y el dueño configuró un premio > 0.
    const bonus = e.s.settings.referralBonus ?? 0;
    const ref = a.ref && e.s.customers[a.ref]?.kind === "reseller" && a.ref !== c.id ? a.ref : undefined;
    if (!wasReseller && ref && !c.referredBy) {
      c.referredBy = ref;
      if (bonus > 0) {
        post(e, actor, ref, bonus, "referral", c.id, `Premio por traer a ${c.name}`);
        e.audit(actor, "reseller.referral_paid", "customer", ref, { referred: c.id, amount: bonus });
      }
    }
    return { customerId: c.id, name: c.name, phone: c.phone };
  });
}

export function rejectApp(e: Engine, actor: Actor, id: Id) {
  authorize(actor, "customer.manage");
  e.tx(() => {
    const a = e.get("resellerApps", id);
    if (a.status !== "pending") throw new DomainError("INVALID_STATE", "Esa solicitud ya se resolvió");
    a.status = "rejected"; a.decidedBy = actor.id; a.decidedAt = e.now();
    e.audit(actor, "reseller.reject", "reseller_app", a.id, {});
  });
}

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

/** ¿Este revendedor puede tener su página propia (plan premium)? Los que ya tenían página siguen habilitados. */
export function pageAllowed(e: Engine, c: Customer): boolean {
  return c.pageAllowed ?? !!c.shop;
}

/** El dueño prende o apaga el plan "página propia" de un revendedor. Al apagarlo, su página deja de verse. */
export function setResellerPage(e: Engine, actor: Actor, customerId: Id, allowed: boolean) {
  authorize(actor, "customer.manage");
  return e.tx(() => {
    const c = e.get("customers", customerId);
    if (c.kind !== "reseller") throw new DomainError("VALIDATION", "Primero pasalo a revendedor");
    c.pageAllowed = !!allowed;
    if (!allowed && c.shop) c.shop.enabled = false;
    e.audit(actor, allowed ? "reseller.page_enable" : "reseller.page_disable", "customer", c.id, {});
    return { pageAllowed: !!allowed };
  });
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
  const canPage = pageAllowed(e, c);
  return { ...structuredClone(s), saved: !!c.shop, hasLogo: !!s.logoFileRef, hasBanner: !!s.bannerFileRef, pageAllowed: canPage, allowed: canPage && e.s.settings.resellerShops !== false, rent: rentInfo(e, c), marginPct: e.s.settings.resellerMarginPct ?? 30 };
}

export function updateMyShop(e: Engine, actor: Actor, patch: Record<string, unknown>) {
  const c = me(e, actor);
  if (!pageAllowed(e, c)) throw new DomainError("FORBIDDEN", "Tu plan es solo panel: la tienda todavía no te habilitó tu página propia.");
  applyShop(e, actor, c, patch);
  return myShop(e, actor);
}

/** El dueño (o su equipo) arma la página de un revendedor: dirección, nombre, WhatsApp y si está publicada. */
export function setupShopFor(e: Engine, actor: Actor, customerId: Id, patch: Record<string, unknown>) {
  authorize(actor, "customer.manage");
  const c = e.get("customers", customerId);
  if (c.kind !== "reseller") throw new DomainError("VALIDATION", "Primero pasalo a revendedor");
  if (c.pageAllowed !== true) c.pageAllowed = true; // el dueño le está armando/habilitando la página
  const allowed = Object.fromEntries(Object.entries(patch).filter(([k]) => ["slug", "title", "whatsapp", "enabled"].includes(k)));
  applyShop(e, actor, c, allowed);
  const s = e.s.customers[customerId].shop!;
  return { slug: s.slug, title: s.title, enabled: s.enabled, whatsapp: s.whatsapp };
}

/** Revendedores con su página, saldo y servicios (para el panel). */
export function resellersOverview(e: Engine, actor: Actor) {
  authorize(actor, "customer.manage");
  const active = Object.values(e.s.assignments).filter((a) => a.status === "active");
  const refCount: Record<Id, number> = {};
  for (const x of Object.values(e.s.customers)) if (x.referredBy) refCount[x.referredBy] = (refCount[x.referredBy] ?? 0) + 1;
  return Object.values(e.s.customers).filter((c) => c.kind === "reseller").map((c) => {
    const s = c.shop ?? defaults(e, c);
    const mine = active.filter((a) => a.customerId === c.id || e.s.customers[a.customerId]?.resellerId === c.id);
    return {
      id: c.id, name: c.name, phone: c.phone, createdAt: c.createdAt, balance: balance(e, c.id),
      codeLink: !!c.codeLink, services: mine.length, referrals: refCount[c.id] ?? 0, clients: Object.values(e.s.customers).filter((x) => x.resellerId === c.id).length,
      pageAllowed: pageAllowed(e, c),
      shop: { slug: s.slug, title: s.title, enabled: !!c.shop?.enabled, saved: !!c.shop, blocked: !!c.shop?.blocked, suspended: !!c.shop?.suspended, paidUntil: c.shop?.paidUntil },
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
  if (patch.comboDiscounts !== undefined) {
    const d = patch.comboDiscounts;
    if (!Array.isArray(d) || d.length !== 3 || d.some((v) => !Number.isInteger(v) || v < 0 || v > 1_000_000)) throw new DomainError("VALIDATION", "Descuentos de combo inválidos");
    p.comboDiscounts = d.map((v) => v as Cents) as [Cents, Cents, Cents];
  }
  if (patch.combos !== undefined) {
    if (!Array.isArray(patch.combos) || patch.combos.length > 40) throw new DomainError("VALIDATION", "Lista de combos inválida (máximo 40)");
    const priced = c.resellerPrices ?? {};
    p.combos = (patch.combos as Record<string, unknown>[]).map((raw) => {
      const name = String(raw.name ?? "").trim().slice(0, 40);
      if (!name) throw new DomainError("VALIDATION", "Cada combo necesita un nombre");
      const ids = Array.isArray(raw.productIds) ? [...new Set(raw.productIds.map(String))] : [];
      if (ids.length < 2 || ids.length > 12) throw new DomainError("VALIDATION", `El combo "${name}" tiene que juntar de 2 a 12 apps`);
      for (const id of ids) if (priced[id] === undefined) throw new DomainError("VALIDATION", `El combo "${name}" incluye una app sin precio`);
      const price = Number(raw.price);
      if (!Number.isInteger(price) || price <= 0 || price > 10_000_000) throw new DomainError("VALIDATION", `Poné un precio válido para el combo "${name}"`);
      const note = raw.note ? String(raw.note).trim().slice(0, 120) : undefined;
      const id = typeof raw.id === "string" && /^[a-z0-9]{3,24}$/.test(raw.id) ? raw.id : e.id("rcm").replace(/[^a-z0-9]/gi, "").toLowerCase().slice(0, 24);
      return { id, name, productIds: ids, price, ...(note ? { note } : {}) } as ResellerCombo;
    });
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

/** Preguntas frecuentes editables de la tienda. */
export function setFaq(e: Engine, actor: Actor, list: unknown): { q: string; a: string }[] {
  authorize(actor, "catalog.manage");
  if (!Array.isArray(list) || list.length > 12) throw new DomainError("VALIDATION", "Hasta 12 preguntas");
  const clean = list.map((t, i): { q: string; a: string } => {
    const o = (t ?? {}) as Record<string, unknown>;
    const q = String(o.q ?? "").trim(), a = String(o.a ?? "").trim();
    if (!q || q.length > 140) throw new DomainError("VALIDATION", `Pregunta ${i + 1}: va de 1 a 140 letras`);
    if (!a || a.length > 500) throw new DomainError("VALIDATION", `Respuesta ${i + 1}: va de 1 a 500 letras`);
    return { q, a };
  });
  return e.tx(() => {
    e.s.settings.faq = clean;
    e.audit(actor, "faq.update", "settings", "faq", { count: clean.length });
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
  if (!c || c.kind !== "reseller" || !c.shop?.enabled || c.shop.blocked || c.shop.suspended || !pageAllowed(e, c) || e.s.settings.resellerShops === false) return undefined;
  return c;
}

/** Datos públicos de la página (sin costos ni datos internos). `preview` deja verla al propio revendedor aunque esté apagada. */
export function publicShop(e: Engine, slug: string, viewer?: Actor) {
  let c = findBySlug(e, slug);
  if (!c && viewer?.role === "reseller") {
    const own = viewer.customerId ? e.s.customers[viewer.customerId] : undefined;
    if (own?.shop?.slug === String(slug).toLowerCase() && !own.shop.blocked && pageAllowed(e, own)) c = own;
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
  for (const [k, v] of Object.entries(s)) if (!["slug", "enabled", "blocked", "logoFileRef", "bannerFileRef", "products", "whatsapp", "title", "combos", "comboDiscounts"].includes(k)) look[k] = v;
  // Los combos propios del revendedor se muestran como tarjetas de catálogo.
  const nameOf = (id: Id) => e.s.products[id]?.name ?? id;
  const comboCards = (s.combos ?? []).filter((cb) => cb.productIds.every((id) => c!.resellerPrices?.[id] !== undefined)).map((cb) => ({
    id: `rc_${cb.id}`, name: cb.name, category: "Combos", description: cb.note || cb.productIds.map(nameOf).join(" + "), color: "#7c5cff",
    hasImage: false, kind: "combo" as const, durationDays: 30, price: cb.price, available: 99, items: cb.productIds.map(nameOf),
  }));
  return {
    slug: s.slug, title: s.title, whatsapp: s.whatsapp, hasLogo: !!s.logoFileRef, hasBanner: !!s.bannerFileRef, published: s.enabled,
    comboDiscounts: s.comboDiscounts && s.comboDiscounts.some((v) => v > 0) ? s.comboDiscounts : null,
    ...look, products: [...comboCards, ...products],
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

/** Lo que ve un revendedor en "Referí y ganá": su código, cuánto paga el premio y a quién trajo. */
export function myReferrals(e: Engine, actor: Actor) {
  const c = me(e, actor);
  const bonus = e.s.settings.referralBonus ?? 0;
  const people = Object.values(e.s.customers)
    .filter((x) => x.referredBy === c.id)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map((x) => ({ name: x.name, at: x.createdAt }));
  const earned = e.s.ledger
    .filter((l) => l.customerId === c.id && l.type === "referral")
    .reduce((t, l) => t + l.amount, 0);
  return { code: c.id, bonus, enabled: bonus > 0, count: people.length, earned, people };
}
