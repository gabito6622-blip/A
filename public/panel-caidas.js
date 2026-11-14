// Cuentas caídas sin sorpresas (revisión de 3 meses, 14/11/2026): lo que el panel muestra y hace con una cuenta que
// se cayó, que no se vende más o que hay que pagar. Acá vive la lógica; panel.js solo la llama.
//  - Tarjeta de la cuenta: «⚠️ Se cayó, todavía no la muevo», «✅ Volvió a funcionar», «🚫 No vender más»,
//    «💳 Pagué la renovación» (sin abrir Editar ni mostrar la clave) y «💳 Pagar varias» del mismo proveedor.
//  - Fila de envíos después de mover: no se pierde al recargar (solo ids, nunca datos ni claves) y pregunta
//    «¿La cuenta vieja murió? → Retirarla».
//  - Carga de cuentas: una fecha del proveedor a más de 35 días pregunta «¿Pagaste N meses?» antes de guardar.
//  - Cortes: en el celular cada cuenta se pliega (antes medía 24 pantallas).
import { esc, bs, fdate, toast } from "/common.js";

const DAY = 86_400_000;
const SQ_KEY = "gs-sendq";
let C = null; // contexto del panel: { api, render, go, P, canReview }

/* ───────── Fila de envíos que sobrevive a una recarga ───────── */
/** Lo que se guarda: ids y por dónde iba. Los mensajes (con la clave) se vuelven a pedir al servidor. */
export function sendqSave(sq) {
  try {
    if (!sq) { localStorage.removeItem(SQ_KEY); return; }
    const { ids, i, sent, title, from, fromDone, change, note } = sq;
    localStorage.setItem(SQ_KEY, JSON.stringify({ ids, i, sent, title, from, fromDone, change, note, at: Date.now() }));
  } catch { /* sin almacenamiento: la fila vive hasta recargar */ }
}
export function sendqLoad() {
  try {
    const v = JSON.parse(localStorage.getItem(SQ_KEY) || "null");
    if (!v || !Array.isArray(v.ids) || !v.ids.length || Date.now() - (v.at ?? 0) > 3 * DAY) return undefined;
    return { ids: v.ids.map(String), i: Math.max(0, +v.i || 0), sent: v.sent && typeof v.sent === "object" ? v.sent : {}, title: v.title ?? "", from: v.from, fromDone: v.fromDone, change: v.change !== false, note: v.note };
  } catch { return undefined; }
}
export const sendqClear = () => sendqSave(null);
/** Una fila nueva para mandar los datos nuevos: ya guardada. */
export function sendqStart(P, ids, opts = {}) {
  P.tab.sendq = { ids, i: 0, sent: {}, change: true, ...opts };
  sendqSave(P.tab.sendq);
  const t = document.getElementById("toast"); if (t) t.hidden = true; // un cartel viejo no tapa «Enviar por WhatsApp»
  return P.tab.sendq;
}
/** URL de los datos a mandar: después de mover dice «Cambiamos tu cuenta…» en vez de «¡Gracias por tu compra!». */
export const sendqUrl = (sq, id) => `/api/admin/assignments/${encodeURIComponent(id)}/delivery${sq.change ? "?cambio=1" : ""}`;

/** Arriba de la fila: el resultado (en vez de un cartel que tapaba «Enviar por WhatsApp»). */
export const sendqTop = (sq) => sq.note ? `<p class="cx-note" role="status">${esc(sq.note)}</p>` : "";
/** Abajo de la fila (para no correr el botón de WhatsApp fuera de la pantalla): «¿La cuenta vieja murió?». */
export function sendqAsk(sq) {
  if (!sq.from) return "";
  if (sq.fromDone === "retired") return `<p class="cx-note">🗑️ ${esc(sq.from.email)} quedó retirada: no se vende ni pide renovación.</p>`;
  if (sq.fromDone) return "";
  return `<div class="cx-ask" role="group" aria-label="¿La cuenta vieja murió?"><b>¿La cuenta vieja murió?</b><small class="muted">${esc(sq.from.email)}</small>
    <div class="inline"><button class="pbtn sm dark" type="button" data-cxretireq="yes">🗑️ Sí, retirarla</button><button class="pbtn sm" type="button" data-cxretireq="no">No, sigue andando</button></div>
    <small class="muted">Si la retirás, no se vende más y deja de pedirte la renovación al proveedor.</small></div>`;
}

