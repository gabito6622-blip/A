// Gastos del dueño como los anota un humano (15/11/2026, equipo 1 «la plata coincide»):
//  - con FECHA (hoy por defecto; se puede elegir otro día): el gasto cae en el mes de su fecha, no en el de cuando lo anotaste;
//  - en Bs, US$ o USDT con la tasa (se guardan los dólares y la tasa; el monto en Bs sale de ahí);
//  - con categoría (cuenta, perfil suelto, publicidad, internet, comisión, otro) y proveedor opcional;
//  - se pueden EDITAR (también los de meses anteriores), no solo quitar;
//  - «Me devolvió plata» (devolución de un proveedor): un gasto con `refund`, que RESTA de los gastos del mes;
//  - gastos fijos mensuales: se definen una vez y cada mes quedan «pendientes» hasta que los anotás («Lo pagué»);
//  - un pago por VARIOS meses (`months`, `coversUntil`) cubre esos meses: el costo de esa cuenta no se vuelve a estimar.
// Toda la plata en centavos. Los montos en dólares van en centavos de dólar.
import type { Actor, Cents, Expense, ExpenseCategory, FixedExpense, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY, boMonthKey, boParts } from "./time.js";
import { rateNow, usdToBs } from "./usd.js";

export const CATEGORIES: ExpenseCategory[] = ["cuenta", "perfil", "publicidad", "internet", "comision", "otro"];
export const CATEGORY_LABEL: Record<ExpenseCategory, string> = { cuenta: "Cuenta", perfil: "Perfil suelto", publicidad: "Publicidad", internet: "Internet", comision: "Comisión", otro: "Otro" };
const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];

/** Lo que un gasto suma a «Salió»: una devolución del proveedor resta. */
export const signedAmount = (x: Pick<Expense, "amount" | "refund">): Cents => (x.refund ? -x.amount : x.amount);
/** Gastos (netos de devoluciones) de un mes «AAAA-MM». */
export const expensesOfMonth = (e: Engine, key: string): Expense[] => (e.s.expenses ?? []).filter((x) => boMonthKey(x.at) === key);
export const netOf = (list: Expense[]): Cents => list.reduce((t, x) => t + signedAmount(x), 0);

