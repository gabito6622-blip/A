// Mis cuentas del cliente de la tienda (revisión «en el lugar de ~30 clientes», 14/11/2026):
//  - «🔄 Renovar todo junto»: elegís tus servicios, ves el total y pagás una sola vez (saldo, todo o nada; o UN QR).
//  - «🔄 Renovar mi combo · Bs X»: lo comprado en combo, renovado junto, conserva el descuento de combo de hoy. Suelto
//    paga precio de lista y la tarjeta avisa «juntos te ahorrás Bs X».
//  - «📅 Quiero un solo día de pago» (plan mensual): al renovar todo junto las fechas se emparejan pagando solo los días
//    que faltan (se ve antes de confirmar). Tarjeta «Tu plan: … · próximo pago dd/mm · Bs X». Nada se cobra solo.
//  - En la tarjeta del servicio: «⚠️ Falla reportada · Revisando».
// Todo lo calcula el servidor (planMensual.ts): acá solo se elige qué renovar y se muestra lo que responde.
import { api, esc, bs, fdate, toast, fileToBase64, newKey } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/plan-mensual.css"]')) {
  const l = document.createElement("link"); l.rel = "stylesheet"; l.href = "/plan-mensual.css"; document.head.append(l);
}

const P = { view: null, pending: [], sel: new Set(), align: false, plan: false, pv: null, pvKey: "", open: false, busy: false, err: "", picked: false, wantPay: false };
let ctx = { render: () => {}, refresh: async () => {}, setView: () => {}, me: () => null, settings: () => ({}), services: () => [] };
const short = (n) => String(n ?? "").replace(/ \(alquiler revendedores\)/, "");
const TK = { recibido: "Recibida", revisando: "Revisando" };

export function planInit(c) { ctx = { ...ctx, ...c }; }

/** Servicios que se pueden renovar desde acá (los que renueva la tienda o el revendedor quedan afuera). */
const eligible = (services) => (services ?? []).filter((a) => a.customerId === ctx.me()?.id && !a.viaReseller && a.canRenew !== false && a.renewableNow !== false);

/** Se llama al abrir «Mis cuentas» (cliente de la tienda). */
export async function loadPlan() {
  const [v, st] = await Promise.all([api("GET", "/api/me/plan").catch(() => null), api("GET", "/api/me/store-rentals").catch(() => null)]);
  P.view = v; P.pending = st?.pending ?? [];
  const list = eligible(ctx.services());
  for (const id of [...P.sel]) if (!list.some((a) => a.assignmentId === id)) P.sel.delete(id);
  // La primera vez: ya marcados los que vencen esta semana (lo que tiene que pagar ahora).
  if (!P.picked) { P.picked = true; list.filter((a) => a.daysLeft <= 7).forEach((a) => P.sel.add(a.assignmentId)); }
  // Toque del aviso «Tu plan vence…» (/tienda/?pagar=plan#cuentas): abre «Pagar este mes».
  const q = new URLSearchParams(location.search);
  if (q.get("pagar") === "plan") {
    history.replaceState(null, "", location.pathname + location.hash);
    if (v?.plan) { choose(v.plan.ids, true, true); P.wantPay = true; }
  }
  if (P.sel.size) await preview();
}

function choose(ids, align, plan) {
  P.sel = new Set(ids); P.align = !!align; P.plan = !!plan; P.open = true; P.pv = null; P.pvKey = ""; P.err = "";
}

async function preview() {
  const ids = [...P.sel];
  const key = `${ids.sort().join(",")}|${P.align}`;
  if (!ids.length) { P.pv = null; P.pvKey = ""; return; }
  if (key === P.pvKey && P.pv) return;
  P.pvKey = key;
  try { const pv = await api("POST", "/api/me/renew-all/preview", { ids, align: P.align }); if (P.pvKey === key) { P.pv = pv; P.err = ""; } }
  catch (e) { if (P.pvKey === key) { P.pv = null; P.err = e.message; } }
}

/* ---------------- Tarjeta del plan ---------------- */

