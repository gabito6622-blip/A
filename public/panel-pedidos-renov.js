// Mi secretaria · «📩 Pedidos de renovación» (R2 · revisión de 3 meses, 14/11/2026). Un revendedor (o cliente) quiso
// renovar y la cuenta vence antes con el proveedor: su pedido queda acá con el monto y no se le corta mientras tanto.
// «💳 Renovar proveedor y anotar» anota «Pagué la renovación» de la cuenta y cobra la renovación a quien la pidió (con su
// saldo si le alcanza; si no, le queda un QR para pagar). «No la renuevo» la cierra con un motivo que él ve.
// Nada se manda solo: el servidor guarda, y al revendedor le llega el aviso al celular si lo tiene prendido.
import { api, esc, bs, fdate, toast, newKey } from "/common.js";

const dm = (t) => new Date(t).toLocaleDateString("en-GB", { day: "2-digit", month: "2-digit" });
const reload = () => document.querySelector('[data-go="secretaria"]')?.click();

/** La sección (arriba de todo si hay alguno abierto: si no la renovás, el revendedor se queda sin servicio). */
export function pedidosRenovSection(list) {
  const open = (list ?? []).filter((r) => r.status === "open");
  if (!open.length) return "";
  const li = (r) => `<li data-rrqitem="${esc(r.id)}"><span class="sec-mail">${esc(r.payerName)}${r.payerId !== undefined && r.customerName && r.customerName !== r.payerName ? ` <small class="muted">· para ${esc(r.customerName)}</small>` : ""}</span>
    <span class="sec-meta">${esc(r.product)} · <span class="sec-mail">${esc(r.email)}</span> · vence ${dm(r.expiresAt)} · <b>${bs(r.amount)}</b></span>
    <span class="sec-meta">Proveedor: vence ${dm(r.supplierExpiresAt)}${r.supplier ? ` · hay que pagarle ${r.supplier.months === 1 ? "1 mes" : `${r.supplier.months} meses`} (${bs(r.supplier.amount)}) hasta el ${dm(r.supplier.to)}` : " · ya alcanza"}</span>
    <span class="sec-meta">${r.enough ? `Se cobra de su saldo (tiene ${bs(r.balance)})` : `Su saldo no alcanza (${bs(r.balance)}): le queda un QR para pagar`} · <span class="sec-cut">no se corta hasta el ${dm(r.holdUntil ?? r.expiresAt)}</span> · pedido el ${dm(r.createdAt)}</span>
    <span class="sec-paybtns"><button type="button" class="pbtn sm green sec-pay" data-rrqok="${esc(r.id)}" data-key="${esc(newKey())}" data-what="${esc(`${r.product} de ${r.payerName}`)}" data-sup="${r.supplier ? esc(`${bs(r.supplier.amount)} al proveedor (${r.supplier.months} mes${r.supplier.months === 1 ? "" : "es"})`) : ""}" data-amount="${r.amount}" data-enough="${r.enough ? 1 : 0}">💳 Renovar proveedor y anotar</button><button type="button" class="pbtn sm sec-pay" data-rrqno="${esc(r.id)}">No la renuevo</button></span>
    <form class="sec-rrqno" data-rrqnoform="${esc(r.id)}" hidden><label>¿Por qué? (lo ve ${esc(r.payerName.split(" ")[0])})<input name="reason" maxlength="200" required placeholder="Ej.: ese proveedor ya no vende HBO"></label><p class="err" hidden></p><button type="submit" class="pbtn sm">Avisarle y cerrar</button></form></li>`;
  return `<section class="card sec-card" id="sec-pedidos"><h2>📩 Pedidos de renovación <span class="sec-n">${open.length}</span></h2>
    <p class="muted" style="margin:0">Quisieron renovar, pero la cuenta vence antes con el proveedor. No se les corta mientras el pedido está abierto (como mucho 5 días después del corte).</p>
    <ul class="sec-items">${open.map(li).join("")}</ul></section>`;
}

if (typeof document !== "undefined") {
  document.addEventListener("click", async (ev) => {
    const ok = ev.target.closest?.("button[data-rrqok]"), no = ev.target.closest?.("button[data-rrqno]");
    if (no) { const f = document.querySelector(`form[data-rrqnoform="${CSS.escape(no.dataset.rrqno)}"]`); if (f) { f.hidden = !f.hidden; f.querySelector("input")?.focus(); } return; }
    if (!ok) return;
    const d = ok.dataset;
    if (!confirm(`¿Renovar ${d.what}?\n${d.sup ? `Se anota que pagaste ${d.sup} y ` : ""}se le cobran ${bs(Number(d.amount))}${d.enough === "1" ? " de su saldo" : " con un QR (su saldo no alcanza)"}.`)) return;
    ok.disabled = true;
    try {
      const r = await api("POST", `/api/admin/renew-requests/${encodeURIComponent(d.rrqok)}/resolve`, { idempotencyKey: d.key });
      toast(r.method === "balance" ? `✅ Renovada hasta el ${fdate(r.expiresAt)} (de su saldo)` : `✅ Proveedor renovado. ${r.payerName.split(" ")[0]} tiene que pagar ${bs(r.total)} con QR`);
      reload();
    } catch (e) { ok.disabled = false; toast(e.message); }
  });
  document.addEventListener("submit", async (ev) => {
    const f = ev.target.closest?.("form[data-rrqnoform]");
    if (!f) return;
    ev.preventDefault();
    const err = f.querySelector(".err"), reason = f.reason.value.trim();
    if (!reason) { err.textContent = "Escribí por qué"; err.hidden = false; return; }
    try { await api("POST", `/api/admin/renew-requests/${encodeURIComponent(f.dataset.rrqnoform)}/reject`, { reason }); toast("Listo: le avisamos en GaboHub"); reload(); }
    catch (e) { err.textContent = e.message; err.hidden = false; }
  });
}
