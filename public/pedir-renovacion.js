// «📩 Pedir renovación» propio (R2 · revisión de 3 meses, 14/11/2026). Cuando una cuenta vence antes con el proveedor,
// el revendedor (o cliente) no puede renovarla desde acá: antes el botón abría «Reportar falla → No me deja entrar» o un
// WhatsApp suelto, el dueño no lo veía como pedido y el servicio se cortaba igual. Ahora el pedido queda en el panel del
// dueño (Mi secretaria y Notificaciones) con el monto, y mientras está abierto no se corta.
// También: «ya tenés un pedido por QR esperando pago: ¿lo cancelo y pago con saldo?» al renovar (no pagar dos veces).
// Todo lo decide el servidor (renovarSinTrabas.ts): qué es suyo, el precio y si hace falta.
import { api, esc, bs, fdate, toast } from "/common.js";

let data = null, at = 0, loading = null, ctx = { render: () => {}, refresh: async () => {} };
const TTL = 60_000;

export function initAskRenew(c) { ctx = { ...ctx, ...c }; }
function ensure() {
  if (loading || (data && Date.now() - at < TTL)) return;
  loading = api("GET", "/api/me/renew-requests").then((d) => { data = Array.isArray(d) ? d : []; at = Date.now(); }, () => { data = data ?? []; at = Date.now(); })
    .finally(() => { loading = null; ctx.render(); });
}
/** «Te anda hasta el dd/mm/aaaa.» si todavía no venció; «Venció el dd/mm/aaaa.» si la fecha ya pasó. */
export const until = (t, future, past, now = Date.now()) => `${t < now ? past : future} <b>${fdate(t)}</b>.`;
const short = (n) => String(n ?? "").replace(/ \(alquiler revendedores\)/, "");
const reqOf = (aid) => (data ?? []).find((r) => r.assignmentId === aid && (r.status === "open" || r.status === "rejected" || (r.status === "done" && r.order?.status === "awaiting_payment")));

/**
 * Lo que va en la tarjeta de un servicio que vence antes con el proveedor. `x`: { assignmentId, product, expiresAt, price }.
 * Sin pedido: el porqué y «📩 Pedir renovación · Bs X». Con pedido: «✓ Pediste la renovación…» y que no se corta.
 * `opts.client` (cliente de la tienda, 14/11): sin candado ni «proveedor», y solo en los últimos 7 días (`opts.daysLeft`):
 * antes no hay nada que hacer y el cartel solo asusta. El revendedor lo sigue viendo como siempre.
 */
export function askRenewHtml(x, opts = {}) {
  if (opts.client) return clientHtml(x, opts.daysLeft);
  ensure();
  const r = reqOf(x.assignmentId);
  // 20/11/2026 (revisión del revendedor): si ya venció, no decir «te anda hasta» una fecha pasada (se contradecía con
  // «Venció hace 6 días» de la misma tarjeta).
  const why = `<span class="rlock">🔒 Para renovarla, la tienda primero renueva con su proveedor. ${until(x.expiresAt, "Te anda hasta el", "Venció el")}</span>`;
  if (!r) return `${why}<button class="sbtn sm pri" type="button" data-rrqask="${esc(x.assignmentId)}" data-what="${esc(short(x.product))}" data-amount="${x.price ?? 0}">📩 Pedir renovación${x.price ? ` · ${bs(x.price)}` : ""}</button>`;
  if (r.status === "rejected") return `<span class="rlock">❌ La tienda no la renueva: ${esc(r.reason ?? "")}</span>`;
  if (r.status === "done") return `<span class="rlock rrqok">✅ La tienda renovó con su proveedor: pagá ${bs(r.order.total)} con el QR de arriba. No se corta mientras tanto.</span>`;
  return `<span class="rlock rrqok">✓ Pediste la renovación el ${fdate(r.createdAt)}: la tienda primero renueva con su proveedor, ya le avisamos. No se corta mientras tanto.</span><button class="sbtn sm" type="button" data-rrqcancel="${esc(r.id)}">Ya no la quiero</button>`;
}

