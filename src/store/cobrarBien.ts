// Cobrar bien (revisión de 3 meses simulados, 14/11/2026). Reglas chicas que comparten «Me pagó», el «Renovar» del
// Control, reactivar y «Renovar proveedor y anotar», para que cobrar no regale días ni se anote dos veces:
//   - `renewStart`: desde cuándo corre el período que se cobra. Pago atrasado ANTES del corte → desde el vencimiento
//     (decisión del dueño (a): sin días gratis). Ya cortado → la reactivación arranca hoy (diaCobro.ts).
//   - `doubleChargeOf` / `assertNotDouble`: si este alquiler ya tiene un cobro anotado en el período actual, venga de
//     la pantalla que venga, la segunda vez pide confirmar «¿Es otro mes?»; sin confirmación, 409 (DOUBLE_CHARGE).
//   - `supplierPending`: «Proveedores por renovar» (decisión (b)): cuentas con clientes que ya van más allá de la fecha
//     del proveedor porque se anotó el cobro igual.
//   - `payDebt`: «Me pagó lo que debía» (venta fiada o pendiente): marca pagado SIN correr la fecha.
import type { Actor, Assignment, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY } from "./time.js";
import { effectivePrice, payerOf } from "./admin.js";
import { setRentalControl as setControl } from "./orders.js";

/** Hasta cuántos días de atraso (sin corte, p. ej. «esperando fecha») el período nuevo arranca en el vencimiento. */
export const LATE_FROM_EXPIRY_MAX_DAYS = 30;
/** Ventana de «pago adelantado normal»: dentro de estos días antes del vencimiento, cobrar el mes siguiente no pide confirmar. */
export const EARLY_PAY_DAYS = 7;

// dd/mm siempre con dos cifras (con día y mes solos, Intl a veces da «11/9»).
const fdm = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t)).slice(0, 5);
const fbs = (c: Cents) => `Bs ${(c / 100).toLocaleString("es-BO", { minimumFractionDigits: 0, maximumFractionDigits: 2 })}`;

/**
 * Desde cuándo corre el período que se cobra ahora. Si todavía no venció: desde el vencimiento. Si venció pero sigue
 * activo (no se cortó: está en los 2 días de gracia): también desde el vencimiento, así no se regalan los días que ya
 * usó. Si está cortado, «esperando fecha» o el atraso pasa de 30 días, arranca hoy.
 */
export function renewStart(a: Pick<Assignment, "status" | "customerExpiresAt" | "holdOpen">, now: number): number {
  const exp = a.customerExpiresAt;
  if (exp >= now) return exp;
  // «Esperando fecha» (importado ya vencido): la fecha vieja no es confiable, arranca hoy como antes.
  return a.status === "active" && !a.holdOpen && now - exp <= LATE_FROM_EXPIRY_MAX_DAYS * DAY ? exp : now;
}

export interface PriorCharge { at: number; amount: Cents; to: number; text: string }

/**
 * El cobro que ya cubre el período actual, si lo hay: un cobro anotado (Mi secretaria, Control «pagado», venta pagada,
 * «Me pagó lo que debía») o una renovación (Control «Renovar», reactivar, «Renovar proveedor y anotar») que dejó la
 * fecha donde está ahora. Solo cuenta mientras falta más de una semana para el vencimiento: cobrar el mes siguiente
 * unos días antes es lo normal.
 */
export function doubleChargeOf(e: Engine, a: Assignment): PriorCharge | undefined {
  const now = e.now(), exp = a.customerExpiresAt;
  const dur = (e.s.products[a.productId]?.durationDays ?? 30) * DAY;
  const win = Math.min(EARLY_PAY_DAYS * DAY, dur / 4);
  if (a.status !== "active" || now >= exp - win) return undefined;
  const near = (x: number, y: number) => Math.abs(x - y) < 60_000;
  const found: { at: number; amount?: Cents }[] = [];
  for (const p of a.control?.paidLog ?? []) if (near(p.from + dur, exp) || p.from >= exp) found.push({ at: p.at, amount: p.amount });
  const lc = a.lastCharge;
  if (lc && near(lc.to, exp)) {
    // El monto: el del cobro anotado en ese momento, o el de la renovación (pedido) de ese momento.
    const log = (a.control?.paidLog ?? []).find((p) => near(p.at, lc.at));
    const ord = Object.values(e.s.orders).find((o) => o.kind === "renewal" && o.status === "fulfilled" && !o.trial && o.renewal?.assignmentId === a.id && (near(o.updatedAt, lc.at) || near(o.createdAt, lc.at)));
    found.push({ at: lc.at, amount: log?.amount ?? ord?.total });
  }
  if (!found.length) return undefined;
  const last = found.sort((x, y) => y.at - x.at)[0];
  const amount = last.amount ?? effectivePrice(e, a);
  return { at: last.at, amount, to: exp, text: `Ya anotaste un cobro el ${fdm(last.at)} (${fbs(amount)}): ya vence el ${fdm(exp)}. ¿Es otro mes?` };
}

