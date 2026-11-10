// Núcleo de la reserva online y del portal del paciente: contexto por slug, configuración,
// disponibilidad (mismo motor que la agenda interna), retenciones, límites, sesiones y consentimientos.
import { createHash, createHmac, randomBytes, randomInt } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { DateTime } from "luxon";
import type { Db, Client } from "../../lib/db.js";
import { withTenant } from "../../lib/db.js";
import { AppError, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { dayAvailability } from "../agenda.js";
import { contentHash, KIND_LABELS, render } from "../consents.js";

export const PATIENT_COOKIE = "psid";
export const COOKIE_PATH = "/api/public";
export const HOLD_MINUTES = 7;
export const OTP_MINUTES = 10;
export const OTP_MAX_ATTEMPTS = 5;
export const SESSION_HOURS = 2;
export const MAX_ACTIVE_WEB_BOOKINGS = 3;

export interface PortalSettings {
  enabled: boolean;
  leadTimeHours: number;
  maxDaysAhead: number;
  changeWindowHours: number;
  showPrices: boolean;
  instructions: string | null;
}

export const DEFAULT_SETTINGS: PortalSettings = {
  enabled: false, leadTimeHours: 2, maxDaysAhead: 30, changeWindowHours: 24, showPrices: false, instructions: null,
};

export interface PortalCtx {
  clinicId: string;
  clinicName: string;
  slug: string;
  zone: string;
  ip: string;
  settings: PortalSettings;
}

export const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest();
export const newToken = () => randomBytes(32).toString("base64url");

/** Actor de auditoría para acciones públicas (sin usuario del personal). */
export const publicActor = (ctx: Pick<PortalCtx, "clinicId" | "ip">) =>
  ({ clinicId: ctx.clinicId, userId: null as unknown as string, ip: ctx.ip }) as Pick<AuthCtx, "userId" | "clinicId" | "ip">;

export async function paudit(c: Client, ctx: PortalCtx, action: string, entity: string, entityId: string | null, data: Record<string, unknown> = {}, branchId: string | null = null) {
  await audit(c, publicActor(ctx), action, entity, entityId, data, branchId);
}

export async function loadSettings(c: Client, clinicId: string): Promise<PortalSettings> {
  const r = (await c.query(
    `SELECT enabled, lead_time_hours AS "leadTimeHours", max_days_ahead AS "maxDaysAhead", change_window_hours AS "changeWindowHours",
            show_prices AS "showPrices", instructions FROM portal_settings WHERE clinic_id = $1`, [clinicId])).rows[0];
  return r ? (r as PortalSettings) : { ...DEFAULT_SETTINGS };
}

/**
 * Resuelve el slug con la función SECURITY DEFINER (solo devuelve el id si la reserva está activa)
 * y ejecuta fn en una transacción con RLS fijado a esa clínica.
 */
export async function withPortal<T>(db: Db, slug: string, req: FastifyRequest, fn: (c: Client, ctx: PortalCtx) => Promise<T>): Promise<T> {
  const id = (await db.appPool.query<{ id: string | null }>("SELECT portal_clinic_by_slug($1) AS id", [slug])).rows[0]?.id;
  if (!id) throw notFound("Página de reservas");
  return withTenant(db.appPool, { clinicId: id, userId: null }, async (c) => {
    const cl = (await c.query<{ name: string; timezone: string }>("SELECT name, timezone FROM clinics WHERE id = $1", [id])).rows[0];
    if (!cl) throw notFound("Página de reservas");
    const ctx: PortalCtx = { clinicId: id, clinicName: cl.name, slug, zone: cl.timezone, ip: req.ip, settings: await loadSettings(c, id) };
    return fn(c, ctx);
  });
}

/** Respuesta de error que NO revierte la transacción (p. ej. para guardar el intento fallido). */
export function softError(reply: FastifyReply, status: number, code: string, message: string, details?: unknown) {
  reply.code(status);
  return { error: { code, message, details } };
}

// ---------------- Límites de solicitudes ----------------
export async function rateLimit(c: Client, ctx: PortalCtx, bucket: string, key: string, max: number, windowMin: number, opts: { silent?: boolean } = {}): Promise<boolean> {
  const kh = sha256(`${bucket}:${key}`).toString("hex");
  const n = (await c.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM portal_rate_events WHERE clinic_id = $1 AND bucket = $2 AND key_hash = $3 AND created_at > now() - make_interval(mins => $4)",
    [ctx.clinicId, bucket, kh, windowMin])).rows[0]!.n;
  if (n >= max) {
    if (opts.silent) return false;
    throw new AppError(429, "rate_limited", "Hiciste demasiados intentos seguidos. Espera unos minutos y vuelve a intentarlo, o escribe a la sucursal por WhatsApp.");
  }
  await c.query("INSERT INTO portal_rate_events (clinic_id, bucket, key_hash) VALUES ($1,$2,$3)", [ctx.clinicId, bucket, kh]);
  if (Math.random() < 0.05) await c.query("DELETE FROM portal_rate_events WHERE clinic_id = $1 AND created_at < now() - interval '25 hours'", [ctx.clinicId]);
  return true;
}

