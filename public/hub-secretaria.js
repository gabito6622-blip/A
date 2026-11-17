// 🤵 «Mi secretaria» y 📈 «Cómo van» del revendedor en GaboHub (17/11/2026): lo mismo que tiene el dueño, con SUS datos.
// El servidor arma los mensajes (con su plantilla) y los números; acá solo se dibujan. Nada se manda solo: «💬 Mandar»
// abre WhatsApp (wa.me) con el texto y el revendedor lo envía a mano. Se carga solo en GaboHub (hub-perezoso.js).
import { api, esc, fdate, waLink, toast } from "/common.js";
import { mine } from "/country.js";

const H = { sec: null, cv: null, edit: null };
let ctx = { render: () => {}, goVentas: () => {} };
const dm = (t) => fdate(t).slice(0, 5);
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;

if (typeof document !== "undefined" && !document.querySelector('link[href="/hub-secretaria.css"]')) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/hub-secretaria.css"; document.head.append(l);
}

/** shop.js le pasa cómo volver a dibujar y cómo ir a «Clientes y ventas» (Mi lista de precios). */
export function initHubSecretaria(c) { ctx = { ...ctx, ...c }; }
export async function loadHubSecretaria() { H.sec = await api("GET", "/api/me/secretaria").catch((e) => ({ error: e.message })); }
export async function loadHubComoVan() { H.cv = await api("GET", "/api/me/como-van").catch((e) => ({ error: e.message })); }

const KIND = {
  cobrar: ["💵 Para cobrar", "Vencieron o te deben. Un mensaje amable y el link para pagar."],
  avisar: ["📣 Por vencer", "Vencen en los próximos días: avisales antes del corte."],
  renovo: ["✅ Ya renovaron", "Te pagaron hoy o ayer: confirmales hasta cuándo quedó."],
};
const SRC = { tienda: "de la tienda", perfil: "perfil", propia: "cuenta propia" };

function msgCard(m) {
  return `<article class="hsec-m" data-hsecmsg="${esc(m.kind)}:${esc(m.key)}">
    <header><b>${esc(m.name)}</b><small>${esc(m.services.join(", "))} · ${dm(m.date)}${m.amount !== null ? ` · ${esc(mine(m.amount))}` : ""} · ${m.sources.map((s) => SRC[s] ?? s).join(", ")}</small></header>
    <p class="hsec-t">${esc(m.text)}</p>
    <div class="hsec-a">${m.phone ? `<a class="sbtn sm pri" href="${esc(waLink(m.phone, m.text))}" target="_blank" rel="noopener" data-hsecwa="1">💬 Mandar por WhatsApp</a>` : `<small class="empty">Sin WhatsApp en su ficha</small>`}
      <button class="sbtn sm" type="button" data-copy="${esc(m.text)}">📋 Copiar</button></div></article>`;
}

function tplForm(S, kind) {
  const custom = S.custom.includes(kind);
  return `<form class="sform hsec-f" data-hsectpl="${kind}">
    <label>Mensaje «${esc(KIND[kind][0])}»<textarea name="text" rows="4" maxlength="700">${esc(S.templates[kind])}</textarea></label>
    <small class="empty">Podés usar ${S.fields.map((f) => `<code>${esc(f)}</code>`).join(" ")}. Si un cliente no tiene link o precio, esa línea no se manda.</small>
    <p class="hsec-err" role="alert" hidden></p>
    <div class="hsec-a"><button class="sbtn sm pri" type="submit">Guardar</button>${custom ? `<button class="sbtn sm" type="button" data-hsecreset="${kind}">Volver al de fábrica</button>` : ""}</div></form>`;
}

export function hubSecretariaView() {
  const S = H.sec;
  if (!S) return `<div class="sbox"><p class="empty" style="margin:0">Cargando tu secretaria…</p></div>`;
  if (S.error) return `<div class="sbox"><div class="err">${esc(S.error)}</div></div>`;
  const k = S.counts, todo = k.cobrar + k.avisar + k.renovo;
  const sec = (kind) => {
    const l = S[kind];
    return `<section class="sbox hsec-s" id="hsec-${kind}"><h3 style="margin:0">${KIND[kind][0]} <small class="empty">· ${l.length ? plural(l.length, "mensaje", "mensajes") : "nada"}</small></h3>
      <p class="empty" style="margin:0">${KIND[kind][1]}</p>
      ${l.length ? l.map(msgCard).join("") : `<p class="rdia-ok">Nada por acá ✅</p>`}</section>`;
  };
  return `<div class="sbox"><h2 style="margin:0">🤵 Mi secretaria</h2>
    <p class="empty" style="margin:0">Tus mensajes de hoy, listos. Tocá «💬 Mandar por WhatsApp»: se abre tu WhatsApp con el texto y lo mandás vos. Nada se manda solo.</p>
    <div class="rkpis hsec-k"><div class="${k.cobrar ? "bad" : ""}"><span>💵 Cobrar</span><b>${k.cobrar}</b></div><div class="${k.avisar ? "warn" : ""}"><span>📣 Avisar</span><b>${k.avisar}</b></div><div><span>✅ Renovaron</span><b>${k.renovo}</b></div></div>
    ${todo ? "" : `<p class="rdia-ok" style="margin:0">🎉 Hoy no tenés mensajes pendientes.</p>`}</div>
    ${sec("cobrar")}${sec("avisar")}${sec("renovo")}
    <details class="sbox hsec-tpl"${H.edit ? " open" : ""}><summary><b>✏️ Cambiar mis mensajes</b> <small class="empty">${S.custom.length ? `${S.custom.length} cambiado(s)` : "los de fábrica"}</small></summary>
      ${["avisar", "cobrar", "renovo"].map((kind) => tplForm(S, kind)).join("")}</details>
    <div class="sbox"><p class="empty" style="margin:0">💲 ¿Querés cambiar a cuánto le vendés a tus clientes? Está en «Mi lista de precios».</p><button class="sbtn" type="button" data-hsecprecios="1" style="justify-self:start">💲 Mis precios de venta</button></div>`;
}

