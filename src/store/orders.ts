// Ventas, pagos, asignaciones, renovaciones y reemplazos.
//
// Flujo de venta:
//   createOrder ─┬─ qr ──────► awaiting_payment ─ submitEvidence ─► payment_review ─ approvePayment ─► fulfilled
//                │                     │ (vence la reserva)                    └─ rejectPayment ─► rejected
//                │                     └────────────────────────► expired
//                ├─ balance ─► (débito del saldo) ─► fulfilled
//                └─ cash (solo staff) ─────────────► fulfilled
// Un comprobante NO es un pago: solo un revisor con `payment.review` confirma la referencia bancaria.
import type { Actor, Assignment, Cents, Id, Order, OrderItem, PaymentMethod, ReminderSettings, StaffAlertSettings } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY, HOUR } from "./time.js";
import { authorize, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { canActFor, priceFor } from "./catalog.js";
import { releaseSlots, reserveSlots } from "./inventory.js";
import { balance, post } from "./wallet.js";
import { queue, queueStaff, staffAlertSettings } from "./notify.js";

const fmt = (c: Cents) => `Bs ${(c / 100).toFixed(2)}`;
const fdate = (t: number) => new Date(t).toISOString().slice(0, 10);

function requireActFor(e: Engine, actor: Actor, customerId: Id) {
  if (!canActFor(e, actor, customerId)) throw new DomainError("FORBIDDEN", "No podés operar sobre ese cliente");
}

/** El revendedor que vende a su cliente paga con su saldo y a su precio. */
function payerFor(e: Engine, actor: Actor, customerId: Id): Id {
  if (actor.role === "reseller" && actor.customerId && actor.customerId !== customerId) return actor.customerId;
  return customerId;
}

export interface CreateOrderInput {
  customerId: Id;
  items: { productId: Id; qty: number }[];
  paymentMethod: PaymentMethod;
  channel?: Order["channel"];
  idempotencyKey?: string;
}

export function createOrder(e: Engine, actor: Actor, input: CreateOrderInput): Order {
  if (isStaff(actor)) authorize(actor, "order.create_any");
  else authorize(actor, "order.create_self");
  requireActFor(e, actor, input.customerId);
  if (input.paymentMethod === "cash" && !isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo el staff registra pagos en efectivo");
  if (!input.items.length || input.items.length > 20) throw new DomainError("VALIDATION", "El pedido necesita entre 1 y 20 ítems");
  for (const it of input.items) {
    if (!Number.isInteger(it.qty) || it.qty < 1 || it.qty > 10) throw new DomainError("VALIDATION", "Cantidad inválida (1 a 10)");
  }
  const key = input.idempotencyKey ? `order:${actor.id}:${input.idempotencyKey}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const payerId = payerFor(e, actor, input.customerId);
    const id = e.id("ord");
    const items: OrderItem[] = input.items.map((it) => {
      const p = e.get("products", it.productId);
      if (!p.published && !isStaff(actor)) throw new DomainError("NOT_FOUND", "Producto no disponible");
      return { productId: it.productId, qty: it.qty, unitPrice: priceFor(e, payerId, it.productId) };
    });
    const reserved = items.flatMap((it) => reserveSlots(e, it.productId, it.qty, id));
    const now = e.now();
    const order: Order = {
      id, kind: "sale", customerId: input.customerId, payerId, createdBy: actor.id,
      channel: input.channel ?? (isStaff(actor) ? "panel" : actor.role === "reseller" ? "reseller" : "store"),
      items, total: items.reduce((s, it) => s + it.unitPrice * it.qty, 0), status: "awaiting_payment",
      paymentMethod: input.paymentMethod, reservedSlotIds: reserved.map((s) => s.id), assignmentIds: [], createdAt: now, updatedAt: now,
    };
    e.s.orders[id] = order;
    e.audit(actor, "order.create", "order", id, { total: order.total, method: order.paymentMethod, slots: reserved.length });
    if (input.paymentMethod === "balance") {
      post(e, actor, payerId, -order.total, "purchase", id);
      fulfill(e, actor, order);
    } else if (input.paymentMethod === "cash") {
      order.approvedBy = actor.id;
      fulfill(e, actor, order);
    } else {
      queue(e, order.customerId, "order_received", { name: e.s.customers[order.customerId].name, order: id, total: fmt(order.total) });
    }
    return structuredClone(order);
  }));
}

/** Entrega el pedido según su tipo. Debe correr dentro de `tx`. */
function fulfill(e: Engine, actor: Actor, order: Order): void {
  const now = e.now();
  if (order.kind === "sale") {
    for (const slotId of order.reservedSlotIds) {
      const slot = e.s.slots[slotId];
      if (slot.status !== "reserved" || slot.reservedByOrder !== order.id) throw new DomainError("INVALID_STATE", `El perfil ${slotId} ya no está reservado para este pedido`);
      slot.status = "assigned";
      delete slot.reservedUntil;
      const days = e.s.products[slot.productId].durationDays;
      const a: Assignment = {
        id: e.id("asg"), slotId, productId: slot.productId, customerId: order.customerId, orderId: order.id,
        startsAt: now, customerExpiresAt: now + days * DAY, status: "active",
        history: [{ at: now, by: actor.id, event: "assigned", slotId }],
      };
      e.s.assignments[a.id] = a;
      order.assignmentIds.push(a.id);
    }
    queue(e, order.customerId, "order_confirmed", { order: order.id });
  } else if (order.kind === "renewal") {
    const r = order.renewal!;
    extend(e, actor, r.assignmentId, r.periods, false);
  } else {
    post(e, actor, order.customerId, order.topupAmount!, "topup", order.id);
    queue(e, order.customerId, "topup_approved", { amount: fmt(order.topupAmount!), balance: fmt(balance(e, order.customerId)) });
  }
  order.status = "fulfilled";
  order.updatedAt = now;
  e.audit(actor, "order.fulfill", "order", order.id, { kind: order.kind, assignments: order.assignmentIds.length });
}

function alertPayment(e: Engine, o: Order): void {
  if (!staffAlertSettings(e).payments) return;
  queueStaff(e, "staff_payment_review", { order: o.id, name: e.s.customers[o.customerId]?.name ?? "cliente", total: fmt(o.total) });
}

export function submitEvidence(e: Engine, actor: Actor, orderId: Id, ev: { fileRef: string; declaredReference: string }): Order {
  return e.tx(() => {
    const o = e.get("orders", orderId);
    requireActFor(e, actor, o.customerId);
    if (o.paymentMethod !== "qr") throw new DomainError("INVALID_STATE", "Este pedido no se paga con comprobante");
    if (o.status !== "awaiting_payment" && o.status !== "payment_review") throw new DomainError("INVALID_STATE", `No se puede adjuntar comprobante en estado ${o.status}`);
    if (!ev.fileRef?.trim() || !ev.declaredReference?.trim()) throw new DomainError("VALIDATION", "Falta el archivo o el número de operación");
    if (o.status === "awaiting_payment" && !isStaff(actor)) alertPayment(e, o);
    o.evidence = { fileRef: ev.fileRef, declaredReference: ev.declaredReference.trim(), submittedAt: e.now() };
    o.status = "payment_review";
    o.updatedAt = e.now();
    // Mientras se revisa, la reserva se mantiene (no se vende a otro).
    const hold = e.now() + e.opts.reviewHoldHours * HOUR;
    for (const id of o.reservedSlotIds) if (e.s.slots[id].reservedByOrder === o.id) e.s.slots[id].reservedUntil = hold;
    e.audit(actor, "order.evidence", "order", o.id, { declaredReference: o.evidence.declaredReference });
    return structuredClone(o);
  });
}

export function approvePayment(e: Engine, actor: Actor, orderId: Id, input: { confirmedReference: string; idempotencyKey?: string }): Order {
  authorize(actor, "payment.review");
  const key = input.idempotencyKey ? `approve:${orderId}:${input.idempotencyKey}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const o = e.get("orders", orderId);
    if (o.status === "fulfilled") throw new DomainError("ALREADY_PROCESSED", "El pedido ya fue aprobado");
    if (o.status !== "payment_review") throw new DomainError("INVALID_STATE", `Solo se aprueban pedidos en revisión (estado: ${o.status})`);
    if (actor.customerId && actor.customerId === o.customerId) throw new DomainError("FORBIDDEN", "No podés aprobar tu propio pedido");
    const ref = input.confirmedReference?.trim();
    if (!ref) throw new DomainError("VALIDATION", "Indicá la referencia bancaria verificada");
    const reused = Object.values(e.s.orders).find((x) => x.id !== o.id && x.confirmedReference === ref);
    if (reused) throw new DomainError("ALREADY_PROCESSED", `La referencia ${ref} ya se usó en el pedido ${reused.id}`);
    // Si la reserva se liberó, se intenta reservar de nuevo antes de entregar.
    if (o.kind === "sale" && o.reservedSlotIds.some((id) => e.s.slots[id].reservedByOrder !== o.id || e.s.slots[id].status !== "reserved")) {
      releaseSlots(e, o.reservedSlotIds.filter((id) => e.s.slots[id].reservedByOrder === o.id));
      o.reservedSlotIds = o.items.flatMap((it) => reserveSlots(e, it.productId, it.qty, o.id)).map((s) => s.id);
    }
    o.confirmedReference = ref;
    o.approvedBy = actor.id;
    e.audit(actor, "payment.approve", "order", o.id, { confirmedReference: ref, total: o.total });
    fulfill(e, actor, o);
    return structuredClone(o);
  }));
}

