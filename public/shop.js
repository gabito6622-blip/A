// Tienda Gabriel Store conectada al servidor.
import { api, $, $$, esc, bs, toCents, fdate, daysLeft, icon, toast, fileToBase64, waLink, newKey, STATUS_TEXT, KIND_TEXT, FONT_LIST, BG_LIST, CARD_LIST, THEMES, themeSwatch } from "/common.js";

const S = { me: null, settings: null, catalog: [], cart: [], view: "inicio", cat: "Todos", q: "", step: 1, data: {} };
const VIEWS = ["inicio", "catalogo", "cuentas", "codigos", "recargas", "clientes", "revendedores", "tiendas"];

try { S.cart = JSON.parse(localStorage.getItem("gs-cart") || "[]"); } catch { S.cart = []; }
const saveCart = () => { try { localStorage.setItem("gs-cart", JSON.stringify(S.cart)); } catch { /* sin almacenamiento */ } };
const product = (id) => S.catalog.find((p) => p.id === id);
const cartTotal = () => S.cart.reduce((s, l) => s + (product(l.productId)?.price ?? 0) * l.qty, 0);
const isReseller = () => S.me?.role === "reseller";
/** Página propia de un revendedor: /r/<slug>. Es una vitrina: los pedidos van al WhatsApp del revendedor. */
const SLUG = location.pathname.match(/^\/r\/([a-z0-9-]{3,30})\/?$/i)?.[1]?.toLowerCase() ?? null;
if (SLUG) VIEWS.splice(2);

/* ---------------- carga ---------------- */
async function loadBase() {
  if (SLUG) return loadResellerShop();
  [S.settings, S.me, S.catalog] = await Promise.all([api("GET", "/api/settings"), api("GET", "/api/me"), api("GET", "/api/catalog")]);
  S.settings.logoUrl = S.settings.hasLogo ? `/api/settings/logo?v=${Date.now() % 1e6}` : null;
  if (S.me.kind === "staff") S.me = { loggedIn: false, staff: true };
  // Saca del carrito lo que ya no existe.
  S.cart = S.cart.filter((l) => product(l.productId));
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
  if (!sh.published) S.settings.announcement = "👀 Vista previa: tu página está apagada. Solo vos la ves. Publicala desde Mis clientes → Mi página.";
  S.cart = S.cart.filter((l) => product(l.productId));
  applyLook(S.settings);
  document.title = sh.title;
  $("#storeName").textContent = sh.title;
  $$('.snav [data-s="cuentas"], .snav [data-s="codigos"], .snav [data-s="recargas"], #navCli, #navRev, #accBtn, .bnav [data-s="cuentas"], #bnavSaldo, #bnavCli').forEach((b) => b.remove());
  $(".bnav").style.gridTemplateColumns = "repeat(3,1fr)";
  footer();
}

function footer() {
  const st = S.settings;
  $("#footName").textContent = `© ${st.storeName} · ${st.footerText || "Precios en bolivianos"}`;
  const links = [
    st.whatsapp && [waLink(st.whatsapp, "Hola, tengo una consulta"), "WhatsApp"],
    st.instagram && [`https://instagram.com/${encodeURIComponent(st.instagram)}`, "Instagram"],
    st.tiktok && [`https://www.tiktok.com/@${encodeURIComponent(st.tiktok)}`, "TikTok"],
    st.facebook && [`https://facebook.com/${encodeURIComponent(st.facebook)}`, "Facebook"],
  ].filter(Boolean);
  $("#footWa").innerHTML = links.map(([h, t]) => `<a href="${esc(h)}" target="_blank" rel="noopener">${t}</a>`).join(" · ");
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
    r.setProperty("--s-ok", "#0b8a63"); r.setProperty("--s-warn", "#a15c00"); r.setProperty("--s-bad", "#c81e4a");
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
  document.documentElement.style.colorScheme = light ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  const body = st.fontFamily || "inter", head = st.headingFont || body;
  loadFont(body); loadFont(head);
  r.setProperty("--f-shop", fontStack(body));
  r.setProperty("--f-head", fontStack(head));
  const shop = document.getElementById("shop");
  if (shop) Object.assign(shop.dataset, { corners: st.corners || "round", bg: st.bgStyle || "glow", card: st.cardStyle || "solid", light: light ? "1" : "" });
  const mark = $("#logoMark");
  mark.outerHTML = st.logoUrl ? `<img id="logoMark" src="${esc(st.logoUrl)}" alt="">` : `<i id="logoMark">${esc((st.storeName || "G")[0])}</i>`;
  const ann = $("#announce");
  ann.textContent = st.announcement || "";
  ann.hidden = !st.announcement;
}

