// Revendedor de afuera (Paraguay, Panamá…), del lado del navegador:
//  - "🌎 Mi país, moneda y tipo de cambio": UN solo formulario (countryForm) que se usa en su Inicio,
//    en "📦 Mis cuentas propias" y en Afiches. Con un ejemplo calculado en vivo.
//  - La tarjeta de su Inicio (countryHomeCard), con aviso si le falta el tipo de cambio.
//  - "Tu día": los avisos de sus cuentas propias que vencen en 3 días (ownTodayRow).
//  - Afiches y "Mi lista de precios" en SU moneda (posterMoney, sellHint…).
// Los montos de la tienda (lo que él compra) siguen con bs()/currencySym(); lo suyo, con money(…, su moneda).
// shop.js solo llama a estas funciones; la lógica y los eventos están acá.
import { api, esc, bs, currencySym, toast } from "/common.js";
import { COUNTRIES, money, convertFromStore, setMine, myLocale } from "/country.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/afuera.css"]')) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/afuera.css"; document.head.append(l);
}

const UI = { open: {}, err: {}, sample: null, sampleLoading: false, scroll: false };
let REFRESH = () => {};
const saved = new Set();
/** shop.js le pasa su refresh(): después de guardar el país se recarga todo (ganancias, precios, página). */
export function initAfuera(refresh) { REFRESH = refresh; }
/** Otro módulo (ownstock.js) se entera cuando cambia el país o el tipo de cambio. */
export const onLocaleSaved = (fn) => saved.add(fn);

/** Su moneda de compra (Bs, o US$ si está en la lista en dólares). */
export const buySym = () => myLocale()?.store?.symbol ?? currencySym();
const cur = (l) => ({ symbol: l.symbol, decimals: l.decimals === 0 ? 0 : 2 });
/** 7300 → "7.300"; 1050,5 → "1.050,5". */
const num = (n) => { const [i, d] = String(n).split("."); return i.replace(/\B(?=(\d{3})+(?!\d))/g, ".") + (d ? "," + d : ""); };
const rateText = (l) => `1 ${buySym()} = ${l.symbol} ${num(l.rate)}`;

/* ---------------- ejemplo en vivo ---------------- */
/** El producto de ejemplo: el más caro de su lista (ej.: Disney + ESPN, US$ 7). */
export function pickSample(prices) {
  const p = (prices ?? []).filter((x) => x.cost > 0).sort((a, b) => b.cost - a.cost)[0];
  return p ? { name: p.name.replace(/ \(alquiler revendedores\)/, ""), cost: p.cost } : null;
}
function sample() {
  if (UI.sample || UI.sampleLoading || typeof fetch === "undefined") return UI.sample;
  // En "Mis cuentas propias" o Afiches puede no estar cargada su lista: se pide una vez.
  UI.sampleLoading = true;
  api("GET", "/api/me/prices").then((ps) => { UI.sample = pickSample(ps); if (UI.sample) document.querySelectorAll("form[data-locf]").forEach(updateExample); }).catch(() => {});
  return null;
}
/** "Disney + ESPN te cuesta US$ 7 ≈ ₲ 51.100" (redondeado como en su página). */
export function exampleText(s, buy, l) {
  if (!l.symbol) return "";
  if (l.symbol === buy && l.decimals !== 0) return `Tu moneda es la misma con la que comprás (${buy}): no hace falta tipo de cambio.`;
  if (!s) return l.rate ? `Ejemplo: algo que te cuesta ${buy} 10 sale ${money(convertFromStore(1000, l.rate), cur(l))} en tu página.` : "";
  const base = `${s.name} te cuesta ${money(s.cost, { symbol: buy, decimals: 2 })}`;
  return l.rate ? `${base} ≈ ${money(convertFromStore(s.cost, l.rate), cur(l))}` : `${base} ≈ ${l.symbol} … (poné tu tipo de cambio)`;
}
/** "7300", "7.300" (miles con punto, como se escribe en Paraguay) o "6,96" → número. Igual que el servidor. */
export function parseRate(v) {
  const t = String(v ?? "").trim().replace(/\s/g, "");
  const n = Number((/^\d{1,3}(\.\d{3})+(,\d+)?$/.test(t) ? t.replace(/\./g, "") : t).replace(",", "."));
  return n > 0 ? n : null;
}
function formLocale(f) {
  return { symbol: f.symbol.value.trim(), decimals: Number(f.decimals.value), rate: parseRate(f.rate.value) };
}
function updateExample(f) {
  const out = f.querySelector("[data-locex]"), sym = f.querySelector("[data-locsym]");
  const l = formLocale(f);
  if (sym) sym.textContent = l.symbol;
  if (out) out.textContent = exampleText(UI.sample, buySym(), l);
}

