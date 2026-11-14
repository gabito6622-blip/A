// "📦 Tus cuentas propias" dentro de Mi día, Que vuelvan, Mi control, Quién me debe, Mis ganancias y el Inicio
// (14/11/2026). El revendedor INDEPENDIENTE vive de sus cuentas propias: antes esas pantallas solo miraban lo de la
// tienda y decían «todo al día» o «ganaste Bs 0» con clientes vencidos y deudas. Cada bloque es una sección propia
// («Tus cuentas propias»): no reescribe lo de la tienda. Los botones usan los mismos data-os de ownstock.js
// (Renovó con «¿Te pagó?», Me pagó con monto, Mover, Pagué a mi proveedor). Solo datos suyos (/api/me/own/*).
import { api, esc, fdate, daysLeft, waLink, toast } from "/common.js";
import { mine } from "/country.js";
import { ownData, onOwnChange } from "/ownstock.js";

const PP = { day: null, back: null, earn: null, month: null };
let RENDER = () => {};
let STORE = () => "";
/** shop.js le pasa su render() y el nombre de su tienda (para firmar los mensajes). */
export function initPropiasPlata({ render, store }) { RENDER = render; STORE = store; }

export async function loadOwnDay() { PP.day = await api("GET", "/api/me/own/day").catch(() => null); return PP.day; }
export async function loadOwnBack() { PP.back = await api("GET", "/api/me/own/back").catch(() => null); return PP.back; }
export async function loadOwnEarn(month) { if (month !== undefined) PP.month = month; PP.earn = await api("GET", `/api/me/own/earnings${PP.month ? `?month=${encodeURIComponent(PP.month)}` : ""}`).catch(() => null); return PP.earn; }
// Cuando cambia algo en sus cuentas propias (renovó, pagó, movió…), se recarga lo que ya estaba a la vista.
onOwnChange(async () => { await Promise.all([PP.day && loadOwnDay(), PP.back && loadOwnBack(), PP.earn && loadOwnEarn()]); });

const first = (n) => String(n ?? "").trim().split(/\s+/)[0] ?? "";
const sign = () => (STORE() ? `\n— ${STORE()}` : "");
const link = (x) => (x.linkToken ? `\nPagá acá: ${location.origin}/c/${x.linkToken}` : "");
const pill = (t) => { const n = daysLeft(t); return `<span class="rcest rc-${n < 0 ? "bad" : n === 0 ? "today" : n <= 3 ? "week" : "ok"}">${n < 0 ? `Venció hace ${-n} d` : n === 0 ? "Vence hoy" : `${n} d`}</span>`; };
const when = (x) => { const n = daysLeft(x.expiresAt); return `${n < 0 ? "venció" : n === 0 ? "vence hoy" : "vence"} el ${fdate(x.expiresAt)}`; };
const msgRenew = (x) => `Hola ${first(x.name)} 👋 tu ${x.product} ${when(x)}.${x.price ? ` La renovación es ${mine(x.price)}.` : ""}${x.debt ? ` Además quedó pendiente ${mine(x.debt)}.` : ""} ¿Lo renovamos? 🙌${link(x)}${sign()}`;
const msgDebt = (x) => `Hola ${first(x.name)} 👋 te paso tu cuenta: tu ${x.product} quedó en *${mine(x.debt)}*. ¿Me podés pagar hoy? ¡Gracias! 🙌${link(x)}${sign()}`;
const wa = (x, text, label, pri = true) => (x.phone ? `<a class="sbtn sm ${pri ? "pri" : ""}" href="${waLink(x.phone, text)}" target="_blank" rel="noopener">${label}</a>` : `<small class="empty">Sin WhatsApp</small>`);
const renewBtn = (x) => `<button class="sbtn sm" type="button" data-os="renew" data-id="${esc(x.id)}">${x.trial ? "✅ Compró" : "🔄 Renovó"}</button>`;
const payBtn = (x) => (x.debt ? `<button class="sbtn sm" type="button" data-os="pay" data-id="${esc(x.id)}" data-pay="pagado">💵 Me pagó</button>` : "");
const blockedTag = (x) => (x.blocked ? ` · <span class="bad">${x.blocked === "caida" ? "⚠️ cuenta caída: movelo" : "⚠️ cuenta vencida con tu proveedor"}</span>` : "");

