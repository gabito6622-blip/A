// Estadísticas, proveedores y auditoría (solo staff con permiso).
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY } from "./time.js";
import { authorize } from "./auth.js";
import { stockByProduct } from "./inventory.js";
import { balance } from "./wallet.js";

export function summary(e: Engine, actor: Actor, range: { from: number; to: number }) {
  authorize(actor, "stats.view");
  const inRange = Object.values(e.s.orders).filter((o) => o.status === "fulfilled" && o.updatedAt >= range.from && o.updatedAt < range.to);
  const sales = inRange.filter((o) => o.kind !== "topup" && o.channel !== "import");
  const byProduct: Record<Id, { units: number; revenue: number }> = {};
  const byDay: Record<string, number> = {};
  for (const o of sales) {
    for (const it of o.items) {
      const b = (byProduct[it.productId] ??= { units: 0, revenue: 0 });
      b.units += it.qty;
      b.revenue += it.qty * it.unitPrice;
    }
    const d = new Date(o.updatedAt).toISOString().slice(0, 10);
    byDay[d] = (byDay[d] ?? 0) + o.total;
  }
  // Ingreso de caja: lo que entró de verdad (QR/efectivo + recargas). Lo pagado con saldo ya entró como recarga.
  const cashIn = inRange.filter((o) => o.paymentMethod !== "balance").reduce((s, o) => s + o.total, 0);
  const customerIds = Object.keys(e.s.customers);
  return {
    revenue: sales.reduce((s, o) => s + o.total, 0),
    cashIn,
    orders: sales.length,
    byProduct,
    byDay,
    pendingReview: Object.values(e.s.orders).filter((o) => o.status === "payment_review").length,
    stock: stockByProduct(e),
    expiringIn7Days: Object.values(e.s.assignments).filter((a) => a.status === "active" && a.customerExpiresAt - e.now() <= 7 * DAY).length,
    /** Saldo que la tienda le debe a sus clientes (pasivo). */
    balancesOwed: customerIds.reduce((s, id) => s + balance(e, id), 0),
  };
}

