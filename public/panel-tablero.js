// 🗂️ Tablero de revendedores (15/11/2026). El dueño: «para los revendedores, bajar por cada cuenta me quita tiempo».
// Una fila por revendedor, con sus cuentas como etiquetas chiquitas (color según cuántos días le quedan) y dos botones:
// «📲 Cobrar» (WhatsApp listo con lo que vence) y «💵 Me pagó todo» (el mismo de Revendedores, con su total y frenos).
// Primero los que tienen algo vencido, después los que vencen en 7 días, los que deben y al final los que están al día.
// Tocar una etiqueta abre esa cuenta en Inventario → Cuentas con sus botones (Renovar, Liberar, Enviar accesos…).
// Nada se manda solo: «Cobrar» abre el WhatsApp de UNA persona con el mensaje escrito.
import { api, esc, bs, fdate, waLink, icon } from "/common.js";

const DAY = 864e5;
/** Días que le quedan (negativo = vencido), contando por día de Bolivia. */
const boDay = (t) => Math.floor((t - 4 * 3600e3) / DAY);
export const daysTo = (t, now = Date.now()) => boDay(t) - boDay(now);
/** «Disney Premium + ESPN (alquiler revendedores)» → «Disney ESPN». */
export const shortProduct = (n) => String(n ?? "").replace(/\s*\(alquiler revendedores\)\s*/i, "").replace(/\bPremium\b\s*/i, "").replace(/\s*\+\s*/g, " ").replace(/\s+/g, " ").trim();
/** Estado de una cuenta para el color de su etiqueta. */
export function chipState(a, now = Date.now()) {
  if (a.holdOpen) return "wait";
  const d = daysTo(a.customerExpiresAt, now);
  if (d < 0) return "exp";
  if (d <= 3) return "soon";
  if (d <= 7) return "week";
  return "ok";
}
const STATE_TXT = { exp: "venció", soon: "vence", week: "vence", ok: "vence", wait: "esperando fecha" };

/** Agrupa los alquileres activos por el revendedor que los paga y arma cada fila del tablero. */
export function buildRows(list, assignments, now = Date.now()) {
  const by = new Map();
  for (const a of assignments) {
    const rid = a.customerKind === "reseller" ? a.customerId : a.resellerId;
    if (!rid) continue;
    if (!by.has(rid)) by.set(rid, []);
    by.get(rid).push(a);
  }
  return list.map((r) => {
    const items = (by.get(r.id) ?? []).slice().sort((x, y) => x.customerExpiresAt - y.customerExpiresAt);
    const st = items.map((a) => chipState(a, now));
    const venc = st.filter((s) => s === "exp").length, pronto = st.filter((s) => s === "soon" || s === "week").length, espera = st.filter((s) => s === "wait").length;
    const due = items.filter((a, i) => st[i] === "exp" || st[i] === "soon" || st[i] === "week");
    const next = items.find((a) => !a.holdOpen);
    const urg = venc ? 0 : pronto ? 1 : r.debt > 0 ? 2 : items.length ? 3 : 4;
    return { ...r, items, venc, pronto, espera, due, dueTotal: due.reduce((t, a) => t + (a.effectivePrice ?? 0), 0), next, urg };
  }).sort((x, y) => x.urg - y.urg || (x.next?.customerExpiresAt ?? Infinity) - (y.next?.customerExpiresAt ?? Infinity) || x.name.localeCompare(y.name, "es"));
}

/** WhatsApp para cobrarle: lo que venció o vence en 7 días, con el total, y lo que debe si debe. */
export function cobrarMsg(r, now = Date.now()) {
  const n = (r.name || "").split(" · ").pop().split(" ")[0] || (r.name || "").split(" ")[0];
  const lines = r.due.map((a) => `• ${shortProduct(a.product)} (${a.email}) — ${daysTo(a.customerExpiresAt, now) < 0 ? "venció" : "vence"} el ${fdate(a.customerExpiresAt)}: ${bs(a.effectivePrice ?? 0)}`);
  const parts = [`Hola ${n} 👋`];
  if (lines.length) parts.push(`Te paso tus alquileres para renovar:\n${lines.join("\n")}\nTotal: ${bs(r.dueTotal)}`);
  if (r.debt > 0) parts.push(`${lines.length ? "Además" : "Te recuerdo que"} tenés pendiente ${bs(r.debt)}.`);
  parts.push("¿Me confirmás? ¡Gracias! 🙌");
  return parts.join("\n");
}

