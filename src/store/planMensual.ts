// Que el cliente de la tienda se quede (revisión «en el lugar de ~30 clientes», 14/11/2026).
//
// Tres cosas, todas del cliente de la tienda (no revendedores: ellos tienen «Renovar varias juntas» en GaboHub):
//  1. «Renovar todo junto»: elige sus servicios, ve el total y paga con saldo (todo o nada) o con UN solo QR.
//     Cada servicio sigue siendo un pedido de renovación común (Finanzas, «Aprobar juntos» y avisos no cambian).
//  2. El combo no pierde el descuento: lo comprado en combo (un combo armado con sus apps, o «Armá tu combo») queda
//     marcado al entregarse (`markCombo`). Renovado TODO junto paga el descuento de combo VIGENTE (el precio actual del
//     combo, o `settings.comboDiscounts` de hoy). Renovado suelto paga precio de lista y se le avisa cuánto ahorra junto.
//     Nunca se inventa un descuento: si el combo ya no existe o no está publicado, no hay descuento.
//  3. «Plan mensual» (sin cobro automático: no hay tarjetas, nada se cobra solo): «Quiero un solo día de pago» empareja
//     las fechas al renovar todo junto. Todos pasan a vencer el mismo día: el que vence primero se renueva un mes entero y
//     los demás SOLO los días que faltan hasta ese día, con el precio proporcional (redondeado hacia abajo al centavo:
//     ni días de regalo ni un centavo de más). Se muestra antes de confirmar. Después, cada mes, «Pagar este mes» renueva todo junto.
// El precio lo decide siempre el servidor (`renewPriceFor` y los combos de hoy); el cliente solo manda qué servicios.
import type { Actor, Assignment, Cents, Customer, Id, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY } from "./time.js";
import { storeAddPeriods, storePeriodText } from "./mesModo.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { priceFor, renewPriceFor } from "./catalog.js";
import { comboDiscount, renew, renewableNow } from "./orders.js";
import { canRenewHere } from "./renovarVarias.js";
import { renewStart } from "./cobrarBien.js";
import { pendingRenewalOf } from "./renovarSinTrabas.js";
import { balance } from "./wallet.js";
import { isUsd } from "./usd.js";
import { resellerContact } from "./myReseller.js";
import { mergeQueued } from "./avisosJuntos.js";
import { commercialName } from "./subLinks.js";
import { ddmm, laDay, type DueItem } from "./expiryAlerts.js";
import { attentionHours } from "./atencion.js";

const MAX = 20;
const fmt = (c: Cents) => `Bs ${(c / 100).toFixed(2)}`;
const nameOf = (e: Engine, productId: Id) => commercialName(e.s.products[productId]?.name ?? "") || "Servicio";

/* ---------------- Marcar lo comprado en combo ---------------- */

/**
 * Al entregar una venta: las apps de un combo armado (producto «combo» con sus apps) quedan en un grupo por combo, y lo
 * comprado con el descuento «Armá tu combo» (2 o más servicios distintos) en otro. Solo marca; no cobra nada.
 */
export function markCombo(e: Engine, order: Order): void {
  if (order.kind !== "sale") return;
  const pool = order.assignmentIds.map((id) => e.s.assignments[id]).filter((a): a is Assignment => !!a && !a.combo);
  const take = (pid: Id) => { const i = pool.findIndex((a) => a.productId === pid); return i < 0 ? undefined : pool.splice(i, 1)[0]; };
  for (const it of order.items) {
    const p = e.s.products[it.productId];
    const parts = p?.kind === "combo" ? p.comboProductIds ?? [] : [];
    if (parts.length < 2) continue;
    for (let q = 0; q < it.qty; q++) for (const pid of parts) { const a = take(pid); if (a) a.combo = { group: `${order.id}:${p.id}`, productId: p.id }; }
  }
  if (!order.discount || order.discount <= 0 || order.usd !== undefined) return;
  const loose = new Set(order.items.map((it) => it.productId).filter((pid) => { const p = e.s.products[pid]; return !!p && p.kind !== "combo" && !p.resellersOnly; }));
  if (loose.size < 2) return;
  for (const a of pool) if (loose.has(a.productId)) a.combo = { group: `${order.id}:armado` };
}

/* ---------------- Quién puede ---------------- */

