// La plata del cuaderno de «Repartir perfiles» (revisión de 3 meses del revendedor de confianza, 14/11/2026).
//
// Antes cada perfil repartido tenía una sola marca «pagado / pendiente» y su precio. Eso perdía plata:
//  - «Me pagó Bs 10» de un perfil de Bs 15 guardaba Bs 10 como PRECIO nuevo y lo marcaba pagado (los Bs 5 desaparecían);
//  - un perfil vencido y sin renovar no contaba como deuda, y a los 30 días salía de «Cobrar hoy»;
//  - «Tu ganancia real» sumaba los precios, no lo que de verdad le pagaron.
// Ahora:
//  - cada período que se debe queda anotado (`debts`: desde, hasta, cuánto, cuánto pagó). Un pago parcial deja «Debe Bs X»
//    y el precio no cambia;
//  - mientras el perfil siga anotado y la cuenta ande, cada período que empieza sin renovar es deuda (`virtualPeriods`), sin
//    tope de 30 días (hasta 12 períodos). Si la cuenta se cortó, se cuenta hasta el corte;
//  - cada cobro queda en `rcobros` con su monto real y su fecha (para «Tu ganancia real» mes a mes) y se puede deshacer
//    por unos minutos si fue un toque de más;
//  - un pago se usa primero en la deuda más vieja, después en el período que ya empezó, después (si vence en 3 días) en el
//    próximo; lo que sobra queda «a favor» para el próximo período.
// Solo el revendedor dueño del alquiler llega acá (lo valida quien llama, con `customerId === yo`).
import type { Actor, Assignment, Cents, Id, SubRental } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart } from "./time.js";
import { SECRETARY_AHEAD_DAYS } from "./secretary.js";
import { isForeign, maxAmount, normAmount, currencyOf } from "./country.js";

/** Un período que el cliente debe (todo o una parte). */
export interface SubDebt { from: number; to: number; amount: Cents; paid: Cents }
/** Un cobro de un perfil repartido (o su corrección, en negativo). Solo lo ve el revendedor `resellerId`. */
export interface ResellerCobro {
  id: Id;
  resellerId: Id;
  at: number;
  amount: Cents;
  assignmentId: Id;
  subId: Id;
  name: string;
  product: string;
  note?: string;
  /** Para «Deshacer» unos minutos: cómo estaba el perfil antes y después del cobro. */
  undo?: { before: string; after: string };
}

/** Hasta cuántos períodos vencidos seguidos se cuentan como deuda (un año). */
export const MAX_VIRTUAL = 12;
/** «Deshacer» un cobro: hasta cuántos minutos después. */
export const UNDO_MINUTES = 30;

export const periodOf = (e: Engine, a: Assignment): number => (e.s.products[a.productId]?.durationDays ?? 30) * DAY;
const cobros = (e: Engine) => (e.s.rcobros ??= []);

/** Hasta cuándo corre el reparto de un alquiler: hoy si anda; si se cortó, hasta el corte (sin servicio no hay deuda nueva). */
export function runsUntil(a: Assignment, now: number): number {
  if (a.status === "active") return now;
  const ev = [...a.history].reverse().find((h) => h.event === "revoked");
  return Math.min(now, ev?.at ?? now);
}

/** Las deudas guardadas. Un perfil viejo marcado «pendiente» (antes de esto) debe su período actual. */
function stored(s: SubRental, P: number): SubDebt[] {
  if (s.debts) return s.debts;
  if (s.pay !== "pagado" && (s.price ?? 0) > 0) return [{ from: s.expiresAt - P, to: s.expiresAt, amount: s.price!, paid: 0 }];
  return [];
}

/** Períodos que ya empezaron (vence hoy o venció) y no se renovaron: el cliente sigue usando el perfil. */
export function virtualPeriods(s: SubRental, P: number, until: number): SubDebt[] {
  const out: SubDebt[] = [];
  for (let t = s.expiresAt; boDayStart(t) <= boDayStart(until) && out.length < MAX_VIRTUAL; t += P) out.push({ from: t, to: t + P, amount: s.price ?? 0, paid: 0 });
  return out;
}

export interface SubMoney {
  /** Lo que debe hoy (guardado + períodos vencidos − a favor). */
  owed: Cents;
  credit: Cents;
  periods: { from: number; to: number; owed: Cents; started: boolean }[];
  /** Estado para mostrar: «pagado» si no debe nada. */
  pay: SubRental["pay"];
}

/** Lo que debe un perfil hoy. Solo lee. */
export function subMoney(e: Engine, a: Assignment, s: SubRental, now = e.now()): SubMoney {
  const P = periodOf(e, a);
  const st = stored(s, P).filter((d) => d.paid < d.amount).map((d) => ({ from: d.from, to: d.to, owed: d.amount - d.paid, started: true }));
  const vt = virtualPeriods(s, P, runsUntil(a, now)).filter((d) => d.amount > 0).map((d) => ({ from: d.from, to: d.to, owed: d.amount, started: false }));
  const gross = [...st, ...vt].reduce((t, d) => t + d.owed, 0), credit = s.credit ?? 0;
  const owed = Math.max(0, gross - credit);
  return { owed, credit: Math.max(0, credit - gross), periods: [...st, ...vt], pay: owed > 0 ? (s.pay === "no_pago" ? "no_pago" : "pendiente") : "pagado" };
}

