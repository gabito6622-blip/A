// Link de cobro (/c/<token>), 17/11/2026: los datos de pago ESCRITOS del revendedor (banco, a nombre de…) y
// «📤 Subir comprobante». El comprobante queda «En revisión» hasta que EL REVENDEDOR lo aprueba en su GaboHub.
// Nada se cobra solo y la tienda no lo ve. Si su plan no incluye links, solo se muestra «mandalo por WhatsApp».
import { fileToBase64 } from "/common.js";

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const ddmm = (t) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };

function stateHtml(p) {
  if (!p) return "";
  if (p.status === "review") return `<p class="pill p-warn" role="status">⏳ Comprobante en revisión (mandado el ${ddmm(p.at)}). Te avisan apenas lo miren.</p>`;
  if (p.status === "approved") return `<p class="pill p-ok" role="status">✅ Pago confirmado</p>`;
  return `<p class="pill p-bad" role="status">✕ No se aceptó tu comprobante${p.reason ? `: ${esc(p.reason)}` : ""}. Podés subir otro.</p>`;
}

/** Agrega la tarjeta debajo del monto (o al final). `who` = nombre de quien vende. */
export async function mountComprobante(app, token, who) {
  if (!app.querySelector(".amount")) return; // al día: no hay nada para pagar
  const r = await fetch(`/api/cobro/${encodeURIComponent(token)}/pago`, { credentials: "omit" });
  if (!r.ok) return;
  const v = await r.json();
  const I = v.payInfo;
  const box = document.createElement("section");
  box.className = "card cpago"; box.setAttribute("aria-label", "Datos para pagar y comprobante");
  const draw = (p) => {
    const canUp = v.upload && (!p || p.status === "rejected");
    box.innerHTML = `${I ? `<h2 class="ch2">🏦 Datos para pagar</h2><dl>${I.bank ? `<dt>Banco</dt><dd>${esc(I.bank)}</dd>` : ""}${I.holder ? `<dt>A nombre de</dt><dd>${esc(I.holder)}</dd>` : ""}${I.account ? `<dt>Cuenta</dt><dd>${esc(I.account)}</dd>` : ""}</dl>${I.note ? `<p class="muted">${esc(I.note)}</p>` : ""}` : ""}
      ${stateHtml(p)}
      ${canUp ? `<form class="cup" novalidate><label for="cfile"><b>📤 ¿Ya pagaste? Subí la foto del comprobante</b></label>
        <input id="cfile" name="file" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" required aria-describedby="cerr">
        <p id="cerr" class="cerr" aria-live="polite"></p>
        <button class="btn btn-ghost" type="submit">Mandar comprobante a ${esc(who)}</button>
        <p class="muted">Lo revisa ${esc(who)}. Nada se cobra solo.</p></form>` : ""}`;
    box.querySelector("form")?.addEventListener("submit", async (ev) => {
      ev.preventDefault();
      const f = ev.currentTarget, out = f.querySelector(".cerr"), btn = f.querySelector("button");
      out.textContent = "";
      btn.disabled = true; btn.textContent = "Mandando…";
      try {
        const contentBase64 = await fileToBase64(f.file.files[0]);
        const res = await fetch(`/api/cobro/${encodeURIComponent(token)}/comprobante`, { method: "POST", credentials: "omit", headers: { "content-type": "application/json" }, body: JSON.stringify({ contentBase64 }) });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error(j.message || "No se pudo mandar. Probá de nuevo.");
        draw({ status: "review", at: Date.now() });
        box.querySelector('[role="status"]')?.focus?.();
      } catch (e) { out.textContent = e.message; btn.disabled = false; btn.textContent = `Mandar comprobante a ${who}`; }
    });
  };
  if (!I && !v.upload && !v.proof) return;
  draw(v.proof);
  const after = app.querySelector(".qr") ?? app.querySelector(".amount");
  after.after(box);
}
