// Fiado: lo que te debe cada cliente o revendedor, como la columna "debe" del Excel.
//
// Es una libreta por cliente: "le fié" (cargo, con fecha de cobro opcional) y "me pagó" (pago,
// puede ser parcial). Lo que debe = cargos − pagos. Los cargos se pagan en orden (el más viejo
// primero): cuando un cargo que vino de un alquiler del Control queda cubierto, ese alquiler
// pasa solo a "Pagado". No toca el saldo de la tienda (esto es plata que te deben a vos).
import type { Actor, Cents, FiadoEntry, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";

const DAY = 86_400_000;
const list = (e: Engine) => (e.s.fiado ??= []);

function amountOf(v: unknown): Cents {
  const n = Math.round(Number(v));
  if (!Number.isInteger(n) || n <= 0 || n > 10_000_000) throw new DomainError("VALIDATION", "El monto tiene que ser mayor a 0");
  return n;
}
const noteOf = (v: unknown) => {
  const t = String(v ?? "").trim();
  if (t.length > 120) throw new DomainError("VALIDATION", "La nota va hasta 120 letras");
  return t;
};

/** Cargos de un cliente con lo que ya se cubrió de cada uno (los pagos van al más viejo primero). */
function settle(e: Engine, customerId: Id) {
  const mine = list(e).filter((x) => x.customerId === customerId);
  let pool = mine.filter((x) => x.kind === "pago").reduce((t, x) => t + x.amount, 0);
  const charges = mine.filter((x) => x.kind === "cargo").sort((a, b) => a.at - b.at).map((c) => {
    const covered = Math.min(c.amount, pool);
    pool -= covered;
    return { ...c, covered };
  });
  const owed = charges.reduce((t, c) => t + c.amount - c.covered, 0);
  return { mine, charges, owed, credit: pool };
}

/** Cuando un cargo de alquiler queda cubierto, el alquiler pasa a "Pagado" en el Control. */
function syncControl(e: Engine, customerId: Id) {
  for (const c of settle(e, customerId).charges) {
    if (!c.assignmentId) continue;
    const a = e.s.assignments[c.assignmentId];
    if (!a) continue;
    const cur = a.control?.payStatus ?? "pagado";
    const want = c.covered >= c.amount ? "pagado" : cur === "no_pago" ? "no_pago" : "pendiente";
    if (cur !== want) a.control = { ...(a.control ?? {}), payStatus: want };
  }
}

export function addCharge(e: Engine, actor: Actor, input: { customerId: Id; amount: unknown; note?: unknown; dueAt?: unknown; assignmentId?: Id }): FiadoEntry {
  authorize(actor, "payment.review");
  const amount = amountOf(input.amount), note = noteOf(input.note);
  const dueAt = input.dueAt === undefined || input.dueAt === null || input.dueAt === "" ? undefined : Number(input.dueAt);
  if (dueAt !== undefined && !Number.isFinite(dueAt)) throw new DomainError("VALIDATION", "Fecha de cobro inválida");
  return e.tx(() => {
    e.get("customers", input.customerId);
    if (input.assignmentId) {
      const a = e.get("assignments", input.assignmentId);
      if (a.customerId !== input.customerId) throw new DomainError("VALIDATION", "Ese alquiler es de otro cliente");
      if (list(e).some((x) => x.kind === "cargo" && x.assignmentId === input.assignmentId)) throw new DomainError("VALIDATION", "Ese alquiler ya está en el fiado");
    }
    const entry: FiadoEntry = { id: e.id("fia"), customerId: input.customerId, kind: "cargo", amount, note, at: e.now(), by: actor.id,
      ...(dueAt !== undefined ? { dueAt } : {}), ...(input.assignmentId ? { assignmentId: input.assignmentId } : {}) };
    list(e).push(entry);
    syncControl(e, input.customerId);
    e.audit(actor, "fiado.charge", "customer", input.customerId, { amount, entry: entry.id });
    return structuredClone(entry);
  });
}

export function addPayment(e: Engine, actor: Actor, input: { customerId: Id; amount: unknown; note?: unknown }): { entry: FiadoEntry; owed: Cents } {
  authorize(actor, "payment.review");
  const amount = amountOf(input.amount), note = noteOf(input.note);
  return e.tx(() => {
    e.get("customers", input.customerId);
    const entry: FiadoEntry = { id: e.id("fia"), customerId: input.customerId, kind: "pago", amount, note, at: e.now(), by: actor.id };
    list(e).push(entry);
    syncControl(e, input.customerId);
    e.audit(actor, "fiado.payment", "customer", input.customerId, { amount, entry: entry.id });
    return { entry: structuredClone(entry), owed: settle(e, input.customerId).owed };
  });
}

/** Borrar un movimiento cargado por error. */
export function removeEntry(e: Engine, actor: Actor, entryId: Id): { ok: true } {
  authorize(actor, "payment.review");
  return e.tx(() => {
    const l = list(e), i = l.findIndex((x) => x.id === entryId);
    if (i === -1) throw new DomainError("NOT_FOUND", "Movimiento no encontrado");
    const [x] = l.splice(i, 1);
    if (x.kind === "cargo" && x.assignmentId) {
      const a = e.s.assignments[x.assignmentId];
      if (a?.control?.payStatus === "pendiente") a.control = { ...a.control, payStatus: "pagado" };
    }
    syncControl(e, x.customerId);
    e.audit(actor, "fiado.remove", "customer", x.customerId, { kind: x.kind, amount: x.amount });
    return { ok: true as const };
  });
}

/** Alquileres del Control marcados "Pendiente" o "No pagó" que todavía no están en el fiado. */
function unpaidRentals(e: Engine, customerId?: Id) {
  const linked = new Set(list(e).filter((x) => x.assignmentId).map((x) => x.assignmentId));
  return Object.values(e.s.assignments).filter((a) => a.status === "active" && (!customerId || a.customerId === customerId)
    && a.control?.payStatus && a.control.payStatus !== "pagado" && !linked.has(a.id));
}
const rentalPrice = (e: Engine, a: { productId: Id; control?: { price?: Cents } }) => a.control?.price ?? e.s.products[a.productId]?.price ?? 0;

/** Pasa al fiado todos los alquileres sin pagar de un cliente (uno por alquiler, cobra al vencer). */
export function chargeUnpaidRentals(e: Engine, actor: Actor, customerId: Id): { added: number; amount: Cents } {
  authorize(actor, "payment.review");
  return e.tx(() => {
    e.get("customers", customerId);
    let added = 0, amount = 0;
    for (const a of unpaidRentals(e, customerId)) {
      const price = rentalPrice(e, a);
      if (price <= 0) continue;
      const slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
      list(e).push({ id: e.id("fia"), customerId, kind: "cargo", amount: price, at: e.now(), by: actor.id, assignmentId: a.id, dueAt: a.customerExpiresAt,
        note: `${e.s.products[a.productId]?.name ?? "Servicio"}${slot ? ` · ${slot.label}` : ""}${acc ? ` · ${acc.email}` : ""}`.slice(0, 120) });
      added++; amount += price;
    }
    if (added) e.audit(actor, "fiado.from_control", "customer", customerId, { added, amount });
    return { added, amount };
  });
}

/** Resumen para la pantalla Fiado: quién debe, cuánto, desde cuándo y cuándo se cobra. */
export function overview(e: Engine, actor: Actor) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo staff");
  const now = e.now();
  const ids = new Set([...list(e).map((x) => x.customerId), ...unpaidRentals(e).map((a) => a.customerId)]);
  const rows = [...ids].map((id) => {
    const c = e.s.customers[id];
    const { charges, owed, credit } = settle(e, id);
    const open = charges.filter((x) => x.covered < x.amount);
    const nextDue = open.map((x) => x.dueAt).filter((x): x is number => !!x).sort((a, b) => a - b)[0];
    const pend = unpaidRentals(e, id);
    return {
      customerId: id, name: c?.name ?? "?", phone: c?.phone ?? "", kind: c?.kind ?? "customer",
      owed, credit, openCharges: open.length, oldestAt: open[0]?.at, nextDue, overdue: !!nextDue && nextDue < now,
      unlinked: { count: pend.length, amount: pend.reduce((t, a) => t + rentalPrice(e, a), 0) },
    };
  }).filter((r) => r.owed > 0 || r.unlinked.count || r.credit > 0)
    .sort((a, b) => Number(b.overdue) - Number(a.overdue) || b.owed - a.owed);
  return {
    rows,
    totals: { owed: rows.reduce((t, r) => t + r.owed, 0), people: rows.filter((r) => r.owed > 0).length, overdue: rows.filter((r) => r.overdue).length,
      unlinked: rows.reduce((t, r) => t + r.unlinked.amount, 0), dueWeek: rows.filter((r) => r.nextDue && r.nextDue - now <= 7 * DAY).length },
  };
}

/** Movimientos de un cliente (para ver el detalle y mandarle el resumen). */
export function history(e: Engine, actor: Actor, customerId: Id) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo staff");
  e.get("customers", customerId);
  const { mine, charges, owed, credit } = settle(e, customerId);
  const cov = new Map(charges.map((c) => [c.id, c.covered]));
  return { owed, credit, entries: mine.slice().sort((a, b) => b.at - a.at).map((x) => ({ ...structuredClone(x), covered: cov.get(x.id) })) };
}

/** Lo que debe un cliente (para mostrarlo en otras pantallas). */
export function owedBy(e: Engine, customerId: Id): Cents {
  return settle(e, customerId).owed;
}
