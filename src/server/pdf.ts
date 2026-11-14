// Escritor de PDF propio, sin dependencias externas.
//
// Lo usa el generador de catálogos (portada con logo, productos por categoría, precios, pie con
// enlace). Produce PDF 1.4 con contenidos comprimidos (FlateDecode), fuentes estándar Helvetica
// (sin incrustar), texto en WinAnsiEncoding, imágenes JPEG (DCTDecode directo) y PNG de 8 bits
// (decodificado con zlib, con SMask para el alfa) y anotaciones de enlace.
//
// Coordenadas: origen ARRIBA-IZQUIERDA y eje y hacia abajo, como en pantalla. La conversión al
// sistema del PDF (origen abajo-izquierda) se hace adentro.
import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";

export type PdfFont = "regular" | "bold" | "italic";

export interface TextOpts {
  font?: PdfFont;
  size?: number;
  /** Color "#rrggbb" o "#rgb". Sin color = negro. */
  color?: string;
  align?: "left" | "center" | "right";
  /** Si el texto no entra en este ancho, se recorta y termina en "…". */
  maxWidth?: number;
}

export interface RectOpts {
  fill?: string;
  stroke?: string;
  lineWidth?: number;
  /** Radio de las esquinas redondeadas. */
  radius?: number;
}

export interface LineOpts {
  color?: string;
  lineWidth?: number;
}

export interface PdfInfoOpts {
  title?: string;
  author?: string;
  subject?: string;
  /** Programa que lo hizo (propiedades del PDF). El catálogo de un revendedor pone su nombre: nunca el de la tienda. */
  producer?: string;
}

export interface ImageSize {
  width: number;
  height: number;
  type: "png" | "jpeg";
}

/* ---------------- Anchos de Helvetica (AFM, en milésimas de em) ---------------- */

// Códigos 32..126 (ASCII) en el orden de WinAnsi.
const HELV_ASCII = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, // 32..47
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, // 48..63
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778, // 64..79
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556, // 80..95
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556, // 96..111
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584, // 112..126
];
const HELVB_ASCII = [
  278, 333, 474, 556, 556, 889, 722, 238, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 333, 333, 584, 584, 584, 611,
  975, 722, 722, 722, 722, 667, 611, 778, 722, 278, 556, 722, 611, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 333, 278, 333, 584, 556,
  333, 556, 611, 556, 611, 556, 333, 611, 611, 278, 278, 556, 278, 889, 611, 611,
  611, 611, 389, 556, 333, 611, 556, 778, 556, 556, 500, 389, 280, 389, 584,
];
// Códigos 128..255 de WinAnsi (los huecos 129, 141, 143, 144 y 157 no tienen glifo: 0).
const HELV_HIGH = [
  556, 0, 222, 556, 333, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0, // 128..143
  0, 222, 222, 333, 333, 350, 556, 1000, 333, 1000, 500, 333, 944, 0, 500, 667, // 144..159
  278, 333, 556, 556, 556, 556, 260, 556, 333, 737, 370, 556, 584, 333, 737, 333, // 160..175
  400, 584, 333, 333, 333, 556, 537, 278, 333, 333, 365, 556, 834, 834, 834, 611, // 176..191
  667, 667, 667, 667, 667, 667, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278, // 192..207
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611, // 208..223
  556, 556, 556, 556, 556, 556, 889, 500, 556, 556, 556, 556, 278, 278, 278, 278, // 224..239
  556, 556, 556, 556, 556, 556, 556, 584, 611, 556, 556, 556, 556, 500, 556, 500, // 240..255
];
const HELVB_HIGH = [
  556, 0, 278, 556, 500, 1000, 556, 556, 333, 1000, 667, 333, 1000, 0, 611, 0,
  0, 278, 278, 500, 500, 350, 556, 1000, 333, 1000, 556, 333, 944, 0, 500, 667,
  278, 333, 556, 556, 556, 556, 280, 556, 333, 737, 370, 556, 584, 333, 737, 333,
  400, 584, 333, 333, 333, 611, 556, 278, 333, 333, 365, 556, 834, 834, 834, 611,
  722, 722, 722, 722, 722, 722, 1000, 722, 667, 667, 667, 667, 278, 278, 278, 278,
  722, 722, 778, 778, 778, 778, 778, 584, 778, 722, 722, 722, 722, 667, 667, 611,
  556, 556, 556, 556, 556, 556, 889, 556, 556, 556, 556, 556, 278, 278, 278, 278,
  611, 611, 611, 611, 611, 611, 611, 584, 611, 611, 611, 611, 611, 556, 611, 556,
];