const FILTERS = [["todos", "Todos"], ["urgente", "⚠️ Para cobrar"], ["deben", "💸 Deben"], ["aldia", "✅ Al día"], ["sin", "💤 Sin cuentas"]];
const pass = (f, r) => f === "todos" || (f === "urgente" ? r.urg <= 1 : f === "deben" ? r.debt > 0 : f === "aldia" ? r.urg === 3 : r.urg === 4);

export async function tableroView(T, { paidAllBtn, canReview }) {
  const [ov, as] = await Promise.all([api("GET", "/api/admin/resellers/overview"), api("GET", "/api/admin/assignments")]);
  const now = Date.now();
  const all = buildRows(ov.list, as, now);
  const f = FILTERS.some(([k]) => k === T.tbf) ? T.tbf : "todos";
  const q = String(T.tbq ?? "").trim().toLowerCase();
  const shown = all.filter((r) => pass(f, r) && (!q || `${r.name} ${r.items.map((a) => a.email).join(" ")}`.toLowerCase().includes(q)));
  const cuentas = all.reduce((t, r) => t + r.items.length, 0), venc = all.reduce((t, r) => t + r.venc, 0), pronto = all.reduce((t, r) => t + r.pronto, 0);
  const porCobrar = all.reduce((t, r) => t + r.dueTotal, 0), deben = all.reduce((t, r) => t + (r.debt > 0 ? r.debt : 0), 0);
  const chip = (a) => {
    const s = chipState(a, now), d = daysTo(a.customerExpiresAt, now);
    const when = s === "wait" ? "esperando fecha" : `${STATE_TXT[s]} ${fdate(a.customerExpiresAt).slice(0, 5)}`;
    const who = a.customerKind === "reseller" ? "" : ` · cliente: ${a.customerName}`;
    return `<button type="button" class="tbchip tbc-${s}" data-tbslot="${esc(a.slotId)}" data-q="${esc(a.email)}" title="${esc(`${a.product} · ${a.email} · ${when}${who}`)}"><b>${esc(shortProduct(a.product))}</b> ${esc(a.email.split("@")[0])} <small>${s === "wait" ? "sin fecha" : d < 0 ? `venció ${fdate(a.customerExpiresAt).slice(0, 5)}` : fdate(a.customerExpiresAt).slice(0, 5)}</small></button>`;
  };
  const row = (r) => {
    const pills = [r.venc ? `<span class="tbp tbp-bad">⚠️ ${r.venc} vencida${r.venc === 1 ? "" : "s"}</span>` : "", r.pronto ? `<span class="tbp tbp-warn">⏰ ${r.pronto} vence${r.pronto === 1 ? "" : "n"} en 7 días</span>` : "", r.debt > 0 ? `<span class="tbp tbp-bad">💸 debe ${bs(r.debt)}</span>` : "", r.espera ? `<span class="tbp tbp-mute">⏸️ ${r.espera} sin fecha</span>` : "", !r.items.length ? `<span class="tbp tbp-mute">Sin cuentas activas</span>` : r.urg === 3 ? `<span class="tbp tbp-ok">✅ Al día</span>` : ""].join("");
    const cobrar = (r.due.length || r.debt > 0) && r.phone ? `<a class="pbtn sm" href="${esc(waLink(r.phone, cobrarMsg(r, now)))}" target="_blank" rel="noopener" data-tbwa="${esc(r.id)}">${icon("wa")}Cobrar${r.dueTotal ? ` ${bs(r.dueTotal)}` : ""}</a>` : "";
    return `<article class="tbrow tb-u${r.urg}" data-tbrow="${esc(r.id)}">
      <div class="tbh"><div class="tbname"><b>${esc(r.name)}</b><small class="muted">${r.items.length} cuenta${r.items.length === 1 ? "" : "s"}${r.next ? ` · próxima: ${fdate(r.next.customerExpiresAt).slice(0, 5)}` : ""}</small></div><div class="tbpills">${pills}</div></div>
      ${r.items.length ? `<div class="tbchips">${r.items.map(chip).join("")}</div>` : ""}
      ${cobrar || (r.due.length || r.debt > 0) ? `<div class="tbact">${cobrar}${r.due.length || r.debt > 0 ? paidAllBtn(r, canReview()) : ""}</div>` : ""}
    </article>`;
  };
  return `<section class="card tbcard">
    <h2>${icon("users")}Tablero de revendedores</h2>
    <p class="muted" style="margin:0">Una fila por revendedor. Arriba, los que tienen algo para cobrar. Tocá una cuenta para renovarla, liberarla o mandar accesos.</p>
    <div class="tbsum"><span><b>${all.filter((r) => r.items.length).length}</b> revendedores con cuentas</span><span><b>${cuentas}</b> cuentas</span><span class="${venc ? "bad" : ""}"><b>${venc}</b> vencidas</span><span class="${pronto ? "warn" : ""}"><b>${pronto}</b> vencen en 7 días</span><span>Para cobrar <b>${bs(porCobrar)}</b></span><span class="${deben ? "bad" : ""}">Te deben <b>${bs(deben)}</b></span></div>
    <input class="rsearch" id="tbq" placeholder="🔍 Buscar revendedor o correo" value="${esc(T.tbq ?? "")}" aria-label="Buscar revendedor o correo">
    <div class="tabs ctl-chips" role="tablist">${FILTERS.map(([k, t]) => `<button type="button" role="tab" data-tbf="${k}" aria-selected="${f === k}">${t} <span class="chipn">${all.filter((r) => pass(k, r)).length}</span></button>`).join("")}</div>
    <div class="tbleg"><span><i class="tbc-exp"></i>Vencida</span><span><i class="tbc-soon"></i>Vence en 3 días</span><span><i class="tbc-week"></i>Vence en 7 días</span><span><i class="tbc-ok"></i>Al día</span><span><i class="tbc-wait"></i>Sin fecha</span></div>
    <div class="tblist">${shown.length ? shown.map(row).join("") : `<div class="emptybox">Nadie con ese filtro.</div>`}</div>
  </section>`;
}

