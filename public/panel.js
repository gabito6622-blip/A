// Panel del vendedor conectado al servidor.
import { api, $, $$, esc, bs, toCents, fdate, fdt, daysLeft, icon, toast, fileToBase64, waLink, newKey, STATUS_TEXT, KIND_TEXT, FONT_LIST, BG_LIST, CARD_LIST, THEMES, themeSwatch } from "/common.js";

const P = { me: null, view: "inicio", tab: {}, theme: "light", settings: null };
try { P.theme = localStorage.getItem("gs-panel-theme") || "light"; } catch { /* sin almacenamiento */ }

const isOwner = () => P.me?.role === "owner";
const canReview = () => P.me?.role === "owner" || P.me?.role === "admin";

const MENU = [
  ["inicio", "home", "Inicio"], ["vender", "cart", "Vender"], ["control", "grid", "Control de alquileres"], ["renovar", "renew", "Renovar"], ["dashboard", "home", "Dashboard"],
  ["aprobacion", "approve", "Aprobación de Ventas"], ["recordatorios", "bell", "Recordatorios"], ["codigos", "mailbox", "Panel de códigos", "owner"],
  ["G", "box", "Productos", [["cuentas", "Cuentas"], ["carga", "Carga de Cuentas"], ["productos", "Productos y precios"]]],
  ["revendedores", "userplus", "Revendedores"], ["proveedores", "truck", "Proveedores"], ["clientes", "users", "Clientes"], ["excel", "ext", "Excel: exportar e importar"], ["whatsapp", "wa", "WhatsApp"],
  ["apariencia", "sun", "Apariencia de la tienda"], ["usuarios", "userplus", "Usuarios", "owner"], ["auditoria", "history", "Auditoría", "owner"], ["configuracion", "gear", "Configuración"],
];
const TITLE = { inicio: ["home", "Inicio"], control: ["grid", "Control de alquileres"], vender: ["cart", "Vender"], renovar: ["renew", "Renovar"], dashboard: ["home", "Dashboard"], aprobacion: ["approve", "Aprobación de Ventas"], recordatorios: ["bell", "Recordatorios"], codigos: ["mailbox", "Panel de códigos"], revendedores: ["userplus", "Revendedores"], cuentas: ["user", "Cuentas"], carga: ["box", "Carga de Cuentas"], productos: ["box", "Productos y precios"], proveedores: ["truck", "Proveedores"], clientes: ["users", "Clientes"], excel: ["ext", "Excel: exportar e importar"], whatsapp: ["wa", "WhatsApp"], usuarios: ["userplus", "Usuarios del panel"], apariencia: ["sun", "Apariencia de la tienda"], auditoria: ["history", "Auditoría"], configuracion: ["gear", "Configuración"] };

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
const dateInput = (t) => new Date(t).toISOString().slice(0, 10);