/** Monto que escribió el revendedor, en SU moneda (₲ sin decimales). */
export function amountIn(e: Engine, actor: Actor, v: unknown): Cents {
  const c = actor.customerId ? e.s.customers[actor.customerId] : undefined;
  const n = isForeign(e, c) ? normAmount(Number(v), currencyOf(e, c)) : Math.round(Number(v));
  if (!Number.isInteger(n) || n <= 0 || n > maxAmount(e, c)) throw new DomainError("VALIDATION", "Escribí cuánto te pagó (mayor a 0)");
  return n;
}

/** Deja las deudas guardadas en limpio (convierte el «pendiente» viejo) y el estado de pago al día. Dentro de `tx`. */
function tidy(s: SubRental, P: number, keepPay?: SubRental["pay"]) {
  s.debts = stored(s, P).filter((d) => d.paid < d.amount).map((d) => ({ ...d }));
  const open = s.debts.length > 0;
  if (!open) delete s.debts;
  if (!s.credit) delete s.credit;
  s.pay = open ? (keepPay && keepPay !== "pagado" ? keepPay : s.pay === "no_pago" ? "no_pago" : "pendiente") : "pagado";
}

/** Pasa el «pendiente» viejo a deudas guardadas (antes de tocar fecha o precio). Dentro de `tx`. */
export function normalizeSub(e: Engine, a: Assignment, s: SubRental) { tidy(s, periodOf(e, a)); }

/**
 * Aplica un pago a un perfil (dentro de `tx`): primero la deuda más vieja, después los períodos que ya empezaron (la fecha
 * corre un período por cada uno, sin días gratis), después —si vence en 3 días o `ahead`— el próximo período, y lo que
 * sobra queda a favor. Devuelve lo que se aplicó y hasta cuándo quedó.
 */
export function applyPayment(e: Engine, a: Assignment, s: SubRental, amount: Cents, opts: { ahead?: boolean; now?: number } = {}) {
  const P = periodOf(e, a), now = opts.now ?? e.now();
  tidy(s, P);
  let rem = amount + (s.credit ?? 0);
  delete s.credit;
  const debts = (s.debts ??= []);
  for (const d of debts.sort((x, y) => x.from - y.from)) { const x = Math.min(rem, d.amount - d.paid); d.paid += x; rem -= x; if (!rem) break; }
  // Períodos que ya empezaron: cada uno se «renueva» y queda pagado (o debiendo lo que falte).
  const until = runsUntil(a, now);
  while (rem > 0 && boDayStart(s.expiresAt) <= boDayStart(until)) {
    const price = s.price ?? rem, x = Math.min(rem, price);
    debts.push({ from: s.expiresAt, to: s.expiresAt + P, amount: price, paid: x });
    s.expiresAt += P; rem -= x;
  }
  // Por adelantado: vence en 3 días (o lo pidió con «Renovó»).
  const daysLeft = Math.round((boDayStart(s.expiresAt) - boDayStart(now)) / DAY);
  if (rem > 0 && (opts.ahead || daysLeft <= SECRETARY_AHEAD_DAYS) && a.status === "active") {
    const price = s.price ?? rem, x = Math.min(rem, price);
    debts.push({ from: s.expiresAt, to: s.expiresAt + P, amount: price, paid: x });
    s.expiresAt += P; rem -= x;
  }
  if (rem > 0) s.credit = rem;
  tidy(s, P);
  return { to: s.expiresAt, credit: s.credit ?? 0 };
}

/**
 * «Renovó»: corre un período (el que ya empezó y no se renovó, o el próximo) y lo deja pagado (`paid` = su precio) o
 * debiendo («me paga después»). Lo que debía de antes sigue debiendo: las deudas se acumulan por período. Dentro de `tx`.
 */
export function chargePeriod(e: Engine, a: Assignment, s: SubRental, paid: Cents = 0) {
  const P = periodOf(e, a);
  tidy(s, P);
  const debts = (s.debts ??= []);
  const amount = s.price ?? 0;
  const d: SubDebt = { from: s.expiresAt, to: s.expiresAt + P, amount, paid: Math.min(amount, paid) };
  // Si tenía plata a favor, se usa en este período.
  if (s.credit && d.paid < d.amount) { const x = Math.min(s.credit, d.amount - d.paid); d.paid += x; s.credit -= x; }
  debts.push(d);
  s.expiresAt += P;
  tidy(s, P);
}

/** El período actual queda debiendo (lo marcó «Pendiente» / «No pagó» en el formulario). Dentro de `tx`. */
export function markCurrentUnpaid(e: Engine, a: Assignment, s: SubRental, pay: SubRental["pay"]) {
  const P = periodOf(e, a);
  tidy(s, P);
  if ((s.price ?? 0) > 0 && !(s.debts ?? []).some((d) => d.to === s.expiresAt)) (s.debts ??= []).push({ from: s.expiresAt - P, to: s.expiresAt, amount: s.price!, paid: 0 });
  tidy(s, P, pay);
  if (!s.debts) s.pay = pay; // sin precio no hay monto, pero se respeta lo que eligió
}

