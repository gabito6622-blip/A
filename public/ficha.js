// 👤 Ficha 360° del cliente (etapa 4 del panel ordenado). Al abrir un cliente en Clientes, muestra sus servicios
// con Renovar, Pagado y Reemplazar ahí mismo, sus últimos pedidos y sus fallas, sin cambiar de pantalla.
//
// No hay funciones nuevas en el servidor: lee de las mismas rutas que ya usan el Control, Aprobar pagos y Fallas
// (cada una con su permiso), y los botones son LOS MISMOS de siempre (data-renew, data-paid, data-replace,
// data-ledger), así hacen exactamente lo mismo que en Renovar y en el Control.
import { api, esc, bs, fdate, daysLeft, waLink, icon } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/ficha.css"]')) {
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/ficha.css";
  document.head.appendChild(l);
}

const KIND = { sale: "Compra", renewal: "Renovación", topup: "Recarga" };
const STATUS = { awaiting_payment: ["Esperando pago", "warn"], payment_review: ["Por revisar", "warn"], fulfilled: ["Entregado", "ok"], rejected: ["Rechazado", "bad"], expired: ["Vencido", "bad"], cancelled: ["Cancelado", "mute"] };
const TSTATUS = { recibido: ["Recibido", "warn"], revisando: ["Revisando", "warn"], solucionado: ["Solucionado", "ok"] };
const PAY = { pagado: "Pagado", pendiente: "Pendiente de pago", no_pago: "No pagó" };
const chip = (t, k) => `<span class="fx-chip fx-${k}">${esc(t)}</span>`;

function money(a) {
  if (a.payCurrency === "USD" && a.payUsd != null) return `US$ ${(a.payUsd / 100).toFixed(2).replace(/\.00$/, "")}`;
  const p = a.effectivePrice ?? a.control?.price ?? a.productPrice;
  return p != null ? bs(p) : "";
}

function svcCard(a, canReview) {
  const d = daysLeft(a.customerExpiresAt);
  const due = a.holdOpen ? chip("Esperando fecha", "mute") : d < 0 ? chip(`Vencido ${fdate(a.customerExpiresAt).slice(0, 5)}`, "bad") : d <= 3 ? chip(d === 0 ? "Vence hoy" : `Vence en ${d} d`, "warn") : "";
  const pay = a.control?.payStatus && a.control.payStatus !== "pagado" ? chip(PAY[a.control.payStatus] ?? a.control.payStatus, "bad") : "";
  return `<article class="fx-svc">
    <div class="fx-svc-h"><b>${esc(a.product)}</b> <span class="muted">· ${esc(a.profile)}</span> ${due} ${pay}</div>
    <small class="muted mono">${esc(a.email)}</small>
    <small>Vence <b>${fdate(a.customerExpiresAt)}</b> · proveedor ${fdate(a.supplierExpiresAt)}${money(a) ? ` · ${money(a)}` : ""}${a.resellerName ? ` · 🏪 ${esc(a.resellerName)}` : ""}</small>
    <div class="fx-btns">
      <button class="pbtn sm dark" type="button" data-renew="${esc(a.id)}">${icon("renew")}Renovar +1 período</button>
      ${pay ? `<button class="pbtn sm" type="button" data-paid="${esc(a.id)}">💵 Pagado</button>` : ""}
      ${canReview ? `<details class="more fx-more"><summary class="pbtn sm">↔️ Reemplazar</summary><form class="inline" data-replace="${esc(a.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo (p. ej. perfil bloqueado)" required aria-label="Motivo"><label class="chk"><input type="checkbox" name="other"> otra cuenta</label><button class="pbtn sm" type="submit">Reemplazar</button></form></details>` : ""}
    </div></article>`;
}

