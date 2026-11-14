// Antes, durante y después de pagar en la tienda (revisión «en el lugar de ~30 clientes», 14/11/2026).
// Lo que encontraron los revisores y cómo queda:
//  - Invitado: el WhatsApp no decía «ya pagué, te mando el comprobante» y el paso «3 · Listo» nunca aparecía.
//    Ahora hay dos botones claros («Ya pagué» / «Todavía no pagué») y, al tocar «Ya pagué», el carrito pasa a
//    «3 · Listo» con qué hacer: mandar la foto del comprobante en el chat.
//  - Invitado de afuera: no sabía que se puede pagar con USDT. Ahora lo ve (con cuánto es en USDT) sin entrar.
//  - Pedido en revisión: «antes de las HH:MM» cuenta desde que SUBIÓ el comprobante y con el horario configurado
//    (antes corría desde que miraba la pantalla). Si pasaron más de 30 minutos: «Se demoró más de lo normal» con
//    WhatsApp que ya lleva el número de pedido. «Mis cuentas» se actualiza sola cada 15 s mientras hay uno en revisión.
//  - Pedido rechazado: arriba de todo, con el motivo y «No pagues de nuevo» (antes salía abajo y parecía que había
//    que pagar otra vez).
//  - Las tarjetas y el historial dicen qué compró («Netflix · Bs 35», «Compra del 14/11 · Netflix + Disney+») en vez
//    de «Compra ord_…», y cada compra pagada tiene «🧾 Recibo» (un comprobante simple para guardar o mostrar).
// shop.js solo llama a estas funciones; la lógica está acá.
import { api, esc, bs, waLink, icon, toast, STATUS_TEXT, KIND_TEXT } from "/common.js";
import { hoursOf, closedText, rangeText, reviewDeadline, hhmm, dayKey } from "/horario.js";
import { alertsReady } from "/avisos.js";

/** Cada cuánto se revisa si ya aprobamos el pago (mientras hay uno en revisión y «Mis cuentas» está a la vista). */
export const POLL_MS = 15_000;

const H = {
  mode: "store", settings: () => ({}), orders: () => [], view: () => "", loggedIn: () => false,
  clearCart: () => {}, refresh: async () => {}, render: () => {},
};
export function initDespuesPago(hooks) {
  Object.assign(H, hooks);
  if (typeof document !== "undefined") document.addEventListener("click", onClick);
}

const hours = () => hoursOf(H.settings(), H.mode !== "rshop"); // la tienda y GaboHub: el horario de la tienda
const wa = () => H.settings()?.whatsapp || "";
const ddmm = (t) => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" }); // «13/01» (es-BO daba «13/1»)
const ddmmyyyy = (t) => new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit", year: "numeric" });
const METHOD = { balance: "Saldo de tu cuenta", qr: "QR", usdt: "USDT", binance: "Binance Pay", local: "Pago local", cash: "Efectivo" };

/** De qué es el pedido: «Netflix», «Netflix + Disney+», «Renovación · Netflix · correo», «Recarga de saldo». */
export function pedidoNombre(o) {
  if (o.kind === "renewal" && o.label) return `Renovación · ${o.label}`;
  return o.title || KIND_TEXT[o.kind] || "Pedido";
}

/* ---------------- Invitado: pagar sin cuenta ---------------- */
const usdtOf = (cents, rate) => (rate ? Math.ceil((cents / 100) / rate * 100) / 100 : null);
function orderLines(lines, total, discount) {
  return [...lines.map((l) => `• ${l.qty} × ${l.name} (${bs(l.price * l.qty)})`), ...(discount ? [`Descuento combo: − ${bs(discount)}`] : []), `Total: ${bs(total)}`];
}
/** Mensaje de WhatsApp del invitado: lo que pide, el total y si ya pagó o quiere pagar. */
export function guestMessage({ lines, total, discount = 0, paid, usdt = null }) {
  const last = usdt ? `Ya pagué ${usdt} USDT, te mando la captura del comprobante 👇`
    : paid ? `Ya pagué ${bs(total)} por QR, te mando la foto del comprobante 👇`
    : `Quiero pagar ${bs(total)}. ¿Me ayudás?`;
  return ["Hola 👋 Quiero pedir:", ...orderLines(lines, total, discount), last].join("\n");
}

