// Inventario transaccional de cuentas y perfiles (slots).
import type { Account, Actor, Cents, Id, Slot } from "./types.js";
import type { Engine } from "./engine.js";
import { MINUTE } from "./time.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { queue } from "./notify.js";

export interface NewAccount {
  productId: Id;
  supplierId: Id;
  email: string;
  password: string;
  supplierExpiresAt: number;
  cost: Cents;
  /** Etiquetas de perfiles. Una sola entrada = cuenta completa. */
  profiles: { label: string; pin?: string }[];
}

export function addAccount(e: Engine, actor: Actor, a: NewAccount): { account: Account; slots: Slot[] } {
  authorize(actor, "inventory.manage");
  if (!/^[^@\s]+@[^@\s]+$/.test(a.email)) throw new DomainError("VALIDATION", "Email de cuenta inválido");
  if (!a.password) throw new DomainError("VALIDATION", "Falta la contraseña de la cuenta");
  if (!a.profiles.length || a.profiles.length > 20) throw new DomainError("VALIDATION", "Entre 1 y 20 perfiles por cuenta");
  if (!Number.isInteger(a.cost) || a.cost < 0) throw new DomainError("VALIDATION", "Costo inválido");
  return e.tx(() => {
    e.get("products", a.productId);
    const sup = e.get("suppliers", a.supplierId);
    if (!sup.active) throw new DomainError("INVALID_STATE", "El proveedor está inactivo");
    if (a.supplierExpiresAt <= e.now()) throw new DomainError("VALIDATION", "La cuenta ya venció con el proveedor");
    const id = e.id("acc");
    const account: Account = {
      id, productId: a.productId, supplierId: a.supplierId, email: a.email.toLowerCase(), password: a.password,
      supplierExpiresAt: a.supplierExpiresAt, cost: a.cost, status: "active", createdAt: e.now(),
    };
    e.s.accounts[id] = account;
    const slots = a.profiles.map((p) => {
      const s: Slot = { id: e.id("slt"), accountId: id, productId: a.productId, label: p.label, pin: p.pin, status: "available" };
      e.s.slots[s.id] = s;
      return s;
    });
    e.audit(actor, "account.add", "account", id, { productId: a.productId, supplierId: a.supplierId, slots: slots.length });
    return { account: structuredClone(account), slots: structuredClone(slots) };
  });
}

/** Carga masiva: cada fila es independiente; devuelve qué filas entraron y cuáles fallaron. */
export function addAccountsBulk(e: Engine, actor: Actor, rows: NewAccount[]) {
  authorize(actor, "inventory.manage");
  return rows.map((r, i) => {
    try {
      return { row: i, ok: true as const, accountId: addAccount(e, actor, r).account.id };
    } catch (err) {
      return { row: i, ok: false as const, error: (err as Error).message };
    }
  });
}

const sellable = (e: Engine, s: Slot) => {
  const acc = e.s.accounts[s.accountId];
  return s.status === "available" && acc?.status === "active" && acc.supplierExpiresAt > e.now();
};

/** Reserva `qty` slots del producto. Todo o nada; debe llamarse dentro de `tx`. */
export function reserveSlots(e: Engine, productId: Id, qty: number, orderId: Id, exclude: Id[] = []): Slot[] {
  const free = Object.values(e.s.slots)
    .filter((s) => s.productId === productId && sellable(e, s) && !exclude.includes(s.accountId))
    // Primero las cuentas que vencen antes con el proveedor, para rotar el inventario.
    .sort((a, b) => e.s.accounts[a.accountId].supplierExpiresAt - e.s.accounts[b.accountId].supplierExpiresAt || a.id.localeCompare(b.id));
  if (free.length < qty) throw new DomainError("OUT_OF_STOCK", `Sin stock suficiente de ${productId}: pedidos ${qty}, libres ${free.length}`);
  const until = e.now() + e.opts.reservationMinutes * MINUTE;
  return free.slice(0, qty).map((s) => {
    s.status = "reserved";
    s.reservedByOrder = orderId;
    s.reservedUntil = until;
    return s;
  });
}

