// "📋 Cargar sus cuentas": anotar en lote las cuentas que el dueño ya le vendió a un revendedor
// por fuera (WhatsApp). Una línea por cuenta: `correo [dd/mm o dd/mm/aaaa] [precio]`.
//
// - Solo dueño y admin. No cobra nada: deja el servicio con un pedido de registro de Bs 0 y canal
//   "import" (importer.assignWithoutCharge), así no toca su saldo ni cuenta como plata que entró.
// - No manda avisos ni WhatsApp.
// - Se puede pegar dos veces: lo que ya es de ese revendedor se salta.
// - Una cuenta de otro cliente se rechaza SIN decir de quién es.
// - `apply` vuelve a revisar todo en el servidor dentro de la transacción: no confía en la vista previa.
import type { Account, Actor, Assignment, Cents, Customer, Id, Product, RentalControl, Slot } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { DAY } from "./time.js";
import { isUsd } from "./usd.js";
import { assignWithoutCharge } from "./importer.js";

export const MAX_LINES = 500;
const MAX_TEXT = 60_000;

export type BulkStatus = "nueva" | "ya_suya" | "de_otro" | "no_existe" | "fecha_mala" | "repetida" | "sin_lugar" | "dato_malo";

export interface BulkRow {
  line: number;
  /** El correo (o usuario) tal como se buscó: en minúsculas y sin espacios. */
  email: string;
  ok: boolean;
  status: BulkStatus;
  /** Motivo para mostrar si no se carga (o aviso de "ya es suya"). */
  reason?: string;
  product?: string;
  profile?: string;
  expiresAt?: number;
  /** true si no vino fecha y se usó la duración del producto desde hoy. */
  defaultDate?: boolean;
  /** Precio acordado, en centavos de la moneda del revendedor. */
  price?: Cents;
  warnings: string[];
}

interface Planned { row: BulkRow; slot?: Slot; product?: Product; account?: Account }

const key = (s: string) => s.toLowerCase().replace(/\s+/g, "");
const BO_TZ = 4 * 3_600_000; // Bolivia/Paraguay UTC-4

