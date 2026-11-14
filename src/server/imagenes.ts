// Imágenes livianas para la tienda (14/11/2026).
//
// Por qué: los íconos de los productos se subían de 512 px y se mostraban a ~48 px. En un celular con 4G lento
// la tienda bajaba ~1,5 MB solo de íconos, y como se servían con «no-cache» y sin ETag, los volvía a bajar en
// cada visita. Acá:
//  1. Se arma (la primera vez que se piden) y se guarda una versión chica de cada imagen PNG: 160 px para los
//     íconos (320 px para las tarjetas grandes), 256 px para el logo y 1080 px para la portada (540 px para el
//     círculo chico del diseño «boleto»).
//     La original queda guardada tal cual. Sin librerías: PNG se lee y se escribe con zlib de Node.
//     JPG y WEBP no se pueden achicar sin una librería: se sirven como están (con caché). El panel puede mandar,
//     al subirlas, una versión chica hecha en el navegador (ver `guardarChicaDelNavegador`).
//  2. Caché: ETag siempre. Con `?v=<fecha de subida>` correcta → «immutable» por un año (al cambiar la imagen
//     cambia la fecha y por lo tanto la dirección). Sin `?v=` (o con una vieja) → «no-cache»: el celular pregunta
//     y, si no cambió, recibe un 304 sin volver a bajarla. Las imágenes que dependen de quién mira (vista previa,
//     link de cobro, datos de un cliente) van con «no-store»: nunca se guardan.
//  3. El QR de cobro NUNCA se achica: un QR ilegible es peor que uno lento.
import { createHash } from "node:crypto";
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import { deflateSync, inflateSync } from "node:zlib";

/** Cómo se muestra la imagen: decide el tamaño de la versión chica. Sin tipo (QR, comprobantes) no se achica. */
export type TipoImagen = "icono" | "logo" | "portada";
/** Lado mayor (px) de cada versión. El primero es el que se sirve si no se pide `?w=`. */
export const TAMANOS: Record<TipoImagen, readonly number[]> = { icono: [160, 320], logo: [256], portada: [1080, 540] };
/** Una imagen más grande que esto (en píxeles) no se intenta achicar: se sirve la original. */
const MAX_PIXELES = 24_000_000;
const REF_OK = /^[a-f0-9]{32}\.(png|jpg|webp)$/;

export interface ComoServir {
  /** Si se achica y a qué tamaño. Sin tipo, va la original (el QR siempre así). */
  tipo?: TipoImagen;
  /** true: la misma imagen para cualquiera que la pida (se puede guardar en caché). false: depende de la sesión → «no-store». */
  publico?: boolean;
}

/* ───────────────────────── PNG: leer, achicar, escribir ───────────────────────── */

export interface Rgba { w: number; h: number; data: Uint8Array }

