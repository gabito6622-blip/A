// Estadísticas, proveedores y auditoría (solo staff con permiso).
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY, boDayKey, boDayStart, boMonthStart, boParts } from "./time.js";
import { incomeBetween, incomeEvents, sumIncome } from "./income.js";
import { authorize, can, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { stockByProduct } from "./inventory.js";
import { balance } from "./wallet.js";
import { effectivePrice } from "./admin.js";
import { accountCostBs, marginsData } from "./finance.js";
import { isUsd, sumBalancesBs } from "./usd.js";

/**
 * "Saldo que les debés a tus clientes" sin mezclar monedas: `balancesOwed` en Bs (los saldos en dólares
 * convertidos con la tasa de hoy) y aparte cuánto de eso son dólares (`balancesOwedUsd`, centavos de US$).
 */
function owedSplit(e: Engine, ids: Id[]) {
  const t = sumBalancesBs(e, ids, (id) => balance(e, id));
  return { balancesOwed: t.bs + t.usdAsBs, balancesOwedBs: t.bs, balancesOwedUsd: t.usd, balancesOwedUsdRate: t.rate || null };
}

/** Día "AAAA-MM-DD" en Bolivia (antes dependía de la zona horaria del servidor). */
export const localDayKey = boDayKey;

/**
 * Centro de notificaciones del dueño: junta en un solo lugar lo que necesita su
 * atención ahora (pagos por revisar, solicitudes de revendedor, cuentas caídas,
 * cuentas que vencen con el proveedor, servicios vencidos o por vencer).
 * Se calcula de los datos actuales (no guarda estado leído/no leído).
 */
export function notifications(e: Engine, actor: Actor) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo staff");
  const all = notificationItems(e);
  if (can(actor, "catalog.manage")) return all;
  // Atención (seller): solo lo que puede resolver (fallas, pagos, vencidos y por vencer, reubicar).
  const items = all.items.filter((x) => SELLER_NOTIS.has(x.kind));
  return { total: items.reduce((n, x) => n + x.count, 0), items };
}
const SELLER_NOTIS = new Set(["falla", "payment", "overdue", "due", "reloc"]);

