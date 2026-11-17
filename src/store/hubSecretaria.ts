// 🤵 «Mi secretaria» y 📈 «Cómo van» del revendedor (17/11/2026): lo mismo que el dueño tiene en su panel, con SUS datos.
//
// Mi secretaria NO calcula nada nuevo: junta lo que ya dicen «Mi día» (resellerDay.ts: cobrar y avisar de sus clientes
// registrados y perfiles repartidos), el día de sus cuentas propias (ownPlata.ts) y lo que renovó en los últimos 2 días,
// y arma UN mensaje por cliente con su plantilla ({nombre}, {servicio}, {fecha}, {monto}, {link}). Nunca se manda nada
// solo: el panel abre wa.me con el texto y el revendedor lo manda a mano.
//
// Cómo van: su mes (del día 1 a hoy) contra el mes pasado completo: cuánto le pagaron (perfiles + clientes registrados
// + cuentas propias, con las mismas fórmulas que «Mis ganancias»), clientes nuevos, los que renovaron y los que se fueron.
// Sin % si la base es menor a Bs 30 (como el «Cómo van» del dueño, V6).
//
// Solo lee lo del revendedor que pregunta (actor.customerId). Las plantillas se guardan por revendedor.
import type { Actor, Cents, Customer, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { DAY, boDayStart, boMonthKey, boMonthStart } from "./time.js";
import { currencyOf, money } from "./country.js";
import { myDay } from "./resellerDay.js";
import { personKey } from "./deudas.js";
import { day as ownDay } from "./ownPlata.js";
import { peek } from "./ownStock.js";
import { monthNumbers } from "./gananciaReal.js";

export type SecKind = "avisar" | "cobrar" | "renovo";
export const SEC_KINDS: SecKind[] = ["avisar", "cobrar", "renovo"];
/** Lo que se puede poner en una plantilla. */
export const SEC_FIELDS = ["{nombre}", "{servicio}", "{fecha}", "{monto}", "{link}"];
export const SEC_MAX = 700;
/** «Ya renovó»: los cobros y renovaciones de hoy y de ayer. */
export const RENEWED_DAYS = 2;
/** «Se fueron»: se les venció todo hace más de estos días y no renovaron. */
export const GONE_GRACE_DAYS = 3;
/** Sin % si la base es menor a esto (Bs 30, como el «Cómo van» del dueño). */
export const PCT_MIN: Cents = 3000;

/** Plantillas de fábrica. Una línea con {link} o {monto} vacío no se manda (si no tiene link o precio). */
export const SEC_DEFAULTS: Record<SecKind, string> = {
  avisar: "Hola {nombre} 👋 tu {servicio} vence el {fecha}.\nLa renovación es {monto}. ¿Lo renovamos? 🙌\nPagás acá 👉 {link}",
  cobrar: "Hola {nombre} 👋 tu {servicio} venció el {fecha}.\nPara seguir son {monto}. ¿Lo renovamos hoy? 🙌\nPagás acá 👉 {link}",
  renovo: "Hola {nombre} 👋 ¡listo! Tu {servicio} quedó renovado hasta el {fecha}. ¡Gracias por confiar! 🙌",
};

function reseller(e: Engine, actor: Actor): Customer {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const c = e.s.customers[actor.customerId];
  if (!c) throw new DomainError("NOT_FOUND", "Revendedor inexistente");
  return c;
}

const dm = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit" }).format(new Date(t));
const first = (n: string) => String(n ?? "").trim().split(/\s+/)[0] ?? "";
const joinY = (l: string[]) => (l.length <= 1 ? l.join("") : `${l.slice(0, -1).join(", ")} y ${l.at(-1)}`);

/** Llena una plantilla. Si falta el link o el monto, se saca la línea entera donde iban (no queda «Pagás acá 👉 »). */
export function fillTemplate(tpl: string, v: { nombre: string; servicio: string; fecha: string; monto: string; link: string }): string {
  const lines = tpl.split("\n").filter((l) => !(l.includes("{link}") && !v.link) && !(l.includes("{monto}") && !v.monto));
  return lines.join("\n")
    .replace(/\{nombre\}/g, v.nombre).replace(/\{servicio\}/g, v.servicio).replace(/\{fecha\}/g, v.fecha)
    .replace(/\{monto\}/g, v.monto).replace(/\{link\}/g, v.link).trim();
}

interface Piece { key: string; name: string; phone: string; product: string; label?: string; at: number; amount: Cents | null; link?: string; source: "tienda" | "perfil" | "propia" }
export interface SecMessage { kind: SecKind; key: string; name: string; phone: string; services: string[]; date: number; amount: Cents | null; link: string | null; count: number; sources: string[]; text: string }

function templates(e: Engine, id: Id): Record<SecKind, string> {
  const own = e.s.hubSecretaria?.[id] ?? {};
  return { avisar: own.avisar || SEC_DEFAULTS.avisar, cobrar: own.cobrar || SEC_DEFAULTS.cobrar, renovo: own.renovo || SEC_DEFAULTS.renovo };
}

/** Lo que renovó (o le pagaron) hoy y ayer: perfiles («Me pagó»), clientes registrados (renovación) y cuentas propias. */
function renewed(e: Engine, me: Customer, now: number): Piece[] {
  const from = boDayStart(now) - (RENEWED_DAYS - 1) * DAY;
  const out: Piece[] = [];
  for (const c of e.s.rcobros ?? []) {
    if (c.resellerId !== me.id || c.at < from) continue;
    const a = e.s.assignments[c.assignmentId], s = a?.customerId === me.id ? a.subs?.find((x) => x.id === c.subId) : undefined;
    if (!s) continue;
    out.push({ key: personKey(s.name, s.phone), name: s.name, phone: s.phone, product: c.product, label: s.label, at: s.expiresAt, amount: c.amount, source: "perfil" });
  }
  for (const o of Object.values(e.s.orders)) {
    if (o.payerId !== me.id || o.customerId === me.id || o.kind !== "renewal" || o.status !== "fulfilled" || o.updatedAt < from) continue;
    const cu = e.s.customers[o.customerId];
    if (!cu || cu.resellerId !== me.id) continue;
    for (const id of o.assignmentIds) {
      const a = e.s.assignments[id];
      if (!a || a.customerId !== cu.id) continue;
      out.push({ key: personKey(cu.name, cu.phone ?? ""), name: cu.name, phone: cu.phone ?? "", product: e.s.products[a.productId]?.name ?? "", at: a.customerExpiresAt, amount: a.rcontrol?.price ?? null, source: "tienda" });
    }
  }
  const b = peek(e, me.id);
  const prod = (accId: Id) => b.products.find((p) => p.id === b.accounts.find((x) => x.id === accId)?.productId)?.name ?? "";
  for (const x of b.ledger ?? []) {
    if (x.kind !== "pago" || x.at < from) continue;
    const s = b.sales.find((y) => y.id === x.saleId);
    if (!s || s.trial) continue;
    out.push({ key: personKey(s.name, s.phone), name: s.name, phone: s.phone, product: prod(s.accountId), at: s.expiresAt, amount: x.amount, source: "propia" });
  }
  return out;
}

/** Junta los renglones de una misma persona en un mensaje. */
function build(kind: SecKind, pieces: Piece[], tpl: string, cur: ReturnType<typeof currencyOf>, origin: string): SecMessage[] {
  const by = new Map<string, Piece[]>();
  for (const p of pieces) (by.get(p.key) ?? by.set(p.key, []).get(p.key)!).push(p);
  const out: SecMessage[] = [];
  for (const [key, l] of by) {
    // Un mismo servicio que llega por dos caminos (ej.: dos pagos de hoy) se cuenta una vez, con su fecha más nueva.
    const uniq = new Map<string, Piece>();
    for (const p of l) { const k = `${p.source}|${p.product}|${p.label ?? ""}`; const o = uniq.get(k); if (!o) uniq.set(k, { ...p }); else { o.at = kind === "renovo" ? Math.max(o.at, p.at) : Math.min(o.at, p.at); if (kind === "renovo" && p.amount) o.amount = (o.amount ?? 0) + p.amount; } }
    const items = [...uniq.values()].sort((x, y) => x.at - y.at);
    const services = items.map((p) => `${p.product}${p.label ? ` (${p.label})` : ""}`);
    const priced = items.filter((p) => p.amount !== null && p.amount > 0);
    const amount = priced.length ? priced.reduce((t, p) => t + (p.amount ?? 0), 0) : null;
    const date = kind === "renovo" ? Math.max(...items.map((p) => p.at)) : Math.min(...items.map((p) => p.at));
    const linkTok = items.find((p) => p.link)?.link;
    const link = linkTok ? `${origin}/c/${linkTok}` : null;
    const text = fillTemplate(tpl, { nombre: first(items[0].name), servicio: joinY(services), fecha: dm(date), monto: amount !== null ? money(amount, cur) : "", link: link ?? "" });
    out.push({ kind, key, name: items[0].name, phone: items.find((p) => p.phone)?.phone ?? "", services, date, amount, link, count: items.length, sources: [...new Set(items.map((p) => p.source))], text });
  }
  return out.sort((x, y) => x.date - y.date || x.name.localeCompare(y.name, "es"));
}

/** Los mensajes listos de hoy. `origin` = la dirección del panel (para los links de cobro /c/<token>). */
export function mySecretary(e: Engine, actor: Actor, origin = "") {
  const me = reseller(e, actor);
  const now = e.now(), cur = currencyOf(e, me), T = templates(e, me.id);
  const d = myDay(e, actor);
  const avisar: Piece[] = [], cobrar: Piece[] = [];
  const src = (k: string): Piece["source"] => (k === "sub" ? "perfil" : "tienda");
  for (const g of d.cobrar) for (const it of g.items) cobrar.push({ key: personKey(it.client, it.phone), name: it.client, phone: it.phone, product: it.product, label: it.label, at: it.expiresAt, amount: it.price, link: it.linkToken, source: src(it.kind) });
  for (const g of d.avisar) for (const it of g.items) {
    // Cliente registrado ya vencido: es para cobrar/renovar, no «vence el…».
    (it.days <= 0 ? cobrar : avisar).push({ key: personKey(it.client, it.phone), name: it.client, phone: it.phone, product: it.product, label: it.label, at: it.expiresAt, amount: it.price, link: it.linkToken, source: src(it.kind) });
  }
  // Sus cuentas propias (el mismo «día» que ve en Mi día → Tus cuentas propias).
  const o = ownDay(e, actor);
  for (const x of [...o.cobrar, ...o.deben]) cobrar.push({ key: personKey(x.name, x.phone), name: x.name, phone: x.phone, product: x.product, at: x.expiresAt, amount: (x.debt || 0) + (x.days <= 0 && !x.trial && !x.gone ? x.price ?? 0 : 0) || null, link: "linkToken" in x ? x.linkToken : undefined, source: "propia" });
  for (const x of o.avisar) avisar.push({ key: personKey(x.name, x.phone), name: x.name, phone: x.phone, product: x.product, at: x.expiresAt, amount: x.price, link: x.linkToken, source: "propia" });
  const lists = { cobrar: build("cobrar", cobrar, T.cobrar, cur, origin), avisar: build("avisar", avisar, T.avisar, cur, origin), renovo: build("renovo", renewed(e, me, now), T.renovo, cur, origin) };
  const own = e.s.hubSecretaria?.[me.id] ?? {};
  return {
    at: now, currency: cur.symbol, store: me.name,
    counts: { cobrar: lists.cobrar.length, avisar: lists.avisar.length, renovo: lists.renovo.length },
    ...lists,
    templates: T, defaults: SEC_DEFAULTS, custom: SEC_KINDS.filter((k) => !!own[k]), fields: SEC_FIELDS,
  };
}

/** Guarda (o vuelve a la de fábrica, con texto vacío) la plantilla de un tipo de mensaje. Solo la suya. */
export function setSecretaryTemplate(e: Engine, actor: Actor, raw: { kind?: unknown; text?: unknown }) {
  const me = reseller(e, actor);
  const kind = String(raw.kind ?? "") as SecKind;
  if (!SEC_KINDS.includes(kind)) throw new DomainError("VALIDATION", "Tipo de mensaje inválido");
  const text = String(raw.text ?? "").replace(/\r\n?/g, "\n").trim();
  if (text.length > SEC_MAX) throw new DomainError("VALIDATION", `El mensaje es muy largo (máximo ${SEC_MAX} letras)`);
  const bad = text.match(/\{[^}]*\}/g)?.find((f) => !SEC_FIELDS.includes(f));
  if (bad) throw new DomainError("VALIDATION", `«${bad}» no se puede usar. Usá ${SEC_FIELDS.join(", ")}`);
  return e.tx(() => {
    const all = (e.s.hubSecretaria ??= {});
    const mine = (all[me.id] ??= {});
    if (!text || text === SEC_DEFAULTS[kind]) delete mine[kind]; else mine[kind] = text;
    if (!Object.keys(mine).length) delete all[me.id];
    e.audit(actor, "reseller.secretary_template", "customer", me.id, { kind, reset: !mine[kind] });
    return { ok: true as const, kind, text: mine[kind] ?? SEC_DEFAULTS[kind], custom: !!mine[kind] };
  });
}