function buildWidths(ascii: number[], high: number[]): Uint16Array {
  const w = new Uint16Array(256);
  for (let i = 0; i < ascii.length; i++) w[32 + i] = ascii[i] ?? 0;
  for (let i = 0; i < high.length; i++) w[128 + i] = high[i] ?? 0;
  w[127] = 0;
  return w;
}
const WIDTHS_REGULAR = buildWidths(HELV_ASCII, HELV_HIGH);
const WIDTHS_BOLD = buildWidths(HELVB_ASCII, HELVB_HIGH);

const FONTS: Record<PdfFont, { base: string; res: string; widths: Uint16Array }> = {
  regular: { base: "Helvetica", res: "F1", widths: WIDTHS_REGULAR },
  bold: { base: "Helvetica-Bold", res: "F2", widths: WIDTHS_BOLD },
  // Helvetica-Oblique usa los mismos anchos que Helvetica.
  italic: { base: "Helvetica-Oblique", res: "F3", widths: WIDTHS_REGULAR },
};

/* ---------------- WinAnsiEncoding ---------------- */

// Unicode → byte para los códigos 128..159 (el resto de Latin-1 coincide con Unicode).
const WINANSI_SPECIAL: Record<number, number> = {
  0x20ac: 0x80, 0x201a: 0x82, 0x0192: 0x83, 0x201e: 0x84, 0x2026: 0x85, 0x2020: 0x86,
  0x2021: 0x87, 0x02c6: 0x88, 0x2030: 0x89, 0x0160: 0x8a, 0x2039: 0x8b, 0x0152: 0x8c,
  0x017d: 0x8e, 0x2018: 0x91, 0x2019: 0x92, 0x201c: 0x93, 0x201d: 0x94, 0x2022: 0x95,
  0x2013: 0x96, 0x2014: 0x97, 0x02dc: 0x98, 0x2122: 0x99, 0x0161: 0x9a, 0x203a: 0x9b,
  0x0153: 0x9c, 0x017e: 0x9e, 0x0178: 0x9f,
  // Parecidos útiles que no están en WinAnsi.
  0x2010: 0x2d, 0x2011: 0x2d, 0x2212: 0x2d, 0x2032: 0x27, 0x2033: 0x22, 0x00a0: 0x20,
  0x2009: 0x20, 0x202f: 0x20, 0x2007: 0x20, 0x3000: 0x20,
};

/** Convierte un texto a bytes WinAnsi; lo que no existe en la codificación se quita. */
export function toWinAnsi(str: string): Uint8Array {
  const out: number[] = [];
  for (const ch of str.normalize("NFC")) {
    const cp = ch.codePointAt(0) ?? 0;
    if (cp === 0x0a || cp === 0x0d || cp === 0x09) { out.push(0x20); continue; }
    if (cp >= 0x20 && cp <= 0x7e) { out.push(cp); continue; }
    if (cp >= 0xa0 && cp <= 0xff) { out.push(cp); continue; }
    const sp = WINANSI_SPECIAL[cp];
    if (sp !== undefined) out.push(sp);
    // Emojis, selectores de variante, símbolos raros: se ignoran sin romper el archivo.
  }
  return Uint8Array.from(out);
}

function escapePdfBytes(bytes: Uint8Array): string {
  let s = "";
  for (const b of bytes) {
    if (b === 0x28 || b === 0x29 || b === 0x5c) s += "\\" + String.fromCharCode(b);
    else if (b < 0x20 || b > 0x7e) s += "\\" + b.toString(8).padStart(3, "0");
    else s += String.fromCharCode(b);
  }
  return s;
}

function widthOfBytes(bytes: Uint8Array, size: number, font: PdfFont): number {
  const w = FONTS[font].widths;
  let total = 0;
  for (const b of bytes) total += w[b] ?? 0;
  return (total * size) / 1000;
}

/* ---------------- Utilidades ---------------- */

function parseColor(c: string): [number, number, number] {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(c.trim());
  if (!m) throw new Error(`Color inválido: ${c} (usá "#rrggbb" o "#rgb")`);
  let hex = m[1] ?? "";
  if (hex.length === 3) hex = hex.split("").map((h) => h + h).join("");
  const n = parseInt(hex, 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function n(v: number): string {
  if (!Number.isFinite(v)) return "0";
  const s = v.toFixed(3);
  return s.includes(".") ? s.replace(/\.?0+$/, "") : s;
}

function colorOp(c: string, fill: boolean): string {
  const [r, g, b] = parseColor(c);
  return `${n(r)} ${n(g)} ${n(b)} ${fill ? "rg" : "RG"}\n`;
}

function pdfDate(d: Date): string {
  const p = (x: number) => String(x).padStart(2, "0");
  return `D:${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}+00'00'`;
}

/** Cadena de texto para diccionarios (Info, URI): ASCII escapado, o UTF-16BE en hexadecimal. */
function pdfString(s: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x20-\x7e]*$/.test(s)) return `(${escapePdfBytes(Buffer.from(s, "latin1"))})`;
  const buf = Buffer.concat([Buffer.from([0xfe, 0xff]), Buffer.from(s, "utf16le").swap16()]);
  return `<${buf.toString("hex")}>`;
}

