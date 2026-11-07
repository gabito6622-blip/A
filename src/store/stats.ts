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
