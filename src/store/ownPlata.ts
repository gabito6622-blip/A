// "📦 Mis cuentas propias" (parte 2, 14/11/2026): la plata y el día a día del revendedor INDEPENDIENTE, que vive de
// SUS cuentas. Lo mismo que el dueño tiene en su panel, pero sobre su cuaderno (ownStock.ts):
//  - Deudas que no se borran: cada período es un cargo y cada cobro un pago (puede ser parcial). Un cliente liberado
//    que debe queda en «Quién me debe» hasta que pague o lo perdone.
//  - Cuenta caída: no se vende; «Mover a otra cuenta» (uno) y «Mover todos» mantienen fecha, precio, deuda y link.
//  - «Pagué a mi proveedor» (monto y meses) + el libro de cobros → «Mis ganancias»: entró − pagaste = te quedó.
//  - Su día (cobrar, avisar, me deben, cuentas con su proveedor) y «Que vuelvan».
// Aislamiento: todo pasa por `me()` (rol revendedor + permiso reseller.own_stock) y lee solo `ownStock[<su id>]`.
// Nunca devuelve contraseñas (eso queda en la vista de su pestaña). La auditoría guarda ids y montos.
import type { Actor, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart } from "./time.js";
import { currencyOf } from "./country.js";
import {
  type OwnAccount, type OwnGone, type OwnSale, type OwnStockBook,
  me, book, peek, accountOf, amount, text, blockedWhy, BLOCKED_MSG, debts, debtOf, ensureLedger, entry, renewFrom,
} from "./ownStock.js";

/** Mi día: vencidos hasta 30 días atrás van a «Cobrar»; los de 1 a 3 días, a «Avisar». */
export const OWN_DAY_BACK = 30, OWN_DAY_AHEAD = 3;
/** Que vuelvan: vencidos entre 31 y 90 días, o liberados en los últimos 90. «Ya le escribí» lo calla 7 días. */
export const OWN_BACK_DAYS = 90, OWN_BACK_QUIET = 7;

const anySale = (b: OwnStockBook, id: unknown): OwnSale | OwnGone => {
  const s = b.sales.find((x) => x.id === id) ?? (b.gone ?? []).find((x) => x.id === id);
  if (!s) throw new DomainError("NOT_FOUND", "Ese cliente no está en tus cuentas propias");
  return s;
};
const freeOf = (b: OwnStockBook, a: OwnAccount) => {
  const used = new Set(b.sales.filter((s) => s.accountId === a.id).map((s) => s.slot));
  return Array.from({ length: a.slots }, (_, i) => i + 1).filter((n) => !used.has(n));
};
/** Mes en Bolivia (UTC-4): "2026-08". */
const monthKey = (t: number) => new Date(t - 4 * 3_600_000).toISOString().slice(0, 7);
const monthEnd = (k: string) => { const [y, m] = k.split("-").map(Number); return Date.UTC(y, m, 1) + 4 * 3_600_000 - 1; };
const MONTHS = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthLabel = (k: string) => { const [y, m] = k.split("-").map(Number); return `${MONTHS[m - 1]} ${y}`; };

/* ---------------- cobros ---------------- */
/** «Me pagó» con monto (pago parcial o total), de un cliente activo o de uno liberado que quedó debiendo. */
export function pay(e: Engine, actor: Actor, saleId: Id, raw: { amount?: unknown; note?: unknown } = {}) {
  const c = me(e, actor);
  const note = text(raw.note, 120, "la nota");
  const amt = raw.amount === undefined || raw.amount === null || raw.amount === "" ? undefined : amount(e, c, raw.amount, "Monto");
  return e.tx(() => {
    const b = book(e, c.id);
    const s = anySale(b, saleId);
    ensureLedger(e, b);
    const owe = debtOf(b, s.id);
    if (owe <= 0) throw new DomainError("INVALID_STATE", "No te debe nada");
    const n = amt ?? owe;
    if (n <= 0) throw new DomainError("VALIDATION", "Escribí cuánto te pagó");
    if (n > owe) throw new DomainError("VALIDATION", "Es más de lo que te debe");
    entry(e, b, s, { kind: "pago", amount: n, ...(note ? { note } : {}) });
    e.audit(actor, "own.pay", "customer", c.id, { sale: s.id, amount: n });
    return { ok: true as const, paid: n, debt: debtOf(b, s.id) };
  });
}