/** Igual que notifications() pero sin permisos: lo usan las tareas internas (avisos del dueño). */
export function notificationItems(e: Engine) {
  const now = e.now();
  const out: { kind: string; icon: string; text: string; count: number; go: string; sev: "bad" | "warn" | "info" }[] = [];
  const add = (kind: string, icon: string, text: string, count: number, go: string, sev: "bad" | "warn" | "info") => { if (count > 0) out.push({ kind, icon, text, count, go, sev }); };

  const fallas = Object.values(e.s.tickets ?? {}).filter((t) => t.status === "recibido").length;
  add("falla", "🛠️", fallas === 1 ? "1 falla reportada por revisar" : `${fallas} fallas reportadas por revisar`, fallas, "fallas", "bad");

  const pay = Object.values(e.s.orders).filter((o) => o.status === "payment_review").length;
  add("payment", "💳", pay === 1 ? "1 pago por revisar" : `${pay} pagos por revisar`, pay, "aprobacion", "warn");

  const apps = Object.values(e.s.resellerApps ?? {}).filter((a) => a.status === "pending").length;
  add("reseller", "👤", apps === 1 ? "1 solicitud de revendedor" : `${apps} solicitudes de revendedor`, apps, "revendedores", "info");

  // Cuentas caídas con clientes (perfil en cuarentena, cuenta retirada o vencida con el proveedor).
  const down = new Set(Object.values(e.s.accounts).filter((a) => a.status !== "active" || a.supplierExpiresAt <= now).map((a) => a.id));
  const reloc = Object.values(e.s.assignments).filter((a) => { if (a.status !== "active") return false; const s = e.s.slots[a.slotId]; return s && (s.status === "quarantined" || down.has(s.accountId)); }).length;
  add("reloc", "🔀", reloc === 1 ? "1 cliente en una cuenta caída (reubicar)" : `${reloc} clientes en cuentas caídas (reubicar)`, reloc, "reubicar", "bad");

  const supplierSoon = Object.values(e.s.accounts).filter((a) => a.status === "active" && a.supplierExpiresAt > now && a.supplierExpiresAt <= now + 7 * DAY).length;
  add("supplier", "📅", supplierSoon === 1 ? "1 cuenta vence con el proveedor (7 días)" : `${supplierSoon} cuentas vencen con el proveedor (7 días)`, supplierSoon, "cuentas", "warn");

  const risky = new Set((e.s.accountAlerts ?? []).filter((a) => !a.seen && ["password_changed", "email_changed", "payment_failed", "cancelled"].includes(a.kind)).map((a) => a.accountId)).size;
  add("accountRisk", "🚨", risky === 1 ? "1 cuenta en riesgo (aviso de la plataforma)" : `${risky} cuentas en riesgo (avisos de la plataforma)`, risky, "cuentas", "bad");
  const dupPay = Object.values(e.s.orders).filter((o) => o.status === "payment_review" && o.evidence?.duplicateOf).length;
  add("dupReceipt", "🔁", dupPay === 1 ? "1 comprobante repetido por revisar" : `${dupPay} comprobantes repetidos por revisar`, dupPay, "aprobacion", "bad");

  const sup1 = Object.values(e.s.accounts).filter((a) => a.status === "active" && a.supplierExpiresAt > now && a.supplierExpiresAt <= now + DAY).length;
  add("supplier1d", "⚠️", sup1 === 1 ? "1 cuenta vence MAÑANA con el proveedor" : `${sup1} cuentas vencen MAÑANA con el proveedor`, sup1, "cuentas", "bad");

  // Stock bajo: productos publicados (no combos) que ya tuvieron cuentas y les quedan pocos perfiles libres.
  const minFree = e.s.settings.lowStockAt ?? 2;
  if (minFree > 0) {
    const st = stockByProduct(e);
    const low = Object.values(e.s.products).filter((p) => p.published && p.kind !== "combo" && st[p.id] && (st[p.id].available ?? 0) < minFree)
      .map((p) => `${p.name} (${st[p.id].available ?? 0})`);
    add("lowstock", "📦", low.length === 1 ? `Stock bajo: ${low[0]}` : `Stock bajo en ${low.length} productos: ${low.slice(0, 4).join(", ")}${low.length > 4 ? "…" : ""}`, low.length, "cuentas", "warn");
  }

  const active = Object.values(e.s.assignments).filter((a) => a.status === "active");
  const overdue = active.filter((a) => a.customerExpiresAt < now).length;
  add("overdue", "🔴", overdue === 1 ? "1 servicio vencido sin renovar" : `${overdue} servicios vencidos sin renovar`, overdue, "control", "bad");
  const due3 = active.filter((a) => { const d = (a.customerExpiresAt - now) / DAY; return d >= 0 && d <= 3; }).length;
  add("due", "⏰", due3 === 1 ? "1 servicio vence en 3 días" : `${due3} servicios vencen en 3 días`, due3, "control", "warn");

  // Precio de revendedor: si falta, el revendedor paga el precio público sin que nadie se entere.
  const custs = Object.values(e.s.customers);
  const resellers = custs.filter((c) => c.kind === "reseller");
  if (resellers.length) {
    const rev = e.s.priceGroups.revendedor?.prices ?? {};
    // Si los revendedores solo compran lo de revendedores, solo importa el precio de esos productos.
    const forRes = (p: { published: boolean; resellersOnly?: boolean }) => (e.s.settings.resellerOnlyCatalog ? !!p.resellersOnly && p.published : p.published || !!p.resellersOnly);
    const sinPrecio = Object.values(e.s.products).filter((p) => forRes(p) && rev[p.id] === undefined);
    add("resellerPrice", "🏷️", sinPrecio.length === 1 ? `1 producto sin precio de revendedor (${sinPrecio[0].name}): paga el precio público` : `${sinPrecio.length} productos sin precio de revendedor: pagan el precio público`, sinPrecio.length, "productos", "warn");
    const loss = marginsData(e).products.filter((p) => p.reseller?.state === "loss" && (!e.s.settings.resellerOnlyCatalog || !!e.s.products[p.productId]?.resellersOnly));
    add("resellerLoss", "🔴", loss.length === 1 ? `Perdés plata con ${loss[0].name} (revendedor): ${fmtMoney(e, loss[0].reseller!.gain)} por venta` : `Perdés plata en ${loss.length} productos a precio de revendedor: ${loss.slice(0, 3).map((p) => p.name).join(", ")}${loss.length > 3 ? "…" : ""}`, loss.length, "productos", "bad");
    // Revendedores dormidos: hace más de 14 días que no te compran (y llevan más de 14 días con vos).
    const last = lastPurchaseByPayer(e);
    const dormidos = resellers.filter((c) => c.createdAt < now - DORMANT_DAYS * DAY && (last[c.id] ?? 0) < now - DORMANT_DAYS * DAY);
    add("resellerSleep", "💤", dormidos.length === 1 ? `${dormidos[0].name} no te compra hace más de ${DORMANT_DAYS} días` : `${dormidos.length} revendedores sin comprar hace más de ${DORMANT_DAYS} días`, dormidos.length, "revendedores", "info");
  }

  return { total: out.reduce((n, x) => n + x.count, 0), items: out };
}

