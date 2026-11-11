// Rutas de "📩 Ver mi código de acceso" (src/store/codigosSolos.ts).
// - Pública: GET /api/cobro/:token/codes, con el mismo límite por IP de los links de cobro (los tokens
//   que no sirven cuentan) y además un tope de consultas por IP y por link (cada consulta se audita).
// - Revendedor: sus interruptores y el contador del mes (la sesión dice quién es; el núcleo exige que sea suyo).
// - Dueño: el permiso global (codes.configure = solo el dueño) y el total del mes, sin tokens ni clientes.
import type { Actor, GabrielStore } from "../store/index.js";
import * as selfCodes from "../store/codigosSolos.js";
import { RateLimiter } from "./security.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { params: Record<string, string>; body: any; actor?: Actor; ip: string };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Route = (method: string, path: string, who: Who, handler: (c: any) => unknown) => void;

export interface SelfCodesDeps {
  route: Route;
  store: GabrielStore;
  /** El envoltorio de los links de cobro (límite por IP de tokens que no sirven). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cobro: <T>(c: any, fn: () => T) => T;
  /** Corta con 429 (el error HTTP es del servidor). */
  tooMany: (message: string) => never;
  now: () => number;
}

export function registerSelfCodesRoutes(d: SelfCodesDeps): void {
  const e = d.store.engine;
  const route = (m: string, p: string, who: Who, h: (c: Ctx) => unknown) => d.route(m, p, who, h);
  // 30 consultas cada 15 minutos por IP y 20 por link: de sobra para quien espera un código.
  const perIp = new RateLimiter(30, 15 * 60_000, d.now);
  const perLink = new RateLimiter(20, 15 * 60_000, d.now);
  const on = (c: Ctx) => c.body?.on === true;

  route("GET", "/api/cobro/:token/codes", "public", (c) => d.cobro(c, () => {
    if (perIp.blocked(c.ip) || perLink.blocked(`l:${c.params.token}`)) d.tooMany("Demasiadas consultas. Probá en unos minutos.");
    const r = selfCodes.publicCodes(e, c.params.token);
    perIp.take(c.ip);
    perLink.take(`l:${c.params.token}`);
    return r;
  }));

  route("GET", "/api/me/self-codes", "customer", (c) => selfCodes.resellerView(e, c.actor!));
  route("POST", "/api/me/self-codes/rental/:id", "customer", (c) => selfCodes.setRental(e, c.actor!, c.params.id, on(c)));
  route("POST", "/api/me/self-codes/own/:id", "customer", (c) => selfCodes.setOwn(e, c.actor!, c.params.id, on(c)));

  route("GET", "/api/admin/self-codes", "staff", (c) => selfCodes.ownerView(e, c.actor!));
  route("POST", "/api/admin/self-codes", "staff", (c) => selfCodes.setAllowed(e, c.actor!, on(c)));
}
