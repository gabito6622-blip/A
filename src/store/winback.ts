// "Que vuelvan": ventas que se pueden recuperar con un WhatsApp a tiempo.
//
// Dos grupos:
//   - Pedidos sin terminar: quedaron sin pagar (más de 30 min), vencieron, se cancelaron o se
//     rechazó el pago en los últimos 7 días, y el cliente no volvió a comprar ese producto.
//   - Se les venció y no renovaron: el servicio venció hace 1 a 30 días y no tiene otro activo
//     del mismo producto.
// Entran los clientes directos de la tienda y los revendedores por sus propios alquileres; los
// clientes de un revendedor NO (le pertenecen al revendedor). Nunca se devuelven costos, correos
// ni contraseñas de las cuentas. Nada se manda solo: el panel abre wa.me y lo manda una persona.
import type { Actor, Assignment, Cents, Customer, Id, Order, OrderStatus, WinbackMark } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY, MINUTE } from "./time.js";
import { effectivePrice } from "./admin.js";

export type WinbackOutcome = "escrito" | "no_molestar";

/** Días que no vuelve a aparecer alguien según lo que se marcó. */
export const WINBACK_QUIET_DAYS: Record<WinbackOutcome, number> = { escrito: 7, no_molestar: 60 };
/** Ventanas de cada grupo. */
const ORDER_MIN_AGE = 30 * MINUTE;
const ORDER_MAX_DAYS = 7;
const EXPIRED_MIN_DAYS = 1;
const EXPIRED_MAX_DAYS = 30;
const METRIC_DAYS = 30;

export interface WinbackThing {
  kind: "pedido" | "vencido";
  productId: Id;
  product: string;
  /** Qué pasó, en palabras simples. */
  what: string;
  /** Cuándo pasó (creación del pedido o vencimiento del servicio) y hace cuántos días. */
  at: number;
  days: number;
  /** Lo que pagaría hoy (su precio efectivo). */
  amount: Cents;
  orderId?: Id;
  orderStatus?: OrderStatus;
  assignmentId?: Id;
}

export interface WinbackItem {
  customerId: Id;
  name: string;
  phone: string;
  kind: "cliente" | "revendedor";
  /** "pedido" si tiene algún pedido sin terminar; si no, "vencido". */
  group: "pedido" | "vencido";
  at: number;
  days: number;
  amount: Cents;
  things: WinbackThing[];
  message: string;
}

const ORDER_WHAT: Partial<Record<OrderStatus, string>> = {
  awaiting_payment: "Pedido sin pagar",
  expired: "Pedido que venció sin pagar",
  cancelled: "Canceló el pedido",
  rejected: "Pago rechazado",
};

const daysAgo = (now: number, t: number) => Math.max(0, Math.floor((now - t) / DAY));
const ddmm = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit" }).format(new Date(t));

function money(e: Engine, c: Cents): string {
  const sym = e.s.settings.currencySymbol || "Bs";
  return `${sym} ${c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2).replace(".", ",")}`;
}

/** "Netflix", "Netflix y Disney", "Netflix, Disney y Max". */
function joinNames(names: string[]): string {
  const u = [...new Set(names)];
  return u.length <= 1 ? (u[0] ?? "") : `${u.slice(0, -1).join(", ")} y ${u[u.length - 1]}`;
}

/** ¿Está callado ahora (le escribieron hace menos de 7 días o pidió no molestar hace menos de 60)? */
function quiet(m: WinbackMark | undefined, now: number): boolean {
  if (!m) return false;
  if (m.mutedAt !== undefined && now - m.mutedAt < WINBACK_QUIET_DAYS.no_molestar * DAY) return true;
  if (m.writtenAt !== undefined && now - m.writtenAt < WINBACK_QUIET_DAYS.escrito * DAY) return true;
  return false;
}

/** Cliente que cuenta para "Que vuelvan": existe y no es cliente de un revendedor. */
function eligible(e: Engine, customerId: Id): Customer | undefined {
  const c = e.s.customers[customerId];
  if (!c || c.resellerId) return undefined;
  return c;
}

/** Precio de hoy para un producto según la lista de quien paga (el propio cliente o revendedor). */
function priceToday(e: Engine, customerId: Id, productId: Id): Cents {
  return effectivePrice(e, { customerId, productId });
}

const productOf = (o: Order) => new Set(o.items.map((i) => i.productId));
const counts = (o: Order) => o.kind !== "topup" && !o.trial && o.channel !== "import";

