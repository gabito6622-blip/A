// Panel del dueño: revendedores un mes entero sin perder plata ni cuentas (revisión de 3 meses, 14/11/2026).
//  - «💳 Un solo comprobante para varios pedidos»: aprobarlos juntos si lo que llegó al banco es la suma.
//  - Aprobar una solicitud: tipo (de confianza / independiente) y lista de precios (viene marcada la de los demás).
//  - «👤 Pasar a otro»: confirmación que explica qué pasa con la deuda y la libreta; «Fue un error: pasar también el cobro».
//  - «💵 Me pagó todo» por revendedor: sus alquileres vencidos o por vencer y lo que debe, con la suma, todo junto.
//  - «Renovar +1» masivo del Control: confirma el total antes de anotar.
//  - Independiente: interruptor «renueva sus alquileres desde GaboHub».
//  - Vender: aviso si la lista del revendedor no tiene precio para ese producto.
// Nada se manda solo. El servidor decide montos y permisos; acá solo se muestra y se confirma.
import { api, esc, bs, fdate, toast, newKey, toCents } from "/common.js";

let ctx = { render: async () => {} };
export function initRevMes(c) { ctx = { ...ctx, ...c }; }

/* ---------------- Ventana simple (sin alert) ---------------- */
function modal(title, html) {
  document.getElementById("rmScrim")?.remove();
  const el = document.createElement("div");
  el.id = "rmScrim"; el.className = "dlv-scrim";
  el.innerHTML = `<div class="dlv-card rmcard" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="dlv-top"><h3>${esc(title)}</h3><button class="pbtn sm" type="button" data-rmclose="1" aria-label="Cerrar">✕</button></div>${html}</div>`;
  const close = () => { el.remove(); document.removeEventListener("keydown", onKey); };
  const onKey = (ev) => { if (ev.key === "Escape") close(); };
  el.addEventListener("click", (ev) => { if (ev.target === el || ev.target.closest("[data-rmclose]")) close(); });
  document.addEventListener("keydown", onKey);
  (document.getElementById("app") ?? document.body).appendChild(el);
  el.querySelector("button:not([data-rmclose]), select, input")?.focus();
  return { el, close };
}
const errBox = (el, msg) => { const b = el.querySelector(".rmerr"); if (b) { b.textContent = msg; b.hidden = false; } };

/* ---------------- 1 · Un solo comprobante para varios pedidos ---------------- */
export async function groupCard(canReview) {
  if (!canReview) return "";
  const groups = await api("GET", "/api/admin/order-groups").catch(() => []);
  if (!groups.length) return "";
  return `<section class="card rmgroups"><h2>💳 Un solo comprobante para varios pedidos <small>${groups.length}</small></h2>
    <p class="muted" style="margin:0">Pagó varias renovaciones con un solo QR. Mirá el comprobante, escribí la referencia del banco y cuánto llegó: si es la suma, se aprueban todas juntas. Si no coincide, no se aprueba ninguna.</p>
    ${groups.map((g, i) => `<div class="rmgroup" data-rmg="${i}">
      <b>${esc(g.payerName)} · Op. ${esc(g.reference)}</b>
      <ul class="rmglist">${g.orders.map((o) => `<li><span>${esc(o.product)}${o.customerName !== g.payerName ? ` · ${esc(o.customerName)}` : ""}</span><b>${bs(o.total)}</b></li>`).join("")}
        ${g.prior.map((o) => `<li class="muted"><span>✅ ya aprobado: ${esc(o.product)}</span><b>${bs(o.total)}</b></li>`).join("")}</ul>
      <p style="margin:0">Total del comprobante: <b>${bs(g.grandTotal)}</b>${g.prior.length ? ` <small class="muted">(${bs(g.priorTotal)} ya aprobados + ${bs(g.total)} por aprobar)</small>` : ""}</p>
      <a class="pbtn sm" style="justify-self:start" href="/api/admin/orders/${esc(g.orders[0].id)}/evidence" target="_blank" rel="noopener">👁️ Ver el comprobante</a>
      <div class="inline" style="flex-wrap:wrap"><input name="ref" placeholder="Referencia del banco" aria-label="Referencia bancaria verificada"><input name="amt" inputmode="decimal" placeholder="Llegó Bs" aria-label="Cuánto llegó al banco, en Bs" style="max-width:120px">
        <button class="pbtn sm green" type="button" data-rmgok="${i}">Aprobar ${g.orders.length === 1 ? "el pedido" : `los ${g.orders.length} juntos`}</button></div>
      <p class="bad rmerr" hidden></p></div>`).join("")}</section>`;
}
let groupsCache = null;
async function approveGroup(i, box) {
  groupsCache = groupsCache ?? await api("GET", "/api/admin/order-groups");
  const g = groupsCache[i];
  const ref = box.querySelector('[name="ref"]').value.trim(), amt = toCents(box.querySelector('[name="amt"]').value);
  if (!ref) return errBox(box, "Escribí la referencia del banco");
  if (!amt) return errBox(box, "Escribí cuánto llegó al banco");
  if (!confirm(`¿Aprobar ${g.orders.length} pedido(s) de ${g.payerName} por ${bs(g.total)}${g.prior.length ? ` (más ${bs(g.priorTotal)} ya aprobados)` : ""} con la referencia ${ref}?`)) return;
  await api("POST", "/api/admin/order-groups/approve", { orderIds: g.orders.map((o) => o.id), confirmedReference: ref, amount: amt, idempotencyKey: newKey() });
  toast(`✅ ${g.orders.length} pedido(s) aprobados y renovados`);
  await ctx.render();
}

