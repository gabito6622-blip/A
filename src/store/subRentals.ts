// Repartir perfiles: el revendedor alquila una cuenta completa (Disney, Prime, HBO…) y la reparte entre
// SUS clientes, un perfil a cada uno. Acá anota quién está en cada perfil, cuándo le vence, cuánto le
// cobra y si le pagó: es su cuaderno. Solo él lo ve y lo toca; el dueño no ve estos datos.
import type { Actor, Assignment, Cents, Id, SubRental } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { phoneWithCountry, priceFor, visibleTo } from "./catalog.js";
import { renewableNow } from "./orders.js";
import { dialFor, isForeign, maxAmount, normAmount, currencyOf } from "./country.js";

const DAY = 86_400_000;
const MAX_PROFILES = 10;

export function me(e: Engine, actor: Actor) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return e.get("customers", actor.customerId);
}
/** Una cuenta completa alquilada a nombre del revendedor. */
export function rental(e: Engine, meId: Id, assignmentId: Id): Assignment {
  const a = e.s.assignments[assignmentId];
  if (!a || a.customerId !== meId) throw new DomainError("FORBIDDEN", "Esa cuenta no es tuya");
  if (a.status !== "active") throw new DomainError("VALIDATION", "Esa cuenta ya no está activa");
  if (e.s.products[a.productId]?.kind !== "full_account") throw new DomainError("VALIDATION", "Solo se reparten cuentas completas");
  return a;
}
// El link de cobro sale solo como su token (sin quién ni cuándo lo creó).
const view = ({ link, ...s }: SubRental) => ({ ...s, ...(link ? { linkToken: link.token } : {}) });

/** Sus cuentas completas alquiladas, cada una con sus perfiles repartidos. */
export function listMine(e: Engine, actor: Actor) {
  const c = me(e, actor);
  return Object.values(e.s.assignments)
    .filter((a) => a.customerId === c.id && a.status === "active" && e.s.products[a.productId]?.kind === "full_account")
    .sort((x, y) => x.customerExpiresAt - y.customerExpiresAt)
    .map((a) => {
      const slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
      return {
        assignmentId: a.id, productId: a.productId, product: (e.s.products[a.productId]?.name ?? "").replace(/ \(alquiler revendedores\)/, ""),
        email: acc?.email ?? "", expiresAt: a.customerExpiresAt, holdOpen: !!a.holdOpen,
        cost: a.control?.price ?? priceFor(e, c.id, a.productId),
        canRenew: !!e.s.products[a.productId] && visibleTo(e, e.s.products[a.productId], c.id), renewableNow: renewableNow(e, a),
        subs: (a.subs ?? []).slice().sort((x, y) => x.expiresAt - y.expiresAt).map(view),
      };
    });
}

function clean(e: Engine, actor: Actor, raw: Record<string, unknown>, now: number) {
  const label = String(raw.label ?? "").trim().slice(0, 30);
  const name = String(raw.name ?? "").trim();
  if (!name || name.length > 80) throw new DomainError("VALIDATION", "Poné el nombre de tu cliente");
  const phone = raw.phone ? phoneWithCountry(String(raw.phone), dialFor(e, actor)) : "";
  if (phone && phone.replace(/\D/g, "").length < 7) throw new DomainError("VALIDATION", "WhatsApp inválido");
  const expiresAt = Number(raw.expiresAt);
  if (!Number.isFinite(expiresAt) || expiresAt < now - 365 * DAY || expiresAt > now + 400 * DAY) throw new DomainError("VALIDATION", "Fecha de vencimiento inválida");
  let price: Cents | undefined;
  if (raw.price !== undefined && raw.price !== null && raw.price !== "") {
    // Lo que le cobra a SU cliente va en su moneda (₲ sin decimales y con más lugar).
    const c = actor.customerId ? e.s.customers[actor.customerId] : undefined;
    price = isForeign(e, c) ? normAmount(Number(raw.price), currencyOf(e, c)) : Math.round(Number(raw.price));
    if (!Number.isInteger(price) || price < 0 || price > maxAmount(e, c)) throw new DomainError("VALIDATION", "Precio inválido");
  }
  const pay = String(raw.pay ?? "pagado") as SubRental["pay"];
  if (!["pagado", "pendiente", "no_pago"].includes(pay)) throw new DomainError("VALIDATION", "Estado de pago inválido");
  const note = String(raw.note ?? "").trim();
  if (note.length > 120) throw new DomainError("VALIDATION", "La nota va hasta 120 letras");
  return { label, name, phone, expiresAt, price, pay, note: note || undefined };
}

