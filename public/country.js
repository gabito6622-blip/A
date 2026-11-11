// País y moneda del revendedor, del lado del navegador (par de src/store/country.ts).
// - money(cents, cur): la única función de plata por moneda (₲ sin decimales y miles con punto).
// - mine(cents): lo SUYO (lo que le cobra a sus clientes) en su moneda; si es de Bolivia, igual que bs().
// - Lo que le compra a la tienda (saldo, costos, su lista de precios) sigue con bs().
import { bs, esc, currencySym } from "/common.js";

/** Lista corta de países (el resto: "Otro", con código y moneda a mano). */
export const COUNTRIES = [
  ["BO", "🇧🇴 Bolivia", "591", "Bs", 2],
  ["PY", "🇵🇾 Paraguay", "595", "₲", 0],
  ["PA", "🇵🇦 Panamá", "507", "US$", 2],
  ["AR", "🇦🇷 Argentina", "54", "$", 2],
  ["PE", "🇵🇪 Perú", "51", "S/", 2],
  ["CL", "🇨🇱 Chile", "56", "$", 0],
  ["XX", "🌎 Otro país", "", "", 2],
];

/** Miles con punto y decimales con coma: money(3500000, {symbol:"₲", decimals:0}) → "₲ 35.000". */
export function money(cents, cur = { symbol: "Bs", decimals: 2 }) {
  const n = Math.round(Number(cents) || 0), neg = n < 0, abs = Math.abs(n);
  const group = (u) => String(u).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  if (cur.decimals === 0) return `${cur.symbol} ${neg ? "-" : ""}${group(Math.round(abs / 100))}`;
  const u = Math.floor(abs / 100), c = abs % 100;
  return `${cur.symbol} ${neg ? "-" : ""}${group(u)}${c ? "," + String(c).padStart(2, "0") : ""}`;
}

/** Igual que el servidor: Bs → su moneda con su tipo de cambio, redondeado hacia arriba a 3 cifras. */
export function convertFromStore(bsCents, rate) {
  const units = (bsCents / 100) * rate;
  if (!(units > 0)) return 0;
  const step = Math.max(1, 10 ** (Math.floor(Math.log10(units)) - 2));
  return Math.ceil(Number((units / step).toFixed(6))) * step * 100;
}

/* ---- el revendedor que está mirando su panel ---- */
let MY = null;
/** shop.js lo fija al cargar /api/me (y ownstock.js al cambiarlo). */
export const setMine = (loc) => { MY = loc && loc.symbol ? loc : null; };
export const myLocale = () => MY;
/** ¿Su moneda es otra que la de la tienda? */
export const foreign = () => !!MY?.foreign;
/** Lo suyo en su moneda. Si es de Bolivia, exactamente como siempre (bs). */
export const mine = (cents) => (MY?.foreign ? money(cents, MY) : bs(cents));
export const mySym = () => (MY?.foreign ? MY.symbol : currencySym());
/** Lo que va en el campo WhatsApp de un cliente nuevo: "+591 " en Bolivia; vacío en otro país. */
export const myPhoneDefault = () => (!MY || MY.dial === "591" ? "+591 " : "");
export const myPhoneHint = () => (!MY || MY.dial === "591" ? "+591 7…" : MY.country === "PY" ? "0981 123 456" : `+${MY.dial} …`);
/** Un precio de su lista (cargada en Bs) como lo ve su cliente: convertido con su tipo de cambio. */
export const sellText = (bsCents) => (!MY?.foreign ? bs(bsCents) : MY.rate ? money(convertFromStore(bsCents, MY.rate), MY) : bs(bsCents));

const reEsc = (s) => s.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");

/**
 * "Pegar mi lista": busca el WhatsApp en una línea con el código de SU país.
 * Bolivia: null (sigue la regla de siempre de shop.js). Otro país: el match con `.phone`, o false.
 */
