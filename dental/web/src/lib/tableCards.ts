// Tablas como tarjetas en el celular: a las tablas con la clase `cards-sm` se les copia el título de cada columna
// en el atributo `data-label` de sus celdas, que el CSS muestra como etiqueta cuando la pantalla es angosta.
function label(table: HTMLTableElement) {
  const heads = [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
  if (!heads.length) return;
  for (const row of table.querySelectorAll("tbody tr")) {
    let i = 0;
    for (const cell of row.children) {
      const td = cell as HTMLElement;
      const h = heads[i] ?? "";
      if (td.dataset.label !== h) td.dataset.label = h;
      i += Number(td.getAttribute("colspan") ?? 1);
    }
  }
}

export function startTableCards() {
  if (typeof document === "undefined") return;
  let queued = false;
  const run = () => { queued = false; document.querySelectorAll<HTMLTableElement>("table.cards-sm").forEach(label); };
  new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(run); } })
    .observe(document.body, { childList: true, subtree: true, characterData: true });
  run();
}
