// Núcleo de documentos PDF (B-064): instantáneas congeladas, registro de cada PDF con su
// código de verificación y huella, y comprobación de integridad.
//
// Decisión: el PRIMER PDF generado se guarda (pdf_documents, solo inserción) y se sirve
// siempre ese mismo archivo. No se regenera: así lo que recibió el paciente o la farmacia
// es byte a byte lo que la clínica puede mostrar, aunque cambie la plantilla, la
// biblioteca de PDF o los datos vivos (p. ej. un ítem del presupuesto anulado después).
import { DateTime } from "luxon";
import type { Client } from "../lib/db.js";
import { conflict, notFound } from "../lib/errors.js";
import { formatVerifyCode, newVerifyCode, sha256hex, snapshotHash } from "../lib/pdf.js";
import { contentHash as consentHash, KIND_LABELS, type Kind as ConsentKind } from "./consents.js";
import { METHOD_LABELS } from "./billing.js";
import { DOC_TITLES, renderSnapshot, type AnySnapshot, type BudgetSnapshot, type ConsentSnapshot, type ReceiptSnapshot, type SnapBranch, type SnapClinic, type SnapPatient } from "./documents-pdf.js";

export type PdfKind = "prescription" | "certificate" | "referral" | "budget" | "consent" | "receipt";
export const KIND_LABEL: Record<PdfKind, string> = {
  prescription: "Receta", certificate: "Certificado", referral: "Derivación a especialista", budget: "Presupuesto aceptado",
  consent: "Consentimiento firmado", receipt: "Recibo de pago",
};

export interface PdfRow {
  id: string; clinic_id: string; kind: PdfKind; source_id: string; variant: "original" | "voided"; verify_code: string; doc_number: string; title: string;
  branch_id: string; issued_at: Date; snapshot: AnySnapshot; content_hash: string; pdf: Buffer; pdf_sha256: string;
}

export async function letterheadData(c: Client, branchId: string): Promise<{ clinic: SnapClinic; branch: SnapBranch }> {
  const r = (await c.query(
    `SELECT cl.name AS cname, cl.legal_name, cl.tax_id, cl.timezone, b.name AS bname, b.address, b.city, b.phone
       FROM branches b JOIN clinics cl ON cl.id = b.clinic_id WHERE b.id = $1`, [branchId])).rows[0];
  if (!r) throw notFound("Sucursal");
  return {
    clinic: { name: r.cname, legalName: r.legal_name, taxId: r.tax_id, timezone: r.timezone },
    branch: { name: r.bname, address: r.address, city: r.city, phone: r.phone },
  };
}

export async function patientSnap(c: Client, patientId: string, at: Date, zone: string): Promise<SnapPatient> {
  const p = (await c.query(
    `SELECT first_name || ' ' || last_name AS name, document_type, document_number, document_issued, record_number, birth_date::text AS birth_date
       FROM patients WHERE id = $1`, [patientId])).rows[0];
  if (!p) throw notFound("Paciente");
  const age = p.birth_date ? Math.floor(DateTime.fromJSDate(at).setZone(zone).diff(DateTime.fromISO(p.birth_date, { zone }), "years").years) : null;
  return {
    name: p.name,
    document: p.document_number && p.document_type !== "SIN" ? `${p.document_type} ${p.document_number}${p.document_issued ? ` ${p.document_issued}` : ""}` : null,
    recordNumber: Number(p.record_number), birthDate: p.birth_date, age,
  };
}

export async function findPdf(c: Client, kind: PdfKind, sourceId: string, variant: "original" | "voided"): Promise<PdfRow | null> {
  return (await c.query<PdfRow>("SELECT * FROM pdf_documents WHERE kind = $1 AND source_id = $2 AND variant = $3", [kind, sourceId, variant])).rows[0] ?? null;
}

