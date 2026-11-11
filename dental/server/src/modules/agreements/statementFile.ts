// Lectura del extracto bancario (Excel .xlsx o CSV) con columnas mapeables: fecha, descripción,
// referencia y monto. Funciones puras (sin base de datos), probadas por separado.
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { badRequest } from "../../lib/errors.js";

export type Cell = string | number | Date | null;
export interface Mapping { date: number; description: number | null; reference: number | null; amount: number; headerRow: number; dateOrder: "dmy" | "ymd" | "mdy" }
export interface ParsedRow {
  rowNumber: number; date: string | null; description: string | null; reference: string | null; amountCents: number | null;
  status: "ok" | "debit" | "error"; message?: string; hash?: string;
}

const MAX_ROWS = 5000;

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

/** Divide un CSV (coma, punto y coma o tabulador; comillas dobles), quitando el BOM. */
export function parseCsv(text: string): string[][] {
  const t = text.replace(/^﻿/, "");
  // El separador se deduce de las primeras líneas (los bancos suelen poner un título antes de las columnas).
  const head = t.split(/\r?\n/, 10);
  const counts = [";", ",", "\t"].map((d) => [d, Math.max(...head.map((l) => l.split(d).length - 1))] as const);
  const best = [...counts].sort((a, b) => b[1] - a[1])[0]!;
  const delim = best[1] > 0 ? best[0] : ",";
  const rows: string[][] = [];
  let row: string[] = [], field = "", q = false;
  for (let i = 0; i < t.length; i++) {
    const ch = t[i]!;
    if (q) {
      if (ch === '"') { if (t[i + 1] === '"') { field += '"'; i++; } else q = false; }
      else field += ch;
    } else if (ch === '"') q = true;
    else if (ch === delim) { row.push(field); field = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && t[i + 1] === "\n") i++;
      row.push(field); rows.push(row); row = []; field = "";
      if (rows.length > MAX_ROWS + 50) throw badRequest(`El extracto tiene más de ${MAX_ROWS} filas: divídelo por períodos`);
    } else field += ch;
  }
  if (field !== "" || row.length) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.some((c) => c.trim() !== ""));
}

function cellValue(v: ExcelJS.CellValue): Cell {
  if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "number" || typeof v === "string") return v;
  if (typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("result" in v) return cellValue(v.result as ExcelJS.CellValue);
    if ("text" in v && typeof v.text === "string") return v.text;
    if ("richText" in v) return v.richText.map((x) => x.text).join("");
  }
  return null;
}

/** Lee el archivo (Excel si empieza como ZIP, si no CSV en UTF-8 o Latin-1) y devuelve las filas. */
export async function readTable(buf: Buffer): Promise<Cell[][]> {
  if (!buf.length) throw badRequest("El archivo está vacío");
  if (buf[0] === 0x50 && buf[1] === 0x4b) {
    const wb = new ExcelJS.Workbook();
    try { await wb.xlsx.load(buf as unknown as ArrayBuffer); } catch { throw badRequest("El archivo no es un Excel (.xlsx) válido"); }
    const ws = wb.worksheets[0];
    if (!ws) throw badRequest("El Excel no tiene hojas");
    if (ws.rowCount > MAX_ROWS + 50) throw badRequest(`El extracto tiene más de ${MAX_ROWS} filas: divídelo por períodos`);
    const out: Cell[][] = [];
    for (let i = 1; i <= ws.rowCount; i++) {
      const r = ws.getRow(i);
      const cells: Cell[] = [];
      for (let k = 1; k <= Math.max(r.cellCount, 1); k++) cells.push(cellValue(r.getCell(k).value));
      if (cells.some((x) => x !== null && String(x).trim() !== "")) out.push(cells);
    }
    return out;
  }
  let text: string;
  try { text = new TextDecoder("utf-8", { fatal: true }).decode(buf); } catch { text = new TextDecoder("latin1").decode(buf); }
  if (/[\u0000-\u0008]/.test(text.slice(0, 2000))) throw badRequest("El archivo no es un Excel (.xlsx) ni un CSV de texto");
  return parseCsv(text);
}

/** Propone el mapeo buscando la fila de títulos (fecha, descripción/concepto/glosa, referencia/n° operación, monto/abono/importe). */
export function suggestMapping(rows: Cell[][]): Mapping | null {
  for (let h = 0; h < Math.min(rows.length, 15); h++) {
    const heads = rows[h]!.map((x) => norm(String(x ?? "")));
    const find = (re: RegExp) => { const i = heads.findIndex((x) => re.test(x)); return i === -1 ? null : i; };
    const date = find(/^fecha|fecha$|^date/);
    const amount = find(/abono|credito|ingreso|monto|importe|amount/);
    if (date === null || amount === null) continue;
    return {
      headerRow: h, date, amount,
      description: find(/descrip|concepto|glosa|detalle/),
      reference: find(/refer|operacion|n.? ?op|transacc|comprobante|codigo/),
      dateOrder: "dmy",
    };
  }
  return null;
}

