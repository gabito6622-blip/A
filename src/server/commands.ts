// 🗣️ "Decile qué hacer": el dueño (o un admin) le da órdenes con sus palabras a Sofi, su secretaria.
//
// Reparto del trabajo:
// - Claude SOLO entiende la intención (agents.parseCommand): recibe el texto del dueño (con correos y
//   números largos tapados), las últimas 6 líneas de la charla (también tapadas) y los nombres de los
//   productos. Nunca ve contraseñas, códigos, correos completos ni costos, y nunca ejecuta nada.
// - El servidor valida, busca las cosas reales (tolerante a tildes, mayúsculas y faltas leves) y arma
//   la respuesta con plantillas propias.
// - Lo que cambia algo (vender, renovar, pasar a otro cliente) queda como PLAN pendiente: id al azar,
//   vence en 10 minutos, se usa una sola vez y es de quien lo pidió. Al confirmar se ejecuta con las
//   MISMAS funciones del núcleo que usa el panel, con el actor que confirma (sus permisos), y se audita
//   `assistant.command` (solo ids).
// - Nunca manda nada solo: después ofrece el botón de WhatsApp (wa.me) con el mensaje de entrega.
import { randomBytes } from "node:crypto";
import type { Actor, GabrielStore } from "../store/index.js";
import { DomainError } from "../store/index.js";
import { authorize, can } from "../store/auth.js";
import { AiError, type Agents, type ParsedCommand } from "./agents.js";
import { RateLimiter } from "./security.js";
import { firstName } from "./office.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { actor?: Actor; params: Record<string, string>; body: any };
type Route = (method: string, path: string, who: Who, handler: (c: Ctx) => unknown) => void;

export interface CommandDeps {
  route: Route;
  store: GabrielStore;
  agents: Agents;
  now: () => number;
  /** Anota en "Mi oficina" lo que hizo la secretaria. */
  note: (text: string, tone?: "ok" | "warn" | "bad" | "info") => void;
  /** Corta la petición con un error HTTP (403, 404, 409, 429…). */
  fail: (status: number, code: string, message: string) => never;
}

type Pay = "qr" | "efectivo" | "saldo" | "fiado";
const PAYS: Pay[] = ["qr", "efectivo", "saldo", "fiado"];
const PAY_TEXT: Record<Pay, string> = { qr: "📱 QR (ya te pagó)", efectivo: "💵 Efectivo (ya te pagó)", saldo: "👛 De su saldo", fiado: "📒 Fiado (te queda debiendo)" };

/** Lo que se sabe de la orden mientras se completa (texto del dueño o ids ya elegidos). */
interface St {
  intent: ParsedCommand["intent"];
  customer?: string; customerId?: string;
  product?: string; productId?: string;
  account?: string; accountId?: string;
  assignmentId?: string;
  toCustomer?: string; toCustomerId?: string;
  qty: number; months?: number; days?: number; pay?: Pay;
}
type Need = "customerId" | "toCustomerId" | "productId" | "assignmentId" | "pay";
interface Choice { label: string; value: string }
export interface CommandReply {
  kind: "answer" | "choose" | "plan" | "help";
  text: string;
  lines?: string[];
  choices?: Choice[];
  draft?: string;
  plan?: { id: string; lines: string[]; expiresAt: number; confirm: string };
  account?: { accountId: string; slotId?: string; assignmentId?: string };
  suggestions?: string[];
}
type Exec =
  | { type: "sell"; customerId: string; productId: string; qty: number; months: number; pay: Pay; preferredSlotIds: string[] }
  | { type: "renew"; assignmentId: string; periods: number; pay: Pay }
  | { type: "transfer"; assignmentId: string; toCustomerId: string };
interface Plan { id: string; userId: string; createdAt: number; expiresAt: number; used: boolean; exec: Exec; done: string; officeText: string }
interface Draft { id: string; userId: string; expiresAt: number; st: St; need: Need; values: string[] }

/** Una pregunta al dueño: corta la resolución y vuelve con botones (o sin ellos). */
class Ask {
  constructor(public text: string, public need?: Need, public choices: Choice[] = [], public lines: string[] = []) {}
}

const TTL = 10 * 60_000, DAY = 86_400_000;
const EXAMPLES = [
  "Vendele un Disney a Ana, me pagó por QR",
  "Dame el código de la Netflix de Rodrigo",
  "Renová a Juan 1 mes, efectivo",
  "¿Qué perfil de Disney tengo libre?",
  "¿Quién me debe?",
  "¿Quién vence mañana?",
  "Pasale el Netflix de Rodrigo a Juan",
  "Datos de la cuenta de Max de Ana",
];

