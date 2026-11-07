// Panel del vendedor conectado al servidor.
import { api, $, $$, esc, bs, toCents, fdate, fdt, daysLeft, icon, toast, fileToBase64, waLink, newKey, STATUS_TEXT, KIND_TEXT } from "/common.js";

const P = { me: null, view: "dashboard", tab: {}, theme: "light", settings: null };
try { P.theme = localStorage.getItem("gs-panel-theme") || "light"; } catch { /* sin almacenamiento */ }

const isOwner = () => P.me?.role === "owner";
const canReview = () => P.me?.role === "owner" || P.me?.role === "admin";

const MENU = [
  ["vender", "cart", "Vender"], ["renovar", "renew", "Renovar"], ["dashboard", "home", "Dashboard"],
  ["aprobacion", "approve", "Aprobación de Ventas"], ["recordatorios", "bell", "Recordatorios"],
  ["G", "box", "Productos", [["cuentas", "Cuentas"], ["carga", "Carga de Cuentas"], ["productos", "Productos y precios"]]],
  ["proveedores", "truck", "Proveedores"], ["clientes", "users", "Clientes"], ["excel", "ext", "Excel: exportar e importar"], ["whatsapp", "wa", "WhatsApp"],
  ["apariencia", "sun", "Apariencia de la tienda"], ["usuarios", "userplus", "Usuarios", "owner"], ["auditoria", "history", "Auditoría", "owner"], ["configuracion", "gear", "Configuración"],
];
const TITLE = { vender: ["cart", "Vender"], renovar: ["renew", "Renovar"], dashboard: ["home", "Dashboard"], aprobacion: ["approve", "Aprobación de Ventas"], recordatorios: ["bell", "Recordatorios"], cuentas: ["user", "Cuentas"], carga: ["box", "Carga de Cuentas"], productos: ["box", "Productos y precios"], proveedores: ["truck", "Proveedores"], clientes: ["users", "Clientes"], excel: ["ext", "Excel: exportar e importar"], whatsapp: ["wa", "WhatsApp"], usuarios: ["userplus", "Usuarios del panel"], apariencia: ["sun", "Apariencia de la tienda"], auditoria: ["history", "Auditoría"], configuracion: ["gear", "Configuración"] };

const pill = (t, k) => `<span class="pp pp-${k}">${esc(t)}</span>`;
const orderPill = (s) => pill(STATUS_TEXT[s] ?? s, { fulfilled: "ok", payment_review: "warn", awaiting_payment: "mute", rejected: "bad", expired: "bad", cancelled: "mute" }[s] ?? "mute");
const table = (head, rows, empty = "No hay datos todavía.") => rows.length
  ? `<div class="scroll"><table><thead><tr>${head.map((h) => `<th>${h}</th>`).join("")}</tr></thead><tbody>${rows.join("")}</tbody></table></div>`
  : `<div class="emptybox">${esc(empty)}</div>`;