/* ───────── Tarjeta de la cuenta ───────── */
const clientsOf = (a) => a.slots.filter((s) => s.status === "assigned").length;
/** Cartel arriba de la tarjeta: caída con N clientes, o por qué no se vende. */
export function accBanner(a) {
  if (a.status !== "active") return "";
  if (a.fallen) {
    const n = clientsOf(a);
    return `<div class="cx-ban bad" role="status">⚠️ <b>Cuenta caída</b> desde el ${fdate(a.fallen.at)}${n ? ` · <b>${n} cliente${n === 1 ? "" : "s"} sin servicio</b>: movelos` : " · sin clientes adentro"}. No se vende y no pide renovación.${n ? `<div class="inline" style="margin-top:6px"><button class="pbtn sm dark" type="button" data-go="reubicar">🔀 Reubicar ${n}</button></div>` : ""}</div>`;
  }
  if (a.noSell) return `<p class="cx-ban warn">🚫 <b>No se vende más.</b> Sus clientes siguen como están.</p>`;
  if (a.sellBlock === "nota") return `<p class="cx-ban warn">🚫 La nota dice CAÍDA / NO VENDER: <b>no se vende</b>. Sus clientes siguen como están.</p>`;
  return "";
}
/** Botones de la tarjeta (solo dueño/admin). */
export function accButtons(a) {
  if (a.status !== "active") return "";
  const n = clientsOf(a);
  return [
    !a.fallen ? `<button class="pbtn sm" type="button" data-cxpay="${esc(a.id)}">💳 Pagué la renovación</button>` : "",
    a.fallen ? `<button class="pbtn sm green" type="button" data-cxunfall="${esc(a.id)}">✅ Volvió a funcionar</button>` : "",
    a.fallen && !n ? `<button class="pbtn sm dark" type="button" data-cxretire="${esc(a.id)}" data-email="${esc(a.email)}">🗑️ Retirar</button>` : "",
    !a.fallen ? `<button class="pbtn sm" type="button" data-cxnosell="${esc(a.id)}" data-on="${a.noSell ? "0" : "1"}">${a.noSell ? "✅ Volver a vender" : "🚫 No vender más"}</button>` : "",
  ].join("");
}
/** Dentro de «Cuenta caída»: marcarla sin mover a nadie todavía. */
export const fallOnlyBtn = (a) => a.status === "active" && !a.fallen
  ? `<button class="pbtn sm" type="button" data-cxfall="${esc(a.id)}" data-email="${esc(a.email)}" data-n="${clientsOf(a)}">⚠️ Se cayó, todavía no la muevo</button>` : "";
/** Perfil libre de una cuenta que no se vende: en vez de «Asignar», el motivo. */
export const slotBlocked = (acc) => acc?.fallen || acc?.sellBlock
  ? `<p class="cx-ban warn" style="margin:0">${acc.fallen ? "⚠️ Esta cuenta está caída" : "🚫 Esta cuenta está en «No vender más»"}: sus perfiles no se venden ni se asignan.</p>` : "";

