// Cupones de descuento: código, % o monto fijo, vencimiento, usos máximos y usos por cliente.
// Los usos se cuentan desde los pedidos (los vencidos, cancelados o rechazados no cuentan),
// así un pedido que no se pagó devuelve el uso solo.
import type { Actor, Cents, Coupon, Id, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

const DEAD: Order["status"][] = ["expired", "cancelled", "rejected"];
/** Lo mínimo que tiene que quedar a pagar después del cupón (1 unidad de la moneda). */
export const MIN_TOTAL_AFTER_COUPON: Cents = 100;

export const normCode = (s: unknown) => String(s ?? "").trim().toUpperCase().replace(/\s+/g, "");

export function usesOf(e: Engine, couponId: Id, payerId?: Id): number {
  let n = 0;
  for (const o of Object.values(e.s.orders)) if (o.coupon?.id === couponId && !DEAD.includes(o.status) && (!payerId || o.payerId === payerId)) n++;
  return n;
}

const couponByCode = (e: Engine, code: string) => Object.values(e.s.coupons ?? {}).find((c) => c.code === code);

export interface CouponInput {
  id?: Id;
  code: string;
  type: "percent" | "fixed";
  value: number;
  expiresAt?: number | null;
  maxUses?: number | null;
  perCustomer?: number | null;
  minTotal?: Cents | null;
  productIds?: Id[];
  resellers?: boolean;
  active?: boolean;
  note?: string;
}

const optInt = (v: unknown, min: number, max: number, what: string): number | undefined => {
  if (v === undefined || v === null || v === "" || v === 0) return undefined;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new DomainError("VALIDATION", `${what}: tiene que ser un número entre ${min} y ${max}`);
  return n;
};

export function saveCoupon(e: Engine, actor: Actor, input: CouponInput): Coupon {
  authorize(actor, "catalog.manage");
  const code = normCode(input.code);
  if (!/^[A-Z0-9_-]{3,20}$/.test(code)) throw new DomainError("VALIDATION", "El código lleva de 3 a 20 letras o números, sin espacios (ej.: VERANO10)");
  if (input.type !== "percent" && input.type !== "fixed") throw new DomainError("VALIDATION", "Elegí si el descuento es en % o un monto fijo");
  const value = Number(input.value);
  if (input.type === "percent" && (!Number.isInteger(value) || value < 1 || value > 90)) throw new DomainError("VALIDATION", "El porcentaje va de 1 a 90");
  if (input.type === "fixed" && (!Number.isInteger(value) || value < 1 || value > 10_000_000)) throw new DomainError("VALIDATION", "Monto de descuento inválido");
  const expiresAt = input.expiresAt ? Number(input.expiresAt) : undefined;
  if (expiresAt !== undefined && (!Number.isFinite(expiresAt) || expiresAt <= 0)) throw new DomainError("VALIDATION", "Fecha de vencimiento inválida");
  const productIds = Array.isArray(input.productIds) ? [...new Set(input.productIds.map(String))] : [];
  for (const pid of productIds) if (!e.s.products[pid]) throw new DomainError("VALIDATION", `Producto inexistente: ${pid}`);
  return e.tx(() => {
    e.s.coupons ??= {};
    const prev = input.id ? e.s.coupons[input.id] : undefined;
    if (input.id && !prev) throw new DomainError("NOT_FOUND", "Cupón inexistente");
    const same = couponByCode(e, code);
    if (same && same.id !== prev?.id) throw new DomainError("VALIDATION", `Ya hay un cupón con el código ${code}`);
    const now = e.now();
    const c: Coupon = {
      id: prev?.id ?? e.id("cup"), code, type: input.type, value,
      ...(expiresAt ? { expiresAt } : {}),
      ...(optInt(input.maxUses, 1, 100000, "Usos máximos") ? { maxUses: optInt(input.maxUses, 1, 100000, "Usos máximos") } : {}),
      ...(optInt(input.perCustomer, 1, 1000, "Usos por cliente") ? { perCustomer: optInt(input.perCustomer, 1, 1000, "Usos por cliente") } : {}),
      ...(optInt(input.minTotal, 1, 100_000_000, "Compra mínima") ? { minTotal: optInt(input.minTotal, 1, 100_000_000, "Compra mínima") } : {}),
      ...(productIds.length ? { productIds } : {}),
      resellers: !!input.resellers,
      active: input.active ?? prev?.active ?? true,
      ...(input.note ? { note: String(input.note).slice(0, 120) } : {}),
      createdAt: prev?.createdAt ?? now, updatedAt: now,
    };
    e.s.coupons[c.id] = c;
    e.audit(actor, prev ? "coupon.update" : "coupon.create", "coupon", c.id, { code, type: c.type, value: c.value, active: c.active });
    return structuredClone(c);
  });
}

export function deleteCoupon(e: Engine, actor: Actor, id: Id): { ok: true } {
  authorize(actor, "catalog.manage");
  return e.tx(() => {
    const c = e.s.coupons?.[id];
    if (!c) throw new DomainError("NOT_FOUND", "Cupón inexistente");
    delete e.s.coupons[id];
    e.audit(actor, "coupon.delete", "coupon", id, { code: c.code });
    return { ok: true as const };
  });
}

export function listCoupons(e: Engine, actor: Actor) {
  authorize(actor, "catalog.manage");
  const now = e.now();
  return Object.values(e.s.coupons ?? {})
    .map((c) => {
      const uses = usesOf(e, c.id);
      const state = !c.active ? "paused" : c.expiresAt && c.expiresAt < now ? "expired" : c.maxUses && uses >= c.maxUses ? "used_up" : "active";
      return { ...structuredClone(c), uses, state };
    })
    .sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Calcula cuánto descuenta el cupón para este pedido o explica por qué no aplica.
 * `net` es lo que queda a pagar después de otros descuentos (Armá tu combo).
 */
export function couponFor(e: Engine, rawCode: unknown, payerId: Id, items: { productId: Id; qty: number; unitPrice: Cents }[], net: Cents): { coupon: Coupon; amount: Cents } {
  const code = normCode(rawCode);
  const c = code ? couponByCode(e, code) : undefined;
  if (!c || !c.active) throw new DomainError("VALIDATION", "Ese cupón no existe o ya no está activo");
  if (c.expiresAt && c.expiresAt < e.now()) throw new DomainError("VALIDATION", "Ese cupón ya venció");
  if (e.s.customers[payerId]?.kind === "reseller" && !c.resellers) throw new DomainError("VALIDATION", "Ese cupón es solo para clientes, no para revendedores");
  if (c.maxUses && usesOf(e, c.id) >= c.maxUses) throw new DomainError("VALIDATION", "Ese cupón ya se usó todas las veces permitidas");
  if (c.perCustomer && usesOf(e, c.id, payerId) >= c.perCustomer) throw new DomainError("VALIDATION", c.perCustomer === 1 ? "Ya usaste este cupón" : `Ya usaste este cupón ${c.perCustomer} veces`);
  const gross = items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
  if (c.minTotal && gross < c.minTotal) throw new DomainError("VALIDATION", `Este cupón pide una compra mínima de ${(c.minTotal / 100).toFixed(2)}`);
  // Si el cupón es para ciertos productos, el descuento se calcula solo sobre ellos.
  const base = c.productIds?.length
    ? Math.min(net, items.filter((it) => c.productIds!.includes(it.productId)).reduce((s, it) => s + it.unitPrice * it.qty, 0))
    : net;
  if (base <= 0) throw new DomainError("VALIDATION", "Ese cupón no aplica a estos productos");
  let amount = c.type === "percent" ? Math.round((base * c.value) / 100) : Math.min(c.value, base);
  amount = Math.max(0, Math.min(amount, net - MIN_TOTAL_AFTER_COUPON));
  if (amount <= 0) throw new DomainError("VALIDATION", "Con este monto el cupón no descuenta nada");
  return { coupon: c, amount };
}
