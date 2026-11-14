// «💵 Me pagó todo» por revendedor (revisión de 3 meses, 14/11/2026).
//
// A fin de mes un revendedor le paga al dueño TODO junto (sus 8 alquileres). Antes eran 8 «Me pagó» o un «Renovar +1»
// sin ver el total. Ahora, en su tarjeta de Revendedores: un botón que muestra sus alquileres vencidos o por vencer
// (7 días) y lo que debe en el Control, con la suma, y los anota todos juntos después de confirmar el total.
// Usa lo que ya existe: «Me pagó» de Mi secretaria (`cobro.payApply`: corre la fecha y marca pagado, con sus frenos)
// para lo que vence, y el Control (`setRentalControl` → pagado) para lo que debía del período actual (no corre la fecha).
// Todo o nada: si algo frena (por ejemplo, el mismo período ya figura cobrado), no se anota nada y se dice cuál.
import type { Actor, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart } from "./time.js";
import { effectivePrice } from "./admin.js";
import { payApply, payPreview } from "./cobro.js";
import { setRentalControl } from "./orders.js";
import { owedBy } from "./fiado.js";
import { paidInReview } from "./avisoAlquiler.js";

/** Lo que vence en estos días (o ya venció) entra en «Me pagó todo». */
export const DUE_DAYS = 7;
const short = (n: string) => n.replace(/\s*\(alquiler revendedores\)\s*$/i, "");

export function resellerDue(e: Engine, actor: Actor, resellerId: Id) {
  authorize(actor, "payment.review");
  const r = e.get("customers", resellerId);
  if (r.kind !== "reseller") throw new DomainError("VALIDATION", "Solo para revendedores");
  const now = e.now();
  const inFiado = new Set((e.s.fiado ?? []).filter((x) => !x.creditorId && x.kind === "cargo" && x.assignmentId).map((x) => x.assignmentId));
  const rows = Object.values(e.s.assignments)
    .filter((a) => a.status === "active" && !a.trial && (a.customerId === r.id || e.s.customers[a.customerId]?.resellerId === r.id))
    .sort((x, y) => x.customerExpiresAt - y.customerExpiresAt)
    .flatMap((a) => {
      const debt = !!a.control?.payStatus && a.control.payStatus !== "pagado";
      const dl = Math.round((boDayStart(a.customerExpiresAt) - boDayStart(now)) / DAY);
      const action = inFiado.has(a.id) ? null : debt ? "debt" as const : !a.holdOpen && dl <= DUE_DAYS ? "renew" as const : null;
      if (!action) return [];
      const pv = action === "renew" ? payPreview(e, actor, a.id) : undefined;
      const slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
      return [{
        assignmentId: a.id, client: a.customerId === r.id ? "" : e.s.customers[a.customerId]?.name ?? "", product: short(e.s.products[a.productId]?.name ?? ""),
        email: acc?.email ?? "", expiresAt: a.customerExpiresAt, daysLeft: dl, price: pv?.price ?? effectivePrice(e, a), action,
        ...(pv ? { to: pv.to } : {}),
        // Ya mandó un comprobante por esta renovación (GaboHub): se aprueba en Aprobación, no se cobra dos veces.
        ...(pv && paidInReview(e, a) ? { blocked: "ya mandó el comprobante de esta renovación: aprobalo en Aprobación" } : pv && !pv.ok ? { blocked: pv.blockers[0] } : {}),
      }];
    });
  const ok = rows.filter((x) => !x.blocked);
  return {
    reseller: { id: r.id, name: r.name }, days: DUE_DAYS, rows, count: ok.length,
    total: ok.reduce((t, x) => t + x.price, 0),
    /** Lo que ya está en su fiado (se cobra en Fiado, no acá). */
    fiadoOwed: owedBy(e, r.id),
  };
}

/** Anota todo junto lo que confirmó el dueño. `total` tiene que ser el mismo que vio (si algo cambió, no anota nada). */
export function resellerPaidAll(e: Engine, actor: Actor, resellerId: Id, input: { ids?: unknown; total?: unknown; idempotencyKey?: unknown }) {
  authorize(actor, "payment.review");
  const key = typeof input.idempotencyKey === "string" && input.idempotencyKey ? `paidall:${resellerId}:${input.idempotencyKey.slice(0, 80)}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const due = resellerDue(e, actor, resellerId);
    const want = Array.isArray(input.ids) ? new Set(input.ids.map(String)) : new Set(due.rows.filter((x) => !x.blocked).map((x) => x.assignmentId));
    const rows = due.rows.filter((x) => want.has(x.assignmentId));
    if (!rows.length) throw new DomainError("VALIDATION", "No hay nada para anotar");
    if (rows.length !== want.size) throw new DomainError("INVALID_STATE", "Algo cambió mientras mirabas: volvé a abrir «Me pagó todo»");
    const blocked = rows.find((x) => x.blocked);
    if (blocked) throw new DomainError("VALIDATION", `${blocked.product}${blocked.client ? ` de ${blocked.client}` : ""}: ${blocked.blocked}`);
    const total: Cents = rows.reduce((t, x) => t + x.price, 0);
    if (Number(input.total) !== total) throw new DomainError("INVALID_STATE", `El total cambió (ahora es Bs ${(total / 100).toFixed(2)}): volvé a abrir «Me pagó todo»`);
    for (const x of rows) {
      if (x.action === "debt") setRentalControl(e, actor, x.assignmentId, { payStatus: "pagado" });
      else payApply(e, actor, x.assignmentId, {});
    }
    e.audit(actor, "reseller.paid_all", "customer", resellerId, { count: rows.length, total, ids: rows.map((x) => x.assignmentId).join(",").slice(0, 300) });
    return { ok: true as const, count: rows.length, total, renewed: rows.filter((x) => x.action === "renew").length, debts: rows.filter((x) => x.action === "debt").length };
  }));
}
