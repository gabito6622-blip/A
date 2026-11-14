// Centro de exportaciones (13/11/2026): catálogos (WhatsApp y PDF) y reporte Excel para la tienda y para
// cada revendedor de GaboHub. Reglas:
//  - Una sola fuente de datos (`catalogData`) para los tres formatos: los precios salen de las mismas
//    funciones que usan la tienda pública y la página /r/<slug> (publicCatalog, resellerPrices, toMine).
//  - Solo productos publicados y con precio. Nunca costos, ganancias, claves, clientes ni ids internos.
//  - El revendedor exporta SOLO lo suyo: su nombre, su logo, su WhatsApp, sus precios, sus combos y sus cupones.
//  - Nada se manda solo: el texto de WhatsApp se copia o se abre en WhatsApp con el mensaje preparado.
import type { Actor, Cents, Customer, Id } from "../store/types.js";
import type { GabrielStore } from "../store/index.js";
import { DomainError } from "../store/errors.js";
import { publicCatalog, isIndependent } from "../store/catalog.js";
import { localeOf, toMine } from "../store/country.js";
import { pageAllowed } from "../store/resellerShop.js";
import { pageCards } from "../store/ownStock.js";
import { listCoupons } from "../store/coupons.js";

export interface CatalogItem {
  id: Id;
  name: string;
  category: string;
  description: string;
  /** Precio de venta en la moneda del negocio (centavos). */
  price: Cents;
  durationDays: number;
  kind: string;
  /** Combos: qué apps incluye. */
  items?: string[];
  /** Combos de la tienda: ids de las apps (para los logos). */
  partIds?: Id[];
  color: string;
  /** Tiene logo propio en la tienda (se ve en la vista previa y en el PDF). */
  hasImage?: boolean;
  /** Archivo del logo (solo en el servidor: el JSON no lo lleva). */
  imageRef?: string;
  /** Combos: cuánto ahorra el cliente frente a comprar las apps sueltas (centavos), calculado con los precios de hoy. */
  savings?: Cents;
}
export interface CatalogData {
  /** true = la tienda (dueño); false = un revendedor. */
  owner: boolean;
  business: {
    name: string;
    whatsapp: string;
    /** Dirección pública de la tienda o de su página (si está publicada). */
    url?: string;
    logoRef?: string;
    accent: string; accent2: string; background: string; headingFont: string;
    hours?: string;
    announcement?: string;
    instagram?: string; tiktok?: string; facebook?: string;
    footer?: string;
  };
  currency: { symbol: string; decimals: number; code: string };
  categories: { name: string; items: CatalogItem[] }[];
  /** Promociones vigentes en texto simple («Cupón NAVIDAD: 10 % hasta el 24/12»). */
  promos: string[];
  generatedAt: number;
}

/** Logo del producto: el suyo o, si no tiene, el de la app del mismo nombre comercial («Disney+ (alquiler…)» usa el de «Disney+»). */
function imageRefOf(products: Record<Id, { name: string; kind: string; imageFileRef?: string }>, id: Id): string | undefined {
  const p = products[id];
  if (!p) return undefined;
  if (p.imageFileRef) return p.imageFileRef;
  const name = p.name.replace(/\s*[([][^)\]]*[)\]]/g, " ").replace(/\s{2,}/g, " ").trim().toLowerCase();
  return Object.values(products).find((x) => x.imageFileRef && x.kind !== "combo" && x.name.replace(/\s*[([][^)\]]*[)\]]/g, " ").replace(/\s{2,}/g, " ").trim().toLowerCase() === name)?.imageFileRef;
}
/** Los archivos de logo que hace falta cargar para el PDF: los de cada ítem y los de las partes de los combos. */
export function catalogImageRefs(d: CatalogData, products: Record<Id, { name: string; kind: string; imageFileRef?: string }>): Map<Id, string> {
  const m = new Map<Id, string>();
  for (const c of d.categories) for (const it of c.items) {
    if (it.imageRef) m.set(it.id, it.imageRef);
    for (const pid of it.partIds ?? []) { const r = imageRefOf(products, pid); if (r) m.set(pid, r); }
  }
  return m;
}
/** Los combos son las promos del negocio: van primero, con ese nombre. */
export const PROMO_CAT = "Promos y combos";
const savingsOf = (price: Cents, parts: (Cents | undefined)[]): Cents | undefined => {
  if (!parts.length || parts.some((v) => v === undefined)) return undefined;
  const sum = (parts as Cents[]).reduce((acc: number, v: Cents) => acc + v, 0);
  return sum > price ? sum - price : undefined;
};
const CAT_ORDER = [PROMO_CAT, "Combos", "Streaming", "Música", "Series y películas", "Deportes", "Herramientas", "Mis servicios", "Otros"];
const catRank = (name: string) => { const i = CAT_ORDER.indexOf(name); return i === -1 ? 50 : i; };