const opt = (v, t, sel) => `<option value="${esc(v)}" ${sel ? "selected" : ""}>${esc(t)}</option>`;
const dateInput = (t) => new Date(t).toISOString().slice(0, 10);

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
    const [st, set, products, accounts] = await Promise.all([api("GET", "/api/admin/stats"), api("GET", "/api/settings"), api("GET", "/api/admin/products"), api("GET", "/api/admin/accounts")]);
    const todo = [
      [!set.whatsapp, "wa", "Cargá el WhatsApp de la tienda", "configuracion", "Configurar"],
      [!set.hasQr, "qr", "Subí tu QR de cobro", "configuracion", "Subir QR"],
      [!products.length, "box", "Creá tu primer producto", "productos", "Crear"],
      [!accounts.length, "user", "Cargá tus cuentas y perfiles", "carga", "Cargar"],
    ].filter((x) => x[0]);
    const stock = Object.entries(st.stock);
    return `<div class="big"><button type="button" data-go="carga" style="background:#4263eb"><span>${icon("userplus")}</span>Registrar cuentas</button><button type="button" data-go="vender" style="background:#087f5b"><span>${icon("cart")}</span>Vender</button></div>
      <section class="card"><div class="todo"><div><span class="ic" style="background:${esc(set.accentColor)};color:#fff">${icon("sun")}</span><b>Apariencia de la tienda<br><small class="muted" style="font-weight:400">Colores, logo, textos de inicio y aviso</small></b><button class="pbtn blue" type="button" data-go="apariencia">Personalizar ${icon("arrow")}</button></div></div></section>
      ${todo.length ? `<section class="card"><h2>${icon("flag")}Completá tu tienda</h2><div class="todo">${todo.map(([, i, t, go, b]) => `<div><span class="ic">${icon(i)}</span><b>${t}</b><button class="pbtn blue" type="button" data-go="${go}">${b} ${icon("arrow")}</button></div>`).join("")}</div></section>` : ""}
      <div class="kpis">
        <div class="kpi"><span>Ventas (30 días)</span><b>${bs(st.revenue)}</b><small class="muted">${st.orders} pedidos</small></div>
        <div class="kpi"><span>Dinero que entró</span><b>${bs(st.cashIn)}</b><small class="muted">QR, efectivo y recargas</small></div>
        <div class="kpi"><span>Pagos por revisar</span><b class="${st.pendingReview ? "down" : ""}">${st.pendingReview}</b></div>
        <div class="kpi"><span>Vencen en 7 días</span><b>${st.expiringIn7Days}</b></div>
        <div class="kpi"><span>Saldo de clientes</span><b>${bs(st.balancesOwed)}</b><small class="muted">lo que les debés</small></div>
      </div>
      <section class="card"><h2>Stock por producto</h2>${table(["Producto", "Libres", "Reservados", "Vendidos", "Cuarentena", "No vendibles"],
        stock.map(([id, s]) => `<tr><td>${esc(products.find((p) => p.id === id)?.name ?? id)}</td><td>${s.available ?? 0}</td><td>${s.reserved ?? 0}</td><td>${s.assigned ?? 0}</td><td>${s.quarantined ?? 0}</td><td>${s.unsellable ?? 0}</td></tr>`), "Todavía no cargaste cuentas.")}</section>`;
  },

  async vender() {
    const [customers, products, stock] = await Promise.all([api("GET", "/api/admin/customers"), api("GET", "/api/admin/products"), api("GET", "/api/admin/stock")]);
    return `<section class="card"><h2>Nueva venta <small>· se asigna un perfil libre y el aviso queda listo en WhatsApp</small></h2>
      ${customers.length ? `<form class="form" id="sellForm" data-key="${newKey()}">
        <label>Cliente<select name="customerId" required>${customers.map((c) => opt(c.id, `${c.name} · ${c.phone}`)).join("")}</select></label>
        <label>Producto<select name="productId">${products.map((p) => opt(p.id, `${p.name} · ${bs(p.price)} · ${stock[p.id]?.available ?? 0} libres`)).join("")}</select></label>
        <label>Cantidad<input name="qty" type="number" min="1" max="10" value="1"></label>
        <label>Cobrado con<select name="paymentMethod">${opt("cash", "Efectivo / QR ya verificado")}${opt("balance", "Saldo del cliente")}</select></label>
        <button class="pbtn dark" type="submit">${icon("cart")}Registrar venta</button></form>` : `<div class="emptybox">Primero creá un cliente.</div>`}
      <div class="inline"><span class="muted">¿Cliente nuevo?</span><button class="pbtn sm" type="button" data-go="clientes">Crear cliente</button></div></section>`;
  },

  async aprobacion() {
    const tab = P.tab.aprob ?? "payment_review";
    const orders = await api("GET", "/api/admin/orders" + (tab === "all" ? "" : `?status=${tab}`));
    const tabs = [["payment_review", "Por revisar"], ["awaiting_payment", "Esperando pago"], ["all", "Todos"]];
    return `${canReview() ? "" : `<div class="pok">Solo el dueño o un admin pueden aprobar pagos. Vos podés ver los pedidos.</div>`}
      <section class="card"><div class="tabs" role="tablist">${tabs.map(([k, t]) => `<button role="tab" type="button" data-tab="aprob:${k}" aria-selected="${k === tab}">${t}</button>`).join("")}</div>
      ${table(["Pedido", "Cliente", "Tipo", "Total", "Pago", "Estado", "Fecha", "Acciones"], orders.map((o) => `<tr>
        <td>${esc(o.id)}</td><td>${esc(o.customerName)}</td><td>${KIND_TEXT[o.kind]}${o.items?.length ? `<br><small class="muted">${o.items.map((i) => `${i.qty}× ${esc(i.productName)}`).join(", ")}</small>` : ""}</td>
        <td>${bs(o.total)}</td><td>${esc({ qr: "QR", balance: "Saldo", cash: "Efectivo" }[o.paymentMethod])}${o.evidence ? `<br><small class="muted">Op. ${esc(o.evidence.declaredReference)}</small>` : ""}</td>
        <td>${orderPill(o.status)}</td><td>${fdt(o.createdAt)}</td>
        <td>${o.evidence ? `<a class="pbtn sm" href="/api/admin/orders/${esc(o.id)}/evidence" target="_blank" rel="noopener">${icon("eye")}Comprobante</a>` : ""}
          ${o.status === "payment_review" && canReview() ? `<form class="inline" data-approve="${esc(o.id)}" style="margin-top:6px"><input name="ref" placeholder="Referencia del banco" required aria-label="Referencia bancaria verificada"><button class="pbtn sm green" type="submit">Aprobar</button></form>
            <form class="inline" data-reject="${esc(o.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo del rechazo" required aria-label="Motivo"><button class="pbtn sm" type="submit">Rechazar</button></form>` : ""}
          ${o.status === "awaiting_payment" && canReview() ? `<form class="inline" data-reject="${esc(o.id)}"><input name="reason" placeholder="Motivo" required aria-label="Motivo"><button class="pbtn sm" type="submit">Anular</button></form>` : ""}</td></tr>`),
        tab === "payment_review" ? "No hay pagos por revisar." : "No hay pedidos.")}
      <p class="muted" style="margin:0">Aprobá solo después de ver el dinero en tu banco: escribí la referencia que figura en tu extracto. Una misma referencia no se puede usar dos veces.</p></section>`;
  },

  async renovar() {
    const [list, customers] = await Promise.all([api("GET", "/api/admin/assignments"), api("GET", "/api/admin/customers")]);
    return `<section class="card"><div class="inline"><button class="pbtn dark sm" type="button" data-renewsel="1">${icon("renew")}Renovar seleccionados (+1 período, efectivo)</button><span class="muted">${list.length} servicios activos</span></div>
      ${table(["<input type=checkbox id=selAll aria-label='Seleccionar todo'>", "Cliente", "Producto", "Cuenta / perfil", "Vence cliente", "Vence proveedor", "Acciones"], list.map((a) => {
        const d = daysLeft(a.customerExpiresAt);
        return `<tr><td><input type="checkbox" class="sel" value="${esc(a.id)}" aria-label="Seleccionar"></td><td>${esc(a.customerName)}</td><td>${esc(a.product)}</td><td class="mono">${esc(a.email)}<br><small class="muted">${esc(a.profile)}</small></td>
          <td>${fdate(a.customerExpiresAt)} ${d <= 3 ? pill(d < 0 ? "Vencido" : `${d} d`, "warn") : ""}</td><td>${fdate(a.supplierExpiresAt)}</td>
          <td><button class="pbtn sm dark" type="button" data-renew="${esc(a.id)}">+1 período</button>
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
    const [accs, products, suppliers] = await Promise.all([api("GET", "/api/admin/accounts" + (show ? "?secrets=1" : "")), api("GET", "/api/admin/products"), api("GET", "/api/admin/suppliers")]);
    const pname = (id) => products.find((p) => p.id === id)?.name ?? id;
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
    return `${editCard}<section class="card"><div class="inline">${canReview() ? `<button class="pbtn sm" type="button" data-secrets="1">${icon("eye")}${show ? "Ocultar contraseñas" : "Mostrar contraseñas"}</button>` : ""}<button class="pbtn sm" type="button" data-go="carga">${icon("plus")}Cargar cuenta</button><span class="muted">${accs.length} cuentas</span></div>
      ${table(["Producto", "Email", "Contraseña", "Perfiles", "Proveedor", "Vence proveedor", "Estado", ""], accs.map((a) => {
        const d = daysLeft(a.supplierExpiresAt);
        return `<tr><td>${esc(pname(a.productId))}</td><td class="mono">${esc(a.email)}${a.notes ? `<br><small class="muted" style="font-family:inherit">📝 ${esc(a.notes)}</small>` : ""}</td><td class="mono">${esc(a.password)}</td>
          <td><div style="display:flex;flex-wrap:wrap;gap:4px">${a.slots.map((s) => `<span style="display:inline-flex;gap:3px;align-items:center">${pill(`${s.label}: ${{ available: "libre", reserved: "reservado", assigned: "vendido", quarantined: "cuarentena", retired: "retirado" }[s.status]}`, { available: "ok", assigned: "warn", reserved: "mute", quarantined: "bad", retired: "mute" }[s.status])}${s.status === "quarantined" && canReview() && a.status === "active" ? `<button class="pbtn sm" type="button" data-slotfree="${esc(s.id)}" title="Ya está revisado: volver a vender">Liberar</button>` : ""}</span>`).join("")}</div></td>
          <td>${esc(suppliers.find((s) => s.id === a.supplierId)?.name ?? a.supplierId)}</td><td>${fdate(a.supplierExpiresAt)} ${d <= 7 ? pill(d < 0 ? "Vencida" : `${d} d`, "warn") : ""}</td>
          <td>${a.status === "active" ? pill("Activa", "ok") : pill("Retirada", "mute")}</td>
          <td>${canReview() ? `<button class="pbtn sm" type="button" data-editaccopen="${esc(a.id)}">${icon("edit")}Editar</button>` : ""}
          ${a.status === "active" && canReview() ? `<details class="more"><summary>Cuenta caída</summary><form class="inline" data-down="${esc(a.id)}" style="margin-top:6px"><input name="reason" placeholder="Motivo" required><button class="pbtn sm" type="submit">Mover clientes y retirar</button></form></details>` : ""}</td></tr>`;
      }), "Todavía no cargaste cuentas.")}</section>`;
  },

  async carga() {
    const [products, suppliers] = await Promise.all([api("GET", "/api/admin/products"), api("GET", "/api/admin/suppliers")]);
    if (!products.length || !suppliers.length) return `<section class="card"><div class="emptybox">Antes de cargar cuentas necesitás al menos un producto y un proveedor.<div class="inline">${!products.length ? `<button class="pbtn dark" type="button" data-go="productos">Crear producto</button>` : ""}${!suppliers.length ? `<button class="pbtn dark" type="button" data-go="proveedores">Crear proveedor</button>` : ""}</div></div></section>`;
    const sel = (name) => `<select name="${name}">${(name === "productId" ? products : suppliers.filter((s) => s.active)).map((x) => opt(x.id, x.name)).join("")}</select>`;
    return `<section class="card"><h2>Cargar una cuenta <small>· se crean los perfiles automáticamente</small></h2><form class="form" id="accForm">
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
      <label class="chk"><input type="checkbox" name="published" ${f.published ? "checked" : ""}> Mostrar en la tienda</label>
      <div class="inline"><button class="pbtn dark" type="submit">${edit ? "Guardar cambios" : "Crear producto"}</button>${edit ? `<button class="pbtn" type="button" data-editprod="">Cancelar</button>` : ""}</div></form></section>
      <section class="card"><h2>Productos <small>· ${products.length}</small></h2>${table(["Producto", "Tipo", "Precio", "Revendedor", "Duración", "Stock libre", "Tienda", ""], products.map((p) => `<tr>
        <td><span style="display:inline-block;width:10px;height:10px;border-radius:3px;background:${esc(p.color ?? "#3984ff")};margin-right:6px"></span>${esc(p.name)}<br><small class="muted">${esc(p.category ?? "")}</small></td>
        <td>${esc({ profile: "Perfil", full_account: "Cuenta", invite: "Invitación", combo: "Combo" }[p.kind])}</td><td>${bs(p.price)}</td><td>${rev?.prices[p.id] !== undefined ? bs(rev.prices[p.id]) : "—"}</td>
        <td>${p.durationDays} días</td><td>${stock[p.id]?.available ?? 0}</td><td>${p.published ? pill("Publicado", "ok") : pill("Oculto", "mute")}</td>
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
    return `${link ? `<section class="card"><h2>Link de acceso para ${esc(link.name)}</h2><div class="linkbar"><b>${esc(link.url)}</b><button class="pbtn sm" type="button" data-copy="${esc(link.url)}">${icon("copy")}Copiar</button>
        <a class="pbtn sm green" href="${waLink(link.phone, `Hola ${link.name.split(" ")[0]}, este es tu link para entrar a ${P.settings.storeName} y ver tus servicios: ${link.url}\n(Es personal y sirve una sola vez, por 24 horas.)`)}" target="_blank" rel="noopener">${icon("wa")}Mandar por WhatsApp</a></div>
        <p class="muted" style="margin:0">Sirve una sola vez y vence en 24 horas. No lo compartas con otra persona.</p></section>` : ""}
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
      ${table(["Nombre", "WhatsApp", "Tipo", "Servicios", "Saldo", "Avisos", "Acciones"], list.map((c) => `<tr><td>${esc(c.name)}${c.notes ? `<br><small class="muted">📝 ${esc(c.notes)}</small>` : ""}</td><td><a href="https://wa.me/${esc(c.phone.replace(/\D/g, ""))}" target="_blank" rel="noopener">${esc(c.phone)}</a></td>
        <td>${c.kind === "reseller" ? pill("Revendedor", "warn") : "Cliente"}</td><td>${c.activeServices}</td><td>${bs(c.balance)}</td><td>${c.whatsappConsent ? pill("Sí", "ok") : pill("No", "mute")}</td>
        <td><div class="acts"><button class="pbtn sm" type="button" data-link="${esc(c.id)}">${icon("link")}Link de acceso</button><button class="pbtn sm" type="button" data-ledger="${esc(c.id)}">${icon("coins")}Saldo</button><button class="pbtn sm" type="button" data-editcus="${esc(c.id)}">${icon("edit")}Editar</button></div></td></tr>`), q ? "Nadie coincide con la búsqueda." : "Todavía no hay clientes.")}</section>`;
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
    const s = await api("GET", "/api/settings");
    const ACCENTS = [["#3984ff", "Azul"], ["#7c5cff", "Violeta"], ["#e0368a", "Rosa"], ["#ff5a36", "Naranja"], ["#f2b705", "Dorado"], ["#16b47e", "Verde"], ["#14b8c8", "Turquesa"], ["#e53935", "Rojo"]];
    const BGS = [["#090e1d", "Azul noche"], ["#0b0b0f", "Negro"], ["#140c24", "Violeta oscuro"], ["#07140f", "Verde oscuro"], ["#1a0a10", "Bordó"], ["#111418", "Grafito"],
      ["#f5f7fb", "Blanco"], ["#fff7ec", "Crema"], ["#eaf3ff", "Celeste"], ["#f3efff", "Lila"], ["#ecfbf3", "Menta"], ["#fff0f3", "Rosa claro"]];
    const FONTS = [["inter", "Inter (moderna)"], ["poppins", "Poppins (redondeada)"], ["montserrat", "Montserrat (elegante)"], ["nunito", "Nunito (amigable)"], ["system", "La del celular"]];
    const CORNERS = [["round", "Redondeados"], ["soft", "Suaves"], ["square", "Rectos"]];
    const sw = (name, list, cur) => `<div class="inline">${list.map(([c, t]) => `<label title="${t}" style="display:grid;justify-items:center;gap:4px;font-size:12px;cursor:pointer;position:relative"><input type="radio" name="${name}" value="${c}" ${c.toLowerCase() === cur.toLowerCase() ? "checked" : ""} style="position:absolute;opacity:0">
      <span class="swatch" style="width:38px;height:38px;border-radius:10px;background:${c};border:3px solid ${c.toLowerCase() === cur.toLowerCase() ? "var(--ink)" : "transparent"};box-shadow:0 0 0 1px var(--line)"></span>${t}</label>`).join("")}
      <label style="display:grid;justify-items:center;gap:4px;font-size:12px">Otro<input type="color" name="${name}Custom" value="${esc(cur)}" style="width:44px;height:38px;padding:2px"></label></div>`;
    return `<section class="card"><h2>Colores</h2><form id="lookForm" style="display:grid;gap:16px">
        <div><b>Color principal</b> <span class="muted">· botones, precios y detalles</span>${sw("accentColor", ACCENTS, s.accentColor)}</div>
        <div><b>Fondo</b> <span class="muted">· oscuro o claro: los textos cambian solos para que siempre se lean</span>${sw("backgroundColor", BGS, s.backgroundColor)}</div>
        <div class="form"><label>Tipo de letra<select name="fontFamily">${FONTS.map(([v, t]) => opt(v, t, v === s.fontFamily)).join("")}</select></label>
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
        <div class="inline"><button class="pbtn dark" type="submit">Guardar apariencia</button><a class="pbtn" href="/" target="_blank" rel="noopener">${icon("ext")}Abrir mi tienda</a></div></form></section>
      <section class="card"><h2>Logo</h2><div class="inline">${s.hasLogo ? `<img src="/api/settings/logo?v=${Date.now()}" alt="Logo actual" style="width:64px;height:64px;border-radius:14px;object-fit:cover;border:1px solid var(--line)"><button class="pbtn sm" type="button" data-nologo="1">Quitar logo</button>` : `<span class="muted">Sin logo: se muestra la inicial de la tienda.</span>`}</div>
        <form class="inline" id="logoForm"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen del logo"><button class="pbtn dark" type="submit">${s.hasLogo ? "Cambiar logo" : "Subir logo"}</button></form><p class="muted" style="margin:0">Imagen cuadrada, idealmente de 256×256 o más.</p></section>
      <section class="card"><h2>Así se ve tu tienda</h2><div style="display:flex;gap:16px;flex-wrap:wrap;align-items:flex-start">
        <iframe id="lookPreview" src="/#inicio" title="Vista previa de la tienda en computadora" style="flex:1 1 520px;min-width:0;height:560px;border:1px solid var(--line);border-radius:12px;background:#000"></iframe>
        <iframe src="/#catalogo" title="Vista previa de la tienda en celular" style="width:300px;max-width:100%;height:560px;border:1px solid var(--line);border-radius:22px;background:#000"></iframe></div></section>`;
  },

  async usuarios() {
    if (!isOwner()) return `<section class="card"><div class="emptybox">Solo el dueño administra usuarios.</div></section>`;
    const list = await api("GET", "/api/admin/staff");
    return `<section class="card"><h2>Nuevo usuario</h2><form class="form" id="staffForm"><label>Nombre<input name="name" required></label><label>Usuario<input name="username" required autocapitalize="none" pattern="[a-z0-9._-]{3,32}" title="3 a 32 minúsculas, números, punto o guion"></label>
      <label>Rol<select name="role">${opt("seller", "Vendedor: vende, renueva y carga clientes")}${opt("admin", "Admin: además aprueba pagos y maneja inventario")}</select></label><label>Contraseña inicial<input name="password" type="password" minlength="10" required></label><button class="pbtn dark" type="submit">${icon("plus")}Crear</button></form></section>
      <section class="card">${table(["Nombre", "Usuario", "Rol", "Estado", "Creado", ""], list.map((u) => `<tr><td>${esc(u.name)}</td><td>${esc(u.username)}</td><td>${esc({ owner: "Dueño", admin: "Admin", seller: "Vendedor" }[u.role])}</td><td>${u.active ? pill("Activo", "ok") : pill("Inactivo", "mute")}</td><td>${fdate(u.createdAt)}</td>
        <td>${u.role !== "owner" ? `<button class="pbtn sm" type="button" data-staff="${esc(u.id)}" data-on="${u.active ? 0 : 1}">${u.active ? "Desactivar" : "Activar"}</button>` : ""}</td></tr>`))}</section>`;
  },

  async auditoria() {
    if (!isOwner()) return `<section class="card"><div class="emptybox">Solo el dueño ve la auditoría.</div></section>`;
    const list = await api("GET", "/api/admin/audit?limit=300");
    return `<section class="card">${table(["Fecha", "Quién", "Rol", "Acción", "Sobre", "Detalle"], list.map((a) => `<tr><td>${fdt(a.at)}</td><td>${esc(a.actorId)}</td><td>${esc(a.role)}</td><td>${esc(a.action)}</td><td class="mono">${esc(a.entityId)}</td><td><small class="muted">${esc(a.data ? JSON.stringify(a.data) : "")}</small></td></tr>`))}</section>`;
  },

  async configuracion() {
    const s = await api("GET", "/api/settings");
    return `${canReview() ? `<section class="card"><h2>Mi tienda</h2><form class="form" id="setForm"><label>Nombre de la tienda<input name="storeName" required maxlength="60" value="${esc(s.storeName)}"></label>
      <label>WhatsApp de ventas (con código de país)<input name="whatsapp" inputmode="numeric" placeholder="59170000000" value="${esc(s.whatsapp)}"></label>
      <label style="grid-column:1/-1">Nota de pago (banco, titular, instrucciones)<input name="paymentNote" maxlength="300" value="${esc(s.paymentNote)}" placeholder="Banco Unión · Gabriel Pérez · Cta. 1-234567"></label><button class="pbtn dark" type="submit">Guardar</button></form></section>
      <section class="card"><h2>${icon("qr")}QR de cobro</h2><div class="inline">${s.hasQr ? `<img src="/api/settings/qr?t=${Date.now()}" alt="QR actual" style="width:140px;height:140px;object-fit:contain;background:#fff;border-radius:8px;border:1px solid var(--line)">` : `<span class="muted">Todavía no subiste el QR.</span>`}</div>
        <form class="inline" id="qrForm"><input type="file" name="file" accept="image/png,image/jpeg,image/webp" required aria-label="Imagen del QR"><button class="pbtn dark" type="submit">${s.hasQr ? "Cambiar QR" : "Subir QR"}</button></form></section>` : ""}
      ${isOwner() ? await ownerCards() : ""}
      <section class="card"><h2>Cambiar mi contraseña</h2><form class="form" id="pwForm"><label>Contraseña actual<input name="current" type="password" required autocomplete="current-password"></label><label>Nueva contraseña (mín. 10)<input name="next" type="password" minlength="10" required autocomplete="new-password"></label><button class="pbtn dark" type="submit">Cambiar</button></form></section>`;
  },
};


