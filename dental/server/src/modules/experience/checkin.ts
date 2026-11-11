// Llegada del paciente con QR en la recepción de cada sucursal (R2-31).
//
//  * Cada sucursal tiene un QR imprimible con un enlace firmado (/llegada/:token). Se puede
//    renovar (el anterior deja de servir).
//  * El paciente se identifica con los 4 últimos dígitos del celular (suyo, del responsable o del
//    tutor legal declarado) y su fecha de nacimiento, o desde el enlace de su recordatorio (pulsando
//    un botón: abrir el enlace no registra nada, así los pre-lectores de mensajes no marcan llegadas).
//  * Con una cita de hoy en esa sucursal dentro de la ventana (−60 a +30 min de la hora de inicio)
//    la cita pasa a «Llegó» (sala de espera) con la transición normal de la agenda y queda en su
//    historial. Fuera de la ventana solo se informa la hora. Reescanear no cambia nada (idempotente).
//  * Límite de intentos fallidos por dispositivo y por sucursal; cada intento queda registrado
//    (solo inserción). La página nunca muestra nombres ni otros datos personales.
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { DateTime } from "luxon";
import QRCode from "qrcode";
import type { FastifyReply } from "fastify";
import type { Config } from "../../config.js";
import type { Client } from "../../lib/db.js";
import { withTenant } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import { zDate, zId, zIdParams } from "../../lib/http.js";
import { AppError, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { allowedBranches, requireBranch } from "../../lib/rbac.js";
import { TRANSITIONS } from "../agenda.js";
import { afterAppointmentStatusChange } from "../appointmentEvents.js";
import { confirmTokenHash, verifyConfirmToken } from "../messaging/tokens.js";
import { sha256hex, signToken, verifyToken } from "./tokens.js";

const TAGS = ["llegada con QR"];
/** Ventana válida alrededor de la hora de la cita (minutos). */
export const WINDOW_BEFORE_MIN = 60;
export const WINDOW_AFTER_MIN = 30;
/** Intentos fallidos permitidos por dispositivo y sucursal en 15 minutos, y por sucursal en total. */
export const MAX_FAILED_PER_DEVICE = 5;
export const MAX_FAILED_PER_BRANCH = 60;
const RATE_WINDOW_MIN = 15;

export type CheckinState = "arrived" | "already" | "early" | "late" | "not_found" | "blocked";

export const checkinUrl = (cfg: Pick<Config, "publicUrl" | "secretKey">, clinicId: string, pointId: string) =>
  `${cfg.publicUrl}/llegada/${signToken(cfg.secretKey, "llegada", clinicId, pointId)}`;

/** Estado de una cita respecto de la ventana de llegada (función pura). */
export function windowState(startsAt: Date, now: number = Date.now()): "early" | "open" | "late" {
  const s = startsAt.getTime();
  if (now < s - WINDOW_BEFORE_MIN * 60_000) return "early";
  if (now > s + WINDOW_AFTER_MIN * 60_000) return "late";
  return "open";
}

interface ApptRow { id: string; status: string; starts_at: Date; branch_id: string }
type Actor = { clinicId: string; userId: string; ip: string };

/** Aplica la llegada a las citas encontradas y resume el resultado (sin datos personales). */
async function applyCheckin(c: Client, actor: Actor, appts: ApptRow[], zone: string, via: "qr" | "reminder") {
  const now = Date.now();
  const time = (d: Date) => {
    const t = DateTime.fromJSDate(d, { zone }).setLocale("es");
    return t.hasSame(DateTime.fromMillis(now, { zone }), "day") ? t.toFormat("HH:mm") : `${t.toFormat("HH:mm")} del ${t.toFormat("cccc d")}`;
  };
  let arrived = 0, already = 0;
  let early: ApptRow | null = null, late: ApptRow | null = null;
  const touched: string[] = [];
  for (const a of appts) {
    if (["arrived", "in_progress", "completed"].includes(a.status)) { already++; touched.push(a.id); continue; }
    const w = windowState(a.starts_at, now);
    if (w === "early") { if (!early || a.starts_at < early.starts_at) early = a; continue; }
    if (w === "late") { late = a; continue; }
    if (!TRANSITIONS[a.status]?.includes("arrived")) continue;
    await c.query("UPDATE appointments SET status = 'arrived', arrived_at = now(), updated_at = now() WHERE id = $1", [a.id]);
    await audit(c, actor, "appointment.status", "appointment", a.id, { from: a.status, to: "arrived", via: via === "qr" ? "QR de la sucursal" : "enlace del recordatorio" }, a.branch_id);
    await afterAppointmentStatusChange(c, actor, {
      appointmentId: a.id, branchId: a.branch_id, from: a.status, to: "arrived",
      reason: via === "qr" ? "Llegada registrada por el paciente con el QR de la sucursal" : "Llegada registrada por el paciente desde el enlace del recordatorio",
    });
    arrived++;
    touched.push(a.id);
  }
  if (arrived) return { state: "arrived" as const, count: arrived, appointmentId: touched[0]!, message: arrived > 1 ? `¡Listo! Registramos la llegada de ${arrived} citas. Toma asiento: te llamaremos.` : "¡Listo! Avisamos a recepción que llegaste. Toma asiento: te llamaremos." };
  if (already) return { state: "already" as const, count: already, appointmentId: touched[0]!, message: "Ya registramos tu llegada. Toma asiento: te llamaremos." };
  if (early) {
    const from = DateTime.fromJSDate(early.starts_at, { zone }).minus({ minutes: WINDOW_BEFORE_MIN }).toFormat("HH:mm");
    return { state: "early" as const, count: 0, appointmentId: early.id, time: time(early.starts_at), message: `Tu cita es a las ${time(early.starts_at)}. Puedes registrar tu llegada desde las ${from}.` };
  }
  if (late) return { state: "late" as const, count: 0, appointmentId: late.id, time: time(late.starts_at), message: `Tu cita era a las ${time(late.starts_at)}. Acércate a recepción para ver si aún podemos atenderte.` };
  return { state: "not_found" as const, count: 0, appointmentId: null, message: NOT_FOUND };
}

const NOT_FOUND = "No encontramos una cita próxima en esta sucursal con esos datos. Revisa los datos o acércate a recepción.";
const BLOCKED = "Hiciste demasiados intentos. Espera unos minutos o acércate a recepción.";

function soft(reply: FastifyReply, status: number, body: Record<string, unknown>) {
  reply.code(status);
  return body;
}

async function logAttempt(c: Client, x: { clinicId: string; branchId: string; pointId: string | null; method: "qr" | "reminder"; ipHash: string; outcome: CheckinState; appointmentId: string | null }) {
  await c.query(
    "INSERT INTO checkin_attempts (clinic_id, branch_id, point_id, method, ip_hash, outcome, appointment_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
    [x.clinicId, x.branchId, x.pointId, x.method, x.ipHash, x.outcome, x.appointmentId]);
}

async function isBlocked(c: Client, branchId: string, ipHash: string) {
  const r = (await c.query<{ device: number; branch: number }>(
    `SELECT count(*) FILTER (WHERE ip_hash = $2)::int AS device, count(*)::int AS branch FROM checkin_attempts
      WHERE branch_id = $1 AND outcome = 'not_found' AND created_at > now() - make_interval(mins => $3)`, [branchId, ipHash, RATE_WINDOW_MIN])).rows[0]!;
  return r.device >= MAX_FAILED_PER_DEVICE || r.branch >= MAX_FAILED_PER_BRANCH;
}

export function checkinRoutes(route: Route, cfg: Config) {
  const zToken = z.object({ token: z.string().min(10).max(120) });
  const publicLimit = (max: number) => (cfg.disableRateLimit ? undefined : { max, timeWindow: "1 minute" });
  type DbT = Parameters<Parameters<Route>[0]["handler"]>[0]["db"];

  function withPoint<T>(db: DbT, token: string, fn: (c: Client, p: { clinicId: string; pointId: string; branchId: string; branchName: string; clinicName: string; zone: string }) => Promise<T>) {
    const v = verifyToken(cfg.secretKey, "llegada", token);
    if (!v) throw notFound("Código QR");
    return withTenant(db.appPool, { clinicId: v.clinicId, userId: null }, async (c) => {
      const p = (await c.query<{ branch_id: string; branch: string; clinic: string; timezone: string; clinic_status: string }>(
        `SELECT k.branch_id, b.name AS branch, cl.name AS clinic, cl.timezone, cl.status AS clinic_status
           FROM checkin_points k JOIN branches b ON b.id = k.branch_id JOIN clinics cl ON cl.id = k.clinic_id
          WHERE k.id = $1 AND k.active AND b.active`, [v.id])).rows[0];
      if (!p || !["trial", "active"].includes(p.clinic_status)) throw new AppError(404, "not_found", "Este código QR ya no está activo. Pide ayuda en recepción.");
      return fn(c, { clinicId: v.clinicId, pointId: v.id, branchId: p.branch_id, branchName: p.branch, clinicName: p.clinic, zone: p.timezone });
    });
  }

  route({
    method: "GET", url: "/api/public/llegada/:token", summary: "QR de llegada: nombre de la clínica y de la sucursal (sin datos personales)", tags: TAGS,
    access: "public", noTx: true, params: zToken, limit: publicLimit(60),
    handler: async ({ db, params }) => withPoint(db, params.token, async (_c, p) => ({ clinicName: p.clinicName, branchName: p.branchName, windowBefore: WINDOW_BEFORE_MIN, windowAfter: WINDOW_AFTER_MIN })),
  });

  route({
    method: "POST", url: "/api/public/llegada/:token", summary: "Registrar la llegada con los 4 últimos dígitos del celular y la fecha de nacimiento (ventana −60/+30 min, idempotente, con límite de intentos)",
    tags: TAGS, access: "public", noTx: true, params: zToken, limit: publicLimit(20),
    body: z.object({
      phoneLast4: z.string().regex(/^\d{4}$/, "Escribe los 4 últimos dígitos del celular"),
      birthDate: zDate,
    }),
    handler: async ({ db, params, body, req, reply }) => {
      if (req.headers["x-portal"] !== "1") throw new AppError(403, "csrf", "Solicitud no válida. Recarga la página.");
      return withPoint(db, params.token, async (c, p) => {
        const ipHash = sha256hex(`${p.clinicId}:${req.ip}`);
        const base = { clinicId: p.clinicId, branchId: p.branchId, pointId: p.pointId, method: "qr" as const, ipHash };
        // Serializa los intentos de la sucursal: el conteo del límite no tiene carreras.
        await c.query("SELECT pg_advisory_xact_lock(hashtextextended('checkin:' || $1, 0))", [p.branchId]);
        if (await isBlocked(c, p.branchId, ipHash)) {
          await logAttempt(c, { ...base, outcome: "blocked", appointmentId: null });
          return soft(reply, 429, { error: { code: "rate_limited", message: BLOCKED } });
        }
        // Citas cercanas (−8 h a +12 h): así la hora se informa aunque falte mucho o ya haya pasado.
        const nowMs = Date.now();
        const appts = (await c.query<ApptRow>(
          `SELECT a.id, a.status, a.starts_at, a.branch_id FROM appointments a JOIN patients pt ON pt.id = a.patient_id
            WHERE a.branch_id = $1 AND a.starts_at >= $2 AND a.starts_at < $3 AND a.status NOT IN ('cancelled','no_show')
              AND pt.archived_at IS NULL AND pt.birth_date = $4::date
              AND (right(regexp_replace(coalesce(pt.phone, ''), '\\D', '', 'g'), 4) = $5
                OR right(regexp_replace(coalesce(pt.guardian_phone, ''), '\\D', '', 'g'), 4) = $5
                OR EXISTS (SELECT 1 FROM patient_relationships r JOIN patients g ON g.id = r.person_a
                            WHERE r.person_b = pt.id AND r.legal_guardian AND r.ended_at IS NULL
                              AND right(regexp_replace(coalesce(g.phone, ''), '\\D', '', 'g'), 4) = $5))
            ORDER BY a.starts_at FOR UPDATE OF a`,
          [p.branchId, new Date(nowMs - 8 * 3_600_000), new Date(nowMs + 12 * 3_600_000), body.birthDate, body.phoneLast4])).rows;
        const actor: Actor = { clinicId: p.clinicId, userId: null as unknown as string, ip: req.ip };
        const res = await applyCheckin(c, actor, appts, p.zone, "qr");
        await logAttempt(c, { ...base, outcome: res.state, appointmentId: res.appointmentId });
        const { appointmentId: _omit, ...out } = res;
        return res.state === "not_found" ? soft(reply, 404, { ...out, error: { code: "not_found", message: NOT_FOUND } }) : out;
      });
    },
  });

  // ---------------- Desde el enlace del recordatorio (/c/:token) ----------------
  function withReminder<T>(db: DbT, token: string, fn: (c: Client, x: { clinicId: string; appt: ApptRow; zone: string; branchName: string; clinicName: string }) => Promise<T>, lock = false) {
    const v = verifyConfirmToken(cfg.secretKey, token);
    if (!v) throw notFound("Enlace");
    return withTenant(db.appPool, { clinicId: v.clinicId, userId: null }, async (c) => {
      const r = (await c.query<ApptRow & { token_starts_at: Date; timezone: string; branch: string; clinic: string; clinic_status: string }>(
        `SELECT a.id, a.status, a.starts_at, a.branch_id, t.starts_at AS token_starts_at, cl.timezone, b.name AS branch, cl.name AS clinic, cl.status AS clinic_status
           FROM message_confirm_tokens t JOIN appointments a ON a.id = t.appointment_id JOIN branches b ON b.id = a.branch_id JOIN clinics cl ON cl.id = t.clinic_id
          WHERE t.id = $1 AND t.token_hash = $2 ${lock ? "FOR UPDATE OF a" : ""}`, [v.tokenId, confirmTokenHash(token)])).rows[0];
      if (!r || !["trial", "active"].includes(r.clinic_status)) throw notFound("Enlace");
      if (+r.starts_at !== +r.token_starts_at) throw new AppError(409, "appointment_changed", "Tu cita cambió de horario. Usa el enlace del mensaje más reciente o el QR de la recepción.");
      return fn(c, { clinicId: v.clinicId, appt: r, zone: r.timezone, branchName: r.branch, clinicName: r.clinic });
    });
  }

  route({
    method: "GET", url: "/api/public/llegada-recordatorio/:token", summary: "Llegada desde el enlace del recordatorio: sucursal, hora y si ya se puede registrar (abrir no registra nada)",
    tags: TAGS, access: "public", noTx: true, params: zToken, limit: publicLimit(60),
    handler: async ({ db, params }) => withReminder(db, params.token, async (_c, x) => {
      const w = windowState(x.appt.starts_at);
      const time = DateTime.fromJSDate(x.appt.starts_at, { zone: x.zone }).toFormat("HH:mm");
      const today = DateTime.fromJSDate(x.appt.starts_at, { zone: x.zone }).hasSame(DateTime.now().setZone(x.zone), "day");
      const state = ["arrived", "in_progress", "completed"].includes(x.appt.status) ? "already" : ["cancelled", "no_show"].includes(x.appt.status) ? "cancelled" : w === "open" ? "open" : w;
      return { clinicName: x.clinicName, branchName: x.branchName, time, today, state, windowBefore: WINDOW_BEFORE_MIN, windowAfter: WINDOW_AFTER_MIN };
    }),
  });

  route({
    method: "POST", url: "/api/public/llegada-recordatorio/:token", summary: "Registrar la llegada pulsando el botón del enlace del recordatorio (ventana −60/+30 min, idempotente)",
    tags: TAGS, access: "public", noTx: true, params: zToken, limit: publicLimit(20),
    handler: async ({ db, params, req, reply }) => {
      if (req.headers["x-portal"] !== "1") throw new AppError(403, "csrf", "Solicitud no válida. Recarga la página.");
      return withReminder(db, params.token, async (c, x) => {
        if (["cancelled", "no_show"].includes(x.appt.status)) throw new AppError(409, "appointment_cancelled", "Esta cita fue cancelada. Acércate a recepción.");
        const actor: Actor = { clinicId: x.clinicId, userId: null as unknown as string, ip: req.ip };
        const res = await applyCheckin(c, actor, [x.appt], x.zone, "reminder");
        await logAttempt(c, { clinicId: x.clinicId, branchId: x.appt.branch_id, pointId: null, method: "reminder", ipHash: sha256hex(`${x.clinicId}:${req.ip}`), outcome: res.state, appointmentId: x.appt.id });
        const { appointmentId: _omit, ...out } = res;
        return res.state === "early" || res.state === "late" ? soft(reply, 409, { ...out, error: { code: `checkin_${res.state}`, message: res.message } }) : out;
      }, true);
    },
  });

  // ---------------- Personal: QR por sucursal ----------------
  route({
    method: "GET", url: "/api/checkin/points", summary: "QR de llegada de cada sucursal (enlace, imagen para imprimir y llegadas de hoy)", tags: TAGS, perm: "clinic.manage",
    handler: async ({ c, auth }) => {
      const zone = (await c.query<{ timezone: string }>("SELECT timezone FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!.timezone;
      const day = DateTime.now().setZone(zone).startOf("day").toJSDate();
      const rows = (await c.query<{ branch_id: string; branch: string; point_id: string | null; created_at: Date | null; arrived: number; failed: number; blocked: number }>(
        `SELECT b.id AS branch_id, b.name AS branch, k.id AS point_id, k.created_at,
                (SELECT count(*)::int FROM checkin_attempts x WHERE x.branch_id = b.id AND x.created_at >= $2 AND x.outcome = 'arrived') AS arrived,
                (SELECT count(*)::int FROM checkin_attempts x WHERE x.branch_id = b.id AND x.created_at >= $2 AND x.outcome = 'not_found') AS failed,
                (SELECT count(*)::int FROM checkin_attempts x WHERE x.branch_id = b.id AND x.created_at >= $2 AND x.outcome = 'blocked') AS blocked
           FROM branches b LEFT JOIN checkin_points k ON k.branch_id = b.id AND k.active
          WHERE b.active AND ($1::uuid[] IS NULL OR b.id = ANY($1)) ORDER BY b.code`, [allowedBranches(auth), day])).rows;
      const out = [];
      for (const r of rows) {
        const url = r.point_id ? checkinUrl(cfg, auth.clinicId!, r.point_id) : null;
        out.push({
          branchId: r.branch_id, branchName: r.branch, pointId: r.point_id, createdAt: r.created_at, url,
          qrSvg: url ? await QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }) : null,
          today: { arrived: r.arrived, failed: r.failed, blocked: r.blocked },
        });
      }
      return out;
    },
  });

  route({
    method: "POST", url: "/api/checkin/points", summary: "Crear o renovar el QR de llegada de una sucursal (el anterior deja de funcionar)", tags: TAGS, perm: "clinic.manage",
    body: z.object({ branchId: zId }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      const b = (await c.query("SELECT 1 FROM branches WHERE id = $1 AND active", [body.branchId])).rowCount;
      if (!b) throw notFound("Sucursal");
      const prev = (await c.query<{ id: string }>("UPDATE checkin_points SET active = false, revoked_at = now(), revoked_by = $2 WHERE branch_id = $1 AND active RETURNING id", [body.branchId, auth.userId])).rows[0];
      const id = randomUUID();
      await c.query("INSERT INTO checkin_points (id, clinic_id, branch_id, created_by) VALUES ($1,$2,$3,$4)", [id, auth.clinicId, body.branchId, auth.userId]);
      await audit(c, auth, prev ? "checkin.qr_renewed" : "checkin.qr_created", "checkin_point", id, { previous: prev?.id ?? null }, body.branchId);
      return { id, url: checkinUrl(cfg, auth.clinicId!, id), renewed: !!prev };
    },
  });

  route({
    method: "POST", url: "/api/checkin/points/:id/revoke", summary: "Desactivar el QR de llegada de una sucursal", tags: TAGS, perm: "clinic.manage", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const p = (await c.query<{ branch_id: string }>("SELECT branch_id FROM checkin_points WHERE id = $1 AND active", [params.id])).rows[0];
      if (!p) throw notFound("Código QR");
      requireBranch(auth, p.branch_id);
      await c.query("UPDATE checkin_points SET active = false, revoked_at = now(), revoked_by = $2 WHERE id = $1", [params.id, auth.userId]);
      await audit(c, auth, "checkin.qr_revoked", "checkin_point", params.id, {}, p.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "GET", url: "/api/checkin/attempts", summary: "Intentos de llegada de un día por sucursal (resultado y hora; sin datos personales)", tags: TAGS, perm: "clinic.manage",
    query: z.object({ branchId: zId, date: zDate.optional() }),
    handler: async ({ c, auth, query }) => {
      requireBranch(auth, query.branchId);
      const zone = (await c.query<{ timezone: string }>("SELECT timezone FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!.timezone;
      const day = (query.date ? DateTime.fromISO(query.date, { zone }) : DateTime.now().setZone(zone)).startOf("day");
      return (await c.query(
        `SELECT x.created_at AS "at", x.method, x.outcome FROM checkin_attempts x
          WHERE x.branch_id = $1 AND x.created_at >= $2 AND x.created_at < $3 ORDER BY x.created_at DESC LIMIT 200`,
        [query.branchId, day.toJSDate(), day.plus({ days: 1 }).toJSDate()])).rows;
    },
  });
}