/* ---------------- el formulario (uno solo para todo el panel) ---------------- */
/**
 * Formulario de país, moneda y tipo de cambio. `where` distingue dónde está (home, own, afiches) para
 * los ids y los mensajes de error.
 */
export function countryForm(where, { rateFirst = false } = {}) {
  const l = myLocale() ?? { country: "BO", dial: "591", symbol: currencySym(), decimals: 2 };
  const buy = buySym(), id = `af-${where}`;
  const fields = `<label>País<select name="country">${COUNTRIES.map(([k, t]) => `<option value="${k}" ${l.country === k ? "selected" : ""}>${t}</option>`).join("")}</select></label>
      <label>Código de teléfono (sin +)<input name="dial" inputmode="numeric" maxlength="4" value="${esc(l.dial)}" required></label>
      <label>Símbolo de tu moneda<input name="symbol" maxlength="4" value="${esc(l.symbol)}" required></label>
      <label>Decimales<select name="decimals"><option value="2" ${l.decimals === 2 ? "selected" : ""}>Con centavos (12,50)</option><option value="0" ${l.decimals === 0 ? "selected" : ""}>Sin centavos (35.000)</option></select></label>`;
  const rate = `<label class="af-wide af-rate" for="${id}-rate">Tipo de cambio: 1 ${esc(buy)} = <input id="${id}-rate" name="rate" inputmode="decimal" value="${l.rate ?? ""}" placeholder="${buy === "US$" ? "Ej.: 7300" : "Ej.: 1050"}" aria-describedby="${id}-help ${id}-ex"> <span data-locsym>${esc(l.symbol)}</span></label>
      <p class="af-ex af-wide" id="${id}-ex" data-locex aria-live="polite">${esc(exampleText(sample(), buy, l))}</p>`;
  // Si solo le falta el tipo de cambio, va primero; país y moneda quedan plegados (ya están bien).
  return `<form class="sform af-grid" data-locf="${esc(where)}">
      ${rateFirst ? `${rate}<details class="af-wide af-more"><summary>País, código y moneda <small class="empty">(${esc(l.symbol)} · +${esc(l.dial)})</small></summary><div class="af-grid">${fields}</div></details>` : `${fields}${rate}`}
      <p class="empty af-wide" id="${id}-help" style="margin:0">Con tu tipo de cambio, tu página, tus afiches y tu lista muestran los productos de la tienda en tu moneda (redondeados para arriba). Lo que le comprás a la tienda sigue en ${esc(buy)}.</p>
      ${rateFirst ? "" : `<p class="empty af-wide" style="margin:0">Tus clientes nuevos se cargan con +${esc(l.dial)}. Si cambiás de moneda, los montos que ya anotaste no se convierten solos.</p>`}
      ${UI.err[where] ? `<p class="af-err af-wide" role="alert">${esc(UI.err[where])}</p>` : ""}
      <button class="sbtn pri af-wide" type="submit">Guardar</button></form>`;
}

/* ---------------- tarjeta del Inicio ---------------- */
/**
 * Tarjeta "🌎 Mi país, moneda y tipo de cambio" del Inicio del revendedor.
 * `usd`: está en la lista en dólares (entonces casi seguro vende desde afuera).
 */