/**
 * Paso 2 del invitado: el QR, «Ya pagué» / «Todavía no pagué» por WhatsApp, USDT si la tienda lo recibe y entrar
 * con su número. `qr` es el HTML del QR (qrBlock de shop.js) o "" si la tienda no tiene QR.
 */
export function guestPayHtml({ lines, total, discount = 0, qr = "" }) {
  const st = H.settings(), w = wa(), h = hours(), late = closedText(h);
  const link = (paid, extra = {}) => waLink(w, guestMessage({ lines, total, discount, paid, ...extra }));
  const u = st.usdt, uAmt = u ? usdtOf(total, u.rate) : null;
  const usdtBox = u && uAmt && w ? `<details class="dp-usdt"><summary>🌎 ¿Estás fuera de Bolivia? Pagá con USDT (≈ ${esc(String(uAmt))} USDT)</summary>
      <span>Mandá <b>${esc(String(uAmt))} USDT</b>${u.network ? ` por la red <b>${esc(u.network)}</b>` : ""}. Tasa de hoy: 1 USDT = <b>Bs ${esc(String(u.rate).replace(".", ","))}</b>.</span>
      ${u.payId ? `<span>Binance Pay ID: <b>${esc(u.payId)}</b> <button class="sbtn sm" type="button" data-copy="${esc(u.payId)}">Copiar</button></span>` : ""}
      ${u.address ? `<span>Dirección:<br><code>${esc(u.address)}</code><br><button class="sbtn sm" type="button" data-copy="${esc(u.address)}">Copiar dirección</button></span>` : ""}
      ${u.note ? `<span>${esc(u.note)}</span>` : ""}
      <a class="sbtn dp-wa" data-gsent="usdt" href="${esc(link(true, { usdt: uAmt }))}" target="_blank" rel="noopener">${icon("wa")}Ya pagué en USDT · mandar comprobante</a>
    </details>` : "";
  const binance = st.binance ? `<p class="dp-note">🪙 Con <b>Binance Pay</b> se activa solo: entrá con tu número y elegilo al pagar.</p>` : "";
  const how = w ? `<div class="dp-btns">
      <b>${qr ? "2. " : ""}Avisanos por WhatsApp</b>
      ${qr ? `<a class="sbtn pri" data-gsent="paid" href="${esc(link(true))}" target="_blank" rel="noopener">${icon("wa")}Ya pagué: mandar el comprobante</a>` : ""}
      <a class="sbtn ${qr ? "" : "pri"}" data-gsent="ask" href="${esc(link(false))}" target="_blank" rel="noopener">${icon("wa")}${qr ? "Todavía no pagué: tengo una consulta" : "Mandar mi pedido por WhatsApp"}</a>
      ${late ? `<p class="dp-note">🌙 ${esc(late)}.</p>` : ""}
    </div>` : "";
  return `<div class="total"><span>Total</span><span>${bs(total)}</span></div>
    ${qr ? `<b>1. Pagá ${bs(total)} con este QR</b>${qr}` : w ? `<p class="empty" style="margin:0">Mandanos tu pedido por WhatsApp y coordinamos el pago y la entrega.</p>` : `<p class="empty" style="margin:0">Para hacer tu pedido entrá con tu número: tus datos quedan guardados en Mis cuentas.</p>`}
    ${how}
    <p class="dp-note">📲 ${datosText()}</p>
    ${usdtBox}${binance}`;
}

