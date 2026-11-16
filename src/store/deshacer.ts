/**
 * ↩️ Deshacer un cobro (16/11/2026). El dueño anotó «Me pagó» de una cuenta que no le habían pagado y deshacerlo a mano
 * fue complicado (hasta quedó un cobro de más). Ahora cada «Me pagó» / «Renovar» del panel guarda cómo estaba el alquiler
 * antes; por 30 minutos, «Deshacer» lo deja exactamente igual: la fecha, el Control (y su lista de cobros), los pedidos
 * de ese cobro (quedan «cancelados» con la marca de deshecho, no se borran), lo fiado que se anotó con él y el aviso
 * por WhatsApp que todavía no salió. Si el alquiler cambió después (otro cobro, un corte, otra fecha), no se deshace.
 */
import type { Actor, Id, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

export const UNDO_MINUTES = 30;
const refs = (o: Order, id: Id) => o.assignmentIds?.includes(id) || o.renewal?.assignmentId === id;

/** Foto de todo lo que puede tocar un cobro de ese alquiler (antes de hacerlo). */
export function undoSnapshot(e: Engine, assignmentId: Id): string {
  const a = e.get("assignments", assignmentId);
  return JSON.stringify({
    a, orders: Object.fromEntries(Object.values(e.s.orders).filter((o) => refs(o, a.id)).map((o) => [o.id, o])),
    orderIds: Object.keys(e.s.orders), fiadoLen: (e.s.fiado ?? []).length, outboxLen: e.s.outbox.length,
    idem: Object.keys(e.s.idempotency).filter((k) => k.includes(a.id)),
  });
}

/** Después del cobro: deja guardado cómo estaba y cómo quedó (solo el último cobro de cada alquiler). */
export function undoRecord(e: Engine, actor: Actor, assignmentId: Id, before: string, label: string): void {
  e.tx(() => {
    const now = e.now(), keep = UNDO_MINUTES * 60_000;
    const map = (e.s.payUndo ??= {});
    for (const [k, v] of Object.entries(map)) if (now - v.at > keep) delete map[k];
    map[assignmentId] = { at: now, by: actor.id, label: String(label).slice(0, 160), before, after: JSON.stringify(e.s.assignments[assignmentId]) };
  });
}

/** Cobros que todavía se pueden deshacer (los últimos 30 minutos y sin cambios después). */
export function undoList(e: Engine, actor: Actor) {
  authorize(actor, "payment.review");
  const now = e.now();
  return Object.entries(e.s.payUndo ?? {})
    .filter(([id, v]) => now - v.at <= UNDO_MINUTES * 60_000 && JSON.stringify(e.s.assignments[id]) === v.after)
    .map(([id, v]) => ({ assignmentId: id, at: v.at, label: v.label, minutesLeft: Math.max(1, Math.ceil((v.at + UNDO_MINUTES * 60_000 - now) / 60_000)) }))
    .sort((x, y) => y.at - x.at);
}

/** Deshace el último cobro de un alquiler. */
export function undoPay(e: Engine, actor: Actor, assignmentId: Id) {
  authorize(actor, "payment.review");
  return e.tx(() => {
    const rec = e.s.payUndo?.[assignmentId];
    if (!rec || e.now() - rec.at > UNDO_MINUTES * 60_000) throw new DomainError("NOT_FOUND", `Ya no se puede deshacer: pasaron más de ${UNDO_MINUTES} minutos. Corregilo a mano.`);
    if (JSON.stringify(e.s.assignments[assignmentId]) !== rec.after) throw new DomainError("VALIDATION", "Ese alquiler cambió después del cobro: corregilo a mano");
    const b = JSON.parse(rec.before) as { a: never; orders: Record<Id, Order>; orderIds: Id[]; fiadoLen: number; outboxLen: number; idem: string[] };
    const a = e.s.assignments[assignmentId];
    const known = new Set(b.orderIds);
    // Pedidos que creó este cobro: quedan cancelados (no se borran) y marcados como deshechos.
    const undone: Id[] = [];
    for (const o of Object.values(e.s.orders)) {
      if (known.has(o.id) || !refs(o, assignmentId)) continue;
      o.status = "cancelled"; o.updatedAt = e.now();
      (o as Order & { undone?: unknown }).undone = { at: e.now(), by: actor.id };
      undone.push(o.id);
    }
    // Pedidos que ya existían (p. ej. un fiado que el cobro marcó como pagado): vuelven a como estaban.
    for (const [id, o] of Object.entries(b.orders)) e.s.orders[id] = o;
    // Lo fiado que se anotó con este cobro.
    if (e.s.fiado && e.s.fiado.length > b.fiadoLen) {
      const extra = e.s.fiado.slice(b.fiadoLen);
      e.s.fiado = [...e.s.fiado.slice(0, b.fiadoLen), ...extra.filter((x) => (x as { assignmentId?: Id }).assignmentId !== assignmentId)];
    }
    // El aviso «renovamos…» que todavía no salió.
    const tail = e.s.outbox.slice(b.outboxLen);
    e.s.outbox = [...e.s.outbox.slice(0, b.outboxLen), ...tail.filter((m) => !(m.customerId === a.customerId && m.template === "renewal_confirmed" && m.status !== "sent" && m.status !== "sent_manually"))];
    // Las llaves de «no cobrar dos veces» de ese cobro: si lo vuelven a anotar, se anota de verdad.
    const keepIdem = new Set(b.idem);
    for (const k of Object.keys(e.s.idempotency)) if (k.includes(assignmentId) && !keepIdem.has(k)) delete e.s.idempotency[k];
    e.s.assignments[assignmentId] = b.a;
    delete e.s.payUndo![assignmentId];
    e.audit(actor, "payment.undo", "assignment", assignmentId, { label: rec.label, orders: undone });
    return { ok: true, label: rec.label, expiresAt: (b.a as { customerExpiresAt: number }).customerExpiresAt };
  });
}