/* ---------------- 📲 Avisarle que quedó renovada (15/11) ---------------- */
/** «Hola Beto ✅ Listo, renové: • Disney ESPN (correo) hasta el 16/12/2026». `items`: [{ product, email, to }]. */
export function renovadaMsg(name, items) {
  const n = String(name || "").split(" · ").pop().split(" ")[0] || "";
  const L = items.map((x) => `• ${shortProduct(x.product)} (${x.email}) hasta el ${fdate(x.to)}`);
  return `Hola ${n} ✅ Listo, ${items.length === 1 ? "renové tu cuenta" : "renové tus cuentas"}:\n${L.join("\n")}\n¡Gracias! 🙌`;
}
/** Ventanita con el botón de WhatsApp listo (nada se manda solo). */
export function avisoRenovada(phone, name, items) {
  if (!items?.length) return;
  document.getElementById("tbAviso")?.remove();
  const el = document.createElement("div");
  el.id = "tbAviso"; el.className = "dlv-scrim";
  const msg = renovadaMsg(name, items);
  el.innerHTML = `<div class="dlv-card" role="dialog" aria-modal="true" aria-label="Avisarle que quedó renovada">
    <div class="dlv-top"><h3>✅ Renovado</h3><button class="pbtn sm" type="button" data-tbavclose="1" aria-label="Cerrar">✕</button></div>
    <pre class="cobpre" style="white-space:pre-wrap;margin:0">${esc(msg)}</pre>
    ${phone ? `<a class="pbtn green big" href="${esc(waLink(phone, msg))}" target="_blank" rel="noopener" data-tbavwa="1">${icon("wa")}Avisarle por WhatsApp</a>` : `<p class="muted" style="margin:0">No tiene WhatsApp cargado: copiá el mensaje.</p>`}
    <button class="pbtn big" type="button" data-tbavclose="1">Listo</button></div>`;
  const close = () => el.remove();
  el.addEventListener("click", (ev) => { if (ev.target === el || ev.target.closest("[data-tbavclose]") || ev.target.closest("[data-tbavwa]")) setTimeout(close, 0); });
  (document.getElementById("app") ?? document.body).appendChild(el);
  el.querySelector("[data-tbavwa], [data-tbavclose]")?.focus();
}
