// Protección contra inyección de fórmulas (CSV/Excel injection) para TODAS las exportaciones.
//
// Un texto que empieza con = + - @ (o tabulación / retorno de carro) puede interpretarse como
// fórmula al abrir o editar la planilla (p. ej. un paciente llamado «=HYPERLINK(...)»). Además de
// sanear celda por celda donde ya se hacía, cada exportación pasa por xlsxBuffer(), que recorre el
// libro completo antes de escribirlo: así una columna nueva no puede olvidarlo.
// Una prueba (tests/security-audit.test.ts) impide llamar a wb.xlsx.writeBuffer() fuera de aquí.
import type ExcelJS from "exceljs";

const FORMULA_START = /^[=+\-@\t\r＝＋－＠]/;

/** Texto seguro para una celda: antepone un apóstrofo si podría leerse como fórmula. */
export const safeCell = <T>(v: T): T | string => (typeof v === "string" && FORMULA_START.test(v) ? `'${v}` : v);

/** Sanea todas las celdas de texto del libro (valores, textos enriquecidos e hipervínculos). */
export function sanitizeWorkbook(wb: ExcelJS.Workbook): void {
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value as unknown;
        if (typeof v === "string") {
          if (FORMULA_START.test(v)) cell.value = `'${v}`;
        } else if (v && typeof v === "object") {
          const o = v as { formula?: unknown; sharedFormula?: unknown; richText?: { text: string }[]; text?: unknown; hyperlink?: unknown };
          // Las exportaciones nunca escriben fórmulas: si aparece una, se convierte en texto.
          if (o.formula !== undefined || o.sharedFormula !== undefined) cell.value = `'=${String(o.formula ?? o.sharedFormula)}`;
          else if (Array.isArray(o.richText) && o.richText.length && FORMULA_START.test(o.richText[0]!.text)) {
            cell.value = { richText: [{ ...o.richText[0]!, text: `'${o.richText[0]!.text}` }, ...o.richText.slice(1)] };
          } else if (typeof o.hyperlink === "string") {
            cell.value = typeof o.text === "string" ? safeCell(o.text) : null; // sin enlaces externos en los informes
          }
        }
      });
    });
  });
}

/** Única vía para generar el archivo .xlsx de una exportación. */
export async function xlsxBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  sanitizeWorkbook(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}