export function rejectPayment(e: Engine, actor: Actor, orderId: Id, reason: string): Order {
  authorize(actor, "payment.review");
  if (!reason?.trim()) throw new DomainError("VALIDATION", "Indicá el motivo del rechazo");
  return e.tx(() => {
    const o = e.get("orders", orderId);
    if (o.status !== "payment_review" && o.status !== "awaiting_payment") throw new DomainError("INVALID_STATE", `No se puede rechazar en estado ${o.status}`);
    releaseSlots(e, o.reservedSlotIds);
    o.status = "rejected";
    o.updatedAt = e.now();
    queue(e, o.customerId, "payment_rejected", { order: o.id });
    e.audit(actor, "payment.reject", "order", o.id, { reason });
    return structuredClone(o);
  });
}

export function cancelOrder(e: Engine, actor: Actor, orderId: Id): Order {
  return e.tx(() => {
    const o = e.get("orders", orderId);
    requireActFor(e, actor, o.customerId);
    if (o.status !== "awaiting_payment") throw new DomainError("INVALID_STATE", "Solo se cancelan pedidos sin pago enviado");
    releaseSlots(e, o.reservedSlotIds);
    o.status = "cancelled";
    o.updatedAt = e.now();
    e.audit(actor, "order.cancel", "order", o.id);
    return structuredClone(o);
  });
}

