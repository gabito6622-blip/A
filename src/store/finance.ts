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
    return { key: mk(d), label: `${MES[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`, ingresos: 0 as Cents, gastos: 0 as Cents, cuentas: 0 as Cents, ganancia: 0 as Cents };
  });
  const idx = new Map(months.map((m, i) => [m.key, i]));
  for (const o of Object.values(e.s.orders)) {
    if (o.status !== "fulfilled" || o.kind === "topup") continue;
    const i = idx.get(mk(new Date(o.updatedAt)));
    if (i !== undefined) months[i].ingresos += o.total;
  }
  for (const x of (e.s.expenses ?? [])) {
    const i = idx.get(mk(new Date(x.at)));
    if (i !== undefined) { months[i].gastos += x.amount; if (x.accountId) months[i].cuentas += x.amount; }
  }
  for (const m of months) m.ganancia = m.ingresos - m.gastos;
  const curKey = mk(base);
  const curExpenses = (e.s.expenses ?? []).filter((x) => mk(new Date(x.at)) === curKey).sort((a, b) => b.at - a.at);
  return { months, current: months[months.length - 1], expenses: structuredClone(curExpenses) };
}

/** Suma `months` meses calendario a una fecha (mismo día; si no existe, el último del mes). */
function addMonths(t: number, months: number): number {
  const d = new Date(t), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}

/**
 * "Pagué la renovación": anota el pago de una cuenta como gasto (para que Finanzas muestre la
 * ganancia real) y corre su vencimiento con el proveedor los meses pagados, manteniendo el día de cobro.
 */
export function payAccountRenewal(e: Engine, actor: Actor, accountId: Id, input: { amount?: unknown; months?: unknown } = {}) {
  authorize(actor, "inventory.manage");
  const months = input.months === undefined ? 1 : Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new DomainError("VALIDATION", "Meses pagados: de 1 a 12");
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    if (acc.status === "retired") throw new DomainError("INVALID_STATE", "La cuenta está retirada");
    const amount = input.amount === undefined || input.amount === null || input.amount === "" ? acc.cost * months : Math.round(Number(input.amount));
    if (!Number.isInteger(amount) || amount <= 0) throw new DomainError("VALIDATION", "Poné cuánto pagaste (mayor a 0)");
    const prod = e.s.products[acc.productId]?.name ?? acc.productId;
    // Si ya venció hace más de un ciclo, el nuevo período arranca hoy; si no, se mantiene el día de cobro.
    let next = addMonths(acc.supplierExpiresAt, months);
    if (next < e.now()) next = addMonths(e.now(), months);
    const before = acc.supplierExpiresAt;
    acc.supplierExpiresAt = next;
    acc.cost = Math.round(amount / months);
    delete acc.supplierAlertSentFor;
    const exp: Expense = { id: e.id("exp"), amount, note: `Renovación ${prod} · ${acc.email}`.slice(0, 120), at: e.now(), accountId: acc.id };
    (e.s.expenses ??= []).push(exp);
    e.audit(actor, "account.renew_paid", "account", acc.id, { amount, months, from: before, to: next });
    return { expense: structuredClone(exp), supplierExpiresAt: next, cost: acc.cost };
  });
}

/** Anota como gasto lo que pagaste por una cuenta recién cargada (opcional al cargarla). */
export function recordAccountCost(e: Engine, actor: Actor, accountId: Id) {
  authorize(actor, "inventory.manage");
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    if (acc.cost <= 0) return null;
    const prod = e.s.products[acc.productId]?.name ?? acc.productId;
    const exp: Expense = { id: e.id("exp"), amount: acc.cost, note: `Compra ${prod} · ${acc.email}`.slice(0, 120), at: e.now(), accountId: acc.id };
    (e.s.expenses ??= []).push(exp);
    e.audit(actor, "expense.add", "expense", exp.id, { amount: acc.cost, accountId: acc.id });
    return structuredClone(exp);
  });
}

/**
 * Cuánto ganás por cada venta de cada producto: precio de venta menos lo que te cuesta un perfil
 * (o la cuenta completa), según el costo mensual de las cuentas activas de ese producto.
 */
export function productMargins(e: Engine, actor: Actor) {
  authorize(actor, "catalog.manage");
  const minPct = e.s.settings.minMarginPct ?? 15;
  const rev = e.s.priceGroups.revendedor?.prices ?? {};
  const out = [];
  for (const p of Object.values(e.s.products)) {
    if (p.kind === "combo") continue;
    const accs = Object.values(e.s.accounts).filter((a) => a.productId === p.id && a.status === "active");
    const units = accs.map((a) => {
      const slots = Object.values(e.s.slots).filter((s) => s.accountId === a.id && s.status !== "retired").length || 1;
      return a.cost / slots;
    }).filter((c) => c > 0);
    const unitCost = units.length ? Math.round(units.reduce((s, c) => s + c, 0) / units.length) : null;
    // El costo es por mes; el precio es por la duración del producto.
    const periodCost = unitCost === null ? null : Math.round((unitCost * (p.durationDays || 30)) / 30);
    const row = (price: number | undefined) => {
      if (price === undefined || periodCost === null) return null;
      const gain = price - periodCost;
      const pct = price > 0 ? Math.round((gain / price) * 100) : 0;
      return { price, gain, pct, state: gain < 0 ? "loss" : pct < minPct ? "low" : "ok" };
    };
    out.push({ productId: p.id, name: p.name, kind: p.kind, durationDays: p.durationDays, accounts: accs.length, unitCost: periodCost,
      public: p.published ? row(p.price) : null, reseller: row(rev[p.id]) });
  }
  return { minMarginPct: minPct, products: out.sort((a, b) => (a.public?.pct ?? 999) - (b.public?.pct ?? 999)) };
}

export function setMinMargin(e: Engine, actor: Actor, pct: unknown) {
  authorize(actor, "catalog.manage");
  const v = Number(pct);
  if (!Number.isInteger(v) || v < 0 || v > 90) throw new DomainError("VALIDATION", "El margen mínimo va de 0 a 90 %");
  return e.tx(() => {
    e.s.settings.minMarginPct = v;
    e.audit(actor, "settings.min_margin", "settings", "minMarginPct", { pct: v });
    return { minMarginPct: v };
  });
}