/* ---------------- 📈 Cómo van ---------------- */
const diffTxt = (d, pct, money, badUp = false) => {
  if (!d) return `<span class="empty">= igual que el mes pasado</span>`;
  const up = d > 0;
  return `<span class="${up !== badUp ? "hcv-up" : "hcv-down"}">${up ? "▲" : "▼"} ${money ? esc(mine(Math.abs(d))) : Math.abs(d)}${pct === null || pct === undefined ? "" : ` (${pct > 0 ? "+" : ""}${pct} %)`}</span> <span class="empty">vs el mes pasado</span>`;
};
export function hubComoVanView() {
  const C = H.cv;
  if (!C) return `<div class="sbox"><p class="empty" style="margin:0">Cargando…</p></div>`;
  if (C.error) return `<div class="sbox"><div class="err">${esc(C.error)}</div></div>`;
  const t = C.month, p = C.prev, ch = C.change;
  const kpi = (label, val, prev, diff, extra = "") => `<div class="hcv-kpi"><small>${label}</small><b>${val}</b><span>${diff}</span><span class="empty">Mes pasado: ${prev}</span>${extra}</div>`;
  const parts = [t.perfiles && `perfiles ${esc(mine(t.perfiles))}`, t.clientes && `clientes de la tienda ${esc(mine(t.clientes))}`, t.propias && `cuentas propias ${esc(mine(t.propias))}`].filter(Boolean);
  return `<div class="sbox hcv"><h2 style="margin:0">📈 Cómo van</h2>
    <p class="empty" style="margin:0">📅 Este mes, del ${dm(C.from)} a hoy, contra el mes pasado completo. Solo tus números.</p>
    <div class="hcv-kpis">
      ${kpi("Te pagaron", esc(mine(t.paid)), esc(mine(p.paid)), diffTxt(ch.paid, ch.paidPct, true), parts.length ? `<span class="empty">${parts.join(" · ")}</span>` : "")}
      ${kpi("Clientes nuevos", t.nuevos, p.nuevos, diffTxt(ch.nuevos))}
      ${kpi("Renovaron", t.renovaron, p.renovaron, diffTxt(ch.renovaron), `<span class="empty">Clientes de antes que te pagaron</span>`)}
      ${kpi("Se fueron", t.fueron, p.fueron, diffTxt(ch.fueron, null, false, true), `<span class="empty">Se les venció y no renovaron (hace más de ${C.goneGraceDays} días)</span>`)}
    </div>
    <p class="empty" style="margin:0">Tenés <b>${C.activos}</b> cliente(s) con algo activo hoy. El % sale solo si el mes pasado fue de ${esc(mine(C.pctMin))} o más.</p></div>`;
}

/* ---------------- clics y formularios ---------------- */
if (typeof document !== "undefined") {
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest?.("[data-hsecreset],[data-hsecprecios]");
    if (!b) return;
    if (b.dataset.hsecprecios) { ctx.goVentas(); return; }
    b.disabled = true;
    try { await api("PUT", "/api/me/secretaria/plantilla", { kind: b.dataset.hsecreset, text: "" }); toast("Listo: volvió el mensaje de fábrica"); H.edit = true; await loadHubSecretaria(); ctx.render(); }
    catch (e) { toast(e.message); b.disabled = false; }
  });
  document.addEventListener("submit", async (ev) => {
    const f = ev.target.closest?.("form[data-hsectpl]");
    if (!f) return;
    ev.preventDefault(); ev.stopImmediatePropagation(); // el submit general de shop.js volvería a dibujar todo
    H.edit = true;
    const err = f.querySelector(".hsec-err"), btn = f.querySelector('[type="submit"]');
    err.hidden = true; btn.disabled = true;
    try {
      await api("PUT", "/api/me/secretaria/plantilla", { kind: f.dataset.hsectpl, text: f.elements.text.value });
      toast("✅ Mensaje guardado"); await loadHubSecretaria(); ctx.render();
    } catch (e) { err.textContent = e.message; err.hidden = false; btn.disabled = false; f.elements.text.focus(); }
  }, true);
}