export function countryHomeCard(prices, { usd = false } = {}) {
  const s = pickSample(prices);
  if (s) UI.sample = s;
  const l = myLocale() ?? { country: "BO", flag: "🇧🇴", name: "Bolivia", symbol: currencySym(), dial: "591", decimals: 2, foreign: false };
  if (UI.scroll) { UI.scroll = false; setTimeout(() => { const el = document.getElementById("afCountry"); el?.scrollIntoView({ block: "start" }); el?.querySelector("select,input")?.focus(); }, 0); }
  const where = `${esc(l.flag ?? "")} ${esc(l.name ?? "")} · ${esc(l.symbol)}`;
  // 1) De afuera sin tipo de cambio: aviso claro y el formulario abierto.
  if (l.foreign && !l.rate) return `<section class="sbox af-card af-warn" id="afCountry" aria-labelledby="afCountryT"><h2 id="afCountryT" class="af-h">🌎 Tu tipo de cambio</h2>
      <p class="af-alert">⚠️ Poné tu tipo de cambio (1 ${esc(buySym())} = … ${esc(l.symbol)}) para ver tus ganancias y tu página en tu moneda.</p>
      ${countryForm("home", { rateFirst: true })}</section>`;
  // 2) En la lista en dólares pero todavía "Bolivia": que elija su país.
  if (usd && l.country === "BO") return `<section class="sbox af-card af-warn" id="afCountry" aria-labelledby="afCountryT"><h2 id="afCountryT" class="af-h">🌎 ¿Desde qué país vendés?</h2>
      <p class="af-alert">Elegí tu país y tu moneda: así tus clientes nuevos se cargan con tu código de teléfono y ves tus ganancias y tu página en tu moneda.</p>${countryForm("home")}</section>`;
  // 3) Bolivia de siempre: una línea plegada (por si vende desde otro país).
  if (!l.foreign && l.country === "BO") return `<details class="sbox af-card af-mini" id="afCountry" ${UI.open.home ? "open" : ""}><summary><b>🌎 Mi país y moneda</b> <small class="empty">${where} · ¿Vendés desde otro país?</small></summary>${countryForm("home")}</details>`;
  // 4) Ya configurado: su país, su tipo de cambio y el ejemplo a la vista; el formulario, plegado.
  return `<section class="sbox af-card" id="afCountry" aria-labelledby="afCountryT"><div class="af-head"><h2 id="afCountryT" class="af-h">🌎 ${where}</h2>${l.foreign && l.rate ? `<span class="af-pill">${esc(rateText(l))}</span>` : ""}</div>
      <p class="af-ex">${esc(exampleText(UI.sample, buySym(), l))}</p>
      <details ${UI.open.home ? "open" : ""}><summary class="sbtn sm">✏️ Cambiar país, moneda o tipo de cambio</summary>${countryForm("home")}</details></section>`;
}
/** ¿El formulario de ese lugar quedó abierto (por ejemplo, con un error)? */
export const formOpen = (where) => !!UI.open[where];
/** Botón del menú "Tu negocio" que lleva a la tarjeta. */
export const countryMenuBtn = () => `<button class="sbtn" type="button" data-afuera="pais"><span>🌎</span>Mi país y moneda</button>`;

/* ---------------- "Tu día": cuentas propias que vencen ---------------- */
export function ownTodayRow(soon) {
  const n = soon?.clients?.length ?? 0, m = soon?.provider?.length ?? 0;
  if (!n && !m) return "";
  // 14/11: lo ya vencido (`late`) se dice como vencido, no como «vence».
  const lc = (soon.clients ?? []).filter((c) => c.late).length, lp = (soon.provider ?? []).filter((a) => a.late || a.down).length;
  const who = [lc ? `${lc === 1 ? "1 cliente ya venció" : `${lc} clientes ya vencieron`}` : "", n - lc ? `${n - lc === 1 ? "1 cliente vence" : `${n - lc} clientes vencen`}` : "",
    lp ? `${lp === 1 ? "1 cuenta vencida o caída" : `${lp} cuentas vencidas o caídas`} con tu proveedor` : "", m - lp ? `${m - lp === 1 ? "1 cuenta vence" : `${m - lp} cuentas vencen`} con tu proveedor` : ""].filter(Boolean).join(" · ");
  const names = [...(soon.clients ?? []).slice(0, 3).map((c) => c.name.split(" ")[0]), ...(soon.provider ?? []).slice(0, 2).map((a) => a.user)].join(", ");
  return `<button type="button" class="tday-own${lc + lp ? " late" : ""}" data-rtool="propias"><span aria-hidden="true">📦</span><span><b>Cuentas propias: ${esc(who)}</b><small>${lc + lp ? "Ya vencidos o vencen" : "Vencen"} en ${soon.days ?? 3} días o menos · ${esc(names)}</small></span><i aria-hidden="true">›</i></button>`;
}

/* ---------------- su moneda en afiches, lista y ganancias ---------------- */
/** ¿Es de afuera y le falta el tipo de cambio? */
export const needsRate = () => !!myLocale()?.foreign && !myLocale()?.rate;
/** Un precio de su lista (en su moneda de compra) como lo ve su cliente; null si le falta el tipo de cambio. */
export function posterMoney(cents) {
  const l = myLocale();
  if (!l?.foreign) return bs(cents);
  return l.rate ? money(convertFromStore(cents, l.rate), cur(l)) : null;
}
/** Afiches sin tipo de cambio: no se arma con la moneda equivocada; se pide cargarlo ahí mismo. */
export const posterRateBox = () => `<div class="sbox af-card af-warn"><h2 class="af-h">🖼️ Afiches para tus estados</h2>
    <p class="af-alert">⚠️ Tus clientes pagan en ${esc(myLocale()?.symbol ?? "")}: poné tu tipo de cambio (1 ${esc(buySym())} = … ${esc(myLocale()?.symbol ?? "")}) y el afiche sale con tus precios en tu moneda.</p>${countryForm("afiches", { rateFirst: true })}</div>`;
