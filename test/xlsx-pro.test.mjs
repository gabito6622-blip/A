// Pruebas del escritor empresarial de Excel (writeXlsxPro): estilos, fórmulas, combinadas, paneles,
// autofiltro, hipervínculos y gráficos nativos. Se verifica con openpyxl (lee estilos y gráficos) y con
// LibreOffice headless (abre el archivo sin "reparar", recalcula las fórmulas y lo pasa a PDF).
// Todo es ficticio y va a carpetas temporales.
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeXlsx, writeXlsxPro, readSheet } from "../dist/server/xlsx.js";

const AZUL = "#1f4e79", GRIS = "#f2f2f2";
const header = (v) => ({ v, s: { bold: true, color: "#ffffff", fill: AZUL, align: "center", border: true } });
const bs = (v, extra = {}) => ({ v, s: { numFmt: '"Bs" #,##0.00', border: true, ...extra } });

/** Libro de ejemplo con 3 hojas (portada, tabla con gráficos y tendencia con gráfico de líneas). */
function sampleBook() {
  return {
    title: "Informe de ventas (ejemplo)",
    creator: "Gabriel Store",
    sheets: [
      {
        name: "Portada",
        gridLines: false,
        tabColor: AZUL,
        widths: [4, 28, 18, 18, 18, 18],
        heights: { 0: 36 },
        merges: ["A1:F1", "B3:F3"],
        rows: [
          [{ v: "Gabriel Store · Informe mensual", s: { bold: true, size: 20, color: AZUL, align: "center", valign: "middle" } }],
          [],
          [null, { v: "Resumen de ventas de ejemplo, con datos ficticios para probar el exportador.", s: { italic: true, wrap: true } }],
          [null, { v: "Fecha de emisión", s: { bold: true } }, { v: new Date(Date.UTC(2026, 10, 13)) }],
          [null, { v: "Soporte", s: { bold: true } }, { v: "Sitio de ejemplo", link: "https://example.com/soporte" }],
          [null, { v: "Pagado", s: { bold: true } }, { v: true }],
          [null, { v: "=texto peligroso", s: { fill: GRIS } }],
        ],
      },
      {
        name: "Ventas",
        widths: [24, 14, 12, 16],
        freeze: { rows: 4, cols: 1 },
        autoFilter: "A4:D7",
        rows: [
          [{ v: "Ventas del mes", s: { bold: true, size: 14 } }],
          [{ v: "Montos en bolivianos", s: { italic: true, color: "#666666" } }],
          [],
          [header("Producto"), header("Fecha"), header("Cantidad"), header("Monto")],
          [{ v: "Netflix", s: { border: true } }, { v: new Date(Date.UTC(2026, 10, 1)), s: { numFmt: "dd/mm/yyyy", border: true } }, { v: 1, s: { border: true } }, bs(10)],
          [{ v: "Spotify", s: { border: true } }, { v: new Date(Date.UTC(2026, 10, 5)), s: { numFmt: "dd/mm/yyyy", border: true } }, { v: 2, s: { border: true } }, bs(20)],
          [{ v: "Disney+", s: { border: true } }, { v: new Date(Date.UTC(2026, 10, 9)), s: { numFmt: "dd/mm/yyyy", border: true } }, { v: 3, s: { border: true } }, bs(30)],
          [{ v: "Total", s: { bold: true, fill: GRIS, border: true } }, { s: { fill: GRIS, border: true } }, { f: "SUM(C5:C7)", s: { bold: true, fill: GRIS, border: true } }, { f: "SUM(D5:D7)", s: { bold: true, fill: GRIS, numFmt: '"Bs" #,##0.00', border: true } }],
          [{ v: "Participación Netflix", s: { italic: true } }, null, null, { f: "D5/D8", s: { numFmt: "0%" } }],
        ],
        charts: [
          { type: "column", title: "Monto por producto", categories: "A5:A7", series: [{ name: "Monto", values: "D5:D7", color: "#2e75b6" }], anchor: { col: 5, row: 3 } },
          { type: "pie", title: "Reparto", categories: "A5:A7", series: [{ name: "Monto", values: "D5:D7" }], anchor: { col: 5, row: 20, cols: 6, rows: 14 } },
        ],
      },
      {
        name: "Tendencia/2026?",
        widths: [12, 12, 12],
        rows: [
          [header("Mes"), header("Ventas"), header("Costo")],
          ["Ene", 120, 80], ["Feb", 150, 90], ["Mar", 170, 95], ["Abr", 160, 100], ["May", 200, 110],
        ],
        charts: [
          { type: "line", title: "Ventas vs. costo", categories: "A2:A6", series: [{ name: "Ventas", values: "B2:B6", color: "#2e75b6" }, { name: "Costo", values: "C2:C6", color: "#c00000" }], anchor: { col: 4, row: 1, cols: 9, rows: 18 }, legend: true },
        ],
      },
    ],
  };
}