export function releaseSlots(e: Engine, slotIds: Id[]): void {
  for (const id of slotIds) {
    const s = e.s.slots[id];
    if (s && s.status === "reserved") {
      s.status = "available";
      delete s.reservedByOrder;
      delete s.reservedUntil;
    }
  }
}

export interface AccountPatch {
  email?: string;
  password?: string;
  supplierId?: Id;
  supplierExpiresAt?: number;
  cost?: Cents;
  notes?: string;
}

/** Clientes con servicio activo en esta cuenta (para avisarles). */
function activeOnAccount(e: Engine, accountId: Id) {
  return Object.values(e.s.assignments).filter((a) => a.status === "active" && e.s.slots[a.slotId]?.accountId === accountId);
}

/**
 * Edita una cuenta. Si cambia el email o la contraseña (p. ej. el proveedor la cambió),
 * todos sus clientes ven el dato nuevo en Mis cuentas y reciben un aviso SIN la clave.
 */
export function updateAccount(e: Engine, actor: Actor, accountId: Id, patch: AccountPatch): { accountId: Id; notified: number; changed: string[] } {
  authorize(actor, "inventory.manage");
  if (patch.email !== undefined && !/^[^@\s]+@[^@\s]+$/.test(patch.email.trim())) throw new DomainError("VALIDATION", "Email de cuenta inválido");
  if (patch.password !== undefined && !patch.password) throw new DomainError("VALIDATION", "La contraseña no puede quedar vacía");
  if (patch.cost !== undefined && (!Number.isInteger(patch.cost) || patch.cost < 0)) throw new DomainError("VALIDATION", "Costo inválido");
  if (patch.supplierExpiresAt !== undefined && !(Number.isFinite(patch.supplierExpiresAt) && patch.supplierExpiresAt > 0)) throw new DomainError("VALIDATION", "Fecha de vencimiento inválida");
  if ((patch.notes?.length ?? 0) > 500) throw new DomainError("VALIDATION", "Notas: máximo 500 letras");
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    const changed: string[] = [];
    const email = patch.email?.trim().toLowerCase();
    const credsChanged = (email !== undefined && email !== acc.email) || (patch.password !== undefined && patch.password !== acc.password);
    if (acc.status === "retired" && credsChanged) throw new DomainError("INVALID_STATE", "La cuenta está retirada");
    if (email !== undefined && email !== acc.email) { acc.email = email; changed.push("email"); }
    if (patch.password !== undefined && patch.password !== acc.password) { acc.password = patch.password; changed.push("password"); }
    if (patch.supplierId !== undefined && patch.supplierId !== acc.supplierId) {
      if (!e.get("suppliers", patch.supplierId).active) throw new DomainError("INVALID_STATE", "El proveedor está inactivo");
      acc.supplierId = patch.supplierId; changed.push("supplierId");
    }
    if (patch.supplierExpiresAt !== undefined && patch.supplierExpiresAt !== acc.supplierExpiresAt) { acc.supplierExpiresAt = patch.supplierExpiresAt; changed.push("supplierExpiresAt"); }
    if (patch.cost !== undefined && patch.cost !== acc.cost) { acc.cost = patch.cost; changed.push("cost"); }
    if (patch.notes !== undefined && patch.notes !== (acc.notes ?? "")) { acc.notes = patch.notes.trim(); changed.push("notes"); }
    let notified = 0;
    if (credsChanged) {
      for (const a of activeOnAccount(e, acc.id)) {
        a.history.push({ at: e.now(), by: actor.id, event: "access_updated", slotId: a.slotId, note: "datos de la cuenta actualizados" });
        queue(e, a.customerId, "access_updated", { product: e.s.products[a.productId].name });
        notified++;
      }
    }
    e.audit(actor, "account.update", "account", acc.id, { fields: changed.join(","), notified });
    return { accountId: acc.id, notified, changed };
  });
}