const productName = (e: Engine, a: Assignment) => (e.s.products[a.productId]?.name ?? "").replace(/ \(alquiler revendedores\)/, "");

/** Anota un cobro (positivo) o una corrección (negativa) en sus cobros. Dentro de `tx`. */
export function recordCobro(e: Engine, a: Assignment, s: SubRental, amount: Cents, extra: { note?: string; before?: string } = {}): ResellerCobro | null {
  if (!amount) return null;
  const c: ResellerCobro = { id: e.id("rco"), resellerId: a.customerId, at: e.now(), amount, assignmentId: a.id, subId: s.id, name: s.name, product: productName(e, a),
    ...(extra.note ? { note: extra.note } : {}), ...(extra.before !== undefined ? { undo: { before: extra.before, after: JSON.stringify(s) } } : {}) };
  cobros(e).push(c);
  return c;
}

/** Al marcar «Pendiente» algo que figuraba cobrado: se descuenta de sus cobros de los últimos 2 períodos (sin pasar de lo que cobró). */
export function uncollect(e: Engine, a: Assignment, s: SubRental, owedNow: Cents) {
  const since = e.now() - 2 * periodOf(e, a);
  const got = cobros(e).filter((c) => c.resellerId === a.customerId && c.subId === s.id && c.at >= since).reduce((t, c) => t + c.amount, 0);
  const back = Math.min(got, owedNow);
  if (back > 0) recordCobro(e, a, s, -back, { note: "Corregido: no te había pagado" });
}

/** Sus cobros de perfiles entre dos momentos (para Mis ganancias). */
export function cobrosOf(e: Engine, resellerId: Id, from: number, to: number): Cents {
  return (e.s.rcobros ?? []).filter((c) => c.resellerId === resellerId && c.at >= from && c.at < to).reduce((t, c) => t + c.amount, 0);
}

/** «Deshacer» un cobro de un toque (hasta 30 minutos y si el perfil no cambió después). Solo el suyo. */
export function undoCobro(e: Engine, actor: Actor, cobroId: Id) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return e.tx(() => {
    const l = cobros(e), i = l.findIndex((c) => c.id === cobroId && c.resellerId === actor.customerId);
    if (i === -1) throw new DomainError("NOT_FOUND", "Ese cobro no existe");
    const c = l[i];
    if (!c.undo || e.now() - c.at > UNDO_MINUTES * 60_000) throw new DomainError("VALIDATION", "Ya no se puede deshacer: corregilo en Repartir perfiles");
    const a = e.s.assignments[c.assignmentId];
    const s = a?.customerId === actor.customerId ? (a.subs ?? []).find((x) => x.id === c.subId) : undefined;
    if (!a || !s) throw new DomainError("NOT_FOUND", "Ese perfil ya no está");
    if (JSON.stringify(s) !== c.undo.after) throw new DomainError("VALIDATION", "Ese perfil cambió después del cobro: corregilo a mano");
    const before = JSON.parse(c.undo.before) as SubRental;
    for (const k of Object.keys(s) as (keyof SubRental)[]) delete s[k];
    Object.assign(s, before);
    l.splice(i, 1);
    e.audit(actor, "reseller.cobro_undo", "assignment", a.id, { sub: s.id, amount: c.amount });
    return { ok: true as const };
  });
}

/** Lo que «te debe hoy» un perfil: su deuda; si no debe y vence en 3 días (o hoy), el próximo período. */
export function dueNow(e: Engine, a: Assignment, s: SubRental, now = e.now()): Cents {
  const m = subMoney(e, a, s, now);
  if (m.owed > 0) return m.owed;
  const days = Math.round((boDayStart(s.expiresAt) - boDayStart(now)) / DAY);
  return days <= SECRETARY_AHEAD_DAYS && a.status === "active" ? s.price ?? 0 : 0;
}

/**
 * «Me pagó» de un perfil (Mi día, Quién me debe o Repartir perfiles): `amount` = cuánto te pagó (si no viene, lo que
 * debe hoy). Anota el cobro con su monto real y deja «Deshacer». Dentro de `tx`; `a` ya es del revendedor.
 */
export function payNow(e: Engine, actor: Actor, a: Assignment, s: SubRental, amount?: Cents) {
  const before = JSON.stringify(s);
  normalizeSub(e, a, s);
  const pay = amount ?? dueNow(e, a, s);
  if (!(pay > 0)) throw new DomainError("VALIDATION", "No te debe nada todavía");
  applyPayment(e, a, s, pay);
  const c = recordCobro(e, a, s, pay, { note: "Me pagó", before });
  const left = subMoney(e, a, s).owed;
  e.audit(actor, "reseller.sub_paid", "assignment", a.id, { sub: s.id, amount: pay, left });
  return { to: s.expiresAt, paid: pay, left, credit: s.credit ?? 0, cobroId: c?.id ?? null };
}
