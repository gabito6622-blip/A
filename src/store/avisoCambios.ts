// «Cambió tu cuenta: avisá a tus N clientes» siempre (revisión de 3 meses, R2 · 14/11/2026). Lo que pasaba:
//  - Si la tienda cambiaba la CLAVE o el CORREO de una cuenta que un revendedor alquila (inventario «Cambié la clave» o
//    editar la cuenta), GaboHub no decía nada: solo un WhatsApp de la tienda en cola, si el bot estaba prendido.
//  - Una cuenta caída o movida solo avisaba dentro de «Repartir perfiles», no en Inicio ni en «Mis cuentas».
//  - El mensaje para sus clientes no llevaba la clave nueva: había que copiarla de «Mis cuentas» y pegarla chat por chat.
//  - Si la tienda pasaba a otra cuenta a un CLIENTE del revendedor (falla resuelta), el revendedor no se enteraba.
// Ahora cada cambio (caída, cambio de cuenta, de clave, de correo o de PIN) queda como un aviso hasta «✓ Ya les avisé»,
// con los datos nuevos para copiar y un mensaje por cliente que ya los lleva. Solo SUS servicios y los de SUS clientes.
// Este aviso NO lleva claves: GaboHub las toma de «Mis cuentas» (/api/me/services), que ya las muestra y las audita.
import type { Actor, Assignment, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { DomainError } from "./errors.js";
import { DAY } from "./time.js";

/** Un cambio de cuenta, de clave o de correo se avisa durante estos días (una caída, mientras siga caída). */
export const CHANGE_DAYS = 30;

export type ChangeKind = "fallen" | "moved" | "password" | "email" | "access" | "pin";

function myCustomerId(actor: Actor): Id {
  if ((actor.role !== "reseller" && actor.role !== "customer") || !actor.customerId) throw new DomainError("FORBIDDEN", "Solo para clientes y revendedores");
  return actor.customerId;
}

/** Qué cambió por última vez en este servicio (y cuándo), según su historial. */
function lastChange(e: Engine, a: Assignment, now: number): { kind: ChangeKind; at: number } | undefined {
  const acc = e.s.accounts[e.s.slots[a.slotId]?.accountId ?? ""];
  let best: { kind: ChangeKind; at: number } | undefined;
  for (const h of a.history) {
    if (now - h.at > CHANGE_DAYS * DAY || (best && h.at < best.at)) continue;
    if (h.event === "replaced") best = { kind: "moved", at: h.at };
    else if (h.event === "access_updated") {
      const n = (h.note ?? "").toLowerCase();
      // Notas que dejan inventario.ts (rotatePassword) e inventory.ts (updateAccount, updateSlot).
      const kind: ChangeKind = /correo y clave/.test(n) ? "access" : /clave/.test(n) ? "password" : /correo/.test(n) ? "email" : /pin|perfil/.test(n) ? "pin" : "access";
      best = { kind, at: h.at };
    }
  }
  const fallen = acc?.status === "active" ? acc.fallen?.at : undefined;
  if (fallen && (!best || fallen >= best.at)) best = { kind: "fallen", at: fallen };
  return best;
}

const short = (n: string) => n.replace(/\s*\(alquiler revendedores\)\s*$/i, "");
const plural = (n: number) => `${n} cliente${n === 1 ? "" : "s"}`;
const WHAT: Record<ChangeKind, string> = { fallen: "Se cayó", moved: "Cambió la cuenta de", password: "Cambió la clave de", email: "Cambió el correo de", access: "Cambiaron los datos de", pin: "Cambió el PIN de" };

/** El título del aviso (cartel y celular): «Cambió la clave de tu HBO Max: avisá a tus 2 clientes». */
export function changeTitle(x: { kind: ChangeKind; product: string; clients: unknown[]; forClient?: string }): string {
  const n = x.clients.length;
  const whose = x.forClient ? `el ${x.product} de ${x.forClient.split(" ")[0]}` : `tu ${x.product}`;
  const head = x.kind === "fallen" ? `Se cayó ${whose}` : `${WHAT[x.kind]} ${whose}`;
  return n ? `${head}: avisá a ${x.forClient ? "tu cliente" : `tus ${plural(n)}`}` : head;
}

/**
 * Cambios en servicios de quien pregunta (sus cuentas completas alquiladas y los servicios de sus clientes) que todavía
 * no marcó «Ya les avisé». Sin claves ni costos: la clave nueva la pone GaboHub desde «Mis cuentas».
 */
export function accountChanges(e: Engine, actor: Actor) {
  const me = myCustomerId(actor);
  const now = e.now();
  const out = [];
  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active") continue;
    const owner = e.s.customers[a.customerId];
    const own = a.customerId === me;
    // Lo suyo: las cuentas completas alquiladas (un perfil suelto propio ya recibe su aviso). Lo de sus clientes: todo.
    if (own ? e.s.products[a.productId]?.kind !== "full_account" : !(actor.role === "reseller" && owner?.resellerId === me)) continue;
    const ch = lastChange(e, a, now);
    if (!ch || ch.at <= (a.changeSeenAt ?? 0)) continue;
    const slot = e.s.slots[a.slotId], acc = e.s.accounts[slot?.accountId ?? ""];
    const product = short(e.s.products[a.productId]?.name ?? "");
    const clients = own
      ? (a.subs ?? []).map((s) => ({ id: s.id, name: s.name, phone: s.phone ?? "", label: s.label ?? "" }))
      : [{ id: owner!.id, name: owner!.name, phone: owner!.phone ?? "", label: slot?.label ?? "" }];
    const item = { assignmentId: a.id, kind: ch.kind, at: ch.at, product, email: acc?.email ?? "", profile: slot?.label ?? "", full: e.s.products[a.productId]?.kind === "full_account", clients, ...(own ? {} : { forClient: owner!.name }) };
    out.push({ ...item, title: changeTitle(item) });
  }
  return out.sort((x, y) => y.at - x.at);
}

