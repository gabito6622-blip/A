// Editor de «Mi página» del revendedor (GaboHub → Más → Mi vitrina → Mi página), del lado del navegador (17/11/2026):
//  - Secciones plegables (Marca, Colores y diseño, Portada, Productos, Publicar) que recuerdan si estaban abiertas.
//  - Paletas sugeridas tocables: cambian los colores del formulario y la vista previa al instante, SIN guardar.
//    Cada paleta avisa si su color principal se lee poco sobre el fondo (contrastNote de common.js).
//  - En celular y tablet, «👁 Ver cómo queda» abre la vista previa a pantalla completa (Escape o «Volver» la cierra).
// shop.js arma el formulario con estas piezas; los datos son solo los de la página del revendedor que entró.
import { esc, THEMES, contrastNote } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/editor-pagina.css"]')) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/editor-pagina.css"; document.head.append(l);
}

/** Qué secciones están abiertas (sobrevive a los render() de shop.js). */
const OPEN = { marca: true, colores: true };

/** Una sección plegable del editor. */
export function edSec(id, icon, title, hint, body) {
  return `<details class="edsec" data-edsec="${id}" ${OPEN[id] ? "open" : ""}><summary><span class="edsec-i" aria-hidden="true">${icon}</span><span class="edsec-t"><b>${esc(title)}</b>${hint ? `<small>${esc(hint)}</small>` : ""}</span><i class="edsec-c" aria-hidden="true">›</i></summary><div class="edsec-b">${body}</div></details>`;
}

const same = (a, b) => String(a || "").toLowerCase() === String(b || "").toLowerCase();

/** Paletas sugeridas (los colores de los estilos listos), con aviso de contraste en cada una. */
export function paletteRow(sh) {
  const seen = new Set();
  const list = THEMES.filter((t) => { const k = `${t.look.backgroundColor}${t.look.accentColor}`.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  return `<div class="edpal" role="group" aria-label="Paletas sugeridas">${list.map((t) => {
    const n = contrastNote(t.look), on = same(sh.backgroundColor, t.look.backgroundColor) && same(sh.accentColor, t.look.accentColor) && same(sh.accent2Color, t.look.accent2Color);
    return `<button type="button" class="edpal-b" data-rpal="${esc(t.id)}" aria-pressed="${on}"><span class="edpal-s" style="background:${esc(t.look.backgroundColor)}" aria-hidden="true"><i style="background:${esc(t.look.accentColor)}"></i><i style="background:${esc(t.look.accent2Color)}"></i></span><span>${esc(t.name.replace(/ [✨⭐]$/u, ""))}${n.cls === "warn" ? `<small>⚠️ se lee poco</small>` : ""}</span></button>`;
  }).join("")}</div>`;
}

/** Botón de la barra fija: abre la vista previa a pantalla completa (en PC ya está al lado). */
export const previewBtn = () => `<button class="sbtn edpv-open" type="button" data-pvfull="1" aria-controls="edPreview">👁 Ver cómo queda</button>`;
/** Botón para cerrar la vista previa a pantalla completa. */
export const previewClose = () => `<button class="sbtn sm edpv-close" type="button" data-pvclose="1">← Volver a editar</button>`;

let opener = null;
function closeFull() {
  const p = document.getElementById("edPreview");
  if (!p?.classList.contains("full")) return false;
  p.classList.remove("full"); p.removeAttribute("role"); p.removeAttribute("aria-modal");
  document.documentElement.classList.remove("edpv-lock");
  (opener?.isConnected ? opener : document.querySelector("[data-pvfull]"))?.focus();
  return true;
}

if (typeof document !== "undefined") {
  document.addEventListener("toggle", (ev) => {
    const d = ev.target;
    if (d?.dataset?.edsec) OPEN[d.dataset.edsec] = d.open;
  }, true);
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-rpal],[data-pvfull],[data-pvclose]");
    if (!b) return;
    ev.stopPropagation();
    if (b.dataset.rpal) {
      // Solo cambia el formulario: la vista previa se entera por el evento input (shop.js) y se guarda con «Guardar».
      const t = THEMES.find((x) => x.id === b.dataset.rpal), f = document.getElementById("shopForm");
      if (!t || !f) return;
      for (const k of ["accentColor", "accent2Color", "backgroundColor"]) {
        const el = f.elements[k];
        if (el) { el.value = t.look[k]; el.dispatchEvent(new Event("input", { bubbles: true })); }
      }
      document.querySelectorAll("[data-rpal]").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
      const n = document.getElementById("edDirty"); if (n) n.hidden = false;
      return;
    }
    if (b.dataset.pvclose) { closeFull(); return; }
    const p = document.getElementById("edPreview");
    if (!p) return;
    opener = b;
    p.classList.add("full"); p.setAttribute("role", "dialog"); p.setAttribute("aria-modal", "true");
    document.documentElement.classList.add("edpv-lock");
    p.querySelector("[data-pvclose]")?.focus();
  }, true);
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && closeFull()) ev.stopPropagation(); }, true);
  // Cualquier cambio en el formulario: aviso «sin guardar» al lado del botón.
  document.addEventListener("input", (ev) => {
    if (ev.target?.form?.id !== "shopForm") return;
    const n = document.getElementById("edDirty"); if (n) n.hidden = false;
  }, true);
}