const tmp = mkdtempSync(join(tmpdir(), "xlsx-pro-"));
const file = join(tmp, "informe.xlsx");
const buf = writeXlsxPro(sampleBook());
writeFileSync(file, buf);

const has = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" }).status === 0;
const hasOpenpyxl = has("python3", ["-I", "-c", "import openpyxl"]);
const hasSoffice = existsSync("/usr/bin/soffice") || has("which", ["soffice"]);
const hasPdftotext = has("which", ["pdftotext"]);

test("el archivo es un ZIP válido con las partes esperadas y el tamaño es razonable", () => {
  assert.equal(buf.readUInt32LE(0), 0x04034b50);
  const txt = buf.toString("latin1");
  for (const part of ["xl/styles.xml", "xl/charts/chart1.xml", "xl/charts/chart2.xml", "xl/charts/chart3.xml", "xl/drawings/drawing1.xml", "xl/drawings/drawing2.xml",
    "xl/worksheets/_rels/sheet1.xml.rels", "xl/worksheets/_rels/sheet2.xml.rels", "docProps/core.xml", "docProps/app.xml"]) {
    assert.ok(txt.includes(part), `falta ${part}`);
  }
  assert.ok(txt.includes('<calcPr fullCalcOnLoad="1"/>'), "se pide recalcular al abrir");
  assert.ok(txt.includes("_xlnm._FilterDatabase"), "nombre oculto del autofiltro");
  assert.ok(txt.includes("<f>SUM(C5:C7)</f>"), "la fórmula se escribe en <f>");
  assert.ok(txt.includes("=texto peligroso</t>"), "un texto con = va como texto");
  assert.ok(txt.includes("&apos;Ventas&apos;!$A$5:$A$7") || txt.includes("'Ventas'!$A$5:$A$7"), "las categorías del gráfico apuntan a la hoja");
  assert.ok(txt.includes('name="Tendencia 2026 "'), "el nombre de hoja se sanea");
  assert.ok(buf.length > 10_000 && buf.length < 200_000, `tamaño raro: ${buf.length}`);
  console.log(`Tamaño del archivo de prueba: ${buf.length} bytes`);
});

test("estilos deduplicados y formatos personalizados con id >= 164", () => {
  const txt = buf.toString("utf8");
  const styles = txt.slice(txt.indexOf("<styleSheet"), txt.indexOf("</styleSheet>"));
  // Los formatos personalizados se numeran desde 164 (fecha por defecto y moneda); "0%" usa el id 9 de Excel.
  assert.match(styles, /<numFmt numFmtId="164" formatCode="dd\/mm\/yyyy"\/>/);
  assert.match(styles, /<numFmt numFmtId="165" formatCode="&quot;Bs&quot; #,##0.00"\/>/);
  assert.match(styles, /<xf numFmtId="9" /);
  // Ocho encabezados iguales comparten un solo xf.
  const xfs = styles.match(/<xf /g).length;
  assert.ok(xfs < 25, `demasiados xf: ${xfs}`);
  assert.match(styles, /<fills count="\d+">.*patternType="solid"><fgColor rgb="FF1F4E79"\/>/);
  assert.match(styles, /<border><left style="thin"><color rgb="FFBFBFBF"\/>/);
});

test("rangos y nombres inválidos dan errores claros", () => {
  assert.throws(() => writeXlsxPro({ sheets: [{ name: "X", rows: [[1]], charts: [{ type: "pie", categories: "cualquier cosa", series: [{ name: "a", values: "B1:B2" }], anchor: { col: 0, row: 0 } }] }] }), /Rango inválido/);
  assert.throws(() => writeXlsxPro({ sheets: [{ name: "X", rows: [[1]], merges: ["A1-F1"] }] }), /Rango inválido/);
  assert.throws(() => writeXlsxPro({ sheets: [] }), /al menos una hoja/);
  // Dos hojas con el mismo nombre no rompen el archivo.
  const dup = writeXlsxPro({ sheets: [{ name: "Igual", rows: [] }, { name: "Igual", rows: [] }] }).toString("latin1");
  assert.ok(dup.includes('name="Igual (2)"'));
});

