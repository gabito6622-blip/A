// 🔗 Cobrar con link de pago (16/11/2026). El dueño: el mensaje de cobro lleva un link; el cliente lo abre, ve su
// cuenta y el precio, paga con el QR y sube el comprobante; le llega a Aprobar pagos y al aprobar se renueva sola.
// Acá se arma el WhatsApp con un link por cuenta (los mismos links de renovación de Control y Mi secretaria).
// Nada se manda solo: se muestra el mensaje y el dueño toca «Abrir WhatsApp».
import { api, esc, bs, fdate, waLink, icon, toast } from "/common.js";

const short = (p) => String(p || "").replace(/\s*\(alquiler revendedores\)/i, "").replace(/Premium \+ /, "").replace(/Disney\+?/, "Disney").trim();
const first = (n) => String(n || "").split(" · ").pop().split(" ")[0] || "";

/** items: [{ id (alquiler), product, email, expiresAt, price }] */
export async function cobrarConLink(phone, name, items) {
  if (!items?.length) return toast("No hay cuentas para cobrar");
  const lines = [];
  let off = false, total = 0;
  for (const it of items) {
    let url = "";
    if (!off) {
      try { url = (await api("POST", `/api/admin/assignments/${encodeURIComponent(it.id)}/renew-link`, {})).url; }
      catch (e) { if (e.code === "RENEW_LINKS_OFF") off = true; }
    }
    total += it.price || 0;
    const venc = it.expiresAt < Date.now() ? "venció" : "vence";
    lines.push(`• ${short(it.product)} (${it.email}) — ${venc} el ${fdate(it.expiresAt)}: ${bs(it.price || 0)}${url ? `\n  👉 Renová y pagá con QR acá: ${url}` : ""}`);
  }
  const msg = `Hola ${first(name)} 👋\nTe paso ${items.length === 1 ? "tu cuenta" : "tus cuentas"} para renovar:\n${lines.join("\n")}${items.length > 1 ? `\nTotal: ${bs(total)}` : ""}\n${off ? "¿Te la renuevo?" : "Abrí el link, pagá con el QR y subí el comprobante: apenas lo apruebo, queda renovada."} ¡Gracias! 🙌`;
  document.getElementById("cobLinkBox")?.remove();
  const el = document.createElement("div");
  el.id = "cobLinkBox"; el.className = "dlv-scrim";
  el.innerHTML = `<div class="dlv-card" role="dialog" aria-modal="true" aria-label="Cobrar con link de pago">
    <div class="dlv-top"><h3>🔗 Cobrar con link de pago</h3><button class="pbtn sm" type="button" data-cobclose="1" aria-label="Cerrar">✕</button></div>
    ${off ? `<p class="qwarn" style="margin:0">⚠️ Los links de pago están apagados: el mensaje va sin link. Prendelos en Configuración → Soporte → «Prender los links de renovación».</p>` : ""}
    <pre class="cobpre" style="white-space:pre-wrap;margin:0">${esc(msg)}</pre>
    ${phone ? `<a class="pbtn green big" href="${esc(waLink(phone, msg))}" target="_blank" rel="noopener" data-cobwa="1">${icon("wa")}Abrir WhatsApp</a>` : `<p class="muted" style="margin:0">No tiene WhatsApp cargado: copiá el mensaje.</p>`}
    <button class="pbtn big" type="button" data-cobcopy="1">📋 Copiar mensaje</button></div>`;
  el.dataset.msg = msg;
  el.addEventListener("click", async (ev) => {
    if (ev.target === el || ev.target.closest("[data-cobclose]")) return el.remove();
    if (ev.target.closest("[data-cobcopy]")) { try { await navigator.clipboard.writeText(msg); toast("📋 Mensaje copiado"); } catch { toast("No se pudo copiar"); } }
    if (ev.target.closest("[data-cobwa]")) setTimeout(() => el.remove(), 0);
  });
  (document.getElementById("app") ?? document.body).appendChild(el);
  el.querySelector("[data-cobclose]")?.focus();
}
