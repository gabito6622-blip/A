// Protección contra inyección de fórmulas (CSV/Excel injection) para TODAS las exportaciones.
//
// Un texto que empieza con = + - @ (o tabulación / retorno de carro) puede interpretarse como
// fórmula al abrir o editar la planilla (p. ej. un paciente llamado «=HYPERLINK(...)»). Además de
// sanear celda por celda donde ya se hacía, cada exportación pasa por xlsxBuffer() (libro en memoria)
// o por streamXlsx() (libro por flujo), que sanean CADA celda antes de escribirla: así una columna
// nueva no puede olvidarlo. Las dos usan la misma regla (sanitizeValue).
// Una prueba (tests/security-audit.test.ts) impide llamar a wb.xlsx.writeBuffer() o crear un
// escritor por flujo de exceljs fuera de aquí.
//
// Por flujo (B-095): para exportaciones grandes (padrón de pacientes, diario de actividad…) el libro
// se escribe con el escritor por flujo de exceljs directamente en la respuesta HTTP: el primer byte
// sale enseguida y la memoria no crece con la cantidad de filas (quien exporta lee la base por lotes
// y llama a drain() entre lote y lote).
import ExcelJS from "exceljs";
import { PassThrough } from "node:stream";
import type { FastifyReply } from "fastify";

const FORMULA_START = /^[=+\-@\t\r＝＋－＠]/;

/** Texto seguro para una celda: antepone un apóstrofo si podría leerse como fórmula. */
export const safeCell = <T>(v: T): T | string => (typeof v === "string" && FORMULA_START.test(v) ? `'${v}` : v);

/**
 * Valor seguro para una celda (textos, textos enriquecidos, fórmulas e hipervínculos). Devuelve el
 * MISMO valor si no hay nada que cambiar.
 */
export function sanitizeValue(v: unknown): unknown {
  if (typeof v === "string") return FORMULA_START.test(v) ? `'${v}` : v;
  if (v && typeof v === "object" && !(v instanceof Date)) {
    const o = v as { formula?: unknown; sharedFormula?: unknown; richText?: { text: string }[]; text?: unknown; hyperlink?: unknown };
    // Las exportaciones nunca escriben fórmulas: si aparece una, se convierte en texto.
    if (o.formula !== undefined || o.sharedFormula !== undefined) return `'=${String(o.formula ?? o.sharedFormula)}`;
    if (Array.isArray(o.richText) && o.richText.length && FORMULA_START.test(o.richText[0]!.text)) {
      return { richText: [{ ...o.richText[0]!, text: `'${o.richText[0]!.text}` }, ...o.richText.slice(1)] };
    }
    if (typeof o.hyperlink === "string") return typeof o.text === "string" ? safeCell(o.text) : null; // sin enlaces externos en los informes
  }
  return v;
}

/** Sanea todas las celdas de texto del libro (valores, textos enriquecidos e hipervínculos). */
export function sanitizeWorkbook(wb: ExcelJS.Workbook): void {
  wb.eachSheet((ws) => {
    ws.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value as unknown;
        const nv = sanitizeValue(v);
        if (nv !== v) cell.value = nv as ExcelJS.CellValue;
      });
    });
  });
}