/* ---------------- búsqueda tolerante ---------------- */
/** Sin tildes, en minúsculas y solo letras y números. */
export const norm = (s: string) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const STOP = new Set(["de", "del", "la", "el", "los", "las", "a", "al", "y", "mi", "su", "cuenta", "perfil", "señor", "senor", "senora", "don", "dona"]);
const tokens = (s: string) => norm(s).split(" ").filter((t) => t && !STOP.has(t));
/** Distancia de edición con transposición ("rodirgo" → "rodrigo" es una sola falta). */
function lev(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dd: number[][] = Array.from({ length: m + 1 }, (_, i) => Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)));
  for (let i = 1; i <= m; i++) for (let j = 1; j <= n; j++) {
    const cost = a[i - 1] === b[j - 1] ? 0 : 1;
    dd[i][j] = Math.min(dd[i - 1][j] + 1, dd[i][j - 1] + 1, dd[i - 1][j - 1] + cost);
    if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) dd[i][j] = Math.min(dd[i][j], dd[i - 2][j - 2] + 1);
  }
  return dd[m][n];
}
/** 3 = igual, 2 = empieza igual, 1 = con una falta leve, 0 = no. */
function tokScore(q: string, t: string): number {
  if (q === t) return 3;
  if (q.length >= 3 && t.startsWith(q)) return 2;
  const tol = q.length >= 7 ? 2 : q.length >= 4 ? 1 : 0;
  return tol && Math.abs(q.length - t.length) <= tol && lev(q, t) <= tol ? 1 : 0;
}
/** Puntaje de un nombre para lo que escribió el dueño: todas sus palabras tienen que aparecer. */
function nameScore(query: string, name: string): number {
  const q = tokens(query), n = tokens(name);
  if (!q.length || !n.length) return 0;
  let total = 0;
  for (const w of q) {
    const best = Math.max(0, ...n.map((t) => tokScore(w, t)));
    if (!best) return 0;
    total += best;
  }
  return total + (q.length === n.length ? 1 : 0);
}
const digits = (s: string) => String(s ?? "").replace(/\D/g, "");