/** "dd/mm" o "dd/mm/aaaa" → 23:59 de ese día (si no dice el año, la próxima vez que llegue; hasta 60 días atrás cuenta como vencida). */
function parseDay(now: number, s: string): number | null {
  const m = s.match(/^(\d{1,2})[/-](\d{1,2})(?:[/-](\d{2}|\d{4}))?$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  let y = m[3] ? +m[3] : new Date(now).getUTCFullYear();
  if (y < 100) y += 2000;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null; // 31/02
  let t = Date.UTC(y, mo - 1, d, 23, 59) + BO_TZ;
  if (!m[3] && t < now - 60 * DAY) t = Date.UTC(y + 1, mo - 1, d, 23, 59) + BO_TZ;
  if (y < 2015 || y > 2100) return null;
  return t;
}

/** "25", "25.50", "Bs25", "$10", "US$ 10" pegado o "10usd" → centavos. */
function parsePrice(s: string): Cents | null {
  const m = s.toLowerCase().match(/^(?:bs\.?|us\$|\$|usd)?(\d{1,6})(?:\.(\d{1,2}))?(?:bs|usd|\$)?$/);
  if (!m) return null;
  return +m[1] * 100 + (m[2] ? +m[2].padEnd(2, "0") : 0);
}

const looksLikeDate = (t: string) => /^\d{1,4}[/-]\d{1,2}([/-]\d{1,4})?$/.test(t);

function reseller(e: Engine, actor: Actor, customerId: unknown): Customer {
  authorize(actor, "inventory.manage");
  authorize(actor, "assignment.replace");
  const c = typeof customerId === "string" ? e.s.customers[customerId] : undefined;
  if (!c) throw new DomainError("NOT_FOUND", "Revendedor inexistente");
  if (c.kind !== "reseller") throw new DomainError("VALIDATION", "Esto es solo para revendedores");
  return c;
}

/** El servicio es de este revendedor (a su nombre o de un cliente suyo). */
const isHis = (e: Engine, r: Customer, customerId: Id) => customerId === r.id || e.s.customers[customerId]?.resellerId === r.id;

function plan(e: Engine, r: Customer, raw: unknown): Planned[] {
  const text = String(raw ?? "");
  if (text.length > MAX_TEXT) throw new DomainError("VALIDATION", "La lista es muy larga: cargala en partes");
  const lines = text.split(/\r?\n/).map((l, i) => ({ l: l.trim(), n: i + 1 })).filter((x) => x.l);
  if (!lines.length) throw new DomainError("VALIDATION", "Pegá al menos una cuenta (una por línea)");
  if (lines.length > MAX_LINES) throw new DomainError("VALIDATION", `Hasta ${MAX_LINES} cuentas por vez`);
  const now = e.now();
  const usd = isUsd(e, r);
  const st = e.s;
  // Índices: cuentas activas por correo y servicios activos por perfil (una sola pasada por el estado).
  const byEmail = new Map<string, Account[]>();
  for (const a of Object.values(st.accounts)) {
    const k = key(a.email);
    (byEmail.get(k) ?? byEmail.set(k, []).get(k)!).push(a);
  }
  const slotsOf = new Map<Id, Slot[]>();
  for (const s of Object.values(st.slots)) (slotsOf.get(s.accountId) ?? slotsOf.set(s.accountId, []).get(s.accountId)!).push(s);
  const holder = new Map<Id, Assignment>();
  for (const a of Object.values(st.assignments)) if (a.status === "active") holder.set(a.slotId, a);

  const seen = new Set<string>();
  return lines.map(({ l, n }): Planned => {
    // "25,50" al final = 25.50 (la coma también separa; solo se toma como decimal si va pegada al número final).
    const parts = l.replace(/(^|[\s;|])(\d+),(\d{2})$/, "$1$2.$3").split(/[\s,;|]+/).filter(Boolean);
    const email = key(parts.shift() ?? "");
    const row: BulkRow = { line: n, email, ok: false, status: "dato_malo", warnings: [] };
    const bad = (status: BulkStatus, reason: string): Planned => (Object.assign(row, { ok: false, status, reason }), { row });
    if (!email || email.length > 120) return bad("dato_malo", "Falta el correo");
    let exp: number | undefined, price: Cents | undefined;
    for (const t of parts) {
      if (/^(bs\.?|us\$|\$|usd)$/i.test(t)) continue; // "Bs 25", "US$ 10"
      if (looksLikeDate(t)) {
        if (exp !== undefined) return bad("dato_malo", "Tiene dos fechas: dejá solo la de vencimiento");
        const d = parseDay(now, t);
        if (d === null) return bad("fecha_mala", `Fecha inválida «${t.slice(0, 12)}»: usá dd/mm o dd/mm/aaaa`);
        exp = d;
      } else {
        const p = parsePrice(t);
        if (p === null || price !== undefined) return bad("dato_malo", `No entiendo «${t.slice(0, 20)}»: va correo, fecha (dd/mm) y precio`);
        price = p;
      }
    }
    if (price !== undefined) row.price = price;
    if (seen.has(email)) return bad("repetida", "Está repetida en la lista");
    seen.add(email);

    const accs = byEmail.get(email) ?? [];
    const active = accs.filter((a) => a.status === "active");
    if (!accs.length) return bad("no_existe", "No existe esa cuenta: cargala primero en Cuentas");
    if (!active.length) return bad("no_existe", "Esa cuenta está dada de baja");

    // ¿Ya es suya? (a su nombre o de un cliente suyo): no se duplica.
    for (const a of active) {
      const mine = (slotsOf.get(a.id) ?? []).find((s) => holder.has(s.id) && isHis(e, r, holder.get(s.id)!.customerId));
      if (mine) {
        Object.assign(row, { product: st.products[a.productId]?.name ?? "", profile: mine.label, expiresAt: holder.get(mine.id)!.customerExpiresAt });
        return bad("ya_suya", "Ya es suya: no se carga de nuevo");
      }
    }

    // Un perfil libre. Si el mismo correo está libre en dos servicios distintos, no adivinamos.
    const free = active.map((a) => ({ a, s: (slotsOf.get(a.id) ?? []).find((x) => x.status === "available") })).filter((x) => x.s);
    const prods = [...new Set(free.map((x) => x.a.productId))];
    if (prods.length > 1) return bad("dato_malo", `Ese correo está en varios servicios (${prods.map((p) => st.products[p]?.name ?? p).join(" y ")}): cargala desde Vender`);
    if (!free.length) {
      const taken = active.some((a) => (slotsOf.get(a.id) ?? []).some((s) => s.status === "assigned"));
      // Nunca se dice de quién es.
      if (taken) return bad("de_otro", "Es de otro cliente");
      return bad("sin_lugar", "No tiene perfiles libres (en cuarentena o reservados)");
    }
    const { a: account, s: slot } = free[0];
    const product = st.products[account.productId];
    if (!product) return bad("no_existe", "El servicio de esa cuenta ya no existe");
    const expiresAt = exp ?? now + (product.durationDays || 30) * DAY;
    Object.assign(row, { ok: true, status: "nueva", product: product.name, profile: slot!.label, expiresAt, ...(exp === undefined ? { defaultDate: true } : {}) });
    if (expiresAt < now) row.warnings.push("Ya venció: queda abierta hasta que le pongas fecha o la renueves");
    if (expiresAt > account.supplierExpiresAt) row.warnings.push("Vence después que la cuenta con el proveedor");
    if (price !== undefined && usd) row.warnings.push("Precio en US$: queda anotado en la nota del Control");
    return { row, slot: slot!, product, account };
  });
}

const summary = (rows: BulkRow[]) => ({ ok: rows.filter((x) => x.ok).length, skipped: rows.filter((x) => !x.ok).length });

/** Vista previa: no guarda nada. */
export function preview(e: Engine, actor: Actor, customerId: Id, text: unknown) {
  const r = reseller(e, actor, customerId);
  const rows = plan(e, r, text).map((p) => p.row);
  return { name: r.name, currency: isUsd(e, r) ? "USD" as const : "BOB" as const, rows, ...summary(rows) };
}

/** Guarda las líneas buenas en una sola transacción. Devuelve cuántas cargó y cuáles saltó con su motivo. */
export function apply(e: Engine, actor: Actor, customerId: Id, text: unknown) {
  const r = reseller(e, actor, customerId);
  return e.tx(() => {
    const planned = plan(e, r, text);
    const usd = isUsd(e, r);
    const ids: Id[] = [];
    for (const p of planned) {
      if (!p.row.ok || !p.slot || !p.product) continue;
      // Doble chequeo dentro de la transacción: un perfil nunca se asigna dos veces.
      if (p.slot.status !== "available") { Object.assign(p.row, { ok: false, status: "de_otro", reason: "Es de otro cliente" }); continue; }
      const control: RentalControl = {};
      if (p.row.price !== undefined) {
        // Revendedor en dólares: el acordado va a "Te paga US$" (priceUsd); en Bs, al precio del Control.
        if (usd) control.priceUsd = p.row.price;
        else control.price = p.row.price;
      }
      const a = assignWithoutCharge(e, actor, { customerId: r.id, productId: p.product.id, slot: p.slot, expiresAt: p.row.expiresAt!, control, note: `cargado en lote (línea ${p.row.line})` });
      ids.push(a.id);
    }
    const rows = planned.map((p) => p.row);
    const skipped = rows.filter((x) => !x.ok).map((x) => ({ line: x.line, email: x.email, status: x.status, reason: x.reason ?? "" }));
    e.audit(actor, "assignment.bulk_load", "customer", r.id, { added: ids.length, skipped: skipped.length, assignments: ids.join(",").slice(0, 2000) });
    return { added: ids.length, skipped, assignmentIds: ids };
  });
}