/** «Lo perdono»: borra lo que debe con un movimiento (queda en el libro). */
export function forgive(e: Engine, actor: Actor, saleId: Id) {
  const c = me(e, actor);
  return e.tx(() => {
    const b = book(e, c.id);
    const s = anySale(b, saleId);
    ensureLedger(e, b);
    const owe = debtOf(b, s.id);
    if (owe <= 0) throw new DomainError("INVALID_STATE", "No te debe nada");
    entry(e, b, s, { kind: "perdon", amount: owe, note: "Perdonado" });
    e.audit(actor, "own.forgive", "customer", c.id, { sale: s.id, amount: owe });
    return { ok: true as const, forgiven: owe };
  });
}

/* ---------------- cuenta caída y mover ---------------- */
/** «Se cayó esta cuenta» (o «volvió»): una cuenta caída no se ofrece ni se asignan cupos. */
export function setDown(e: Engine, actor: Actor, accountId: Id, raw: { down?: unknown; note?: unknown } = {}) {
  const c = me(e, actor);
  const note = text(raw.note, 120, "el motivo");
  return e.tx(() => {
    const a = accountOf(book(e, c.id), accountId);
    if (raw.down === false) delete a.down; else a.down = { at: e.now(), ...(note ? { note } : {}) };
    e.audit(actor, raw.down === false ? "own.account_up" : "own.account_down", "customer", c.id, { account: a.id });
    return { ok: true as const, down: !!a.down };
  });
}

function moveOne(e: Engine, b: OwnStockBook, s: OwnSale, to: OwnAccount, slot?: number) {
  const from = b.accounts.find((a) => a.id === s.accountId);
  if (to.id === s.accountId) throw new DomainError("VALIDATION", "Ya está en esa cuenta");
  if (from && from.productId !== to.productId) throw new DomainError("VALIDATION", "Movelo a otra cuenta del mismo producto");
  const why = blockedWhy(to, e.now());
  if (why) throw new DomainError("OUT_OF_STOCK", BLOCKED_MSG[why]);
  const free = freeOf(b, to);
  const n = slot ?? free[0];
  if (n === undefined) throw new DomainError("OUT_OF_STOCK", "Esa cuenta no tiene cupos libres");
  if (!free.includes(n)) throw new DomainError("OUT_OF_STOCK", "Ese cupo ya lo tiene otro cliente");
  // Se mueve el cupo: la fecha, el precio, la deuda (el libro va por cliente) y el link de cobro quedan iguales.
  s.accountId = to.id; s.slot = n;
  return { id: s.id, name: s.name, accountId: to.id, user: to.user, slot: n };
}

/** «Mover a otra cuenta»: un cliente pasa a un cupo libre de otra cuenta del mismo producto. */
export function move(e: Engine, actor: Actor, saleId: Id, raw: { accountId?: unknown; slot?: unknown } = {}) {
  const c = me(e, actor);
  const slot = raw.slot === undefined || raw.slot === null || raw.slot === "" ? undefined : Number(raw.slot);
  if (slot !== undefined && !(Number.isInteger(slot) && slot >= 1 && slot <= 10)) throw new DomainError("VALIDATION", "Ese cupo no existe en la cuenta");
  return e.tx(() => {
    const b = book(e, c.id);
    const s = b.sales.find((x) => x.id === saleId);
    if (!s) throw new DomainError("NOT_FOUND", "Ese cliente no está en tus cuentas propias");
    const from = s.accountId;
    const r = moveOne(e, b, s, accountOf(b, raw.accountId), slot);
    e.audit(actor, "own.move", "customer", c.id, { sale: s.id, from, to: r.accountId, slot: r.slot });
    return r;
  });
}