/* ---------------- 4 · Aprobar una solicitud: tipo y lista ---------------- */
export function approveAppDialog(appId, name = "") {
  return new Promise(async (resolve) => {
    let opt;
    try { opt = await api("GET", "/api/admin/reseller-apps/options"); } catch (e) { toast(e.message); return resolve(null); }
    const withPrices = opt.groups.some((g) => g.prices > 0);
    const m = modal(`Aprobar a ${name || "este revendedor"}`, `<fieldset class="rmfs"><legend>¿Qué tipo de revendedor es?</legend>
        <label class="chk"><input type="radio" name="rmtrust" value="trusted"> <span><b>🤝 De confianza</b><br><small class="muted">Te compra o alquila tus cuentas.</small></span></label>
        <label class="chk"><input type="radio" name="rmtrust" value="independent" checked> <span><b>🆕 Independiente</b><br><small class="muted">Usa GaboHub con SUS cuentas; no ve tu stock.</small></span></label></fieldset>
      <label>Lista de precios<select name="rmgroup">${opt.groups.map((g) => `<option value="${esc(g.id)}" ${g.id === opt.suggested ? "selected" : ""} ${withPrices && !g.prices ? "disabled" : ""}>${esc(g.name)} · ${g.prices} precio(s)${g.resellers ? ` · la usan ${g.resellers}` : ""}${!g.prices ? " · vacía" : ""}</option>`).join("")}</select></label>
      <small class="muted">Viene marcada la que usan tus otros revendedores. Una lista vacía le cobraría el precio de la tienda.</small>
      <p class="bad rmerr" hidden></p>
      <div class="inline"><button class="pbtn green" type="button" data-rmappok="1">✅ Aprobar</button><button class="pbtn" type="button" data-rmclose="1">Cancelar</button></div>`);
    const obs = new MutationObserver(() => { if (!m.el.isConnected) { obs.disconnect(); resolve(null); } });
    obs.observe(m.el.parentElement, { childList: true });
    m.el.querySelector("[data-rmappok]").addEventListener("click", async (ev) => {
      ev.target.disabled = true;
      try {
        const trust = m.el.querySelector('[name="rmtrust"]:checked')?.value ?? "independent";
        const r = await api("POST", `/api/admin/reseller-apps/${appId}/approve`, { trust, priceGroupId: m.el.querySelector('[name="rmgroup"]').value });
        obs.disconnect(); m.close(); resolve(r);
      } catch (e) { ev.target.disabled = false; errBox(m.el, e.message); }
    });
  });
}

