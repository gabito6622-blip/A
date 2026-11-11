// Lista en dólares, del lado del panel del dueño (par de src/store/usd.ts).
// Un cliente en la lista en dólares tiene su saldo en US$; el resto de los números del dueño va en Bs.
import { bs } from "/common.js";

/** Centavos de dólar → "US$ 13,00" (siempre con centavos, miles con punto). */
export function usd(cents) {
  const n = Math.round(Number(cents) || 0), neg = n < 0, abs = Math.abs(n);
  const u = String(Math.floor(abs / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  return `US$ ${neg ? "-" : ""}${u},${String(abs % 100).padStart(2, "0")}`;
}

/** Un saldo en la moneda del cliente: "US$ 13,00" si está en dólares; si no, como siempre (Bs). */
export const wal = (cents, currency) => (currency === "USD" ? usd(cents) : bs(cents));

/** Total de un pedido para Aprobar pagos: "US$ 7,00 (≈ Bs 68,95)" si se cobró en dólares. */
export const orderTotal = (o) => (o.usd !== undefined && o.usd !== null ? `${usd(o.usd)} <small class="muted">(≈ ${bs(o.total)})</small>` : bs(o.total));

/** "saldo a favor" del dashboard: en Bs y, si hay saldos en dólares, cuánto de eso son US$ (sin mezclarlos). */
export const owedText = (k) => `saldo a favor: ${bs(k.balancesOwed)}${k.balancesOwedUsd ? ` (incluye ${usd(k.balancesOwedUsd)}${k.balancesOwedUsdRate ? "" : ", sin tasa del dólar"})` : ""}`;

/** Marca de la lista de precios en dólares. */
export const usdChip = (currency) => (currency === "USD" ? ` <span class="pp pp-warn" title="Compra y tiene el saldo en dólares">US$</span>` : "");

/** Opciones de moneda para crear o editar una lista de precios. */
export const currencySelect = (cur) => `<label>Moneda de la lista<select name="currency"><option value="BOB" ${cur === "USD" ? "" : "selected"}>Bs (bolivianos)</option><option value="USD" ${cur === "USD" ? "selected" : ""}>US$ (dólares · pagan en USDT)</option></select></label>`;

/** Aviso al elegir lista: pasar a una lista en dólares cambia la moneda de su saldo. */
export const listHint = (c, groups) => {
  const cur = groups.find((g) => g.id === c.priceGroupId)?.currency === "USD" ? "USD" : "BOB";
  return `<small class="muted" style="grid-column:1/-1">💱 Su saldo está en <b>${cur === "USD" ? "dólares (US$)" : "Bs"}</b>. Pasarlo a una lista en otra moneda cambia la moneda de su saldo: solo se puede con saldo en 0 y sin pagos por revisar.</small>`;
};