/** «💳 Pagué la renovación» (el mismo formulario de Editar, sin la clave). `dayRate`: tasa del día si se paga en US$. */
export function payForm(a, dayRate, sym) {
  return `<p class="muted" style="margin:0">Anota el pago como gasto (para tu ganancia real) y corre el vencimiento con el proveedor, manteniendo el día de cobro. Hoy vence el <b>${fdate(a.supplierExpiresAt)}</b>.</p>
        <form class="form" data-renewpaid="${esc(a.id)}">
          ${a.costUsd ? `<label>¿Cuántos dólares te cobró la tarjeta? (US$)<input name="usd" inputmode="decimal" required data-usdcalc="1" data-usdper="${a.costUsd}" value="${(a.costUsd / 100).toFixed(2)}"></label>
          <label>Tasa (Bs por US$) <small class="muted">${dayRate ? "la del Banco Central de hoy; cambiala si tu banco cobró otra" : "poné la que cobró tu banco"}</small><input name="rate" inputmode="decimal" required data-usdcalc="1" value="${dayRate || ""}" placeholder="Ej.: 11,71"></label>` : ""}
          <label>¿Cuánto pagaste? (${esc(sym)})${a.costUsd ? ` <small class="muted">= dólares × tasa</small>` : ""}<input name="amount" inputmode="decimal" required value="${a.costUsd && dayRate ? (Math.round(a.costUsd * dayRate) / 100).toFixed(2) : a.cost ? a.cost / 100 : ""}" placeholder="Ej.: 66"></label>
          <label>¿Cuántos meses?<select name="months"${a.costUsd ? ` data-usdcalc="1"` : ""}>${[1, 2, 3, 6, 12].map((m) => `<option value="${m}" ${m === 1 ? "selected" : ""}>${m === 1 ? "1 mes" : `${m} meses`}</option>`).join("")}</select></label>
          <button class="pbtn dark" type="submit" style="grid-column:1/-1">💳 Registrar pago y renovar</button></form>`;
}
/** Tarjeta suelta de «💳 Pagué la renovación» abierta desde la tarjeta de la cuenta. */
export async function payCard(accs, tab, pname, sym) {
  const a = accs.find((x) => x.id === tab.cxPay);
  if (!a || a.status !== "active") return "";
  const dayRate = a.costUsd ? Number((await C.api("GET", "/api/admin/usdt").catch(() => null))?.rate) || 0 : 0;
  return `<section class="card ok-card" id="cxPayCard"><h2>💳 Pagué la renovación <small>· ${esc(pname(a.productId))} · ${esc(a.email)}</small></h2>
    ${payForm(a, dayRate, sym)}<div class="inline"><button class="pbtn sm" type="button" data-cxpay="">Cerrar</button></div></section>`;
}
/** «💳 Pagar varias»: cuentas del mismo proveedor, cada una con su monto, y los meses para todas. */
export function payManyCard(accs, suppliers, tab, pname, sym) {
  if (!tab.cxMany) return "";
  const live = accs.filter((a) => a.status === "active" && !a.fallen);
  const sups = [...new Set(live.map((a) => a.supplierId))].map((id) => ({ id, name: id === "propias" ? "Propias (tuyas)" : suppliers.find((s) => s.id === id)?.name ?? id }));
  const sup = sups.some((s) => s.id === tab.cxManySup) ? tab.cxManySup : sups[0]?.id;
  const list = live.filter((a) => a.supplierId === sup).sort((x, y) => x.supplierExpiresAt - y.supplierExpiresAt);
  return `<section class="card ok-card" id="cxManyCard"><h2>💳 Pagar varias <small>· del mismo proveedor, juntas</small></h2>
    <p class="muted" style="margin:0">Marcá las cuentas que pagaste. Cada una corre su vencimiento los meses elegidos y queda anotada como gasto, igual que «Pagué la renovación».</p>
    <form class="form cx-many" id="cxPayMany">
      <label style="grid-column:1/-1">Proveedor<select name="sup" data-cxmanysup="1">${sups.map((s) => `<option value="${esc(s.id)}" ${s.id === sup ? "selected" : ""}>${esc(s.name)}</option>`).join("")}</select></label>
      <div class="cx-many-list" style="grid-column:1/-1">${list.map((a) => `<div class="cx-many-row"><label class="chk"><input type="checkbox" name="pick" value="${esc(a.id)}" ${a.supplierExpiresAt - Date.now() <= 7 * DAY ? "checked" : ""}> <span><b>${esc(pname(a.productId))}</b> <span class="mono">${esc(a.email)}</span><br><small class="muted">vence ${fdate(a.supplierExpiresAt)}</small></span></label>
        <label class="cx-amt">${esc(sym)}<input name="amt-${esc(a.id)}" inputmode="decimal" value="${a.cost ? a.cost / 100 : ""}" aria-label="Cuánto pagaste por ${esc(a.email)}"></label></div>`).join("") || `<p class="muted" style="margin:0">Ese proveedor no tiene cuentas activas.</p>`}</div>
      <label>¿Cuántos meses?<select name="months">${[1, 2, 3, 6, 12].map((m) => `<option value="${m}">${m === 1 ? "1 mes" : `${m} meses`}</option>`).join("")}</select></label>
      <p class="cx-total" id="cxManyTotal" style="grid-column:1/-1" role="status"></p>
      <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">💳 Anotar los pagos</button><button class="pbtn" type="button" data-cxmany="0">Cerrar</button></div></form></section>`;
}
const toCentsTxt = (v) => { const n = parseFloat(String(v ?? "").replace(/^bs\.?\s*/i, "").replace(",", ".")); return Number.isFinite(n) ? Math.round(n * 100) : NaN; };
function manyTotal(f) {
  const picked = [...f.querySelectorAll('input[name="pick"]:checked')];
  const tot = picked.reduce((t, x) => t + (toCentsTxt(f[`amt-${x.value}`]?.value) || 0), 0);
  const out = f.querySelector("#cxManyTotal");
  if (out) out.textContent = picked.length ? `${picked.length} cuenta${picked.length === 1 ? "" : "s"} · ${bs(tot)} por mes` : "Marcá al menos una cuenta.";
}

