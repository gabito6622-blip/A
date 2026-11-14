// Usuarios del panel y listados para el staff.
// El hash de contraseña lo calcula el servidor (scrypt); el núcleo solo lo guarda y nunca lo devuelve.
import type { Account, Actor, Assignment, Cents, Customer, Id, OrderStatus, StaffUser } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";
import { isUsd, rateNow, usdToBs } from "./usd.js";
import { diaFields } from "./dia.js";

const USERNAME = /^[a-z0-9._-]{3,32}$/;

export type PublicStaff = Omit<StaffUser, "passwordHash">;
const pub = ({ passwordHash: _h, ...rest }: StaffUser): PublicStaff => rest;

/** Crea el primer dueño. Solo funciona si todavía no hay ningún usuario del panel. */
export function bootstrapOwner(e: Engine, input: { username: string; name: string; passwordHash: string }): PublicStaff {
  if (Object.keys(e.s.staff).length) throw new DomainError("INVALID_STATE", "Ya existe un usuario del panel");
  return e.tx(() => insertStaff(e, { id: "system", role: "system" }, { ...input, role: "owner" }));
}

function insertStaff(e: Engine, actor: Actor, input: { username: string; name: string; role: StaffUser["role"]; passwordHash: string }): PublicStaff {
  const username = input.username.trim().toLowerCase();
  if (!USERNAME.test(username)) throw new DomainError("VALIDATION", "Usuario: 3 a 32 letras minúsculas, números, punto, guion");
  if (!input.name?.trim()) throw new DomainError("VALIDATION", "Falta el nombre");
  if (!input.passwordHash) throw new DomainError("VALIDATION", "Falta la contraseña");
  if (Object.values(e.s.staff).some((u) => u.username === username)) throw new DomainError("VALIDATION", "Ese usuario ya existe");
  const u: StaffUser = { id: e.id("stf"), username, name: input.name.trim(), role: input.role, passwordHash: input.passwordHash, active: true, createdAt: e.now() };
  e.s.staff[u.id] = u;
  e.audit(actor, "staff.create", "staff", u.id, { username, role: u.role });
  return pub(u);
}

/** Solo el dueño crea usuarios; nadie puede crear otro dueño desde el panel. */
export function createStaff(e: Engine, actor: Actor, input: { username: string; name: string; role: "admin" | "seller"; passwordHash: string }): PublicStaff {
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Solo el dueño crea usuarios del panel");
  if (input.role !== "admin" && input.role !== "seller") throw new DomainError("VALIDATION", "Rol inválido");
  return e.tx(() => insertStaff(e, actor, input));
}

export function setStaffActive(e: Engine, actor: Actor, staffId: Id, active: boolean): PublicStaff {
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Solo el dueño activa o desactiva usuarios");
  return e.tx(() => {
    const u = e.get("staff", staffId);
    if (u.role === "owner") throw new DomainError("FORBIDDEN", "No se puede desactivar al dueño");
    u.active = active;
    e.audit(actor, active ? "staff.enable" : "staff.disable", "staff", u.id);
    return pub(u);
  });
}

export function setStaffPassword(e: Engine, actor: Actor, staffId: Id, passwordHash: string): void {
  if (actor.id !== staffId && actor.role !== "owner") throw new DomainError("FORBIDDEN", "Solo podés cambiar tu propia contraseña");
  e.tx(() => {
    e.get("staff", staffId).passwordHash = passwordHash;
    e.audit(actor, "staff.password", "staff", staffId);
  });
}

/** Para el login: devuelve el usuario con hash. Solo lo usa el servidor, nunca sale por la API. */
export function findStaffForLogin(e: Engine, username: string): StaffUser | undefined {
  const u = Object.values(e.s.staff).find((x) => x.username === username.trim().toLowerCase());
  return u ? structuredClone(u) : undefined;
}

export function listStaff(e: Engine, actor: Actor): PublicStaff[] {
  if (actor.role !== "owner") throw new DomainError("FORBIDDEN", "Solo el dueño ve los usuarios del panel");
  return Object.values(e.s.staff).map(pub);
}

/**
 * Quién le paga a la tienda por un servicio: si el cliente es de un revendedor, paga el
 * revendedor (con su lista de precios); si no, el propio cliente.
 */
