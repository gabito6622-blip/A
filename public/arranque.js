// Arranque del revendedor nuevo en GaboHub (revisión de 3 meses, 15/11/2026). shop.js solo llama a estas funciones.
//  - «🚀 Primeros pasos» a la vista (no plegado): 1) recargá saldo (si compra a la tienda), 2) primera venta,
//    3) tu página. Se tachan solos con lo que dice el servidor (/api/me/primeros-pasos).
//  - Sin página: «Tu página: pedísela a la tienda» con WhatsApp. Con página: el botón de siempre.
//  - Independiente: una línea que explica qué significa y a quién pedirle cambiarlo.
//  - La dirección de su página sale del nombre de SU TIENDA («Ana TV» → /r/ana-tv) y se ve antes de publicar.
import { api, esc, waLink } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/arranque.css"]')) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/arranque.css"; document.head.append(l);
}

/** Link de WhatsApp a la tienda para pedir algo (página propia, cambiar de tipo…). */
const storeWa = (settings, me, what) => settings?.whatsapp ? waLink(settings.whatsapp, `Hola, soy ${me?.name ?? ""} (revendedor en ${settings.platformName || "GaboHub"}). ${what}`) : "";

/** Botón «Pedísela a la tienda» (o texto si la tienda no tiene WhatsApp cargado). */
function askBtn(settings, me, what, label) {
  const href = storeWa(settings, me, what);
  return href ? `<a class="sbtn sm pri" href="${esc(href)}" target="_blank" rel="noopener">💬 ${esc(label)}</a>` : `<span class="empty">Pedíselo a la tienda.</span>`;
}

/** ¿Se muestran los primeros pasos? Mientras falte algo que dependa de él (sin página no lo frena). */
export function stepsPending(p) {
  if (!p) return false;
  return (p.buys && !p.topup) || !p.sale || p.page === "build";
}

/** Tarjeta «🚀 Primeros pasos», visible arriba del Inicio. `pageBtnAttr` = data-wiz o data-gopage (lo arma shop.js). */
export function firstStepsCard(p, { settings, me, pageBtnAttr }) {
  if (!stepsPending(p)) return "";
  const steps = [
    ...(p.buys ? [{ done: p.topup, t: "Recargá saldo", d: "Con QR desde tu celular. Con saldo comprás y le das la cuenta a tu cliente al instante.", btn: `<button class="sbtn sm pri" type="button" data-s="recargas">Recargar</button>` }] : []),
    { done: p.sale, t: "Hacé tu primera venta", d: p.buys ? "Elegí el cliente y la cuenta: se paga con tu saldo y te queda el mensaje listo." : "Cargá una cuenta tuya y anotá a quién se la vendiste.", btn: `<button class="sbtn sm pri" type="button" data-rtool="${p.buys ? "ventas" : "propias"}">Vender</button>` },
    p.page === "ask"
      ? { done: false, ask: true, t: "Tu página: pedísela a la tienda", d: "Tu propia tienda con tu logo y tus precios (/r/tu-tienda). La habilita la tienda.", btn: askBtn(settings, me, "Quiero mi página propia.", "Pedirla") }
      : { done: p.page === "done", t: "Publicá tu página", d: "Tu tienda con tu logo y tus precios. Te toma 2 minutos.", btn: `<button class="sbtn sm pri" type="button" ${pageBtnAttr}>Armala</button>` },
  ];
  const n = steps.filter((s) => s.done).length;
  // Solo el paso que sigue lleva su explicación: la tarjeta entra en la pantalla sin tapar los botones grandes.
  const next = steps.findIndex((s) => !s.done);
  return `<section class="sbox setupr arr-pasos" aria-label="Primeros pasos"><b>🚀 Primeros pasos · ${n} de ${steps.length}</b>
    <div class="pgbar" aria-hidden="true"><i style="width:${Math.round((n / steps.length) * 100)}%"></i></div>
    <ol class="pasos">${steps.map((s, i) => `<li class="paso ${s.done ? "done" : ""}${s.ask ? " ask" : ""}"><span class="arr-n" aria-hidden="true">${s.done ? "✓" : i + 1}</span><div class="arr-tx"><b>${s.done ? `<s>${esc(s.t)}</s>` : esc(s.t)}</b>${i === next ? `<small>${esc(s.d)}</small>` : ""}</div>${s.done ? `<span class="pdone">Listo ✓</span>` : s.btn}</li>`).join("")}</ol></section>`;
}

/** Independiente: qué significa, en una línea, y a quién pedirle cambiarlo. */
export function indepLine({ settings, me }) {
  return `<div class="hbox arr-indep"><span><b>🆕 Independiente:</b> vendés con tus cuentas propias, no le comprás a la tienda. Para cambiarlo, pedíselo a la tienda.</span>${askBtn(settings, me, "Soy independiente y quiero poder comprarle cuentas a la tienda.", "Pedir")}</div>`;
}