/** Libera reservas vencidas de pedidos que nunca enviaron comprobante. Ejecutar periódicamente. */
export function expireReservations(e: Engine, actor: Actor): number {
  if (actor.role !== "system") authorize(actor, "payment.review");
  return e.tx(() => {
    let n = 0;
    for (const o of Object.values(e.s.orders)) {
      if (o.status !== "awaiting_payment") continue;
      const late = o.reservedSlotIds.some((id) => (e.s.slots[id].reservedUntil ?? Infinity) < e.now());
      if (!late) continue;
      releaseSlots(e, o.reservedSlotIds);
      o.status = "expired";
      o.updatedAt = e.now();
      e.audit(actor, "order.expire", "order", o.id);
      n++;
    }
    return n;
  });
}

/* ---------------- Renovaciones ---------------- */

function extend(e: Engine, actor: Actor, assignmentId: Id, periods: number, allowBeyondSupplier: boolean): Assignment {
  const a = e.get("assignments", assignmentId);
  if (a.status !== "active") throw new DomainError("INVALID_STATE", "Solo se renuevan servicios activos");
  const days = e.s.products[a.productId].durationDays * periods;
  const next = Math.max(a.customerExpiresAt, e.now()) + days * DAY;
  const acc = e.s.accounts[e.s.slots[a.slotId].accountId];
  if (next > acc.supplierExpiresAt && !allowBeyondSupplier) {
    throw new DomainError("SUPPLIER_EXPIRY_EXCEEDED", `La cuenta vence con el proveedor el ${fdate(acc.supplierExpiresAt)}; renová con el proveedor o reemplazá el perfil`);
  }
  a.customerExpiresAt = next; // supplierExpiresAt NO se toca
  a.history.push({ at: e.now(), by: actor.id, event: "renewed", slotId: a.slotId, note: `+${days} días` });
  queue(e, a.customerId, "renewal_confirmed", { product: e.s.products[a.productId].name, date: fdate(next) });
  return a;
}

