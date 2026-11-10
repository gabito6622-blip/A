// Configuración → «Mensajes automáticos» y panel de entregas (personal con clinic.manage).
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Client } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams } from "../../lib/http.js";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { allowedBranches, hasAllBranches, requireBranch, type AuthCtx } from "../../lib/rbac.js";
import { MESSAGE_STATUS_LABELS, type Messenger, type MessageStatus } from "../../lib/messaging.js";
import { messagingConsent } from "../consents.js";
import {
  OPT_OUT_LINE, TRIGGERS, TRIGGER_LABELS, TRIGGER_VARIABLES, VARIABLES, VARIABLE_LABELS, metaVersion, renderTemplate, sampleVars,
  validateTemplate, type Purpose, type Trigger,
} from "./templates.js";
import { loadMessagingSettings, runForClinic, type SchedulerDeps } from "./scheduler.js";

const TAGS = ["mensajes automáticos"];
const zHHMM = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)");
const zPurpose = z.enum(["reminders", "marketing"]);
const zMetaName = z.string().trim().toLowerCase().regex(/^[a-z0-9_]{1,100}$/, "Usa solo minúsculas, números y guion bajo (como en Meta)").nullish().transform((v) => v || null);
const zMetaLang = z.string().trim().regex(/^[a-z]{2}(_[A-Z]{2})?$/, "Idioma inválido (ej.: es o es_MX)").default("es");

export const JOB_STATUS_LABELS: Record<string, string> = { pending: "Programado", done: "Enviado a la bandeja", skipped: "Omitido", cancelled: "Anulado" };

/** Rangos de anticipación o espera por disparador (en minutos). */
const OFFSET_RANGES: Record<Trigger, [number, number, string]> = {
  appointment_created: [0, 0, "La confirmación se envía al agendar (sin espera)"],
  appointment_reminder: [30, 14 * 1440, "El recordatorio va entre 30 minutos y 14 días antes de la cita"],
  after_visit: [0, 90 * 1440, "El mensaje después de la visita va entre 0 y 90 días después"],
  recall_due: [0, 60 * 1440, "El aviso de control va entre 0 y 60 días antes de la fecha del control"],
  budget_unanswered: [1440, 90 * 1440, "El seguimiento del presupuesto va entre 1 y 90 días después de presentarlo"],
};

function validationError(errors: { path: string; message: string }[]): never {
  throw new AppError(400, "validation", errors[0]!.message, errors);
}

