// La plata del cuaderno en GaboHub (revisión de 3 meses del revendedor de confianza, 14/11/2026).
//  - «Me pagó» de un toque cuando te pagó justo lo que debe (con «Deshacer» unos minutos); «✏️ Otro monto» para un pago
//    parcial o distinto: la casilla es CUÁNTO te pagó, y lo que falta queda como deuda (el precio no cambia).
//  - Lo que debe cada perfil, período por período («debe 2 meses, desde el 31/08»).
//  - Nombres parecidos: al lado del nombre, los últimos 3 números de su WhatsApp («Juan Pérez ·…123»).
//  - Cuenta cortada: «Se cortó tu HBO: tus 2 clientes (Nina, Óscar)» y «Pasar a mi cuenta nueva».
//  - «Tu ganancia real» con lo que de verdad te pagaron, y el historial mes a mes.
//  - Atajos: desde Repartir perfiles a Mi día, Quién me debe y Mis ganancias.
// Todo pasa por el servidor, que decide qué es tuyo y cuánto debe cada uno.
import { api, esc, fdate, toast, newKey, toCents } from "/common.js";
import { mine, mySym } from "/country.js";

let ctx = { refresh: async () => {}, render: () => {} };
/** shop.js le pasa cómo recargar la pestaña y volver a dibujar. */
export function cuadernoInit(c) { ctx = { ...ctx, ...c }; }

/** Último cobro de un toque, para «Deshacer». */
let last = null;
const UNDO_MS = 10 * 60_000;
const dm = (t) => fdate(t).slice(0, 5);

/** «·…123»: los últimos 3 números del WhatsApp, para no confundir a dos Juan Pérez. */
export const tail = (phone) => { const d = String(phone ?? "").replace(/\D/g, ""); return d.length >= 7 ? ` ·…${d.slice(-3)}` : ""; };
/** Nombre con los últimos 3 números (texto, sin escapar). */
export const who = (name, phone) => `${name ?? ""}${tail(phone)}`;

/** «debe desde el 31/08» · «le falta Bs 5 del 31/08» · «debe 2 meses (desde el 31/08)». */
export function owedText(it) {
  const p = it.periods ?? [];
  if (!p.length) return it.owed ? `debe ${mine(it.owed)}` : "";
  if (p.length === 1) return it.unit && p[0].owed < it.unit ? `le falta ${mine(p[0].owed)} del ${dm(p[0].from)}` : `debe desde el ${dm(p[0].from)}`;
  return `debe ${p.length} meses (desde el ${dm(p[0].from)})`;
}

/** Botones de cobro de un renglón de Mi día. `section` = "cobrar" (deudas) o "avisar". */
export function payButtons(it, section) {
  const id = esc(it.id);
  // Cliente registrado: puede renovar con tu saldo en el mismo toque → primero se ve el total (confirmar antes de descontar).
  if (it.kind === "client") return `<button class="sbtn sm pri" type="button" data-rdpay="${id}">💵 Me pagó</button>`;
  const amt = section === "cobrar" ? it.owed : it.unit ?? it.price;
  if (!amt) return `<button class="sbtn sm pri" type="button" data-rdpay="${id}">💵 Me pagó</button>`;
  return `<button class="sbtn sm pri" type="button" data-rdfast="${id}" data-amt="${amt}" data-key="${esc(newKey())}">💵 Me pagó ${esc(mine(amt))}</button><button class="sbtn sm" type="button" data-rdpay="${id}">✏️ Otro monto</button>`;
}

/** Lo mismo en Repartir perfiles y Quién me debe (no necesita el plan de Mi día). */
export function subPayButtons(aid, s, amt) {
  const k = `${esc(aid)}|${esc(s.id)}`;
  if (!amt) return "";
  return `<button class="sbtn sm pri" type="button" data-subfast="${k}" data-amt="${amt}" data-key="${esc(newKey())}">💵 Me pagó ${esc(mine(amt))}</button>
    <details class="rcmore cother"><summary class="sbtn sm">✏️ Otro monto</summary><form class="sform" data-subpay="${k}"><label>¿Cuánto te pagó? (${esc(mySym())})<input name="amount" inputmode="decimal" required data-due="${amt}" placeholder="${(amt / 100).toFixed(2)}"></label><small class="empty rdia-left" aria-live="polite"></small><button class="sbtn sm pri" type="submit">Guardar lo que me pagó</button></form></details>`;
}

