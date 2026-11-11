// Primeros pasos de una clínica nueva: lista de verificación calculada SIEMPRE desde los datos reales
// (no hay casillas manuales). Cada ítem dice qué falta y enlaza a la pantalla exacta donde se hace.
// Solo propietario y administración (clinic.manage). Se puede ocultar del Inicio cuando está completa;
// si después algo vuelve a faltar (p. ej. una sucursal nueva sin consultorios), reaparece.
import { z } from "zod";
import type { Route } from "../../lib/http.js";
import type { Client } from "../../lib/db.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { ROLE_LABELS, type Role } from "../../lib/rbac.js";
import { audit } from "../../lib/audit.js";
import { conflict } from "../../lib/errors.js";
import { DEFAULT_PROCEDURES } from "../../lib/catalog.js";

export interface ChecklistItem {
  id: string;
  title: string;
  description: string;
  done: boolean;
  optional: boolean;
  /** Aviso aunque el paso esté hecho (p. ej. prestaciones que siguen con el precio de ejemplo). */
  warning: string | null;
  /** Qué hay y qué falta, en frases cortas. */
  detail: string[];
  href: string;
  action: string;
}

const PLURAL: Partial<Record<Role, string>> = { owner: "propietarios", admin: "administradores", dentist: "odontólogos", assistant: "asistentes" };
const roleWord = (r: Role, n: number) => (n > 1 && PLURAL[r]) || (ROLE_LABELS[r] ?? r).toLowerCase();
const list = (xs: string[], max = 4) => xs.length <= max ? xs.join(", ") : `${xs.slice(0, max).join(", ")} y ${xs.length - max} más`;

