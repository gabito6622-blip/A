// Tienda Gabriel Store conectada al servidor.
import { api, $, $$, esc, bs, toCents, fdate, daysLeft, icon, toast, fileToBase64, waLink, newKey, STATUS_TEXT, KIND_TEXT } from "/common.js";

const S = { me: null, settings: null, catalog: [], cart: [], view: "inicio", cat: "Todos", q: "", step: 1, data: {} };
const VIEWS = ["inicio", "catalogo", "cuentas", "codigos", "recargas", "clientes"];

try { S.cart = JSON.parse(localStorage.getItem("gs-cart") || "[]"); } catch { S.cart = []; }
const saveCart = () => { try { localStorage.setItem("gs-cart", JSON.stringify(S.cart)); } catch { /* sin almacenamiento */ } };
const product = (id) => S.catalog.find((p) => p.id === id);
const cartTotal = () => S.cart.reduce((s, l) => s + (product(l.productId)?.price ?? 0) * l.qty, 0);
const isReseller = () => S.me?.role === "reseller";

/* ---------------- carga ---------------- */
async function loadBase() {
  [S.settings, S.me, S.catalog] = await Promise.all([api("GET", "/api/settings"), api("GET", "/api/me"), api("GET", "/api/catalog")]);
  if (S.me.kind === "staff") S.me = { loggedIn: false, staff: true };
  // Saca del carrito lo que ya no existe.
  S.cart = S.cart.filter((l) => product(l.productId));
  applyLook(S.settings);
  document.title = S.settings.storeName;
  $("#storeName").textContent = S.settings.storeName;
  $("#footName").textContent = `© ${S.settings.storeName} · ${S.settings.footerText || "Precios en bolivianos"}`;
  const st = S.settings;
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
const FONTS = { inter: "Inter", poppins: "Poppins", montserrat: "Montserrat", nunito: "Nunito" };
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
    r.setProperty("--s-sky", mix(ac, "#000000", 0.18));
    r.setProperty("--s-chip", mix(ac, "#000000", 0.35));
  } else {
    r.setProperty("--s-card", mix(bg, "#ffffff", 0.05));
    r.setProperty("--s-card2", mix(bg, "#ffffff", 0.09));
    r.setProperty("--s-hover", mix(bg, "#ffffff", 0.12));
    r.setProperty("--s-line", mix(bg, "#ffffff", 0.17));
    for (const k of ["--s-ink", "--s-muted", "--s-ok", "--s-warn", "--s-bad"]) r.removeProperty(k);
    r.setProperty("--s-sky", mix(ac, "#ffffff", 0.35));
    r.setProperty("--s-chip", mix(ac, "#ffffff", 0.6));
  }
  r.setProperty("--s-blue", ac);
  document.documentElement.style.colorScheme = light ? "light" : "dark";
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
  const fam = FONTS[st.fontFamily];
  if (fam && !document.getElementById("gs-font-" + st.fontFamily)) {
    const l = Object.assign(document.createElement("link"), { rel: "stylesheet", id: "gs-font-" + st.fontFamily, href: `https://fonts.googleapis.com/css2?family=${fam}:wght@400;500;600;700;800;900&display=swap` });
    document.head.append(l);
  }
  r.setProperty("--f-shop", st.fontFamily === "system" ? "system-ui,-apple-system,'Segoe UI',Roboto,sans-serif" : `'${fam ?? "Inter"}',system-ui,sans-serif`);
  const shop = document.getElementById("shop");
  if (shop) shop.dataset.corners = st.corners || "round";
  const mark = $("#logoMark");
  mark.outerHTML = st.hasLogo ? `<img id="logoMark" src="/api/settings/logo?v=${Date.now() % 1e6}" alt="">` : `<i id="logoMark">${esc((st.storeName || "G")[0])}</i>`;
  const ann = $("#announce");
  ann.textContent = st.announcement || "";
  ann.hidden = !st.announcement;
}