/** Datos del dashboard: período elegido vs. el anterior, series por día, rankings y vencimientos. */
export function dashboard(e: Engine, actor: Actor, days: number) {
  authorize(actor, "stats.view");
  const now = e.now();
  const span = Math.min(Math.max(Math.round(days) || 30, 7), 365) * DAY;
  const from = now - span, prevFrom = from - span;
  const done = Object.values(e.s.orders).filter((o) => o.status === "fulfilled" && o.channel !== "import");
  const sales = (a: number, b: number) => done.filter((o) => o.kind !== "topup" && o.updatedAt >= a && o.updatedAt < b);
  const cur = sales(from, now + 1), prev = sales(prevFrom, from);
  const sum = (l: { total: number }[]) => l.reduce((s, o) => s + o.total, 0);
  const dayKey = (t: number) => new Date(t).toISOString().slice(0, 10);
  const nDays = Math.round(span / DAY);
  const series = Array.from({ length: nDays }, (_, i) => ({ day: dayKey(from + (i + 1) * DAY), sales: 0, renewals: 0, topups: 0 }));
  const idx = new Map(series.map((d, i) => [d.day, i]));
  for (const o of done) {
    if (o.updatedAt < from) continue;
    const i = idx.get(dayKey(o.updatedAt));
    if (i === undefined) continue;
    if (o.kind === "topup") series[i].topups += o.total; else if (o.kind === "renewal") series[i].renewals += o.total; else series[i].sales += o.total;
  }
  const byProduct: Record<Id, { name: string; revenue: number; units: number; color: string }> = {};
  for (const o of cur) for (const it of o.items) {
    const p = e.s.products[it.productId];
    const b = (byProduct[it.productId] ??= { name: p?.name ?? it.productId, revenue: 0, units: 0, color: p?.color ?? "#3984ff" });
    b.revenue += it.qty * it.unitPrice; b.units += it.qty;
  }
  const active = Object.values(e.s.assignments).filter((a) => a.status === "active");
  const priceOf = (a: (typeof active)[number]) => a.control?.price ?? e.s.products[a.productId]?.price ?? 0;
  const activeByProduct: Record<Id, { name: string; count: number; color: string }> = {};
  for (const a of active) {
    const p = e.s.products[a.productId];
    (activeByProduct[a.productId] ??= { name: p?.name ?? a.productId, count: 0, color: p?.color ?? "#3984ff" }).count++;
  }
  const custs = Object.values(e.s.customers);
  const resellers = custs.filter((c) => c.kind === "reseller").map((c) => {
    const mine = active.filter((a) => a.customerId === c.id || e.s.customers[a.customerId]?.resellerId === c.id);
    const spent = sum(cur.filter((o) => o.payerId === c.id));
    return { id: c.id, name: c.name, services: mine.length, monthly: mine.reduce((s, a) => s + priceOf(a), 0), spent, balance: balance(e, c.id), due7: mine.filter((a) => a.customerExpiresAt - now <= 7 * DAY).length };
  }).sort((a, b) => b.monthly - a.monthly || b.services - a.services).slice(0, 8);
  const upcoming = Array.from({ length: 14 }, (_, i) => {
    const d0 = new Date(now); d0.setHours(0, 0, 0, 0);
    const a = d0.getTime() + i * DAY, b = a + DAY;
    const l = active.filter((x) => x.customerExpiresAt >= a && x.customerExpiresAt < b);
    return { day: a, count: l.length, amount: l.reduce((s, x) => s + priceOf(x), 0) };
  });
  return {
    days: nDays,
    kpi: {
      revenue: sum(cur), prevRevenue: sum(prev), orders: cur.length, prevOrders: prev.length,
      renewals: cur.filter((o) => o.kind === "renewal").length, topups: sum(done.filter((o) => o.kind === "topup" && o.updatedAt >= from)),
      newCustomers: custs.filter((c) => c.createdAt >= from).length, customers: custs.length, resellers: custs.filter((c) => c.kind === "reseller").length,
      activeServices: active.length, monthlyRecurring: active.reduce((s, a) => s + priceOf(a), 0),
      overdue: active.filter((a) => a.customerExpiresAt < now || a.holdOpen).length, due7: active.filter((a) => a.customerExpiresAt >= now && a.customerExpiresAt - now <= 7 * DAY).length,
      pendingReview: Object.values(e.s.orders).filter((o) => o.status === "payment_review").length,
      balancesOwed: custs.reduce((s, c) => s + balance(e, c.id), 0),
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

export function supplierReport(e: Engine, actor: Actor) {
  authorize(actor, "supplier.manage");
  return Object.values(e.s.suppliers).map((sup) => {
    const accs = Object.values(e.s.accounts).filter((a) => a.supplierId === sup.id);
    const accIds = new Set(accs.map((a) => a.id));
    const slots = Object.values(e.s.slots).filter((s) => accIds.has(s.accountId));
    const slotIds = new Set(slots.map((s) => s.id));
    // Ingreso atribuido: precio de cada asignación (venta) hecha sobre perfiles de este proveedor.
    let revenue = 0;
    for (const a of Object.values(e.s.assignments)) {
      if (!a.history.some((h) => slotIds.has(h.slotId))) continue;
      const o = e.s.orders[a.orderId];
      revenue += o?.items.find((i) => i.productId === a.productId)?.unitPrice ?? 0;
    }
    const cost = accs.reduce((s, a) => s + a.cost, 0);
    return {
      supplierId: sup.id, name: sup.name, active: sup.active,
      accounts: accs.length, activeAccounts: accs.filter((a) => a.status === "active").length,
      slots: slots.length, assigned: slots.filter((s) => s.status === "assigned").length,
      quarantined: slots.filter((s) => s.status === "quarantined").length,
      cost, revenue, margin: revenue - cost,
      expiringIn7Days: accs.filter((a) => a.status === "active" && a.supplierExpiresAt - e.now() <= 7 * DAY).map((a) => ({ accountId: a.id, email: a.email, expiresAt: a.supplierExpiresAt })),
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