function meOf(e: Engine, actor: Actor): Customer {
  if (actor.role !== "customer" || !actor.customerId) throw new DomainError("FORBIDDEN", "Esto es para clientes de la tienda");
  authorize(actor, "order.create_self");
  const c = e.get("customers", actor.customerId);
  if (c.kind === "reseller") throw new DomainError("FORBIDDEN", "Esto es para clientes de la tienda");
  return c;
}
/** Por qué no puede usar «Renovar todo junto» (o "" si puede). */
function blockOf(e: Engine, c: Customer): string {
  const via = resellerContact(e, c.id);
  if (via) return `Tus servicios los renovás con ${via.name}`;
  if (isUsd(e, c.id)) return "Con precios en dólares renovás de a uno, desde cada servicio";
  return "";
}
function idsOf(raw: unknown): Id[] {
  if (!Array.isArray(raw)) throw new DomainError("VALIDATION", "Elegí al menos un servicio");
  const ids = [...new Set(raw.map(String))];
  if (!ids.length) throw new DomainError("VALIDATION", "Elegí al menos un servicio");
  if (ids.length > MAX) throw new DomainError("VALIDATION", `Hasta ${MAX} servicios por vez`);
  return ids;
}

/* ---------------- Combos ---------------- */

export interface ComboGroup { id: string; productId?: Id; name: string; members: Assignment[] }

/** Sus combos con los servicios que siguen activos a su nombre. */
export function comboGroups(e: Engine, customerId: Id): ComboGroup[] {
  const by = new Map<string, ComboGroup>();
  for (const a of Object.values(e.s.assignments)) {
    if (a.customerId !== customerId || a.status !== "active" || !a.combo) continue;
    const g = by.get(a.combo.group) ?? { id: a.combo.group, ...(a.combo.productId ? { productId: a.combo.productId } : {}), name: "", members: [] };
    g.members.push(a);
    by.set(g.id, g);
  }
  for (const g of by.values()) {
    g.members.sort((x, y) => (e.s.products[x.productId]?.name ?? "").localeCompare(e.s.products[y.productId]?.name ?? "") || x.id.localeCompare(y.id));
    g.name = g.members.map((a) => nameOf(e, a.productId)).join(" + ");
  }
  return [...by.values()].filter((g) => g.members.length >= 2);
}

/**
 * Descuento de combo VIGENTE si renueva todo el grupo junto: combo armado → lo que suman sus apps menos el precio de hoy
 * del combo (si sigue publicado y están todas sus apps); «Armá tu combo» → `comboDiscounts` de hoy por cantidad.
 */
export function groupDiscount(e: Engine, payerId: Id, g: ComboGroup): Cents {
  const list = g.members.reduce((t, a) => t + renewPriceFor(e, payerId, a), 0);
  if (g.productId) {
    const p = e.s.products[g.productId];
    const parts = p?.kind === "combo" && p.published ? p.comboProductIds ?? [] : [];
    if (parts.length < 2) return 0;
    const counts = parts.map((pid) => g.members.filter((a) => a.productId === pid).length);
    const sets = counts[0];
    if (!sets || counts.some((n) => n !== sets) || g.members.length !== sets * parts.length) return 0;
    return Math.max(0, list - priceFor(e, payerId, p!.id) * sets);
  }
  return Math.max(0, Math.min(list, comboDiscount(e, payerId, g.members.map((a) => a.productId), "store")));
}

/** Reparte el descuento entre los servicios del combo, proporcional a su precio (los centavos que sobran, al más caro). */
function shares(total: Cents, prices: Cents[]): Cents[] {
  const sum = prices.reduce((t, p) => t + p, 0);
  if (!total || !sum) return prices.map(() => 0);
  const raw = prices.map((p) => (total * p) / sum);
  const out = raw.map(Math.floor);
  let left = total - out.reduce((t, v) => t + v, 0);
  const order = raw.map((v, i) => [v - Math.floor(v), prices[i], i] as const).sort((a, b) => b[0] - a[0] || b[1] - a[1]);
  for (const [, , i] of order) { if (left <= 0) break; out[i]++; left--; }
  return out;
}

/* ---------------- Vista previa y renovar todo junto ---------------- */

export interface RenewAllRow {
  assignmentId: Id; product: string; email: string; expiresAt: number; from: number; to: number; days: number;
  /** Cómo se dice lo que cubre: «1 mes» (o «30 días», según la tienda) si es un período entero; si no, «20 días». */
  period: string;
  list: Cents; discount: Cents; price: Cents; ok: boolean; why?: string; combo?: string;
}