/** WhatsApp del afiche: Bolivia "7123 4567" (como siempre); otro país "+595 981 123 456". */
export function posterPhone(raw) {
  const d = String(raw ?? "").replace(/\D/g, ""), dial = myLocale()?.dial;
  if (dial && dial !== "591" && d.startsWith(dial) && d.length > dial.length + 5) {
    const r = d.slice(dial.length);
    return `+${dial} ${r.length === 8 ? r.replace(/^(\d{4})(\d{4})$/, "$1 $2") : r.replace(/(\d{3})(?=\d{3,})/g, "$1 ")}`;
  }
  return d.replace(/^591(?=\d{8}$)/, "").replace(/^(\d{4})(\d{4})$/, "$1 $2");
}
/** "Mi lista de precios": de afuera, qué ve su cliente en su página. */
export function listNote() {
  const l = myLocale();
  if (!l?.foreign) return "";
  return l.rate ? `<p class="af-ex" style="margin:0">💱 Estos precios van en ${esc(buySym())}. Tus clientes los ven en ${esc(l.symbol)} con tu tipo de cambio (${esc(rateText(l))}).</p>`
    : `<p class="af-alert" style="margin:0">⚠️ Estos precios van en ${esc(buySym())}. <button class="af-link" type="button" data-afuera="pais">Poné tu tipo de cambio</button> para que tus clientes los vean en ${esc(l.symbol)}.</p>`;
}
export const sellHint = (cents) => { const l = myLocale(); return l?.foreign && l.rate && cents !== null && cents !== undefined ? ` · tu cliente ve ${esc(money(convertFromStore(cents, l.rate), cur(l)))}` : ""; };
/** "Ganaste este mes" de "Tu día" cuando sus ventas van en otra moneda: aproximado con su tipo de cambio. */
export function splitGainText(g, sm) {
  const l = myLocale();
  if (!l?.foreign || !l.rate) return "—";
  const m = g?.month ?? { collected: 0, cost: 0 };
  const v = (m.collected ?? 0) - Math.round((m.cost ?? 0) * l.rate) + (sm ? (sm.revenue ?? 0) - Math.round((sm.cost ?? 0) * l.rate) : 0);
  return `≈ ${money(v, cur(l))}`;
}

/* ---------------- eventos (con captura: no pasan por los de shop.js) ---------------- */
if (typeof document !== "undefined") {
  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    const where = f?.dataset?.locf;
    if (!where) return;
    ev.preventDefault(); ev.stopPropagation();
    const btn = f.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    delete UI.err[where];
    try {
      const l = await api("PUT", "/api/me/locale", { country: f.country.value, dial: f.dial.value, symbol: f.symbol.value, decimals: Number(f.decimals.value), rate: f.rate.value.trim() || null });
      setMine(l); UI.open[where] = false;
      for (const fn of saved) { try { await fn(l); } catch { /* que no corte el guardado */ } }
      toast(l.foreign && l.rate ? `🌎 Guardado: ${rateText(l)}` : "🌎 Guardado");
    } catch (e) { UI.err[where] = e.message; UI.open[where] = true; }
    if (btn?.isConnected) btn.disabled = false;
    await REFRESH();
  }, true);
  document.addEventListener("input", (ev) => {
    const f = ev.target?.form;
    if (f?.dataset?.locf && ["rate", "symbol", "decimals"].includes(ev.target.name)) updateExample(f);
  }, true);
  document.addEventListener("change", (ev) => {
    const t = ev.target, f = t?.form;
    if (!f?.dataset?.locf) return;
    // Al elegir otro país se completan su código y su moneda (se pueden corregir antes de guardar).
    if (t.name === "country") {
      const c = COUNTRIES.find(([k]) => k === t.value);
      if (c && c[0] !== "XX") { f.dial.value = c[2]; f.symbol.value = c[3]; f.decimals.value = String(c[4]); }
    }
    updateExample(f);
  }, true);
  document.addEventListener("toggle", (ev) => {
    const d = ev.target;
    if (d?.id === "afCountry" || d?.parentElement?.id === "afCountry") UI.open.home = d.open;
  }, true);
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-afuera]");
    if (!b) return;
    ev.stopPropagation();
    UI.open.home = true; UI.scroll = true;
    const card = document.getElementById("afCountry");
    if (card) { if (card.tagName === "DETAILS") card.open = true; card.querySelector("details")?.setAttribute("open", ""); UI.scroll = false; card.scrollIntoView({ block: "start" }); card.querySelector("select,input")?.focus(); return; }
    // Desde otra pantalla: al Inicio, con la tarjeta abierta.
    location.hash = "#inicio";
  }, true);
}
