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
  for (const c of settle(e, b, customerId).charges) {
    if (!c.assignmentId) continue;
    const a = e.s.assignments[c.assignmentId];
    if (!a) continue;
    const cur = ctl(a, b)?.payStatus ?? "pagado";
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
      if (a && ctl(a, b)?.payStatus === "pendiente") setCtl(a, b, "pagado");
    }
    syncControl(e, b, x.customerId);
    e.audit(actor, "fiado.remove", "customer", x.customerId, { kind: x.kind, amount: x.amount });
    return { ok: true as const };
  });
}

/** Alquileres marcados "Pendiente" o "No pagó" en el Control (de esa libreta) que no están en el fiado. */
function unpaidRentals(e: Engine, b: Book, customerId?: Id) {
  const linked = new Set(entriesOf(e, b).filter((x) => x.assignmentId).map((x) => x.assignmentId));
  return Object.values(e.s.assignments).filter((a) => a.status === "active" && (!customerId || a.customerId === customerId) && b.owns(a.customerId)
    && (!b.creditor || a.customerId !== b.creditor) && ctl(a, b)?.payStatus && ctl(a, b)!.payStatus !== "pagado" && !linked.has(a.id));
}
function rentalPrice(e: Engine, b: Book, a: Assignment): Cents {
  if (b.creditor) return a.rcontrol?.price ?? listPriceMine(e, e.s.customers[b.creditor], a.productId) ?? 0;
  return a.control?.price ?? e.s.products[a.productId]?.price ?? 0;
}

/** Pasa al fiado todos los alquileres sin pagar de un cliente (uno por alquiler, cobra al vencer). */
export function chargeUnpaidRentals(e: Engine, actor: Actor, customerId: Id): { added: number; amount: Cents } {
  const b = bookOf(e, actor);
  return e.tx(() => {
    customerOf(e, b, customerId);
    let added = 0, amount = 0;
    for (const a of unpaidRentals(e, b, customerId)) {
      const price = rentalPrice(e, b, a);
      if (price <= 0) continue;
      const slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
      all(e).push({ id: e.id("fia"), customerId, kind: "cargo", amount: price, at: e.now(), by: actor.id, assignmentId: a.id, dueAt: a.customerExpiresAt,
        ...(b.creditor ? { creditorId: b.creditor } : {}),
        note: `${e.s.products[a.productId]?.name ?? "Servicio"}${slot ? ` · ${slot.label}` : ""}${acc && !b.creditor ? ` · ${acc.email}` : ""}`.slice(0, 120) });
      added++; amount += price;
    }
    if (added) e.audit(actor, "fiado.from_control", "customer", customerId, { added, amount });
    return { added, amount };
  });
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
    return {
      customerId: id, name: c?.name ?? "?", phone: c?.phone ?? "", kind: c?.kind ?? "customer",
      owed, credit, openCharges: open.length, oldestAt: open[0]?.at, nextDue, overdue: !!nextDue && nextDue < now,
      unlinked: { count: pend.length, amount: pend.reduce((t, a) => t + rentalPrice(e, b, a), 0) },
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