function message(e: Engine, c: Customer, things: WinbackThing[]): string {
  const first = (c.name || "").trim().split(/\s+/)[0] || "";
  const store = e.s.settings.storeName || "la tienda";
  const lines = [`Hola${first ? ` ${first}` : ""} 👋 Te escribo de ${store}.`];
  const ped = things.filter((t) => t.kind === "pedido");
  const ven = things.filter((t) => t.kind === "vencido");
  if (ped.length) {
    lines.push(`Vi que quedó sin terminar tu pedido de ${joinNames(ped.map((t) => t.product))}. ¿Te ayudo a terminar tu compra? Si tuviste algún problema con el pago, contame y lo vemos juntos.`);
  }
  if (ven.length === 1) {
    const t = ven[0];
    lines.push(`Tu ${t.product} venció el ${ddmm(t.at)}. ¿Querés renovar tu ${t.product}? Sigue a ${money(e, t.amount)}. Cuando me digas, te lo dejo listo.`);
  } else if (ven.length > 1) {
    lines.push(`Tus servicios de ${joinNames(ven.map((t) => t.product))} vencieron hace unos días. ¿Querés renovarlos? Siguen a:`);
    for (const t of ven) lines.push(`• ${t.product}: ${money(e, t.amount)}`);
    lines.push("Cuando me digas, te los dejo listos.");
  }
  lines.push("¡Gracias! 🙌");
  return lines.join("\n");
}

/** Lo que entra en cada grupo, por cliente (sin aplicar las marcas). */
function collect(e: Engine): Map<Id, WinbackThing[]> {
  const now = e.now();
  const byCustomer = new Map<Id, WinbackThing[]>();
  const add = (cid: Id, t: WinbackThing) => {
    const l = byCustomer.get(cid) ?? [];
    l.push(t);
    byCustomer.set(cid, l);
  };
  const orders = Object.values(e.s.orders).filter(counts);
  const ordersOf = new Map<Id, Order[]>();
  for (const o of orders) {
    const l = ordersOf.get(o.customerId) ?? [];
    l.push(o);
    ordersOf.set(o.customerId, l);
  }

  // a. Pedidos sin terminar.
  for (const o of orders) {
    if (!eligible(e, o.customerId)) continue;
    const age = now - o.createdAt;
    if (age > ORDER_MAX_DAYS * DAY) continue;
    if (o.status === "awaiting_payment") { if (age < ORDER_MIN_AGE) continue; }
    else if (o.status !== "expired" && o.status !== "cancelled" && o.status !== "rejected") continue;
    const later = (ordersOf.get(o.customerId) ?? []).filter((x) => x.id !== o.id && x.createdAt >= o.createdAt);
    for (const pid of productOf(o)) {
      const p = e.s.products[pid];
      if (!p || !p.published) continue;
      // Ya volvió: tiene después un pedido pagado, en revisión o recién hecho (todavía pagándolo) del mismo producto.
      const back = later.some((x) => productOf(x).has(pid) && (x.status === "fulfilled" || x.status === "payment_review" || (x.status === "awaiting_payment" && now - x.createdAt < ORDER_MIN_AGE)));
      if (back) continue;
      const qty = o.items.filter((i) => i.productId === pid).reduce((s, i) => s + i.qty, 0) || 1;
      add(o.customerId, {
        kind: "pedido", productId: pid, product: p.name, what: ORDER_WHAT[o.status] ?? "Pedido sin terminar",
        at: o.createdAt, days: daysAgo(now, o.createdAt), amount: priceToday(e, o.customerId, pid) * qty, orderId: o.id, orderStatus: o.status,
      });
    }
  }

  // b. Se les venció y no renovaron.
  const assignments = Object.values(e.s.assignments);
  const liveOf = new Set(assignments.filter((a) => a.status === "active" && a.customerExpiresAt > now).map((a) => `${a.customerId}|${a.productId}`));
  const reviewing = new Set(orders.filter((o) => o.status === "payment_review").flatMap((o) => [...productOf(o)].map((pid) => `${o.customerId}|${pid}`)));
  const expiredByUs = (a: Assignment) => {
    if (a.status === "active") return true; // vencido, todavía dentro de los días de gracia
    if (a.status !== "revoked") return false; // reemplazado: el cliente sigue con otro perfil
    const last = a.history[a.history.length - 1];
    return last?.event === "revoked" && last.note === "vencido"; // lo cerró el trabajo de vencidos (no una devolución ni un "liberar")
  };
  for (const a of assignments) {
    if (a.trial || a.holdOpen || !expiredByUs(a)) continue;
    const c = eligible(e, a.customerId);
    if (!c) continue;
    const ago = now - a.customerExpiresAt;
    if (ago < EXPIRED_MIN_DAYS * DAY || ago > EXPIRED_MAX_DAYS * DAY) continue;
    const key = `${a.customerId}|${a.productId}`;
    if (liveOf.has(key) || reviewing.has(key)) continue;
    const p = e.s.products[a.productId];
    if (!p || !p.published) continue;
    add(a.customerId, {
      kind: "vencido", productId: a.productId, product: p.name, what: "Se le venció",
      at: a.customerExpiresAt, days: daysAgo(now, a.customerExpiresAt), amount: effectivePrice(e, a), assignmentId: a.id,
    });
  }
  return byCustomer;
}

