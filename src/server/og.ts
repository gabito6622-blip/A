// Vista previa al compartir (Open Graph): etiquetas para WhatsApp/Facebook y una imagen de 1200×630
// con el nombre de la tienda en sus colores. Sin dependencias: PNG con zlib y una tipografía de puntos propia.
import { deflateSync } from "node:zlib";

export const OG_W = 1200, OG_H = 630;
type RGB = [number, number, number];

const hex = (h: unknown): RGB | null => {
  if (typeof h !== "string" || !/^#[0-9a-f]{6}$/i.test(h)) return null;
  const n = parseInt(h.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
};
const lerp = (a: RGB, b: RGB, t: number): RGB => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const lum = (c: RGB) => { const [r, g, b] = c.map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const contrast = (a: RGB, b: RGB) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };

// Tipografía de puntos 5×7 (mayúsculas, números y signos comunes).
const G: Record<string, string> = {
  A: ".###.#...##...#######...##...##...#", B: "####.#...##...#####.#...##...#####.", C: ".###.#...##....#....#....#...#.###.",
  D: "####.#...##...##...##...##...#####.", E: "######....#....####.#....#....#####", F: "######....#....####.#....#....#....",
  G: ".###.#...##....#.####...##...#.####", H: "#...##...##...#######...##...##...#", I: ".###...#....#....#....#....#...###.",
  J: "..###...#....#....#....#.#..#..##..", K: "#...##..#.#.#..##...#.#..#..#.#...#", L: "#....#....#....#....#....#....#####",
  M: "#...###.###.#.##.#.##...##...##...#", N: "#...##...###..##.#.##..###...##...#", O: ".###.#...##...##...##...##...#.###.",
  P: "####.#...##...#####.#....#....#....", Q: ".###.#...##...##...##.#.##..#..##.#", R: "####.#...##...#####.#.#..#..#.#...#",
  S: ".#####....#.....###.....#....#####.", T: "#####..#....#....#....#....#....#..", U: "#...##...##...##...##...##...#.###.",
  V: "#...##...##...##...##...#.#.#...#..", W: "#...##...##...##.#.##.#.##.#.#.#.#.", X: "#...##...#.#.#...#...#.#.#...##...#",
  Y: "#...##...#.#.#...#....#....#....#..", Z: "#####....#...#...#...#...#....#####",
  "0": ".###.#...##..###.#.###..##...#.###.", "1": "..#...##....#....#....#....#...###.", "2": ".###.#...#....#...#...#...#...#####",
  "3": "#####...#...#.....#....##...#.###.", "4": "...#...##..#.#.#..#.#####...#....#.", "5": "######....####.....#....##...#.###.",
  "6": "..##..#...#....####.#...##...#.###.", "7": "#####....#...#...#...#....#....#...", "8": ".###.#...##...#.###.#...##...#.###.",
  "9": ".###.#...##...#.####....#...#..##..", " ": ".".repeat(35),
  ".": "...............................##...##.".slice(0, 35), ",": "....................##....#...#.....",
  "-": "...............#####...............", "·": "...............#..................".padEnd(35, ".").replace(/^(.{17})./, "$1#"),
  "&": ".##..#..#.#.#...#...#.#.##..#..##.#", "!": "..#....#....#....#....#.........#..", "?": ".###.#...#....#...#...#.........#..",
  ":": "......##...##.........##...##......", "/": "....#....#...#...#...#...#....#....", "+": ".......#....#..#####..#....#.......",
  "'": "..#....#...#........................", "#": ".#.#..#.#.#####.#.#.#####.#.#..#.#.", "@": ".###.#...##.####.#.##.####....#.###.",
  $: "..#...######.#...###...#.######..#..",
};
// Estos se escriben fila por fila (5 puntos × 7 filas), más fácil de revisar.
const R = (...rows: string[]) => rows.join("");
Object.assign(G, {
  "3": R("#####", "...#.", "..#..", "...#.", "....#", "#...#", ".###."),
  ".": R(".....", ".....", ".....", ".....", ".....", ".##..", ".##.."),
  ",": R(".....", ".....", ".....", ".....", ".##..", "..#..", ".#..."),
  "·": R(".....", ".....", ".....", "..#..", ".....", ".....", "....."),
  "'": R("..#..", "..#..", ".#...", ".....", ".....", ".....", "....."),
  "@": R(".###.", "#...#", "#.###", "#.#.#", "#.###", "#....", ".###."),
  $: R("..#..", ".####", "#.#..", ".###.", "..#.#", "####.", "..#.."),
  " ": ".".repeat(35),
});
/** Todas las letras tienen que tener 35 puntos (lo verifica una prueba). */
export const OG_GLYPHS = G;
const ACCENT: Record<string, string> = { Á: "A", À: "A", Ä: "A", Â: "A", É: "E", È: "E", Ë: "E", Ê: "E", Í: "I", Ì: "I", Ï: "I", Î: "I", Ó: "O", Ò: "O", Ö: "O", Ô: "O", Ú: "U", Ù: "U", Ü: "U", Û: "U", Ñ: "N", Ç: "C" };
const norm = (s: string) => [...String(s ?? "").toUpperCase()].map((ch) => ACCENT[ch] ?? ch).filter((ch) => G[ch]).join("").replace(/\s+/g, " ").trim();

/** Parte el texto en renglones de hasta `max` letras, sin cortar palabras (salvo que una sola no entre). */
function wrap(text: string, max: number): string[] {
  const out: string[] = [];
  let line = "";
  for (const w0 of text.split(" ")) {
    let w = w0;
    while (w.length > max) { if (line) { out.push(line); line = ""; } out.push(w.slice(0, max)); w = w.slice(max); }
    if (!w) continue;
    if (!line) line = w; else if ((line + " " + w).length <= max) line += " " + w; else { out.push(line); line = w; }
  }
  if (line) out.push(line);
  return out;
}

/** Imagen 1200×630 con el nombre (y una línea de texto) en los colores de la tienda. */
export function ogCard(o: { title: string; subtitle?: string; accent?: string; background?: string; brand?: string }): Buffer {
  const W = OG_W, H = OG_H, px = Buffer.alloc(W * H * 3);
  const bg = hex(o.background) ?? [9, 14, 29], ac = hex(o.accent) ?? [57, 132, 255];
  const far = lerp(bg, ac, 0.42);
  const set = (x: number, y: number, c: RGB) => { if (x < 0 || y < 0 || x >= W || y >= H) return; const i = (y * W + x) * 3; px[i] = c[0]; px[i + 1] = c[1]; px[i + 2] = c[2]; };
  // Fondo: degradado diagonal del fondo de la tienda hacia su color principal.
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) set(x, y, lerp(bg, far, Math.min(1, (x / W) * 0.65 + (y / H) * 0.35)));
  // Franja de color arriba.
  for (let y = 0; y < 14; y++) for (let x = 0; x < W; x++) set(x, y, ac);
  // Texto: blanco o casi negro, el que mejor se lea sobre el fondo.
  const mid = lerp(bg, far, 0.5);
  const ink: RGB = contrast([255, 255, 255], mid) >= contrast([13, 17, 23], mid) ? [255, 255, 255] : [13, 17, 23];
  const soft = lerp(ink, mid, 0.3);
  const drawText = (txt: string, scale: number, cy: number, color: RGB) => {
    const w = txt.length * 6 * scale - scale;
    let x0 = Math.round((W - w) / 2);
    const dot = Math.max(1, Math.round(scale * 0.84));
    for (const ch of txt) {
      const g = G[ch];
      for (let r = 0; r < 7; r++) for (let c = 0; c < 5; c++) if (g[r * 5 + c] === "#") {
        const bx = x0 + c * scale, by = cy + r * scale;
        for (let dy = 0; dy < dot; dy++) for (let dx = 0; dx < dot; dx++) {
          // Puntos con esquinas redondeadas (estilo cartel de LED).
          const corner = (dx === 0 || dx === dot - 1) && (dy === 0 || dy === dot - 1) && dot > 4;
          if (!corner) set(bx + dx, by + dy, color);
        }
      }
      x0 += 6 * scale;
    }
  };
  const title = norm(o.title) || "TIENDA";
  // El tamaño más grande con el que el nombre entra en 2 renglones.
  let scale = 18, lines = wrap(title, Math.floor((W - 140) / (6 * scale)));
  while (scale > 7 && (lines.length > 2 || lines.some((l) => l.length * 6 * scale > W - 140))) { scale--; lines = wrap(title, Math.floor((W - 140) / (6 * scale))); }
  lines = lines.slice(0, 2);
  const sub = norm(o.subtitle ?? "");
  const subScale = 5, subLines = sub ? wrap(sub, Math.floor((W - 160) / (6 * subScale))).slice(0, 2) : [];
  const blockH = lines.length * 9 * scale + (subLines.length ? 40 + subLines.length * 9 * subScale : 0);
  let y = Math.round((H - blockH) / 2) + 6;
  for (const l of lines) { drawText(l, scale, y, ink); y += 9 * scale; }
  y += 40;
  for (const l of subLines) { drawText(l, subScale, y, soft); y += 9 * subScale; }
  const brand = norm(o.brand ?? "");
  if (brand) drawText(brand, 3, H - 52, soft);
  return png(W, H, px);
}

const CRC = new Int32Array(256).map((_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c; });
const crc32 = (buf: Buffer) => { let c = -1; for (const b of buf) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; };
const chunk = (type: string, data: Buffer) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
/** PNG RGB de 8 bits a partir de los píxeles (w*h*3 bytes). */
export function png(w: number, h: number, rgb: Buffer): Buffer {
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) rgb.copy(raw, y * (w * 3 + 1) + 1, y * w * 3, (y + 1) * w * 3);
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]);
}

const escAttr = (s: string) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
/** Etiquetas de vista previa para meter en el <head>. */
export function ogTags(o: { title: string; description: string; image: string; url: string; siteName: string; imageW?: number; imageH?: number }): string {
  const d = o.description.slice(0, 200);
  return [
    `<meta name="description" content="${escAttr(d)}">`,
    `<meta property="og:type" content="website">`,
    `<meta property="og:site_name" content="${escAttr(o.siteName)}">`,
    `<meta property="og:title" content="${escAttr(o.title)}">`,
    `<meta property="og:description" content="${escAttr(d)}">`,
    `<meta property="og:url" content="${escAttr(o.url)}">`,
    `<meta property="og:image" content="${escAttr(o.image)}">`,
    ...(o.imageW ? [`<meta property="og:image:width" content="${o.imageW}">`, `<meta property="og:image:height" content="${o.imageH}">`] : []),
    `<meta property="og:locale" content="es_BO">`,
    `<meta name="twitter:card" content="summary_large_image">`,
  ].join("\n");
}
