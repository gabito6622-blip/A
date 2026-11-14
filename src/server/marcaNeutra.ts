// Encabezado y pie del HTML inicial con el nombre de la página que se pide (revisión de 3 meses, 15/11/2026).
// Antes salía «Gabriel Store» escrito hasta que cargaba el JS: con datos lentos, el cliente de un revendedor veía
// el nombre de la tienda mayorista. `name` vacío = neutro (sin ningún nombre).
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function brandShell(html: string, name: string): string {
  const raw = name.trim(), n = esc(raw);
  return html
    .replace(/(<span id="storeName"[^>]*>)[^<]*(<\/span>)/, `$1${n}$2`)
    .replace(/(<span id="footName">)[^<]*(<\/span>)/, `$1${n ? `© ${n}` : ""}$2`)
    .replace(/(<i id="logoMark">)[^<]*(<\/i>)/, `$1${esc((raw[0] ?? "").toUpperCase())}$2`);
}
