// Una sola página con tres modos:
//  - "hub"   (/)          GaboHub: la plataforma. Presentación, tiendas y el panel del revendedor.
//  - "store" (/tienda/)   Gabriel Store: la tienda de clientes finales.
//  - "rshop" (/r/<slug>)  La página propia de cada revendedor.
import { api, $, $$, esc, bs, setCurrency, lookColors, contrastNote, softwareNotice, enhanceFiles, toCents, fdate, daysLeft, icon, toast, fileToBase64, waLink, newKey, STATUS_TEXT, KIND_TEXT, FONT_LIST, BG_LIST, CARD_LIST, LAYOUT_LIST, THEMES, themeSwatch } from "/common.js";

const S = { me: null, settings: null, catalog: [], cart: [], view: "inicio", cat: "Todos", q: "", step: 1, data: {} };
/** Página propia de un revendedor: /r/<slug>. Es una vitrina: los pedidos van al WhatsApp del revendedor. */
const KLABEL = { login: "🔓 Inicio de sesión", hogar: "🏠 Actualizar hogar", temporal: "⏱️ Acceso temporal", verificacion: "🛡️ Verificación", otro: "✉️ Código" };
const SLUG = location.pathname.match(/^\/r\/([a-z0-9-]{3,30})\/?$/i)?.[1]?.toLowerCase() ?? null;
const MODE = SLUG ? "rshop" : /^\/tienda(\/|$)/.test(location.pathname) ? "store" : "hub";
const VIEWS = {
  rshop: ["inicio", "catalogo", "combo", "asesor"],
  store: ["inicio", "catalogo", "combo", "asesor", "cuentas", "codigos", "recargas"],
  hub: ["inicio", "tiendas", "precios", "cuentas", "clientes", "recargas", "codigos"],
}[MODE];

// Referido: si llegaste con ?ref=<id de un revendedor>, se guarda y viaja en la solicitud.
const REF = (() => {
  const q = new URLSearchParams(location.search).get("ref");
  try { if (q) sessionStorage.setItem("gs-ref", q); return (q || sessionStorage.getItem("gs-ref") || "").trim(); } catch { return (q || "").trim(); }
})();
const CART_KEY = `gs-cart-${MODE}${SLUG ? "-" + SLUG : ""}`;
try { S.cart = JSON.parse(localStorage.getItem(CART_KEY) || "[]"); } catch { S.cart = []; }
const saveCart = () => { try { localStorage.setItem(CART_KEY, JSON.stringify(S.cart)); } catch { /* sin almacenamiento */ } };
const guideSeen = () => { try { return !!localStorage.getItem("gs-guide-" + (S.me?.id || "")); } catch { return false; } };
const markGuideSeen = () => { try { localStorage.setItem("gs-guide-" + (S.me?.id || ""), "1"); } catch { /* sin almacenamiento */ } };
const product = (id) => S.catalog.find((p) => p.id === id);
const cartTotal = () => S.cart.reduce((s, l) => s + (product(l.productId)?.price ?? 0) * l.qty, 0);
const isReseller = () => S.me?.role === "reseller";
/* ---- Armá tu combo: mismo cálculo que el servidor (orders.comboDiscount) ---- */
const comboOn = () => (MODE === "store" ? !isReseller() : MODE === "rshop") && (S.settings?.comboDiscounts ?? []).some((v) => v > 0);
const comboable = (p) => p && p.kind !== "combo" && !p.resellersOnly;
const comboKey = (ids) => [...new Set(ids)].sort().join("|");
/** Si las apps elegidas son EXACTAMENTE las de un combo ya armado, devuelve ese combo (para cobrar su precio). */
const comboMatch = (ids) => {
  const key = comboKey(ids.filter((id) => comboable(product(id))));
  if (!key) return null;
  return (S.catalog ?? []).find((p) => p.kind === "combo" && p.comboParts?.length && comboKey(p.comboParts) === key) || null;
};
const discountFor = (ids) => {
  const comp = ids.filter((id) => comboable(product(id)));
  const match = comboMatch(ids);
  if (match) return Math.max(0, comp.reduce((s, id) => s + (product(id)?.price || 0), 0) - match.price);
  if (!comboOn()) return 0;
  const n = new Set(comp).size, d = S.settings.comboDiscounts;
  return n >= 4 ? d[2] : n === 3 ? d[1] : n === 2 ? d[0] : 0;
};
const cartDiscount = () => Math.min(discountFor(S.cart.map((l) => l.productId)), cartTotal());
/** Familia del servicio (Netflix, Disney+…): las variantes de una misma app son alternativas. */
const family = (p) => p.name.toLowerCase().replace(/^(invitación|cuenta|perfil)\s+/, "").split(/\s+/)[0];
/** El panel de GaboHub es para revendedores. */
const hubPanel = () => MODE === "hub" && isReseller();

/* ---------------- carga ---------------- */
async function loadBase() {
  if (SLUG) return loadResellerShop();
  [S.settings, S.me, S.catalog] = await Promise.all([api("GET", "/api/settings"), api("GET", "/api/me"), api("GET", "/api/catalog")]);
  setCurrency(S.settings.currencySymbol);
  S.settings.logoUrl = S.settings.hasLogo ? `/api/settings/logo?v=${Date.now() % 1e6}` : null;
  if (S.me.kind === "staff") S.me = { loggedIn: false, staff: true };
  // Saca del carrito lo que ya no existe.
  S.cart = S.cart.filter((l) => product(l.productId));
  if (MODE === "hub") {
    // La plataforma tiene su propio nombre; Gabriel Store es una tienda más adentro.
    S.storeName = S.settings.storeName;
    Object.assign(S.settings, { storeName: S.settings.platformName || "GaboHub", logoUrl: null, announcement: "", footerText: "Plataforma de revendedores" });
  }
  applyLook(S.settings);
  document.title = S.settings.storeName;
  $("#storeName").textContent = S.settings.storeName;
  footer();
}

async function loadResellerShop() {
  const sh = await api("GET", `/api/shops/${SLUG}`);
  S.me = { loggedIn: false };
  S.catalog = sh.products;
  S.settings = { ...sh, storeName: sh.title, logoUrl: sh.hasLogo ? `/api/shops/${SLUG}/logo?v=${Date.now() % 1e6}` : null, bannerUrl: sh.hasBanner ? `/api/shops/${SLUG}/banner?v=${Date.now() % 1e6}` : null };
  setCurrency(sh.currencySymbol);
  if (!sh.published) S.settings.announcement = "👀 Vista previa: tu página está apagada. Solo vos la ves. Publicala desde Mis clientes → Mi página.";
  S.cart = S.cart.filter((l) => product(l.productId));
  applyLook(S.settings);
  document.title = sh.title;
  $("#storeName").textContent = sh.title;
  footer();
}

/** "bolivianos" si la tienda usa Bs; si no, el símbolo configurado (ej.: "US$"). */
const preciosEn = () => { const c = (S.settings?.currencySymbol || "Bs").trim(); return c === "Bs" ? "bolivianos" : c; };
function footer() {
  const st = S.settings;
  $("#footName").textContent = `© ${st.storeName} · ${st.footerText || `Precios en ${preciosEn()}`}`;
  const links = [
    st.whatsapp && [waLink(st.whatsapp, "Hola, tengo una consulta"), "WhatsApp"],
    st.instagram && [`https://instagram.com/${encodeURIComponent(st.instagram)}`, "Instagram"],
    st.tiktok && [`https://www.tiktok.com/@${encodeURIComponent(st.tiktok)}`, "TikTok"],
    st.facebook && [`https://facebook.com/${encodeURIComponent(st.facebook)}`, "Facebook"],
  ].filter(Boolean);
  $("#footWa").innerHTML = links.map(([h, t]) => `<a href="${esc(h)}" target="_blank" rel="noopener">${t}</a>`).join(" · ")
    + (MODE === "store" ? ` · <a href="/">¿Sos revendedor? Entrá a ${esc(st.platformName || "GaboHub")}</a>` : MODE === "hub" ? ` · <a href="/tienda/">Tienda ${esc(S.storeName || "")}</a>` : "")
    + (MODE === "rshop" ? "" : ` · <a href="/terminos">Términos</a> · <a href="/privacidad">Privacidad</a>`)
    + ` · <a href="/terminos#software">© ${new Date().getFullYear()} GaboHub · software protegido</a>`;
  softwareNotice();
}

