/**
 * QR de cobro grande (14/11/2026). Un cliente le dijo al dueño que el QR «estaba muy chico» (120 px al costado del
 * texto). Además, quien compra desde el celular no puede escanear su propia pantalla: necesita GUARDAR el QR y abrirlo
 * desde la app del banco («Pagar con QR → elegir de la galería»). Este módulo dibuja el QR a lo ancho, con:
 *   - 🔍 Ver grande: lo abre a pantalla completa sobre fondo blanco (para escanear desde otro celular);
 *   - 📥 Guardar QR: lo baja a la galería con un nombre claro;
 *   - los 3 pasos para pagar desde el mismo celular y el monto exacto a escribir.
 * Funciona con afiches (imagen vertical u horizontal): nunca se recorta ni se estira.
 */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fileName = (who) => `QR-${String(who || "pago").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pago"}.jpg`;

/**
 * La tarjeta del QR. `src` es la ruta de la imagen; `amount` (texto ya formateado, p. ej. «Bs 99») es opcional;
 * `who` es a nombre de quién (para el nombre del archivo y el texto alternativo); `note` una línea extra opcional.
 */
export function qrCard({ src, who = "", amount = "", note = "" }) {
  const alt = `QR de cobro${who ? ` de ${who}` : ""}`;
  return `<div class="qrg">
    <button class="qrg-img" type="button" data-qrzoom="${esc(src)}" data-qrname="${esc(fileName(who))}" aria-label="Ver el QR en grande">
      <img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">
    </button>
    ${amount ? `<p class="qrg-amt">Pagá exactamente <b>${esc(amount)}</b></p>` : ""}
    <div class="qrg-btns">
      <button class="sbtn" type="button" data-qrzoom="${esc(src)}" data-qrname="${esc(fileName(who))}">🔍 Ver grande</button>
      <a class="sbtn" href="${esc(src)}" download="${esc(fileName(who))}" data-qrsave="1">📥 Guardar QR</a>
    </div>
    <details class="qrg-how"><summary>¿Pagás desde este mismo celular?</summary>
      <ol><li>Tocá <b>📥 Guardar QR</b> (queda en tu galería).</li><li>Abrí la app de tu banco → <b>Pagar con QR</b> → elegí la imagen de la galería.</li><li>Escribí ${amount ? `<b>${esc(amount)}</b>` : "el monto exacto"} y pagá.</li></ol>
    </details>
    ${note ? `<p class="qrg-note">${note}</p>` : ""}
  </div>`;
}

let opened = null;
function close() {
  if (!opened) return;
  opened.remove(); opened = null;
  document.documentElement.classList.remove("qrg-lock");
}
function open(src, name) {
  close();
  const d = document.createElement("div");
  d.className = "qrg-full";
  d.setAttribute("role", "dialog");
  d.setAttribute("aria-modal", "true");
  d.setAttribute("aria-label", "QR en grande");
  d.innerHTML = `<img src="${esc(src)}" alt="QR de cobro en grande">
    <div class="qrg-fbtns"><a class="sbtn pri" href="${esc(src)}" download="${esc(name)}" data-qrsave="1">📥 Guardar QR</a><button class="sbtn" type="button" data-qrclose="1">✕ Cerrar</button></div>
    <p>Subí el brillo de la pantalla si lo escanean desde otro celular.</p>`;
  document.body.append(d);
  document.documentElement.classList.add("qrg-lock");
  opened = d;
  d.querySelector("[data-qrclose]").focus();
}

/** Guarda la imagen con su nombre aunque el navegador ignore «download» (lo baja como archivo). */
async function save(a) {
  try {
    const r = await fetch(a.getAttribute("href"), { credentials: "same-origin" });
    if (!r.ok) throw new Error("sin imagen");
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const t = document.createElement("a");
    t.href = url; t.download = a.getAttribute("download") || "QR.jpg";
    document.body.append(t); t.click(); t.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    return true;
  } catch { return false; }
}

/** Escucha los botones. Llamarlo una vez al cargar la página. */
export function initQrGrande() {
  document.addEventListener("click", async (ev) => {
    const z = ev.target.closest?.("[data-qrzoom]");
    if (z) { ev.preventDefault(); open(z.dataset.qrzoom, z.dataset.qrname || "QR.jpg"); return; }
    if (ev.target.closest?.("[data-qrclose]") || (opened && ev.target === opened)) { ev.preventDefault(); close(); return; }
    const s = ev.target.closest?.("[data-qrsave]");
    if (s) { ev.preventDefault(); if (!(await save(s))) window.open(s.getAttribute("href"), "_blank", "noopener"); }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
}
