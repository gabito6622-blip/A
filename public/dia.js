// Día a día del dueño en el panel (14/11/2026). Piezas chicas que usan Mi secretaria, Inicio, el Control y Vender:
//   - «se corta solo el dd/mm» en lo que está por cortarse;
//   - «Me pagó» de lo que ya se cortó solo (reactivar, con otro perfil si el suyo ya no está libre);
//   - «💳 Renovar proveedor y anotar» cuando «Me pagó» choca con la fecha del proveedor;
//   - «Renovar · dd/mm» del Control sin prometer una fecha que el proveedor no da;
//   - «Cambiar de cuenta»: primero los perfiles libres, después los apartados (con confirmación);
//   - Vender: crear el cliente ahí mismo si lo que escribiste no es un cliente.
// Nada se manda solo: los botones guardan en el panel y, a lo sumo, abren un WhatsApp que manda el dueño.
import { api, esc, bs, fdate, toast, toCents, newKey } from "/common.js";
import { matchCustomers, resolveCustomer } from "/buscar.js";

const DAY = 86_400_000;
// «13/01», siempre con dos cifras: «es-BO» sin año daba «13/1» (revisión de 3 meses, 16/11/2026).
export const dm = (t) => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
const usdTxt = (c) => `US$ ${(c / 100).toLocaleString("es-BO", { maximumFractionDigits: 2 })}`;
const plural = (n, a, b) => `${n} ${n === 1 ? a : b}`;
const reload = () => document.querySelector('[data-go="secretaria"]')?.click();

/* ---------------- Números del día (Inicio y Mi secretaria) ---------------- */
/** «3 tuyos · 2 de revendedores» (solo si hay de revendedores). */
export const splitTxt = (s) => (s && s.rev ? `${s.mine} tuyo${s.mine === 1 ? "" : "s"} · ${s.rev} de revendedores` : "");
/** Línea del día de Mi secretaria: el mismo número que el botón del Inicio. */
export function diaLine(d) {
  if (!d) return "";
  const sp = splitTxt(d);
  return `📅 <b>${d.total}</b> para hoy${sp ? ` <small>(${sp})</small>` : ""}`;
}

/* ---------------- Corte automático ---------------- */
/** «✂️ se corta solo el dd/mm» si el corte es en 3 días o menos. */
export function cutTxt(cutAt, now = Date.now()) {
  if (!cutAt) return "";
  const days = Math.round((new Date(cutAt).setHours(0, 0, 0, 0) - new Date(now).setHours(0, 0, 0, 0)) / DAY);
  return days <= 3 ? `✂️ se corta solo el ${dm(Math.max(cutAt, now))}` : "";
}

/* ---------------- «Me pagó» con la fecha del proveedor encima ---------------- */
export function supplierRenewHtml(pv) {
  const h = pv.supplierRenew;
  if (!h) return "";
  const amt = `${bs(h.amount)}${h.usd ? ` (${usdTxt(h.usd)})` : ""}`;
  return `<div class="inline sec-pvact"><button type="button" class="pbtn dark" data-secsup="${esc(pv.assignmentId)}">💳 Renovar proveedor y anotar</button></div>
    <div class="sec-supbox" hidden>
      <p>Vas a anotar que le pagaste <b>${amt}</b> al proveedor por <span class="sec-mail">${esc(h.email)}</span> (${plural(h.months, "mes", "meses")}). La cuenta pasa a vencer el <b>${fdate(h.to)}</b>.</p>
      <p>Después se anota el cobro de ${esc(pv.customer.name)}: nueva fecha <b>${fdate(pv.to)}</b>.</p>
      <label class="sec-price">Cobré (Bs)<input name="supprice" inputmode="decimal" value="${(pv.price / 100).toFixed(2)}"></label>
      <div class="inline sec-pvact"><button type="button" class="pbtn green" data-secsupok="${esc(pv.assignmentId)}" data-months="${h.months}" data-key="${esc(newKey())}">✅ Sí: renové y me pagó</button><button type="button" class="pbtn" data-secsupno="1">Cancelar</button></div>
    </div>`;
}

