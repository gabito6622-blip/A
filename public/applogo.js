// Logos de las apps (Disney, Prime, HBO…) en las pantallas del revendedor.
// Usa la imagen que la tienda cargó en Productos (GET /api/products/:id/image). Si no hay, el cuadrito
// de color con la inicial de siempre. Los productos de alquiler ("Disney+ (alquiler revendedores)")
// suelen no tener imagen propia: toman la de la app del mismo nombre del catálogo.
import { esc } from "/common.js";

/** "Disney+ (alquiler revendedores)" / "Prime Video cuenta completa" → "disney+" / "primevideo". */
const baseName = (n) => String(n ?? "").toLowerCase()
  .replace(/\s*[([][^)\]]*[)\]]/g, " ")
  .replace(/\b(cuentas?\s+complet[ao]s?|alquiler(es)?|revendedor(es)?|perfil(es)?)\b/g, " ")
  .replace(/[^a-z0-9+ñ]/g, "");

/** Productos cuya imagen falló al cargar en esta visita: no se vuelve a pedir. */
const failed = new Set();
document.addEventListener("error", (ev) => {
  const img = ev.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.applogo) return;
  failed.add(img.dataset.applogo);
  const box = img.closest(".mini");
  if (box) { box.classList.remove("mimg"); box.textContent = box.dataset.ini || "?"; }
}, true);

/** El producto del catálogo que tiene el logo para esa app (el mismo id, o el del mismo nombre). */
export function logoProduct(catalog, id, name) {
  const list = catalog ?? [];
  const p = list.find((x) => x.id === id);
  if (p?.hasImage && !failed.has(p.id)) return p;
  const b = baseName(name ?? p?.name);
  return (b && list.find((x) => x.hasImage && x.kind !== "combo" && !failed.has(x.id) && baseName(x.name) === b)) || null;
}

/**
 * Cuadrito con el logo de la app. `cls`: "xs" (28 px) o "xxs" (20 px).
 * Decorativo (aria-hidden): al lado siempre va el nombre de la app escrito.
 */
export function appMark(catalog, id, name, cls = "xs") {
  const own = (catalog ?? []).find((x) => x.id === id);
  const nm = String(name ?? own?.name ?? "?").trim() || "?";
  const ini = esc(nm[0].toUpperCase());
  const p = logoProduct(catalog, id, nm);
  if (p) return `<span class="mini mimg ${cls}" aria-hidden="true" data-ini="${ini}"><img src="/api/products/${encodeURIComponent(p.id)}/image" alt="" loading="lazy" data-applogo="${esc(p.id)}"></span>`;
  return `<span class="mini ${cls}" aria-hidden="true" style="background:${esc(own?.color ?? colorFor(nm))}">${ini}</span>`;
}

/** Varios logos chiquitos en fila (sin repetir), p. ej. las apps de un cliente. */
export function appsRow(catalog, apps, max = 3) {
  const seen = new Set(), out = [];
  for (const a of apps ?? []) {
    const k = a.productId ?? a.product;
    if (seen.has(k)) continue;
    seen.add(k); out.push(appMark(catalog, a.productId, a.product, "xxs"));
    if (out.length >= max) break;
  }
  return out.length ? `<span class="appsrow" aria-hidden="true">${out.join("")}</span>` : "";
}

/** Color fijo para una app sin color cargado (siempre el mismo para el mismo nombre), con texto blanco legible. */
const PALETTE = ["#1e5be0", "#7c3aed", "#b42323", "#0f766e", "#b45309", "#be185d", "#334155"];
function colorFor(name) {
  let h = 0;
  for (const ch of name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[h % PALETTE.length];
}