const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(buf: Uint8Array): number { let c = -1; for (let i = 0; i < buf.length; i++) c = CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8); return (c ^ -1) >>> 0; }
const FIRMA = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** Lee un PNG (cualquier tipo de color y profundidad, sin entrelazado) a RGBA de 8 bits. null si no se puede. */
export function leerPng(buf: Buffer): Rgba | null {
  try {
    if (buf.length < 33 || !buf.subarray(0, 8).equals(FIRMA)) return null;
    let p = 8, w = 0, h = 0, depth = 0, ct = 0, interlace = 0;
    let plte: Buffer | null = null, trns: Buffer | null = null;
    const idat: Buffer[] = [];
    while (p + 8 <= buf.length) {
      const len = buf.readUInt32BE(p), type = buf.toString("latin1", p + 4, p + 8), d = buf.subarray(p + 8, p + 8 + len);
      if (d.length !== len) return null;
      if (type === "IHDR") { w = d.readUInt32BE(0); h = d.readUInt32BE(4); depth = d[8]; ct = d[9]; interlace = d[12]; }
      else if (type === "PLTE") plte = d;
      else if (type === "tRNS") trns = d;
      else if (type === "IDAT") idat.push(d);
      else if (type === "IEND") break;
      p += 12 + len;
    }
    const ch = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[ct];
    if (!ch || !w || !h || interlace !== 0 || w * h > MAX_PIXELES || ![1, 2, 4, 8, 16].includes(depth) || (ct === 3 && !plte)) return null;
    const bpp = ch * depth, rowBytes = Math.ceil((w * bpp) / 8), step = Math.max(1, bpp >> 3);
    const raw = inflateSync(Buffer.concat(idat), { maxOutputLength: h * (rowBytes + 1) + 64 });
    if (raw.length < h * (rowBytes + 1)) return null;
    // Deshacer los filtros fila por fila.
    const px = new Uint8Array(h * rowBytes);
    for (let y = 0; y < h; y++) {
      const f = raw[y * (rowBytes + 1)], src = y * (rowBytes + 1) + 1, o = y * rowBytes, up = o - rowBytes;
      for (let i = 0; i < rowBytes; i++) {
        const a = i >= step ? px[o + i - step] : 0, b = y > 0 ? px[up + i] : 0, c = i >= step && y > 0 ? px[up + i - step] : 0;
        let v = raw[src + i];
        if (f === 1) v += a; else if (f === 2) v += b; else if (f === 3) v += (a + b) >> 1;
        else if (f === 4) { const q = a + b - c, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - c); v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c; }
        else if (f !== 0) return null;
        px[o + i] = v & 0xff;
      }
    }
    // Pasar a RGBA de 8 bits.
    const out = new Uint8Array(w * h * 4), max = (1 << depth) - 1;
    const sample = (row: number, idx: number): number => { // muestra cruda (en su profundidad original)
      if (depth === 8) return px[row + idx];
      if (depth === 16) return (px[row + idx * 2] << 8) | px[row + idx * 2 + 1];
      const bit = idx * depth; return (px[row + (bit >> 3)] >> (8 - depth - (bit & 7))) & max;
    };
    const to8 = (v: number) => (depth === 16 ? v >> 8 : depth === 8 ? v : Math.round((v * 255) / max));
    const tGray = ct === 0 && trns && trns.length >= 2 ? trns.readUInt16BE(0) : -1;
    const tRgb = ct === 2 && trns && trns.length >= 6 ? [trns.readUInt16BE(0), trns.readUInt16BE(2), trns.readUInt16BE(4)] : null;
    for (let y = 0; y < h; y++) {
      const row = y * rowBytes;
      for (let x = 0; x < w; x++) {
        const o = (y * w + x) * 4, s = x * ch;
        if (ct === 3) {
          const i = sample(row, x);
          if (i * 3 + 2 >= plte!.length) return null;
          out[o] = plte![i * 3]; out[o + 1] = plte![i * 3 + 1]; out[o + 2] = plte![i * 3 + 2]; out[o + 3] = trns && i < trns.length ? trns[i] : 255;
        } else if (ct === 0 || ct === 4) {
          const g = sample(row, s);
          out[o] = out[o + 1] = out[o + 2] = to8(g);
          out[o + 3] = ct === 4 ? to8(sample(row, s + 1)) : g === tGray ? 0 : 255;
        } else {
          const r = sample(row, s), g = sample(row, s + 1), b = sample(row, s + 2);
          out[o] = to8(r); out[o + 1] = to8(g); out[o + 2] = to8(b);
          out[o + 3] = ct === 6 ? to8(sample(row, s + 3)) : tRgb && r === tRgb[0] && g === tRgb[1] && b === tRgb[2] ? 0 : 255;
        }
      }
    }
    return { w, h, data: out };
  } catch {
    return null; // dañado o comprimido de forma rara: se sirve la original
  }
}

/** Pesos de un achique por promedio de área (cada píxel nuevo promedia exactamente lo que cubre). */
function pesos(src: number, dst: number): { i0: number; w: Float32Array }[] {
  const r = src / dst, out: { i0: number; w: Float32Array }[] = [];
  for (let o = 0; o < dst; o++) {
    const a = o * r, b = (o + 1) * r, i0 = Math.floor(a), i1 = Math.min(src, Math.ceil(b));
    const w = new Float32Array(i1 - i0);
    for (let i = i0; i < i1; i++) w[i - i0] = (Math.min(b, i + 1) - Math.max(a, i)) / r;
    out.push({ i0, w });
  }
  return out;
}

