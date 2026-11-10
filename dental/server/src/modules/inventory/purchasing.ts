// Compras (IN-07, B-024): órdenes de compra borrador → enviada → recibida en parte / recibida → cerrada,
// recepción por lote con vencimiento y costo, rechazo con motivo y sugerencia de reposición.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams, zOptText } from "../../lib/http.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { requireBranch, type AuthCtx } from "../../lib/rbac.js";
import { nextCounter, type Client } from "../../lib/db.js";
import { scopeBranches } from "./catalog.js";
import { assertBranch, assertNotExpired, fmtQty, getItem, insertMovement, lotForIncoming, toMilli, zOptDate, zQty, zQtyZero } from "./core.js";

export const PO_LABELS: Record<string, string> = {
  draft: "Borrador", sent: "Enviada", partial: "Recibida en parte", received: "Recibida", closed: "Cerrada", cancelled: "Anulada",
};

const zLines = z.array(z.object({
  itemId: zId, qty: zQty,
  unitPriceCents: z.number().int("Precio en centavos (entero)").min(0, "El precio no puede ser negativo").max(100_000_000),
})).min(1, "Agrega al menos un insumo").max(100);

async function loadPo(c: Client, id: string) {
  const h = (await c.query(
    `SELECT po.id, po.number, po.status, po.supplier_id AS "supplierId", sp.name AS "supplierName", sp.phone AS "supplierPhone", sp.email AS "supplierEmail",
            sp.contact_name AS "supplierContact", po.branch_id AS "branchId", b.name AS "branchName", po.expected_on AS "expectedOn", po.notes,
            po.created_at AS "createdAt", cu.full_name AS "createdByName", po.sent_at AS "sentAt", su.full_name AS "sentByName",
            po.closed_at AS "closedAt", po.close_note AS "closeNote"
       FROM inv_purchase_orders po JOIN inv_suppliers sp ON sp.id = po.supplier_id JOIN branches b ON b.id = po.branch_id
       JOIN users cu ON cu.id = po.created_by LEFT JOIN users su ON su.id = po.sent_by
      WHERE po.id = $1`, [id])).rows[0];
  if (!h) throw notFound("Orden de compra");
  const lines = (await c.query(
    `SELECT pl.id, pl.item_id AS "itemId", it.sku, it.name AS "itemName", it.purchase_unit AS "purchaseUnit", it.use_unit AS "useUnit",
            it.purchase_factor AS "purchaseFactor", it.tracks_lots AS "tracksLots", pl.qty_ordered AS "qtyOrdered", pl.unit_price_cents AS "unitPriceCents",
            coalesce((SELECT sum(rl.qty_accepted) FROM inv_po_receipt_lines rl WHERE rl.po_line_id = pl.id), 0) AS "qtyAccepted",
            coalesce((SELECT sum(rl.qty_rejected) FROM inv_po_receipt_lines rl WHERE rl.po_line_id = pl.id), 0) AS "qtyRejected"
       FROM inv_po_lines pl JOIN inv_items it ON it.id = pl.item_id WHERE pl.po_id = $1 ORDER BY pl.position, it.name`, [id])).rows
    .map((l) => ({ ...l, qtyPending: Math.max(0, toMilli(l.qtyOrdered) - toMilli(l.qtyAccepted)) / 1000, totalCents: Math.round(Number(l.qtyOrdered) * Number(l.unitPriceCents)) }));
  const receipts = (await c.query(
    `SELECT r.id, r.document_ref AS "documentRef", r.note, r.received_at AS "receivedAt", u.full_name AS "receivedByName",
            json_agg(json_build_object('itemName', it.name, 'qtyAccepted', rl.qty_accepted, 'qtyRejected', rl.qty_rejected, 'rejectReason', rl.reject_reason,
                                       'lotCode', l.lot_code, 'expiresOn', l.expires_on) ORDER BY it.name) AS lines
       FROM inv_po_receipts r JOIN users u ON u.id = r.received_by JOIN inv_po_receipt_lines rl ON rl.receipt_id = r.id
       JOIN inv_po_lines pl ON pl.id = rl.po_line_id JOIN inv_items it ON it.id = pl.item_id LEFT JOIN inv_lots l ON l.id = rl.lot_id
      WHERE r.po_id = $1 GROUP BY r.id, u.full_name ORDER BY r.received_at`, [id])).rows;
  return { ...h, code: `OC-${String(h.number).padStart(4, "0")}`, statusLabel: PO_LABELS[h.status], lines, receipts, totalCents: lines.reduce((s, l) => s + l.totalCents, 0) };
}

