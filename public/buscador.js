// 🔎 Buscador del panel (etapa 3 del panel ordenado). Se abre con el botón "Buscar" de arriba, con la tecla "/"
// en la computadora o desde el buscador de Inicio. Busca en el servidor (/api/admin/search), que solo devuelve lo
// que tu rol puede ver, y cada resultado abre la pantalla de siempre, ya filtrada.
import { api, esc, icon } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/buscador.css"]')) {
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/buscador.css";
  document.head.appendChild(l);
}

const ICON = { customer: "👤", reseller: "🏪", service: "📺", account: "🔑", order: "🧾" };
let timer = null, seq = 0, lastQ = "", opener = null, nav = null;

/** `navigate(kind, item, q)` lo pone panel.js: sabe cómo abrir cada pantalla. */
export function initSearch(navigate) { nav = navigate; }

export function openSearch(q = "") {
  closeSearch();
  opener = document.activeElement;
  const el = document.createElement("div");
  el.className = "gs-scrim"; el.id = "gsearch";
  el.innerHTML = `<div class="gs-box" role="dialog" aria-modal="true" aria-label="Buscar en el panel">
    <div class="gs-top"><input id="gsInput" type="search" autocomplete="off" placeholder="🔎 Cliente, teléfono, correo de cuenta, perfil o pedido…" aria-label="Buscar" value="${esc(q)}">
    <button type="button" class="gs-close" data-gsclose="1" aria-label="Cerrar">✕</button></div>
    <div class="gs-out" id="gsOut" aria-live="polite"><p class="gs-hint">Escribí al menos 2 letras o 4 números.</p></div></div>`;
  // Dentro de #app, así toma los colores del tema (claro u oscuro) del panel.
  (document.getElementById("app") ?? document.body).appendChild(el);
  const inp = el.querySelector("#gsInput");
  inp.addEventListener("input", () => { clearTimeout(timer); timer = setTimeout(() => run(inp.value), 220); });
  inp.addEventListener("keydown", (ev) => { if (ev.key === "Enter") { ev.preventDefault(); el.querySelector("[data-gsitem]")?.click(); } });
  el.addEventListener("click", (ev) => { if (ev.target === el || ev.target.closest("[data-gsclose]")) closeSearch(); });
  inp.focus();
  if (q) run(q);
}

export function closeSearch() {
  const el = document.getElementById("gsearch");
  if (!el) return;
  el.remove();
  if (opener && document.contains(opener)) opener.focus();
}

async function run(raw) {
  const q = raw.trim(); lastQ = q;
  const out = document.getElementById("gsOut");
  if (!out) return;
  if (q.length < 2) { out.innerHTML = `<p class="gs-hint">Escribí al menos 2 letras o 4 números.</p>`; return; }
  const my = ++seq;
  out.innerHTML = `<p class="gs-hint">Buscando…</p>`;
  const r = await api("GET", "/api/admin/search?q=" + encodeURIComponent(q)).catch((e) => ({ error: e.message }));
  if (my !== seq || !document.getElementById("gsOut")) return;
  if (r.error) { out.innerHTML = `<p class="gs-hint">No se pudo buscar: ${esc(r.error)}</p>`; return; }
  const svc = r.groups.some((g) => g.key === "services");
  out.innerHTML = r.groups.length
    ? r.groups.map((g) => `<section class="gs-group"><h3>${esc(g.label)}</h3>${g.items.map((it) => `<button type="button" class="gs-item" data-gsitem="${esc(it.kind)}" data-id="${esc(it.id)}" data-q="${esc(it.q)}">
        <span class="gs-ic" aria-hidden="true">${ICON[it.kind] ?? "•"}</span><span class="gs-tx"><b>${esc(it.title)}</b><small>${esc(it.sub)}</small></span>${icon("arrow")}</button>`).join("")}
        ${g.more ? `<p class="gs-more">y ${g.more} más: escribí algo más preciso${g.key === "services" ? " o abrí todo en el Control" : ""}.</p>` : ""}</section>`).join("")
      + (svc ? `<button type="button" class="pbtn gs-all" data-gsitem="control" data-q="${esc(q)}">📊 Ver todo en el Control de alquileres</button>` : "")
    : `<p class="gs-hint">No encontré nada con «${esc(q)}». Probá con el nombre, los últimos números del teléfono o el correo de la cuenta.</p>`;
}

if (typeof document !== "undefined") {
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest("[data-gsitem]");
    if (!b || !nav) return;
    const kind = b.dataset.gsitem, id = b.dataset.id, q = b.dataset.q || lastQ;
    closeSearch();
    nav(kind, id, q);
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && document.getElementById("gsearch")) { ev.preventDefault(); closeSearch(); return; }
    const t = ev.target, typing = t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName));
    if (ev.key === "/" && !typing && !ev.ctrlKey && !ev.metaKey && !ev.altKey && document.getElementById("app") && !document.getElementById("app").hidden) { ev.preventDefault(); openSearch(); }
  });
}
