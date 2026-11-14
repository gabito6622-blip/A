// Qué cuenta se puede vender y a qué cuenta conviene pasar a un cliente (revisión de 3 meses, 14/11/2026).
// Reglas puras sobre el estado, sin escribir nada: las usan inventory.ts (vender), orders.ts (reemplazos),
// stats.ts (Notificaciones) y caidas.ts (marcar caída, Reubicar).
//  - Una cuenta «caída», con «🚫 No vender más» o con la nota CAÍDA / NO VENDER / POR CORTAR no se vende.
//  - Al elegir cuenta, primero las que duran con el proveedor hasta la fecha del cliente (de esas, la que vence
//    antes: así no se desperdician las cuentas más cortas); si ninguna alcanza, la que más dura.
//  - Un perfil que queda libre en una cuenta caída va a cuarentena, nunca a «Libre».
import type { Account, Id, Slot } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY } from "./time.js";

/** Nota que saca la cuenta de la venta (la misma que pinta el semáforo de rojo). */
export const NOTE_NO_SELL = /CAÍDA|CAIDA|NO VENDER|POR CORTAR/i;

/** Por qué no se vende esta cuenta (null = se vende). No mira la fecha del proveedor. */
export function sellBlock(acc: Account | undefined): "retirada" | "caída" | "no vender" | "nota" | null {
  if (!acc) return "retirada";
  if (acc.status !== "active") return "retirada";
  if (acc.fallen) return "caída";
  if (acc.noSell) return "no vender";
  if (NOTE_NO_SELL.test(acc.notes ?? "")) return "nota";
  return null;
}

/** La cuenta se puede vender ahora: activa, sin marca de caída ni «no vender» y vigente con el proveedor. */
export function accountSellable(acc: Account | undefined, now: number): boolean {
  return !!acc && !sellBlock(acc) && acc.supplierExpiresAt > now;
}

/** Estado que toma un perfil al quedar libre: en una cuenta caída o retirada va a cuarentena. */
export function slotFreeStatus(e: Engine, slot: Slot): "available" | "quarantined" {
  const acc = e.s.accounts[slot.accountId];
  return !acc || acc.status !== "active" || acc.fallen ? "quarantined" : "available";
}

/** La cuenta alcanza (con el proveedor) hasta `until`. */
export const covers = (acc: Account, until: number): boolean => acc.supplierExpiresAt >= until;

/**
 * Orden para elegir cuenta: primero las que alcanzan `until` (de esas, la que vence antes con el proveedor),
 * después las que no alcanzan (la que más dura primero). Desempata por id para que sea estable.
 */
export function byCoverage(until: number) {
  return (a: Account, b: Account): number => {
    const ca = covers(a, until), cb = covers(b, until);
    if (ca !== cb) return ca ? -1 : 1;
    return (ca ? a.supplierExpiresAt - b.supplierExpiresAt : b.supplierExpiresAt - a.supplierExpiresAt) || a.id.localeCompare(b.id);
  };
}

const fdate = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));

/** Perfiles libres y vendibles de una cuenta, con el del mismo nombre primero. */
export function freeSlotsOf(e: Engine, accountId: Id, preferLabel?: string): Slot[] {
  const busy = new Set(Object.values(e.s.assignments).filter((a) => a.status === "active").map((a) => a.slotId));
  const l = Object.values(e.s.slots).filter((s) => s.accountId === accountId && s.status === "available" && !busy.has(s.id))
    .sort((x, y) => x.label.localeCompare(y.label) || x.id.localeCompare(y.id));
  const i = preferLabel ? l.findIndex((s) => s.label.toLowerCase() === preferLabel.toLowerCase()) : -1;
  if (i > 0) l.unshift(...l.splice(i, 1));
  return l;
}

/** Por qué un cliente está en una cuenta que no anda (null = está bien). */
export function downReason(e: Engine, slot: Slot, now: number): string | null {
  const acc = e.s.accounts[slot.accountId];
  if (acc?.status === "active" && acc.fallen) return "cuenta caída";
  if (slot.status === "quarantined") return "cuarentena";
  if (!acc || acc.status !== "active") return "cuenta retirada";
  if (acc.supplierExpiresAt <= now) return "venció con el proveedor";
  return null;
}

