// ✍️ Anotar rápido, ↩️ Deshacer un cobro, 🧹 Ordenar mis datos y los 3 botones grandes de Inicio (16/11/2026).
// El dueño anotaba los pagos mandándole a Claude «netgb117+liz · Oby pagó 69 · vence 15 dic». Ahora lo pega acá:
// ve qué se va a anotar (y un aviso si el nombre no coincide con el dueño de la cuenta) y toca «Confirmar».
// Todo «Me pagó» / «Renovar» del panel se puede deshacer por 30 minutos.
import { api, esc, bs, fdate, newKey, toast } from "/common.js";

let ctx = { render: () => {}, go: () => {}, tab: () => ({}) };
export function initRapido(c) { ctx = { ...ctx, ...c }; }
let last = null; // { text, key, actions }

/* ---------------- Inicio: 3 botones grandes + anotar rápido ---------------- */
export async function inicioTop() {
  const [ord, undo] = await Promise.all([api("GET", "/api/admin/ordenar").catch(() => null), api("GET", "/api/admin/undo-pay").catch(() => [])]);
  const n = ord?.total ?? 0;
  return `<section class="card qtop"><div class="qbig">
      <button class="qbtn" type="button" data-qgo="cobrar">💵<b>Cobrar hoy</b><small>a quién y cuánto</small></button>
      <button class="qbtn" type="button" data-qgo="hojas">📗<b>Mis hojas</b><small>como el Excel</small></button>
      <button class="qbtn${n ? " warn" : ""}" type="button" data-qgo="ordenar">🧹<b>Ordenar datos</b><small>${n ? `${n} pendiente${n === 1 ? "" : "s"}` : "todo en orden"}</small></button>
    </div></section>${rapidoCard(undo)}`;
}

export function rapidoCard(undo = []) {
  return `<section class="card qrap" id="qrap"><h2>✍️ Anotar rápido</h2>
    <p class="muted" style="margin:0 0 6px">Escribí o pegá como en WhatsApp: el correo de la cuenta, cuánto pagó y hasta cuándo. Primero te muestro qué se anota.</p>
    <textarea id="qrText" rows="3" placeholder="netgb117+liz@gmail.com · Oby pagó 69 · vence 15 diciembre" aria-label="Qué querés anotar"></textarea>
    <button class="pbtn green" type="button" data-qparse="1">👀 Ver qué se anota</button>
    <div id="qrPrev" aria-live="polite"></div>
    ${undo.length ? `<div class="qundo"><h3>↩️ Cobros recientes (se pueden deshacer)</h3>${undo.map((u) => `<div class="qurow"><span>${esc(u.label)}<small class="muted"> · quedan ${u.minutesLeft} min</small></span><button class="pbtn sm" type="button" data-qundo="${esc(u.assignmentId)}">↩️ Deshacer</button></div>`).join("")}</div>` : ""}
  </section>`;
}

function previewHtml(r) {
  if (r.notice) return `<p class="qnote">ℹ️ ${esc(r.notice)}</p>`;
  const rows = r.actions.map((x) => `<div class="qact${x.blockers.length ? " bad" : x.warnings.length || x.doubleCharge ? " warn" : ""}">
      <b>${esc(x.who.replace(/^[^·]*·\s*/, ""))}</b> <small class="muted">${esc(x.email)} · ${esc(x.product.replace(/\s*\(alquiler revendedores\)/i, ""))}</small>
      <div class="qline">💵 ${x.usd ? "su precio en US$" : esc(bs(x.amount))}${x.amountFromText ? "" : " <small class=\"muted\">(su precio de siempre)</small>"}${x.periods > 1 ? ` · ${x.periods} meses` : ""}
        · 📅 ${esc(fdate(x.from))} → <b>${esc(fdate(x.to))}</b>${x.toFromText ? "" : " <small class=\"muted\">(la que da el sistema)</small>"}</div>
      ${x.blockers.map((w) => `<div class="qerr">⛔ ${esc(w)}</div>`).join("")}
      ${x.warnings.map((w) => `<div class="qwarn">⚠️ ${esc(w)}</div>`).join("")}
      ${x.doubleCharge ? `<label class="qwarn"><input type="checkbox" data-qother="1"> ${esc(x.doubleCharge)} — tildá si es OTRO mes</label>` : ""}</div>`).join("");
  const ok = r.actions.filter((x) => !x.blockers.length).length;
  return `${r.unknown.length ? `<p class="qerr">⛔ No encontré ${r.unknown.length === 1 ? "esta cuenta" : "estas cuentas"} con alguien adentro: ${esc(r.unknown.join(", "))}</p>` : ""}${rows}
    ${ok ? `<button class="pbtn green big" type="button" data-qapply="1">✅ Confirmar y anotar${ok > 1 ? ` (${ok})` : ""}</button>` : ""}`;
}

