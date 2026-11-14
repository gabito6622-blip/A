// Página propia del revendedor (/r/<slug>) solo con SU marca y promesas que se cumplen (revisión de 3 meses, 15/11/2026).
//  - Pie: «Condiciones» neutras de esa tienda (sin links a los términos ni al nombre de la tienda mayorista).
//  - Franja de confianza sin «con saldo · entrega al instante» ni «garantía» (eso lo decide cada revendedor).
//  - Preguntas frecuentes neutras por defecto y editables por el revendedor en «Mi página».
// shop.js solo llama a estas funciones; la lógica y los eventos están acá.
import { api, esc } from "/common.js";

/* ---------------- En su página ---------------- */
/** Preguntas de fábrica: sin «Mis cuentas», sin garantías ni reposiciones que el revendedor quizás no da. */
export const RSHOP_FAQ = [
  ["¿Cómo hago mi pedido?", "Agregá lo que querés al carrito y mandame el pedido por WhatsApp con un toque."],
  ["¿Cómo pago?", "Te paso cómo pagar por WhatsApp cuando me mandás tu pedido."],
  ["¿Cómo recibo mis accesos?", "Te los mando por WhatsApp cuando el pago está confirmado."],
  ["¿Cuánto dura?", "Lo que dice cada plan (por ejemplo, 30 días). Te confirmo la fecha de vencimiento al entregarte."],
  ["¿Y si tengo un problema?", "Escribime por WhatsApp y lo vemos."],
];
/** Las preguntas de su página: las suyas si las escribió; si no, las de fábrica. */
export const rshopFaq = (st) => {
  const own = (st?.faq ?? []).filter((f) => f && f.q && f.a).map((f) => [f.q, f.a]);
  return own.length ? own : RSHOP_FAQ;
};

/** Franja de confianza de su página: solo lo que es cierto para cualquier revendedor. */
export function rshopTrust(st, n) {
  return [
    ["⚡", n ? `${n}` : "Catálogo", n ? (n === 1 ? "servicio" : "servicios") : "con precios claros"],
    st.hasQr && ["💳", "QR", "pagás directo"],
    st.whatsapp && ["💬", "WhatsApp", "atención directa"],
    ["📄", "PDF", "catálogo para compartir"],
  ].filter(Boolean).slice(0, 4);
}

/** Links del pie de su página (además de WhatsApp y redes): solo sus condiciones, neutras. */
export const rshopFootLinks = () => [`<a href="#condiciones" data-conds="1">Condiciones</a>`];

function condsHtml(st) {
  const name = esc(st.storeName || st.title || "esta tienda");
  return `<div role="dialog" aria-modal="true" aria-labelledby="condT"><h2 id="condT" style="font-size:20px;font-weight:800;display:flex;justify-content:space-between;gap:8px">Condiciones de ${name}<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2>
    <div class="rconds">
      <h3>Pedidos</h3><p>Elegís en esta página y mandás tu pedido por WhatsApp. El pedido se confirma cuando ${name} te responde.</p>
      <h3>Pagos</h3><p>Se pagan como acuerdes con ${name} (QR o lo que te indique). Guardá tu comprobante.</p>
      <h3>Duración</h3><p>Cada plan dura lo que dice su tarjeta (por ejemplo, 30 días) desde la entrega.</p>
      <h3>Precios</h3><p>Los precios pueden cambiar sin aviso. Vale el que te confirman por WhatsApp.</p>
      <h3>Atención</h3><p>Cualquier problema o duda, escribile a ${name} por WhatsApp${st.whatsapp ? ` (+${esc(String(st.whatsapp).replace(/\D/g, ""))})` : ""}.</p>
      <h3>Tus datos</h3><p>Tu nombre y tu número se usan solo para atender tu pedido.</p>
    </div>
    <button class="sbtn pri" type="button" data-close="1">Entendido</button></div>`;
}

let ST = () => null;
/** shop.js pasa una función que devuelve los datos de la página (S.settings). */
export function initMarcaPropia(getSettings) { ST = getSettings; }
if (typeof document !== "undefined") {
  document.addEventListener("click", (ev) => {
    const a = ev.target.closest?.("[data-conds]");
    if (!a) return;
    ev.preventDefault();
    const st = ST();
    if (!st) return;
    $id("drawer").hidden = true;
    $id("modal").innerHTML = condsHtml(st);
    $id("modal").hidden = false; $id("scrim").hidden = false;
    $id("modal").querySelector("[data-close]")?.focus();
  });
}
const $id = (id) => document.getElementById(id);

/* ---------------- En «Mi página» (GaboHub): sus preguntas frecuentes ---------------- */
/** Formulario de sus preguntas: 5 filas, con las de fábrica como ejemplo si todavía no escribió las suyas. */
export function shopFaqBox(sh) {
  const own = (sh?.faq ?? []).filter((f) => f && f.q);
  const rows = own.length ? own.map((f) => [f.q, f.a]) : [];
  while (rows.length < 5) rows.push(["", ""]);
  return `<div class="sbox"><h2>❓ Preguntas frecuentes de tu página</h2>
    <p class="empty" style="margin:0">${own.length ? "Estas son las que ven tus clientes." : "Tus clientes ven unas preguntas simples de fábrica. Escribí las tuyas: solo prometé lo que cumplís."}</p>
    <form class="sform rfaq" id="shopFaq">${rows.map(([q, a], i) => `<fieldset><legend>Pregunta ${i + 1}</legend>
      <label>Pregunta<input name="q${i}" maxlength="140" value="${esc(q)}" placeholder="${esc(RSHOP_FAQ[i]?.[0] ?? "")}"></label>
      <label>Respuesta<textarea name="a${i}" maxlength="400" placeholder="${esc(RSHOP_FAQ[i]?.[1] ?? "")}">${esc(a)}</textarea></label></fieldset>`).join("")}
      <div class="hrow"><button class="sbtn pri" type="submit">Guardar preguntas</button><small class="empty">Dejá todo vacío para volver a las de fábrica.</small></div></form></div>`;
}
/** Guarda sus preguntas (lo llama el submit de shop.js). Devuelve la página guardada. */
export async function saveShopFaq(f) {
  const faq = [];
  for (let i = 0; f[`q${i}`]; i++) {
    const q = f[`q${i}`].value.trim(), a = f[`a${i}`].value.trim();
    if (q || a) faq.push({ q, a });
  }
  return api("PUT", "/api/me/shop", { faq });
}
