// Día a día del dueño (14/11/2026). Cálculos chicos que comparten Inicio, Mi secretaria, el Control y Recordatorios,
// para que una misma cosa diga lo mismo en todas las pantallas:
//   - `todayNumbers`: los números del día (un solo cálculo para el saludo, el botón de Mi secretaria y los contadores),
//     separados en «tuyos» y «de revendedores».
//   - `cutAtOf`: cuándo se corta solo un servicio vencido (la misma regla que `closeExpired`: vencimiento + 2 días).
//   - `noticeOf` / `lastNoticeAny`: la marca de «ya le avisé», venga de Mi secretaria o de Recordatorios.
//   - `supplierRenewHint`: si «Me pagó» choca con la fecha del proveedor, cuánto y hasta cuándo habría que renovarle.
// Solo leen: no cambian nada.
import type { Account, Actor, Assignment, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart } from "./time.js";
import { resellerOf } from "./myReseller.js";
import { accountCostBs } from "./finance.js";

/** Días de gracia antes de que la tarea periódica corte un servicio vencido (`closeExpired`). No cambiar sin el dueño. */
export const CORTE_GRACE_DAYS = 2;

/** Cuándo se corta solo este servicio (si sigue sin renovarse). `undefined` si no se corta solo (esperando fecha o ya cerrado). */
export function cutAtOf(a: Pick<Assignment, "status" | "holdOpen" | "customerExpiresAt" | "trial">, graceDays = CORTE_GRACE_DAYS): number | undefined {
  if (a.status !== "active" || a.holdOpen) return undefined;
  return a.customerExpiresAt + (a.trial ? 0 : graceDays * DAY);
}

export type NoticeVia = "secretaria" | "recordatorio";
export interface Notice { at: number; via: NoticeVia }

/**
 * La marca de «ya le avisé» que vale para el vencimiento ACTUAL: «✅ Ya le avisé» de Mi secretaria o un recordatorio
 * preparado desde Recordatorios (manual o automático). Si se renueva o cambia la fecha, deja de contar.
 */
export function noticeOf(a: Pick<Assignment, "control" | "customerExpiresAt" | "lastReminderAt" | "reminderFor">): Notice | undefined {
  const out: Notice[] = [];
  const n = a.control?.noticed;
  if (n && n.for === a.customerExpiresAt) out.push({ at: n.at, via: "secretaria" });
  if (a.lastReminderAt !== undefined && a.reminderFor === a.customerExpiresAt) out.push({ at: a.lastReminderAt, via: "recordatorio" });
  return out.sort((x, y) => y.at - x.at)[0];
}

/** El último aviso de cualquiera de los dos lados, sea del vencimiento que sea (columna «Último recordatorio»). */
export function lastNoticeAny(a: Pick<Assignment, "control" | "lastReminderAt">): Notice | undefined {
  const out: Notice[] = [];
  if (a.control?.noticed) out.push({ at: a.control.noticed.at, via: "secretaria" });
  if (a.lastReminderAt !== undefined) out.push({ at: a.lastReminderAt, via: "recordatorio" });
  return out.sort((x, y) => y.at - x.at)[0];
}

/** Campos extra de cada alquiler para el panel (Control, Recordatorios). */
export function diaFields(a: Assignment) {
  const cutAt = cutAtOf(a);
  return { cutAt: cutAt ?? null, notice: noticeOf(a) ?? null, lastNotice: lastNoticeAny(a) ?? null };
}

export interface Split { mine: number; rev: number; total: number }
const split = (): Split => ({ mine: 0, rev: 0, total: 0 });

/**
 * Los números del día, un solo cálculo para Inicio y Mi secretaria. Cada alquiler cuenta una sola vez en «para hoy»
 * (antes un vencido sin pagar sumaba dos). «tuyos» = les cobrás vos; «de revendedores» = clientes de tus revendedores
 * (le avisás al revendedor). El día es el de Bolivia.
 */
export function todayNumbers(e: Engine, actor: Actor) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo el panel");
  const now = e.now(), today = boDayStart(now);
  const daysTo = (t: number) => Math.round((boDayStart(t) - today) / DAY);
  const c = { hoy: split(), vencidos: split(), espera: split(), pronto: split(), sinPago: split(), cobroFecha: split(), paraHoy: split() };
  const add = (s: Split, rev: boolean) => { s.total++; if (rev) s.rev++; else s.mine++; };
  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active") continue;
    const rev = !!resellerOf(e, a.customerId);
    const d = daysTo(a.customerExpiresAt), hold = !!a.holdOpen;
    const hoy = !hold && d === 0, venc = !hold && d < 0, pronto = !hold && d >= 1 && d <= 3;
    const pay = a.control?.payStatus, sinPago = !!pay && pay !== "pagado";
    if (hoy) add(c.hoy, rev);
    if (venc) add(c.vencidos, rev);
    if (hold) add(c.espera, rev);
    if (pronto) add(c.pronto, rev);
    if (sinPago) add(c.sinPago, rev);
    if (hoy || venc || hold) add(c.cobroFecha, rev);
    if (hoy || venc || hold || sinPago) add(c.paraHoy, rev);
  }
  const revisar = Object.values(e.s.orders).filter((o) => o.status === "payment_review").length;
  // Los pagos por revisar son tuyos (los apruebas vos).
  return { at: now, ...c, revisar, total: c.paraHoy.total + revisar, mine: c.paraHoy.mine + revisar, rev: c.paraHoy.rev };
}

/** Igual que en finance.ts (`payAccountRenewal`): suma meses calendario manteniendo el día (o el último del mes). */
function addMonths(t: number, months: number): number {
  const d = new Date(t), day = d.getDate();
  d.setDate(1); d.setMonth(d.getMonth() + months);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return d.getTime();
}
/** La fecha nueva del proveedor si anotás «Pagué la renovación» por `months` meses (la misma cuenta que finance.ts). */
export function supplierNextDate(supplierExpiresAt: number, months: number, now: number): number {
  let next = addMonths(supplierExpiresAt, months);
  if (next < now) next = addMonths(now, months);
  return next;
}

export interface SupplierRenewHint {
  accountId: Id; email: string; months: number;
  /** Lo que se anota como pagado al proveedor (Bs, centavos): el costo mensual de la cuenta × meses. */
  amount: Cents; usd?: Cents;
  from: number; to: number;
}
/**
 * «Me pagó» pero la cuenta vence antes con el proveedor: cuántos meses hay que renovarle (lo mínimo para que entre la
 * fecha nueva del cliente), cuánto se anota y hasta cuándo queda. `undefined` si no alcanza con 12 meses o no hay costo.
 */
export function supplierRenewHint(e: Engine, acc: Account, customerTo: number): SupplierRenewHint | undefined {
  const now = e.now(), unit = accountCostBs(e, acc);
  if (!(unit > 0) || acc.status === "retired") return undefined;
  for (let m = 1; m <= 12; m++) {
    const to = supplierNextDate(acc.supplierExpiresAt, m, now);
    if (to >= customerTo) return { accountId: acc.id, email: acc.email, months: m, amount: unit * m, ...(acc.costUsd ? { usd: acc.costUsd * m } : {}), from: acc.supplierExpiresAt, to };
  }
  return undefined;
}
