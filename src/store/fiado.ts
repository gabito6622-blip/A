// Fiado: lo que te debe cada cliente o revendedor, como la columna "debe" del Excel.
//
// Es una libreta por cliente: "le fié" (cargo, con fecha de cobro opcional) y "me pagó" (pago,
// puede ser parcial). Lo que debe = cargos − pagos. Los cargos se pagan en orden (el más viejo
// primero): cuando un cargo que vino de un alquiler del Control queda cubierto, ese alquiler
// pasa solo a "Pagado". No toca el saldo de la tienda (esto es plata que te deben a vos).
//
// Cada revendedor tiene SU libreta (lo que le deben sus clientes a él), separada de la del dueño:
// los movimientos llevan `creditorId` = el revendedor; los del dueño no lo llevan.
import type { Actor, Assignment, Cents, FiadoEntry, Id, RentalControl } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { currencyOf, isForeign, listPriceMine, maxAmount, normAmount } from "./country.js";
import { effectivePrice, payerOf } from "./admin.js";
import { bsToUsd, isUsd, rateNow } from "./usd.js";
import { owedFor, payLaterToFiado } from "./plata.js";

const DAY = 86_400_000;
const all = (e: Engine) => (e.s.fiado ??= []);

/** De quién es la libreta: el dueño (staff, `undefined`) o un revendedor (su id). */
type Book = { creditor?: Id; owns: (customerId: Id) => boolean };
function bookOf(e: Engine, actor: Actor, write = true): Book {
  if (actor.role === "reseller" && actor.customerId) {
    const me = actor.customerId;
    return { creditor: me, owns: (cid) => e.s.customers[cid]?.resellerId === me };
  }
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo el dueño, su equipo o un revendedor");
  if (write) authorize(actor, "payment.review");
  return { creditor: undefined, owns: () => true };
}
const entriesOf = (e: Engine, b: Book) => all(e).filter((x) => x.creditorId === b.creditor);
/** El Control de cada libreta: el del dueño (`control`) o el del revendedor (`rcontrol`). */
const ctl = (a: Assignment, b: Book): RentalControl | undefined => (b.creditor ? a.rcontrol : a.control);
function setCtl(a: Assignment, b: Book, payStatus: RentalControl["payStatus"]) {
  if (b.creditor) a.rcontrol = { ...(a.rcontrol ?? {}), payStatus };
  else a.control = { ...(a.control ?? {}), payStatus };
}

/** Monto de un movimiento. La libreta de un revendedor de otro país va en su moneda (₲ sin decimales). */
function amountOf(e: Engine, b: Book, v: unknown): Cents {
  const c = b.creditor ? e.s.customers[b.creditor] : undefined;
  const n = c && isForeign(e, c) ? normAmount(Number(v), currencyOf(e, c)) : Math.round(Number(v));
  if (!Number.isInteger(n) || n <= 0 || n > maxAmount(e, c)) throw new DomainError("VALIDATION", "El monto tiene que ser mayor a 0");
  return n;
}
const noteOf = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (t.length > 120) throw new DomainError("VALIDATION", "La nota va hasta 120 letras");
  return t;
};
function customerOf(e: Engine, b: Book, customerId: Id) {
  const c = e.get("customers", customerId);
  if (!b.owns(customerId)) throw new DomainError("FORBIDDEN", "Ese cliente no es tuyo");
  return c;
}

/** Cargos de un cliente con lo que ya se cubrió de cada uno (los pagos van al más viejo primero). */
function settle(e: Engine, b: Book, customerId: Id) {
  const mine = entriesOf(e, b).filter((x) => x.customerId === customerId);
  let pool = mine.filter((x) => x.kind === "pago").reduce((t, x) => t + x.amount, 0);
  const charges = mine.filter((x) => x.kind === "cargo").sort((a, b2) => a.at - b2.at).map((c) => {
    const covered = Math.min(c.amount, pool);
    pool -= covered;
    return { ...c, covered };
  });
  const owed = charges.reduce((t, c) => t + c.amount - c.covered, 0);
  return { mine, charges, owed, credit: pool };
}

