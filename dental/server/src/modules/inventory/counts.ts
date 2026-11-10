// Inventario: conteo físico por sucursal (IN-04).
// Se genera la hoja con el saldo del sistema por lote, se carga lo contado, el sistema propone
// los ajustes por diferencia y la administración los aprueba: se aplican como movimientos.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams, zOptText } from "../../lib/http.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { requireBranch } from "../../lib/rbac.js";
import { nextCounter, type Client } from "../../lib/db.js";
import { scopeBranches } from "./catalog.js";
import { assertBranch, fmtQty, implicitLot, insertMovement, lockStock, takeStock, toMilli, zQtyZero } from "./core.js";

async function loadCount(c: Client, id: string) {
  const h = (await c.query(
    `SELECT k.id, k.number, k.branch_id AS "branchId", b.name AS "branchName", k.status, k.note, k.created_at AS "createdAt", cu.full_name AS "createdByName",
            k.decided_at AS "decidedAt", du.full_name AS "decidedByName", k.decided_note AS "decidedNote"
       FROM inv_counts k JOIN branches b ON b.id = k.branch_id JOIN users cu ON cu.id = k.created_by LEFT JOIN users du ON du.id = k.decided_by
      WHERE k.id = $1`, [id])).rows[0];
  if (!h) throw notFound("Hoja de conteo");
  const lines = (await c.query(
    `SELECT cl.id, cl.item_id AS "itemId", it.sku, it.name AS "itemName", it.category, it.use_unit AS "useUnit", cl.lot_id AS "lotId",
            l.lot_code AS "lotCode", l.expires_on AS "expiresOn", cl.expected_qty AS "expectedQty", cl.counted_qty AS "countedQty",
            l.qty_on_hand AS "currentQty", l.unit_cost AS "unitCost"
       FROM inv_count_lines cl JOIN inv_items it ON it.id = cl.item_id JOIN inv_lots l ON l.id = cl.lot_id
      WHERE cl.count_id = $1 ORDER BY it.category, it.name, l.expires_on NULLS LAST`, [id])).rows.map((l) => {
    const diff = l.countedQty == null ? null : (toMilli(l.countedQty) - toMilli(l.expectedQty)) / 1000;
    return { ...l, difference: diff, valueCents: diff == null ? 0 : Math.round(diff * Number(l.unitCost)) };
  });
  const proposals = lines.filter((l) => l.difference != null && l.difference !== 0);
  return {
    ...h, lines,
    summary: {
      lines: lines.length, counted: lines.filter((l) => l.countedQty != null).length, adjustments: proposals.length,
      differenceCents: proposals.reduce((s, l) => s + l.valueCents, 0),
    },
  };
}

