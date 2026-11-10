// Asistente administrativo.
//
// Diseño (ver docs/AI_ASSISTANT.md):
//  * Las "herramientas" son funciones del servidor que consultan datos REALES con los permisos del
//    usuario (mismos chequeos que la API). Cada una corre en su propia transacción corta con RLS.
//  * Al modelo solo le llega información minimizada (agregados, nombres de pila o N° de ficha);
//    el detalle completo (teléfonos, enlaces) va directo a la interfaz, nunca al proveedor de IA.
//  * El asistente NO ejecuta cambios: las acciones (p. ej. agendar) vuelven como "propuestas" que la
//    persona confirma en la interfaz, que llama al endpoint normal con todas sus validaciones.
//  * Sin ANTHROPIC_API_KEY, las mismas herramientas funcionan como "acciones rápidas" sin IA.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { withTenant, type Client, type Db } from "../lib/db.js";
import { AppError, badRequest, forbidden } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { allowedBranches, type AuthCtx, type Permission } from "../lib/rbac.js";
import { normalize } from "../lib/text.js";
import { dashboardData, patientsWithoutNextAppointment } from "./reports.js";
import { clinicZone, dayAvailability } from "./agenda.js";
import { dayBounds } from "../lib/slots.js";

interface ToolResult {
  /** Lo que ve el modelo (minimizado). */
  forModel: unknown;
  /** Lo que ve la persona en pantalla (puede tener más detalle). */
  forUi: unknown;
  proposal?: unknown;
}

interface ToolDef {
  name: string;
  description: string;
  perm: Permission;
  input: z.ZodObject;
  run: (c: Client, auth: AuthCtx, input: Record<string, unknown>) => Promise<ToolResult>;
}

