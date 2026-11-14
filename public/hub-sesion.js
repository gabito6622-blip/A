// Sesión de GaboHub (R2 · revisión de 3 meses, 14/11/2026). La sesión ahora se renueva sola con el uso (el servidor corre
// el vencimiento una vez por día). Si igual se cierra (30 días sin entrar, o «Cerrar las demás» desde otro celular), al
// volver se le explica qué pasó y se le pide el PIN con su número ya puesto, sin culpar a «la tienda»: un revendedor
// independiente no le compra a la tienda, así que el PIN se lo da el soporte de GaboHub.
// Solo guarda en este navegador su primer nombre, su número y si es independiente (nada de claves ni de saldo).
const KEY = "gs-hub-who";

const read = () => { try { return JSON.parse(localStorage.getItem(KEY) ?? "null"); } catch { return null; } };

/** Con sesión: se acuerda quién es (para el aviso si la sesión se cierra). */
export function rememberHubUser(me) {
  if (!me?.loggedIn || me.role !== "reseller") return;
  try { localStorage.setItem(KEY, JSON.stringify({ name: String(me.name ?? "").split(" ")[0], phone: me.phone ?? "", indep: me.trust === "independent" })); } catch { /* sin almacenamiento */ }
}
/** «Cerrar sesión» a propósito: no hay que avisarle nada al volver. */
export function forgetHubUser() { try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ } }

/** Quién le da el PIN: la tienda, o el soporte de GaboHub si es independiente. */
export function pinGiver(settings) {
  return read()?.indep ? `el soporte de ${settings?.platformName || settings?.storeName || "GaboHub"}` : "la tienda";
}

/**
 * Si antes entró en este celular y ahora no tiene sesión: el aviso para el formulario de ingreso (y su número). Si no, null.
 * Se muestra una sola vez por carga de la página.
 */
let shown = false;
export function expiredNotice(settings) {
  const w = read();
  if (!w || shown) return null;
  shown = true;
  const hi = w.name ? `${w.name}, ` : "";
  return {
    phone: w.phone,
    html: `<div class="hbox warn" role="status"><b>🔐 ${hi}tu sesión se cerró</b><span>Pasaron 30 días sin entrar o la cerraste desde otro celular. Tus cuentas y tus clientes siguen igual: entrá con tu número y tu PIN.</span><span>¿No te acordás tu PIN? Tocá «Olvidé mi PIN / soy nuevo» o pedíselo a ${pinGiver(settings)}.</span></div>`,
  };
}
