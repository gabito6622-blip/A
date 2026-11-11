// "🔔 Avisarme antes de que venza" en el link de cobro (/c/<token>): el cliente sin cuenta activa los avisos
// en su celular y quedan atados a ESTE link (sin entrar con usuario). Si el revendedor cambia el link o borra
// el perfil, los avisos se apagan solos. cobro.js solo llama a mountAlerts(); la lógica está acá.
import { cantText, currentSub, ensureManifest, pushOk, subscribeHere } from "/avisos.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const post = async (token, body) => {
  const r = await fetch(`/api/cobro/${encodeURIComponent(token)}/alerts`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(r.status === 404 ? "Este link ya no sirve." : j.message || "No pudimos cambiar los avisos. Probá de nuevo.");
  return j;
};

/** Agrega la tarjeta de avisos al final de la página. `v` es la vista pública (solo usa `alerts`). */
export async function mountAlerts(root, token, v) {
  // El link se puede instalar como app (sobre todo en iPhone, donde los avisos solo andan así).
  ensureManifest("/cobro.webmanifest");
  let cfg = null;
  try { const r = await fetch(`/api/cobro/${encodeURIComponent(token)}/alerts`, { credentials: "omit" }); cfg = r.ok ? await r.json() : null; } catch { /* sin conexión */ }
  if (!cfg?.configured) return; // la tienda todavía no prendió los avisos al celular: no mostramos nada
  const box = document.createElement("section");
  box.className = "card avisos";
  box.setAttribute("aria-label", "Avisos antes de que venza");
  root.append(box);
  const S = { on: false, busy: false, err: "" };
  const sub = v?.alerts ? await currentSub() : null;
  if (sub) S.on = !!(await post(token, { action: "check", endpoint: sub.endpoint }).catch(() => ({ on: false }))).on;

  const draw = () => {
    const cant = cantText("este link");
    box.innerHTML = `<b style="font-size:17px">🔔 Avisarme antes de que venza</b>
      <p class="muted">Te llega un aviso a este celular 3 días antes, 1 día antes y el día que vence. Gratis y sin WhatsApp.</p>
      ${S.on ? `<p class="muted" style="color:var(--ok);font-weight:700">✅ Listo: te vamos a avisar en este celular.</p><button class="btn btn-ghost" type="button" data-av="off" ${S.busy ? "disabled" : ""}>Dejar de avisarme</button>`
        : cant && !pushOk() ? `<p class="muted">${esc(cant)}</p>`
        : `<button class="btn btn-ghost" type="button" data-av="on" ${S.busy ? "disabled" : ""}>🔔 Avisarme antes de que venza</button>${cant ? `<p class="muted" role="alert" style="color:var(--bad)">${esc(cant)}</p>` : ""}`}
      ${S.err ? `<p class="muted" role="alert" style="color:var(--bad)">${esc(S.err)}</p>` : ""}`;
  };
  box.addEventListener("click", async (ev) => {
    const b = ev.target.closest("[data-av]");
    if (!b || S.busy) return;
    S.busy = true; S.err = ""; draw();
    try {
      if (b.dataset.av === "on") {
        const s = await subscribeHere(cfg.publicKey);
        await post(token, { action: "on", subscription: s.toJSON() });
        S.on = true;
      } else {
        const s = await currentSub();
        if (s) await post(token, { action: "off", endpoint: s.endpoint });
        S.on = false; // el navegador queda suscripto para otros links: solo dejamos de usarlo para este
      }
    } catch (e) { S.err = e.message || "No pudimos cambiar los avisos. Probá de nuevo."; }
    S.busy = false; draw();
    box.querySelector("[data-av]")?.focus();
  });
  draw();
}
