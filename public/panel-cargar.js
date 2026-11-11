// 📋 Cargar sus cuentas: en la ficha del revendedor, pegar la lista de cuentas que ya le vendiste
// (por WhatsApp) y anotarlas todas de una. Vista previa primero; recién "Guardar" las anota.
// No cobra nada ni le manda ningún mensaje. Solo dueño y admin (el servidor responde 403 a los demás).
import { api, esc, bs } from "/common.js";
import { usd } from "/usd.js";

// Estado del cuadro (uno solo: el de la ficha abierta).
const C = { id: "", name: "", open: false, text: "", prev: null, err: "", busy: false, done: null };
let refresh = async () => {};

// Fecha de Bolivia (el servidor guarda las 23:59 de La Paz): dd/mm, con el año solo si no es este.
const TZ = { timeZone: "America/La_Paz" };
const yearOf = (t) => new Date(t).toLocaleDateString("es-BO", { ...TZ, year: "numeric" });
const ddmm = (t) => new Date(t).toLocaleDateString("es-BO", { ...TZ, day: "2-digit", month: "2-digit", ...(yearOf(t) === yearOf(Date.now()) ? {} : { year: "numeric" }) });
const money = (cents, cur) => (cents === undefined ? "" : cur === "USD" ? usd(cents) : bs(cents));

function rowsHtml(p) {
  const tr = (r) => `<tr class="${r.ok ? "cg-ok" : "cg-bad"}">
      <td data-label="Estado"><div class="cg-c">${r.ok ? `<span aria-hidden="true">✅</span> Se carga` : `<span aria-hidden="true">⚠️</span> ${esc(r.reason || "No se carga")}`}${r.warnings.map((w) => `<small class="cg-warn">⚠️ ${esc(w)}</small>`).join("")}</div></td>
      <td data-label="Cuenta"><div class="cg-c"><span class="mono">${esc(r.email || "—")}</span><small class="muted">Línea ${r.line}</small></div></td>
      <td data-label="Servicio"><div class="cg-c">${esc(r.product || "—")}${r.profile ? `<small class="muted">${esc(r.profile)}</small>` : ""}</div></td>
      <td data-label="Vence"><div class="cg-c">${r.expiresAt ? `${ddmm(r.expiresAt)}${r.defaultDate ? `<small class="muted">sin fecha: desde hoy</small>` : ""}` : "—"}</div></td>
      <td data-label="Precio"><div class="cg-c">${r.price !== undefined ? money(r.price, p.currency) : "—"}</div></td></tr>`;
  return `<div class="cg-sum" role="status"><b>✅ ${p.ok} para cargar</b>${p.skipped ? ` · <b class="cg-skip">⚠️ ${p.skipped} no</b>` : ""}</div>
    <div class="cg-tablewrap"><table class="cg-table"><caption class="sr-only">Vista previa de la lista</caption>
      <thead><tr><th scope="col">Estado</th><th scope="col">Cuenta</th><th scope="col">Servicio</th><th scope="col">Vence</th><th scope="col">Precio</th></tr></thead>
      <tbody>${p.rows.map(tr).join("")}</tbody></table></div>
    <div class="inline">${p.ok ? `<button class="pbtn dark" type="button" data-cg="save"${C.busy ? " disabled" : ""}>💾 Guardar ${p.ok} cuenta${p.ok === 1 ? "" : "s"}</button>` : `<span class="muted">No hay cuentas nuevas para cargar.</span>`}
      <button class="pbtn" type="button" data-cg="edit">✏️ Corregir la lista</button></div>`;
}

function html() {
  if (!C.id) return "";
  if (!C.open) {
    const done = C.done ? `<p class="cg-done" role="status">✅ Listo: ${C.done.added} cuenta${C.done.added === 1 ? "" : "s"} cargada${C.done.added === 1 ? "" : "s"}${C.done.skipped ? ` · ${C.done.skipped} saltada${C.done.skipped === 1 ? "" : "s"}` : ""}. No se le cobró ni se le avisó nada.</p>` : "";
    return `<div class="cg" id="cgBox">${done}<button class="pbtn" type="button" data-cg="open">📋 Cargar sus cuentas</button></div>`;
  }
  const first = C.name.split(" ")[0];
  return `<div class="cg cg-open" id="cgBox"><h3>📋 Cargar cuentas que ya le vendiste a ${esc(first)}</h3>
    <p class="muted">Una cuenta por línea: <b>correo</b>, fecha de vencimiento (<b>dd/mm</b>) y <b>precio</b>. La fecha y el precio son opcionales: sin fecha vence en la duración del servicio desde hoy. No se le cobra nada ni se le manda ningún mensaje.</p>
    ${C.prev ? rowsHtml(C.prev) : `<label for="cgText">Lista de ${esc(first)}</label>
    <textarea id="cgText" rows="7" spellcheck="false" autocapitalize="off" autocomplete="off" aria-describedby="cgErr" placeholder="disney1@correo.com 15/12 25&#10;flujo2@correo.com 20/12&#10;prime3@correo.com">${esc(C.text)}</textarea>
    <p id="cgErr" class="cg-err" role="alert">${esc(C.err)}</p>
    <div class="inline"><button class="pbtn dark" type="button" data-cg="preview"${C.busy ? " disabled" : ""}>👀 Ver cómo queda</button><button class="pbtn" type="button" data-cg="close">Cancelar</button></div>`}
    ${C.prev && C.err ? `<p class="cg-err" role="alert">${esc(C.err)}</p>` : ""}</div>`;
}

function redraw() {
  const el = document.getElementById("cgBox");
  if (el) el.outerHTML = html();
}

/** Cuadro para la ficha del revendedor. `canDo`: solo dueño y admin. `onSaved`: vuelve a dibujar la ficha. */
export function cargarCard(fs, canDo, onSaved) {
  if (!fs || !canDo) return "";
  if (C.id !== fs.id) Object.assign(C, { id: fs.id, open: false, text: "", prev: null, err: "", busy: false, done: null });
  C.name = fs.name;
  if (onSaved) refresh = onSaved;
  return html();
}

const path = () => `/api/admin/customers/${encodeURIComponent(C.id)}/bulk-assign`;

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest?.("button[data-cg]");
  if (!b || !C.id) return;
  const act = b.dataset.cg;
  const ta = document.getElementById("cgText");
  if (ta) C.text = ta.value;
  if (act === "open") Object.assign(C, { open: true, prev: null, err: "", done: null });
  if (act === "close") Object.assign(C, { open: false, prev: null, err: "" });
  if (act === "edit") Object.assign(C, { prev: null, err: "" });
  if (act === "preview") {
    if (!C.text.trim()) { C.err = "Pegá al menos una cuenta (una por línea)"; redraw(); return document.getElementById("cgText")?.focus(); }
    C.busy = true; C.err = ""; redraw();
    try { C.prev = await api("POST", path() + "/preview", { text: C.text }); } catch (e) { C.err = e.message; }
    C.busy = false;
  }
  if (act === "save") {
    C.busy = true; C.err = ""; redraw();
    try {
      const r = await api("POST", path(), { text: C.text });
      Object.assign(C, { open: false, prev: null, text: "", done: { added: r.added, skipped: r.skipped.length } });
      C.busy = false;
      await refresh();
      return document.getElementById("cgBox")?.scrollIntoView({ block: "nearest" });
    } catch (e) { C.err = e.message; }
    C.busy = false;
  }
  redraw();
  if (act === "open" || act === "edit") document.getElementById("cgText")?.focus();
});
