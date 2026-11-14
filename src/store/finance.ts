// Finanzas del dueño: lo que entró (ventas y renovaciones), lo que salió (gastos
// manuales) y lo que quedó (ganancia), mes por mes.
import type { Account, Actor, Cents, Expense, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY, boMonthKey, boMonthStart, boParts } from "./time.js";
import { incomeEvents, type IncomeEvent } from "./income.js";
import { accountCostBs, accountsEstimateMonth } from "./finanzasCostos.js";
export { accountCostBs } from "./finanzasCostos.js";

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** Mes con nombre completo para los títulos («noviembre 2026»): «nov 26» se leía como el día 26. */
const MES_LARGO = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
/** Mes calendario de Bolivia ("AAAA-MM"), no el de la zona horaria del servidor. */
const mk = boMonthKey;

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
  const months = Array.from({ length: n }, (_, i) => {
    const start = boMonthStart(now, -(n - 1 - i)), p = boParts(start);
    return { key: mk(start), label: `${MES[p.m]} ${String(p.y).slice(2)}`, longLabel: `${MES_LARGO[p.m]} ${p.y}`, ingresos: 0 as Cents, gastos: 0 as Cents, cuentas: 0 as Cents, ganancia: 0 as Cents, delControl: 0 as Cents, delFiado: 0 as Cents };
  });
  const idx = new Map(months.map((m, i) => [m.key, i]));
  // Fuente única de ingresos (pedidos entregados + cobros marcados en el Control): la misma que Inicio y Cómo van.
  const events = incomeEvents(e, now);
  for (const x of events) {
    const i = idx.get(mk(x.at));
    if (i !== undefined) { months[i].ingresos += x.amount; if (x.source === "control") months[i].delControl += x.amount; if (x.source === "fiado") months[i].delFiado += x.amount; }
  }
  for (const x of (e.s.expenses ?? [])) {
    const i = idx.get(mk(x.at));
    if (i !== undefined) { months[i].gastos += x.amount; if (x.accountId) months[i].cuentas += x.amount; }
  }
  // Cada mes resta el costo estimado de sus cuentas (finanzasCostos.ts): los meses cerrados ya no salen con 100 % de ganancia.
  const meses = months.map((m) => {
    const est = accountsEstimateMonth(e, m.key, now);
    m.ganancia = m.ingresos - m.gastos;
    return { ...m, cuentasEstimado: est.amount, sinAnotar: est.count, sinCostos: est.sinCostos, gananciaEstimada: m.ganancia - est.amount };
  });
  const curKey = mk(now);
  const curExpenses = (e.s.expenses ?? []).filter((x) => mk(x.at) === curKey).sort((a, b) => b.at - a.at);
  const current = meses[meses.length - 1];
  return { months: meses, current, topApps: topAppsOfMonth(e, events.filter((x) => mk(x.at) === curKey)), expenses: structuredClone(curExpenses) };
}

/**
 * Cierre de un mes (Premium 2.0, etapa 9): todo lo del mes elegido con la MISMA fuente de ingresos que Inicio
 * y Finanzas (pedidos entregados + cobros del Control), comparado con el mes anterior. Solo lee.
 */
