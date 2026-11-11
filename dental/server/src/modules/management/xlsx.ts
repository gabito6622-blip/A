// Utilidades de exportación a Excel para los informes de gestión.
// Todas las celdas de texto pasan por safe() (protección contra inyección de fórmulas,
// igual que en patients.ts, fees.ts y labPayables.ts).
import ExcelJS from "exceljs";
import type { FastifyReply } from "fastify";
import { xlsxBuffer } from "../../lib/xlsxSafe.js";

export const safe = (v: unknown) => (typeof v === "string" && /^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

/** Centavos → Bs con 2 decimales (número de Excel, no texto). null se deja vacío ("sin datos"). */
export const bsCell = (cents: number | null | undefined) => (cents == null ? null : Math.round(Number(cents)) / 100);

export const MONEY_FMT = "#,##0.00";

export interface Col {
  header: string;
  width?: number;
  money?: boolean;
  /** Formato numérico propio (por ejemplo "0.0" para horas). */
  fmt?: string;
}

/** Crea una hoja con título opcional, encabezados, filas y, si se indica, una fila de totales en negrita. */
export function addSheet(wb: ExcelJS.Workbook, name: string, cols: Col[], rows: unknown[][], opts: { title?: string; totals?: unknown[]; notes?: string[] } = {}) {
  const ws = wb.addWorksheet(name.slice(0, 31));
  if (opts.title) {
    ws.addRow([safe(opts.title)]).font = { bold: true, size: 13 };
    ws.addRow([]);
  }
  const head = ws.addRow(cols.map((c) => c.header));
  head.font = { bold: true };
  head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F4F1" } }; });
  const first = ws.rowCount + 1;
  for (const r of rows) ws.addRow(r.map(safe));
  if (opts.totals) ws.addRow(opts.totals.map(safe)).font = { bold: true };
  cols.forEach((c, i) => {
    const col = ws.getColumn(i + 1);
    col.width = c.width ?? (c.money ? 16 : 18);
    if (c.money || c.fmt) {
      for (let r = first; r <= ws.rowCount; r++) ws.getCell(r, i + 1).numFmt = c.fmt ?? MONEY_FMT;
    }
  });
  if (opts.notes?.length) {
    ws.addRow([]);
    for (const n of opts.notes) ws.addRow([safe(n)]).font = { italic: true, color: { argb: "FF64788A" } };
  }
  return ws;
}

export const fileSafe = (s: string) => s.normalize("NFD").replace(/[^\w]+/g, "-").replace(/^-|-$/g, "").toLowerCase();

export async function sendXlsx(reply: FastifyReply, wb: ExcelJS.Workbook, name: string) {
  reply
    .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    .header("content-disposition", `attachment; filename="${fileSafe(name.replace(/\.xlsx$/, ""))}.xlsx"`)
    .send(await xlsxBuffer(wb));
}

export function newWorkbook() {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Dentalia";
  wb.created = new Date();
  return wb;
}
