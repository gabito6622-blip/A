// Rutas de las herramientas de cobro del revendedor en GaboHub (hubCobros.ts, 17/11/2026).
// /api/me/cobros-hub/*: "customer"; el núcleo exige que sea revendedor y que todo sea SUYO.
// Plan GaboHub: las lecturas (comprobantes en revisión, Anotar rápido) van con «Quién me debe» (plan Negocio).
// Las escrituras de plata (Me pagó, aprobar, rechazar, deshacer) nunca se bloquean, igual que anotar fiados.
// /api/cobro/:token/pago y /comprobante: públicas, por el mismo freno contra tokens inventados de /api/cobro.
import type { Actor, GabrielStore } from "../store/index.js";
import { RateLimiter } from "./security.js";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { params: Record<string, string>; body: any; actor?: Actor; ip: string };
type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Route = (method: string, path: string, who: Who, handler: (c: any) => unknown, maxBody?: number) => void;

export interface HubCobrosDeps {
  route: Route;
  store: GabrielStore;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  saveUpload: (body: any) => string;
  dropUpload: (name: string) => void;
  fileHash: (name: string) => string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sendImage: (c: any, ref: string | undefined, missing: string) => unknown;
  /** El mismo freno por plan de app.ts («debe», «dia»…). */
  needPlan: (feature: "debe" | "dia") => (c: { actor?: Actor }) => void;
  /** El freno de /api/cobro contra el barrido de tokens. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cobro: <T>(c: any, fn: () => T) => T;
  now: () => number;
  /** 429 con el mensaje dado. */
  tooMany: (msg: string) => never;
  maxUpload: number;
}

export function registerHubCobrosRoutes(d: HubCobrosDeps): void {
  const { route, store: s, needPlan } = d;
  const H = s.hubCobros;
  const debe = needPlan("debe"), dia = needPlan("dia");
  const me = (c: Ctx) => c.actor!;

  route("GET", "/api/me/cobros-hub", "customer", (c: Ctx) => H.summary(me(c)));
  route("GET", "/api/me/cobros-hub/pay-info", "customer", (c: Ctx) => ({ info: H.payInfo(me(c)) }));
  route("PUT", "/api/me/cobros-hub/pay-info", "customer", (c: Ctx) => H.setPayInfo(me(c), c.body ?? {}));
  route("POST", "/api/me/cobros-hub/pay/:id", "customer", (c: Ctx) => { dia(c); return H.pay(me(c), c.params.id, c.body ?? {}); });
  route("POST", "/api/me/cobros-hub/pay-many", "customer", (c: Ctx) => { dia(c); return H.payMany(me(c), c.body?.items, { idempotencyKey: c.body?.idempotencyKey }); });
  route("POST", "/api/me/cobros-hub/undo/:id", "customer", (c: Ctx) => H.undo(me(c), c.params.id));
  route("POST", "/api/me/cobros-hub/quick/parse", "customer", (c: Ctx) => { debe(c); return H.quickParse(me(c), c.body?.text); });
  route("POST", "/api/me/cobros-hub/quick/apply", "customer", (c: Ctx) => { debe(c); return H.quickApply(me(c), c.body?.text, { idempotencyKey: c.body?.idempotencyKey }); });
  route("GET", "/api/me/cobros-hub/proofs", "customer", (c: Ctx) => { debe(c); return H.proofs(me(c)); });
  route("GET", "/api/me/cobros-hub/proofs/:id/file", "customer", (c: Ctx) => d.sendImage(c, H.proofFile(me(c), c.params.id), "Sin comprobante"));
  route("POST", "/api/me/cobros-hub/proofs/:id/approve", "customer", (c: Ctx) => H.approve(me(c), c.params.id, { amount: c.body?.amount }));
  route("POST", "/api/me/cobros-hub/proofs/:id/reject", "customer", (c: Ctx) => H.reject(me(c), c.params.id, c.body?.reason));

  /* ---- públicas: la página /c/<token> ---- */
  const upLimiter = new RateLimiter(6, 60 * 60_000, d.now);
  route("GET", "/api/cobro/:token/pago", "public", (c: Ctx) => d.cobro(c, () => H.publicPay(c.params.token)));
  route("POST", "/api/cobro/:token/comprobante", "public", (c: Ctx) => d.cobro(c, () => {
    H.publicPay(c.params.token); // 404 genérico antes de guardar nada
    if (!upLimiter.take(c.ip)) d.tooMany("Demasiados comprobantes seguidos. Probá en un rato.");
    const file = d.saveUpload(c.body);
    try {
      const r = H.submitProof(c.params.token, { fileRef: file, hash: d.fileHash(file) });
      for (const f of r.dropped) d.dropUpload(f);
      return { id: r.id, status: r.status };
    } catch (err) { d.dropUpload(file); throw err; }
  }), d.maxUpload);
}
