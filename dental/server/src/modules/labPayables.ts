// Cuentas por pagar al laboratorio: órdenes recibidas aún no pagadas, pagos de solo inserción
// imputados a órdenes, estado de cuenta por laboratorio y período, y exportación a Excel.
// Requiere payments.verify o clinic.manage y acceso a todas las sucursales (un pago puede cubrir
// órdenes de varias sucursales).
import { z } from "zod";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import type { FastifyReply } from "fastify";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zOptText } from "../lib/http.js";
import { badRequest, conflict, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";
import { hasAllBranches, type AuthCtx } from "../lib/rbac.js";
import { LAB_PAY, initials, orderLabel, requireAny, todayIn } from "./lab.js";
import { xlsxBuffer } from "../lib/xlsxSafe.js";

export const LAB_PAY_METHODS = ["cash", "transfer", "qr", "card", "check", "other"] as const;
export const LAB_PAY_METHOD_LABELS: Record<string, string> = {
  cash: "Efectivo", transfer: "Transferencia", qr: "QR", card: "Tarjeta", check: "Cheque", other: "Otro",
};

function requirePayables(auth: AuthCtx) {
  requireAny(auth, LAB_PAY, "Los pagos al laboratorio los gestiona administración o contabilidad");
  if (!hasAllBranches(auth)) throw forbidden("Los pagos al laboratorio se gestionan con acceso a todas las sucursales");
}

/** Reparte un monto entre órdenes pendientes, de la más antigua a la más reciente. */
export function allocateFifo(amount: number, outstanding: { id: string; outstandingCents: number }[]) {
  const out: { orderId: string; amountCents: number }[] = [];
  let left = amount;
  for (const o of outstanding) {
    if (left <= 0) break;
    const a = Math.min(left, o.outstandingCents);
    if (a > 0) { out.push({ orderId: o.id, amountCents: a }); left -= a; }
  }
  return { allocations: out, unallocated: left };
}

const PAYABLE_SQL = `SELECT o.id, o.number, o.lab_id AS "labId", l.name AS "labName", o.work_type AS "workType", o.work_detail AS "workDetail", o.teeth,
    o.received_on AS "receivedOn", o.cost_cents AS "costCents", o.status, p.first_name AS "pf", p.last_name AS "pl", p.record_number AS "recordNumber",
    b.name AS "branchName", COALESCE((SELECT sum(x.amount_cents) FROM lab_payment_allocations x WHERE x.order_id = o.id AND NOT EXISTS (SELECT 1 FROM lab_payment_voids v WHERE v.payment_id = x.payment_id)), 0) AS "paidCents"
  FROM lab_orders o JOIN labs l ON l.id = o.lab_id JOIN patients p ON p.id = o.patient_id JOIN branches b ON b.id = o.branch_id
  WHERE o.status IN ('received','adjustment','delivered') AND ($1::uuid IS NULL OR o.lab_id = $1)`;

/** Órdenes recibidas con saldo pendiente (más antiguas primero). */
export async function payables(c: Client, labId: string | null) {
  const rows = (await c.query(`${PAYABLE_SQL} ORDER BY o.received_on, o.number`, [labId])).rows;
  return rows
    .map((r) => ({
      id: r.id, number: r.number, labId: r.labId, labName: r.labName, label: orderLabel(r.workType, r.teeth.map(Number), r.workDetail), status: r.status,
      receivedOn: r.receivedOn, costCents: Number(r.costCents), paidCents: Number(r.paidCents), outstandingCents: Number(r.costCents) - Number(r.paidCents),
      patient: `${initials(r.pf, r.pl)} · ficha ${r.recordNumber}`, branchName: r.branchName,
    }))
    .filter((r) => r.outstandingCents > 0);
}

/** Estado de cuenta de un laboratorio: saldo inicial, trabajos recibidos (debe), pagos (haber) y saldo final. */
export async function statement(c: Client, labId: string, from: string, to: string) {
  const lab = (await c.query<{ id: string; name: string }>("SELECT id, name FROM labs WHERE id = $1", [labId])).rows[0];
  if (!lab) throw notFound("Laboratorio");
  const before = (await c.query<{ debit: number; credit: number }>(
    `SELECT COALESCE((SELECT sum(cost_cents) FROM lab_orders WHERE lab_id = $1 AND received_on < $2::date AND status IN ('received','adjustment','delivered')), 0) AS debit,
            COALESCE((SELECT sum(amount_cents) FROM lab_payments lp WHERE lab_id = $1 AND paid_on < $2::date AND NOT EXISTS (SELECT 1 FROM lab_payment_voids v WHERE v.payment_id = lp.id)), 0) AS credit`, [labId, from])).rows[0]!;
  const orders = (await c.query(
    `SELECT o.id, o.number, o.received_on AS date, o.cost_cents, o.work_type, o.work_detail, o.teeth, p.first_name AS pf, p.last_name AS pl, p.record_number
       FROM lab_orders o JOIN patients p ON p.id = o.patient_id
      WHERE o.lab_id = $1 AND o.received_on BETWEEN $2::date AND $3::date AND o.status IN ('received','adjustment','delivered')`, [labId, from, to])).rows;
  const pays = (await c.query(
    `SELECT id, paid_on AS date, amount_cents, method, reference, note, created_at FROM lab_payments lp WHERE lab_id = $1 AND paid_on BETWEEN $2::date AND $3::date AND NOT EXISTS (SELECT 1 FROM lab_payment_voids v WHERE v.payment_id = lp.id)`,
    [labId, from, to])).rows;
  type Mv = { date: string; kind: "order" | "payment"; id: string; description: string; debitCents: number; creditCents: number; balanceCents?: number; seq: string };
  const moves: Mv[] = [
    ...orders.map((o) => ({
      date: o.date, kind: "order" as const, id: o.id, seq: `0-${String(o.number).padStart(10, "0")}`,
      description: `Orden N° ${o.number} · ${orderLabel(o.work_type, o.teeth.map(Number), o.work_detail)} · ${initials(o.pf, o.pl)} (ficha ${o.record_number})`,
      debitCents: Number(o.cost_cents), creditCents: 0,
    })),
    ...pays.map((p) => ({
      date: p.date, kind: "payment" as const, id: p.id, seq: `1-${new Date(p.created_at).toISOString()}`,
      description: `Pago ${LAB_PAY_METHOD_LABELS[p.method]}${p.reference ? ` · ref. ${p.reference}` : ""}${p.note ? ` · ${p.note}` : ""}`,
      debitCents: 0, creditCents: Number(p.amount_cents),
    })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.seq < b.seq ? -1 : 1));
  const opening = Number(before.debit) - Number(before.credit);
  let bal = opening;
  for (const m of moves) { bal += m.debitCents - m.creditCents; m.balanceCents = bal; }
  const debit = moves.reduce((s, m) => s + m.debitCents, 0), credit = moves.reduce((s, m) => s + m.creditCents, 0);
  return { lab, from, to, openingCents: opening, debitCents: debit, creditCents: credit, closingCents: opening + debit - credit, movements: moves.map(({ seq: _s, ...m }) => m) };
}

const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v); // evita inyección de fórmulas
async function sendXlsx(reply: FastifyReply, wb: ExcelJS.Workbook, name: string) {
  reply
    .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .header("content-disposition", `attachment; filename="${name}"`)
    .send(await xlsxBuffer(wb));
}
const fileSafe = (s: string) => s.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

