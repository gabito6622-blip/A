// Ventas, pagos, asignaciones, renovaciones y reemplazos.
//
// Flujo de venta:
//   createOrder ─┬─ qr ──────► awaiting_payment ─ submitEvidence ─► payment_review ─ approvePayment ─► fulfilled
//                │                     │ (vence la reserva)                    └─ rejectPayment ─► rejected
//                │                     └────────────────────────► expired
//                ├─ balance ─► (débito del saldo) ─► fulfilled
//                └─ cash (solo staff) ─────────────► fulfilled
// Un comprobante NO es un pago: solo un revisor con `payment.review` confirma la referencia bancaria.
import type { Actor, Assignment, Cents, Id, Order, OrderItem, PaymentMethod, ReminderSettings, RentalControl, StaffAlertSettings } from "./types.js";
import { DEFAULT_COMBO_DISCOUNTS } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY, HOUR } from "./time.js";
import { authorize, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { canActFor, priceFor, visibleTo } from "./catalog.js";
import { freeCount, releaseSlots, reserveSlots } from "./inventory.js";
import { balance, post } from "./wallet.js";
import { queue, queueStaff, staffAlertSettings } from "./notify.js";
import { couponFor } from "./coupons.js";
import { methodsFor, qrAllowedFor } from "./payMethods.js";

const fmt = (c: Cents) => `Bs ${(c / 100).toFixed(2)}`;
/** Fecha de Bolivia dd/mm/aaaa para los mensajes (con toISOString salía el día siguiente). */
const fdate = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));

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
  /** Solo staff: perfiles concretos a asignar (si no, el sistema elige el que vence antes). */
  preferredSlotIds?: Id[];
  /** Código de cupón de descuento (opcional). */
  couponCode?: string;
  /** Con paymentMethod "local": cuál método de cobro del país usa. */
  localMethodId?: Id;
  /** Solo staff: cuántos períodos (meses) se venden de una vez, 1 a 12. Cobra precio × períodos. */
  periods?: number;
}

/** Períodos de una venta: el staff puede vender de 1 a 12 juntos; los clientes, siempre 1. */
function periodsOf(actor: Actor, v: unknown): number {
  if (v === undefined || v === null || v === "" || !isStaff(actor)) return 1;
  const n = Number(v);
  if (!Number.isInteger(n) || n < 1 || n > 12) throw new DomainError("VALIDATION", "Meses: de 1 a 12");
  return n;
}

/**
 * Descuento "Armá tu combo": en la tienda pública, si el cliente (no revendedor) lleva 2 o más
 * servicios sueltos distintos (no combos ya armados), se descuenta según la configuración.
 */
