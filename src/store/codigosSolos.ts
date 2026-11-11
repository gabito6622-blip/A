// "📩 Ver mi código de acceso": el cliente de un revendedor ve SOLO el código de su cuenta en su link de
// cobro (/c/<token>), sin pedírselo por WhatsApp al revendedor (y el revendedor a la tienda).
//
// Quién decide (las tres cosas tienen que estar prendidas):
//   1. El dueño: "Permitir que los clientes de mis revendedores vean sus códigos" (apagado por defecto).
//   2. El revendedor, por cuenta alquilada en Repartir perfiles: "Mis clientes ven su código solos".
//      Para "Mis cuentas propias", por cuenta, y solo si el correo de esa cuenta lo lee el lector de la
//      tienda (si no, la página dice "Pedile el código a tu vendedor").
//   3. El link de cobro sigue vivo (no revocado, perfil no borrado, alquiler activo y del mismo revendedor).
//
// Qué ve el cliente: el código (o el enlace de Netflix), el tipo, la hora y el nombre comercial del
// servicio. Nunca el correo, la contraseña, el asunto, el cuerpo del correo ni códigos de otra cuenta.
// Solo los que llegaron en los últimos 30 minutos (los mismos que muestra el lector) y después de que
// ese cliente entró al perfil (un cliente nuevo no ve los códigos del anterior).
//
// Cuenta compartida: todos los perfiles de una misma cuenta alquilada (Disney con 4 perfiles, etc.) ven
// los mismos códigos, porque la plataforma manda UN código al correo de la cuenta, no uno por perfil.
//
// Aislamiento: el token resuelve a UN perfil; el correo sale de la cuenta de ESE alquiler (o de ESA cuenta
// propia). Una cuenta propia cuyo correo es de una cuenta de la tienda, o que otro revendedor también tiene
// cargada, no se considera leída (no se le muestran códigos a nadie por ese camino).
// Auditoría: cada consulta deja ids (alquiler/perfil o revendedor/venta y los ids de los códigos), nunca
// el token, el correo ni el código.
import type { Actor, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { authorize } from "./auth.js";
import { MINUTE } from "./time.js";
import { classifyCode } from "./codes.js";
import { commercialName, LINK_GONE, subLinkTarget } from "./subLinks.js";
import { ownLinkTarget } from "./ownStock.js";
import { me as resellerOf, rental } from "./subRentals.js";

export interface SelfCodesState {
  /** El dueño lo permite (apagado por defecto). */
  allowed?: boolean;
  /** Alquiler (cuenta completa) → revendedor que prendió el interruptor. Si la cuenta pasa a otro, deja de valer. */
  rentals?: Record<Id, Id>;
  /** Revendedor → ids de SUS cuentas propias con el interruptor prendido. */
  own?: Record<Id, Id[]>;
  /** Cuenta propia → correo que el lector ya leyó para ella (si cambia el correo, hay que volver a leer). */
  verified?: Record<Id, string>;
  /** Contador por revendedor: códigos que sus clientes vieron solos este mes (sin repetir el mismo código al mismo cliente). */
  views?: Record<Id, { month: string; count: number; seen: string[] }>;
}

export type CodesMode = "self" | "ask" | "off";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
/** Como mucho estos códigos por consulta (los más nuevos). */
const MAX_CODES = 5;
/** Actor de la auditoría para las consultas públicas (no guarda el token ni la IP). */
const PUBLIC_ACTOR: Actor = { id: "system:cobro", role: "system" };
/** Mes de Bolivia (UTC-4): "2026-11". */
const monthOf = (t: number) => new Date(t - 4 * 3_600_000).toISOString().slice(0, 7);

/** Lo que hace falta de un link para decidir y buscar códigos. */
interface Target {
  /** Revendedor dueño del link. */
  resellerId: Id;
  /** Correo de la cuenta (minúsculas). */
  email: string;
  /** Desde cuándo ese cliente tiene el perfil o cupo (no ve códigos de antes). */
  since: number;
  /** Hasta cuándo lo tiene (vencido → que le pida el código a su vendedor). */
  expiresAt: number;
  /** Nombre comercial del servicio ("Disney+"), el "remitente genérico" que ve el cliente. */
  from: string;
  /** Interruptor del revendedor. */
  on: boolean;
  /** El correo es de esta cuenta y el lector de la tienda lo lee. */
  readable: boolean;
  /** Para la auditoría y el contador (solo ids). */
  audit: { entity: string; entityId: Id; data: Record<string, Id> };
  /** Clave del cliente para no contar dos veces el mismo código. */
  viewer: Id;
  /** Cuenta propia (para recordar que el lector ya leyó su correo). */
  ownAccountId?: Id;
}

const st = (e: Engine): SelfCodesState => e.s.selfCodes ?? {};

/** Cuántas cuentas de la tienda usan ese correo y si todas sus ventas activas son de este revendedor. */
function storeEmailOnlyOf(e: Engine, email: string, resellerId: Id): boolean {
  const accs = new Set(Object.values(e.s.accounts).filter((a) => a.email.toLowerCase() === email).map((a) => a.id));
  if (!accs.size) return false;
  return Object.values(e.s.assignments).every((a) => a.status !== "active" || !accs.has(e.s.slots[a.slotId]?.accountId ?? "") || a.customerId === resellerId);
}

/** El correo de una cuenta propia se puede usar: no es de la tienda, nadie más lo tiene y el lector lo leyó. */
function ownReadable(e: Engine, resellerId: Id, accountId: Id, user: string): boolean {
  const email = user.trim().toLowerCase();
  if (!EMAIL_RE.test(email)) return false;
  if (!Object.keys(e.s.mailboxes).length) return false;
  if (Object.values(e.s.accounts).some((a) => a.email.toLowerCase() === email)) return false;
  for (const [rid, b] of Object.entries(e.s.ownStock ?? {})) {
    if (b.accounts.some((a) => a.user.trim().toLowerCase() === email && (rid !== resellerId || a.id !== accountId))) return false;
  }
  // Prueba de que el lector lo lee: ya llegó un código a ese correo (se guardan 7 días) o ya se leyó antes.
  return st(e).verified?.[accountId] === email || e.s.codes.some((c) => c.to === email);
}

function target(e: Engine, token: unknown): Target | undefined {
  const own = ownLinkTarget(e, token);
  if (own) {
    const { c, s, a, p } = own;
    return {
      resellerId: c.id, email: a.user.trim().toLowerCase(), since: s.createdAt, expiresAt: s.expiresAt, from: p.name,
      on: !!st(e).own?.[c.id]?.includes(a.id), readable: ownReadable(e, c.id, a.id, a.user),
      audit: { entity: "customer", entityId: c.id, data: { sale: s.id, account: a.id } }, viewer: s.id, ownAccountId: a.id,
    };
  }
  const sub = subLinkTarget(e, token);
  if (!sub) return undefined;
  const { a, s } = sub;
  const acc = e.s.accounts[e.s.slots[a.slotId]?.accountId ?? ""];
  if (!acc) return undefined;
  const email = acc.email.toLowerCase();
  // Si a la cuenta la cambiaron (reemplazo) o se la pasaron, cuenta desde ese momento.
  const moved = a.history.filter((h) => h.event === "replaced" || h.event === "transferred").reduce((m, h) => Math.max(m, h.at), 0);
  return {
    resellerId: a.customerId, email, since: Math.max(a.startsAt, s.createdAt, moved), expiresAt: s.expiresAt,
    from: commercialName(e.s.products[a.productId]?.name ?? ""),
    on: st(e).rentals?.[a.id] === a.customerId, readable: storeEmailOnlyOf(e, email, a.customerId),
    audit: { entity: "assignment", entityId: a.id, data: { sub: s.id } }, viewer: s.id,
  };
}

function modeOf(e: Engine, t: Target): CodesMode {
  if (!st(e).allowed || !t.on) return "off";
  if (!t.readable || t.expiresAt < e.now()) return "ask";
  return "self";
}

/**
 * Para la lista cerrada de /api/cobro/<token> (subLinks.publicView): "self" muestra el botón,
 * "ask" muestra "Pedile el código a tu vendedor", "off" no muestra nada.
 */
export function codesMode(e: Engine, token: unknown): CodesMode {
  const t = target(e, token);
  return t ? modeOf(e, t) : "off";
}

/** GET /api/cobro/<token>/codes: los códigos recientes de la cuenta de ESE link. Cualquier problema → 404. */
export function publicCodes(e: Engine, token: unknown) {
  const t = target(e, token);
  if (!t) throw new DomainError("NOT_FOUND", LINK_GONE);
  if (modeOf(e, t) !== "self") throw new DomainError("NOT_FOUND", "Pedile el código a quien te vendió.");
  const now = e.now(), win = e.opts.codeVisibleMinutes * MINUTE;
  const found = e.s.codes
    .filter((c) => c.to === t.email && c.receivedAt >= t.since && now - c.receivedAt <= win)
    .sort((x, y) => y.receivedAt - x.receivedAt)
    .slice(0, MAX_CODES);
  e.tx(() => {
    const s = (e.s.selfCodes ??= {});
    // El lector leyó este correo: queda anotado aunque el código se borre a los 7 días.
    if (t.ownAccountId && found.length && s.verified?.[t.ownAccountId] !== t.email) (s.verified ??= {})[t.ownAccountId] = t.email;
    if (found.length) {
      const views = (s.views ??= {});
      const month = monthOf(now);
      const v = views[t.resellerId]?.month === month ? views[t.resellerId] : (views[t.resellerId] = { month, count: 0, seen: [] });
      for (const c of found) {
        const k = `${t.viewer}:${c.id}`;
        if (v.seen.includes(k)) continue;
        v.seen.push(k);
        v.count++;
      }
      if (v.seen.length > 500) v.seen.splice(0, v.seen.length - 500);
    }
    e.audit(PUBLIC_ACTOR, "codes.self_view", t.audit.entity, t.audit.entityId, { ...t.audit.data, reseller: t.resellerId, found: found.length, ids: found.map((c) => c.id) });
  });
  return {
    now,
    codes: found.map((c) => ({ code: c.code, ...(c.link ? { link: c.link } : {}), kind: c.kind ?? classifyCode(c.subject, ""), at: c.receivedAt, from: t.from })),
  };
}

/* ---------------- revendedor ---------------- */
function monthCount(e: Engine, resellerId: Id): number {
  const v = st(e).views?.[resellerId];
  return v && v.month === monthOf(e.now()) ? v.count : 0;
}

function myReseller(e: Engine, actor: Actor) {
  const c = resellerOf(e, actor);
  if (c.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return c;
}

/** Sus interruptores y el contador del mes. Sin correos de nadie más ni tokens. */
export function resellerView(e: Engine, actor: Actor) {
  const c = myReseller(e, actor);
  const s = st(e);
  const rentals = Object.values(e.s.assignments)
    .filter((a) => a.customerId === c.id && a.status === "active" && e.s.products[a.productId]?.kind === "full_account")
    .map((a) => ({ assignmentId: a.id, on: s.rentals?.[a.id] === c.id }));
  const mineOn = new Set(s.own?.[c.id] ?? []);
  const own = (e.s.ownStock?.[c.id]?.accounts ?? [])
    .filter((a) => EMAIL_RE.test(a.user.trim()))
    .map((a) => ({ accountId: a.id, on: mineOn.has(a.id), readable: ownReadable(e, c.id, a.id, a.user) }));
  return { allowed: !!s.allowed, month: monthCount(e, c.id), rentals, own };
}

/** Prende o apaga "Mis clientes ven su código solos" en una cuenta completa alquilada (solo la suya). */
export function setRental(e: Engine, actor: Actor, assignmentId: Id, on: boolean) {
  const c = myReseller(e, actor);
  return e.tx(() => {
    const a = rental(e, c.id, assignmentId);
    const s = (e.s.selfCodes ??= {});
    if (on) (s.rentals ??= {})[a.id] = c.id;
    else if (s.rentals) delete s.rentals[a.id];
    e.audit(actor, "reseller.self_codes", "assignment", a.id, { on });
    return { on };
  });
}

/** Lo mismo para una cuenta propia (solo si es suya y su usuario es un correo). */
export function setOwn(e: Engine, actor: Actor, accountId: Id, on: boolean) {
  authorize(actor, "reseller.own_stock");
  const c = myReseller(e, actor);
  return e.tx(() => {
    const a = e.s.ownStock?.[c.id]?.accounts.find((x) => x.id === accountId);
    if (!a) throw new DomainError("NOT_FOUND", "Esa cuenta no existe");
    if (on && !EMAIL_RE.test(a.user.trim())) throw new DomainError("VALIDATION", "Solo sirve para cuentas con correo (usuario@…)");
    const s = (e.s.selfCodes ??= {});
    const list = new Set((s.own ??= {})[c.id] ?? []);
    if (on) list.add(a.id); else list.delete(a.id);
    if (list.size) s.own[c.id] = [...list]; else delete s.own[c.id];
    e.audit(actor, "own.self_codes", "customer", c.id, { account: a.id, on });
    return { on, readable: ownReadable(e, c.id, a.id, a.user) };
  });
}

/* ---------------- dueño ---------------- */
/** Ajuste global y cuántos códigos vieron solos este mes los clientes de todos sus revendedores. */
export function ownerView(e: Engine, actor: Actor) {
  authorize(actor, "codes.configure");
  const s = st(e), month = monthOf(e.now());
  const views = Object.values(s.views ?? {}).filter((v) => v.month === month);
  const resellers = new Set([...Object.values(s.rentals ?? {}), ...Object.keys(s.own ?? {})]);
  return { allowed: !!s.allowed, month: views.reduce((t, v) => t + v.count, 0), resellers: resellers.size };
}

export function setAllowed(e: Engine, actor: Actor, on: boolean) {
  authorize(actor, "codes.configure");
  return e.tx(() => {
    (e.s.selfCodes ??= {}).allowed = on;
    e.audit(actor, "settings.self_codes", "settings", "self_codes", { on });
    return { allowed: on };
  });
}
