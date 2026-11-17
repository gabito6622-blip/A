// 📒 «Mis hojas» del revendedor en GaboHub (17/11/2026). Lo mismo que «📗 Mis hojas» del dueño (panel-hojas.js),
// pero con SUS clientes: los servicios de la tienda que vendió (Mi control), sus cuentas propias (ownStock) y los
// perfiles que reparte de sus cuentas completas (subRentals). Es otra forma de ver lo mismo: cada cambio pasa por la
// misma función de núcleo que su pantalla de siempre (mismos permisos, misma auditoría, misma plata).
//
// Separación: todo se resuelve con la sesión (c.actor). Las funciones de núcleo ya filtran por el revendedor que
// entró; acá además las filas se arman SIN contraseñas, SIN costos de la tienda y SIN ganancias.
// Plan: leer las hojas pide lo mismo que Mi control (needPlan("control")). Anotar (Me pagó, fecha, nota) queda
// abierto como en Mi control, para que lo anotado sin internet antes de vencer el plan igual se suba.
// Sin internet: el celular guarda la copia y manda los cambios después. Cada cambio lleva una llave (idempotencia:
// reintentar nunca renueva dos veces) y la foto de cómo estaba la fila; si cambió mientras tanto, responde 409
// CONFLICT con qué cambió y el celular pregunta antes de mandarlo con `force`.
import type { Actor, GabrielStore } from "../store/index.js";
import { DomainError } from "../store/index.js";

type Who = "public" | "customer" | "staff";
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Ctx = { params: Record<string, string>; body: any; actor?: Actor };
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Route = (method: string, path: string, who: Who, handler: (c: any) => unknown, maxBody?: number) => void;

export interface HubHojasDeps {
  route: Route;
  store: GabrielStore;
  /** El mismo control de suscripción que Mi control. */
  guard: (c: { actor?: Actor }) => void;
}

/** Una fila de la hoja. k: t = servicio de la tienda, o = cuenta propia, s = perfil repartido. */
export interface HojaRow {
  k: "t" | "o" | "s";
  id: string;
  p: string; // producto
  e: string; // correo o usuario de la cuenta (nunca la contraseña)
  pr: string; // perfil o cupo
  cn: string; // cliente
  ph: string; // su WhatsApp
  x: number; // vence
  h?: 1; // esperando fecha (la tienda la deja abierta)
  pay: string;
  n: string; // nota
  m: number; // lo que le cobra a su cliente (su precio, no el costo)
  debt?: number;
  trial?: 1;
}