export function messagingStaffRoutes(route: Route, cfg: Config, messenger: Messenger) {
  const deps: SchedulerDeps = { cfg, messenger };

  // ---------------- Configuración general ----------------
  route({
    method: "GET", url: "/api/messaging/settings", summary: "Horario de silencio, tope diario, modo de envío y catálogo de variables", tags: TAGS, perm: "clinic.manage",
    handler: async ({ c, auth }) => {
      const s = await loadMessagingSettings(c, auth.clinicId!);
      const cl = (await c.query<{ timezone: string; portal: boolean | null; slug: string }>(
        "SELECT c.timezone, c.slug, ps.enabled AS portal FROM clinics c LEFT JOIN portal_settings ps ON ps.clinic_id = c.id WHERE c.id = $1", [auth.clinicId])).rows[0]!;
      return {
        quietStart: s.quiet.start, quietEnd: s.quiet.end, maxPerDay: s.maxPerDay, timezone: cl.timezone,
        mode: messenger.mode, schedulerEnabled: process.env.MESSAGING_SCHEDULER === "1", portalEnabled: !!cl.portal,
        optOutLine: OPT_OUT_LINE,
        variables: VARIABLES.map((v) => ({ name: v, label: VARIABLE_LABELS[v] })),
        triggers: TRIGGERS.map((t) => ({ id: t, label: TRIGGER_LABELS[t], variables: TRIGGER_VARIABLES[t], offset: { min: OFFSET_RANGES[t][0], max: OFFSET_RANGES[t][1], hint: OFFSET_RANGES[t][2] } })),
      };
    },
  });

  route({
    method: "PUT", url: "/api/messaging/settings", summary: "Guardar horario de silencio y tope diario por paciente", tags: TAGS, perm: "clinic.manage",
    body: z.object({ quietStart: zHHMM, quietEnd: zHHMM, maxPerDay: z.number().int().min(1, "Mínimo 1 mensaje por día").max(10, "Máximo 10 mensajes por día") }),
    handler: async ({ c, auth, body }) => {
      await c.query(
        `INSERT INTO messaging_settings (clinic_id, quiet_start, quiet_end, max_per_patient_day, updated_by, updated_at) VALUES ($1,$2,$3,$4,$5, now())
         ON CONFLICT (clinic_id) DO UPDATE SET quiet_start = EXCLUDED.quiet_start, quiet_end = EXCLUDED.quiet_end,
           max_per_patient_day = EXCLUDED.max_per_patient_day, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [auth.clinicId, body.quietStart, body.quietEnd, body.maxPerDay, auth.userId]);
      await audit(c, auth, "messaging.settings_updated", "clinic", auth.clinicId, body);
      return { ok: true };
    },
  });

  // ---------------- Plantillas ----------------
  const templateRows = (c: Client, id?: string) => c.query(
    `SELECT t.id, t.name, t.purpose, t.meta_template_name AS "metaTemplateName", t.meta_language AS "metaLanguage", t.active, t.created_at AS "createdAt",
            v.version, v.body, v.created_at AS "versionAt", u.full_name AS "versionBy",
            (SELECT count(*)::int FROM message_rules r WHERE r.template_id = t.id) AS "rulesCount",
            (SELECT array_agg(DISTINCT r.trigger) FROM message_rules r WHERE r.template_id = t.id) AS "ruleTriggers"
       FROM message_templates t
       JOIN LATERAL (SELECT * FROM message_template_versions x WHERE x.template_id = t.id ORDER BY x.version DESC LIMIT 1) v ON true
       LEFT JOIN users u ON u.id = v.created_by
      WHERE ($1::uuid IS NULL OR t.id = $1) ORDER BY t.active DESC, t.name`, [id ?? null]);

  route({
    method: "GET", url: "/api/messaging/templates", summary: "Plantillas con su versión vigente", tags: TAGS, perm: "clinic.manage",
    handler: async ({ c }) => (await templateRows(c)).rows.map((t) => ({ ...t, ruleTriggers: t.ruleTriggers ?? [], meta: metaVersion(t.body, t.purpose) })),
  });

  route({
    method: "GET", url: "/api/messaging/templates/:id/versions", summary: "Historial de versiones de una plantilla", tags: TAGS, perm: "clinic.manage", params: zIdParams,
    handler: async ({ c, params }) => {
      const r = await c.query(
        `SELECT v.id, v.version, v.body, v.created_at AS "createdAt", u.full_name AS "createdBy" FROM message_template_versions v
           LEFT JOIN users u ON u.id = v.created_by WHERE v.template_id = $1 ORDER BY v.version DESC`, [params.id]);
      if (!r.rowCount) throw notFound("Plantilla");
      return r.rows;
    },
  });

  route({
    method: "POST", url: "/api/messaging/templates/preview", summary: "Validar una plantilla y verla con datos ficticios (no guarda nada)", tags: TAGS, perm: "clinic.manage",
    body: z.object({ body: z.string().max(5000), purpose: zPurpose, trigger: z.enum(TRIGGERS).optional() }),
    handler: async ({ c, auth, body }) => {
      const clinic = (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!.name;
      const v = validateTemplate(body.body, { purpose: body.purpose, trigger: body.trigger });
      return {
        ok: !v.errors.length, errors: v.errors, warnings: v.warnings,
        preview: v.errors.length ? null : renderTemplate(body.body, sampleVars(clinic, cfg.publicUrl), body.purpose),
        meta: metaVersion(body.body, body.purpose), length: body.body.length,
      };
    },
  });

  /** Valida el texto contra las reglas que ya usan la plantilla (una variable que su disparador no tiene). */
  async function validateForRules(c: Client, templateId: string | null, text: string, purpose: Purpose) {
    const errors: { path: string; message: string }[] = validateTemplate(text, { purpose }).errors.map((e) => ({ path: "body", message: e.message }));
    if (errors.length || !templateId) return errors;
    const triggers = (await c.query<{ trigger: Trigger }>("SELECT DISTINCT trigger FROM message_rules WHERE template_id = $1", [templateId])).rows.map((r) => r.trigger);
    for (const t of triggers) for (const e of validateTemplate(text, { purpose, trigger: t }).errors) errors.push({ path: "body", message: `${e.message} (la usa una regla «${TRIGGER_LABELS[t]}»)` });
    return errors;
  }

  route({
    method: "POST", url: "/api/messaging/templates", summary: "Crear una plantilla (versión 1). Las variables se validan antes de guardar", tags: TAGS, perm: "clinic.manage",
    body: z.object({
      name: z.string().trim().min(3, "Escribe un nombre (al menos 3 caracteres)").max(80, "Máximo 80 caracteres"),
      purpose: zPurpose, body: z.string().max(5000), metaTemplateName: zMetaName, metaLanguage: zMetaLang,
    }),
    handler: async ({ c, auth, body }) => {
      const errors = await validateForRules(c, null, body.body, body.purpose);
      if ((await c.query("SELECT 1 FROM message_templates WHERE lower(name) = lower($1)", [body.name])).rowCount) errors.unshift({ path: "name", message: "Ya existe una plantilla con ese nombre" });
      if (errors.length) validationError(errors);
      const t = (await c.query<{ id: string }>(
        "INSERT INTO message_templates (clinic_id, name, purpose, meta_template_name, meta_language, created_by) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [auth.clinicId, body.name, body.purpose, body.metaTemplateName, body.metaLanguage, auth.userId])).rows[0]!;
      await c.query("INSERT INTO message_template_versions (clinic_id, template_id, version, body, created_by) VALUES ($1,$2,1,$3,$4)", [auth.clinicId, t.id, body.body.trim(), auth.userId]);
      await audit(c, auth, "messaging.template_created", "message_template", t.id, { name: body.name, purpose: body.purpose, version: 1 });
      return { id: t.id, version: 1 };
    },
  });

  route({
    method: "PUT", url: "/api/messaging/templates/:id", summary: "Editar una plantilla: si cambia el texto se crea una versión nueva (la anterior queda en el historial)", tags: TAGS, perm: "clinic.manage",
    params: zIdParams,
    body: z.object({
      name: z.string().trim().min(3, "Escribe un nombre (al menos 3 caracteres)").max(80, "Máximo 80 caracteres"),
      body: z.string().max(5000), metaTemplateName: zMetaName, metaLanguage: zMetaLang, active: z.boolean(),
    }),
    handler: async ({ c, auth, params, body }) => {
      const cur = (await templateRows(c, params.id)).rows[0];
      if (!cur) throw notFound("Plantilla");
      const errors = await validateForRules(c, params.id, body.body, cur.purpose);
      if ((await c.query("SELECT 1 FROM message_templates WHERE lower(name) = lower($1) AND id <> $2", [body.name, params.id])).rowCount) errors.unshift({ path: "name", message: "Ya existe una plantilla con ese nombre" });
      if (!body.active && (await c.query("SELECT 1 FROM message_rules WHERE template_id = $1 AND active", [params.id])).rowCount) {
        errors.push({ path: "active", message: "Una regla activa usa esta plantilla: desactiva la regla o cámbiale la plantilla primero" });
      }
      if (errors.length) validationError(errors);
      await c.query("UPDATE message_templates SET name = $2, meta_template_name = $3, meta_language = $4, active = $5 WHERE id = $1",
        [params.id, body.name, body.metaTemplateName, body.metaLanguage, body.active]);
      let version = cur.version as number;
      if (body.body.trim() !== cur.body) {
        version += 1;
        await c.query("INSERT INTO message_template_versions (clinic_id, template_id, version, body, created_by) VALUES ($1,$2,$3,$4,$5)", [auth.clinicId, params.id, version, body.body.trim(), auth.userId]);
      }
      await audit(c, auth, "messaging.template_updated", "message_template", params.id, { name: body.name, version, newVersion: version !== cur.version, active: body.active });
      return { id: params.id, version };
    },
  });

  // ---------------- Reglas ----------------
  const ruleBody = z.object({
    name: z.string().trim().min(3, "Escribe un nombre (al menos 3 caracteres)").max(80, "Máximo 80 caracteres"),
    trigger: z.enum(TRIGGERS),
    offsetMinutes: z.number().int().min(0).max(129600),
    branchId: zId.nullish().transform((v) => v ?? null),
    templateId: zId,
    procedureId: zId.nullish().transform((v) => v ?? null),
    channel: z.enum(["whatsapp", "sms"]).default("whatsapp"),
    active: z.boolean(),
  });
  type RuleBody = z.infer<typeof ruleBody>;

  async function checkRule(c: Client, auth: AuthCtx, b: RuleBody) {
    if (b.branchId) requireBranch(auth, b.branchId);
    else if (!hasAllBranches(auth)) throw forbidden("Solo quien tiene acceso a todas las sucursales puede crear reglas para todas");
    const errors: { path: string; message: string }[] = [];
    const [min, max, hint] = OFFSET_RANGES[b.trigger];
    if (b.offsetMinutes < min || b.offsetMinutes > max) errors.push({ path: "offsetMinutes", message: hint });
    if (b.procedureId && b.trigger !== "after_visit") errors.push({ path: "procedureId", message: "La prestación solo se elige en los mensajes «después de la visita»" });
    if (b.branchId && !(await c.query("SELECT 1 FROM branches WHERE id = $1 AND active", [b.branchId])).rowCount) errors.push({ path: "branchId", message: "Sucursal no encontrada" });
    if (b.procedureId && !(await c.query("SELECT 1 FROM procedures WHERE id = $1", [b.procedureId])).rowCount) errors.push({ path: "procedureId", message: "Prestación no encontrada" });
    const t = (await templateRows(c, b.templateId)).rows[0];
    if (!t) errors.push({ path: "templateId", message: "Elige una plantilla" });
    else {
      if (!t.active) errors.push({ path: "templateId", message: "Esa plantilla está desactivada" });
      if (["appointment_created", "appointment_reminder"].includes(b.trigger) && t.purpose !== "reminders") {
        errors.push({ path: "templateId", message: "Los avisos de cita deben usar una plantilla de «Recordatorios» (no de marketing)" });
      }
      for (const e of validateTemplate(t.body, { purpose: t.purpose, trigger: b.trigger }).errors) errors.push({ path: "templateId", message: e.message });
    }
    if (errors.length) validationError(errors);
  }

  route({
    method: "GET", url: "/api/messaging/rules", summary: "Reglas de envío con su plantilla y actividad reciente", tags: TAGS, perm: "clinic.manage",
    handler: async ({ c, auth }) => {
      const r = await c.query(
        `SELECT r.id, r.name, r.trigger, r.offset_minutes AS "offsetMinutes", r.branch_id AS "branchId", b.name AS "branchName",
                r.template_id AS "templateId", t.name AS "templateName", t.purpose, r.procedure_id AS "procedureId", pr.name AS "procedureName",
                r.channel, r.active, r.active_since AS "activeSince", r.updated_at AS "updatedAt",
                (SELECT count(*)::int FROM message_jobs j WHERE j.rule_id = r.id AND j.status = 'pending') AS pending,
                (SELECT count(*)::int FROM message_jobs j WHERE j.rule_id = r.id AND j.status = 'done' AND j.processed_at > now() - interval '30 days') AS "sent30d",
                (SELECT count(*)::int FROM message_jobs j WHERE j.rule_id = r.id AND j.status = 'skipped' AND j.processed_at > now() - interval '30 days') AS "skipped30d"
           FROM message_rules r JOIN message_templates t ON t.id = r.template_id LEFT JOIN branches b ON b.id = r.branch_id LEFT JOIN procedures pr ON pr.id = r.procedure_id
          WHERE ($1::uuid[] IS NULL OR r.branch_id IS NULL OR r.branch_id = ANY($1))
          ORDER BY r.active DESC, r.trigger, r.offset_minutes DESC, r.name`, [allowedBranches(auth)]);
      return r.rows.map((x) => ({ ...x, triggerLabel: TRIGGER_LABELS[x.trigger as Trigger] }));
    },
  });

  route({
    method: "POST", url: "/api/messaging/rules", summary: "Crear una regla de envío (por clínica o sucursal)", tags: TAGS, perm: "clinic.manage", body: ruleBody,
    handler: async ({ c, auth, body }) => {
      await checkRule(c, auth, body);
      const r = (await c.query<{ id: string }>(
        `INSERT INTO message_rules (clinic_id, branch_id, name, trigger, offset_minutes, template_id, procedure_id, channel, active, active_since, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9, CASE WHEN $9 THEN now() END, $10) RETURNING id`,
        [auth.clinicId, body.branchId, body.name, body.trigger, body.offsetMinutes, body.templateId, body.procedureId, body.channel, body.active, auth.userId])).rows[0]!;
      await audit(c, auth, "messaging.rule_created", "message_rule", r.id, body, body.branchId);
      return { id: r.id };
    },
  });

  route({
    method: "PUT", url: "/api/messaging/rules/:id", summary: "Editar o activar/desactivar una regla (los mensajes pendientes se recalculan)", tags: TAGS, perm: "clinic.manage",
    params: zIdParams, body: ruleBody,
    handler: async ({ c, auth, params, body }) => {
      const cur = (await c.query<{ branch_id: string | null; active: boolean; trigger: Trigger }>("SELECT branch_id, active, trigger FROM message_rules WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!cur) throw notFound("Regla");
      if (cur.trigger !== body.trigger) validationError([{ path: "trigger", message: "El momento de envío no se cambia en una regla existente: crea otra regla" }]);
      if (cur.branch_id) requireBranch(auth, cur.branch_id);
      else if (!hasAllBranches(auth)) throw forbidden("Solo quien tiene acceso a todas las sucursales puede cambiar esta regla");
      await checkRule(c, auth, body);
      await c.query(
        `UPDATE message_rules SET branch_id = $2, name = $3, offset_minutes = $4, template_id = $5, procedure_id = $6, channel = $7, active = $8,
            active_since = CASE WHEN $8 AND NOT active THEN now() ELSE active_since END, updated_at = now()
          WHERE id = $1`,
        [params.id, body.branchId, body.name, body.offsetMinutes, body.templateId, body.procedureId, body.channel, body.active]);
      // Lo pendiente se anula y la próxima ejecución lo vuelve a calcular con la regla nueva.
      const x = await c.query("UPDATE message_jobs SET status = 'cancelled', status_reason = 'La regla cambió: se recalcula', updated_at = now() WHERE rule_id = $1 AND status = 'pending'", [params.id]);
      await audit(c, auth, "messaging.rule_updated", "message_rule", params.id, { ...body, recalculated: x.rowCount }, body.branchId);
      return { ok: true };
    },
  });

  // ---------------- Ejecutar ahora ----------------
  route({
    method: "POST", url: "/api/messaging/run", summary: "Ejecutar ahora el programador para esta clínica (demostración y pruebas; fuera de producción solo simula)", tags: TAGS, perm: "clinic.manage",
    handler: async ({ c, auth }) => {
      const s = await runForClinic(c, auth.clinicId!, new Date(), deps, { clinicId: auth.clinicId!, userId: auth.userId, ip: auth.ip });
      return { ...s, mode: messenger.mode };
    },
  });

  // ---------------- Panel de entregas ----------------
  const zStatus = z.enum(["queued", "simulated", "sent", "delivered", "read", "failed"]);
  route({
    method: "GET", url: "/api/messaging/deliveries", summary: "Mensajes de la bandeja con su estado, sucursal y regla (filtrado por sucursales permitidas)", tags: TAGS, perm: "clinic.manage",
    query: z.object({
      branchId: zId.optional(), status: zStatus.optional(), ruleId: zId.optional(),
      origin: z.enum(["all", "auto"]).default("all"), limit: z.coerce.number().int().min(1).max(500).default(200),
    }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const r = await c.query(
        `SELECT m.id, m.channel, m.recipient, m.template, m.purpose, m.body, m.status, m.error, m.created_at AS "createdAt", m.sent_at AS "sentAt",
                m.delivered_at AS "deliveredAt", m.read_at AS "readAt", m.retry_of AS "retryOf", m.branch_id AS "branchId", b.name AS "branchName",
                p.first_name || ' ' || p.last_name AS "patientName", j.rule_id AS "ruleId", r.name AS "ruleName",
                (SELECT x.id FROM outbound_messages x WHERE x.retry_of = m.id) AS "retriedBy"
           FROM outbound_messages m LEFT JOIN patients p ON p.id = m.patient_id LEFT JOIN branches b ON b.id = m.branch_id
           LEFT JOIN message_jobs j ON j.message_id = m.id LEFT JOIN message_rules r ON r.id = j.rule_id
          WHERE ($1::uuid IS NULL OR m.branch_id = $1) AND ($2::uuid[] IS NULL OR m.branch_id = ANY($2))
            AND ($3::text IS NULL OR m.status = $3) AND ($4::uuid IS NULL OR j.rule_id = $4)
            AND ($5 = 'all' OR m.template LIKE 'auto.%')
          ORDER BY m.created_at DESC LIMIT $6`,
        [query.branchId ?? null, allowedBranches(auth), query.status ?? null, query.ruleId ?? null, query.origin, query.limit]);
      return { mode: messenger.mode, items: r.rows.map((m) => ({ ...m, statusLabel: MESSAGE_STATUS_LABELS[m.status as MessageStatus] })) };
    },
  });

  route({
    method: "GET", url: "/api/messaging/jobs", summary: "Mensajes programados, omitidos (con motivo) y anulados", tags: TAGS, perm: "clinic.manage",
    query: z.object({ status: z.enum(["pending", "skipped", "cancelled", "done"]).default("pending"), branchId: zId.optional(), ruleId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const r = await c.query(
        `SELECT j.id, j.status, j.status_reason AS reason, j.send_at AS "sendAt", j.due_at AS "dueAt", j.anchor_at AS "anchorAt", j.processed_at AS "processedAt",
                j.updated_at AS "updatedAt", j.branch_id AS "branchId", b.name AS "branchName", j.rule_id AS "ruleId", r.name AS "ruleName", r.trigger,
                p.first_name || ' ' || p.last_name AS "patientName", j.appointment_id AS "appointmentId"
           FROM message_jobs j JOIN message_rules r ON r.id = j.rule_id JOIN branches b ON b.id = j.branch_id JOIN patients p ON p.id = j.patient_id
          WHERE j.status = $1 AND ($2::uuid IS NULL OR j.branch_id = $2) AND ($3::uuid[] IS NULL OR j.branch_id = ANY($3)) AND ($4::uuid IS NULL OR j.rule_id = $4)
          ORDER BY CASE WHEN j.status = 'pending' THEN j.send_at END ASC, j.updated_at DESC LIMIT 300`,
        [query.status, query.branchId ?? null, allowedBranches(auth), query.ruleId ?? null]);
      return r.rows.map((x) => ({ ...x, statusLabel: JOB_STATUS_LABELS[x.status], triggerLabel: TRIGGER_LABELS[x.trigger as Trigger] }));
    },
  });

  route({
    method: "GET", url: "/api/messaging/stats", summary: "Conteo por día (hora local) de mensajes por estado y de omitidos", tags: TAGS, perm: "clinic.manage",
    query: z.object({ days: z.coerce.number().int().min(1).max(60).default(14), branchId: zId.optional(), ruleId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = (await c.query<{ timezone: string }>("SELECT timezone FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!.timezone;
      const params = [zone, query.days, query.branchId ?? null, allowedBranches(auth), query.ruleId ?? null];
      const out = (await c.query(
        `SELECT to_char((m.created_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day, m.status, count(*)::int AS n
           FROM outbound_messages m LEFT JOIN message_jobs j ON j.message_id = m.id
          WHERE m.created_at >= now() - make_interval(days => $2) AND ($3::uuid IS NULL OR m.branch_id = $3)
            AND ($4::uuid[] IS NULL OR m.branch_id = ANY($4)) AND ($5::uuid IS NULL OR j.rule_id = $5)
          GROUP BY 1, 2`, params)).rows;
      const skipped = (await c.query(
        `SELECT to_char((j.processed_at AT TIME ZONE $1)::date, 'YYYY-MM-DD') AS day, count(*)::int AS n FROM message_jobs j
          WHERE j.status = 'skipped' AND j.processed_at >= now() - make_interval(days => $2) AND ($3::uuid IS NULL OR j.branch_id = $3)
            AND ($4::uuid[] IS NULL OR j.branch_id = ANY($4)) AND ($5::uuid IS NULL OR j.rule_id = $5)
          GROUP BY 1`, params)).rows;
      const days = new Map<string, Record<string, number>>();
      const row = (d: string) => days.get(d) ?? days.set(d, { total: 0, queued: 0, simulated: 0, sent: 0, delivered: 0, read: 0, failed: 0, skipped: 0 }).get(d)!;
      for (const x of out) { const r = row(x.day); r[x.status] = x.n; r.total! += x.n; }
      for (const x of skipped) row(x.day).skipped = x.n;
      return [...days.entries()].sort((a, b) => b[0].localeCompare(a[0])).map(([day, v]) => ({ day, ...v }));
    },
  });

  route({
    method: "POST", url: "/api/messaging/messages/:id/retry", summary: "Reintentar un mensaje que falló (se crea uno nuevo; el original queda como está)", tags: TAGS, perm: "clinic.manage",
    params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const m = (await c.query<{ id: string; status: string; branch_id: string | null; patient_id: string | null; channel: "whatsapp" | "sms" | "email"; recipient: string; template: string; purpose: string; body: string; related_entity: string | null; related_id: string | null }>(
        "SELECT id, status, branch_id, patient_id, channel, recipient, template, purpose, body, related_entity, related_id FROM outbound_messages WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!m) throw notFound("Mensaje");
      if (m.branch_id) requireBranch(auth, m.branch_id);
      if (m.status !== "failed") throw conflict("Solo se reintentan los mensajes que fallaron", "invalid_status");
      if ((await c.query("SELECT 1 FROM outbound_messages WHERE retry_of = $1", [m.id])).rowCount) throw conflict("Ese mensaje ya se reintentó", "already_retried");
      if (m.purpose === "otp") throw conflict("Los códigos de un solo uso no se reintentan: el paciente pide uno nuevo", "invalid_status");
      if (m.patient_id && (m.purpose === "reminders" || m.purpose === "marketing")) {
        const consent = await messagingConsent(c, m.patient_id);
        if (!consent[m.purpose]) throw conflict("El paciente ya no tiene consentimiento para este tipo de mensaje: no se reintenta", "no_consent");
      }
      const res = await messenger.enqueue(c, {
        clinicId: auth.clinicId!, branchId: m.branch_id, patientId: m.patient_id, channel: m.channel, recipient: m.recipient, template: m.template,
        purpose: m.purpose as "reminders", body: m.body, relatedEntity: m.related_entity, relatedId: m.related_id, retryOf: m.id,
      });
      await audit(c, auth, "messaging.retried", "outbound_message", m.id, { newMessageId: res.id, status: res.status }, m.branch_id);
      return { id: res.id, status: res.status, statusLabel: MESSAGE_STATUS_LABELS[res.status] };
    },
  });

  route({
    method: "GET", url: "/api/messaging/inbound", summary: "Respuestas recibidas de los pacientes (bajas y otras)", tags: TAGS, perm: "clinic.manage",
    handler: async ({ c }) => (await c.query(
      `SELECT i.id, i.kind, i.body, i.sender, i.created_at AS "createdAt", p.first_name || ' ' || p.last_name AS "patientName"
         FROM inbound_messages i LEFT JOIN patients p ON p.id = i.patient_id ORDER BY i.created_at DESC LIMIT 50`)).rows,
  });
}
