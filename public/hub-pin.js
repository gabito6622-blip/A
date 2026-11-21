// «🔐 Cambiar mi PIN» con el PIN nuevo dos veces y el error junto al formulario (revisión del revendedor, 20/11/2026).
// Por qué: muchos revendedores no saben de tecnología. Con un solo campo, un dedo de más en el PIN nuevo los dejaba
// afuera (y los otros aparatos se cierran solos al cambiarlo): tenían que pedirle a la tienda un PIN nuevo. El error
// salía en un aviso que se iba solo. Ahora se escribe dos veces (como al crear la cuenta) y el error queda a la vista.
// Sin importaciones: se prueba directo en Node.

const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

/** Los campos del formulario `#myPin` (el form lo arma shop.js). */
export function myPinFields() {
  const pinIn = (name, label, ac, ph) => `<label>${label}<input name="${name}" inputmode="numeric" maxlength="4" pattern="[0-9]{4}" ${name === "current" ? "" : "required "}placeholder="${ph}" autocomplete="${ac}"></label>`;
  return `${pinIn("current", "PIN actual", "current-password", "••••")}${pinIn("pin", "PIN nuevo", "new-password", "0000")}${pinIn("pin2", "Repetí el PIN nuevo", "new-password", "0000")}
    <p class="err mypinerr" role="alert" hidden></p><button class="sbtn" type="submit">Cambiar PIN</button>`;
}

/** Qué falta para poder cambiarlo ("" si está todo bien). */
export function myPinProblem({ current = "", pin = "", pin2 = "" } = {}) {
  const c = String(current).trim(), p = String(pin).trim(), r = String(pin2).trim();
  if (!/^\d{4}$/.test(p)) return "El PIN nuevo tiene que tener 4 números.";
  if (p !== r) return "Los dos PIN nuevos no coinciden. Escribilo igual las dos veces.";
  if (c && c === p) return "El PIN nuevo es igual al que ya tenés. Elegí otro.";
  return "";
}

/** Muestra (o borra, con "") el error dentro del formulario. */
export function myPinError(form, msg) {
  const el = form?.querySelector?.(".mypinerr");
  if (!el) return;
  el.innerHTML = msg ? `⚠️ ${esc(msg)}` : "";
  el.hidden = !msg;
}
