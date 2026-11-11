// Traslado al paciente de la porción impaga de la empresa (B-082, D-30).
//
//  * Cuando la empresa rechaza una porción o no la paga dentro del plazo del convenio
//    (agreements.patient_transfer_days), gerencia (payments.void, con acceso a todas las sucursales)
//    puede trasladarla al paciente con un motivo. Nunca es automático.
//  * El traslado es un movimiento de SOLO INSERCIÓN (payer_transfers): la quita de la cuenta de la
//    empresa y patient_money la suma al saldo del paciente (única fuente del saldo).
//  * Se revierte solo con otro movimiento (una vez por traslado). La base impide trasladar más que la
//    porción impaga (sin traslados dobles) y trasladar «por vencida» antes del plazo.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams, zMoney } from "../../lib/http.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { Client } from "../../lib/db.js";
import { fmtBs } from "../../lib/pdf.js";
import { clinicZone } from "../agenda.js";
import { clinicToday } from "./core.js";
import { ageDays, payerCharges, requireAllBranches } from "./payers.js";

export const TRANSFER_CAUSE_LABELS: Record<string, string> = {
  rejected: "La empresa rechazó la porción",
  overdue: "La empresa no pagó en el plazo",
  reversal: "Reversión del traslado",
};

/** Convierte los rechazos de la base (check_violation con mensaje propio) en un 409 legible. */
function dbMessage(e: unknown): never {
  const err = e as { code?: string; message?: string };
  if (err.code === "23514" && err.message && !/violates check constraint/.test(err.message)) throw new AppError(409, "transfer_rejected", err.message);
  throw e;
}

const TRANSFER_SELECT = `
  SELECT t.id, t.charge_id AS "chargeId", t.agreement_id AS "agreementId", a.name AS "agreementName", t.patient_id AS "patientId",
         p.first_name || ' ' || p.last_name AS "patientName", p.record_number AS "recordNumber", b.name AS "branchName",
         t.amount_cents AS "amountCents", t.cause, t.reason, t.reverses_id AS "reversesId", t.created_at AS "createdAt", u.full_name AS "createdByName",
         COALESCE(bi.description, ch.description) AS service, ch.created_at AS "chargedAt", ch.amount_cents AS "chargeAmountCents",
         EXISTS (SELECT 1 FROM payer_transfers r WHERE r.reverses_id = t.id) AS reversed
    FROM payer_transfers t JOIN agreements a ON a.id = t.agreement_id JOIN patients p ON p.id = t.patient_id JOIN branches b ON b.id = t.branch_id
    JOIN users u ON u.id = t.created_by JOIN charges ch ON ch.id = t.charge_id LEFT JOIN budget_items bi ON bi.id = ch.budget_item_id`;

const decorate = (r: any) => ({ ...r, amountCents: Number(r.amountCents), chargeAmountCents: Number(r.chargeAmountCents), recordNumber: Number(r.recordNumber), causeLabel: TRANSFER_CAUSE_LABELS[r.cause] ?? r.cause });

export async function patientTransfers(c: Client, patientId: string) {
  return (await c.query(`${TRANSFER_SELECT} WHERE t.patient_id = $1 ORDER BY t.created_at DESC`, [patientId])).rows.map(decorate);
}

/** Cargos de la empresa con porción impaga, con su antigüedad y si ya se pueden trasladar «por vencidos». */
export async function transferableCharges(c: Client, agreementId: string) {
  const ag = (await c.query<{ name: string; days: number }>("SELECT name, patient_transfer_days AS days FROM agreements WHERE id = $1", [agreementId])).rows[0];
  if (!ag) throw notFound("Convenio");
  const today = await clinicToday(c);
  const zone = await clinicZone(c, (await c.query<{ id: string }>("SELECT app_clinic_id() AS id")).rows[0]!.id);
  const rows = (await payerCharges(c, agreementId, true)).map((x) => {
    const age = ageDays(today, x.createdAt, zone);
    return { ...x, ageDays: age, overdueForTransfer: age >= ag.days, daysLeft: Math.max(ag.days - age, 0) };
  });
  return { agreementId, agreementName: ag.name, patientTransferDays: ag.days, charges: rows };
}

