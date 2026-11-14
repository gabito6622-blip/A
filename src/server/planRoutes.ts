// Rutas del cliente de la tienda para «Renovar todo junto», combos y plan mensual (store/planMensual.ts).
// El comprobante de varios pedidos usa la ruta que ya existe (/api/me/renew-many/evidence) y el dueño los aprueba con
// «Aprobar juntos». Nada de esto cobra solo: cada pago lo inicia el cliente.
import type { GabrielStore } from "../store/index.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { actor?: any; body: any };
type Route = (method: string, path: string, who: Who, handler: (c: Ctx) => unknown) => void;

export function registerPlanRoutes(d: { route: Route; store: GabrielStore }) {
  const { route, store } = d;
  route("GET", "/api/me/plan", "customer", (c) => store.plan.view(c.actor));
  route("POST", "/api/me/plan", "customer", (c) => store.plan.set(c.actor, { on: c.body?.on, ids: c.body?.ids }));
  route("POST", "/api/me/renew-all/preview", "customer", (c) => store.plan.preview(c.actor, { ids: c.body?.ids, align: c.body?.align }));
  route("POST", "/api/me/renew-all", "customer", (c) => store.plan.renewAll(c.actor, {
    ids: c.body?.ids, align: c.body?.align, paymentMethod: c.body?.paymentMethod, idempotencyKey: c.body?.idempotencyKey, plan: c.body?.plan,
  }));
}