/** Genera y guarda el PDF (una sola vez por documento y variante). Si ya existía, devuelve el guardado. */
export async function storePdf(c: Client, o: {
  clinicId: string; kind: PdfKind; sourceId: string; variant: "original" | "voided"; docNumber: string; title: string; branchId: string;
  issuedAt: Date; snapshot: AnySnapshot; generatedBy: string | null; publicUrl: string; issuer?: { name: string; license: string | null } | null;
  signaturePng?: string | null;
}): Promise<{ row: PdfRow; created: boolean }> {
  const existing = await findPdf(c, o.kind, o.sourceId, o.variant);
  if (existing) return { row: existing, created: false };
  const fingerprint = snapshotHash(o.snapshot);
  const code = newVerifyCode();
  const verifyUrl = `${o.publicUrl}/verificar/${formatVerifyCode(code)}`;
  const pdf = await renderSnapshot(o.snapshot, {
    docTitle: DOC_TITLES[o.kind]!, docLabel: `${KIND_SHORT[o.kind]} N° ${o.docNumber}`,
    issuedAt: o.issuedAt, zone: o.snapshot.clinic.timezone,
    letterhead: { clinicName: o.snapshot.clinic.name, legalName: o.snapshot.clinic.legalName, taxId: o.snapshot.clinic.taxId, ...o.snapshot.branch, branchName: o.snapshot.branch.name },
    issuer: o.issuer ?? null, fingerprint, verifyCode: code, verifyUrl, watermark: o.variant === "voided" ? (o.kind === "receipt" || o.kind === "budget" ? "ANULADO" : "ANULADA") : null,
  }, { signaturePng: o.signaturePng ?? null });
  const r = await c.query<PdfRow>(
    `INSERT INTO pdf_documents (clinic_id, kind, source_id, variant, verify_code, doc_number, title, branch_id, issued_at, snapshot, content_hash, pdf, pdf_sha256, generated_by)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     ON CONFLICT ON CONSTRAINT pdf_documents_source_uq DO NOTHING RETURNING *`,
    [o.clinicId, o.kind, o.sourceId, o.variant, code, o.docNumber, o.title, o.branchId, o.issuedAt, JSON.stringify(o.snapshot), fingerprint, pdf, sha256hex(pdf), o.generatedBy]);
  if (r.rows[0]) return { row: r.rows[0], created: true };
  // Otra solicitud simultánea lo guardó primero: se sirve ese.
  return { row: (await findPdf(c, o.kind, o.sourceId, o.variant))!, created: false };
}

const KIND_SHORT: Record<PdfKind, string> = {
  prescription: "Receta", certificate: "Certificado", referral: "Derivación", budget: "Presupuesto", consent: "Documento", receipt: "Recibo",
};

export function sendPdf(reply: any, row: PdfRow) {
  const name = `${row.kind === "prescription" ? "receta" : row.kind === "receipt" ? "recibo" : row.kind === "budget" ? "presupuesto" : row.kind === "consent" ? "consentimiento" : row.kind === "referral" ? "derivacion" : "certificado"}-${row.doc_number}${row.variant === "voided" ? "-anulado" : ""}.pdf`
    .replace(/[^A-Za-z0-9._-]/g, "_");
  reply.header("content-type", "application/pdf")
    .header("content-disposition", `attachment; filename="${name}"`)
    .header("x-verify-code", row.verify_code);
  // Se devuelve (no se envía aquí) para que la respuesta salga después del COMMIT:
  // el PDF guardado y la auditoría de la descarga quedan firmes antes de entregarlo.
  return Buffer.from(row.pdf);
}

