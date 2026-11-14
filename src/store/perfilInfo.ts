// Ficha de un perfil suelto comprado a otra persona (perfilSuelto.ts): lo que te costó, a cuánto lo vendiste y lo que
// ganás. Solo lee. Aparte de perfilSuelto.ts para que la lista de cuentas (inventory.ts) lo use sin importarse en círculo.
import type { Cents, Id, LooseFall, Slot } from "./types.js";
import type { Engine } from "./engine.js";
import { effectivePrice } from "./admin.js";

const fbs = (c: Cents) => `Bs ${(c / 100).toFixed(2).replace(/\.00$/, "")}`;

export interface LooseInfo {
  supplierId: Id; supplierName: string; cost: Cents; usd?: number; rate?: number; until: number; boughtAt: number;
  down?: LooseFall; falls: number;
  /** Si está vendido: a cuánto (por período) y cuánto ganás. */
  soldFor?: Cents; gain?: Cents; customerName?: string;
  /** «Te costó Bs 15 · lo vendiste a Bs 25 · ganás Bs 10». */
  text: string;
  /** «Le pagué a Juan»: lo que se sugiere pagar (lo mismo que la última vez). */
  suggest: Cents;
}

export function looseInfo(e: Engine, slot: Slot): LooseInfo | undefined {
  const l = slot.loose;
  if (!l) return undefined;
  const sup = e.s.suppliers[l.supplierId];
  const a = slot.status === "assigned" ? Object.values(e.s.assignments).find((x) => x.slotId === slot.id && x.status === "active") : undefined;
  const soldFor = a ? effectivePrice(e, a) : undefined;
  const gain = soldFor !== undefined ? soldFor - l.cost : undefined;
  const text = soldFor !== undefined
    ? `Te costó ${fbs(l.cost)} · lo vendiste a ${fbs(soldFor)} · ${gain! >= 0 ? `ganás ${fbs(gain!)}` : `perdés ${fbs(-gain!)}`}`
    : `Te costó ${fbs(l.cost)} · todavía no lo vendiste`;
  return {
    supplierId: l.supplierId, supplierName: sup?.name ?? "Vendedor borrado", cost: l.cost, ...(l.usd ? { usd: l.usd, rate: l.rate } : {}),
    until: l.until, boughtAt: l.boughtAt, ...(l.down ? { down: l.down } : {}), falls: l.falls?.length ?? 0,
    ...(soldFor !== undefined ? { soldFor, gain, customerName: e.s.customers[a!.customerId]?.name ?? "" } : {}),
    text, suggest: l.cost,
  };
}
