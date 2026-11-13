// Se corre DENTRO de la página antes de cada captura: el video no muestra los precios ni el stock de la tienda.
// En cada tarjeta, el precio pasa a decir «Tu precio» (el revendedor pone el suyo); «N disponibles» pasa a «✅ Disponible»;
// cualquier otro «Bs 123» de la zona indicada (por defecto, toda la página) pasa a «Tu precio».
module.exports = function sinPrecios(scopeSel) {
  for (const pr of document.querySelectorAll(".price")) {
    const t = [...pr.childNodes].find((n) => n.nodeType === 3 && n.nodeValue.trim());
    if (t) t.nodeValue = "Tu precio ";
    for (const s of pr.querySelectorAll(".pub")) s.remove();
    for (const s of pr.querySelectorAll("small")) { s.style.display = "block"; s.textContent = s.textContent.replace(/^\s*\/\s*/, "por "); }
  }
  for (const s of document.querySelectorAll(".stock")) s.textContent = "✅ Disponible";
  for (const root of document.querySelectorAll(scopeSel || "body")) {
    const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n; (n = w.nextNode());) if (/Bs\s?\d/.test(n.nodeValue)) n.nodeValue = n.nodeValue.replace(/Bs\s?[\d.,]+/g, "Tu precio");
  }
};