/** Dónde llegan los datos (el mismo texto en toda la tienda). */
/**
 * Paso «3 · Listo» del cliente con cuenta: qué compró y cuánto (antes decía solo «Pedido ord_00297»). El número de
 * pedido queda abajo, chico, para reclamar. `what`: los nombres del carrito; `total`: lo cobrado (con cupón y combo).
 */
export function pedidoListoHtml({ what, total, status, id }) {
  const ok = status === "fulfilled";
  return `<div class="sbox"><h2>${esc(what || "Tu pedido")} · ${bs(total)} <span class="spill ${ok ? "sp-ok" : "sp-warn"}">${esc(STATUS_TEXT[status] ?? "")}</span></h2>
      <p class="empty">${ok ? "Tus accesos ya están en Mis cuentas." : "Verificamos tu pago en 10–30 minutos y te avisamos. Lo podés seguir en Mis cuentas."}</p>
      <small class="empty">Nro. de pedido ${esc(id)}</small>
      <button class="sbtn pri" type="button" data-close="1" data-s="cuentas">Ver mis cuentas</button></div>`;
}

export const datosText = () => "Tus datos quedan en Mis cuentas; si compraste sin cuenta, te los pasamos por WhatsApp.";

/** Paso 3 del invitado, después de tocar «Ya pagué». */
export function guestDoneHtml(href) {
  const h = hours(), late = closedText(h);
  return `<h2>¡Listo!<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2>
    <div class="steps"><span class="on">1 · Carrito</span><span class="on">2 · Pago</span><span class="on">3 · Listo</span></div>
    <div class="sbox dp-done" role="status"><span class="dp-big" aria-hidden="true">✅</span>
      <b>Ahora mandá la foto del comprobante en el chat.</b>
      <p>Te pasamos tus datos apenas lo veamos${h ? ` (${esc(rangeText(h))})` : ""}.</p>
      ${late ? `<p>🌙 Ahora estamos fuera de horario: ${esc(late.charAt(0).toLowerCase() + late.slice(1))}.</p>` : ""}
      ${href ? `<a class="sbtn dp-wa" href="${esc(href)}" target="_blank" rel="noopener">${icon("wa")}Abrir el chat otra vez</a>` : ""}
      <button class="sbtn" type="button" data-close="1">Cerrar</button>
    </div>`;
}

/* ---------------- Con cuenta: pedido en revisión ---------------- */
let lateSig = "";
const lateIds = () => (H.orders() ?? []).filter((o) => isLate(o)).map((o) => o.id).join(",");
function isLate(o, now = Date.now()) {
  if (o.paidBy || o.status !== "payment_review" || o.method === "binance") return false;
  const dl = reviewDeadline(o.sentAt, hours());
  return !!dl && now > dl;
}
/** El texto de un pedido en revisión: hasta cuándo lo revisamos, o «Se demoró más de lo normal» con WhatsApp. */
export function revisionHtml(o, now = Date.now()) {
  const h = hours(), dl = reviewDeadline(o.sentAt, h);
  lateSig = lateIds();
  const push = alertsReady();
  const offer = push.configured && !push.on ? `<button class="sbtn sm" type="button" data-avisos="on" style="justify-self:start">🔔 Avisarme al celular cuando lo aprueben</button>` : "";
  const auto = `Esta pantalla se actualiza sola.`;
  if (!dl) return `<span class="empty">Estamos verificando tu pago. Lo revisamos en 10–30 minutos. Cuando esté listo, tus datos aparecen acá abajo. ${auto}</span>${offer}`;
  if (now <= dl) {
    const tomorrow = dayKey(dl) !== dayKey(now);
    return `<span class="empty">Estamos verificando tu pago (lo subiste a las ${esc(hhmm(o.sentAt))}). Lo revisamos <b>antes de las ${esc(hhmm(dl))}${tomorrow ? " de mañana" : ""}</b>. Cuando esté listo, tus datos aparecen acá abajo. ${auto}</span>${offer}`;
  }
  const late = closedText(h, now);
  const msg = `Hola 👋 Subí el comprobante de mi pedido ${o.id} (${pedidoNombre(o)} · ${bs(o.total)}) a las ${hhmm(o.sentAt)} del ${ddmm(o.sentAt)} y todavía está en revisión. ¿Me ayudás?`;
  return `<span class="empty">Estamos verificando tu pago (lo subiste a las ${esc(hhmm(o.sentAt))}).</span>
    <div class="dp-late"><b>⏳ Se demoró más de lo normal.</b><span class="empty">Perdón por la espera. Escribinos y lo revisamos: el mensaje ya lleva tu número de pedido.${late ? ` ${esc(late)}.` : ""}</span>
    ${wa() ? `<a class="sbtn dp-wa" href="${esc(waLink(wa(), msg))}" target="_blank" rel="noopener">${icon("wa")}Escribir por WhatsApp</a>` : ""}</div>${offer}`;
}

