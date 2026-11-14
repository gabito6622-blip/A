// 💬 «Hablar con una persona», siempre a mano en la tienda (revisión «en el lugar de ~30 clientes», 14/11/2026).
// Antes el WhatsApp estaba solo al pie de la página (unas 10 pantallas más abajo) y Don Julio (74) no lo encontraba.
//  - Botón verde de WhatsApp fijo abajo a la derecha, arriba de la barra de abajo (no tapa el carrito ni la barra),
//    con un mensaje inicial que ya dice qué tiene en el carrito.
//  - En la ficha de cada producto, «💬 Preguntar por este» con el nombre del producto.
//  - Fuera del horario configurado: «Te respondemos desde las 8:00» (horario.js), sin prometer que alguien contesta ya.
// Solo en la tienda y en la página de un revendedor (con SU WhatsApp). Nunca en GaboHub ni en el panel.
import { esc, bs, waLink, icon } from "/common.js";
import { hoursOf, closedText } from "/horario.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/hablar.css"]')) {
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/hablar.css";
  document.head.appendChild(l);
}

/** `get()` devuelve { mode: "store"|"rshop"|"hub", settings, cart: [{ name, qty, price }] }. */
let get = () => null;
export function initHablar(getter) { get = getter; }

const on = (c) => !!c && (c.mode === "store" || c.mode === "rshop") && !!c.settings?.whatsapp;
const hours = (c) => hoursOf(c.settings, c.mode === "store");

/** El mensaje con el que se abre el chat: quién es y, si tiene algo en el carrito, qué. */
export function startMessage(c) {
  const st = c.settings ?? {};
  const where = c.mode === "rshop" ? `Vi tu página ${st.storeName ? `«${st.storeName}»` : ""}`.trim() : `Estoy en la tienda ${st.storeName || ""}`.trim();
  const cart = (c.cart ?? []).filter((l) => l && l.name);
  const lines = [`Hola 👋 ${where} y quiero hablar con una persona.`];
  if (cart.length) {
    lines.push("Tengo en el carrito:", ...cart.map((l) => `• ${l.qty > 1 ? `${l.qty} × ` : ""}${l.name}${l.price ? ` (${bs(l.price * (l.qty || 1))})` : ""}`));
    lines.push("¿Me ayudás antes de pagar?");
  } else lines.push("Tengo una consulta:");
  return lines.join("\n");
}

/** Mensaje para «Preguntar por este» en la ficha de un producto. */
export function askMessage(p) {
  const what = `${p.name}${p.price ? ` (${bs(p.price)}${p.durationDays ? ` · ${p.durationDays} días` : ""})` : ""}`;
  return `Hola 👋 Quiero preguntar por ${what}. ¿Me contás cómo funciona?`;
}

/** Dibuja (o actualiza) el botón fijo. Se llama en cada render de la tienda. */
export function hablarSync() {
  if (typeof document === "undefined") return;
  const c = get();
  let a = document.getElementById("hablar");
  if (!on(c)) { a?.remove(); document.body.classList.remove("con-hablar"); return; }
  const late = closedText(hours(c));
  const html = `${icon("wa", "i hablar-ico")}<span class="hablar-t"><b>Hablar con una persona</b>${late ? `<small>${esc(late)}</small>` : ""}</span>`;
  if (!a) {
    a = document.createElement("a");
    a.id = "hablar"; a.className = "hablar"; a.target = "_blank"; a.rel = "noopener";
    document.body.append(a);
  }
  a.href = waLink(c.settings.whatsapp, startMessage(c));
  a.setAttribute("aria-label", `Hablar con una persona por WhatsApp${late ? `. ${late}` : ""}`);
  if (a.dataset.html !== html) { a.innerHTML = html; a.dataset.html = html; }
  document.body.classList.add("con-hablar");
}

/** Agrega «💬 Preguntar por este» a la ficha (modal) de un producto ya abierta. */
export function hablarFicha(modal, p) {
  const c = get();
  if (!modal || !p || !on(c)) return;
  const box = modal.querySelector(".pbtns") ?? modal.querySelector('[role="dialog"]');
  if (!box || modal.querySelector("[data-preguntar]")) return;
  const late = closedText(hours(c));
  box.insertAdjacentHTML(box.matches(".pbtns") ? "beforebegin" : "beforeend", `<div class="hablar-ficha"><a class="sbtn hablar-pre" data-preguntar="${esc(p.id)}" href="${esc(waLink(c.settings.whatsapp, askMessage(p)))}" target="_blank" rel="noopener">${icon("wa")}Preguntar por este</a>${late ? `<small class="empty">${esc(late)}</small>` : ""}</div>`);
}
