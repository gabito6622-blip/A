// Herramientas de cobro del dueño, en GaboHub (17/11/2026). Se cargan solo en el panel (hub-perezoso.js).
//  - Inicio: «✍️ Anotar rápido» (pegás «Lucía pagó 15», ves qué se anota y confirmás) y «📋 Cobrar hoy» (abre Mi día).
//  - Mi día: «💵 Me pagó todo» por persona, «↩️ Deshacer» de cualquier cobro (30 min), comprobantes que mandaron tus
//    clientes desde tu link (✅ Aprobar = «Me pagó»; ✕ Rechazar con motivo) y 🏦 tus datos de pago para el link.
// Nada se manda ni se cobra solo: WhatsApp se abre con el mensaje listo (wa.me) y la plata la anotás vos.
import { api, esc, fdate, toast, newKey, toCents } from "/common.js";
import { mine } from "/country.js";

let ctx = { render: () => {}, refresh: async () => {} };
export function initHubCobros(c) { ctx = { ...ctx, ...c }; }

let D = null, loading = null;
const Q = { text: "", res: null, key: null, open: false };

/** Trae el resumen, los comprobantes y tus datos de pago. Si el plan no incluye la lista, queda `locked`. */
export function loadHubCobros() {
  loading ??= Promise.all([
    api("GET", "/api/me/cobros-hub").catch(() => null),
    api("GET", "/api/me/cobros-hub/proofs").catch((e) => ({ locked: e.message })),
    api("GET", "/api/me/cobros-hub/pay-info").catch(() => ({ info: null })),
  ]).then(([sum, proofs, pay]) => { D = { sum, proofs, info: pay?.info ?? null }; }).finally(() => { loading = null; });
  return loading;
}
const ensure = () => { if (!D && !loading) loadHubCobros().then(() => ctx.render(), () => {}); };
const reload = async () => { await loadHubCobros(); await ctx.refresh(); };

/* ---------------- Inicio ---------------- */
export function hubCobrosHome() {
  ensure();
  const n = D?.proofs?.review?.length ?? 0;
  return `<section class="sbox hcob" id="hcob"><h3 style="margin:0">✍️ Anotar rápido</h3>
    <p class="empty" style="margin:0">Escribí o pegá quién te pagó y cuánto, una línea por pago. Primero te muestro qué se anota.</p>
    <label class="hcob-l">Qué te pagaron<textarea id="hcobText" rows="2" placeholder="Lucía mamá pagó 15&#10;José 45">${esc(Q.text)}</textarea></label>
    <div class="hrow"><button class="sbtn pri" type="button" data-hcparse="1">👀 Ver qué se anota</button><button class="sbtn" type="button" data-rtool="dia">📋 Cobrar hoy</button>${n ? `<button class="sbtn" type="button" data-rtool="dia" data-hcproofs="1">🧾 ${n} comprobante${n === 1 ? "" : "s"} para revisar</button>` : ""}</div>
    <div id="hcobPrev" aria-live="polite">${Q.res ? previewHtml(Q.res) : ""}</div>${undoHtml()}</section>`;
}
function previewHtml(r) {
  if (r.error) return `<p class="err" role="alert">${esc(r.error)}</p>`;
  const rows = r.lines.map((x) => x.id
    ? `<li class="hcob-ok"><b>${esc(x.client)}</b> <small>${esc(x.product)}${x.label ? ` · ${esc(x.label)}` : ""}</small><span>💵 ${esc(mine(x.amount ?? x.owed))}${x.amount === null ? " <small>(lo que debe)</small>" : x.amount < x.owed ? ` <small>· queda debiendo ${esc(mine(x.owed - x.amount))}</small>` : ""}</span></li>`
    : `<li class="hcob-bad"><b>«${esc(x.line)}»</b><span>⛔ ${esc(x.error)}</span></li>`).join("");
  return `<ul class="hcob-list">${rows}</ul>${r.ok ? `<button class="sbtn pri" type="button" data-hcapply="1">✅ Confirmar y anotar${r.ok > 1 ? ` (${r.ok})` : ""}</button>` : ""}`;
}
function undoHtml() {
  const l = D?.sum?.undo ?? [];
  if (!l.length) return "";
  return `<div class="hcob-undo"><b>↩️ Cobros recientes (se pueden deshacer)</b>${l.slice(0, 5).map((u) => `<div class="hcob-ur"><span>${esc(u.label)} <small class="empty">· quedan ${u.minutesLeft} min</small></span><button class="sbtn sm" type="button" data-hcundo="${esc(u.id)}">↩️ Deshacer</button></div>`).join("")}</div>`;
}

