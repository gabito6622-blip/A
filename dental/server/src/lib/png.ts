// Codificador PNG mínimo (RGB, 8 bits) para generar imágenes SINTÉTICAS de demostración y de
// prueba. Nunca se usan fotos ni radiografías reales de pacientes.
import { deflateSync } from "node:zlib";

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]!) & 0xff]! ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}

/** PNG RGB de width×height; pixel(x, y) devuelve [r, g, b] entre 0 y 255. */
export function encodePng(width: number, height: number, pixel: (x: number, y: number) => [number, number, number]): Buffer {
  const raw = Buffer.alloc((width * 3 + 1) * height);
  let o = 0;
  for (let y = 0; y < height; y++) {
    raw[o++] = 0; // sin filtro
    for (let x = 0; x < width; x++) {
      const [r, g, b] = pixel(x, y);
      raw[o++] = r; raw[o++] = g; raw[o++] = b;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr),
    chunk("IDAT", deflateSync(raw)),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
const gray = (v: number): [number, number, number] => [clamp(v), clamp(v), clamp(v)];
/** Distancia normalizada a una elipse (<1 adentro). */
const ell = (x: number, y: number, cx: number, cy: number, rx: number, ry: number) => ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;

/** "Radiografía periapical" sintética: dos piezas con raíces; con `restored`, una obturación radiopaca. */
export function syntheticPeriapical(variant: number, restored: boolean): Buffer {
  const W = 400, H = 300;
  return encodePng(W, H, (x, y) => {
    let v = 28 + 18 * Math.sin((x + variant * 13) / 23) * Math.cos(y / 31); // hueso de fondo
    for (const cx of [140, 265]) {
      const crown = ell(x, y, cx, 95, 52, 58);
      const rootL = ell(x, y, cx - 20, 190, 15, 90);
      const rootR = ell(x, y, cx + 20, 190, 15, 90);
      if (crown < 1) v = 150 + 50 * (1 - crown);
      else if (rootL < 1 || rootR < 1) v = 115 + 30 * (1 - Math.min(rootL, rootR));
      if (crown < 0.25 && cx === 140 && !restored) v -= 70 * (1 - crown * 4); // lesión radiolúcida
    }
    if (restored && ell(x, y, 140, 80, 26, 20) < 1) v = 245; // obturación
    return gray(v);
  });
}

/** "Radiografía panorámica" sintética: arcada con 14 piezas por maxilar. */
export function syntheticPanoramic(): Buffer {
  const W = 640, H = 280;
  return encodePng(W, H, (x, y) => {
    let v = 22 + 10 * Math.sin(x / 40);
    const t = (x - W / 2) / (W / 2);
    const curve = 40 * t * t;
    for (let i = 0; i < 14; i++) {
      const cx = 60 + i * 40;
      if (ell(x, y, cx, 110 - curve + 20, 16, 34) < 1) v = 170;
      if (ell(x, y, cx, 175 + curve - 20, 15, 32) < 1) v = 165;
    }
    if (Math.abs(y - 142) < 3) v = 40;
    return gray(v);
  });
}

/** "Foto intraoral" sintética: encía y dientes en colores planos. */
export function syntheticIntraoral(): Buffer {
  const W = 480, H = 320;
  return encodePng(W, H, (x, y) => {
    let c: [number, number, number] = [88, 30, 38];
    if (ell(x, y, 240, 160, 230, 130) < 1) c = [214, 112, 120];
    for (let i = 0; i < 8; i++) {
      const cx = 72 + i * 48;
      if (ell(x, y, cx, 130, 20, 34) < 1) c = [242, 236, 222];
      if (ell(x, y, cx, 205, 19, 30) < 1) c = [236, 230, 214];
    }
    return c;
  });
}

/** "Documento escaneado" sintético: hoja con renglones. */
export function syntheticScan(): Buffer {
  const W = 360, H = 480;
  return encodePng(W, H, (x, y) => {
    if (x < 30 || x > W - 30 || y < 30 || y > H - 30) return [228, 228, 224];
    if (y > 60 && y < 76 && x < 220) return [70, 70, 80];
    if ((y - 110) % 26 < 3 && y > 100 && y < 420 && x < 300 - ((y * 7) % 90)) return [120, 120, 130];
    return [252, 252, 248];
  });
}
