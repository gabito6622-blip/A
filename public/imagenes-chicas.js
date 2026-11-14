// Achica en el navegador los logos y portadas JPG/WEBP de la tienda (o de la página del revendedor) (14/11/2026).
// El servidor achica solo PNG (sin librerías no puede leer JPG ni WEBP). Cuando el dueño abre el panel, o el revendedor
// su GaboHub, esto pide la lista de imágenes que todavía no tienen versión chica, las dibuja más chicas con <canvas>
// y las manda. La original queda guardada; el QR de cobro nunca está en la lista. Corre una vez por página, en silencio:
// si algo falla, la tienda sigue mostrando la original.
import { api } from "/common.js";

const hechos = new Set();

/** Carga una imagen del mismo sitio. */
const cargar = (url) => new Promise((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = mal; i.src = url; });
const aBlob = (cv, tipo, q) => new Promise((ok) => cv.toBlob(ok, tipo, q));
const aBase64 = (blob) => new Promise((ok, mal) => { const r = new FileReader(); r.onload = () => ok(String(r.result).split(",")[1] || ""); r.onerror = mal; r.readAsDataURL(blob); });

/** Dibuja la imagen con el lado mayor en `lado`, achicando de a mitades (más nítido que de un solo salto). */
export function achicarEnCanvas(img, lado) {
  let w = img.naturalWidth, h = img.naturalHeight, src = img;
  const k = Math.min(1, lado / Math.max(w, h)), fw = Math.max(1, Math.round(w * k)), fh = Math.max(1, Math.round(h * k));
  while (w / 2 >= fw && h / 2 >= fh) {
    const cv = document.createElement("canvas"); cv.width = Math.round(w / 2); cv.height = Math.round(h / 2);
    const x = cv.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, cv.width, cv.height);
    src = cv; w = cv.width; h = cv.height;
  }
  const cv = document.createElement("canvas"); cv.width = fw; cv.height = fh;
  const x = cv.getContext("2d"); x.imageSmoothingQuality = "high"; x.drawImage(src, 0, 0, fw, fh);
  return cv;
}

/** base: "/api/admin/imagenes" (dueño) o "/api/me/shop/imagenes" (revendedor). */
export async function achicarPendientes(base) {
  if (hechos.has(base) || typeof document === "undefined") return;
  hechos.add(base);
  let lista = [];
  try { lista = await api("GET", `${base}/pendientes`); } catch { return; }
  for (const it of lista ?? []) {
    try {
      const img = await cargar(it.url); // la original (para JPG y WEBP el servidor todavía no tiene versión chica)
      for (const lado of it.lados ?? []) {
        const cv = achicarEnCanvas(img, lado);
        let blob = await aBlob(cv, "image/webp", 0.82);
        if ((!blob || blob.type !== "image/webp") && it.jpg) blob = await aBlob(cv, "image/jpeg", 0.85); // navegador sin WEBP (JPG no tiene transparencia que perder)
        if (!blob || !/^image\/(webp|jpeg)$/.test(blob.type)) continue;
        await api("POST", `${base}/chica`, { clave: it.clave, lado, base64: await aBase64(blob) });
      }
    } catch { /* se intenta la próxima vez */ }
  }
}