// ---------------- Presupuesto aceptado ----------------
export async function budgetSnapshot(c: Client, budgetId: string): Promise<{ snap: BudgetSnapshot; branchId: string; status: string; signaturePng: string | null; issuedAt: Date }> {
  const b = (await c.query(
    `SELECT b.id, b.number, b.version, b.status, b.branch_id, b.patient_id, b.installments, b.notes, b.valid_until::text AS valid_until, b.decided_at, b.decided_note,
            u.full_name AS dentist FROM budgets b JOIN users u ON u.id = b.dentist_id WHERE b.id = $1`, [budgetId])).rows[0];
  if (!b) throw notFound("Presupuesto");
  const head = await letterheadData(c, b.branch_id);
  const items = (await c.query(
    `SELECT description, tooth, surfaces, quantity, unit_price_cents * quantity AS gross, discount_cents + global_discount_cents AS disc, net_cents AS net
       FROM budget_items WHERE budget_id = $1 AND status <> 'cancelled' ORDER BY position, id`, [budgetId])).rows
    .map((i) => ({ description: i.description, tooth: i.tooth, surfaces: i.surfaces, quantity: i.quantity, grossCents: Number(i.gross), discountCents: Number(i.disc), netCents: Number(i.net) }));
  const total = items.reduce((s, i) => s + i.netCents, 0);
  const subtotal = items.reduce((s, i) => s + i.grossCents, 0);
  const n = Number(b.installments);
  const base = Math.floor(total / n);
  const ev = (await c.query(
    `SELECT created_at, signer_name, signer_relationship, content_hash, signature_png FROM budget_events
      WHERE budget_id = $1 AND kind = 'accepted' ORDER BY created_at DESC LIMIT 1`, [budgetId])).rows[0];
  const at: Date = ev?.created_at ?? b.decided_at ?? new Date();
  const snap: BudgetSnapshot = {
    type: "budget", docNumber: `${b.number}-v${b.version}`, title: `Presupuesto N° ${b.number}`, issuedAt: new Date(at).toISOString(), ...head,
    number: Number(b.number), version: b.version, patient: await patientSnap(c, b.patient_id, new Date(at), head.clinic.timezone), dentist: b.dentist,
    items, subtotalCents: subtotal, discountCents: subtotal - total, totalCents: total, installments: n,
    installmentPlan: Array.from({ length: n }, (_, k) => (k === n - 1 ? total - base * (n - 1) : base)),
    validUntil: b.valid_until, notes: b.notes,
    acceptance: ev
      ? { at: new Date(ev.created_at).toISOString(), channel: "online", signerName: ev.signer_name, relationship: ev.signer_relationship, contentHash: ev.content_hash, signatureSha256: ev.signature_png ? sha256hex(ev.signature_png) : null, note: null }
      : { at: new Date(at).toISOString(), channel: "clinic", signerName: null, relationship: null, contentHash: null, signatureSha256: null, note: b.decided_note },
  };
  return { snap, branchId: b.branch_id, status: b.status, signaturePng: ev?.signature_png ?? null, issuedAt: new Date(at) };
}

// ---------------- Consentimiento firmado ----------------
export async function consentSnapshot(c: Client, docId: string) {
  const d = (await c.query(
    `SELECT d.*, COALESCE(u.full_name, 'El paciente (reserva web)') AS recorded_by_name, p.first_name || ' ' || p.last_name AS patient_name, p.record_number
       FROM signed_documents d LEFT JOIN users u ON u.id = d.recorded_by JOIN patients p ON p.id = d.patient_id WHERE d.id = $1`, [docId])).rows[0];
  if (!d) throw notFound("Documento");
  const expected = consentRowHash(d);
  if (expected !== d.content_hash) throw conflict("La huella del documento firmado no coincide: no se emite el PDF. Avisa a administración.", "integrity_failed");
  const head = await letterheadData(c, d.branch_id);
  const snap: ConsentSnapshot = {
    type: "consent", docNumber: `CF-${String(d.id).slice(0, 8).toUpperCase()}`, title: d.title, issuedAt: new Date(d.signed_at).toISOString(), ...head,
    kindLabel: KIND_LABELS[d.kind as ConsentKind], templateVersion: d.template_version, body: d.body, decision: d.decision, method: d.method,
    signerName: d.signer_name, signerDocument: d.signer_document, signerRelationship: d.signer_relationship, signedAt: new Date(d.signed_at).toISOString(),
    recordedBy: d.recorded_by_name, notes: d.notes, patient: { name: d.patient_name, recordNumber: Number(d.record_number) },
    signatureSha256: d.signature_png ? sha256hex(d.signature_png) : null, contentHash: d.content_hash,
  };
  return { snap, row: d, branchId: d.branch_id as string, signaturePng: d.signature_png as string | null, issuedAt: new Date(d.signed_at) };
}

export function consentRowHash(d: any) {
  return consentHash({
    kind: d.kind, title: d.title, body: d.body, decision: d.decision, signerName: d.signer_name, signerDocument: d.signer_document,
    signerRelationship: d.signer_relationship, signedAt: new Date(d.signed_at).toISOString(), signaturePng: d.signature_png,
  });
}

