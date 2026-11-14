// Aviso al celular del cliente de la TIENDA cuando aprobamos o rechazamos su pago (revisión «en el lugar de ~30
// clientes», 14/11/2026): pagaba con QR, subía el comprobante y tenía que entrar a cada rato a ver si ya estaba.
// Ahora le llega «✅ Tu pago fue aprobado» o «❌ No pudimos aprobar tu pago» con un toque que abre /tienda/#cuentas.
//
// Solo a clientes de la tienda: si el pedido lo pagó un revendedor o el cliente es de un revendedor, no se avisa
// (esos siguen igual que antes: el revendedor tiene sus propios avisos en GaboHub). El aviso nunca lleva contraseñas
// ni datos de la cuenta: solo qué compró y qué hacer.
import type { GabrielStore } from "../store/index.js";
import { orderTitle } from "../store/tituloPedido.js";

type PushMsg = { title: string; body: string; url: string };

/** Horario en que atiende una persona (el mismo que usa el bot de WhatsApp). null = no configurado. */
export function attendHours(store: GabrielStore): { from: number; to: number } | null {
  const h = store.chats.botSettings().humanHours;
  return h && Number.isInteger(h.from) && Number.isInteger(h.to) ? { from: h.from, to: h.to } : null;
}

/** El texto del aviso, o null si a ese pedido no le corresponde (no es de un cliente de la tienda o no cambió). */
export function payOutcomeMsg(store: GabrielStore, orderId: string): { customerId: string; msg: PushMsg } | null {
  const s = store.engine.s;
  const o = s.orders[orderId];
  if (!o || (o.status !== "fulfilled" && o.status !== "rejected")) return null;
  const payer = s.customers[o.payerId ?? o.customerId];
  if (!payer || payer.kind === "reseller" || payer.resellerId) return null; // los de revendedor siguen igual
  if (o.customerId !== payer.id) return null; // lo pagó otro: no avisamos a nadie desde acá
  const what = orderTitle(store.engine, o);
  const msg: PushMsg = o.status === "fulfilled"
    ? { title: "✅ Tu pago fue aprobado", body: o.kind === "topup" ? "Ya tenés el saldo cargado. Tocá para verlo." : `${what}: tus datos ya están en Mis cuentas. Tocá para verlos.`, url: "/tienda/#cuentas" }
    : { title: "❌ No pudimos aprobar tu pago", body: `${what}${o.rejectReason ? ` · Motivo: ${o.rejectReason}` : ""}. No pagues de nuevo: escribinos con tu comprobante.`.slice(0, 200), url: "/tienda/#cuentas" };
  return { customerId: payer.id, msg };
}

/**
 * Envuelve aprobar/rechazar: devuelve el pedido tal cual y, de fondo, avisa al celular del cliente si corresponde.
 * Un aviso que falla nunca rompe la aprobación.
 */
export function createPayOutcomePush(d: { store: GabrielStore; push: (customerId: string, m: PushMsg) => Promise<unknown> }) {
  return <T extends { id: string }>(order: T): T => {
    try {
      const m = payOutcomeMsg(d.store, order.id);
      if (m) void d.push(m.customerId, m.msg).catch(() => {});
    } catch { /* sin aviso */ }
    return order;
  };
}