export function inventoryCountRoutes(route: Route) {
  route({
    method: "GET", url: "/api/inventory/counts", summary: "Hojas de conteo físico", tags: ["inventario"], perm: "inventory.read",
    query: z.object({ branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => (await c.query(
      `SELECT k.id, k.number, k.branch_id AS "branchId", b.name AS "branchName", k.status, k.created_at AS "createdAt", k.decided_at AS "decidedAt",
              (SELECT count(*)::int FROM inv_count_lines cl WHERE cl.count_id = k.id) AS lines,
              (SELECT count(*)::int FROM inv_count_lines cl WHERE cl.count_id = k.id AND cl.counted_qty IS NOT NULL) AS counted
         FROM inv_counts k JOIN branches b ON b.id = k.branch_id
        WHERE ($1::uuid[] IS NULL OR k.branch_id = ANY($1)) ORDER BY (k.status = 'open') DESC, k.created_at DESC LIMIT 100`,
      [scopeBranches(auth, query.branchId)])).rows,
  });

  route({
    method: "POST", url: "/api/inventory/counts", summary: "Generar la hoja de conteo de una sucursal (todos los insumos activos)", tags: ["inventario"], perm: "inventory.write",
    body: z.object({ branchId: zId, note: zOptText(500) }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      await assertBranch(c, body.branchId);
      if ((await c.query("SELECT 1 FROM inv_counts WHERE branch_id = $1 AND status = 'open'", [body.branchId])).rowCount) {
        throw conflict("Ya hay una hoja de conteo abierta en esta sucursal: termínala o anúlala antes de crear otra", "count_open");
      }
      const number = await nextCounter(c, auth.clinicId!, "inv_count");
      const id = (await c.query<{ id: string }>(
        "INSERT INTO inv_counts (clinic_id, number, branch_id, note, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
        [auth.clinicId, number, body.branchId, body.note, auth.userId])).rows[0]!.id;
      const items = (await c.query<{ id: string; tracks_lots: boolean }>("SELECT id, tracks_lots FROM inv_items WHERE active ORDER BY id")).rows;
      for (const it of items) {
        await lockStock(c, auth.clinicId!, it.id, body.branchId);
        // Los insumos sin lotes siempre aparecen (aunque estén en cero): así no quedan ocultos.
        if (!it.tracks_lots) await implicitLot(c, auth.clinicId!, it.id, body.branchId);
        await c.query(
          `INSERT INTO inv_count_lines (clinic_id, count_id, item_id, lot_id, expected_qty)
           SELECT $1, $2, l.item_id, l.id, l.qty_on_hand FROM inv_lots l
            WHERE l.item_id = $3 AND l.branch_id = $4 AND (l.qty_on_hand > 0 OR l.lot_code IS NULL)`,
          [auth.clinicId, id, it.id, body.branchId]);
      }
      await audit(c, auth, "inventory.count_created", "inv_count", id, { number }, body.branchId);
      return { id, number };
    },
  });

  route({
    method: "GET", url: "/api/inventory/counts/:id", summary: "Hoja de conteo con las diferencias y los ajustes propuestos", tags: ["inventario"], perm: "inventory.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const k = await loadCount(c, params.id);
      requireBranch(auth, k.branchId);
      return k;
    },
  });

  route({
    method: "PUT", url: "/api/inventory/counts/:id/lines", summary: "Cargar cantidades contadas (vacío = no contado)", tags: ["inventario"], perm: "inventory.write", params: zIdParams,
    body: z.object({ lines: z.array(z.object({ lineId: zId, countedQty: zQtyZero.nullable() })).min(1).max(2000) }),
    handler: async ({ c, auth, params, body }) => {
      const k = (await c.query<{ branch_id: string; status: string }>("SELECT branch_id, status FROM inv_counts WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!k) throw notFound("Hoja de conteo");
      requireBranch(auth, k.branch_id);
      if (k.status !== "open") throw conflict("La hoja de conteo ya fue cerrada");
      for (const [i, l] of body.lines.entries()) {
        const r = await c.query(
          "UPDATE inv_count_lines SET counted_qty = $3, counted_by = $4, counted_at = now() WHERE id = $1 AND count_id = $2",
          [l.lineId, params.id, l.countedQty, auth.userId]);
        if (!r.rowCount) throw new AppError(400, "validation", "Una línea no pertenece a esta hoja", [{ path: `lines.${i}.lineId`, message: "Línea inválida" }]);
      }
      await audit(c, auth, "inventory.count_updated", "inv_count", params.id, { lines: body.lines.length }, k.branch_id);
      return loadCount(c, params.id);
    },
  });

  route({
    method: "POST", url: "/api/inventory/counts/:id/approve", summary: "Aprobar los ajustes propuestos del conteo (se aplican como movimientos)", tags: ["inventario"], perm: "inventory.manage", params: zIdParams,
    body: z.object({ note: zOptText(500) }),
    handler: async ({ c, auth, params, body }) => {
      const k = (await c.query<{ branch_id: string; status: string; number: number }>("SELECT branch_id, status, number FROM inv_counts WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!k) throw notFound("Hoja de conteo");
      requireBranch(auth, k.branch_id);
      if (k.status !== "open") throw conflict("La hoja de conteo ya fue cerrada");
      const lines = (await c.query<{ id: string; item_id: string; lot_id: string; expected_qty: number; counted_qty: number | null; lot_code: string | null; name: string }>(
        `SELECT cl.id, cl.item_id, cl.lot_id, cl.expected_qty, cl.counted_qty, l.lot_code, it.name
           FROM inv_count_lines cl JOIN inv_lots l ON l.id = cl.lot_id JOIN inv_items it ON it.id = cl.item_id
          WHERE cl.count_id = $1 ORDER BY cl.item_id, cl.id`, [params.id])).rows;
      if (!lines.some((l) => l.counted_qty != null)) throw conflict("Carga al menos una cantidad contada antes de aprobar");
      let applied = 0;
      for (const l of lines) {
        if (l.counted_qty == null) continue;
        const diff = toMilli(l.counted_qty) - toMilli(l.expected_qty);
        if (!diff) continue;
        const note = `Conteo N° ${k.number}: sistema ${fmtQty(l.expected_qty)}, contado ${fmtQty(l.counted_qty)}`;
        if (diff > 0) {
          await lockStock(c, auth.clinicId!, l.item_id, k.branch_id);
          await insertMovement(c, auth, { itemId: l.item_id, branchId: k.branch_id, lotId: l.lot_id, kind: "adjustment", qtyMilli: diff, reason: "count", note, countId: params.id });
        } else {
          try {
            await takeStock(c, auth, { itemId: l.item_id, branchId: k.branch_id, lotId: l.lot_id, qtyMilli: -diff, kind: "adjustment", reason: "count", note, countId: params.id, strict: true });
          } catch (e) {
            if (e instanceof AppError && e.code === "insufficient_stock") {
              throw conflict(`«${l.name}»${l.lot_code ? ` (lote ${l.lot_code})` : ""} tuvo movimientos después del conteo y ya no alcanza para restar ${fmtQty(-diff / 1000)}. Vuelve a contar esa línea.`, "count_stale");
            }
            throw e;
          }
        }
        applied++;
      }
      await c.query("UPDATE inv_counts SET status = 'approved', decided_by = $2, decided_at = now(), decided_note = $3 WHERE id = $1", [params.id, auth.userId, body.note]);
      await audit(c, auth, "inventory.count_approved", "inv_count", params.id, { number: k.number, adjustments: applied, note: body.note }, k.branch_id);
      return { ok: true, adjustments: applied };
    },
  });

  route({
    method: "POST", url: "/api/inventory/counts/:id/cancel", summary: "Anular una hoja de conteo abierta (no se aplica ningún ajuste)", tags: ["inventario"], perm: "inventory.manage", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3, "Indica el motivo").max(500) }),
    handler: async ({ c, auth, params, body }) => {
      const k = (await c.query<{ branch_id: string; status: string }>("SELECT branch_id, status FROM inv_counts WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!k) throw notFound("Hoja de conteo");
      requireBranch(auth, k.branch_id);
      if (k.status !== "open") throw conflict("La hoja de conteo ya fue cerrada");
      await c.query("UPDATE inv_counts SET status = 'cancelled', decided_by = $2, decided_at = now(), decided_note = $3 WHERE id = $1", [params.id, auth.userId, body.reason]);
      await audit(c, auth, "inventory.count_cancelled", "inv_count", params.id, { reason: body.reason }, k.branch_id);
      return { ok: true };
    },
  });
}
