// Renovar varias cuentas juntas y pagar con UN solo comprobante (revisión de 3 meses, 14/11/2026).
//
// Antes: un revendedor con 4 alquileres hacía 4 pedidos de renovación y mandaba el MISMO QR a los 4. El dueño
// aprobaba el primero y los otros 3 daban 409 «La referencia ya se usó»: quedaban pagados sin aprobar y se cortaban.
//
// Ahora:
//  - El revendedor elige varios de SUS alquileres en GaboHub y paga junto: con saldo (todo o nada, en una sola
//    transacción) o con QR (un pedido de renovación por cuenta, todos con el mismo comprobante, marcados como grupo).
//  - El dueño ve «Un solo comprobante para varios pedidos» y los aprueba juntos con UNA referencia si la suma de los
//    pedidos (más los que ya aprobó con esa misma referencia de la misma persona) coincide con lo que llegó al banco.
//  - Independiente (Customer.trust): puede renovar SUS alquileres de la tienda desde GaboHub salvo que el dueño se lo
//    apague (`storeRenew: false`, interruptor en su tarjeta). No ve ni compra el resto del stock.
// Cada pedido sigue siendo un pedido de renovación común: Finanzas, Cómo van e Inicio los cuentan igual que siempre.
import type { Actor, Assignment, Cents, Id, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { isIndependent, renewPriceFor, visibleTo } from "./catalog.js";
import { normRef, renew, renewableNow, settleShared, submitEvidence } from "./orders.js";
import { balance } from "./wallet.js";
import { isUsd } from "./usd.js";
import { mergeQueued } from "./avisosJuntos.js";
import { pendingRenewalOf } from "./renovarSinTrabas.js";

const MAX = 20;
const fmt = (c: Cents) => `Bs ${(c / 100).toFixed(2)}`;
const short = (n: string) => n.replace(/\s*\(alquiler revendedores\)\s*$/i, "");

/* ---------------- Independiente: renovar sus alquileres de la tienda ---------------- */

/** Independiente renovando SU alquiler de la tienda (no el de un cliente), con el permiso del dueño. */
export function ownStoreRenewOk(e: Engine, customerId: Id | undefined, a: Pick<Assignment, "customerId" | "productId">): boolean {
  const c = customerId ? e.s.customers[customerId] : undefined;
  if (!c || !isIndependent(c) || c.storeRenew === false || a.customerId !== c.id) return false;
  return !!e.s.products[a.productId]?.published;
}

/** ¿Puede renovar este servicio desde GaboHub o la tienda? (lo que ya valía, más la excepción del independiente). */
export function canRenewHere(e: Engine, customerId: Id | undefined, a: Pick<Assignment, "customerId" | "productId">): boolean {
  const p = e.s.products[a.productId];
  return !!p && (visibleTo(e, p, customerId) || ownStoreRenewOk(e, customerId, a));
}

/** El dueño (o admin) prende o apaga «renueva sus alquileres desde GaboHub» para un independiente. */
export function setStoreRenew(e: Engine, actor: Actor, customerId: Id, allowed: unknown) {
  authorize(actor, "reseller.manage");
  if (typeof allowed !== "boolean") throw new DomainError("VALIDATION", "Decí sí o no");
  return e.tx(() => {
    const c = e.get("customers", customerId);
    if (c.kind !== "reseller") throw new DomainError("VALIDATION", "Solo para revendedores");
    if (allowed) delete c.storeRenew; else c.storeRenew = false;
    e.audit(actor, "reseller.store_renew", "customer", c.id, { allowed });
    return { id: c.id, storeRenew: allowed };
  });
}

/* ---------------- Revendedor: varias renovaciones juntas ---------------- */

function meOf(e: Engine, actor: Actor) {
  if (!actor.customerId || (actor.role !== "reseller" && actor.role !== "customer")) throw new DomainError("FORBIDDEN", "Solo para clientes y revendedores");
  return e.get("customers", actor.customerId);
}
function idsOf(raw: unknown): Id[] {
  if (!Array.isArray(raw)) throw new DomainError("VALIDATION", "Elegí al menos una cuenta");
  const ids = [...new Set(raw.map(String))];
  if (!ids.length) throw new DomainError("VALIDATION", "Elegí al menos una cuenta");
  if (ids.length > MAX) throw new DomainError("VALIDATION", `Hasta ${MAX} cuentas por vez`);
  return ids;
}

/** Lo que va a costar renovar esas cuentas suyas (para la confirmación con el total). No cambia nada. */
export function renewManyPreview(e: Engine, actor: Actor, raw: unknown) {
  const me = meOf(e, actor);
  const ids = idsOf(raw);
  const rows = ids.map((id) => {
    const a = e.s.assignments[id];
    if (!a || a.customerId !== me.id) throw new DomainError("FORBIDDEN", "Esa cuenta no es tuya");
    // Ya hay una renovación esperando pago o en revisión: no se cobra dos veces (renovarSinTrabas.ts).
    const pend = a.status === "active" ? pendingRenewalOf(e, a.id) : undefined;
    const why = a.status !== "active" ? "ya no está activa" : !canRenewHere(e, me.id, a) ? "la renueva la tienda" : !renewableNow(e, a) ? "para renovarla, la tienda primero renueva con su proveedor: tocá «📩 Pedir renovación»"
      : pend ? (pend.status === "payment_review" ? "ya mandaste el comprobante: lo estamos revisando" : "ya tenés un pedido por QR esperando pago") : "";
    return { assignmentId: a.id, product: short(e.s.products[a.productId]?.name ?? ""), expiresAt: a.customerExpiresAt, price: renewPriceFor(e, me.id, a), ok: !why, ...(why ? { why } : {}),
      ...(pend ? { pendingOrderId: pend.id, pendingStatus: pend.status } : {}) };
  });
  const total = rows.filter((r) => r.ok).reduce((t, r) => t + r.price, 0);
  return { rows, total, balance: balance(e, me.id), currency: isUsd(e, me.id) ? "USD" as const : "BOB" as const };
}

/**
 * Renueva varias cuentas SUYAS juntas. Con saldo: todo o nada (si no alcanza, no se renueva ninguna).
 * Con QR: un pedido de renovación por cuenta, todos esperando UN comprobante (`evidenceMany`).
 */
export function renewMany(e: Engine, actor: Actor, input: { ids: unknown; paymentMethod: unknown; idempotencyKey?: unknown }) {
  const me = meOf(e, actor);
  const ids = idsOf(input.ids);
  const method = String(input.paymentMethod ?? "");
  if (method !== "balance" && method !== "qr") throw new DomainError("VALIDATION", "Elegí cómo pagás: saldo o QR");
  const key = typeof input.idempotencyKey === "string" && input.idempotencyKey ? `renewmany:${me.id}:${input.idempotencyKey.slice(0, 80)}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const pv = renewManyPreview(e, actor, ids);
    const bad = pv.rows.find((r) => !r.ok);
    if (bad) throw new DomainError("VALIDATION", `${bad.product}: ${bad.why}. Sacala de la lista y probá de nuevo.`);
    if (method === "balance" && pv.total > pv.balance) throw new DomainError("INSUFFICIENT_BALANCE", `Te falta saldo: las ${ids.length} cuestan ${fmt(pv.total)} y tenés ${fmt(pv.balance)}. Recargá o pagá con QR.`);
    const orders: Order[] = [];
    const box0 = e.s.outbox.length;
    for (const id of ids) orders.push(renew(e, actor, id, { paymentMethod: method as "balance" | "qr" }).order);
    const total = orders.reduce((t, o) => t + o.total, 0);
    // Un solo aviso por persona (no uno por cuenta): «registramos tus pedidos…» y «renovamos Netflix y Disney».
    mergeQueued(e, box0, "order_received", () => ({ total: fmt(total) }));
    mergeQueued(e, box0, "renewal_confirmed");
    e.audit(actor, "renewal.many", "customer", me.id, { count: orders.length, total, method });
    return {
      method, total, count: orders.length,
      orders: orders.map((o) => ({ id: o.id, status: o.status, total: o.total, assignmentId: o.renewal!.assignmentId, product: short(e.s.products[o.items[0].productId]?.name ?? "") })),
      expiresAt: Object.fromEntries(orders.map((o) => [o.renewal!.assignmentId, e.s.assignments[o.renewal!.assignmentId].customerExpiresAt])),
    };
  }));
}

/** Un comprobante para varios pedidos suyos: se adjunta a todos y quedan marcados como un grupo (no como «repetido»). */
export function evidenceMany(e: Engine, actor: Actor, raw: unknown, ev: { fileRef: string; declaredReference: string; hash?: string }) {
  const me = meOf(e, actor);
  const ids = idsOf(raw);
  return e.tx(() => {
    for (const id of ids) {
      const o = e.get("orders", id);
      if ((o.payerId ?? o.customerId) !== me.id) throw new DomainError("FORBIDDEN", "Ese pedido no es tuyo");
      if (o.usd !== undefined) throw new DomainError("VALIDATION", "Los pedidos en dólares se pagan uno por uno");
    }
    const box0 = e.s.outbox.length;
    const out = ids.map((id) => submitEvidence(e, actor, id, ev));
    // Al dueño le llega UN «nuevo pago para revisar» con todos los pedidos y el total (no uno por cuenta).
    mergeQueued(e, box0, "staff_payment_review", () => ({ total: fmt(out.reduce((t, o) => t + o.total, 0)) }));
    const set = new Set(ids);
    for (const id of ids) {
      const x = e.s.orders[id].evidence!;
      x.group = ids;
      if (x.duplicateOf && set.has(x.duplicateOf)) delete x.duplicateOf;
      if (x.referenceSeenIn && set.has(x.referenceSeenIn)) delete x.referenceSeenIn;
    }
    e.audit(actor, "order.evidence_group", "customer", me.id, { orders: ids.join(",").slice(0, 300), total: out.reduce((t, o) => t + o.total, 0) });
    return { ok: true as const, count: ids.length, total: out.reduce((t, o) => t + o.total, 0), orders: ids };
  });
}

/* ---------------- Dueño: aprobar juntos ---------------- */

const reviewable = (o: Order) => (o.status === "payment_review" || (o.status === "awaiting_payment" && ["qr", "local", "usdt"].includes(o.paymentMethod)))
  && (o.kind === "renewal" || o.kind === "sale") && o.usd === undefined;
const payerOfOrder = (o: Order) => o.payerId ?? o.customerId;
const refOf = (o: Order) => normRef(o.evidence?.declaredReference);

/** Pedidos ya aprobados de esa persona con esa referencia (el primero que el dueño aprobó solo, antes de verlos juntos). */
function priorOf(e: Engine, payerId: Id, n: string, except: Set<Id>): Order[] {
  if (!n) return [];
  return Object.values(e.s.orders).filter((o) => !except.has(o.id) && o.status === "fulfilled" && payerOfOrder(o) === payerId && normRef(o.confirmedReference) === n);
}

/**
 * «Un solo comprobante para varios pedidos»: pedidos por revisar de la misma persona con el mismo número de operación
 * (o mandados juntos desde GaboHub), más los que ya aprobaste con esa referencia. Solo se listan los que son 2 o más.
 */
export function paymentGroups(e: Engine, actor: Actor) {
  authorize(actor, "payment.review");
  const byKey = new Map<string, Order[]>();
  for (const o of Object.values(e.s.orders)) {
    if (!reviewable(o) || !o.evidence) continue;
    const n = refOf(o);
    if (!n) continue;
    const k = `${payerOfOrder(o)}|${n}`;
    byKey.set(k, [...(byKey.get(k) ?? []), o]);
  }
  const out = [];
  for (const [k, list] of byKey) {
    const [payerId, n] = [k.slice(0, k.indexOf("|")), k.slice(k.indexOf("|") + 1)];
    const prior = priorOf(e, payerId, n, new Set(list.map((o) => o.id)));
    if (list.length + prior.length < 2) continue;
    const row = (o: Order) => ({ id: o.id, total: o.total, status: o.status, kind: o.kind, customerName: e.s.customers[o.customerId]?.name ?? "?", product: o.items.map((it) => short(e.s.products[it.productId]?.name ?? it.productId)).join(", ") });
    const total = list.reduce((t, o) => t + o.total, 0), priorTotal = prior.reduce((t, o) => t + o.total, 0);
    out.push({
      payerId, payerName: e.s.customers[payerId]?.name ?? "?", reference: list[0].evidence!.declaredReference,
      orders: list.sort((a, b) => a.createdAt - b.createdAt).map(row), total,
      prior: prior.map(row), priorTotal, grandTotal: total + priorTotal,
    });
  }
  return out.sort((a, b) => b.grandTotal - a.grandTotal);
}

export interface ApproveGroupInput { orderIds: unknown; confirmedReference: unknown; amount: unknown; idempotencyKey?: unknown }

/**
 * Aprueba juntos varios pedidos de la MISMA persona pagados con UN comprobante. Solo si lo que llegó al banco (`amount`)
 * es exactamente la suma de esos pedidos más los que ya aprobaste con esa misma referencia. Si no, no aprueba ninguno.
 */
export function approveGroup(e: Engine, actor: Actor, input: ApproveGroupInput) {
  authorize(actor, "payment.review");
  const ids = idsOf(input.orderIds);
  const ref = String(input.confirmedReference ?? "").trim();
  if (!ref) throw new DomainError("VALIDATION", "Indicá la referencia bancaria verificada");
  const amount = Number(input.amount);
  if (!Number.isInteger(amount) || amount <= 0) throw new DomainError("VALIDATION", "Escribí cuánto llegó al banco");
  const key = typeof input.idempotencyKey === "string" && input.idempotencyKey ? `approvegroup:${input.idempotencyKey.slice(0, 80)}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const orders = ids.map((id) => e.get("orders", id));
    const payerId = payerOfOrder(orders[0]);
    for (const o of orders) {
      if (o.status === "fulfilled") throw new DomainError("ALREADY_PROCESSED", `El pedido ${o.id} ya fue aprobado`);
      if (!reviewable(o)) throw new DomainError("INVALID_STATE", `El pedido ${o.id} no se puede aprobar junto con otros (estado ${o.status})`);
      if (payerOfOrder(o) !== payerId) throw new DomainError("VALIDATION", "Solo se aprueban juntos pedidos de la misma persona");
      if (actor.customerId && actor.customerId === o.customerId) throw new DomainError("FORBIDDEN", "No podés aprobar tu propio pedido");
    }
    const n = normRef(ref);
    const set = new Set(ids);
    const prior = priorOf(e, payerId, n, set);
    const shared = new Set([...ids, ...prior.map((o) => o.id)]);
    // La referencia no puede ser de un pago de OTRA persona (eso sí es un comprobante reciclado).
    const other = Object.values(e.s.orders).find((x) => !shared.has(x.id) && x.confirmedReference && normRef(x.confirmedReference) === n);
    if (other) throw new DomainError("ALREADY_PROCESSED", `La referencia ${ref} ya se usó en el pedido ${other.id} de otra persona`);
    // La misma imagen en un pedido que no es de este grupo: es la estafa típica, se revisa uno por uno.
    for (const o of orders) {
      const d = o.evidence?.duplicateOf ? e.s.orders[o.evidence.duplicateOf] : undefined;
      if (d && !shared.has(d.id) && ["fulfilled", "payment_review", "awaiting_payment"].includes(d.status)) throw new DomainError("DUPLICATE_EVIDENCE", `El comprobante del pedido ${o.id} ya se usó en el pedido ${d.id}, que no es de este grupo. Revisalos uno por uno.`);
    }
    const sum = orders.reduce((t, o) => t + o.total, 0), priorSum = prior.reduce((t, o) => t + o.total, 0);
    if (sum + priorSum !== amount) {
      throw new DomainError("VALIDATION", `La suma no coincide: ${orders.length === 1 ? "el pedido suma" : `los ${orders.length} pedidos suman`} ${fmt(sum)}${priorSum ? ` y ya aprobaste ${fmt(priorSum)} con esa referencia (${fmt(sum + priorSum)} en total)` : ""}, y escribiste ${fmt(amount)}. Revisá el comprobante.`);
    }
    const box0 = e.s.outbox.length;
    for (const o of orders) settleShared(e, actor, o, ref, shared);
    // Un solo «renovamos…» / «tu pedido fue confirmado» por persona.
    mergeQueued(e, box0, "renewal_confirmed");
    mergeQueued(e, box0, "order_confirmed");
    e.audit(actor, "payment.approve_group", "customer", payerId, { orders: ids.join(",").slice(0, 300), prior: prior.map((o) => o.id).join(",").slice(0, 200), amount, confirmedReference: ref });
    return { ok: true as const, approved: ids, total: sum, priorTotal: priorSum };
  }));
}
