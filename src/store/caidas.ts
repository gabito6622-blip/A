// Cuentas caídas sin sorpresas (revisión de 3 meses simulados, 14/11/2026). Lo que encontró la revisión:
//  - «Cuenta caída» no hacía nada si no había lugar para todos: la cuenta seguía «sana», sus clientes no aparecían en
//    Reubicar ni en Notificaciones y el mensaje decía «Sin stock suficiente de nf: pedidos 1, libres 0».
//  - Después de «Mover todos», «✅ Liberar en cuarentena» volvía a vender perfiles de la cuenta muerta y la cuenta
//    seguía pidiendo renovación al proveedor.
//  - «Mover» de Reubicar podía mandar al cliente a otra cuenta que la que mostraba, o a una que vencía antes que él.
//  - El revendedor no se enteraba de que su cuenta completa había cambiado.
// Acá viven las acciones; las reglas de qué se vende y adónde se mueve están en vendible.ts.
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY } from "./time.js";
import { replaceAssignment } from "./orders.js";
import { payAccountRenewal } from "./finance.js";
import { freeSlotsOf, plainMoveError, relocationRows, sellBlock } from "./vendible.js";

const activeIn = (e: Engine, accountId: Id) =>
  Object.values(e.s.assignments).filter((a) => a.status === "active" && e.s.slots[a.slotId]?.accountId === accountId)
    .sort((x, y) => x.customerExpiresAt - y.customerExpiresAt || x.id.localeCompare(y.id));

/**
 * «⚠️ Se cayó, todavía no la muevo»: marca la cuenta como caída sin mover a nadie. Desde ese momento no se vende
 * (sus perfiles libres o reservados pasan a cuarentena), no pide renovación al proveedor y sus clientes aparecen en
 * Reubicar y en Notificaciones en rojo.
 */
export function markFallen(e: Engine, actor: Actor, accountId: Id, reason?: unknown) {
  authorize(actor, "inventory.manage");
  const why = String(reason ?? "").trim().slice(0, 200) || "Cuenta caída";
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    if (acc.status !== "active") throw new DomainError("INVALID_STATE", "La cuenta ya está retirada");
    let parked = 0;
    for (const s of Object.values(e.s.slots)) {
      if (s.accountId !== acc.id || (s.status !== "available" && s.status !== "reserved")) continue;
      // Un pedido que tenía este perfil reservado toma otro al aprobarse (orders.ts → settle vuelve a reservar).
      s.status = "quarantined"; delete s.reservedByOrder; delete s.reservedUntil; parked++;
    }
    if (!acc.fallen) acc.fallen = { at: e.now(), by: actor.id, reason: why };
    const clients = activeIn(e, acc.id).length;
    e.audit(actor, "account.fallen", "account", acc.id, { reason: why, clients, parked });
    return { accountId: acc.id, email: acc.email, clients, parked, fallenAt: acc.fallen.at };
  });
}

/**
 * «✅ Volvió a funcionar»: saca la marca. Con `release` también libera sus perfiles apartados para vender (el panel lo
 * ofrece: antes quedaban apartados y había que liberarlos uno por uno). Sin `release` siguen apartados.
 */
export function unmarkFallen(e: Engine, actor: Actor, accountId: Id, opts: { release?: unknown } = {}) {
  authorize(actor, "inventory.manage");
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    const parked = () => Object.values(e.s.slots).filter((s) => s.accountId === acc.id && s.status === "quarantined" && !s.loose?.down);
    if (!acc.fallen) return { accountId: acc.id, changed: false, released: 0, parked: parked().length };
    delete acc.fallen;
    let released = 0;
    if (opts.release === true) for (const s of parked()) { s.status = "available"; released++; }
    e.audit(actor, "account.unfallen", "account", acc.id, released ? { released } : undefined);
    return { accountId: acc.id, changed: true, released, parked: parked().length };
  });
}

/** «🚫 No vender más» / «Volver a vender»: saca (o vuelve a poner) la cuenta en la venta sin tocar a sus clientes. */
export function setNoSell(e: Engine, actor: Actor, accountId: Id, on: unknown) {
  authorize(actor, "inventory.manage");
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    if (acc.status !== "active") throw new DomainError("INVALID_STATE", "La cuenta está retirada");
    if (on) acc.noSell = true; else delete acc.noSell;
    e.audit(actor, "account.no_sell", "account", acc.id, { on: !!on });
    return { accountId: acc.id, noSell: !!acc.noSell, clients: activeIn(e, acc.id).length };
  });
}

