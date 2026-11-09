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
