// País y moneda de cada revendedor.
//
// La tienda trabaja en Bs. Un revendedor de otro país (el primero: Paraguay) vende a SUS clientes
// en su moneda y con sus números de teléfono. Regla de qué va en cada moneda (docs del equipo):
//  - Lo que le compra a la tienda (alquileres, recargas, saldo, costos, su "Mi lista de precios",
//    sus combos y descuentos de su página) sigue en la moneda de la tienda (Bs).
//  - Lo SUYO va en su moneda: lo que le cobra a cada cliente en Mi control y en el cuaderno, su
//    libreta (Quién me debe), sus ganancias de lo suyo, el link de cobro, sus cuentas propias y los
//    precios que ve el público en su página /r/<slug> (convertidos con SU tipo de cambio).
//  - Nunca se suma plata de dos monedas en una misma cifra: si una pantalla junta las dos, van dos
//    totales separados.
// Los montos se guardan igual que siempre: enteros ×100 (₲ 35.000 = 3500000).
import type { Actor, Cents, Customer, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

export type CountryCode = "BO" | "PY" | "AR" | "PE" | "CL" | "XX";

/** País y moneda de un revendedor. Sin esto, es de Bolivia (como siempre). */
export interface ResellerLocale {
  country: CountryCode;
  /** Código de teléfono sin "+": 591, 595… */
  dial: string;
  /** Símbolo que ve él y sus clientes: Bs, ₲, $, S/. */
  symbol: string;
  /** Decimales de su moneda: 2 (Bs, S/, $ argentino) o 0 (₲, $ chileno). */
  decimals: 0 | 2;
  /** Tipo de cambio que pone él: 1 Bs = `rate` de su moneda. Sirve para mostrar en su página los productos de la tienda. */
  rate?: number;
}

/** Países de la lista corta (cualquier otro: "Otro" con código y moneda a mano). */
export const COUNTRIES: Record<Exclude<CountryCode, "XX">, { name: string; flag: string; dial: string; symbol: string; decimals: 0 | 2 }> = {
  BO: { name: "Bolivia", flag: "🇧🇴", dial: "591", symbol: "Bs", decimals: 2 },
  PY: { name: "Paraguay", flag: "🇵🇾", dial: "595", symbol: "₲", decimals: 0 },
  AR: { name: "Argentina", flag: "🇦🇷", dial: "54", symbol: "$", decimals: 2 },
  PE: { name: "Perú", flag: "🇵🇪", dial: "51", symbol: "S/", decimals: 2 },
  CL: { name: "Chile", flag: "🇨🇱", dial: "56", symbol: "$", decimals: 0 },
};

export interface Currency { symbol: string; decimals: 0 | 2 }

/** Moneda de la tienda (la de todo lo que se le compra a Gabriel). */
export const storeCurrency = (e: Engine): Currency => ({ symbol: e.s.settings.currencySymbol || "Bs", decimals: 2 });

/** País y moneda del revendedor (Bolivia con la moneda de la tienda si nunca lo cambió). */
export function localeOf(e: Engine, c: Customer | undefined): ResellerLocale {
  if (c?.locale) return c.locale;
  return { country: "BO", dial: "591", symbol: storeCurrency(e).symbol, decimals: 2 };
}

/** ¿Su moneda es distinta de la de la tienda? Entonces sus montos nunca se suman con los de la tienda. */
export function isForeign(e: Engine, c: Customer | undefined): boolean {
  const l = localeOf(e, c), s = storeCurrency(e);
  return l.symbol !== s.symbol || l.decimals !== s.decimals;
}

export const currencyOf = (e: Engine, c: Customer | undefined): Currency => {
  const l = localeOf(e, c);
  return { symbol: l.symbol, decimals: l.decimals };
};

/** Miles con punto, decimales con coma: 3500000 → "35.000" (₲) · 1250 → "12,50" (Bs). */
export function money(cents: Cents, cur: Currency): string {
  const n = Math.round(Number(cents) || 0), neg = n < 0, abs = Math.abs(n);
  const group = (u: number) => String(u).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (cur.decimals === 0) return `${cur.symbol} ${neg ? "-" : ""}${group(Math.round(abs / 100))}`;
  const u = Math.floor(abs / 100), c = abs % 100;
  return `${cur.symbol} ${neg ? "-" : ""}${group(u)}${c ? "," + String(c).padStart(2, "0") : ""}`;
}

/** Monedas sin decimales: el monto se redondea a unidades enteras (₲ 35.000,40 no existe). */
export function normAmount(cents: number, cur: Currency): Cents {
  const n = Math.round(Number(cents));
  return cur.decimals === 0 ? Math.round(n / 100) * 100 : n;
}

/** Tope de un monto. En Bs queda como siempre; en monedas "grandes" (₲ 150.000) hace falta más lugar. */
export function maxAmount(e: Engine, c: Customer | undefined): Cents {
  if (!isForeign(e, c)) return 10_000_000;
  return localeOf(e, c).decimals === 0 ? 100_000_000_000 : 1_000_000_000;
}

/**
 * Convierte un monto de la tienda (Bs) a la moneda del revendedor con SU tipo de cambio y lo redondea
 * hacia arriba a un número "lindo" (3 cifras: ₲ 35.127 → ₲ 35.200), así no pierde margen.
 */
export function convertFromStore(bsCents: Cents, rate: number): Cents {
  const units = (bsCents / 100) * rate;
  if (!(units > 0)) return 0;
  // Paso de redondeo: 3 cifras significativas y nunca centavos sueltos (S/ 23,45 → S/ 24).
  const step = Math.max(1, 10 ** (Math.floor(Math.log10(units)) - 2));
  // Corrige errores de coma flotante antes de redondear hacia arriba (35000.000001 → 35000).
  return Math.ceil(Number((units / step).toFixed(6))) * step * 100;
}

/**
 * Precio para el público en la moneda del revendedor de un monto que él cargó en Bs (su lista de
 * precios, sus combos). Si su moneda es la de la tienda, va igual; si no, con su tipo de cambio;
 * sin tipo de cambio no hay precio (no se le muestra Bs a su cliente de otro país).
 */
export function toMine(e: Engine, c: Customer | undefined, bsCents: Cents | undefined): Cents | undefined {
  if (bsCents === undefined || bsCents === null) return undefined;
  if (!isForeign(e, c)) return bsCents;
  const l = localeOf(e, c);
  return l.rate ? convertFromStore(bsCents, l.rate) : undefined;
}

/** Su precio de lista de un producto de la tienda, en SU moneda (o undefined). */
export const listPriceMine = (e: Engine, c: Customer | undefined, productId: Id): Cents | undefined => toMine(e, c, c?.resellerPrices?.[productId]);

/** Código de teléfono por defecto para quien carga el número (el revendedor usa el de su país). */
export function dialFor(e: Engine, actor: Actor | undefined): string {
  if (actor?.role !== "reseller" || !actor.customerId) return "591";
  return localeOf(e, e.s.customers[actor.customerId]).dial;
}

/** Lo que ve el propio revendedor (y el dueño en su ficha). */
export function localeView(e: Engine, c: Customer) {
  const l = localeOf(e, c);
  return { ...l, name: l.country === "XX" ? "Otro país" : COUNTRIES[l.country].name, flag: l.country === "XX" ? "🌎" : COUNTRIES[l.country].flag, foreign: isForeign(e, c), store: storeCurrency(e) };
}

function clean(raw: Record<string, unknown>, prev: ResellerLocale | undefined): ResellerLocale {
  const country = String(raw.country ?? prev?.country ?? "BO").toUpperCase() as CountryCode;
  if (!["BO", "PY", "AR", "PE", "CL", "XX"].includes(country)) throw new DomainError("VALIDATION", "Elegí un país de la lista u “Otro”");
  const base = country === "XX" ? undefined : COUNTRIES[country];
  const changedCountry = prev?.country !== country;
  // Al cambiar de país se toman los valores del país; lo que mande a mano los pisa.
  const pick = <T>(k: string, fallback: T): unknown => (raw[k] !== undefined && raw[k] !== "" && raw[k] !== null ? raw[k] : !changedCountry && prev ? (prev as unknown as Record<string, unknown>)[k] ?? fallback : fallback);
  const dial = String(pick("dial", base?.dial ?? "")).replace(/\D/g, "");
  if (!/^[1-9]\d{0,3}$/.test(dial)) throw new DomainError("VALIDATION", "Código de país: de 1 a 4 números, sin el +");
  const symbol = String(pick("symbol", base?.symbol ?? "")).trim();
  if (!symbol || symbol.length > 4 || /[\d<>"'&]/.test(symbol)) throw new DomainError("VALIDATION", "Símbolo de la moneda: de 1 a 4 letras (ej.: ₲, $, S/)");
  const decimals = Number(pick("decimals", base?.decimals ?? 2));
  if (decimals !== 0 && decimals !== 2) throw new DomainError("VALIDATION", "Decimales: 0 o 2");
  const out: ResellerLocale = { country, dial, symbol, decimals };
  const r = raw.rate === undefined ? (changedCountry ? undefined : prev?.rate) : raw.rate === null || raw.rate === "" ? undefined : Number(String(raw.rate).replace(",", "."));
  if (r !== undefined) {
    if (!Number.isFinite(r) || r <= 0 || r > 1_000_000) throw new DomainError("VALIDATION", "Tipo de cambio: un número mayor a 0 (ej.: 1 Bs = 1050)");
    out.rate = Math.round(r * 10_000) / 10_000;
  }
  return out;
}

function apply(e: Engine, actor: Actor, c: Customer, raw: Record<string, unknown>) {
  const next = clean(raw ?? {}, c.locale);
  return e.tx(() => {
    const cur = e.s.customers[c.id];
    // Bolivia con la moneda de la tienda y sin tipo de cambio = lo de siempre: no se guarda nada.
    const plain = next.country === "BO" && next.dial === "591" && next.symbol === storeCurrency(e).symbol && next.decimals === 2 && next.rate === undefined;
    if (plain) delete cur.locale; else cur.locale = next;
    e.audit(actor, "reseller.locale", "customer", cur.id, { country: next.country, symbol: next.symbol, decimals: next.decimals, rate: next.rate ?? null });
    return localeView(e, cur);
  });
}

/** El revendedor elige su país y su moneda. */
export function setMyLocale(e: Engine, actor: Actor, raw: Record<string, unknown>) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const c = e.get("customers", actor.customerId);
  if (c.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return apply(e, actor, c, raw);
}

export function myLocale(e: Engine, actor: Actor) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return localeView(e, e.get("customers", actor.customerId));
}

/** El dueño (o un admin) lo fija desde la ficha del revendedor. */
export function setLocaleFor(e: Engine, actor: Actor, customerId: Id, raw: Record<string, unknown>) {
  authorize(actor, "reseller.manage");
  const c = e.get("customers", customerId);
  if (c.kind !== "reseller") throw new DomainError("VALIDATION", "Primero pasalo a revendedor");
  return apply(e, actor, c, raw);
}
