// Código de la página /codigos (antes estaba dentro del HTML; afuera para respetar la CSP).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const KLABEL = { login: "🔓 Código de inicio de sesión", hogar: "🏠 Actualizar hogar", temporal: "⏱️ Código de acceso temporal", verificacion: "🛡️ Código de verificación", otro: "✉️ Código" };
const token = location.pathname.split("/").filter(Boolean)[1];
const KEY = "gh-pin-" + token;
const EKEY = "gh-mail-" + token;
let pin = null, email = null, mode = "pin", name = "", timer = null, q = "", last = [], minutes = 30, platforms = [];
/** Las plataformas reales de sus cuentas (Netflix, Disney+, Max…), no siempre «Disney+». */
const plat = (fallback = "tus cuentas") => !platforms.length ? fallback : platforms.length === 1 ? platforms[0] : `${platforms.slice(0, -1).join(", ")} y ${platforms[platforms.length - 1]}`;
const keep = (data) => { if (Array.isArray(data?.platforms)) platforms = data.platforms; };

async function call(method, body) {
  const r = await fetch(`/api/code-link/${encodeURIComponent(token)}`, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || "Error"), { status: r.status });
  return j;
}

function askEmail(msg = "") {
  clearInterval(timer);
  $("#app").innerHTML = `<div><h1>📺 ${esc(name)}</h1><p class="muted">Escribí el correo de tu cuenta y mirá tu código al toque.</p></div>
    <form class="card" id="fe"><label style="display:grid;gap:8px;color:var(--muted);font-weight:600;font-size:14px">Correo de tu cuenta
      <input class="search" id="em" type="email" inputmode="email" autocomplete="email" autocapitalize="off" placeholder="tucuenta@correo.com" value="${esc(email || "")}" required></label>
    <p class="err" id="e">${esc(msg)}</p><button type="submit">Ver mi código</button></form>
    <p class="muted" style="text-align:center">El código sirve solo con tu contraseña. Si no aparece, pedilo en ${esc(plat("la app"))} y esperá unos segundos.</p>`;
  $("#em").focus();
  $("#fe").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const v = $("#em").value.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) return ($("#e").textContent = "Escribí un correo válido");
    try { await loadEmail(v); email = v; try { sessionStorage.setItem(EKEY, v); } catch { /* */ } }
    catch (e) { $("#e").textContent = e.message; }
  });
}

function askPin(msg = "") {
  clearInterval(timer);
  $("#app").innerHTML = `<div><h1>🔐 ${esc(name)}</h1><p class="muted">Códigos de acceso de ${esc(plat())}. Escribí el PIN de 4 números.</p></div>
    <form class="card" id="f"><div class="pin">${[0, 1, 2, 3].map((i) => `<input inputmode="numeric" maxlength="1" pattern="[0-9]" autocomplete="off" aria-label="Número ${i + 1} del PIN" data-i="${i}">`).join("")}</div>
    <p class="err" id="e">${esc(msg)}</p><button type="submit">Ver mis códigos</button></form>`;
  const ins = [...document.querySelectorAll(".pin input")];
  ins[0].focus();
  ins.forEach((el, i) => {
    el.addEventListener("input", () => { el.value = el.value.replace(/\D/g, "").slice(-1); if (el.value && i < 3) ins[i + 1].focus(); if (ins.every((x) => x.value)) $("#f").requestSubmit(); });
    el.addEventListener("keydown", (ev) => { if (ev.key === "Backspace" && !el.value && i) ins[i - 1].focus(); });
    el.addEventListener("paste", (ev) => { const t = (ev.clipboardData?.getData("text") ?? "").replace(/\D/g, "").slice(0, 4); if (t.length === 4) { ev.preventDefault(); t.split("").forEach((d, k) => (ins[k].value = d)); $("#f").requestSubmit(); } });
  });
  $("#f").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const p = ins.map((x) => x.value).join("");
    if (!/^\d{4}$/.test(p)) return ($("#e").textContent = "Completá los 4 números");
    try { await load(p); pin = p; try { sessionStorage.setItem(KEY, p); } catch { /* */ } }
    catch (e) { ins.forEach((x) => (x.value = "")); ins[0].focus(); $("#e").textContent = e.message; }
  });
}

function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  return s < 60 ? "recién" : `hace ${Math.round(s / 60)} min`;
}

