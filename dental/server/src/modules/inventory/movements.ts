// Inventario: entradas por compra directa, consumo (FEFO o lote elegido), ajustes con motivo,
// historial de movimientos, consumos pendientes y transferencias en dos pasos.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../../lib/http.js";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { can, requireBranch } from "../../lib/rbac.js";
import { nextCounter } from "../../lib/db.js";
import { scopeBranches } from "./catalog.js";
import {
  assertBranch, assertNotExpired, fmtQty, fromMilli, getItem, insertMovement, lotForIncoming, MOVEMENT_LABELS, REASON_LABELS, takeStock, toMilli, zOptDate, zQty,
} from "./core.js";

const zReason = z.enum(["count", "breakage", "expiry", "other"], { message: "Elige el motivo del ajuste" });

export function inventoryMovementRoutes(route: Route) {
  route({
    method: "POST", url: "/api/inventory/receipts", summary: "Ingresar una compra directa (sin orden de compra): crea o suma al lote", tags: ["inventario"], perm: "inventory.write",
    body: z.object({
      branchId: zId, itemId: zId, qty: zQty, unit: z.enum(["purchase", "use"]).default("purchase"),
      unitPriceCents: z.number().int("Precio en centavos (entero)").min(0, "El precio no puede ser negativo").max(100_000_000),
      lotCode: zOptText(60), expiresOn: zOptDate, supplierId: zId.nullish().transform((v) => v ?? null), documentRef: zOptText(60), note: zOptText(500),
    }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      await assertBranch(c, body.branchId);
      const item = await getItem(c, body.itemId);
      if (!item.active) throw conflict("Ese insumo está inactivo");
      const factor = body.unit === "purchase" ? Number(item.purchase_factor) : 1;
      const qtyMilli = toMilli(body.qty) * factor;
      if (!Number.isInteger(qtyMilli)) throw new AppError(400, "validation", "La cantidad convertida tiene más de 3 decimales", [{ path: "qty", message: "Revisa la cantidad" }]);
      await assertNotExpired(c, auth.clinicId!, body.expiresOn, "expiresOn");
      const lotId = await lotForIncoming(c, auth.clinicId!, item, body.branchId, body.lotCode, body.expiresOn, body.supplierId);
      const unitCost = body.unitPriceCents / factor;
      const note = [body.documentRef ? `Doc. ${body.documentRef}` : null, body.note].filter(Boolean).join(" · ") || null;
      const id = await insertMovement(c, auth, { itemId: item.id, branchId: body.branchId, lotId, kind: "purchase", qtyMilli, unitCost, note });
      await audit(c, auth, "inventory.receipt", "inv_movement", id, { itemId: item.id, qty: qtyMilli / 1000, lotId, unitPriceCents: body.unitPriceCents, unit: body.unit }, body.branchId);
      return { id, lotId, qty: qtyMilli / 1000 };
    },
  });

  route({
    method: "POST", url: "/api/inventory/consume", summary: "Registrar consumo (FEFO automático o lote elegido). Nunca deja stock negativo.", tags: ["inventario"], perm: "inventory.write",
    body: z.object({ branchId: zId, itemId: zId, qty: zQty, lotId: zId.nullish(), note: zOptText(500) }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      await assertBranch(c, body.branchId);
      const r = await takeStock(c, auth, { itemId: body.itemId, branchId: body.branchId, qtyMilli: toMilli(body.qty), lotId: body.lotId ?? null, kind: "consumption", note: body.note, strict: true });
      await audit(c, auth, "inventory.consumed", "inv_item", body.itemId, { qty: body.qty, lots: r.parts.map((p) => ({ lotId: p.lotId, qty: p.qtyMilli / 1000 })), chosenLot: body.lotId ?? null }, body.branchId);
      return { movements: r.movementIds, parts: r.parts.map((p) => ({ lotId: p.lotId, qty: p.qtyMilli / 1000 })) };
    },
  });

  route({
    method: "POST", url: "/api/inventory/adjust", summary: "Ajuste positivo o negativo con motivo obligatorio (conteo, rotura, vencimiento, otro)", tags: ["inventario"], perm: "inventory.write",
    body: z.object({
      branchId: zId, itemId: zId, direction: z.enum(["in", "out"], { message: "Indica si suma o resta" }), qty: zQty, reason: zReason, note: zOptText(500),
      lotId: zId.nullish(), lotCode: zOptText(60), expiresOn: zOptDate,
    }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      await assertBranch(c, body.branchId);
      if (body.reason === "other" && (!body.note || body.note.length < 3)) {
        throw new AppError(400, "validation", "Con el motivo «Otro» explica qué pasó", [{ path: "note", message: "Describe el motivo (mínimo 3 caracteres)" }]);
      }
      const item = await getItem(c, body.itemId);
      const qtyMilli = toMilli(body.qty);
      let movements: string[];
      if (body.direction === "out") {
        if (item.tracks_lots && !body.lotId) throw new AppError(400, "validation", "Elige el lote del que se descuenta", [{ path: "lotId", message: "Elige el lote" }]);
        const r = await takeStock(c, auth, { itemId: item.id, branchId: body.branchId, qtyMilli, lotId: body.lotId ?? null, kind: "adjustment", reason: body.reason, note: body.note, strict: true });
        movements = r.movementIds;
      } else {
        let lotId: string;
        if (body.lotId) {
          const l = (await c.query<{ item_id: string; branch_id: string }>("SELECT item_id, branch_id FROM inv_lots WHERE id = $1", [body.lotId])).rows[0];
          if (!l || l.item_id !== item.id || l.branch_id !== body.branchId) throw new AppError(400, "validation", "El lote elegido no corresponde a este insumo en esta sucursal", [{ path: "lotId", message: "Lote no válido" }]);
          lotId = body.lotId;
        } else {
          lotId = await lotForIncoming(c, auth.clinicId!, item, body.branchId, body.lotCode, body.expiresOn);
        }
        movements = [await insertMovement(c, auth, { itemId: item.id, branchId: body.branchId, lotId, kind: "adjustment", qtyMilli, reason: body.reason, note: body.note })];
      }
      await audit(c, auth, "inventory.adjusted", "inv_item", item.id, { direction: body.direction, qty: body.qty, reason: body.reason, note: body.note, lotId: body.lotId ?? null }, body.branchId);
      return { movements };
    },
  });

  route({
    method: "GET", url: "/api/inventory/movements", summary: "Historial de movimientos con filtros (sucursal, insumo, tipo, fechas)", tags: ["inventario"], perm: "inventory.read",
    query: z.object({
      branchId: zId.optional(), itemId: zId.optional(), kind: z.enum(["purchase", "consumption", "adjustment", "transfer_out", "transfer_in"]).optional(),
      from: zDate.optional(), to: zDate.optional(), limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
    handler: async ({ c, auth, query }) => {
      const scope = scopeBranches(auth, query.branchId);
      const rows = (await c.query(
        `SELECT m.id, m.kind, m.qty, m.unit_cost AS "unitCost", m.reason, m.note, m.created_at AS "createdAt",
                m.item_id AS "itemId", it.sku, it.name AS "itemName", it.use_unit AS "useUnit",
                m.branch_id AS "branchId", b.name AS "branchName", l.lot_code AS "lotCode", l.expires_on AS "expiresOn",
                u.full_name AS "userName", m.transfer_id AS "transferId", m.count_id AS "countId", m.budget_item_id AS "budgetItemId",
                po.number AS "poNumber", t.number AS "transferNumber", cn.number AS "countNumber"
           FROM inv_movements m JOIN inv_items it ON it.id = m.item_id JOIN branches b ON b.id = m.branch_id JOIN inv_lots l ON l.id = m.lot_id
           LEFT JOIN users u ON u.id = m.created_by
           LEFT JOIN inv_po_receipts pr ON pr.id = m.po_receipt_id LEFT JOIN inv_purchase_orders po ON po.id = pr.po_id
           LEFT JOIN inv_transfers t ON t.id = m.transfer_id LEFT JOIN inv_counts cn ON cn.id = m.count_id
          WHERE ($1::uuid[] IS NULL OR m.branch_id = ANY($1)) AND ($2::uuid IS NULL OR m.item_id = $2) AND ($3::text IS NULL OR m.kind = $3)
            AND ($4::date IS NULL OR m.created_at >= ($4::date)::timestamp AT TIME ZONE (SELECT timezone FROM clinics WHERE id = m.clinic_id))
            AND ($5::date IS NULL OR m.created_at < ($5::date + 1)::timestamp AT TIME ZONE (SELECT timezone FROM clinics WHERE id = m.clinic_id))
          ORDER BY m.created_at DESC, m.id LIMIT $6`,
        [scope, query.itemId ?? null, query.kind ?? null, query.from ?? null, query.to ?? null, query.limit])).rows;
      return rows.map((r) => ({ ...r, kindLabel: MOVEMENT_LABELS[r.kind], reasonLabel: r.reason ? REASON_LABELS[r.reason] : null }));
    },
  });

  route({
    method: "POST", url: "/api/inventory/pending/:id/resolve", summary: "Regularizar un consumo pendiente: descontarlo ahora o descartarlo con motivo", tags: ["inventario"], perm: "inventory.write", params: zIdParams,
    body: z.object({ action: z.enum(["consume", "dismiss"]), note: zOptText(300) }),
    handler: async ({ c, auth, params, body }) => {
      const p = (await c.query<{ branch_id: string; item_id: string; qty_missing: number; budget_item_id: string | null; appointment_id: string | null; resolved_at: string | null }>(
        "SELECT branch_id, item_id, qty_missing, budget_item_id, appointment_id, resolved_at FROM inv_pending_consumptions WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!p) throw notFound("Consumo pendiente");
      requireBranch(auth, p.branch_id);
      if (p.resolved_at) throw conflict("Ese consumo pendiente ya fue regularizado");
      if (body.action === "dismiss") {
        if (!can(auth, "inventory.manage")) throw forbidden("Solo la administración puede descartar un consumo pendiente");
        if (!body.note || body.note.length < 3) throw new AppError(400, "validation", "Indica por qué se descarta", [{ path: "note", message: "Motivo obligatorio" }]);
      } else {
        await takeStock(c, auth, {
          itemId: p.item_id, branchId: p.branch_id, qtyMilli: toMilli(p.qty_missing), kind: "consumption", strict: true,
          budgetItemId: p.budget_item_id, appointmentId: p.appointment_id, pendingId: params.id, note: body.note ?? "Regularización de consumo pendiente",
        });
      }
      await c.query("UPDATE inv_pending_consumptions SET resolved_by = $2, resolved_at = now(), resolution = $3, resolution_note = $4 WHERE id = $1",
        [params.id, auth.userId, body.action === "consume" ? "consumed" : "dismissed", body.note]);
      await audit(c, auth, "inventory.pending_resolved", "inv_pending_consumption", params.id, { action: body.action, note: body.note }, p.branch_id);
      return { ok: true };
    },
  });

  // ---------------- Transferencias en dos pasos ----------------
  route({
    method: "GET", url: "/api/inventory/transfers", summary: "Transferencias (enviadas y por recibir) de las sucursales permitidas", tags: ["inventario"], perm: "inventory.read",
    query: z.object({ branchId: zId.optional(), status: z.enum(["in_transit", "received"]).optional() }),
    handler: async ({ c, auth, query }) => {
      const scope = scopeBranches(auth, query.branchId);
      const ts = (await c.query(
        `SELECT t.id, t.number, t.status, t.note, t.from_branch_id AS "fromBranchId", fb.name AS "fromBranchName", t.to_branch_id AS "toBranchId", tb.name AS "toBranchName",
                t.sent_at AS "sentAt", su.full_name AS "sentByName", t.received_at AS "receivedAt", ru.full_name AS "receivedByName", t.receive_note AS "receiveNote"
           FROM inv_transfers t JOIN branches fb ON fb.id = t.from_branch_id JOIN branches tb ON tb.id = t.to_branch_id
           JOIN users su ON su.id = t.sent_by LEFT JOIN users ru ON ru.id = t.received_by
          WHERE ($1::uuid[] IS NULL OR t.from_branch_id = ANY($1) OR t.to_branch_id = ANY($1)) AND ($2::text IS NULL OR t.status = $2)
          ORDER BY (t.status = 'in_transit') DESC, t.sent_at DESC LIMIT 200`, [scope, query.status ?? null])).rows;
      const lines = ts.length ? (await c.query(
        `SELECT tl.id, tl.transfer_id AS "transferId", tl.item_id AS "itemId", it.sku, it.name AS "itemName", it.use_unit AS "useUnit",
                l.lot_code AS "lotCode", l.expires_on AS "expiresOn", tl.qty_sent AS "qtySent", tl.qty_received AS "qtyReceived", tl.difference_reason AS "differenceReason"
           FROM inv_transfer_lines tl JOIN inv_items it ON it.id = tl.item_id JOIN inv_lots l ON l.id = tl.from_lot_id
          WHERE tl.transfer_id = ANY($1) ORDER BY it.name, l.expires_on NULLS LAST`, [ts.map((t) => t.id)])).rows : [];
      return ts.map((t) => ({ ...t, lines: lines.filter((l) => l.transferId === t.id) }));
    },
  });

  route({
    method: "POST", url: "/api/inventory/transfers", summary: "Enviar insumos a otra sucursal (sale del origen y queda «en tránsito»)", tags: ["inventario"], perm: "inventory.write",
    body: z.object({
      fromBranchId: zId, toBranchId: zId, note: zOptText(500),
      lines: z.array(z.object({ itemId: zId, qty: zQty, lotId: zId.nullish() })).min(1, "Agrega al menos un insumo").max(50),
    }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.fromBranchId);
      if (body.fromBranchId === body.toBranchId) throw new AppError(400, "validation", "Elige una sucursal de destino distinta", [{ path: "toBranchId", message: "Debe ser otra sucursal" }]);
      await assertBranch(c, body.fromBranchId);
      await assertBranch(c, body.toBranchId);
      const number = await nextCounter(c, auth.clinicId!, "inv_transfer");
      const id = (await c.query<{ id: string }>(
        "INSERT INTO inv_transfers (clinic_id, number, from_branch_id, to_branch_id, note, sent_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [auth.clinicId, number, body.fromBranchId, body.toBranchId, body.note, auth.userId])).rows[0]!.id;
      for (const [i, ln] of body.lines.entries()) {
        let r;
        try {
          r = await takeStock(c, auth, { itemId: ln.itemId, branchId: body.fromBranchId, qtyMilli: toMilli(ln.qty), lotId: ln.lotId ?? null, kind: "transfer_out", strict: true, transferId: id });
        } catch (e) {
          if (e instanceof AppError && Array.isArray(e.details)) e.details = (e.details as { path: string; message: string }[]).map((d) => ({ ...d, path: `lines.${i}.${d.path}` }));
          throw e;
        }
        for (const p of r.parts) {
          await c.query("INSERT INTO inv_transfer_lines (clinic_id, transfer_id, item_id, from_lot_id, qty_sent) VALUES ($1,$2,$3,$4,$5)",
            [auth.clinicId, id, ln.itemId, p.lotId, fromMilli(p.qtyMilli)]);
        }
      }
      await audit(c, auth, "inventory.transfer_sent", "inv_transfer", id, { number, to: body.toBranchId, lines: body.lines }, body.fromBranchId);
      return { id, number };
    },
  });

  route({
    method: "POST", url: "/api/inventory/transfers/:id/receive", summary: "Recibir una transferencia en la sucursal destino, registrando diferencias", tags: ["inventario"], perm: "inventory.write", params: zIdParams,
    body: z.object({
      note: zOptText(500),
      lines: z.array(z.object({ lineId: zId, qtyReceived: z.number().min(0, "No puede ser negativo").max(1_000_000), reason: zOptText(300) })).min(1),
    }),
    handler: async ({ c, auth, params, body }) => {
      const t = (await c.query<{ status: string; to_branch_id: string; from_branch_id: string; number: number }>(
        "SELECT status, to_branch_id, from_branch_id, number FROM inv_transfers WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!t) throw notFound("Transferencia");
      requireBranch(auth, t.to_branch_id);
      if (t.status !== "in_transit") throw conflict("Esa transferencia ya fue recibida", "already_received");
      const lines = (await c.query<{ id: string; item_id: string; from_lot_id: string; qty_sent: number; lot_code: string | null; expires_on: string | null; supplier_id: string | null }>(
        `SELECT tl.id, tl.item_id, tl.from_lot_id, tl.qty_sent, l.lot_code, l.expires_on, l.supplier_id
           FROM inv_transfer_lines tl JOIN inv_lots l ON l.id = tl.from_lot_id WHERE tl.transfer_id = $1 ORDER BY tl.id`, [params.id])).rows;
      const given = new Map(body.lines.map((l, i) => [l.lineId, { ...l, i }]));
      if (given.size !== lines.length || lines.some((l) => !given.has(l.id))) throw new AppError(400, "validation", "Indica lo recibido en todas las líneas de la transferencia");
      const diffs: { lineId: string; sent: number; received: number; reason: string | null }[] = [];
      for (const ln of lines) {
        const g = given.get(ln.id)!;
        const sent = toMilli(ln.qty_sent), rec = toMilli(g.qtyReceived);
        if (Math.abs(rec - g.qtyReceived * 1000) > 1e-6) throw new AppError(400, "validation", "Usa como máximo 3 decimales", [{ path: `lines.${g.i}.qtyReceived`, message: "Máximo 3 decimales" }]);
        if (rec > sent) throw new AppError(400, "validation", `No puedes recibir más de lo enviado (${fmtQty(sent / 1000)})`, [{ path: `lines.${g.i}.qtyReceived`, message: `Máximo ${fmtQty(sent / 1000)}` }]);
        if (rec < sent && (!g.reason || g.reason.length < 3)) {
          throw new AppError(400, "validation", "Llegó menos de lo enviado: explica la diferencia", [{ path: `lines.${g.i}.reason`, message: "Explica la diferencia" }]);
        }
        let toLot: string | null = null;
        if (rec > 0) {
          const item = await getItem(c, ln.item_id);
          toLot = await lotForIncoming(c, auth.clinicId!, item, t.to_branch_id, ln.lot_code, ln.expires_on, ln.supplier_id);
          const cost = (await c.query<{ unit_cost: number }>(
            "SELECT unit_cost FROM inv_movements WHERE transfer_id = $1 AND lot_id = $2 AND kind = 'transfer_out' ORDER BY created_at LIMIT 1", [params.id, ln.from_lot_id])).rows[0]?.unit_cost ?? 0;
          await insertMovement(c, auth, { itemId: ln.item_id, branchId: t.to_branch_id, lotId: toLot, kind: "transfer_in", qtyMilli: rec, unitCost: Number(cost), transferId: params.id,
            note: rec < sent ? `Diferencia: ${g.reason}` : null });
        }
        await c.query("UPDATE inv_transfer_lines SET to_lot_id = $2, qty_received = $3, difference_reason = $4 WHERE id = $1",
          [ln.id, toLot, fromMilli(rec), rec < sent ? g.reason : null]);
        if (rec !== sent) diffs.push({ lineId: ln.id, sent: sent / 1000, received: rec / 1000, reason: g.reason });
      }
      await c.query("UPDATE inv_transfers SET status = 'received', received_by = $2, received_at = now(), receive_note = $3 WHERE id = $1", [params.id, auth.userId, body.note]);
      await audit(c, auth, "inventory.transfer_received", "inv_transfer", params.id, { number: t.number, differences: diffs }, t.to_branch_id);
      return { ok: true, differences: diffs.length };
    },
  });
}