const KAPPA = 0.5522847498; // Bézier que aproxima un cuarto de círculo

/* ---------------- Imágenes ---------------- */

interface DecodedImage {
  width: number;
  height: number;
  /** "DeviceRGB" | "DeviceGray" | "DeviceCMYK" */
  colorSpace: string;
  /** Datos ya listos para el stream (sin comprimir si filter es FlateDecode). */
  data: Buffer;
  filter: "DCTDecode" | "FlateDecode";
  /** Alfa de 8 bits, un byte por píxel. */
  alpha?: Buffer;
  /** Para JPEG CMYK de Adobe (invertido). */
  decodeInverted?: boolean;
}

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function isPng(buf: Buffer): boolean {
  return buf.length > 24 && buf.subarray(0, 8).equals(PNG_SIG);
}
function isJpeg(buf: Buffer): boolean {
  return buf.length > 4 && buf[0] === 0xff && buf[1] === 0xd8;
}

interface JpegHeader { width: number; height: number; components: number; adobe: boolean; progressive: boolean }

function readJpegHeader(buf: Buffer): JpegHeader | null {
  let i = 2;
  let adobe = false;
  while (i + 4 <= buf.length) {
    if (buf[i] !== 0xff) { i++; continue; }
    const marker = buf[i + 1] ?? 0;
    if (marker === 0xff) { i++; continue; }
    if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7) || marker === 0x01) { i += 2; continue; }
    const len = buf.readUInt16BE(i + 2);
    if (marker === 0xee && buf.subarray(i + 4, i + 9).toString("latin1") === "Adobe") adobe = true;
    const isSof = marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc;
    if (isSof) {
      if (i + 10 > buf.length) return null;
      return {
        height: buf.readUInt16BE(i + 5),
        width: buf.readUInt16BE(i + 7),
        components: buf[i + 9] ?? 0,
        adobe,
        progressive: marker === 0xc2 || marker === 0xc6 || marker === 0xca || marker === 0xce,
      };
    }
    if (marker === 0xda || marker === 0xd9) return null;
    i += 2 + len;
  }
  return null;
}

function decodeJpeg(buf: Buffer): DecodedImage {
  const h = readJpegHeader(buf);
  if (!h) throw new Error("JPEG inválido: no se encontró el encabezado de tamaño");
  const cs = h.components === 1 ? "DeviceGray" : h.components === 4 ? "DeviceCMYK" : h.components === 3 ? "DeviceRGB" : null;
  if (!cs) throw new Error(`JPEG con ${h.components} componentes no soportado`);
  return { width: h.width, height: h.height, colorSpace: cs, data: buf, filter: "DCTDecode", decodeInverted: h.components === 4 && h.adobe };
}

interface PngHeader { width: number; height: number; bitDepth: number; colorType: number; interlace: number }