/** Cliente de la tienda: las mismas acciones con palabras que no asustan. */
function clientHtml(x, daysLeft) {
  if (typeof daysLeft === "number" && daysLeft > 7) return "";
  ensure();
  const r = reqOf(x.assignmentId);
  if (!r) return `<span class="rlock">Para renovar, tocá «Pedir renovación» y te avisamos cuando esté lista. ${until(x.expiresAt, "Tu cuenta sigue andando hasta el", "Tu cuenta venció el")}</span><button class="sbtn sm pri" type="button" data-rrqask="${esc(x.assignmentId)}" data-what="${esc(short(x.product))}" data-amount="${x.price ?? 0}" data-client="1">📩 Pedir renovación${x.price ? ` · ${bs(x.price)}` : ""}</button>`;
  if (r.status === "rejected") return `<span class="rlock">❌ Esta vez no la podemos renovar: ${esc(r.reason ?? "")}. Escribinos por WhatsApp y vemos otra opción.</span>`;
  if (r.status === "done") return `<span class="rlock rrqok">✅ Ya está lista para renovar: pagá ${bs(r.order.total)} con el QR de arriba. Tu cuenta no se corta mientras tanto.</span>`;
  return `<span class="rlock rrqok">✓ Pediste la renovación el ${fdate(r.createdAt)}: te avisamos cuando esté lista. Tu cuenta no se corta mientras tanto.</span><button class="sbtn sm" type="button" data-rrqcancel="${esc(r.id)}">Ya no la quiero</button>`;
}

/** ¿Hay un pedido abierto de este servicio? (para el cartel de Inicio). */
export const hasOpenRequest = (aid) => !!(data ?? []).find((r) => r.assignmentId === aid && r.status === "open");

async function reloadAll() { data = null; at = 0; await ctx.refresh(); }

document.addEventListener("click", async (ev) => {
  const el = ev.target.closest?.("button[data-rrqask],button[data-rrqcancel]");
  if (!el) return;
  const d = el.dataset;
  if (d.rrqask) {
    const amt = Number(d.amount) || 0;
    const how = d.client ? "Te avisamos cuando esté lista. Entonces se descuenta de tu saldo (si no te alcanza, te dejamos un QR). Tu cuenta no se corta mientras tanto."
      : "La tienda primero renueva con su proveedor. Cuando la renueve, se descuenta de tu saldo (si no te alcanza, te deja un QR). Mientras tanto no se corta.";
    if (!confirm(`¿Pedir la renovación de ${d.what}${amt ? ` (${bs(amt)})` : ""}?\n${how}`)) return;
    el.disabled = true;
    try {
      const r = await api("POST", "/api/me/renew-requests", { assignmentId: d.rrqask });
      toast(r.already ? (d.client ? "Ya la habías pedido: te avisamos cuando esté lista" : "Ya la habías pedido: la tienda la está renovando") : "📩 Listo: la tienda ya tiene tu pedido. No se corta mientras tanto.");
      await reloadAll();
    } catch (e) { el.disabled = false; toast(e.message); }
  }
  if (d.rrqcancel) {
    if (!confirm("¿Cancelar el pedido de renovación? Si no la renovás, se corta en la fecha de siempre.")) return;
    el.disabled = true;
    try { await api("POST", `/api/me/renew-requests/${encodeURIComponent(d.rrqcancel)}/cancel`, {}); toast("Pedido cancelado"); await reloadAll(); }
    catch (e) { el.disabled = false; toast(e.message); }
  }
});

/**
 * Renovar dio «ya hay una renovación esperando pago»: si es un QR sin pagar y quería pagar con saldo, pregunta
 * «¿lo cancelo y pago con saldo?»; si dice que sí, cancela ese pedido y vuelve a intentar. Devuelve true si lo manejó.
 */
export async function pendingRenewFlow(err, assignmentId, retry) {
  if (err?.code !== "PENDING_RENEWAL") return false;
  if (!/¿Lo cancelo/.test(err.message)) { toast(err.message); return true; }
  if (!confirm(err.message)) return true;
  const st = await api("GET", "/api/me/store-rentals").catch(() => null);
  const pend = (st?.pending ?? []).filter((o) => o.assignmentId === assignmentId);
  if (!pend.length) { toast("No encontré el pedido por QR: mirá «Mis cuentas y pedidos»"); return true; }
  for (const o of pend) await api("POST", `/api/orders/${encodeURIComponent(o.id)}/cancel`, {});
  await retry();
  return true;
}