/** Fecha del extracto → AAAA-MM-DD. Admite Date de Excel, número de serie y textos dd/mm/aaaa, aaaa-mm-dd, mm/dd/aaaa. */
export function parseDateCell(v: Cell, order: Mapping["dateOrder"] = "dmy"): string | null {
  if (v === null) return null;
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (v < 20000 || v > 80000) return null; // número de serie de Excel (≈1954–2119)
    return new Date(Math.round((v - 25569) * 86400000)).toISOString().slice(0, 10);
  }
  const s = v.trim();
  let y: number, m: number, d: number;
  let r = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/.exec(s);
  if (r) { y = +r[1]!; m = +r[2]!; d = +r[3]!; }
  else {
    r = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/.exec(s);
    if (!r) return null;
    const a = +r[1]!, b = +r[2]!;
    y = +r[3]!; if (y < 100) y += 2000;
    if (order === "mdy") { m = a; d = b; } else { d = a; m = b; }
  }
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return dt.toISOString().slice(0, 10);
}

/** Monto → centavos. Admite "1.234,56", "1,234.56", "-50,00", "Bs 120", "(50,00)" y números de Excel. */
export function parseAmountCell(v: Cell): number | null {
  if (v === null || v instanceof Date) return null;
  if (typeof v === "number") return Number.isFinite(v) ? Math.round(v * 100) : null;
  let s = v.trim().replace(/\s|bs\.?|bob/gi, "");
  if (!s) return null;
  let neg = false;
  if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
  if (s.startsWith("-")) { neg = true; s = s.slice(1); }
  if (s.endsWith("-")) { neg = true; s = s.slice(0, -1); }
  if (!/^[\d.,]+$/.test(s)) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  let dec = -1;
  if (lastDot !== -1 && lastComma !== -1) dec = Math.max(lastDot, lastComma);
  else if (lastComma !== -1) dec = /^\d{1,2}$/.test(s.slice(lastComma + 1)) && s.split(",").length === 2 ? lastComma : -1;
  else if (lastDot !== -1) dec = /^\d{1,2}$/.test(s.slice(lastDot + 1)) && s.split(".").length === 2 ? lastDot : -1;
  const intPart = (dec === -1 ? s : s.slice(0, dec)).replace(/[.,]/g, "");
  const fracPart = dec === -1 ? "" : s.slice(dec + 1);
  if (!/^\d+$/.test(intPart || "0") || !/^\d{0,2}$/.test(fracPart)) return null;
  const cents = Number(intPart || "0") * 100 + Number((fracPart + "00").slice(0, 2));
  return neg ? -cents : cents;
}

const txt = (v: Cell, max: number) => {
  if (v === null) return null;
  const s = (v instanceof Date ? v.toISOString().slice(0, 10) : String(v)).replace(/\s+/g, " ").trim();
  return s ? s.slice(0, max) : null;
};

/** Normaliza una referencia para compararla (mayúsculas, sin espacios ni signos). */
export const normRef = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^0-9A-Z]/g, "");

/**
 * Aplica el mapeo. Solo los abonos (monto > 0) se concilian; los débitos quedan fuera.
 * El hash de cada fila (fecha, monto, referencia, descripción y N° de aparición de esa misma
 * combinación en el archivo) hace que reimportar el mismo extracto no duplique movimientos.
 */
export function applyMapping(rows: Cell[][], m: Mapping): ParsedRow[] {
  const out: ParsedRow[] = [];
  const seen = new Map<string, number>();
  for (let i = m.headerRow + 1; i < rows.length; i++) {
    const r = rows[i]!;
    const date = parseDateCell(r[m.date] ?? null, m.dateOrder);
    const amount = parseAmountCell(r[m.amount] ?? null);
    const description = m.description !== null ? txt(r[m.description] ?? null, 300) : null;
    const reference = m.reference !== null ? txt(r[m.reference] ?? null, 80) : null;
    const base: ParsedRow = { rowNumber: i + 1, date, description, reference, amountCents: amount, status: "ok" };
    if (!date) { out.push({ ...base, status: "error", message: "Fecha inválida" }); continue; }
    const rawAmount = r[m.amount] ?? null;
    if (rawAmount === null || String(rawAmount).trim() === "") { out.push({ ...base, status: "debit", message: "Sin abono (débito u otro movimiento): no se concilia" }); continue; }
    if (amount === null) { out.push({ ...base, status: "error", message: "Monto inválido" }); continue; }
    if (amount <= 0) { out.push({ ...base, status: "debit", message: "Débito o monto cero: no se concilia" }); continue; }
    const key = [date, amount, normRef(reference), (description ?? "").toUpperCase()].join("|");
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    out.push({ ...base, hash: createHash("sha256").update(`${key}|${n}`).digest("hex") });
  }
  return out;
}
