// Conciliación bancaria por extracto (B-021, D-07). Una persona con payments.verify sube el
// extracto (Excel o CSV), elige las columnas, revisa la vista previa e importa. Cada abono se
// empareja con pagos «por verificar» (de pacientes o de empresas):
//   * exacto: misma referencia y mismo monto;
//   * sugerido: mismo monto y fecha a ±3 días (o la referencia aparece en la descripción).
// NADA se verifica solo: cada emparejamiento lo confirma una persona, con el mismo control dual
// que la verificación manual. Un movimiento y un pago se usan una sola vez (índices únicos), y
// reimportar el mismo extracto no duplica movimientos (hash por línea).
import { createHash } from "node:crypto";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams } from "../../lib/http.js";
import { AppError, badRequest, conflict, forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { Client } from "../../lib/db.js";
import { canAccessBranch, requireBranch, type AuthCtx } from "../../lib/rbac.js";
import { fmtBs } from "../../lib/pdf.js";
import { clinicZone } from "../agenda.js";
import { applyMapping, normRef, readTable, suggestMapping, type Mapping } from "./statementFile.js";

const METHOD_LABELS: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", qr: "QR", card: "Tarjeta" };
export const SUGGEST_DAYS = 3;
const MAX_BYTES = 5 * 1024 * 1024;

const zMapping = z.object({
  headerRow: z.number().int().min(0).max(50),
  date: z.number().int().min(0).max(60),
  amount: z.number().int().min(0).max(60),
  description: z.number().int().min(0).max(60).nullable(),
  reference: z.number().int().min(0).max(60).nullable(),
  dateOrder: z.enum(["dmy", "ymd", "mdy"]).default("dmy"),
});
const zFile = z.object({
  fileBase64: z.string().min(4, "Elige un archivo").max(Math.ceil((MAX_BYTES * 4) / 3) + 8, "El archivo supera 5 MB"),
  fileName: z.string().trim().min(1).max(200),
  mapping: zMapping.nullish(),
});

interface Candidate {
  kind: "payment" | "payer_payment"; id: string; matchKind: "exact" | "suggested"; status: string; amountCents: number; bankReference: string | null;
  method: string; methodLabel: string; receivedAt: string; receivedDate: string; who: string; receivedBy: string; receivedByName: string; branchId: string;
  canConfirm: boolean; blockedReason: string | null;
}

/** Pagos que pueden conciliarse: por verificar (cualquier fecha) o confirmados aún sin movimiento (últimos 180 días). */
async function openPayments(c: Client, zone: string) {
  const rows = (await c.query(
    `SELECT 'payment' AS kind, p.id, p.status, p.amount_cents, p.bank_reference, p.method, p.received_at, p.received_by, u.full_name AS received_by_name, p.branch_id,
            pt.first_name || ' ' || pt.last_name AS who
       FROM payments p JOIN patients pt ON pt.id = p.patient_id JOIN users u ON u.id = p.received_by
      WHERE p.method <> 'cash' AND NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.payment_id = p.id)
        AND (p.status = 'pending_verification' OR (p.status = 'confirmed' AND p.received_at > now() - interval '180 days'))
     UNION ALL
     SELECT 'payer_payment', pp.id, pp.status, pp.amount_cents, pp.bank_reference, pp.method, pp.received_at, pp.received_by, u.full_name, pp.branch_id,
            'Empresa: ' || a.name
       FROM payer_payments pp JOIN agreements a ON a.id = pp.agreement_id JOIN users u ON u.id = pp.received_by
      WHERE NOT EXISTS (SELECT 1 FROM bank_statement_lines l WHERE l.payer_payment_id = pp.id)
        AND (pp.status = 'pending_verification' OR (pp.status = 'confirmed' AND pp.received_at > now() - interval '180 days'))`)).rows;
  return rows.map((r) => ({ ...r, amount_cents: Number(r.amount_cents), date: DateTime.fromJSDate(new Date(r.received_at)).setZone(zone).toISODate()!, ref: normRef(r.bank_reference) }));
}
type OpenPayment = Awaited<ReturnType<typeof openPayments>>[number];

function blocked(auth: AuthCtx, p: OpenPayment): string | null {
  if (!canAccessBranch(auth, p.branch_id)) return "Es de una sucursal a la que no tienes acceso";
  if (p.status === "pending_verification" && p.received_by === auth.userId && auth.membership?.role !== "owner") return "Lo registraste tú: debe confirmarlo otra persona (control dual)";
  return null;
}

/** Candidatos de un movimiento: exactos (referencia y monto) y sugeridos (monto y fecha cercana). Los confirmados solo si son exactos. */
function candidatesFor(auth: AuthCtx, line: { date: string; amountCents: number; reference: string | null; description: string | null }, pays: OpenPayment[]): Candidate[] {
  const ref = normRef(line.reference);
  const desc = normRef(line.description);
  const out: Candidate[] = [];
  for (const p of pays) {
    if (p.amount_cents !== line.amountCents) continue;
    const exact = !!ref && ref === p.ref;
    const near = Math.abs(DateTime.fromISO(p.date).diff(DateTime.fromISO(line.date), "days").days) <= SUGGEST_DAYS;
    const inDesc = !!p.ref && p.ref.length >= 4 && desc.includes(p.ref);
    if (!exact && p.status === "confirmed") continue;
    if (!exact && !near && !inDesc) continue;
    const b = blocked(auth, p);
    out.push({
      kind: p.kind, id: p.id, matchKind: exact ? "exact" : "suggested", status: p.status, amountCents: p.amount_cents, bankReference: p.bank_reference,
      method: p.method, methodLabel: METHOD_LABELS[p.method] ?? p.method, receivedAt: new Date(p.received_at).toISOString(), receivedDate: p.date, who: p.who,
      receivedBy: p.received_by, receivedByName: p.received_by_name, branchId: p.branch_id, canConfirm: !b, blockedReason: b,
    });
  }
  return out.sort((a, b) => (a.matchKind === b.matchKind ? (a.status === b.status ? 0 : a.status === "pending_verification" ? -1 : 1) : a.matchKind === "exact" ? -1 : 1));
}

async function parseUpload(body: z.infer<typeof zFile>) {
  let buf: Buffer;
  try { buf = Buffer.from(body.fileBase64, "base64"); } catch { throw badRequest("No se pudo leer el archivo"); }
  if (buf.length > MAX_BYTES) throw badRequest("El archivo supera 5 MB");
  const rows = await readTable(buf);
  if (!rows.length) throw badRequest("El archivo no tiene filas");
  const suggested = suggestMapping(rows);
  const mapping: Mapping | null = body.mapping ?? suggested;
  if (!mapping) throw new AppError(400, "mapping_required", "No encontramos las columnas de fecha y monto: indica qué columna es cada una", { headers: rows.slice(0, 5) });
  if (mapping.headerRow >= rows.length) throw badRequest("La fila de títulos no existe en el archivo");
  const width = Math.max(...rows.slice(0, 30).map((r) => r.length));
  for (const k of ["date", "amount", "description", "reference"] as const) {
    const v = mapping[k];
    if (v !== null && v >= width) throw badRequest("Una de las columnas elegidas no existe en el archivo");
  }
  if (mapping.date === mapping.amount) throw badRequest("La fecha y el monto deben estar en columnas distintas");
  return { buf, rows, mapping, suggested, parsed: applyMapping(rows, mapping), sha: createHash("sha256").update(buf).digest("hex") };
}

const LINE_COLS = `l.id, l.statement_id AS "statementId", s.account_label AS "accountLabel", l.row_number AS "rowNumber", l.txn_date AS "date", l.description, l.reference,
  l.amount_cents AS "amountCents", l.status, l.payment_id AS "paymentId", l.payer_payment_id AS "payerPaymentId", l.match_kind AS "matchKind",
  l.resolved_at AS "resolvedAt", ru.full_name AS "resolvedByName", l.note`;

export function reconciliationRoutes(route: Route) {
  route({
    method: "POST", url: "/api/bank-statements/preview", summary: "Vista previa del extracto (Excel o CSV): columnas, filas leídas, duplicados ya importados y emparejamientos posibles. No guarda nada",
    tags: ["conciliación"], perm: "payments.verify", body: zFile,
    handler: async ({ c, auth, body }) => {
      const u = await parseUpload(body);
      const zone = await clinicZone(c, auth.clinicId!);
      const hashes = u.parsed.filter((r) => r.hash).map((r) => r.hash!);
      const existing = new Set((await c.query<{ line_hash: string }>("SELECT line_hash FROM bank_statement_lines WHERE line_hash = ANY($1)", [hashes])).rows.map((r) => r.line_hash));
      const pays = await openPayments(c, zone);
      const rows = u.parsed.map((r) => {
        const duplicate = !!r.hash && existing.has(r.hash);
        const cands = r.status === "ok" && !duplicate ? candidatesFor(auth, { date: r.date!, amountCents: r.amountCents!, reference: r.reference, description: r.description }, pays) : [];
        const { hash: _h, ...rest } = r;
        return { ...rest, duplicate, match: cands.find((x) => x.status === "pending_verification")?.matchKind ?? (cands.length ? "already_verified" : null) };
      });
      const ok = rows.filter((r) => r.status === "ok");
      return {
        headers: (u.rows[u.mapping.headerRow] ?? []).map((x) => (x === null ? "" : x instanceof Date ? x.toISOString().slice(0, 10) : String(x))),
        sample: u.rows.slice(0, 8).map((r) => r.map((x) => (x === null ? "" : x instanceof Date ? x.toISOString().slice(0, 10) : String(x)))),
        mapping: u.mapping, suggestedMapping: u.suggested, rows,
        summary: {
          total: rows.length, credits: ok.length, duplicates: ok.filter((r) => r.duplicate).length, debits: rows.filter((r) => r.status === "debit").length,
          errors: rows.filter((r) => r.status === "error").length, toImport: ok.filter((r) => !r.duplicate).length,
          exact: ok.filter((r) => !r.duplicate && r.match === "exact").length, suggested: ok.filter((r) => !r.duplicate && r.match === "suggested").length,
        },
      };
    },
  });

  route({
    method: "POST", url: "/api/bank-statements", summary: "Importar el extracto: guarda los abonos nuevos (los ya importados se omiten por su huella). No verifica ningún pago",
    tags: ["conciliación"], perm: "payments.verify",
    body: zFile.extend({ accountLabel: z.string().trim().min(2, "Indica la cuenta o el banco del extracto").max(80) }),
    handler: async ({ c, auth, body }) => {
      const u = await parseUpload(body);
      const ok = u.parsed.filter((r) => r.status === "ok");
      // Serializa las importaciones de la clínica: los conteos (registro de solo inserción) quedan exactos.
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended('bankimport:' || $1, 0))", [auth.clinicId]);
      const existing = new Set((await c.query<{ line_hash: string }>("SELECT line_hash FROM bank_statement_lines WHERE line_hash = ANY($1)", [ok.map((r) => r.hash!)])).rows.map((r) => r.line_hash));
      const fresh = ok.filter((r) => !existing.has(r.hash!));
      const counts = { imported: fresh.length, duplicates: ok.length - fresh.length, skipped: u.parsed.length - ok.length };
      const sid = (await c.query<{ id: string }>(
        `INSERT INTO bank_statements (clinic_id, account_label, file_name, file_sha256, mapping, total_rows, imported_rows, duplicate_rows, skipped_rows, uploaded_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id`,
        [auth.clinicId, body.accountLabel, body.fileName, u.sha, JSON.stringify(u.mapping), u.parsed.length, counts.imported, counts.duplicates, counts.skipped, auth.userId])).rows[0]!.id;
      for (const r of fresh) {
        await c.query(
          `INSERT INTO bank_statement_lines (clinic_id, statement_id, row_number, line_hash, txn_date, description, reference, amount_cents)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
          [auth.clinicId, sid, r.rowNumber, r.hash, r.date, r.description, r.reference, r.amountCents]);
      }
      await audit(c, auth, "bank_statement.imported", "bank_statement", sid, { fileName: body.fileName, accountLabel: body.accountLabel, sha256: u.sha, rows: u.parsed.length, ...counts });
      return { id: sid, ...counts, total: u.parsed.length };
    },
  });

  route({
    method: "GET", url: "/api/bank-statements", summary: "Extractos importados con sus movimientos por estado", tags: ["conciliación"], perm: "payments.verify",
    handler: async ({ c }) => (await c.query(
      `SELECT s.id, s.account_label AS "accountLabel", s.file_name AS "fileName", s.uploaded_at AS "uploadedAt", u.full_name AS "uploadedByName",
              s.total_rows AS "totalRows", s.skipped_rows AS "skippedRows", s.imported_rows AS "importedRows", s.duplicate_rows AS "duplicateRows",
              (SELECT count(*)::int FROM bank_statement_lines l WHERE l.statement_id = s.id) AS "lines",
              (SELECT count(*)::int FROM bank_statement_lines l WHERE l.statement_id = s.id AND l.status = 'unmatched') AS "unmatched",
              (SELECT count(*)::int FROM bank_statement_lines l WHERE l.statement_id = s.id AND l.status = 'matched') AS "matched",
              (SELECT count(*)::int FROM bank_statement_lines l WHERE l.statement_id = s.id AND l.status = 'ignored') AS "ignored"
         FROM bank_statements s JOIN users u ON u.id = s.uploaded_by ORDER BY s.uploaded_at DESC LIMIT 100`)).rows,
  });

  route({
    method: "GET", url: "/api/bank-lines", summary: "Movimientos del extracto; los «sin emparejar» traen sus candidatos (exactos y sugeridos)", tags: ["conciliación"], perm: "payments.verify",
    query: z.object({ status: z.enum(["unmatched", "matched", "ignored"]).default("unmatched"), statementId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      const rows = (await c.query(
        `SELECT ${LINE_COLS},
                COALESCE(pt.first_name || ' ' || pt.last_name, 'Empresa: ' || ag.name) AS "matchedWho", COALESCE(p.bank_reference, pp.bank_reference) AS "matchedReference"
           FROM bank_statement_lines l JOIN bank_statements s ON s.id = l.statement_id LEFT JOIN users ru ON ru.id = l.resolved_by
           LEFT JOIN payments p ON p.id = l.payment_id LEFT JOIN patients pt ON pt.id = p.patient_id
           LEFT JOIN payer_payments pp ON pp.id = l.payer_payment_id LEFT JOIN agreements ag ON ag.id = pp.agreement_id
          WHERE l.status = $1 AND ($2::uuid IS NULL OR l.statement_id = $2)
          ORDER BY l.txn_date DESC, l.row_number LIMIT 500`, [query.status, query.statementId ?? null])).rows;
      if (query.status !== "unmatched") return rows.map((r) => ({ ...r, amountCents: Number(r.amountCents) }));
      const pays = await openPayments(c, await clinicZone(c, auth.clinicId!));
      return rows.map((r) => ({ ...r, amountCents: Number(r.amountCents), candidates: candidatesFor(auth, { date: r.date, amountCents: Number(r.amountCents), reference: r.reference, description: r.description }, pays) }));
    },
  });

  route({
    method: "POST", url: "/api/bank-lines/:id/match",
    summary: "Confirmar el emparejamiento de un movimiento con un pago. Si el pago estaba por verificar, queda CONFIRMADO por quien concilia (control dual); nunca es automático",
    tags: ["conciliación"], perm: "payments.verify", params: zIdParams,
    body: z.object({ paymentId: zId.optional(), payerPaymentId: zId.optional() }).refine((b) => !!b.paymentId !== !!b.payerPaymentId, "Elige un solo pago"),
    handler: async ({ c, auth, params, body }) => {
      const line = (await c.query<{ status: string; amount_cents: number; txn_date: string; reference: string | null; description: string | null }>(
        "SELECT status, amount_cents, txn_date, reference, description FROM bank_statement_lines WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!line) throw notFound("Movimiento");
      if (line.status !== "unmatched") throw conflict("Ese movimiento ya fue conciliado o descartado", "line_used");
      const table = body.paymentId ? "payments" : "payer_payments";
      const pid = (body.paymentId ?? body.payerPaymentId)!;
      const p = (await c.query<{ status: string; amount_cents: number; received_by: string; branch_id: string; bank_reference: string | null; method: string; received_at: Date }>(
        `SELECT status, amount_cents, received_by, branch_id, bank_reference, method, received_at FROM ${table} WHERE id = $1 FOR UPDATE`, [pid])).rows[0];
      if (!p) throw notFound("Pago");
      requireBranch(auth, p.branch_id);
      if (p.method === "cash") throw badRequest("Los pagos en efectivo no se concilian con el extracto");
      if (Number(p.amount_cents) !== Number(line.amount_cents)) {
        throw new AppError(409, "amount_mismatch", `El monto del movimiento (${fmtBs(Number(line.amount_cents))}) no coincide con el del pago (${fmtBs(Number(p.amount_cents))}). Déjalo para revisión.`);
      }
      const used = await c.query(`SELECT 1 FROM bank_statement_lines WHERE ${body.paymentId ? "payment_id" : "payer_payment_id"} = $1`, [pid]);
      if (used.rowCount) throw conflict("Ese pago ya está conciliado con otro movimiento", "payment_used");
      const zone = await clinicZone(c, auth.clinicId!);
      const exact = !!normRef(line.reference) && normRef(line.reference) === normRef(p.bank_reference);
      const received = DateTime.fromJSDate(new Date(p.received_at)).setZone(zone).toISODate()!;
      const near = Math.abs(DateTime.fromISO(received).diff(DateTime.fromISO(line.txn_date), "days").days) <= SUGGEST_DAYS;
      let matchKind: "exact" | "suggested" | "manual" | "already_verified";
      if (p.status === "pending_verification") {
        if (p.received_by === auth.userId && auth.membership!.role !== "owner") throw forbidden("Otra persona debe verificar los pagos que registraste (control dual)");
        matchKind = exact ? "exact" : near ? "suggested" : "manual";
        const reason = `Conciliado con el extracto: ${line.txn_date}${line.reference ? `, ref. ${line.reference}` : ""}`.slice(0, 300);
        await c.query(`UPDATE ${table} SET status = 'confirmed', verified_by = $2, verified_at = now(), status_reason = $3 WHERE id = $1`, [pid, auth.userId, reason]);
        await audit(c, auth, body.paymentId ? "payment.confirmed" : "payer_payment.confirmed", body.paymentId ? "payment" : "payer_payment", pid,
          { amountCents: Number(p.amount_cents), via: "conciliación bancaria", bankLineId: params.id, matchKind }, p.branch_id);
      } else if (p.status === "confirmed") {
        if (!exact) throw conflict("Un pago ya verificado solo se vincula si la referencia y el monto coinciden exactamente", "not_exact");
        matchKind = "already_verified";
      } else {
        throw conflict("Ese pago fue rechazado o anulado; no se puede conciliar", "invalid_status");
      }
      await c.query(
        `UPDATE bank_statement_lines SET status = 'matched', ${body.paymentId ? "payment_id" : "payer_payment_id"} = $2, match_kind = $3, resolved_by = $4, resolved_at = now() WHERE id = $1`,
        [params.id, pid, matchKind, auth.userId]);
      await audit(c, auth, "bank_line.matched", "bank_line", params.id, { paymentId: body.paymentId ?? null, payerPaymentId: body.payerPaymentId ?? null, matchKind, amountCents: Number(line.amount_cents) }, p.branch_id);
      return { ok: true, matchKind, paymentStatus: "confirmed" };
    },
  });

  route({
    method: "POST", url: "/api/bank-lines/:id/ignore", summary: "Descartar un movimiento que no corresponde a un cobro (con motivo)", tags: ["conciliación"], perm: "payments.verify", params: zIdParams,
    body: z.object({ reason: z.string().trim().min(3, "Escribe el motivo").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const line = (await c.query<{ status: string; amount_cents: number }>("SELECT status, amount_cents FROM bank_statement_lines WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!line) throw notFound("Movimiento");
      if (line.status !== "unmatched") throw conflict("Ese movimiento ya fue conciliado o descartado", "line_used");
      await c.query("UPDATE bank_statement_lines SET status = 'ignored', note = $2, resolved_by = $3, resolved_at = now() WHERE id = $1", [params.id, body.reason, auth.userId]);
      await audit(c, auth, "bank_line.ignored", "bank_line", params.id, { reason: body.reason, amountCents: Number(line.amount_cents) });
      return { ok: true };
    },
  });
}
