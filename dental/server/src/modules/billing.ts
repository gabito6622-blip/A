// Presupuestos, tratamientos realizados (cargos) y pagos.
import { z } from "zod";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zMoney, zOptText } from "../lib/http.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { nextCounter, type Client } from "../lib/db.js";
import { allowedBranches, requireBranch } from "../lib/rbac.js";
import { CONDITIONS } from "./clinical.js";
import { clinicZone } from "./agenda.js";
import { dayBounds } from "../lib/slots.js";
import { assertCashSessionForPayment } from "./cashSessions.js";
import { consumeForTreatment } from "./inventory/index.js";
import { budgetExtras, budgetMoney, lineDiscount, onChargeVoided, patientMoney, performPendingSessions, recalcBudget, supersededError, zGlobalDiscount, zPercent } from "./budgets-v2-core.js";
import { AGREEMENT_INSERT_COLS, agreementBudgetExtras, agreementLineFields, budgetAgreementContext, budgetCompanyShareCents } from "./agreements/core.js";

const BUDGET_TRANSITIONS: Record<string, string[]> = {
  draft: ["presented", "cancelled"],
  presented: ["accepted", "rejected", "draft"],
  accepted: ["cancelled"],
  rejected: ["draft"],
  cancelled: [],
  completed: [],
  superseded: [],
};

export const BUDGET_LABELS: Record<string, string> = {
  draft: "Borrador", presented: "Presentado", accepted: "Aceptado", rejected: "Rechazado", cancelled: "Anulado", completed: "Completado", superseded: "Reemplazado",
};

export const METHOD_LABELS: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", qr: "QR", card: "Tarjeta" };

const itemBody = z.object({
  procedureId: zId,
  tooth: z.number().int().nullish().transform((v) => v ?? null),
  surfaces: z.array(z.enum(["M", "D", "O", "V", "L"])).max(5).default([]),
  description: zOptText(200),
  quantity: z.number().int().min(1).max(100).default(1),
  unitPriceCents: zMoney.optional(),
  discountCents: zMoney.default(0),
  discountPercent: zPercent.nullish(),
  applyAgreement: z.boolean().default(true), // convenio del paciente (precio y parte de la empresa copiados en la línea)
});

async function loadBudget(c: Client, id: string) {
  const b = (
    await c.query(
      `SELECT b.id, b.number, b.version, b.branch_id AS "branchId", b.patient_id AS "patientId", b.dentist_id AS "dentistId", b.status,
              b.installments, b.notes, b.valid_until AS "validUntil", b.created_at AS "createdAt", b.presented_at AS "presentedAt",
              b.decided_at AS "decidedAt", b.decided_note AS "decidedNote",
              p.first_name || ' ' || p.last_name AS "patientName", u.full_name AS "dentistName", br.name AS "branchName"
         FROM budgets b JOIN patients p ON p.id = b.patient_id JOIN users u ON u.id = b.dentist_id JOIN branches br ON br.id = b.branch_id
        WHERE b.id = $1`,
      [id],
    )
  ).rows[0];
  if (!b) throw notFound("Presupuesto");
  const items = (
    await c.query(
      `SELECT i.id, i.procedure_id AS "procedureId", pr.code AS "procedureCode", i.tooth, i.surfaces, i.description, i.quantity,
              i.unit_price_cents AS "unitPriceCents", i.discount_cents AS "discountCents", i.discount_percent AS "discountPercent",
              i.unit_price_cents * i.quantity AS "grossCents", i.global_discount_cents AS "globalDiscountCents", i.net_cents AS "totalCents", i.status, i.performed_at AS "performedAt",
              u.full_name AS "performedByName"
         FROM budget_items i JOIN procedures pr ON pr.id = i.procedure_id LEFT JOIN users u ON u.id = i.performed_by
        WHERE i.budget_id = $1 ORDER BY i.position, i.id`,
      [id],
    )
  ).rows;
  const money = await budgetMoney(c, id);
  const pay = { confirmed: Number(money.paidCents), pending: Number(money.pendingCents) };
  const totalCents = Number(money.totalCents);
  const doneCents = Number(money.performedCents);
  const n = b.installments as number;
  const base = Math.floor(totalCents / n);
  const plan = Array.from({ length: n }, (_, k) => (k === n - 1 ? totalCents - base * (n - 1) : base));
  return {
    ...b, statusLabel: BUDGET_LABELS[b.status], items, totalCents, doneCents,
    paidCents: pay.confirmed, pendingVerificationCents: pay.pending, // remainingCents: saldo a cargo del paciente (agreementBudgetExtras)
    installmentPlan: plan, allowedTransitions: BUDGET_TRANSITIONS[b.status],
    ...(await budgetExtras(c, { id, items })),
    ...(await agreementBudgetExtras(c, id, items, { totalCents, paidCents: pay.confirmed })), // saldo a cargo del paciente
  };
}