export function payerOf(e: Engine, customerId: Id): Customer | undefined {
  const c = e.s.customers[customerId];
  const r = c?.resellerId ? e.s.customers[c.resellerId] : undefined;
  return r ?? c;
}

/** Revendedor dueño del servicio: el propio cliente si es revendedor, o el revendedor de su cliente. */
export function resellerOf(e: Engine, customerId: Id): Customer | undefined {
  const c = e.s.customers[customerId];
  if (!c) return undefined;
  if (c.resellerId && e.s.customers[c.resellerId]) return e.s.customers[c.resellerId];
  return c.kind === "reseller" ? c : undefined;
}

/**
 * Lo que de verdad te pagan por un servicio en cada período: el precio acordado en Control,
 * si no el de la lista de quien paga (revendedor) y si no el precio del producto.
 * Es el mismo criterio que la Ficha del revendedor y que la renovación.
 */
export function effectivePrice(e: Engine, a: Pick<Assignment, "customerId" | "productId" | "control">): Cents {
  // Quien paga está en la lista en dólares: te paga en US$ (el acordado en el Control o el de su lista,
  // igual que al renovar); acá va en Bs con la tasa de hoy.
  const usd = payUsdOf(e, a), r = rateNow(e);
  if (usd !== undefined && r) return usdToBs(usd, r);
  if (a.control?.price !== undefined && a.control?.price !== null) return a.control.price;
  const payer = payerOf(e, a.customerId);
  const gid = payer?.priceGroupId ?? (payer?.kind === "reseller" ? "revendedor" : undefined);
  return (gid ? e.s.priceGroups[gid]?.prices[a.productId] : undefined) ?? e.s.products[a.productId]?.price ?? 0;
}

/**
 * Si quien paga un servicio está en la lista en dólares: lo que te paga por período en US$ (centavos de
 * dólar), el acordado en el Control (`priceUsd`) o el de su lista. `undefined` si paga en Bs o no tiene precio.
 */
export function payUsdOf(e: Engine, a: Pick<Assignment, "customerId" | "productId" | "control">): Cents | undefined {
  const who = payerOf(e, a.customerId) ?? e.s.customers[a.customerId];
  if (!who || !isUsd(e, who)) return undefined;
  return a.control?.priceUsd ?? e.s.priceGroups[who.priceGroupId]?.prices[a.productId];
}

/** Costo estimado de un perfil por período del producto: costo mensual de la cuenta ÷ perfiles vivos. */
export function unitCostOf(e: Engine, accountId: Id, productId: Id, slotCount?: number): Cents {
  const acc = e.s.accounts[accountId];
  if (!acc || !(acc.cost > 0)) return 0;
  const n = slotCount ?? (Object.values(e.s.slots).filter((s) => s.accountId === accountId && s.status !== "retired").length || 1);
  return Math.round(((acc.cost / n) * (e.s.products[productId]?.durationDays || 30)) / 30);
}

export function listOrders(e: Engine, actor: Actor, f: { status?: OrderStatus; customerId?: Id; limit?: number } = {}) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo staff");
  return Object.values(e.s.orders)
    .filter((o) => (!f.status || o.status === f.status) && (!f.customerId || o.customerId === f.customerId))
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, f.limit ?? 200)
    .map((o) => ({
      ...structuredClone(o),
      customerName: e.s.customers[o.customerId]?.name ?? "?",
      items: o.items.map((i) => ({ ...i, productName: e.s.products[i.productId]?.name ?? i.productId })),
    }));
}

