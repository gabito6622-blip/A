// «Mi día» del revendedor (13/11/2026): la secretaria del dueño, pero con SUS clientes y SUS perfiles repartidos.
// Son las mismas fórmulas (no hay agentes): vencimiento, estado de pago y nota deciden en qué grupo va cada
// servicio. Nada se manda solo: el revendedor toca «Me pagó» o abre WhatsApp con el mensaje listo.
//  - Dos fuentes: clientes registrados (sus alquileres, `rcontrol`) y perfiles repartidos (`subs`).
//  - Grupos: cobrar (vencidos hasta 30 días atrás o que vencen hoy), avisar (1 a 3 días), deben (marcados sin pagar).
//  - «Me pagó» de un toque: en un perfil repartido corre la fecha del perfil (como «renovar» en Repartir perfiles)
//    o solo lo marca pagado si todavía no vence; en un cliente registrado marca pagado en Mi control y, si él
//    quiere, renueva el servicio con su saldo en el mismo toque (la misma renovación de siempre, con sus frenos).
import type { Actor, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart } from "./time.js";
import { SECRETARY_AHEAD_DAYS } from "./secretary.js";
import { myControl, setMyControl } from "./resellerTools.js";
import { listMine, renewSub } from "./subRentals.js";
import { renew as renewOrder } from "./orders.js";
import { balance } from "./wallet.js";
import { currencyOf, isForeign } from "./country.js";

/** Vencidos de hace más de esto no se cobran desde acá (son «Que vuelvan»). */
export const DAY_BACK_DAYS = 30;

export interface DayItem {
  /** "client" = alquiler de un cliente registrado (id = assignmentId); "sub" = perfil repartido (id = assignmentId|subId). */
  kind: "client" | "sub";
  id: Id;
  assignmentId: Id;
  subId?: Id;
  client: string;
  phone: string;
  productId: Id;
  product: string;
  /** Perfil del reparto («Mamá», «Perfil 2»), si es un perfil repartido. */
  label?: string;
  expiresAt: number;
  /** Días hasta el vencimiento por día calendario (0 = hoy, negativo = venció). */
  days: number;
  /** Lo que le cobra, en SU moneda (null = sin precio cargado). */
  price: Cents | null;
  pay: "pagado" | "pendiente" | "no_pago";
  note: string;
  /** Link de cobro /c/<token> del perfil, si lo creó. */
  linkToken?: string;
  /** Solo clientes registrados: lo que le cuesta renovar con su saldo y si se puede. */
  cost?: Cents;
  canRenew?: boolean;
}
export interface DayGroup { client: string; phone: string; items: DayItem[]; total: Cents }

function reseller(e: Engine, actor: Actor) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return e.get("customers", actor.customerId);
}

function items(e: Engine, actor: Actor): DayItem[] {
  const now = e.now(), today = boDayStart(now);
  const daysTo = (t: number) => Math.round((boDayStart(t) - today) / DAY);
  const out: DayItem[] = [];
  for (const r of myControl(e, actor)) {
    if (r.holdOpen) continue;
    out.push({ kind: "client", id: r.id, assignmentId: r.id, client: r.client, phone: r.phone, productId: r.productId, product: r.product, expiresAt: r.expiresAt, days: daysTo(r.expiresAt), price: r.price, pay: r.pay as DayItem["pay"], note: r.note, cost: r.cost, canRenew: r.canRenew && r.renewableNow !== false });
  }
  for (const a of listMine(e, actor)) for (const s of a.subs) {
    out.push({ kind: "sub", id: `${a.assignmentId}|${s.id}`, assignmentId: a.assignmentId, subId: s.id, client: s.name, phone: s.phone, productId: a.productId, product: a.product, label: s.label, expiresAt: s.expiresAt, days: daysTo(s.expiresAt), price: s.price ?? null, pay: s.pay, note: s.note ?? "", ...(s.linkToken ? { linkToken: s.linkToken } : {}) });
  }
  return out;
}

function grouped(list: DayItem[]): DayGroup[] {
  const m = new Map<string, DayGroup>();
  for (const it of list) {
    const k = `${it.client.trim().toLowerCase()}|${it.phone.replace(/\D/g, "")}`;
    const g = m.get(k) ?? { client: it.client, phone: it.phone, items: [], total: 0 };
    g.items.push(it); g.total += it.price ?? 0;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, items: g.items.sort((x, y) => x.expiresAt - y.expiresAt) })).sort((x, y) => x.items[0].expiresAt - y.items[0].expiresAt || x.client.localeCompare(y.client, "es"));
}

