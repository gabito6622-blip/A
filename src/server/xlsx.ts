// Excel (.xlsx) y CSV sin dependencias externas.
//
// - writeXlsx: arma un libro con una o más hojas. Los textos van como "inlineStr", así que un
//   valor que empieza con "=" se ve como texto y NUNCA se ejecuta como fórmula.
// - readSheet: lee la primera hoja de un .xlsx, o un .csv separado por ";" o ",".
//   Tiene límites de tamaño para que un archivo armado a propósito no llene la memoria.
import { inflateRawSync, deflateRawSync } from "node:zlib";

export type Cell = string | number | null | undefined;
export interface Sheet {
  name: string;
  rows: Cell[][];
  /** Ancho de cada columna (en caracteres). */
  widths?: number[];
}

/* ---------------- ZIP mínimo ---------------- */

const CRC_TABLE = new Int32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf: Buffer): number {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}

/** ZIP comprimido (deflate): para mandar respaldos que pesen poco. */
export function zipDeflate(files: { name: string; data: Buffer }[]): Buffer {
  return zipStore(files, true);
}

/** ZIP sin compresión (método "store"): Excel lo abre sin problemas. */
export function zipStore(files: { name: string; data: Buffer }[], deflate = false): Buffer {
  const locals: Buffer[] = [];
  const centrals: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const name = Buffer.from(f.name, "utf8");
    const crc = crc32(f.data);
    const body = deflate ? deflateRawSync(f.data, { level: 9 }) : f.data;
    const method = deflate ? 8 : 0;
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(method, 8);
    lh.writeUInt32LE(0, 10); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(body.length, 18); lh.writeUInt32LE(f.data.length, 22);
    lh.writeUInt16LE(name.length, 26); lh.writeUInt16LE(0, 28);
    locals.push(lh, name, body);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(method, 10);
    ch.writeUInt32LE(0, 12); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(body.length, 20); ch.writeUInt32LE(f.data.length, 24);
    ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    centrals.push(ch, name);
    offset += 30 + name.length + body.length;
  }
  const cd = Buffer.concat(centrals);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

const MAX_UNZIPPED = 20 * 1024 * 1024;

/** Lee las entradas de un ZIP (store o deflate). Lanza si está dañado o es demasiado grande. */
function unzip(buf: Buffer): Map<string, Buffer> {
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("El archivo no es un Excel válido");
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  const out = new Map<string, Buffer>();
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error("El archivo Excel está dañado");
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), elen = buf.readUInt16LE(p + 30), clen = buf.readUInt16LE(p + 32);
    const lho = buf.readUInt32LE(p + 42);
    const name = buf.subarray(p + 46, p + 46 + nlen).toString("utf8");
    p += 46 + nlen + elen + clen;
    if (!/^(xl\/(workbook\.xml|sharedStrings\.xml|worksheets\/sheet\d+\.xml|_rels\/workbook\.xml\.rels))$/.test(name)) continue;
    total += usize;
    if (usize > MAX_UNZIPPED || total > MAX_UNZIPPED) throw new Error("El archivo Excel es demasiado grande");
    const start = lho + 30 + buf.readUInt16LE(lho + 26) + buf.readUInt16LE(lho + 28);
    const raw = buf.subarray(start, start + csize);
    const data = method === 0 ? raw : method === 8 ? inflateRawSync(raw, { maxOutputLength: MAX_UNZIPPED }) : null;
    if (!data) throw new Error("Formato de compresión no soportado");
    out.set(name, data);
  }
  return out;
}

/* ---------------- escribir ---------------- */

const xmlEsc = (s: string) =>
  s.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").replace(/[<>&"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;" })[c]!);

function colName(i: number): string {
  let s = "";
  for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s;
  return s;
}

function sheetXml(sh: Sheet): string {
  const cols = sh.widths?.length
    ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>`
    : "";
  const rows = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((v, ci) => {
    const ref = `${colName(ci)}${ri + 1}`;
    if (v === null || v === undefined || v === "") return "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
  }).join("")}</row>`).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