test("el lector propio lee la hoja de ventas del archivo Pro", () => {
  // readSheet descarta las filas vacías: el encabezado queda en la posición 2.
  const rows = readSheet(writeXlsxPro({ sheets: [sampleBook().sheets[1]] }));
  assert.deepEqual(rows[2], ["Producto", "Fecha", "Cantidad", "Monto"]);
  assert.equal(rows[3][0], "Netflix");
  assert.equal(rows[3][1], "46327", "la fecha es la serie de Excel del 01/11/2026");
  assert.equal(rows[3][3], "10");
});

test("openpyxl: hojas, estilos, combinadas, paneles, autofiltro, fórmulas, hipervínculo y gráficos", { skip: !hasOpenpyxl && "no está openpyxl" }, () => {
  const py = `
import json, sys, datetime
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
p, v, t = wb["Portada"], wb["Ventas"], wb.worksheets[2]
out = {
  "sheets": wb.sheetnames,
  "title": wb.properties.title, "creator": wb.properties.creator,
  "portada_merges": sorted(str(r) for r in p.merged_cells.ranges),
  "portada_bold": p["A1"].font.bold, "portada_size": p["A1"].font.sz, "portada_color": p["A1"].font.color.rgb,
  "portada_grid": p.sheet_view.showGridLines, "portada_tab": p.sheet_properties.tabColor.rgb,
  "portada_fecha": isinstance(p["C4"].value, datetime.datetime) and p["C4"].value.strftime("%d/%m/%Y"),
  "portada_fecha_fmt": p["C4"].number_format,
  "portada_link": p["C5"].hyperlink.target if p["C5"].hyperlink else None,
  "portada_bool": p["C6"].value,
  "portada_texto": p["B7"].value,
  "portada_alto": p.row_dimensions[1].height,
  "ventas_header_bold": v["A4"].font.bold, "ventas_header_fill": v["A4"].fill.fgColor.rgb,
  "ventas_fmt": v["D5"].number_format, "ventas_fecha_fmt": v["B5"].number_format,
  "ventas_fecha": v["B5"].value.strftime("%d/%m/%Y"),
  "ventas_freeze": v.freeze_panes, "ventas_filter": v.auto_filter.ref,
  "ventas_sum_c": v["C8"].value, "ventas_sum_d": v["D8"].value, "ventas_pct": v["D9"].value, "ventas_pct_fmt": v["D9"].number_format,
  "ventas_width": v.column_dimensions["A"].width,
  "ventas_border": v["D5"].border.left.style,
  "ventas_charts": [type(c).__name__ for c in v._charts],
  "ventas_chart_title": "".join(r.t for pg in v._charts[0].title.tx.rich.p for r in (pg.r or [])) if v._charts else None,
  "ventas_chart_cat": v._charts[0].series[0].cat.strRef.f if v._charts else None,
  "ventas_chart_val": v._charts[0].series[0].val.numRef.f if v._charts else None,
  "tend_charts": [type(c).__name__ for c in t._charts],
  "tend_series": len(t._charts[0].series) if t._charts else 0,
}
print(json.dumps(out, default=str))
`;
  const out = JSON.parse(execFileSync("python3", ["-I", "-c", py, file], { encoding: "utf8" }));
  assert.deepEqual(out.sheets, ["Portada", "Ventas", "Tendencia 2026 "]);
  assert.equal(out.title, "Informe de ventas (ejemplo)");
  assert.equal(out.creator, "Gabriel Store");
  assert.deepEqual(out.portada_merges, ["A1:F1", "B3:F3"]);
  assert.equal(out.portada_bold, true);
  assert.equal(out.portada_size, 20);
  assert.equal(out.portada_color, "FF1F4E79");
  assert.equal(out.portada_grid, false);
  assert.equal(out.portada_tab, "FF1F4E79");
  assert.equal(out.portada_fecha, "13/11/2026");
  assert.equal(out.portada_fecha_fmt, "dd/mm/yyyy");
  assert.equal(out.portada_link, "https://example.com/soporte");
  assert.equal(out.portada_bool, true);
  assert.equal(out.portada_texto, "=texto peligroso");
  assert.equal(out.portada_alto, 36);
  assert.equal(out.ventas_header_bold, true);
  assert.equal(out.ventas_header_fill, "FF1F4E79");
  assert.equal(out.ventas_fmt, '"Bs" #,##0.00');
  assert.equal(out.ventas_fecha_fmt, "dd/mm/yyyy");
  assert.equal(out.ventas_fecha, "01/11/2026");
  assert.equal(out.ventas_freeze, "B5");
  assert.equal(out.ventas_filter, "A4:D7");
  assert.equal(out.ventas_sum_c, "=SUM(C5:C7)");
  assert.equal(out.ventas_sum_d, "=SUM(D5:D7)");
  assert.equal(out.ventas_pct, "=D5/D8");
  assert.equal(out.ventas_pct_fmt, "0%");
  assert.equal(out.ventas_width, 24);
  assert.equal(out.ventas_border, "thin");
  assert.deepEqual(out.ventas_charts, ["BarChart", "PieChart"]);
  assert.equal(out.ventas_chart_title, "Monto por producto");
  assert.equal(out.ventas_chart_cat, "'Ventas'!$A$5:$A$7");
  assert.equal(out.ventas_chart_val, "'Ventas'!$D$5:$D$7");
  assert.deepEqual(out.tend_charts, ["LineChart"]);
  assert.equal(out.tend_series, 2);
});

