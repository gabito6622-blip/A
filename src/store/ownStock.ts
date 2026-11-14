// "📦 Mis cuentas propias": productos y cuentas que el revendedor consigue por su lado (Flujo TV y
// similares), que NO son del inventario de la tienda. Es su cuaderno de stock: carga sus productos,
// sus cuentas (con contraseña o PIN), las reparte entre SUS clientes, renueva, libera y cobra.
//
// Aislamiento: todo vive en `state.ownStock[<id del revendedor>]` y solo lo lee o toca ese revendedor.
// El dueño y su equipo no ven nombres, teléfonos ni contraseñas: a lo sumo cuántos productos y cuentas
// tiene cada revendedor (`ownCounts`). La auditoría guarda ids y cantidades, nunca contraseñas.
// Las contraseñas se guardan cifradas con GS_DATA_KEY igual que las de la tienda (src/server/db.ts
// reconoce las cuentas propias por `own: true`).
// Plata: todo va en la moneda del revendedor (country.ts), enteros ×100.
import { randomBytes } from "node:crypto";
import type { Actor, Cents, Customer, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { phoneWithCountry } from "./catalog.js";
import { currencyOf, localeOf, maxAmount, money, normAmount } from "./country.js";
import { DAY } from "./time.js";
import { LATE_FROM_EXPIRY_MAX_DAYS } from "./cobrarBien.js";

export type OwnKind = "full" | "profiles" | "line";

/** Un producto propio del revendedor ("Flujo TV 30 días"). */
export interface OwnProduct {
  id: Id;
  name: string;
  /** Emoji que lo identifica (si no sube logo). */
  emoji?: string;
  logoFileRef?: string;
  durationDays: number;
  /** Precio a sus clientes, en su moneda. */
  price: Cents;
  /** Cuenta completa (1 cliente), perfiles con N cupos, o línea / usuario (1 cliente). */
  kind: OwnKind;
  /** Cupos por cuenta (solo "profiles"; las demás, 1). */
  slots: number;
  /** Mostrarlo en su página /r/<slug> para que se lo pidan por WhatsApp. */
  onPage?: boolean;
  /** Datos para el cliente (IPTV como Flujo TV): servidor o URL, app, pantallas e instrucciones. Van en "Mandar acceso". */
  server?: string;
  app?: string;
  screens?: number;
  guide?: string;
  createdAt: number;
}

/** Una cuenta propia. `own: true` es lo que usa db.ts para cifrar `password` al guardar. */
export interface OwnAccount {
  id: Id;
  own: true;
  productId: Id;
  /** Usuario o correo. */
  user: string;
  /** Contraseña o PIN (cifrada al guardarse; nunca en auditoría ni en el panel del dueño). */
  password: string;
  slots: number;
  /** Cuándo vence con SU proveedor. */
  providerExpiresAt?: number;
  note?: string;
  /** «Se cayó esta cuenta»: no se ofrece ni se asignan cupos hasta que la marque «volvió» (ownPlata.ts). */
  down?: { at: number; note?: string };
  /** Lo que le paga a su proveedor por período (para «Mis ganancias»), en su moneda. */
  cost?: Cents;
  createdAt: number;
}

/** Un cupo de una cuenta propia que tiene un cliente del revendedor. */
export interface OwnSale {
  id: Id;
  accountId: Id;
  /** Número de cupo (1..slots). Un cupo nunca se asigna dos veces. */
  slot: number;
  name: string;
  phone: string;
  /** Si es un cliente que ya tenía en GaboHub. */
  customerId?: Id;
  expiresAt: number;
  price?: Cents;
  pay: "pagado" | "pendiente";
  note?: string;
  createdAt: number;
  /** Link de cobro (/c/<token>), igual que en el cuaderno de perfiles. */
  link?: { token: string; at: number };
  /** Prueba gratis (IPTV: 24 h): no cuenta como venta ni como deuda hasta que se renueva. */
  trial?: boolean;
  /** Sus cobros ya están en el libro (`ledger`). Las ventas viejas se pasan solas la primera vez que se toca algo. */
  led?: true;
  /** Para «deshacer» el último «Renovó» (unos segundos). */
  undo?: { op: string; at: number; prevExp: number; prevTrial?: boolean; prevPrice?: Cents };
}

/** Un movimiento del libro de cobros: cada período es un cargo y cada cobro un pago (puede ser parcial). */
export interface OwnEntry {
  id: Id;
  saleId: Id;
  kind: "cargo" | "pago" | "perdon";
  amount: Cents;
  at: number;
  /** Período que cubre un cargo. */
  from?: number;
  to?: number;
  /** Operación que lo creó (para «deshacer»). */
  op?: string;
  note?: string;
}

/** «Pagué a mi proveedor»: lo que salió de su bolsillo por una cuenta propia. */
export interface OwnProvPay { id: Id; accountId: Id; productId: Id; user: string; amount: Cents; months: number; at: number; to?: number; note?: string }

/** Un cliente que liberó: queda acá para su deuda («Quién me debe») y para «Que vuelvan». */
export type OwnGone = Omit<OwnSale, "link" | "undo"> & { releasedAt: number; productId: Id; product: string; user: string; debtAction?: "fiado" | "perdon" };

export interface OwnStockBook {
  products: OwnProduct[];
  accounts: OwnAccount[];
  sales: OwnSale[];
  /** Libro de cobros (cargos, pagos y perdones) de sus clientes, activos y liberados. */
  ledger?: OwnEntry[];
  /** Pagos a sus proveedores. */
  provPays?: OwnProvPay[];
  /** Clientes liberados (con o sin deuda). */
  gone?: OwnGone[];
  /** «Ya le escribí» de «Que vuelvan»: clave → cuándo. */
  back?: Record<string, number>;
}

const MAX_PRODUCTS = 50, MAX_ACCOUNTS = 1000, MAX_SALES = 5000, MAX_SLOTS = 10, MAX_LINES = 200;

/* ---------------- quién es y su cuaderno ---------------- */
export function me(e: Engine, actor: Actor): Customer {
  authorize(actor, "reseller.own_stock");
  if (!actor.customerId) throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const c = e.get("customers", actor.customerId);
  if (c.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  return c;
}
/** Su cuaderno (lo crea vacío la primera vez; debe llamarse dentro de tx para escribir). */
export function book(e: Engine, id: Id): OwnStockBook {
  const all = (e.s.ownStock ??= {});
  return (all[id] ??= { products: [], accounts: [], sales: [] });
}
export const peek = (e: Engine, id: Id): OwnStockBook => e.s.ownStock?.[id] ?? { products: [], accounts: [], sales: [] };

export const productOf = (b: OwnStockBook, id: unknown) => {
  const p = b.products.find((x) => x.id === id);
  if (!p) throw new DomainError("NOT_FOUND", "Ese producto no existe");
  return p;
};
export const accountOf = (b: OwnStockBook, id: unknown) => {
  const a = b.accounts.find((x) => x.id === id);
  if (!a) throw new DomainError("NOT_FOUND", "Esa cuenta no existe");
  return a;
};
export const saleOf = (b: OwnStockBook, id: unknown) => {
  const s = b.sales.find((x) => x.id === id);
  if (!s) throw new DomainError("NOT_FOUND", "Ese cliente no está en tus cuentas propias");
  return s;
};

/* ---------------- validaciones ---------------- */
export const text = (v: unknown, max: number, what: string, required = false) => {
  const t = String(v ?? "").trim();
  if (required && !t) throw new DomainError("VALIDATION", `Escribí ${what}`);
  if (t.length > max) throw new DomainError("VALIDATION", `${what[0].toUpperCase()}${what.slice(1)}: hasta ${max} letras`);
  return t;
};
export function amount(e: Engine, c: Customer, v: unknown, what = "Precio"): Cents {
  const n = normAmount(Number(v), currencyOf(e, c));
  if (!Number.isInteger(n) || n < 0 || n > maxAmount(e, c)) throw new DomainError("VALIDATION", `${what} inválido`);
  return n;
}
export function date(e: Engine, v: unknown, what: string): number {
  const t = Number(v);
  if (!Number.isFinite(t) || t < e.now() - 400 * DAY || t > e.now() + 800 * DAY) throw new DomainError("VALIDATION", `Fecha ${what} inválida`);
  return t;
}
/** Usuario, correo, contraseña o PIN: sin espacios a los costados, sin saltos de línea. */
function secretish(v: unknown, what: string, max = 120): string {
  const t = String(v ?? "").trim();
  if (!t) throw new DomainError("VALIDATION", `Escribí ${what}`);
  if (t.length > max || /[\r\n\t]/.test(t)) throw new DomainError("VALIDATION", `${what[0].toUpperCase()}${what.slice(1)} inválido`);
  return t;
}

/* ---------------- lectura (solo él) ---------------- */
/** Cupos libres de una cuenta. */
const freeSlots = (b: OwnStockBook, a: OwnAccount) => {
  const used = new Set(b.sales.filter((s) => s.accountId === a.id).map((s) => s.slot));
  return Array.from({ length: a.slots }, (_, i) => i + 1).filter((n) => !used.has(n));
};
/** Por qué una cuenta no se puede vender: se cayó o venció con su proveedor (null = se puede). */
export const blockedWhy = (a: OwnAccount, now: number): "caida" | "vencida" | null =>
  a.down ? "caida" : a.providerExpiresAt && a.providerExpiresAt < now ? "vencida" : null;
/** Cupos que se pueden ofrecer o asignar: ninguno si la cuenta se cayó o venció con su proveedor. */
export const sellableSlots = (b: OwnStockBook, a: OwnAccount, now: number) => (blockedWhy(a, now) ? [] : freeSlots(b, a));
export const BLOCKED_MSG = { caida: "Esta cuenta se cayó: usá otra o marcala «volvió»", vencida: "Esta cuenta venció con tu proveedor: anotá que la pagaste o usá otra" } as const;

/* ---------------- libro de cobros ---------------- */
/** Deuda de cada venta (activa o liberada), según el libro. Las ventas viejas usan su «pendiente». */
export function debts(b: OwnStockBook): Map<Id, Cents> {
  const m = new Map<Id, Cents>();
  for (const x of b.ledger ?? []) m.set(x.saleId, (m.get(x.saleId) ?? 0) + (x.kind === "cargo" ? x.amount : -x.amount));
  for (const s of [...b.sales, ...(b.gone ?? [])]) if (!s.led) m.set(s.id, s.pay === "pendiente" && !s.trial ? s.price ?? 0 : 0);
  for (const [k, v] of m) if (v < 0) m.set(k, 0);
  return m;
}
export const debtOf = (b: OwnStockBook, id: Id) => debts(b).get(id) ?? 0;
/** Pasa al libro las ventas de antes (un cargo por su precio y, si estaba pagada, su pago). Dentro de tx. */
export function ensureLedger(e: Engine, b: OwnStockBook) {
  const L = (b.ledger ??= []);
  for (const s of [...b.sales, ...(b.gone ?? [])]) {
    if (s.led) continue;
    if (!s.trial && (s.price ?? 0) > 0) {
      L.push({ id: e.id("ole"), saleId: s.id, kind: "cargo", amount: s.price!, at: s.createdAt, to: s.expiresAt, note: "Antes del libro" });
      if (s.pay === "pagado") L.push({ id: e.id("ole"), saleId: s.id, kind: "pago", amount: s.price!, at: s.createdAt, note: "Antes del libro" });
    }
    s.led = true;
  }
  return L;
}
/** Anota un movimiento (dentro de tx) y deja «pagado/pendiente» al día. */
export function entry(e: Engine, b: OwnStockBook, s: OwnSale | OwnGone, x: Omit<OwnEntry, "id" | "saleId" | "at"> & { at?: number }) {
  const L = ensureLedger(e, b);
  if (L.length >= 200_000) throw new DomainError("VALIDATION", "Tu libro de cobros está lleno");
  L.push({ id: e.id("ole"), saleId: s.id, at: e.now(), ...x });
  syncPay(b, s);
}
export function syncPay(b: OwnStockBook, s: OwnSale | OwnGone) { s.pay = debtOf(b, s.id) > 0 ? "pendiente" : "pagado"; }
/** Desde cuándo corre una renovación: si venció hace poco (el mismo plazo que el panel del dueño), desde el vencimiento. */
export const renewFrom = (exp: number, now: number) => (exp >= now || now - exp <= LATE_FROM_EXPIRY_MAX_DAYS * DAY ? exp : now);

/** Todo su cuaderno, para su pestaña. Incluye sus contraseñas: son suyas y las necesita para mandar el acceso. */
export function view(e: Engine, actor: Actor) {
  const c = me(e, actor);
  const b = peek(e, c.id);
  const now = e.now();
  const prodName = (id: Id) => b.products.find((p) => p.id === id)?.name ?? "";
  const accById = new Map(b.accounts.map((a) => [a.id, a]));
  const owe = debts(b);
  const sales = b.sales.slice().sort((x, y) => x.expiresAt - y.expiresAt).map((s) => {
    const a = accById.get(s.accountId);
    const { link, undo, led, ...rest } = s;
    void undo; void led;
    const blocked = a ? blockedWhy(a, now) : null;
    return { ...rest, productId: a?.productId ?? "", product: prodName(a?.productId ?? ""), user: a?.user ?? "", debt: owe.get(s.id) ?? 0, ...(blocked ? { blocked } : {}), ...(link ? { linkToken: link.token } : {}) };
  });
  // Liberados que todavía le deben (van a «Quién me debe»).
  const goneOwing = (b.gone ?? []).filter((g) => (owe.get(g.id) ?? 0) > 0).map((g) => ({ id: g.id, name: g.name, phone: g.phone, product: g.product, price: g.price ?? null, releasedAt: g.releasedAt, expiresAt: g.expiresAt, debt: owe.get(g.id) ?? 0 }));
  const week = now + 7 * DAY;
  return {
    currency: currencyOf(e, c),
    dial: localeOf(e, c).dial,
    products: b.products.map(({ logoFileRef, ...p }) => {
      const accs = b.accounts.filter((a) => a.productId === p.id);
      return { ...p, hasLogo: !!logoFileRef, accounts: accs.length, free: accs.reduce((t, a) => t + sellableSlots(b, a, now).length, 0), used: b.sales.filter((s) => accById.get(s.accountId)?.productId === p.id).length };
    }),
    // `free`: cupos que se pueden dar (ninguno si se cayó o venció con su proveedor); `empty`: los vacíos de verdad.
    accounts: b.accounts.map((a) => ({ id: a.id, productId: a.productId, product: prodName(a.productId), user: a.user, password: a.password, slots: a.slots, free: sellableSlots(b, a, now), empty: freeSlots(b, a).length, blocked: blockedWhy(a, now), down: a.down ? { at: a.down.at, note: a.down.note ?? "" } : null, cost: a.cost ?? null, providerExpiresAt: a.providerExpiresAt ?? null, note: a.note ?? "" })),
    sales,
    gone: goneOwing,
    // Vencen esta semana: sus clientes y las cuentas con su proveedor (incluye lo ya vencido hace poco).
    soon: {
      clients: sales.filter((s) => s.expiresAt <= week && s.expiresAt >= now - 7 * DAY).map((s) => s.id),
      provider: b.accounts.filter((a) => a.providerExpiresAt && a.providerExpiresAt <= now + 3 * DAY && a.providerExpiresAt >= now - 30 * DAY).map((a) => a.id),
    },
    totals: {
      clients: sales.length,
      // Lo que le deben de verdad: activos y liberados que pasó a «Quién me debe» (deudas que no se borran).
      owed: [...owe.values()].reduce((t, v) => t + v, 0),
      trials: sales.filter((s) => s.trial && s.expiresAt > now).length,
      // «Cobrás por mes»: solo los que siguen activos (los vencidos hace más del plazo ya no cuentan).
      monthly: sales.filter((s) => !s.trial && s.expiresAt >= now - LATE_FROM_EXPIRY_MAX_DAYS * DAY).reduce((t, s) => { const d = accById.get(s.accountId); const days = b.products.find((p) => p.id === d?.productId)?.durationDays ?? 30; return t + Math.round(((s.price ?? 0) * 30) / Math.max(1, days)); }, 0),
    },
  };
}

/* ---------------- productos ---------------- */
export function saveProduct(e: Engine, actor: Actor, raw: Record<string, unknown>) {
  const c = me(e, actor);
  const name = text(raw.name, 40, "el nombre del producto", true);
  const emoji = text(raw.emoji, 8, "el emoji");
  if (emoji && /[<>"'&\w]/.test(emoji)) throw new DomainError("VALIDATION", "El ícono va con un emoji (ej.: 📺)");
  const durationDays = Number(raw.durationDays ?? 30);
  if (!Number.isInteger(durationDays) || durationDays < 1 || durationDays > 400) throw new DomainError("VALIDATION", "Duración: de 1 a 400 días");
  const price = amount(e, c, raw.price ?? 0);
  const kind = String(raw.kind ?? "full") as OwnKind;
  if (!["full", "profiles", "line"].includes(kind)) throw new DomainError("VALIDATION", "Elegí el tipo: cuenta completa, perfiles o línea");
  const slots = kind === "profiles" ? Number(raw.slots ?? 4) : 1;
  if (!Number.isInteger(slots) || slots < 1 || slots > MAX_SLOTS) throw new DomainError("VALIDATION", `Cupos por cuenta: de 1 a ${MAX_SLOTS}`);
  const server = text(raw.server, 200, "el servidor o URL");
  const app = text(raw.app, 40, "la app");
  const guide = text(raw.guide, 300, "las instrucciones");
  const screens = raw.screens === undefined || raw.screens === null || raw.screens === "" ? undefined : Number(raw.screens);
  if (screens !== undefined && !(Number.isInteger(screens) && screens >= 1 && screens <= 10)) throw new DomainError("VALIDATION", "Pantallas: de 1 a 10");
  return e.tx(() => {
    const b = book(e, c.id);
    const id = typeof raw.id === "string" && raw.id ? raw.id : "";
    let p = id ? productOf(b, id) : undefined;
    if (b.products.some((x) => x.id !== p?.id && x.name.toLowerCase() === name.toLowerCase())) throw new DomainError("VALIDATION", `Ya tenés un producto “${name}”`);
    if (!p) {
      if (b.products.length >= MAX_PRODUCTS) throw new DomainError("VALIDATION", `Hasta ${MAX_PRODUCTS} productos propios`);
      p = { id: e.id("opr"), name, durationDays, price, kind, slots, createdAt: e.now() };
      b.products.push(p);
    } else if (p.kind !== kind && b.accounts.some((a) => a.productId === p!.id)) {
      throw new DomainError("VALIDATION", "Este producto ya tiene cuentas: no le podés cambiar el tipo");
    }
    // Los cupos del producto son los de las cuentas NUEVAS; las que ya tiene conservan los suyos.
    Object.assign(p, { name, durationDays, price, kind, slots });
    if (emoji) p.emoji = emoji; else delete p.emoji;
    if (raw.onPage !== undefined) p.onPage = !!raw.onPage;
    for (const [k, v] of [["server", server], ["app", app], ["guide", guide]] as const) { if (v) p[k] = v; else if (raw[k] !== undefined) delete p[k]; }
    if (screens !== undefined) p.screens = screens; else if (raw.screens !== undefined) delete p.screens;
    e.audit(actor, id ? "own.product_update" : "own.product_create", "customer", c.id, { product: p.id });
    const { logoFileRef, ...out } = p;
    return { ...out, hasLogo: !!logoFileRef };
  });
}

export function deleteProduct(e: Engine, actor: Actor, productId: Id): { ok: true; logo?: string } {
  const c = me(e, actor);
  return e.tx(() => {
    const b = book(e, c.id);
    const p = productOf(b, productId);
    if (b.accounts.some((a) => a.productId === p.id)) throw new DomainError("VALIDATION", "Primero borrá o mové sus cuentas");
    b.products = b.products.filter((x) => x !== p);
    e.audit(actor, "own.product_delete", "customer", c.id, { product: p.id });
    return { ok: true as const, ...(p.logoFileRef ? { logo: p.logoFileRef } : {}) };
  });
}

/** Cambia el logo (archivo ya validado por el servidor). Devuelve el anterior para borrarlo. */
export function setProductLogo(e: Engine, actor: Actor, productId: Id, fileRef: string | null): string | undefined {
  const c = me(e, actor);
  return e.tx(() => {
    const p = productOf(book(e, c.id), productId);
    const old = p.logoFileRef;
    if (fileRef) p.logoFileRef = fileRef; else delete p.logoFileRef;
    e.audit(actor, "own.product_logo", "customer", c.id, { product: p.id, removed: !fileRef });
    return old;
  });
}

/** Archivo del logo de SU producto (para mostrárselo a él). */
export function productLogo(e: Engine, actor: Actor, productId: Id): string | undefined {
  const c = me(e, actor);
  return peek(e, c.id).products.find((p) => p.id === productId)?.logoFileRef;
}

/* ---------------- cuentas ---------------- */
/** "dd/mm" o "dd/mm/aaaa" → fecha (la próxima vez que llegue ese día si no dice el año). */
function parseDay(e: Engine, s: string): number | null {
  const m = s.match(/^(\d{1,2})[/.-](\d{1,2})(?:[/.-](\d{2,4}))?$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2];
  if (d < 1 || d > 31 || mo < 1 || mo > 12) return null;
  const now = new Date(e.now());
  let y = m[3] ? +m[3] : now.getUTCFullYear();
  if (y < 100) y += 2000;
  // 23:59 en Bolivia/Paraguay (UTC-4): vence al final de ese día.
  let t = Date.UTC(y, mo - 1, d, 23, 59) + 4 * 3_600_000;
  if (new Date(Date.UTC(y, mo - 1, d)).getUTCDate() !== d) return null;
  if (!m[3] && t < e.now() - 60 * DAY) t = Date.UTC(y + 1, mo - 1, d, 23, 59) + 4 * 3_600_000;
  return t;
}

export interface PreviewRow { line: number; user: string; password: string; providerExpiresAt: number | null; ok: boolean; error?: string }

/** Entiende la lista pegada: una cuenta por línea, `usuario contraseña [dd/mm]`. No guarda nada. */
function parseList(e: Engine, b: OwnStockBook, productId: Id, raw: unknown): PreviewRow[] {
  const lines = String(raw ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) throw new DomainError("VALIDATION", "Pegá al menos una cuenta (una por línea)");
  if (lines.length > MAX_LINES) throw new DomainError("VALIDATION", `Hasta ${MAX_LINES} cuentas por vez`);
  const taken = new Set(b.accounts.filter((a) => a.productId === productId).map((a) => a.user.toLowerCase()));
  const seen = new Set<string>();
  return lines.map((l, i) => {
    const parts = l.split(/[\s;,|]+/).filter(Boolean);
    let exp: number | null = null;
    if (parts.length >= 3) {
      exp = parseDay(e, parts[parts.length - 1]);
      if (exp !== null) parts.pop();
    }
    const [user = "", password = "", ...extra] = parts;
    const row: PreviewRow = { line: i + 1, user, password, providerExpiresAt: exp, ok: true };
    const bad = (msg: string) => Object.assign(row, { ok: false, error: msg });
    if (!user || !password) return bad("Falta el usuario o la contraseña");
    if (extra.length) return bad("Sobran datos: va usuario, contraseña y la fecha (dd/mm)");
    if (user.length > 120 || password.length > 120) return bad("Usuario o contraseña muy largos");
    const k = user.toLowerCase();
    if (taken.has(k)) return bad("Ya la tenés cargada");
    if (seen.has(k)) return bad("Está repetida en la lista");
    seen.add(k);
    return row;
  });
}

export function previewAccounts(e: Engine, actor: Actor, productId: Id, raw: unknown) {
  const c = me(e, actor);
  const b = peek(e, c.id);
  productOf(b, productId);
  const rows = parseList(e, b, productId, raw);
  return { rows, ok: rows.filter((r) => r.ok).length, bad: rows.filter((r) => !r.ok).length };
}

/** Guarda las filas buenas de la lista (vuelve a revisarla acá: no confía en la vista previa del navegador). */
export function addAccountsBulk(e: Engine, actor: Actor, productId: Id, raw: unknown) {
  const c = me(e, actor);
  return e.tx(() => {
    const b = book(e, c.id);
    const p = productOf(b, productId);
    const rows = parseList(e, b, productId, raw).filter((r) => r.ok);
    if (!rows.length) throw new DomainError("VALIDATION", "No hay cuentas para guardar: revisá la vista previa");
    if (b.accounts.length + rows.length > MAX_ACCOUNTS) throw new DomainError("VALIDATION", `Hasta ${MAX_ACCOUNTS} cuentas propias`);
    for (const r of rows) {
      b.accounts.push({ id: e.id("oac"), own: true, productId: p.id, user: r.user, password: r.password, slots: p.slots, ...(r.providerExpiresAt ? { providerExpiresAt: r.providerExpiresAt } : {}), createdAt: e.now() });
    }
    e.audit(actor, "own.accounts_bulk", "customer", c.id, { product: p.id, count: rows.length });
    return { added: rows.length };
  });
}

/** Cargar o corregir una cuenta. Al editar, una contraseña vacía deja la que tenía. */
export function saveAccount(e: Engine, actor: Actor, raw: Record<string, unknown>) {
  const c = me(e, actor);
  const user = secretish(raw.user, "el usuario o correo");
  const id = typeof raw.id === "string" && raw.id ? raw.id : "";
  const password = id && !String(raw.password ?? "").trim() ? null : secretish(raw.password, "la contraseña o PIN");
  const providerExpiresAt = raw.providerExpiresAt === undefined || raw.providerExpiresAt === null || raw.providerExpiresAt === "" ? undefined : date(e, raw.providerExpiresAt, "con tu proveedor");
  const note = text(raw.note, 120, "la nota");
  const cost = raw.cost === undefined ? undefined : raw.cost === null || raw.cost === "" ? null : amount(e, c, raw.cost, "Costo");
  return e.tx(() => {
    const b = book(e, c.id);
    const p = productOf(b, raw.productId);
    let a = id ? accountOf(b, id) : undefined;
    if (b.accounts.some((x) => x.id !== a?.id && x.productId === p.id && x.user.toLowerCase() === user.toLowerCase())) throw new DomainError("VALIDATION", "Ya tenés esa cuenta cargada");
    const slots = p.kind === "profiles" ? Number(raw.slots ?? a?.slots ?? p.slots) : 1;
    if (!Number.isInteger(slots) || slots < 1 || slots > MAX_SLOTS) throw new DomainError("VALIDATION", `Cupos: de 1 a ${MAX_SLOTS}`);
    if (!a) {
      if (b.accounts.length >= MAX_ACCOUNTS) throw new DomainError("VALIDATION", `Hasta ${MAX_ACCOUNTS} cuentas propias`);
      a = { id: e.id("oac"), own: true, productId: p.id, user, password: password!, slots, createdAt: e.now() };
      b.accounts.push(a);
    } else {
      if (a.productId !== p.id && b.sales.some((s) => s.accountId === a!.id)) throw new DomainError("VALIDATION", "Esta cuenta tiene clientes: no la podés pasar a otro producto");
      const busy = b.sales.filter((s) => s.accountId === a!.id).reduce((m, s) => Math.max(m, s.slot), 0);
      if (slots < busy) throw new DomainError("VALIDATION", `El cupo ${busy} está ocupado: liberalo antes de bajar los cupos`);
      Object.assign(a, { productId: p.id, user, slots, ...(password ? { password } : {}) });
    }
    if (providerExpiresAt) a.providerExpiresAt = providerExpiresAt; else delete a.providerExpiresAt;
    if (note) a.note = note; else delete a.note;
    if (cost === null) delete a.cost; else if (cost !== undefined) a.cost = cost;
    e.audit(actor, id ? "own.account_update" : "own.account_create", "customer", c.id, { account: a.id, product: p.id });
    return { id: a.id };
  });
}

export function deleteAccount(e: Engine, actor: Actor, accountId: Id) {
  const c = me(e, actor);
  return e.tx(() => {
    const b = book(e, c.id);
    const a = accountOf(b, accountId);
    if (b.sales.some((s) => s.accountId === a.id)) throw new DomainError("VALIDATION", "Esta cuenta tiene clientes: liberalos primero");
    b.accounts = b.accounts.filter((x) => x !== a);
    e.audit(actor, "own.account_delete", "customer", c.id, { account: a.id });
    return { ok: true as const };
  });
}

/* ---------------- clientes (cupos) ---------------- */
/** Le da un cupo a un cliente suyo (uno que ya tiene en GaboHub o uno nuevo con nombre y WhatsApp). */
export function assign(e: Engine, actor: Actor, raw: Record<string, unknown>) {
  const c = me(e, actor);
  const loc = localeOf(e, c);
  const note = text(raw.note, 120, "la nota");
  const pay = raw.pay === "pendiente" ? "pendiente" : "pagado";
  // Prueba gratis (IPTV): unas horas, sin precio ni deuda. Se vuelve venta cuando la renueva.
  const trialHours = raw.trialHours === undefined || raw.trialHours === null || raw.trialHours === "" ? 0 : Number(raw.trialHours);
  if (trialHours && !(Number.isInteger(trialHours) && trialHours >= 1 && trialHours <= 72)) throw new DomainError("VALIDATION", "La prueba dura de 1 a 72 horas");
  return e.tx(() => {
    const b = book(e, c.id);
    const a = accountOf(b, raw.accountId);
    const p = productOf(b, a.productId);
    const why = blockedWhy(a, e.now());
    if (why) throw new DomainError("OUT_OF_STOCK", BLOCKED_MSG[why]);
    if (b.sales.length >= MAX_SALES) throw new DomainError("VALIDATION", `Hasta ${MAX_SALES} clientes en tus cuentas propias`);
    let name: string, phone: string, customerId: Id | undefined;
    if (raw.customerId) {
      const cl = e.s.customers[String(raw.customerId)];
      // Solo SUS clientes: un cliente de otro revendedor o de la tienda da lo mismo que uno que no existe.
      if (!cl || cl.resellerId !== c.id) throw new DomainError("NOT_FOUND", "Ese cliente no está en tu lista");
      ({ name, phone } = cl); customerId = cl.id;
    } else {
      name = text(raw.name, 80, "el nombre del cliente", true);
      phone = phoneWithCountry(String(raw.phone ?? ""), loc.dial);
      if (phone.replace(/\D/g, "").length < 7) throw new DomainError("VALIDATION", "Escribí el WhatsApp de tu cliente");
    }
    const free = freeSlots(b, a);
    const slot = raw.slot === undefined || raw.slot === null || raw.slot === "" ? free[0] : Number(raw.slot);
    if (slot === undefined) throw new DomainError("OUT_OF_STOCK", "Esta cuenta no tiene cupos libres");
    if (!Number.isInteger(slot) || slot < 1 || slot > a.slots) throw new DomainError("VALIDATION", "Ese cupo no existe en la cuenta");
    if (!free.includes(slot)) throw new DomainError("OUT_OF_STOCK", "Ese cupo ya lo tiene otro cliente");
    const expiresAt = trialHours ? e.now() + trialHours * 3_600_000 : raw.expiresAt ? date(e, raw.expiresAt, "de vencimiento") : e.now() + p.durationDays * DAY;
    const price = trialHours ? 0 : raw.price === undefined || raw.price === null || raw.price === "" ? p.price : amount(e, c, raw.price);
    const s: OwnSale = { id: e.id("osl"), accountId: a.id, slot, name, phone, ...(customerId ? { customerId } : {}), expiresAt, price, pay: trialHours ? "pagado" : pay, ...(note ? { note } : {}), ...(trialHours ? { trial: true } : {}), createdAt: e.now() };
    ensureLedger(e, b);
    b.sales.push(s);
    s.led = true;
    // El primer período es un cargo; si ya le pagó, también el pago.
    if (!trialHours && price > 0) {
      entry(e, b, s, { kind: "cargo", amount: price, from: e.now(), to: expiresAt });
      if (pay === "pagado") entry(e, b, s, { kind: "pago", amount: price });
    }
    e.audit(actor, "own.assign", "customer", c.id, { sale: s.id, account: a.id, slot });
    const { link, ...out } = s;
    return { ...out, product: p.name, user: a.user };
  });
}

/** Corrige vencimiento, precio, pago o nota de un cliente. */
export function updateSale(e: Engine, actor: Actor, saleId: Id, raw: Record<string, unknown>) {
  const c = me(e, actor);
  return e.tx(() => {
    const b = book(e, c.id);
    const s = saleOf(b, saleId);
    const L = ensureLedger(e, b);
    if (raw.expiresAt !== undefined) s.expiresAt = date(e, raw.expiresAt, "de vencimiento");
    if (raw.price !== undefined) {
      if (raw.price === null || raw.price === "") delete s.price; else s.price = amount(e, c, raw.price);
      // Corregir el precio corrige el cargo del período actual (el último); los anteriores quedan como estaban.
      const last = L.filter((x) => x.saleId === s.id && x.kind === "cargo").pop();
      if (last && s.price !== undefined && !s.trial) last.amount = s.price;
      syncPay(b, s);
    }
    if (raw.pay !== undefined) {
      if (!["pagado", "pendiente"].includes(String(raw.pay))) throw new DomainError("VALIDATION", "Estado de pago inválido");
      if (raw.pay === "pagado") {
        // «Me pagó»: paga todo lo que debe (para pagos parciales está «Me pagó» con monto, ownPlata.ts).
        const owe = debtOf(b, s.id);
        if (owe > 0) entry(e, b, s, { kind: "pago", amount: owe });
      } else if (debtOf(b, s.id) === 0) {
        // «Marcar pendiente»: deshace el último pago anotado (se tocó «Me pagó» por error).
        const i = L.map((x) => x.saleId === s.id && x.kind === "pago").lastIndexOf(true);
        if (i >= 0) L.splice(i, 1);
        else if (!s.trial && (s.price ?? 0) > 0) L.push({ id: e.id("ole"), saleId: s.id, kind: "cargo", amount: s.price!, at: e.now(), note: "Marcado pendiente" });
      }
      syncPay(b, s);
    }
    if (raw.note !== undefined) { const n = text(raw.note, 120, "la nota"); if (n) s.note = n; else delete s.note; }
    e.audit(actor, "own.sale_update", "customer", c.id, { sale: s.id, fields: Object.keys(raw).filter((k) => ["expiresAt", "price", "pay", "note"].includes(k)).join(",") });
    return { ok: true as const };
  });
}

/**
 * Renovó: suma la duración del producto y anota el período como un cargo. Si venció hace poco (mismo plazo que el
 * panel del dueño) corre desde el vencimiento, no desde hoy; si venció hace mucho, desde hoy. `paid`: «Sí, pagó»
 * (con `amount`, puede ser distinto del precio) o «Me paga después» (el cargo se suma a lo que ya debía).
 * Devuelve `undo` para deshacerlo unos segundos después.
 */
export function renew(e: Engine, actor: Actor, saleId: Id, opt: boolean | { paid?: unknown; amount?: unknown } = true) {
  const c = me(e, actor);
  const o = typeof opt === "boolean" ? { paid: opt } : opt ?? {};
  const paid = o.paid !== false;
  const paidAmount = paid && o.amount !== undefined && o.amount !== null && o.amount !== "" ? amount(e, c, o.amount, "Monto") : undefined;
  return e.tx(() => {
    const b = book(e, c.id);
    const s = saleOf(b, saleId);
    const a = b.accounts.find((x) => x.id === s.accountId);
    if (a?.down) throw new DomainError("INVALID_STATE", "Esta cuenta se cayó: primero mové a tu cliente a otra cuenta");
    const p = b.products.find((x) => x.id === a?.productId);
    const days = p?.durationDays ?? 30;
    ensureLedger(e, b);
    const op = e.id("oop");
    s.undo = { op, at: e.now(), prevExp: s.expiresAt, ...(s.trial ? { prevTrial: true } : {}), ...(s.price !== undefined ? { prevPrice: s.price } : {}) };
    // Una prueba gratis arranca hoy; una venta, desde su vencimiento si está dentro del plazo.
    const from = s.trial ? Math.max(s.expiresAt, e.now()) : renewFrom(s.expiresAt, e.now());
    s.expiresAt = from + days * DAY;
    // Renovar una prueba gratis la convierte en venta, al precio del producto.
    if (s.trial) { delete s.trial; if (!s.price) s.price = p?.price ?? 0; }
    const price = s.price ?? 0;
    if (price > 0) entry(e, b, s, { kind: "cargo", amount: price, from, to: s.expiresAt, op });
    const pay = paidAmount ?? (paid ? price : 0);
    if (pay > 0) {
      if (pay > debtOf(b, s.id)) throw new DomainError("VALIDATION", "Anotá como mucho lo que te debe");
      entry(e, b, s, { kind: "pago", amount: pay, op });
    }
    syncPay(b, s);
    e.audit(actor, "own.renew", "customer", c.id, { sale: s.id, paid: pay > 0 });
    return { expiresAt: s.expiresAt, from, pay: s.pay, debt: debtOf(b, s.id), undo: op };
  });
}

/** Deshace un «Renovó» recién hecho (hasta 2 minutos): vuelve la fecha y borra sus movimientos. */
export function undoRenew(e: Engine, actor: Actor, saleId: Id, op: unknown) {
  const c = me(e, actor);
  return e.tx(() => {
    const b = book(e, c.id);
    const s = saleOf(b, saleId);
    if (!s.undo || s.undo.op !== op || e.now() - s.undo.at > 120_000) throw new DomainError("INVALID_STATE", "Ya no se puede deshacer");
    b.ledger = (b.ledger ?? []).filter((x) => x.op !== op);
    s.expiresAt = s.undo.prevExp;
    if (s.undo.prevTrial) s.trial = true;
    if (s.undo.prevPrice !== undefined) s.price = s.undo.prevPrice; else delete s.price;
    delete s.undo;
    syncPay(b, s);
    e.audit(actor, "own.renew_undo", "customer", c.id, { sale: s.id });
    return { expiresAt: s.expiresAt, pay: s.pay, debt: debtOf(b, s.id) };
  });
}

/**
 * Libera el cupo (el cliente se fue). Si tenía link de cobro, deja de servir. Si todavía debe, frena:
 * `debt: "fiado"` lo pasa a «Quién me debe» (la deuda queda) y `debt: "perdonar"` la borra con un movimiento.
 * El cliente queda guardado como liberado (para su deuda y para «Que vuelvan»).
 */
export function release(e: Engine, actor: Actor, saleId: Id, opt: { debt?: unknown } = {}) {
  const c = me(e, actor);
  return e.tx(() => {
    const b = book(e, c.id);
    const s = saleOf(b, saleId);
    ensureLedger(e, b);
    const owe = debtOf(b, s.id);
    if (owe > 0 && opt.debt !== "fiado" && opt.debt !== "perdonar") {
      throw new DomainError("INVALID_STATE", `${s.name.split(" ")[0]} te debe ${money(owe, currencyOf(e, c))}: ¿lo pasás a Quién me debe o lo perdonás?`);
    }
    if (owe > 0 && opt.debt === "perdonar") entry(e, b, s, { kind: "perdon", amount: owe, note: "Perdonado al liberar" });
    const a = b.accounts.find((x) => x.id === s.accountId);
    const { link, undo, ...rest } = s;
    void undo;
    const g: OwnGone = { ...rest, releasedAt: e.now(), productId: a?.productId ?? "", product: b.products.find((p) => p.id === a?.productId)?.name ?? "", user: a?.user ?? "", ...(owe > 0 ? { debtAction: opt.debt === "fiado" ? "fiado" as const : "perdon" as const } : {}) };
    syncPay(b, g);
    b.sales = b.sales.filter((x) => x !== s);
    const G = (b.gone ??= []);
    G.push(g);
    // Hasta 3000 liberados: se van primero los más viejos que no deben nada.
    if (G.length > 3000) { const owing = debts(b); const i = G.findIndex((x) => !(owing.get(x.id) ?? 0)); if (i >= 0) G.splice(i, 1); }
    e.audit(actor, "own.release", "customer", c.id, { sale: s.id, ...(link ? { linkOff: true } : {}), ...(owe > 0 ? { debt: String(opt.debt) } : {}) });
    return { ok: true as const, debt: opt.debt === "fiado" ? owe : 0 };
  });
}

/* ---------------- link de cobro (/c/<token>) ---------------- */
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;
const newToken = () => randomBytes(24).toString("base64url");
/** token → [revendedor, venta]. Se rehace si un rollback reemplaza el estado (igual que subLinks.ts). */
const indexes = new WeakMap<Engine, { state: object; map: Map<string, [Id, Id]> }>();
function index(e: Engine) {
  let x = indexes.get(e);
  if (!x || x.state !== e.s) {
    const map = new Map<string, [Id, Id]>();
    for (const [rid, b] of Object.entries(e.s.ownStock ?? {})) for (const s of b.sales) if (s.link) map.set(s.link.token, [rid, s.id]);
    x = { state: e.s, map };
    indexes.set(e, x);
  }
  return x.map;
}

export function link(e: Engine, actor: Actor, saleId: Id) {
  const c = me(e, actor);
  return e.tx(() => {
    const s = saleOf(book(e, c.id), saleId);
    if (s.link) return { token: s.link.token, created: false };
    let token = newToken();
    while (index(e).has(token)) token = newToken();
    s.link = { token, at: e.now() };
    index(e).set(token, [c.id, s.id]);
    e.audit(actor, "own.link", "customer", c.id, { sale: s.id });
    return { token, created: true };
  });
}

export function revokeLink(e: Engine, actor: Actor, saleId: Id) {
  const c = me(e, actor);
  return e.tx(() => {
    const s = saleOf(book(e, c.id), saleId);
    if (!s.link) return { ok: true as const, revoked: false };
    index(e).delete(s.link.token);
    delete s.link;
    e.audit(actor, "own.link_revoke", "customer", c.id, { sale: s.id });
    return { ok: true as const, revoked: true };
  });
}

/** Resuelve un token de cuenta propia. `undefined` si no es de acá (lo prueba subLinks). */
function resolve(e: Engine, token: unknown) {
  const t = typeof token === "string" ? token : "";
  const hit = TOKEN_RE.test(t) ? index(e).get(t) : undefined;
  if (!hit) return undefined;
  const c = e.s.customers[hit[0]];
  const b = e.s.ownStock?.[hit[0]];
  const s = b?.sales.find((x) => x.id === hit[1]);
  if (!c || c.kind !== "reseller" || !b || !s || s.link?.token !== t) return undefined;
  const a = b.accounts.find((x) => x.id === s.accountId);
  const p = a && b.products.find((x) => x.id === a.productId);
  if (!a || !p) return undefined;
  return { c, s, p, a };
}

/** Revendedor, venta, cuenta y producto de un link de cuentas propias, o undefined (para codigosSolos.ts). */
export const ownLinkTarget = (e: Engine, token: unknown) => resolve(e, token);

/** Lo que ve su cliente: la MISMA lista cerrada de campos que el link del cuaderno (subLinks.publicView). */
export function linkView(e: Engine, token: unknown) {
  const r = resolve(e, token);
  if (!r) return undefined;
  const { c, s, p } = r;
  return {
    name: s.name.trim().split(/\s+/)[0] ?? "",
    label: p.kind === "profiles" ? `Perfil ${s.slot}` : "",
    product: p.name,
    expiresAt: s.expiresAt,
    price: s.price ?? null,
    pay: s.pay,
    seller: (c.shop?.title || c.name || "").trim(),
    sellerWhatsapp: String(c.shop?.whatsapp || c.phone || "").replace(/\D/g, ""),
    hasQr: !!(c.shop && !c.shop.blocked && c.shop.qrFileRef),
    currency: localeOf(e, c).symbol,
  };
}

/** QR del revendedor de ese link, o undefined. */
export function linkQr(e: Engine, token: unknown): string | undefined | null {
  const r = resolve(e, token);
  if (!r) return null; // no es un token de cuentas propias
  return r.c.shop && !r.c.shop.blocked ? r.c.shop.qrFileRef : undefined;
}

/* ---------------- para otros módulos ---------------- */
/** Lo único que ve el dueño: cuántos productos y cuentas propias tiene un revendedor. */
export function ownCounts(e: Engine, customerId: Id) {
  const b = e.s.ownStock?.[customerId];
  return { products: b?.products.length ?? 0, accounts: b?.accounts.length ?? 0 };
}

/** Sus productos marcados "en mi página", como tarjetas de su /r/<slug> (sin cuentas ni clientes). */
export function pageCards(e: Engine, c: Customer) {
  const b = e.s.ownStock?.[c.id];
  if (!b) return [];
  return b.products.filter((p) => p.onPage && p.price > 0).map((p) => {
    const free = b.accounts.filter((a) => a.productId === p.id).reduce((t, a) => t + sellableSlots(b, a, e.now()).length, 0);
    return { id: `op_${p.id}`, name: p.name, category: "Mis servicios", description: p.emoji ?? "", color: "#0ea5e9", hasImage: false, kind: "own" as const, durationDays: p.durationDays, price: p.price, available: Math.min(free, 20) };
  });
}

/** Precio de un producto propio en su página (para el cupón de su página), o undefined. */
export function pagePrice(e: Engine, c: Customer, cardId: string): Cents | undefined {
  if (!cardId.startsWith("op_")) return undefined;
  return pageCards(e, c).find((x) => x.id === cardId)?.price;
}

/* ---------------- combos con sus productos propios (resellerShop.ts) ---------------- */
/** Un combo de su página hecho solo con sus productos propios ("op_<id>"). Su precio va en SU moneda, sin convertir. */
export const isOwnCombo = (ids: readonly string[]) => ids.length > 0 && ids.every((id) => id.startsWith("op_"));
/** Nombres de las partes y cuántos combos se pueden armar con los cupos que hay (undefined si falta un producto). */
export function ownComboParts(e: Engine, c: Customer, ids: readonly string[]): { names: string[]; free: number } | undefined {
  const b = e.s.ownStock?.[c.id];
  if (!b || !isOwnCombo(ids)) return undefined;
  const ps = ids.map((id) => b.products.find((p) => p.id === id.slice(3)));
  if (ps.some((p) => !p)) return undefined;
  const now = e.now();
  const free = Math.min(...ps.map((p) => b.accounts.filter((a) => a.productId === p!.id).reduce((t, a) => t + sellableSlots(b, a, now).length, 0)));
  return { names: ps.map((p) => p!.name), free };
}
