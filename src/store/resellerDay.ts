// «Mi día» del revendedor (13/11/2026): la secretaria del dueño, pero con SUS clientes y SUS perfiles repartidos.
// Son las mismas fórmulas (no hay agentes). Nada se manda solo: el revendedor toca «Me pagó» o abre WhatsApp con el mensaje listo.
//  - «💵 Cobrar hoy» = TODO lo que le deben (deudas.ts): la misma lista y el mismo total que «Te deben» de Repartir
//    perfiles y de «Quién me debe» (14/11/2026). Un perfil vencido y sin renovar es deuda, y no se va a los 30 días.
//  - «📣 Avisar»: perfiles que vencen en 1 a 3 días y clientes registrados que vencen pronto o ya vencieron (renovar).
//  - «Me pagó»: se escribe CUÁNTO te pagó (no el precio). Si es menos, queda «Debe Bs X» y el precio no cambia
//    (antes guardaba lo pagado como precio nuevo). En un perfil corre la fecha por cada período que cubre; en un cliente
//    registrado marca pagado (o anota el pago parcial en su libreta) y, si quiere, renueva con su saldo.
import type { Actor, Cents, Id, SubRental } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart } from "./time.js";
import { SECRETARY_AHEAD_DAYS } from "./secretary.js";
import { myControl, setMyControl } from "./resellerTools.js";
import { listMine } from "./subRentals.js";
import { renew as renewOrder } from "./orders.js";
import { balance } from "./wallet.js";
import { currencyOf, isForeign, maxAmount, normAmount } from "./country.js";
import { amountIn, applyPayment, dueNow, normalizeSub, payNow, subMoney } from "./cuadernoPlata.js";
import { myDebts, personKey, type DebtItem } from "./deudas.js";
import { addPayment } from "./fiado.js";

/** Perfiles vencidos de hace más de esto también salen en «Que vuelvan» (en «Cobrar hoy» siguen mientras estén anotados). */
export const DAY_BACK_DAYS = 30;