/* ---------------- Con cuenta: rechazado, arriba de todo ---------------- */
const REJ_DAYS = 7;
const rejKey = (id) => `gs-rej-ok-${id}`;
const rejHidden = (id) => { try { return !!localStorage.getItem(rejKey(id)); } catch { return false; } };
function rejMsg(o) {
  return `Hola 👋 Me rechazaron el pago del pedido ${o.id} (${pedidoNombre(o)} · ${bs(o.total)}, del ${ddmm(o.createdAt)})${o.rejectReason ? `. Motivo: ${o.rejectReason}` : ""}. Te mando mi comprobante 👇`;
}
/** Los pagos rechazados de los últimos 7 días, arriba de todo, con el motivo y qué hacer. */
export function rechazosArriba(orders = H.orders(), now = Date.now()) {
  const list = (orders ?? []).filter((o) => o.status === "rejected" && !o.paidBy && now - o.createdAt < REJ_DAYS * 864e5 && !rejHidden(o.id));
  return list.map((o) => `<div class="sbox dp-rej" data-rej="${esc(o.id)}"><h2>❌ No pudimos aprobar tu pago</h2>
    <p><b>${esc(pedidoNombre(o))} · ${bs(o.total)}</b> · ${ddmm(o.createdAt)}</p>
    ${o.rejectReason ? `<p>Motivo: ${esc(o.rejectReason)}</p>` : ""}
    <p class="dp-no">No pagues de nuevo: escribinos con tu comprobante y lo solucionamos.</p>
    <div class="rbtns">${wa() ? `<a class="sbtn dp-wa" href="${esc(waLink(wa(), rejMsg(o)))}" target="_blank" rel="noopener">${icon("wa")}Escribir por WhatsApp</a>` : `<span class="empty">Escribile a la tienda con tu comprobante.</span>`}
    <button class="sbtn" type="button" data-rejok="${esc(o.id)}">Ya lo solucioné · ocultar</button></div></div>`).join("");
}