/** Cambia la etiqueta o el PIN de un perfil. Si está vendido, el cliente recibe un aviso (sin el PIN). */
export function updateSlot(e: Engine, actor: Actor, slotId: Id, patch: { label?: string; pin?: string }): { notified: boolean } {
  authorize(actor, "inventory.manage");
  if (patch.pin !== undefined && !/^\d{0,8}$/.test(patch.pin)) throw new DomainError("VALIDATION", "PIN: solo números, hasta 8");
  if (patch.label !== undefined && (!patch.label.trim() || patch.label.length > 40)) throw new DomainError("VALIDATION", "Nombre de perfil inválido");
  return e.tx(() => {
    const s = e.get("slots", slotId);
    const pinChanged = patch.pin !== undefined && patch.pin !== (s.pin ?? "");
    if (patch.label !== undefined) s.label = patch.label.trim();
    if (patch.pin !== undefined) s.pin = patch.pin || undefined;
    let notified = false;
    if ((pinChanged || patch.label !== undefined) && s.status === "assigned") {
      const a = Object.values(e.s.assignments).find((x) => x.slotId === s.id && x.status === "active");
      if (a) {
        a.history.push({ at: e.now(), by: actor.id, event: "access_updated", slotId: s.id, note: "perfil o PIN actualizado" });
        queue(e, a.customerId, "access_updated", { product: e.s.products[a.productId].name });
        notified = true;
      }
    }
    e.audit(actor, "slot.update", "slot", s.id, { label: patch.label !== undefined, pinChanged, notified });
    return { notified };
  });
}

/** Agrega un perfil a una cuenta existente. */
export function addSlot(e: Engine, actor: Actor, accountId: Id, p: { label: string; pin?: string }): Slot {
  authorize(actor, "inventory.manage");
  if (!p.label?.trim() || p.label.length > 40) throw new DomainError("VALIDATION", "Nombre de perfil inválido");
  if (p.pin !== undefined && p.pin !== "" && !/^\d{1,8}$/.test(p.pin)) throw new DomainError("VALIDATION", "PIN: solo números, hasta 8");
  return e.tx(() => {
    const acc = e.get("accounts", accountId);
    if (acc.status !== "active") throw new DomainError("INVALID_STATE", "La cuenta está retirada");
    const slots = Object.values(e.s.slots).filter((s) => s.accountId === acc.id);
    if (slots.length >= 20) throw new DomainError("VALIDATION", "Máximo 20 perfiles por cuenta");
    if (slots.some((s) => s.label.toLowerCase() === p.label.trim().toLowerCase())) throw new DomainError("VALIDATION", `La cuenta ya tiene un perfil "${p.label}"`);
    const s: Slot = { id: e.id("slt"), accountId: acc.id, productId: acc.productId, label: p.label.trim(), pin: p.pin || undefined, status: "available" };
    e.s.slots[s.id] = s;
    e.audit(actor, "slot.add", "slot", s.id, { accountId: acc.id });
    return structuredClone(s);
  });
}

export function setSlotStatus(e: Engine, actor: Actor, slotId: Id, status: "available" | "quarantined" | "retired", note: string): void {
  authorize(actor, "inventory.manage");
  e.tx(() => {
    const s = e.get("slots", slotId);
    if (s.status === "assigned" || s.status === "reserved") throw new DomainError("INVALID_STATE", "No se puede cambiar un perfil reservado o asignado; usá reemplazo");
    s.status = status;
    e.audit(actor, "slot.status", "slot", slotId, { status, note });
  });
}

export function stockByProduct(e: Engine) {
  const out: Record<Id, Record<string, number>> = {};
  for (const s of Object.values(e.s.slots)) {
    const k = sellable(e, s) ? "available" : s.status === "available" ? "unsellable" : s.status;
    (out[s.productId] ??= {})[k] = (out[s.productId][k] ?? 0) + 1;
  }
  return out;
}

/** Vista de staff. Las contraseñas solo salen con permiso explícito. */
export function listAccounts(e: Engine, actor: Actor, opts: { withSecrets?: boolean } = {}) {
  authorize(actor, "inventory.manage");
  if (opts.withSecrets) authorize(actor, "inventory.view_secrets");
  if (opts.withSecrets) e.tx(() => e.audit(actor, "secrets.view", "account", "*"));
  return Object.values(e.s.accounts).map((a) => ({
    ...structuredClone(a),
    password: opts.withSecrets ? a.password : "••••••",
    slots: Object.values(e.s.slots).filter((s) => s.accountId === a.id).map((s) => ({ id: s.id, label: s.label, status: s.status, pin: opts.withSecrets ? s.pin ?? "" : undefined })),
  }));
}