/* ---------------- Se cortaron solos (reactivar con «Me pagó») ---------------- */
export function cortadosSection(list) {
  if (!list?.length) return "";
  const items = list.map((i) => `<li data-secitem="${esc(i.assignmentId)}"><span class="sec-mail">${esc(i.name)}${i.viaReseller ? ` <small class="muted">· de ${esc(i.payerName)}</small>` : ""}</span>
    <span class="sec-meta">${esc(i.product)} · ${esc(i.email)}${i.profile ? ` · ${esc(i.profile)}` : ""}</span>
    <span class="sec-meta">venció ${dm(i.expiredAt)} · <span class="sec-cut">se cortó solo el ${dm(i.closedAt)}</span> · ${i.priceUsd !== undefined ? usdTxt(i.priceUsd) : bs(i.price)}</span>
    <button type="button" class="pbtn sm green sec-pay" data-secreact="${esc(i.assignmentId)}">💵 Me pagó · reactivar</button><div class="sec-pv" hidden></div></li>`).join("");
  return `<section class="card sec-card" id="sec-cortados"><h2>✂️ Se cortaron solos <small>· últimos 30 días</small></h2>
    <p class="muted" style="margin:0">Vencieron y el sistema los cortó (2 días después del vencimiento). Si te pagan igual, tocá «Me pagó»: vuelve a su perfil si sigue libre, o te ofrezco otro.</p>
    <ul class="sec-items">${items}</ul></section>`;
}

function reactPreviewHtml(pv, key) {
  const slotRow = pv.mode === "same" ? `<b>Su mismo perfil</b>: <span class="sec-mail">${esc(pv.slot.email)}</span> · ${esc(pv.slot.label)}`
    : pv.mode === "other" ? `<label class="sec-slotpick">Otro perfil libre de ${esc(pv.product)}<select name="slot">${pv.options.map((o) => `<option value="${esc(o.slotId)}"${o.slotId === pv.slot.slotId ? " selected" : ""}>${esc(o.email)} · ${esc(o.label)} (proveedor ${dm(o.supplierExpiresAt)})</option>`).join("")}</select></label>`
    : "—";
  const rows = [["Cliente", `${esc(pv.customer.name)}${pv.payer.id !== pv.customer.id ? ` · paga ${esc(pv.payer.name)}` : ""}`],
    ["Perfil", slotRow],
    ["Monto", `<b>${pv.priceUsd !== undefined ? usdTxt(pv.priceUsd) : bs(pv.price)}</b> por 1 período (${pv.days} días)`],
    ["Fecha nueva", `del <b>${fdate(pv.from)}</b> al <b>${fdate(pv.to)}</b> <small class="muted">(arranca hoy)</small>`]];
  return `<div class="sec-pvbox">
    <table class="sec-pvt">${rows.map(([k, v]) => `<tr><th>${k}</th><td>${v}</td></tr>`).join("")}</table>
    ${pv.blockers.map((b) => `<p class="sec-block">⛔ ${esc(b)}</p>`).join("")}${pv.warnings.map((w) => `<p class="sec-warn">⚠️ ${esc(w)}</p>`).join("")}
    ${pv.supplierWarn ? `<p class="sec-warn sec-supwarn">${esc(pv.supplierWarn.text)}</p>` : ""}
    <div class="inline sec-pvact">${pv.ok ? `<label class="sec-price">Cobré (Bs)<input name="price" inputmode="decimal" value="${(pv.price / 100).toFixed(2)}"></label>
      <button type="button" class="pbtn green" data-secreactok="${esc(pv.assignmentId)}" data-key="${esc(key)}">✅ Confirmar: me pagó</button>` : ""}<button type="button" class="pbtn" data-secpayno="1">Cancelar</button></div></div>`;
}

/* ---------------- Control: «Renovar · dd/mm» sin prometer de más ---------------- */
/**
 * Lo que muestra el botón «Renovar» del Control. Si la fecha nueva pasa la del proveedor, el botón no la promete y el
 * motivo se ve antes de tocar. La confirmación dice el monto.
 */