/** «AAAA-MM» + n meses. */
export function addMonthKey(key: string, n: number): string {
  const [y, m] = key.split("-").map(Number);
  const t = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${t.getUTCFullYear()}-${String(t.getUTCMonth() + 1).padStart(2, "0")}`;
}
export const monthLabel = (key: string) => `${MES[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;

/** ¿Este gasto paga esa cuenta en ese mes? El mes del gasto y, si pagó varios meses, los siguientes que cubre. */
export function coversMonth(x: Expense, key: string): boolean {
  if (!x.accountId || x.refund) return false;
  const k0 = boMonthKey(x.at);
  if (key === k0) return true;
  return key > k0 && key < addMonthKey(k0, Math.max(1, x.months ?? 1));
}

/** La tasa que se sugiere al anotar en dólares: la última que anotaste en un gasto, si no la de la tienda. */
export function suggestedRate(e: Engine): number {
  const last = (e.s.expenses ?? []).filter((x) => x.rate).sort((a, b) => b.at - a.at)[0];
  return last?.rate ?? rateNow(e) ?? 0;
}

/** Fecha del gasto: hoy (ahora) por defecto; un día «AAAA-MM-DD» va a las 12:00 de Bolivia. Nunca en el futuro. */
export function parseWhen(e: Engine, at: unknown, date?: unknown): number {
  const now = e.now();
  let t: number | undefined;
  const d = date ?? (typeof at === "string" ? at : undefined);
  if (typeof d === "string" && d) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(d);
    if (!m) throw new DomainError("VALIDATION", "Fecha inválida (dd/mm/aaaa)");
    const p = boParts(now);
    const today = `${p.y}-${String(p.m + 1).padStart(2, "0")}-${String(p.d).padStart(2, "0")}`;
    t = d === today ? now : Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 16);
  } else if (at !== undefined && at !== null && at !== "") {
    t = Number(at);
  }
  if (t === undefined) return now;
  if (!Number.isFinite(t) || t < Date.UTC(2015, 0, 1)) throw new DomainError("VALIDATION", "Fecha inválida");
  if (t > now + DAY) throw new DomainError("VALIDATION", "La fecha del gasto no puede ser en el futuro");
  return Math.min(t, now);
}

interface MoneyIn { amount?: unknown; currency?: unknown; rate?: unknown; usd?: unknown }
/** Monto en Bs (y, si fue en dólares, los dólares y la tasa). `amount` va en centavos de la moneda elegida. */
function moneyOf(e: Engine, input: MoneyIn): Pick<Expense, "amount" | "usd" | "rate" | "currency"> {
  const cur = input.currency === undefined || input.currency === null || input.currency === "" ? "BOB" : String(input.currency).toUpperCase();
  if (cur !== "BOB" && cur !== "USD" && cur !== "USDT") throw new DomainError("VALIDATION", "Moneda: Bs, US$ o USDT");
  if (cur === "BOB") {
    const amt = Math.round(Number(input.amount));
    if (!Number.isInteger(amt) || amt <= 0 || amt > 100_000_000) throw new DomainError("VALIDATION", "El monto tiene que ser mayor a 0");
    return { amount: amt };
  }
  const usd = Math.round(Number(input.usd ?? input.amount));
  if (!Number.isInteger(usd) || usd <= 0 || usd > 10_000_000) throw new DomainError("VALIDATION", "Los dólares tienen que ser mayores a 0");
  const rate = input.rate === undefined || input.rate === null || input.rate === "" ? suggestedRate(e) : Number(input.rate);
  if (!(Number.isFinite(rate) && rate >= 1 && rate <= 100)) throw new DomainError("VALIDATION", "Tasa inválida (Bs por dólar, de 1 a 100)");
  const r = Math.round(rate * 10_000) / 10_000;
  return { amount: usdToBs(usd, r), usd, rate: r, currency: cur };
}

function categoryOf(v: unknown, fallback: ExpenseCategory = "otro"): ExpenseCategory {
  if (v === undefined || v === null || v === "") return fallback;
  if (!CATEGORIES.includes(v as ExpenseCategory)) throw new DomainError("VALIDATION", "Categoría inválida");
  return v as ExpenseCategory;
}
function noteOf(v: unknown, fallback?: string): string {
  const t = String(v ?? "").trim() || fallback || "";
  if (!t || t.length > 120) throw new DomainError("VALIDATION", "La nota del gasto va de 1 a 120 letras");
  return t;
}
function supplierOf(e: Engine, v: unknown): Id | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const id = String(v);
  if (!e.s.suppliers[id]) throw new DomainError("NOT_FOUND", "Proveedor no encontrado");
  return id;
}
function accountOf(e: Engine, v: unknown): Id | undefined {
  if (v === undefined || v === null || v === "") return undefined;
  const id = String(v);
  if (!e.s.accounts[id]) throw new DomainError("NOT_FOUND", "Cuenta no encontrada");
  return id;
}

export interface ExpenseInput extends MoneyIn { note?: unknown; category?: unknown; supplierId?: unknown; accountId?: unknown; at?: unknown; date?: unknown; fixedId?: unknown }

/** Anota un gasto con fecha, moneda, categoría y proveedor (todo opcional menos el monto y la nota). */
export function addExpenseFull(e: Engine, actor: Actor, input: ExpenseInput): Expense {
  authorize(actor, "catalog.manage");
  const money = moneyOf(e, input);
  const note = noteOf(input.note);
  const at = parseWhen(e, input.at, input.date);
  return e.tx(() => {
    const accountId = accountOf(e, input.accountId);
    const supplierId = supplierOf(e, input.supplierId) ?? (accountId ? e.s.accounts[accountId].supplierId : undefined);
    const fixedId = input.fixedId ? String(input.fixedId) : undefined;
    if (fixedId && !(e.s.fixedExpenses ?? []).some((f) => f.id === fixedId)) throw new DomainError("NOT_FOUND", "Gasto fijo no encontrado");
    const exp: Expense = { id: e.id("exp"), ...money, note, at, category: categoryOf(input.category, accountId ? "cuenta" : "otro"),
      ...(supplierId ? { supplierId } : {}), ...(accountId ? { accountId } : {}), ...(fixedId ? { fixedId } : {}) };
    (e.s.expenses ??= []).push(exp);
    e.audit(actor, "expense.add", "expense", exp.id, { amount: exp.amount, at, ...(money.usd ? { usd: money.usd, rate: money.rate } : {}), category: exp.category });
    return structuredClone(exp);
  });
}

/**
 * «Me devolvió plata»: un proveedor te devuelve plata (se cayó un perfil, te cobró de más). Resta de los gastos del mes
 * de su fecha y se ve en verde en la lista de gastos y en el Excel. FIRMA FIJA: la usa también otro equipo.
 */
