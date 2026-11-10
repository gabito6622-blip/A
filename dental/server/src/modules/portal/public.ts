// API pública de la reserva online y del portal del paciente: /api/public/c/:slug/…
// Sin sesión del personal. La clínica se resuelve por slug (solo si la reserva está activa) y
// cada solicitud corre con RLS fijado a esa clínica. Toda acción queda en la auditoría.
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Client } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import { zDate, zId } from "../../lib/http.js";
import { AppError, notFound } from "../../lib/errors.js";
import { normalize, normalizePhone, money } from "../../lib/text.js";
import type { AuthCtx } from "../../lib/rbac.js";
import type { Messenger } from "../../lib/messaging.js";
import { insertPatient, type PatientInput } from "../patients.js";
import {
  COOKIE_PATH, DOC_SQL, HOLD_MINUTES, OTP_MAX_ATTEMPTS, OTP_MINUTES, PATIENT_COOKIE, SESSION_HOURS,
  assertSlotAvailable, bookingCode, bookingWindow, buildIcs, family, findSession, fmtWhen, isMinorDate, mapLink, maskPhone,
  newToken, normDoc, otpCode, otpHash, paudit, publicBranches, publicDentists, publicServices, publicSlots, rateLimit,
  recordOnlineConsents, requireBranchPublic, requireFamilyMember, requireServicePublic, requireSession, sha256, softError,
  whatsappLink, withPortal, type PatientSession, type PortalCtx,
} from "./core.js";

const zSlug = z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Dirección de clínica inválida");
const P = z.object({ slug: zSlug });
const PId = P.extend({ id: zId });
const zDateTime = z.iso.datetime({ offset: true, message: "Fecha y hora inválidas" });

const GENERIC_OTP_MSG = "Si los datos coinciden con una ficha de la clínica, enviamos un código de 6 dígitos por WhatsApp al celular registrado. Vence en 10 minutos.";
export const PAYMENT_NOTE = "Pagos en la clínica o por transferencia; la clínica confirma el pago.";

export const PATIENT_STATUS: Record<string, string> = {
  scheduled: "Agendada", confirmed: "Confirmada", arrived: "En la clínica", in_progress: "En atención",
  completed: "Atendida", cancelled: "Cancelada", no_show: "No asistió",
};
export const BOOKING_STATUS: Record<string, string> = {
  confirmed: "Confirmada", pending: "Solicitud enviada: la sucursal debe confirmarla", approved: "Confirmada por la sucursal",
  rejected: "La sucursal no pudo confirmarla", cancelled: "Cancelada",
};
const METHOD_LABELS: Record<string, string> = { cash: "Efectivo", transfer: "Transferencia", qr: "QR", card: "Tarjeta" };
const PAYMENT_STATUS: Record<string, string> = { pending_verification: "En verificación", confirmed: "Confirmado", rejected: "Rechazado", voided: "Anulado" };

type Handler<B, Q, Pm> = (x: { c: Client; ctx: PortalCtx; body: B; query: Q; params: Pm; req: FastifyRequest; reply: FastifyReply }) => Promise<unknown>;

