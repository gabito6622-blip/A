// Importación de servicios que ya existían (p. ej. desde el Excel con el que trabajaba la tienda).
//
// Cada fila deja: cliente (se crea si no existe), cuenta (se crea si no existe), perfil
// (se agrega si falta) y el servicio asignado con su fecha de vencimiento.
// - Todo el lote corre en UNA transacción, con un punto de restauración por fila:
//   una fila con error no deja nada a medias y no frena a las demás.
// - En modo vista previa se procesa todo igual y al final se deshace: la vista previa
//   muestra exactamente lo que va a pasar.
// - No se mandan avisos de WhatsApp y no cuenta como venta en las estadísticas.
import type { Actor, Assignment, Cents, Id, Order } from "./types.js";
import type { Engine } from "./engine.js";
import { DAY } from "./time.js";
import { authorize } from "./auth.js";
import { DomainError } from "./errors.js";
import { createCustomer, normalizePhone, upsertSupplier } from "./catalog.js";
import { addAccount, addSlot, ensurePropias } from "./inventory.js";

export interface ServiceRow {
  row: number;
  customerName: string;
  phone: string;
  product: string;
  email: string;
  password: string;
  profile: string;
  pin?: string;
  customerExpiresAt: number;
  supplierExpiresAt?: number;
  supplier?: string;
  cost?: Cents;
}

export interface ServiceResult {
  row: number;
  status: "ok" | "error";
  customer: string;
  product: string;
  account: string;
  profile: string;
  expiresAt?: number;
  /** Qué se creó en esta fila. */
  created: string[];
  warnings: string[];
  error?: string;
}

const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const DRY_RUN = Symbol("dry-run");

export function importServices(e: Engine, actor: Actor, rows: ServiceRow[], opts: { dryRun: boolean }) {
  authorize(actor, "inventory.manage");
  authorize(actor, "customer.manage");
  if (rows.length > 2000) throw new DomainError("VALIDATION", "Máximo 2000 filas por importación");
  const results: ServiceResult[] = [];
  const run = () => {
    for (const r of rows) {
      const res: ServiceResult = { row: r.row, status: "ok", customer: r.customerName, product: r.product, account: r.email, profile: r.profile, expiresAt: r.customerExpiresAt, created: [], warnings: [] };
      try {
        e.savepoint(() => importOne(e, actor, r, res));
      } catch (err) {
        res.status = "error";
        res.error = (err as Error).message;
        res.created = [];
      }
      results.push(res);
    }
    const ok = results.filter((x) => x.status === "ok").length;
    e.audit(actor, opts.dryRun ? "import.services.preview" : "import.services", "assignment", "*", { ok, errors: results.length - ok });
    if (opts.dryRun) throw DRY_RUN;
  };
  try {
    e.tx(run);
  } catch (err) {
    if (err !== DRY_RUN) throw err;
  }
  const count = (s: string) => results.filter((x) => x.created.includes(s)).length;
  return {
    dryRun: opts.dryRun,
    summary: {
      ok: results.filter((x) => x.status === "ok").length,
      errores: results.filter((x) => x.status === "error").length,
      clientesNuevos: count("cliente"), cuentasNuevas: count("cuenta"), perfilesNuevos: count("perfil"),
      avisos: results.reduce((s, x) => s + x.warnings.length, 0),
    },
    rows: results,
  };
}