/** Frena el segundo cobro del mismo período si no se confirmó que es otro mes. Debe llamarse dentro de `tx`. */
export function assertNotDouble(e: Engine, a: Assignment, confirmOther: unknown): void {
  if (confirmOther === true) return;
  const d = doubleChargeOf(e, a);
  if (d) throw new DomainError("DOUBLE_CHARGE", d.text);
}

/* ---------------- Proveedores por renovar (decisión (b)) ---------------- */
export interface SupplierPendingItem {
  accountId: Id; email: string; product: string; supplierExpiresAt: number;
  /** Hasta cuándo va el cliente que más lejos llega (la cuenta tiene que alcanzar esa fecha). */
  until: number;
  clients: { assignmentId: Id; name: string; expiresAt: number }[];
}
/** Cuentas activas con clientes que vencen DESPUÉS que la cuenta con el proveedor: hay que renovarle antes de esa fecha. */
export function supplierPending(e: Engine): SupplierPendingItem[] {
  const out = new Map<Id, SupplierPendingItem>();
  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active") continue;
    const slot = e.s.slots[a.slotId], acc = slot ? e.s.accounts[slot.accountId] : undefined;
    if (!acc || acc.status !== "active" || !(a.customerExpiresAt > acc.supplierExpiresAt)) continue;
    let it = out.get(acc.id);
    if (!it) { it = { accountId: acc.id, email: acc.email, product: e.s.products[acc.productId]?.name ?? acc.productId, supplierExpiresAt: acc.supplierExpiresAt, until: 0, clients: [] }; out.set(acc.id, it); }
    it.clients.push({ assignmentId: a.id, name: e.s.customers[a.customerId]?.name ?? "—", expiresAt: a.customerExpiresAt });
    it.until = Math.max(it.until, a.customerExpiresAt);
  }
  return [...out.values()].map((x) => ({ ...x, clients: x.clients.sort((p, q) => p.expiresAt - q.expiresAt) }))
    .sort((x, y) => x.supplierExpiresAt - y.supplierExpiresAt || x.email.localeCompare(y.email));
}
/** El aviso que acompaña un cobro que pasa la fecha del proveedor. */
export const supplierWarnText = (supplierExpiresAt: number) => `⚠️ Renová el proveedor antes del ${fdm(supplierExpiresAt)}: la fecha nueva del cliente la pasa. Queda en «Proveedores por renovar».`;

/* ---------------- «Me pagó lo que debía» ---------------- */
const fdate = (t: number) => new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(t));

/**
 * Venta fiada o pendiente: el cliente paga lo que debía. Marca «pagado» (queda anotado el cobro para Finanzas) y NO
 * corre la fecha: sigue venciendo cuando vencía. Para cobrar el mes siguiente está «Me pagó» de siempre.
 */
export function payDebt(e: Engine, actor: Actor, assignmentId: Id, input: { price?: unknown; idempotencyKey?: unknown } = {}) {
  authorize(actor, "payment.review");
  const key = input.idempotencyKey === undefined || input.idempotencyKey === null ? undefined : String(input.idempotencyKey).slice(0, 80);
  const price = input.price === undefined || input.price === null || input.price === "" ? undefined : Math.round(Number(input.price));
  if (price !== undefined && (!Number.isInteger(price) || price < 0 || price > 5_000_000)) throw new DomainError("VALIDATION", "Precio inválido");
  const run = () => {
    const a = e.get("assignments", assignmentId);
    if (a.status !== "active") throw new DomainError("INVALID_STATE", "El servicio no está activo");
    const st = a.control?.payStatus;
    if (st !== "pendiente" && st !== "no_pago") throw new DomainError("VALIDATION", "Este alquiler ya figura pagado: si te pagó el mes siguiente, usá «Me pagó»");
    const noteBefore = a.control?.note ?? "";
    const note = noteBefore.replace(/\s*[·•]?\s*(🔔\s*)?EN COBRO[^·•\n]*/gi, "").replace(/\s*[·•]?\s*(✂️\s*)?POR CORTAR[^·•\n]*/gi, "").trim();
    const stamp = `💵 pagó lo que debía ${fdate(e.now()).slice(0, 5)}`;
    setControl(e, actor, a.id, { payStatus: "pagado", ...(price !== undefined ? { price } : {}), note: `${note ? note + " · " : ""}${stamp}`.slice(0, 300) });
    const amount = price ?? effectivePrice(e, e.s.assignments[a.id]);
    e.audit(actor, "secretary.debt_paid", "assignment", a.id, { expiresAt: a.customerExpiresAt, price: amount, noteBefore: noteBefore.slice(0, 200) });
    const c = e.s.customers[a.customerId], payer = payerOf(e, a.customerId) ?? c;
    return { assignmentId: a.id, customer: { id: a.customerId, name: c?.name ?? "—" }, payer: { id: payer?.id ?? a.customerId, name: payer?.name ?? "—" }, saved: { price: amount, expiresAt: a.customerExpiresAt } };
  };
  return e.tx(() => (key ? e.idempotent(`secdebt:${assignmentId}:${key}`, run) : run()));
}