/** Cartel de «Deshacer» el último cobro de un toque. */
export function undoBar() {
  if (!last || Date.now() - last.at > UNDO_MS) return "";
  return `<div class="sbox rdone cundo" role="status"><span>💵 ${esc(last.text)}</span><div class="rbtns">${last.cobroId ? `<button class="sbtn sm" type="button" data-cundo="1">↩️ Deshacer</button>` : ""}<button class="sbtn sm" type="button" data-cundox="1">Listo</button></div></div>`;
}

/** Texto de lo que queda después de un pago (en vivo, mientras escribe el monto). */
function leftText(due, v) {
  const paid = toCents(v);
  if (!v || !(paid > 0)) return "";
  if (paid < due) return `Queda debiendo ${mine(due - paid)}. El precio no cambia.`;
  if (paid > due) return `Te pagó ${mine(paid - due)} de más: queda a favor para el próximo mes.`;
  return "Queda todo pagado ✓";
}

/** Vista previa de «Otro monto» / «Me pagó» de un cliente registrado: CUÁNTO te pagó y, si corresponde, renovar con tu saldo. */
export function diaPreviewHtml(pv, key) {
  const it = pv.item, due = pv.due ?? pv.price ?? 0;
  const first = String(it.client || "").trim().split(" ")[0];
  const what = it.kind === "sub"
    ? `${pv.owed ? `${esc(first)} ${esc(owedText({ ...it, periods: pv.periods, unit: pv.unit, owed: pv.owed }))}: <b>${esc(mine(pv.owed))}</b>. ` : ""}${pv.moves ? `Si te pagó ${esc(mine(due))}, el perfil <b>${esc(it.label || it.product)}</b> pasa a vencer el <b>${fdate(pv.to)}</b>.` : "La fecha no cambia."}`
    : it.kind === "fiado" ? `${esc(first)} te debe <b>${esc(mine(due))}</b> en tu libreta.`
    : `Queda <b>pagado</b> en tu control.${pv.renew?.offered ? "" : pv.renew?.blocked ? ` ${esc(pv.renew.blocked)}` : " La fecha no cambia (todavía no vence)."}`;
  const renew = it.kind === "client" && pv.renew?.offered ? `<label class="rdia-ren"><input type="checkbox" name="renew" ${pv.renew.enough ? "checked" : "disabled"}><span>🔄 Renovar ahora con mi saldo: te cuesta <b>${esc(mine(pv.renew.cost))}</b> (tenés ${esc(mine(pv.renew.balance))}).${pv.renew.enough ? ` Pasa a vencer el <b>${fdate(pv.renew.to)}</b>.` : ` <a href="#recargas">Te falta saldo</a>.`}</span></label>` : "";
  return `<div class="rdia-pvbox"><p style="margin:0">${what}</p>
    <div class="rdia-pvact"><label>¿Cuánto te pagó? (${esc(mySym())})<input name="amount" inputmode="decimal" value="${due ? (due / 100).toFixed(2) : ""}" placeholder="0.00" data-due="${due}"></label>${renew}</div>
    <small class="empty rdia-left" aria-live="polite">${due ? "Queda todo pagado ✓" : ""}</small>
    <div class="rbtns"><button class="sbtn sm pri" type="button" data-rdpayok="${esc(it.id)}" data-key="${esc(key)}">✅ Confirmar: me pagó</button><button class="sbtn sm" type="button" data-rdpayno="1">Cancelar</button></div></div>`;
}

/** Atajos desde Repartir perfiles (requisito: llegar a Mi día y a Ganancias sin volver a Inicio). */
export function subsNav() {
  return `<nav class="cnav rbtns" aria-label="Ir a"><button class="sbtn sm" type="button" data-rtool="dia">☀️ Mi día</button><button class="sbtn sm" type="button" data-rtool="debe">💸 Quién me debe</button><button class="sbtn sm" type="button" data-rtool="ganancias">📈 Mis ganancias</button></nav>`;
}