/* ───────── Carga de cuentas: fecha sospechosa ───────── */
const dayDiff = (t) => Math.round((t - Date.now()) / DAY);
/** ¿Hay que preguntar por esta fecha? → texto de la pregunta, o null. */
export function suspiciousDate(t) {
  if (!Number.isFinite(t)) return null;
  const d = dayDiff(t);
  if (d < 0) return { past: true, text: `Esa fecha (${fdate(t)}) ya pasó. Revisá el año antes de guardar.` };
  if (d > 35) { const n = Math.max(2, Math.round(d / 30)); return { months: n, text: `Vence en ${d} días (${fdate(t)}). ¿Pagaste ${n} meses al proveedor?` }; }
  return null;
}
/**
 * Formularios de una cuenta (carga rápida, con detalles, IPTV): si la fecha es sospechosa, se agrega la pregunta junto
 * al campo con «Sí, pagué N meses» y no se guarda hasta marcarla (para ESA fecha). Devuelve true si se puede guardar.
 */
export function expiryOk(f) {
  if (!f.exp?.value) return true;
  const t = new Date(f.exp.value + "T23:59:00").getTime(), q = suspiciousDate(t);
  const old = f.querySelector(".cx-expq");
  if (!q) { old?.remove(); return true; }
  if (!q.past && old && old.dataset.for === f.exp.value && old.querySelector("input")?.checked) return true;
  old?.remove();
  const box = document.createElement("div");
  box.className = "cx-expq"; box.dataset.for = f.exp.value; box.setAttribute("role", "alert");
  box.innerHTML = `<small class="perr-inline">${esc(q.text)}</small>${q.past ? "" : `<label class="chk"><input type="checkbox" name="expOk"> Sí, pagué ${q.months} meses (guardar igual)</label>`}`;
  f.exp.closest("label")?.after(box);
  f.exp.setAttribute("aria-invalid", "true");
  (box.querySelector("input") ?? f.exp).focus();
  return false;
}
/** Carga por lista: las líneas con fecha sospechosa se preguntan juntas antes de cargar. */
export function bulkDatesOk(f, parsed) {
  const out = f.ownerDocument.querySelector("#bulkOut");
  const bad = parsed.map((r) => ({ r, q: suspiciousDate(r.exp) })).filter((x) => x.q);
  const past = bad.filter((x) => x.q.past), far = bad.filter((x) => !x.q.past);
  const key = far.map((x) => `${x.r.i}:${x.r.exp}`).join("|");
  if (past.length) { out.innerHTML = `<div class="perr">No se cargó nada. Estas fechas ya pasaron:<br>${past.map((x) => `Línea ${x.r.i + 1}: ${esc(fdate(x.r.exp))}`).join("<br>")}</div>`; return false; }
  if (!far.length) return true;
  const ok = out.querySelector('input[name="bulkExpOk"]');
  if (ok?.checked && ok.dataset.for === key) return true;
  out.innerHTML = `<div class="cx-expq" role="alert"><small class="perr-inline">Estas cuentas vencen en más de 35 días: ${far.map((x) => `línea ${x.r.i + 1} (${fdate(x.r.exp)} · ${x.q.months} meses)`).join(", ")}. ¿Las pagaste por adelantado?</small>
    <label class="chk"><input type="checkbox" name="bulkExpOk" data-for="${esc(key)}"> Sí, las pagué así (cargar igual)</label></div>`;
  out.querySelector("input")?.focus();
  return false;
}

