// Fallas: el cliente o su revendedor avisa que un servicio no anda ("no entra", "pide código"…)
// y ve cómo va: Recibido → Revisando → Solucionado. La tienda responde desde el panel.
import type { Actor, Id, Ticket, TicketKind, TicketStatus } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, isStaff } from "./auth.js";
import { canActFor } from "./catalog.js";
import { DomainError } from "./errors.js";

export const TICKET_KINDS: Record<TicketKind, string> = {
  no_entra: "No me deja entrar",
  codigo: "Me pide un código",
  pantallas: "Dice que hay muchas pantallas",
  perfil: "Problema con el perfil o PIN",
  otro: "Otro problema",
};
const STATUSES: TicketStatus[] = ["recibido", "revisando", "solucionado"];
const all = (e: Engine) => (e.s.tickets ??= {});

function view(e: Engine, t: Ticket, staff: boolean) {
  const a = e.s.assignments[t.assignmentId], slot = a ? e.s.slots[a.slotId] : undefined, acc = slot ? e.s.accounts[slot.accountId] : undefined;
  const c = e.s.customers[t.customerId], rep = e.s.customers[t.reporterId];
  return {
    id: t.id, assignmentId: t.assignmentId, customerId: t.customerId, client: c?.name ?? "?", clientPhone: c?.phone ?? "",
    product: a ? e.s.products[a.productId]?.name ?? "" : "", profile: slot?.label ?? "", email: acc?.email ?? "",
    kind: t.kind, kindText: TICKET_KINDS[t.kind], note: t.note, status: t.status, reply: t.reply ?? "", createdAt: t.createdAt, updatedAt: t.updatedAt,
    ...(staff ? { reporter: rep?.name ?? "?", reporterPhone: rep?.phone ?? "", reporterKind: rep?.kind ?? "customer", accountId: acc?.id } : {}),
  };
}

/** El cliente (o su revendedor) reporta una falla de un servicio. */
export function report(e: Engine, actor: Actor, input: { assignmentId: Id; kind?: unknown; note?: unknown }) {
  if (!actor.customerId) throw new DomainError("FORBIDDEN", "Entrá con tu cuenta para reportar");
  const kind = String(input.kind ?? "otro") as TicketKind;
  if (!TICKET_KINDS[kind]) throw new DomainError("VALIDATION", "Elegí qué pasa");
  const note = String(input.note ?? "").trim();
  if (note.length > 300) throw new DomainError("VALIDATION", "Contalo en hasta 300 letras");
  return e.tx(() => {
    const a = e.get("assignments", input.assignmentId);
    if (!canActFor(e, actor, a.customerId)) throw new DomainError("FORBIDDEN", "Ese servicio no es tuyo");
    if (a.status !== "active") throw new DomainError("VALIDATION", "Ese servicio ya no está activo");
    const open = Object.values(all(e)).find((t) => t.assignmentId === a.id && t.status !== "solucionado");
    if (open) throw new DomainError("VALIDATION", "Ya reportaste ese servicio: lo estamos revisando");
    const now = e.now();
    const t: Ticket = { id: e.id("tik"), assignmentId: a.id, customerId: a.customerId, reporterId: actor.customerId!, kind, note, status: "recibido", createdAt: now, updatedAt: now };
    all(e)[t.id] = t;
    e.audit(actor, "ticket.create", "assignment", a.id, { ticket: t.id, kind });
    return view(e, t, false);
  });
}

/** Las fallas que reportó el cliente o revendedor (y las de sus clientes), las últimas 60. */
export function mine(e: Engine, actor: Actor) {
  if (!actor.customerId) throw new DomainError("FORBIDDEN", "Entrá con tu cuenta");
  const me = actor.customerId;
  return Object.values(all(e))
    .filter((t) => t.reporterId === me || t.customerId === me || e.s.customers[t.customerId]?.resellerId === me)
    .sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 60).map((t) => view(e, t, false));
}

/** Para el panel: todas, abiertas primero. */
export function list(e: Engine, actor: Actor) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo el equipo de la tienda");
  const order = { recibido: 0, revisando: 1, solucionado: 2 } as const;
  return Object.values(all(e))
    .filter((t) => t.status !== "solucionado" || e.now() - t.updatedAt < 30 * 86_400_000)
    .sort((a, b) => order[a.status] - order[b.status] || a.createdAt - b.createdAt).map((t) => view(e, t, true));
}

export const openCount = (e: Engine) => Object.values(e.s.tickets ?? {}).filter((t) => t.status === "recibido").length;

/** La tienda cambia el estado y deja una respuesta. Devuelve a quién avisar. */
export function setStatus(e: Engine, actor: Actor, id: Id, input: { status?: unknown; reply?: unknown }) {
  authorize(actor, "customer.manage");
  const status = String(input.status ?? "") as TicketStatus;
  if (!STATUSES.includes(status)) throw new DomainError("VALIDATION", "Estado inválido");
  const reply = input.reply === undefined ? undefined : String(input.reply ?? "").trim();
  if (reply && reply.length > 300) throw new DomainError("VALIDATION", "La respuesta va hasta 300 letras");
  return e.tx(() => {
    const t = all(e)[id];
    if (!t) throw new DomainError("NOT_FOUND", "Falla no encontrada");
    const was = t.status;
    t.status = status;
    if (reply !== undefined) t.reply = reply || undefined;
    t.updatedAt = e.now();
    e.audit(actor, "ticket.status", "assignment", t.assignmentId, { ticket: t.id, from: was, to: status });
    return { ticket: view(e, t, true), notify: was !== status ? t.reporterId : null };
  });
}