function readPngHeader(buf: Buffer): PngHeader | null {
  if (!isPng(buf) || buf.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return {
    width: buf.readUInt32BE(16),
    height: buf.readUInt32BE(20),
    bitDepth: buf[24] ?? 0,
    colorType: buf[25] ?? 0,
    interlace: buf[28] ?? 0,
  };
}

function paeth(a: number, b: number, c: number): number {
  const p = a + b - c;
  const pa = Math.abs(p - a), pb = Math.abs(p - b), pc = Math.abs(p - c);
  return pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
}

function decodePng(buf: Buffer): DecodedImage {
  const h = readPngHeader(buf);
  if (!h) throw new Error("PNG inválido: falta el encabezado IHDR");
  if (h.interlace !== 0) throw new Error("PNG entrelazado (Adam7) no soportado: guardalo sin entrelazar");
  if (h.bitDepth === 16) throw new Error("PNG de 16 bits no soportado: guardalo en 8 bits");
  const channelsByType: Record<number, number> = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 };
  const channels = channelsByType[h.colorType];
  if (channels === undefined) throw new Error(`PNG con tipo de color ${h.colorType} no soportado`);
  if (h.bitDepth !== 8 && !((h.colorType === 0 || h.colorType === 3) && [1, 2, 4].includes(h.bitDepth))) {
    throw new Error(`PNG de ${h.bitDepth} bits con tipo de color ${h.colorType} no soportado`);
  }

  // Recorrer los chunks.
  const idat: Buffer[] = [];
  let plte: Buffer | null = null;
  let trns: Buffer | null = null;
  let pos = 8;
  while (pos + 8 <= buf.length) {
    const len = buf.readUInt32BE(pos);
    const type = buf.subarray(pos + 4, pos + 8).toString("latin1");
    const body = buf.subarray(pos + 8, pos + 8 + len);
    if (type === "IDAT") idat.push(body);
    else if (type === "PLTE") plte = body;
    else if (type === "tRNS") trns = body;
    else if (type === "IEND") break;
    pos += 12 + len;
  }
  if (idat.length === 0) throw new Error("PNG inválido: sin datos IDAT");
  const raw = inflateSync(Buffer.concat(idat));

  const bitsPerPixel = channels * h.bitDepth;
  const bpp = Math.max(1, Math.ceil(bitsPerPixel / 8)); // bytes por píxel para los filtros
  const stride = Math.ceil((h.width * bitsPerPixel) / 8);
  if (raw.length < (stride + 1) * h.height) throw new Error("PNG inválido: datos incompletos");

  // Quitar los filtros por fila.
  const lines = Buffer.alloc(stride * h.height);
  const prev = Buffer.alloc(stride);
  for (let y = 0; y < h.height; y++) {
    const ft = raw[y * (stride + 1)] ?? 0;
    const src = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const dst = lines.subarray(y * stride, (y + 1) * stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? (dst[x - bpp] ?? 0) : 0;
      const b = prev[x] ?? 0;
      const c = x >= bpp ? (prev[x - bpp] ?? 0) : 0;
      const v = src[x] ?? 0;
      let out: number;
      switch (ft) {
        case 0: out = v; break;
        case 1: out = v + a; break;
        case 2: out = v + b; break;
        case 3: out = v + ((a + b) >> 1); break;
        case 4: out = v + paeth(a, b, c); break;
        default: throw new Error(`PNG inválido: filtro ${ft} desconocido`);
      }
      dst[x] = out & 255;
    }
    dst.copy(prev);
  }

  // Desempaquetar a un valor por muestra (8 bits).
  const samples = h.width * h.height * channels;
  let flat: Buffer;
  if (h.bitDepth === 8) {
    flat = lines;
  } else {
    flat = Buffer.alloc(samples);
    const perByte = 8 / h.bitDepth;
    const mask = (1 << h.bitDepth) - 1;
    const scale = h.colorType === 0 ? 255 / mask : 1; // gris: escalar a 0..255; paleta: índice tal cual
    for (let y = 0; y < h.height; y++) {
      for (let x = 0; x < h.width; x++) {
        const byte = lines[y * stride + Math.floor(x / perByte)] ?? 0;
        const shift = 8 - h.bitDepth * ((x % perByte) + 1);
        flat[y * h.width + x] = Math.round(((byte >> shift) & mask) * scale);
      }
    }
  }

  const px = h.width * h.height;
  let color: Buffer;
  let alpha: Buffer | undefined;
  let colorSpace = "DeviceRGB";
  switch (h.colorType) {
    case 0: {
      colorSpace = "DeviceGray";
      color = flat;
      if (trns && trns.length >= 2) {
        const key = h.bitDepth === 8 ? trns.readUInt16BE(0) & 255 : Math.round(trns.readUInt16BE(0) * (255 / ((1 << h.bitDepth) - 1)));
        alpha = Buffer.alloc(px, 255);
        for (let i = 0; i < px; i++) if (flat[i] === key) alpha[i] = 0;
      }
      break;
    }
    case 2: {
      color = flat;
      if (trns && trns.length >= 6) {
        const kr = trns.readUInt16BE(0) & 255, kg = trns.readUInt16BE(2) & 255, kb = trns.readUInt16BE(4) & 255;
        alpha = Buffer.alloc(px, 255);
        for (let i = 0; i < px; i++) if (flat[i * 3] === kr && flat[i * 3 + 1] === kg && flat[i * 3 + 2] === kb) alpha[i] = 0;
      }
      break;
    }
    case 3: {
      if (!plte) throw new Error("PNG con paleta sin chunk PLTE");
      color = Buffer.alloc(px * 3);
      alpha = trns ? Buffer.alloc(px, 255) : undefined;
      for (let i = 0; i < px; i++) {
        const idx = flat[i] ?? 0;
        color[i * 3] = plte[idx * 3] ?? 0;
        color[i * 3 + 1] = plte[idx * 3 + 1] ?? 0;
        color[i * 3 + 2] = plte[idx * 3 + 2] ?? 0;
        if (alpha && trns && idx < trns.length) alpha[i] = trns[idx] ?? 255;
      }
      break;
    }
    case 4: {
      colorSpace = "DeviceGray";
      color = Buffer.alloc(px);
      alpha = Buffer.alloc(px);
      for (let i = 0; i < px; i++) { color[i] = flat[i * 2] ?? 0; alpha[i] = flat[i * 2 + 1] ?? 0; }
      break;
    }
    default: {
      color = Buffer.alloc(px * 3);
      alpha = Buffer.alloc(px);
      for (let i = 0; i < px; i++) {
        color[i * 3] = flat[i * 4] ?? 0;
        color[i * 3 + 1] = flat[i * 4 + 1] ?? 0;
        color[i * 3 + 2] = flat[i * 4 + 2] ?? 0;
        alpha[i] = flat[i * 4 + 3] ?? 0;
      }
    }
  }
  // Si el alfa es todo opaco, no hace falta SMask.
  if (alpha && alpha.every((v) => v === 255)) alpha = undefined;
  const out: DecodedImage = { width: h.width, height: h.height, colorSpace, data: color, filter: "FlateDecode" };
  if (alpha) out.alpha = alpha;
  return out;
}