/** «Mover todos» (cuenta caída): reparte a sus clientes en los cupos libres de las otras cuentas del mismo producto. */
export function moveAll(e: Engine, actor: Actor, accountId: Id, raw: { toAccountId?: unknown } = {}) {
  const c = me(e, actor);
  return e.tx(() => {
    const b = book(e, c.id);
    const from = accountOf(b, accountId);
    const now = e.now();
    const targets = raw.toAccountId ? [accountOf(b, raw.toAccountId)] : b.accounts.filter((a) => a.id !== from.id && a.productId === from.productId && !blockedWhy(a, now));
    if (raw.toAccountId && targets[0].id === from.id) throw new DomainError("VALIDATION", "Elegí otra cuenta");
    const moved: ReturnType<typeof moveOne>[] = [], left: { id: Id; name: string }[] = [];
    for (const s of b.sales.filter((x) => x.accountId === from.id).sort((x, y) => x.slot - y.slot)) {
      const to = targets.find((a) => !blockedWhy(a, now) && a.productId === from.productId && freeOf(b, a).length);
      if (to) moved.push(moveOne(e, b, s, to)); else left.push({ id: s.id, name: s.name });
    }
    e.audit(actor, "own.move_all", "customer", c.id, { from: from.id, moved: moved.length, left: left.length });
    return { moved, left };
  });
}

/* ---------------- proveedor ---------------- */
/**
 * «Pagué a mi proveedor»: cuánto y por cuántos meses (períodos del producto). Corre la fecha con su proveedor
 * (desde el vencimiento si es dentro del plazo, como una renovación) y queda en «Mis ganancias» como lo que pagaste.
 */
export function providerPay(e: Engine, actor: Actor, accountId: Id, raw: { amount?: unknown; months?: unknown; note?: unknown; extend?: unknown } = {}) {
  const c = me(e, actor);
  const amt = amount(e, c, raw.amount ?? "", "Monto");
  if (amt <= 0) throw new DomainError("VALIDATION", "Escribí cuánto le pagaste");
  const months = raw.months === undefined || raw.months === "" ? 1 : Number(raw.months);
  if (!Number.isInteger(months) || months < 1 || months > 24) throw new DomainError("VALIDATION", "Meses: de 1 a 24");
  const note = text(raw.note, 120, "la nota");
  return e.tx(() => {
    const b = book(e, c.id);
    const a = accountOf(b, accountId);
    const p = b.products.find((x) => x.id === a.productId);
    const now = e.now();
    let to: number | undefined;
    if (raw.extend !== false) {
      to = renewFrom(a.providerExpiresAt ?? now, now) + months * (p?.durationDays ?? 30) * DAY;
      a.providerExpiresAt = to;
    }
    if (a.cost === undefined) a.cost = Math.round(amt / months);
    const P = (b.provPays ??= []);
    if (P.length >= 20_000) throw new DomainError("VALIDATION", "Tu libro de pagos está lleno");
    P.push({ id: e.id("opp"), accountId: a.id, productId: a.productId, user: a.user, amount: amt, months, at: now, ...(to ? { to } : {}), ...(note ? { note } : {}) });
    e.audit(actor, "own.provider_pay", "customer", c.id, { account: a.id, amount: amt, months });
    return { ok: true as const, providerExpiresAt: a.providerExpiresAt ?? null };
  });
}

/* ---------------- Mis ganancias ---------------- */
/**
 * Por mes: lo que vendiste (cargos), lo que entró (pagos), lo que pagaste a tus proveedores y lo que te quedó;
 * y lo que te debían al cerrar el mes. `month` ("2026-09") elige qué mes del libro de cobros se lista.
 */
