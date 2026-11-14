// Rutas de «cuentas caídas sin sorpresas» (src/store/caidas.ts). Se registran ANTES de POST /api/admin/accounts/:id
// para que «/fallen», «/no-sell», «/retire» y «/renew-paid-many» no los tome esa ruta general.
// - Dueño y admin: marcar caída / volvió, no vender más, retirar, mover exacto (Reubicar) y pagar varias.
// - Revendedor o cliente: el cartel «Cambió la cuenta» de SUS cuentas (la sesión dice quién es).
import type { Actor, GabrielStore } from "../store/index.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { params: Record<string, string>; body: any; actor?: Actor; query: URLSearchParams };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Route = (method: string, path: string, who: Who, handler: (c: any) => unknown) => void;

export function registerCaidasRoutes(d: { route: Route; store: GabrielStore }): void {
  const { store } = d, A = (c: Ctx) => c.actor!;
  const route = (m: string, p: string, who: Who, h: (c: Ctx) => unknown) => d.route(m, p, who, h);
  route("POST", "/api/admin/accounts/renew-paid-many", "staff", (c) => store.caidas.payMany(A(c), { items: c.body?.items, months: c.body?.months }));
  route("POST", "/api/admin/accounts/:id/fallen", "staff", (c) => store.caidas.markFallen(A(c), c.params.id, c.body?.reason));
  route("POST", "/api/admin/accounts/:id/fallen/undo", "staff", (c) => store.caidas.unmarkFallen(A(c), c.params.id, { release: c.body?.release === true }));
  route("POST", "/api/admin/accounts/:id/no-sell", "staff", (c) => store.caidas.setNoSell(A(c), c.params.id, c.body?.on === true));
  route("POST", "/api/admin/accounts/:id/retire", "staff", (c) => store.caidas.retire(A(c), c.params.id, c.body?.reason));
  route("GET", "/api/me/account-changes", "customer", (c) => store.caidas.changes(c.actor!));
  route("POST", "/api/me/account-changes/:id/seen", "customer", (c) => store.caidas.changeSeen(c.actor!, c.params.id));
}