/** «Precios para revendedores» de un independiente: en vez de un catálogo vacío, la explicación. */
export function indepCatalog({ settings, me }) {
  return `<div class="sec-h"><div><span class="chip">Revendedor independiente</span><h2>Comprar a la tienda</h2><p>Como independiente vendés con tus cuentas propias: la tienda no te muestra su stock ni te vende cuentas.</p></div></div>
    <div class="sbox arr-indepcat"><p class="empty" style="margin:0">Si querés comprarle cuentas a la tienda, pedile que te pase a «De confianza».</p>${askBtn(settings, me, "Soy independiente y quiero poder comprarle cuentas a la tienda.", "Pedírselo por WhatsApp")}
      <button class="sbtn" type="button" data-rtool="propias">📦 Ir a mis cuentas propias</button></div>`;
}

/** «Más» sin página: la entrada que explica cómo conseguirla (abre WhatsApp a la tienda). */
export const pageAskItem = () => [`data-pageask="1"`, "🏪 Pedir mi página a la tienda", "pagina mi pagina tienda propia logo pedir"];

let CTX = () => ({});
/** shop.js pasa una función que devuelve { settings, me } (para armar el WhatsApp). */
export function initArranque(ctx) { CTX = ctx; }

if (typeof document !== "undefined") {
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-pageask]");
    if (!b) return;
    const { settings, me } = CTX();
    const href = storeWa(settings, me, "Quiero mi página propia.");
    if (href) window.open(href, "_blank", "noopener");
  });
}

/* ---------------- Dirección de su página (asistente, paso 1) ---------------- */
/** Igual que el servidor (resellerShop.slugify): minúsculas, sin acentos, guiones. */
export const slugify = (s) => String(s ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);

/** Campo «Tu dirección» del paso 1. Si ya la guardó, la de siempre; si no, la propone desde el nombre de la tienda. */
export function slugField(w, sh, origin) {
  const val = w.slug ?? (sh.saved ? sh.slug : slugify(w.title ?? sh.title));
  return `<label>Tu dirección (la que compartís)<span class="arr-slug"><span class="arr-pre">${esc(origin.replace(/^https?:\/\//, ""))}/r/</span><input name="slug" required minlength="3" maxlength="30" autocapitalize="off" autocomplete="off" spellcheck="false" value="${esc(val)}" ${w.slugTouched ? 'data-touched="1"' : ""} aria-describedby="slugMsg"></span></label>
    <small class="empty arr-slugmsg" id="slugMsg" role="status">${sh.saved ? "Es la dirección de tu página. Cambiala solo si hace falta: el link viejo deja de andar." : "Sale del nombre de tu tienda. Podés cambiarla antes de publicar."}</small>`;
}

/** Paso 2: dónde se va a publicar, para confirmar antes de tocar «Publicar». */
export const slugConfirm = (url) => `<p class="arr-where">Se va a publicar en <b>${esc(url)}</b> · <button class="linkbtn" type="button" data-wizback="1">cambiar</button></p>`;

let slugTimer = null;
async function checkSlug(form) {
  const inp = form.querySelector('[name="slug"]'), msg = form.querySelector("#slugMsg");
  if (!inp || !msg) return;
  const want = inp.value.trim().toLowerCase();
  if (!/^[a-z0-9](?:[a-z0-9-]{1,28}[a-z0-9])$/.test(want)) { msg.textContent = "De 3 a 30 letras minúsculas, números o guiones, sin espacios."; msg.dataset.bad = "1"; return; }
  try {
    const r = await api("GET", `/api/me/shop/slug?t=${encodeURIComponent(want)}`);
    if (inp.value.trim().toLowerCase() !== want) return; // ya escribió otra cosa
    if (r.free || r.current === want) { msg.textContent = "✓ Libre: así queda tu link."; delete msg.dataset.bad; }
    else { msg.textContent = `Esa ya la usa otra tienda. Te propongo «${r.slug}».`; msg.dataset.bad = "1"; if (!inp.dataset.touched) inp.value = r.slug; }
  } catch { /* sin red: lo valida el servidor al guardar */ }
}
if (typeof document !== "undefined") {
  document.addEventListener("input", (ev) => {
    const f = ev.target.closest?.("#wiz1");
    if (!f) return;
    const inp = f.querySelector('[name="slug"]');
    if (!inp) return;
    if (ev.target === inp) { inp.dataset.touched = "1"; inp.value = inp.value.toLowerCase().replace(/\s+/g, "-"); }
    else if (ev.target.name === "title" && !inp.dataset.touched && f.dataset.saved !== "1") inp.value = slugify(ev.target.value) || inp.value;
    else return;
    clearTimeout(slugTimer);
    slugTimer = setTimeout(() => checkSlug(f), 350);
  });
}
