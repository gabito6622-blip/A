// Renovar sin trabarse ni pagar dos veces (revisión de 3 meses, R2 · 14/11/2026). Lo que pasaba:
//  - «Pedir renovación» de una cuenta que vence antes con el proveedor abría «Reportar falla → No me deja entrar» o un
//    WhatsApp suelto: el dueño no lo veía como pedido, no tenía el monto, y el servicio se cortaba igual a los 2 días.
//  - Tocar dos veces «Con un QR» (o el cartel y después la tarjeta) creaba 2 renovaciones de la misma cuenta; y con un
//    QR esperando pago se podía renovar además con saldo: pagaba dos veces.
//  - Los pedidos de renovación por QR sin comprobante quedaban esperando para siempre.
//
// Ahora (decisión del asistente; el dueño la puede cambiar):
//  - «📩 Pedir renovación» es un pedido propio: queda en el panel del dueño (Mi secretaria y Notificaciones) con el
//    monto, y el dueño lo resuelve con «💳 Renovar proveedor y anotar» (renueva la cuenta con el proveedor y cobra la
//    renovación al que la pidió: con su saldo si le alcanza, si no le deja un pedido por QR).
//  - Mientras el pedido está abierto NO se corta el servicio (a lo sumo REQUEST_HOLD_DAYS días después del corte normal).
//  - No se crea otra renovación de un servicio que ya tiene una esperando pago o en revisión (ni con saldo).
//  - Una renovación por QR sin comprobante vence a los PENDING_RENEWAL_DAYS días.
// Separación: cada revendedor ve y toca solo sus pedidos (y los de SUS clientes); el dueño ve todos.
import type { Actor, Assignment, Cents, Id, Order, RenewRequest } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY, boParts } from "./time.js";
import { canActFor, renewPriceFor } from "./catalog.js";
import { canRenewHere } from "./renovarVarias.js";
import { renew, renewableNow } from "./orders.js";
import { renewBlockOf } from "./vendible.js";
import { renewStart } from "./cobrarBien.js";
import { supplierRenewHint, cutAtOf } from "./dia.js";
import { payAccountRenewal } from "./finance.js";
import { balance } from "./wallet.js";
import { resellerOf } from "./myReseller.js";

/** Días de más (después del corte normal) que un pedido de renovación abierto frena el corte. */
export const REQUEST_HOLD_DAYS = 5;
/** Una renovación por QR o USDT sin comprobante vence a los tantos días (vuelve a poder renovarse). */
export const PENDING_RENEWAL_DAYS = 3;