/** Lo que va a pagar por renovar esos servicios suyos (con combos y, si `align`, días proporcionales). No cambia nada. */
export function renewAllPreview(e: Engine, actor: Actor, raw: { ids?: unknown; align?: unknown }) {
  const me = meOf(e, actor);
  const block = blockOf(e, me);
  if (block) throw new DomainError("VALIDATION", block);
  const ids = idsOf(raw.ids);
  const align = raw.align === true;
  const now = e.now();
  const rows: RenewAllRow[] = ids.map((id) => {
    const a = e.s.assignments[id];
    if (!a || a.customerId !== me.id) throw new DomainError("FORBIDDEN", "Ese servicio no es tuyo");
    const prod = e.s.products[a.productId];
    const acc = e.s.accounts[e.s.slots[a.slotId]?.accountId ?? ""];
    const pend = a.status === "active" ? pendingRenewalOf(e, a.id) : undefined;
    const from = renewStart(a, now), dur = prod?.durationDays ?? 30;
    const why = a.status !== "active" ? "ya no está activo"
      : !canRenewHere(e, me.id, a) ? "este lo renueva la tienda: escribinos por WhatsApp"
      : !align && !renewableNow(e, a) ? `todavía no se puede renovar desde acá: tocá «📩 Pedir renovación» y te avisamos cuando esté lista. Tu cuenta sigue andando hasta el ${ddmm(a.customerExpiresAt)}`
      : pend ? (pend.status === "payment_review" ? "ya mandaste el comprobante: lo estamos revisando" : "ya tenés un pedido por QR esperando el pago")
      : "";
    const list = renewPriceFor(e, me.id, a);
    return { assignmentId: a.id, product: nameOf(e, a.productId), email: acc?.email ?? "", expiresAt: a.customerExpiresAt, from, to: storeAddPeriods(e, from, dur), days: dur, period: storePeriodText(e, dur), list, discount: 0, price: list, ok: !why, ...(why ? { why } : {}) };
  });
  // Un solo día de pago: todos hasta la misma fecha (un período desde el que vence primero). Primero qué entra…
  let until: number | null = null;
  if (align) {
    const okRows = rows.filter((r) => r.ok);
    if (okRows.length) {
      const durOf = (r: RenewAllRow) => e.s.products[e.s.assignments[r.assignmentId].productId]?.durationDays ?? 30;
      const dur = Math.min(...okRows.map(durOf));
      until = storeAddPeriods(e, Math.min(...okRows.map((r) => r.from)), dur);
      for (const r of okRows) {
        const a = e.s.assignments[r.assignmentId];
        const acc = e.s.accounts[e.s.slots[a.slotId]?.accountId ?? ""];
        const why = durOf(r) !== dur ? `dura ${durOf(r)} días: no entra en el mismo día de pago (sacalo y renovalo aparte)`
          : r.from >= until ? `ya está pagado hasta el ${ddmm(r.from)}, después de tu día de pago`
          : acc && until > acc.supplierExpiresAt ? `todavía no se puede renovar desde acá: tocá «📩 Pedir renovación» y te avisamos cuando esté lista. Tu cuenta sigue andando hasta el ${ddmm(a.customerExpiresAt)}`
          : "";
        if (why) { r.ok = false; r.why = why; }
      }
    }
  }
  // Combos: el descuento vale si van TODOS los servicios del combo y se pueden renovar todos.
  const hints: { name: string; missing: string[]; save: Cents }[] = [];
  for (const g of comboGroups(e, me.id)) {
    const sel = rows.filter((r) => g.members.some((m) => m.id === r.assignmentId));
    if (!sel.length) continue;
    const save = groupDiscount(e, me.id, g);
    for (const r of sel) r.combo = g.name;
    if (sel.length === g.members.length && sel.every((r) => r.ok)) {
      const sh = shares(save, sel.map((r) => r.list));
      sel.forEach((r, i) => { r.discount = sh[i]; r.price = r.list - sh[i]; });
    } else if (save > 0) {
      hints.push({ name: g.name, missing: g.members.filter((m) => !sel.some((r) => r.assignmentId === m.id && r.ok)).map((m) => nameOf(e, m.productId)), save });
    }
  }
  // …y después el precio proporcional (con el descuento del combo también proporcional), al centavo.
  if (until !== null) {
    for (const r of rows.filter((x) => x.ok)) {
      const d = e.s.products[e.s.assignments[r.assignmentId].productId]?.durationDays ?? 30;
      const frac = Math.min(1, (until - r.from) / Math.max(1, storeAddPeriods(e, r.from, d) - r.from));
      r.to = until;
      r.days = Math.round(((until - r.from) / DAY) * 10) / 10;
      r.period = frac === 1 ? storePeriodText(e, d) : `${String(r.days).replace(".", ",")} ${r.days === 1 ? "día" : "días"}`;
      r.price = Math.floor((r.list - r.discount) * frac + 1e-9); // hacia abajo: nunca un centavo de más
      r.discount = Math.round(r.discount * frac);
    }
  }
  const ok = rows.filter((r) => r.ok);
  return {
    rows, ok: rows.every((r) => r.ok),
    total: ok.reduce((t, r) => t + r.price, 0), discount: ok.reduce((t, r) => t + r.discount, 0), listTotal: ok.reduce((t, r) => t + r.list, 0),
    hints, balance: balance(e, me.id), until,
  };
}

