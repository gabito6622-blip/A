// Día a día del dueño en el panel (14/11/2026). Piezas chicas que usan Mi secretaria, Inicio, el Control y Vender:
//   - «se corta solo el dd/mm» en lo que está por cortarse;
//   - «Me pagó» de lo que ya se cortó solo (reactivar, con otro perfil si el suyo ya no está libre);
//   - «💳 Renovar proveedor y anotar» cuando «Me pagó» choca con la fecha del proveedor;
//   - «Renovar · dd/mm» del Control sin prometer una fecha que el proveedor no da;
//   - «Cambiar de cuenta»: primero los perfiles libres, después los apartados (con confirmación);
//   - Vender: crear el cliente ahí mismo si lo que escribiste no es un cliente.
// Nada se manda solo: los botones guardan en el panel y, a lo sumo, abren un WhatsApp que manda el dueño.
import { api, esc, bs, fdate, toast, toCents, newKey } from "/common.js";

const DAY = 86_400_000;
export const dm = (t) => new Date(t).toLocaleDateString("es-BO", { day: "2-digit", month: "2-digit" });
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
    <div class="inline sec-pvact">${pv.ok ? `<label class="sec-price">Cobré (Bs)<input name="price" inputmode="decimal" value="${(pv.price / 100).toFixed(2)}"></label>
      <button type="button" class="pbtn green" data-secreactok="${esc(pv.assignmentId)}" data-key="${esc(key)}">✅ Confirmar: me pagó</button>` : ""}<button type="button" class="pbtn" data-secpayno="1">Cancelar</button></div></div>`;
}

/* ---------------- Control: «Renovar · dd/mm» sin prometer de más ---------------- */
/**
 * Lo que muestra el botón «Renovar» del Control. Si la fecha nueva pasa la del proveedor, el botón no la promete y el
 * motivo se ve antes de tocar. La confirmación dice el monto.
 */
export function controlRenew(r, moneyTxt, now = Date.now()) {
  const days = r.durationDays ?? 30;
  const next = Math.max(r.customerExpiresAt, now) + days * DAY;
  const ok = !(r.supplierExpiresAt && next > r.supplierExpiresAt);
  const who = `${r.customerName || "este cliente"} (${r.email}${r.profile && !/completa/i.test(r.profile) ? ` · ${r.profile}` : ""})`;
  return {
    ok, next,
    label: ok ? `✅ Renovar · ${dm(next)}` : "✅ Renovar · ⚠️ ver proveedor",
    warn: ok ? "" : `⚠️ La cuenta vence con el proveedor el ${dm(r.supplierExpiresAt)}: +${days} días llegaría al ${dm(next)}. Renová la cuenta con el proveedor o cambiala de cuenta.`,
    confirm: ok
      ? `¿Renovar a ${who}?\n\n💵 Cobrás: ${moneyTxt} (efectivo/QR)\n📅 Vence: ${fdate(r.customerExpiresAt)} → ${fdate(next)} (+${days} días)`
      : `⚠️ No se puede prometer la fecha: la cuenta vence con el proveedor el ${fdate(r.supplierExpiresAt)} y +${days} días llegaría al ${fdate(next)}.\n\n💵 Monto: ${moneyTxt}\n\nEl sistema lo va a frenar: renová primero con el proveedor (Cuentas → «Pagué la renovación») o cambialo de cuenta. ¿Intentar igual?`,
  };
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
/** Muestra «➕ Crear "<nombre>"» si lo escrito no es un cliente de la lista. */
export function sellNewHint(form) {
  const box = form?.querySelector("#sellNew");
  if (!box || !sellCfg) return;
  const v = form.customerName.value.trim();
  const map = sellCfg.getMap() ?? {};
  const known = !!map[v] || Object.keys(map).some((k) => k.toLowerCase() === v.toLowerCase());
  if (v.length < 2 || known) { box.hidden = true; box.innerHTML = ""; return; }
  const digits = v.replace(/\D/g, "");
  const isPhone = digits.length >= 7 && !/[a-záéíóúñ]{2,}/i.test(v);
  const name = isPhone ? "" : v, phone = isPhone ? v : "";
  // No se redibuja mientras escribe en los campos de adentro.
  if (box.contains(document.activeElement)) return;
  box.hidden = false;
  box.innerHTML = `<small class="muted">«${esc(v)}» no está en tus clientes. Crealo acá y seguí con la venta:</small>
    <label>Nombre<input name="newName" value="${esc(name)}" autocomplete="off" maxlength="80" placeholder="Nombre del cliente"></label>
    <label>WhatsApp<input name="newPhone" value="${esc(phone)}" inputmode="tel" autocomplete="off" maxlength="20" placeholder="Ej.: 70012345"></label>
    <small class="sellnew-err bad" role="alert" hidden></small>
    <button type="button" class="pbtn dark" data-sellnew="1">➕ Crear "${esc(name || v)}"</button>`;
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
    const b = ev.target.closest("[data-secsup],[data-secsupok],[data-secsupno],[data-secreact],[data-secreactok],[data-sellnew]");
    if (!b) return;
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
      } catch (e) { fail(e.message); b.disabled = false; }
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
      b.disabled = true;
      try {
        const r = await api("POST", `/api/admin/assignments/${b.dataset.secsupok}/pay-with-supplier`, { months: +b.dataset.months, price, idempotencyKey: b.dataset.key });
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
