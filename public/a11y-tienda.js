// Accesibilidad de la tienda con lector de pantalla y teclado (revisión «en el lugar de ~30 clientes», 14/11/2026):
//  - Ventana «Acceder» (y cualquier ventana de #modal): el foco no se escapa con Tab / Mayús+Tab, Escape la cierra
//    (shop.js ya lo hacía) y al cerrarla el foco vuelve al botón que la abrió. La ventana se nombra con su título.
//  - Al cambiar de pantalla, el foco va al título de la pantalla nueva y se anuncia («Pantalla: Mis cuentas y pedidos»).
// shop.js solo llama a a11yView(S.view) después de dibujar.
const FOCUSABLE = 'a[href],button:not([disabled]),input:not([type=hidden]):not([disabled]),select:not([disabled]),textarea:not([disabled]),summary,[tabindex]:not([tabindex="-1"])';
let live = null, lastView = null, headAt = 0, opener = null, lastOutside = null;

function liveRegion() {
  if (live?.isConnected) return live;
  live = document.createElement("div");
  live.id = "a11yLive";
  live.className = "sr-only";
  live.style.cssText = "position:absolute;width:1px;height:1px;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0";
  live.setAttribute("role", "status");
  live.setAttribute("aria-live", "polite");
  document.body.append(live);
  return live;
}
const visible = (el) => !!(el.offsetWidth || el.offsetHeight || el.getClientRects().length) && !el.closest("[hidden]");
const modalOpen = () => { const m = document.getElementById("modal"); return !!m && !m.hidden; };

export function initA11y() {
  if (typeof document === "undefined") return;
  liveRegion();
  const m = document.getElementById("modal");
  document.addEventListener("focusin", (ev) => { if (m && !m.contains(ev.target)) lastOutside = ev.target; });
  // Tab y Mayús+Tab dan la vuelta dentro de la ventana abierta.
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Tab" || !modalOpen()) return;
    const list = [...m.querySelectorAll(FOCUSABLE)].filter(visible);
    if (!list.length) return;
    const first = list[0], last = list[list.length - 1], cur = document.activeElement;
    if (!m.contains(cur)) { ev.preventDefault(); (ev.shiftKey ? last : first).focus(); }
    else if (ev.shiftKey && cur === first) { ev.preventDefault(); last.focus(); }
    else if (!ev.shiftKey && cur === last) { ev.preventDefault(); first.focus(); }
  });
  if (!m) return;
  // Al abrir: la ventana toma el nombre de su título. Al cerrar: el foco vuelve a quien la abrió.
  new MutationObserver(() => {
    if (!m.hidden) {
      if (!opener) opener = lastOutside;
      const dlg = m.querySelector('[role="dialog"]'), h = dlg?.querySelector("h2,h3");
      if (dlg && h && !dlg.hasAttribute("aria-labelledby")) { h.id ||= "modalT"; dlg.setAttribute("aria-labelledby", h.id); }
    } else if (opener) {
      const o = opener; opener = null;
      if (o.isConnected && !modalOpen()) o.focus({ preventScroll: true });
    }
  }).observe(m, { attributes: true, attributeFilter: ["hidden"], childList: true });
}

/** Después de dibujar: si cambió la pantalla, foco al título y aviso para el lector de pantalla. */
export function a11yView(view) {
  if (typeof document === "undefined") return;
  const h = document.querySelector("#sout h1, #sout h2");
  if (lastView === null) { lastView = view; return; } // la primera carga no mueve el foco
  if (view !== lastView) {
    lastView = view;
    if (modalOpen() || !h) return;
    h.setAttribute("tabindex", "-1");
    h.focus({ preventScroll: true });
    headAt = Date.now();
    const r = liveRegion();
    r.textContent = "";
    setTimeout(() => { r.textContent = `Pantalla: ${h.textContent.replace(/\s+/g, " ").trim()}`; }, 60);
    return;
  }
  // La misma pantalla se volvió a dibujar con los datos: el título nuevo recupera el foco que tenía el viejo.
  if (h && Date.now() - headAt < 5000 && (document.activeElement === document.body || !document.activeElement?.isConnected) && !modalOpen()) {
    h.setAttribute("tabindex", "-1");
    h.focus({ preventScroll: true });
  }
}
