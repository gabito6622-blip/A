// "🔔 Avisarme antes de que venza": avisos automáticos al celular del cliente final (Web Push, gratis).
//
// - Cliente con cuenta: usa las suscripciones que ya existen (push_csubs, /api/me/push/*).
// - Cliente sin cuenta: se suscribe desde su link de cobro /c/<token>. La suscripción queda atada a ESE
//   token (push_tsubs, junto a los secretos: no va en el estado, ni en exportaciones, ni en el panel). Si el
//   link deja de servir (cambiado, revocado, perfil borrado o cuenta pasada a otro), se borra.
// - Un trabajo diario (desde las 9, hora de Bolivia) manda 3 días antes, 1 día antes y el día que vence,
//   como máximo un aviso por servicio por día y sin repetir. Varios servicios van en un solo aviso.
// - El toque va sin contenido (como todos los avisos de push): el celular pide el texto después. Los de
//   /c/<token> lo piden con su propio endpoint (que solo conoce ese navegador), sin sesión.
// Nada de WhatsApp, SMS ni correo. Las suscripciones que el servicio de push da por muertas (404/410) se borran.
import type { GabrielStore } from "../store/index.js";
import { DomainError } from "../store/index.js";
import type { Db } from "./db.js";
import { validSubscription, type PushSubscriptionData } from "./push.js";
import { RateLimiter } from "./security.js";
import { localHour } from "../store/orders.js";
import { publicView } from "../store/subLinks.js";
import { alertText, dueForCustomer, dueForToken, laDay, myLinkTokens, renewWaText, tokenAlive, type DueItem } from "../store/expiryAlerts.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { params: Record<string, string>; body: any; actor?: any; ip: string };
type Route = (method: string, path: string, who: Who, handler: (c: Ctx) => unknown) => void;
type Msg = { title: string; body: string; url: string };