export function monthClose(e: Engine, actor: Actor, month?: unknown) {
  authorize(actor, "catalog.manage");
  const now = e.now();
  const curKey = mk(now);
  let key = typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : curKey;
  if (key > curKey) key = curKey;
  const [y, m] = key.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1) + 4 * 3_600_000, end = Date.UTC(y, m, 1) + 4 * 3_600_000;
  const prevKey = mk(start - 1);
  const events = incomeEvents(e, now);
  const sum = (l: { amount: Cents }[]) => l.reduce((t, x) => t + x.amount, 0);
  const block = (k: string) => {
    const ev = events.filter((x) => mk(x.at) === k);
    const gastos = (e.s.expenses ?? []).filter((x) => mk(x.at) === k);
    const byPayer = new Map<Id, Cents>();
    for (const x of ev) byPayer.set(x.payerId, (byPayer.get(x.payerId) ?? 0) + x.amount);
    const payers = [...byPayer].map(([id, amount]) => ({ customerId: id, name: e.s.customers[id]?.name ?? "—", kind: e.s.customers[id]?.kind ?? "customer", amount })).sort((a, b) => b.amount - a.amount);
    const ingresos = sum(ev);
    const g = gastos.reduce((t, x) => t + x.amount, 0), cuentas = gastos.filter((x) => x.accountId).reduce((t, x) => t + x.amount, 0);
    return {
      key: k, ingresos, delControl: sum(ev.filter((x) => x.source === "control")), dePedidos: sum(ev.filter((x) => x.source === "order")), delFiado: sum(ev.filter((x) => x.source === "fiado")),
      cobrosFiado: ev.filter((x) => x.kind === "fiado").length,
      ventas: ev.filter((x) => x.kind === "sale").length, renovaciones: ev.filter((x) => x.kind === "renewal").length, cobrosControl: ev.filter((x) => x.kind === "control").length,
      gastos: g, cuentas, ganancia: ingresos - g,
      topApps: topAppsOfMonth(e, ev), topPayers: payers.slice(0, 5), payers: payers.length,
    };
  };
  const cur = block(key), prev = block(prevKey);
  // ¿Desde cuándo hay datos en la tienda? Si el mes anterior empezó antes que el primer dato, está incompleto:
  // no se muestra un % (sería inventado), solo los montos y desde qué día hay registro.
  const firstDataAt = Math.min(Infinity, ...Object.values(e.s.customers).map((c) => c.createdAt), ...Object.values(e.s.orders).map((o) => o.createdAt), ...Object.values(e.s.assignments).map((a) => a.startsAt), ...(e.s.expenses ?? []).map((x) => x.at));
  const prevStart = boMonthStart(start - 1);
  const prevIncomplete = Number.isFinite(firstDataAt) && firstDataAt > prevStart + DAY;
  const pct = (a: number, b: number) => (prevIncomplete || b <= 0 ? null : Math.round(((a - b) / b) * 100));
  // La MISMA regla de costo de cuentas para el mes elegido y para el anterior (también si el mes ya cerró).
  const est = accountsEstimateMonth(e, key, now), estPrev = accountsEstimateMonth(e, prevKey, now);
  const gan = cur.ganancia - est.amount, ganPrev = prev.ganancia - estPrev.amount;
  const MESL = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
  const months = Array.from({ length: 12 }, (_, i) => { const s = boMonthStart(now, -i), p2 = boParts(s); return { key: mk(s), label: `${MESL[p2.m]} ${p2.y}` }; });
  return {
    month: key, label: `${MESL[m - 1]} ${y}`, closed: key < curKey, start, end, months,
    ...cur,
    cuentasEstimado: est.amount, sinAnotar: est.count, sinCostos: est.sinCostos, gananciaEstimada: gan,
    prev: { key: prevKey, label: `${MESL[Number(prevKey.slice(5, 7)) - 1]} ${prevKey.slice(0, 4)}`, ingresos: prev.ingresos, gastos: prev.gastos, ganancia: prev.ganancia,
      cuentasEstimado: estPrev.amount, sinCostos: estPrev.sinCostos, gananciaEstimada: ganPrev,
      delControl: prev.delControl, delFiado: prev.delFiado, incomplete: prevIncomplete, dataSince: Number.isFinite(firstDataAt) ? firstDataAt : null },
    // La comparativa de ganancia usa la misma regla en los dos meses (con el costo estimado de las cuentas).
    vs: { ingresosPct: pct(cur.ingresos, prev.ingresos), ingresos: cur.ingresos - prev.ingresos, gananciaPct: pct(gan, ganPrev), ganancia: gan - ganPrev, gastos: cur.gastos - prev.gastos },
  };
}

/**
 * Costo ESTIMADO de las cuentas de este mes que todavía no anotaste como gasto: cada cuenta viva
 * este mes (activa o en cuarentena, que no venció antes del día 1) cuesta su costo mensual. Si ya
 * anotaste un gasto de esa cuenta este mes ("Ya la pagué" / "Pagué la renovación"), no se cuenta.
 */
export function accountsEstimate(e: Engine): { amount: Cents; count: number } {
  const { amount, count } = accountsEstimateMonth(e, mk(e.now()));
  return { amount, count };
}

/**
 * Las apps que más te dejaron este mes: lo que entró por cada una menos lo que te cuestan
 * esos perfiles (estimado con el costo de las cuentas). Un combo suma el costo de sus apps.
 */
