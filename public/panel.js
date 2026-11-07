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
  ["proveedores", "truck", "Proveedores"], ["clientes", "users", "Clientes"], ["whatsapp", "wa", "WhatsApp"],
  ["apariencia", "sun", "Apariencia de la tienda"], ["usuarios", "userplus", "Usuarios", "owner"], ["auditoria", "history", "Auditoría", "owner"], ["configuracion", "gear", "Configuración"],
];
const TITLE = { vender: ["cart", "Vender"], renovar: ["renew", "Renovar"], dashboard: ["home", "Dashboard"], aprobacion: ["approve", "Aprobación de Ventas"], recordatorios: ["bell", "Recordatorios"], cuentas: ["user", "Cuentas"], carga: ["box", "Carga de Cuentas"], productos: ["box", "Productos y precios"], proveedores: ["truck", "Proveedores"], clientes: ["users", "Clientes"], whatsapp: ["wa", "WhatsApp"], usuarios: ["userplus", "Usuarios del panel"], apariencia: ["sun", "Apariencia de la tienda"], auditoria: ["history", "Auditoría"], configuracion: ["gear", "Configuración"] };

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
    const list = await api("GET", `/api/admin/assignments?days=${days}`);
    return `<section class="card"><div class="inline"><label class="inline" style="display:flex">Vencen en los próximos<select id="days">${[1, 3, 7, 15].map((d) => opt(d, `${d} días`, d === days)).join("")}</select></label>
      <button class="pbtn dark" type="button" data-remind="${days}">${icon("bell")}Preparar recordatorios</button></div>
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

  async whatsapp() {
    if (!canReview()) return `<section class="card"><div class="emptybox">Solo el dueño o un admin ven los avisos.</div></section>`;
    const [out, customers] = await Promise.all([api("GET", "/api/admin/outbox"), api("GET", "/api/admin/customers")]);
    const name = (id) => customers.find((c) => c.id === id)?.name ?? id;
    const tab = P.tab.wa ?? "pending";
    const pending = out.filter((m) => m.status === "queued" || m.status === "failed");
    const list = tab === "pending" ? pending : tab === "noconsent" ? out.filter((m) => m.status === "skipped_no_consent") : out;
    return `<div class="pok">Modo manual: tocá <b>Abrir WhatsApp</b>, mandá el mensaje desde tu teléfono y después <b>Marcar enviado</b>. Cuando tengas WhatsApp Business API, esto se hace solo.</div>
      <section class="card"><div class="tabs" role="tablist">${[["pending", `Por enviar (${pending.length})`], ["noconsent", "Sin permiso"], ["all", "Todos"]].map(([k, t]) => `<button role="tab" type="button" data-tab="wa:${k}" aria-selected="${k === tab}">${t}</button>`).join("")}</div>
      ${list.length ? list.map((m) => `<div style="display:grid;gap:8px;border-bottom:1px solid var(--line);padding-block:12px"><div class="inline"><b>${esc(name(m.customerId))}</b><span class="muted">${esc(m.to)}</span>${pill({ queued: "Por enviar", failed: "Falló", sent: "Enviado", sent_manually: "Enviado a mano", skipped_no_consent: "Sin permiso del cliente" }[m.status], { queued: "warn", failed: "bad", sent: "ok", sent_manually: "ok", skipped_no_consent: "mute" }[m.status])}<span class="muted" style="margin-left:auto">${fdt(m.createdAt)}</span></div>
        <div class="wa-msg">${esc(m.text)}</div>
        ${m.status === "queued" || m.status === "failed" ? `<div class="inline"><a class="pbtn sm green" href="${waLink(m.to, m.text)}" target="_blank" rel="noopener">${icon("wa")}Abrir WhatsApp</a><button class="pbtn sm" type="button" data-sent="${esc(m.id)}">Marcar enviado</button></div>` : ""}
        ${m.status === "skipped_no_consent" ? `<p class="muted" style="margin:0">El cliente no aceptó avisos. Si te lo pide, activalo en su ficha o mandalo igual a mano.</p>` : ""}</div>`).join("") : `<div class="emptybox">Nada por acá.</div>`}</section>`;
  },

  async apariencia() {
    if (!canReview()) return `<section class="card"><div class="emptybox">Solo el dueño o un admin cambian la apariencia.</div></section>`;
    const s = await api("GET", "/api/settings");
    const ACCENTS = [["#3984ff", "Azul"], ["#7c5cff", "Violeta"], ["#e0368a", "Rosa"], ["#ff5a36", "Naranja"], ["#f2b705", "Dorado"], ["#16b47e", "Verde"], ["#14b8c8", "Turquesa"], ["#e53935", "Rojo"]];
    const BGS = [["#090e1d", "Azul noche"], ["#0b0b0f", "Negro"], ["#140c24", "Violeta oscuro"], ["#07140f", "Verde oscuro"], ["#1a0a10", "Bordó"], ["#111418", "Grafito"]];
    const sw = (name, list, cur) => `<div class="inline">${list.map(([c, t]) => `<label title="${t}" style="display:grid;justify-items:center;gap:4px;font-size:12px;cursor:pointer;position:relative"><input type="radio" name="${name}" value="${c}" ${c.toLowerCase() === cur.toLowerCase() ? "checked" : ""} style="position:absolute;opacity:0">
      <span class="swatch" style="width:38px;height:38px;border-radius:10px;background:${c};border:3px solid ${c.toLowerCase() === cur.toLowerCase() ? "var(--ink)" : "transparent"};box-shadow:0 0 0 1px var(--line)"></span>${t}</label>`).join("")}
      ${name === "accentColor" ? `<label style="display:grid;justify-items:center;gap:4px;font-size:12px">Otro<input type="color" name="accentCustom" value="${esc(cur)}" style="width:44px;height:38px;padding:2px"></label>` : ""}</div>`;
    return `<section class="card"><h2>Colores</h2><form id="lookForm" style="display:grid;gap:16px">
        <div><b>Color principal</b> <span class="muted">· botones, precios y detalles</span>${sw("accentColor", ACCENTS, s.accentColor)}</div>
        <div><b>Fondo</b> <span class="muted">· siempre oscuro, para que se lea bien</span>${sw("backgroundColor", BGS, s.backgroundColor)}</div>
        <h2 style="margin-top:6px">Textos de la página de inicio</h2>
        <div class="form"><label>Título<input name="heroTitle" maxlength="40" value="${esc(s.heroTitle)}"></label><label>Parte destacada (en color)<input name="heroHighlight" maxlength="40" value="${esc(s.heroHighlight)}"></label>
        <label style="grid-column:1/-1">Descripción<input name="heroText" maxlength="220" value="${esc(s.heroText)}"></label>
        <label style="grid-column:1/-1">Aviso arriba de todo (opcional)<input name="announcement" maxlength="140" value="${esc(s.announcement)}" placeholder="Ej.: Netflix a Bs 30 solo este fin de semana"></label></div>
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
      <section class="card"><h2>Cambiar mi contraseña</h2><form class="form" id="pwForm"><label>Contraseña actual<input name="current" type="password" required autocomplete="current-password"></label><label>Nueva contraseña (mín. 10)<input name="next" type="password" minlength="10" required autocomplete="new-password"></label><button class="pbtn dark" type="submit">Cambiar</button></form></section>`;
  },
};

/* ---------------- render ---------------- */
async function render() {
  const pend = await api("GET", "/api/admin/orders?status=payment_review").then((l) => l.length).catch(() => 0);
  $("#dot").hidden = !pend;
  const inG = ["cuentas", "carga", "productos"].includes(P.view);
  $("#menu").innerHTML = MENU.filter((m) => !m[3] || m[3] === "owner" && isOwner() || Array.isArray(m[3])).map(([k, i, t, sub]) => Array.isArray(sub)
    ? `<details ${inG ? "open" : ""}><summary>${icon(i)}${t}${icon("chev", "i chev")}</summary><div class="sub">${sub.map(([k2, t2]) => `<button type="button" data-go="${k2}" ${k2 === P.view ? 'aria-current="page"' : ""}>${t2}</button>`).join("")}</div></details>`
    : `<button type="button" data-go="${k}" ${k === P.view ? 'aria-current="page"' : ""}>${icon(i)}${t}${k === "aprobacion" && pend ? `<span class="count">${pend}</span>` : ""}</button>`).join("");
  const [ti, tt] = TITLE[P.view];
  $("#ptitle").innerHTML = icon(ti) + tt;
  $("#app").classList.remove("open");
  try {
    $("#pout").innerHTML = await V[P.view]();
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
  if (d.editprod !== undefined) { P.tab.editProduct = d.editprod || null; await render(); return scrollTo(0, 0); }
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
    if (ev.target.name === "accentColor") $('input[name="accentCustom"]').value = ev.target.value;
  }
  if (ev.target.name === "accentCustom") $$('input[name="accentColor"]').forEach((r) => { r.checked = false; r.nextElementSibling.style.borderColor = "transparent"; });
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
      const custom = f.accentCustom.value;
      const picked = f.querySelector('input[name="accentColor"]:checked')?.value;
      await act(() => api("POST", "/api/admin/settings", {
        accentColor: picked || custom, backgroundColor: f.querySelector('input[name="backgroundColor"]:checked')?.value,
        heroTitle: f.heroTitle.value, heroHighlight: f.heroHighlight.value, heroText: f.heroText.value, announcement: f.announcement.value,
      }), "Apariencia guardada: así la ven tus clientes");
    } else if (f.id === "logoForm") {
      await act(async () => api("POST", "/api/admin/settings/logo", { contentBase64: await fileToBase64(f.file.files[0]) }), "Logo actualizado");
    } else if (f.id === "qrForm") {
      await act(async () => api("POST", "/api/admin/settings/qr", { contentBase64: await fileToBase64(f.file.files[0]) }), "QR actualizado");
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