/** Cuando un cargo de alquiler queda cubierto, el alquiler pasa a "Pagado" en su Control. */
function syncControl(e: Engine, b: Book, customerId: Id) {
  // Por alquiler manda su último cargo: uno viejo ya pagado no pisa un mes nuevo marcado «Pendiente».
  const last = new Map<Id, ReturnType<typeof settle>["charges"][number]>();
  for (const c of settle(e, b, customerId).charges) if (c.assignmentId) last.set(c.assignmentId, c);
  for (const c of last.values()) {
    if (!c.assignmentId) continue;
    const a = e.s.assignments[c.assignmentId];
    // Después de «Pasar a otro», el alquiler ya es de otra persona: lo que pague (o deba) el anterior no toca el Control del nuevo.
    if (!a || a.customerId !== customerId) continue;
    const cur = ctl(a, b)?.payStatus ?? "pagado";
    // Un cargo de un período anterior (el alquiler ya se renovó después) no habla del mes que está usando ahora.
    if (c.covered >= c.amount && c.dueAt !== undefined && c.dueAt < a.customerExpiresAt - 20 * 86_400_000) continue;
    const want = c.covered >= c.amount ? "pagado" : cur === "no_pago" ? "no_pago" : "pendiente";
    if (cur !== want) setCtl(a, b, want);
  }
}

export function addCharge(e: Engine, actor: Actor, input: { customerId: Id; amount: unknown; note?: unknown; dueAt?: unknown; assignmentId?: Id }): FiadoEntry {
  const b = bookOf(e, actor);
  const amount = amountOf(e, b, input.amount), note = noteOf(input.note);
  const dueAt = input.dueAt === undefined || input.dueAt === null || input.dueAt === "" ? undefined : Number(input.dueAt);
  if (dueAt !== undefined && !Number.isFinite(dueAt)) throw new DomainError("VALIDATION", "Fecha de cobro inválida");
  return e.tx(() => {
    customerOf(e, b, input.customerId);
    if (input.assignmentId) {
      const a = e.get("assignments", input.assignmentId);
      if (a.customerId !== input.customerId) throw new DomainError("VALIDATION", "Ese alquiler es de otro cliente");
      if (entriesOf(e, b).some((x) => x.kind === "cargo" && x.assignmentId === input.assignmentId)) throw new DomainError("VALIDATION", "Ese alquiler ya está en el fiado");
    }
    const entry: FiadoEntry = { id: e.id("fia"), customerId: input.customerId, kind: "cargo", amount, note, at: e.now(), by: actor.id,
      ...(b.creditor ? { creditorId: b.creditor } : {}), ...(dueAt !== undefined ? { dueAt } : {}), ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}) };
    all(e).push(entry);
    if (!b.creditor && input.assignmentId) payLaterToFiado(e, input.assignmentId);
    syncControl(e, b, input.customerId);
    e.audit(actor, "fiado.charge", "customer", input.customerId, { amount, entry: entry.id });
    return structuredClone(entry);
  });
}

export function addPayment(e: Engine, actor: Actor, input: { customerId: Id; amount: unknown; note?: unknown }): { entry: FiadoEntry; owed: Cents } {
  const b = bookOf(e, actor);
  const amount = amountOf(e, b, input.amount), note = noteOf(input.note);
  return e.tx(() => {
    customerOf(e, b, input.customerId);
    // «Me pagó» en el Fiado por más de lo que hay en la libreta y con alquileres «Pendiente» en el Control: esos pasan a
    // su libreta, así el pago los cubre (antes quedaba «debe Bs 72» y «a favor Bs 20» a la vez, y el Control seguía
    // «Pendiente»). Si el pago entra en lo que ya debía, no se toca nada más.
    if (amount > settle(e, b, input.customerId).owed) linkUnpaid(e, b, actor, input.customerId);
    const entry: FiadoEntry = { id: e.id("fia"), customerId: input.customerId, kind: "pago", amount, note, at: e.now(), by: actor.id, ...(b.creditor ? { creditorId: b.creditor } : {}) };
    all(e).push(entry);
    syncControl(e, b, input.customerId);
    e.audit(actor, "fiado.payment", "customer", input.customerId, { amount, entry: entry.id });
    return { entry: structuredClone(entry), owed: settle(e, b, input.customerId).owed };
  });
}

