// "Mi secretaria": un botón en el panel que junta, en una sola pantalla, todo lo que el dueño tiene que
// hacer ahora (cobrar, cortar, quién debe, a quién avisar, qué desenlazar, qué cuentas están libres de
// verdad, cuáles están apartadas) y lo último que pasó en el panel. Solo lee: no cambia nada ni manda mensajes.
// Usa las mismas marcas que el dueño ya escribe en las notas: «EN COBRO», «POR CORTAR», «DESENLAZAR».
import type { Actor, Assignment, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { can, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { effectivePrice, payUsdOf, payerOf } from "./admin.js";
import { DAY, boDayStart } from "./time.js";
import { cutAtOf, noticeOf, preparedReminderOf, todayNumbers, type NoticeVia, type PreparedReminder } from "./dia.js";
import { reactivableList } from "./diaCobro.js";
import { supplierPending } from "./cobrarBien.js";
import { reminderSettings } from "./orders.js";
import { staffRequests } from "./renovarSinTrabas.js";

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
  /** El cliente paga a través de un revendedor (el link de renovación no aplica: renueva con él). */
  viaReseller?: boolean;
  /** «📣 Ya le avisé»: cuándo le avisó el dueño por ESTE vencimiento (si sigue vigente). */
  noticedAt?: number;
  /** De dónde salió el aviso: «Ya le avisé» (secretaria) o un recordatorio preparado en Recordatorios. */
  noticedVia?: NoticeVia;
  /** Cuándo se corta solo si no renueva (vencimiento + días de gracia). No viene si está «esperando fecha». */
  cutAt?: number;
  /** Recordatorio de este vencimiento que quedó preparado y NO salió (bot apagado, sin permiso…): mandalo vos. */
  prepared?: PreparedReminder;
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

// El día de Bolivia (no el del servidor: en UTC, a las 21:00 de La Paz ya era «mañana» y «vence hoy» salía mal).
const dayStart = (t: number) => boDayStart(t);
const has = (txt: string | undefined, re: RegExp) => !!txt && re.test(txt);
const RE_CORTAR = /POR CORTAR/i;
const RE_COBRO = /EN COBRO/i;
const RE_DESENLAZAR = /DESENLAZAR/i;
/** La nota pide cambiar la clave o hacerle seguimiento a la cuenta. */
const RE_CLAVE = /CAMBIAR (LA )?(CLAVE|CONTRASEÑA)|SEGUIMIENTO/i;
/** Si la clave se cambió hace menos de esto, la cuenta deja de aparecer en «claves por cambiar». */
export const KEY_RECENT_DAYS = 7;
/** La cuenta se paga sola con tarjeta (autopago): la nota lo dice. */
const RE_DEBITO = /D[EÉ]BITO|SE DEBITA|AUTOPAGO|AUTOPAY|TARJETA/i;
/** Débitos: cuentas con autopago que vencen con el proveedor desde ayer hasta dentro de estos días. */
export const DEBIT_AHEAD_DAYS = 3;

export function secretaryReport(e: Engine, actor: Actor, opts: { botOn?: boolean } = {}) {
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

  // «Ya le avisé» vale para ESTE vencimiento. Si vence mañana u hoy y el aviso fue hace 2 días o más, vuelve a
  // aparecer (segundo aviso, como pide la regla de «3 días antes y otra vez 1 día antes»).
  // La marca es la misma que la de Recordatorios (dia.ts → noticeOf): si le avisaste por un lado, el otro lo muestra.
  const noticeFresh = (a: Assignment) => {
    const n = noticeOf(a, e);
    if (!n) return undefined;
    return daysTo(a.customerExpiresAt) >= 2 || daysTo(n.at) >= -1 ? n : undefined;
  };
  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active") continue;
    const slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
    const c = a.control ?? {};
    const usd = payUsdOf(e, a);
    const nt = noticeFresh(a), cutAt = cutAtOf(a), prep = nt ? undefined : preparedReminderOf(e, a);
    const item: SecretaryItem = {
      assignmentId: a.id, email: acc?.email ?? "", product: e.s.products[a.productId]?.name ?? a.productId,
      expiresAt: a.customerExpiresAt, days: daysTo(a.customerExpiresAt), price: effectivePrice(e, a),
      ...(usd !== undefined ? { priceUsd: usd } : {}), ...(c.payStatus ? { payStatus: c.payStatus } : {}), ...(c.note ? { note: c.note } : {}),
      ...(e.s.customers[a.customerId]?.resellerId ? { viaReseller: true } : {}),
      ...(nt ? { noticedAt: nt.at, noticedVia: nt.via } : {}),
      ...(cutAt !== undefined ? { cutAt } : {}),
      ...(prep ? { prepared: prep } : {}),
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
  const apartadas: { accountId: Id; email: string; product: string; count: number; note?: string; slots: { slotId: Id; label: string; exName?: string; exAt?: number }[] }[] = [];
  // Quién estaba antes en cada perfil (el último cliente que lo usó), para «⏸️ Apartadas»: «era de Ana · 12/10».
  const exOf = new Map<Id, { name: string; at: number }>();
  for (const a of Object.values(e.s.assignments)) {
    for (const h of a.history ?? []) {
      if (a.status === "active" && h.slotId === a.slotId) continue;
      const cur = exOf.get(h.slotId);
      if (!cur || h.at >= cur.at) exOf.set(h.slotId, { name: e.s.customers[a.customerId]?.name ?? "—", at: h.at });
    }
  }
  const claves: { accountId: Id; email: string; product: string; note: string; passwordChangedAt: number | null; clients: number }[] = [];
  const debitos: { accountId: Id; email: string; product: string; supplierExpiresAt: number; cost: number; costUsd: number | null; note: string }[] = [];
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
    if (quarantined) apartadas.push({ accountId: acc.id, email: acc.email, product, count: quarantined, ...(note ? { note } : {}),
      slots: slots.filter((s) => s.status === "quarantined").map((s) => { const ex = exOf.get(s.id); return { slotId: s.id, label: s.label, ...(ex ? { exName: ex.name, exAt: ex.at } : {}) }; }) });
    if (has(acc.notes, RE_DEBITO) && acc.supplierExpiresAt >= now - DAY && acc.supplierExpiresAt <= now + DEBIT_AHEAD_DAYS * DAY) {
      debitos.push({ accountId: acc.id, email: acc.email, product, supplierExpiresAt: acc.supplierExpiresAt, cost: acc.cost, costUsd: acc.costUsd ?? null, note: acc.notes ?? "" });
    }
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
    debitos: debitos.sort((x, y) => x.supplierExpiresAt - y.supplierExpiresAt || x.email.localeCompare(y.email)),
    // Mensajes editables por el dueño (Configuración); vacío = el texto de siempre.
    templates: e.s.settings.secretaryMsg ?? {},
    renewLinks: !!e.s.settings.renewLink?.enabled,
    actividad,
    // Números del día: el MISMO cálculo que el Inicio (dia.ts → todayNumbers).
    dia: todayNumbers(e, actor),
    // Se cortaron solos hace poco (≤ 30 días): todavía se puede anotar «Me pagó» y reactivarlos.
    cortados: can(actor, "payment.review") ? reactivableList(e, actor) : [],
    // Decisión (b): cobros anotados que pasan la fecha del proveedor → hay que renovarle antes de esa fecha.
    proveedores: supplierPending(e),
    // R2: «📩 Pedir renovación» de revendedores y clientes: se resuelven con «💳 Renovar proveedor y anotar».
    pedidosRenovar: can(actor, "payment.review") ? staffRequests(e, actor) : [],
    // Avisos automáticos: ¿salen de verdad? (el bot lo sabe el servidor; acá llega `botOn`).
    avisosAuto: { enabled: reminderSettings(e).enabled, bot: opts.botOn ?? null },
  };
  const n = (gs: SecretaryGroup[]) => gs.reduce((s, g) => s + g.items.length, 0);
  // Por avisar = los que todavía no marcaste «Ya le avisé»; los ya avisados se cuentan aparte y van al final.
  const pend = (gs: SecretaryGroup[]) => gs.reduce((s, g) => s + g.items.filter((i) => i.noticedAt === undefined).length, 0);
  const allNoticed = (g: SecretaryGroup) => g.items.every((i) => i.noticedAt !== undefined);
  out.avisar = [...out.avisar.filter((g) => !allNoticed(g)), ...out.avisar.filter(allNoticed)];
  return {
    ...out,
    counts: {
      cobrar: n(out.cobrar), cortar: n(out.cortar), deben: n(out.deben), sinAnotar: n(out.sinAnotar), avisar: pend(out.avisar), avisados: n(out.avisar) - pend(out.avisar),
      preparados: [...out.cobrar, ...out.cortar, ...out.deben, ...out.sinAnotar, ...out.avisar].reduce((s, g) => s + g.items.filter((i) => i.prepared).length, 0),
      proveedores: out.proveedores.length,
      desenlazar: desenlazar.length, libres: listas.length, faltaFecha: faltaFecha.length, apartadas: apartadas.length, claves: claves.length, debitos: debitos.length,
    },
  };
}
