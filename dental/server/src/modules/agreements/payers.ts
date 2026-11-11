// Cuentas por cobrar por pagador (convenios): porción del tercero de cada cargo, pagos de la
// empresa aplicados a varios cargos (pendiente de verificación → otra persona confirma, D-07),
// estado de cuenta por período en pantalla, Excel y PDF (lib/pdf.ts, con huella y código).
//
// Una empresa paga cargos de pacientes de varias sucursales: lo gestiona quien tiene acceso a
// todas las sucursales (como las cuentas por pagar del laboratorio).
import { z } from "zod";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import type { FastifyReply } from "fastify";
import type { Config } from "../../config.js";
import type { Route } from "../../lib/http.js";
import { zDate, zId, zIdParams, zMoney, zOptText } from "../../lib/http.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { nextCounter, type Client } from "../../lib/db.js";
import { hasAllBranches, requireBranch, type AuthCtx } from "../../lib/rbac.js";
import { fmtBs, fmtDateTime, fmtYmd, formatVerifyCode, newVerifyCode, renderPdf, sha256hex, snapshotHash } from "../../lib/pdf.js";
import { clinicZone } from "../agenda.js";
import { letterheadData } from "../documents-core.js";
import { AGREEMENT_KINDS, clinicToday } from "./core.js";

export const PAYER_METHOD_LABELS: Record<string, string> = { transfer: "Transferencia", qr: "QR", card: "Tarjeta" };
export const PAYER_STATUS_LABELS: Record<string, string> = { pending_verification: "Por verificar", confirmed: "Confirmado", rejected: "Rechazado", voided: "Anulado" };

export function requireAllBranches(auth: AuthCtx) {
  if (!hasAllBranches(auth)) throw forbidden("Las cuentas de empresas y convenios las gestiona quien tiene acceso a todas las sucursales");
}

/** Cargos con porción del convenio y su saldo (lo aplicado cuenta si el pago está pendiente o confirmado). */
const CHARGES_SQL = `
  SELECT ch.id, ch.created_at AS "createdAt", ch.branch_id AS "branchId", br.name AS "branchName", ch.patient_id AS "patientId",
         p.first_name || ' ' || p.last_name AS "patientName", p.record_number AS "recordNumber",
         COALESCE(pa.member_number, (SELECT x.member_number FROM patient_agreements x WHERE x.patient_id = ch.patient_id AND x.agreement_id = ch.payer_agreement_id
                                       ORDER BY x.valid_from DESC LIMIT 1)) AS "memberNumber",
         COALESCE(bi.description, ch.description) || CASE WHEN ch.session_id IS NOT NULL THEN ' · sesión' ELSE '' END AS "service",
         ch.amount_cents AS "amountCents", ch.third_party_cents AS "companyCents",
         COALESCE((SELECT sum(v.third_party_cents) FROM charges v WHERE v.voids_charge_id = ch.id), 0)::bigint AS "voidedCents",
         COALESCE((SELECT sum(a.amount_cents) FROM payer_payment_allocations a JOIN payer_payments pp ON pp.id = a.payment_id
                    WHERE a.charge_id = ch.id AND pp.status = 'confirmed'), 0)::bigint AS "paidCents",
         COALESCE((SELECT sum(a.amount_cents) FROM payer_payment_allocations a JOIN payer_payments pp ON pp.id = a.payment_id
                    WHERE a.charge_id = ch.id AND pp.status = 'pending_verification'), 0)::bigint AS "pendingCents"
    FROM charges ch JOIN patients p ON p.id = ch.patient_id JOIN branches br ON br.id = ch.branch_id
    LEFT JOIN budget_items bi ON bi.id = ch.budget_item_id LEFT JOIN patient_agreements pa ON pa.id = bi.patient_agreement_id
   WHERE ch.payer_agreement_id = $1 AND ch.voids_charge_id IS NULL AND ch.third_party_cents > 0`;