export function addRefund(e: Engine, actor: Actor, input: { amount: unknown; currency?: unknown; rate?: unknown; supplierId?: unknown; accountId?: unknown; note?: unknown; at?: unknown }): Expense {
  authorize(actor, "catalog.manage");
  const money = moneyOf(e, input);
  const at = parseWhen(e, input.at);
  return e.tx(() => {
    const accountId = accountOf(e, input.accountId);
    const supplierId = supplierOf(e, input.supplierId) ?? (accountId ? e.s.accounts[accountId].supplierId : undefined);
    const who = supplierId ? e.s.suppliers[supplierId]?.name : undefined;
    const note = noteOf(input.note, `Devolución${who ? ` de ${who}` : " del proveedor"}`);
    const exp: Expense = { id: e.id("exp"), ...money, note, at, refund: true, category: accountId ? "cuenta" : "otro",
      ...(supplierId ? { supplierId } : {}), ...(accountId ? { accountId } : {}) };
    (e.s.expenses ??= []).push(exp);
    e.audit(actor, "expense.refund", "expense", exp.id, { amount: exp.amount, at, ...(supplierId ? { supplierId } : {}), ...(accountId ? { accountId } : {}), ...(money.usd ? { usd: money.usd, rate: money.rate } : {}) });
    return structuredClone(exp);
  });
}

/** Corregir un gasto (también de meses anteriores): monto, moneda y tasa, nota, categoría, proveedor o fecha. */
export function updateExpense(e: Engine, actor: Actor, id: Id, patch: ExpenseInput): Expense {
  authorize(actor, "catalog.manage");
  return e.tx(() => {
    const x = (e.s.expenses ?? []).find((g) => g.id === id);
    if (!x) throw new DomainError("NOT_FOUND", "Gasto no encontrado");
    const before = { amount: x.amount, at: x.at, note: x.note };
    if (patch.amount !== undefined || patch.usd !== undefined || patch.currency !== undefined || patch.rate !== undefined) {
      const cur = patch.currency ?? x.currency ?? "BOB";
      const m = moneyOf(e, { currency: cur, amount: patch.amount ?? (cur === "BOB" ? x.amount : x.usd), usd: patch.usd, rate: patch.rate ?? (cur === "BOB" ? undefined : x.rate) });
      x.amount = m.amount;
      if (m.usd !== undefined) { x.usd = m.usd; x.rate = m.rate; x.currency = m.currency; } else { delete x.usd; delete x.rate; delete x.currency; }
    }
    if (patch.note !== undefined) x.note = noteOf(patch.note);
    if (patch.category !== undefined) x.category = categoryOf(patch.category);
    if (patch.supplierId !== undefined) { const s = supplierOf(e, patch.supplierId); if (s) x.supplierId = s; else delete x.supplierId; }
    if (patch.at !== undefined || patch.date !== undefined) x.at = parseWhen(e, patch.at, patch.date);
    x.editedAt = e.now();
    e.audit(actor, "expense.edit", "expense", x.id, { from: before.amount, to: x.amount, ...(before.at !== x.at ? { atFrom: before.at, at: x.at } : {}) });
    return structuredClone(x);
  });
}

/* ---------------- Gastos fijos mensuales ---------------- */

const fixedList = (e: Engine) => (e.s.fixedExpenses ??= []);

export function listFixed(e: Engine, actor: Actor): FixedExpense[] {
  authorize(actor, "catalog.manage");
  return structuredClone(e.s.fixedExpenses ?? []);
}

/** Crear o cambiar un gasto fijo (con `id` lo cambia). */
export function upsertFixed(e: Engine, actor: Actor, input: { id?: unknown; name?: unknown; amount?: unknown; category?: unknown; supplierId?: unknown; active?: unknown }): FixedExpense {
  authorize(actor, "catalog.manage");
  const name = String(input.name ?? "").trim();
  if (!name || name.length > 60) throw new DomainError("VALIDATION", "Nombre del gasto fijo: de 1 a 60 letras");
  const amount = Math.round(Number(input.amount));
  if (!Number.isInteger(amount) || amount <= 0 || amount > 100_000_000) throw new DomainError("VALIDATION", "El monto tiene que ser mayor a 0");
  const category = categoryOf(input.category);
  return e.tx(() => {
    const supplierId = supplierOf(e, input.supplierId);
    const list = fixedList(e);
    const cur = input.id ? list.find((f) => f.id === String(input.id)) : undefined;
    if (input.id && !cur) throw new DomainError("NOT_FOUND", "Gasto fijo no encontrado");
    const f: FixedExpense = cur ?? { id: e.id("fix"), name, amount, category, active: true, createdAt: e.now() };
    Object.assign(f, { name, amount, category, active: input.active === undefined ? f.active : input.active !== false });
    if (supplierId) f.supplierId = supplierId; else delete f.supplierId;
    if (!cur) list.push(f);
    e.audit(actor, cur ? "expense.fixed_edit" : "expense.fixed_add", "expense", f.id, { name, amount, category });
    return structuredClone(f);
  });
}

