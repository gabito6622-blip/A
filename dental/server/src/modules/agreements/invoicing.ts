// Facturación parcial "pendiente de facturar" (R2-32), preparada para el futuro proveedor SIAT (D-13 ⚠).
//
// NO emite facturas fiscales: registra qué líneas o sesiones de un presupuesto aceptado se deben
// facturar, a quién (paciente, empresa del convenio u otra persona, con NIT/CI y razón social) y
// por cuánto. El proveedor autorizado que se integre después tomará estas solicitudes.
// No se puede marcar más de lo pendiente: por pagador (parte de la empresa / parte del paciente)
// en la aplicación, y por línea y sesión también en la base (trigger invoice_lines_limit).
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams, zMoney, zOptText } from "../../lib/http.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { nextCounter, type Client } from "../../lib/db.js";
import { allowedBranches, requireBranch } from "../../lib/rbac.js";
import { fmtBs } from "../../lib/pdf.js";
import { budgetItemShares } from "./core.js";

export const BILL_TO_LABELS: Record<string, string> = { patient: "Paciente", agreement: "Empresa del convenio", other: "Otra persona (familiar responsable)" };
export const BUYER_DOC_LABELS: Record<string, string> = { NIT: "NIT", CI: "Cédula de identidad", CEX: "Cédula de extranjero", PAS: "Pasaporte", OD: "Otro documento" };
const DOC_FROM_PATIENT: Record<string, string> = { CI: "CI", PASAPORTE: "PAS", CE: "CEX", OTRO: "OD" };

/** Lo facturable de un presupuesto, por línea y sesión, separado por pagador. */
export async function invoiceable(c: Client, budgetId: string) {
  const b = (await c.query(
    `SELECT b.id, b.number, b.version, b.status, b.branch_id AS "branchId", b.patient_id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName",
            p.document_type, p.document_number, p.document_issued, p.email
       FROM budgets b JOIN patients p ON p.id = b.patient_id WHERE b.id = $1`, [budgetId])).rows[0];
  if (!b) throw notFound("Presupuesto");
  const items = (await c.query(
    `SELECT i.id, i.description, i.tooth, i.status, i.net_cents, i.agreement_id
       FROM budget_items i WHERE i.budget_id = $1 AND i.status <> 'cancelled' ORDER BY i.position, i.id`, [budgetId])).rows;
  const shares = new Map((await budgetItemShares(c, budgetId)).map((s) => [s.itemId, s]));
  const done = (await c.query<{ item: string; company: boolean; cents: number }>(
    `SELECT l.budget_item_id AS item, r.bill_to = 'agreement' AS company, sum(l.amount_cents)::bigint AS cents
       FROM invoice_request_lines l JOIN invoice_requests r ON r.id = l.request_id
      WHERE r.budget_id = $1 AND r.status = 'pending' GROUP BY 1, 2`, [budgetId])).rows;
  const sessions = (await c.query(
    `SELECT s.id, s.budget_item_id AS "itemId", s.position, s.name, s.status, s.amount_cents AS "amountCents",
            COALESCE((SELECT sum(l.amount_cents) FROM invoice_request_lines l JOIN invoice_requests r ON r.id = l.request_id
                       WHERE l.session_id = s.id AND r.status = 'pending'), 0)::bigint AS "invoicedCents"
       FROM budget_item_sessions s JOIN budget_items i ON i.id = s.budget_item_id WHERE i.budget_id = $1 ORDER BY s.position`, [budgetId])).rows;
  const agreement = items.some((i) => i.agreement_id)
    ? (await c.query(`SELECT id, name, tax_id AS "taxId", billing_name AS "billingName", contact_email AS "email" FROM agreements WHERE id = $1`,
        [items.find((i) => i.agreement_id)!.agreement_id])).rows[0]
    : null;
  const lines = items.map((i) => {
    const s = shares.get(i.id)!;
    const net = Number(i.net_cents);
    const company = s?.companyCents ?? 0;
    const inv = (co: boolean) => Number(done.find((d) => d.item === i.id && d.company === co)?.cents ?? 0);
    return {
      itemId: i.id, description: i.description, tooth: i.tooth, status: i.status, netCents: net, companyCents: company, patientCents: net - company,
      companyEstimated: (s?.estimatedCompanyCents ?? 0) > 0, agreementId: i.agreement_id,
      invoicedCompanyCents: inv(true), invoicedPatientCents: inv(false),
      pendingCompanyCents: Math.max(company - inv(true), 0), pendingPatientCents: Math.max(net - company - inv(false), 0),
      sessions: sessions.filter((x) => x.itemId === i.id).map((x) => ({ ...x, amountCents: Number(x.amountCents), invoicedCents: Number(x.invoicedCents), pendingCents: Number(x.amountCents) - Number(x.invoicedCents) })),
    };
  });
  const patientDoc = b.document_number && b.document_type !== "SIN" ? { docType: DOC_FROM_PATIENT[b.document_type] ?? "OD", taxId: String(b.document_number) } : null;
  return {
    budget: { id: b.id, number: Number(b.number), version: b.version, status: b.status, branchId: b.branchId, patientId: b.patientId, patientName: b.patientName },
    buyers: {
      patient: { name: b.patientName, docType: patientDoc?.docType ?? "CI", taxId: patientDoc?.taxId ?? "", email: b.email ?? null },
      agreement: agreement ? { id: agreement.id, name: agreement.billingName ?? agreement.name, agreementName: agreement.name, docType: "NIT", taxId: agreement.taxId ?? "", email: agreement.email ?? null } : null,
    },
    lines,
  };
}