async function insertItems(c: Client, clinicId: string, budgetId: string, items: z.infer<typeof itemBody>[]) {
  let pos = 0;
  const ag = await budgetAgreementContext(c, budgetId);
  for (const it of items) {
    const pr = (await c.query<{ id: string; name: string; price_cents: number; scope: string; category: string }>("SELECT id, name, price_cents, scope, category FROM procedures WHERE id = $1 AND active", [it.procedureId])).rows[0];
    if (!pr) throw badRequest("Prestación inexistente o inactiva");
    if ((pr.scope === "tooth" || pr.scope === "surface") && !it.tooth) throw badRequest(`"${pr.name}" requiere indicar la pieza dental`);
    if (pr.scope === "surface" && !it.surfaces.length) throw badRequest(`"${pr.name}" requiere indicar superficies`);
    const { unit, cols } = agreementLineFields(ag, it.applyAgreement, pr, it.unitPriceCents);
    const disc = lineDiscount(unit * it.quantity, it);
    await c.query(
      `INSERT INTO budget_items (clinic_id, budget_id, procedure_id, tooth, surfaces, description, quantity, unit_price_cents, discount_cents, discount_percent, position, ${AGREEMENT_INSERT_COLS})
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)`,
      [clinicId, budgetId, it.procedureId, it.tooth, it.surfaces, it.description ?? pr.name, it.quantity, unit, disc.discountCents, disc.discountPercent, pos++, ...cols],
    );
  }
}

