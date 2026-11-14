// Seguridad del EQUIPO (revisión del 14/11/2026, «arreglá todo»): llave del asistente con poder limitado y que vence,
// filtros de la Auditoría (persona y período), ingresos del equipo en la Auditoría y avisos al dueño cuando alguien
// del equipo hace algo delicado (exportar clientes, mirar muchas contraseñas, dar acceso a un revendedor).
import type { Actor, AuditEvent, Role } from "../store/types.js";
import type { Engine } from "../store/engine.js";
import { boDayStart, DAY, HOUR } from "../store/time.js";

/* ---------------- llave del asistente ---------------- */

/** Días que dura una llave del asistente. Después se crea una nueva («🔁 Crear llave nueva» en Usuarios). */
export const ASSISTANT_KEY_DAYS = 7;
export type AssistKey = { hash: string; staffId: string; createdAt: number; lastUsedAt?: number; expiresAt?: number };

/**
 * ¿La llave sigue valiendo? Las llaves creadas antes de este cambio no tienen vencimiento: toman 7 días desde su
 * primer uso después del cambio (así no se corta una llave en uso apenas se publica). `patch` es lo que hay que guardar.
 */
export function assistKeyCheck(k: AssistKey, now: number): { expired: boolean; patch?: Partial<AssistKey> } {
  if (!k.expiresAt) return { expired: false, patch: { expiresAt: now + ASSISTANT_KEY_DAYS * DAY } };
  return { expired: now >= k.expiresAt };
}

const NO_ACCESS = "La llave del asistente no genera PIN ni links de acceso: los da el dueño o su equipo desde el panel";
const NO_EXPORT = "La llave del asistente no descarga Excel con datos de clientes: lo descarga el dueño desde su panel";
const NO_USERS = "La llave del asistente no cambia usuarios, contraseñas ni permisos";
/** Rutas que la llave del asistente no puede usar aunque entre como admin. La matriz de permisos frena el resto (auth.ts). */
const ASSISTANT_BLOCK: [method: string, re: RegExp, why: string][] = [
  ["POST", /^\/api\/admin\/customers\/[^/]+\/(login-pin|login-link|code-link)$/, NO_ACCESS],
  ["POST", /^\/api\/admin\/assignments\/[^/]+\/renew-link$/, NO_ACCESS],
  ["POST", /^\/api\/admin\/reseller-apps\/[^/]+\/approve$/, "La llave del asistente no aprueba revendedores (al aprobar se genera su PIN): lo hace el dueño"],
  ["GET", /^\/api\/admin\/(export\/|descargas\/reporte\.xlsx$|finance\/cierre\.xlsx$)/, NO_EXPORT],
  ["*", /^\/api\/admin\/(staff|assistant)(\/|$)/, NO_USERS],
  ["POST", /^\/api\/admin\/me\/(password|2fa)/, NO_USERS],
  ["GET", /^\/api\/admin\/codes$/, "La llave del asistente no ve los códigos de acceso de las cuentas"],
];
/** Mensaje de por qué la llave del asistente no puede usar esta ruta, o null si puede. */
export function assistantBlocked(method: string, path: string): string | null {
  const hit = ASSISTANT_BLOCK.find(([m, re]) => (m === "*" || m === method) && re.test(path));
  return hit ? hit[2] : null;
}

/* ---------------- Auditoría: período e ingresos del equipo ---------------- */

export type AuditPeriod = "hoy" | "ayer" | "7d" | "todo";
/** Hoy / Ayer / 7 días (hoy y los 6 anteriores) / Todo, cortando los días a la hora de Bolivia. */
export function auditRange(period: string | null | undefined, now: number): { from?: number; to?: number } {
  if (period === "hoy") return { from: boDayStart(now) };
  if (period === "ayer") return { from: boDayStart(now, -1), to: boDayStart(now) };
  if (period === "7d") return { from: boDayStart(now, -6) };
  return {};
}

/** Un ingreso del equipo (tabla access_log) con la forma de una línea de Auditoría: «access.login», «access.login_fail»… */
export function accessAsAudit(r: { at: number; subjectId: string; event: string; via?: string; ok: boolean }, role: Role, device: string, i: number): AuditEvent {
  return {
    id: `acc_${r.at}_${i}`, at: r.at, actorId: r.subjectId, role, action: `access.${r.event}`, entity: "staff", entityId: r.subjectId,
    data: { ok: r.ok, ...(r.via ? { with: r.via } : {}), ...(device ? { device } : {}) },
  };
}

/* ---------------- avisos al dueño ---------------- */