/** Link de acceso + página + mensaje de WhatsApp para un revendedor. */
async function resellerKit(id, name, phone, slug, pinIn) {
  const pin = pinIn ?? (await api("POST", `/api/admin/customers/${id}/login-pin`, {})).pin;
  const plat = P.settings?.platformName || "GaboHub";
  const page = slug ? `${location.origin}/r/${slug}` : "";
  const base = `¡Hola ${name.split(" ")[0]}! 👋 Ya sos revendedor de ${plat}.\n\n👉 Entrá acá: ${location.origin}/\n📱 Tu número: ${phone}\n🔑 Tu PIN: ${pin}\n\nAhí ves tus precios, comprás con saldo o QR, y ves tus cuentas y códigos.`;
  const msg = page
    ? `${base}\n\n🛍️ Tu página para tus clientes:\n${page}\n\n(Guardá tu PIN. Lo podés cambiar adentro.)`
    : `${base}\n\n(Guardá tu PIN. Lo podés cambiar adentro.)`;
  return { name, phone, url: `${location.origin}/`, page: page || "Solo panel (sin página)", msg, pin };
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
  async dashboard() {
    const dd = Number(P.tab.dd ?? 30);
    const [d, set, products, accounts] = await Promise.all([api("GET", `/api/admin/dashboard?days=${dd}`), api("GET", "/api/settings"), api("GET", "/api/admin/products"), api("GET", "/api/admin/accounts")]);
    const todo = [
      [!set.whatsapp, "wa", "Cargá el WhatsApp de la tienda", "configuracion", "Configurar"],
      [!set.hasQr, "qr", "Subí tu QR de cobro", "configuracion", "Subir QR"],
      [!products.length, "box", "Creá tu primer producto", "productos", "Crear"],
      [!accounts.length, "user", "Cargá tus cuentas y perfiles", "carga", "Cargar"],
    ].filter((x) => x[0]);
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
    const donut = A.length ? `<div class="donut"><svg viewBox="0 0 42 42"><circle r="15.915" cx="21" cy="21" fill="none" class="ring" stroke-width="6"/>${arcs}<text x="21" y="21" class="dn">${k.activeServices}</text><text x="21" y="26.5" class="dt">activos</text></svg>
      <ul>${A.map((x, i) => `<li><i style="background:${PAL[i % 8]}"></i>${esc(x.name)}<b>${x.count}</b></li>`).join("")}</ul></div>` : `<div class="emptybox">Sin servicios activos.</div>`;
    // --- ingresos por producto ---
    const B = d.byProduct, bmax = Math.max(...B.map((x) => x.revenue), 1);
    // --- Resumen por servicio (ganancia por app) ---
    const svcList = B.length ? `<div class="svclist">${B.map((x, i) => `<div class="svcrow"><span class="svcic" style="background:${PAL[i % 8]}">${esc((x.name[0] || "?").toUpperCase())}</span><div class="svcinfo"><b>${esc(x.name)}</b><small>${bs(x.revenue)} · ${x.units} venta(s)</small></div><div class="svcbar"><i style="width:${Math.max(4, (x.revenue / bmax) * 100)}%;background:${PAL[i % 8]}"></i></div></div>`).join("")}</div>` : `<div class="emptybox">Sin ventas en este período.</div>`;
    // --- Atajos de alerta (vencidos / por vencer / sin cobrar) ---
    const al = d.alerts;
    const alertCards = `<div class="dalerts">
      <button type="button" class="dalert bad" data-go="control"><span class="aic">📅</span><div class="atx"><b>${al.overdue.count} perfil(es) ya vencieron</b><small>${bs(al.overdue.amount)} por renovar · Ver</small></div><span class="ar">${icon("arrow")}</span></button>
      <button type="button" class="dalert warn" data-go="control"><span class="aic">⏰</span><div class="atx"><b>${al.due3.count} vencen en los próximos 3 días</b><small>${bs(al.due3.amount)} por renovar · Ver</small></div><span class="ar">${icon("arrow")}</span></button>
      <button type="button" class="dalert blue" data-go="aprobacion"><span class="aic">💳</span><div class="atx"><b>${al.unpaid.count} con pago pendiente</b><small>${bs(al.unpaid.amount)} por cobrar · Ver</small></div><span class="ar">${icon("arrow")}</span></button></div>`;
    // --- Ingresos por mes (12 meses), curva suave estilo Netxly ---
    const M = d.months, mtot = M.reduce((s, x) => s + x.revenue, 0), mmax = Math.max(...M.map((x) => x.revenue), 1);
    const best = M.reduce((a, b) => (b.revenue > a.revenue ? b : a), M[0]), worst = M.reduce((a, b) => (b.revenue < a.revenue ? b : a), M[0]);
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
      <div class="big mini"><button type="button" data-go="carga" style="background:#4263eb"><span>${icon("userplus")}</span>Registrar cuentas</button><button type="button" data-go="vender" style="background:#087f5b"><span>${icon("cart")}</span>Vender</button></div></div>
      ${todo.length ? `<section class="card"><h2>${icon("flag")}Completá tu tienda</h2><div class="todo">${todo.map(([, i, t, go, b]) => `<div><span class="ic">${icon(i)}</span><b>${t}</b><button class="pbtn blue" type="button" data-go="${go}">${b} ${icon("arrow")}</button></div>`).join("")}</div></section>` : ""}
      <div class="dkpis">
        ${kpi(`Ingresos · ${dd} días`, bs(k.revenue), `${delta(k.revenue, k.prevRevenue)} vs. ${bs(k.prevRevenue)} antes`, "hero")}
        ${kpi("Pedidos", k.orders, `${delta(k.orders, k.prevOrders)} · ${k.renewals} renovaciones`)}
        ${kpi("Ingreso mensual fijo", bs(k.monthlyRecurring), `${k.activeServices} servicios activos`)}
        ${kpi("Recargas de saldo", bs(k.topups), `saldo a favor: ${bs(k.balancesOwed)}`)}
        ${kpi("Vencidos / sin renovar", k.overdue, `${k.due7} vencen en 7 días`, k.overdue ? "bad" : "", "control")}
        ${kpi("Pagos por revisar", k.pendingReview, k.unpaid ? `${k.unpaid} alquileres sin pagar` : "todo al día", k.pendingReview ? "warn" : "", "aprobacion")}
        ${kpi("Clientes", k.customers, `${k.resellers} revendedores · +${k.newCustomers} nuevos`)}
      </div>
      ${alertCards}
      <section class="card"><div class="mctop"><div><h2 style="margin:0">Ingresos por mes <small>12 meses</small></h2><p class="muted" style="margin:2px 0 0">Total del rango: <b>${bs(mtot)}</b></p></div>
        <div class="mcstats"><div class="up"><small>▲ MEJOR MES</small><b>${esc(best.label)} · ${bs(best.revenue)}</b></div><div class="down"><small>▼ MENOR MES</small><b>${esc(worst.label)} · ${bs(worst.revenue)}</b></div></div></div>${monthChart}</section>
      <section class="card"><h2>Ingresos por día <small>pasá el dedo o el mouse por una barra</small></h2>
        <div class="legend"><span><i class="c1"></i>Ventas</span><span><i class="c2"></i>Renovaciones</span><span><i class="c3"></i>Recargas</span></div>${salesChart}</section>
      <div class="dgrid">
        <section class="card"><h2>Vencen en los próximos 14 días <small>${upCnt} servicios · ${bs(upSum)} por cobrar</small></h2>${upChart}
          <button class="pbtn sm" type="button" data-go="control">Ver en el control ${icon("arrow")}</button></section>
        <section class="card"><h2>Servicios activos por producto</h2>${donut}</section>
      </div>
      <div class="dgrid">
        <section class="card"><h2>Resumen por servicio <small>ganancia por app · ${dd} días</small></h2>${svcList}</section>
        <section class="card"><h2>Últimos movimientos</h2><div class="recent">${d.recent.length ? d.recent.map((o) => `<div><div><b>${esc(o.customer || "—")}</b><small>${esc(o.product)} · ${fdt(o.at)}</small></div><div>${tag(o.kind)}<b>${bs(o.total)}</b>${o.status !== "fulfilled" ? orderPill(o.status) : ""}</div></div>`).join("") : `<div class="emptybox">Sin movimientos.</div>`}</div></section>
      </div>
      <section class="card"><h2>${icon("users")}Tus mejores revendedores</h2>${table(["Revendedor", "Servicios", "Mensual", `Compró (${dd} d)`, "Saldo", "Vencen 7 d"],
        d.resellers.map((r) => `<tr><td><b>${esc(r.name)}</b></td><td>${r.services}</td><td>${bs(r.monthly)}</td><td>${bs(r.spent)}</td><td>${bs(r.balance)}</td><td>${r.due7 ? `<span class="pp pp-warn">${r.due7}</span>` : "0"}</td></tr>`), "Todavía no tenés revendedores.")}</section>`;
  },
  async vender() {
    const [customers, products, stock, accounts] = await Promise.all([api("GET", "/api/admin/customers"), api("GET", "/api/admin/products"), api("GET", "/api/admin/stock"), api("GET", "/api/admin/accounts").catch(() => [])]);
    P.tab.sellAccts = accounts;
    const tile = (p) => {
      const n = stock[p.id]?.available ?? 0;
      return `<button type="button" class="selp${n ? "" : " out"}" data-pick="${esc(p.id)}" data-name="${esc(p.name)}" data-stock="${n}" ${n ? "" : "disabled"} aria-pressed="false">
        ${p.imageFileRef ? `<img src="/api/products/${esc(p.id)}/image" alt="" loading="lazy">` : `<i style="background:${esc(p.color ?? "#3984ff")}">${esc((p.name[0] || "?").toUpperCase())}</i>`}
        <b>${esc(p.name)}</b><span class="selprice">${bs(p.price)}</span>
        <em class="selstock ${n ? (n <= 2 ? "low" : "ok") : "no"}">${n ? `${n} libre${n > 1 ? "s" : ""}` : "Sin stock"}</em></button>`;
    };
    const pub = products.filter((p) => p.published !== false);
    const apps = pub.filter((p) => p.kind !== "combo");
    const combos = pub.filter((p) => p.kind === "combo");
    const sk = combos.length ? (P.tab.sellKind ?? "apps") : "apps";
    const shownProds = sk === "combos" ? combos : apps;
    return `<section class="card"><h2>${icon("cart")}Nueva venta <small>tocá el producto y listo</small></h2>
      ${customers.length ? `<form class="form" id="sellForm" data-key="${newKey()}">
        <label>👤 Cliente<select name="customerId" required>${customers.map((c) => opt(c.id, `${c.name} · ${c.phone}`)).join("")}</select></label>
        <input type="hidden" name="productId" value="">
        <div class="sellpick">
          ${combos.length ? `<div class="seg sellseg"><button type="button" data-tab="sellKind:apps" aria-pressed="${sk === "apps"}">📺 Cuentas individuales</button><button type="button" data-tab="sellKind:combos" aria-pressed="${sk === "combos"}">🎁 Combos <span class="segn">${combos.length}</span></button></div>` : ""}
          <div class="selgrid">${shownProds.map(tile).join("") || `<span class="muted">${sk === "combos" ? "Todavía no armaste combos." : "No hay productos."}</span>`}</div>
        </div>
        <div id="sellNote" class="sellnote">👆 Elegí un producto de arriba.</div>
        <input type="hidden" name="slotId" value="">
        <div id="profPick" class="profpick" hidden></div>
        <div class="selrow"><label>Cantidad<input name="qty" type="number" min="1" max="10" value="1"></label>
          <label>💵 Cobrado con<select name="paymentMethod">${opt("cash", "Efectivo / QR ya verificado")}${opt("balance", "Saldo del cliente")}</select></label></div>
        <button class="pbtn dark" type="submit" id="sellBtn" disabled>${icon("cart")}Registrar venta</button></form>` : `<div class="emptybox">Primero creá un cliente.</div>`}
      <div class="inline"><span class="muted">¿Cliente nuevo?</span><button class="pbtn sm" type="button" data-go="clientes">Crear cliente</button></div></section>`;
  },

  async aprobacion() {
    const tab = P.tab.aprob ?? "payment_review";
    const orders = await api("GET", "/api/admin/orders" + (tab === "all" ? "" : `?status=${tab}`));
    const tabs = [["payment_review", "Por revisar"], ["awaiting_payment", "Esperando pago"], ["all", "Todos"]];
    return `${canReview() ? "" : `<div class="pok">Solo el dueño o un admin pueden aprobar pagos. Vos podés ver los pedidos.</div>`}
      <section class="card"><div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" type="button" data-tab="aprob:${k}" aria-selected="${k === tab}">${t}</button>`).join("")}</div>
      ${table(["Pedido", "Cliente", "Tipo", "Total", "Pago", "Estado", "Fecha", "Acciones"], orders.map((o) => `<tr>
        <td>${esc(o.id)}</td><td>${esc(o.customerName)}</td><td>${KIND_TEXT[o.kind]}${o.items?.length ? `<br><small class="muted">${o.items.map((i) => `${i.qty}× ${esc(i.productName)}`).join(", ")}</small>` : ""}${o.backorder?.length ? `<br>${pill("A pedido", "warn")} <small class="muted">Cargá la cuenta en Carga de Cuentas y después aprobá: se entrega sola.</small>` : ""}</td>
        <td>${bs(o.total)}</td><td>${esc({ qr: "QR", balance: "Saldo", cash: "Efectivo" }[o.paymentMethod])}${o.evidence ? `<br><small class="muted">Op. ${esc(o.evidence.declaredReference)}</small>` : ""}</td>
        <td>${orderPill(o.status)}</td><td>${fdt(o.createdAt)}</td>
        <td>${o.evidence ? `<a class="pbtn sm" href="/api/admin/orders/${esc(o.id)}/evidence" target="_blank" rel="noopener">${icon("eye")}Comprobante</a>` : ""}
          ${o.status === "payment_review" && canReview() ? `<form class="inline" data-approve="${esc(o.id)}" style="margin-top:6px"><input name="ref" placeholder="Referencia del banco" required aria-label="Referencia bancaria verificada"><button class="pbtn sm green" type="submit">Aprobar</button></form>
            <form class="inline" data-reject="${esc(o.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo del rechazo" required aria-label="Motivo"><button class="pbtn sm" type="submit">Rechazar</button></form>` : ""}
          ${o.status === "awaiting_payment" && canReview() ? `<form class="inline" data-reject="${esc(o.id)}"><input name="reason" placeholder="Motivo" required aria-label="Motivo"><button class="pbtn sm" type="submit">Anular</button></form>` : ""}</td></tr>`),
        tab === "payment_review" ? "No hay pagos por revisar." : "No hay pedidos.")}
      <p class="muted" style="margin:0">Aprobá solo después de ver el dinero en tu banco: escribí la referencia que figura en tu extracto. Una misma referencia no se puede usar dos veces.</p></section>`;
  },

  async inicio() {
    const [list, st] = await Promise.all([api("GET", "/api/admin/assignments"), api("GET", "/api/admin/stats").catch(() => ({}))]);
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
    const week = Array.from({ length: 7 }, (_, i) => {
      const t = today + i * DAY;
      const n = list.filter((a) => dayStart(a.customerExpiresAt) === t).length;
      const load = n + (i === 0 ? vencidos.length + espera.length : 0);
      const lvl = load === 0 ? ["Libre", "free", "😌"] : load <= 2 ? ["Tranquilo", "calm", "🙂"] : load <= 5 ? ["Movido", "busy", "😅"] : ["Cargado", "hard", "🥵"];
      return { t, i, n, lvl };
    });
    const libres = week.filter((w) => w.lvl[1] === "free").map((w) => (w.i === 0 ? "hoy" : DN[new Date(w.t).getDay()].toLowerCase()));
    const tile = (go, ic, t, sub) => `<button type="button" class="hm-tile" data-hgo="${go}"><span class="hm-ic">${ic}</span><b>${t}</b><small>${sub}</small></button>`;
    const alert = (n, t, k, go) => `<button type="button" class="hm-alert hm-${k}" data-hgo="${go}" ${n ? "" : "disabled"}><b>${n}</b><span>${t}</span></button>`;
    return `<section class="hm-hero"><div><small>${DN[now.getDay()]}, ${now.toLocaleDateString("es-BO", { day: "numeric", month: "long" })}</small><h2>Hola, ${esc((P.me?.name ?? "").split(" ")[0])} 👋</h2>
        <p>${hoy.length + vencidos.length + espera.length ? `Hoy tenés <b>${hoy.length + vencidos.length + espera.length}</b> pendiente(s) de cobro o fecha.` : "Hoy no tenés cobros pendientes. ✨"}${libres.length >= 5 ? " Semana tranquila ✨" : libres.length ? ` Días libres: <b>${libres.slice(0, 3).join(", ")}</b>.` : ""}</p></div>
      <form class="hm-search" id="hmSearch"><input name="q" placeholder="🔍 Buscar cliente o número…" aria-label="Buscar" autocomplete="off"><button class="pbtn dark" type="submit">Buscar</button></form></section>
      <section class="hm-alerts">
        ${alert(hoy.length, "Vencen hoy", "today", "control:today")}
        ${alert(vencidos.length + espera.length, "Vencidos / esperando fecha", "bad", espera.length && !vencidos.length ? "control:hold" : "control:bad")}
        ${alert(pronto.length, "Vencen en 3 días", "warn", "control:warn")}
        ${alert(st.pendingReview ?? 0, "Pagos por revisar", "pay", "aprobacion")}
        ${alert(sinPago.length, "Sin pagar", "nopay", "control:nopay")}</section>
      <section class="hm-grid">
        ${tile("control", "📊", "Control", "Tu Excel de alquileres")}
        ${tile("control:cobrar", "💰", "Cobrar", "Vencidos y de hoy")}
        ${tile("clientes", "👥", "Clientes", "Revendedores y clientes")}
        ${tile("control:dia", "📅", "Por día", "Quién vence cada día")}
        ${tile("cuentas", "🔑", "Cuentas", "Correos, perfiles y proveedor")}
        ${tile("whatsapp", "📝", "Mensajes", "Avisos de WhatsApp")}
        ${tile("aprobacion", "✅", "Aprobar pagos", "Comprobantes por QR")}
        ${tile("vender", "🛒", "Vender", "Venta rápida")}
        ${tile("configuracion", "⚙️", "Ajustes", "QR, respaldos, contraseña")}</section>
      <section class="card hm-week"><h2>📅 Mi semana <small>· cuántas cuentas vencen cada día</small></h2>
        <div class="hm-days">${week.map((w) => `<button type="button" class="hm-day hm-${w.lvl[1]}${w.i === 0 ? " hm-ishoy" : ""}" data-hgo="control:fecha:${w.t}" aria-label="${w.i === 0 ? "Hoy" : ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"][new Date(w.t).getDay()]} ${new Date(w.t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" })}: ${w.n ? w.n + " vencen" : "ninguna vence"}">
          <span class="hd-dow">${w.i === 0 ? "Hoy" : ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"][new Date(w.t).getDay()]}</span><small class="hd-date">${new Date(w.t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" })}</small>
          <b class="hd-emoji">${w.lvl[2]}</b><span class="hd-count">${w.n ? `<b>${w.n}</b> vence${w.n > 1 ? "n" : ""}` : "Libre"}</span></button>`).join("")}</div>
        <p class="muted hm-weekhint" style="margin:0">👆 Tocá un día para ver quién vence y cobrar. Esta semana vencen <b>${week.reduce((x, w) => x + w.n, 0)}</b> cuenta(s).</p></section>`;
  },

  async control() {
    const [list, customers] = await Promise.all([api("GET", "/api/admin/assignments"), api("GET", "/api/admin/customers").catch(() => [])]);
    const T = P.tab;
    const DAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const estado = (d, hold) => (hold ? ["ESPERANDO FECHA", "hold"] : d < 0 ? ["VENCIDO", "bad"] : d === 0 ? ["VENCE HOY", "today"] : d <= 3 ? ["POR VENCER", "warn"] : d <= 7 ? ["SEMANA", "week"] : ["ACTIVO", "ok"]);
    const PAY = { pagado: "Pagado", pendiente: "Pendiente", no_pago: "No pagó" };
    const rows = list.map((a, i) => {
      const d = daysLeft(a.customerExpiresAt);
      const price = a.control.price ?? a.productPrice, cost = a.control.cost ?? 0;
      return { ...a, n: i + 1, d, est: estado(d, a.holdOpen), day: DAYS[new Date(a.customerExpiresAt).getDay()], price, cost, gain: price - cost, pay: a.control.payStatus ?? "pagado" };
    });
    const products = [...new Set(rows.map((r) => r.product))];
    const q = (T.cq ?? "").toLowerCase();
    const sameDay = (t, u) => new Date(t).toDateString() === new Date(u).toDateString();
    const view = rows.filter((r) => (!T.cf || T.cf === "todos" || r.est[1] === T.cf || (T.cf === "cobrar" && ["bad", "today", "hold"].includes(r.est[1]))) && (!T.cfrom || sameDay(r.customerExpiresAt, T.cfrom)) && (!T.cday || r.day === T.cday) && (!T.cprod || r.product === T.cprod) && (!T.cpay || r.pay === T.cpay)
      && (!q || `${r.customerName} ${r.customerPhone} ${r.email} ${r.profile} ${r.control.seller ?? ""} ${r.control.note ?? ""}`.toLowerCase().includes(q)));
    P.controlView = view;
    const sum = (f) => view.reduce((t, r) => t + f(r), 0);
    const cnt = (k) => rows.filter((r) => r.est[1] === k).length;
    const chips = [["todos", `Todos (${rows.length})`], ["bad", `Vencidos (${cnt("bad")})`], ["hold", `Esperando fecha (${cnt("hold")})`], ["today", `Vence hoy (${cnt("today")})`], ["warn", `Por vencer (${cnt("warn")})`], ["week", `Semana (${cnt("week")})`], ["ok", `Activos (${cnt("ok")})`]];
    const msg = (r) => `Hola ${r.customerName} 👋 te recuerdo que tu ${r.product.replace(/ \(alquiler revendedores\)/, "")} ${r.d < 0 ? "venció" : "vence"} el ${fdate(r.customerExpiresAt)}. Monto: ${bs(r.price)}. ¿Deseas renovar?`;
    const acc = (r) => `*${r.product.replace(/ \(alquiler revendedores\)/, "")}*\nCorreo: ${r.email}\nPerfil: ${r.profile}\nVence: ${fdate(r.customerExpiresAt)}`;
    const newDate = (r) => fdate(Math.max(r.customerExpiresAt, Date.now()) + (r.durationDays ?? 30) * 86400000);
    const renewInfo = (r) => `Renovar este alquiler:\n\n📧 ${r.email}\n👤 ${r.profile}\n🗓️ Nueva fecha: ${newDate(r)}\n\n¿Confirmás la renovación (+1 período)?`;
    const transferForm = (r) => `<details class="more"><summary>👤 Pasar a otro</summary><form class="inline" data-transfer="${esc(r.id)}" style="margin-top:6px"><select name="to" required aria-label="Nuevo dueño"><option value="">Pasar a…</option>${customers.filter((c) => c.id !== r.customerId).map((c) => opt(c.id, c.name)).join("")}</select><input name="reason" placeholder="Motivo (no renovó)" required><button class="pbtn sm" type="submit">Pasar y avisar</button></form><small class="muted">Queda con el mismo perfil y la misma fecha. Al anterior le dejan de llegar los códigos.</small></details>`;
    return `<section class="card ctl-top">
        <div class="ctl-kpis"><div><small>Alquileres</small><b>${view.length}</b></div><div><small>Por cobrar (precio)</small><b>${bs(sum((r) => r.price))}</b></div><div><small>Costo</small><b>${bs(sum((r) => r.cost))}</b></div><div><small>Ganancia</small><b class="up">${bs(sum((r) => r.gain))}</b></div><div><small>Pendientes de pago</small><b class="${view.some((r) => r.pay !== "pagado") ? "down" : ""}">${view.filter((r) => r.pay !== "pagado").length}</b></div></div>
        ${T.cf === "cobrar" || T.cfrom ? `<div class="pok">${T.cf === "cobrar" ? "Mostrando los que tenés que cobrar: vencidos, de hoy y esperando fecha." : `Mostrando los que vencen el ${fdate(T.cfrom)}.`} <button class="pbtn sm" type="button" data-hgo="control">Ver todos</button></div>` : ""}
        <div class="tabs ctl-chips" role="tablist">${chips.map(([k, t]) => `<button type="button" role="tab" data-tab="cf:${k}" aria-selected="${(T.cf ?? "todos") === k}">${t}</button>`).join("")}</div>
        <div class="inline ctl-filters"><input id="cq" placeholder="Buscar cliente, WhatsApp, correo, revendedor…" value="${esc(T.cq ?? "")}" aria-label="Buscar">
          <select id="cday" aria-label="Día que vence">${opt("", "Día que vence: todos", !T.cday)}${["lunes", "martes", "miércoles", "jueves", "viernes", "sábado", "domingo"].map((d) => opt(d, `Vence ${d} (${rows.filter((r) => r.day === d).length})`, T.cday === d)).join("")}</select>
          <select id="cprod" aria-label="Plataforma">${opt("", "Plataforma: todas", !T.cprod)}${products.map((x) => opt(x, x.replace(/ \(alquiler revendedores\)/, ""), T.cprod === x)).join("")}</select>
          <select id="cpay" aria-label="Estado de pago">${opt("", "Pago: todos", !T.cpay)}${Object.entries(PAY).map(([k, t]) => opt(k, t, T.cpay === k)).join("")}</select>
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
      <section class="ctl-cards">${view.map((r) => `<article class="ccard rv-${r.est[1]}">
        <header><label class="ccheck"><input type="checkbox" class="csel" value="${esc(r.id)}" aria-label="Seleccionar ${esc(r.customerName)}"></label>
          <div><b>${esc(r.customerName)}</b> <small class="muted">#${r.n}</small><br><small>${esc(r.product.replace(/ \(alquiler revendedores\)/, ""))} · ${esc(r.profile)}</small></div>
          <span class="est est-${r.est[1]}">${r.est[0]}${r.est[1] === "hold" ? "" : ` · ${r.d} d`}</span></header>
        <div class="crow mono">${esc(r.email)}</div>
        <div class="crow"><span>Vence <b>${fdate(r.customerExpiresAt)}</b> (${r.day})</span><span>Inicio ${fdate(r.startsAt)}</span></div>
        <div class="crow"><label>Precio <input class="ctl-in" data-ctl="${esc(r.id)}" data-f="price" value="${(r.price / 100).toString()}" inputmode="decimal"></label>
          <select class="ctl-in pay-${r.pay}" data-ctl="${esc(r.id)}" data-f="payStatus" aria-label="Estado de pago">${Object.entries(PAY).map(([k, t]) => opt(k, t, r.pay === k)).join("")}</select>
          ${r.customerPhone ? "" : `<span class="pp pp-warn">Sin WhatsApp</span>`}</div>
        ${r.control.note || r.control.seller ? `<div class="crow muted">${esc([r.control.seller, r.control.note].filter(Boolean).join(" · "))}</div>` : ""}
        <footer>${r.customerPhone ? `<a class="pbtn sm" href="${waLink(r.customerPhone, msg(r))}" target="_blank" rel="noopener">💰 Cobrar</a>` : ""}
          <button class="pbtn sm" type="button" data-copy="${esc(acc(r))}">💻 Cuenta</button>
          <button class="pbtn sm dark" type="button" data-renew="${esc(r.id)}" data-renewinfo="${esc(renewInfo(r))}">✅ Renovar · ${newDate(r)}</button>
          <details class="more"><summary>📅 Fecha</summary><form class="inline" data-expiry="${esc(r.id)}"><input type="date" name="date" required value="${new Date(Math.max(r.customerExpiresAt, Date.now())).toISOString().slice(0, 10)}" aria-label="Nueva fecha"><button class="pbtn sm" type="submit">Guardar</button></form></details>
          ${canReview() ? transferForm(r) : ""}</footer></article>`).join("") || `<div class="emptybox">Nada con esos filtros.</div>`}</section>
      <div class="ctl-bar" id="ctlBar" hidden><b><span id="ctlN">0</span> ✓</b>
        <button class="pbtn sm dark" type="button" data-cbulk="renew">✅ Renovar +1</button>
        <button class="pbtn sm" type="button" data-cbulk="paid">💵 Pagado</button>
        <button class="pbtn sm" type="button" data-cbulk="clear" aria-label="Quitar selección">✕</button>
        <span class="inline"><input type="date" id="cbDate" aria-label="Fecha para las seleccionadas"><button class="pbtn sm" type="button" data-cbulk="date">📅 Poner fecha</button></span>
        <label class="chk"><input type="checkbox" id="cbBeyond"> renovar aunque pase la fecha del proveedor</label></div>
      <section class="card ctl-card">${view.length ? `<div class="scroll ctl-scroll"><table class="ctl"><thead><tr>
        <th><input type="checkbox" id="cselAllT" aria-label="Seleccionar todo"></th><th>N°</th><th>Cliente</th><th>WhatsApp</th><th>Plataforma</th><th>Correo</th><th>Perfil</th><th>Inicio</th><th>Vencimiento</th><th>Día vence</th><th>Precio Bs</th><th>Costo Bs</th><th>Ganancia Bs</th><th>Estado pago</th><th>Estado</th><th>Días</th><th>Revendedor</th><th>Nota</th><th>Acciones</th></tr></thead><tbody>
        ${view.map((r) => `<tr class="rv-${r.est[1]}">
          <td><input type="checkbox" class="csel" value="${esc(r.id)}" aria-label="Seleccionar"></td><td class="mono">${r.n}</td><td><b>${esc(r.customerName)}</b></td>
          <td class="mono">${r.customerPhone ? esc(r.customerPhone.replace(/^\+591/, "")) : `<span class="pp pp-warn">Sin WhatsApp</span>`}</td>
          <td>${esc(r.product.replace(/ \(alquiler revendedores\)/, ""))}</td><td class="mono">${esc(r.email)}</td><td>${esc(r.profile)}</td>
          <td>${fdate(r.startsAt)}</td><td><b>${fdate(r.customerExpiresAt)}</b></td><td>${r.day}</td>
          <td><input class="ctl-in" data-ctl="${esc(r.id)}" data-f="price" value="${(r.price / 100).toString()}" inputmode="decimal" aria-label="Precio"></td>
          <td><input class="ctl-in" data-ctl="${esc(r.id)}" data-f="cost" value="${(r.cost / 100).toString()}" inputmode="decimal" aria-label="Costo"></td>
          <td class="${r.gain < 0 ? "down" : "up"}"><b>${(r.gain / 100).toString()}</b></td>
          <td><select class="ctl-in pay-${r.pay}" data-ctl="${esc(r.id)}" data-f="payStatus" aria-label="Estado de pago">${Object.entries(PAY).map(([k, t]) => opt(k, t, r.pay === k)).join("")}</select></td>
          <td><span class="est est-${r.est[1]}">${r.est[0]}</span></td><td class="mono"><b>${r.d}</b></td>
          <td><input class="ctl-in wide" data-ctl="${esc(r.id)}" data-f="seller" value="${esc(r.control.seller ?? "")}" aria-label="Revendedor"></td>
          <td><input class="ctl-in wide" data-ctl="${esc(r.id)}" data-f="note" value="${esc(r.control.note ?? "")}" aria-label="Nota"></td>
          <td class="ctl-act">${r.customerPhone ? `<a class="pbtn sm" href="${waLink(r.customerPhone, msg(r))}" target="_blank" rel="noopener" title="Mandar recordatorio de cobro">💰 Cobrar</a>` : ""}
            <button class="pbtn sm" type="button" data-copy="${esc(acc(r))}" title="Copiar datos de la cuenta">💻 Cuenta</button>
            <button class="pbtn sm dark" type="button" data-renew="${esc(r.id)}" data-renewinfo="${esc(renewInfo(r))}" title="Renovar un período">✅ Renovar · ${newDate(r)}</button>
            <details class="more"><summary>📅 Fecha</summary><form class="inline" data-expiry="${esc(r.id)}"><input type="date" name="date" required value="${new Date(Math.max(r.customerExpiresAt, Date.now())).toISOString().slice(0, 10)}" aria-label="Nueva fecha"><button class="pbtn sm" type="submit">Guardar</button></form></details>
            ${canReview() ? transferForm(r) : ""}</td></tr>`).join("")}
        </tbody></table></div>` : `<div class="emptybox">Nada con esos filtros.</div>`}
        <p class="muted" style="margin:0">Los cambios de precio, costo, pago, revendedor y nota se guardan solos al salir de la casilla. “✅ Renovada” suma un período desde el vencimiento.</p></section>`;
  },

  async renovar() {
    const [list, customers] = await Promise.all([api("GET", "/api/admin/assignments"), api("GET", "/api/admin/customers")]);
    return `<section class="card"><div class="inline"><button class="pbtn dark sm" type="button" data-renewsel="1">${icon("renew")}Renovar seleccionados (+1 período, efectivo)</button><span class="muted">${list.length} servicios activos</span></div>
      ${table(["<input type=checkbox id=selAll aria-label='Seleccionar todo'>", "Cliente", "Producto", "Cuenta / perfil", "Vence cliente", "Vence proveedor", "Acciones"], list.map((a) => {
        const d = daysLeft(a.customerExpiresAt);
        return `<tr><td><input type="checkbox" class="sel" value="${esc(a.id)}" aria-label="Seleccionar"></td><td>${esc(a.customerName)}${a.customerPhone ? "" : `<br>${pill("Sin WhatsApp", "warn")}`}</td><td>${esc(a.product)}</td><td class="mono">${esc(a.email)}<br><small class="muted">${esc(a.profile)}${a.passwordPending ? " · clave pendiente" : ""}</small></td>
          <td>${fdate(a.customerExpiresAt)} ${d <= 3 ? pill(d < 0 ? "Vencido" : `${d} d`, d < 0 ? "bad" : "warn") : ""}${a.holdOpen ? `<br>${pill("Esperando fecha", "mute")}` : ""}</td><td>${fdate(a.supplierExpiresAt)}</td>
          <td><button class="pbtn sm dark" type="button" data-renew="${esc(a.id)}">+1 período</button>
          <details class="more" ${a.holdOpen ? "open" : ""}><summary>Cambiar fecha</summary><form class="inline" data-expiry="${esc(a.id)}" style="margin-top:6px"><input type="date" name="date" required value="${new Date(Math.max(a.customerExpiresAt, Date.now())).toISOString().slice(0, 10)}" aria-label="Nueva fecha de vencimiento"><button class="pbtn sm" type="submit">Guardar</button></form></details>
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
      <button class="pbtn" type="button" data-remind="${days}">${icon("bell")}Mandar ahora a estos (manual)</button></div>
      ${table(["Cliente", "Producto", "Vence", "Último recordatorio"], list.map((a) => `<tr><td>${esc(a.customerName)}</td><td>${esc(a.product)}</td><td>${fdate(a.customerExpiresAt)} ${pill(daysLeft(a.customerExpiresAt) < 0 ? "Vencido" : `${daysLeft(a.customerExpiresAt)} d`, "warn")}</td><td>${a.lastReminderAt ? fdt(a.lastReminderAt) : "Nunca"}</td></tr>`), "Nadie vence en ese plazo.")}
      <p class="muted" style="margin:0">“Preparar” deja un mensaje por cliente en <b>WhatsApp</b> (máximo uno por día). Desde ahí los mandás.</p></section>`;
  },

  async cuentas() {
    const show = P.tab.secrets && canReview();
    const [accs, products, suppliers, customers] = await Promise.all([api("GET", "/api/admin/accounts" + (show ? "?secrets=1" : "")), api("GET", "/api/admin/products"), api("GET", "/api/admin/suppliers"), api("GET", "/api/admin/customers").catch(() => [])]);
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
            <div class="inline">${sl.assignmentId ? `<button class="pbtn green" type="button" data-deliver="${esc(sl.assignmentId)}">📲 Enviar accesos</button>` : ""}<button class="pbtn dark" type="button" data-slotrelease="${esc(sl.id)}">🔓 Liberar para vender</button>${sl.customerPhone ? `<a class="pbtn" href="${waLink(sl.customerPhone, `Hola ${(sl.customerName || "").split(" ")[0]} 👋`)}" target="_blank" rel="noopener">${icon("wa")}WhatsApp</a>` : ""}<button class="pbtn" type="button" data-tab="slotAct:">Cerrar</button></div>
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
            <label>Proveedor<select name="supplierId">${suppliers.map((s) => opt(s.id, s.name, s.id === a.supplierId)).join("")}</select></label>
            <label>Vence con el proveedor<input name="exp" type="date" value="${dateInput(a.supplierExpiresAt)}"></label>
            <label>Costo (Bs)<input name="cost" inputmode="decimal" value="${a.cost / 100}"></label>
            <label style="grid-column:1/-1">Notas internas<input name="notes" maxlength="500" value="${esc(a.notes ?? "")}" placeholder="Ej.: el proveedor cambió la clave el sábado"></label>
            <div style="grid-column:1/-1;display:grid;gap:6px;max-width:560px"><div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;gap:8px" class="muted"><small>Perfil</small><small>PIN</small><small>Estado</small></div>
            ${a.slots.filter((s) => s.status !== "retired").map((s) => `<div style="display:grid;grid-template-columns:minmax(0,2fr) minmax(0,1fr) auto;gap:8px;align-items:center"><input name="label-${esc(s.id)}" value="${esc(s.label)}" aria-label="Nombre del perfil"><input name="pin-${esc(s.id)}" value="${esc(s.pin ?? "")}" placeholder="Sin PIN" inputmode="numeric" maxlength="8" aria-label="PIN de ${esc(s.label)}"><small class="muted">${{ available: "libre", reserved: "reservado", assigned: "vendido", quarantined: "cuarentena" }[s.status] ?? s.status}</small></div>`).join("")}</div>
            <div class="inline" style="grid-column:1/-1"><button class="pbtn dark" type="submit">Guardar cambios</button><button class="pbtn" type="button" data-editaccopen="">Cancelar</button></div><small class="muted" style="grid-column:1/-1">Si cambiás email o contraseña, los clientes ven el dato nuevo en Mis cuentas y les queda un aviso en WhatsApp.</small></form></section>` : "";
    const estadoTxt = { available: "Libre", reserved: "Reservado", assigned: "Vendido", quarantined: "Cuarentena", retired: "Retirado" };
    const estadoK = { available: "ok", assigned: "warn", reserved: "mute", quarantined: "bad", retired: "mute" };
    const cards = accs.map((a) => {
      const d = daysLeft(a.supplierExpiresAt);
      const libres = a.slots.filter((s) => s.status === "available").length;
      const vivos = a.slots.filter((s) => s.status !== "retired");
      return `<article class="acard">
        <header><div><b>${esc(pname(a.productId))}</b><small class="mono">${esc(a.email)}</small></div>${a.status === "active" ? pill(`${libres} libre${libres === 1 ? "" : "s"}`, libres ? "ok" : "mute") : pill("Retirada", "mute")}</header>
        ${a.notes ? `<p class="anote">📝 ${esc(a.notes)}</p>` : ""}
        <div class="arow"><span class="muted">🔑 Clave</span><b class="mono">${esc(a.password)}</b></div>
        <div class="arow"><span class="muted">🏷️ Proveedor</span><span>${esc(suppliers.find((s) => s.id === a.supplierId)?.name ?? a.supplierId)}</span></div>
        <div class="arow"><span class="muted">📅 Vence</span><span>${fdate(a.supplierExpiresAt)} ${d <= 7 ? pill(d < 0 ? "Vencida" : `${d} d`, "warn") : ""}</span></div>
        <div class="achips">${vivos.map((s) => `<button type="button" class="achip ac-${estadoK[s.status] ?? "mute"}${canReview() ? " clk" : ""}" ${canReview() ? `data-slotact="${esc(s.id)}"` : "disabled"}>${esc(s.label)} · ${estadoTxt[s.status] ?? s.status}${s.status === "assigned" && s.customerName ? ` · ${esc(s.customerName.split(" ")[0])}` : ""}</button>`).join("")}</div>
        ${canReview() ? `<footer><button class="pbtn sm" type="button" data-editaccopen="${esc(a.id)}">${icon("edit")}Editar</button>${a.status === "active" ? `<details class="more"><summary>Cuenta caída</summary><form class="inline" data-down="${esc(a.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo" required><button class="pbtn sm" type="submit">Mover clientes y retirar</button></form></details>` : ""}</footer>` : ""}
      </article>`;
    }).join("");
    return `${slotCard}${editCard}<section class="card"><div class="inline">${canReview() ? `<button class="pbtn sm" type="button" data-secrets="1">${icon("eye")}${show ? "Ocultar contraseñas" : "Mostrar contraseñas"}</button>` : ""}<button class="pbtn sm" type="button" data-go="carga">${icon("plus")}Cargar cuenta</button><span class="muted">${accs.length} cuentas</span></div>
      <div class="acc-cards">${accs.length ? cards : `<div class="emptybox">Todavía no cargaste cuentas.</div>`}</div>
      <div class="acc-table">${table(["Producto", "Email", "Contraseña", "Perfiles", "Proveedor", "Vence proveedor", "Estado", ""], accs.map((a) => {
        const d = daysLeft(a.supplierExpiresAt);
        return `<tr><td>${esc(pname(a.productId))}</td><td class="mono">${esc(a.email)}${a.notes ? `<br><small class="muted" style="font-family:inherit">📝 ${esc(a.notes)}</small>` : ""}</td><td class="mono">${esc(a.password)}</td>
          <td><div style="display:flex;flex-wrap:wrap;gap:4px">${a.slots.map((s) => canReview() ? `<button type="button" class="pp pp-${{ available: "ok", assigned: "warn", reserved: "mute", quarantined: "bad", retired: "mute" }[s.status]} clk" data-slotact="${esc(s.id)}" style="border:0;cursor:pointer;font:inherit">${esc(s.label)}: ${{ available: "libre", reserved: "reservado", assigned: "vendido", quarantined: "cuarentena", retired: "retirado" }[s.status]}${s.status === "assigned" && s.customerName ? ` · ${esc(s.customerName.split(" ")[0])}` : ""}</button>` : pill(`${s.label}: ${{ available: "libre", reserved: "reservado", assigned: "vendido", quarantined: "cuarentena", retired: "retirado" }[s.status]}`, { available: "ok", assigned: "warn", reserved: "mute", quarantined: "bad", retired: "mute" }[s.status])).join("")}</div></td>
          <td>${esc(suppliers.find((s) => s.id === a.supplierId)?.name ?? a.supplierId)}</td><td>${fdate(a.supplierExpiresAt)} ${d <= 7 ? pill(d < 0 ? "Vencida" : `${d} d`, "warn") : ""}</td>
          <td>${a.status === "active" ? pill("Activa", "ok") : pill("Retirada", "mute")}</td>
          <td>${canReview() ? `<button class="pbtn sm" type="button" data-editaccopen="${esc(a.id)}">${icon("edit")}Editar</button>` : ""}
          ${a.status === "active" && canReview() ? `<details class="more"><summary>Cuenta caída</summary><form class="inline" data-down="${esc(a.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo" required><button class="pbtn sm" type="submit">Mover clientes y retirar</button></form></details>` : ""}</td></tr>`;
      }), "Todavía no cargaste cuentas.")}</div></section>`;
  },

  async carga() {
    const [products, suppliers] = await Promise.all([api("GET", "/api/admin/products"), api("GET", "/api/admin/suppliers")]);
    if (!products.length || !suppliers.length) return `<section class="card"><div class="emptybox">Antes de cargar cuentas necesitás al menos un producto y un proveedor.<div class="inline">${!products.length ? `<button class="pbtn dark" type="button" data-go="productos">Crear producto</button>` : ""}${!suppliers.length ? `<button class="pbtn dark" type="button" data-go="proveedores">Crear proveedor</button>` : ""}</div></div></section>`;
    const sel = (name) => `<select name="${name}">${(name === "productId" ? products : suppliers.filter((s) => s.active)).map((x) => opt(x.id, x.name)).join("")}</select>`;
    const last = (() => { try { return JSON.parse(localStorage.getItem("gs-carga") || "{}"); } catch { return {}; } })();
    const guessN = (id) => { const p = products.find((x) => x.id === id); const t = `${id} ${p?.name ?? ""}`.toLowerCase(); return /disney/.test(t) ? 7 : /prime|amazon/.test(t) ? 6 : 5; };
    const lastProd = products.some((p) => p.id === last.productId) ? last.productId : products[0].id;
    return `<section class="card ok-card"><h2>${icon("plus")}Carga rápida <small>· pegá correo y clave, recuerda lo demás</small></h2>
      <form class="form" id="quickForm">
        <label>Producto<select name="productId">${products.map((p) => opt(p.id, p.name, p.id === lastProd)).join("")}</select></label>
        <label>Perfiles<input name="n" type="number" min="1" max="20" value="${guessN(lastProd)}"></label>
        <label style="grid-column:1/-1">Correo de la cuenta<input name="email" type="email" required placeholder="correo@gmail.com" autocomplete="off"></label>
        <label style="grid-column:1/-1">Contraseña<input name="password" required placeholder="clave de la cuenta" autocomplete="off"></label>
        <details style="grid-column:1/-1"><summary>Proveedor, vencimiento y costo</summary>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:8px">
            <label>Proveedor<select name="supplierId">${suppliers.filter((s) => s.active).map((s) => opt(s.id, s.name, s.id === last.supplierId)).join("")}</select></label>
            <label>Vence con proveedor<input type="date" name="exp" required value="${last.exp || dateInput(Date.now() + 30 * 864e5)}"></label>
            <label>Costo (Bs)<input name="cost" inputmode="decimal" value="${last.cost ?? 0}"></label></div></details>
        <button class="pbtn dark" type="submit" style="grid-column:1/-1">${icon("plus")}Agregar cuenta (${guessN(lastProd)} perfiles libres)</button></form>
      <p class="muted" style="margin:0">Recuerda el producto, proveedor y fecha de la última vez. Los perfiles se crean <b>libres</b>, listos para asignar en Cuentas.</p></section>
      <section class="card"><h2>Cargar una cuenta <small>· con todos los detalles</small></h2><form class="form" id="accForm">
      <label>Producto${sel("productId")}</label><label>Proveedor${sel("supplierId")}</label>
      <label>Email de la cuenta<input name="email" type="email" required></label><label>Contraseña<input name="password" required></label>
      <label>Cantidad de perfiles<input name="n" type="number" min="1" max="20" value="5"></label><label>PIN (opcional, mismo para todos)<input name="pin" inputmode="numeric" maxlength="8"></label>
      <label>Vence con el proveedor<input name="exp" type="date" required value="${dateInput(Date.now() + 30 * 864e5)}"></label><label>Costo (Bs)<input name="cost" inputmode="decimal" value="0"></label>
      <button class="pbtn dark" type="submit">${icon("plus")}Guardar cuenta</button></form></section>
      <section class="card"><h2>Carga por lista <small>· una cuenta por línea: email, contraseña, perfiles, vence (AAAA-MM-DD)</small></h2><form class="form" id="bulkForm" style="grid-template-columns:repeat(auto-fit,minmax(200px,1fr))">
      <label>Producto${sel("productId")}</label><label>Proveedor${sel("supplierId")}</label><label>Costo por cuenta (Bs)<input name="cost" inputmode="decimal" value="0"></label>
      <textarea name="rows" rows="5" style="grid-column:1/-1" placeholder="cuenta1@correo.com, Clave#1, 5, 2026-12-31&#10;cuenta2@correo.com, Clave#2, 5, 2026-12-31" aria-label="Lista de cuentas"></textarea>
      <button class="pbtn dark" type="submit" style="justify-self:start">Cargar lista</button></form><div id="bulkOut"></div></section>`;
  },

  async productos() {
    const [products, groups, stock] = await Promise.all([api("GET", "/api/admin/products"), api("GET", "/api/admin/price-groups"), api("GET", "/api/admin/stock")]);
    const rev = groups.find((g) => g.id === "revendedor");
    const edit = products.find((p) => p.id === P.tab.editProduct);
    const f = edit ?? { name: "", category: "", description: "", kind: "profile", durationDays: 30, price: 0, color: "#3984ff", published: true };
    return `<section class="card"><h2>${edit ? `Editar ${esc(edit.name)}` : "Nuevo producto"}</h2><form class="form" id="prodForm" data-id="${esc(edit?.id ?? "")}">
      <label>Nombre<input name="name" required maxlength="60" value="${esc(f.name)}"></label><label>Categoría<input name="category" maxlength="40" value="${esc(f.category ?? "")}" placeholder="Streaming, IA, Educación…"></label>
      <label>Tipo<select name="kind">${[["profile", "Perfil"], ["full_account", "Cuenta completa"], ["invite", "Invitación"], ["combo", "Combo"]].map(([v, t]) => opt(v, t, v === f.kind)).join("")}</select></label>
      <label>Duración (días)<input name="durationDays" type="number" min="1" value="${f.durationDays}"></label><label>Precio (Bs)<input name="price" inputmode="decimal" required value="${f.price / 100}"></label>
      <label>Precio revendedor (Bs, opcional)<input name="resPrice" inputmode="decimal" value="${rev?.prices[edit?.id] !== undefined ? rev.prices[edit.id] / 100 : ""}"></label>
      <label>Color de la tarjeta<input name="color" type="color" value="${esc(f.color ?? "#3984ff")}"></label>
      <label style="grid-column:1/-1">Descripción corta<input name="description" maxlength="200" value="${esc(f.description ?? "")}"></label>
      <label>Visible para<select name="audience">${opt("all", "Todos (tienda pública)", f.published && !f.resellersOnly)}${opt("resellers", "Solo revendedores (ven precio, compran y renuevan con saldo)", f.published && f.resellersOnly)}${opt("none", "Nadie (oculto, solo el panel)", !f.published)}</select></label>
      <div class="inline"><button class="pbtn dark" type="submit">${edit ? "Guardar cambios" : "Crear producto"}</button>${edit ? `<button class="pbtn" type="button" data-editprod="">Cancelar</button>` : ""}</div></form>
      ${edit ? `<form class="inline" id="prodImg" data-id="${esc(edit.id)}" style="margin-top:12px">${edit.imageFileRef ? `<img src="/api/products/${esc(edit.id)}/image?v=${Date.now() % 1e6}" alt="" style="width:56px;height:56px;object-fit:contain;border-radius:12px;background:#0e1424;padding:6px">` : `<span class="muted">Sin logo: se ve la inicial.</span>`}
        <input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Logo del producto"><button class="pbtn dark" type="submit">${edit.imageFileRef ? "Cambiar logo" : "Subir logo"}</button>${edit.imageFileRef ? `<button class="pbtn" type="button" data-noprodimg="${esc(edit.id)}">Quitar</button>` : ""}</form>` : `<p class="muted" style="margin:10px 0 0">Después de crearlo, tocá <b>Editar</b> para subirle el logo.</p>`}</section>
      <section class="card"><h2>Productos <small>· ${products.length}</small></h2>${table(["Producto", "Tipo", "Precio", "Revendedor", "Duración", "Stock libre", "Tienda", ""], products.map((p) => `<tr>
        <td>${p.imageFileRef ? `<img src="/api/products/${esc(p.id)}/image" alt="" style="width:22px;height:22px;object-fit:contain;vertical-align:middle;margin-right:6px">` : `<span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${esc(p.color ?? "#3984ff")};margin-right:6px"></span>`}${esc(p.name)}<br><small class="muted">${esc(p.category ?? "")}</small></td>
        <td>${esc({ profile: "Perfil", full_account: "Cuenta", invite: "Invitación", combo: "Combo" }[p.kind])}</td><td>${bs(p.price)}</td><td>${rev?.prices[p.id] !== undefined ? bs(rev.prices[p.id]) : "—"}</td>
        <td>${p.durationDays} días</td><td>${stock[p.id]?.available ?? 0}</td><td>${!p.published ? pill("Oculto", "mute") : p.resellersOnly ? pill("Solo revendedores", "warn") : pill("Publicado", "ok")}</td>
        <td><button class="pbtn sm" type="button" data-editprod="${esc(p.id)}">${icon("edit")}Editar</button></td></tr>`), "Todavía no hay productos.")}</section>`;
  },

  async proveedores() {
    const [list, report] = await Promise.all([api("GET", "/api/admin/suppliers"), canReview() ? api("GET", "/api/admin/suppliers-report") : Promise.resolve([])]);
    return `<section class="card"><h2>Nuevo proveedor</h2><form class="form" id="supForm"><label>Nombre<input name="name" required></label><label>Contacto (opcional)<input name="contact"></label><button class="pbtn dark" type="submit">${icon("plus")}Agregar</button></form></section>
      <section class="card"><h2>Proveedores</h2>${table(["Proveedor", "Cuentas", "Vendidos", "Cuarentena", "Costo", "Ingreso", "Margen", "Por vencer (7 d)", ""], list.map((s) => {
        const r = report.find((x) => x.supplierId === s.id);
        return `<tr><td>${esc(s.name)}<br><small class="muted">${esc(s.contact ?? "")}</small></td><td>${r?.activeAccounts ?? "—"}</td><td>${r?.assigned ?? "—"}</td><td>${r?.quarantined ?? "—"}</td>
          <td>${r ? bs(r.cost) : "—"}</td><td>${r ? bs(r.revenue) : "—"}</td><td class="${r && r.margin < 0 ? "down" : "up"}">${r ? bs(r.margin) : "—"}</td>
          <td>${r?.expiringIn7Days.length ? r.expiringIn7Days.map((a) => `<small class="mono">${esc(a.email)}</small>`).join("<br>") : "—"}</td>
          <td>${canReview() ? `<button class="pbtn sm" type="button" data-supactive="${esc(s.id)}" data-on="${s.active ? 0 : 1}">${s.active ? "Desactivar" : "Activar"}</button>` : ""}</td></tr>`;
      }), "Todavía no hay proveedores.")}</section>`;
  },

  async clientes() {
    const q = P.tab.q ?? "";
    const list = await api("GET", "/api/admin/customers?q=" + encodeURIComponent(q));
    const link = P.tab.link;
    const ledger = P.tab.ledger ? await api("GET", `/api/admin/customers/${P.tab.ledger}/ledger`) : null;
    const lc = list.find((c) => c.id === P.tab.ledger);
    const ec = list.find((c) => c.id === P.tab.editCus) ?? (P.tab.editCus ? (await api("GET", "/api/admin/customers")).find((c) => c.id === P.tab.editCus) : null);
    return `${link ? `<section class="card ok-card"><h2>🔑 Acceso para ${esc(link.name)}</h2>
        <div class="linkbar"><span class="muted">Entra en</span><b>${esc(link.url)}</b><button class="pbtn sm" type="button" data-copy="${esc(link.url)}">${icon("copy")}Copiar</button></div>
        <div class="linkbar"><span class="muted">Con su número y PIN</span><b>${esc(link.phone)} · PIN ${esc(link.pin)}</b><button class="pbtn sm" type="button" data-copy="${esc(link.pin)}">${icon("copy")}Copiar PIN</button></div>
        <div class="inline"><a class="pbtn green" href="${waLink(link.phone, `Hola ${link.name.split(" ")[0]} 👋 para entrar a ${P.settings.storeName} y ver tus servicios:\n👉 ${link.url}\n📱 Tu número: ${link.phone}\n🔑 Tu PIN: ${link.pin}\n(Guardalo; lo podés cambiar adentro.)`)}" target="_blank" rel="noopener">${icon("wa")}Mandar por WhatsApp</a><button class="pbtn" type="button" data-tab="link:">Cerrar</button></div>
        <p class="muted" style="margin:0">El PIN no vence. Si lo pierde, tocá de nuevo el botón y se genera uno nuevo (el anterior deja de servir).</p></section>` : ""}
      ${ledger ? `<section class="card"><h2>Saldo de ${esc(lc?.name)} · ${bs(lc?.balance ?? 0)} <button class="pbtn sm" type="button" data-ledger="">Cerrar</button></h2>${table(["Fecha", "Tipo", "Referencia", "Monto", "Saldo"], ledger.slice().reverse().map((m) => `<tr><td>${fdt(m.at)}</td><td>${esc(m.type)}</td><td>${esc(m.ref)}${m.note ? `<br><small class="muted">${esc(m.note)}</small>` : ""}</td><td class="${m.amount < 0 ? "down" : "up"}">${bs(m.amount)}</td><td>${bs(m.balanceAfter)}</td></tr>`), "Sin movimientos.")}
        ${isOwner() ? `<form class="inline" id="adjForm" data-id="${esc(P.tab.ledger)}"><input name="amount" inputmode="decimal" placeholder="Monto Bs (negativo para descontar)" required><input name="reason" placeholder="Motivo" required><button class="pbtn dark sm" type="submit">Ajustar saldo</button></form>` : ""}</section>` : ""}
      ${ec ? `<section class="card"><h2>Editar ${esc(ec.name)} <button class="pbtn sm" type="button" data-editcus="">Cerrar</button></h2><form class="form" id="editCusForm" data-id="${esc(ec.id)}">
        <label>Nombre<input name="name" required maxlength="80" value="${esc(ec.name)}"></label><label>WhatsApp<input name="phone" required inputmode="tel" value="${esc(ec.phone)}"></label><label>Email<input name="email" type="email" value="${esc(ec.email ?? "")}"></label>
        ${canReview() ? `<label>Tipo<select name="kind">${opt("customer", "Cliente", ec.kind === "customer")}${opt("reseller", "Revendedor", ec.kind === "reseller")}</select></label>` : ""}
        <label style="grid-column:1/-1">Notas internas (el cliente no las ve)<input name="notes" maxlength="500" value="${esc(ec.notes ?? "")}" placeholder="Ej.: paga los viernes, prefiere perfil 1"></label>
        <label class="chk"><input type="checkbox" name="consent" ${ec.whatsappConsent ? "checked" : ""}> Acepta avisos por WhatsApp</label><button class="pbtn dark" type="submit">Guardar cambios</button></form></section>` : ""}
      <section class="card"><h2>Nuevo cliente</h2><form class="form" id="cusForm"><label>Nombre<input name="name" required></label><label>WhatsApp<input name="phone" required inputmode="tel" placeholder="+591 7…"></label><label>Email (opcional)<input name="email" type="email"></label>
        <label>Tipo<select name="kind">${opt("customer", "Cliente")}${canReview() ? opt("reseller", "Revendedor") : ""}</select></label><label class="chk"><input type="checkbox" name="consent"> Aceptó recibir avisos por WhatsApp</label><button class="pbtn dark" type="submit">${icon("plus")}Crear</button></form></section>
      <section class="card"><form class="filters" id="cusSearch"><input name="q" placeholder="Buscar por nombre, teléfono o email" value="${esc(q)}" style="flex:5 1 240px" aria-label="Buscar"><button class="pbtn dark" type="submit">${icon("filter")}Buscar</button></form>
      ${canReview() && list.length ? `<div class="inline bulkkind"><span class="muted">${list.filter((c) => c.kind === "reseller").length} revendedores · ${list.filter((c) => c.kind !== "reseller").length} clientes</span>
        <button class="pbtn sm dark" type="button" data-bulkkind="all">👥 Pasar TODOS a revendedores</button>
        <button class="pbtn sm" type="button" data-bulkkind="sel">Marcados → Revendedor</button>
        <button class="pbtn sm" type="button" data-bulkkind="selc">Marcados → Cliente</button></div>` : ""}
      ${table([canReview() ? "<input type=checkbox id=cusAll aria-label='Marcar todos'>" : "", "Nombre", "WhatsApp", "Tipo", "Servicios", "Saldo", "Avisos", "Acciones"], list.map((c) => `<tr><td>${canReview() ? `<input type="checkbox" class="cussel" value="${esc(c.id)}" aria-label="Marcar ${esc(c.name)}">` : ""}</td><td>${esc(c.name)}${c.notes ? `<br><small class="muted">📝 ${esc(c.notes)}</small>` : ""}</td><td><a href="https://wa.me/${esc(c.phone.replace(/\D/g, ""))}" target="_blank" rel="noopener">${esc(c.phone)}</a></td>
        <td>${c.kind === "reseller" ? pill("Revendedor", "warn") : "Cliente"}</td><td>${c.activeServices}</td><td>${bs(c.balance)}</td><td>${c.whatsappConsent ? pill("Sí", "ok") : pill("No", "mute")}</td>
        <td><div class="acts"><button class="pbtn sm" type="button" data-link="${esc(c.id)}">🔑 PIN de acceso</button><button class="pbtn sm" type="button" data-ledger="${esc(c.id)}">${icon("coins")}Saldo</button><button class="pbtn sm" type="button" data-editcus="${esc(c.id)}">${icon("edit")}Editar</button></div></td></tr>`), q ? "Nadie coincide con la búsqueda." : "Todavía no hay clientes.")}</section>`;
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
        <form class="inline" id="importForm"><input type="file" name="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required aria-label="Archivo de clientes"><button class="pbtn dark" type="submit">Ver vista previa</button></form>
        ${imp ? `<div style="display:grid;gap:10px">
          <div class="inline">${pill(`${imp.result.summary.nuevos} nuevos`, "ok")} ${pill(`${imp.result.summary.existentes} ya existen`, "mute")} ${pill(`${imp.result.summary.errores} con error`, imp.result.summary.errores ? "bad" : "mute")}
            <span class="muted">Columnas usadas: Nombre = “${esc(imp.result.columns.nombre)}”, WhatsApp = “${esc(imp.result.columns.whatsapp)}”${imp.result.columns.email ? `, Email = “${esc(imp.result.columns.email)}”` : ""}${imp.result.columns.notas ? `, Notas = “${esc(imp.result.columns.notas)}”` : ""}</span></div>
          ${table(["Fila", "Nombre", "WhatsApp", "Resultado"], imp.result.rows.slice(0, 300).map((r) => `<tr><td>${r.row}</td><td>${esc(r.name)}</td><td class="mono">${esc(r.phone)}</td><td>${r.status === "nuevo" ? pill(imp.result.dryRun ? "Se va a crear" : "Creado", "ok") : r.status === "existe" ? pill(r.error || "Ya existe", "mute") : pill(r.error || "Error", "bad")}</td></tr>`))}
          ${imp.result.rows.length > 300 ? `<p class="muted" style="margin:0">Mostrando 300 de ${imp.result.rows.length} filas.</p>` : ""}
          ${imp.result.dryRun && imp.result.summary.nuevos ? `<div class="inline"><button class="pbtn green" type="button" data-importgo="1">Importar ${imp.result.summary.nuevos} cliente(s)</button><button class="pbtn" type="button" data-importcancel="1">Cancelar</button></div>` : ""}
          ${!imp.result.dryRun ? `<div class="pok">Listo: se crearon ${imp.result.created} cliente(s). Ya los ves en Clientes.</div>` : ""}</div>` : ""}
      </section>
      ${canReview() ? `<section class="card"><h2>Importar servicios actuales <small>· quién tiene qué cuenta, perfil y vencimiento</small></h2>
        <p class="muted" style="margin:0">Una fila por servicio. Columnas obligatorias: <b>Cliente</b>, <b>WhatsApp</b>, <b>Producto</b> (como figura en Productos), <b>Cuenta</b> (correo) y <b>Vence</b> (15/12/2026). Opcionales: <b>Contraseña</b> (obligatoria si la cuenta es nueva), <b>Perfil</b>, <b>PIN</b>, <b>Vence proveedor</b>, <b>Proveedor</b>, <b>Costo</b>.
        Se crean solos los clientes, cuentas y perfiles que falten. No se manda ningún WhatsApp y no cuenta como venta.</p>
        <div class="inline"><a class="pbtn" href="/api/admin/import/template?type=services" download>${icon("ext")}Descargar plantilla de servicios</a></div>
        <form class="inline" id="importSvcForm"><input type="file" name="file" accept=".xlsx,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv" required aria-label="Archivo de servicios"><button class="pbtn dark" type="submit">Ver vista previa</button></form>
        ${P.tab.importSvc ? (() => { const r = P.tab.importSvc.result; return `<div style="display:grid;gap:10px">
          <div class="inline">${pill(`${r.summary.ok} servicios ${r.dryRun ? "listos" : "importados"}`, "ok")} ${pill(`${r.summary.errores} con error`, r.summary.errores ? "bad" : "mute")} ${pill(`${r.summary.clientesNuevos} clientes nuevos`, "mute")} ${pill(`${r.summary.cuentasNuevas} cuentas nuevas`, "mute")} ${pill(`${r.summary.perfilesNuevos} perfiles nuevos`, "mute")} ${r.summary.avisos ? pill(`${r.summary.avisos} avisos`, "warn") : ""}</div>
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
    const [s, shops, testis] = await Promise.all([api("GET", "/api/settings"), api("GET", "/api/admin/shops").catch(() => []), api("GET", "/api/admin/testimonials").catch(() => [])]);
    const ACCENTS = [["#3984ff", "Azul"], ["#7c5cff", "Violeta"], ["#e0368a", "Rosa"], ["#ff5a36", "Naranja"], ["#f2b705", "Dorado"], ["#16b47e", "Verde"], ["#14b8c8", "Turquesa"], ["#e53935", "Rojo"]];
    const BGS = [["#090e1d", "Azul noche"], ["#0b0b0f", "Negro"], ["#140c24", "Violeta oscuro"], ["#07140f", "Verde oscuro"], ["#1a0a10", "Bordó"], ["#111418", "Grafito"],
      ["#f5f7fb", "Blanco"], ["#fff7ec", "Crema"], ["#eaf3ff", "Celeste"], ["#f3efff", "Lila"], ["#ecfbf3", "Menta"], ["#fff0f3", "Rosa claro"]];
    const FONTS = FONT_LIST.map(([id, n, d]) => [id, `${n || "Sistema"} · ${d}`]);
    const CORNERS = [["round", "Redondeados"], ["soft", "Suaves"], ["square", "Rectos"]];
    const sw = (name, list, cur) => `<div class="inline">${list.map(([c, t]) => `<label title="${t}" style="display:grid;justify-items:center;gap:4px;font-size:12px;cursor:pointer;position:relative"><input type="radio" name="${name}" value="${c}" ${c.toLowerCase() === cur.toLowerCase() ? "checked" : ""} style="position:absolute;opacity:0">
      <span class="swatch" style="width:38px;height:38px;border-radius:10px;background:${c};border:3px solid ${c.toLowerCase() === cur.toLowerCase() ? "var(--ink)" : "transparent"};box-shadow:0 0 0 1px var(--line)"></span>${t}</label>`).join("")}
      <label style="display:grid;justify-items:center;gap:4px;font-size:12px">Otro<input type="color" name="${name}Custom" value="${esc(cur)}" style="width:44px;height:38px;padding:2px"></label></div>`;
    return `<section class="card"><h2>Estilos listos</h2><p class="muted" style="margin:0">Tocá uno para probarlo en la vista previa de abajo. Si te gusta, tocá <b>Guardar apariencia</b>.</p>
        <div class="tgrid">${THEMES.map((t) => `<button type="button" class="tcard" data-ptheme="${t.id}">${themeSwatch(t)}<span>${esc(t.name)}</span></button>`).join("")}</div></section>
      <section class="card"><h2>Colores</h2><form id="lookForm" style="display:grid;gap:16px">
        <div><b>Color principal</b> <span class="muted">· botones, precios y detalles</span>${sw("accentColor", ACCENTS, s.accentColor)}</div>
        <div><b>Segundo color</b> <span class="muted">· para los degradados (vacío = automático)</span><div class="inline"><input type="color" name="accent2Color" value="${esc(s.accent2Color || s.accentColor)}" style="width:54px;height:38px;padding:2px"><label class="chk"><input type="checkbox" name="accent2Auto" ${s.accent2Color ? "" : "checked"}> Automático</label></div></div>
        <div><b>Fondo</b> <span class="muted">· oscuro o claro: los textos cambian solos para que siempre se lean</span>${sw("backgroundColor", BGS, s.backgroundColor)}</div>
        <div class="form"><label>Letra de los títulos<select name="headingFont">${FONTS.map(([v, t]) => opt(v, t, v === s.headingFont)).join("")}</select></label>
          <label>Letra del texto<select name="fontFamily">${FONTS.map(([v, t]) => opt(v, t, v === s.fontFamily)).join("")}</select></label>
          <label>Fondo<select name="bgStyle">${BG_LIST.map(([v, t]) => opt(v, t, v === s.bgStyle)).join("")}</select></label>
          <label>Tarjetas<select name="cardStyle">${CARD_LIST.map(([v, t]) => opt(v, t, v === s.cardStyle)).join("")}</select></label>
          <label>Forma de botones y tarjetas<select name="corners">${CORNERS.map(([v, t]) => opt(v, t, v === s.corners)).join("")}</select></label></div>
        <h2 style="margin-top:6px">Textos de la página de inicio</h2>
        <div class="form"><label>Título<input name="heroTitle" maxlength="40" value="${esc(s.heroTitle)}"></label><label>Parte destacada (en color)<input name="heroHighlight" maxlength="40" value="${esc(s.heroHighlight)}"></label>
        <label style="grid-column:1/-1">Descripción<input name="heroText" maxlength="220" value="${esc(s.heroText)}"></label>
        <label style="grid-column:1/-1">Aviso arriba de todo (opcional)<input name="announcement" maxlength="140" value="${esc(s.announcement)}" placeholder="Ej.: Netflix a Bs 30 solo este fin de semana"></label>
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
      <section class="card"><h2>Logo</h2><div class="inline">${s.hasLogo ? `<img src="/api/settings/logo?v=${Date.now()}" alt="Logo actual" style="width:64px;height:64px;border-radius:14px;object-fit:cover;border:1px solid var(--line)"><button class="pbtn sm" type="button" data-nologo="1">Quitar logo</button>` : `<span class="muted">Sin logo: se muestra la inicial de la tienda.</span>`}</div>
        <form class="inline" id="logoForm"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen del logo"><button class="pbtn dark" type="submit">${s.hasLogo ? "Cambiar logo" : "Subir logo"}</button></form><p class="muted" style="margin:0">Imagen cuadrada, idealmente de 256×256 o más.</p></section>
      <section class="card"><h2>Así se ve tu tienda</h2><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <iframe id="lookPreview" data-look="1" src="/tienda/#inicio" title="Vista previa de la tienda en computadora" style="flex:1 1 520px;min-width:0;height:560px;border:1px solid var(--line);border-radius:12px;background:#000"></iframe>
        <iframe data-look="1" src="/tienda/#catalogo" title="Vista previa de la tienda en celular" style="width:300px;max-width:100%;height:560px;border:1px solid var(--line);border-radius:22px;background:#000"></iframe></div></section>`;
  },

  async usuarios() {
    if (!isOwner()) return `<section class="card"><div class="emptybox">Solo el dueño administra usuarios.</div></section>`;
    const list = await api("GET", "/api/admin/staff");
    return `<section class="card"><h2>Nuevo usuario</h2><form class="form" id="staffForm"><label>Nombre<input name="name" required></label><label>Usuario<input name="username" required autocapitalize="none" pattern="[a-z0-9._-]{3,32}" title="3 a 32 minúsculas, números, punto o guion"></label>
      <label>Rol<select name="role">${opt("seller", "Vendedor: vende, renueva y carga clientes")}${opt("admin", "Admin: además aprueba pagos y maneja inventario")}</select></label><label>Contraseña inicial<input name="password" type="password" minlength="10" required></label><button class="pbtn dark" type="submit">${icon("plus")}Crear</button></form></section>
      <section class="card">${table(["Nombre", "Usuario", "Rol", "Estado", "Creado", ""], list.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc({ owner: "Dueño", admin: "Admin", seller: "Vendedor" }[u.role])}</td><td>${u.active ? pill("Activo", "ok") : pill("Inactivo", "mute")}</td><td>${fdate(u.createdAt)}</td>
        <td>${u.role !== "owner" ? `<button class="pbtn sm" type="button" data-staff="${esc(u.id)}" data-on="${u.active ? 0 : 1}">${u.active ? "Desactivar" : "Activar"}</button>` : ""}</td></tr>`))}</section>`;
  },

  async revendedores() {
    const [data, set] = await Promise.all([api("GET", "/api/admin/resellers"), api("GET", "/api/settings")]);
    const { list, apps, rent, marginPct } = data;
    const pending = apps.filter((a) => a.status === "pending");
    const T = P.tab, o = location.origin;
    const q = (T.rq ?? "").toLowerCase();
    const shown = list.filter((r) => !q || `${r.name} ${r.phone} ${r.shop.slug}`.toLowerCase().includes(q));
    const sent = T.rlink;
    return `${pending.length ? `<section class="card ok-card" style="border-color:var(--warn)"><h2>📨 Solicitudes nuevas <small>${pending.length} quieren ser revendedores</small></h2>
      <div class="rgrid">${pending.map((a) => `<div class="rcard"><div class="rtop"><span class="ravatar">${esc(a.name[0] ?? "?")}</span><div><b>${esc(a.name)}</b><small class="muted">${esc(a.phone)} · ${fdt(a.createdAt)}</small></div></div>
        ${a.note ? `<p class="muted" style="margin:0">“${esc(a.note)}”</p>` : ""}${a.existingCustomer ? `<small class="muted">Ya es tu cliente: se pasa a revendedor.</small>` : ""}
        <div class="inline"><button class="pbtn sm green" type="button" data-appok="${esc(a.id)}">✅ Aprobar y mandar acceso</button><a class="pbtn sm" href="${waLink(a.phone, `Hola ${a.name.split(" ")[0]} 👋`)}" target="_blank" rel="noopener">${icon("wa")}Escribirle</a><button class="pbtn sm" type="button" data-appno="${esc(a.id)}">Rechazar</button></div></div>`).join("")}</div></section>` : ""}
    <section class="card"><h2>${icon("userplus")}Nuevo revendedor <small>entra a su panel en ${esc(set.platformName || "GaboHub")}; la página se la activás cuando quieras</small></h2>
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
      </form></section>
    ${sent ? `<section class="card ok-card"><h2>✅ Listo: ${esc(sent.name)}</h2>
      <div class="linkbar"><span class="muted">${sent.code ? "PIN" : "Su página"}</span><b>${esc(sent.code ? sent.page.replace("PIN: ", "") : sent.page)}</b><button class="pbtn sm" type="button" data-copy="${esc(sent.page)}">${icon("copy")}Copiar</button></div>
      ${sent.pin && !sent.code ? `<div class="linkbar"><span class="muted">Entra con su número y PIN</span><b>${esc(sent.phone)} · PIN ${esc(sent.pin)}</b><button class="pbtn sm" type="button" data-copy="${esc(sent.pin)}">${icon("copy")}Copiar PIN</button></div>` : ""}
      <div class="linkbar"><span class="muted">${sent.code ? "Link de códigos" : "Dónde entra"}</span><b>${esc(sent.url)}</b><button class="pbtn sm" type="button" data-copy="${esc(sent.url)}">${icon("copy")}Copiar</button></div>
      <div class="inline"><a class="pbtn green" href="${waLink(sent.phone, sent.msg)}" target="_blank" rel="noopener">${icon("wa")}Mandarle todo por WhatsApp</a><button class="pbtn" type="button" data-tab="rlink:">Cerrar</button></div></section>` : ""}
    <section class="card"><h2>Tus revendedores <small>${list.length}</small><input class="rsearch" id="rq" placeholder="Buscar" value="${esc(T.rq ?? "")}" style="margin-left:auto;max-width:220px"></h2>
      ${shown.length ? `<div class="rgrid">${shown.map((r) => `<div class="rcard">
        <div class="rtop"><span class="ravatar">${esc(r.name[0] ?? "?")}</span><div><b>${esc(r.name)}</b><small class="muted">${esc(r.phone || "sin WhatsApp")}</small></div>${!r.pageAllowed ? pill("Solo panel", "mute") : r.shop.suspended ? pill("Sin pagar alquiler", "bad") : r.shop.enabled && !r.shop.blocked ? pill("Página publicada", "ok") : r.shop.blocked ? pill("Bloqueada", "bad") : pill("Página apagada", "mute")}</div>
        ${r.pageAllowed && rent.enabled && r.shop.enabled ? `<small class="muted">${r.shop.paidUntil ? `Alquiler pagado hasta <b>${fdate(r.shop.paidUntil)}</b>` : "Alquiler: se cobra en la próxima revisión"}</small>` : ""}
        <div class="rstats"><div><span>Saldo</span><b>${bs(r.balance)}</b></div><div><span>Servicios</span><b>${r.services}</b></div><div><span>Sus clientes</span><b>${r.clients}</b></div></div>
        ${r.pageAllowed ? `<div class="linkbar sm"><a href="/r/${esc(r.shop.slug)}" target="_blank" rel="noopener">${esc(o)}/r/${esc(r.shop.slug)}</a><button class="pbtn sm" type="button" data-copy="${esc(o)}/r/${esc(r.shop.slug)}" aria-label="Copiar link">${icon("copy")}</button></div>` : ""}
        <div class="inline">
          <button class="pbtn sm dark" type="button" data-rsend="${esc(r.id)}">${icon("wa")}Nuevo PIN y acceso</button>
          ${r.pageAllowed
            ? `<button class="pbtn sm" type="button" data-rpub="${esc(r.id)}" data-on="${r.shop.enabled ? "" : "1"}">${r.shop.enabled ? "Apagar página" : "Publicar página"}</button>
               <button class="pbtn sm" type="button" data-redit="${esc(r.id)}">${icon("edit")}Dirección</button>
               <button class="pbtn sm" type="button" data-rpage="${esc(r.id)}" data-on="">Quitar página</button>`
            : `<button class="pbtn sm green" type="button" data-rpage="${esc(r.id)}" data-on="1">✦ Habilitar página</button>`}
          <button class="pbtn sm" type="button" data-rcode="${esc(r.id)}">🔗 Link de códigos${r.codeLink ? " ✓" : ""}</button>
          ${isOwner() ? `<button class="pbtn sm" type="button" data-rtop="${esc(r.id)}">${icon("coins")}Cargar saldo</button>` : ""}
        </div></div>`).join("")}</div>` : `<div class="emptybox">${list.length ? "No hay revendedores con esa búsqueda." : "Todavía no tenés revendedores. Creá el primero arriba."}</div>`}
      <p class="muted" style="margin:0">Ellos entran a ${esc(set.platformName || "GaboHub")} con su <b>número y PIN</b> y ven: Precios para comprar con saldo o QR, Mis cuentas, Mis clientes y Mi página para ponerle logo, colores y sus precios. Los precios de revendedor los ponés en Productos → “Precio revendedor” o con “Solo revendedores”.</p></section>
    ${isOwner() ? `<section class="card"><h2>${icon("gear")}Ajustes de revendedores</h2>
      <form class="form" id="resCfg">
        <label>Ganancia sugerida para sus precios (%)<input name="margin" inputmode="numeric" value="${esc(marginPct)}"><small class="muted">El asistente les propone tu precio + este %. Ellos lo pueden cambiar.</small></label>
        <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="rentOn" ${rent.enabled ? "checked" : ""}> Cobrar alquiler mensual por la página (se descuenta solo de su saldo)</label>
        <label>Precio por mes (Bs)<input name="price" inputmode="decimal" value="${rent.price / 100}"></label>
        <label>Gratis si ese mes te compran (Bs, 0 = nunca)<input name="free" inputmode="decimal" value="${rent.freeIfSpent / 100}"></label>
        <label>Días de gracia sin pagar<input name="grace" inputmode="numeric" value="${rent.graceDays}"></label>
        <p class="muted" style="grid-column:1/-1;margin:0">Si no tiene saldo, su página sigue publicada los días de gracia y después se apaga sola. Apenas recarga, se cobra y se prende sola.</p>
        <button class="pbtn dark" type="submit">Guardar ajustes</button></form>
      <form class="form" id="bulkRes" style="border-top:1px solid var(--line);padding-top:14px">
        <h3 style="grid-column:1/-1;margin:0;font-size:15px">⚡ Precio revendedor para todos los productos de una vez</h3>
        <label>Descuento sobre tu precio público (%)<input name="pct" inputmode="numeric" value="20"></label>
        <label class="chk" style="grid-column:1/-1"><input type="checkbox" name="overwrite"> Cambiar también los que ya tienen precio de revendedor</label>
        <p class="muted" style="grid-column:1/-1;margin:0">Ejemplo con 20%: un producto de Bs 35 queda en Bs 28 para tus revendedores (redondeado a Bs enteros). Después podés ajustar uno por uno en Productos.</p>
        <button class="pbtn dark" type="submit">Aplicar a todos</button></form></section>` : ""}`;
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
    const list = await api("GET", "/api/admin/audit?limit=300");
    return `<section class="card">${table(["Fecha", "Quién", "Rol", "Acción", "Sobre", "Detalle"], list.map((a) => `<tr><td>${fdt(a.at)}</td><td>${esc(a.actorId)}</td><td>${esc(a.role)}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.entityId)}</td><td><small class="muted">${esc(a.data ? JSON.stringify(a.data) : "")}</small></td></tr>`))}</section>`;
  },

  async configuracion() {
    const s = await api("GET", "/api/settings");
    return `${canReview() ? `<section class="card"><h2>Mi tienda</h2><form class="form" id="setForm"><label>Nombre de la tienda<input name="storeName" required maxlength="60" value="${esc(s.storeName)}"></label>
      <label>Nombre de la plataforma (revendedores)<input name="platformName" maxlength="40" value="${esc(s.platformName ?? "GaboHub")}"></label>
      <label>WhatsApp de ventas (con código de país)<input name="whatsapp" inputmode="numeric" placeholder="59170000000" value="${esc(s.whatsapp)}"></label>
      <label style="grid-column:1/-1">Nota de pago (banco, titular, instrucciones)<input name="paymentNote" maxlength="300" value="${esc(s.paymentNote)}" placeholder="Banco Unión · Gabriel Pérez · Cta. 1-234567"></label><button class="pbtn dark" type="submit">Guardar</button></form></section>
      <section class="card"><h2>${icon("plus")}Armá tu combo <small>descuento en la tienda cuando el cliente lleva varios servicios sueltos</small></h2>
        <form class="form" id="comboForm">${["2 servicios", "3 servicios", "4 o más"].map((t, i) => `<label>Descuento ${t} (Bs)<input name="d${i}" inputmode="decimal" value="${(s.comboDiscounts?.[i] ?? 0) / 100}"></label>`).join("")}
        <p class="muted" style="grid-column:1/-1;margin:0">Los combos ya armados mantienen su precio. Los revendedores no reciben este descuento. Poné 0 en los tres para apagar “Armá tu combo”.</p>
        <button class="pbtn dark" type="submit">Guardar descuentos</button></form></section>
      <section class="card"><h2>${icon("qr")}QR de cobro</h2><div class="inline">${s.hasQr ? `<img src="/api/settings/qr?t=${Date.now()}" alt="QR actual" style="width:140px;height:140px;object-fit:contain;background:#fff;border-radius:8px;border:1px solid var(--line)">` : `<span class="muted">Todavía no subiste el QR.</span>`}</div>
        <form class="inline" id="qrForm"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen del QR"><button class="pbtn dark" type="submit">${s.hasQr ? "Cambiar QR" : "Subir QR"}</button></form></section>` : ""}
      ${isOwner() ? await ownerCards() : ""}
      ${await twoFactorCard()}
      <section class="card"><h2>Cambiar mi contraseña</h2><form class="form" id="pwForm"><label>Contraseña actual<input name="current" type="password" required autocomplete="current-password"></label><label>Nueva contraseña (mín. 10)<input name="next" type="password" minlength="10" required autocomplete="new-password"></label><button class="pbtn dark" type="submit">Cambiar</button></form></section>`;
  },
};


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
  const inG = ["cuentas", "carga", "productos"].includes(P.view);
  $("#menu").innerHTML = MENU.filter((m) => !m[3] || m[3] === "owner" && isOwner() || Array.isArray(m[3])).map(([k, i, t, sub]) => Array.isArray(sub)
    ? `<details ${inG ? "open" : ""}><summary>${icon(i)}${t}${icon("chev", "i chev")}</summary><div class="sub">${sub.map(([k2, t2]) => `<button type="button" data-go="${k2}" ${k2 === P.view ? 'aria-current="page"' : ""}>${t2}</button>`).join("")}</div></details>`
    : `<button type="button" data-go="${k}" ${k === P.view ? 'aria-current="page"' : ""}>${icon(i)}${t}${k === "aprobacion" && pend ? `<span class="count">${pend}</span>` : ""}</button>`).join("");
  const [ti, tt] = TITLE[P.view];
  $("#ptitle").innerHTML = icon(ti) + tt;
  const bnavFor = ["cuentas", "carga", "productos"].includes(P.view) ? "cuentas" : P.view;
  $$("#pbnav button").forEach((b) => b.setAttribute("aria-current", b.dataset.go === bnavFor ? "page" : "false"));
  $("#app").classList.remove("open");
  try {
    $("#pout").innerHTML = await V[P.view]();
    $$(".msgs").forEach((m) => (m.scrollTop = m.scrollHeight));
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
  $("#login").hidden = true;
  $("#app").hidden = false;
  $("#pName").textContent = me.name;
  $("#pRole").textContent = { owner: "DUEÑO", admin: "ADMIN", seller: "VENDEDOR" }[me.role];
  $("#pStore").textContent = P.settings.storeName;
  if (P.settings.hasLogo) $(".plogo i").outerHTML = `<img src="/api/settings/logo" alt="" style="width:32px;height:32px;border-radius:9px;object-fit:cover">`;
  applyTheme();
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
      <button class="pbtn big" type="button" data-dlvcopy>📋 Copiar todo</button></div>`;
  el.addEventListener("click", (ev) => { if (ev.target === el) el.remove(); });
  document.body.appendChild(el);
}

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
  if (d.tab) { const [k, v] = d.tab.split(":"); P.tab[k] = v; return render(); }
  if (d.secrets) { P.tab.secrets = !P.tab.secrets; return render(); }
  if (d.qrdel) { const row = el.closest(".qr-row"); const form = row.closest("form"); row.remove(); return form.requestSubmit(); }
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
      Object.assign(P.tab, { cf: "todos", cday: "", cpay: "", cq: "", cfrom: undefined });
      if (["today", "bad", "warn", "hold"].includes(f)) P.tab.cf = f;
      if (f === "cobrar") P.tab.cf = "cobrar";
      if (f === "nopay") P.tab.cpay = "pendiente";
      if (f === "fecha") P.tab.cfrom = Number(x);
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
      return act(() => api("POST", "/api/admin/assignments/renew-many", { ids, paymentMethod: "cash", batchKey: newKey(), allowBeyondSupplier: $("#cbBeyond").checked }), (r) => {
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
  if (d.ctlcsv) {
    const H = ["N°", "Cliente", "WhatsApp", "Plataforma", "Correo", "Perfil", "Inicio", "Vencimiento", "Día vence", "Precio Bs", "Costo Bs", "Ganancia Bs", "Estado pago", "Estado", "Días restantes", "Revendedor", "Nota"];
    const PAYT = { pagado: "Pagado", pendiente: "Pendiente", no_pago: "No pagó" };
    const lines = [H, ...(P.controlView ?? []).map((r) => [r.n, r.customerName, r.customerPhone, r.product.replace(/ \(alquiler revendedores\)/, ""), r.email, r.profile, fdate(r.startsAt), fdate(r.customerExpiresAt), r.day, r.price / 100, r.cost / 100, r.gain / 100, PAYT[r.pay], r.est[0], r.d, r.control.seller ?? "", r.control.note ?? ""])];
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
    const r = (await api("GET", "/api/admin/resellers")).list.find((x) => x.id === d.rsend);
    try { P.tab.rlink = await resellerKit(r.id, r.name, r.phone, r.pageAllowed ? r.shop.slug : undefined); await render(); scrollTo(0, 0); } catch (e) { toast(e.message); }
    return;
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
    const v = prompt("¿Cuánto saldo le cargás? (Bs, negativo para descontar)");
    if (!v) return;
    try { await api("POST", `/api/admin/customers/${d.rtop}/adjust`, { amount: toCents(v), reason: "Recarga de saldo (panel)" }); toast("Saldo actualizado"); } catch (e) { toast(e.message); }
    return render();
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
  if (d.slotfree) return act(() => api("POST", `/api/admin/slots/${d.slotfree}/status`, { status: "available", note: "revisado desde el panel" }), "Perfil liberado: ya se puede vender");
  if (d.slotact !== undefined) { P.tab.slotAct = d.slotact || null; await render(); return scrollTo(0, 0); }
  if (d.slotrelease) {
    if (!confirm("¿Liberar este perfil? Deja de contar para ese cliente y queda libre para vender.")) return;
    try { await api("POST", `/api/admin/slots/${d.slotrelease}/free`, { reason: "liberado desde Cuentas" }); P.tab.slotAct = null; toast("Perfil liberado ✓"); } catch (e) { toast(e.message); }
    return render();
  }
  if (d.ledger !== undefined) { P.tab.ledger = d.ledger || null; await render(); return scrollTo(0, 0); }
  if (d.copy) { try { await navigator.clipboard.writeText(d.copy); toast("Copiado"); } catch { toast("Copialo a mano"); } return; }
  if (d.link) {
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
    $("#sellNote").innerHTML = `Vendés <b>${esc(el.dataset.name)}</b>. Se asigna solo un perfil libre${n ? ` (quedan ${n})` : ""} y el aviso queda listo en WhatsApp.`;
    $("#sellNote").classList.add("on");
    $("#sellBtn").disabled = false;
    // Perfiles libres de ese producto para elegir a mano (opcional).
    const estadoK = { available: "Libre" };
    const accs = (P.tab.sellAccts ?? []).filter((a) => a.productId === d.pick && a.status === "active" && a.slots.some((s) => s.status === "available"));
    const pp = $("#profPick");
    if (!accs.length) { pp.hidden = true; pp.innerHTML = ""; return; }
    pp.hidden = false;
    pp.innerHTML = `<div class="ppsec">🎯 ¿De qué cuenta/perfil? <small class="muted">opcional</small></div>
      <div class="ppchips"><button type="button" class="ppchip on" data-slot="">⚡ Automático <small>(el que vence antes)</small></button>
      ${accs.map((a) => a.slots.filter((s) => s.status === "available").map((s) => `<button type="button" class="ppchip" data-slot="${esc(s.id)}"><b>${esc(s.label)}</b><small>${esc(a.email)}</small></button>`).join("")).join("")}</div>`;
    return;
  }
  if (d.slot !== undefined && el.classList.contains("ppchip")) {
    const f = $("#sellForm");
    if (f) f.slotId.value = d.slot;
    $$("#profPick .ppchip").forEach((x) => x.classList.toggle("on", x.dataset.slot === d.slot));
    return;
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
  if (d.nologo) return act(() => api("POST", "/api/admin/settings/logo/remove", {}), "Logo quitado");
  if (d.sent) return act(() => api("POST", `/api/admin/outbox/${d.sent}/sent`, {}), "Marcado como enviado");
  if (d.staff) return act(() => api("POST", `/api/admin/staff/${d.staff}/active`, { active: d.on === "1" }), d.on === "1" ? "Usuario activado" : "Usuario desactivado: se cerró su sesión");
  if (d.supactive) {
    const s = (await api("GET", "/api/admin/suppliers")).find((x) => x.id === d.supactive);
    return act(() => api("POST", "/api/admin/suppliers", { ...s, active: d.on === "1" }), "Proveedor actualizado");
  }
});

/** Manda el estilo del formulario a las vistas previas (sin guardar). */
function previewLook() {
  const f = $("#lookForm");
  if (!f) return;
  const look = { accentColor: f.querySelector('input[name="accentColor"]:checked')?.value || f.accentColorCustom.value, backgroundColor: f.querySelector('input[name="backgroundColor"]:checked')?.value || f.backgroundColorCustom.value,
    accent2Color: f.accent2Auto.checked ? "" : f.accent2Color.value };
  for (const k of ["fontFamily", "headingFont", "bgStyle", "cardStyle", "corners", "heroTitle", "heroHighlight", "heroText", "announcement", "heroChip", "heroTicks", "footerText", "instagram", "tiktok", "facebook"]) look[k] = f[k].value;
  $$("iframe[data-look]").forEach((fr) => { try { fr.contentWindow.postMessage({ type: "gs-look", look }, location.origin); } catch { /* cargando */ } });
}
let lookTimer, cqTimer;
document.addEventListener("input", (ev) => {
  if (ev.target.id !== "cq") return;
  P.tab.cq = ev.target.value;
  clearTimeout(cqTimer);
  cqTimer = setTimeout(async () => { await render(); const f = $("#cq"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 300);
});
let rqTimer;
document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t.id === "rq") {
    P.tab.rq = t.value; clearTimeout(rqTimer);
    rqTimer = setTimeout(async () => { await render(); const f = $("#rq"); if (f) { f.focus(); f.setSelectionRange(f.value.length, f.value.length); } }, 300);
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
  if (t.name === "productId" && t.form?.id === "quickForm") { const s = `${t.value} ${t.selectedOptions[0]?.textContent ?? ""}`.toLowerCase(); const n = /disney/.test(s) ? 7 : /prime|amazon/.test(s) ? 6 : 5; t.form.n.value = n; const btn = t.form.querySelector('[type="submit"]'); if (btn) btn.textContent = `＋ Agregar cuenta (${n} perfiles libres)`; return; }
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
  if (ev.target.form?.id === "lookForm") setTimeout(previewLook, 0);
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
      const pname = document.querySelector('.selp[aria-pressed="true"] b')?.textContent ?? "el producto";
      if (btn) btn.disabled = true;
      try {
        const o = await api("POST", "/api/admin/orders", { customerId: f.customerId.value, items: [{ productId: f.productId.value, qty: +f.qty.value }], paymentMethod: f.paymentMethod.value, idempotencyKey: f.dataset.key, ...(f.slotId.value ? { preferredSlotIds: [f.slotId.value] } : {}) });
        const deliveries = [];
        for (const id of (o.assignmentIds ?? [])) { const info = await api("GET", `/api/admin/assignments/${id}/delivery`).catch(() => null); if (info) deliveries.push(info); }
        toast(`✅ Venta registrada: ${pname}`);
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
    } else if (f.id === "editCusForm") {
      const body = { name: f.name.value, phone: f.phone.value, email: f.email.value, notes: f.notes.value };
      if (f.kind) { body.kind = f.kind.value; body.priceGroupId = f.kind.value === "reseller" ? "revendedor" : "final"; }
      await api("POST", `/api/admin/customers/${f.dataset.id}`, body);
      await api("POST", `/api/admin/customers/${f.dataset.id}/consent`, { whatsapp: f.consent.checked });
      P.tab.editCus = null;
      toast("Cliente actualizado");
      await render();
    } else if (f.dataset.down) {
      await act(() => api("POST", `/api/admin/accounts/${f.dataset.down}/replace`, { reason: f.reason.value }), (r) => r.retired ? `Cuenta retirada. ${r.results.length} cliente(s) movidos` : `No se pudo mover a todos: ${r.results.find((x) => !x.ok)?.error}`);
    } else if (f.id === "quickForm") {
      const n = Math.max(1, Math.min(20, +f.n.value || 1));
      try { localStorage.setItem("gs-carga", JSON.stringify({ productId: f.productId.value, supplierId: f.supplierId.value, exp: f.exp.value, cost: f.cost.value })); } catch { /* sin almacenamiento */ }
      await act(() => api("POST", "/api/admin/accounts", {
        productId: f.productId.value, supplierId: f.supplierId.value, email: f.email.value.trim(), password: f.password.value,
        supplierExpiresAt: new Date(f.exp.value + "T23:59:00").getTime(), cost: toCents(f.cost.value || 0),
        profiles: Array.from({ length: n }, (_, i) => ({ label: `Perfil ${i + 1}` })),
      }), `✅ Cuenta agregada con ${n} perfiles libres`);
    } else if (f.id === "accForm") {
      const n = Math.max(1, Math.min(20, +f.n.value || 1));
      const pin = f.pin.value.trim() || undefined;
      await act(() => api("POST", "/api/admin/accounts", {
        productId: f.productId.value, supplierId: f.supplierId.value, email: f.email.value.trim(), password: f.password.value,
        supplierExpiresAt: new Date(f.exp.value + "T23:59:00").getTime(), cost: toCents(f.cost.value || 0),
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
    } else if (f.id === "staffForm") {
      await act(() => api("POST", "/api/admin/staff", { name: f.name.value, username: f.username.value, role: f.role.value, password: f.password.value }), "Usuario creado");
    } else if (f.id === "offForm") {
      const own = f.mode.value === "own";
      await act(() => api("POST", "/api/admin/offsite", { enabled: f.enabled.checked, ...(own ? { address: f.address?.value.trim(), password: f.password?.value || undefined } : { mailboxId: f.mode.value }) }), "Copia en Gmail guardada");
    } else if (f.id === "resForm") {
      const btn = f.querySelector("[type=submit]"); btn.disabled = true;
      try {
        const c = await api("POST", "/api/admin/customers", { name: f.name.value.trim(), phone: f.phone.value, email: f.email.value.trim() || undefined, kind: "reseller", priceGroupId: "revendedor", whatsappConsent: f.consent.checked });
        let slug;
        if (f.plan.value === "page") {
          const shop = await api("POST", `/api/admin/customers/${c.id}/shop`, { ...(f.slug.value.trim() ? { slug: f.slug.value.trim().toLowerCase() } : {}), title: (f.title.value.trim() || f.name.value.trim()).slice(0, 40), enabled: f.publish.checked });
          slug = shop.slug;
        }
        P.tab.rlink = await resellerKit(c.id, c.name, c.phone, slug);
        toast(f.plan.value === "page" ? "Revendedor creado con su página" : "Revendedor creado (solo panel)");
        await render(); scrollTo(0, 0);
      } catch (e) { toast(e.message); btn.disabled = false; }
    } else if (f.id === "bulkRes") {
      const pct = Number(f.pct.value);
      if (!(pct >= 0 && pct < 100)) { toast("Descuento entre 0 y 99 %"); return; }
      const [products, groups] = await Promise.all([api("GET", "/api/admin/products"), api("GET", "/api/admin/price-groups")]);
      const rev = groups.find((g) => g.id === "revendedor") ?? { id: "revendedor", name: "Revendedor", prices: {} };
      let n = 0;
      for (const p of products) {
        if (p.resellersOnly || (!f.overwrite.checked && rev.prices[p.id] !== undefined)) continue;
        rev.prices[p.id] = Math.max(100, Math.round((p.price * (100 - pct)) / 100 / 100) * 100);
        n++;
      }
      if (!n) { toast("No había productos para cambiar"); return; }
      if (!confirm(`¿Poner precio de revendedor a ${n} producto(s) con ${pct}% de descuento?`)) return;
      await act(() => api("POST", "/api/admin/price-groups", rev), `Listo: ${n} producto(s) con precio de revendedor`);
    } else if (f.id === "resCfg") {
      await act(() => api("POST", "/api/admin/settings", { resellerMarginPct: Math.round(Number(f.margin.value) || 0), shopRent: { enabled: f.rentOn.checked, price: toCents(f.price.value || "0"), freeIfSpent: toCents(f.free.value || "0"), graceDays: Math.round(Number(f.grace.value) || 0) } }), "Ajustes guardados");
    } else if (f.id === "mbForm") {
      await act(async () => { await api("POST", "/api/admin/mailboxes", mbBody(f)); P.tab.mbEdit = null; P.tab.mbKind = null; }, "Correo conectado: ya se están leyendo los códigos");
    } else if (f.id === "comboForm") {
      await act(() => api("POST", "/api/admin/settings", { comboDiscounts: [0, 1, 2].map((i) => toCents(f[`d${i}`].value || "0")) }), "Descuentos del combo guardados");
    } else if (f.id === "setForm") {
      await act(() => api("POST", "/api/admin/settings", { storeName: f.storeName.value, platformName: f.platformName.value.trim() || "GaboHub", whatsapp: f.whatsapp.value.replace(/\D/g, "") || undefined, paymentNote: f.paymentNote.value }), "Configuración guardada");
      P.settings = await api("GET", "/api/settings");
      $("#pStore").textContent = P.settings.storeName;
    } else if (f.id === "lookForm") {
      const color = (n) => f.querySelector(`input[name="${n}"]:checked`)?.value || f[n + "Custom"].value;
      const body = { accentColor: color("accentColor"), backgroundColor: color("backgroundColor"), accent2Color: f.accent2Auto.checked ? "" : f.accent2Color.value,
        fontFamily: f.fontFamily.value, headingFont: f.headingFont.value, bgStyle: f.bgStyle.value, cardStyle: f.cardStyle.value, corners: f.corners.value };
      for (const k of ["heroTitle", "heroHighlight", "heroText", "announcement", "heroChip", "heroTicks", "footerText", "instagram", "tiktok", "facebook"]) body[k] = f[k].value;
      await act(() => api("POST", "/api/admin/settings", body), "Apariencia guardada: así la ven tus clientes");
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