export function billingRoutes(route: Route) {
  // ---------------- Presupuestos ----------------
  route({
    method: "GET", url: "/api/budgets", summary: "Presupuestos (filtros: estado, paciente, sucursal)", tags: ["presupuestos"], perm: "budgets.read",
    query: z.object({ status: z.enum(["draft", "presented", "accepted", "rejected", "cancelled", "completed", "superseded"]).optional(), patientId: zId.optional(), branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      const r = await c.query(
        `SELECT b.id, b.number, b.version, b.status, b.branch_id AS "branchId", br.name AS "branchName", b.patient_id AS "patientId",
                p.first_name || ' ' || p.last_name AS "patientName", u.full_name AS "dentistName", b.created_at AS "createdAt",
                b.presented_at AS "presentedAt", b.valid_until AS "validUntil",
                COALESCE((SELECT sum(i.net_cents) FROM budget_items i WHERE i.budget_id = b.id AND i.status <> 'cancelled'),0) AS "totalCents",
                COALESCE((SELECT sum(amount_cents) FROM payments x WHERE x.budget_id = b.id AND x.status = 'confirmed'),0) AS "paidCents"
           FROM budgets b JOIN patients p ON p.id = b.patient_id JOIN users u ON u.id = b.dentist_id JOIN branches br ON br.id = b.branch_id
          WHERE ($1::text IS NULL OR b.status = $1) AND ($2::uuid IS NULL OR b.patient_id = $2) AND ($3::uuid IS NULL OR b.branch_id = $3)
            AND ($4::uuid[] IS NULL OR b.branch_id = ANY($4) OR $2::uuid IS NOT NULL)
          ORDER BY b.created_at DESC LIMIT 300`,
        [query.status ?? null, query.patientId ?? null, query.branchId ?? null, allowedBranches(auth)],
      );
      return r.rows.map((x) => ({ ...x, statusLabel: BUDGET_LABELS[x.status] }));
    },
  });

  route({
    method: "GET", url: "/api/budgets/:id", summary: "Detalle del presupuesto con ítems, pagos y plan de cuotas", tags: ["presupuestos"], perm: "budgets.read", params: zIdParams,
    handler: async ({ c, params }) => loadBudget(c, params.id),
  });

  const budgetBody = z.object({
    branchId: zId, patientId: zId, dentistId: zId,
    installments: z.number().int().min(1).max(60).default(1),
    validUntil: zDate.nullish().transform((v) => v ?? null),
    notes: zOptText(2000),
    items: z.array(itemBody).min(1, "Agrega al menos una prestación").max(100),
    markPlannedInOdontogram: z.boolean().default(true),
    globalDiscount: zGlobalDiscount.nullish(),
  });

  route({
    method: "POST", url: "/api/budgets", summary: "Crear presupuesto (borrador)", tags: ["presupuestos"], perm: "budgets.write", body: budgetBody,
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      const number = await nextCounter(c, auth.clinicId!, "budget");
      const id = (await c.query<{ id: string }>(
        `INSERT INTO budgets (clinic_id, number, branch_id, patient_id, dentist_id, installments, valid_until, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.clinicId, number, body.branchId, body.patientId, body.dentistId, body.installments, body.validUntil, body.notes, auth.userId],
      )).rows[0]!.id;
      await insertItems(c, auth.clinicId!, id, body.items);
      await recalcBudget(c, id, body.globalDiscount);
      if (body.markPlannedInOdontogram && auth.permissions.has("clinical.write")) {
        const items = (await c.query<{ id: string; tooth: number | null; surfaces: string[]; cond: string | null }>(
          `SELECT i.id, i.tooth, i.surfaces, pr.odontogram_condition AS cond FROM budget_items i JOIN procedures pr ON pr.id = i.procedure_id WHERE i.budget_id = $1`, [id])).rows;
        for (const it of items) {
          if (!it.tooth || !it.cond || !CONDITIONS[it.cond]) continue;
          const surf = CONDITIONS[it.cond]!.surface ? it.surfaces : [];
          if (CONDITIONS[it.cond]!.surface && !surf.length) continue;
          await c.query(
            `INSERT INTO odontogram_entries (clinic_id, patient_id, tooth, surfaces, condition, state, budget_item_id, recorded_by) VALUES ($1,$2,$3,$4,$5,'planned',$6,$7)`,
            [auth.clinicId, body.patientId, it.tooth, surf, it.cond, it.id, auth.userId],
          );
        }
      }
      await audit(c, auth, "budget.created", "budget", id, { number, patientId: body.patientId, items: body.items.length }, body.branchId);
      return { id, number };
    },
  });

  route({
    method: "PUT", url: "/api/budgets/:id/items", summary: "Reemplazar ítems (solo en borrador)", tags: ["presupuestos"], perm: "budgets.write", params: zIdParams,
    body: z.object({ items: z.array(itemBody).min(1).max(100), installments: z.number().int().min(1).max(60).optional(), notes: zOptText(2000).optional(), globalDiscount: zGlobalDiscount.nullish() }),
    handler: async ({ c, auth, params, body }) => {
      const b = (await c.query<{ status: string; branch_id: string }>("SELECT status, branch_id FROM budgets WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!b) throw notFound("Presupuesto");
      requireBranch(auth, b.branch_id);
      if (b.status !== "draft") throw conflict("Solo se editan presupuestos en borrador", "invalid_status");
      // Los ítems de un borrador nunca tienen cargos; se reemplazan como "cancelled" para no perder trazabilidad.
      await c.query("UPDATE budget_items SET status = 'cancelled' WHERE budget_id = $1 AND status = 'pending'", [params.id]);
      await insertItems(c, auth.clinicId!, params.id, body.items);
      await recalcBudget(c, params.id, body.globalDiscount);
      await c.query("UPDATE budgets SET installments = COALESCE($2, installments), notes = CASE WHEN $3::boolean THEN $4 ELSE notes END WHERE id = $1",
        [params.id, body.installments ?? null, body.notes !== undefined, body.notes ?? null]);
      await audit(c, auth, "budget.items_replaced", "budget", params.id, { items: body.items.length }, b.branch_id);
      return loadBudget(c, params.id);
    },
  });

  route({
    method: "POST", url: "/api/budgets/:id/status", summary: "Presentar, aceptar, rechazar o anular presupuesto", tags: ["presupuestos"], perm: "budgets.write", params: zIdParams,
    body: z.object({ status: z.enum(["draft", "presented", "accepted", "rejected", "cancelled"]), note: zOptText(500) }),
    handler: async ({ c, auth, params, body }) => {
      const b = (await c.query<{ status: string; branch_id: string }>("SELECT status, branch_id FROM budgets WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!b) throw notFound("Presupuesto");
      requireBranch(auth, b.branch_id);
      if (b.status === "superseded") throw await supersededError(c, params.id);
      if (!BUDGET_TRANSITIONS[b.status]!.includes(body.status)) {
        throw new AppError(409, "invalid_transition", `No se puede pasar de "${BUDGET_LABELS[b.status]}" a "${BUDGET_LABELS[body.status]}"`);
      }
      if (body.status === "cancelled") {
        const done = await c.query("SELECT 1 FROM budget_items WHERE budget_id = $1 AND status = 'done'", [params.id]);
        if (done.rowCount) throw conflict("El presupuesto tiene tratamientos realizados; anula primero los cargos", "has_charges");
        const paid = await c.query("SELECT 1 FROM payments WHERE budget_id = $1 AND status IN ('confirmed','pending_verification')", [params.id]);
        if (paid.rowCount) throw conflict("El presupuesto tiene pagos; anúlalos o reasígnalos primero", "has_payments");
      }
      await c.query(
        `UPDATE budgets SET status = $2,
            presented_at = CASE WHEN $2 = 'presented' THEN now() ELSE presented_at END,
            decided_at = CASE WHEN $2 IN ('accepted','rejected','cancelled') THEN now() ELSE decided_at END,
            decided_note = CASE WHEN $2 IN ('accepted','rejected','cancelled') THEN $3 ELSE decided_note END
          WHERE id = $1`,
        [params.id, body.status, body.note],
      );
      await audit(c, auth, "budget.status", "budget", params.id, { from: b.status, to: body.status, note: body.note }, b.branch_id);
      return loadBudget(c, params.id);
    },
  });

  route({
    method: "POST", url: "/api/budget-items/:id/perform", summary: "Marcar tratamiento como realizado: genera el cargo y lo registra en el odontograma", tags: ["presupuestos"], perm: "treatments.perform", params: zIdParams,
    body: z.object({ appointmentId: zId.nullish(), note: zOptText(500) }),
    handler: async ({ c, auth, params, body }) => {
      const it = (await c.query<{ budget_id: string; status: string; tooth: number | null; surfaces: string[]; description: string; total: number; cond: string | null; b_status: string; branch_id: string; patient_id: string }>(
        `SELECT i.budget_id, i.status, i.tooth, i.surfaces, i.description, i.net_cents AS total,
                pr.odontogram_condition AS cond, b.status AS b_status, b.branch_id, b.patient_id
           FROM budget_items i JOIN budgets b ON b.id = i.budget_id JOIN procedures pr ON pr.id = i.procedure_id
          WHERE i.id = $1 FOR UPDATE OF i`, [params.id])).rows[0];
      if (!it) throw notFound("Tratamiento");
      requireBranch(auth, it.branch_id);
      if (it.b_status !== "accepted") throw conflict("El presupuesto debe estar aceptado para realizar tratamientos", "budget_not_accepted");
      if (it.status !== "pending") throw conflict("Ese tratamiento ya fue realizado o anulado", "invalid_status");
      await c.query("UPDATE budget_items SET status = 'done', performed_by = $2, performed_at = now() WHERE id = $1", [params.id, auth.userId]);
      let chargeId: string | null = null;
      const sessions = await performPendingSessions(c, auth, params.id); // por sesiones: solo las pendientes (sin doble cobro)
      if (sessions) chargeId = sessions.chargeIds[0] ?? null;
      else if (it.total > 0) {
        chargeId = (await c.query<{ id: string }>(
          `INSERT INTO charges (clinic_id, branch_id, patient_id, budget_item_id, dentist_id, description, amount_cents, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$5) RETURNING id`,
          [auth.clinicId, it.branch_id, it.patient_id, params.id, auth.userId, it.description + (it.tooth ? ` (pieza ${it.tooth})` : ""), it.total],
        )).rows[0]!.id;
      }
      if (it.tooth && it.cond && CONDITIONS[it.cond]) {
        const surf = CONDITIONS[it.cond]!.surface ? it.surfaces : [];
        if (!CONDITIONS[it.cond]!.surface || surf.length) {
          await c.query(
            `INSERT INTO odontogram_entries (clinic_id, patient_id, tooth, surfaces, condition, state, budget_item_id, appointment_id, notes, recorded_by)
             VALUES ($1,$2,$3,$4,$5,'completed',$6,$7,$8,$9)`,
            [auth.clinicId, it.patient_id, it.tooth, surf, it.cond, params.id, body.appointmentId ?? null, body.note, auth.userId],
          );
          // El "planificado" correspondiente queda reemplazado: se anula con referencia.
          const planned = (await c.query<{ id: string }>(
            `SELECT e.id FROM odontogram_entries e WHERE e.budget_item_id = $1 AND e.state = 'planned'
               AND NOT EXISTS (SELECT 1 FROM odontogram_entries v WHERE v.voids_entry_id = e.id)`, [params.id])).rows;
          for (const p of planned) {
            await c.query(
              `INSERT INTO odontogram_entries (clinic_id, patient_id, tooth, condition, state, notes, voids_entry_id, recorded_by) VALUES ($1,$2,$3,'void','existing','Realizado',$4,$5)`,
              [auth.clinicId, it.patient_id, it.tooth, p.id, auth.userId],
            );
          }
        }
      }
      const pending = await c.query("SELECT 1 FROM budget_items WHERE budget_id = $1 AND status = 'pending'", [it.budget_id]);
      if (!pending.rowCount) await c.query("UPDATE budgets SET status = 'completed' WHERE id = $1", [it.budget_id]);
      await consumeForTreatment(c, auth, { budgetItemId: params.id, appointmentId: body.appointmentId ?? null }); // inventario: nunca bloquea
      await audit(c, auth, "treatment.performed", "budget_item", params.id, { budgetId: it.budget_id, chargeId, amountCents: it.total }, it.branch_id);
      return { ok: true, chargeId };
    },
  });

  route({
    method: "POST", url: "/api/budget-items/:id/cancel", summary: "Anular un tratamiento pendiente del presupuesto", tags: ["presupuestos"], perm: "budgets.write", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3).max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const r = await c.query<{ budget_id: string }>("UPDATE budget_items SET status = 'cancelled' WHERE id = $1 AND status = 'pending' RETURNING budget_id", [params.id]);
      if (!r.rowCount) throw conflict("Solo se anulan tratamientos pendientes", "invalid_status");
      await audit(c, auth, "treatment.cancelled", "budget_item", params.id, { reason: body.reason, budgetId: r.rows[0]!.budget_id });
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/charges/:id/void", summary: "Anular un cargo (asiento negativo; el original se conserva)", tags: ["caja"], perm: "payments.void", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3).max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const ch = (await c.query<{ amount_cents: number; branch_id: string; patient_id: string; budget_item_id: string | null; voids_charge_id: string | null }>(
        "SELECT amount_cents, branch_id, patient_id, budget_item_id, voids_charge_id FROM charges WHERE id = $1", [params.id])).rows[0];
      if (!ch || ch.voids_charge_id) throw notFound("Cargo");
      requireBranch(auth, ch.branch_id);
      if ((await c.query("SELECT 1 FROM charges WHERE voids_charge_id = $1", [params.id])).rowCount) throw conflict("Ese cargo ya fue anulado");
      if ((await c.query("SELECT 1 FROM payer_transfers WHERE charge_id = $1 HAVING sum(amount_cents) <> 0", [params.id])).rowCount) {
        throw conflict("Parte de este cargo se trasladó de la empresa al paciente: revierte primero el traslado (Convenios → Por cobrar a empresas)", "has_payer_transfer");
      }
      const r = await c.query<{ id: string }>(
        `INSERT INTO charges (clinic_id, branch_id, patient_id, description, amount_cents, voids_charge_id, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [auth.clinicId, ch.branch_id, ch.patient_id, `Anulación: ${body.reason}`, -ch.amount_cents, params.id, auth.userId],
      );
      if (ch.budget_item_id) {
        const bi = (await c.query<{ budget_id: string }>("UPDATE budget_items SET status = 'pending', performed_by = NULL, performed_at = NULL WHERE id = $1 RETURNING budget_id", [ch.budget_item_id])).rows[0];
        if (bi) await c.query("UPDATE budgets SET status = 'accepted' WHERE id = $1 AND status = 'completed'", [bi.budget_id]);
        await onChargeVoided(c, params.id);
      }
      await audit(c, auth, "charge.voided", "charge", params.id, { reason: body.reason, amountCents: ch.amount_cents }, ch.branch_id);
      return { id: r.rows[0]!.id };
    },
  });

  // ---------------- Cuenta del paciente y pagos ----------------
  route({
    method: "GET", url: "/api/patients/:id/account", summary: "Estado de cuenta del paciente (cargos, pagos, saldo)", tags: ["caja"], perm: "payments.read", params: zIdParams,
    handler: async ({ c, params }) => {
      const charges = (await c.query(
        `SELECT ch.id, ch.description, ch.amount_cents AS "amountCents", ch.created_at AS "createdAt", ch.voids_charge_id AS "voidsChargeId",
                b.name AS "branchName", u.full_name AS "dentistName", ch.third_party_cents AS "thirdPartyCents", ag.name AS "payerName",
                EXISTS (SELECT 1 FROM charges v WHERE v.voids_charge_id = ch.id) AS voided
           FROM charges ch JOIN branches b ON b.id = ch.branch_id LEFT JOIN users u ON u.id = ch.dentist_id LEFT JOIN agreements ag ON ag.id = ch.payer_agreement_id
          WHERE ch.patient_id = $1 ORDER BY ch.created_at`, [params.id])).rows;
      const payments = (await c.query(
        `SELECT p.id, p.receipt_number AS "receiptNumber", p.amount_cents AS "amountCents", p.method, p.status, p.bank_reference AS "bankReference",
                p.received_at AS "receivedAt", p.verified_at AS "verifiedAt", p.status_reason AS "statusReason", p.budget_id AS "budgetId",
                b.name AS "branchName", u.full_name AS "receivedByName"
           FROM payments p JOIN branches b ON b.id = p.branch_id JOIN users u ON u.id = p.received_by
          WHERE p.patient_id = $1 ORDER BY p.received_at`, [params.id])).rows;
      return {
        charges, payments: payments.map((p) => ({ ...p, methodLabel: METHOD_LABELS[p.method] })),
        ...(await patientMoney(c, params.id)), // R2-11: el mismo cálculo que la ficha y las cuentas por cobrar
      };
    },
  });

  route({
    method: "POST", url: "/api/payments", summary: "Registrar pago. Efectivo queda confirmado; transferencia/QR/tarjeta quedan pendientes de verificación bancaria. Idempotente.",
    tags: ["caja"], perm: "payments.create",
    body: z.object({
      branchId: zId, patientId: zId, budgetId: zId.nullish().transform((v) => v ?? null),
      amountCents: zMoney.refine((v) => v > 0, "El monto debe ser mayor a cero"),
      method: z.enum(["cash", "transfer", "qr", "card"]),
      bankReference: zOptText(80),
      notes: zOptText(500),
      idempotencyKey: z.string().min(8).max(80),
    }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      // Serializa los envíos con la misma clave: el segundo espera y recibe el mismo pago (sin error ni doble cobro).
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", [auth.clinicId, body.idempotencyKey]);
      const ex = (await c.query<{ id: string; amount_cents: number; patient_id: string; receipt_number: number; status: string }>(
        "SELECT id, amount_cents, patient_id, receipt_number, status FROM payments WHERE idempotency_key = $1", [body.idempotencyKey])).rows[0];
      if (ex) {
        if (ex.amount_cents !== body.amountCents || ex.patient_id !== body.patientId) throw conflict("La clave de idempotencia ya se usó con otros datos", "idempotency_mismatch");
        return { id: ex.id, receiptNumber: ex.receipt_number, status: ex.status, duplicate: true };
      }
      if (body.method !== "cash" && !body.bankReference) throw badRequest("Indica el número de operación o referencia bancaria");
      await assertCashSessionForPayment(c, auth, body.branchId, body.method);
      if (body.budgetId) {
        const b = (await c.query<{ patient_id: string; status: string }>("SELECT patient_id, status FROM budgets WHERE id = $1 FOR UPDATE", [body.budgetId])).rows[0];
        if (!b || b.patient_id !== body.patientId) throw badRequest("El presupuesto no corresponde al paciente");
        if (b.status === "superseded") throw await supersededError(c, body.budgetId);
        if (!["accepted", "completed", "presented"].includes(b.status)) throw conflict("Solo se reciben pagos de presupuestos presentados o aceptados", "invalid_status");
        const t = (await c.query<{ total: number; paid: number }>(
          `SELECT COALESCE((SELECT sum(net_cents) FROM budget_items WHERE budget_id = $1 AND status <> 'cancelled'),0) AS total,
                  COALESCE((SELECT sum(amount_cents) FROM payments WHERE budget_id = $1 AND status IN ('confirmed','pending_verification')),0) AS paid`,
          [body.budgetId])).rows[0]!;
        const patientShare = t.total - (await budgetCompanyShareCents(c, body.budgetId)); // la parte del convenio la paga la empresa
        if (t.paid + body.amountCents > patientShare) {
          throw new AppError(409, "overpayment", `El pago supera el saldo del presupuesto (saldo: ${(patientShare - t.paid) / 100} Bs)`, { remainingCents: patientShare - t.paid });
        }
      }
      const status = body.method === "cash" ? "confirmed" : "pending_verification";
      const receipt = await nextCounter(c, auth.clinicId!, "receipt");
      const r = await c.query<{ id: string }>(
        `INSERT INTO payments (clinic_id, receipt_number, branch_id, patient_id, budget_id, amount_cents, method, status, bank_reference, notes, idempotency_key, received_by,
                               verified_by, verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12, CASE WHEN $8 = 'confirmed' THEN $12::uuid END, CASE WHEN $8 = 'confirmed' THEN now() END) RETURNING id`,
        [auth.clinicId, receipt, body.branchId, body.patientId, body.budgetId, body.amountCents, body.method, status, body.bankReference, body.notes, body.idempotencyKey, auth.userId],
      );
      await audit(c, auth, "payment.created", "payment", r.rows[0]!.id, { amountCents: body.amountCents, method: body.method, status, receipt }, body.branchId);
      return { id: r.rows[0]!.id, receiptNumber: receipt, status };
    },
  });

  route({
    method: "POST", url: "/api/payments/:id/verify", summary: "Confirmar o rechazar un pago tras verificarlo en el banco (control dual)", tags: ["caja"], perm: "payments.verify", params: zIdParams,
    body: z.object({ decision: z.enum(["confirmed", "rejected"]), reason: zOptText(300) }),
    handler: async ({ c, auth, params, body }) => {
      const p = (await c.query<{ status: string; received_by: string; branch_id: string; amount_cents: number }>(
        "SELECT status, received_by, branch_id, amount_cents FROM payments WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!p) throw notFound("Pago");
      requireBranch(auth, p.branch_id);
      if (p.status !== "pending_verification") throw conflict("Ese pago ya fue verificado", "invalid_status");
      if (p.received_by === auth.userId && auth.membership!.role !== "owner") throw forbidden("Otra persona debe verificar los pagos que registraste (control dual)");
      if (body.decision === "rejected" && !body.reason) throw badRequest("Indica el motivo del rechazo");
      await c.query("UPDATE payments SET status = $2, verified_by = $3, verified_at = now(), status_reason = $4 WHERE id = $1", [params.id, body.decision, auth.userId, body.reason]);
      await audit(c, auth, `payment.${body.decision}`, "payment", params.id, { amountCents: p.amount_cents, reason: body.reason }, p.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/payments/:id/void", summary: "Anular un pago confirmado (devolución o error)", tags: ["caja"], perm: "payments.void", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3).max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const p = (await c.query<{ status: string; branch_id: string; amount_cents: number }>("SELECT status, branch_id, amount_cents FROM payments WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!p) throw notFound("Pago");
      requireBranch(auth, p.branch_id);
      if (p.status !== "confirmed") throw conflict("Solo se anulan pagos confirmados", "invalid_status");
      await c.query("UPDATE payments SET status = 'voided', status_reason = $2 WHERE id = $1", [params.id, body.reason]);
      await audit(c, auth, "payment.voided", "payment", params.id, { amountCents: p.amount_cents, reason: body.reason }, p.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "GET", url: "/api/payments", summary: "Pagos por estado, sucursal y fechas", tags: ["caja"], perm: "payments.read",
    query: z.object({ status: z.enum(["pending_verification", "confirmed", "rejected", "voided"]).optional(), branchId: zId.optional(), from: zDate.optional(), to: zDate.optional() }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const from = query.from ? dayBounds(query.from, zone)[0] : null;
      const to = query.to ? dayBounds(query.to, zone)[1] : null;
      const r = await c.query(
        `SELECT p.id, p.receipt_number AS "receiptNumber", p.amount_cents AS "amountCents", p.method, p.status, p.bank_reference AS "bankReference",
                p.received_at AS "receivedAt", p.patient_id AS "patientId", pt.first_name || ' ' || pt.last_name AS "patientName",
                b.name AS "branchName", u.full_name AS "receivedByName", p.received_by AS "receivedBy", p.status_reason AS "statusReason"
           FROM payments p JOIN patients pt ON pt.id = p.patient_id JOIN branches b ON b.id = p.branch_id JOIN users u ON u.id = p.received_by
          WHERE ($1::text IS NULL OR p.status = $1) AND ($2::uuid IS NULL OR p.branch_id = $2) AND ($3::timestamptz IS NULL OR p.received_at >= $3)
            AND ($4::timestamptz IS NULL OR p.received_at < $4) AND ($5::uuid[] IS NULL OR p.branch_id = ANY($5))
          ORDER BY p.received_at DESC LIMIT 500`,
        [query.status ?? null, query.branchId ?? null, from, to, allowedBranches(auth)],
      );
      return r.rows.map((x) => ({ ...x, methodLabel: METHOD_LABELS[x.method] }));
    },
  });

  route({
    method: "GET", url: "/api/cash-summary", summary: "Caja del día por sucursal y medio de pago", tags: ["caja"], perm: "payments.read",
    query: z.object({ date: zDate, branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const [s, e] = dayBounds(query.date, zone);
      const r = await c.query(
        `SELECT b.id AS "branchId", b.name AS "branchName", p.method, p.status, count(*)::int AS count, sum(p.amount_cents) AS "amountCents"
           FROM payments p JOIN branches b ON b.id = p.branch_id
          WHERE p.received_at >= $1 AND p.received_at < $2 AND ($3::uuid IS NULL OR p.branch_id = $3) AND ($4::uuid[] IS NULL OR p.branch_id = ANY($4))
          GROUP BY b.id, b.name, p.method, p.status ORDER BY b.name, p.method`,
        [s, e, query.branchId ?? null, allowedBranches(auth)],
      );
      return r.rows.map((x) => ({ ...x, methodLabel: METHOD_LABELS[x.method] }));
    },
  });
}
