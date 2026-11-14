// «✂️ Hoy se corta» también para los clientes del revendedor y cuando se termina la espera de un pedido de renovación
// (simulación de 3 meses en el lugar del revendedor, 15/11/2026).
//
// Antes el aviso del día del corte (avisoAlquiler.ts) miraba solo los alquileres del revendedor con la tienda, y solo el
// día del corte normal (vencimiento + 2 días):
//  - el Netflix que el revendedor le compró a SU cliente registrado (Pedro, Carmen) se cortaba sin ningún aviso ese día;
//  - si había pedido la renovación y el dueño no la resolvía, la espera (5 días más) se terminaba y el servicio se cortaba
//    esa mañana sin aviso: el «Hoy se corta» nunca salía porque el día del corte normal ya había pasado.
// Acá se calcula el día en que de verdad se corta (con la espera del pedido) y la lista de lo que se corta hoy.
// Solo lee: no cambia nada ni le escribe a nadie.
import type { Assignment, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY, boDayStart } from "./time.js";
import { cutAtOf } from "./dia.js";
import { REQUEST_HOLD_DAYS, renewRequestHold } from "./renovarSinTrabas.js";
import { canRenewHere } from "./renovarVarias.js";
import { renewableNow } from "./orders.js";

/** Cuándo se corta de verdad: el corte normal, o el fin de la espera si pidió la renovación y sigue abierta. */
export function realCutAt(e: Engine, a: Assignment): number | undefined {
  const cut = cutAtOf(a);
  if (cut === undefined) return undefined;
  return renewRequestHold(e, a) ? cut + REQUEST_HOLD_DAYS * DAY : cut;
}

const short = (n: string) => n.replace(/\s*\(alquiler revendedores\)\s*$/i, "");

export interface ClientCut { assignmentId: Id; client: string; product: string; canRenew: boolean; held: boolean }

/** Servicios de los clientes registrados de este revendedor que se cortan HOY (si nadie los renueva). */
export function clientCutsToday(e: Engine, resellerId: Id, now: number = e.now()): ClientCut[] {
  const today = boDayStart(now);
  const out: ClientCut[] = [];
  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active" || a.holdOpen || a.trial) continue;
    const c = e.s.customers[a.customerId];
    if (c?.resellerId !== resellerId) continue;
    const cut = realCutAt(e, a);
    if (cut === undefined || boDayStart(cut) !== today) continue;
    out.push({ assignmentId: a.id, client: c.name, product: short(e.s.products[a.productId]?.name ?? "servicio"), canRenew: canRenewHere(e, resellerId, a) && renewableNow(e, a), held: renewRequestHold(e, a) });
  }
  return out.sort((x, y) => x.client.localeCompare(y.client, "es"));
}
