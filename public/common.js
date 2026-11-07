// Utilidades compartidas por la tienda y el panel.

/** Llama a la API. Lanza un Error con `.code` y `.status` si la respuesta no es OK. */
export async function api(method, path, body) {
  const r = await fetch(path, {
    method,
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : {},
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  let data = {};
  try { data = await r.json(); } catch { /* respuesta sin cuerpo */ }
  if (!r.ok) throw Object.assign(new Error(data.message || `Error ${r.status}`), { code: data.error, status: r.status });
  return data;
}

export const $ = (s, root = document) => root.querySelector(s);
export const $$ = (s, root = document) => [...root.querySelectorAll(s)];

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Centavos → "Bs 25" o "Bs 25,50". */
export const bs = (cents) => "Bs " + (cents / 100).toLocaleString("es-BO", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 });
/** "25" o "25,50" → centavos. */
export const toCents = (v) => Math.round(parseFloat(String(v).replace(",", ".")) * 100);

export const fdate = (t) => new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
export const fdt = (t) => new Date(t).toLocaleString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
export const daysLeft = (t) => Math.ceil((t - Date.now()) / 86_400_000);

export const icon = (name, cls = "i") => `<svg class="${cls}"><use href="/icons.svg#i-${name}"/></svg>`;

let toastTimer;
export function toast(text) {
  const el = $("#toast");
  el.textContent = text;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 3200);
}

/** Lee un archivo del input como base64 (sin el prefijo data:). Máx. 5 MB. */
export function fileToBase64(file) {
  return new Promise((ok, fail) => {
    if (!file) return fail(new Error("Elegí el archivo del comprobante"));
    if (file.size > 5 * 1024 * 1024) return fail(new Error("El archivo pesa más de 5 MB"));
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1]);
    r.onerror = () => fail(new Error("No se pudo leer el archivo"));
    r.readAsDataURL(file);
  });
}

export const waLink = (phoneDigits, text) => `https://wa.me/${String(phoneDigits).replace(/\D/g, "")}?text=${encodeURIComponent(text)}`;

export const newKey = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random());

export const STATUS_TEXT = {
  awaiting_payment: "Esperando pago", payment_review: "En revisión", fulfilled: "Entregado",
  rejected: "Rechazado", expired: "Vencido", cancelled: "Cancelado",
};
export const KIND_TEXT = { sale: "Compra", renewal: "Renovación", topup: "Recarga" };