export function earnings(e: Engine, actor: Actor, month?: unknown) {
  const c = me(e, actor);
  const b = peek(e, c.id);
  const now = e.now();
  const L = b.ledger ?? [];
  const P = b.provPays ?? [];
  // Las ventas de antes del libro cuentan con su cargo (y su pago) del día que se cargaron.
  const legacy = [...b.sales, ...(b.gone ?? [])].filter((s) => !s.led && !s.trial && (s.price ?? 0) > 0);
  const rows = [
    ...L.map((x) => ({ saleId: x.saleId, kind: x.kind, amount: x.amount, at: x.at, note: x.note ?? "" })),
    ...legacy.flatMap((s) => [{ saleId: s.id, kind: "cargo" as const, amount: s.price!, at: s.createdAt, note: "" }, ...(s.pay === "pagado" ? [{ saleId: s.id, kind: "pago" as const, amount: s.price!, at: s.createdAt, note: "" }] : [])]),
  ];
  const cur = monthKey(now);
  const keys = new Set<string>([cur, ...rows.map((x) => monthKey(x.at)), ...P.map((x) => monthKey(x.at))]);
  const list = [...keys].filter((k) => k <= cur).sort().slice(-12);
  const months = list.map((k) => {
    const inM = (t: number) => monthKey(t) === k;
    const sold = rows.filter((x) => x.kind === "cargo" && inM(x.at)).reduce((t, x) => t + x.amount, 0);
    const got = rows.filter((x) => x.kind === "pago" && inM(x.at)).reduce((t, x) => t + x.amount, 0);
    const paid = P.filter((x) => inM(x.at)).reduce((t, x) => t + x.amount, 0);
    const end = Math.min(monthEnd(k), now);
    const per = new Map<Id, number>();
    for (const x of rows) if (x.at <= end) per.set(x.saleId, (per.get(x.saleId) ?? 0) + (x.kind === "cargo" ? x.amount : -x.amount));
    const owed = [...per.values()].reduce((t, v) => t + Math.max(0, v), 0);
    return { month: k, label: monthLabel(k), sold, in: got, out: paid, kept: got - paid, owed };
  });
  // Lo que cuestan sus cuentas por mes (lo que anotó como costo; por período del producto → a 30 días).
  const dur = (a: OwnAccount) => b.products.find((p) => p.id === a.productId)?.durationDays ?? 30;
  const costMonthly = b.accounts.reduce((t, a) => t + (a.cost ? Math.round((a.cost * 30) / Math.max(1, dur(a))) : 0), 0);
  const noCost = b.accounts.filter((a) => a.cost === undefined).length;
  // Libro del mes elegido: cobros, cargos y pagos a proveedores, con nombre y producto.
  const k = typeof month === "string" && /^\d{4}-\d{2}$/.test(month) ? month : cur;
  const who = new Map<Id, { name: string; product: string }>();
  const prod = (accId: Id) => b.products.find((p) => p.id === b.accounts.find((a) => a.id === accId)?.productId)?.name ?? "";
  for (const s of b.sales) who.set(s.id, { name: s.name, product: prod(s.accountId) });
  for (const g of b.gone ?? []) who.set(g.id, { name: g.name, product: g.product });
  const ledger = [
    ...rows.filter((x) => monthKey(x.at) === k).map((x) => ({ at: x.at, kind: x.kind, amount: x.amount, name: who.get(x.saleId)?.name ?? "", product: who.get(x.saleId)?.product ?? "", note: x.note })),
    ...P.filter((x) => monthKey(x.at) === k).map((x) => ({ at: x.at, kind: "proveedor" as const, amount: x.amount, name: x.user, product: b.products.find((p) => p.id === x.productId)?.name ?? "", note: `${x.months} ${x.months === 1 ? "mes" : "meses"}${x.note ? ` · ${x.note}` : ""}` })),
  ].sort((x, y) => y.at - x.at).slice(0, 400);
  return { currency: currencyOf(e, c), months, current: months[months.length - 1], costMonthly, noCost, accounts: b.accounts.length, ledgerMonth: k, ledgerLabel: monthLabel(k), ledger };
}

/* ---------------- su día ---------------- */
export interface OwnDayItem {
  id: Id; name: string; phone: string; product: string; productId: Id; accountId: Id; user: string; slot: number;
  expiresAt: number; days: number; price: Cents | null; debt: Cents; trial: boolean; linkToken?: string; blocked?: string; gone?: boolean;
}