function decodeImage(buf: Buffer): DecodedImage {
  if (isPng(buf)) return decodePng(buf);
  if (isJpeg(buf)) return decodeJpeg(buf);
  const head = buf.subarray(0, 12).toString("latin1");
  if (head.startsWith("RIFF") && head.includes("WEBP")) throw new Error("Imagen WEBP no soportada: convertila a PNG o JPEG");
  if (head.startsWith("GIF8")) throw new Error("Imagen GIF no soportada: convertila a PNG o JPEG");
  if (head.startsWith("<svg") || head.startsWith("<?xml")) throw new Error("Imagen SVG no soportada: convertila a PNG o JPEG");
  throw new Error("Formato de imagen no reconocido: se aceptan PNG de 8 bits y JPEG");
}

/* ---------------- Escritor ---------------- */

interface PageState {
  ops: string[];
  images: Set<string>; // nombres /ImN usados en la página
  fonts: Set<string>;
  annots: string[]; // diccionarios de anotación ya serializados
}

interface ImageEntry {
  name: string;
  objId: number;
  smaskId?: number;
  decoded: DecodedImage;
}

export class Pdf {
  readonly width = 595.28;
  readonly height = 841.89;

  private readonly pages: PageState[] = [];
  private readonly images = new Map<string, ImageEntry>();
  private nextObj = 1;
  private readonly info: PdfInfoOpts;
  private finished: Buffer | null = null;

  constructor(opts: PdfInfoOpts = {}) {
    this.info = { ...opts };
  }

  private get page(): PageState {
    const p = this.pages[this.pages.length - 1];
    if (!p) throw new Error("Llamá a addPage() antes de dibujar");
    return p;
  }

  addPage(): void {
    this.pages.push({ ops: [], images: new Set(), fonts: new Set(), annots: [] });
  }

  get pageCount(): number {
    return this.pages.length;
  }

  textWidth(str: string, size: number, font: PdfFont = "regular"): number {
    return widthOfBytes(toWinAnsi(str), size, font);
  }

  /** Dibuja texto. `y` es la línea base. Devuelve el ancho dibujado en puntos. */
  text(str: string, x: number, y: number, opts: TextOpts = {}): number {
    const font = opts.font ?? "regular";
    const size = opts.size ?? 10;
    let bytes = toWinAnsi(str);
    let w = widthOfBytes(bytes, size, font);
    if (opts.maxWidth !== undefined && w > opts.maxWidth) {
      const ell = 0x85; // "…"
      const ellW = ((FONTS[font].widths[ell] ?? 0) * size) / 1000;
      const kept: number[] = [];
      let acc = 0;
      for (const b of bytes) {
        const bw = ((FONTS[font].widths[b] ?? 0) * size) / 1000;
        if (acc + bw + ellW > opts.maxWidth) break;
        kept.push(b);
        acc += bw;
      }
      while (kept.length && kept[kept.length - 1] === 0x20) kept.pop();
      kept.push(ell);
      bytes = Uint8Array.from(kept);
      w = widthOfBytes(bytes, size, font);
    }
    if (bytes.length === 0) return 0;
    let x0 = x;
    if (opts.align === "center") x0 = x - w / 2;
    else if (opts.align === "right") x0 = x - w;
    const page = this.page;
    const res = FONTS[font].res;
    page.fonts.add(res);
    const color = colorOp(opts.color ?? "#000000", true);
    page.ops.push(`q ${color}BT /${res} ${n(size)} Tf ${n(x0)} ${n(this.height - y)} Td (${escapePdfBytes(bytes)}) Tj ET Q\n`);
    return w;
  }