export function planCard() {
  const p = P.view?.plan;
  if (!p) return "";
  const price = p.total !== null ? ` · <b>${bs(p.total)}</b>` : "";
  return `<section class="sbox plancard" aria-labelledby="planT"><h2 id="planT">📅 Tu plan: ${esc(p.names.join(" + "))}</h2>
    <p class="planline">Próximo pago <b>${fdate(p.nextAt)}</b>${price}</p>
    ${p.aligned ? "" : `<p class="empty" style="margin:0">Tus fechas se separaron: al pagar este mes se vuelven a emparejar (pagás solo los días que faltan).</p>`}
    ${!p.ok && p.why ? `<p class="empty" style="margin:0">⚠️ ${esc(p.why)}</p>` : ""}
    <p class="empty" style="margin:0">Nada se cobra solo: te avisamos 3 días antes, 1 día antes y el día. Pagás vos, con tu saldo o con un QR.</p>
    <div class="hrow"><button class="sbtn pri" type="button" data-planpay="1">💳 Pagar este mes${p.total !== null ? ` · ${bs(p.total)}` : ""}</button><button class="sbtn" type="button" data-planedit="1">Cambiar</button><button class="sbtn" type="button" data-planoff="1">Dejar el plan</button></div></section>`;
}

/* ---------------- Renovar todo junto ---------------- */

function comboStrip() {
  const g = (P.view?.groups ?? []).filter((x) => x.ok && x.total !== null);
  if (!g.length) return "";
  return g.map((x) => `<div class="sbox combostrip"><span><b>🎁 Tu combo: ${esc(x.name)}</b><small class="empty">Renovado junto conserva el descuento${x.discount ? ` (ahorrás ${bs(x.discount)})` : ""}.</small></span>
    <button class="sbtn pri" type="button" data-renewcombo="${esc(x.id)}">🔄 Renovar mi combo · ${bs(x.total)}</button></div>`).join("");
}

function rowsHtml(pv) {
  return `<ul class="ralist">${pv.rows.map((r) => `<li class="${r.ok ? "" : "bad"}"><span><b>${esc(r.product)}</b>${r.combo ? ` <span class="spill sp-mute">🎁 combo</span>` : ""}
    <small>${r.ok ? (P.align ? `${esc(r.period ?? fmtDays(r.days))}: del ${fdate(r.from)} al ${fdate(r.to)}` : `hasta el ${fdate(r.to)}`) : `⚠️ ${esc(r.why)}`}</small></span>
    ${r.ok ? `<span class="raprice">${r.price !== r.list ? `<s>${bs(r.list)}</s> ` : ""}<b>${bs(r.price)}</b></span>` : ""}</li>`).join("")}</ul>`;
}
const fmtDays = (d) => `${Number.isInteger(d) ? d : d.toFixed(1).replace(".", ",")} ${d === 1 ? "día" : "días"}`;

/** El cuadro «🔄 Renovar todo junto» de Mis cuentas. */
export function renewAllBox(services) {
  if (!P.view?.available) return "";
  const list = eligible(services);
  if (list.length < 2) return comboStrip();
  const pv = P.pv, ok = pv && pv.ok && P.sel.size;
  const bal = ctx.me()?.balance ?? 0;
  const hints = (pv?.hints ?? []).map((h) => `<p class="rahint">💡 Si renovás ${esc(h.name)} juntos te ahorrás <b>${bs(h.save)}</b>${h.missing.length ? ` (te falta marcar ${esc(h.missing.join(", "))})` : ""}.</p>`).join("");
  return `${comboStrip()}<details class="sbox rmbox rabox" id="rabox" ${P.open || P.sel.size ? "open" : ""}><summary><b>🔄 Renovar todo junto</b> <small class="empty">elegís, ves el total y pagás una sola vez</small></summary>
    <div class="rmlist">${list.map((a) => `<label class="rmrow"><input type="checkbox" data-rasel="${esc(a.assignmentId)}" ${P.sel.has(a.assignmentId) ? "checked" : ""}><span><b>${esc(short(a.product))}</b><small class="empty">vence ${fdate(a.expiresAt)}</small></span><b>${bs(a.renewPrice ?? 0)}</b></label>`).join("")}</div>
    <label class="chk raalign"><input type="checkbox" data-raalign="1" ${P.align ? "checked" : ""}> 📅 Quiero un solo día de pago <small class="empty">Todos pasan a vencer el mismo día: pagás solo los días que faltan, sin regalos ni cobros de más.</small></label>
    ${P.align ? `<label class="chk"><input type="checkbox" data-raplan="1" ${P.plan ? "checked" : ""}> Guardar como mi plan mensual (te avisamos cada mes; nada se cobra solo)</label>` : ""}
    <div aria-live="polite">${P.err ? `<p class="err" role="alert">${esc(P.err)}</p>` : ""}
    ${pv && P.sel.size ? `${rowsHtml(pv)}${hints}
      <p class="ratot">${pv.discount ? `Descuento de tu combo: <b>−${bs(pv.discount)}</b> · ` : ""}Total: <b>${bs(pv.total)}</b>${P.align && pv.until ? ` · todos vencen el <b>${fdate(pv.until)}</b>` : ""}</p>` : P.sel.size ? `<p class="empty">Calculando…</p>` : `<p class="empty">Marcá los servicios que querés renovar.</p>`}</div>
    <div class="hrow"><button class="sbtn pri" type="button" data-rapay="balance" ${ok ? "" : "disabled"}>💰 Con mi saldo${ok ? ` · ${bs(pv.total)}` : ""}</button><button class="sbtn" type="button" data-rapay="qr" ${ok ? "" : "disabled"}>📲 Con un QR${ok ? ` · ${bs(pv.total)}` : ""}</button></div>
    <small class="empty">Tu saldo: ${bs(bal)}${ok && pv.total > bal ? " · no alcanza: recargá o pagá con QR" : ""}</small></details>`;
}