export function transferRoutes(route: Route) {
  route({
    method: "GET", url: "/api/agreements/:id/transferable", summary: "Cargos con porción impaga de la empresa, su antigüedad y si ya vencieron para trasladarlos al paciente", tags: ["convenios"],
    perm: "payments.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      requireAllBranches(auth);
      return transferableCharges(c, params.id);
    },
  });

  route({
    method: "POST", url: "/api/payer-charges/:id/transfer",
    summary: "Trasladar al paciente la porción impaga de la empresa en un cargo (rechazada o vencida según el plazo del convenio). Requiere motivo; queda como movimiento de solo inserción",
    tags: ["convenios"], perm: "payments.void", params: zIdParams,
    body: z.object({
      cause: z.enum(["rejected", "overdue"], { message: "Indica si la empresa rechazó la porción o no la pagó en el plazo" }),
      reason: z.string().trim().min(5, "Escribe el motivo (mínimo 5 caracteres)").max(300, "El motivo admite hasta 300 caracteres"),
      amountCents: zMoney.refine((v) => v > 0, "El monto debe ser mayor a cero").optional(),
    }),
    handler: async ({ c, auth, params, body }) => {
      requireAllBranches(auth);
      const ch = (await c.query<{ patient_id: string; branch_id: string; payer_agreement_id: string | null; voids_charge_id: string | null; third_party_cents: number }>(
        "SELECT patient_id, branch_id, payer_agreement_id, voids_charge_id, third_party_cents FROM charges WHERE id = $1", [params.id])).rows[0];
      if (!ch || ch.voids_charge_id || !ch.payer_agreement_id || Number(ch.third_party_cents) <= 0) throw notFound("Cargo con porción de convenio");
      // Serializa con los pagos de la empresa y otros traslados del mismo convenio (lo impago se calcula sin carreras).
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('payer:' || $1, 0))", [ch.payer_agreement_id]);
      const { charges, patientTransferDays } = await transferableCharges(c, ch.payer_agreement_id);
      const row = charges.find((x) => x.id === params.id);
      if (!row || row.openCents <= 0) {
        throw conflict("No queda porción impaga de la empresa en ese cargo (ya fue pagada, está en un pago por verificar o ya se trasladó al paciente)", "nothing_to_transfer");
      }
      const amount = body.amountCents ?? row.openCents;
      if (amount > row.openCents) throw new AppError(409, "transfer_exceeds", `El monto (${fmtBs(amount)}) supera la porción impaga de la empresa (${fmtBs(row.openCents)})`, { openCents: row.openCents });
      if (body.cause === "overdue" && !row.overdueForTransfer) {
        throw new AppError(409, "not_overdue", `Esta porción todavía no vence para trasladarla: el convenio da ${patientTransferDays} días y el tratamiento tiene ${row.ageDays}. Si la empresa la rechazó, elige «La empresa rechazó la porción».`,
          { ageDays: row.ageDays, patientTransferDays });
      }
      let id: string;
      try {
        id = (await c.query<{ id: string }>(
          `INSERT INTO payer_transfers (clinic_id, charge_id, agreement_id, patient_id, branch_id, amount_cents, cause, reason, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
          [auth.clinicId, params.id, ch.payer_agreement_id, ch.patient_id, ch.branch_id, amount, body.cause, body.reason, auth.userId])).rows[0]!.id;
      } catch (e) { dbMessage(e); }
      await audit(c, auth, "payer_transfer.created", "payer_transfer", id,
        { patientId: ch.patient_id, chargeId: params.id, agreementId: ch.payer_agreement_id, amountCents: amount, cause: body.cause, reason: body.reason }, ch.branch_id);
      const money = (await c.query<{ balance_cents: number }>("SELECT balance_cents FROM patient_money($1)", [ch.patient_id])).rows[0]!;
      return { id, amountCents: amount, patientBalanceCents: Number(money.balance_cents) };
    },
  });

  route({
    method: "POST", url: "/api/payer-transfers/:id/reverse",
    summary: "Revertir un traslado al paciente (la porción vuelve a la cuenta de la empresa) con motivo. Es otro movimiento; el original se conserva",
    tags: ["convenios"], perm: "payments.void", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(5, "Escribe el motivo (mínimo 5 caracteres)").max(300, "El motivo admite hasta 300 caracteres") }),
    handler: async ({ c, auth, params, body }) => {
      requireAllBranches(auth);
      const t = (await c.query<{ charge_id: string; agreement_id: string; patient_id: string; branch_id: string; amount_cents: number; reverses_id: string | null }>(
        "SELECT charge_id, agreement_id, patient_id, branch_id, amount_cents, reverses_id FROM payer_transfers WHERE id = $1", [params.id])).rows[0];
      if (!t) throw notFound("Traslado");
      if (t.reverses_id) throw conflict("Ese movimiento ya es una reversión", "invalid_transfer");
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('payer:' || $1, 0))", [t.agreement_id]);
      if ((await c.query("SELECT 1 FROM payer_transfers WHERE reverses_id = $1", [params.id])).rowCount) throw conflict("Ese traslado ya fue revertido", "already_reversed");
      let id: string;
      try {
        id = (await c.query<{ id: string }>(
          `INSERT INTO payer_transfers (clinic_id, charge_id, agreement_id, patient_id, branch_id, amount_cents, cause, reason, reverses_id, created_by)
           VALUES ($1,$2,$3,$4,$5,$6,'reversal',$7,$8,$9) RETURNING id`,
          [auth.clinicId, t.charge_id, t.agreement_id, t.patient_id, t.branch_id, -Number(t.amount_cents), body.reason, params.id, auth.userId])).rows[0]!.id;
      } catch (e) {
        if ((e as { constraint?: string }).constraint === "payer_transfers_reverse_once") throw conflict("Ese traslado ya fue revertido", "already_reversed");
        dbMessage(e);
      }
      await audit(c, auth, "payer_transfer.reversed", "payer_transfer", id,
        { patientId: t.patient_id, reverses: params.id, chargeId: t.charge_id, agreementId: t.agreement_id, amountCents: -Number(t.amount_cents), reason: body.reason }, t.branch_id);
      return { id };
    },
  });

  route({
    method: "GET", url: "/api/payer-transfers", summary: "Traslados de porciones de empresas a pacientes (y sus reversiones)", tags: ["convenios"], perm: "payments.read",
    query: z.object({ agreementId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      requireAllBranches(auth);
      return (await c.query(`${TRANSFER_SELECT} WHERE ($1::uuid IS NULL OR t.agreement_id = $1) ORDER BY t.created_at DESC LIMIT 300`, [query.agreementId ?? null])).rows.map(decorate);
    },
  });

  route({
    method: "GET", url: "/api/patients/:id/payer-transfers", summary: "Porciones de convenios trasladadas al saldo del paciente (aviso en la ficha)", tags: ["convenios"], perm: "payments.read", params: zIdParams,
    handler: async ({ c, params }) => {
      if (!(await c.query("SELECT 1 FROM patients WHERE id = $1", [params.id])).rowCount) throw notFound("Paciente");
      const items = await patientTransfers(c, params.id);
      return { items, netCents: items.reduce((s, x) => s + x.amountCents, 0) };
    },
  });
}
