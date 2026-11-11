// "💸 Que vuelvan": ventas que se pueden recuperar (pedidos sin terminar y servicios vencidos sin renovar).
// Fila guiada como la de invitar revendedores: una persona por vez, "Abrir WhatsApp" (wa.me, lo manda una
// persona) la marca como escrita y pasa a la siguiente. La vista se redibuja sola dentro de #wbRoot.
import { api, esc, bs, icon, toast, waLink } from "/common.js";

// La fila se congela al tocar "Empezar": guardamos a cada persona tal como estaba (aunque al marcarla deje de venir en la lista).
const W = { on: false, i: 0, queue: [], sent: {}, muted: {}, data: null };

const agoText = (d) => (d <= 0 ? "hoy" : d === 1 ? "ayer" : `hace ${d} días`);
const kindPill = (k) => `<span class="pp ${k === "revendedor" ? "pp-warn" : "pp-mute"}">${k === "revendedor" ? "Revendedor" : "Cliente"}</span>`;
const thingLine = (t) => `<li><b>${esc(t.product)}</b> · ${esc(t.what)} · ${agoText(t.days)} · <b>${bs(t.amount).replace(" ", "\u00a0")}</b>${t.usd !== undefined ? ` <small class="muted">(paga US$\u00a0${(t.usd / 100).toFixed(2)})</small>` : ""}</li>`;

async function load() {
  W.data = await api("GET", "/api/admin/winback");
  return W.data;
}

const sorted = (d) => [...d.pedidos, ...d.vencidos];

function summary(d) {
  const n = d.count;
  return `<section class="card wb-sum"><h2>💸 ${n ? `${n} venta${n === 1 ? "" : "s"} para recuperar · ${bs(d.amount)} en juego` : "No hay ventas para recuperar ahora ✨"}</h2>
    <p class="muted" style="margin:0">En los últimos 30 días le escribiste a <b>${d.written30}</b> y volvieron a comprar <b>${d.returned30}</b>.</p>
    <p class="muted" style="margin:0">Pedidos que quedaron sin pagar y servicios que vencieron hace 1 a 30 días. Los clientes de tus revendedores no salen acá: les escribe su revendedor.</p></section>`;
}

function stepCard() {
  const q = W.queue, cur = q[W.i];
  if (!cur) {
    const n = Object.keys(W.sent).length;
    return `<section class="card wb-row"><p style="margin:0">✅ ¡Listo! Recorriste ${q.length} persona(s)${n ? ` y le escribiste a ${n}` : ""}.</p><button class="pbtn sm" type="button" data-wb="stop" style="justify-self:start">Cerrar</button></section>`;
  }
  const done = W.sent[cur.customerId] ? `<span class="pp pp-ok">✅ Ya le escribiste</span>` : W.muted[cur.customerId] ? `<span class="pp pp-bad">🚫 No molestar</span>` : "";
  return `<section class="card wb-row" aria-live="polite"><div class="invstep">
      <div><small class="muted">${W.i + 1} de ${q.length}</small><b>${esc(cur.name)}</b>
        <span class="muted">${kindPill(cur.kind)} ${esc(cur.phone)} · ${bs(cur.amount)} ${done}</span></div>
      <ul class="wb-things">${cur.things.map(thingLine).join("")}</ul>
      <pre class="cobpre">${esc(cur.message)}</pre>
      ${cur.phone ? `<a class="pbtn green" href="${waLink(cur.phone, cur.message)}" target="_blank" rel="noopener" data-wbsent="${esc(cur.customerId)}">${icon("wa")}Abrir WhatsApp</a>` : `<span class="pp pp-warn">Sin WhatsApp</span>`}
      <div class="inline wb-acts">${W.i ? `<button class="pbtn sm" type="button" data-wb="prev">◀ Anterior</button>` : ""}<button class="pbtn sm" type="button" data-wb="next">Saltar ▶</button><button class="pbtn sm" type="button" data-wb="mute" data-id="${esc(cur.customerId)}" data-name="${esc(cur.name)}">🚫 No molestar</button><button class="pbtn sm" type="button" data-wb="stop">Terminar</button></div>
    </div></section>`;
}