export const DORMANT_DAYS = 14;
const fmtMoney = (e: Engine, c: number) => `${c < 0 ? "-" : ""}${e.s.settings.currencySymbol || "Bs"} ${Math.abs(c / 100).toLocaleString("es-BO", { maximumFractionDigits: 2 })}`;

/** Última compra pagada (venta o renovación) de cada cliente que paga (revendedor o cliente). */
export function lastPurchaseByPayer(e: Engine): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const o of Object.values(e.s.orders)) {
    if (o.status !== "fulfilled" || o.kind === "topup" || o.trial) continue;
    const pid = o.payerId ?? o.customerId;
    if ((out[pid] ?? 0) < o.updatedAt) out[pid] = o.updatedAt;
  }
  return out;
}

export function summary(e: Engine, actor: Actor, range: { from: number; to: number }) {
  authorize(actor, "stats.view");
  // La misma fuente que Inicio, Finanzas y Cómo van: pedidos entregados + cobros marcados en el Control.
  const ev = incomeBetween(incomeEvents(e, Math.max(e.now(), range.to)), range.from, range.to);
  const byProduct: Record<Id, { units: number; revenue: number }> = {};
  const byDay: Record<string, number> = {};
  for (const x of ev) {
    for (const it of x.items) {
      const b = (byProduct[it.productId] ??= { units: 0, revenue: 0 });
      b.units += it.qty;
      b.revenue += it.amount;
    }
    const d = localDayKey(x.at);
    byDay[d] = (byDay[d] ?? 0) + x.amount;
  }
  // Ingreso de caja: lo que entró de verdad (QR/efectivo + recargas + cobros del Control). Lo pagado con saldo ya entró como recarga.
  const inRange = Object.values(e.s.orders).filter((o) => o.status === "fulfilled" && o.channel !== "import" && o.updatedAt >= range.from && o.updatedAt < range.to);
  const cashIn = inRange.filter((o) => o.paymentMethod !== "balance").reduce((s, o) => s + o.total, 0) + sumIncome(ev.filter((x) => x.source !== "order")); // + cobros del Control y pagos del fiado
  const customerIds = Object.keys(e.s.customers);
  return {
    revenue: sumIncome(ev),
    /** De lo que entró, cuánto son cobros marcados 💵 en el Control (sin pedido). */
    fromControl: sumIncome(ev.filter((x) => x.source === "control")),
    cashIn,
    orders: ev.filter((x) => x.source === "order").length,
    byProduct,
    byDay,
    pendingReview: Object.values(e.s.orders).filter((o) => o.status === "payment_review").length,
    stock: stockByProduct(e),
    // Mismo criterio en todas las pantallas: vencen en los próximos 7 días (los ya vencidos van aparte).
    expiringIn7Days: Object.values(e.s.assignments).filter((a) => a.status === "active" && a.customerExpiresAt >= e.now() && a.customerExpiresAt - e.now() <= 7 * DAY).length,
    /** Saldo que la tienda le debe a sus clientes (pasivo), en Bs: los saldos en dólares se convierten con la tasa de hoy. */
    ...owedSplit(e, customerIds),
  };
}

