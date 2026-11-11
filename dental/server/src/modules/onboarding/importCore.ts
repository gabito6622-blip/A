// Migración de datos desde el sistema anterior (B-006): lectura del Excel, mapeo de columnas,
// clave externa por fila y conversión de fechas, horas y montos.
//
// Reglas comunes a pacientes, citas y saldos iniciales:
//  * siempre en dos pasos: «Revisar» (dryRun: valida todo, incluso contra las restricciones de la
//    base, y deshace) e «Importar» (repite la validación y exige el número exacto que se confirmó);
//  * idempotente: cada fila importada guarda su clave (columna «ID externo» o hash de la fila
//    normalizada) en import_records, con UNIQUE por clínica y tipo; reimportar no duplica;
//  * reporte fila por fila descargable, con protección contra inyección de fórmulas.
import { createHash } from "node:crypto";
import ExcelJS from "exceljs";
import { badRequest } from "../../lib/errors.js";
import { normalize } from "../../lib/text.js";

export const IMPORT_KINDS = ["patients", "appointments", "balances"] as const;
export type ImportKind = (typeof IMPORT_KINDS)[number];
export const KIND_LABELS: Record<ImportKind, string> = { patients: "Pacientes", appointments: "Citas futuras", balances: "Saldos iniciales" };

export const MAX_ROWS = 5000;

export interface FieldDef {
  key: string;
  label: string;
  /** Obligatorio para poder importar (si no está mapeado, no se puede revisar). */
  required?: boolean;
  /** Encabezados que se reconocen solos (se comparan sin tildes ni mayúsculas). */
  aliases: string[];
  /** Explicación en lenguaje sencillo (va en la plantilla y en la pantalla). */
  help: string;
}

export type RowStatus = "ok" | "duplicate" | "error" | "review" | "skipped";
export const STATUS_LABELS: Record<RowStatus, { dry: string; real: string }> = {
  ok: { dry: "Se creará", real: "Creado" },
  duplicate: { dry: "Ya existe (no se importa)", real: "Ya existía (no se importó)" },
  error: { dry: "Error", real: "Error (no se importó)" },
  review: { dry: "Para revisar", real: "Para revisar" },
  skipped: { dry: "Se omite", real: "Omitida" },
};

export interface RowResult {
  row: number;
  status: RowStatus;
  message?: string;
  /** Referencia de lo creado o encontrado (p. ej. «Ficha 120»). */
  ref?: string;
  /** Si la fila «para revisar» se importó igual (porque se pidió). */
  imported?: boolean;
  /** Valores leídos de la fila, para el reporte. */
  values: Record<string, string>;
}

export interface Sheet {
  headers: string[]; // índice 0 = columna 1
  rows: { row: number; cells: string[] }[];
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Texto de una celda. Las fechas de Excel se devuelven como AAAA-MM-DD y las horas (fecha base 1899) como HH:MM. */
export function cellText(v: ExcelJS.CellValue): string {
  if (v === null || v === undefined) return "";
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) return "";
    // Una hora sola en Excel es una fracción de día: ExcelJS la entrega como fecha de 1899/1900.
    if (v.getUTCFullYear() <= 1900) return `${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}`;
    const time = v.getUTCHours() || v.getUTCMinutes() ? ` ${pad(v.getUTCHours())}:${pad(v.getUTCMinutes())}` : "";
    return v.toISOString().slice(0, 10) + time;
  }
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray(v.richText)) return v.richText.map((t) => t.text).join("").trim();
    if ("text" in v && typeof v.text === "string") return v.text.trim();
    if ("result" in v) return cellText(v.result as ExcelJS.CellValue);
    if ("error" in v) return "";
    return "";
  }
  if (typeof v === "number") return String(v);
  return String(v).trim();
}

export function sha256(buf: Buffer | string) {
  return createHash("sha256").update(buf).digest("hex");
}