/* ---------------- Mi día ---------------- */
/** «💵 Me pagó todo» en la cabecera de una persona que debe más de una cosa. */
export function payAllBtn(g) {
  if (!g || g.items.length < 2) return "";
  return `<button class="sbtn sm pri" type="button" data-hcall="${esc(g.items.map((x) => x.id).join(","))}" data-hcwho="${esc(g.client)}" data-hctot="${g.total}">💵 Me pagó todo ${esc(mine(g.total))}</button>`;
}
export function hubCobrosDia() {
  ensure();
  if (!D) return "";
  const P = D.proofs;
  const lock = P?.locked ? `<p class="empty">🔒 ${esc(P.locked)}</p>` : "";
  const st = { review: "En revisión", approved: "Aprobado ✓", rejected: "Rechazado" };
  const card = (p) => `<li class="hcob-pr" data-hcpr="${esc(p.id)}"><div><b>${esc(p.name)}</b> <small>${esc(p.product)} · ${fdate(p.at).slice(0, 5)}</small><br><span>${p.amount ? `Le tocaba pagar <b>${esc(mine(p.amount))}</b>` : "Sin monto cargado"}</span></div>
      <a class="sbtn sm" href="/api/me/cobros-hub/proofs/${encodeURIComponent(p.id)}/file" target="_blank" rel="noopener">🖼️ Ver comprobante</a>
      <label class="hcob-l">Cuánto llegó (si es otro monto)<input name="hcamt" inputmode="decimal" placeholder="${p.amount ? esc((p.amount / 100).toString()) : "0"}" aria-label="Cuánto llegó de ${esc(p.name)}"></label>
      <div class="hrow"><button class="sbtn sm pri" type="button" data-hcok="${esc(p.id)}">✅ Aprobar (me pagó)</button><button class="sbtn sm" type="button" data-hcno="${esc(p.id)}">✕ Rechazar</button></div>
      <div class="hcob-no" hidden><label class="hcob-l">Motivo (lo ve tu cliente)<input name="hcwhy" maxlength="120" placeholder="No se ve el monto"></label><button class="sbtn sm" type="button" data-hcnook="${esc(p.id)}">Rechazar comprobante</button></div></li>`;
  const review = P?.review ?? [], done = P?.done ?? [];
  const I = D.info ?? {};
  return `<section class="sbox hcob" id="hcobDia"><h3 style="margin:0">🧾 Comprobantes de tus links <small class="empty">· ${review.length ? `${review.length} en revisión` : "ninguno esperando"}</small></h3>
    <p class="empty" style="margin:0">Tus clientes los suben desde el link de cobro. Nada se cobra solo: si llegó la plata, tocá «Aprobar» y queda como «Me pagó».</p>
    ${lock}${review.length ? `<ul class="hcob-list">${review.map(card).join("")}</ul>` : ""}
    ${done.length ? `<details><summary>Últimos revisados (${done.length})</summary><ul class="hcob-list">${done.map((p) => `<li><b>${esc(p.name)}</b> <small>${esc(p.product)} · ${fdate(p.decidedAt ?? p.at).slice(0, 5)} · ${st[p.status]}${p.reason ? ` · ${esc(p.reason)}` : ""}</small></li>`).join("")}</ul></details>` : ""}
    ${undoHtml()}
    <details class="hcob-pay"><summary>🏦 Mis datos de pago ${D.info ? "<small class=\"empty\">· cargados ✓</small>" : "<small class=\"empty\">· los ve tu cliente en el link</small>"}</summary>
      <form class="sform" id="hcobPay"><label>Banco o billetera<input name="bank" maxlength="40" value="${esc(I.bank ?? "")}" placeholder="Ej.: Banco Unión"></label>
      <label>A nombre de<input name="holder" maxlength="60" value="${esc(I.holder ?? "")}" placeholder="Tu nombre completo"></label>
      <label>Número de cuenta (opcional)<input name="account" maxlength="40" value="${esc(I.account ?? "")}" inputmode="numeric"></label>
      <label>Nota (opcional)<input name="note" maxlength="160" value="${esc(I.note ?? "")}" placeholder="Mandá la foto del comprobante"></label>
      <p class="empty" style="margin:0">Tu QR es el de tu página (Mi página → QR de cobro).</p>
      <button class="sbtn pri" type="submit">Guardar mis datos</button><span class="hcob-msg" role="status"></span></form></details></section>`;
}