/** Mezcla dos colores #RRGGBB (t = proporción del segundo). */
function mix(a, b, t) {
  const p = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return "#" + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, "0")).join("");
}
/** Aplica los colores, el logo, los textos y el aviso que eligió la tienda. */
const FONTS = Object.fromEntries(FONT_LIST.filter(([, n]) => n).map(([id, n]) => [id, n]));
const fontStack = (id) => (FONTS[id] ? `'${FONTS[id]}',system-ui,sans-serif` : "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif");
function loadFont(id) {
  if (!FONTS[id] || document.getElementById("gs-font-" + id)) return;
  document.head.append(Object.assign(document.createElement("link"), { rel: "stylesheet", id: "gs-font-" + id, href: `https://fonts.googleapis.com/css2?family=${FONTS[id].replace(/ /g, "+")}:wght@400;500;600;700;800;900&display=swap` }));
}
/** Luminancia relativa (0 = negro, 1 = blanco). */
function lum(h) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16) / 255).map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function applyLook(st) {
  const r = document.documentElement.style;
  const bg = st.backgroundColor || "#090e1d", ac = st.accentColor || "#3984ff";
  const light = lum(bg) > 0.45;
  r.setProperty("--s-bg", bg);
  if (light) {
    // Fondo claro: tarjetas blancas y textos oscuros, para que siempre se lea bien.
    r.setProperty("--s-card", mix(bg, "#ffffff", 0.75));
    r.setProperty("--s-card2", mix(bg, "#000000", 0.045));
    r.setProperty("--s-hover", mix(bg, "#000000", 0.07));
    r.setProperty("--s-line", mix(bg, "#000000", 0.13));
    r.setProperty("--s-ink", "#111827");
    r.setProperty("--s-muted", "#4b5567");
    r.setProperty("--s-ok", "#097a54"); r.setProperty("--s-warn", "#8f5200"); r.setProperty("--s-bad", "#b3163f");
    r.setProperty("--s-sky", /^#[0-9a-f]{6}$/i.test(st.accent2Color || "") ? st.accent2Color : mix(ac, "#000000", 0.18));
    r.setProperty("--s-chip", mix(ac, "#000000", 0.35));
  } else {
    r.setProperty("--s-card", mix(bg, "#ffffff", 0.05));
    r.setProperty("--s-card2", mix(bg, "#ffffff", 0.09));
    r.setProperty("--s-hover", mix(bg, "#ffffff", 0.12));
    r.setProperty("--s-line", mix(bg, "#ffffff", 0.17));
    for (const k of ["--s-ink", "--s-muted", "--s-ok", "--s-warn", "--s-bad"]) r.removeProperty(k);
    r.setProperty("--s-sky", /^#[0-9a-f]{6}$/i.test(st.accent2Color || "") ? st.accent2Color : mix(ac, "#ffffff", 0.35));
    r.setProperty("--s-chip", mix(ac, "#ffffff", 0.6));
  }
  r.setProperty("--s-blue", ac);
  // Contraste garantizado (WCAG 4,5:1) para cualquier color que elijan:
  // texto del botón (blanco o casi negro según se lea mejor sobre las dos puntas del degradado),
  // degradado del botón ajustado si hiciera falta, y el color principal usado como texto (precios, links).
  const lc = lookColors({ accentColor: ac, accent2Color: st.accent2Color, backgroundColor: bg });
  r.setProperty("--s-on-blue", lc.on);
  r.setProperty("--s-btn-a", lc.btnA);
  r.setProperty("--s-btn-b", lc.btnB);
  r.setProperty("--s-blue-text", lc.text);
  document.documentElement.style.colorScheme = light ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  const body = st.fontFamily || "inter", head = st.headingFont || body;
  loadFont(body); loadFont(head);
  r.setProperty("--f-shop", fontStack(body));
  r.setProperty("--f-head", fontStack(head));
  const shop = document.getElementById("shop");
  if (shop) Object.assign(shop.dataset, { corners: st.corners || "round", bg: st.bgStyle || "glow", card: st.cardStyle || "solid", layout: st.layout || "clasico", light: light ? "1" : "" });
  const mark = $("#logoMark");
  mark.outerHTML = st.logoUrl ? `<img id="logoMark" src="${esc(st.logoUrl)}" alt="">` : `<i id="logoMark">${esc((st.storeName || "G")[0])}</i>`;
  const ann = $("#announce");
  ann.textContent = st.announcement || "";
  ann.hidden = !st.announcement;
}

async function loadPrivate() {
  if ((S.view === "revendedores" || S.view === "tiendas" || (MODE === "hub" && S.view === "inicio" && !isReseller())) && !SLUG) S.data.program = await api("GET", "/api/resellers/program");
  if (!S.me?.loggedIn) return;
  const [services, orders] = await Promise.all([api("GET", "/api/me/services"), api("GET", "/api/me/orders")]);
  S.data.services = services;
  S.data.orders = orders;
  if (S.view === "codigos") {
    S.data.codes = await api("GET", "/api/me/codes");
    if (isReseller()) S.data.codeLink = await api("GET", "/api/me/code-link").catch(() => ({ url: null }));
  }
  if (S.view === "recargas") S.data.ledger = await api("GET", "/api/me/ledger");
  if (S.view === "inicio" && hubPanel()) [S.data.shop, S.data.prices, S.data.referrals] = await Promise.all([api("GET", "/api/me/shop"), api("GET", "/api/me/prices"), api("GET", "/api/me/referrals").catch(() => null)]);
  if (S.view === "clientes" && isReseller()) [S.data.customers, S.data.prices, S.data.shop] = await Promise.all([api("GET", "/api/me/customers"), api("GET", "/api/me/prices"), api("GET", "/api/me/shop")]);
}

async function refresh() {
  try {
    await loadBase();
    await loadPrivate();
  } catch (e) {
    $("#sout").innerHTML = `<div class="err">No pudimos cargar la tienda: ${esc(e.message)}. Revisá tu conexión y recargá.</div>`;
    return;
  }
  render();
}

/* ---------------- vistas ---------------- */
/** Logo del producto (si tiene) o su inicial. */
const mark = (p) => (p.hasImage ? `<img class="plogo${p.kind === "combo" ? " wide" : ""}" src="/api/products/${encodeURIComponent(p.id)}/image" alt="${esc(p.name)}" loading="lazy">` : `<span class="lt" style="background:${esc(p.color)}">${esc(p.name[0])}</span>`);
const miniMark = (p) => (p?.hasImage ? `<span class="mini mimg"><img src="/api/products/${encodeURIComponent(p.id)}/image" alt=""></span>` : `<span class="mini" style="background:${esc(p?.color ?? "#3984ff")}">${esc((p?.name ?? "?")[0])}</span>`);
/** Sin stock: se pide por WhatsApp (a la tienda o al revendedor). */
const askWa = (p) => (S.settings?.whatsapp ? waLink(S.settings.whatsapp, `Hola, quiero ${p.name} (${bs(p.price)}). ¿Tienen disponible?`) : null);

/** Productos para revendedores: se pueden comprar sin stock pagando con QR (se entregan al aprobar). */
const onDemand = (p) => !!p?.resellersOnly && isReseller();
const maxQty = (p) => (onDemand(p) ? 10 : p.available);
/** En el carrito hay algo sin stock (a pedido): solo se paga con QR. */
const cartBackorder = () => S.cart.some((l) => onDemand(product(l.productId)) && l.qty > product(l.productId).available);
/* Reseñas de clientes con estrellas (confianza en la portada). */
function reviewsSection() {
  const ts = (S.settings.testimonials ?? []).filter((t) => t && t.name && t.text);
  if (!ts.length) return "";
  const rated = ts.filter((t) => t.rating);
  const avg = rated.length ? rated.reduce((a, t) => a + t.rating, 0) / rated.length : 0;
  const head = avg
    ? `<div class="sec-h"><div><span class="chip">★ ${avg.toFixed(1)} de 5</span><h2>Lo que dicen nuestros clientes</h2><p>${rated.length} opinion${rated.length === 1 ? "" : "es"} de gente que ya compró.</p></div></div>`
    : `<div class="sec-h"><div><span class="chip">Opiniones</span><h2>Lo que dicen nuestros clientes</h2></div></div>`;
  return `<section style="display:grid;gap:18px">${head}
    <div class="ptesti">${ts.map((t) => `<figure><blockquote>“${esc(t.text)}”</blockquote>${t.rating ? `<span class="pstars" aria-label="${t.rating} de 5 estrellas">${"★".repeat(t.rating)}${"☆".repeat(5 - t.rating)}</span>` : ""}<figcaption><i>${esc(t.name[0] || "?")}</i><span><b>${esc(t.name)}</b>${t.business ? `<small>${esc(t.business)}</small>` : ""}</span></figcaption></figure>`).join("")}</div></section>`;
}
/* Franja de logos de apps que se desliza sola (confianza + vida). */
function brandStrip() {
  const items = (S.catalog ?? []).filter((p) => p.name && p.kind !== "combo");
  if (items.length < 3) return "";
  const chip = (p) => `<span class="bchip" style="--c:${esc(p.color || "#3984ff")}"><i>${esc((p.name[0] || "?").toUpperCase())}</i>${esc(p.name)}</span>`;
  const row = items.map(chip).join("");
  return `<div class="bstrip" aria-hidden="true"><div class="btrack">${row}${row}</div></div>`;
}
/* Banda de confianza: entrega, pago, soporte y contador. */
function trustBand() {
  const n = (S.catalog ?? []).length;
  const it = [
    ["⚡", n ? `${n}+` : "24/7", n ? "servicios al toque" : "siempre abierto"],
    ["💳", "QR", "pago fácil y seguro"],
    ["🕒", "al instante", "entrega inmediata"],
    ["💬", "WhatsApp", "soporte de verdad"],
  ];
  return `<section class="trustband">${it.map(([e, b, s]) => `<div><span class="te">${e}</span><b>${esc(b)}</b><small>${esc(s)}</small></div>`).join("")}</section>`;
}
const hasCombos = () => (S.catalog ?? []).some((p) => p.kind === "combo" && p.comboParts?.length);
/* Franja de atención: horario + WhatsApp, para que se vea que hay alguien real. */
function availBar() {
  const wa = S.settings.whatsapp, hours = (S.settings.storeHours ?? "").trim();
  if (!wa && !hours) return "";
  return `<div class="availbar"><span>🟢 ${hours ? esc(hours) : "Atención todos los días"} · respondemos por WhatsApp</span>${wa ? `<a href="${waLink(wa, "Hola, tengo una consulta 👋")}" target="_blank" rel="noopener">💬 +${esc(String(wa).replace(/\D/g, ""))}</a>` : ""}</div>`;
}
/* Preguntas frecuentes (acordeón): saca dudas antes de comprar. */
const FAQ_DEFAULT = [
  ["¿Qué pasa si la cuenta deja de funcionar?", "La reponemos sin costo dentro de tu período. Escribinos por WhatsApp y te pasamos una nueva al toque."],
  ["¿Cuánto dura mi compra?", "Lo que diga el plan (por ejemplo 30 días). La fecha de vencimiento te queda guardada en Mis cuentas."],
  ["¿Cómo pago?", "Con QR y comprobante, o coordinando por WhatsApp. Te activamos y te avisamos cuando esté listo."],
  ["¿Es seguro comprar acá?", "Sí. Te entregamos tus accesos y te damos soporte por WhatsApp si algo falla."],
  ["¿En cuántos dispositivos puedo usarlo?", "Depende del servicio. Consultanos por WhatsApp y te decimos el detalle de cada plataforma."],
];
function faqSection() {
  const custom = (S.settings.faq ?? []).filter((f) => f && f.q && f.a);
  const list = custom.length ? custom.map((f) => [f.q, f.a]) : FAQ_DEFAULT;
  return `<section class="faq"><div class="sec-h"><div><span class="chip">Ayuda</span><h2>Preguntas frecuentes</h2><p>Lo que más nos preguntan antes de comprar.</p></div></div>
    <div class="faqlist">${list.map(([q, a]) => `<details class="faqi"><summary>${esc(q)}<span class="faqp">+</span></summary><p>${esc(a)}</p></details>`).join("")}</div>
    ${S.settings.whatsapp ? `<div class="faqcta"><div><b>¿Te quedó una duda?</b><span class="empty">Escribinos y te ayudamos a elegir tu plan.</span></div><a class="sbtn pri" href="${waLink(S.settings.whatsapp, "Hola, quiero que me ayuden a elegir un plan 🙌")}" target="_blank" rel="noopener">${icon("wa")}Escribir por WhatsApp</a></div>` : ""}</section>`;
}
/* Asesor: encontrá tu combo ideal por presupuesto y cantidad de plataformas. */
function asesorView() {
  const combos = (S.catalog ?? []).filter((p) => p.kind === "combo" && p.comboParts?.length);
  if (!combos.length) return `<div class="sbox"><h2>🧮 Asesor de combos</h2><p class="empty">Pronto vas a poder encontrar tu combo ideal acá. Mientras, mirá el catálogo o armá tu combo.</p><div class="inline"><button class="sbtn pri" type="button" data-s="catalogo">Ver catálogo ${icon("arrow")}</button>${comboOn() ? `<button class="sbtn" type="button" data-s="combo">Armá tu combo</button>` : ""}</div></div>`;
  const a = (S.data.asesor ??= { budget: 80, plats: 0, like: "" });
  const platOpts = [...new Set(combos.map((c) => c.comboParts.length))].sort((x, y) => x - y);
  // Apps que aparecen en algún combo, para el filtro "¿Qué querés que incluya?"
  const likeApps = [...new Set(combos.flatMap((c) => c.comboParts))].map((id) => product(id)).filter((p) => p).sort((x, y) => x.name.localeCompare(y.name));
  if (a.like && !likeApps.some((p) => p.id === a.like)) a.like = "";
  let list = combos.filter((c) => c.price <= a.budget * 100 && (!a.plats || c.comboParts.length === a.plats) && (!a.like || c.comboParts.includes(a.like)));
  list.sort((x, y) => y.comboParts.length - x.comboParts.length || x.price - y.price);
  const partName = (id) => product(id)?.name ?? id;
  const comboCard = (c, best) => `<div class="acombo${best ? " best" : ""}">${best ? `<span class="abest">★ Mejor opción para vos</span>` : ""}
    <div class="atop"><b>${esc(c.name)}</b><span class="aprice">${bs(c.price)}<small>/ ${c.durationDays} días</small></span></div>
    <div class="alogos">${c.comboParts.slice(0, 6).map((id) => miniMark(product(id) ?? { name: partName(id), color: "#3984ff" })).join("")}</div>
    <p class="empty" style="margin:0">${c.comboParts.length} plataformas: ${esc(c.comboParts.map(partName).join(" + "))}</p>
    <div class="inline"><button class="sbtn pri sm" type="button" data-add="${esc(c.id)}">Agregar al carrito</button>${S.settings.whatsapp ? `<a class="sbtn sm" href="${waLink(S.settings.whatsapp, `Hola, me interesa el ${c.name} (${bs(c.price)})`)}" target="_blank" rel="noopener">${icon("wa")}Consultar</a>` : ""}</div></div>`;
  return `<div class="sec-h"><div><span class="chip">Asesor</span><h2>Encontrá tu combo ideal</h2><p>Decinos tu presupuesto y cuántas plataformas querés. Te mostramos combos reales del catálogo, sin inventar precios.</p></div></div>
    <div class="asesor">
      <aside class="actrl">
        <div class="afield"><label>¿Cuánto querés gastar?</label><div class="abudget"><input type="range" min="20" max="140" step="10" value="${a.budget}" data-abudget><b>Hasta ${bs(a.budget * 100)}</b></div><small class="empty">Mostramos combos dentro de tu presupuesto.</small></div>
        <div class="afield"><label>¿Cuántas plataformas?</label><div class="aplats"><button type="button" class="${a.plats === 0 ? "on" : ""}" data-aplats="0">Cualquiera</button>${platOpts.map((n) => `<button type="button" class="${a.plats === n ? "on" : ""}" data-aplats="${n}">${n}</button>`).join("")}</div></div>
        ${likeApps.length ? `<div class="afield"><label>¿Qué querés que incluya?</label><div class="aplats"><button type="button" class="${a.like === "" ? "on" : ""}" data-alike="">Cualquiera</button>${likeApps.map((p) => `<button type="button" class="${a.like === p.id ? "on" : ""}" data-alike="${esc(p.id)}">${esc(p.name)}</button>`).join("")}</div></div>` : ""}
        ${comboOn() ? `<button class="sbtn" type="button" data-s="combo">¿Preferís armarlo vos? ${icon("arrow")}</button>` : ""}
      </aside>
      <div class="arecs">${list.length ? list.slice(0, 6).map((c, i) => comboCard(c, i === 0)).join("") : `<div class="sbox"><p class="empty" style="margin:0">No hay combos para ese presupuesto. Subí un poco el monto o elegí "Cualquiera" cantidad de plataformas.</p>${comboOn() ? `<button class="sbtn pri" type="button" data-s="combo" style="justify-self:start">Armá el tuyo a medida</button>` : ""}</div>`}</div>
    </div>`;
}
function card(p, badge) {
  const s = p.available;
  const rib = badge ? `<span class="prib">${esc(badge)}</span>` : (s && s <= 2 ? `<span class="prib hot">🔥 Últimas</span>` : "");
  if (onDemand(p) && !s) return `<article class="pc"><div class="pimg" style="--c:${esc(p.color)}"><div class="pbadges"><span class="tag">${esc(p.category)}</span>${rib}</div>${mark(p)}</div>
  <div class="pbody"><span class="k">${esc(kindText(p.kind))} · ${p.durationDays} días</span><h3>${esc(p.name)}</h3><p class="d" style="margin:0">${esc(p.description)}</p>
  <span class="stock" style="color:var(--s-warn)">A pedido · pagás con QR y te la entregamos al confirmar</span>
  <div class="price">${bs(p.price)}<small>/ ${p.durationDays} días · tu precio</small></div>
  <div class="pbtns"><button class="sbtn sm det" type="button" data-det="${esc(p.id)}">Detalles</button><button class="sbtn sm pri" type="button" data-add="${esc(p.id)}">Comprar +</button></div></div></article>`;
  return `<article class="pc"><div class="pimg" style="--c:${esc(p.color)}"><div class="pbadges"><span class="tag">${esc(p.category)}</span>${rib}</div>${mark(p)}</div>
  <div class="pbody"><span class="k">${esc(kindText(p.kind))} · ${p.durationDays} días</span><h3>${esc(p.name)}</h3><p class="d" style="margin:0">${esc(p.description)}</p>
  <span class="stock" style="color:${s ? (s <= 2 ? "var(--s-warn)" : "var(--s-ok)") : askWa(p) ? "var(--s-muted)" : "var(--s-bad)"}">${s ? (s <= 2 ? `Últimas ${s} unidades` : `${s} disponibles`) : askWa(p) ? "Disponible a pedido" : "Agotado"}</span>
  <div class="price">${bs(p.price)}<small>/ ${p.durationDays} días</small>${p.wholesale && p.publicPrice > p.price ? `<small class="pub">público ${bs(p.publicPrice)}</small>` : ""}</div>
  <div class="pbtns"><button class="sbtn sm det" type="button" data-det="${esc(p.id)}">Detalles</button>${s || !askWa(p) ? `<button class="sbtn sm pri" type="button" data-add="${esc(p.id)}" ${s ? "" : "disabled"}>Añadir +</button>` : `<a class="sbtn sm pri" href="${askWa(p)}" target="_blank" rel="noopener">${icon("wa")}Pedir</a>`}</div></div></article>`;
}
const kindText = (k) => ({ profile: "Perfil", full_account: "Cuenta completa", invite: "Invitación", combo: "Combo", iptv: "IPTV" })[k] ?? k;
/** Filas de credenciales IPTV (como <div><dt>..</dt><dd>..</dd></div>). */
function iptvCredRows(ac) {
  const v = ac.iptv, rows = [];
  const row = (k, val) => val ? `<div><dt>${k}</dt><dd>${esc(String(val))}</dd></div>` : "";
  if (v.mode === "m3u") rows.push(row("Enlace M3U", ac.password));
  else if (v.mode === "code") rows.push(row("Código", ac.password));
  else { rows.push(row("Servidor", v.server), row("Usuario", ac.email), row("Contraseña", ac.password)); }
  rows.push(row("MAC", v.mac), row("Dispositivos", v.connections), row("App", v.app));
  return rows.join("");
}
/** Texto IPTV para copiar / WhatsApp. */
function iptvAccessText(a) {
  const v = a.access.iptv, L = [`*${a.product}*`];
  if (v.mode === "m3u") L.push(`Enlace M3U: ${a.access.password}`);
  else if (v.mode === "code") L.push(`Código: ${a.access.password}`);
  else { if (v.server) L.push(`Servidor: ${v.server}`); L.push(`Usuario: ${a.access.email}`, `Contraseña: ${a.access.password}`); }
  if (v.mac) L.push(`MAC: ${v.mac}`);
  if (v.connections) L.push(`Dispositivos: ${v.connections}`);
  if (v.app) L.push(`App: ${v.app}`);
  L.push(`Vence: ${fdate(a.expiresAt)}`);
  return L.join("\n");
}

const notReseller = () => `<div class="sbox"><h2>Esta área es para revendedores</h2><p class="empty">Tus compras y cuentas están en la tienda.</p><a class="sbtn pri" href="/tienda/#cuentas" style="justify-self:start">Ir a la tienda ${icon("arrow")}</a></div>`;
const needLogin = (what) => `<div class="sbox"><h2>Ingresá a tu cuenta</h2><p class="empty">Para ver ${what} entrá con tu número de WhatsApp.</p><button class="sbtn pri" type="button" data-login="1" style="justify-self:start">Acceder</button></div>`;

function pendingOrders() {
  const list = (S.data.orders ?? []).filter((o) => o.status === "awaiting_payment" || o.status === "payment_review");
  return list.map((o) => `<div class="svc"><div class="top"><b>${KIND_TEXT[o.kind]} ${esc(o.id)} · ${bs(o.total)}</b><span class="spill ${o.status === "payment_review" ? "sp-warn" : "sp-mute"}">${STATUS_TEXT[o.status]}</span></div>
    ${o.method === "binance" ? `<span class="empty">Pago con Binance Pay${o.binance?.usdt ? ` · ${esc(String(o.binance.usdt))} USDT` : ""}. Apenas se confirme, tu acceso aparece solo acá.</span>
        <div style="display:flex;gap:8px;flex-wrap:wrap">${o.binance?.link ? `<a class="sbtn pri sm" href="${esc(o.binance.link)}" target="_blank" rel="noopener">Abrir Binance y pagar</a>` : ""}<button class="sbtn sm" type="button" data-cancel="${esc(o.id)}">Cancelar pedido</button></div>`
      : o.status === "payment_review" ? `<span class="empty">Estamos verificando tu pago. Te avisamos por WhatsApp cuando esté listo.</span>`
      : `<span class="empty">Falta enviar el comprobante. Pagá ${bs(o.total)} con el QR y subí la foto.</span>
        <form class="inline-form" data-evidence="${esc(o.id)}">${qrBlock()}<label>Comprobante (foto o PDF)<input type="file" name="file" accept="image/*,application/pdf" required></label>
        <label>Número de operación<input name="ref" required placeholder="Ej.: 123456789"></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sbtn pri sm" type="submit">Enviar comprobante</button><button class="sbtn sm" type="button" data-cancel="${esc(o.id)}">Cancelar pedido</button></div></form>`}</div>`).join("");
}

function qrBlock() {
  const st = S.settings;
  return `<div class="qr">${st.hasQr ? `<img src="/api/settings/qr" alt="QR de cobro de ${esc(st.storeName)}">` : ""}<div style="display:grid;gap:6px">${st.hasQr ? "Escaneá con la app de tu banco y pagá el monto exacto." : "La tienda todavía no cargó su QR de cobro. Escribinos por WhatsApp para pagar."}${st.paymentNote ? `<b style="color:var(--s-ink)">${esc(st.paymentNote)}</b>` : ""}</div></div>`;
}
/** Cobro por país (Yappy, Tigo Money…): a dónde pagar, con su QR si lo tiene. */
function localBlock(m, toPay) {
  return `<div class="qr" style="align-items:flex-start">${m.hasQr ? `<img src="/api/paymethods/${esc(m.id)}/qr" alt="QR de ${esc(m.name)}">` : ""}<div style="display:grid;gap:8px;min-width:0">
    <b style="color:var(--s-ink);font-size:16px">Pagá ${bs(toPay)} por ${esc(m.name)}</b>
    <span class="empty">${m.country ? `${esc(m.country)} · ` : ""}A: <b style="color:var(--s-ink);overflow-wrap:anywhere">${esc(m.account)}</b> <button class="sbtn sm" type="button" data-copy="${esc(m.account)}">Copiar</button></span>
    ${m.holder ? `<span class="empty">A nombre de <b style="color:var(--s-ink)">${esc(m.holder)}</b></span>` : ""}
    ${m.instructions ? `<span class="empty">${esc(m.instructions)}</span>` : ""}
    <span class="empty">Después subí abajo la captura del pago y el número de operación. Te confirmamos y activamos.</span>
  </div></div>`;
}
/** Instrucciones de pago en USDT manual: cuánto mandar, a qué dirección / Pay ID. */
function usdtBlock(toPay) {
  const u = S.settings.usdt;
  if (!u) return "";
  const amt = Math.ceil((toPay / 100) / u.rate * 100) / 100;
  return `<div class="qr" style="align-items:flex-start"><div style="display:grid;gap:8px;min-width:0">
    <b style="color:var(--s-ink);font-size:16px">Enviá ${amt} USDT</b>
    ${u.network ? `<span class="empty">Red: <b style="color:var(--s-ink)">${esc(u.network)}</b></span>` : ""}
    ${u.address ? `<div class="empty">Dirección:<br><code style="word-break:break-all;color:var(--s-ink)">${esc(u.address)}</code><br><button class="sbtn sm" type="button" data-copy="${esc(u.address)}">Copiar dirección</button></div>` : ""}
    ${u.payId ? `<span class="empty">Binance Pay ID: <b style="color:var(--s-ink)">${esc(u.payId)}</b> <button class="sbtn sm" type="button" data-copy="${esc(u.payId)}">Copiar</button></span>` : ""}
    ${u.note ? `<span class="empty">${esc(u.note)}</span>` : ""}
    <span class="empty">Mandá exactamente <b style="color:var(--s-ink)">${amt} USDT</b> y pegá abajo el <b>hash</b> (o número de la transacción) y una captura. Te confirmamos y activamos.</span>
  </div></div>`;
}

const NAV = { inicio: ["home", "Inicio"], catalogo: ["grid", "Catálogo"], combo: ["plus", "Armá tu combo"], asesor: ["grid", "Asesor"], tiendas: ["grid", "Tiendas"], precios: ["cart", "Comprar"], cuentas: ["idcard", "Mis cuentas"],
  clientes: ["user", "Mis clientes"], recargas: ["coins", "Saldo"], codigos: ["mailbox", "Códigos"] };
function buildNav() {
  const top = MODE === "rshop" ? ["inicio", "catalogo", ...(comboOn() ? ["combo"] : []), ...(hasCombos() ? ["asesor"] : [])] : MODE === "store" ? ["inicio", "catalogo", ...(comboOn() ? ["combo"] : []), ...(hasCombos() ? ["asesor"] : []), "cuentas", "codigos", "recargas"]
    : hubPanel() ? ["inicio", "precios", "cuentas", "codigos", "clientes", "recargas"] : ["inicio", "tiendas"];
  const bottom = MODE === "rshop" ? [...(comboOn() ? ["inicio", "catalogo", "combo", "cart"] : ["inicio", "catalogo", "cart"])] : MODE === "store" ? ["inicio", "catalogo", "cart", "cuentas", "recargas"]
    : hubPanel() ? ["inicio", "precios", "cart", "cuentas", "codigos"] : ["inicio", "tiendas", "login"];
  const key = `${MODE}:${top}:${bottom}`;
  if (buildNav.last === key) return;
  buildNav.last = key;
  $(".snav").innerHTML = top.map((v) => `<button type="button" data-s="${v}">${NAV[v][1]}</button>`).join("");
  const bn = $(".bnav");
  bn.innerHTML = bottom.map((v) => v === "cart" ? `<button type="button" data-cart="1"><svg><use href="/icons.svg#i-cart"/></svg>Carrito</button>`
    : v === "login" ? `<button type="button" data-login="1"><svg><use href="/icons.svg#i-user"/></svg>Acceder</button>`
    : `<button type="button" data-s="${v}"><svg><use href="/icons.svg#i-${NAV[v][0]}"/></svg>${NAV[v][1].replace("Mis c", "C")}</button>`).join("");
  bn.style.gridTemplateColumns = `repeat(${bottom.length},1fr)`;
  const acc = $("#accBtn");
  if (acc) acc.hidden = MODE === "rshop";
  const cartBtn = $(".shead [data-cart]");
  if (cartBtn) cartBtn.hidden = MODE === "hub" && !hubPanel();
}

function render() {
  const r = renderInner();
  enhanceFiles(document);
  return r;
}
function renderInner() {
  buildNav();
  $$("#shop button[data-s]").forEach((b) => (b.dataset.s === S.view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  $("#cartN").textContent = S.cart.reduce((s, l) => s + l.qty, 0);
  if (!SLUG) $("#accName").textContent = S.me?.loggedIn ? `${S.me.name.split(" ")[0]} · ${bs(S.me.balance)}` : "Acceder";
  const pub = S.catalog;
  const services = S.data.services ?? [];
  const V = {
    inicio: () => {
      const L = S.settings.layout || "clasico";
      const nFeat = L === "catalogo" ? pub.length : L === "vitrina" ? 6 : 4;
      const featTitle = L === "catalogo" ? "Todo el catálogo" : L === "minimal" ? "Nuestros servicios" : "Servicios populares";
      const showMock = L === "clasico";
      const heroRight = S.settings.bannerUrl ? `<img class="hbanner" src="${esc(S.settings.bannerUrl)}" alt="">`
        : showMock ? (SLUG ? `<div class="mock" aria-hidden="true"><div class="t">${esc(S.settings.storeName)}</div><div class="mgrid">${pub.slice(0, 4).map((p) => `<div>${esc(p.name)}<b>${bs(p.price)}</b>${p.durationDays} días</div>`).join("") || "<div>Pronto<b>✦</b>nuevos productos</div>"}</div></div>` : `<div class="mock" aria-hidden="true"><div class="t">${esc(S.settings.storeName)} · tu resumen</div>
        <div class="mgrid"><div>Catálogo<b>${pub.length}</b>productos</div><div>Mis servicios<b>${S.me?.loggedIn ? services.length : "—"}</b>activos</div><div>Mi saldo<b>${S.me?.loggedIn ? bs(S.me.balance) : "—"}</b>para comprar al instante</div><div>Carrito<b>${S.cart.length}</b>productos</div></div></div>`)
        : "";
      return `${availBar()}<section class="hero"><div style="display:grid;min-width:0">
        ${S.settings.heroChip ? `<span class="chip">${esc(S.settings.heroChip)}</span>` : ""}
        <h1>${esc(S.settings.heroTitle)}<br><span>${esc(S.settings.heroHighlight)}</span></h1>
        <p>${esc(S.settings.heroText)}</p>
        <div class="herobtns" style="display:flex;gap:10px;flex-wrap:wrap"><button class="sbtn pri" type="button" data-s="catalogo">${SLUG ? "Ver precios" : "Explorar productos"} ${icon("arrow")}</button>${SLUG ? (S.settings.whatsapp ? `<a class="sbtn" href="${waLink(S.settings.whatsapp, "Hola, quiero hacer un pedido")}" target="_blank" rel="noopener">${icon("wa")}Escribime por WhatsApp</a>` : "") : `<button class="sbtn" type="button" data-s="cuentas">Consultar mis servicios</button>`}</div>
        <div class="ticks">${(S.settings.heroTicks || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3).map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>
      ${heroRight}</section>
      ${brandStrip()}
      ${trustBand()}
      ${pub.length ? `<section style="display:grid;gap:18px"><div class="sec-h"><div><span class="chip">Catálogo digital</span><h2>${featTitle}</h2></div>${L === "catalogo" ? "" : `<button class="sbtn" type="button" data-s="catalogo">Ver todos ${icon("arrow")}</button>`}</div>
      <div class="pgrid">${pub.slice(0, nFeat).map((p, i) => card(p, i === 0 ? "🔥 Popular" : i === 1 && L !== "minimal" ? "⭐ Top" : "")).join("")}</div></section>` : `<div class="sbox"><h2>Pronto</h2><p class="empty">Estamos cargando los productos. Volvé en un rato.</p></div>`}
      ${hasCombos() ? `<button class="cbanner" type="button" data-s="asesor"><b>🧮 ¿No sabés cuál elegir?</b><span>Usá el Asesor: decís tu presupuesto y te recomendamos el combo ideal.</span>${icon("arrow")}</button>` : ""}
      ${SLUG ? "" : reviewsSection()}
      ${faqSection()}
      ${comboOn() ? `<section class="cteaser"><div><span class="chip">Tu combo, tus reglas</span><h2>Armá tu combo y ahorrá</h2><p class="empty" style="margin:0">Elegí 2 o más servicios: ${S.settings.comboDiscounts.map((v, i) => v ? `${["2", "3", "4 o más"][i]} → −${bs(v)}` : "").filter(Boolean).join(" · ")}.</p></div><button class="sbtn pri" type="button" data-s="combo">Armar mi combo ${icon("arrow")}</button></section>` : ""}
      ${!SLUG && !isReseller() ? `<section class="pteaser"><div><span class="chip">Programa de revendedores</span><h2>¿Querés tener tu propia tienda de streaming?</h2><p class="empty" style="margin:0">Precios de mayorista, tu página con tu logo y tus colores, y un panel para tus clientes.</p></div><a class="sbtn pri" href="/">Conocé ${esc(S.settings.platformName || "GaboHub")} ${icon("arrow")}</a></section>` : ""}
      ${L === "minimal" ? "" : `<section class="sbox" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px">
        ${(SLUG ? [["1", "Elegí", "Agregá al carrito lo que te gusta."], ["2", "Pedí", "Mandame tu pedido por WhatsApp con un toque."], ["3", "Disfrutá", "Te paso tus accesos al toque."]]
          : [["1", "Elegí", "Agregá al carrito lo que necesitás."], ["2", "Pagá", "Con QR y comprobante, o al instante con tu saldo."], ["3", "Recibí", "Tus accesos aparecen en Mis cuentas y te avisamos por WhatsApp."]])
          .map(([k, t, d]) => `<div style="display:grid;gap:4px"><span class="chip">Paso ${k}</span><b style="font-size:18px">${t}</b><span class="empty">${d}</span></div>`).join("")}</section>`}`;
    },
    catalogo: () => {
      const cats = ["Todos", ...new Set(pub.map((p) => p.category))];
      const list = pub.filter((p) => (S.cat === "Todos" || p.category === S.cat) && `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(S.q));
      return `<div class="sec-h"><div><span class="chip">Nuestros productos</span><h2>Catálogo</h2><p>Suscripciones, combos y herramientas. Todos los precios en ${preciosEn()}${isReseller() ? " (precio de revendedor)" : ""}.</p></div></div>
      <div class="search"><input id="q" placeholder="Buscar por producto, combo o servicio" value="${esc(S.q)}" aria-label="Buscar"><button class="sbtn" type="button" data-cart="1">${icon("cart")}Mi carrito (${S.cart.length})</button></div>
      <div class="cats">${cats.map((c) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === S.cat}">${esc(c)}</button>`).join("")}</div>
      ${comboOn() ? `<button class="cbanner" type="button" data-s="combo"><b>✦ Armá tu combo</b><span>Combiná 2 o más servicios y ahorrá hasta ${bs(Math.max(...S.settings.comboDiscounts))}</span>${icon("arrow")}</button>` : ""}
      ${list.length ? `<div class="pgrid">${list.map((p) => card(p)).join("")}</div>` : `<p class="empty">No encontramos productos con “${esc(S.q)}”.</p>`}`;
    },
    combo: () => comboView(),
    asesor: () => asesorView(),
    cuentas: () => !S.me?.loggedIn ? needLogin("tus servicios") : MODE === "hub" && !isReseller() ? notReseller() : `<div class="sec-h"><div><span class="chip">Área privada</span><h2>Mis cuentas y pedidos</h2><p>Tus accesos están solo acá: nunca mandamos contraseñas por WhatsApp.</p></div>${isReseller() ? `<button class="sbtn" type="button" data-s="clientes">Mis clientes</button>` : ""}</div>
      ${pendingOrders()}
      ${services.length ? (() => {
        const venc = services.filter((a) => a.daysLeft < 0).length, hoy = services.filter((a) => a.daysLeft === 0).length;
        const semana = services.filter((a) => a.daysLeft >= 1 && a.daysLeft <= 7).length;
        const prod = Object.entries(services.reduce((m, a) => ((m[a.product] = (m[a.product] ?? 0) + 1), m), {}));
        const f = S.data.mf ?? "all";
        const chip = (k, t, n) => `<button type="button" data-mf="${k}" aria-pressed="${f === k}">${t} <b>${n}</b></button>`;
        return `<div class="msum"><div class="msum-k"><div><span>Mis cuentas</span><b>${services.length}</b></div><div class="${hoy + semana ? "w" : ""}"><span>Vencen esta semana</span><b>${hoy + semana}</b></div><div class="${venc ? "b" : ""}"><span>Vencidas</span><b>${venc}</b></div></div>
          ${prod.length > 1 ? `<small class="empty">${prod.map(([n, c]) => `${esc(n.replace(/ \(alquiler revendedores\)/, ""))}: ${c}`).join(" · ")}</small>` : ""}
          <div class="cats">${chip("all", "Todas", services.length)}${chip("week", "Esta semana", hoy + semana)}${chip("bad", "Vencidas", venc)}${chip("ok", "Al día", services.length - venc - hoy - semana)}</div>
          ${services.length > 5 ? `<input id="mq" class="rsearch" placeholder="Buscar por correo, perfil o cliente" value="${esc(S.data.mq ?? "")}" aria-label="Buscar en mis cuentas">` : ""}</div>`;
      })() : ""}
      <div class="sbox"><h2>Servicios activos <span class="spill sp-mute">${services.length}</span></h2>${services.length ? services.filter((a) => {
        const f = S.data.mf ?? "all", q = (S.data.mq ?? "").toLowerCase();
        const okF = f === "all" || (f === "bad" && a.daysLeft < 0) || (f === "week" && a.daysLeft >= 0 && a.daysLeft <= 7) || (f === "ok" && a.daysLeft > 7);
        return okF && (!q || `${a.access.email} ${a.access.profile} ${a.customerName} ${a.product}`.toLowerCase().includes(q));
      }).map((a) => {
        const d = a.daysLeft;
        return `<div class="svc"><div class="top"><div class="who">${miniMark(product(a.productId) ?? { name: a.product })}<div><b>${esc(a.product.replace(/ \(alquiler revendedores\)/, ""))}</b><br><small class="empty">${esc(a.access.profile)}${isReseller() && a.customerName !== S.me.name ? " · " + esc(a.customerName) : ""}</small></div></div>
        <span class="spill ${d < 0 ? "sp-bad" : d <= 3 ? "sp-warn" : "sp-ok"}">${d < 0 ? `Venció hace ${-d} d` : d === 0 ? "Vence hoy" : `Vence en ${d} d`} · ${fdate(a.expiresAt)}</span></div>
        <dl class="cred" style="margin:0">${a.access.iptv ? iptvCredRows(a.access) : `<div><dt>Correo</dt><dd>${esc(a.access.email)}</dd></div><div><dt>Contraseña</dt><dd>${esc(a.access.password)}</dd></div><div><dt>Perfil</dt><dd>${esc(a.access.profile)}</dd></div>${a.access.pin ? `<div><dt>PIN</dt><dd>${esc(a.access.pin)}</dd></div>` : ""}`}</dl>
        ${a.guide && (a.guide.app || a.guide.link || a.guide.steps) ? `<details class="howto"><summary>📲 Cómo verlo</summary><div style="display:grid;gap:4px;padding-top:6px">${a.guide.app ? `<span class="empty">App: <b style="color:var(--s-ink)">${esc(a.guide.app)}</b></span>` : ""}${a.guide.link ? `<a class="sbtn sm" href="${esc(a.guide.link)}" target="_blank" rel="noopener">${icon("ext")}Descargar la app</a>` : ""}${a.guide.steps ? `<span class="empty">${esc(a.guide.steps)}</span>` : ""}</div></details>` : ""}
        <div style="display:flex;gap:8px;flex-wrap:wrap">${a.canRenew === false
          ? (S.settings.whatsapp ? `<a class="sbtn sm pri" href="${waLink(S.settings.whatsapp, `Hola, quiero renovar mi ${a.product.replace(/ \(alquiler revendedores\)/, "")} (${a.access.email} · ${a.access.profile}), vence el ${fdate(a.expiresAt)}.`)}" target="_blank" rel="noopener">${icon("wa")}Renovar por WhatsApp</a>` : `<span class="empty">La renovación la hace la tienda.</span>`)
          : `<button class="sbtn sm pri" type="button" data-renew="${esc(a.assignmentId)}" data-method="balance">${icon("renew")}Renovar con saldo${a.renewPrice ? ` · ${bs(a.renewPrice)}` : ""}</button><button class="sbtn sm" type="button" data-renew="${esc(a.assignmentId)}" data-method="qr">Renovar con QR</button>`}<button class="sbtn sm" type="button" data-s="codigos">Ver códigos</button></div></div>`;
      }).join("") || `<p class="empty">Ninguna cuenta con ese filtro.</p>` : `<p class="empty">Todavía no tenés servicios activos.</p><button class="sbtn" type="button" data-s="catalogo" style="justify-self:start">Ir al catálogo</button>`}</div>
      <div class="sbox"><h2>Historial de pedidos</h2>${(S.data.orders ?? []).length ? (S.data.orders).map((o) => `<div class="line"><span>${KIND_TEXT[o.kind]} ${esc(o.id)}<br><small class="empty">${fdate(o.createdAt)}</small></span><span style="text-align:right">${bs(o.total)}<br><small class="empty">${STATUS_TEXT[o.status]}</small></span></div>`).join("") : `<p class="empty">Sin pedidos todavía.</p>`}</div>
      <div class="sbox"><h2>Avisos por WhatsApp</h2><label class="chk"><input type="checkbox" id="consent" ${S.me.whatsappConsent ? "checked" : ""}> Quiero recibir avisos de mis pedidos y vencimientos por WhatsApp.</label></div>
      ${MODE === "store" ? `<div class="sbox"><h2>🔑 Mi contraseña</h2><p class="empty" style="margin:0">Con tu correo y una contraseña entrás cuando quieras, sin pedir código.</p><button class="sbtn" type="button" data-pwd="1" style="justify-self:start">Cambiar / crear contraseña</button></div>` : ""}
      <button class="sbtn" type="button" data-logout="1" style="justify-self:start">Cerrar sesión</button>`,
    codigos: () => !S.me?.loggedIn ? needLogin("tus códigos") : `<div class="sec-h"><div><span class="chip">Verificación</span><h2>Códigos de acceso</h2><p>Si la plataforma te pide un código para entrar, aparece acá. Solo ves los de tus cuentas y duran 30 minutos.</p></div><button class="sbtn" type="button" data-reload="1">${icon("renew")}Actualizar</button></div>
      ${isReseller() ? `<div class="sbox"><h2>🔗 Tu link de códigos</h2><p class="empty" style="margin:0">Un solo link para tus clientes. Elegí la seguridad: <b>sin PIN</b> (escriben el correo de su cuenta) o <b>con PIN de 4 números</b> que vos elegís y les pasás.</p>
        ${S.data.codeLink?.url ? `<div class="linkrow"><code style="overflow-wrap:anywhere">${esc(S.data.codeLink.url)}</code><button class="sbtn sm" type="button" data-copy="${esc(S.data.codeLink.url)}">Copiar</button></div>
          <p class="empty" style="margin:0;font-size:13px">Seguridad actual: <b>${S.data.codeLink.mode === "pin" ? "🔒 Con PIN de 4 números" : "✉️ Escribí tu correo (sin PIN)"}</b></p>
          <div class="rbtns"><a class="sbtn sm pri" href="${waLink("", `Mirá tu código acá 👇 ${S.data.codeLink.mode === "pin" ? "Entrá con el PIN que te pasé:" : "Escribí el correo de tu cuenta:"}\n${S.data.codeLink.url}`)}" target="_blank" rel="noopener">${icon("wa")}Compartir por WhatsApp</a>${S.data.codeLink.mode === "pin" ? `<button class="sbtn sm" type="button" data-makecodelink="1">Quitar PIN (modo correo)</button>` : ""}</div>
          <form class="sform" id="codePin" style="grid-template-columns:1fr auto;display:grid;gap:8px;align-items:end;margin-top:8px"><label>🔒 ${S.data.codeLink.mode === "pin" ? "Cambiar el PIN" : "Proteger con un PIN de 4 números"}<input name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required placeholder="1111"></label><button class="sbtn pri" type="submit">Poner PIN</button></form>`
          : `<button class="sbtn pri" type="button" data-makecodelink="1" style="justify-self:start">Crear mi link de códigos</button>`}</div>` : ""}
      <div class="sbox"><h2>${icon("mailbox")}Bandeja</h2>${(S.data.codes ?? []).length ? S.data.codes.map((c) => `<div class="code"><div style="min-width:0"><span class="ktag k-${esc(c.kind || "otro")}">${KLABEL[c.kind] || "Código"}</span><br><small style="overflow-wrap:anywhere">${esc(c.product || c.to)} · ${new Date(c.receivedAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}</small></div><div style="display:grid;gap:6px;justify-items:end">${c.code ? `<b>${esc(c.code)}</b>` : ""}${c.link ? `<a class="sbtn sm pri" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Abrir enlace</a>` : ""}${c.code ? `<button class="sbtn sm" type="button" data-copy="${esc(c.code.replace(/\D/g, ""))}">Copiar</button>` : ""}</div></div>`).join("") : `<p class="empty">No hay códigos nuevos. Si acabás de pedir uno, tocá Actualizar en unos segundos.</p>`}</div>`,
    recargas: () => !S.me?.loggedIn ? needLogin("tu saldo") : `<div class="sec-h"><div><span class="chip">Saldo</span><h2>Saldo y recargas</h2><p>Recargá saldo y comprá o renová al instante, sin esperar la verificación del pago.</p></div></div>
      <div class="balance"><div><span class="empty">Tu saldo</span><br><b>${bs(S.me.balance)}</b></div><span class="spill sp-mute">${esc(S.me.phone)}</span></div>
      ${pendingOrders()}
      <form class="sbox sform" id="topup"><h2>Solicitar recarga</h2><div class="packs">${[50, 100, 200, 500].map((v, i) => `<label><input type="radio" name="pack" value="${v * 100}" ${i === 1 ? "checked" : ""}><b>Bs ${v}</b><small>de saldo</small></label>`).join("")}</div>
        ${qrBlock()}<label>Comprobante (foto o PDF)<input type="file" name="file" accept="image/*,application/pdf" required></label><label>Número de operación<input name="ref" required placeholder="Ej.: 123456789"></label><button class="sbtn pri" type="submit">Enviar recarga</button></form>
      <div class="sbox"><h2>Movimientos</h2>${(S.data.ledger ?? []).length ? S.data.ledger.slice().reverse().map((m) => `<div class="line"><span>${esc({ topup: "Recarga", purchase: "Compra", renewal: "Renovación", refund: "Devolución", adjustment: "Ajuste", shop_rent: "Alquiler de tu página" }[m.type])} <small class="empty">${esc(m.ref)}</small><br><small class="empty">${fdate(m.at)}</small></span><span style="text-align:right"><b style="color:${m.amount < 0 ? "var(--s-bad)" : "var(--s-ok)"}">${m.amount > 0 ? "+" : "−"}${bs(Math.abs(m.amount))}</b><br><small class="empty">Saldo ${bs(m.balanceAfter)}</small></span></div>`).join("") : `<p class="empty">Sin movimientos.</p>`}</div>`,
    revendedores: () => programView(),
    precios: () => !S.me?.loggedIn ? needLogin("los precios para revendedores") : !isReseller() ? notReseller() : (() => {
      const list = pub.filter((p) => p.resellersOnly || p.wholesale).sort((a, b) => Number(!!b.resellersOnly) - Number(!!a.resellersOnly) || a.name.localeCompare(b.name));
      return `<div class="sec-h"><div><span class="chip">Revendedor</span><h2>Precios para revendedores</h2><p>Comprá con tu saldo y la cuenta se entrega al instante. Tu saldo: <b>${bs(S.me.balance)}</b></p></div><button class="sbtn" type="button" data-s="recargas">${icon("coins")}Recargar saldo</button></div>
        ${list.length ? `<div class="pgrid">${list.map((p) => card(p)).join("")}</div>` : `<div class="sbox"><p class="empty" style="margin:0">Todavía no hay productos para revendedores. Escribinos por WhatsApp.</p></div>`}`;
    })(),
    tiendas: () => directoryView(true),
    clientes: () => !isReseller() ? needLogin("tus clientes") : (() => {
      const canPage = !!S.me?.pageAllowed;
      let tab = S.data.rtab ?? "ventas";
      if (!canPage && tab !== "ventas") tab = "ventas";
      const tabs = canPage ? [["ventas", "Clientes y ventas"], ["pagina", "✦ Mi página"], ["combos", "🎁 Mis combos y descuentos"]] : [["ventas", "Clientes y ventas"]];
      return `<div class="rtabs" role="tablist">${tabs.map(([k, t]) => `<button type="button" role="tab" data-rtab="${k}" aria-selected="${tab === k}">${t}</button>`).join("")}</div>${tab === "pagina" ? shopEditor() : tab === "combos" ? combosEditor() : resellerView()}`;
    })(),
  };
  if (MODE === "hub") V.inicio = hubPanel() ? resellerHome : programView;
  const resNote = MODE === "store" && isReseller() ? `<div class="sbox resnote"><span>Sos revendedor: tus cuentas, precios y clientes están en <b>${esc(S.settings.platformName || "GaboHub")}</b>.</span><a class="sbtn sm pri" href="/#cuentas">Ir a mi panel ${icon("arrow")}</a></div>` : "";
  $("#sout").innerHTML = resNote + V[S.view]();
  if (MODE === "hub" && hubPanel() && S.view === "inicio" && !guideSeen() && !document.getElementById("tour")) setTimeout(() => { if (S.view === "inicio" && !guideSeen()) startTour(); }, 700);
}

/* ---------------- revendedor ---------------- */
const accessText = (a) => a.access.iptv ? iptvAccessText(a) : `*${a.product}*\nCorreo: ${a.access.email}\nContraseña: ${a.access.password}\nPerfil: ${a.access.profile}${a.access.pin ? `\nPIN: ${a.access.pin}` : ""}\nVence: ${fdate(a.expiresAt)}`;
const sellPrice = (productId) => (S.data.prices ?? []).find((x) => x.productId === productId)?.sell ?? null;
const dayPill = (d) => `<span class="spill ${d < 0 ? "sp-bad" : d <= 3 ? "sp-warn" : "sp-ok"}">${d < 0 ? `Venció hace ${-d} d` : d === 0 ? "Vence hoy" : `Vence en ${d} d`}</span>`;

function resellerView() {
  const clients = S.data.customers ?? [];
  const byId = Object.fromEntries(clients.map((c) => [c.id, c]));
  const svc = (S.data.services ?? []).filter((a) => byId[a.customerId]);
  const soon = svc.filter((a) => a.daysLeft <= 7);
  const prices = S.data.prices ?? [];
  const q = (S.data.cq ?? "").toLowerCase();
  const shown = clients.filter((c) => `${c.name} ${c.phone}`.toLowerCase().includes(q)).sort((a, b) => (a.nextExpiry ?? Infinity) - (b.nextExpiry ?? Infinity));
  const remind = (a) => {
    const c = byId[a.customerId];
    const price = sellPrice(a.productId);
    return waLink(c.phone, `Hola ${c.name.split(" ")[0]}, tu ${a.product} ${a.daysLeft < 0 ? "venció" : "vence"} el ${fdate(a.expiresAt)}.${price !== null ? ` La renovación es ${bs(price)}.` : ""} ¿Lo renovamos? 🙌`);
  };
  const svcRow = (a, withClient) => `<div class="svc"><div class="top"><div class="who">${miniMark(product(a.productId) ?? { name: a.product })}<div><b>${esc(a.product)}</b><br><small class="empty">${withClient ? esc(byId[a.customerId].name) + " · " : ""}${esc(a.access.profile)}</small></div></div>${dayPill(a.daysLeft)}</div>
    <div class="rbtns">${a.canRenew === false ? "" : `<button class="sbtn sm pri" type="button" data-renew="${esc(a.assignmentId)}" data-method="balance">${icon("renew")}Renovar con saldo</button>`}
    <a class="sbtn sm" href="${remind(a)}" target="_blank" rel="noopener">${icon("wa")}Avisarle</a>
    <button class="sbtn sm" type="button" data-copy="${esc(accessText(a))}">Copiar datos</button></div></div>`;
  const last = (S.data.lastSale ?? []).map((id) => svc.find((a) => a.assignmentId === id)).filter(Boolean);
  const listText = prices.filter((p) => p.sell !== null).map((p) => `• ${p.name}: ${bs(p.sell)} (${p.durationDays} días)`).join("\n");

  return `<div class="sec-h"><div><span class="chip">Revendedor</span><h2>Mi panel de revendedor</h2><p>Vendé y renová para tus clientes con tu saldo, a precio de revendedor. Todo queda a tu nombre.</p></div><button class="sbtn" type="button" data-s="recargas">${icon("coins")}Recargar saldo</button></div>
    <div class="rkpis"><div><span>Mi saldo</span><b>${bs(S.me.balance)}</b></div><div><span>Clientes</span><b>${clients.length}</b></div><div><span>Servicios activos</span><b>${svc.length}</b></div><div class="${soon.length ? "warn" : ""}"><span>Vencen en 7 días</span><b>${soon.length}</b></div></div>

    ${last.length ? `<div class="sbox rdone"><h2>✅ Venta lista: mandale estos datos a ${esc(byId[last[0].customerId].name)}</h2>${last.map((a) => `<pre class="rpre">${esc(accessText(a))}</pre>`).join("")}
      <div class="rbtns"><button class="sbtn sm pri" type="button" data-copy="${esc(last.map(accessText).join("\n\n"))}">Copiar datos</button><a class="sbtn sm" href="${waLink(byId[last[0].customerId].phone, last.map(accessText).join("\n\n"))}" target="_blank" rel="noopener">${icon("wa")}Mandar por WhatsApp</a><button class="sbtn sm" type="button" data-rclear="1">Listo</button></div></div>` : ""}

    <form class="sbox sform" id="resSell"><h2>Vender a un cliente</h2>
      <label>Cliente<select name="client" required><option value="">Elegí un cliente…</option>${clients.slice().sort((a, b) => a.name.localeCompare(b.name)).map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.phone)}</option>`).join("")}<option value="__new">➕ Cliente nuevo</option></select></label>
      <div class="rnew" hidden><label>Nombre del cliente<input name="nname" maxlength="80"></label><label>WhatsApp del cliente<input name="nphone" inputmode="tel" placeholder="+591 7…"></label></div>
      <label>Producto<select name="product" required><option value="">Elegí un producto…</option>${S.catalog.map((p) => `<option value="${esc(p.id)}" ${p.available ? "" : "disabled"}>${esc(p.name)} · ${bs(p.price)}${p.available ? "" : " · agotado"}</option>`).join("")}</select></label>
      <label>Cantidad<select name="qty">${[1, 2, 3, 4, 5].map((n) => `<option>${n}</option>`).join("")}</select></label>
      <p class="empty" id="sellSum" style="margin:0">Elegí cliente y producto.</p>
      <button class="sbtn pri" type="submit">Comprar con mi saldo</button></form>

    <div class="sbox"><h2>Por vencer <span class="spill ${soon.length ? "sp-warn" : "sp-mute"}">${soon.length}</span></h2>
      ${soon.length ? soon.map((a) => svcRow(a, true)).join("") : `<p class="empty">Ningún cliente vence en los próximos 7 días. 👌</p>`}</div>

    <div class="sbox"><h2>Mis clientes <span class="spill sp-mute">${clients.length}</span></h2>
      ${clients.length > 4 ? `<input id="cq" class="rsearch" placeholder="Buscar por nombre o teléfono" value="${esc(S.data.cq ?? "")}" aria-label="Buscar cliente">` : ""}
      ${shown.map((c) => {
        const mine = svc.filter((a) => a.customerId === c.id);
        const d = c.nextExpiry ? daysLeft(c.nextExpiry) : null;
        return `<details class="rcli"><summary><span><b>${esc(c.name)}</b><br><small class="empty">${esc(c.phone)}${c.note ? " · " + esc(c.note) : ""}</small></span><span class="rsum">${mine.length} serv.${d !== null ? " " + dayPill(d) : ""}</span></summary>
          ${mine.map((a) => svcRow(a, false)).join("") || `<p class="empty">Sin servicios activos.</p>`}
          <form class="sform rform" data-client="${esc(c.id)}"><label>Nombre<input name="name" required maxlength="80" value="${esc(c.name)}"></label><label>WhatsApp<input name="phone" required inputmode="tel" value="${esc(c.phone)}"></label>
            <label style="grid-column:1/-1">Nota (solo la ves vos)<input name="note" maxlength="300" value="${esc(c.note)}" placeholder="Ej.: paga los viernes"></label>
            <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="consent" ${c.whatsappConsent ? "checked" : ""}> Acepta avisos automáticos por WhatsApp</label>
            <div class="rbtns"><button class="sbtn sm" type="submit">Guardar cambios</button><a class="sbtn sm" href="${waLink(c.phone, `Hola ${c.name.split(" ")[0]} 👋`)}" target="_blank" rel="noopener">${icon("wa")}Escribirle</a></div></form>
          <div class="sbox" style="margin-top:8px;padding:12px;gap:8px">
            <b style="font-size:13px">🔑 Link de códigos de ${esc(c.name.split(" ")[0])} <small class="empty">(con su propio PIN)</small></b>
            ${S.data.clientLinks?.[c.id] ? `<div class="linkrow"><code style="overflow-wrap:anywhere">${esc(S.data.clientLinks[c.id].url)}</code><button class="sbtn sm" type="button" data-copy="${esc(S.data.clientLinks[c.id].url)}">Copiar</button></div>
              <a class="sbtn sm pri" href="${waLink(c.phone, `Mirá tus códigos acá 👇 Tu PIN es ${S.data.clientLinks[c.id].pin}\n${S.data.clientLinks[c.id].url}`)}" target="_blank" rel="noopener" style="justify-self:start">${icon("wa")}Enviar link + PIN</a>` : ""}
            <form class="sform" data-clientcode="${esc(c.id)}" style="grid-template-columns:1fr auto;display:grid;gap:8px;align-items:end"><label>PIN de 4 números<input name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required placeholder="1111"></label><button class="sbtn sm pri" type="submit">${S.data.clientLinks?.[c.id] ? "Cambiar PIN" : "Crear link con PIN"}</button></form></div></details>`;
      }).join("") || `<p class="empty">${clients.length ? "Ningún cliente coincide con la búsqueda." : "Todavía no cargaste clientes. Agregalos abajo o al vender."}</p>`}</div>

    <form class="sbox sform" id="myPrices"><h2>Mi lista de precios</h2><p class="empty" style="margin:0">Poné a cuánto le vendés cada producto a tus clientes: te calculamos tu ganancia y te armamos la lista para mandar.</p>
      ${prices.some((p) => p.sell === null) ? `<button class="sbtn pri" type="button" data-sugerir="1" style="justify-self:start">✨ Ponerme precios sugeridos a todo</button>` : ""}
      <div class="rtable">${prices.map((p) => `<div class="rprow"><span><b>${esc(p.name)}</b><br><small class="empty">Te cuesta ${bs(p.cost)} · ${p.durationDays} días</small></span>
        <label class="rprice">Le cobro Bs<input name="p-${esc(p.productId)}" inputmode="decimal" value="${p.sell !== null ? (p.sell / 100).toFixed(2).replace(/\.00$/, "") : ""}" placeholder="—" data-cost="${p.cost}"></label>
        <span class="rprofit" data-profit="${esc(p.productId)}">${p.profit !== null ? `<b style="color:${p.profit < 0 ? "var(--s-bad)" : "var(--s-ok)"}">${p.profit < 0 ? "−" : "+"}${bs(Math.abs(p.profit))}</b>` : ""}</span></div>`).join("")}</div>
      <div class="rbtns"><button class="sbtn pri" type="submit">Guardar precios</button>
      ${listText ? `<button class="sbtn" type="button" data-copy="${esc(`*Lista de precios*\n${listText}`)}">Copiar lista</button><a class="sbtn" href="https://wa.me/?text=${encodeURIComponent(`*Lista de precios*\n${listText}`)}" target="_blank" rel="noopener">${icon("wa")}Compartir</a>` : ""}</div></form>

    <form class="sbox sform" id="newCustomer"><h2>Agregar cliente</h2><label>Nombre<input name="name" required maxlength="80"></label><label>WhatsApp<input name="phone" required inputmode="tel" placeholder="+591 7…"></label><label class="chk"><input type="checkbox" name="consent"> El cliente aceptó recibir avisos por WhatsApp</label><button class="sbtn pri" type="submit">Agregar</button></form>`;
}

/* ---------- Página para atraer revendedores (/revendedores) ---------- */
function phoneMock(t, items) {
  const L = t.look;
  loadFont(L.headingFont);
  const light = lum(L.backgroundColor) > 0.45;
  const ink = light ? "#111827" : "#f5f7ff", muted = light ? "#4b5567" : "#a5aec8";
  return `<div class="ph" style="--pb:${L.backgroundColor};--pa:${L.accentColor};--pa2:${L.accent2Color};--pi:${ink};--pm:${muted};--pf:${fontStack(L.headingFont)}">
    <div class="ph-top"><i>${esc(t.name[0])}</i><b>Tu tienda</b></div>
    <div class="ph-hero"><small>✦ Entrega inmediata</small><strong>Tus plataformas,<br><span>al mejor precio.</span></strong></div>
    ${items.map((p) => `<div class="ph-row"><span>${esc(p.name)}</span><b>${bs(p.price)}</b></div>`).join("")}
    <div class="ph-btn">Pedir por WhatsApp</div><em>${esc(t.name)}</em></div>`;
}

/** Ventana de navegador de mentira (para mostrar el sistema por dentro). */
const browser = (url, inner, cls = "") => `<div class="bw ${cls}" aria-hidden="true"><div class="bw-bar"><i></i><i></i><i></i><span>${esc(url)}</span></div><div class="bw-body">${inner}</div></div>`;
const spark = (pts, color) => { const max = Math.max(...pts), w = 180, h = 46; return `<svg viewBox="0 0 ${w} ${h}" class="spark" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - 4 - (v / max) * (h - 10)}`).join(" ")}"/></svg>`; };
const checks = (list) => `<ul class="pchk">${list.map((x) => `<li>${x}</li>`).join("")}</ul>`;

function directoryView(standalone) {
  const pg = S.data.program;
  if (!pg) return `<p class="skeleton">Cargando…</p>`;
  const q = (S.data.dq ?? "").toLowerCase().trim();
  const all = pg.shops.filter((x) => !q || `${x.title} ${x.tagline} ${x.tags.join(" ")}`.toLowerCase().includes(q));
  const list = standalone ? all : all.slice(0, 4);
  const featured = standalone && !q ? pg.shops.filter((x) => x.featured) : [];
  const vars = (x) => `--pb:${esc(x.backgroundColor || "#0b0b14")};--pa:${esc(x.accentColor || "#7c5cff")};--pa2:${esc(x.accent2Color || x.accentColor || "#00d4ff")};--pf:${fontStack(x.headingFont)}`;
  const head = standalone
    ? `<section class="dhero"><span class="pill"><i></i>Directorio de tiendas</span><h1>Explorá las tiendas de <span>nuestros revendedores</span></h1><p>Cada una con su marca, sus precios y atención directa por WhatsApp.</p>`
    : `<section class="psec"><div class="peyebrow">Ya están vendiendo</div><div class="psplit"><h2>Explorá las tiendas de nuestros revendedores</h2><p>Cada revendedor arma la suya en minutos. Así se ven:</p></div>`;
  return `${head}${pg.shops.length > 3 || standalone ? `<label class="dsearch"><input id="dq" placeholder="Buscar tienda por nombre o categoría…" value="${esc(S.data.dq ?? "")}" aria-label="Buscar tienda">${icon("arrow")}</label>` : ""}</section>
    ${featured.length ? `<section class="psec"><div class="peyebrow">Selección especial</div><h2 class="ph2">Tiendas destacadas</h2>
      <div class="dfeat">${featured.map((x) => { loadFont(x.headingFont); return `<a class="dfc" href="/r/${esc(x.slug)}" style="${vars(x)}"><span class="dban">${x.hasBanner ? `<img src="/api/shops/${esc(x.slug)}/banner" alt="Portada de ${esc(x.title)}" loading="lazy">` : `<b>${esc(x.title)}</b>`}</span>
        <span class="dfi"><span class="dlogo">${x.hasLogo ? `<img src="/api/shops/${esc(x.slug)}/logo" alt="">` : `<i>${esc(x.title[0])}</i>`}</span><span><b>${esc(x.title)}</b>${x.tagline ? `<small>${esc(x.tagline)}</small>` : ""}</span><em>★ Destacada</em></span></a>`; }).join("")}</div></section>
      <div class="psec"><div class="peyebrow">Directorio completo</div><h2 class="ph2">Todas las tiendas</h2></div>` : ""}
    <section class="dlist">${list.map((x) => {
      loadFont(x.headingFont);
      return `<a class="drow" href="/r/${esc(x.slug)}" style="${vars(x)}">
        <span class="dlogo">${x.hasLogo ? `<img src="/api/shops/${esc(x.slug)}/logo" alt="">` : `<i>${esc(x.title[0])}</i>`}</span>
        <span class="dban">${x.hasBanner ? `<img src="/api/shops/${esc(x.slug)}/banner" alt="Portada de ${esc(x.title)}" loading="lazy">` : `<b>${esc(x.title)}</b>`}</span>
        <span class="dinfo"><b>${esc(x.title)}</b>${x.tagline ? `<small>${esc(x.tagline)}</small>` : ""}<span class="dtags">${x.tags.map((t) => `<em>${esc(t)}</em>`).join("")}</span><span class="dgo">Visitar tienda →</span></span></a>`;
    }).join("") || `<p class="empty" style="text-align:center">${pg.shops.length ? "Ninguna tienda coincide con la búsqueda." : "Pronto vas a ver acá las tiendas de nuestros revendedores."}</p>`}
    ${!standalone && all.length > list.length ? `<a class="pghost" href="/tiendas" data-s="tiendas" style="justify-self:center">Ver las ${all.length} tiendas →</a>` : ""}</section>`;
}

/* ---------------- Referí y ganá: trae otros revendedores y ganá saldo ---------------- */
function referralCard(r) {
  if (!r) return "";
  const link = `${location.origin}/?ref=${encodeURIComponent(r.code)}`;
  const premio = r.enabled ? `Ganás <b>${bs(r.bonus)}</b> de saldo por cada revendedor que traigas y la tienda apruebe.` : "Compartí tu link: cuando la tienda active el premio, ganás saldo por cada revendedor que traigas.";
  const list = r.people?.length ? `<div class="reflist">${r.people.slice(0, 8).map((p) => `<div class="refrow"><b>${esc(p.name)}</b><small>${fdate(p.at)}</small></div>`).join("")}</div>` : `<p class="empty" style="margin:0">Todavía no trajiste a nadie. Mandá tu link por WhatsApp a quien quiera revender. 😉</p>`;
  const waMsg = encodeURIComponent(`¡Volvete revendedor conmigo! Registrate acá y empezá a vender: ${link}`);
  return `<section class="sbox refbox"><h2>🎁 Referí y ganá</h2>
    <p class="empty" style="margin:0">${premio}</p>
    <div class="reflink"><input id="refLink" value="${esc(link)}" readonly data-selectall="1"><button class="sbtn pri" type="button" data-copy="${esc(link)}">Copiar link</button></div>
    <div class="hrow"><a class="sbtn" href="https://wa.me/?text=${waMsg}" target="_blank" rel="noopener noreferrer">Compartir por WhatsApp</a></div>
    <div class="refstat"><div><b>${r.count}</b><small>referidos</small></div><div><b>${bs(r.earned)}</b><small>ganado</small></div></div>
    ${list}</section>`;
}

/* ---------------- Inicio del revendedor (botones grandes) ---------------- */
function resellerHome() {
  if (S.data.wiz) return wizardView();
  const sh = S.data.shop, sv = S.data.services ?? [], me = S.me;
  const venc = sv.filter((a) => a.daysLeft < 0).length, week = sv.filter((a) => a.daysLeft >= 0 && a.daysLeft <= 7).length;
  const pend = (S.data.orders ?? []).filter((o) => o.status === "awaiting_payment" || o.status === "payment_review").length;
  const rent = sh?.rent;
  const canPage = !!me.pageAllowed;
  const tiles = [
    ["precios", "🛒", "Comprar", "Cuentas al instante"],
    ["cuentas", "📺", "Mis cuentas", sv.length ? `${sv.length} activas` : "Tus accesos"],
    ["codigos", "🔑", "Códigos", "Disney y más"],
    ...(canPage ? [["pagina", "🏪", "Mi página", sh?.enabled ? "Publicada" : "Armala en 3 pasos"]] : []),
    ["recargas", "💰", "Recargar saldo", bs(me.balance)],
    ["clientes", "👥", "Mis clientes", "Ventas y vencimientos"],
  ];
  let rentBox = "";
  if (rent?.enabled && sh?.saved) {
    const left = rent.paidUntil ? Math.ceil((rent.paidUntil - Date.now()) / 86_400_000) : null;
    const freeTxt = rent.freeIfSpent ? `Gratis si este mes comprás ${bs(rent.freeIfSpent)} (llevás ${bs(rent.spent30)}).` : "";
    if (rent.suspended) rentBox = `<div class="hbox bad"><b>⚠️ Tu página está apagada por falta de pago</b><span>El alquiler es ${bs(rent.price)} por mes. Recargá saldo y tocá Pagar: se prende al instante.</span><div class="hrow"><button class="sbtn pri" type="button" data-rentpay="1">Pagar ${bs(rent.price)}</button><button class="sbtn" type="button" data-s="recargas">Recargar saldo</button></div></div>`;
    else if (left !== null && left <= 5) rentBox = `<div class="hbox warn"><b>🗓️ Tu página vence ${left <= 0 ? "hoy" : `en ${left} día(s)`}</b><span>Se cobra sola de tu saldo (${bs(rent.price)}). ${me.balance < rent.price ? "Te falta saldo: recargá para que no se apague." : "Ya tenés saldo suficiente ✓"} ${freeTxt}</span>${me.balance < rent.price ? `<div class="hrow"><button class="sbtn pri" type="button" data-s="recargas">Recargar saldo</button></div>` : ""}</div>`;
    else if (rent.paidUntil) rentBox = `<p class="empty" style="margin:0;font-size:13px">Tu página está pagada hasta el ${fdate(rent.paidUntil)}. ${freeTxt}</p>`;
  }
  const rpasos = canPage && sh ? [
    ["Poné tus precios", (S.data.prices ?? []).some((p) => p.sell !== null), "clientes", "Poner precios"],
    ["Publicá tu página", !!sh.enabled, sh.saved ? "gopage" : "wiz", sh.saved ? "Publicar" : "Armala"],
  ] : [];
  const rhechos = rpasos.filter((p) => p[1]).length;
  const setupR = rpasos.length && rhechos < rpasos.length ? `<section class="sbox setupr"><b>🚀 Primeros pasos · ${rhechos} de ${rpasos.length}</b>
    <div class="pgbar"><i style="width:${Math.round(rhechos / rpasos.length * 100)}%"></i></div>
    <div class="pasos">${rpasos.map(([t, done, go, b], n) => `<div class="paso ${done ? "done" : ""}"><span class="pnum">${done ? "✓" : n + 1}</span><b>${esc(t)}</b>${done ? `<span class="pdone">Listo ✓</span>` : `<button class="sbtn sm pri" type="button" ${go === "gopage" ? `data-gopage="1"` : go === "wiz" ? `data-wiz="1"` : `data-s="${go}"`}>${esc(b)}</button>`}</div>`).join("")}</div></section>` : "";
  return `<section class="hhead"><div><span class="chip">Hola, ${esc(me.name.split(" ")[0])} 👋</span><h2>¿Qué querés hacer hoy?</h2></div><div class="hhead-r"><button class="sbtn sm" type="button" data-tour="1">📖 Guía</button><div class="hbal"><span>Tu saldo</span><b>${bs(me.balance)}</b></div></div></section>
    ${setupR}
    ${venc || week || pend ? `<div class="hbox warn">${venc ? `<b>🔴 ${venc} cuenta(s) vencida(s)</b>` : ""}${week ? `<b>🟡 ${week} vence(n) esta semana</b>` : ""}${pend ? `<b>⏳ ${pend} pedido(s) esperando pago o revisión</b>` : ""}<div class="hrow"><button class="sbtn" type="button" data-s="cuentas">Ver mis cuentas</button></div></div>` : ""}
    ${canPage && sh && !sh.saved ? `<button class="hwiz" type="button" data-wiz="1"><span>✨</span><div><b>Armá tu página en 3 pasos</b><small>Nombre, qué vendés y listo. Te toma 2 minutos.</small></div>${icon("arrow")}</button>` : ""}
    ${rentBox}
    <div class="htiles">${tiles.map(([v, e, t, d]) => `<button type="button" class="htile" ${v === "pagina" ? (sh?.saved ? `data-gopage="1"` : `data-wiz="1"`) : `data-s="${v}"`}><span>${e}</span><b>${t}</b><small>${esc(d)}</small></button>`).join("")}</div>
    ${referralCard(S.data.referrals)}
    <div class="sbox"><h2>🔐 Tu acceso</h2><p class="empty" style="margin:0">Entrás con tu número y tu PIN de 4 números${me.email ? `, o con tu correo <b>${esc(me.email)}</b> y tu contraseña` : ""}.</p>
      <form class="sform" id="myPin" style="display:grid;grid-template-columns:1fr 1fr auto;gap:8px;align-items:end"><label>PIN actual<input name="current" inputmode="numeric" maxlength="4" placeholder="••••"></label><label>PIN nuevo<input name="pin" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" required placeholder="0000"></label><button class="sbtn" type="submit">Cambiar PIN</button></form>
      <button class="sbtn" type="button" data-pwd="1" style="justify-self:start">📧 ${me.email ? "Cambiar mi correo o contraseña" : "Entrar con correo y contraseña"}</button></div>`;
}

/* ---------------- Asistente: tu página en 3 pasos ---------------- */
const roundBs = (c) => Math.max(100, Math.round(c / 100) * 100);
function wizardView() {
  const w = S.data.wiz, sh = S.data.shop, m = sh?.marginPct ?? 30;
  const steps = `<div class="wsteps">${["Tu tienda", "Qué vendés", "¡Listo!"].map((t, i) => `<span class="${w.step > i ? "on" : ""}">${i + 1} · ${t}</span>`).join("")}</div>`;
  if (w.step === 1) return `${steps}<form class="sbox sform wiz" id="wiz1"><h2>¿Cómo se llama tu tienda?</h2>
      <label>Nombre de tu tienda<input name="title" required maxlength="40" value="${esc(w.title ?? sh.title)}" placeholder="Ej.: Ari Streaming"></label>
      <label>Tu WhatsApp (ahí te llegan los pedidos)<input name="whatsapp" required inputmode="tel" value="${esc(w.whatsapp ?? sh.whatsapp)}"></label>
      <label>Tu logo (opcional)<input type="file" name="logo" accept="image/png,image/jpeg,image/webp"></label>
      <div class="hrow"><button class="sbtn" type="button" data-wizexit="1">Ahora no</button><button class="sbtn pri" type="submit">Siguiente ${icon("arrow")}</button></div></form>`;
  if (w.step === 2) {
    const list = (S.data.prices ?? []).slice().sort((a, b) => a.name.localeCompare(b.name));
    w.picks ??= Object.fromEntries(list.map((p) => [p.productId, { on: p.sell !== null || list.length <= 12, sell: p.sell ?? roundBs(p.cost * (1 + m / 100)) }]));
    const on = Object.values(w.picks).filter((x) => x.on).length;
    return `${steps}<form class="sbox sform wiz" id="wiz2"><h2>¿Qué vas a vender?</h2>
      <p class="empty" style="margin:0">Marcá lo que querés mostrar. Ya te pusimos un precio de venta sugerido (tu costo + ${m}%): cambialo si querés.</p>
      <div class="hrow"><button class="sbtn sm" type="button" data-wizall="1">Marcar todo</button><button class="sbtn sm" type="button" data-wizall="0">Desmarcar todo</button><span class="empty" style="font-size:13px">${on} elegido(s)</span></div>
      <div class="wlist">${list.map((p) => { const k = w.picks[p.productId]; return `<label class="witem ${k.on ? "on" : ""}"><input type="checkbox" data-wpick="${esc(p.productId)}" ${k.on ? "checked" : ""}><span><b>${esc(p.name)}</b><small>Te cuesta ${bs(p.cost)} · ganás ${bs(Math.max(0, k.sell - p.cost))}</small></span><span class="wprice">Bs <input inputmode="decimal" data-wsell="${esc(p.productId)}" value="${k.sell / 100}"></span></label>`; }).join("")}</div>
      <div class="hrow"><button class="sbtn" type="button" data-wizback="1">Atrás</button><button class="sbtn pri" type="submit" ${on ? "" : "disabled"}>Publicar mi página ${icon("arrow")}</button></div></form>`;
  }
  const url = shopUrl(sh.slug), txt = `¡Mirá mi tienda! 🛍️ ${url}`;
  return `${steps}<div class="sbox wiz done"><div class="wbig">🎉</div><h2>¡Tu página está lista!</h2><p class="empty" style="margin:0">Compartila con tus clientes: te piden directo a tu WhatsApp.</p>
    <div class="linkrow"><code>${esc(url)}</code><button class="sbtn sm" type="button" data-copy="${esc(url)}">Copiar</button></div>
    <div class="hrow"><a class="sbtn pri" href="https://wa.me/?text=${encodeURIComponent(txt)}" target="_blank" rel="noopener">${icon("wa")}Compartir por WhatsApp</a><a class="sbtn" href="https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}" target="_blank" rel="noopener">Facebook</a><a class="sbtn" href="/r/${esc(sh.slug)}" target="_blank" rel="noopener">Ver mi página</a></div>
    <p class="empty" style="margin:0;font-size:13px">¿Querés cambiar colores, fondo o letras? Entrá a <b>Mi página</b> → Avanzado.</p>
    <button class="sbtn" type="button" data-wizexit="1">Volver al inicio</button></div>`;
}

/* ---------------- Tour guiado (spotlight, estilo juego) ---------------- */
let tourSteps = [], tourIdx = 0, tourReposition = null;
function tourStepList() {
  const plat = S.settings.platformName || S.storeName || "la plataforma";
  const steps = [
    [".hhead .chip", `¡Bienvenido a ${plat}! 👋`, "Te muestro en 1 minuto para qué sirve cada botón. Tocá Siguiente."],
    [".hbal", "Tu saldo 💰", "Con tu saldo comprás cuentas. Cuando se te acabe, recargás y listo."],
    ['.htiles [data-s="precios"]', "Comprar 🛒", "Elegí las cuentas que querés y pagá con tu saldo o por QR. Te llegan al instante."],
    ['.htiles [data-s="cuentas"]', "Mis cuentas 📺", "Acá ves todo lo que compraste y cuándo vence cada cosa."],
    ['.htiles [data-s="codigos"]', "Códigos 🔑", "Los códigos de Disney y otras apps te aparecen acá solos."],
  ];
  if (document.querySelector('.htiles [data-gopage], .htiles [data-wiz]'))
    steps.push(['.htiles [data-gopage], .htiles [data-wiz]', "Mi página 🏪", "Tu tienda propia: ponele tu logo, tus colores y tus precios, y publicala para compartir."]);
  steps.push(
    ['.htiles [data-s="recargas"]', "Recargar saldo 💵", "Cuando necesites saldo, pedí una recarga o pagá por QR en el momento."],
    ['.htiles [data-s="clientes"]', "Mis clientes 👥", "Cargá a quién le revendés y mandале los datos por WhatsApp con un toque."],
    ["#myPin", "Tu acceso 🔑", "Entrás con tu número y tu PIN. Acá lo podés cambiar cuando quieras."],
    ['[data-tour]', "¿Listo? 🎉", "Eso es todo. Podés volver a ver esta guía con este botón 📖 cuando quieras."],
  );
  return steps.map(([sel, title, text]) => ({ sel, title, text }));
}
function buildTourDom() {
  let t = document.getElementById("tour");
  if (t) return t;
  t = document.createElement("div");
  t.id = "tour";
  t.innerHTML = `<div class="tour-hole"></div><div class="tour-pop" role="dialog" aria-live="polite">
    <div class="tour-hd"><b class="tour-ttl"></b><button type="button" class="tour-x" aria-label="Cerrar">✕</button></div>
    <p class="tour-tx"></p>
    <div class="tour-ft"><span class="tour-dots"></span><div class="tour-btns"><button type="button" class="sbtn sm tour-prev">Atrás</button><button type="button" class="sbtn sm pri tour-next">Siguiente</button></div></div></div>`;
  document.body.appendChild(t);
  t.querySelector(".tour-x").onclick = () => endTour();
  t.querySelector(".tour-prev").onclick = () => goTour(tourIdx - 1);
  t.querySelector(".tour-next").onclick = () => goTour(tourIdx + 1);
  return t;
}
function startTour() {
  if (!(MODE === "hub" && hubPanel())) return;
  if (S.view !== "inicio") { setView("inicio"); setTimeout(startTour, 400); return; }
  tourSteps = tourStepList();
  if (!tourSteps.length) return;
  buildTourDom();
  tourReposition = () => { const s = tourSteps[tourIdx]; const el = s && document.querySelector(s.sel); if (el) placeTour(el, s); };
  addEventListener("resize", tourReposition);
  addEventListener("scroll", tourReposition, true);
  goTour(0);
}
function goTour(i) {
  if (i < 0) i = 0;
  if (i >= tourSteps.length) return endTour(true);
  tourIdx = i;
  const step = tourSteps[i];
  const el = document.querySelector(step.sel);
  if (!el) return goTour(i + 1);
  el.scrollIntoView({ block: "center", behavior: "smooth" });
  setTimeout(() => placeTour(el, step), 320);
}
function placeTour(el, step) {
  const t = document.getElementById("tour");
  if (!t) return;
  const r = el.getBoundingClientRect(), pad = 8;
  const hole = t.querySelector(".tour-hole");
  hole.style.left = (r.left - pad) + "px";
  hole.style.top = (r.top - pad) + "px";
  hole.style.width = (r.width + pad * 2) + "px";
  hole.style.height = (r.height + pad * 2) + "px";
  t.querySelector(".tour-ttl").textContent = step.title;
  t.querySelector(".tour-tx").textContent = step.text;
  const prev = t.querySelector(".tour-prev"), next = t.querySelector(".tour-next");
  prev.style.visibility = tourIdx === 0 ? "hidden" : "visible";
  next.textContent = tourIdx === tourSteps.length - 1 ? "¡Listo! 🎉" : "Siguiente";
  t.querySelector(".tour-dots").textContent = `${tourIdx + 1} / ${tourSteps.length}`;
  const pop = t.querySelector(".tour-pop");
  pop.style.visibility = "hidden";
  requestAnimationFrame(() => {
    const vh = innerHeight, vw = innerWidth, ph = pop.offsetHeight, pw = pop.offsetWidth, gap = 14;
    let top = r.bottom + gap;
    if (top + ph > vh - 10) top = Math.max(10, r.top - gap - ph);
    if (top + ph > vh - 10) top = Math.max(10, (vh - ph) / 2);
    let left = Math.min(Math.max(10, r.left + r.width / 2 - pw / 2), vw - pw - 10);
    pop.style.top = top + "px";
    pop.style.left = left + "px";
    pop.style.visibility = "visible";
  });
}
function endTour(done) {
  markGuideSeen();
  if (tourReposition) { removeEventListener("resize", tourReposition); removeEventListener("scroll", tourReposition, true); tourReposition = null; }
  const t = document.getElementById("tour");
  if (t) t.remove();
  if (done) toast("¡Listo! Ya conocés tu panel 🎉");
}

function programView() {
  const pg = S.data.program;
  if (!pg) return `<p class="skeleton">Cargando…</p>`;
  const wa = pg.whatsapp ? waLink(pg.whatsapp, "Hola, quiero ser revendedor de " + pg.storeName) : null;
  const want = (cls = "pcta") => `<button class="${cls}" type="button" data-apply="1">Quiero ser revendedor</button>`;
  const sample = (pg.products.length ? pg.products.map((p) => ({ name: p.name, price: Math.round(p.reseller * 1.4 / 100) * 100 })) : S.catalog).slice(0, 3);
  const tiles = S.catalog.slice(0, 6);
  const mocks = ["neon", "rosa", "oro"].map((id) => THEMES.find((t) => t.id === id));
  const ex = sample[0]?.name ?? "Netflix perfil";
  const feats = [
    ["grid", "Tu marca, tus reglas", "Logo, portada, colores, letras y precios propios. Tus clientes nunca ven nuestro nombre."],
    ["coins", "Margen real", "Comprás a precio de mayorista y el sistema te muestra cuánto ganás en cada producto."],
    ["cart", "Entrega en segundos", "Con saldo, la cuenta sale al instante con sus datos listos para mandar."],
    ["bell", "Clientes que vuelven", "Ves quién vence y le recordás por WhatsApp con un toque. Más renovaciones, menos olvidos."],
    ["robot", "Bot 24/7", "Tus clientes y vos consultan servicios, precios y vencimientos a cualquier hora."],
    ["renew", "Respaldo de la tienda", "Si una cuenta falla, se reemplaza y tu cliente ve los datos nuevos."],
  ];
  return `<section class="phero">
      <div class="pfloat" aria-hidden="true">${tiles.map((p, i) => `<span class="pt pt${i}" style="--c:${esc(p.color)}">${esc(p.name[0])}<small>${esc(p.name.split(" ")[0])}</small></span>`).join("")}</div>
      <span class="pill"><i></i>${MODE === "hub" ? `${esc(S.settings.storeName)} · plataforma para revendedores de streaming` : `Programa de revendedores de ${esc(pg.storeName)}`}</span>
      <h1>Vendé streaming<br><span>con tu propia marca</span></h1>
      <p>Tu tienda online, precios de mayorista, panel de clientes y avisos de vencimiento. Nosotros ponemos el stock y la tecnología; vos ponés tu nombre.</p>
      <div class="pbtns2">${want()}<a class="pghost" href="/tiendas" data-s="tiendas">Explorar tiendas</a></div>
      <div class="pscroll">deslizá</div></section>

    <section class="psec"><div class="peyebrow">Por dentro</div><div class="psplit"><h2>Todo tu negocio<br>en una sola pantalla</h2><p>Saldo, clientes, vencimientos y ventas del día, en la compu o en el celular. Así se ve tu panel de revendedor.</p></div>
      <div class="pshot">${browser(location.host + "/#clientes", `<div class="mk"><div class="mk-side">${["Vender", "Mis clientes", "Por vencer", "Mi página", "Mis precios", "Saldo"].map((t, i) => `<span class="${i === 1 ? "on" : ""}">${t}</span>`).join("")}</div>
          <div class="mk-main"><b class="mk-t">Mi panel de revendedor</b><div class="mk-kpi">${[["Mi saldo", "Bs 420"], ["Clientes", "38"], ["Activos", "52"], ["Vencen en 7 días", "6"]].map(([a, b]) => `<div><small>${a}</small><b>${b}</b></div>`).join("")}</div>
          ${[["Ana P.", ex, "Vence en 2 d", "w"], ["Luis C.", sample[1]?.name ?? "Spotify", "Vence en 5 d", "w"], ["María Q.", sample[2]?.name ?? "Disney+", "Vence en 21 d", "o"], ["Jorge R.", ex, "Vence en 28 d", "o"]].map(([n, pr, d, k]) => `<div class="mk-row"><span>${esc(n)}</span><span>${esc(pr)}</span><em class="${k}">${d}</em><i>Renovar</i></div>`).join("")}</div></div>`)}
        <div aria-hidden="true" class="fcard f1"><small>GANANCIA · ESTE MES</small><b>Bs 1.240 <em>+22%</em></b>${spark([3, 4, 3.5, 5, 4.8, 6.5, 6, 8], "var(--s-ok)")}</div>
        <div aria-hidden="true" class="fcard f2"><small>RECORDATORIOS HOY</small><b>6 clientes</b><span class="bars">${[3, 5, 4, 6, 5, 7, 9].map((h) => `<i style="height:${h * 4}px"></i>`).join("")}</span><small>4 ya renovaron</small></div>
        <div aria-hidden="true" class="fcard f3"><b>Venta lista · ${esc(ex)}</b><small>Datos copiados para tu cliente</small></div></div>
      <p class="pnote">Imagen ilustrativa con datos de ejemplo.</p></section>

    <section class="pstats">${[[pg.stats.products, "productos para vender"], [pg.stats.categories, "categorías"], [pg.stats.shops || 12, pg.stats.shops ? (pg.stats.shops === 1 ? "tienda de revendedor" : "tiendas de revendedores") : "estilos de tienda"], ["24/7", "bot de WhatsApp"]]
      .map(([n, t]) => `<div><b>${esc(String(n))}</b><span>${t}</span></div>`).join("")}</section>

    <section class="psec"><div class="peyebrow">Lo que incluye</div><div class="psplit"><h2>Tres herramientas<br>que trabajan juntas</h2><p>Tu página, tu panel y el bot comparten los mismos datos: vendés en el panel, tu cliente aparece en tus recordatorios y el bot ya sabe cuándo vence.</p></div>
      <div class="prow"><div class="pvis">${browser(location.host + "/r/tu-tienda", `<div class="phones pmini">${mocks.map((t) => phoneMock(t, sample)).join("")}</div>`)}</div>
        <div class="ptxt"><span class="pnum">01</span><h3>Tu tienda con tu marca</h3><p>Elegís un estilo, subís tu logo y portada, ponés tus precios y compartís tu link. Tus clientes arman el pedido y te llega a tu WhatsApp.</p>
          ${checks([`${THEMES.length} estilos listos para arrancar`, "Logo, portada, colores y letras", "Tus precios, no los nuestros", "Pedidos directo a tu WhatsApp", "Link propio: /r/tu-tienda", "Perfecta en el celular"])}</div></div>
      <div class="prow rev"><div class="pvis">${browser(location.host + "/#clientes", `<div class="mkdone"><b>✅ Venta lista: mandale estos datos a Ana</b><pre>*${esc(ex)}*\nCorreo: cliente01@correo.com\nContraseña: ••••••••\nPerfil: Perfil 3\nVence: 07/12/2026</pre><div><i>Copiar datos</i><i class="g">Mandar por WhatsApp</i></div></div>`)}</div>
        <div class="ptxt"><span class="pnum">02</span><h3>Panel de revendedor</h3><p>Vendés con tu saldo y la cuenta sale al instante. Tus clientes, sus servicios, notas y renovaciones, todo ordenado.</p>
          ${checks(["Venta y entrega en segundos", "Copiar o mandar datos por WhatsApp", "Renovar con un toque", "Clientes por vencer en 7 días", "Notas privadas por cliente", "Lista de precios con tu ganancia"])}</div></div>
      <div class="prow"><div class="pvis">${browser("WhatsApp", `<div class="mkchat"><span class="in">8</span><span class="out"><b>👥 Clientes por vencer (7 días)</b><br>• Ana P.: ${esc(ex)} · vence en 2 días<br>• Luis C.: ${esc(sample[1]?.name ?? "Spotify")} · vence en 5 días<br><br>Renovalos con tu saldo desde <b>Mis clientes</b> 🔗</span><span class="in">gracias!</span><span class="out">¡De nada! 🙌 Si necesitás algo más, escribí <b>menu</b>.</span></div>`)}</div>
        <div class="ptxt"><span class="pnum">03</span><h3>Bot y avisos por WhatsApp</h3><p>El bot de la tienda responde a toda hora. A vos te dice quién vence; a tus clientes, cómo pagar y renovar.</p>
          ${checks(["Atención 24/7", "Tus clientes por vencer (opción 8)", "Precios y stock al instante", "Pasa a una persona cuando hace falta"])}</div></div></section>

    ${pg.showPrices && pg.products.length ? `<section class="psec"><div class="peyebrow">Números reales</div><div class="psplit"><h2>Tu ganancia<br>en cada venta</h2><p>Precio de nuestra tienda al público contra tu precio de revendedor. Vos decidís a cuánto vender.</p></div>
      <div class="sbox pprices"><div class="pp-h"><span>Producto</span><span>Precio público</span><span>Tu precio</span><span>Ganás hasta</span></div>
      ${pg.products.map((p) => `<div class="pp-r"><span class="who">${miniMark(product(p.id) ?? p)}<b>${esc(p.name)}</b></span><span data-l="Público">${bs(p.public)}</span><span data-l="Tu precio"><b>${bs(p.reseller)}</b></span><span data-l="Ganás" class="pp-g">+${bs(p.public - p.reseller)}</span></div>`).join("")}
      <p class="empty" style="margin:0">“Ganás hasta” = vendiendo al mismo precio que la tienda, ${p_dur(pg.products)}.</p></div></section>` : ""}

    <section class="psec"><div class="peyebrow">Ventajas</div><div class="psplit"><h2>¿Por qué revender con nosotros?</h2><p>Lo que cambia en tu negocio desde el primer día.</p></div>
      <div class="pfeats">${feats.map(([i, t, d]) => `<div class="pfc"><span class="pfi">${icon(i)}</span><b>${t}</b><span>${d}</span></div>`).join("")}</div></section>

    ${pg.testimonials.length ? (() => {
      const rated = pg.testimonials.filter((t) => t.rating);
      const avg = rated.length ? rated.reduce((a, t) => a + t.rating, 0) / rated.length : 0;
      return `<section class="psec"><div class="peyebrow">Opiniones</div><div class="psplit"><h2>Lo que dicen<br>nuestros revendedores</h2>${rated.length ? `<p class="prate"><b>${avg.toFixed(1).replace(".", ",")}</b><span>${"★".repeat(Math.round(avg))}${"☆".repeat(5 - Math.round(avg))}<br><small>${rated.length} ${rated.length === 1 ? "opinión" : "opiniones"}</small></span></p>` : "<p></p>"}</div>
        <div class="ptesti">${pg.testimonials.map((t) => `<figure><blockquote>“${esc(t.text)}”</blockquote>${t.rating ? `<span class="pstars" aria-label="${t.rating} de 5 estrellas">${"★".repeat(t.rating)}${"☆".repeat(5 - t.rating)}</span>` : ""}<figcaption><i>${esc(t.name[0])}</i><span><b>${esc(t.name)}</b>${t.business ? `<small>${esc(t.business)}</small>` : ""}</span></figcaption></figure>`).join("")}</div></section>`;
    })() : ""}

    <section class="psec"><div class="peyebrow">Tu estilo</div><div class="psplit"><h2>${THEMES.length} estilos para tu tienda</h2><p>Arrancás con uno y después cambiás todo: colores, fondo, tarjetas, letras, logo y portada.</p></div>
      <div class="tgrid pthemes">${THEMES.map((t) => `<div class="tcard">${themeSwatch(t)}<span>${esc(t.name)}</span></div>`).join("")}</div></section>

    ${pg.shops.length ? directoryView(false) : ""}

    <section class="psec"><div class="peyebrow">Cómo empezar</div><div class="psteps">${[["1", "Escribinos", "Te damos tu acceso de revendedor y la lista de precios."], ["2", "Cargá saldo", "Con QR desde tu cuenta. Con saldo vendés y renovás al instante."], ["3", "Armá tu tienda", "Elegí un estilo, poné tus precios y compartí tu link."]]
      .map(([n, t, d]) => `<div><span class="pn">${n}</span><b>${t}</b><span>${d}</span></div>`).join("")}</div></section>

    <section class="psec"><div class="peyebrow">Dudas</div><h2 class="ph2">Preguntas frecuentes</h2>
      ${[["¿Cómo le entrego la cuenta a mi cliente?", "Comprás para tu cliente con tu saldo desde “Mis clientes”. Al instante ves los datos de acceso con botones para copiarlos o mandarlos por WhatsApp."],
        ["¿Mis clientes ven tus precios o tu nombre?", "No. Tu tienda muestra solo tu marca y tus precios. Tus clientes te piden a vos por WhatsApp."],
        ["¿Cómo cargo saldo?", "Desde tu cuenta → Saldo: elegís el monto, pagás con el QR y subís el comprobante. Cuando lo verificamos, el saldo aparece en tu cuenta."],
        ["¿Qué pasa si una cuenta deja de funcionar?", "Escribinos: la reemplazamos y los datos nuevos aparecen en la cuenta de tu cliente."],
        ["¿Me avisan cuando un cliente está por vencer?", "Sí: en tu panel ves quién vence en los próximos 7 días y con un toque le mandás el recordatorio por WhatsApp. El bot también te lo dice si escribís 8."],
        ["¿Puedo usarlo desde el celular?", "Sí, todo funciona en el celular: vender, renovar, ver clientes y editar tu tienda."]]
        .map(([q, a]) => `<details class="pfaq"><summary>${q}</summary><p>${a}</p></details>`).join("")}</section>

    <section class="pfinal"><div class="peyebrow">Empezá hoy</div><h2>¿Listo para tener<br><span>tu propia tienda?</span></h2><p>Escribinos y en minutos tenés tu acceso de revendedor.</p><div class="pbtns2">${want()}<button class="pghost" type="button" data-login="1">Ya soy revendedor: entrar</button></div></section>`;
}
const p_dur = (list) => { const d = [...new Set(list.map((p) => p.durationDays))]; return d.length === 1 ? `cada ${d[0]} días de servicio` : "cada periodo de servicio"; };

/* ---------- Editor de la página propia del revendedor ---------- */
const LOOK_FIELDS = ["accentColor", "accent2Color", "backgroundColor", "bgStyle", "cardStyle", "fontFamily", "headingFont", "corners", "layout",
  "heroTitle", "heroHighlight", "heroText", "heroChip", "heroTicks", "announcement", "footerText", "instagram", "tiktok", "facebook"];
const shopUrl = (slug) => `${location.origin}/r/${slug}`;

function shopEditor() {
  const sh = S.data.shop;
  if (!sh) return `<p class="empty">Cargando…</p>`;
  const priced = (S.data.prices ?? []).filter((p) => p.sell !== null);
  const unpriced = (S.data.prices ?? []).filter((p) => p.sell === null);
  const chosen = new Set(sh.products ?? []);
  const radios = (name, list, cur) => `<div class="ropts">${list.map(([v, t]) => `<label><input type="radio" name="${name}" value="${v}" ${v === cur ? "checked" : ""}><span>${t}</span></label>`).join("")}</div>`;
  const fontSel = (name, cur) => `<select name="${name}">${FONT_LIST.map(([id, n, d]) => `<option value="${id}" ${id === cur ? "selected" : ""}>${n || "Sistema"} · ${d}</option>`).join("")}</select>`;
  const color = (name, label, cur) => `<label class="rcolor">${label}<span><input type="color" name="${name}" value="${esc(cur || "#7c5cff")}"><code>${esc(cur || "")}</code></span></label>`;
  return `<div class="sec-h"><div><span class="chip">Tu marca</span><h2>Mi página</h2><p>Armá tu propia tienda con tu logo, tus colores y tus precios. Tus clientes te piden directo por WhatsApp.</p></div></div>
    ${sh.allowed ? "" : `<div class="err">La tienda todavía no habilitó las páginas de revendedores. Podés armarla igual y publicarla cuando la habiliten.</div>`}
    <div class="sbox rstatus"><div><h2>${sh.enabled ? "🟢 Tu página está publicada" : "⚪ Tu página está apagada"}</h2><p class="empty" style="margin:0">Tu dirección: <b class="rlink">${esc(shopUrl(sh.slug))}</b></p></div>
      <div class="rbtns"><label class="chk rswitch"><input type="checkbox" id="shopOn" ${sh.enabled ? "checked" : ""} ${sh.allowed ? "" : "disabled"}> Publicar</label>
      <button class="sbtn sm" type="button" data-copy="${esc(shopUrl(sh.slug))}">Copiar link</button><a class="sbtn sm" href="/r/${esc(sh.slug)}" target="_blank" rel="noopener">${icon("arrow")}Abrir</a>
      <a class="sbtn sm" href="https://wa.me/?text=${encodeURIComponent(`¡Mirá mi tienda! ${shopUrl(sh.slug)}`)}" target="_blank" rel="noopener">${icon("wa")}Compartir</a></div></div>
    ${priced.length ? "" : `<div class="err">Todavía no pusiste precios: en tu página solo aparecen los productos con precio. Cargalos en <b>Clientes y ventas → Mi lista de precios</b>.</div>`}

    <div class="sbox"><h2>1 · Elegí un estilo</h2><p class="empty" style="margin:0">Tocá uno y tu página queda armada al instante. Después cambiá lo que quieras abajo.</p>
      <div class="tgrid">${THEMES.map((t) => `<button type="button" class="tcard" data-theme="${t.id}">${themeSwatch(t)}<span>${esc(t.name)}</span></button>`).join("")}</div></div>

    <div class="reditor">
    <form class="sbox sform" id="shopForm">
      <h2>2 · Tu marca</h2>
      <div class="rgrid"><label>Nombre de tu tienda<input name="title" maxlength="40" required value="${esc(sh.title)}"></label>
        <label>Dirección (después de /r/)<input name="slug" maxlength="30" required pattern="[a-z0-9\\-]{3,30}" value="${esc(sh.slug)}" autocapitalize="none"></label>
        <label>Tu WhatsApp (ahí te llegan los pedidos)<input name="whatsapp" inputmode="tel" required value="${esc(sh.whatsapp)}"></label></div>
      <h2>3 · Colores</h2><p class="empty" style="margin:0;font-size:13px">👆 Mirá la vista previa de arriba: cambia al instante cuando tocás un color.</p>
      <div id="shopWarn" class="lookwarn" role="status" aria-live="polite"></div>
      <div class="rgrid">${color("accentColor", "Color principal", sh.accentColor)}${color("accent2Color", "Segundo color (degradados)", sh.accent2Color)}${color("backgroundColor", "Fondo", sh.backgroundColor)}</div>
      <h2>🏪 Tipo de tienda</h2>
      <p class="empty" style="margin:0;font-size:13px">El diseño de tu página. Cambia la vista previa de arriba al instante.</p>
      ${radios("layout", LAYOUT_LIST.map(([v, t]) => [v, t]), sh.layout || "clasico")}
      <h2>4 · Fondo y tarjetas</h2>
      <b class="rsub">Fondo</b>${radios("bgStyle", BG_LIST, sh.bgStyle)}
      <b class="rsub">Tarjetas</b>${radios("cardStyle", CARD_LIST, sh.cardStyle)}
      <b class="rsub">Bordes</b>${radios("corners", [["round", "Redondeados"], ["soft", "Suaves"], ["square", "Rectos"]], sh.corners)}
      <h2>5 · Letras</h2>
      <div class="rgrid"><label>Letra de los títulos${fontSel("headingFont", sh.headingFont)}</label><label>Letra del texto${fontSel("fontFamily", sh.fontFamily)}</label></div>
      <h2>6 · Textos de tu portada</h2>
      <div class="rgrid"><label>Etiqueta de arriba<input name="heroChip" maxlength="40" value="${esc(sh.heroChip ?? "")}"></label>
        <label>Título<input name="heroTitle" maxlength="40" value="${esc(sh.heroTitle ?? "")}"></label>
        <label>Parte en color<input name="heroHighlight" maxlength="40" value="${esc(sh.heroHighlight ?? "")}"></label>
        <label class="rwide">Descripción<input name="heroText" maxlength="220" value="${esc(sh.heroText ?? "")}"></label>
        <label class="rwide">Ventajas (hasta 3, separadas por coma)<input name="heroTicks" maxlength="120" value="${esc(sh.heroTicks ?? "")}"></label>
        <label class="rwide">Aviso arriba de todo (promos)<input name="announcement" maxlength="140" value="${esc(sh.announcement ?? "")}" placeholder="Ej.: 🔥 Netflix a Bs 30 solo hoy"></label>
        <label class="rwide">Horario de atención (franja de arriba)<input name="storeHours" maxlength="60" value="${esc(sh.storeHours ?? "")}" placeholder="Ej.: Atención 8:00 a 22:00"></label>
        <label class="rwide">Texto del pie<input name="footerText" maxlength="120" value="${esc(sh.footerText ?? "")}" placeholder="Precios en ${preciosEn()}"></label></div>
      <h2>7 · Redes</h2>
      <div class="rgrid"><label>Instagram<input name="instagram" maxlength="80" value="${esc(sh.instagram ?? "")}" placeholder="tu.usuario"></label>
        <label>TikTok<input name="tiktok" maxlength="80" value="${esc(sh.tiktok ?? "")}" placeholder="tu.usuario"></label>
        <label>Facebook<input name="facebook" maxlength="80" value="${esc(sh.facebook ?? "")}" placeholder="tu.pagina"></label></div>
      <h2>8 · Productos que mostrás</h2>
      <p class="empty" style="margin:0">Sin marcar ninguno, se muestran todos los que tienen precio.</p>
      <div class="ropts">${priced.map((p) => `<label><input type="checkbox" name="prod" value="${esc(p.productId)}" ${chosen.has(p.productId) ? "checked" : ""}><span>${esc(p.name)} · ${bs(p.sell)}</span></label>`).join("")}
        ${unpriced.map((p) => `<label class="off" title="Poné tu precio en Mi lista de precios"><input type="checkbox" disabled><span>${esc(p.name)} · sin precio</span></label>`).join("")}</div>
      <div class="rsave"><button class="sbtn pri" type="submit">Guardar mi página</button><span class="empty">La vista previa cambia mientras editás. Guardá para que la vean tus clientes.</span></div>
    </form>
    <div class="rpreview"><div class="sbox"><h2>👀 Vista previa <small style="font-weight:400;color:var(--s-muted)">· cambia en vivo</small> <span class="rbtns" style="margin-left:auto"><button class="sbtn sm" type="button" data-pv="pc">PC</button><button class="sbtn sm" type="button" data-pv="cel">Celular</button></span></h2>
      <div class="pvwrap" data-mode="${S.data.pv ?? "cel"}">${sh.saved ? `<iframe id="shopPreview" src="/r/${esc(sh.slug)}" title="Vista previa de tu página"></iframe>` : `<p class="empty" style="padding:20px">Elegí un estilo arriba o guardá para ver tu página acá.</p>`}</div></div></div>
    </div>

    <div class="sbox"><h2>Logo y portada</h2>
      <div class="rimgs"><form class="sform" id="shopLogo"><b>Logo</b>${sh.hasLogo ? `<img class="rlogo" src="/api/shops/${esc(sh.slug)}/logo?v=${Date.now() % 1e6}" alt="Tu logo">` : `<span class="empty">Sin logo: se ve la inicial de tu tienda.</span>`}
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen del logo"><div class="rbtns"><button class="sbtn sm pri" type="submit">${sh.hasLogo ? "Cambiar" : "Subir"} logo</button>${sh.hasLogo ? `<button class="sbtn sm" type="button" data-rmimg="logo">Quitar</button>` : ""}</div><small class="empty">Cuadrado, 512×512 ideal. Hasta 5 MB.</small></form>
      <form class="sform" id="shopBanner"><b>Portada</b>${sh.hasBanner ? `<img class="rbanner" src="/api/shops/${esc(sh.slug)}/banner?v=${Date.now() % 1e6}" alt="Tu portada">` : `<span class="empty">Sin portada: se ve una tarjeta con tus precios.</span>`}
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen de portada"><div class="rbtns"><button class="sbtn sm pri" type="submit">${sh.hasBanner ? "Cambiar" : "Subir"} portada</button>${sh.hasBanner ? `<button class="sbtn sm" type="button" data-rmimg="banner">Quitar</button>` : ""}</div><small class="empty">Horizontal, 1600×1000 ideal (tus flyers o un collage de plataformas).</small></form></div></div>`;
}

/** Lee el formulario del editor como objeto de estilo. */
function combosEditor() {
  const sh = S.data.shop;
  if (!sh) return `<p class="empty">Cargando…</p>`;
  const priced = (S.data.prices ?? []).filter((p) => p.sell !== null);
  const combos = sh.combos ?? [];
  const D = sh.comboDiscounts ?? [0, 0, 0];
  const nameOf = (id) => (priced.find((p) => p.productId === id)?.name ?? id);
  const draft = S.data.cdraft ?? { picks: [], price: "", name: "" };
  const sum = draft.picks.reduce((t, id) => t + (priced.find((p) => p.productId === id)?.sell ?? 0), 0);
  return `<div class="sec-h"><div><span class="chip">Tus reglas</span><h2>Mis combos y descuentos</h2><p>Vos armás tus propios combos con tu precio, y ponés tus descuentos. Son independientes de los míos.</p></div></div>
    ${priced.length < 2 ? `<div class="err">Primero poné precio a 2 o más apps en <b>Clientes y ventas → Mi lista de precios</b>. Con eso armás combos.</div>` : ""}

    <form class="sbox sform" id="discForm"><h2>✦ Armá tu combo (descuento por cantidad)</h2>
      <p class="empty" style="margin:0">Tus clientes eligen 2, 3 o 4 apps sueltas y vos les hacés este descuento. Poné 0 en los tres para apagarlo.</p>
      <div class="rgrid">${["2 apps", "3 apps", "4 o más"].map((t, i) => `<label>Descuento ${t} (Bs)<input name="d${i}" inputmode="decimal" value="${D[i] ? D[i] / 100 : ""}" placeholder="0"></label>`).join("")}</div>
      <button class="sbtn pri" type="submit">Guardar descuentos</button></form>

    <div class="sbox"><h2>🎁 Mis combos</h2>
      ${combos.length ? `<div class="rcombos">${combos.map((cb) => `<div class="rcombo"><div><b>${esc(cb.name)}</b><small class="empty">${esc(cb.productIds.map(nameOf).join(" + "))}</small></div><span class="rcprice">${bs(cb.price)}</span><button class="sbtn sm" type="button" data-delcombo="${esc(cb.id)}" aria-label="Borrar">${icon("trash") || "🗑"}</button></div>`).join("")}</div>` : `<p class="empty" style="margin:0">Todavía no armaste combos. Creá el primero abajo.</p>`}
    </div>

    ${priced.length >= 2 ? `<form class="sbox sform" id="comboForm"><h2>➕ Nuevo combo</h2>
      <label>Nombre del combo<input name="name" maxlength="40" required placeholder="Ej.: Combo Full (4 apps)" value="${esc(draft.name)}"></label>
      <b class="rsub">Elegí las apps (2 o más)</b>
      <div class="ropts">${priced.map((p) => `<label><input type="checkbox" data-cpk="${esc(p.productId)}" ${draft.picks.includes(p.productId) ? "checked" : ""}><span>${esc(p.name)} · ${bs(p.sell)}</span></label>`).join("")}</div>
      ${draft.picks.length ? `<p class="empty" style="margin:0">Si lo vendieras suelto saldría ${bs(sum)}. Poné tu precio de combo (más barato para que convenga):</p>` : ""}
      <label>Precio del combo (Bs)<input name="price" inputmode="decimal" required value="${esc(draft.price)}" placeholder="Ej.: ${sum ? Math.round(sum * 0.85 / 100) : 60}"></label>
      <button class="sbtn pri" type="submit" ${draft.picks.length >= 2 ? "" : "disabled"}>Guardar combo</button></form>` : ""}`;
}

function shopFormLook(f) {
  const look = { title: f.title.value };
  for (const k of LOOK_FIELDS) {
    const el = f.elements[k];
    if (!el) continue;
    look[k] = el instanceof RadioNodeList ? el.value : el.value;
  }
  return look;
}
function pushPreview(look) {
  const fr = $("#shopPreview");
  try { fr?.contentWindow?.postMessage({ type: "gs-look", look }, location.origin); } catch { /* aún cargando */ }
  // Aviso si el color elegido se lee poco sobre el fondo.
  const w = $("#shopWarn");
  if (w && look.accentColor) { const n = contrastNote(look); w.className = "lookwarn " + n.cls; w.textContent = n.text; }
}

function updateSellSummary(f) {
  const p = product(f.product.value);
  const out = $("#sellSum");
  if (!out) return;
  f.querySelector(".rnew").hidden = f.client.value !== "__new";
  if (!p) { out.textContent = "Elegí cliente y producto."; return; }
  const qty = +f.qty.value, cost = p.price * qty, sell = sellPrice(p.id);
  out.innerHTML = `Te cuesta <b>${bs(cost)}</b>${sell !== null ? ` · le cobrás <b>${bs(sell * qty)}</b> · ganás <b style="color:var(--s-ok)">${bs(sell * qty - cost)}</b>` : ""} · tu saldo: ${bs(S.me.balance)}${cost > S.me.balance ? ` <b style="color:var(--s-bad)">(no alcanza)</b>` : ""}`;
}

async function copyText(text) {
  try { await navigator.clipboard.writeText(text); }
  catch {
    const t = Object.assign(document.createElement("textarea"), { value: text });
    document.body.append(t); t.select(); document.execCommand("copy"); t.remove();
  }
  toast("Copiado");
}

/* ---------------- carrito y pago ---------------- */
function openDrawer() {
  $("#modal").hidden = true;
  $("#drawer").hidden = false;
  $("#scrim").hidden = false;
  S.step = 1;
  S.checkoutKey = newKey();
  renderCart();
}
function closeAll() {
  $("#modal").hidden = true;
  $("#drawer").hidden = true;
  $("#scrim").hidden = true;
}
/* ---------------- Armá tu combo ---------------- */
function comboView() {
  if (!comboOn()) return `<div class="sbox"><h2>Armá tu combo</h2><p class="empty">Esta opción no está disponible ahora.</p></div>`;
  const sel = (S.data.combo ??= []).filter((id) => comboable(product(id)));
  S.data.combo = sel;
  const all = S.catalog.filter(comboable);
  const cats = ["Todos", ...new Set(all.map((p) => p.category).filter(Boolean))];
  const cc = cats.includes(S.data.ccat) ? S.data.ccat : "Todos";
  const list = all.filter((p) => cc === "Todos" || p.category === cc);
  const chosen = sel.map(product);
  const gross = chosen.reduce((s, p) => s + p.price, 0), disc = Math.min(discountFor(sel), gross), D = S.settings.comboDiscounts;
  const match = comboMatch(sel);
  const noStock = chosen.filter((p) => !p.available);
  const next = sel.length < 2 ? `Elegí ${2 - sel.length === 2 ? "dos servicios" : "uno más"} para activar el descuento.` : sel.length < 4 && D[sel.length - 1] > disc ? `Sumá uno más y ahorrás ${bs(D[sel.length - 1])}.` : "¡Tenés el descuento máximo!";
  const msg = `Hola, quiero armar este combo:\n${chosen.map((p) => `• ${p.name} (${bs(p.price)})`).join("\n")}\nDescuento combo: −${bs(disc)}\nTotal: ${bs(gross - disc)}`;
  return `<div class="sec-h"><div><span class="chip">Tu combo, tus reglas</span><h2>Armá tu combo</h2><p>Combiná streaming, música, IA y herramientas. Elegí 2 o más servicios y ahorrá. Los combos ya armados mantienen su precio.</p></div></div>
    <div class="ctiers">${D.map((v, i) => `<div class="${(i === 0 && sel.length === 2) || (i === 1 && sel.length === 3) || (i === 2 && sel.length >= 4) ? "on" : ""}"><b>${["2", "3", "4+"][i]}</b><span>servicios</span><em>−${bs(v)}</em></div>`).join("")}</div>
    <div class="cbuild">
      <div style="display:grid;gap:14px;min-width:0">
        <div class="cats">${cats.map((c) => `<button type="button" data-ccat="${esc(c)}" aria-pressed="${c === cc}">${esc(c)}</button>`).join("")}</div>
        <p class="empty" style="margin:0">${list.length} opciones · ${sel.length} en tu combo</p>
        <div class="copts">${list.map((p) => { const on = sel.includes(p.id); return `<button type="button" class="copt${on ? " on" : ""}" data-cpick="${esc(p.id)}" aria-pressed="${on}">${miniMark(p)}<span><b>${esc(p.name)}</b><small>${p.durationDays} días${p.available ? "" : " · a pedido"}</small></span><em>${bs(p.price)}</em><i>${on ? "✓" : "+"}</i></button>`; }).join("")}</div>
        <p class="empty" style="margin:0;font-size:13px">Las variantes de una misma app (por ejemplo Disney+ con o sin ESPN) son alternativas: al elegir una se cambia la otra.</p>
      </div>
      <aside class="csum">
        <span class="chip">Tu selección</span>
        ${chosen.length ? `<div class="clist">${chosen.map((p) => `<div>${miniMark(p)}<span>${esc(p.name)}</span><b>${bs(p.price)}</b><button type="button" data-cpick="${esc(p.id)}" aria-label="Quitar ${esc(p.name)}">×</button></div>`).join("")}</div>` : `<p class="empty" style="margin:0">Todavía no elegiste nada. Tocá los servicios de la lista.</p>`}
        ${match ? `<div class="combomatch">🎁 ¡Es tu <b>${esc(match.name)}</b>! Te queda al precio del combo ya armado.</div>` : ""}
        <div class="total sub"><span>Precio por separado</span><span>${bs(gross)}</span></div>
        <div class="total disc"><span>Tu ahorro</span><span>− ${bs(disc)}</span></div>
        <div class="total big"><span>Total del combo</span><span>${bs(gross - disc)}</span></div>
        <p class="cnext">${next}</p>
        ${sel.length < 2 ? `<button class="sbtn pri" type="button" disabled>Elegí al menos 2</button>`
          : noStock.length ? (S.settings.whatsapp ? `<a class="sbtn pri" href="${waLink(S.settings.whatsapp, msg)}" target="_blank" rel="noopener">${icon("wa")}Pedir combo por WhatsApp</a><p class="empty" style="margin:0;font-size:13px">${esc(noStock.map((p) => p.name).join(", "))} ${noStock.length > 1 ? "están" : "está"} a pedido: te confirmamos por WhatsApp.</p>` : `<button class="sbtn pri" type="button" disabled>Sin stock por ahora</button>`)
          : `<button class="sbtn pri" type="button" data-cadd="1">${icon("cart")}Agregar combo al carrito</button>`}
        ${sel.length ? `<button class="sbtn" type="button" data-cclear="1">Empezar de nuevo</button>` : ""}
      </aside>
    </div>
    ${sel.length ? `<button class="cbar" type="button" data-cgo="1"><span>${sel.length} en tu combo · ${bs(gross - disc)}<br><small>${disc ? `Ahorrás ${bs(disc)}` : "Elegí uno más para el descuento"}</small></span>Ver ${icon("arrow")}</button>` : ""}`;
}

function comboClick(d) {
  if (d.ccat !== undefined) { S.data.ccat = d.ccat; render(); return true; }
  if (d.aplats !== undefined) { (S.data.asesor ??= { budget: 80, plats: 0, like: "" }).plats = +d.aplats; render(); return true; }
  if (d.alike !== undefined) { (S.data.asesor ??= { budget: 80, plats: 0, like: "" }).like = d.alike; render(); return true; }
  if (d.cpick) {
    const p = product(d.cpick), sel = (S.data.combo ??= []);
    if (sel.includes(p.id)) S.data.combo = sel.filter((x) => x !== p.id);
    else { S.data.combo = sel.filter((x) => family(product(x)) !== family(p)); S.data.combo.push(p.id); }
    render(); return true;
  }
  if (d.cgo) { $(".csum")?.scrollIntoView({ behavior: "smooth", block: "start" }); return true; }
  if (d.cclear) { S.data.combo = []; render(); return true; }
  if (d.cadd) {
    for (const id of S.data.combo ?? []) if (!S.cart.some((l) => l.productId === id)) S.cart.push({ productId: id, qty: 1 });
    saveCart(); S.data.combo = []; S.step = 1; render(); openDrawer(); toast("Combo agregado al carrito"); return true;
  }
  return false;
}

/* Cupón: se pide al servidor cuánto descuenta; vale mientras el carrito no cambie. */
const cartKey = () => JSON.stringify(S.cart.map((l) => [l.productId, l.qty]));
const couponNow = () => (S.coupon && S.coupon.key === cartKey() && S.coupon.amount ? S.coupon : null);
async function applyCoupon(code) {
  code = String(code || "").trim().toUpperCase();
  if (!code) { S.coupon = null; return; }
  try {
    const q = await api("POST", "/api/orders/quote", { items: S.cart.map((l) => ({ productId: l.productId, qty: l.qty })), couponCode: code });
    S.coupon = q.coupon ? { key: cartKey(), code: q.coupon.code, amount: q.coupon.amount } : { key: cartKey(), code, amount: 0, error: q.couponError };
  } catch (e) { S.coupon = { key: cartKey(), code, amount: 0, error: e.message }; }
}

function renderCart(msg = "") {
  renderCartInner(msg);
  enhanceFiles($("#drawer"));
}
function renderCartInner(msg = "") {
  const tot = cartTotal();
  const head = `<h2>Tu carrito<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2><div class="steps"><span class="on">1 · Carrito</span><span class="${S.step >= 2 ? "on" : ""}">2 · Pago</span><span class="${S.step >= 3 ? "on" : ""}">3 · Listo</span></div>${msg}`;
  if (S.step === 1) {
    $("#drawer").innerHTML = head + (S.cart.length
      ? S.cart.map((l, k) => { const p = product(l.productId); return `<div class="line"><div style="display:flex;gap:10px;align-items:center">${miniMark(p)}<div><b>${esc(p.name)}</b><br><small class="empty">${bs(p.price)} · ${p.durationDays} días</small></div></div><div class="qty"><button type="button" data-dec="${k}" aria-label="Quitar uno">−</button>${l.qty}<button type="button" data-inc="${k}" aria-label="Sumar uno">+</button></div></div>`; }).join("")
        + `${cartDiscount() ? `<div class="total sub"><span>Subtotal</span><span>${bs(tot)}</span></div><div class="total disc"><span>Descuento combo</span><span>− ${bs(cartDiscount())}</span></div>` : comboOn() && S.cart.length === 1 ? `<button class="cbanner sm" type="button" data-close="1" data-s="combo"><span>Sumá otro servicio y ahorrá ${bs(S.settings.comboDiscounts[0])}</span>${icon("arrow")}</button>` : ""}<div class="total"><span>Total</span><span>${bs(tot - cartDiscount())}</span></div>${SLUG ? (S.settings.whatsapp ? `<a class="sbtn pri" href="${waLink(S.settings.whatsapp, `Hola, quiero pedir:\n${S.cart.map((l) => `• ${l.qty} × ${product(l.productId).name} (${bs(product(l.productId).price * l.qty)})`).join("\n")}\nTotal: ${bs(tot)}`)}" target="_blank" rel="noopener">${icon("wa")}Pedir por WhatsApp</a><p class="empty" style="margin:0">Te respondo por WhatsApp para coordinar el pago y pasarte tus accesos.</p>` : "") : `<button class="sbtn pri" type="button" data-step="2">Continuar al pago ${icon("arrow")}</button>`}`
      : `<p class="empty">Tu carrito está vacío.</p><button class="sbtn" type="button" data-close="1" data-s="catalogo">Ver catálogo</button>`);
    return;
  }
  const toPay = tot - cartDiscount();
  if (!S.me?.loggedIn) {
    // Invitado (sin cuenta): ve el QR y coordina el pedido por WhatsApp, sin obligarlo a entrar.
    const waMsg = `Hola, quiero pedir:\n${S.cart.map((l) => `• ${l.qty} × ${product(l.productId).name} (${bs(product(l.productId).price * l.qty)})`).join("\n")}\n${cartDiscount() ? `Descuento combo: − ${bs(cartDiscount())}\n` : ""}Total: ${bs(toPay)}`;
    $("#drawer").innerHTML = head
      + `${cartDiscount() ? `<div class="total disc"><span>Descuento combo</span><span>− ${bs(cartDiscount())}</span></div>` : ""}<div class="total"><span>Total</span><span>${bs(toPay)}</span></div>
      ${S.settings.hasQr ? `<p class="empty" style="margin:0">Pagá con este QR y mandanos el pedido por WhatsApp. Te confirmamos y te pasamos tus accesos.</p>${qrBlock()}` : `<p class="empty" style="margin:0">Mandanos tu pedido por WhatsApp y coordinamos el pago y la entrega.</p>`}
      ${S.settings.whatsapp ? `<a class="sbtn pri" href="${waLink(S.settings.whatsapp, waMsg)}" target="_blank" rel="noopener">${icon("wa")}Enviar pedido por WhatsApp</a>` : ""}
      <div class="sbox" style="gap:8px;padding:14px"><b>¿Ya sos cliente? Pagá con tu saldo ⚡</b><span class="empty">Entrá y comprás al instante con tus créditos, sin esperar la confirmación.</span><button class="sbtn sm pri" type="button" data-login="1" style="justify-self:start">Acceder y pagar con saldo</button></div>
      <button class="sbtn" type="button" data-step="1">Volver</button>`;
    return;
  }
  const cup = couponNow(), cupErr = S.coupon && S.coupon.key === cartKey() && S.coupon.error ? S.coupon : null;
  const net = toPay - (cup?.amount ?? 0);
  const canBalance = S.me.balance >= net && !cartBackorder();
  const pmx = S.data.payMethods ?? { qr: true, methods: [] };
  const firstPm = canBalance ? "balance" : pmx.qr ? "qr" : pmx.methods[0] ? `local:${pmx.methods[0].id}` : "qr";
  $("#drawer").innerHTML = head + `<form class="sform" id="checkout">
    ${cartDiscount() ? `<div class="total disc"><span>Descuento combo</span><span>− ${bs(cartDiscount())}</span></div>` : ""}
    ${cup ? `<div class="total disc"><span>Cupón ${esc(cup.code)} <button class="cupx" type="button" data-coupon="off" aria-label="Quitar el cupón ${esc(cup.code)}">Quitar</button></span><span>− ${bs(cup.amount)}</span></div>`
      : `<div class="cupbox"><label for="cupIn">¿Tenés un cupón de descuento?</label><div class="cuprow"><input id="cupIn" name="coupon" maxlength="20" autocomplete="off" autocapitalize="characters" placeholder="Ej.: VERANO10" value="${esc(cupErr?.code ?? "")}"><button class="sbtn sm" type="button" data-coupon="apply">Aplicar</button></div>${cupErr ? `<div class="err" role="alert">${esc(cupErr.error)}</div>` : ""}</div>`}
    <div class="total"><span>Total</span><span>${bs(net)}</span></div>
    ${isReseller() ? `<label>Para quién es<select name="customerId"><option value="">Para mí</option>${(S.data.customers ?? []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>` : ""}
    <div class="pay"><label><input type="radio" name="pm" value="balance" ${canBalance ? "checked" : "disabled"}><span>Pagar con saldo<small>Tenés ${bs(S.me.balance)}. ${canBalance ? "Entrega al instante." : cartBackorder() ? "Hay productos a pedido: pagalos con QR." : "No alcanza para este pedido."}</small></span></label>
    ${pmx.methods.map((m) => `<label><input type="radio" name="pm" value="local:${esc(m.id)}" ${firstPm === `local:${m.id}` ? "checked" : ""}><span>${esc(m.name)}${m.country ? ` (${esc(m.country)})` : ""}<small>Pagás y subís el comprobante. Lo revisamos en 10–30 minutos.</small></span></label>`).join("")}
    ${pmx.qr ? `<label><input type="radio" name="pm" value="qr" ${firstPm === "qr" ? "checked" : ""}><span>QR + comprobante<small>Revisamos el pago en 10–30 minutos.</small></span></label>` : ""}
    ${S.settings.usdt ? `<label><input type="radio" name="pm" value="usdt"><span>USDT (manual)<small>Mandás USDT a nuestra billetera y subís el comprobante.</small></span></label>` : ""}
    ${S.settings.binance ? `<label><input type="radio" name="pm" value="binance"><span>Binance Pay (USDT)<small>Pagás en cripto y se activa solo, al instante.</small></span></label>` : ""}</div>
    ${cartBackorder() ? `<p class="empty" style="margin:0">📦 Hay productos <b>a pedido</b>: pagá con QR, subí el comprobante y te entregamos la cuenta apenas confirmemos el pago. Te avisamos por WhatsApp y aparece en Mis cuentas.</p>` : ""}
    ${pmx.qr ? `<div id="qrInfo" ${firstPm === "qr" ? "" : "hidden"}>${qrBlock()}</div>` : ""}
    ${pmx.methods.map((m) => `<div class="lpInfo" data-lp="${esc(m.id)}" ${firstPm === `local:${m.id}` ? "" : "hidden"}>${localBlock(m, net)}</div>`).join("")}
    ${S.settings.usdt ? `<div id="usdtInfo" hidden>${usdtBlock(net)}</div>` : ""}
    <div id="proofPart" style="display:grid;gap:12px" ${firstPm === "balance" ? "hidden" : ""}><label>Comprobante (foto o captura)<input type="file" name="file" accept="image/*,application/pdf"></label><label>Número de operación o hash<input name="ref" placeholder="Ej.: 123456789 o el hash de la transacción"></label></div>
    <button class="sbtn pri" type="submit">Finalizar pedido</button><button class="sbtn" type="button" data-step="1">Volver</button></form>`;
}

async function submitCheckout(form) {
  const btn = form.querySelector('[type="submit"]');
  const pmRaw = form.pm.value;
  const localId = pmRaw.startsWith("local:") ? pmRaw.slice(6) : null;
  const pm = localId ? "local" : pmRaw;
  btn.disabled = true;
  btn.textContent = "Procesando…";
  try {
    let file, ref;
    if (pm === "qr" || pm === "usdt" || pm === "local") {
      ref = form.ref.value.trim();
      if (!form.file.files[0] || !ref) throw new Error(pm === "usdt" ? "Subí la captura del pago y pegá el hash o número de la transacción" : "Subí la foto del comprobante y escribí el número de operación");
      file = await fileToBase64(form.file.files[0]);
    }
    const order = await api("POST", "/api/orders", {
      items: S.cart.map((l) => ({ productId: l.productId, qty: l.qty })), paymentMethod: pm,
      customerId: form.customerId?.value || undefined, idempotencyKey: S.checkoutKey,
      ...(couponNow() ? { couponCode: couponNow().code } : {}),
      ...(localId ? { localMethodId: localId } : {}),
    });
    if (pm === "binance") {
      let pay;
      try {
        pay = await api("POST", `/api/orders/${order.id}/binance`, {});
      } catch (e) {
        S.cart = []; saveCart(); S.step = 3;
        $("#drawer").innerHTML = `<h2>Pedido ${esc(order.id)}<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2><div class="err">El pedido quedó reservado, pero no se pudo abrir el pago con Binance: ${esc(e.message)}</div><button class="sbtn pri" type="button" data-close="1" data-s="cuentas">Ver mis cuentas</button>`;
        await refresh();
        return;
      }
      S.cart = []; saveCart(); S.step = 3;
      $("#drawer").innerHTML = `<h2>Pagá con Binance<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2>
        <div class="steps"><span class="on">1 · Carrito</span><span class="on">2 · Pago</span><span>3 · Listo</span></div>
        <div class="sbox" style="text-align:center;gap:10px">
          <b style="font-size:17px">${esc(String(pay.usdt))} USDT</b>
          <span class="empty">Pedido ${esc(order.id)} · pagás en la app de Binance. Apenas se confirme, tu acceso aparece solo en Mis cuentas.</span>
          ${pay.qr ? `<img src="${esc(pay.qr)}" alt="QR de Binance Pay" style="width:180px;height:180px;object-fit:contain;align-self:center;background:#fff;border-radius:10px;padding:6px">` : ""}
          ${pay.link ? `<a class="sbtn pri" href="${esc(pay.link)}" target="_blank" rel="noopener">Abrir Binance y pagar</a>` : ""}
          <span class="empty">Cuando termines de pagar, tocá “Ya pagué” para revisar el estado.</span>
          <button class="sbtn" type="button" data-close="1" data-s="cuentas">Ya pagué · ver mis cuentas</button>
        </div>`;
      await refresh();
      return;
    }
    let final = order;
    if (pm === "qr" || pm === "usdt" || pm === "local") {
      try {
        final = await api("POST", `/api/orders/${order.id}/evidence`, { contentBase64: file, declaredReference: ref });
      } catch (e) {
        // El pedido quedó creado y reservado: se puede reintentar desde Mis cuentas.
        S.cart = []; saveCart();
        S.step = 3;
        $("#drawer").innerHTML = `<h2>Pedido ${esc(order.id)}<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2><div class="err">El pedido quedó reservado, pero el comprobante no se pudo enviar: ${esc(e.message)}</div><button class="sbtn pri" type="button" data-close="1" data-s="cuentas">Subirlo desde Mis cuentas</button>`;
        await refresh();
        return;
      }
    }
    S.cart = []; saveCart();
    S.step = 3;
    $("#drawer").innerHTML = `<h2>${pm === "balance" ? "¡Listo!" : "Pedido enviado"}<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2>
      <div class="steps"><span class="on">1 · Carrito</span><span class="on">2 · Pago</span><span class="on">3 · Listo</span></div>
      <div class="sbox"><h2>Pedido ${esc(final.id)} <span class="spill ${final.status === "fulfilled" ? "sp-ok" : "sp-warn"}">${STATUS_TEXT[final.status]}</span></h2>
      <p class="empty">${final.status === "fulfilled" ? "Tus accesos ya están en Mis cuentas." : "Verificamos tu pago en 10–30 minutos y te avisamos. Lo podés seguir en Mis cuentas."}</p>
      <button class="sbtn pri" type="button" data-close="1" data-s="cuentas">Ver mis cuentas</button></div>`;
    await refresh();
  } catch (e) {
    btn.disabled = false;
    btn.textContent = "Finalizar pedido";
    const box = document.createElement("div");
    box.className = "err";
    box.textContent = e.code === "OUT_OF_STOCK" ? "Se agotó uno de los productos. Revisá tu carrito." : e.message;
    form.prepend(box);
    if (e.code === "OUT_OF_STOCK") { await refresh(); }
  }
}

/* ---------------- acceso ---------------- */
function openLogin(step, phone = "", msg = "", email = "") {
  if (!step) step = MODE === "store" ? "email" : "pin";
  $("#drawer").hidden = true;
  const st = S.settings;
  const body = {
    email: `<label>Tu correo<input name="email" type="email" required value="${esc(email)}" autocomplete="email" placeholder="vos@correo.com"></label>
      <label>Tu contraseña<input name="password" type="password" required minlength="8" autocomplete="current-password" placeholder="••••••••"></label>
      <button class="sbtn pri" type="submit">Entrar</button>
      <div class="loginalt"><button class="sbtn sm" type="button" data-loginstep="register">Crear cuenta</button><button class="sbtn sm" type="button" data-loginstep="forgot">Olvidé mi contraseña</button></div>
      <button class="sbtn" type="button" data-loginstep="pin">Entrar con número y PIN</button>`,
    register: `<p class="empty">Creá tu cuenta con tu correo y una contraseña. Después entrás cuando quieras.</p>
      <label>Tu nombre<input name="name" required autocomplete="name" maxlength="80"></label>
      <label>Tu correo<input name="email" type="email" required value="${esc(email)}" autocomplete="email" placeholder="vos@correo.com"></label>
      <label>Contraseña (mínimo 8)<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="••••••••"></label>
      <button class="sbtn pri" type="submit">Crear mi cuenta</button>
      <button class="sbtn" type="button" data-loginstep="email">Ya tengo cuenta</button>`,
    forgot: `<p class="empty">Ponemos un enlace en tu correo para que elijas una contraseña nueva (vale 1 hora).</p>
      <label>Tu correo<input name="email" type="email" required value="${esc(email)}" autocomplete="email" placeholder="vos@correo.com"></label>
      <button class="sbtn pri" type="submit">Enviarme el enlace</button>
      <button class="sbtn" type="button" data-loginstep="email">Volver</button>`,
    pin: `<label>Tu número de WhatsApp<input name="phone" required inputmode="tel" value="${esc(phone || "+591 ")}" autocomplete="tel"></label>
      <label>Tu PIN (4 números)<input name="pin" required inputmode="numeric" maxlength="4" pattern="[0-9]{4}" autocomplete="current-password" class="pinbox" placeholder="••••"></label>
      <button class="sbtn pri" type="submit">Entrar</button>
      <div class="loginalt"><button class="sbtn sm" type="button" data-loginstep="email">Entrar con correo</button><button class="sbtn sm" type="button" data-loginstep="phone">No tengo PIN / soy nuevo</button></div>`,
    phone: `<label>Tu número de WhatsApp<input name="phone" required inputmode="tel" value="${esc(phone || "+591 ")}" autocomplete="tel"></label><button class="sbtn pri" type="submit">Recibir código</button>`,
    name: `<p class="empty">Es tu primera compra. ¿Cómo te llamás?</p><input type="hidden" name="phone" value="${esc(phone)}"><label>Nombre<input name="name" required autocomplete="name"></label><label class="chk"><input type="checkbox" name="consent" checked> Acepto recibir avisos de pedidos y vencimientos por WhatsApp.</label><button class="sbtn pri" type="submit">Recibir código</button>`,
    code: `<p class="empty">Te mandamos un código de 6 números por WhatsApp a ${esc(phone)}.</p><input type="hidden" name="phone" value="${esc(phone)}"><label>Código<input name="code" required inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label><button class="sbtn pri" type="submit">Entrar</button>`,
    link: `<p class="empty">Para entrar necesitás tu PIN de 4 números. Te lo da la tienda por WhatsApp (una sola vez; después lo podés cambiar).</p>${st.whatsapp ? `<a class="sbtn pri" href="${waLink(st.whatsapp, `Hola, quiero mi PIN de acceso a ${st.storeName}. Mi número es ${phone}`)}" target="_blank" rel="noopener">${icon("wa")}Pedir mi PIN por WhatsApp</a>` : `<p class="empty">Escribile a la tienda para pedirlo.</p>`}<button class="sbtn" type="button" data-loginstep="pin">Ya tengo PIN</button>`,
  }[step];
  $("#modal").innerHTML = `<div role="dialog" aria-modal="true"><h2 style="font-size:22px;font-weight:800;display:flex;justify-content:space-between">Acceder<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2>${msg}<form class="sform" id="login" data-step="${step}">${body}</form></div>`;
  $("#modal").hidden = false;
  $("#scrim").hidden = false;
  $("#modal input:not([type=hidden])")?.focus();
}

async function submitLogin(form) {
  const step = form.dataset.step;
  const phone = form.phone?.value?.trim();
  const btn = form.querySelector('[type="submit"]');
  if (btn) btn.disabled = true;
  try {
    if (step === "email") {
      await api("POST", "/api/auth/customer/login-email", { email: form.email.value.trim(), password: form.password.value });
      return afterLogin();
    }
    if (step === "register") {
      await api("POST", "/api/auth/customer/register", { name: form.name.value.trim(), email: form.email.value.trim(), password: form.password.value });
      toast("¡Cuenta creada! 🎉");
      return afterLogin();
    }
    if (step === "forgot") {
      await api("POST", "/api/auth/customer/forgot", { email: form.email.value.trim() });
      return openLogin("email", "", `<div class="ok-msg">✅ Si ese correo tiene una cuenta, te mandamos el enlace. Revisá tu bandeja (y la carpeta de spam).</div>`, form.email.value.trim());
    }
    if (step === "pin") {
      await api("POST", "/api/auth/customer/pin", { phone, pin: form.pin.value.trim() });
      return afterLogin();
    }
    if (step === "phone" || step === "name") {
      const r = await api("POST", "/api/auth/customer/request-code", step === "name" ? { phone, name: form.name.value, whatsappConsent: form.consent.checked } : { phone });
      if (r.needsName) return openLogin("name", phone);
      return openLogin("code", phone);
    }
    if (step === "code") {
      await api("POST", "/api/auth/customer/verify", { phone, code: form.code.value });
      return afterLogin();
    }
  } catch (e) {
    if (e.code === "OTP_DISABLED") return openLogin("link", phone);
    openLogin(step === "code" ? "code" : step, phone, `<div class="err">${esc(e.message)}</div>`, form.email?.value?.trim() ?? "");
  }
}

async function afterLogin() {
  closeAll();
  toast("¡Bienvenido!");
  await refresh();
  if (MODE === "hub") { if (isReseller()) setView("inicio"); else location.href = "/tienda/#cuentas"; return; }
  if (S.cart.length) { openDrawer(); S.step = 2; S.data.payMethods = await api("GET", "/api/me/paymethods").catch(() => null); renderCart(); }
}

/** Link de acceso: /#acceso=TOKEN */
async function useAccessLink() {
  const m = location.hash.match(/^#acceso=([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + (MODE === "hub" ? "#inicio" : "#cuentas"));
  try {
    const r = await api("POST", "/api/auth/customer/link", { token: m[1] });
    toast(`¡Hola, ${r.name.split(" ")[0]}! Ya entraste.`);
  } catch {
    // Links viejos (vencidos o ya usados): si ya tiene sesión no pasa nada; si no, que entre con número + PIN.
    const me = await api("GET", "/api/me").catch(() => null);
    if (me?.loggedIn) return;
    S.linkExpired = true;
  }
}

/* ---------------- eventos ---------------- */
function setView(v) {
  if (!VIEWS.includes(v)) v = "inicio";
  if (location.hash !== "#" + v) history.replaceState(null, "", "#" + v);
  S.view = v;
  closeAll();
  scrollTo(0, 0);
  loadPrivate().then(render, (e) => toast(e.message));
  render();
}

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button,a[data-s]");
  if (!el) return;
  const d = el.dataset;
  if (d.close) { closeAll(); if (d.s) setView(d.s); return; }
  if (d.s) { ev.preventDefault(); setView(d.s); return; }
  if (comboClick(d)) return;
  if (d.loginstep) return openLogin(d.loginstep, $("#login [name=phone]")?.value?.trim() ?? "", "", $("#login [name=email]")?.value?.trim() ?? "");
  if (d.tour) { ev.preventDefault(); return startTour(); }
  if (d.wiz) { S.data.wiz = { step: 1 }; return render(); }
  if (d.wizexit) { S.data.wiz = null; return setView("inicio"); }
  if (d.wizback) { S.data.wiz.step = 1; return render(); }
  if (d.wizall !== undefined) { Object.values(S.data.wiz.picks ?? {}).forEach((x) => (x.on = d.wizall === "1")); return render(); }
  if (d.gopage) { S.data.rtab = "pagina"; return setView("clientes"); }
  if (d.rentpay) { try { await api("POST", "/api/me/shop/pay", {}); toast("¡Pagado! Tu página está publicada"); await refresh(); } catch (e) { toast(e.message); } return; }
  if (d.apply) return openApply();
  if (d.sugerir) {
    const f = $("#myPrices"); if (!f) return;
    const m = S.data.shop?.marginPct ?? S.settings?.resellerMarginPct ?? 30;
    let n = 0;
    f.querySelectorAll("input[data-cost]").forEach((inp) => {
      if (inp.value.trim()) return; // no pisa lo que el revendedor ya puso
      const cost = +inp.dataset.cost || 0;
      inp.value = String(roundBs(cost * (1 + m / 100)) / 100);
      inp.dispatchEvent(new Event("input", { bubbles: true })); // recalcula la ganancia
      n++;
    });
    toast(n ? `Listo: ${n} precio(s) con +${m}% de ganancia. Revisá y tocá Guardar.` : "Ya tenés todos los precios puestos.");
    return;
  }
  if (d.makecodelink) {
    el.disabled = true;
    try { const k = await api("POST", "/api/me/code-link", { keepLink: true }); S.data.codeLink = { url: k.url, mode: "email" }; toast("Tu link quedó listo (modo correo)"); render(); }
    catch (e) { el.disabled = false; toast(e.message); }
    return;
  }
  if (d.pwd) {
    const h = await api("GET", "/api/me/has-password").catch(() => ({ hasPassword: false }));
    $("#modal").innerHTML = `<div role="dialog" aria-modal="true"><h2 style="font-size:22px;font-weight:800;display:flex;justify-content:space-between">${h.hasPassword ? "Cambiar mi contraseña" : "Crear mi contraseña"}<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2>
      <form class="sform" id="pwdform">${h.hasPassword ? `<label>Contraseña actual<input name="current" type="password" required autocomplete="current-password" placeholder="••••••••"></label>` : `<p class="empty">Poné tu correo y una contraseña para entrar con ellos la próxima vez.</p>`}
      <label>Tu correo<input name="email" type="email" required value="${esc(S.me?.email ?? "")}" autocomplete="email" placeholder="vos@correo.com"></label>
      <label>Contraseña nueva (mínimo 8)<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="••••••••"></label>
      <button class="sbtn pri" type="submit">Guardar</button></form></div>`;
    $("#modal").hidden = false; $("#scrim").hidden = false;
    $("#modal input")?.focus();
    return;
  }
  if (d.cart) return openDrawer();
  if (d.copy) return copyText(d.copy);
  if (d.rclear) { S.data.lastSale = []; return render(); }
  if (d.mf) { S.data.mf = d.mf; return render(); }
  if (d.rtab) { S.data.rtab = d.rtab; if (d.rtab !== "combos") S.data.cdraft = null; return render(); }
  if (d.delcombo) {
    const combos = (S.data.shop.combos ?? []).filter((c) => c.id !== d.delcombo);
    try { S.data.shop = await api("PUT", "/api/me/shop", { combos: combos.map((c) => ({ id: c.id, name: c.name, productIds: c.productIds, price: c.price })) }); toast("Combo borrado"); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.pv) { S.data.pv = d.pv; $(".pvwrap").dataset.mode = d.pv; return; }
  if (d.theme) {
    const t = THEMES.find((x) => x.id === d.theme);
    el.disabled = true;
    try { S.data.shop = await api("PUT", "/api/me/shop", t.look); toast(`Estilo “${t.name}” aplicado`); render(); }
    catch (e) { el.disabled = false; toast(e.message); }
    return;
  }
  if (d.rmimg) {
    try { S.data.shop = await api("POST", `/api/me/shop/${d.rmimg}`, { remove: true }); toast("Imagen quitada"); render(); } catch (e) { toast(e.message); }
    return;
  }
  if (d.login || el.id === "accBtn") { if (S.me?.loggedIn && el.id === "accBtn") return setView("cuentas"); return openLogin(); }
  if (d.cat) { S.cat = d.cat; return render(); }
  if (d.add) {
    const p = product(d.add);
    const l = S.cart.find((x) => x.productId === d.add);
    if ((l?.qty ?? 0) >= maxQty(p)) return toast("No hay más unidades disponibles");
    l ? l.qty++ : S.cart.push({ productId: d.add, qty: 1 });
    saveCart(); closeAll(); render();
    return toast(`${p.name} agregado al carrito`);
  }
  if (d.det) {
    const p = product(d.det);
    $("#modal").innerHTML = `<div role="dialog" aria-modal="true"><div class="pimg" style="--c:${esc(p.color)}"><span class="tag">${esc(p.category)}</span>${mark(p)}</div><h2 style="font-size:24px;font-weight:900">${esc(p.name)}</h2><p class="empty">${esc(p.description)}</p>
      <dl class="cred" style="margin:0"><div><dt>Modalidad</dt><dd>${esc(kindText(p.kind))}</dd></div><div><dt>Duración</dt><dd>${p.durationDays} días</dd></div><div><dt>Entrega</dt><dd>${SLUG ? "Por WhatsApp" : "En Mis cuentas"}</dd></div><div><dt>Disponibles</dt><dd>${p.available || (askWa(p) ? "A pedido" : 0)}</dd></div></dl>
      <div class="price">${bs(p.price)}<small>/ ${p.durationDays} días</small></div><div class="pbtns"><button class="sbtn" type="button" data-close="1">Cerrar</button>${p.available || !askWa(p) ? `<button class="sbtn pri" type="button" data-add="${esc(p.id)}" ${p.available ? "" : "disabled"}>Añadir +</button>` : `<a class="sbtn pri" href="${askWa(p)}" target="_blank" rel="noopener">${icon("wa")}Pedir por WhatsApp</a>`}</div></div>`;
    $("#modal").hidden = false; $("#scrim").hidden = false;
    return;
  }
  if (d.inc) { const l = S.cart[d.inc]; if (l.qty < maxQty(product(l.productId))) l.qty++; else toast("No hay más unidades"); saveCart(); renderCart(); return render(); }
  if (d.dec) { if (--S.cart[d.dec].qty <= 0) S.cart.splice(d.dec, 1); saveCart(); renderCart(); return render(); }
  if (d.coupon) {
    const form = $("#checkout"), pm = form?.pm?.value, who = form?.customerId?.value;
    if (d.coupon === "off") S.coupon = null;
    else { el.disabled = true; await applyCoupon(form?.coupon?.value); }
    renderCart();
    const f2 = $("#checkout");
    if (f2 && who !== undefined && f2.customerId) f2.customerId.value = who;
    const r = pm && f2?.querySelector(`[name="pm"][value="${pm}"]:not(:disabled)`);
    if (r) { r.checked = true; r.dispatchEvent(new Event("change", { bubbles: true })); }
    (couponNow() ? f2?.querySelector('[name="pm"]:checked') : $("#cupIn"))?.focus();
    return;
  }
  if (d.step) {
    S.step = +d.step;
    if (S.step === 2 && isReseller() && !S.data.customers) S.data.customers = await api("GET", "/api/me/customers").catch(() => []);
    if (S.step === 2 && S.me?.loggedIn) S.data.payMethods = await api("GET", "/api/me/paymethods").catch(() => null);
    return renderCart();
  }
  if (d.renew) {
    el.disabled = true;
    try {
      const r = await api("POST", "/api/me/renew", { assignmentId: d.renew, paymentMethod: d.method, idempotencyKey: newKey() });
      toast(d.method === "balance" ? `Renovado hasta ${fdate(r.assignment.customerExpiresAt)}` : "Pedido de renovación creado: subí el comprobante arriba");
      await refresh();
    } catch (e) {
      el.disabled = false;
      if (e.code === "INSUFFICIENT_BALANCE") { toast("Tu saldo no alcanza: recargá o renová con QR"); return setView("recargas"); }
      toast(e.code === "SUPPLIER_EXPIRY_EXCEEDED" ? "Este servicio no se puede renovar por ahora. Escribinos por WhatsApp." : e.message);
    }
    return;
  }
  if (d.cancel) {
    el.disabled = true;
    try { await api("POST", `/api/orders/${d.cancel}/cancel`); toast("Pedido cancelado"); await refresh(); } catch (e) { el.disabled = false; toast(e.message); }
    return;
  }
  if (d.reload) { await loadPrivate(); return render(); }
  if (d.logout) { await api("POST", "/api/auth/logout", {}); S.data = {}; toast("Cerraste sesión"); await refresh(); return setView("inicio"); }
});

// Tocar un campo de solo lectura (ej. tu link de referido) lo selecciona entero, para copiarlo fácil.
document.addEventListener("focusin", (ev) => { if (ev.target?.dataset?.selectall) ev.target.select(); });
document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.name === "pm") {
    const proof = t.value === "qr" || t.value === "usdt" || t.value.startsWith("local:");
    const pp = $("#proofPart"); if (pp) pp.hidden = !proof;
    $$(".lpInfo").forEach((x) => (x.hidden = t.value !== `local:${x.dataset.lp}`));
    const qi = $("#qrInfo"); if (qi) qi.hidden = t.value !== "qr";
    const ui = $("#usdtInfo"); if (ui) ui.hidden = t.value !== "usdt";
  }
  if (t.form?.id === "resSell") updateSellSummary(t.form);
  if (t.form?.id === "shopForm") pushPreview(shopFormLook(t.form));
  if (t.id === "shopOn") {
    try { S.data.shop = await api("PUT", "/api/me/shop", { enabled: t.checked }); toast(t.checked ? "¡Tu página está publicada! Compartí el link" : "Tu página quedó apagada"); render(); }
    catch (e) { t.checked = !t.checked; toast(e.message); }
  }
  if (t.id === "consent") {
    try { await api("PUT", "/api/me/consent", { whatsapp: t.checked }); toast(t.checked ? "Vas a recibir avisos por WhatsApp" : "Ya no vas a recibir avisos por WhatsApp"); } catch (e) { t.checked = !t.checked; toast(e.message); }
  }
});

let qTimer, asesorTimer;
document.addEventListener("input", (ev) => {
  if (ev.target.dataset?.abudget !== undefined) {
    (S.data.asesor ??= { budget: 80, plats: 0, like: "" }).budget = +ev.target.value;
    clearTimeout(asesorTimer);
    const lbl = ev.target.parentElement?.querySelector("b"); if (lbl) lbl.textContent = "Hasta " + bs(+ev.target.value * 100);
    asesorTimer = setTimeout(() => render(), 160);
    return;
  }
  if (ev.target.form?.id === "shopForm") {
    if (ev.target.type === "color") ev.target.nextElementSibling.textContent = ev.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => pushPreview(shopFormLook(ev.target.form)), 150);
    return;
  }
  const pi = ev.target.closest?.("#myPrices input[data-cost]");
  if (pi) {
    const v = pi.value.trim() ? toCents(pi.value) : null, out = $(`[data-profit="${pi.name.slice(2)}"]`);
    const pr = v === null || Number.isNaN(v) ? null : v - +pi.dataset.cost;
    out.innerHTML = pr === null ? "" : `<b style="color:${pr < 0 ? "var(--s-bad)" : "var(--s-ok)"}">${pr < 0 ? "−" : "+"}${bs(Math.abs(pr))}</b>`;
    return;
  }
  if (ev.target.id === "mq") {
    S.data.mq = ev.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { render(); const f = $("#mq"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 250);
    return;
  }
  if (ev.target.id === "dq") {
    S.data.dq = ev.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { render(); const f = $("#dq"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 250);
    return;
  }
  if (ev.target.id === "cq") {
    S.data.cq = ev.target.value;
    clearTimeout(qTimer);
    qTimer = setTimeout(() => { render(); const f = $("#cq"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 250);
    return;
  }
  if (ev.target.id !== "q") return;
  S.q = ev.target.value.toLowerCase().trim();
  clearTimeout(qTimer);
  qTimer = setTimeout(() => { render(); const f = $("#q"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }, 250);
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target;
  ev.preventDefault();
  if (f.id === "checkout") return submitCheckout(f);
  if (f.id === "login") return submitLogin(f);
  const btn = f.querySelector('[type="submit"]');
  btn.disabled = true;
  try {
    if (f.dataset.evidence) {
      if (!f.ref.value.trim()) throw new Error("Escribí el número de operación");
      await api("POST", `/api/orders/${f.dataset.evidence}/evidence`, { contentBase64: await fileToBase64(f.file.files[0]), declaredReference: f.ref.value.trim() });
      toast("Comprobante enviado: lo revisamos en 10–30 minutos");
    } else if (f.id === "applyForm") {
      const r = await api("POST", "/api/resellers/apply", { name: f.name.value, phone: f.phone.value, note: f.note.value, ...(REF ? { ref: REF } : {}) });
      $("#modal").innerHTML = `<div role="dialog" aria-modal="true"><h2 style="font-size:22px;font-weight:800">${r.already === "reseller" ? "¡Ya sos revendedor!" : "¡Solicitud enviada! 🎉"}</h2><p class="empty">${r.already === "reseller" ? "Entrá con tu número y tu PIN." : r.already === "pending" ? "Ya teníamos tu solicitud: en breve te escribimos." : "Te escribimos por WhatsApp con tu acceso apenas la aprobemos."}</p><button class="sbtn pri" type="button" data-close="1" ${r.already === "reseller" ? 'data-login="1"' : ""}>Listo</button></div>`;
      return;
    } else if (f.id === "pwdform") {
      await api("POST", "/api/me/password", { current: f.current?.value ?? "", password: f.password.value, email: f.email.value.trim() });
      closeAll();
      toast("Listo: ya podés entrar con tu correo y contraseña ✓");
      await refresh();
    } else if (f.id === "myPin") {
      await api("POST", "/api/me/login-pin", { current: f.current.value.trim(), pin: f.pin.value.trim() });
      f.reset();
      toast("PIN cambiado ✓");
    } else if (f.id === "wiz1") {
      S.data.wiz.title = f.title.value.trim(); S.data.wiz.whatsapp = f.whatsapp.value;
      S.data.shop = await api("PUT", "/api/me/shop", { title: S.data.wiz.title, whatsapp: f.whatsapp.value });
      if (f.logo.files[0]) S.data.shop = await api("POST", "/api/me/shop/logo", { contentBase64: await fileToBase64(f.logo.files[0]) });
      S.data.wiz.step = 2;
      render(); scrollTo(0, 0);
      return;
    } else if (f.id === "wiz2") {
      const picks = S.data.wiz.picks;
      const prices = Object.fromEntries(Object.entries(picks).map(([id, x]) => [id, x.on ? x.sell : null]));
      await api("PUT", "/api/me/prices", { prices });
      S.data.shop = await api("PUT", "/api/me/shop", { products: Object.keys(picks).filter((id) => picks[id].on), enabled: true });
      S.data.wiz.step = 3;
      render(); scrollTo(0, 0);
      return;
    } else if (f.id === "codePin") {
      const k = await api("POST", "/api/me/code-link", { pin: f.pin.value.trim(), keepLink: true });
      S.data.codeLink = { url: k.url, mode: "pin" };
      try { await navigator.clipboard.writeText(`${k.url}\nPIN: ${k.pin}`); } catch { /* sin portapapeles */ }
      toast("Listo: link protegido con PIN (copiado)");
      render();
    } else if (f.id === "topup") {
      if (!f.ref.value.trim()) throw new Error("Escribí el número de operación");
      await api("POST", "/api/me/topups", { amount: +f.pack.value, contentBase64: await fileToBase64(f.file.files[0]), declaredReference: f.ref.value.trim() });
      toast("Recarga enviada: la acreditamos al verificar el pago");
    } else if (f.id === "resSell") {
      let customerId = f.client.value;
      if (!customerId) throw new Error("Elegí un cliente");
      if (customerId === "__new") {
        if (!f.nname.value.trim() || !f.nphone.value.trim()) throw new Error("Poné el nombre y el WhatsApp del cliente nuevo");
        customerId = (await api("POST", "/api/me/customers", { name: f.nname.value.trim(), phone: f.nphone.value.trim(), whatsappConsent: false })).id;
      }
      if (!f.product.value) throw new Error("Elegí un producto");
      try {
        const o = await api("POST", "/api/orders", { customerId, items: [{ productId: f.product.value, qty: +f.qty.value }], paymentMethod: "balance", idempotencyKey: newKey() });
        S.data.lastSale = o.assignmentIds ?? [];
        toast("¡Vendido! Abajo tenés los datos para mandarle");
      } catch (e) {
        if (e.code === "INSUFFICIENT_BALANCE") { toast("Tu saldo no alcanza: recargá primero"); await refresh(); return setView("recargas"); }
        throw e;
      }
      window.scrollTo({ top: 0, behavior: "smooth" });
    } else if (f.id === "discForm") {
      const d = [0, 1, 2].map((i) => toCents(f[`d${i}`].value || "0"));
      if (d.some((v) => Number.isNaN(v) || v < 0)) throw new Error("Revisá los descuentos: solo números");
      S.data.shop = await api("PUT", "/api/me/shop", { comboDiscounts: d });
      toast("Descuentos guardados");
    } else if (f.id === "comboForm") {
      const d = S.data.cdraft ?? { picks: [] };
      if (d.picks.length < 2) throw new Error("Elegí 2 o más apps para el combo");
      const price = toCents(f.price.value || "0");
      if (!(price > 0)) throw new Error("Poné el precio del combo");
      const combos = [...(S.data.shop.combos ?? []).map((c) => ({ id: c.id, name: c.name, productIds: c.productIds, price: c.price })), { name: f.name.value.trim(), productIds: d.picks, price }];
      S.data.shop = await api("PUT", "/api/me/shop", { combos });
      S.data.cdraft = null;
      toast("¡Combo creado! Ya aparece en tu página");
    } else if (f.id === "shopForm") {
      const body = shopFormLook(f);
      body.slug = f.slug.value.trim().toLowerCase();
      body.whatsapp = f.whatsapp.value;
      body.products = [...f.querySelectorAll('input[name="prod"]:checked')].map((x) => x.value);
      S.data.shop = await api("PUT", "/api/me/shop", body);
      toast(S.data.shop.enabled ? "Guardado: tus clientes ya ven los cambios" : "Guardado. Activá “Publicar” para que tus clientes la vean");
    } else if (f.id === "shopLogo" || f.id === "shopBanner") {
      S.data.shop = await api("POST", `/api/me/shop/${f.id === "shopLogo" ? "logo" : "banner"}`, { contentBase64: await fileToBase64(f.file.files[0]) });
      toast(f.id === "shopLogo" ? "Logo actualizado" : "Portada actualizada");
    } else if (f.dataset.client) {
      await api("PUT", `/api/me/customers/${f.dataset.client}`, { name: f.name.value, phone: f.phone.value, note: f.note.value, whatsappConsent: f.consent.checked });
      toast("Cliente actualizado");
    } else if (f.dataset.clientcode) {
      const k = await api("POST", `/api/me/clients/${f.dataset.clientcode}/code-link`, { pin: f.pin.value.trim(), keepLink: true });
      (S.data.clientLinks ??= {})[f.dataset.clientcode] = { url: k.url, pin: k.pin };
      toast("Link del cliente listo (con su PIN)");
      render();
      return;
    } else if (f.id === "myPrices") {
      const prices = {};
      for (const i of f.querySelectorAll("input[data-cost]")) {
        const v = i.value.trim();
        if (v && Number.isNaN(toCents(v))) throw new Error("Revisá los precios: solo números");
        prices[i.name.slice(2)] = v ? toCents(v) : null;
      }
      await api("PUT", "/api/me/prices", { prices });
      toast("Precios guardados");
    } else if (f.id === "newCustomer") {
      await api("POST", "/api/me/customers", { name: f.name.value, phone: f.phone.value, whatsappConsent: f.consent.checked });
      toast("Cliente agregado");
    }
    await refresh();
  } catch (e) {
    btn.disabled = false;
    toast(e.message);
  }
});

$("#scrim").onclick = closeAll;
document.addEventListener("keydown", (e) => { if (e.key === "Escape") closeAll(); });
window.addEventListener("message", (ev) => {
  if (ev.origin !== location.origin || ev.data?.type !== "gs-look" || !S.settings) return;
  Object.assign(S.settings, ev.data.look);
  applyLook(S.settings);
  if (ev.data.look.storeName || ev.data.look.title) $("#storeName").textContent = S.settings.storeName = ev.data.look.title || ev.data.look.storeName;
  footer();
  render();
});

window.addEventListener("hashchange", () => { if (location.hash.startsWith("#acceso=")) useAccessLink().then(refresh).then(() => { if (S.linkExpired) { S.linkExpired = false; openLogin("pin", "", `<div class="err">Ese link ya no sirve. Entrá con tu número y tu PIN.</div>`); } }); else { const v = location.hash.slice(1); if (v !== S.view) setView(v); } });

(async () => {
  if (SLUG) {
    S.view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
    return refresh();
  }
  // Links viejos de la tienda que apuntaban a la raíz: ahora la tienda está en /tienda/.
  const h0 = location.hash.slice(1);
  if (MODE === "hub" && h0 === "catalogo") return location.replace("/tienda/#catalogo");
  await useAccessLink();
  const path = location.pathname.replace(/\/+$/, "");
  const h = location.hash.slice(1);
  S.view = VIEWS.includes(h) ? h : path === "/tiendas" ? "tiendas" : "inicio";
  await refresh();
  if (S.linkExpired) {
    S.linkExpired = false;
    openLogin("pin", "", `<div class="err">Ese link ya no sirve (era de un solo uso). Ahora entrás con tu número y tu PIN de 4 números. Si no tenés PIN, pedíselo a la tienda.</div>`);
  }
})();

document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t.dataset.cpk) {
    const d = (S.data.cdraft ??= { picks: [], price: "", name: "" });
    const nm = document.querySelector('#comboForm [name=name]'); if (nm) d.name = nm.value;
    const pr = document.querySelector('#comboForm [name=price]'); if (pr) d.price = pr.value;
    d.picks = t.checked ? [...d.picks, t.dataset.cpk] : d.picks.filter((x) => x !== t.dataset.cpk);
    return render();
  }
  const w = S.data.wiz;
  if (!w?.picks) return;
  if (t.dataset.wpick) { w.picks[t.dataset.wpick].on = t.checked; render(); }
  if (t.dataset.wsell) { const v = toCents(t.value || "0"); if (v > 0) w.picks[t.dataset.wsell].sell = v; render(); }
});

function openApply(msg = "") {
  $("#drawer").hidden = true;
  $("#modal").innerHTML = `<div role="dialog" aria-modal="true"><h2 style="font-size:22px;font-weight:800;display:flex;justify-content:space-between">Quiero ser revendedor<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2>${msg}
    <form class="sform" id="applyForm"><label>Tu nombre<input name="name" required maxlength="80" autocomplete="name"></label>
    <label>Tu WhatsApp<input name="phone" required inputmode="tel" value="+591 " autocomplete="tel"></label>
    <label>¿Ya vendés? Contanos algo (opcional)<input name="note" maxlength="300" placeholder="Ej.: vendo Netflix hace 1 año"></label>
    <button class="sbtn pri" type="submit">Enviar solicitud</button><p class="empty" style="margin:0;font-size:13px">Te escribimos por WhatsApp con tu acceso.</p></form></div>`;
  $("#modal").hidden = false;
  $("#scrim").hidden = false;
  $("#modal input")?.focus();
}

// Enter en el campo del cupón aplica el cupón (no manda el pedido).
document.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter" && ev.target.id === "cupIn") { ev.preventDefault(); document.querySelector('[data-coupon="apply"]')?.click(); }
});
