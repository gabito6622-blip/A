// Avisos de "📦 Mis cuentas propias" para "Tu día" (Inicio del revendedor) y para el aviso diario al
// celular: sus clientes que vencen en los próximos días y sus cuentas que vencen con SU proveedor.
// 14/11/2026: también lo que YA venció (hasta 30 días atrás) y las cuentas caídas con clientes, marcado `late`:
// antes dejaba de avisar el mismo día que vencía y el Inicio decía «todo al día» con clientes vencidos.
//
// Aislamiento: solo lee el cuaderno del propio revendedor (state.ownStock[<su id>]). Devuelve nombres,
// producto, usuario de la cuenta y fecha; nunca contraseñas ni teléfonos.
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY } from "./time.js";

/** Cuántos días antes se avisa (pedido del dueño: 3). */
export const OWN_SOON_DAYS = 3;

/** Lo ya vencido se sigue avisando hasta esto (después pasa a «Que vuelvan»). */
export const OWN_LATE_DAYS = 30;

export interface OwnSoon {
  days: number;
  /** Sus clientes con un cupo que vence en `days` días o menos, o que ya venció (`late`, hasta 30 días). */
  clients: { id: Id; name: string; product: string; expiresAt: number; trial: boolean; late?: true }[];
  /** Sus cuentas que vencen con su proveedor en `days` días o menos, ya vencidas (`late`) o caídas con clientes (`down`). */
  provider: { id: Id; user: string; product: string; expiresAt: number; late?: true; down?: true }[];
}

/** Lo que vence pronto en las cuentas propias de un revendedor (uso interno: el aviso diario). */
export function ownSoonFor(e: Engine, customerId: Id, days = OWN_SOON_DAYS): OwnSoon {
  const b = e.s.ownStock?.[customerId];
  const out: OwnSoon = { days, clients: [], provider: [] };
  if (!b) return out;
  const now = e.now(), until = now + days * DAY;
  const name = (pid: Id) => b.products.find((p) => p.id === pid)?.name ?? "";
  const acc = new Map(b.accounts.map((a) => [a.id, a]));
  const from = now - OWN_LATE_DAYS * DAY;
  out.clients = b.sales.filter((s) => s.expiresAt > from && s.expiresAt <= until)
    .sort((x, y) => x.expiresAt - y.expiresAt)
    .map((s) => ({ id: s.id, name: s.name, product: name(acc.get(s.accountId)?.productId ?? ""), expiresAt: s.expiresAt, trial: !!s.trial, ...(s.expiresAt <= now ? { late: true as const } : {}) }));
  const busy = new Set(b.sales.map((s) => s.accountId));
  out.provider = b.accounts.filter((a) => (a.down && busy.has(a.id)) || (a.providerExpiresAt && a.providerExpiresAt > from && a.providerExpiresAt <= until))
    .sort((x, y) => (x.providerExpiresAt ?? 0) - (y.providerExpiresAt ?? 0))
    .map((a) => ({ id: a.id, user: a.user, product: name(a.productId), expiresAt: a.providerExpiresAt ?? a.down!.at, ...(a.providerExpiresAt && a.providerExpiresAt <= now ? { late: true as const } : {}), ...(a.down ? { down: true as const } : {}) }));
  return out;
}

/** Lo mismo para el propio revendedor (su Inicio). */
export function mySoon(e: Engine, actor: Actor): OwnSoon {
  authorize(actor, "reseller.own_stock");
  if (!actor.customerId || e.s.customers[actor.customerId]?.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return ownSoonFor(e, actor.customerId);
}

const first = (n: string) => String(n ?? "").trim().split(/\s+/)[0] ?? "";

/** Título y texto del aviso al celular de lo de cuentas propias (o null si no hay nada). */
export function ownPushText(o: OwnSoon): { title: string; body: string } | null {
  const n = o.clients.length, m = o.provider.length;
  if (!n && !m) return null;
  const late = o.clients.filter((c) => c.late).length + o.provider.filter((a) => a.late || a.down).length;
  const title = late ? `📦 Cuentas propias: ${late} ya vencido(s)${n + m > late ? ` y ${n + m - late} por vencer` : ""}` : n && m ? `📦 Cuentas propias: ${n} cliente(s) y ${m} cuenta(s) por vencer`
    : n ? (n === 1 ? "📦 1 cliente de tus cuentas propias vence pronto" : `📦 ${n} clientes de tus cuentas propias vencen pronto`)
      : m === 1 ? "📦 1 cuenta tuya vence con tu proveedor" : `📦 ${m} cuentas tuyas vencen con tu proveedor`;
  const who = [
    n ? `${o.clients.slice(0, 3).map((c) => first(c.name)).join(", ")}${n > 3 ? "…" : ""}` : "",
    m ? `Proveedor: ${o.provider.slice(0, 2).map((a) => a.user).join(", ")}${m > 2 ? "…" : ""}` : "",
  ].filter(Boolean).join(" · ");
  return { title, body: `${who} · Mirá Mis cuentas propias`.slice(0, 180) };
}

/** Frase corta para sumar al aviso del día cuando ya hay otro (un solo aviso por día, sin repetir). */
export function ownPushSuffix(o: OwnSoon): string {
  const n = o.clients.length, m = o.provider.length;
  if (!n && !m) return "";
  const late = o.clients.filter((c) => c.late).length + o.provider.filter((a) => a.late || a.down).length;
  return ` · 📦 Cuentas propias: ${[n ? `${n} cliente(s)` : "", m ? `${m} con tu proveedor` : ""].filter(Boolean).join(" y ")}${late ? ` (${late} ya vencido(s))` : ""}`;
}

/** El texto de un aviso que ya existe, con lo de cuentas propias al final (sin cortarlo si es largo). */
export function withOwnSuffix(body: string, o: OwnSoon, max = 180): string {
  const sfx = ownPushSuffix(o);
  return sfx ? body.slice(0, max - sfx.length) + sfx : body.slice(0, max);
}