/* ---------------- Un solo QR ---------------- */

/** Ids de los pedidos que muestra el cuadro del QR (shop.js no repite sus tarjetas sueltas). Solo si son 2 o más. */
export const planQrIds = () => new Set(P.pending.length >= 2 ? P.pending.map((o) => o.id) : []);

export function planQrBox() {
  const q = P.pending;
  if (q.length < 2) return "";
  const total = q.reduce((t, o) => t + o.total, 0), st = ctx.settings();
  return `<div class="sbox rmbox rmqr" id="raqr"><h2 style="margin:0">📲 Pagá ${bs(total)} con un solo QR</h2>
    <p class="empty" style="margin:0">Renovás ${q.length} servicios juntos. Pagá el total exacto y subí UN comprobante. Si no llega en 3 días, el pedido se cancela solo.</p>
    <ul class="rmqrlist">${q.map((o) => `<li><span><b>${esc(o.product)}</b><small>${esc(o.email)}</small></span><b>${bs(o.total)}</b><button class="sbtn sm" type="button" data-cancel="${esc(o.id)}" aria-label="Cancelar la renovación de ${esc(o.product)}">Cancelar</button></li>`).join("")}</ul>
    ${st.hasQr ? `<img class="rmqrimg" src="/api/settings/qr" alt="QR de cobro de la tienda">` : `<p class="empty" style="margin:0">La tienda todavía no cargó su QR: pedíselo por WhatsApp.</p>`}
    <label>Comprobante (foto o PDF)<input type="file" id="raFile" accept="image/*,application/pdf"></label>
    <label>Número de operación<input id="raRef" maxlength="60" inputmode="numeric" placeholder="Ej.: 123456789"></label>
    <p class="err" id="raErr" role="alert" hidden></p>
    <button class="sbtn pri" type="button" data-rasend="1">Enviar comprobante · ${bs(total)}</button></div>`;
}

/* ---------------- Tarjeta de cada servicio ---------------- */

/** «🎁 combo» y «⚠️ Falla reportada · Revisando» junto al nombre. */
export function svcTags(a) {
  const st = P.view?.fallas?.[a.assignmentId];
  const inCombo = (P.view?.groups ?? []).some((g) => g.ids.includes(a.assignmentId));
  return `${inCombo ? ` <span class="spill sp-mute">🎁 combo</span>` : ""}${st ? ` <span class="spill sp-warn fallapill">⚠️ Falla reportada · ${TK[st] ?? "Revisando"}</span>` : ""}`;
}

/** Debajo de «Renovar con saldo» de un servicio del combo: suelto paga lista; junto, ahorra. */
export function svcComboNote(a) {
  const g = (P.view?.groups ?? []).find((x) => x.ids.includes(a.assignmentId));
  if (!g || !g.discount || a.viaReseller || a.canRenew === false) return "";
  return `<small class="combonote">🎁 Es parte de tu combo ${esc(g.name)}: suelto paga precio de lista; juntos te ahorrás <b>${bs(g.discount)}</b>.${g.ok ? ` <button class="sbtn sm" type="button" data-renewcombo="${esc(g.id)}">🔄 Renovar mi combo${g.total !== null ? ` · ${bs(g.total)}` : ""}</button>` : ""}</small>`;
}

/* ---------------- Eventos ---------------- */

async function rerender() { await preview(); ctx.render(); }
function focusBox() {
  const box = document.getElementById("rabox");
  if (!box) return;
  box.open = true;
  box.scrollIntoView({ block: "start" });
  box.querySelector("summary")?.focus({ preventScroll: true });
}