/** Excel con datos personales de clientes (nombres, WhatsApp, saldos). */
const PERSONAL_EXPORTS: Record<string, string> = { clientes: "Clientes", servicios: "Servicios activos", todo: "Todo", ventas: "Ventas", movimientos: "Movimientos de saldo", reporte: "Reporte del negocio" };
/** Vistas de datos de acceso: «Entregar» (correo + contraseña + PIN) y «ver contraseñas» de Cuentas. */
const SECRET_VIEWS = new Set(["assignment.deliver", "secrets.view"]);
export const SECRET_VIEWS_PER_DAY = 20;

export interface TeamWatch {
  /** Después de cada pedido del equipo: mira lo que esa persona dejó en la Auditoría y avisa al dueño si hace falta. */
  after(actor: Actor, auditFrom: number): void;
}

/**
 * Avisa al dueño (al celular) cuando alguien del equipo —no el dueño— exporta datos de clientes, ve más de 20
 * accesos o contraseñas en un día, o genera un PIN o link de revendedor. Como mucho 1 aviso por persona y tipo
 * por hora. El aviso también queda en la Auditoría («avisó al dueño»), así se ve aunque no tenga avisos activados.
 */
export function createTeamWatch(o: { engine: Engine; now: () => number; notify: (title: string, body: string) => void; perDay?: number }): TeamWatch {
  const last = new Map<string, number>();
  const perDay = o.perDay ?? SECRET_VIEWS_PER_DAY;
  const views = (ev: AuditEvent) => {
    if (ev.action === "secrets.view") return Math.max(1, Object.keys(o.engine.s.accounts).length); // vio TODAS las contraseñas
    if (ev.action === "export" && ev.data?.withSecrets === true) return Math.max(1, Object.keys(o.engine.s.accounts).length);
    return SECRET_VIEWS.has(ev.action) && ev.data?.hidden !== true ? 1 : 0;
  };
  const viewsToday = (actorId: string) => {
    const audit = o.engine.s.audit, from = boDayStart(o.now());
    let n = 0;
    for (let i = audit.length - 1; i >= 0 && audit[i].at >= from; i--) if (audit[i].actorId === actorId) n += views(audit[i]);
    return n;
  };
  const fire = (actor: Actor, kind: string, title: string, body: string) => {
    const k = `${actor.id}|${kind}`, t = last.get(k);
    if (t !== undefined && o.now() - t < HOUR) return;
    last.set(k, o.now());
    try { o.engine.tx(() => o.engine.audit({ id: "system:equipo", role: "system" }, "team.alert", "staff", actor.id, { kind, title })); } catch { /* el aviso nunca frena nada */ }
    try { o.notify(title, body); } catch { /* sin avisos */ }
  };
  return {
    after(actor, auditFrom) {
      if (!actor || actor.customerId || (actor.role !== "admin" && actor.role !== "seller")) return;
      const s = o.engine.s;
      const mine = s.audit.slice(auditFrom).filter((a) => a.actorId === actor.id);
      if (!mine.length) return;
      const who = s.staff[actor.id]?.name ?? "Alguien del equipo";
      for (const ev of mine) {
        if (ev.action === "export" && PERSONAL_EXPORTS[ev.entityId]) {
          fire(actor, "export", `📤 ${who} exportó datos de clientes`, `Descargó el Excel «${PERSONAL_EXPORTS[ev.entityId]}». Si no lo esperabas, mirá la Auditoría.`);
        }
        const cust = ev.entity === "customer" ? s.customers[ev.entityId] : ev.action === "reseller.approve" ? s.customers[String(ev.data?.customerId ?? "")] : undefined;
        const resellerKey = ((ev.action === "customer.login_pin" || ev.action === "customer.login_link" || ev.action === "customer.code_link") && cust?.kind === "reseller") || ev.action === "reseller.approve";
        if (resellerKey) {
          const name = cust?.name ?? "un revendedor";
          const what = ev.action === "customer.login_link" ? "un link de acceso" : ev.action === "customer.code_link" ? "un link de códigos" : "un PIN de acceso";
          fire(actor, "reseller_access", `🔑 ${who} generó un acceso de revendedor`, `Le dio ${what} a ${name}. Si no lo esperabas, mirá la Auditoría.`);
        }
      }
      if (mine.some((ev) => views(ev) > 0)) {
        const n = viewsToday(actor.id);
        if (n > perDay) fire(actor, "secrets", `👀 ${who} vio ${n} accesos hoy`, `Abrió datos de entrega o contraseñas de cuentas ${n} veces hoy. Si no es normal, mirá la Auditoría.`);
      }
    },
  };
}
