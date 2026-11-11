// Saldo de clientes como libro contable: nunca se guarda un "saldo" editable,
// se calcula sumando movimientos, y ningún movimiento puede dejarlo negativo.
import type { Actor, Cents, Id, LedgerEntry, LedgerType } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { isUsd } from "./usd.js";

export function balance(e: Engine, customerId: Id): Cents {
  return e.s.ledger.reduce((s, l) => (l.customerId === customerId ? s + l.amount : s), 0);
}

/** Registra un movimiento. Debe correr dentro de `tx`. */
export function post(e: Engine, by: Actor, customerId: Id, amount: Cents, type: LedgerType, ref: Id, note?: string): LedgerEntry {
  if (!Number.isInteger(amount) || amount === 0) throw new DomainError("VALIDATION", "Monto inválido");
  e.get("customers", customerId);
  if (balance(e, customerId) + amount < 0) throw new DomainError("INSUFFICIENT_BALANCE", "Saldo insuficiente");
  // Saldo en dólares (lista USD): el movimiento queda marcado; el monto va en centavos de dólar.
  const usd = isUsd(e, customerId);
  const entry: LedgerEntry = { id: e.id("led"), customerId, amount, ...(usd ? { cur: "USD" as const } : {}), type, ref, note, by: by.id, at: e.now() };
  e.s.ledger.push(entry);
  e.audit(by, `ledger.${type}`, "customer", customerId, { amount, ref, ...(usd ? { currency: "USD" } : {}) });
  return entry;
}

/** Ajuste manual: solo el dueño, con motivo obligatorio. A un cliente en dólares, el monto va en centavos de dólar. */
export function adjust(e: Engine, actor: Actor, customerId: Id, amount: Cents, reason: string): LedgerEntry {
  authorize(actor, "wallet.adjust");
  if (!reason?.trim()) throw new DomainError("VALIDATION", "Un ajuste necesita motivo");
  return e.tx(() => post(e, actor, customerId, amount, "adjustment", "manual", reason));
}

export function history(e: Engine, actor: Actor, customerId: Id) {
  const own = actor.customerId === customerId || (actor.role === "reseller" && e.s.customers[customerId]?.resellerId === actor.customerId);
  if (!own && !isStaff(actor)) throw new DomainError("FORBIDDEN", "No podés ver el saldo de otro cliente");
  let run = 0;
  return e.s.ledger
    .filter((l) => l.customerId === customerId)
    .map((l) => ({ ...l, label: labelOf(e, l), balanceAfter: (run += l.amount) }));
}

/** Qué fue cada movimiento, en palabras: "Netflix para Rodrigo" en vez de "ord_01182". */
function labelOf(e: Engine, l: { ref: Id; note?: string; customerId: Id }): string {
  const o = e.s.orders[l.ref];
  if (o) {
    const what = o.items.map((it) => `${it.qty > 1 ? `${it.qty} × ` : ""}${e.s.products[it.productId]?.name ?? "servicio"}`).join(" + ");
    const who = o.customerId !== l.customerId ? e.s.customers[o.customerId]?.name : "";
    return `${what}${who ? ` para ${who}` : ""}`;
  }
  return l.note ?? "";
}