/** «✓ Ya les avisé»: saca el aviso de esa cuenta (hasta el próximo cambio). Solo sobre lo suyo o de sus clientes. */
export function accountChangeSeen(e: Engine, actor: Actor, assignmentId: Id) {
  const me = myCustomerId(actor);
  return e.tx(() => {
    const a = e.s.assignments[assignmentId];
    const mine = !!a && (a.customerId === me || (actor.role === "reseller" && e.s.customers[a.customerId]?.resellerId === me));
    if (!a || !mine) throw new DomainError("NOT_FOUND", "No se encontró esa cuenta");
    a.changeSeenAt = e.now();
    e.audit(actor, "account.change_seen", "assignment", a.id);
    return { ok: true as const };
  });
}

/**
 * Para el aviso al celular: los cambios nuevos desde `since` (sin contraseñas: el aviso solo dice qué cambió).
 * El servidor guarda hasta cuándo ya avisó a cada uno.
 */
export function changesSince(e: Engine, customerId: Id, since: number) {
  const c = e.s.customers[customerId];
  if (!c) return [];
  const actor: Actor = { id: `push:${customerId}`, role: c.kind === "reseller" ? "reseller" : "customer", customerId };
  const now = e.now();
  const list = [];
  for (const a of Object.values(e.s.assignments)) {
    if (a.status !== "active") continue;
    const own = a.customerId === customerId;
    if (own ? e.s.products[a.productId]?.kind !== "full_account" : !(actor.role === "reseller" && e.s.customers[a.customerId]?.resellerId === customerId)) continue;
    const ch = lastChange(e, a, now);
    if (!ch || ch.at <= since || ch.at <= (a.changeSeenAt ?? 0)) continue;
    const x = { kind: ch.kind, at: ch.at, product: short(e.s.products[a.productId]?.name ?? ""), clients: own ? (a.subs ?? []) : [a.customerId], ...(own ? {} : { forClient: e.s.customers[a.customerId]?.name ?? "" }) };
    list.push({ ...x, title: changeTitle(x) });
  }
  return list.sort((x, y) => y.at - x.at);
}

/** Texto del aviso al celular por cambios nuevos (o null si no hay). */
export function changePushText(e: Engine, customerId: Id, since: number): { title: string; body: string; url: string; at: number } | null {
  const l = changesSince(e, customerId, since);
  if (!l.length) return null;
  const at = Math.max(...l.map((x) => x.at));
  if (l.length === 1) {
    const x = l[0];
    return { title: `${x.kind === "fallen" ? "⚠️" : "🔁"} ${x.title}`, body: x.kind === "fallen" ? "La tienda la está cambiando. Abrí GaboHub para avisarles." : "Abrí GaboHub: el mensaje para cada cliente ya lleva los datos nuevos.", url: "/hub#inicio", at };
  }
  return { title: `🔁 Cambiaron ${l.length} cuentas tuyas`, body: `${l.slice(0, 3).map((x) => x.title.split(":")[0]).join(" · ")}. Abrí GaboHub para avisar a tus clientes.`, url: "/hub#inicio", at };
}

/**
 * Falla resuelta: ¿después del reporte la tienda le cambió la cuenta, la clave o el PIN? Entonces «💬 Avisar a mi cliente»
 * tiene que llevar los datos nuevos (antes decía solo «probá entrar de nuevo»). GaboHub los toma de «Mis cuentas».
 */
export function ticketAccessChanged(e: Engine, t: { assignmentId: Id; createdAt: number; status: string }): boolean {
  if (t.status !== "solucionado") return false;
  const a = e.s.assignments[t.assignmentId];
  return !!a && a.status === "active" && a.history.some((h) => h.at >= t.createdAt && (h.event === "replaced" || h.event === "access_updated"));
}
