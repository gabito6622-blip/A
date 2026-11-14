// "📦 Mis cuentas propias" (pestaña del panel del revendedor) y su país y moneda.
// Sus productos (Flujo TV y similares), sus cuentas con contraseña o PIN, y a qué cliente le dio cada
// cupo. Todo en SU moneda. Solo lo ve él: el dueño de la tienda no ve nada de esto.
// shop.js solo agrega la pestaña y llama a ownStockView(); la lógica y los eventos están acá.
import { api, esc, fdate, daysLeft, toCents, toast, waLink, fileToBase64 } from "/common.js";
import { money, myLocale, myPhoneHint } from "/country.js";
import { countryForm, formOpen, onLocaleSaved } from "/afuera.js";
import { selfCodesOwn } from "/codigos-solos.js";
import { loadLinkAlerts, ownAlertTag, inviteOwn, alertsSummary } from "/avisos.js";

// Estilos propios de la pestaña (archivo aparte: no se toca shop.css).
if (typeof document !== "undefined" && !document.querySelector('link[href="/ownstock.css"]')) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/ownstock.css"; document.head.append(l);
}

const OS = { data: null, customers: [], loading: false, err: "", open: {}, paste: null, q: "", msg: {}, show: {}, logoV: Date.now() % 1e6, notify: null, notified: new Set() };
let RENDER = () => {};
/** shop.js le pasa su render() para redibujar después de cada cambio. */
export function initOwnStock(render) { RENDER = render; }
// Otros módulos (Mi día, Mis ganancias de cuentas propias) se enteran cuando algo cambia, para recargar lo suyo.
const CHANGED = [];
export const onOwnChange = (fn) => CHANGED.push(fn);
/** Lo propio del revendedor ya cargado (para Mi control, Quién me debe y Mis ganancias, GaboHub etapa 3). */
export const ownData = () => OS.data;
// Si cambia su moneda (desde acá o desde el Inicio), sus montos se vuelven a leer en la moneda nueva.
onLocaleSaved(() => (OS.data ? loadOwnStock() : null));

const KINDS = { full: "Cuenta completa", profiles: "Perfiles (varios cupos)", line: "Línea / IPTV (usuario y contraseña)" };
const cur = () => OS.data?.currency ?? { symbol: "Bs", decimals: 2 };
const $m = (c) => money(c, cur());
const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
const endOfDay = (v) => new Date(`${v}T23:59:00`).getTime();
const firstName = (n) => String(n ?? "").trim().split(/\s+/)[0] ?? "";
const errBox = (k) => (OS.msg[k] ? `<p class="os-err" role="alert">${esc(OS.msg[k])}</p>` : "");
const pill = (t) => { const n = daysLeft(t); return `<span class="rcest rc-${n < 0 ? "bad" : n <= 3 ? "week" : "ok"}">${n < 0 ? `Venció hace ${-n} d` : n === 0 ? "Vence hoy" : `${n} d`}</span>`; };

export async function loadOwnStock() {
  OS.loading = true;
  try {
    const [d, cs] = await Promise.all([api("GET", "/api/me/own"), api("GET", "/api/me/customers").catch(() => []), loadLinkAlerts()]);
    OS.data = d; OS.customers = cs; OS.err = "";
  } catch (e) { OS.err = e.message; }
  OS.loading = false;
}

/* ---------------- vistas ---------------- */
/** "🌎 Mi país y moneda": el mismo formulario que el Inicio (afuera.js). */
function countryCard() {
  const l = myLocale() ?? { country: "BO", dial: "591", symbol: "Bs", flag: "🇧🇴", name: "Bolivia" };
  return `<details class="sbox os-country" ${formOpen("own") ? "open" : ""}><summary><b>🌎 Mi país y moneda</b> <small class="empty">${esc(l.flag ?? "")} ${esc(l.name ?? "")} · ${esc(l.symbol)} · +${esc(l.dial)}${l.foreign && l.rate ? ` · 1 ${esc(l.store?.symbol ?? "Bs")} = ${esc(l.symbol)} ${esc(String(l.rate).replace(".", ","))}` : ""}</small></summary>${countryForm("own")}</details>`;
}

function accessText(s) {
  const a = (OS.data?.accounts ?? []).find((x) => x.id === s.accountId), p = (OS.data?.products ?? []).find((x) => x.id === s.productId);
  const extra = [p?.server ? `Servidor: ${p.server}` : "", p?.app ? `App: ${p.app}` : "", p?.screens ? `Pantallas a la vez: ${p.screens}` : "", p?.guide ?? ""].filter(Boolean).join("\n");
  return `*${s.product}*${s.trial ? " (prueba gratis)" : ""}\nUsuario: ${a?.user ?? ""}\nContraseña: ${a?.password ?? ""}${p?.kind === "profiles" ? `\nPerfil: ${s.slot}` : ""}${extra ? `\n${extra}` : ""}\n${s.trial ? `La prueba termina: ${fdate(s.expiresAt)}` : `Vence: ${fdate(s.expiresAt)}`}`;
}
const remindText = (s) => `Hola ${firstName(s.name)} 👋 tu ${s.product} ${daysLeft(s.expiresAt) < 0 ? "venció" : daysLeft(s.expiresAt) === 0 ? "vence hoy" : "vence"} el ${fdate(s.expiresAt)}.${s.price ? ` La renovación es ${$m(s.price)}.` : ""} ¿Lo renovamos? 🙌${s.linkToken ? `\nPagá acá: ${location.origin}/c/${s.linkToken}${inviteOwn(s.id)}` : ""}`;