/* ---------------- 📈 Cómo van ---------------- */
const pctOf = (cur: number, base: number) => (base >= PCT_MIN ? Math.round(((cur - base) / base) * 100) : null);

/** Lo que entró por sus cuentas propias entre `from` y `to` (pagos del libro + ventas viejas pagadas). */
function ownPaid(e: Engine, id: Id, from: number, to: number): Cents {
  const b = peek(e, id);
  const inR = (t: number) => t >= from && t < to;
  return (b.ledger ?? []).filter((x) => x.kind === "pago" && inR(x.at)).reduce((t, x) => t + x.amount, 0)
    + [...b.sales, ...(b.gone ?? [])].filter((s) => !s.led && !s.trial && s.pay === "pagado" && inR(s.createdAt)).reduce((t, s) => t + (s.price ?? 0), 0);
}

/** Cada persona (por nombre y WhatsApp): cuándo empezó, sus pagos y su último vencimiento. */
function people(e: Engine, me: Customer) {
  const P = new Map<string, { name: string; since: number; pays: number[]; lastExp: number; hasExp: boolean }>();
  const get = (name: string, phone: string) => { const k = personKey(name, phone); let p = P.get(k); if (!p) P.set(k, (p = { name, since: Infinity, pays: [], lastExp: -Infinity, hasExp: false })); return p; };
  const exp = (p: { lastExp: number; hasExp: boolean }, t: number) => { p.lastExp = Math.max(p.lastExp, t); p.hasExp = true; };
  // Clientes registrados (los de la tienda que les vende).
  for (const c of Object.values(e.s.customers)) if (c.resellerId === me.id) { const p = get(c.name, c.phone ?? ""); p.since = Math.min(p.since, c.createdAt); }
  for (const a of Object.values(e.s.assignments)) {
    const c = e.s.customers[a.customerId];
    if (c?.resellerId === me.id) { const p = get(c.name, c.phone ?? ""); p.since = Math.min(p.since, a.startsAt); exp(p, a.customerExpiresAt); }
    // Perfiles repartidos de sus cuentas completas.
    if (a.customerId === me.id) for (const s of a.subs ?? []) { const p = get(s.name, s.phone); p.since = Math.min(p.since, s.createdAt); exp(p, a.status === "active" ? s.expiresAt : Math.min(s.expiresAt, a.customerExpiresAt)); }
  }
  for (const o of Object.values(e.s.orders)) {
    if (o.payerId !== me.id || o.customerId === me.id || o.kind !== "renewal" || o.status !== "fulfilled") continue;
    const c = e.s.customers[o.customerId];
    if (c?.resellerId === me.id) get(c.name, c.phone ?? "").pays.push(o.updatedAt);
  }
  for (const c of e.s.rcobros ?? []) {
    if (c.resellerId !== me.id) continue;
    const s = e.s.assignments[c.assignmentId]?.subs?.find((x) => x.id === c.subId);
    get(s?.name ?? c.name, s?.phone ?? "").pays.push(c.at);
  }
  // Cuentas propias.
  const b = peek(e, me.id);
  const who = new Map<Id, { name: string; phone: string }>();
  for (const s of b.sales) { if (s.trial) continue; who.set(s.id, s); const p = get(s.name, s.phone); p.since = Math.min(p.since, s.since ?? s.createdAt); exp(p, s.expiresAt); }
  for (const g of b.gone ?? []) { if (g.trial) continue; who.set(g.id, g); const p = get(g.name, g.phone); p.since = Math.min(p.since, g.since ?? g.createdAt); exp(p, Math.min(g.expiresAt, g.releasedAt)); }
  for (const x of b.ledger ?? []) if (x.kind === "pago") { const w = who.get(x.saleId); if (w) get(w.name, w.phone).pays.push(x.at); }
  return [...P.values()].filter((p) => p.since !== Infinity || p.pays.length);
}