/**
 * Renueva esos servicios suyos juntos. Con saldo: todo o nada, en una sola transacción. Con QR: un pedido por servicio,
 * todos esperando UN comprobante (`/api/me/renew-many/evidence`) que el dueño aprueba con «Aprobar juntos».
 * `plan: true` además los guarda como su plan mensual.
 */
export function renewAll(e: Engine, actor: Actor, input: { ids?: unknown; align?: unknown; paymentMethod?: unknown; idempotencyKey?: unknown; plan?: unknown }) {
  const me = meOf(e, actor);
  const method = String(input.paymentMethod ?? "");
  if (method !== "balance" && method !== "qr") throw new DomainError("VALIDATION", "Elegí cómo pagás: saldo o QR");
  const key = typeof input.idempotencyKey === "string" && input.idempotencyKey ? `renewall:${me.id}:${input.idempotencyKey.slice(0, 80)}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const pv = renewAllPreview(e, actor, input);
    const bad = pv.rows.find((r) => !r.ok);
    if (bad) throw new DomainError("VALIDATION", `${bad.product}: ${bad.why}. Sacalo de la lista y probá de nuevo.`);
    if (method === "balance" && pv.total > pv.balance) throw new DomainError("INSUFFICIENT_BALANCE", `Te falta saldo: ${pv.rows.length === 1 ? "cuesta" : `los ${pv.rows.length} cuestan`} ${fmt(pv.total)} y tenés ${fmt(pv.balance)}. Recargá o pagá con QR.`);
    const box0 = e.s.outbox.length;
    const orders: Order[] = [];
    for (const r of pv.rows) {
      const deal = r.discount || pv.until !== null ? { deal: { total: r.price, discount: r.discount, ...(pv.until !== null ? { until: r.to } : {}) } } : {};
      orders.push(renew(e, actor, r.assignmentId, { paymentMethod: method as "balance" | "qr", ...deal }).order);
    }
    const total = orders.reduce((t, o) => t + o.total, 0);
    mergeQueued(e, box0, "order_received", () => ({ total: fmt(total) }));
    mergeQueued(e, box0, "renewal_confirmed");
    if (input.plan === true) setPlanIds(e, me, pv.rows.map((r) => r.assignmentId));
    e.audit(actor, "renewal.all", "customer", me.id, { count: orders.length, total, discount: pv.discount, method, align: pv.until !== null });
    return {
      method, total, discount: pv.discount, count: orders.length, until: pv.until,
      orders: orders.map((o) => ({ id: o.id, status: o.status, total: o.total, assignmentId: o.renewal!.assignmentId, product: nameOf(e, o.items[0].productId) })),
      expiresAt: Object.fromEntries(orders.map((o) => [o.renewal!.assignmentId, e.s.assignments[o.renewal!.assignmentId].customerExpiresAt])),
    };
  }));
}

/* ---------------- Plan mensual ---------------- */

function setPlanIds(e: Engine, me: Customer, ids: Id[]) {
  me.plan = { ids: [...new Set(ids)].slice(0, MAX), since: e.now() };
}

/** Prende («Quiero un solo día de pago») o apaga su plan. No cobra nada. */
export function setPlan(e: Engine, actor: Actor, input: { on?: unknown; ids?: unknown }) {
  const me = meOf(e, actor);
  if (typeof input.on !== "boolean") throw new DomainError("VALIDATION", "Decí sí o no");
  return e.tx(() => {
    if (input.on) {
      const block = blockOf(e, me);
      if (block) throw new DomainError("VALIDATION", block);
      const ids = idsOf(input.ids);
      for (const id of ids) {
        const a = e.s.assignments[id];
        if (!a || a.customerId !== me.id) throw new DomainError("FORBIDDEN", "Ese servicio no es tuyo");
        if (a.status !== "active") throw new DomainError("VALIDATION", "Ese servicio ya no está activo");
      }
      setPlanIds(e, me, ids);
    } else delete me.plan;
    e.audit(actor, "plan.set", "customer", me.id, { on: input.on, count: me.plan?.ids.length ?? 0 });
    return planView(e, actor);
  });
}

/** Lo que ve en «Mis cuentas»: sus combos, su plan (próximo pago y cuánto), fallas abiertas y el horario. */
export function planView(e: Engine, actor: Actor) {
  const me = meOf(e, actor);
  const block = blockOf(e, me);
  const fallas: Record<Id, string> = {};
  for (const t of Object.values(e.s.tickets ?? {})) if (t.customerId === me.id && t.status !== "solucionado") fallas[t.assignmentId] = t.status;
  const base = { fallas, hours: attentionHours(e) };
  if (block) return { ...base, available: false, why: block, groups: [], plan: null };
  const quote = (ids: Id[], align: boolean) => { try { return renewAllPreview(e, actor, { ids, align }); } catch { return null; } };
  const groups = comboGroups(e, me.id).map((g) => {
    const q = quote(g.members.map((a) => a.id), false);
    return { id: g.id, name: g.name, ids: g.members.map((a) => a.id), discount: groupDiscount(e, me.id, g), total: q?.total ?? null, ok: !!q?.ok };
  });
  const members = (me.plan?.ids ?? []).map((id) => e.s.assignments[id]).filter((a): a is Assignment => !!a && a.customerId === me.id && a.status === "active")
    .sort((x, y) => nameOf(e, x.productId).localeCompare(nameOf(e, y.productId)));
  let plan = null;
  if (members.length) {
    const aligned = new Set(members.map((a) => laDay(a.customerExpiresAt))).size === 1;
    const ids = members.map((a) => a.id);
    const q = quote(ids, !aligned);
    const nextAt = Math.min(...members.map((a) => a.customerExpiresAt));
    plan = { ids, names: members.map((a) => nameOf(e, a.productId)), nextAt, aligned, total: q?.total ?? null, ok: !!q?.ok, ...(q && !q.ok ? { why: q.rows.find((r) => !r.ok)?.why } : {}), since: me.plan!.since };
  }
  return { ...base, available: true, groups, plan };
}

/**
 * Aviso al celular de su plan (3 días antes, 1 día antes y el día): «🔔 Tu plan vence mañana (15/12)» con el toque a
 * «Pagar este mes». null si nada de lo que vence es de su plan. Sin montos (como todos los avisos al celular).
 */
export function planAlert(e: Engine, customerId: Id, items: DueItem[]): { title: string; body: string; url: string } | null {
  const c = e.s.customers[customerId];
  const ids = new Set(c?.plan?.ids ?? []);
  if (!ids.size || c?.kind === "reseller" || resellerContact(e, customerId)) return null;
  const mine = items.filter((it) => it.key.startsWith("a:") && ids.has(it.key.slice(2)));
  if (!mine.length) return null;
  const rest = items.filter((it) => !mine.includes(it));
  const first = mine.reduce((x, y) => (y.expiresAt < x.expiresAt ? y : x));
  const when = first.days === 0 ? "hoy" : first.days === 1 ? "mañana" : `en ${first.days} días`;
  const names = [...new Set(mine.map((it) => it.product))].join(" + ");
  const also = rest.length ? ` También vence: ${rest.slice(0, 2).map((it) => `${it.product} (${ddmm(it.expiresAt)})`).join(", ")}.` : "";
  return { title: `🔔 Tu plan vence ${when} (${ddmm(first.expiresAt)})`.slice(0, 120), body: `${names}. Tocá para pagar este mes.${also}`.slice(0, 180), url: "/tienda/?pagar=plan#cuentas" };
}