export interface ExpiryPushDeps {
  route: Route;
  store: GabrielStore;
  db: Db;
  now: () => number;
  pushOn: () => boolean;
  publicKey: () => string | null;
  /** Manda un toque a una suscripción: "ok", "gone" (borrarla) o tira error. */
  send: (sub: PushSubscriptionData) => Promise<"ok" | "gone">;
  /** Aviso a un cliente con cuenta (todas sus suscripciones; borra las muertas). */
  customerPush: (customerId: string, msg: Msg) => Promise<{ sent: number; failed: number }>;
  /** Clientes con cuenta que activaron avisos en algún celular. */
  customerIds: () => string[];
  /** El mismo límite por IP de /api/cobro/* (cuenta los tokens que no sirven). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  cobro: <T>(c: any, fn: () => T) => T;
  tooMany: () => never;
}

/** Suscripción de un navegador atada a un link /c/<token>. */
interface TSub extends PushSubscriptionData { token: string; createdAt: number }
type Stats = { day: string; sent: number; customers: number; links: number; failed: number; /** Hora real del último aviso enviado hoy (para la oficina). */ lastAt?: number };

const MAX_PER_TOKEN = 5, MAX_TOTAL = 20_000, LOG_DAYS = 10;
const TOKEN_RE = /^[A-Za-z0-9_-]{32,64}$/;

export function createExpiryPush(d: ExpiryPushDeps) {
  const { db, store, now } = d;
  const e = store.engine;
  const read = <T>(name: string, dflt: T): T => { try { const v = JSON.parse(db.getSecret(name) ?? "null"); return v ?? dflt; } catch { return dflt; } };
  const tsubs = (): TSub[] => { const l = read<TSub[]>("push_tsubs", []); return Array.isArray(l) ? l : []; };
  const tsubsSave = (l: TSub[]) => db.setSecret("push_tsubs", l.length ? JSON.stringify(l) : null, now());
  /** Texto del último aviso por endpoint (lo pide el service worker; en memoria, 6 horas). */
  const latest = new Map<string, Msg & { at: number }>();

  /** Borra las suscripciones de links que ya no sirven. Devuelve cuántas borró. */
  function purge(): number {
    const list = tsubs();
    if (!list.length) return 0;
    const alive = new Map<string, boolean>();
    const keep = list.filter((x) => { if (!alive.has(x.token)) alive.set(x.token, tokenAlive(e, x.token)); return alive.get(x.token); });
    if (keep.length !== list.length) tsubsSave(keep);
    return list.length - keep.length;
  }
  const hasAlerts = (token: string) => tsubs().some((x) => x.token === token);

  const stats = (): Stats => {
    const s = read<Stats | null>("exp_stats", null), day = laDay(now());
    return s && s.day === day ? s : { day, sent: 0, customers: 0, links: 0, failed: 0 };
  };

  /** Una vez por día, desde las 9 (Bolivia): 3 días antes, 1 día antes y el día que vence. */
  async function check(): Promise<Stats | null> {
    if (!d.pushOn() || localHour(now(), "America/La_Paz") < 9) return null;
    const day = laDay(now());
    if (db.getSecret("exp_day") === day) return null;
    db.setSecret("exp_day", day, now());
    purge();
    const t = now();
    // Registro de lo ya avisado: "<servicio>|<vence>|<etapa>" y "<servicio>|día" → día. Se limpia solo.
    const log = read<Record<string, string>>("exp_log", {});
    const oldest = laDay(t - LOG_DAYS * 86_400_000);
    for (const k of Object.keys(log)) if (log[k] < oldest) delete log[k];
    const fresh = (it: DueItem) => !log[`${it.key}|${it.expiresAt}|${it.days}`] && log[`${it.key}|día`] !== day;
    const mark = (it: DueItem) => { log[`${it.key}|${it.expiresAt}|${it.days}`] = day; log[`${it.key}|día`] = day; };
    const st: Stats = { ...stats(), day };

    // 1) Clientes con cuenta (tienda o cliente de un revendedor).
    for (const cid of new Set(d.customerIds())) {
      const { items: all, via } = dueForCustomer(e, cid, t);
      const items = all.filter(fresh);
      if (!items.length) continue;
      let url = "/tienda/#cuentas";
      if (via?.whatsapp) url = `https://wa.me/${via.whatsapp}?text=${encodeURIComponent(renewWaText(items))}`;
      else if (via?.page) url = via.page;
      const msg = alertText(items, via ? { seller: via.name, action: via.whatsapp ? "write" : via.page ? "page" : "none" } : undefined);
      const r = await d.customerPush(cid, { ...msg, url }).catch(() => ({ sent: 0, failed: 1 }));
      if (r.sent) { items.forEach(mark); st.sent++; st.customers++; st.lastAt = now(); } else if (r.failed) st.failed++;
    }

    // 2) Clientes sin cuenta, por su link /c/<token>. Un aviso por celular (endpoint), agrupado.
    const subs = tsubs();
    const due = new Map<string, (DueItem & { token: string; seller: string }) | null>();
    for (const x of subs) {
      if (due.has(x.token)) continue;
      const r = dueForToken(e, x.token, t);
      due.set(x.token, r?.item && fresh(r.item) ? { ...r.item, token: x.token, seller: r.seller } : null);
    }
    const byEndpoint = new Map<string, TSub[]>();
    for (const x of subs) if (due.get(x.token)) byEndpoint.set(x.endpoint, [...(byEndpoint.get(x.endpoint) ?? []), x]);
    const ok = new Set<string>(), gone = new Set<string>();
    for (const [endpoint, list] of byEndpoint) {
      const items = list.map((x) => due.get(x.token)!).sort((a, b) => a.expiresAt - b.expiresAt);
      const sellers = new Set(items.map((x) => x.seller));
      const msg = alertText(items, { seller: sellers.size === 1 ? items[0].seller : "", action: "pay" });
      latest.set(endpoint, { ...msg, url: `/c/${items[0].token}`, at: now() });
      try {
        if ((await d.send(list[0])) === "gone") gone.add(endpoint);
        else { st.sent++; st.links++; st.lastAt = now(); items.forEach((x) => ok.add(x.token)); }
      } catch { st.failed++; }
    }
    for (const tk of ok) mark(due.get(tk)!);
    if (gone.size) { tsubsSave(tsubs().filter((x) => !gone.has(x.endpoint))); gone.forEach((ep) => latest.delete(ep)); }
    db.setSecret("exp_log", JSON.stringify(log), now());
    db.setSecret("exp_stats", JSON.stringify(st), now());
    return st;
  }

  /* ---------------- rutas ---------------- */
  const writes = new RateLimiter(30, 15 * 60_000, now);
  const reads = new RateLimiter(60, 15 * 60_000, now);
  const tokenOf = (c: Ctx) => { publicView(e, c.params.token); return c.params.token; }; // NOT_FOUND genérico si no sirve
  const endpointOf = (v: unknown) => { const s = String(v ?? ""); if (!s || s.length > 1000) throw new DomainError("VALIDATION", "Falta el celular"); return s; };

  // Página del link: ¿se pueden activar avisos? (la clave pública VAPID no es un secreto).
  d.route("GET", "/api/cobro/:token/alerts", "public", (c) => d.cobro(c, () => { tokenOf(c); return { configured: d.pushOn(), publicKey: d.pushOn() ? d.publicKey() : null }; }));
  // Activar, apagar o consultar los avisos de ESTE navegador para ESTE link. Sin sesión: el token es la llave.
  d.route("POST", "/api/cobro/:token/alerts", "public", (c) => {
    if (!writes.take(c.ip)) d.tooMany();
    return d.cobro(c, () => {
      const token = tokenOf(c), action = String(c.body?.action ?? "");
      if (action === "on") {
        if (!d.pushOn()) throw new DomainError("INVALID_STATE", "Los avisos al celular todavía no están prendidos");
        const sub = validSubscription(c.body?.subscription);
        if (!sub) throw new DomainError("VALIDATION", "Este navegador no dio una suscripción válida");
        const others = tsubs().filter((x) => !(x.endpoint === sub.endpoint && x.token === token));
        const mine = others.filter((x) => x.token === token).sort((a, b) => a.createdAt - b.createdAt);
        const drop = new Set(mine.slice(0, Math.max(0, mine.length - (MAX_PER_TOKEN - 1))));
        const next = [...others.filter((x) => !drop.has(x)), { ...sub, token, createdAt: now() }];
        if (next.length > MAX_TOTAL) throw new DomainError("INVALID_STATE", "No pudimos activar los avisos ahora. Probá más tarde.");
        tsubsSave(next);
        return { ok: true, on: true };
      }
      if (action === "off") {
        const ep = endpointOf(c.body?.endpoint);
        const list = tsubs(), keep = list.filter((x) => !(x.endpoint === ep && x.token === token));
        if (keep.length !== list.length) tsubsSave(keep);
        return { ok: true, on: false };
      }
      if (action === "check") { const ep = endpointOf(c.body?.endpoint); return { on: tsubs().some((x) => x.endpoint === ep && x.token === token) }; }
      throw new DomainError("VALIDATION", "Acción inválida");
    });
  });
  // El service worker pide el texto del último aviso con el endpoint de su suscripción (no hay sesión).
  d.route("POST", "/api/cobro-push/latest", "public", (c) => {
    if (!reads.take(c.ip)) d.tooMany();
    const ep = String(c.body?.endpoint ?? "");
    const m = ep ? latest.get(ep) : undefined;
    if (m && now() - m.at < 6 * 3_600_000) return m;
    const any = ep ? tsubs().find((x) => x.endpoint === ep) : undefined;
    return { title: "Tenés un aviso", body: "Tocá para verlo.", url: any ? `/c/${any.token}` : "/", at: 0 };
  });
  // Revendedor: cuáles de SUS clientes (links de cobro) reciben avisos solos. Solo ids suyos, nunca endpoints.
  d.route("GET", "/api/me/link-alerts", "customer", (c) => {
    const mine = myLinkTokens(e, c.actor);
    purge();
    const on = new Set(tsubs().map((x) => x.token));
    const subs = mine.subs.filter((x) => on.has(x.token)).map((x) => x.id);
    const own = mine.own.filter((x) => on.has(x.token)).map((x) => x.id);
    return { subs, own, count: subs.length + own.length };
  });
  // Dueño y equipo: solo conteos del día.
  d.route("GET", "/api/admin/expiry-alerts", "staff", () => {
    const s = stats();
    return { day: s.day, sent: s.sent, customers: s.customers, links: s.links, failed: s.failed, on: d.pushOn() };
  });

  return { check, purge, stats, hasAlerts: (token: string) => TOKEN_RE.test(token) && hasAlerts(token) };
}