/* ---------------- 🧹 Ordenar mis datos (pantalla) ---------------- */
export async function ordenarView() {
  const o = await api("GET", "/api/admin/ordenar");
  const sec = (id, title, n, body, open) => `<details class="card ordsec"${open ? " open" : ""} id="${id}"><summary><b>${title}</b> <span class="pp ${n ? "pp-warn" : "pp-ok"}">${n || "✓"}</span></summary>${body}</details>`;
  const notes = (a) => (a.notes ? `<small class="muted ordnote">${esc(a.notes)}</small>` : "");
  const pw = (a, free) => `<form class="ordf" data-ordpw="${esc(a.accountId)}"${free ? ` data-free="${esc(a.slots.map((s) => s.id).join(","))}"` : ""}>
      <input name="pw" autocomplete="off" placeholder="Clave nueva" aria-label="Clave nueva de ${esc(a.email)}" required minlength="4">
      <button class="pbtn${free ? " green" : ""}" type="submit">${free ? "Guardar y liberar" : "Guardar clave"}</button></form>`;
  const apart = o.apartadas.map((a) => `<div class="ordrow"><b class="mono">${esc(a.email)}</b> <small>${esc(a.product)} · ${a.slots.length} perfil${a.slots.length === 1 ? "" : "es"} apartado${a.slots.length === 1 ? "" : "s"}${a.passwordChangedAt ? ` · clave cambiada ${esc(fdate(a.passwordChangedAt))}` : ""}</small>${notes(a)}
      ${a.noFree ? `<p class="qwarn" style="margin:4px 0">⚠️ La nota dice que no se vende todavía: guardá la clave y liberala cuando corresponda.</p>${pw(a, false)}` : `${pw(a, true)}${a.passwordChangedAt ? `<button class="pbtn sm" type="button" data-ordfree="${esc(a.slots.map((s) => s.id).join(","))}">✅ Ya la cambié: liberar</button>` : ""}`}</div>`).join("");
  const sinClave = o.sinClave.slice(0, 40).map((a) => `<div class="ordrow"><b class="mono">${esc(a.email)}</b> <small>${esc(a.product)}</small>${notes(a)}${pw(a, false)}</div>`).join("");
  const sinFecha = o.sinFecha.slice(0, 40).map((a) => `<div class="ordrow"><b class="mono">${esc(a.email)}</b> <small>${esc(a.product)}</small>${notes(a)}
      <form class="ordf" data-orddate="${esc(a.accountId)}"><input name="d" type="date" required aria-label="Vence con el proveedor"><button class="pbtn" type="submit">Guardar fecha</button></form></div>`).join("");
  const correos = o.correos.map((a) => `<div class="ordrow"><b class="mono">${esc(a.email)}</b> <small>${esc(a.product)}</small>
      <form class="ordf" data-ordmail="${esc(a.accountId)}"><input name="em" type="email" value="${esc(a.suggestion)}" required aria-label="Correo bien escrito"><button class="pbtn" type="submit">Corregir</button></form></div>`).join("");
  const more = (l, n) => (l.length > n ? `<p class="muted">…y ${l.length - n} más. Se muestran de a ${n}.</p>` : "");
  return `<section class="card"><h2>🧹 Ordenar mis datos</h2><p class="muted" style="margin:0">Lo que le falta a tu tienda para trabajar sola. Cada cosa que arreglás desaparece de la lista. <b>${o.total}</b> pendiente${o.total === 1 ? "" : "s"}.</p></section>
    ${sec("ord-apart", "⏸️ Apartadas: cambiar la clave y liberar", o.apartadas.length, apart || `<p class="muted">Ninguna.</p>`, true)}
    ${sec("ord-clave", "🔑 Cuentas sin clave guardada", o.sinClave.length, (sinClave || `<p class="muted">Ninguna.</p>`) + more(o.sinClave, 40))}
    ${sec("ord-fecha", "📅 Sin fecha del proveedor", o.sinFecha.length, (sinFecha || `<p class="muted">Ninguna.</p>`) + more(o.sinFecha, 40))}
    ${sec("ord-mail", "✉️ Correos mal escritos", o.correos.length, correos || `<p class="muted">Ninguno.</p>`)}
    ${sec("ord-gmail", "📬 Gmail para los códigos", o.gmail.total ? 0 : 1, `<p>${o.gmail.total ? `Tenés ${o.gmail.total} correo${o.gmail.total === 1 ? "" : "s"} conectado${o.gmail.total === 1 ? "" : "s"} (${o.gmail.connected} sin error).` : "Todavía no conectaste ningún Gmail: sin eso, los códigos no les llegan a tus revendedores."}</p><button class="pbtn" type="button" data-go="codigos">Ir al Panel de códigos</button>`)}`;
}