export interface DayItem {
  /** "client" = alquiler de un cliente registrado (id = assignmentId); "sub" = perfil repartido (id = assignmentId|subId);
   *  "fiado" = lo que te debe un cliente registrado en su libreta (id = f|customerId). */
  kind: "client" | "sub" | "fiado";
  id: Id;
  assignmentId: Id;
  subId?: Id;
  customerId?: Id;
  client: string;
  phone: string;
  productId: Id;
  product: string;
  /** Perfil del reparto («Mamá», «Perfil 2»), si es un perfil repartido. */
  label?: string;
  expiresAt: number;
  /** Días hasta el vencimiento (o desde que debe) por día calendario (0 = hoy, negativo = venció). */
  days: number;
  /** En «Cobrar hoy»: lo que debe. En «Avisar»: lo que le cobra. En SU moneda (null = sin precio cargado). */
  price: Cents | null;
  /** Lo que le cobra por período (perfiles). */
  unit?: Cents | null;
  /** Lo que debe hoy (0 si nada). */
  owed?: Cents;
  periods?: { from: number; to: number; owed: Cents }[];
  cut?: boolean;
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

const daysFn = (now: number) => { const today = boDayStart(now); return (t: number) => Math.round((boDayStart(t) - today) / DAY); };

/** Sus servicios de hoy: clientes registrados y perfiles repartidos de sus cuentas activas. */
function items(e: Engine, actor: Actor): DayItem[] {
  const daysTo = daysFn(e.now());
  const out: DayItem[] = [];
  for (const r of myControl(e, actor)) {
    if (r.holdOpen) continue;
    out.push({ kind: "client", id: r.id, assignmentId: r.id, client: r.client, phone: r.phone, productId: r.productId, product: r.product, expiresAt: r.expiresAt, days: daysTo(r.expiresAt), price: r.price, pay: r.pay as DayItem["pay"], note: r.note, cost: r.cost, canRenew: r.canRenew && r.renewableNow !== false, ...(r.linkToken ? { linkToken: r.linkToken } : {}) });
  }
  for (const a of listMine(e, actor)) for (const s of a.subs) {
    out.push({ kind: "sub", id: `${a.assignmentId}|${s.id}`, assignmentId: a.assignmentId, subId: s.id, client: s.name, phone: s.phone, productId: a.productId, product: a.product, label: s.label, expiresAt: s.expiresAt, days: daysTo(s.expiresAt), price: s.price ?? null, unit: s.price ?? null, owed: s.owed, periods: s.periods, pay: s.pay, note: s.note ?? "", ...(s.linkToken ? { linkToken: s.linkToken } : {}) });
  }
  return out;
}

/** Una deuda (deudas.ts) como renglón de Mi día: el precio es lo que debe. */
function debtItem(e: Engine, d: DebtItem, daysTo: (t: number) => number): DayItem {
  const s = d.kind === "sub" ? e.s.assignments[d.assignmentId!]?.subs?.find((x) => x.id === d.subId) : undefined;
  return { kind: d.kind, id: d.id, assignmentId: d.assignmentId ?? "", ...(d.subId ? { subId: d.subId } : {}), ...(d.customerId ? { customerId: d.customerId } : {}),
    client: d.client, phone: d.phone, productId: d.productId, product: d.product, ...(d.label ? { label: d.label } : {}),
    expiresAt: s?.expiresAt ?? d.since, days: daysTo(d.since), price: d.owed, owed: d.owed, unit: d.unit ?? null, ...(d.periods ? { periods: d.periods } : {}), ...(d.cut ? { cut: true } : {}),
    pay: d.pay, note: s?.note ?? "", ...(d.linkToken ? { linkToken: d.linkToken } : {}) };
}

function grouped(list: DayItem[]): DayGroup[] {
  const m = new Map<string, DayGroup>();
  for (const it of list) {
    const k = personKey(it.client, it.phone);
    const g = m.get(k) ?? { client: it.client, phone: it.phone, items: [], total: 0 };
    g.items.push(it); g.total += it.price ?? 0;
    m.set(k, g);
  }
  return [...m.values()].map((g) => ({ ...g, items: g.items.sort((x, y) => x.days - y.days || x.expiresAt - y.expiresAt) }))
    .sort((x, y) => x.items[0].days - y.items[0].days || x.items[0].expiresAt - y.items[0].expiresAt || x.client.localeCompare(y.client, "es"));
}

/** Lo de hoy, agrupado por cliente. Solo lo suyo. */
export function myDay(e: Engine, actor: Actor) {
  const me = reseller(e, actor);
  const daysTo = daysFn(e.now());
  const debts = myDebts(e, actor);
  const cobrar = debts.items.map((d) => debtItem(e, d, daysTo));
  const owing = new Set(cobrar.map((it) => it.id));
  const avisar = items(e, actor).filter((it) => (it.kind === "client" ? it.days <= SECRETARY_AHEAD_DAYS : !owing.has(it.id) && it.days > 0 && it.days <= SECRETARY_AHEAD_DAYS));
  const sum = (l: DayItem[]) => l.reduce((t, it) => t + (it.price ?? 0), 0);
  return {
    currency: currencyOf(e, me), foreign: isForeign(e, me),
    // «Me deben» quedó dentro de «Cobrar hoy» (una sola lista de deudas); se deja vacío para quien lo lea.
    counts: { cobrar: cobrar.length, avisar: avisar.length, deben: 0, people: debts.people },
    totals: { cobrar: debts.total, avisar: sum(avisar), deben: 0 },
    cobrar: grouped(cobrar), avisar: grouped(avisar), deben: [] as DayGroup[],
    balance: balance(e, me.id),
  };
}

/**
 * Texto del recordatorio matutino de Tito para el revendedor: «☀️ Tu día: 2 para cobrar · 1 por avisar», con los
 * primeros nombres y el aviso de saldo si no le alcanza para renovar a los que vencen. null si no hay nada que hacer.
 */
export function dayPushText(e: Engine, actor: Actor): { title: string; body: string; url: string } | null {
  const d = myDay(e, actor);
  const k = d.counts;
  if (!k.cobrar && !k.avisar) return null;
  const parts: string[] = [];
  // Clientes registrados ya vencidos (no es deuda: hay que renovarlos o se cortan): «por renovar».
  const renewN = d.avisar.flatMap((g) => g.items).filter((it) => it.kind === "client" && it.days <= 0).length;
  if (k.cobrar) parts.push(`${d.cobrar.length} para cobrar`);
  if (renewN) parts.push(`${renewN} por renovar`);
  if (k.avisar - renewN) parts.push(`${k.avisar - renewN} por avisar`);
  const groups = [...d.cobrar, ...d.avisar];
  const names = groups.slice(0, 3).map((g) => g.client.trim().split(/\s+/)[0]).join(", ") + (groups.length > 3 ? "…" : "");
  const need = groups.flatMap((g) => g.items).filter((it) => it.kind === "client" && it.canRenew).reduce((t, it) => t + (it.cost ?? 0), 0);
  const saldo = need > d.balance ? ` · ⚠️ Te falta saldo para renovarlos (tenés ${(d.balance / 100).toFixed(0)}, necesitás ${(need / 100).toFixed(0)})` : "";
  return { title: `☀️ Tu día: ${parts.join(" · ")}`, body: `${names}${saldo}. Tocá para abrir Mi día.`, url: "/hub#dia" };
}

const find = (e: Engine, actor: Actor, id: Id): DayItem => {
  if (!id.startsWith("f|")) {
    const it = items(e, actor).find((x) => x.id === id);
    if (it) return it;
  }
  // Una deuda de la libreta, o un perfil de una cuenta que se cortó: se puede cobrar lo que debía.
  const d = myDebts(e, actor).items.find((x) => x.id === id);
  if (d) return debtItem(e, d, daysFn(e.now()));
  throw new DomainError("NOT_FOUND", "Ese servicio no es de un cliente tuyo");
};

/** El perfil y su alquiler, del revendedor que pregunta (también si la cuenta se cortó). */
function subOf(e: Engine, actor: Actor, it: DayItem) {
  const a = e.s.assignments[it.assignmentId];
  const s = a && a.customerId === actor.customerId ? (a.subs ?? []).find((x) => x.id === it.subId) : undefined;
  if (!a || !s) throw new DomainError("NOT_FOUND", "Ese perfil no existe");
  return { a, s };
}

/** Qué va a pasar si toca «Me pagó», antes de guardar. `amount` = lo que escribió (si no, lo que debe hoy). */
export function dayPreview(e: Engine, actor: Actor, id: Id, amount?: Cents) {
  const me = reseller(e, actor);
  const it = find(e, actor, id);
  const days = e.s.products[it.productId]?.durationDays ?? 30;
  const now = e.now();
  const bal = balance(e, me.id);
  if (it.kind === "sub") {
    const { a, s } = subOf(e, actor, it);
    const m = subMoney(e, a, s);
    const due = dueNow(e, a, s, now);
    const pay = amount ?? due;
    const sim = structuredClone(s) as SubRental;
    if (pay > 0) applyPayment(e, a, sim, pay, { now });
    const left = subMoney(e, a, sim).owed;
    return { item: it, price: due, due, unit: s.price ?? null, owed: m.owed, periods: m.periods, amount: pay, left, credit: sim.credit ?? 0, moves: sim.expiresAt !== s.expiresAt, to: sim.expiresAt, renew: null, blockers: [] as string[] };
  }
  if (it.kind === "fiado") {
    const owed = it.owed ?? 0, pay = amount ?? owed;
    return { item: it, price: owed, due: owed, owed, amount: pay, left: Math.max(0, owed - pay), moves: false, to: it.expiresAt, renew: null, blockers: [] as string[] };
  }
  // Cliente registrado: marcar pagado en Mi control; la renovación real (con su saldo) es opcional y tiene sus frenos.
  const soon = it.days <= SECRETARY_AHEAD_DAYS;
  const cost = it.cost ?? 0;
  const renew = { offered: soon && !!it.canRenew, cost, balance: bal, enough: bal >= cost, to: Math.max(it.expiresAt, now) + days * DAY, blocked: soon && !it.canRenew ? "Este servicio lo renueva la tienda (la cuenta vence antes o no está a la venta): escribile." : null };
  const pay = amount ?? it.price ?? 0;
  return { item: it, price: it.price, due: it.price ?? 0, owed: 0, amount: pay, left: Math.max(0, (it.price ?? 0) - pay), moves: false, to: it.expiresAt, renew, blockers: [] as string[] };
}

/**
 * «Me pagó»: idempotente por `idempotencyKey`. `amount` = cuánto te pagó (si no viene, lo que debe). Si es menos, queda
 * debiendo el resto y el precio NO cambia. `price` (opcional) corrige lo que le cobra de ahora en adelante. En un cliente
 * registrado, `renew: true` además renueva con su saldo (misma `orders.renew` de siempre: frenos del proveedor, saldo y
 * precio acordado); si falla, el pago igual queda anotado y se devuelve el motivo.
 */
export function dayPay(e: Engine, actor: Actor, id: Id, input: { amount?: unknown; price?: unknown; renew?: unknown; idempotencyKey?: unknown } = {}) {
  const me = reseller(e, actor);
  const key = input.idempotencyKey === undefined || input.idempotencyKey === null ? undefined : String(input.idempotencyKey).slice(0, 80);
  const has = (v: unknown) => v !== undefined && v !== null && v !== "";
  const run = () => {
    const it = find(e, actor, id);
    const amount = has(input.amount) ? amountIn(e, actor, input.amount) : undefined;
    const price = has(input.price) ? input.price : undefined;
    if (it.kind === "sub") {
      return e.tx(() => {
        const { a, s } = subOf(e, actor, it);
        if (price !== undefined) {
          normalizeSub(e, a, s); // lo que ya debía queda con el precio de antes
          const n = isForeign(e, me) ? normAmount(Number(price), currencyOf(e, me)) : Math.round(Number(price));
          if (!Number.isInteger(n) || n < 0 || n > maxAmount(e, me)) throw new DomainError("VALIDATION", "Precio inválido");
          s.price = n;
        }
        const r = payNow(e, actor, a, s, amount);
        return { ok: true as const, kind: "sub" as const, ...r, renewed: null as null | boolean, renewError: null as null | string };
      });
    }
    if (it.kind === "fiado") {
      const pay = amount ?? it.owed ?? 0;
      const r = addPayment(e, actor, { customerId: it.customerId!, amount: pay, note: "Me pagó (Mi día)" });
      return { ok: true as const, kind: "fiado" as const, to: it.expiresAt, paid: pay, left: r.owed, credit: 0, cobroId: null, renewed: null, renewError: null };
    }
    const pv = dayPreview(e, actor, id);
    const full = amount === undefined || it.price === null || amount >= (it.price ?? 0);
    let renewed: boolean | null = null, renewError: string | null = null;
    const doRenew = () => {
      if (input.renew !== true) return;
      if (!pv.renew?.offered) { renewError = pv.renew?.blocked ?? "Todavía no hace falta renovar"; return; }
      try { renewOrder(e, actor, it.assignmentId, { paymentMethod: "balance", periods: 1, idempotencyKey: key ? `day:${key}` : undefined }); renewed = true; }
      catch (err) { renewed = false; renewError = err instanceof DomainError ? err.message : "No se pudo renovar"; }
    };
    let left = 0;
    if (full) {
      setMyControl(e, actor, it.assignmentId, { payStatus: "pagado", ...(price !== undefined ? { price } : {}) });
      doRenew();
    } else {
      // Pago parcial (14/11): primero se renueva (si quiere), después queda «Pendiente» en su libreta con lo que pagó.
      doRenew();
      setMyControl(e, actor, it.assignmentId, { payStatus: "pendiente", ...(price !== undefined ? { price } : {}) });
      left = addPayment(e, actor, { customerId: e.s.assignments[it.assignmentId].customerId, amount: amount!, note: "Pagó una parte (Mi día)" }).owed;
    }
    e.audit(actor, "reseller.day_paid", "assignment", it.assignmentId, { amount: amount ?? it.price, renewed, partial: !full });
    return { ok: true as const, kind: "client" as const, to: e.s.assignments[it.assignmentId].customerExpiresAt, paid: amount ?? it.price ?? 0, left, credit: 0, cobroId: null, renewed, renewError };
  };
  return key ? e.idempotent(`rday:${id}:${key}`, run) : run();
}