/** Achica (nunca agranda) para que el lado mayor mida `lado`. Promedia con el alfa premultiplicado: sin bordes oscuros. */
export function achicar(img: Rgba, lado: number): Rgba {
  const { w, h, data } = img;
  if (Math.max(w, h) <= lado) return img;
  const k = lado / Math.max(w, h), nw = Math.max(1, Math.round(w * k)), nh = Math.max(1, Math.round(h * k));
  const px = pesos(w, nw), py = pesos(h, nh);
  // Pasada horizontal (premultiplicado, en float).
  const mid = new Float32Array(nw * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < nw; x++) {
      const { i0, w: ws } = px[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < ws.length; j++) {
        const s = (y * w + i0 + j) * 4, al = data[s + 3] * ws[j];
        r += data[s] * al; g += data[s + 1] * al; b += data[s + 2] * al; a += al;
      }
      const o = (y * nw + x) * 4; mid[o] = r; mid[o + 1] = g; mid[o + 2] = b; mid[o + 3] = a;
    }
  }
  // Pasada vertical y vuelta a RGBA de 8 bits.
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) {
    const { i0, w: ws } = py[y];
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let j = 0; j < ws.length; j++) { const s = ((i0 + j) * nw + x) * 4; r += mid[s] * ws[j]; g += mid[s + 1] * ws[j]; b += mid[s + 2] * ws[j]; a += mid[s + 3] * ws[j]; }
      const o = (y * nw + x) * 4;
      if (a > 0) { out[o] = Math.min(255, Math.round(r / a)); out[o + 1] = Math.min(255, Math.round(g / a)); out[o + 2] = Math.min(255, Math.round(b / a)); }
      out[o + 3] = Math.min(255, Math.round(a));
    }
  }
  return { w: nw, h: nh, data: out };
}

function chunk(type: string, data: Uint8Array): Buffer {
  const td = Buffer.concat([Buffer.from(type, "latin1"), data]);
  const b = Buffer.alloc(12 + data.length);
  b.writeUInt32BE(data.length, 0); td.copy(b, 4); b.writeUInt32BE(crc32(td), 8 + data.length);
  return b;
}

/** Escribe un PNG de 8 bits (RGB si es todo opaco, RGBA si no), eligiendo el mejor filtro por fila. */
export function escribirPng(img: Rgba): Buffer {
  const { w, h, data } = img;
  let opaco = true;
  for (let i = 3; i < data.length; i += 4) if (data[i] !== 255) { opaco = false; break; }
  const ch = opaco ? 3 : 4, rb = w * ch;
  const rows = new Uint8Array(h * rb);
  for (let i = 0, o = 0; i < data.length; i += 4) { rows[o++] = data[i]; rows[o++] = data[i + 1]; rows[o++] = data[i + 2]; if (!opaco) rows[o++] = data[i + 3]; }
  const raw = Buffer.alloc(h * (rb + 1)), cand = Array.from({ length: 5 }, () => new Uint8Array(rb));
  for (let y = 0; y < h; y++) {
    const o = y * rb, up = o - rb;
    let best = 0, bestSum = Infinity;
    for (let f = 0; f < 5; f++) {
      const c = cand[f]; let sum = 0;
      for (let i = 0; i < rb; i++) {
        const v = rows[o + i], a = i >= ch ? rows[o + i - ch] : 0, b = y > 0 ? rows[up + i] : 0, cc = i >= ch && y > 0 ? rows[up + i - ch] : 0;
        let pr = 0;
        if (f === 1) pr = a; else if (f === 2) pr = b; else if (f === 3) pr = (a + b) >> 1;
        else if (f === 4) { const q = a + b - cc, pa = Math.abs(q - a), pb = Math.abs(q - b), pc = Math.abs(q - cc); pr = pa <= pb && pa <= pc ? a : pb <= pc ? b : cc; }
        const d = (v - pr) & 0xff; c[i] = d; sum += d < 128 ? d : 256 - d;
      }
      if (sum < bestSum) { bestSum = sum; best = f; }
    }
    raw[y * (rb + 1)] = best; raw.set(cand[best], y * (rb + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = opaco ? 2 : 6;
  return Buffer.concat([FIRMA, chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 9, memLevel: 9 })), chunk("IEND", new Uint8Array(0))]);
}

/** Tipo de archivo por sus primeros bytes. */
export function tipoDe(head: Buffer): { ext: string; mime: string } | null {
  if (head.subarray(0, 8).equals(FIRMA)) return { ext: ".png", mime: "image/png" };
  if (head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff) return { ext: ".jpg", mime: "image/jpeg" };
  if (head.subarray(0, 4).toString("latin1") === "RIFF" && head.subarray(8, 12).toString("latin1") === "WEBP") return { ext: ".webp", mime: "image/webp" };
  return null;
}