/** «✂️ Se cortó tu HBO: tus 2 clientes (Nina, Óscar)», con «Pasar a mi cuenta nueva». */
export function cutsBox(cuts) {
  return (cuts ?? []).map((c) => {
    const n = c.clients.length, names = c.clients.map((x) => String(x.name).trim().split(" ")[0]).join(", ");
    const owed = c.clients.reduce((t, x) => t + (x.owed || 0), 0);
    const fit = c.targets.filter((t) => t.free >= n);
    return `<div class="sbox rcwarn ccut"><h3 style="margin:0">✂️ Se cortó tu ${esc(c.product)}: ${n === 1 ? "tu cliente" : `tus ${n} clientes`} (${esc(names)})</h3>
      <p class="empty" style="margin:0">Se quedaron sin servicio el ${dm(c.cutAt)}. Tu cuaderno sigue acá con sus fechas, precios y lo que te deben${owed ? ` (<b>${esc(mine(owed))}</b>)` : ""}.</p>
      <ul class="rdia-l">${c.clients.map((x) => `<li class="rdia-i"><span class="rdia-it"><b>${esc(who(x.name, x.phone))}</b><small>${esc(x.label || "")} · vence ${dm(x.expiresAt)}${x.price != null ? ` · ${esc(mine(x.price))}` : ""}${x.owed ? ` · <span class="bad">debe ${esc(mine(x.owed))}</span>` : ""}</small></span>${x.owed ? `<div class="rdia-act">${subPayButtons(c.assignmentId, x, x.owed)}</div>` : ""}</li>`).join("")}</ul>
      <div class="rbtns">${fit.length ? fit.map((t) => `<button class="sbtn pri" type="button" data-cutmove="${esc(c.assignmentId)}|${esc(t.assignmentId)}">➡️ Pasar a mi cuenta nueva${c.targets.length > 1 ? ` (${esc(t.email)})` : ""}</button>`).join("")
        : c.targets.length ? `<small class="empty">Tu otra cuenta de ${esc(c.product)} no tiene lugar para ${n}: quitá a alguien de ahí.</small>`
        : `<button class="sbtn pri" type="button" data-s="precios">🛒 Alquilar otra ${esc(c.product)}</button><small class="empty">Cuando la tengas, acá aparece «Pasar a mi cuenta nueva».</small>`}
        <button class="sbtn sm" type="button" data-cutdrop="${esc(c.assignmentId)}" data-n="${n}" data-owed="${owed}">🗑️ Ya no los tengo</button></div></div>`;
  }).join("");
}

/** En «Quién me debe»: los perfiles que te deben, período por período, con «Me pagó». */
export function subsDebtBox(debts) {
  const l = (debts?.items ?? []).filter((x) => x.kind === "sub");
  if (!l.length) return "";
  const tot = l.reduce((t, x) => t + x.owed, 0);
  return `<div class="sbox cdebts"><h3 style="margin:0">🧩 Perfiles que te deben · ${esc(mine(tot))}</h3><p class="empty" style="margin:0">Cada mes que pasa sin renovar mientras siga anotado, se suma.</p>
    ${l.map((u) => `<div class="line cdebt"><span class="lgrow"><b>${esc(who(u.client, u.phone))}</b><br><small class="empty">${esc(u.product)}${u.label ? ` · ${esc(u.label)}` : ""} · ${esc(owedText(u))}${u.cut ? " · ✂️ cuenta cortada" : ""}</small></span><b class="bad">${esc(mine(u.owed))}</b>
      <span class="rbtns">${subPayButtons(u.assignmentId, { id: u.subId }, u.owed)}</span></div>`).join("")}</div>`;
}

