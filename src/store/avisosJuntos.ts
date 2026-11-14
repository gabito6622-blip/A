// Un solo WhatsApp por persona cuando se hacen varias cosas juntas (revisión de 3 meses, 16/11/2026). «Renovar varias»
// con un QR dejaba un aviso por cada cuenta: «registramos tu pedido #1…», «#2…», «#3…» y después «renovamos Netflix»,
// «renovamos Disney»… y al dueño un «nuevo pago para revisar» por cada pedido. Acá se juntan los avisos que se acaban
// de preparar (en la misma operación) en uno por persona, con la MISMA plantilla (sirve igual para el bot oficial).
import type { Id, OutboxMessage, TemplateId } from "./types.js";
import type { Engine } from "./engine.js";
import { render } from "./notify.js";

const andList = (xs: string[]) => (xs.length <= 1 ? xs.join("") : `${xs.slice(0, -1).join(", ")} y ${xs[xs.length - 1]}`);

/** Lo que dice el aviso único, a partir de los avisos que junta. `extra` pisa parámetros (p. ej. el total sumado). */
function combined(template: TemplateId, msgs: OutboxMessage[], extra: Record<string, string>): Record<string, string> {
  const p0 = msgs[0].params;
  if (template === "renewal_confirmed") {
    const products = [...new Set(msgs.map((m) => m.params.product))];
    const dates = new Set(msgs.map((m) => m.params.date));
    return { ...p0, product: andList(products), date: dates.size === 1 ? p0.date : msgs.map((m) => `${m.params.product} ${m.params.date}`).join(" · "), ...extra };
  }
  if ("order" in p0) return { ...p0, order: msgs.map((m) => m.params.order).join(", #"), ...extra };
  return { ...p0, ...extra };
}

/**
 * Junta en uno por destinatario los avisos de `template` que se prepararon desde la posición `from` de la bandeja.
 * Solo los que siguen en cola o sin enviar (nunca toca uno que ya salió). Devuelve cuántos se juntaron.
 */
export function mergeQueued(e: Engine, from: number, template: TemplateId, extra: (to: Id, msgs: OutboxMessage[]) => Record<string, string> = () => ({})): number {
  const fresh = e.s.outbox.slice(from).filter((m) => m.template === template && (m.status === "queued" || m.status === "skipped_no_consent"));
  const by = new Map<string, OutboxMessage[]>();
  for (const m of fresh) { const k = `${m.customerId}|${m.to}`; by.set(k, [...(by.get(k) ?? []), m]); }
  const drop = new Set<Id>();
  for (const msgs of by.values()) {
    if (msgs.length < 2) continue;
    const keep = msgs[0];
    keep.params = combined(template, msgs, extra(keep.customerId, msgs));
    keep.text = render(template, keep.params);
    for (const m of msgs.slice(1)) drop.add(m.id);
  }
  if (drop.size) e.s.outbox = e.s.outbox.filter((m) => !drop.has(m.id));
  return drop.size;
}