async function loadPrivate() {
  if ((S.view === "revendedores" || S.view === "tiendas") && !SLUG) S.data.program = await api("GET", "/api/resellers/program");
  if (!S.me?.loggedIn) return;
  const [services, orders] = await Promise.all([api("GET", "/api/me/services"), api("GET", "/api/me/orders")]);
  S.data.services = services;
  S.data.orders = orders;
  if (S.view === "codigos") S.data.codes = await api("GET", "/api/me/codes");
  if (S.view === "recargas") S.data.ledger = await api("GET", "/api/me/ledger");
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
function card(p) {
  const s = p.available;
  return `<article class="pc"><div class="pimg" style="--c:${esc(p.color)}"><span class="tag">${esc(p.category)}</span><span class="lt" style="background:${esc(p.color)}">${esc(p.name[0])}</span></div>
  <div class="pbody"><span class="k">${esc(kindText(p.kind))} · ${p.durationDays} días</span><h3>${esc(p.name)}</h3><p class="d" style="margin:0">${esc(p.description)}</p>
  <span class="stock" style="color:${s ? (s <= 2 ? "var(--s-warn)" : "var(--s-ok)") : "var(--s-bad)"}">${s ? (s <= 2 ? `Últimas ${s} unidades` : `${s} disponibles`) : "Agotado"}</span>
  <div class="price">${bs(p.price)}<small>/ ${p.durationDays} días</small></div>
  <div class="pbtns"><button class="sbtn sm det" type="button" data-det="${esc(p.id)}">Detalles</button><button class="sbtn sm pri" type="button" data-add="${esc(p.id)}" ${s ? "" : "disabled"}>Añadir +</button></div></div></article>`;
}
const kindText = (k) => ({ profile: "Perfil", full_account: "Cuenta completa", invite: "Invitación", combo: "Combo" })[k] ?? k;

const needLogin = (what) => `<div class="sbox"><h2>Ingresá a tu cuenta</h2><p class="empty">Para ver ${what} entrá con tu número de WhatsApp.</p><button class="sbtn pri" type="button" data-login="1" style="justify-self:start">Acceder</button></div>`;

function pendingOrders() {
  const list = (S.data.orders ?? []).filter((o) => o.status === "awaiting_payment" || o.status === "payment_review");
  return list.map((o) => `<div class="svc"><div class="top"><b>${KIND_TEXT[o.kind]} ${esc(o.id)} · ${bs(o.total)}</b><span class="spill ${o.status === "payment_review" ? "sp-warn" : "sp-mute"}">${STATUS_TEXT[o.status]}</span></div>
    ${o.status === "payment_review" ? `<span class="empty">Estamos verificando tu pago. Te avisamos por WhatsApp cuando esté listo.</span>`
      : `<span class="empty">Falta enviar el comprobante. Pagá ${bs(o.total)} con el QR y subí la foto.</span>
        <form class="inline-form" data-evidence="${esc(o.id)}">${qrBlock()}<label>Comprobante (foto o PDF)<input type="file" name="file" accept="image/*,application/pdf" required></label>
        <label>Número de operación<input name="ref" required placeholder="Ej.: 123456789"></label>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sbtn pri sm" type="submit">Enviar comprobante</button><button class="sbtn sm" type="button" data-cancel="${esc(o.id)}">Cancelar pedido</button></div></form>`}</div>`).join("");
}

function qrBlock() {
  const st = S.settings;
  return `<div class="qr">${st.hasQr ? `<img src="/api/settings/qr" alt="QR de cobro de ${esc(st.storeName)}">` : ""}<div style="display:grid;gap:6px">${st.hasQr ? "Escaneá con la app de tu banco y pagá el monto exacto." : "La tienda todavía no cargó su QR de cobro. Escribinos por WhatsApp para pagar."}${st.paymentNote ? `<b style="color:var(--s-ink)">${esc(st.paymentNote)}</b>` : ""}</div></div>`;
}

function render() {
  $$("#shop button[data-s]").forEach((b) => (b.dataset.s === S.view ? b.setAttribute("aria-current", "page") : b.removeAttribute("aria-current")));
  $("#cartN").textContent = S.cart.reduce((s, l) => s + l.qty, 0);
  if (!SLUG) {
    $("#navCli").hidden = $("#bnavCli").hidden = !isReseller();
    $("#bnavSaldo").hidden = isReseller();
  }
  if (!SLUG) $("#accName").textContent = S.me?.loggedIn ? `${S.me.name.split(" ")[0]} · ${bs(S.me.balance)}` : "Acceder";
  const pub = S.catalog;
  const services = S.data.services ?? [];
  const V = {
    inicio: () => `<section class="hero"><div style="display:grid;min-width:0">
        ${S.settings.heroChip ? `<span class="chip">${esc(S.settings.heroChip)}</span>` : ""}
        <h1>${esc(S.settings.heroTitle)}<br><span>${esc(S.settings.heroHighlight)}</span></h1>
        <p>${esc(S.settings.heroText)}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="sbtn pri" type="button" data-s="catalogo">${SLUG ? "Ver precios" : "Explorar productos"} ${icon("arrow")}</button>${SLUG ? (S.settings.whatsapp ? `<a class="sbtn" href="${waLink(S.settings.whatsapp, "Hola, quiero hacer un pedido")}" target="_blank" rel="noopener">${icon("wa")}Escribime por WhatsApp</a>` : "") : `<button class="sbtn" type="button" data-s="cuentas">Consultar mis servicios</button>`}</div>
        <div class="ticks">${(S.settings.heroTicks || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3).map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>
      ${S.settings.bannerUrl ? `<img class="hbanner" src="${esc(S.settings.bannerUrl)}" alt="">` : SLUG ? `<div class="mock" aria-hidden="true"><div class="t">${esc(S.settings.storeName)}</div><div class="mgrid">${pub.slice(0, 4).map((p) => `<div>${esc(p.name)}<b>${bs(p.price)}</b>${p.durationDays} días</div>`).join("") || "<div>Pronto<b>✦</b>nuevos productos</div>"}</div></div>` : `<div class="mock" aria-hidden="true"><div class="t">${esc(S.settings.storeName)} · tu resumen</div>
        <div class="mgrid"><div>Catálogo<b>${pub.length}</b>productos</div><div>Mis servicios<b>${S.me?.loggedIn ? services.length : "—"}</b>activos</div><div>Mi saldo<b>${S.me?.loggedIn ? bs(S.me.balance) : "—"}</b>para comprar al instante</div><div>Carrito<b>${S.cart.length}</b>productos</div></div></div>`}</section>
      ${pub.length ? `<section style="display:grid;gap:18px"><div class="sec-h"><div><span class="chip">Catálogo digital</span><h2>Servicios populares</h2></div><button class="sbtn" type="button" data-s="catalogo">Ver todos ${icon("arrow")}</button></div>
      <div class="pgrid">${pub.slice(0, 4).map(card).join("")}</div></section>` : `<div class="sbox"><h2>Pronto</h2><p class="empty">Estamos cargando los productos. Volvé en un rato.</p></div>`}
      ${!SLUG && !isReseller() ? `<section class="pteaser"><div><span class="chip">Programa de revendedores</span><h2>¿Querés tener tu propia tienda de streaming?</h2><p class="empty" style="margin:0">Precios de mayorista, tu página con tu logo y tus colores, y un panel para tus clientes.</p></div><a class="sbtn pri" href="#revendedores" data-s="revendedores">Ver cómo funciona ${icon("arrow")}</a></section>` : ""}
      <section class="sbox" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px">
        ${(SLUG ? [["1", "Elegí", "Agregá al carrito lo que te gusta."], ["2", "Pedí", "Mandame tu pedido por WhatsApp con un toque."], ["3", "Disfrutá", "Te paso tus accesos al toque."]]
          : [["1", "Elegí", "Agregá al carrito lo que necesitás."], ["2", "Pagá", "Con QR y comprobante, o al instante con tu saldo."], ["3", "Recibí", "Tus accesos aparecen en Mis cuentas y te avisamos por WhatsApp."]])
          .map(([k, t, d]) => `<div style="display:grid;gap:4px"><span class="chip">Paso ${k}</span><b style="font-size:18px">${t}</b><span class="empty">${d}</span></div>`).join("")}</section>`,
    catalogo: () => {
      const cats = ["Todos", ...new Set(pub.map((p) => p.category))];
      const list = pub.filter((p) => (S.cat === "Todos" || p.category === S.cat) && `${p.name} ${p.description} ${p.category}`.toLowerCase().includes(S.q));
      return `<div class="sec-h"><div><span class="chip">Nuestros productos</span><h2>Catálogo</h2><p>Suscripciones, combos y herramientas. Todos los precios en bolivianos${isReseller() ? " (precio de revendedor)" : ""}.</p></div></div>
      <div class="search"><input id="q" placeholder="Buscar por producto, combo o servicio" value="${esc(S.q)}" aria-label="Buscar"><button class="sbtn" type="button" data-cart="1">${icon("cart")}Mi carrito (${S.cart.length})</button></div>
      <div class="cats">${cats.map((c) => `<button type="button" data-cat="${esc(c)}" aria-pressed="${c === S.cat}">${esc(c)}</button>`).join("")}</div>
      ${list.length ? `<div class="pgrid">${list.map(card).join("")}</div>` : `<p class="empty">No encontramos productos con “${esc(S.q)}”.</p>`}`;
    },
    cuentas: () => !S.me?.loggedIn ? needLogin("tus servicios") : `<div class="sec-h"><div><span class="chip">Área privada</span><h2>Mis cuentas y pedidos</h2><p>Tus accesos están solo acá: nunca mandamos contraseñas por WhatsApp.</p></div>${isReseller() ? `<button class="sbtn" type="button" data-s="clientes">Mis clientes</button>` : ""}</div>
      ${pendingOrders()}
      <div class="sbox"><h2>Servicios activos <span class="spill sp-mute">${services.length}</span></h2>${services.length ? services.map((a) => {
        const d = a.daysLeft;
        return `<div class="svc"><div class="top"><div class="who"><span class="mini" style="background:${esc(product(a.productId)?.color ?? "#3984ff")}">${esc(a.product[0])}</span><div><b>${esc(a.product)}</b><br><small class="empty">${esc(a.access.profile)}${isReseller() && a.customerName !== S.me.name ? " · " + esc(a.customerName) : ""}</small></div></div>
        <span class="spill ${d < 0 ? "sp-bad" : d <= 3 ? "sp-warn" : "sp-ok"}">${d < 0 ? `Venció hace ${-d} d` : d === 0 ? "Vence hoy" : `Vence en ${d} d`} · ${fdate(a.expiresAt)}</span></div>
        <dl class="cred" style="margin:0"><div><dt>Correo</dt><dd>${esc(a.access.email)}</dd></div><div><dt>Contraseña</dt><dd>${esc(a.access.password)}</dd></div><div><dt>Perfil</dt><dd>${esc(a.access.profile)}</dd></div>${a.access.pin ? `<div><dt>PIN</dt><dd>${esc(a.access.pin)}</dd></div>` : ""}</dl>
        <div style="display:flex;gap:8px;flex-wrap:wrap"><button class="sbtn sm pri" type="button" data-renew="${esc(a.assignmentId)}" data-method="balance">${icon("renew")}Renovar con saldo</button><button class="sbtn sm" type="button" data-renew="${esc(a.assignmentId)}" data-method="qr">Renovar con QR</button><button class="sbtn sm" type="button" data-s="codigos">Ver códigos</button></div></div>`;
      }).join("") : `<p class="empty">Todavía no tenés servicios activos.</p><button class="sbtn" type="button" data-s="catalogo" style="justify-self:start">Ir al catálogo</button>`}</div>
      <div class="sbox"><h2>Historial de pedidos</h2>${(S.data.orders ?? []).length ? (S.data.orders).map((o) => `<div class="line"><span>${KIND_TEXT[o.kind]} ${esc(o.id)}<br><small class="empty">${fdate(o.createdAt)}</small></span><span style="text-align:right">${bs(o.total)}<br><small class="empty">${STATUS_TEXT[o.status]}</small></span></div>`).join("") : `<p class="empty">Sin pedidos todavía.</p>`}</div>
      <div class="sbox"><h2>Avisos por WhatsApp</h2><label class="chk"><input type="checkbox" id="consent" ${S.me.whatsappConsent ? "checked" : ""}> Quiero recibir avisos de mis pedidos y vencimientos por WhatsApp.</label></div>
      <button class="sbtn" type="button" data-logout="1" style="justify-self:start">Cerrar sesión</button>`,
    codigos: () => !S.me?.loggedIn ? needLogin("tus códigos") : `<div class="sec-h"><div><span class="chip">Verificación</span><h2>Códigos de acceso</h2><p>Si la plataforma te pide un código para entrar, aparece acá. Solo ves los de tus cuentas y duran 30 minutos.</p></div><button class="sbtn" type="button" data-reload="1">${icon("renew")}Actualizar</button></div>
      <div class="sbox"><h2>${icon("mailbox")}Bandeja</h2>${(S.data.codes ?? []).length ? S.data.codes.map((c) => `<div class="code"><div style="min-width:0">${esc(c.subject)}<small style="overflow-wrap:anywhere">${esc(c.to)} · ${new Date(c.receivedAt).toLocaleTimeString("es-BO", { hour: "2-digit", minute: "2-digit" })}</small></div><b>${esc(c.code)}</b></div>`).join("") : `<p class="empty">No hay códigos nuevos. Si acabás de pedir uno, tocá Actualizar en unos segundos.</p>`}</div>`,
    recargas: () => !S.me?.loggedIn ? needLogin("tu saldo") : `<div class="sec-h"><div><span class="chip">Saldo</span><h2>Saldo y recargas</h2><p>Recargá saldo y comprá o renová al instante, sin esperar la verificación del pago.</p></div></div>
      <div class="balance"><div><span class="empty">Tu saldo</span><br><b>${bs(S.me.balance)}</b></div><span class="spill sp-mute">${esc(S.me.phone)}</span></div>
      ${pendingOrders()}
      <form class="sbox sform" id="topup"><h2>Solicitar recarga</h2><div class="packs">${[50, 100, 200, 500].map((v, i) => `<label><input type="radio" name="pack" value="${v * 100}" ${i === 1 ? "checked" : ""}><b>Bs ${v}</b><small>de saldo</small></label>`).join("")}</div>
        ${qrBlock()}<label>Comprobante (foto o PDF)<input type="file" name="file" accept="image/*,application/pdf" required></label><label>Número de operación<input name="ref" required placeholder="Ej.: 123456789"></label><button class="sbtn pri" type="submit">Enviar recarga</button></form>
      <div class="sbox"><h2>Movimientos</h2>${(S.data.ledger ?? []).length ? S.data.ledger.slice().reverse().map((m) => `<div class="line"><span>${esc({ topup: "Recarga", purchase: "Compra", renewal: "Renovación", refund: "Devolución", adjustment: "Ajuste" }[m.type])} <small class="empty">${esc(m.ref)}</small><br><small class="empty">${fdate(m.at)}</small></span><span style="text-align:right"><b style="color:${m.amount < 0 ? "var(--s-bad)" : "var(--s-ok)"}">${m.amount > 0 ? "+" : "−"}${bs(Math.abs(m.amount))}</b><br><small class="empty">Saldo ${bs(m.balanceAfter)}</small></span></div>`).join("") : `<p class="empty">Sin movimientos.</p>`}</div>`,
    revendedores: () => programView(),
    tiendas: () => directoryView(true),
    clientes: () => !isReseller() ? needLogin("tus clientes") : `<div class="rtabs" role="tablist">${[["ventas", "Clientes y ventas"], ["pagina", "✦ Mi página"]].map(([k, t]) => `<button type="button" role="tab" data-rtab="${k}" aria-selected="${(S.data.rtab ?? "ventas") === k}">${t}</button>`).join("")}</div>${(S.data.rtab ?? "ventas") === "pagina" ? shopEditor() : resellerView()}`,
  };
  $("#sout").innerHTML = V[S.view]();
}

/* ---------------- revendedor ---------------- */
const accessText = (a) => `*${a.product}*\nCorreo: ${a.access.email}\nContraseña: ${a.access.password}\nPerfil: ${a.access.profile}${a.access.pin ? `\nPIN: ${a.access.pin}` : ""}\nVence: ${fdate(a.expiresAt)}`;
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
  const svcRow = (a, withClient) => `<div class="svc"><div class="top"><div class="who"><span class="mini" style="background:${esc(product(a.productId)?.color ?? "#3984ff")}">${esc(a.product[0])}</span><div><b>${esc(a.product)}</b><br><small class="empty">${withClient ? esc(byId[a.customerId].name) + " · " : ""}${esc(a.access.profile)}</small></div></div>${dayPill(a.daysLeft)}</div>
    <div class="rbtns"><button class="sbtn sm pri" type="button" data-renew="${esc(a.assignmentId)}" data-method="balance">${icon("renew")}Renovar con saldo</button>
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
            <div class="rbtns"><button class="sbtn sm" type="submit">Guardar cambios</button><a class="sbtn sm" href="${waLink(c.phone, `Hola ${c.name.split(" ")[0]} 👋`)}" target="_blank" rel="noopener">${icon("wa")}Escribirle</a></div></form></details>`;
      }).join("") || `<p class="empty">${clients.length ? "Ningún cliente coincide con la búsqueda." : "Todavía no cargaste clientes. Agregalos abajo o al vender."}</p>`}</div>

    <form class="sbox sform" id="myPrices"><h2>Mi lista de precios</h2><p class="empty" style="margin:0">Poné a cuánto le vendés cada producto a tus clientes: te calculamos tu ganancia y te armamos la lista para mandar.</p>
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
const browser = (url, inner, cls = "") => `<div class="bw ${cls}"><div class="bw-bar"><i></i><i></i><i></i><span>${esc(url)}</span></div><div class="bw-body">${inner}</div></div>`;
const spark = (pts, color) => { const max = Math.max(...pts), w = 180, h = 46; return `<svg viewBox="0 0 ${w} ${h}" class="spark" aria-hidden="true"><polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" points="${pts.map((v, i) => `${(i / (pts.length - 1)) * w},${h - 4 - (v / max) * (h - 10)}`).join(" ")}"/></svg>`; };
const checks = (list) => `<ul class="pchk">${list.map((x) => `<li>${x}</li>`).join("")}</ul>`;