export function listCustomers(e: Engine, actor: Actor, q = "") {
  authorize(actor, "customer.manage");
  const needle = q.trim().toLowerCase();
  // Un número se busca como venga (+591 681-18288, 681 18288): se comparan los últimos 8 dígitos.
  const digits = needle.replace(/\D/g, "");
  const tail = digits.length >= 6 ? digits.slice(-8) : "";
  return Object.values(e.s.customers)
    .filter((c) => !needle || `${c.name} ${c.phone} ${c.email ?? ""}`.toLowerCase().includes(needle) || (!!tail && c.phone.replace(/\D/g, "").includes(tail)))
    .map((c) => {
      const mine = Object.values(e.s.assignments).filter((a) => a.customerId === c.id && a.status === "active");
      const priceOf = (a: typeof mine[number]) => effectivePrice(e, a);
      const owed = mine.filter((a) => a.control?.payStatus && a.control.payStatus !== "pagado").reduce((s, a) => s + priceOf(a), 0);
      const renewals = Object.values(e.s.assignments).filter((a) => a.customerId === c.id).reduce((n, a) => n + (a.history?.filter((h) => h.event === "renewed").length ?? 0), 0);
      const spent = Object.values(e.s.orders).filter((o) => o.customerId === c.id && o.status === "fulfilled" && o.kind !== "topup").reduce((s, o) => s + o.total, 0);
      const nextExpiry = mine.length ? Math.min(...mine.map((a) => a.customerExpiresAt)) : null;
      return {
        ...structuredClone(c),
        balance: e.s.ledger.reduce((s, l) => (l.customerId === c.id ? s + l.amount : s), 0),
        // Moneda de su saldo: "USD" = lista en dólares (el panel lo muestra "US$ 13,00"). Gastó y Te debe, en Bs.
        currency: isUsd(e, c) ? "USD" as const : "BOB" as const,
        activeServices: mine.length, owed, spent, renewals, nextExpiry,
      };
    });
}

/** Servicios asignados (sin contraseñas) para Renovar, Recordatorios y Cuentas. */
export function listAssignments(e: Engine, actor: Actor, f: { customerId?: Id; productId?: Id; expiringWithinDays?: number } = {}) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo staff");
  const slotsPerAcc: Record<Id, number> = {};
  for (const s of Object.values(e.s.slots)) if (s.status !== "retired") slotsPerAcc[s.accountId] = (slotsPerAcc[s.accountId] ?? 0) + 1;
  return Object.values(e.s.assignments)
    .filter((a) => a.status === "active")
    .filter((a) => (!f.customerId || a.customerId === f.customerId) && (!f.productId || a.productId === f.productId))
    .filter((a) => f.expiringWithinDays === undefined || a.customerExpiresAt - e.now() <= f.expiringWithinDays * 86_400_000)
    .sort((a, b) => a.customerExpiresAt - b.customerExpiresAt)
    .map((a) => {
      const slot = e.s.slots[a.slotId];
      const acc = e.s.accounts[slot.accountId];
      const rev = resellerOf(e, a.customerId);
      return {
        id: a.id, customerId: a.customerId, customerName: e.s.customers[a.customerId]?.name, productId: a.productId,
        product: e.s.products[a.productId]?.name, email: acc.email, profile: slot.label, slotId: a.slotId,
        customerExpiresAt: a.customerExpiresAt, supplierExpiresAt: acc.supplierExpiresAt, lastReminderAt: a.lastReminderAt ?? null, holdOpen: !!a.holdOpen,
        passwordPending: !acc.password, customerPhone: e.s.customers[a.customerId]?.phone ?? "",
        startsAt: a.control?.startedAt ?? a.startsAt, control: a.control ?? {}, productPrice: e.s.products[a.productId]?.price ?? 0, durationDays: e.s.products[a.productId]?.durationDays ?? 30,
        // El costo y las notas internas de la cuenta son del dueño/admin: Atención (seller) no los ve.
        ...(actor.role === "seller" ? {} : { accountCost: acc.cost, accountNotes: acc.notes ?? "", estCost: unitCostOf(e, acc.id, a.productId, slotsPerAcc[acc.id]) }), customerKind: e.s.customers[a.customerId]?.kind ?? "customer",
        // Lo que de verdad te pagan (precio de quien paga) y de qué revendedor es el cliente.
        effectivePrice: effectivePrice(e, a),
        // Quien paga está en la lista en dólares: el Control muestra y anota su precio en US$.
        ...(isUsd(e, payerOf(e, a.customerId)) ? { payCurrency: "USD" as const, payUsd: payUsdOf(e, a) ?? null } : {}),
        resellerId: rev?.id ?? null, resellerName: rev?.name ?? null, resellerPhone: rev?.phone ?? "",
        // Día a día: cuándo se corta solo y la marca de «ya le avisé» (la misma en Mi secretaria y Recordatorios).
        ...diaFields(a),
      };
    });
}

/**
 * Datos completos para ENTREGAR un alquiler al cliente (correo, contraseña, perfil, PIN) y un
 * mensaje de WhatsApp listo para mandar. Solo staff; cada vez que se revela queda en la auditoría.
 */
