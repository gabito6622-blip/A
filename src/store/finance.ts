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
  const est = accountsEstimate(e);
  const cur = months[months.length - 1];
  const current = { ...cur, cuentasEstimado: est.amount, sinAnotar: est.count, gananciaEstimada: cur.ingresos - cur.gastos - est.amount };
  return { months, current, topApps: topAppsOfMonth(e, curKey), expenses: structuredClone(curExpenses) };
}

/**
 * Costo ESTIMADO de las cuentas de este mes que todavía no anotaste como gasto: cada cuenta viva
 * este mes (activa o en cuarentena, que no venció antes del día 1) cuesta su costo mensual. Si ya
 * anotaste un gasto de esa cuenta este mes ("Ya la pagué" / "Pagué la renovación"), no se cuenta.
 */
export function accountsEstimate(e: Engine): { amount: Cents; count: number } {
  const now = e.now();
  const start = new Date(now); start.setDate(1); start.setHours(0, 0, 0, 0);
  const curKey = mk(start);
  const paid = new Set((e.s.expenses ?? []).filter((x) => x.accountId && mk(new Date(x.at)) === curKey).map((x) => x.accountId));
  let amount = 0, count = 0;
  for (const a of Object.values(e.s.accounts)) {
    if (a.status === "retired" || !(a.cost > 0) || a.supplierExpiresAt < start.getTime() || a.createdAt > now || paid.has(a.id)) continue;
    amount += a.cost; count++;
  }
  return { amount, count };
}

/**
 * Las apps que más te dejaron este mes: lo que entró por cada una menos lo que te cuestan
 * esos perfiles (estimado con el costo de las cuentas). Un combo suma el costo de sus apps.
 */
function topAppsOfMonth(e: Engine, curKey: string) {
  const unit: Record<Id, number> = {};
  for (const m of marginsData(e).products) if (m.unitCost !== null) unit[m.productId] = m.unitCost;
  const costOf = (pid: Id): number => {
    const p = e.s.products[pid];
    if (p?.kind === "combo") return (p.comboProductIds ?? []).reduce((t, id) => t + (unit[id] ?? 0), 0);
    return unit[pid] ?? 0;
  };
  const by: Record<Id, { productId: Id; name: string; ingresos: number; units: number; costo: number; gana: number }> = {};
  for (const o of Object.values(e.s.orders)) {
    if (o.status !== "fulfilled" || o.kind === "topup" || o.trial || mk(new Date(o.updatedAt)) !== curKey) continue;
    const sub = o.items.reduce((t, it) => t + it.qty * it.unitPrice, 0) || 1;
    for (const it of o.items) {
      const b = (by[it.productId] ??= { productId: it.productId, name: e.s.products[it.productId]?.name ?? it.productId, ingresos: 0, units: 0, costo: 0, gana: 0 });
      const rev = Math.round((o.total * it.qty * it.unitPrice) / sub); // reparte cupones/descuentos
      b.ingresos += rev; b.units += it.qty; b.costo += costOf(it.productId) * it.qty;
    }
  }
  return Object.values(by).map((b) => ({ ...b, gana: b.ingresos - b.costo })).sort((a, b) => b.gana - a.gana).slice(0, 3);
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
  return marginsData(e);
}

/** Igual que productMargins() pero sin permisos (lo usan los avisos del dueño). */
export function marginsData(e: Engine) {
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
