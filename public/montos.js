/**
 * 🙈 Tapar montos (14/11/2026). El dueño: «a veces usamos el panel en lugares públicos y no queremos que la demás
 * gente sepa cuánto ganamos». Un botón (data-hidemoney) tapa todos los montos de la pantalla (Bs, US$, ₲…) y otro
 * toque los muestra. Queda guardado en este celular. Se usa igual en el panel del dueño y en GaboHub.
 *
 * Cómo funciona: con el modo prendido, cada texto que parece un monto se envuelve en <span class="mny"> y el CSS lo
 * difumina (html.hide-money .mny). Con el modo apagado no se toca nada de la página.
 */
const KEY = "gs-hide-money";
// «Bs 1.234,50», «Bs -350», «US$ 10», «₲ 51.100», «$ 7». No toca fechas ni números sueltos.
const MONEY = /(?:Bs\.?|US\$|USD|₲|Gs\.?|S\/\.?|\$)\s?-?\d[\d.,]*(?:\s?mil)?/g;
const SKIP = new Set(["SCRIPT", "STYLE", "TEXTAREA", "INPUT", "SELECT", "OPTION", "CODE"]);
let on = false, obs = null;

const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };
const save = (v) => { try { localStorage.setItem(KEY, v ? "1" : "0"); } catch { /* sin almacenamiento: dura hasta recargar */ } };

function wrapIn(root) {
  if (!root || !root.ownerDocument && root !== document) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(n) {
      const p = n.parentElement;
      if (!p || SKIP.has(p.tagName) || p.closest(".mny, [contenteditable]")) return NodeFilter.FILTER_REJECT;
      MONEY.lastIndex = 0;
      return MONEY.test(n.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
    },
  });
  const list = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) list.push(n);
  for (const n of list) {
    const text = n.nodeValue, frag = document.createDocumentFragment();
    let last = 0;
    MONEY.lastIndex = 0;
    for (let m = MONEY.exec(text); m; m = MONEY.exec(text)) {
      if (m.index > last) frag.append(text.slice(last, m.index));
      const s = document.createElement("span");
      s.className = "mny"; s.textContent = m[0];
      frag.append(s);
      last = m.index + m[0].length;
    }
    if (last < text.length) frag.append(text.slice(last));
    n.replaceWith(frag);
  }
}

function paintButtons() {
  for (const b of document.querySelectorAll("[data-hidemoney]")) {
    b.setAttribute("aria-pressed", String(on));
    b.setAttribute("aria-label", on ? "Mostrar montos" : "Tapar montos");
    b.title = on ? "Mostrar montos" : "Tapar montos (para lugares públicos)";
    const ico = b.querySelector(".mnyico") ?? b;
    if (ico === b && b.children.length) continue;
    const want = on ? "🙈" : "👁️";
    if (ico.textContent !== want) ico.textContent = want; // solo si cambia: si no, el observador se llamaría sin fin
  }
}

export function setHideMoney(v) {
  on = !!v;
  save(on);
  document.documentElement.classList.toggle("hide-money", on);
  if (on) {
    wrapIn(document.body);
    if (!obs) {
      obs = new MutationObserver((recs) => {
        for (const r of recs) {
          if ((r.target.nodeType === 1 ? r.target : r.target.parentElement)?.closest?.("[data-hidemoney]")) continue;
          if (r.type === "characterData") { if (r.target.parentElement && !r.target.parentElement.closest(".mny")) wrapIn(r.target.parentElement); continue; }
          for (const n of r.addedNodes) {
            if (n.nodeType === 1 && !n.classList?.contains("mny")) wrapIn(n);
            else if (n.nodeType === 3 && n.parentElement) wrapIn(n.parentElement);
          }
        }
        paintButtons();
      });
      obs.observe(document.body, { childList: true, subtree: true, characterData: true });
    }
  } else if (obs) { obs.disconnect(); obs = null; }
  paintButtons();
}

export const moneyHidden = () => on;

/** Arranca con lo que quedó guardado y escucha el botón. Llamarlo una vez al cargar la página. */
export function initMoneyMask() {
  document.addEventListener("click", (ev) => {
    const b = ev.target.closest?.("[data-hidemoney]");
    if (!b) return;
    ev.preventDefault(); ev.stopPropagation();
    setHideMoney(!on);
  }, true);
  setHideMoney(read());
}
