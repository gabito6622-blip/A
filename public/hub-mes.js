// GaboHub del revendedor: un mes entero sin perder cuentas ni plata (revisión de 3 meses, 14/11/2026).
//  - Cartel «Tu Disney de la tienda vence el dd/mm y se corta el dd/mm» (3 días antes), con el botón para renovar.
//  - «🔄 Renovar varias juntas»: elegís tus cuentas, ves el total y pagás con tu saldo o con UN solo QR.
//  - «Mis ganancias»: tu ganancia real con lo que te cuestan tus alquileres de la tienda.
// Todo pasa por el servidor (que decide el precio y que sean tuyas). Antes de descontar o crear el pedido, se confirma el total.
// R2 (14/11): el QR y «Enviar comprobante» aparecen en el MISMO lugar que el cartel (Inicio o Mis cuentas) y salen del
// servidor (sus renovaciones por QR esperando pago, con producto y correo), así no se pierden al recargar; el cartel dice
// cuál queda afuera de «Renovar las N» y por qué (con «📩 Pedir renovación»), y «✂️ Hoy se corta» el día del corte.
import { api, esc, bs, fdate, toast, fileToBase64, newKey } from "/common.js";

const M = { alerts: null, sel: new Set(), busy: false };
let ctx = { refresh: async () => {}, setView: () => {}, me: () => null, settings: () => ({}) };

/** shop.js le pasa cómo volver a dibujar y quién está logueado. */
export function hubMesInit(c) { ctx = { ...ctx, ...c }; }

/** Sus alquileres con la tienda que vencen en 3 días o menos (el servidor decide qué es suyo). */
export async function loadRentAlerts() {
  M.alerts = await api("GET", "/api/me/store-rentals").catch(() => null);
}

/** Qué pasa con una cuenta del cartel que no entra en «Renovar las N» (y el botón para pedirla, si hace falta). */
function lineState(x) {
  if (x.inReview) return " · 🔍 tu pago se está revisando: no se corta mientras tanto";
  if (x.pendingOrderId) return " · 📲 esperando tu pago por QR (abajo)";
  if (x.why === "supplier") return x.request ? " · ✓ pediste la renovación: no se corta mientras la tienda la renueva"
    : ` · queda afuera: para renovarla, la tienda primero renueva con su proveedor <button class="sbtn sm" type="button" data-rrqask="${esc(x.assignmentId)}" data-what="${esc(x.product)}" data-amount="${x.price}">📩 Pedir renovación · ${bs(x.price)}</button>`;
  if (x.why === "store") return " · queda afuera: esta la renueva la tienda, escribile antes del corte";
  return "";
}

/** Cartel arriba de Inicio y de Mis cuentas, con el QR de lo que espera pago. Sin nada por vencer ni pagar, no ocupa lugar. */
export function rentAlertBanner() {
  const l = M.alerts?.list ?? [];
  const qr = qrBox();
  if (!l.length) return qr;
  const can = l.filter((x) => x.canRenew && !x.inReview);
  const out = l.filter((x) => !x.canRenew && !x.inReview && !x.pendingOrderId);
  const bad = l.some((x) => x.daysLeft <= 0);
  const today = l.filter((x) => x.cutDaysLeft === 0 && !x.held && !x.inReview);
  const head = today.length ? `✂️ ${today.length === 1 ? `Hoy se corta tu ${esc(today[0].product)}` : `Hoy se cortan ${today.length} cuentas tuyas de la tienda`}`
    : `⏰ ${l.length === 1 ? "Tu cuenta de la tienda se corta pronto" : `${l.length} cuentas tuyas de la tienda se cortan pronto`}`;
  return `<div class="hbox ${bad ? "bad" : "warn"} rmalert" role="status"><b>${head}</b>
    ${l.map((x) => `<span class="rmline">${esc(x.text)}${lineState(x)}</span>`).join("")}
    ${can.length ? `<div class="hrow"><button class="sbtn sm pri" type="button" data-rmalert="1">🔄 Renovar ${can.length === 1 ? "" : `las ${can.length} `}· ${bs(M.alerts.total)}</button><small class="empty">${out.length ? `Queda afuera: ${out.map((x) => esc(x.product)).join(", ")} (mirá por qué arriba).` : "Así tus clientes no se quedan sin servicio."}</small></div>` : ""}</div>${qr}`;
}

/** Sus propias cuentas que se pueden renovar desde acá (no las de sus clientes, ni las que ya esperan un pago por QR). */
const waiting = () => new Set((M.alerts?.pending ?? []).map((o) => o.assignmentId));
const mine = (services) => (services ?? []).filter((a) => a.customerId === ctx.me()?.id && a.canRenew !== false && a.renewableNow !== false && !a.viaReseller && !waiting().has(a.assignmentId));