const DD = (t: number) => { const d = new Date(t); return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`; };

export function hojasRows(store: GabrielStore, actor: Actor): HojaRow[] {
  const rows: HojaRow[] = [];
  for (const a of store.rtools.control(actor)) {
    rows.push({ k: "t", id: a.id, p: a.product, e: a.email, pr: a.profile, cn: a.client, ph: a.phone, x: a.expiresAt, ...(a.holdOpen ? { h: 1 as const } : {}), pay: a.pay, n: a.note, m: a.price ?? 0 });
  }
  for (const s of store.own.view(actor).sales) {
    rows.push({ k: "o", id: s.id, p: s.product, e: s.user, pr: `Cupo ${s.slot}`, cn: s.name, ph: s.phone, x: s.expiresAt, pay: s.pay, n: s.note ?? "", m: s.price ?? 0, ...(s.debt ? { debt: s.debt } : {}), ...(s.trial ? { trial: 1 as const } : {}) });
  }
  for (const r of store.subs.list(actor)) {
    for (const s of r.subs) {
      rows.push({ k: "s", id: `${r.assignmentId}:${s.id}`, p: r.product, e: r.email, pr: s.label, cn: s.name, ph: s.phone ?? "", x: s.expiresAt, pay: s.pay, n: s.note ?? "", m: s.price ?? 0, ...(s.owed ? { debt: s.owed } : {}) });
    }
  }
  return rows;
}

const OPS = ["pay", "date", "note"] as const;
type Op = (typeof OPS)[number];

/** Qué cambió desde que el celular guardó la copia ("" = nada que preguntar). */
function changed(op: Op, base: { x?: unknown; pay?: unknown; n?: unknown }, cur: HojaRow): string {
  if (op === "note") return (cur.n || "") !== String(base.n ?? "") ? "alguien cambió la nota" : "";
  if (base.x !== undefined && Number(base.x) !== cur.x) return `la fecha cambió: ahora vence el ${DD(cur.x)}`;
  if (op === "pay" && cur.k === "t" && cur.pay === "pagado" && base.pay !== "pagado") return "ya figura como pagada";
  return "";
}

export function hojasOp(store: GabrielStore, actor: Actor, body: Record<string, unknown>) {
  const e = store.engine;
  const op = String(body.t ?? "") as Op;
  if (!OPS.includes(op)) throw new DomainError("VALIDATION", "Cambio desconocido");
  const id = String(body.row ?? "");
  const key = typeof body.k === "string" && body.k ? `hojas:${actor.customerId}:${body.k.slice(0, 80)}` : undefined;
  return e.tx(() => e.idempotent(key, () => {
    const cur = hojasRows(store, actor).find((r) => r.id === id);
    if (!cur) throw new DomainError("NOT_FOUND", "Ese cliente ya no está en tus hojas (lo liberaste, se cortó o venció la cuenta)");
    const base = (body.base && typeof body.base === "object" ? body.base : {}) as { x?: unknown; pay?: unknown; n?: unknown };
    const why = body.force === true ? "" : changed(op, base, cur);
    if (why) throw new DomainError("INVALID_STATE", `Mientras tanto ${why}`);
    const v = body.v;
    if (op === "date") {
      const t = Number(v);
      if (!Number.isFinite(t) || t <= 0) throw new DomainError("VALIDATION", "Elegí una fecha");
    }
    if (cur.k === "t") {
      if (op === "date") throw new DomainError("VALIDATION", "La fecha de una cuenta de la tienda la cambia la tienda: renovala desde Mi control");
      store.rtools.setControl(actor, cur.id, op === "pay" ? { payStatus: "pagado" } : { note: String(v ?? "") });
    } else if (cur.k === "o") {
      if (op === "pay") store.own.renew(actor, cur.id, { paid: true });
      else store.own.updateSale(actor, cur.id, op === "date" ? { expiresAt: Number(v) } : { note: String(v ?? "") });
    } else {
      const [aid, sid] = cur.id.split(":");
      if (op === "pay") store.subs.renew(actor, aid, sid, true);
      else {
        // Corregir un perfil manda la ficha entera (como Repartir perfiles), cambiando solo lo pedido.
        const s = store.subs.list(actor).find((r) => r.assignmentId === aid)?.subs.find((x) => x.id === sid);
        if (!s) throw new DomainError("NOT_FOUND", "Ese perfil ya no está");
        store.subs.save(actor, aid, { id: s.id, label: s.label, name: s.name, phone: s.phone ?? "", expiresAt: op === "date" ? Number(v) : s.expiresAt, price: s.price ?? "", pay: s.pay, note: op === "note" ? String(v ?? "") : s.note ?? "" });
      }
    }
    const row = hojasRows(store, actor).find((r) => r.id === id) ?? null;
    return { ok: true as const, row };
  }));
}

export function registerHubHojasRoutes(d: HubHojasDeps): void {
  const { store } = d;
  d.route("GET", "/api/me/hojas", "customer", (c: Ctx) => { d.guard(c); return { at: store.engine.now(), rows: hojasRows(store, c.actor!) }; });
  d.route("POST", "/api/me/hojas/op", "customer", (c: Ctx) => hojasOp(store, c.actor!, c.body ?? {}));
}