  /** Corta un texto en líneas por palabras (y por letras si una palabra sola no entra). */
  wrap(str: string, size: number, maxWidth: number, font: PdfFont = "regular"): string[] {
    const lines: string[] = [];
    for (const para of str.split(/\r?\n/)) {
      const words = para.split(/\s+/).filter((w) => w.length > 0);
      if (words.length === 0) { lines.push(""); continue; }
      let cur = "";
      const push = (w: string) => {
        const cand = cur ? `${cur} ${w}` : w;
        if (this.textWidth(cand, size, font) <= maxWidth) { cur = cand; return; }
        if (cur) { lines.push(cur); cur = ""; }
        if (this.textWidth(w, size, font) <= maxWidth) { cur = w; return; }
        // Palabra más ancha que la línea: cortar por letras.
        let piece = "";
        for (const ch of w) {
          if (piece && this.textWidth(piece + ch, size, font) > maxWidth) { lines.push(piece); piece = ""; }
          piece += ch;
        }
        cur = piece;
      };
      for (const w of words) push(w);
      if (cur) lines.push(cur);
    }
    return lines;
  }

  private paintOps(opts: RectOpts): string {
    const fill = opts.fill !== undefined;
    const stroke = opts.stroke !== undefined;
    if (!fill && !stroke) return "f\n"; // sin indicar nada: relleno negro
    if (fill && stroke) return "B\n";
    return fill ? "f\n" : "S\n";
  }

  private styleOps(opts: RectOpts): string {
    let s = "";
    if (opts.fill !== undefined) s += colorOp(opts.fill, true);
    if (opts.stroke !== undefined) s += colorOp(opts.stroke, false);
    if (opts.lineWidth !== undefined) s += `${n(opts.lineWidth)} w\n`;
    return s;
  }

  rect(x: number, y: number, w: number, h: number, opts: RectOpts = {}): void {
    const page = this.page;
    const Y = this.height - y - h; // esquina inferior izquierda en coordenadas PDF
    const r = Math.min(opts.radius ?? 0, w / 2, h / 2);
    let path: string;
    if (r <= 0) {
      path = `${n(x)} ${n(Y)} ${n(w)} ${n(h)} re\n`;
    } else {
      const k = KAPPA * r;
      const x1 = x, x2 = x + w, y1 = Y, y2 = Y + h;
      path =
        `${n(x1 + r)} ${n(y1)} m\n` +
        `${n(x2 - r)} ${n(y1)} l\n` +
        `${n(x2 - r + k)} ${n(y1)} ${n(x2)} ${n(y1 + r - k)} ${n(x2)} ${n(y1 + r)} c\n` +
        `${n(x2)} ${n(y2 - r)} l\n` +
        `${n(x2)} ${n(y2 - r + k)} ${n(x2 - r + k)} ${n(y2)} ${n(x2 - r)} ${n(y2)} c\n` +
        `${n(x1 + r)} ${n(y2)} l\n` +
        `${n(x1 + r - k)} ${n(y2)} ${n(x1)} ${n(y2 - r + k)} ${n(x1)} ${n(y2 - r)} c\n` +
        `${n(x1)} ${n(y1 + r)} l\n` +
        `${n(x1)} ${n(y1 + r - k)} ${n(x1 + r - k)} ${n(y1)} ${n(x1 + r)} ${n(y1)} c\n` +
        `h\n`;
    }
    page.ops.push(`q ${this.styleOps(opts)}${path}${this.paintOps(opts)}Q\n`);
  }

  line(x1: number, y1: number, x2: number, y2: number, opts: LineOpts = {}): void {
    const page = this.page;
    let s = "q ";
    s += colorOp(opts.color ?? "#000000", false);
    if (opts.lineWidth !== undefined) s += `${n(opts.lineWidth)} w\n`;
    s += `${n(x1)} ${n(this.height - y1)} m ${n(x2)} ${n(this.height - y2)} l S Q\n`;
    page.ops.push(s);
  }

  circle(cx: number, cy: number, r: number, opts: RectOpts = {}): void {
    const page = this.page;
    const X = cx, Y = this.height - cy;
    const k = KAPPA * r;
    const path =
      `${n(X + r)} ${n(Y)} m\n` +
      `${n(X + r)} ${n(Y + k)} ${n(X + k)} ${n(Y + r)} ${n(X)} ${n(Y + r)} c\n` +
      `${n(X - k)} ${n(Y + r)} ${n(X - r)} ${n(Y + k)} ${n(X - r)} ${n(Y)} c\n` +
      `${n(X - r)} ${n(Y - k)} ${n(X - k)} ${n(Y - r)} ${n(X)} ${n(Y - r)} c\n` +
      `${n(X + k)} ${n(Y - r)} ${n(X + r)} ${n(Y - k)} ${n(X + r)} ${n(Y)} c\n` +
      `h\n`;
    page.ops.push(`q ${this.styleOps(opts)}${path}${this.paintOps(opts)}Q\n`);
  }

  /** Tamaño natural en píxeles de una imagen soportada, o null si no se puede leer. */
  static imageSize(buf: Buffer): ImageSize | null {
    if (isPng(buf)) {
      const h = readPngHeader(buf);
      return h ? { width: h.width, height: h.height, type: "png" } : null;
    }
    if (isJpeg(buf)) {
      const h = readJpegHeader(buf);
      return h ? { width: h.width, height: h.height, type: "jpeg" } : null;
    }
    return null;
  }

