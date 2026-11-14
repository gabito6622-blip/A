// «Te deben» en un solo lugar (14/11/2026): Repartir perfiles, Quién me debe y «Cobrar hoy» de Mi día muestran el MISMO
// número y la misma lista. Antes cada pantalla contaba distinto (una sola marca «pendiente», sin los vencidos sin renovar,
// y Mi día soltaba a los de más de 30 días).
//  - Perfiles repartidos: lo que debe cada uno hoy (cuadernoPlata.ts), también los de una cuenta que se cortó (siguen
//    anotados: lo que debían hasta el corte no se borra).
//  - Clientes registrados: su libreta de «Quién me debe» (fiado.ts) más lo marcado «Pendiente» en Mi control que todavía
//    no pasó a la libreta.
// Solo lo de este revendedor: sus alquileres (`customerId === yo`) y su libreta (`creditorId === yo`).
import type { Actor, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { subMoney } from "./cuadernoPlata.js";
import { overview } from "./fiado.js";

export interface DebtItem {
  /** "sub" = perfil repartido (id = alquiler|perfil); "fiado" = cliente registrado (id = f|cliente). */
  kind: "sub" | "fiado";
  id: string;
  assignmentId?: Id;
  subId?: Id;
  customerId?: Id;
  client: string;
  phone: string;
  productId: Id;
  product: string;
  label?: string;
  /** Lo que debe hoy, en SU moneda. */
  owed: Cents;
  /** Lo que le cobra por período (perfiles). */
  unit?: Cents | null;
  /** Desde cuándo debe (el período más viejo) y los períodos, para mostrar «debe 31/08 y 30/09». */
  since: number;
  periods?: { from: number; to: number; owed: Cents }[];
  /** La cuenta de la tienda donde estaba se cortó (el cuaderno sigue). */
  cut?: boolean;
  linkToken?: string;
  pay: "pagado" | "pendiente" | "no_pago";
}

const short = (n: string) => n.replace(/ \(alquiler revendedores\)/, "");
export const personKey = (name: string, phone: string) => `${name.trim().toLowerCase()}|${phone.replace(/\D/g, "")}`;

/** Todo lo que le deben a este revendedor, de lo más viejo a lo más nuevo. */
export function myDebts(e: Engine, actor: Actor): { items: DebtItem[]; total: Cents; people: number } {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const meId = actor.customerId, now = e.now();
  const items: DebtItem[] = [];
  for (const a of Object.values(e.s.assignments)) {
    if (a.customerId !== meId || !a.subs?.length || e.s.products[a.productId]?.kind !== "full_account") continue;
    if (a.status !== "active" && a.status !== "revoked") continue;
    for (const s of a.subs) {
      const m = subMoney(e, a, s, now);
      if (m.owed <= 0) continue;
      items.push({ kind: "sub", id: `${a.id}|${s.id}`, assignmentId: a.id, subId: s.id, client: s.name, phone: s.phone ?? "", productId: a.productId, product: short(e.s.products[a.productId]?.name ?? ""),
        label: s.label, owed: m.owed, unit: s.price ?? null, since: m.periods[0]?.from ?? s.expiresAt, periods: m.periods.map((p) => ({ from: p.from, to: p.to, owed: p.owed })),
        ...(a.status !== "active" ? { cut: true } : {}), ...(s.link && a.status === "active" ? { linkToken: s.link.token } : {}), pay: m.pay });
    }
  }
  for (const r of overview(e, actor).rows) {
    const owed = r.owed + r.unlinked.amount;
    if (owed <= 0) continue;
    items.push({ kind: "fiado", id: `f|${r.customerId}`, customerId: r.customerId, client: r.name, phone: r.phone, productId: r.apps[0]?.productId ?? "", product: r.apps.map((x) => x.product).join(" · ") || "Fiado",
      owed, since: r.oldestAt ?? r.nextDue ?? now, pay: "pendiente" });
  }
  items.sort((x, y) => x.since - y.since || x.client.localeCompare(y.client, "es"));
  return { items, total: items.reduce((t, x) => t + x.owed, 0), people: new Set(items.map((x) => personKey(x.client, x.phone))).size };
}