export function writeXlsx(sheets: Sheet[]): Buffer {
  const names = sheets.map((s, i) => xmlEsc(s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Hoja${i + 1}`));
  const files = [
    { name: "[Content_Types].xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>` },
    { name: "_rels/.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>` },
    { name: "xl/workbook.xml", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${n}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}</Relationships>` },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(s) })),
  ];
  return zipStore(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, "utf8") })));
}

/* ---------------- leer ---------------- */

const xmlUnesc = (s: string) =>
  s.replace(/&(lt|gt|amp|quot|apos|#\d+|#x[0-9a-f]+);/gi, (_, e: string) =>
    e === "lt" ? "<" : e === "gt" ? ">" : e === "amp" ? "&" : e === "quot" ? '"' : e === "apos" ? "'"
      : String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)));

const textOf = (xml: string) => [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)].map((m) => xmlUnesc(m[1])).join("");

function colIndex(ref: string): number {
  const letters = ref.match(/^[A-Z]+/)?.[0] ?? "A";
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const MAX_ROWS = 5000;

function readXlsx(buf: Buffer): string[][] {
  const files = unzip(buf);
  // Primera hoja según el libro (si no se puede resolver, sheet1.xml).
  let sheetPath = "xl/worksheets/sheet1.xml";
  const wb = files.get("xl/workbook.xml")?.toString("utf8");
  const rels = files.get("xl/_rels/workbook.xml.rels")?.toString("utf8");
  const rid = wb?.match(/<sheet\b[^>]*\br:id="([^"]+)"/)?.[1];
  const target = rid
    ? rels?.match(new RegExp(`<Relationship\\b[^>]*Id="${rid}"[^>]*Target="([^"]+)"`))?.[1]
      ?? rels?.match(new RegExp(`<Relationship\\b[^>]*Target="([^"]+)"[^>]*Id="${rid}"`))?.[1]
    : undefined;
  if (target) sheetPath = "xl/" + target.replace(/^\/?xl\//, "").replace(/^\//, "");
  const sheet = files.get(sheetPath)?.toString("utf8");
  if (!sheet) throw new Error("No encontré la hoja dentro del Excel");
  const shared = [...(files.get("xl/sharedStrings.xml")?.toString("utf8") ?? "").matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => textOf(m[1]));
  const rows: string[][] = [];
  for (const rm of sheet.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>|<row\b[^>]*\/>/g)) {
    if (rows.length >= MAX_ROWS) throw new Error(`Máximo ${MAX_ROWS} filas por archivo`);
    const row: string[] = [];
    let next = 0;
    for (const cm of (rm[1] ?? "").matchAll(/<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const attrs = cm[1];
      const ref = attrs.match(/\br="([A-Z]+\d+)"/)?.[1];
      const idx = ref ? colIndex(ref) : next;
      const type = attrs.match(/\bt="([^"]+)"/)?.[1];
      const inner = cm[2] ?? "";
      const v = inner.match(/<v>([\s\S]*?)<\/v>/)?.[1];
      let val = "";
      if (type === "s") val = shared[Number(v)] ?? "";
      else if (type === "inlineStr") val = textOf(inner);
      else if (type === "b") val = v === "1" ? "VERDADERO" : "FALSO";
      else if (v !== undefined) {
        val = xmlUnesc(v);
        // Números grandes (teléfonos) a veces vienen en notación científica.
        if (/^-?\d+(\.\d+)?E\+?\d+$/i.test(val)) val = Number(val).toFixed(0);
      }
      row[idx] = val.trim();
      next = idx + 1;
    }
    rows.push(Array.from(row, (x) => x ?? ""));
  }
  return rows;
}

function readCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "").replace(/^sep=.\r?\n/i, "");
  const first = t.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const rows: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i];
    if (q) {
      if (ch === '"' && t[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') q = false;
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === sep) { row.push(cell.trim()); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(cell.trim()); rows.push(row); row = []; cell = "";
      if (rows.length > MAX_ROWS) throw new Error(`Máximo ${MAX_ROWS} filas por archivo`);
    } else cell += ch;
  }
  if (cell || row.length) { row.push(cell.trim()); rows.push(row); }
  return rows;
}

/** Lee un .xlsx o un .csv y devuelve las filas como texto (sin filas totalmente vacías). */
export function readSheet(buf: Buffer): string[][] {
  const isZip = buf.length > 4 && buf.readUInt32LE(0) === 0x04034b50;
  const rows = isZip ? readXlsx(buf) : readCsv(buf.toString("utf8"));
  return rows.filter((r) => r.some((c) => c !== ""));
}

/** Normaliza un encabezado: minúsculas, sin acentos ni signos ("Teléfono / WhatsApp" → "telefono whatsapp"). */
export const normHeader = (h: string) =>
  h.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