const fmt = (c: Cents) => `Bs ${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
const fdm = (t: number) => { const p = boParts(t); return `${String(p.d).padStart(2, "0")}/${String(p.m + 1).padStart(2, "0")}`; };
const short = (n: string) => n.replace(/\s*\(alquiler revendedores\)\s*$/i, "");
const all = (e: Engine) => (e.s.renewRequests ??= {});
const list = (e: Engine) => Object.values(e.s.renewRequests ?? {});

/* ---------------- Renovaciones esperando pago ---------------- */

/** La renovación de este servicio que espera pago o está en revisión (la más nueva), si hay. */
export function pendingRenewalOf(e: Engine, assignmentId: Id): Order | undefined {
  let best: Order | undefined;
  for (const o of Object.values(e.s.orders)) {
    if (o.kind !== "renewal" || o.renewal?.assignmentId !== assignmentId) continue;
    if (o.status !== "awaiting_payment" && o.status !== "payment_review") continue;
    if (!best || o.createdAt > best.createdAt) best = o;
  }
  return best;
}

/** Texto (y código) cuando ya hay una renovación de ese servicio en camino. Lo usan `renew` y la vista previa. */
export function pendingRenewalText(e: Engine, o: Order, method?: string): string {
  const prod = short(e.s.products[o.items[0]?.productId]?.name ?? "servicio");
  if (o.status === "payment_review") return `Ya mandaste el comprobante de la renovación de tu ${prod}: lo estamos revisando. No hace falta pagar de nuevo.`;
  return method === "balance"
    ? `Ya tenés un pedido por QR esperando pago para tu ${prod} (${fmt(o.total)}). ¿Lo cancelo y pagás con saldo?`
    : `Ya tenés un pedido por QR esperando pago para tu ${prod} (${fmt(o.total)}): pagá ese QR y subí el comprobante en «Mis cuentas».`;
}

/** Freno de `renew` para clientes y revendedores: no se crea otra renovación si ya hay una en camino. */
export function assertNoPendingRenewal(e: Engine, actor: Actor, assignmentId: Id, method: string): void {
  if (isStaff(actor)) return; // el dueño decide (puede anotar un pago en efectivo aunque haya un QR esperando)
  const o = pendingRenewalOf(e, assignmentId);
  if (o) throw new DomainError("PENDING_RENEWAL", pendingRenewalText(e, o, method));
}

/** Renovación por QR/USDT sin comprobante y con más de PENDING_RENEWAL_DAYS días: vence (la limpia `expireReservations`). */
export function staleRenewal(o: Order, now: number): boolean {
  return o.kind === "renewal" && o.status === "awaiting_payment" && !o.evidence && !o.binance
    && (o.paymentMethod === "qr" || o.paymentMethod === "usdt") && now - o.createdAt > PENDING_RENEWAL_DAYS * DAY;
}

/** Sus renovaciones por QR esperando el comprobante (las suyas y las de sus clientes), para «Pagá Bs X con un solo QR». */
export function myPendingQr(e: Engine, payerId: Id) {
  return Object.values(e.s.orders)
    .filter((o) => o.kind === "renewal" && o.status === "awaiting_payment" && !o.evidence && o.paymentMethod === "qr" && o.usd === undefined && (o.payerId ?? o.customerId) === payerId)
    .sort((x, y) => x.createdAt - y.createdAt)
    .map((o) => {
      const a = e.s.assignments[o.renewal!.assignmentId], slot = a ? e.s.slots[a.slotId] : undefined, acc = slot ? e.s.accounts[slot.accountId] : undefined;
      return {
        id: o.id, assignmentId: o.renewal!.assignmentId, total: o.total, createdAt: o.createdAt,
        expiresAt: o.createdAt + PENDING_RENEWAL_DAYS * DAY,
        product: short(e.s.products[o.items[0]?.productId]?.name ?? ""), email: acc?.email ?? "",
        ...(a && a.customerId !== payerId ? { customerName: e.s.customers[a.customerId]?.name ?? "" } : {}),
      };
    });
}

/* ---------------- Pedido de renovación ---------------- */

/** El pedido abierto de este servicio (si hay). Si el servicio ya se renovó por otro lado, ya no cuenta como abierto. */
export function openRequestOf(e: Engine, assignmentId: Id): RenewRequest | undefined {
  const a = e.s.assignments[assignmentId];
  if (!a || a.status !== "active") return undefined;
  return list(e).find((r) => r.assignmentId === assignmentId && r.status === "open" && a.customerExpiresAt <= r.expiresAt);
}

/**
 * ¿El corte espera por un pedido de renovación? Sí mientras el pedido está abierto (o el dueño ya lo resolvió y dejó un
 * pedido por QR que todavía espera el pago), pero a lo sumo REQUEST_HOLD_DAYS días después del corte normal.
 */
export function renewRequestHold(e: Engine, a: Assignment): boolean {
  const now = e.now();
  const cut = cutAtOf(a);
  if (cut === undefined || now >= cut + REQUEST_HOLD_DAYS * DAY) return false;
  return list(e).some((r) => {
    if (r.assignmentId !== a.id || a.customerExpiresAt > r.expiresAt) return false;
    if (r.status === "open") return true;
    const o = r.status === "done" && r.orderId ? e.s.orders[r.orderId] : undefined;
    return !!o && (o.status === "awaiting_payment" || o.status === "payment_review");
  });
}

function view(e: Engine, r: RenewRequest, staff: boolean) {
  const a = e.s.assignments[r.assignmentId], slot = a ? e.s.slots[a.slotId] : undefined, acc = slot ? e.s.accounts[slot.accountId] : undefined;
  const cut = a ? cutAtOf(a) : undefined;
  const renewedElsewhere = !!a && a.customerExpiresAt > r.expiresAt;
  const order = r.orderId ? e.s.orders[r.orderId] : undefined;
  const base = {
    id: r.id, assignmentId: r.assignmentId, status: renewedElsewhere && r.status === "open" ? "done" as const : r.status,
    product: short(e.s.products[a?.productId ?? ""]?.name ?? ""), customerName: e.s.customers[r.customerId]?.name ?? "",
    amount: a ? renewPriceFor(e, r.payerId, a) : r.amount, expiresAt: a?.customerExpiresAt ?? r.expiresAt, createdAt: r.createdAt,
    ...(cut !== undefined ? { cutAt: cut, holdUntil: cut + REQUEST_HOLD_DAYS * DAY } : {}),
    ...(r.closedAt ? { closedAt: r.closedAt } : {}), ...(r.reason ? { reason: r.reason } : {}),
    ...(order ? { order: { id: order.id, status: order.status, method: order.paymentMethod, total: order.total } } : {}),
  };
  if (!staff) return base;
  const payer = e.s.customers[r.payerId];
  const prod = a ? e.s.products[a.productId] : undefined;
  const to = a && prod ? renewStart(a, e.now()) + prod.durationDays * DAY : 0;
  const hint = acc && to > acc.supplierExpiresAt ? supplierRenewHint(e, acc, to) : undefined;
  const bal = balance(e, r.payerId);
  return {
    ...base, payerId: r.payerId, payerName: payer?.name ?? "", payerPhone: payer?.phone ?? "", payerIsReseller: payer?.kind === "reseller",
    email: acc?.email ?? "", accountId: acc?.id ?? "", supplierExpiresAt: acc?.supplierExpiresAt ?? 0, to,
    supplier: hint ? { months: hint.months, amount: hint.amount, to: hint.to } : null,
    balance: bal, enough: bal >= base.amount,
  };
}

function meOf(actor: Actor): Id {
  if (!actor.customerId || (actor.role !== "reseller" && actor.role !== "customer")) throw new DomainError("FORBIDDEN", "Solo para clientes y revendedores");
  return actor.customerId;
}

/**
 * «📩 Pedir renovación»: solo cuando la cuenta vence antes con el proveedor (si se puede renovar desde acá, se renueva).
 * Si ya hay un pedido abierto de ese servicio, devuelve ese (no se duplica).
 */
export function requestRenewal(e: Engine, actor: Actor, assignmentId: Id) {
  const me = meOf(actor);
  return e.tx(() => {
    const a = e.s.assignments[String(assignmentId ?? "")];
    if (!a || !canActFor(e, actor, a.customerId)) throw new DomainError("FORBIDDEN", "Ese servicio no es tuyo");
    if (a.status !== "active") throw new DomainError("INVALID_STATE", "Ese servicio ya no está activo");
    // El cliente de un revendedor le pide la renovación a su revendedor, no a la tienda.
    const via = me === a.customerId ? resellerOf(e, a.customerId) : undefined;
    if (via) throw new DomainError("FORBIDDEN", `Este servicio lo renueva tu revendedor: escribile a ${via.shop?.title || via.name}`);
    const payerId = actor.role === "reseller" && me !== a.customerId ? me : a.customerId;
    if (!canRenewHere(e, payerId, a)) throw new DomainError("FORBIDDEN", "Este servicio lo renueva la tienda: escribinos por WhatsApp");
    const fallen = renewBlockOf(e, a);
    if (fallen) throw new DomainError("INVALID_STATE", "La cuenta está caída: la tienda te pasa a otra y después la renovás");
    const open = openRequestOf(e, a.id);
    if (open) return { ...view(e, open, false), already: true };
    if (renewableNow(e, a)) throw new DomainError("VALIDATION", "Esta cuenta ya se puede renovar desde acá: tocá «Renovar»");
    const pend = pendingRenewalOf(e, a.id);
    if (pend) throw new DomainError("PENDING_RENEWAL", pendingRenewalText(e, pend));
    const now = e.now();
    const r: RenewRequest = {
      id: e.id("rrq"), assignmentId: a.id, customerId: a.customerId, payerId, amount: renewPriceFor(e, payerId, a),
      expiresAt: a.customerExpiresAt, createdAt: now, createdBy: actor.id, status: "open",
    };
    all(e)[r.id] = r;
    e.audit(actor, "renew_request.create", "assignment", a.id, { request: r.id, amount: r.amount });
    return { ...view(e, r, false), already: false };
  });
}

/** Sus pedidos (y los de sus clientes): los abiertos y los cerrados de los últimos 7 días. */
export function myRequests(e: Engine, actor: Actor) {
  const me = meOf(actor);
  const now = e.now();
  return list(e)
    .filter((r) => (r.payerId === me || r.customerId === me) && (r.status === "open" || now - (r.closedAt ?? r.createdAt) < 7 * DAY))
    .sort((x, y) => y.createdAt - x.createdAt).map((r) => view(e, r, false));
}

/** «Ya no hace falta»: quien lo pidió lo cancela. */
export function cancelRequest(e: Engine, actor: Actor, id: Id) {
  const me = meOf(actor);
  return e.tx(() => {
    const r = all(e)[id];
    if (!r || (r.payerId !== me && r.customerId !== me)) throw new DomainError("NOT_FOUND", "No se encontró ese pedido");
    if (r.status !== "open") throw new DomainError("ALREADY_PROCESSED", "Ese pedido ya se resolvió");
    Object.assign(r, { status: "cancelled", closedAt: e.now(), closedBy: actor.id });
    e.audit(actor, "renew_request.cancel", "assignment", r.assignmentId, { request: r.id });
    return view(e, r, false);
  });
}

/** Panel del dueño: los pedidos abiertos (el más urgente primero) y los resueltos de las últimas 48 horas. */
export function staffRequests(e: Engine, actor: Actor) {
  authorize(actor, "payment.review");
  const now = e.now();
  return list(e)
    .filter((r) => r.status === "open" ? !!openRequestOf(e, r.assignmentId) : now - (r.closedAt ?? 0) < 2 * DAY)
    .map((r) => view(e, r, true))
    .sort((x, y) => Number(y.status === "open") - Number(x.status === "open") || (x.cutAt ?? 0) - (y.cutAt ?? 0));
}
export const openRequestCount = (e: Engine) => list(e).filter((r) => r.status === "open" && !!openRequestOf(e, r.assignmentId)).length;

/**
 * «💳 Renovar proveedor y anotar» del pedido: si la cuenta vence antes, anota «Pagué la renovación» por los meses que
 * hacen falta; después renueva el servicio a nombre de quien lo pidió, a SU precio: con su saldo si le alcanza, si no le
 * deja un pedido por QR esperando su pago (y el corte sigue frenado mientras tanto). Una sola vez por pedido.
 */
export function resolveRequest(e: Engine, actor: Actor, id: Id, input: { idempotencyKey?: unknown } = {}) {
  authorize(actor, "payment.review");
  authorize(actor, "inventory.manage");
  const key = typeof input.idempotencyKey === "string" && input.idempotencyKey ? `rrq:${id}:${input.idempotencyKey.slice(0, 80)}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const r = all(e)[id];
    if (!r) throw new DomainError("NOT_FOUND", "No se encontró ese pedido");
    if (r.status !== "open") throw new DomainError("ALREADY_PROCESSED", "Ese pedido ya se resolvió");
    const a = e.get("assignments", r.assignmentId);
    if (a.status !== "active") throw new DomainError("INVALID_STATE", "El servicio ya no está activo (se cortó o se dio de baja)");
    if (a.customerExpiresAt > r.expiresAt) throw new DomainError("ALREADY_PROCESSED", "Ese servicio ya se renovó por otro lado");
    const fallen = renewBlockOf(e, a);
    if (fallen) throw new DomainError("INVALID_STATE", fallen);
    const acc = e.s.accounts[e.s.slots[a.slotId].accountId], prod = e.s.products[a.productId];
    const to = renewStart(a, e.now()) + prod.durationDays * DAY;
    let supplier: { months: number; amount: Cents; supplierExpiresAt: number } | undefined;
    if (to > acc.supplierExpiresAt) {
      const hint = supplierRenewHint(e, acc, to);
      if (!hint) throw new DomainError("VALIDATION", `No sé cuánto le pagás al proveedor por ${acc.email}: cargale el costo en Cuentas`);
      const paid = payAccountRenewal(e, actor, acc.id, { months: hint.months });
      supplier = { months: hint.months, amount: paid.expense.amount, supplierExpiresAt: paid.supplierExpiresAt };
    }
    // La renovación la hace quien la pidió (su precio, su saldo, sus avisos): el pedido ya fue su «sí».
    const payer = e.get("customers", r.payerId);
    const payerActor: Actor = { id: `web:${payer.id}`, role: payer.kind === "reseller" ? "reseller" : "customer", customerId: payer.id };
    const price = renewPriceFor(e, payer.id, a);
    const method = balance(e, payer.id) >= price ? "balance" as const : "qr" as const;
    const res = renew(e, payerActor, a.id, { paymentMethod: method });
    Object.assign(r, { status: "done", closedAt: e.now(), closedBy: actor.id, orderId: res.order.id });
    e.audit(actor, "renew_request.resolve", "assignment", a.id, { request: r.id, method, order: res.order.id, ...(supplier ? { supplierMonths: supplier.months, supplierAmount: supplier.amount } : {}) });
    return {
      ok: true as const, method, orderId: res.order.id, orderStatus: res.order.status, total: res.order.total,
      expiresAt: e.s.assignments[a.id].customerExpiresAt, payerId: payer.id, payerName: payer.name, product: short(prod.name),
      ...(supplier ? { supplier } : {}),
    };
  }));
}

