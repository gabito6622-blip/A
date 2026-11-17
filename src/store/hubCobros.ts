// Herramientas de cobro del dueño, para el revendedor en GaboHub (17/11/2026).
// Se arman sobre lo que ya tenía (no se duplica): «Mi día» (resellerDay.ts) es su «📋 Cobrar hoy», «Quién me debe»
// (deudas.ts/fiado.ts) es la misma lista de deudas y los links /c/<token> son los de siempre (subLinks, clientLinks,
// ownStock). Lo nuevo:
//  - «↩️ Deshacer» para TODO «Me pagó» (antes solo los perfiles repartidos): se guarda cómo estaba lo que tocó
//    (perfil, libreta y Mi control de ESE cliente) y se vuelve atrás si nada cambió después. 30 minutos.
//  - «💵 Me pagó todo» de una persona (varias cuentas juntas) con un solo «Deshacer».
//  - «✍️ Anotar rápido»: pega «Lucía pagó 15» y ve qué se anota antes de confirmar.
//  - Link de cobro con comprobante: su cliente ve SUS datos de pago escritos (banco, a nombre de…) y SU QR, sube la
//    foto del comprobante y queda «En revisión» hasta que EL REVENDEDOR lo aprueba. No se cobra nada solo: aprobar es
//    lo mismo que tocar «Me pagó». La tienda (el dueño) no ve estos comprobantes y el revendedor no ve los de la tienda.
// Todo es del revendedor que entró: el servidor resuelve quién es por la sesión y cada cosa se busca dentro de lo suyo.
import type { Actor, Cents, Id, State } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { dayPay, myDay } from "./resellerDay.js";
import { undoCobro, dueNow } from "./cuadernoPlata.js";
import { subLinkTarget, commercialName } from "./subLinks.js";
import { clientLinkTarget } from "./clientLinks.js";
import { ownLinkTarget, book as ownBook, debts as ownDebts, renew as ownRenew } from "./ownStock.js";
import { pay as ownPay } from "./ownPlata.js";
import { localeOf } from "./country.js";
import { planGate } from "./resellerShop.js";

export const HUB_UNDO_MINUTES = 30;
/** Comprobantes guardados por revendedor (los más viejos ya decididos se van). */
const MAX_PROOFS = 300;
/** Por link: cuántos comprobantes por día como mucho (frena a quien suba fotos sin parar). */
const MAX_PROOFS_PER_LINK_DAY = 3;

export interface HubPayInfo { bank: string; holder: string; account: string; note: string; at: number }
export interface HubProof {
  id: Id; resellerId: Id;
  /** Qué cobra: perfil repartido (aid|sid), cliente registrado (aid) o venta de cuenta propia (saleId). */
  kind: "sub" | "client" | "own"; ref: string;
  name: string; product: string; amount: Cents | null; currency: string;
  fileRef: string; hash: string; at: number;
  status: "review" | "approved" | "rejected"; decidedAt?: number; reason?: string;
}
type UndoPart = { kind: "cobro"; cobroId: Id } | { kind: "snap"; customerId: Id; before: string; after: string };
export interface HubUndo { id: Id; resellerId: Id; at: number; label: string; parts: UndoPart[] }
export interface HubCobrosState { pay: Record<Id, HubPayInfo>; proofs: HubProof[]; undo: HubUndo[] }