/** Ancho y alto leyendo solo el encabezado (PNG, JPG o WEBP). null si no se entiende. */
export function medidas(buf: Buffer): { w: number; h: number } | null {
  try {
    const t = tipoDe(buf.subarray(0, 16));
    if (t?.ext === ".png") return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
    if (t?.ext === ".jpg") {
      let p = 2;
      while (p + 9 < buf.length) {
        if (buf[p] !== 0xff) { p++; continue; }
        const m = buf[p + 1];
        if (m === 0xd8 || m === 0x01 || (m >= 0xd0 && m <= 0xd7) || m === 0xff) { p += m === 0xff ? 1 : 2; continue; }
        if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { h: buf.readUInt16BE(p + 5), w: buf.readUInt16BE(p + 7) };
        p += 2 + buf.readUInt16BE(p + 2);
      }
      return null;
    }
    if (t?.ext === ".webp") {
      const k = buf.toString("latin1", 12, 16);
      if (k === "VP8 ") return { w: buf.readUInt16LE(26) & 0x3fff, h: buf.readUInt16LE(28) & 0x3fff };
      if (k === "VP8L") { const b = buf.readUInt32LE(21); return { w: (b & 0x3fff) + 1, h: ((b >> 14) & 0x3fff) + 1 }; }
      if (k === "VP8X") return { w: buf.readUIntLE(24, 3) + 1, h: buf.readUIntLE(27, 3) + 1 };
    }
    return null;
  } catch { return null; }
}

/* ───────────────────────── Servir con caché ───────────────────────── */

export interface Imagenes {
  /** Fecha de subida (base 36) de una imagen guardada: va en `?v=`. undefined si no hay imagen. */
  version(ref: string | undefined): string | undefined;
  /** Responde la imagen (o 304). false si no existe (la ruta contesta 404). */
  enviar(req: IncomingMessage, res: ServerResponse, query: URLSearchParams, ref: string | undefined, como?: ComoServir): boolean;
  /** Borra las versiones chicas de una imagen que se reemplazó o se quitó. */
  olvidar(ref: string): void;
  /** Guarda la versión chica que armó el navegador al subir (JPG o WEBP, que el servidor no puede achicar). */
  guardarChicaDelNavegador(ref: string, tipo: TipoImagen, base64: unknown, lado?: unknown): boolean;
  /** Lados que le faltan a un JPG o WEBP (más grande que esa versión y todavía sin ella): los arma el navegador del dueño o del revendedor. */
  pendiente(ref: string | undefined, tipo: TipoImagen): number[];
  /** Archivo que se serviría (para pruebas). */
  archivo(ref: string, como?: ComoServir, w?: number): string | null;
}

