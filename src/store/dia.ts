// Día a día del dueño (14/11/2026). Cálculos chicos que comparten Inicio, Mi secretaria, el Control y Recordatorios,
// para que una misma cosa diga lo mismo en todas las pantallas:
//   - `todayNumbers`: los números del día (un solo cálculo para el saludo, el botón de Mi secretaria y los contadores),
//     separados en «tuyos» y «de revendedores».
//   - `cutAtOf`: cuándo se corta solo un servicio vencido (la misma regla que `closeExpired`: vencimiento + 2 días).
//   - `noticeOf` / `lastNoticeAny`: la marca de «ya le avisé», venga de Mi secretaria o de Recordatorios.
//   - `supplierRenewHint`: si «Me pagó» choca con la fecha del proveedor, cuánto y hasta cuándo habría que renovarle.
// Solo leen: no cambian nada.
import type { Account, Actor, Assignment, Cents, Id, OutboxMessage } from "./types.js";
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

type ReminderSrc = Pick<Assignment, "customerId" | "lastReminderAt" | "reminderMsgId">;
/** Índice de la bandeja por id y por (cliente, momento) — se rehace solo si la bandeja cambió de tamaño. */
const outboxIdx = new WeakMap<OutboxMessage[], { n: number; byId: Map<Id, OutboxMessage>; byAt: Map<string, OutboxMessage> }>();
function idx(e: Engine) {
  const box = e.s.outbox;
  let x = outboxIdx.get(box);
  if (!x || x.n !== box.length) {
    x = { n: box.length, byId: new Map(), byAt: new Map() };
    for (const m of box) { x.byId.set(m.id, m); if (m.template === "expiry_reminder") x.byAt.set(`${m.customerId}:${m.createdAt}`, m); }
    outboxIdx.set(box, x);
  }
  return x;
}
/** El mensaje del último recordatorio (por su id; en datos viejos, por cliente y momento). */
export function reminderMsgOf(e: Engine, a: ReminderSrc): OutboxMessage | undefined {
  if (a.lastReminderAt === undefined) return undefined;
  const x = idx(e);
  return (a.reminderMsgId ? x.byId.get(a.reminderMsgId) : undefined) ?? x.byAt.get(`${a.customerId}:${a.lastReminderAt}`);
}
/** ¿El recordatorio salió de verdad? (lo mandó el bot, o el dueño lo marcó «enviado» a mano). */
const reminderSent = (e: Engine, a: ReminderSrc) => { const m = reminderMsgOf(e, a); return !!m && (m.status === "sent" || m.status === "sent_manually"); };

export interface PreparedReminder { at: number; status: OutboxMessage["status"]; why: "bot" | "permiso" | "sin_numero" | "fallo"; error?: string }
/**
 * Recordatorio de ESTE vencimiento que quedó «preparado» y no salió (bot apagado, sin permiso del cliente, sin número o
 * falló): hay que mandarlo a mano. `undefined` si no hay o si ya salió.
 */
export function preparedReminderOf(e: Engine, a: ReminderSrc & Pick<Assignment, "customerExpiresAt" | "reminderFor">): PreparedReminder | undefined {
  if (a.lastReminderAt === undefined || a.reminderFor !== a.customerExpiresAt) return undefined;
  const m = reminderMsgOf(e, a);
  if (!m || m.status === "sent" || m.status === "sent_manually") return undefined;
  const why = m.status === "skipped_no_consent" ? (m.to ? "permiso" : "sin_numero") : m.status === "failed" ? "fallo" : "bot";
  return { at: a.lastReminderAt, status: m.status, why, ...(m.error ? { error: m.error } : {}) };
}

/**
 * La marca de «ya le avisé» que vale para el vencimiento ACTUAL: «✅ Ya le avisé» de Mi secretaria o un recordatorio de
 * Recordatorios (manual o automático) QUE SALIÓ: si quedó en la bandeja sin enviarse (bot apagado, sin permiso), no
 * cuenta (revisión de 3 meses, 14/11). Si se renueva o cambia la fecha, deja de contar. Sin `e` (solo para comparar
 * fechas) cuenta el recordatorio preparado como antes.
 */
export function noticeOf(a: Pick<Assignment, "control" | "customerExpiresAt" | "lastReminderAt" | "reminderFor" | "customerId" | "reminderMsgId">, e?: Engine): Notice | undefined {
  const out: Notice[] = [];
  const n = a.control?.noticed;
  if (n && n.for === a.customerExpiresAt) out.push({ at: n.at, via: "secretaria" });
  if (a.lastReminderAt !== undefined && a.reminderFor === a.customerExpiresAt && (!e || reminderSent(e, a))) out.push({ at: a.lastReminderAt, via: "recordatorio" });
  return out.sort((x, y) => y.at - x.at)[0];
}

/** El último aviso de cualquiera de los dos lados, sea del vencimiento que sea (columna «Último recordatorio»). Solo los que salieron. */
export function lastNoticeAny(a: Pick<Assignment, "control" | "lastReminderAt" | "customerId" | "reminderMsgId">, e?: Engine): Notice | undefined {
  const out: Notice[] = [];
  if (a.control?.noticed) out.push({ at: a.control.noticed.at, via: "secretaria" });
  if (a.lastReminderAt !== undefined && (!e || reminderSent(e, a))) out.push({ at: a.lastReminderAt, via: "recordatorio" });
  return out.sort((x, y) => y.at - x.at)[0];
}

/** Campos extra de cada alquiler para el panel (Control, Recordatorios). */
export function diaFields(a: Assignment, e?: Engine) {
  const cutAt = cutAtOf(a);
  const prepared = e ? preparedReminderOf(e, a) : undefined;
  return { cutAt: cutAt ?? null, notice: noticeOf(a, e) ?? null, lastNotice: lastNoticeAny(a, e) ?? null, reminder: prepared ?? null };
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
