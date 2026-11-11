// Miniatura generada en el navegador al subir una imagen clínica (B-081): canvas a 320 px por el
// lado mayor, WebP (o JPEG si el navegador no codifica WebP, p. ej. Safari). Se sube junto con el
// original y el servidor la vuelve a validar (firma, ≤ 100 KB, ≤ 400 px). Si algo falla, el archivo
// se sube igual sin miniatura y la galería muestra un marcador.
export const THUMB_SIDE = 320;
export const THUMB_MAX_BYTES = 100 * 1024;

function toBlob(canvas: HTMLCanvasElement, type: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b), type, quality));
}

export async function makeThumbnail(file: Blob | HTMLImageElement): Promise<Blob | null> {
  try {
    if (typeof createImageBitmap !== "function") return null;
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, THUMB_SIDE / Math.max(bmp.width, bmp.height));
      const w = Math.max(1, Math.round(bmp.width * scale)), h = Math.max(1, Math.round(bmp.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      if (!ctx) return null;
      ctx.fillStyle = "#fff"; // fondo blanco para PNG con transparencia (JPEG no la admite)
      ctx.fillRect(0, 0, w, h);
      ctx.imageSmoothingQuality = "high";
      ctx.drawImage(bmp, 0, 0, w, h);
      for (const q of [0.8, 0.6, 0.45]) {
        let b = await toBlob(canvas, "image/webp", q);
        if (!b || b.type !== "image/webp") b = await toBlob(canvas, "image/jpeg", q);
        if (b && (b.type === "image/webp" || b.type === "image/jpeg") && b.size <= THUMB_MAX_BYTES) return b;
      }
      return null;
    } finally { bmp.close(); }
  } catch {
    return null; // imagen que el navegador no puede decodificar: se sube sin miniatura
  }
}

/**
 * Logo de la clínica (B-096): PNG de 512 px como máximo por el lado mayor, conservando la
 * transparencia. El servidor lo vuelve a validar (PNG o JPG, 16–512 px, ≤ 300 KB).
 */
export const LOGO_SIDE = 512;
export const LOGO_MAX_BYTES = 300 * 1024;
export async function makeLogo(file: Blob): Promise<Blob | null> {
  try {
    if (typeof createImageBitmap !== "function") return null;
    const bmp = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      for (const side of [LOGO_SIDE, 384, 256]) {
        const scale = Math.min(1, side / Math.max(bmp.width, bmp.height));
        const w = Math.max(16, Math.round(bmp.width * scale)), h = Math.max(16, Math.round(bmp.height * scale));
        const canvas = document.createElement("canvas");
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext("2d");
        if (!ctx) return null;
        ctx.imageSmoothingQuality = "high";
        ctx.drawImage(bmp, 0, 0, w, h);
        const b = await toBlob(canvas, "image/png", 1);
        if (b && b.type === "image/png" && b.size <= LOGO_MAX_BYTES) return b;
      }
      return null;
    } finally { bmp.close(); }
  } catch {
    return null;
  }
}
