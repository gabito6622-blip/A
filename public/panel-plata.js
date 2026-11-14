// La plata como la maneja un humano (15/11/2026, equipo 1): gastos con fecha, moneda y categoría (y editarlos en
// meses anteriores), «Me devolvió plata», gastos fijos con «Lo pagué», Proveedores por mes, corregir una venta y
// devolver en efectivo. El panel (panel.js) solo llama a estas vistas; los formularios y botones se manejan acá.
import { api, $, esc, bs, toCents, fdate } from "/common.js";
import { perfilMesLine } from "/panel-perfil.js";

const CATS = [["cuenta", "Cuenta"], ["perfil", "Perfil suelto"], ["publicidad", "Publicidad"], ["internet", "Internet"], ["comision", "Comisión"], ["otro", "Otro"]];
const CUR = [["BOB", "Bs"], ["USD", "US$"], ["USDT", "USDT"]];
const S = { edit: null };
const pad = (n) => String(n).padStart(2, "0");
/** «AAAA-MM-DD» de hoy (o de hace `add` días) en este aparato. */
export const dayIso = (add = 0) => { const d = new Date(); d.setDate(d.getDate() + add); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const isoOf = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const opt = (v, t, sel) => `<option value="${esc(v)}"${sel ? " selected" : ""}>${esc(t)}</option>`;
const ddmm = (t) => fdate(t).slice(0, 5);
const num = (v) => (v === undefined || v === null || v === "" ? "" : String(v).replace(".", ","));

/** Campos de un gasto (los mismos para anotar, editar y la devolución). */
function fields(g, x = {}, opts = {}) {
  const cur = x.currency ?? "BOB", usdLike = cur !== "BOB";
  const amount = x.id ? (usdLike ? x.usd : x.amount) / 100 : "";
  const date = x.at ? isoOf(x.at) : dayIso();
  return `<div class="plrow">
      <label class="plamt">Monto<input name="amount" inputmode="decimal" autocomplete="off" value="${esc(num(amount))}" placeholder="0" required aria-describedby="${opts.id}-err"></label>
      <label>Moneda<select name="currency">${CUR.map(([v, t]) => opt(v, t, v === cur)).join("")}</select></label>
      <label class="plrate"${usdLike ? "" : " hidden"}>Tasa (Bs por dólar)<input name="rate" inputmode="decimal" value="${esc(num(x.rate ?? g.rate ?? ""))}"></label>
    </div>
    <p class="plconv muted" aria-live="polite"></p>
    ${opts.noNote ? "" : `<label>¿En qué?<input name="note" maxlength="120" value="${esc(x.note ?? "")}" placeholder="${esc(opts.placeholder ?? "Ej: publicidad en Facebook")}"${opts.noteOptional ? "" : " required"}></label>`}
    <div class="plrow">
      ${opts.noCategory ? "" : `<label>Categoría<select name="category">${CATS.map(([v, t]) => opt(v, t, v === (x.category ?? (x.accountId ? "cuenta" : "otro")))).join("")}</select></label>`}
      <label>Proveedor <small class="muted">(opcional)</small><select name="supplierId">${opt("", "—", !x.supplierId)}${(g.suppliers ?? []).map((s) => opt(s.id, s.name, s.id === x.supplierId)).join("")}</select></label>
    </div>
    <div class="plrow pldate"><label>Fecha<input type="date" name="date" value="${esc(date)}" max="${esc(dayIso())}"></label>
      <button class="pbtn sm" type="button" data-plday="0">Hoy</button><button class="pbtn sm" type="button" data-plday="-1">Ayer</button></div>
    <p class="plerr" id="${opts.id}-err" role="alert" hidden></p>`;
}

/** Formulario de arriba de Finanzas: anotar un gasto y «Me devolvió plata». */
export function gastoFormCard(g) {
  return `<section class="card plcard" id="plGastos"><h2>🧾 Anotá un gasto</h2>
    <form class="plform" data-plform="gasto" novalidate autocomplete="off">${fields(g, {}, { id: "plg" })}
      <button class="pbtn blue" type="submit">Agregar gasto</button></form>
    <details class="pldev"><summary>💚 Me devolvió plata <small class="muted">(un proveedor)</small></summary>
      <p class="muted" style="margin:6px 0 10px">Si un proveedor te devuelve plata (se cayó un perfil, te cobró de más), anotalo acá: resta de los gastos del mes.</p>
      <form class="plform" data-plform="refund" novalidate autocomplete="off">${fields(g, {}, { id: "plr", noCategory: true, noteOptional: true, placeholder: "Ej: se cayó el perfil de Netflix" })}
        <button class="pbtn green" type="submit">Anotar devolución</button></form>
    </details></section>`;
}

/** Lista de gastos de un mes (con selector de mes), fijos pendientes con «Lo pagué» y gastos fijos. */
export function gastosListCard(g) {
  const pend = g.pendientesFijos ?? [];
  const rows = g.expenses.map((x) => {
    if (S.edit === x.id) return `<li class="plitem editing"><form class="plform" data-plform="edit" data-id="${esc(x.id)}" novalidate autocomplete="off">${fields(g, x, { id: `ple-${x.id}` })}
      <div class="inline"><button class="pbtn blue" type="submit">Guardar</button><button class="pbtn" type="button" data-pledit="">Cancelar</button></div></form></li>`;
    const usd = x.usd ? ` · ${x.currency === "USDT" ? "USDT" : "US$"} ${(x.usd / 100).toFixed(2).replace(".", ",")} × ${num(x.rate)}` : "";
    return `<li class="plitem${x.refund ? " refund" : ""}"><div class="plmain"><b>${esc(x.note)}</b>
        <small class="muted">${ddmm(x.at)} · ${x.refund ? "💚 Devolución" : esc(x.categoryLabel)}${x.supplierName ? ` · ${esc(x.supplierName)}` : ""}${usd}${x.months > 1 ? ` · cubre ${x.months} meses` : ""}</small></div>
      <b class="plamt num">${x.refund ? "− " : ""}${bs(x.amount)}</b>
      <div class="inline plact"><button class="pbtn sm" type="button" data-pledit="${esc(x.id)}" aria-label="Editar ${esc(x.note)}">Editar</button><button class="pbtn sm danger" type="button" data-rmexp="${esc(x.id)}" aria-label="Quitar ${esc(x.note)}">Quitar</button></div></li>`;
  }).join("");
  return `<section class="card plcard" id="plLista"><h2>Gastos de ${esc(g.label)}</h2>
    <div class="tabs ctl-chips" role="tablist" aria-label="Mes de los gastos">${g.months.slice(0, 6).map((m) => `<button type="button" role="tab" data-tab="gm:${esc(m.key)}" aria-selected="${m.key === g.month}">${esc(m.label.replace(/ \d{4}$/, ""))}</button>`).join("")}</div>
    ${pend.length ? `<div class="finwarn plpend"><b>Falta anotar:</b> ${pend.map((p) => `${esc(p.name)} ${bs(p.amount)}`).join(" · ")}
      <small class="muted">(ya lo restamos como estimado en «Te quedó»)</small>
      ${pend.map((p) => `<form class="plfix" data-plform="fixpay" data-id="${esc(p.fixedId)}" data-month="${esc(g.month)}" novalidate><label>${esc(p.name)}<input name="amount" inputmode="decimal" value="${esc(num(p.amount / 100))}" aria-label="Monto de ${esc(p.name)}"></label><button class="pbtn sm dark" type="submit">✅ Lo pagué</button><p class="plerr" role="alert" hidden></p></form>`).join("")}</div>` : ""}
    <div class="plsum"><span>Gastaste <b>${bs(g.gastado)}</b></span>${g.devuelto ? `<span class="plok">Te devolvieron <b>${bs(g.devuelto)}</b></span>` : ""}<span>Neto <b>${bs(g.neto)}</b></span></div>
    ${rows ? `<ul class="pllist">${rows}</ul>` : `<p class="muted">No hay gastos anotados en ${esc(g.label)}.</p>`}
    <details class="plfixed"><summary>📌 Gastos fijos de cada mes <small class="muted">(${(g.fixed ?? []).length})</small></summary>
      <p class="muted" style="margin:6px 0 10px">Internet, publicidad, lo que pagás todos los meses: definilo una vez y cada mes te avisa si falta anotarlo.</p>
      ${(g.fixed ?? []).length ? `<ul class="pllist">${g.fixed.map((f) => `<li class="plitem"><div class="plmain"><b>${esc(f.name)}</b><small class="muted">${esc(CATS.find((c) => c[0] === f.category)?.[1] ?? "Otro")} · cada mes</small></div><b class="plamt num">${bs(f.amount)}</b><div class="inline plact"><button class="pbtn sm danger" type="button" data-plfixrm="${esc(f.id)}" data-name="${esc(f.name)}">Quitar</button></div></li>`).join("")}</ul>` : ""}
      <form class="plform" data-plform="fixed" novalidate autocomplete="off"><div class="plrow">
        <label>Nombre<input name="name" maxlength="60" placeholder="Ej: Internet" required></label>
        <label class="plamt">Monto (Bs)<input name="amount" inputmode="decimal" placeholder="0" required></label>
        <label>Categoría<select name="category">${CATS.map(([v, t]) => opt(v, t, v === "internet")).join("")}</select></label></div>
        <p class="plerr" role="alert" hidden></p>
        <button class="pbtn dark" type="submit">➕ Agregar gasto fijo</button></form>
    </details></section>`;
}

/** «Proveedores» por mes: pagado, devuelto, estimado, lo que entró por sus cuentas y la ganancia. */
export function proveedoresMesCard(d) {
  if (!d) return "";
  const T = d.totals;
  return `<section class="card plcard"><h2>📦 Proveedores en ${esc(d.label)}</h2>
    <div class="tabs ctl-chips" role="tablist" aria-label="Mes de proveedores">${d.months.slice(0, 6).map((m) => `<button type="button" role="tab" data-tab="pm:${esc(m.key)}" aria-selected="${m.key === d.month}">${esc(m.label.replace(/ \d{4}$/, ""))}</button>`).join("")}</div>
    <p class="muted" style="margin:0 0 10px">Lo que le pagaste de verdad a cada uno, lo que te devolvió, lo que falta anotar (estimado) y lo que entró por los clientes que estaban en sus cuentas cuando pagaron.</p>
    <div class="plprov">${d.rows.map((r) => `<div class="plprow"><b>${esc(r.name)}</b>
      <span>Pagado <b>${bs(r.pagado)}</b></span>${r.devuelto ? `<span class="plok">Devolvió <b>${bs(r.devuelto)}</b></span>` : ""}${r.estimado ? `<span>Estimado <b>${bs(r.estimado)}</b></span>` : ""}
      <span>Entró <b>${bs(r.ingresos)}</b></span><span class="${r.ganancia < 0 ? "down" : "up"}">Ganancia <b>${bs(r.ganancia)}</b></span>${perfilMesLine(r.perfiles)}</div>`).join("")}</div>
    <p style="margin:10px 0 0"><b>Total: entró ${bs(T.ingresos)} · pagado ${bs(T.pagado)}${T.devuelto ? ` · devuelto ${bs(T.devuelto)}` : ""}${T.estimado ? ` · estimado ${bs(T.estimado)}` : ""} · ganancia ${bs(T.ganancia)}</b></p></section>`;
}

/**
 * Carga de cuentas, «Ya la pagué»: si vence con el proveedor en varios meses, pagaste esos meses. Muestra cuántos y el
 * total (editable: poné lo que pagaste de verdad). Se manda como `paidMonths` y `paidAmount`.
 */
export const paidNowExtra = () => `<div class="plpaid" hidden style="grid-column:1/-1"><input type="hidden" name="paidMonths" value="1">
  <label>¿Cuánto pagaste en total? <input name="paidAmount" inputmode="decimal" autocomplete="off"></label><small class="muted plpaidtxt" aria-live="polite"></small></div>`;
function paidNowSync(f) {
  const box = f.querySelector(".plpaid"); if (!box) return;
  box.hidden = !f.paidNow?.checked;
  if (box.hidden) return;
  const exp = f.exp?.value ? new Date(f.exp.value + "T23:59:00").getTime() : 0;
  const months = Math.min(12, Math.max(1, Math.round((exp - Date.now()) / (30 * 86400000)) || 1));
  const cost = toCents(f.cost?.value || 0) || 0;
  f.paidMonths.value = String(months);
  if (!f.paidAmount.dataset.touched) f.paidAmount.value = cost ? String((cost * months) / 100).replace(".", ",") : "";
  box.querySelector(".plpaidtxt").textContent = months > 1 ? `Vence en ${months} meses: si pagaste los ${months} juntos, ese pago los cubre (no se vuelven a estimar).` : "Un mes.";
}
/** Lo que se agrega al cargar la cuenta con «Ya la pagué». */
export const paidNowBody = (f) => (f.paidNow?.checked && f.paidMonths ? { paidMonths: +f.paidMonths.value || 1, ...(f.paidAmount?.value ? { paidAmount: toCents(f.paidAmount.value) } : {}) } : {});

/** Botón «➕ Gasto» del Inicio: lleva al formulario de arriba de Finanzas. */
export const gastoHomeBtn = () => `<button class="pbtn sm" type="button" data-plgo="1">➕ Gasto</button>`;

/** ¿Cambiaste el precio en el Control de algo vendido este mes? Ofrece corregir también la venta. */
export async function offerFixSale(assignmentId, price) {
  const r = await api("GET", `/api/admin/assignments/${encodeURIComponent(assignmentId)}/sale-to-fix`).catch(() => null);
  if (!r || r.suggested === r.total) return false;
  if (!confirm(`¿Corregir también la ${r.kind === "renewal" ? "renovación" : "venta"} del ${r.date}?\n\nSe anotó ${bs(r.total)}; con el precio nuevo serían ${bs(r.suggested)}${r.months > 1 ? ` (${r.months} meses)` : ""}. Finanzas va a usar el monto corregido y queda en la Auditoría.`)) return false;
  await api("POST", `/api/admin/orders/${encodeURIComponent(r.orderId)}/amend`, { total: r.suggested, reason: "Cambié el precio en el Control" });
  return true;
}

/* ---------------- eventos ---------------- */

function showErr(f, msg) { const p = f.querySelector(".plerr"); if (p) { p.textContent = msg; p.hidden = !msg; } if (msg) f.querySelector("[aria-invalid]")?.focus(); }
function money(f) {
  const cur = f.currency?.value ?? "BOB";
  const v = toCents(f.amount.value);
  if (!v || Number.isNaN(v) || v <= 0) { f.amount.setAttribute("aria-invalid", "true"); throw new Error("Poné un monto mayor a 0"); }
  f.amount.removeAttribute("aria-invalid");
  if (cur === "BOB") return { amount: v, currency: "BOB" };
  const rate = Number(String(f.rate.value).replace(",", "."));
  if (!(rate >= 1 && rate <= 100)) { f.rate.setAttribute("aria-invalid", "true"); throw new Error("Poné la tasa (Bs por dólar)"); }
  f.rate.removeAttribute("aria-invalid");
  return { amount: v, currency: cur, rate };
}
function conv(f) {
  const p = f.querySelector(".plconv"); if (!p || !f.currency) return;
  const rate = Number(String(f.rate?.value ?? "").replace(",", ".")), v = toCents(f.amount.value);
  p.textContent = f.currency.value !== "BOB" && rate > 0 && v > 0 ? `≈ ${bs(Math.round(v * rate))} a ${String(rate).replace(".", ",")}` : "";
}

/** Engancha los formularios y botones (una sola vez). `act` = la del panel (hace la llamada, avisa y redibuja). */
export function initPlata({ act, render, toast, go }) {
  document.addEventListener("change", (ev) => {
    const f = ev.target.form;
    if (!f?.dataset?.plform) return;
    if (ev.target.name === "currency") { const r = f.querySelector(".plrate"); if (r) r.hidden = ev.target.value === "BOB"; }
    conv(f);
  });
  document.addEventListener("input", (ev) => { const f = ev.target.form; if (f?.dataset?.plform) conv(f); if (ev.target.name === "paidAmount") ev.target.dataset.touched = "1"; else if (f?.querySelector?.(".plpaid")) paidNowSync(f); });
  document.addEventListener("change", (ev) => { const f = ev.target.form; if (f?.querySelector?.(".plpaid") && ev.target.name !== "paidAmount") paidNowSync(f); });
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-plday],[data-pledit],[data-plfixrm],[data-plgo]");
    if (!b) return;
    const d = b.dataset;
    if (d.plday !== undefined) { const f = b.closest("form"); if (f?.date) f.date.value = dayIso(Number(d.plday)); return; }
    if (d.pledit !== undefined) { S.edit = d.pledit || null; await render(); if (S.edit) document.querySelector(`[data-plform="edit"][data-id="${CSS.escape(S.edit)}"] [name="amount"]`)?.focus(); return; }
    if (d.plfixrm) { if (!confirm(`¿Quitar el gasto fijo «${d.name}»? Lo que ya anotaste queda.`)) return; return act(() => api("POST", `/api/admin/finance/fixed/${encodeURIComponent(d.plfixrm)}/remove`, {}), "Gasto fijo quitado"); }
    if (d.plgo) {
      go("finanzas");
      // Finanzas se dibuja después de traer los datos: se espera el formulario (hasta 5 s) y se enfoca el monto.
      for (let i = 0; i < 50; i++) { const f = $('[data-plform="gasto"]'); if (f) { f.scrollIntoView({ block: "start" }); f.amount.focus(); break; } await new Promise((r) => setTimeout(r, 100)); }
    }
  });
  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    const kind = f.dataset?.plform;
    if (!kind) return;
    ev.preventDefault();
    const btn = f.querySelector('[type="submit"]');
    try {
      showErr(f, "");
      let call, ok;
      if (kind === "gasto" || kind === "edit") {
        const note = f.note.value.trim();
        if (!note) { f.note.setAttribute("aria-invalid", "true"); throw new Error("Escribí en qué gastaste"); }
        const body = { ...money(f), note, category: f.category.value, supplierId: f.supplierId.value || null, date: f.date.value || undefined };
        call = () => api("POST", kind === "edit" ? `/api/admin/expenses/${encodeURIComponent(f.dataset.id)}` : "/api/admin/expenses", body);
        ok = (x) => `${kind === "edit" ? "Gasto corregido" : "Gasto anotado"}: ${bs(x.amount)} el ${ddmm(x.at)}`;
      } else if (kind === "refund") {
        const body = { ...money(f), note: f.note.value.trim() || undefined, supplierId: f.supplierId.value || undefined, at: f.date.value || undefined };
        call = () => api("POST", "/api/admin/finance/refunds", body);
        ok = (x) => `💚 Devolución anotada: ${bs(x.amount)} (resta de los gastos)`;
      } else if (kind === "fixed") {
        const name = f.name.value.trim();
        if (!name) throw new Error("Poné el nombre (ej.: Internet)");
        const amount = toCents(f.amount.value);
        if (!amount || amount <= 0) throw new Error("Poné un monto mayor a 0");
        call = () => api("POST", "/api/admin/finance/fixed", { name, amount, category: f.category.value });
        ok = (x) => `📌 «${x.name}» queda como gasto fijo`;
      } else if (kind === "fixpay") {
        const amount = toCents(f.amount.value);
        if (!amount || amount <= 0) throw new Error("Poné un monto mayor a 0");
        call = () => api("POST", `/api/admin/finance/fixed/${encodeURIComponent(f.dataset.id)}/pay`, { amount, month: f.dataset.month });
        ok = (x) => `✅ ${x.note} anotado: ${bs(x.amount)}`;
      } else return;
      if (btn) btn.disabled = true;
      // Se llama directo (no con act) para mostrar el error junto al formulario.
      const r = await call();
      if (kind === "edit") S.edit = null;
      toast(ok(r));
      await render();
    } catch (e) {
      if (e.status === 401) return act(() => Promise.reject(e));
      showErr(f, e.message);
      if (btn) btn.disabled = false;
    }
  });
}