export function comboDiscount(e: Engine, payerId: Id, productIds: Id[], channel: Order["channel"]): Cents {
  if (channel !== "store" || e.s.customers[payerId]?.kind === "reseller") return 0;
  const n = new Set(productIds.filter((id) => { const p = e.s.products[id]; return p && p.kind !== "combo" && !p.resellersOnly; })).size;
  const d = e.s.settings.comboDiscounts ?? DEFAULT_COMBO_DISCOUNTS;
  return n >= 4 ? d[2] : n === 3 ? d[1] : n === 2 ? d[0] : 0;
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
  const periods = periodsOf(actor, input.periods);
  return e.tx(() => e.idempotent(key, () => {
    const payerId = payerFor(e, actor, input.customerId);
    // Cobro por país: el método tiene que ser uno de los que ve quien paga.
    let localPay: Order["localPay"];
    if (input.paymentMethod === "local") {
      const m = methodsFor(e, payerId).find((x) => x.id === input.localMethodId);
      if (!m) throw new DomainError("VALIDATION", "Ese método de pago no está disponible para vos");
      localPay = { id: m.id, name: m.name };
    } else if (input.paymentMethod === "qr" && !isStaff(actor) && !qrAllowedFor(e, payerId)) {
      throw new DomainError("VALIDATION", "En tu país se paga con otro método: elegilo en el carrito");
    }
    const id = e.id("ord");
    const items: OrderItem[] = input.items.map((it) => {
      const p = e.get("products", it.productId);
      if (!isStaff(actor) && !visibleTo(e, p, payerId)) throw new DomainError("NOT_FOUND", "Producto no disponible");
      return { productId: it.productId, qty: it.qty, unitPrice: priceFor(e, payerId, it.productId) * periods };
    });
    // Productos para revendedores sin stock: se pueden pedir pagando con QR y se entregan al aprobar.
    const back: { productId: Id; qty: number }[] = [];
    const reserved = items.flatMap((it) => {
      const prod = e.s.products[it.productId];
      // Combo: se reserva un perfil de CADA app que lo compone (por la cantidad pedida). Se cobra el
      // precio del combo, pero el cliente recibe un acceso por cada servicio del combo.
      const parts = prod?.kind === "combo" ? (prod.comboProductIds ?? []) : null;
      const manualPay = input.paymentMethod === "qr" || input.paymentMethod === "usdt" || input.paymentMethod === "local";
      if (parts && parts.length) {
        // Con "todo Disponible" y pago manual, la app del combo que no tenga perfil libre queda a pedido:
        // se reserva lo que hay y el resto se entrega al aprobar (después de cargar esas cuentas).
        if (e.s.settings.alwaysAvailable && manualPay) {
          return parts.flatMap((partId) => {
            if (freeCount(e, partId) < it.qty) { back.push({ productId: partId, qty: it.qty }); return []; }
            return reserveSlots(e, partId, it.qty, id, [], []);
          });
        }
        return parts.flatMap((partId) => reserveSlots(e, partId, it.qty, id, [], []));
      }
      // A pedido (se paga y se entrega al aprobar): productos para revendedores, o toda la tienda si el dueño
      // marcó "mostrar todo como Disponible" (consigue las cuentas con sus proveedores). Un combo sin sus
      // apps cargadas no se puede entregar solo: se pide por WhatsApp.
      const onDemand = prod?.resellersOnly || (e.s.settings.alwaysAvailable && prod?.kind !== "combo");
      if (onDemand && (input.paymentMethod === "qr" || input.paymentMethod === "usdt" || input.paymentMethod === "local") && freeCount(e, it.productId) < it.qty) { back.push({ productId: it.productId, qty: it.qty }); return []; }
      const prefer = isStaff(actor) ? (input.preferredSlotIds ?? []).filter((sid) => e.s.slots[sid]?.productId === it.productId) : [];
      return reserveSlots(e, it.productId, it.qty, id, [], prefer);
    });
    const now = e.now();
    const channel = input.channel ?? (isStaff(actor) ? "panel" : actor.role === "reseller" ? "reseller" : "store");
    const gross = items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
    const discount = Math.min(comboDiscount(e, payerId, items.map((it) => it.productId), channel), gross);
    const cup = input.couponCode ? couponFor(e, input.couponCode, payerId, items, gross - discount) : null;
    const order: Order = {
      id, kind: "sale", customerId: input.customerId, payerId, createdBy: actor.id, channel,
      ...(periods > 1 ? { periods } : {}), items, total: gross - discount - (cup?.amount ?? 0), status: "awaiting_payment",
      paymentMethod: input.paymentMethod, reservedSlotIds: reserved.map((s) => s.id), assignmentIds: [], createdAt: now, updatedAt: now,
      ...(discount ? { discount } : {}),
      ...(cup ? { coupon: { id: cup.coupon.id, code: cup.coupon.code, amount: cup.amount } } : {}),
      ...(localPay ? { localPay } : {}),
      ...(back.length ? { backorder: back } : {}),
    };
    e.s.orders[id] = order;
    e.audit(actor, "order.create", "order", id, { total: order.total, method: order.paymentMethod, slots: reserved.length, ...(cup ? { coupon: cup.coupon.code, couponAmount: cup.amount } : {}), ...(localPay ? { via: localPay.name } : {}) });
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

/**
 * Lo que costaría un pedido, sin crearlo: sirve para mostrar el descuento del cupón en el carrito
 * antes de pagar. Si el cupón no aplica, devuelve el motivo en `couponError`.
 */
export function quoteOrder(e: Engine, actor: Actor, input: { customerId: Id; items: { productId: Id; qty: number }[]; couponCode?: string; channel?: Order["channel"]; periods?: number }) {
  if (isStaff(actor)) authorize(actor, "order.create_any");
  else authorize(actor, "order.create_self");
  requireActFor(e, actor, input.customerId);
  if (!Array.isArray(input.items) || !input.items.length || input.items.length > 20) throw new DomainError("VALIDATION", "El pedido necesita entre 1 y 20 ítems");
  const payerId = payerFor(e, actor, input.customerId);
  const periods = periodsOf(actor, input.periods);
  const items = input.items.map((it) => {
    const qty = Number(it.qty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 10) throw new DomainError("VALIDATION", "Cantidad inválida (1 a 10)");
    const p = e.get("products", it.productId);
    if (!isStaff(actor) && !visibleTo(e, p, payerId)) throw new DomainError("NOT_FOUND", "Producto no disponible");
    return { productId: it.productId, qty, unitPrice: priceFor(e, payerId, it.productId) * periods };
  });
  const channel = input.channel ?? (isStaff(actor) ? "panel" : actor.role === "reseller" ? "reseller" : "store");
  const gross = items.reduce((s, it) => s + it.unitPrice * it.qty, 0);
  const discount = Math.min(comboDiscount(e, payerId, items.map((it) => it.productId), channel), gross);
  let coupon: { code: string; amount: Cents } | null = null, couponError: string | null = null;
  if (input.couponCode) {
    try { const r = couponFor(e, input.couponCode, payerId, items, gross - discount); coupon = { code: r.coupon.code, amount: r.amount }; }
    catch (err) { if (err instanceof DomainError) couponError = err.message; else throw err; }
  }
  return { gross, discount, coupon, couponError, total: gross - discount - (coupon?.amount ?? 0) };
}

/** Prueba gratis: entrega una línea/perfil por unas horas, sin cobrar. No cuenta como venta. */
export function createTrial(e: Engine, actor: Actor, input: { customerId: Id; productId: Id; hours?: number; preferredSlotId?: Id }): { assignment: Assignment; order: Order } {
  authorize(actor, "order.create_any");
  const hours = Math.max(1, Math.min(72, Math.trunc(Number(input.hours) || 24)));
  return e.tx(() => {
    e.get("customers", input.customerId);
    e.get("products", input.productId);
    const now = e.now();
    const id = e.id("ord");
    const reserved = reserveSlots(e, input.productId, 1, id, [], input.preferredSlotId ? [input.preferredSlotId] : []);
    const slot = reserved[0];
    const order: Order = {
      id, kind: "sale", customerId: input.customerId, payerId: input.customerId, createdBy: actor.id, channel: "panel",
      items: [{ productId: input.productId, qty: 1, unitPrice: 0 }], total: 0, status: "fulfilled",
      paymentMethod: "cash", reservedSlotIds: [slot.id], assignmentIds: [], trial: true, approvedBy: actor.id, createdAt: now, updatedAt: now,
    };
    e.s.orders[id] = order;
    slot.status = "assigned";
    delete slot.reservedUntil;
    delete slot.reservedByOrder;
    const a: Assignment = {
      id: e.id("asg"), slotId: slot.id, productId: input.productId, customerId: input.customerId, orderId: id,
      startsAt: now, customerExpiresAt: now + hours * HOUR, status: "active", trial: true,
      history: [{ at: now, by: actor.id, event: "assigned", slotId: slot.id }],
    };
    e.s.assignments[a.id] = a;
    order.assignmentIds.push(a.id);
    e.audit(actor, "trial.create", "assignment", a.id, { customer: input.customerId, product: input.productId, hours });
    return { assignment: pubAssignment(a), order: structuredClone(order) };
  });
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
      const days = e.s.products[slot.productId].durationDays * (order.periods ?? 1);
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
    r.prevExpiresAt = e.s.assignments[r.assignmentId]?.customerExpiresAt;
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

export function submitEvidence(e: Engine, actor: Actor, orderId: Id, ev: { fileRef: string; declaredReference: string; hash?: string }): Order {
  return e.tx(() => {
    const o = e.get("orders", orderId);
    requireActFor(e, actor, o.customerId);
    if (o.paymentMethod !== "qr" && o.paymentMethod !== "usdt" && o.paymentMethod !== "local") throw new DomainError("INVALID_STATE", "Este pedido no se paga con comprobante");
    if (o.status !== "awaiting_payment" && o.status !== "payment_review") throw new DomainError("INVALID_STATE", `No se puede adjuntar comprobante en estado ${o.status}`);
    if (!ev.fileRef?.trim() || !ev.declaredReference?.trim()) throw new DomainError("VALIDATION", "Falta el archivo o el número de operación");
    if (o.status === "awaiting_payment" && !isStaff(actor)) alertPayment(e, o);
    // Mismo archivo que en otro pedido: se marca para que el dueño lo vea (la estafa más común).
    const dup = ev.hash ? Object.values(e.s.orders).find((x) => x.id !== o.id && x.evidence?.hash === ev.hash) : undefined;
    o.evidence = { fileRef: ev.fileRef, declaredReference: ev.declaredReference.trim(), submittedAt: e.now(), ...(ev.hash ? { hash: ev.hash } : {}), ...(dup ? { duplicateOf: dup.id } : {}) };
    if (dup) e.audit(actor, "order.evidence_duplicate", "order", o.id, { duplicateOf: dup.id });
    o.status = "payment_review";
    o.updatedAt = e.now();
    // Mientras se revisa, la reserva se mantiene (no se vende a otro).
    const hold = e.now() + e.opts.reviewHoldHours * HOUR;
    for (const id of o.reservedSlotIds) if (e.s.slots[id].reservedByOrder === o.id) e.s.slots[id].reservedUntil = hold;
    e.audit(actor, "order.evidence", "order", o.id, { declaredReference: o.evidence.declaredReference });
    return structuredClone(o);
  });
}

/** Entrega un pedido que está en revisión: re-reserva si hiciera falta, guarda la referencia y cumple.
 *  Debe correr dentro de `tx`. La usan tanto la aprobación manual (QR) como la pasarela (Binance). */
function settle(e: Engine, actor: Actor, o: Order, ref: string): void {
  const reused = Object.values(e.s.orders).find((x) => x.id !== o.id && x.confirmedReference === ref);
  if (reused) throw new DomainError("ALREADY_PROCESSED", `La referencia ${ref} ya se usó en el pedido ${reused.id}`);
  // Si la reserva se liberó, se intenta reservar de nuevo antes de entregar.
  if (o.kind === "sale" && o.reservedSlotIds.some((id) => e.s.slots[id].reservedByOrder !== o.id || e.s.slots[id].status !== "reserved")) {
    releaseSlots(e, o.reservedSlotIds.filter((id) => e.s.slots[id].reservedByOrder === o.id));
    o.reservedSlotIds = o.items.flatMap((it) => reserveSlots(e, it.productId, it.qty, o.id)).map((s) => s.id);
    delete o.backorder;
  } else if (o.kind === "sale" && o.backorder?.length) {
    for (const b of o.backorder) {
      try {
        o.reservedSlotIds.push(...reserveSlots(e, b.productId, b.qty, o.id).map((s) => s.id));
      } catch {
        throw new DomainError("OUT_OF_STOCK", `Es un pedido a pedido: primero cargá ${b.qty > 1 ? `${b.qty} cuentas` : "la cuenta"} de ${e.s.products[b.productId]?.name ?? b.productId} (Carga de Cuentas) y después aprobá.`);
      }
    }
    delete o.backorder;
  }
  o.confirmedReference = ref;
  o.approvedBy = actor.id;
  e.audit(actor, "payment.approve", "order", o.id, { confirmedReference: ref, total: o.total });
  fulfill(e, actor, o);
}

export function approvePayment(e: Engine, actor: Actor, orderId: Id, input: { confirmedReference: string; idempotencyKey?: string }): Order {
  authorize(actor, "payment.review");
  const key = input.idempotencyKey ? `approve:${orderId}:${input.idempotencyKey}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const o = e.get("orders", orderId);
    if (o.status === "fulfilled") throw new DomainError("ALREADY_PROCESSED", "El pedido ya fue aprobado");
    // "Esperando pago" también se aprueba cuando el cliente mandó el comprobante por otro lado (WhatsApp):
    // solo pagos manuales (QR, método del país, USDT); Binance se confirma solo y el saldo se cobra al pedir.
    const manual = o.status === "awaiting_payment" && (o.paymentMethod === "qr" || o.paymentMethod === "local" || o.paymentMethod === "usdt");
    if (o.status !== "payment_review" && !manual) throw new DomainError("INVALID_STATE", `Solo se aprueban pedidos en revisión (estado: ${o.status})`);
    if (actor.customerId && actor.customerId === o.customerId) throw new DomainError("FORBIDDEN", "No podés aprobar tu propio pedido");
    const ref = input.confirmedReference?.trim();
    if (!ref) throw new DomainError("VALIDATION", "Indicá la referencia bancaria verificada");
    settle(e, actor, o, ref);
    return structuredClone(o);
  }));
}

/** Guarda en el pedido la orden de pago creada en Binance (la llama el servidor tras crearla). */
export function attachBinance(e: Engine, actor: Actor, orderId: Id, data: { merchantTradeNo: string; prepayId?: string; link?: string; qr?: string; usdt: number; rate: number }): Order {
  return e.tx(() => {
    const o = e.get("orders", orderId);
    requireActFor(e, actor, o.customerId);
    if (o.paymentMethod !== "binance") throw new DomainError("INVALID_STATE", "Este pedido no se paga con Binance");
    if (o.status !== "awaiting_payment") throw new DomainError("INVALID_STATE", `No se puede adjuntar el pago en estado ${o.status}`);
    o.binance = { merchantTradeNo: data.merchantTradeNo, prepayId: data.prepayId, link: data.link, qr: data.qr, usdt: data.usdt, rate: data.rate, status: "PENDING" };
    o.updatedAt = e.now();
    e.audit(actor, "order.binance", "order", o.id, { usdt: data.usdt, rate: data.rate });
    return structuredClone(o);
  });
}

/** Confirma un pago de Binance Pay desde el webhook firmado (actor del sistema) y entrega el pedido. */
export function confirmBinancePayment(e: Engine, actor: Actor, orderId: Id, input: { txnId: string }): Order {
  authorize(actor, "payment.gateway");
  const txnId = String(input.txnId ?? "").trim();
  if (!txnId) throw new DomainError("VALIDATION", "Falta el ID de transacción de Binance");
  return e.tx(() => e.idempotent(`binance:${orderId}:${txnId}`, () => {
    const o = e.get("orders", orderId);
    if (o.paymentMethod !== "binance" || !o.binance) throw new DomainError("INVALID_STATE", "No es un pedido de Binance");
    if (o.status === "fulfilled") return structuredClone(o); // webhook repetido: ya se entregó
    if (o.status !== "awaiting_payment" && o.status !== "payment_review") throw new DomainError("INVALID_STATE", `No se puede confirmar en estado ${o.status}`);
    o.binance.status = "PAID";
    o.binance.txnId = txnId;
    o.status = "payment_review";
    settle(e, actor, o, `binance:${txnId}`);
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
      const late = o.reservedSlotIds.some((id) => (e.s.slots[id].reservedUntil ?? Infinity) < e.now())
        || (!o.reservedSlotIds.length && !!o.backorder && o.createdAt + DAY < e.now());
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

/** El servicio tal como lo devuelve la API: sin el cuaderno del revendedor (sus perfiles y sus precios). */
export function pubAssignment(a: Assignment): Assignment {
  const c = structuredClone(a);
  delete c.subs; delete c.rcontrol;
  return c;
}

/** ¿Se puede renovar ya este servicio (1 período) sin pasarse del vencimiento con el proveedor? */
export function renewableNow(e: Engine, a: Assignment): boolean {
  const prod = e.s.products[a.productId], slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
  if (!prod || !acc || a.status !== "active") return false;
  return Math.max(a.customerExpiresAt, e.now()) + prod.durationDays * DAY <= acc.supplierExpiresAt;
}

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
  delete a.holdOpen;
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
    else {
      requireActFor(e, actor, a.customerId);
      const prod = e.s.products[a.productId];
      if (!prod || !visibleTo(e, prod, payerFor(e, actor, a.customerId))) throw new DomainError("FORBIDDEN", "Este servicio lo renueva la tienda: escribinos por WhatsApp");
    }
    const payerId = payerFor(e, actor, a.customerId);
    // Si el alquiler tiene un precio acordado (Control de alquileres), se cobra ese.
    const unit = a.control?.price ?? priceFor(e, payerId, a.productId);
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
      order.renewal!.prevExpiresAt = a.customerExpiresAt;
      extend(e, actor, a.id, periods, !!input.allowBeyondSupplier);
      order.status = "fulfilled";
      order.approvedBy = input.paymentMethod === "cash" ? actor.id : undefined;
    }
    return { order: structuredClone(order), assignment: pubAssignment(e.s.assignments[a.id]) };
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
    return pubAssignment(a);
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
    // El cuaderno del revendedor (a quién le dio cada perfil) y su control son del dueño anterior:
    // no viajan con la cuenta, así el nuevo dueño nunca ve los clientes de otro revendedor.
    const dropped = a.subs?.length ?? 0;
    delete a.subs; delete a.rcontrol;
    a.customerId = to.id;
    a.history.push({ at: e.now(), by: actor.id, event: "transferred", slotId: a.slotId, note: `de ${from?.name ?? "?"} a ${to.name}: ${reason.trim()}` });
    queue(e, to.id, "access_transferred", { product: e.s.products[a.productId].name, date: fdate(a.customerExpiresAt) });
    e.audit(actor, "assignment.transfer", "assignment", a.id, { from: from?.id, to: to.id, reason, ...(dropped ? { subsDropped: dropped } : {}) });
    return pubAssignment(a);
  });
}

/** Cuenta caída: mueve a todos sus clientes a otras cuentas y la retira si quedó vacía. */
/**
 * Cola de "Reubicar": clientes activos cuyo perfil está en una cuenta caída
 * (en cuarentena, retirada o vencida con el proveedor). Para cada uno sugiere una
 * cuenta sana del mismo producto con cupo libre. Mover usa replaceAssignment.
 */
export function relocationQueue(e: Engine, actor: Actor) {
  authorize(actor, "assignment.replace");
  const now = e.now();
  const freeOf = (accId: Id) => Object.values(e.s.slots).filter((s) => s.accountId === accId && s.status === "available").length;
  const healthy = Object.values(e.s.accounts).filter((t) => t.status === "active" && t.supplierExpiresAt > now && freeOf(t.id) > 0);
  const rows: unknown[] = [];
  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active") continue;
    const slot = e.s.slots[a.slotId]; if (!slot) continue;
    const acc = e.s.accounts[slot.accountId];
    const down = slot.status === "quarantined" ? "cuarentena" : acc?.status !== "active" ? "cuenta retirada" : acc.supplierExpiresAt <= now ? "venció con el proveedor" : null;
    if (!down) continue;
    const cust = e.s.customers[a.customerId];
    const target = healthy.find((t) => t.id !== acc?.id && t.productId === a.productId);
    rows.push({
      assignmentId: a.id, customerId: a.customerId, customerName: cust?.name ?? "", customerPhone: cust?.phone ?? "",
      productId: a.productId, product: e.s.products[a.productId]?.name ?? a.productId, profile: slot.label,
      currentEmail: acc?.email ?? "", reason: down, expiresAt: a.customerExpiresAt,
      daysLeft: Math.ceil((a.customerExpiresAt - now) / DAY),
      suggest: target ? { email: target.email, free: freeOf(target.id) } : null,
    });
  }
  return rows;
}

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
      if (a.status !== "active" || a.holdOpen) continue;
      // Una prueba gratis vence sin período de gracia y deja el perfil libre (no hubo problema).
      if (a.customerExpiresAt + (a.trial ? 0 : graceDays * DAY) > e.now()) continue;
      a.status = "revoked";
      a.history.push({ at: e.now(), by: actor.id, event: "revoked", slotId: a.slotId, note: a.trial ? "prueba vencida" : "vencido" });
      e.s.slots[a.slotId].status = a.trial ? "available" : "quarantined";
      e.audit(actor, "assignment.expire", "assignment", a.id);
      n++;
    }
    return n;
  });
}

/** Datos de control de un alquiler (precio, costo, estado de pago, nota…), como en el Excel del dueño. */
/** Libera un perfil: si está vendido, revoca su asignación; queda disponible para vender de nuevo. */
export function releaseSlot(e: Engine, actor: Actor, slotId: Id, reason: string): { ok: true } {
  authorize(actor, "assignment.replace");
  return e.tx(() => {
    const slot = e.get("slots", slotId);
    if (slot.status === "assigned") {
      const a = Object.values(e.s.assignments).find((x) => x.slotId === slotId && x.status === "active");
      if (a) {
        a.status = "revoked";
        a.history.push({ at: e.now(), by: actor.id, event: "revoked", slotId, note: reason?.trim() || "liberado a mano" });
        e.audit(actor, "assignment.release", "assignment", a.id, { reason });
      }
    }
    delete slot.reservedByOrder; delete slot.reservedUntil;
    slot.status = "available";
    e.audit(actor, "slot.freed", "slot", slotId, { reason });
    return { ok: true } as const;
  });
}

/** Devolución proporcional: cierra un servicio activo y acredita al cliente por los días que le faltaban. */
export function refundAssignment(e: Engine, actor: Actor, assignmentId: Id, input: { amount?: number; reason?: string } = {}) {
  authorize(actor, "assignment.replace");
  return e.tx(() => {
    const a = e.get("assignments", assignmentId);
    if (a.status !== "active") throw new DomainError("INVALID_STATE", "Este servicio ya no está activo");
    const prod = e.get("products", a.productId);
    const total = Math.max(1, prod.durationDays);
    const remaining = Math.max(0, Math.ceil((a.customerExpiresAt - e.now()) / DAY));
    const suggested = Math.round(prod.price * Math.min(remaining, total) / total);
    const amount = input.amount !== undefined ? Number(input.amount) : suggested;
    if (!Number.isInteger(amount) || amount < 0 || amount > prod.price) throw new DomainError("VALIDATION", "Monto de devolución inválido");
    if (amount > 0) post(e, actor, a.customerId, amount, "refund", a.id, (input.reason || "").trim() || `Devolución de ${prod.name}`);
    a.status = "revoked";
    a.history.push({ at: e.now(), by: actor.id, event: "revoked", slotId: a.slotId, note: `devolución ${(amount / 100).toFixed(2)}` });
    const slot = e.s.slots[a.slotId];
    if (slot && slot.status === "assigned") slot.status = "available";
    e.audit(actor, "assignment.refund", "assignment", a.id, { amount, remaining });
    return { amount, remaining, suggested, balance: balance(e, a.customerId) };
  });
}

export function setRentalControl(e: Engine, actor: Actor, assignmentId: Id, patch: Partial<RentalControl>) {
  authorize(actor, "assignment.renew_any");
  const money = (v: unknown, what: string) => {
    if (v === undefined) return undefined;
    if (v === null || v === "") return null;
    const n = Number(v);
    if (!Number.isInteger(n) || n < 0 || n > 10_000_000) throw new DomainError("VALIDATION", `${what} inválido`);
    return n;
  };
  // El costo es dato del dueño: Atención (seller) no lo ve ni lo cambia.
  if (patch.cost !== undefined && actor.role === "seller") throw new DomainError("FORBIDDEN", "El costo lo carga el dueño o un admin");
  const price = money(patch.price, "Precio"), cost = money(patch.cost, "Costo");
  if (patch.payStatus !== undefined && !["pagado", "pendiente", "no_pago"].includes(patch.payStatus)) throw new DomainError("VALIDATION", "Estado de pago inválido");
  if (patch.note !== undefined && String(patch.note).length > 300) throw new DomainError("VALIDATION", "Nota: máximo 300 letras");
  if (patch.seller !== undefined && String(patch.seller).length > 60) throw new DomainError("VALIDATION", "Revendedor: máximo 60 letras");
  if (patch.startedAt !== undefined && !(Number.isFinite(patch.startedAt) && patch.startedAt > Date.UTC(2015, 0, 1))) throw new DomainError("VALIDATION", "Fecha de inicio inválida");
  return e.tx(() => {
    const a = e.get("assignments", assignmentId);
    const c: RentalControl = { ...(a.control ?? {}) };
    if (price !== undefined) { if (price === null) delete c.price; else c.price = price; }
    if (cost !== undefined) { if (cost === null) delete c.cost; else c.cost = cost; }
    if (patch.payStatus !== undefined) c.payStatus = patch.payStatus;
    if (patch.note !== undefined) { const t = String(patch.note).trim(); if (t) c.note = t; else delete c.note; }
    if (patch.seller !== undefined) { const t = String(patch.seller).trim(); if (t) c.seller = t; else delete c.seller; }
    if (patch.startedAt !== undefined) c.startedAt = patch.startedAt;
    a.control = c;
    e.audit(actor, "assignment.control", "assignment", a.id, { fields: Object.keys(patch).join(",") });
    return structuredClone(c);
  });
}

/** El staff corrige la fecha de vencimiento del cliente (p. ej. al ponerse al día con un Excel). */
export function setCustomerExpiry(e: Engine, actor: Actor, assignmentId: Id, expiresAt: number, note?: string) {
  authorize(actor, "assignment.renew_any");
  if (!(Number.isFinite(expiresAt) && expiresAt > Date.UTC(2020, 0, 1) && expiresAt < Date.UTC(2100, 0, 1))) throw new DomainError("VALIDATION", "Fecha inválida");
  return e.tx(() => {
    const a = e.get("assignments", assignmentId);
    if (a.status !== "active") throw new DomainError("INVALID_STATE", "Ese servicio ya no está activo");
    // Atención (seller) solo corrige hacia atrás: no puede alargar lo que el cliente pagó (eso es
    // Renovar, que deja anotado el cobro) ni pasar la fecha del proveedor. Dueño y admin, sin límite.
    if (actor.role === "seller") {
      const acc = e.s.accounts[e.s.slots[a.slotId]?.accountId];
      if (expiresAt > a.customerExpiresAt) throw new DomainError("FORBIDDEN", "Para alargar la fecha usá Renovar (así queda anotado el cobro) o pedíselo al dueño");
      if (acc && expiresAt > acc.supplierExpiresAt) throw new DomainError("FORBIDDEN", "No podés poner una fecha después del vencimiento con el proveedor");
    }
    const before = a.customerExpiresAt;
    a.customerExpiresAt = expiresAt;
    delete a.holdOpen;
    a.remindersSent = [];
    a.history.push({ at: e.now(), by: actor.id, event: "date_changed", slotId: a.slotId, note: `${fdate(before)} → ${fdate(expiresAt)}${note ? ` · ${String(note).slice(0, 120)}` : ""}` });
    e.audit(actor, "assignment.set_expiry", "assignment", a.id, { before, after: expiresAt });
    return pubAssignment(a);
  });
}

/** Encola recordatorios para servicios que vencen dentro de `withinDays` (máx. uno por día). */
export function queueExpiryReminders(e: Engine, actor: Actor, withinDays = 3): number {
  if (actor.role !== "system") authorize(actor, "assignment.renew_any");
  return e.tx(() => {
    let n = 0;
    for (const a of Object.values(e.s.assignments)) {
      if (a.status !== "active" || a.trial) continue;
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

export function localHour(t: number, timeZone: string): number {
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

export function requestTopup(e: Engine, actor: Actor, customerId: Id, amount: Cents, ev: { fileRef: string; declaredReference: string; hash?: string }): Order {
  requireActFor(e, actor, customerId);
  if (!Number.isInteger(amount) || amount < 1000 || amount > 500_000) throw new DomainError("VALIDATION", "La recarga debe estar entre Bs 10 y Bs 5.000");
  if (!ev.fileRef?.trim() || !ev.declaredReference?.trim()) throw new DomainError("VALIDATION", "Falta el comprobante o el número de operación");
  return e.tx(() => {
    const now = e.now();
    const dup = ev.hash ? Object.values(e.s.orders).find((x) => x.evidence?.hash === ev.hash) : undefined;
    const o: Order = {
      id: e.id("ord"), kind: "topup", customerId, payerId: customerId, createdBy: actor.id,
      channel: isStaff(actor) ? "panel" : "store", items: [], total: amount, topupAmount: amount, status: "payment_review",
      paymentMethod: "qr", evidence: { fileRef: ev.fileRef, declaredReference: ev.declaredReference.trim(), submittedAt: now, ...(ev.hash ? { hash: ev.hash } : {}), ...(dup ? { duplicateOf: dup.id } : {}) },
      reservedSlotIds: [], assignmentIds: [], createdAt: now, updatedAt: now,
    };
    e.s.orders[o.id] = o;
    if (!isStaff(actor)) alertPayment(e, o);
    e.audit(actor, "topup.request", "order", o.id, { amount });
    return structuredClone(o);
  });
}