function directoryView(standalone) {
  const pg = S.data.program;
  if (!pg) return `<p class="skeleton">Cargando…</p>`;
  const q = (S.data.dq ?? "").toLowerCase().trim();
  const list = pg.shops.filter((x) => !q || `${x.title} ${x.tagline} ${x.tags.join(" ")}`.toLowerCase().includes(q));
  const head = standalone
    ? `<section class="dhero"><span class="pill"><i></i>Directorio de tiendas</span><h1>Explorá las tiendas de <span>nuestros revendedores</span></h1><p>Cada una con su marca, sus precios y atención directa por WhatsApp.</p>`
    : `<section class="psec"><div class="peyebrow">Ya están vendiendo</div><div class="psplit"><h2>Explorá las tiendas de nuestros revendedores</h2><p>Cada revendedor arma la suya en minutos. Así se ven:</p></div>`;
  return `${head}${pg.shops.length > 3 || standalone ? `<label class="dsearch"><input id="dq" placeholder="Buscar tienda por nombre o categoría…" value="${esc(S.data.dq ?? "")}" aria-label="Buscar tienda">${icon("arrow")}</label>` : ""}</section>
    <section class="dlist">${list.map((x) => {
      loadFont(x.headingFont);
      const vars = `--pb:${esc(x.backgroundColor || "#0b0b14")};--pa:${esc(x.accentColor || "#7c5cff")};--pa2:${esc(x.accent2Color || x.accentColor || "#00d4ff")};--pf:${fontStack(x.headingFont)}`;
      return `<a class="drow" href="/r/${esc(x.slug)}" style="${vars}">
        <span class="dlogo">${x.hasLogo ? `<img src="/api/shops/${esc(x.slug)}/logo" alt="">` : `<i>${esc(x.title[0])}</i>`}</span>
        <span class="dban">${x.hasBanner ? `<img src="/api/shops/${esc(x.slug)}/banner" alt="Portada de ${esc(x.title)}" loading="lazy">` : `<b>${esc(x.title)}</b>`}</span>
        <span class="dinfo"><b>${esc(x.title)}</b>${x.tagline ? `<small>${esc(x.tagline)}</small>` : ""}<span class="dtags">${x.tags.map((t) => `<em>${esc(t)}</em>`).join("")}</span><span class="dgo">Visitar tienda →</span></span></a>`;
    }).join("") || `<p class="empty" style="text-align:center">${pg.shops.length ? "Ninguna tienda coincide con la búsqueda." : "Pronto vas a ver acá las tiendas de nuestros revendedores."}</p>`}</section>`;
}