function saleRow(s) {
  const open = OS.open.sale === s.id;
  return `<div class="subrow"><button type="button" class="rcopen" data-os="sale" data-id="${esc(s.id)}" aria-expanded="${open}"><span><b>${esc(s.name)}${s.trial ? ` <span class="os-trial">🎁 Prueba</span>` : ""}</b><small>${esc(s.product)}${s.slot > 1 || (OS.data.products.find((p) => p.id === s.productId)?.kind === "profiles") ? ` · cupo ${s.slot}` : ""}${s.trial ? " · gratis" : s.price != null ? ` · ${$m(s.price)}` : ""}${s.debt ? ` · <span class="bad">Debe ${$m(s.debt)}</span>` : s.pay !== "pagado" ? ` · <span class="bad">Pendiente</span>` : ""}${s.blocked ? ` · <span class="bad">${s.blocked === "caida" ? "⚠️ cuenta caída" : "⚠️ cuenta vencida"}</span>` : ""}${ownAlertTag(s.id)}</small></span>${pill(s.expiresAt)}<i aria-hidden="true">${open ? "▴" : "▾"}</i></button>
    ${open ? `<div class="os-sale">
      <div class="rbtns">${s.phone ? `<a class="sbtn sm pri" href="${waLink(s.phone, accessText(s))}" target="_blank" rel="noopener">🔑 Mandar acceso por WhatsApp</a><a class="sbtn sm" href="${waLink(s.phone, remindText(s))}" target="_blank" rel="noopener">💬 Recordar renovación</a>` : `<small class="empty">Sin WhatsApp</small>`}</div>
      <div class="rbtns"><button class="sbtn sm" type="button" data-os="renew" data-id="${esc(s.id)}">${s.trial ? "✅ Compró" : "🔄 Renovó"} +${OS.data.products.find((p) => p.id === s.productId)?.durationDays ?? 30} días</button>
        <button class="sbtn sm" type="button" data-os="pay" data-id="${esc(s.id)}" data-pay="${s.debt || s.pay !== "pagado" ? "pagado" : "pendiente"}">${s.debt || s.pay !== "pagado" ? "💵 Me pagó" : "⏳ Marcar pendiente"}</button>
        <button class="sbtn sm" type="button" data-os="move" data-id="${esc(s.id)}">↔️ Mover a otra cuenta</button>
        <button class="sbtn sm" type="button" data-os="release" data-id="${esc(s.id)}">🗑️ Liberar cupo</button></div>
      <form class="sform os-grid" data-osf="sale" data-id="${esc(s.id)}"><label>Le vence<input type="date" name="exp" required value="${ymd(s.expiresAt)}"></label><label>Le cobro (${esc(cur().symbol)})<input name="price" inputmode="decimal" value="${s.price != null ? s.price / 100 : ""}"></label>
        <label class="os-wide">Nota<input name="note" maxlength="120" value="${esc(s.note ?? "")}" placeholder="Ej.: paga los lunes"></label>${errBox("sale:" + s.id)}<button class="sbtn sm" type="submit">Guardar</button></form>
      <div class="sublink os-link"><b>🔗 Link de cobro</b>${s.linkToken ? `<code>${esc(location.origin)}/c/${esc(s.linkToken)}</code><div class="rbtns">${s.phone ? `<a class="sbtn sm pri" href="${waLink(s.phone, `Hola ${firstName(s.name)} 👋 acá ves cuánto es y cómo pagar tu ${s.product}:\n${location.origin}/c/${s.linkToken}${inviteOwn(s.id)}`)}" target="_blank" rel="noopener">📤 Mandar por WhatsApp</a>` : ""}<button class="sbtn sm" type="button" data-os="copy" data-text="${esc(location.origin)}/c/${esc(s.linkToken)}">Copiar</button><button class="sbtn sm" type="button" data-os="unlink" data-id="${esc(s.id)}">Cambiar link</button></div>`
        : `<small class="empty">Una página para tu cliente con cuánto es, cuándo vence, tu QR y un botón “Ya pagué”. No muestra la contraseña.</small><button class="sbtn sm" type="button" data-os="link" data-id="${esc(s.id)}">Crear link de cobro</button>`}</div>
    </div>` : ""}</div>`;
}