/* ---------------- escritor empresarial: estilos, fórmulas, hipervínculos y gráficos ---------------- */
//
// writeXlsxPro arma un .xlsx "de verdad": estilos en xl/styles.xml, fórmulas (sin valor cacheado:
// Excel y LibreOffice recalculan al abrir gracias a <calcPr fullCalcOnLoad="1"/>), celdas combinadas,
// paneles inmovilizados, autofiltro, hipervínculos y gráficos nativos (DrawingML).
// Igual que writeXlsx, los textos van como inlineStr: un texto que empieza con "=" nunca es fórmula.
// Las fechas se escriben como serie de Excel tomando la hora UTC de la fecha.

export interface CellStyle {
  bold?: boolean;
  italic?: boolean;
  /** Tamaño de letra en puntos (por defecto 11). */
  size?: number;
  /** Color de la letra, "#rrggbb". */
  color?: string;
  /** Color de fondo, "#rrggbb". */
  fill?: string;
  /** Formato numérico, p. ej. '"Bs" #,##0.00', '0%', 'dd/mm/yyyy'. */
  numFmt?: string;
  align?: "left" | "center" | "right";
  valign?: "top" | "middle" | "bottom";
  wrap?: boolean;
  /** Borde fino en los cuatro lados (gris si no se da borderColor). */
  border?: boolean;
  borderColor?: string;
}
export type ProValue = string | number | boolean | Date | null | undefined;
export interface ProCell {
  v?: ProValue;
  /** Fórmula sin el "=" inicial, p. ej. "SUM(C5:C20)". */
  f?: string;
  s?: CellStyle;
  /** Hipervínculo (se abre al hacer clic en la celda). */
  link?: string;
}
export type ProRow = (ProValue | ProCell)[];
export interface ProChart {
  type: "bar" | "column" | "line" | "pie";
  title?: string;
  /** Hoja donde están los datos; por defecto la misma hoja del gráfico. */
  sheet?: string;
  /** Rango A1 de las categorías, p. ej. "A5:A10". */
  categories: string;
  series: { name: string; values: string; color?: string }[];
  /** Celda superior izquierda (0-based) y tamaño en celdas; por defecto 8×16. */
  anchor: { col: number; row: number; cols?: number; rows?: number };
  /** Mostrar leyenda (por defecto sí). */
  legend?: boolean;
}
export interface ProSheet {
  name: string;
  rows: ProRow[];
  widths?: number[];
  /** Fila (0-based) → alto en puntos. */
  heights?: Record<number, number>;
  /** Rangos combinados, p. ej. "A1:F1". */
  merges?: string[];
  freeze?: { rows?: number; cols?: number };
  /** Rango con autofiltro, p. ej. "A4:H40". */
  autoFilter?: string;
  tabColor?: string;
  charts?: ProChart[];
  /** Mostrar la cuadrícula (por defecto sí). */
  gridLines?: boolean;
}
export interface Workbook {
  sheets: ProSheet[];
  creator?: string;
  title?: string;
}

const XML_HEAD = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`;
const NS_MAIN = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const NS_R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const NS_PKG_REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const NS_A = "http://schemas.openxmlformats.org/drawingml/2006/main";
const NS_C = "http://schemas.openxmlformats.org/drawingml/2006/chart";
const NS_XDR = "http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing";
const relType = (t: string) => `http://schemas.openxmlformats.org/officeDocument/2006/relationships/${t}`;
const ctOffice = (t: string) => `application/vnd.openxmlformats-officedocument.${t}+xml`;
const relsXml = (rels: { id: string; type: string; target: string; external?: boolean }[]) =>
  `${XML_HEAD}<Relationships xmlns="${NS_PKG_REL}">${rels.map((r) =>
    `<Relationship Id="${r.id}" Type="${r.type}" Target="${xmlEsc(r.target)}"${r.external ? ' TargetMode="External"' : ""}/>`).join("")}</Relationships>`;

