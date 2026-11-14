// Cobros del día a día (14/11/2026), sin cambiar la regla de cuándo se corta un vencido (closeExpired: vencimiento + 2 días).
//   1) «Me pagó» de un servicio que ya se cortó solo por vencido (hasta 30 días después): se reactiva y se anota el
//      cobro. Si su perfil ya no está libre (lo tiene otro cliente o se retiró), se ofrece OTRO perfil libre de la misma
//      plataforma; si no hay, se avisa claro y no se guarda nada. Nunca se vende dos veces un perfil.
//   2) «💳 Renovar proveedor y anotar»: cuando «Me pagó» choca con la fecha del proveedor, anota «Pagué la renovación»
//      de la cuenta (finance.ts, la misma función de Cuentas) y después el cobro, todo junto (si algo falla, no queda nada a medias).
import type { Actor, Assignment, Cents, Id, Slot } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY } from "./time.js";
import { sellBlock } from "./vendible.js";
import { effectivePrice, payUsdOf, payerOf } from "./admin.js";
import { payAccountRenewal } from "./finance.js";
import { payApply, payPreview } from "./cobro.js";
import { resellerOf } from "./myReseller.js";
import { supplierWarnText } from "./cobrarBien.js";

/** Hasta cuántos días después del corte automático se puede anotar «Me pagó» y reactivar. */
export const REACTIVATE_DAYS = 30;

/** Cuándo se cortó solo por vencido (la tarea periódica deja la nota «vencido»). */
function closedAt(a: Assignment): number | undefined {
  if (a.status !== "revoked" || a.trial) return undefined;
  const ev = [...a.history].reverse().find((h) => h.event === "revoked");
  return ev && ev.note === "vencido" ? ev.at : undefined;
}
/** El cliente ya volvió a comprar esa plataforma después del corte (no hace falta reactivar). */
function superseded(e: Engine, a: Assignment, at: number): boolean {
  return Object.values(e.s.assignments).some((x) => x.id !== a.id && x.status === "active" && x.customerId === a.customerId && x.productId === a.productId && x.startsAt >= at);
}
const usedByActive = (e: Engine, slotId: Id) => Object.values(e.s.assignments).some((x) => x.status === "active" && x.slotId === slotId);

export interface ReactivableItem {
  assignmentId: Id; customerId: Id; name: string; phone: string; payerName: string; viaReseller: boolean;
  product: string; email: string; profile: string;
  expiredAt: number; closedAt: number; price: Cents; priceUsd?: Cents;
}

/** Servicios que se cortaron solos en los últimos 30 días y que todavía se pueden reactivar con «Me pagó». */
export function reactivableList(e: Engine, actor: Actor): ReactivableItem[] {
  authorize(actor, "payment.review");
  const now = e.now(), out: ReactivableItem[] = [];
  for (const a of Object.values(e.s.assignments)) {
    const at = closedAt(a);
    if (at === undefined || now - at > REACTIVATE_DAYS * DAY || superseded(e, a, at)) continue;
    const slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
    const c = e.s.customers[a.customerId], payer = payerOf(e, a.customerId) ?? c, usd = payUsdOf(e, a);
    out.push({
      assignmentId: a.id, customerId: a.customerId, name: c?.name ?? "Sin nombre", phone: payer?.phone ?? c?.phone ?? "", payerName: payer?.name ?? c?.name ?? "",
      viaReseller: !!resellerOf(e, a.customerId), product: e.s.products[a.productId]?.name ?? a.productId, email: acc?.email ?? "", profile: slot?.label ?? "",
      expiredAt: a.customerExpiresAt, closedAt: at, price: effectivePrice(e, a), ...(usd !== undefined ? { priceUsd: usd } : {}),
    });
  }
  return out.sort((x, y) => y.closedAt - x.closedAt || x.name.localeCompare(y.name));
}

export interface SlotOption { slotId: Id; email: string; label: string; supplierExpiresAt: number }