function assignForm(a) {
  const p = OS.data.products.find((x) => x.id === a.productId);
  return `<form class="sform os-grid" data-osf="assign" data-acc="${esc(a.id)}"><b class="os-wide">➕ Darle un cupo a un cliente</b>
    <label class="os-wide">Cliente<select name="who" data-oswho="1" required>${OS.customers.length ? `<option value="" selected disabled>Elegí un cliente…</option>` : ""}${OS.customers.slice().sort((x, y) => x.name.localeCompare(y.name)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.phone)}</option>`).join("")}<option value="__new" ${OS.customers.length ? "" : "selected"}>➕ Cliente nuevo</option></select></label>
    <div class="os-new os-grid os-wide" ${OS.customers.length ? "hidden" : ""}><label>Nombre<input name="name" maxlength="80" placeholder="Ej.: Rosa Pérez"></label><label>WhatsApp<input name="phone" inputmode="tel" placeholder="${esc(myPhoneHint())}"></label></div>
    ${p?.kind === "profiles" ? `<label>Cupo<select name="slot">${a.free.map((n) => `<option>${n}</option>`).join("")}</select></label>` : ""}
    <label>Le vence<input type="date" name="exp" required value="${ymd(Date.now() + (p?.durationDays ?? 30) * 86_400_000)}"></label>
    <label>Le cobro (${esc(cur().symbol)})<input name="price" inputmode="decimal" value="${p ? p.price / 100 : ""}"></label>
    <label>Pago<select name="pay"><option value="pagado">Pagado</option><option value="pendiente">Pendiente</option></select></label>
    ${errBox("assign:" + a.id)}<button class="sbtn sm pri" type="submit">Guardar</button><button class="sbtn sm" type="button" data-os="trial" data-id="${esc(a.id)}" title="Le das la cuenta 24 horas gratis; si la renueva, pasa a venta">🎁 Prueba gratis 24 h</button></form>`;
}

function accountRow(a) {
  const open = OS.open.account === a.id, sales = OS.data.sales.filter((s) => s.accountId === a.id);
  const prov = a.providerExpiresAt ? ` · tu proveedor: ${fdate(a.providerExpiresAt)}` : "";
  const busy = a.slots - (a.empty ?? a.free.length);
  const state = a.blocked === "caida" ? `<span class="rcest rc-bad">🔴 Se cayó</span>` : a.blocked === "vencida" ? `<span class="rcest rc-bad">⛔ Vencida</span>` : a.providerExpiresAt ? pill(a.providerExpiresAt) : "";
  const blockedMsg = a.blocked === "caida" ? `⚠️ Marcaste que se cayó${a.down?.note ? ` (${esc(a.down.note)})` : ""}: no se ofrece en tu página ni se dan cupos.`
    : a.blocked === "vencida" ? "⛔ Venció con tu proveedor: no se ofrece en tu página ni se dan cupos hasta que anotes que la pagaste." : "";
  return `<div class="subrow"><button type="button" class="rcopen" data-os="account" data-id="${esc(a.id)}" aria-expanded="${open}"><span><b>${esc(a.user)}</b><small>${busy}/${a.slots} ocupado(s)${prov}${a.cost ? ` · te cuesta ${$m(a.cost)}` : ""}</small></span>${state}<i aria-hidden="true">${open ? "▴" : "▾"}</i></button>
    ${open ? `<div class="os-acc">${blockedMsg ? `<p class="os-blocked" role="status">${blockedMsg}</p>` : ""}<div class="os-pass"><span>Contraseña o PIN: <code>${OS.show[a.id] ? esc(a.password) : "••••••"}</code></span><button class="sbtn sm" type="button" data-os="show" data-id="${esc(a.id)}">${OS.show[a.id] ? "Ocultar" : "👁 Ver"}</button></div>
      <div class="rbtns">${a.blocked === "caida" ? `<button class="sbtn sm" type="button" data-os="up" data-id="${esc(a.id)}">✅ Ya volvió</button>` : `<button class="sbtn sm" type="button" data-os="down" data-id="${esc(a.id)}">⚠️ Se cayó esta cuenta</button>`}
        ${sales.length && a.blocked ? `<button class="sbtn sm pri" type="button" data-os="moveall" data-id="${esc(a.id)}">↔️ Mover todos (${sales.length})</button>` : ""}
        ${sales.length ? `<button class="sbtn sm" type="button" data-os="notifyacc" data-id="${esc(a.id)}">📣 Avisar a todos los de esta cuenta</button>` : ""}
        <button class="sbtn sm" type="button" data-os="provpay" data-id="${esc(a.id)}">💸 Pagué a mi proveedor</button></div>
      ${selfCodesOwn(a)}${sales.length ? `<div class="os-sales">${sales.map(saleRow).join("")}</div>` : `<small class="empty">Nadie usa esta cuenta todavía.</small>`}
      ${a.free.length ? assignForm(a) : a.blocked ? "" : `<small class="empty">Sin cupos libres.</small>`}
      <details><summary class="sbtn sm">✏️ Corregir cuenta</summary><form class="sform os-grid" data-osf="account" data-id="${esc(a.id)}" data-product="${esc(a.productId)}">
        <label>Usuario o correo<input name="user" required maxlength="120" value="${esc(a.user)}" autocomplete="off"></label><label>Contraseña o PIN nueva<input name="password" maxlength="120" placeholder="(dejala vacía para no cambiarla)" autocomplete="off"></label>
        ${OS.data.products.find((p) => p.id === a.productId)?.kind === "profiles" ? `<label>Cupos<input name="slots" type="number" min="1" max="10" value="${a.slots}"></label>` : ""}
        <label>Vence con tu proveedor<input type="date" name="prov" value="${a.providerExpiresAt ? ymd(a.providerExpiresAt) : ""}"></label>
        <label>Te cuesta por período (${esc(cur().symbol)})<input name="cost" inputmode="decimal" value="${a.cost != null ? a.cost / 100 : ""}" placeholder="Ej.: 80"></label>
        <label class="os-wide">Nota<input name="note" maxlength="120" value="${esc(a.note)}"></label>${errBox("account:" + a.id)}
        <div class="rbtns os-wide"><button class="sbtn sm pri" type="submit">Guardar</button><button class="sbtn sm" type="button" data-os="delacc" data-id="${esc(a.id)}">🗑️ Borrar cuenta</button></div></form></details></div>` : ""}</div>`;
}

function productForm(p) {
  const k = p ? "product:" + p.id : "product:new";
  return `<form class="sform os-grid" data-osf="product" ${p ? `data-id="${esc(p.id)}"` : ""}>
    <label>Nombre<input name="name" required maxlength="40" value="${esc(p?.name ?? "")}" placeholder="Ej.: Flujo TV"></label>
    <label>Ícono (emoji)<input name="emoji" maxlength="8" value="${esc(p?.emoji ?? "")}" placeholder="📺"></label>
    <label>Tipo<select name="kind">${Object.entries(KINDS).map(([v, t]) => `<option value="${v}" ${(p?.kind ?? "full") === v ? "selected" : ""}>${t}</option>`).join("")}</select></label>
    <label>Cupos por cuenta (perfiles)<input name="slots" type="number" min="1" max="10" value="${p?.slots ?? 4}"></label>
    <label>Dura (días)<input name="days" type="number" min="1" max="400" required value="${p?.durationDays ?? 30}"></label>
    <label>Precio a tus clientes (${esc(cur().symbol)})<input name="price" inputmode="decimal" required value="${p ? p.price / 100 : ""}" placeholder="${cur().decimals === 0 ? "35.000" : "35"}"></label>
    <label class="chk os-wide"><input type="checkbox" name="onPage" ${p?.onPage ? "checked" : ""}> Mostrarlo en mi página para que me lo pidan por WhatsApp</label>
    <details class="os-wide os-iptv" ${p?.server || p?.app || p?.guide ? "open" : ""}><summary><b>📺 Datos para tu cliente</b> <small class="empty">(IPTV: servidor, app, pantallas)</small></summary>
      <div class="os-grid"><label class="os-wide">Servidor o URL<input name="server" maxlength="200" value="${esc(p?.server ?? "")}" placeholder="Ej.: http://flujo.tv:8080"></label>
      <label>App recomendada<input name="app" maxlength="40" value="${esc(p?.app ?? "")}" placeholder="Ej.: Flujo TV, IPTV Smarters"></label>
      <label>Pantallas a la vez<input name="screens" type="number" min="1" max="10" value="${p?.screens ?? ""}" placeholder="1"></label>
      <label class="os-wide">Instrucciones<textarea name="guide" maxlength="300" rows="2" placeholder="Ej.: Descargá la app, poné usuario y contraseña, listo.">${esc(p?.guide ?? "")}</textarea></label>
      <small class="empty os-wide">Van solos en el mensaje “Mandar acceso”.</small></div></details>
    ${errBox(k)}<button class="sbtn ${p ? "sm" : ""} pri os-wide" type="submit">${p ? "Guardar cambios" : "➕ Crear producto"}</button></form>`;
}

function pasteBox(p) {
  const P = OS.paste, rows = P?.rows ?? [];
  return `<form class="pastebox" data-osf="paste" data-product="${esc(p.id)}"><b>📋 Pegá tus cuentas (una por línea)</b>
    <small class="empty">Así: <code>usuario contraseña 15/12</code> (la fecha es cuándo vence con tu proveedor; es opcional). Hasta 200 por vez.</small>
    <label class="sr-only" for="osPaste">Lista de cuentas</label><textarea id="osPaste" name="text" rows="5" placeholder="flujo01 clave123 15/12&#10;flujo02 clave456">${esc(P?.text ?? "")}</textarea>
    ${errBox("paste")}
    <div class="rbtns"><button class="sbtn sm" type="submit">👀 Revisar</button><button class="sbtn sm" type="button" data-os="pasteoff">Cancelar</button></div>
    ${rows.length ? `<div class="pasteprev">${rows.map((r) => `<div class="${r.ok ? "" : "bad"}"><b>${r.ok ? esc(r.user) : `⚠️ Línea ${r.line}`}</b><small>${r.ok ? `contraseña ${"•".repeat(Math.min(8, r.password.length))}${r.providerExpiresAt ? ` · vence ${fdate(r.providerExpiresAt)}` : ""}` : esc(r.error)}</small></div>`).join("")}</div>
      <button class="sbtn pri" type="button" data-os="pastesave" data-id="${esc(p.id)}" ${rows.some((r) => r.ok) ? "" : "disabled"}>✅ Guardar ${rows.filter((r) => r.ok).length} cuenta(s)</button>` : ""}</form>`;
}

function productCard(p) {
  const open = OS.open.product === p.id;
  const accs = OS.data.accounts.filter((a) => a.productId === p.id);
  const logo = p.hasLogo ? `<img class="os-logo" src="/api/me/own/products/${encodeURIComponent(p.id)}/logo?v=${OS.logoV}" alt="" width="40" height="40">` : `<span class="os-logo os-emoji" aria-hidden="true">${esc(p.emoji || "📦")}</span>`;
  return `<article class="rcard os-prod"><header><button type="button" class="rcopen" data-os="product" data-id="${esc(p.id)}" aria-expanded="${open}">${logo}<span><b>${esc(p.name)}</b><small>${$m(p.price)} · ${p.durationDays} días · ${esc(KINDS[p.kind])}</small><small>${p.accounts} cuenta(s) · ${p.used} cliente(s) · ${p.free} cupo(s) libre(s)${p.onPage ? " · en tu página" : ""}</small></span><i aria-hidden="true">${open ? "▴" : "▾"}</i></button></header>
    ${open ? `<div class="rbtns"><button class="sbtn sm pri" type="button" data-os="paste" data-id="${esc(p.id)}">📋 Pegar cuentas</button><details class="os-inline"><summary class="sbtn sm">➕ Una cuenta</summary><form class="sform os-grid" data-osf="account" data-product="${esc(p.id)}"><label>Usuario o correo<input name="user" required maxlength="120" autocomplete="off"></label><label>Contraseña o PIN<input name="password" required maxlength="120" autocomplete="off"></label><label>Vence con tu proveedor<input type="date" name="prov"></label><label>Te cuesta por período (${esc(cur().symbol)})<input name="cost" inputmode="decimal" placeholder="Ej.: 80"></label><label class="os-wide">Nota<input name="note" maxlength="120"></label>${errBox("account:new")}<button class="sbtn sm pri os-wide" type="submit">Guardar cuenta</button></form></details></div>
      ${OS.paste?.productId === p.id ? pasteBox(p) : ""}
      <div class="sublist">${accs.map(accountRow).join("") || `<p class="empty" style="margin:0">Todavía no cargaste cuentas de ${esc(p.name)}.</p>`}</div>
      <details><summary class="sbtn sm">✏️ Editar producto</summary>${productForm(p)}
        <div class="rbtns os-logorow"><label class="sbtn sm os-file">🖼️ ${p.hasLogo ? "Cambiar logo" : "Subir logo"}<input type="file" accept="image/png,image/jpeg,image/webp" data-oslogo="${esc(p.id)}" class="sr-only"></label>${p.hasLogo ? `<button class="sbtn sm" type="button" data-os="nologo" data-id="${esc(p.id)}">Quitar logo</button>` : ""}<button class="sbtn sm" type="button" data-os="delprod" data-id="${esc(p.id)}">🗑️ Borrar producto</button></div>${errBox("logo:" + p.id)}</details>` : ""}</article>`;
}

/** La pestaña completa. Se carga sola la primera vez. */
export function ownStockView() {
  if (!OS.data && !OS.err) {
    if (!OS.loading) loadOwnStock().then(() => RENDER());
    return `<div class="sbox"><p class="empty" style="margin:0">Cargando tus cuentas propias…</p></div>`;
  }
  if (!OS.data) return `<div class="sbox"><p class="empty" style="margin:0">No pudimos cargar tus cuentas propias: ${esc(OS.err)}</p><button class="sbtn sm" type="button" data-os="reload">Probar de nuevo</button></div>`;
  const d = OS.data, t = d.totals;
  const q = OS.q.toLowerCase();
  const soonSales = d.sales.filter((s) => d.soon.clients.includes(s.id));
  const soonAcc = d.accounts.filter((a) => d.soon.provider.includes(a.id));
  const list = d.sales.filter((s) => !q || `${s.name} ${s.phone} ${s.product} ${s.user}`.toLowerCase().includes(q));
  return `<div class="sbox"><h2 style="margin:0">📦 Mis cuentas propias</h2>
      <p class="empty" style="margin:0">Tus servicios que conseguís por tu lado (por ejemplo Flujo TV): cargá tus cuentas, dale un cupo a cada cliente y cobrá en ${esc(cur().symbol)}. Solo vos ves esto.</p>
      <div class="rkpis"><div><small>Clientes</small><b>${t.clients}</b></div><div><small>Te deben</small><b class="${t.owed ? "bad" : ""}">${$m(t.owed)}</b></div><div><small>Cobrás por mes</small><b>${$m(t.monthly)}</b></div><div><small>Cupos libres</small><b>${d.products.reduce((n, p) => n + p.free, 0)}</b></div></div></div>
    ${notifyBox()}
    ${countryCard()}
    ${soonSales.length || soonAcc.length ? `<div class="sbox rcwarn"><h3 style="margin:0">⏰ Vencen esta semana</h3>
      ${soonSales.map((s) => `<div class="rcsoon-r"><span><b>${esc(s.name)}</b><small>${esc(s.product)} · ${pill(s.expiresAt)}</small></span><span class="rbtns">${s.phone ? `<a class="sbtn sm pri" href="${waLink(s.phone, remindText(s))}" target="_blank" rel="noopener">💬 Avisar</a>` : ""}<button class="sbtn sm" type="button" data-os="renew" data-id="${esc(s.id)}">${s.trial ? "✅ Compró" : "🔄 Renovó"}</button></span></div>`).join("")}
      ${soonAcc.map((a) => `<div class="rcsoon-r"><span><b>Tu cuenta ${esc(a.user)}</b><small>${esc(a.product)} · con tu proveedor ${pill(a.providerExpiresAt)}</small></span><span class="rbtns"><button class="sbtn sm" type="button" data-os="provpay" data-id="${esc(a.id)}">💸 Pagué a mi proveedor</button></span></div>`).join("")}</div>` : ""}
    ${(d.gone ?? []).length ? `<div class="sbox"><h3 style="margin:0">📒 Se fueron debiendo · ${$m(d.gone.reduce((t, g) => t + g.debt, 0))}</h3><p class="empty" style="margin:0">Liberaste su cupo pero la deuda sigue (también está en Quién me debe).</p>
      ${d.gone.map((g) => `<div class="rcsoon-r"><span><b>${esc(g.name)}</b><small>${esc(g.product)} · debe ${$m(g.debt)}</small></span><span class="rbtns"><button class="sbtn sm pri" type="button" data-os="pay" data-id="${esc(g.id)}" data-pay="pagado">💵 Me pagó</button><button class="sbtn sm" type="button" data-os="forgive" data-id="${esc(g.id)}">🤝 Perdonar</button></span></div>`).join("")}</div>` : ""}
    <div class="rclist">${d.products.map(productCard).join("")}</div>
    <details class="sbox" ${d.products.length ? "" : "open"}><summary><b>➕ Nuevo producto</b></summary>${productForm(null)}</details>
    ${d.sales.length ? `<div class="sbox"><h3 style="margin:0">👥 Mis clientes de cuentas propias (${d.sales.length})</h3>${alertsSummary()}
      ${d.sales.length > 5 ? `<label class="sr-only" for="osq">Buscar cliente</label><input id="osq" class="rsearch" data-osq="1" placeholder="🔍 Buscar cliente, WhatsApp o producto" value="${esc(OS.q)}">` : ""}
      <div class="sublist">${list.map(saleRow).join("") || `<p class="empty" style="margin:0">Nadie coincide con la búsqueda.</p>`}</div></div>` : ""}`;
}

/* ---------------- avisos con los datos nuevos (mover, cambio de clave) ---------------- */
/** Fila de avisos por WhatsApp: cada cliente con su acceso nuevo (cuenta, clave, cupo y la MISMA fecha). */
// 15/11: la fila de avisos sobrevive a cerrar o recargar GaboHub (antes, si el revendedor se distraía antes de avisar a
// todos, la fila se perdía y sus clientes se quedaban con la clave vieja). Solo en este celular, hasta tocar «Listo».
const NKEY = "gs-os-notify";
function saveNotify() {
  try { if (OS.notify) localStorage.setItem(NKEY, JSON.stringify({ ...OS.notify, done: [...OS.notified], at: Date.now() })); else localStorage.removeItem(NKEY); } catch { /* sin almacenamiento */ }
}
function loadNotify() {
  if (OS.notify || OS.notifyLoaded) return;
  OS.notifyLoaded = true;
  try {
    const x = JSON.parse(localStorage.getItem(NKEY) || "null");
    if (x && Array.isArray(x.ids) && Date.now() - x.at < 7 * 86_400_000) { OS.notify = { title: String(x.title ?? ""), ids: x.ids.map(String), left: Array.isArray(x.left) ? x.left : [] }; OS.notified = new Set((x.done ?? []).map(String)); }
  } catch { /* sin almacenamiento */ }
}
function notifyBox() {
  loadNotify();
  const N = OS.notify;
  if (!N || !OS.data) return "";
  const list = N.ids.map((id) => OS.data.sales.find((s) => s.id === id)).filter(Boolean);
  const done = list.filter((s) => OS.notified.has(s.id)).length;
  return `<div class="sbox rcwarn os-notify" id="osNotify" role="status"><h3 style="margin:0">${esc(N.title)} <small class="empty">(${done}/${list.length} avisados)</small></h3>
    <p class="empty" style="margin:0">Tocá cada uno: se abre WhatsApp con su usuario, contraseña y cupo nuevos. Su fecha y lo que te debe no cambian.</p>
    ${list.map((s) => `<div class="rcsoon-r ${OS.notified.has(s.id) ? "done" : ""}"><span><b>${esc(s.name)}</b><small>${esc(s.product)} · ${esc(s.user)}${s.slot ? ` · cupo ${s.slot}` : ""} · vence ${fdate(s.expiresAt)}</small></span>${s.phone ? `<a class="sbtn sm ${OS.notified.has(s.id) ? "" : "pri"}" href="${waLink(s.phone, `Hola ${firstName(s.name)} 👋 te paso los datos nuevos de tu cuenta:\n${accessText(s)}`)}" target="_blank" rel="noopener" data-osn="${esc(s.id)}">${OS.notified.has(s.id) ? "✓ Avisado" : "💬 Avisar"}</a>` : `<small class="empty">Sin WhatsApp</small>`}</div>`).join("")}
    ${N.left?.length ? `<p class="os-err">No entraron (no hay cupos libres en otra cuenta): ${esc(N.left.map((x) => x.name).join(", "))}. Cargá otra cuenta y tocá «Mover todos» de nuevo.</p>` : ""}
    <button class="sbtn sm" type="button" data-os="notifyoff">Listo</button></div>`;
}

/* ---------------- hoja de preguntas (¿Te pagó?, liberar con deuda, mover, proveedor) ---------------- */
// Una hoja abajo de la pantalla (celular primero), con botones grandes. Sirve desde cualquier pestaña:
// Mis cuentas propias, Mi día, Mi control y Quién me debe usan los mismos data-os.
const sym = () => cur().symbol;
function closeSheet() { document.querySelector(".os-sheetw")?.remove(); }
function sheet(title, body) {
  closeSheet();
  const w = document.createElement("div");
  w.className = "os-sheetw";
  w.innerHTML = `<div class="os-sheet" role="dialog" aria-modal="true" aria-labelledby="osSheetT"><h3 id="osSheetT">${title}</h3>${body}<p class="os-err" data-sheeterr hidden></p></div>`;
  document.body.append(w);
  (w.querySelector("input:not([type=hidden]), button.pri, button") ?? w).focus();
}
const sheetErr = (msg) => { const p = document.querySelector("[data-sheeterr]"); if (p) { p.textContent = msg; p.hidden = false; } else toast(msg); };
const cancelBtn = `<button class="sbtn" type="button" data-os="sheetno">Cancelar</button>`;
const findSale = (id) => OS.data?.sales.find((x) => x.id === id) ?? (OS.data?.gone ?? []).find((x) => x.id === id);
const durOf = (s) => OS.data?.products.find((p) => p.id === s.productId)?.durationDays ?? 30;
/** Mismo plazo que el servidor: si venció hace 30 días o menos, corre desde el vencimiento. */
const renewTo = (s) => { const now = Date.now(), from = s.trial ? Math.max(s.expiresAt, now) : s.expiresAt >= now || now - s.expiresAt <= 30 * 86_400_000 ? s.expiresAt : now; return from + durOf(s) * 86_400_000; };

/** Barra «Deshacer» por 10 segundos. */
function undoBar(text, saleId, op) {
  document.querySelector(".os-undo")?.remove();
  const d = document.createElement("div");
  d.className = "os-undo"; d.setAttribute("role", "status");
  d.innerHTML = `<span>${esc(text)}</span><button class="sbtn sm" type="button" data-os="undo" data-id="${esc(saleId)}" data-op="${esc(op)}">↩️ Deshacer</button>`;
  document.body.append(d);
  setTimeout(() => d.remove(), 10_000);
}

/** Sale a la API desde la hoja: errores dentro de la hoja; si sale bien, la cierra y recarga. */
async function sheetAct(fn, ok) {
  try {
    const r = await fn();
    closeSheet();
    if (ok) toast(typeof ok === "function" ? ok(r) : ok);
    await loadOwnStock();
    for (const f of CHANGED) { try { await f(); } catch { /* se recarga después */ } }
    RENDER();
    return r;
  } catch (e) { sheetErr(e.message); return null; }
}

async function sheetClick(k, d, el) {
  const id = d.id;
  if (k === "sheetno") { closeSheet(); return true; }
  if (!["renew", "renewlater", "pay", "release", "relfiado", "relperdon", "relok", "move", "moveall", "moveallok", "down", "up", "notifyacc", "notifyoff", "provpay", "forgive", "forgiveok", "undo"].includes(k)) return false;
  if (!OS.data && !["notifyoff", "undo"].includes(k)) await loadOwnStock();
  const s = findSale(id);
  if (k === "renew") {
    if (!s) return true;
    const pr = s.price ?? OS.data.products.find((p) => p.id === s.productId)?.price ?? 0;
    sheet(`${s.trial ? "✅" : "🔄"} ${esc(firstName(s.name))} ${s.trial ? "compró" : "renovó"} ${esc(s.product)}`,
      `<p style="margin:0">Pasa a vencer el <b>${fdate(renewTo(s))}</b>${s.expiresAt < Date.now() ? ` (desde su vencimiento del ${fdate(s.expiresAt)})` : ""}.${s.debt ? ` Ya te debía <b>${$m(s.debt)}</b>.` : ""}</p>
      <p style="margin:0"><b>¿Te pagó?</b></p>
      <form class="sform" data-osf="renew" data-id="${esc(s.id)}"><label>Me pagó (${esc(sym())})<input name="amount" inputmode="decimal" value="${pr ? pr / 100 : ""}"></label>
        <button class="sbtn pri" type="submit" data-paidlabel="1">✅ Sí, pagó ${$m(pr)}</button></form>
      <div class="rbtns"><button class="sbtn" type="button" data-os="renewlater" data-id="${esc(s.id)}">⏳ Me paga después</button>${cancelBtn}</div>`);
    return true;
  }
  if (k === "renewlater") {
    el.disabled = true;
    const r = await sheetAct(() => api("POST", `/api/me/own/sales/${id}/renew`, { paid: false }), (x) => `🔄 Renovado: te debe ${$m(x.debt)}`);
    if (r) undoBar(`🔄 Renovado hasta ${fdate(r.expiresAt)} · te debe ${$m(r.debt)}`, id, r.undo);
    return true;
  }
  if (k === "undo") {
    el.disabled = true;
    try { await api("POST", `/api/me/own/sales/${id}/renew/undo`, { undo: d.op }); toast("↩️ Listo, lo deshice"); el.closest(".os-undo")?.remove(); await loadOwnStock(); for (const f of CHANGED) { try { await f(); } catch { /* */ } } RENDER(); }
    catch (e) { toast(e.message); }
    return true;
  }
  if (k === "pay") {
    if (!s) return true;
    if (!s.debt) { await act(() => api("POST", `/api/me/own/sales/${id}`, { pay: "pagado" }), "💵 Marcado pagado"); return true; }
    sheet(`💵 ¿Cuánto te pagó ${esc(firstName(s.name))}?`, `<p style="margin:0">Te debe <b>${$m(s.debt)}</b> (${esc(s.product)}). Si te paga una parte, anotá esa parte: el resto sigue en Quién me debe.</p>
      <form class="sform" data-osf="pay" data-id="${esc(s.id)}"><label>Me pagó (${esc(sym())})<input name="amount" inputmode="decimal" required value="${s.debt / 100}"></label><label>Nota<input name="note" maxlength="120" placeholder="QR, efectivo, una parte…"></label>
        <button class="sbtn pri" type="submit">✅ Guardar pago</button></form><div class="rbtns">${cancelBtn}</div>`);
    return true;
  }
  if (k === "release") {
    if (!s) return true;
    if (s.debt) sheet(`${esc(firstName(s.name))} te debe ${$m(s.debt)}`, `<p style="margin:0">¿Lo pasás a <b>Quién me debe</b> o lo perdonás? Su cupo queda libre y su link de cobro deja de servir.</p>
      <div class="rbtns"><button class="sbtn pri" type="button" data-os="relfiado" data-id="${esc(s.id)}">📒 Pasar a Quién me debe</button><button class="sbtn" type="button" data-os="relperdon" data-id="${esc(s.id)}">🤝 Lo perdono</button>${cancelBtn}</div>`);
    else sheet(`¿Liberar el cupo de ${esc(firstName(s.name))}?`, `<p style="margin:0">Sale de la cuenta ${esc(s.user)} y su link de cobro deja de servir. Queda en «Que vuelvan» para escribirle más adelante.</p>
      <div class="rbtns"><button class="sbtn pri" type="button" data-os="relok" data-id="${esc(s.id)}">🗑️ Sí, liberar</button>${cancelBtn}</div>`);
    return true;
  }
  if (k === "relfiado" || k === "relperdon" || k === "relok") {
    el.disabled = true;
    await sheetAct(() => api("POST", `/api/me/own/sales/${id}/release`, k === "relok" ? {} : { debt: k === "relfiado" ? "fiado" : "perdonar" }), k === "relfiado" ? "📒 Cupo libre: la deuda pasó a Quién me debe" : "Cupo libre");
    return true;
  }
  if (k === "forgive") {
    if (!s) return true;
    sheet(`¿Perdonar a ${esc(firstName(s.name))}?`, `<p style="margin:0">Te debe <b>${$m(s.debt)}</b>. Si lo perdonás, deja de aparecer en Quién me debe (queda anotado en tu libro).</p><div class="rbtns"><button class="sbtn pri" type="button" data-os="forgiveok" data-id="${esc(s.id)}">🤝 Sí, lo perdono</button>${cancelBtn}</div>`);
    return true;
  }
  if (k === "forgiveok") { el.disabled = true; await sheetAct(() => api("POST", `/api/me/own/sales/${id}/forgive`, {}), "🤝 Perdonado"); return true; }
  if (k === "move") {
    if (!s) return true;
    const opts = OS.data.accounts.filter((a) => a.productId === s.productId && a.id !== s.accountId && a.free.length);
    sheet(`↔️ Mover a ${esc(firstName(s.name))} a otra cuenta`, opts.length
      ? `<p style="margin:0">Mantiene su fecha (${fdate(s.expiresAt)}), su precio, lo que te debe y su link de cobro. Después te armo el mensaje con sus datos nuevos.</p>
        <form class="sform" data-osf="move" data-id="${esc(s.id)}"><label>Cuenta y cupo<select name="to" required>${opts.flatMap((a) => a.free.map((n) => `<option value="${esc(a.id)}|${n}">${esc(a.user)} · cupo ${n}</option>`)).join("")}</select></label>
        <button class="sbtn pri" type="submit">↔️ Mover</button></form><div class="rbtns">${cancelBtn}</div>`
      : `<p style="margin:0">No tenés otra cuenta de ${esc(s.product)} con cupos libres (que no esté caída ni vencida). Cargá una y volvé a tocar «Mover».</p><div class="rbtns">${cancelBtn}</div>`);
    return true;
  }
  const a = OS.data?.accounts.find((x) => x.id === id);
  if (k === "moveall") {
    if (!a) return true;
    const n = OS.data.sales.filter((x) => x.accountId === a.id).length;
    const room = OS.data.accounts.filter((x) => x.productId === a.productId && x.id !== a.id).reduce((t, x) => t + x.free.length, 0);
    sheet(`↔️ Mover a los ${n} de ${esc(a.user)}`, `<p style="margin:0">Pasan a los cupos libres de tus otras cuentas de ${esc(a.product)} (hay ${room}). Mantienen su fecha, su precio, lo que te deben y su link. Después te armo los avisos con los datos nuevos.</p>
      <div class="rbtns"><button class="sbtn pri" type="button" data-os="moveallok" data-id="${esc(a.id)}" ${room ? "" : "disabled"}>↔️ Mover todos</button>${cancelBtn}</div>${room ? "" : `<p class="os-err">No hay cupos libres: cargá otra cuenta de ${esc(a.product)} primero.</p>`}`);
    return true;
  }
  if (k === "moveallok") {
    el.disabled = true;
    const r = await sheetAct(() => api("POST", `/api/me/own/accounts/${id}/move-all`, {}), (x) => `↔️ Moví ${x.moved.length}${x.left.length ? ` · faltan ${x.left.length}` : ""}`);
    if (r) { OS.notify = { title: `↔️ Moviste ${r.moved.length}: mandales sus datos nuevos`, ids: r.moved.map((x) => x.id), left: r.left }; OS.notified = new Set(); saveNotify(); RENDER(); document.getElementById("osNotify")?.scrollIntoView({ block: "start" }); }
    return true;
  }
  if (k === "down") {
    if (!a) return true;
    sheet(`⚠️ ¿Se cayó ${esc(a.user)}?`, `<p style="margin:0">Deja de ofrecerse en tu página y no se dan cupos. Sus clientes siguen con su fecha: movelos a otra cuenta con «Mover todos».</p>
      <form class="sform" data-osf="down" data-id="${esc(a.id)}"><label>¿Qué pasó? (opcional)<input name="note" maxlength="120" placeholder="Ej.: el proveedor la bloqueó"></label><button class="sbtn pri" type="submit">⚠️ Sí, se cayó</button></form><div class="rbtns">${cancelBtn}</div>`);
    return true;
  }
  if (k === "up") { await act(() => api("POST", `/api/me/own/accounts/${id}/down`, { down: false }), "✅ La cuenta volvió"); return true; }
  if (k === "notifyacc") {
    if (!a) return true;
    const ids = OS.data.sales.filter((x) => x.accountId === a.id).map((x) => x.id);
    OS.notify = { title: `📣 Avisá a los ${ids.length} de ${a.user}`, ids, left: [] }; OS.notified = new Set(); saveNotify();
    RENDER(); document.getElementById("osNotify")?.scrollIntoView({ block: "start" });
    return true;
  }
  if (k === "notifyoff") { OS.notify = null; saveNotify(); RENDER(); return true; }
  if (k === "provpay") {
    if (!a) return true;
    sheet(`💸 Pagué a mi proveedor · ${esc(a.user)}`, `<p style="margin:0">${a.providerExpiresAt ? `Hoy vence el ${fdate(a.providerExpiresAt)}. ` : ""}Se suma a «Mis ganancias» como lo que pagaste y corre la fecha con tu proveedor.</p>
      <form class="sform os-grid" data-osf="provpay" data-id="${esc(a.id)}"><label>Le pagué (${esc(sym())})<input name="amount" inputmode="decimal" required value="${a.cost != null ? a.cost / 100 : ""}" placeholder="Ej.: 80"></label>
        <label>¿Por cuántos meses?<select name="months">${[1, 2, 3, 6, 12].map((m) => `<option value="${m}">${m} ${m === 1 ? "mes" : "meses"}</option>`).join("")}</select></label>
        <label class="os-wide">Nota<input name="note" maxlength="120" placeholder="Ej.: pagué por QR"></label>
        <button class="sbtn pri os-wide" type="submit">✅ Guardar pago</button></form><div class="rbtns">${cancelBtn}</div>`);
    return true;
  }
  return false;
}

async function sheetSubmit(k, f) {
  const id = f.dataset.id;
  if (!["renew", "pay", "move", "down", "provpay"].includes(k)) return false;
  let n = null;
  if (f.amount) { try { n = price(f.amount.value); } catch (e) { sheetErr(e.message); return true; } }
  if (k === "renew") {
    const r = await sheetAct(() => api("POST", `/api/me/own/sales/${id}/renew`, n ? { paid: true, amount: n } : { paid: false }), (x) => (x.debt ? `🔄 Renovado · te debe ${$m(x.debt)}` : "🔄 Renovado y pagado"));
    if (r) undoBar(`🔄 Renovado hasta ${fdate(r.expiresAt)}${r.debt ? ` · te debe ${$m(r.debt)}` : " · pagado"}`, id, r.undo);
    return true;
  }
  if (k === "pay") {
    if (!n) { sheetErr("Escribí cuánto te pagó"); return true; }
    await sheetAct(() => api("POST", `/api/me/own/sales/${id}/pay`, { amount: n, note: f.note.value }), (x) => (x.debt ? `💵 Anotado · todavía debe ${$m(x.debt)}` : "💵 Anotado: ya no te debe"));
    return true;
  }
  if (k === "move") {
    const [accountId, slot] = f.to.value.split("|");
    const r = await sheetAct(() => api("POST", `/api/me/own/sales/${id}/move`, { accountId, slot: Number(slot) }), "↔️ Movido");
    if (r) { OS.notify = { title: `↔️ Moviste a ${firstName(r.name)}: mandale sus datos nuevos`, ids: [r.id], left: [] }; OS.notified = new Set(); saveNotify(); RENDER(); document.getElementById("osNotify")?.scrollIntoView({ block: "start" }); }
    return true;
  }
  if (k === "down") { await sheetAct(() => api("POST", `/api/me/own/accounts/${id}/down`, { down: true, note: f.note.value }), "⚠️ Marcada como caída: ya no se ofrece"); return true; }
  if (k === "provpay") {
    if (!n) { sheetErr("Escribí cuánto le pagaste"); return true; }
    await sheetAct(() => api("POST", `/api/me/own/accounts/${id}/provider-pay`, { amount: n, months: Number(f.months.value), note: f.note.value }), (x) => `💸 Anotado${x.providerExpiresAt ? ` · vence el ${fdate(x.providerExpiresAt)}` : ""}`);
    return true;
  }
  return false;
}

/* ---------------- eventos (con captura: no pasan por los de shop.js) ---------------- */
async function act(fn, ok, key) {
  if (key) delete OS.msg[key];
  try {
    const r = await fn();
    if (ok) toast(ok);
    await loadOwnStock();
    for (const fn of CHANGED) { try { await fn(); } catch { /* lo suyo se recarga la próxima vez */ } }
    return r;
  } catch (e) {
    if (key) OS.msg[key] = e.message; else toast(e.message);
  } finally { RENDER(); }
}
const price = (v) => { const s = String(v ?? "").trim(); if (!s) return null; const n = toCents(s); if (Number.isNaN(n)) throw new Error("Precio: solo números"); return n; };

if (typeof document !== "undefined") {
  document.addEventListener("click", async (ev) => {
    const n = ev.target.closest("[data-osn]");
    if (n) { OS.notified.add(n.dataset.osn); saveNotify(); setTimeout(() => RENDER(), 300); return; }
    const el = ev.target.closest("[data-os]");
    if (!el) return;
    ev.stopPropagation();
    const d = el.dataset, k = d.os, id = d.id;
    if (["product", "account", "sale"].includes(k)) { OS.open[k] = OS.open[k] === id ? null : id; if (k === "product") OS.paste = null; return RENDER(); }
    if (k === "reload") { OS.err = ""; return RENDER(); }
    if (k === "show") { OS.show[id] = !OS.show[id]; return RENDER(); }
    if (k === "paste") { OS.paste = { productId: id, text: "", rows: [] }; delete OS.msg.paste; return RENDER(); }
    if (k === "pasteoff") { OS.paste = null; return RENDER(); }
    if (k === "copy") { try { await navigator.clipboard.writeText(d.text); toast("Copiado"); } catch { toast(d.text); } return; }
    if (k === "pastesave") { el.disabled = true; const r = await act(() => api("POST", "/api/me/own/accounts/bulk", { productId: id, text: OS.paste?.text ?? "" }), null, "paste"); if (r) { toast(`✅ ${r.added} cuenta(s) guardada(s)`); OS.paste = null; RENDER(); } return; }
    if (k === "trial") {
      const f = document.querySelector(`form[data-osf="assign"][data-acc="${CSS.escape(id)}"]`);
      if (!f) return;
      const who = f.who.value;
      const body = { accountId: id, trialHours: 24, ...(who === "__new" ? { name: f.name.value, phone: f.phone.value } : { customerId: who }), ...(f.slot ? { slot: Number(f.slot.value) } : {}) };
      const r = await act(() => api("POST", "/api/me/own/sales", body), "🎁 Prueba de 24 h lista: mandale el acceso", "assign:" + id);
      if (r) { OS.open.sale = r.id; RENDER(); }
      return;
    }
    if (await sheetClick(k, d, el)) return;
    if (k === "pay" && d.pay === "pendiente") return act(() => api("POST", `/api/me/own/sales/${id}`, { pay: d.pay }), "Quedó pendiente");
    if (k === "link") return act(() => api("POST", `/api/me/own/sales/${id}/link`, {}), "🔗 Link creado");
    if (k === "unlink") { if (!confirm("¿Cambiar el link? El que ya mandaste deja de servir.")) return; return act(async () => { await api("POST", `/api/me/own/sales/${id}/link/revoke`, {}); return api("POST", `/api/me/own/sales/${id}/link`, {}); }, "🔗 Link nuevo"); }
    if (k === "delacc") { if (!confirm("¿Borrar esta cuenta?")) return; return act(() => api("POST", `/api/me/own/accounts/${id}/delete`, {}), "Cuenta borrada", "account:" + id); }
    if (k === "delprod") { if (!confirm("¿Borrar este producto?")) return; return act(() => api("POST", `/api/me/own/products/${id}/delete`, {}), "Producto borrado", "logo:" + id); }
    if (k === "nologo") { OS.logoV++; return act(() => api("POST", `/api/me/own/products/${id}/logo`, { remove: true }), "Logo quitado", "logo:" + id); }
  }, true);

  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    const k = f?.dataset?.osf;
    if (!k) return;
    ev.preventDefault(); ev.stopPropagation();
    const btn = f.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    try {
      if (k === "product") {
        const key = "product:" + (f.dataset.id ?? "new");
        let body;
        try { body = { ...(f.dataset.id ? { id: f.dataset.id } : {}), name: f.name.value, emoji: f.emoji.value, kind: f.kind.value, slots: Number(f.slots.value), durationDays: Number(f.days.value), price: price(f.price.value) ?? 0, onPage: f.onPage.checked, server: f.server.value, app: f.app.value, screens: f.screens.value, guide: f.guide.value }; }
        catch (e) { OS.msg[key] = e.message; return RENDER(); }
        const r = await act(() => api("POST", "/api/me/own/products", body), f.dataset.id ? "Guardado" : "📦 Producto creado", key);
        if (r && !f.dataset.id) { OS.open.product = r.id; RENDER(); }
        return;
      }
      if (k === "paste") {
        OS.paste = { productId: f.dataset.product, text: f.text.value, rows: [] }; delete OS.msg.paste;
        try { OS.paste.rows = (await api("POST", "/api/me/own/accounts/preview", { productId: f.dataset.product, text: f.text.value })).rows; }
        catch (e) { OS.msg.paste = e.message; }
        return RENDER();
      }
      if (k === "account") {
        const key = "account:" + (f.dataset.id ?? "new");
        let body;
        try { body = { ...(f.dataset.id ? { id: f.dataset.id } : {}), productId: f.dataset.product, user: f.user.value, password: f.password.value, note: f.note.value, providerExpiresAt: f.prov.value ? endOfDay(f.prov.value) : null, ...(f.slots ? { slots: Number(f.slots.value) } : {}), ...(f.cost ? { cost: price(f.cost.value) } : {}) }; }
        catch (e) { OS.msg[key] = e.message; return RENDER(); }
        const newPass = !!(f.dataset.id && f.password.value.trim());
        const r = await act(() => api("POST", "/api/me/own/accounts", body), "🔐 Cuenta guardada", key);
        // Cambió la clave de una cuenta con clientes: la fila de avisos con los datos nuevos, lista para mandar.
        if (r && newPass) { const ids = (OS.data?.sales ?? []).filter((x) => x.accountId === f.dataset.id).map((x) => x.id); if (ids.length) { OS.notify = { title: `🔑 Cambiaste la clave: avisales a ${ids.length === 1 ? "tu cliente" : `tus ${ids.length} clientes`} de esta cuenta`, ids, left: [] }; OS.notified = new Set(); saveNotify(); RENDER(); } }
        return r;
      }
      if (k === "assign") {
        const key = "assign:" + f.dataset.acc;
        let body;
        try {
          const who = f.who.value;
          if (!who) throw new Error("Elegí a qué cliente le das el cupo");
          body = { accountId: f.dataset.acc, ...(who === "__new" ? { name: f.name.value, phone: f.phone.value } : { customerId: who }), ...(f.slot ? { slot: Number(f.slot.value) } : {}), expiresAt: endOfDay(f.exp.value), price: price(f.price.value), pay: f.pay.value };
        } catch (e) { OS.msg[key] = e.message; return RENDER(); }
        const r = await act(() => api("POST", "/api/me/own/sales", body), "✅ Cupo asignado", key);
        if (r) { OS.open.sale = r.id; RENDER(); }
        return;
      }
      if (await sheetSubmit(k, f)) return;
      if (k === "sale") {
        const key = "sale:" + f.dataset.id;
        let body;
        try { body = { expiresAt: endOfDay(f.exp.value), price: price(f.price.value), note: f.note.value }; } catch (e) { OS.msg[key] = e.message; return RENDER(); }
        return act(() => api("POST", `/api/me/own/sales/${f.dataset.id}`, body), "Guardado", key);
      }
    } finally { if (btn?.isConnected) btn.disabled = false; }
  }, true);

  document.addEventListener("change", async (ev) => {
    const t = ev.target;
    if (t?.dataset?.oswho) { const box = t.form?.querySelector(".os-new"); if (box) box.hidden = t.value !== "__new"; return; }
    if (t?.dataset?.oslogo && t.files?.[0]) {
      const id = t.dataset.oslogo;
      let b64;
      try { b64 = await fileToBase64(t.files[0]); } catch (e) { OS.msg["logo:" + id] = e.message; return RENDER(); }
      OS.logoV++;
      return act(() => api("POST", `/api/me/own/products/${id}/logo`, { contentBase64: b64 }), "🖼️ Logo guardado", "logo:" + id);
    }
  }, true);

  // La hoja se cierra con Escape o tocando afuera.
  document.addEventListener("keydown", (ev) => { if (ev.key === "Escape" && document.querySelector(".os-sheetw")) closeSheet(); });
  document.addEventListener("click", (ev) => { if (ev.target?.classList?.contains("os-sheetw")) closeSheet(); });

  document.addEventListener("input", (ev) => {
    // «Sí, pagó Bs X»: el botón dice el monto que se va a anotar.
    if (ev.target?.form?.dataset?.osf === "renew" && ev.target.name === "amount") { const b = ev.target.form.querySelector("[data-paidlabel]"); if (b) { let n = null; try { n = price(ev.target.value); } catch { /* se valida al guardar */ } b.textContent = n ? `✅ Sí, pagó ${$m(n)}` : "✅ Sí, pagó"; } return; }
    if (!ev.target?.dataset?.osq) return;
    OS.q = ev.target.value;
    const pos = ev.target.selectionStart;
    RENDER();
    const el = document.getElementById("osq");
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }, true);
}