export function createImagenes(uploadsDir: string, chicasDir: string): Imagenes {
  const versiones = new Map<string, string>();
  const noSe = new Set<string>(); // «ref|lado» que no conviene o no se puede achicar: se sirve la original
  const huella = (ref: string) => createHash("sha256").update(ref).digest("hex").slice(0, 16);
  const nombre = (ref: string, lado: number, ext: string) => `${ref.replace(/\.[a-z]+$/, "")}-${lado}${ext}`;
  const ladoPedido = (tipo: TipoImagen, w: number | undefined) => { const t = TAMANOS[tipo]; return w && t.includes(w) ? w : t[0]; };

  function version(ref: string | undefined): string | undefined {
    if (!ref || !REF_OK.test(ref)) return undefined;
    const hit = versiones.get(ref);
    if (hit) return hit;
    try {
      const v = Math.floor(statSync(join(uploadsDir, ref)).mtimeMs).toString(36);
      versiones.set(ref, v);
      return v;
    } catch { return undefined; }
  }

  /** Busca (o arma) la versión chica. null = usar la original. */
  function chica(ref: string, tipo: TipoImagen, lado: number): string | null {
    const key = `${ref}|${lado}`;
    if (noSe.has(key)) return null;
    // Primero la del navegador (WEBP o JPG), si vino al subir; después la PNG del servidor.
    for (const ext of [".webp", ".jpg", ".png"]) { const f = join(chicasDir, nombre(ref, lado, ext)); if (existsSync(f)) return f; }
    if (!ref.endsWith(".png")) return null; // JPG/WEBP: solo si el navegador mandó su versión chica
    const orig = join(uploadsDir, ref);
    const buf = readFileSync(orig);
    const img = leerPng(buf);
    if (!img || Math.max(img.w, img.h) <= lado) { noSe.add(key); return null; }
    const out = escribirPng(achicar(img, lado));
    if (out.length >= buf.length) { noSe.add(key); return null; } // no ganó nada: queda la original
    mkdirSync(chicasDir, { recursive: true });
    const f = join(chicasDir, nombre(ref, lado, ".png")), tmp = `${f}.${process.pid}.tmp`;
    writeFileSync(tmp, out); renameSync(tmp, f); // a medio escribir nunca se sirve
    return f;
  }

  function archivo(ref: string, como: ComoServir = {}, w?: number): string | null {
    if (!REF_OK.test(ref)) return null;
    const orig = join(uploadsDir, ref);
    if (!existsSync(orig)) return null;
    if (!como.tipo) return orig;
    try { return chica(ref, como.tipo, ladoPedido(como.tipo, w)) ?? orig; } catch { return orig; }
  }

  function enviar(req: IncomingMessage, res: ServerResponse, query: URLSearchParams, ref: string | undefined, como: ComoServir = {}): boolean {
    if (!ref) return false;
    const w = Number(query.get("w")) || undefined;
    const file = archivo(ref, como, w);
    if (!file) return false;
    const st = statSync(file);
    const fd = readFileSync(file).subarray(0, 16);
    const mime = tipoDe(fd)?.mime ?? "application/octet-stream";
    const variante = file.startsWith(chicasDir) ? `${como.tipo ? ladoPedido(como.tipo, w) : 0}` : "o";
    const headers: Record<string, string> = { "Content-Type": mime };
    if (!como.publico) {
      // Depende de la sesión (vista previa, link de cobro, datos de un cliente): nunca se guarda.
      headers["Cache-Control"] = "no-store";
    } else {
      const etag = `"${huella(ref)}-${variante}"`;
      const v = query.get("v");
      headers.ETag = etag;
      // Con la fecha de subida correcta en la dirección, la imagen no cambia nunca: un año sin preguntar.
      // Sin versión (o con una vieja): se pregunta cada vez y, si no cambió, va un 304 sin la imagen.
      headers["Cache-Control"] = v && v === version(ref) ? "public, max-age=31536000, immutable" : "no-cache";
      const inm = String(req.headers["if-none-match"] ?? "");
      if (inm && inm.split(/\s*,\s*/).includes(etag)) { res.writeHead(304, headers); res.end(); return true; }
    }
    headers["Content-Length"] = String(st.size);
    res.writeHead(200, headers);
    if (req.method === "HEAD") res.end();
    else createReadStream(file).pipe(res);
    return true;
  }

  function olvidar(ref: string): void {
    versiones.delete(ref);
    if (!REF_OK.test(ref) || !existsSync(chicasDir)) return;
    const pre = ref.replace(/\.[a-z]+$/, "") + "-";
    for (const k of [...noSe]) if (k.startsWith(ref + "|")) noSe.delete(k);
    try { for (const f of readdirSync(chicasDir)) if (f.startsWith(pre)) try { unlinkSync(join(chicasDir, f)); } catch { /* ya no está */ } } catch { /* sin carpeta */ }
  }

  function pendiente(ref: string | undefined, tipo: TipoImagen): number[] {
    if (!ref || !REF_OK.test(ref) || ref.endsWith(".png")) return [];
    try {
      const m = medidas(readFileSync(join(uploadsDir, ref)).subarray(0, 64 * 1024));
      if (!m) return [];
      return TAMANOS[tipo].filter((lado) => Math.max(m.w, m.h) > lado && !noSe.has(`${ref}|${lado}`)
        && ![".webp", ".jpg"].some((ext) => existsSync(join(chicasDir, nombre(ref, lado, ext)))));
    } catch { return []; }
  }

  function guardarChicaDelNavegador(ref: string, tipo: TipoImagen, base64: unknown, ladoPedido?: unknown): boolean {
    if (typeof base64 !== "string" || !REF_OK.test(ref) || ref.endsWith(".png")) return false; // PNG: la arma el servidor
    const lado = ladoPedido === undefined ? TAMANOS[tipo][0] : Number(ladoPedido);
    if (!TAMANOS[tipo].includes(lado)) return false;
    try {
      const buf = Buffer.from(base64, "base64");
      const t = tipoDe(buf.subarray(0, 16)), m = medidas(buf);
      const orig = statSync(join(uploadsDir, ref)).size;
      // Solo una imagen de verdad (JPG o WEBP), del tamaño pedido, de hasta 1 MB y más liviana que la original.
      if (!t || t.ext === ".png" || !m || Math.max(m.w, m.h) > lado || buf.length > 1024 * 1024 || buf.length >= orig) return false;
      mkdirSync(chicasDir, { recursive: true });
      writeFileSync(join(chicasDir, nombre(ref, lado, t.ext)), buf);
      noSe.delete(`${ref}|${lado}`);
      return true;
    } catch { return false; }
  }

  return { version, enviar, olvidar, guardarChicaDelNavegador, pendiente, archivo };
}
