// Consumo real frente al estándar (B-072): para los tratamientos REALIZADOS en el período, cuánto
// material se descontó de verdad (movimientos de consumo + lo que quedó pendiente por falta de stock)
// frente a lo que indica el estándar de cada prestación (inv_procedure_materials). Sirve para ver
// desperdicio, recetas de materiales mal cargadas o consumos que no se registran.
import { z } from "zod";
import type { Client } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import { zDate, zId } from "../../lib/http.js";
import { badRequest } from "../../lib/errors.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { addSheet, newWorkbook, sendXlsx, bsCell } from "../management/xlsx.js";
import { scopeBranches } from "./catalog.js";
import { requiredMilli } from "./core.js";

const zQ = z.object({ from: zDate, to: zDate, branchId: zId.optional() });

export async function consumptionReport(c: Client, auth: AuthCtx, q: z.infer<typeof zQ>) {
  if (q.to < q.from) throw badRequest("La fecha final es anterior a la inicial");
  const scope = scopeBranches(auth, q.branchId);
  // Tratamientos realizados en el período (zona de la clínica) en las sucursales permitidas.
  const lines = (await c.query<{ id: string; procedure_id: string; quantity: number; surfaces: string[] }>(
    `SELECT i.id, i.procedure_id, i.quantity, i.surfaces FROM budget_items i JOIN budgets b ON b.id = i.budget_id
      WHERE i.performed_at IS NOT NULL
        AND (i.performed_at AT TIME ZONE (SELECT timezone FROM clinics WHERE id = app_clinic_id()))::date BETWEEN $1::date AND $2::date
        AND ($3::uuid[] IS NULL OR b.branch_id = ANY($3))`, [q.from, q.to, scope])).rows;
  if (!lines.length) return { from: q.from, to: q.to, treatments: 0, items: [] as any[] };
  const ids = lines.map((l) => l.id);
  const mats = (await c.query<{ procedure_id: string; item_id: string; qty: number; per: string }>(
    "SELECT procedure_id, item_id, qty, per FROM inv_procedure_materials WHERE procedure_id = ANY($1)", [[...new Set(lines.map((l) => l.procedure_id))]])).rows;
  const standard = new Map<string, number>(); // item → milli
  for (const l of lines) for (const m of mats.filter((x) => x.procedure_id === l.procedure_id)) {
    standard.set(m.item_id, (standard.get(m.item_id) ?? 0) + requiredMilli(Number(m.qty), m.per, l));
  }
  const actual = (await c.query<{ item_id: string; qty: number; cost: number }>(
    `SELECT item_id, sum(-qty) AS qty, sum(-qty * coalesce(unit_cost, 0)) AS cost FROM inv_movements
      WHERE kind = 'consumption' AND budget_item_id = ANY($1) GROUP BY item_id`, [ids])).rows;
  const pending = (await c.query<{ item_id: string; qty: number }>(
    "SELECT item_id, sum(qty_missing) AS qty FROM inv_pending_consumptions WHERE budget_item_id = ANY($1) AND resolved_at IS NULL GROUP BY item_id", [ids])).rows;
  const itemIds = [...new Set([...standard.keys(), ...actual.map((a) => a.item_id), ...pending.map((p) => p.item_id)])];
  const meta = (await c.query<{ id: string; sku: string; name: string; use_unit: string }>(
    "SELECT id, sku, name, use_unit FROM inv_items WHERE id = ANY($1)", [itemIds])).rows;
  const items = itemIds.map((id) => {
    const m = meta.find((x) => x.id === id)!;
    const std = (standard.get(id) ?? 0) / 1000;
    const a = actual.find((x) => x.item_id === id);
    const act = Number(a?.qty ?? 0);
    const pend = Number(pending.find((x) => x.item_id === id)?.qty ?? 0);
    const used = act + pend;
    return {
      itemId: id, sku: m.sku, name: m.name, unit: m.use_unit, standardQty: std, actualQty: act, pendingQty: pend,
      differenceQty: Math.round((used - std) * 1000) / 1000,
      differencePct: std > 0 ? Math.round(((used - std) / std) * 1000) / 10 : null,
      costCents: Math.round(Number(a?.cost ?? 0)),
    };
  }).sort((x, y) => Math.abs(y.differenceQty) - Math.abs(x.differenceQty) || x.name.localeCompare(y.name));
  return { from: q.from, to: q.to, treatments: lines.length, items };
}

export function consumptionReportRoutes(route: Route) {
  route({
    method: "GET", url: "/api/inventory/consumption-report", summary: "Consumo real frente al estándar de las prestaciones realizadas en un período (por insumo)", tags: ["inventario"],
    perm: "inventory.read", query: zQ,
    handler: async ({ c, auth, query }) => consumptionReport(c, auth, query),
  });
  route({
    method: "GET", url: "/api/inventory/consumption-report.xlsx", summary: "Exportar a Excel el consumo real frente al estándar", tags: ["inventario"],
    perm: "inventory.read", query: zQ, raw: true,
    handler: async ({ c, auth, query, reply }) => {
      const d = await consumptionReport(c, auth, query);
      const wb = newWorkbook();
      addSheet(wb, "Consumo", [
        { header: "SKU", width: 12 }, { header: "Insumo", width: 32 }, { header: "Unidad", width: 10 }, { header: "Estándar", width: 12 },
        { header: "Descontado", width: 12 }, { header: "Pendiente", width: 12 }, { header: "Diferencia", width: 12 }, { header: "Diferencia %", width: 12 }, { header: "Costo (Bs)", money: true },
      ], d.items.map((x) => [x.sku, x.name, x.unit, x.standardQty, x.actualQty, x.pendingQty, x.differenceQty, x.differencePct, bsCell(x.costCents)]),
      { title: `Consumo real frente al estándar · ${d.from} a ${d.to} · ${d.treatments} tratamientos`,
        notes: ["Diferencia = (descontado + pendiente) − estándar. Positiva: se usó más de lo previsto."] });
      await sendXlsx(reply, wb, `consumo-${d.from}-a-${d.to}`);
    },
  });
}