export const fdate = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));

/** Monto con el símbolo del negocio: Bs 35 · Bs 35,50 · US$ 4,50 · ₲ 25.000. */
export function money(cents: Cents, cur: { symbol: string; decimals: number }): string {
  const v = cents / 100;
  const whole = cur.decimals === 0 || Math.abs(v - Math.round(v)) < 1e-9;
  const n = new Intl.NumberFormat("es-BO", { minimumFractionDigits: whole ? 0 : cur.decimals, maximumFractionDigits: cur.decimals }).format(v);
  return `${cur.symbol} ${n}`;
}

function group(items: CatalogItem[]): CatalogData["categories"] {
  const m = new Map<string, CatalogItem[]>();
  for (const it of items) m.set(it.category, [...(m.get(it.category) ?? []), it]);
  return [...m.entries()].map(([name, list]) => ({ name, items: list.sort((a, b) => a.price - b.price || a.name.localeCompare(b.name, "es")) }))
    .sort((a, b) => catRank(a.name) - catRank(b.name) || a.name.localeCompare(b.name, "es"));
}

const comboPromo = (d: Cents[] | undefined, cur: { symbol: string; decimals: number }) => {
  if (!d || !d.some((v) => v > 0)) return null;
  const parts: string[] = [];
  if (d[0] > 0) parts.push(`2 apps: ${money(d[0], cur)} menos`);
  if (d[1] > 0) parts.push(`3 apps: ${money(d[1], cur)} menos`);
  if (d[2] > 0) parts.push(`4 o más: ${money(d[2], cur)} menos`);
  return `Armá tu combo · ${parts.join(" · ")}`;
};
const couponPromo = (c: { code: string; type: "percent" | "fixed"; value: number; expiresAt?: number; minTotal?: Cents }, cur: { symbol: string; decimals: number }) =>
  `Cupón ${c.code}: ${c.type === "percent" ? `${c.value} % de descuento` : `${money(c.value, cur)} de descuento`}${c.minTotal ? ` (compra mínima ${money(c.minTotal, cur)})` : ""}${c.expiresAt ? ` hasta el ${fdate(c.expiresAt)}` : ""}`;