/** Agregar o corregir un perfil repartido. */
export function saveSub(e: Engine, actor: Actor, assignmentId: Id, raw: Record<string, unknown>) {
  const c = me(e, actor);
  const v = clean(e, actor, raw ?? {}, e.now());
  return e.tx(() => {
    const a = rental(e, c.id, assignmentId);
    const list = (a.subs ??= []);
    const id = typeof raw?.id === "string" ? raw.id : "";
    let s = id ? list.find((x) => x.id === id) : undefined;
    if (id && !s) throw new DomainError("NOT_FOUND", "Ese perfil no existe");
    if (!s) {
      if (list.length >= MAX_PROFILES) throw new DomainError("VALIDATION", `Hasta ${MAX_PROFILES} perfiles por cuenta`);
      s = { id: e.id("sub"), label: v.label || `Perfil ${list.length + 1}`, name: v.name, phone: v.phone, expiresAt: v.expiresAt, pay: v.pay, createdAt: e.now() };
      list.push(s);
    }
    Object.assign(s, { label: v.label || s.label, name: v.name, phone: v.phone, expiresAt: v.expiresAt, pay: v.pay });
    if (v.price === undefined) delete s.price; else s.price = v.price;
    if (v.note) s.note = v.note; else delete s.note;
    e.audit(actor, "reseller.sub_save", "assignment", a.id, { sub: s.id });
    return { sub: view(s), afterRental: s.expiresAt > a.customerExpiresAt && !a.holdOpen };
  });
}

/** Su cliente renovó: el perfil suma un período (como la cuenta) y queda Pagado o Pendiente. */
export function renewSub(e: Engine, actor: Actor, assignmentId: Id, subId: Id, paid = true) {
  const c = me(e, actor);
  return e.tx(() => {
    const a = rental(e, c.id, assignmentId);
    const s = (a.subs ?? []).find((x) => x.id === subId);
    if (!s) throw new DomainError("NOT_FOUND", "Ese perfil no existe");
    const days = e.s.products[a.productId]?.durationDays ?? 30;
    s.expiresAt = Math.max(s.expiresAt, e.now()) + days * DAY;
    s.pay = paid ? "pagado" : "pendiente";
    e.audit(actor, "reseller.sub_renew", "assignment", a.id, { sub: s.id });
    return { sub: view(s), afterRental: s.expiresAt > a.customerExpiresAt && !a.holdOpen };
  });
}

export function removeSub(e: Engine, actor: Actor, assignmentId: Id, subId: Id) {
  const c = me(e, actor);
  return e.tx(() => {
    const a = rental(e, c.id, assignmentId);
    const i = (a.subs ?? []).findIndex((x) => x.id === subId);
    if (i === -1) throw new DomainError("NOT_FOUND", "Ese perfil no existe");
    const [gone] = a.subs!.splice(i, 1); // si tenía link de cobro, deja de servir con el perfil
    e.audit(actor, "reseller.sub_remove", "assignment", a.id, { sub: subId, ...(gone.link ? { linkOff: true } : {}) });
    return { ok: true as const };
  });
}

/** Lo que dejan sus cuentas alquiladas por mes: lo que te cuestan vs lo que cobrás por los perfiles. */
export function rentalSummary(e: Engine, actor: Actor) {
  const list = listMine(e, actor);
  const cost = list.reduce((t, r) => t + r.cost, 0);
  const revenue = list.reduce((t, r) => t + r.subs.reduce((u, s) => u + (s.price ?? 0), 0), 0);
  const unpaid = list.flatMap((r) => r.subs.filter((s) => s.pay !== "pagado").map((s) => ({ ...s, assignmentId: r.assignmentId, product: r.product })));
  // Revendedor de otro país: lo que cobra (su moneda) y lo que le cuestan (Bs) no se restan.
  const split = isForeign(e, e.s.customers[actor.customerId!]);
  return {
    accounts: list.length, profiles: list.reduce((t, r) => t + r.subs.length, 0), cost, revenue, profit: split ? null : revenue - cost, ...(split ? { split: true as const } : {}),
    unpaid, owed: unpaid.reduce((t, s) => t + (s.price ?? 0), 0),
  };
}
