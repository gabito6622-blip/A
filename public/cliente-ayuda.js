// Ayudas para el cliente de la tienda (revisión «en el lugar de ~30 clientes», 14/11/2026):
//  - Fallas: el horario («Atendemos de 08:00 a 22:00. Ahora estamos cerrados: te respondemos desde las 08:00»), dónde
//    reportar (el mismo texto en la pantalla y en la pregunta frecuente de fábrica) y «💬 Hablar con una persona».
//  - Preguntas frecuentes: si la regla dice que cambiar el PIN hace perder la garantía, se suma «Si te cambiaron el PIN,
//    reportalo igual: te ayudamos» (la regla no se toca).
//  - «Olvidé mi PIN»: arma un WhatsApp con el nombre, el número y, si cambió de número, el anterior; y avisa que se le
//    va a pedir un dato de su compra para confirmar que es él.
import { esc, waLink, icon } from "/common.js";

/** Dónde reportar: igual en la pantalla de fallas y en la pregunta frecuente de fábrica. */
export const REPORT_WHERE = "Reportá en Mis cuentas → ⚠️ Reportar falla; si es urgente, escribinos por WhatsApp.";
/** En la pantalla de fallas ya estás donde se reporta: no se manda a «Mis cuentas» (20/11, confundía). */
export const REPORT_HERE = "Contanos qué pasa con el formulario de abajo; si es urgente, escribinos por WhatsApp.";

/** Recuadro de la pantalla de fallas. `h`: { from, to, open, opensAt, opensWhen } del servidor. */
export function fallasHelp(h, st) {
  const when = h && !h.open ? ` Ahora estamos cerrados: te respondemos desde las ${esc(h.opensAt)}${h.opensWhen === "tomorrow" ? " de mañana" : ""}.` : "";
  const wa = st?.whatsapp ? `<a class="sbtn" href="${waLink(st.whatsapp, "Hola, tengo una falla con mi servicio y quiero hablar con una persona.")}" target="_blank" rel="noopener">${icon("wa")}Hablar con una persona</a>` : "";
  return `<div class="sbox fhelp" role="note">${h ? `<p>🕒 <b>Atendemos de ${esc(h.from)} a ${esc(h.to)}.</b>${when}</p>` : ""}<p class="empty">${esc(REPORT_HERE)}</p>${wa}</div>`;
}

/** Respuesta de una pregunta frecuente con la ayuda del PIN, si la regla habla de perder la garantía por el PIN. */
export function faqExtra(a) {
  const t = String(a ?? "");
  return /\bPIN\b/i.test(t) && /garant/i.test(t) && !/reportalo igual/i.test(t) ? `${t.trimEnd()} Si te cambiaron el PIN, reportalo igual: te ayudamos.` : t;
}

/* ---------------- Olvidé mi PIN / cambié de número ---------------- */

const valuesOf = (f) => ({
  name: f.querySelector("[name=rname]")?.value.trim() ?? "", phone: f.querySelector("[name=rphone]")?.value.trim() ?? "",
  changed: !!f.querySelector("[name=rchanged]")?.checked, prev: f.querySelector("[name=rprev]")?.value.trim() ?? "",
  isNew: f.querySelector("#recWa")?.dataset.why === "new",
});
/** El mensaje de WhatsApp: sirve para quien olvidó el PIN, quien es nuevo y quien cambió de número. */
export function recoverText(v, st) {
  const phone = String(v.phone ?? "").replace(/^\+591\s*$/, "").trim();
  if (v.isNew) return `Hola${v.name ? `, soy ${v.name}` : ""}. Soy cliente nuevo y quiero crear mi cuenta en ${st?.storeName || "la tienda"}.${phone ? ` Mi número es ${phone}.` : ""}`;
  return `Hola${v.name ? `, soy ${v.name}` : ""}. Necesito mi PIN para entrar a ${st?.storeName || "la tienda"}.${phone ? ` Mi número es ${phone}.` : ""}${v.changed ? ` Cambié de número: mi número anterior era ${v.prev || "…"}.` : ""}`;
}

/**
 * Paso «recover» de la ventana Acceder: nombre, número y «cambié de número» con el anterior. El botón abre WhatsApp con
 * todo escrito. `who`: a quién se le pide (la tienda o el revendedor).
 */
