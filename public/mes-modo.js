// 📅 «¿Cómo contás un mes?» (pedido del dueño, 14/11/2026: «Sería mejor que cada quien decida, porque yo doy de mes a
// mes, pero otros revendedores sí hacen 30 días»). Dos opciones, en el panel (la tienda) y en GaboHub (cada revendedor,
// para SUS clientes). El servidor guarda y decide (src/store/mesModo.ts); acá solo se elige.
import { api, esc, toast, setMonthMode } from "/common.js";

const OPTS = [
  ["calendar", "Del mismo día al mismo día del mes siguiente", "13/12 → 13/01"],
  ["days", "30 días justos", "13/12 → 12/01"],
];

/** Las dos opciones como botones de radio (con etiqueta y ejemplo). `mode` = la elegida. */
export function monthModeField(mode, { legend = "¿Cómo contás un mes?", help = "" } = {}) {
  return `<fieldset class="mm-field" style="grid-column:1/-1;border:1px solid var(--line,#8884);border-radius:12px;padding:10px 12px;margin:0;min-width:0">
    <legend style="padding:0 6px;font-weight:700">📅 ${esc(legend)}</legend>
    ${OPTS.map(([v, t, ex]) => `<label class="chk" style="display:flex;align-items:center;gap:10px;min-height:44px;margin:0"><input type="radio" name="monthMode" value="${v}" ${mode === v ? "checked" : ""} style="width:22px;height:22px;flex:none"><span>${esc(t)} <small style="opacity:.8;white-space:nowrap">(${esc(ex)})</small></span></label>`).join("")}
    ${help ? `<p style="margin:4px 0 0;font-size:13px;opacity:.85">${esc(help)}</p>` : ""}
  </fieldset>`;
}

/** Lo que eligió en un formulario con `monthModeField`. */
export const monthModeOf = (form) => form.querySelector('input[name="monthMode"]:checked')?.value;

/** Tarjeta de GaboHub para el revendedor: cómo cuenta un mes para SUS clientes (cuaderno y cuentas propias). */
export function hubMonthCard(mode) {
  const now = mode === "calendar" ? "del mismo día al mismo día (13/12 → 13/01)" : "30 días justos (13/12 → 12/01)";
  return `<details class="sbox mm-card" id="mmCard"><summary style="min-height:44px;display:flex;align-items:center;gap:8px;cursor:pointer"><b>📅 ¿Cómo contás un mes?</b> <small class="empty">Hoy: ${esc(now)}</small></summary>
    <form id="mesModoForm" style="display:grid;gap:10px;margin-top:8px">
      ${monthModeField(mode, { legend: "Para tus clientes", help: "Vale para lo que anotás vos: perfiles repartidos y tus cuentas propias. Lo que te alquila la tienda sigue la regla de la tienda." })}
      <button class="sbtn" type="submit" style="justify-self:start;min-height:44px">Guardar</button>
    </form></details>`;
}

/** Guarda la tarjeta de GaboHub. `onSaved(mode)` para refrescar lo que haga falta. */
export function initMesModo({ onSaved } = {}) {
  document.addEventListener("submit", async (ev) => {
    const f = ev.target;
    if (!(f instanceof HTMLFormElement) || f.id !== "mesModoForm") return;
    ev.preventDefault();
    const mode = monthModeOf(f);
    if (!mode) return;
    try {
      const r = await api("PUT", "/api/me/month-mode", { mode });
      toast(r.mode === "calendar" ? "Listo: tus meses van del mismo día al mismo día" : "Listo: tus meses son de 30 días");
      onSaved?.(r.mode);
    } catch (err) { toast(err?.message || "No se pudo guardar"); }
  });
}

/** El panel: aplica el modo de la tienda a las vistas previas (Renovar, Me pagó). */
export const applyStoreMonthMode = (settings) => setMonthMode(settings?.monthMode ?? "calendar");