function programView() {
  const pg = S.data.program;
  if (!pg) return `<p class="skeleton">Cargando…</p>`;
  const wa = pg.whatsapp ? waLink(pg.whatsapp, "Hola, quiero ser revendedor de " + pg.storeName) : null;
  const want = (cls = "pcta") => (wa ? `<a class="${cls}" href="${wa}" target="_blank" rel="noopener">Quiero ser revendedor</a>` : "");
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
      <span class="pill"><i></i>Programa de revendedores de ${esc(pg.storeName)}</span>
      <h1>Vendé streaming<br><span>con tu propia marca</span></h1>
      <p>Tu tienda online, precios de mayorista, panel de clientes y avisos de vencimiento. Nosotros ponemos el stock y la tecnología; vos ponés tu nombre.</p>
      <div class="pbtns2">${want()}<a class="pghost" href="/tiendas" data-s="tiendas">Explorar tiendas</a></div>
      <div class="pscroll">deslizá</div></section>

    <section class="psec"><div class="peyebrow">Por dentro</div><div class="psplit"><h2>Todo tu negocio<br>en una sola pantalla</h2><p>Saldo, clientes, vencimientos y ventas del día, en la compu o en el celular. Así se ve tu panel de revendedor.</p></div>
      <div class="pshot">${browser(location.host + "/#clientes", `<div class="mk"><div class="mk-side">${["Vender", "Mis clientes", "Por vencer", "Mi página", "Mis precios", "Saldo"].map((t, i) => `<span class="${i === 1 ? "on" : ""}">${t}</span>`).join("")}</div>
          <div class="mk-main"><b class="mk-t">Mi panel de revendedor</b><div class="mk-kpi">${[["Mi saldo", "Bs 420"], ["Clientes", "38"], ["Activos", "52"], ["Vencen en 7 días", "6"]].map(([a, b]) => `<div><small>${a}</small><b>${b}</b></div>`).join("")}</div>
          ${[["Ana P.", ex, "Vence en 2 d", "w"], ["Luis C.", sample[1]?.name ?? "Spotify", "Vence en 5 d", "w"], ["María Q.", sample[2]?.name ?? "Disney+", "Vence en 21 d", "o"], ["Jorge R.", ex, "Vence en 28 d", "o"]].map(([n, pr, d, k]) => `<div class="mk-row"><span>${esc(n)}</span><span>${esc(pr)}</span><em class="${k}">${d}</em><i>Renovar</i></div>`).join("")}</div></div>`)}
        <div class="fcard f1"><small>GANANCIA · ESTE MES</small><b>Bs 1.240 <em>+22%</em></b>${spark([3, 4, 3.5, 5, 4.8, 6.5, 6, 8], "var(--s-ok)")}</div>
        <div class="fcard f2"><small>RECORDATORIOS HOY</small><b>6 clientes</b><span class="bars">${[3, 5, 4, 6, 5, 7, 9].map((h) => `<i style="height:${h * 4}px"></i>`).join("")}</span><small>4 ya renovaron</small></div>
        <div class="fcard f3"><b>Venta lista · ${esc(ex)}</b><small>Datos copiados para tu cliente</small></div></div>
      <p class="pnote">Imagen ilustrativa con datos de ejemplo.</p></section>

    <section class="pstats">${[[pg.stats.products, "productos para vender"], [pg.stats.categories, "categorías"], [pg.stats.shops || 12, pg.stats.shops ? (pg.stats.shops === 1 ? "tienda de revendedor" : "tiendas de revendedores") : "estilos de tienda"], ["24/7", "bot de WhatsApp"]]
      .map(([n, t]) => `<div><b>${esc(String(n))}</b><span>${t}</span></div>`).join("")}</section>

    <section class="psec"><div class="peyebrow">Lo que incluye</div><div class="psplit"><h2>Tres herramientas<br>que trabajan juntas</h2><p>Tu página, tu panel y el bot comparten los mismos datos: vendés en el panel, tu cliente aparece en tus recordatorios y el bot ya sabe cuándo vence.</p></div>
      <div class="prow"><div class="pvis">${browser(location.host + "/r/tu-tienda", `<div class="phones pmini">${mocks.map((t) => phoneMock(t, sample)).join("")}</div>`)}</div>
        <div class="ptxt"><span class="pnum">01</span><h3>Tu tienda con tu marca</h3><p>Elegís un estilo, subís tu logo y portada, ponés tus precios y compartís tu link. Tus clientes arman el pedido y te llega a tu WhatsApp.</p>
          ${checks(["12 estilos listos para arrancar", "Logo, portada, colores y letras", "Tus precios, no los nuestros", "Pedidos directo a tu WhatsApp", "Link propio: /r/tu-tienda", "Perfecta en el celular"])}</div></div>
      <div class="prow rev"><div class="pvis">${browser(location.host + "/#clientes", `<div class="mkdone"><b>✅ Venta lista: mandale estos datos a Ana</b><pre>*${esc(ex)}*\nCorreo: cliente01@correo.com\nContraseña: ••••••••\nPerfil: Perfil 3\nVence: 07/12/2026</pre><div><i>Copiar datos</i><i class="g">Mandar por WhatsApp</i></div></div>`)}</div>
        <div class="ptxt"><span class="pnum">02</span><h3>Panel de revendedor</h3><p>Vendés con tu saldo y la cuenta sale al instante. Tus clientes, sus servicios, notas y renovaciones, todo ordenado.</p>
          ${checks(["Venta y entrega en segundos", "Copiar o mandar datos por WhatsApp", "Renovar con un toque", "Clientes por vencer en 7 días", "Notas privadas por cliente", "Lista de precios con tu ganancia"])}</div></div>
      <div class="prow"><div class="pvis">${browser("WhatsApp", `<div class="mkchat"><span class="in">8</span><span class="out"><b>👥 Clientes por vencer (7 días)</b><br>• Ana P.: ${esc(ex)} · vence en 2 días<br>• Luis C.: ${esc(sample[1]?.name ?? "Spotify")} · vence en 5 días<br><br>Renovalos con tu saldo desde <b>Mis clientes</b> 🔗</span><span class="in">gracias!</span><span class="out">¡De nada! 🙌 Si necesitás algo más, escribí <b>menu</b>.</span></div>`)}</div>
        <div class="ptxt"><span class="pnum">03</span><h3>Bot y avisos por WhatsApp</h3><p>El bot de la tienda responde a toda hora. A vos te dice quién vence; a tus clientes, cómo pagar y renovar.</p>
          ${checks(["Atención 24/7", "Tus clientes por vencer (opción 8)", "Precios y stock al instante", "Pasa a una persona cuando hace falta"])}</div></div></section>

    ${pg.showPrices && pg.products.length ? `<section class="psec"><div class="peyebrow">Números reales</div><div class="psplit"><h2>Tu ganancia<br>en cada venta</h2><p>Precio de nuestra tienda al público contra tu precio de revendedor. Vos decidís a cuánto vender.</p></div>
      <div class="sbox pprices"><div class="pp-h"><span>Producto</span><span>Precio público</span><span>Tu precio</span><span>Ganás hasta</span></div>
      ${pg.products.map((p) => `<div class="pp-r"><span class="who"><span class="mini" style="background:${esc(p.color)}">${esc(p.name[0])}</span><b>${esc(p.name)}</b></span><span data-l="Público">${bs(p.public)}</span><span data-l="Tu precio"><b>${bs(p.reseller)}</b></span><span data-l="Ganás" class="pp-g">+${bs(p.public - p.reseller)}</span></div>`).join("")}
      <p class="empty" style="margin:0">“Ganás hasta” = vendiendo al mismo precio que la tienda, ${p_dur(pg.products)}.</p></div></section>` : ""}

    <section class="psec"><div class="peyebrow">Ventajas</div><div class="psplit"><h2>¿Por qué revender con nosotros?</h2><p>Lo que cambia en tu negocio desde el primer día.</p></div>
      <div class="pfeats">${feats.map(([i, t, d]) => `<div class="pfc"><span class="pfi">${icon(i)}</span><b>${t}</b><span>${d}</span></div>`).join("")}</div></section>

    <section class="psec"><div class="peyebrow">Tu estilo</div><div class="psplit"><h2>12 estilos para tu tienda</h2><p>Arrancás con uno y después cambiás todo: colores, fondo, tarjetas, letras, logo y portada.</p></div>
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
const LOOK_FIELDS = ["accentColor", "accent2Color", "backgroundColor", "bgStyle", "cardStyle", "fontFamily", "headingFont", "corners",
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
      <h2>3 · Colores</h2>
      <div class="rgrid">${color("accentColor", "Color principal", sh.accentColor)}${color("accent2Color", "Segundo color (degradados)", sh.accent2Color)}${color("backgroundColor", "Fondo", sh.backgroundColor)}</div>
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
        <label class="rwide">Texto del pie<input name="footerText" maxlength="120" value="${esc(sh.footerText ?? "")}" placeholder="Precios en bolivianos"></label></div>
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
    <div class="rpreview"><div class="sbox"><h2>Vista previa <span class="rbtns" style="margin-left:auto"><button class="sbtn sm" type="button" data-pv="pc">PC</button><button class="sbtn sm" type="button" data-pv="cel">Celular</button></span></h2>
      <div class="pvwrap" data-mode="${S.data.pv ?? "cel"}">${sh.saved ? `<iframe id="shopPreview" src="/r/${esc(sh.slug)}" title="Vista previa de tu página"></iframe>` : `<p class="empty" style="padding:20px">Elegí un estilo arriba o guardá para ver tu página acá.</p>`}</div></div></div>
    </div>

    <div class="sbox"><h2>Logo y portada</h2>
      <div class="rimgs"><form class="sform" id="shopLogo"><b>Logo</b>${sh.hasLogo ? `<img class="rlogo" src="/api/shops/${esc(sh.slug)}/logo?v=${Date.now() % 1e6}" alt="Tu logo">` : `<span class="empty">Sin logo: se ve la inicial de tu tienda.</span>`}
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen del logo"><div class="rbtns"><button class="sbtn sm pri" type="submit">${sh.hasLogo ? "Cambiar" : "Subir"} logo</button>${sh.hasLogo ? `<button class="sbtn sm" type="button" data-rmimg="logo">Quitar</button>` : ""}</div><small class="empty">Cuadrado, 512×512 ideal. Hasta 5 MB.</small></form>
      <form class="sform" id="shopBanner"><b>Portada</b>${sh.hasBanner ? `<img class="rbanner" src="/api/shops/${esc(sh.slug)}/banner?v=${Date.now() % 1e6}" alt="Tu portada">` : `<span class="empty">Sin portada: se ve una tarjeta con tus precios.</span>`}
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen de portada"><div class="rbtns"><button class="sbtn sm pri" type="submit">${sh.hasBanner ? "Cambiar" : "Subir"} portada</button>${sh.hasBanner ? `<button class="sbtn sm" type="button" data-rmimg="banner">Quitar</button>` : ""}</div><small class="empty">Horizontal, 1600×1000 ideal (tus flyers o un collage de plataformas).</small></form></div></div>`;
}

/** Lee el formulario del editor como objeto de estilo. */
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
function renderCart(msg = "") {
  const tot = cartTotal();
  const head = `<h2>Tu carrito<button class="x" type="button" data-close="1" aria-label="Cerrar">×</button></h2><div class="steps"><span class="on">1 · Carrito</span><span class="${S.step >= 2 ? "on" : ""}">2 · Pago</span><span class="${S.step >= 3 ? "on" : ""}">3 · Listo</span></div>${msg}`;
  if (S.step === 1) {
    $("#drawer").innerHTML = head + (S.cart.length
      ? S.cart.map((l, k) => { const p = product(l.productId); return `<div class="line"><div style="display:flex;gap:10px;align-items:center"><span class="mini" style="background:${esc(p.color)}">${esc(p.name[0])}</span><div><b>${esc(p.name)}</b><br><small class="empty">${bs(p.price)} · ${p.durationDays} días</small></div></div><div class="qty"><button type="button" data-dec="${k}" aria-label="Quitar uno">−</button>${l.qty}<button type="button" data-inc="${k}" aria-label="Sumar uno">+</button></div></div>`; }).join("")
        + `<div class="total"><span>Total</span><span>${bs(tot)}</span></div>${SLUG ? (S.settings.whatsapp ? `<a class="sbtn pri" href="${waLink(S.settings.whatsapp, `Hola, quiero pedir:\n${S.cart.map((l) => `• ${l.qty} × ${product(l.productId).name} (${bs(product(l.productId).price * l.qty)})`).join("\n")}\nTotal: ${bs(tot)}`)}" target="_blank" rel="noopener">${icon("wa")}Pedir por WhatsApp</a><p class="empty" style="margin:0">Te respondo por WhatsApp para coordinar el pago y pasarte tus accesos.</p>` : "") : `<button class="sbtn pri" type="button" data-step="2">Continuar al pago ${icon("arrow")}</button>`}`
      : `<p class="empty">Tu carrito está vacío.</p><button class="sbtn" type="button" data-close="1" data-s="catalogo">Ver catálogo</button>`);
    return;
  }
  if (!S.me?.loggedIn) {
    $("#drawer").innerHTML = head + `<p class="empty">Para pagar, primero entrá con tu número de WhatsApp. Tu carrito queda guardado.</p><button class="sbtn pri" type="button" data-login="1">Acceder</button><button class="sbtn" type="button" data-step="1">Volver</button>`;
    return;
  }
  const canBalance = S.me.balance >= tot;
  $("#drawer").innerHTML = head + `<form class="sform" id="checkout">
    <div class="total"><span>Total</span><span>${bs(tot)}</span></div>
    ${isReseller() ? `<label>Para quién es<select name="customerId"><option value="">Para mí</option>${(S.data.customers ?? []).map((c) => `<option value="${esc(c.id)}">${esc(c.name)}</option>`).join("")}</select></label>` : ""}
    <div class="pay"><label><input type="radio" name="pm" value="balance" ${canBalance ? "checked" : "disabled"}><span>Pagar con saldo<small>Tenés ${bs(S.me.balance)}. ${canBalance ? "Entrega al instante." : "No alcanza para este pedido."}</small></span></label>
    <label><input type="radio" name="pm" value="qr" ${canBalance ? "" : "checked"}><span>QR + comprobante<small>Revisamos el pago en 10–30 minutos.</small></span></label></div>
    <div id="qrPart" style="display:grid;gap:12px" ${canBalance ? "hidden" : ""}>${qrBlock()}<label>Comprobante (foto o PDF)<input type="file" name="file" accept="image/*,application/pdf"></label><label>Número de operación<input name="ref" placeholder="Ej.: 123456789"></label></div>
    <button class="sbtn pri" type="submit">Finalizar pedido</button><button class="sbtn" type="button" data-step="1">Volver</button></form>`;
}

async function submitCheckout(form) {
  const btn = form.querySelector('[type="submit"]');
  const pm = form.pm.value;
  btn.disabled = true;
  btn.textContent = "Procesando…";
  try {
    let file, ref;
    if (pm === "qr") {
      ref = form.ref.value.trim();
      if (!form.file.files[0] || !ref) throw new Error("Subí la foto del comprobante y escribí el número de operación");
      file = await fileToBase64(form.file.files[0]);
    }
    const order = await api("POST", "/api/orders", {
      items: S.cart.map((l) => ({ productId: l.productId, qty: l.qty })), paymentMethod: pm,
      customerId: form.customerId?.value || undefined, idempotencyKey: S.checkoutKey,
    });
    let final = order;
    if (pm === "qr") {
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
function openLogin(step = "phone", phone = "", msg = "") {
  $("#drawer").hidden = true;
  const st = S.settings;
  const body = {
    phone: `<label>Tu número de WhatsApp<input name="phone" required inputmode="tel" value="${esc(phone || "+591 ")}" autocomplete="tel"></label><button class="sbtn pri" type="submit">Recibir código</button>`,
    name: `<p class="empty">Es tu primera compra. ¿Cómo te llamás?</p><input type="hidden" name="phone" value="${esc(phone)}"><label>Nombre<input name="name" required autocomplete="name"></label><label class="chk"><input type="checkbox" name="consent" checked> Acepto recibir avisos de pedidos y vencimientos por WhatsApp.</label><button class="sbtn pri" type="submit">Recibir código</button>`,
    code: `<p class="empty">Te mandamos un código de 6 números por WhatsApp a ${esc(phone)}.</p><input type="hidden" name="phone" value="${esc(phone)}"><label>Código<input name="code" required inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label><button class="sbtn pri" type="submit">Entrar</button>`,
    link: `<p class="empty">Por ahora el ingreso es con un link personal que te manda la tienda.</p>${st.whatsapp ? `<a class="sbtn pri" href="${waLink(st.whatsapp, `Hola, quiero mi link de acceso a ${st.storeName}. Mi número es ${phone}`)}" target="_blank" rel="noopener">Pedir mi link por WhatsApp</a>` : `<p class="empty">Escribile a la tienda para pedirlo.</p>`}`,
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
    if (step === "phone" || step === "name") {
      const r = await api("POST", "/api/auth/customer/request-code", step === "name" ? { phone, name: form.name.value, whatsappConsent: form.consent.checked } : { phone });
      if (r.needsName) return openLogin("name", phone);
      return openLogin("code", phone);
    }
    if (step === "code") {
      await api("POST", "/api/auth/customer/verify", { phone, code: form.code.value });
      closeAll();
      toast("¡Bienvenido!");
      await refresh();
      if (S.cart.length) { openDrawer(); S.step = 2; renderCart(); }
    }
  } catch (e) {
    if (e.code === "OTP_DISABLED") return openLogin("link", phone);
    openLogin(step === "code" ? "code" : step, phone, `<div class="err">${esc(e.message)}</div>`);
  }
}

/** Link de acceso: /#acceso=TOKEN */
async function useAccessLink() {
  const m = location.hash.match(/^#acceso=([\w-]+)$/);
  if (!m) return;
  history.replaceState(null, "", location.pathname + "#cuentas");
  try {
    const r = await api("POST", "/api/auth/customer/link", { token: m[1] });
    toast(`¡Hola, ${r.name.split(" ")[0]}! Ya entraste.`);
  } catch (e) {
    toast(e.message);
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
  if (d.cart) return openDrawer();
  if (d.copy) return copyText(d.copy);
  if (d.rclear) { S.data.lastSale = []; return render(); }
  if (d.rtab) { S.data.rtab = d.rtab; return render(); }
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
    if ((l?.qty ?? 0) >= p.available) return toast("No hay más unidades disponibles");
    l ? l.qty++ : S.cart.push({ productId: d.add, qty: 1 });
    saveCart(); closeAll(); render();
    return toast(`${p.name} agregado al carrito`);
  }
  if (d.det) {
    const p = product(d.det);
    $("#modal").innerHTML = `<div role="dialog" aria-modal="true"><div class="pimg" style="--c:${esc(p.color)}"><span class="tag">${esc(p.category)}</span><span class="lt" style="background:${esc(p.color)}">${esc(p.name[0])}</span></div><h2 style="font-size:24px;font-weight:900">${esc(p.name)}</h2><p class="empty">${esc(p.description)}</p>
      <dl class="cred" style="margin:0"><div><dt>Modalidad</dt><dd>${esc(kindText(p.kind))}</dd></div><div><dt>Duración</dt><dd>${p.durationDays} días</dd></div><div><dt>Entrega</dt><dd>${SLUG ? "Por WhatsApp" : "En Mis cuentas"}</dd></div><div><dt>Disponibles</dt><dd>${p.available}</dd></div></dl>
      <div class="price">${bs(p.price)}<small>/ ${p.durationDays} días</small></div><div class="pbtns"><button class="sbtn" type="button" data-close="1">Cerrar</button><button class="sbtn pri" type="button" data-add="${esc(p.id)}" ${p.available ? "" : "disabled"}>Añadir +</button></div></div>`;
    $("#modal").hidden = false; $("#scrim").hidden = false;
    return;
  }
  if (d.inc) { const l = S.cart[d.inc]; if (l.qty < product(l.productId).available) l.qty++; else toast("No hay más unidades"); saveCart(); renderCart(); return render(); }
  if (d.dec) { if (--S.cart[d.dec].qty <= 0) S.cart.splice(d.dec, 1); saveCart(); renderCart(); return render(); }
  if (d.step) {
    S.step = +d.step;
    if (S.step === 2 && isReseller() && !S.data.customers) S.data.customers = await api("GET", "/api/me/customers").catch(() => []);
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

document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.name === "pm") { const qr = t.value === "qr"; $("#qrPart").hidden = !qr; }
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

let qTimer;
document.addEventListener("input", (ev) => {
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

window.addEventListener("hashchange", () => { if (location.hash.startsWith("#acceso=")) useAccessLink().then(refresh); else { const v = location.hash.slice(1); if (v !== S.view) setView(v); } });

(async () => {
  if (SLUG) {
    S.view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
    return refresh();
  }
  await useAccessLink();
  const path = location.pathname.replace(/\/+$/, "");
  S.view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : path === "/revendedores" ? "revendedores" : path === "/tiendas" ? "tiendas" : "inicio";
  await refresh();
})();
