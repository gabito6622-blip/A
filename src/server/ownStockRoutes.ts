// Rutas de "país y moneda" del revendedor y de "📦 Mis cuentas propias".
// Todas las de /api/me/own/* son "customer": el servidor resuelve quién es por la sesión y el núcleo
// (ownStock.ts) exige que sea un revendedor y que lo que toca sea SUYO. El staff no tiene rutas acá,
// salvo fijar el país desde la ficha del revendedor (sin ver nada de sus cuentas propias).
import type { Actor, GabrielStore } from "../store/index.js";
import { DomainError } from "../store/index.js";
import { mySoon } from "../store/ownAlerts.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { params: Record<string, string>; body: any; actor?: Actor; req: { headers: { host?: string } } };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Route = (method: string, path: string, who: Who, handler: (c: any) => unknown, maxBody?: number) => void;

export interface OwnStockDeps {
  route: Route;
  store: GabrielStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveUpload: (body: any) => string;
  dropUpload: (name: string) => void;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendImage: (c: any, ref: string | undefined, missing: string) => unknown;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cobroUrl: (token: string, c: any) => string;
  maxUpload: number;
}

export function registerOwnStockRoutes(d: OwnStockDeps): void {
  const { store } = d;
  const route = (m: string, p: string, who: Who, h: (c: Ctx) => unknown, max?: number) => d.route(m, p, who, h, max);
  const me = (c: Ctx) => c.actor!;

  /* ---- país y moneda ---- */
  route("GET", "/api/me/locale", "customer", (c) => store.locale.mine(me(c)));
  route("PUT", "/api/me/locale", "customer", (c) => store.locale.setMine(me(c), c.body ?? {}));
  route("POST", "/api/admin/customers/:id/locale", "staff", (c) => store.locale.setFor(me(c), c.params.id, c.body ?? {}));

  /* ---- Mis cuentas propias ---- */
  route("GET", "/api/me/own", "customer", (c) => store.own.view(me(c)));
  // Lo que vence en 3 días (para "Tu día" del Inicio): sin contraseñas ni teléfonos.
  route("GET", "/api/me/own/soon", "customer", (c) => mySoon(store.engine, me(c)));
  route("POST", "/api/me/own/products", "customer", (c) => store.own.saveProduct(me(c), c.body ?? {}));
  route("POST", "/api/me/own/products/:id/delete", "customer", (c) => {
    const r = store.own.deleteProduct(me(c), c.params.id);
    if (r.logo) d.dropUpload(r.logo);
    return { ok: true };
  });
  // Logo chico del producto: misma validación que los logos de la página (imagen real, hasta 5 MB, sin PDF).
  route("POST", "/api/me/own/products/:id/logo", "customer", (c) => {
    if (c.body?.remove === true) {
      const old = store.own.setLogo(me(c), c.params.id, null);
      if (old) d.dropUpload(old);
      return { ok: true, hasLogo: false };
    }
    const file = d.saveUpload(c.body);
    if (file.endsWith(".pdf")) { d.dropUpload(file); throw new DomainError("VALIDATION", "Tiene que ser una imagen (JPG, PNG o WEBP)"); }
    try {
      const old = store.own.setLogo(me(c), c.params.id, file);
      if (old) d.dropUpload(old);
    } catch (e) { d.dropUpload(file); throw e; }
    return { ok: true, hasLogo: true };
  }, d.maxUpload);
  route("GET", "/api/me/own/products/:id/logo", "customer", (c) => d.sendImage(c, store.own.logo(me(c), c.params.id), "Sin logo"));
  route("POST", "/api/me/own/accounts/preview", "customer", (c) => store.own.preview(me(c), String(c.body?.productId ?? ""), c.body?.text));
  route("POST", "/api/me/own/accounts/bulk", "customer", (c) => store.own.addBulk(me(c), String(c.body?.productId ?? ""), c.body?.text));
  route("POST", "/api/me/own/accounts", "customer", (c) => store.own.saveAccount(me(c), c.body ?? {}));
  route("POST", "/api/me/own/accounts/:id/delete", "customer", (c) => store.own.deleteAccount(me(c), c.params.id));
  route("POST", "/api/me/own/sales", "customer", (c) => store.own.assign(me(c), c.body ?? {}));
  route("POST", "/api/me/own/sales/:id", "customer", (c) => store.own.updateSale(me(c), c.params.id, c.body ?? {}));
  route("POST", "/api/me/own/sales/:id/renew", "customer", (c) => store.own.renew(me(c), c.params.id, c.body?.paid !== false));
  route("POST", "/api/me/own/sales/:id/release", "customer", (c) => store.own.release(me(c), c.params.id));
  // Link de cobro: el mismo /c/<token> y /api/cobro/<token> que el cuaderno de perfiles.
  route("POST", "/api/me/own/sales/:id/link", "customer", (c) => { const r = store.own.link(me(c), c.params.id); return { ...r, url: d.cobroUrl(r.token, c) }; });
  route("POST", "/api/me/own/sales/:id/link/revoke", "customer", (c) => store.own.revokeLink(me(c), c.params.id));
}