/** "#1f6feb" → "FF1F6FEB" (ARGB que usa Excel); null si el color no es válido. */
function argb(c: string | undefined): string | null {
  const m = c?.trim().match(/^#?([0-9a-f]{6})$/i);
  return m ? "FF" + m[1].toUpperCase() : null;
}
const rgb6 = (c: string | undefined) => argb(c)?.slice(2) ?? null;

const RANGE_RE = /^\$?([A-Z]{1,3})\$?(\d+)(?::\$?([A-Z]{1,3})\$?(\d+))?$/;
/** Devuelve el rango absoluto ("$A$5:$A$10") o lanza un error claro. */
function absRange(r: string, where: string): string {
  const m = String(r ?? "").trim().toUpperCase().match(RANGE_RE);
  if (!m) throw new Error(`Rango inválido en ${where}: "${r}" (esperaba algo como "A5:A10")`);
  return `$${m[1]}$${m[2]}` + (m[3] ? `:$${m[3]}$${m[4]}` : "");
}
const plainRange = (r: string, where: string) => absRange(r, where).replace(/\$/g, "");
const quoteSheet = (name: string) => `'${name.replace(/'/g, "''")}'`;

/** Días desde el 30/12/1899 (serie de fechas de Excel), en UTC. */
const excelSerial = (d: Date) => (d.getTime() - Date.UTC(1899, 11, 30)) / 86_400_000;

/** Formatos que Excel ya trae; el resto se registra con id ≥ 164. */
const BUILTIN_FMT: Record<string, number> = { General: 0, "0": 1, "0.00": 2, "#,##0": 3, "#,##0.00": 4, "0%": 9, "0.00%": 10, "@": 49 };

/** Registro de estilos: deduplica fuentes, fondos, bordes, formatos y combinaciones (cellXfs). */
class StyleBook {
  private readonly fonts: string[] = [];
  private readonly fills: string[] = [];
  private readonly borders: string[] = [];
  private readonly xfs: string[] = [];
  private readonly fmts = new Map<string, number>();
  private readonly index = new Map<string, number>();

  constructor() {
    this.intern(this.fonts, `<font><sz val="11"/><color theme="1"/><name val="Calibri"/><family val="2"/></font>`);
    this.intern(this.fills, `<fill><patternFill patternType="none"/></fill>`);
    this.intern(this.fills, `<fill><patternFill patternType="gray125"/></fill>`);
    this.intern(this.borders, `<border><left/><right/><top/><bottom/><diagonal/></border>`);
    this.intern(this.xfs, `<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>`);
  }

  private intern(list: string[], xml: string): number {
    const key = list === this.fonts ? "f" : list === this.fills ? "l" : list === this.borders ? "b" : "x";
    let id = this.index.get(key + xml);
    if (id === undefined) { id = list.length; list.push(xml); this.index.set(key + xml, id); }
    return id;
  }

  private numFmt(code: string): number {
    const builtin = BUILTIN_FMT[code];
    if (builtin !== undefined) return builtin;
    let id = this.fmts.get(code);
    if (id === undefined) { id = 164 + this.fmts.size; this.fmts.set(code, id); }
    return id;
  }

  /** Devuelve el índice de estilo (s="…") para una celda; 0 es el estilo por defecto. */
  xf(s: CellStyle | undefined, extra: { date?: boolean; link?: boolean } = {}): number {
    if (!s && !extra.date && !extra.link) return 0;
    const st = s ?? {};
    const size = Number.isFinite(st.size) && (st.size as number) > 0 ? st.size : 11;
    const color = argb(st.color) ?? (extra.link ? "FF0563C1" : null);
    const fontId = this.intern(this.fonts,
      `<font>${st.bold ? "<b/>" : ""}${st.italic ? "<i/>" : ""}${extra.link ? "<u/>" : ""}<sz val="${size}"/>${color ? `<color rgb="${color}"/>` : `<color theme="1"/>`}<name val="Calibri"/><family val="2"/></font>`);
    const fill = argb(st.fill);
    const fillId = fill ? this.intern(this.fills, `<fill><patternFill patternType="solid"><fgColor rgb="${fill}"/><bgColor indexed="64"/></patternFill></fill>`) : 0;
    let borderId = 0;
    if (st.border) {
      const bc = argb(st.borderColor) ?? "FFBFBFBF";
      const side = (n: string) => `<${n} style="thin"><color rgb="${bc}"/></${n}>`;
      borderId = this.intern(this.borders, `<border>${side("left")}${side("right")}${side("top")}${side("bottom")}<diagonal/></border>`);
    }
    const code = st.numFmt ?? (extra.date ? "dd/mm/yyyy" : undefined);
    const numFmtId = code ? this.numFmt(code) : 0;
    const valign = st.valign === "middle" ? "center" : st.valign;
    const alignment = st.align || valign || st.wrap
      ? `<alignment${st.align ? ` horizontal="${st.align}"` : ""}${valign ? ` vertical="${valign}"` : ""}${st.wrap ? ' wrapText="1"' : ""}/>`
      : "";
    const attrs = `numFmtId="${numFmtId}" fontId="${fontId}" fillId="${fillId}" borderId="${borderId}" xfId="0"`
      + `${numFmtId ? ' applyNumberFormat="1"' : ""}${fontId ? ' applyFont="1"' : ""}${fillId ? ' applyFill="1"' : ""}${borderId ? ' applyBorder="1"' : ""}`;
    return this.intern(this.xfs, alignment ? `<xf ${attrs} applyAlignment="1">${alignment}</xf>` : `<xf ${attrs}/>`);
  }

  toXml(): string {
    const numFmts = this.fmts.size
      ? `<numFmts count="${this.fmts.size}">${[...this.fmts].map(([code, id]) => `<numFmt numFmtId="${id}" formatCode="${xmlEsc(code)}"/>`).join("")}</numFmts>`
      : "";
    const list = (tag: string, items: string[]) => `<${tag} count="${items.length}">${items.join("")}</${tag}>`;
    return `${XML_HEAD}<styleSheet xmlns="${NS_MAIN}">${numFmts}${list("fonts", this.fonts)}${list("fills", this.fills)}${list("borders", this.borders)}`
      + `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>${list("cellXfs", this.xfs)}`
      + `<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles><dxfs count="0"/>`
      + `<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/></styleSheet>`;
  }
}

const isProCell = (x: ProValue | ProCell): x is ProCell => typeof x === "object" && x !== null && !(x instanceof Date);

/** XML de una celda; "" si no hay nada que escribir. */
function proCellXml(ref: string, cell: ProCell, styles: StyleBook): string {
  const v = cell.v;
  const sid = styles.xf(cell.s, { date: v instanceof Date, link: !!cell.link });
  const s = sid ? ` s="${sid}"` : "";
  if (cell.f) return `<c r="${ref}"${s}><f>${xmlEsc(cell.f.replace(/^=/, ""))}</f></c>`;
  const empty = s ? `<c r="${ref}"${s}/>` : "";
  if (v === null || v === undefined || v === "") return empty;
  if (typeof v === "number") return Number.isFinite(v) ? `<c r="${ref}"${s}><v>${v}</v></c>` : empty;
  if (typeof v === "boolean") return `<c r="${ref}"${s} t="b"><v>${v ? 1 : 0}</v></c>`;
  if (v instanceof Date) {
    const serial = excelSerial(v);
    return Number.isFinite(serial) ? `<c r="${ref}"${s}><v>${serial}</v></c>` : empty;
  }
  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(String(v))}</t></is></c>`;
}

function paneXml(f: ProSheet["freeze"]): string {
  const rows = Math.max(0, Math.floor(f?.rows ?? 0)), cols = Math.max(0, Math.floor(f?.cols ?? 0));
  if (!rows && !cols) return "";
  const topLeft = `${colName(cols)}${rows + 1}`;
  const active = rows && cols ? "bottomRight" : rows ? "bottomLeft" : "topRight";
  return `<pane${cols ? ` xSplit="${cols}"` : ""}${rows ? ` ySplit="${rows}"` : ""} topLeftCell="${topLeft}" activePane="${active}" state="frozen"/>`
    + `<selection pane="${active}" activeCell="${topLeft}" sqref="${topLeft}"/>`;
}

/** Título con texto enriquecido para un gráfico. */
const chartTitleXml = (title: string) =>
  `<c:title><c:tx><c:rich><a:bodyPr/><a:lstStyle/><a:p><a:pPr><a:defRPr b="1"/></a:pPr><a:r><a:rPr lang="es-ES" b="1"/><a:t>${xmlEsc(title)}</a:t></a:r></a:p></c:rich></c:tx><c:overlay val="0"/></c:title>`;

/** Parte xl/charts/chartN.xml (DrawingML) con categorías y valores por referencia a la hoja de datos. */
function chartXml(ch: ProChart, dataSheet: string): string {
  const sheetRef = quoteSheet(dataSheet);
  const cat = `<c:cat><c:strRef><c:f>${xmlEsc(`${sheetRef}!${absRange(ch.categories, `categorías del gráfico "${ch.title ?? ch.type}"`)}`)}</c:f></c:strRef></c:cat>`;
  const solid = (c: string | null) => c ? `<a:solidFill><a:srgbClr val="${c}"/></a:solidFill>` : "";
  const series = (ch.series ?? []).map((s, i) => {
    const color = rgb6(s.color);
    const val = `<c:val><c:numRef><c:f>${xmlEsc(`${sheetRef}!${absRange(s.values, `la serie "${s.name}"`)}`)}</c:f></c:numRef></c:val>`;
    let body = "", tail = "";
    if (ch.type === "line") {
      body = `${color ? `<c:spPr><a:ln w="28575" cap="rnd">${solid(color)}<a:round/></a:ln></c:spPr>` : ""}<c:marker><c:symbol val="circle"/><c:size val="5"/></c:marker>`;
      tail = `<c:smooth val="0"/>`;
    } else if (ch.type === "pie") {
      body = "";
    } else {
      body = `${color ? `<c:spPr>${solid(color)}</c:spPr>` : ""}<c:invertIfNegative val="0"/>`;
    }
    return `<c:ser><c:idx val="${i}"/><c:order val="${i}"/><c:tx><c:v>${xmlEsc(s.name)}</c:v></c:tx>${body}${cat}${val}${tail}</c:ser>`;
  }).join("");
  if (!series) throw new Error(`El gráfico "${ch.title ?? ch.type}" no tiene series`);

  const horizontal = ch.type === "bar";
  const axes = ch.type === "pie" ? "" :
    `<c:catAx><c:axId val="101"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "l" : "b"}"/>`
    + `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`
    + `<c:crossAx val="102"/><c:crosses val="autoZero"/><c:auto val="1"/><c:lblAlgn val="ctr"/><c:lblOffset val="100"/><c:noMultiLvlLbl val="0"/></c:catAx>`
    + `<c:valAx><c:axId val="102"/><c:scaling><c:orientation val="minMax"/></c:scaling><c:delete val="0"/><c:axPos val="${horizontal ? "b" : "l"}"/><c:majorGridlines/>`
    + `<c:numFmt formatCode="General" sourceLinked="1"/><c:majorTickMark val="out"/><c:minorTickMark val="none"/><c:tickLblPos val="nextTo"/>`
    + `<c:crossAx val="101"/><c:crosses val="autoZero"/><c:crossBetween val="between"/></c:valAx>`;
  const plot = ch.type === "pie"
    ? `<c:pieChart><c:varyColors val="1"/>${series}<c:firstSliceAng val="0"/></c:pieChart>`
    : ch.type === "line"
      ? `<c:lineChart><c:grouping val="standard"/><c:varyColors val="0"/>${series}<c:marker val="1"/><c:axId val="101"/><c:axId val="102"/></c:lineChart>`
      : `<c:barChart><c:barDir val="${horizontal ? "bar" : "col"}"/><c:grouping val="clustered"/><c:varyColors val="0"/>${series}<c:gapWidth val="150"/><c:axId val="101"/><c:axId val="102"/></c:barChart>`;
  const legend = ch.legend === false ? "" : `<c:legend><c:legendPos val="${ch.type === "pie" ? "r" : "b"}"/><c:overlay val="0"/></c:legend>`;
  return `${XML_HEAD}<c:chartSpace xmlns:c="${NS_C}" xmlns:a="${NS_A}" xmlns:r="${NS_R}"><c:lang val="es-ES"/><c:roundedCorners val="0"/><c:chart>`
    + `${ch.title ? chartTitleXml(ch.title) : ""}<c:autoTitleDeleted val="${ch.title ? 0 : 1}"/><c:plotArea><c:layout/>${plot}${axes}</c:plotArea>`
    + `${legend}<c:plotVisOnly val="1"/><c:dispBlanksAs val="gap"/></c:chart></c:chartSpace>`;
}