export function findPhone(t) {
  if (!MY || MY.dial === "591") return null;
  const re = MY.country === "PY" ? /(?:\+?\s*595[\s-]*|\b0)?(9(?:[\s-]?\d){8})(?!\d)/
    : new RegExp(`(?:\\+?\\s*${MY.dial}[\\s-]*|\\b0)?(\\d(?:[\\s-]?\\d){7,10})(?!\\d)`);
  let m = t.match(re);
  if (m) { m.phone = `+${MY.dial}${m[1].replace(/\D/g, "")}`; return m; }
  m = t.match(/\+\s*591[\s-]*([67](?:[\s-]?\d){7})(?!\d)/); // un número de Bolivia escrito con +591
  if (m) { m.phone = `+591${m[1].replace(/\D/g, "")}`; return m; }
  return false;
}

/** "Pegar mi lista": el precio en SU moneda ("₲ 35.000", "35000", "35.000", "35 mil"). Bolivia: null. */
export function findPrice(t) {
  if (!MY?.foreign) return null;
  const num = (s) => Number(String(s).replace(/\.(?=\d{3}(\D|$))/g, "").replace(",", "."));
  const sym = reEsc(MY.symbol);
  let m = t.match(new RegExp(`(?:${sym}|gs\\.?)\\s*(\\d{1,3}(?:\\.\\d{3})+|\\d+(?:,\\d{1,2})?)`, "i"))
    || t.match(/(?:^|[\s-])(\d{1,3}(?:\.\d{3})+|\d{4,9})(?=[\s-]|$)/);
  if (m) { m.cents = Math.round(num(m[1]) * 100); return m; }
  m = t.match(/(?:^|[\s-])(\d{1,4})\s*mil(?=[\s-]|$)/i);
  if (m) { m.cents = Number(m[1]) * 1000 * 100; return m; }
  if (MY.decimals === 2) { m = t.match(/(?:^|[\s-])(\d{1,3}(?:,\d{1,2})?)(?=[\s-]|$)/); if (m) { m.cents = Math.round(num(m[1]) * 100); return m; } }
  return false;
}

/**
 * "Mis ganancias" de un revendedor de otro país: lo que vendió y cobró va en SU moneda; lo que le
 * costó, en la de la tienda. Son dos cifras separadas: nunca se restan ni se suman entre sí.
 */
export function earnSplitView(g, sm) {
  const m = g.month, store = (c) => bs(c);
  const rate = MY?.rate ? ` <small class="empty">(≈ ${esc(money(convertFromStore(m.cost, MY.rate), MY))} con tu tipo de cambio)</small>` : "";
  return `<div class="sbox"><h2 style="margin:0">📈 Mis ganancias · ${esc(m.label)}</h2>
      <p class="empty" style="margin:0">Lo que cobrás va en <b>${esc(MY?.symbol ?? "")}</b> y lo que le pagás a la tienda va en <b>${esc(currencySym())}</b>. Son dos monedas: se muestran por separado, sin mezclarlas.</p>
      <div class="rkpis"><div><small>Vendiste por</small><b>${mine(m.revenue)}</b><small>${m.sales} venta(s)</small></div><div><small>Ya cobraste</small><b class="ok">${mine(m.collected)}</b></div><div><small>Te deben</small><b class="${m.unpaid ? "bad" : ""}">${mine(m.unpaid)}</b></div><div><small>Le pagaste a la tienda</small><b>${store(m.cost)}</b></div></div>
      <p class="empty" style="margin:0">Te costó ${store(m.cost)}${rate}.</p>
      ${m.noPrice ? `<p class="empty" style="margin:0">⚠️ ${m.noPrice} venta(s) sin tu precio en ${esc(MY?.symbol ?? "")}: no suman en “Vendiste por”. Poné lo que le cobrás en “Mi control”${MY?.rate ? "" : " o tu tipo de cambio en Inicio → “🌎 Mi país y moneda”"}.</p>` : ""}
      ${MY?.rate ? `<p class="empty" style="margin:0">≈ Ganaste unos <b>${esc(money(m.collected - Math.round(m.cost * MY.rate), MY))}</b>: lo que ya cobraste menos lo que le pagaste a la tienda, pasado con tu tipo de cambio.</p>` : `<p class="empty" style="margin:0">💱 Para ver cuánto ganaste en ${esc(MY?.symbol ?? "")}, poné tu tipo de cambio en Inicio → “🌎 Mi país y moneda”.</p>`}</div>
    ${sm?.accounts ? `<div class="sbox"><h3 style="margin:0">🧩 Tus cuentas alquiladas (por mes)</h3><div class="rkpis"><div><small>Te cuestan</small><b>${store(sm.cost)}</b><small>${sm.accounts} cuenta(s)</small></div><div><small>Cobrás por perfiles</small><b>${mine(sm.revenue)}</b><small>${sm.profiles} perfil(es)</small></div></div></div>` : ""}
    ${g.byApp.length ? `<div class="sbox"><h3 style="margin:0">Por app (este mes)</h3>${g.byApp.map((p) => `<div class="line"><span><b>${esc(p.name)}</b><br><small class="empty">${p.sales} venta(s) · te costó ${store(p.cost)}${p.unpaid ? ` · te deben ${mine(p.unpaid)}` : ""}</small></span><b>${mine(p.revenue)}</b></div>`).join("")}</div>` : ""}
    <div class="sbox"><h3 style="margin:0">Últimos meses</h3>${g.months.length ? g.months.map((x) => `<div class="line"><span>${esc(x.label)}</span><span><b>${mine(x.revenue)}</b> <small class="empty">· costó ${store(x.cost)}</small></span></div>`).join("") : `<p class="empty" style="margin:0">Todavía no hay ventas.</p>`}</div>`;
}

