// GaboHub del revendedor: un mes entero sin perder cuentas ni plata (revisión de 3 meses, 14/11/2026).
//  - Cartel «Tu Disney de la tienda vence el dd/mm y se corta el dd/mm» (3 días antes), con el botón para renovar.
//  - «🔄 Renovar varias juntas»: elegís tus cuentas, ves el total y pagás con tu saldo o con UN solo QR.
//  - «Mis ganancias»: tu ganancia real con lo que te cuestan tus alquileres de la tienda.
// Todo pasa por el servidor (que decide el precio y que sean tuyas). Antes de descontar o crear el pedido, se confirma el total.
import { api, esc, bs, fdate, toast, fileToBase64, newKey } from "/common.js";

const M = { alerts: null, sel: new Set(), qr: null, busy: false };
let ctx = { refresh: async () => {}, setView: () => {}, me: () => null, settings: () => ({}) };

/** shop.js le pasa cómo volver a dibujar y quién está logueado. */
export function hubMesInit(c) { ctx = { ...ctx, ...c }; }

/** Sus alquileres con la tienda que vencen en 3 días o menos (el servidor decide qué es suyo). */
export async function loadRentAlerts() {
  M.alerts = await api("GET", "/api/me/store-rentals").catch(() => null);
}

/** Cartel arriba de Inicio y de Mis cuentas. Sin nada por vencer, no ocupa lugar. */
export function rentAlertBanner() {
  const l = M.alerts?.list ?? [];
  if (!l.length) return "";
  const can = l.filter((x) => x.canRenew && !x.inReview);
  const bad = l.some((x) => x.daysLeft <= 0);
  return `<div class="hbox ${bad ? "bad" : "warn"} rmalert" role="status"><b>⏰ ${l.length === 1 ? "Tu cuenta de la tienda se corta pronto" : `${l.length} cuentas tuyas de la tienda se cortan pronto`}</b>
    ${l.map((x) => `<span class="rmline">${esc(x.text)}${x.inReview ? " · 🔍 tu pago se está revisando: no se corta mientras tanto" : ""}</span>`).join("")}
    ${can.length ? `<div class="hrow"><button class="sbtn sm pri" type="button" data-rmalert="1">🔄 Renovar ${can.length === 1 ? "" : `las ${can.length} `}· ${bs(M.alerts.total)}</button><small class="empty">Así tus clientes no se quedan sin servicio.</small></div>`
      : l.some((x) => !x.canRenew && !x.inReview) ? `<small class="empty">Esta la renueva la tienda: escribile antes del corte.</small>` : ""}</div>`;
}

/** Sus propias cuentas que se pueden renovar desde acá (no las de sus clientes). */
const mine = (services) => (services ?? []).filter((a) => a.customerId === ctx.me()?.id && a.canRenew !== false && a.renewableNow !== false && !a.viaReseller);

/** «🔄 Renovar varias juntas»: casillas, total y los dos botones (saldo o un solo QR). */
export function renewManyBox(services) {
  const list = mine(services);
  if (M.qr) return qrBox();
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

function qrBox() {
  const q = M.qr, st = ctx.settings();
  return `<div class="sbox rmbox rmqr"><h3 style="margin:0">📲 Pagá ${bs(q.total)} con un solo QR</h3>
    <p class="empty" style="margin:0">Renovás ${q.orders.length} cuentas: ${q.orders.map((o) => esc(o.product)).join(", ")}. Pagá el total exacto y subí UN comprobante.</p>
    ${st.hasQr ? `<img class="rmqrimg" src="/api/settings/qr" alt="QR de cobro de la tienda">` : `<p class="empty" style="margin:0">La tienda todavía no cargó su QR: pedíselo por WhatsApp.</p>`}
    <label>Comprobante (foto o PDF)<input type="file" id="rmFile" accept="image/*,application/pdf"></label>
    <label>Número de operación<input id="rmRef" maxlength="60" inputmode="numeric" placeholder="Ej.: 123456789"></label>
    <p class="err" id="rmErr" hidden></p>
    <div class="hrow"><button class="sbtn pri" type="button" data-rmsend="1">Enviar comprobante</button><button class="sbtn" type="button" data-rmlater="1">Lo mando después</button></div></div>`;
}

/** «Mis ganancias»: tu ganancia real (14/11: con lo que de verdad te pagaron y el mensaje según lo que te deben; cuaderno.js). */
export { gananciaRealBox as earnRealBox } from "/cuaderno.js";

async function pay(method, ids) {
  const pv = await api("POST", "/api/me/renew-many/preview", { ids });
  const bad = pv.rows.find((r) => !r.ok);
  if (bad) return toast(`${bad.product}: ${bad.why}`);
  const n = pv.rows.length;
  if (method === "balance") {
    if (pv.total > pv.balance) { toast(`Te falta saldo: necesitás ${bs(pv.total)} y tenés ${bs(pv.balance)}`); return ctx.setView("recargas"); }
    if (!confirm(`¿Renovar ${n === 1 ? pv.rows[0].product : `${n} cuentas`} por ${bs(pv.total)} con tu saldo?\nTe quedan ${bs(pv.balance - pv.total)}.`)) return;
  } else if (!confirm(`¿Renovar ${n === 1 ? pv.rows[0].product : `${n} cuentas`} y pagar ${bs(pv.total)} con UN solo QR?`)) return;
  const r = await api("POST", "/api/me/renew-many", { ids, paymentMethod: method, idempotencyKey: newKey() });
  M.sel.clear();
  if (method === "qr") { M.qr = r; toast("Pedido creado: pagá el QR y subí el comprobante"); }
  else toast(`🔄 ¡Listo! ${r.count} cuenta(s) renovada(s) por ${bs(r.total)}`);
  await loadRentAlerts();
  await ctx.refresh();
}

document.addEventListener("change", (ev) => {
  const t = ev.target;
  if (t?.dataset?.rmsel === undefined) return;
  if (t.checked) M.sel.add(t.dataset.rmsel); else M.sel.delete(t.dataset.rmsel);
  ctx.render?.();
});

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button[data-rmall],button[data-rmpay],button[data-rmalert],button[data-rmsend],button[data-rmlater]");
  if (!el || M.busy) return;
  const d = el.dataset;
  if (d.rmall) {
    const list = mine(ctx.services());
    if (list.every((a) => M.sel.has(a.assignmentId))) M.sel.clear(); else list.forEach((a) => M.sel.add(a.assignmentId));
    return ctx.render?.();
  }
  if (d.rmlater) { M.qr = null; toast("Queda esperando el comprobante en «Mis cuentas y pedidos»"); return ctx.render?.(); }
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
      await api("POST", "/api/me/renew-many/evidence", { orderIds: M.qr.orders.map((o) => o.id), contentBase64: await fileToBase64(f), declaredReference: ref });
      M.qr = null;
      toast("🔍 Comprobante enviado: lo revisamos y se renuevan todas juntas");
      await loadRentAlerts();
      await ctx.refresh();
    }
  } catch (e) {
    if (e.code === "INSUFFICIENT_BALANCE") { toast(e.message); ctx.setView("recargas"); }
    else toast(e.message);
  } finally { M.busy = false; if (el.isConnected) el.disabled = false; }
});
