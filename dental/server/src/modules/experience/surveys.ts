// Encuesta de satisfacción (NPS) después de una cita atendida.
//
//  * Un enlace firmado de un solo uso por cita (/e/:token). Lo emite la regla automática nueva
//    «Encuesta de satisfacción» del módulo de mensajes (desactivada por defecto) o la recepción
//    desde la cita atendida (para mostrarla en una tableta o enviarla a mano).
//  * La página pública no muestra datos clínicos ni el nombre del paciente: solo la clínica, la
//    sucursal y el día de la visita. Nota 0 a 10 y comentario opcional.
//  * Panel para propietario y administración (clinic.manage): NPS por sucursal y por profesional,
//    promotores, pasivos, detractores y comentarios. Un detractor (0 a 6) queda como aviso para
//    gerencia hasta que alguien registra el seguimiento (todavía no existe el tablero de tareas).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Config } from "../../config.js";
import type { Client } from "../../lib/db.js";
import { withTenant } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import { zDate, zId, zIdParams } from "../../lib/http.js";
import { AppError, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { allowedBranches, requireBranch } from "../../lib/rbac.js";
import { clinicZone } from "../agenda.js";
import { signToken, tokenHash, verifyToken } from "./tokens.js";

const TAGS = ["encuestas"];
export const SURVEY_DAYS = 14;
export const DETRACTOR_MAX = 6;
export const PROMOTER_MIN = 9;

export interface NpsStats { answered: number; promoters: number; passives: number; detractors: number; nps: number | null }

/** NPS = % promotores (9-10) − % detractores (0-6), redondeado a entero. Sin respuestas: null. */
export function computeNps(scores: number[]): NpsStats {
  const promoters = scores.filter((s) => s >= PROMOTER_MIN).length;
  const detractors = scores.filter((s) => s <= DETRACTOR_MAX).length;
  const answered = scores.length;
  return { answered, promoters, detractors, passives: answered - promoters - detractors, nps: answered ? Math.round(((promoters - detractors) * 100) / answered) : null };
}

export const surveyUrl = (cfg: Pick<Config, "publicUrl" | "secretKey">, clinicId: string, id: string) => `${cfg.publicUrl}/e/${signToken(cfg.secretKey, "encuesta", clinicId, id)}`;

/**
 * Emite (o renueva el vencimiento de) el enlace de la encuesta de una cita atendida.
 * Devuelve null si la cita no está atendida o la encuesta ya fue respondida (un solo uso).
 */
export async function issueSurvey(
  c: Client, cfg: Pick<Config, "publicUrl" | "secretKey">,
  x: { clinicId: string; appointmentId: string; source: "auto" | "manual"; jobId?: string | null; userId?: string | null },
): Promise<{ id: string; url: string; expiresAt: Date } | null> {
  const a = (await c.query<{ status: string; patient_id: string; branch_id: string; dentist_id: string }>(
    "SELECT status, patient_id, branch_id, dentist_id FROM appointments WHERE id = $1", [x.appointmentId])).rows[0];
  if (!a || a.status !== "completed") return null;
  const expiresAt = new Date(Date.now() + SURVEY_DAYS * 86_400_000);
  const ex = (await c.query<{ id: string; answered_at: Date | null }>(
    "SELECT id, answered_at FROM satisfaction_surveys WHERE appointment_id = $1 FOR UPDATE", [x.appointmentId])).rows[0];
  if (ex) {
    if (ex.answered_at) return null;
    await c.query("UPDATE satisfaction_surveys SET expires_at = $2, job_id = COALESCE($3, job_id) WHERE id = $1", [ex.id, expiresAt, x.jobId ?? null]);
    return { id: ex.id, url: surveyUrl(cfg, x.clinicId, ex.id), expiresAt };
  }
  const id = randomUUID();
  const token = signToken(cfg.secretKey, "encuesta", x.clinicId, id);
  await c.query(
    `INSERT INTO satisfaction_surveys (id, clinic_id, appointment_id, patient_id, branch_id, dentist_id, token_hash, source, job_id, created_by, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [id, x.clinicId, x.appointmentId, a.patient_id, a.branch_id, a.dentist_id, tokenHash(token), x.source, x.jobId ?? null, x.userId ?? null, expiresAt]);
  return { id, url: `${cfg.publicUrl}/e/${token}`, expiresAt };
}

const cleanComment = (s: string | null | undefined) => {
  const t = (s ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  return t ? t : null;
};

export function surveyRoutes(route: Route, cfg: Config) {
  const zToken = z.object({ token: z.string().min(10).max(120) });

  async function load(c: Client, id: string, token: string, lock = false) {
    const r = (await c.query<{ id: string; answered_at: Date | null; expires_at: Date; score: number | null; visit: Date; branch: string; clinic: string; timezone: string; clinic_status: string }>(
      `SELECT s.id, s.answered_at, s.expires_at, s.score, a.starts_at AS visit, b.name AS branch, cl.name AS clinic, cl.timezone, cl.status AS clinic_status
         FROM satisfaction_surveys s JOIN appointments a ON a.id = s.appointment_id JOIN branches b ON b.id = s.branch_id JOIN clinics cl ON cl.id = s.clinic_id
        WHERE s.id = $1 AND s.token_hash = $2 ${lock ? "FOR UPDATE OF s" : ""}`, [id, tokenHash(token)])).rows[0];
    if (!r || !["trial", "active"].includes(r.clinic_status)) throw notFound("Encuesta");
    const state = r.answered_at ? "answered" : Date.now() > +r.expires_at ? "expired" : "open";
    const visit = DateTime.fromJSDate(r.visit, { zone: r.timezone }).setLocale("es").toFormat("cccc d 'de' LLLL");
    // Solo datos no clínicos y sin nombre del paciente (el enlace puede reenviarse).
    return { row: r, view: { state, clinicName: r.clinic, branchName: r.branch, visitDate: visit } };
  }

  function withSurvey<T>(db: Parameters<Parameters<Route>[0]["handler"]>[0]["db"], token: string, fn: (c: Client, v: { clinicId: string; id: string }) => Promise<T>) {
    const v = verifyToken(cfg.secretKey, "encuesta", token);
    if (!v) throw notFound("Encuesta");
    return withTenant(db.appPool, { clinicId: v.clinicId, userId: null }, (c) => fn(c, v));
  }

  route({
    method: "GET", url: "/api/public/encuesta/:token", summary: "Encuesta de satisfacción: estado, clínica, sucursal y día de la visita (sin datos clínicos ni nombre)",
    tags: TAGS, access: "public", noTx: true, params: zToken, limit: cfg.disableRateLimit ? undefined : { max: 60, timeWindow: "1 minute" },
    handler: async ({ db, params }) => withSurvey(db, params.token, async (c, v) => (await load(c, v.id, params.token)).view),
  });

  route({
    method: "POST", url: "/api/public/encuesta/:token", summary: "Responder la encuesta (un solo uso): nota de 0 a 10 y comentario opcional",
    tags: TAGS, access: "public", noTx: true, params: zToken,
    body: z.object({
      score: z.number({ message: "Elige una nota de 0 a 10" }).int("Elige una nota de 0 a 10").min(0, "Elige una nota de 0 a 10").max(10, "Elige una nota de 0 a 10"),
      comment: z.string().max(1000, "El comentario es muy largo (máximo 1000 caracteres)").nullish(),
    }),
    limit: cfg.disableRateLimit ? undefined : { max: 20, timeWindow: "1 minute" },
    handler: async ({ db, params, body, req }) => {
      if (req.headers["x-portal"] !== "1") throw new AppError(403, "csrf", "Solicitud no válida. Recarga la página.");
      return withSurvey(db, params.token, async (c, v) => {
        const { row, view } = await load(c, v.id, params.token, true);
        if (view.state === "answered") throw conflict("Ya respondiste esta encuesta. ¡Gracias!", "survey_answered");
        if (view.state === "expired") throw new AppError(410, "survey_expired", "Esta encuesta ya venció. Si quieres contarnos algo, escribe a la sucursal.");
        const comment = cleanComment(body.comment);
        const r = await c.query<{ branch_id: string; patient_id: string }>(
          "UPDATE satisfaction_surveys SET answered_at = now(), score = $2, comment = $3 WHERE id = $1 AND answered_at IS NULL RETURNING branch_id, patient_id",
          [row.id, body.score, comment]);
        if (!r.rowCount) throw conflict("Ya respondiste esta encuesta. ¡Gracias!", "survey_answered");
        const actor = { clinicId: v.clinicId, userId: null as unknown as string, ip: req.ip };
        const detractor = body.score <= DETRACTOR_MAX;
        await audit(c, actor, detractor ? "survey.detractor" : "survey.answered", "survey", row.id,
          { score: body.score, withComment: !!comment, patientId: r.rows[0]!.patient_id }, r.rows[0]!.branch_id);
        if (detractor) await createDetractorTask(c, v.clinicId, row.id, r.rows[0]!.branch_id, r.rows[0]!.patient_id, body.score);
        return { ok: true, state: "answered", detractor };
      });
    },
  });

  // ---------------- Personal ----------------
  route({
    method: "POST", url: "/api/appointments/:id/survey-link", summary: "Enlace de la encuesta de una cita atendida (para mostrarlo en una tableta o enviarlo a mano). Un solo uso",
    tags: TAGS, perm: "agenda.write", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const a = (await c.query<{ status: string; branch_id: string }>("SELECT status, branch_id FROM appointments WHERE id = $1", [params.id])).rows[0];
      if (!a) throw notFound("Cita");
      requireBranch(auth, a.branch_id);
      if (a.status !== "completed") throw conflict("La encuesta se ofrece cuando la cita está atendida", "not_completed");
      const s = await issueSurvey(c, cfg, { clinicId: auth.clinicId!, appointmentId: params.id, source: "manual", userId: auth.userId });
      if (!s) throw conflict("El paciente ya respondió la encuesta de esta visita", "survey_answered");
      await audit(c, auth, "survey.link_issued", "survey", s.id, { appointmentId: params.id }, a.branch_id);
      return { url: s.url, expiresAt: s.expiresAt };
    },
  });

  const zRange = z.object({ from: zDate.optional(), to: zDate.optional(), branchId: zId.optional() });

  route({
    method: "GET", url: "/api/surveys/summary", summary: "Panel de satisfacción: NPS general, por sucursal y por profesional, comentarios y detractores sin seguimiento",
    tags: TAGS, perm: "clinic.manage", query: zRange,
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const to = query.to ?? DateTime.now().setZone(zone).toISODate()!;
      const from = query.from ?? DateTime.fromISO(to).minus({ days: 89 }).toISODate()!;
      const start = DateTime.fromISO(from, { zone }).startOf("day").toJSDate();
      const end = DateTime.fromISO(to, { zone }).plus({ days: 1 }).startOf("day").toJSDate();
      const scope: unknown[] = [allowedBranches(auth), query.branchId ?? null];
      const filt = "($3::uuid[] IS NULL OR s.branch_id = ANY($3)) AND ($4::uuid IS NULL OR s.branch_id = $4)";
      const answered = (await c.query<{ score: number; branch_id: string; branch: string; dentist_id: string; dentist: string }>(
        `SELECT s.score, s.branch_id, b.name AS branch, s.dentist_id, u.full_name AS dentist
           FROM satisfaction_surveys s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.dentist_id
          WHERE s.answered_at >= $1 AND s.answered_at < $2 AND ${filt}`, [start, end, ...scope])).rows;
      const sent = (await c.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM satisfaction_surveys s WHERE s.created_at >= $1 AND s.created_at < $2 AND ${filt}`, [start, end, ...scope])).rows[0]!.n;
      const group = (key: "branch_id" | "dentist_id", label: "branch" | "dentist") => {
        const m = new Map<string, { id: string; name: string; scores: number[] }>();
        for (const r of answered) {
          const g = m.get(r[key]) ?? { id: r[key], name: r[label], scores: [] };
          g.scores.push(r.score);
          m.set(r[key], g);
        }
        return [...m.values()].map((g) => ({ id: g.id, name: g.name, ...computeNps(g.scores) })).sort((a, b) => b.answered - a.answered || a.name.localeCompare(b.name));
      };
      const comments = (await c.query(
        `SELECT s.id, s.score, s.comment, s.answered_at AS "answeredAt", b.name AS "branchName", u.full_name AS "dentistName",
                p.id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName",
                s.followup_done_at AS "followupAt", s.followup_note AS "followupNote", fu.full_name AS "followupBy"
           FROM satisfaction_surveys s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.dentist_id JOIN patients p ON p.id = s.patient_id
           LEFT JOIN users fu ON fu.id = s.followup_by
          WHERE s.answered_at >= $1 AND s.answered_at < $2 AND ${filt} AND (s.comment IS NOT NULL OR s.score <= ${DETRACTOR_MAX})
          ORDER BY s.answered_at DESC LIMIT 100`, [start, end, ...scope])).rows;
      // Detractores sin seguimiento (de cualquier fecha): avisos para gerencia.
      const alerts = (await c.query(
        `SELECT s.id, s.score, s.comment, s.answered_at AS "answeredAt", b.name AS "branchName", u.full_name AS "dentistName",
                p.id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName", p.phone
           FROM satisfaction_surveys s JOIN branches b ON b.id = s.branch_id JOIN users u ON u.id = s.dentist_id JOIN patients p ON p.id = s.patient_id
          WHERE s.score <= ${DETRACTOR_MAX} AND s.followup_done_at IS NULL AND ($1::uuid[] IS NULL OR s.branch_id = ANY($1)) AND ($2::uuid IS NULL OR s.branch_id = $2)
          ORDER BY s.answered_at LIMIT 100`, scope)).rows;
      const overall = computeNps(answered.map((r) => r.score));
      return {
        from, to, sent, responseRate: sent ? Math.round((overall.answered * 100) / sent) : null, overall,
        byBranch: group("branch_id", "branch"), byDentist: group("dentist_id", "dentist"), comments, alerts,
        tasksModule: false,
      };
    },
  });

  route({
    method: "POST", url: "/api/surveys/:id/followup", summary: "Registrar el seguimiento de un detractor (llamada, disculpa, cita de revisión). Queda una sola vez",
    tags: TAGS, perm: "clinic.manage", params: zIdParams, body: z.object({ note: z.string().trim().min(3, "Cuenta brevemente qué se hizo").max(500) }),
    handler: async ({ c, auth, params, body }) => {
      const s = (await c.query<{ branch_id: string; answered_at: Date | null; followup_done_at: Date | null }>(
        "SELECT branch_id, answered_at, followup_done_at FROM satisfaction_surveys WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!s || !s.answered_at) throw notFound("Respuesta");
      requireBranch(auth, s.branch_id);
      if (s.followup_done_at) throw conflict("El seguimiento ya quedó registrado", "already_done");
      await c.query("UPDATE satisfaction_surveys SET followup_done_at = now(), followup_by = $2, followup_note = $3 WHERE id = $1", [params.id, auth.userId, body.note]);
      // Si había una tarea de seguimiento abierta, queda hecha.
      await c.query(
        `UPDATE staff_tasks SET status = 'done', done_by = $2, done_at = now(), updated_at = now()
          WHERE source_survey_id = $1 AND status IN ('open','taken')`, [params.id, auth.userId]);
      await audit(c, auth, "survey.followup", "survey", params.id, { note: body.note }, s.branch_id);
      return { ok: true };
    },
  });
}

/**
 * Un detractor (0 a 6) crea una tarea de seguimiento para gerencia de la sucursal: administración si existe en la
 * clínica, si no, propietario. Vence al día siguiente. Sin el comentario del paciente (puede traer datos de salud):
 * se lee en el panel de satisfacción. Idempotente por encuesta (índice único).
 */
export async function createDetractorTask(c: Client, clinicId: string, surveyId: string, branchId: string, patientId: string, score: number) {
  const role = (await c.query<{ role: string }>(
    `SELECT role FROM memberships WHERE clinic_id = $1 AND active AND role IN ('admin','owner')
        AND (all_branches OR $2::uuid = ANY(branch_ids))
      ORDER BY (role = 'admin') DESC LIMIT 1`, [clinicId, branchId])).rows[0]?.role;
  if (!role) return null;
  const id = (await c.query<{ id: string }>(
    `INSERT INTO staff_tasks (clinic_id, branch_id, title, detail, assignee_role, due_at, priority, patient_id, source, source_survey_id, created_by)
     VALUES ($1, $2, $3, $4, $5, now() + interval '1 day', 'high', $6, 'survey', $7, NULL)
     ON CONFLICT (clinic_id, source_survey_id) WHERE source_survey_id IS NOT NULL DO NOTHING RETURNING id`,
    [clinicId, branchId, `Llamar a un paciente insatisfecho (encuesta: ${score}/10)`,
      "El paciente respondió la encuesta de satisfacción con una nota baja. Llámalo para escuchar su experiencia y registra lo conversado al completar la tarea (queda como seguimiento de la encuesta).",
      role, patientId, surveyId])).rows[0]?.id ?? null;
  if (id) await audit(c, { clinicId, userId: null as unknown as string, ip: undefined as unknown as string }, "task.created", "task", id,
    { assigneeRole: role, priority: "high", patientId, source: "survey" }, branchId);
  return id;
}
