// GaboHub: «Cambió la cuenta: avisá a tus N clientes» (revisión de 3 meses, 14/11/2026). Cuando la tienda mueve o
// marca caída una cuenta completa que el revendedor alquila, en ESA cuenta aparece un cartel con sus clientes anotados
// (su cuaderno) y un botón de WhatsApp por cada uno. Solo lo suyo: el servidor (avisoCambios.ts → accountChanges) filtra
// por la sesión; acá no se ve nada de otros revendedores, ni costos.
// R2 (14/11): también cuando la tienda cambia la CLAVE o el CORREO, y los servicios de SUS clientes (falla resuelta con
// otra cuenta). El cartel sale en Inicio y en «Mis cuentas» (no solo en Repartir perfiles), con «📋 Copiar clave nueva»
// y un mensaje por cliente que ya lleva el correo y la clave nuevos. La clave NO viene en el aviso: se toma de los
// servicios que GaboHub ya cargó para «Mis cuentas» (/api/me/services).
import { api, esc, fdate, waLink, toast } from "/common.js";

let data = null, at = 0, loading = null, rerender = () => {}, services = () => [];
const TTL = 60_000;

/** Una vez, desde shop.js: cómo volver a pintar cuando llegan los datos y de dónde sacar los accesos («Mis cuentas»). */
export function initAccChanges(render, opts = {}) {
  rerender = render;
  if (opts.services) services = opts.services;
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest?.("button[data-accchgseen]");
    if (!b) return;
    b.disabled = true;
    try {
      await api("POST", `/api/me/account-changes/${encodeURIComponent(b.dataset.accchgseen)}/seen`, {});
      data = (data ?? []).filter((x) => x.assignmentId !== b.dataset.accchgseen);
      toast("✓ Listo, ya les avisaste");
      rerender();
    } catch (e) { toast(e.message); b.disabled = false; }
  });
}
function ensure() {
  if (loading || (data && Date.now() - at < TTL)) return;
  loading = api("GET", "/api/me/account-changes").then((d) => { data = Array.isArray(d) ? d : []; at = Date.now(); }, () => { data = data ?? []; at = Date.now(); })
    .finally(() => { loading = null; rerender(); });
}
const first = (n) => String(n ?? "").trim().split(/\s+/)[0] || "";
/** Los datos de acceso actuales de ese servicio, como los muestra «Mis cuentas». */
const accessOf = (x) => (services() ?? []).find((s) => s.assignmentId === x.assignmentId)?.access ?? null;

/** El mensaje para SU cliente: con los datos nuevos (correo, clave y, si es un perfil, perfil y PIN). */
export function changeMsg(c, x, acc = accessOf(x)) {
  if (x.kind === "fallen") return `Hola ${first(c.name)} 👋 Te aviso que se cayó la cuenta de tu ${x.product}. Ya la estamos cambiando: en cuanto esté te paso los datos nuevos. Tu fecha no cambia 🙌`;
  const what = { moved: "cambió la cuenta", password: "cambió la clave", email: "cambió el correo", pin: "cambió el PIN", access: "cambiaron los datos" }[x.kind] ?? "cambiaron los datos";
  const lines = acc && !acc.passwordPending ? [`Correo: ${acc.email}`, `Contraseña: ${acc.password}`] : [`Correo: ${x.email}`];
  // Cuenta completa: el perfil es el que le diste vos (tu cuaderno). Perfil suelto: el de la tienda, con su PIN.
  if (x.full) { if (c.label) lines.push(`Tu perfil: ${c.label} (sigue igual)`); }
  else if (acc) { lines.push(`Perfil: ${acc.profile}`); if (acc.pin) lines.push(`PIN: ${acc.pin}`); }
  return `Hola ${first(c.name)} 👋 Te aviso que ${what} de tu ${x.product}. Tus datos nuevos:\n${lines.join("\n")}\nTu fecha sigue igual 🙌`;
}

function box(x, inCard) {
  const n = x.clients.length, acc = x.kind === "fallen" ? null : accessOf(x);
  const icon = x.kind === "fallen" ? "⚠️" : "🔁";
  const sub = x.kind === "fallen" ? `La tienda la está cambiando (${fdate(x.at)}). Tus clientes siguen con su fecha.`
    : `${x.kind === "moved" ? `Ahora es ${esc(x.email)}` : `Cuenta ${esc(x.email)}`} (${fdate(x.at)}). ${x.forClient ? "Mandale los datos nuevos." : "Tus clientes siguen con su perfil y su fecha."}`;
  const copy = acc && !acc.passwordPending ? `<button class="sbtn sm" type="button" data-copy="${esc(acc.password)}" aria-label="Copiar clave nueva de ${esc(x.product)}">📋 Copiar clave nueva</button>` : "";
  return `<div class="sbox rcwarn accchg" role="status" data-accchg="${esc(x.assignmentId)}"><h3 style="margin:0">${icon} ${esc(inCard ? x.title.replace(/ de tu [^:]+/, "") : x.title)}</h3><p class="empty" style="margin:0">${sub}</p>
    ${n ? `<div class="rcsoon">${x.clients.map((c) => `<div class="rcsoon-r"><span><b>${esc(c.name)}</b><small>${esc(c.label || "Perfil")}</small></span>${c.phone ? `<a class="sbtn sm pri" href="${waLink(c.phone, changeMsg(c, x, acc))}" target="_blank" rel="noopener">💬 Avisar</a>` : `<small class="empty">sin WhatsApp</small>`}</div>`).join("")}</div>` : `<p class="empty" style="margin:0">No tenés clientes anotados en esta cuenta.</p>`}
    <div class="rbtns">${copy}<button class="sbtn sm" type="button" data-accchgseen="${esc(x.assignmentId)}">✓ Ya les avisé</button></div></div>`;
}

/** Cartel dentro de la tarjeta de la cuenta alquilada `r` (de /api/me/subs, «Repartir perfiles»). Vacío si no cambió nada. */
export function accChangeBox(r) {
  ensure();
  const x = (data ?? []).find((c) => c.assignmentId === r.assignmentId);
  return x ? box(x, true) : "";
}

/** Inicio y «Mis cuentas»: todos los cambios sin avisar todavía (los suyos y los de sus clientes). */
export function accChangesBanner() {
  ensure();
  const l = data ?? [];
  return l.length ? `<div class="accchgs">${l.map((x) => box(x, false)).join("")}</div>` : "";
}
