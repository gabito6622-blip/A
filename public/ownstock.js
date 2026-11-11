// "📦 Mis cuentas propias" (pestaña del panel del revendedor) y su país y moneda.
// Sus productos (Flujo TV y similares), sus cuentas con contraseña o PIN, y a qué cliente le dio cada
// cupo. Todo en SU moneda. Solo lo ve él: el dueño de la tienda no ve nada de esto.
// shop.js solo agrega la pestaña y llama a ownStockView(); la lógica y los eventos están acá.
import { api, esc, fdate, daysLeft, toCents, toast, waLink, fileToBase64 } from "/common.js";
import { COUNTRIES, money, setMine, myLocale, myPhoneHint } from "/country.js";

// Estilos propios de la pestaña (archivo aparte: no se toca shop.css).
if (typeof document !== "undefined" && !document.querySelector('link[href="/ownstock.css"]')) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/ownstock.css"; document.head.append(l);
}

const OS = { data: null, customers: [], loading: false, err: "", open: {}, paste: null, q: "", msg: {}, show: {}, logoV: Date.now() % 1e6 };
let RENDER = () => {};
/** shop.js le pasa su render() para redibujar después de cada cambio. */
export function initOwnStock(render) { RENDER = render; }

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
    const [d, cs] = await Promise.all([api("GET", "/api/me/own"), api("GET", "/api/me/customers").catch(() => [])]);
    OS.data = d; OS.customers = cs; OS.err = "";
  } catch (e) { OS.err = e.message; }
  OS.loading = false;
}