async function pay(method) {
  const ids = [...P.sel];
  const pv = await api("POST", "/api/me/renew-all/preview", { ids, align: P.align });
  P.pv = pv; P.pvKey = `${ids.sort().join(",")}|${P.align}`;
  const bad = pv.rows.find((r) => !r.ok);
  if (bad) { ctx.render(); return toast(`${bad.product}: ${bad.why}`); }
  const lines = pv.rows.map((r) => `• ${r.product}: ${bs(r.price)}${P.align ? ` (${r.period ?? fmtDays(r.days)}, hasta el ${fdate(r.to)})` : ""}`).join("\n");
  const head = `${pv.discount ? `Con el descuento de tu combo (−${bs(pv.discount)}).\n` : ""}${lines}\nTotal: ${bs(pv.total)}`;
  if (method === "balance") {
    if (pv.total > pv.balance) { toast(`Te falta saldo: necesitás ${bs(pv.total)} y tenés ${bs(pv.balance)}`); return ctx.setView("recargas"); }
    if (!confirm(`¿Renovar con tu saldo?\n${head}\nTe quedan ${bs(pv.balance - pv.total)}.`)) return;
  } else if (!confirm(`¿Renovar y pagar ${bs(pv.total)} con UN solo QR?\n${head}`)) return;
  const r = await api("POST", "/api/me/renew-all", { ids, align: P.align, plan: P.align && P.plan, paymentMethod: method, idempotencyKey: newKey() });
  P.sel.clear(); P.pv = null; P.pvKey = ""; P.open = false; P.plan = false;
  toast(method === "qr" ? "Pedido creado: pagá el QR y subí el comprobante acá mismo" : `🔄 ¡Listo! ${r.count === 1 ? "Renovado" : `${r.count} servicios renovados`} por ${bs(r.total)}`);
  await ctx.refresh();
  if (method === "qr") document.getElementById(P.pending.length >= 2 ? "raqr" : "sout")?.scrollIntoView({ block: "start" });
}

if (typeof document !== "undefined") {
  document.addEventListener("change", async (ev) => {
    const t = ev.target, d = t?.dataset ?? {};
    if (d.rasel === undefined && !d.raalign && !d.raplan) return;
    if (d.rasel !== undefined) { if (t.checked) P.sel.add(d.rasel); else P.sel.delete(d.rasel); }
    if (d.raalign) { P.align = t.checked; if (!t.checked) P.plan = false; }
    if (d.raplan) P.plan = t.checked;
    P.open = true;
    await rerender();
  });
  document.addEventListener("click", async (ev) => {
    const el = ev.target.closest?.("button[data-rapay],button[data-rasend],button[data-renewcombo],button[data-planpay],button[data-planedit],button[data-planoff]");
    if (!el || P.busy) return;
    const d = el.dataset;
    if (d.renewcombo) {
      const g = (P.view?.groups ?? []).find((x) => x.id === d.renewcombo);
      if (!g) return;
      choose(g.ids, false, false); await rerender(); return focusBox();
    }
    if (d.planpay || d.planedit) {
      const p = P.view?.plan;
      if (!p) return;
      choose(p.ids, true, true); await rerender(); return focusBox();
    }
    P.busy = true; el.disabled = true;
    try {
      if (d.planoff) {
        if (!confirm("¿Dejar el plan? Tus servicios siguen igual; solo dejamos de juntarlos en un día de pago.")) return;
        P.view = await api("POST", "/api/me/plan", { on: false });
        toast("Listo: dejaste el plan"); ctx.render();
      }
      if (d.rapay) await pay(d.rapay);
      if (d.rasend) {
        const f = document.getElementById("raFile")?.files?.[0], ref = document.getElementById("raRef")?.value.trim(), errEl = document.getElementById("raErr");
        const fail = (m) => { if (errEl) { errEl.textContent = m; errEl.hidden = false; } };
        if (!f) return fail("Elegí la foto o el PDF del comprobante");
        if (!ref) return fail("Escribí el número de operación");
        await api("POST", "/api/me/renew-many/evidence", { orderIds: P.pending.map((o) => o.id), contentBase64: await fileToBase64(f), declaredReference: ref });
        toast("🔍 Comprobante enviado: lo revisamos y se renuevan todos juntos");
        await ctx.refresh();
      }
    } catch (e) {
      if (e.code === "INSUFFICIENT_BALANCE") { toast(e.message); ctx.setView("recargas"); }
      else toast(e.message);
    } finally { P.busy = false; if (el.isConnected) el.disabled = false; }
  });
}

/** Después de dibujar «Mis cuentas»: si vino del aviso «Tu plan vence…», lleva la vista a «Pagar este mes». */
export function planAfterRender() {
  if (!P.wantPay || !document.getElementById("rabox")) return;
  P.wantPay = false;
  setTimeout(focusBox, 0);
}
