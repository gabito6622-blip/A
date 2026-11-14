// «🔁 Que vuelvan» del revendedor (13/11/2026): SUS clientes a los que se les venció y no renovaron, para escribirles
// con un mensaje listo. Las mismas fórmulas que usa el dueño, pero solo con lo suyo:
//  - Clientes registrados: el servicio se cerró por vencido hace hasta 60 días y hoy no tiene otro activo del mismo producto.
//  - Perfiles repartidos: vencieron hace más de 30 días (hasta ahí los muestra «Mi día» en «Para cobrar») y hasta 90.
// «✅ Ya le escribí» lo saca de la lista 7 días. Nada se manda solo; nunca salen costos, correos ni claves.
// Aislamiento: todo parte de `resellerId === yo` o de mis propios alquileres; no hay forma de pedir los de otro.
import type { Actor, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart } from "./time.js";
import { currencyOf, listPriceMine } from "./country.js";
import { listMine } from "./subRentals.js";
import { DAY_BACK_DAYS } from "./resellerDay.js";
import { myDebts, personKey } from "./deudas.js";

/** Clientes registrados: cerrados por vencido en los últimos N días. */
export const BACK_CLIENT_DAYS = 60;
/** Perfiles repartidos: vencidos entre DAY_BACK_DAYS y N días. */
export const BACK_SUB_DAYS = 90;
/** «Ya le escribí»: días que no vuelve a aparecer. */
export const BACK_QUIET_DAYS = 7;

export interface BackItem {
  /** "c:<assignmentId>" (cliente registrado) o "s:<assignmentId>|<subId>" (perfil repartido). */
  key: string;
  kind: "client" | "sub";
  client: string;
  phone: string;
  product: string;
  /** Perfil del reparto, si es un perfil repartido. */
  label?: string;
  expiredAt: number;
  /** Días desde que venció. */
  days: number;
  /** Lo que le cobraba, en SU moneda (null = sin precio cargado). */
  price: Cents | null;
}

function reseller(e: Engine, actor: Actor) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return e.get("customers", actor.customerId);
}
const shortName = (n: string) => n.replace(/ \(alquiler revendedores\)/, "");

/** Todos los renglones de ESTE revendedor, sin mirar los «Ya le escribí». */
function allItems(e: Engine, actor: Actor): BackItem[] {
  const me = reseller(e, actor);
  const today = boDayStart(e.now());
  const daysSince = (t: number) => Math.round((today - boDayStart(t)) / DAY);
  const out: BackItem[] = [];
  // Clientes registrados: servicios cerrados por vencimiento, sin otro activo del mismo producto.
  const mine = Object.values(e.s.assignments).filter((a) => e.s.customers[a.customerId]?.resellerId === me.id);
  const active = new Set(mine.filter((a) => a.status === "active").map((a) => `${a.customerId}|${a.productId}`));
  const seen = new Set<string>();
  for (const a of mine.sort((x, y) => y.customerExpiresAt - x.customerExpiresAt)) {
    if (a.status !== "revoked") continue;
    const last = a.history[a.history.length - 1];
    if (!last || last.event !== "revoked" || last.note !== "vencido") continue;
    const days = daysSince(a.customerExpiresAt), k = `${a.customerId}|${a.productId}`;
    if (days < 1 || days > BACK_CLIENT_DAYS || active.has(k) || seen.has(k)) continue;
    seen.add(k); // un renglón por cliente y producto (el vencimiento más reciente)
    const c = e.s.customers[a.customerId];
    out.push({ key: `c:${a.id}`, kind: "client", client: c.name, phone: c.phone ?? "", product: shortName(e.s.products[a.productId]?.name ?? ""), expiredAt: a.customerExpiresAt, days, price: a.rcontrol?.price ?? listPriceMine(e, me, a.productId) ?? null });
  }
  // Perfiles repartidos que quedaron vencidos hace rato en sus cuentas alquiladas.
  for (const a of listMine(e, actor)) for (const s of a.subs) {
    const days = daysSince(s.expiresAt);
    if (days <= DAY_BACK_DAYS || days > BACK_SUB_DAYS) continue;
    out.push({ key: `s:${a.assignmentId}|${s.id}`, kind: "sub", client: s.name, phone: s.phone, product: a.product, label: s.label, expiredAt: s.expiresAt, days, price: s.price ?? null });
  }
  return out.sort((x, y) => x.days - y.days || x.client.localeCompare(y.client, "es"));
}

export function myWinback(e: Engine, actor: Actor) {
  const me = reseller(e, actor);
  const now = e.now(), quiet = me.backQuiet ?? {};
  // 15/11: quien todavía le debe no sale acá (ya está en «Cobrar hoy» con su mensaje para cobrar): antes salía en las dos
  // listas y el mensaje de «Que vuelvan» le ofrecía activarlo de nuevo sin decir nada de la deuda.
  const owing = new Set(myDebts(e, actor).items.map((d) => personKey(d.client, d.phone)));
  const all = allItems(e, actor).filter((it) => !owing.has(personKey(it.client, it.phone)));
  const items = all.filter((it) => !((quiet[it.key] ?? 0) > now));
  const owingN = new Set(allItems(e, actor).filter((it) => owing.has(personKey(it.client, it.phone))).map((it) => personKey(it.client, it.phone))).size;
  return { currency: currencyOf(e, me), items, written: all.length - items.length, quietDays: BACK_QUIET_DAYS, owing: owingN };
}

/** «✅ Ya le escribí»: saca ese renglón de la lista por 7 días (o lo devuelve con `off`). Solo sobre lo suyo. */
export function markBack(e: Engine, actor: Actor, key: unknown, off = false) {
  const me = reseller(e, actor);
  const k = String(key ?? "");
  // Tiene que ser un renglón que hoy existe para ÉL (con o sin silencio): así nadie marca claves ajenas ni inventadas.
  if (!allItems(e, actor).some((it) => it.key === k)) throw new DomainError("NOT_FOUND", "Ese cliente ya no está en la lista");
  return e.tx(() => {
    const now = e.now(), c = e.get("customers", me.id);
    const q: Record<string, number> = {};
    for (const [kk, until] of Object.entries(c.backQuiet ?? {})) if (until > now) q[kk] = until; // limpia los vencidos
    if (off) delete q[k]; else q[k] = now + BACK_QUIET_DAYS * DAY;
    if (Object.keys(q).length) c.backQuiet = q; else delete c.backQuiet;
    return { ok: true as const, key: k, until: off ? null : q[k] };
  });
}