/** Su mes: este (del 1 a hoy) contra el mes pasado completo. Solo lo suyo. */
export function myComoVan(e: Engine, actor: Actor) {
  const me = reseller(e, actor);
  const now = e.now(), cur = currencyOf(e, me);
  const m0 = boMonthStart(now), p0 = boMonthStart(now, -1);
  const goneBefore = boDayStart(now) - GONE_GRACE_DAYS * DAY;
  const P = people(e, me);
  const month = (from: number, to: number) => {
    const key = boMonthKey(from);
    const tienda = monthNumbers(e, me, key);
    const propias = ownPaid(e, me.id, from, to);
    const isNew = (p: (typeof P)[number]) => p.since >= from && p.since < to;
    const nuevos = P.filter(isNew).length;
    const renovaron = P.filter((p) => !isNew(p) && p.since < to && p.pays.some((t) => t >= from && t < to)).length;
    const fueron = P.filter((p) => p.hasExp && p.lastExp >= from && p.lastExp < Math.min(to, goneBefore)).length;
    return { key, paid: tienda.cobros + propias, perfiles: tienda.cobrosPerfiles, clientes: tienda.cobrosClientes, propias, nuevos, renovaron, fueron };
  };
  const t = month(m0, now + 1), p = month(p0, m0);
  return {
    at: now, currency: cur.symbol, from: m0, prevFrom: p0,
    month: t, prev: p,
    change: { paid: t.paid - p.paid, paidPct: pctOf(t.paid, p.paid), nuevos: t.nuevos - p.nuevos, renovaron: t.renovaron - p.renovaron, fueron: t.fueron - p.fueron },
    activos: P.filter((x) => x.hasExp && x.lastExp >= now).length,
    pctMin: PCT_MIN, goneGraceDays: GONE_GRACE_DAYS,
  };
}