export function reactivatePreview(e: Engine, actor: Actor, assignmentId: Id, input: { toSlotId?: unknown } = {}) {
  authorize(actor, "payment.review");
  const a = e.get("assignments", assignmentId);
  const now = e.now(), prod = e.s.products[a.productId];
  const days = prod?.durationDays ?? 30, from = now, to = now + days * DAY;
  const at = closedAt(a);
  const blockers: string[] = [], warnings: string[] = [];
  if (a.status === "active") blockers.push("Este servicio sigue activo: usá «Me pagó» de siempre");
  else if (at === undefined) blockers.push("Este servicio no se cortó por vencido: si vuelve, hacé una venta nueva");
  else if (now - at > REACTIVATE_DAYS * DAY) blockers.push(`Se cortó hace más de ${REACTIVATE_DAYS} días: hacé una venta nueva`);
  else if (superseded(e, a, at)) blockers.push(`Ya tiene otro ${prod?.name ?? "servicio"} activo`);

  // ¿Su mismo perfil sigue libre? (apartado o libre, sin nadie adentro y con la cuenta activa). La fecha del proveedor
  // ya no frena (decisión (b), 14/11): si no alcanza, se reactiva igual con el aviso «Renová el proveedor antes del dd/mm».
  const old = e.s.slots[a.slotId], oldAcc = old ? e.s.accounts[old.accountId] : undefined;
  const okSlot = (s: Slot | undefined, statuses: Slot["status"][]) => {
    const acc = s ? e.s.accounts[s.accountId] : undefined;
    return !!s && !!acc && acc.status === "active" && !sellBlock(acc) && s.productId === a.productId && statuses.includes(s.status) && !usedByActive(e, s.id);
  };
  const covers = (slotId: Id) => { const acc = e.s.accounts[e.s.slots[slotId]?.accountId]; return !!acc && to <= acc.supplierExpiresAt; };
  const sameFree = okSlot(old, ["quarantined", "available"]);
  // Otros perfiles libres (solo «libres», no apartados de otros clientes) de la misma plataforma: primero los que alcanzan
  // con el proveedor (el que vence antes primero), después los que no.
  const options: SlotOption[] = Object.values(e.s.slots)
    .filter((s) => s.id !== a.slotId && okSlot(s, ["available"]))
    .map((s) => ({ slotId: s.id, email: e.s.accounts[s.accountId].email, label: s.label, supplierExpiresAt: e.s.accounts[s.accountId].supplierExpiresAt }))
    .sort((x, y) => Number(to > x.supplierExpiresAt) - Number(to > y.supplierExpiresAt) || x.supplierExpiresAt - y.supplierExpiresAt || x.slotId.localeCompare(y.slotId));
  const want = input.toSlotId === undefined || input.toSlotId === null || input.toSlotId === "" ? undefined : String(input.toSlotId);
  let chosen: { slotId: Id; email: string; label: string } | undefined;
  if (want) {
    if (want === a.slotId && sameFree) chosen = { slotId: old!.id, email: oldAcc!.email, label: old!.label };
    else chosen = options.find((o) => o.slotId === want);
    if (!chosen) blockers.push("Ese perfil ya no está libre: elegí otro");
  } else chosen = sameFree ? { slotId: old!.id, email: oldAcc!.email, label: old!.label } : options[0];
  const mode = !chosen ? "none" : chosen.slotId === a.slotId ? "same" : "other";
  const why = !old || !oldAcc || oldAcc.status !== "active" ? "la cuenta ya no está activa"
    : usedByActive(e, old.id) || old.status === "assigned" || old.status === "reserved" ? "ya lo tiene otro cliente"
    : old.status === "retired" ? "se retiró"
    : "no está libre";
  if (!blockers.length && mode === "none") blockers.push(`Su perfil anterior (${oldAcc?.email ?? "?"} · ${old?.label ?? "?"}) ${why} y no hay otro perfil libre de ${prod?.name ?? "esa plataforma"}. Cargá una cuenta o liberá un perfil, y volvé a tocar «Me pagó».`);
  // Decisión (b): el perfil elegido no alcanza con el proveedor → se reactiva igual, con aviso, y queda en «Proveedores por renovar».
  const chosenAcc = chosen ? e.s.accounts[e.s.slots[chosen.slotId]?.accountId] : undefined;
  const supplierWarn = !blockers.length && chosen && chosenAcc && !covers(chosen.slotId) ? { supplierExpiresAt: chosenAcc.supplierExpiresAt, text: supplierWarnText(chosenAcc.supplierExpiresAt) } : undefined;
  if (!blockers.length && mode === "other") warnings.push(`Su perfil anterior (${oldAcc?.email ?? "?"} · ${old?.label ?? "?"}) ${why}: va a otro perfil. Después mandale los accesos nuevos.`);
  if (!blockers.length && mode === "same" && oldAcc?.passwordChangedAt && at !== undefined && oldAcc.passwordChangedAt > at) warnings.push("Cambiaste la clave de esa cuenta después del corte: mandale los accesos de nuevo.");
  const c = e.s.customers[a.customerId], payer = payerOf(e, a.customerId) ?? c, usd = payUsdOf(e, a), price = effectivePrice(e, a);
  if (!(price > 0)) warnings.push("No hay precio acordado ni de lista: el monto quedaría en Bs 0");
  return {
    assignmentId: a.id,
    customer: { id: c?.id ?? a.customerId, name: c?.name ?? "—", phone: c?.phone ?? "" },
    payer: { id: payer?.id ?? a.customerId, name: payer?.name ?? "—", isReseller: payer?.kind === "reseller" },
    product: prod?.name ?? a.productId, price, ...(usd !== undefined ? { priceUsd: usd } : {}),
    days, from, to, expiredAt: a.customerExpiresAt, closedAt: at ?? null,
    previous: { slotId: a.slotId, email: oldAcc?.email ?? "", label: old?.label ?? "", free: sameFree },
    mode, slot: chosen ?? null, options,
    blockers, warnings, ok: blockers.length === 0, ...(supplierWarn ? { supplierWarn } : {}),
  };
}