/** «🔄 Renovar varias juntas»: casillas, total y los dos botones (saldo o un solo QR). */
export function renewManyBox(services) {
  const list = mine(services);
  if (list.length < 2) return "";
  for (const id of [...M.sel]) if (!list.some((a) => a.assignmentId === id)) M.sel.delete(id);
  const chosen = list.filter((a) => M.sel.has(a.assignmentId));
  const total = chosen.reduce((t, a) => t + (a.renewPrice ?? 0), 0);
  const bal = ctx.me()?.balance ?? 0;
  return `<details class="sbox rmbox" ${M.sel.size ? "open" : ""}><summary><b>🔄 Renovar varias juntas</b> <small class="empty">elegís, ves el total y pagás una sola vez</small></summary>
    <div class="rmlist">${list.map((a) => `<label class="rmrow"><input type="checkbox" data-rmsel="${esc(a.assignmentId)}" ${M.sel.has(a.assignmentId) ? "checked" : ""}><span><b>${esc(a.product.replace(/ \(alquiler revendedores\)/, ""))}</b><small class="empty">${esc(a.access?.email ?? "")} · vence ${fdate(a.expiresAt)}</small></span><b>${bs(a.renewPrice ?? 0)}</b></label>`).join("")}</div>
    <div class="hrow"><button class="sbtn sm" type="button" data-rmall="1">${chosen.length === list.length ? "Quitar todas" : `Elegir las ${list.length}`}</button><span class="rmtot">Total: <b>${bs(total)}</b> · ${chosen.length} cuenta(s)</span></div>
    <div class="hrow"><button class="sbtn pri" type="button" data-rmpay="balance" ${chosen.length ? "" : "disabled"}>💰 Con mi saldo · ${bs(total)}</button><button class="sbtn" type="button" data-rmpay="qr" ${chosen.length ? "" : "disabled"}>📲 Con un QR · ${bs(total)}</button></div>
    <small class="empty">Tu saldo: ${bs(bal)}${chosen.length && total > bal ? " · no alcanza: recargá o pagá con QR" : ""}</small></details>`;
}

/** Ids de las renovaciones que ya muestra el cuadro del QR (shop.js no repite sus tarjetas sueltas). */
export const qrBoxIds = () => new Set((M.alerts?.pending ?? []).map((o) => o.id));

/** «📲 Pagá Bs X con un solo QR»: sus renovaciones por QR que esperan el comprobante (del servidor), cada una con su correo. */
function qrBox() {
  const q = M.alerts?.pending ?? [], st = ctx.settings();
  if (!q.length) return "";
  const total = q.reduce((t, o) => t + o.total, 0);
  return `<div class="sbox rmbox rmqr" id="rmqr"><h3 style="margin:0">📲 Pagá ${bs(total)} ${q.length === 1 ? "con QR" : "con un solo QR"}</h3>
    <p class="empty" style="margin:0">${q.length === 1 ? "Renovás esta cuenta" : `Renovás ${q.length} cuentas juntas`}. Pagá el total exacto y subí UN comprobante. Si no llega en 3 días, el pedido se cancela solo.</p>
    <ul class="rmqrlist">${q.map((o) => `<li><span><b>${esc(o.product)}</b><small>${esc(o.email)}${o.customerName ? ` · ${esc(o.customerName)}` : ""}</small></span><b>${bs(o.total)}</b><button class="sbtn sm" type="button" data-cancel="${esc(o.id)}" aria-label="Cancelar la renovación de ${esc(o.product)}">Cancelar</button></li>`).join("")}</ul>
    ${st.hasQr ? `<img class="rmqrimg" src="/api/settings/qr" alt="QR de cobro de la tienda">` : `<p class="empty" style="margin:0">La tienda todavía no cargó su QR: pedíselo por WhatsApp.</p>`}
    <label>Comprobante (foto o PDF)<input type="file" id="rmFile" accept="image/*,application/pdf"></label>
    <label>Número de operación<input id="rmRef" maxlength="60" inputmode="numeric" placeholder="Ej.: 123456789"></label>
    <p class="err" id="rmErr" hidden></p>
    <div class="hrow"><button class="sbtn pri" type="button" data-rmsend="1">Enviar comprobante · ${bs(total)}</button></div></div>`;
}

/** «Mis ganancias»: cobra − lo que le cuesta (incluye sus alquileres con la tienda). */
export function earnRealBox(g) {
  if (!g?.real || !g.rentals || (!g.rentals.cost && !g.rentals.revenue)) return "";
  const r = g.real, x = g.rentals;
  return `<div class="sbox rmreal"><h3 style="margin:0">💡 Tu ganancia real este mes</h3>
    <div class="rkpis"><div><small>Cobrás</small><b>${bs(r.revenue)}</b><small>ventas ${bs(g.month.revenue)} + perfiles ${bs(x.revenue)}</small></div><div><small>Te cuesta</small><b>${bs(r.cost)}</b><small>ventas ${bs(g.month.cost)} + tus alquileres ${bs(x.cost)}</small></div><div><small>Ganancia real</small><b class="${r.profit < 0 ? "bad" : "ok"}">${bs(r.profit)}</b></div></div>
    ${r.profit < 0 ? `<p class="empty" style="margin:0">⚠️ Este mes todavía no cubrís lo que te cuestan tus cuentas de la tienda: anotá todos los perfiles que repartiste o revisá tus precios.</p>` : ""}
    ${x.owed ? `<p class="empty" style="margin:0">Te deben ${bs(x.owed)} de perfiles: cuando te paguen, ganás eso.</p>` : ""}</div>`;
}

