// 🔗 Cobrar con link de pago (16/11/2026). El dueño: el mensaje de cobro lleva un link; el cliente lo abre, ve su
// cuenta y el precio, paga con el QR y sube el comprobante; le llega a Aprobar pagos y al aprobar se renueva sola.
// Acá se arma el WhatsApp con un link por cuenta (los mismos links de renovación de Control y Mi secretaria).
// Nada se manda solo: se muestra el mensaje y el dueño toca «Abrir WhatsApp».
import { api, esc, bs, fdate, waLink, icon, toast } from "/common.js";

const short = (p) => String(p || "").replace(/\s*\(alquiler revendedores\)/i, "").replace(/Premium \+ /, "").replace(/Disney\+?/, "Disney").trim();
const first = (n) => String(n || "").split(" · ").pop().split(" ")[0] || "";

/** Arma el mensaje con un link por cuenta. items: [{ id (alquiler), product, email, expiresAt, price }]. */
export async function armarCobro(name, items) {
  const lines = [], missing = [];
  let off = false, total = 0, withUrl = 0;
  for (const it of items) {
    let url = "";
    if (!off) {
      try { url = (await api("POST", `/api/admin/assignments/${encodeURIComponent(it.id)}/renew-link`, {})).url; withUrl++; }
      catch (e) { if (e.code === "RENEW_LINKS_OFF") off = true; else missing.push(`${it.email}: ${e.message}`); }
    }
    total += it.price || 0;
    const venc = it.expiresAt < Date.now() ? "venció" : "vence";
    lines.push(`• ${short(it.product)} (${it.email}) — ${venc} el ${fdate(it.expiresAt)}: ${bs(it.price || 0)}${url ? `\n  👉 Renová y pagá con QR acá: ${url}` : ""}`);
  }
  const msg = `Hola ${first(name)} 👋\nTe paso ${items.length === 1 ? "tu cuenta" : "tus cuentas"} para renovar:\n${lines.join("\n")}${items.length > 1 ? `\nTotal: ${bs(total)}` : ""}\n${withUrl ? "Abrí el link, pagá con el QR y subí el comprobante: apenas lo apruebo, queda renovada." : "¿Te la renuevo?"} ¡Gracias! 🙌`;
  return { msg, off, total, missing };
}
const missTxt = (m) => m.length ? `<p class="qwarn" style="margin:0">⚠️ Sin link: ${m.map(esc).join(" · ")}</p>` : "";
const OFF_TXT = `<p class="qwarn" style="margin:0">⚠️ Los links de pago están apagados: el mensaje va sin link. Prendelos en Configuración → Soporte → «Prender los links de renovación».</p>`;

/** items: [{ id (alquiler), product, email, expiresAt, price }] */
export async function cobrarConLink(phone, name, items) {
  if (!items?.length) return toast("No hay cuentas para cobrar");
  const { msg, off, missing } = await armarCobro(name, items);
  document.getElementById("cobLinkBox")?.remove();
  const el = document.createElement("div");
  el.id = "cobLinkBox"; el.className = "dlv-scrim";
  el.innerHTML = `<div class="dlv-card" role="dialog" aria-modal="true" aria-label="Cobrar con link de pago">
    <div class="dlv-top"><h3>🔗 Cobrar con link de pago</h3><button class="pbtn sm" type="button" data-cobclose="1" aria-label="Cerrar">✕</button></div>
    ${off ? OFF_TXT : missTxt(missing)}
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

/* ---------------- ▶ Cobrar uno por uno (17/11/2026) ----------------
 * El dueño persigue a cada revendedor por WhatsApp. Acá van todos los que tienen cuentas vencidas o por vencer en una
 * sola pasada: se ve el mensaje (con un link de pago por cuenta), «Abrir WhatsApp» lo abre y lo marca como avisado
 * (lo mismo que «✅ Ya le avisé»), y «Siguiente» pasa al próximo. Nada se manda solo. */
export async function cobrarUnoPorUno(people, onEnd) {
  const list = (people ?? []).filter((p) => p.phone && p.items?.length);
  if (!list.length) return toast("No hay nadie para cobrar con WhatsApp cargado");
  document.getElementById("cobSeqBox")?.remove();
  const el = document.createElement("div");
  el.id = "cobSeqBox"; el.className = "dlv-scrim";
  let i = 0, sent = 0;
  const close = () => { el.remove(); if (onEnd) onEnd(sent); };
  const show = async () => {
    if (i >= list.length) {
      el.innerHTML = `<div class="dlv-card" role="dialog" aria-modal="true" aria-label="Cobrar uno por uno"><div class="dlv-top"><h3>✅ Listo</h3><button class="pbtn sm" type="button" data-cobsclose="1" aria-label="Cerrar">✕</button></div>
        <p style="margin:0">Abriste WhatsApp para ${sent} de ${list.length}. Quedan marcados como avisados en Mi secretaria.</p><button class="pbtn big" type="button" data-cobsclose="1">Cerrar</button></div>`;
      el.querySelector("[data-cobsclose]")?.focus();
      return;
    }
    const p = list[i];
    el.innerHTML = `<div class="dlv-card" role="dialog" aria-modal="true" aria-label="Cobrar uno por uno"><div class="dlv-top"><h3>▶ ${i + 1} de ${list.length}: ${esc(first(p.name))}</h3><button class="pbtn sm" type="button" data-cobsclose="1" aria-label="Cerrar">✕</button></div><p class="muted" style="margin:0">Armando el mensaje…</p></div>`;
    const { msg, off, total, missing } = await armarCobro(p.name, p.items);
    if (!el.isConnected) return;
    el.innerHTML = `<div class="dlv-card" role="dialog" aria-modal="true" aria-label="Cobrar uno por uno">
      <div class="dlv-top"><h3>▶ ${i + 1} de ${list.length}: ${esc(String(p.name).split(" · ").pop())}</h3><button class="pbtn sm" type="button" data-cobsclose="1" aria-label="Cerrar">✕</button></div>
      <p class="muted" style="margin:0">${p.items.length} cuenta${p.items.length === 1 ? "" : "s"} · ${bs(total)}</p>
      ${off ? OFF_TXT : missTxt(missing)}
      <pre class="cobpre" style="white-space:pre-wrap;margin:0">${esc(msg)}</pre>
      <a class="pbtn green big" href="${esc(waLink(p.phone, msg))}" target="_blank" rel="noopener" data-cobswa="1">${icon("wa")}Abrir WhatsApp</a>
      <button class="pbtn big" type="button" data-cobsnext="1">${i + 1 < list.length ? "Siguiente ▶" : "Terminar"}</button></div>`;
    el.querySelector("[data-cobswa]")?.focus();
  };
  el.addEventListener("click", async (ev) => {
    if (ev.target === el || ev.target.closest("[data-cobsclose]")) return close();
    if (ev.target.closest("[data-cobswa]")) {
      const p = list[i]; sent++;
      api("POST", "/api/admin/assignments/notified", { ids: p.items.map((x) => x.id) }).catch(() => {});
      const nx = el.querySelector("[data-cobsnext]"); if (nx) nx.classList.add("dark");
      return;
    }
    if (ev.target.closest("[data-cobsnext]")) { i++; await show(); }
  });
  (document.getElementById("app") ?? document.body).appendChild(el);
  await show();
}