/** Única vía para generar el archivo .xlsx de una exportación en memoria (libros chicos). */
export async function xlsxBuffer(wb: ExcelJS.Workbook): Promise<Buffer> {
  sanitizeWorkbook(wb);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

// ---------------------------------------------------------------------------
// Escritura por flujo
// ---------------------------------------------------------------------------
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MONEY_FMT = "#,##0.00";

export interface StreamCol {
  header: string;
  width?: number;
  /** Columna en Bs (formato 0,00). */
  money?: boolean;
  /** Formato numérico propio (p. ej. "0.0"). */
  fmt?: string;
}

export interface StreamSheet {
  /** Agrega una fila (cada valor pasa por sanitizeValue). */
  add(values: unknown[], style?: "bold" | "note"): void;
  /** Filas de datos agregadas (sin título ni encabezado). */
  readonly rows: number;
  /** Cierra la hoja (obligatorio antes de abrir la siguiente). */
  end(): void;
}

export interface XlsxStream {
  /** Abre una hoja con título opcional y la fila de encabezados (en negrita, con fondo). */
  sheet(name: string, cols: StreamCol[], opts?: { title?: string }): StreamSheet;
  /**
   * Deja avanzar la compresión y, si quien descarga va más lento, espera a que vacíe el búfer
   * (memoria acotada). Llamar entre lote y lote.
   */
  drain(): Promise<void>;
  /** Quien descargaba cortó la conexión: conviene dejar de leer la base. */
  readonly aborted: boolean;
}

const nextTick = () => new Promise<void>((r) => setImmediate(r));

/**
 * Escribe un .xlsx POR FLUJO en la respuesta (la ruta debe ser raw). El encabezado HTTP y el primer
 * byte salen antes de leer los datos. Si algo falla a mitad de camino, la descarga se corta (el
 * archivo queda incompleto y el navegador lo informa como fallida): nunca se entrega un archivo
 * truncado que parezca válido.
 */
export async function streamXlsx(reply: FastifyReply, fileName: string, write: (x: XlsxStream) => Promise<void>): Promise<{ aborted: boolean }> {
  const out = new PassThrough({ highWaterMark: 256 * 1024 });
  let aborted = false;
  // Una vez escrito todo el libro ya no hay nada que cortar: un «close» posterior (la conexión se cierra
  // al terminar de enviar) no cuenta como descarga abortada.
  let written = false;
  out.on("error", () => { if (!written) aborted = true; });
  out.on("close", () => { if (!written && !out.readableEnded) aborted = true; });
  // Cerrada antes de que se terminara de escribir (end): quien descargaba cortó la conexión.
  reply.raw.on?.("close", () => { if (!written && !reply.raw.writableEnded) aborted = true; });
  reply
    .header("content-type", XLSX_MIME)
    .header("content-disposition", `attachment; filename="${fileName.replace(/[^\w.-]+/g, "-")}"`)
    .header("cache-control", "no-store");
  reply.send(out);

  const wb = new ExcelJS.stream.xlsx.WorkbookWriter({ stream: out, useStyles: true, useSharedStrings: false });
  wb.creator = "Dentalia";
  wb.created = new Date();
  let open: ExcelJS.Worksheet | null = null;

  const api: XlsxStream = {
    get aborted() { return aborted; },
    sheet(name, cols, opts = {}) {
      if (open) open.commit();
      const ws = wb.addWorksheet(name.slice(0, 31));
      open = ws;
      ws.columns = cols.map((c) => ({ width: c.width ?? (c.money ? 16 : 18) }));
      const fmts = cols.map((c) => c.fmt ?? (c.money ? MONEY_FMT : undefined));
      let n = 0;
      if (opts.title) {
        const t = ws.addRow([sanitizeValue(opts.title)]);
        t.font = { bold: true, size: 13 };
        t.commit();
        ws.addRow([]).commit();
      }
      const head = ws.addRow(cols.map((c) => sanitizeValue(c.header)));
      head.font = { bold: true };
      head.eachCell((cell) => { cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFE3F4F1" } }; });
      head.commit();
      return {
        get rows() { return n; },
        add(values, style) {
          const row = ws.addRow(values.map(sanitizeValue));
          fmts.forEach((f, i) => { if (f) { const cell = row.getCell(i + 1); if (typeof cell.value === "number") cell.numFmt = f; } });
          if (style === "bold") row.font = { bold: true };
          if (style === "note") row.font = { italic: true, color: { argb: "FF64788A" } };
          row.commit();
          if (!style) n++;
        },
        end() { if (open === ws) { ws.commit(); open = null; } },
      };
    },
    async drain() {
      await nextTick();
      while (!aborted && out.writableLength > out.writableHighWaterMark) {
        await new Promise<void>((r) => {
          const done = () => { out.off("drain", done); out.off("close", done); r(); };
          out.once("drain", done);
          out.once("close", done);
        });
      }
    },
  };

  try {
    await write(api);
    if (open) (open as ExcelJS.Worksheet).commit();
    if (!aborted) {
      await wb.commit();
      written = true;
    } else out.destroy();
  } catch (e) {
    out.destroy(e as Error);
    throw e;
  }
  return { aborted };
}