export function labPayableRoutes(route: Route) {
  route({
    method: "GET", url: "/api/lab/payables", summary: "Por pagar al laboratorio: órdenes recibidas aún no pagadas, con totales por laboratorio", tags: ["laboratorio"], perm: "patients.read",
    query: z.object({ labId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      requirePayables(auth);
      const rows = await payables(c, query.labId ?? null);
      const byLab = new Map<string, { labId: string; labName: string; orders: number; outstandingCents: number }>();
      for (const r of rows) {
        const g = byLab.get(r.labId) ?? { labId: r.labId, labName: r.labName, orders: 0, outstandingCents: 0 };
        g.orders++; g.outstandingCents += r.outstandingCents;
        byLab.set(r.labId, g);
      }
      return { orders: rows, labs: [...byLab.values()].sort((a, b) => a.labName.localeCompare(b.labName)), totalCents: rows.reduce((s, r) => s + r.outstandingCents, 0) };
    },
  });

  route({
    method: "GET", url: "/api/lab/payables.xlsx", summary: "Exportar a Excel lo pendiente de pago a los laboratorios", tags: ["laboratorio"], perm: "patients.read", raw: true,
    query: z.object({ labId: zId.optional() }),
    handler: async ({ c, auth, query, reply }) => {
      requirePayables(auth);
      const rows = await payables(c, query.labId ?? null);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Por pagar");
      ws.addRow(["Por pagar al laboratorio", `al ${await todayIn(c, auth.clinicId!)}`]).font = { bold: true, size: 13 };
      ws.addRow([]);
      ws.addRow(["Laboratorio", "Orden N°", "Trabajo", "Paciente", "Sucursal", "Recibido", "Costo (Bs)", "Pagado (Bs)", "Pendiente (Bs)"]).font = { bold: true };
      for (const r of rows) ws.addRow([safe(r.labName), r.number, safe(r.label), safe(r.patient), safe(r.branchName), r.receivedOn, r.costCents / 100, r.paidCents / 100, r.outstandingCents / 100]);
      ws.addRow(["Total", "", "", "", "", "", "", "", rows.reduce((s, r) => s + r.outstandingCents, 0) / 100]).font = { bold: true };
      [7, 8, 9].forEach((i) => (ws.getColumn(i).numFmt = "#,##0.00"));
      ws.columns.forEach((col, i) => (col.width = i === 2 ? 30 : 16));
      await audit(c, auth, "lab.payables_exported", "lab", query.labId ?? null, { rows: rows.length });
      await sendXlsx(reply, wb, "por-pagar-laboratorio.xlsx");
    },
  });

  route({
    method: "POST", url: "/api/lab/payments", summary: "Registrar un pago al laboratorio (solo inserción); se imputa a las órdenes indicadas o a las más antiguas", tags: ["laboratorio"], perm: "patients.read",
    body: z.object({
      labId: zId,
      amountCents: z.number().int("Monto en centavos (entero)").min(1, "El monto debe ser mayor a cero").max(100000000),
      paidOn: zDate,
      method: z.enum(LAB_PAY_METHODS),
      reference: zOptText(80),
      note: zOptText(500),
      allocations: z.array(z.object({ orderId: zId, amountCents: z.number().int().min(1, "Cada imputación debe ser mayor a cero") })).max(200).optional(),
    }),
    handler: async ({ c, auth, body }) => {
      requirePayables(auth);
      const lab = (await c.query<{ name: string }>("SELECT name FROM labs WHERE id = $1", [body.labId])).rows[0];
      if (!lab) throw notFound("Laboratorio");
      const today = await todayIn(c, auth.clinicId!);
      if (body.paidOn > today) throw badRequest("La fecha del pago no puede ser futura", { field: "paidOn" });
      if (body.method !== "cash" && !body.reference) throw badRequest("Indica la referencia (N° de transferencia, cheque o comprobante)", { field: "reference" });
      // Bloquea las órdenes pendientes del laboratorio (orden estable) para evitar pagos dobles simultáneos.
      await c.query("SELECT id FROM lab_orders WHERE lab_id = $1 AND status IN ('received','adjustment','delivered') ORDER BY id FOR UPDATE", [body.labId]);
      const pend = await payables(c, body.labId);
      const pendingTotal = pend.reduce((s, r) => s + r.outstandingCents, 0);
      let allocations: { orderId: string; amountCents: number }[];
      if (body.allocations?.length) {
        const ids = body.allocations.map((a) => a.orderId);
        if (new Set(ids).size !== ids.length) throw badRequest("Hay órdenes repetidas en el pago", { field: "allocations" });
        for (const a of body.allocations) {
          const o = pend.find((p) => p.id === a.orderId);
          if (!o) throw badRequest("Una de las órdenes no está pendiente de pago con este laboratorio", { field: "allocations", orderId: a.orderId });
          if (a.amountCents > o.outstandingCents) throw badRequest(`La orden N° ${o.number} tiene pendiente ${(o.outstandingCents / 100).toFixed(2)} Bs`, { field: "allocations", orderId: a.orderId });
        }
        const sum = body.allocations.reduce((s, a) => s + a.amountCents, 0);
        if (sum !== body.amountCents) throw badRequest("El monto del pago debe ser igual a la suma imputada a las órdenes", { field: "amountCents" });
        allocations = body.allocations;
      } else {
        if (body.amountCents > pendingTotal) {
          throw badRequest(`El monto supera lo pendiente con ${lab.name} (${(pendingTotal / 100).toFixed(2)} Bs)`, { field: "amountCents" });
        }
        allocations = allocateFifo(body.amountCents, pend).allocations;
      }
      let id: string;
      try {
        id = (await c.query<{ id: string }>(
          `INSERT INTO lab_payments (clinic_id, lab_id, amount_cents, paid_on, method, reference, note, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
          [auth.clinicId, body.labId, body.amountCents, body.paidOn, body.method, body.reference, body.note, auth.userId])).rows[0]!.id;
      } catch (e) {
        if ((e as { constraint?: string }).constraint === "lab_payments_reference_uq") throw conflict("Esa referencia ya fue registrada en otro pago a este laboratorio", "duplicate_reference");
        throw e;
      }
      for (const a of allocations) {
        await c.query("INSERT INTO lab_payment_allocations (clinic_id, payment_id, order_id, amount_cents) VALUES ($1,$2,$3,$4)", [auth.clinicId, id, a.orderId, a.amountCents]);
      }
      await audit(c, auth, "lab.payment_registered", "lab_payment", id, { labId: body.labId, amountCents: body.amountCents, method: body.method, paidOn: body.paidOn, allocations });
      return { id, allocations, pendingAfterCents: pendingTotal - body.amountCents };
    },
  });

  route({
    method: "GET", url: "/api/lab/payments", summary: "Pagos registrados a laboratorios (filtros: laboratorio y período)", tags: ["laboratorio"], perm: "patients.read",
    query: z.object({ labId: zId.optional(), from: zDate.optional(), to: zDate.optional() }),
    handler: async ({ c, auth, query }) => {
      requirePayables(auth);
      return (await c.query(
        `SELECT p.id, p.lab_id AS "labId", l.name AS "labName", p.amount_cents AS "amountCents", p.paid_on AS "paidOn", p.method, p.reference, p.note,
                p.created_at AS "createdAt", u.full_name AS "byName",
                (SELECT json_agg(json_build_object('number', o.number, 'amountCents', a.amount_cents) ORDER BY o.number)
                   FROM lab_payment_allocations a JOIN lab_orders o ON o.id = a.order_id WHERE a.payment_id = p.id) AS orders,
                v.created_at AS "voidedAt", v.reason AS "voidReason", vu.full_name AS "voidedByName"
           FROM lab_payments p JOIN labs l ON l.id = p.lab_id JOIN users u ON u.id = p.created_by
           LEFT JOIN lab_payment_voids v ON v.payment_id = p.id LEFT JOIN users vu ON vu.id = v.created_by
          WHERE ($1::uuid IS NULL OR p.lab_id = $1) AND ($2::date IS NULL OR p.paid_on >= $2) AND ($3::date IS NULL OR p.paid_on <= $3)
          ORDER BY p.paid_on DESC, p.created_at DESC LIMIT 300`, [query.labId ?? null, query.from ?? null, query.to ?? null])).rows
        .map((r) => ({ ...r, methodLabel: LAB_PAY_METHOD_LABELS[r.method] }));
    },
  });

  // B-073: anular un pago mal registrado. El pago y sus aplicaciones quedan; las órdenes vuelven a deberse.
  route({
    method: "POST", url: "/api/lab/payments/:id/void", summary: "Anular un pago a laboratorio con motivo (queda en el historial; lo que cubría vuelve a quedar por pagar)", tags: ["laboratorio"],
    perm: "patients.read", params: zIdParams, body: z.object({ reason: z.string().trim().min(3, "Escribe el motivo (al menos 3 caracteres)").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      requirePayables(auth);
      if (!auth.permissions.has("payments.void")) throw forbidden("Solo quien puede anular pagos (gerencia) anula un pago a laboratorio");
      const p = (await c.query<{ lab_id: string; amount_cents: number }>("SELECT lab_id, amount_cents FROM lab_payments WHERE id = $1", [params.id])).rows[0];
      if (!p) throw notFound("Pago");
      try {
        await c.query("INSERT INTO lab_payment_voids (clinic_id, payment_id, reason, created_by) VALUES ($1,$2,$3,$4)", [auth.clinicId, params.id, body.reason, auth.userId]);
      } catch (e) {
        if ((e as { constraint?: string }).constraint === "lab_payment_voids_once") throw conflict("Ese pago ya estaba anulado", "already_voided");
        throw e;
      }
      await audit(c, auth, "lab.payment_voided", "lab_payment", params.id, { labId: p.lab_id, amountCents: Number(p.amount_cents), reason: body.reason });
      return { ok: true };
    },
  });

  const zStatementQ = z.object({ labId: zId, from: zDate, to: zDate });
  route({
    method: "GET", url: "/api/lab/statement", summary: "Estado de cuenta de un laboratorio en un período (saldo inicial, trabajos recibidos, pagos y saldo final)", tags: ["laboratorio"], perm: "patients.read",
    query: zStatementQ,
    handler: async ({ c, auth, query }) => {
      requirePayables(auth);
      if (query.to < query.from) throw badRequest("La fecha final debe ser igual o posterior a la inicial");
      return statement(c, query.labId, query.from, query.to);
    },
  });

  route({
    method: "GET", url: "/api/lab/statement.xlsx", summary: "Exportar a Excel el estado de cuenta de un laboratorio", tags: ["laboratorio"], perm: "patients.read", raw: true,
    query: zStatementQ,
    handler: async ({ c, auth, query, reply }) => {
      requirePayables(auth);
      if (query.to < query.from) throw badRequest("La fecha final debe ser igual o posterior a la inicial");
      const s = await statement(c, query.labId, query.from, query.to);
      const fmt = (d: string) => DateTime.fromISO(d).toFormat("dd/MM/yyyy");
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Estado de cuenta");
      ws.addRow([`Estado de cuenta · ${safe(s.lab.name)}`]).font = { bold: true, size: 13 };
      ws.addRow(["Período", `${fmt(s.from)} a ${fmt(s.to)}`]);
      ws.addRow([]);
      ws.addRow(["Fecha", "Detalle", "Debe: trabajos (Bs)", "Haber: pagos (Bs)", "Saldo (Bs)"]).font = { bold: true };
      ws.addRow([fmt(s.from), "Saldo inicial", "", "", s.openingCents / 100]);
      for (const m of s.movements) ws.addRow([fmt(m.date), safe(m.description), m.debitCents ? m.debitCents / 100 : "", m.creditCents ? m.creditCents / 100 : "", m.balanceCents! / 100]);
      ws.addRow(["", "Totales del período", s.debitCents / 100, s.creditCents / 100, s.closingCents / 100]).font = { bold: true };
      [3, 4, 5].forEach((i) => (ws.getColumn(i).numFmt = "#,##0.00"));
      ws.columns.forEach((col, i) => (col.width = i === 1 ? 60 : 18));
      await audit(c, auth, "lab.statement_exported", "lab", query.labId, { from: query.from, to: query.to });
      await sendXlsx(reply, wb, `estado-cuenta-${fileSafe(s.lab.name)}-${s.from}.xlsx`);
    },
  });
}

