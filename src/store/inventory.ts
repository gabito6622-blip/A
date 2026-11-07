// Inventario transaccional de cuentas y perfiles (slots).
import type { Account, Actor, Cents, Id, Slot } from "./types.js";
import type { Engine } from "./engine.js";
import { MINUTE } from "./time.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";

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
    slots: Object.values(e.s.slots).filter((s) => s.accountId === a.id).map((s) => ({ id: s.id, label: s.label, status: s.status })),
  }));
}
