// Rutas de perfiles sueltos comprados a otras personas (src/store/perfilSuelto.ts). Solo dueño y admin (el núcleo
// pide `inventory.manage`). Se registran antes de las rutas generales de cuentas y perfiles.
import type { Actor, GabrielStore } from "../store/index.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { params: Record<string, string>; body: any; actor?: Actor; query: URLSearchParams };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Route = (method: string, path: string, who: Who, handler: (c: any) => unknown) => void;

export function registerPerfilRoutes(d: { route: Route; store: GabrielStore }): void {
  const { store } = d, A = (c: Ctx) => c.actor!;
  const route = (m: string, p: string, who: Who, h: (c: Ctx) => unknown) => d.route(m, p, who, h);
  route("GET", "/api/admin/perfiles-sueltos/vendedores", "staff", (c) => store.perfiles.vendors(A(c)));
  route("POST", "/api/admin/perfiles-sueltos", "staff", (c) => store.perfiles.buy(A(c), c.body ?? {}));
  route("GET", "/api/admin/perfiles-sueltos/:id", "staff", (c) => store.perfiles.card(A(c), c.params.id));
  route("POST", "/api/admin/perfiles-sueltos/:id/caido", "staff", (c) => store.perfiles.down(A(c), c.params.id, c.body ?? {}));
  route("POST", "/api/admin/perfiles-sueltos/:id/pague", "staff", (c) => store.perfiles.pay(A(c), c.params.id, c.body ?? {}));
}