/** Lo de hoy con sus cuentas propias: cobrar, avisar, me deben y sus cuentas con su proveedor (también las vencidas). */
export function day(e: Engine, actor: Actor) {
  const c = me(e, actor);
  const b = peek(e, c.id);
  const now = e.now(), today = boDayStart(now);
  const daysTo = (t: number) => Math.round((boDayStart(t) - today) / DAY);
  const owe = debts(b);
  const acc = new Map(b.accounts.map((a) => [a.id, a]));
  const prodOf = (a?: OwnAccount) => b.products.find((p) => p.id === a?.productId);
  const all: OwnDayItem[] = b.sales.map((s) => {
    const a = acc.get(s.accountId), why = a ? blockedWhy(a, now) : null;
    return { id: s.id, name: s.name, phone: s.phone, product: prodOf(a)?.name ?? "", productId: a?.productId ?? "", accountId: s.accountId, user: a?.user ?? "", slot: s.slot, expiresAt: s.expiresAt, days: daysTo(s.expiresAt), price: s.price ?? null, debt: owe.get(s.id) ?? 0, trial: !!s.trial, ...(s.link ? { linkToken: s.link.token } : {}), ...(why ? { blocked: why } : {}) };
  });
  const cobrar = all.filter((x) => x.days <= 0 && x.days >= -OWN_DAY_BACK).sort((x, y) => x.expiresAt - y.expiresAt);
  const avisar = all.filter((x) => x.days > 0 && x.days <= OWN_DAY_AHEAD).sort((x, y) => x.expiresAt - y.expiresAt);
  const inCobrar = new Set(cobrar.map((x) => x.id));
  const deben = [
    // 15/11: también los que vencieron hace más de 30 días y siguen debiendo (antes no salían en ninguna lista de Mi día).
    ...all.filter((x) => x.debt > 0 && !inCobrar.has(x.id) && (x.days > OWN_DAY_AHEAD || x.days < -OWN_DAY_BACK)),
    // Liberados que pasó a «Quién me debe».
    ...(b.gone ?? []).filter((g) => (owe.get(g.id) ?? 0) > 0).map((g) => ({ id: g.id, name: g.name, phone: g.phone, product: g.product, productId: g.productId, accountId: g.accountId, user: g.user, slot: g.slot, expiresAt: g.expiresAt, days: daysTo(g.expiresAt), price: g.price ?? null, debt: owe.get(g.id) ?? 0, trial: false, gone: true })),
  ];
  const clientsOf = (id: Id) => b.sales.filter((s) => s.accountId === id).length;
  const provider = b.accounts
    .filter((a) => a.down ? clientsOf(a.id) > 0 : a.providerExpiresAt !== undefined && daysTo(a.providerExpiresAt) <= OWN_DAY_AHEAD && daysTo(a.providerExpiresAt) >= -OWN_DAY_BACK)
    .map((a) => ({ id: a.id, user: a.user, product: prodOf(a)?.name ?? "", expiresAt: a.providerExpiresAt ?? null, days: a.providerExpiresAt ? daysTo(a.providerExpiresAt) : null, clients: clientsOf(a.id), cost: a.cost ?? null, down: !!a.down }))
    .sort((x, y) => (x.expiresAt ?? 0) - (y.expiresAt ?? 0));
  const sum = (l: OwnDayItem[], f: (x: OwnDayItem) => number) => l.reduce((t, x) => t + f(x), 0);
  const late = cobrar.filter((x) => x.days < 0).length + provider.filter((p) => p.down || (p.days ?? 1) < 0).length;
  // Para el Inicio: lo que le deben en total y lo que entró y salió este mes (sin pedir «Mis ganancias» entera).
  const mk = monthKey(now);
  const got = (b.ledger ?? []).filter((x) => x.kind === "pago" && monthKey(x.at) === mk).reduce((t, x) => t + x.amount, 0)
    + [...b.sales, ...(b.gone ?? [])].filter((s) => !s.led && !s.trial && s.pay === "pagado" && monthKey(s.createdAt) === mk).reduce((t, s) => t + (s.price ?? 0), 0);
  const out = (b.provPays ?? []).filter((x) => monthKey(x.at) === mk).reduce((t, x) => t + x.amount, 0);
  return {
    currency: currencyOf(e, c),
    has: b.sales.length + b.accounts.length > 0,
    owed: [...owe.values()].reduce((t, v) => t + v, 0),
    month: { in: got, out, kept: got - out },
    counts: { cobrar: cobrar.length, avisar: avisar.length, deben: deben.length, provider: provider.length, late },
    totals: { cobrar: sum(cobrar, (x) => x.debt + (x.trial ? 0 : x.price ?? 0)), avisar: sum(avisar, (x) => x.price ?? 0), deben: sum(deben, (x) => x.debt) },
    cobrar, avisar, deben, provider,
  };
}