export interface RelocationRow {
  assignmentId: Id; customerId: Id; customerName: string; customerPhone: string;
  productId: Id; product: string; profile: string; currentEmail: string; currentAccountId: Id;
  reason: string; expiresAt: number; daysLeft: number;
  /** La cuenta a la que «Mover» lo pasa (exactamente esa). */
  suggest: { accountId: Id; email: string; free: number; supplierExpiresAt: number; covers: boolean } | null;
  /** Si la cuenta sugerida no dura hasta la fecha del cliente, o no hay ninguna: dicho en simple. */
  warn?: string;
}

/**
 * «Reubicar»: clientes activos en una cuenta que no anda (caída, en cuarentena, retirada o vencida con el proveedor).
 * A cada uno le reserva (en la vista) un lugar en la cuenta sana que alcance su fecha, sin prometer dos veces el
 * mismo perfil: si no queda lugar, `suggest` es null y la fila dice que hay que cargar una cuenta.
 */
export function relocationRows(e: Engine, now: number = e.now()): RelocationRow[] {
  const left = new Map<Id, number>();
  const pool = Object.values(e.s.accounts).filter((t) => accountSellable(t, now));
  for (const t of pool) left.set(t.id, freeSlotsOf(e, t.id).length);
  const rows: RelocationRow[] = [];
  const list = Object.values(e.s.assignments).filter((a) => a.status === "active")
    .map((a) => ({ a, slot: e.s.slots[a.slotId] })).filter((x) => x.slot)
    .map((x) => ({ ...x, why: downReason(e, x.slot, now) })).filter((x) => x.why)
    // Primero los que vencen antes (los más urgentes); a igual fecha, por id.
    .sort((x, y) => x.a.customerExpiresAt - y.a.customerExpiresAt || x.a.id.localeCompare(y.a.id));
  for (const { a, slot, why } of list) {
    const acc = e.s.accounts[slot.accountId];
    const cust = e.s.customers[a.customerId];
    const prod = e.s.products[a.productId]?.name ?? a.productId;
    const options = pool.filter((t) => t.id !== acc?.id && t.productId === a.productId && (left.get(t.id) ?? 0) > 0).sort(byCoverage(a.customerExpiresAt));
    const t = options[0];
    let warn: string | undefined;
    if (t) {
      left.set(t.id, (left.get(t.id) ?? 1) - 1);
      if (!covers(t, a.customerExpiresAt)) warn = `Ninguna cuenta sana de ${prod} dura hasta el ${fdate(a.customerExpiresAt)}: la que más dura vence el ${fdate(t.supplierExpiresAt)}. Renovala con el proveedor antes.`;
    } else warn = `No hay perfiles libres de ${prod} en una cuenta sana: cargá una cuenta y volvé acá.`;
    rows.push({
      assignmentId: a.id, customerId: a.customerId, customerName: cust?.name ?? "", customerPhone: cust?.phone ?? "",
      productId: a.productId, product: prod, profile: slot.label, currentEmail: acc?.email ?? "", currentAccountId: slot.accountId,
      reason: why!, expiresAt: a.customerExpiresAt, daysLeft: Math.ceil((a.customerExpiresAt - now) / DAY),
      suggest: t ? { accountId: t.id, email: t.email, free: freeSlotsOf(e, t.id).length, supplierExpiresAt: t.supplierExpiresAt, covers: covers(t, a.customerExpiresAt) } : null,
      ...(warn ? { warn } : {}),
    });
  }
  return rows;
}

/** «Faltan N perfiles de X»: clientes en cuentas que no andan y sin lugar libre en una cuenta sana, por plataforma. */
export function missingProfiles(e: Engine, now: number = e.now()): { productId: Id; product: string; n: number }[] {
  const by = new Map<Id, { productId: Id; product: string; n: number }>();
  for (const r of relocationRows(e, now)) {
    if (r.suggest) continue;
    const g = by.get(r.productId) ?? { productId: r.productId, product: r.product, n: 0 };
    g.n++; by.set(r.productId, g);
  }
  return [...by.values()];
}

/** Error técnico de mover un cliente → palabras simples. */
export function plainMoveError(e: Engine, err: unknown, productId?: Id): string {
  const code = (err as { code?: string })?.code, msg = (err as Error)?.message ?? String(err);
  const prod = productId ? e.s.products[productId]?.name ?? productId : "esa plataforma";
  if (code === "OUT_OF_STOCK" || /Sin stock suficiente/.test(msg)) return `No hay perfiles libres de ${prod} en otra cuenta sana: cargá una cuenta y movelo desde Reubicar.`;
  return msg;
}
