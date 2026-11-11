// "📩 Ver mi código de acceso" en el link de cobro (/c/<token>).
// Si el revendedor (y la tienda) lo permiten, el cliente toca el botón y ve el código que llegó al correo
// de SU cuenta en los últimos 30 minutos: solo el código, de qué servicio y hace cuánto. Nunca el correo
// ni la contraseña. Si no aplica, le dice que se lo pida a quien le vendió.
// cobro.js solo llama a codesCard(v); los eventos y la búsqueda están acá.
import { waDigits } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/cobro-codigos.css"]')) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/cobro-codigos.css"; document.head.append(l);
}

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const token = () => (typeof location !== "undefined" ? location.pathname.split("/").filter(Boolean)[1] ?? "" : "");
const KIND = { login: "🔓 Para iniciar sesión", hogar: "🏠 Para actualizar el hogar", temporal: "⏱️ Acceso temporal", verificacion: "🛡️ Verificación", otro: "✉️ Código" };
let who = "quien te vendió";

/** "hace 3 min" con el reloj del servidor (el del celular puede estar corrido). */
export function ago(at, now) {
  const m = Math.max(0, Math.floor((now - at) / 60_000));
  return m < 1 ? "recién" : m === 1 ? "hace 1 min" : `hace ${m} min`;
}
const hhmm = (t) => { const d = new Date(t); return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };

/** Recuadro para la página. `v` es la respuesta de /api/cobro/<token> (campo `codes`). */
export function codesCard(v) {
  who = v.seller || "quien te vendió";
  if (v.codes === "self") {
    return `<section class="card cc" aria-labelledby="ccT"><h2 id="ccT">¿Te pide un código para entrar?</h2>
      <p class="muted">Pedí el código en la app de ${esc(v.product)}, esperá un ratito y tocá el botón. Ves solo el de tu cuenta.</p>
      <button class="btn cc-btn" type="button" id="ccBtn">📩 Ver mi código de acceso</button>
      <div id="ccOut" class="cc-out" aria-live="polite"></div></section>`;
  }
  if (v.codes === "ask") {
    const wa = v.sellerWhatsapp ? `https://wa.me/${waDigits(v.sellerWhatsapp)}?text=${encodeURIComponent(`Hola, soy ${v.name}. Mi ${v.product} me pide un código para entrar.`)}` : "";
    return `<section class="card cc" aria-label="Código de acceso"><p><b>🔑 ¿Te pide un código para entrar?</b><br><span class="muted">Pedile el código a ${esc(who)}.</span></p>
      ${wa ? `<a class="btn btn-ghost" href="${esc(wa)}" target="_blank" rel="noopener noreferrer">💬 Pedir el código</a>` : ""}</section>`;
  }
  return "";
}

function list(j) {
  if (!j.codes.length) {
    return `<p class="cc-empty">Todavía no llegó ningún código en los últimos 30 minutos.<br>Pedilo en la app, esperá un minuto y tocá <b>Buscar de nuevo</b>.</p>`;
  }
  return j.codes.map((c) => `<div class="cc-code"><small>${esc(c.from)} · ${ago(c.at, j.now)} (${hhmm(c.at)})</small><span class="cc-kind">${KIND[c.kind] ?? KIND.otro}</span>
    ${c.code ? `<b class="cc-num">${esc(c.code)}</b><button class="btn btn-ghost" type="button" data-cccopy="${esc(c.code.replace(/\D/g, ""))}">📋 Copiar código</button>` : ""}
    ${c.link ? `<a class="btn btn-ghost" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">🔗 Abrir el enlace de ${esc(c.from)}</a>` : ""}</div>`).join("");
}

async function look(btn, out) {
  btn.disabled = true;
  btn.textContent = "Buscando…";
  try {
    const r = await fetch(`/api/cobro/${encodeURIComponent(token())}/codes`, { credentials: "omit" });
    const j = await r.json().catch(() => ({}));
    if (r.status === 404) { out.innerHTML = `<p class="cc-empty">Pedile el código a ${esc(who)}.</p>`; btn.remove(); return; }
    if (!r.ok) { out.innerHTML = `<p class="cc-err" role="alert">${esc(j.message || "No pudimos buscarlo. Probá de nuevo en un rato.")}</p>`; return; }
    out.innerHTML = list(j);
  } catch {
    out.innerHTML = `<p class="cc-err" role="alert">Revisá tu conexión a internet y probá de nuevo.</p>`;
  } finally {
    if (btn.isConnected) { btn.disabled = false; btn.textContent = "🔄 Buscar de nuevo"; }
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("click", async (ev) => {
    const btn = ev.target.closest?.("#ccBtn");
    if (btn) return look(btn, document.querySelector("#ccOut"));
    const cp = ev.target.closest?.("[data-cccopy]");
    if (!cp) return;
    try { await navigator.clipboard.writeText(cp.dataset.cccopy); cp.textContent = "✅ Copiado"; }
    catch { cp.textContent = `Código: ${cp.dataset.cccopy}`; }
  });
}
