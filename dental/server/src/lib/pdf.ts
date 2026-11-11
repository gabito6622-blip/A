// Motor de PDF del servidor (B-064): membrete de la sucursal, formato boliviano,
// numeración de páginas y pie con número de documento, fecha, emisor con matrícula,
// huella SHA-256 corta, código y URL de verificación (con QR).
//
// - Fuente Inter (OFL) INCRUSTADA (subconjunto latino en server/assets/fonts): tildes,
//   ñ, ¿ y ¡ se ven igual en cualquier visor, sin depender de fuentes del sistema.
// - El PDF se genera una sola vez y se guarda (pdf_documents): lo que se descarga
//   después son exactamente los mismos bytes. Igual fijamos CreationDate a la fecha
//   del documento para que el contenido no dependa del reloj.
import PDFDocument from "pdfkit";
import QRCode from "qrcode";
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { DateTime } from "luxon";

const FONT_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "assets", "fonts");
let FONTS: { regular: Buffer; bold: Buffer } | null = null;
function fonts() {
  FONTS ??= { regular: readFileSync(join(FONT_DIR, "Inter-Regular.otf")), bold: readFileSync(join(FONT_DIR, "Inter-SemiBold.otf")) };
  return FONTS;
}

// ---------------- Huellas y códigos ----------------
export const sha256hex = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");

/** JSON canónico (claves ordenadas): la misma instantánea da siempre la misma huella, también tras pasar por jsonb. */
export function stableStringify(v: unknown): string {
  if (v === null || typeof v !== "object") return JSON.stringify(v ?? null);
  if (Array.isArray(v)) return `[${v.map((x) => stableStringify(x === undefined ? null : x)).join(",")}]`;
  const o = v as Record<string, unknown>;
  return `{${Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => `${JSON.stringify(k)}:${stableStringify(o[k])}`).join(",")}}`;
}
export const snapshotHash = (snapshot: unknown) => sha256hex(stableStringify(snapshot));

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** Código de verificación: 12 caracteres base32 de Crockford (60 bits, no adivinable). */
export function newVerifyCode(): string {
  return [...randomBytes(12)].map((b) => CROCKFORD[b & 31]).join("");
}
/** Acepta el código con o sin guiones, en minúsculas y con O/I/L confundidas. */
export function normalizeVerifyCode(input: string): string | null {
  const c = input.toUpperCase().replace(/[\s-]/g, "").replace(/O/g, "0").replace(/[IL]/g, "1");
  return /^[0-9A-HJKMNP-TV-Z]{12}$/.test(c) ? c : null;
}
export const formatVerifyCode = (c: string) => c.match(/.{1,4}/g)!.join("-");
export const shortFingerprint = (hex: string) => hex.slice(0, 16).toUpperCase().match(/.{4}/g)!.join(" ");

// ---------------- Formato boliviano ----------------
export const fmtDateLong = (d: Date | string, zone: string) =>
  DateTime.fromJSDate(new Date(d)).setZone(zone).setLocale("es").toFormat("d 'de' MMMM 'de' yyyy");
export const fmtDateShort = (d: Date | string, zone: string) => DateTime.fromJSDate(new Date(d)).setZone(zone).toFormat("dd/MM/yyyy");
export const fmtDateTime = (d: Date | string, zone: string) => DateTime.fromJSDate(new Date(d)).setZone(zone).toFormat("dd/MM/yyyy HH:mm");
/** AAAA-MM-DD → dd/mm/aaaa sin cambiar de zona. */
export const fmtYmd = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "—");
export const fmtBs = (cents: number) =>
  new Intl.NumberFormat("es-BO", { style: "currency", currency: "BOB", minimumFractionDigits: 2 }).format(cents / 100).replace("BOB", "Bs").replace(/\u00a0/g, " ");

const UNITS = ["", "uno", "dos", "tres", "cuatro", "cinco", "seis", "siete", "ocho", "nueve", "diez", "once", "doce", "trece", "catorce", "quince",
  "dieciséis", "diecisiete", "dieciocho", "diecinueve", "veinte", "veintiuno", "veintidós", "veintitrés", "veinticuatro", "veinticinco",
  "veintiséis", "veintisiete", "veintiocho", "veintinueve"];