export async function readSheet(fileBase64: string): Promise<{ sheet: Sheet; fileSha256: string }> {
  const buf = Buffer.from(fileBase64, "base64");
  if (!buf.length) throw badRequest("El archivo está vacío");
  const wb = new ExcelJS.Workbook();
  try {
    await wb.xlsx.load(buf as unknown as ArrayBuffer);
  } catch {
    throw badRequest("El archivo no es un Excel (.xlsx) válido. Si viene de otro sistema, ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)».");
  }
  // Se usa la primera hoja con datos que no sea la de instrucciones de la plantilla.
  const ws = wb.worksheets.find((w) => normalize(w.name) !== "instrucciones" && w.actualRowCount > 0) ?? wb.worksheets[0];
  if (!ws) throw badRequest("El archivo no tiene hojas");
  const width = Math.min(ws.columnCount, 60);
  const headers: string[] = [];
  for (let col = 1; col <= width; col++) headers.push(cellText(ws.getRow(1).getCell(col).value));
  while (headers.length && !headers[headers.length - 1]) headers.pop();
  if (!headers.length) throw badRequest("La primera fila debe tener los títulos de las columnas");
  const rows: Sheet["rows"] = [];
  for (let i = 2; i <= ws.rowCount; i++) {
    const r = ws.getRow(i);
    const cells = headers.map((_, k) => cellText(r.getCell(k + 1).value));
    if (cells.every((x) => !x)) continue;
    rows.push({ row: i, cells });
    if (rows.length > MAX_ROWS) throw badRequest(`Máximo ${MAX_ROWS} filas por importación: divide el archivo en partes`);
  }
  return { sheet: { headers, rows }, fileSha256: sha256(buf) };
}

/** Mapeo sugerido a partir de los títulos de las columnas (índices desde 1). */
export function suggestMapping(fields: FieldDef[], headers: string[]): Record<string, number | null> {
  const norm = headers.map((h) => normalize(h).replace(/[.:*°º()]/g, "").replace(/\s+/g, " ").trim());
  const used = new Set<number>();
  const out: Record<string, number | null> = {};
  for (const f of fields) {
    const names = [f.label, ...f.aliases].map((a) => normalize(a).replace(/[.:*°º()]/g, "").replace(/\s+/g, " ").trim());
    const idx = norm.findIndex((h, i) => !used.has(i) && h && names.includes(h));
    out[f.key] = idx >= 0 ? idx + 1 : null;
    if (idx >= 0) used.add(idx);
  }
  return out;
}

/** Valida el mapeo elegido: columnas existentes, sin repetir y con los campos obligatorios. */
export function checkMapping(fields: FieldDef[], headers: string[], mapping: Record<string, number | null | undefined>) {
  const seen = new Map<number, string>();
  for (const [key, col] of Object.entries(mapping)) {
    if (col == null) continue;
    const f = fields.find((x) => x.key === key);
    if (!f) throw badRequest(`Campo desconocido en el mapeo: ${key}`);
    if (!Number.isInteger(col) || col < 1 || col > headers.length) throw badRequest(`La columna elegida para «${f.label}» no existe en el archivo`);
    if (seen.has(col)) throw badRequest(`La columna «${headers[col - 1]}» está elegida para «${seen.get(col)}» y para «${f.label}»`);
    seen.set(col, f.label);
  }
  const missing = fields.filter((f) => f.required && mapping[f.key] == null);
  if (missing.length) throw badRequest(`Elige la columna de: ${missing.map((f) => f.label).join(", ")}`);
}

export function rowValues(fields: FieldDef[], mapping: Record<string, number | null | undefined>, cells: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of fields) {
    const col = mapping[f.key];
    out[f.key] = col ? (cells[col - 1] ?? "").trim() : "";
  }
  return out;
}

/** Clave externa de la fila: «ID externo» si existe; si no, hash de los valores normalizados. */
export function rowKey(kind: ImportKind, values: Record<string, string>, externalField = "externalId"): string {
  const ext = values[externalField]?.trim();
  if (ext) return `ext:${normalize(ext).slice(0, 190)}`;
  const parts = Object.keys(values).filter((k) => k !== externalField).sort().map((k) => `${k}=${normalize(values[k])}`);
  return `h:${sha256(`${kind}|${parts.join("|")}`)}`;
}

// ---------------- Conversión de valores ----------------
/** Fecha: AAAA-MM-DD, dd/mm/aaaa, dd-mm-aaaa, dd.mm.aaaa o fecha de Excel. null si no se reconoce o no existe. */
export function parseDate(s: string): string | null {
  const t = s.trim();
  if (!t) return null;
  let y: number, m: number, d: number;
  let mm = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T].*)?$/);
  if (mm) { y = +mm[1]!; m = +mm[2]!; d = +mm[3]!; }
  else if ((mm = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s.*)?$/))) { d = +mm[1]!; m = +mm[2]!; y = +mm[3]!; }
  else if ((mm = t.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2})$/))) { d = +mm[1]!; m = +mm[2]!; y = 2000 + +mm[3]!; }
  else return null;
  const dt = new Date(Date.UTC(y, m - 1, d));
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null;
  return `${y}-${pad(m)}-${pad(d)}`;
}