/* ---------------- ↩️ barra «Deshacer» después de cada cobro ---------------- */
function undoBar(id) {
  document.getElementById("qUndoBar")?.remove();
  const el = document.createElement("div");
  el.id = "qUndoBar"; el.className = "qundobar"; el.setAttribute("role", "status");
  el.innerHTML = `<span>✅ Cobro anotado</span><button class="pbtn sm" type="button" data-qundo="${esc(id)}">↩️ Deshacer</button><button class="pbtn sm" type="button" data-qundoclose="1" aria-label="Cerrar">✕</button>`;
  (document.getElementById("app") ?? document.body).appendChild(el);
  clearTimeout(undoBar.t); undoBar.t = setTimeout(() => el.remove(), 90_000);
}

if (typeof window !== "undefined") {
  window.addEventListener("gs-paid", (ev) => { if (ev.detail?.id) undoBar(ev.detail.id); });
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest?.("[data-qgo], [data-qparse], [data-qapply], [data-qundo], [data-qundoclose], [data-ordfree]");
    if (!b) return;
    const d = b.dataset;
    if (d.qgo === "cobrar") { const t = ctx.tab(); t.tbf = "urgente"; return ctx.go("tablero"); }
    if (d.qgo) return ctx.go(d.qgo);
    if (d.qundoclose) return document.getElementById("qUndoBar")?.remove();
    if (d.qparse) {
      const text = document.getElementById("qrText")?.value ?? "";
      b.disabled = true;
      try {
        const r = await api("POST", "/api/admin/quick/parse", { text });
        last = { text, key: newKey(), r };
        document.getElementById("qrPrev").innerHTML = previewHtml(r);
      } catch (e) { document.getElementById("qrPrev").innerHTML = `<p class="qerr">⛔ ${esc(e.message)}</p>`; }
      b.disabled = false;
      return;
    }
    if (d.qapply && last) {
      b.disabled = true;
      const confirmOther = !!document.querySelector("#qrPrev [data-qother]:checked");
      try {
        const r = await api("POST", "/api/admin/quick/apply", { text: last.text, key: last.key, confirmOther });
        last = null;
        if (r.failed.length) toast(`⚠️ ${r.failed.map((x) => x.error).join(" · ")}`);
        if (r.done.length) { toast(`✅ Anotado: ${r.done.map((x) => x.label).join(" · ")}`); undoBar(r.done[r.done.length - 1].assignmentId); }
        await ctx.render();
      } catch (e) { b.disabled = false; toast(e.message); }
      return;
    }
    if (d.qundo) {
      if (!confirm("¿Deshacer ese cobro?\n\nEl alquiler vuelve exactamente a como estaba antes (fecha, pago y aviso).")) return;
      b.disabled = true;
      try {
        const r = await api("POST", `/api/admin/assignments/${encodeURIComponent(d.qundo)}/undo-pay`, {});
        document.getElementById("qUndoBar")?.remove();
        toast(`↩️ Deshecho: ${r.label} · vuelve a vencer el ${fdate(r.expiresAt)}`);
        await ctx.render();
      } catch (e) { b.disabled = false; toast(e.message); }
      return;
    }
    if (d.ordfree) {
      if (!confirm("¿Liberar esa cuenta para vender?\n\nHacelo solo si ya le cambiaste la clave.")) return;
      try { for (const id of d.ordfree.split(",")) await api("POST", `/api/admin/slots/${id}/status`, { status: "available", note: "Liberada desde Ordenar mis datos" }); toast("✅ Liberada: ya se puede vender"); await ctx.render(); } catch (e) { toast(e.message); }
    }
  });
  document.addEventListener("submit", async (ev) => {
    const f = ev.target.closest?.(".ordf");
    if (!f) return;
    ev.preventDefault(); ev.stopImmediatePropagation();
    const btn = f.querySelector("[type=submit]"); btn.disabled = true;
    try {
      if (f.dataset.ordpw) {
        await api("POST", `/api/admin/accounts/${f.dataset.ordpw}/password`, { password: f.pw.value });
        if (f.dataset.free) for (const id of f.dataset.free.split(",")) await api("POST", `/api/admin/slots/${id}/status`, { status: "available", note: "Clave cambiada desde Ordenar mis datos" });
        toast(f.dataset.free ? "✅ Clave guardada y cuenta libre para vender" : "🔑 Clave guardada");
      } else if (f.dataset.orddate) {
        const [y, m, dd] = f.d.value.split("-").map(Number);
        await api("POST", `/api/admin/accounts/${f.dataset.orddate}`, { supplierExpiresAt: new Date(y, m - 1, dd, 23, 59).getTime() });
        toast(`📅 Fecha guardada: ${dd}/${m}/${y}`);
      } else if (f.dataset.ordmail) {
        await api("POST", `/api/admin/accounts/${f.dataset.ordmail}`, { email: f.em.value.trim() });
        toast("✉️ Correo corregido");
      }
      await ctx.render();
    } catch (e) { btn.disabled = false; toast(e.message); }
  }, true);
}