const TENS = ["", "", "", "treinta", "cuarenta", "cincuenta", "sesenta", "setenta", "ochenta", "noventa"];
const HUNDREDS = ["", "ciento", "doscientos", "trescientos", "cuatrocientos", "quinientos", "seiscientos", "setecientos", "ochocientos", "novecientos"];
function under1000(n: number): string {
  if (n === 0) return "";
  if (n === 100) return "cien";
  const h = Math.floor(n / 100), r = n % 100;
  const rest = r < 30 ? UNITS[r]! : `${TENS[Math.floor(r / 10)]}${r % 10 ? ` y ${UNITS[r % 10]}` : ""}`;
  return [HUNDREDS[h], rest].filter(Boolean).join(" ");
}
/** Número entero en palabras (español), hasta 999 999 999. */
export function numberToWords(n: number): string {
  if (n === 0) return "cero";
  const millions = Math.floor(n / 1_000_000), thousands = Math.floor((n % 1_000_000) / 1000), rest = n % 1000;
  const parts: string[] = [];
  if (millions) parts.push(millions === 1 ? "un millón" : `${under1000(millions).replace(/veintiuno$/, "veintiún").replace(/uno$/, "un")} millones`);
  if (thousands) parts.push(thousands === 1 ? "mil" : `${under1000(thousands).replace(/veintiuno$/, "veintiún").replace(/uno$/, "un")} mil`);
  if (rest) parts.push(under1000(rest));
  return parts.join(" ");
}
/** "Son: Ciento cincuenta 00/100 bolivianos" (forma usual en recibos de Bolivia). */
export function amountInWords(cents: number): string {
  const w = numberToWords(Math.floor(cents / 100));
  return `${w.charAt(0).toUpperCase()}${w.slice(1)} ${String(cents % 100).padStart(2, "0")}/100 bolivianos`;
}

// ---------------- Documento ----------------
export interface Letterhead {
  clinicName: string;
  legalName?: string | null;
  taxId?: string | null;
  branchName: string;
  address?: string | null;
  city?: string | null;
  phone?: string | null;
  /** Logo de la clínica (PNG o JPG, B-096). Sin logo, el membrete queda como antes. */
  logo?: Buffer | null;
}

export interface PdfMeta {
  /** Tipo de documento en el membrete ("Receta médica"). */
  docTitle: string;
  /** Número visible ("Receta N° R-000012"). */
  docLabel: string;
  issuedAt: Date;
  zone: string;
  letterhead: Letterhead;
  issuer?: { name: string; license: string | null } | null;
  fingerprint: string;
  verifyCode: string;
  verifyUrl: string;
  /** Marca de agua en todas las páginas (p. ej. "ANULADA"). */
  watermark?: string | null;
}

const C = { ink: "#0b2a3c", ink2: "#33495a", muted: "#64788a", line: "#cfd9e2", soft: "#f3f6f8", brand: "#0e8a7e", brandSoft: "#e3f4f1", danger: "#c2410c", dangerSoft: "#fdece4", warnSoft: "#fdf3dc" };
const M = { left: 50, right: 50, top: 128, bottom: 104 };

type Doc = InstanceType<typeof PDFDocument>;
export type Tone = "info" | "warn" | "danger";

/** Ayudas de diagrama sobre pdfkit: textos, campos, tablas, avisos y bloque de firma, con saltos de página. */
export class PdfWriter {
  constructor(public doc: Doc) {}
  get left() { return M.left; }
  get width() { return this.doc.page.width - M.left - M.right; }
  get bottom() { return this.doc.page.height - M.bottom; }

  ensure(h: number) {
    if (this.doc.y + h > this.bottom) { this.doc.addPage(); this.doc.y = M.top; }
  }
  space(h = 8) { this.doc.y += h; }

