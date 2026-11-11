// Panel del vendedor conectado al servidor.
import { api, $, $$, esc, bs, setCurrency, currencySym, lookColors, contrastNote, softwareNotice, toCents, fdate, fdt, daysLeft, icon, toast, fileToBase64, waLink, newKey, brandBadge, enhanceFiles, STATUS_TEXT, KIND_TEXT, FONT_LIST, BG_LIST, CARD_LIST, LAYOUT_LIST, THEMES, themeSwatch } from "/common.js";
import { comoVanView } from "/panel-comovan.js";
import { winbackView, winbackHomeCard } from "/winback.js";
import { resellerCountryRow } from "/country.js";
import { usd, wal, orderTotal, owedText, usdChip, currencySelect, listHint } from "/usd.js";

const P = { me: null, view: "inicio", tab: {}, theme: "light", settings: null };
try { P.theme = localStorage.getItem("gs-panel-theme") || "light"; } catch { /* sin almacenamiento */ }

const isOwner = () => P.me?.role === "owner";
const canReview = () => P.me?.role === "owner" || P.me?.role === "admin";
// Etiquetas de cliente: texto + clase de color (ver panel.css .tagp-*).
const CTAGS = { vip: ["⭐ VIP", "vip"], moroso: ["⚠️ Moroso", "moroso"], nuevo: ["🆕 Nuevo", "nuevo"], mayorista: ["📦 Mayorista", "may"], regalo: ["🎁 Regalo", "reg"] };
const tagChip = (t) => (t && CTAGS[t]) ? `<span class="tagp tagp-${CTAGS[t][1]}">${CTAGS[t][0]}</span>` : "";

const MENU = [
  ["inicio", "home", "Inicio"], ["vender", "cart", "Vender"], ["control", "grid", "Control de alquileres"], ["renovar", "renew", "Renovar"], ["dashboard", "monitor", "Dashboard", "review"],
  ["finanzas", "coins", "Finanzas", "owner"],
  ["fiado", "flag", "Fiado (lo que te deben)"],
  ["quevuelvan", "coins", "💸 Que vuelvan"],
  ["notificaciones", "bell", "Notificaciones"],
  ["fallas", "help", "Fallas reportadas"],
  ["reubicar", "renew", "Reubicar", "review"],
  ["aprobacion", "approve", "Aprobación de Ventas"], ["recordatorios", "bell", "Recordatorios"], ["codigos", "mailbox", "Panel de códigos", "owner"],
  ["G", "box", "Productos", [["cuentas", "Cuentas"], ["carga", "Carga de Cuentas"], ["productos", "Productos y precios"], ["cupones", "Cupones de descuento"]], "review"],
  ["revendedores", "userplus", "Revendedores"], ["comovan", "users", "📈 Cómo van", "review"], ["proveedores", "truck", "Proveedores", "review"], ["clientes", "users", "Clientes"], ["excel", "ext", "Excel: exportar e importar"], ["whatsapp", "wa", "WhatsApp"],
  ["apariencia", "sun", "Apariencia de la tienda", "review"], ["usuarios", "userplus", "Usuarios", "owner"], ["auditoria", "history", "Auditoría", "owner"], ["configuracion", "gear", "Configuración"], ["ayuda", "help", "Guía"],
];
const TITLE = { inicio: ["home", "Inicio"], control: ["grid", "Control"], vender: ["cart", "Vender"], renovar: ["renew", "Renovar"], dashboard: ["monitor", "Dashboard"], finanzas: ["coins", "Finanzas"], fiado: ["flag", "Fiado"], quevuelvan: ["coins", "💸 Que vuelvan"], fallas: ["help", "Fallas reportadas"], notificaciones: ["bell", "Notificaciones"], reubicar: ["renew", "Reubicar perfiles"], aprobacion: ["approve", "Aprobar pagos"], recordatorios: ["bell", "Recordatorios"], codigos: ["mailbox", "Panel de códigos"], revendedores: ["userplus", "Revendedores"], comovan: ["users", "Cómo van tus revendedores"], cuentas: ["user", "Cuentas"], carga: ["box", "Carga de Cuentas"], productos: ["box", "Productos y precios"], cupones: ["tag", "Cupones"], proveedores: ["truck", "Proveedores"], clientes: ["users", "Clientes"], excel: ["ext", "Excel"], whatsapp: ["wa", "WhatsApp"], usuarios: ["userplus", "Usuarios del panel"], apariencia: ["sun", "Apariencia"], auditoria: ["history", "Auditoría"], configuracion: ["gear", "Configuración"], ayuda: ["help", "Guía del panel"] };

const KLABEL_P = { login: "🔓 Inicio de sesión", hogar: "🏠 Actualizar hogar", temporal: "⏱️ Acceso temporal", verificacion: "🛡️ Verificación", otro: "✉️ Código" };
const pill = (t, k) => `<span class="pp pp-${k}">${esc(t)}</span>`;
const orderPill = (s) => pill(STATUS_TEXT[s] ?? s, { fulfilled: "ok", payment_review: "warn", awaiting_payment: "mute", rejected: "bad", expired: "bad", cancelled: "mute" }[s] ?? "mute");
/** En el celular cada fila se vuelve una tarjeta: a cada celda le pone el nombre de su columna. */
const labelRow = (row, head) => {
  let i = 0;
  return row.replace(/<td(\s|>)/g, (m, after) => {
    const label = head[i++] ?? "";
    return label ? `<td data-label="${esc(label)}"${after === ">" ? ">" : " "}` : m;
  });
};
const table = (head, rows, empty = "No hay datos todavía.") => rows.length
  ? `<div class="scroll rtbl"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.map((r) => labelRow(r, head)).join("")}</tbody></table></div>`
  : `<div class="emptybox">${esc(empty)}</div>`;
const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? "selected" : ""}>${esc(t)}</option>`;
/** Valor para <input type="date"> con la fecha local (con toISOString se corría un día en Bolivia). */
const dateInput = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };

/** Link de acceso + página + mensaje de WhatsApp para un revendedor. */
async function resellerKit(id, name, phone, slug, pinIn) {
  const pin = pinIn ?? (await api("POST", `/api/admin/customers/${id}/login-pin`, {})).pin;
  const plat = P.settings?.platformName || "GaboHub";
  const page = slug ? `${location.origin}/r/${slug}` : "";
  const base = `¡Hola ${name.split(" ")[0]}! 👋 Ya sos revendedor de ${plat}.\n\n👉 Entrá acá: ${location.origin}/hub\n📱 Tu número: ${phone}\n🔑 Tu PIN: ${pin}\n\nAhí ves tus precios, comprás con saldo o QR, y ves tus cuentas y códigos.`;
  const msg = page
    ? `${base}\n\n🛍️ Tu página para tus clientes:\n${page}\n\n(Guardá tu PIN. Lo podés cambiar adentro.)`
    : `${base}\n\n(Guardá tu PIN. Lo podés cambiar adentro.)`;
  return { name, phone, url: `${location.origin}/hub`, page: page || "Solo panel (sin página)", msg, pin };
}

/** Mini-guía de uso lista para mandar por WhatsApp a un revendedor. */
function guideMsg(name, plat, origin, slug, pageAllowed) {
  const n = (name || "").split(" ")[0] || "";
  const page = pageAllowed && slug ? `${origin}/r/${slug}` : "";
  return `📖 *Guía rápida de ${plat}* — ¡Hola ${n}! 👋\n\n`
    + `*1) Cómo entrar*\n`
    + `• Entrá a: ${origin}/hub\n`
    + `• Poné tu *número* y tu *PIN* (o tu correo y contraseña si te la diste).\n\n`
    + `*2) Qué vas a ver*\n`
    + `• 💲 *Precios*: comprás cuentas con tu saldo o por QR. Apenas pagás, te llega la cuenta.\n`
    + `• 📦 *Mis cuentas*: todo lo que compraste, con sus vencimientos.\n`
    + `• 👥 *Mis clientes*: cargás a quién le revendés y le mandás el aviso por WhatsApp con un toque.\n`
    + (page
        ? `• 🛍️ *Mi página*: tu tienda propia para tus clientes.\n\n`
          + `*3) Armá tu página*\n`
          + `• Tu link es: ${page}\n`
          + `• En *Mi página* le ponés tu *logo*, tus *colores* y tus *precios* (te sugiere un precio con tu ganancia; lo cambiás como quieras).\n`
          + `• Cuando esté lista, tocás *Publicar* y ya la podés compartir.\n\n`
        : `\n`)
    + `*4) Saldo*\n`
    + `• Para comprar necesitás saldo. Me pedís una recarga y te la cargo; también podés pagar por QR en el momento.\n\n`
    + `Cualquier cosa me escribís por acá. 🚀`;
}

const mbBody = (f) => ({ id: f.dataset.id || undefined, kind: f.dataset.kind, address: f.address.value.trim(), host: f.host?.value.trim(), port: f.port?.value, user: f.user?.value.trim() || undefined,
  password: f.password.value, name: f.name.value.trim() || undefined, subjects: f.subjects.value.trim() || undefined, senders: f.senders.value.trim() });

/* ---------------- tema ---------------- */
function applyTheme() {
  const dark = P.theme === "dark" || (P.theme === "system" && matchMedia("(prefers-color-scheme: dark)").matches);
  $("#app").classList.toggle("dark", dark);
  document.body.style.background = dark ? "#0f141d" : "#eef1f6";
  $$("[data-th]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.th === P.theme));
}
matchMedia("(prefers-color-scheme: dark)").addEventListener("change", applyTheme);

/* ---------------- vistas ---------------- */
const V = {
  comovan: () => comoVanView(P.tab),
  quevuelvan: () => winbackView(),
  async dashboard() {
    const dd = Number(P.tab.dd ?? 30);
    const [d, set, products, accounts] = await Promise.all([api("GET", `/api/admin/dashboard?days=${dd}`), api("GET", "/api/settings"), api("GET", "/api/admin/products"), api("GET", "/api/admin/accounts")]);
    // Primeros pasos (jueguito): cada uno se marca solo en verde cuando está hecho.
    const pasos = [
      ["Creá tus productos", products.length > 0, "productos", "Crear producto"],
      ["Cargá tus cuentas (tu stock)", accounts.length > 0, "carga", "Cargar cuenta"],
      ["Subí tu QR de cobro", !!set.hasQr, "configuracion", "Subir QR"],
      ["Cargá el WhatsApp de la tienda", !!set.whatsapp, "configuracion", "Configurar"],
      ["Ponele nombre y logo a tu tienda", !!set.hasLogo, "apariencia", "Personalizar"],
    ];
    const hechos = pasos.filter((p) => p[1]).length;
    const k = d.kpi;
    const delta = (c, p) => {
      if (!p) return c ? `<em class="dl up">nuevo</em>` : `<em class="dl">—</em>`;
      const v = Math.round(((c - p) / p) * 100);
      return `<em class="dl ${v > 0 ? "up" : v < 0 ? "down" : ""}">${v > 0 ? "▲" : v < 0 ? "▼" : ""} ${Math.abs(v)}%</em>`;
    };
    const kpi = (label, val, sub, cls = "", go = "") => go ? `<button type="button" class="dk ${cls}" data-go="${go}"><span>${label}</span><b>${val}</b><small>${sub}</small></button>` : `<div class="dk ${cls}"><span>${label}</span><b>${val}</b><small>${sub}</small></div>`;
    const short = (c) => { const v = c / 100; return v >= 10000 ? (v / 1000).toFixed(0) + "k" : v >= 1000 ? (v / 1000).toFixed(1).replace(".0", "") + "k" : String(Math.round(v)); };
    // --- gráfico de ventas por día (barras apiladas) ---
    const S = d.series, mob = innerWidth < 640, W = mob ? 380 : 720, H = mob ? 200 : 220, pl = 34, pb = 24, pt = 10;
    const tot = S.map((x) => x.sales + x.renewals + x.topups);
    const max = Math.max(...tot, 100);
    const step = 10 ** Math.floor(Math.log10(max / 100 / 3 || 1)) * 100;
    const nice = Math.ceil(max / 3 / step) * step || 100;
    const top = nice * 3, bw = (W - pl) / S.length;
    const y = (v) => pt + (H - pt - pb) * (1 - v / top);
    const grid = [0, 1, 2, 3].map((i) => `<line x1="${pl}" x2="${W}" y1="${y(nice * i)}" y2="${y(nice * i)}" class="gl"/><text x="${pl - 6}" y="${y(nice * i) + 4}" class="ax" text-anchor="end">${short(nice * i)}</text>`).join("");
    const lblEvery = Math.ceil(S.length / (mob ? 4 : 7));
    const bars = S.map((x, i) => {
      const x0 = pl + i * bw + bw * 0.15, w = Math.max(bw * 0.7, 1);
      let acc = 0;
      const seg = [["sales", "c1"], ["renewals", "c2"], ["topups", "c3"]].map(([f, c]) => {
        if (!x[f]) return "";
        const r = `<rect x="${x0}" y="${y(acc + x[f])}" width="${w}" height="${y(acc) - y(acc + x[f])}" class="${c}"/>`;
        acc += x[f];
        return r;
      }).join("");
      const lab = (S.length - 1 - i) % lblEvery === 0 ? `<text x="${x0 + w / 2}" y="${H - 6}" class="ax" text-anchor="middle">${x.day.slice(8)}/${x.day.slice(5, 7)}</text>` : "";
      return `<g><title>${x.day.slice(8)}/${x.day.slice(5, 7)}: ${bs(tot[i])} (ventas ${bs(x.sales)}, renovaciones ${bs(x.renewals)}, recargas ${bs(x.topups)})</title><rect x="${pl + i * bw}" y="${pt}" width="${bw}" height="${H - pt - pb}" fill="transparent"/>${seg}</g>${lab}`;
    }).join("");
    const salesChart = `<svg viewBox="0 0 ${W} ${H}" class="chart" role="img" aria-label="Ingresos por día">${grid}${bars}</svg>`;
    // --- vencimientos próximos 14 días ---
    const U = d.upcoming, umax = Math.max(...U.map((x) => x.count), 1);
    const wd = ["dom", "lun", "mar", "mié", "jue", "vie", "sáb"];
    const upChart = `<div class="upc">${U.map((x, i) => { const dt = new Date(x.day); return `<div class="upd ${i === 0 ? "today" : ""}" title="${x.count} vencen · ${bs(x.amount)}"><i>${x.count || ""}</i><span style="height:${(x.count / umax) * 100}%" class="${i < 3 && x.count ? "hot" : ""}"></span><small>${i === 0 ? "hoy" : wd[dt.getDay()]}<br>${dt.getDate()}</small></div>`; }).join("")}</div>`;
    const upSum = U.reduce((s, x) => s + x.amount, 0), upCnt = U.reduce((s, x) => s + x.count, 0);
    // --- donut de servicios activos ---
    const A = d.activeByProduct, atot = A.reduce((s, x) => s + x.count, 0) || 1;
    const PAL = ["#3b82f6", "#10b981", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899", "#84cc16"];
    let ang = 0;
    const arcs = A.map((x, i) => {
      const f = x.count / atot, r = 15.915;
      const c = `<circle r="${r}" cx="21" cy="21" fill="none" stroke="${PAL[i % 8]}" stroke-width="6" stroke-dasharray="${f * 100} ${100 - f * 100}" stroke-dashoffset="${25 - ang}"><title>${esc(x.name)}: ${x.count}</title></circle>`;
      ang += f * 100;
      return c;
    }).join("");
    const donut = A.length ? `<div class="donut"><svg viewBox="0 0 42 42"><circle r="15.915" cx="21" cy="21" fill="none" class="ring" stroke-width="6"/>${arcs}<text x="21" y="21" class="dn">${k.activeServices}</text><text x="21" y="27.5" class="dt">activos</text></svg>
      <ul>${A.map((x, i) => `<li><i style="background:${PAL[i % 8]}"></i>${esc(x.name)}<b>${x.count}</b></li>`).join("")}</ul></div>` : `<div class="emptybox">Sin servicios activos.</div>`;
    // --- ingresos por producto ---
    const B = d.byProduct, bmax = Math.max(...B.map((x) => x.revenue), 1);
    // --- Resumen por servicio (ingresos por app: lo que entró, no la ganancia) ---
    const svcList = B.length ? `<div class="svclist">${B.map((x, i) => `<div class="svcrow"><span class="svcic" style="background:${PAL[i % 8]}">${esc((x.name[0] || "?").toUpperCase())}</span><div class="svcinfo"><b>${esc(x.name)}</b><small>${bs(x.revenue)} · ${x.units} venta(s)</small></div><div class="svcbar"><i style="width:${Math.max(4, (x.revenue / bmax) * 100)}%;background:${PAL[i % 8]}"></i></div></div>`).join("")}</div>` : `<div class="emptybox">Sin ventas en este período.</div>`;
    // --- Nivel de estrés (vencidos, por vencer, por cobrar, por revisar) ---
    const al = d.alerts;
    const sPts = al.overdue.count * 3 + al.due3.count * 2 + k.pendingReview * 2 + al.unpaid.count;
    const stress = Math.min(100, sPts * 4);
    const sl = stress < 20 ? ["Tranqui", "😌", "#10b981", "var(--ok)"] : stress < 45 ? ["Movido", "🙂", "#3b82f6", "var(--blue-text)"] : stress < 75 ? ["Cargado", "😅", "#f59e0b", "var(--warn)"] : ["Al límite", "🥵", "#ef4444", "var(--bad)"];
    const stressCard = `<section class="card stresscard"><div class="stresshead"><div><span class="stresscap">NIVEL DE ESTRÉS</span><h2 style="margin:2px 0 0">${sl[1]} ${sl[0]}</h2></div><b class="stresspct" style="color:${sl[3]}">${stress}%</b></div>
      <div class="stressbar"><i style="width:${Math.max(4, stress)}%;background:${sl[2]}"></i></div>
      <div class="stresswhy">${al.overdue.count ? `<button type="button" data-go="control"><b>${al.overdue.count}</b> vencidos</button>` : ""}${al.due3.count ? `<button type="button" data-go="control"><b>${al.due3.count}</b> por vencer</button>` : ""}${k.pendingReview ? `<button type="button" data-go="aprobacion"><b>${k.pendingReview}</b> por revisar</button>` : ""}${al.unpaid.count ? `<button type="button" data-hgo="control:nopay"><b>${al.unpaid.count}</b> por cobrar</button>` : ""}${sPts === 0 ? `<span class="muted">Todo al día ✨ Relajá.</span>` : ""}</div></section>`;
    // --- Atajos de alerta (vencidos / por vencer / sin cobrar) ---
    const alertCards = `<div class="dalerts">
      <button type="button" class="dalert bad" data-go="control"><span class="aic">📅</span><div class="atx"><b>${al.overdue.count} perfil(es) ya vencieron</b><small>${bs(al.overdue.amount)} por renovar · Ver</small></div><span class="ar">${icon("arrow")}</span></button>
      <button type="button" class="dalert warn" data-go="control"><span class="aic">⏰</span><div class="atx"><b>${al.due3.count} vencen en los próximos 3 días</b><small>${bs(al.due3.amount)} por renovar · Ver</small></div><span class="ar">${icon("arrow")}</span></button>
      <button type="button" class="dalert blue" data-hgo="control:nopay"><span class="aic">💳</span><div class="atx"><b>${al.unpaid.count} con pago pendiente</b><small>${bs(al.unpaid.amount)} por cobrar · Ver</small></div><span class="ar">${icon("arrow")}</span></button></div>`;
    // --- Ingresos por mes (12 meses), curva suave estilo Netxly ---
    const M = d.months, mtot = M.reduce((s, x) => s + x.revenue, 0), mmax = Math.max(...M.map((x) => x.revenue), 1);
    // El "menor mes" no cuenta los meses en que la tienda todavía no vendía.
    const M0 = M.slice(Math.max(0, M.findIndex((x) => x.revenue > 0)));
    const best = M.reduce((a, b) => (b.revenue > a.revenue ? b : a), M[0]), worst = M0.reduce((a, b) => (b.revenue < a.revenue ? b : a), M0[0]);
    const MW = mob ? 360 : 680, MH = mob ? 180 : 210, mpl = 6, mpb = 22, mpt = 12;
    const mX = (i) => mpl + (MW - mpl * 2) * (i / (M.length - 1)), mY = (v) => mpt + (MH - mpt - mpb) * (1 - v / mmax);
    const mpts = M.map((x, i) => [mX(i), mY(x.revenue)]);
    let mline = `M ${mpts[0][0].toFixed(1)} ${mpts[0][1].toFixed(1)}`;
    for (let i = 1; i < mpts.length; i++) { const [x0, y0] = mpts[i - 1], [x1, y1] = mpts[i], cx = (x0 + x1) / 2; mline += ` C ${cx.toFixed(1)} ${y0.toFixed(1)} ${cx.toFixed(1)} ${y1.toFixed(1)} ${x1.toFixed(1)} ${y1.toFixed(1)}`; }
    const mfill = `${mline} L ${mX(M.length - 1).toFixed(1)} ${mY(0)} L ${mX(0).toFixed(1)} ${mY(0)} Z`;
    const monthChart = `<svg viewBox="0 0 ${MW} ${MH}" class="mchart" role="img" aria-label="Ingresos por mes">
      <defs><linearGradient id="mg" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#22d3ee" stop-opacity="0.35"/><stop offset="1" stop-color="#22d3ee" stop-opacity="0"/></linearGradient></defs>
      <path d="${mfill}" fill="url(#mg)"/><path d="${mline}" fill="none" stroke="#22d3ee" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/>
      ${mpts.map((p, i) => `<g><circle cx="${p[0].toFixed(1)}" cy="${p[1].toFixed(1)}" r="2.6" fill="#0b1220" stroke="#22d3ee" stroke-width="2"><title>${esc(M[i].label)}: ${bs(M[i].revenue)}</title></circle><text x="${p[0].toFixed(1)}" y="${MH - 6}" class="ax" text-anchor="middle">${esc(M[i].label)}</text></g>`).join("")}</svg>`;
    const tag = (kd) => `<span class="pp pp-${kd === "topup" ? "ok" : kd === "renewal" ? "warn" : "mute"}">${KIND_TEXT[kd] ?? kd}</span>`;
    return `<div class="dhead"><div class="seg">${[7, 30, 90].map((n) => `<button type="button" data-tab="dd:${n}" aria-pressed="${dd === n}">${n} días</button>`).join("")}</div>
      <div class="big mini"><button type="button" data-go="carga" style="background:#4263eb"><span>${icon("userplus")}</span>Registrar cuentas</button><button type="button" data-go="vender" style="background:#087f5b"><span>${icon("cart")}</span>Vender</button><a href="/tienda/" target="_blank" rel="noopener" style="background:#6741d9"><span>👁️</span>Ver como cliente</a></div></div>
      ${hechos < pasos.length ? `<section class="card setupmini"><div class="inline" style="justify-content:space-between;gap:10px"><div><b>🚀 Te faltan ${pasos.length - hechos} paso(s) para estar listo</b><br><small class="muted">Completalos desde la Guía.</small></div><button class="pbtn sm blue" type="button" data-go="ayuda">Ver primeros pasos ${icon("arrow")}</button></div><div class="pgbar" style="margin-top:8px"><i style="width:${Math.round(hechos / pasos.length * 100)}%"></i></div></section>` : ""}
      <div class="dkpis">
        ${kpi(`Ingresos · ${dd} días`, bs(k.revenue), `${delta(k.revenue, k.prevRevenue)} vs. ${bs(k.prevRevenue)} antes`, "hero")}
        ${kpi("Pedidos", k.orders, `${delta(k.orders, k.prevOrders)} · ${k.renewals} renovaciones`)}
        ${kpi("Lo que te pagan por mes", bs(k.monthlyRecurring), `${k.activeServices} servicios · con el precio de quien paga`)}
        ${kpi("Recargas de saldo", bs(k.topups), owedText(k))}
        ${kpi("Vencidos / sin renovar", k.overdue, `${k.due7} vencen en 7 días`, k.overdue ? "bad" : "", "control")}
        ${kpi("Pagos por revisar", k.pendingReview, k.unpaid ? `${k.unpaid} alquileres sin pagar` : "todo al día", k.pendingReview ? "warn" : "", "aprobacion")}
        ${kpi("Clientes", k.customers, `${k.resellers} revendedores · +${k.newCustomers} nuevos`)}
      </div>
      ${stressCard}
      ${alertCards}
      <section class="card"><div class="mctop"><div><h2 style="margin:0">Ingresos por mes <small>12 meses</small></h2><p class="muted" style="margin:2px 0 0">Total del rango: <b>${bs(mtot)}</b></p></div>
        <div class="mcstats"><div class="up"><small>▲ MEJOR MES</small><b>${esc(best.label)} · ${bs(best.revenue)}</b></div><div class="down"><small>▼ MENOR MES</small><b>${esc(worst.label)} · ${bs(worst.revenue)}</b></div></div></div>${monthChart}</section>
      <section class="card"><h2>Ingresos por día <small>pasá el dedo o el mouse por una barra</small></h2>
        <div class="legend"><span><i class="c1"></i>Ventas</span><span><i class="c2"></i>Renovaciones</span><span><i class="c3"></i>Recargas</span></div>${salesChart}</section>
      <div class="dgrid">
        <section class="card"><h2>Vencen en los próximos 14 días <small>${upCnt} servicios · ${bs(upSum)} si todos renuevan</small></h2>${upChart}
          <button class="pbtn sm" type="button" data-go="control">Ver en el control ${icon("arrow")}</button></section>
        <section class="card"><h2>Servicios activos por producto</h2>${donut}</section>
      </div>
      <div class="dgrid">
        <section class="card"><h2>Resumen por servicio <small>lo que entró por app · ${dd} días</small></h2>${svcList}</section>
        <section class="card"><h2>Últimos movimientos</h2><div class="recent">${d.recent.length ? d.recent.map((o) => `<div><div><b>${esc(o.customer || "—")}</b><small>${esc(o.product)} · ${fdt(o.at)}</small></div><div>${tag(o.kind)}<b>${bs(o.total)}</b>${o.status !== "fulfilled" ? orderPill(o.status) : ""}</div></div>`).join("") : `<div class="emptybox">Sin movimientos.</div>`}</div></section>
      </div>
      <section class="card"><h2>${icon("users")}Tus mejores revendedores</h2>${table(["Revendedor", "Servicios", "Te paga por mes", `Compró (${dd} d)`, "Saldo", "Vencen 7 d"],
        d.resellers.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${r.services}</td><td>${bs(r.monthly)}</td><td>${bs(r.spent)}</td><td>${wal(r.balance, r.currency)}</td><td>${r.due7 ? `<span class="pp pp-warn">${r.due7}</span>` : "0"}</td></tr>`), "Todavía no tenés revendedores.")}</section>
      <section class="card helpcard"><div class="inline" style="justify-content:space-between"><div><b>📖 ¿Dudas con alguna pantalla?</b><br><small class="muted">La guía de qué sirve cada parte está en su propio lugar.</small></div><button class="pbtn sm" type="button" data-go="ayuda">Abrir la Guía ${icon("arrow")}</button></div></section>`;
  },
  async ayuda() {
    const [set, products, accounts] = await Promise.all([api("GET", "/api/settings"), api("GET", "/api/admin/products").catch(() => []), canReview() ? api("GET", "/api/admin/accounts").catch(() => []) : Promise.resolve([])]);
    const pasos = [
      ["Creá tus productos", products.length > 0, "productos", "Crear producto"],
      ["Cargá tus cuentas (tu stock)", accounts.length > 0, "carga", "Cargar cuenta"],
      ["Subí tu QR de cobro", !!set.hasQr, "configuracion", "Subir QR"],
      ["Cargá el WhatsApp de la tienda", !!set.whatsapp, "configuracion", "Configurar"],
      ["Ponele nombre y logo a tu tienda", !!set.hasLogo, "apariencia", "Personalizar"],
    ];
    const hechos = pasos.filter((p) => p[1]).length;
    const setupCard = hechos < pasos.length
      ? `<section class="card setupcard"><h2>🚀 Primeros pasos <small>${hechos} de ${pasos.length} listos</small></h2>
        <p class="muted" style="margin:0">Completá estos pasos y ya estás vendiendo. Cada uno se marca solo cuando lo hacés.</p>
        <div class="pgbar"><i style="width:${Math.round(hechos / pasos.length * 100)}%"></i></div>
        <div class="pasos">${pasos.map(([t, done, go, b], n) => `<div class="paso ${done ? "done" : ""}"><span class="pnum">${done ? "✓" : n + 1}</span><b>${esc(t)}</b>${done ? `<span class="pdone">Listo ✓</span>` : `<button class="pbtn blue sm" type="button" data-go="${go}">${esc(b)} ${icon("arrow")}</button>`}</div>`).join("")}</div></section>`
      : `<section class="card ok-card setupcard"><h2 style="margin:0">🎉 ¡Tu tienda está lista para vender!</h2><p class="muted" style="margin:6px 0 0">Completaste todos los primeros pasos. Cuando quieras, seguí personalizando desde Apariencia.</p></section>`;
    const G = [
      ["Inicio / Dashboard", "Tu resumen del día: ingresos, pedidos, lo que vence y tus mejores revendedores.", "dashboard"],
      ["Vender", "Registrás una venta: elegís cliente y producto, y el sistema arma el mensaje para WhatsApp.", "vender"],
      ["Control", "Lo que vence con tus clientes y proveedores; desde acá avisás, renovás y reubicás perfiles.", "control"],
      ["Finanzas", "Lo que entró, lo que salió y lo que te quedó cada mes, con tus gastos.", "finanzas"],
      ["Cuentas", "Las cuentas que compraste al mayorista, con sus perfiles o cupos en colores.", "cuentas"],
      ["Carga de cuentas", "Cargás una cuenta nueva: correo, clave, costo y cuándo vence.", "carga"],
      ["Productos", "Qué servicios vendés y a qué precio (incluido el precio de revendedor).", "productos"],
      ["Clientes", "La agenda de tus clientes y revendedores: WhatsApp, notas y qué compraron.", "clientes"],
      ["Revendedores", "Tus revendedores: su página, su saldo, el premio por referidos y las solicitudes nuevas.", "revendedores"],
      ["Aprobación de ventas", "Los pagos por QR que esperan tu visto bueno antes de entregar.", "aprobacion"],
      ["Panel de códigos", "Conectás un correo y los códigos (Disney, etc.) se leen solos para tus clientes.", "codigos"],
      ["WhatsApp", "El bot que atiende solo y los avisos automáticos a tus clientes.", "whatsapp"],
      ["Apariencia", "El diseño de tu tienda: estilo, colores, fuentes, horario y preguntas frecuentes.", "apariencia"],
      ["Recordatorios", "Avisos automáticos de vencimiento para que no se te escape ninguno.", "recordatorios"],
      ["Excel", "Exportás e importás tus clientes y servicios con una planilla.", "excel"],
      ["Configuración", "Nombre, WhatsApp, QR de cobro, verificación en dos pasos y respaldo.", "configuracion"],
    ];
    return `${setupCard}
      <section class="card"><h2>${icon("help")}¿Para qué sirve cada pantalla?</h2>
      <p class="muted" style="margin:0 0 12px">Una explicación corta de cada parte del sistema. Tocá “Ir” para abrirla.</p>
      <div class="glist">${G.map(([n, de, go]) => `<div class="gitem"><div><b>${esc(n)}</b><br><small class="muted">${esc(de)}</small></div><button class="pbtn sm" type="button" data-go="${go}">Ir ${icon("arrow")}</button></div>`).join("")}</div></section>
      <section class="card"><h2>👁️ Ver tu tienda como la ve el cliente</h2>
      <p class="muted" style="margin:0 0 10px">Abrí tu tienda en otra pestaña y mirala igual que un cliente, sin tocar nada.</p>
      <div class="big mini"><a href="/tienda/" target="_blank" rel="noopener" style="background:#6741d9"><span>👁️</span>Abrir la tienda</a><a href="/hub" target="_blank" rel="noopener" style="background:#087f5b"><span>🏪</span>Abrir GaboHub (revendedores)</a></div></section>`;
  },
  async finanzas() {
    const [d, mg] = await Promise.all([api("GET", "/api/admin/finance?months=6"), api("GET", "/api/admin/finance/margins").catch(() => null)]);
    const c = d.current;
    const max = Math.max(1, ...d.months.map((m) => Math.max(m.ingresos, m.gastos)));
    const gcls = (v) => (v > 0 ? "up" : v < 0 ? "down" : "");
    const bars = d.months.map((m, i) => {
      const last = i === d.months.length - 1;
      return `<div class="finbar ${last ? "cur" : ""}" title="${esc(m.label)} · entró ${bs(m.ingresos)} · salió ${bs(m.gastos)} · quedó ${bs(m.ganancia)}">
        <div class="finbcol"><i class="inb" style="height:${Math.max(2, (m.ingresos / max) * 100)}%"></i><i class="exb" style="height:${Math.max(2, (m.gastos / max) * 100)}%"></i></div>
        <b class="${gcls(m.ganancia)}">${bs(m.ganancia)}</b><small>${esc(m.label)}</small></div>`;
    }).join("");
    const rows = d.expenses.map((x) => `<tr><td>${x.accountId ? `<span class="pp pp-mute">🔁 cuenta</span> ` : ""}<b>${esc(x.note)}</b></td><td class="num">${bs(x.amount)}</td><td><small class="muted">${fdt(x.at)}</small></td><td><button class="pbtn sm danger" type="button" data-rmexp="${esc(x.id)}" title="Quitar este gasto">Quitar</button></td></tr>`);
    return `<div class="fin">
      <section class="card finhero">
        <h2 style="margin:0 0 4px">Finanzas de ${esc(c.label)}</h2>
        <p class="muted" style="margin:0 0 14px">Lo que entró por ventas y renovaciones, lo que saliste gastando, lo que te cuestan las cuentas y lo que te quedó este mes (del día 1 a hoy).</p>
        <div class="finkpis ${c.cuentasEstimado ? "four" : ""}">
          <div class="finkpi in"><span>💵 Entró</span><b>${bs(c.ingresos)}</b><small>ventas y renovaciones</small></div>
          <div class="finkpi out"><span>🧾 Salió</span><b>${bs(c.gastos)}</b><small>${c.cuentas ? `${bs(c.cuentas)} en cuentas · ${bs(c.gastos - c.cuentas)} otros` : "gastos que anotaste"}</small></div>
          ${c.cuentasEstimado ? `<div class="finkpi out est"><span>🔑 Cuentas (estimado)</span><b>${bs(c.cuentasEstimado)}</b><small>${c.sinAnotar} cuenta(s) sin anotar: lo que te cuestan por mes</small></div>` : ""}
          <div class="finkpi net ${gcls(c.gananciaEstimada)}"><span>✅ Te quedó${c.cuentasEstimado ? " (estimado)" : ""}</span><b>${bs(c.gananciaEstimada)}</b><small>${c.gananciaEstimada >= 0 ? "ganancia del mes" : "estás en rojo este mes"}</small></div>
        </div>
        ${c.cuentasEstimado ? `<div class="finwarn">⚠️ Tenés <b>${c.sinAnotar} cuenta(s) sin anotar como gasto</b> este mes. Las contamos con su costo mensual (${bs(c.cuentasEstimado)}) para que “Te quedó” no te muestre de más. Cuando pagues una, anotala en Cuentas → <b>“Pagué la renovación”</b> y deja de ser estimado.${c.ganancia !== c.gananciaEstimada ? ` <small class="muted">Sin contar las cuentas te quedaría ${bs(c.ganancia)}.</small>` : ""}</div>` : ""}
      </section>
      ${mg ? marginsCard(mg) : ""}
      <section class="card">
        <h2>Últimos 6 meses <small>entró vs. salió, y lo que quedó</small></h2>
        <div class="finlegend"><span><i class="inb"></i>Entró</span><span><i class="exb"></i>Salió</span></div>
        <div class="finchart">${bars}</div>
      </section>
      <section class="card">
        <h2>Gastos de ${esc(c.label)}</h2>
        <p class="muted" style="margin:0 0 10px">Anotá lo que pagás (publicidad, cuentas al mayorista, lo que sea). Se descuenta de la ganancia del mes.</p>
        <form id="expenseForm" class="finform" autocomplete="off">
          <label>Monto (${currencySym()})<input name="amount" type="number" min="0" step="0.01" inputmode="decimal" placeholder="0" required></label>
          <label class="grow">¿En qué? <input name="note" maxlength="120" placeholder="Ej: publicidad en Facebook" required></label>
          <button class="pbtn blue" type="submit">Agregar gasto</button>
        </form>
        ${table(["Gasto", "Monto", "Cuándo", ""], rows, "Todavía no cargaste gastos este mes.")}
      </section>
    </div>`;
  },
  async reubicar() {
    const list = await api("GET", "/api/admin/relocations");
    const reasonTxt = { cuarentena: "⚠️ En cuarentena", "cuenta retirada": "🚫 Cuenta retirada", "venció con el proveedor": "📅 Venció con el proveedor" };
    return `<section class="card"><h2>${icon("renew")}Reubicar perfiles <small>pasá tus clientes de cuentas caídas a cuentas sanas</small></h2>
      <p class="muted" style="margin:0 0 12px">Acá aparecen los clientes que están en una cuenta caída (en cuarentena, retirada o vencida con el proveedor). Reubicalos a una cuenta sana: conservan su fecha y el perfil viejo queda retirado.</p>
      ${list.length ? `<div class="reloc">${list.map((r) => `<div class="relrow">
        <div class="relc"><b>${esc(r.customerName || "—")}</b><small class="muted">${esc(r.product)} · ${esc(r.profile)}${r.customerPhone ? ` · ${esc(r.customerPhone)}` : ""} · vence ${fdate(r.expiresAt)}</small></div>
        <div class="relfrom"><span class="pp pp-bad">${reasonTxt[r.reason] ?? esc(r.reason)}</span><small class="muted mono">${esc(r.currentEmail)}</small></div>
        <div class="relto">${r.suggest ? `<small class="muted">Mover a</small><b class="mono">${esc(r.suggest.email)}</b><small class="muted">${r.suggest.free} cupo${r.suggest.free === 1 ? "" : "s"} libre${r.suggest.free === 1 ? "" : "s"}</small>` : `<span class="pp pp-warn">No hay cuenta sana con cupo</span>`}</div>
        <div class="relact">${r.suggest ? `<button class="pbtn dark sm" type="button" data-relocate="${esc(r.assignmentId)}" data-name="${esc(r.customerName || "")}">${icon("renew")}Mover</button>` : `<button class="pbtn sm" type="button" data-go="carga">Cargar cuenta</button>`}</div>
      </div>`).join("")}</div>` : `<div class="emptybox">🎉 Ninguna cuenta caída con clientes. Todo está en cuentas sanas.</div>`}</section>`;
  },
  async notificaciones() {
    const d = await api("GET", "/api/admin/notifications");
    const sevcls = { bad: "bad", warn: "warn", info: "ok" };
    return `<section class="card"><h2>${icon("bell")}Notificaciones <small>lo que necesita tu atención ahora</small></h2>
      <p class="muted" style="margin:0 0 12px">Todo junto en un solo lugar: pagos por revisar, solicitudes, cuentas caídas y vencimientos. Tocá una para ir a resolverla.</p>
      ${d.items.length ? `<div class="notis">${d.items.map((n) => `<button type="button" class="notirow noti-${sevcls[n.sev] ?? "ok"}" data-go="${esc(n.go)}">
        <span class="notiic">${n.icon}</span><span class="notitx"><b>${esc(n.text)}</b></span><span class="notigo">${icon("arrow")}</span></button>`).join("")}</div>`
      : `<div class="emptybox">🎉 Todo al día. No tenés nada pendiente ahora mismo.</div>`}</section>`;
  },
  async vender() {
    const [customers, products, stock, accounts] = await Promise.all([api("GET", "/api/admin/customers"), api("GET", "/api/admin/products"), api("GET", "/api/admin/stock"), (canReview() ? api("GET", "/api/admin/accounts").catch(() => []) : Promise.resolve([]))]);
    P.tab.sellAccts = accounts;
    P.tab.custMap = Object.fromEntries(customers.map((c) => [`${c.name} · ${c.phone}`.trim(), c.id]));
    P.tab.sellDur = Object.fromEntries(products.map((p) => [p.id, p.durationDays]));
    P.tab.sellPrice = Object.fromEntries(products.map((p) => [p.id, p.price]));
    const comboParts = Object.fromEntries(products.filter((p) => p.kind === "combo").map((p) => [p.id, (p.comboProductIds ?? []).map((id) => products.find((x) => x.id === id)?.name).filter(Boolean)]));
    const tile = (p) => {
      const n = stock[p.id]?.available ?? 0;
      const combo = p.kind === "combo";
      const face = combo ? `<i class="selcombo">🎁</i>` : p.imageFileRef ? `<img src="/api/products/${esc(p.id)}/image" alt="" loading="lazy">` : `<i style="background:${esc(p.color ?? "#3984ff")}">${esc((p.name[0] || "?").toUpperCase())}</i>`;
      const sub = combo ? `<em class="selparts">${esc((comboParts[p.id] ?? []).join(" + ") || "combo")}</em>` : "";
      return `<button type="button" class="selp${n ? "" : " out"}" data-pick="${esc(p.id)}" data-name="${esc(p.name)}" data-kind="${esc(p.kind)}" data-stock="${n}" data-price="${p.price}" data-rule="${esc(p.saleNote ?? "")}" ${n ? "" : "disabled"} aria-pressed="false">
        ${face}<b>${esc(p.name)}</b>${sub}<span class="selprice">${bs(p.price)}</span>
        <em class="selstock ${n ? (n <= 2 ? "low" : "ok") : "no"}">${n ? `${n} libre${n > 1 ? "s" : ""}` : "Sin stock"}</em></button>`;
    };
    const pub = products.filter((p) => p.published !== false);
    const apps = pub.filter((p) => p.kind !== "combo");
    const combos = pub.filter((p) => p.kind === "combo");
    const sk = combos.length ? (P.tab.sellKind ?? "apps") : "apps";
    const shownProds = sk === "combos" ? combos : apps;
    const trialProds = products.filter((p) => p.kind !== "combo");
    const trialCard = !customers.length || !trialProds.length ? "" : `<section class="card"><h2>🎁 Prueba gratis <small>· línea de cortesía por horas (ideal IPTV)</small></h2>
      <form class="form" id="trialForm">
        <label>Cliente<select name="customerId" required>${customers.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} · ${esc(c.phone)}</option>`).join("")}</select></label>
        <label>Producto<select name="productId">${trialProds.map((p) => opt(p.id, p.name)).join("")}</select></label>
        <label>Duración<select name="hours">${[[6, "6 horas"], [24, "24 horas"], [48, "48 horas"]].map(([v, t]) => opt(v, t, v === 24)).join("")}</select></label>
        <button class="pbtn dark" type="submit" style="grid-column:1/-1">${icon("plus")}Generar prueba</button>
      </form><div id="trialOut"></div>
      <p class="muted" style="margin:0">La prueba vence sola y <b>no cuenta como venta</b>. Se descuenta del stock mientras dure.</p></section>`;
    return `${trialCard}<section class="card sellcard"><h2>${icon("cart")}Nueva venta <small>2 pasos: cliente y producto</small></h2>
      ${customers.length ? `<form class="form sellform" id="sellForm" data-key="${newKey()}">
        <div class="sstep"><span class="sstepn">1</span><div class="sstepb">
          <label class="sstepl">👤 ¿A quién le vendés?</label>
          <input name="customerName" list="custlist" autocomplete="off" value="${esc(P.tab.sellCustomer ?? "")}" placeholder="Escribí el nombre del cliente…" required><datalist id="custlist">${customers.map((c) => `<option value="${esc(c.name)} · ${esc(c.phone)}">`).join("")}</datalist>
        </div></div>
        <input type="hidden" name="customerId" value="">
        <input type="hidden" name="productId" value="">
        <input type="hidden" name="slotId" value="">
        <div class="sstep"><span class="sstepn">2</span><div class="sstepb">
          <label class="sstepl">🛍️ ¿Qué le vendés?</label>
          ${combos.length ? `<div class="seg sellseg"><button type="button" data-tab="sellKind:apps" aria-pressed="${sk === "apps"}">📺 Individuales</button><button type="button" data-tab="sellKind:combos" aria-pressed="${sk === "combos"}">🎁 Combos <span class="segn">${combos.length}</span></button></div>` : ""}
          <div class="selgrid">${shownProds.map(tile).join("") || `<span class="muted">${sk === "combos" ? "Todavía no armaste combos. Creálos en Productos." : "No hay productos."}</span>`}</div>
        </div></div>
        <div id="sellNote" class="sellnote">👆 Tocá un producto de arriba.</div>
        <div id="profPick" class="profpick" hidden></div>
        <details class="selladv"><summary>⚙️ Más opciones <small>por defecto: 1 mes · pagado · efectivo/QR</small></summary>
          <div class="seladvgrid">
            <div><span class="selbl">⏳ Período</span><div class="seg periodseg">${[[1, "1 mes"], [3, "3 meses"], [6, "6 meses"], [12, "1 año"]].map(([v, t]) => `<button type="button" data-period="${v}" aria-pressed="${v === 1}">${t}</button>`).join("")}</div></div>
            <div><span class="selbl">💳 Estado de pago</span><div class="seg payseg"><button type="button" data-pay="pagado" aria-pressed="true">✅ Pagado</button><button type="button" data-pay="pendiente" aria-pressed="false">⏳ Pendiente</button></div></div>
            <label>Cantidad<input name="qty" type="number" min="1" max="10" value="1"></label>
            <label>💵 Cobrado con<select name="paymentMethod">${opt("cash", "Efectivo / QR ya verificado")}${opt("balance", "Saldo del cliente")}</select></label>
            <label>🏷️ Cupón <small class="muted">(opcional)</small><input name="couponCode" maxlength="20" autocomplete="off" autocapitalize="characters" placeholder="Ej.: VERANO10"></label>
          </div>
        </details>
        <input type="hidden" name="periodMonths" value="1"><input type="hidden" name="payStatus" value="pagado">
        <div id="sellSummary" class="sellsum" hidden></div>
        <button class="pbtn dark big" type="submit" id="sellBtn" disabled>${icon("cart")}Registrar venta</button></form>` : `<div class="emptybox">Primero creá un cliente.</div>`}
      <div class="inline"><span class="muted">¿Cliente nuevo?</span><button class="pbtn sm" type="button" data-go="clientes">Crear cliente</button></div></section>`;
  },

  async cupones() {
    let list;
    try { list = await api("GET", "/api/admin/coupons"); }
    catch (e) { if (e.status === 403) return `<section class="card"><div class="emptybox">Solo el dueño o un admin manejan los cupones.</div></section>`; throw e; }
    const products = (await api("GET", "/api/admin/products")).filter((p) => p.kind !== "combo");
    const rc = await api("GET", "/api/admin/reseller-coupons").catch(() => ({ allowed: false }));
    const ed = list.find((c) => c.id === P.tab.couponEdit) ?? null;
    const ST = { active: ["✅ Activo", "on"], paused: ["⏸️ Pausado", "off"], expired: ["📅 Vencido", "bad"], used_up: ["🔚 Sin usos", "bad"] };
    const val = (c) => c.type === "percent" ? `${c.value}%` : bs(c.value);
    const rules = (c) => [c.expiresAt ? `vence ${fdate(c.expiresAt)}` : "", c.maxUses ? `${c.uses}/${c.maxUses} usos` : `${c.uses} uso(s)`,
      c.perCustomer ? `${c.perCustomer} por cliente` : "", c.minTotal ? `desde ${bs(c.minTotal)}` : "",
      c.productIds?.length ? `solo ${c.productIds.map((id) => products.find((p) => p.id === id)?.name ?? id).join(", ")}` : "",
      c.resellers ? "también revendedores" : "solo clientes"].filter(Boolean).join(" · ");
    const rows = list.map((c) => `<tr><td><b class="mono">${esc(c.code)}</b>${c.note ? `<br><small class="muted">${esc(c.note)}</small>` : ""}</td><td><b>${val(c)}</b></td>
      <td><small>${esc(rules(c))}</small></td><td><span class="cupst ${ST[c.state][1]}">${ST[c.state][0]}</span></td>
      <td><div class="inline"><button class="pbtn sm" type="button" data-cupedit="${esc(c.id)}">${icon("edit")}Editar</button>
        <button class="pbtn sm" type="button" data-cuptoggle="${esc(c.id)}">${c.active ? "⏸️ Pausar" : "▶️ Activar"}</button>
        <button class="pbtn sm" type="button" data-cupdel="${esc(c.id)}" data-name="${esc(c.code)}" aria-label="Borrar el cupón ${esc(c.code)}">${icon("trash")}</button></div></td></tr>`);
    const f = ed ?? { type: "percent", resellers: false };
    return `<section class="card"><h2>${icon("tag")}${ed ? `Editar cupón ${esc(ed.code)}` : "Nuevo cupón"} <small>el cliente lo escribe en el carrito</small></h2>
      <form class="form" id="couponForm" autocomplete="off" ${ed ? `data-id="${esc(ed.id)}"` : ""}>
        <label>Código<input name="code" required maxlength="20" autocapitalize="characters" value="${esc(f.code ?? "")}" placeholder="Ej.: VERANO10"></label>
        <label>Tipo de descuento<select name="type">${opt("percent", "Porcentaje (%)", f.type === "percent")}${opt("fixed", `Monto fijo (${currencySym()})`, f.type === "fixed")}</select></label>
        <label>Descuento<input name="value" type="number" min="0.01" step="0.01" inputmode="decimal" required value="${f.value ? (f.type === "percent" ? f.value : f.value / 100) : ""}" placeholder="Ej.: 10"></label>
        <label>Vence el <small class="muted">(opcional)</small><input name="expiresAt" type="date" value="${f.expiresAt ? dateInput(f.expiresAt) : ""}"></label>
        <label>Usos en total <small class="muted">(vacío = sin límite)</small><input name="maxUses" type="number" min="1" step="1" inputmode="numeric" value="${f.maxUses ?? ""}"></label>
        <label>Usos por cliente <small class="muted">(vacío = sin límite)</small><input name="perCustomer" type="number" min="1" step="1" inputmode="numeric" value="${f.perCustomer ?? ""}" placeholder="Ej.: 1"></label>
        <label>Compra mínima (${currencySym()}) <small class="muted">(opcional)</small><input name="minTotal" type="number" min="0" step="0.01" inputmode="decimal" value="${f.minTotal ? f.minTotal / 100 : ""}"></label>
        <label>Nota interna <small class="muted">(opcional)</small><input name="note" maxlength="120" value="${esc(f.note ?? "")}" placeholder="Ej.: para el grupo de Facebook"></label>
        <fieldset class="cupprods" style="grid-column:1/-1"><legend>¿Para qué productos? <small class="muted">(ninguno marcado = todos)</small></legend>
          ${products.map((p) => `<label class="chk"><input type="checkbox" name="cupprod" value="${esc(p.id)}" ${f.productIds?.includes(p.id) ? "checked" : ""}> ${esc(p.name)}</label>`).join("") || `<span class="muted">Todavía no hay productos.</span>`}</fieldset>
        <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="resellers" ${f.resellers ? "checked" : ""}> Los revendedores también lo pueden usar</label>
        <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">${icon("plus")}${ed ? "Guardar cambios" : "Crear cupón"}</button>${ed ? `<button class="pbtn" type="button" data-cupedit="">Cancelar</button>` : ""}</div>
      </form>
      <p class="muted" style="margin:10px 0 0">El descuento se suma al de “Armá tu combo” y siempre queda algo a pagar. Si un pedido vence o se cancela, el uso vuelve al cupón.</p></section>
      <section class="card"><h2>${icon("tag")}Tus cupones <small>${list.length}</small></h2>${table(["Código", "Descuento", "Reglas", "Estado", ""], rows, "Todavía no creaste cupones.")}</section>
      <section class="card"><h2>${icon("userplus")}Cupones de tus revendedores ${rc.allowed ? pill("Permitido", "ok") : pill("No permitido", "mute")}</h2>
        <p class="muted" style="margin:0">Si lo permitís, cada revendedor puede crear cupones para <b>su propia página</b> (/r/…), con descuento sobre <b>sus</b> precios. No tocan tus precios ni tu tienda, y no sirven en la página de otro revendedor. Los pedidos de esas páginas se cierran por WhatsApp con el revendedor.</p>
        <label class="chk"><input type="checkbox" id="rcAllowed" ${rc.allowed ? "checked" : ""}> Dejar que los revendedores creen cupones para su página</label></section>`;
  },

  async aprobacion() {
    const tab = P.tab.aprob ?? "payment_review";
    if (canReview() && !P.ai) P.ai = await api("GET", "/api/admin/ai").then((a) => ({ receipts: a.hasKey && a.enabled.receipts })).catch(() => ({}));
    const orders = await api("GET", "/api/admin/orders" + (tab === "all" ? "" : `?status=${tab}`));
    const tabs = [["payment_review", "Por revisar"], ["awaiting_payment", "Esperando pago"], ["all", "Todos"]];
    return `${canReview() ? "" : `<div class="pok">Solo el dueño o un admin pueden aprobar pagos. Vos podés ver los pedidos.</div>`}
      <section class="card"><div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" type="button" data-tab="aprob:${k}" aria-selected="${k === tab}">${t}</button>`).join("")}</div>
      ${table(["Pedido", "Cliente", "Tipo", "Total", "Pago", "Estado", "Fecha", "Acciones"], orders.map((o) => `<tr>
        <td>${esc(o.id)}</td><td>${esc(o.customerName)}</td><td>${KIND_TEXT[o.kind]}${o.items?.length ? `<br><small class="muted">${o.items.map((i) => `${i.qty}× ${esc(i.productName)}`).join(", ")}</small>` : ""}${o.backorder?.length ? `<br>${pill("A pedido", "warn")} <small class="muted">Cargá la cuenta en Carga de Cuentas y después aprobá: se entrega sola.</small>` : ""}</td>
        <td>${orderTotal(o)}</td><td>${esc(o.localPay?.name ?? { qr: "QR", balance: "Saldo", cash: "Efectivo", usdt: "USDT", binance: "Binance Pay" }[o.paymentMethod] ?? o.paymentMethod)}${o.usdtQuote ? `<br><small class="muted">${o.usd !== undefined ? "" : "≈ "}${esc(String(o.usdtQuote.usdt).replace(".", ","))} USDT a Bs ${esc(String(o.usdtQuote.rate).replace(".", ","))}</small>` : ""}${o.evidence ? `<br><small class="muted">Op. ${esc(o.evidence.declaredReference)}</small>` : ""}</td>
        <td>${orderPill(o.status)}</td><td>${fdt(o.createdAt)}</td>
        <td>${o.evidence ? `<a class="pbtn sm" href="/api/admin/orders/${esc(o.id)}/evidence" target="_blank" rel="noopener">${icon("eye")}Comprobante</a>` : ""}
          ${o.evidence?.duplicateOf ? `<div class="aibox aibox-bad"><b>🔁 Comprobante repetido</b><small>Esta misma imagen ya se usó en el pedido ${esc(o.evidence.duplicateOf)}. Revisalo bien antes de aprobar.</small></div>` : ""}
          ${o.aiCheck ? aiCheckBox(o.aiCheck) : o.evidence && o.status === "payment_review" && canReview() && P.ai?.receipts ? `<button class="pbtn sm" type="button" data-aicheck="${esc(o.id)}">🤖 Revisar con IA</button>` : ""}
          ${o.status === "payment_review" && canReview() ? `<form class="inline" data-approve="${esc(o.id)}" style="margin-top:6px"><input name="ref" placeholder="Referencia del banco" required aria-label="Referencia bancaria verificada"><button class="pbtn sm green" type="submit">Aprobar</button></form>
            <form class="inline" data-reject="${esc(o.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo del rechazo" required aria-label="Motivo"><button class="pbtn sm" type="submit">Rechazar</button></form>` : ""}
          ${o.status === "awaiting_payment" && canReview() ? `${["qr", "local", "usdt"].includes(o.paymentMethod) ? `<form class="inline" data-approve="${esc(o.id)}" style="margin-top:6px"><input name="ref" placeholder="Referencia del banco" required aria-label="Referencia bancaria verificada"><button class="pbtn sm green" type="submit">✅ Ya me pagó</button></form>
            <small class="muted">¿Te mandó el comprobante por WhatsApp? Mirá la plata en tu banco, escribí la referencia y se entrega solo.</small>` : ""}
            <form class="inline" data-reject="${esc(o.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo" required aria-label="Motivo"><button class="pbtn sm" type="submit">Anular</button></form>` : ""}</td></tr>`),
        tab === "payment_review" ? "No hay pagos por revisar." : "No hay pedidos.")}
      <p class="muted" style="margin:0">Aprobá solo después de ver el dinero en tu banco: escribí la referencia que figura en tu extracto. Una misma referencia no se puede usar dos veces.</p></section>`;
  },

  async inicio() {
    const [all, pend, fin] = await Promise.all([api("GET", "/api/admin/assignments"),
      api("GET", "/api/admin/orders?status=payment_review").then((l) => l.length).catch(() => 0),
      isOwner() ? api("GET", "/api/admin/finance?months=1").catch(() => null) : Promise.resolve(null)]);
    // Para cobros cuenta solo lo tuyo: a los clientes de tus revendedores les cobra el revendedor.
    const viaRes = (a) => !!a.resellerId && a.resellerId !== a.customerId;
    const list = all.filter((a) => !viaRes(a));
    const deRev = all.filter(viaRes);
    const now = new Date();
    const dayStart = (t) => { const d = new Date(t); d.setHours(0, 0, 0, 0); return d.getTime(); };
    const today = dayStart(now);
    const DAY = 86_400_000;
    const DN = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];
    const dl = (a) => Math.round((dayStart(a.customerExpiresAt) - today) / DAY);
    const hoy = list.filter((a) => !a.holdOpen && dl(a) === 0);
    const vencidos = list.filter((a) => !a.holdOpen && dl(a) < 0);
    const espera = list.filter((a) => a.holdOpen);
    const pronto = list.filter((a) => !a.holdOpen && dl(a) >= 1 && dl(a) <= 3);
    const sinPago = list.filter((a) => a.control?.payStatus && a.control.payStatus !== "pagado");
    // Mi semana: minutos estimados por día (como la hoja TIEMPO_LIBRE del Excel: 3 min por recordatorio, +1 si vence pronto, 5 por vencido).
    // "Mi semana": cuántas cuentas vencen cada día. El ánimo del día sale de esa cantidad.
    const amountOf = (a) => a.control?.price ?? a.effectivePrice ?? a.productPrice ?? 0;
    const week = Array.from({ length: 7 }, (_, i) => {
      const t = today + i * DAY;
      const dayl = all.filter((a) => dayStart(a.customerExpiresAt) === t);
      const n = dayl.length, amount = dayl.reduce((s, a) => s + amountOf(a), 0);
      const load = n + (i === 0 ? vencidos.length + espera.length : 0);
      const lvl = load === 0 ? ["Libre", "free", "😌"] : load <= 2 ? ["Tranquilo", "calm", "🙂"] : load <= 5 ? ["Movido", "busy", "😅"] : ["Cargado", "hard", "🥵"];
      return { t, i, n, amount, lvl };
    });
    const weekAmount = week.reduce((x, w) => x + w.amount, 0);
    const libres = week.filter((w) => w.lvl[1] === "free").map((w) => (w.i === 0 ? "hoy" : DN[new Date(w.t).getDay()].toLowerCase()));
    const tile = (go, ic, t, sub) => `<button type="button" class="hm-tile" data-hgo="${go}"><span class="hm-ic">${ic}</span><b>${t}</b><small>${sub}</small></button>`;
    const alert = (n, t, k, go) => `<button type="button" class="hm-alert hm-${k}" data-hgo="${go}" ${n ? "" : "disabled"}><b>${n}</b><span>${t}</span></button>`;
    const aiInfo = canReview() ? await api("GET", "/api/admin/ai").catch(() => null) : null;
    // Revendedores que todavía no tienen PIN: un botón en Inicio arranca la fila de invitaciones.
    const sinPin = canReview() ? ((await api("GET", "/api/admin/resellers").catch(() => null))?.list ?? []).filter((r) => !r.hasPin).length : 0;
    const invCard = sinPin ? `<section class="card hm-invite"><h2>📲 ${sinPin} revendedor${sinPin === 1 ? "" : "es"} todavía sin acceso</h2>
      <p class="muted" style="margin:0">Por cada uno: tocás <b>Generar PIN</b> y después <b>Abrir WhatsApp</b> para mandarle su acceso. La fila pasa sola al siguiente.</p>
      <button class="pbtn dark" type="button" data-hgo="revendedores:invitar">▶ Invitarlos ahora</button></section>` : "";
    const daily = isOwner() ? aiInfo?.daily ?? null : null;
    const askCard = aiInfo?.hasKey && aiInfo.enabled.daily ? `<section class="card askcard"><h2>🧠 Preguntale a tu negocio</h2>
      <form class="inline" id="askForm" style="flex-wrap:wrap"><input name="q" maxlength="600" required placeholder="Ej.: ¿quién vence esta semana?" aria-label="Tu pregunta" style="flex:1 1 220px"><button class="pbtn dark" type="submit">Preguntar</button></form>
      <div id="askOut" class="dailytext" aria-live="polite"></div><small class="muted">Responde con tus datos de hoy. Solo lee: no cambia nada.</small></section>` : "";
    const dailyCard = daily && Date.now() - daily.at < 36 * 3600_000 ? `<section class="card dailyai"><h2>📋 Tu reporte del día <small>armado por Claude · ${fdt(daily.at)}</small></h2><div class="dailytext">${esc(daily.text).replace(/\n/g, "<br>")}</div></section>` : "";
    // "Tu mes": cuánto entró, lo que te cuestan las cuentas (estimado) y lo que te quedó, con las 3 apps que más te dejan.
    const c = fin?.current;
    const tuMes = c ? `<section class="card tumes"><div class="tumes-h"><h2>💼 Tu mes <small>${esc(c.label)}</small></h2><button class="pbtn sm" type="button" data-go="finanzas">Ver Finanzas ${icon("arrow")}</button></div>
      <div class="tumes-k"><div><small>💵 Entró</small><b>${bs(c.ingresos)}</b></div><div><small>🧾 ${c.gastos ? "Gastos y cuentas" : "Cuentas"}${c.cuentasEstimado ? " (estimado)" : ""}</small><b>${bs(c.gastos + c.cuentasEstimado)}</b></div><div class="${c.gananciaEstimada < 0 ? "down" : "up"}"><small>✅ Te quedó${c.cuentasEstimado ? " (estimado)" : ""}</small><b>${bs(c.gananciaEstimada)}</b></div></div>
      ${fin.topApps?.length ? `<ol class="tumes-top">${fin.topApps.map((x) => `<li><b>${esc(x.name)}</b><span>te dejó <b class="${x.gana < 0 ? "down" : "up"}">${bs(x.gana)}</b> <small class="muted">(${x.units} venta${x.units === 1 ? "" : "s"})</small></span></li>`).join("")}</ol>` : ""}
      ${c.sinAnotar ? `<small class="muted">Estimado: ${c.sinAnotar} cuenta(s) que todavía no anotaste como gasto este mes.</small>` : ""}</section>` : "";
    return dailyCard + askCard + `<section class="hm-hero"><div><small>${DN[now.getDay()]}, ${now.toLocaleDateString("es-BO", { day: "numeric", month: "long" })}</small><h2>Hola, ${esc((P.me?.name ?? "").split(" ")[0])} 👋</h2>
        <p>${hoy.length + vencidos.length + espera.length ? `Hoy tenés <b>${hoy.length + vencidos.length + espera.length}</b> pendiente(s) de cobro o fecha.` : "Hoy no tenés cobros pendientes. ✨"}${(() => { const n = deRev.filter((a) => dayStart(a.customerExpiresAt) <= today).length; return n ? ` <small>(+${n} de clientes de tus revendedores: les avisás a ellos)</small>` : ""; })()}${libres.length >= 5 ? " Semana tranquila ✨" : libres.length ? ` Días libres: <b>${libres.slice(0, 3).join(", ")}</b>.` : ""}</p></div>
      <form class="hm-search" id="hmSearch"><input name="q" placeholder="🔍 Buscar cliente o número…" aria-label="Buscar" autocomplete="off"><button class="pbtn dark" type="submit">Buscar</button></form></section>
      <section class="hm-alerts">
        ${alert(hoy.length, "Vencen hoy", "today", "control:today:mios")}
        ${alert(vencidos.length + espera.length, "Vencidos / esperando fecha", "bad", espera.length && !vencidos.length ? "control:hold:mios" : "control:bad:mios")}
        ${alert(pronto.length, "Vencen en 3 días", "warn", "control:warn:mios")}
        ${alert(pend, "Pagos por revisar", "pay", "aprobacion")}
        ${alert(sinPago.length, "Sin pagar", "nopay", "control:nopay:mios")}</section>
      ${await rateCard()}${invCard}${await winbackHomeCard()}${tuMes}
      <section class="hm-grid">
        ${tile("control", "📊", "Control", "Tu Excel de alquileres")}
        ${tile("control:cobrar:mios", "💰", "Cobrar", "Vencidos y de hoy")}
        ${tile("clientes", "👥", "Clientes", "Revendedores y clientes")}
        ${tile("control:dia", "📅", "Por día", "Quién vence cada día")}
        ${canReview() ? tile("cuentas", "🔑", "Cuentas", "Correos, perfiles y proveedor") : tile("fallas", "🛠️", "Fallas", "Lo que reportaron")}
        ${tile("whatsapp", "📝", "Mensajes", "Avisos de WhatsApp")}
        ${tile("aprobacion", "✅", "Aprobar pagos", "Comprobantes por QR")}
        ${tile("vender", "🛒", "Vender", "Venta rápida")}
        ${canReview() ? tile("configuracion", "⚙️", "Ajustes", "QR, respaldos, contraseña") : tile("renovar", "🔄", "Renovar", "Renovar servicios")}</section>
      <section class="card hm-week"><h2>📅 Mi semana <small>· cuántas cuentas vencen cada día</small></h2>
        <div class="hm-days">${week.map((w) => `<button type="button" class="hm-day hm-${w.lvl[1]}${w.i === 0 ? " hm-ishoy" : ""}" data-hgo="control:fecha:${w.t}" aria-label="${w.i === 0 ? "Hoy" : ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date(w.t).getDay()]} ${new Date(w.t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" })}: ${w.n ? w.n + " vencen" : "ninguna vence"}">
          <span class="hd-dow">${w.i === 0 ? "Hoy" : ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][new Date(w.t).getDay()]}</span><small class="hd-date">${new Date(w.t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" })}</small>
          <b class="hd-emoji">${w.lvl[2]}</b><span class="hd-count">${w.n ? `<b>${w.n}</b><span class="hd-w"> vence${w.n > 1 ? "n" : ""}</span>` : "Libre"}</span>${w.amount ? `<small class="hd-amt">${bs(w.amount)}</small>` : ""}</button>`).join("")}</div>
        <p class="muted hm-weekhint" style="margin:0">👆 Tocá un día para ver quién vence y cobrar. Esta semana vencen <b>${week.reduce((x, w) => x + w.n, 0)}</b> cuenta(s)${weekAmount ? ` · <b>${bs(weekAmount)}</b> si todos renuevan (con el precio que te pagan)` : ""}.</p></section>`;
  },

  async control() {
    const [list, customers] = await Promise.all([api("GET", "/api/admin/assignments"), api("GET", "/api/admin/customers").catch(() => [])]);
    const T = P.tab;
    const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const estado = (d, hold) => (hold ? ["ESPERANDO FECHA", "hold"] : d < 0 ? ["VENCIDO", "bad"] : d === 0 ? ["VENCE HOY", "today"] : d <= 3 ? ["POR VENCER", "warn"] : d <= 7 ? ["SEMANA", "week"] : ["ACTIVO", "ok"]);
    const PAY = { pagado: "Pagado", pendiente: "Pendiente", no_pago: "No pagó" };
    const rows = list.map((a, i) => {
      const d = daysLeft(a.customerExpiresAt);
      // Precio: lo que de verdad te pagan (acordado ?? lista del revendedor ?? precio del producto).
      // Costo: el que pusiste a mano o, si no, lo que te cuesta ese perfil (cuenta ÷ perfiles).
      const price = a.control.price ?? a.effectivePrice ?? a.productPrice, cost = canReview() ? a.control.cost ?? a.estCost ?? 0 : 0;
      // viaRes: el cliente es de un revendedor (le avisás al revendedor, no al cliente).
      const viaRes = !!a.resellerId && a.resellerId !== a.customerId;
      // kind "fin": les cobrás vos (tus clientes y tus revendedores); "rev": clientes de tus revendedores.
      return { ...a, n: i + 1, d, est: estado(d, a.holdOpen), day: DAYS[new Date(a.customerExpiresAt).getDay()], price, cost, gain: price - cost, pay: a.control.payStatus ?? "pagado", kind: viaRes ? "rev" : "fin", viaRes, rname: a.resellerName || "" };
    });
    const products = [...new Set(rows.map((r) => r.product))];
    const q = (T.cq ?? "").toLowerCase();
    // Buscar por número como venga (+591 681-18288, 681 18288): se comparan los últimos 8 dígitos.
    const qd = q.replace(/\D/g, "").length >= 6 ? q.replace(/\D/g, "").slice(-8) : "";
    const sameDay = (t, u) => new Date(t).toDateString() === new Date(u).toDateString();
    const view0 = rows.filter((r) => (!T.cf || T.cf === "todos" || r.est[1] === T.cf || (T.cf === "cobrar" && ["bad", "today", "hold"].includes(r.est[1]))) && (!T.cfrom || sameDay(r.customerExpiresAt, T.cfrom)) && (!T.cday || r.day === T.cday) && (!T.cprod || r.product === T.cprod) && (!T.cpay || r.pay === T.cpay || (T.cpay === "debe" && r.pay !== "pagado")) && (!T.ck || T.ck === "todos" || r.kind === T.ck)
      && (!q || `${r.customerName} ${r.customerPhone} ${r.email} ${r.profile} ${r.control.seller ?? ""} ${r.rname} ${r.control.note ?? ""}`.toLowerCase().includes(q) || (qd && (r.customerPhone || "").replace(/\D/g, "").includes(qd))));
    // Como en Excel: filtro por columna, rango de fechas, ordenar tocando el título y agrupar con subtotal.
    // Atención (seller) no ve costos ni ganancia: son del dueño.
    const COLS = [["n", "N°"], ["customerName", "Cliente"], ["kind", "Tipo"], ["customerPhone", "WhatsApp"], ["product", "Plataforma"], ["email", "Correo"], ["profile", "Perfil"], ["startsAt", "Inicio"], ["customerExpiresAt", "Vencimiento"], ["day", "Día vence"], ["price", "Te pagan Bs"], ["cost", "Costo Bs"], ["gain", "Ganancia Bs"], ["pay", "Estado pago"], ["est", "Estado"], ["d", "Días"], ["seller", "Revendedor"], ["note", "Nota"]].filter(([k]) => canReview() || !["cost", "gain"].includes(k));
    const pname = (r) => r.product.replace(/ \(alquiler revendedores\)/, "");
    const colText = (r, k) => String({ kind: r.viaRes ? `De ${r.rname}` : r.customerKind === "reseller" ? "Revendedor" : "Mío", product: pname(r), startsAt: fdate(r.startsAt), customerExpiresAt: fdate(r.customerExpiresAt), price: r.price / 100, cost: r.cost / 100, gain: r.gain / 100, pay: PAY[r.pay], est: r.est[0], seller: r.control.seller || r.rname, note: r.control.note ?? "", customerPhone: (r.customerPhone || "").replace(/^\+591/, "") }[k] ?? r[k] ?? "");
    const cfc = T.cfc ?? (T.cfc = {});
    const view = view0.filter((r) => (!T.cr1 || r.customerExpiresAt >= T.cr1) && (!T.cr2 || r.customerExpiresAt < T.cr2 + 86400000)
      && Object.entries(cfc).every(([k, v]) => !v || colText(r, k).toLowerCase().includes(v.toLowerCase())));
    const WD = ["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"];
    const NUM = ["n", "startsAt", "customerExpiresAt", "price", "cost", "gain", "d"];
    const [sk, sd] = (T.csort ?? "").split(":");
    const sval = (r, k) => (NUM.includes(k) ? r[k] : k === "day" ? WD.indexOf(r.day) : colText(r, k).toLowerCase());
    const GROUPS = { cliente: ["Cliente", (r) => r.customerName || "(sin nombre)"], revendedor: ["Revendedor", (r) => r.control.seller || r.rname || "(míos, sin revendedor)"], app: ["Plataforma", pname], tipo: ["Tipo", (r) => (r.kind === "rev" ? "🏪 Clientes de tus revendedores" : "💰 Les cobrás vos")], dia: ["Día que vence", (r) => r.day] };
    const grp = GROUPS[T.cgroup]?.[1];
    view.sort((a, b) => {
      const g = grp ? grp(a).localeCompare(grp(b), "es") : 0;
      if (g || !sk) return g;
      const x = sval(a, sk), y = sval(b, sk);
      const c = typeof x === "number" ? x - y : String(x).localeCompare(String(y), "es", { numeric: true });
      return sd === "desc" ? -c : c;
    });
    let hid = [];
    try { hid = JSON.parse(localStorage.getItem("gs-ctl-hide") || "[]"); } catch { /* sin almacenamiento */ }
    const colsOpen = T.colsOpen; T.colsOpen = false;
    const anyFilter = (T.cf && T.cf !== "todos") || T.cq || T.cday || T.cprod || T.cpay || (T.ck && T.ck !== "todos") || T.cfrom || T.cr1 || T.cr2 || Object.values(cfc).some(Boolean);
    const dIn = (t) => (t ? `${new Date(t).getFullYear()}-${String(new Date(t).getMonth() + 1).padStart(2, "0")}-${String(new Date(t).getDate()).padStart(2, "0")}` : "");
    P.controlView = view;
    // En el celular arranca en Tarjetas (la tabla de 18 columnas no entra).
    const xl = (T.cv ?? (innerWidth < 700 ? "cards" : "excel")) === "excel";
    const first = (n) => (n || "").split(" ")[0];
    const kb = (r) => r.viaRes ? `<span class="kb kb-rev" title="Cliente de ${esc(r.rname)}: le avisás a tu revendedor">🏪 de ${esc(first(r.rname))}</span>` : r.customerKind === "reseller" ? `<span class="kb kb-rev">🏪 Revendedor</span>` : `<span class="kb kb-fin">👤 Mío</span>`;
    const sum = (f) => view.reduce((t, r) => t + f(r), 0);
    const cnt = (k) => rows.filter((r) => r.est[1] === k).length;
    const chips = [["todos", `Todos (${rows.length})`], ["bad", `Vencidos (${cnt("bad")})`], ["hold", `Esperando fecha (${cnt("hold")})`], ["today", `Vence hoy (${cnt("today")})`], ["warn", `Por vencer (${cnt("warn")})`], ["week", `Semana (${cnt("week")})`], ["ok", `Activos (${cnt("ok")})`]];
    const msg = (r) => `Hola ${r.customerName} 👋 te recuerdo que tu ${r.product.replace(/ \(alquiler revendedores\)/, "")} ${r.d < 0 ? "venció" : "vence"} el ${fdate(r.customerExpiresAt)}. Monto: ${bs(r.price)}. ¿Deseas renovar?`;
    // Cliente de un revendedor: el aviso va al revendedor (él le cobra a su cliente a su precio).
    const resMsg = (r) => `Hola ${first(r.rname)} 👋 tu cliente ${r.customerName} (${pname(r)} · ${r.profile}) ${r.d < 0 ? "venció" : "vence"} el ${fdate(r.customerExpiresAt)}. Si renueva, a vos te sale ${bs(r.price)}. ¿Lo renovás?`;
    const cobrarBtn = (r, title = "") => r.viaRes
      ? (r.resellerPhone ? `<a class="pbtn sm" href="${waLink(r.resellerPhone, resMsg(r))}" target="_blank" rel="noopener" title="Es cliente de ${esc(r.rname)}: le avisás a tu revendedor">📣 Avisar a ${esc(first(r.rname))}</a>` : `<span class="pp pp-warn">${esc(first(r.rname))} sin WhatsApp</span>`)
      : r.customerPhone ? `<a class="pbtn sm" href="${waLink(r.customerPhone, msg(r))}" target="_blank" rel="noopener"${title ? ` title="${title}"` : ""}>💰 Cobrar</a>` : "";
    const dlvBtn = (r) => `<button class="pbtn sm" type="button" data-deliver="${esc(r.id)}" title="Correo, contraseña, perfil y PIN listos para mandar">📲 Reenviar accesos</button>`;
    const acc = (r) => `*${r.product.replace(/ \(alquiler revendedores\)/, "")}*\nCorreo: ${r.email}\nPerfil: ${r.profile}\nVence: ${fdate(r.customerExpiresAt)}`;
    const newDate = (r) => fdate(Math.max(r.customerExpiresAt, Date.now()) + (r.durationDays ?? 30) * 86400000);
    const renewInfo = (r) => `Renovar este alquiler:\n\n📧 ${r.email}\n👤 ${r.profile}\n🗓️ Nueva fecha: ${newDate(r)}\n\n¿Confirmás la renovación (+1 período)?`;
    const transferForm = (r) => `<details class="more"><summary>👤 Pasar a otro</summary><form class="inline" data-transfer="${esc(r.id)}" style="margin-top:6px"><select name="to" required aria-label="Nuevo dueño"><option value="">Pasar a…</option>${customers.filter((c) => c.id !== r.customerId).map((c) => opt(c.id, c.name)).join("")}</select><input name="reason" placeholder="Motivo (no renovó)" required><button class="pbtn sm" type="submit">Pasar y avisar</button></form><small class="muted">Queda con el mismo perfil y la misma fecha. Al anterior le dejan de llegar los códigos.</small></details>`;
    return `<section class="card ctl-top">
        <div class="ctl-kpis"><div><small>Alquileres</small><b>${view.length}</b></div><div><small>Te pagan</small><b>${bs(sum((r) => r.price))}</b></div>${canReview() ? `<div><small>Costo de esos perfiles (estim.)</small><b>${bs(sum((r) => r.cost))}</b></div><div><small>Ganancia</small><b class="${sum((r) => r.gain) < 0 ? "down" : "up"}">${bs(sum((r) => r.gain))}</b></div>` : ""}<div><small>Pendientes de pago</small><b class="${view.some((r) => r.pay !== "pagado") ? "down" : ""}">${view.filter((r) => r.pay !== "pagado").length}</b></div></div>
        ${(() => { const n30 = rows.filter((r) => r.d >= 0 && r.d <= 30); const proy = n30.reduce((s, r) => s + r.price, 0); const n7 = rows.filter((r) => r.d >= 0 && r.d <= 7).length; return n30.length ? `<div class="proyban"><span>📈 <b>Proyección del mes:</b> si todos renuevan, en los próximos 30 días entran <b>${bs(proy)}</b></span><small class="muted">${n30.length} servicios · ${n7} vencen esta semana</small></div>` : ""; })()}
        ${T.cf === "cobrar" || T.cfrom ? `<div class="pok ${T.cfrom ? "cobroday" : ""}">${T.cf === "cobrar" ? "Mostrando los que tenés que cobrar: vencidos, de hoy y esperando fecha." : `📅 El <b>${fdate(T.cfrom)}</b>: ${view.length === 1 ? "1 servicio vence" : `${view.length} servicios vencen`} · <b>${bs(sum((r) => r.price))}</b> por cobrar${view.length && canReview() ? ` · ganás ${bs(sum((r) => r.gain))}` : ""}.`} <button class="pbtn sm" type="button" data-hgo="control">Ver todos</button></div>` : ""}
        <div class="tabs ctl-chips" role="tablist">${chips.map(([k, t]) => `<button type="button" role="tab" data-tab="cf:${k}" aria-selected="${(T.cf ?? "todos") === k}">${t}</button>`).join("")}</div>
        <div class="ctl-kindrow"><div class="tabs ctl-chips" role="tablist" aria-label="Tipo de cliente">${[["todos", `👥 Todos (${rows.length})`], ["fin", `💰 Les cobrás vos (${rows.filter((r) => r.kind === "fin").length})`], ["rev", `🏪 De tus revendedores (${rows.filter((r) => r.kind === "rev").length})`]].map(([k, t]) => `<button type="button" role="tab" class="kc-${k}" data-tab="ck:${k}" aria-selected="${(T.ck ?? "todos") === k}">${t}</button>`).join("")}</div>
          <div class="ctl-viewsw" role="group" aria-label="Cómo ver la lista"><button type="button" data-tab="cv:excel" aria-pressed="${xl}">📋 Tabla (Excel)</button><button type="button" data-tab="cv:cards" aria-pressed="${!xl}">🗂️ Tarjetas</button></div></div>
        <div class="inline ctl-filters"><input id="cq" placeholder="Buscar cliente, correo o WhatsApp" value="${esc(T.cq ?? "")}" aria-label="Buscar">
          <select id="cday" aria-label="Día que vence">${opt("", "Día: todos", !T.cday)}${["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"].map((d) => opt(d, `${d[0].toUpperCase() + d.slice(1)} (${rows.filter((r) => r.day === d).length})`, T.cday === d)).join("")}</select>
          <select id="cprod" aria-label="Plataforma">${opt("", "Todas las apps", !T.cprod)}${products.map((x) => opt(x, x.replace(/ \(alquiler revendedores\)/, ""), T.cprod === x)).join("")}</select>
          <select id="cpay" aria-label="Estado de pago">${opt("", "Pago: todos", !T.cpay)}${opt("debe", "Debe (pendiente o no pagó)", T.cpay === "debe")}${Object.entries(PAY).map(([k, t]) => opt(k, t, T.cpay === k)).join("")}</select>
          <label class="cdatelbl">📅 Cobros del día<input type="date" id="cfromDate" value="${T.cfrom ? `${new Date(T.cfrom).getFullYear()}-${String(new Date(T.cfrom).getMonth() + 1).padStart(2, "0")}-${String(new Date(T.cfrom).getDate()).padStart(2, "0")}` : ""}" aria-label="Elegí la fecha para ver cuánto cobrás ese día"></label>
          <label class="cdatelbl">📆 Vencen desde<input type="date" id="cr1" value="${dIn(T.cr1)}" aria-label="Vencen desde"></label>
          <label class="cdatelbl">hasta<input type="date" id="cr2" value="${dIn(T.cr2)}" aria-label="Vencen hasta"></label>
          <select id="csortSel" aria-label="Ordenar por">${opt("", "↕️ Ordenar: por vencimiento", !T.csort)}${COLS.filter(([k]) => k !== "n").flatMap(([k, l]) => [opt(`${k}:asc`, `Ordenar: ${l} ↑`, T.csort === `${k}:asc`), opt(`${k}:desc`, `Ordenar: ${l} ↓`, T.csort === `${k}:desc`)]).join("")}</select>
          <select id="cgroup" aria-label="Agrupar">${opt("", "🗂️ Sin agrupar", !T.cgroup)}${Object.entries(GROUPS).map(([k, [l]]) => opt(k, `Agrupar por ${l.toLowerCase()}`, T.cgroup === k)).join("")}</select>
          <details class="ctl-cols" ${colsOpen ? "open" : ""}><summary class="pbtn">🧱 Columnas${hid.length ? ` (${hid.length} ocultas)` : ""}</summary><div class="ctl-colsbox">${COLS.map(([k, l]) => `<label class="chk"><input type="checkbox" data-ccol="${k}" ${hid.includes(k) ? "" : "checked"}> ${l}</label>`).join("")}</div></details>
          <button class="pbtn" type="button" data-go="vender">➕ Agregar</button>
          ${anyFilter ? `<button class="pbtn" type="button" data-cclear="1">✕ Limpiar filtros</button>` : ""}
          <button class="pbtn" type="button" data-ctlcsv="1">${icon("ext")}Descargar Excel</button></div></section>
      ${(() => {
        // Si el texto buscado coincide con el nombre de UN solo cliente, se muestra su resumen.
        const names = [...new Set(view.map((r) => r.customerName).filter((n) => n.toLowerCase().includes(q)))];
        if (!q || names.length !== 1) return "";
        const mine = view.filter((r) => r.customerName === names[0]);
        const r0 = mine[0];
        return `<section class="card ctl-client"><div><b>${esc(r0.customerName)}</b> <span class="muted">${r0.customerPhone ? esc(r0.customerPhone) : "sin WhatsApp"}</span><br>
          <small>${mine.length} alquiler(es) · ${mine.filter((r) => r.d <= 7).length} vencen en 7 días · total ${bs(mine.reduce((t, r) => t + r.price, 0))}</small>${mine.length < view.length ? `<br><small class="muted">+ ${view.length - mine.length} donde figura como revendedor o en la nota</small>` : ""}</div>
          <div class="inline"><button class="pbtn sm dark" type="button" data-cselall="${esc(names[0])}">Seleccionar sus ${mine.length}</button>${r0.customerPhone ? `<a class="pbtn sm" href="${waLink(r0.customerPhone, `Hola ${r0.customerName} 👋`)}" target="_blank" rel="noopener">${icon("wa")}WhatsApp</a>` : ""}</div></section>`;
      })()}
      <section class="ctl-cards${xl ? " off" : ""}">${view.map((r) => `<article class="ccard rv-${r.est[1]} k-${r.kind}">
        <header><label class="ccheck selbox"><input type="checkbox" class="csel" value="${esc(r.id)}" aria-label="Seleccionar ${esc(r.customerName)}"></label>
          <div><b>${esc(r.customerName)}</b> <small class="muted">#${r.n}</small> ${kb(r)}<br><small>${esc(r.product.replace(/ \(alquiler revendedores\)/, ""))} · ${esc(r.profile)}</small></div>
          <span class="est est-${r.est[1]}">${r.est[0]}${r.est[1] === "hold" ? "" : ` · ${r.d} d`}</span></header>
        <div class="crow mono">${esc(r.email)}</div>
        <div class="crow"><span>Vence <b>${fdate(r.customerExpiresAt)}</b> (${r.day})</span><span>Inicio ${fdate(r.startsAt)}</span></div>
        <div class="crow"><label>Te paga <input class="ctl-in" data-ctl="${esc(r.id)}" data-f="price" value="${(r.price / 100).toString()}" inputmode="decimal"></label>
          <select class="ctl-in pay-${r.pay}" data-ctl="${esc(r.id)}" data-f="payStatus" aria-label="Estado de pago">${Object.entries(PAY).map(([k, t]) => opt(k, t, r.pay === k)).join("")}</select>
          ${r.customerPhone || r.viaRes ? "" : `<span class="pp pp-warn">Sin WhatsApp</span>`}</div>
        ${r.control.note || r.control.seller ? `<div class="crow muted">${esc([r.control.seller, r.control.note].filter(Boolean).join(" · "))}</div>` : ""}
        <footer>${cobrarBtn(r)}
          ${dlvBtn(r)}
          <button class="pbtn sm" type="button" data-copy="${esc(acc(r))}">💻 Cuenta</button>
          <button class="pbtn sm dark" type="button" data-renew="${esc(r.id)}" data-renewinfo="${esc(renewInfo(r))}">✅ Renovar · ${newDate(r)}</button>
          <details class="more"><summary>📅 Fecha</summary><form class="inline" data-expiry="${esc(r.id)}"><input type="date" name="date" required value="${dateInput(canReview() ? Math.max(r.customerExpiresAt, Date.now()) : r.customerExpiresAt)}"${canReview() ? "" : ` max="${dateInput(r.customerExpiresAt)}"`} aria-label="Nueva fecha"><button class="pbtn sm" type="submit">Guardar</button></form>${canReview() ? "" : `<small class="muted">Para alargarla usá ✅ Renovar (queda anotado el cobro).</small>`}</details>
          ${canReview() ? `<button class="pbtn sm" type="button" data-refund="${esc(r.id)}" data-name="${esc(r.customerName || "")}" title="Cerrar este servicio y devolver al cliente la parte proporcional por los días que faltan">↩️ Devolver</button>` : ""}
          ${canReview() ? `<button class="pbtn sm" type="button" data-wastest="${esc(r.id)}" data-name="${esc(r.customerName || "")}" title="La venta no fue real: se libera el perfil y sale de tus números">🧪 Era una prueba</button>` : ""}
          ${canReview() ? transferForm(r) : ""}</footer></article>`).join("") || `<div class="emptybox">Nada con esos filtros.</div>`}</section>
      <div class="ctl-bar" id="ctlBar" hidden><b><span id="ctlN">0</span> ✓</b>
        <button class="pbtn sm dark" type="button" data-cbulk="renew">✅ Renovar +1</button>
        <button class="pbtn sm" type="button" data-cbulk="paid">💵 Pagado</button>
        <button class="pbtn sm" type="button" data-cbulk="clear" aria-label="Quitar selección">✕</button>
        ${canReview() ? `<span class="inline"><input type="date" id="cbDate" aria-label="Fecha para las seleccionadas"><button class="pbtn sm" type="button" data-cbulk="date">📅 Poner fecha</button></span>` : ""}
        ${isOwner() ? `<label class="chk"><input type="checkbox" id="cbBeyond"> renovar aunque pase la fecha del proveedor</label>` : ""}</div>
      <section class="card ctl-card${xl ? " xl" : ""}">${hid.length ? `<style>${hid.map((k) => `table.ctl [data-col="${k}"]{display:none}`).join("")}</style>` : ""}${view.length || anyFilter ? `<div class="scroll ctl-scroll"><table class="ctl"><thead><tr>
        <th><input type="checkbox" id="cselAllT" aria-label="Seleccionar todo"></th>${COLS.map(([k, l]) => `<th data-col="${k}"${k === "customerName" ? ` class="ccli"` : ""}><button type="button" class="thsort" data-csort="${k}" title="Ordenar por ${l}">${l}<span>${sk === k ? (sd === "desc" ? "▼" : "▲") : "↕"}</span></button><input class="cfin" data-cfcol="${k}" value="${esc(cfc[k] ?? "")}" placeholder="🔍 filtrar" aria-label="Filtrar ${l}"></th>`).join("")}<th>Acciones</th></tr></thead><tbody>
        ${view.map((r, i) => {
          const g = grp?.(r), gHead = grp && (i === 0 || grp(view[i - 1]) !== g) ? (() => { const gs = view.filter((x) => grp(x) === g); return `<tr class="ctl-grp"><td colspan="40"><b>${esc(g)}</b> · ${gs.length} fila(s) · te pagan <b>${bs(gs.reduce((t, x) => t + x.price, 0))}</b>${canReview() ? ` · ganancia <b>${bs(gs.reduce((t, x) => t + x.gain, 0))}</b>` : ""}${gs.some((x) => x.d < 0) ? ` · <span class="down">${gs.filter((x) => x.d < 0).length} vencido(s)</span>` : ""}</td></tr>`; })() : "";
          return `${gHead}<tr class="rv-${r.est[1]} k-${r.kind}">
          <td><label class="selbox"><input type="checkbox" class="csel" value="${esc(r.id)}" aria-label="Seleccionar"></label></td><td data-col="n" class="mono">${r.n}</td><td data-col="customerName" class="ccli"><b>${esc(r.customerName)}</b></td><td data-col="kind">${kb(r)}</td>
          <td data-col="customerPhone"><input class="ctl-in mid mono" data-cphone="${esc(r.customerId)}" value="${esc((r.customerPhone || "").replace(/^\+591/, ""))}" placeholder="Sin WhatsApp" inputmode="tel" aria-label="WhatsApp de ${esc(r.customerName)}"></td>
          <td data-col="product">${esc(pname(r))}</td><td data-col="email" class="mono">${esc(r.email)}</td>
          <td data-col="profile">${canReview() && r.slotId ? `<input class="ctl-in mid" data-cslot="${esc(r.slotId)}" value="${esc(r.profile)}" aria-label="Perfil">` : esc(r.profile)}</td>
          <td data-col="startsAt">${fdate(r.startsAt)}</td>
          <td data-col="customerExpiresAt"><input type="date" class="ctl-in date" data-cexp="${esc(r.id)}" value="${dIn(r.customerExpiresAt)}"${canReview() ? "" : ` max="${dIn(r.customerExpiresAt)}"`} aria-label="Vencimiento"></td><td data-col="day">${r.day}</td>
          <td data-col="price"><input class="ctl-in" data-ctl="${esc(r.id)}" data-f="price" value="${(r.price / 100).toString()}" inputmode="decimal" aria-label="Precio"></td>
          ${canReview() ? `<td data-col="cost"><input class="ctl-in" data-ctl="${esc(r.id)}" data-f="cost" value="${(r.cost / 100).toString()}" inputmode="decimal" aria-label="Costo"${r.control.cost === undefined ? ` title="Estimado: lo que te cuesta la cuenta ÷ sus perfiles"` : ""}></td>
          <td data-col="gain" class="${r.gain < 0 ? "down" : "up"}"><b>${(r.gain / 100).toString()}</b></td>` : ""}
          <td data-col="pay"><select class="ctl-in pay-${r.pay}" data-ctl="${esc(r.id)}" data-f="payStatus" aria-label="Estado de pago">${Object.entries(PAY).map(([k, t]) => opt(k, t, r.pay === k)).join("")}</select></td>
          <td data-col="est"><span class="est est-${r.est[1]}">${r.est[0]}</span></td><td data-col="d" class="mono"><b>${r.d}</b></td>
          <td data-col="seller">${r.rname && !r.control.seller ? `<span class="kb kb-rev">🏪 ${esc(r.rname)}</span>` : `<input class="ctl-in wide" data-ctl="${esc(r.id)}" data-f="seller" value="${esc(r.control.seller ?? "")}" aria-label="Revendedor">`}</td>
          <td data-col="note"><input class="ctl-in wide" data-ctl="${esc(r.id)}" data-f="note" value="${esc(r.control.note ?? "")}" aria-label="Nota"></td>
          <td class="ctl-act">${cobrarBtn(r, "Mandar recordatorio de cobro")}
            ${dlvBtn(r)}
            <button class="pbtn sm" type="button" data-copy="${esc(acc(r))}" title="Copiar datos de la cuenta">💻 Cuenta</button>
            <button class="pbtn sm dark" type="button" data-renew="${esc(r.id)}" data-renewinfo="${esc(renewInfo(r))}" title="Renovar un período">✅ Renovar · ${newDate(r)}</button>
            ${canReview() ? transferForm(r) : ""}</td></tr>`;
        }).join("") || `<tr><td colspan="40"><div class="emptybox">Nada con esos filtros.</div></td></tr>`}
        </tbody><tfoot><tr><td></td>${COLS.map(([k]) => `<td data-col="${k}"${k === "customerName" ? ` class="ccli"` : ""}>${k === "customerName" ? `<b>Total · ${view.length} fila(s)</b>` : ["price", "cost", "gain"].includes(k) ? `<b>${bs(sum((r) => r[k]))}</b>` : k === "d" ? `<small>${view.filter((r) => r.d < 0).length} venc.</small>` : ""}</td>`).join("")}<td></td></tr></tfoot></table></div>` : `<div class="emptybox">Nada con esos filtros.</div>`}
        <p class="muted" style="margin:0">Como en Excel: tocá un <b>título</b> para ordenar (otra vez, al revés), escribí en <b>🔍 filtrar</b> debajo de cada título, y con <b>🧱 Columnas</b> escondés las que no usás. WhatsApp, perfil, vencimiento, precio, costo, pago, revendedor y nota se guardan solos al salir de la casilla. La fila azul de abajo suma lo que estás viendo.</p></section>`;
  },

  /* Fiado: lo que te deben, por persona, con pagos parciales y fecha de cobro. */
  async fallas() {
    const list = await api("GET", "/api/admin/tickets");
    const ST = { recibido: ["📥 Recibido", "bad"], revisando: ["🔧 Revisando", "warn"], solucionado: ["✅ Solucionado", "ok"] };
    const open = list.filter((t) => t.status !== "solucionado").length;
    const msg = (t) => `Hola ${t.reporter.split(" ")[0]} 👋 sobre tu reporte de ${t.product} (${t.client}): `;
    return `<section class="card"><h2>🛠️ Fallas reportadas ${open ? pill(`${open} abierta(s)`, "bad") : pill("Todo al día", "ok")}</h2>
      <p class="muted" style="margin:0">Lo que te reportan tus clientes y revendedores desde su panel ("no me deja entrar", "me pide código"…). Cambiá el estado y, si querés, dejá una respuesta: lo ven en su panel y, si activaron los avisos, les llega al celular.</p></section>
      ${list.map((t) => `<section class="card tkt tkt-${t.status}"><div class="inline" style="justify-content:space-between;flex-wrap:wrap"><b>${esc(t.product)} · ${esc(t.profile)}</b>${pill(ST[t.status][0], ST[t.status][1])}</div>
        <p class="muted" style="margin:0">Cliente: <b>${esc(t.client)}</b>${t.reporter !== t.client ? ` · reportó ${esc(t.reporter)} (${t.reporterKind === "reseller" ? "🏪 revendedor" : "👤 cliente"})` : ""} · ${fdate(t.createdAt)}</p>
        <p style="margin:0"><b>${esc(t.kindText)}</b>${t.note ? ` — “${esc(t.note)}”` : ""}</p>
        ${t.email ? `<p class="muted" style="margin:0">Cuenta: <code>${esc(t.email)}</code></p>` : ""}
        <form class="form" data-tkt="${esc(t.id)}"><label style="grid-column:1/-1">Respuesta para quien reportó (opcional)<input name="reply" maxlength="300" value="${esc(t.reply)}" placeholder="Ej.: te pasamos a otra cuenta, revisá tus datos en Mis cuentas"></label>
          <div class="inline" style="grid-column:1/-1;flex-wrap:wrap">${Object.keys(ST).map((s) => `<button class="pbtn ${t.status === s ? "dark" : ""}" type="submit" name="st" value="${s}">${ST[s][0]}</button>`).join("")}
          ${t.reporterPhone ? `<a class="pbtn" href="${waLink(t.reporterPhone, msg(t))}" target="_blank" rel="noopener">${icon("wa")}WhatsApp</a>` : ""}${t.assignmentId ? `<button class="pbtn" type="button" data-deliver="${esc(t.assignmentId)}">📲 Reenviar accesos</button>` : ""}${canReview() ? `<button class="pbtn" type="button" data-go="reubicar">🔀 Reubicar</button>` : ""}</div></form></section>`).join("") || `<section class="card"><p class="muted" style="margin:0">No hay fallas reportadas 🎉</p></section>`}`;
  },
  async fiado() {
    const T = P.tab;
    const [ov, customers] = await Promise.all([api("GET", "/api/admin/fiado"), canReview() ? api("GET", "/api/admin/customers").catch(() => []) : []]);
    const k = T.fk ?? "todos", q = (T.fq ?? "").toLowerCase();
    const rows = ov.rows.filter((r) => (k === "todos" || (k === "rev") === (r.kind === "reseller")) && (!q || `${r.name} ${r.phone}`.toLowerCase().includes(q)));
    const det = T.fdet ? await api("GET", `/api/admin/fiado/${T.fdet}`).catch(() => null) : null;
    const detName = ov.rows.find((r) => r.customerId === T.fdet)?.name ?? customers.find((c) => c.id === T.fdet)?.name ?? "";
    const kb = (r) => (r.kind === "reseller" ? `<span class="kb kb-rev">🏪 Revendedor</span>` : `<span class="kb kb-fin">👤 Cliente final</span>`);
    const msg = (r) => `Hola ${r.name.split(" ")[0]} 👋 te paso tu cuenta: me debés *${bs(r.owed)}*${r.nextDue ? ` (para el ${fdate(r.nextDue)})` : ""}. ¿Me podés pagar hoy? ¡Gracias! 🙌`;
    const pend = ov.rows.filter((r) => r.unlinked.count);
    const card = (r) => `<article class="fcardx${r.overdue ? " late" : ""}">
        <header><div><b>${esc(r.name)}</b> ${kb(r)}<br><small class="muted">${esc(r.phone ? r.phone.replace(/^\+591/, "") : "Sin WhatsApp")}</small></div>
          <div class="fowed"><small>Debe</small><b class="${r.owed ? "down" : "up"}">${bs(r.owed)}</b>${r.credit ? `<small class="up">a favor ${bs(r.credit)}</small>` : ""}</div></header>
        ${r.nextDue || r.oldestAt ? `<div class="frow">${r.nextDue ? `<span>${r.overdue ? "⏰ <b>Ya tenía que pagar</b>" : "📅 Cobrar"} el <b>${fdate(r.nextDue)}</b></span>` : ""}${r.oldestAt ? `<span class="muted">Debe desde ${fdate(r.oldestAt)}</span>` : ""}</div>` : ""}
        ${r.unlinked.count && canReview() ? `<div class="fpend"><span>📋 ${r.unlinked.count} alquiler(es) marcado(s) sin pagar en el Control · ${bs(r.unlinked.amount)}</span><button class="pbtn sm" type="button" data-ffrom="${esc(r.customerId)}">➕ Pasarlos al fiado</button></div>` : ""}
        <footer>${r.phone && r.owed ? `<a class="pbtn sm green" href="${waLink(r.phone, msg(r))}" target="_blank" rel="noopener">💬 Cobrar</a>` : ""}
          ${canReview() ? `<details class="more"><summary>💵 Me pagó</summary><form class="fform" data-fpay="${esc(r.customerId)}"><label>Monto (${currencySym()})<input name="amount" inputmode="decimal" required value="${r.owed ? r.owed / 100 : ""}"></label><label>Nota<input name="note" placeholder="QR, efectivo, una parte…" maxlength="120"></label><button class="pbtn sm green" type="submit">Guardar pago</button></form></details>
          <details class="more"><summary>➕ Fiar más</summary><form class="fform" data-fcharge="${esc(r.customerId)}"><label>Monto (${currencySym()})<input name="amount" inputmode="decimal" required></label><label>¿Qué le fiaste?<input name="note" maxlength="120" placeholder="Disney perfil 3, préstamo…"></label><label>Cobrar el<input type="date" name="due"></label><button class="pbtn sm dark" type="submit">Guardar</button></form></details>` : ""}
          <button class="pbtn sm" type="button" data-fdet="${esc(r.customerId)}" aria-pressed="${T.fdet === r.customerId}">📜 Movimientos</button></footer></article>`;
    return `<section class="card"><h2>💸 Fiado <small>· lo que te deben</small></h2>
        <div class="ctl-kpis"><div><small>Te deben</small><b class="down">${bs(ov.totals.owed)}</b></div><div><small>Personas que deben</small><b>${ov.totals.people}</b></div><div><small>Cobros vencidos</small><b class="${ov.totals.overdue ? "down" : ""}">${ov.totals.overdue}</b></div><div><small>A cobrar esta semana</small><b>${ov.totals.dueWeek}</b></div><div><small>Sin pasar del Control</small><b>${bs(ov.totals.unlinked)}</b></div></div>
        <p class="muted" style="margin:0">Anotá lo que fiás y lo que te van pagando (puede ser de a poco). Los pagos cubren primero lo más viejo; cuando un alquiler del Control queda cubierto, pasa solo a <b>Pagado</b>.</p>
        ${pend.length && canReview() ? `<div class="fpend"><span>📋 En el Control hay <b>${pend.reduce((t, r) => t + r.unlinked.count, 0)}</b> alquiler(es) "Pendiente" o "No pagó" de ${pend.length} persona(s) (${bs(ov.totals.unlinked)}).</span><button class="pbtn sm dark" type="button" data-ffromall="1">➕ Pasar todos al fiado</button></div>` : ""}
        <div class="tabs ctl-chips" role="tablist">${[["todos", `Todos (${ov.rows.length})`], ["fin", `👤 Clientes finales (${ov.rows.filter((r) => r.kind !== "reseller").length})`], ["rev", `🏪 Revendedores (${ov.rows.filter((r) => r.kind === "reseller").length})`]].map(([x, t]) => `<button type="button" role="tab" data-tab="fk:${x}" aria-selected="${k === x}">${t}</button>`).join("")}</div>
        <input id="fq" placeholder="🔍 Buscar por nombre o WhatsApp" value="${esc(T.fq ?? "")}" aria-label="Buscar en el fiado"></section>
      ${canReview() ? `<section class="card"><details ${ov.rows.length ? "" : "open"}><summary><b>➕ Anotar un fiado nuevo</b></summary>
        <form class="fform" id="fNewForm" style="margin-top:10px"><label>Cliente o revendedor<input name="who" list="fWho" required placeholder="Escribí el nombre" autocomplete="off"></label>
          <datalist id="fWho">${customers.map((c) => `<option value="${esc(`${c.name} · ${c.phone || "sin WhatsApp"}`)}"></option>`).join("")}</datalist>
          <label>Monto (${currencySym()})<input name="amount" inputmode="decimal" required></label><label>¿Qué le fiaste?<input name="note" maxlength="120" placeholder="Disney perfil 3, préstamo…"></label>
          <label>Cobrar el<input type="date" name="due"></label><button class="pbtn dark" type="submit">Guardar</button></form></details></section>` : ""}
      ${det ? `<section class="card"><h2>📜 Movimientos de ${esc(detName)} · debe ${bs(det.owed)} <button class="pbtn sm" type="button" data-fdet="">Cerrar</button></h2>
        ${table(["Fecha", "Qué", "Monto", "Nota", "Estado", ""], det.entries.map((x) => `<tr><td>${fdt(x.at)}</td><td>${x.kind === "cargo" ? "➕ Le fiaste" : "💵 Te pagó"}</td>
          <td class="${x.kind === "cargo" ? "down" : "up"}"><b>${bs(x.amount)}</b></td><td>${esc(x.note || "")}${x.dueAt ? `<br><small class="muted">cobrar el ${fdate(x.dueAt)}</small>` : ""}</td>
          <td>${x.kind === "cargo" ? (x.covered >= x.amount ? pill("Pagado", "ok") : x.covered ? pill(`Pagó ${bs(x.covered)}`, "warn") : pill("Debe", "bad")) : ""}</td>
          <td>${canReview() ? `<button class="pbtn sm danger" type="button" data-fdel="${esc(x.id)}" title="Borrar este movimiento">🗑️</button>` : ""}</td></tr>`), "Sin movimientos.")}</section>` : ""}
      <section class="fgrid">${rows.map(card).join("") || `<div class="emptybox">${ov.rows.length ? "Nadie con ese filtro." : "Nadie te debe nada 🎉"}</div>`}</section>`;
  },

  async renovar() {
    const [list, customers] = await Promise.all([api("GET", "/api/admin/assignments"), api("GET", "/api/admin/customers")]);
    return `<section class="card"><div class="inline"><button class="pbtn dark sm" type="button" data-renewsel="1">${icon("renew")}Renovar seleccionados (+1 período, efectivo)</button><span class="muted">${list.length} servicios activos</span></div>
      <div class="inline" style="margin-top:8px"><label class="chk"><input type="checkbox" id="selAll"> Seleccionar todos</label></div>
      ${table(["", "Cliente", "Producto", "Cuenta / perfil", "Vence cliente", "Vence proveedor", "Acciones"], list.map((a) => {
        const d = daysLeft(a.customerExpiresAt);
        return `<tr><td><label class="selbox"><input type="checkbox" class="sel" value="${esc(a.id)}" aria-label="Seleccionar"></label></td><td>${esc(a.customerName)}${a.customerPhone ? "" : `<br>${pill("Sin WhatsApp", "warn")}`}</td><td>${esc(a.product)}</td><td class="mono">${esc(a.email)}<br><small class="muted">${esc(a.profile)}${a.passwordPending ? " · clave pendiente" : ""}</small></td>
          <td>${fdate(a.customerExpiresAt)} ${d <= 3 ? pill(d < 0 ? "Vencido" : `${d} d`, d < 0 ? "bad" : "warn") : ""}${a.holdOpen ? `<br>${pill("Esperando fecha", "mute")}` : ""}</td><td>${fdate(a.supplierExpiresAt)}</td>
          <td><button class="pbtn sm dark" type="button" data-renew="${esc(a.id)}">+1 período</button>
          <details class="more" ${a.holdOpen ? "open" : ""}><summary>Cambiar fecha</summary><form class="inline" data-expiry="${esc(a.id)}" style="margin-top:6px"><input type="date" name="date" required value="${dateInput(canReview() ? Math.max(a.customerExpiresAt, Date.now()) : a.customerExpiresAt)}"${canReview() ? "" : ` max="${dateInput(a.customerExpiresAt)}"`} aria-label="Nueva fecha de vencimiento"><button class="pbtn sm" type="submit">Guardar</button></form></details>
          ${canReview() ? `<details class="more"><summary>Reemplazar</summary><form class="inline" data-replace="${esc(a.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo (p. ej. perfil bloqueado)" required><label class="chk"><input type="checkbox" name="other"> otra cuenta</label><button class="pbtn sm" type="submit">Reemplazar</button></form></details>
          <details class="more"><summary>Transferir</summary><form class="inline" data-transfer="${esc(a.id)}" style="margin-top:6px"><select name="to" required aria-label="Nuevo dueño"><option value="">Pasar a…</option>${customers.filter((c) => c.id !== a.customerId).map((c) => opt(c.id, c.name)).join("")}</select><input name="reason" placeholder="Motivo" required><button class="pbtn sm" type="submit">Transferir</button></form></details>` : ""}</td></tr>`;
      }), "No hay servicios activos.")}
      <p class="muted" style="margin:0">Renovar mueve solo la fecha del cliente. Si se pasaría de la fecha del proveedor, el sistema lo frena: renová con el proveedor o reemplazá el perfil.</p></section>`;
  },

  async recordatorios() {
    const days = P.tab.days ?? 3;
    const [list, rs] = await Promise.all([api("GET", `/api/admin/assignments?days=${days}`), api("GET", "/api/admin/reminders/settings")]);
    const OPTS = [[7, "7 días antes"], [5, "5 días antes"], [3, "3 días antes"], [2, "2 días antes"], [1, "1 día antes"], [0, "El mismo día"]];
    const auto = `<section class="card"><h2>${icon("bell")}Recordatorios automáticos ${rs.enabled ? pill("Activados", "ok") : pill("Apagados", "mute")}</h2>
      <p class="muted" style="margin:0">El sistema avisa solo a cada cliente antes de que venza su servicio: <b>una vez por cada día marcado</b> y solo en el horario elegido (hora de Bolivia). Si renueva, el aviso vuelve a salir en el próximo vencimiento.</p>
      <form id="remForm" style="display:grid;gap:12px">
        <label class="chk"><input type="checkbox" name="enabled" ${rs.enabled ? "checked" : ""} ${canReview() ? "" : "disabled"}> Mandar recordatorios automáticos</label>
        <div class="inline">${OPTS.map(([d, t]) => `<label class="chk" style="border:1px solid var(--line);border-radius:8px;padding:6px 10px"><input type="checkbox" name="d" value="${d}" ${rs.daysBefore.includes(d) ? "checked" : ""} ${canReview() ? "" : "disabled"}> ${t}</label>`).join("")}</div>
        <div class="inline"><label class="inline" style="display:flex">Desde las<select name="fromHour" ${canReview() ? "" : "disabled"}>${Array.from({ length: 24 }, (_, h) => opt(h, `${h}:00`, h === rs.fromHour)).join("")}</select></label>
        <label class="inline" style="display:flex">hasta las<select name="toHour" ${canReview() ? "" : "disabled"}>${Array.from({ length: 24 }, (_, h) => opt(h + 1, `${h + 1}:00`, h + 1 === rs.toHour)).join("")}</select></label>
        ${canReview() ? `<button class="pbtn dark" type="submit">Guardar</button>` : ""}</div></form>
      <p class="muted" style="margin:0">Los avisos salen por WhatsApp si el bot está conectado; si no, quedan en <b>WhatsApp → Avisos</b> para mandarlos con un toque.</p></section>`;
    return auto + `<section class="card"><div class="inline"><label class="inline" style="display:flex">Vencen en los próximos<select id="days">${[1, 3, 7, 15].map((d) => opt(d, `${d} días`, d === days)).join("")}</select></label>
      ${canReview() ? `<button class="pbtn" type="button" data-remind="${days}">${icon("bell")}Preparar avisos para estos</button>` : ""}</div>
      ${table(["Cliente", "Producto", "Vence", "Último recordatorio"], list.map((a) => `<tr><td>${esc(a.customerName)}</td><td>${esc(a.product)}</td><td>${fdate(a.customerExpiresAt)} ${pill(daysLeft(a.customerExpiresAt) < 0 ? "Vencido" : `${daysLeft(a.customerExpiresAt)} d`, "warn")}</td><td>${a.lastReminderAt ? fdt(a.lastReminderAt) : "Nunca"}</td></tr>`), "Nadie vence en ese plazo.")}
      <p class="muted" style="margin:0">“Preparar” deja un mensaje por cliente en <b>WhatsApp</b> (máximo uno por día). Desde ahí los mandás.</p></section>`;
  },

  async cuentas() {
    const show = P.tab.secrets && canReview();
    const [accs, products, suppliers, customers, alerts] = await Promise.all([api("GET", "/api/admin/accounts" + (show ? "?secrets=1" : "")), api("GET", "/api/admin/products"), api("GET", "/api/admin/suppliers"), api("GET", "/api/admin/customers").catch(() => []), api("GET", "/api/admin/account-alerts?unseen=1").catch(() => [])]);
    const alertsCard = alerts.length ? `<section class="card alertcard"><h2>🚨 Avisos de las plataformas <small>${alerts.length} sin ver</small></h2>
      <p class="muted" style="margin:0">Correos que llegaron a tus cuentas y pueden significar un problema. Revisá la cuenta antes de que se quejen tus clientes.</p>
      <div class="alertlist">${alerts.map((a) => `<div class="alertrow ${a.severe ? "sev" : ""}"><div><b>${esc(a.product)}</b> <span class="mono">${esc(a.email)}</span><br>
        <small>${a.severe ? "⚠️" : "ℹ️"} ${esc(a.text)} · ${fdt(a.at)}${a.clients ? ` · <b>${a.clients} cliente(s)</b> en esta cuenta` : ""}${a.source === "ai" ? " · detectado por IA" : ""}</small><br><small class="muted">"${esc(a.subject)}"</small></div>
        <div class="inline"><button class="pbtn sm" type="button" data-go="reubicar">Reubicar</button><button class="pbtn sm" type="button" data-alertseen="${esc(a.id)}">✓ Visto</button></div></div>`).join("")}</div></section>` : "";
    const pname = (id) => products.find((p) => p.id === id)?.name ?? id;
    // Panel para asignar/liberar un perfil tocado.
    let slotCard = "";
    if (P.tab.slotAct && canReview()) {
      let acc, sl;
      for (const x of accs) { const f = x.slots.find((y) => y.id === P.tab.slotAct); if (f) { acc = x; sl = f; break; } }
      if (acc && sl) {
        const head = `Perfil <b>${esc(sl.label)}</b> · ${esc(pname(acc.productId))} · <span class="mono">${esc(acc.email)}</span>`;
        if (sl.status === "assigned") {
          slotCard = `<section class="card ok-card"><h2>${head}</h2>
            <p class="muted" style="margin:0">Ocupado por <b>${esc(sl.customerName || "—")}</b>${sl.customerPhone ? ` · ${esc(sl.customerPhone)}` : ""}${sl.expiresAt ? ` · vence ${fdate(sl.expiresAt)}` : ""}.</p>
            <div class="inline">${sl.assignmentId ? `<button class="pbtn green" type="button" data-renew="${esc(sl.assignmentId)}" data-renewinfo="¿Renovar este alquiler un período más?">${icon("renew")}Renovar</button><button class="pbtn" type="button" data-paid="${esc(sl.assignmentId)}">💵 Cobrado</button><button class="pbtn" type="button" data-deliver="${esc(sl.assignmentId)}">📲 Enviar accesos</button>` : ""}<button class="pbtn dark" type="button" data-slotrelease="${esc(sl.id)}">🔓 Liberar</button>${sl.customerPhone ? `<a class="pbtn" href="${waLink(sl.customerPhone, `Hola ${(sl.customerName || "").split(" ")[0]} 👋, te recuerdo el pago de tu ${esc(pname(acc.productId))}${sl.expiresAt ? ` que vence el ${fdate(sl.expiresAt)}` : ""}. ¿Lo renovamos? 🙌`)}" target="_blank" rel="noopener">${icon("wa")}Cobrar por WA</a>` : ""}<button class="pbtn" type="button" data-tab="slotAct:">Cerrar</button></div>
            <p class="muted" style="margin:0;font-size:12.5px">Al liberar, deja de contar para ese cliente (y sus códigos) y queda libre para vender a otro.</p></section>`;
        } else if (sl.status === "available") {
          slotCard = `<section class="card ok-card"><h2>Asignar ${head}</h2>
            <form class="form" id="slotAssign" data-slot="${esc(sl.id)}" data-prod="${esc(acc.productId)}">
              <label>Cliente<select name="customerId"><option value="">— Elegí un cliente —</option><option value="__new">➕ Cliente nuevo</option>${customers.map((c) => opt(c.id, `${c.name} · ${c.phone}`)).join("")}</select></label>
              <div class="newcli" hidden><label>Nombre<input name="newName" placeholder="Ej.: Armin"></label><label>WhatsApp<input name="newPhone" inputmode="tel" placeholder="+591 70000000"></label></div>
              <label>📅 Desde<input type="date" name="startDate" value="${dateInput(Date.now())}"></label>
              <label>📅 Vence<input type="date" name="endDate" value="${dateInput(Date.now() + 30 * 86400000)}"></label>
              <label>Cobrado con<select name="paymentMethod">${opt("cash", "Efectivo / QR ya verificado")}${opt("balance", "Saldo del cliente")}</select></label>
              <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">✅ Asignar este perfil</button><button class="pbtn" type="button" data-tab="slotAct:">Cancelar</button></div></form></section>`;
        } else {
          slotCard = `<section class="card ok-card"><h2>${head}</h2><p class="muted" style="margin:0">Estado: ${esc(sl.status)}.</p><div class="inline"><button class="pbtn dark" type="button" data-slotrelease="${esc(sl.id)}">🔓 Poner libre</button><button class="pbtn" type="button" data-tab="slotAct:">Cerrar</button></div></section>`;
        }
      }
    }
    const a = accs.find((x) => x.id === P.tab.editAcc);
    const editCard = a && canReview() ? `<section class="card"><h2>Editar cuenta ${esc(a.email)} <small>· ${esc(pname(a.productId))}</small></h2><form class="form" data-editacc="${esc(a.id)}">
            <label>Email<input name="email" type="email" value="${esc(a.email)}"></label>
            <label>Contraseña nueva<input name="password" placeholder="Vacío = no cambia" autocomplete="off"></label>
            <label>Proveedor<select name="supplierId">${opt("propias", "Propias (tuyas, sin proveedor)", a.supplierId === "propias")}${suppliers.filter((s) => s.id !== "propias" && (s.active || s.id === a.supplierId)).map((s) => opt(s.id, s.name, s.id === a.supplierId)).join("")}</select></label>
            <label>Vence con el proveedor<input name="exp" type="date" value="${dateInput(a.supplierExpiresAt)}"></label>
            <label>Costo (${currencySym()})<input name="cost" inputmode="decimal" value="${a.cost / 100}"></label>
            <label style="grid-column:1/-1">Notas internas<input name="notes" maxlength="500" value="${esc(a.notes ?? "")}" placeholder="Ej.: el proveedor cambió la clave el sábado"></label>
            <div style="grid-column:1/-1;display:grid;gap:6px;max-width:560px"><div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;gap:8px" class="muted"><small>Perfil</small><small>PIN</small><small>Estado</small></div>
            ${a.slots.filter((s) => s.status !== "retired").map((s) => `<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;gap:8px;align-items:center"><input name="label-${esc(s.id)}" value="${esc(s.label)}" aria-label="Nombre del perfil"><input name="pin-${esc(s.id)}" value="${esc(s.pin ?? "")}" placeholder="Sin PIN" inputmode="numeric" maxlength="8" aria-label="PIN de ${esc(s.label)}"><small class="muted">${{ available: "libre", reserved: "reservado", assigned: "vendido", quarantined: "cuarentena" }[s.status] ?? s.status}</small></div>`).join("")}</div>
            <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">Guardar cambios</button><button class="pbtn" type="button" data-editaccopen="">Cancelar</button></div><small class="muted" style="grid-column:1/-1">Si cambiás email o contraseña, los clientes ven el dato nuevo en Mis cuentas y les queda un aviso en WhatsApp.</small></form></section>
      <section class="card ok-card"><h2>💳 Pagué la renovación <small>· ${esc(a.email)}</small></h2>
        <p class="muted" style="margin:0">Anota el pago como gasto (para tu ganancia real) y corre el vencimiento con el proveedor, manteniendo el día de cobro. Hoy vence el <b>${fdate(a.supplierExpiresAt)}</b>.</p>
        <form class="form" data-renewpaid="${esc(a.id)}">
          <label>¿Cuánto pagaste? (${currencySym()})<input name="amount" inputmode="decimal" required value="${a.cost ? a.cost / 100 : ""}" placeholder="Ej.: 66"></label>
          <label>¿Cuántos meses?<select name="months">${[1, 2, 3, 6, 12].map((m) => opt(m, m === 1 ? "1 mes" : `${m} meses`, m === 1)).join("")}</select></label>
          <button class="pbtn dark" type="submit" style="grid-column:1/-1">💳 Registrar pago y renovar</button></form></section>` : "";
    const estadoTxt = { available: "Libre", reserved: "Reservado", assigned: "Vendido", quarantined: "Cuarentena", retired: "Retirado" };
    const estadoK = { available: "ok", assigned: "warn", reserved: "mute", quarantined: "bad", retired: "mute" };
    // Mapa de perfiles en colores + filtros (estilo Netxly).
    const now = Date.now();
    const slotDL = (s) => (s.expiresAt ? Math.ceil((s.expiresAt - now) / 86400000) : null);
    const slotState = (s) => { if (s.status === "available") return "free"; if (s.status === "assigned") { const dl = slotDL(s); return dl !== null && dl < 0 ? "exp" : dl !== null && dl <= 3 ? "soon" : "busy"; } if (s.status === "reserved") return "res"; return "mute"; };
    const vivosOf = (a) => a.slots.filter((s) => s.status !== "retired");
    const af = P.tab.accf ?? "todas";
    const prov7 = (a) => a.status !== "retired" && a.supplierExpiresAt >= now && a.supplierExpiresAt - now <= 7 * 86400000;
    const cnt = (fn) => accs.reduce((n, a) => n + vivosOf(a).filter(fn).length, 0);
    const fchips = [["todas", "Todas", cnt(() => true)], ["libres", "Disponibles", cnt((s) => s.status === "available")], ["ocupadas", "Ocupadas", cnt((s) => s.status === "assigned")], ["vencer", "Cliente vence (3 días)", cnt((s) => slotState(s) === "soon")], ["vencidas", "Cliente vencido", cnt((s) => slotState(s) === "exp")], ["cuarentena", "En cuarentena", cnt((s) => s.status === "quarantined")], ["prov7", "📅 Proveedor ≤ 7 días", accs.filter(prov7).length]];
    const matchF = (a) => { const sv = vivosOf(a); return af === "todas" || (af === "libres" && sv.some((s) => s.status === "available")) || (af === "ocupadas" && sv.some((s) => s.status === "assigned")) || (af === "vencer" && sv.some((s) => slotState(s) === "soon")) || (af === "vencidas" && sv.some((s) => slotState(s) === "exp")) || (af === "cuarentena" && sv.some((s) => s.status === "quarantined")) || (af === "prov7" && prov7(a)); };
    const aq = (P.tab.accq ?? "").trim().toLowerCase();
    const matchQ = (a) => !aq || `${a.email} ${pname(a.productId)} ${a.slots.map((s) => s.customerName || "").join(" ")}`.toLowerCase().includes(aq);
    const shownAccs = accs.filter(matchF).filter(matchQ);
    const prodOf = (id) => products.find((x) => x.id === id);
    const svbadge = (a) => { const p = prodOf(a.productId); return p?.imageFileRef ? `<img class="svbadge" src="/api/products/${esc(p.id)}/image" alt="" loading="lazy">` : brandBadge(pname(a.productId), p?.color); };
    const cards = shownAccs.map((a) => {
      const d = daysLeft(a.supplierExpiresAt);
      const libres = a.slots.filter((s) => s.status === "available").length;
      const vivos = a.slots.filter((s) => s.status !== "retired");
      return `<article class="acard">
        <header><div class="ahead">${svbadge(a)}<div><b>${esc(pname(a.productId))}</b><small class="mono">${esc(a.email)}</small></div></div>${a.status === "active" ? pill(`${libres} libre${libres === 1 ? "" : "s"}`, libres ? "ok" : "mute") : pill("Retirada", "mute")}</header>
        ${a.notes ? `<p class="anote">📝 ${esc(a.notes)}</p>` : ""}
        <div class="arow"><span class="muted">🔑 Clave</span><b class="mono">${esc(a.password)}</b></div>
        <div class="arow"><span class="muted">🏷️ Proveedor</span><span>${esc(a.supplierId === "propias" ? "Propia (tuya)" : suppliers.find((s) => s.id === a.supplierId)?.name ?? a.supplierId)}</span></div>
        <div class="arow"><span class="muted">📅 Vence</span><span>${fdate(a.supplierExpiresAt)} ${d <= 7 ? pill(d < 0 ? "Vencida" : `${d} d`, "warn") : ""}</span></div>
        <div class="pmap">${vivos.map((s) => { const st = slotState(s), dl = slotDL(s); return `<button type="button" class="pdot p-${st}${canReview() ? " clk" : ""}" ${canReview() ? `data-slotact="${esc(s.id)}"` : "disabled"} title="${esc(s.label)}: ${estadoTxt[s.status] ?? s.status}${s.status === "assigned" && s.customerName ? ` · ${esc(s.customerName.split(" ")[0])}${dl !== null ? ` (${dl < 0 ? "venció" : dl + "d"})` : ""}` : ""}">${icon("user")}</button>`; }).join("")}</div>
        ${(() => { const occ = vivos.filter((s) => s.status === "assigned" && s.customerName); if (!occ.length) return ""; return `<details class="occ"><summary>👥 Quién está en esta cuenta <small class="muted">(${occ.length} ocupado${occ.length === 1 ? "" : "s"})</small></summary><div class="occlist">${occ.map((s) => { const dl = slotDL(s); return `<div class="occrow"><span><b>${esc(s.label)}</b> → ${esc(s.customerName)}</span>${dl !== null ? `<span class="pp pp-${dl < 0 ? "bad" : dl <= 7 ? "warn" : "ok"}">${dl < 0 ? "venció" : dl === 0 ? "hoy" : `${dl}d`}</span>` : ""}</div>`; }).join("")}</div></details>`; })()}
        ${canReview() ? `<footer><button class="pbtn sm" type="button" data-editaccopen="${esc(a.id)}">${icon("edit")}Editar</button>${a.slots.some((s2) => s2.status === "quarantined") ? `<button class="pbtn sm green" type="button" data-unquar="${esc(a.id)}">✅ Liberar ${a.slots.filter((s2) => s2.status === "quarantined").length} en cuarentena</button>` : ""}${a.status === "active" ? `<details class="more"><summary>Cuenta caída</summary><form class="inline" data-down="${esc(a.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo" required><button class="pbtn sm" type="submit">Mover clientes y retirar</button></form></details>` : ""}</footer>` : ""}
      </article>`;
    }).join("");
    return `${alertsCard}${slotCard}${editCard}<section class="card"><div class="inline">${canReview() ? `<button class="pbtn sm" type="button" data-secrets="1">${icon("eye")}${show ? "Ocultar contraseñas" : "Mostrar contraseñas"}</button>` : ""}<button class="pbtn sm" type="button" data-go="carga">${icon("plus")}Cargar cuenta</button><span class="muted">${accs.length} cuentas</span></div>
      <input id="accq" class="rsearch" placeholder="🔍 Buscar por correo, servicio o cliente" value="${esc(P.tab.accq ?? "")}" aria-label="Buscar cuenta" style="margin-top:8px">
      <div class="tabs ctl-chips accf-chips" role="tablist">${fchips.map(([k, t, c]) => `<button type="button" role="tab" data-tab="accf:${k}" aria-selected="${af === k}">${t} <span class="chipn">${c}</span></button>`).join("")}</div>
      <div class="pleg"><span><i class="p-free"></i>Libre</span><span><i class="p-busy"></i>Ocupado</span><span><i class="p-soon"></i>Por vencer</span><span><i class="p-exp"></i>Vencido</span></div>
      <div class="acc-cards">${accs.length ? (shownAccs.length ? cards : `<div class="emptybox">Ninguna cuenta con ese filtro.</div>`) : `<div class="emptybox">Todavía no cargaste cuentas.</div>`}</div>
      <div class="acc-table">${table(["Producto", "Email", "Contraseña", "Perfiles", "Proveedor", "Vence proveedor", "Estado", ""], shownAccs.map((a) => {
        const d = daysLeft(a.supplierExpiresAt);
        return `<tr><td>${esc(pname(a.productId))}</td><td class="mono">${esc(a.email)}${a.notes ? `<br><small class="muted" style="font-family:inherit">📝 ${esc(a.notes)}</small>` : ""}</td><td class="mono">${esc(a.password)}</td>
          <td><div style="display:flex;flex-wrap:wrap;gap:4px">${a.slots.map((s) => canReview() ? `<button type="button" class="pp pp-${{ available: "ok", assigned: "warn", reserved: "mute", quarantined: "bad", retired: "mute" }[s.status]} clk" data-slotact="${esc(s.id)}" style="border:0;cursor:pointer;font:inherit">${esc(s.label)}: ${{ available: "libre", reserved: "reservado", assigned: "vendido", quarantined: "cuarentena", retired: "retirado" }[s.status]}${s.status === "assigned" && s.customerName ? ` · ${esc(s.customerName.split(" ")[0])}` : ""}</button>` : pill(`${s.label}: ${{ available: "libre", reserved: "reservado", assigned: "vendido", quarantined: "cuarentena", retired: "retirado" }[s.status]}`, { available: "ok", assigned: "warn", reserved: "mute", quarantined: "bad", retired: "mute" }[s.status])).join("")}</div></td>
          <td>${esc(a.supplierId === "propias" ? "Propia (tuya)" : suppliers.find((s) => s.id === a.supplierId)?.name ?? a.supplierId)}</td><td>${fdate(a.supplierExpiresAt)} ${d <= 7 ? pill(d < 0 ? "Vencida" : `${d} d`, "warn") : ""}</td>
          <td>${a.status === "active" ? pill("Activa", "ok") : pill("Retirada", "mute")}</td>
          <td>${canReview() ? `<button class="pbtn sm" type="button" data-editaccopen="${esc(a.id)}">${icon("edit")}Editar</button>` : ""}
          ${a.status === "active" && canReview() ? `<details class="more"><summary>Cuenta caída</summary><form class="inline" data-down="${esc(a.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo" required><button class="pbtn sm" type="submit">Mover clientes y retirar</button></form></details>` : ""}</td></tr>`;
      }), "Todavía no cargaste cuentas.")}</div></section>`;
  },

  async carga() {
    const [products, suppliers] = await Promise.all([api("GET", "/api/admin/products"), api("GET", "/api/admin/suppliers")]);
    if (!products.length) return `<section class="card"><div class="emptybox">Antes de cargar cuentas creá al menos un producto.<div class="inline"><button class="pbtn dark" type="button" data-go="productos">Crear producto</button></div></div></section>`;
    const sel = (name) => `<select name="${name}">${name === "supplierId" ? `<option value="">Propias (sin proveedor)</option>` : ""}${(name === "productId" ? products.filter((x) => x.kind !== "iptv") : suppliers.filter((s) => s.active)).map((x) => opt(x.id, x.name)).join("")}</select>`;
    const iptvProds = products.filter((p) => p.kind === "iptv");
    const iptvCard = !iptvProds.length ? "" : `<section class="card ok-card"><h2>📺 Registrar línea IPTV <small>· Flujo TV, Más TV, etc.</small></h2>
      <form class="form" id="iptvForm">
        <label>Producto IPTV<select name="productId">${iptvProds.map((p) => opt(p.id, p.name)).join("")}</select></label>
        <label>Cómo se entrega<select name="mode">${[["xtream", "Usuario + clave + servidor (Xtream)"], ["m3u", "Enlace M3U / lista"], ["mac", "Por MAC"], ["code", "Código de activación"]].map(([v, t]) => opt(v, t)).join("")}</select></label>
        <label style="grid-column:1/-1">Usuario o nombre de la línea<input name="email" required placeholder="usuario123 o 'Juan - Flujo TV'" autocomplete="off"></label>
        <label style="grid-column:1/-1" class="iptv-secret">Clave / enlace M3U / código<input name="password" required placeholder="la clave, el enlace M3U completo o el código" autocomplete="off"></label>
        <label class="iptv-xtream">Servidor / URL<input name="server" placeholder="http://servidor.com:8080"></label>
        <label class="iptv-mac" hidden>MAC del aparato<input name="mac" placeholder="00:1A:79:XX:XX:XX"></label>
        <label>App para ver <small class="muted">(opcional)</small><input name="app" placeholder="IBO Player, IPTV Smarters…"></label>
        <label>Dispositivos a la vez<input name="connections" type="number" min="1" max="20" placeholder="1"></label>
        <details style="grid-column:1/-1"><summary>Proveedor, vencimiento y costo <small class="muted">(opcional)</small></summary>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
            <label>Proveedor<select name="supplierId"><option value="">Propias (sin proveedor)</option>${suppliers.filter((s) => s.active).map((s) => opt(s.id, s.name)).join("")}</select></label>
            <label>Vence con el proveedor<input type="date" name="exp"></label>
            <label>Costo (${currencySym()})<input name="cost" inputmode="decimal" value="0"></label></div></details>
        <button class="pbtn dark" type="submit" style="grid-column:1/-1">${icon("plus")}Guardar línea IPTV</button>
      </form>
      <p class="muted" style="margin:0">La línea queda <b>libre</b>, lista para vender o asignar en Vender/Cuentas. Al venderla, el cliente recibe sus datos y cómo verla.</p></section>`;
    const last = (() => { try { return JSON.parse(localStorage.getItem("gs-carga") || "{}"); } catch { return {}; } })();
    P.tab.prodDefaults = Object.fromEntries(products.map((p) => [p.id, p.profileDefaults ?? []]));
    P.tab.prodKind = Object.fromEntries(products.map((p) => [p.id, p.kind]));
    const guessN = (id) => { const p = products.find((x) => x.id === id); if (p?.profileDefaults?.length) return p.profileDefaults.length; if (p?.kind === "full_account") return 1; const t = `${id} ${p?.name ?? ""}`.toLowerCase(); return /disney/.test(t) ? 7 : /prime|amazon/.test(t) ? 6 : 5; };
    const lastProd = products.some((p) => p.id === last.productId) ? last.productId : products[0].id;
    return `${iptvCard}<section class="card ok-card"><h2>${icon("plus")}Carga rápida <small>· pegá correo y clave, recuerda lo demás</small></h2>
      <form class="form" id="quickForm">
        <label>Producto<select name="productId">${products.map((p) => opt(p.id, p.name, p.id === lastProd)).join("")}</select></label>
        <label>Perfiles<input name="n" type="number" min="1" max="20" value="${guessN(lastProd)}"></label>
        <label style="grid-column:1/-1">Correo de la cuenta<input name="email" type="email" required placeholder="correo@gmail.com" autocomplete="off"></label>
        <label style="grid-column:1/-1">Contraseña<input name="password" required placeholder="clave de la cuenta" autocomplete="off"></label>
        <details style="grid-column:1/-1"><summary>Proveedor y costo <small class="muted">(opcional)</small></summary>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
            <label>Proveedor<select name="supplierId"><option value="">Propias (sin proveedor)</option>${suppliers.filter((s) => s.active).map((s) => opt(s.id, s.name, s.id === last.supplierId)).join("")}</select></label>
            <label>Vence con proveedor <small class="muted">(opcional)</small><input type="date" name="exp" value="${last.exp || ""}"></label>
            <label>Costo (${currencySym()})<input name="cost" inputmode="decimal" value="${last.cost ?? 0}"></label><label class="chk" style="grid-column:1/-1"><input type="checkbox" name="paidNow"> Ya la pagué: anotar el costo como gasto de este mes</label></div></details>
        <button class="pbtn dark" type="submit" style="grid-column:1/-1">${icon("plus")}Agregar cuenta (${guessN(lastProd)} perfiles libres)</button></form>
      <p class="muted" style="margin:0">Recuerda el producto, proveedor y fecha de la última vez. Los perfiles se crean <b>libres</b>, listos para asignar en Cuentas.</p></section>
      <section class="card"><h2>Cargar una cuenta <small>· con todos los detalles</small></h2><form class="form" id="accForm">
      <label>Producto${sel("productId")}</label><label>Proveedor${sel("supplierId")}</label>
      <label>Email de la cuenta<input name="email" type="email" required></label><label>Contraseña<input name="password" required></label>
      <label>Cantidad de perfiles<input name="n" type="number" min="1" max="20" value="5"></label><label>PIN (opcional, mismo para todos)<input name="pin" inputmode="numeric" maxlength="8"></label>
      <label>Vence con el proveedor <small class="muted">(opcional)</small><input name="exp" type="date" value=""></label><label>Costo (${currencySym()})<input name="cost" inputmode="decimal" value="0"></label><label class="chk" style="grid-column:1/-1"><input type="checkbox" name="paidNow"> Ya la pagué: anotar el costo como gasto de este mes</label>
      <button class="pbtn dark" type="submit">${icon("plus")}Guardar cuenta</button></form></section>
      <section class="card"><h2>Carga por lista <small>· una cuenta por línea: email, contraseña, perfiles, vence (AAAA-MM-DD)</small></h2><form class="form" id="bulkForm" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <label>Producto${sel("productId")}</label><label>Proveedor${sel("supplierId")}</label><label>Costo por cuenta (${currencySym()})<input name="cost" inputmode="decimal" value="0"></label>
      <textarea name="rows" rows="5" style="grid-column:1/-1" placeholder="cuenta1@correo.com, Clave#1, 5, 2026-12-31&#10;cuenta2@correo.com, Clave#2, 5, 2026-12-31" aria-label="Lista de cuentas"></textarea>
      <button class="pbtn dark" type="submit" style="justify-self:start">Cargar lista</button></form><div id="bulkOut"></div></section>`;
  },

  async productos() {
    const [products, groups, stock] = await Promise.all([api("GET", "/api/admin/products"), api("GET", "/api/admin/price-groups"), api("GET", "/api/admin/stock")]);
    const rev = groups.find((g) => g.id === "revendedor");
    const edit = products.find((p) => p.id === P.tab.editProduct);
    const f = edit ?? { name: "", category: "", description: "", kind: "profile", durationDays: 30, price: 0, color: "#3984ff", published: true };
    // Aviso arriba: productos que tus revendedores pagan a precio público porque no tienen precio de revendedor.
    const sinRev = products.filter((p) => (p.published || p.resellersOnly) && rev?.prices[p.id] === undefined);
    const revNote = sinRev.length ? `<section class="card warncard"><b>🏷️ ${sinRev.length} producto(s) sin precio de revendedor:</b> ${sinRev.slice(0, 6).map((p) => esc(p.name)).join(", ")}${sinRev.length > 6 ? "…" : ""}. Tus revendedores los pagan al precio público. Ponelos uno por uno (Editar → “Precio revendedor”) o todos juntos acá abajo.</section>` : "";
    return `${revNote}${isOwner() ? bulkResForm() : ""}<section class="card"><h2>${edit ? `Editar ${esc(edit.name)}` : "Nuevo producto"}</h2><form class="form" id="prodForm" data-id="${esc(edit?.id ?? "")}">
      <label>Nombre<input name="name" required maxlength="60" value="${esc(f.name)}"></label><label>Categoría<input name="category" maxlength="40" value="${esc(f.category ?? "")}" placeholder="Streaming, IA, Educación…"></label>
      <label>Tipo<select name="kind">${[["profile", "Perfil"], ["full_account", "Cuenta completa"], ["invite", "Invitación"], ["combo", "Combo"], ["iptv", "IPTV (TV en vivo)"]].map(([v, t]) => opt(v, t, v === f.kind)).join("")}</select></label>
      <label>Duración (días)<input name="durationDays" type="number" min="1" value="${f.durationDays}"></label><label>Precio (${currencySym()})<input name="price" inputmode="decimal" required value="${f.price / 100}"></label>
      <label>Precio revendedor (${currencySym()}, opcional)<input name="resPrice" inputmode="decimal" value="${rev?.prices[edit?.id] !== undefined ? rev.prices[edit.id] / 100 : ""}"></label>
      <label>Color de la tarjeta<span class="colorrow"><input name="color" type="color" value="${esc(f.color ?? "#3984ff")}"><output class="hex">${esc(f.color ?? "#3984ff")}</output></span></label>
      <label style="grid-column:1/-1">Descripción corta<input name="description" maxlength="200" value="${esc(f.description ?? "")}"></label>
      <label style="grid-column:1/-1">📌 Regla al vender <small class="muted">(opcional · aparece cuando vas a vender este servicio)</small><input name="saleNote" maxlength="200" value="${esc(f.saleNote ?? "")}" placeholder="Ej.: Disney pide PIN al entrar · este panel tarda 10 min"></label>
      <div style="grid-column:1/-1" class="pdefs"><div class="selbl">📲 Cómo verlo <small class="muted">opcional · el cliente recibe esto al comprar (ideal para IPTV)</small></div>
        <div style="display:grid;gap:10px">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
            <label>App<input name="guideApp" maxlength="60" value="${esc(f.guide?.app ?? "")}" placeholder="IBO Player, IPTV Smarters…"></label>
            <label>Enlace de descarga<input name="guideLink" maxlength="300" value="${esc(f.guide?.link ?? "")}" placeholder="https://…"></label></div>
          <label>Pasos<textarea name="guideSteps" rows="2" maxlength="600" placeholder="Ej.: Abrí la app, elegí 'Xtream Codes', pegá usuario, clave y servidor.">${esc(f.guide?.steps ?? "")}</textarea></label>
        </div></div>
      <label>Visible para<select name="audience">${opt("all", "Todos (tienda pública)", f.published && !f.resellersOnly)}${opt("resellers", "Solo revendedores (ven precio, compran y renuevan con saldo)", f.published && f.resellersOnly)}${opt("none", "Nadie (oculto, solo el panel)", !f.published)}</select></label>
      <div style="grid-column:1/-1" class="pdefs combo-only" ${f.kind === "combo" ? "" : "hidden"}><div class="selbl">🎁 Apps que incluye este combo <small class="muted">cuando el cliente arma el mismo combo en la tienda, le cobramos este precio</small></div>
        <div class="combopick">${products.filter((x) => x.kind !== "combo").map((x) => `<label class="chk"><input type="checkbox" name="combopart" value="${esc(x.id)}" ${f.comboProductIds?.includes(x.id) ? "checked" : ""}> ${esc(x.name)}</label>`).join("") || `<span class="muted">Primero creá productos sueltos (no combo) para elegirlos acá.</span>`}</div>
      </div>
      <div style="grid-column:1/-1" class="pdefs noncombo-only" ${f.kind !== "combo" ? "" : "hidden"}><div class="selbl">👤 Nombre y PIN por defecto de cada perfil <small class="muted">opcional · se precargan al cargar una cuenta</small></div>
        ${Array.from({ length: Math.min(10, Math.max(5, (f.profileDefaults?.length ?? 0) + 1)) }, (_, i) => { const d = f.profileDefaults?.[i]; return `<div class="pdrow"><span class="pdn">${i + 1}</span><input name="pd-label-${i}" placeholder="Perfil ${i + 1}" maxlength="40" value="${esc(d?.label ?? "")}"><input name="pd-pin-${i}" placeholder="PIN" aria-label="PIN (opcional)" inputmode="numeric" maxlength="8" value="${esc(d?.pin ?? "")}"></div>`; }).join("")}
      </div>
      <div class="inline"><button class="pbtn dark" type="submit">${edit ? "Guardar cambios" : "Crear producto"}</button>${edit ? `<button class="pbtn" type="button" data-editprod="">Cancelar</button>` : ""}</div></form>
      ${edit ? `<form class="inline" id="prodImg" data-id="${esc(edit.id)}" style="margin-top:12px">${edit.imageFileRef ? `<img src="/api/products/${esc(edit.id)}/image?v=${Date.now() % 1e6}" alt="" style="width:56px;height:56px;object-fit:contain;border-radius:12px;background:#0e1424;padding:6px">` : `<span class="muted">Sin logo: se ve la inicial.</span>`}
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Logo del producto"><button class="pbtn dark" type="submit">${edit.imageFileRef ? "Cambiar logo" : "Subir logo"}</button>${edit.imageFileRef ? `<button class="pbtn" type="button" data-noprodimg="${esc(edit.id)}">Quitar</button>` : ""}</form>` : `<p class="muted" style="margin:10px 0 0">Después de crearlo, tocá <b>Editar</b> para subirle el logo.</p>`}</section>
      ${(() => {
        const lists = groups.filter((g) => g.id !== "final" && g.id !== "revendedor");
        const nonCombo = products.filter((p) => p.kind !== "combo");
        const row = (g, p) => `<label class="plrow"><span>${esc(p.name)}</span><input name="pp-${esc(p.id)}" inputmode="decimal" value="${g.prices[p.id] != null ? g.prices[p.id] / 100 : ""}" placeholder="${g.currency === "USD" ? "US$" : `base ${p.price / 100}`}" aria-label="Precio de ${esc(p.name)} en ${g.currency === "USD" ? "US$" : "Bs"}"></label>`;
        return `<section class="card"><h2>🌎 Listas de precios <small>· distintos precios por país o tipo de cliente</small></h2>
          <p class="muted" style="margin:0">Creá una lista (ej.: Panamá, Paraguay), poné el precio de cada producto y asignásela al cliente en <b>Clientes</b>. Precio vacío = usa el precio base del producto.</p>
          ${lists.map((g) => `<details class="pricelist"><summary><b>${esc(g.name)}</b>${usdChip(g.currency)} · ${Object.keys(g.prices).length} precios</summary>
            <form class="form" data-pricelist="${esc(g.id)}" style="margin-top:8px">
              <label>Nombre de la lista<input name="name" value="${esc(g.name)}" maxlength="40" required></label>${currencySelect(g.currency)}
              ${g.currency === "USD" ? `<p class="muted" style="margin:0;grid-column:1/-1">💵 Precios en <b>dólares</b>. Sus clientes ven todo en US$, tienen el saldo en US$ y pagan con saldo o USDT (1 USDT = US$ 1). Producto sin precio: no lo ven.</p>` : ""}
              <div class="pltable">${nonCombo.map((p) => row(g, p)).join("")}</div>
              <button class="pbtn dark" type="submit" style="justify-self:start">Guardar lista</button>
            </form></details>`).join("") || `<p class="muted" style="margin:0">Todavía no tenés listas. Creá la primera abajo 👇</p>`}
          <form class="inline" id="newListForm" style="margin-top:10px"><input name="name" placeholder="Nueva lista (ej.: Panamá)" aria-label="Nombre de la lista nueva" maxlength="40" required><select name="currency" aria-label="Moneda de la lista nueva"><option value="BOB">En Bs</option><option value="USD">En US$ (dólares)</option></select><button class="pbtn dark" type="submit">${icon("plus")}Crear lista</button></form></section>`;
      })()}
      <section class="card"><h2>Productos <small>· ${products.length} · tocá una tarjeta para editar</small></h2>
      ${products.length ? `<div class="prodgrid">${products.map((p) => {
        const st = stock[p.id]?.available ?? 0;
        const kindTxt = { profile: "Perfil", full_account: "Cuenta completa", invite: "Invitación", combo: "Combo", iptv: "IPTV" }[p.kind];
        const estado = !p.published ? ["Oculto", "mute"] : p.resellersOnly ? ["Solo revendedores", "warn"] : ["Publicado", "ok"];
        const face = p.imageFileRef ? `<img class="svbadge" src="/api/products/${esc(p.id)}/image" alt="" loading="lazy">` : brandBadge(p.name, p.color);
        return `<article class="prodcard" tabindex="0" role="button" data-editprod="${esc(p.id)}">
          <header>${face}<div class="pcinfo"><b>${esc(p.name)}</b><small class="muted">${esc(p.category || kindTxt)}</small></div>${pill(estado[0], estado[1])}</header>
          <div class="prow"><span class="muted">Precio</span><b>${bs(p.price)}</b></div>
          <div class="prow"><span class="muted">Revendedor</span><b>${rev?.prices[p.id] !== undefined ? bs(rev.prices[p.id]) : "—"}</b></div>
          <div class="prow"><span class="muted">Stock libre</span><b class="${st ? (st <= 2 ? "lowst" : "okst") : "nost"}">${st}</b></div>
          <div class="prow"><span class="muted">Duración</span><b>${p.durationDays} días</b></div>
          <div class="pcfoot"><span class="pcbtn">${icon("edit")}Editar</span></div>
        </article>`;
      }).join("")}</div>` : `<div class="emptybox">Todavía no hay productos.</div>`}</section>`;
  },

  async proveedores() {
    const [list, report] = await Promise.all([api("GET", "/api/admin/suppliers"), canReview() ? api("GET", "/api/admin/suppliers-report") : Promise.resolve([])]);
    return `<section class="card"><h2>Nuevo proveedor</h2><form class="form" id="supForm"><label>Nombre<input name="name" required></label><label>Contacto (opcional)<input name="contact"></label><button class="pbtn dark" type="submit">${icon("plus")}Agregar</button></form></section>
      <section class="card"><h2>Proveedores <small>costo, ingreso y margen de los últimos 30 días</small></h2>
      <p class="muted" style="margin:0 0 10px">Ingreso: ventas y renovaciones de los últimos 30 días hechas con perfiles de ese proveedor (los combos se reparten por app). Costo: un mes de sus cuentas. Así los dos son del mismo período.</p>
      ${table(["Proveedor", "Cuentas", "Vendidos", "Cuarentena", "Costo (30 d)", "Ingreso (30 d)", "Margen (30 d)", "Por vencer (7 d)", ""], list.map((s) => {
        const r = report.find((x) => x.supplierId === s.id);
        return `<tr><td>${esc(s.name)}<br><small class="muted">${esc(s.contact ?? "")}</small></td><td>${r?.activeAccounts ?? "—"}</td><td>${r?.assigned ?? "—"}</td><td>${r?.quarantined ?? "—"}</td>
          <td>${r ? bs(r.cost) : "—"}</td><td>${r ? bs(r.revenue) : "—"}</td><td class="${r && r.margin < 0 ? "down" : "up"}">${r ? bs(r.margin) : "—"}</td>
          <td>${r?.expiringIn7Days.length ? r.expiringIn7Days.map((a) => `<small class="mono">${esc(a.email)}</small>`).join("<br>") : "—"}</td>
          <td>${canReview() && s.id !== "propias" ? `<div class="inline" style="flex-wrap:nowrap"><button class="pbtn sm" type="button" data-supactive="${esc(s.id)}" data-on="${s.active ? 0 : 1}">${s.active ? "Desactivar" : "Activar"}</button><button class="pbtn sm danger" type="button" data-supdel="${esc(s.id)}" data-name="${esc(s.name)}" data-n="${r?.activeAccounts ?? 0}">🗑️ Borrar</button></div>` : s.id === "propias" ? `<small class="muted">Tus cuentas</small>` : ""}</td></tr>`;
      }), "Todavía no hay proveedores.")}
      <p class="muted" style="margin:0">¿Vos sos el proveedor? Tocá <b>🗑️ Borrar</b>: sus cuentas pasan a <b>Propias</b> (las tuyas) y no se pierde ninguna cuenta ni cliente.</p></section>`;
  },

  async clientes() {
    const q = P.tab.q ?? "";
    const [list, priceGroups] = await Promise.all([api("GET", "/api/admin/customers?q=" + encodeURIComponent(q)), api("GET", "/api/admin/price-groups").catch(() => [])]);
    const priceLists = priceGroups.filter((g) => g.id !== "final" && g.id !== "revendedor");
    const link = P.tab.link;
    const ledger = P.tab.ledger ? await api("GET", `/api/admin/customers/${P.tab.ledger}/ledger`) : null;
    const lc = list.find((c) => c.id === P.tab.ledger);
    const ec = list.find((c) => c.id === P.tab.editCus) ?? (P.tab.editCus ? (await api("GET", "/api/admin/customers")).find((c) => c.id === P.tab.editCus) : null);
    return `${link ? `<section class="card ok-card"><h2>🔑 Acceso para ${esc(link.name)}</h2>
        <div class="linkbar"><span class="muted">Entra en</span><b>${esc(link.url)}</b><button class="pbtn sm" type="button" data-copy="${esc(link.url)}">${icon("copy")}Copiar</button></div>
        <div class="linkbar"><span class="muted">Con su número y PIN</span><b>${esc(link.phone)} · PIN ${esc(link.pin)}</b><button class="pbtn sm" type="button" data-copy="${esc(link.pin)}">${icon("copy")}Copiar PIN</button></div>
        <div class="inline"><a class="pbtn green" href="${waLink(link.phone, `Hola ${link.name.split(" ")[0]} 👋 para entrar a ${P.settings.storeName} y ver tus servicios:\n👉 ${link.url}\n📱 Tu número: ${link.phone}\n🔑 Tu PIN: ${link.pin}\n(Guardalo; lo podés cambiar adentro.)`)}" target="_blank" rel="noopener">${icon("wa")}Mandar por WhatsApp</a><button class="pbtn" type="button" data-tab="link:">Cerrar</button></div>
        <p class="muted" style="margin:0">El PIN no vence. Si lo pierde, tocá de nuevo el botón y se genera uno nuevo (el anterior deja de servir).</p></section>` : ""}
      ${ledger ? `<section class="card"><h2>Saldo de ${esc(lc?.name)} · ${wal(lc?.balance ?? 0, lc?.currency)} <button class="pbtn sm" type="button" data-ledger="">Cerrar</button></h2>${table(["Fecha", "Tipo", "Referencia", "Monto", "Saldo"], ledger.slice().reverse().map((m) => `<tr><td>${fdt(m.at)}</td><td>${esc({ topup: "Recarga", purchase: "Compra", renewal: "Renovación", refund: "Devolución", adjustment: "Ajuste", shop_rent: "Alquiler de página", referral: "Premio por referido" }[m.type] ?? m.type)}</td><td>${esc(m.ref)}${m.note ? `<br><small class="muted">${esc(m.note)}</small>` : ""}</td><td class="${m.amount < 0 ? "down" : "up"}">${wal(m.amount, m.cur)}</td><td>${wal(m.balanceAfter, m.cur)}</td></tr>`), "Sin movimientos.")}
        ${isOwner() ? `<form class="inline" id="adjForm" data-id="${esc(P.tab.ledger)}"><input name="amount" inputmode="decimal" placeholder="Monto ${lc?.currency === "USD" ? "US$" : "Bs"} (negativo para descontar)" aria-label="Monto en ${lc?.currency === "USD" ? "dólares (US$)" : "Bs"}" required><input name="reason" placeholder="Motivo" required><button class="pbtn dark sm" type="submit">Ajustar saldo</button></form>` : ""}</section>` : ""}
      <section class="card"><h2>Nuevo cliente</h2><form class="form" id="cusForm"><label>Nombre<input name="name" required></label><label>WhatsApp<input name="phone" required inputmode="tel" placeholder="+591 7…"></label><label>Email (opcional)<input name="email" type="email"></label>
        <label>Tipo<select name="kind">${opt("customer", "Cliente")}${canReview() ? opt("reseller", "Revendedor") : ""}</select></label><label class="chk"><input type="checkbox" name="consent"> Aceptó recibir avisos por WhatsApp</label><button class="pbtn dark" type="submit">${icon("plus")}Crear</button></form></section>
      ${(() => {
        const deben = list.filter((c) => (c.owed ?? 0) > 0);
        const totalDeben = deben.reduce((s, c) => s + (c.owed ?? 0), 0);
        if (!list.length) return "";
        return `<section class="card cliskpis"><div class="dk"><span>Clientes</span><b>${list.filter((c) => c.kind !== "reseller").length}</b><small>${list.filter((c) => c.kind === "reseller").length} revendedores</small></div>
          <div class="dk ${totalDeben ? "bad" : ""}"><span>💰 Te deben</span><b>${bs(totalDeben)}</b><small>${deben.length} cliente(s)</small></div>
          <div class="dk"><span>Con servicio activo</span><b>${list.filter((c) => c.activeServices > 0).length}</b><small>de ${list.length}</small></div></section>`;
      })()}
      <section class="card"><form class="filters" id="cusSearch"><input name="q" placeholder="🔍 Buscar por nombre, teléfono o email" value="${esc(q)}" style="flex:5 1 240px" aria-label="Buscar"><button class="pbtn dark" type="submit">${icon("filter")}Buscar</button></form>
      ${list.length ? `<div class="tabs cfil" role="tablist">${[["todos", `Todos (${list.length})`], ["deben", `💰 Me deben (${list.filter((c) => (c.owed ?? 0) > 0).length})`], ["vencer", `⏰ Vencen 7 d (${list.filter((c) => c.nextExpiry && daysLeft(c.nextExpiry) >= 0 && daysLeft(c.nextExpiry) <= 7).length})`],
        ...Object.entries(CTAGS).filter(([k]) => list.some((c) => c.tag === k)).map(([k, v]) => [`tag:${k}`, `${v[0]} (${list.filter((c) => c.tag === k).length})`])
      ].map(([k, t]) => `<button type="button" role="tab" data-tab="cfilter:${k}" aria-selected="${(P.tab.cfilter ?? "todos") === k}">${t}</button>`).join("")}</div>` : ""}
      ${canReview() && list.length ? `<div class="inline bulkkind"><button class="pbtn sm dark" type="button" data-bulkkind="all">👥 Pasar TODOS a revendedores</button></div>` : ""}
      <p class="muted" style="margin:0;font-size:12.5px">👆 Tocá un cliente para ver su ficha, editarlo, cobrarle o darle su PIN.</p>
      ${(() => {
        const cf = P.tab.cfilter ?? "todos";
        const shown = cf === "deben" ? list.filter((c) => (c.owed ?? 0) > 0) : cf === "vencer" ? list.filter((c) => c.nextExpiry && daysLeft(c.nextExpiry) >= 0 && daysLeft(c.nextExpiry) <= 7) : cf.startsWith("tag:") ? list.filter((c) => c.tag === cf.slice(4)) : list;
        if (!list.length) return `<p class="muted">${q ? "Nadie coincide con la búsqueda." : "Todavía no hay clientes."}</p>`;
        if (!shown.length) return `<p class="muted">Ningún cliente en este filtro. 👌</p>`;
        return shown.map((c) => { const dl = c.nextExpiry ? daysLeft(c.nextExpiry) : null; const since = Math.max(0, Math.round((Date.now() - c.createdAt) / 86400000));
          return `<details class="rcli"${P.tab.editCus === c.id ? " open" : ""}><summary><span><b>${esc(c.name)}</b><br><small class="muted">${esc(c.phone)}${c.notes ? " · 📝 " + esc(c.notes) : ""}</small></span><span class="rsum">${tagChip(c.tag)}${c.tag ? " " : ""}${c.kind === "reseller" ? pill("Rev", "warn") + " " : ""}${usdChip(c.currency)}${(c.owed ?? 0) > 0 ? `<span class="pp pp-bad">debe ${bs(c.owed)}</span> ` : ""}${c.activeServices} serv.${dl !== null ? ` · ${dl < 0 ? `<span class="pp pp-bad">venció</span>` : dl <= 7 ? `<span class="pp pp-warn">${dl}d</span>` : `vence ${dl}d`}` : ""}</span></summary>
          <div class="clistats">${[["Servicios", c.activeServices], ["Gastó", bs(c.spent ?? 0)], ["Te debe", (c.owed ?? 0) > 0 ? `<b style="color:var(--bad)">${bs(c.owed)}</b>` : bs(0)], ["Saldo a favor", wal(c.balance, c.currency)], ["Renovó", `${c.renewals ?? 0}×`], ["Próximo vence", c.nextExpiry ? fdate(c.nextExpiry) : "—"], ["Cliente desde", `${since} d`]].map(([t, v]) => `<div><small>${t}</small><b>${v}</b></div>`).join("")}</div>
          <form class="form" data-editcusform data-id="${esc(c.id)}" data-kind0="${esc(c.kind)}" data-usdlists="${esc(priceLists.filter((g) => g.currency === "USD").map((g) => g.id).join(","))}">
            <label>Nombre<input name="name" required maxlength="80" value="${esc(c.name)}"></label><label>WhatsApp<input name="phone" required inputmode="tel" value="${esc(c.phone)}"></label><label>Email<input name="email" type="email" value="${esc(c.email ?? "")}"></label>
            ${canReview() ? `<label>Tipo<select name="kind">${opt("customer", "Cliente", c.kind === "customer")}${opt("reseller", "Revendedor", c.kind === "reseller")}</select></label>` : ""}
            ${canReview() && priceLists.length ? `<label>💲 Lista de precios<select name="priceList">${c.kind === "reseller" ? opt("revendedor", "Revendedor (Bs)", !c.priceGroupId || c.priceGroupId === "revendedor") : opt("final", "Base (precio normal)", !c.priceGroupId || c.priceGroupId === "final")}${priceLists.map((g) => opt(g.id, `${g.name}${g.currency === "USD" ? " · US$" : ""}`, c.priceGroupId === g.id)).join("")}</select></label>${listHint(c, priceGroups)}` : ""}
            <label>🏷️ Etiqueta<select name="tag">${opt("", "Sin etiqueta", !c.tag)}${Object.entries(CTAGS).map(([k, v]) => opt(k, v[0], c.tag === k)).join("")}</select></label>
            <label style="grid-column:1/-1">Notas internas (el cliente no las ve)<input name="notes" maxlength="500" value="${esc(c.notes ?? "")}" placeholder="Ej.: paga los viernes"></label>
            <label class="chk"><input type="checkbox" name="consent" ${c.whatsappConsent ? "checked" : ""}> Acepta avisos por WhatsApp</label>
            <div class="rbtns" style="grid-column:1/-1"><button class="pbtn dark" type="submit">${icon("edit")}Guardar</button>${canReview() || (c.kind !== "reseller" && !(c.balance > 0)) ? `<button class="pbtn" type="button" data-link="${esc(c.id)}" data-name="${esc(c.name)}">🔑 PIN de acceso</button>` : ""}<button class="pbtn" type="button" data-ledger="${esc(c.id)}">${icon("coins")}Saldo</button><a class="pbtn" href="https://wa.me/${esc(c.phone.replace(/\D/g, ""))}" target="_blank" rel="noopener">${icon("wa")}WhatsApp</a></div>
          </form></details>`; }).join("");
      })()}</section>`;
  },

  async excel() {
    const imp = P.tab.import;
    const dl = (kind, title, desc, extra = "") => `<div class="todo"><div><span class="ic">${icon("ext")}</span><b>${title}<br><small class="muted" style="font-weight:400">${desc}</small></b>
      <a class="pbtn dark" href="/api/admin/export/${kind}${extra}" download>Descargar Excel</a></div></div>`;
    return `<section class="card"><h2>Exportar a Excel <small>· se descarga un archivo .xlsx que abre en Excel o Google Sheets</small></h2>
      ${dl("todo", "Todo en un archivo", "Una hoja por tema, con todo lo que tu usuario puede ver")}
      ${dl("clientes", "Clientes", "Nombre, WhatsApp, email, tipo, saldo, servicios activos y notas")}
      ${dl("servicios", "Servicios activos", "Quién tiene qué, en qué cuenta y perfil, y cuándo vence")}
      ${canReview() ? dl("ventas", "Ventas y pedidos", "Fecha, cliente, detalle, total, forma de pago, estado y referencia del banco") : ""}
      ${canReview() ? dl("movimientos", "Movimientos de saldo", "Recargas, compras, renovaciones y ajustes de cada cliente") : ""}
      ${canReview() ? dl("cuentas", "Cuentas y perfiles", "Inventario completo (contraseñas ocultas)") + `<p class="muted" style="margin:0">¿Necesitás las contraseñas? <a href="/api/admin/export/cuentas?secrets=1" download>Descargar con contraseñas</a>. Queda registrado en la auditoría; guardá ese archivo en un lugar seguro.</p>` : ""}
      </section>
      <section class="card"><h2>Importar clientes desde Excel</h2>
        <p class="muted" style="margin:0">Subí tu Excel (.xlsx) o un .csv. La primera fila tiene que tener los títulos: <b>Nombre</b> y <b>WhatsApp</b> (o Teléfono / Celular) son obligatorios; <b>Email</b>, <b>Notas</b> y <b>Tipo</b> son opcionales. Los números sin código de país se toman como de Bolivia (+591). Los que ya son clientes no se tocan.</p>
        <div class="inline"><a class="pbtn" href="/api/admin/import/template" download>${icon("ext")}Descargar plantilla</a></div>
        <form id="importForm"><label class="dropzone"><input type="file" name="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required aria-label="Archivo de clientes" hidden><span class="dztext">📄 Arrastrá tu Excel acá, o <b>tocá para elegir</b></span><small class="dzname"></small></label><button class="pbtn dark" type="submit" style="margin-top:8px">Ver vista previa</button></form>
        ${imp ? `<div style="display:grid;gap:10px">
          <div class="inline">${pill(`${imp.result.summary.nuevos} nuevos`, "ok")} ${pill(`${imp.result.summary.existentes} ya existen`, "mute")} ${pill(`${imp.result.summary.errores} con error`, imp.result.summary.errores ? "bad" : "mute")}
            <span class="muted">Columnas usadas: Nombre = “${esc(imp.result.columns.nombre)}”, WhatsApp = “${esc(imp.result.columns.whatsapp)}”${imp.result.columns.email ? `, Email = “${esc(imp.result.columns.email)}”` : ""}${imp.result.columns.notas ? `, Notas = “${esc(imp.result.columns.notas)}”` : ""}</span></div>
          ${table(["Fila", "Nombre", "WhatsApp", "Resultado"], imp.result.rows.slice(0, 300).map((r) => `<tr><td>${r.row}</td><td>${esc(r.name)}</td><td class="mono">${esc(r.phone)}</td><td>${r.status === "nuevo" ? pill(imp.result.dryRun ? "Se va a crear" : "Creado", "ok") : r.status === "existe" ? pill(r.error || "Ya existe", "mute") : pill(r.error || "Error", "bad")}</td></tr>`))}
          ${imp.result.rows.length > 300 ? `<p class="muted" style="margin:0">Mostrando 300 de ${imp.result.rows.length} filas.</p>` : ""}
          ${imp.result.dryRun && imp.result.summary.nuevos ? `<div class="inline"><button class="pbtn green" type="button" data-importgo="1">Importar ${imp.result.summary.nuevos} cliente(s)</button><button class="pbtn" type="button" data-importcancel="1">Cancelar</button></div>` : ""}
          ${!imp.result.dryRun ? `<div class="pok">Listo: se crearon ${imp.result.created} cliente(s). Ya los ves en Clientes.</div>` : ""}</div>` : ""}
      </section>
      ${canReview() ? `<section class="card"><h2>Importar servicios actuales <small>· quién tiene qué cuenta, perfil y vencimiento</small></h2>
        <p class="muted" style="margin:0">Una fila por servicio. Columnas obligatorias: <b>Cliente</b>, <b>WhatsApp</b>, <b>Producto</b> (como figura en Productos), <b>Cuenta</b> (correo) y <b>Vence</b> (15/12/2026). Opcionales: <b>Tipo</b> (revendedor o cliente), <b>Precio</b> (lo que le cobrás), <b>Contraseña</b> (obligatoria si la cuenta es nueva), <b>Perfil</b>, <b>PIN</b>, <b>Vence proveedor</b>, <b>Proveedor</b>, <b>Costo</b>, <b>Revendedor</b> y <b>Nota</b>.
        Se crean solos los clientes, cuentas y perfiles que falten. No se manda ningún WhatsApp y no cuenta como venta.</p>
        <div class="inline"><a class="pbtn" href="/api/admin/import/template?type=services" download>${icon("ext")}Descargar plantilla de servicios</a></div>
        <form id="importSvcForm"><label class="dropzone"><input type="file" name="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required aria-label="Archivo de servicios" hidden><span class="dztext">📄 Arrastrá tu Excel acá, o <b>tocá para elegir</b></span><small class="dzname"></small></label><button class="pbtn dark" type="submit" style="margin-top:8px">Ver vista previa</button></form>
        ${P.tab.importSvc ? (() => { const r = P.tab.importSvc.result; return `<div style="display:grid;gap:10px">
          <div class="inline">${pill(`${r.summary.ok} servicios ${r.dryRun ? "listos" : "importados"}`, "ok")} ${pill(`${r.summary.errores} con error`, r.summary.errores ? "bad" : "mute")} ${pill(`${r.summary.clientesNuevos} clientes nuevos`, "mute")} ${pill(`${r.summary.cuentasNuevas} cuentas nuevas`, "mute")} ${pill(`${r.summary.perfilesNuevos} perfiles nuevos`, "mute")} ${r.summary.revendedores ? pill(`${r.summary.revendedores} pasan a revendedor`, "ok") : ""} ${r.summary.avisos ? pill(`${r.summary.avisos} avisos`, "warn") : ""}</div>
          ${table(["Fila", "Cliente", "Producto", "Cuenta / perfil", "Vence", "Resultado"], r.rows.slice(0, 300).map((x) => `<tr><td>${x.row}</td><td>${esc(x.customer)}</td><td>${esc(x.product)}</td><td class="mono">${esc(x.account)}<br><small class="muted">${esc(x.profile)}</small></td><td>${x.expiresAt ? fdate(x.expiresAt) : ""}</td>
            <td>${x.status === "ok" ? pill(r.dryRun ? "Se va a importar" : "Importado", "ok") : `<span class="pp pp-bad" style="white-space:normal;display:inline-block;max-width:340px">${esc(x.error || "Error")}</span>`}${x.created?.length ? `<br><small class="muted">Nuevo: ${esc([...new Set(x.created)].join(", "))}</small>` : ""}${(x.warnings ?? []).map((w) => `<br><small style="color:var(--warn)">⚠ ${esc(w)}</small>`).join("")}</td></tr>`))}
          ${r.rows.length > 300 ? `<p class="muted" style="margin:0">Mostrando 300 de ${r.rows.length} filas.</p>` : ""}
          ${r.dryRun && r.summary.ok ? `<div class="inline"><button class="pbtn green" type="button" data-importsvcgo="1">Importar ${r.summary.ok} servicio(s)</button><button class="pbtn" type="button" data-importsvccancel="1">Cancelar</button>${r.summary.errores ? `<span class="muted">Las filas con error se saltean; podés corregirlas y subirlas después.</span>` : ""}</div>` : ""}
          ${!r.dryRun ? `<div class="pok">Listo: ${r.summary.ok} servicio(s) cargados. Ya aparecen en Renovar, Recordatorios y en Mis cuentas de cada cliente.</div>` : ""}</div>`; })() : ""}
      </section>` : ""}`;
  },

  async whatsapp() {
    const sec = P.tab.waSec ?? "chats";
    const tabs = [["chats", "Conversaciones"], ["avisos", "Avisos"], ["bot", "Bot y conexión con Meta"]];
    const head = `<div class="tabs" role="tablist" style="background:var(--card);border-radius:10px;padding:0 8px">${tabs.map(([k, t]) => `<button role="tab" type="button" data-tab="waSec:${k}" aria-selected="${k === sec}">${t}</button>`).join("")}</div>`;
    if (sec === "bot") return head + await waBotHtml();
    if (sec === "avisos") return head + await waAvisosHtml();
    return head + await waChatsHtml();
  },

  async apariencia() {
    if (!canReview()) return `<section class="card"><div class="emptybox">Solo el dueño o un admin cambian la apariencia.</div></section>`;
    const [s, shops, testis, faqs] = await Promise.all([api("GET", "/api/settings"), api("GET", "/api/admin/shops").catch(() => []), api("GET", "/api/admin/testimonials").catch(() => []), api("GET", "/api/admin/faq").catch(() => [])]);
    const ACCENTS = [["#3984ff", "Azul"], ["#7c5cff", "Violeta"], ["#e0368a", "Rosa"], ["#ff5a36", "Naranja"], ["#f2b705", "Dorado"], ["#16b47e", "Verde"], ["#14b8c8", "Turquesa"], ["#e53935", "Rojo"]];
    const BGS = [["#090e1d", "Azul noche"], ["#0b0b0f", "Negro"], ["#140c24", "Violeta oscuro"], ["#07140f", "Verde oscuro"], ["#1a0a10", "Bordó"], ["#111418", "Grafito"],
      ["#f5f7fb", "Blanco"], ["#fff7ec", "Crema"], ["#eaf3ff", "Celeste"], ["#f3efff", "Lila"], ["#ecfbf3", "Menta"], ["#fff0f3", "Rosa claro"]];
    const FONTS = FONT_LIST.map(([id, n, d]) => [id, `${n || "Sistema"} · ${d}`]);
    const CORNERS = [["round", "Redondeados"], ["soft", "Suaves"], ["square", "Rectos"]];
    const sw = (name, list, cur) => `<div class="inline">${list.map(([c, t]) => `<label title="${t}" style="display:grid;justify-items:center;gap:4px;font-size:12px;cursor:pointer;position:relative"><input type="radio" name="${name}" value="${c}" ${c.toLowerCase() === cur.toLowerCase() ? "checked" : ""} style="position:absolute;opacity:0">
      <span class="swatch" style="width:38px;height:38px;border-radius:10px;background:${c};border:3px solid ${c.toLowerCase() === cur.toLowerCase() ? "var(--ink)" : "transparent"};box-shadow:0 0 0 1px var(--line)"></span>${t}</label>`).join("")}
      <label style="display:grid;justify-items:center;gap:4px;font-size:12px">Otro<input type="color" name="${name}Custom" value="${esc(cur)}" style="width:44px;height:38px;padding:2px"></label></div>`;
    return `<section class="card"><h2>🏪 Tipo de tienda</h2><p class="muted" style="margin:0">El <b>diseño</b> de tu tienda. Elegí uno, tocá <b>Guardar apariencia</b> y abrí tu tienda para verlo.</p>
        <div class="laygrid">${LAYOUT_LIST.map(([v, t, d]) => `<button type="button" class="laycard${(s.layout || "clasico") === v ? " on" : ""}" data-layout="${v}"><b>${esc(t)}</b><small>${esc(d)}</small></button>`).join("")}</div></section>
      <section class="card"><h2>Estilos listos <small>· colores</small></h2><p class="muted" style="margin:0">Tocá uno para probarlo en la vista previa de abajo. Si te gusta, tocá <b>Guardar apariencia</b>.</p>
        <div class="tgrid">${THEMES.map((t) => `<button type="button" class="tcard" data-ptheme="${t.id}">${themeSwatch(t)}<span>${esc(t.name)}</span></button>`).join("")}</div></section>
      <section class="card"><h2>Colores</h2><form id="lookForm" style="display:grid;gap:16px"><div id="lookWarn" class="lookwarn" role="status" aria-live="polite"></div><input type="hidden" name="layout" value="${esc(s.layout || "clasico")}">
        <div><b>Color principal</b> <span class="muted">· botones, precios y detalles</span>${sw("accentColor", ACCENTS, s.accentColor)}</div>
        <div><b>Segundo color</b> <span class="muted">· para los degradados (vacío = automático)</span><div class="inline"><input type="color" name="accent2Color" aria-label="Segundo color" value="${esc(s.accent2Color || s.accentColor)}" style="width:54px;height:38px;padding:2px"><label class="chk"><input type="checkbox" name="accent2Auto" ${s.accent2Color ? "" : "checked"}> Automático</label></div></div>
        <div><b>Fondo</b> <span class="muted">· oscuro o claro: los textos cambian solos para que siempre se lean</span>${sw("backgroundColor", BGS, s.backgroundColor)}</div>
        <div class="form"><label>Letra de los títulos<select name="headingFont">${FONTS.map(([v, t]) => opt(v, t, v === s.headingFont)).join("")}</select></label>
          <label>Letra del texto<select name="fontFamily">${FONTS.map(([v, t]) => opt(v, t, v === s.fontFamily)).join("")}</select></label>
          <label>Fondo<select name="bgStyle">${BG_LIST.map(([v, t]) => opt(v, t, v === s.bgStyle)).join("")}</select></label>
          <label>Tarjetas<select name="cardStyle">${CARD_LIST.map(([v, t]) => opt(v, t, v === s.cardStyle)).join("")}</select></label>
          <label>Forma de botones y tarjetas<select name="corners">${CORNERS.map(([v, t]) => opt(v, t, v === s.corners)).join("")}</select></label></div>
        <h2 style="margin-top:6px">Textos de la página de inicio</h2>
        <div class="form"><label>Título<input name="heroTitle" maxlength="40" value="${esc(s.heroTitle)}"></label><label>Parte destacada (en color)<input name="heroHighlight" maxlength="40" value="${esc(s.heroHighlight)}"></label>
        <label style="grid-column:1/-1">Descripción<input name="heroText" maxlength="220" value="${esc(s.heroText)}"></label>
        <label style="grid-column:1/-1">🔎 Título para Google y al compartir el link <small class="muted">(SEO, hasta 70 letras; vacío = el nombre de la tienda)</small><input name="seoTitle" maxlength="70" value="${esc(s.seoTitle ?? "")}" placeholder="Gabriel Store | Netflix, Disney+, Spotify y más en Bolivia"></label>
        <label style="grid-column:1/-1">🔎 Descripción para Google <small class="muted">(hasta 160 letras: qué vendés, dónde y cómo se paga)</small><input name="seoDescription" maxlength="160" value="${esc(s.seoDescription ?? "")}"></label>
        <label style="grid-column:1/-1">Aviso arriba de todo (opcional)<input name="announcement" maxlength="140" value="${esc(s.announcement)}" placeholder="Ej.: Netflix a Bs 30 solo este fin de semana"></label>
        <label style="grid-column:1/-1">Horario de atención (franja de arriba)<input name="storeHours" maxlength="60" value="${esc(s.storeHours ?? "")}" placeholder="Ej.: Atención 8:00 a 22:00 (hora de Bolivia)"></label>
        <label>Etiqueta sobre el título (vacío = sin etiqueta)<input name="heroChip" maxlength="40" value="${esc(s.heroChip)}"></label>
        <label>Ventajas (hasta 3, separadas por coma)<input name="heroTicks" maxlength="120" value="${esc(s.heroTicks)}"></label></div>
        <h2 style="margin-top:6px">Pie de página y redes</h2>
        <div class="form"><label style="grid-column:1/-1">Texto del pie<input name="footerText" maxlength="120" value="${esc(s.footerText)}" placeholder="Precios en bolivianos"></label>
          <label>Instagram (usuario)<input name="instagram" maxlength="80" value="${esc(s.instagram)}" placeholder="gabostore"></label>
          <label>TikTok (usuario)<input name="tiktok" maxlength="80" value="${esc(s.tiktok)}" placeholder="gabostore"></label>
          <label>Facebook (página)<input name="facebook" maxlength="80" value="${esc(s.facebook)}" placeholder="gabostore"></label></div>
        <div class="inline"><button class="pbtn dark" type="submit">Guardar apariencia</button><a class="pbtn" href="/tienda/" target="_blank" rel="noopener">${icon("ext")}Abrir mi tienda</a></div></form></section>
      <section class="card"><h2>Página para conseguir revendedores</h2>
        <p class="muted" style="margin:0">En <a href="/revendedores" target="_blank" rel="noopener"><b>/revendedores</b></a> hay una página que explica tu programa: beneficios, estilos, las tiendas de tus revendedores y un botón a tu WhatsApp. Compartila en tus estados y grupos.</p>
        <label class="chk"><input type="checkbox" id="alwaysAvailable" ${s.alwaysAvailable ? "checked" : ""} ${isOwner() ? "" : "disabled"}> En la tienda, mostrar todo como <b>Disponible</b> aunque no tenga cuentas cargadas (lo consigo con mis proveedores; el cliente pide por WhatsApp)</label>
        <label class="chk"><input type="checkbox" id="resellerProgramPrices" ${s.resellerProgramPrices ? "checked" : ""} ${isOwner() ? "" : "disabled"}> Mostrar la tabla “Tu ganancia” (precio público vs. precio de revendedor)</label>
        <div class="inline"><a class="pbtn" href="/revendedores" target="_blank" rel="noopener">${icon("ext")}Abrir la página</a><button class="pbtn" type="button" data-copy="${esc(location.origin + "/revendedores")}">${icon("copy")}Copiar link</button></div></section>
      <section class="card"><h2>Páginas de revendedores</h2>
        <p class="muted" style="margin:0">Cada revendedor puede armar su propia página (<code>/r/su-nombre</code>) con su logo, colores, letras y precios. Sus clientes le piden por WhatsApp a él. Si alguna página tiene algo que no te gusta, bloqueala.</p>
        <label class="chk"><input type="checkbox" id="resellerShops" ${s.resellerShops ? "checked" : ""} ${isOwner() ? "" : "disabled"}> Permitir que los revendedores publiquen su página</label>
        ${shops.length ? table(["Revendedor", "Página", "Estado", ""], shops.map((x) => `<tr><td>${esc(x.name)}</td><td><a href="/r/${esc(x.slug)}" target="_blank" rel="noopener">/r/${esc(x.slug)}</a><br><small class="muted">${esc(x.title)}</small></td>
          <td>${x.blocked ? pill("Bloqueada", "bad") : x.enabled ? pill("Publicada", "ok") : pill("Apagada", "mute")}</td>
          <td><div class="inline"><button class="pbtn sm" type="button" data-shopfeat="${esc(x.customerId)}" data-on="${x.featured ? 0 : 1}">${x.featured ? "★ Quitar destacada" : "☆ Destacar"}</button><button class="pbtn sm" type="button" data-shopblock="${esc(x.customerId)}" data-on="${x.blocked ? 0 : 1}">${x.blocked ? "Desbloquear" : "Bloquear"}</button></div></td></tr>`)) : `<div class="emptybox">Ningún revendedor armó su página todavía.</div>`}</section>
      <section class="card"><h2>Opiniones de revendedores <small>· ${testis.length}/12</small></h2>
        <p class="muted" style="margin:0">Se muestran en <b>/revendedores</b>. Cargá solo opiniones <b>reales</b> y con permiso de quien las dio: una opinión inventada hace perder la confianza (y puede traerte problemas).</p>
        <form id="testiForm" style="display:grid;gap:12px">${[...testis, ...(testis.length < 12 ? [{ name: "", business: "", text: "", rating: "" }] : [])].map((t) => `<div class="tr-row" style="display:grid;gap:8px;grid-template-columns:minmax(0,1fr) minmax(0,1fr) 110px;border-bottom:1px solid var(--line);padding-bottom:12px">
          <label>Nombre<input name="tn" maxlength="60" value="${esc(t.name)}" placeholder="Ej.: Rosa M."></label><label>Tienda o rubro (opcional)<input name="tb" maxlength="60" value="${esc(t.business ?? "")}" placeholder="Ej.: Rosa Streaming"></label>
          <label>Estrellas<select name="tr">${opt("", "—", !t.rating)}${[5, 4, 3, 2, 1].map((n) => opt(n, "★".repeat(n), n === t.rating)).join("")}</select></label>
          <label style="grid-column:1/-1">Opinión<textarea name="tt" rows="2" maxlength="400">${esc(t.text)}</textarea></label></div>`).join("")}
          <div class="inline"><button class="pbtn dark" type="submit">Guardar opiniones</button><span class="muted">Para agregar otra, completá la fila vacía. Para quitar una, borrá su texto.</span></div></form></section>
      <section class="card"><h2>Preguntas frecuentes de tu tienda <small>· ${faqs.length}/12</small></h2>
        <p class="muted" style="margin:0">Se muestran en tu tienda. Si no cargás ninguna, salen unas por defecto. Para quitar una, borrá su pregunta.</p>
        <form id="faqForm" style="display:grid;gap:12px">${[...faqs, ...(faqs.length < 12 ? [{ q: "", a: "" }] : [])].map((f) => `<div class="fq-row" style="display:grid;gap:8px;border-bottom:1px solid var(--line);padding-bottom:12px">
          <label>Pregunta<input name="fq" maxlength="140" value="${esc(f.q ?? "")}" placeholder="Ej.: ¿Cuánto dura mi compra?"></label>
          <label>Respuesta<textarea name="fa" rows="2" maxlength="500">${esc(f.a ?? "")}</textarea></label></div>`).join("")}
          <div class="inline"><button class="pbtn dark" type="submit">Guardar preguntas</button><span class="muted">Completá la fila vacía para agregar otra.</span></div></form></section>
      <section class="card"><h2>Logo</h2><div class="inline">${s.hasLogo ? `<img src="/api/settings/logo?v=${Date.now()}" alt="Logo actual" style="width:64px;height:64px;border-radius:14px;object-fit:cover;border:1px solid var(--line)"><button class="pbtn sm" type="button" data-nologo="1">Quitar logo</button>` : `<span class="muted">Sin logo: se muestra la inicial de la tienda.</span>`}</div>
        <form class="inline" id="logoForm"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen del logo"><button class="pbtn dark" type="submit">${s.hasLogo ? "Cambiar logo" : "Subir logo"}</button></form><p class="muted" style="margin:0">Imagen cuadrada, idealmente de 256×256 o más.</p></section>
      <section class="card"><h2>Portada</h2><div class="inline">${s.hasBanner ? `<img src="/api/settings/banner?v=${Date.now()}" alt="Portada actual" style="width:96px;height:96px;border-radius:14px;object-fit:cover;border:1px solid var(--line)"><button class="pbtn sm" type="button" data-nobanner="1">Quitar portada</button>` : `<span class="muted">Sin portada.</span>`}</div>
        <form class="inline" id="bannerForm"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen de portada"><button class="pbtn dark" type="submit">${s.hasBanner ? "Cambiar portada" : "Subir portada"}</button></form><p class="muted" style="margin:0">Se muestra grande al lado del título de tu tienda y es la imagen que sale <b>al compartir tu link</b> por WhatsApp o TikTok. Ideal tu logo completo o un afiche.</p></section>
      <section class="card"><h2>Así se ve tu tienda</h2><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <iframe id="lookPreview" data-look="1" src="/tienda/#inicio" title="Vista previa de la tienda en computadora" style="flex:1 1 520px;min-width:0;height:560px;border:1px solid var(--line);border-radius:12px;background:#000"></iframe>
        <iframe data-look="1" src="/tienda/#catalogo" title="Vista previa de la tienda en celular" style="width:300px;max-width:100%;height:560px;border:1px solid var(--line);border-radius:22px;background:#000"></iframe></div></section>`;
  },

  async usuarios() {
    if (!isOwner()) return `<section class="card"><div class="emptybox">Solo el dueño administra usuarios.</div></section>`;
    const [list, asis] = await Promise.all([api("GET", "/api/admin/staff"), api("GET", "/api/admin/assistant").catch(() => ({ enabled: false }))]);
    const newKey = P.tab.asisKey;
    P.tab.asisKey = null;
    return `<section class="card ${asis.enabled ? "ok-card" : ""}"><h2>🤖 Acceso para tu asistente <small>${asis.enabled ? "· prendido" : "· apagado"}</small></h2>
      <p class="muted" style="margin:0">Para que Claude entre a tu panel y haga cambios por vos (precios, descripciones, diseño). Entra como <b>Admin</b> con su propio usuario <b>asistente</b>: no puede tocar usuarios ni ser dueño, y todo lo que haga queda en <b>Auditoría</b>. Lo apagás con un toque.</p>
      ${newKey ? `<div class="pok" style="display:grid;gap:8px"><b>🔑 Esta es la llave (se muestra UNA sola vez):</b><code class="mono" style="overflow-wrap:anywhere;user-select:all">${esc(newKey)}</code>
        <button class="pbtn sm dark" type="button" data-copy="${esc(newKey)}" style="justify-self:start">${icon("copy")}Copiar llave</button>
        <small>⚠️ <b>No la pegues en el chat.</b> Pegala solo en el <b>formulario seguro</b> que te abre Claude (dice "API credential"). Si la perdés, tocá "Crear llave nueva" y la vieja deja de servir.</small></div>` : ""}
      ${asis.enabled ? `<p style="margin:0">Llave creada el ${fdt(asis.createdAt)}${asis.lastUsedAt ? ` · último uso ${fdt(asis.lastUsedAt)}` : " · todavía no la usó"}</p>` : ""}
      <div class="inline"><button class="pbtn ${asis.enabled ? "" : "dark"}" type="button" data-asis="new">${asis.enabled ? "🔁 Crear llave nueva" : "🔑 Crear llave para mi asistente"}</button>${asis.enabled ? `<button class="pbtn danger" type="button" data-asis="off">⛔ Apagar acceso</button>` : ""}</div></section>
      <section class="card"><h2>Nuevo usuario</h2><form class="form" id="staffForm"><label>Nombre<input name="name" required></label><label>Usuario<input name="username" required autocapitalize="none" pattern="[a-z0-9._-]{3,32}" title="3 a 32 minúsculas, números, punto o guion"></label>
      <label>Rol<select name="role">${opt("seller", "Vendedor: vende, renueva y carga clientes")}${opt("admin", "Admin: además aprueba pagos y maneja inventario")}</select></label><label>Contraseña inicial<input name="password" type="password" minlength="10" required></label><button class="pbtn dark" type="submit">${icon("plus")}Crear</button></form></section>
      <section class="card">${table(["Nombre", "Usuario", "Rol", "Estado", "Creado", ""], list.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc({ owner: "Dueño", admin: "Admin", seller: "Vendedor" }[u.role])}</td><td>${u.active ? pill("Activo", "ok") : pill("Inactivo", "mute")}</td><td>${fdate(u.createdAt)}</td>
        <td>${u.role !== "owner" ? `<div style="display:grid;gap:6px"><button class="pbtn sm" type="button" data-staff="${esc(u.id)}" data-on="${u.active ? 0 : 1}">${u.active ? "Desactivar" : "Activar"}</button>
          <form data-staffpw="${esc(u.id)}" style="display:grid;gap:6px"><input name="password" type="password" minlength="10" required autocomplete="new-password" placeholder="Contraseña nueva" aria-label="Contraseña nueva para ${esc(u.username)}" style="min-width:0;width:100%"><button class="pbtn sm" type="submit">Cambiar contraseña</button></form></div>` : ""}</td></tr>`))}
      <p class="muted" style="margin:10px 0 0">¿Alguien se olvidó la contraseña? Escribile una nueva (mínimo 10 letras) y tocá <b>Cambiar contraseña</b>: se cierra su sesión y entra con la nueva.</p></section>`;
  },

  async revendedores() {
    const [data, set] = await Promise.all([api("GET", "/api/admin/resellers"), api("GET", "/api/settings")]);
    const { list, apps, rent, marginPct, referralBonus = 0 } = data;
    const pending = apps.filter((a) => a.status === "pending");
    const T = P.tab, o = location.origin;
    const q = (T.rq ?? "").toLowerCase();
    const shown = list.filter((r) => !q || `${r.name} ${r.phone} ${r.shop.slug}`.toLowerCase().includes(q));
    const sent = T.rlink;
    // Ficha del revendedor: sus perfiles por cuenta, lo que debe y su lista lista para mandarle.
    const fs = T.rficha ? await api("GET", `/api/admin/resellers/${T.rficha}/sheet`).catch((e) => { toast(e.message); T.rficha = ""; return null; }) : null;
    const ficha = (() => {
      if (!fs) return "";
      const pn = (x) => x.replace(/ \(alquiler revendedores\)/, "");
      const apps = [...new Set(fs.rows.map((x) => pn(x.product)))];
      const app = apps.includes(T.rfp) ? T.rfp : "";
      const rows = fs.rows.filter((x) => !app || pn(x.product) === app).sort((a, b) => a.email.localeCompare(b.email) || a.expiresAt - b.expiresAt);
      const byAcc = Object.entries(rows.reduce((m, x) => ((m[`${pn(x.product)}|${x.email}`] ??= []).push(x), m), {}));
      const dl = (x) => daysLeft(x.expiresAt);
      const venc = rows.filter((x) => dl(x) < 0 || x.holdOpen).length, semana = rows.filter((x) => dl(x) >= 0 && dl(x) <= 7).length;
      const total = rows.reduce((t, x) => t + (x.price || 0), 0), debe = rows.filter((x) => x.pay !== "pagado");
      const st = (x) => (x.holdOpen ? pill("Esperando fecha", "mute") : dl(x) < 0 ? pill(`Venció hace ${-dl(x)} d`, "bad") : dl(x) === 0 ? pill("Vence hoy", "warn") : dl(x) <= 7 ? pill(`${dl(x)} d`, "warn") : pill(`${dl(x)} d`, "ok"));
      const PAYT = { pagado: "", pendiente: " · ⏳ pendiente", no_pago: " · ❌ no pagó" };
      const msg = `Hola ${fs.name.split(" ")[0]} 👋 tu resumen${app ? ` de *${app}*` : ""}:\n\n` + byAcc.map(([k, l]) => `*${k.split("|")[0]}* · ${k.split("|")[1]}\n` + l.map((x) => `• ${x.profile}${x.client ? ` – ${x.client}` : ""} – ${x.holdOpen ? "esperando fecha" : `vence ${fdate(x.expiresAt)}`} – ${bs(x.price || 0)}${PAYT[x.pay] ?? ""}`).join("\n")).join("\n\n")
        + `\n\nTotal: ${rows.length} perfil(es) · ${bs(total)}${semana ? `\nVencen esta semana: ${semana}` : ""}${venc ? `\nYa vencidos: ${venc}` : ""}${fs.owed ? `\n💸 Me debés: ${bs(fs.owed)}` : ""}${fs.codeLink ? `\n\n🔗 Códigos de tus cuentas: ${fs.codeLink}` : ""}`;
      return `<section class="card rficha"><h2>📋 Ficha de ${esc(fs.name)} <button class="pbtn sm" type="button" data-rficha="">Cerrar</button></h2>
        <div class="ctl-kpis"><div><small>Perfiles</small><b>${rows.length}</b></div><div><small>Vencen en 7 días</small><b>${semana}</b></div><div><small>Vencidos</small><b class="${venc ? "down" : ""}">${venc}</b></div><div><small>Te debe (fiado)</small><b class="${fs.owed ? "down" : ""}">${bs(fs.owed)}</b></div><div><small>Su saldo</small><b>${wal(fs.balance, fs.currency)}</b></div></div>
        ${apps.length > 1 ? `<div class="tabs ctl-chips" role="tablist">${["", ...apps].map((a) => `<button type="button" role="tab" data-tab="rfp:${esc(a)}" aria-selected="${app === a}">${a ? esc(a) : `Todas (${fs.rows.length})`}</button>`).join("")}</div>` : ""}
        <div class="inline">${fs.phone ? `<a class="pbtn green" href="${waLink(fs.phone, msg)}" target="_blank" rel="noopener">💬 Mandarle su lista</a>` : `<span class="pp pp-warn">Sin WhatsApp</span>`}
          <button class="pbtn" type="button" data-copy="${esc(msg)}">${icon("copy")}Copiar lista</button>
          ${debe.length || fs.owed ? `<button class="pbtn" type="button" data-fgo="${esc(fs.name)}">💸 Ver su fiado</button>` : ""}
          ${fs.codeLink ? "" : `<button class="pbtn" type="button" data-rcode="${esc(fs.id)}">🔗 Crear su link de códigos</button>`}</div>
        ${byAcc.length ? byAcc.map(([k, l]) => `<div class="racc"><div class="racc-h"><b>${esc(k.split("|")[0])}</b> <span class="mono">${esc(k.split("|")[1])}</span> <small class="muted">${l.length} perfil(es)</small></div>
          ${l.map((x) => `<div class="racc-r"><span><b>${esc(x.profile)}</b>${x.client ? ` · ${esc(x.client)}` : ` · <small class="muted">para él</small>`}</span><span>${x.holdOpen ? "" : fdate(x.expiresAt)} ${st(x)}</span><span>${bs(x.price || 0)}${x.pay !== "pagado" ? ` ${pill(x.pay === "no_pago" ? "No pagó" : "Pendiente", "bad")}` : ""}</span></div>`).join("")}</div>`).join("") : `<div class="emptybox">Todavía no tiene perfiles${app ? ` de ${esc(app)}` : ""}.</div>`}</section>`;
    })();
    const sentCard = sent ? `<section class="card ok-card" id="rsent"><h2>✅ Listo: ${esc(sent.name)}</h2>${sent.pin && !sent.code ? `<p style="margin:0">Su PIN nuevo es <b class="bigpin">${esc(sent.pin)}</b>. El anterior ya no sirve: mandáselo ahora.</p>` : ""}
      <div class="linkbar"><span class="muted">${sent.code ? "PIN" : "Su página"}</span><b>${esc(sent.code ? sent.page.replace("PIN: ", "") : sent.page)}</b><button class="pbtn sm" type="button" data-copy="${esc(sent.page)}">${icon("copy")}Copiar</button></div>
      ${sent.pin && !sent.code ? `<div class="linkbar"><span class="muted">Entra con su número y PIN</span><b>${esc(sent.phone)} · PIN ${esc(sent.pin)}</b><button class="pbtn sm" type="button" data-copy="${esc(sent.pin)}">${icon("copy")}Copiar PIN</button></div>` : ""}
      <div class="linkbar"><span class="muted">${sent.code ? "Link de códigos" : "Dónde entra"}</span><b>${esc(sent.url)}</b><button class="pbtn sm" type="button" data-copy="${esc(sent.url)}">${icon("copy")}Copiar</button></div>
      <div class="inline"><a class="pbtn green" href="${waLink(sent.phone, sent.msg)}" target="_blank" rel="noopener">${icon("wa")}Mandarle todo por WhatsApp</a><button class="pbtn" type="button" data-tab="rlink:">Cerrar</button></div></section>` : "";
    // Precio de revendedor para todos: arriba y a la vista (antes estaba al fondo de la página).
    const bulk = isOwner() ? bulkResForm() : "";
    const DAYMS = 86400000, now = Date.now();
    const dormido = (r) => r.createdAt < now - 14 * DAYMS && (!r.lastOrderAt || r.lastOrderAt < now - 14 * DAYMS);
    const rf = T.rf ?? "todos";
    const shown2 = shown.filter((r) => rf === "todos" || (rf === "activos" && !dormido(r)) || (rf === "dormidos" && dormido(r)))
      .sort((a, b) => b.spent30 - a.spent30 || (b.lastOrderAt ?? 0) - (a.lastOrderAt ?? 0));
    const topCard = (r) => T.rtop !== r.id ? "" : `<form class="rtopf" data-rtopf="${esc(r.id)}" data-name="${esc(r.name)}" data-bal="${r.balance}" data-cur="${esc(r.currency ?? "")}" autocomplete="off">
          <b>💰 Cargar saldo a ${esc(r.name)}</b>
          <label>Monto (${r.currency === "USD" ? "US$" : currencySym()}) <small class="muted">en negativo para descontar</small><input name="amount" inputmode="decimal" required placeholder="Ej.: 100" data-rtopamt="1"></label>
          <label>Motivo<input name="reason" maxlength="120" value="Recarga de saldo (panel)" required></label>
          <div class="rtopprev" aria-live="polite">Saldo de ${esc(r.name.split(" ")[0])}: <b>${wal(r.balance, r.currency)}</b> → <b>…</b></div>
          <div class="inline"><button class="pbtn dark" type="submit" disabled>Escribí el monto</button><button class="pbtn" type="button" data-tab="rtop:">Cancelar</button></div></form>`;
    // Invitar a todos: una fila guiada. Primero los que nunca entraron; a los que ya entraron no se les cambia el PIN.
    const inv = (T.inv ??= { on: false, all: false, i: 0, done: {} });
    // Por defecto solo a quienes todavía no tienen PIN: a los que ya lo tienen no se les cambia (puede que ya lo usen).
    const never = list.filter((r) => !r.hasPin), entered = list.filter((r) => r.hasPin);
    // La fila se arma al tocar "Empezar" y no cambia mientras avanzás (al darle PIN, nadie se "sale" de la fila).
    const queue = inv.on && inv.ids ? inv.ids.map((id) => list.find((r) => r.id === id)).filter(Boolean) : (inv.all ? list : never);
    const cur = queue[inv.i];
    const invMsg = (k) => `${k.msg}\n\n🧩 *Nuevo:* en *Clientes → Repartir perfiles* anotás a quién le diste cada perfil de tus cuentas. Te avisa cuándo vence cada uno y cuánto te deben.`;
    const inviteCard = canReview() ? `<section class="card invite"><h2>📲 Invitar a tus revendedores <small>${never.length} sin acceso todavía · ${entered.length} ya tienen PIN</small></h2>
      ${!inv.on ? `<p class="muted" style="margin:0">Te armo una fila: por cada revendedor generás su PIN y le mandás el acceso por WhatsApp con un toque, y pasás al siguiente. A los que ya tienen PIN no se les cambia.</p>
        <div class="inline" style="flex-wrap:wrap"><button class="pbtn dark" type="button" data-inv="start" ${queue.length ? "" : "disabled"}>▶ Empezar (${never.length})</button><button class="pbtn sm" type="button" data-inv="all">${inv.all ? "☑️" : "⬜"} Incluir a los que ya tienen PIN (les cambia el PIN)</button></div>`
      : cur ? `<div class="invstep"><div><small class="muted">${inv.i + 1} de ${queue.length}</small><b>${esc(cur.name)}</b><span class="muted">${esc(cur.phone)} · ${cur.lastLoginAt ? `entró el ${fdate(cur.lastLoginAt)}` : cur.hasPin ? "tiene PIN" : "sin acceso todavía"} · ${cur.services} servicio(s)</span></div>
          ${inv.done[cur.id] ? `<a class="pbtn green" href="${waLink(cur.phone, invMsg(inv.done[cur.id]))}" target="_blank" rel="noopener" data-invsent="${esc(cur.id)}">${icon("wa")}Abrir WhatsApp (PIN ${esc(inv.done[cur.id].pin)})</a>`
            : `<button class="pbtn dark" type="button" data-inv="pin" data-id="${esc(cur.id)}">🔑 Generar PIN de ${esc(cur.name.split(" ")[0])}</button>`}
          <div class="inline">${inv.i ? `<button class="pbtn sm" type="button" data-inv="prev">◀ Anterior</button>` : ""}<button class="pbtn sm" type="button" data-inv="next">${inv.done[cur.id] ? "Siguiente ▶" : "Saltar ▶"}</button><button class="pbtn sm" type="button" data-inv="stop">Terminar</button></div></div>`
      : `<p style="margin:0">✅ ¡Listo! Recorriste ${queue.length} revendedor(es)${Object.keys(inv.sent ?? {}).length ? ` y le mandaste el acceso a ${Object.keys(inv.sent).length}` : ""}.</p><button class="pbtn sm" type="button" data-inv="stop" style="justify-self:start">Cerrar</button>`}</section>` : "";
    // Cobrar alquileres en fila: por revendedor, lo que le vence en 7 días (o ya venció), en un solo WhatsApp.
    const due = canReview() ? await api("GET", "/api/admin/assignments?days=7").catch(() => []) : [];
    const byRes = new Map();
    for (const a of due.filter((x) => x.customerKind === "reseller" && !x.holdOpen)) {
      const g = byRes.get(a.customerId) ?? { id: a.customerId, name: a.customerName ?? "?", phone: a.customerPhone, items: [] };
      g.items.push(a); byRes.set(a.customerId, g);
    }
    const groups = [...byRes.values()].map((g) => ({ ...g, total: g.items.reduce((t, a) => t + (a.effectivePrice ?? 0), 0) })).sort((x, y) => y.total - x.total);
    const cob = (T.cob ??= { on: false, i: 0, sent: {} });
    const cg = groups[cob.i];
    const cobMsg = (g) => `Hola ${g.name.split(" ")[0]} 👋 te paso tus alquileres que vencen esta semana:\n${g.items.sort((x, y) => x.customerExpiresAt - y.customerExpiresAt).map((a) => `• ${a.product.replace(/ \(alquiler revendedores\)/, "")} (${a.email}) — ${daysLeft(a.customerExpiresAt) < 0 ? "venció" : "vence"} el ${fdate(a.customerExpiresAt)} — ${bs(a.effectivePrice ?? 0)}`).join("\n")}\n*Total: ${bs(g.total)}*\n\nRenovalos desde tu panel con tu saldo o por QR 👉 ${location.origin}/hub (Clientes → Repartir perfiles → Renovar). ¡Gracias! 🙌`;
    const cobCard = groups.length ? `<section class="card cobra"><h2>💰 Cobrar alquileres de la semana <small>${groups.length} revendedor(es) · ${bs(groups.reduce((t, g) => t + g.total, 0))}</small></h2>
      ${!cob.on ? `<div class="cobsum">${groups.slice(0, 6).map((g) => `<span><b>${esc(g.name)}</b> ${g.items.length} cuenta(s) · ${bs(g.total)}${cob.sent[g.id] ? " ✅" : ""}</span>`).join("")}${groups.length > 6 ? `<span class="muted">y ${groups.length - 6} más…</span>` : ""}</div>
        <button class="pbtn dark" type="button" data-cob="start" style="justify-self:start">▶ Avisarles uno por uno</button>`
      : cg ? `<div class="invstep"><div><small class="muted">${cob.i + 1} de ${groups.length}</small><b>${esc(cg.name)}</b><span class="muted">${cg.items.length} cuenta(s) · <b>${bs(cg.total)}</b></span></div>
          <pre class="cobpre">${esc(cobMsg(cg))}</pre>
          ${cg.phone ? `<a class="pbtn green" href="${waLink(cg.phone, cobMsg(cg))}" target="_blank" rel="noopener" data-cobsent="${esc(cg.id)}">${icon("wa")}Mandar por WhatsApp${cob.sent[cg.id] ? " ✅" : ""}</a>` : `<span class="pp pp-warn">Sin WhatsApp</span>`}
          <div class="inline"><button class="pbtn sm" type="button" data-cob="next">Siguiente ▶</button><button class="pbtn sm" type="button" data-cob="stop">Terminar</button></div></div>`
      : `<p style="margin:0">✅ ¡Listo! Les avisaste a ${Object.keys(cob.sent).length} de ${groups.length}.</p><button class="pbtn sm" type="button" data-cob="stop" style="justify-self:start">Cerrar</button>`}</section>` : "";
    return `${cobCard}${inviteCard}${sentCard}${ficha}${bulk}<section class="card ${set.resellerShops ? "ok-card" : ""}"><h2>🏪 Páginas de revendedores: ${set.resellerShops ? "ACTIVADAS ✅" : "APAGADAS ⛔"}</h2>
      <p class="muted" style="margin:0">Para que un revendedor tenga y publique su página hacen falta <b>2 pasos</b>: (1) este interruptor general encendido, y (2) en su tarjeta, tocar <b>✦ Habilitar página</b>. Si está apagado acá, sale el cartel de "no habilitado".</p>
      ${isOwner() ? `<button class="pbtn ${set.resellerShops ? "" : "dark"}" type="button" data-togshops="${set.resellerShops ? "0" : "1"}" style="justify-self:start">${set.resellerShops ? "Apagar páginas de revendedores" : "✅ Activar páginas de revendedores"}</button>` : `<p class="muted" style="margin:0">Solo el dueño puede cambiar esto.</p>`}
      <div class="inline" style="flex-wrap:wrap;gap:8px;align-items:center;border-top:1px solid var(--line);padding-top:10px"><span><b>🛒 Qué compran tus revendedores:</b> ${set.resellerOnlyCatalog ? "solo los productos <b>solo revendedores</b> (tus alquileres)" : "todo el catálogo + los productos solo revendedores"}</span>
        ${isOwner() ? `<button class="pbtn sm ${set.resellerOnlyCatalog ? "" : "dark"}" type="button" data-togrescat="${set.resellerOnlyCatalog ? "0" : "1"}">${set.resellerOnlyCatalog ? "Mostrarles todo el catálogo" : "Mostrarles solo lo de revendedores"}</button>` : ""}</div></section>
      ${pending.length ? `<section class="card ok-card" style="border-color:var(--warn)"><h2>📨 Solicitudes nuevas <small>${pending.length} quieren ser revendedores</small></h2>
      <div class="rgrid">${pending.map((a) => `<div class="rcard"><div class="rtop"><span class="ravatar">${esc(a.name[0] ?? "?")}</span><div><b>${esc(a.name)}</b><small class="muted">${esc(a.phone)} · ${fdt(a.createdAt)}</small></div></div>
        ${a.note ? `<p class="muted" style="margin:0">“${esc(a.note)}”</p>` : ""}${a.existingCustomer ? `<small class="muted">Ya es tu cliente: se pasa a revendedor.</small>` : ""}
        <div class="inline">${canReview() ? `<button class="pbtn sm green" type="button" data-appok="${esc(a.id)}">✅ Aprobar y mandar acceso</button>` : `<small class="muted">La aprueba el dueño o un admin.</small>`}<a class="pbtn sm" href="${waLink(a.phone, `Hola ${a.name.split(" ")[0]} 👋`)}" target="_blank" rel="noopener">${icon("wa")}Escribirle</a>${canReview() ? `<button class="pbtn sm" type="button" data-appno="${esc(a.id)}">Rechazar</button>` : ""}</div></div>`).join("")}</div></section>` : ""}
    ${canReview() ? `<section class="card"><h2>${icon("userplus")}Nuevo revendedor <small>entra a su panel en ${esc(set.platformName || "GaboHub")}; la página se la activás cuando quieras</small></h2>
      <form class="form" id="resForm">
        <label>Nombre<input name="name" required maxlength="80" placeholder="Ej.: Ari Streaming" data-slugsrc="1"></label>
        <label>WhatsApp (con código de país)<input name="phone" required inputmode="tel" placeholder="59170000000"></label>
        <label>Correo (opcional)<input name="email" type="email" placeholder="revendedor@correo.com"><small class="muted">Si lo ponés, podrá entrar con correo y contraseña (pone su contraseña desde su panel).</small></label>
        <label style="grid-column:1/-1">Plan<select name="plan" id="resPlan">${opt("panel", "Solo panel (comprar, cuentas, códigos, clientes, saldo)", true)}${opt("page", "Con página propia (premium): panel + su tienda /r/…", false)}</select></label>
        <div id="resPageFields" hidden style="display:contents">
          <label>Dirección de su página<span class="slugin"><small>…/r/</small><input name="slug" maxlength="30" placeholder="ari-streaming" pattern="[a-z0-9][a-z0-9-]{1,28}[a-z0-9]"></span></label>
          <label>Nombre de su página<input name="title" maxlength="40" placeholder="Ari Streaming"></label>
          <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="publish" checked> Publicar su página ya (después él la personaliza con su logo y colores)</label>
        </div>
        <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="consent" checked> Acepta recibir avisos por WhatsApp</label>
        <button class="pbtn dark" type="submit">${icon("plus")}Crear revendedor</button>
      </form></section>` : ""}

    <section class="card"><h2>Tus revendedores <small>${list.length}</small><input class="rsearch" id="rq" placeholder="Buscar" value="${esc(T.rq ?? "")}" style="margin-left:auto;max-width:220px"></h2>
      <div class="tabs ctl-chips" role="tablist" aria-label="Actividad">${[["todos", `Todos (${list.length})`], ["activos", `Activos (${list.filter((r) => !dormido(r)).length})`], ["dormidos", `💤 Sin comprar +14 días (${list.filter(dormido).length})`]].map(([k, t]) => `<button type="button" role="tab" data-tab="rf:${k}" aria-selected="${rf === k}">${t}</button>`).join("")}</div>
      <p class="muted" style="margin:0">Ordenados por lo que te compraron en los últimos 30 días.</p>
      ${shown2.length ? `<div class="rgrid">${shown2.map((r) => `<div class="rcard${dormido(r) ? " rsleep" : ""}">
        <div class="rtop"><span class="ravatar">${esc(r.name[0] ?? "?")}</span><div><b>${esc(r.name)}</b><small class="muted">${esc(r.phone || "sin WhatsApp")}</small></div>${!r.pageAllowed ? pill("Solo panel", "mute") : r.shop.suspended ? pill("Sin pagar alquiler", "bad") : r.shop.enabled && !r.shop.blocked ? pill("Página publicada", "ok") : r.shop.blocked ? pill("Bloqueada", "bad") : pill("Página apagada", "mute")}</div>
        ${r.pageAllowed && rent.enabled && r.shop.enabled ? `<small class="muted">${r.shop.paidUntil ? `Alquiler pagado hasta <b>${fdate(r.shop.paidUntil)}</b>` : "Alquiler: se cobra en la próxima revisión"}</small>` : ""}
        <div class="rstats"><div title="Plata que te dejó a cuenta: se la debés en servicios"><span>Saldo (le debés)</span><b>${wal(r.balance, r.currency)}</b></div><div><span>Te compró (30 d)</span><b>${bs(r.spent30)}</b></div><div><span>Servicios</span><b>${r.services}</b></div><div><span>Sus clientes</span><b>${r.clients}</b></div>${r.referrals ? `<div><span>🎁 Trajo</span><b>${r.referrals}</b></div>` : ""}</div>
        ${canReview() ? resellerCountryRow(r) : ""}
        <small class="${dormido(r) ? "down" : "muted"}">${r.lastOrderAt ? `${dormido(r) ? "💤 " : ""}Última compra: ${fdate(r.lastOrderAt)} (${(() => { const n = Math.floor((now - r.lastOrderAt) / DAYMS); return n === 0 ? "hoy" : n === 1 ? "ayer" : `hace ${n} días`; })()})` : "💤 Todavía no te compró nada"}</small>
        ${dormido(r) && r.phone ? `<a class="pbtn sm" href="${waLink(r.phone, `¡Hola ${r.name.split(" ")[0]}! 👋 ¿Cómo vas? ¿Te ayudo a arrancar con algo? Escribime y te paso los precios de hoy 🙌`)}" target="_blank" rel="noopener">💬 Escribirle para reactivarlo</a>` : ""}
        ${topCard(r)}
        ${r.pageAllowed ? `<div class="linkbar sm"><a href="/r/${esc(r.shop.slug)}" target="_blank" rel="noopener">${esc(o.replace(/^https?:\/\//, ""))}/r/${esc(r.shop.slug)}</a><button class="pbtn sm" type="button" data-copy="${esc(o)}/r/${esc(r.shop.slug)}" aria-label="Copiar link">${icon("copy")}</button></div>` : ""}
        <div class="inline">
          ${canReview() ? `<button class="pbtn sm dark" type="button" data-rsend="${esc(r.id)}" data-name="${esc(r.name)}">${icon("wa")}Nuevo PIN y acceso</button>` : ""}
          <a class="pbtn sm green" href="${waLink(r.phone, guideMsg(r.name, set.platformName || "GaboHub", o, r.shop.slug, r.pageAllowed))}" target="_blank" rel="noopener">📖 Mandarle la guía</a>
          ${!canReview() ? "" : r.pageAllowed
            ? `<button class="pbtn sm" type="button" data-rpub="${esc(r.id)}" data-on="${r.shop.enabled ? "" : "1"}">${r.shop.enabled ? "Apagar página" : "Publicar página"}</button>
               <button class="pbtn sm" type="button" data-redit="${esc(r.id)}">${icon("edit")}Dirección</button>
               <button class="pbtn sm" type="button" data-rpage="${esc(r.id)}" data-on="">Quitar página</button>`
            : `<button class="pbtn sm green" type="button" data-rpage="${esc(r.id)}" data-on="1">✦ Habilitar página</button>`}
          <button class="pbtn sm dark" type="button" data-rficha="${esc(r.id)}">📋 Ficha</button>
          <button class="pbtn sm" type="button" data-rcode="${esc(r.id)}">🔗 Link de códigos${r.codeLink ? " ✓" : ""}</button>
          ${isOwner() ? `<button class="pbtn sm" type="button" data-rtop="${esc(r.id)}">${icon("coins")}Cargar saldo</button>` : ""}
        </div></div>`).join("")}</div>` : `<div class="emptybox">${list.length ? "No hay revendedores con ese filtro." : "Todavía no tenés revendedores. Creá el primero arriba."}</div>`}
      <p class="muted" style="margin:0">Ellos entran a ${esc(set.platformName || "GaboHub")} con su <b>número y PIN</b> y ven: Precios para comprar con saldo o QR, Mis cuentas, Mis clientes y Mi página para ponerle logo, colores y sus precios. Los precios de revendedor los ponés en Productos → “Precio revendedor” o con “Solo revendedores”.</p></section>
    ${isOwner() ? `<section class="card"><h2>${icon("gear")}Ajustes de revendedores</h2>
      <form class="form" id="resCfg">
        <label>Ganancia sugerida para sus precios (%)<input name="margin" inputmode="numeric" value="${esc(marginPct)}"><small class="muted">El asistente les propone tu precio + este %. Ellos lo pueden cambiar.</small></label>
        <label>🎁 Premio por traer un revendedor (${currencySym()}, 0 = apagado)<input name="referral" inputmode="decimal" value="${referralBonus / 100}"><small class="muted">Cuando un revendedor comparte su link y traés a otro que aprobás, le cae este saldo. Cada revendedor ve su link en “Referí y ganá”.</small></label>
        <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="rentOn" ${rent.enabled ? "checked" : ""}> Cobrar alquiler mensual por la página (se descuenta solo de su saldo)</label>
        <label>Precio por mes (${currencySym()})<input name="price" inputmode="decimal" value="${rent.price / 100}"></label>
        <label>Gratis si ese mes te compran (${currencySym()}, 0 = nunca)<input name="free" inputmode="decimal" value="${rent.freeIfSpent / 100}"></label>
        <label>Días de gracia sin pagar<input name="grace" inputmode="numeric" value="${rent.graceDays}"></label>
        <p class="muted" style="grid-column:1/-1;margin:0">Si no tiene saldo, su página sigue publicada los días de gracia y después se apaga sola. Apenas recarga, se cobra y se prende sola.</p>
        <button class="pbtn dark" type="submit">Guardar ajustes</button></form>
</section>` : ""}`;
  },

  async codigos() {
    if (!isOwner()) return `<section class="card"><div class="emptybox">Solo el dueño conecta correos.</div></section>`;
    const [boxes, codes] = await Promise.all([api("GET", "/api/admin/mailboxes"), api("GET", "/api/admin/codes")]);
    const T = P.tab;
    const ed = T.mbEdit === "new" ? { kind: T.mbKind ?? "gmail" } : boxes.find((b) => b.id === T.mbEdit);
    const kind = ed ? (T.mbKind ?? ed.kind ?? "gmail") : "gmail";
    const st = (b) => !b.hasPassword ? pill("Sin contraseña", "bad") : b.lastError ? pill("Error", "bad") : b.lastOkAt ? pill("Conectado", "ok") : pill("Conectando…", "warn");
    const ago = (t) => { if (!t) return "nunca"; const m = Math.round((Date.now() - t) / 60000); return m < 1 ? "recién" : m < 60 ? `hace ${m} min` : fdt(t); };
    const shop = location.origin + "/tienda/#codigos";
    return `<section class="card"><h2>${icon("mailbox")}Cómo funciona</h2>
      <p class="muted" style="margin:0">Conectás el correo donde te llegan los códigos (Disney, Netflix, Prime…). Cada minuto la plataforma lee los correos nuevos, saca el código y se lo muestra <b>solo</b> al cliente o revendedor que tiene esa cuenta, durante 30 minutos. Un correo sirve para todas las cuentas cuyos códigos llegan ahí. Si usás Hotmail, reenviá esos correos a un Gmail y conectá el Gmail.</p>
      <div class="inline"><span class="muted">Link para tus clientes:</span><code>${esc(shop)}</code><button class="pbtn sm" type="button" data-copy="${esc(shop)}">${icon("copy")}Copiar</button></div></section>
    ${ed ? `<section class="card"><h2>${icon("mailbox")}${T.mbEdit === "new" ? "Conectar un correo" : "Editar correo"}</h2>
      <div class="mbkinds"><button type="button" data-tab="mbKind:gmail" aria-pressed="${kind === "gmail"}"><b>G</b><span><strong>Gmail</strong><small>Con una contraseña de aplicación</small></span></button>
        <button type="button" data-tab="mbKind:imap" aria-pressed="${kind === "imap"}"><b>@</b><span><strong>Correo de tu dominio</strong><small>Hostinger, cPanel y similares (IMAP)</small></span></button></div>
      <form class="form" id="mbForm" data-id="${esc(ed.id ?? "")}" data-kind="${kind}">
        <label style="grid-column:1/-1">${kind === "gmail" ? "Correo de Gmail" : "Correo"}<input name="address" type="email" required placeholder="${kind === "gmail" ? "tutienda.codigos@gmail.com" : "codigos@tudominio.com"}" value="${esc(ed.address ?? "")}"></label>
        ${kind === "imap" ? `<label>Servidor IMAP<input name="host" required placeholder="imap.hostinger.com" value="${esc(ed.host ?? "")}"></label><label>Puerto<input name="port" inputmode="numeric" value="${esc(ed.port ?? 993)}"></label><label style="grid-column:1/-1">Usuario (si es distinto del correo)<input name="user" value="${esc(ed.user && ed.user !== ed.address ? ed.user : "")}"></label>` : ""}
        <label style="grid-column:1/-1">${kind === "gmail" ? "Contraseña de aplicación" : "Contraseña"}<input name="password" type="password" autocomplete="new-password" ${ed.id ? `placeholder="Dejala vacía para no cambiarla"` : "required"}><small class="muted">${kind === "gmail" ? "Son 16 letras. Los espacios no importan." : "La del correo."} Se guarda cifrada y nunca se muestra.</small></label>
        ${kind === "gmail" ? `<details style="grid-column:1/-1"><summary><b>Cómo crear la contraseña de aplicación</b></summary><ol class="muted" style="margin:8px 0 0;padding-left:20px">
          <li>Entrá a <b>myaccount.google.com</b> con ese Gmail.</li><li>Seguridad → activá la <b>Verificación en 2 pasos</b> (si no la tenés).</li>
          <li>Buscá <b>“Contraseñas de aplicaciones”</b> (o entrá a myaccount.google.com/apppasswords).</li><li>Nombre: <b>GaboHub</b> → Crear. Copiá las 16 letras y pegalas acá.</li>
          <li>En Gmail → Configuración → Reenvío y POP/IMAP: <b>IMAP activado</b>.</li></ol></details>` : ""}
        <label style="grid-column:1/-1">Nombre (opcional)<input name="name" maxlength="60" value="${esc(ed.name ?? "")}" placeholder="Ej.: Códigos Disney"></label>
        <label style="grid-column:1/-1">Leer solo correos de <small class="muted">(vacío = de cualquier plataforma)</small>
          <span class="inline" style="flex-wrap:nowrap"><input name="senders" placeholder="Ej.: disney" value="${esc((ed.senderAllowlist ?? []).join(", "))}" style="flex:1"><button class="pbtn sm" type="button" data-sendpreset="disney">Solo Disney / MyDisney</button></span>
          <small class="muted">Se compara con el remitente (nombre o correo). “disney” toma Disney+ y MyDisney, en español o inglés. Separá varias con coma.</small></label>
        <details style="grid-column:1/-1"><summary><b>Asuntos que se leen</b> <small class="muted">(avanzado)</small></summary><textarea name="subjects" rows="4" style="width:100%;margin-top:8px" placeholder="Uno por línea. Vacío = los de siempre (código, acceso, verificación, hogar…)">${esc((ed.subjectAllowlist ?? []).join("\n"))}</textarea><small class="muted">Solo se guardan correos cuyo asunto contiene alguna de estas palabras. El resto ni se mira.</small></details>
        <div class="inline" style="grid-column:1/-1;justify-content:flex-end"><button class="pbtn" type="button" data-tab="mbEdit:">Cancelar</button><button class="pbtn" type="button" data-mbtest="1">${icon("flag")}Probar conexión</button><button class="pbtn dark" type="submit">Guardar</button></div>
      </form></section>` : ""}
    <section class="card"><h2>Correos conectados <button class="pbtn dark sm" type="button" data-tab="mbEdit:new" style="margin-left:auto">${icon("plus")}Conectar un correo</button></h2>
      ${boxes.length ? table(["Correo", "Tipo", "Estado", "Última lectura", "Códigos", ""], boxes.map((b) => `<tr><td><b>${esc(b.name || b.address)}</b>${b.name ? `<br><small class="muted">${esc(b.address)}</small>` : ""}${b.lastError ? `<br><small style="color:var(--bad)">${esc(b.lastError)}</small>` : ""}</td><td>${b.kind === "imap" ? esc(b.host) : "Gmail"}</td><td>${st(b)}</td><td>${ago(b.lastCheckAt)}</td><td>${b.codesFound ?? 0}</td>
        <td><div class="inline"><button class="pbtn sm" type="button" data-mbcheck="${esc(b.id)}">${icon("renew")}Leer ahora</button><button class="pbtn sm" type="button" data-tab="mbEdit:${esc(b.id)}">${icon("edit")}</button><button class="pbtn sm" type="button" data-mbdel="${esc(b.id)}" aria-label="Quitar">${icon("trash")}</button></div></td></tr>`))
        : `<div class="emptybox">Todavía no conectaste ningún correo.<br><br><button class="pbtn dark" type="button" data-tab="mbEdit:new">${icon("plus")}Conectar un correo</button></div>`}</section>
    <section class="card"><h2>Últimos códigos que llegaron <small>los clientes ven solo los de sus cuentas</small></h2>
      ${table(["Hora", "Cuenta", "Tipo", "Código"], codes.map((c) => `<tr><td>${fdt(c.receivedAt)}</td><td>${esc(c.to || "—")}<br><small class="muted">${c.matched ? esc(c.product) : "⚠ no coincide con ninguna cuenta cargada"}</small></td><td><span class="pp pp-${{login:"ok",hogar:"mute",temporal:"warn",verificacion:"ok"}[c.kind] || "mute"}">${KLABEL_P[c.kind] || "Código"}</span><br><small class="muted">${esc(c.subject)}</small></td><td><b style="font-size:16px;letter-spacing:.08em">${esc(c.code || "")}</b>${c.link ? ` <a href="${esc(c.link)}" target="_blank" rel="noopener">enlace</a>` : ""}</td></tr>`), "Todavía no llegó ningún código.")}</section>`;
  },

  async auditoria() {
    if (!isOwner()) return `<section class="card"><div class="emptybox">Solo el dueño ve la auditoría.</div></section>`;
    const [list, staff, customers, products] = await Promise.all([
      api("GET", "/api/admin/audit?limit=300"), api("GET", "/api/admin/staff").catch(() => []),
      api("GET", "/api/admin/customers").catch(() => []), api("GET", "/api/admin/products").catch(() => []),
    ]);
    const maps = { staff: Object.fromEntries(staff.map((x) => [x.id, x])), cust: Object.fromEntries(customers.map((x) => [x.id, x])), prod: Object.fromEntries(products.map((x) => [x.id, x])) };
    // Filtros simples: plata, accesos y precios.
    const AUDF = { plata: /^(ledger|wallet|order|renewal|expense|assignment\.refund|fiado|account\.renew_paid)/, accesos: /(login|pin|staff\.|2fa|credentials|secrets|password|assistant)/, precios: /^(price_group|product|coupon|reseller\.prices|settings\.min_margin|reseller\.coupon)/ };
    const af = AUDF[P.tab.audf] ? P.tab.audf : "";
    const shownA = list.filter((a) => !af || AUDF[af].test(a.action));
    const rows = shownA.map((a) => { const t = auditText(a, maps); return `<div class="audrow">
      <div class="audtxt"><b>${esc(t.who)}</b>${t.role ? ` <span class="muted">(${esc(t.role)})</span>` : ""} ${esc(t.what)}${t.detail ? ` <span class="auddet">· ${esc(t.detail)}</span>` : ""}</div>
      <div class="audmeta"><small class="muted">${fdt(a.at)}</small><details class="audtech"><summary>Ver detalle técnico</summary><code>${esc(a.action)} · ${esc(a.entityId)}${a.data && Object.keys(a.data).length ? " · " + esc(JSON.stringify(a.data)) : ""}</code></details></div></div>`; }).join("");
    return `<section class="card"><h2>Auditoría <small>· quién hizo qué, en orden (últimos ${list.length})</small></h2>
      <div class="tabs ctl-chips" role="tablist" aria-label="Filtrar">${[["", "Todo"], ["plata", "💰 Plata"], ["accesos", "🔑 Accesos"], ["precios", "🏷️ Precios"]].map(([k, t]) => `<button type="button" role="tab" data-tab="audf:${k}" aria-selected="${af === k}">${t}${k ? ` (${list.filter((a) => AUDF[k].test(a.action)).length})` : ""}</button>`).join("")}</div>
      ${rows || `<div class="emptybox">No hay movimientos con ese filtro.</div>`}</section>`;
  },

  async configuracion() {
    const s = await api("GET", "/api/settings");
    return `${canReview() ? `<section class="card"><h2>Mi tienda</h2><form class="form" id="setForm"><label>Nombre de la tienda<input name="storeName" required maxlength="60" value="${esc(s.storeName)}"></label>
      <label>Nombre de la plataforma (revendedores)<input name="platformName" maxlength="40" value="${esc(s.platformName ?? "GaboHub")}"></label>
      <label>WhatsApp de ventas (con código de país)<input name="whatsapp" inputmode="numeric" placeholder="59170000000" value="${esc(s.whatsapp)}"></label>
      <label>Símbolo de la moneda <small class="muted">· cómo se muestran los precios</small><input name="currencySymbol" maxlength="6" list="curlist" value="${esc(s.currencySymbol ?? "Bs")}" placeholder="Bs"><datalist id="curlist"><option value="Bs"><option value="US$"><option value="$"><option value="₲"></datalist></label>
      <label style="grid-column:1/-1">Nota de pago (banco, titular, instrucciones)<input name="paymentNote" maxlength="300" value="${esc(s.paymentNote)}" placeholder="Banco Unión · Gabriel Pérez · Cta. 1-234567"></label><button class="pbtn dark" type="submit">Guardar</button></form></section>
      <section class="card"><h2>${icon("plus")}Armá tu combo <small>descuento en la tienda cuando el cliente lleva varios servicios sueltos</small></h2>
        <form class="form" id="comboForm">${["2 servicios", "3 servicios", "4 o más"].map((t, i) => `<label>Descuento ${t} (${currencySym()})<input name="d${i}" inputmode="decimal" value="${(s.comboDiscounts?.[i] ?? 0) / 100}"></label>`).join("")}
        <p class="muted" style="grid-column:1/-1;margin:0">Los combos ya armados mantienen su precio. Los revendedores no reciben este descuento. Poné 0 en los tres para apagar “Armá tu combo”.</p>
        <button class="pbtn dark" type="submit">Guardar descuentos</button></form></section>
      <section class="card"><h2>${icon("qr")}QR de cobro</h2><div class="inline">${s.hasQr ? `<img src="/api/settings/qr?t=${Date.now()}" alt="QR actual" style="width:140px;height:140px;object-fit:contain;background:#fff;border-radius:8px;border:1px solid var(--line)">` : `<span class="muted">Todavía no subiste el QR.</span>`}</div>
        <form class="inline" id="qrForm"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen del QR"><button class="pbtn dark" type="submit">${s.hasQr ? "Cambiar QR" : "Subir QR"}</button></form></section>` : ""}
      ${isOwner() ? await ownerCards() : ""}
      ${isOwner() ? await aiCard() : ""}
      ${await pushCard()}
      ${isOwner() ? await telegramCard() : ""}
      ${isOwner() ? await binanceCard() : ""}
      ${canReview() ? await payMethodsCard() : ""}
      ${canReview() ? await usdtCard() : ""}
      ${await twoFactorCard()}
      <section class="card"><h2>Cambiar mi contraseña</h2><form class="form" id="pwForm"><label>Contraseña actual<input name="current" type="password" required autocomplete="current-password"></label><label>Nueva contraseña (mín. 10)<input name="next" type="password" minlength="10" required autocomplete="new-password"></label><button class="pbtn dark" type="submit">Cambiar</button></form></section>`;
  },
};


/* ---------------- Auditoría en frases que se entienden ---------------- */
const AUD_ROLE = { owner: "dueño", admin: "admin", seller: "vendedor", customer: "cliente", reseller: "revendedor", system: "automático" };
const AUD_METHOD = { cash: "en efectivo", qr: "por QR", balance: "con saldo", binance: "por Binance Pay", usdt: "en USDT", local: "con un método del país" };
const AUD_KIND = { sale: "venta", renewal: "renovación", topup: "recarga" };
// {x} = sobre qué (pedido #70, el cliente María…). Si no hay {x}, la acción no necesita objeto.
const AUD_VERB = {
  "account.add": "cargó {x}", "account.retire": "retiró {x}", "account.update": "editó {x}",
  "alerts.settings": "cambió los avisos para el dueño", "alerts.supplier_expiry": "recibió el aviso de vencimiento con el proveedor de {x}",
  "assignment.control": "actualizó el control de {x}", "assignment.deliver": "abrió los datos de entrega de {x}", "assignment.expire": "cerró por vencido {x}",
  "assignment.refund": "devolvió el dinero de {x}", "assignment.release": "liberó {x}", "assignment.replace": "reemplazó el perfil de {x}",
  "assignment.set_expiry": "cambió la fecha de {x}", "assignment.transfer": "pasó a otro cliente {x}",
  "backup.create": "hizo un respaldo", "backup.download": "descargó un respaldo", "backup.offsite_config": "configuró la copia en Gmail",
  "binance.config": "configuró Binance Pay", "coupon.create": "creó el cupón {x}", "coupon.update": "editó el cupón {x}", "coupon.delete": "borró el cupón {x}", "push.subscribe": "activó los avisos en un celular", "reseller.coupons_allowed": "cambió el permiso de cupones para revendedores", "account.renew_paid": "anotó el pago de la renovación de {x}", "settings.min_margin": "cambió el margen mínimo", "ai.config": "cambió la configuración de los agentes", "ai.selftest": "corrió la prueba de la oficina virtual", "account.alert": "recibió un aviso de riesgo de {x}", "account.alert_seen": "marcó como visto un aviso de {x}", "order.evidence_duplicate": "subió un comprobante repetido en {x}", "reseller.coupon_create": "creó un cupón para su página", "reseller.coupon_update": "editó un cupón de su página", "reseller.coupon_delete": "borró un cupón de su página", "push.config": "cambió los avisos al celular", "paymethod.create": "agregó un método de cobro", "paymethod.update": "editó un método de cobro", "paymethod.delete": "borró un método de cobro", "paymethod.qr": "cambió el QR de un método de cobro", "credentials.view": "vio sus datos de acceso",
  "customer.bulk_kind": "cambió el tipo de varios clientes", "customer.create": "creó {x}", "customer.login_link": "generó el link de acceso de {x}",
  "customer.login_pin": "le dio un PIN de acceso {x}",
  "ledger.purchase": "usó saldo {x} en una compra", "ledger.renewal": "usó saldo {x} en una renovación", "ledger.adjustment": "ajustó el saldo {x}", "ledger.topup": "acreditó una recarga en el saldo {x}",
  "ledger.refund": "devolvió plata al saldo {x}", "ledger.referral": "acreditó el premio por referido en el saldo {x}", "ledger.shop_rent": "cobró el alquiler de la página del saldo {x}",
  "reseller.page_enable": "le habilitó la página premium {x}", "reseller.page_disable": "le quitó la página {x}", "reseller.control": "editó el control de {x}",
  "supplier.delete": "borró el proveedor {x}", "ticket.create": "reportó una falla en {x}", "ticket.status": "cambió el estado de una falla en {x}", "wallet.adjust": "ajustó el saldo {x}", "customer.login_pin_self": "cambió su PIN", "customer.register_email": "se registró con su correo",
  "customer.self_register": "se registró", "customer.set_email": "cambió el correo de {x}", "customer.update": "editó {x}",
  "expense.add": "anotó un gasto", "expense.remove": "borró un gasto", "export": "exportó un Excel", "faq.update": "editó las preguntas frecuentes",
  "import.customers": "importó clientes desde Excel", "mailbox.remove": "desconectó un correo",
  "order.binance": "abrió el pago con Binance de {x}", "order.cancel": "canceló {x}", "order.create": "creó {x}", "order.evidence": "subió el comprobante de {x}",
  "order.expire": "dejó vencer la reserva de {x}", "order.fulfill": "entregó {x}",
  "outbox.flush": "mandó los avisos de WhatsApp pendientes", "outbox.sent_manually": "marcó un aviso como enviado a mano",
  "payment.approve": "aprobó el pago de {x}", "payment.reject": "rechazó el pago de {x}", "price_group.upsert": "guardó la lista de precios {x}",
  "product.image": "cambió el logo de {x}", "product.upsert": "guardó el producto {x}",
  "reminders.auto": "programó recordatorios automáticos", "reminders.queue": "puso en cola recordatorios de vencimiento", "reminders.settings": "cambió los recordatorios",
  "renewal.create": "pidió una renovación ({x})", "reseller.apply": "mandó una solicitud para ser revendedor", "reseller.approve": "aprobó la solicitud de revendedor {x}",
  "reseller.client_update": "editó a su cliente {x}", "reseller.prices": "cambió sus precios", "reseller.referral_paid": "cobró el premio por referido",
  "reseller.reject": "rechazó la solicitud de revendedor {x}", "reseller.shop_rent_free": "quedó sin alquiler de página", "reseller.shop_suspend": "pausó la página de {x}",
  "reseller.shop_update": "editó la página de {x}", "secrets.view": "vio las contraseñas de las cuentas", "settings.update": "cambió la configuración de la tienda",
  "slot.add": "agregó {x}", "slot.freed": "liberó {x}", "slot.status": "cambió el estado de {x}", "slot.update": "editó {x}",
  "staff.2fa_off": "desactivó la verificación en dos pasos", "staff.2fa_on": "activó la verificación en dos pasos", "staff.create": "creó al usuario del panel {x}",
  "staff.password": "cambió la contraseña de {x}", "assistant.key": "creó la llave del asistente", "assistant.off": "apagó el acceso del asistente", "fiado.charge": "anotó un fiado", "fiado.payment": "anotó un pago del fiado", "fiado.remove": "borró un movimiento del fiado", "fiado.from_control": "pasó alquileres sin pagar al fiado", "supplier.upsert": "guardó el proveedor {x}", "telegram.config": "configuró los avisos de Telegram",
  "testimonials.update": "editó las opiniones", "topup.request": "pidió una recarga de saldo", "trial.create": "dio una prueba gratis ({x})",
  "whatsapp.secrets": "cambió las claves de WhatsApp", "whatsapp.settings": "cambió la configuración del bot",
};
const audNum = (id) => { const m = String(id ?? "").match(/(\d+)$/); return m ? "#" + Number(m[1]) : ""; };
function auditText(a, maps) {
  // Quién
  let who = "Alguien", role = AUD_ROLE[a.role] ?? a.role ?? "";
  const aid = String(a.actorId ?? "");
  if (aid.startsWith("system")) { who = "El sistema"; role = "automático"; }
  else if (maps.staff[aid]) who = maps.staff[aid].name;
  else { const cid = aid.split(":")[1]; const c = cid && maps.cust[cid]; if (c) { who = c.name; if (aid.startsWith("wa:")) role = (role ? role + ", " : "") + "por WhatsApp"; } else if (aid) who = role ? role[0].toUpperCase() + role.slice(1) : aid; }
  if (who.toLowerCase() === role) role = "";
  // Sobre qué
  const id = a.entityId;
  const many = id === "*" || String(id).includes(",");
  const obj = many ? "varios" : ({
    order: () => `el pedido ${audNum(id)}`, assignment: () => `el alquiler ${audNum(id)}`, account: () => `la cuenta ${audNum(id)}`, slot: () => `el perfil ${audNum(id)}`,
    customer: () => a.action.startsWith("ledger.") ? `de ${maps.cust[id]?.name ?? audNum(id)}` : maps.cust[id] ? `al cliente ${maps.cust[id].name}` : `al cliente ${audNum(id)}`, product: () => maps.prod[id] ? `"${maps.prod[id].name}"` : `"${id}"`,
    coupon: () => (a.data?.code ? `"${a.data.code}"` : ""),
    staff: () => maps.staff[id]?.name ?? `un usuario`, supplier: () => `"${id}"`, price_group: () => `"${id}"`, reseller_app: () => `${audNum(id)}`,
  }[a.entity] ?? (() => ""))();
  const verb = AUD_VERB[a.action] ?? a.action.replace(/[._]/g, " ");
  const what = verb.includes("{x}") ? verb.replace("{x}", obj).replace(/\s+\)/, ")").replace(/\(\)/, "").trim() : verb;
  // Detalle útil (lo técnico queda plegado)
  const d = a.data ?? {}, parts = [];
  if (d.kind && AUD_KIND[d.kind]) parts.push(AUD_KIND[d.kind]);
  if (Number.isFinite(d.total)) parts.push(bs(d.total) + (d.via ? ` por ${d.via}` : AUD_METHOD[d.method] ? " " + AUD_METHOD[d.method] : ""));
  else if (AUD_METHOD[d.method]) parts.push(AUD_METHOD[d.method]);
  if (Number.isFinite(d.amount)) parts.push(bs(d.amount));
  if (Number.isFinite(d.price)) parts.push(bs(d.price));
  if (d.confirmedReference) parts.push(`ref. ${d.confirmedReference}`);
  if (d.reason) parts.push(`motivo: "${d.reason}"`);
  if (Number.isFinite(d.hours)) parts.push(`${d.hours} h`);
  if (Number.isFinite(d.usdt)) parts.push(`${d.usdt} USDT`);
  if (Number.isFinite(d.count)) parts.push(`${d.count}`);
  if (Number.isFinite(d.slots) && d.slots) parts.push(`${d.slots} perfil(es)`);
  if (d.coupon) parts.push(`cupón ${d.coupon}${Number.isFinite(d.couponAmount) ? ` (−${bs(d.couponAmount)})` : ""}`);
  return { who, role, what, detail: parts.join(" · ") };
}

/* ---------------- Verificación en dos pasos ---------------- */
async function twoFactorCard() {
  const st = await api("GET", "/api/admin/me/2fa").catch(() => ({ enabled: false }));
  const setup = P.tab.tfa;
  return `<section class="card"><h2>🔐 Verificación en dos pasos ${st.enabled ? pill("Activada", "ok") : pill("Apagada", "mute")}</h2>
    <p class="muted" style="margin:0">Además de tu contraseña, al entrar al panel te pide un código de 6 dígitos que cambia cada 30 segundos en tu celular. Aunque alguien sepa tu contraseña, sin tu celular no entra.</p>
    ${st.enabled ? `<form class="inline" id="tfaOff"><input name="password" type="password" placeholder="Tu contraseña" required autocomplete="current-password"><input name="code" inputmode="numeric" maxlength="6" placeholder="Código" required><button class="pbtn" type="submit">Desactivar</button></form>`
      : setup ? `<ol style="margin:0;padding-left:20px;display:grid;gap:6px">
          <li>Instalá <b>Google Authenticator</b> (o Microsoft Authenticator) en tu celular.</li>
          <li>En la app tocá <b>+</b> → <b>Ingresar clave de configuración</b>. Nombre: <b>${esc(P.settings.platformName || "GaboHub")}</b>. Clave:<br><code class="tfa-key">${esc(setup.secret.match(/.{1,4}/g).join(" "))}</code> <button class="pbtn sm" type="button" data-copy="${esc(setup.secret)}">${icon("copy")}Copiar</button>
            <br><small class="muted">Si estás en el celular: <a href="${esc(setup.uri)}">abrir directo en la app</a>.</small></li>
          <li>Escribí el código de 6 dígitos que te muestra la app:</li></ol>
        <form class="inline" id="tfaOn"><input name="code" inputmode="numeric" maxlength="6" placeholder="123456" required autocomplete="one-time-code"><button class="pbtn dark" type="submit">Confirmar y activar</button></form>
        <p class="muted" style="margin:0">Guardá la clave en un lugar seguro. Si perdés el celular, se puede desactivar poniendo la variable <code>GS_RESET_2FA=${esc(P.me.username)}</code> en Railway.</p>`
      : `<button class="pbtn dark" type="button" data-tfa="setup" style="justify-self:start">Activar</button>`}</section>`;
}

/* ---------------- Avisos para el dueño y respaldos ---------------- */
async function ownerCards() {
  const [al, bk, off] = await Promise.all([api("GET", "/api/admin/alerts"), api("GET", "/api/admin/backups"), api("GET", "/api/admin/offsite")]);
  const offOwn = P.tab.offOwn ?? (!off.mailboxId && (!!off.address || !off.mailboxes.length));
  const perm = "Notification" in window ? Notification.permission : "unsupported";
  const mb = (n) => (n / 1048576 < 0.1 ? `${Math.max(1, Math.round(n / 1024))} KB` : `${(n / 1048576).toFixed(1)} MB`);
  return `<section class="card"><h2>${icon("bell")}Avisos para vos</h2>
      <p class="muted" style="margin:0">Mientras el panel esté abierto, suena y aparece un aviso cuando llega un pago nuevo. Además, si cargás tu WhatsApp, te llega un mensaje (sale por el bot si está conectado; si no, queda en <b>WhatsApp → Avisos</b>).</p>
      <form class="form" id="alertForm">
        <label>Tu WhatsApp (con código de país)<input name="phone" inputmode="tel" placeholder="+591 70000000" value="${esc(al.phone)}"></label>
        <label>Avisarme de cuentas que vencen con el proveedor<select name="supplierDaysBefore">${[0, 1, 2, 3, 5, 7].map((d) => opt(d, d ? `${d} día(s) antes` : "El mismo día", d === al.supplierDaysBefore)).join("")}</select></label>
        <label class="chk"><input type="checkbox" name="payments" ${al.payments ? "checked" : ""}> Pago o recarga nueva para revisar</label>
        <label class="chk"><input type="checkbox" name="supplierExpiry" ${al.supplierExpiry ? "checked" : ""}> Cuentas por vencer con el proveedor</label>
        <button class="pbtn dark" type="submit">Guardar</button></form>
      <div class="inline">${perm === "granted" ? pill("Notificaciones del navegador activadas", "ok") : perm === "unsupported" ? `<span class="muted">Este navegador no muestra notificaciones.</span>` : `<button class="pbtn" type="button" id="notifOn">${icon("bell")}Activar notificaciones en este navegador</button>`}</div></section>
    <section class="card"><h2>Respaldos</h2>
      <p class="muted" style="margin:0">Se hace uno solo <b>cada día</b> y se guardan los últimos ${bk.keep}. Descargá uno de vez en cuando y guardalo fuera del servidor (Drive, pendrive).</p>
      <p class="perr" style="margin:0">El respaldo tiene <b>todo</b>, incluidas las contraseñas de las cuentas y las claves de Meta. No lo compartas.</p>
      ${bk.items.length ? `<table class="tbl"><thead><tr><th>Respaldo</th><th>Fecha</th><th>Tamaño</th><th></th></tr></thead><tbody>${bk.items.slice(0, 10).map((b) => `<tr><td>${esc(b.name)}</td><td>${fdt(b.createdAt)}</td><td>${mb(b.bytes)}</td><td><a class="pbtn sm" href="/api/admin/backups/${encodeURIComponent(b.name)}" download>Descargar</a></td></tr>`).join("")}</tbody></table>` : `<div class="emptybox">Todavía no hay respaldos. El primero se hace solo en un minuto, o tocá el botón.</div>`}
      <div class="inline"><button class="pbtn dark" type="button" id="backupNow">Hacer respaldo ahora</button></div>
      <div class="offsite"><h3>☁️ Copia automática en tu Gmail ${off.enabled ? (off.lastError ? pill("Error", "bad") : off.lastAt ? pill("Activa", "ok") : pill("Activa · primera copia en camino", "warn")) : pill("Apagada", "mute")}</h3>
        <p class="muted" style="margin:0">Cada día se guarda una copia comprimida como correo en la carpeta <b>“${esc(off.folder)}”</b> de tu Gmail. Así, aunque pase algo con Railway, tus datos quedan en Google.</p>
        ${off.lastAt ? `<p class="muted" style="margin:0">Última copia: <b>${fdt(off.lastAt)}</b>${off.lastBytes ? ` · ${mb(off.lastBytes)}` : ""}${off.lastError ? ` · <span style="color:var(--bad)">${esc(off.lastError)}</span>` : off.withUploads === false ? " · solo la base (los comprobantes pesan mucho)" : ""}</p>` : ""}
        <form class="form" id="offForm">
          ${off.mailboxes.length ? `<label style="grid-column:1/-1">¿En qué Gmail se guarda?<select name="mode">${off.mailboxes.map((m) => opt(m.id, `${m.address} (el del Panel de códigos)`, !offOwn && off.mailboxId === m.id)).join("")}${opt("own", "Otro Gmail…", offOwn)}</select></label>` : `<input type="hidden" name="mode" value="own">`}
          ${offOwn ? `<label>Gmail<input name="address" type="email" placeholder="tu.respaldo@gmail.com" value="${esc(off.address ?? "")}"></label><label>Contraseña de aplicación<input name="password" type="password" autocomplete="new-password" placeholder="${off.hasPassword && off.address ? "Guardada · dejala vacía" : "16 letras"}"></label>
          <p class="muted" style="grid-column:1/-1;margin:0">Es la misma clase de contraseña que el Panel de códigos: myaccount.google.com/apppasswords (con verificación en 2 pasos activada).</p>` : ""}
          <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="enabled" ${off.enabled ? "checked" : ""}> Guardar una copia cada día en ese Gmail</label>
          <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">Guardar</button>${off.enabled ? `<button class="pbtn" type="button" id="offNow">Guardar una copia ahora</button>` : ""}</div>
        </form></div>
      <p class="muted" style="margin:0">Para volver a un respaldo: apagá la tienda y reemplazá <code>gabriel.db</code> y la carpeta <code>uploads</code> en la carpeta de datos (el .zip trae un LEEME con los pasos).</p></section>`;
}

/* ---------------- Avisos del dueño por Telegram ---------------- */
const TG_LABELS = {
  payment: "Pagos por revisar", reseller: "Solicitudes de revendedor", reloc: "Clientes en cuentas caídas (reubicar)",
  supplier: "Cuentas que vencen con el proveedor", supplier1d: "Cuentas que vencen mañana con el proveedor", lowstock: "Stock bajo",
  overdue: "Servicios vencidos sin renovar", due: "Servicios que vencen en 3 días",
};
async function telegramCard() {
  const t = await api("GET", "/api/admin/telegram").catch(() => null);
  if (!t) return "";
  const on = t.enabled && t.hasToken && t.chatId;
  const sel = new Set(t.alerts || []);
  return `<section class="card"><h2>${icon("bell")}Avisos por Telegram ${on ? pill("Activo", "ok") : t.hasToken ? pill("Configurado · apagado", "warn") : pill("Sin configurar", "mute")}</h2>
    <p class="muted" style="margin:0">Recibí en tu celular un mensaje de Telegram cuando algo necesita tu atención (un pago por revisar, un cliente en una cuenta caída, etc.), aunque no tengas el panel abierto. Es gratis y no depende de Meta.</p>
    <details class="tg-help"><summary>¿Cómo lo conecto? (una sola vez)</summary>
      <ol style="margin:8px 0 0;padding-left:20px;display:grid;gap:6px">
        <li>En Telegram, buscá <b>@BotFather</b> y mandale <code>/newbot</code>. Elegí un nombre. Te da un <b>token</b> (algo como <code>123456:AA...</code>). Pegalo abajo.</li>
        <li>Abrí tu bot nuevo (el enlace que te da BotFather) y tocá <b>Iniciar / Start</b>.</li>
        <li>Para saber tu <b>chat ID</b>: buscá <b>@userinfobot</b> en Telegram, tocá Start y te dice tu número. Pegalo abajo.</li>
        <li>Guardá, tocá <b>Enviar prueba</b> y listo.</li>
      </ol></details>
    <form class="form" id="tgForm">
      <label>Token del bot (de @BotFather)<input name="token" autocomplete="off" placeholder="${t.hasToken ? "Guardado · dejalo vacío para no cambiarlo" : "123456:AA..."}"></label>
      <label>Tu chat ID (de @userinfobot)<input name="chatId" inputmode="numeric" placeholder="123456789" value="${esc(t.chatId || "")}"></label>
      <fieldset style="grid-column:1/-1;border:1px solid var(--line);border-radius:10px;padding:10px;display:grid;gap:6px;margin:0">
        <legend style="padding:0 6px;font-weight:600">¿De qué querés que te avise?</legend>
        ${(t.alertTypes || []).map((k) => `<label class="chk"><input type="checkbox" name="al_${k}" ${sel.has(k) ? "checked" : ""}> ${esc(TG_LABELS[k] || k)}</label>`).join("")}
      </fieldset>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="enabled" ${t.enabled ? "checked" : ""}> Mandarme estos avisos por Telegram</label>
      ${t.lastError ? `<p class="perr" style="grid-column:1/-1;margin:0">Último intento falló: ${esc(t.lastError)}</p>` : ""}
      <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">Guardar</button><button class="pbtn" type="button" id="tgTest">Enviar prueba</button></div>
    </form></section>`;
}

/* ---------------- Avisos al celular (Web Push) ---------------- */
const PUSH_LABELS = { payment: "💳 Pagos por revisar", lowstock: "📦 Stock bajo", supplier1d: "⚠️ Cuentas que vencen mañana con el proveedor", reseller: "👤 Solicitudes de revendedor", reloc: "🔀 Clientes en cuentas caídas", falla: "🛠️ Fallas reportadas (siempre)" };
const pushSupported = () => "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const isIOS = () => /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
async function pushCard() {
  const p = await api("GET", "/api/admin/push").catch(() => null);
  if (!p) return "";
  const sel = new Set(p.alerts || []);
  const cfg = canReview() ? `<form class="form" id="pushForm">
      <fieldset style="grid-column:1/-1;border:1px solid var(--line);border-radius:10px;padding:10px;display:grid;gap:6px;margin:0">
        <legend style="padding:0 6px;font-weight:600">¿De qué te avisamos?</legend>
        ${Object.entries(PUSH_LABELS).map(([k, t]) => `<label class="chk"><input type="checkbox" name="pa_${k}" ${sel.has(k) ? "checked" : ""}> ${t}</label>`).join("")}
      </fieldset>
      <label>Stock bajo: avisar cuando queden menos de<input name="lowStockAt" type="number" min="0" max="50" step="1" inputmode="numeric" value="${p.lowStockAt}"></label>
      <p class="muted" style="margin:0;align-self:end">perfiles libres de un producto (0 = no avisar).</p>
      <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">Guardar</button></div>
    </form>` : "";
  if (!p.configured) return `<section class="card"><h2>${icon("bell")}Avisos al celular ${pill("Falta configurar el servidor", "mute")}</h2>
    <p class="muted" style="margin:0">Notificaciones en el celular (como las de WhatsApp) cuando entra un pago, se acaba el stock o una cuenta vence mañana. Para prenderlas, quien maneja el servidor tiene que cargar las claves una sola vez:</p>
    ${p.error ? `<p class="perr" style="margin:0">Las claves cargadas no sirven: ${esc(p.error)}</p>` : ""}
    <details class="tg-help"><summary>¿Cómo se configura? (una sola vez)</summary>
      <ol style="margin:8px 0 0;padding-left:20px;display:grid;gap:6px">
        <li>En la carpeta del proyecto, corré <code>npm run vapid</code>. Te da tres líneas.</li>
        <li>Cargalas como variables de entorno del servidor: <code>VAPID_PUBLIC_KEY</code>, <code>VAPID_PRIVATE_KEY</code> (es secreta) y <code>VAPID_SUBJECT</code> (tu correo, con <code>mailto:</code> adelante).</li>
        <li>Reiniciá el servidor y volvé a esta pantalla para activar los avisos en tu celular.</li>
      </ol></details>${cfg}</section>`;
  return `<section class="card"><h2>${icon("bell")}Avisos al celular ${p.mine ? pill(`Activo en ${p.mine} equipo(s)`, "ok") : pill("Apagado en tus equipos", "warn")}</h2>
    <p class="muted" style="margin:0">Te llega una notificación aunque tengas el panel cerrado. El aviso no lleva datos de tus clientes: el celular abre el panel con tu sesión para ver el detalle.</p>
    <div id="pushHere" class="inline" style="flex-wrap:wrap"><span class="muted">Revisando este celular…</span></div>
    ${p.lastError ? `<p class="perr" style="margin:0">Último envío falló: ${esc(p.lastError)}</p>` : ""}${cfg}</section>`;
}
/** Después de dibujar Configuración: muestra el estado de ESTE celular y el botón que corresponde. */
async function pushStatus() {
  const box = $("#pushHere"); if (!box) return;
  if (!pushSupported()) {
    box.innerHTML = isIOS() && !navigator.standalone
      ? `<p class="muted" style="margin:0">En iPhone: primero tocá <b>Compartir → Agregar a inicio</b>, abrí el panel desde ese ícono y volvé acá.</p>`
      : `<p class="muted" style="margin:0">Este navegador no permite avisos. Probá con Chrome en Android o con el panel instalado en el iPhone.</p>`;
    return;
  }
  if (Notification.permission === "denied") { box.innerHTML = `<p class="perr" style="margin:0">Bloqueaste las notificaciones de este sitio. Activalas en los ajustes del navegador (ícono del candado → Notificaciones) y volvé a intentar.</p>`; return; }
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg && await reg.pushManager.getSubscription().catch(() => null);
  box.innerHTML = sub
    ? `<span class="pp pp-ok">✓ Activo en este celular</span><button class="pbtn" type="button" id="pushTest">Probar aviso</button><button class="pbtn" type="button" id="pushOff">Apagar en este celular</button>`
    : `<button class="pbtn dark" type="button" id="pushOn">🔔 Activar avisos en este celular</button>`;
}
const b64uBytes = (s) => { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
async function pushEnable() {
  const p = await api("GET", "/api/admin/push");
  if (!p.configured) return toast("Falta configurar el servidor");
  if (await Notification.requestPermission() !== "granted") { toast("Sin permiso no te podemos avisar"); return pushStatus(); }
  const reg = await navigator.serviceWorker.register("/sw.js", { scope: "/" });
  await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(p.publicKey) });
  const label = /Android/.test(navigator.userAgent) ? "Android" : isIOS() ? "iPhone" : "Computadora";
  await api("POST", "/api/admin/push/subscribe", { subscription: sub.toJSON(), label });
}
async function pushDisable() {
  const reg = await navigator.serviceWorker.getRegistration("/");
  const sub = reg && await reg.pushManager.getSubscription();
  if (sub) { await api("POST", "/api/admin/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe().catch(() => {}); }
}

/* ---------------- Cobros con Binance Pay (USDT) ---------------- */
async function binanceCard() {
  const b = await api("GET", "/api/admin/binance").catch(() => null);
  if (!b) return "";
  return `<section class="card"><h2>${icon("coins")}Cobrar en USDT (Binance Pay) ${b.ready ? pill("Activo", "ok") : b.hasKeys ? pill("Configurado · apagado", "warn") : pill("Sin configurar", "mute")}</h2>
    <p class="muted" style="margin:0">Aceptá pagos en <b>USDT</b> por Binance Pay. El cliente paga en su app de Binance y el pedido se activa <b>solo</b>, sin que revises nada. Vos ponés la tasa Bs→USDT.</p>
    ${!b.https ? `<div class="pok">Para que Binance te avise de los pagos necesitás la tienda publicada con HTTPS (Railway) y arrancar con <code>GS_PUBLIC_ORIGIN</code>.</div>` : ""}
    <details class="tg-help"><summary>¿Cómo lo conecto? (una sola vez)</summary>
      <ol style="margin:8px 0 0;padding-left:20px;display:grid;gap:6px">
        <li>Necesitás una cuenta de <b>comerciante</b> de Binance Pay (empresa verificada): pedila en <a href="https://merchant.binance.com" target="_blank" rel="noopener">merchant.binance.com</a>.</li>
        <li>En el panel de comerciante → <b>Developers / API</b>, creá una <b>API Key</b> y su <b>API Secret</b>. Pegalas abajo.</li>
        <li>Cargá el <b>Webhook URL</b> de abajo en la configuración de pagos de Binance (para que te avise cuando el cliente paga).</li>
        <li>Poné tu <b>tasa</b> (cuántos Bs vale 1 USDT), activá y tocá <b>Probar conexión</b>.</li>
      </ol></details>
    ${b.webhookUrl ? `<label>Webhook URL <small class="muted">(copialo en Binance)</small><div class="inline"><input value="${esc(b.webhookUrl)}" readonly style="flex:1"><button class="pbtn sm" type="button" data-copy="${esc(b.webhookUrl)}">${icon("copy")}Copiar</button></div></label>` : ""}
    <form class="form" id="binForm">
      <label>API Key<input name="apiKey" autocomplete="off" placeholder="${b.hasKeys ? "Guardada · dejala vacía para no cambiarla" : "Tu API Key de Binance Pay"}"></label>
      <label>API Secret<input name="apiSecret" type="password" autocomplete="off" placeholder="${b.hasKeys ? "Guardada · dejala vacía" : "Tu API Secret"}"></label>
      <label>Tasa: ¿cuántos Bs vale 1 USDT?<input name="rate" inputmode="decimal" placeholder="Ej.: 13" value="${b.rate || ""}"></label>
      <label>Tu Binance Pay ID <small class="muted">(opcional, informativo)</small><input name="payId" inputmode="numeric" placeholder="Ej.: 123456789" value="${esc(b.payId || "")}"></label>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="enabled" ${b.enabled ? "checked" : ""}> Aceptar pagos con Binance en la tienda</label>
      ${b.lastError ? `<p class="perr" style="grid-column:1/-1;margin:0">Último intento con Binance falló: ${esc(b.lastError)}</p>` : ""}
      <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">Guardar</button><button class="pbtn" type="button" id="binTest">Probar conexión</button></div>
    </form></section>`;
}

/* ---------------- Cobros con USDT manual (plan B sin API) ---------------- */
/* ---------------- Oficina virtual: agentes con Claude ---------------- */
function aiCheckBox(c) {
  const V = { parece_ok: ["✅ Parece correcto", "ok"], revisar: ["👀 Revisalo bien", "warn"], no_coincide: ["⛔ No coincide", "bad"] };
  const yn = (v) => (v === true ? "✅" : v === false ? "❌" : "—");
  return `<div class="aibox aibox-${V[c.verdict][1]}"><b>🤖 ${V[c.verdict][0]}</b>
    <small>Monto: ${c.amount ?? "?"} ${esc(c.currency ?? "")} ${yn(c.amountMatches)} · Operación: ${esc(c.reference ?? "?")} ${yn(c.referenceMatches)}${c.looksEdited ? " · ⚠️ podría estar editado" : ""}</small>
    ${c.notes ? `<small class="muted">${esc(c.notes)}</small>` : ""}<small class="muted">Sugerencia: igual mirá tu banco antes de aprobar.</small></div>`;
}
const AI_AGENTS = [
  ["whatsapp", "💬 Atención por WhatsApp", "El único que habla con tus clientes. Responde lo que el bot de palabras clave no entiende: precios, cómo pagar, \"no me deja entrar\", \"me pide un código\", renovaciones. Los códigos, links y el QR los manda el sistema, nunca la IA. Si la cuenta tiene problemas o el cliente reclama, te lo pasa a vos. Necesita el bot de WhatsApp prendido."],
  ["receipts", "🧾 Revisor de comprobantes", "Lee cada comprobante que suben y te dice si el monto y el número coinciden con el pedido. Nunca aprueba: aprobás vos. (Los comprobantes repetidos se detectan siempre, sin IA.)"],
  ["daily", "🧠 Asistente del dueño", "Cada mañana (8 h) te manda el reporte del día, y en Inicio le podés preguntar lo que quieras de tu negocio: \"¿quién vence esta semana?\", \"¿cuánto vendí de Disney?\". Solo lee: nunca cambia nada."],
  ["watch", "🚨 Vigilante de cuentas (IA)", "Las reglas ya avisan siempre (sin IA) cuando una plataforma manda \"cambió la contraseña\", \"pago rechazado\" o \"cuenta cancelada\". Esto suma la IA para los correos raros que las reglas no reconocen (máximo 30 por día)."],
];
async function aiCard() {
  const a = await api("GET", "/api/admin/ai").catch(() => null);
  if (!a) return "";
  const est = (m) => { const x = a.models.find((y) => y.id === m); return x ? `US$ ${x.input} / ${x.output} por millón de tokens` : ""; };
  const anyOn = AI_AGENTS.some(([k]) => a.enabled[k]);
  return `<section class="card"><h2>🤖 Oficina virtual <small>agentes con Claude</small> ${!a.hasKey ? pill("Falta la clave", "mute") : anyOn ? pill("Trabajando", "ok") : pill("Apagados", "warn")}</h2>
    <p class="muted" style="margin:0">Cada agente hace una sola tarea. Ninguno aprueba pagos, entrega cuentas ni toca plata: eso lo hacés vos.</p>
    ${a.hasKey && a.lastError ? `<p class="perr" style="margin:0">Último error: ${esc(a.lastError)}</p>` : ""}
    ${!a.hasKey ? `<details class="tg-help" open><summary>¿Cómo se prende? (una sola vez)</summary><ol style="margin:8px 0 0;padding-left:20px;display:grid;gap:6px">
      <li>Entrá a <b>console.anthropic.com</b>, creá una cuenta y cargá crédito (se paga aparte de tu suscripción de Claude).</li>
      <li>En <b>API Keys</b> creá una clave. Es secreta: no la mandes por chat.</li>
      <li>En Railway, en las variables de tu tienda, agregá <code>ANTHROPIC_API_KEY</code> con esa clave y reiniciá.</li>
      <li>Volvé acá y prendé los agentes que quieras.</li></ol></details>` : ""}
    <form class="form" id="aiForm">
      ${AI_AGENTS.map(([k, t, d]) => `<label class="chk aiag" style="grid-column:1/-1"><input type="checkbox" name="ag_${k}" ${a.enabled[k] ? "checked" : ""} ${a.hasKey ? "" : "disabled"}><span><b>${t}</b><br><small class="muted">${d}</small></span></label>`).join("")}
      <label>Modelo<select name="model" ${a.hasKey ? "" : "disabled"}>${a.models.map((m) => opt(m.id, m.label, m.id === a.model)).join("")}</select><small class="muted" id="aiPrice">${esc(est(a.model))}</small></label>
      <label>Tope de gasto por mes (US$)<input name="limit" type="number" min="0" max="1000" step="1" inputmode="numeric" value="${a.monthlyLimitUsd}" ${a.hasKey ? "" : "disabled"}><small class="muted">Al llegar, los agentes se pausan hasta el mes que viene.</small></label>
      <p class="muted" style="grid-column:1/-1;margin:0">Este mes: <b>US$ ${(a.spentUsd ?? 0).toFixed(2)}</b> en ${a.calls ?? 0} consulta(s).
        Para empezar barato elegí <b>Haiku 5.5</b>: con ~500 mensajes por día suele quedar en pocos dólares por mes. Opus es el más capaz y el más caro.</p>
      <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit" ${a.hasKey ? "" : "disabled"}>Guardar</button>${a.hasKey && a.enabled.daily ? `<button class="pbtn" type="button" id="aiDailyNow">📋 Armar el reporte ahora</button>` : ""}</div>
    </form>
    ${a.hasKey ? await selfTestBox(a) : ""}</section>`;
}

/* Probar la oficina: banco de pruebas con Claude real, antes de prender los agentes. */
async function selfTestBox(a) {
  const st = await api("GET", "/api/admin/ai/selftest").catch(() => null);
  const mname = (id) => a.models.find((m) => m.id === id)?.label ?? id;
  let res = "";
  if (st?.status === "running") res = `<p class="pok" style="margin:0">⏳ Probando con ${esc(mname(st.model))}… tarda 1 o 2 minutos. <button class="pbtn sm" type="button" data-go="configuracion">Actualizar</button></p>`;
  else if (st?.status === "error") res = `<p class="perr" style="margin:0">La prueba falló: ${esc(st.error ?? "")}</p>`;
  else if (st?.status === "done" && st.result) {
    const r = st.result, row = (k, t) => `<div class="stk"><b>${r.resumen[k].pasan}/${r.resumen[k].total}</b><small>${t}</small></div>`;
    const bad = [...r.whatsapp, ...r.correos].filter((x) => x.fallas.length);
    // Si todo falló por el mismo error (clave mala, sin saldo…), se muestra una sola vez y claro.
    const errs = [...new Set(bad.flatMap((x) => x.fallas).filter((f) => /^error/.test(f)).map((f) => f.replace(/^error( IA)?: /, "")))];
    if (errs.length === 1 && bad.every((x) => x.fallas.some((f) => /^error/.test(f)))) {
      return `<div class="selftest"><h3 style="margin:14px 0 4px;font-size:15px">🧪 Probar la oficina</h3>
        <p class="perr" style="margin:0">La prueba no pudo hablar con Claude: ${esc(errs[0])}</p>
        <form class="inline" id="selfTestForm" style="flex-wrap:wrap"><label>Modelo<select name="model">${a.models.map((m) => opt(m.id, m.label, m.id === st.model)).join("")}</select></label>
        <button class="pbtn dark" type="submit">🧪 Correr la prueba de nuevo</button></form></div>`;
    }
    res = `<p style="margin:0">Última prueba: <b>${esc(mname(st.model))}</b> · ${fdt(st.endedAt)} · costó ~US$ ${(r.gastoUsd ?? 0).toFixed(3)}</p>
      <div class="stkpis">${row("whatsapp", "mensajes de WhatsApp bien")}${row("correos", "correos bien")}</div>
      ${bad.length ? `<details class="tg-help"><summary>Ver los ${bad.length} caso(s) con fallas</summary><div class="stlist">${bad.map((x) => `<div class="strow"><b>${esc(x.texto)}</b><small class="perr">${esc(x.fallas.join(" · "))}</small>${x.resultado ? `<small class="muted">Respondió: ${esc(x.resultado)}</small>` : ""}</div>`).join("")}</div></details>` : `<p class="pok" style="margin:0">✅ Pasó todo.</p>`}`;
  }
  return `<div class="selftest"><h3 style="margin:14px 0 4px;font-size:15px">🧪 Probar la oficina</h3>
    <p class="muted" style="margin:0 0 8px">Antes de prenderlos para tus clientes: le manda a Claude 40 mensajes de WhatsApp de prueba (precios, accesos, clientes enojados, intentos de engaño) y 12 correos de plataformas, y te muestra qué contestó y qué falló. Gasta centavos de tus créditos (tope 2 dólares). No le escribe a ningún cliente.</p>
    <form class="inline" id="selfTestForm" style="flex-wrap:wrap"><label>Modelo<select name="model">${a.models.map((m) => opt(m.id, m.label, m.id === "claude-haiku-5-5")).join("")}</select></label>
      <button class="pbtn dark" type="submit" ${st?.status === "running" ? "disabled" : ""}>🧪 Correr la prueba</button></form>
    ${res}</div>`;
}

/* ---------------- Ganancia por producto ---------------- */
/** "⚡ Precio revendedor para todos": se muestra arriba en Revendedores y en Productos. */
function bulkResForm() {
  return `<section class="card bulkres"><details${P.tab.bulkOpen ? " open" : ""}><summary><h2 style="margin:0">⚡ Precio revendedor para todos <small>de una vez, con un % de descuento</small></h2></summary>
      <form class="form" id="bulkRes" style="margin-top:10px">
        <label>Descuento sobre tu precio público (%)<input name="pct" inputmode="numeric" value="20"></label>
        <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="overwrite"> Cambiar también los que ya tienen precio de revendedor</label>
        <p class="muted" style="grid-column:1/-1;margin:0">Ejemplo con 20%: un producto de Bs 35 queda en Bs 28 para tus revendedores (redondeado a Bs enteros). Antes de aplicar te mostramos si alguno queda por debajo de lo que te cuesta. Después podés ajustar uno por uno en Productos.</p>
        <button class="pbtn dark" type="submit">Revisar y aplicar</button></form></details></section>`;
}

function marginsCard(mg) {
  const ST = { ok: ["✅", "pp-ok"], low: ["⚠️ poco", "pp-warn"], loss: ["🔴 perdés", "pp-bad"] };
  const cell = (r) => !r ? `<span class="muted">—</span>` : `<b>${bs(r.gain)}</b> <small class="muted">(${r.pct}%)</small> <span class="pp ${ST[r.state][1]}">${ST[r.state][0]}</span>`;
  const worst = (p) => Math.min(p.public?.pct ?? 999, p.reseller?.pct ?? 999);
  const rows = mg.products.filter((p) => p.public || p.reseller).sort((a, b) => worst(a) - worst(b)).map((p) => `<tr><td><b>${esc(p.name)}</b><br><small class="muted">${esc({ full_account: "Cuenta completa", profile: "Perfil", invite: "Invitación", iptv: "IPTV" }[p.kind] ?? p.kind)}</small></td>
    <td class="num">${p.unitCost === null ? "—" : bs(p.unitCost)}</td><td class="num">${p.public ? bs(p.public.price) : "—"}</td><td>${cell(p.public)}</td><td>${cell(p.reseller)}</td></tr>`);
  const sinCosto = mg.products.filter((p) => p.unitCost === null && p.accounts > 0).length;
  return `<section class="card"><h2>${icon("coins")}¿Cuánto ganás por venta? <small>precio menos lo que te cuesta</small></h2>
    <p class="muted" style="margin:0 0 10px">El costo sale de lo que pagás por cada cuenta (dividido entre sus perfiles), por mes. Lo que menos te deja (a cliente final o a revendedor) aparece primero.</p>
    ${table(["Producto", "Te cuesta", "Precio", "Ganás (cliente final)", "Ganás (revendedor)"], rows, "Cargá el costo de tus cuentas para ver tu ganancia.")}
    ${sinCosto ? `<p class="muted" style="margin:8px 0 0">${sinCosto} producto(s) tienen cuentas sin costo cargado: editá la cuenta y poné cuánto pagás.</p>` : ""}
    <form class="inline" id="minMarginForm" style="margin-top:10px;flex-wrap:wrap"><label>Avisarme si gano menos del (%)<input name="pct" type="number" min="0" max="90" step="1" inputmode="numeric" value="${mg.minMarginPct}" style="width:90px"></label><button class="pbtn sm" type="submit">Guardar</button></form></section>`;
}

/* ---------------- Cobro por país (Yappy, Tigo Money…) ---------------- */
async function payMethodsCard() {
  const [list, groups] = await Promise.all([api("GET", "/api/admin/paymethods").catch(() => null), api("GET", "/api/admin/price-groups").catch(() => [])]);
  if (!list) return "";
  const lists = groups.filter((g) => g.id !== "revendedor");
  const gname = (id) => groups.find((g) => g.id === id)?.name ?? id;
  const ed = list.find((m) => m.id === P.tab.pmEdit) ?? null;
  const f = ed ?? { priceGroupIds: [], replacesQr: false, enabled: true };
  const rows = list.map((m) => `<div class="pmrow">
      <div class="pmhead"><b>${esc(m.name)}</b>${m.country ? ` <span class="muted">· ${esc(m.country)}</span>` : ""} ${m.enabled ? pill("Activo", "ok") : pill("Apagado", "mute")}</div>
      <small class="muted">${esc(m.account)}${m.holder ? ` · ${esc(m.holder)}` : ""}</small>
      <small>Lo ven: ${m.priceGroupIds.length ? m.priceGroupIds.map((g) => esc(gname(g))).join(", ") : "todos los clientes"}${m.replacesQr ? " · <b>en lugar del QR de Bolivia</b>" : ""}</small>
      <div class="inline" style="flex-wrap:wrap">
        <button class="pbtn sm" type="button" data-pmedit="${esc(m.id)}">${icon("edit")}Editar</button>
        <label class="pbtn sm filebtn">${m.hasQr ? "Cambiar QR" : "Subir QR"}<input type="file" accept="image/png,image/jpeg,image/webp" data-pmqr="${esc(m.id)}" data-fp="1" class="vh"></label>
        ${m.hasQr ? `<a class="pbtn sm" href="/api/admin/paymethods/${esc(m.id)}/qr" target="_blank" rel="noopener">Ver QR</a><button class="pbtn sm" type="button" data-pmqrdel="${esc(m.id)}">Quitar QR</button>` : ""}
        <button class="pbtn sm" type="button" data-pmdel="${esc(m.id)}" data-name="${esc(m.name)}" aria-label="Borrar ${esc(m.name)}">${icon("trash")}</button>
      </div></div>`).join("");
  return `<section class="card"><h2>${icon("coins")}Cobro por país <small>Yappy, Tigo Money, giros, transferencia…</small></h2>
    <p class="muted" style="margin:0">Cada cliente ve en el carrito cómo pagar en su país, según su <b>lista de precios</b> (Panamá, Paraguay…). Paga, sube el comprobante y vos lo aprobás en <b>Aprobar pagos</b>, igual que un QR. No se conecta a ninguna cuenta: los datos solo se muestran.</p>
    ${rows ? `<div class="pmlist">${rows}</div>` : ""}
    <form class="form" id="pmForm" autocomplete="off" ${ed ? `data-id="${esc(ed.id)}"` : ""}>
      <h3 style="grid-column:1/-1;margin:4px 0 0;font-size:15px">${ed ? `Editar ${esc(ed.name)}` : "Agregar un método"}</h3>
      <label>Nombre<input name="name" required maxlength="40" list="pmNames" value="${esc(f.name ?? "")}" placeholder="Ej.: Yappy"><datalist id="pmNames"><option>Yappy</option><option>Tigo Money</option><option>Giros Tigo</option><option>Transferencia bancaria</option><option>Nequi</option></datalist></label>
      <label>País <small class="muted">(opcional)</small><input name="country" maxlength="30" value="${esc(f.country ?? "")}" placeholder="Ej.: Panamá"></label>
      <label>Número, alias o cuenta<input name="account" required maxlength="120" value="${esc(f.account ?? "")}" placeholder="Ej.: 6123-4567"></label>
      <label>A nombre de <small class="muted">(opcional)</small><input name="holder" maxlength="60" value="${esc(f.holder ?? "")}" placeholder="Ej.: Gabriel …"></label>
      <label style="grid-column:1/-1">Indicaciones para el cliente <small class="muted">(opcional)</small><input name="instructions" maxlength="300" value="${esc(f.instructions ?? "")}" placeholder="Ej.: En el concepto poné tu nombre."></label>
      <fieldset class="cupprods" style="grid-column:1/-1"><legend>¿Quiénes lo ven? <small class="muted">(ninguna marcada = todos)</small></legend>
        ${lists.map((g) => `<label class="chk"><input type="checkbox" name="pmgroup" value="${esc(g.id)}" ${f.priceGroupIds.includes(g.id) ? "checked" : ""}> ${esc(g.name)}</label>`).join("") || `<span class="muted">Creá listas de precios por país en Clientes.</span>`}</fieldset>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="replacesQr" ${f.replacesQr ? "checked" : ""}> Para esos clientes, esconder el QR de Bolivia</label>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="enabled" ${f.enabled ? "checked" : ""}> Mostrarlo en la tienda</label>
      <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">${ed ? "Guardar cambios" : "Agregar método"}</button>${ed ? `<button class="pbtn" type="button" data-pmedit="">Cancelar</button>` : ""}</div>
    </form></section>`;
}

/* Dólar flexible: la tasa del USDT cambia seguido. Tarjeta en Inicio para cambiarla en un toque; avisa si tiene más de 24 h. */
async function rateCard() {
  if (!canReview()) return "";
  const u = await api("GET", "/api/admin/usdt").catch(() => null);
  if (!u?.enabled || !(u.rate > 0)) return "";
  const age = u.rateAt ? Date.now() - u.rateAt : Infinity, old = age > 24 * 3600_000;
  const when = !u.rateAt ? "sin fecha" : age < 3600_000 ? "hace menos de 1 hora" : age < 48 * 3600_000 ? `hace ${Math.floor(age / 3600_000)} h` : `el ${fdate(u.rateAt)}`;
  return `<section class="card hm-rate ${old ? "hm-rate-old" : ""}"><h2>💱 Tasa del USDT ${old ? pill("Revisala", "warn") : ""}</h2>
    <p class="muted" style="margin:0">1 USDT = <b>Bs ${String(u.rate).replace(".", ",")}</b> · actualizada ${when}. Con el dólar flexible, cambiala cuando se mueva: lo que ya pidieron no cambia.</p>
    <form class="inline" id="rateForm" style="flex-wrap:wrap"><input id="rateNew" name="rate" aria-label="Nueva tasa: cuántos Bs vale 1 USDT" inputmode="decimal" required placeholder="Ej.: ${String(u.rate).replace(".", ",")}" style="flex:1 1 120px"><button class="pbtn dark" type="submit">Actualizar tasa</button></form></section>`;
}

async function usdtCard() {
  const u = await api("GET", "/api/admin/usdt").catch(() => null);
  if (!u) return "";
  const on = u.enabled && (u.address || u.payId) && u.rate > 0;
  return `<section class="card"><h2>${icon("coins")}Cobrar en USDT a mano ${on ? pill("Activo", "ok") : (u.address || u.payId) ? pill("Configurado · apagado", "warn") : pill("Sin configurar", "mute")}</h2>
    <p class="muted" style="margin:0">La forma simple, sin cuenta de empresa: el cliente ve tu <b>dirección USDT</b> (o tu Binance Pay ID) y el monto, te manda el pago y sube el comprobante. Vos lo aprobás como un pago por QR. Ideal mientras Binance Pay automático no esté habilitado.</p>
    <form class="form" id="usdtForm">
      <label>Red<input name="network" placeholder="Ej.: TRC20" value="${esc(u.network || "")}" list="usdtNets"><datalist id="usdtNets"><option>TRC20</option><option>BEP20</option><option>ERC20</option><option>Polygon</option></datalist></label>
      <label>Tasa: ¿cuántos Bs vale 1 USDT?${u.rateAt ? ` <small class="muted">(actualizada ${fdt(u.rateAt)})</small>` : ""}<input name="rate" inputmode="decimal" placeholder="Ej.: 13" value="${u.rate || ""}"></label>
      <label style="grid-column:1/-1">Dirección de tu billetera USDT<input name="address" autocomplete="off" placeholder="Ej.: T... (la dirección de esa red)" value="${esc(u.address || "")}"></label>
      <label style="grid-column:1/-1">Binance Pay ID <small class="muted">(opcional, pago Binance-a-Binance)</small><input name="payId" inputmode="numeric" placeholder="Ej.: 123456789" value="${esc(u.payId || "")}"></label>
      <label style="grid-column:1/-1">Nota para el cliente <small class="muted">(opcional)</small><input name="note" maxlength="300" placeholder="Ej.: Mandá solo por TRC20. Avisame por WhatsApp con el hash." value="${esc(u.note || "")}"></label>
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="enabled" ${u.enabled ? "checked" : ""}> Aceptar pagos en USDT a mano en la tienda</label>
      <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">Guardar</button></div>
      <p class="muted" style="grid-column:1/-1;margin:0">⚠️ Revisá el pago en tu billetera antes de aprobar: en cripto, una transferencia no se puede revertir.</p>
    </form></section>`;
}

/* Vigila pagos nuevos cada 30 s: sonido, contador en la pestaña y notificación del navegador. */
const watch = { last: null };
function beep() {
  try {
    const ac = new (window.AudioContext || window.webkitAudioContext)();
    [0, 0.18].forEach((t) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.frequency.value = 880; g.gain.setValueAtTime(0.15, ac.currentTime + t); g.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + t + 0.15);
      o.connect(g).connect(ac.destination); o.start(ac.currentTime + t); o.stop(ac.currentTime + t + 0.16);
    });
  } catch { /* sin audio */ }
}
function showPending(n) {
  $("#dot").hidden = !n;
  document.title = (n ? `(${n}) ` : "") + "Panel · " + (P.settings?.storeName ?? "Gabriel Store");
  const b = $('#menu [data-go="aprobacion"]');
  if (b) { b.querySelector(".count")?.remove(); if (n) b.insertAdjacentHTML("beforeend", `<span class="count">${n}</span>`); }
}
async function refreshNotifCount() {
  try {
    const d = await api("GET", "/api/admin/notifications");
    const el = $("#notifcount"); if (el) { el.textContent = d.total > 99 ? "99+" : String(d.total); el.hidden = !d.total; }
    const m = $('#menu [data-go="notificaciones"]'); if (m) { m.querySelector(".count")?.remove(); if (d.total) m.insertAdjacentHTML("beforeend", `<span class="count">${d.total > 99 ? "99+" : d.total}</span>`); }
  } catch { /* sin permiso o sin sesión */ }
}
async function watchPayments() {
  if (!P.me) return;
  const n = await api("GET", "/api/admin/orders?status=payment_review").then((l) => l.length).catch(() => null);
  if (n === null) return;
  if (watch.last !== null && n > watch.last) {
    beep();
    toast(n - watch.last === 1 ? "Llegó un pago nuevo para revisar" : `Llegaron ${n - watch.last} pagos nuevos para revisar`);
    if ("Notification" in window && Notification.permission === "granted") {
      try { new Notification("Pago nuevo para revisar", { body: "Entrá a Aprobación de ventas", tag: "gs-pago" }); } catch { /* móvil sin soporte */ }
    }
    if (P.view === "aprobacion" && !document.activeElement?.closest("form")) render();
  }
  watch.last = n;
  showPending(n);
}
setInterval(watchPayments, 30_000);

/* ---------------- WhatsApp: avisos, conversaciones y bot ---------------- */
async function waConfig() {
  return canReview() ? api("GET", "/api/admin/whatsapp/config").catch(() => null) : null;
}

async function waAvisosHtml() {
  const cfg = await waConfig();
  const waOn = !!cfg?.ready.enabled && cfg.ready.token;

  if (!canReview()) return `<section class="card"><div class="emptybox">Solo el dueño o un admin ven los avisos.</div></section>`;
  const [out, customers] = await Promise.all([api("GET", "/api/admin/outbox"), api("GET", "/api/admin/customers")]);
  const name = (id) => (id === "staff" ? "Para vos (dueño)" : customers.find((c) => c.id === id)?.name ?? id);
  const tab = P.tab.wa ?? "pending";
  const pending = out.filter((m) => m.status === "queued" || m.status === "failed");
  const list = tab === "pending" ? pending : tab === "noconsent" ? out.filter((m) => m.status === "skipped_no_consent") : out;
  return `${waOn ? `<div class="pok">El bot está conectado: los avisos salen solos cada minuto por la API oficial. Si alguno falla, abajo ves el motivo y podés mandarlo a mano.</div>` : `<div class="pok">Modo manual: tocá <b>Abrir WhatsApp</b>, mandá el mensaje desde tu teléfono y después <b>Marcar enviado</b>. Con el bot conectado (pestaña “Bot y conexión”), esto se hace solo.</div>`}
    <section class="card"><div class="tabs" role="tablist">${[["pending", `Por enviar (${pending.length})`], ["noconsent", "Sin permiso"], ["all", "Todos"]].map(([k, t]) => `<button role="tab" type="button" data-tab="wa:${k}" aria-selected="${k === tab}">${t}</button>`).join("")}</div>
    ${list.length ? list.map((m) => `<div style="display:grid;gap:8px;border-bottom:1px solid var(--line);padding-block:12px"><div class="inline"><b>${esc(name(m.customerId))}</b><span class="muted">${esc(m.to)}</span>${pill({ queued: "Por enviar", failed: "Falló", sent: "Enviado", sent_manually: "Enviado a mano", skipped_no_consent: "Sin permiso del cliente" }[m.status], { queued: "warn", failed: "bad", sent: "ok", sent_manually: "ok", skipped_no_consent: "mute" }[m.status])}<span class="muted" style="margin-left:auto">${fdt(m.createdAt)}</span></div>
      <div class="wa-msg">${esc(m.text)}</div>
      ${m.status === "queued" || m.status === "failed" ? `<div class="inline"><a class="pbtn sm green" href="${waLink(m.to, m.text)}" target="_blank" rel="noopener">${icon("wa")}Abrir WhatsApp</a><button class="pbtn sm" type="button" data-sent="${esc(m.id)}">Marcar enviado</button></div>` : ""}
      ${m.status === "failed" && m.error ? `<p class="perr" style="margin:0">${esc(m.error)}</p>` : ""}
      ${m.status === "skipped_no_consent" ? `<p class="muted" style="margin:0">El cliente no aceptó avisos. Si te lo pide, activalo en su ficha o mandalo igual a mano.</p>` : ""}</div>`).join("") : `<div class="emptybox">Nada por acá.</div>`}</section>`;
}

/** Formato de WhatsApp: *negrita* y _cursiva_ (sobre texto ya escapado). */
const waFmt = (t) => esc(t).replace(/\*([^*\n]+)\*/g, "<b>$1</b>").replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, "$1<i>$2</i>");

async function waChatsHtml() {
  const [list, cfg] = await Promise.all([api("GET", "/api/admin/whatsapp/chats"), waConfig()]);
  const sel = P.tab.chat && list.find((c) => c.phone === P.tab.chat) ? P.tab.chat : list[0]?.phone;
  const t = sel ? await api("GET", `/api/admin/whatsapp/chats/${encodeURIComponent(sel)}`) : null;
  const meta = list.find((c) => c.phone === sel);
  const off = cfg && !cfg.ready.enabled ? `<div class="pok">El bot está apagado: los mensajes se guardan acá pero nadie contesta solo. Encendelo en “Bot y conexión con Meta”.</div>` : "";
  if (!list.length) return `${off}<section class="card"><div class="emptybox">${icon("wa")}<span>Todavía no hay conversaciones. Cuando un cliente le escriba al número del bot, aparece acá.</span></div></section>`;
  const BY = { cliente: "", bot: "🤖 Bot", staff: "👤 Equipo", sistema: "⚙ Aviso" };
  return `${off}<section class="card"><div class="chats ${P.tab.waOpen ? "show-chat" : "show-list"}">
    <div class="clist">${list.map((c) => `<button type="button" data-chat="${esc(c.phone)}" aria-current="${c.phone === sel}"><span class="av">${icon("user")}</span><b>${esc(c.customerName ?? c.name ?? c.phone)}</b>
      <small>${c.needsHuman ? pill("Pide persona", "bad") : c.botPaused ? pill("Atiende persona", "warn") : ""}${c.unread ? ` ${pill(c.unread, "ok")}` : ""}</small><small class="last">${esc(c.lastText.replace(/[*_]/g, ""))}</small></button>`).join("")}</div>
    <div style="display:grid;grid-template-rows:auto 1fr auto;min-width:0">
      <div class="inline" style="padding:12px;border-bottom:1px solid var(--line)"><button class="pbtn sm wa-back" type="button" data-waback="1">←</button><b>${esc(meta.customerName ?? meta.name ?? meta.phone)}</b><small class="muted">${esc(meta.phone)}</small>
        ${meta.inWindow ? pill(`Podés escribirle hasta el ${fdt(meta.windowEndsAt)}`, "ok") : pill("Ventana de 24 h cerrada", "mute")}
        <span style="margin-left:auto" class="inline">${meta.botPaused || meta.needsHuman ? `<button class="pbtn sm" type="button" data-human="${esc(sel)}" data-on="0">🤖 Devolver al bot</button>` : `<button class="pbtn sm" type="button" data-human="${esc(sel)}" data-on="1">👤 Atender yo</button>`}</span></div>
      <div class="msgs" style="max-height:460px">${t.messages.map((m) => `<div class="bub" style="${m.direction === "in" ? "justify-self:start;background:var(--card);border-radius:12px 12px 12px 2px" : ""}">${m.direction === "out" ? `<span class="auto">${BY[m.by]}</span>` : ""}${waFmt(m.text)}<time>${fdt(m.at)}${m.direction === "out" ? ` · ${{ sent: "enviado", delivered: "entregado", read: "leído ✓✓", failed: "falló" }[m.status] ?? ""}` : ""}</time>${m.error ? `<small class="down">${esc(m.error)}</small>` : ""}</div>`).join("")}</div>
      ${meta.inWindow ? `<form class="inline" id="waReply" data-phone="${esc(sel)}" style="padding:10px;border-top:1px solid var(--line)"><input name="text" placeholder="Escribí tu respuesta…" required maxlength="4000" style="flex:5 1 200px"><button class="pbtn green" type="submit">Enviar</button></form>
        <small class="muted" style="padding:0 10px 10px">Al responder, el bot se pausa en esta charla para no interrumpirte.</small>`
      : `<p class="muted" style="padding:10px;margin:0;border-top:1px solid var(--line)">Pasaron más de 24 h desde su último mensaje: WhatsApp solo permite escribirle con una plantilla aprobada (avisos). Si te vuelve a escribir, podés responder acá.</p>`}
    </div></div></section>`;
}

async function waBotHtml() {
  const cfg = await waConfig();
  if (!cfg) return `<section class="card"><div class="emptybox">Solo el dueño o un admin ven la configuración del bot.</div></section>`;
  const b = cfg.settings, r = cfg.ready, owner = isOwner();
  const check = (ok, label, hint) => `<div><span class="ic" style="color:${ok ? "var(--ok)" : "var(--bad)"}">${ok ? "✓" : "✗"}</span><b>${label}${hint && !ok ? `<br><small class="muted" style="font-weight:400">${hint}</small>` : ""}</b></div>`;
  const dis = owner ? "" : "disabled";
  return `<section class="card"><h2>${icon("wa")}Estado del bot ${r.enabled && r.token ? pill("Encendido", "ok") : pill("Apagado", "mute")}</h2><div class="todo">
      ${check(r.https, "Tienda publicada con HTTPS", "Meta solo manda mensajes a una dirección pública https://. Hace falta publicar la tienda (Railway, Render o túnel) y arrancar con GS_PUBLIC_ORIGIN.")}
      ${check(r.phoneNumberId, "Phone number ID cargado", "Meta → WhatsApp → Configuración de la API.")}
      ${check(r.token, "Token de acceso permanente cargado", "Meta Business → Usuarios del sistema → Generar token.")}
      ${check(r.appSecret, "App Secret cargado (firma del webhook)", "Meta → Configuración de la app → Básica.")}
      ${check(r.enabled, "Bot encendido", "Encendelo abajo cuando todo lo demás esté en verde.")}</div>
      ${cfg.pending ? `<div class="inline"><span class="muted">${cfg.pending} aviso(s) esperando.</span>${r.enabled && r.token ? `<button class="pbtn sm" type="button" data-waflush="1">Enviar ahora</button>` : ""}</div>` : ""}</section>

    <section class="card"><h2>Conectar con Meta (una sola vez)</h2>
      <ol style="margin:0;padding-left:20px;display:grid;gap:6px">
        <li>Creá (o usá) tu cuenta en <a href="https://business.facebook.com" target="_blank" rel="noopener">business.facebook.com</a> y verificá tu negocio si Meta lo pide.</li>
        <li>En <a href="https://developers.facebook.com/apps" target="_blank" rel="noopener">developers.facebook.com/apps</a> creá una app de tipo <b>Empresa</b> y agregale el producto <b>WhatsApp</b>.</li>
        <li>Agregá tu número (uno <b>exclusivo para el bot</b>) y copiá el <b>Phone number ID</b> abajo.</li>
        <li>En Meta Business → <b>Usuarios del sistema</b>, creá uno con rol admin, asignale la app y generá un <b>token permanente</b> con los permisos <code>whatsapp_business_messaging</code> y <code>whatsapp_business_management</code>. Pegalo abajo.</li>
        <li>En la app → Configuración → Básica, copiá el <b>App Secret</b> y pegalo abajo.</li>
        <li>En WhatsApp → Configuración → <b>Webhook</b>: URL ${cfg.webhookUrl ? `<code>${esc(cfg.webhookUrl)}</code> <button class="pbtn sm" type="button" data-copy="${esc(cfg.webhookUrl)}">Copiar</button>` : `<b class="down">(primero publicá la tienda con HTTPS)</b>`} y token de verificación ${cfg.verifyToken ? `<code>${esc(cfg.verifyToken)}</code> <button class="pbtn sm" type="button" data-copy="${esc(cfg.verifyToken)}">Copiar</button>` : "(lo ve el dueño)"}. Suscribí el campo <b>messages</b>.</li>
        <li>Creá las <b>plantillas</b> de la tabla de abajo en WhatsApp Manager y, cuando Meta las apruebe, cargá su nombre.</li>
        <li>Probá con <b>Enviar prueba</b> y encendé el bot.</li>
      </ol>
      <p class="muted" style="margin:0">Guía completa en el repositorio: <code>docs/WHATSAPP_META.md</code>.</p></section>

    <section class="card"><h2>Claves de Meta ${owner ? "" : "<small>· solo el dueño las cambia</small>"}</h2>
      <form class="form" id="waSecrets"><label>Token de acceso permanente ${cfg.secrets.token ? pill(`cargado ${cfg.secrets.token}`, "ok") : pill("falta", "bad")}<input name="accessToken" type="password" autocomplete="off" placeholder="EAAG…" ${dis}></label>
      <label>App Secret ${cfg.secrets.appSecret ? pill(`cargado ${cfg.secrets.appSecret}`, "ok") : pill("falta", "bad")}<input name="appSecret" type="password" autocomplete="off" placeholder="32 caracteres" ${dis}></label>
      ${owner ? `<button class="pbtn dark" type="submit">Guardar claves</button>` : ""}</form>
      <p class="muted" style="margin:0">Se guardan aparte de tus datos: no salen en exportaciones, ni en la auditoría, ni se vuelven a mostrar completas.</p></section>

    <section class="card"><h2>Bot</h2><form class="form" id="waConfig">
      <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="enabled" ${b.enabled ? "checked" : ""} ${dis}> <b>Bot encendido</b>: contesta solo las 24 horas y manda los avisos por la API oficial</label>
      <label>Phone number ID<input name="phoneNumberId" inputmode="numeric" value="${esc(b.phoneNumberId)}" ${dis}></label>
      <label>Versión de la API<input name="apiVersion" value="${esc(b.apiVersion)}" ${dis}></label>
      <label>Horas de pausa al pasar a una persona<input name="humanPauseHours" type="number" min="1" max="72" value="${b.humanPauseHours}" ${dis}></label>
      <label style="grid-column:1/-1">Saludo (opcional; {name} = nombre del cliente, {store} = tu tienda)<input name="welcome" maxlength="600" value="${esc(b.welcome ?? "")}" placeholder="¡Hola{name}! 👋 Soy el asistente de *{store}*. Te ayudo a cualquier hora." ${dis}></label>
      ${owner ? `<button class="pbtn dark" type="submit">Guardar</button>` : ""}</form>
      <details class="more"><summary>¿Qué contesta el bot?</summary><ul style="margin:6px 0 0;padding-left:20px">
        <li><b>1 / servicios</b>: sus servicios y vencimientos + link a Mis cuentas (nunca manda claves ni PIN).</li>
        <li><b>2 / precios</b>: productos disponibles con su precio (o el de revendedor).</li>
        <li><b>3 / pagar</b>: cómo pagar, tus datos de pago y el QR (con la tienda publicada en https).</li>
        <li><b>4 / entrar</b>: link personal de un solo uso para entrar a la tienda.</li>
        <li><b>5 / código</b>: códigos de verificación de SUS cuentas (últimos 30 min).</li>
        <li><b>6 / saldo</b>: su saldo. <b>7 / pedidos</b>: estado de sus últimos pedidos.</li>
        <li><b>8 / clientes</b> (solo revendedores): sus clientes que vencen en los próximos 7 días.</li>
        <li><b>Nombre de un producto</b> (“cuánto está netflix”): precio, duración y si hay stock.</li>
        <li><b>hola / menú</b>: el menú. <b>gracias</b>: “¡De nada!”. <b>BAJA / ALTA</b>: deja o vuelve a recibir avisos.</li>
        <li><b>0 / persona</b>: te avisa en Conversaciones y el bot se calla en esa charla. Fuera de tu horario de atención, se lo aclara al cliente.</li>
        <li>Si no entiende, lo dice y muestra el menú. <b>Tus respuestas propias</b> (abajo) van primero.</li></ul></details></section>

    <section class="card"><h2>Horario de atención de personas</h2>
      <p class="muted" style="margin:0">El bot contesta siempre. Esto solo sirve para que, si un cliente pide hablar con una persona fuera de horario, el bot le diga cuándo le van a responder.</p>
      <form class="inline" id="waHours"><label class="chk"><input type="checkbox" name="on" ${b.humanHours ? "checked" : ""} ${dis}> Avisar fuera de horario</label>
        <label class="inline" style="display:flex">De<select name="from" ${dis}>${Array.from({ length: 24 }, (_, h) => opt(h, `${h}:00`, h === (b.humanHours?.from ?? 9))).join("")}</select></label>
        <label class="inline" style="display:flex">a<select name="to" ${dis}>${Array.from({ length: 24 }, (_, h) => opt(h + 1, `${h + 1}:00`, h + 1 === (b.humanHours?.to ?? 21))).join("")}</select></label>
        ${owner ? `<button class="pbtn dark" type="submit">Guardar</button>` : ""}</form></section>

    <section class="card"><h2>Respuestas propias <small>· ${(b.quickReplies ?? []).length}/30</small></h2>
      <p class="muted" style="margin:0">Si el mensaje del cliente tiene <b>alguna</b> de las palabras clave, el bot contesta tu texto. Separá las palabras con coma. En el texto podés usar <code>{name}</code> (nombre del cliente) y <code>{tienda}</code> (link de la tienda). Usá *asteriscos* para <b>negrita</b>.</p>
      <form id="waQuick" style="display:grid;gap:12px">
        ${[...(b.quickReplies ?? []), ...(owner ? [{ keywords: [], answer: "" }] : [])].map((q, i) => `<div class="qr-row" style="display:grid;gap:8px;grid-template-columns:minmax(0,1fr) minmax(0,2fr) auto;align-items:start;border-bottom:1px solid var(--line);padding-bottom:12px">
          <label>Palabras clave<input name="k" value="${esc(q.keywords.join(", "))}" placeholder="${i ? "" : "horario, atienden, a que hora"}" ${dis}></label>
          <label>Respuesta<textarea name="a" rows="2" maxlength="1000" placeholder="${i ? "" : "Atendemos de 9:00 a 21:00, todos los días 🙌"}" ${dis}>${esc(q.answer)}</textarea></label>
          ${owner && q.answer ? `<button class="pbtn sm" type="button" data-qrdel="1" style="margin-top:22px">Quitar</button>` : "<span></span>"}</div>`).join("")}
        ${owner ? `<div class="inline"><button class="pbtn dark" type="submit">Guardar respuestas</button><span class="muted">Para agregar otra, completá la fila vacía y guardá.</span></div>` : ""}</form>
      <details class="more"><summary>Ideas de respuestas</summary><ul style="margin:6px 0 0;padding-left:20px">
        <li><b>garantia, se cayo, no funciona</b> → “Si tu cuenta falla, escribí *0* y te la cambiamos sin costo dentro de la garantía.”</li>
        <li><b>revendedor, revender, mayorista</b> → “¡Sí! Tenemos precios especiales para revendedores. Escribí *0* y te pasamos la info.”</li>
        <li><b>dispositivos, pantallas, tv</b> → “Cada perfil es para 1 dispositivo a la vez.”</li></ul></details></section>

    <section class="card"><h2>Plantillas de avisos <small>· necesarias para escribir a clientes que no te escribieron en las últimas 24 h</small></h2>
      <p class="muted" style="margin:0">Creá cada una en <a href="https://business.facebook.com/wa/manage/message-templates/" target="_blank" rel="noopener">WhatsApp Manager → Plantillas</a> con el texto exacto, idioma Español y la categoría indicada. Cuando Meta la apruebe, escribí acá su nombre.</p>
      <form id="waTemplates" style="display:grid;gap:10px">${table(["Aviso", "Texto para Meta", "Categoría", "Nombre aprobado", "Idioma"], cfg.templates.map((t) => `<tr><td><b>${esc(t.id)}</b></td><td><span class="wa-msg" style="display:block">${esc(t.body)}</span><button class="pbtn sm" type="button" data-copy="${esc(t.body)}">Copiar</button></td><td>${t.category === "AUTHENTICATION" ? "Autenticación" : "Utilidad"}</td>
        <td><input name="name-${esc(t.id)}" value="${esc(t.configured?.name ?? "")}" placeholder="${esc(t.id)}" ${dis}></td><td><input name="lang-${esc(t.id)}" value="${esc(t.configured?.lang ?? "es")}" style="width:80px" ${dis}></td></tr>`))}
      ${owner ? `<button class="pbtn dark" type="submit" style="justify-self:start">Guardar plantillas</button>` : ""}</form></section>

    ${owner ? `<section class="card"><h2>Enviar prueba</h2><p class="muted" style="margin:0">Manda la plantilla <code>hello_world</code> (Meta la aprueba sola en cuentas nuevas) para comprobar el número y el token.</p>
      <form class="inline" id="waTest"><input name="to" placeholder="59170000000" inputmode="tel" required><button class="pbtn dark" type="submit">Enviar prueba</button></form></section>` : ""}`;
}

/* ---------------- render ---------------- */
async function render() {
  const pend = await api("GET", "/api/admin/orders?status=payment_review").then((l) => l.length).catch(() => 0);
  watch.last = pend;
  showPending(pend);
  refreshNotifCount();
  const inG = ["cuentas", "carga", "productos", "cupones"].includes(P.view);
  // Atención (seller) no ve en el menú las pantallas que no puede usar (antes le daban error).
  const roleOk = (r) => !r || Array.isArray(r) || (r === "owner" ? isOwner() : r === "review" ? canReview() : true);
  $("#menu").innerHTML = MENU.filter((m) => roleOk(m[3]) && roleOk(m[4])).map(([k, i, t, sub]) => Array.isArray(sub)
    ? `<details ${inG ? "open" : ""}><summary>${icon(i)}${t}${icon("chev", "i chev")}</summary><div class="sub">${sub.map(([k2, t2]) => `<button type="button" data-go="${k2}" ${k2 === P.view ? 'aria-current="page"' : ""}>${t2}</button>`).join("")}</div></details>`
    : `<button type="button" data-go="${k}" ${k === P.view ? 'aria-current="page"' : ""}>${icon(i)}${t}${k === "aprobacion" && pend ? `<span class="count">${pend}</span>` : ""}</button>`).join("");
  const [ti, tt] = TITLE[P.view];
  $("#ptitle").innerHTML = icon(ti) + tt;
  const bnavFor = ["cuentas", "carga", "productos", "cupones"].includes(P.view) ? "cuentas" : P.view;
  const bCuentas = $('#pbnav button[data-go="cuentas"]');
  if (bCuentas && P.me && !canReview()) { bCuentas.dataset.go = "fallas"; bCuentas.querySelector("span").textContent = "Fallas"; bCuentas.querySelector("use")?.setAttribute("href", "/icons.svg#i-help"); }
  $$("#pbnav button").forEach((b) => b.setAttribute("aria-current", b.dataset.go === bnavFor ? "page" : "false"));
  $("#app").classList.remove("open");
  try {
    $("#pout").innerHTML = await V[P.view]();
    $$(".msgs").forEach((m) => (m.scrollTop = m.scrollHeight));
    enhanceDates($("#pout"));
    enhanceFiles($("#pout"));
    fitChartText($("#pout"));
    if (["apariencia", "configuracion"].includes(P.view)) foldCards($("#pout"));
    if (P.view === "apariencia") previewLook();
    if (P.view === "configuracion") pushStatus();
  } catch (e) {
    if (e.status === 401) return showLogin();
    $("#pout").innerHTML = `<div class="perr">No se pudo cargar: ${esc(e.message)}</div>`;
  }
}
function go(v) {
  P.view = TITLE[v] ? v : "inicio";
  history.replaceState(null, "", "#" + P.view);
  scrollTo(0, 0);
  render();
}

/* ---------------- Letras de los gráficos legibles en cualquier ancho ----------------
   Los gráficos son SVG y se achican con la pantalla: calculamos el tamaño para que en pantalla
   se vean siempre a ~12,5 px (antes los ejes quedaban en 10–11 px en el celular). */
function fitChartText(root = document) {
  for (const svg of root.querySelectorAll("svg")) {
    const vb = svg.viewBox && svg.viewBox.baseVal;
    const labels = svg.querySelectorAll("text.ax");
    if (!vb || !vb.width || !labels.length) continue;
    const scale = svg.getBoundingClientRect().width / vb.width;
    if (!scale) continue;
    const units = 12.5 / scale;
    for (const tx of labels) tx.style.fontSize = Math.max(units, 8) + "px";
  }
}
let fitTimer;
addEventListener("resize", () => { clearTimeout(fitTimer); fitTimer = setTimeout(() => fitChartText($("#pout") || document), 150); });

/* ---------------- Selector de archivo en español ----------------
   El nativo dice "Choose File / No file chosen" (idioma del navegador) y se salía de la tarjeta. */

/* ---------------- Secciones plegables en el celular ----------------
   Apariencia y Configuración medían 6.000–7.000 px de alto. En el celular cada tarjeta se pliega;
   la primera queda abierta y se recuerda cuál dejaste abierta aunque guardes. */
P.fold = P.fold || {};
function foldCards(root) {
  if (!matchMedia("(max-width:900px)").matches) return;
  const cards = [...root.querySelectorAll(":scope > section.card")];
  cards.forEach((card, i) => {
    const h = card.querySelector(":scope > h2");
    if (!h || card.dataset.folded) return;
    card.dataset.folded = "1";
    const key = `${P.view}:${i}`;
    const det = document.createElement("details");
    det.className = "cardfold";
    det.open = key in P.fold ? P.fold[key] : i === 0;
    const sum = document.createElement("summary");
    sum.innerHTML = h.innerHTML;
    const body = document.createElement("div");
    body.className = "cf-body";
    h.remove();
    body.append(...[...card.childNodes]);
    det.append(sum, body);
    card.append(det);
    card.classList.add("folded");
    det.addEventListener("toggle", () => { P.fold[key] = det.open; });
  });
}

/* ---------------- Fechas siempre en dd/mm/aaaa ----------------
   El selector nativo muestra la fecha con el idioma del aparato (en uno en inglés sale mm/dd/yyyy).
   Mostramos nosotros la fecha en dd/mm/aaaa encima, y el selector nativo sigue abriendo el calendario. */
const dmy = (v) => { if (!v) return ""; const [y, m, d] = v.split("-"); return `${d}/${m}/${y}`; };
function enhanceDates(root = document) {
  for (const inp of root.querySelectorAll('input[type="date"]:not([data-dmy])')) {
    inp.dataset.dmy = "1";
    const wrap = document.createElement("span");
    wrap.className = "dmy";
    const shown = document.createElement("span");
    shown.className = "dmy-v";
    shown.setAttribute("aria-hidden", "true");
    const sync = () => { shown.textContent = dmy(inp.value) || "dd/mm/aaaa"; wrap.classList.toggle("empty", !inp.value); };
    inp.parentNode.insertBefore(wrap, inp);
    wrap.append(shown, inp);
    inp.addEventListener("input", sync);
    inp.addEventListener("change", sync);
    // En la compu, tocar el campo abre el calendario (en el celular ya lo abre solo).
    inp.addEventListener("click", () => { try { inp.showPicker?.(); } catch { /* algunos navegadores no lo permiten */ } });
    sync();
  }
}

/* ---------------- sesión ---------------- */
function showLogin(msg) {
  $("#app").hidden = true;
  $("#login").hidden = false;
  document.body.style.background = "#eef1f6";
  if (msg) { $("#loginErr").textContent = msg; $("#loginErr").hidden = false; }
  $("#loginForm").username.focus();
}
async function start() {
  const me = await api("GET", "/api/me").catch(() => ({ loggedIn: false }));
  if (!me.loggedIn || me.kind !== "staff") return showLogin(me.kind === "customer" ? "Estás con una sesión de cliente. Entrá con tu usuario del panel." : "");
  P.me = me;
  P.settings = await api("GET", "/api/settings");
  setCurrency(P.settings.currencySymbol);
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#pName").textContent = me.name;
  $("#pRole").textContent = { owner: "DUEÑO", admin: "ADMIN", seller: "VENDEDOR" }[me.role];
  $("#pStore").textContent = P.settings.storeName;
  if (P.settings.hasLogo) $(".plogo i").outerHTML = `<img src="/api/settings/logo" alt="" style="width:32px;height:32px;border-radius:9px;object-fit:cover">`;
  applyTheme();
  softwareNotice();
  go(location.hash.slice(1) || "inicio");
}

/* ---------------- eventos ---------------- */
/** Arma un mensaje de WhatsApp con los accesos (uno o varios, mismo cliente). */
function deliveryMessage(list) {
  if (list.length === 1) return list[0].message;
  const first = list[0].customerFirst || "";
  const blocks = list.map((x) => [`📺 ${x.product}`, `📧 Correo: ${x.email}`, `🔑 Contraseña: ${x.password || "(te la paso aparte)"}`, `👤 Perfil: ${x.profile}`, ...(x.pin ? [`🔢 PIN: ${x.pin}`] : []), `📅 Vence: ${x.expiresText}`].join("\n")).join("\n\n");
  return `¡Hola ${first}! 👋 Acá tenés tus accesos:\n\n${blocks}\n\nCualquier cosa me escribís. ¡Gracias! 🙌`;
}

/** Respuesta lista para "no me entra": los datos actualizados + 3 pasos simples. */
function noEntraMessage(list) {
  const x = list[0], first = x.customerFirst || "";
  const datos = list.map((y) => [`📺 ${y.product}`, `📧 Correo: ${y.email}`, `🔑 Contraseña: ${y.password || "(te la paso aparte)"}`, `👤 Perfil: ${y.profile}`, ...(y.pin ? [`🔢 PIN: ${y.pin}`] : [])].join("\n")).join("\n\n");
  return `¡Hola ${first}! 👋 Probemos así:\n\n1️⃣ Cerrá sesión en el televisor o en el celular.\n2️⃣ Entrá de nuevo con estos datos:\n\n${datos}\n\n3️⃣ Elegí tu perfil${x.pin ? " y poné el PIN" : ""}.\n\nSi sigue sin entrar, mandame una foto del error y lo vemos al toque 🙏`;
}

/** Tarjeta "listo para enviar": muestra los accesos y un botón grande para mandarlos por WhatsApp. */
function showDeliveries(list) {
  list = (list || []).filter(Boolean);
  if (!list.length) return;
  const phone = list[0].customerPhone;
  const msg = deliveryMessage(list);
  const cred = (x) => `<div class="dlv-creds">
      <div><span>📺 Producto</span><b>${esc(x.product)}</b></div>
      <div><span>📧 Correo</span><b class="sel">${esc(x.email)}</b></div>
      <div><span>🔑 Contraseña</span><b class="sel">${esc(x.password || "(pendiente)")}</b></div>
      <div><span>👤 Perfil</span><b class="sel">${esc(x.profile)}</b></div>
      ${x.pin ? `<div><span>🔢 PIN</span><b class="sel">${esc(x.pin)}</b></div>` : ""}
      <div><span>📅 Vence</span><b>${esc(x.expiresText)}</b></div></div>`;
  document.getElementById("dlvScrim")?.remove();
  const el = document.createElement("div");
  el.id = "dlvScrim"; el.className = "dlv-scrim"; el.dataset.msg = msg;
  el.innerHTML = `<div class="dlv-card" role="dialog" aria-modal="true" aria-label="Enviar accesos">
      <div class="dlv-top"><h3>✅ Listo para enviar</h3><button class="pbtn sm" type="button" data-dlvclose aria-label="Cerrar">✕</button></div>
      <p class="muted" style="margin:0">Para <b>${esc(list[0].customerName || "el cliente")}</b>${phone ? ` · ${esc(phone)}` : ""}</p>
      ${list.map(cred).join("")}
      ${list.some((x) => x.passwordPending) ? `<p class="muted" style="margin:0">⚠️ Falta la contraseña de una cuenta: cargala en “Carga de Cuentas” y volvé a enviar.</p>` : ""}
      ${phone ? `<a class="pbtn green big" href="${waLink(phone, msg)}" target="_blank" rel="noopener">${icon("wa")}Enviar por WhatsApp</a>` : `<p class="muted" style="margin:0">Este cliente no tiene WhatsApp cargado. Copiá los datos y mandáselos por donde puedas.</p>`}
      ${phone ? `<a class="pbtn big" href="${waLink(phone, noEntraMessage(list))}" target="_blank" rel="noopener">🙋 Respuesta para “no me entra”</a>` : ""}
      <button class="pbtn big" type="button" data-dlvcopy>📋 Copiar todo</button></div>`;
  el.addEventListener("click", (ev) => { if (ev.target === el) el.remove(); });
  document.body.appendChild(el);
}

// Presupuesto con cupón para la venta manual (se pide al servidor, que es quien decide).
const sellQuote = { key: "", r: null, timer: 0 };
function quoteSell(cid, productId, qty, code, periods = 1) {
  const key = `${cid}|${productId}|${qty}|${code}|${periods}`;
  clearTimeout(sellQuote.timer);
  sellQuote.timer = setTimeout(async () => {
    try {
      const r = await api("POST", "/api/admin/orders/quote", { customerId: cid, items: [{ productId, qty }], couponCode: code, periods });
      Object.assign(sellQuote, { key, r });
    } catch (e) { Object.assign(sellQuote, { key, r: { coupon: null, couponError: e.message } }); }
    sellSummary();
  }, 350);
}

// Resumen en vivo de la venta: se ve exactamente qué se va a cobrar y a quién antes de confirmar.
function sellSummary() {
  const f = $("#sellForm"); if (!f) return;
  const box = $("#sellSummary"), btn = $("#sellBtn");
  const tile = document.querySelector('.selp[aria-pressed="true"]');
  const cname = f.customerName.value.trim();
  const cid = P.tab.custMap?.[cname] || "";
  const ready = !!tile && !!cid;
  if (btn) btn.disabled = !ready;
  if (!ready) { if (box) box.hidden = true; if (btn) btn.innerHTML = `${icon("cart")}Registrar venta`; return; }
  const name = tile.dataset.name, first = cname.split(" · ")[0];
  const price = +tile.dataset.price || 0, qty = Math.max(1, +f.qty.value || 1), months = Math.max(1, +f.periodMonths.value || 1);
  const combo = tile.dataset.kind === "combo";
  const method = f.paymentMethod.value === "balance" ? "Saldo del cliente" : "Efectivo / QR";
  const pay = f.payStatus.value === "pendiente" ? "⏳ Pendiente" : "✅ Pagado";
  const extra = `${qty > 1 ? ` · ${qty}×` : ""}${months > 1 ? ` · ${months} meses` : ""}`;
  const code = (f.couponCode?.value || "").trim().toUpperCase();
  const q = code && sellQuote.key === `${cid}|${f.productId.value}|${qty}|${code}|${months}` ? sellQuote.r : null;
  if (code && !q) quoteSell(cid, f.productId.value, qty, code, months);
  const total = q?.coupon ? q.total : price * qty * months;
  box.hidden = false;
  box.innerHTML = `<div class="sumline"><span>Le vendés a</span><b>${esc(first)}</b></div>
    <div class="sumline"><span>${combo ? "🎁 Combo" : "Producto"}</span><b>${esc(name)}${extra}</b></div>
    <div class="sumline"><span>Cobro</span><b>${method} · ${pay}</b></div>
    ${code ? `<div class="sumline"><span>🏷️ Cupón ${esc(code)}</span><b>${!q ? "revisando…" : q.coupon ? `−${bs(q.coupon.amount)}` : `<span class="cupst bad">${esc(q.couponError)}</span>`}</b></div>` : ""}
    <div class="sumtot"><span>Total a cobrar</span><b>${bs(total)}</b></div>`;
  btn.innerHTML = `${icon("cart")}Vender a ${esc(first)} · ${bs(total)}`;
}
document.addEventListener("input", (ev) => { if (ev.target.form?.id === "sellForm") { if (ev.target.name === "customerName") P.tab.sellCustomer = ev.target.value; sellSummary(); } });
document.addEventListener("change", (ev) => { if (ev.target.form?.id === "sellForm") sellSummary(); });

async function act(fn, okMsg) {
  try {
    const r = await fn();
    if (okMsg) toast(typeof okMsg === "function" ? okMsg(r) : okMsg);
    await render();
    return r;
  } catch (e) {
    if (e.status === 401) return showLogin("Tu sesión venció. Entrá de nuevo.");
    toast(e.message);
  }
}

// Links de WhatsApp de la fila de cobro: al tocarlos queda marcado "✅ avisado".
document.addEventListener("click", (ev) => {
  const a = ev.target.closest("a[data-cobsent]");
  if (a) { (P.tab.cob ??= { on: true, i: 0, sent: {} }).sent[a.dataset.cobsent] = true; setTimeout(render, 300); }
  const b = ev.target.closest("a[data-invsent]");
  if (b && P.tab.inv?.on) { const inv = P.tab.inv; (inv.sent ??= {})[b.dataset.invsent] = true; inv.i++; setTimeout(render, 300); }
});
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button");
  if (!el) return;
  const d = el.dataset;
  if (d.go) return go(d.go);
  if (d.th) { P.theme = d.th; try { localStorage.setItem("gs-panel-theme", P.theme); } catch { /* */ } return applyTheme(); }
  if (d.logout) { await api("POST", "/api/auth/logout", {}); P.me = null; return showLogin(); }
  if (d.dlvclose) { document.getElementById("dlvScrim")?.remove(); return; }
  if (d.dlvcopy) { const s = document.getElementById("dlvScrim"); if (s) { try { await navigator.clipboard.writeText(s.dataset.msg); toast("Datos copiados ✓"); } catch { toast("No se pudo copiar"); } } return; }
  if (d.deliver) { try { const info = await api("GET", `/api/admin/assignments/${d.deliver}/delivery`); showDeliveries([info]); } catch (e) { toast(e.message); } return; }
  if (d.tab) { const i = d.tab.indexOf(":"); P.tab[d.tab.slice(0, i)] = d.tab.slice(i + 1); return render(); }
  if (d.secrets) { P.tab.secrets = !P.tab.secrets; return render(); }
  if (d.qrdel) { const row = el.closest(".qr-row"); const form = row.closest("form"); row.remove(); return form.requestSubmit(); }
  if (d.layout) {
    const f = $("#lookForm");
    if (f) { f.layout.value = d.layout; $$(".laycard").forEach((b) => b.classList.toggle("on", b.dataset.layout === d.layout)); previewLook(); toast("Probando este tipo de tienda: tocá Guardar apariencia para dejarlo"); }
    return;
  }
  if (d.ptheme) {
    const t = THEMES.find((x) => x.id === d.ptheme), f = $("#lookForm");
    for (const [k, v] of Object.entries(t.look)) {
      if (k === "accentColor" || k === "backgroundColor") { $$(`input[name="${k}"]`).forEach((r) => { r.checked = false; r.nextElementSibling.style.borderColor = "transparent"; }); f[k + "Custom"].value = v; }
      else if (k === "accent2Color") { f.accent2Color.value = v; f.accent2Auto.checked = false; }
      else if (f[k]) f[k].value = v;
    }
    previewLook();
    return toast(`Probando “${t.name}”: tocá Guardar apariencia para dejarlo`);
  }
  if (d.hgo) {
    const [v, f, x] = d.hgo.split(":");
    if (v === "control") {
      Object.assign(P.tab, { cf: "todos", cday: "", cpay: "", cq: "", cfrom: undefined, cprod: "", ck: "todos", cr1: undefined, cr2: undefined, cfc: {}, cgroup: undefined });
      if (["today", "bad", "warn", "hold"].includes(f)) P.tab.cf = f;
      if (f === "cobrar") P.tab.cf = "cobrar";
      if (f === "nopay") P.tab.cpay = "debe";
      if (f === "fecha") P.tab.cfrom = Number(x);
      if (x === "mios") P.tab.ck = "fin"; // desde Inicio: solo lo que cobrás vos
    }
    if (v === "revendedores" && f === "invitar") {
      const l = (await api("GET", "/api/admin/resellers").catch(() => null))?.list ?? [];
      P.tab.inv = { on: true, all: false, i: 0, done: {}, sent: {}, ids: l.filter((r) => !r.hasPin).map((r) => r.id) };
    }
    return go(v);
  }
  if (d.cselall) {
    const ids = new Set((P.controlView ?? []).filter((r) => r.customerName === d.cselall).map((r) => r.id));
    $$(".csel").forEach((c) => (c.checked = ids.has(c.value)));
    return updateCtlBar();
  }
  if (d.cbulk) {
    const ids = [...new Set($$(".csel:checked").map((x) => x.value))];
    if (d.cbulk === "clear") { $$(".csel").forEach((c) => (c.checked = false)); return updateCtlBar(); }
    if (!ids.length) return toast("Marcá al menos una");
    if (d.cbulk === "renew") {
      return act(() => api("POST", "/api/admin/assignments/renew-many", { ids, paymentMethod: "cash", batchKey: newKey(), allowBeyondSupplier: !!$("#cbBeyond")?.checked }), (r) => {
        const bad = r.filter((x) => !x.ok);
        return bad.length ? `${r.length - bad.length} renovadas; ${bad.length} no: ${bad[0].error}` : `✅ ${r.length} renovadas`;
      });
    }
    if (d.cbulk === "date") {
      const v = $("#cbDate").value;
      if (!v) return toast("Elegí la fecha");
      const [y, m, dd] = v.split("-").map(Number);
      const at = new Date(y, m - 1, dd, 23, 59).getTime();
      return act(async () => { for (const id of ids) await api("POST", `/api/admin/assignments/${id}/expiry`, { expiresAt: at }); }, `📅 ${ids.length} con fecha ${dd}/${m}/${y}`);
    }
    if (d.cbulk === "paid") return act(async () => { for (const id of ids) await api("POST", `/api/admin/assignments/${id}/control`, { payStatus: "pagado" }); }, `💵 ${ids.length} marcadas como pagadas`);
  }
  if (d.rficha !== undefined) { P.tab.rficha = d.rficha; P.tab.rfp = ""; await render(); scrollTo(0, 0); return; }
  if (d.fgo) { P.tab.fq = d.fgo; return go("fiado"); }
  if (d.ffrom) return act(() => api("POST", `/api/admin/fiado/${d.ffrom}/from-control`, {}), (r) => `➕ ${r.added} alquiler(es) al fiado · ${bs(r.amount)}`);
  if (d.ffromall) {
    const ov = await api("GET", "/api/admin/fiado");
    return act(async () => { let n = 0, amt = 0; for (const r of ov.rows.filter((x) => x.unlinked.count)) { const x = await api("POST", `/api/admin/fiado/${r.customerId}/from-control`, {}); n += x.added; amt += x.amount; } return { n, amt }; }, (r) => `➕ ${r.n} alquiler(es) pasados al fiado · ${bs(r.amt)}`);
  }
  if (d.fdet !== undefined) { P.tab.fdet = P.tab.fdet === d.fdet ? "" : d.fdet; await render(); if (P.tab.fdet) scrollTo(0, 0); return; }
  if (d.fdel) { if (!confirm("¿Borrar este movimiento? Usalo solo si lo anotaste por error.")) return; return act(() => api("POST", `/api/admin/fiado/entry/${d.fdel}/delete`, {}), "Movimiento borrado"); }
  if (d.csort) {
    const [k, dir] = (P.tab.csort ?? "").split(":");
    P.tab.csort = k !== d.csort ? `${d.csort}:asc` : dir === "asc" ? `${d.csort}:desc` : undefined;
    return render();
  }
  if (d.cclear) {
    for (const k of ["cf", "cq", "cday", "cprod", "cpay", "ck", "cfrom", "cr1", "cr2"]) P.tab[k] = undefined;
    P.tab.cfc = {};
    return render();
  }
  if (d.ctlcsv) {
    const H = ["N°", "Cliente", "Tipo", "WhatsApp", "Plataforma", "Correo", "Perfil", "Inicio", "Vencimiento", "Día vence", "Te pagan Bs", "Costo Bs", "Ganancia Bs", "Estado pago", "Estado", "Días restantes", "Revendedor", "Nota"];
    const PAYT = { pagado: "Pagado", pendiente: "Pendiente", no_pago: "No pagó" };
    const lines = [H, ...(P.controlView ?? []).map((r) => [r.n, r.customerName, r.viaRes ? `De ${r.rname}` : r.customerKind === "reseller" ? "Revendedor" : "Mío", r.customerPhone, r.product.replace(/ \(alquiler revendedores\)/, ""), r.email, r.profile, fdate(r.startsAt), fdate(r.customerExpiresAt), r.day, r.price / 100, r.cost / 100, r.gain / 100, PAYT[r.pay], r.est[0], r.d, r.control.seller || r.rname || "", r.control.note ?? ""].map((v, i) => (canReview() || (i !== 11 && i !== 12) ? v : "")))];
    const csv = "\ufeff" + lines.map((l) => l.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(";")).join("\r\n");
    const a = Object.assign(document.createElement("a"), { href: URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" })), download: `control-alquileres-${new Date().toISOString().slice(0, 10)}.csv` });
    a.click(); URL.revokeObjectURL(a.href); return;
  }
  if (d.bulkkind) {
    if (d.bulkkind === "all") {
      if (!confirm("¿Pasar a TODOS tus clientes a revendedores? (Los clientes que cargó un revendedor no se tocan.)")) return;
      return act(() => api("POST", "/api/admin/customers/bulk-kind", { all: true, kind: "reseller" }), (r) => `✅ ${r.changed} pasaron a revendedores${r.skipped.length ? ` · ${r.skipped.length} sin cambiar` : ""}`);
    }
    const ids = $$(".cussel:checked").map((x) => x.value);
    if (!ids.length) return toast("Marcá al menos uno");
    const kind = d.bulkkind === "sel" ? "reseller" : "customer";
    return act(() => api("POST", "/api/admin/customers/bulk-kind", { ids, kind }), (r) => `✅ ${r.changed} cambiados${r.skipped.length ? ` · ${r.skipped.length} no: ${r.skipped[0].name} (${r.skipped[0].reason})` : ""}`);
  }
  if (d.tfa === "setup") {
    try { P.tab.tfa = await api("POST", "/api/admin/me/2fa/setup", {}); render(); } catch (e) { toast(e.message); }
    return;
  }
  if (d.noprodimg) return act(() => api("POST", `/api/admin/products/${d.noprodimg}/image`, { remove: true }), "Logo quitado");
  if (d.shopfeat) return act(() => api("POST", `/api/admin/customers/${d.shopfeat}/shop-feature`, { featured: d.on === "1" }), d.on === "1" ? "Tienda destacada" : "Ya no está destacada");
  if (d.shopblock) {
    const on = d.on === "1";
    if (on && !confirm("¿Bloquear esta página? El revendedor no va a poder mostrarla hasta que la desbloquees.")) return;
    return act(() => api("POST", `/api/admin/customers/${d.shopblock}/shop-block`, { blocked: on }), on ? "Página bloqueada" : "Página desbloqueada");
  }
  if (el.id === "notifOn") { await Notification.requestPermission().catch(() => {}); return render(); }
  if (el.id === "backupNow") return act(() => api("POST", "/api/admin/backups", {}), "Respaldo hecho");
  if (el.id === "offNow") { el.disabled = true; el.textContent = "Guardando…"; return act(() => api("POST", "/api/admin/offsite/send", {}), "Copia guardada en tu Gmail ✓"); }
  if (d.alertseen) return act(() => api("POST", `/api/admin/account-alerts/${d.alertseen}/seen`, {}), "Aviso marcado como visto");
  if (d.aicheck) { el.disabled = true; el.textContent = "🤖 Revisando…"; return act(() => api("POST", `/api/admin/orders/${d.aicheck}/ai-check`, {}), "Revisión lista"); }
  if (el.id === "aiDailyNow") { el.disabled = true; el.textContent = "Armando…"; return act(() => api("POST", "/api/admin/ai/daily", {}), "📋 Reporte listo: está en Inicio"); }
  if (el.id === "pushOn") { el.disabled = true; try { await pushEnable(); toast("🔔 Avisos activados en este celular"); } catch (e) { toast(e.message || "No se pudo activar"); } return render(); }
  if (el.id === "pushOff") { el.disabled = true; await pushDisable(); toast("Avisos apagados en este celular"); return render(); }
  if (el.id === "pushTest") return act(() => api("POST", "/api/admin/push/test", {}), (r) => r.sent ? "Aviso de prueba enviado ✓" : "No se pudo enviar: activá de nuevo los avisos");
  if (el.id === "tgTest") { const form = el.closest("form"); const chatId = form?.chatId.value.trim(); return act(() => api("POST", "/api/admin/telegram/test", chatId ? { chatId } : {}), "Prueba enviada: revisá tu Telegram ✓"); }
  if (el.id === "binTest") { el.disabled = true; el.textContent = "Probando…"; return act(() => api("POST", "/api/admin/binance/test", {}), "Conexión con Binance OK ✓"); }
  if (d.appok) {
    el.disabled = true;
    try {
      const r = await api("POST", `/api/admin/reseller-apps/${d.appok}/approve`, {});
      P.tab.rlink = await resellerKit(r.customerId, r.name, r.phone, r.slug, r.pin);
      toast("Aprobado: mandale su acceso");
      await render(); scrollTo(0, 0);
    } catch (e) { toast(e.message); el.disabled = false; }
    return;
  }
  if (d.appno) {
    if (!confirm("¿Rechazar esta solicitud?")) return;
    try { await api("POST", `/api/admin/reseller-apps/${d.appno}/reject`, {}); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.sendpreset) { const f = $("#mbForm"); if (f) f.senders.value = d.sendpreset; return; }
  if (d.rcode) {
    const r = (await api("GET", "/api/admin/resellers")).list.find((x) => x.id === d.rcode);
    try {
      const k = await api("POST", `/api/admin/customers/${r.id}/code-link`, { keepLink: true });
      const msg = `🔗 ${r.name.split(" ")[0]}, este es tu link para ver los códigos de tus cuentas:\n${k.url}\n\nTus clientes solo escriben el correo de su cuenta y ven su código al toque (sin PIN). Pasáselo a cada cliente.`;
      P.tab.rlink = { name: r.name, phone: r.phone, url: k.url, page: "Sin PIN: cada cliente escribe su correo", msg, code: true };
      await render(); scrollTo(0, 0);
    } catch (e) { toast(e.message); }
    return;
  }
  if (d.rsend) {
    // Generar un PIN nuevo deja afuera al revendedor hasta que le llegue: se pide confirmación.
    if (!confirm(`¿Generar un PIN nuevo para ${d.name || "este revendedor"}?\n\nEl PIN que tiene ahora deja de funcionar al toque y le vas a tener que mandar el nuevo.`)) return;
    const r = (await api("GET", "/api/admin/resellers")).list.find((x) => x.id === d.rsend);
    try { P.tab.rlink = await resellerKit(r.id, r.name, r.phone, r.pageAllowed ? r.shop.slug : undefined); P.tab.rficha = ""; await render(); scrollTo(0, 0); $("#rsent")?.scrollIntoView({ block: "start" }); toast(`✅ PIN nuevo de ${r.name}: ${P.tab.rlink.pin}`); } catch (e) { toast(e.message); }
    return;
  }
  if (d.hidesetup) { P.tab.hideSetup = true; return render(); }
  if (d.unquar) {
    const acc = (await api("GET", "/api/admin/accounts")).find((x) => x.id === d.unquar);
    const q = (acc?.slots ?? []).filter((x) => x.status === "quarantined");
    if (!q.length) return toast("No hay perfiles en cuarentena");
    if (!confirm(`¿Liberar ${q.length} perfil(es) de ${acc.email}? Vuelven a estar disponibles para vender.`)) return;
    return act(async () => { for (const x of q) await api("POST", `/api/admin/slots/${x.id}/status`, { status: "available", note: "Liberado desde Cuentas" }); return q.length; }, (n) => `✅ ${n} perfil(es) liberados`);
  }
  if (d.cob) {
    const cob = (P.tab.cob ??= { on: false, i: 0, sent: {} });
    if (d.cob === "start") { cob.on = true; cob.i = 0; }
    if (d.cob === "next") cob.i++;
    if (d.cob === "stop") { cob.on = false; cob.i = 0; }
    return render();
  }
  if (d.inv) {
    const inv = (P.tab.inv ??= { on: false, all: false, i: 0, done: {} });
    if (d.inv === "all") { inv.all = !inv.all; inv.i = 0; }
    if (d.inv === "start") {
      const l = (await api("GET", "/api/admin/resellers")).list;
      inv.ids = (inv.all ? l : l.filter((r) => !r.hasPin)).map((r) => r.id);
      inv.on = true; inv.i = 0;
    }
    if (d.inv === "stop") { inv.on = false; inv.i = 0; inv.ids = null; }
    if (d.inv === "next") inv.i++;
    if (d.inv === "prev") inv.i = Math.max(0, inv.i - 1);
    if (d.inv === "pin") {
      const r = (await api("GET", "/api/admin/resellers")).list.find((x) => x.id === d.id);
      if (!r) return toast("No encontré a ese revendedor");
      if ((r.hasPin || r.lastLoginAt) && !confirm(`${r.name} ya tiene PIN${r.lastLoginAt ? ` (entró el ${fdate(r.lastLoginAt)})` : ""}. ¿Le genero uno nuevo? El anterior deja de servir.`)) return;
      try { inv.done[r.id] = await resellerKit(r.id, r.name, r.phone, r.pageAllowed ? r.shop.slug : undefined); toast(`🔑 PIN de ${r.name}: ${inv.done[r.id].pin}. Ahora tocá "Abrir WhatsApp"`); } catch (e) { return toast(e.message); }
    }
    return render();
  }
  if (d.togrescat !== undefined && el.dataset.togrescat) {
    const on = d.togrescat === "1";
    try { await api("POST", "/api/admin/settings", { resellerOnlyCatalog: on }); toast(on ? "✅ Tus revendedores ahora ven solo lo de revendedores" : "Tus revendedores ven todo el catálogo"); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.togshops !== undefined && el.dataset.togshops) {
    const on = d.togshops === "1";
    try { await api("POST", "/api/admin/settings", { resellerShops: on }); toast(on ? "✅ Páginas de revendedores activadas" : "Páginas de revendedores apagadas"); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.rpage !== undefined && el.dataset.rpage) {
    const on = !!d.on;
    if (!on && !confirm("¿Quitar la página de este revendedor? Deja de verse su tienda pública; su panel sigue igual. Podés volver a habilitarla cuando quiera.")) return;
    try { await api("POST", `/api/admin/customers/${d.rpage}/reseller-page`, { allowed: on }); toast(on ? "✦ Página habilitada (premium)" : "Página quitada: queda en plan panel"); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.rpub !== undefined && el.dataset.rpub) {
    try { await api("POST", `/api/admin/customers/${d.rpub}/shop`, { enabled: !!d.on }); toast(d.on ? "Página publicada" : "Página apagada"); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.redit) {
    const r = (await api("GET", "/api/admin/resellers")).list.find((x) => x.id === d.redit);
    const slug = prompt("Dirección de su página (letras, números y guiones):", r.shop.slug);
    if (!slug || slug === r.shop.slug) return;
    try { await api("POST", `/api/admin/customers/${d.redit}/shop`, { slug: slug.trim().toLowerCase() }); toast("Dirección cambiada"); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.rtop) {
    // Abre el mini formulario en la tarjeta (monto + motivo, con el saldo antes → después).
    P.tab.rtop = d.rtop; await render();
    const f = document.querySelector(`[data-rtopf="${CSS.escape(d.rtop)}"]`);
    f?.scrollIntoView({ block: "center" }); f?.amount.focus();
    return;
  }
  if (d.mbtest) {
    const f = $("#mbForm");
    el.disabled = true;
    try { const r = await api("POST", "/api/admin/mailboxes/test", mbBody(f)); toast(`Conexión correcta ✓ (${r.messages} correos en la bandeja)`); } catch (e) { toast(e.message); }
    el.disabled = false;
    return;
  }
  if (d.mbcheck) {
    el.disabled = true;
    try { const r = await api("POST", `/api/admin/mailboxes/${d.mbcheck}/check`, {}); toast(r.errors ? `Error: ${r.mailbox?.lastError ?? "no se pudo leer"}` : `Listo: ${r.found} código(s) nuevo(s)`); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.mbdel) {
    if (!confirm("¿Quitar este correo? Dejan de leerse sus códigos.")) return;
    try { await api("POST", `/api/admin/mailboxes/${d.mbdel}/delete`, {}); toast("Correo quitado"); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.editprod !== undefined) { P.tab.editProduct = d.editprod || null; await render(); return scrollTo(0, 0); }
  if (d.chat) { P.tab.chat = d.chat; P.tab.waOpen = true; return render(); }
  if (d.waback) { P.tab.waOpen = false; return render(); }
  if (d.human) return act(() => api("POST", `/api/admin/whatsapp/chats/${encodeURIComponent(d.human)}/human`, { on: d.on === "1" }), d.on === "1" ? "Atendés vos: el bot no contesta en esta charla" : "El bot vuelve a contestar en esta charla");
  if (d.waflush) return act(() => api("POST", "/api/admin/whatsapp/flush", {}), (r) => `Enviados ${r.sent}, fallidos ${r.failed}, reintentando ${r.pending}`);
  if (d.importsvccancel) { P.tab.importSvc = null; return render(); }
  if (d.importsvcgo) {
    el.disabled = true;
    try {
      const result = await api("POST", "/api/admin/import/services", { contentBase64: P.tab.importSvc.b64, dryRun: false });
      P.tab.importSvc = { b64: null, result };
      toast(`${result.summary.ok} servicio(s) importados`);
    } catch (e) { toast(e.message); }
    return render();
  }
  if (d.importcancel) { P.tab.import = null; return render(); }
  if (d.importgo) {
    el.disabled = true;
    try {
      const result = await api("POST", "/api/admin/import/customers", { contentBase64: P.tab.import.b64, dryRun: false });
      P.tab.import = { b64: null, result };
      toast(`${result.created} cliente(s) importados`);
    } catch (e) { toast(e.message); }
    return render();
  }
  if (d.editaccopen !== undefined) { P.tab.editAcc = d.editaccopen || null; if (P.tab.editAcc && !P.tab.secrets) P.tab.secrets = true; await render(); return scrollTo(0, 0); }
  if (d.editcus !== undefined) { P.tab.editCus = d.editcus || null; await render(); return scrollTo(0, 0); }
  if (d.slotfree) { if (!confirm("¿Poner este perfil libre para vender? Deja de contar para el cliente que lo tenía.")) return; return act(() => api("POST", `/api/admin/slots/${d.slotfree}/status`, { status: "available", note: "revisado desde el panel" }), "Perfil liberado: ya se puede vender"); }
  if (d.slotact !== undefined) { P.tab.slotAct = d.slotact || null; await render(); return scrollTo(0, 0); }
  if (d.slotrelease) {
    if (!confirm("¿Liberar este perfil? Deja de contar para ese cliente y queda libre para vender.")) return;
    try { await api("POST", `/api/admin/slots/${d.slotrelease}/free`, { reason: "liberado desde Cuentas" }); P.tab.slotAct = null; toast("Perfil liberado ✓"); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.ledger !== undefined) { P.tab.ledger = d.ledger || null; await render(); return scrollTo(0, 0); }
  if (d.copy) { try { await navigator.clipboard.writeText(d.copy); toast("Copiado"); } catch { toast("Copialo a mano"); } return; }
  if (d.link) {
    if (!confirm(`¿Generar un PIN nuevo para ${d.name || "este cliente"}?\n\nEl PIN que tiene ahora deja de funcionar al toque.`)) return;
    const r = await act(() => api("POST", `/api/admin/customers/${d.link}/login-pin`, {}));
    if (r) {
      const c = (await api("GET", "/api/admin/customers")).find((x) => x.id === d.link);
      P.tab.link = { url: `${location.origin}${c.kind === "reseller" ? "/" : "/tienda/"}`, name: c.name, phone: c.phone, pin: r.pin };
      await render(); scrollTo(0, 0);
    }
    return;
  }
  if (d.pick) {
    const f = $("#sellForm");
    if (!f) return;
    f.productId.value = d.pick;
    f.slotId.value = "";
    $$(".selp").forEach((x) => x.setAttribute("aria-pressed", x.dataset.pick === d.pick ? "true" : "false"));
    const n = +el.dataset.stock;
    const full = el.dataset.kind === "full_account";
    const rule = (el.dataset.rule || "").trim();
    $("#sellNote").innerHTML = (rule ? `<div class="salerule">📌 <b>Antes de vender:</b> ${esc(rule)}</div>` : "") + (full
      ? `Vendés <b>${esc(el.dataset.name)}</b> — se entrega la <b>cuenta completa</b>${n ? ` (${n} disponible${n > 1 ? "s" : ""})` : ""}.`
      : `Vendés <b>${esc(el.dataset.name)}</b>. Se asigna solo un perfil libre${n ? ` (quedan ${n})` : ""} y el aviso queda listo en WhatsApp.`);
    $("#sellNote").classList.add("on");
    sellSummary();
    // Perfiles libres de ese producto para elegir a mano (opcional).
    const estadoK = { available: "Libre" };
    const accs = (P.tab.sellAccts ?? []).filter((a) => a.productId === d.pick && a.status === "active" && a.slots.some((s) => s.status === "available"));
    const pp = $("#profPick");
    if (!accs.length) { pp.hidden = true; pp.innerHTML = ""; return; }
    pp.hidden = false;
    pp.innerHTML = `<div class="ppsec">🎯 ${full ? "¿Qué cuenta?" : "¿De qué cuenta/perfil?"} <small class="muted">opcional</small></div>
      <div class="ppchips"><button type="button" class="ppchip on" data-slot="">⚡ Automático <small>(el que vence antes)</small></button>
      ${accs.map((a) => a.slots.filter((s) => s.status === "available").map((s) => `<button type="button" class="ppchip" data-slot="${esc(s.id)}"><b>${esc(s.label)}</b><small>${esc(a.email)}</small></button>`).join("")).join("")}</div>`;
    return;
  }
  if (d.slot !== undefined && el.classList.contains("ppchip")) {
    const f = $("#sellForm");
    if (f) f.slotId.value = d.slot;
    $$("#profPick .ppchip").forEach((x) => x.classList.toggle("on", x.dataset.slot === d.slot));
    const em = el.querySelector("small")?.textContent, lb = el.querySelector("b")?.textContent;
    if (f && em && lb) { $("#sellNote").innerHTML = `Vas a entregar <b>${esc(lb)}</b> de <b>${esc(em)}</b>.`; $("#sellNote").classList.add("on"); }
    sellSummary();
    return;
  }
  if (d.period !== undefined && el.dataset.period) {
    const f = $("#sellForm"); if (f) f.periodMonths.value = d.period;
    $$(".periodseg button").forEach((x) => x.setAttribute("aria-pressed", String(x === el)));
    sellSummary();
    return;
  }
  if (d.pay) {
    const f = $("#sellForm"); if (f) f.payStatus.value = d.pay;
    $$(".payseg button").forEach((x) => x.setAttribute("aria-pressed", String(x === el)));
    sellSummary();
    return;
  }
  if (d.paid) return act(() => api("POST", `/api/admin/assignments/${d.paid}/control`, { payStatus: "pagado" }), "💵 Marcado como cobrado");
  if (d.wastest) {
    if (!confirm(`¿La venta de ${el.dataset.name || "este cliente"} era una prueba?\n\nSe cierra el servicio (y los otros de esa misma venta), el perfil vuelve a estar libre y la venta sale de tus números. No se le avisa a nadie.`)) return;
    return act(() => api("POST", `/api/admin/assignments/${d.wastest}/test`, {}), (r) => `🧪 Listo: venta de ${bs(r.total)} marcada como prueba · ${r.closed} perfil(es) libre(s)${r.refundedUsd ? ` · ${usd(r.refundedUsd)} vuelven a su saldo en dólares` : r.refunded ? ` · ${bs(r.refunded)} vuelven al saldo` : ""}`);
  }
  if (d.refund) {
    if (!confirm(`¿Devolver a ${el.dataset.name || "este cliente"} la parte proporcional por los días que faltan?\n\nSe cierra el servicio, se libera el cupo y la plata va a su saldo.`)) return;
    return act(() => api("POST", `/api/admin/assignments/${d.refund}/refund`, {}), (r) => `↩️ Devueltos ${wal(r.amount, r.currency)} al saldo (${r.remaining} días que faltaban)`);
  }
  if (d.pmedit !== undefined) { P.tab.pmEdit = d.pmedit || null; return render(); }
  if (d.pmqrdel) return act(() => api("POST", `/api/admin/paymethods/${d.pmqrdel}/qr`, { remove: true }), "QR quitado");
  if (d.pmdel) {
    if (!confirm(`¿Borrar el método ${el.dataset.name}?\n\nLos pedidos que ya lo usaron no cambian.`)) return;
    if (P.tab.pmEdit === d.pmdel) P.tab.pmEdit = null;
    return act(() => api("POST", `/api/admin/paymethods/${d.pmdel}/delete`, {}), "Método borrado");
  }
  if (d.cupedit !== undefined) { P.tab.couponEdit = d.cupedit || null; return render(); }
  if (d.cuptoggle) {
    const c = (await api("GET", "/api/admin/coupons")).find((x) => x.id === d.cuptoggle);
    if (!c) return;
    const { uses, state, ...body } = c;
    return act(() => api("POST", "/api/admin/coupons", { ...body, active: !c.active }), c.active ? `Cupón ${c.code} pausado` : `Cupón ${c.code} activo`);
  }
  if (d.cupdel) {
    if (!confirm(`¿Borrar el cupón ${el.dataset.name}?\n\nLos pedidos que ya lo usaron no cambian.`)) return;
    if (P.tab.couponEdit === d.cupdel) P.tab.couponEdit = null;
    return act(() => api("POST", `/api/admin/coupons/${d.cupdel}/delete`, {}), "Cupón borrado");
  }
  if (d.rmexp) {
    if (!confirm("¿Quitar este gasto?")) return;
    return act(() => api("POST", `/api/admin/expenses/${d.rmexp}/remove`, {}), "Gasto quitado");
  }
  if (d.relocate) {
    if (!confirm(`¿Mover a ${el.dataset.name || "este cliente"} a una cuenta sana?\n\nConserva su fecha de vencimiento y el perfil viejo queda retirado.`)) return;
    return act(() => api("POST", `/api/admin/assignments/${d.relocate}/relocate`, { reason: "Reubicación: cuenta caída" }), "✅ Cliente reubicado a una cuenta sana");
  }
  if (d.renew) {
    if (el.dataset.renewinfo && !confirm(el.dataset.renewinfo)) return;
    return act(() => api("POST", `/api/admin/assignments/${d.renew}/renew`, { paymentMethod: "cash", idempotencyKey: newKey() }), (r) => `✅ Renovado hasta ${fdate(r.assignment.customerExpiresAt)}`);
  }
  if (d.renewsel) {
    const ids = $$(".sel:checked").map((x) => x.value);
    if (!ids.length) return toast("Marcá al menos un servicio");
    return act(() => api("POST", "/api/admin/assignments/renew-many", { ids, paymentMethod: "cash", batchKey: newKey() }), (r) => {
      const bad = r.filter((x) => !x.ok);
      return bad.length ? `${r.length - bad.length} renovados, ${bad.length} no: ${bad[0].error}` : `${r.length} servicios renovados`;
    });
  }
  if (d.remind) return act(() => api("POST", "/api/admin/reminders", { withinDays: +d.remind }), (r) => r.queued ? `${r.queued} recordatorios listos en WhatsApp` : "No hay recordatorios nuevos para preparar");
  if (d.nobanner) return act(() => api("POST", "/api/admin/settings/banner/remove", {}), "Portada quitada");
  if (d.nologo) return act(() => api("POST", "/api/admin/settings/logo/remove", {}), "Logo quitado");
  if (d.sent) return act(() => api("POST", `/api/admin/outbox/${d.sent}/sent`, {}), "Marcado como enviado");
  if (d.staff) return act(() => api("POST", `/api/admin/staff/${d.staff}/active`, { active: d.on === "1" }), d.on === "1" ? "Usuario activado" : "Usuario desactivado: se cerró su sesión");
  if (d.asis) {
    if (d.asis === "off") { if (!confirm("¿Apagar el acceso del asistente? Deja de poder entrar al instante.")) return; return act(() => api("POST", "/api/admin/assistant/off", {}), "⛔ Acceso del asistente apagado"); }
    if (!confirm("¿Crear la llave para tu asistente? Si ya había una, la anterior deja de servir.")) return;
    try { const r = await api("POST", "/api/admin/assistant", {}); P.tab.asisKey = r.token; await render(); scrollTo(0, 0); } catch (e) { toast(e.message); }
    return;
  }
  if (d.supdel) {
    if (!confirm(`¿Borrar el proveedor "${d.name}"? ${+d.n ? `Sus ${d.n} cuenta(s) pasan a "Propias" (las tuyas). ` : ""}No se pierde ninguna cuenta ni cliente.`)) return;
    return act(() => api("POST", `/api/admin/suppliers/${d.supdel}/delete`, {}), (r) => `🗑️ Proveedor borrado${r.moved ? ` · ${r.moved} cuenta(s) ahora son tuyas` : ""}`);
  }
  if (d.supactive) {
    const s = (await api("GET", "/api/admin/suppliers")).find((x) => x.id === d.supactive);
    return act(() => api("POST", "/api/admin/suppliers", { ...s, active: d.on === "1" }), "Proveedor actualizado");
  }
});

/* Cargar saldo: muestra el saldo antes → después y deja el botón con el texto exacto de lo que va a hacer. */
document.addEventListener("input", (ev) => {
  const f = ev.target.closest?.("form[data-rtopf]");
  if (!f || ev.target.name !== "amount") return;
  const v = toCents(ev.target.value || "0"), bal = Number(f.dataset.bal), name = f.dataset.name.split(" ")[0];
  const prev = f.querySelector(".rtopprev"), btn = f.querySelector('button[type="submit"]');
  const ok = Number.isFinite(v) && v !== 0, m = (c) => wal(c, f.dataset.cur);
  prev.className = `rtopprev ${ok && v < 0 ? "neg" : ""}`;
  prev.innerHTML = `Saldo de ${esc(name)}: <b>${m(bal)}</b> → <b>${ok ? m(bal + v) : "…"}</b>${ok && v < 0 ? ` <span class="pp pp-bad">Descuento de ${m(-v)}</span>` : ""}`;
  btn.disabled = !ok;
  btn.className = `pbtn ${ok && v < 0 ? "danger" : "dark"}`;
  btn.textContent = !ok ? "Escribí el monto" : v < 0 ? `Confirmar: descontarle ${bs(-v)} a ${name}` : `Confirmar: cargarle ${bs(v)} a ${name}`;
});

/** Manda el estilo del formulario a las vistas previas (sin guardar). */
function previewLook() {
  const f = $("#lookForm");
  if (!f) return;
  const look = { accentColor: f.querySelector('input[name="accentColor"]:checked')?.value || f.accentColorCustom.value, backgroundColor: f.querySelector('input[name="backgroundColor"]:checked')?.value || f.backgroundColorCustom.value,
    accent2Color: f.accent2Auto.checked ? "" : f.accent2Color.value };
  for (const k of ["fontFamily", "headingFont", "bgStyle", "cardStyle", "corners", "layout", "storeHours", "heroTitle", "heroHighlight", "heroText", "announcement", "heroChip", "heroTicks", "footerText", "instagram", "tiktok", "facebook"]) look[k] = f[k]?.value;
  $$("iframe[data-look]").forEach((fr) => { try { fr.contentWindow.postMessage({ type: "gs-look", look }, location.origin); } catch { /* cargando */ } });
  const w = $("#lookWarn");
  if (w) { const n = contrastNote(look); w.className = "lookwarn " + n.cls; w.textContent = n.text; }
}
let lookTimer, cqTimer;
let cfTimer;
document.addEventListener("input", (ev) => {
  const k = ev.target.dataset?.cfcol;
  if (!k) return;
  (P.tab.cfc ??= {})[k] = ev.target.value;
  clearTimeout(cfTimer);
  cfTimer = setTimeout(async () => { await render(); const f = document.querySelector(`[data-cfcol="${k}"]`); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 400);
});
document.addEventListener("input", (ev) => {
  if (ev.target.id !== "cq") return;
  P.tab.cq = ev.target.value;
  clearTimeout(cqTimer);
  cqTimer = setTimeout(async () => { await render(); const f = $("#cq"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 300);
});
// Arrastrar y soltar un Excel/CSV en las zonas de importación.
document.addEventListener("dragover", (ev) => { const dz = ev.target.closest?.(".dropzone"); if (dz) { ev.preventDefault(); dz.classList.add("over"); } });
document.addEventListener("dragleave", (ev) => { const dz = ev.target.closest?.(".dropzone"); if (dz) dz.classList.remove("over"); });
document.addEventListener("drop", (ev) => { const dz = ev.target.closest?.(".dropzone"); if (!dz) return; ev.preventDefault(); dz.classList.remove("over"); const inp = dz.querySelector('input[type="file"]'); if (inp && ev.dataTransfer?.files?.length) { inp.files = ev.dataTransfer.files; inp.dispatchEvent(new Event("change", { bubbles: true })); } });
document.addEventListener("change", (ev) => { const inp = ev.target; if (inp?.type === "file") { const dz = inp.closest?.(".dropzone"); if (dz) { const n = dz.querySelector(".dzname"); if (n) n.textContent = inp.files[0] ? "✅ " + inp.files[0].name : ""; } } });
// Al cambiar el tipo de producto, mostrar las apps del combo o los perfiles por defecto.
document.addEventListener("input", (ev) => { const t = ev.target; if (t?.type === "color") { const o = t.parentElement?.querySelector(".hex"); if (o) o.textContent = t.value; } });
document.addEventListener("change", (ev) => { if (ev.target?.name === "kind" && ev.target.form?.id === "prodForm") { const combo = ev.target.value === "combo"; ev.target.form.querySelector(".combo-only")?.toggleAttribute("hidden", !combo); ev.target.form.querySelector(".noncombo-only")?.toggleAttribute("hidden", combo); } });
document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t?.name === "mode" && t.form?.id === "iptvForm") {
    const m = t.value, f = t.form;
    f.querySelector(".iptv-xtream")?.toggleAttribute("hidden", m !== "xtream");
    f.querySelector(".iptv-mac")?.toggleAttribute("hidden", m !== "mac");
    const secret = f.querySelector(".iptv-secret input");
    if (secret) secret.placeholder = m === "m3u" ? "pegá el enlace M3U completo" : m === "code" ? "el código de activación" : m === "mac" ? "clave del portal (si tiene)" : "la clave de la línea";
    const sl = f.querySelector(".iptv-secret"); if (sl) { const lbl = sl.childNodes[0]; if (lbl) lbl.textContent = m === "m3u" ? "Enlace M3U" : m === "code" ? "Código de activación" : "Clave de la línea"; }
    if (m === "mac" || m === "code") secret.required = false; else secret.required = true;
  }
});

let rqTimer, accqTimer;
document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "rq") {
    P.tab.rq = t.value; clearTimeout(rqTimer);
    rqTimer = setTimeout(async () => { await render(); const f = $("#rq"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 300);
  }
  if (t.id === "accq") {
    P.tab.accq = t.value; clearTimeout(accqTimer);
    accqTimer = setTimeout(async () => { await render(); const f = $("#accq"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 300);
  }
  if (t.dataset.slugsrc && t.form) {
    const slug = t.value.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 30);
    t.form.slug.placeholder = slug || "ari-streaming";
    t.form.title.placeholder = t.value.slice(0, 40) || "Ari Streaming";
  }
});
document.addEventListener("input", (ev) => { if (ev.target.form?.id === "lookForm") { clearTimeout(lookTimer); lookTimer = setTimeout(previewLook, 150); } });

function updateCtlBar() {
  const bar = $("#ctlBar");
  if (!bar) return;
  const n = new Set($$(".csel:checked").map((x) => x.value)).size;
  $("#ctlN").textContent = n;
  bar.hidden = !n;
}
document.addEventListener("change", async (ev) => {
  const t = ev.target;
  if (t.name === "customerId" && t.form?.id === "slotAssign") { const nc = t.form.querySelector(".newcli"); if (nc) nc.hidden = t.value !== "__new"; return; }
  if (t.name === "productId" && t.form?.id === "quickForm") { const defs = P.tab.prodDefaults?.[t.value]; const full = P.tab.prodKind?.[t.value] === "full_account"; const s = `${t.value} ${t.selectedOptions[0]?.textContent ?? ""}`.toLowerCase(); const n = defs?.length ? defs.length : full ? 1 : /disney/.test(s) ? 7 : /prime|amazon/.test(s) ? 6 : 5; t.form.n.value = n; const btn = t.form.querySelector('[type="submit"]'); if (btn) btn.textContent = full ? `＋ Agregar cuenta completa` : `＋ Agregar cuenta (${n} perfiles libres)`; return; }
  if (t.name === "n" && t.form?.id === "quickForm") { const btn = t.form.querySelector('[type="submit"]'); if (btn) btn.textContent = `＋ Agregar cuenta (${Math.max(1, +t.value || 1)} perfiles libres)`; return; }
  if (t.name === "mode" && t.form?.id === "offForm") { P.tab.offOwn = t.value === "own"; return render(); }
  if (t.id === "resPlan") { const box = document.getElementById("resPageFields"); if (box) box.hidden = t.value !== "page"; return; }
  if (t.classList?.contains("csel")) {
    $$(`.csel[value="${t.value}"]`).forEach((c) => (c.checked = t.checked));
    return updateCtlBar();
  }
  if (t.id === "cusAll") { $$(".cussel").forEach((c) => (c.checked = t.checked)); return; }
  if (t.id === "cselAllT") { $$(".csel").forEach((c) => (c.checked = t.checked)); return updateCtlBar(); }
  if (t.dataset?.ctl) {
    const f = t.dataset.f;
    let v = t.value.trim();
    if (f === "price" || f === "cost") { v = v === "" ? null : toCents(v); if (v !== null && Number.isNaN(v)) return toast("Solo números"); }
    try { await api("POST", `/api/admin/assignments/${t.dataset.ctl}/control`, { [f]: v }); toast("Guardado"); if (f !== "note" && f !== "seller") render(); }
    catch (e) { toast(e.message); }
    return;
  }
  if (t.id === "cday" || t.id === "cprod" || t.id === "cpay") { P.tab[t.id] = t.value; return render(); }
  if (t.id === "fq") { P.tab.fq = t.value; return render(); }
  if (t.id === "csortSel" || t.id === "cgroup") { P.tab[t.id === "csortSel" ? "csort" : "cgroup"] = t.value || undefined; return render(); }
  if (t.id === "cr1" || t.id === "cr2") { if (t.value) { const [y, mo, da] = t.value.split("-").map(Number); P.tab[t.id] = new Date(y, mo - 1, da).getTime(); } else P.tab[t.id] = undefined; return render(); }
  if (t.dataset?.ccol) {
    let hid = [];
    try { hid = JSON.parse(localStorage.getItem("gs-ctl-hide") || "[]"); } catch { /* sin almacenamiento */ }
    hid = t.checked ? hid.filter((x) => x !== t.dataset.ccol) : [...new Set([...hid, t.dataset.ccol])];
    try { localStorage.setItem("gs-ctl-hide", JSON.stringify(hid)); } catch { /* sin almacenamiento */ }
    P.tab.colsOpen = true;
    return render();
  }
  if (t.dataset?.cexp) {
    if (!t.value) return;
    const [y, m, d] = t.value.split("-").map(Number);
    return act(() => api("POST", `/api/admin/assignments/${t.dataset.cexp}/expiry`, { expiresAt: new Date(y, m - 1, d, 23, 59).getTime() }), `Nueva fecha: ${d}/${m}/${y}`);
  }
  if (t.dataset?.cphone) {
    const raw = t.value.trim();
    if (!raw) return toast("El WhatsApp no puede quedar vacío");
    const phone = /^\d{8}$/.test(raw.replace(/\s/g, "")) ? `+591${raw.replace(/\s/g, "")}` : raw;
    return act(() => api("POST", `/api/admin/customers/${t.dataset.cphone}`, { phone }), "WhatsApp guardado");
  }
  if (t.dataset?.cslot) {
    if (!t.value.trim()) return toast("El perfil necesita un nombre");
    return act(() => api("POST", `/api/admin/slots/${t.dataset.cslot}`, { label: t.value.trim() }), "Perfil guardado");
  }
  if (t.id === "cfromDate") { if (t.value) { const [y, mo, da] = t.value.split("-").map(Number); P.tab.cfrom = new Date(y, mo - 1, da).getTime(); } else P.tab.cfrom = undefined; return render(); }
  if (ev.target.form?.id === "lookForm") setTimeout(previewLook, 0);
  if (ev.target.id === "alwaysAvailable") act(() => api("POST", "/api/admin/settings", { alwaysAvailable: ev.target.checked }), ev.target.checked ? "✅ La tienda muestra todo como Disponible" : "La tienda vuelve a mostrar el stock real");
  if (ev.target.id === "resellerProgramPrices") act(() => api("POST", "/api/admin/settings", { resellerProgramPrices: ev.target.checked }), ev.target.checked ? "La tabla de ganancias se muestra" : "La tabla de ganancias quedó oculta");
  if (ev.target.id === "resellerShops") act(() => api("POST", "/api/admin/settings", { resellerShops: ev.target.checked }), ev.target.checked ? "Los revendedores ya pueden publicar su página" : "Páginas de revendedores apagadas");
  if (ev.target.id === "days") { P.tab.days = +ev.target.value; render(); }
  // Marca visual del color elegido en Apariencia (se aplica al guardar).
  if (ev.target.name === "accentColor" || ev.target.name === "backgroundColor") {
    $$(`input[name="${ev.target.name}"]`).forEach((r) => (r.nextElementSibling.style.borderColor = r.checked ? "var(--ink)" : "transparent"));
    $(`input[name="${ev.target.name}Custom"]`).value = ev.target.value;
  }
  if (ev.target.name === "accentColorCustom" || ev.target.name === "backgroundColorCustom") {
    $$(`input[name="${ev.target.name.replace("Custom", "")}"]`).forEach((r) => { r.checked = false; r.nextElementSibling.style.borderColor = "transparent"; });
  }
  if (ev.target.id === "selAll") $$(".sel").forEach((c) => (c.checked = ev.target.checked));
});

document.addEventListener("submit", async (ev) => {
  ev.preventDefault();
  const f = ev.target;
  const btn = f.querySelector('[type="submit"]');
  if (f.id === "loginForm") {
    btn.disabled = true;
    try {
      try {
        await api("POST", "/api/auth/staff/login", { username: f.username.value, password: f.password.value, code: f.code?.value || undefined });
      } catch (err) {
        if (err.code === "TOTP_REQUIRED" && !f.code) {
          f.password.closest("label").insertAdjacentHTML("afterend", `<label>Código de verificación (6 dígitos)<input name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label>`);
          f.code.focus();
        }
        throw err;
      }
      f.reset(); $("#loginErr").hidden = true;
      await start();
    } catch (e) { $("#loginErr").textContent = e.message; $("#loginErr").hidden = false; }
    btn.disabled = false;
    return;
  }
  if (btn) btn.disabled = true;
  const done = () => { if (btn) btn.disabled = false; };
  try {
    if (f.dataset.tkt) {
      const status = ev.submitter?.value || "revisando";
      await act(() => api("POST", `/api/admin/tickets/${f.dataset.tkt}`, { status, reply: f.reply.value }), { recibido: "Marcada como recibida", revisando: "🔧 En revisión: ya le avisamos", solucionado: "✅ Solucionada: ya le avisamos" }[status]);
      return done();
    }
    if (f.id === "slotAssign") {
      let customerId = f.customerId.value;
      if (!customerId) { toast("Elegí un cliente o creá uno nuevo"); return; }
      if (customerId === "__new") {
        const name = f.newName.value.trim(), phone = f.newPhone.value.trim();
        if (!name) { toast("Escribí el nombre del cliente"); return; }
        const c = await api("POST", "/api/admin/customers", { name, phone: phone || undefined, allowNoPhone: !phone });
        customerId = c.id;
      }
      try {
        const o = await api("POST", "/api/admin/orders", { customerId, items: [{ productId: f.dataset.prod, qty: 1 }], paymentMethod: f.paymentMethod.value, idempotencyKey: newKey(), preferredSlotIds: [f.dataset.slot] });
        const aid = o.assignmentIds?.[0];
        if (aid) {
          if (f.endDate.value) { const [y, m, d] = f.endDate.value.split("-").map(Number); await api("POST", `/api/admin/assignments/${aid}/expiry`, { expiresAt: new Date(y, m - 1, d, 23, 59).getTime() }); }
          if (f.startDate.value) { const [y, m, d] = f.startDate.value.split("-").map(Number); await api("POST", `/api/admin/assignments/${aid}/control`, { startedAt: new Date(y, m - 1, d, 0, 0).getTime() }); }
        }
        const info = aid ? await api("GET", `/api/admin/assignments/${aid}/delivery`).catch(() => null) : null;
        toast("✅ Perfil asignado con sus fechas");
        P.tab.slotAct = null;
        await render();
        if (info) showDeliveries([info]);
      } catch (e) {
        if (e.status === 401) return showLogin("Tu sesión venció. Entrá de nuevo.");
        toast(e.message); if (btn) btn.disabled = false;
      }
      return;
    }
    if (f.id === "sellForm") {
      if (!f.productId.value) { toast("Elegí un producto"); return; }
      const cid = P.tab.custMap?.[f.customerName.value.trim()] || "";
      if (!cid) { toast("Escribí y elegí un cliente de la lista"); return; }
      const pname = document.querySelector('.selp[aria-pressed="true"] b')?.textContent ?? "el producto";
      const months = Math.max(1, +f.periodMonths.value || 1), payStatus = f.payStatus.value || "pagado";
      if (btn) btn.disabled = true;
      try {
        const o = await api("POST", "/api/admin/orders", { customerId: cid, items: [{ productId: f.productId.value, qty: +f.qty.value }], paymentMethod: f.paymentMethod.value, idempotencyKey: f.dataset.key, ...(f.slotId.value ? { preferredSlotIds: [f.slotId.value] } : {}), ...(f.couponCode?.value.trim() ? { couponCode: f.couponCode.value.trim() } : {}), ...(months > 1 ? { periods: months } : {}) });
        for (const id of (o.assignmentIds ?? [])) {
          if (payStatus) await api("POST", `/api/admin/assignments/${id}/control`, { payStatus }).catch(() => {});
        }
        const deliveries = [];
        for (const id of (o.assignmentIds ?? [])) { const info = await api("GET", `/api/admin/assignments/${id}/delivery`).catch(() => null); if (info) deliveries.push(info); }
        toast(`✅ Venta registrada: ${pname}`);
        P.tab.sellCustomer = ""; P.tab.sellKind = "apps";
        await render();
        if (deliveries.length) showDeliveries(deliveries);
        else toast("Venta sin perfil asignado (quedó a pedido). Revisá Aprobación.");
      } catch (e) {
        if (e.status === 401) return showLogin("Tu sesión venció. Entrá de nuevo.");
        toast(e.message);
        if (btn) btn.disabled = false;
      }
      return;
    } else if (f.dataset.approve) {
      await act(() => api("POST", `/api/admin/orders/${f.dataset.approve}/approve`, { confirmedReference: f.ref.value, idempotencyKey: newKey() }), "Pago aprobado y servicio entregado");
    } else if (f.dataset.reject) {
      await act(() => api("POST", `/api/admin/orders/${f.dataset.reject}/reject`, { reason: f.reason.value }), "Pedido rechazado: el stock volvió a estar libre");
    } else if (f.dataset.replace) {
      await act(() => api("POST", `/api/admin/assignments/${f.dataset.replace}/replace`, { reason: f.reason.value, otherAccount: f.other.checked }), "Perfil reemplazado: el cliente conserva su fecha");
    } else if (f.id === "remForm") {
      const daysBefore = [...f.querySelectorAll('input[name="d"]:checked')].map((x) => +x.value);
      await act(() => api("POST", "/api/admin/reminders/settings", { enabled: f.enabled.checked, daysBefore, fromHour: +f.fromHour.value, toHour: +f.toHour.value }),
        daysBefore.length ? `Listo: avisos ${daysBefore.map((d) => (d ? `${d} día(s) antes` : "el mismo día")).join(" y ")}` : "Guardado (sin días marcados no sale ningún aviso)");
    } else if (f.id === "waReply") {
      await act(() => api("POST", `/api/admin/whatsapp/chats/${encodeURIComponent(f.dataset.phone)}/reply`, { text: f.text.value }), "Mensaje enviado");
    } else if (f.id === "waSecrets") {
      const body = {};
      if (f.accessToken.value) body.accessToken = f.accessToken.value;
      if (f.appSecret.value) body.appSecret = f.appSecret.value;
      if (!Object.keys(body).length) throw new Error("Pegá el token o el App Secret");
      await act(() => api("POST", "/api/admin/whatsapp/secrets", body), "Claves guardadas");
    } else if (f.id === "waConfig") {
      await act(() => api("POST", "/api/admin/whatsapp/config", { enabled: f.enabled.checked, phoneNumberId: f.phoneNumberId.value.trim(), apiVersion: f.apiVersion.value.trim(), humanPauseHours: +f.humanPauseHours.value, welcome: f.welcome.value }), "Bot guardado");
    } else if (f.id === "hmSearch") {
      Object.assign(P.tab, { cf: "todos", cday: "", cpay: "", cfrom: undefined, cq: f.q.value.trim() });
      go("control");
    } else if (f.dataset.expiry) {
      const [y, m, d] = f.date.value.split("-").map(Number);
      await act(() => api("POST", `/api/admin/assignments/${f.dataset.expiry}/expiry`, { expiresAt: new Date(y, m - 1, d, 23, 59).getTime() }), `Nueva fecha: ${d}/${m}/${y}`);
    } else if (f.id === "prodImg") {
      await act(async () => api("POST", `/api/admin/products/${f.dataset.id}/image`, { contentBase64: await fileToBase64(f.file.files[0]) }), "Logo actualizado");
    } else if (f.id === "testiForm") {
      const items = [...f.querySelectorAll(".tr-row")].map((r) => ({ name: r.querySelector('[name="tn"]').value.trim(), business: r.querySelector('[name="tb"]').value.trim(), text: r.querySelector('[name="tt"]').value.trim(), rating: r.querySelector('[name="tr"]').value }))
        .filter((t) => t.text);
      await act(() => api("POST", "/api/admin/testimonials", { items }), `${items.length} opinión(es) guardadas`);
    } else if (f.id === "faqForm") {
      const items = [...f.querySelectorAll(".fq-row")].map((r) => ({ q: r.querySelector('[name="fq"]').value.trim(), a: r.querySelector('[name="fa"]').value.trim() })).filter((x) => x.q && x.a);
      await act(() => api("POST", "/api/admin/faq", { items }), `${items.length} pregunta(s) guardadas`);
    } else if (f.id === "couponForm") {
      const type = f.type.value, raw = Number(String(f.value.value).replace(",", "."));
      const value = type === "percent" ? Math.round(raw) : toCents(f.value.value);
      if (!value || value <= 0) return toast("Poné cuánto descuenta");
      const ymd = f.expiresAt.value; // fin del día elegido, hora local
      const body = { id: f.dataset.id || undefined, code: f.code.value, type, value,
        expiresAt: ymd ? new Date(`${ymd}T23:59:59`).getTime() : null,
        maxUses: f.maxUses.value ? +f.maxUses.value : null, perCustomer: f.perCustomer.value ? +f.perCustomer.value : null,
        minTotal: f.minTotal.value ? toCents(f.minTotal.value) : null, note: f.note.value.trim(),
        productIds: [...f.querySelectorAll('[name="cupprod"]:checked')].map((x) => x.value), resellers: f.resellers.checked };
      const prev = P.tab.couponEdit; P.tab.couponEdit = null;
      const ok = await act(() => api("POST", "/api/admin/coupons", body), (c) => `🏷️ Cupón ${c.code} guardado`);
      if (!ok) P.tab.couponEdit = prev;
    } else if (f.id === "expenseForm") {
      const amount = toCents(f.amount.value);
      if (!amount || Number.isNaN(amount) || amount <= 0) return toast("Poné un monto mayor a 0");
      await act(() => api("POST", "/api/admin/expenses", { amount, note: f.note.value.trim() }), (x) => `Gasto de ${bs(x.amount)} agregado`);
    } else if (f.id === "waHours") {
      await act(() => api("POST", "/api/admin/whatsapp/config", { humanHours: f.on.checked ? { from: +f.from.value, to: +f.to.value } : null }), f.on.checked ? "Horario guardado" : "Sin horario: el bot no menciona horarios");
    } else if (f.id === "waQuick") {
      const quickReplies = [...f.querySelectorAll(".qr-row")].map((r) => ({ keywords: r.querySelector('[name="k"]').value.split(",").map((x) => x.trim()).filter(Boolean), answer: r.querySelector('[name="a"]').value.trim() }))
        .filter((q) => q.keywords.length || q.answer);
      await act(() => api("POST", "/api/admin/whatsapp/config", { quickReplies }), `${quickReplies.length} respuesta(s) guardadas`);
    } else if (f.id === "waTemplates") {
      const templates = {};
      for (const inp of f.querySelectorAll('input[name^="name-"]')) {
        const id = inp.name.slice(5), name = inp.value.trim();
        if (name) templates[id] = { name, lang: f[`lang-${id}`].value.trim() || "es" };
      }
      await act(() => api("POST", "/api/admin/whatsapp/config", { templates }), `${Object.keys(templates).length} plantilla(s) guardadas`);
    } else if (f.id === "waTest") {
      await act(() => api("POST", "/api/admin/whatsapp/test", { to: f.to.value }), "Prueba enviada: revisá ese WhatsApp");
    } else if (f.id === "selfTestForm") {
      await act(() => api("POST", "/api/admin/ai/selftest", { model: f.model.value }), "🧪 Prueba en marcha: tarda 1 o 2 minutos. Tocá Actualizar.");
    } else if (f.id === "askForm") {
      const out = $("#askOut"), q = f.q.value.trim(); if (!q) return;
      const b = f.querySelector("button"); b.disabled = true; out.textContent = "Pensando…";
      try { const r = await api("POST", "/api/admin/ai/ask", { question: q }); out.innerHTML = esc(r.answer).replace(/\n/g, "<br>"); }
      catch (e) { out.textContent = e.message; } finally { b.disabled = false; }
    } else if (f.id === "aiForm") {
      const enabled = Object.fromEntries(AI_AGENTS.map(([k]) => [k, !!f[`ag_${k}`]?.checked]));
      P.ai = null;
      await act(() => api("POST", "/api/admin/ai", { enabled, model: f.model.value, monthlyLimitUsd: Math.max(0, +f.limit.value || 0) }), "🤖 Agentes guardados");
    } else if (f.id === "pushForm") {
      const alerts = Object.keys(PUSH_LABELS).filter((k) => f[`pa_${k}`]?.checked);
      await act(() => api("POST", "/api/admin/push/config", { alerts, lowStockAt: Math.max(0, Math.min(50, Math.round(+f.lowStockAt.value || 0))) }), "Avisos guardados");
    } else if (f.id === "tgForm") {
      const body = { chatId: f.chatId.value.trim(), enabled: f.enabled.checked, alerts: [...f.querySelectorAll('input[name^="al_"]:checked')].map((x) => x.name.slice(3)) };
      if (f.token.value.trim()) body.token = f.token.value.trim();
      await act(() => api("POST", "/api/admin/telegram", body), "Avisos de Telegram guardados");
    } else if (f.id === "binForm") {
      const body = { rate: f.rate.value.trim(), payId: f.payId.value.trim(), enabled: f.enabled.checked };
      if (f.apiKey.value.trim()) body.apiKey = f.apiKey.value.trim();
      if (f.apiSecret.value.trim()) body.apiSecret = f.apiSecret.value.trim();
      await act(() => api("POST", "/api/admin/binance", body), "Binance Pay guardado");
    } else if (f.id === "pmForm") {
      const body = { id: f.dataset.id || undefined, name: f.name.value, country: f.country.value, account: f.account.value, holder: f.holder.value, instructions: f.instructions.value,
        priceGroupIds: [...f.querySelectorAll('[name="pmgroup"]:checked')].map((x) => x.value), replacesQr: f.replacesQr.checked, enabled: f.enabled.checked };
      const prev = P.tab.pmEdit; P.tab.pmEdit = null;
      const ok = await act(() => api("POST", "/api/admin/paymethods", body), (m) => `💳 ${m.name} guardado`);
      if (!ok) P.tab.pmEdit = prev;
    } else if (f.id === "rateForm") {
      const rate = Number(String(f.rate.value).trim().replace(",", "."));
      if (!(rate > 0 && rate <= 1000)) return toast("Poné cuántos Bs vale 1 USDT (ej. 9,85)");
      const u = await api("GET", "/api/admin/usdt");
      await act(() => api("POST", "/api/admin/settings", { usdt: { enabled: u.enabled, address: u.address, network: u.network, payId: u.payId, note: u.note, rate } }), `💱 Tasa actualizada: 1 USDT = Bs ${String(rate).replace(".", ",")}`);
    } else if (f.id === "usdtForm") {
      const usdt = { enabled: f.enabled.checked, address: f.address.value.trim(), network: f.network.value.trim(), payId: f.payId.value.trim(), rate: f.rate.value.trim().replace(",", "."), note: f.note.value.trim() };
      await act(() => api("POST", "/api/admin/settings", { usdt }), "Cobro en USDT guardado");
    } else if (f.id === "importSvcForm") {
      const b64 = await fileToBase64(f.file.files[0]);
      const result = await api("POST", "/api/admin/import/services", { contentBase64: b64, dryRun: true });
      P.tab.importSvc = { b64, result };
      await render();
    } else if (f.id === "importForm") {
      const b64 = await fileToBase64(f.file.files[0]);
      const result = await api("POST", "/api/admin/import/customers", { contentBase64: b64, dryRun: true });
      P.tab.import = { b64, result };
      await render();
    } else if (f.dataset.transfer) {
      await act(() => api("POST", `/api/admin/assignments/${f.dataset.transfer}/transfer`, { toCustomerId: f.to.value, reason: f.reason.value }), "Servicio transferido: misma fecha y mismo perfil");
    } else if (f.dataset.renewpaid) {
      const amount = toCents(f.amount.value);
      if (!amount || amount <= 0) return toast("Poné cuánto pagaste");
      await act(() => api("POST", `/api/admin/accounts/${f.dataset.renewpaid}/renew-paid`, { amount, months: +f.months.value }),
        (r) => `✅ Pago anotado (${bs(r.expense.amount)}). Ahora vence el ${fdate(r.supplierExpiresAt)}`);
    } else if (f.id === "minMarginForm") {
      await act(() => api("POST", "/api/admin/finance/min-margin", { pct: Math.round(+f.pct.value || 0) }), "Margen mínimo guardado");
    } else if (f.dataset.editacc) {
      const body = { email: f.email.value.trim(), supplierId: f.supplierId.value, supplierExpiresAt: new Date(f.exp.value + "T23:59:00").getTime(), cost: toCents(f.cost.value || 0), notes: f.notes.value };
      if (f.password.value) body.password = f.password.value;
      const r = await api("POST", `/api/admin/accounts/${f.dataset.editacc}`, body);
      let pins = 0;
      for (const inp of f.querySelectorAll('input[name^="label-"]')) {
        const id = inp.name.slice(6), pin = f[`pin-${id}`];
        const patch = {};
        if (inp.value.trim() !== inp.defaultValue) patch.label = inp.value.trim();
        if (pin.value !== pin.defaultValue && (pin.value || P.tab.secrets)) patch.pin = pin.value;
        if (Object.keys(patch).length) { await api("POST", `/api/admin/slots/${id}`, patch); pins++; }
      }
      P.tab.editAcc = null;
      toast(r.notified ? `Cuenta actualizada: ${r.notified} cliente(s) ven el dato nuevo y tienen el aviso en WhatsApp` : `Cuenta actualizada${pins ? ` (${pins} perfil/es)` : ""}`);
      await render();
    } else if (f.id === "editCusForm" || f.dataset.editcusform !== undefined) {
      const body = { name: f.name.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value };
      if (f.tag) body.tag = f.tag.value;
      // La lista elegida (también para revendedores: p. ej. la lista en dólares). Si cambia el tipo, la base de ese tipo.
      if (f.kind) {
        body.kind = f.kind.value;
        const pl = f.priceList?.value, base = f.kind.value === "reseller" ? "revendedor" : "final";
        // Al cambiar de tipo vuelve a la lista base de ese tipo, salvo una lista en dólares (cambiarla movería la moneda de su saldo).
        const keep = pl && pl !== "final" && pl !== "revendedor" && (f.kind.value === f.dataset.kind0 || (f.dataset.usdlists || "").split(",").includes(pl));
        body.priceGroupId = keep ? pl : base;
      }
      await api("POST", `/api/admin/customers/${f.dataset.id}`, body);
      await api("POST", `/api/admin/customers/${f.dataset.id}/consent`, { whatsapp: f.consent.checked });
      P.tab.editCus = null;
      toast("Cliente actualizado");
      await render();
    } else if (f.dataset.down) {
      if (!confirm("¿Marcar esta cuenta como caída? Se retira y se mueve a TODOS sus clientes a otra cuenta libre. Revisá que haya cupo.")) { done(); return; }
      await act(() => api("POST", `/api/admin/accounts/${f.dataset.down}/replace`, { reason: f.reason.value }), (r) => r.retired ? `Cuenta retirada. ${r.results.length} cliente(s) movidos` : `No se pudo mover a todos: ${r.results.find((x) => !x.ok)?.error}`);
    } else if (f.id === "quickForm") {
      const n = Math.max(1, Math.min(20, +f.n.value || 1));
      try { localStorage.setItem("gs-carga", JSON.stringify({ productId: f.productId.value, supplierId: f.supplierId.value, exp: f.exp.value, cost: f.cost.value })); } catch { /* sin almacenamiento */ }
      await act(() => api("POST", "/api/admin/accounts", {
        productId: f.productId.value, supplierId: f.supplierId.value, email: f.email.value.trim(), password: f.password.value,
        supplierExpiresAt: new Date(f.exp.value + "T23:59:00").getTime(), cost: toCents(f.cost.value || 0), paidNow: !!f.paidNow?.checked,
        profiles: (() => { const defs = P.tab.prodDefaults?.[f.productId.value] ?? []; return Array.from({ length: n }, (_, i) => defs[i] ? { label: defs[i].label, ...(defs[i].pin ? { pin: defs[i].pin } : {}) } : { label: `Perfil ${i + 1}` }); })(),
      }), `✅ Cuenta agregada con ${n} perfiles libres`);
    } else if (f.id === "trialForm") {
      const btn = f.querySelector('[type="submit"]'); btn.disabled = true;
      try {
        const r = await api("POST", "/api/admin/trials", { customerId: f.customerId.value, productId: f.productId.value, hours: +f.hours.value });
        const msg = r.delivery?.message ?? "";
        const out = $("#trialOut");
        if (out) out.innerHTML = `<div class="pok" style="margin-top:10px">✅ Prueba generada. Mandale esto al cliente:</div><pre class="rpre" style="white-space:pre-wrap">${esc(msg)}</pre><div class="inline"><button class="pbtn sm" type="button" data-copy="${esc(msg)}">${icon("copy")}Copiar</button>${r.delivery?.customerPhone ? `<a class="pbtn sm" href="${esc(waLink(r.delivery.customerPhone, msg))}" target="_blank" rel="noopener">${icon("wa")}Mandar por WhatsApp</a>` : ""}</div>`;
        toast("Prueba generada ✓");
      } catch (e) { toast(e.message); } finally { btn.disabled = false; }
    } else if (f.id === "newListForm") {
      const name = f.name.value.trim();
      const base = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 30) || "lista";
      const currency = f.currency?.value === "USD" ? "USD" : "BOB";
      await act(() => api("POST", "/api/admin/price-groups", { id: "lp-" + base, name, prices: {}, currency }), `Lista "${name}" creada${currency === "USD" ? " en dólares" : ""}`);
    } else if (f.dataset.pricelist) {
      const prices = {};
      for (const inp of f.querySelectorAll('input[name^="pp-"]')) { const v = inp.value.trim(); if (v !== "") { const c = toCents(v); if (Number.isFinite(c) && c >= 0) prices[inp.name.slice(3)] = c; } }
      await act(() => api("POST", "/api/admin/price-groups", { id: f.dataset.pricelist, name: f.name.value.trim(), prices, ...(f.currency ? { currency: f.currency.value } : {}) }), "Lista de precios guardada");
    } else if (f.id === "iptvForm") {
      const mode = f.mode.value;
      const iptv = { mode, server: f.server.value.trim() || undefined, mac: f.mac.value.trim() || undefined, app: f.app.value.trim() || undefined, connections: +f.connections.value || undefined };
      await act(() => api("POST", "/api/admin/accounts", {
        productId: f.productId.value, supplierId: f.supplierId.value, email: f.email.value.trim(), password: f.password.value,
        supplierExpiresAt: f.exp.value ? new Date(f.exp.value + "T23:59:00").getTime() : 0, cost: toCents(f.cost.value || 0),
        profiles: [{ label: "Línea IPTV" }], iptv,
      }), "📺 Línea IPTV registrada, lista para vender");
    } else if (f.id === "accForm") {
      const n = Math.max(1, Math.min(20, +f.n.value || 1));
      const pin = f.pin.value.trim() || undefined;
      await act(() => api("POST", "/api/admin/accounts", {
        productId: f.productId.value, supplierId: f.supplierId.value, email: f.email.value.trim(), password: f.password.value,
        supplierExpiresAt: new Date(f.exp.value + "T23:59:00").getTime(), cost: toCents(f.cost.value || 0), paidNow: !!f.paidNow?.checked,
        profiles: n === 1 ? [{ label: "Cuenta completa", pin }] : Array.from({ length: n }, (_, i) => ({ label: `Perfil ${i + 1}`, pin })),
      }), `Cuenta cargada con ${n} perfil(es)`);
    } else if (f.id === "bulkForm") {
      const rows = f.rows.value.split("\n").map((l) => l.split(",").map((x) => x.trim())).filter((r) => r[0]).map(([email, password, n, exp]) => {
        const k = Math.max(1, Math.min(20, +n || 1));
        return { productId: f.productId.value, supplierId: f.supplierId.value, email, password, cost: toCents(f.cost.value || 0), supplierExpiresAt: new Date((exp || "") + "T23:59:00").getTime() || 0, profiles: k === 1 ? [{ label: "Cuenta completa" }] : Array.from({ length: k }, (_, i) => ({ label: `Perfil ${i + 1}` })) };
      });
      if (!rows.length) throw new Error("Pegá al menos una línea");
      const r = await api("POST", "/api/admin/accounts/bulk", { rows });
      const bad = r.filter((x) => !x.ok);
      toast(`${r.length - bad.length} cuentas cargadas${bad.length ? `, ${bad.length} con error` : ""}`);
      await render();
      if (bad.length) $("#bulkOut").innerHTML = `<div class="perr">${bad.map((b) => `Línea ${b.row + 1}: ${esc(b.error)}`).join("<br>")}</div>`;
    } else if (f.id === "prodForm") {
      const id = f.dataset.id || f.name.value.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
      const body = { id, name: f.name.value.trim(), category: f.category.value.trim() || undefined, description: f.description.value.trim() || undefined, kind: f.kind.value, durationDays: +f.durationDays.value, price: toCents(f.price.value), color: f.color.value, published: f.audience.value !== "none", resellersOnly: f.audience.value === "resellers" };
      if (!Number.isFinite(body.price)) throw new Error("Precio inválido");
      const pdefs = [];
      for (let i = 0; i < 10; i++) { const lab = f[`pd-label-${i}`]?.value?.trim(); if (lab) pdefs.push({ label: lab, pin: (f[`pd-pin-${i}`]?.value || "").replace(/\D/g, "") || undefined }); }
      body.profileDefaults = pdefs;
      body.saleNote = f.saleNote?.value?.trim() ?? "";
      body.guide = { app: f.guideApp?.value?.trim() ?? "", link: f.guideLink?.value?.trim() ?? "", steps: f.guideSteps?.value?.trim() ?? "" };
      if (body.kind === "combo") body.comboProductIds = [...f.querySelectorAll('input[name="combopart"]:checked')].map((x) => x.value);
      await api("POST", "/api/admin/products", body);
      const groups = await api("GET", "/api/admin/price-groups");
      const rev = groups.find((g) => g.id === "revendedor") ?? { id: "revendedor", name: "Revendedor", prices: {} };
      const rp = f.resPrice.value.trim();
      if (rp || rev.prices[id] !== undefined) {
        if (rp) rev.prices[id] = toCents(rp); else delete rev.prices[id];
        await api("POST", "/api/admin/price-groups", rev);
      }
      P.tab.editProduct = null;
      toast(f.dataset.id ? "Producto actualizado" : "Producto creado");
      await render();
    } else if (f.id === "supForm") {
      await act(() => api("POST", "/api/admin/suppliers", { name: f.name.value.trim(), contact: f.contact.value.trim() || undefined, active: true }), "Proveedor agregado");
    } else if (f.id === "cusForm") {
      await act(() => api("POST", "/api/admin/customers", { name: f.name.value, phone: f.phone.value, email: f.email.value || undefined, kind: f.kind.value, priceGroupId: f.kind.value === "reseller" ? "revendedor" : undefined, whatsappConsent: f.consent.checked }), "Cliente creado: generale su link de acceso");
    } else if (f.id === "cusSearch") {
      P.tab.q = f.q.value; await render();
    } else if (f.id === "adjForm") {
      await act(() => api("POST", `/api/admin/customers/${f.dataset.id}/adjust`, { amount: toCents(f.amount.value), reason: f.reason.value }), "Saldo ajustado");
    } else if (f.dataset.fpay) {
      const amount = toCents(f.amount.value);
      if (!(amount > 0)) return toast("Escribí el monto que te pagó");
      await act(() => api("POST", "/api/admin/fiado/payment", { customerId: f.dataset.fpay, amount, note: f.note.value }), (r) => r.owed ? `💵 Pago guardado · todavía debe ${bs(r.owed)}` : "💵 Pago guardado · ¡ya no debe nada! 🎉");
    } else if (f.dataset.fcharge || f.id === "fNewForm") {
      const amount = toCents(f.amount.value);
      if (!(amount > 0)) return toast("Escribí el monto");
      let customerId = f.dataset.fcharge;
      if (!customerId) {
        const cs = await api("GET", "/api/admin/customers");
        const v = f.who.value.trim();
        customerId = cs.find((c) => `${c.name} · ${c.phone || "sin WhatsApp"}` === v)?.id ?? cs.find((c) => c.name.toLowerCase() === v.toLowerCase())?.id;
        if (!customerId) return toast("Elegí a la persona de la lista (o creala primero en Clientes)");
      }
      const due = f.due.value ? (() => { const [y, m, d] = f.due.value.split("-").map(Number); return new Date(y, m - 1, d, 23, 59).getTime(); })() : undefined;
      await act(() => api("POST", "/api/admin/fiado/charge", { customerId, amount, note: f.note.value, ...(due ? { dueAt: due } : {}) }), "➕ Fiado anotado");
    } else if (f.dataset.staffpw) {
      await act(() => api("POST", `/api/admin/staff/${f.dataset.staffpw}/password`, { password: f.password.value }), "Contraseña cambiada: ya puede entrar con la nueva");
    } else if (f.id === "staffForm") {
      await act(() => api("POST", "/api/admin/staff", { name: f.name.value, username: f.username.value, role: f.role.value, password: f.password.value }), "Usuario creado");
    } else if (f.id === "offForm") {
      const own = f.mode.value === "own";
      await act(() => api("POST", "/api/admin/offsite", { enabled: f.enabled.checked, ...(own ? { address: f.address?.value.trim(), password: f.password?.value || undefined } : { mailboxId: f.mode.value }) }), "Copia en Gmail guardada");
    } else if (f.id === "resForm") {
      const btn = f.querySelector("[type=submit]"); btn.disabled = true;
      try {
        const c = await api("POST", "/api/admin/customers", { name: f.name.value.trim(), phone: f.phone.value, email: f.email.value.trim() || undefined, kind: "reseller", priceGroupId: "revendedor", whatsappConsent: f.consent.checked });
        let slug, pageErr = "";
        if (f.plan.value === "page") {
          try {
            const shop = await api("POST", `/api/admin/customers/${c.id}/shop`, { ...(f.slug.value.trim() ? { slug: f.slug.value.trim().toLowerCase() } : {}), title: (f.title.value.trim() || f.name.value.trim()).slice(0, 40), enabled: f.publish.checked });
            slug = shop.slug;
          } catch (e) { pageErr = e.message; }
        }
        P.tab.rlink = await resellerKit(c.id, c.name, c.phone, slug);
        toast(pageErr ? `Revendedor creado, pero su página no: ${pageErr}` : f.plan.value === "page" ? "Revendedor creado con su página" : "Revendedor creado (solo panel)");
        await render(); scrollTo(0, 0);
      } catch (e) { toast(e.message); btn.disabled = false; }
    } else if (f.id === "bulkRes") {
      const pct = Number(f.pct.value);
      if (!(pct >= 0 && pct < 100)) { toast("Descuento entre 0 y 99 %"); return; }
      const [products, groups, mg] = await Promise.all([api("GET", "/api/admin/products"), api("GET", "/api/admin/price-groups"), api("GET", "/api/admin/finance/margins").catch(() => null)]);
      const rev = groups.find((g) => g.id === "revendedor") ?? { id: "revendedor", name: "Revendedor", prices: {} };
      const costOf = Object.fromEntries((mg?.products ?? []).filter((m) => m.unitCost !== null).map((m) => [m.productId, m.unitCost]));
      let n = 0;
      const below = [];
      for (const p of products) {
        if (p.resellersOnly || (!f.overwrite.checked && rev.prices[p.id] !== undefined)) continue;
        rev.prices[p.id] = Math.max(100, Math.round((p.price * (100 - pct)) / 100 / 100) * 100);
        if (costOf[p.id] !== undefined && rev.prices[p.id] < costOf[p.id]) below.push(`• ${p.name}: quedaría en ${bs(rev.prices[p.id])} y te cuesta ${bs(costOf[p.id])}`);
        n++;
      }
      if (!n) { toast("No había productos para cambiar"); return; }
      const warn = below.length ? `\n\n🔴 OJO: con ${pct}% perdés plata en ${below.length} producto(s):\n${below.join("\n")}\n\nSi seguís, después subilos uno por uno en Productos.` : "\n\n✅ Ninguno queda por debajo de lo que te cuesta.";
      if (!confirm(`¿Poner precio de revendedor a ${n} producto(s) con ${pct}% de descuento?${warn}`)) return;
      await act(() => api("POST", "/api/admin/price-groups", rev), `Listo: ${n} producto(s) con precio de revendedor`);
    } else if (f.dataset.rtopf) {
      const v = toCents(f.amount.value || "0"), name = f.dataset.name, bal = Number(f.dataset.bal), m = (c) => wal(c, f.dataset.cur);
      if (!Number.isFinite(v) || v === 0) { toast("Escribí un monto distinto de 0"); return; }
      if (v < 0 && !confirm(`¿Descontarle ${m(-v)} a ${name}?\nSu saldo queda en ${m(bal + v)}.`)) return;
      await act(async () => { await api("POST", `/api/admin/customers/${f.dataset.rtopf}/adjust`, { amount: v, reason: f.reason.value.trim() || "Recarga de saldo (panel)" }); P.tab.rtop = ""; }, `✅ Saldo de ${name}: ${m(bal)} → ${m(bal + v)}`);
    } else if (f.id === "resCfg") {
      await act(() => api("POST", "/api/admin/settings", { resellerMarginPct: Math.round(Number(f.margin.value) || 0), referralBonus: toCents(f.referral.value || "0"), shopRent: { enabled: f.rentOn.checked, price: toCents(f.price.value || "0"), freeIfSpent: toCents(f.free.value || "0"), graceDays: Math.round(Number(f.grace.value) || 0) } }), "Ajustes guardados");
    } else if (f.id === "mbForm") {
      await act(async () => { await api("POST", "/api/admin/mailboxes", mbBody(f)); P.tab.mbEdit = null; P.tab.mbKind = null; }, "Correo conectado: ya se están leyendo los códigos");
    } else if (f.id === "comboForm") {
      await act(() => api("POST", "/api/admin/settings", { comboDiscounts: [0, 1, 2].map((i) => toCents(f[`d${i}`].value || "0")) }), "Descuentos del combo guardados");
    } else if (f.id === "setForm") {
      await act(() => api("POST", "/api/admin/settings", { storeName: f.storeName.value, platformName: f.platformName.value.trim() || "GaboHub", whatsapp: f.whatsapp.value.replace(/\D/g, "") || undefined, paymentNote: f.paymentNote.value, currencySymbol: f.currencySymbol?.value.trim() || undefined }), "Configuración guardada");
      P.settings = await api("GET", "/api/settings");
      setCurrency(P.settings.currencySymbol);
      $("#pStore").textContent = P.settings.storeName;
    } else if (f.id === "lookForm") {
      const color = (n) => f.querySelector(`input[name="${n}"]:checked`)?.value || f[n + "Custom"].value;
      const body = { accentColor: color("accentColor"), backgroundColor: color("backgroundColor"), accent2Color: f.accent2Auto.checked ? "" : f.accent2Color.value,
        fontFamily: f.fontFamily.value, headingFont: f.headingFont.value, bgStyle: f.bgStyle.value, cardStyle: f.cardStyle.value, corners: f.corners.value, layout: f.layout.value };
      for (const k of ["heroTitle", "heroHighlight", "heroText", "announcement", "storeHours", "heroChip", "heroTicks", "footerText", "instagram", "tiktok", "facebook", "seoTitle", "seoDescription"]) body[k] = f[k].value;
      await act(() => api("POST", "/api/admin/settings", body), "Apariencia guardada: así la ven tus clientes");
    } else if (f.id === "bannerForm") {
      await act(async () => api("POST", "/api/admin/settings/banner", { contentBase64: await fileToBase64(f.file.files[0]) }), "Portada actualizada");
    } else if (f.id === "logoForm") {
      await act(async () => api("POST", "/api/admin/settings/logo", { contentBase64: await fileToBase64(f.file.files[0]) }), "Logo actualizado");
    } else if (f.id === "qrForm") {
      await act(async () => api("POST", "/api/admin/settings/qr", { contentBase64: await fileToBase64(f.file.files[0]) }), "QR actualizado");
    } else if (f.id === "alertForm") {
      await act(() => api("POST", "/api/admin/alerts", { phone: f.phone.value, payments: f.payments.checked, supplierExpiry: f.supplierExpiry.checked, supplierDaysBefore: +f.supplierDaysBefore.value }),
        f.phone.value.trim() ? "Listo: te vamos a avisar por WhatsApp" : "Guardado (sin WhatsApp: solo avisos en el panel)");
    } else if (f.id === "tfaOn") {
      await act(() => api("POST", "/api/admin/me/2fa/enable", { code: f.code.value }), "🔐 Verificación en dos pasos activada");
      P.tab.tfa = null;
    } else if (f.id === "tfaOff") {
      await act(() => api("POST", "/api/admin/me/2fa/disable", { password: f.password.value, code: f.code.value }), "Verificación en dos pasos desactivada");
    } else if (f.id === "pwForm") {
      await act(() => api("POST", "/api/admin/me/password", { current: f.current.value, next: f.next.value }), "Contraseña cambiada");
    }
  } catch (e) {
    toast(e.message);
  }
  done();
});

$("#burger").onclick = () => $("#app").classList.add("open");
$("#sscrim").onclick = () => $("#app").classList.remove("open");
const tick = () => ($("#clock").textContent = new Date().toLocaleString("es-BO", { weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" }));
tick(); setInterval(tick, 30_000);
start();

// Cobro por país: subir el QR de un método apenas se elige la imagen.
document.addEventListener("change", async (ev) => {
  const inp = ev.target;
  if (!inp?.dataset?.pmqr || !inp.files?.[0]) return;
  const b64 = await fileToBase64(inp.files[0]);
  await act(() => api("POST", `/api/admin/paymethods/${inp.dataset.pmqr}/qr`, { contentBase64: b64 }), "QR guardado");
});

// Permiso para que los revendedores creen cupones en su página.
document.addEventListener("change", (ev) => {
  const el = ev.target;
  if (el?.id !== "rcAllowed") return;
  act(() => api("POST", "/api/admin/reseller-coupons", { allowed: el.checked }), el.checked ? "Los revendedores ya pueden crear cupones" : "Cupones de revendedores apagados");
});

// Oficina virtual: al cambiar el modelo, mostrar su precio.
document.addEventListener("change", async (ev) => {
  if (ev.target?.name !== "model" || ev.target.form?.id !== "aiForm") return;
  const a = await api("GET", "/api/admin/ai").catch(() => null);
  const m = a?.models.find((x) => x.id === ev.target.value);
  const out = $("#aiPrice"); if (out && m) out.textContent = `US$ ${m.input} / ${m.output} por millón de tokens`;
});
