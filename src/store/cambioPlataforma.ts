// «🔀 Cambiar de plataforma» (revisión de 3 meses, 14/11/2026): el cliente pide pasar, por ejemplo, de Netflix a Max.
// En un paso desde el Control: el perfil viejo queda apartado (cuarentena, hay que cambiarle la clave), se le da un perfil
// libre de la otra plataforma y conserva su fecha; si los precios son distintos, se puede ajustar la fecha por la
// diferencia (con aviso de cuánto). Queda en la Auditoría y en la nota del Control. No manda mensajes: el panel arma los
// accesos nuevos para que el dueño los mande.
import type { Actor, Assignment, Cents, Id, Slot } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY } from "./time.js";
import { effectivePrice } from "./admin.js";
import { pubAssignment } from "./orders.js";
import { supplierWarnText } from "./cobrarBien.js";

const fdate = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));
const fbs = (c: Cents) => `Bs ${(c / 100).toLocaleString("es-BO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;
const usedByActive = (e: Engine, slotId: Id) => Object.values(e.s.assignments).some((x) => x.status === "active" && x.slotId === slotId);

/** Perfiles libres de la otra plataforma: primero los que alcanzan con el proveedor (el que vence antes primero). */
function freeSlots(e: Engine, productId: Id, until: number): Slot[] {
  return Object.values(e.s.slots)
    .filter((s) => s.productId === productId && s.status === "available" && e.s.accounts[s.accountId]?.status === "active" && e.s.accounts[s.accountId].supplierExpiresAt > e.now() && !usedByActive(e, s.id))
    .sort((x, y) => {
      const ax = e.s.accounts[x.accountId], ay = e.s.accounts[y.accountId];
      return Number(until > ax.supplierExpiresAt) - Number(until > ay.supplierExpiresAt) || ax.supplierExpiresAt - ay.supplierExpiresAt || x.id.localeCompare(y.id);
    });
}

/** Lo que pagaría por la otra plataforma (sin el precio acordado de la vieja: ese era de la otra). */
const priceOn = (e: Engine, a: Assignment, productId: Id) => effectivePrice(e, { customerId: a.customerId, productId, control: {} });

export function switchPreview(e: Engine, actor: Actor, assignmentId: Id, input: { toProductId?: unknown; toSlotId?: unknown } = {}) {
  authorize(actor, "assignment.replace");
  const a = e.get("assignments", assignmentId);
  const toProductId = String(input.toProductId ?? "");
  const now = e.now();
  const from = e.s.products[a.productId], to = e.s.products[toProductId];
  const blockers: string[] = [], warnings: string[] = [];
  if (a.status !== "active") blockers.push("Este servicio ya no está activo");
  if (!to) blockers.push("Elegí la plataforma nueva");
  else if (to.id === a.productId) blockers.push(`Ya tiene ${to.name}: para otro perfil usá «Cambiar de cuenta»`);
  else if (to.kind === "combo") blockers.push("Los combos se venden aparte: elegí una plataforma");
  const oldPrice = effectivePrice(e, a), newPrice = to ? priceOn(e, a, to.id) : 0;
  const remaining = Math.max(0, a.customerExpiresAt - now);
  // Ajuste por precio: los días que le quedan valen lo mismo en plata (si Max cuesta más, le quedan menos días).
  const adjusted = newPrice > 0 && oldPrice > 0 && newPrice !== oldPrice ? now + Math.round((remaining * oldPrice) / newPrice / 60_000) * 60_000 : a.customerExpiresAt;
  const want = input.toSlotId === undefined || input.toSlotId === null || input.toSlotId === "" ? undefined : String(input.toSlotId);
  const free = to && !blockers.length ? freeSlots(e, to.id, Math.max(a.customerExpiresAt, adjusted)) : [];
  const slot = want ? free.find((s) => s.id === want) : free[0];
  if (!blockers.length && want && !slot) blockers.push("Ese perfil ya no está libre: elegí otro");
  if (!blockers.length && !slot) blockers.push(`No hay perfiles libres de ${to?.name ?? "esa plataforma"}: cargá una cuenta o liberá un perfil`);
  const acc = slot ? e.s.accounts[slot.accountId] : undefined;
  if (acc && a.customerExpiresAt > acc.supplierExpiresAt) warnings.push(supplierWarnText(acc.supplierExpiresAt));
  if (a.control?.price !== undefined || a.control?.priceUsd !== undefined) warnings.push(`El precio acordado (${fbs(oldPrice)}) era de ${from?.name ?? "la otra plataforma"}: desde ahora paga el de ${to?.name ?? "la nueva"} (${fbs(newPrice)}). Si acordaron otro, cambialo en el Control.`);
  const diff = newPrice - oldPrice;
  const days = (t: number) => Math.round((t - now) / DAY);
  return {
    assignmentId: a.id, customer: e.s.customers[a.customerId]?.name ?? "—",
    from: { productId: a.productId, product: from?.name ?? a.productId, email: e.s.accounts[e.s.slots[a.slotId]?.accountId]?.email ?? "", label: e.s.slots[a.slotId]?.label ?? "", price: oldPrice },
    to: { productId: to?.id ?? toProductId, product: to?.name ?? "", price: newPrice, slotId: slot?.id ?? null, email: acc?.email ?? "", label: slot?.label ?? "", supplierExpiresAt: acc?.supplierExpiresAt ?? null },
    options: free.map((s) => ({ slotId: s.id, email: e.s.accounts[s.accountId].email, label: s.label, supplierExpiresAt: e.s.accounts[s.accountId].supplierExpiresAt })),
    expiresAt: a.customerExpiresAt, adjustedExpiresAt: adjusted, priceDiff: diff,
    adjustText: !diff ? "Cuestan lo mismo: conserva la fecha." : diff > 0
      ? `${to?.name} cuesta ${fbs(diff)} más: si no te paga la diferencia, ajustá la fecha al ${fdate(adjusted)} (${days(adjusted)} días en vez de ${days(a.customerExpiresAt)}).`
      : `${to?.name} cuesta ${fbs(-diff)} menos: podés darle hasta el ${fdate(adjusted)} (${days(adjusted)} días en vez de ${days(a.customerExpiresAt)}).`,
    blockers, warnings, ok: blockers.length === 0,
  };
}

/** Hace el cambio. `adjust: "price"` usa la fecha ajustada por la diferencia de precio; si no, conserva la fecha. */
export function switchPlatform(e: Engine, actor: Actor, assignmentId: Id, input: { toProductId?: unknown; toSlotId?: unknown; adjust?: unknown; reason?: unknown; idempotencyKey?: unknown } = {}) {
  authorize(actor, "assignment.replace");
  const key = input.idempotencyKey === undefined || input.idempotencyKey === null ? undefined : String(input.idempotencyKey).slice(0, 80);
  const run = () => {
    const pv = switchPreview(e, actor, assignmentId, { toProductId: input.toProductId, toSlotId: input.toSlotId });
    if (!pv.ok || !pv.to.slotId) throw new DomainError("VALIDATION", pv.blockers[0] ?? "No se puede cambiar de plataforma");
    const a = e.get("assignments", assignmentId);
    const old = e.get("slots", a.slotId), fresh = e.get("slots", pv.to.slotId);
    // Última verificación dentro de la transacción: nunca se vende dos veces un perfil.
    if (fresh.status !== "available" || usedByActive(e, fresh.id)) throw new DomainError("INVALID_STATE", "Ese perfil ya no está libre: volvé a intentar");
    const adjust = input.adjust === "price";
    const before = { productId: a.productId, slotId: a.slotId, expiresAt: a.customerExpiresAt };
    old.status = "quarantined"; // hay que cambiarle la clave antes de volver a venderlo
    delete old.reservedByOrder; delete old.reservedUntil;
    fresh.status = "assigned";
    delete fresh.reservedByOrder; delete fresh.reservedUntil;
    a.productId = pv.to.productId;
    a.slotId = fresh.id;
    if (adjust) a.customerExpiresAt = pv.adjustedExpiresAt;
    a.remindersSent = [];
    const reason = String(input.reason ?? "").trim().slice(0, 120);
    a.history.push({ at: e.now(), by: actor.id, event: "replaced", slotId: fresh.id, note: `cambio de plataforma: ${pv.from.product} → ${pv.to.product} (antes ${before.slotId})${adjust ? ` · fecha ${fdate(before.expiresAt)} → ${fdate(a.customerExpiresAt)}` : ""}${reason ? ` · ${reason}` : ""}` });
    // El precio acordado era de la plataforma vieja: desde ahora paga el de la nueva (se avisó en la vista previa).
    const c = { ...(a.control ?? {}) };
    delete c.price; delete c.priceUsd;
    const tag = `🔀 ${fdate(e.now()).slice(0, 5)}: de ${pv.from.product} a ${pv.to.product}`;
    c.note = `${tag}${c.note ? ` · ${c.note}` : ""}`.slice(0, 300);
    a.control = c;
    e.audit(actor, "assignment.switch_platform", "assignment", a.id, { fromProduct: before.productId, toProduct: a.productId, fromSlot: before.slotId, toSlot: fresh.id, expiresBefore: before.expiresAt, expiresAfter: a.customerExpiresAt, adjust, priceFrom: pv.from.price, priceTo: pv.to.price, ...(reason ? { reason } : {}) });
    return { assignment: pubAssignment(a), from: pv.from, to: { ...pv.to, slotId: fresh.id }, expiresAt: a.customerExpiresAt, adjusted: adjust, warnings: pv.warnings };
  };
  return e.tx(() => (key ? e.idempotent(`switch:${assignmentId}:${key}`, run) : run()));
}