async function loadPrivate() {
  if (!S.me?.loggedIn) return;
  const [services, orders] = await Promise.all([api("GET", "/api/me/services"), api("GET", "/api/me/orders")]);
  S.data.services = services;
  S.data.orders = orders;
  if (S.view === "codigos") S.data.codes = await api("GET", "/api/me/codes");
  if (S.view === "recargas") S.data.ledger = await api("GET", "/api/me/ledger");
  if (S.view === "clientes" && isReseller()) [S.data.customers, S.data.prices] = await Promise.all([api("GET", "/api/me/customers"), api("GET", "/api/me/prices")]);
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
  $("#navCli").hidden = $("#bnavCli").hidden = !isReseller();
  $("#bnavSaldo").hidden = isReseller();
  $("#accName").textContent = S.me?.loggedIn ? `${S.me.name.split(" ")[0]} · ${bs(S.me.balance)}` : "Acceder";
  const pub = S.catalog;
  const services = S.data.services ?? [];
  const V = {
    inicio: () => `<section class="hero"><div style="display:grid;min-width:0">
        ${S.settings.heroChip ? `<span class="chip">${esc(S.settings.heroChip)}</span>` : ""}
        <h1>${esc(S.settings.heroTitle)}<br><span>${esc(S.settings.heroHighlight)}</span></h1>
        <p>${esc(S.settings.heroText)}</p>
        <div style="display:flex;gap:10px;flex-wrap:wrap"><button class="sbtn pri" type="button" data-s="catalogo">Explorar productos ${icon("arrow")}</button><button class="sbtn" type="button" data-s="cuentas">Consultar mis servicios</button></div>
        <div class="ticks">${(S.settings.heroTicks || "").split(",").map((x) => x.trim()).filter(Boolean).slice(0, 3).map((x) => `<span>${esc(x)}</span>`).join("")}</div></div>
      <div class="mock" aria-hidden="true"><div class="t">${esc(S.settings.storeName)} · tu resumen</div>
        <div class="mgrid"><div>Catálogo<b>${pub.length}</b>productos</div><div>Mis servicios<b>${S.me?.loggedIn ? services.length : "—"}</b>activos</div><div>Mi saldo<b>${S.me?.loggedIn ? bs(S.me.balance) : "—"}</b>para comprar al instante</div><div>Carrito<b>${S.cart.length}</b>productos</div></div></div></section>
      ${pub.length ? `<section style="display:grid;gap:18px"><div class="sec-h"><div><span class="chip">Catálogo digital</span><h2>Servicios populares</h2></div><button class="sbtn" type="button" data-s="catalogo">Ver todos ${icon("arrow")}</button></div>
      <div class="pgrid">${pub.slice(0, 4).map(card).join("")}</div></section>` : `<div class="sbox"><h2>Pronto</h2><p class="empty">Estamos cargando los productos. Volvé en un rato.</p></div>`}
      <section class="sbox" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr));gap:18px">
        ${[["1", "Elegí", "Agregá al carrito lo que necesitás."], ["2", "Pagá", "Con QR y comprobante, o al instante con tu saldo."], ["3", "Recibí", "Tus accesos aparecen en Mis cuentas y te avisamos por WhatsApp."]]
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
    clientes: () => !isReseller() ? needLogin("tus clientes") : resellerView(),
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
        + `<div class="total"><span>Total</span><span>${bs(tot)}</span></div><button class="sbtn pri" type="button" data-step="2">Continuar al pago ${icon("arrow")}</button>`
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
      <dl class="cred" style="margin:0"><div><dt>Modalidad</dt><dd>${esc(kindText(p.kind))}</dd></div><div><dt>Duración</dt><dd>${p.durationDays} días</dd></div><div><dt>Entrega</dt><dd>En Mis cuentas</dd></div><div><dt>Disponibles</dt><dd>${p.available}</dd></div></dl>
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
  if (t.id === "consent") {
    try { await api("PUT", "/api/me/consent", { whatsapp: t.checked }); toast(t.checked ? "Vas a recibir avisos por WhatsApp" : "Ya no vas a recibir avisos por WhatsApp"); } catch (e) { t.checked = !t.checked; toast(e.message); }
  }
});

let qTimer;
document.addEventListener("input", (ev) => {
  const pi = ev.target.closest?.("#myPrices input[data-cost]");
  if (pi) {
    const v = pi.value.trim() ? toCents(pi.value) : null, out = $(`[data-profit="${pi.name.slice(2)}"]`);
    const pr = v === null || Number.isNaN(v) ? null : v - +pi.dataset.cost;
    out.innerHTML = pr === null ? "" : `<b style="color:${pr < 0 ? "var(--s-bad)" : "var(--s-ok)"}">${pr < 0 ? "−" : "+"}${bs(Math.abs(pr))}</b>`;
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
window.addEventListener("hashchange", () => { if (location.hash.startsWith("#acceso=")) useAccessLink().then(refresh); else { const v = location.hash.slice(1); if (v !== S.view) setView(v); } });

(async () => {
  await useAccessLink();
  S.view = VIEWS.includes(location.hash.slice(1)) ? location.hash.slice(1) : "inicio";
  await refresh();
})();