/** Se escribieron en los últimos 30 días y cuántos de ellos volvieron a comprar después. */
function metric(e: Engine) {
  const now = e.now();
  let written = 0, returned = 0;
  // Última compra pagada de cada cliente (una sola pasada por los pedidos).
  const lastBuy = new Map<Id, number>();
  for (const o of Object.values(e.s.orders)) {
    if (o.status === "fulfilled" && counts(o) && o.createdAt > (lastBuy.get(o.customerId) ?? 0)) lastBuy.set(o.customerId, o.createdAt);
  }
  const bought = (cid: Id, after: number) => (lastBuy.get(cid) ?? 0) > after;
  for (const [cid, m] of Object.entries(e.s.winback ?? {})) {
    if (m.writtenAt === undefined || now - m.writtenAt > METRIC_DAYS * DAY) continue;
    written++;
    if (bought(cid, m.writtenAt)) returned++;
  }
  return { written30: written, returned30: returned };
}

export function list(e: Engine, actor: Actor) {
  authorize(actor, "customer.manage");
  const now = e.now();
  const marks = e.s.winback ?? {};
  const items: WinbackItem[] = [];
  for (const [cid, raw] of collect(e)) {
    if (quiet(marks[cid], now)) continue;
    const c = e.s.customers[cid];
    // Un mismo producto en varios pedidos: queda el más reciente. Servicios vencidos: uno por servicio.
    const seen = new Set<string>();
    const things = raw.sort((a, b) => b.at - a.at).filter((t) => {
      const k = t.kind === "pedido" ? `p|${t.productId}` : `v|${t.assignmentId}`;
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    // Si el mismo producto está como pedido y como vencido, se cobra una sola vez.
    const amount = things.reduce((s, t) => s + (t.kind === "pedido" && things.some((v) => v.kind === "vencido" && v.productId === t.productId) ? 0 : t.amount), 0);
    items.push({
      customerId: cid, name: c.name, phone: c.phone, kind: c.kind === "reseller" ? "revendedor" : "cliente",
      group: things.some((t) => t.kind === "pedido") ? "pedido" : "vencido",
      at: things[0].at, days: things[0].days, amount, things, message: message(e, c, things),
    });
  }
  items.sort((a, b) => b.at - a.at);
  const pedidos = items.filter((i) => i.group === "pedido");
  const vencidos = items.filter((i) => i.group === "vencido");
  return { pedidos, vencidos, count: items.length, amount: items.reduce((s, i) => s + i.amount, 0), ...metric(e) };
}

export function mark(e: Engine, actor: Actor, customerId: Id, outcome: WinbackOutcome) {
  authorize(actor, "customer.manage");
  if (outcome !== "escrito" && outcome !== "no_molestar") throw new DomainError("VALIDATION", "Elegí: escrito o no molestar");
  const c = e.get("customers", customerId);
  if (c.resellerId) throw new DomainError("FORBIDDEN", "Ese cliente es de un revendedor: le escribe él");
  return e.tx(() => {
    const now = e.now();
    const all = (e.s.winback ??= {});
    const m: WinbackMark = { ...(all[customerId] ?? {}), by: actor.id };
    if (outcome === "escrito") m.writtenAt = now;
    else m.mutedAt = now;
    all[customerId] = m;
    e.audit(actor, "winback.mark", "customer", customerId, { outcome });
    return { customerId, outcome, until: now + WINBACK_QUIET_DAYS[outcome] * DAY };
  });
}
