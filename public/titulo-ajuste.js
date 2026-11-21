// Título de arriba del panel que entra entero en el celular (20/11/2026).
// A 390 px «Revendedores», «Notificaciones», «Recordatorios» y «Configuración» se cortaban («Revendedore»):
// una sola palabra no pasa a otro renglón. Si no entra: 1) se achica de a medio punto hasta 14,5 px;
// 2) si igual no entra (360 px), la palabra larga se parte en sílabas con guion («Reven-dedores») en dos renglones.
// Los títulos de varias palabras («Productos y precios») siguen pasando a dos renglones como antes.
const V = "aeiouáéíóúü";
const isV = (c) => V.includes(c);
const L = /[a-záéíóúüñ]/;
/** Dónde se puede cortar una palabra en castellano (antes de consonante + vocal, sin romper ch, ll, rr, pr, bl…). */
export function silabaCorte(w) {
  const s = w.toLowerCase(), cand = [];
  for (let i = 2; i < s.length - 2; i++) {
    const c = s[i], p = s[i - 1];
    if (!L.test(c) || isV(c) || !isV(s[i + 1]) || !L.test(p)) continue;
    if ((c === "h" && p === "c") || (c === p && "lr".includes(c)) || ("lr".includes(c) && "bcdfgkpt".includes(p))) continue;
    cand.push(i);
  }
  if (!cand.length) return -1;
  return cand.reduce((b, i) => (Math.abs(i - s.length / 2) < Math.abs(b - s.length / 2) ? i : b));
}
const over = (h) => h.scrollWidth > h.clientWidth + 1;
export function fitTitle(h) {
  if (!h) return;
  // Con la letra todavía cargando, el ancho no es el real: se vuelve a medir cuando termina.
  if (document.fonts && document.fonts.status !== "loaded") document.fonts.ready.then(() => fitTitle(h)).catch(() => {});
  h.style.fontSize = "";
  for (const n of h.childNodes) if (n.nodeType === 3) n.textContent = n.textContent.replace(/­/g, "");
  let fs = parseFloat(getComputedStyle(h).fontSize) || 17;
  while (over(h) && fs > 14.5) { fs -= 0.5; h.style.fontSize = fs + "px"; }
  if (!over(h)) return;
  for (const n of h.childNodes) {
    if (n.nodeType !== 3) continue;
    n.textContent = n.textContent.replace(/[^\s]{9,}/g, (w) => { const i = silabaCorte(w); return i > 0 ? w.slice(0, i) + "­" + w.slice(i) : w; });
  }
}
let timer;
if (typeof addEventListener === "function") addEventListener("resize", () => { clearTimeout(timer); timer = setTimeout(() => fitTitle(document.getElementById("ptitle")), 150); });