/** Hora: HH:MM, H:MM, «9:30 a. m.», fracción de día de Excel (0,5 = 12:00) o la hora de una fecha y hora. */
export function parseTime(s: string): string | null {
  let t = s.trim().toLowerCase();
  if (!t) return null;
  const dt = t.match(/^\d{4}-\d{2}-\d{2} (\d{2}:\d{2})$/);
  if (dt) t = dt[1]!;
  if (/^0?[.,]\d+$/.test(t) || /^0$/.test(t)) {
    const mins = Math.round(Number(t.replace(",", ".")) * 24 * 60);
    return `${pad(Math.floor(mins / 60))}:${pad(mins % 60)}`;
  }
  const m = t.match(/^(\d{1,2})(?:[:.h](\d{2}))?\s*(a\.?\s*m\.?|p\.?\s*m\.?)?(?::\d{2})?$/);
  if (!m) return null;
  let h = +m[1]!;
  const min = m[2] ? +m[2] : 0;
  if (!m[2] && !m[3]) return null; // «9» solo no es una hora clara
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    const pm = m[3].startsWith("p");
    if (pm && h < 12) h += 12;
    if (!pm && h === 12) h = 0;
  }
  if (h > 23 || min > 59) return null;
  return `${pad(h)}:${pad(min)}`;
}

/** Monto en Bs a centavos: 1500, 1500,50, 1.500,50, 1,500.50, «Bs 200», -150 o (150). null si no es un monto. */
export function parseMoney(s: string): number | null {
  let t = s.trim().replace(/bs\.?/i, "").replace(/\s/g, "");
  if (!t) return null;
  let neg = false;
  if (/^\(.*\)$/.test(t)) { neg = true; t = t.slice(1, -1); }
  if (t.startsWith("-") || t.startsWith("−")) { neg = !neg; t = t.slice(1); }
  if (!/^[\d.,]+$/.test(t)) return null;
  const lastDot = t.lastIndexOf("."), lastComma = t.lastIndexOf(",");
  let num: string;
  if (lastDot >= 0 && lastComma >= 0) {
    num = lastComma > lastDot ? t.replace(/\./g, "").replace(",", ".") : t.replace(/,/g, "");
  } else if (lastComma >= 0) {
    num = /^\d{1,3}(,\d{3})+$/.test(t) && !/,\d{1,2}$/.test(t) ? t.replace(/,/g, "") : t.replace(",", ".");
  } else if (lastDot >= 0) {
    // «1.500» y «12.000.000» son miles (uso boliviano); «1500.5» o «150.25» son decimales.
    num = /^\d{1,3}(\.\d{3})+$/.test(t) ? t.replace(/\./g, "") : t;
  } else num = t;
  if (!/^\d+(\.\d+)?$/.test(num)) return null;
  const [ent, dec = ""] = num.split(".");
  if (dec.length > 2) {
    // Números de Excel con más decimales (p. ej. 150.333333): se redondea al centavo.
    const v = Math.round(Number(num) * 100);
    return neg ? -v : v;
  }
  const v = Number(ent) * 100 + Number(dec.padEnd(2, "0") || "0");
  return neg ? -v : v;
}

/** Normaliza un documento: sin puntos ni espacios; separa el expedido (LP, SC, …) si viene pegado. */
const DEPTS = ["LP", "CB", "SC", "OR", "PT", "CH", "TJ", "BE", "PD"];
export function parseDocument(s: string): { number: string | null; issued: string | null } {
  let t = s.trim().toUpperCase().replace(/[.\s]/g, "");
  if (!t) return { number: null, issued: null };
  let issued: string | null = null;
  const m = t.match(/^(.*?)-?([A-Z]{2})$/);
  if (m && DEPTS.includes(m[2]!) && /\d/.test(m[1]!)) { t = m[1]!; issued = m[2]!; }
  return { number: t.slice(0, 30) || null, issued };
}

export function yesNo(s: string): boolean | null {
  const t = normalize(s);
  if (!t) return null;
  if (["si", "s", "yes", "x", "1", "verdadero", "true"].includes(t)) return true;
  if (["no", "n", "0", "falso", "false"].includes(t)) return false;
  return null;
}