/** Desde cuándo corre lo que se cobra (igual que el servidor, cobrarBien.ts → renewStart): atrasado sin cortar, desde el vencimiento. */
export function renewFrom(r, now = Date.now()) {
  const exp = r.customerExpiresAt;
  return exp >= now || (!r.holdOpen && now - exp <= 30 * DAY) ? exp : now;
}
export function controlRenew(r, moneyTxt, now = Date.now()) {
  const days = r.durationDays ?? 30;
  const next = renewFrom(r, now) + days * DAY;
  const ok = !(r.supplierExpiresAt && next > r.supplierExpiresAt);
  const who = `${r.customerName || "este cliente"} (${r.email}${r.profile && !/completa/i.test(r.profile) ? ` · ${r.profile}` : ""})`;
  return {
    ok, next,
    label: ok ? `✅ Renovar · ${dm(next)}` : "✅ Renovar · ⚠️ ver proveedor",
    warn: ok ? "" : `⚠️ La cuenta vence con el proveedor el ${dm(r.supplierExpiresAt)}: +${days} días llegaría al ${dm(next)}. Se puede anotar igual: renová el proveedor antes del ${dm(r.supplierExpiresAt)} o cambiala de cuenta.`,
    confirm: ok
      ? `¿Renovar a ${who}?\n\n💵 Cobrás: ${moneyTxt} (efectivo/QR)\n📅 Vence: ${fdate(r.customerExpiresAt)} → ${fdate(next)} (+${days} días)`
      : `⚠️ La fecha nueva pasa la del proveedor: la cuenta vence con el proveedor el ${fdate(r.supplierExpiresAt)} y +${days} días llegaría al ${fdate(next)}.\n\n💵 Monto: ${moneyTxt}\n\nSi te pagó, se anota igual y la cuenta queda en «Proveedores por renovar» (Mi secretaria): renová el proveedor antes del ${dm(r.supplierExpiresAt)}. ¿Anotar el cobro?`,
  };
}

/* ---------------- Renovar con los frenos de la revisión de 3 meses ---------------- */
/**
 * «Renovar» del Control y de Vender: si ya hay un cobro en este período, pregunta «¿Es otro mes?» (409 DOUBLE_CHARGE);
 * si la fecha pasa la del proveedor, lo anota igual como «Me pagó» (decisión (b)), con el aviso. Devuelve
 * `{ to, supplierWarn? }` o `null` si el dueño dijo que no. `beyondOk`: ya confirmó lo del proveedor.
 */
export async function renewFlow(id, { beyondOk = false } = {}) {
  const key = newKey();
  const ask = (e) => confirm(`${e.message}\n\nTocá «Aceptar» solo si te pagó OTRO mes.`);
  const viaPay = async (confirmOther = false) => {
    try {
      const r = await api("POST", `/api/admin/assignments/${id}/pay`, { periods: 1, idempotencyKey: key, renew: true, ...(confirmOther ? { confirmOther: true } : {}) });
      return { to: r.saved.to, supplierWarn: r.saved.supplierWarn };
    } catch (e) {
      if (e.code === "DOUBLE_CHARGE" && !confirmOther) return ask(e) ? viaPay(true) : null;
      throw e;
    }
  };
  const viaRenew = async (confirmOther = false) => {
    try {
      const r = await api("POST", `/api/admin/assignments/${id}/renew`, { paymentMethod: "cash", idempotencyKey: key, ...(confirmOther ? { confirmOther: true } : {}) });
      return { to: r.assignment.customerExpiresAt };
    } catch (e) {
      if (e.code === "DOUBLE_CHARGE" && !confirmOther) return ask(e) ? viaRenew(true) : null;
      if (e.code === "SUPPLIER_EXPIRY_EXCEEDED" && e.status === 409) {
        if (!beyondOk && !confirm(`${e.message}\n\nSi te pagó, se anota igual y la cuenta queda en «Proveedores por renovar» (Mi secretaria). ¿Anotar el cobro?`)) return null;
        return viaPay(confirmOther);
      }
      throw e;
    }
  };
  return viaRenew();
}

