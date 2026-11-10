// Diseño de cada PDF a partir de su instantánea congelada (recetas, certificados,
// derivaciones, presupuesto aceptado, consentimiento firmado y recibo).
import { amountInWords, fmtBs, fmtDateLong, fmtDateTime, fmtYmd, renderPdf, type PdfMeta, type PdfWriter } from "../lib/pdf.js";

export interface SnapClinic { name: string; legalName: string | null; taxId: string | null; timezone: string }
export interface SnapBranch { name: string; address: string | null; city: string | null; phone: string | null }
export interface SnapPatient { name: string; document: string | null; recordNumber: number; birthDate: string | null; age: number | null }
interface Base { docNumber: string; title: string; issuedAt: string; clinic: SnapClinic; branch: SnapBranch; voided?: { at: string; reason: string; by: string } | null }

export interface RxLine { drug: string; presentation: string | null; dose: string; frequency: string; duration: string; instructions: string | null }
export interface ClinicalSnapshot extends Base {
  type: "prescription" | "certificate" | "referral";
  template: string | null;
  patient: SnapPatient;
  issuer: { name: string; license: string | null };
  lines?: RxLine[];
  indications?: string | null;
  allergies?: string | null;
  body?: string;
  fields?: Record<string, string | number | null>;
  reissueOf?: string | null;
}
export interface BudgetSnapshot extends Base {
  type: "budget";
  number: number; version: number;
  patient: SnapPatient;
  dentist: string;
  items: { description: string; tooth: number | null; surfaces: string[]; quantity: number; grossCents: number; discountCents: number; netCents: number }[];
  subtotalCents: number; discountCents: number; totalCents: number;
  installments: number; installmentPlan: number[];
  validUntil: string | null; notes: string | null;
  acceptance: { at: string; channel: "online" | "clinic"; signerName: string | null; relationship: string | null; contentHash: string | null; signatureSha256: string | null; note: string | null };
}
export interface ConsentSnapshot extends Base {
  type: "consent";
  kindLabel: string; templateVersion: number | null; body: string;
  decision: string; method: string; signerName: string; signerDocument: string | null; signerRelationship: string;
  signedAt: string; recordedBy: string; notes: string | null;
  patient: { name: string; recordNumber: number };
  signatureSha256: string | null; contentHash: string;
}
export interface ReceiptSnapshot extends Base {
  type: "receipt";
  receiptNumber: number;
  patient: { name: string; document: string | null; recordNumber: number };
  amountCents: number; method: string; methodLabel: string; bankReference: string | null;
  receivedAt: string; receivedBy: string; verifiedAt: string | null; budgetNumber: number | null; notes: string | null;
}
export type AnySnapshot = ClinicalSnapshot | BudgetSnapshot | ConsentSnapshot | ReceiptSnapshot;

export const DOC_TITLES: Record<string, string> = {
  prescription: "Receta médica", certificate: "Certificado", referral: "Derivación", budget: "Presupuesto", consent: "Consentimiento", receipt: "Recibo de pago",
};

const REL: Record<string, string> = { self: "El paciente", patient: "El paciente", guardian: "Madre, padre o tutor", legal_representative: "Representante legal" };
const DECISION: Record<string, string> = { granted: "ACEPTA", refused: "NO ACEPTA", revoked: "REVOCA" };
const METHOD: Record<string, string> = { signature_pad: "Firma en pantalla", paper_signed: "Firmado en papel (original en archivo)", staff_registered: "Registrado por el personal", online_checkbox: "Casilla marcada por el paciente en la web" };

function patientFields(w: PdfWriter, p: SnapPatient, zone: string, issuedAt: string) {
  w.fields([
    { label: "Paciente", value: p.name },
    { label: "Documento", value: p.document ?? "No registrado" },
    { label: "Edad", value: p.age != null ? `${p.age} ${p.age === 1 ? "año" : "años"}${p.birthDate ? ` (nac. ${fmtYmd(p.birthDate)})` : ""}` : "No registrada" },
    { label: "Ficha N°", value: String(p.recordNumber) },
  ], 4);
  void zone; void issuedAt;
}

function voidedNotice(w: PdfWriter, s: Base, zone: string, what: string) {
  if (!s.voided) return;
  w.notice(`${what} ANULADO el ${fmtDateTime(s.voided.at, zone)} por ${s.voided.by}. Motivo: ${s.voided.reason}. No tiene validez.`, "danger", true);
}

