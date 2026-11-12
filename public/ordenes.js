// 🗣️ "Decile qué hacer": la caja de Inicio donde el dueño (o un admin) le da órdenes a Sofi, su secretaria.
// La charla vive en esta pestaña (no se guarda en el celular). Lo que cambia algo siempre trae
// "✅ Hacerlo / ✖️ Cancelar"; nada se manda solo: el WhatsApp es un link wa.me que tocás vos.
import { api, esc, toast, waLink } from "/common.js";

if (typeof document !== "undefined" && !document.querySelector('link[href="/ordenes.css"]')) {
  const l = document.createElement("link");
  l.rel = "stylesheet"; l.href = "/ordenes.css";
  document.head.appendChild(l);
}

const SUGGEST = ["¿Qué perfil de Disney tengo libre?", "¿Quién vence mañana?", "¿Quién me debe?", "¿Qué te puedo pedir?"];
/** La charla de esta pestaña: { who: "yo" | "sofi", r: respuesta del servidor | texto }. */
const S = { log: [], busy: false, on: false };
const hhmm = (t) => new Intl.DateTimeFormat("es-BO", { hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(new Date(t));

function sofiBody(m) {
  const r = m.r;
  let h = `<p class="oc-t">${esc(r.text)}</p>`;
  if (r.lines?.length) h += `<ul class="oc-lines">${r.lines.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
  if (r.kind === "choose" && r.choices?.length) {
    h += m.picked ? `<p class="oc-note">Elegiste: <b>${esc(m.picked)}</b></p>`
      : `<div class="oc-btns">${r.choices.map((c) => `<button type="button" class="pbtn" data-ocpick="${esc(c.value)}" data-ocdraft="${esc(r.draft)}" data-oclabel="${esc(c.label)}">${esc(c.label)}</button>`).join("")}</div>`;
  }
  if (r.kind === "plan" && r.plan) {
    h += `<div class="oc-plan"><b>Voy a hacer esto:</b><ul class="oc-lines">${r.plan.lines.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>`;
    if (m.state === "done") h += `<p class="oc-ok">${esc(m.done)}</p>${m.wa ? `<a class="pbtn green" href="${esc(m.wa)}" target="_blank" rel="noopener">💬 Mandarle sus datos por WhatsApp</a>` : m.noPhone ? `<p class="oc-note">No tiene WhatsApp cargado: mandale los datos por donde puedas.</p>` : ""}`;
    else if (m.state === "cancelled") h += `<p class="oc-note">✖️ Cancelado: no hice nada.</p>`;
    else if (m.state === "error") h += `<p class="oc-err" role="alert">${esc(m.err)}</p>`;
    else h += `<div class="oc-btns"><button type="button" class="pbtn green" data-occonfirm="${esc(r.plan.id)}">✅ Hacerlo</button><button type="button" class="pbtn" data-occancel="${esc(r.plan.id)}">✖️ Cancelar</button></div>
      <small class="oc-note">Vale por 10 minutos.</small>`;
    h += `</div>`;
  }
  if (r.account) {
    h += m.secret ? `<p class="oc-secret">🔑 Contraseña: <b class="sel">${esc(m.secret.password)}</b>${m.secret.pin ? `<br>🔢 PIN: <b class="sel">${esc(m.secret.pin)}</b>` : ""}</p>`
      : `<div class="oc-btns"><button type="button" class="pbtn" data-ocsecret="${esc(r.account.accountId)}" data-ocslot="${esc(r.account.slotId ?? "")}">👁️ Ver contraseña</button></div>`;
    if (r.account.assignmentId) h += m.wa ? `<a class="pbtn green" href="${esc(m.wa)}" target="_blank" rel="noopener">💬 Mandarle sus datos por WhatsApp</a>`
      : `<div class="oc-btns"><button type="button" class="pbtn" data-ocwa="${esc(r.account.assignmentId)}">💬 Armar mensaje de WhatsApp</button></div>`;
  }
  if (r.kind === "help" || r.suggestions?.length) {
    const sug = (r.suggestions ?? []).filter((x) => x !== "Abrir Fiado");
    if (sug.length) h += `<div class="oc-chips">${sug.map((x) => `<button type="button" class="oc-chip" data-ocsay="${esc(x)}">${esc(x)}</button>`).join("")}</div>`;
    if (r.suggestions?.includes("Abrir Fiado")) h += `<div class="oc-btns"><button type="button" class="pbtn" data-go="fiado">💸 Abrir Fiado</button></div>`;
  }
  return h;
}

function logHtml() {
  if (!S.log.length) return `<p class="oc-empty">Hola 👋 Soy Sofi. Decime qué hago: vender, renovar, pasarle un perfil a otro cliente, buscar un código o ver quién te debe. Lo que cambia algo te lo pregunto antes.</p>`;
  return S.log.map((m) => m.who === "yo"
    ? `<div class="oc-msg oc-yo"><div class="oc-bub"><p class="oc-t">${esc(m.text)}</p><time>${hhmm(m.at)}</time></div></div>`
    : `<div class="oc-msg oc-sofi"><span class="oc-av" aria-hidden="true">🗂️</span><div class="oc-bub">${m.r ? sofiBody(m) : `<p class="oc-t${m.err ? " oc-err" : ""}">${esc(m.text)}</p>`}${m.busy ? "" : `<time>${hhmm(m.at)}</time>`}</div></div>`).join("");
}

/** Tarjeta de Inicio. `ai` es lo que devuelve /api/admin/ai. */
export function ordenesCard(ai, owner) {
  if (!ai) return "";
  S.on = !!(ai.hasKey && ai.enabled?.commands);
  if (!S.on) {
    const why = !ai.hasKey ? "Necesita la clave de Claude (se carga una sola vez)." : "Está apagada.";
    return `<section class="card oc-card oc-off"><h2>🗣️ Decile qué hacer <small>Sofi, tu secretaria</small></h2>
      <p class="muted" style="margin:0">Le escribís o le dictás “vendele un Disney a Ana, me pagó por QR” o “dame el código de la Netflix de Rodrigo”, y lo hace. Lo que cambia algo te lo pregunta antes. ${why}</p>
      ${owner ? `<button type="button" class="pbtn dark" data-go="configuracion">▶ Prender a Sofi en Configuración</button>` : `<p class="muted" style="margin:0">Pedile al dueño que la prenda.</p>`}</section>`;
  }
  return `<section class="card oc-card" id="ocCard"><h2>🗣️ Decile qué hacer <small>Sofi, tu secretaria</small></h2>
    <div class="oc-log" id="ocLog" aria-live="polite">${logHtml()}</div>
    <div class="oc-chips" id="ocSug"${S.log.length ? " hidden" : ""}>${SUGGEST.map((x) => `<button type="button" class="oc-chip" data-ocsay="${esc(x)}">${esc(x)}</button>`).join("")}</div>
    <form class="oc-form" id="ocForm" autocomplete="off">
      <label class="oc-lbl" for="ocText">Tu orden para Sofi</label>
      <textarea id="ocText" name="t" rows="2" maxlength="500" required placeholder="🗣️ Decile qué hacer… Ej.: vendele un Disney a Ana, me pagó por QR"></textarea>
      <button class="pbtn dark" type="submit">Enviar</button>
    </form>
    <small class="muted">Podés dictar con el micrófono del teclado. No hace falta escribir perfecto.</small></section>`;
}

function paint() {
  const el = document.getElementById("ocLog");
  if (!el) return;
  el.innerHTML = logHtml();
  el.scrollTop = el.scrollHeight;
  // Las sugerencias de arriba solo antes de empezar: después la caja queda corta (la ayuda trae las suyas).
  const sug = document.getElementById("ocSug");
  if (sug) sug.hidden = S.log.length > 0;
}
const errText = (e) => (e.status === 429 ? e.message : e.status === 401 ? "Tu sesión venció. Entrá de nuevo." : e.message || "No pude hacerlo. Probá de nuevo.");

async function send(body, mine) {
  if (S.busy) return;
  S.busy = true;
  if (mine) S.log.push({ who: "yo", text: mine, at: Date.now() });
  const wait = { who: "sofi", text: "Pensando…", busy: true, at: Date.now() };
  S.log.push(wait); paint();
  try {
    const r = await api("POST", "/api/admin/command", body);
    Object.assign(wait, { r, busy: false, text: r.text, at: Date.now() });
  } catch (e) {
    Object.assign(wait, { text: errText(e), err: true, busy: false, at: Date.now() });
  } finally { S.busy = false; paint(); }
}

/** Arma el link wa.me con el mensaje de entrega que ya existe (el mismo de "Mandar acceso"). */
async function waFor(ids) {
  const infos = [];
  for (const id of ids) { const x = await api("GET", `/api/admin/assignments/${encodeURIComponent(id)}/delivery`).catch(() => null); if (x) infos.push(x); }
  if (!infos.length || !infos[0].customerPhone) return null;
  return waLink(infos[0].customerPhone, infos.map((x) => x.message).join("\n\n"));
}

const findMsg = (attr, v) => S.log.find((m) => m.r && ((attr === "plan" && m.r.plan?.id === v) || (attr === "draft" && m.r.draft === v) || (attr === "acc" && m.r.account?.accountId === v)));

if (typeof document !== "undefined") {
  document.addEventListener("submit", (ev) => {
    const f = ev.target;
    if (f.id !== "ocForm") return;
    ev.preventDefault();
    const t = f.t.value.trim();
    if (!t) return;
    f.t.value = "";
    send({ text: t }, t);
  });
  // Enter manda (Shift+Enter hace salto de línea), como en cualquier chat.
  document.addEventListener("keydown", (ev) => {
    if (ev.target?.id === "ocText" && ev.key === "Enter" && !ev.shiftKey && !ev.isComposing) { ev.preventDefault(); ev.target.form.requestSubmit(); }
  });
  document.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-ocsay],[data-ocpick],[data-occonfirm],[data-occancel],[data-ocsecret],[data-ocwa]");
    if (!b || !document.getElementById("ocCard")) return;
    const d = b.dataset;
    if (d.ocsay) return send({ text: d.ocsay }, d.ocsay);
    if (d.ocpick) {
      const m = findMsg("draft", d.ocdraft);
      if (m) m.picked = d.oclabel;
      return send({ draft: d.ocdraft, pick: d.ocpick, label: d.oclabel }, d.oclabel);
    }
    if (d.occonfirm || d.occancel) {
      const id = d.occonfirm || d.occancel, m = findMsg("plan", id);
      if (!m || m.state) return;
      b.disabled = true;
      try {
        if (d.occancel) { await api("POST", `/api/admin/command/${encodeURIComponent(id)}/cancel`, {}); m.state = "cancelled"; }
        else {
          const r = await api("POST", `/api/admin/command/${encodeURIComponent(id)}/confirm`, {});
          Object.assign(m, { state: "done", done: r.text, noPhone: !r.hasPhone });
          if (r.hasPhone && r.assignmentIds?.length) m.wa = await waFor(r.assignmentIds);
          toast(r.text);
        }
      } catch (e) { Object.assign(m, { state: "error", err: errText(e) }); }
      return paint();
    }
    if (d.ocsecret) {
      const m = findMsg("acc", d.ocsecret);
      b.disabled = true;
      try { const s = await api("POST", "/api/admin/command/secret", { accountId: d.ocsecret, ...(d.ocslot ? { slotId: d.ocslot } : {}) }); if (m) m.secret = s; }
      catch (e) { toast(errText(e)); b.disabled = false; return; }
      return paint();
    }
    if (d.ocwa) {
      const m = S.log.find((x) => x.r?.account?.assignmentId === d.ocwa);
      b.disabled = true;
      const link = await waFor([d.ocwa]).catch(() => null);
      if (!link) { toast("No tiene WhatsApp cargado: copiá los datos y mandáselos por donde puedas."); b.disabled = false; return; }
      if (m) m.wa = link;
      return paint();
    }
  });
}