/* ---------------- Control: «🔀 Cambiar de plataforma» ---------------- */
let rerender = () => {};
/** panel.js pasa su `render` para volver a dibujar después de cambiar de plataforma. */
export function setRerender(fn) { rerender = fn; }
/** Desplegable en la tarjeta del Control: elegís la plataforma nueva, ves el cambio y confirmás. */
export function switchPlatHtml(r) {
  return `<details class="more swplat" data-switchplat="${esc(r.id)}" data-pid="${esc(r.productId)}"><summary>🔀 Cambiar de plataforma</summary>
    <div class="swp"><label>Pasar a<select name="swto" aria-label="Plataforma nueva"><option value="">Elegí…</option></select></label>
    <button type="button" class="pbtn sm dark" data-swpv="${esc(r.id)}">Ver el cambio</button><div class="swpbox" role="status" hidden></div></div></details>`;
}
function switchBoxHtml(pv) {
  const row = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  const prof = (x) => `<span class="sec-mail">${esc(x.email)}</span>${x.label && !/completa/i.test(x.label) ? ` · ${esc(x.label)}` : ""}`;
  return `<div class="sec-pvbox"><table class="sec-pvt">
      ${row("Ahora", `${esc(pv.from.product)} · ${prof(pv.from)} · ${bs(pv.from.price)}`)}
      ${row("Pasa a", pv.to.slotId ? `<b>${esc(pv.to.product)}</b> · ${prof(pv.to)} · ${bs(pv.to.price)}` : esc(pv.to.product || "—"))}
      ${row("Fecha", `vence el <b>${fdate(pv.expiresAt)}</b>`)}</table>
    ${pv.blockers.map((b) => `<p class="sec-block">⛔ ${esc(b)}</p>`).join("")}${pv.warnings.map((w) => `<p class="sec-warn">${/^⚠️/.test(w) ? "" : "⚠️ "}${esc(w)}</p>`).join("")}
    ${pv.ok ? `<p class="muted" style="margin:0">${esc(pv.adjustText)} El perfil viejo queda apartado (cambiale la clave antes de volver a venderlo).</p>
      <div class="inline sec-pvact"><button type="button" class="pbtn green" data-swok="${esc(pv.assignmentId)}" data-to="${esc(pv.to.productId)}" data-slot="${esc(pv.to.slotId)}" data-key="${esc(newKey())}">✅ Cambiar · mantener ${dm(pv.expiresAt)}</button>
      ${pv.priceDiff ? `<button type="button" class="pbtn" data-swok="${esc(pv.assignmentId)}" data-to="${esc(pv.to.productId)}" data-slot="${esc(pv.to.slotId)}" data-adjust="price" data-key="${esc(newKey())}">📅 Cambiar · ajustar a ${dm(pv.adjustedExpiresAt)}</button>` : ""}</div>` : ""}</div>`;
}
if (typeof document !== "undefined") {
  // Al abrir «Cambiar de plataforma» se cargan las plataformas (menos la que ya tiene y los combos).
  document.addEventListener("toggle", async (ev) => {
    const d = ev.target;
    if (!d?.dataset?.switchplat || !d.open) return;
    const sel = d.querySelector('[name="swto"]');
    if (!sel || sel.options.length > 1) return;
    try {
      const ps = (await api("GET", "/api/admin/products")).filter((p) => p.kind !== "combo" && p.id !== d.dataset.pid);
      sel.insertAdjacentHTML("beforeend", ps.map((p) => `<option value="${esc(p.id)}">${esc(p.name.replace(/ \(alquiler revendedores\)/, ""))}</option>`).join(""));
    } catch (e) { toast(e.message); }
  }, true);
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-swpv],[data-swok]");
    if (!b) return;
    const wrap = b.closest("[data-switchplat]"), box = wrap?.querySelector(".swpbox");
    if (!box) return;
    if (b.dataset.swpv) {
      const to = wrap.querySelector('[name="swto"]')?.value;
      if (!to) { box.hidden = false; box.innerHTML = `<p class="sec-block">Elegí la plataforma nueva.</p>`; return; }
      b.disabled = true;
      try {
        const pv = await api("GET", `/api/admin/assignments/${b.dataset.swpv}/switch-preview?to=${encodeURIComponent(to)}`);
        box.innerHTML = switchBoxHtml(pv); box.hidden = false;
      } catch (e) { box.innerHTML = `<p class="sec-block">${esc(e.message)}</p>`; box.hidden = false; } finally { b.disabled = false; }
      return;
    }
    b.disabled = true;
    try {
      const r = await api("POST", `/api/admin/assignments/${b.dataset.swok}/switch`, { toProductId: b.dataset.to, toSlotId: b.dataset.slot, ...(b.dataset.adjust ? { adjust: b.dataset.adjust } : {}), idempotencyKey: b.dataset.key });
      toast(`🔀 Listo: ahora tiene ${r.to.product} (${r.to.email}) hasta el ${fdate(r.expiresAt)}. Mandale los accesos nuevos con «📲 Reenviar accesos»`);
      await rerender();
    } catch (e) { toast(e.message); b.disabled = false; }
  });
}