/* ───────── Cortes: plegado por cuenta en el celular ───────── */
export function cortesView(list, only, h) {
  const { table, pill, riskPill } = h;
  const narrow = typeof matchMedia === "function" && matchMedia("(max-width: 700px)").matches;
  const shown = list.filter((x) => only === "todas" || !x.aligned);
  const sign = (n) => (n > 0 ? `+${n}` : String(n));
  const row = (pr) => `<tr><td><b>${esc(pr.label)}</b></td><td>${pr.customer ? `${esc(pr.customer)}${pr.phone ? `<br><small class="muted">${esc(pr.phone)}</small>` : ""}` : `<span class="muted">${pr.status === "available" ? "libre" : pr.status === "quarantined" ? "apartado" : esc(pr.status)}</span>`}</td>
      <td>${pr.expiresAt ? fdate(pr.expiresAt) : "—"}</td><td>${pr.diffDays === undefined ? "" : pr.diffDays === 0 ? pill("al día", "ok") : pr.diffDays > 0 ? pill(`${sign(pr.diffDays)} d · le sobran`, "warn") : pill(`${sign(pr.diffDays)} d · le faltan`, "bad")}</td></tr>`;
  const card = (x) => `<details class="card cutcard cx-cut" ${narrow ? "" : "open"}>
      <summary class="cuthead"><div><b>${esc(x.product)}</b><br><small class="mono">${esc(x.email)}</small><br><small class="muted">Corte ${fdate(x.suggestedCut)} · ${x.clients} cliente${x.clients === 1 ? "" : "s"} · ${x.spreadDays} d de diferencia</small></div>${riskPill(x.risk)}</summary>
      <div class="cutsum"><div><small>Corte sugerido</small><b>${fdate(x.suggestedCut)}</b></div><div><small>Clientes</small><b>${x.clients}</b></div><div><small>Diferencia</small><b class="${x.spreadDays ? "down" : "up"}">${x.spreadDays} d</b></div><div><small>Proveedor</small><b>${fdate(x.supplierExpiresAt)}</b></div></div>
      ${x.cappedBySupplier ? `<p class="cx-ban warn" style="margin:0">📅 La cuenta vence con el proveedor el <b>${fdate(x.supplierExpiresAt)}</b>: el corte no puede ser después. A quien vence más tarde, renová la cuenta antes o pasalo a otra.</p>` : ""}
      ${x.aligned ? `<p class="pok">✅ Todos vencen el mismo día.</p>` : `<p class="muted" style="margin:0">La fecha sugerida es la que más se repite (sin pasar la del proveedor). A quien le sobran días, al cortar le podés dar ese tiempo de regalo en su próximo mes; a quien le faltan, cobrale solo los días hasta el corte.</p>`}
      ${table(["Perfil", "Cliente", "Vence", "Respecto del corte"], x.profiles.map(row), "Sin perfiles.")}
      <footer class="inline"><button class="pbtn sm" type="button" data-rotate="${esc(x.accountId)}">🔑 Cambié la clave</button><button class="pbtn sm" type="button" data-go="cuentas">Ver en Cuentas</button>${x.passwordChangedAt ? `<small class="muted">Última clave: ${fdate(x.passwordChangedAt)}</small>` : ""}</footer></details>`;
  return `<section class="card"><h2>✂️ Cortes <small>· cuentas por perfiles con clientes que vencen en fechas distintas</small></h2>
      <p class="muted" style="margin:0">Para ordenar una cuenta se elige una sola fecha de corte: ese día cambiás la clave y todos arrancan juntos. Acá no se cambia nada: es para decidir.${narrow ? " Tocá una cuenta para ver sus perfiles." : ""}</p>
      <div class="tabs ctl-chips" role="tablist">${[["des", `Desalineadas (${list.filter((x) => !x.aligned).length})`], ["todas", `Todas (${list.length})`]].map(([k, l]) => `<button type="button" role="tab" data-tab="cutOnly:${k}" aria-selected="${only === k}">${l}</button>`).join("")}</div></section>
      ${shown.map(card).join("") || `<section class="card"><div class="emptybox">${list.length ? "Todas tus cuentas por perfiles están alineadas 🎉" : "Todavía no hay cuentas por perfiles con clientes adentro."}</div></section>`}`;
}

