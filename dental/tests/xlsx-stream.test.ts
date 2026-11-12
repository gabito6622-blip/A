// B-104: el Excel por flujo comparte estilos entre celdas para ir el doble de rápido. Esta prueba
// asegura que los formatos no se mezclan: montos con formato Bs, fechas como fecha, textos como texto,
// aunque en una misma columna haya valores de distinto tipo, y que las filas con estilo no contagian.
import { describe, expect, it } from "vitest";
import { PassThrough, type Readable } from "node:stream";
import ExcelJS from "exceljs";
import { streamXlsx } from "../server/src/lib/xlsxSafe.js";

function fakeReply() {
  let body: Readable | null = null;
  const reply: any = {
    raw: { on() {}, writableEnded: false },
    header() { return reply; },
    send(s: Readable) { body = s; return reply; },
  };
  const done = () => new Promise<Buffer>((resolve, reject) => {
    const chunks: Buffer[] = [];
    body!.on("data", (c: Buffer) => chunks.push(c));
    body!.on("end", () => resolve(Buffer.concat(chunks)));
    body!.on("error", reject);
  });
  return { reply, done };
}

describe("Excel por flujo (streamXlsx)", () => {
  it("mantiene el formato de cada tipo de dato en columnas mixtas y protege fórmulas", async () => {
    const { reply, done } = fakeReply();
    const collected = (async () => { await new Promise((r) => setImmediate(r)); return done(); })();
    const d = new Date(Date.UTC(2026, 10, 12));
    await streamXlsx(reply, "prueba.xlsx", async (x) => {
      const ws = x.sheet("Datos", [{ header: "Mixta" }, { header: "Monto", money: true }, { header: "Texto" }]);
      ws.add([d, 1234.5, "=1+1"]);
      ws.add(["texto", 10, "hola"]);
      ws.add([42, "sin monto", null]);
      ws.add(["Total", 1244.5, ""], "bold");
      ws.add([d, 5, "fin"]);
      ws.end();
    });
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load((await collected) as unknown as ArrayBuffer);
    const s = wb.worksheets[0]!;
    const cell = (r: number, c: number) => s.getRow(r).getCell(c);
    // Fila 1: encabezado; datos desde la fila 2
    expect(cell(2, 1).value).toBeInstanceOf(Date);
    expect(cell(2, 1).numFmt).toMatch(/[dy]/); // formato de fecha, no «General»
    expect(cell(2, 2).value).toBe(1234.5);
    expect(cell(2, 2).numFmt).toMatch(/Bs|0\.00|#,##0/);
    expect(String(cell(2, 3).value)).toBe("'=1+1"); // la fórmula llega como texto
    expect(cell(3, 1).value).toBe("texto");
    expect(cell(3, 2).numFmt).toBe(cell(2, 2).numFmt);
    expect(cell(4, 1).value).toBe(42);
    expect(cell(4, 1).numFmt ?? "General").not.toMatch(/[dy]/); // un número en la columna de fechas no hereda el formato de fecha
    expect(cell(5, 1).font?.bold).toBe(true);
    expect(cell(6, 1).font?.bold).toBeFalsy(); // la fila en negrita no contagia a las siguientes
    expect(cell(6, 1).value).toBeInstanceOf(Date);
  });
});