  /** Incrusta una imagen (JPEG o PNG de 8 bits). La misma imagen en varias páginas se guarda una sola vez. */
  image(buf: Buffer, x: number, y: number, w: number, h: number): void {
    const page = this.page;
    const key = createHash("sha1").update(buf).digest("hex");
    let entry = this.images.get(key);
    if (!entry) {
      const decoded = decodeImage(buf);
      entry = { name: `Im${this.images.size + 1}`, objId: 0, decoded };
      this.images.set(key, entry);
    }
    page.images.add(entry.name);
    page.ops.push(`q ${n(w)} 0 0 ${n(h)} ${n(x)} ${n(this.height - y - h)} cm /${entry.name} Do Q\n`);
  }

  /** Zona clicable que abre una URL (sin borde visible). */
  link(x: number, y: number, w: number, h: number, url: string): void {
    const page = this.page;
    const y1 = this.height - y - h, y2 = this.height - y;
    page.annots.push(
      `<< /Type /Annot /Subtype /Link /Rect [${n(x)} ${n(y1)} ${n(x + w)} ${n(y2)}] /Border [0 0 0] /A << /S /URI /URI ${pdfString(url)} >> >>`,
    );
  }

  /** Cierra el documento y devuelve el PDF. */
  end(): Buffer {
    if (this.finished) return this.finished;
    if (this.pages.length === 0) throw new Error("El PDF no tiene páginas: llamá a addPage()");

    const objects: (Buffer | null)[] = []; // índice = id - 1
    const alloc = (): number => { objects.push(null); return objects.length; };
    const set = (id: number, body: string | Buffer): void => {
      objects[id - 1] = Buffer.isBuffer(body) ? body : Buffer.from(body, "latin1");
    };
    const stream = (dict: string, data: Buffer): Buffer =>
      Buffer.concat([Buffer.from(`<< ${dict} /Length ${data.length} >>\nstream\n`, "latin1"), data, Buffer.from("\nendstream", "latin1")]);

    const catalogId = alloc();
    const pagesId = alloc();
    const infoId = alloc();
    const fontIds: Record<string, number> = {};
    for (const f of Object.values(FONTS)) {
      const id = alloc();
      fontIds[f.res] = id;
      set(id, `<< /Type /Font /Subtype /Type1 /BaseFont /${f.base} /Encoding /WinAnsiEncoding >>`);
    }

    // Imágenes (una sola vez cada una).
    const imageByName = new Map<string, ImageEntry>();
    for (const entry of this.images.values()) {
      const d = entry.decoded;
      if (d.alpha) {
        entry.smaskId = alloc();
        set(entry.smaskId, stream(
          `/Type /XObject /Subtype /Image /Width ${d.width} /Height ${d.height} /ColorSpace /DeviceGray /BitsPerComponent 8 /Filter /FlateDecode`,
          deflateSync(d.alpha),
        ));
      }
      entry.objId = alloc();
      const data = d.filter === "FlateDecode" ? deflateSync(d.data) : d.data;
      let dict = `/Type /XObject /Subtype /Image /Width ${d.width} /Height ${d.height} /ColorSpace /${d.colorSpace} /BitsPerComponent 8 /Filter /${d.filter}`;
      if (d.decodeInverted) dict += " /Decode [1 0 1 0 1 0 1 0]";
      if (entry.smaskId) dict += ` /SMask ${entry.smaskId} 0 R`;
      set(entry.objId, stream(dict, data));
      imageByName.set(entry.name, entry);
    }

    // Páginas.
    const pageIds: number[] = [];
    for (const p of this.pages) {
      const contentId = alloc();
      set(contentId, stream("/Filter /FlateDecode", deflateSync(Buffer.from(p.ops.join(""), "latin1"))));
      const annotIds: number[] = [];
      for (const a of p.annots) { const id = alloc(); set(id, a); annotIds.push(id); }
      const fontRes = Object.entries(fontIds).map(([res, id]) => `/${res} ${id} 0 R`).join(" ");
      const xobjRes = [...p.images].map((name) => `/${name} ${imageByName.get(name)?.objId ?? 0} 0 R`).join(" ");
      let dict = `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${n(this.width)} ${n(this.height)}] /Contents ${contentId} 0 R`;
      dict += ` /Resources << /ProcSet [/PDF /Text /ImageB /ImageC] /Font << ${fontRes} >>`;
      if (xobjRes) dict += ` /XObject << ${xobjRes} >>`;
      dict += " >>";
      if (annotIds.length) dict += ` /Annots [${annotIds.map((id) => `${id} 0 R`).join(" ")}]`;
      dict += " >>";
      const pageId = alloc();
      set(pageId, dict);
      pageIds.push(pageId);
    }

    set(pagesId, `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(" ")}] /Count ${pageIds.length} >>`);
    set(catalogId, `<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    let info = `<< /Producer ${pdfString(this.info.producer || "Gabriel Store PDF")} /CreationDate (${pdfDate(new Date())})`;
    if (this.info.title) info += ` /Title ${pdfString(this.info.title)}`;
    if (this.info.author) info += ` /Author ${pdfString(this.info.author)}`;
    if (this.info.subject) info += ` /Subject ${pdfString(this.info.subject)}`;
    info += " >>";
    set(infoId, info);

    // Serializar con tabla xref.
    const parts: Buffer[] = [Buffer.from("%PDF-1.4\n%\xe2\xe3\xcf\xd3\n", "latin1")];
    let offset = parts[0]?.length ?? 0;
    const offsets: number[] = [];
    objects.forEach((body, i) => {
      if (!body) throw new Error(`Objeto ${i + 1} sin contenido`);
      offsets.push(offset);
      const head = Buffer.from(`${i + 1} 0 obj\n`, "latin1");
      const tail = Buffer.from("\nendobj\n", "latin1");
      parts.push(head, body, tail);
      offset += head.length + body.length + tail.length;
    });
    const xrefPos = offset;
    let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
    for (const o of offsets) xref += `${String(o).padStart(10, "0")} 00000 n \n`;
    xref += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R /Info ${infoId} 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
    parts.push(Buffer.from(xref, "latin1"));
    this.finished = Buffer.concat(parts);
    return this.finished;
  }
}

/* ---------------- achicar PNG (para incrustar logos livianos) ---------------- */
const PNG_CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
function pngCrc(buf: Buffer): number { let c = -1; for (const b of buf) c = PNG_CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(pngCrc(td), 0);
  return Buffer.concat([len, td, crc]);
}
/**
 * Devuelve un PNG de 8 bits (RGB o RGBA) con el lado mayor en `maxPx` como máximo, promediando píxeles
 * (filtro de caja). Si la imagen ya es chica, la devuelve tal cual. Sirve para que un catálogo con 35 logos
 * de 300 KB no pese 10 MB. Lanza si el formato no se puede decodificar (WEBP, PNG entrelazado…).
 */
export function shrinkPng(buf: Buffer, maxPx: number): Buffer {
  const img = decodeImage(buf);
  if (img.filter !== "FlateDecode") return buf; // JPEG: se incrusta directo
  const { width: w, height: h } = img;
  const ch = img.colorSpace === "DeviceGray" ? 1 : img.colorSpace === "DeviceCMYK" ? 4 : 3;
  if (Math.max(w, h) <= maxPx && ch === 3) return buf;
  const scale = Math.max(1, Math.max(w, h) / maxPx);
  const nw = Math.max(1, Math.round(w / scale)), nh = Math.max(1, Math.round(h / scale));
  const hasA = !!img.alpha;
  const out = Buffer.alloc(nh * (1 + nw * (hasA ? 4 : 3)));
  for (let y = 0; y < nh; y++) {
    const y0 = Math.floor(y * h / nh), y1 = Math.max(y0 + 1, Math.floor((y + 1) * h / nh));
    out[y * (1 + nw * (hasA ? 4 : 3))] = 0; // filtro None
    for (let x = 0; x < nw; x++) {
      const x0 = Math.floor(x * w / nw), x1 = Math.max(x0 + 1, Math.floor((x + 1) * w / nw));
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let yy = y0; yy < y1; yy++) for (let xx = x0; xx < x1; xx++) {
        const i = (yy * w + xx) * ch;
        if (ch === 1) { r += img.data[i]; g += img.data[i]; b += img.data[i]; }
        else if (ch === 4) { const k = 255 - img.data[i + 3]; r += (255 - img.data[i]) * k / 255; g += (255 - img.data[i + 1]) * k / 255; b += (255 - img.data[i + 2]) * k / 255; }
        else { r += img.data[i]; g += img.data[i + 1]; b += img.data[i + 2]; }
        if (hasA) a += img.alpha![yy * w + xx];
        n++;
      }
      const o = y * (1 + nw * (hasA ? 4 : 3)) + 1 + x * (hasA ? 4 : 3);
      out[o] = Math.round(r / n); out[o + 1] = Math.round(g / n); out[o + 2] = Math.round(b / n);
      if (hasA) out[o + 3] = Math.round(a / n);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(nw, 0); ihdr.writeUInt32BE(nh, 4); ihdr[8] = 8; ihdr[9] = hasA ? 6 : 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), pngChunk("IHDR", ihdr), pngChunk("IDAT", deflateSync(out, { level: 9 })), pngChunk("IEND", Buffer.alloc(0))]);
}