export interface PayerCharge {
  id: string; createdAt: Date; branchName: string; patientId: string; patientName: string; recordNumber: number; memberNumber: string | null; service: string;
  amountCents: number; companyCents: number; voidedCents: number; paidCents: number; pendingCents: number; dueCents: number; openCents: number; voided: boolean;
}

export async function payerCharges(c: Client, agreementId: string, onlyOpen = false): Promise<PayerCharge[]> {
  const rows = (await c.query(`${CHARGES_SQL} ORDER BY ch.created_at, ch.id`, [agreementId])).rows;
  const out = rows.map((r) => {
    const company = Number(r.companyCents), voided = Number(r.voidedCents), paid = Number(r.paidCents), pending = Number(r.pendingCents);
    const due = company + voided; // porción viva (una anulación la deja en cero)
    return { ...r, recordNumber: Number(r.recordNumber), amountCents: Number(r.amountCents), companyCents: company, voidedCents: voided, paidCents: paid, pendingCents: pending,
      dueCents: due - paid, openCents: due - paid - pending, voided: voided !== 0 } as PayerCharge;
  });
  return onlyOpen ? out.filter((x) => x.openCents > 0) : out;
}

async function agreementRow(c: Client, id: string) {
  const a = (await c.query(
    `SELECT id, name, kind, tax_id AS "taxId", billing_name AS "billingName", contact_name AS "contactName", contact_email AS "contactEmail", payment_terms_days AS "paymentTermsDays"
       FROM agreements WHERE id = $1`, [id])).rows[0];
  if (!a) throw notFound("Convenio");
  return { ...a, kindLabel: AGREEMENT_KINDS[a.kind] };
}

/** Estado de cuenta de la empresa: saldo inicial, cargos (debe), anulaciones y pagos confirmados (haber) y saldo final. */
export async function payerStatement(c: Client, agreementId: string, from: string, to: string) {
  const agreement = await agreementRow(c, agreementId);
  const zone = await clinicZone(c, (await c.query<{ id: string }>("SELECT app_clinic_id() AS id")).rows[0]!.id);
  const s = DateTime.fromISO(from, { zone }).startOf("day").toJSDate();
  const e = DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day").toJSDate();
  const before = (await c.query<{ debit: number; credit: number }>(
    `SELECT COALESCE((SELECT sum(third_party_cents) FROM charges WHERE payer_agreement_id = $1 AND created_at < $2), 0)::bigint AS debit,
            COALESCE((SELECT sum(amount_cents) FROM payer_payments WHERE agreement_id = $1 AND status = 'confirmed' AND received_at < $2), 0)::bigint AS credit`,
    [agreementId, s])).rows[0]!;
  const charges = (await c.query(
    `SELECT ch.id, ch.created_at, ch.third_party_cents, ch.voids_charge_id, p.first_name || ' ' || p.last_name AS patient, p.record_number,
            COALESCE(bi.description, o_bi.description, ch.description) AS service, COALESCE(pa.member_number, o_pa.member_number) AS member
       FROM charges ch JOIN patients p ON p.id = ch.patient_id
       LEFT JOIN budget_items bi ON bi.id = ch.budget_item_id LEFT JOIN patient_agreements pa ON pa.id = bi.patient_agreement_id
       LEFT JOIN charges o ON o.id = ch.voids_charge_id LEFT JOIN budget_items o_bi ON o_bi.id = o.budget_item_id LEFT JOIN patient_agreements o_pa ON o_pa.id = o_bi.patient_agreement_id
      WHERE ch.payer_agreement_id = $1 AND ch.third_party_cents <> 0 AND ch.created_at >= $2 AND ch.created_at < $3`, [agreementId, s, e])).rows;
  const pays = (await c.query(
    `SELECT id, number, received_at, amount_cents, method, bank_reference, status FROM payer_payments
      WHERE agreement_id = $1 AND received_at >= $2 AND received_at < $3 AND status IN ('confirmed','pending_verification')`, [agreementId, s, e])).rows;
  type Mv = { date: string; at: string; kind: "charge" | "void" | "payment"; id: string; description: string; patient: string | null; memberNumber: string | null; debitCents: number; creditCents: number; balanceCents?: number };
  const moves: Mv[] = [
    ...charges.map((ch) => ({
      date: DateTime.fromJSDate(new Date(ch.created_at)).setZone(zone).toISODate()!, at: new Date(ch.created_at).toISOString(),
      kind: (ch.voids_charge_id ? "void" : "charge") as Mv["kind"], id: ch.id,
      description: ch.voids_charge_id ? `Anulación: ${ch.service}` : ch.service, patient: `${ch.patient} (ficha ${ch.record_number})`, memberNumber: ch.member,
      debitCents: Math.max(Number(ch.third_party_cents), 0), creditCents: Math.max(-Number(ch.third_party_cents), 0),
    })),
    ...pays.filter((p) => p.status === "confirmed").map((p) => ({
      date: DateTime.fromJSDate(new Date(p.received_at)).setZone(zone).toISODate()!, at: new Date(p.received_at).toISOString(), kind: "payment" as const, id: p.id,
      description: `Pago N° ${p.number} · ${PAYER_METHOD_LABELS[p.method]} · ref. ${p.bank_reference}`, patient: null, memberNumber: null, debitCents: 0, creditCents: Number(p.amount_cents),
    })),
  ].sort((a, b) => (a.at < b.at ? -1 : a.at > b.at ? 1 : 0));
  const opening = Number(before.debit) - Number(before.credit);
  let bal = opening;
  for (const m of moves) { bal += m.debitCents - m.creditCents; m.balanceCents = bal; }
  const debit = moves.reduce((x, m) => x + m.debitCents, 0), credit = moves.reduce((x, m) => x + m.creditCents, 0);
  const pending = pays.filter((p) => p.status === "pending_verification").map((p) => ({
    id: p.id, number: Number(p.number), receivedAt: p.received_at, amountCents: Number(p.amount_cents), method: p.method, methodLabel: PAYER_METHOD_LABELS[p.method], bankReference: p.bank_reference,
  }));
  return { agreement, from, to, zone, openingCents: opening, debitCents: debit, creditCents: credit, closingCents: opening + debit - credit, movements: moves, pendingPayments: pending };
}