export async function buildChecklist(c: Client, auth: AuthCtx) {
  const clinic = (await c.query<{ legal_name: string | null; tax_id: string | null; hidden_at: string | null }>(
    "SELECT legal_name, tax_id, settings->>'onboardingHiddenAt' AS hidden_at FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!;
  const branches = (await c.query<{ name: string; address: string | null; phone: string | null; hours: number; chairs: number }>(
    `SELECT b.name, b.address, b.phone,
            (SELECT count(*) FROM jsonb_object_keys(b.opening_hours))::int AS hours,
            (SELECT count(*) FROM chairs ch WHERE ch.branch_id = b.id AND ch.active)::int AS chairs
       FROM branches b WHERE b.active ORDER BY b.code`)).rows;
  const staff = (await c.query<{ user_id: string; name: string; role: Role; pro: boolean; mfa: boolean; slots: number }>(
    `SELECT m.user_id, u.full_name AS name, m.role, m.is_professional AS pro, (u.mfa_enabled_at IS NOT NULL) AS mfa,
            (SELECT count(*) FROM dentist_schedules s WHERE s.dentist_id = m.user_id)::int AS slots
       FROM memberships m JOIN users u ON u.id = m.user_id
      WHERE m.clinic_id = $1 AND m.active AND u.disabled_at IS NULL ORDER BY u.full_name`, [auth.clinicId])).rows;
  const procs = (await c.query<{ code: string; name: string; price_cents: number }>("SELECT code, name, price_cents FROM procedures WHERE active")).rows;
  const types = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM appointment_types WHERE active")).rows[0]!.n;
  const consents = (await c.query<{ title: string; version: number; reviewed: boolean }>(
    // Revisada: alguien de la clínica la marcó como revisada (B-096) o la propia clínica guardó esa versión.
    `SELECT t.title, t.version,
            (m.user_id IS NOT NULL OR EXISTS (SELECT 1 FROM consent_template_reviews r WHERE r.template_id = t.id)) AS reviewed
       FROM consent_templates t LEFT JOIN memberships m ON m.clinic_id = t.clinic_id AND m.user_id = t.created_by AND m.role IN ('owner','admin')
      WHERE t.active ORDER BY t.kind, t.title`)).rows;
  const pts = (await c.query<{ total: number; imported: number }>(
    `SELECT count(*)::int AS total,
            count(*) FILTER (WHERE EXISTS (SELECT 1 FROM import_records ir WHERE ir.kind = 'patients' AND ir.patient_id = p.id))::int AS imported
       FROM patients p WHERE p.archived_at IS NULL`)).rows[0]!;
  const imports = (await c.query<{ kind: string; n: number }>("SELECT kind, sum(created_count)::int AS n FROM import_batches GROUP BY kind")).rows;
  const imported = (k: string) => imports.find((x) => x.kind === k)?.n ?? 0;
  const portal = (await c.query<{ enabled: boolean }>("SELECT enabled FROM portal_settings WHERE clinic_id = $1", [auth.clinicId])).rows[0]?.enabled ?? false;
  const rules = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM message_rules WHERE active")).rows[0]!.n;

  const items: ChecklistItem[] = [];

  // 1. Datos de la clínica y membrete
  {
    const missing: string[] = [];
    if (!clinic.legal_name) missing.push("razón social");
    if (!clinic.tax_id) missing.push("NIT");
    const noAddr = branches.filter((b) => !b.address || !b.phone).map((b) => b.name);
    const detail = [missing.length ? `Falta: ${missing.join(" y ")}.` : "Razón social y NIT cargados."];
    if (noAddr.length) detail.push(`Sucursales sin dirección o teléfono (salen en el membrete): ${list(noAddr)}.`);
    items.push({
      id: "clinic", title: "Datos de la clínica y membrete", optional: false,
      description: "La razón social, el NIT y la dirección y el teléfono de cada sucursal salen en el membrete de recetas, recibos y presupuestos en PDF. Por ahora la app no permite subir un logo.",
      done: !missing.length && !noAddr.length && branches.length > 0, warning: null, detail,
      href: missing.length || !noAddr.length ? "/configuracion?tab=clinic" : "/configuracion?tab=branches", action: missing.length || !noAddr.length ? "Abrir Configuración › Clínica" : "Abrir Configuración › Sucursales",
    });
  }
  // 2. Sucursales y consultorios
  {
    const noChairs = branches.filter((b) => b.chairs === 0).map((b) => b.name);
    const noHours = branches.filter((b) => b.hours === 0).map((b) => b.name);
    const detail = [branches.length ? `${branches.length} sucursal${branches.length === 1 ? "" : "es"} activa${branches.length === 1 ? "" : "s"} con ${branches.reduce((s, b) => s + b.chairs, 0)} consultorios.` : "Aún no hay sucursales."];
    if (noChairs.length) detail.push(`Sin consultorios: ${list(noChairs)}.`);
    if (noHours.length) detail.push(`Sin horario de atención: ${list(noHours)}.`);
    items.push({
      id: "branches", title: "Sucursales y consultorios", optional: false,
      description: "Cada sucursal necesita al menos un consultorio y su horario de atención para que la agenda funcione.",
      done: branches.length > 0 && !noChairs.length && !noHours.length, warning: null, detail,
      href: "/configuracion?tab=branches", action: "Abrir Configuración › Sucursales",
    });
  }
  // 3. Personal invitado con su rol
  {
    const others = staff.filter((s) => s.user_id !== auth.userId);
    const byRole = new Map<Role, number>();
    for (const s of staff) byRole.set(s.role, (byRole.get(s.role) ?? 0) + 1);
    const pros = staff.filter((s) => s.pro);
    const detail = [`${staff.length} persona${staff.length === 1 ? "" : "s"} activa${staff.length === 1 ? "" : "s"}: ${[...byRole].map(([r, n]) => `${n} ${roleWord(r, n)}`).join(", ")}.`];
    if (!pros.length) detail.push("Nadie está marcado «Atiende pacientes»: la agenda no tendrá profesionales.");
    if (!others.length) detail.push("Solo estás tú: agrega a recepción, odontólogos y al resto del equipo.");
    items.push({
      id: "staff", title: "Personal invitado con su rol", optional: false,
      description: "Cada persona entra con su propio correo y un rol (recepción, odontólogo, asistente, contabilidad, limpieza…) que define lo que puede ver y hacer.",
      done: others.length > 0 && pros.length > 0, warning: null, detail,
      href: "/configuracion?tab=staff", action: "Abrir Configuración › Personal",
    });
  }
  // 4. Horarios de los profesionales
  {
    const pros = staff.filter((s) => s.pro);
    const without = pros.filter((s) => s.slots === 0).map((s) => s.name);
    items.push({
      id: "schedules", title: "Horarios de los profesionales", optional: false,
      description: "El horario semanal define cuándo y en qué sucursal se le pueden agendar citas a cada profesional.",
      done: pros.length > 0 && !without.length, warning: null,
      detail: !pros.length ? ["Primero marca en Personal quién atiende pacientes."] : without.length ? [`Sin horario: ${list(without)}.`] : [`Los ${pros.length} profesionales tienen horario.`],
      href: "/configuracion?tab=schedules", action: "Abrir Configuración › Horarios",
    });
  }
  // 5. Catálogo de prestaciones con precios
  {
    const sample = new Map(DEFAULT_PROCEDURES.map(([code, name, , priceBs]) => [code, { name, cents: priceBs * 100 }]));
    const still = procs.filter((p) => { const s = sample.get(p.code); return s && s.name === p.name && s.cents === p.price_cents; });
    const own = procs.length - still.length;
    items.push({
      id: "procedures", title: "Prestaciones con tus precios", optional: false,
      description: "El catálogo trae prestaciones con precios de ejemplo. Revisa nombres, precios y duraciones: se usan en presupuestos, citas y cobros.",
      done: procs.length > 0 && own > 0,
      warning: still.length ? `${still.length} de ${procs.length} prestaciones siguen con el precio de ejemplo (${list(still.map((p) => p.code), 5)}).` : null,
      detail: [procs.length ? `${procs.length} prestaciones activas; ${own} con datos propios de la clínica.` : "No hay prestaciones activas."],
      href: "/configuracion?tab=procedures", action: "Abrir Configuración › Prestaciones",
    });
  }
  // 6. Tipos de cita
  items.push({
    id: "appointmentTypes", title: "Tipos de cita", optional: false,
    description: "Primera vez, control, urgencia…: dan color a la agenda y precargan la duración. Se crean seis sugeridos al abrir la agenda por primera vez; ajústalos a tu clínica.",
    done: types > 0, warning: null, detail: [types ? `${types} tipos de cita activos.` : "No hay tipos de cita activos."],
    href: "/configuracion?tab=appointmentTypes", action: "Abrir Configuración › Tipos de cita",
  });
  // 7. Consentimientos revisados
  {
    const pending = consents.filter((t) => !t.reviewed).map((t) => t.title);
    items.push({
      id: "consents", title: "Plantillas de consentimiento revisadas", optional: false,
      description: "Los textos que trae Dentalia son modelos. Una plantilla cuenta como revisada cuando propietario o administración guardan su versión (botón «Nueva versión»), idealmente después de que la revise su asesoría legal.",
      done: consents.length > 0 && !pending.length, warning: null,
      detail: !consents.length ? ["No hay plantillas vigentes."] : pending.length ? [`Sin revisar (${pending.length} de ${consents.length}): ${list(pending, 3)}.`] : [`Las ${consents.length} plantillas vigentes fueron revisadas o guardadas por la clínica.`],
      href: "/configuracion?tab=consents", action: "Abrir Configuración › Consentimientos",
    });
  }
  // 8. Verificación en dos pasos del propietario
  {
    const owners = staff.filter((s) => s.role === "owner");
    const without = owners.filter((s) => !s.mfa).map((s) => s.name);
    const meWithout = owners.some((s) => s.user_id === auth.userId && !s.mfa);
    items.push({
      id: "ownerMfa", title: "Verificación en dos pasos del propietario", optional: false,
      description: "Protege la cuenta con más permisos: además de la contraseña pide un código del celular (Google Authenticator u otra app).",
      done: owners.length > 0 && !without.length, warning: null,
      detail: without.length ? [`Sin activar: ${list(without)}.`] : ["Activada en todas las cuentas de propietario."],
      href: meWithout || !without.length ? "/cuenta" : "/configuracion?tab=staff", action: meWithout || !without.length ? "Abrir Mi cuenta" : "Ver el personal",
    });
  }
  // 9. Pacientes (importados o registrados)
  {
    const detail = [pts.total ? `${pts.total} pacientes registrados${pts.imported ? ` (${pts.imported} importados de tu sistema anterior)` : ""}.` : "Todavía no hay pacientes."];
    if (imported("appointments") || imported("balances")) detail.push(`Importados además: ${imported("appointments")} citas futuras y ${imported("balances")} saldos iniciales.`);
    items.push({
      id: "patients", title: "Pacientes importados", optional: false,
      description: "Trae tus pacientes desde Excel; después puedes traer también las citas futuras y los saldos pendientes de tu sistema anterior.",
      done: pts.total > 0, warning: null, detail,
      href: "/importar?tipo=patients", action: "Abrir Importar datos",
    });
  }
  // 10. Reserva online (opcional)
  items.push({
    id: "portal", title: "Reserva online", optional: true,
    description: "Los pacientes piden o reservan su cita desde el celular con un enlace de la clínica.",
    done: portal, warning: null, detail: [portal ? "Activada." : "Desactivada."],
    href: "/configuracion?tab=portal", action: "Abrir Configuración › Reserva online",
  });
  // 11. Mensajes automáticos (opcional)
  items.push({
    id: "messaging", title: "Mensajes automáticos", optional: true,
    description: "Recordatorios y avisos por WhatsApp a los pacientes que lo aceptaron. Fuera de producción solo se simulan.",
    done: rules > 0, warning: null, detail: [rules ? `${rules} regla${rules === 1 ? "" : "s"} activa${rules === 1 ? "" : "s"}.` : "Ninguna regla activa."],
    href: "/configuracion?tab=messaging", action: "Abrir Configuración › Mensajes automáticos",
  });

  const required = items.filter((i) => !i.optional);
  const doneCount = required.filter((i) => i.done).length;
  const complete = doneCount === required.length;
  return {
    items,
    requiredTotal: required.length,
    requiredDone: doneCount,
    progressPct: Math.round((doneCount / required.length) * 100),
    complete,
    hidden: complete && !!clinic.hidden_at,
  };
}

export function checklistRoutes(route: Route) {
  route({
    method: "GET", url: "/api/onboarding", summary: "Primeros pasos de la clínica: lista calculada desde los datos reales, con progreso y enlaces", tags: ["primeros pasos"], perm: "clinic.manage",
    handler: async ({ c, auth }) => buildChecklist(c, auth),
  });

  route({
    method: "PUT", url: "/api/onboarding/visibility", summary: "Ocultar del Inicio la lista de primeros pasos (solo cuando está completa) o volver a mostrarla", tags: ["primeros pasos"], perm: "clinic.manage",
    body: z.object({ hidden: z.boolean() }),
    handler: async ({ c, auth, body }) => {
      if (body.hidden) {
        const cl = await buildChecklist(c, auth);
        if (!cl.complete) throw conflict(`Faltan ${cl.requiredTotal - cl.requiredDone} pasos obligatorios: la lista se puede ocultar cuando esté completa`, "incomplete");
      }
      await c.query(
        `UPDATE clinics SET settings = CASE WHEN $2 THEN settings || jsonb_build_object('onboardingHiddenAt', now()) ELSE settings - 'onboardingHiddenAt' END WHERE id = $1`,
        [auth.clinicId, body.hidden]);
      await audit(c, auth, body.hidden ? "onboarding.hidden" : "onboarding.shown", "clinic", auth.clinicId);
      return { hidden: body.hidden };
    },
  });
}