/** Datos del dashboard: período elegido vs. el anterior, series por día, rankings y vencimientos. */
export function dashboard(e: Engine, actor: Actor, days: number) {
  authorize(actor, "stats.view");
  const now = e.now();
  const span = Math.min(Math.max(Math.round(days) || 30, 7), 365) * DAY;
  const from = now - span, prevFrom = from - span;
  const done = Object.values(e.s.orders).filter((o) => o.status === "fulfilled" && o.channel !== "import");
  // Fuente única de ingresos (pedidos entregados + cobros marcados en el Control): la misma que Finanzas y Cómo van.
  const all = incomeEvents(e, now);
  const cur = incomeBetween(all, from, now + 1), prev = incomeBetween(all, prevFrom, from);
  const sum = sumIncome;
  const dayKey = localDayKey;
  const nDays = Math.round(span / DAY);
  const series = Array.from({ length: nDays }, (_, i) => ({ day: dayKey(from + (i + 1) * DAY), sales: 0, renewals: 0, topups: 0, control: 0 }));
  const idx = new Map(series.map((d, i) => [d.day, i]));
  for (const o of done) {
    if (o.kind !== "topup" || o.updatedAt < from) continue;
    const i = idx.get(dayKey(o.updatedAt));
    if (i !== undefined) series[i].topups += o.total;
  }
  for (const x of all) {
    if (x.at < from) continue;
    const i = idx.get(dayKey(x.at));
    if (i === undefined) continue;
    if (x.kind === "control") series[i].control += x.amount; else if (x.kind === "renewal") series[i].renewals += x.amount; else series[i].sales += x.amount;
  }
  const byProduct: Record<Id, { name: string; revenue: number; units: number; color: string }> = {};
  for (const x of cur) for (const it of x.items) {
    const p = e.s.products[it.productId];
    const b = (byProduct[it.productId] ??= { name: p?.name ?? it.productId, revenue: 0, units: 0, color: p?.color ?? "#3984ff" });
    b.revenue += it.amount; b.units += it.qty;
  }
  const active = Object.values(e.s.assignments).filter((a) => a.status === "active");
  // Lo que de verdad te pagan: precio acordado ?? lista de quien paga (revendedor) ?? precio del producto.
  const priceOf = (a: (typeof active)[number]) => effectivePrice(e, a);
  const activeByProduct: Record<Id, { name: string; count: number; color: string }> = {};
  for (const a of active) {
    const p = e.s.products[a.productId];
    (activeByProduct[a.productId] ??= { name: p?.name ?? a.productId, count: 0, color: p?.color ?? "#3984ff" }).count++;
  }
  const custs = Object.values(e.s.customers);
  const resellers = custs.filter((c) => c.kind === "reseller").map((c) => {
    const mine = active.filter((a) => a.customerId === c.id || e.s.customers[a.customerId]?.resellerId === c.id);
    const spent = sum(cur.filter((x) => x.payerId === c.id));
    return { id: c.id, name: c.name, services: mine.length, monthly: mine.reduce((s, a) => s + priceOf(a), 0), spent, balance: balance(e, c.id), currency: isUsd(e, c) ? "USD" as const : "BOB" as const, due7: mine.filter((a) => a.customerExpiresAt >= now && a.customerExpiresAt - now <= 7 * DAY).length };
  }).sort((a, b) => b.monthly - a.monthly || b.services - a.services).slice(0, 8);
  const upcoming = Array.from({ length: 14 }, (_, i) => {
    const a = boDayStart(now, i), b = boDayStart(now, i + 1);
    const l = active.filter((x) => x.customerExpiresAt >= a && x.customerExpiresAt < b);
    return { day: a, count: l.length, amount: l.reduce((s, x) => s + priceOf(x), 0) };
  });
  // Montos de los atajos del dashboard (vencidos, por vencer, sin pagar).
  const overdueList = active.filter((a) => a.customerExpiresAt < now || a.holdOpen);
  const due3List = active.filter((a) => a.customerExpiresAt >= now && a.customerExpiresAt - now <= 3 * DAY);
  const unpaidList = active.filter((a) => a.control?.payStatus && a.control.payStatus !== "pagado");
  const amt = (l: typeof active) => l.reduce((s, a) => s + priceOf(a), 0);
  // Ingresos por mes (últimos 12 meses): ventas + renovaciones (sin recargas).
  const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
  // Meses calendario de Bolivia (no de la zona horaria del servidor).
  const months = Array.from({ length: 12 }, (_, i) => {
    const start = boMonthStart(now, -(11 - i)), p = boParts(start);
    return { key: `${p.y}-${p.m}`, label: MES[p.m], revenue: 0 };
  });
  const mIdx = new Map(months.map((m, i) => [m.key, i]));
  for (const x of all) {
    const p = boParts(x.at);
    const i = mIdx.get(`${p.y}-${p.m}`);
    if (i !== undefined) months[i].revenue += x.amount;
  }
  return {
    days: nDays,
    alerts: { overdue: { count: overdueList.length, amount: amt(overdueList) }, due3: { count: due3List.length, amount: amt(due3List) }, unpaid: { count: unpaidList.length, amount: amt(unpaidList) } },
    months,
    kpi: {
      revenue: sum(cur), prevRevenue: sum(prev), orders: cur.filter((x) => x.source === "order").length, prevOrders: prev.filter((x) => x.source === "order").length,
      /** De los ingresos del período, cuánto son cobros marcados 💵 en el Control (sin pedido). */
      fromControl: sum(cur.filter((x) => x.source === "control")),
      renewals: cur.filter((x) => x.kind === "renewal").length, topups: done.filter((o) => o.kind === "topup" && o.updatedAt >= from).reduce((s, o) => s + o.total, 0),
      newCustomers: custs.filter((c) => c.createdAt >= from).length, customers: custs.length, resellers: custs.filter((c) => c.kind === "reseller").length,
      activeServices: active.length, monthlyRecurring: active.reduce((s, a) => s + priceOf(a), 0),
      overdue: active.filter((a) => a.customerExpiresAt < now || a.holdOpen).length, due7: active.filter((a) => a.customerExpiresAt >= now && a.customerExpiresAt - now <= 7 * DAY).length,
      pendingReview: Object.values(e.s.orders).filter((o) => o.status === "payment_review").length,
      ...owedSplit(e, custs.map((c) => c.id)),
      unpaid: active.filter((a) => a.control?.payStatus && a.control.payStatus !== "pagado").length,
    },
    series, upcoming,
    byProduct: Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 8),
    activeByProduct: Object.values(activeByProduct).sort((a, b) => b.count - a.count).slice(0, 8),
    resellers,
    recent: Object.values(e.s.orders).filter((o) => o.channel !== "import").sort((a, b) => b.createdAt - a.createdAt).slice(0, 8)
      .map((o) => ({ id: o.id, kind: o.kind, status: o.status, total: o.total, at: o.createdAt, customer: e.s.customers[o.customerId]?.name ?? "", product: o.items[0] ? e.s.products[o.items[0].productId]?.name ?? "" : "Recarga" })),
  };
}