const bs = (cents: number) => `Bs ${(cents / 100).toLocaleString("es-BO", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

async function todayISO(c: Client, auth: AuthCtx, offsetDays = 0) {
  const zone = await clinicZone(c, auth.clinicId!);
  return DateTime.now().setZone(zone).plus({ days: offsetDays }).toISODate()!;
}

async function findBranch(c: Client, auth: AuthCtx, name?: string | null) {
  if (!name) return null;
  const rows = (await c.query<{ id: string; name: string; code: string }>(
    "SELECT id, name, code FROM branches WHERE active AND ($1::uuid[] IS NULL OR id = ANY($1))", [allowedBranches(auth)])).rows;
  const q = normalize(name);
  return rows.find((b) => normalize(b.name).includes(q) || normalize(b.code) === q) ?? null;
}

export const TOOLS: ToolDef[] = [
  {
    name: "ventas_por_sucursal",
    description: "Ingresos cobrados (pagos confirmados), producción y pagos pendientes de verificación por sucursal en un rango de fechas. Sin fechas: mes en curso.",
    perm: "reports.financial",
    input: z.object({ desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(), hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
    run: async (c, auth, i) => {
      const d = await dashboardData(c, auth, (i.desde as string) ?? undefined, (i.hasta as string) ?? undefined);
      const rows = d.branches.map((b) => ({
        sucursal: b.branchName, cobrado: bs(b.collectedCents ?? 0), produccion: bs(b.productionCents ?? 0), pendienteVerificacion: bs(b.pendingVerificationCents ?? 0), citasAtendidas: b.completed,
      }));
      return { forModel: { rango: d.range, sucursales: rows, totalCobrado: bs(d.totals.collectedCents ?? 0) }, forUi: { type: "table", title: `Ventas ${d.range.from} a ${d.range.to}`, rows } };
    },
  },
  {
    name: "buscar_horarios_libres",
    description: "Busca horarios libres reales en la agenda para una prestación (por nombre, p. ej. 'limpieza') o duración, en una fecha (AAAA-MM-DD; por defecto mañana) y opcionalmente una sucursal y turno.",
    perm: "agenda.read",
    input: z.object({
      prestacion: z.string().max(60).nullish(), duracionMin: z.number().int().min(5).max(480).nullish(), fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
      sucursal: z.string().max(60).nullish(), turno: z.enum(["any", "morning", "afternoon"]).nullish(),
    }),
    run: async (c, auth, i) => {
      const zone = await clinicZone(c, auth.clinicId!);
      const date = (i.fecha as string) ?? (await todayISO(c, auth, 1));
      let duration = (i.duracionMin as number) ?? 30;
      let procedure: { id: string; name: string } | null = null;
      if (i.prestacion) {
        const procs = (await c.query<{ id: string; name: string; duration_min: number }>("SELECT id, name, duration_min FROM procedures WHERE active")).rows;
        const q = normalize(i.prestacion as string);
        const syn: Record<string, string> = { limpieza: "profilaxis" };
        const p = procs.find((x) => normalize(x.name).includes(q)) ?? procs.find((x) => syn[q] && normalize(x.name).includes(syn[q]!));
        if (p) { procedure = { id: p.id, name: p.name }; duration = (i.duracionMin as number) ?? p.duration_min; }
      }
      const branch = await findBranch(c, auth, i.sucursal as string);
      if (i.sucursal && !branch) return { forModel: { error: `No encontré la sucursal "${i.sucursal}" entre las que puedes ver` }, forUi: null };
      const branches = branch ? [branch] : (await c.query<{ id: string; name: string }>("SELECT id, name FROM branches WHERE active AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY code", [allowedBranches(auth)])).rows;
      const slots: { inicio: string; hora: string; profesional: string; sucursal: string; branchId: string; dentistId: string }[] = [];
      for (const b of branches) {
        for (const d of await dayAvailability(c, zone, date, b.id, { durationMin: duration, stepMin: 30 })) {
          for (const s of d.slots) {
            const h = DateTime.fromISO(s, { zone });
            if (i.turno === "morning" && h.hour >= 13) continue;
            if (i.turno === "afternoon" && h.hour < 13) continue;
            slots.push({ inicio: s, hora: h.toFormat("HH:mm"), profesional: d.dentistName, sucursal: b.name, branchId: b.id, dentistId: d.dentistId });
          }
        }
      }
      slots.sort((a, b) => a.inicio.localeCompare(b.inicio));
      const top = slots.slice(0, 12);
      return {
        forModel: { fecha: date, prestacion: procedure?.name ?? null, duracionMin: duration, totalHorarios: slots.length, primeros: top.map(({ hora, profesional, sucursal }) => ({ hora, profesional, sucursal })) },
        forUi: { type: "slots", title: `Horarios libres ${date}${procedure ? ` · ${procedure.name}` : ""} (${duration} min)`, procedureId: procedure?.id ?? null, durationMin: duration, slots: top },
      };
    },
  },
  {
    name: "presupuestos_pendientes",
    description: "Presupuestos presentados al paciente y pendientes de aprobación, con monto y antigüedad.",
    perm: "budgets.read",
    input: z.object({}),
    run: async (c, auth) => {
      const r = (await c.query(
        `SELECT b.id, b.number, p.first_name AS first, p.record_number AS ficha, br.name AS branch, b.presented_at,
                COALESCE((SELECT sum(net_cents) FROM budget_items i WHERE i.budget_id = b.id AND i.status <> 'cancelled'),0) AS total
           FROM budgets b JOIN patients p ON p.id = b.patient_id JOIN branches br ON br.id = b.branch_id
          WHERE b.status = 'presented' AND ($1::uuid[] IS NULL OR b.branch_id = ANY($1)) ORDER BY b.presented_at`, [allowedBranches(auth)])).rows;
      const rows = r.map((x) => ({ numero: x.number, paciente: `${x.first} (ficha ${x.ficha})`, sucursal: x.branch, monto: bs(Number(x.total)), diasEsperando: Math.floor((Date.now() - +new Date(x.presented_at)) / 86_400_000), budgetId: x.id }));
      const total = r.reduce((s, x) => s + Number(x.total), 0);
      return { forModel: { cantidad: rows.length, montoTotal: bs(total), lista: rows.slice(0, 15).map(({ budgetId, ...x }) => x) }, forUi: { type: "budgets", title: "Presupuestos pendientes de aprobación", rows } };
    },
  },
  {
    name: "preparar_recordatorios",
    description: "Prepara los recordatorios de las citas de una fecha (por defecto mañana). Solo incluye pacientes con consentimiento; no envía mensajes: deja enlaces para enviarlos manualmente.",
    perm: "agenda.read",
    input: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
    run: async (c, auth, i) => {
      const zone = await clinicZone(c, auth.clinicId!);
      const date = (i.fecha as string) ?? (await todayISO(c, auth, 1));
      const [s, e] = dayBounds(date, zone);
      const r = (await c.query(
        `SELECT a.id, a.starts_at, p.first_name, p.phone, p.consent_reminders, b.name AS branch FROM appointments a
           JOIN patients p ON p.id = a.patient_id JOIN branches b ON b.id = a.branch_id
          WHERE a.starts_at >= $1 AND a.starts_at < $2 AND a.status IN ('scheduled','confirmed') AND ($3::uuid[] IS NULL OR a.branch_id = ANY($3))
          ORDER BY a.starts_at`, [s, e, allowedBranches(auth)])).rows;
      const ready = r.filter((x) => x.consent_reminders && x.phone);
      return {
        forModel: { fecha: date, citas: r.length, listosParaEnviar: ready.length, sinConsentimiento: r.filter((x) => !x.consent_reminders).length, sinTelefono: r.filter((x) => x.consent_reminders && !x.phone).length },
        forUi: { type: "reminders", title: `Recordatorios para ${date}`, date },
      };
    },
  },
  {
    name: "pacientes_sin_proxima_cita",
    description: "Por profesional: cuántos pacientes atendidos en los últimos meses no tienen una próxima cita agendada.",
    perm: "reports.operational",
    input: z.object({ meses: z.number().int().min(1).max(36).nullish() }),
    run: async (c, auth, i) => {
      const rows = await patientsWithoutNextAppointment(c, auth, (i.meses as number) ?? 12);
      return {
        forModel: { meses: (i.meses as number) ?? 12, porProfesional: rows.map((r) => ({ profesional: r.dentistName, pacientes: r.patients })) },
        forUi: { type: "table", title: "Pacientes sin próxima cita", rows: rows.map((r) => ({ profesional: r.dentistName, pacientes: r.patients })) },
      };
    },
  },
  {
    name: "resumen_agenda",
    description: "Resumen de la agenda de una fecha (por defecto hoy): citas por estado y por sucursal.",
    perm: "agenda.read",
    input: z.object({ fecha: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish() }),
    run: async (c, auth, i) => {
      const zone = await clinicZone(c, auth.clinicId!);
      const date = (i.fecha as string) ?? (await todayISO(c, auth));
      const [s, e] = dayBounds(date, zone);
      const r = (await c.query(
        `SELECT b.name AS sucursal, a.status, count(*)::int AS n FROM appointments a JOIN branches b ON b.id = a.branch_id
          WHERE a.starts_at >= $1 AND a.starts_at < $2 AND ($3::uuid[] IS NULL OR a.branch_id = ANY($3)) GROUP BY b.name, a.status ORDER BY b.name`,
        [s, e, allowedBranches(auth)])).rows;
      return { forModel: { fecha: date, porSucursalYEstado: r }, forUi: { type: "table", title: `Agenda ${date}`, rows: r } };
    },
  },
  {
    name: "controles_pendientes",
    description: "Controles de pacientes ('volver a citar'): cuántos vencen esta semana, cuántos están atrasados y cuáles requieren revisión, por sucursal.",
    perm: "agenda.read",
    input: z.object({ sucursal: z.string().max(60).nullish() }),
    run: async (c, auth, i) => {
      const branch = await findBranch(c, auth, i.sucursal as string);
      if (i.sucursal && !branch) return { forModel: { error: `No encontré la sucursal "${i.sucursal}" entre las que puedes ver` }, forUi: null };
      const today = await todayISO(c, auth);
      const r = (await c.query(
        `SELECT r.id, r.reason, r.due_date, r.status, p.first_name, p.record_number, b.name AS branch
           FROM recalls r JOIN patients p ON p.id = r.patient_id JOIN branches b ON b.id = r.branch_id
          WHERE r.status IN ('pending','review') AND ($1::uuid IS NULL OR r.branch_id = $1) AND ($2::uuid[] IS NULL OR r.branch_id = ANY($2))
          ORDER BY r.due_date LIMIT 500`, [branch?.id ?? null, allowedBranches(auth)])).rows;
      const weekEnd = DateTime.fromISO(today).plus({ days: 7 }).toISODate()!;
      const overdue = r.filter((x) => x.due_date < today);
      const week = r.filter((x) => x.due_date >= today && x.due_date <= weekEnd);
      const review = r.filter((x) => x.status === "review");
      const rows = [...overdue, ...week].slice(0, 15).map((x) => ({ paciente: `${x.first_name} (ficha ${x.record_number})`, motivo: x.reason, vence: x.due_date, sucursal: x.branch, estado: x.status === "review" ? "Revisar" : "Pendiente" }));
      return { forModel: { atrasados: overdue.length, vencenEstaSemana: week.length, paraRevisar: review.length, primeros: rows }, forUi: { type: "table", title: "Controles por llamar", rows } };
    },
  },
  {
    name: "sala_de_espera",
    description: "Situación ahora mismo: pacientes en sala de espera (y cuántos minutos llevan), en atención y citas retrasadas sin llegada.",
    perm: "agenda.read",
    input: z.object({ sucursal: z.string().max(60).nullish() }),
    run: async (c, auth, i) => {
      const branch = await findBranch(c, auth, i.sucursal as string);
      if (i.sucursal && !branch) return { forModel: { error: `No encontré la sucursal "${i.sucursal}"` }, forUi: null };
      const zone = await clinicZone(c, auth.clinicId!);
      const [s, e] = dayBounds(await todayISO(c, auth), zone);
      const r = (await c.query(
        `SELECT a.status, a.starts_at, a.arrived_at, p.first_name, b.name AS branch, u.full_name AS dentist
           FROM appointments a JOIN patients p ON p.id = a.patient_id JOIN branches b ON b.id = a.branch_id JOIN users u ON u.id = a.dentist_id
          WHERE a.starts_at >= $1 AND a.starts_at < $2 AND a.status IN ('scheduled','confirmed','arrived','in_progress')
            AND ($3::uuid IS NULL OR a.branch_id = $3) AND ($4::uuid[] IS NULL OR a.branch_id = ANY($4))`, [s, e, branch?.id ?? null, allowedBranches(auth)])).rows;
      const now = Date.now();
      const waiting = r.filter((x) => x.status === "arrived").map((x) => ({ paciente: x.first_name, sucursal: x.branch, profesional: x.dentist, esperandoMin: x.arrived_at ? Math.round((now - +new Date(x.arrived_at)) / 60000) : null }));
      const late = r.filter((x) => ["scheduled", "confirmed"].includes(x.status) && now - +new Date(x.starts_at) > 15 * 60000)
        .map((x) => ({ paciente: x.first_name, sucursal: x.branch, retrasoMin: Math.round((now - +new Date(x.starts_at)) / 60000) }));
      return {
        forModel: { enSala: waiting, enAtencion: r.filter((x) => x.status === "in_progress").length, retrasados: late },
        forUi: { type: "table", title: "Sala de espera ahora", rows: waiting.map((w) => ({ paciente: w.paciente, sucursal: w.sucursal, profesional: w.profesional, "espera (min)": w.esperandoMin })) },
      };
    },
  },
  {
    name: "estado_cajas",
    description: "Cajas abiertas ahora (por cajero y sucursal) y cierres con diferencia en los últimos 7 días.",
    perm: "payments.verify",
    input: z.object({}),
    run: async (c, auth) => {
      const open = (await c.query(
        `SELECT cs.number, b.name AS branch, u.full_name AS cashier, cs.opened_at FROM cash_sessions cs JOIN branches b ON b.id = cs.branch_id JOIN users u ON u.id = cs.cashier_id
          WHERE cs.status = 'open' AND ($1::uuid[] IS NULL OR cs.branch_id = ANY($1)) ORDER BY cs.opened_at`, [allowedBranches(auth)])).rows;
      const diffs = (await c.query(
        `SELECT cs.number, b.name AS branch, u.full_name AS cashier, cs.closed_at, cs.difference_cents FROM cash_sessions cs JOIN branches b ON b.id = cs.branch_id JOIN users u ON u.id = cs.cashier_id
          WHERE cs.status = 'closed' AND cs.difference_cents <> 0 AND cs.closed_at > now() - interval '7 days' AND ($1::uuid[] IS NULL OR cs.branch_id = ANY($1))
          ORDER BY cs.closed_at DESC`, [allowedBranches(auth)])).rows;
      return {
        forModel: { abiertas: open.map((o) => ({ caja: o.number, sucursal: o.branch, cajero: o.cashier })), cierresConDiferencia: diffs.map((d) => ({ caja: d.number, sucursal: d.branch, cajero: d.cashier, diferencia: bs(Number(d.difference_cents)) })) },
        forUi: { type: "table", title: "Cierres de caja con diferencia (7 días)", rows: diffs.map((d) => ({ caja: d.number, sucursal: d.branch, cajero: d.cashier, diferencia: bs(Number(d.difference_cents)) })) },
      };
    },
  },
  {
    name: "alertas_bioseguridad",
    description: "Ciclos de esterilización con indicador fallido (30 días) e indicadores biológicos pendientes de lectura, por sucursal.",
    perm: "biosafety.read",
    input: z.object({}),
    run: async (c, auth) => {
      const r = (await c.query(
        `SELECT b.name AS branch, count(*) FILTER (WHERE cy.chemical_indicator = 'fail' OR br.result = 'fail')::int AS failed,
                count(*) FILTER (WHERE br.id IS NULL)::int AS pending_bio
           FROM sterilization_cycles cy JOIN branches b ON b.id = cy.branch_id LEFT JOIN sterilization_bio_results br ON br.cycle_id = cy.id
          WHERE cy.run_at > now() - interval '30 days' AND ($1::uuid[] IS NULL OR cy.branch_id = ANY($1)) GROUP BY b.name ORDER BY b.name`, [allowedBranches(auth)])).rows;
      const rows = r.map((x) => ({ sucursal: x.branch, "ciclos fallidos": x.failed, "biológicos por leer": x.pending_bio }));
      return { forModel: { porSucursal: rows }, forUi: { type: "table", title: "Bioseguridad (30 días)", rows } };
    },
  },
  {
    name: "proponer_cita",
    description: "Prepara una PROPUESTA de cita para que la persona la confirme en pantalla. No agenda nada por sí misma. Requiere el N° de ficha del paciente y un horario libre obtenido con buscar_horarios_libres.",
    perm: "agenda.write",
    input: z.object({ fichaPaciente: z.number().int().positive(), inicio: z.string(), profesional: z.string().max(80), sucursal: z.string().max(60), prestacion: z.string().max(60).nullish(), duracionMin: z.number().int().min(5).max(480).nullish() }),
    run: async (c, auth, i) => {
      const p = (await c.query<{ id: string; first_name: string }>("SELECT id, first_name FROM patients WHERE record_number = $1 AND archived_at IS NULL", [i.fichaPaciente])).rows[0];
      if (!p) return { forModel: { error: "No existe un paciente con esa ficha" }, forUi: null };
      const branch = await findBranch(c, auth, i.sucursal as string);
      if (!branch) return { forModel: { error: "Sucursal no encontrada o sin acceso" }, forUi: null };
      const dentist = (await c.query<{ user_id: string; full_name: string }>(
        "SELECT m.user_id, u.full_name FROM memberships m JOIN users u ON u.id = m.user_id WHERE m.clinic_id = $1 AND m.is_professional AND m.active", [auth.clinicId])).rows
        .find((d) => normalize(d.full_name).includes(normalize(i.profesional as string)));
      if (!dentist) return { forModel: { error: "Profesional no encontrado" }, forUi: null };
      const start = DateTime.fromISO(i.inicio as string);
      if (!start.isValid) return { forModel: { error: "Fecha/hora inválida" }, forUi: null };
      let procedureId: string | null = null, duration = (i.duracionMin as number) ?? 30;
      if (i.prestacion) {
        const pr = (await c.query<{ id: string; name: string; duration_min: number }>("SELECT id, name, duration_min FROM procedures WHERE active")).rows.find((x) => normalize(x.name).includes(normalize(i.prestacion as string)));
        if (pr) { procedureId = pr.id; duration = (i.duracionMin as number) ?? pr.duration_min; }
      }
      // Guardas (R2-20): nunca proponer algo que la agenda rechazaría.
      if (start.toMillis() <= Date.now()) return { forModel: { error: "Ese horario ya pasó. Busca un horario libre futuro con buscar_horarios_libres." }, forUi: null };
      const zoneP = await clinicZone(c, auth.clinicId!);
      const dayP = start.setZone(zoneP).toISODate()!;
      const avail = await dayAvailability(c, zoneP, dayP, branch.id, { dentistId: dentist.user_id, durationMin: duration, stepMin: 5 });
      const free = avail.some((d) => d.slots.some((s) => Date.parse(s) === start.toMillis()));
      if (!free) return { forModel: { error: "Ese horario no está libre para ese profesional en esa sucursal. Usa buscar_horarios_libres y elige uno de la lista." }, forUi: null };
      const proposal = {
        action: "create_appointment",
        payload: { branchId: branch.id, dentistId: dentist.user_id, patientId: p.id, procedureId, startsAt: start.toISO(), durationMin: duration, source: "assistant" },
        summary: `Cita para ${p.first_name} (ficha ${i.fichaPaciente}) con ${dentist.full_name} en ${branch.name}, ${start.setZone(await clinicZone(c, auth.clinicId!)).toFormat("dd/LL HH:mm")} (${duration} min)`,
      };
      return { forModel: { propuestaPreparada: proposal.summary, nota: "La persona debe confirmarla en pantalla" }, forUi: { type: "proposal", title: "Propuesta de cita", ...proposal }, proposal };
    },
  },
];

const SYSTEM_PROMPT = `Eres el asistente administrativo de una clínica odontológica en Bolivia. Respondes en español, de forma breve y clara.
Reglas:
- Usa SOLO datos obtenidos con las herramientas. Si una herramienta no devuelve el dato, dilo; nunca inventes cifras, nombres ni horarios.
- No puedes ejecutar cambios. Para agendar, usa proponer_cita: la persona confirmará en pantalla.
- No das diagnósticos, indicaciones clínicas ni recetas: eso corresponde a un profesional habilitado.
- Montos en bolivianos (Bs). Fechas como dd/mm/aaaa.
- Si la herramienta responde que no hay permiso, explica que esa información no está disponible para su rol.`;

async function runTool(db: Db, auth: AuthCtx, name: string, input: unknown): Promise<ToolResult> {
  const t = TOOLS.find((x) => x.name === name);
  if (!t) throw badRequest("Herramienta desconocida");
  if (!auth.permissions.has(t.perm)) throw forbidden("Tu rol no tiene acceso a esa información");
  const parsed = t.input.parse(input ?? {});
  return withTenant(db.appPool, { clinicId: auth.clinicId, userId: auth.userId }, async (c) => {
    const res = await t.run(c, auth, parsed);
    await audit(c, auth, "assistant.tool", "assistant", name, { input: parsed });
    return res;
  });
}

export function assistantRoutes(route: Route) {
  route({
    method: "GET", url: "/api/assistant/tools", summary: "Herramientas del asistente disponibles para el rol actual", tags: ["asistente"], perm: "assistant.use",
    handler: async ({ auth }) => ({
      llmEnabled: !!process.env.ANTHROPIC_API_KEY,
      tools: TOOLS.filter((t) => auth.permissions.has(t.perm)).map((t) => ({ name: t.name, description: t.description })),
    }),
  });

  route({
    method: "POST", url: "/api/assistant/tools/:name", summary: "Ejecutar una herramienta directamente (acción rápida, sin IA)", tags: ["asistente"], perm: "assistant.use", noTx: true,
    params: z.object({ name: z.string().max(60) }), body: z.record(z.string(), z.unknown()).default({}),
    handler: async ({ db, auth, params, body }) => {
      const r = await runTool(db, auth, params.name, body);
      return { ui: r.forUi, proposal: r.proposal ?? null };
    },
  });

  route({
    method: "POST", url: "/api/assistant/chat", summary: "Conversar con el asistente (requiere ANTHROPIC_API_KEY en el servidor)", tags: ["asistente"], perm: "assistant.use", noTx: true,
    limit: { max: 20, timeWindow: "1 minute" },
    body: z.object({
      messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000) })).min(1).max(30),
    }),
    handler: async ({ db, auth, body }) => {
      if (!process.env.ANTHROPIC_API_KEY) throw new AppError(503, "assistant_disabled", "El asistente con IA no está configurado. Puedes usar las acciones rápidas.");
      const client = new Anthropic();
      const tools = TOOLS.filter((t) => auth.permissions.has(t.perm));
      const apiTools: Anthropic.Beta.BetaTool[] = tools.map((t) => ({
        name: t.name, description: t.description, strict: true,
        input_schema: z.toJSONSchema(t.input, { target: "draft-2020-12" }) as Anthropic.Beta.BetaTool["input_schema"],
      }));
      const today = await withTenant(db.appPool, { clinicId: auth.clinicId, userId: auth.userId }, (c) => todayISO(c, auth));
      const messages: Anthropic.Beta.BetaMessageParam[] = body.messages.map((m) => ({ role: m.role, content: m.content }));
      const ui: unknown[] = [];
      const proposals: unknown[] = [];
      for (let step = 0; step < 6; step++) {
        const res = await client.beta.messages.create({
          model: process.env.ASSISTANT_MODEL ?? "claude-opus-5-5",
          max_tokens: 4000,
          betas: ["server-side-fallback-2026-07-01"],
          fallbacks: "default",
          output_config: { effort: "low" },
          system: `${SYSTEM_PROMPT}\nHoy es ${today} (zona America/La_Paz). Rol del usuario: ${auth.membership!.role}.`,
          tools: apiTools,
          messages,
        });
        if (res.stop_reason === "refusal") return { reply: "No puedo ayudar con esa solicitud.", ui, proposals };
        const toolUses = res.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
        if (res.stop_reason !== "tool_use" || !toolUses.length) {
          const text = res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();
          return { reply: text || "No tengo una respuesta.", ui, proposals };
        }
        messages.push({ role: "assistant", content: res.content });
        const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
        for (const tu of toolUses) {
          try {
            const r = await runTool(db, auth, tu.name, tu.input);
            if (r.forUi) ui.push(r.forUi);
            if (r.proposal) proposals.push(r.proposal);
            results.push({ type: "tool_result", tool_use_id: tu.id, content: JSON.stringify(r.forModel) });
          } catch (e) {
            results.push({ type: "tool_result", tool_use_id: tu.id, is_error: true, content: (e as Error).message });
          }
        }
        messages.push({ role: "user", content: results });
      }
      return { reply: "La consulta requirió demasiados pasos. Intenta una pregunta más específica.", ui, proposals };
    },
  });
}