/* ---------------- 5 · Pasar a otro ---------------- */
export const transferExtras = () => `<label class="chk" style="flex-basis:100%"><input type="checkbox" name="moveCharge"> Fue un error: pasar también el cobro (el pedido y la plata van a la persona correcta)</label>`;
/** Pide la confirmación con lo que va a pasar. Devuelve lo que hay que mandar al servidor, o null si canceló. */
export async function confirmTransfer(f) {
  if (!f.to.value) { toast("Elegí a quién se lo pasás"); return null; }
  const pv = await api("GET", `/api/admin/assignments/${f.dataset.transfer}/transfer-preview?to=${encodeURIComponent(f.to.value)}`);
  const move = !!f.moveCharge?.checked;
  if (move && pv.charge.blocked) { toast(pv.charge.blocked); return null; }
  const lines = move
    ? [`${pv.to.name} recibe el mismo perfil y la misma fecha.`, pv.charge.orders.length ? `El cobro (${pv.charge.orders.length} pedido(s), ${bs(pv.charge.total)}) pasa a ${pv.to.name}: para Finanzas, te pagó ${pv.to.name}.` : "No hay pedido para pasar.", "El Control queda como está (es la misma venta)."]
    : pv.lines;
  return confirm(`¿Pasar de ${pv.from.name} a ${pv.to.name}?\n\n• ${lines.join("\n• ")}`) ? { moveCharge: move } : null;
}
export function transferMsg(r) {
  const t = r?.transfer ?? {};
  return ["Servicio transferido: misma fecha y mismo perfil", t.debtToPrevious ? `la deuda (${bs(t.debtToPrevious)}) quedó en el fiado del anterior` : "", t.bookSaved ? "su libreta quedó guardada" : "", t.bookRestored ? "volvió su libreta" : "", t.ordersMoved?.length ? "el cobro también pasó" : ""].filter(Boolean).join(" · ");
}

/* ---------------- 6 · Me pagó todo ---------------- */
export const paidAllBtn = (r, canReview) => (canReview ? `<button class="pbtn sm green" type="button" data-rmpaid="${esc(r.id)}" data-name="${esc(r.name)}">💵 Me pagó todo</button>` : "");
async function paidAll(id, name) {
  const d = await api("GET", `/api/admin/resellers/${id}/due`);
  const ok = d.rows.filter((x) => !x.blocked);
  const row = (x) => `<li class="${x.blocked ? "muted" : ""}"><span><b>${esc(x.product)}</b>${x.client ? ` · ${esc(x.client)}` : ""}<br><small class="muted">${x.action === "debt" ? "Debía este mes (no corre la fecha)" : `Vence ${fdate(x.expiresAt)} → queda hasta ${fdate(x.to)}`}${x.blocked ? ` · ⛔ ${esc(x.blocked)}` : ""}</small></span><b>${bs(x.price)}</b></li>`;
  const m = modal(`💵 ${name}: me pagó todo`, `${d.rows.length ? `<ul class="rmglist">${d.rows.map(row).join("")}</ul>` : `<p class="muted" style="margin:0">No tiene nada vencido, por vencer en ${d.days} días ni sin pagar en el Control.</p>`}
    <p style="margin:0">Total: <b>${bs(d.total)}</b> · ${ok.length} alquiler(es)</p>
    ${d.fiadoOwed ? `<p class="muted" style="margin:0">Además debe ${bs(d.fiadoOwed)} en el Fiado: eso se anota en Fiado.</p>` : ""}
    <p class="bad rmerr" hidden></p>
    <div class="inline">${ok.length ? `<button class="pbtn green" type="button" data-rmpaidok="1">✅ Anotar los ${ok.length} · ${bs(d.total)}</button>` : ""}<button class="pbtn" type="button" data-rmclose="1">Cerrar</button></div>`);
  m.el.querySelector("[data-rmpaidok]")?.addEventListener("click", async (ev) => {
    if (!confirm(`¿${name} te pagó ${bs(d.total)} por ${ok.length} alquiler(es)? Se renuevan los que vencen y se marcan pagados.`)) return;
    ev.target.disabled = true;
    try {
      const r = await api("POST", `/api/admin/resellers/${id}/paid-all`, { ids: ok.map((x) => x.assignmentId), total: d.total, idempotencyKey: newKey() });
      m.close(); toast(`✅ ${name}: ${r.count} anotado(s) · ${bs(r.total)}`); await ctx.render();
    } catch (e) { ev.target.disabled = false; errBox(m.el, e.message); }
  });
}

