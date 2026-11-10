// Finanzas del dueño: lo que entró (ventas y renovaciones), lo que salió (gastos
// manuales) y lo que quedó (ganancia), mes por mes.
import type { Actor, Cents, Expense, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const mk = (d: Date) => `${d.getFullYear()}-${d.getMonth()}`;

export function addExpense(e: Engine, actor: Actor, amount: unknown, note: unknown): Expense {
  authorize(actor, "catalog.manage");
  const amt = Math.round(Number(amount));
  if (!Number.isInteger(amt) || amt <= 0) throw new DomainError("VALIDATION", "El monto del gasto tiene que ser mayor a 0");
  const text = String(note ?? "").trim();
  if (!text || text.length > 120) throw new DomainError("VALIDATION", "La nota del gasto va de 1 a 120 letras");
  return e.tx(() => {
    const exp: Expense = { id: e.id("exp"), amount: amt, note: text, at: e.now() };
    (e.s.expenses ??= []).push(exp);
    e.audit(actor, "expense.add", "expense", exp.id, { amount: amt });
    return structuredClone(exp);
  });
}

export function removeExpense(e: Engine, actor: Actor, id: Id): { ok: true } {
  authorize(actor, "catalog.manage");
  return e.tx(() => {
    const list = (e.s.expenses ??= []);
    const i = list.findIndex((x) => x.id === id);
    if (i === -1) throw new DomainError("NOT_FOUND", "Gasto no encontrado");
    list.splice(i, 1);
    e.audit(actor, "expense.remove", "expense", id, {});
    return { ok: true } as const;
  });
}

/** Resumen de los últimos `n` meses: ingresos, gastos y ganancia; + gastos del mes actual. */
export function report(e: Engine, actor: Actor, n = 6) {
  authorize(actor, "catalog.manage");
  const now = e.now();
  const base = new Date(now); base.setDate(1); base.setHours(0, 0, 0, 0);
  const months = Array.from({ length: n }, (_, i) => {
    const d = new Date(base.getFullYear(), base.getMonth() - (n - 1 - i), 1);
    return { key: mk(d), label: `${MES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, ingresos: 0 as Cents, gastos: 0 as Cents, ganancia: 0 as Cents };
  });
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const o of Object.values(e.s.orders)) {
    if (o.status !== "fulfilled" || o.kind === "topup") continue;
    const i = idx.get(mk(new Date(o.updatedAt)));
    if (i !== undefined) months[i].ingresos += o.total;
  }
  for (const x of (e.s.expenses ?? [])) {
    const i = idx.get(mk(new Date(x.at)));
    if (i !== undefined) months[i].gastos += x.amount;
  }
  for (const m of months) m.ganancia = m.ingresos - m.gastos;
  const curKey = mk(base);
  const curExpenses = (e.s.expenses ?? []).filter((x) => mk(new Date(x.at)) === curKey).sort((a, b) => b.at - a.at);
  return { months, current: months[months.length - 1], expenses: structuredClone(curExpenses) };
}