export function removeFixed(e: Engine, actor: Actor, id: Id): { ok: true } {
  authorize(actor, "catalog.manage");
  return e.tx(() => {
    const list = fixedList(e), i = list.findIndex((f) => f.id === id);
    if (i === -1) throw new DomainError("NOT_FOUND", "Gasto fijo no encontrado");
    list.splice(i, 1);
    e.audit(actor, "expense.fixed_remove", "expense", id, {});
    return { ok: true as const };
  });
}

/** ¿Ese gasto fijo ya está anotado en el mes? (uno con su `fixedId`, o uno suelto de su misma categoría). */
function fixedPaidIn(list: Expense[], f: FixedExpense): boolean {
  return list.some((x) => !x.refund && (x.fixedId === f.id || (!x.fixedId && !x.accountId && f.category !== "otro" && f.category !== "cuenta" && x.category === f.category)));
}

/** Gastos fijos que faltan anotar en un mes (desde el mes en que los creaste). */
export function pendingFixed(e: Engine, key: string): { fixedId: Id; name: string; amount: Cents; category: ExpenseCategory }[] {
  const list = expensesOfMonth(e, key);
  return (e.s.fixedExpenses ?? []).filter((f) => f.active && boMonthKey(f.createdAt) <= key && !fixedPaidIn(list, f))
    .map((f) => ({ fixedId: f.id, name: f.name, amount: f.amount, category: f.category }));
}

/** «Lo pagué»: anota el gasto fijo en ese mes (hoy si es el mes en curso; si no, el último día de ese mes). */
export function payFixed(e: Engine, actor: Actor, fixedId: Id, input: { amount?: unknown; month?: unknown; date?: unknown } = {}): Expense {
  authorize(actor, "catalog.manage");
  const f = (e.s.fixedExpenses ?? []).find((x) => x.id === fixedId);
  if (!f) throw new DomainError("NOT_FOUND", "Gasto fijo no encontrado");
  const cur = boMonthKey(e.now());
  const month = typeof input.month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(input.month) ? input.month : cur;
  if (month > cur) throw new DomainError("VALIDATION", "Ese mes todavía no llegó");
  if (pendingFixed(e, month).every((p) => p.fixedId !== f.id)) throw new DomainError("VALIDATION", `«${f.name}» ya está anotado en ${monthLabel(month)}`);
  const [y, m] = month.split("-").map(Number);
  const date = input.date ?? (month === cur ? undefined : new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10));
  return addExpenseFull(e, actor, { amount: input.amount ?? f.amount, note: f.name, category: f.category, supplierId: f.supplierId, fixedId: f.id, date });
}

/** Lista de gastos de un mes (para ver y editar meses anteriores), con lo devuelto y los fijos que faltan. */
export function monthExpenses(e: Engine, actor: Actor, month?: unknown) {
  authorize(actor, "catalog.manage");
  const now = e.now(), cur = boMonthKey(now);
  let key = typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : cur;
  if (key > cur) key = cur;
  const list = expensesOfMonth(e, key).sort((a, b) => b.at - a.at);
  const sup = (id?: Id) => (id ? e.s.suppliers[id]?.name ?? "" : "");
  return {
    month: key, label: monthLabel(key), current: key === cur,
    months: Array.from({ length: 12 }, (_, i) => { const k = addMonthKey(cur, -i); return { key: k, label: monthLabel(k) }; }),
    gastado: list.filter((x) => !x.refund).reduce((t, x) => t + x.amount, 0),
    devuelto: list.filter((x) => x.refund).reduce((t, x) => t + x.amount, 0),
    neto: netOf(list),
    expenses: list.map((x) => ({ ...structuredClone(x), supplierName: sup(x.supplierId ?? (x.accountId ? e.s.accounts[x.accountId]?.supplierId : undefined)), categoryLabel: CATEGORY_LABEL[x.category ?? (x.accountId ? "cuenta" : "otro")] })),
    pendientesFijos: pendingFixed(e, key),
    fixed: structuredClone(e.s.fixedExpenses ?? []),
    suppliers: Object.values(e.s.suppliers).map((s) => ({ id: s.id, name: s.name })),
    rate: suggestedRate(e),
    categories: CATEGORIES.map((c) => ({ id: c, label: CATEGORY_LABEL[c] })),
  };
}