export async function renderSnapshot(snapshot: AnySnapshot, meta: PdfMeta, extras: { signaturePng?: string | null } = {}): Promise<Buffer> {
  const zone = snapshot.clinic.timezone;
  switch (snapshot.type) {
    case "prescription": return renderPdf(meta, (w) => drawPrescription(w, snapshot, zone));
    case "certificate":
    case "referral": return renderPdf(meta, (w) => drawCertificate(w, snapshot, zone));
    case "budget": return renderPdf(meta, (w) => drawBudget(w, snapshot, zone, extras.signaturePng ?? null));
    case "consent": return renderPdf(meta, (w) => drawConsent(w, snapshot, zone, extras.signaturePng ?? null));
    case "receipt": return renderPdf(meta, (w) => drawReceipt(w, snapshot, zone));
  }
}

function drawPrescription(w: PdfWriter, s: ClinicalSnapshot, zone: string) {
  voidedNotice(w, s, zone, "DOCUMENTO");
  patientFields(w, s.patient, zone, s.issuedAt);
  if (s.allergies) w.notice(`Alergias declaradas por el paciente: ${s.allergies}`, "warn", true);
  w.section("Rp. (prescripción)");
  (s.lines ?? []).forEach((l, i) => {
    w.ensure(54);
    w.text(`${i + 1}. ${l.drug}${l.presentation ? ` — ${l.presentation}` : ""}`, { bold: true, size: 11.5 });
    w.text(`Dosis: ${l.dose}   ·   Frecuencia: ${l.frequency}   ·   Duración: ${l.duration}`, { indent: 14 });
    if (l.instructions) w.text(`Indicaciones: ${l.instructions}`, { indent: 14, color: "#33495a" });
    w.space(6);
  });
  if (s.indications) {
    w.section("Indicaciones generales");
    w.text(s.indications);
  }
  if (s.reissueOf) w.text(`Reemplaza a la receta ${s.reissueOf}, anulada.`, { size: 8.5, color: "#64788a" });
  w.signature(s.issuer.name, `Cirujano(a) dentista · Matrícula: ${s.issuer.license ?? "no registrada"}`);
}

function drawCertificate(w: PdfWriter, s: ClinicalSnapshot, zone: string) {
  voidedNotice(w, s, zone, "DOCUMENTO");
  w.space(6);
  w.title(s.title);
  w.space(4);
  patientFields(w, s.patient, zone, s.issuedAt);
  w.space(6);
  for (const para of String(s.body ?? "").split(/\n{2,}/)) {
    w.text(para.trim(), { size: 11 });
    w.space(8);
  }
  if (s.reissueOf) w.text(`Reemplaza al documento ${s.reissueOf}, anulado.`, { size: 8.5, color: "#64788a" });
  const where = s.branch.city ? `${s.branch.city}, ` : "";
  w.text(`${where}${fmtDateLong(s.issuedAt, zone)}.`, { align: "right" });
  w.signature(s.issuer.name, `Cirujano(a) dentista · Matrícula: ${s.issuer.license ?? "no registrada"}`);
}

function drawBudget(w: PdfWriter, s: BudgetSnapshot, zone: string, png: string | null) {
  voidedNotice(w, s, zone, "PRESUPUESTO");
  patientFields(w, s.patient, zone, s.issuedAt);
  w.fields([
    { label: "Profesional", value: s.dentist },
    { label: "Versión", value: String(s.version) },
    { label: "Válido hasta", value: s.validUntil ? fmtYmd(s.validUntil) : "—" },
    { label: "Forma de pago", value: s.installments > 1 ? `${s.installments} cuotas` : "Pago único" },
  ], 4);
  w.section("Tratamientos");
  w.table(
    [{ header: "Prestación", width: 46 }, { header: "Pieza", width: 10 }, { header: "Cant.", width: 7, align: "right" }, { header: "Precio", width: 13, align: "right" },
      { header: "Descuento", width: 12, align: "right" }, { header: "Neto", width: 13, align: "right" }],
    s.items.map((i) => ({ cells: [i.description, i.tooth ? `${i.tooth}${i.surfaces.length ? ` (${i.surfaces.join("")})` : ""}` : "—", String(i.quantity), fmtBs(i.grossCents), i.discountCents ? `−${fmtBs(i.discountCents)}` : "—", fmtBs(i.netCents)] })),
  );
  w.table([{ header: "Resumen", width: 75 }, { header: "Importe", width: 25, align: "right" }], [
    { cells: ["Subtotal", fmtBs(s.subtotalCents)] },
    ...(s.discountCents ? [{ cells: ["Descuentos", `−${fmtBs(s.discountCents)}`] }] : []),
    { cells: ["TOTAL", fmtBs(s.totalCents)], bold: true },
  ]);
  if (s.installments > 1) {
    w.section("Plan de cuotas");
    w.table([{ header: "Cuota", width: 50 }, { header: "Importe", width: 50, align: "right" }], s.installmentPlan.map((c, k) => ({ cells: [`Cuota ${k + 1} de ${s.installments}`, fmtBs(c)] })));
  }
  if (s.notes) { w.section("Observaciones"); w.text(s.notes); }
  w.section("Aceptación");
  const a = s.acceptance;
  w.text(a.channel === "online"
    ? `Aceptado en línea el ${fmtDateTime(a.at, zone)} por ${a.signerName ?? "—"} (${REL[a.relationship ?? "patient"] ?? a.relationship}), tras verificar su identidad con el enlace personal del presupuesto.`
    : `Aceptado en la clínica el ${fmtDateTime(a.at, zone)}${a.note ? ` (${a.note})` : ""}.`);
  if (a.contentHash) w.text(`Huella SHA-256 de lo aceptado: ${a.contentHash}`, { size: 8, color: "#64788a" });
  if (png || a.channel === "online") w.signature(a.signerName ?? s.patient.name, a.relationship ? REL[a.relationship] ?? null : null, png);
  else w.signature(s.patient.name, "Firma del paciente o responsable");
}