/* ---------------- ☀️ Mi día ---------------- */
/** Suma lo de sus cuentas propias a los contadores de arriba de Mi día (misma moneda: la suya). */
export function ownDayMerge(D) {
  const o = PP.day;
  if (!D || D.error || !o?.has) return D;
  const add = (a, b) => Object.fromEntries(["cobrar", "avisar", "deben"].map((k) => [k, (a?.[k] ?? 0) + (b?.[k] ?? 0)]));
  return { ...D, counts: { ...D.counts, ...add(D.counts, o.counts) }, totals: { ...D.totals, ...add(D.totals, o.totals) } };
}
/** En vez de «Todo al día acá ✅» cuando lo de la tienda está vacío pero sus cuentas propias tienen algo. */
export function ownDayNote(kind) {
  const n = PP.day?.counts?.[kind] ?? 0;
  return n ? `<p class="rdia-ok">De la tienda, nada acá. De tus cuentas propias: <b>${n}</b> 👇 (abajo, en «Tus cuentas propias»).</p>` : null;
}

const dayItem = (x, acts) => `<li class="rdia-i"><span class="rdia-it"><b>${esc(x.name)}</b><small>${esc(x.product)}${x.slot ? ` · cupo ${x.slot}` : ""} · ${x.gone ? "ya no tiene cupo" : `${fdate(x.expiresAt)} ${pill(x.expiresAt)}`}${x.debt ? ` · <span class="bad">debe ${esc(mine(x.debt))}</span>` : ""}${blockedTag(x)}</small></span><b class="rdia-p">${x.trial ? "Prueba" : x.price !== null ? esc(mine(x.price)) : "—"}</b><div class="rdia-act">${acts}</div></li>`;

export function ownDayHtml() {
  const o = PP.day;
  if (!o?.has) return "";
  const k = o.counts;
  const sec = (title, help, list, acts) => (list.length ? `<h4 class="own-h">${title} <small class="empty">· ${list.length}</small></h4><p class="empty" style="margin:0">${help}</p><ul class="rdia-l">${list.map((x) => dayItem(x, acts(x))).join("")}</ul>` : "");
  const prov = o.provider.length ? `<h4 class="own-h">🏷️ Con tu proveedor <small class="empty">· ${o.provider.length}</small></h4><ul class="rdia-l">${o.provider.map((a) => `<li class="rdia-i"><span class="rdia-it"><b>${esc(a.user)}</b><small>${esc(a.product)} · ${a.down ? `<span class="bad">🔴 se cayó</span>` : a.expiresAt ? `${a.days < 0 ? "venció" : "vence"} el ${fdate(a.expiresAt)} ${pill(a.expiresAt)}` : ""} · ${a.clients} cliente(s)</small></span><b class="rdia-p">${a.cost ? esc(mine(a.cost)) : "—"}</b>
      <div class="rdia-act">${a.down ? `<button class="sbtn sm pri" type="button" data-rtool="propias">↔️ Mover a sus clientes</button>` : `<button class="sbtn sm pri" type="button" data-os="provpay" data-id="${esc(a.id)}">💸 Pagué a mi proveedor</button>`}</div></li>`).join("")}</ul>` : "";
  const any = k.cobrar + k.avisar + k.deben + k.provider;
  return `<section class="sbox rdia-s ownbox" id="ownDay"><h3 style="margin:0">📦 Tus cuentas propias <small class="empty">· ${any ? `${any} para hoy${k.late ? ` · ${k.late} ya vencido(s)` : ""}` : "nada"}</small></h3>
    ${any ? "" : `<p class="rdia-ok">Todo al día con tus cuentas propias ✅</p>`}
    ${sec("💵 Cobrar hoy", "Vencieron (hasta 30 días atrás) o vencen hoy. Si renovó, tocá «Renovó» y te pregunto si te pagó.", o.cobrar, (x) => `${wa(x, msgRenew(x), "💬 Mensaje listo")}${x.blocked === "caida" ? "" : renewBtn(x)}${payBtn(x)}`)}
    ${sec("📣 Avisar", "Vencen en 1 a 3 días: un mensaje a tiempo evita el corte.", o.avisar, (x) => `${wa(x, msgRenew(x), "💬 Mensaje listo")}${x.blocked === "caida" ? "" : renewBtn(x)}`)}
    ${sec("💸 Te deben", "Lo que quedó sin pagar (también los que liberaste debiendo).", o.deben, (x) => `${wa(x, msgDebt(x), "💬 Cobrar")}${payBtn(x)}`)}
    ${prov}</section>`;
}