// ---------------- Recibo de pago ----------------
export async function receiptSnapshot(c: Client, paymentId: string) {
  const p = (await c.query(
    `SELECT p.*, u.full_name AS received_by_name, b.number AS budget_number FROM payments p JOIN users u ON u.id = p.received_by
       LEFT JOIN budgets b ON b.id = p.budget_id WHERE p.id = $1`, [paymentId])).rows[0];
  if (!p) throw notFound("Pago");
  const head = await letterheadData(c, p.branch_id);
  const pat = await patientSnap(c, p.patient_id, new Date(p.received_at), head.clinic.timezone);
  const snap: ReceiptSnapshot = {
    type: "receipt", docNumber: String(p.receipt_number), title: `Recibo N° ${p.receipt_number}`, issuedAt: new Date(p.received_at).toISOString(), ...head,
    receiptNumber: Number(p.receipt_number), patient: { name: pat.name, document: pat.document, recordNumber: pat.recordNumber },
    amountCents: Number(p.amount_cents), method: p.method, methodLabel: METHOD_LABELS[p.method] ?? p.method, bankReference: p.bank_reference,
    receivedAt: new Date(p.received_at).toISOString(), receivedBy: p.received_by_name, verifiedAt: p.verified_at ? new Date(p.verified_at).toISOString() : null,
    budgetNumber: p.budget_number != null ? Number(p.budget_number) : null, notes: p.notes,
  };
  return { snap, row: p, branchId: p.branch_id as string, issuedAt: new Date(p.received_at) };
}

// ---------------- Verificación pública ----------------
export interface VerifyResult {
  found: true; intact: boolean; status: "valid" | "voided" | "superseded"; statusLabel: string; kind: PdfKind; kindLabel: string;
  issuedAt: string; clinicName: string; fingerprint: string; pdfSha256: string;
}

/** Comprueba que el PDF guardado y su instantánea no cambiaron, y el estado vigente del documento de origen. */
export async function verifyRow(c: Client, row: PdfRow): Promise<VerifyResult> {
  let intact = sha256hex(Buffer.from(row.pdf)) === row.pdf_sha256 && snapshotHash(row.snapshot) === row.content_hash;
  let status: VerifyResult["status"] = row.variant === "voided" ? "voided" : "valid";
  if (row.kind === "prescription" || row.kind === "certificate" || row.kind === "referral") {
    const d = (await c.query("SELECT snapshot, content_hash, EXISTS (SELECT 1 FROM clinical_document_voids v WHERE v.document_id = d.id) AS voided FROM clinical_documents d WHERE id = $1", [row.source_id])).rows[0];
    if (!d) intact = false;
    else {
      if (snapshotHash(d.snapshot) !== d.content_hash) intact = false;
      if (row.variant === "original" && row.content_hash !== d.content_hash) intact = false;
      if (d.voided) status = "voided";
    }
  } else if (row.kind === "consent") {
    const d = (await c.query("SELECT * FROM signed_documents WHERE id = $1", [row.source_id])).rows[0];
    if (!d || consentRowHash(d) !== d.content_hash || (row.snapshot as ConsentSnapshot).contentHash !== d.content_hash) intact = false;
  } else if (row.kind === "receipt") {
    const p = (await c.query<{ status: string }>("SELECT status FROM payments WHERE id = $1", [row.source_id])).rows[0];
    if (!p) intact = false;
    else if (p.status === "voided") status = "voided";
  } else if (row.kind === "budget") {
    const b = (await c.query<{ status: string }>("SELECT status FROM budgets WHERE id = $1", [row.source_id])).rows[0];
    if (!b) intact = false;
    else if (b.status === "cancelled") status = "voided";
    else if (b.status === "superseded") status = "superseded";
  }
  const clinicName = (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [row.clinic_id])).rows[0]?.name ?? "";
  return {
    found: true, intact, status,
    statusLabel: status === "voided" ? "Anulado: no tiene validez" : status === "superseded" ? "Reemplazado por una versión más reciente" : "Vigente",
    kind: row.kind, kindLabel: KIND_LABEL[row.kind], issuedAt: new Date(row.issued_at).toISOString(), clinicName,
    fingerprint: row.content_hash.slice(0, 16).toUpperCase().match(/.{4}/g)!.join(" "), pdfSha256: row.pdf_sha256,
  };
}
