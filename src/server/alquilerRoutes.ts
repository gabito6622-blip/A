// Rutas y avisos de R2 (14/11/2026): que el revendedor se entere siempre de lo que le pasa a sus cuentas y renueve sin
// trabarse ni pagar dos veces (src/store/renovarSinTrabas.ts y src/store/avisoCambios.ts).
// - Cliente o revendedor: «📩 Pedir renovación» de SUS servicios (o los de sus clientes), verlos y cancelarlos.
// - Dueño (payment.review + inventory.manage): verlos todos y resolverlos con «💳 Renovar proveedor y anotar» o rechazarlos.
// - Aviso al celular del revendedor cuando la tienda le cambia la cuenta, la clave o el correo (una vez por cambio).
import type { Actor, GabrielStore } from "../store/index.js";
import { resolvedPushText } from "../store/renovarSinTrabas.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { params: Record<string, string>; body: any; actor?: Actor; query: URLSearchParams };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Route = (method: string, path: string, who: Who, handler: (c: any) => unknown) => void;
type PushMsg = { title: string; body: string; url: string };

export function registerAlquilerRoutes(d: { route: Route; store: GabrielStore; push: (customerId: string, m: PushMsg) => Promise<unknown> }): void {
  const { store } = d, A = (c: Ctx) => c.actor!;
  const route = (m: string, p: string, who: Who, h: (c: Ctx) => unknown) => d.route(m, p, who, h);
  route("GET", "/api/me/renew-requests", "customer", (c) => store.rsin.mine(A(c)));
  route("POST", "/api/me/renew-requests", "customer", (c) => store.rsin.request(A(c), String(c.body?.assignmentId ?? "")));
  route("POST", "/api/me/renew-requests/:id/cancel", "customer", (c) => store.rsin.cancel(A(c), c.params.id));
  route("GET", "/api/admin/renew-requests", "staff", (c) => store.rsin.staffList(A(c)));
  route("POST", "/api/admin/renew-requests/:id/resolve", "staff", async (c) => {
    const r = store.rsin.resolve(A(c), c.params.id, { idempotencyKey: c.body?.idempotencyKey });
    // Al que lo pidió le llega al celular: renovada con su saldo, o «ya podés pagar con QR».
    const txt = resolvedPushText(r);
    await d.push(r.payerId, { ...txt, url: "/hub#inicio" }).catch(() => {});
    return r;
  });
  route("POST", "/api/admin/renew-requests/:id/reject", "staff", (c) => store.rsin.reject(A(c), c.params.id, c.body?.reason));
}

/**
 * Cada minuto: a cada cliente o revendedor con avisos al celular, los cambios de cuenta nuevos (caída, cambio de cuenta,
 * de clave, de correo). Guarda hasta cuándo ya avisó (`achg:<cliente>`) para no repetir.
 */
export async function checkAccountChangePush(d: {
  store: GabrielStore; now: () => number; pushOn: () => boolean; subscribers: () => string[];
  getMark: (k: string) => string | null | undefined; setMark: (k: string, v: string) => void; push: (customerId: string, m: PushMsg) => Promise<unknown>;
}): Promise<number> {
  if (!d.pushOn()) return 0;
  let sent = 0;
  for (const cid of new Set(d.subscribers())) {
    const key = `achg:${cid}`;
    const mark = Number(d.getMark(key) ?? "");
    // Primera vez que lo vemos: los cambios de hasta 3 días atrás todavía sirven; los más viejos ya no.
    const since = Number.isFinite(mark) && mark > 0 ? mark : d.now() - 3 * 86_400_000;
    const msg = d.store.rsin.changePush(cid, since);
    if (!msg) { if (!(mark > 0)) d.setMark(key, String(d.now())); continue; }
    d.setMark(key, String(msg.at));
    await d.push(cid, { title: msg.title, body: msg.body, url: msg.url }).catch(() => {});
    sent++;
  }
  return sent;
}