/* ---------------- 🔁 Que vuelvan ---------------- */
const backMsg = (x) => `Hola ${first(x.name)} 👋 ¿Cómo estás? Hace ${x.days} días se venció tu ${x.product}. ¿Querés que te lo active de nuevo?${x.price ? ` Te sale ${mine(x.price)}.` : ""} Me avisás y te lo dejo listo hoy 🙌${sign()}`;
export function ownBackHtml() {
  const B = PP.back;
  if (!B || (!B.items.length && !B.written && !B.owing)) return "";
  return `<section class="sbox rdia-s ownbox" id="ownBack"><h3 style="margin:0">🔁 Que vuelvan · tus cuentas propias <small class="empty">· ${B.items.length ? `${B.items.length} cliente(s)` : "nadie por ahora"}</small></h3>
    <p class="empty" style="margin:0">Se les venció hace más de 30 días o les liberaste el cupo. Cuando le escribas, tocá «Ya le escribí» y no te lo muestro por ${B.quietDays} días.${B.written ? ` (${B.written} ya escrito(s))` : ""}${B.owing ? ` ${B.owing === 1 ? "1 que todavía te debe no sale acá: está" : `${B.owing} que todavía te deben no salen acá: están`} en «Te deben», para cobrarle primero.` : ""}</p>
    ${B.items.length ? `<ul class="rdia-l">${B.items.map((x) => `<li class="rdia-i"><span class="rdia-it"><b>${esc(x.name)}</b><small>${esc(x.product)} · ${x.released ? "liberado" : "venció"} el ${fdate(x.expiredAt)} (hace ${x.days} d)${x.price ? ` · ${esc(mine(x.price))}` : ""}</small></span>
      <div class="rdia-act">${wa(x, backMsg(x), "💬 Mensaje listo")}<button class="sbtn sm" type="button" data-ownback="${esc(x.key)}">✅ Ya le escribí</button></div></li>`).join("")}</ul>` : ""}</section>`;
}

/* ---------------- 📊 Mi control ---------------- */
export function ownControlHtml() {
  const d = ownData();
  if (!d?.sales?.length) return "";
  const now = Date.now(), week = now + 7 * 86_400_000;
  const due = d.sales.filter((x) => x.expiresAt <= week && x.expiresAt >= now - 30 * 86_400_000);
  const late = d.sales.filter((x) => daysLeft(x.expiresAt) < 0 && x.expiresAt >= now - 30 * 86_400_000).length;
  const row = (x) => `<div class="line"><span class="lgrow"><b>${esc(x.name)}</b><br><small class="empty">${esc(x.product)}${x.price != null ? ` · ${mine(x.price)}` : ""}${x.trial ? " · 🎁 prueba" : ""}${x.debt ? ` · <span class="bad">debe ${mine(x.debt)}</span>` : ""}${blockedTag(x)}</small></span>${pill(x.expiresAt)}<span class="rbtns">${x.phone ? wa(x, msgRenew(x), "💬 Avisar") : ""}${x.blocked === "caida" ? "" : renewBtn(x)}</span></div>`;
  return `<div class="sbox ownbox"><h3 style="margin:0">📦 Tus cuentas propias que vencen <span class="spill sp-mute">${due.length}</span></h3>
    <div class="rkpis"><div><small>Clientes</small><b>${d.totals.clients}</b></div><div><small>Vencidos</small><b class="${late ? "bad" : ""}">${late}</b></div><div><small>Cobrás por mes</small><b>${mine(d.totals.monthly)}</b></div><div><small>Te deben</small><b class="${d.totals.owed ? "bad" : ""}">${mine(d.totals.owed)}</b></div></div>
    ${due.map(row).join("") || `<p class="empty" style="margin:0">Nadie vence esta semana.</p>`}
    <details class="own-all"><summary class="sbtn sm">👥 Ver todos (${d.sales.length})</summary>${d.sales.map(row).join("")}</details>
    <button class="sbtn sm" type="button" data-rtool="propias">Ver todas mis cuentas propias</button></div>`;
}

/* ---------------- 💸 Quién me debe ---------------- */
export function ownDebeHtml() {
  const d = ownData();
  if (!d) return "";
  const l = [...d.sales.filter((x) => x.debt > 0).map((x) => ({ ...x })), ...(d.gone ?? []).map((g) => ({ ...g, gone: true }))];
  if (!l.length) return "";
  return `<div class="sbox ownbox"><h3 style="margin:0">📦 Cuentas propias: te deben · ${mine(l.reduce((t, x) => t + x.debt, 0))}</h3>
    <p class="empty" style="margin:0">Cada período es un cargo y cada pago lo baja (puede ser de a poco). No se borra al renovar ni al liberar el cupo.</p>
    ${l.map((x) => `<div class="line"><span class="lgrow"><b>${esc(x.name)}</b><br><small class="empty">${esc(x.product)} · debe ${mine(x.debt)} · ${x.gone ? "ya no tiene cupo" : when(x)}</small></span><span class="rbtns">${wa(x, msgDebt(x), "💬 Cobrar")}<button class="sbtn sm" type="button" data-os="pay" data-id="${esc(x.id)}" data-pay="pagado">💵 Me pagó</button>${x.gone ? `<button class="sbtn sm" type="button" data-os="forgive" data-id="${esc(x.id)}">🤝 Perdonar</button>` : ""}</span></div>`).join("")}</div>`;
}