/** «¿La cuenta vieja murió? → Retirarla»: solo si ya no tiene clientes. Deja de venderse y de pedir renovación. */
export function retireAccount(e: Engine, actor: Actor, accountId: Id, reason?: unknown) {
  authorize(actor, "inventory.manage");
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    if (acc.status === "retired") return { accountId: acc.id, retired: true };
    const left = activeIn(e, acc.id).length;
    if (left) throw new DomainError("INVALID_STATE", `Todavía tiene ${left} cliente${left === 1 ? "" : "s"} adentro: movelos primero`);
    acc.status = "retired";
    for (const s of Object.values(e.s.slots)) if (s.accountId === acc.id && s.status !== "assigned") { s.status = "retired"; delete s.reservedByOrder; delete s.reservedUntil; }
    e.audit(actor, "account.retire", "account", acc.id, { reason: String(reason ?? "").trim().slice(0, 200) || "La cuenta murió" });
    return { accountId: acc.id, retired: true };
  });
}

/**
 * «Cuenta caída → Mover clientes y retirar»: primero la MARCA como caída (aunque después no se pueda mover a todos),
 * después pasa a cada cliente a una cuenta sana que alcance su fecha, y la retira solo si quedó vacía. Los que no
 * se pudieron mover quedan en Reubicar con el motivo en palabras simples.
 */
export function downAccount(e: Engine, actor: Actor, accountId: Id, reason?: unknown) {
  authorize(actor, "assignment.replace");
  const why = String(reason ?? "").trim().slice(0, 200) || "Cuenta caída";
  const acc = e.get("accounts", accountId);
  if (acc.status !== "active") throw new DomainError("INVALID_STATE", "La cuenta ya está retirada");
  markFallen(e, actor, accountId, why);
  const results = activeIn(e, accountId).map((a) => {
    const cust = e.s.customers[a.customerId];
    try {
      const r = replaceAssignment(e, actor, a.id, { reason: why, oldSlot: "quarantined", otherAccount: true });
      return { assignmentId: a.id, customerName: cust?.name ?? "", ok: true as const, slotId: r.slotId, email: e.s.accounts[e.s.slots[r.slotId].accountId]?.email ?? "" };
    } catch (err) {
      return { assignmentId: a.id, customerName: cust?.name ?? "", ok: false as const, code: (err as DomainError).code, error: plainMoveError(e, err, a.productId) };
    }
  });
  const left = results.filter((r) => !r.ok).length;
  const retired = !left;
  if (retired) retireAccount(e, actor, accountId, why);
  return { retired, fallen: true, moved: results.filter((r) => r.ok).length, left, results };
}

/**
 * «Mover» de Reubicar: pasa al cliente EXACTAMENTE a la cuenta que muestra la fila (`toAccountId`); si no se manda,
 * a la que sugiere Reubicar en ese momento. Conserva su fecha. El perfil viejo queda apartado si la cuenta sigue
 * (caída) o retirado si la cuenta ya no está activa.
 */
export function relocate(e: Engine, actor: Actor, assignmentId: Id, input: { toAccountId?: unknown; reason?: unknown } = {}) {
  authorize(actor, "assignment.replace");
  const a = e.get("assignments", assignmentId);
  if (a.status !== "active") throw new DomainError("INVALID_STATE", "Ese servicio ya no está activo");
  const want = input.toAccountId ? String(input.toAccountId) : relocationRows(e).find((r) => r.assignmentId === a.id)?.suggest?.accountId;
  if (!want) throw new DomainError("OUT_OF_STOCK", plainMoveError(e, { code: "OUT_OF_STOCK" }, a.productId));
  const to = e.s.accounts[want];
  const old = e.s.slots[a.slotId], oldAcc = old ? e.s.accounts[old.accountId] : undefined;
  if (!to || to.productId !== a.productId) throw new DomainError("VALIDATION", "Esa cuenta es de otra plataforma");
  if (to.id === oldAcc?.id) throw new DomainError("VALIDATION", "Ya está en esa cuenta");
  if (sellBlock(to) || to.supplierExpiresAt <= e.now()) throw new DomainError("INVALID_STATE", "Esa cuenta ya no está sana: tocá Reubicar de nuevo para ver otra");
  const slot = freeSlotsOf(e, to.id, old?.label)[0];
  if (!slot) throw new DomainError("OUT_OF_STOCK", `${to.email} ya no tiene perfiles libres: tocá Reubicar de nuevo para ver otra`);
  // Un perfil suelto caído no vuelve nunca: queda retirado (perfilSuelto.ts).
  const oldSlot = oldAcc?.status === "active" && !old?.loose?.down ? "quarantined" : "retired";
  const r = replaceAssignment(e, actor, a.id, { reason: String(input.reason ?? "").trim() || "Reubicación: cuenta caída", oldSlot, toSlotId: slot.id });
  return { assignment: r, toAccountId: to.id, email: to.email, profile: slot.label, covers: to.supplierExpiresAt >= a.customerExpiresAt };
}