export function portalPublicRoutes(route: Route, cfg: Config, messenger: Messenger) {
  /** Ruta pública con contexto de clínica. Las escrituras exigen la cabecera X-Portal (evita envíos desde otros sitios). */
  function pub<BS extends z.ZodType = z.ZodUnknown, QS extends z.ZodType = z.ZodUnknown, PS extends z.ZodType = typeof P>(def: {
    method: "GET" | "POST"; url: string; summary: string; body?: BS; query?: QS; params?: PS; raw?: boolean;
    limit?: { max: number; timeWindow: string };
    handler: Handler<z.infer<BS>, z.infer<QS>, z.infer<PS>>;
  }) {
    route<BS, QS, PS>({
      method: def.method, url: `/api/public/c/:slug${def.url}`, summary: def.summary, tags: ["reserva online"], access: "public", noTx: true,
      body: def.body, query: def.query, params: (def.params ?? P) as PS, raw: def.raw,
      limit: cfg.disableRateLimit ? undefined : def.limit ?? (def.method === "POST" ? { max: 30, timeWindow: "1 minute" } : { max: 120, timeWindow: "1 minute" }),
      handler: async ({ db, body, query, params, req, reply }) => {
        if (def.method !== "GET" && req.headers["x-portal"] !== "1") throw new AppError(403, "csrf", "Solicitud no válida. Recarga la página.");
        return withPortal(db, (params as { slug: string }).slug, req, (c, ctx) => def.handler({ c, ctx, body, query, params, req, reply }));
      },
    });
  }

  const send = (c: Client, ctx: PortalCtx, m: { to: string; template: string; body: string; patientId?: string | null; branchId?: string | null; otp?: boolean; relatedEntity?: string; relatedId?: string }) =>
    messenger.enqueue(c, {
      clinicId: ctx.clinicId, channel: "whatsapp", recipient: m.to, template: m.template, purpose: m.otp ? "otp" : "transactional",
      body: m.body, sensitive: m.otp, patientId: m.patientId ?? null, branchId: m.branchId ?? null, relatedEntity: m.relatedEntity ?? null, relatedId: m.relatedId ?? null,
    });

  const portalUrl = (ctx: PortalCtx) => `${cfg.publicUrl}/mi-cuenta/${ctx.slug}`;
  const policyText = (ctx: PortalCtx) => ctx.settings.changeWindowHours > 0
    ? `Puedes reprogramar o cancelar en línea hasta ${ctx.settings.changeWindowHours} h antes de la cita. Después, escribe a la sucursal por WhatsApp.`
    : "Puedes reprogramar o cancelar en línea hasta el inicio de la cita.";
  const canChange = (ctx: PortalCtx, startsAt: Date, status: string) =>
    ["scheduled", "confirmed"].includes(status) && startsAt.getTime() - Date.now() >= ctx.settings.changeWindowHours * 3_600_000;

  async function meView(c: Client, ctx: PortalCtx, s: PatientSession) {
    const fam = await family(c, s);
    const self = fam.find((p) => p.isSelf);
    return {
      patient: self ? { id: self.id, firstName: self.firstName, lastName: self.lastName } : null,
      family: fam.map((p) => ({ id: p.id, firstName: p.firstName, lastName: p.lastName, isMinor: p.isMinor, isSelf: p.isSelf, consentReminders: p.consentReminders, consentMarketing: p.consentMarketing })),
      phoneMasked: maskPhone(s.phone), expiresAt: s.expiresAt, clinicName: ctx.clinicName,
    };
  }

  // ---------------- Información pública ----------------
  pub({
    method: "GET", url: "/info", summary: "Datos públicos de la clínica para reservar: sucursales (dirección y mapa), prestaciones (duración y precio desde) y reglas",
    handler: async ({ c, ctx, req }) => {
      const s = await findSession(c, req);
      const w = bookingWindow(ctx);
      return {
        clinic: { name: ctx.clinicName, slug: ctx.slug },
        rules: { leadTimeHours: ctx.settings.leadTimeHours, maxDaysAhead: ctx.settings.maxDaysAhead, changeWindowHours: ctx.settings.changeWindowHours, firstDay: w.today, lastDay: w.lastDay, holdMinutes: HOLD_MINUTES },
        instructions: ctx.settings.instructions, cancellationPolicy: policyText(ctx), paymentNote: PAYMENT_NOTE,
        branches: (await publicBranches(c, ctx)).map((b) => ({ ...b, whatsappUrl: whatsappLink(b.whatsapp, `Hola, escribo desde la página de reservas de ${ctx.clinicName}.`) })),
        services: await publicServices(c, ctx),
        session: s ? await meView(c, ctx, s) : null,
      };
    },
  });

  pub({
    method: "GET", url: "/dentists", summary: "Profesionales que atienden en una sucursal", query: z.object({ branchId: zId }),
    handler: async ({ c, ctx, query }) => {
      await requireBranchPublic(c, ctx, query.branchId);
      return publicDentists(c, query.branchId);
    },
  });

  const slotQuery = z.object({ branchId: zId, procedureId: zId.optional(), dentistId: zId.optional(), rescheduleId: zId.optional() });

  /** Duración y exclusión para una consulta de horarios (reserva nueva o reprogramación de una cita propia). */
  async function slotParams(c: Client, ctx: PortalCtx, req: FastifyRequest, q: z.infer<typeof slotQuery>) {
    await requireBranchPublic(c, ctx, q.branchId);
    if (q.rescheduleId) {
      const s = await requireSession(c, req);
      const a = await ownAppointment(c, s, q.rescheduleId);
      return { durationMin: Math.round((a.ends_at.getTime() - a.starts_at.getTime()) / 60_000), excludeAppointmentId: a.id };
    }
    if (!q.procedureId) throw new AppError(400, "validation", "Elige una prestación");
    const svc = await requireServicePublic(c, ctx, q.procedureId);
    return { durationMin: svc.durationMin, excludeAppointmentId: null };
  }

  pub({
    method: "GET", url: "/days", summary: "Días con horarios libres (14 días desde 'from'), con el mismo motor de la agenda",
    query: slotQuery.extend({ from: zDate.optional() }),
    handler: async ({ c, ctx, query, req }) => {
      const sp = await slotParams(c, ctx, req, query);
      const w = bookingWindow(ctx);
      const start = query.from && query.from > w.today ? query.from : w.today;
      const days: { date: string; count: number }[] = [];
      let d = new Date(start + "T12:00:00Z");
      for (let i = 0; i < 14; i++) {
        const date = d.toISOString().slice(0, 10);
        if (date > w.lastDay) break;
        const slots = await publicSlots(c, ctx, { branchId: query.branchId, durationMin: sp.durationMin, dentistId: query.dentistId ?? null, date, excludeAppointmentId: sp.excludeAppointmentId });
        days.push({ date, count: slots.length });
        d = new Date(d.getTime() + 86_400_000);
      }
      const last = days[days.length - 1]?.date;
      return { days, hasMore: !!last && last < w.lastDay, firstDay: w.today, lastDay: w.lastDay };
    },
  });

  pub({
    method: "GET", url: "/slots", summary: "Horarios libres de un día (nunca horas pasadas; respeta anticipación mínima, días máximos y retenciones)",
    query: slotQuery.extend({ date: zDate, holdToken: z.string().max(100).optional() }),
    handler: async ({ c, ctx, query, req }) => {
      const sp = await slotParams(c, ctx, req, query);
      return publicSlots(c, ctx, {
        branchId: query.branchId, durationMin: sp.durationMin, dentistId: query.dentistId ?? null, date: query.date,
        excludeAppointmentId: sp.excludeAppointmentId, ownHoldHash: query.holdToken ? sha256(query.holdToken) : null,
      });
    },
  });

  // ---------------- Retención del horario ----------------
  pub({
    method: "POST", url: "/holds", summary: `Retener un horario por ${HOLD_MINUTES} minutos mientras el paciente confirma`,
    body: z.object({ branchId: zId, procedureId: zId, dentistId: zId, startsAt: zDateTime, releaseToken: z.string().max(100).optional(), rescheduleId: zId.optional() }),
    handler: async ({ c, ctx, body, req }) => {
      await rateLimit(c, ctx, "hold_ip", ctx.ip, 30, 60);
      const sp = await slotParams(c, ctx, req, body);
      await c.query("DELETE FROM portal_slot_holds WHERE expires_at < now()");
      if (body.releaseToken) await c.query("DELETE FROM portal_slot_holds WHERE token_hash = $1", [sha256(body.releaseToken)]);
      const active = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM portal_slot_holds WHERE ip = $1", [ctx.ip])).rows[0]!.n;
      if (active >= 3) throw new AppError(429, "rate_limited", "Ya tienes horarios apartados en otras pestañas. Termina esa reserva o espera unos minutos.");
      await assertSlotAvailable(c, ctx, { branchId: body.branchId, durationMin: sp.durationMin, dentistId: body.dentistId, startsAt: body.startsAt, excludeAppointmentId: sp.excludeAppointmentId });
      const token = newToken();
      const startsAt = new Date(body.startsAt);
      const endsAt = new Date(startsAt.getTime() + sp.durationMin * 60_000);
      await c.query("SAVEPOINT hold");
      try {
        const r = await c.query<{ id: string; expires_at: Date }>(
          `INSERT INTO portal_slot_holds (clinic_id, branch_id, dentist_id, procedure_id, starts_at, ends_at, token_hash, ip, expires_at)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now() + make_interval(mins => $9)) RETURNING id, expires_at`,
          [ctx.clinicId, body.branchId, body.dentistId, body.procedureId, startsAt, endsAt, sha256(token), ctx.ip, HOLD_MINUTES]);
        await paudit(c, ctx, "portal.slot_held", "portal_hold", r.rows[0]!.id, { dentistId: body.dentistId, startsAt }, body.branchId);
        return { holdToken: token, expiresAt: r.rows[0]!.expires_at, startsAt: startsAt.toISOString(), endsAt: endsAt.toISOString() };
      } catch (e) {
        if ((e as { code?: string }).code === "23P01") {
          await c.query("ROLLBACK TO SAVEPOINT hold");
          throw new AppError(409, "slot_taken", "Otra persona está reservando ese horario en este momento. Elige otro, por favor.");
        }
        throw e;
      }
    },
  });

  pub({
    method: "POST", url: "/holds/release", summary: "Liberar un horario retenido", body: z.object({ holdToken: z.string().max(100) }),
    handler: async ({ c, body }) => {
      await c.query("DELETE FROM portal_slot_holds WHERE token_hash = $1", [sha256(body.holdToken)]);
      return { ok: true };
    },
  });

  pub({
    method: "GET", url: "/review", summary: "Resumen para la pantalla de revisión (servicio, profesional, sucursal, fecha, hora, duración, precio desde, indicaciones y política)",
    query: z.object({ branchId: zId, procedureId: zId, dentistId: zId, startsAt: zDateTime, holdToken: z.string().max(100).optional() }),
    handler: async ({ c, ctx, query }) => {
      const b = await requireBranchPublic(c, ctx, query.branchId);
      const svc = await requireServicePublic(c, ctx, query.procedureId);
      const dentist = (await publicDentists(c, query.branchId)).find((d) => d.id === query.dentistId);
      if (!dentist) throw new AppError(404, "not_found", "Ese profesional no atiende en la sucursal");
      let available = true, reason: string | null = null;
      try {
        await assertSlotAvailable(c, ctx, { branchId: b.id, durationMin: svc.durationMin, dentistId: dentist.id, startsAt: query.startsAt, ownHoldHash: query.holdToken ? sha256(query.holdToken) : null });
      } catch (e) {
        available = false; reason = (e as Error).message;
      }
      const startsAt = new Date(query.startsAt);
      const w = fmtWhen(startsAt, ctx.zone);
      return {
        clinicName: ctx.clinicName, mode: b.mode,
        branch: { ...b, whatsappUrl: whatsappLink(b.whatsapp, `Hola, tengo una consulta sobre mi reserva en ${b.name}.`) },
        service: svc, dentist, startsAt: startsAt.toISOString(), endsAt: new Date(startsAt.getTime() + svc.durationMin * 60_000).toISOString(),
        date: w.date, time: w.time, durationMin: svc.durationMin, priceFromCents: svc.priceFromCents,
        instructions: ctx.settings.instructions, cancellationPolicy: policyText(ctx), paymentNote: PAYMENT_NOTE, available, unavailableReason: reason,
      };
    },
  });

  // ---------------- Identificación sin contraseña ----------------
  pub({
    method: "POST", url: "/auth/existing", summary: "Paciente existente: CI y fecha de nacimiento → código de un solo uso al celular registrado (misma respuesta exista o no)",
    body: z.object({
      documentNumber: z.string().trim().min(4, "Escribe tu número de carnet (CI)").max(20, "El CI es demasiado largo"),
      birthDate: zDate,
    }),
    limit: { max: 20, timeWindow: "1 minute" },
    handler: async ({ c, ctx, body }) => {
      const doc = normDoc(body.documentNumber);
      await rateLimit(c, ctx, "otp_ip", ctx.ip, 10, 60);
      await rateLimit(c, ctx, "otp_doc", doc, 5, 60);
      const rows = (await c.query<{ id: string; phone: string | null }>(
        `SELECT id, COALESCE(phone, guardian_phone) AS phone FROM patients WHERE archived_at IS NULL AND ${DOC_SQL} = $1 AND birth_date = $2 LIMIT 2`,
        [doc, body.birthDate])).rows;
      const match = rows.length === 1 && rows[0]!.phone ? rows[0]! : null;
      // El límite por celular no se informa (revelaría que el paciente existe): simplemente no se envía.
      const deliver = match ? await rateLimit(c, ctx, "otp_phone", match.phone!, 5, 60, { silent: true }) : false;
      const id = randomUUID();
      const code = otpCode();
      await c.query(
        `INSERT INTO portal_otps (id, clinic_id, purpose, patient_id, phone, code_hash, expires_at, ip)
         VALUES ($1,$2,'existing',$3,$4,$5, now() + make_interval(mins => $6), $7)`,
        [id, ctx.clinicId, deliver ? match!.id : null, deliver ? match!.phone : null, deliver ? otpHash(cfg.secretKey, id, code) : randomBytes(32), OTP_MINUTES, ctx.ip]);
      if (deliver) {
        await send(c, ctx, { to: match!.phone!, template: "portal.otp", otp: true, patientId: match!.id, relatedEntity: "portal_otp", relatedId: id,
          body: `${code} es tu código para ${ctx.clinicName}. Vence en ${OTP_MINUTES} minutos. No lo compartas con nadie.` });
      }
      await paudit(c, ctx, "portal.otp_requested", "portal_otp", id, { purpose: "existing", delivered: deliver });
      return { challengeId: id, expiresInSec: OTP_MINUTES * 60, message: GENERIC_OTP_MSG };
    },
  });

  const zPhone = z.string().trim().max(20).transform((v, ctx2) => {
    const p = normalizePhone(v);
    if (!p || !/^\+591[67]\d{7}$|^\+(?!591)\d{8,15}$/.test(p)) {
      ctx2.addIssue({ code: "custom", message: "Escribe un celular válido (8 dígitos, por ejemplo 71234567)" });
      return z.NEVER;
    }
    return p;
  });

  pub({
    method: "POST", url: "/auth/signup", summary: "Paciente nuevo: datos mínimos → código de un solo uso al celular indicado (los duplicados se resuelven sin revelar coincidencias)",
    body: z.object({
      firstName: z.string().trim().min(1, "Escribe el nombre").max(80),
      lastName: z.string().trim().min(1, "Escribe el apellido").max(80),
      documentNumber: z.string().trim().max(20).nullish().transform((v) => (v ? v : null)),
      birthDate: zDate,
      phone: zPhone,
      guardianName: z.string().trim().max(120).nullish().transform((v) => (v ? v : null)),
      guardianRelationship: z.string().trim().max(40).nullish().transform((v) => (v ? v : null)),
      branchId: zId.nullish(),
    }).superRefine((b, x) => {
      // Se ejecuta aunque otros campos tengan errores: el paciente ve todos los problemas a la vez.
      if (typeof b.birthDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.birthDate)) return;
      const today = new Date().toISOString().slice(0, 10);
      if (b.birthDate > today) x.addIssue({ code: "custom", path: ["birthDate"], message: "La fecha de nacimiento no puede ser futura" });
      if (b.birthDate < "1900-01-01") x.addIssue({ code: "custom", path: ["birthDate"], message: "Revisa el año de nacimiento" });
      const minor = isMinorDate(b.birthDate);
      const doc = typeof b.documentNumber === "string" ? b.documentNumber : null;
      if (minor && !b.guardianName) x.addIssue({ code: "custom", path: ["guardianName"], message: "Para menores de edad escribe el nombre de la madre, padre o responsable" });
      if (!minor && (!doc || normDoc(doc).length < 4)) x.addIssue({ code: "custom", path: ["documentNumber"], message: "Escribe tu número de carnet (CI)" });
    }, { when: () => true }),
    limit: { max: 20, timeWindow: "1 minute" },
    handler: async ({ c, ctx, body }) => {
      await rateLimit(c, ctx, "otp_ip", ctx.ip, 10, 60);
      await rateLimit(c, ctx, "otp_phone", body.phone, 5, 60);
      const id = randomUUID();
      const code = otpCode();
      const minor = isMinorDate(body.birthDate);
      const signup = { ...body, documentNumber: body.documentNumber ? body.documentNumber.toUpperCase() : null, minor };
      await c.query(
        `INSERT INTO portal_otps (id, clinic_id, purpose, phone, signup, code_hash, expires_at, ip)
         VALUES ($1,$2,'signup',$3,$4,$5, now() + make_interval(mins => $6), $7)`,
        [id, ctx.clinicId, body.phone, JSON.stringify(signup), otpHash(cfg.secretKey, id, code), OTP_MINUTES, ctx.ip]);
      await send(c, ctx, { to: body.phone, template: "portal.otp", otp: true, relatedEntity: "portal_otp", relatedId: id, branchId: body.branchId ?? null,
        body: `${code} es tu código para ${ctx.clinicName}. Vence en ${OTP_MINUTES} minutos. No lo compartas con nadie.` });
      await paudit(c, ctx, "portal.otp_requested", "portal_otp", id, { purpose: "signup" });
      return { challengeId: id, expiresInSec: OTP_MINUTES * 60, message: "Enviamos un código de 6 dígitos por WhatsApp al celular que escribiste. Vence en 10 minutos." };
    },
  });

  /** Crea o reconoce al paciente nuevo después de verificar el celular, sin revelar coincidencias. */
  async function resolveSignup(c: Client, ctx: PortalCtx, s: { firstName: string; lastName: string; documentNumber: string | null; birthDate: string; guardianName: string | null; guardianRelationship: string | null; branchId?: string | null; minor: boolean }, phone: string) {
    const doc = s.documentNumber ? normDoc(s.documentNumber) : null;
    let note: string | null = null;
    if (doc) {
      const ex = (await c.query<{ id: string; phone: string | null; guardian_phone: string | null }>(
        `SELECT id, phone, guardian_phone FROM patients WHERE archived_at IS NULL AND ${DOC_SQL} = $1 LIMIT 1`, [doc])).rows[0];
      if (ex) {
        if (ex.phone === phone || ex.guardian_phone === phone) {
          await paudit(c, ctx, "portal.signup_matched", "patient", ex.id, { by: "document_and_phone" });
          return ex.id;
        }
        note = `Registrado desde la reserva web. CI declarado ${s.documentNumber}: coincide con otra ficha y el celular no; revisar en recepción antes de unir.`;
      }
    }
    if (!note) {
      const cands = (await c.query<{ id: string; first_name: string; last_name: string }>(
        "SELECT id, first_name, last_name FROM patients WHERE archived_at IS NULL AND (phone = $1 OR guardian_phone = $1) AND birth_date = $2",
        [phone, s.birthDate])).rows;
      const want = normalize(`${s.firstName} ${s.lastName}`);
      const same = cands.find((p) => normalize(`${p.first_name} ${p.last_name}`) === want);
      if (same) {
        await paudit(c, ctx, "portal.signup_matched", "patient", same.id, { by: "phone_name_birth" });
        return same.id;
      }
    }
    const input: PatientInput = {
      firstName: s.firstName, lastName: s.lastName, documentType: doc && !note ? "CI" : "SIN", documentNumber: doc && !note ? s.documentNumber : null,
      documentIssued: null, birthDate: s.birthDate, sex: null, phone: s.minor ? null : phone, email: null, address: null, city: null, occupation: null,
      guardianName: s.minor ? s.guardianName : null, guardianPhone: s.minor ? phone : null, guardianRelationship: s.minor ? s.guardianRelationship : null,
      referralSource: "Reserva web", notes: note, preferredBranchId: s.branchId ?? null, consentReminders: false, consentMarketing: false,
    };
    // insertPatient solo usa clinicId y userId del actor; sin usuario del personal (created_by NULL).
    const created = await insertPatient(c, { clinicId: ctx.clinicId, userId: null } as unknown as AuthCtx, input);
    await paudit(c, ctx, note ? "portal.possible_duplicate" : "portal.patient_created", "patient", created.id, { recordNumber: created.recordNumber });
    return created.id;
  }

  pub({
    method: "POST", url: "/auth/verify", summary: "Verificar el código (6 dígitos, 10 minutos, 5 intentos) y abrir la sesión del paciente (cookie psid)",
    body: z.object({ challengeId: zId, code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 dígitos") }),
    limit: { max: 30, timeWindow: "1 minute" },
    handler: async ({ c, ctx, body, reply, req }) => {
      await rateLimit(c, ctx, "verify_ip", ctx.ip, 30, 60);
      const o = (await c.query<{ id: string; purpose: string; patient_id: string | null; phone: string | null; signup: any; code_hash: Buffer; attempts: number; expired: boolean; consumed_at: Date | null }>(
        "SELECT id, purpose, patient_id, phone, signup, code_hash, attempts, expires_at < now() AS expired, consumed_at FROM portal_otps WHERE id = $1 FOR UPDATE",
        [body.challengeId])).rows[0];
      if (!o || o.expired || o.consumed_at) return softError(reply, 400, "otp_invalid", "El código ya venció o ya se usó. Pide uno nuevo.");
      if (o.attempts >= OTP_MAX_ATTEMPTS) return softError(reply, 400, "otp_locked", "Demasiados intentos con este código. Pide uno nuevo.");
      const expected = otpHash(cfg.secretKey, o.id, body.code);
      const ok = !!o.phone && o.code_hash.length === expected.length && timingSafeEqual(o.code_hash, expected);
      if (!ok) {
        const left = OTP_MAX_ATTEMPTS - o.attempts - 1;
        await c.query("UPDATE portal_otps SET attempts = attempts + 1 WHERE id = $1", [o.id]);
        await paudit(c, ctx, "portal.otp_failed", "portal_otp", o.id, { attemptsLeft: left });
        return softError(reply, 400, "otp_wrong", left > 0 ? `Código incorrecto. Te quedan ${left} intento${left === 1 ? "" : "s"}.` : "Código incorrecto. Pide un código nuevo.", { attemptsLeft: left });
      }
      await c.query("UPDATE portal_otps SET consumed_at = now() WHERE id = $1", [o.id]);
      const patientId = o.purpose === "existing" ? o.patient_id! : await resolveSignup(c, ctx, o.signup, o.phone!);
      const token = newToken();
      const sess = (await c.query<{ id: string; expires_at: Date }>(
        `INSERT INTO portal_sessions (clinic_id, patient_id, phone, token_hash, expires_at, ip, user_agent)
         VALUES ($1,$2,$3,$4, now() + make_interval(hours => $5), $6, $7) RETURNING id, expires_at`,
        [ctx.clinicId, patientId, o.phone, sha256(token), SESSION_HOURS, ctx.ip, String(req.headers["user-agent"] ?? "").slice(0, 200)])).rows[0]!;
      reply.setCookie(PATIENT_COOKIE, token, { path: COOKIE_PATH, httpOnly: true, sameSite: "strict", secure: cfg.isProduction, maxAge: SESSION_HOURS * 3600 });
      await paudit(c, ctx, "portal.login", "patient", patientId, { sessionId: sess.id, purpose: o.purpose });
      return meView(c, ctx, { id: sess.id, patientId, phone: o.phone!, expiresAt: sess.expires_at });
    },
  });

  pub({
    method: "POST", url: "/auth/logout", summary: "Cerrar la sesión del paciente",
    handler: async ({ c, ctx, req, reply }) => {
      const s = await findSession(c, req);
      if (s) {
        await c.query("UPDATE portal_sessions SET revoked_at = now() WHERE id = $1", [s.id]);
        await paudit(c, ctx, "portal.logout", "patient", s.patientId, { sessionId: s.id });
      }
      reply.clearCookie(PATIENT_COOKIE, { path: COOKIE_PATH });
      return { ok: true };
    },
  });

  pub({
    method: "GET", url: "/me", summary: "Paciente de la sesión y su grupo familiar (menores con el mismo celular de responsable)",
    handler: async ({ c, ctx, req }) => meView(c, ctx, await requireSession(c, req)),
  });

  // ---------------- Reservas ----------------
  async function bookingView(c: Client, ctx: PortalCtx, id: string) {
    const r = (await c.query(
      `SELECT pb.id, pb.code, pb.mode, pb.status, pb.patient_id, pb.decision_reason, pb.appointment_id,
              COALESCE(a.starts_at, pb.starts_at) AS starts_at, COALESCE(a.ends_at, pb.ends_at) AS ends_at, a.status AS appt_status,
              p.first_name, p.last_name, pr.name AS service, ps.price_from_cents, u.full_name AS dentist_name,
              b.id AS branch_id, b.name AS branch_name, b.address, b.city, b.phone AS branch_phone, s.whatsapp, s.map_url
         FROM portal_bookings pb JOIN patients p ON p.id = pb.patient_id JOIN procedures pr ON pr.id = pb.procedure_id
         LEFT JOIN portal_services ps ON ps.procedure_id = pb.procedure_id
         LEFT JOIN appointments a ON a.id = pb.appointment_id
         LEFT JOIN users u ON u.id = COALESCE(a.dentist_id, pb.dentist_id)
         JOIN branches b ON b.id = pb.branch_id LEFT JOIN portal_branch_settings s ON s.branch_id = b.id
        WHERE pb.id = $1`, [id])).rows[0];
    if (!r) throw notFound("Reserva");
    const w = fmtWhen(r.starts_at, ctx.zone);
    const status = r.appt_status === "cancelled" ? "cancelled" : r.status;
    return {
      id: r.id, code: r.code, mode: r.mode, status, statusLabel: BOOKING_STATUS[status], decisionReason: r.decision_reason,
      patientId: r.patient_id, patientName: `${r.first_name} ${r.last_name}`, service: r.service, dentistName: r.dentist_name,
      priceFromCents: ctx.settings.showPrices ? r.price_from_cents : null,
      startsAt: r.starts_at, endsAt: r.ends_at, date: w.date, time: w.time, durationMin: Math.round((+r.ends_at - +r.starts_at) / 60_000),
      appointmentId: r.appointment_id,
      icsUrl: r.appointment_id ? `/api/public/c/${ctx.slug}/me/appointments/${r.appointment_id}/ics` : null,
      canChange: !!r.appointment_id && canChange(ctx, r.starts_at, r.appt_status ?? ""),
      branch: {
        id: r.branch_id, name: r.branch_name, address: r.address, city: r.city, phone: r.branch_phone, whatsapp: r.whatsapp,
        mapUrl: mapLink({ map_url: r.map_url, address: r.address, city: r.city, name: r.branch_name }, ctx.clinicName),
        whatsappUrl: whatsappLink(r.whatsapp, `Hola, tengo la reserva ${r.code} en ${r.branch_name}.`),
      },
      instructions: ctx.settings.instructions, cancellationPolicy: policyText(ctx), paymentNote: PAYMENT_NOTE, portalUrl: `/mi-cuenta/${ctx.slug}`,
    };
  }

  pub({
    method: "POST", url: "/bookings", summary: "Reservar: confirmación inmediata (crea la cita, origen 'portal') o solicitud para aprobar, según la sucursal. Idempotente.",
    body: z.object({
      branchId: zId, procedureId: zId, dentistId: zId, startsAt: zDateTime, patientId: zId,
      holdToken: z.string().max(100).optional(),
      idempotencyKey: z.string().min(8).max(80),
      consents: z.object({
        dataProcessing: z.literal(true, { message: "Para reservar debes aceptar el tratamiento de tus datos" }),
        reminders: z.boolean().default(false),
        marketing: z.boolean().default(false),
      }),
    }),
    handler: async ({ c, ctx, body, req }) => {
      const s = await requireSession(c, req);
      await c.query("SELECT pg_advisory_xact_lock(hashtextextended($1 || ':portal:' || $2, 0))", [ctx.clinicId, body.idempotencyKey]);
      const fam = await family(c, s);
      const prev = (await c.query<{ id: string; patient_id: string }>("SELECT id, patient_id FROM portal_bookings WHERE idempotency_key = $1", [body.idempotencyKey])).rows[0];
      if (prev) {
        if (!fam.some((p) => p.id === prev.patient_id)) throw new AppError(409, "idempotency_mismatch", "Esa reserva ya se envió con otros datos");
        return { ...(await bookingView(c, ctx, prev.id)), duplicate: true };
      }
      await rateLimit(c, ctx, "book_ip", ctx.ip, 10, 60);
      await rateLimit(c, ctx, "book_session", s.id, 6, 60);
      const member = await requireFamilyMember(c, s, body.patientId);
      const branch = await requireBranchPublic(c, ctx, body.branchId);
      const svc = await requireServicePublic(c, ctx, body.procedureId);
      const active = (await c.query<{ n: number }>(
        "SELECT count(*)::int AS n FROM portal_bookings WHERE patient_id = $1 AND status IN ('pending','confirmed','approved') AND starts_at > now()",
        [member.id])).rows[0]!.n;
      if (active >= 2) throw new AppError(409, "too_many_bookings", "Ya tienes 2 reservas web por venir para este paciente. Para otra cita, escribe a la sucursal por WhatsApp.");
      const holdHash = body.holdToken ? sha256(body.holdToken) : null;
      await assertSlotAvailable(c, ctx, { branchId: branch.id, durationMin: svc.durationMin, dentistId: body.dentistId, startsAt: body.startsAt, ownHoldHash: holdHash });
      const startsAt = new Date(body.startsAt);
      const endsAt = new Date(startsAt.getTime() + svc.durationMin * 60_000);
      const code = bookingCode();
      let appointmentId: string | null = null;
      if (branch.mode === "instant") {
        try {
          appointmentId = (await c.query<{ id: string }>(
            `INSERT INTO appointments (clinic_id, branch_id, dentist_id, patient_id, procedure_id, starts_at, ends_at, reason, notes, source, idempotency_key, created_by)
             VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,'portal',$10,NULL) RETURNING id`,
            [ctx.clinicId, branch.id, body.dentistId, member.id, svc.id, startsAt, endsAt, svc.name, `Reservada por el paciente en la web (código ${code})`, `portal-${body.idempotencyKey}`])).rows[0]!.id;
        } catch (e) {
          const err = e as { code?: string; constraint?: string };
          if (err.code === "23P01" && err.constraint === "appt_no_overlap_patient") throw new AppError(409, "patient_busy", "Ese paciente ya tiene otra cita a esa hora.");
          if (err.code === "23P01") throw new AppError(409, "slot_taken", "Ese horario acaba de ocuparse. Elige otro, por favor.");
          throw e;
        }
      }
      const bk = (await c.query<{ id: string }>(
        `INSERT INTO portal_bookings (clinic_id, code, mode, status, branch_id, dentist_id, procedure_id, patient_id, session_id, starts_at, ends_at, appointment_id, idempotency_key, ip)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING id`,
        [ctx.clinicId, code, branch.mode, branch.mode === "instant" ? "confirmed" : "pending", branch.id, body.dentistId, svc.id, member.id, s.id, startsAt, endsAt, appointmentId, body.idempotencyKey, ctx.ip])).rows[0]!;
      if (holdHash) await c.query("DELETE FROM portal_slot_holds WHERE token_hash = $1", [holdHash]);
      const consents = await recordOnlineConsents(c, ctx, member, branch.id, { reminders: body.consents.reminders, marketing: body.consents.marketing });
      const w = fmtWhen(startsAt, ctx.zone);
      const where = `${branch.name}${branch.address ? `, ${branch.address}` : ""}`;
      await send(c, ctx, {
        to: s.phone, template: branch.mode === "instant" ? "portal.booking_confirmed" : "portal.booking_requested", patientId: member.id, branchId: branch.id,
        relatedEntity: "portal_booking", relatedId: bk.id,
        body: branch.mode === "instant"
          ? `${ctx.clinicName}: tu cita quedó confirmada para el ${w.date} a las ${w.time} en ${where}. Código ${code}. Para reprogramar o cancelar: ${portalUrl(ctx)}`
          : `${ctx.clinicName}: recibimos tu solicitud para el ${w.date} a las ${w.time} en ${where} (código ${code}). La sucursal te confirmará por este medio.`,
      });
      await paudit(c, ctx, "portal.booking_created", "portal_booking", bk.id,
        { code, mode: branch.mode, appointmentId, patientId: member.id, dentistId: body.dentistId, startsAt, consents: consents.map((x) => `${x.kind}:${x.decision}`) }, branch.id);
      return bookingView(c, ctx, bk.id);
    },
  });

  pub({
    method: "GET", url: "/me/bookings/:id", summary: "Detalle de una reserva web propia (pantalla de confirmación)", params: PId,
    handler: async ({ c, ctx, params, req }) => {
      const s = await requireSession(c, req);
      const v = await bookingView(c, ctx, params.id);
      if (!(await family(c, s)).some((p) => p.id === v.patientId)) throw notFound("Reserva");
      return v;
    },
  });

  pub({
    method: "POST", url: "/me/bookings/:id/cancel", summary: "Retirar una solicitud pendiente", params: PId,
    handler: async ({ c, ctx, params, req }) => {
      const s = await requireSession(c, req);
      const fam = (await family(c, s)).map((p) => p.id);
      const r = await c.query("UPDATE portal_bookings SET status = 'cancelled' WHERE id = $1 AND status = 'pending' AND patient_id = ANY($2) RETURNING branch_id", [params.id, fam]);
      if (!r.rowCount) throw notFound("Solicitud pendiente");
      await paudit(c, ctx, "portal.request_cancelled", "portal_booking", params.id, {}, r.rows[0].branch_id);
      return { ok: true };
    },
  });

  // ---------------- Portal: citas ----------------
  async function ownAppointment(c: Client, s: PatientSession, id: string) {
    const fam = (await family(c, s)).map((p) => p.id);
    const a = (await c.query<{ id: string; patient_id: string; branch_id: string; dentist_id: string; procedure_id: string | null; starts_at: Date; ends_at: Date; status: string; chair_id: string | null }>(
      "SELECT id, patient_id, branch_id, dentist_id, procedure_id, starts_at, ends_at, status, chair_id FROM appointments WHERE id = $1 AND patient_id = ANY($2)", [id, fam])).rows[0];
    if (!a) throw notFound("Cita");
    return a;
  }

  pub({
    method: "GET", url: "/me/appointments", summary: "Citas próximas y pasadas del paciente y su grupo familiar, más solicitudes web",
    handler: async ({ c, ctx, req }) => {
      const s = await requireSession(c, req);
      const fam = await family(c, s);
      const ids = fam.map((p) => p.id);
      const rows = (await c.query(
        `SELECT a.id, a.patient_id, a.starts_at, a.ends_at, a.status, COALESCE(pr.name, a.reason, 'Consulta') AS service, pr.id AS procedure_id,
                u.full_name AS dentist_name, b.id AS branch_id, b.name AS branch_name, b.address, b.city, s.whatsapp, s.map_url, pb.code
           FROM appointments a JOIN users u ON u.id = a.dentist_id JOIN branches b ON b.id = a.branch_id
           LEFT JOIN procedures pr ON pr.id = a.procedure_id LEFT JOIN portal_branch_settings s ON s.branch_id = b.id
           LEFT JOIN portal_bookings pb ON pb.appointment_id = a.id
          WHERE a.patient_id = ANY($1) AND a.starts_at > now() - interval '2 years'
          ORDER BY a.starts_at DESC LIMIT 200`, [ids])).rows;
      const now = Date.now();
      const name = (id: string) => { const p = fam.find((x) => x.id === id); return p ? `${p.firstName} ${p.lastName}` : ""; };
      const view = (a: any) => {
        const w = fmtWhen(a.starts_at, ctx.zone);
        return {
          id: a.id, patientId: a.patient_id, patientName: name(a.patient_id), startsAt: a.starts_at, endsAt: a.ends_at, date: w.date, time: w.time,
          status: a.status, statusLabel: PATIENT_STATUS[a.status], service: a.service, procedureId: a.procedure_id, dentistName: a.dentist_name, code: a.code,
          canChange: canChange(ctx, a.starts_at, a.status), icsUrl: `/api/public/c/${ctx.slug}/me/appointments/${a.id}/ics`,
          branch: {
            id: a.branch_id, name: a.branch_name, address: a.address,
            mapUrl: mapLink({ map_url: a.map_url, address: a.address, city: a.city, name: a.branch_name }, ctx.clinicName),
            whatsappUrl: whatsappLink(a.whatsapp, `Hola, escribo por mi cita del ${w.date} a las ${w.time}.`),
          },
        };
      };
      // Una cita futura nunca aparece como atendida: las próximas son solo las activas.
      const upcoming = rows.filter((a) => +a.ends_at > now && ["scheduled", "confirmed", "arrived", "in_progress"].includes(a.status)).reverse().map(view);
      const upcomingIds = new Set(upcoming.map((a) => a.id));
      const past = rows.filter((a) => !upcomingIds.has(a.id) && +a.starts_at <= now).slice(0, 50).map(view);
      const cancelledFuture = rows.filter((a) => !upcomingIds.has(a.id) && +a.starts_at > now).map(view);
      const requests = (await c.query<{ id: string }>(
        `SELECT id FROM portal_bookings WHERE patient_id = ANY($1) AND appointment_id IS NULL AND status IN ('pending','rejected')
            AND starts_at > now() - interval '30 days' ORDER BY starts_at`, [ids])).rows;
      await paudit(c, ctx, "portal.viewed", "patient", s.patientId, { section: "appointments" });
      return { upcoming, past: [...cancelledFuture, ...past], requests: await Promise.all(requests.map((r) => bookingView(c, ctx, r.id))) };
    },
  });

  pub({
    method: "GET", url: "/me/appointments/:id/ics", summary: "Descargar la cita para el calendario (.ics, sin datos clínicos)", params: PId, raw: true,
    handler: async ({ c, ctx, params, req, reply }) => {
      const s = await requireSession(c, req);
      const a = await ownAppointment(c, s, params.id);
      const b = (await c.query("SELECT b.name, b.address, b.city, s.whatsapp FROM branches b LEFT JOIN portal_branch_settings s ON s.branch_id = b.id WHERE b.id = $1", [a.branch_id])).rows[0];
      const code = (await c.query<{ code: string }>("SELECT code FROM portal_bookings WHERE appointment_id = $1", [a.id])).rows[0]?.code;
      const ics = buildIcs({
        uid: a.id, startsAt: a.starts_at, endsAt: a.ends_at, summary: `Cita en ${ctx.clinicName} (${b.name})`,
        location: [b.name, b.address, b.city].filter(Boolean).join(", "),
        description: [code ? `Código de reserva: ${code}.` : null, b.whatsapp ? `WhatsApp de la sucursal: ${b.whatsapp}.` : null, `Reprogramar o cancelar: ${portalUrl(ctx)}`].filter(Boolean).join(" "),
      });
      reply.header("content-type", "text/calendar; charset=utf-8").header("content-disposition", `attachment; filename="cita-${a.starts_at.toISOString().slice(0, 10)}.ics"`).send(ics);
    },
  });

  pub({
    method: "POST", url: "/me/appointments/:id/cancel", summary: "Cancelar una cita propia dentro del plazo permitido", params: PId,
    body: z.object({ reason: z.string().trim().max(200).optional() }),
    handler: async ({ c, ctx, params, body, req }) => {
      const s = await requireSession(c, req);
      await rateLimit(c, ctx, "change_session", s.id, 10, 60);
      const a = await ownAppointment(c, s, params.id);
      if (!canChange(ctx, a.starts_at, a.status)) {
        throw new AppError(409, "outside_window", ["scheduled", "confirmed"].includes(a.status)
          ? `Faltan menos de ${ctx.settings.changeWindowHours} h para la cita: para cancelarla escribe a la sucursal por WhatsApp.`
          : "Esta cita ya no se puede cancelar en línea.");
      }
      await c.query(
        "UPDATE appointments SET status = 'cancelled', cancelled_at = now(), updated_at = now(), cancel_reason = $2 WHERE id = $1",
        [a.id, `Cancelada por el paciente en la web${body.reason ? `: ${body.reason}` : ""}`]);
      await c.query("UPDATE portal_bookings SET status = 'cancelled' WHERE appointment_id = $1", [a.id]);
      await paudit(c, ctx, "portal.appointment_cancelled", "appointment", a.id, { patientId: a.patient_id, startsAt: a.starts_at }, a.branch_id);
      return { ok: true };
    },
  });

  pub({
    method: "POST", url: "/me/appointments/:id/reschedule", summary: "Reprogramar una cita propia dentro del plazo (misma sucursal y duración)", params: PId,
    body: z.object({ startsAt: zDateTime, dentistId: zId, holdToken: z.string().max(100).optional() }),
    handler: async ({ c, ctx, params, body, req }) => {
      const s = await requireSession(c, req);
      await rateLimit(c, ctx, "change_session", s.id, 10, 60);
      const a = await ownAppointment(c, s, params.id);
      if (!canChange(ctx, a.starts_at, a.status)) {
        throw new AppError(409, "outside_window", `Faltan menos de ${ctx.settings.changeWindowHours} h para la cita: para reprogramarla escribe a la sucursal por WhatsApp.`);
      }
      const durationMin = Math.round((a.ends_at.getTime() - a.starts_at.getTime()) / 60_000);
      const holdHash = body.holdToken ? sha256(body.holdToken) : null;
      await assertSlotAvailable(c, ctx, { branchId: a.branch_id, durationMin, dentistId: body.dentistId, startsAt: body.startsAt, excludeAppointmentId: a.id, ownHoldHash: holdHash });
      const startsAt = new Date(body.startsAt);
      const endsAt = new Date(startsAt.getTime() + durationMin * 60_000);
      const upd = (chair: string | null) => c.query(
        `UPDATE appointments SET starts_at = $2, ends_at = $3, dentist_id = $4, chair_id = $5, status = 'scheduled', confirmed_at = NULL,
                reschedule_count = reschedule_count + 1, updated_at = now() WHERE id = $1`, [a.id, startsAt, endsAt, body.dentistId, chair]);
      await c.query("SAVEPOINT resched");
      try {
        await upd(a.chair_id);
      } catch (e) {
        const err = e as { code?: string; constraint?: string };
        if (err.code !== "23P01") throw e;
        await c.query("ROLLBACK TO SAVEPOINT resched");
        if (err.constraint === "appt_no_overlap_chair") await upd(null); // el consultorio lo asigna recepción
        else if (err.constraint === "appt_no_overlap_patient") throw new AppError(409, "patient_busy", "Ya tienes otra cita a esa hora.");
        else throw new AppError(409, "slot_taken", "Ese horario acaba de ocuparse. Elige otro, por favor.");
      }
      await c.query("UPDATE portal_bookings SET starts_at = $2, ends_at = $3, dentist_id = $4 WHERE appointment_id = $1", [a.id, startsAt, endsAt, body.dentistId]);
      if (holdHash) await c.query("DELETE FROM portal_slot_holds WHERE token_hash = $1", [holdHash]);
      const w = fmtWhen(startsAt, ctx.zone);
      await send(c, ctx, { to: s.phone, template: "portal.appointment_rescheduled", patientId: a.patient_id, branchId: a.branch_id, relatedEntity: "appointment", relatedId: a.id,
        body: `${ctx.clinicName}: tu cita se reprogramó para el ${w.date} a las ${w.time}. Para ver tus citas: ${portalUrl(ctx)}` });
      await paudit(c, ctx, "portal.appointment_rescheduled", "appointment", a.id, { from: a.starts_at, to: startsAt, dentistId: body.dentistId }, a.branch_id);
      return { ok: true, startsAt, endsAt, date: w.date, time: w.time };
    },
  });

  // ---------------- Portal: cuenta, pagos y presupuestos ----------------
  pub({
    method: "GET", url: "/me/account", summary: "Saldo (función única patient_money) e historial de pagos", query: z.object({ patientId: zId }),
    handler: async ({ c, ctx, query, req }) => {
      const s = await requireSession(c, req);
      await requireFamilyMember(c, s, query.patientId);
      const bal = (await c.query<{ charged_cents: number; paid_cents: number; pending_cents: number; balance_cents: number }>(
        "SELECT * FROM patient_money($1)", [query.patientId])).rows[0]!;
      const payments = (await c.query(
        `SELECT p.id, p.receipt_number AS "receiptNumber", p.amount_cents AS "amountCents", p.method, p.status, p.received_at AS "receivedAt", b.name AS "branchName"
           FROM payments p JOIN branches b ON b.id = p.branch_id WHERE p.patient_id = $1 ORDER BY p.received_at DESC LIMIT 100`, [query.patientId])).rows;
      await paudit(c, ctx, "portal.viewed", "patient", query.patientId, { section: "account" });
      return {
        chargedCents: bal.charged_cents, paidCents: bal.paid_cents, pendingVerificationCents: bal.pending_cents, balanceCents: bal.balance_cents,
        payments: payments.map((p) => ({ ...p, methodLabel: METHOD_LABELS[p.method], statusLabel: PAYMENT_STATUS[p.status] })),
        paymentNote: PAYMENT_NOTE,
      };
    },
  });

  pub({
    method: "GET", url: "/me/payments/:id", summary: "Comprobante de un pago confirmado (vista para imprimir)", params: PId,
    handler: async ({ c, ctx, params, req }) => {
      const s = await requireSession(c, req);
      const fam = (await family(c, s)).map((p) => p.id);
      const p = (await c.query(
        `SELECT p.id, p.receipt_number, p.amount_cents, p.method, p.status, p.received_at, p.patient_id, pt.first_name, pt.last_name, pt.record_number,
                b.name AS branch_name, b.address, cl.legal_name, cl.tax_id, cl.name AS clinic_name, bu.number AS budget_number
           FROM payments p JOIN patients pt ON pt.id = p.patient_id JOIN branches b ON b.id = p.branch_id JOIN clinics cl ON cl.id = p.clinic_id
           LEFT JOIN budgets bu ON bu.id = p.budget_id
          WHERE p.id = $1 AND p.patient_id = ANY($2)`, [params.id, fam])).rows[0];
      if (!p) throw notFound("Pago");
      if (p.status !== "confirmed") throw new AppError(409, "not_confirmed", "Este pago aún no está confirmado por la clínica; el comprobante estará disponible cuando se confirme.");
      const bal = (await c.query<{ balance_cents: number }>("SELECT balance_cents FROM patient_money($1)", [p.patient_id])).rows[0]!;
      await paudit(c, ctx, "portal.receipt_viewed", "payment", p.id, {});
      return {
        id: p.id, receiptNumber: p.receipt_number, amountCents: p.amount_cents, amountText: money(p.amount_cents), method: METHOD_LABELS[p.method],
        receivedAt: p.received_at, patientName: `${p.first_name} ${p.last_name}`, recordNumber: p.record_number, branchName: p.branch_name, branchAddress: p.address,
        clinicName: p.clinic_name, legalName: p.legal_name, taxId: p.tax_id, budgetNumber: p.budget_number, balanceCents: bal.balance_cents,
        note: "Comprobante interno de pago. No es una factura.",
      };
    },
  });

  pub({
    method: "GET", url: "/me/budgets", summary: "Presupuestos presentados y aceptados (solo lectura)", query: z.object({ patientId: zId }),
    handler: async ({ c, ctx, query, req }) => {
      const s = await requireSession(c, req);
      await requireFamilyMember(c, s, query.patientId);
      const budgets = (await c.query(
        `SELECT bu.id, bu.number, bu.status, bu.discount_cents, bu.installments, bu.valid_until, bu.presented_at, bu.created_at, u.full_name AS dentist_name, b.name AS branch_name,
                COALESCE((SELECT sum(amount_cents) FROM payments WHERE budget_id = bu.id AND status = 'confirmed'), 0)::bigint AS paid
           FROM budgets bu JOIN users u ON u.id = bu.dentist_id JOIN branches b ON b.id = bu.branch_id
          WHERE bu.patient_id = $1 AND bu.status IN ('presented','accepted') ORDER BY bu.created_at DESC`, [query.patientId])).rows;
      const items = budgets.length ? (await c.query(
        `SELECT budget_id, description, tooth, quantity, unit_price_cents, discount_cents, status FROM budget_items
          WHERE budget_id = ANY($1) AND status <> 'cancelled' ORDER BY position`, [budgets.map((b) => b.id)])).rows : [];
      await paudit(c, ctx, "portal.viewed", "patient", query.patientId, { section: "budgets" });
      return budgets.map((b) => {
        const its = items.filter((i) => i.budget_id === b.id).map((i) => ({
          description: i.description, tooth: i.tooth, quantity: i.quantity, totalCents: i.unit_price_cents * i.quantity - i.discount_cents,
          done: i.status === "done",
        }));
        const total = its.reduce((x, i) => x + i.totalCents, 0) - b.discount_cents;
        return {
          id: b.id, number: b.number, status: b.status, statusLabel: b.status === "accepted" ? "Aceptado" : "Presentado (pendiente de tu decisión en la clínica)",
          date: b.presented_at ?? b.created_at, validUntil: b.valid_until, dentistName: b.dentist_name, branchName: b.branch_name,
          installments: b.installments, discountCents: b.discount_cents, totalCents: total, paidCents: b.paid, pendingCents: Math.max(total - b.paid, 0), items: its,
        };
      });
    },
  });
}