function show(data) {
  keep(data);
  last = data.codes; minutes = data.minutes ?? minutes;
  const list = last.filter((c) => !q || c.to.includes(q.toLowerCase()));
  const keepFocus = document.activeElement?.id === "q"; // otro nombre: «keep» ya es la función de arriba (antes chocaba y el modo PIN tiraba error)
  $("#app").innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h1>${esc(data.name)}</h1><span class="live"><i></i>Se actualiza solo</span></div>
    <p class="muted">Acá aparecen los códigos de ${esc(plat())}${platforms.length ? " de tus cuentas" : ""}. Cada uno dura ${data.minutes} minutos.</p>
    ${last.length > 3 ? `<input class="search" id="q" placeholder="Buscar por correo de la cuenta" value="${esc(q)}" inputmode="email">` : ""}
    <div class="card">${list.length ? list.map((c) => `<div class="code"><div class="top"><span class="ktag k-${esc(c.kind || "otro")}">${KLABEL[c.kind] || "Código"}</span><small>${ago(c.receivedAt)}</small></div>
      <div class="top"><small>${esc(c.product || c.to)}</small></div>
      ${c.code ? `<b class="v">${esc(c.code)}</b>` : ""}<small class="ksub">${esc(c.subject)}</small>
      <div class="row">${c.code ? `<button type="button" data-copy="${esc(c.code.replace(/\D/g, ""))}">Copiar código</button>` : ""}${c.link ? `<a class="btn ghost" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Abrir enlace</a>` : ""}</div></div>`).join("")
      : `<div class="empty">📭 No hay códigos nuevos.<br>Pedí el código en ${esc(plat("la app"))} y esperá unos segundos: aparece solo acá.</div>`}</div>
    <button class="ghost" type="button" id="out">Salir</button>`;
  if (keepFocus) { const f = $("#q"); f.focus(); f.setSelectionRange(f.value.length, f.value.length); }
}

async function load(p) {
  const data = await call("POST", { pin: p });
  show(data);
  clearInterval(timer);
  timer = setInterval(async () => {
    if (document.hidden) return;
    try { show(await call("POST", { pin })); } catch (e) { if (e.status === 401) { try { sessionStorage.removeItem(KEY); } catch { /* */ } askPin("El PIN cambió. Escribilo de nuevo."); } }
  }, 10_000);
}

function showEmail(data) {
  keep(data);
  last = data.codes; minutes = data.minutes ?? minutes;
  $("#app").innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;gap:10px;flex-wrap:wrap"><h1>${esc(data.name)}</h1><span class="live"><i></i>Se actualiza solo</span></div>
    <p class="muted">Código de <b>${esc(data.email || email)}</b>. Cada uno dura ${data.minutes} minutos.</p>
    <div class="card">${last.length ? last.map((c) => `<div class="code"><div class="top"><span class="ktag k-${esc(c.kind || "otro")}">${KLABEL[c.kind] || "Código"}</span><small>${ago(c.receivedAt)}</small></div>
      ${c.code ? `<b class="v">${esc(c.code)}</b>` : ""}<small class="ksub">${esc(c.subject)}</small>
      <div class="row">${c.code ? `<button type="button" data-copy="${esc(c.code.replace(/\D/g, ""))}">Copiar código</button>` : ""}${c.link ? `<a class="btn ghost" href="${esc(c.link)}" target="_blank" rel="noopener noreferrer">Abrir enlace</a>` : ""}</div></div>`).join("")
      : `<div class="empty">📭 Todavía no hay código nuevo para ese correo.<br>Pedí el código en ${esc(plat("la app"))} y esperá unos segundos: aparece solo acá.</div>`}</div>
    <button class="ghost" type="button" id="chg">Usar otro correo</button>`;
}

async function loadEmail(v) {
  const data = await call("POST", { email: v });
  email = v; showEmail(data);
  clearInterval(timer);
  timer = setInterval(async () => {
    if (document.hidden) return;
    try { showEmail(await call("POST", { email })); } catch { /* reintenta luego */ }
  }, 20_000);
}

document.addEventListener("click", async (ev) => {
  const b = ev.target.closest("button");
  if (!b) return;
  if (b.dataset.copy) { try { await navigator.clipboard.writeText(b.dataset.copy); b.textContent = "¡Copiado! ✓"; } catch { b.textContent = b.dataset.copy; } setTimeout(() => (b.textContent = "Copiar código"), 1500); }
  if (b.id === "out") { try { sessionStorage.removeItem(KEY); } catch { /* */ } pin = null; askPin(); }
  if (b.id === "chg") { try { sessionStorage.removeItem(EKEY); } catch { /* */ } email = null; clearInterval(timer); askEmail(); }
});
document.addEventListener("input", (ev) => { if (ev.target.id === "q") { q = ev.target.value.trim(); show({ name, codes: last, minutes, platforms }); } });

(async () => {
  let info;
  try { info = await call("GET"); name = info.name; mode = info.mode || "pin"; keep(info); } catch (e) { $("#app").innerHTML = `<div class="card"><h1>Link no válido</h1><p class="muted">${esc(e.message)}. Pedile el link nuevo a tu proveedor.</p></div>`; return; }
  document.title = `Códigos · ${name}`;
  if (mode === "email") {
    let saved = null;
    try { saved = sessionStorage.getItem(EKEY); } catch { /* */ }
    if (saved) { try { await loadEmail(saved); return; } catch { /* pedir de nuevo */ } }
    askEmail();
    return;
  }
  let saved = null;
  try { saved = sessionStorage.getItem(KEY); } catch { /* */ }
  if (saved) { try { await load(saved); pin = saved; return; } catch { /* pedir de nuevo */ } }
  askPin();
})();