/** Los datos del catálogo de quien pide: la tienda (staff) o el revendedor (sesión de cliente revendedor). */
export function catalogData(store: GabrielStore, actor: Actor, opts: { origin?: string } = {}): CatalogData {
  const e = store.engine, s = e.s, st = s.settings, now = e.now();
  const origin = opts.origin?.replace(/\/+$/, "");
  if (actor.role === "owner" || actor.role === "admin" || actor.role === "seller") {
    const cur = { symbol: st.currencySymbol || "Bs", decimals: 2, code: "BOB" };
    const items: CatalogItem[] = publicCatalog(e).filter((p) => !p.resellersOnly && p.price > 0).map((p) => ({
      id: p.id, name: p.name, category: p.kind === "combo" ? PROMO_CAT : p.category, description: p.description, price: p.price, durationDays: p.durationDays, kind: p.kind, color: p.color,
      ...(p.kind === "combo" && p.comboParts?.length ? { items: p.comboParts.map((id) => s.products[id]?.name ?? id), partIds: p.comboParts, ...(savingsOf(p.price, p.comboParts.map((id) => (s.products[id]?.published ? s.products[id].price : undefined))) !== undefined ? { savings: savingsOf(p.price, p.comboParts.map((id) => (s.products[id]?.published ? s.products[id].price : undefined))) } : {}) } : {}),
      ...(imageRefOf(s.products, p.id) ? { hasImage: true, imageRef: imageRefOf(s.products, p.id) } : {}),
    }));
    const promos: string[] = [];
    const cp = comboPromo(st.comboDiscounts, cur); if (cp) promos.push(cp);
    try { for (const c of listCoupons(e, actor)) if (c.state === "active" && !c.resellers) promos.push(couponPromo(c, cur)); } catch { /* sin permiso para ver cupones: sin promos de cupón */ }
    return {
      owner: true,
      business: {
        name: st.storeName, whatsapp: String(st.whatsapp ?? "").replace(/\D/g, ""), ...(origin ? { url: `${origin}/tienda/` } : {}), ...(st.logoFileRef ? { logoRef: st.logoFileRef } : {}),
        accent: st.accentColor || "#fcc42d", accent2: st.accent2Color || st.accentColor || "#ffd95a", background: st.backgroundColor || "#070b16", headingFont: st.headingFont || "outfit",
        ...(st.storeHours ? { hours: st.storeHours } : {}), ...(st.announcement ? { announcement: st.announcement } : {}),
        ...(st.instagram ? { instagram: st.instagram } : {}), ...(st.tiktok ? { tiktok: st.tiktok } : {}), ...(st.facebook ? { facebook: st.facebook } : {}), ...(st.footerText ? { footer: st.footerText } : {}),
      },
      currency: cur, categories: group(items), promos, generatedAt: now,
    };
  }
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo la tienda o un revendedor pueden exportar su catálogo");
  const me: Customer = e.get("customers", actor.customerId);
  if (me.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const sh = me.shop, loc = localeOf(e, me);
  const cur = { symbol: loc.symbol, decimals: loc.decimals, code: loc.country };
  const mine = (bs: Cents | undefined) => toMine(e, me, bs);
  const show = sh?.products?.length ? new Set(sh.products) : null;
  // Mismas reglas que su página /r/<slug>: publicados, con SU precio, y si eligió cuáles mostrar, solo esos.
  // Independiente (14/11/2026): su catálogo es solo lo suyo; nunca el stock de la tienda.
  const indep = isIndependent(me);
  const items: CatalogItem[] = Object.values(s.products)
    .filter((p) => !indep && p.published && mine(me.resellerPrices?.[p.id]) !== undefined && (!show || show.has(p.id)) && (mine(me.resellerPrices![p.id]) ?? 0) > 0)
    .map((p) => ({ id: p.id, name: p.name, category: p.kind === "combo" ? PROMO_CAT : (p.category ?? "Otros"), description: p.description ?? "", price: mine(me.resellerPrices![p.id])!, durationDays: p.durationDays, kind: p.kind, color: p.color ?? "#3984ff",
      ...(p.kind === "combo" && p.comboProductIds?.length ? { items: p.comboProductIds.map((id) => s.products[id]?.name ?? id), partIds: p.comboProductIds, ...(savingsOf(mine(me.resellerPrices![p.id])!, p.comboProductIds.map((id) => mine(me.resellerPrices?.[id]))) !== undefined ? { savings: savingsOf(mine(me.resellerPrices![p.id])!, p.comboProductIds.map((id) => mine(me.resellerPrices?.[id]))) } : {}) } : {}),
      ...(imageRefOf(s.products, p.id) ? { hasImage: true, imageRef: imageRefOf(s.products, p.id) } : {}) }));
  const nameOf = (id: Id) => s.products[id]?.name ?? id;
  for (const cb of indep ? [] : sh?.combos ?? []) {
    if (!cb.productIds.every((id) => me.resellerPrices?.[id] !== undefined) || mine(cb.price) === undefined) continue;
    const sv = savingsOf(mine(cb.price)!, cb.productIds.map((id) => mine(me.resellerPrices?.[id])));
    items.push({ id: `rc_${cb.id}`, name: cb.name, category: PROMO_CAT, description: cb.note || "", price: mine(cb.price)!, durationDays: 30, kind: "combo", items: cb.productIds.map(nameOf), partIds: cb.productIds, color: "#7c5cff", ...(sv !== undefined ? { savings: sv } : {}) });
  }
  for (const pc of pageCards(e, me)) items.push({ id: pc.id, name: pc.name, category: "Mis servicios", description: "", price: pc.price, durationDays: pc.durationDays, kind: "own", color: pc.color });
  const promos: string[] = [];
  const cp = comboPromo(sh?.comboDiscounts?.map((v) => mine(v) ?? 0), cur); if (cp) promos.push(cp);
  if (st.resellerCoupons) for (const c of sh?.coupons ?? []) if (c.active && (!c.expiresAt || c.expiresAt > now)) promos.push(couponPromo({ ...c, value: c.type === "fixed" ? (mine(c.value) ?? c.value) : c.value, ...(c.minTotal ? { minTotal: mine(c.minTotal) ?? c.minTotal } : {}) }, cur));
  const published = !!sh?.enabled && !sh.blocked && pageAllowed(e, me);
  return {
    owner: false,
    business: {
      name: (sh?.title || me.name).trim(), whatsapp: String(sh?.whatsapp || me.phone || "").replace(/\D/g, ""),
      ...(published && origin && sh?.slug ? { url: `${origin}/r/${sh.slug}` } : {}), ...(sh?.logoFileRef ? { logoRef: sh.logoFileRef } : {}),
      accent: sh?.accentColor || "#fcc42d", accent2: sh?.accent2Color || sh?.accentColor || "#ffd95a", background: sh?.backgroundColor || "#070b16", headingFont: sh?.headingFont || "outfit",
      ...(sh?.storeHours ? { hours: sh.storeHours } : {}), ...(sh?.announcement ? { announcement: sh.announcement } : {}),
      ...(sh?.instagram ? { instagram: sh.instagram } : {}), ...(sh?.tiktok ? { tiktok: sh.tiktok } : {}), ...(sh?.facebook ? { facebook: sh.facebook } : {}), ...(sh?.footerText ? { footer: sh.footerText } : {}),
    },
    currency: cur, categories: group(items), promos, generatedAt: now,
  };
}

export interface CatalogFilter { categories?: string[]; productIds?: string[] }
/** Aplica la selección de categorías o productos (vacío = todo). */
export function filterCatalog(d: CatalogData, f: CatalogFilter = {}): CatalogData {
  const cats = f.categories?.length ? new Set(f.categories.map((x) => x.trim().toLowerCase())) : null;
  const ids = f.productIds?.length ? new Set(f.productIds) : null;
  const categories = d.categories
    .filter((c) => !cats || cats.has(c.name.toLowerCase()))
    .map((c) => ({ name: c.name, items: c.items.filter((it) => !ids || ids.has(it.id)) }))
    .filter((c) => c.items.length);
  return { ...d, categories };
}

const CAT_EMOJI: Record<string, string> = { [PROMO_CAT]: "🎁", Combos: "🎁", Streaming: "📺", Música: "🎵", "Series y películas": "🎬", Deportes: "⚽", Herramientas: "🛠️", "Mis servicios": "⭐", Otros: "✨" };
const dur = (days: number) => (days === 30 ? "1 mes" : days === 90 ? "3 meses" : days === 180 ? "6 meses" : days === 365 ? "1 año" : days === 1 ? "1 día" : `${days} días`);

/** Texto de UNA categoría para WhatsApp (negritas con *asteriscos*, viñetas, sin links raros). */
export function whatsappCategory(d: CatalogData, c: CatalogData["categories"][number], opts: { descriptions?: boolean } = {}): string {
  const lines = [`${CAT_EMOJI[c.name] ?? "✨"} *${c.name.toUpperCase()}*`];
  for (const it of c.items) {
    lines.push(`• ${it.name} — *${money(it.price, d.currency)}*${it.savings ? ` (ahorrás ${money(it.savings, d.currency)})` : ""}`);
    const extra = [it.kind === "own" || it.kind === "combo" ? "" : dur(it.durationDays), it.items?.length ? `incluye ${it.items.join(" + ")}` : "", opts.descriptions !== false && it.description ? it.description : ""].filter(Boolean);
    if (extra.length) lines.push(`   ${extra.join(" · ")}`);
  }
  return lines.join("\n");
}

/** El catálogo completo para WhatsApp: encabezado, categorías, promos y cómo pedir. */
export function whatsappCatalog(d: CatalogData, opts: { descriptions?: boolean } = {}): { text: string; categories: { name: string; text: string }[] } {
  const categories = d.categories.map((c) => ({ name: c.name, text: whatsappCategory(d, c, opts) }));
  const head = [`🛒 *${d.business.name.toUpperCase()}*`, `Catálogo · ${fdate(d.generatedAt)}`, ...(d.business.announcement ? [`📣 ${d.business.announcement}`] : [])].join("\n");
  const promos = d.promos.length ? `🎉 *PROMOS*\n${d.promos.map((p) => `• ${p}`).join("\n")}` : "";
  const tail = [
    d.business.whatsapp ? `📲 Pedidos por WhatsApp: wa.me/${d.business.whatsapp}` : "📲 Pedidos por WhatsApp",
    ...(d.business.url ? [`🌐 ${d.business.url}`] : []),
    ...(d.business.hours ? [`🕒 ${d.business.hours}`] : []),
    `_Precios en ${d.currency.symbol}. Pueden cambiar sin aviso._`,
  ].join("\n");
  return { text: [head, ...categories.map((c) => c.text), promos, tail].filter(Boolean).join("\n\n"), categories };
}