/* ---------------- Historial y recibo ---------------- */
/** «Compra del 14/11 · Netflix + Disney+», «Renovación del 14/11 · Netflix», «Recarga de saldo del 14/11». */
export function historialTitulo(o) {
  if (o.kind === "topup") return `Recarga de saldo del ${ddmm(o.createdAt)}`;
  const what = o.kind === "renewal" ? (o.label || String(o.title || "").replace(/^Renovación\s*·?\s*/, "")) : o.title;
  return `${KIND_TEXT[o.kind] ?? "Pedido"} del ${ddmm(o.createdAt)}${what ? ` · ${what}` : ""}`;
}
/** Una línea del historial de pedidos. */
export function historialLinea(o) {
  const pill = o.status === "fulfilled" ? "sp-ok" : o.status === "payment_review" ? "sp-warn" : o.status === "rejected" ? "sp-bad" : "sp-mute";
  const paid = o.status === "fulfilled" && !o.paidBy && o.total != null;
  return `<div class="line dp-hist"><span>${esc(historialTitulo(o))}${o.method && !o.paidBy ? `<br><small class="empty">${esc(METHOD[o.method] ?? "")}</small>` : ""}</span>
    <span style="text-align:right">${o.paidBy ? "Lo pagó tu revendedor" : bs(o.total)}<br><span class="spill ${pill}">${STATUS_TEXT[o.status]}</span></span>
    ${o.status === "rejected" ? `<small class="empty rej" style="grid-column:1/-1;flex-basis:100%">❌ ${o.rejectReason ? `Motivo: ${esc(o.rejectReason)}. ` : ""}${o.paidBy ? "" : "No pagues de nuevo: escribinos con tu comprobante."}</small>` : ""}
    ${paid ? `<div class="rbtns" style="flex-basis:100%"><button class="sbtn sm" type="button" data-recibo="${esc(o.id)}">🧾 Recibo</button></div>` : ""}</div>`;
}
function reciboRows(o) {
  const st = H.settings() ?? {};
  return [["Tienda", st.storeName || ""], ["Qué compraste", pedidoNombre(o)], ["Monto", bs(o.total)], ["Fecha", `${ddmmyyyy(o.createdAt)} ${hhmm(o.createdAt)}`], ["Forma de pago", METHOD[o.method] ?? "—"], ["Estado", "Pagado ✓"], ["Nro. de pedido", o.id]].filter(([, v]) => v);
}
function openRecibo(o) {
  const m = document.getElementById("modal"), sc = document.getElementById("scrim");
  if (!m) return;
  m.innerHTML = `<div role="dialog" aria-modal="true" aria-labelledby="dpRecTit"><h2 style="font-size:22px;font-weight:800;display:flex;justify-content:space-between;align-items:center" id="dpRecTit">🧾 Recibo<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2>
    <div class="dp-recibo"><h3>Comprobante de compra</h3><dl>${reciboRows(o).map(([k, v]) => `<div><dt>${esc(k)}</dt><dd>${esc(v)}</dd></div>`).join("")}</dl>
    <small>Guardalo por si necesitás reclamar algo. Tus datos de acceso están en Mis cuentas.</small></div>
    <div class="pbtns"><button class="sbtn pri" type="button" data-recibodl="${esc(o.id)}">📥 Guardar recibo</button><button class="sbtn" type="button" data-close="1">Cerrar</button></div></div>`;
  m.hidden = false; if (sc) sc.hidden = false;
  m.querySelector("[data-recibodl]")?.focus();
}
/** Dibuja el recibo como imagen (para guardarlo en la galería o mandarlo). */
export function reciboCanvas(o) {
  const rows = reciboRows(o), W = 720, pad = 40, rowH = 56;
  const c = document.createElement("canvas");
  c.width = W; c.height = pad * 2 + 120 + rows.length * rowH + 60;
  const g = c.getContext("2d");
  g.fillStyle = "#ffffff"; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = "#111111"; g.font = "800 34px system-ui, sans-serif"; g.fillText("🧾 Comprobante de compra", pad, pad + 40);
  g.font = "500 22px system-ui, sans-serif"; g.fillStyle = "#444444"; g.fillText(H.settings()?.storeName || "", pad, pad + 80);
  let y = pad + 140;
  for (const [k, v] of rows) {
    g.fillStyle = "#555555"; g.font = "500 22px system-ui, sans-serif"; g.fillText(k, pad, y);
    g.fillStyle = "#111111"; g.font = "700 24px system-ui, sans-serif"; g.textAlign = "right";
    let t = String(v); while (g.measureText(t).width > W - pad * 2 - 220 && t.length > 4) t = t.slice(0, -2) + "…";
    g.fillText(t, W - pad, y); g.textAlign = "left";
    g.strokeStyle = "#dddddd"; g.setLineDash([6, 6]); g.beginPath(); g.moveTo(pad, y + 18); g.lineTo(W - pad, y + 18); g.stroke(); g.setLineDash([]);
    y += rowH;
  }
  g.fillStyle = "#555555"; g.font = "500 18px system-ui, sans-serif"; g.fillText(`Generado el ${ddmmyyyy(Date.now())}`, pad, y + 20);
  return c;
}
function saveRecibo(o) {
  const c = reciboCanvas(o);
  c.toBlob((blob) => {
    if (!blob) return toast("No pudimos guardar el recibo. Sacale una captura de pantalla.");
    const url = URL.createObjectURL(blob), a = document.createElement("a");
    a.href = url; a.download = `Recibo-${ddmmyyyy(o.createdAt).replace(/\//g, "-")}.png`;
    document.body.append(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 4000);
    toast("📥 Recibo guardado");
  }, "image/png");
}