/* ---------------- tapar datos antes de mandarlos a Claude ---------------- */
const EMAIL_RE = /[^\s@<>()"',;:]+@[^\s@<>()"',;:]+\.[a-z]{2,}/gi;
const NUM_RE = /\+?\d[\d\s.-]{4,}\d/g;
/** Tapa correos y números largos (teléfonos, códigos): Claude ve [correo1] y [numero1]. */
export function maskText(text: string, map: Map<string, string> = new Map()): { text: string; map: Map<string, string> } {
  let ne = 0, nn = 0;
  const out = text
    .replace(EMAIL_RE, (m) => { const k = `[correo${++ne}]`; map.set(k, m); return k; })
    .replace(NUM_RE, (m) => { if (digits(m).length < 6) return m; const k = `[numero${++nn}]`; map.set(k, m.trim()); return k; });
  return { text: out, map };
}
const unmask = (v: string | null, map: Map<string, string>) => (v ? v.replace(/\[(correo|numero)\d+\]/g, (k) => map.get(k) ?? k) : v);

/* ---------------- módulo ---------------- */
export function createCommands(d: CommandDeps) {
  const { store, now } = d;
  const e = store.engine;
  const plans = new Map<string, Plan>();
  const drafts = new Map<string, Draft>();
  /** Charla por usuario (ya tapada): lo que se le manda a Claude como contexto. */
  const chats = new Map<string, string[]>();
  const limiter = new RateLimiter(60, 60 * 60_000, now);

  const sweep = () => {
    const t = now();
    for (const [k, p] of plans) if (p.expiresAt < t - TTL) plans.delete(k);
    for (const [k, x] of drafts) if (x.expiresAt < t) drafts.delete(k);
  };
  const newId = (p: string) => `${p}_${randomBytes(12).toString("base64url")}`;
  const remember = (userId: string, line: string) => {
    const l = chats.get(userId) ?? [];
    l.push(maskText(line.replace(/\s+/g, " ").slice(0, 240)).text);
    chats.set(userId, l.slice(-6));
  };

  // dd/mm con hora de Bolivia (en-GB siempre da dos dígitos: "10/01").
  const fd = (t: number) => new Intl.DateTimeFormat("en-GB", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit" }).format(new Date(t));
  const dayKey = (t: number) => new Intl.DateTimeFormat("en-CA", { timeZone: "America/La_Paz" }).format(new Date(t));
  const dayDiff = (t: number) => Math.round((Date.parse(dayKey(t)) - Date.parse(dayKey(now()))) / DAY);
  const symFor = (customerId: string) => store.usd.currency(customerId).symbol;
  const money = (c: number, sym: string) => `${sym} ${(c / 100).toFixed(2).replace(/\.00$/, "")}`;
  const bsSym = () => e.s.settings.currencySymbol || "Bs";
  const pname = (id: string) => e.s.products[id]?.name ?? "servicio";
  const tail = (phone: string) => { const x = digits(phone); return x ? `…${x.slice(-4)}` : "sin WhatsApp"; };
  const active = (customerId: string) => Object.values(e.s.assignments).filter((a) => a.customerId === customerId && a.status === "active").sort((a, b) => a.customerExpiresAt - b.customerExpiresAt);
  const sellable = (slotId: string) => {
    const s = e.s.slots[slotId], acc = s ? e.s.accounts[s.accountId] : undefined;
    return !!s && s.status === "available" && acc?.status === "active" && acc.supplierExpiresAt > now();
  };
  /** Perfiles libres de un producto en el orden en que los entrega el núcleo (el que vence antes con el proveedor). */
  const freeSlots = (productId: string) => Object.values(e.s.slots).filter((s) => s.productId === productId && sellable(s.id))
    .sort((a, b) => e.s.accounts[a.accountId].supplierExpiresAt - e.s.accounts[b.accountId].supplierExpiresAt || a.id.localeCompare(b.id));

  /* ---------- quién y qué ---------- */
  function findCustomers(q: string) {
    const all = Object.values(e.s.customers);
    const ds = digits(q);
    if (ds.length >= 6) {
      const t = ds.slice(-8);
      const byPhone = all.filter((c) => digits(c.phone).endsWith(t) || (t.length >= 7 && digits(c.phone).includes(t)));
      if (byPhone.length) return byPhone;
    }
    if (q.includes("@")) {
      const em = q.trim().toLowerCase();
      const byMail = all.filter((c) => c.email?.toLowerCase() === em);
      // Correo de una cuenta: los clientes que tienen un perfil en esa cuenta.
      const acc = Object.values(e.s.accounts).find((a) => a.email.toLowerCase() === em);
      const byAcc = acc ? all.filter((c) => active(c.id).some((a) => e.s.slots[a.slotId]?.accountId === acc.id)) : [];
      const out = [...new Set([...byMail, ...byAcc])];
      if (out.length) return out;
    }
    const scored = all.map((c) => ({ c, s: nameScore(q, c.name) })).filter((x) => x.s > 0);
    const best = Math.max(0, ...scored.map((x) => x.s));
    return scored.filter((x) => x.s === best).map((x) => x.c);
  }
  function customerOf(st: St, which: "customerId" | "toCustomerId"): string {
    const id = st[which];
    if (id) {
      if (!e.s.customers[id]) throw new Ask("Ese cliente ya no existe. Decime de nuevo a quién.");
      return id;
    }
    const q = which === "customerId" ? st.customer : st.toCustomer;
    if (!q) throw new Ask(which === "customerId" ? "¿Para qué cliente? Escribime su nombre o su número." : "¿A qué cliente se lo paso? Escribime su nombre o su número.");
    const found = findCustomers(q);
    if (!found.length) throw new Ask(`No encontré a ningún cliente “${q.slice(0, 40)}”. Revisá el nombre o escribime su número.`);
    if (found.length === 1) return found[0].id;
    const opts = found.slice(0, 6);
    const names = opts.map((c) => c.name);
    // "Tengo 2 María": el nombre como está guardado (con tilde) si todos se llaman igual.
    const firsts = new Set(found.map((c) => c.name.trim().split(/\s+/)[0]));
    const typed = q.trim().split(/\s+/)[0];
    const pretty = firsts.size === 1 ? [...firsts][0] : typed.charAt(0).toUpperCase() + typed.slice(1);
    throw new Ask(`Tengo ${found.length} ${pretty}: ¿${names.slice(0, -1).join(", ")} o ${names.at(-1)}?`, which,
      opts.map((c) => ({ label: `${c.name} · ${tail(c.phone)}${c.kind === "reseller" ? " · revendedor" : ""}`, value: c.id })));
  }
  function findProducts(q: string) {
    const all = Object.values(e.s.products);
    const nq = norm(q);
    const exact = all.filter((p) => norm(p.name) === nq);
    if (exact.length) return exact;
    const scored = all.map((p) => ({ p, s: nameScore(q, p.name.replace(/\+/g, " plus ")) || nameScore(q, p.name) })).filter((x) => x.s > 0);
    const best = Math.max(0, ...scored.map((x) => x.s));
    const top = scored.filter((x) => x.s === best).map((x) => x.p);
    // "disney" con "Disney+" y el combo "Disney+ y Max": primero los sueltos.
    const single = top.filter((p) => p.kind !== "combo");
    return single.length ? single : top;
  }
  function productOf(st: St, ask: string, pool?: string[]): string {
    if (st.productId) {
      if (!e.s.products[st.productId]) throw new Ask("Ese producto ya no existe.");
      return st.productId;
    }
    if (!st.product) {
      const stock = store.inventory.stock();
      const list = (pool ?? Object.keys(e.s.products)).filter((id) => e.s.products[id]).sort((a, b) => (stock[b]?.available ?? 0) - (stock[a]?.available ?? 0)).slice(0, 8);
      throw new Ask(ask, "productId", list.map((id) => ({ label: pname(id), value: id })));
    }
    let found = findProducts(st.product);
    if (pool) found = found.filter((p) => pool.includes(p.id));
    if (!found.length) throw new Ask(`No encontré el producto “${st.product.slice(0, 40)}”.`, "productId", (pool ?? Object.keys(e.s.products)).slice(0, 8).map((id) => ({ label: pname(id), value: id })));
    if (found.length === 1) return found[0].id;
    throw new Ask(`¿Cuál de estos?`, "productId", found.slice(0, 6).map((p) => ({ label: p.name, value: p.id })));
  }
  /** El servicio activo de un cliente (filtrado por producto si lo dijo). */
  function assignmentOf(st: St, customerId: string, what: string): string {
    if (st.assignmentId) {
      const a = e.s.assignments[st.assignmentId];
      if (!a || a.status !== "active" || a.customerId !== customerId) throw new Ask("Ese servicio ya no está activo.");
      return a.id;
    }
    let list = active(customerId);
    const who = e.s.customers[customerId]?.name ?? "Ese cliente";
    if (!list.length) throw new Ask(`${who} no tiene servicios activos.`);
    if (st.product || st.productId) {
      const ids = st.productId ? [st.productId] : findProducts(st.product!).map((p) => p.id);
      const f = list.filter((a) => ids.includes(a.productId));
      if (!f.length) throw new Ask(`${who} no tiene ${st.product ?? pname(st.productId!)} activo. ¿Cuál de sus servicios?`, "assignmentId", list.slice(0, 6).map((a) => ({ label: svcLabel(a.id), value: a.id })));
      list = f;
    }
    if (list.length === 1) return list[0].id;
    throw new Ask(`${who} tiene ${list.length} servicios. ¿Cuál ${what}?`, "assignmentId", list.slice(0, 6).map((a) => ({ label: svcLabel(a.id), value: a.id })));
  }
  function svcLabel(aid: string) {
    const a = e.s.assignments[aid], s = e.s.slots[a.slotId];
    return `${pname(a.productId)} · ${s?.label ?? "perfil"} · vence ${fd(a.customerExpiresAt)}`;
  }
  const allowed = (actor: Actor, perm: Parameters<typeof can>[1], what: string) => {
    if (!can(actor, perm)) throw new Ask(`Tu usuario no puede ${what}. Pedíselo al dueño.`);
  };

  /* ---------- solo lectura ---------- */
  function help(text = "Puedo hacer esto por vos. Escribime o dictame, como le hablarías a una persona:"): CommandReply {
    return { kind: "help", text, lines: EXAMPLES.map((x) => `• ${x}`), suggestions: EXAMPLES.slice(0, 4) };
  }

  function codes(actor: Actor, st: St): CommandReply {
    allowed(actor, "codes.configure", "ver los códigos (los ve solo el dueño)");
    let emails: string[] = [], title = "";
    if (st.account) {
      const em = st.account.trim().toLowerCase();
      const acc = Object.values(e.s.accounts).find((a) => a.email.toLowerCase() === em);
      if (!acc) throw new Ask("No tengo ninguna cuenta cargada con ese correo.");
      emails = [em]; title = `Códigos de la cuenta de ${pname(acc.productId)}`;
    } else if (st.customer || st.customerId) {
      const cid = customerOf(st, "customerId");
      const ids = st.product || st.productId ? [assignmentOf(st, cid, "querés")] : active(cid).map((a) => a.id);
      if (!ids.length) throw new Ask(`${e.s.customers[cid].name} no tiene servicios activos.`);
      emails = [...new Set(ids.map((id) => e.s.accounts[e.s.slots[e.s.assignments[id].slotId].accountId].email.toLowerCase()))];
      title = `Códigos de ${firstName(e.s.customers[cid].name)}${ids.length === 1 ? ` (${pname(e.s.assignments[ids[0]].productId)})` : ""}`;
    } else if (st.product || st.productId) {
      const pid = productOf(st, "¿De qué producto?");
      emails = Object.values(e.s.accounts).filter((a) => a.productId === pid && a.status === "active").map((a) => a.email.toLowerCase());
      title = `Últimos códigos de ${pname(pid)}`;
    } else throw new Ask("¿De quién es el código? Decime el cliente, la cuenta o el producto.");
    const list = store.codes.recent(actor, 200).filter((c) => emails.includes(c.to)).slice(0, 3);
    if (!list.length) return { kind: "answer", text: `${title}: no llegó ninguno en la última semana.`, lines: ["Pedí el código desde la app de la plataforma y preguntame de nuevo en un minuto."] };
    const ago = (t: number) => { const m = Math.max(0, Math.round((now() - t) / 60_000)); return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : m < 1440 ? `hace ${Math.round(m / 60)} h` : `el ${fd(t)}`; };
    return { kind: "answer", text: `${title}:`, lines: list.map((c) => `🔑 ${c.code || "(link)"}${c.link && !c.code ? ` ${c.link}` : ""} · ${c.product || "cuenta"} · ${ago(c.receivedAt)}`) };
  }

  function free(actor: Actor, st: St): CommandReply {
    allowed(actor, "inventory.manage", "ver el inventario");
    const stock = store.inventory.stock();
    if (!st.product && !st.productId) {
      const rows = Object.values(e.s.products).filter((p) => (stock[p.id]?.available ?? 0) > 0).sort((a, b) => (stock[b.id].available ?? 0) - (stock[a.id].available ?? 0));
      if (!rows.length) return { kind: "answer", text: "No tenés perfiles libres de ningún producto. Cargá cuentas en Carga de Cuentas." };
      return { kind: "answer", text: "Perfiles libres por producto:", lines: rows.slice(0, 15).map((p) => `• ${p.name}: ${stock[p.id].available}`) };
    }
    const pid = productOf(st, "¿De qué producto?");
    const p = e.s.products[pid];
    if (p.kind === "combo") return { kind: "answer", text: `${p.name} es un combo: se puede vender ${stock[pid]?.available ?? 0} vez/veces (lo que alcance de cada app).` };
    const list = freeSlots(pid);
    if (!list.length) return { kind: "answer", text: `No tenés perfiles libres de ${p.name}.`, lines: ["Cargá una cuenta nueva en Carga de Cuentas."] };
    return { kind: "answer", text: `Tenés ${list.length} perfil${list.length === 1 ? "" : "es"} libre${list.length === 1 ? "" : "s"} de ${p.name}:`,
      lines: list.slice(0, 10).map((s) => { const acc = e.s.accounts[s.accountId]; return `• ${s.label} · ${acc.email} · la cuenta vence ${fd(acc.supplierExpiresAt)}`; }) };
  }

  function customer(actor: Actor, st: St): CommandReply {
    allowed(actor, "customer.manage", "ver clientes");
    const cid = customerOf(st, "customerId");
    const c = e.s.customers[cid], svcs = active(cid);
    const owed = store.fiado.owedBy(cid), bal = store.wallet.balance(cid), sym = symFor(cid);
    const unpaid = svcs.filter((a) => a.control?.payStatus && a.control.payStatus !== "pagado").length;
    const rev = c.resellerId ? e.s.customers[c.resellerId] : undefined;
    const lines = [
      `📱 ${c.phone || "sin WhatsApp"}${c.kind === "reseller" ? " · revendedor" : ""}${rev ? ` · cliente de ${rev.name}` : ""}`,
      ...(svcs.length ? svcs.map((a) => { const dd = dayDiff(a.customerExpiresAt); return `📺 ${svcLabel(a.id)}${dd < 0 ? " (vencido)" : dd === 0 ? " (hoy)" : ""}`; }) : ["Sin servicios activos."]),
      `💸 Te debe: ${money(owed, bsSym())}${unpaid ? ` · ${unpaid} alquiler(es) sin pagar en el Control` : ""}`,
      `👛 Saldo: ${money(bal, sym)}`,
    ];
    return { kind: "answer", text: `${c.name}:`, lines };
  }

  function owes(actor: Actor): CommandReply {
    if (!["owner", "admin"].includes(actor.role)) throw new Ask("Esto lo ven el dueño o un admin.");
    const ov = store.fiado.overview(actor);
    const rows = ov.rows.filter((r) => r.owed > 0 || r.unlinked.count);
    const review = Object.values(e.s.orders).filter((o) => o.status === "payment_review").sort((a, b) => a.createdAt - b.createdAt);
    const lines = [
      ...rows.slice(0, 12).map((r) => `• ${r.name}: ${money(r.owed + r.unlinked.amount, bsSym())}${r.overdue ? " ⚠️ ya tocaba cobrar" : r.nextDue ? ` · cobrar el ${fd(r.nextDue)}` : ""}`),
      ...(review.length ? [`🧾 Pagos por revisar: ${review.length}`, ...review.slice(0, 5).map((o) => `   – ${e.s.customers[o.customerId]?.name ?? "?"}: ${o.usd !== undefined ? money(o.usd, "US$") : money(o.total, bsSym())}`)] : ["🧾 No hay pagos por revisar."]),
    ];
    const total = rows.reduce((t, r) => t + r.owed + r.unlinked.amount, 0);
    return { kind: "answer", text: rows.length ? `Te deben ${money(total, bsSym())} entre ${rows.length} persona${rows.length === 1 ? "" : "s"}:` : "Nadie te debe nada 🎉", lines, suggestions: rows.length ? ["Abrir Fiado"] : [] };
  }

  function expiring(actor: Actor, st: St): CommandReply {
    const n = Math.min(60, st.days ?? 0);
    const list = store.admin.assignments(actor).filter((a) => { const dd = dayDiff(a.customerExpiresAt); return n <= 1 ? dd === n : dd >= 0 && dd <= n; });
    const when = n === 0 ? "hoy" : n === 1 ? "mañana" : `en los próximos ${n} días`;
    if (!list.length) return { kind: "answer", text: `Nadie vence ${when} ✨` };
    return { kind: "answer", text: `Vence${list.length === 1 ? "" : "n"} ${when} (${list.length}):`,
      lines: list.slice(0, 20).map((a) => `• ${a.customerName ?? "?"} · ${a.product ?? ""} · ${fd(a.customerExpiresAt)}${a.resellerName && a.resellerId !== a.customerId ? ` (de ${a.resellerName})` : ""}`),
      suggestions: [`Renová a ${firstName(list[0].customerName)}`] };
  }

  function account(actor: Actor, st: St): CommandReply {
    allowed(actor, "inventory.manage", "ver las cuentas");
    let accId: string, slotId: string | undefined, aid: string | undefined, who = "";
    if (st.account && !st.customer && !st.customerId) {
      const em = st.account.trim().toLowerCase();
      const acc = Object.values(e.s.accounts).find((a) => a.email.toLowerCase() === em);
      if (!acc) throw new Ask("No tengo ninguna cuenta cargada con ese correo.");
      accId = acc.id;
    } else {
      const cid = customerOf(st, "customerId");
      aid = assignmentOf(st, cid, "querés");
      const a = e.s.assignments[aid];
      slotId = a.slotId; accId = e.s.slots[a.slotId].accountId; who = ` de ${firstName(e.s.customers[cid].name)}`;
    }
    const acc = e.s.accounts[accId], slot = slotId ? e.s.slots[slotId] : undefined;
    return { kind: "answer", text: `Datos de ${pname(acc.productId)}${who}:`,
      lines: [`📧 ${acc.email}`, ...(slot ? [`👤 ${slot.label}`] : []), `🔑 La contraseña${slot?.pin ? " y el PIN" : ""} los ves con el botón (queda anotado en la Auditoría).`],
      account: { accountId: accId, ...(slotId ? { slotId } : {}), ...(aid ? { assignmentId: aid } : {}) } };
  }

  /* ---------- planes (cambian algo: siempre con confirmación) ---------- */
  function payOf(st: St, options: Pay[], text: string): Pay {
    if (st.pay && options.includes(st.pay)) return st.pay;
    throw new Ask(text, "pay", options.map((p) => ({ label: PAY_TEXT[p], value: p })));
  }
  function makePlan(actor: Actor, exec: Exec, title: string, lines: string[], done: string, officeText: string): CommandReply {
    const id = newId("ord");
    const t = now();
    plans.set(id, { id, userId: actor.id, createdAt: t, expiresAt: t + TTL, used: false, exec, done, officeText });
    return { kind: "plan", text: title, plan: { id, lines, expiresAt: t + TTL, confirm: "✅ Hacerlo" } };
  }

  function sell(actor: Actor, st: St): CommandReply {
    allowed(actor, "order.create_any", "vender");
    const cid = customerOf(st, "customerId");
    const pid = productOf(st, "¿Qué le vendés?");
    const c = e.s.customers[cid], p = e.s.products[pid];
    const qty = Math.min(10, Math.max(1, st.qty || 1)), months = Math.min(12, Math.max(1, st.months || 1));
    const avail = store.inventory.stock()[pid]?.available ?? 0;
    if (avail < qty) return { kind: "answer", text: `No tengo ${qty > 1 ? `${qty} perfiles` : "perfiles"} libres de ${p.name} (${avail} libre${avail === 1 ? "" : "s"}).`, lines: ["Cargá una cuenta en Carga de Cuentas y pedímelo de nuevo."] };
    const q = store.orders.quote(actor, { customerId: cid, items: [{ productId: pid, qty }], periods: months });
    const usdC = (q as { currency?: string }).currency === "USD";
    const sym = usdC ? "US$" : symFor(cid);
    const bal = store.wallet.balance(cid);
    const opts: Pay[] = usdC ? ["efectivo", "saldo", "fiado"] : bal >= q.total ? PAYS : ["qr", "efectivo", "fiado"];
    if (st.pay === "saldo" && bal < q.total) throw new Ask(`A ${firstName(c.name)} no le alcanza el saldo (tiene ${money(bal, sym)} y cuesta ${money(q.total, sym)}). ¿Cómo te pagó?`, "pay", opts.map((x) => ({ label: PAY_TEXT[x], value: x })));
    if (usdC && st.pay === "qr") st.pay = "efectivo";
    const pay = payOf(st, opts, `¿Cómo te pagó ${firstName(c.name)} los ${money(q.total, sym)}?`);
    const slots = p.kind === "combo" ? [] : freeSlots(pid).slice(0, qty);
    const prof = p.kind === "combo"
      ? `un perfil de cada app: ${(p.comboProductIds ?? []).map(pname).join(", ")}`
      : slots.map((s) => `${s.label} (cuenta que vence ${fd(e.s.accounts[s.accountId].supplierExpiresAt)})`).join(", ");
    const lines = [
      `👤 Cliente: ${c.name} · ${tail(c.phone)}`,
      `📺 Producto: ${p.name}${qty > 1 ? ` × ${qty}` : ""} · ${months === 1 ? "1 mes" : `${months} meses`}`,
      `💰 Precio de su lista: ${money(q.total, sym)}${q.discount ? ` (con descuento de ${money(q.discount, sym)})` : ""}`,
      `🎟️ Le toca: ${prof}`,
      `💳 Pago: ${PAY_TEXT[pay]}${pay === "saldo" ? ` · tiene ${money(bal, sym)}` : ""}`,
    ];
    const fn = firstName(c.name);
    return makePlan(actor, { type: "sell", customerId: cid, productId: pid, qty, months, pay, preferredSlotIds: slots.map((s) => s.id) },
      `Voy a venderle ${p.name} a ${c.name}.`, lines, `✅ Listo: le vendí ${p.name} a ${fn}.`, `Le vendí ${p.name} a ${fn} por orden tuya.`);
  }

  function renew(actor: Actor, st: St): CommandReply {
    allowed(actor, "assignment.renew_any", "renovar");
    const cid = customerOf(st, "customerId");
    const aid = assignmentOf(st, cid, "renuevo");
    const a = e.s.assignments[aid], c = e.s.customers[cid], p = e.s.products[a.productId];
    const dur = p.durationDays || 30;
    const periods = Math.min(12, Math.max(1, st.months || (st.days ? Math.round(st.days / dur) : 1) || 1));
    const next = Math.max(a.customerExpiresAt, now()) + dur * periods * DAY;
    const acc = e.s.accounts[e.s.slots[a.slotId].accountId];
    if (next > acc.supplierExpiresAt) return { kind: "answer", text: `No puedo renovar ${p.name} de ${firstName(c.name)} hasta el ${fd(next)}: la cuenta vence con el proveedor el ${fd(acc.supplierExpiresAt)}.`, lines: ["Renová la cuenta con el proveedor o reemplazá el perfil desde Control."] };
    const usdC = store.usd.currency(cid).code === "USD";
    const unit = store.catalog.renewPriceFor(cid, a);
    const total = unit * periods, sym = usdC ? "US$" : symFor(cid), bal = store.wallet.balance(cid);
    const opts: Pay[] = usdC ? ["efectivo", "saldo", "fiado"] : bal >= total ? PAYS : ["qr", "efectivo", "fiado"];
    if (st.pay === "saldo" && bal < total) throw new Ask(`A ${firstName(c.name)} no le alcanza el saldo (tiene ${money(bal, sym)} y cuesta ${money(total, sym)}). ¿Cómo te pagó?`, "pay", opts.map((x) => ({ label: PAY_TEXT[x], value: x })));
    if (usdC && st.pay === "qr") st.pay = "efectivo";
    const pay = payOf(st, opts, `¿Cómo te pagó ${firstName(c.name)} la renovación (${money(total, sym)})?`);
    const days = dur * periods;
    const lines = [
      `👤 Cliente: ${c.name} · ${tail(c.phone)}`,
      `📺 Servicio: ${svcLabel(aid)}`,
      `⏳ ${periods === 1 ? "1 período" : `${periods} períodos`} (${days} días): queda hasta el ${fd(next)}`,
      ...(st.days && st.days !== days ? [`ℹ️ Renuevo por períodos de ${dur} días: pediste ${st.days}.`] : []),
      `💰 Precio: ${money(total, sym)}`,
      `💳 Pago: ${PAY_TEXT[pay]}`,
    ];
    const fn = firstName(c.name);
    return makePlan(actor, { type: "renew", assignmentId: aid, periods, pay }, `Voy a renovarle ${p.name} a ${c.name}.`, lines,
      `✅ Listo: le renové ${p.name} a ${fn} hasta el ${fd(next)}.`, `Le renové ${p.name} a ${fn} hasta el ${fd(next)} por orden tuya.`);
  }

  function transfer(actor: Actor, st: St): CommandReply {
    allowed(actor, "assignment.replace", "pasar servicios a otro cliente");
    const from = customerOf(st, "customerId");
    const aid = assignmentOf(st, from, "paso");
    const to = customerOf(st, "toCustomerId");
    if (to === from) throw new Ask("Es el mismo cliente. ¿A quién se lo paso?");
    const a = e.s.assignments[aid], p = e.s.products[a.productId], fc = e.s.customers[from], tc = e.s.customers[to];
    const lines = [
      `📺 Servicio: ${svcLabel(aid)}`,
      `➡️ De ${fc.name} a ${tc.name} · ${tail(tc.phone)}`,
      "📅 Mismo perfil y misma fecha de vencimiento. No se cobra nada.",
    ];
    return makePlan(actor, { type: "transfer", assignmentId: aid, toCustomerId: to }, `Voy a pasarle ${p.name} de ${fc.name} a ${tc.name}.`, lines,
      `✅ Listo: ${p.name} ahora es de ${firstName(tc.name)}.`, `Pasé ${p.name} de ${firstName(fc.name)} a ${firstName(tc.name)} por orden tuya.`);
  }

  /** Resuelve la orden: responde, pregunta (con borrador) o arma el plan. */
  function run(actor: Actor, st: St): CommandReply {
    try {
      switch (st.intent) {
        case "codes": return codes(actor, st);
        case "free": return free(actor, st);
        case "customer": return customer(actor, st);
        case "owes": return owes(actor);
        case "expiring": return expiring(actor, st);
        case "account": return account(actor, st);
        case "sell": return sell(actor, st);
        case "renew": return renew(actor, st);
        case "transfer": return transfer(actor, st);
        case "help": return help();
        default: return help("No te entendí bien 🙈. Probá con algo como:");
      }
    } catch (err) {
      if (err instanceof Ask) {
        if (!err.need || !err.choices.length) return { kind: "answer", text: err.text, ...(err.lines.length ? { lines: err.lines } : {}) };
        const id = newId("drf");
        drafts.set(id, { id, userId: actor.id, expiresAt: now() + TTL, st: { ...st }, need: err.need, values: err.choices.map((c) => c.value) });
        return { kind: "choose", text: err.text, choices: err.choices, draft: id };
      }
      if (err instanceof DomainError && err.code === "FORBIDDEN") return { kind: "answer", text: "Tu usuario no tiene permiso para eso. Pedíselo al dueño." };
      if (err instanceof DomainError && err.code === "NOT_FOUND") return { kind: "answer", text: err.message };
      throw err;
    }
  }

  const ownerOrAdmin = (c: Ctx): Actor => {
    const a = c.actor!;
    if (a.role !== "owner" && a.role !== "admin") d.fail(403, "FORBIDDEN", "La secretaria la usan el dueño y los admin");
    return a;
  };

  // Una orden nueva (texto) o la respuesta a una pregunta (borrador + opción elegida).
  d.route("POST", "/api/admin/command", "staff", async (c) => {
    const actor = ownerOrAdmin(c);
    sweep();
    if (!limiter.take(actor.id)) d.fail(429, "RATE_LIMIT", "Muchas órdenes seguidas: probá en un rato (hasta 60 por hora).");
    const b = c.body ?? {};
    if (b.draft) {
      const dr = drafts.get(String(b.draft));
      if (!dr || dr.userId !== actor.id) d.fail(404, "NOT_FOUND", "Esa pregunta ya no está. Decime la orden de nuevo.");
      if (dr.expiresAt < now()) { drafts.delete(dr.id); d.fail(409, "EXPIRED", "Pasaron más de 10 minutos. Decime la orden de nuevo."); }
      const pick = String(b.pick ?? "");
      if (!dr.values.includes(pick)) d.fail(400, "VALIDATION", "Elegí una de las opciones.");
      drafts.delete(dr.id);
      const st: St = { ...dr.st };
      if (dr.need === "pay") st.pay = pick as Pay; else st[dr.need as Exclude<Need, "pay">] = pick;
      const r = run(actor, st);
      remember(actor.id, `Dueño eligió: ${String(b.label ?? "").slice(0, 60) || "una opción"}`);
      remember(actor.id, `Sofi: ${r.text}`);
      return r;
    }
    const text = String(b.text ?? "").trim();
    if (text.length < 2 || text.length > 500) d.fail(400, "VALIDATION", "Escribime la orden (hasta 500 letras).");
    if (!d.agents.hasKey) d.fail(409, "AI_OFF", "Falta la clave de Claude en el servidor (ANTHROPIC_API_KEY). Se carga una sola vez en Configuración → Oficina virtual.");
    if (!d.agents.isOn("commands")) d.fail(409, "AI_OFF", actor.role === "owner" ? "Sofi, tu secretaria, está apagada. Prendela en Configuración → Oficina virtual." : "Sofi, la secretaria, está apagada. Pedile al dueño que la prenda.");
    const { text: masked, map } = maskText(text);
    let parsed: ParsedCommand;
    try {
      parsed = await d.agents.parseCommand({ text: masked, history: chats.get(actor.id) ?? [], products: Object.values(e.s.products).map((p) => p.name) });
    } catch (err) {
      if (err instanceof AiError) d.fail(409, err.code, err.message);
      throw err;
    }
    const pay = (parsed.pay ?? "").toLowerCase();
    const st: St = {
      intent: parsed.intent,
      customer: unmask(parsed.customer, map) ?? undefined, product: unmask(parsed.product, map) ?? undefined,
      account: unmask(parsed.account, map) ?? undefined, toCustomer: unmask(parsed.to_customer, map) ?? undefined,
      qty: parsed.qty ?? 1, months: parsed.months ?? undefined, days: parsed.days ?? undefined,
      pay: /qr|transf|banco/.test(pay) ? "qr" : /efect|cash|mano/.test(pay) ? "efectivo" : /saldo|billetera/.test(pay) ? "saldo" : /fiad|debe|deb/.test(pay) ? "fiado" : undefined,
    };
    const r = run(actor, st);
    remember(actor.id, `Dueño: ${masked}`);
    remember(actor.id, `Sofi: ${r.text}`);
    return r;
  });

  // Confirmar el plan: lo ejecuta el núcleo con el actor que confirma (sus permisos), una sola vez.
  d.route("POST", "/api/admin/command/:id/confirm", "staff", (c) => {
    const actor = ownerOrAdmin(c);
    const p = plans.get(c.params.id);
    if (!p || p.userId !== actor.id) d.fail(404, "NOT_FOUND", "No encuentro esa orden. Decímela de nuevo.");
    if (p.used) d.fail(409, "ALREADY_PROCESSED", "Esa orden ya se hizo.");
    if (p.expiresAt < now()) { plans.delete(p.id); d.fail(409, "EXPIRED", "Pasaron más de 10 minutos. Decime la orden de nuevo y la hago."); }
    p.used = true;
    const x = p.exec;
    let assignmentIds: string[] = [], orderId: string | undefined, customerId: string;
    const payStatus = (pay: Pay) => (pay === "fiado" ? "pendiente" : "pagado") as "pendiente" | "pagado";
    const method = (pay: Pay) => (pay === "saldo" ? "balance" : "cash") as "balance" | "cash";
    if (x.type === "sell") {
      const o = store.orders.create(actor, { customerId: x.customerId, items: [{ productId: x.productId, qty: x.qty }], paymentMethod: method(x.pay), idempotencyKey: p.id,
        ...(x.preferredSlotIds.length ? { preferredSlotIds: x.preferredSlotIds } : {}), ...(x.months > 1 ? { periods: x.months } : {}) });
      orderId = o.id; assignmentIds = o.assignmentIds ?? []; customerId = x.customerId;
      // Igual que "Vender" del panel: el estado de pago queda en el Control (Pendiente = aparece en Fiado).
      for (const id of assignmentIds) store.orders.setControl(actor, id, { payStatus: payStatus(x.pay) });
    } else if (x.type === "renew") {
      const r = store.orders.renew(actor, x.assignmentId, { periods: x.periods, paymentMethod: method(x.pay), idempotencyKey: p.id });
      orderId = r.order.id; assignmentIds = [x.assignmentId]; customerId = r.assignment.customerId;
      if (x.pay === "fiado") store.orders.setControl(actor, x.assignmentId, { payStatus: "pendiente" });
    } else {
      const a = store.orders.transfer(actor, x.assignmentId, x.toCustomerId, "Por orden del dueño (secretaria)");
      assignmentIds = [a.id]; customerId = x.toCustomerId;
    }
    e.tx(() => e.audit(actor, "assistant.command", "command", p.id, { intent: x.type, ...(orderId ? { order: orderId } : {}), assignments: assignmentIds.join(","), customer: customerId }));
    d.note(p.officeText, "ok");
    const cust = e.s.customers[customerId];
    return { kind: "done", text: p.done, assignmentIds, customerId, hasPhone: !!digits(cust?.phone ?? "") };
  });

  // Cancelar: se borra y no hace nada.
  d.route("POST", "/api/admin/command/:id/cancel", "staff", (c) => {
    const actor = ownerOrAdmin(c);
    const p = plans.get(c.params.id);
    if (!p || p.userId !== actor.id) d.fail(404, "NOT_FOUND", "No encuentro esa orden.");
    if (p.used) d.fail(409, "ALREADY_PROCESSED", "Esa orden ya se hizo: no se puede cancelar desde acá.");
    plans.delete(p.id);
    return { ok: true, text: "Listo, no hice nada." };
  });

  // "Ver contraseña" de una cuenta: el mismo permiso y la misma auditoría que el panel (secrets.view).
  d.route("POST", "/api/admin/command/secret", "staff", (c) => {
    const actor = ownerOrAdmin(c);
    authorize(actor, "inventory.view_secrets");
    const acc = e.s.accounts[String(c.body?.accountId ?? "")];
    if (!acc) d.fail(404, "NOT_FOUND", "Esa cuenta ya no existe.");
    const slot = c.body?.slotId ? e.s.slots[String(c.body.slotId)] : undefined;
    if (slot && slot.accountId !== acc.id) d.fail(400, "VALIDATION", "Ese perfil no es de esa cuenta.");
    e.tx(() => e.audit(actor, "secrets.view", "account", acc.id, { via: "secretaria" }));
    return { password: acc.password || "(pendiente)", ...(slot?.pin ? { pin: slot.pin } : {}) };
  });

  return { maskText, pending: () => plans.size };
}
