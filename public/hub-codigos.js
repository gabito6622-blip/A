// «Link de códigos por cuenta» que sigue a la cuenta elegida en la Bandeja (revisión del revendedor, 20/11/2026).
// Antes: con 16 cuentas, tocar «netflix02» arriba filtraba la bandeja, pero abajo seguían las 16 tarjetas de links y
// había que bajar buscando la suya. Ahora el botón de la cuenta (o lo que escribe en «Buscar por correo») también
// deja solo el link de esa cuenta, con «Ver todas» para volver. Sin importaciones: se prueba directo en Node.

/**
 * Las cuentas del «Link de códigos por cuenta» que se muestran.
 * @param {{email:string, product?:string}[]} list todas sus cuentas (del servidor: solo las suyas)
 * @param {string} [pick] correo elegido con el botón de la bandeja ("" = todas)
 * @param {string} [q] lo escrito en el buscador de la bandeja
 */
export function accLinksShown(list, pick = "", q = "") {
  const p = String(pick ?? "").trim().toLowerCase(), t = String(q ?? "").trim().toLowerCase();
  return (list ?? []).filter((a) => {
    const em = String(a.email ?? "").toLowerCase();
    if (p && em !== p) return false;
    return !t || `${em} ${a.product ?? ""}`.toLowerCase().includes(t);
  });
}