/** Arma la ficha de un cliente dentro de su tarjeta de Clientes. */
export async function loadFicha(slot, { id, name, phone, canReview }) {
  if (!slot || slot.dataset.loaded === "1") return;
  slot.dataset.loaded = "1";
  slot.innerHTML = `<p class="muted fx-wait">Cargando su ficha…</p>`;
  const [svcs, orders, tickets] = await Promise.all([
    api("GET", "/api/admin/assignments?customerId=" + encodeURIComponent(id)).catch(() => null),
    api("GET", "/api/admin/orders?customerId=" + encodeURIComponent(id)).catch(() => []),
    api("GET", "/api/admin/tickets").then((l) => l.filter((t) => t.customerId === id)).catch(() => []),
  ]);
  if (!svcs) { slot.dataset.loaded = ""; slot.innerHTML = `<p class="muted">No se pudo cargar su ficha. Cerrala y abrila de nuevo.</p>`; return; }
  const open = tickets.filter((t) => t.status !== "solucionado").length;
  const tab = slot.dataset.tab || "svc";
  slot.innerHTML = `<div class="fx">
    <div class="fx-top">${phone ? `<a class="pbtn sm fx-wa" href="${esc(waLink(phone, `Hola ${String(name).split(" ")[0]} 👋`))}" target="_blank" rel="noopener">💬 WhatsApp</a>` : ""}
      <button class="pbtn sm" type="button" data-ledger="${esc(id)}">💰 Saldo y movimientos</button></div>
    <div class="tabs fx-tabs" role="tablist">
      <button type="button" role="tab" data-fxtab="svc" aria-selected="${tab === "svc"}">Servicios (${svcs.length})</button>
      <button type="button" role="tab" data-fxtab="pay" aria-selected="${tab === "pay"}">Pedidos (${orders.length})</button>
      <button type="button" role="tab" data-fxtab="bug" aria-selected="${tab === "bug"}">Fallas${open ? ` (${open})` : ""}</button></div>
    <div class="fx-pane" data-pane="svc" ${tab === "svc" ? "" : "hidden"}>${svcs.length ? svcs.map((a) => svcCard(a, canReview)).join("") : `<p class="muted">No tiene servicios activos.</p>`}</div>
    <div class="fx-pane" data-pane="pay" ${tab === "pay" ? "" : "hidden"}>${orders.length ? `<ul class="fx-list">${orders.slice(0, 8).map((o) => `<li><span>${fdate(o.createdAt)} · ${KIND[o.kind] ?? o.kind}<br><small class="muted">${esc((o.items ?? []).map((i) => i.productName).join(", "))}</small></span><span class="fx-r">${bs(o.total)}<br>${chip(...(STATUS[o.status] ?? [o.status, "mute"]))}</span></li>`).join("")}</ul>${orders.length > 8 ? `<p class="muted fx-note">Se muestran los últimos 8 de ${orders.length}.</p>` : ""}` : `<p class="muted">Todavía no tiene pedidos.</p>`}</div>
    <div class="fx-pane" data-pane="bug" ${tab === "bug" ? "" : "hidden"}>${tickets.length ? `<ul class="fx-list">${tickets.map((t) => `<li><span>${esc(t.kindText)} · ${esc(t.product)}<br><small class="muted">${fdate(t.createdAt)}${t.note ? ` · ${esc(t.note)}` : ""}</small></span><span class="fx-r">${chip(...(TSTATUS[t.status] ?? [t.status, "mute"]))}</span></li>`).join("")}</ul><button class="pbtn sm" type="button" data-go="fallas">Ir a Fallas reportadas</button>` : `<p class="muted">No reportó fallas.</p>`}</div>
  </div>`;
}

if (typeof document !== "undefined") document.addEventListener("click", (ev) => {
  const b = ev.target.closest("[data-fxtab]");
  if (!b) return;
  const fx = b.closest(".fx"), slot = b.closest("[data-fxslot]");
  if (slot) slot.dataset.tab = b.dataset.fxtab;
  fx.querySelectorAll("[data-fxtab]").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  fx.querySelectorAll("[data-pane]").forEach((p) => { p.hidden = p.dataset.pane !== b.dataset.fxtab; });
});