/** Parte xl/drawings/drawingN.xml: un twoCellAnchor por gráfico, cada uno apuntando a su chart por r:id. */
function drawingXml(charts: ProChart[]): string {
  const anchors = charts.map((ch, i) => {
    const col = Math.max(0, Math.floor(ch.anchor?.col ?? 0)), row = Math.max(0, Math.floor(ch.anchor?.row ?? 0));
    const cols = Math.max(1, Math.floor(ch.anchor?.cols ?? 8)), rows = Math.max(1, Math.floor(ch.anchor?.rows ?? 16));
    const pos = (c: number, r: number) => `<xdr:col>${c}</xdr:col><xdr:colOff>0</xdr:colOff><xdr:row>${r}</xdr:row><xdr:rowOff>0</xdr:rowOff>`;
    return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${pos(col, row)}</xdr:from><xdr:to>${pos(col + cols, row + rows)}</xdr:to>`
      + `<xdr:graphicFrame macro=""><xdr:nvGraphicFramePr><xdr:cNvPr id="${i + 2}" name="Gráfico ${i + 1}"/><xdr:cNvGraphicFramePr/></xdr:nvGraphicFramePr>`
      + `<xdr:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/></xdr:xfrm><a:graphic><a:graphicData uri="${NS_C}"><c:chart xmlns:c="${NS_C}" xmlns:r="${NS_R}" r:id="rId${i + 1}"/></a:graphicData></a:graphic>`
      + `</xdr:graphicFrame><xdr:clientData/></xdr:twoCellAnchor>`;
  }).join("");
  return `${XML_HEAD}<xdr:wsDr xmlns:xdr="${NS_XDR}" xmlns:a="${NS_A}">${anchors}</xdr:wsDr>`;
}

/** Nombres de hoja válidos para Excel: sin \ / ? * [ ] :, hasta 31 caracteres y sin repetidos. */
function proSheetNames(sheets: ProSheet[]): string[] {
  const used = new Set<string>();
  return sheets.map((s, i) => {
    const base = String(s.name ?? "").replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || `Hoja${i + 1}`;
    let name = base;
    for (let n = 2; used.has(name.toLowerCase()); n++) name = `${base.slice(0, 31 - ` (${n})`.length)} (${n})`;
    used.add(name.toLowerCase());
    return name;
  });
}

export function writeXlsxPro(book: Workbook): Buffer {
  if (!book.sheets?.length) throw new Error("El libro necesita al menos una hoja");
  const names = proSheetNames(book.sheets);
  const styles = new StyleBook();
  const files: { name: string; data: string }[] = [];
  const contentTypes: string[] = [];
  const definedNames: string[] = [];
  let chartCount = 0, drawingCount = 0;

  book.sheets.forEach((sh, si) => {
    const name = names[si];
    const sheetRels: { id: string; type: string; target: string; external?: boolean }[] = [];
    const hyperlinks: string[] = [];
    let maxCol = 0;

    // Filas y celdas.
    const rowsXml = sh.rows.map((row, ri) => {
      const cells = row.map((raw, ci) => {
        const cell = isProCell(raw) ? raw : { v: raw };
        const ref = `${colName(ci)}${ri + 1}`;
        if (cell.link) {
          const id = `rId${sheetRels.length + 1}`;
          sheetRels.push({ id, type: relType("hyperlink"), target: cell.link, external: true });
          hyperlinks.push(`<hyperlink ref="${ref}" r:id="${id}"/>`);
        }
        const xml = proCellXml(ref, cell, styles);
        if (xml) maxCol = Math.max(maxCol, ci + 1);
        return xml;
      }).join("");
      const h = sh.heights?.[ri];
      const ht = Number.isFinite(h) && (h as number) > 0 ? ` ht="${h}" customHeight="1"` : "";
      return cells || ht ? `<row r="${ri + 1}"${ht}>${cells}</row>` : "";
    }).join("");

    // Gráficos: un drawing por hoja, un chart por gráfico.
    let drawing = "";
    if (sh.charts?.length) {
      const dn = ++drawingCount;
      const drawingRels = sh.charts.map((ch, i) => {
        const cn = ++chartCount;
        const dataSheet = ch.sheet ? names[book.sheets.findIndex((x) => x.name === ch.sheet)] ?? ch.sheet : name;
        files.push({ name: `xl/charts/chart${cn}.xml`, data: chartXml(ch, dataSheet) });
        contentTypes.push(`<Override PartName="/xl/charts/chart${cn}.xml" ContentType="${ctOffice("drawingml.chart")}"/>`);
        return { id: `rId${i + 1}`, type: relType("chart"), target: `../charts/chart${cn}.xml` };
      });
      files.push({ name: `xl/drawings/drawing${dn}.xml`, data: drawingXml(sh.charts) });
      files.push({ name: `xl/drawings/_rels/drawing${dn}.xml.rels`, data: relsXml(drawingRels) });
      contentTypes.push(`<Override PartName="/xl/drawings/drawing${dn}.xml" ContentType="${ctOffice("drawing")}"/>`);
      const id = `rId${sheetRels.length + 1}`;
      sheetRels.push({ id, type: relType("drawing"), target: `../drawings/drawing${dn}.xml` });
      drawing = `<drawing r:id="${id}"/>`;
    }

    const tab = argb(sh.tabColor);
    const sheetPr = tab ? `<sheetPr><tabColor rgb="${tab}"/></sheetPr>` : "";
    const dimension = `<dimension ref="A1${sh.rows.length && maxCol ? `:${colName(maxCol - 1)}${sh.rows.length}` : ""}"/>`;
    const view = `<sheetViews><sheetView workbookViewId="0"${si === 0 ? ' tabSelected="1"' : ""}${sh.gridLines === false ? ' showGridLines="0"' : ""}>${paneXml(sh.freeze)}</sheetView></sheetViews>`;
    const cols = sh.widths?.length
      ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${Number.isFinite(w) && w > 0 ? w : 10}" customWidth="1"/>`).join("")}</cols>`
      : "";
    let autoFilter = "";
    if (sh.autoFilter) {
      autoFilter = `<autoFilter ref="${plainRange(sh.autoFilter, `el autofiltro de "${name}"`)}"/>`;
      definedNames.push(`<definedName name="_xlnm._FilterDatabase" localSheetId="${si}" hidden="1">${xmlEsc(`${quoteSheet(name)}!${absRange(sh.autoFilter, "autoFilter")}`)}</definedName>`);
    }
    const merges = sh.merges?.length
      ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${plainRange(m, `las celdas combinadas de "${name}"`)}"/>`).join("")}</mergeCells>`
      : "";
    const links = hyperlinks.length ? `<hyperlinks>${hyperlinks.join("")}</hyperlinks>` : "";
    // El orden de los elementos lo fija el esquema: sheetPr, dimension, sheetViews, cols, sheetData, autoFilter, mergeCells, hyperlinks, pageMargins, drawing.
    files.push({
      name: `xl/worksheets/sheet${si + 1}.xml`,
      data: `${XML_HEAD}<worksheet xmlns="${NS_MAIN}" xmlns:r="${NS_R}">${sheetPr}${dimension}${view}<sheetFormatPr defaultRowHeight="15"/>${cols}<sheetData>${rowsXml}</sheetData>`
        + `${autoFilter}${merges}${links}<pageMargins left="0.7" right="0.7" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>${drawing}</worksheet>`,
    });
    if (sheetRels.length) files.push({ name: `xl/worksheets/_rels/sheet${si + 1}.xml.rels`, data: relsXml(sheetRels) });
    contentTypes.push(`<Override PartName="/xl/worksheets/sheet${si + 1}.xml" ContentType="${ctOffice("spreadsheetml.worksheet")}"/>`);
  });

  const now = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
  const title = book.title ? `<dc:title>${xmlEsc(book.title)}</dc:title>` : "";
  const creator = book.creator ? `<dc:creator>${xmlEsc(book.creator)}</dc:creator><cp:lastModifiedBy>${xmlEsc(book.creator)}</cp:lastModifiedBy>` : "";
  const wbRels = [
    ...book.sheets.map((_, i) => ({ id: `rId${i + 1}`, type: relType("worksheet"), target: `worksheets/sheet${i + 1}.xml` })),
    { id: `rId${book.sheets.length + 1}`, type: relType("styles"), target: "styles.xml" },
  ];
  files.push(
    { name: "xl/workbook.xml", data: `${XML_HEAD}<workbook xmlns="${NS_MAIN}" xmlns:r="${NS_R}"><workbookPr date1904="0"/><bookViews><workbookView xWindow="0" yWindow="0" windowWidth="22000" windowHeight="12000" activeTab="0"/></bookViews>`
      + `<sheets>${names.map((n, i) => `<sheet name="${xmlEsc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>`
      + `${definedNames.length ? `<definedNames>${definedNames.join("")}</definedNames>` : ""}<calcPr fullCalcOnLoad="1"/></workbook>` },
    { name: "xl/_rels/workbook.xml.rels", data: relsXml(wbRels) },
    { name: "xl/styles.xml", data: styles.toXml() },
    { name: "docProps/core.xml", data: `${XML_HEAD}<cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:dcmitype="http://purl.org/dc/dcmitype/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">`
      + `${title}${creator}<dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: "docProps/app.xml", data: `${XML_HEAD}<Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties" xmlns:vt="http://schemas.openxmlformats.org/officeDocument/2006/docPropsVTypes"><Application>Gabriel Store</Application>${book.creator ? `<Company>${xmlEsc(book.creator)}</Company>` : ""}</Properties>` },
    { name: "_rels/.rels", data: relsXml([
      { id: "rId1", type: relType("officeDocument"), target: "xl/workbook.xml" },
      { id: "rId2", type: "http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties", target: "docProps/core.xml" },
      { id: "rId3", type: relType("extended-properties"), target: "docProps/app.xml" },
    ]) },
    { name: "[Content_Types].xml", data: `${XML_HEAD}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>`
      + `<Override PartName="/xl/workbook.xml" ContentType="${ctOffice("spreadsheetml.sheet.main")}"/><Override PartName="/xl/styles.xml" ContentType="${ctOffice("spreadsheetml.styles")}"/>`
      + `<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="${ctOffice("extended-properties")}"/>`
      + `${contentTypes.join("")}</Types>` },
  );
  // [Content_Types].xml primero y el resto después, como hacen Excel y LibreOffice.
  files.sort((a, b) => (a.name === "[Content_Types].xml" ? -1 : b.name === "[Content_Types].xml" ? 1 : 0));
  return zipStore(files.map((f) => ({ name: f.name, data: Buffer.from(f.data, "utf8") })));
}
