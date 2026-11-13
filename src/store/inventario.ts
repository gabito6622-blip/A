// Inventario inteligente (Premium 2.0, etapa 4). Solo reglas sobre los datos que ya existen:
//  - correos de cuentas normalizados y sin dobles (misma plataforma, misma cuenta cargada dos veces);
//  - aviso de dominio mal escrito («gmaik.com»);
//  - semáforo de riesgo por cuenta (verde / amarillo / rojo, con los motivos);
//  - vista «Cortes»: cuentas por perfiles con clientes que vencen en fechas distintas y una fecha
//    sugerida para alinearlos;
//  - cambio de clave guiado: deja fecha, auditoría y aviso a los clientes de esa cuenta.
import type { Account, Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY, boDayKey, boDayStart } from "./time.js";
import { queue } from "./notify.js";

/** Correo tal como se guarda: sin espacios y en minúsculas. */
export const normEmail = (s: unknown): string => String(s ?? "").trim().toLowerCase().replace(/\s+/g, "");

/** Dominios que casi siempre son un error de tipeo → el correcto. */
const TYPOS: Record<string, string> = {
  "gmaik.com": "gmail.com", "gmai.com": "gmail.com", "gmial.com": "gmail.com", "gamil.com": "gmail.com", "gmail.co": "gmail.com", "gmail.con": "gmail.com", "gmil.com": "gmail.com", "gnail.com": "gmail.com",
  "hotmial.com": "hotmail.com", "hotmal.com": "hotmail.com", "hotmail.con": "hotmail.com", "hotmai.com": "hotmail.com",
  "outlok.com": "outlook.com", "outloo.com": "outlook.com", "yahoo.con": "yahoo.com", "yaho.com": "yahoo.com",
};
/** Si el dominio parece mal escrito, devuelve el correo corregido; si no, null. */
export function emailTypo(email: string): string | null {
  const m = /^([^@]+)@([^@]+)$/.exec(normEmail(email));
  if (!m) return null;
  const fix = TYPOS[m[2]];
  return fix ? `${m[1]}@${fix}` : null;
}

/** Otra cuenta viva de la misma plataforma con el mismo correo (sin contar `exceptId`). */
export function duplicateAccount(e: Engine, email: string, productId: Id, exceptId?: Id): Account | undefined {
  const n = normEmail(email);
  return Object.values(e.s.accounts).find((a) => a.id !== exceptId && a.status !== "retired" && a.productId === productId && normEmail(a.email) === n);
}

/** Marca «sin fecha del proveedor» (cuentas cargadas sin vencimiento: quedan muy a futuro). */
const NO_DATE_AFTER = 50 * 365 * DAY;
const RE_BAD = /CAÍDA|CAIDA|POR CORTAR|NO VENDER/i;
const RE_WATCH = /SEGUIMIENTO|CAMBIAR (LA )?(CLAVE|CONTRASEÑA)|DESENLAZAR/i;
export const PASSWORD_OLD_DAYS = 90;

export type RiskLevel = "ok" | "warn" | "bad";
/** `inactive`: la cuenta está retirada o todos sus perfiles fueron dados de baja (caída): no es una alerta, es historial. */
export interface Risk { level: RiskLevel; reasons: string[]; inactive?: boolean }

/** Semáforo de una cuenta: rojo = clientes en peligro ya; amarillo = algo por revisar; verde = nada; dada de baja = sin alerta. */
export function riskOf(e: Engine, acc: Account, now: number = e.now()): Risk {
  if (acc.status === "retired") return { level: "ok", reasons: [], inactive: true };
  const slots = Object.values(e.s.slots).filter((s) => s.accountId === acc.id && s.status !== "retired");
  // Todos los perfiles dados de baja (la cuenta «caída» que el dueño ya revisó): no hay nadie adentro ni nada que vender → no es alerta.
  if (!slots.length && Object.values(e.s.slots).some((s) => s.accountId === acc.id)) return { level: "ok", reasons: [], inactive: true };
  const clients = slots.filter((s) => s.status === "assigned").length;
  const bad: string[] = [], warn: string[] = [];
  const dLeft = Math.ceil((acc.supplierExpiresAt - now) / DAY);
  if (acc.supplierExpiresAt <= now && clients) bad.push(`venció con el proveedor y tiene ${clients} cliente${clients === 1 ? "" : "s"} adentro`);
  else if (dLeft <= 2 && clients) bad.push(`vence con el proveedor en ${Math.max(dLeft, 0)} día${dLeft === 1 ? "" : "s"}`);
  else if (dLeft <= 7 && acc.supplierExpiresAt - now < NO_DATE_AFTER) warn.push(`vence con el proveedor en ${dLeft} días`);
  if (acc.supplierExpiresAt - now >= NO_DATE_AFTER && clients) warn.push("sin fecha del proveedor");
  if (RE_BAD.test(acc.notes ?? "")) bad.push("marcada caída / por cortar en la nota");
  const alerts = (e.s.accountAlerts ?? []).filter((a) => a.accountId === acc.id && !a.seen);
  if (alerts.some((a) => a.kind === "password_changed" || a.kind === "email_changed" || a.kind === "payment_failed" || a.kind === "cancelled")) bad.push("aviso grave de la plataforma sin ver");
  else if (alerts.length) warn.push("aviso de la plataforma sin ver");
  if (!acc.password) warn.push("clave pendiente");
  const quar = slots.filter((s) => s.status === "quarantined").length;
  if (quar) warn.push(`${quar} perfil${quar === 1 ? "" : "es"} apartado${quar === 1 ? "" : "s"}`);
  if (RE_WATCH.test(acc.notes ?? "")) warn.push("la nota pide seguimiento / cambiar la clave");
  if (acc.passwordChangedAt && now - acc.passwordChangedAt > PASSWORD_OLD_DAYS * DAY && clients) warn.push(`clave sin cambiar hace más de ${PASSWORD_OLD_DAYS} días`);
  return bad.length ? { level: "bad", reasons: [...bad, ...warn] } : warn.length ? { level: "warn", reasons: warn } : { level: "ok", reasons: [] };
}

