// "🔗 Link de cobro" en Repartir perfiles: cada perfil repartido puede tener una página propia (/c/<token>)
// que el revendedor le manda a su cliente (cuándo vence, cuánto es, su QR y "Ya pagué"). Nada se manda solo:
// el revendedor copia el link o abre su WhatsApp con el mensaje listo.
import { api, esc, waLink, toast } from "/common.js";

export const cobroUrl = (token) => `${location.origin}/c/${token}`;

/** Renglón para sumar a los recordatorios que ya existen, si el perfil ya tiene link. */
export const cobroLine = (s) => (s?.linkToken ? `\nMirá cuánto es y cómo pagar acá 👉 ${cobroUrl(s.linkToken)}` : "");

/** Mensaje para mandarle el link por primera vez. */
export const cobroMsg = (s, product, store) => `Hola ${String(s.name).split(" ")[0]} 👋 acá ves tu perfil de ${product}${s.label ? ` (${s.label})` : ""}: cuándo vence, cuánto es y cómo pagar 👇\n${cobroUrl(s.linkToken)}${store ? `\n— ${store}` : ""}`;

/** Recuadro dentro de un perfil abierto. `aid` = alquiler, `s` = perfil, `product` = nombre de la app. */
export function subLinkBox(aid, s, product, store) {
  const key = `${esc(aid)}|${esc(s.id)}`;
  if (!s.linkToken) {
    return `<div class="sublink"><b>🔗 Link de cobro</b><small class="empty">Una página para ${esc(String(s.name).split(" ")[0])} con cuándo vence, cuánto es y tu QR. Vos se lo mandás.</small>
      <div class="rbtns"><button class="sbtn sm pri" type="button" data-sublink="${key}">🔗 Crear link de cobro</button></div></div>`;
  }
  const url = cobroUrl(s.linkToken);
  return `<div class="sublink"><b>🔗 Link de cobro</b>
    <div class="linkrow"><code>${esc(url)}</code></div>
    <div class="rbtns"><button class="sbtn sm" type="button" data-copy="${esc(url)}">📋 Copiar</button>
      ${s.phone ? `<a class="sbtn sm pri" href="${waLink(s.phone, cobroMsg(s, product, store))}" target="_blank" rel="noopener">💬 Mandar por WhatsApp</a>` : ""}
      <a class="sbtn sm" href="${esc(url)}" target="_blank" rel="noopener">👀 Ver</a>
      <button class="sbtn sm" type="button" data-sublinknew="${key}">🔁 Cambiar link</button></div>
    ${s.phone ? "" : `<small class="empty">Anotá su WhatsApp arriba para mandárselo directo.</small>`}</div>`;
}

/** Botones del recuadro. Devuelve true si atendió el clic (y el que llama vuelve a cargar la lista). */
export async function subLinkClick(d, el) {
  const raw = d.sublink || d.sublinknew;
  if (!raw) return false;
  const [aid, sid] = String(raw).split("|");
  try {
    if (d.sublinknew) {
      if (!confirm("¿Cambiar el link? El link viejo deja de funcionar y vas a tener que mandarle el nuevo.")) return true;
      el.disabled = true;
      await api("POST", `/api/me/subs/${encodeURIComponent(aid)}/${encodeURIComponent(sid)}/link/revoke`, {});
    }
    el.disabled = true;
    await api("POST", `/api/me/subs/${encodeURIComponent(aid)}/${encodeURIComponent(sid)}/link`, {});
    toast(d.sublinknew ? "🔁 Link nuevo listo: mandáselo" : "🔗 Link listo: copialo o mandalo por WhatsApp");
  } catch (e) { toast(e.message); }
  finally { el.disabled = false; }
  return true;
}
