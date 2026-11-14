// GaboHub: «Cambió la cuenta: avisá a tus N clientes» (revisión de 3 meses, 14/11/2026). Cuando la tienda mueve o
// marca caída una cuenta completa que el revendedor alquila, en ESA cuenta aparece un cartel con sus clientes anotados
// (su cuaderno) y un botón de WhatsApp por cada uno. Solo lo suyo: el servidor (caidas.ts → accountChanges) filtra por
// la sesión; acá no se ve nada de otros revendedores, ni costos ni claves.
import { api, esc, fdate, waLink, toast } from "/common.js";

let data = null, at = 0, loading = null, rerender = () => {};
const TTL = 60_000;

/** Una vez, desde shop.js: cómo volver a pintar cuando llegan los datos. */
export function initAccChanges(render) {
  rerender = render;
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
/** El mensaje para SU cliente: sin claves (las manda el revendedor aparte, como siempre). */
export function changeMsg(c, x) {
  return x.kind === "fallen"
    ? `Hola ${first(c.name)} 👋 Te aviso que se cayó la cuenta de tu ${x.product}. Ya la estamos cambiando: en cuanto esté te paso los datos nuevos. Tu fecha no cambia 🙌`
    : `Hola ${first(c.name)} 👋 Te aviso que cambió la cuenta de tu ${x.product}${x.email ? `: ahora es ${x.email}` : ""}. Tu perfil${c.label ? ` (${c.label})` : ""} y tu fecha siguen igual; te paso la clave nueva por acá 🙌`;
}
/** Cartel dentro de la tarjeta de la cuenta alquilada `r` (de /api/me/subs). Vacío si no cambió nada. */
export function accChangeBox(r) {
  ensure();
  const x = (data ?? []).find((c) => c.assignmentId === r.assignmentId);
  if (!x) return "";
  const n = x.clients.length;
  const head = x.kind === "fallen" ? `⚠️ Se cayó la cuenta${n ? `: avisá a tus ${n} cliente${n === 1 ? "" : "s"}` : ""}` : `🔁 Cambió la cuenta${n ? `: avisá a tus ${n} cliente${n === 1 ? "" : "s"}` : ""}`;
  const sub = x.kind === "fallen" ? `La tienda la está cambiando (${fdate(x.at)}). Tus clientes siguen con su fecha.` : `Ahora es ${esc(x.email)} (${fdate(x.at)}). Tus clientes siguen con su perfil y su fecha.`;
  return `<div class="sbox rcwarn accchg" role="status"><h3 style="margin:0">${head}</h3><p class="empty" style="margin:0">${sub}</p>
    ${n ? `<div class="rcsoon">${x.clients.map((c) => `<div class="rcsoon-r"><span><b>${esc(c.name)}</b><small>${esc(c.label || "Perfil")}</small></span>${c.phone ? `<a class="sbtn sm pri" href="${waLink(c.phone, changeMsg(c, x))}" target="_blank" rel="noopener">💬 Avisar</a>` : `<small class="empty">sin WhatsApp</small>`}</div>`).join("")}</div>` : `<p class="empty" style="margin:0">No tenés clientes anotados en esta cuenta.</p>`}
    <div class="rbtns"><button class="sbtn sm" type="button" data-accchgseen="${esc(x.assignmentId)}">✓ Ya les avisé</button></div></div>`;
}