/**
 * «Cortes»: cuentas vendidas por perfiles donde los clientes vencen en fechas distintas. Para cada una,
 * la fecha de corte sugerida es la que más se repite entre sus clientes (si empatan, la más lejana), y
 * cada perfil dice cuántos días le sobran (+) o le faltan (−) respecto de esa fecha. No cambia nada.
 */
export function cutsReport(e: Engine, actor: Actor, now: number = e.now()) {
  authorize(actor, "inventory.manage");
  const out = [];
  for (const acc of Object.values(e.s.accounts)) {
    if (acc.status !== "active") continue;
    const prod = e.s.products[acc.productId];
    if (!prod || prod.kind !== "profile") continue;
    const slots = Object.values(e.s.slots).filter((s) => s.accountId === acc.id && s.status !== "retired");
    const rows = slots.map((s) => {
      const a = s.status === "assigned" ? Object.values(e.s.assignments).find((x) => x.slotId === s.id && x.status === "active") : undefined;
      const c = a ? e.s.customers[a.customerId] : undefined;
      return { slotId: s.id, label: s.label, status: s.status, ...(a ? { assignmentId: a.id, customerId: a.customerId, customer: c?.name ?? "", phone: c?.phone ?? "", expiresAt: a.customerExpiresAt, payStatus: a.control?.payStatus ?? null } : {}) };
    });
    const dated = rows.filter((r): r is typeof r & { expiresAt: number } => typeof r.expiresAt === "number");
    if (!dated.length) continue;
    const byDay = new Map<string, { day: number; n: number }>();
    for (const r of dated) { const k = boDayKey(r.expiresAt); const b = byDay.get(k) ?? { day: boDayStart(r.expiresAt), n: 0 }; b.n++; byDay.set(k, b); }
    const best = [...byDay.values()].sort((x, y) => y.n - x.n || y.day - x.day)[0];
    const suggestedCut = best.day;
    const days = dated.map((r) => boDayStart(r.expiresAt));
    const spreadDays = Math.round((Math.max(...days) - Math.min(...days)) / DAY);
    out.push({
      accountId: acc.id, email: acc.email, productId: acc.productId, product: prod.name, supplierExpiresAt: acc.supplierExpiresAt,
      passwordChangedAt: acc.passwordChangedAt ?? null, risk: riskOf(e, acc, now),
      suggestedCut, spreadDays, aligned: spreadDays === 0, clients: dated.length, free: rows.filter((r) => r.status === "available").length,
      profiles: rows.map((r) => ({ ...r, ...(typeof r.expiresAt === "number" ? { diffDays: Math.round((boDayStart(r.expiresAt) - suggestedCut) / DAY) } : {}) }))
        .sort((x, y) => (x.expiresAt ?? Infinity) - (y.expiresAt ?? Infinity) || x.label.localeCompare(y.label)),
    });
  }
  // Primero las desalineadas con más dispersión; después por fecha de corte.
  return out.sort((x, y) => Number(y.spreadDays > 0) - Number(x.spreadDays > 0) || y.spreadDays - x.spreadDays || x.suggestedCut - y.suggestedCut);
}

/** Cambio de clave guiado: nueva clave, fecha del cambio, auditoría y aviso a los clientes de esa cuenta. */
export function rotatePassword(e: Engine, actor: Actor, accountId: Id, password: unknown) {
  authorize(actor, "inventory.manage");
  const pw = String(password ?? "");
  if (pw.trim().length < 4 || pw.length > 120) throw new DomainError("VALIDATION", "La clave nueva tiene que tener entre 4 y 120 letras");
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    if (acc.status === "retired") throw new DomainError("INVALID_STATE", "La cuenta está retirada");
    if (pw === acc.password) throw new DomainError("VALIDATION", "Es la misma clave de antes");
    acc.password = pw;
    acc.passwordChangedAt = e.now();
    let notified = 0;
    for (const a of Object.values(e.s.assignments)) {
      if (a.status !== "active" || e.s.slots[a.slotId]?.accountId !== acc.id) continue;
      a.history.push({ at: e.now(), by: actor.id, event: "access_updated", slotId: a.slotId, note: "clave de la cuenta cambiada" });
      queue(e, a.customerId, "access_updated", { product: e.s.products[a.productId]?.name ?? "" });
      notified++;
    }
    e.audit(actor, "account.password_rotated", "account", acc.id, { notified });
    return { accountId: acc.id, passwordChangedAt: acc.passwordChangedAt, notified };
  });
}