/** Borrar un movimiento cargado por error (solo de la propia libreta). */
export function removeEntry(e: Engine, actor: Actor, entryId: Id): { ok: true } {
  const b = bookOf(e, actor);
  return e.tx(() => {
    const l = all(e), i = l.findIndex((x) => x.id === entryId && x.creditorId === b.creditor);
    if (i === -1) throw new DomainError("NOT_FOUND", "Movimiento no encontrado");
    const [x] = l.splice(i, 1);
    if (x.kind === "cargo" && x.assignmentId) {
      const a = e.s.assignments[x.assignmentId];
      if (a && a.customerId === x.customerId && ctl(a, b)?.payStatus === "pendiente") setCtl(a, b, "pagado");
      if (!b.creditor) payLaterToFiado(e, x.assignmentId, true);
    }
    syncControl(e, b, x.customerId);
    e.audit(actor, "fiado.remove", "customer", x.customerId, { kind: x.kind, amount: x.amount });
    return { ok: true as const };
  });
}

/** Alquileres marcados "Pendiente" o "No pagó" en el Control (de esa libreta) que no están en el fiado. */
function unpaidRentals(e: Engine, b: Book, customerId?: Id) {
  // «Ya está en el fiado» = tiene un cargo todavía abierto. Si lo que debía ya lo pagó y lo volvés a marcar «Pendiente»
  // (otro mes fiado), es una deuda nueva y tiene que verse (antes quedaba invisible: ni en la libreta ni afuera).
  const linked = new Set<Id | undefined>();
  for (const cid of new Set(entriesOf(e, b).filter((x) => x.assignmentId && (!customerId || x.customerId === customerId)).map((x) => x.customerId))) {
    for (const c of settle(e, b, cid).charges) if (c.assignmentId && c.covered < c.amount) linked.add(c.assignmentId);
  }
  return Object.values(e.s.assignments).filter((a) => a.status === "active" && (!customerId || a.customerId === customerId) && b.owns(a.customerId)
    && (!b.creditor || a.customerId !== b.creditor) && ctl(a, b)?.payStatus && ctl(a, b)!.payStatus !== "pagado" && !linked.has(a.id));
}
function rentalPrice(e: Engine, b: Book, a: Assignment): Cents {
  if (b.creditor) return a.rcontrol?.price ?? listPriceMine(e, e.s.customers[b.creditor], a.productId) ?? 0;
  // Libreta del dueño (en Bs): lo que de verdad te debe (15/11/2026). Si fue una venta o renovación fiada, lo fiado
  // (con sus meses y su cupón); si no, su precio real (`effectivePrice`: el acordado, el de la lista de quien paga
  // —revendedor o país— o el del producto; en dólares, a la tasa de hoy). Antes usaba el precio de lista del producto.
  return owedFor(e, a);
}

/** Pasa al fiado todos los alquileres sin pagar de un cliente (uno por alquiler, cobra al vencer). */
export function chargeUnpaidRentals(e: Engine, actor: Actor, customerId: Id): { added: number; amount: Cents } {
  const b = bookOf(e, actor);
  return e.tx(() => {
    customerOf(e, b, customerId);
    return linkUnpaid(e, b, actor, customerId);
  });
}

/** Los alquileres «Pendiente» del Control de ese cliente pasan a su libreta como cargos (uno por alquiler). Dentro de `tx`. */
function linkUnpaid(e: Engine, b: Book, actor: Actor, customerId: Id): { added: number; amount: Cents } {
  let added = 0, amount = 0;
  for (const a of unpaidRentals(e, b, customerId)) {
    const price = rentalPrice(e, b, a);
    if (price <= 0) continue;
    const slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
    all(e).push({ id: e.id("fia"), customerId, kind: "cargo", amount: price, at: e.now(), by: actor.id, assignmentId: a.id, dueAt: a.customerExpiresAt,
      ...(b.creditor ? { creditorId: b.creditor } : {}),
      note: `${e.s.products[a.productId]?.name ?? "Servicio"}${slot ? ` · ${slot.label}` : ""}${acc && !b.creditor ? ` · ${acc.email}` : ""}`.slice(0, 120) });
    // Si era una venta fiada, la plata ahora entra por el fiado (no por el pedido): no se cuenta dos veces.
    if (!b.creditor) payLaterToFiado(e, a.id);
    added++; amount += price;
  }
  if (added) e.audit(actor, "fiado.from_control", "customer", customerId, { added, amount });
  return { added, amount };
}