/* ---------------- Control: «Cambiar de cuenta» ---------------- */
/** Opciones del selector: primero los perfiles libres; después los apartados (cuarentena), marcados y separados. */
export function swapOptionsHtml(opts) {
  const o = (x) => `<option value="${esc(x.id)}"${x.q ? ` data-q="1"` : ""}>${esc(x.email)}${x.label && !/completa/i.test(x.label) ? ` · ${esc(x.label)}` : ""}${x.q ? " (apartado)" : ""}</option>`;
  const free = opts.filter((x) => !x.q), quar = opts.filter((x) => x.q);
  return `${free.length ? `<optgroup label="✅ Libres">${free.map(o).join("")}</optgroup>` : ""}${quar.length ? `<optgroup label="⏸️ Apartados (en cuarentena: revisá la clave)">${quar.map(o).join("")}</optgroup>` : ""}`;
}
/** Si el perfil elegido está apartado, pide confirmación. Devuelve false si el dueño dice que no. */
export function confirmSwap(select) {
  const op = select?.options[select.selectedIndex];
  if (!op || op.dataset.q !== "1") return true;
  return confirm(`«${op.textContent}» está APARTADO (en cuarentena): puede que haya que cambiarle la clave o que lo use otra persona.\n\n¿Pasar al cliente a ese perfil igual?`);
}

/* ---------------- Vender: crear el cliente ahí mismo ---------------- */
let sellCfg = null;
/** `getMap()` → { "Nombre · teléfono": id }; `onCreated(label, customer)` actualiza la venta. */
export function initSellNew(cfg) { sellCfg = cfg; }
/** El cliente de la venta: el elegido de la lista o el único que coincide con lo escrito (sin tildes ni orden). */
export function sellCustomer(typed) { return resolveCustomer(sellCfg?.getMap() ?? {}, typed); }
/**
 * Debajo del nombre: «¿Es Ana Quispe · 7100…?» (botones grandes) si lo escrito se parece a clientes de la lista, y
 * «➕ Crear "<nombre>"» si no es ninguno. Busca sin tildes, en cualquier orden y por parte del número.
 */
export function sellNewHint(form) {
  const box = form?.querySelector("#sellNew");
  if (!box || !sellCfg) return;
  const v = form.customerName.value.trim();
  const map = sellCfg.getMap() ?? {};
  if (v.length < 2 || map[v]) { box.hidden = true; box.innerHTML = ""; return; }
  // No se redibuja mientras escribe en los campos de adentro.
  if (box.contains(document.activeElement) && document.activeElement.tagName === "INPUT") return;
  const sug = matchCustomers(map, v, 5), res = resolveCustomer(map, v);
  const digits = v.replace(/\D/g, "");
  const isPhone = digits.length >= 7 && !/[a-záéíóúñ]{2,}/i.test(v);
  const name = isPhone ? "" : v, phone = isPhone ? v : "";
  const create = `<label>Nombre<input name="newName" value="${esc(name)}" autocomplete="off" maxlength="80" placeholder="Nombre del cliente"></label>
    <label>WhatsApp<input name="newPhone" value="${esc(phone)}" inputmode="tel" autocomplete="off" maxlength="20" placeholder="Ej.: 70012345"></label>
    <small class="sellnew-err bad" role="alert" hidden></small>
    <div class="sellnew-alt" hidden></div>
    <button type="button" class="pbtn dark" data-sellnew="1">➕ Crear "${esc(name || v)}"</button>`;
  box.hidden = false;
  box.innerHTML = sug.length
    ? `<small class="muted">${res ? "Le vendés a este cliente (tocalo para confirmar o elegí otro):" : "¿Es alguno de tus clientes? Tocá el que es:"}</small>
      <div class="sellsug">${sug.map((x) => `<button type="button" class="pbtn sellpick${res?.id === x.id ? " on" : ""}" data-sellpick="${esc(x.label)}" aria-pressed="${res?.id === x.id}">¿Es ${esc(x.label)}?</button>`).join("")}</div>
      <details class="sellnewd"><summary>➕ No, es un cliente nuevo</summary><div class="sellnewf">${create}</div></details>`
    : `<small class="muted">«${esc(v)}» no está en tus clientes. Crealo acá y seguí con la venta:</small>${create}`;
}