export function recoverHtml(st, phone = "", who = "la tienda", why = "") {
  if (why === "new") {
    if (!st?.whatsapp) return `<p class="empty">Para crear tu cuenta escribile a ${esc(who)}: te da tu PIN de 4 números.</p><button class="sbtn" type="button" data-loginstep="pin">Ya tengo PIN</button>`;
    return `<label>Tu nombre<input name="rname" autocomplete="name" maxlength="80" data-recover="1"></label>
    <label>Tu número de WhatsApp<input name="rphone" inputmode="tel" autocomplete="tel" value="${esc(phone || "+591 ")}" data-recover="1"></label>
    <a class="sbtn pri" id="recWa" data-why="new" href="${waLink(st.whatsapp, recoverText({ phone, isNew: true }, st))}" target="_blank" rel="noopener">${icon("wa")}Pedir mi PIN por WhatsApp</a>
    <button class="sbtn" type="button" data-loginstep="pin">Ya tengo PIN</button>`;
  }
  if (!st?.whatsapp) return `<p class="empty">Para recuperar tu acceso escribile a ${esc(who)}. Te va a pedir un dato de tu compra para confirmar que sos vos.</p><button class="sbtn" type="button" data-loginstep="pin">Ya tengo PIN</button>`;
  return `<p class="empty">Te ayudamos por WhatsApp. <b>Te pediremos un dato de tu compra para confirmar que sos vos.</b></p>
    <label>Tu nombre<input name="rname" autocomplete="name" maxlength="80" data-recover="1"></label>
    <label>Tu número de WhatsApp<input name="rphone" inputmode="tel" autocomplete="tel" value="${esc(phone || "+591 ")}" data-recover="1"></label>
    <label class="chk"><input type="checkbox" name="rchanged" data-recover="1"> Cambié de número</label>
    <label data-recprev hidden>Mi número anterior era<input name="rprev" inputmode="tel" placeholder="+591 7…" data-recover="1"></label>
    <a class="sbtn pri" id="recWa" href="${waLink(st.whatsapp, recoverText({ phone }, st))}" target="_blank" rel="noopener">${icon("wa")}Pedir ayuda por WhatsApp</a>
    <button class="sbtn" type="button" data-loginstep="pin">Ya tengo PIN</button>`;
}

/**
 * Sin ingreso por código (la tienda todavía no tiene el WhatsApp oficial): «Soy nuevo» y «Olvidé mi PIN» van directo a
 * pedir el PIN por WhatsApp, sin un «Recibir código» que nunca llega. El servidor dice si hay código (`loginCode`).
 */
export const noLoginCode = (st) => st?.loginCode === false;
/** Paso «link»: cómo conseguir el PIN. Al nuevo no se le pide «un dato de tu compra» (todavía no compró). */
export function pinHelpHtml(st, phone = "", who = "la tienda", why = "") {
  if (why === "new") return `<p class="empty">Para entrar necesitás un PIN de 4 números. Te lo da ${esc(who)} por WhatsApp: escribí tu nombre y tu número y mandá el mensaje.</p>${recoverHtml(st, phone, who, "new")}`;
  return `<p class="empty">Para entrar necesitás tu PIN de 4 números. Te lo da ${esc(who)} por WhatsApp (una sola vez; después lo podés cambiar).</p>${recoverHtml(st, phone, who)}`;
}

/* ---------------- Cambiarme a otro servicio ---------------- */
/** Mensaje para pedir pasar un servicio a otro (p. ej. de Netflix a Disney+). Solo pregunta: el dueño decide cómo queda. */
export function switchText(a, me, st) {
  const prod = String(a?.product ?? "").replace(/ \(alquiler revendedores\)/, "");
  return `Hola${me?.name ? `, soy ${me.name}` : ""}. Quiero cambiar mi ${prod}${a?.access?.email ? ` (${a.access.email})` : ""} por otro servicio de ${st?.storeName || "la tienda"}. ¿Se puede y cómo me queda la fecha?`;
}
/** Botón «🔀 Cambiarme a otro servicio» de la tarjeta (cliente de la tienda; lo de un revendedor lo ve su revendedor). */
export function switchLink(a, me, st) {
  if (!st?.whatsapp || a?.viaReseller) return "";
  return `<a class="sbtn sm" href="${waLink(st.whatsapp, switchText(a, me, st))}" target="_blank" rel="noopener">🔀 Cambiarme a otro servicio</a>`;
}

let STORE = () => ({});
/** shop.js le pasa de dónde leer la configuración de la tienda (el WhatsApp y el nombre). */
export function initClienteAyuda(c) { STORE = c.settings ?? STORE; }

if (typeof document !== "undefined") {
  const sync = (ev) => {
    const el = ev.target;
    if (!el?.dataset || el.dataset.recover === undefined) return;
    const f = el.closest("form");
    const prev = f?.querySelector("[data-recprev]");
    if (prev) prev.hidden = !f.querySelector("[name=rchanged]")?.checked;
    const a = f?.querySelector("#recWa"), st = STORE();
    if (a && st?.whatsapp) a.href = waLink(st.whatsapp, recoverText(valuesOf(f), st));
  };
  document.addEventListener("input", sync);
  document.addEventListener("change", sync);
}
