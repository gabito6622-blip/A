// Escritor de PDF propio (src/server/pdf.ts): arma un PDF A4 de dos páginas con acentos, formas,
// un enlace y dos imágenes generadas acá mismo (PNG RGBA a mano y JPEG con Pillow si está), y lo
// verifica con pdfinfo, pdftotext y pypdf cuando están instalados. Nada real, todo en carpeta temporal.
import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { deflateSync } from "node:zlib";
import { Pdf, toWinAnsi } from "../dist/server/pdf.js";

/* ---------- Imágenes de prueba ---------- */

const CRC_TABLE = new Int32Array(256).map((_, k) => {
  let c = k;
  for (let i = 0; i < 8; i++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c;
});
function crc32(buf) {
  let c = -1;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ -1) >>> 0;
}
function chunk(type, body) {
  const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), body]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
/** PNG RGBA de 4×4: rojo opaco arriba, azul semitransparente abajo, con filtros 0 y 1 mezclados. */
function makePngRgba() {
  const w = 4, h = 4;
  const rows = [];
  for (let y = 0; y < h; y++) {
    const px = [];
    for (let x = 0; x < w; x++) px.push(...(y < 2 ? [255, 0, 0, 255] : [0, 0, 255, 128]));
    if (y % 2 === 0) rows.push(Buffer.from([0, ...px]));
    else {
      // filtro Sub (1): cada byte se guarda como diferencia con el píxel anterior
      const sub = px.map((v, i) => (i >= 4 ? (v - px[i - 4] + 256) & 255 : v));
      rows.push(Buffer.from([1, ...sub]));
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(Buffer.concat(rows))),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}
/** JPEG 6×5 generado con Pillow, o null si no está disponible. */
function makeJpeg(dir) {
  const out = join(dir, "mini.jpg");
  const r = spawnSync("python3", ["-I", "-c",
    `from PIL import Image; Image.new("RGB",(6,5),(20,120,200)).save(${JSON.stringify(out)},"JPEG",quality=80)`],
    { encoding: "utf8" });
  return r.status === 0 && existsSync(out) ? readFileSync(out) : null;
}

function has(cmd) {
  return spawnSync("which", [cmd]).status === 0;
}
const hasPypdf = spawnSync("python3", ["-I", "-c", "import pypdf"]).status === 0;

/* ---------- PDF de prueba ---------- */

let dir, file, pdfBytes, jpeg;
before(() => {
  dir = mkdtempSync(join(tmpdir(), "gs-pdf-"));
  file = join(dir, "catalogo.pdf");
  const png = makePngRgba();
  jpeg = makeJpeg(dir);

  const pdf = new Pdf({ title: "Catálogo Gabriel Store", author: "Gabriel Store", subject: "Prueba" });
  pdf.addPage();
  pdf.rect(0, 0, pdf.width, 120, { fill: "#1e3a8a" });
  pdf.image(png, 40, 30, 60, 60);
  pdf.text("Catálogo de suscripciones", pdf.width / 2, 170, { font: "bold", size: 26, align: "center", color: "#111" });
  pdf.text("Año 2026 · ¡Precios en bolivianos! «Streaming» 5 €", 40, 210, { size: 12 });
  pdf.rect(40, 240, 515, 70, { fill: "#f1f5f9", stroke: "#cbd5e1", lineWidth: 1, radius: 12 });
  pdf.text("Netflix premium", 56, 270, { font: "bold", size: 14 });
  pdf.text("Bs 35,00", 540, 270, { font: "bold", size: 16, align: "right", color: "#15803d" });
  pdf.text("Pantalla propia, un mes, con garantía", 56, 292, { font: "italic", size: 11, color: "#475569" });
  pdf.line(40, 330, 555, 330, { color: "#94a3b8", lineWidth: 0.5 });
  pdf.circle(60, 370, 10, { fill: "#f59e0b" });
  pdf.text("Mirá más en gabriel.store 🔥🎬", 80, 374, { size: 12 });
  pdf.link(40, 350, 300, 30, "https://ejemplo.invalid/catalogo?ref=prueba");
  pdf.text("Esta descripción es tan larga que no entra y se tiene que recortar con puntos suspensivos", 40, 420, { size: 12, maxWidth: 200 });
  if (jpeg) pdf.image(jpeg, 300, 400, 90, 75);

  pdf.addPage();
  pdf.image(png, 40, 40, 30, 30); // misma imagen: no se vuelve a incrustar
  pdf.text("Página dos con ñ y ü", 40, 100, { size: 14 });
  let y = 130;
  for (const l of pdf.wrap("Un párrafo bastante largo que el escritor tiene que cortar en varias líneas sin pasarse del ancho máximo pedido.", 11, 220)) {
    pdf.text(l, 40, y, { size: 11 }); y += 15;
  }
  pdfBytes = pdf.end();
  writeFileSync(file, pdfBytes);
});
after(() => { rmSync(dir, { recursive: true, force: true }); });

describe("estructura del archivo", () => {
  test("empieza con %PDF-1.4 y termina con %%EOF, con startxref correcto", () => {
    const s = pdfBytes.toString("latin1");
    assert.ok(s.startsWith("%PDF-1.4\n"));
    assert.ok(s.trimEnd().endsWith("%%EOF"));
    const m = /startxref\n(\d+)\n%%EOF\n$/.exec(s);
    assert.ok(m, "startxref presente");
    assert.equal(s.slice(Number(m[1]), Number(m[1]) + 4), "xref");
    assert.match(s, /\/Title <feff/i, "Title en UTF-16 por el acento");
    assert.match(s, /\/Producer \(Gabriel Store PDF\)/);
    assert.match(s, /\/CreationDate \(D:\d{14}\+00'00'\)/);
    assert.match(s, /\/FlateDecode/);
  });
  test("la misma imagen en dos páginas se incrusta una sola vez; el PNG lleva SMask", () => {
    const s = pdfBytes.toString("latin1");
    const smasks = s.match(/\/SMask \d+ 0 R/g) ?? [];
    assert.equal(smasks.length, 1);
    const rgb = s.match(/\/ColorSpace \/DeviceRGB \/BitsPerComponent 8 \/Filter \/FlateDecode/g) ?? [];
    assert.equal(rgb.length, 1, "un solo XObject RGB para el PNG");
    if (jpeg) assert.match(s, /\/Filter \/DCTDecode/);
    assert.ok(pdfBytes.length < 20_000, `archivo chico: ${pdfBytes.length} bytes`);
  });
  test("pageCount y errores claros", () => {
    const p = new Pdf();
    assert.equal(p.pageCount, 0);
    assert.throws(() => p.text("x", 0, 0), /addPage/);
    assert.throws(() => p.end(), /páginas/);
    p.addPage();
    assert.throws(() => p.image(Buffer.from("RIFF0000WEBPVP8 "), 0, 0, 1, 1), /WEBP/);
    assert.throws(() => p.image(Buffer.from("hola"), 0, 0, 1, 1), /no reconocido/);
    assert.throws(() => p.text("x", 0, 0, { color: "verde" }), /Color inválido/);
  });
});

describe("medidas de texto", () => {
  test("textWidth de «Hola» en Helvetica 12 pt según la tabla AFM (722+556+222+556)", () => {
    const p = new Pdf();
    assert.ok(Math.abs(p.textWidth("Hola", 12) - 24.672) < 0.05);
    assert.ok(Math.abs(p.textWidth("Hola", 12, "italic") - 24.672) < 0.05, "Oblique usa los anchos de Helvetica");
    assert.ok(Math.abs(p.textWidth("Hola", 12, "bold") - (722 + 611 + 278 + 556) * 0.012) < 0.05);
    assert.ok(Math.abs(p.textWidth("ñ€…", 10) - (556 + 556 + 1000) * 0.01) < 0.05, "acentos y símbolos WinAnsi");
    assert.equal(p.textWidth("🔥", 10), 0, "emoji no mide ni rompe");
  });
  test("toWinAnsi convierte acentos y quita lo que no existe", () => {
    assert.deepEqual([...toWinAnsi("á¿«€")], [0xe1, 0xbf, 0xab, 0x80]);
    assert.deepEqual([...toWinAnsi("a🔥b")], [0x61, 0x62]);
    assert.deepEqual([...toWinAnsi("e\u0301")], [0xe9], "NFD se normaliza a NFC");
  });
  test("wrap corta por palabras y por letras cuando una palabra no entra", () => {
    const p = new Pdf();
    const lines = p.wrap("Un párrafo bastante largo que el escritor tiene que cortar en varias líneas sin pasarse del ancho máximo pedido.", 11, 220);
    assert.ok(lines.length >= 3, `varias líneas: ${lines.length}`);
    for (const l of lines) assert.ok(p.textWidth(l, 11) <= 220, `«${l}» entra en 220 pt`);
    assert.equal(lines.join(" "), "Un párrafo bastante largo que el escritor tiene que cortar en varias líneas sin pasarse del ancho máximo pedido.");
    const larga = p.wrap("Supercalifragilisticoespialidoso corto", 12, 60);
    assert.ok(larga.length >= 4);
    for (const l of larga) assert.ok(p.textWidth(l, 12) <= 60);
    assert.equal(larga.join(""), "Supercalifragilisticoespialidosocorto");
    assert.deepEqual(p.wrap("uno\n\ndos", 12, 300), ["uno", "", "dos"]);
  });
  test("text devuelve el ancho dibujado y recorta con … si hay maxWidth", () => {
    const p = new Pdf();
    p.addPage();
    const w = p.text("Hola", 10, 20, { size: 12 });
    assert.ok(Math.abs(w - 24.672) < 0.05);
    const w2 = p.text("Una descripción larguísima que no entra de ninguna manera", 10, 40, { size: 12, maxWidth: 100 });
    assert.ok(w2 <= 100 && w2 > 80, `recortado a ${w2}`);
    assert.equal(p.text("", 0, 0), 0);
  });
  test("imageSize lee PNG y JPEG, y devuelve null si no entiende", () => {
    assert.deepEqual(Pdf.imageSize(makePngRgba()), { width: 4, height: 4, type: "png" });
    if (jpeg) assert.deepEqual(Pdf.imageSize(jpeg), { width: 6, height: 5, type: "jpeg" });
    assert.equal(Pdf.imageSize(Buffer.from("nada")), null);
  });
});

describe("verificación con herramientas externas", () => {
  test("pdfinfo: 2 páginas A4", { skip: !has("pdfinfo") && "pdfinfo no instalado" }, () => {
    const out = execFileSync("pdfinfo", [file], { encoding: "utf8" });
    assert.match(out, /Pages:\s+2/);
    assert.match(out, /Page size:\s+595\.28 x 841\.89 pts \(A4\)/);
    assert.match(out, /Title:\s+Catálogo Gabriel Store/);
  });
  test("pdftotext recupera los textos con acentos", { skip: !has("pdftotext") && "pdftotext no instalado" }, () => {
    const out = execFileSync("pdftotext", ["-layout", file, "-"], { encoding: "utf8" });
    assert.match(out, /Catálogo de suscripciones/);
    assert.match(out, /Año 2026/);
    assert.match(out, /Bs 35,00/);
    assert.match(out, /«Streaming» 5 €/);
    assert.match(out, /Página dos con ñ y ü/);
    assert.match(out, /Mirá más en gabriel\.store/, "el emoji se quitó sin romper la línea");
    assert.match(out, /…/, "recorte con puntos suspensivos");
  });
  test("pypdf abre el archivo: 2 páginas, 1 imagen y 1 enlace en la primera", { skip: !hasPypdf && "pypdf no instalado" }, () => {
    const script = `
import sys, json
from pypdf import PdfReader
r = PdfReader(sys.argv[1], strict=True)
p = r.pages[0]
annots = [a.get_object() for a in (p.get("/Annots") or [])]
links = [a for a in annots if a.get("/Subtype") == "/Link"]
imgs = list(p.images)
print(json.dumps({
  "pages": len(r.pages),
  "images": len(imgs),
  "links": len(links),
  "uri": str(links[0]["/A"]["/URI"]) if links else None,
  "img2": len(list(r.pages[1].images)),
  "title": r.metadata.title,
  "text_ok": "Catálogo" in p.extract_text(),
}))`;
    const out = execFileSync("python3", ["-I", "-c", script, file], { encoding: "utf8" });
    const r = JSON.parse(out);
    assert.equal(r.pages, 2);
    assert.equal(r.images, jpeg ? 2 : 1, "imágenes de la primera página");
    assert.equal(r.links, 1);
    assert.equal(r.uri, "https://ejemplo.invalid/catalogo?ref=prueba");
    assert.equal(r.img2, 1);
    assert.equal(r.title, "Catálogo Gabriel Store");
    assert.equal(r.text_ok, true);
  });
  test("un PDF solo con emojis sigue siendo válido", { skip: !has("pdfinfo") && "pdfinfo no instalado" }, () => {
    const p = new Pdf({ title: "Emoji 🔥" });
    p.addPage();
    p.text("🔥🎬🍿 (paréntesis) y \\ barra", 40, 40, { size: 12 });
    const f = join(dir, "emoji.pdf");
    writeFileSync(f, p.end());
    const out = execFileSync("pdfinfo", [f], { encoding: "utf8" });
    assert.match(out, /Pages:\s+1/);
    const txt = execFileSync("pdftotext", [f, "-"], { encoding: "utf8" });
    assert.match(txt, /\(paréntesis\) y \\ barra/);
  });
});