/* ---------------- vistas ---------------- */
function countryCard() {
  const l = myLocale() ?? { country: "BO", dial: "591", symbol: "Bs", decimals: 2, flag: "🇧🇴", name: "Bolivia", foreign: false, store: { symbol: "Bs" } };
  const store = l.store?.symbol ?? "Bs";
  return `<details class="sbox os-country" ${OS.open.country ? "open" : ""}><summary><b>🌎 Mi país y moneda</b> <small class="empty">${esc(l.flag ?? "")} ${esc(l.name ?? "")} · ${esc(l.symbol)} · +${esc(l.dial)}</small></summary>
    <form class="sform os-grid" data-osf="locale">
      <label>País<select name="country">${COUNTRIES.map(([k, t]) => `<option value="${k}" ${l.country === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Código de teléfono (sin +)<input name="dial" inputmode="numeric" maxlength="4" value="${esc(l.dial)}" required></label>
      <label>Símbolo de tu moneda<input name="symbol" maxlength="4" value="${esc(l.symbol)}" required></label>
      <label>Decimales<select name="decimals"><option value="2" ${l.decimals === 2 ? "selected" : ""}>Con centavos (12,50)</option><option value="0" ${l.decimals === 0 ? "selected" : ""}>Sin centavos (35.000)</option></select></label>
      <label class="os-wide">Tipo de cambio: 1 ${esc(store)} = <input name="rate" inputmode="decimal" value="${l.rate ?? ""}" placeholder="Ej.: 1050" aria-describedby="osRateHelp"> ${esc(l.symbol)}</label>
      <p class="empty os-wide" id="osRateHelp" style="margin:0">Con tu tipo de cambio, tu página muestra los productos de la tienda en ${esc(l.symbol)} (redondeados). Sin tipo de cambio, esos productos no salen en tu página. Lo que le comprás a la tienda sigue en ${esc(store)}.</p>
      <p class="empty os-wide" style="margin:0">Tus clientes nuevos se cargan con +${esc(l.dial)}. Si cambiás de moneda, los montos que ya anotaste no se convierten solos.</p>
      ${errBox("locale")}
      <button class="sbtn pri os-wide" type="submit">Guardar mi país</button></form></details>`;
}

function accessText(s) {
  const a = (OS.data?.accounts ?? []).find((x) => x.id === s.accountId), p = (OS.data?.products ?? []).find((x) => x.id === s.productId);
  const extra = [p?.server ? `Servidor: ${p.server}` : "", p?.app ? `App: ${p.app}` : "", p?.screens ? `Pantallas a la vez: ${p.screens}` : "", p?.guide ?? ""].filter(Boolean).join("\n");
  return `*${s.product}*${s.trial ? " (prueba gratis)" : ""}\nUsuario: ${a?.user ?? ""}\nContraseña: ${a?.password ?? ""}${p?.kind === "profiles" ? `\nPerfil: ${s.slot}` : ""}${extra ? `\n${extra}` : ""}\n${s.trial ? `La prueba termina: ${fdate(s.expiresAt)}` : `Vence: ${fdate(s.expiresAt)}`}`;
}
const remindText = (s) => `Hola ${firstName(s.name)} 👋 tu ${s.product} ${daysLeft(s.expiresAt) < 0 ? "venció" : daysLeft(s.expiresAt) === 0 ? "vence hoy" : "vence"} el ${fdate(s.expiresAt)}.${s.price ? ` La renovación es ${$m(s.price)}.` : ""} ¿Lo renovamos? 🙌${s.linkToken ? `\nPagá acá: ${location.origin}/c/${s.linkToken}` : ""}`;

function saleRow(s) {
  const open = OS.open.sale === s.id;
  return `<div class="subrow"><button type="button" class="rcopen" data-os="sale" data-id="${esc(s.id)}" aria-expanded="${open}"><span><b>${esc(s.name)}${s.trial ? ` <span class="os-trial">🎁 Prueba</span>` : ""}</b><small>${esc(s.product)}${s.slot > 1 || (OS.data.products.find((p) => p.id === s.productId)?.kind === "profiles") ? ` · cupo ${s.slot}` : ""}${s.trial ? " · gratis" : s.price != null ? ` · ${$m(s.price)}` : ""}${s.pay !== "pagado" ? ` · <span class="bad">Pendiente</span>` : ""}</small></span>${pill(s.expiresAt)}<i aria-hidden="true">${open ? "▴" : "▾"}</i></button>
    ${open ? `<div class="os-sale">
      <div class="rbtns">${s.phone ? `<a class="sbtn sm pri" href="${waLink(s.phone, accessText(s))}" target="_blank" rel="noopener">🔑 Mandar acceso por WhatsApp</a><a class="sbtn sm" href="${waLink(s.phone, remindText(s))}" target="_blank" rel="noopener">💬 Recordar renovación</a>` : `<small class="empty">Sin WhatsApp</small>`}</div>
      <div class="rbtns"><button class="sbtn sm" type="button" data-os="renew" data-id="${esc(s.id)}">${s.trial ? "✅ Compró" : "🔄 Renovó"} +${OS.data.products.find((p) => p.id === s.productId)?.durationDays ?? 30} días</button>
        <button class="sbtn sm" type="button" data-os="pay" data-id="${esc(s.id)}" data-pay="${s.pay === "pagado" ? "pendiente" : "pagado"}">${s.pay === "pagado" ? "⏳ Marcar pendiente" : "💵 Me pagó"}</button>
        <button class="sbtn sm" type="button" data-os="release" data-id="${esc(s.id)}">🗑️ Liberar cupo</button></div>
      <form class="sform os-grid" data-osf="sale" data-id="${esc(s.id)}"><label>Le vence<input type="date" name="exp" required value="${ymd(s.expiresAt)}"></label><label>Le cobro (${esc(cur().symbol)})<input name="price" inputmode="decimal" value="${s.price != null ? s.price / 100 : ""}"></label>
        <label class="os-wide">Nota<input name="note" maxlength="120" value="${esc(s.note ?? "")}" placeholder="Ej.: paga los lunes"></label>${errBox("sale:" + s.id)}<button class="sbtn sm" type="submit">Guardar</button></form>
      <div class="sublink os-link"><b>🔗 Link de cobro</b>${s.linkToken ? `<code>${esc(location.origin)}/c/${esc(s.linkToken)}</code><div class="rbtns">${s.phone ? `<a class="sbtn sm pri" href="${waLink(s.phone, `Hola ${firstName(s.name)} 👋 acá ves cuánto es y cómo pagar tu ${s.product}:\n${location.origin}/c/${s.linkToken}`)}" target="_blank" rel="noopener">📤 Mandar por WhatsApp</a>` : ""}<button class="sbtn sm" type="button" data-os="copy" data-text="${esc(location.origin)}/c/${esc(s.linkToken)}">Copiar</button><button class="sbtn sm" type="button" data-os="unlink" data-id="${esc(s.id)}">Cambiar link</button></div>`
        : `<small class="empty">Una página para tu cliente con cuánto es, cuándo vence, tu QR y un botón “Ya pagué”. No muestra la contraseña.</small><button class="sbtn sm" type="button" data-os="link" data-id="${esc(s.id)}">Crear link de cobro</button>`}</div>
    </div>` : ""}</div>`;
}

function assignForm(a) {
  const p = OS.data.products.find((x) => x.id === a.productId);
  return `<form class="sform os-grid" data-osf="assign" data-acc="${esc(a.id)}"><b class="os-wide">➕ Darle un cupo a un cliente</b>
    <label class="os-wide">Cliente<select name="who" data-oswho="1">${OS.customers.slice().sort((x, y) => x.name.localeCompare(y.name)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.phone)}</option>`).join("")}<option value="__new" ${OS.customers.length ? "" : "selected"}>➕ Cliente nuevo</option></select></label>
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
  return `<div class="subrow"><button type="button" class="rcopen" data-os="account" data-id="${esc(a.id)}" aria-expanded="${open}"><span><b>${esc(a.user)}</b><small>${a.slots - a.free.length}/${a.slots} ocupado(s)${prov}</small></span>${a.providerExpiresAt ? pill(a.providerExpiresAt) : ""}<i aria-hidden="true">${open ? "▴" : "▾"}</i></button>
    ${open ? `<div class="os-acc"><div class="os-pass"><span>Contraseña o PIN: <code>${OS.show[a.id] ? esc(a.password) : "••••••"}</code></span><button class="sbtn sm" type="button" data-os="show" data-id="${esc(a.id)}">${OS.show[a.id] ? "Ocultar" : "👁 Ver"}</button></div>
      ${sales.length ? `<div class="os-sales">${sales.map(saleRow).join("")}</div>` : `<small class="empty">Nadie usa esta cuenta todavía.</small>`}
      ${a.free.length ? assignForm(a) : `<small class="empty">Sin cupos libres.</small>`}
      <details><summary class="sbtn sm">✏️ Corregir cuenta</summary><form class="sform os-grid" data-osf="account" data-id="${esc(a.id)}" data-product="${esc(a.productId)}">
        <label>Usuario o correo<input name="user" required maxlength="120" value="${esc(a.user)}" autocomplete="off"></label><label>Contraseña o PIN nueva<input name="password" maxlength="120" placeholder="(dejala vacía para no cambiarla)" autocomplete="off"></label>
        ${OS.data.products.find((p) => p.id === a.productId)?.kind === "profiles" ? `<label>Cupos<input name="slots" type="number" min="1" max="10" value="${a.slots}"></label>` : ""}
        <label>Vence con tu proveedor<input type="date" name="prov" value="${a.providerExpiresAt ? ymd(a.providerExpiresAt) : ""}"></label>
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
    ${open ? `<div class="rbtns"><button class="sbtn sm pri" type="button" data-os="paste" data-id="${esc(p.id)}">📋 Pegar cuentas</button><details class="os-inline"><summary class="sbtn sm">➕ Una cuenta</summary><form class="sform os-grid" data-osf="account" data-product="${esc(p.id)}"><label>Usuario o correo<input name="user" required maxlength="120" autocomplete="off"></label><label>Contraseña o PIN<input name="password" required maxlength="120" autocomplete="off"></label><label>Vence con tu proveedor<input type="date" name="prov"></label><label>Nota<input name="note" maxlength="120"></label>${errBox("account:new")}<button class="sbtn sm pri os-wide" type="submit">Guardar cuenta</button></form></details></div>
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
    ${countryCard()}
    ${soonSales.length || soonAcc.length ? `<div class="sbox rcwarn"><h3 style="margin:0">⏰ Vencen esta semana</h3>
      ${soonSales.map((s) => `<div class="rcsoon-r"><span><b>${esc(s.name)}</b><small>${esc(s.product)} · ${pill(s.expiresAt)}</small></span><span class="rbtns">${s.phone ? `<a class="sbtn sm pri" href="${waLink(s.phone, remindText(s))}" target="_blank" rel="noopener">💬 Avisar</a>` : ""}<button class="sbtn sm" type="button" data-os="renew" data-id="${esc(s.id)}">🔄 Renovó</button></span></div>`).join("")}
      ${soonAcc.map((a) => `<div class="rcsoon-r"><span><b>Tu cuenta ${esc(a.user)}</b><small>${esc(a.product)} · con tu proveedor ${pill(a.providerExpiresAt)}</small></span></div>`).join("")}</div>` : ""}
    <div class="rclist">${d.products.map(productCard).join("")}</div>
    <details class="sbox" ${d.products.length ? "" : "open"}><summary><b>➕ Nuevo producto</b></summary>${productForm(null)}</details>
    ${d.sales.length ? `<div class="sbox"><h3 style="margin:0">👥 Mis clientes de cuentas propias (${d.sales.length})</h3>
      ${d.sales.length > 5 ? `<label class="sr-only" for="osq">Buscar cliente</label><input id="osq" class="rsearch" data-osq="1" placeholder="🔍 Buscar cliente, WhatsApp o producto" value="${esc(OS.q)}">` : ""}
      <div class="sublist">${list.map(saleRow).join("") || `<p class="empty" style="margin:0">Nadie coincide con la búsqueda.</p>`}</div></div>` : ""}`;
}

/* ---------------- eventos (con captura: no pasan por los de shop.js) ---------------- */
async function act(fn, ok, key) {
  if (key) delete OS.msg[key];
  try {
    const r = await fn();
    if (ok) toast(ok);
    await loadOwnStock();
    return r;
  } catch (e) {
    if (key) OS.msg[key] = e.message; else toast(e.message);
  } finally { RENDER(); }
}
const price = (v) => { const s = String(v ?? "").trim(); if (!s) return null; const n = toCents(s); if (Number.isNaN(n)) throw new Error("Precio: solo números"); return n; };

if (typeof document !== "undefined") {
  document.addEventListener("click", async (ev) => {
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
    if (k === "renew") return act(() => api("POST", `/api/me/own/sales/${id}/renew`, { paid: true }), "🔄 Renovado");
    if (k === "pay") return act(() => api("POST", `/api/me/own/sales/${id}`, { pay: d.pay }), d.pay === "pagado" ? "💵 Marcado pagado" : "Quedó pendiente");
    if (k === "release") { if (!confirm("¿Liberar este cupo? El cliente sale de la cuenta y su link de cobro deja de servir.")) return; return act(() => api("POST", `/api/me/own/sales/${id}/release`), "Cupo libre"); }
    if (k === "link") return act(() => api("POST", `/api/me/own/sales/${id}/link`), "🔗 Link creado");
    if (k === "unlink") { if (!confirm("¿Cambiar el link? El que ya mandaste deja de servir.")) return; return act(async () => { await api("POST", `/api/me/own/sales/${id}/link/revoke`); return api("POST", `/api/me/own/sales/${id}/link`); }, "🔗 Link nuevo"); }
    if (k === "delacc") { if (!confirm("¿Borrar esta cuenta?")) return; return act(() => api("POST", `/api/me/own/accounts/${id}/delete`), "Cuenta borrada", "account:" + id); }
    if (k === "delprod") { if (!confirm("¿Borrar este producto?")) return; return act(() => api("POST", `/api/me/own/products/${id}/delete`), "Producto borrado", "logo:" + id); }
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
      if (k === "locale") {
        delete OS.msg.locale;
        try {
          const l = await api("PUT", "/api/me/locale", { country: f.country.value, dial: f.dial.value, symbol: f.symbol.value, decimals: Number(f.decimals.value), rate: f.rate.value.trim() || null });
          setMine(l); OS.open.country = false; toast("🌎 Guardado"); await loadOwnStock();
        } catch (e) { OS.msg.locale = e.message; OS.open.country = true; }
        return RENDER();
      }
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
        const body = { ...(f.dataset.id ? { id: f.dataset.id } : {}), productId: f.dataset.product, user: f.user.value, password: f.password.value, note: f.note.value, providerExpiresAt: f.prov.value ? endOfDay(f.prov.value) : null, ...(f.slots ? { slots: Number(f.slots.value) } : {}) };
        return act(() => api("POST", "/api/me/own/accounts", body), "🔐 Cuenta guardada", key);
      }
      if (k === "assign") {
        const key = "assign:" + f.dataset.acc;
        let body;
        try {
          const who = f.who.value;
          body = { accountId: f.dataset.acc, ...(who === "__new" ? { name: f.name.value, phone: f.phone.value } : { customerId: who }), ...(f.slot ? { slot: Number(f.slot.value) } : {}), expiresAt: endOfDay(f.exp.value), price: price(f.price.value), pay: f.pay.value };
        } catch (e) { OS.msg[key] = e.message; return RENDER(); }
        const r = await act(() => api("POST", "/api/me/own/sales", body), "✅ Cupo asignado", key);
        if (r) { OS.open.sale = r.id; RENDER(); }
        return;
      }
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
    // Al elegir otro país se completan su código y su moneda.
    if (t?.name === "country" && t.form?.dataset?.osf === "locale") {
      const c = COUNTRIES.find(([k]) => k === t.value);
      if (c && c[0] !== "XX") { t.form.dial.value = c[2]; t.form.symbol.value = c[3]; t.form.decimals.value = String(c[4]); }
    }
  }, true);

  document.addEventListener("input", (ev) => {
    if (!ev.target?.dataset?.osq) return;
    OS.q = ev.target.value;
    const pos = ev.target.selectionStart;
    RENDER();
    const el = document.getElementById("osq");
    if (el) { el.focus(); el.setSelectionRange(pos, pos); }
  }, true);
}