// ---------------- Códigos ----------------
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
export function bookingCode(): string {
  let s = "";
  for (let i = 0; i < 8; i++) s += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)];
  return `${s.slice(0, 4)}-${s.slice(4)}`;
}

export const otpCode = () => String(randomInt(0, 1_000_000)).padStart(6, "0");
export const otpHash = (key: Buffer, otpId: string, code: string) => createHmac("sha256", key).update(`${otpId}:${code}`).digest();

/** CI normalizado para comparar: sin espacios ni signos, en mayúsculas. */
export const normDoc = (s: string) => s.replace(/[^0-9A-Za-z]/g, "").toUpperCase();
export const DOC_SQL = "upper(regexp_replace(coalesce(document_number, ''), '[^0-9A-Za-z]', '', 'g'))";

export function maskPhone(p: string | null): string {
  if (!p) return "";
  const d = p.replace(/\D/g, "");
  return `•••• ${d.slice(-3)}`;
}

export function isMinorDate(birth: string | null, now = new Date()): boolean {
  if (!birth) return false;
  const b = new Date(birth + "T00:00:00Z");
  let age = now.getUTCFullYear() - b.getUTCFullYear();
  if (now.getUTCMonth() < b.getUTCMonth() || (now.getUTCMonth() === b.getUTCMonth() && now.getUTCDate() < b.getUTCDate())) age--;
  return age < 18;
}

// ---------------- Catálogo público ----------------
export interface PublicBranch { id: string; name: string; address: string | null; city: string | null; phone: string | null; mode: "instant" | "request"; whatsapp: string | null; mapUrl: string }