/* ---------------- Vender: ¿ya tiene esa plataforma? ---------------- */
/**
 * Antes de vender: si el cliente ya tiene esa plataforma activa, pregunta «¿Es otro perfil o querías renovar?» con dos
 * botones. Devuelve true si se puede seguir con la venta.
 */
export async function sellDupCheck(form, cid, productId, productName, custName) {
  const k = `${cid}|${productId}`;
  if (form.dataset.dupok === k) return true;
  let list = [];
  try { list = await api("GET", `/api/admin/assignments?customerId=${encodeURIComponent(cid)}&productId=${encodeURIComponent(productId)}`); } catch { return true; }
  const act = list.filter((a) => a.customerId === cid && a.productId === productId);
  if (!act.length) return true;
  let box = form.querySelector("#sellDup");
  if (!box) { box = document.createElement("div"); box.id = "sellDup"; box.className = "selldup"; box.setAttribute("role", "alert"); form.querySelector("#sellBtn")?.before(box); }
  const a = act.sort((x, y) => y.customerExpiresAt - x.customerExpiresAt)[0];
  const first = String(custName || "El cliente").split(" · ")[0].split(" ")[0];
  box.hidden = false;
  box.innerHTML = `<p><b>${esc(first)} ya tiene ${esc(productName)} hasta el ${dm(a.customerExpiresAt)}</b>${act.length > 1 ? ` (y ${act.length - 1} más)` : ""} <span class="muted">· ${esc(a.email)}${a.profile ? ` · ${esc(a.profile)}` : ""}</span>. ¿Es otro perfil o querías renovar?</p>
    <div class="inline sec-pvact"><button type="button" class="pbtn green" data-selldupren="${esc(a.id)}">🔄 Renovar su ${esc(productName)}</button><button type="button" class="pbtn" data-selldupok="${esc(k)}">➕ Es otro perfil: vender</button></div>`;
  box.scrollIntoView({ block: "nearest" });
  return false;
}

