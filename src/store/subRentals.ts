// Repartir perfiles: el revendedor alquila una cuenta completa (Disney, Prime, HBO…) y la reparte entre
// SUS clientes, un perfil a cada uno. Acá anota quién está en cada perfil, cuándo le vence, cuánto le
// cobra y si le pagó: es su cuaderno. Solo él lo ve y lo toca; el dueño no ve estos datos.
import { canRenewHere } from "./renovarVarias.js";
import type { Actor, Assignment, Cents, Id, SubRental } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { phoneWithCountry, renewPriceFor } from "./catalog.js";
import { renewableNow } from "./orders.js";
import { dialFor, isForeign, maxAmount, normAmount, currencyOf } from "./country.js";
import { amountIn, applyPayment, chargePeriod, markCurrentUnpaid, payNow, recordCobro, subMoney, uncollect } from "./cuadernoPlata.js";

const DAY = 86_400_000;
export const MAX_PROFILES = 10;

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
// El link de cobro sale solo como su token (sin quién ni cuándo lo creó). Con lo que debe hoy (cuadernoPlata.ts):
// `pay` es el estado real («pendiente» si debe algo, aunque sea un período vencido sin renovar).
export const subView = (e: Engine, a: Assignment, { link, debts: _d, credit: _c, ...s }: SubRental) => {
  const m = subMoney(e, a, { link, ...s, ...(_d ? { debts: _d } : {}), ...(_c ? { credit: _c } : {}) } as SubRental);
  return { ...s, pay: m.pay, owed: m.owed, ...(m.credit ? { credit: m.credit } : {}), periods: m.periods, ...(link ? { linkToken: link.token } : {}) };
};

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
        cost: renewPriceFor(e, c.id, a),
        canRenew: canRenewHere(e, c.id, a), renewableNow: renewableNow(e, a),
        subs: (a.subs ?? []).slice().sort((x, y) => x.expiresAt - y.expiresAt).map((x) => subView(e, a, x)),
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

/**
 * Agregar o corregir un perfil repartido. Si es nuevo y «Pagado», lo que cobra se anota como cobro; «Pendiente» deja
 * el período debiendo. Al corregir: pasar a «Pagado» cobra todo lo que debía; pasar a «Pendiente» deja debiendo el
 * período actual (y descuenta lo que se había anotado como cobrado). Cambiar el precio no toca lo que ya debe.
 */
export function saveSub(e: Engine, actor: Actor, assignmentId: Id, raw: Record<string, unknown>) {
  const c = me(e, actor);
  const v = clean(e, actor, raw ?? {}, e.now());
  return e.tx(() => {
    const a = rental(e, c.id, assignmentId);
    const list = (a.subs ??= []);
    const id = typeof raw?.id === "string" ? raw.id : "";
    let s = id ? list.find((x) => x.id === id) : undefined;
    if (id && !s) throw new DomainError("NOT_FOUND", "Ese perfil no existe");
    const isNew = !s;
    const was = s ? subMoney(e, a, s) : null;
    if (!s) {
      if (list.length >= MAX_PROFILES) throw new DomainError("VALIDATION", `Hasta ${MAX_PROFILES} perfiles por cuenta`);
      s = { id: e.id("sub"), label: v.label || `Perfil ${list.length + 1}`, name: v.name, phone: v.phone, expiresAt: v.expiresAt, pay: "pagado", createdAt: e.now() };
      list.push(s);
    }
    Object.assign(s, { label: v.label || s.label, name: v.name, phone: v.phone, expiresAt: v.expiresAt });
    if (v.price === undefined) delete s.price; else s.price = v.price;
    if (v.note) s.note = v.note; else delete s.note;
    if (isNew) {
      if (v.pay === "pagado") recordCobro(e, a, s, s.price ?? 0, { note: "Cobrado al anotarlo" });
      else markCurrentUnpaid(e, a, s, v.pay);
    } else if (v.pay === "pagado" && was!.pay !== "pagado") {
      const owed = subMoney(e, a, s).owed;
      if (owed > 0) { applyPayment(e, a, s, owed); recordCobro(e, a, s, owed, { note: "Marcado pagado" }); }
      else s.pay = "pagado";
    } else if (v.pay !== "pagado" && was!.pay === "pagado") {
      markCurrentUnpaid(e, a, s, v.pay);
      uncollect(e, a, s, subMoney(e, a, s).owed);
    } else if (v.pay !== "pagado") s.pay = v.pay;
    e.audit(actor, "reseller.sub_save", "assignment", a.id, { sub: s.id });
    return { sub: subView(e, a, s), afterRental: s.expiresAt > a.customerExpiresAt && !a.holdOpen };
  });
}

/**
 * Su cliente renovó: el perfil suma un período. Pagado = cobra su precio (primero lo que ya venció, sin días gratis);
 * «me paga después» = el período queda debiendo. Sin precio cargado, corre la fecha como antes.
 */
export function renewSub(e: Engine, actor: Actor, assignmentId: Id, subId: Id, paid = true) {
  const c = me(e, actor);
  return e.tx(() => {
    const a = rental(e, c.id, assignmentId);
    const s = (a.subs ?? []).find((x) => x.id === subId);
    if (!s) throw new DomainError("NOT_FOUND", "Ese perfil no existe");
    const days = e.s.products[a.productId]?.durationDays ?? 30;
    if (!(s.price && s.price > 0)) { s.expiresAt = Math.max(s.expiresAt, e.now()) + days * DAY; if (paid) s.pay = "pagado"; else s.pay = "pendiente"; }
    else if (paid) {
      // Cobra el período que renueva (lo que debía de antes sigue anotado aparte).
      const before = JSON.stringify(s);
      chargePeriod(e, a, s, s.price);
      recordCobro(e, a, s, s.price, { note: "Renovó", before });
    } else chargePeriod(e, a, s);
    e.audit(actor, "reseller.sub_renew", "assignment", a.id, { sub: s.id });
    return { sub: subView(e, a, s), afterRental: s.expiresAt > a.customerExpiresAt && !a.holdOpen };
  });
}

/** «Me pagó» desde Repartir perfiles o Quién me debe (también de una cuenta que se cortó: lo que debía hasta el corte). */
export function paySub(e: Engine, actor: Actor, assignmentId: Id, subId: Id, raw?: unknown) {
  const c = me(e, actor);
  const amount = raw === undefined || raw === null || raw === "" ? undefined : amountIn(e, actor, raw);
  return e.tx(() => {
    const a = e.s.assignments[assignmentId];
    if (!a || a.customerId !== c.id || e.s.products[a.productId]?.kind !== "full_account") throw new DomainError("FORBIDDEN", "Esa cuenta no es tuya");
    const s = (a.subs ?? []).find((x) => x.id === subId);
    if (!s) throw new DomainError("NOT_FOUND", "Ese perfil no existe");
    const r = payNow(e, actor, a, s, amount);
    return { ...r, sub: subView(e, a, s) };
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
  const unpaid = list.flatMap((r) => r.subs.filter((s) => s.owed > 0 || s.pay !== "pagado").map((s) => ({ ...s, assignmentId: r.assignmentId, product: r.product })));
  // Revendedor de otro país: lo que cobra (su moneda) y lo que le cuestan (Bs) no se restan.
  const split = isForeign(e, e.s.customers[actor.customerId!]);
  return {
    accounts: list.length, profiles: list.reduce((t, r) => t + r.subs.length, 0), cost, revenue, profit: split ? null : revenue - cost, ...(split ? { split: true as const } : {}),
    unpaid, owed: unpaid.reduce((t, s) => t + s.owed, 0),
  };
}
