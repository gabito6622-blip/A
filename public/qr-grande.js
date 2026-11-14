/**
 * QR de cobro grande (14/11/2026). Un cliente le dijo al dueño que el QR «estaba muy chico» (120 px al costado del
 * texto). Además, quien compra desde el celular no puede escanear su propia pantalla: necesita GUARDAR el QR y abrirlo
 * desde la app del banco («Pagar con QR → elegir de la galería»). Este módulo dibuja el QR a lo ancho, con:
 *   - 🔍 Ver grande: lo abre a pantalla completa sobre fondo blanco (para escanear desde otro celular);
 *   - 📥 Guardar QR: lo baja a la galería con un nombre claro;
 *   - 📋 Copiar monto: copia solo el número («99») para pegarlo en la app del banco sin escribirlo (pedido del dueño);
 *   - los 3 pasos para pagar desde el mismo celular y el monto exacto a pegar, SIEMPRE a la vista y con números grandes
 *     (antes estaban en un desplegable sin flecha y nadie los abría; revisión «en el lugar de ~30 clientes», 14/11);
 *   - 📤 Mandar a quien paga: para el chico que no tiene banco y le pide a la mamá que pague. Comparte la imagen del QR
 *     con un texto (monto, qué es, a quién pagar y «mandame la foto del comprobante»); si el celular no puede
 *     compartir imágenes, abre WhatsApp con el texto y el link del QR.
 * Funciona con afiches (imagen vertical u horizontal): nunca se recorta ni se estira.
 */

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const fileName = (who) => `QR-${String(who || "pago").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "") || "pago"}.jpg`;

/**
 * La tarjeta del QR. `src` es la ruta de la imagen; `amount` (texto ya formateado, p. ej. «Bs 99») es opcional;
 * `amountValue` (centavos) habilita «Copiar monto»; `who` es a nombre de quién (para el nombre del archivo y el texto
 * alternativo); `note` una línea extra opcional; `share` ({ what }) agrega «📤 Mandar a quien paga» (`what`: qué se paga).
 */
export function qrCard({ src, who = "", amount = "", amountValue = null, note = "", share = null }) {
  const num = amountNumber(amountValue);
  const alt = `QR de cobro${who ? ` de ${who}` : ""}`;
  return `<div class="qrg">
    <button class="qrg-img" type="button" data-qrzoom="${esc(src)}" data-qrname="${esc(fileName(who))}" aria-label="Ver el QR en grande">
      <img src="${esc(src)}" alt="${esc(alt)}" loading="lazy" decoding="async">
    </button>
    ${amount ? `<div class="qrg-amtrow"><p class="qrg-amt">Pagá exactamente <b>${esc(amount)}</b></p>${num ? `<button class="sbtn qrg-copy" type="button" data-qrcopy="${esc(num)}" aria-label="Copiar el monto ${esc(num)}">📋 Copiar monto</button>` : ""}</div>` : ""}
    <div class="qrg-btns">
      <button class="sbtn" type="button" data-qrzoom="${esc(src)}" data-qrname="${esc(fileName(who))}">🔍 Ver grande</button>
      <a class="sbtn" href="${esc(src)}" download="${esc(fileName(who))}" data-qrsave="1">📥 Guardar QR</a>
    </div>
    <div class="qrg-steps"><p>¿Pagás desde este mismo celular?</p>
      <ol><li><span>Tocá <b>📥 Guardar QR</b> (queda en tu galería).</span></li><li><span>Abrí la app de tu banco → <b>Pagar con QR</b> → elegí la imagen de la galería.</span></li><li><span>${num ? `Tocá <b>📋 Copiar monto</b> y pegalo` : "Escribí el monto exacto"}${amount ? ` (<b>${esc(amount)}</b>)` : ""} y pagá.</span></li></ol>
    </div>
    ${share ? `<button class="sbtn qrg-share" type="button" data-qrshare="${esc(shareText({ who, amount, what: share.what }))}" data-qrsrc="${esc(src)}" data-qrname="${esc(fileName(who))}">📤 Mandar a quien paga</button>
    <p class="qrg-sharenote">¿Te lo paga otra persona? Mandale el QR con el monto y lo que es.</p>` : ""}
    ${note ? `<p class="qrg-note">${note}</p>` : ""}
  </div>`;
}

/** El texto para quien paga por vos (sin el link del QR: se agrega solo si no se puede mandar la imagen). */
export function shareText({ who = "", amount = "", what = "" }) {
  return [
    "Hola 👋 ¿Me ayudás a pagar esto?",
    what ? `🛒 ${what}` : "",
    amount ? `💵 Monto exacto: ${amount}` : "",
    who ? `👤 Se paga a: ${who}, con el QR que te mando.` : "👤 Se paga con el QR que te mando.",
    "Cuando pagues, mandame la foto del comprobante, porfa 🙏",
  ].filter(Boolean).join("\n");
}

/** Comparte la imagen del QR con el texto; si no se puede, WhatsApp con el texto y el link del QR. */
async function share(btn) {
  const text = btn.dataset.qrshare, src = btn.dataset.qrsrc;
  const link = new URL(src, location.href).href;
  try {
    if (navigator.share && navigator.canShare) {
      const r = await fetch(src, { credentials: "same-origin" });
      if (r.ok) {
        const blob = await r.blob();
        const file = new File([blob], btn.dataset.qrname || "QR.jpg", { type: blob.type || "image/jpeg" });
        if (navigator.canShare({ files: [file] })) { await navigator.share({ files: [file], text }); return "image"; }
      }
    }
  } catch (e) { if (e?.name === "AbortError") return "cancel"; }
  const withLink = `${text}\n\nEl QR está acá: ${link}`;
  window.open(`https://wa.me/?text=${encodeURIComponent(withLink)}`, "_blank", "noopener");
  return "whatsapp";
}

/** El monto como lo pide la app del banco: solo el número, sin «Bs» ni separador de miles («99» o «99.50»). */
export function amountNumber(cents) {
  const c = Number(cents);
  if (!Number.isFinite(c) || c <= 0) return "";
  return c % 100 === 0 ? String(c / 100) : (c / 100).toFixed(2);
}

async function copy(btn) {
  const text = btn.dataset.qrcopy;
  let ok = true;
  try { await navigator.clipboard.writeText(text); }
  catch {
    try {
      const t = Object.assign(document.createElement("textarea"), { value: text });
      t.setAttribute("readonly", ""); t.style.position = "fixed"; t.style.opacity = "0";
      document.body.append(t); t.select(); ok = document.execCommand("copy"); t.remove();
    } catch { ok = false; }
  }
  const was = btn.dataset.label ?? btn.textContent;
  btn.dataset.label = was;
  btn.textContent = ok ? `✅ Copiado: ${text}` : `Copialo a mano: ${text}`;
  btn.classList.toggle("ok", ok);
  clearTimeout(btn._t);
  btn._t = setTimeout(() => { btn.textContent = was; btn.classList.remove("ok"); }, 2500);
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
    const sh = ev.target.closest?.("[data-qrshare]");
    if (sh) { ev.preventDefault(); await share(sh); return; }
    const c = ev.target.closest?.("[data-qrcopy]");
    if (c) { ev.preventDefault(); await copy(c); return; }
    if (ev.target.closest?.("[data-qrclose]") || (opened && ev.target === opened)) { ev.preventDefault(); close(); return; }
    const s = ev.target.closest?.("[data-qrsave]");
    if (s) { ev.preventDefault(); if (!(await save(s))) window.open(s.getAttribute("href"), "_blank", "noopener"); }
  });
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape") close(); });
}