/* ---------------- Clics ---------------- */
if (typeof document !== "undefined") {
  // Enter dentro de «crear cliente» crea el cliente (no manda la venta).
  document.addEventListener("keydown", (ev) => {
    if (ev.key !== "Enter" || !ev.target.closest?.("#sellNew")) return;
    ev.preventDefault();
    ev.target.closest("#sellNew").querySelector("[data-sellnew]")?.click();
  });
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-secsup],[data-secsupok],[data-secsupno],[data-secreact],[data-secreactok],[data-sellnew],[data-sellpick],[data-selldupok],[data-selldupren]");
    if (!b) return;
    if (b.dataset.sellpick) {
      const form = b.closest("form");
      form.customerName.value = b.dataset.sellpick;
      form.customerName.dispatchEvent(new Event("input", { bubbles: true }));
      form.querySelector("#sellDup")?.remove();
      toast(`👤 ${b.dataset.sellpick.split(" · ")[0]}: ahora elegí el producto`);
      return;
    }
    if (b.dataset.selldupok) {
      const form = b.closest("form");
      form.dataset.dupok = b.dataset.selldupok;
      form.querySelector("#sellDup")?.remove();
      form.requestSubmit();
      return;
    }
    if (b.dataset.selldupren) {
      b.disabled = true;
      try {
        const r = await renewFlow(b.dataset.selldupren);
        if (r) {
          toast(`🔄 Renovado hasta el ${fdate(r.to)}${r.supplierWarn ? " · ⚠️ renová el proveedor" : ""}`);
          b.closest("#sellDup")?.remove();
        } else b.disabled = false;
      } catch (e) { toast(e.message); b.disabled = false; }
      return;
    }
    if (b.dataset.sellnew) {
      const box = b.closest("#sellNew"), form = b.closest("form");
      const name = box.querySelector('[name="newName"]').value.trim(), phone = box.querySelector('[name="newPhone"]').value.trim();
      const err = box.querySelector(".sellnew-err");
      const fail = (m) => { err.textContent = m; err.hidden = false; };
      if (!name) return fail("Poné el nombre del cliente");
      if (phone.replace(/\D/g, "").length < 7) return fail("Poné su WhatsApp (al menos 7 números)");
      b.disabled = true;
      try {
        const c = await api("POST", "/api/admin/customers", { name, phone });
        const label = `${c.name} · ${c.phone}`.trim();
        sellCfg?.onCreated(label, c);
        form.customerName.value = label;
        const dl = document.getElementById("custlist");
        if (dl) { const o = document.createElement("option"); o.value = label; dl.appendChild(o); }
        box.hidden = true; box.innerHTML = "";
        toast(`✅ Cliente creado: ${c.name}. Ahora elegí el producto`);
        form.customerName.dispatchEvent(new Event("input", { bubbles: true }));
      } catch (e) {
        fail(e.message); b.disabled = false;
        // Ese número ya es de un cliente: en vez del error a secas, ofrecer elegirlo.
        if (/ya existe un cliente con ese tel/i.test(e.message)) {
          const d = phone.replace(/\D/g, "").slice(-8);
          let opts = Object.keys(sellCfg?.getMap() ?? {}).filter((l) => (l.split(" · ")[1] ?? "").replace(/\D/g, "").endsWith(d));
          if (!opts.length) try { opts = (await api("GET", `/api/admin/customers?q=${encodeURIComponent(d)}`)).map((c) => { const l = `${c.name} · ${c.phone}`.trim(); sellCfg?.onCreated(l, c); return l; }); } catch { /* sin conexión: queda el error */ }
          const alt = box.querySelector(".sellnew-alt");
          if (alt && opts.length) { err.textContent = "Ese WhatsApp ya es de un cliente tuyo:"; alt.hidden = false; alt.innerHTML = opts.slice(0, 3).map((l) => `<button type="button" class="pbtn green" data-sellpick="${esc(l)}">👤 Usar a ${esc(l)}</button>`).join(""); }
        }
      }
      return;
    }
    const li = b.closest("li[data-secitem]"), box = li?.querySelector(".sec-pv");
    if (b.dataset.secsupno) { const sb = b.closest(".sec-supbox"); if (sb) sb.hidden = true; return; }
    if (b.dataset.secsup) {
      const sb = b.closest(".sec-pvbox")?.querySelector(".sec-supbox");
      if (sb) { sb.hidden = false; sb.querySelector("[data-secsupok]")?.focus(); }
      return;
    }
    if (b.dataset.secsupok) {
      const price = toCents(b.closest(".sec-supbox")?.querySelector('[name="supprice"]')?.value || "0");
      const otro = b.closest(".sec-pvbox")?.querySelector('[name="otro"]');
      if (otro && !otro.checked) { otro.focus(); toast("Ya hay un cobro en este período: marcá «Sí, es otro mes» si te pagó otro mes"); return; }
      b.disabled = true;
      try {
        const r = await api("POST", `/api/admin/assignments/${b.dataset.secsupok}/pay-with-supplier`, { months: +b.dataset.months, price, idempotencyKey: b.dataset.key, ...(otro?.checked ? { confirmOther: true } : {}) });
        toast(`💳 Proveedor hasta el ${fdate(r.supplier.supplierExpiresAt)} (${bs(r.supplier.amount)}) · 💵 ${r.customer.name} hasta el ${fdate(r.saved.to)}`);
        reload();
      } catch (e) { toast(e.message); b.disabled = false; }
      return;
    }
    if (!box) return;
    if (b.dataset.secreact) {
      b.disabled = true;
      try {
        const pv = await api("GET", `/api/admin/assignments/${b.dataset.secreact}/reactivate-preview`);
        box.innerHTML = reactPreviewHtml(pv, newKey()); box.hidden = false;
        box.scrollIntoView({ block: "nearest", behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" });
      } catch (e) { toast(e.message); } finally { b.disabled = false; }
      return;
    }
    if (b.dataset.secreactok) {
      const price = toCents(box.querySelector('[name="price"]')?.value || "0");
      const toSlotId = box.querySelector('[name="slot"]')?.value;
      b.disabled = true;
      try {
        const r = await api("POST", `/api/admin/assignments/${b.dataset.secreactok}/reactivate`, { price, idempotencyKey: b.dataset.key, ...(toSlotId ? { toSlotId } : {}) });
        toast(`💵 ${r.customer.name} reactivado hasta el ${fdate(r.saved.to)}${r.reactivated.changedSlot ? ` en ${r.reactivated.email} · ${r.reactivated.label}: mandale los accesos nuevos` : ""}`);
        reload();
      } catch (e) { toast(e.message); b.disabled = false; }
    }
  });
}