function startCard(d) {
  if (!d.count) return "";
  return `<section class="card wb-row"><p class="muted" style="margin:0">Te armo una fila: ves a una persona, tocás <b>Abrir WhatsApp</b> con el mensaje listo y pasás a la siguiente. A quien le escribiste no vuelve a salir por 7 días.</p>
    <button class="pbtn dark" type="button" data-wb="start" style="justify-self:start">▶ Empezar (${d.count})</button></section>`;
}

function fullList(d) {
  if (!d.count) return "";
  const row = (it) => `<li class="wb-item"><div><b>${esc(it.name)}</b> ${kindPill(it.kind)} <span class="muted">${agoText(it.days)} · ${bs(it.amount)}</span></div>
      <ul class="wb-things">${it.things.map(thingLine).join("")}</ul>
      ${it.phone ? `<a class="pbtn sm green" href="${waLink(it.phone, it.message)}" target="_blank" rel="noopener" data-wbsent="${esc(it.customerId)}">${icon("wa")}WhatsApp a ${esc(it.name.split(" ")[0])}</a>` : ""}</li>`;
  const block = (title, l) => l.length ? `<h3>${title} <small class="muted">${l.length}</small></h3><ul class="wb-list">${l.map(row).join("")}</ul>` : "";
  return `<details class="card wb-full"><summary>Ver la lista completa (${d.count})</summary>
    ${block("🛒 Pedidos sin terminar", d.pedidos)}${block("⏰ Se les venció y no renovaron", d.vencidos)}</details>`;
}

function html(d) {
  return summary(d) + (W.on ? stepCard() : startCard(d)) + fullList(d);
}

async function redraw() {
  const root = document.getElementById("wbRoot");
  if (!root) return;
  try { root.innerHTML = html(await load()); } catch (e) { toast(e.message); }
}

/** La vista completa (la llama el panel). */
export async function winbackView() {
  return `<div id="wbRoot" class="wb">${html(await load())}</div>`;
}

/** Tarjeta chica para Inicio: solo si hay al menos una venta para recuperar. */
export async function winbackHomeCard() {
  const d = await api("GET", "/api/admin/winback").catch(() => null);
  if (!d?.count) return "";
  return `<section class="card wb-home"><h2>💸 ${d.count} venta${d.count === 1 ? "" : "s"} para recuperar · ${bs(d.amount)}</h2>
    <p class="muted" style="margin:0">Pedidos sin pagar y servicios que vencieron y no renovaron. Un WhatsApp a tiempo y vuelven.</p>
    <button class="pbtn dark" type="button" data-go="quevuelvan">▶ Ver a quién escribirle</button></section>`;
}

const mark = (id, outcome) => api("POST", `/api/admin/winback/${encodeURIComponent(id)}`, { outcome });

// La delegación de clics del panel solo cubre <button>: el enlace de WhatsApp va con su propio listener.
document.addEventListener("click", (ev) => {
  const a = ev.target.closest?.("a[data-wbsent]");
  if (!a) return;
  const id = a.dataset.wbsent;
  mark(id, "escrito").catch((e) => toast(e.message));
  W.sent[id] = true;
  if (W.on && W.queue[W.i]?.customerId === id) W.i++;
  setTimeout(redraw, 300);
});

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest?.("button[data-wb]");
  if (!b) return;
  const act = b.dataset.wb;
  if (act === "start") { W.queue = sorted(W.data ?? (await load())); W.on = true; W.i = 0; W.sent = {}; W.muted = {}; }
  if (act === "stop") { W.on = false; W.i = 0; W.queue = []; }
  if (act === "next") W.i++;
  if (act === "prev") W.i = Math.max(0, W.i - 1);
  if (act === "mute") {
    if (!confirm(`¿No molestar a ${b.dataset.name}? No va a salir acá por 60 días.`)) return;
    try { await mark(b.dataset.id, "no_molestar"); } catch (e) { return toast(e.message); }
    W.muted[b.dataset.id] = true;
    toast(`🚫 ${b.dataset.name} no sale por 60 días`);
    W.i++;
  }
  await redraw();
  document.querySelector(".wb-row")?.scrollIntoView({ block: "nearest" });
});
