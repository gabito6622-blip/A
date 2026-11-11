// Herramientas del revendedor para manejar SU negocio desde su panel (sin Excel aparte):
// - "Mi control": los servicios de sus clientes en una tabla, con su precio, si le pagaron y una nota.
// - "Mis ganancias": lo que vendió, lo que le costó y lo que le quedó, mes a mes y por app.
// Solo ve y toca lo de SUS clientes. No muestra contraseñas (eso está en "Mis cuentas").
import type { Actor, Cents, Id, RentalControl } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { priceFor, visibleTo } from "./catalog.js";
import { renewableNow } from "./orders.js";
import { addPayment, chargeUnpaidRentals, history } from "./fiado.js";

function reseller(e: Engine, actor: Actor) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return e.get("customers", actor.customerId);
}

export function myControl(e: Engine, actor: Actor) {
  const me = reseller(e, actor);
  return Object.values(e.s.assignments)
    .filter((a) => a.status === "active" && e.s.customers[a.customerId]?.resellerId === me.id)
    .sort((x, y) => x.customerExpiresAt - y.customerExpiresAt)
    .map((a) => {
      const c = e.s.customers[a.customerId], slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
      return {
        id: a.id, clientId: c.id, client: c.name, phone: c.phone ?? "", productId: a.productId, product: e.s.products[a.productId]?.name ?? "",
        email: acc?.email ?? "", profile: slot?.label ?? "", startsAt: a.startsAt, expiresAt: a.customerExpiresAt, holdOpen: !!a.holdOpen,
        price: a.rcontrol?.price ?? me.resellerPrices?.[a.productId] ?? null, pay: a.rcontrol?.payStatus ?? "pagado", note: a.rcontrol?.note ?? "",
        // Lo que le cuesta renovar con su saldo (el mismo cálculo que usa la renovación).
        cost: a.control?.price ?? priceFor(e, me.id, a.productId), canRenew: !!e.s.products[a.productId] && visibleTo(e, e.s.products[a.productId], me.id), renewableNow: renewableNow(e, a),
      };
    });
}

/** El revendedor anota su precio, si le pagó y una nota en el servicio de un cliente suyo. */
export function setMyControl(e: Engine, actor: Actor, assignmentId: Id, patch: { price?: unknown; payStatus?: unknown; note?: unknown }) {
  const me = reseller(e, actor);
  const out: RentalControl = {};
  if (patch.price !== undefined) {
    if (patch.price === null || patch.price === "") out.price = undefined;
    else {
      const n = Math.round(Number(patch.price));
      if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new DomainError("VALIDATION", "Precio inválido");
      out.price = n;
    }
  }
  if (patch.payStatus !== undefined) {
    if (!["pagado", "pendiente", "no_pago"].includes(String(patch.payStatus))) throw new DomainError("VALIDATION", "Estado de pago inválido");
    out.payStatus = patch.payStatus as RentalControl["payStatus"];
  }
  if (patch.note !== undefined) {
    const t = String(patch.note ?? "").trim();
    if (t.length > 120) throw new DomainError("VALIDATION", "La nota va hasta 120 letras");
    out.note = t || undefined;
  }
  const res = e.tx(() => {
    const a = e.get("assignments", assignmentId);
    if (e.s.customers[a.customerId]?.resellerId !== me.id) throw new DomainError("FORBIDDEN", "Ese servicio no es de un cliente tuyo");
    const next = { ...(a.rcontrol ?? {}), ...out };
    for (const k of Object.keys(next) as (keyof RentalControl)[]) if (next[k] === undefined) delete next[k];
    a.rcontrol = next;
    e.audit(actor, "reseller.control", "assignment", a.id, { fields: Object.keys(patch).join(",") });
    return { ok: true as const, customerId: a.customerId };
  });
  // "Quién me debe" queda al día solo: si no te pagó, se anota en tu libreta; si después marcás
  // "Pagado", se anota el pago de lo que faltaba. Así Mi control y la libreta nunca dicen cosas distintas.
  if (out.payStatus && out.payStatus !== "pagado") chargeUnpaidRentals(e, actor, res.customerId);
  if (out.payStatus === "pagado") {
    const ch = history(e, actor, res.customerId).entries.find((x) => x.kind === "cargo" && x.assignmentId === assignmentId);
    const left = ch ? ch.amount - (ch.covered ?? 0) : 0;
    if (left > 0) addPayment(e, actor, { customerId: res.customerId, amount: left, note: "Marcado como pagado en Mi control" });
  }
  return { ok: true as const };
}

