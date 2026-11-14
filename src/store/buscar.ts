// Buscar como escribe el dueño (revisión de 3 meses, 14/11/2026): sin tildes, sin mayúsculas, palabras en cualquier
// orden y parte del nombre o del número («maria», «quispe ana», «7100»). La misma regla que public/buscar.js.
export const normTxt = (x: unknown) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** ¿`hay` (nombre, teléfono, correo…) tiene todas las palabras de `q`? Los números se comparan solo por sus dígitos. */
export function matchesQuery(hay: string, q: string): boolean {
  const words = normTxt(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = normTxt(hay), hd = h.replace(/\D/g, "");
  return words.every((w) => {
    if (h.includes(w)) return true;
    const d = w.replace(/\D/g, "");
    return d.length >= 3 && d.length === w.replace(/[+().-]/g, "").length && hd.includes(d);
  });
}
