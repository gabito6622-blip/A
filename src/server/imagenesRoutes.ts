// Versiones chicas de imágenes JPG y WEBP armadas en el navegador (14/11/2026).
//
// El servidor achica solo los PNG (imagenes.ts): para JPG y WEBP haría falta una librería. Entonces el navegador de
// quien subió la imagen la achica con <canvas> y la manda acá, para las ya subidas y para las nuevas:
//  - Dueño o admin (catalog.manage): logo, portada y logos de productos de la tienda.
//  - Revendedor: solo el logo y la portada de SU página (nunca los de otro).
// El QR de cobro y los comprobantes nunca se achican. La original queda guardada tal cual.
// No cambia ningún dato del negocio (es solo una copia más liviana para mostrar), por eso no deja auditoría.
import type { Actor, GabrielStore } from "../store/index.js";
import { DomainError } from "../store/index.js";
import { authorize } from "../store/auth.js";
import type { Imagenes, TipoImagen } from "./imagenes.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { body: any; actor?: Actor };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Route = (method: string, path: string, who: Who, handler: (c: any) => unknown, maxBody?: number) => void;

export interface ImagenesDeps { route: Route; store: GabrielStore; imagenes: Imagenes }

interface Item { clave: string; ref: string | undefined; tipo: TipoImagen; url: string }

export function registerImagenesRoutes(d: ImagenesDeps): void {
  const s = d.store.engine.s;
  /** Las imágenes públicas de la tienda que se pueden achicar (nunca el QR). */
  const deLaTienda = (): Item[] => [
    { clave: "logo", ref: s.settings.logoFileRef, tipo: "logo" as const, url: "/api/settings/logo" },
    { clave: "banner", ref: s.settings.bannerFileRef, tipo: "portada" as const, url: "/api/settings/banner" },
    ...Object.values(s.products).filter((p) => p.imageFileRef).map((p) => ({ clave: `producto:${p.id}`, ref: p.imageFileRef, tipo: "icono" as const, url: `/api/products/${encodeURIComponent(p.id)}/image` })),
  ];
  /** El logo y la portada de la página del revendedor que pregunta (de nadie más). */
  const deSuPagina = (actor: Actor): Item[] => {
    const sh = actor.role === "reseller" && actor.customerId ? s.customers[actor.customerId]?.shop : undefined;
    if (!sh?.slug) return [];
    return [
      { clave: "logo", ref: sh.logoFileRef, tipo: "logo" as const, url: `/api/shops/${sh.slug}/logo` },
      { clave: "banner", ref: sh.bannerFileRef, tipo: "portada" as const, url: `/api/shops/${sh.slug}/banner` },
    ];
  };
  const pendientes = (l: Item[]) => l.map((x) => ({ clave: x.clave, url: x.url, lados: d.imagenes.pendiente(x.ref, x.tipo), jpg: !!x.ref?.endsWith(".jpg") })).filter((x) => x.lados.length);
  const guardar = (l: Item[], body: { clave?: unknown; base64?: unknown; lado?: unknown } | undefined) => {
    const it = l.find((x) => x.clave === body?.clave);
    if (!it?.ref) throw new DomainError("NOT_FOUND", "Esa imagen ya no está");
    // Si no sirve (no es una imagen, es más grande o pesa más que la original) no pasa nada: se sigue mostrando la original.
    return { ok: d.imagenes.guardarChicaDelNavegador(it.ref, it.tipo, body?.base64, body?.lado) };
  };
  const MAX = 1_500_000; // la versión chica pesa hasta 1 MB (en base64, ~1,4 MB)

  d.route("GET", "/api/admin/imagenes/pendientes", "staff", (c: Ctx) => { authorize(c.actor!, "catalog.manage"); return pendientes(deLaTienda()); });
  d.route("POST", "/api/admin/imagenes/chica", "staff", (c: Ctx) => { authorize(c.actor!, "catalog.manage"); return guardar(deLaTienda(), c.body); }, MAX);
  d.route("GET", "/api/me/shop/imagenes/pendientes", "customer", (c: Ctx) => pendientes(deSuPagina(c.actor!)));
  d.route("POST", "/api/me/shop/imagenes/chica", "customer", (c: Ctx) => guardar(deSuPagina(c.actor!), c.body), MAX);
}