  title(text: string) {
    this.ensure(30);
    this.doc.font("B").fontSize(15).fillColor(C.ink).text(text, M.left, this.doc.y, { width: this.width, align: "center" });
    this.space(8);
  }
  section(text: string) {
    this.ensure(34);
    this.space(6);
    this.doc.font("B").fontSize(10.5).fillColor(C.brand).text(text.toUpperCase(), M.left, this.doc.y, { width: this.width, characterSpacing: 0.4 });
    const y = this.doc.y + 2;
    this.doc.moveTo(M.left, y).lineTo(M.left + this.width, y).lineWidth(0.6).strokeColor(C.line).stroke();
    this.doc.y = y + 6;
  }
  text(text: string, o: { bold?: boolean; size?: number; color?: string; align?: "left" | "center" | "right" | "justify"; indent?: number } = {}) {
    const size = o.size ?? 10.5;
    this.doc.font(o.bold ? "B" : "R").fontSize(size).fillColor(o.color ?? C.ink);
    const x = M.left + (o.indent ?? 0);
    const w = this.width - (o.indent ?? 0);
    // Los párrafos largos fluyen solos a la página siguiente (el margen superior deja lugar al membrete).
    this.ensure(Math.min(this.doc.heightOfString(text || " ", { width: w }), size * 3));
    this.doc.text(text || " ", x, this.doc.y, { width: w, align: o.align ?? "left", lineGap: 2 });
  }
  /** Etiqueta pequeña y valor, en columnas. */
  fields(items: { label: string; value: string }[], cols = 2) {
    const gap = 14;
    const cw = (this.width - gap * (cols - 1)) / cols;
    for (let i = 0; i < items.length; i += cols) {
      const row = items.slice(i, i + cols);
      this.doc.font("R").fontSize(10.5);
      const h = Math.max(...row.map((f) => this.doc.heightOfString(f.value || "—", { width: cw }))) + 13;
      this.ensure(h + 4);
      const y = this.doc.y;
      row.forEach((f, k) => {
        const x = M.left + k * (cw + gap);
        this.doc.font("R").fontSize(7.8).fillColor(C.muted).text(f.label.toUpperCase(), x, y, { width: cw, lineBreak: false, characterSpacing: 0.3 });
        this.doc.font("R").fontSize(10.5).fillColor(C.ink).text(f.value || "—", x, y + 11, { width: cw });
      });
      this.doc.y = y + h + 4;
    }
  }
  /** Tabla simple con encabezado que se repite al cambiar de página. */
  table(cols: { header: string; width: number; align?: "left" | "right" | "center" }[], rows: { cells: string[]; bold?: boolean; muted?: boolean; strike?: boolean }[]) {
    const total = cols.reduce((s, c) => s + c.width, 0);
    const ws = cols.map((c) => (c.width / total) * this.width);
    const pad = 5;
    const header = () => {
      this.doc.font("B").fontSize(8.5);
      const h = Math.max(...cols.map((c, k) => this.doc.heightOfString(c.header, { width: ws[k]! - pad * 2 }))) + pad * 2;
      this.ensure(h + 20);
      const y = this.doc.y;
      this.doc.rect(M.left, y, this.width, h).fill(C.soft);
      let x = M.left;
      cols.forEach((c, k) => {
        this.doc.font("B").fontSize(8.5).fillColor(C.ink2).text(c.header, x + pad, y + pad, { width: ws[k]! - pad * 2, align: c.align ?? "left" });
        x += ws[k]!;
      });
      this.doc.y = y + h;
    };
    header();
    for (const r of rows) {
      this.doc.font(r.bold ? "B" : "R").fontSize(9.5);
      const h = Math.max(...r.cells.map((t, k) => this.doc.heightOfString(t || " ", { width: ws[k]! - pad * 2 }))) + pad * 2;
      if (this.doc.y + h > this.bottom) { this.doc.addPage(); this.doc.y = M.top; header(); }
      const y = this.doc.y;
      let x = M.left;
      r.cells.forEach((t, k) => {
        this.doc.font(r.bold ? "B" : "R").fontSize(9.5).fillColor(r.muted ? C.muted : C.ink)
          .text(t || " ", x + pad, y + pad, { width: ws[k]! - pad * 2, align: cols[k]!.align ?? "left", strike: !!r.strike });
        x += ws[k]!;
      });
      this.doc.moveTo(M.left, y + h).lineTo(M.left + this.width, y + h).lineWidth(0.5).strokeColor(C.line).stroke();
      this.doc.y = y + h;
    }
    this.space(6);
  }
  /** Recuadro destacado (aviso legal, alergias, anulación). */
  notice(text: string, tone: Tone = "info", bold = false) {
    const bg = tone === "danger" ? C.dangerSoft : tone === "warn" ? C.warnSoft : C.brandSoft;
    const fg = tone === "danger" ? C.danger : tone === "warn" ? "#7a3e06" : C.ink;
    this.doc.font(bold ? "B" : "R").fontSize(10);
    const h = this.doc.heightOfString(text, { width: this.width - 20 }) + 14;
    this.ensure(h + 6);
    const y = this.doc.y;
    this.doc.roundedRect(M.left, y, this.width, h, 4).fill(bg);
    this.doc.font(bold ? "B" : "R").fontSize(10).fillColor(fg).text(text, M.left + 10, y + 7, { width: this.width - 20 });
    this.doc.y = y + h + 6;
  }
  /** Imagen PNG (firma) desde data URL. Devuelve false si no es válida. */
  image(dataUrl: string, w: number, h: number, x?: number): boolean {
    const m = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl);
    if (!m) return false;
    this.ensure(h + 4);
    try {
      this.doc.image(Buffer.from(m[1]!, "base64"), x ?? M.left, this.doc.y, { fit: [w, h] });
    } catch { return false; }
    this.doc.y += h;
    return true;
  }
  /** Bloque de firma a la derecha: imagen opcional, línea, nombre y detalle. */
  signature(name: string, detail: string | null, png?: string | null) {
    const w = 220, x = M.left + this.width - w;
    this.ensure(png ? 120 : 76);
    this.space(png ? 6 : 34);
    if (png) this.image(png, w, 64, x);
    const y = this.doc.y + 2;
    this.doc.moveTo(x, y).lineTo(x + w, y).lineWidth(0.8).strokeColor(C.ink2).stroke();
    this.doc.font("B").fontSize(10).fillColor(C.ink).text(name, x, y + 4, { width: w, align: "center" });
    if (detail) this.doc.font("R").fontSize(8.5).fillColor(C.muted).text(detail, x, this.doc.y + 1, { width: w, align: "center" });
    this.space(6);
  }
}