/** "Cómo verlo": líneas de la guía de instalación del producto (app, enlace, pasos). */
function guideLines(prod: { guide?: { app?: string; link?: string; steps?: string } } | undefined): string[] {
  const g = prod?.guide;
  if (!g || (!g.app && !g.link && !g.steps)) return [];
  const out = ["", "📲 *Cómo verlo:*"];
  if (g.app) out.push(`App: ${g.app}`);
  if (g.link) out.push(`Descargala acá: ${g.link}`);
  if (g.steps) out.push(g.steps);
  return out;
}

/** Arma las líneas del mensaje de una línea IPTV según cómo se entrega. */
function iptvLines(iptv: NonNullable<Account["iptv"]>, user: string, secret: string): string[] {
  const out: string[] = [];
  if (iptv.mode === "m3u") out.push(`🔗 Lista M3U: ${secret || "(te la paso aparte)"}`);
  else if (iptv.mode === "code") out.push(`🔢 Código de activación: ${secret || "(te lo paso aparte)"}`);
  else {
    if (iptv.server) out.push(`🖥️ Servidor: ${iptv.server}`);
    out.push(`👤 Usuario: ${user}`);
    out.push(`🔑 Contraseña: ${secret || "(te la paso aparte)"}`);
  }
  if (iptv.mac) out.push(`📺 MAC: ${iptv.mac}`);
  if (iptv.connections) out.push(`📱 Dispositivos a la vez: ${iptv.connections}`);
  if (iptv.app) out.push(`⬇️ App para ver: ${iptv.app}`);
  return out;
}

export function deliveryInfo(e: Engine, actor: Actor, assignmentId: Id) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo staff");
  const a = e.s.assignments[assignmentId];
  if (!a || a.status !== "active") throw new DomainError("NOT_FOUND", "No se encontró ese alquiler activo");
  const slot = e.s.slots[a.slotId];
  const acc = e.s.accounts[slot.accountId];
  const cust = e.s.customers[a.customerId];
  const prod = e.s.products[a.productId];
  const expiresText = new Intl.DateTimeFormat("es-BO", { timeZone: "America/La_Paz", day: "2-digit", month: "2-digit", year: "numeric" }).format(new Date(a.customerExpiresAt));
  const storeName = e.s.settings.storeName || "la tienda";
  const first = (cust?.name ?? "").split(" ")[0] || "";
  // La llave del asistente no ve contraseñas ni PIN de perfiles: el mensaje sale con «te la paso aparte».
  const hide = !!actor.assistant;
  const pin = hide ? "" : slot.pin ?? "";
  const secret = hide ? "" : acc.password;
  const message = (acc.iptv
    ? [
      `¡Hola ${first}! 👋 Tu *${prod?.name ?? "IPTV"}* ya está lista:`,
      ``,
      ...iptvLines(acc.iptv, acc.email, secret),
      `📅 Vence: ${expiresText}`,
      ...guideLines(prod),
      ``,
      `Cualquier cosa me escribís. ¡Gracias por tu compra! 🙌`,
    ]
    : [
      `¡Hola ${first}! 👋 Tu *${prod?.name ?? "cuenta"}* ya está lista:`,
      ``,
      `📧 Correo: ${acc.email}`,
      `🔑 Contraseña: ${secret || "(te la paso aparte)"}`,
      `👤 Perfil: ${slot.label}`,
      ...(pin ? [`🔢 PIN del perfil: ${pin}`] : []),
      `📅 Vence: ${expiresText}`,
      ``,
      `Cualquier cosa me escribís. ¡Gracias por tu compra! 🙌`,
    ]).join("\n");
  e.audit(actor, "assignment.deliver", "assignment", a.id, { customer: a.customerId, ...(hide ? { hidden: true } : {}) });
  return {
    assignmentId: a.id, customerId: a.customerId, customerName: cust?.name ?? "", customerFirst: first,
    customerPhone: cust?.phone ?? "", product: prod?.name ?? "", email: acc.email, password: secret || "",
    profile: slot.label, pin, expiresAt: a.customerExpiresAt, expiresText, storeName, message, passwordPending: !acc.password, ...(hide ? { secretsHidden: true } : {}),
  };
}

export function getOrderEvidence(e: Engine, actor: Actor, orderId: Id) {
  authorize(actor, "payment.review");
  const o = e.get("orders", orderId);
  if (!o.evidence) throw new DomainError("NOT_FOUND", "El pedido no tiene comprobante");
  return structuredClone(o.evidence);
}