export interface RenewInput {
  periods?: number;
  paymentMethod: PaymentMethod;
  /** Solo el dueño: permite que el cliente venza después que la cuenta del proveedor. */
  allowBeyondSupplier?: boolean;
  idempotencyKey?: string;
}

export function renew(e: Engine, actor: Actor, assignmentId: Id, input: RenewInput): { order: Order; assignment: Assignment } {
  const periods = input.periods ?? 1;
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) throw new DomainError("VALIDATION", "Períodos inválidos (1 a 12)");
  if (input.allowBeyondSupplier) authorize(actor, "assignment.renew_beyond_supplier");
  if (input.paymentMethod === "cash" && !isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo el staff registra pagos en efectivo");
  const key = input.idempotencyKey ? `renew:${assignmentId}:${input.idempotencyKey}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const a = e.get("assignments", assignmentId);
    if (isStaff(actor)) authorize(actor, "assignment.renew_any");
    else requireActFor(e, actor, a.customerId);
    const payerId = payerFor(e, actor, a.customerId);
    const unit = priceFor(e, payerId, a.productId);
    const now = e.now();
    const order: Order = {
      id: e.id("ord"), kind: "renewal", customerId: a.customerId, payerId, createdBy: actor.id,
      channel: isStaff(actor) ? "panel" : actor.role === "reseller" ? "reseller" : "store",
      items: [{ productId: a.productId, qty: periods, unitPrice: unit }], total: unit * periods,
      status: "awaiting_payment", paymentMethod: input.paymentMethod, reservedSlotIds: [], assignmentIds: [a.id],
      renewal: { assignmentId: a.id, periods }, createdAt: now, updatedAt: now,
    };
    e.s.orders[order.id] = order;
    e.audit(actor, "renewal.create", "order", order.id, { assignmentId: a.id, periods, method: input.paymentMethod });
    if (input.paymentMethod === "qr") {
      // Se valida ya contra el proveedor para no cobrar algo que no se puede entregar.
      const acc = e.s.accounts[e.s.slots[a.slotId].accountId];
      const next = Math.max(a.customerExpiresAt, now) + e.s.products[a.productId].durationDays * periods * DAY;
      if (next > acc.supplierExpiresAt && !input.allowBeyondSupplier) throw new DomainError("SUPPLIER_EXPIRY_EXCEEDED", "La cuenta del proveedor vence antes; no se puede renovar este perfil");
      queue(e, a.customerId, "order_received", { name: e.s.customers[a.customerId].name, order: order.id, total: fmt(order.total) });
    } else {
      if (input.paymentMethod === "balance") post(e, actor, payerId, -order.total, "renewal", order.id);
      extend(e, actor, a.id, periods, !!input.allowBeyondSupplier);
      order.status = "fulfilled";
      order.approvedBy = input.paymentMethod === "cash" ? actor.id : undefined;
    }
    return { order: structuredClone(order), assignment: structuredClone(e.s.assignments[a.id]) };
  }));
}

/** Renovación masiva (staff). Cada ítem es independiente: un error no frena a los demás. */
export function renewMany(e: Engine, actor: Actor, assignmentIds: Id[], input: Omit<RenewInput, "idempotencyKey"> & { batchKey?: string }) {
  authorize(actor, "assignment.renew_any");
  return assignmentIds.map((id) => {
    try {
      const r = renew(e, actor, id, { ...input, idempotencyKey: input.batchKey ? `${input.batchKey}:${id}` : undefined });
      return { assignmentId: id, ok: true as const, expiresAt: r.assignment.customerExpiresAt };
    } catch (err) {
      return { assignmentId: id, ok: false as const, code: (err as DomainError).code, error: (err as Error).message };
    }
  });
}

/* ---------------- Reemplazos ---------------- */

export interface ReplaceInput {
  reason: string;
  /** Qué hacer con el perfil viejo. Por defecto "quarantined" (no se revende hasta revisarlo). */
  oldSlot?: "quarantined" | "available" | "retired";
  /** Buscar el reemplazo en OTRA cuenta (p. ej. si la cuenta se cayó). */
  otherAccount?: boolean;
}

export function replaceAssignment(e: Engine, actor: Actor, assignmentId: Id, input: ReplaceInput): Assignment {
  authorize(actor, "assignment.replace");
  if (!input.reason?.trim()) throw new DomainError("VALIDATION", "Indicá el motivo del reemplazo");
  return e.tx(() => {
    const a = e.get("assignments", assignmentId);
    if (a.status !== "active") throw new DomainError("INVALID_STATE", "Solo se reemplazan servicios activos");
    const old = e.get("slots", a.slotId);
    const [fresh] = reserveSlots(e, a.productId, 1, `replace:${a.id}`, input.otherAccount ? [old.accountId] : []);
    fresh.status = "assigned";
    delete fresh.reservedUntil;
    old.status = input.oldSlot ?? "quarantined";
    delete old.reservedByOrder;
    a.slotId = fresh.id; // el vencimiento del cliente se conserva
    a.history.push({ at: e.now(), by: actor.id, event: "replaced", slotId: fresh.id, note: `${input.reason} (antes ${old.id})` });
    queue(e, a.customerId, "replacement_done", { product: e.s.products[a.productId].name });
    e.audit(actor, "assignment.replace", "assignment", a.id, { from: old.id, to: fresh.id, reason: input.reason });
    return structuredClone(a);
  });
}

/**
 * Transfiere un servicio activo a otro cliente (mismo perfil, misma fecha de vencimiento).
 * Útil cuando el perfil lo usa otra persona o se cargó al cliente equivocado.
 */
export function transferAssignment(e: Engine, actor: Actor, assignmentId: Id, toCustomerId: Id, reason: string): Assignment {
  authorize(actor, "assignment.replace");
  if (!reason?.trim()) throw new DomainError("VALIDATION", "Indicá el motivo de la transferencia");
  return e.tx(() => {
    const a = e.get("assignments", assignmentId);
    if (a.status !== "active") throw new DomainError("INVALID_STATE", "Solo se transfieren servicios activos");
    const to = e.get("customers", toCustomerId);
    if (to.id === a.customerId) throw new DomainError("VALIDATION", "El servicio ya es de ese cliente");
    const from = e.s.customers[a.customerId];
    a.customerId = to.id;
    a.history.push({ at: e.now(), by: actor.id, event: "transferred", slotId: a.slotId, note: `de ${from?.name ?? "?"} a ${to.name}: ${reason.trim()}` });
    queue(e, to.id, "access_transferred", { product: e.s.products[a.productId].name, date: fdate(a.customerExpiresAt) });
    e.audit(actor, "assignment.transfer", "assignment", a.id, { from: from?.id, to: to.id, reason });
    return structuredClone(a);
  });
}

/** Cuenta caída: mueve a todos sus clientes a otras cuentas y la retira si quedó vacía. */
export function replaceAccount(e: Engine, actor: Actor, accountId: Id, reason: string) {
  authorize(actor, "assignment.replace");
  const acc = e.get("accounts", accountId);
  const slotIds = new Set(Object.values(e.s.slots).filter((s) => s.accountId === acc.id).map((s) => s.id));
  const targets = Object.values(e.s.assignments).filter((a) => a.status === "active" && slotIds.has(a.slotId)).map((a) => a.id);
  const results = targets.map((id) => {
    try {
      return { assignmentId: id, ok: true as const, slotId: replaceAssignment(e, actor, id, { reason, oldSlot: "retired", otherAccount: true }).slotId };
    } catch (err) {
      return { assignmentId: id, ok: false as const, code: (err as DomainError).code, error: (err as Error).message };
    }
  });
  const retired = results.every((r) => r.ok);
  if (retired) {
    e.tx(() => {
      e.s.accounts[accountId].status = "retired";
      for (const id of slotIds) if (e.s.slots[id].status === "available") e.s.slots[id].status = "retired";
      e.audit(actor, "account.retire", "account", accountId, { reason, moved: results.length });
    });
  }
  return { retired, results };
}

/** Cierra servicios vencidos (+ días de gracia) y pone el perfil en cuarentena para cambiar la clave. */
export function closeExpired(e: Engine, actor: Actor, graceDays = 2): number {
  if (actor.role !== "system") authorize(actor, "assignment.replace");
  return e.tx(() => {
    let n = 0;
    for (const a of Object.values(e.s.assignments)) {
      if (a.status !== "active" || a.customerExpiresAt + graceDays * DAY > e.now()) continue;
      a.status = "revoked";
      a.history.push({ at: e.now(), by: actor.id, event: "revoked", slotId: a.slotId, note: "vencido" });
      e.s.slots[a.slotId].status = "quarantined";
      e.audit(actor, "assignment.expire", "assignment", a.id);
      n++;
    }
    return n;
  });
}

/** Encola recordatorios para servicios que vencen dentro de `withinDays` (máx. uno por día). */
export function queueExpiryReminders(e: Engine, actor: Actor, withinDays = 3): number {
  if (actor.role !== "system") authorize(actor, "assignment.renew_any");
  return e.tx(() => {
    let n = 0;
    for (const a of Object.values(e.s.assignments)) {
      if (a.status !== "active") continue;
      const left = a.customerExpiresAt - e.now();
      if (left > withinDays * DAY) continue;
      if (a.lastReminderAt && e.now() - a.lastReminderAt < DAY) continue;
      const c = e.s.customers[a.customerId];
      queue(e, a.customerId, "expiry_reminder", { name: c.name, product: e.s.products[a.productId].name, date: fdate(a.customerExpiresAt) });
      a.lastReminderAt = e.now();
      n++;
    }
    if (n) e.audit(actor, "reminders.queue", "assignment", "*", { count: n });
    return n;
  });
}

/* ---------------- Recordatorios automáticos ---------------- */

export const DEFAULT_REMINDERS: ReminderSettings = { enabled: true, daysBefore: [2], fromHour: 9, toHour: 20, timeZone: "America/La_Paz" };
export const reminderSettings = (e: Engine): ReminderSettings => ({ ...DEFAULT_REMINDERS, ...(e.s.settings.reminders ?? {}) });

function localHour(t: number, timeZone: string): number {
  try {
    const h = new Intl.DateTimeFormat("en-US", { timeZone, hour: "numeric", hourCycle: "h23" }).formatToParts(new Date(t)).find((p) => p.type === "hour")?.value;
    return Number(h ?? new Date(t).getHours());
  } catch {
    return new Date(t).getHours();
  }
}

/**
 * Encola un recordatorio por servicio cuando le faltan exactamente los días configurados
 * (por defecto 2), una sola vez por cada punto y solo en el horario permitido.
 * Si el cliente renueva, la fecha cambia y vuelve a recibir el aviso en el próximo vencimiento.
 */
export function autoReminders(e: Engine, actor: Actor): number {
  if (actor.role !== "system") authorize(actor, "assignment.renew_any");
  const cfg = reminderSettings(e);
  if (!cfg.enabled || !cfg.daysBefore.length) return 0;
  const h = localHour(e.now(), cfg.timeZone);
  if (h < cfg.fromHour || h >= cfg.toHour) return 0;
  return e.tx(() => {
    let n = 0;
    for (const a of Object.values(e.s.assignments)) {
      if (a.status !== "active") continue;
      const days = Math.ceil((a.customerExpiresAt - e.now()) / DAY);
      if (days < 0 || !cfg.daysBefore.includes(days)) continue;
      const key = `${a.customerExpiresAt}:${days}`;
      if (a.remindersSent?.includes(key)) continue;
      // Si ya se mandó uno a mano en las últimas 20 h, no se repite.
      if (a.lastReminderAt && e.now() - a.lastReminderAt < 20 * 3_600_000) {
        (a.remindersSent ??= []).push(key);
        continue;
      }
      const c = e.s.customers[a.customerId];
      queue(e, a.customerId, "expiry_reminder", { name: c.name, product: e.s.products[a.productId].name, date: fdate(a.customerExpiresAt) });
      a.lastReminderAt = e.now();
      a.remindersSent = [...(a.remindersSent ?? []).slice(-10), key];
      n++;
    }
    if (n) e.audit(actor, "reminders.auto", "assignment", "*", { count: n, daysBefore: cfg.daysBefore.join(",") });
    return n;
  });
}

export function updateReminderSettings(e: Engine, actor: Actor, patch: Partial<ReminderSettings>): ReminderSettings {
  authorize(actor, "catalog.manage");
  if (patch.daysBefore !== undefined) {
    const ok = Array.isArray(patch.daysBefore) && patch.daysBefore.length <= 5 && patch.daysBefore.every((d) => Number.isInteger(d) && d >= 0 && d <= 30);
    if (!ok) throw new DomainError("VALIDATION", "Días antes: hasta 5 valores entre 0 y 30");
  }
  for (const k of ["fromHour", "toHour"] as const) {
    if (patch[k] !== undefined && !(Number.isInteger(patch[k]) && patch[k]! >= 0 && patch[k]! <= 24)) throw new DomainError("VALIDATION", "Horario: horas entre 0 y 24");
  }
  if (patch.timeZone !== undefined) {
    try { new Intl.DateTimeFormat("en-US", { timeZone: patch.timeZone }); } catch { throw new DomainError("VALIDATION", "Zona horaria inválida"); }
  }
  return e.tx(() => {
    const next = { ...reminderSettings(e), ...patch };
    if (patch.daysBefore) next.daysBefore = [...new Set(patch.daysBefore)].sort((a, b) => b - a);
    if (next.fromHour >= next.toHour) throw new DomainError("VALIDATION", "El horario de inicio tiene que ser antes del de fin");
    e.s.settings.reminders = next;
    e.audit(actor, "reminders.settings", "settings", "reminders", { enabled: next.enabled, daysBefore: next.daysBefore.join(","), hours: `${next.fromHour}-${next.toHour}` });
    return structuredClone(next);
  });
}

/**
 * Avisa al dueño (una sola vez por vencimiento) de las cuentas que vencen con el proveedor en los
 * próximos días configurados, todas juntas en un mensaje y dentro del horario de los recordatorios.
 */
export function supplierExpiryAlerts(e: Engine, actor: Actor): number {
  if (actor.role !== "system") authorize(actor, "catalog.manage");
  const cfg = staffAlertSettings(e);
  if (!cfg.phone || !cfg.supplierExpiry) return 0;
  const rs = reminderSettings(e);
  const h = localHour(e.now(), rs.timeZone);
  if (h < rs.fromHour || h >= rs.toHour) return 0;
  const limit = e.now() + cfg.supplierDaysBefore * DAY;
  const due = Object.values(e.s.accounts).filter((a) => a.status === "active" && a.supplierExpiresAt <= limit
    && a.supplierExpiresAt > e.now() - DAY && a.supplierAlertSentFor !== a.supplierExpiresAt);
  if (!due.length) return 0;
  return e.tx(() => {
    due.sort((a, b) => a.supplierExpiresAt - b.supplierExpiresAt);
    const shown = due.slice(0, 15).map((a) => `${e.s.products[a.productId]?.name ?? "?"} ${a.email} (${fdate(a.supplierExpiresAt)})`);
    queueStaff(e, "staff_supplier_expiry", { count: String(due.length), list: shown.join("; ") + (due.length > 15 ? `; y ${due.length - 15} más` : "") });
    for (const a of due) a.supplierAlertSentFor = a.supplierExpiresAt;
    e.audit(actor, "alerts.supplier_expiry", "account", "*", { count: due.length });
    return due.length;
  });
}

export function updateStaffAlerts(e: Engine, actor: Actor, patch: Partial<StaffAlertSettings>): StaffAlertSettings {
  authorize(actor, "catalog.manage");
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Solo el dueño cambia sus avisos");
  if (patch.supplierDaysBefore !== undefined && !(Number.isInteger(patch.supplierDaysBefore) && patch.supplierDaysBefore >= 0 && patch.supplierDaysBefore <= 15)) {
    throw new DomainError("VALIDATION", "Días antes: entre 0 y 15");
  }
  let phone: string | undefined;
  if (patch.phone !== undefined) {
    phone = String(patch.phone ?? "").replace(/[^\d+]/g, "");
    if (phone && !/^\+?\d{8,15}$/.test(phone)) throw new DomainError("VALIDATION", "WhatsApp inválido: poné el número con código de país (p. ej. +591 70000000)");
    if (phone && !phone.startsWith("+")) phone = (phone.length === 8 ? "+591" : "+") + phone;
  }
  return e.tx(() => {
    const next: StaffAlertSettings = { ...staffAlertSettings(e) };
    if (phone !== undefined) next.phone = phone;
    if (patch.payments !== undefined) next.payments = !!patch.payments;
    if (patch.supplierExpiry !== undefined) next.supplierExpiry = !!patch.supplierExpiry;
    if (patch.supplierDaysBefore !== undefined) next.supplierDaysBefore = patch.supplierDaysBefore;
    e.s.settings.staffAlerts = next;
    e.audit(actor, "alerts.settings", "settings", "staffAlerts", { payments: next.payments, supplierExpiry: next.supplierExpiry, days: next.supplierDaysBefore, hasPhone: !!next.phone });
    return structuredClone(next);
  });
}

/* ---------------- Recargas de saldo ---------------- */

export function requestTopup(e: Engine, actor: Actor, customerId: Id, amount: Cents, ev: { fileRef: string; declaredReference: string }): Order {
  requireActFor(e, actor, customerId);
  if (!Number.isInteger(amount) || amount < 1000 || amount > 500_000) throw new DomainError("VALIDATION", "La recarga debe estar entre Bs 10 y Bs 5.000");
  if (!ev.fileRef?.trim() || !ev.declaredReference?.trim()) throw new DomainError("VALIDATION", "Falta el comprobante o el número de operación");
  return e.tx(() => {
    const now = e.now();
    const o: Order = {
      id: e.id("ord"), kind: "topup", customerId, payerId: customerId, createdBy: actor.id,
      channel: isStaff(actor) ? "panel" : "store", items: [], total: amount, topupAmount: amount, status: "payment_review",
      paymentMethod: "qr", evidence: { fileRef: ev.fileRef, declaredReference: ev.declaredReference.trim(), submittedAt: now },
      reservedSlotIds: [], assignmentIds: [], createdAt: now, updatedAt: now,
    };
    e.s.orders[o.id] = o;
    if (!isStaff(actor)) alertPayment(e, o);
    e.audit(actor, "topup.request", "order", o.id, { amount });
    return structuredClone(o);
  });
}

