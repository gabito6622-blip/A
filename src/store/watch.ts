// Vigilante de cuentas: lee (con reglas) los correos que las plataformas mandan a las cuentas y avisa
// cuando una cuenta está en riesgo (cambio de contraseña o de correo, pago rechazado, membresía en
// espera o cancelada) ANTES de que se quejen los clientes. No toca la cuenta: el dueño decide.
import type { Actor, AccountAlert, AccountAlertKind, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY } from "./time.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

const RULES: [AccountAlertKind, RegExp][] = [
  ["password_changed", /(se (ha )?cambi[oó] (la |tu )?contrase[ñn]a|tu contrase[ñn]a (fue|ha sido|se) (cambiada|modificada|actualizada|restablecida)|cambio de contrase[ñn]a|password (was|has been) (changed|reset|updated)|your password (was )?changed|password change)/],
  ["email_changed", /(se (ha )?cambi[oó] (el |tu )?(correo|e-?mail)|(tu )?(correo|e-?mail) (fue|ha sido) (cambiado|actualizado)|(e-?mail|email address) (was|has been) (changed|updated)|cambio de (correo|e-?mail))/],
  ["cancelled", /(membres[ií]a (fue |ha sido )?cancelada|cancelamos tu (membres[ií]a|suscripci[oó]n)|suscripci[oó]n (fue |ha sido )?cancelada|(membership|subscription) (has been |was )?(cancel(l)?ed|ended)|we('ve| have) cancel(l)?ed)/],
  ["payment_failed", /(problema con (tu|el) (pago|m[eé]todo de pago)|no (pudimos|se pudo) (procesar|cobrar|realizar)|pago (rechazado|fallido|declinado)|payment (failed|declined|issue|problem)|(update|actualiz[aá]) (your|tu) (payment|forma de pago|m[eé]todo de pago)|en espera|on hold|suspendid[ao]|suspended)/],
  ["new_device", /(nuevo (inicio de sesi[oó]n|dispositivo|acceso)|new (sign-?in|login|device)|inicio de sesi[oó]n (nuevo|desde)|someone (signed|logged) in)/],
];
export const ALERT_TEXT: Record<AccountAlertKind, string> = {
  password_changed: "le cambiaron la contraseña",
  email_changed: "le cambiaron el correo",
  payment_failed: "tiene un problema con el pago o quedó en espera",
  cancelled: "la cancelaron",
  new_device: "alguien entró desde un dispositivo nuevo",
  other: "llegó un aviso raro de la plataforma",
};
/** Qué tan grave es cada aviso (los graves suben a Notificaciones como urgentes). */
export const ALERT_SEVERE: Record<AccountAlertKind, boolean> = { password_changed: true, email_changed: true, payment_failed: true, cancelled: true, new_device: false, other: false };

/** Clasifica un correo por reglas. null = no es un aviso de riesgo (los códigos de acceso no cuentan). */
export function classifyRisk(subject: string, body: string): AccountAlertKind | null {
  const s = `${subject}\n${body}`.toLowerCase().normalize("NFC").slice(0, 6000);
  for (const [k, re] of RULES) if (re.test(s)) return k;
  return null;
}

/** Guarda el aviso si el correo es de una cuenta cargada. No repite el mismo aviso de la misma cuenta en 12 h. */
export function recordAlert(e: Engine, actor: Actor, input: { to: string; kind: AccountAlertKind; subject: string; from?: string; at: number; source?: "rules" | "ai" }): AccountAlert | null {
  authorize(actor, "codes.ingest");
  const acc = Object.values(e.s.accounts).find((a) => a.email.toLowerCase() === input.to.toLowerCase() && a.status !== "retired");
  if (!acc) return null;
  return e.tx(() => {
    const list = (e.s.accountAlerts ??= []);
    if (list.some((x) => x.accountId === acc.id && x.kind === input.kind && Math.abs(x.at - input.at) < 12 * 3_600_000)) return null;
    const a: AccountAlert = { id: e.id("alr"), accountId: acc.id, kind: input.kind, subject: input.subject.slice(0, 200), from: (input.from ?? "").slice(0, 120), at: input.at, seen: false, source: input.source ?? "rules" };
    list.push(a);
    // Se guardan 60 días.
    e.s.accountAlerts = list.filter((x) => e.now() - x.at < 60 * DAY);
    e.audit(actor, "account.alert", "account", acc.id, { kind: a.kind });
    return structuredClone(a);
  });
}

export function listAlerts(e: Engine, actor: Actor, opts: { unseenOnly?: boolean } = {}) {
  authorize(actor, "inventory.manage");
  return (e.s.accountAlerts ?? []).filter((a) => !opts.unseenOnly || !a.seen).sort((a, b) => b.at - a.at).slice(0, 100).map((a) => {
    const acc = e.s.accounts[a.accountId];
    const clients = Object.values(e.s.assignments).filter((x) => x.status === "active" && e.s.slots[x.slotId]?.accountId === a.accountId).length;
    return { ...structuredClone(a), email: acc?.email ?? "", product: acc ? e.s.products[acc.productId]?.name ?? "" : "", clients, text: ALERT_TEXT[a.kind], severe: ALERT_SEVERE[a.kind] };
  });
}

export function markAlertSeen(e: Engine, actor: Actor, id: Id) {
  authorize(actor, "inventory.manage");
  return e.tx(() => {
    const a = (e.s.accountAlerts ?? []).find((x) => x.id === id);
    if (!a) throw new DomainError("NOT_FOUND", "Aviso inexistente");
    a.seen = true;
    e.audit(actor, "account.alert_seen", "account", a.accountId, { kind: a.kind });
    return { ok: true as const };
  });
}
