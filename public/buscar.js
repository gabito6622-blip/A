// Buscar como escribe el dueño (revisión de 3 meses, 14/11/2026): sin tildes, sin mayúsculas, palabras en cualquier
// orden, parte del nombre o del número («maria», «quispe ana», «7100»). La misma regla que src/store/buscar.ts.
// Sin dependencias: lo usan Vender (dia.js), el Control (panel.js) y las pruebas.

export const norm = (x) => String(x ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** ¿`hay` tiene todas las palabras de `q`? Un número se compara por sus dígitos («+591 710-0» = «7100»). */
export function matches(hay, q) {
  const words = norm(q).split(/\s+/).filter(Boolean);
  if (!words.length) return true;
  const h = norm(hay), hd = h.replace(/\D/g, "");
  return words.every((w) => {
    if (h.includes(w)) return true;
    const d = w.replace(/\D/g, "");
    return d.length >= 3 && d.length === w.replace(/[+().-]/g, "").length && hd.includes(d);
  });
}

/**
 * Clientes de Vender que coinciden con lo escrito. `map` = { "Nombre · teléfono": id } (la lista de Vender).
 * Devuelve [{ label, id }] (hasta `limit`), los que empiezan igual primero.
 */
export function matchCustomers(map, q, limit = 5) {
  const t = String(q ?? "").trim();
  if (t.length < 2) return [];
  const nq = norm(t);
  return Object.entries(map ?? {})
    .filter(([label]) => matches(label, t))
    .sort(([a], [b]) => Number(!norm(a).startsWith(nq)) - Number(!norm(b).startsWith(nq)) || a.localeCompare(b, "es"))
    .slice(0, limit)
    .map(([label, id]) => ({ label, id }));
}

/**
 * El cliente que el dueño quiso decir: el de la lista si eligió la sugerencia, o el ÚNICO que coincide con lo que
 * escribió (así el botón Vender no se traba por no tocar la sugerencia). Si coinciden varios, ninguno: hay que elegir.
 */
export function resolveCustomer(map, q) {
  const t = String(q ?? "").trim();
  if (!t) return null;
  if (map?.[t]) return { label: t, id: map[t] };
  const exact = Object.entries(map ?? {}).filter(([label]) => norm(label) === norm(t) || norm(label.split(" · ")[0]) === norm(t));
  if (exact.length === 1) return { label: exact[0][0], id: exact[0][1] };
  // Una sola palabra («ana») puede ser un cliente nuevo: ahí se pide tocar la sugerencia. Con nombre y apellido
  // («quispe ana») o el número completo, si hay uno solo, es ese.
  const words = norm(t).split(/\s+/).filter(Boolean), digits = t.replace(/\D/g, "");
  if (words.length < 2 && digits.length < 7) return null;
  const m = matchCustomers(map, t, 2);
  return m.length === 1 ? m[0] : null;
}
