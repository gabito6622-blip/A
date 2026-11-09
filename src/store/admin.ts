// Usuarios del panel y listados para el staff.
// El hash de contraseña lo calcula el servidor (scrypt); el núcleo solo lo guarda y nunca lo devuelve.
import type { Actor, Id, OrderStatus, StaffUser } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize, isStaff } from "./auth.js";
import { DomainError } from "./errors.js";

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
  return Object.values(e.s.customers)
    .filter((c) => !needle || `${c.name} ${c.phone} ${c.email ?? ""}`.toLowerCase().includes(needle))
    .map((c) => ({
      ...structuredClone(c),
      balance: e.s.ledger.reduce((s, l) => (l.customerId === c.id ? s + l.amount : s), 0),
      activeServices: Object.values(e.s.assignments).filter((a) => a.customerId === c.id && a.status === "active").length,
    }));
}

/** Servicios asignados (sin contraseñas) para Renovar, Recordatorios y Cuentas. */
export function listAssignments(e: Engine, actor: Actor, f: { customerId?: Id; productId?: Id; expiringWithinDays?: number } = {}) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo staff");
  return Object.values(e.s.assignments)
    .filter((a) => a.status === "active")
    .filter((a) => (!f.customerId || a.customerId === f.customerId) && (!f.productId || a.productId === f.productId))
    .filter((a) => f.expiringWithinDays === undefined || a.customerExpiresAt - e.now() <= f.expiringWithinDays * 86_400_000)
    .sort((a, b) => a.customerExpiresAt - b.customerExpiresAt)
    .map((a) => {
      const slot = e.s.slots[a.slotId];
      const acc = e.s.accounts[slot.accountId];
      return {
        id: a.id, customerId: a.customerId, customerName: e.s.customers[a.customerId]?.name, productId: a.productId,
        product: e.s.products[a.productId]?.name, email: acc.email, profile: slot.label,
        customerExpiresAt: a.customerExpiresAt, supplierExpiresAt: acc.supplierExpiresAt, lastReminderAt: a.lastReminderAt ?? null, holdOpen: !!a.holdOpen,
        passwordPending: !acc.password, customerPhone: e.s.customers[a.customerId]?.phone ?? "",
        startsAt: a.control?.startedAt ?? a.startsAt, control: a.control ?? {}, productPrice: e.s.products[a.productId]?.price ?? 0, durationDays: e.s.products[a.productId]?.durationDays ?? 30,
        accountCost: acc.cost, accountNotes: acc.notes ?? "", customerKind: e.s.customers[a.customerId]?.kind ?? "customer",
      };
    });
}

/**
 * Datos completos para ENTREGAR un alquiler al cliente (correo, contraseña, perfil, PIN) y un
 * mensaje de WhatsApp listo para mandar. Solo staff; cada vez que se revela queda en la auditoría.
 */
export function deliveryInfo(e: Engine, actor: Actor, assignmentId: Id) {
  if (!isStaff(actor)) throw new DomainError("FORBIDDEN", "Solo staff");
  const a = e.s.assignments[assignmentId];
  if (!a || a.status !== "active") throw new DomainError("NOT_FOUND", "No se encontró ese alquiler activo");
  const slot = e.s.slots[a.slotId];
  const acc = e.s.accounts[slot.accountId];
  const cust = e.s.customers[a.customerId];
  const prod = e.s.products[a.productId];
  const d = new Date(a.customerExpiresAt);
  const expiresText = `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  const storeName = e.s.settings.storeName || "la tienda";
  const first = (cust?.name ?? "").split(" ")[0] || "";
  const pin = slot.pin ?? "";
  const message = [
    `¡Hola ${first}! 👋 Tu *${prod?.name ?? "cuenta"}* ya está lista:`,
    ``,
    `📧 Correo: ${acc.email}`,
    `🔑 Contraseña: ${acc.password || "(te la paso aparte)"}`,
    `👤 Perfil: ${slot.label}`,
    ...(pin ? [`🔢 PIN del perfil: ${pin}`] : []),
    `📅 Vence: ${expiresText}`,
    ``,
    `Cualquier cosa me escribís. ¡Gracias por tu compra! 🙌`,
  ].join("\n");
  e.audit(actor, "assignment.deliver", "assignment", a.id, { customer: a.customerId });
  return {
    assignmentId: a.id, customerId: a.customerId, customerName: cust?.name ?? "", customerFirst: first,
    customerPhone: cust?.phone ?? "", product: prod?.name ?? "", email: acc.email, password: acc.password || "",
    profile: slot.label, pin, expiresAt: a.customerExpiresAt, expiresText, storeName, message, passwordPending: !acc.password,
  };
}

export function getOrderEvidence(e: Engine, actor: Actor, orderId: Id) {
  authorize(actor, "payment.review");
  const o = e.get("orders", orderId);
  if (!o.evidence) throw new DomainError("NOT_FOUND", "El pedido no tiene comprobante");
  return structuredClone(o.evidence);
}