/* ---------------- 📈 Mis ganancias ---------------- */
export function ownEarnHtml() {
  const g = PP.earn, d = ownData();
  if (!g || (!g.accounts && !d?.sales?.length)) return "";
  const m = g.current;
  const hist = g.months.slice().reverse();
  const kind = { cargo: "🧾 Período", pago: "💵 Te pagó", perdon: "🤝 Perdonado", proveedor: "💸 Pagaste a tu proveedor" };
  return `<div class="sbox ownbox" id="ownEarn"><h3 style="margin:0">📦 Tus cuentas propias · ${esc(m.label)}</h3>
    <div class="rkpis"><div><small>Entró</small><b class="ok">${mine(m.in)}</b><small>vendiste ${mine(m.sold)}</small></div><div><small>Pagaste a tus proveedores</small><b>${mine(m.out)}</b></div><div><small>Te quedó</small><b class="${m.kept < 0 ? "bad" : "ok"}">${mine(m.kept)}</b></div><div><small>Te deben</small><b class="${m.owed ? "bad" : ""}">${mine(m.owed)}</b></div></div>
    <p class="own-eq">Entró ${mine(m.in)} − pagaste ${mine(m.out)} = <b>te quedó ${mine(m.kept)}</b></p>
    ${g.noCost ? `<p class="empty" style="margin:0">💡 ${g.noCost === 1 ? "1 cuenta no tiene" : `${g.noCost} cuentas no tienen`} anotado cuánto te cuesta. Usá «💸 Pagué a mi proveedor» en Mis cuentas propias: así «te quedó» es real.</p>` : ""}
    ${g.costMonthly ? `<p class="empty" style="margin:0">Tus cuentas te cuestan unos ${mine(g.costMonthly)} por mes.</p>` : ""}
    <h4 class="own-h">Mes por mes</h4>
    <div class="own-hist">${hist.map((x) => `<div class="line"><span class="lgrow"><b>${esc(x.label)}</b><br><small class="empty">entró ${mine(x.in)} − pagaste ${mine(x.out)} · te debían ${mine(x.owed)}</small></span><b class="${x.kept < 0 ? "bad" : "ok"}">${mine(x.kept)}</b></div>`).join("")}</div>
    <details class="own-book"${PP.month ? " open" : ""}><summary class="sbtn sm">📒 Libro de cobros</summary>
      <label>Mes<select data-ownearnm="1">${hist.map((x) => `<option value="${esc(x.month)}" ${x.month === g.ledgerMonth ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
      ${g.ledger.map((x) => `<div class="line"><span class="lgrow">${kind[x.kind] ?? x.kind} <b>${esc(x.name)}</b><br><small class="empty">${esc(x.product)} · ${fdate(x.at)}${x.note ? ` · ${esc(x.note)}` : ""}</small></span><b class="${x.kind === "pago" ? "ok" : x.kind === "proveedor" ? "bad" : ""}">${x.kind === "proveedor" ? "−" : ""}${mine(x.amount)}</b></div>`).join("") || `<p class="empty" style="margin:0">Sin movimientos en ${esc(g.ledgerLabel)}.</p>`}</details></div>`;
}

/* ---------------- 🎁 Mis combos ---------------- */
/** Sus productos propios con precio, para armar combos (id "op_<id>", como en su página). */
export const ownComboPicks = () => (ownData()?.products ?? []).filter((p) => p.price > 0).map((p) => ({ productId: `op_${p.id}`, name: `${p.emoji ? `${p.emoji} ` : ""}${p.name}`, sell: p.price }));

/* ---------------- Inicio: «Tu día» ---------------- */
/** Lo de sus cuentas propias para la tarjeta «Tu día»: pendientes de hoy, vencidos, lo que le deben y lo que le quedó. */
export function ownTodayNums() {
  const o = PP.day;
  if (!o?.has) return { pending: 0, late: 0, owed: 0, kept: 0, has: false };
  return { pending: o.counts.cobrar + o.counts.avisar + o.provider.filter((a) => a.down || (a.days ?? 1) <= 0).length, late: o.counts.late, owed: o.owed, kept: o.month.kept, has: true };
}

if (typeof document !== "undefined") {
  if (!document.querySelector('link[href="/propias.css"]')) { const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/propias.css"; document.head.append(l); }
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest?.("[data-ownback]");
    if (!b) return;
    ev.stopPropagation();
    b.disabled = true;
    try { await api("POST", "/api/me/own/back", { key: b.dataset.ownback }); toast("Anotado: no te lo muestro por unos días"); await loadOwnBack(); RENDER(); }
    catch (e) { b.disabled = false; toast(e.message); }
  }, true);
  document.addEventListener("change", async (ev) => {
    if (!ev.target?.dataset?.ownearnm) return;
    ev.stopPropagation();
    await loadOwnEarn(ev.target.value);
    RENDER();
  }, true);
}