function importOne(e: Engine, actor: Actor, r: ServiceRow, res: ServiceResult): void {
  const now = e.now();
  // Producto: por id o por nombre, sin importar mayúsculas ni acentos.
  const product = Object.values(e.s.products).find((p) => p.id === r.product || norm(p.name) === norm(r.product));
  if (!product) throw new DomainError("NOT_FOUND", `No existe el producto "${r.product}". Crealo primero en Productos (o corregí el nombre).`);
  res.product = product.name;

  // Cliente: por teléfono; si no existe, se crea.
  const phone = normalizePhone(r.phone);
  // Sin WhatsApp: se busca por nombre entre los clientes que tampoco tienen número.
  let customer = phone
    ? Object.values(e.s.customers).find((c) => c.phone === phone)
    : Object.values(e.s.customers).find((c) => !c.phone && norm(c.name) === norm(r.customerName));
  if (!phone) res.warnings.push("Sin WhatsApp: agregalo en Clientes");
  if (!customer) {
    if (!r.customerName.trim()) throw new DomainError("VALIDATION", "Falta el nombre del cliente");
    customer = createCustomer(e, actor, { name: r.customerName, phone, allowNoPhone: true });
    res.created.push("cliente");
  } else if (r.customerName && norm(customer.name) !== norm(r.customerName)) {
    res.warnings.push(`El teléfono ya es de "${customer.name}"; se le asigna a ese cliente`);
  }
  res.customer = customer.name;

  // Cuenta: por email y producto; si no existe, se crea con este perfil.
  const email = r.email.trim().toLowerCase();
  let account = Object.values(e.s.accounts).find((a) => a.email === email && a.productId === product.id && a.status === "active");
  if (!account) {

    // Sin columna de proveedor: la cuenta es tuya ("Propias").
    const supplierName = r.supplier?.trim() || "";
    let supplier = supplierName ? Object.values(e.s.suppliers).find((s) => norm(s.name) === norm(supplierName)) : e.s.suppliers[ensurePropias(e)];
    if (!supplier) {
      supplier = upsertSupplier(e, actor, { name: supplierName, active: true });
      res.created.push("proveedor");
    }
    if (!supplier.active) throw new DomainError("INVALID_STATE", `El proveedor "${supplier.name}" está inactivo`);
    const supplierExpiresAt = r.supplierExpiresAt ?? Math.max(r.customerExpiresAt, now + DAY);
    if (!r.supplierExpiresAt) res.warnings.push("Sin fecha del proveedor: se usó la del cliente; revisala en Cuentas");
    if (supplierExpiresAt <= now) res.warnings.push("La cuenta ya venció con el proveedor: renovala");
    if (!r.password) res.warnings.push("Sin contraseña: completala en Cuentas (el cliente ve “pedí tu clave por WhatsApp”)");
    const created = addAccount(e, actor, {
      productId: product.id, supplierId: supplier.id, email, password: r.password, supplierExpiresAt, cost: r.cost ?? 0,
      profiles: [{ label: r.profile, pin: r.pin || undefined }], passwordPending: !r.password, allowPastSupplierExpiry: true,
    });
    account = e.s.accounts[created.account.id];
    res.created.push("cuenta", "perfil");
  } else if (r.password && r.password !== account.password) {
    res.warnings.push("La contraseña del Excel es distinta a la guardada; se dejó la guardada (cambiala en Cuentas si hace falta)");
  }

  // Perfil: por nombre dentro de la cuenta; si falta, se agrega.
  let slot = Object.values(e.s.slots).find((s) => s.accountId === account!.id && s.label.toLowerCase() === r.profile.trim().toLowerCase());
  if (!slot) {
    slot = e.s.slots[addSlot(e, actor, account.id, { label: r.profile, pin: r.pin || undefined }).id];
    res.created.push("perfil");
  }
  if (slot.status === "assigned") {
    const holder = Object.values(e.s.assignments).find((a) => a.slotId === slot!.id && a.status === "active");
    throw new DomainError("INVALID_STATE", `El ${slot.label} de ${account.email} ya está asignado a ${holder ? e.s.customers[holder.customerId]?.name : "otro cliente"}`);
  }
  if (slot.status !== "available") throw new DomainError("INVALID_STATE", `El ${slot.label} de ${account.email} está en ${slot.status === "quarantined" ? "cuarentena" : slot.status}`);
  if (r.pin && r.pin !== (slot.pin ?? "")) slot.pin = r.pin;

  if (r.customerExpiresAt < now) res.warnings.push("Ya está vencido: queda abierto hasta que le pongas fecha o lo renueves");
  if (r.customerExpiresAt > account.supplierExpiresAt) res.warnings.push("El cliente vence después que la cuenta con el proveedor");

  // Servicio asignado, con un pedido de registro de Bs 0 (no cuenta como venta).
  const order: Order = {
    id: e.id("ord"), kind: "sale", customerId: customer.id, payerId: customer.id, createdBy: actor.id, channel: "import",
    items: [{ productId: product.id, qty: 1, unitPrice: 0 }], total: 0, status: "fulfilled", paymentMethod: "cash",
    reservedSlotIds: [slot.id], assignmentIds: [], createdAt: now, updatedAt: now,
  };
  slot.status = "assigned";
  slot.reservedByOrder = order.id;
  const a: Assignment = {
    id: e.id("asg"), slotId: slot.id, productId: product.id, customerId: customer.id, orderId: order.id,
    startsAt: now, customerExpiresAt: r.customerExpiresAt, status: "active", ...(r.customerExpiresAt < now ? { holdOpen: true } : {}),
    history: [{ at: now, by: actor.id, event: "assigned", slotId: slot.id, note: `importado (fila ${r.row})` }],
  };
  order.assignmentIds.push(a.id);
  e.s.orders[order.id] = order;
  e.s.assignments[a.id] = a;
  res.account = account.email;
  res.profile = slot.label;
}

export type { Id };