/* ───────── Acciones ───────── */
async function run(fn, ok) {
  try { const r = await fn(); if (ok) toast(typeof ok === "function" ? ok(r) : ok); await C.render(); return r; }
  catch (e) { if (e.status === 401) return location.reload(); toast(e.message); }
}
async function onClick(ev) {
  const el = ev.target.closest?.("button");
  if (!el || !C) return;
  const d = el.dataset, P = C.P;
  if (d.cxpay !== undefined) { P.tab.cxPay = d.cxpay || null; await C.render(); if (d.cxpay) document.getElementById("cxPayCard")?.scrollIntoView({ block: "start" }); return; }
  if (d.cxmany !== undefined) { P.tab.cxMany = d.cxmany === "1"; await C.render(); if (P.tab.cxMany) document.getElementById("cxManyCard")?.scrollIntoView({ block: "start" }); return; }
  if (d.cxfall) {
    if (!confirm(`¿Marcar ${d.email} como caída?\n\nDeja de venderse y de pedir renovación. ${+d.n ? `Sus ${d.n} cliente(s) quedan en Reubicar (en rojo) hasta que los muevas.` : "No tiene clientes adentro."}`)) return;
    return run(() => C.api("POST", `/api/admin/accounts/${d.cxfall}/fallen`, { reason: "Se cayó (todavía sin mover)" }), (r) => r.clients ? `⚠️ Marcada caída: ${r.clients} cliente(s) para mover en Reubicar` : "⚠️ Marcada caída: ya no se vende");
  }
  if (d.cxunfall) {
    if (!confirm("¿La cuenta volvió a funcionar?\n\nSale la marca de caída. Sus perfiles apartados siguen apartados: liberalos cuando cambies la clave.")) return;
    return run(() => C.api("POST", `/api/admin/accounts/${d.cxunfall}/fallen/undo`, {}), "✅ Ya no está marcada como caída");
  }
  if (d.cxnosell) {
    const on = d.on === "1";
    return run(() => C.api("POST", `/api/admin/accounts/${d.cxnosell}/no-sell`, { on }), on ? "🚫 Ya no se vende. Sus clientes siguen igual" : "✅ Vuelve a venderse");
  }
  if (d.cxretire) {
    if (!confirm(`¿Retirar ${d.email}?\n\nNo se vende más y deja de pedir renovación. Queda en el historial.`)) return;
    return run(() => C.api("POST", `/api/admin/accounts/${d.cxretire}/retire`, { reason: "Cuenta caída" }), "🗑️ Cuenta retirada");
  }
  if (d.cxretireq) {
    const sq = P.tab.sendq; if (!sq?.from) return;
    if (d.cxretireq === "no") { sq.fromDone = "kept"; sendqSave(sq); return C.render(); }
    el.disabled = true;
    try { await C.api("POST", `/api/admin/accounts/${sq.from.id}/retire`, { reason: "Murió: sus clientes pasaron a otra cuenta" }); sq.fromDone = "retired"; sendqSave(sq); }
    catch (e) { toast(e.message); el.disabled = false; return; }
    return C.render();
  }
}
async function onSubmit(ev) {
  const f = ev.target;
  if (!C || f.id !== "cxPayMany") return;
  ev.preventDefault();
  const picked = [...f.querySelectorAll('input[name="pick"]:checked')].map((x) => x.value);
  for (const e of f.querySelectorAll(".perr-inline")) e.remove();
  const err = (text) => { const m = document.createElement("small"); m.className = "perr-inline"; m.setAttribute("role", "alert"); m.textContent = text; f.querySelector("#cxManyTotal")?.after(m); };
  if (!picked.length) return err("Marcá al menos una cuenta.");
  const items = picked.map((id) => ({ accountId: id, amount: toCentsTxt(f[`amt-${id}`]?.value) }));
  if (items.some((x) => !(x.amount > 0))) return err("Poné cuánto pagaste por cada cuenta marcada.");
  const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
  try {
    const r = await C.api("POST", "/api/admin/accounts/renew-paid-many", { items, months: +f.months.value });
    C.P.tab.cxMany = false;
    toast(`✅ ${r.paid} pago${r.paid === 1 ? "" : "s"} anotado${r.paid === 1 ? "" : "s"} (${bs(r.total)})`);
    await C.render();
  } catch (e) { err(e.message); btn.disabled = false; }
}
function onChange(ev) {
  const t = ev.target;
  if (!C) return;
  if (t?.dataset?.cxmanysup) { C.P.tab.cxManySup = t.value; return C.render(); }
  const f = t?.closest?.("#cxPayMany"); if (f) manyTotal(f);
}
/** Una sola vez, desde panel.js. */
export function initCaidas(ctx) {
  if (C) return;
  C = ctx;
  document.addEventListener("click", onClick);
  document.addEventListener("submit", onSubmit);
  document.addEventListener("change", onChange);
  document.addEventListener("input", (ev) => { const f = ev.target?.closest?.("#cxPayMany"); if (f) manyTotal(f); });
}
/** Después de pintar Cuentas: el total de «Pagar varias». */
export function afterRender() { const f = document.getElementById("cxPayMany"); if (f) manyTotal(f); }
