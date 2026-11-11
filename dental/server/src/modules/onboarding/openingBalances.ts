// Saldos iniciales del paciente (migración desde el sistema anterior). Solo inserción:
// corregir = asiento de anulación con motivo (monto opuesto), nunca editar ni borrar.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zIdParams } from "../../lib/http.js";
import { audit } from "../../lib/audit.js";
import { conflict, notFound } from "../../lib/errors.js";

export function openingBalanceRoutes(route: Route) {
  route({
    method: "GET", url: "/api/patients/:id/opening-balances", summary: "Saldo inicial del paciente (traído del sistema anterior) y sus anulaciones", tags: ["caja"],
    perm: "payments.read", params: zIdParams,
    handler: async ({ c, params }) => (await c.query(
      `SELECT ob.id, ob.amount_cents AS "amountCents", ob.cutoff_date AS "cutoffDate", ob.description, ob.notes, ob.voids_id AS "voidsId",
              ob.void_reason AS "voidReason", ob.created_at AS "createdAt", u.full_name AS "createdBy", b.name AS "branchName",
              EXISTS (SELECT 1 FROM opening_balances v WHERE v.voids_id = ob.id) AS voided
         FROM opening_balances ob JOIN users u ON u.id = ob.created_by LEFT JOIN branches b ON b.id = ob.branch_id
        WHERE ob.patient_id = $1 ORDER BY ob.created_at`, [params.id])).rows,
  });

  route({
    method: "POST", url: "/api/opening-balances/:id/void", summary: "Anular un saldo inicial cargado por error (asiento opuesto con motivo; el original se conserva)", tags: ["caja"],
    perm: "payments.void", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3, "Escribe el motivo (al menos 3 caracteres)").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const o = (await c.query<{ patient_id: string; amount_cents: number; voids_id: string | null; branch_id: string | null; cutoff_date: string }>(
        "SELECT patient_id, amount_cents, voids_id, branch_id, cutoff_date FROM opening_balances WHERE id = $1", [params.id])).rows[0];
      if (!o) throw notFound("Saldo inicial");
      if (o.voids_id) throw conflict("Ese movimiento ya es una anulación", "invalid_void");
      if ((await c.query("SELECT 1 FROM opening_balances WHERE voids_id = $1", [params.id])).rowCount) throw conflict("Ese saldo inicial ya fue anulado", "already_voided");
      const r = await c.query<{ id: string }>(
        `INSERT INTO opening_balances (clinic_id, patient_id, branch_id, amount_cents, cutoff_date, description, voids_id, void_reason, created_by)
         VALUES ($1,$2,$3,$4,$5,'Anulación del saldo inicial',$6,$7,$8) RETURNING id`,
        [auth.clinicId, o.patient_id, o.branch_id, -o.amount_cents, o.cutoff_date, params.id, body.reason, auth.userId]);
      await audit(c, auth, "opening_balance.voided", "opening_balance", params.id, { reason: body.reason, amountCents: o.amount_cents, patientId: o.patient_id }, o.branch_id);
      return { id: r.rows[0]!.id };
    },
  });
}
