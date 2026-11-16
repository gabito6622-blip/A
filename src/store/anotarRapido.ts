/**
 * ✍️ Anotar rápido (16/11/2026). El dueño anota los pagos escribiendo como en WhatsApp:
 *   «netgb117+liz@gmail.com · Oby pagó 69bs · vence 15 diciembre»
 * Acá se entiende ese texto: el correo (o solo «netgb117+liz»), el monto, la fecha y «2 meses». Primero se muestra
 * qué se va a anotar (de quién es la cuenta, cuánto, hasta cuándo) y avisa si el nombre del texto no coincide con
 * el dueño de la cuenta (le pasó con Robin y Dani). Recién con «Confirmar» se anota, con el mismo «Me pagó» de
 * siempre, y queda para «↩️ Deshacer».
 */
import type { Actor, Assignment, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { payApply, payPreview } from "./cobro.js";
import { setCustomerExpiry } from "./orders.js";
import { effectivePrice, payerOf } from "./admin.js";
import { isUsd } from "./usd.js";
import { undoRecord, undoSnapshot } from "./deshacer.js";

const MESES: Record<string, number> = { ene: 0, enero: 0, feb: 1, febrero: 1, mar: 2, marzo: 2, abr: 3, abril: 3, may: 4, mayo: 4, jun: 5, junio: 5, jul: 6, julio: 6,
  ago: 7, agosto: 7, sep: 8, sept: 8, set: 8, septiembre: 8, setiembre: 8, oct: 9, octubre: 9, nov: 10, noviembre: 10, dic: 11, diciembre: 11 };
const STOP = new Set(["pago", "pagó", "pagaron", "pagado", "vence", "vencia", "venció", "cuenta", "cuentas", "renovo", "renovó", "renovar", "renueva", "renovada", "hasta", "meses",
  "mes", "aumenta", "aumentale", "gmail", "com", "hotmail", "bolivianos", "cliente", "disney", "espn", "netflix", "prime", "max", "perfil", "para", "por", "con", "del", "las", "los",
  "que", "una", "uno", "dos", "tres", "hoy", "ayer", "dia", "día", "esa", "ese", "esta", "este", "año", "nueva", "sin", "premium", "dale", "asignale", "anota", "anotá",
  ...Object.keys(MESES)]);
const fold = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
const fd = (t: number) => new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "America/La_Paz" });

export interface QuickAction {
  assignmentId: Id; email: string; product: string; who: string; customer: string; phone: string;
  from: number; to: number; toFromText: boolean; amount: Cents; amountFromText: boolean; periods: number; usd: boolean;
  warnings: string[]; blockers: string[]; doubleCharge?: string;
}

/** Fecha escrita («15 dic», «15 de diciembre», «15/12», «15/12/2026») → día en Bolivia, o undefined. */
function findDate(text: string, now: number): { day: number; month: number; year?: number; raw: string } | undefined {
  const t = fold(text);
  const m1 = /\b(\d{1,2})\s*\/\s*(\d{1,2})(?:\s*\/\s*(\d{2,4}))?\b/.exec(t);
  if (m1) return { day: +m1[1], month: +m1[2] - 1, year: m1[3] ? (+m1[3] < 100 ? 2000 + +m1[3] : +m1[3]) : undefined, raw: m1[0] };
  const m2 = /\b(\d{1,2})\s*(?:de\s+)?(ene(?:ro)?|feb(?:rero)?|mar(?:zo)?|abr(?:il)?|may(?:o)?|jun(?:io)?|jul(?:io)?|ago(?:sto)?|sept?(?:iembre)?|set(?:iembre)?|oct(?:ubre)?|nov(?:iembre)?|dic(?:iembre)?)\b(?:\s*(?:de\s+)?(\d{4}))?/.exec(t);
  if (m2) return { day: +m2[1], month: MESES[m2[2]] ?? MESES[m2[2].slice(0, 3)], year: m2[3] ? +m2[3] : undefined, raw: m2[0] };
  void now;
  return undefined;
}
/** Ese día a la misma hora que `like` (así no cambia la hora del corte). Sin año: el próximo que corresponda. */
function dateAt(d: { day: number; month: number; year?: number }, like: number, now: number): number {
  const ref = new Date(like - 4 * 3_600_000); // hora de Bolivia
  const mk = (y: number) => Date.UTC(y, d.month, d.day, ref.getUTCHours(), ref.getUTCMinutes()) + 4 * 3_600_000;
  if (d.year) return mk(d.year);
  const y = new Date(now - 4 * 3_600_000).getUTCFullYear();
  const t = mk(y);
  return t < now - 60 * 86_400_000 ? mk(y + 1) : t;
}