const st = (e: Engine): HubCobrosState => {
  const s = e.s;
  s.hubCobros ??= { pay: {}, proofs: [], undo: [] };
  s.hubCobros.pay ??= {}; s.hubCobros.proofs ??= []; s.hubCobros.undo ??= [];
  return s.hubCobros;
};
function reseller(e: Engine, actor: Actor) {
  if (actor.role !== "reseller" || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return e.get("customers", actor.customerId);
}
const clean = (v: unknown, max: number, what: string) => {
  const t = String(v ?? "").replace(/[\u0000-\u001f\u007f<>]/g, " ").replace(/\s+/g, " ").trim();
  if (t.length > max) throw new DomainError("VALIDATION", `${what} va hasta ${max} letras`);
  return t;
};

/* ---------------- 🏦 Mis datos de pago (los que ve su cliente en el link) ---------------- */
export function myPayInfo(e: Engine, actor: Actor): HubPayInfo | null {
  const me = reseller(e, actor);
  return structuredClone(st(e).pay[me.id] ?? null);
}
export function setMyPayInfo(e: Engine, actor: Actor, raw: Record<string, unknown>) {
  const me = reseller(e, actor);
  const info = { bank: clean(raw.bank, 40, "El banco"), holder: clean(raw.holder, 60, "A nombre de"), account: clean(raw.account, 40, "El número de cuenta"), note: clean(raw.note, 160, "La nota") };
  return e.tx(() => {
    if (!info.bank && !info.holder && !info.account && !info.note) delete st(e).pay[me.id];
    else st(e).pay[me.id] = { ...info, at: e.now() };
    e.audit(actor, "hub.pay_info", "customer", me.id, { empty: !info.bank && !info.holder && !info.account && !info.note });
    return { ok: true as const, info: st(e).pay[me.id] ?? null };
  });
}

/* ---------------- ↩️ Deshacer cualquier «Me pagó» ---------------- */
/** Cómo está hoy lo que un «Me pagó» de un cliente registrado o de su libreta puede tocar: su libreta y su Mi control. */
function snap(e: Engine, resellerId: Id, customerId: Id): string {
  const f = (e.s.fiado ?? []).filter((x) => x.creditorId === resellerId && x.customerId === customerId);
  const c = Object.values(e.s.assignments).filter((a) => a.customerId === customerId).map((a) => [a.id, a.rcontrol ?? null] as const).sort((x, y) => x[0].localeCompare(y[0]));
  return JSON.stringify({ f, c });
}
function restore(e: Engine, resellerId: Id, customerId: Id, json: string) {
  const { f, c } = JSON.parse(json) as { f: NonNullable<State["fiado"]>; c: [Id, unknown][] };
  e.s.fiado = [...(e.s.fiado ?? []).filter((x) => !(x.creditorId === resellerId && x.customerId === customerId)), ...f];
  for (const [id, rc] of c) { const a = e.s.assignments[id]; if (!a) continue; if (rc) a.rcontrol = rc as typeof a.rcontrol; else delete a.rcontrol; }
}
/** Dueño del ítem de Mi día para el snapshot: cliente registrado o libreta. undefined = perfil repartido. */
function snapCustomer(e: Engine, id: Id): Id | undefined {
  if (id.startsWith("f|")) return id.slice(2);
  if (id.includes("|")) return undefined;
  return e.s.assignments[id]?.customerId;
}

/** Un «Me pagó» de Mi día (mismo dayPay de siempre) que además deja cómo deshacerlo. Dentro de una tx. */
function payOne(e: Engine, actor: Actor, id: Id, input: { amount?: unknown; price?: unknown; renew?: unknown; idempotencyKey?: unknown }) {
  const cid = snapCustomer(e, String(id));
  const before = cid ? snap(e, actor.customerId!, cid) : "";
  const r = dayPay(e, actor, String(id), input);
  const parts: UndoPart[] = [];
  if (r.kind === "sub" && r.cobroId) parts.push({ kind: "cobro", cobroId: r.cobroId });
  // Si además renovó con su saldo (un pedido real con la tienda), eso no se deshace desde acá.
  if (cid && r.renewed !== true) parts.push({ kind: "snap", customerId: cid, before, after: snap(e, actor.customerId!, cid) });
  return { r, parts };
}
function remember(e: Engine, actor: Actor, label: string, parts: UndoPart[]): Id | null {
  if (!parts.length) return null;
  const l = st(e).undo, now = e.now();
  const u: HubUndo = { id: e.id("hun"), resellerId: actor.customerId!, at: now, label, parts };
  // Solo se guardan los de la última media hora (los viejos ya no se pueden deshacer).
  st(e).undo = [...l.filter((x) => now - x.at <= HUB_UNDO_MINUTES * 60_000), u];
  return u.id;
}
const itemLabel = (e: Engine, actor: Actor, id: Id) => {
  const d = myDay(e, actor);
  const it = [...d.cobrar, ...d.avisar].flatMap((g) => g.items).find((x) => x.id === id);
  return it ? `${it.client} · ${it.product}${it.label ? ` (${it.label})` : ""}` : "Cobro";
};

/** «Me pagó» con «Deshacer» (Mi día, Anotar rápido y aprobar un comprobante usan esto). */
export function payWithUndo(e: Engine, actor: Actor, id: Id, input: { amount?: unknown; price?: unknown; renew?: unknown; idempotencyKey?: unknown } = {}) {
  reseller(e, actor);
  const key = input.idempotencyKey ? String(input.idempotencyKey).slice(0, 80) : undefined;
  const run = () => e.tx(() => {
    const label = itemLabel(e, actor, String(id));
    const { r, parts } = payOne(e, actor, String(id), input);
    return { ...r, undoId: remember(e, actor, label, parts) };
  });
  return key ? e.idempotent(`hubpay:${actor.customerId}:${id}:${key}`, run) : run();
}

/** «💵 Me pagó todo»: varias cuentas de una persona (o de un Anotar rápido) juntas, con UN solo «Deshacer». */
export function payMany(e: Engine, actor: Actor, raw: unknown, opts: { idempotencyKey?: unknown; label?: string } = {}) {
  reseller(e, actor);
  const list = (Array.isArray(raw) ? raw : []).map((x) => (typeof x === "string" ? { id: x } : { id: String((x as { id?: unknown })?.id ?? ""), amount: (x as { amount?: unknown })?.amount }));
  if (!list.length || list.length > 30) throw new DomainError("VALIDATION", "Elegí entre 1 y 30 cobros");
  if (new Set(list.map((x) => x.id)).size !== list.length) throw new DomainError("VALIDATION", "Hay un cobro repetido");
  const key = opts.idempotencyKey ? String(opts.idempotencyKey).slice(0, 80) : undefined;
  const run = () => e.tx(() => {
    const labels = list.map((x) => itemLabel(e, actor, x.id));
    const parts: UndoPart[] = [];
    let paid = 0;
    // Libretas: si dos ítems son del mismo cliente, el «antes» es el del primero y el «después» el del último.
    const snaps = new Map<Id, { before: string }>();
    for (const x of list) {
      const cid = snapCustomer(e, x.id);
      if (cid && !snaps.has(cid)) snaps.set(cid, { before: snap(e, actor.customerId!, cid) });
      const r = dayPay(e, actor, x.id, x.amount !== undefined && x.amount !== null && x.amount !== "" ? { amount: x.amount } : {});
      if (r.kind === "sub" && r.cobroId) parts.push({ kind: "cobro", cobroId: r.cobroId });
      paid += r.paid ?? 0;
    }
    for (const [cid, v] of snaps) parts.push({ kind: "snap", customerId: cid, before: v.before, after: snap(e, actor.customerId!, cid) });
    const who = [...new Set(labels.map((l) => l.split(" · ")[0]))];
    const label = opts.label ?? `${who.join(", ")}: ${list.length} cobro${list.length === 1 ? "" : "s"}`;
    e.audit(actor, "hub.pay_many", "customer", actor.customerId!, { n: list.length, paid });
    return { ok: true as const, count: list.length, paid, undoId: remember(e, actor, label, parts) };
  });
  return key ? e.idempotent(`hubmany:${actor.customerId}:${key}`, run) : run();
}

/** Lo que todavía se puede deshacer (lo más nuevo primero). */
export function undoList(e: Engine, actor: Actor) {
  const me = reseller(e, actor), now = e.now();
  return st(e).undo.filter((u) => u.resellerId === me.id && now - u.at <= HUB_UNDO_MINUTES * 60_000)
    .map((u) => ({ id: u.id, label: u.label, minutesLeft: Math.max(1, Math.ceil((u.at + HUB_UNDO_MINUTES * 60_000 - now) / 60_000)) })).reverse();
}

/** «↩️ Deshacer»: todo vuelve a como estaba, o nada (si algo cambió después, se avisa y no se toca). */
export function undo(e: Engine, actor: Actor, undoId: Id) {
  const me = reseller(e, actor);
  return e.tx(() => {
    const l = st(e).undo, i = l.findIndex((u) => u.id === undoId && u.resellerId === me.id);
    if (i === -1) throw new DomainError("NOT_FOUND", "Ese cobro ya no se puede deshacer");
    const u = l[i];
    if (e.now() - u.at > HUB_UNDO_MINUTES * 60_000) throw new DomainError("VALIDATION", "Pasaron más de 30 minutos: corregilo a mano en Quién me debe");
    for (const p of u.parts) if (p.kind === "snap" && snap(e, me.id, p.customerId) !== p.after) throw new DomainError("VALIDATION", "Ese cliente cambió después del cobro: corregilo a mano en Quién me debe");
    for (const p of [...u.parts].reverse()) {
      if (p.kind === "cobro") undoCobro(e, actor, p.cobroId);
      else restore(e, me.id, p.customerId, p.before);
    }
    l.splice(i, 1);
    e.audit(actor, "hub.undo", "customer", me.id, { parts: u.parts.length });
    return { ok: true as const, label: u.label };
  });
}

/* ---------------- ✍️ Anotar rápido ---------------- */
const fold = (s: string) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const SKIP = new Set(["pago", "pagaron", "pagado", "me", "te", "le", "bs", "gs", "usd", "de", "del", "la", "el", "los", "las", "y", "por", "con", "todo", "todos", "mes", "meses", "ya", "hoy"]);
export interface QuickLine { line: string; id?: Id; client?: string; product?: string; label?: string; owed?: Cents; amount?: Cents | null; error?: string }

/** Lee lo que pegó (una línea por pago: «Lucía pagó 15», «Mario Disney 30») y dice qué se anotaría. No guarda nada. */
export function quickParse(e: Engine, actor: Actor, text: unknown): { lines: QuickLine[]; ok: number } {
  const me = reseller(e, actor);
  const raw = String(text ?? "");
  if (raw.length > 2000) throw new DomainError("VALIDATION", "Es mucho texto: pegá hasta 2000 letras");
  const lines = raw.split(/\n|;/).map((x) => x.trim()).filter(Boolean).slice(0, 20);
  if (!lines.length) throw new DomainError("VALIDATION", "Escribí quién te pagó y cuánto. Ej.: «Lucía pagó 15»");
  const d = myDay(e, actor);
  const seen = new Set<Id>();
  const all = [...d.cobrar, ...d.avisar].flatMap((g) => g.items).filter((it) => (seen.has(it.id) ? false : (seen.add(it.id), true)));
  const decimals = localeOf(e, me).symbol === "₲" ? 0 : 2;
  const used = new Set<Id>();
  const out = lines.map((line): QuickLine => {
    const nums = [...line.matchAll(/(\d+(?:[.,]\d{1,2})?)/g)].map((m) => Number(m[1].replace(",", ".")));
    const amount = nums.length ? Math.round(nums[nums.length - 1] * (decimals ? 100 : 1)) : null;
    const words = fold(line).replace(/[^a-z0-9ñ ]+/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !SKIP.has(w) && !/^\d/.test(w) && !/^pag/.test(w));
    if (!words.length) return { line, error: "No encontré un nombre en esta línea" };
    const score = (it: (typeof all)[number]) => {
      const name = fold(it.client).split(/\s+/), extra = fold(`${it.label ?? ""} ${it.product}`).split(/\s+/);
      let n = 0, byName = 0;
      for (const w of words) { if (name.some((x) => x.startsWith(w))) { n += 2; byName++; } else if (extra.some((x) => x.startsWith(w))) n += 1; }
      return byName ? n : 0;
    };
    const ranked = all.filter((it) => !used.has(it.id)).map((it) => ({ it, n: score(it) })).filter((x) => x.n > 0).sort((x, y) => y.n - x.n);
    if (!ranked.length) return { line, error: "No encontré a nadie con ese nombre en lo que hay para cobrar" };
    if (ranked.length > 1 && ranked[1].n === ranked[0].n) return { line, error: `Hay más de uno: ${ranked.filter((x) => x.n === ranked[0].n).slice(0, 3).map((x) => `${x.it.client} (${x.it.product}${x.it.label ? ` · ${x.it.label}` : ""})`).join(", ")}. Sumá la app o el perfil.` };
    const it = ranked[0].it;
    used.add(it.id);
    const owed = it.owed ?? it.price ?? 0;
    if (amount !== null && amount <= 0) return { line, error: "El monto tiene que ser más que 0" };
    return { line, id: it.id, client: it.client, product: it.product, ...(it.label ? { label: it.label } : {}), owed, amount };
  });
  return { lines: out, ok: out.filter((x) => x.id).length };
}

/** Anota lo que se vio en la vista previa (se vuelve a leer en el servidor: nunca confía en lo que mande el navegador). */
export function quickApply(e: Engine, actor: Actor, text: unknown, opts: { idempotencyKey?: unknown } = {}) {
  reseller(e, actor);
  const key = opts.idempotencyKey ? String(opts.idempotencyKey).slice(0, 80) : undefined;
  return key ? e.idempotent(`hubquick:${actor.customerId}:${key}`, () => quickRun(e, actor, text)) : quickRun(e, actor, text);
}
function quickRun(e: Engine, actor: Actor, text: unknown) {
  const p = quickParse(e, actor, text);
  const ok = p.lines.filter((x) => x.id);
  if (!ok.length) throw new DomainError("VALIDATION", "No hay nada para anotar: revisá los nombres");
  const r = payMany(e, actor, ok.map((x) => ({ id: x.id!, ...(x.amount !== null && x.amount !== undefined ? { amount: x.amount } : {}) })), { label: `Anotar rápido: ${ok.map((x) => x.client).join(", ")}` });
  return { ...r, skipped: p.lines.filter((x) => !x.id) };
}

/* ---------------- 🔗 Link de cobro con comprobante ---------------- */
type Target = { resellerId: Id; kind: HubProof["kind"]; ref: string; name: string; product: string; amount: Cents | null };
/** De quién y de qué es un link /c/<token> (los tres tipos de siempre), o undefined si no sirve. */
function targetOf(e: Engine, token: unknown): Target | undefined {
  const sub = subLinkTarget(e, token);
  if (sub) return { resellerId: sub.a.customerId, kind: "sub", ref: `${sub.a.id}|${sub.s.id}`, name: sub.s.name, product: commercialName(e.s.products[sub.a.productId]?.name ?? ""), amount: dueNow(e, sub.a, sub.s) || sub.s.price || null };
  const cl = clientLinkTarget(e, token);
  if (cl) return { resellerId: cl.me.id, kind: "client", ref: cl.a.id, name: cl.c.name, product: commercialName(e.s.products[cl.a.productId]?.name ?? ""), amount: cl.a.rcontrol?.price ?? null };
  const own = ownLinkTarget(e, token);
  if (own) { const debt = ownDebts(ownBook(e, own.c.id)).get(own.s.id) ?? 0; return { resellerId: own.c.id, kind: "own", ref: own.s.id, name: own.s.name, product: own.p.name, amount: debt || own.s.price || null }; }
  return undefined;
}
/** Subir comprobante desde el link: solo si su plan incluye los links de cobro (el mismo freno que crear links). */
const proofsOn = (e: Engine, resellerId: Id) => !planGate(e, resellerId, "links");

/** Lo que suma la página del link: sus datos de pago escritos y si ya mandó un comprobante. Lista cerrada de campos. */
export function publicPay(e: Engine, token: unknown) {
  const t = targetOf(e, token);
  if (!t) throw new DomainError("NOT_FOUND", "Este link ya no sirve. Pedile uno nuevo a quien te vendió.");
  const info = st(e).pay[t.resellerId];
  const last = st(e).proofs.filter((p) => p.resellerId === t.resellerId && p.kind === t.kind && p.ref === t.ref && e.now() - p.at < 7 * 864e5).at(-1);
  return {
    payInfo: info ? { bank: info.bank, holder: info.holder, account: info.account, note: info.note } : null,
    upload: proofsOn(e, t.resellerId),
    proof: last ? { status: last.status, at: last.at, ...(last.status === "rejected" && last.reason ? { reason: last.reason } : {}) } : null,
  };
}

/** El cliente sube su comprobante: queda «En revisión» para el revendedor. Nada se aprueba ni se cobra solo. */
export function submitProof(e: Engine, token: unknown, input: { fileRef: string; hash: string }) {
  const t = targetOf(e, token);
  if (!t) throw new DomainError("NOT_FOUND", "Este link ya no sirve. Pedile uno nuevo a quien te vendió.");
  if (!proofsOn(e, t.resellerId)) throw new DomainError("INVALID_STATE", "Por ahora mandale el comprobante por WhatsApp a quien te vendió");
  return e.tx(() => {
    const S = st(e), now = e.now();
    const mineL = S.proofs.filter((p) => p.resellerId === t.resellerId && p.kind === t.kind && p.ref === t.ref);
    if (mineL.some((p) => p.status === "review")) throw new DomainError("INVALID_STATE", "Ya mandaste un comprobante: está en revisión. Te avisan apenas lo miren.");
    if (mineL.filter((p) => now - p.at < 864e5).length >= MAX_PROOFS_PER_LINK_DAY) throw new DomainError("VALIDATION", "Ya mandaste varios comprobantes hoy. Escribile por WhatsApp a quien te vendió.");
    if (S.proofs.some((p) => p.resellerId === t.resellerId && p.hash === input.hash && p.status !== "rejected")) throw new DomainError("DUPLICATE_EVIDENCE", "Ese comprobante ya se mandó antes. Si pagaste de nuevo, subí el comprobante nuevo.");
    const c = e.s.customers[t.resellerId];
    const p: HubProof = { id: e.id("hpr"), resellerId: t.resellerId, kind: t.kind, ref: t.ref, name: t.name, product: t.product, amount: t.amount, currency: localeOf(e, c).symbol, fileRef: input.fileRef, hash: input.hash, at: now, status: "review" };
    S.proofs.push(p);
    // Tope por revendedor: se van los más viejos ya decididos (sus archivos los borra la ruta).
    const dropped: string[] = [];
    const own = S.proofs.filter((x) => x.resellerId === t.resellerId);
    if (own.length > MAX_PROOFS) for (const x of own.filter((x) => x.status !== "review").slice(0, own.length - MAX_PROOFS)) { S.proofs.splice(S.proofs.indexOf(x), 1); dropped.push(x.fileRef); }
    e.audit({ id: "link", role: "customer" }, "hub.proof_sent", "customer", t.resellerId, { proof: p.id, kind: t.kind });
    return { id: p.id, status: p.status, dropped };
  });
}

/** Sus comprobantes: primero los que esperan, después los últimos 30 días. Sin archivos ni hashes. */
export function myProofs(e: Engine, actor: Actor) {
  const me = reseller(e, actor), now = e.now();
  const l = st(e).proofs.filter((p) => p.resellerId === me.id && (p.status === "review" || now - (p.decidedAt ?? p.at) < 30 * 864e5));
  const view = (p: HubProof) => ({ id: p.id, kind: p.kind, name: p.name, product: p.product, amount: p.amount, currency: p.currency, at: p.at, status: p.status, ...(p.decidedAt ? { decidedAt: p.decidedAt } : {}), ...(p.reason ? { reason: p.reason } : {}) });
  return { review: l.filter((p) => p.status === "review").map(view), done: l.filter((p) => p.status !== "review").reverse().slice(0, 20).map(view) };
}
/** Archivo del comprobante: solo para el revendedor dueño. */
export function proofFile(e: Engine, actor: Actor, id: Id): string {
  const me = reseller(e, actor);
  const p = st(e).proofs.find((x) => x.id === id && x.resellerId === me.id);
  if (!p) throw new DomainError("NOT_FOUND", "Ese comprobante no existe");
  return p.fileRef;
}
function ownProof(e: Engine, actor: Actor, id: Id) {
  const me = reseller(e, actor);
  const p = st(e).proofs.find((x) => x.id === id && x.resellerId === me.id);
  if (!p) throw new DomainError("NOT_FOUND", "Ese comprobante no existe");
  if (p.status !== "review") throw new DomainError("INVALID_STATE", p.status === "approved" ? "Ya lo aprobaste" : "Ya lo rechazaste");
  return p;
}

/** «✅ Aprobar»: es lo mismo que tocar «Me pagó» (con «Deshacer»). `amount` = cuánto llegó de verdad (si no, lo que debía). */
export function approveProof(e: Engine, actor: Actor, id: Id, input: { amount?: unknown } = {}) {
  const has = input.amount !== undefined && input.amount !== null && input.amount !== "";
  return e.tx(() => {
    const p = ownProof(e, actor, id);
    let out: { paid: Cents; to?: number; undoId: Id | null };
    if (p.kind === "own") {
      const b = ownBook(e, p.resellerId);
      const debt = ownDebts(b).get(p.ref) ?? 0;
      if (debt > 0) { const r = ownPay(e, actor, p.ref, has ? { amount: input.amount, note: "Comprobante del link" } : { note: "Comprobante del link" }); out = { paid: r.paid, undoId: null }; }
      else { const r = ownRenew(e, actor, p.ref, { paid: true, ...(has ? { amount: input.amount } : {}) }) as { expiresAt?: number }; out = { paid: has ? Number(input.amount) : p.amount ?? 0, to: r?.expiresAt, undoId: null }; }
    } else {
      const r = payWithUndo(e, actor, p.ref, has ? { amount: input.amount } : {});
      out = { paid: r.paid ?? 0, to: r.to, undoId: r.undoId };
    }
    p.status = "approved"; p.decidedAt = e.now();
    e.audit(actor, "hub.proof_ok", "customer", p.resellerId, { proof: p.id, paid: out.paid });
    return { ok: true as const, ...out };
  });
}
/** «✕ Rechazar»: el cliente lo ve en su link con el motivo y puede subir otro. No toca nada de plata. */
export function rejectProof(e: Engine, actor: Actor, id: Id, reason: unknown) {
  const why = clean(reason, 120, "El motivo");
  return e.tx(() => {
    const p = ownProof(e, actor, id);
    p.status = "rejected"; p.decidedAt = e.now(); if (why) p.reason = why;
    e.audit(actor, "hub.proof_no", "customer", p.resellerId, { proof: p.id });
    return { ok: true as const };
  });
}

/** Lo chico para el Inicio: cuántos comprobantes esperan y si cargó sus datos de pago. */
export function summary(e: Engine, actor: Actor) {
  const me = reseller(e, actor);
  return { review: st(e).proofs.filter((p) => p.resellerId === me.id && p.status === "review").length, payInfo: !!st(e).pay[me.id], undo: undoList(e, actor) };
}