test("LibreOffice abre el archivo sin reparar, recalcula las fórmulas y conserva los gráficos", { skip: !hasSoffice && "no está LibreOffice" }, () => {
  const home = mkdtempSync(join(tmpdir(), "lo-home-"));
  const env = { ...process.env, HOME: home };
  const run = (fmt) => {
    const r = spawnSync("soffice", ["--headless", "--norestore", `-env:UserInstallation=file://${home}/profile`, "--convert-to", fmt, "--outdir", tmp, file], { encoding: "utf8", env, timeout: 180_000 });
    assert.equal(r.status, 0, `soffice (${fmt}) falló: ${r.stderr} ${r.stdout}`);
    return r.stdout + r.stderr;
  };
  const log = run("pdf");
  const pdf = join(tmp, "informe.pdf");
  assert.ok(existsSync(pdf), `no se generó el PDF: ${log}`);

  if (hasPdftotext) {
    const text = execFileSync("pdftotext", ["-layout", pdf, "-"], { encoding: "utf8" });
    assert.match(text, /Informe mensual/, "el título de la portada está en el PDF");
    assert.match(text, /Netflix/);
    assert.match(text, /\b6\b/, "SUM de cantidades 1+2+3 = 6");
    assert.match(text, /Bs\s*60[.,]00/, "SUM de montos 10+20+30 = Bs 60.00 con formato de moneda");
    assert.match(text, /17\s?%/, "10/60 = 17 % con formato de porcentaje");
    assert.match(text, /01\/11\/2026/, "fecha en dd/mm/aaaa");
    assert.match(text, /Monto por producto/, "el título del gráfico de columnas se dibujó");
    assert.match(text, /Ventas vs\. costo/, "el título del gráfico de líneas se dibujó");
  }

  // Si LibreOffice vuelve a guardar en .xlsx, los gráficos que entendió sobreviven (y openpyxl los cuenta).
  if (hasOpenpyxl) {
    const out2 = join(tmp, "relectura");
    const r = spawnSync("soffice", ["--headless", "--norestore", `-env:UserInstallation=file://${home}/profile`, "--convert-to", "xlsx", "--outdir", out2, file], { encoding: "utf8", env, timeout: 180_000 });
    assert.equal(r.status, 0, `soffice (xlsx) falló: ${r.stderr}`);
    const py = `
import json, sys
from openpyxl import load_workbook
wb = load_workbook(sys.argv[1])
print(json.dumps({"charts": [len(ws._charts) for ws in wb.worksheets], "d8": wb["Ventas"]["D8"].value, "merges": [str(m) for m in wb["Portada"].merged_cells.ranges]}))
`;
    const res = JSON.parse(execFileSync("python3", ["-I", "-c", py, join(out2, "informe.xlsx")], { encoding: "utf8" }));
    assert.deepEqual(res.charts, [0, 2, 1], "LibreOffice conservó los 3 gráficos");
    assert.equal(res.d8, "=SUM(D5:D7)");
    assert.ok(res.merges.includes("A1:F1"));
  }
  rmSync(home, { recursive: true, force: true });
});

test("el escritor viejo writeXlsx sigue igual: sin estilos, inlineStr y lectura idéntica", () => {
  const old = writeXlsx([{ name: "Clientes", rows: [["Nombre", "Saldo"], ["Ana", 5]] }]);
  const txt = old.toString("latin1");
  assert.ok(!txt.includes("xl/styles.xml"), "writeXlsx no agrega estilos");
  assert.ok(!txt.includes("docProps/"), "writeXlsx no agrega propiedades");
  assert.ok(txt.includes('t="inlineStr"'));
  assert.deepEqual(readSheet(old), [["Nombre", "Saldo"], ["Ana", "5"]]);
});

test.after(() => rmSync(tmp, { recursive: true, force: true }));