async function pay(method, ids) {
  let pv = await api("POST", "/api/me/renew-many/preview", { ids });
  // R2: una que ya espera un pago por QR no se renueva dos veces. Con saldo: «¿lo cancelo y pago con saldo?».
  const waitingQr = pv.rows.filter((r) => r.pendingOrderId && r.pendingStatus === "awaiting_payment");
  if (waitingQr.length && method === "balance") {
    if (!confirm(`Ya tenés un pedido por QR esperando pago para ${waitingQr.map((r) => r.product).join(", ")}. ¿Lo cancelo y pago con saldo?`)) return;
    for (const r of waitingQr) await api("POST", `/api/orders/${encodeURIComponent(r.pendingOrderId)}/cancel`, {});
    pv = await api("POST", "/api/me/renew-many/preview", { ids });
  } else if (waitingQr.length) {
    ids = ids.filter((id) => !waitingQr.some((r) => r.assignmentId === id));
    if (!ids.length) { toast("Ya están esperando tu pago: pagá el QR y subí el comprobante"); return document.getElementById("rmqr")?.scrollIntoView({ block: "center" }); }
    pv = await api("POST", "/api/me/renew-many/preview", { ids });
  }
  const bad = pv.rows.find((r) => !r.ok);
  if (bad) return toast(`${bad.product}: ${bad.why}`);
  const n = pv.rows.length;
  if (method === "balance") {
    if (pv.total > pv.balance) { toast(`Te falta saldo: necesitás ${bs(pv.total)} y tenés ${bs(pv.balance)}`); return ctx.setView("recargas"); }
    if (!confirm(`¿Renovar ${n === 1 ? pv.rows[0].product : `${n} cuentas`} por ${bs(pv.total)} con tu saldo?\nTe quedan ${bs(pv.balance - pv.total)}.`)) return;
  } else if (!confirm(`¿Renovar ${n === 1 ? pv.rows[0].product : `${n} cuentas`} y pagar ${bs(pv.total)} con UN solo QR?`)) return;
  const r = await api("POST", "/api/me/renew-many", { ids, paymentMethod: method, idempotencyKey: newKey() });
  M.sel.clear();
  if (method === "qr") toast("Pedido creado: pagá el QR y subí el comprobante acá mismo");
  else toast(`🔄 ¡Listo! ${r.count} cuenta(s) renovada(s) por ${bs(r.total)}`);
  await loadRentAlerts();
  await ctx.refresh();
  // El QR y «Enviar comprobante» quedan en el mismo lugar del cartel: se lleva la vista ahí.
  if (method === "qr") document.getElementById("rmqr")?.scrollIntoView({ block: "start" });
}

document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t?.dataset?.rmsel === undefined) return;
  if (t.checked) M.sel.add(t.dataset.rmsel); else M.sel.delete(t.dataset.rmsel);
  ctx.render?.();
});

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button[data-rmall],button[data-rmpay],button[data-rmalert],button[data-rmsend]");
  if (!el || M.busy) return;
  const d = el.dataset;
  if (d.rmall) {
    const list = mine(ctx.services());
    if (list.every((a) => M.sel.has(a.assignmentId))) M.sel.clear(); else list.forEach((a) => M.sel.add(a.assignmentId));
    return ctx.render?.();
  }
  M.busy = true; el.disabled = true;
  try {
    if (d.rmpay) await pay(d.rmpay, [...M.sel]);
    if (d.rmalert) {
      const ids = (M.alerts?.list ?? []).filter((x) => x.canRenew && !x.inReview).map((x) => x.assignmentId);
      const bal = ctx.me()?.balance ?? 0;
      await pay(M.alerts.total <= bal ? "balance" : "qr", ids);
    }
    if (d.rmsend) {
      const f = document.getElementById("rmFile")?.files?.[0], ref = document.getElementById("rmRef")?.value.trim(), errEl = document.getElementById("rmErr");
      const fail = (m) => { if (errEl) { errEl.textContent = m; errEl.hidden = false; } };
      if (!f) return fail("Elegí la foto o el PDF del comprobante");
      if (!ref) return fail("Escribí el número de operación");
      await api("POST", "/api/me/renew-many/evidence", { orderIds: (M.alerts?.pending ?? []).map((o) => o.id), contentBase64: await fileToBase64(f), declaredReference: ref });
      toast("🔍 Comprobante enviado: lo revisamos y se renuevan todas juntas");
      await loadRentAlerts();
      await ctx.refresh();
    }
  } catch (e) {
    if (e.code === "INSUFFICIENT_BALANCE") { toast(e.message); ctx.setView("recargas"); }
    else toast(e.message);
  } finally { M.busy = false; if (el.isConnected) el.disabled = false; }
});