const MES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const monthKey = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz", year: "numeric", month: "2-digit" }).format(new Date(t));

/**
 * Ganancias del revendedor: ventas y renovaciones que pagó él para SUS clientes.
 * Le costó = lo que pagó; cobró = su precio para ese cliente (o su lista de precios).
 */
export function myEarnings(e: Engine, actor: Actor) {
  const me = reseller(e, actor);
  const now = e.now();
  type Row = { sales: number; cost: Cents; revenue: Cents; noPrice: number; unpaid: Cents };
  const months = new Map<string, Row>();
  const apps = new Map<string, Row & { productId: Id; name: string }>();
  const cur = monthKey(now);
  const mine = (o: (typeof e.s.orders)[string]) => o.payerId === me.id && o.customerId !== me.id && o.status === "fulfilled" && (o.kind === "sale" || o.kind === "renewal");
  // Último pedido de cada servicio: si hoy figura "Pendiente"/"No pagó", ese pedido todavía no se cobró.
  const lastOf = new Map<Id, { id: Id; at: number }>();
  for (const o of Object.values(e.s.orders)) if (mine(o)) for (const aid of o.assignmentIds) {
    const cur2 = lastOf.get(aid);
    if (!cur2 || o.updatedAt >= cur2.at) lastOf.set(aid, { id: o.id, at: o.updatedAt });
  }
  for (const o of Object.values(e.s.orders)) {
    if (!mine(o)) continue;
    if (now - o.updatedAt > 370 * 86_400_000) continue;
    const k = monthKey(o.updatedAt);
    const m = months.get(k) ?? { sales: 0, cost: 0, revenue: 0, noPrice: 0, unpaid: 0 };
    m.sales++; m.cost += o.total;
    for (const it of o.items) {
      const a = o.assignmentIds.map((id) => e.s.assignments[id]).find((x) => x && x.productId === it.productId);
      const units = o.kind === "renewal" ? 1 : it.qty;
      const periods = o.kind === "renewal" ? it.qty : (o.periods ?? 1);
      const sell = a?.rcontrol?.price ?? me.resellerPrices?.[it.productId];
      const revenue = sell === undefined ? it.unitPrice * it.qty : sell * units * periods;
      if (sell === undefined) m.noPrice++;
      m.revenue += revenue;
      const unpaid = !!a && (a.rcontrol?.payStatus ?? "pagado") !== "pagado" && lastOf.get(a.id)?.id === o.id;
      if (unpaid) m.unpaid += revenue;
      if (k === cur) {
        const p = apps.get(it.productId) ?? { productId: it.productId, name: e.s.products[it.productId]?.name ?? it.productId, sales: 0, cost: 0, revenue: 0, noPrice: 0, unpaid: 0 };
        if (unpaid) p.unpaid += revenue;
        p.sales += units; p.cost += it.unitPrice * it.qty; p.revenue += revenue; if (sell === undefined) p.noPrice++;
        apps.set(it.productId, p);
      }
    }
    months.set(k, m);
  }
  const label = (k: string) => `${MES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
  const list = [...months.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 6)
    .map(([k, m]) => ({ key: k, label: label(k), ...m, collected: m.revenue - m.unpaid, profit: m.revenue - m.cost, profitCollected: m.revenue - m.unpaid - m.cost }));
  const thisMonth = list.find((x) => x.key === cur) ?? { key: cur, label: label(cur), sales: 0, cost: 0, revenue: 0, noPrice: 0, unpaid: 0, collected: 0, profit: 0, profitCollected: 0 };
  return {
    month: thisMonth, months: list,
    byApp: [...apps.values()].map((p) => ({ ...p, profit: p.revenue - p.cost })).sort((a, b) => b.profit - a.profit),
  };
}