/* ---------------- panel del dueño: país del revendedor (ficha) ---------------- */
/** Una línea en la tarjeta del revendedor: su país/moneda, cuántas cuentas propias tiene, y un formulario para cambiarlo. */
export function resellerCountryRow(r) {
  const l = r.locale ?? { country: "BO", flag: "🇧🇴", name: "Bolivia", symbol: "Bs", dial: "591", decimals: 2, rate: null };
  const own = r.ownStock && (r.ownStock.products || r.ownStock.accounts) ? ` · 📦 ${r.ownStock.products} producto(s) propio(s), ${r.ownStock.accounts} cuenta(s)` : "";
  return `<details class="rcountry" style="margin-top:2px"><summary class="muted" style="cursor:pointer;min-height:44px;display:flex;align-items:center;font-size:13px">${esc(l.flag)} ${esc(l.name)} · ${esc(l.symbol)} · +${esc(l.dial)}${own}</summary>
    <form class="rcountry-f" data-rcountry="${esc(r.id)}" style="display:grid;grid-template-columns:repeat(auto-fit,minmax(120px,1fr));gap:8px;align-items:end"><label style="display:grid;gap:4px;font-size:12px">País<select name="country">${COUNTRIES.map(([k, t]) => `<option value="${k}" ${l.country === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label style="display:grid;gap:4px;font-size:12px">Código (sin +)<input name="dial" inputmode="numeric" maxlength="4" value="${esc(l.dial)}"></label>
      <label style="display:grid;gap:4px;font-size:12px">Moneda<input name="symbol" maxlength="4" value="${esc(l.symbol)}"></label>
      <button class="pbtn sm" type="submit">Guardar país</button><small class="muted" role="status" aria-live="polite"></small></form></details>`;
}

// Un solo listener (con captura) para el formulario de la ficha: no pasa por el submit general del panel.
if (typeof document !== "undefined") {
  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    if (!f?.dataset?.rcountry) return;
    ev.preventDefault(); ev.stopPropagation();
    const out = f.querySelector("[role=status]");
    const body = { country: f.country.value, dial: f.dial.value, symbol: f.symbol.value };
    try {
      const r = await fetch(`/api/admin/customers/${encodeURIComponent(f.dataset.rcountry)}/locale`, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.message || `Error ${r.status}`);
      f.dial.value = j.dial; f.symbol.value = j.symbol;
      const sum = f.closest("details")?.querySelector("summary");
      if (sum) sum.textContent = `${j.flag} ${j.name} · ${j.symbol} · +${j.dial}`;
      out.textContent = "✓ Guardado";
    } catch (e) { out.textContent = e.message; }
  }, true);
  document.addEventListener("change", (ev) => {
    const f = ev.target?.form;
    if (!f?.dataset?.rcountry || ev.target.name !== "country") return;
    const c = COUNTRIES.find(([k]) => k === ev.target.value);
    // Al elegir un país se completan su código y su moneda (se pueden corregir antes de guardar).
    if (c && c[0] !== "XX") { f.dial.value = c[2]; f.symbol.value = c[3]; }
  }, true);
}
