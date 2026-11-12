// "Mi secretaria": un botón en el panel que junta, en una sola pantalla, todo lo que el dueño tiene que
// hacer ahora (cobrar, cortar, quién debe, a quién avisar, qué desenlazar, qué cuentas están libres de
// verdad, cuáles están apartadas) y lo último que pasó en el panel. Solo lee: no cambia nada ni manda mensajes.
// Usa las mismas marcas que el dueño ya escribe en las notas: «EN COBRO», «POR CORTAR», «DESENLAZAR».
import type { Actor, Assignment, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { can, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { effectivePrice, payUsdOf, payerOf } from "./admin.js";
import { DAY } from "./time.js";

/** Días hacia adelante que la secretaria mira para "avisar antes de que venza". */
export const SECRETARY_AHEAD_DAYS = 3;
/** Horas hacia atrás de "lo que pasó". */
export const SECRETARY_RECENT_HOURS = 24;

export interface SecretaryItem {
  assignmentId: Id;
  email: string;
  product: string;
  expiresAt: number;
  /** Días hasta el vencimiento contados por día (0 = hoy, negativo = ya venció). */
  days: number;
  /** Lo que paga por período, en Bs (centavos). */
  price: Cents;
  /** Si paga en dólares: lo que paga en US$ (centavos de dólar). */
  priceUsd?: Cents;
  payStatus?: string;
  note?: string;
}
export interface SecretaryGroup {
  customerId: Id;
  name: string;
  phone: string;
  /** Nota de la ficha del revendedor (su regla: "avisar 3 días antes", "paga Bs 69"…). */
  note?: string;
  usd: boolean;
  items: SecretaryItem[];
  /** Suma de lo que paga por estas cuentas (Bs, centavos) y en US$ si paga en dólares. */
  total: Cents;
  totalUsd?: Cents;
}

const dayStart = (t: number) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
const has = (txt: string | undefined, re: RegExp) => !!txt && re.test(txt);
const RE_CORTAR = /POR CORTAR/i;
const RE_COBRO = /EN COBRO/i;
const RE_DESENLAZAR = /DESENLAZAR/i;
/** La nota pide cambiar la clave o hacerle seguimiento a la cuenta. */
const RE_CLAVE = /CAMBIAR (LA )?(CLAVE|CONTRASEÑA)|SEGUIMIENTO/i;
/** Si la clave se cambió hace menos de esto, la cuenta deja de aparecer en «claves por cambiar». */
export const KEY_RECENT_DAYS = 7;

export function secretaryReport(e: Engine, actor: Actor) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo el panel");
  const now = e.now(), today = dayStart(now);
  const daysTo = (t: number) => Math.round((dayStart(t) - today) / DAY);

  const groups = { cobrar: new Map<Id, SecretaryGroup>(), cortar: new Map<Id, SecretaryGroup>(), deben: new Map<Id, SecretaryGroup>(), sinAnotar: new Map<Id, SecretaryGroup>(), avisar: new Map<Id, SecretaryGroup>() };
  const put = (m: Map<Id, SecretaryGroup>, a: Assignment, item: SecretaryItem) => {
    const payer = payerOf(e, a.customerId) ?? e.s.customers[a.customerId];
    const id = payer?.id ?? a.customerId;
    let g = m.get(id);
    if (!g) {
      g = { customerId: id, name: payer?.name ?? "Sin nombre", phone: payer?.phone ?? "", ...(payer?.notes ? { note: payer.notes } : {}), usd: item.priceUsd !== undefined, items: [], total: 0 };
      m.set(id, g);
    }
    g.items.push(item);
    g.total += item.price;
    if (item.priceUsd !== undefined) { g.usd = true; g.totalUsd = (g.totalUsd ?? 0) + item.priceUsd; }
  };

  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active") continue;
    const slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
    const c = a.control ?? {};
    const usd = payUsdOf(e, a);
    const item: SecretaryItem = {
      assignmentId: a.id, email: acc?.email ?? "", product: e.s.products[a.productId]?.name ?? a.productId,
      expiresAt: a.customerExpiresAt, days: daysTo(a.customerExpiresAt), price: effectivePrice(e, a),
      ...(usd !== undefined ? { priceUsd: usd } : {}), ...(c.payStatus ? { payStatus: c.payStatus } : {}), ...(c.note ? { note: c.note } : {}),
    };
    if (has(c.note, RE_CORTAR)) put(groups.cortar, a, item);
    else if (has(c.note, RE_COBRO)) put(groups.cobrar, a, item);
    else if (item.days < 0) put(groups.sinAnotar, a, item);
    else if (c.payStatus === "pendiente" || c.payStatus === "no_pago") put(groups.deben, a, item);
    else if (item.days <= SECRETARY_AHEAD_DAYS) put(groups.avisar, a, item);
  }
  const list = (m: Map<Id, SecretaryGroup>) => [...m.values()]
    .map((g) => ({ ...g, items: g.items.sort((x, y) => x.expiresAt - y.expiresAt || x.email.localeCompare(y.email)) }))
    .sort((x, y) => x.items[0].expiresAt - y.items[0].expiresAt || x.name.localeCompare(y.name));

  // Cuentas (no alquileres): desenlazar, libres de verdad y apartadas (en cuarentena).
  const desenlazar: { accountId: Id; email: string; product: string; note: string; free: number }[] = [];
  const listas: { accountId: Id; email: string; product: string; free: number; note?: string }[] = [];
  const faltaFecha: { accountId: Id; email: string; product: string; free: number; supplierExpiresAt: number; note?: string }[] = [];
  const apartadas: { accountId: Id; email: string; product: string; count: number; note?: string }[] = [];
  const claves: { accountId: Id; email: string; product: string; note: string; passwordChangedAt: number | null; clients: number }[] = [];
  const slotsOf = new Map<Id, (typeof e.s.slots)[string][]>();
  for (const s of Object.values(e.s.slots)) { const l = slotsOf.get(s.accountId); if (l) l.push(s); else slotsOf.set(s.accountId, [s]); }
  for (const acc of Object.values(e.s.accounts)) {
    if (acc.status !== "active") continue;
    const slots = slotsOf.get(acc.id) ?? [];
    const free = slots.filter((s) => s.status === "available").length;
    const quarantined = slots.filter((s) => s.status === "quarantined").length;
    const product = e.s.products[acc.productId]?.name ?? acc.productId;
    const note = acc.notes || undefined;
    if (has(acc.notes, RE_DESENLAZAR) && slots.some((s) => s.status !== "retired")) desenlazar.push({ accountId: acc.id, email: acc.email, product, note: acc.notes ?? "", free });
    else if (free) {
      if (acc.supplierExpiresAt > now) listas.push({ accountId: acc.id, email: acc.email, product, free, ...(note ? { note } : {}) });
      else faltaFecha.push({ accountId: acc.id, email: acc.email, product, free, supplierExpiresAt: acc.supplierExpiresAt, ...(note ? { note } : {}) });
    }
    if (quarantined) apartadas.push({ accountId: acc.id, email: acc.email, product, count: quarantined, ...(note ? { note } : {}) });
    if (has(acc.notes, RE_CLAVE) && !(acc.passwordChangedAt && now - acc.passwordChangedAt < KEY_RECENT_DAYS * DAY)) {
      claves.push({ accountId: acc.id, email: acc.email, product, note: acc.notes ?? "", passwordChangedAt: acc.passwordChangedAt ?? null, clients: slots.filter((s) => s.status === "assigned").length });
    }
  }
  const byEmail = <T extends { email: string }>(xs: T[]) => xs.sort((x, y) => x.email.localeCompare(y.email));

  // Lo que pasó: solo quien puede ver la auditoría (el dueño).
  const since = now - SECRETARY_RECENT_HOURS * 3600_000;
  const actividad = can(actor, "audit.view") ? e.s.audit.filter((x) => x.at >= since).slice(-60).reverse() : null;

  const out = {
    at: now,
    aheadDays: SECRETARY_AHEAD_DAYS,
    cobrar: list(groups.cobrar), cortar: list(groups.cortar), deben: list(groups.deben),
    sinAnotar: list(groups.sinAnotar), avisar: list(groups.avisar),
    desenlazar: byEmail(desenlazar), libres: { listas: byEmail(listas), faltaFecha: byEmail(faltaFecha) }, apartadas: byEmail(apartadas),
    claves: byEmail(claves),
    actividad,
  };
  const n = (gs: SecretaryGroup[]) => gs.reduce((s, g) => s + g.items.length, 0);
  return {
    ...out,
    counts: {
      cobrar: n(out.cobrar), cortar: n(out.cortar), deben: n(out.deben), sinAnotar: n(out.sinAnotar), avisar: n(out.avisar),
      desenlazar: desenlazar.length, libres: listas.length, faltaFecha: faltaFecha.length, apartadas: apartadas.length, claves: claves.length,
    },
  };
}
