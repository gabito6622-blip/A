// Categoría de las tarjetas propias del revendedor en su página /r/<slug> (15/11/2026).
// Antes todas salían como «Mis servicios»: en la página de un revendedor eso lo lee el CLIENTE, que entiende «mis servicios»
// como los suyos (sus cuentas activas). Ahora la categoría sale del nombre (como en la tienda): Netflix o Max → «Streaming»,
// Spotify → «Música», Flujo TV o IPTV → «TV en vivo», y lo demás → «Servicios». Solo texto: no cambia precios ni cupos.
const RULES: [RegExp, string][] = [
  [/iptv|flujo|magis|tv en vivo|canales|xtream|m3u/i, "TV en vivo"],
  [/spotify|deezer|tidal|youtube music|apple music|m[uú]sica/i, "Música"],
  [/netflix|disney|\bmax\b|hbo|prime|star\+|paramount|crunchyroll|vix|apple ?tv|mubi|universal|pluto|plex|youtube/i, "Streaming"],
];

export function ownCategory(name: string, kind?: string): string {
  const n = String(name ?? "");
  for (const [re, cat] of RULES) if (re.test(n)) return cat;
  return kind === "line" ? "TV en vivo" : "Servicios";
}
