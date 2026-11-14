// Cuando se corta una cuenta que el revendedor alquila (14/11/2026): su cuaderno NO desaparece.
// Antes «Repartir perfiles» solo mostraba alquileres activos: al cortarse su HBO, Nina y Óscar (y lo que le debían) se
// borraban de la pantalla. Ahora:
//  - queda «✂️ Se cortó tu HBO: tus 2 clientes (Nina, Óscar)», con lo que le deben hasta el corte;
//  - si alquila o tiene otra cuenta del mismo producto, «Pasar a mi cuenta nueva» lleva los clientes con su fecha, su
//    precio y su deuda (más los días que estuvieron sin servicio, para que nadie pierda días);
//  - si el dueño reactiva la cuenta cortada, el cuaderno vuelve solo (los perfiles siguen guardados en ese alquiler).
// Solo el revendedor dueño de los dos alquileres puede mover; los datos nunca salen de sus alquileres.
import type { Actor, Assignment, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart } from "./time.js";
import { normalizeSub, periodOf, runsUntil, subMoney } from "./cuadernoPlata.js";
import { MAX_PROFILES } from "./subRentals.js";

const short = (n: string) => n.replace(/ \(alquiler revendedores\)/, "");
function meOf(actor: Actor): Id {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return actor.customerId;
}
const isRental = (e: Engine, a: Assignment | undefined, meId: Id): a is Assignment =>
  !!a && a.customerId === meId && e.s.products[a.productId]?.kind === "full_account";

/** Sus alquileres cortados que todavía tienen clientes anotados, y a qué cuenta suya los puede pasar. */
export function myCuts(e: Engine, actor: Actor) {
  const meId = meOf(actor), now = e.now();
  const mine = Object.values(e.s.assignments).filter((a) => isRental(e, a, meId));
  return mine.filter((a) => a.status === "revoked" && a.subs?.length).map((a) => {
    const cutAt = runsUntil(a, now);
    return {
      assignmentId: a.id, productId: a.productId, product: short(e.s.products[a.productId]?.name ?? ""), cutAt,
      clients: a.subs!.map((s) => ({ id: s.id, name: s.name, phone: s.phone ?? "", label: s.label, expiresAt: s.expiresAt, price: s.price ?? null, owed: subMoney(e, a, s, now).owed })),
      targets: mine.filter((t) => t.status === "active" && t.productId === a.productId)
        .map((t) => ({ assignmentId: t.id, email: e.s.accounts[e.s.slots[t.slotId]?.accountId]?.email ?? "", expiresAt: t.customerExpiresAt, free: MAX_PROFILES - (t.subs?.length ?? 0) }))
        .sort((x, y) => y.free - x.free || y.expiresAt - x.expiresAt),
    };
  }).sort((x, y) => y.cutAt - x.cutAt);
}

/**
 * «Pasar a mi cuenta nueva»: los clientes anotados en un alquiler cortado pasan a otro alquiler suyo activo del mismo
 * producto. Lo que debían hasta el corte queda guardado como deuda; los días sin servicio (del corte a hoy) se les suman.
 */
export function moveCut(e: Engine, actor: Actor, fromId: Id, toId: Id) {
  const meId = meOf(actor);
  return e.tx(() => {
    const from = e.s.assignments[fromId], to = e.s.assignments[toId];
    if (!isRental(e, from, meId) || !isRental(e, to, meId)) throw new DomainError("FORBIDDEN", "Esa cuenta no es tuya");
    if (from.status === "active") throw new DomainError("VALIDATION", "Esa cuenta sigue andando: no hace falta pasar a nadie");
    if (to.status !== "active") throw new DomainError("VALIDATION", "La cuenta nueva no está activa");
    if (from.productId !== to.productId) throw new DomainError("VALIDATION", "Tiene que ser una cuenta del mismo producto");
    const subs = from.subs ?? [];
    if (!subs.length) throw new DomainError("VALIDATION", "No hay clientes para pasar");
    if ((to.subs?.length ?? 0) + subs.length > MAX_PROFILES) throw new DomainError("VALIDATION", `En esa cuenta entran ${MAX_PROFILES - (to.subs?.length ?? 0)} y son ${subs.length}: quitá a alguien antes`);
    const now = e.now(), cutAt = runsUntil(from, now), P = periodOf(e, from);
    const gapDays = Math.max(0, Math.floor((boDayStart(now) - boDayStart(cutAt)) / DAY));
    for (const s of subs) {
      normalizeSub(e, from, s);
      // Lo que ya debía hasta el corte queda guardado (en la cuenta nueva se sigue contando desde su fecha).
      while (boDayStart(s.expiresAt) <= boDayStart(cutAt)) {
        if ((s.price ?? 0) > 0) (s.debts ??= []).push({ from: s.expiresAt, to: s.expiresAt + P, amount: s.price!, paid: 0 });
        s.expiresAt += P;
      }
      if (s.debts?.length) s.pay = s.pay === "no_pago" ? "no_pago" : "pendiente";
      if (gapDays) s.expiresAt += gapDays * DAY;
    }
    (to.subs ??= []).push(...subs);
    delete from.subs;
    e.audit(actor, "reseller.subs_move_cut", "assignment", to.id, { from: from.id, moved: subs.length, gapDays });
    return { ok: true as const, moved: subs.length, gapDays, names: subs.map((s) => s.name) };
  });
}

/** «Ya no los tengo»: borra el cuaderno de una cuenta cortada (con lo que le debían). Solo el suyo. */
export function dropCut(e: Engine, actor: Actor, fromId: Id) {
  const meId = meOf(actor);
  return e.tx(() => {
    const from = e.s.assignments[fromId];
    if (!isRental(e, from, meId)) throw new DomainError("FORBIDDEN", "Esa cuenta no es tuya");
    if (from.status === "active") throw new DomainError("VALIDATION", "Esa cuenta sigue andando: quitá los perfiles uno por uno");
    const n = from.subs?.length ?? 0;
    delete from.subs;
    e.audit(actor, "reseller.subs_drop_cut", "assignment", from.id, { removed: n });
    return { ok: true as const, removed: n };
  });
}