/* ---------------- 7 · Renovar +1 masivo: confirmar el total ---------------- */
export function confirmBulkRenew(ids, rows) {
  const sel = (rows ?? []).filter((r) => ids.includes(r.id));
  const total = sel.reduce((t, r) => t + (r.price || 0), 0);
  const who = [...new Set(sel.map((r) => r.customerName))];
  return confirm(`¿Renovar +1 mes ${ids.length} alquiler(es)${who.length === 1 ? ` de ${who[0]}` : ""} y anotarlos como cobrados en efectivo?\nTotal: ${bs(total)}`);
}

/* ---------------- 11 · Independiente: renovar sus alquileres desde GaboHub ---------------- */
export const storeRenewBtn = (r, canReview) => (canReview && r.trust === "independent"
  ? `<button class="pbtn sm" type="button" data-rmstore="${esc(r.id)}" data-on="${r.storeRenew === false ? "1" : ""}" aria-pressed="${r.storeRenew !== false}">🔄 Renueva sus alquileres desde GaboHub: ${r.storeRenew === false ? "No" : "Sí"}</button>` : "");

/* ---------------- 4b · Vender: avisar si su lista no tiene precio ---------------- */
let sellTimer = 0;
function sellWarn() {
  clearTimeout(sellTimer);
  sellTimer = setTimeout(async () => {
    const f = document.getElementById("sellForm");
    if (!f) return;
    let w = document.getElementById("rmNoList");
    const tile = document.querySelector('.selp[aria-pressed="true"]');
    const cid = (ctx.custMap?.() ?? {})[f.customerName?.value.trim()] || "";
    if (!tile || !cid || !f.productId?.value) { if (w) w.hidden = true; return; }
    const q = await api("POST", "/api/admin/orders/quote", { customerId: cid, items: [{ productId: f.productId.value, qty: Math.max(1, +f.qty?.value || 1) }] }).catch(() => null);
    const miss = q?.missingListPrice ?? [];
    if (!w) { w = document.createElement("p"); w.id = "rmNoList"; w.className = "aibox aibox-warn"; w.setAttribute("role", "status"); (document.getElementById("sellSummary") ?? f).after(w); }
    w.hidden = !miss.length;
    if (miss.length) w.innerHTML = `<b>⚠️ Su lista «${esc(miss[0].list)}» no tiene precio para ${esc(miss[0].name)}</b><small>Se le cobraría el precio de la tienda (${bs(miss[0].price)}). Poné el precio en Precios o cambiale la lista antes de vender.</small>`;
  }, 300);
}
document.addEventListener("input", (ev) => { if (ev.target.form?.id === "sellForm") sellWarn(); });
document.addEventListener("change", (ev) => { if (ev.target.form?.id === "sellForm") sellWarn(); });
document.addEventListener("click", (ev) => { if (ev.target.closest?.("#sellForm .selp, .selp")) sellWarn(); });

/* ---------------- Clics ---------------- */
document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button[data-rmgok],button[data-rmpaid],button[data-rmstore]");
  if (!el) return;
  const d = el.dataset;
  el.disabled = true;
  try {
    if (d.rmgok !== undefined) { groupsCache = null; await approveGroup(+d.rmgok, el.closest(".rmgroup")); }
    if (d.rmpaid) await paidAll(d.rmpaid, d.name);
    if (d.rmstore) {
      await api("POST", `/api/admin/customers/${d.rmstore}/store-renew`, { allowed: d.on === "1" });
      toast(d.on === "1" ? "Ahora renueva sus alquileres desde GaboHub" : "Sus alquileres los renovás vos");
      await ctx.render();
    }
  } catch (e) {
    const box = el.closest(".rmgroup");
    if (box) errBox(box, e.message); else toast(e.message);
  } finally { if (el.isConnected) el.disabled = false; }
});
