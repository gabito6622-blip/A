// 🧭 Ver antes de confirmar (etapa 5 del panel ordenado). Calcula en el panel lo MISMO que después hace el servidor,
// para mostrarlo antes de tocar el botón:
//   - Renovar: nueva fecha = la más tardía entre hoy y el vencimiento actual, + la duración del producto
//     (orders.ts → extend). Si se pasa de la fecha del proveedor, el servidor lo frena: se avisa antes.
//   - Vender en "Automático": le toca el perfil libre de la cuenta que vence antes con el proveedor
//     (inventory.ts → reserveSlots: cuenta activa, proveedor no vencido, desempate por id).
//   - Reemplazar: cuántos perfiles libres hay de ese producto (stock que se puede vender ahora).
// No cambia nada por sí solo: los botones siguen siendo los mismos de siempre.
import { fdate } from "/common.js";

const DAY = 86_400_000;

/** Vista previa de "Renovar +1 período". */
export function renewPreview(a, now = Date.now()) {
  const days = (a.durationDays ?? 30);
  const next = Math.max(a.customerExpiresAt, now) + days * DAY;
  const ok = !(a.supplierExpiresAt && next > a.supplierExpiresAt);
  return {
    ok, next, days,
    line: ok ? `Si renovás: vence el ${fdate(next)} (+${days} días)` : `⚠️ +${days} días se pasaría de la fecha del proveedor (${fdate(a.supplierExpiresAt)}): renová la cuenta con el proveedor o reemplazá el perfil`,
    confirm: ok
      ? `¿Renovar ${a.product} de ${a.customerName ?? "este cliente"} (${a.profile ?? ""})?\nVence: ${fdate(a.customerExpiresAt)} → ${fdate(next)} (+${days} días, cobrado en efectivo/QR).`
      : `⚠️ ${a.product} de ${a.customerName ?? "este cliente"}: +${days} días llegaría al ${fdate(next)}, después de que la cuenta vence con el proveedor (${fdate(a.supplierExpiresAt)}).\nEl sistema no lo va a dejar. ¿Intentar igual?`,
  };
}

/** Qué perfil elige el servidor en "Automático" (mismo orden que reserveSlots). */
export function autoPick(accounts, productId, now = Date.now()) {
  const free = [];
  for (const a of accounts ?? []) {
    if (a.productId !== productId || a.status !== "active" || !(a.supplierExpiresAt > now)) continue;
    for (const s of a.slots ?? []) if (s.status === "available") free.push({ slot: s, acc: a });
  }
  free.sort((x, y) => x.acc.supplierExpiresAt - y.acc.supplierExpiresAt || String(x.slot.id).localeCompare(String(y.slot.id)));
  return free[0] ?? null;
}

/** Texto de ayuda dentro de "Reemplazar". */
export function replaceHint(a, stock) {
  // Con el stock a mano, un producto sin perfiles libres no trae "available": son 0.
  const n = stock ? (stock[a.productId]?.available ?? 0) : null;
  if (n === null) return `Mantiene su fecha (${fdate(a.customerExpiresAt)}).`;
  if (!n) return `⚠️ No hay perfiles libres de ${a.product}: cargá una cuenta antes de reemplazar.`;
  return `Hay ${n} perfil${n === 1 ? "" : "es"} libre${n === 1 ? "" : "s"} de ${a.product}. Mantiene su fecha (${fdate(a.customerExpiresAt)}). Con «otra cuenta» lo pasa a una cuenta distinta.`;
}