/* ---------------- que vuelvan ---------------- */
/** Sus clientes de cuentas propias que no renovaron (vencidos hace más de 30 días) o que liberó, para escribirles. */
export function back(e: Engine, actor: Actor) {
  const c = me(e, actor);
  const b = peek(e, c.id);
  const now = e.now(), today = boDayStart(now);
  const ago = (t: number) => Math.round((today - boDayStart(t)) / DAY);
  const quiet = (k: string) => (b.back?.[k] ?? 0) > now - OWN_BACK_QUIET * DAY;
  const activePhones = new Set(b.sales.filter((s) => s.expiresAt >= now - OWN_DAY_BACK * DAY).map((s) => s.phone.replace(/\D/g, "")));
  const prod = (accId: Id) => b.products.find((p) => p.id === b.accounts.find((a) => a.id === accId)?.productId)?.name ?? "";
  const items = [
    ...b.sales.filter((s) => !s.trial && ago(s.expiresAt) > OWN_DAY_BACK && ago(s.expiresAt) <= OWN_BACK_DAYS)
      .map((s) => ({ key: `s:${s.id}`, name: s.name, phone: s.phone, product: prod(s.accountId), expiredAt: s.expiresAt, days: ago(s.expiresAt), price: s.price ?? null, released: false })),
    ...(b.gone ?? []).filter((g) => !g.trial && ago(g.releasedAt) <= OWN_BACK_DAYS && !activePhones.has(g.phone.replace(/\D/g, "")))
      .map((g) => ({ key: `g:${g.id}`, name: g.name, phone: g.phone, product: g.product, expiredAt: Math.min(g.expiresAt, g.releasedAt), days: ago(Math.min(g.expiresAt, g.releasedAt)), price: g.price ?? null, released: true })),
  ];
  // Un mismo cliente (teléfono) aparece una vez: el más reciente.
  const seen = new Set<string>();
  // 15/11: quien todavía le debe no sale acá: ya está en «Te deben» de Mi día con su mensaje para cobrar.
  const owe = debts(b), owingPhones = new Set([...b.sales, ...(b.gone ?? [])].filter((x) => (owe.get(x.id) ?? 0) > 0).map((x) => x.phone.replace(/\D/g, "")));
  const all = items.sort((x, y) => x.days - y.days).filter((x) => { const k = x.phone.replace(/\D/g, ""); if (seen.has(k)) return false; seen.add(k); return true; });
  const list = all.filter((x) => !owingPhones.has(x.phone.replace(/\D/g, "")));
  return { quietDays: OWN_BACK_QUIET, written: list.filter((x) => quiet(x.key)).length, items: list.filter((x) => !quiet(x.key)), owing: all.length - list.length };
}

/** «Ya le escribí» (o deshacerlo). */
export function markBack(e: Engine, actor: Actor, key: unknown, off = false) {
  const c = me(e, actor);
  const k = String(key ?? "");
  if (!/^[sg]:[A-Za-z0-9_-]{1,40}$/.test(k)) throw new DomainError("VALIDATION", "Cliente inválido");
  return e.tx(() => {
    const b = book(e, c.id);
    const id = k.slice(2);
    if (!(k[0] === "s" ? b.sales : b.gone ?? []).some((x) => x.id === id)) throw new DomainError("NOT_FOUND", "Ese cliente no está en tus cuentas propias");
    const B = (b.back ??= {});
    if (off) delete B[k]; else B[k] = e.now();
    for (const [x, t] of Object.entries(B)) if (t < e.now() - 30 * DAY) delete B[x];
    return { ok: true as const };
  });
}
