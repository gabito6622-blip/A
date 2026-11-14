// Qué hacer con cada tipo de código, en una línea (revisión «en el lugar de ~30 clientes», 14/11/2026). La usan
// «Ver códigos» de Mis cuentas, la Bandeja de Códigos, la página /codigos/… y el link de cobro /c/….
const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const KIND_HELP = {
  hogar: "Tocá «Abrir enlace» y después «Sí, la envié yo», desde la tele o celular donde mirás.",
  temporal: "Escribí este número en la tele.",
  login: "Escribí este código donde te lo pide.",
  verificacion: "Escribí este código donde te lo pide.",
};

/** La línea «👉 …» para un código (vacía si el tipo no tiene una instrucción clara). */
export function kindHelp(kind) {
  const t = KIND_HELP[kind];
  return t ? `<small class="khelp" style="display:block;font-size:13px;margin-top:4px">👉 ${esc(t)}</small>` : "";
}