async function writeLines(c: Client, auth: AuthCtx, poId: string, lines: z.infer<typeof zLines>) {
  const seen = new Set<string>();
  for (const [i, l] of lines.entries()) {
    if (seen.has(l.itemId)) throw new AppError(400, "validation", "Un insumo aparece dos veces en la orden: suma las cantidades en una sola línea", [{ path: `lines.${i}.itemId`, message: "Insumo repetido" }]);
    seen.add(l.itemId);
    const it = (await c.query<{ active: boolean }>("SELECT active FROM inv_items WHERE id = $1", [l.itemId])).rows[0];
    if (!it?.active) throw new AppError(400, "validation", "El insumo no existe o está inactivo", [{ path: `lines.${i}.itemId`, message: "Insumo no disponible" }]);
  }
  await c.query("DELETE FROM inv_po_lines WHERE po_id = $1", [poId]);
  for (const [i, l] of lines.entries()) {
    await c.query("INSERT INTO inv_po_lines (clinic_id, po_id, item_id, qty_ordered, unit_price_cents, position) VALUES ($1,$2,$3,$4,$5,$6)",
      [auth.clinicId, poId, l.itemId, l.qty, l.unitPriceCents, i]);
  }
}

async function lockPo(c: Client, auth: AuthCtx, id: string) {
  const po = (await c.query<{ status: string; branch_id: string; number: number; supplier_id: string }>(
    "SELECT status, branch_id, number, supplier_id FROM inv_purchase_orders WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!po) throw notFound("Orden de compra");
  requireBranch(auth, po.branch_id);
  return po;
}

async function assertActiveSupplier(c: Client, id: string) {
  const s = (await c.query<{ active: boolean }>("SELECT active FROM inv_suppliers WHERE id = $1", [id])).rows[0];
  if (!s?.active) throw new AppError(400, "validation", "Elige un proveedor activo", [{ path: "supplierId", message: "Proveedor no disponible" }]);
}

export function inventoryPurchasingRoutes(route: Route) {
  route({
    method: "GET", url: "/api/inventory/purchase-orders", summary: "Órdenes de compra de las sucursales permitidas", tags: ["compras"], perm: "inventory.read",
    query: z.object({ branchId: zId.optional(), status: z.enum(["draft", "sent", "partial", "received", "closed", "cancelled"]).optional() }),
    handler: async ({ c, auth, query }) => (await c.query(
      `SELECT po.id, po.number, po.status, sp.name AS "supplierName", b.name AS "branchName", po.branch_id AS "branchId", po.expected_on AS "expectedOn", po.created_at AS "createdAt",
              (SELECT coalesce(round(sum(pl.qty_ordered * pl.unit_price_cents)), 0) FROM inv_po_lines pl WHERE pl.po_id = po.id) AS "totalCents",
              (SELECT count(*)::int FROM inv_po_lines pl WHERE pl.po_id = po.id) AS lines
         FROM inv_purchase_orders po JOIN inv_suppliers sp ON sp.id = po.supplier_id JOIN branches b ON b.id = po.branch_id
        WHERE ($1::uuid[] IS NULL OR po.branch_id = ANY($1)) AND ($2::text IS NULL OR po.status = $2)
        ORDER BY (po.status IN ('draft','sent','partial')) DESC, po.created_at DESC LIMIT 200`,
      [scopeBranches(auth, query.branchId), query.status ?? null])).rows
      .map((r) => ({ ...r, code: `OC-${String(r.number).padStart(4, "0")}`, statusLabel: PO_LABELS[r.status] })),
  });

  route({
    method: "GET", url: "/api/inventory/purchase-orders/:id", summary: "Detalle de la orden: pedido, recibido, rechazado y pendiente por línea, y cada entrega", tags: ["compras"], perm: "inventory.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const po = await loadPo(c, params.id);
      requireBranch(auth, po.branchId);
      return po;
    },
  });

  route({
    method: "POST", url: "/api/inventory/purchase-orders", summary: "Crear una orden de compra en borrador", tags: ["compras"], perm: "inventory.write",
    body: z.object({ supplierId: zId, branchId: zId, expectedOn: zOptDate, notes: zOptText(500), lines: zLines }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      await assertBranch(c, body.branchId);
      await assertActiveSupplier(c, body.supplierId);
      const number = await nextCounter(c, auth.clinicId!, "purchase_order");
      const id = (await c.query<{ id: string }>(
        "INSERT INTO inv_purchase_orders (clinic_id, number, supplier_id, branch_id, expected_on, notes, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [auth.clinicId, number, body.supplierId, body.branchId, body.expectedOn, body.notes, auth.userId])).rows[0]!.id;
      await writeLines(c, auth, id, body.lines);
      await audit(c, auth, "inventory.po_created", "inv_purchase_order", id, { number, supplierId: body.supplierId, lines: body.lines }, body.branchId);
      return { id, number };
    },
  });

  route({
    method: "PUT", url: "/api/inventory/purchase-orders/:id", summary: "Editar una orden en borrador", tags: ["compras"], perm: "inventory.write", params: zIdParams,
    body: z.object({ supplierId: zId, branchId: zId, expectedOn: zOptDate, notes: zOptText(500), lines: zLines }),
    handler: async ({ c, auth, params, body }) => {
      const po = await lockPo(c, auth, params.id);
      if (po.status !== "draft") throw conflict("Solo se editan órdenes en borrador", "invalid_status");
      requireBranch(auth, body.branchId);
      await assertBranch(c, body.branchId);
      await assertActiveSupplier(c, body.supplierId);
      await c.query("UPDATE inv_purchase_orders SET supplier_id = $2, branch_id = $3, expected_on = $4, notes = $5 WHERE id = $1",
        [params.id, body.supplierId, body.branchId, body.expectedOn, body.notes]);
      await writeLines(c, auth, params.id, body.lines);
      await audit(c, auth, "inventory.po_updated", "inv_purchase_order", params.id, { lines: body.lines }, body.branchId);
      return loadPo(c, params.id);
    },
  });

  route({
    method: "POST", url: "/api/inventory/purchase-orders/:id/send", summary: "Aprobar y marcar como enviada al proveedor", tags: ["compras"], perm: "inventory.manage", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const po = await lockPo(c, auth, params.id);
      if (po.status !== "draft") throw conflict("Solo se envían órdenes en borrador", "invalid_status");
      await c.query("UPDATE inv_purchase_orders SET status = 'sent', sent_by = $2, sent_at = now() WHERE id = $1", [params.id, auth.userId]);
      await audit(c, auth, "inventory.po_sent", "inv_purchase_order", params.id, { number: po.number }, po.branch_id);
      return loadPo(c, params.id);
    },
  });

  route({
    method: "POST", url: "/api/inventory/purchase-orders/:id/receive", summary: "Registrar lo que llegó: aceptado por lote (con vencimiento y costo) y rechazado con motivo", tags: ["compras"], perm: "inventory.write", params: zIdParams,
    body: z.object({
      documentRef: zOptText(60), note: zOptText(500),
      lines: z.array(z.object({
        lineId: zId, qtyAccepted: zQtyZero.default(0), qtyRejected: zQtyZero.default(0), rejectReason: zOptText(300),
        lotCode: zOptText(60), expiresOn: zOptDate,
        unitPriceCents: z.number().int("Precio en centavos (entero)").min(0).max(100_000_000).nullish(),
      })).min(1).max(100),
    }),
    handler: async ({ c, auth, params, body }) => {
      const po = await lockPo(c, auth, params.id);
      if (!["sent", "partial"].includes(po.status)) throw conflict("Solo se recibe mercadería de órdenes enviadas o recibidas en parte", "invalid_status");
      const current = (await loadPo(c, params.id)).lines;
      const work = body.lines.map((l, i) => ({ ...l, i, line: current.find((x: { id: string }) => x.id === l.lineId) }));
      for (const w of work) {
        const p = (k: string) => `lines.${w.i}.${k}`;
        if (!w.line) throw new AppError(400, "validation", "Una línea no pertenece a esta orden", [{ path: p("lineId"), message: "Línea inválida" }]);
        if (w.qtyAccepted > w.line.qtyPending + 1e-9) {
          throw new AppError(400, "validation", `«${w.line.itemName}»: quedan ${fmtQty(w.line.qtyPending)} ${w.line.purchaseUnit} pendientes; no puedes aceptar más`, [{ path: p("qtyAccepted"), message: `Máximo ${fmtQty(w.line.qtyPending)}` }]);
        }
        if (w.qtyRejected > 0 && (!w.rejectReason || w.rejectReason.length < 3)) {
          throw new AppError(400, "validation", `«${w.line.itemName}»: indica el motivo del rechazo`, [{ path: p("rejectReason"), message: "Motivo obligatorio" }]);
        }
      }
      const effective = work.filter((w) => w.qtyAccepted > 0 || w.qtyRejected > 0);
      if (!effective.length) throw new AppError(400, "validation", "Indica cuánto llegó (aceptado o rechazado) en al menos una línea");
      const receiptId = (await c.query<{ id: string }>(
        "INSERT INTO inv_po_receipts (clinic_id, po_id, document_ref, note, received_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [auth.clinicId, params.id, body.documentRef, body.note, auth.userId])).rows[0]!.id;
      for (const w of effective) {
        const line = w.line!;
        const price = w.unitPriceCents ?? Number(line.unitPriceCents);
        let lotId: string | null = null;
        if (w.qtyAccepted > 0) {
          const item = await getItem(c, line.itemId);
          await assertNotExpired(c, auth.clinicId!, w.expiresOn, `lines.${w.i}.expiresOn`);
          lotId = await lotForIncoming(c, auth.clinicId!, item, po.branch_id, w.lotCode, w.expiresOn, po.supplier_id, `lines.${w.i}.`);
          const factor = Number(item.purchase_factor);
          const qtyMilli = Math.round(toMilli(w.qtyAccepted) * factor);
          await insertMovement(c, auth, {
            itemId: item.id, branchId: po.branch_id, lotId, kind: "purchase", qtyMilli, unitCost: price / factor, poReceiptId: receiptId,
            note: `OC-${String(po.number).padStart(4, "0")}${body.documentRef ? ` · Doc. ${body.documentRef}` : ""}`,
          });
        }
        await c.query(
          `INSERT INTO inv_po_receipt_lines (clinic_id, receipt_id, po_line_id, qty_accepted, qty_rejected, reject_reason, lot_id, unit_price_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [auth.clinicId, receiptId, line.id, w.qtyAccepted, w.qtyRejected, w.qtyRejected > 0 ? w.rejectReason : null, lotId, price]);
      }
      const after = (await loadPo(c, params.id)).lines;
      const status = after.every((l: { qtyPending: number }) => l.qtyPending <= 0) ? "received" : "partial";
      await c.query("UPDATE inv_purchase_orders SET status = $2 WHERE id = $1", [params.id, status]);
      await audit(c, auth, "inventory.po_received", "inv_purchase_order", params.id, {
        number: po.number, receiptId, documentRef: body.documentRef, status,
        lines: effective.map((w) => ({ lineId: w.lineId, accepted: w.qtyAccepted, rejected: w.qtyRejected, reason: w.rejectReason, lotCode: w.lotCode, expiresOn: w.expiresOn })),
      }, po.branch_id);
      return loadPo(c, params.id);
    },
  });

  route({
    method: "POST", url: "/api/inventory/purchase-orders/:id/close", summary: "Cerrar la orden con lo recibido (lo pendiente ya no se espera)", tags: ["compras"], perm: "inventory.manage", params: zIdParams,
    body: z.object({ note: zOptText(500) }),
    handler: async ({ c, auth, params, body }) => {
      const po = await lockPo(c, auth, params.id);
      if (!["partial", "received"].includes(po.status)) throw conflict("Solo se cierran órdenes recibidas o recibidas en parte (las demás se anulan)", "invalid_status");
      if (po.status === "partial" && (!body.note || body.note.length < 3)) {
        throw new AppError(400, "validation", "Quedan insumos pendientes: indica por qué se cierra la orden", [{ path: "note", message: "Motivo obligatorio" }]);
      }
      await c.query("UPDATE inv_purchase_orders SET status = 'closed', closed_by = $2, closed_at = now(), close_note = $3 WHERE id = $1", [params.id, auth.userId, body.note]);
      await audit(c, auth, "inventory.po_closed", "inv_purchase_order", params.id, { number: po.number, from: po.status, note: body.note }, po.branch_id);
      return loadPo(c, params.id);
    },
  });

  route({
    method: "POST", url: "/api/inventory/purchase-orders/:id/cancel", summary: "Anular una orden en borrador o enviada (sin recepciones)", tags: ["compras"], perm: "inventory.manage", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3, "Indica el motivo").max(500) }),
    handler: async ({ c, auth, params, body }) => {
      const po = await lockPo(c, auth, params.id);
      if (!["draft", "sent"].includes(po.status)) throw conflict("Solo se anulan órdenes en borrador o enviadas sin recepciones; las demás se cierran", "invalid_status");
      await c.query("UPDATE inv_purchase_orders SET status = 'cancelled', closed_by = $2, closed_at = now(), close_note = $3 WHERE id = $1", [params.id, auth.userId, body.reason]);
      await audit(c, auth, "inventory.po_cancelled", "inv_purchase_order", params.id, { number: po.number, reason: body.reason }, po.branch_id);
      return loadPo(c, params.id);
    },
  });

  route({
    method: "GET", url: "/api/inventory/reorder", summary: "Sugerencia de reposición: insumos bajo el mínimo, con la cantidad según el consumo promedio de 60 días y lo ya pedido", tags: ["compras"], perm: "inventory.read",
    query: z.object({ branchId: zId }),
    handler: async ({ c, auth, query }) => {
      requireBranch(auth, query.branchId);
      const rows = (await c.query(
        `SELECT it.id AS "itemId", it.sku, it.name, it.use_unit AS "useUnit", it.purchase_unit AS "purchaseUnit", it.purchase_factor AS "purchaseFactor",
                it.preferred_supplier_id AS "supplierId", sp.name AS "supplierName", s.qty_on_hand AS qty, s.min_qty AS "minQty",
                coalesce((SELECT sum(-m.qty) FROM inv_movements m WHERE m.item_id = it.id AND m.branch_id = s.branch_id AND m.kind = 'consumption'
                           AND m.created_at >= now() - interval '60 days'), 0) AS "consumed60",
                coalesce((SELECT sum(greatest(pl.qty_ordered - coalesce((SELECT sum(rl.qty_accepted) FROM inv_po_receipt_lines rl WHERE rl.po_line_id = pl.id), 0), 0))
                            FROM inv_po_lines pl JOIN inv_purchase_orders po ON po.id = pl.po_id
                           WHERE pl.item_id = it.id AND po.branch_id = s.branch_id AND po.status IN ('draft','sent','partial')), 0) AS "onOrderPurchase",
                (SELECT pl.unit_price_cents FROM inv_po_lines pl JOIN inv_purchase_orders po ON po.id = pl.po_id
                  WHERE pl.item_id = it.id AND po.status <> 'cancelled' ORDER BY po.created_at DESC LIMIT 1) AS "lastPriceCents"
           FROM inv_stock s JOIN inv_items it ON it.id = s.item_id LEFT JOIN inv_suppliers sp ON sp.id = it.preferred_supplier_id
          WHERE s.branch_id = $1 AND it.active AND s.min_qty > 0 AND s.qty_on_hand < s.min_qty
          ORDER BY sp.name NULLS LAST, it.name`, [query.branchId])).rows;
      return rows.map((r) => {
        const f = Number(r.purchaseFactor);
        const monthly = Number(r.consumed60) / 2; // consumo promedio de 30 días (últimos 60)
        const onOrder = Number(r.onOrderPurchase) * f;
        const needUse = Math.max(0, Number(r.minQty) + monthly - Number(r.qty) - onOrder);
        return { ...r, avgMonthly: Math.round(monthly * 1000) / 1000, onOrder, suggestedPurchase: Math.ceil(needUse / f - 1e-9) };
      });
    },
  });
}
