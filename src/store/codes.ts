// Códigos de verificación por correo.
// El dueño autoriza un buzón; un integrador (IMAP u otro, fuera de este módulo) entrega los
// mensajes con `ingest`. El cliente ve solo códigos dirigidos a cuentas que tiene activas,
// recibidos después de su asignación y dentro de la ventana de visibilidad.
import type { Actor, CodeMessage, Id, Mailbox } from "./types.js";
import type { Engine } from "./engine.js";
import { MINUTE } from "./time.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { canActFor } from "./catalog.js";

export function configureMailbox(e: Engine, actor: Actor, m: { address: string; host: string; subjectAllowlist: string[] }): Mailbox {
  authorize(actor, "codes.configure");
  if (!m.subjectAllowlist.length) throw new DomainError("VALIDATION", "Definí al menos un asunto permitido");
  return e.tx(() => {
    const box: Mailbox = { id: e.id("mbx"), address: m.address.toLowerCase(), host: m.host, authorizedBy: actor.id, authorizedAt: e.now(), subjectAllowlist: m.subjectAllowlist };
    e.s.mailboxes[box.id] = box;
    e.audit(actor, "mailbox.authorize", "mailbox", box.id, { address: box.address, host: box.host });
    return box;
  });
}

const CODE_RE = /\b(\d{3}[ -]?\d{3}|\d{4,8})\b/;

/** Guarda un mensaje solo si el asunto está permitido y trae un código. Devuelve null si se descarta. */
export function ingest(e: Engine, actor: Actor, mailboxId: Id, msg: { to: string; subject: string; body: string; receivedAt: number }): CodeMessage | null {
  authorize(actor, "codes.ingest");
  const box = e.get("mailboxes", mailboxId);
  const allowed = box.subjectAllowlist.some((s) => msg.subject.toLowerCase().includes(s.toLowerCase()));
  const code = msg.body.match(CODE_RE)?.[1];
  if (!allowed || !code) return null;
  return e.tx(() => {
    const c: CodeMessage = { id: e.id("cod"), mailboxId, to: msg.to.toLowerCase(), subject: msg.subject, code, receivedAt: msg.receivedAt };
    e.s.codes.push(c);
    return c;
  });
}

export function codesFor(e: Engine, actor: Actor, customerId: Id) {
  if (!canActFor(e, actor, customerId)) throw new DomainError("FORBIDDEN", "No podés ver códigos de otro cliente");
  const windowMs = e.opts.codeVisibleMinutes * MINUTE;
  const mine = Object.values(e.s.assignments)
    .filter((a) => a.customerId === customerId && a.status === "active")
    .map((a) => ({ email: e.s.accounts[e.s.slots[a.slotId].accountId].email, since: a.startsAt }));
  return e.s.codes
    .filter((c) => e.now() - c.receivedAt <= windowMs && mine.some((m) => m.email === c.to && c.receivedAt >= m.since))
    .sort((a, b) => b.receivedAt - a.receivedAt)
    .map((c) => ({ to: c.to, subject: c.subject, code: c.code, receivedAt: c.receivedAt }));
}