export function mapLink(b: { map_url?: string | null; address: string | null; city: string | null; name: string }, clinicName: string): string {
  if (b.map_url) return b.map_url;
  const q = [clinicName, b.name, b.address, b.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(q)}`;
}

export async function publicBranches(c: Client, ctx: PortalCtx, onlyId?: string): Promise<PublicBranch[]> {
  const r = await c.query(
    `SELECT b.id, b.name, b.address, b.city, b.phone, COALESCE(s.mode, 'request') AS mode, s.whatsapp, s.map_url
       FROM branches b LEFT JOIN portal_branch_settings s ON s.branch_id = b.id
      WHERE b.active AND COALESCE(s.enabled, true) AND ($1::uuid IS NULL OR b.id = $1) ORDER BY b.code`, [onlyId ?? null]);
  return r.rows.map((b) => ({
    id: b.id, name: b.name, address: b.address, city: b.city, phone: b.phone, mode: b.mode, whatsapp: b.whatsapp ?? null,
    mapUrl: mapLink(b, ctx.clinicName),
  }));
}

export async function requireBranchPublic(c: Client, ctx: PortalCtx, branchId: string): Promise<PublicBranch> {
  const b = (await publicBranches(c, ctx, branchId))[0];
  if (!b) throw new AppError(404, "not_found", "Esa sucursal no recibe reservas en línea");
  return b;
}

export interface PublicService { id: string; name: string; category: string; durationMin: number; priceFromCents: number | null }

export async function publicServices(c: Client, ctx: PortalCtx, onlyId?: string): Promise<PublicService[]> {
  const r = await c.query(
    `SELECT p.id, p.name, p.category, p.duration_min AS "durationMin", s.price_from_cents AS "priceFromCents"
       FROM portal_services s JOIN procedures p ON p.id = s.procedure_id
      WHERE p.active AND ($1::uuid IS NULL OR p.id = $1) ORDER BY s.position, p.name`, [onlyId ?? null]);
  return r.rows.map((s) => ({ ...s, priceFromCents: ctx.settings.showPrices ? s.priceFromCents : null }));
}

export async function requireServicePublic(c: Client, ctx: PortalCtx, procedureId: string): Promise<PublicService> {
  const s = (await publicServices(c, ctx, procedureId))[0];
  if (!s) throw new AppError(404, "not_found", "Esa prestación no se reserva en línea");
  return s;
}

/** Profesionales con horario en la sucursal (nombre público). */
export async function publicDentists(c: Client, branchId: string) {
  return (await c.query<{ id: string; name: string }>(
    `SELECT DISTINCT u.id, u.full_name AS name FROM dentist_schedules s
       JOIN memberships m ON m.clinic_id = s.clinic_id AND m.user_id = s.dentist_id AND m.active AND m.is_professional
       JOIN users u ON u.id = s.dentist_id
      WHERE s.branch_id = $1 ORDER BY u.full_name`, [branchId])).rows;
}

// ---------------- Disponibilidad ----------------
export interface PublicSlot { startsAt: string; endsAt: string; dentistId: string; dentistName: string }

/** Ventana reservable: desde ahora + anticipación mínima hasta el final del día "hoy + días máximos". */
export function bookingWindow(ctx: PortalCtx, now = Date.now()) {
  const minStart = now + ctx.settings.leadTimeHours * 3_600_000;
  const today = DateTime.fromMillis(now, { zone: ctx.zone }).startOf("day");
  const lastDay = today.plus({ days: ctx.settings.maxDaysAhead });
  return { minStart, today: today.toISODate()!, lastDay: lastDay.toISODate()!, maxEnd: lastDay.endOf("day").toMillis() };
}

/**
 * Horarios libres para el paciente. Usa dayAvailability (mismo motor de la agenda interna:
 * horario del profesional, bloqueos y citas en cualquier sucursal) y además descarta
 * horarios pasados, la anticipación mínima, el límite de días y las retenciones activas de otros.
 */
export async function publicSlots(
  c: Client, ctx: PortalCtx,
  q: { branchId: string; durationMin: number; dentistId: string | null; date: string; excludeAppointmentId?: string | null; ownHoldHash?: Buffer | null },
): Promise<PublicSlot[]> {
  const w = bookingWindow(ctx);
  if (q.date < w.today || q.date > w.lastDay) return [];
  const step = q.durationMin < 30 ? 15 : 30;
  const av = await dayAvailability(c, ctx.zone, q.date, q.branchId, { dentistId: q.dentistId, durationMin: q.durationMin, stepMin: step, excludeAppointmentId: q.excludeAppointmentId ?? null });
  if (!av.length) return [];
  const holds = (await c.query<{ dentist_id: string; s: Date; e: Date }>(
    `SELECT dentist_id, starts_at AS s, ends_at AS e FROM portal_slot_holds
      WHERE expires_at > now() AND dentist_id = ANY($1) AND ($2::bytea IS NULL OR token_hash <> $2)`,
    [av.map((a) => a.dentistId), q.ownHoldHash ?? null])).rows;
  const dur = q.durationMin * 60_000;
  // Menos ocupado primero: cuando el paciente elige "cualquiera", se reparte la carga.
  const sorted = [...av].sort((a, b) => {
    const fa = a.free.reduce((s, [x, y]) => s + (y - x), 0), fb = b.free.reduce((s, [x, y]) => s + (y - x), 0);
    return fb - fa || a.dentistName.localeCompare(b.dentistName);
  });
  const byTime = new Map<string, PublicSlot>();
  for (const d of sorted) {
    const myHolds = holds.filter((h) => h.dentist_id === d.dentistId);
    for (const s of d.slots) {
      const t = Date.parse(s);
      if (t < w.minStart || t + dur > w.maxEnd) continue;
      if (myHolds.some((h) => +h.s < t + dur && +h.e > t)) continue;
      if (!byTime.has(s)) byTime.set(s, { startsAt: s, endsAt: new Date(t + dur).toISOString(), dentistId: d.dentistId, dentistName: d.dentistName });
    }
  }
  return [...byTime.values()].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
}

/** Comprueba que un horario concreto sigue libre para ese profesional (mismas reglas que la lista). */
export async function assertSlotAvailable(
  c: Client, ctx: PortalCtx,
  q: { branchId: string; durationMin: number; dentistId: string; startsAt: string; excludeAppointmentId?: string | null; ownHoldHash?: Buffer | null },
) {
  const t = Date.parse(q.startsAt);
  if (!Number.isFinite(t)) throw new AppError(400, "validation", "Fecha y hora inválidas");
  const w = bookingWindow(ctx);
  if (t < Date.now()) throw new AppError(409, "slot_past", "Ese horario ya pasó. Elige otro.");
  if (t < w.minStart) throw new AppError(409, "slot_too_soon", `Las reservas en línea se hacen con al menos ${ctx.settings.leadTimeHours} h de anticipación. Elige otro horario o escribe a la sucursal.`);
  const date = DateTime.fromMillis(t, { zone: ctx.zone }).toISODate()!;
  if (date > w.lastDay) throw new AppError(409, "slot_too_far", `Solo se puede reservar hasta ${ctx.settings.maxDaysAhead} días adelante.`);
  const slots = await publicSlots(c, ctx, { ...q, date });
  const iso = new Date(t).toISOString();
  if (!slots.some((s) => s.startsAt === iso && s.dentistId === q.dentistId)) {
    throw new AppError(409, "slot_taken", "Ese horario ya no está disponible. Elige otro, por favor.");
  }
}

// ---------------- Sesión del paciente ----------------
export interface PatientSession { id: string; patientId: string; phone: string; expiresAt: Date }

export async function findSession(c: Client, req: FastifyRequest): Promise<PatientSession | null> {
  const token = req.cookies?.[PATIENT_COOKIE];
  if (!token || token.length > 100) return null;
  const s = (await c.query<{ id: string; patient_id: string; phone: string; expires_at: Date; last_seen_at: Date }>(
    `SELECT id, patient_id, phone, expires_at, last_seen_at FROM portal_sessions
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()`, [sha256(token)])).rows[0];
  if (!s) return null;
  if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) await c.query("UPDATE portal_sessions SET last_seen_at = now() WHERE id = $1", [s.id]);
  return { id: s.id, patientId: s.patient_id, phone: s.phone, expiresAt: s.expires_at };
}

export async function requireSession(c: Client, req: FastifyRequest): Promise<PatientSession> {
  const s = await findSession(c, req);
  if (!s) throw new AppError(401, "portal_unauthenticated", "Tu sesión terminó. Ingresa de nuevo con tu código.");
  return s;
}

export interface FamilyMember { id: string; firstName: string; lastName: string; birthDate: string | null; isMinor: boolean; isSelf: boolean; guardianName: string | null; preferredBranchId: string | null; consentReminders: boolean; consentMarketing: boolean }

/**
 * Pacientes que la sesión puede ver: el titular y los menores de edad cuyo teléfono de
 * responsable es el celular verificado con el código.
 */
export async function family(c: Client, s: PatientSession): Promise<FamilyMember[]> {
  const r = await c.query(
    `SELECT id, first_name AS "firstName", last_name AS "lastName", birth_date AS "birthDate", guardian_name AS "guardianName",
            preferred_branch_id AS "preferredBranchId", consent_reminders AS "consentReminders", consent_marketing AS "consentMarketing"
       FROM patients
      WHERE archived_at IS NULL
        AND (id = $1 OR (guardian_phone = $2 AND birth_date IS NOT NULL AND birth_date > (now() - interval '18 years')::date))
      ORDER BY (id = $1) DESC, birth_date`, [s.patientId, s.phone]);
  return r.rows.map((p) => ({ ...p, isMinor: isMinorDate(p.birthDate), isSelf: p.id === s.patientId }));
}

export async function requireFamilyMember(c: Client, s: PatientSession, patientId: string): Promise<FamilyMember> {
  const m = (await family(c, s)).find((p) => p.id === patientId);
  if (!m) throw notFound("Paciente");
  return m;
}

// ---------------- Consentimientos marcados en la web ----------------
/**
 * Registra los consentimientos como documentos inmutables (signed_documents, método 'online_checkbox'):
 * tratamiento de datos (obligatorio, una vez), recordatorios y marketing (solo si cambia la decisión).
 */
export async function recordOnlineConsents(
  c: Client, ctx: PortalCtx, p: FamilyMember, branchId: string, choice: { reminders: boolean; marketing: boolean },
) {
  const signerName = p.isMinor ? p.guardianName ?? `Responsable de ${p.firstName}` : `${p.firstName} ${p.lastName}`;
  const relationship = p.isMinor ? "guardian" : "self";
  const existing = (await c.query<{ kind: string; decision: string }>(
    "SELECT DISTINCT ON (kind) kind, decision FROM signed_documents WHERE patient_id = $1 AND kind IN ('data_processing','reminders','marketing') ORDER BY kind, signed_at DESC",
    [p.id])).rows;
  const last = (k: string) => existing.find((e) => e.kind === k)?.decision ?? null;
  const toRecord: { kind: "data_processing" | "reminders" | "marketing"; decision: "granted" | "refused" | "revoked" }[] = [];
  if (last("data_processing") !== "granted") toRecord.push({ kind: "data_processing", decision: "granted" });
  for (const kind of ["reminders", "marketing"] as const) {
    const want = choice[kind];
    const current = kind === "reminders" ? p.consentReminders : p.consentMarketing;
    const prev = last(kind);
    if (want && (prev !== "granted" || !current)) toRecord.push({ kind, decision: "granted" });
    else if (!want && (current || prev === "granted")) toRecord.push({ kind, decision: "revoked" });
    else if (!want && prev === null) toRecord.push({ kind, decision: "refused" });
  }
  for (const d of toRecord) {
    const t = (await c.query<{ id: string; title: string; body: string; version: number }>(
      "SELECT id, title, body, version FROM consent_templates WHERE kind = $1 AND active ORDER BY version DESC LIMIT 1", [d.kind])).rows[0];
    const title = t?.title ?? KIND_LABELS[d.kind];
    const signedAt = new Date().toISOString();
    const body = render(t?.body ?? KIND_LABELS[d.kind], { paciente: `${p.firstName} ${p.lastName}`, clinica: ctx.clinicName, fecha: signedAt.slice(0, 10), procedimiento: "—" });
    const hash = contentHash({ kind: d.kind, title, body, decision: d.decision, signerName, signerDocument: null, signerRelationship: relationship, signedAt, signaturePng: null });
    await c.query(
      `INSERT INTO signed_documents (clinic_id, patient_id, branch_id, template_id, kind, title, body, template_version, decision, method, signer_name,
          signer_relationship, content_hash, recorded_by, signed_at, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'online_checkbox',$10,$11,$12,NULL,$13,$14)`,
      [ctx.clinicId, p.id, branchId, t?.id ?? null, d.kind, title, body, t?.version ?? null, d.decision, signerName, relationship, hash, signedAt,
        "Marcado por el paciente en la reserva web (casilla), tras verificar su celular con un código"],
    );
    if (d.kind !== "data_processing") {
      const col = d.kind === "reminders" ? "consent_reminders" : "consent_marketing";
      await c.query(`UPDATE patients SET ${col} = $2, consent_updated_at = now(), updated_at = now() WHERE id = $1`, [p.id, d.decision === "granted"]);
    }
  }
  return toRecord;
}

// ---------------- Calendario (.ics) ----------------
const icsEscape = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const icsDate = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Archivo .ics sin datos clínicos: lugar, hora, código y contacto de la sucursal. */
export function buildIcs(a: { uid: string; startsAt: Date; endsAt: Date; summary: string; location: string; description: string }): string {
  const lines = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//Dentalia//Reserva online//ES", "CALSCALE:GREGORIAN", "METHOD:PUBLISH",
    "BEGIN:VEVENT", `UID:${a.uid}@dentalia`, `DTSTAMP:${icsDate(new Date())}`, `DTSTART:${icsDate(a.startsAt)}`, `DTEND:${icsDate(a.endsAt)}`,
    `SUMMARY:${icsEscape(a.summary)}`, `LOCATION:${icsEscape(a.location)}`, `DESCRIPTION:${icsEscape(a.description)}`,
    "BEGIN:VALARM", "TRIGGER:-PT2H", "ACTION:DISPLAY", `DESCRIPTION:${icsEscape(a.summary)}`, "END:VALARM",
    "END:VEVENT", "END:VCALENDAR",
  ];
  return lines.join("\r\n") + "\r\n";
}

export function whatsappLink(phone: string | null, text: string): string | null {
  if (!phone) return null;
  const d = phone.replace(/\D/g, "");
  if (d.length < 7) return null;
  return `https://wa.me/${d}?text=${encodeURIComponent(text)}`;
}

export function fmtWhen(d: Date, zone: string) {
  const dt = DateTime.fromJSDate(d, { zone }).setLocale("es");
  const day = dt.toFormat("cccc d 'de' LLLL");
  return { date: day.charAt(0).toUpperCase() + day.slice(1), time: dt.toFormat("HH:mm") };
}
