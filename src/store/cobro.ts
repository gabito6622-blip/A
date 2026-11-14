// «Me pagó» desde Mi secretaria (Optimización 1, 13/11/2026). Reutiliza lo que ya hace el Control:
// correr la fecha (`extend`, con el freno del proveedor) y marcar «pagado» (`setControl`, que anota el cobro
// en `paidLog` para Finanzas). Antes de guardar, `payPreview` dice exactamente qué va a pasar: cliente,
// cuenta, monto, período y fecha nueva; y frena si ese período ya se cobró o si pasa la fecha del proveedor.
import type { Actor, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, can } from "./auth.js";
import { DomainError } from "./errors.js";
import { renewBlockOf } from "./vendible.js";
import { DAY, boDayStart } from "./time.js";
import { effectivePrice, payUsdOf, payerOf } from "./admin.js";
import { extend, setRentalControl as setControl } from "./orders.js";
import { supplierRenewHint, type SupplierRenewHint } from "./dia.js";
import { doubleChargeOf, renewStart, supplierWarnText, type PriorCharge } from "./cobrarBien.js";
import { owedByPayLater } from "./plata.js";

const fbsC = (c: Cents) => `Bs ${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

/** Marca «sin fecha del proveedor» (cuentas cargadas sin vencimiento quedan muy a futuro). */
const NO_DATE_AFTER = 50 * 365 * DAY;
const fdate = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));

export interface PayPreview {
  assignmentId: Id;
  customer: { id: Id; name: string; phone: string };
  payer: { id: Id; name: string; isReseller: boolean };
  email: string; profile: string; product: string;
  /** Lo que paga por período: en Bs (y en US$ si está en la lista en dólares). */
  price: Cents; priceUsd?: Cents; currency: "BOB" | "USD";
  periods: number; days: number;
  /** El período que se cobra arranca donde termina el actual (o hoy, si ya venció) y termina en `to`. */
  from: number; to: number; expiredDays: number;
  supplierExpiresAt: number; supplierNoDate: boolean;
  payStatus: string | null; lastPaidAt: number | null;
  /** Motivos por los que NO se puede guardar (vacío = se puede). */
  blockers: string[];
  /** Avisos que no frenan. */
  warnings: string[];
  ok: boolean;
  /** Si la fecha nueva pasa la del proveedor: cuánto y hasta cuándo renovarle (dia.ts). Se puede anotar igual (decisión (b)). */
  supplierRenew?: SupplierRenewHint;
  /** La fecha nueva pasa la del proveedor: se anota igual, con este aviso, y la cuenta queda en «Proveedores por renovar». */
  supplierWarn?: { supplierExpiresAt: number; text: string };
  /** Ya hay un cobro en este período: para guardar hay que confirmar que es otro mes (`confirmOther`). */
  doubleCharge?: PriorCharge;
  /** Lo que debe del período que está usando (fiado): «Me pagó» lo paga primero y no regala el mes. */
  debt?: Cents;
}

export function payPreview(e: Engine, actor: Actor, assignmentId: Id, input: { periods?: unknown; renew?: unknown } = {}): PayPreview {
  authorize(actor, "payment.review");
  const periods = input.periods === undefined || input.periods === null || input.periods === "" ? 1 : Number(input.periods);
  if (!Number.isInteger(periods) || periods < 1 || periods > 12) throw new DomainError("VALIDATION", "Períodos: de 1 a 12");
  const a = e.get("assignments", assignmentId);
  const prod = e.s.products[a.productId], slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
  const c = e.s.customers[a.customerId], payer = payerOf(e, a.customerId) ?? c;
  const now = e.now();
  // Fiado (revisión de 3 meses como Gabriel, 16/11/2026): si el período que está usando todavía no lo pagó, este cobro
  // primero paga lo que debía (como «Me pagó lo que debía») y recién los meses que sobran corren la fecha. Antes «Me
  // pagó» de Bs 20 le borraba la deuda de agosto Y le daba septiembre: un mes regalado.
  const debt = a.status === "active" ? owedByPayLater(e, a.id) : undefined;
  const extra = debt !== undefined ? periods - 1 : periods;
  const days = (prod?.durationDays ?? 30) * extra;
  // Pago atrasado antes del corte: desde el vencimiento (decisión (a), cobrarBien.ts).
  const from = debt !== undefined ? a.customerExpiresAt : renewStart(a, now), to = from + days * DAY;
  const price = effectivePrice(e, a), usd = payUsdOf(e, a);
  const supplierExpiresAt = acc?.supplierExpiresAt ?? 0, supplierNoDate = supplierExpiresAt - now >= NO_DATE_AFTER;
  const ctl = a.control ?? {};
  const log = ctl.paidLog ?? [];
  const blockers: string[] = [], warnings: string[] = [];
  if (a.status !== "active") blockers.push("El servicio no está activo");
  if (!acc) blockers.push("La cuenta ya no existe");
  const fallen = a.status === "active" ? renewBlockOf(e, a) : null; // cuenta caída: primero moverlo
  if (fallen) blockers.push(fallen.replace("renová", "anotá el cobro"));
  // Decisión (b): si la fecha nueva pasa la del proveedor, se anota igual con un aviso claro (y la cuenta queda en
  // «Proveedores por renovar» de Mi secretaria). Sigue estando «💳 Renovar proveedor y anotar» para hacer las dos cosas juntas.
  const supplierBlocked = !!acc && to > supplierExpiresAt && !supplierNoDate;
  const supplierWarn = supplierBlocked ? { supplierExpiresAt, text: supplierWarnText(supplierExpiresAt) } : undefined;
  // Ya hay un cobro en este período (de cualquier pantalla): pide confirmar que es otro mes (cobrarBien.ts).
  // «Renovar» justo después de vender es pagar por adelantado: ahí la venta no cuenta como cobro de este período.
  const doubleCharge = a.status === "active" ? doubleChargeOf(e, a, { sale: input.renew !== true }) : undefined;
  const last = log.length ? log[log.length - 1] : undefined;
  const supplierRenew = supplierBlocked && !blockers.length && can(actor, "inventory.manage") ? supplierRenewHint(e, acc!, to) : undefined;
  if (debt !== undefined) warnings.push(`${c?.name?.split(" ")[0] ?? "El cliente"} te debe el período que está usando (${fbsC(debt)}): este cobro paga primero lo que debía${extra ? ` y corre la fecha ${extra} ${extra === 1 ? "mes" : "meses"}` : " y no corre la fecha"}. Si te pagó también el mes nuevo, elegí ${periods + 1} meses.`);
  if (!(price > 0)) warnings.push("No hay precio acordado ni de lista: el monto quedaría en Bs 0");
  if (supplierNoDate) warnings.push("La cuenta no tiene fecha del proveedor cargada");
  if (from > a.customerExpiresAt && a.customerExpiresAt < now) warnings.push(`Venció hace ${Math.round((now - a.customerExpiresAt) / DAY)} días${a.holdOpen ? " (esperando fecha)" : ""}: el período nuevo arranca hoy, no desde el vencimiento viejo`);
  return {
    assignmentId: a.id,
    customer: { id: c?.id ?? a.customerId, name: c?.name ?? "—", phone: c?.phone ?? "" },
    payer: { id: payer?.id ?? a.customerId, name: payer?.name ?? "—", isReseller: payer?.kind === "reseller" },
    email: acc?.email ?? "", profile: slot?.label ?? "", product: prod?.name ?? a.productId,
    price, ...(usd !== undefined ? { priceUsd: usd } : {}), currency: usd !== undefined ? "USD" : "BOB",
    periods, days, from, to, expiredDays: Math.max(0, Math.round((boDayStart(now) - boDayStart(a.customerExpiresAt)) / DAY)),
    supplierExpiresAt, supplierNoDate, payStatus: ctl.payStatus ?? null, lastPaidAt: last?.at ?? null,
    blockers, warnings, ok: blockers.length === 0, ...(supplierRenew ? { supplierRenew } : {}), ...(debt !== undefined ? { debt } : {}),
    ...(supplierWarn ? { supplierWarn } : {}), ...(doubleCharge ? { doubleCharge } : {}),
  };
}

/**
 * Guarda el cobro: corre la fecha (sin pasar al proveedor) y marca «pagado» con el precio acordado
 * (o el que el dueño escribió). Idempotente por `idempotencyKey`. Quita «EN COBRO» / «POR CORTAR» de la nota
 * del Control y deja «💵 pagado dd/mm» (la nota original queda en la auditoría).
 */
export function payApply(e: Engine, actor: Actor, assignmentId: Id, input: { periods?: unknown; price?: unknown; idempotencyKey?: unknown; confirmOther?: unknown; renew?: unknown } = {}) {
  authorize(actor, "payment.review");
  const key = input.idempotencyKey === undefined || input.idempotencyKey === null ? undefined : String(input.idempotencyKey).slice(0, 80);
  const run = () => {
    const pv = payPreview(e, actor, assignmentId, { periods: input.periods, renew: input.renew });
    if (!pv.ok) throw new DomainError("VALIDATION", pv.blockers[0]);
    if (pv.doubleCharge && input.confirmOther !== true) throw new DomainError("DOUBLE_CHARGE", pv.doubleCharge.text);
    const price = input.price === undefined || input.price === null || input.price === "" ? undefined : Math.round(Number(input.price));
    if (price !== undefined && (!Number.isInteger(price) || price < 0 || price > 5_000_000)) throw new DomainError("VALIDATION", "Precio inválido");
    const a = e.get("assignments", assignmentId);
    const before = { expiresAt: a.customerExpiresAt, note: a.control?.note ?? "", payStatus: a.control?.payStatus ?? null };
    if (pv.debt !== undefined) {
      // Primero lo que debía (marca «pagado» el período que está usando: el pedido fiado entra hoy en Finanzas).
      const noteD = before.note.replace(/\s*[·•]?\s*(🔔\s*)?EN COBRO[^·•\n]*/gi, "").replace(/\s*[·•]?\s*(✂️\s*)?POR CORTAR[^·•\n]*/gi, "").trim();
      setControl(e, actor, a.id, { payStatus: "pagado", ...(price !== undefined ? { price } : {}), note: `${noteD ? noteD + " · " : ""}💵 pagó lo que debía ${fdate(e.now()).slice(0, 5)}`.slice(0, 300) });
      if (pv.periods === 1) {
        e.audit(actor, "secretary.debt_paid", "assignment", a.id, { expiresAt: a.customerExpiresAt, price: pv.debt, via: "me_pago" });
        return { ...payPreview(e, actor, assignmentId, { periods: 1 }), saved: { from: before.expiresAt, to: a.customerExpiresAt, price: pv.debt, periods: 1, debtPaid: pv.debt } };
      }
    }
    const months = pv.debt !== undefined ? pv.periods - 1 : pv.periods;
    extend(e, actor, a.id, months, true); // decisión (b): pasa al proveedor con aviso (pv.supplierWarn)
    // El Control anota el cobro (paidLog) al PASAR a «pagado». Si ya estaba pagado del período anterior, se pasa por
    // «pendiente» un instante (después de correr la fecha, así no borra el cobro viejo) para que el nuevo quede anotado.
    if (e.s.assignments[a.id].control?.payStatus === "pagado") setControl(e, actor, a.id, { payStatus: "pendiente" });
    const note = before.note.replace(/\s*[·•]?\s*(🔔\s*)?EN COBRO[^·•\n]*/gi, "").replace(/\s*[·•]?\s*(✂️\s*)?POR CORTAR[^·•\n]*/gi, "").trim();
    const stamp = `💵 pagado ${fdate(e.now()).slice(0, 5)}`;
    setControl(e, actor, a.id, { payStatus: "pagado", ...(price !== undefined ? { price } : {}), note: `${note ? note + " · " : ""}${stamp}`.slice(0, 300) });
    // Pagó varios meses juntos: el cobro anotado es por todo lo que pagó (antes Finanzas contaba un solo mes).
    if (months > 1) {
      const log = e.s.assignments[a.id].control?.paidLog ?? [];
      const last = log[log.length - 1];
      if (last && last.at === e.now()) last.amount = (price ?? pv.price) * months;
    }
    e.audit(actor, "secretary.paid", "assignment", a.id, { from: before.expiresAt, to: e.s.assignments[a.id].customerExpiresAt, periods: pv.periods, price: price ?? pv.price, noteBefore: before.note.slice(0, 200),
      ...(pv.supplierWarn ? { beyondSupplier: pv.supplierWarn.supplierExpiresAt } : {}), ...(pv.doubleCharge ? { otherMonth: pv.doubleCharge.at } : {}) });
    return { ...payPreview(e, actor, assignmentId, { periods: 1 }), saved: { from: before.expiresAt, to: e.s.assignments[a.id].customerExpiresAt, price: price ?? pv.price, periods: pv.periods, ...(pv.debt !== undefined ? { debtPaid: pv.debt } : {}), ...(pv.supplierWarn ? { supplierWarn: pv.supplierWarn } : {}) } };
  };
  return e.tx(() => (key ? e.idempotent(`secpay:${assignmentId}:${key}`, run) : run()));
}