/** Genera el PDF: el contenido lo dibuja `draw`; membrete, pie, numeración y marca de agua se agregan al final en todas las páginas. */
export async function renderPdf(meta: PdfMeta, draw: (w: PdfWriter) => void | Promise<void>): Promise<Buffer> {
  const f = fonts();
  const doc = new PDFDocument({
    size: "LETTER", margins: M, bufferPages: true, autoFirstPage: true, lang: "es-BO", displayTitle: true,
    info: { Title: `${meta.docTitle} ${meta.docLabel}`, Author: meta.letterhead.clinicName, Subject: meta.docLabel, Creator: "Dentalia", Keywords: `verificacion ${meta.verifyCode}`, CreationDate: meta.issuedAt },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (c: Buffer) => chunks.push(c));
  const done = new Promise<void>((res, rej) => { doc.on("end", () => res()); doc.on("error", rej); });
  doc.registerFont("R", f.regular);
  doc.registerFont("B", f.bold);
  doc.font("R").fillColor(C.ink);
  const w = new PdfWriter(doc);
  doc.y = M.top;
  await draw(w);

  const qr = await QRCode.toBuffer(meta.verifyUrl, { type: "png", margin: 0, width: 168, errorCorrectionLevel: "M" });
  const range = doc.bufferedPageRange();
  const total = range.count;
  for (let i = range.start; i < range.start + total; i++) {
    doc.switchToPage(i);
    // Sin márgenes mientras se dibujan membrete y pie (así no se agregan páginas).
    const saved = { ...doc.page.margins };
    doc.page.margins = { top: 0, bottom: 0, left: 0, right: 0 };
    drawLetterhead(doc, meta);
    drawFooter(doc, meta, qr, i - range.start + 1, total);
    if (meta.watermark) drawWatermark(doc, meta.watermark);
    doc.page.margins = saved;
  }
  doc.end();
  await done;
  return Buffer.concat(chunks);
}

function drawLetterhead(doc: Doc, meta: PdfMeta) {
  const L = meta.letterhead;
  const W = doc.page.width - M.left - M.right;
  const rightW = 190;
  const top = 40;
  // Logo (B-096): a la izquierda del nombre, en un recuadro de 48 px. Si la imagen no se puede leer, se omite.
  let lx = M.left;
  if (L.logo) {
    try {
      doc.image(L.logo, M.left, top - 2, { fit: [48, 48], align: "center", valign: "center" });
      lx = M.left + 58;
    } catch { lx = M.left; }
  }
  const leftW = W - rightW - 16 - (lx - M.left);
  doc.font("B").fontSize(16).fillColor(C.brand).text(L.clinicName, lx, top, { width: leftW, height: 22, ellipsis: true, lineBreak: false });
  const legal = [L.legalName, L.taxId ? `NIT ${L.taxId}` : null].filter(Boolean).join(" · ");
  let y = top + 22;
  if (legal) {
    doc.font("R").fontSize(8.5).fillColor(C.muted).text(legal, lx, y, { width: leftW, height: 12, ellipsis: true, lineBreak: false });
    y += 12;
  }
  doc.font("B").fontSize(9).fillColor(C.ink2).text(`Sucursal ${L.branchName}`, lx, y, { width: leftW, height: 12, ellipsis: true, lineBreak: false });
  y += 12;
  const addr = [[L.address, L.city].filter(Boolean).join(", "), L.phone ? `Tel. ${L.phone}` : null].filter(Boolean).join(" · ");
  if (addr) doc.font("R").fontSize(8.5).fillColor(C.muted).text(addr, lx, y, { width: leftW, height: 24, ellipsis: true });

  const rx = M.left + W - rightW;
  doc.font("B").fontSize(11).fillColor(C.ink).text(meta.docTitle.toUpperCase(), rx, top + 2, { width: rightW, align: "right", height: 30, ellipsis: true, characterSpacing: 0.4 });
  doc.font("R").fontSize(9.5).fillColor(C.ink2).text(meta.docLabel, rx, doc.y + 1, { width: rightW, align: "right", lineBreak: false });
  const where = L.city ? `${L.city}, ` : "";
  doc.font("R").fontSize(9).fillColor(C.muted).text(`${where}${fmtDateLong(meta.issuedAt, meta.zone)}`, rx, doc.y + 2, { width: rightW, align: "right", height: 24, ellipsis: true });

  const ry = M.top - 14;
  doc.moveTo(M.left, ry).lineTo(M.left + W, ry).lineWidth(1.4).strokeColor(C.brand).stroke();
}

function drawFooter(doc: Doc, meta: PdfMeta, qr: Buffer, page: number, total: number) {
  const W = doc.page.width - M.left - M.right;
  const y0 = doc.page.height - M.bottom + 16;
  doc.moveTo(M.left, y0).lineTo(M.left + W, y0).lineWidth(0.6).strokeColor(C.line).stroke();
  const qrSize = 54;
  const tw = W - qrSize - 12;
  const issuer = meta.issuer ? ` · ${meta.issuer.name} — Matrícula: ${meta.issuer.license ?? "no registrada"}` : "";
  const lines = [
    `${meta.docLabel} · Emitido el ${fmtDateTime(meta.issuedAt, meta.zone)}${issuer}`,
    `Huella SHA-256: ${shortFingerprint(meta.fingerprint)} · Código de verificación: ${formatVerifyCode(meta.verifyCode)}`,
    `Verifique la autenticidad en ${meta.verifyUrl}`,
  ];
  let y = y0 + 7;
  lines.forEach((t, k) => {
    doc.font(k === 1 ? "B" : "R").fontSize(7.6).fillColor(k === 1 ? C.ink2 : C.muted).text(t, M.left, y, { width: tw, height: 20, ellipsis: true });
    y = doc.y + 1.5;
  });
  doc.font("R").fontSize(7.6).fillColor(C.muted).text(`Página ${page} de ${total}`, M.left, y + 2, { width: tw, lineBreak: false });
  doc.image(qr, M.left + W - qrSize, y0 + 7, { width: qrSize, height: qrSize });
}

function drawWatermark(doc: Doc, text: string) {
  const cx = doc.page.width / 2, cy = doc.page.height / 2;
  doc.save();
  doc.rotate(-35, { origin: [cx, cy] });
  doc.font("B").fontSize(96).fillColor(C.danger).fillOpacity(0.13).text(text, cx - 300, cy - 55, { width: 600, align: "center", lineBreak: false });
  doc.restore();
  doc.fillOpacity(1);
}