/** Lo que te cuesta UNA unidad de cada producto (un perfil o la cuenta, por su duración); un combo suma sus apps. */
export function unitCostOf(e: Engine): (productId: Id) => Cents {
  const unit: Record<Id, number> = {};
  for (const m of marginsData(e).products) if (m.unitCost !== null) unit[m.productId] = m.unitCost;
  return (pid: Id): number => {
    const p = e.s.products[pid];
    if (p?.kind === "combo") return (p.comboProductIds ?? []).reduce((t, id) => t + (unit[id] ?? 0), 0);
    return unit[pid] ?? 0;
  };
}

function topAppsOfMonth(e: Engine, events: IncomeEvent[]) {
  const costOf = unitCostOf(e);
  const by: Record<Id, { productId: Id; name: string; ingresos: number; units: number; costo: number; gana: number }> = {};
  for (const x of events) {
    for (const it of x.items) {
      const b = (by[it.productId] ??= { productId: it.productId, name: e.s.products[it.productId]?.name ?? it.productId, ingresos: 0, units: 0, costo: 0, gana: 0 });
      b.ingresos += it.amount; b.units += it.qty; b.costo += costOf(it.productId) * it.qty; // el total ya viene repartido (cupones/descuentos)
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
export function payAccountRenewal(e: Engine, actor: Actor, accountId: Id, input: { amount?: unknown; months?: unknown; usd?: unknown; rate?: unknown } = {}) {
  authorize(actor, "inventory.manage");
  const months = input.months === undefined ? 1 : Number(input.months);
  if (!Number.isInteger(months) || months < 1 || months > 12) throw new DomainError("VALIDATION", "Meses pagados: de 1 a 12");
  // Pago con tarjeta en dólares (opcional): cuántos US$ cobraron y a qué tasa se pasó a bolivianos.
  const usd = input.usd === undefined || input.usd === null || input.usd === "" ? undefined : Number(input.usd);
  const rate = input.rate === undefined || input.rate === null || input.rate === "" ? undefined : Number(input.rate);
  if (usd !== undefined && !(Number.isInteger(usd) && usd > 0 && usd <= 1_200_000)) throw new DomainError("VALIDATION", "Dólares inválidos");
  if (rate !== undefined && !(Number.isFinite(rate) && rate >= 1 && rate <= 100)) throw new DomainError("VALIDATION", "Tasa inválida (Bs por dólar)");
  if ((usd === undefined) !== (rate === undefined)) throw new DomainError("VALIDATION", "Poné los dólares y la tasa, o ninguno de los dos");
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    if (acc.status === "retired") throw new DomainError("INVALID_STATE", "La cuenta está retirada");
    const amount = input.amount === undefined || input.amount === null || input.amount === "" ? accountCostBs(e, acc) * months : Math.round(Number(input.amount));
    if (!Number.isInteger(amount) || amount <= 0) throw new DomainError("VALIDATION", "Poné cuánto pagaste (mayor a 0)");
    const prod = e.s.products[acc.productId]?.name ?? acc.productId;
    // Si ya venció hace más de un ciclo, el nuevo período arranca hoy; si no, se mantiene el día de cobro.
    let next = addMonths(acc.supplierExpiresAt, months);
    if (next < e.now()) next = addMonths(e.now(), months);
    const before = acc.supplierExpiresAt;
    acc.supplierExpiresAt = next;
    acc.cost = Math.round(amount / months);
    if (usd !== undefined) acc.costUsd = Math.round(usd / months);
    delete acc.supplierAlertSentFor;
    const usdTxt = usd !== undefined ? ` · US$ ${(usd / 100).toFixed(2)} × ${rate}` : "";
    const exp: Expense = { id: e.id("exp"), amount, note: `Renovación ${prod} · ${acc.email}${usdTxt}`.slice(0, 120), at: e.now(), accountId: acc.id, ...(usd !== undefined ? { usd, rate: Math.round(rate! * 10_000) / 10_000 } : {}) };
    (e.s.expenses ??= []).push(exp);
    e.audit(actor, "account.renew_paid", "account", acc.id, { amount, months, from: before, to: next, ...(usd !== undefined ? { usd, rate } : {}) });
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
      return accountCostBs(e, a) / slots;
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