/** Entiende el texto y arma lo que se anotaría. No cambia nada. */
export function quickParse(e: Engine, actor: Actor, text: unknown): { actions: QuickAction[]; unknown: string[]; notice?: string } {
  authorize(actor, "payment.review");
  const raw = String(text ?? "").slice(0, 2000);
  if (!raw.trim()) throw new DomainError("VALIDATION", "Escribí o pegá el correo de la cuenta y cuánto te pagó");
  const now = e.now();
  const t = fold(raw);
  if (/\bno\s+(me\s+)?(pago|pagaron|renueves|renovo|la\s+renueves)\b/.test(t)) return { actions: [], unknown: [], notice: "El texto dice que no pagó: no se anota nada. Si querés, cortala desde Mis hojas." };
  // Correos completos y también «netgb117+liz» sin el @gmail.com.
  const accByEmail = new Map(Object.values(e.s.accounts).map((a) => [a.email.toLowerCase(), a]));
  const full = [...raw.matchAll(/[a-z0-9._%+-]+@[a-z0-9.-]+\.[a-z]{2,}/gi)].map((m) => m[0].toLowerCase());
  let rest = raw;
  for (const m of full) rest = rest.replace(new RegExp(m.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  const partial = [...rest.matchAll(/\b[a-z0-9._-]+\+[a-z0-9._-]+\b/gi)].map((m) => m[0].toLowerCase())
    .map((p) => [...accByEmail.keys()].find((em) => em.split("@")[0] === p) ?? p);
  for (const m of partial) rest = rest.replace(new RegExp(m.split("@")[0].replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i"), " ");
  const emails = [...new Set([...full, ...partial])];
  if (!emails.length) throw new DomainError("VALIDATION", "No encontré el correo de la cuenta en el texto (por ejemplo netgb117+liz@gmail.com)");
  // Fecha, meses y monto (en lo que queda del texto, sin los correos).
  const date = findDate(rest, now);
  if (date) rest = fold(rest).replace(date.raw, " ");
  const mm = /\b(\d{1,2})\s*mes(es)?\b/.exec(fold(rest));
  const periods = mm ? Math.min(12, Math.max(1, +mm[1])) : 1;
  if (mm) rest = fold(rest).replace(mm[0], " ");
  const nums = [...fold(rest).matchAll(/(\d{1,5}(?:[.,]\d{1,2})?)\s*(bs|bolivianos|b\$)?/g)].map((m) => ({ v: Math.round(parseFloat(m[1].replace(",", ".")) * 100), bs: !!m[2] }))
    .filter((x) => x.v >= 100 && x.v <= 500_000);
  const amount = (nums.find((x) => x.bs) ?? (nums.length === 1 ? nums[0] : undefined))?.v;
  // Nombres que aparecen en el texto (para avisar si no coinciden con el dueño de la cuenta).
  const words = new Set(fold(rest).split(/[^a-zñ]+/).filter((w) => w.length >= 3 && !STOP.has(w)));
  const named = Object.values(e.s.customers).filter((c) => fold(c.name).split(/[^a-zñ]+/).some((w) => w.length >= 3 && words.has(w)));

  const actions: QuickAction[] = [], unknown: string[] = [];
  for (const em of emails) {
    const acc = accByEmail.get(em);
    const list = acc ? Object.values(e.s.assignments).filter((a) => a.status === "active" && e.s.slots[a.slotId]?.accountId === acc.id) : [];
    if (!list.length) { unknown.push(em); continue; }
    for (const a of list) actions.push(build(e, actor, a, em, { amount, periods, date, named, many: list.length > 1, now }));
  }
  return { actions, unknown };
}

function build(e: Engine, actor: Actor, a: Assignment, email: string, o: { amount?: Cents; periods: number; date?: ReturnType<typeof findDate>; named: { id: Id; name: string }[]; many: boolean; now: number }): QuickAction {
  const payer = payerOf(e, a.customerId) ?? e.s.customers[a.customerId];
  const cust = e.s.customers[a.customerId];
  const usd = !!payer && isUsd(e, payer);
  const pv = payPreview(e, actor, a.id, { periods: o.periods });
  const warnings = [...pv.warnings], blockers = [...pv.blockers];
  const to = o.date ? dateAt(o.date, pv.to, o.now) : pv.to;
  if (o.date && to <= a.customerExpiresAt) blockers.push(`La fecha ${fd(to)} no es posterior a su vencimiento actual (${fd(a.customerExpiresAt)})`);
  if (o.date && Math.abs(to - pv.to) > 20 * 86_400_000) warnings.push(`La fecha que escribiste (${fd(to)}) está lejos de la que da el sistema (${fd(pv.to)}): revisala`);
  if (o.named.length && !o.named.some((c) => c.id === payer?.id || c.id === a.customerId)) {
    warnings.push(`El texto nombra a «${o.named.map((c) => c.name.replace(/^[^·]*·\s*/, "")).slice(0, 2).join(", ")}», pero esta cuenta es de ${payer?.name ?? cust?.name}`);
  }
  if (o.many) warnings.push("Esa cuenta tiene varios perfiles ocupados: revisá que sea este");
  if (usd && o.amount !== undefined) warnings.push("Paga en dólares: se anota su precio en US$ de siempre (no el monto del texto)");
  const amount = usd || o.amount === undefined ? effectivePrice(e, a) : o.amount;
  return {
    assignmentId: a.id, email, product: e.s.products[a.productId]?.name ?? "", who: payer?.name ?? "", customer: cust?.name ?? "", phone: payer?.phone ?? "",
    from: a.customerExpiresAt, to, toFromText: !!o.date, amount, amountFromText: !usd && o.amount !== undefined, periods: o.periods, usd,
    warnings, blockers, ...(pv.doubleCharge ? { doubleCharge: pv.doubleCharge.text } : {}),
  };
}

/** Anota lo que se mostró (vuelve a leer el texto en el servidor: lo que se anota es lo mismo que se vio). */
export function quickApply(e: Engine, actor: Actor, text: unknown, opts: { key?: unknown; confirmOther?: unknown } = {}) {
  const { actions } = quickParse(e, actor, text);
  const key = String(opts.key ?? "").slice(0, 60) || String(e.now());
  const done: { assignmentId: Id; to: number; label: string }[] = [], failed: { assignmentId: Id; error: string; code?: string }[] = [];
  for (const x of actions) {
    if (x.blockers.length) { failed.push({ assignmentId: x.assignmentId, error: x.blockers[0] }); continue; }
    try {
      const snap = undoSnapshot(e, x.assignmentId);
      const r = payApply(e, actor, x.assignmentId, { periods: x.periods, ...(x.amountFromText ? { price: x.amount } : {}), idempotencyKey: `${key}:${x.assignmentId}`, confirmOther: opts.confirmOther === true });
      let to = r.saved.to;
      if (x.toFromText && x.to !== to) { setCustomerExpiry(e, actor, x.assignmentId, x.to, "Anotar rápido: fecha que escribió el dueño"); to = x.to; }
      const label = `${x.who.replace(/^[^·]*·\s*/, "")} · ${x.email} · ${x.usd ? "su precio en US$" : `Bs ${x.amount / 100}`} · hasta ${fd(to)}`;
      undoRecord(e, actor, x.assignmentId, snap, label);
      done.push({ assignmentId: x.assignmentId, to, label });
    } catch (err) {
      failed.push({ assignmentId: x.assignmentId, error: err instanceof Error ? err.message : String(err), code: (err as { code?: string }).code });
    }
  }
  return { done, failed };
}