/** Hasta 3 apps distintas que el cliente tiene activas: id y nombre del producto (sin datos de la cuenta). */
function appsOf(e: Engine, customerId: Id): { productId: Id; product: string }[] {
  const out = new Map<Id, string>();
  for (const a of Object.values(e.s.assignments)) {
    if (a.customerId !== customerId || a.status !== "active" || out.has(a.productId)) continue;
    out.set(a.productId, (e.s.products[a.productId]?.name ?? "").replace(/ \(alquiler revendedores\)/, ""));
    if (out.size >= 3) break;
  }
  return [...out].map(([productId, product]) => ({ productId, product }));
}

/** Resumen para la pantalla Fiado: quién debe, cuánto, desde cuándo y cuándo se cobra. */
export function overview(e: Engine, actor: Actor) {
  const b = bookOf(e, actor, false);
  const now = e.now();
  const ids = new Set([...entriesOf(e, b).map((x) => x.customerId), ...unpaidRentals(e, b).map((a) => a.customerId)]);
  const rows = [...ids].filter((id) => b.owns(id)).map((id) => {
    const c = e.s.customers[id];
    const { charges, owed, credit } = settle(e, b, id);
    const open = charges.filter((x) => x.covered < x.amount);
    const nextDue = open.map((x) => x.dueAt).filter((x): x is number => !!x).sort((a, b2) => a - b2)[0];
    const pend = unpaidRentals(e, b, id);
    // Libreta del dueño: quien paga en dólares ve su deuda también en US$ (a la tasa de hoy; la libreta se lleva en Bs).
    const rate = rateNow(e), usdPayer = !b.creditor && isUsd(e, payerOf(e, id)) && rate > 0;
    return {
      customerId: id, name: c?.name ?? "?", phone: c?.phone ?? "", kind: c?.kind ?? "customer",
      currency: usdPayer ? "USD" as const : "BOB" as const,
      ...(usdPayer ? { owedUsd: bsToUsd(owed, rate, "up"), rate } : {}),
      owed, credit, openCharges: open.length, oldestAt: open[0]?.at, nextDue, overdue: !!nextDue && nextDue < now,
      unlinked: { count: pend.length, amount: pend.reduce((t, a) => t + rentalPrice(e, b, a), 0) },
      // Las apps que tiene activas (para mostrar sus logos): solo de este cliente, que es del mismo dueño de la libreta.
      apps: appsOf(e, id),
    };
  }).filter((r) => r.owed > 0 || r.unlinked.count || r.credit > 0)
    .sort((a, b2) => Number(b2.overdue) - Number(a.overdue) || b2.owed - a.owed);
  return {
    rows,
    totals: { owed: rows.reduce((t, r) => t + r.owed, 0), people: rows.filter((r) => r.owed > 0).length, overdue: rows.filter((r) => r.overdue).length,
      unlinked: rows.reduce((t, r) => t + r.unlinked.amount, 0), dueWeek: rows.filter((r) => r.nextDue && r.nextDue - now <= 7 * DAY).length },
  };
}

/** Movimientos de un cliente (para ver el detalle y mandarle el resumen). */
export function history(e: Engine, actor: Actor, customerId: Id) {
  const b = bookOf(e, actor, false);
  customerOf(e, b, customerId);
  const { mine, charges, owed, credit } = settle(e, b, customerId);
  const cov = new Map(charges.map((c) => [c.id, c.covered]));
  return { owed, credit, entries: mine.slice().sort((a, b2) => b2.at - a.at).map((x) => ({ ...structuredClone(x), covered: cov.get(x.id) })) };
}

/** Lo que un cliente le debe al dueño (para mostrarlo en otras pantallas). */
export function owedBy(e: Engine, customerId: Id): Cents {
  return settle(e, { creditor: undefined, owns: () => true }, customerId).owed;
}