/** «No la renuevo»: el dueño lo cierra con un motivo (lo ve quien lo pidió). Desde ahí el corte sigue la regla de siempre. */
export function rejectRequest(e: Engine, actor: Actor, id: Id, reason: unknown) {
  authorize(actor, "payment.review");
  const why = String(reason ?? "").trim().slice(0, 200);
  if (!why) throw new DomainError("VALIDATION", "Escribí por qué (lo ve el revendedor)");
  return e.tx(() => {
    const r = all(e)[id];
    if (!r) throw new DomainError("NOT_FOUND", "No se encontró ese pedido");
    if (r.status !== "open") throw new DomainError("ALREADY_PROCESSED", "Ese pedido ya se resolvió");
    Object.assign(r, { status: "rejected", closedAt: e.now(), closedBy: actor.id, reason: why });
    e.audit(actor, "renew_request.reject", "assignment", r.assignmentId, { request: r.id, reason: why });
    return view(e, r, true);
  });
}

/** Texto corto del aviso al celular de quien lo pidió, cuando el dueño lo resolvió. */
export function resolvedPushText(x: { method: string; product: string; total: Cents; expiresAt: number }) {
  return x.method === "balance"
    ? { title: `✅ La tienda renovó tu ${x.product}`, body: `Se descontaron ${fmt(x.total)} de tu saldo. Ahora vence el ${fdm(x.expiresAt)}.` }
    : { title: `📲 Ya podés pagar la renovación de tu ${x.product}`, body: `La tienda renovó con su proveedor. Pagá ${fmt(x.total)} con el QR en GaboHub: no se corta mientras tanto.` };
}
