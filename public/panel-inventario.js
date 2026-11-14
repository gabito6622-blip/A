// Arreglos de Inventario y Finanzas del panel (14/11/2026), pedidos por el dueño después de revisar su inventario
// y su plata desde el celular. Acá vive la lógica; panel.js solo la llama.
import { esc, bs, fdate } from "/common.js";

const DAY = 86_400_000;
/** «2026-11-14» para un <input type="date">, con la fecha del celular. */
const dateIn = (t) => { const d = new Date(t); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`; };
/** Una cuenta cargada sin fecha quedaba «vence en 100 años»: esas se muestran como «sin fecha». */
export const sinFecha = (t) => !t || t - Date.now() > 50 * 365 * DAY;

/**
 * «Vence con el proveedor» y «Costo» a la vista y obligatorios en la carga de cuentas (antes estaban escondidos en
 * «opcional» y sin fecha el servidor inventaba 100 años). La fecha viene con 30 días ya puestos.
 */
let helpN = 0;
export function cargaVenceCosto(sym, lastCost) {
  const cost = lastCost === undefined || lastCost === null || lastCost === "" || lastCost === "0" ? "" : String(lastCost);
  const hid = `expHelp${++helpN}`; // un id distinto por formulario (hay varios en Carga de cuentas)
  return `<label>Vence con el proveedor<input type="date" name="exp" required value="${dateIn(Date.now() + 30 * DAY)}" aria-describedby="${hid}"><small class="muted" id="${hid}">Ya tiene 30 días: cambiala si el proveedor te dio otra fecha.</small></label>
        <label>Costo por mes (${esc(sym)})<input name="cost" inputmode="decimal" required value="${esc(cost)}" placeholder="Ej.: 35 (0 si no te cuesta)"></label>`;
}

/** Revisa fecha y costo antes de mandar; el error queda junto al campo (no un cartel). */
export function cargaOk(f) {
  for (const el of f.querySelectorAll(".cargaerr")) el.remove();
  const bad = (input, text) => {
    const m = document.createElement("small");
    m.className = "cargaerr perr-inline"; m.setAttribute("role", "alert"); m.textContent = text;
    input.closest("label")?.append(m); input.setAttribute("aria-invalid", "true"); input.focus();
    return false;
  };
  if (f.exp) { f.exp.removeAttribute("aria-invalid"); if (!f.exp.value) return bad(f.exp, "Poné cuándo vence con el proveedor (si no sabés, dejá 30 días)."); }
  if (f.cost) {
    f.cost.removeAttribute("aria-invalid");
    const v = String(f.cost.value).trim().replace(/^bs\.?\s*/i, "").replace(",", ".");
    if (v === "" || !Number.isFinite(Number(v)) || Number(v) < 0) return bad(f.cost, "Poné cuánto te cuesta por mes (0 si no te cuesta nada).");
  }
  return true;
}

/** Fila «💰 Costo» de la tarjeta de la cuenta: por mes y, si tiene varios perfiles, por perfil. */
export function costRow(a) {
  const vivos = (a.slots ?? []).filter((s) => s.status !== "retired").length || 1;
  const usd = a.costUsd ? ` · US$ ${(a.costUsd / 100).toFixed(2).replace(".", ",")} con tarjeta` : "";
  const txt = a.cost > 0
    ? `<b>${bs(a.cost)}</b> por mes${vivos > 1 ? ` · ${bs(Math.round(a.cost / vivos))} por perfil` : ""}${usd}`
    : a.costUsd ? `US$ ${(a.costUsd / 100).toFixed(2).replace(".", ",")} por mes con tarjeta` : `<span class="muted">Sin costo anotado · tocá Editar</span>`;
  return `<div class="arow acost"><span class="muted">💰 Costo</span><span>${txt}</span></div>`;
}

/** Cada cuenta destino de «Mover todos»: correo, perfiles libres y cuándo vence con el proveedor. */
export function moveDestLabel(x, libres) {
  const vence = sinFecha(x.supplierExpiresAt) ? "sin fecha del proveedor" : `vence ${fdate(x.supplierExpiresAt)}`;
  return `${x.email} · ${libres} libre${libres === 1 ? "" : "s"} · ${vence}`;
}

/** Contraseña actual de la cuenta que se está editando (solo esa; se pide al abrir «Editar»). */
export function editSecretRow(sec) {
  if (!sec) return `<p class="muted" style="grid-column:1/-1;margin:0">No se pudo leer la contraseña actual.</p>`;
  return `<div class="arow editsecret" style="grid-column:1/-1"><span class="muted">🔑 Contraseña actual</span><b class="mono">${sec.passwordPending ? "(pendiente)" : esc(sec.password)}</b></div>`;
}

/** Mes para los gráficos: «junio», nunca «jun 26» (se leía como el día 26). */
export const mesCorto = (m) => String(m.longLabel ?? m.label ?? "").replace(/ \d{4}$/, "");
