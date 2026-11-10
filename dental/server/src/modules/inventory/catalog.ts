// Inventario: catálogo de insumos, proveedores, stock por sucursal, lotes, alertas, valorización
// y consumo estándar por prestación.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams, zOptText } from "../../lib/http.js";
import { AppError, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../../lib/rbac.js";
import type { Client } from "../../lib/db.js";
import { computeAlerts, lockStock, localToday, materialCostForTreatment, zQty, zQtyZero, PER_LABELS } from "./core.js";

/** Sucursales del alcance: la pedida (verificada) o todas las permitidas (null = todas). */
export function scopeBranches(auth: AuthCtx, branchId?: string | null): string[] | null {
  if (branchId) { requireBranch(auth, branchId); return [branchId]; }
  return allowedBranches(auth);
}

const zSku = z.string().trim().toUpperCase().min(1, "Indica el código (SKU)").max(40, "Máximo 40 caracteres")
  .regex(/^[A-Z0-9][A-Z0-9._-]*$/, "Solo letras, números, punto, guion y guion bajo (sin espacios)");
const zItemBody = z.object({
  name: z.string().trim().min(2, "Escribe el nombre del insumo").max(120),
  category: z.string().trim().min(1, "Indica la categoría").max(60).default("General"),
  useUnit: z.string().trim().min(1, "Indica la unidad de uso (p. ej. unidad, cartucho, ml)").max(30),
  purchaseUnit: z.string().trim().min(1, "Indica la unidad de compra (p. ej. caja de 100)").max(40),
  purchaseFactor: zQty.describe("Unidades de uso que trae una unidad de compra"),
  tracksLots: z.boolean().default(false),
  preferredSupplierId: zId.nullish().transform((v) => v ?? null),
  active: z.boolean().default(true),
  mins: z.array(z.object({ branchId: zId, minQty: zQtyZero })).max(100).default([]),
});

async function setMins(c: Client, auth: AuthCtx, itemId: string, mins: { branchId: string; minQty: number }[]) {
  for (const m of mins) {
    requireBranch(auth, m.branchId);
    await lockStock(c, auth.clinicId!, itemId, m.branchId);
    await c.query("UPDATE inv_stock SET min_qty = $3 WHERE item_id = $1 AND branch_id = $2", [itemId, m.branchId, m.minQty.toFixed(3)]);
  }
}

async function assertSupplier(c: Client, id: string | null) {
  if (id && !(await c.query("SELECT 1 FROM inv_suppliers WHERE id = $1", [id])).rowCount) {
    throw new AppError(400, "validation", "El proveedor no existe", [{ path: "preferredSupplierId", message: "Proveedor inexistente" }]);
  }
}

export function inventoryCatalogRoutes(route: Route) {
  // ---------------- Catálogo ----------------
  route({
    method: "GET", url: "/api/inventory/items", summary: "Catálogo de insumos de la clínica (incluye mínimos por sucursal)", tags: ["inventario"], perm: "inventory.read",
    query: z.object({ all: z.string().optional() }),
    handler: async ({ c, query, auth }) => {
      const scope = allowedBranches(auth);
      const items = (await c.query(
        `SELECT it.id, it.sku, it.name, it.category, it.use_unit AS "useUnit", it.purchase_unit AS "purchaseUnit", it.purchase_factor AS "purchaseFactor",
                it.tracks_lots AS "tracksLots", it.active, it.preferred_supplier_id AS "preferredSupplierId", sp.name AS "supplierName",
                coalesce((SELECT json_agg(json_build_object('branchId', s.branch_id, 'minQty', s.min_qty))
                            FROM inv_stock s WHERE s.item_id = it.id AND ($2::uuid[] IS NULL OR s.branch_id = ANY($2))), '[]') AS mins
           FROM inv_items it LEFT JOIN inv_suppliers sp ON sp.id = it.preferred_supplier_id
          WHERE ($1 OR it.active) ORDER BY it.category, it.name`, [query.all === "1", scope])).rows;
      return items;
    },
  });

  route({
    method: "POST", url: "/api/inventory/items", summary: "Crear un insumo (SKU único en la clínica)", tags: ["inventario"], perm: "inventory.manage",
    body: zItemBody.extend({ sku: zSku }),
    handler: async ({ c, auth, body }) => {
      const dup = (await c.query<{ name: string }>("SELECT name FROM inv_items WHERE sku = $1", [body.sku])).rows[0];
      if (dup) throw new AppError(409, "duplicate_sku", `Ya existe un insumo con el SKU ${body.sku}: «${dup.name}»`, [{ path: "sku", message: `SKU en uso por «${dup.name}»` }]);
      await assertSupplier(c, body.preferredSupplierId);
      const id = (await c.query<{ id: string }>(
        `INSERT INTO inv_items (clinic_id, sku, name, category, use_unit, purchase_unit, purchase_factor, tracks_lots, preferred_supplier_id, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [auth.clinicId, body.sku, body.name, body.category, body.useUnit, body.purchaseUnit, body.purchaseFactor, body.tracksLots, body.preferredSupplierId, body.active])).rows[0]!.id;
      await setMins(c, auth, id, body.mins);
      await audit(c, auth, "inventory.item_created", "inv_item", id, { sku: body.sku, name: body.name, tracksLots: body.tracksLots, purchaseFactor: body.purchaseFactor });
      return { id };
    },
  });

  route({
    method: "PUT", url: "/api/inventory/items/:id", summary: "Editar un insumo (el SKU no cambia)", tags: ["inventario"], perm: "inventory.manage", params: zIdParams,
    body: zItemBody,
    handler: async ({ c, auth, params, body }) => {
      const old = (await c.query("SELECT * FROM inv_items WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!old) throw notFound("Insumo");
      if (old.tracks_lots !== body.tracksLots && (await c.query("SELECT 1 FROM inv_lots WHERE item_id = $1", [params.id])).rowCount) {
        throw new AppError(409, "has_lots", "No se puede cambiar el manejo por lotes de un insumo que ya tiene movimientos. Crea un insumo nuevo.", [{ path: "tracksLots", message: "Ya tiene movimientos" }]);
      }
      await assertSupplier(c, body.preferredSupplierId);
      await c.query(
        `UPDATE inv_items SET name = $2, category = $3, use_unit = $4, purchase_unit = $5, purchase_factor = $6, tracks_lots = $7, preferred_supplier_id = $8, active = $9 WHERE id = $1`,
        [params.id, body.name, body.category, body.useUnit, body.purchaseUnit, body.purchaseFactor, body.tracksLots, body.preferredSupplierId, body.active]);
      await setMins(c, auth, params.id, body.mins);
      await audit(c, auth, "inventory.item_updated", "inv_item", params.id, {
        before: { name: old.name, purchaseFactor: Number(old.purchase_factor), active: old.active, useUnit: old.use_unit, purchaseUnit: old.purchase_unit },
        after: { name: body.name, purchaseFactor: body.purchaseFactor, active: body.active, useUnit: body.useUnit, purchaseUnit: body.purchaseUnit }, mins: body.mins,
      });
      return { ok: true };
    },
  });

  // ---------------- Stock por sucursal ----------------
  route({
    method: "GET", url: "/api/inventory/stock", summary: "Stock por insumo en una sucursal (o consolidado de las sucursales permitidas), con alertas", tags: ["inventario"], perm: "inventory.read",
    query: z.object({ branchId: zId.optional(), all: z.string().optional() }),
    handler: async ({ c, auth, query }) => {
      const scope = scopeBranches(auth, query.branchId);
      const rows = (await c.query(
        `SELECT it.id, it.sku, it.name, it.category, it.use_unit AS "useUnit", it.purchase_unit AS "purchaseUnit", it.purchase_factor AS "purchaseFactor",
                it.tracks_lots AS "tracksLots", it.active,
                coalesce(sum(s.qty_on_hand), 0) AS qty, coalesce(sum(s.min_qty), 0) AS "minQty",
                (SELECT min(l.expires_on) FROM inv_lots l WHERE l.item_id = it.id AND l.qty_on_hand > 0 AND ($1::uuid[] IS NULL OR l.branch_id = ANY($1))) AS "nextExpiry",
                (SELECT count(*)::int FROM inv_lots l WHERE l.item_id = it.id AND l.qty_on_hand > 0 AND l.lot_code IS NOT NULL AND ($1::uuid[] IS NULL OR l.branch_id = ANY($1))) AS lots,
                (SELECT coalesce(round(sum(l.qty_on_hand * l.unit_cost)), 0) FROM inv_lots l WHERE l.item_id = it.id AND ($1::uuid[] IS NULL OR l.branch_id = ANY($1))) AS "valueCents",
                (SELECT coalesce(sum(tl.qty_sent), 0) FROM inv_transfer_lines tl JOIN inv_transfers t ON t.id = tl.transfer_id
                  WHERE tl.item_id = it.id AND t.status = 'in_transit' AND ($1::uuid[] IS NULL OR t.to_branch_id = ANY($1))) AS "inTransit"
           FROM inv_items it LEFT JOIN inv_stock s ON s.item_id = it.id AND ($1::uuid[] IS NULL OR s.branch_id = ANY($1))
          WHERE ($2 OR it.active)
          GROUP BY it.id ORDER BY it.category, it.name`, [scope, query.all === "1"])).rows;
      const alerts = await computeAlerts(c, auth.clinicId!, scope);
      const today = await localToday(c, auth.clinicId!);
      return {
        today,
        items: rows.map((r) => ({
          ...r,
          alerts: alerts.filter((a) => a.itemId === r.id).map((a) => ({ type: a.type, bucket: a.bucket, branchName: a.branchName, lotCode: a.lotCode, daysLeft: a.daysLeft, qtyMissing: a.qtyMissing })),
        })),
      };
    },
  });

  route({
    method: "GET", url: "/api/inventory/lots", summary: "Lotes por sucursal con saldo, vencimiento y costo", tags: ["inventario"], perm: "inventory.read",
    query: z.object({ branchId: zId.optional(), itemId: zId.optional(), withEmpty: z.string().optional() }),
    handler: async ({ c, auth, query }) => {
      const scope = scopeBranches(auth, query.branchId);
      const today = await localToday(c, auth.clinicId!);
      const rows = (await c.query(
        `SELECT l.id, l.item_id AS "itemId", it.sku, it.name AS "itemName", it.use_unit AS "useUnit", it.tracks_lots AS "tracksLots",
                l.branch_id AS "branchId", b.name AS "branchName", l.lot_code AS "lotCode", l.expires_on AS "expiresOn",
                (l.expires_on - $3::date) AS "daysLeft", l.qty_on_hand AS qty, l.unit_cost AS "unitCost", round(l.qty_on_hand * l.unit_cost) AS "valueCents",
                sp.name AS "supplierName", l.created_at AS "createdAt"
           FROM inv_lots l JOIN inv_items it ON it.id = l.item_id JOIN branches b ON b.id = l.branch_id LEFT JOIN inv_suppliers sp ON sp.id = l.supplier_id
          WHERE ($1::uuid[] IS NULL OR l.branch_id = ANY($1)) AND ($2::uuid IS NULL OR l.item_id = $2) AND ($4 OR l.qty_on_hand > 0)
          ORDER BY it.name, b.name, l.expires_on NULLS LAST, l.created_at`, [scope, query.itemId ?? null, today, query.withEmpty === "1"])).rows;
      return rows.map((r) => ({ ...r, daysLeft: r.daysLeft == null ? null : Number(r.daysLeft) }));
    },
  });

  route({
    method: "GET", url: "/api/inventory/alerts", summary: "Alertas de inventario: bajo mínimo, por vencer (30/60/90 días), vencidos y consumos pendientes", tags: ["inventario"], perm: "inventory.read",
    query: z.object({ branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      const alerts = await computeAlerts(c, auth.clinicId!, scopeBranches(auth, query.branchId));
      const count = (t: string, b?: number) => alerts.filter((a) => a.type === t && (b === undefined || a.bucket === b)).length;
      return {
        summary: { belowMin: count("below_min"), expired: count("expired"), expiring30: count("expiring", 30), expiring60: count("expiring", 60), expiring90: count("expiring", 90), pending: count("pending_consumption") },
        alerts,
      };
    },
  });

  route({
    method: "GET", url: "/api/inventory/valuation", summary: "Valor del inventario por sucursal (costo por lote / promedio ponderado)", tags: ["inventario"], perm: "inventory.read",
    query: z.object({ branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      const scope = scopeBranches(auth, query.branchId);
      const rows = (await c.query<{ branchId: string; branchName: string; valueCents: number; lots: number }>(
        `SELECT b.id AS "branchId", b.name AS "branchName", coalesce(round(sum(l.qty_on_hand * l.unit_cost)), 0) AS "valueCents", count(l.id) FILTER (WHERE l.qty_on_hand > 0)::int AS lots
           FROM branches b LEFT JOIN inv_lots l ON l.branch_id = b.id
          WHERE b.active AND ($1::uuid[] IS NULL OR b.id = ANY($1)) GROUP BY b.id, b.name ORDER BY b.name`, [scope])).rows;
      return { branches: rows, totalCents: rows.reduce((s, r) => s + Number(r.valueCents), 0) };
    },
  });

  route({
    method: "GET", url: "/api/inventory/treatments/:id/material-cost", summary: "Costo de materiales de un tratamiento realizado (para rentabilidad)", tags: ["inventario"], perm: "reports.financial", params: zIdParams,
    handler: async ({ c, params }) => {
      if (!(await c.query("SELECT 1 FROM budget_items WHERE id = $1", [params.id])).rowCount) throw notFound("Tratamiento");
      return materialCostForTreatment(c, params.id);
    },
  });

  // ---------------- Proveedores ----------------
  const zSupplier = z.object({
    name: z.string().trim().min(2, "Escribe el nombre del proveedor").max(120),
    taxId: zOptText(30), contactName: zOptText(120), phone: zOptText(40),
    email: z.string().trim().max(160).email("Correo inválido").nullish().or(z.literal("")).transform((v) => v || null),
    address: zOptText(300), paymentTerms: zOptText(200), notes: zOptText(500), active: z.boolean().default(true),
  });
  route({
    method: "GET", url: "/api/inventory/suppliers", summary: "Proveedores con indicadores (% a tiempo y % rechazado)", tags: ["inventario"], perm: "inventory.read",
    handler: async ({ c }) => (await c.query(
      `SELECT sp.id, sp.name, sp.tax_id AS "taxId", sp.contact_name AS "contactName", sp.phone, sp.email, sp.address, sp.payment_terms AS "paymentTerms", sp.notes, sp.active,
              (SELECT count(*)::int FROM inv_purchase_orders po WHERE po.supplier_id = sp.id AND po.status <> 'cancelled') AS orders,
              (SELECT round(100.0 * count(*) FILTER (WHERE po.expected_on IS NULL OR (r.first_at AT TIME ZONE (SELECT timezone FROM clinics WHERE id = sp.clinic_id))::date <= po.expected_on) / nullif(count(*), 0))
                 FROM inv_purchase_orders po JOIN LATERAL (SELECT min(received_at) AS first_at FROM inv_po_receipts WHERE po_id = po.id) r ON r.first_at IS NOT NULL
                WHERE po.supplier_id = sp.id) AS "onTimePct",
              (SELECT round(100.0 * sum(rl.qty_rejected) / nullif(sum(rl.qty_rejected + rl.qty_accepted), 0))
                 FROM inv_po_receipt_lines rl JOIN inv_po_lines pl ON pl.id = rl.po_line_id JOIN inv_purchase_orders po ON po.id = pl.po_id WHERE po.supplier_id = sp.id) AS "rejectedPct"
         FROM inv_suppliers sp ORDER BY sp.active DESC, sp.name`)).rows,
  });
  route({
    method: "POST", url: "/api/inventory/suppliers", summary: "Registrar proveedor", tags: ["inventario"], perm: "inventory.manage", body: zSupplier,
    handler: async ({ c, auth, body }) => {
      if ((await c.query("SELECT 1 FROM inv_suppliers WHERE lower(name) = lower($1)", [body.name])).rowCount) {
        throw new AppError(409, "duplicate_name", "Ya existe un proveedor con ese nombre", [{ path: "name", message: "Nombre en uso" }]);
      }
      const id = (await c.query<{ id: string }>(
        `INSERT INTO inv_suppliers (clinic_id, name, tax_id, contact_name, phone, email, address, payment_terms, notes, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [auth.clinicId, body.name, body.taxId, body.contactName, body.phone, body.email, body.address, body.paymentTerms, body.notes, body.active])).rows[0]!.id;
      await audit(c, auth, "inventory.supplier_created", "inv_supplier", id, { name: body.name });
      return { id };
    },
  });
  route({
    method: "PUT", url: "/api/inventory/suppliers/:id", summary: "Editar proveedor", tags: ["inventario"], perm: "inventory.manage", params: zIdParams, body: zSupplier,
    handler: async ({ c, auth, params, body }) => {
      if ((await c.query("SELECT 1 FROM inv_suppliers WHERE lower(name) = lower($1) AND id <> $2", [body.name, params.id])).rowCount) {
        throw new AppError(409, "duplicate_name", "Ya existe un proveedor con ese nombre", [{ path: "name", message: "Nombre en uso" }]);
      }
      const r = await c.query(
        `UPDATE inv_suppliers SET name = $2, tax_id = $3, contact_name = $4, phone = $5, email = $6, address = $7, payment_terms = $8, notes = $9, active = $10 WHERE id = $1`,
        [params.id, body.name, body.taxId, body.contactName, body.phone, body.email, body.address, body.paymentTerms, body.notes, body.active]);
      if (!r.rowCount) throw notFound("Proveedor");
      await audit(c, auth, "inventory.supplier_updated", "inv_supplier", params.id, { ...body });
      return { ok: true };
    },
  });

  // ---------------- Consumo estándar por prestación ----------------
  route({
    method: "GET", url: "/api/procedures/:id/materials", summary: "Consumo estándar de una prestación (insumos y cantidades)", tags: ["inventario"], perm: "inventory.read", params: zIdParams,
    handler: async ({ c, params }) => (await c.query(
      `SELECT m.item_id AS "itemId", it.sku, it.name, it.use_unit AS "useUnit", m.qty, m.per, it.active
         FROM inv_procedure_materials m JOIN inv_items it ON it.id = m.item_id WHERE m.procedure_id = $1 ORDER BY it.name`, [params.id])).rows
      .map((r) => ({ ...r, perLabel: PER_LABELS[r.per] })),
  });
  route({
    method: "PUT", url: "/api/procedures/:id/materials", summary: "Definir el consumo estándar de una prestación (reemplaza la lista)", tags: ["inventario"], perm: "inventory.manage", params: zIdParams,
    body: z.object({ items: z.array(z.object({ itemId: zId, qty: zQty, per: z.enum(["treatment", "tooth", "surface"]) })).max(30, "Máximo 30 insumos por prestación") }),
    handler: async ({ c, auth, params, body }) => {
      if (!(await c.query("SELECT 1 FROM procedures WHERE id = $1", [params.id])).rowCount) throw notFound("Prestación");
      const seen = new Set<string>();
      body.items.forEach((m, i) => {
        if (seen.has(m.itemId)) throw new AppError(400, "validation", "Un insumo aparece dos veces: une las cantidades en una sola fila", [{ path: `items.${i}.itemId`, message: "Insumo repetido" }]);
        seen.add(m.itemId);
      });
      for (const [i, m] of body.items.entries()) {
        if (!(await c.query("SELECT 1 FROM inv_items WHERE id = $1", [m.itemId])).rowCount) throw new AppError(400, "validation", "El insumo no existe", [{ path: `items.${i}.itemId`, message: "Insumo inexistente" }]);
      }
      const before = (await c.query("SELECT item_id, qty, per FROM inv_procedure_materials WHERE procedure_id = $1", [params.id])).rows;
      await c.query("DELETE FROM inv_procedure_materials WHERE procedure_id = $1", [params.id]);
      for (const m of body.items) {
        await c.query("INSERT INTO inv_procedure_materials (clinic_id, procedure_id, item_id, qty, per) VALUES ($1,$2,$3,$4,$5)",
          [auth.clinicId, params.id, m.itemId, m.qty, m.per]);
      }
      await audit(c, auth, "inventory.materials_updated", "procedure", params.id, { before, after: body.items });
      return { ok: true };
    },
  });
}