/**
 * Proveedores: ingreso y costo del MISMO período (últimos 30 días).
 * Ingreso = ventas y renovaciones cobradas en esos 30 días cuyos perfiles son de cuentas del proveedor.
 * El total de cada pedido se reparte entre sus perfiles según el precio de cada app (así los combos
 * y los cupones también se cuentan, y la suma de todos los proveedores da el ingreso del período).
 * Costo = costo mensual de las cuentas que estuvieron vivas en esos 30 días.
 */
export const SUPPLIER_PERIOD_DAYS = 30;
export function supplierRevenueByAccount(e: Engine, from: number, to: number): Record<Id, number> {
  const out: Record<Id, number> = {};
  for (const o of Object.values(e.s.orders)) {
    if (o.status !== "fulfilled" || o.kind === "topup" || o.trial || o.channel === "import" || o.updatedAt < from || o.updatedAt > to) continue;
    const asg = (o.assignmentIds ?? []).map((id) => e.s.assignments[id]).filter(Boolean);
    if (!asg.length || !o.total) continue;
    const w = asg.map((a) => Math.max(1, e.s.products[a.productId]?.price ?? 1));
    const wt = w.reduce((s, x) => s + x, 0);
    asg.forEach((a, i) => {
      const accId = e.s.slots[a.slotId]?.accountId;
      if (accId) out[accId] = (out[accId] ?? 0) + (o.total * w[i]) / wt;
    });
  }
  return out;
}

export function supplierReport(e: Engine, actor: Actor) {
  authorize(actor, "supplier.manage");
  const now = e.now(), from = now - SUPPLIER_PERIOD_DAYS * DAY;
  const revByAcc = supplierRevenueByAccount(e, from, now);
  return Object.values(e.s.suppliers).map((sup) => {
    const accs = Object.values(e.s.accounts).filter((a) => a.supplierId === sup.id);
    const accIds = new Set(accs.map((a) => a.id));
    const slots = Object.values(e.s.slots).filter((s) => accIds.has(s.accountId));
    const revenue = Math.round(accs.reduce((s, a) => s + (revByAcc[a.id] ?? 0), 0));
    // Costo del período: un mes de cada cuenta que estuvo viva en estos 30 días.
    const cost = accs.filter((a) => a.status !== "retired" && a.supplierExpiresAt >= from && a.createdAt <= now).reduce((s, a) => s + accountCostBs(e, a), 0);
    return {
      supplierId: sup.id, name: sup.name, active: sup.active, periodDays: SUPPLIER_PERIOD_DAYS,
      accounts: accs.length, activeAccounts: accs.filter((a) => a.status === "active").length,
      slots: slots.length, assigned: slots.filter((s) => s.status === "assigned").length,
      quarantined: slots.filter((s) => s.status === "quarantined").length,
      cost, revenue, margin: revenue - cost,
      expiringIn7Days: accs.filter((a) => a.status === "active" && a.supplierExpiresAt >= now && a.supplierExpiresAt - now <= 7 * DAY).map((a) => ({ accountId: a.id, email: a.email, expiresAt: a.supplierExpiresAt })),
    };
  });
}

export function auditLog(e: Engine, actor: Actor, filter: { entityId?: Id; action?: string; limit?: number } = {}) {
  authorize(actor, "audit.view");
  return e.s.audit
    .filter((a) => (!filter.entityId || a.entityId === filter.entityId) && (!filter.action || a.action.startsWith(filter.action)))
    .slice(-(filter.limit ?? 200))
    .reverse();
}