function drawConsent(w: PdfWriter, s: ConsentSnapshot, zone: string, png: string | null) {
  voidedNotice(w, s, zone, "DOCUMENTO");
  w.space(4);
  w.title(`${s.title}${s.templateVersion ? ` (v${s.templateVersion})` : ""}`);
  w.text(s.kindLabel, { align: "center", size: 9, color: "#64788a" });
  w.space(6);
  w.fields([
    { label: "Paciente", value: s.patient.name },
    { label: "Ficha N°", value: String(s.patient.recordNumber) },
    { label: "Fecha y hora de firma", value: fmtDateTime(s.signedAt, zone) },
    { label: "Registró", value: s.recordedBy },
  ], 4);
  w.section("Texto aceptado");
  for (const para of s.body.split(/\n{2,}/)) { w.text(para.trim(), {}); w.space(6); }
  w.section("Decisión y firma");
  w.fields([
    { label: "Decisión", value: DECISION[s.decision] ?? s.decision },
    { label: "Forma", value: METHOD[s.method] ?? s.method },
    { label: "Firmante", value: s.signerName },
    { label: "Firma como", value: REL[s.signerRelationship] ?? s.signerRelationship },
  ], 4);
  if (s.signerDocument) w.text(`Documento de quien firma: ${s.signerDocument}`, { size: 9.5 });
  if (s.notes) w.text(`Nota: ${s.notes}`, { size: 9.5, color: "#33495a" });
  w.signature(s.signerName, REL[s.signerRelationship] ?? null, png);
  w.notice(`Huella SHA-256 del documento firmado (texto, firmante, decisión, fecha y firma): ${s.contentHash}`, "info");
  w.text("Firma electrónica simple registrada en el sistema de la clínica.", { size: 8.5, color: "#64788a" });
}

function drawReceipt(w: PdfWriter, s: ReceiptSnapshot, zone: string) {
  voidedNotice(w, s, zone, "RECIBO");
  w.notice("Este recibo no es una factura fiscal.", "warn", true);
  w.fields([
    { label: "Recibimos de", value: s.patient.name },
    { label: "Documento", value: s.patient.document ?? "No registrado" },
    { label: "Ficha N°", value: String(s.patient.recordNumber) },
    { label: "Fecha del pago", value: fmtDateTime(s.receivedAt, zone) },
  ], 4);
  w.space(4);
  w.text(`La suma de ${fmtBs(s.amountCents)}`, { bold: true, size: 16 });
  w.text(`Son: ${amountInWords(s.amountCents)}`, { size: 10.5, color: "#33495a" });
  w.space(6);
  w.fields([
    { label: "Concepto", value: s.budgetNumber ? `Pago a cuenta del presupuesto N° ${s.budgetNumber}` : "Pago a cuenta de tratamientos odontológicos" },
    { label: "Medio de pago", value: `${s.methodLabel}${s.bankReference ? ` · Ref. ${s.bankReference}` : ""}` },
  ], 2);
  if (s.method !== "cash" && s.verifiedAt) w.text(`Ingreso verificado en el banco el ${fmtDateTime(s.verifiedAt, zone)}.`, { size: 9.5, color: "#33495a" });
  if (s.notes) w.text(`Nota: ${s.notes}`, { size: 9.5, color: "#33495a" });
  w.signature(s.receivedBy, "Recibido por");
}