/** «💡 Tu ganancia real» del mes: lo que de verdad te pagaron − tus alquileres de este mes − lo que te costaron tus ventas. */
export function gananciaRealBox(g, owedAll) {
  if (!g?.real) return "";
  const r = g.real;
  if (!r.revenue && !r.cost) return "";
  const owed = owedAll ?? r.owed ?? 0;
  const msg = r.profit >= 0 ? (owed ? `Además te deben ${mine(owed)}: cuando te paguen, ganás eso también.` : "")
    : owed ? `Te deben ${mine(owed)}: cuando te paguen, ${r.profit + owed >= 0 ? `quedás en ${mine(r.profit + owed)}` : `todavía te faltan ${mine(-(r.profit + owed))} para cubrir tus alquileres`}.`
    : `Este mes lo que cobraste no cubre tus alquileres. Fijate si anotaste todos los perfiles que repartiste o si tus precios alcanzan.`;
  return `<div class="sbox rmreal"><h3 style="margin:0">💡 Tu ganancia real · ${esc(g.month?.label ?? "")}</h3>
    <div class="rkpis"><div><small>Cobraste</small><b>${esc(mine(r.revenue))}</b><small>perfiles ${esc(mine(r.cobrosPerfiles ?? 0))} + clientes ${esc(mine(r.cobrosClientes ?? 0))}</small></div><div><small>Te costó</small><b>${esc(mine(r.cost))}</b><small>tus alquileres ${esc(mine(r.alquileres ?? 0))} + ventas ${esc(mine(r.ventas ?? 0))}</small></div><div><small>Ganancia real</small><b class="${r.profit < 0 ? "bad" : "ok"}">${esc(mine(r.profit))}</b></div></div>
    <p class="empty" style="margin:0">Cuenta lo que de verdad te pagaron este mes. Tus alquileres van por los días de este mes que cubren: renovar temprano no te descuenta antes.</p>
    ${msg ? `<p class="empty" style="margin:0">${r.profit < 0 ? "⚠️ " : ""}${esc(msg)}</p>` : ""}</div>`;
}

/** 📅 Mes a mes: los meses cerrados quedan como fueron. */
export function historyBox(g) {
  const h = g?.history ?? [];
  if (!h.length) return "";
  return `<div class="sbox chist"><h3 style="margin:0">📅 Tu ganancia real mes a mes</h3>
    ${h.map((m) => `<div class="line"><span class="lgrow"><b>${esc(m.label)}</b>${m.closed ? " <small class=\"empty\">· cerrado ✓</small>" : " <small class=\"empty\">· en curso</small>"}<br><small class="empty">cobraste ${esc(mine(m.cobros))} · alquileres ${esc(mine(m.alquileres))}${m.ventas ? ` · ventas ${esc(mine(m.ventas))}` : ""}${m.closed && m.perfiles ? ` · ${m.perfiles} perfiles` : ""}${m.closed && m.deuda ? ` · te debían ${esc(mine(m.deuda))}` : ""}</small></span><b class="${m.ganancia < 0 ? "bad" : "ok"}">${esc(mine(m.ganancia))}</b></div>`).join("")}</div>`;
}

async function done(r, name) {
  last = { at: Date.now(), cobroId: r.cobroId ?? null, text: `${name} te pagó ${mine(r.paid)}${r.left ? ` · debe ${mine(r.left)}` : " · al día"}` };
  toast(r.left ? `💵 Anotado. Queda debiendo ${mine(r.left)}` : `💵 Cobrado ✓${r.to ? ` (vence el ${dm(r.to)})` : ""}`);
  await ctx.refresh();
}
const nameNear = (el) => el.closest("[data-diaitem]")?.dataset.who || el.closest(".rdia-g")?.querySelector("header b")?.textContent || el.closest(".line,.rdia-i,.subrow")?.querySelector("b")?.textContent || "Tu cliente";

document.addEventListener("input", (ev) => {
  const t = ev.target;
  if (t?.name !== "amount" || t.dataset.due === undefined) return;
  const out = t.closest(".rdia-pvbox,form")?.querySelector(".rdia-left");
  if (out) out.textContent = leftText(Number(t.dataset.due) || 0, t.value.trim());
});

