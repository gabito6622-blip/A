// 💬 «Hablar con una persona», siempre a mano en la tienda (revisión «en el lugar de ~30 clientes», 14/11/2026).
// Antes el WhatsApp estaba solo al pie de la página (unas 10 pantallas más abajo) y Don Julio (74) no lo encontraba.
//  - Botón verde de WhatsApp fijo abajo a la derecha, arriba de la barra de abajo (no tapa el carrito ni la barra),
//    con un mensaje inicial que ya dice qué tiene en el carrito.
//  - En la ficha de cada producto, «💬 Preguntar por este» con el nombre del producto.
//  - Fuera del horario configurado: «Te respondemos desde las 8:00» (horario.js), sin prometer que alguien contesta ya.
// Solo en la tienda y en la página de un revendedor (con SU WhatsApp). Nunca en GaboHub ni en el panel.
import { esc, bs, waLink, icon, periodText } from "/common.js";
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
  const what = `${p.name}${p.price ? ` (${bs(p.price)}${p.durationDays ? ` · ${periodText(p.durationDays)}` : ""})` : ""}`;
  return `Hola 👋 Quiero preguntar por ${what}. ¿Me contás cómo funciona?`;
}

/** Dibuja (o actualiza) el botón fijo. Se llama en cada render de la tienda. */
export function hablarSync() {
  if (typeof document === "undefined") return;
  const c = get();
  let a = document.getElementById("hablar");
  if (!on(c)) { a?.remove(); document.body.classList.remove("con-hablar"); return; }
  const late = closedText(hours(c));
  // 15/11 (el dueño): ícono + «WhatsApp», ancho justo y 44 px de alto. El horario va en la barra de arriba y en el
  // texto para lectores de pantalla.
  const html = `${icon("wa", "i hablar-ico")}<b class="hablar-t">WhatsApp</b>`;
  if (!a) {
    a = document.createElement("a");
    a.id = "hablar"; a.className = "hablar"; a.target = "_blank"; a.rel = "noopener";
    document.body.append(a);
  }
  a.href = waLink(c.settings.whatsapp, startMessage(c));
  a.setAttribute("aria-label", `Hablar con una persona por WhatsApp${late ? `. ${late}` : ""}`);
  a.title = late ? `Hablar con una persona · ${late}` : "Hablar con una persona";
  if (a.dataset.html !== html) { a.innerHTML = html; a.dataset.html = html; }
  document.body.classList.add("con-hablar");
  watchDodge();
  dodge();
}

/* Que nunca tape un precio, «Agregar» ni la barra de abajo: si al desplazarse queda encima de uno, se esconde
   (sin poder tocarlo por error) y vuelve apenas hay lugar libre. */
const CRIT = "[data-add], .tkbtn, .ccmore, .tkend > b, .price, .pbtns .sbtn, .ccopt, .ccdev, .bnav, .cbar, .cbanner";
export function hablarTapa(a = document.getElementById("hablar")) {
  if (!a) return [];
  const r = a.getBoundingClientRect();
  return [...document.querySelectorAll(CRIT)].filter((x) => {
    const b = x.getBoundingClientRect();
    return b.width > 0 && b.height > 0 && b.left < r.right && b.right > r.left && b.top < r.bottom && b.bottom > r.top && getComputedStyle(x).visibility !== "hidden";
  });
}
function dodge() {
  const a = document.getElementById("hablar");
  if (a) a.classList.toggle("hablar-fuera", hablarTapa(a).length > 0);
}
let watching = false, raf = 0;
function watchDodge() {
  if (watching || typeof window === "undefined") return;
  watching = true;
  const tick = () => { raf = 0; dodge(); };
  const later = () => { if (!raf) raf = requestAnimationFrame(tick); };
  window.addEventListener("scroll", later, { passive: true });
  window.addEventListener("resize", later);
}

/** Agrega «💬 Preguntar por este» a la ficha (modal) de un producto ya abierta. */
export function hablarFicha(modal, p) {
  const c = get();
  if (!modal || !p || !on(c)) return;
  const box = modal.querySelector(".pbtns") ?? modal.querySelector('[role="dialog"]');
  // A pedido: la ficha ya tiene «Consultar disponibilidad» con el plan y el precio (catalogo-claro.js); no se repite.
  if (!box || modal.querySelector("[data-preguntar], [data-dispo]")) return;
  const late = closedText(hours(c));
  box.insertAdjacentHTML(box.matches(".pbtns") ? "beforebegin" : "beforeend", `<div class="hablar-ficha"><a class="sbtn hablar-pre" data-preguntar="${esc(p.id)}" href="${esc(waLink(c.settings.whatsapp, askMessage(p)))}" target="_blank" rel="noopener">${icon("wa")}Preguntar por este</a>${late ? `<small class="empty">${esc(late)}</small>` : ""}</div>`);
}