/* ---------------- Se actualiza sola mientras hay un pago en revisión ---------------- */
let timer = null, sig = "";
const sigOf = (l) => (l ?? []).map((o) => `${o.id}:${o.status}`).join(",");
const reviewing = () => (H.orders() ?? []).some((o) => !o.paidBy && o.status === "payment_review");
/** Se llama en cada render: prende o apaga el refresco de cada 15 s. */
export function pagoAutoRefresh() {
  const on = H.loggedIn() && H.view() === "cuentas" && reviewing();
  if (!on) { if (timer) { clearInterval(timer); timer = null; } return; }
  sig = sigOf(H.orders());
  if (!timer) timer = setInterval(tick, POLL_MS);
}
async function tick() {
  if (document.hidden || H.view() !== "cuentas") return;
  try {
    const l = await api("GET", "/api/me/orders");
    if (sigOf(l) !== sig) {
      const before = new Map((H.orders() ?? []).map((o) => [o.id, o.status]));
      const done = l.filter((o) => before.get(o.id) === "payment_review" && o.status !== "payment_review");
      sig = sigOf(l);
      await H.refresh();
      const ok = done.find((o) => o.status === "fulfilled"), bad = done.find((o) => o.status === "rejected");
      if (ok) toast(`✅ ¡Listo! Aprobamos tu pago: ${pedidoNombre(ok)}`);
      else if (bad) toast("❌ No pudimos aprobar tu pago. Mirá arriba qué hacer.");
      return;
    }
    // Pasó la hora prometida: se muestra «Se demoró más de lo normal» (sin borrar lo que esté escribiendo).
    const busy = document.activeElement?.matches?.("input,textarea,select") || [...document.querySelectorAll("#sout input[type=file]")].some((x) => x.files?.length);
    if (lateIds() !== lateSig && !busy) H.render();
  } catch { /* sin conexión: se reintenta en 15 s */ }
}

/* ---------------- Clics ---------------- */
function onClick(ev) {
  const g = ev.target.closest?.("[data-gsent]");
  if (g) {
    // El enlace abre WhatsApp (no lo frenamos); el carrito pasa a «3 · Listo» si ya pagó.
    if (g.dataset.gsent === "ask") return;
    const href = g.getAttribute("href");
    setTimeout(() => {
      const d = document.getElementById("drawer");
      if (d) d.innerHTML = guestDoneHtml(href);
      H.clearCart();
      d?.querySelector("h2 .x")?.focus();
    }, 0);
    return;
  }
  const r = ev.target.closest?.("[data-recibo]");
  if (r) { const o = (H.orders() ?? []).find((x) => x.id === r.dataset.recibo); if (o) openRecibo(o); return; }
  const dl = ev.target.closest?.("[data-recibodl]");
  if (dl) { const o = (H.orders() ?? []).find((x) => x.id === dl.dataset.recibodl); if (o) saveRecibo(o); return; }
  const k = ev.target.closest?.("[data-rejok]");
  if (k) { try { localStorage.setItem(rejKey(k.dataset.rejok), "1"); } catch { /* sin almacenamiento */ } k.closest(".dp-rej")?.remove(); }
}

