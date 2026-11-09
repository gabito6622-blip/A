// PNG mínimo sin dependencias (escala de grises), para generar un QR de ejemplo en la demo.
import { deflateSync } from "node:zlib";

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};

/** `pixel(x, y)` devuelve 0 (negro) a 255 (blanco). */
export function grayPng(w, h, pixel) {
  const raw = Buffer.alloc((w + 1) * h);
  for (let y = 0; y < h; y++) { raw[y * (w + 1)] = 0; for (let x = 0; x < w; x++) raw[y * (w + 1) + 1 + x] = pixel(x, y); }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 0;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw)), chunk("IEND", Buffer.alloc(0))]);
}

/** Imagen con aspecto de QR (NO es un QR válido: solo para la demo). */
export function fakeQrPng(size = 250) {
  const n = 25, cell = Math.floor(size / (n + 2));
  let r = 11; const rnd = () => (r = (r * 9301 + 49297) % 233280) / 233280;
  const grid = Array.from({ length: n }, (_, i) => Array.from({ length: n }, (_, j) => {
    const a = i < 7 ? 0 : i > 17 ? 18 : -1, b = j < 7 ? 0 : j > 17 ? 18 : -1;
    if (a >= 0 && b >= 0 && !(a && b)) { const di = i - a, dj = j - b; return di === 0 || di === 6 || dj === 0 || dj === 6 || (di > 1 && di < 5 && dj > 1 && dj < 5); }
    return rnd() > 0.55;
  }));
  const px = cell * (n + 2);
  return grayPng(px, px, (x, y) => { const i = Math.floor(y / cell) - 1, j = Math.floor(x / cell) - 1; return i >= 0 && j >= 0 && i < n && j < n && grid[i][j] ? 0 : 255; });
}