const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v); // evita inyección de fórmulas
const fileSafe = (s: string) => s.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();
async function sendXlsx(reply: FastifyReply, wb: ExcelJS.Workbook, name: string) {
  reply
    .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .header("content-disposition", `attachment; filename="${name}"`)
    .send(Buffer.from(await wb.xlsx.writeBuffer()));
}

const zPeriod = z.object({ from: zDate, to: zDate }).refine((q) => q.to >= q.from, { message: "El período termina antes de empezar", path: ["to"] })
  .refine((q) => DateTime.fromISO(q.to).diff(DateTime.fromISO(q.from), "days").days <= 1830, { message: "El período no puede superar 5 años", path: ["to"] });

export function payerRoutes(route: Route, cfg: Config) {
  route({
    method: "GET", url: "/api/payers/receivables", summary: "Cuentas por cobrar por pagador (convenios): facturado a la empresa, cobrado, por verificar y saldo", tags: ["convenios"], perm: "payments.read",
    handler: async ({ c, auth }) => {
      requireAllBranches(auth);
      const r = (await c.query(
        `SELECT a.id, a.name, a.kind, a.payment_terms_days AS "paymentTermsDays",
                COALESCE((SELECT sum(third_party_cents) FROM charges ch WHERE ch.payer_agreement_id = a.id), 0)::bigint AS "billedCents",
                COALESCE((SELECT sum(amount_cents) FROM payer_payments pp WHERE pp.agreement_id = a.id AND pp.status = 'confirmed'), 0)::bigint AS "paidCents",
                COALESCE((SELECT sum(amount_cents) FROM payer_payments pp WHERE pp.agreement_id = a.id AND pp.status = 'pending_verification'), 0)::bigint AS "pendingCents"
           FROM agreements a ORDER BY a.name`)).rows;
      const out = [];
      for (const a of r) {
        const open = await payerCharges(c, a.id, false);
        const due = open.filter((x) => x.dueCents > 0);
        const today = DateTime.fromISO(await clinicToday(c));
        const overdue = due.filter((x) => today.diff(DateTime.fromJSDate(new Date(x.createdAt)), "days").days > a.paymentTermsDays);
        out.push({
          ...a, kindLabel: AGREEMENT_KINDS[a.kind], billedCents: Number(a.billedCents), paidCents: Number(a.paidCents), pendingCents: Number(a.pendingCents),
          balanceCents: Number(a.billedCents) - Number(a.paidCents), openCharges: due.length, overdueCents: overdue.reduce((s, x) => s + x.dueCents, 0),
          oldestDueAt: due[0]?.createdAt ?? null,
        });
      }
      return out.filter((x) => x.billedCents !== 0 || x.paidCents !== 0 || x.pendingCents !== 0);
    },
  });

  route({
    method: "GET", url: "/api/agreements/:id/charges", summary: "Cargos con porción de la empresa y su saldo (para aplicar un pago)", tags: ["convenios"], perm: "payments.read", params: zIdParams,
    query: z.object({ open: z.enum(["1", "0"]).default("1") }),
    handler: async ({ c, auth, params, query }) => {
      requireAllBranches(auth);
      await agreementRow(c, params.id);
      return payerCharges(c, params.id, query.open === "1");
    },
  });

  route({
    method: "GET", url: "/api/agreements/:id/statement", summary: "Estado de cuenta de la empresa por período (fechas en la zona de la clínica)", tags: ["convenios"], perm: "payments.read", params: zIdParams, query: zPeriod,
    handler: async ({ c, auth, params, query }) => {
      requireAllBranches(auth);
      return payerStatement(c, params.id, query.from, query.to);
    },
  });

  route({
    method: "GET", url: "/api/agreements/:id/statement.xlsx", summary: "Exportar a Excel el estado de cuenta de la empresa", tags: ["convenios"], perm: "payments.read", params: zIdParams, query: zPeriod, raw: true,
    handler: async ({ c, auth, params, query, reply }) => {
      requireAllBranches(auth);
      const st = await payerStatement(c, params.id, query.from, query.to);
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Estado de cuenta");
      ws.addRow([`Estado de cuenta · ${st.agreement.name}`]).font = { bold: true, size: 13 };
      ws.addRow([`NIT ${st.agreement.taxId ?? "—"}`, safe(st.agreement.billingName ?? ""), `Del ${fmtYmd(st.from)} al ${fmtYmd(st.to)}`]);
      ws.addRow([]);
      ws.addRow(["Fecha", "Paciente", "N° afiliado", "Concepto", "Debe (Bs)", "Haber (Bs)", "Saldo (Bs)"]).font = { bold: true };
      ws.addRow(["", "", "", "Saldo inicial", "", "", st.openingCents / 100]);
      for (const m of st.movements) ws.addRow([fmtYmd(m.date), safe(m.patient ?? ""), safe(m.memberNumber ?? ""), safe(m.description), m.debitCents / 100, m.creditCents / 100, (m.balanceCents ?? 0) / 100]);
      ws.addRow(["", "", "", "Totales y saldo final", st.debitCents / 100, st.creditCents / 100, st.closingCents / 100]).font = { bold: true };
      if (st.pendingPayments.length) {
        ws.addRow([]);
        ws.addRow(["Pagos registrados pendientes de verificación (no descuentan el saldo hasta confirmarse)"]).font = { italic: true };
        for (const p of st.pendingPayments) ws.addRow([DateTime.fromJSDate(new Date(p.receivedAt)).setZone(st.zone).toFormat("dd/MM/yyyy"), "", "", `Pago N° ${p.number} · ${p.methodLabel} · ref. ${safe(p.bankReference)}`, "", p.amountCents / 100, ""]);
      }
      [5, 6, 7].forEach((i) => (ws.getColumn(i).numFmt = "#,##0.00"));
      ws.columns.forEach((col, i) => (col.width = [12, 28, 14, 40, 13, 13, 13][i] ?? 14));
      await audit(c, auth, "agreement.statement_exported", "agreement", params.id, { from: query.from, to: query.to, format: "xlsx" });
      await sendXlsx(reply, wb, `estado-cuenta-${fileSafe(st.agreement.name)}-${query.from}-${query.to}.xlsx`);
    },
  });

  route({
    method: "GET", url: "/api/agreements/:id/statement.pdf", summary: "Emitir el estado de cuenta de la empresa en PDF (queda registrado, con huella y código de verificación)", tags: ["convenios"],
    perm: "payments.read", params: zIdParams, query: z.object({ from: zDate, to: zDate, branchId: zId.optional() }),
    handler: async ({ c, auth, params, query, reply }) => {
      requireAllBranches(auth);
      if (query.to < query.from) throw badRequest("El período termina antes de empezar");
      const st = await payerStatement(c, params.id, query.from, query.to);
      const branchId = query.branchId ?? (await c.query<{ id: string }>("SELECT id FROM branches ORDER BY code LIMIT 1")).rows[0]?.id;
      if (!branchId) throw notFound("Sucursal");
      const head = await letterheadData(c, branchId);
      const number = await nextCounter(c, auth.clinicId!, "payer_statement");
      const sid = (await c.query<{ id: string }>(
        "INSERT INTO payer_statements (clinic_id, number, agreement_id, period_from, period_to, closing_cents, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [auth.clinicId, number, params.id, query.from, query.to, st.closingCents, auth.userId])).rows[0]!.id;
      const issuedAt = new Date();
      const docNumber = `EC-${String(number).padStart(6, "0")}`;
      // JSON puro (las fechas como texto): la huella es la misma antes y después de guardarla en jsonb.
      const snapshot = JSON.parse(JSON.stringify({ type: "payer_statement", docNumber, title: `Estado de cuenta ${st.agreement.name}`, issuedAt: issuedAt.toISOString(), ...head, statement: st }));
      const fingerprint = snapshotHash(snapshot);
      const code = newVerifyCode();
      const verifyUrl = `${cfg.publicUrl}/verificar/${formatVerifyCode(code)}`;
      const zone = head.clinic.timezone;
      const pdf = await renderPdf({
        docTitle: "Estado de cuenta", docLabel: `Estado de cuenta N° ${docNumber}`, issuedAt, zone,
        letterhead: { clinicName: head.clinic.name, legalName: head.clinic.legalName, taxId: head.clinic.taxId, branchName: head.branch.name, address: head.branch.address, city: head.branch.city, phone: head.branch.phone },
        issuer: null, fingerprint, verifyCode: code, verifyUrl,
      }, (w) => {
        w.notice("Estado de cuenta del convenio. No es una factura fiscal.", "warn", true);
        w.fields([
          { label: "Empresa / convenio", value: st.agreement.name },
          { label: "Razón social", value: st.agreement.billingName ?? "—" },
          { label: "NIT", value: st.agreement.taxId ?? "—" },
          { label: "Período", value: `${fmtYmd(st.from)} al ${fmtYmd(st.to)}` },
        ], 4);
        w.table(
          [{ header: "Fecha", width: 11 }, { header: "Paciente / concepto", width: 44 }, { header: "Debe", width: 15, align: "right" }, { header: "Haber", width: 15, align: "right" }, { header: "Saldo", width: 15, align: "right" }],
          [
            { cells: ["", "Saldo inicial", "", "", fmtBs(st.openingCents)], muted: true },
            ...st.movements.map((m) => ({
              cells: [fmtYmd(m.date), [m.patient ? `${m.patient}${m.memberNumber ? ` · afiliado ${m.memberNumber}` : ""}` : null, m.description].filter(Boolean).join("\n"),
                m.debitCents ? fmtBs(m.debitCents) : "", m.creditCents ? fmtBs(m.creditCents) : "", fmtBs(m.balanceCents ?? 0)],
            })),
            { cells: ["", "Totales del período y saldo final", fmtBs(st.debitCents), fmtBs(st.creditCents), fmtBs(st.closingCents)], bold: true },
          ]);
        w.text(`Saldo a pagar al ${fmtYmd(st.to)}: ${fmtBs(st.closingCents)}`, { bold: true, size: 12 });
        if (st.pendingPayments.length) {
          w.text(`Pagos registrados y pendientes de verificación bancaria (aún no descuentan el saldo): ${st.pendingPayments.map((p) => `N° ${p.number} por ${fmtBs(p.amountCents)} (ref. ${p.bankReference})`).join("; ")}.`, { size: 9.5, color: "#33495a" });
        }
        w.text(`Emitido el ${fmtDateTime(issuedAt, zone)} por ${auth.fullName}.`, { size: 9, color: "#64788a" });
      });
      await c.query(
        `INSERT INTO pdf_documents (clinic_id, kind, source_id, variant, verify_code, doc_number, title, branch_id, issued_at, snapshot, content_hash, pdf, pdf_sha256, generated_by)
         VALUES ($1,'payer_statement',$2,'original',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`,
        [auth.clinicId, sid, code, docNumber, `Estado de cuenta ${st.agreement.name}`.slice(0, 150), branchId, issuedAt, JSON.stringify(snapshot), fingerprint, pdf, sha256hex(pdf), auth.userId]);
      await audit(c, auth, "agreement.statement_issued", "agreement", params.id, { number: docNumber, from: query.from, to: query.to, closingCents: st.closingCents, verifyCode: code });
      reply.header("content-type", "application/pdf")
        .header("content-disposition", `attachment; filename="estado-cuenta-${docNumber}.pdf"`)
        .header("x-verify-code", code);
      return pdf; // se envía después del COMMIT
    },
  });

  // ---------------- Pagos de la empresa ----------------
  route({
    method: "GET", url: "/api/payer-payments", summary: "Pagos de empresas (convenios) por estado", tags: ["convenios"], perm: "payments.read",
    query: z.object({ status: z.enum(["pending_verification", "confirmed", "rejected", "voided"]).optional(), agreementId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      requireAllBranches(auth);
      const r = await c.query(
        `SELECT pp.id, pp.number, pp.agreement_id AS "agreementId", a.name AS "agreementName", pp.amount_cents AS "amountCents", pp.method, pp.status,
                pp.bank_reference AS "bankReference", pp.received_at AS "receivedAt", pp.received_by AS "receivedBy", u.full_name AS "receivedByName",
                pp.verified_at AS "verifiedAt", vu.full_name AS "verifiedByName", pp.status_reason AS "statusReason", pp.notes, b.name AS "branchName",
                (SELECT count(*)::int FROM payer_payment_allocations x WHERE x.payment_id = pp.id) AS "chargesCount"
           FROM payer_payments pp JOIN agreements a ON a.id = pp.agreement_id JOIN users u ON u.id = pp.received_by JOIN branches b ON b.id = pp.branch_id
           LEFT JOIN users vu ON vu.id = pp.verified_by
          WHERE ($1::text IS NULL OR pp.status = $1) AND ($2::uuid IS NULL OR pp.agreement_id = $2)
          ORDER BY pp.received_at DESC LIMIT 300`, [query.status ?? null, query.agreementId ?? null]);
      return r.rows.map((x) => ({ ...x, methodLabel: PAYER_METHOD_LABELS[x.method], statusLabel: PAYER_STATUS_LABELS[x.status] }));
    },
  });

  route({
    method: "POST", url: "/api/agreements/:id/payments",
    summary: "Registrar un pago de la empresa aplicado a uno o varios cargos. Queda pendiente hasta que otra persona lo verifique en el banco. Idempotente.",
    tags: ["convenios"], perm: "payments.create", params: zIdParams,
    body: z.object({
      branchId: zId,
      amountCents: zMoney.refine((v) => v > 0, "El monto debe ser mayor a cero"),
      method: z.enum(["transfer", "qr", "card"]),
      bankReference: z.string().trim().min(1, "Indica el número de operación o referencia bancaria").max(80),
      notes: zOptText(500),
      idempotencyKey: z.string().min(8).max(80),
      allocations: z.array(z.object({ chargeId: zId, amountCents: zMoney.refine((v) => v > 0, "Cada monto aplicado debe ser mayor a cero") })).min(1, "Elige al menos un cargo").max(500),
    }),
    handler: async ({ c, auth, params, body }) => {
      requireAllBranches(auth);
      requireBranch(auth, body.branchId);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':' || $2, 0))", [auth.clinicId, body.idempotencyKey]);
      const ex = (await c.query<{ id: string; number: number; amount_cents: number; agreement_id: string; status: string }>(
        "SELECT id, number, amount_cents, agreement_id, status FROM payer_payments WHERE idempotency_key = $1", [body.idempotencyKey])).rows[0];
      if (ex) {
        if (Number(ex.amount_cents) !== body.amountCents || ex.agreement_id !== params.id) throw conflict("La clave de idempotencia ya se usó con otros datos", "idempotency_mismatch");
        return { id: ex.id, number: Number(ex.number), status: ex.status, duplicate: true };
      }
      await agreementRow(c, params.id);
      // Serializa los pagos del mismo convenio: lo pendiente de cada cargo se calcula sin carreras.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('payer:' || $1, 0))", [params.id]);
      const sum = body.allocations.reduce((s, a) => s + a.amountCents, 0);
      if (sum !== body.amountCents) throw new AppError(400, "allocation_mismatch", `Lo aplicado a los cargos (${fmtBs(sum)}) debe ser igual al monto del pago (${fmtBs(body.amountCents)})`);
      const ids = body.allocations.map((a) => a.chargeId);
      if (new Set(ids).size !== ids.length) throw badRequest("Un cargo aparece dos veces en el pago");
      const open = new Map((await payerCharges(c, params.id, false)).map((x) => [x.id, x]));
      for (const a of body.allocations) {
        const ch = open.get(a.chargeId);
        if (!ch) throw badRequest("Uno de los cargos no corresponde a este convenio");
        if (a.amountCents > ch.openCents) {
          throw new AppError(409, "allocation_exceeds", `El monto aplicado a ${ch.patientName} (${fmtBs(a.amountCents)}) supera lo pendiente del cargo (${fmtBs(Math.max(ch.openCents, 0))})`, { chargeId: ch.id, openCents: ch.openCents });
        }
      }
      const number = await nextCounter(c, auth.clinicId!, "payer_payment");
      const id = (await c.query<{ id: string }>(
        `INSERT INTO payer_payments (clinic_id, number, agreement_id, branch_id, amount_cents, method, status, bank_reference, notes, idempotency_key, received_by)
         VALUES ($1,$2,$3,$4,$5,$6,'pending_verification',$7,$8,$9,$10) RETURNING id`,
        [auth.clinicId, number, params.id, body.branchId, body.amountCents, body.method, body.bankReference, body.notes, body.idempotencyKey, auth.userId])).rows[0]!.id;
      for (const a of body.allocations) {
        await c.query("INSERT INTO payer_payment_allocations (clinic_id, payment_id, charge_id, amount_cents) VALUES ($1,$2,$3,$4)", [auth.clinicId, id, a.chargeId, a.amountCents]);
      }
      await audit(c, auth, "payer_payment.created", "payer_payment", id, { agreementId: params.id, number, amountCents: body.amountCents, method: body.method, charges: ids.length }, body.branchId);
      return { id, number, status: "pending_verification" };
    },
  });

  route({
    method: "GET", url: "/api/payer-payments/:id", summary: "Detalle de un pago de empresa con los cargos a los que se aplicó", tags: ["convenios"], perm: "payments.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      requireAllBranches(auth);
      const p = (await c.query(
        `SELECT pp.id, pp.number, pp.agreement_id AS "agreementId", a.name AS "agreementName", pp.amount_cents AS "amountCents", pp.method, pp.status, pp.bank_reference AS "bankReference",
                pp.received_at AS "receivedAt", u.full_name AS "receivedByName", pp.verified_at AS "verifiedAt", pp.status_reason AS "statusReason", pp.notes
           FROM payer_payments pp JOIN agreements a ON a.id = pp.agreement_id JOIN users u ON u.id = pp.received_by WHERE pp.id = $1`, [params.id])).rows[0];
      if (!p) throw notFound("Pago");
      const allocations = (await c.query(
        `SELECT x.charge_id AS "chargeId", x.amount_cents AS "amountCents", pt.first_name || ' ' || pt.last_name AS "patientName", COALESCE(bi.description, ch.description) AS service, ch.created_at AS "chargedAt"
           FROM payer_payment_allocations x JOIN charges ch ON ch.id = x.charge_id JOIN patients pt ON pt.id = ch.patient_id LEFT JOIN budget_items bi ON bi.id = ch.budget_item_id
          WHERE x.payment_id = $1 ORDER BY ch.created_at`, [params.id])).rows;
      return { ...p, methodLabel: PAYER_METHOD_LABELS[p.method], statusLabel: PAYER_STATUS_LABELS[p.status], allocations };
    },
  });

  route({
    method: "POST", url: "/api/payer-payments/:id/verify", summary: "Confirmar o rechazar un pago de empresa tras verlo en el banco (control dual)", tags: ["convenios"], perm: "payments.verify", params: zIdParams,
    body: z.object({ decision: z.enum(["confirmed", "rejected"]), reason: zOptText(300) }),
    handler: async ({ c, auth, params, body }) => {
      requireAllBranches(auth);
      const p = (await c.query<{ status: string; received_by: string; branch_id: string; amount_cents: number }>(
        "SELECT status, received_by, branch_id, amount_cents FROM payer_payments WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!p) throw notFound("Pago");
      if (p.status !== "pending_verification") throw conflict("Ese pago ya fue verificado", "invalid_status");
      if (p.received_by === auth.userId && auth.membership!.role !== "owner") throw forbidden("Otra persona debe verificar los pagos que registraste (control dual)");
      if (body.decision === "rejected" && !body.reason) throw badRequest("Indica el motivo del rechazo");
      await c.query("UPDATE payer_payments SET status = $2, verified_by = $3, verified_at = now(), status_reason = $4 WHERE id = $1", [params.id, body.decision, auth.userId, body.reason]);
      await audit(c, auth, `payer_payment.${body.decision}`, "payer_payment", params.id, { amountCents: Number(p.amount_cents), reason: body.reason }, p.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/payer-payments/:id/void", summary: "Anular un pago de empresa confirmado (devolución o error); los cargos vuelven a quedar pendientes", tags: ["convenios"], perm: "payments.void", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3, "Escribe el motivo").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      requireAllBranches(auth);
      const p = (await c.query<{ status: string; branch_id: string; amount_cents: number }>("SELECT status, branch_id, amount_cents FROM payer_payments WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!p) throw notFound("Pago");
      if (p.status !== "confirmed") throw conflict("Solo se anulan pagos confirmados", "invalid_status");
      await c.query("UPDATE payer_payments SET status = 'voided', status_reason = $2 WHERE id = $1", [params.id, body.reason]);
      await audit(c, auth, "payer_payment.voided", "payer_payment", params.id, { amountCents: Number(p.amount_cents), reason: body.reason }, p.branch_id);
      return { ok: true };
    },
  });
}