/* ---------------- Avisos para el dueño y respaldos ---------------- */
async function ownerCards() {
  const [al, bk] = await Promise.all([api("GET", "/api/admin/alerts"), api("GET", "/api/admin/backups")]);
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
  return `${off}<section class="card"><div class="chats">
    <div class="clist">${list.map((c) => `<button type="button" data-chat="${esc(c.phone)}" aria-current="${c.phone === sel}"><span class="av">${icon("user")}</span><b>${esc(c.customerName ?? c.name ?? c.phone)}</b>
      <small>${c.needsHuman ? pill("Pide persona", "bad") : c.botPaused ? pill("Atiende persona", "warn") : ""}${c.unread ? ` ${pill(c.unread, "ok")}` : ""}</small><small class="last">${esc(c.lastText.replace(/[*_]/g, ""))}</small></button>`).join("")}</div>
    <div style="display:grid;grid-template-rows:auto 1fr auto;min-width:0">
      <div class="inline" style="padding:12px;border-bottom:1px solid var(--line)"><b>${esc(meta.customerName ?? meta.name ?? meta.phone)}</b><small class="muted">${esc(meta.phone)}</small>
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
  P.view = TITLE[v] ? v : "dashboard";
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
  go(location.hash.slice(1) || "dashboard");
}

/* ---------------- eventos ---------------- */
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
  if (d.tab) { const [k, v] = d.tab.split(":"); P.tab[k] = v; return render(); }
  if (d.secrets) { P.tab.secrets = !P.tab.secrets; return render(); }
  if (d.qrdel) { const row = el.closest(".qr-row"); const form = row.closest("form"); row.remove(); return form.requestSubmit(); }
  if (el.id === "notifOn") { await Notification.requestPermission().catch(() => {}); return render(); }
  if (el.id === "backupNow") return act(() => api("POST", "/api/admin/backups", {}), "Respaldo hecho");
  if (d.editprod !== undefined) { P.tab.editProduct = d.editprod || null; await render(); return scrollTo(0, 0); }
  if (d.chat) { P.tab.chat = d.chat; return render(); }
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
  if (d.ledger !== undefined) { P.tab.ledger = d.ledger || null; await render(); return scrollTo(0, 0); }
  if (d.copy) { try { await navigator.clipboard.writeText(d.copy); toast("Copiado"); } catch { toast("Copialo a mano"); } return; }
  if (d.link) {
    const r = await act(() => api("POST", `/api/admin/customers/${d.link}/login-link`, {}));
    if (r) {
      const c = (await api("GET", "/api/admin/customers")).find((x) => x.id === d.link);
      P.tab.link = { url: r.url, name: c.name, phone: c.phone };
      await render(); scrollTo(0, 0);
    }
    return;
  }
  if (d.renew) return act(() => api("POST", `/api/admin/assignments/${d.renew}/renew`, { paymentMethod: "cash", idempotencyKey: newKey() }), (r) => `Renovado hasta ${fdate(r.assignment.customerExpiresAt)}`);
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

document.addEventListener("change", (ev) => {
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
      await api("POST", "/api/auth/staff/login", { username: f.username.value, password: f.password.value });
      f.reset(); $("#loginErr").hidden = true;
      await start();
    } catch (e) { $("#loginErr").textContent = e.message; $("#loginErr").hidden = false; }
    btn.disabled = false;
    return;
  }
  if (btn) btn.disabled = true;
  const done = () => { if (btn) btn.disabled = false; };
  try {
    if (f.id === "sellForm") {
      await act(() => api("POST", "/api/admin/orders", { customerId: f.customerId.value, items: [{ productId: f.productId.value, qty: +f.qty.value }], paymentMethod: f.paymentMethod.value, idempotencyKey: f.dataset.key }), "Venta registrada: el aviso quedó en WhatsApp");
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
      const body = { id, name: f.name.value.trim(), category: f.category.value.trim() || undefined, description: f.description.value.trim() || undefined, kind: f.kind.value, durationDays: +f.durationDays.value, price: toCents(f.price.value), color: f.color.value, published: f.published.checked };
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
    } else if (f.id === "setForm") {
      await act(() => api("POST", "/api/admin/settings", { storeName: f.storeName.value, whatsapp: f.whatsapp.value.replace(/\D/g, "") || undefined, paymentNote: f.paymentNote.value }), "Configuración guardada");
      P.settings = await api("GET", "/api/settings");
      $("#pStore").textContent = P.settings.storeName;
    } else if (f.id === "lookForm") {
      const color = (n) => f.querySelector(`input[name="${n}"]:checked`)?.value || f[n + "Custom"].value;
      const body = { accentColor: color("accentColor"), backgroundColor: color("backgroundColor"), fontFamily: f.fontFamily.value, corners: f.corners.value };
      for (const k of ["heroTitle", "heroHighlight", "heroText", "announcement", "heroChip", "heroTicks", "footerText", "instagram", "tiktok", "facebook"]) body[k] = f[k].value;
      await act(() => api("POST", "/api/admin/settings", body), "Apariencia guardada: así la ven tus clientes");
    } else if (f.id === "logoForm") {
      await act(async () => api("POST", "/api/admin/settings/logo", { contentBase64: await fileToBase64(f.file.files[0]) }), "Logo actualizado");
    } else if (f.id === "qrForm") {
      await act(async () => api("POST", "/api/admin/settings/qr", { contentBase64: await fileToBase64(f.file.files[0]) }), "QR actualizado");
    } else if (f.id === "alertForm") {
      await act(() => api("POST", "/api/admin/alerts", { phone: f.phone.value, payments: f.payments.checked, supplierExpiry: f.supplierExpiry.checked, supplierDaysBefore: +f.supplierDaysBefore.value }),
        f.phone.value.trim() ? "Listo: te vamos a avisar por WhatsApp" : "Guardado (sin WhatsApp: solo avisos en el panel)");
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