document.addEventListener("submit", async (ev) => {
  const f = ev.target.closest("form[data-subpay]");
  if (!f) return;
  ev.preventDefault();
  const [aid, sid] = f.dataset.subpay.split("|");
  const v = f.querySelector('[name="amount"]').value.trim();
  if (!(toCents(v) > 0)) return toast("Escribí cuánto te pagó");
  const btn = f.querySelector("button"); if (btn) btn.disabled = true;
  try { await done(await api("POST", `/api/me/subs/${aid}/${sid}/pay`, { amount: toCents(v) }), nameNear(f)); }
  catch (e) { toast(e.message); if (btn) btn.disabled = false; }
});

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest("button[data-rdfast],button[data-subfast],button[data-cundo],button[data-cundox],button[data-rdpay],button[data-rdpayok],button[data-rdpayno],button[data-cutmove],button[data-cutdrop]");
  if (!el || el.disabled) return;
  const d = el.dataset;
  if (d.cundox) { last = null; return ctx.render(); }
  if (d.rdpayno) { const box = el.closest(".rdia-i")?.querySelector(".rdia-pv"); if (box) { box.hidden = true; box.innerHTML = ""; } return; }
  el.disabled = true;
  try {
    if (d.rdfast) return await done(await api("POST", `/api/me/dia/pay/${encodeURIComponent(d.rdfast)}`, { amount: Number(d.amt), idempotencyKey: d.key }), nameNear(el));
    if (d.subfast) { const [aid, sid] = d.subfast.split("|"); return await done(await api("POST", `/api/me/subs/${aid}/${sid}/pay`, { amount: Number(d.amt) }), nameNear(el)); }
    if (d.cundo) { await api("POST", `/api/me/cobros/${encodeURIComponent(last.cobroId)}/undo`, {}); last = null; toast("↩️ Listo, lo deshice"); return await ctx.refresh(); }
    if (d.rdpay) {
      const box = el.closest(".rdia-i")?.querySelector(".rdia-pv"); if (!box) return;
      const pv = await api("GET", `/api/me/dia/preview/${encodeURIComponent(d.rdpay)}`);
      box.innerHTML = diaPreviewHtml(pv, newKey()); box.hidden = false; box.scrollIntoView({ block: "nearest" });
      box.querySelector('[name="amount"]')?.focus();
      return;
    }
    if (d.rdpayok) {
      const box = el.closest(".rdia-i")?.querySelector(".rdia-pv"); if (!box) return;
      const v = box.querySelector('[name="amount"]')?.value.trim(); const renew = !!box.querySelector('[name="renew"]')?.checked;
      if (v && !(toCents(v) > 0)) { const o = box.querySelector(".rdia-left"); if (o) o.textContent = "Escribí cuánto te pagó"; return; }
      const r = await api("POST", `/api/me/dia/pay/${encodeURIComponent(d.rdpayok)}`, { ...(v ? { amount: toCents(v) } : {}), renew, idempotencyKey: d.key });
      if (r.renewError) toast(`💵 Cobro anotado. No se renovó: ${r.renewError}`);
      else if (r.renewed) toast(`💵 Cobrado y renovado hasta el ${fdate(r.to)} ✓`);
      return await done(r, nameNear(el));
    }
    if (d.cutmove) {
      const [from, to] = d.cutmove.split("|");
      const r = await api("POST", `/api/me/cortes/${from}/move`, { to });
      toast(`➡️ Pasaste ${r.moved} cliente(s) a tu cuenta nueva${r.gapDays ? ` · les sumé ${r.gapDays} día(s) sin servicio` : ""}`);
      return await ctx.refresh();
    }
    if (d.cutdrop) {
      const owed = Number(d.owed) || 0;
      if (!confirm(`¿Borrar a ${d.n === "1" ? "este cliente" : `estos ${d.n} clientes`} de tu cuaderno?${owed ? ` Te deben ${mine(owed)} y también se borra.` : ""}`)) return;
      await api("POST", `/api/me/cortes/${d.cutdrop}/drop`, {});
      toast("Listo, ya no aparecen");
      return await ctx.refresh();
    }
  } catch (e) { toast(e.message); }
  finally { if (el.isConnected) el.disabled = false; }
});