/**
 * «Pagar varias»: anota juntas las renovaciones pagadas de varias cuentas del MISMO proveedor (todo o nada). Usa la
 * misma regla de plata que «💳 Pagué la renovación» de cada cuenta (finance.ts → payAccountRenewal).
 */
export function payRenewalMany(e: Engine, actor: Actor, input: { items?: unknown; months?: unknown }) {
  authorize(actor, "inventory.manage");
  const items = Array.isArray(input.items) ? input.items as { accountId?: unknown; amount?: unknown }[] : [];
  if (!items.length || items.length > 30) throw new DomainError("VALIDATION", "Elegí entre 1 y 30 cuentas");
  const ids = items.map((x) => String(x?.accountId ?? ""));
  if (new Set(ids).size !== ids.length) throw new DomainError("VALIDATION", "Hay una cuenta repetida");
  const accs = ids.map((id) => e.get("accounts", id));
  if (new Set(accs.map((a) => a.supplierId)).size > 1) throw new DomainError("VALIDATION", "Elegí cuentas del mismo proveedor");
  return e.tx(() => {
    const results = items.map((it, i) => ({ accountId: ids[i], email: accs[i].email, ...payAccountRenewal(e, actor, ids[i], { amount: it.amount, months: input.months }) }));
    const total = results.reduce((s, r) => s + r.expense.amount, 0);
    e.audit(actor, "account.renew_paid_many", "account", "*", { n: results.length, total, supplierId: accs[0].supplierId });
    return { paid: results.length, total, results };
  });
}

// ── Revendedor: «Cambió la cuenta: avisá a tus N clientes» (GaboHub) ───────────────────────────────────────────────
const CHANGE_DAYS = 30;

function myCustomerId(actor: Actor): Id {
  if ((actor.role !== "reseller" && actor.role !== "customer") || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para clientes y revendedores");
  return actor.customerId;
}

/**
 * Cuentas de la tienda a nombre de quien pregunta que se cambiaron o se cayeron y todavía no marcó «Ya les avisé».
 * Solo SUS servicios y SUS clientes anotados (su cuaderno): nunca datos de otro revendedor, costos ni claves.
 */
export function accountChanges(e: Engine, actor: Actor) {
  const me = myCustomerId(actor);
  const now = e.now();
  const out = [];
  for (const a of Object.values(e.s.assignments)) {
    // Solo las cuentas completas alquiladas (las que tienen su cuaderno de clientes): un perfil suelto ya recibe su aviso.
    if (a.customerId !== me || a.status !== "active" || e.s.products[a.productId]?.kind !== "full_account") continue;
    const acc = e.s.accounts[e.s.slots[a.slotId]?.accountId ?? ""];
    const moved = [...a.history].reverse().find((h) => h.event === "replaced")?.at;
    const fallen = acc?.fallen?.at;
    const at = Math.max(moved && now - moved <= CHANGE_DAYS * DAY ? moved : 0, fallen ?? 0);
    if (!at || at <= (a.changeSeenAt ?? 0)) continue;
    out.push({
      assignmentId: a.id, kind: fallen ? "fallen" as const : "moved" as const, at,
      product: (e.s.products[a.productId]?.name ?? "").replace(/ \(alquiler revendedores\)/, ""), email: acc?.email ?? "",
      clients: (a.subs ?? []).map((s) => ({ id: s.id, name: s.name, phone: s.phone ?? "", label: s.label ?? "" })),
    });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** «✓ Ya les avisé»: saca el cartel de esa cuenta (hasta el próximo cambio). Solo sobre lo suyo. */
export function accountChangeSeen(e: Engine, actor: Actor, assignmentId: Id) {
  const me = myCustomerId(actor);
  return e.tx(() => {
    const a = e.s.assignments[assignmentId];
    if (!a || a.customerId !== me) throw new DomainError("NOT_FOUND", "No se encontró esa cuenta");
    a.changeSeenAt = e.now();
    e.audit(actor, "account.change_seen", "assignment", a.id);
    return { ok: true as const };
  });
}
