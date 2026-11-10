// Código de la página /recuperar (antes estaba dentro del HTML; afuera para respetar la CSP).
const $ = (s) => document.querySelector(s);
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const token = new URLSearchParams(location.search).get("t") || "";

async function api(method, path, body) {
  const r = await fetch(path, { method, headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw Object.assign(new Error(j.message || "Algo salió mal"), { status: r.status, code: j.code });
  return j;
}

function fail(msg) {
  $("#app").innerHTML = `<div class="card"><h1>Enlace no válido</h1><p class="muted">${esc(msg)}</p><a class="btn" href="/">Ir a la tienda</a></div>`;
}

function done(email) {
  $("#app").innerHTML = `<div class="card"><h1>¡Listo! 🎉</h1><div class="ok">Ya cambiaste tu contraseña${email ? ` de <b>${esc(email)}</b>` : ""}.</div><p class="muted">Ya entraste. Volvé a la tienda para comprar y ver tus cuentas.</p><a class="btn" href="/">Entrar a la tienda</a></div>`;
}

function form(info) {
  $("#app").innerHTML = `<div><h1>Nueva contraseña</h1><p class="muted">Hola <span class="who">${esc((info.name || "").split(" ")[0] || "")}</span>, elegí una contraseña nueva para <b>${esc(info.email)}</b>.</p></div>
    <form class="card" id="f">
      <label>Contraseña nueva (mínimo 8)<input name="password" type="password" required minlength="8" autocomplete="new-password" placeholder="••••••••"></label>
      <label>Repetir contraseña<input name="confirm" type="password" required minlength="8" autocomplete="new-password" placeholder="••••••••"></label>
      <p class="err" id="e"></p>
      <button type="submit">Guardar contraseña</button>
    </form>`;
  $("#f input")?.focus();
  $("#f").addEventListener("submit", async (ev) => {
    ev.preventDefault();
    const f = ev.target;
    if (f.password.value !== f.confirm.value) return ($("#e").textContent = "Las dos contraseñas no coinciden");
    if (f.password.value.length < 8) return ($("#e").textContent = "Necesita al menos 8 caracteres");
    const btn = f.querySelector("button");
    btn.disabled = true;
    try { await api("POST", "/api/auth/customer/reset", { token, password: f.password.value }); done(info.email); }
    catch (e) { btn.disabled = false; $("#e").textContent = e.message; }
  });
}

(async () => {
  if (!token) return fail("El enlace está incompleto. Pedí uno nuevo desde «Olvidé mi contraseña».");
  try {
    const info = await api("GET", `/api/auth/customer/reset/${encodeURIComponent(token)}`);
    form(info);
  } catch (e) {
    fail(e.message || "El enlace venció o ya se usó. Pedí uno nuevo.");
  }
})();