const zLine = z.object({ budgetItemId: zId, sessionId: zId.nullish().transform((v) => v ?? null), amountCents: zMoney.refine((v) => v > 0, "El monto a facturar debe ser mayor a cero") });

export function invoicingRoutes(route: Route) {
  route({
    method: "GET", url: "/api/budgets/:id/invoiceable", summary: "Lo que se puede marcar para facturar de un presupuesto aceptado, por línea, sesión y pagador", tags: ["facturación"],
    perm: "payments.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const r = await invoiceable(c, params.id);
      requireBranch(auth, r.budget.branchId);
      return r;
    },
  });

  route({
    method: "POST", url: "/api/invoice-requests",
    summary: "Marcar líneas o sesiones como «pendiente de facturar» a nombre del paciente, la empresa u otra persona. No emite factura fiscal (SIAT pendiente)",
    tags: ["facturación"], perm: "payments.create",
    body: z.object({
      budgetId: zId,
      billTo: z.enum(["patient", "agreement", "other"]),
      buyerDocType: z.enum(["NIT", "CI", "CEX", "PAS", "OD"]),
      buyerTaxId: z.string().trim().regex(/^[0-9A-Za-z-]{1,20}$/, "Número de NIT o documento inválido (solo letras, números y guiones; hasta 20)"),
      buyerName: z.string().trim().min(2, "Escribe el nombre o razón social").max(160),
      buyerEmail: z.email("Correo inválido").nullish().or(z.literal("")).transform((v) => v || null),
      notes: zOptText(500),
      lines: z.array(zLine).min(1, "Elige al menos una línea").max(100),
    }),
    handler: async ({ c, auth, body }) => {
      const b = (await c.query<{ status: string; branch_id: string; patient_id: string }>("SELECT status, branch_id, patient_id FROM budgets WHERE id = $1 FOR UPDATE", [body.budgetId])).rows[0];
      if (!b) throw notFound("Presupuesto");
      requireBranch(auth, b.branch_id);
      if (!["accepted", "completed"].includes(b.status)) throw conflict("Solo se marca para facturar un presupuesto aceptado", "budget_not_accepted");
      if (body.buyerDocType === "NIT" && !/^[0-9]{1,15}$/.test(body.buyerTaxId)) throw badRequest("El NIT tiene solo números");
      const inv = await invoiceable(c, body.budgetId);
      const keys = body.lines.map((l) => `${l.budgetItemId}:${l.sessionId ?? ""}`);
      if (new Set(keys).size !== keys.length) throw badRequest("Una línea aparece dos veces");
      let agreementId: string | null = null;
      if (body.billTo === "agreement") {
        const ags = new Set(body.lines.map((l) => inv.lines.find((x) => x.itemId === l.budgetItemId)?.agreementId ?? null));
        if (ags.size !== 1 || ags.has(null)) throw badRequest("Para facturar a la empresa, todas las líneas deben ser del convenio");
        agreementId = [...ags][0]!;
      }
      // Lo pedido por línea (sumando sus sesiones) no supera lo pendiente de ese pagador.
      const perItem = new Map<string, number>();
      for (const l of body.lines) {
        const it = inv.lines.find((x) => x.itemId === l.budgetItemId);
        if (!it) throw badRequest("La línea no pertenece a este presupuesto o está anulada");
        if (l.sessionId) {
          const s = it.sessions.find((x) => x.id === l.sessionId);
          if (!s) throw badRequest("La sesión no pertenece a esa línea");
          if (l.amountCents > s.pendingCents) throw new AppError(409, "invoice_exceeds", `La sesión «${s.name}» tiene ${fmtBs(Math.max(s.pendingCents, 0))} pendientes de facturar; no se puede marcar ${fmtBs(l.amountCents)}`);
        }
        perItem.set(it.itemId, (perItem.get(it.itemId) ?? 0) + l.amountCents);
      }
      for (const [itemId, cents] of perItem) {
        const it = inv.lines.find((x) => x.itemId === itemId)!;
        const pending = body.billTo === "agreement" ? it.pendingCompanyCents : it.pendingPatientCents;
        if (cents > pending) {
          throw new AppError(409, "invoice_exceeds",
            `«${it.description}»: quedan ${fmtBs(pending)} pendientes de facturar ${body.billTo === "agreement" ? "a la empresa" : "al paciente"}; no se puede marcar ${fmtBs(cents)}`,
            { itemId, pendingCents: pending });
        }
      }
      const total = body.lines.reduce((s, l) => s + l.amountCents, 0);
      const number = await nextCounter(c, auth.clinicId!, "invoice_request");
      const id = (await c.query<{ id: string }>(
        `INSERT INTO invoice_requests (clinic_id, number, branch_id, patient_id, budget_id, bill_to, agreement_id, buyer_doc_type, buyer_tax_id, buyer_name, buyer_email, total_cents, notes, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [auth.clinicId, number, b.branch_id, b.patient_id, body.budgetId, body.billTo, agreementId, body.buyerDocType, body.buyerTaxId, body.buyerName, body.buyerEmail, total, body.notes, auth.userId])).rows[0]!.id;
      for (const l of body.lines) {
        const it = inv.lines.find((x) => x.itemId === l.budgetItemId)!;
        const s = l.sessionId ? it.sessions.find((x) => x.id === l.sessionId) : null;
        const desc = `${it.description}${it.tooth ? ` (pieza ${it.tooth})` : ""}${s ? ` · sesión: ${s.name}` : ""}`;
        await c.query("INSERT INTO invoice_request_lines (clinic_id, request_id, budget_item_id, session_id, description, amount_cents) VALUES ($1,$2,$3,$4,$5,$6)",
          [auth.clinicId, id, l.budgetItemId, l.sessionId, desc.slice(0, 300), l.amountCents]);
      }
      await audit(c, auth, "invoice_request.created", "invoice_request", id, { number, budgetId: body.budgetId, billTo: body.billTo, totalCents: total, lines: body.lines.length }, b.branch_id);
      return { id, number, totalCents: total, status: "pending" };
    },
  });

  route({
    method: "GET", url: "/api/invoice-requests", summary: "Solicitudes «pendiente de facturar» (para el futuro proveedor SIAT)", tags: ["facturación"], perm: "payments.read",
    query: z.object({ status: z.enum(["pending", "cancelled"]).optional(), budgetId: zId.optional(), patientId: zId.optional(), agreementId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      const rows = (await c.query(
        `SELECT r.id, r.number, r.status, r.bill_to AS "billTo", r.agreement_id AS "agreementId", a.name AS "agreementName", r.buyer_doc_type AS "buyerDocType",
                r.buyer_tax_id AS "buyerTaxId", r.buyer_name AS "buyerName", r.buyer_email AS "buyerEmail", r.total_cents AS "totalCents", r.notes,
                r.created_at AS "createdAt", u.full_name AS "createdByName", r.cancel_reason AS "cancelReason", r.cancelled_at AS "cancelledAt",
                r.budget_id AS "budgetId", bu.number AS "budgetNumber", r.patient_id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName", br.name AS "branchName",
                (SELECT json_agg(json_build_object('description', l.description, 'amountCents', l.amount_cents) ORDER BY l.description) FROM invoice_request_lines l WHERE l.request_id = r.id) AS lines
           FROM invoice_requests r JOIN users u ON u.id = r.created_by JOIN budgets bu ON bu.id = r.budget_id JOIN patients p ON p.id = r.patient_id
           JOIN branches br ON br.id = r.branch_id LEFT JOIN agreements a ON a.id = r.agreement_id
          WHERE ($1::text IS NULL OR r.status = $1) AND ($2::uuid IS NULL OR r.budget_id = $2) AND ($3::uuid IS NULL OR r.patient_id = $3)
            AND ($4::uuid IS NULL OR r.agreement_id = $4) AND ($5::uuid[] IS NULL OR r.branch_id = ANY($5))
          ORDER BY r.created_at DESC LIMIT 300`,
        [query.status ?? null, query.budgetId ?? null, query.patientId ?? null, query.agreementId ?? null, allowedBranches(auth)])).rows;
      return rows.map((r) => ({ ...r, billToLabel: BILL_TO_LABELS[r.billTo], statusLabel: r.status === "pending" ? "Pendiente de facturar" : "Anulada" }));
    },
  });

  route({
    method: "POST", url: "/api/invoice-requests/:id/cancel", summary: "Anular una solicitud pendiente de facturar (lo marcado vuelve a quedar disponible)", tags: ["facturación"], perm: "payments.void", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3, "Escribe el motivo").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const r = (await c.query<{ status: string; branch_id: string; number: number }>("SELECT status, branch_id, number FROM invoice_requests WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!r) throw notFound("Solicitud");
      requireBranch(auth, r.branch_id);
      if (r.status !== "pending") throw conflict("Esa solicitud ya fue anulada", "invalid_status");
      await c.query("UPDATE invoice_requests SET status = 'cancelled', cancel_reason = $2, cancelled_by = $3, cancelled_at = now() WHERE id = $1", [params.id, body.reason, auth.userId]);
      await audit(c, auth, "invoice_request.cancelled", "invoice_request", params.id, { number: Number(r.number), reason: body.reason }, r.branch_id);
      return { ok: true };
    },
  });
}