/** Lo de hoy, agrupado por cliente. Solo lo suyo. */
export function myDay(e: Engine, actor: Actor) {
  const me = reseller(e, actor);
  const all = items(e, actor);
  const cobrar = all.filter((it) => it.days <= 0 && it.days >= -DAY_BACK_DAYS);
  const avisar = all.filter((it) => it.days > 0 && it.days <= SECRETARY_AHEAD_DAYS);
  const inCobrar = new Set(cobrar.map((it) => it.id));
  const deben = all.filter((it) => it.pay !== "pagado" && !inCobrar.has(it.id) && it.days > SECRETARY_AHEAD_DAYS);
  const sum = (l: DayItem[]) => l.reduce((t, it) => t + (it.price ?? 0), 0);
  return {
    currency: currencyOf(e, me), foreign: isForeign(e, me),
    counts: { cobrar: cobrar.length, avisar: avisar.length, deben: deben.length },
    totals: { cobrar: sum(cobrar), avisar: sum(avisar), deben: sum(deben) },
    cobrar: grouped(cobrar), avisar: grouped(avisar), deben: grouped(deben),
    balance: balance(e, me.id),
  };
}

const find = (e: Engine, actor: Actor, id: Id) => {
  const it = items(e, actor).find((x) => x.id === id);
  if (!it) throw new DomainError("NOT_FOUND", "Ese servicio no es de un cliente tuyo");
  return it;
};

/** Qué va a pasar si toca «Me pagó», antes de guardar. */
export function dayPreview(e: Engine, actor: Actor, id: Id) {
  const me = reseller(e, actor);
  const it = find(e, actor, id);
  const days = e.s.products[it.productId]?.durationDays ?? 30;
  const now = e.now();
  const bal = balance(e, me.id);
  if (it.kind === "sub") {
    // Si ya vence (o venció), el perfil corre un período, como en Repartir perfiles; si no, solo queda pagado.
    const moves = it.days <= SECRETARY_AHEAD_DAYS;
    return { item: it, price: it.price, moves, to: moves ? Math.max(it.expiresAt, now) + days * DAY : it.expiresAt, renew: null, blockers: [] as string[] };
  }
  // Cliente registrado: marcar pagado en Mi control; la renovación real (con su saldo) es opcional y tiene sus frenos.
  const due = it.days <= SECRETARY_AHEAD_DAYS;
  const cost = it.cost ?? 0;
  const renew = { offered: due && !!it.canRenew, cost, balance: bal, enough: bal >= cost, to: Math.max(it.expiresAt, now) + days * DAY, blocked: due && !it.canRenew ? "Este servicio lo renueva la tienda (la cuenta vence antes o no está a la venta): escribile." : null };
  return { item: it, price: it.price, moves: false, to: it.expiresAt, renew, blockers: [] as string[] };
}

/**
 * «Me pagó»: idempotente por `idempotencyKey`. `price` corrige lo que le cobra (opcional). En un cliente
 * registrado, `renew: true` además renueva con su saldo (misma `orders.renew` de siempre: frenos del
 * proveedor, saldo y precio acordado); si falla, el pago igual queda anotado y se devuelve el motivo.
 */
export function dayPay(e: Engine, actor: Actor, id: Id, input: { price?: unknown; renew?: unknown; idempotencyKey?: unknown } = {}) {
  reseller(e, actor);
  const key = input.idempotencyKey === undefined || input.idempotencyKey === null ? undefined : String(input.idempotencyKey).slice(0, 80);
  const run = () => {
    const pv = dayPreview(e, actor, id);
    const it = pv.item;
    const price = input.price === undefined || input.price === null || input.price === "" ? undefined : input.price;
    if (it.kind === "sub") {
      if (pv.moves) renewSub(e, actor, it.assignmentId, it.subId!, true);
      else e.tx(() => { const a = e.get("assignments", it.assignmentId); const s = (a.subs ?? []).find((x) => x.id === it.subId)!; s.pay = "pagado"; });
      if (price !== undefined) e.tx(() => {
        const a = e.get("assignments", it.assignmentId); const s = (a.subs ?? []).find((x) => x.id === it.subId)!;
        const n = Math.round(Number(price)); if (!Number.isInteger(n) || n < 0 || n > 50_000_000) throw new DomainError("VALIDATION", "Precio inválido"); s.price = n;
      });
      e.audit(actor, "reseller.day_paid", "assignment", it.assignmentId, { sub: it.subId, moved: pv.moves, price: price ?? it.price });
      return { ok: true as const, kind: "sub" as const, to: find(e, actor, id).expiresAt, renewed: null as null | boolean, renewError: null as null | string };
    }
    setMyControl(e, actor, it.assignmentId, { payStatus: "pagado", ...(price !== undefined ? { price } : {}) });
    let renewed: boolean | null = null, renewError: string | null = null;
    if (input.renew === true) {
      if (!pv.renew?.offered) renewError = pv.renew?.blocked ?? "Todavía no hace falta renovar";
      else {
        try { renewOrder(e, actor, it.assignmentId, { paymentMethod: "balance", periods: 1, idempotencyKey: key ? `day:${key}` : undefined }); renewed = true; }
        catch (err) { renewed = false; renewError = err instanceof DomainError ? err.message : "No se pudo renovar"; }
      }
    }
    e.audit(actor, "reseller.day_paid", "assignment", it.assignmentId, { price: price ?? it.price, renewed });
    return { ok: true as const, kind: "client" as const, to: e.s.assignments[it.assignmentId].customerExpiresAt, renewed, renewError };
  };
  return key ? e.idempotent(`rday:${id}:${key}`, run) : run();
}