/**
 * Reactiva un servicio cortado por vencido y anota el cobro (1 período desde hoy). Vuelve a su perfil si sigue libre;
 * si no, al perfil elegido (o al primero libre de la misma plataforma). Idempotente por `idempotencyKey`.
 */
export function reactivate(e: Engine, actor: Actor, assignmentId: Id, input: { toSlotId?: unknown; price?: unknown; idempotencyKey?: unknown } = {}) {
  authorize(actor, "payment.review");
  authorize(actor, "assignment.renew_any");
  const key = input.idempotencyKey === undefined || input.idempotencyKey === null ? undefined : String(input.idempotencyKey).slice(0, 80);
  const run = () => {
    const pv = reactivatePreview(e, actor, assignmentId, { toSlotId: input.toSlotId });
    if (!pv.ok || !pv.slot) throw new DomainError("VALIDATION", pv.blockers[0] ?? "No se puede reactivar");
    const a = e.get("assignments", assignmentId);
    const slot = e.get("slots", pv.slot.slotId);
    // Última verificación dentro de la transacción: el perfil no puede estar ocupado (nunca se vende dos veces).
    if (usedByActive(e, slot.id) || !["available", "quarantined"].includes(slot.status)) throw new DomainError("INVALID_STATE", "Ese perfil ya no está libre: volvé a tocar «Me pagó»");
    const prevSlot = a.slotId;
    slot.status = "assigned";
    delete slot.reservedByOrder; delete slot.reservedUntil;
    a.slotId = slot.id;
    a.status = "active";
    a.customerExpiresAt = e.now(); // el período nuevo arranca hoy
    delete a.holdOpen;
    a.history.push({ at: e.now(), by: actor.id, event: prevSlot === slot.id ? "renewed" : "replaced", slotId: slot.id, note: `reactivado tras el corte automático${prevSlot === slot.id ? "" : " (su perfil anterior no estaba libre)"}` });
    e.audit(actor, "secretary.reactivated", "assignment", a.id, { fromSlot: prevSlot, toSlot: slot.id, closedAt: pv.closedAt });
    const paid = payApply(e, actor, a.id, { periods: 1, price: input.price });
    return { ...paid, reactivated: { slotId: slot.id, changedSlot: prevSlot !== slot.id, email: pv.slot.email, label: pv.slot.label } };
  };
  return e.tx(() => (key ? e.idempotent(`secreact:${assignmentId}:${key}`, run) : run()));
}

/**
 * «💳 Renovar proveedor y anotar»: anota «Pagué la renovación» de la cuenta por los meses que hacen falta (la misma
 * función que Cuentas) y después «Me pagó». Si el panel mostró otros meses, frena (los datos cambiaron).
 */
export function payWithSupplier(e: Engine, actor: Actor, assignmentId: Id, input: { months?: unknown; price?: unknown; idempotencyKey?: unknown; confirmOther?: unknown } = {}) {
  authorize(actor, "payment.review");
  authorize(actor, "inventory.manage");
  const key = input.idempotencyKey === undefined || input.idempotencyKey === null ? undefined : String(input.idempotencyKey).slice(0, 80);
  const run = () => {
    const pv = payPreview(e, actor, assignmentId, { periods: 1 });
    const hint = pv.supplierRenew;
    if (hint && pv.doubleCharge && input.confirmOther !== true) throw new DomainError("DOUBLE_CHARGE", pv.doubleCharge.text);
    if (!hint) throw new DomainError("VALIDATION", pv.ok ? "La cuenta alcanza con el proveedor: usá «Confirmar: me pagó»" : pv.blockers[0]);
    if (input.months !== undefined && input.months !== null && Number(input.months) !== hint.months) throw new DomainError("VALIDATION", "Los datos cambiaron: cerrá y volvé a tocar «Me pagó»");
    const sup = payAccountRenewal(e, actor, hint.accountId, { months: hint.months });
    const paid = payApply(e, actor, assignmentId, { periods: 1, price: input.price, confirmOther: input.confirmOther });
    return { ...paid, supplier: { accountId: hint.accountId, email: hint.email, months: hint.months, amount: sup.expense.amount, supplierExpiresAt: sup.supplierExpiresAt } };
  };
  return e.tx(() => (key ? e.idempotent(`secsup:${assignmentId}:${key}`, run) : run()));
}