/* ---------------- clics ---------------- */
if (typeof document !== "undefined") {
  document.addEventListener("input", (ev) => { if (ev.target?.id === "hcobText") { Q.text = ev.target.value; Q.res = null; } });
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest?.("[data-hcparse],[data-hcapply],[data-hcundo],[data-hcall],[data-hcok],[data-hcno],[data-hcnook]");
    if (!b || b.disabled) return;
    const d = b.dataset;
    if (d.hcno) { const box = b.closest(".hcob-pr")?.querySelector(".hcob-no"); if (box) { box.hidden = !box.hidden; box.querySelector("input")?.focus(); } return; }
    b.disabled = true;
    try {
      if (d.hcparse) {
        Q.text = document.getElementById("hcobText")?.value ?? Q.text;
        try { Q.res = await api("POST", "/api/me/cobros-hub/quick/parse", { text: Q.text }); Q.key = newKey(); } catch (e) { Q.res = { error: e.message }; }
        const out = document.getElementById("hcobPrev"); if (out) out.innerHTML = previewHtml(Q.res);
        b.disabled = false; return;
      }
      if (d.hcapply) {
        const r = await api("POST", "/api/me/cobros-hub/quick/apply", { text: Q.text, idempotencyKey: Q.key });
        toast(`✅ Anotado: ${r.count} cobro${r.count === 1 ? "" : "s"}${r.skipped?.length ? ` · ${r.skipped.length} sin anotar` : ""}`);
        Q.text = ""; Q.res = null; Q.key = null;
        return await reload();
      }
      if (d.hcundo) {
        if (!confirm("¿Deshacer ese cobro?\n\nVuelve exactamente a como estaba antes.")) { b.disabled = false; return; }
        const r = await api("POST", `/api/me/cobros-hub/undo/${encodeURIComponent(d.hcundo)}`, {});
        toast(`↩️ Deshecho: ${r.label}`);
        return await reload();
      }
      if (d.hcall) {
        const ids = d.hcall.split(",");
        if (!confirm(`¿${d.hcwho} te pagó todo (${ids.length} cuentas, ${mine(Number(d.hctot) || 0)})?\n\nSe anota cada una. Podés deshacerlo por 30 minutos.`)) { b.disabled = false; return; }
        const r = await api("POST", "/api/me/cobros-hub/pay-many", { items: ids, idempotencyKey: newKey() });
        toast(`💵 ${d.hcwho}: ${r.count} cobradas · ${mine(r.paid)}`);
        return await reload();
      }
      if (d.hcok) {
        const v = b.closest(".hcob-pr")?.querySelector('[name="hcamt"]')?.value.trim();
        if (v && !(toCents(v) > 0)) { toast("Escribí cuánto llegó, o dejalo vacío"); b.disabled = false; return; }
        const r = await api("POST", `/api/me/cobros-hub/proofs/${encodeURIComponent(d.hcok)}/approve`, v ? { amount: toCents(v) } : {});
        toast(`✅ Aprobado: ${mine(r.paid)}${r.to ? ` · vence el ${fdate(r.to).slice(0, 5)}` : ""}`);
        return await reload();
      }
      if (d.hcnook) {
        const why = b.closest(".hcob-no")?.querySelector("input")?.value ?? "";
        await api("POST", `/api/me/cobros-hub/proofs/${encodeURIComponent(d.hcnook)}/reject`, { reason: why });
        toast("Rechazado: tu cliente puede subir otro");
        return await reload();
      }
    } catch (e) { toast(e.message); b.disabled = false; }
  });
  document.addEventListener("submit", async (ev) => {
    const f = ev.target.closest?.("#hcobPay");
    if (!f) return;
    ev.preventDefault();
    const btn = f.querySelector("[type=submit]"); btn.disabled = true;
    const msg = f.querySelector(".hcob-msg");
    try {
      const r = await api("PUT", "/api/me/cobros-hub/pay-info", { bank: f.bank.value, holder: f.holder.value, account: f.account.value, note: f.note.value });
      if (D) D.info = r.info;
      if (msg) msg.textContent = "Guardado ✓";
      toast("🏦 Datos de pago guardados");
    } catch (e) { if (msg) msg.textContent = e.message; }
    btn.disabled = false;
  });
}
