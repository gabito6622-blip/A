// Lado del personal: configuración de la reserva online, bandeja "Solicitudes web" y bandeja de mensajes.
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams, zMoney, zOptText } from "../../lib/http.js";
import { AppError, badRequest, conflict, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import { normalizePhone } from "../../lib/text.js";
import { allowedBranches, requireBranch } from "../../lib/rbac.js";
import { MESSAGE_STATUS_LABELS, type Messenger, type MessageStatus } from "../../lib/messaging.js";
import { assertBookable, clinicZone } from "../agenda.js";
import { fmtWhen, loadSettings } from "./core.js";
import { BOOKING_STATUS } from "./public.js";

export function portalAdminRoutes(route: Route, cfg: Config, messenger: Messenger) {
  // ---------------- Configuración ----------------
  route({
    method: "GET", url: "/api/portal/settings", summary: "Configuración de la reserva online (sucursales, prestaciones y reglas)", tags: ["reserva online"], perm: "clinic.manage",
    handler: async ({ c, auth }) => {
      const cl = (await c.query<{ slug: string; name: string }>("SELECT slug, name FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!;
      const branches = (await c.query(
        `SELECT b.id, b.code, b.name, b.address, b.city, b.phone, COALESCE(s.enabled, true) AS enabled, COALESCE(s.mode, 'request') AS mode,
                s.whatsapp, s.map_url AS "mapUrl"
           FROM branches b LEFT JOIN portal_branch_settings s ON s.branch_id = b.id WHERE b.active ORDER BY b.code`)).rows;
      const services = (await c.query(
        `SELECT p.id AS "procedureId", p.code, p.name, p.category, p.duration_min AS "durationMin", p.price_cents AS "priceCents",
                (s.procedure_id IS NOT NULL) AS bookable, s.price_from_cents AS "priceFromCents"
           FROM procedures p LEFT JOIN portal_services s ON s.procedure_id = p.id WHERE p.active ORDER BY p.category, p.name`)).rows;
      return { slug: cl.slug, publicPath: `/reservar/${cl.slug}`, portalPath: `/mi-cuenta/${cl.slug}`, messagingMode: messenger.mode, settings: await loadSettings(c, auth.clinicId!), branches, services };
    },
  });

  route({
    method: "PUT", url: "/api/portal/settings", summary: "Guardar la configuración de la reserva online", tags: ["reserva online"], perm: "clinic.manage",
    body: z.object({
      enabled: z.boolean(),
      slug: z.string().trim().toLowerCase().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Usa solo minúsculas, números y guiones (2 a 41 caracteres)"),
      leadTimeHours: z.number().int().min(0, "Mínimo 0 horas").max(168, "Máximo 168 horas (7 días)"),
      maxDaysAhead: z.number().int().min(1, "Mínimo 1 día").max(180, "Máximo 180 días"),
      changeWindowHours: z.number().int().min(0, "Mínimo 0 horas").max(168, "Máximo 168 horas"),
      showPrices: z.boolean(),
      instructions: zOptText(1000),
      branches: z.array(z.object({
        branchId: zId, enabled: z.boolean(), mode: z.enum(["instant", "request"]),
        whatsapp: zOptText(20), mapUrl: zOptText(500),
      })).max(100),
      services: z.array(z.object({ procedureId: zId, priceFromCents: zMoney.nullish().transform((v) => v ?? null) })).max(300),
    }),
    handler: async ({ c, auth, body }) => {
      const errors: { path: string; message: string }[] = [];
      const branches = body.branches.map((b, i) => {
        const wa = b.whatsapp ? normalizePhone(b.whatsapp) : null;
        if (b.whatsapp && (!wa || !/^\+?[0-9]{7,15}$/.test(wa))) errors.push({ path: `branches.${i}.whatsapp`, message: "WhatsApp inválido (ej.: 71234567 o +59171234567)" });
        if (b.mapUrl && !/^https:\/\/\S+$/.test(b.mapUrl)) errors.push({ path: `branches.${i}.mapUrl`, message: "El enlace del mapa debe empezar con https://" });
        return { ...b, whatsapp: wa };
      });
      if (body.enabled && !branches.some((b) => b.enabled)) errors.push({ path: "branches", message: "Activa al menos una sucursal para recibir reservas" });
      if (body.enabled && !body.services.length) errors.push({ path: "services", message: "Elige al menos una prestación que se pueda reservar" });
      if (errors.length) throw new AppError(400, "validation", errors[0]!.message, errors);
      await c.query("UPDATE clinics SET slug = $2 WHERE id = $1", [auth.clinicId, body.slug]);
      await c.query(
        `INSERT INTO portal_settings (clinic_id, enabled, lead_time_hours, max_days_ahead, change_window_hours, show_prices, instructions, updated_by, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8, now())
         ON CONFLICT (clinic_id) DO UPDATE SET enabled = EXCLUDED.enabled, lead_time_hours = EXCLUDED.lead_time_hours, max_days_ahead = EXCLUDED.max_days_ahead,
           change_window_hours = EXCLUDED.change_window_hours, show_prices = EXCLUDED.show_prices, instructions = EXCLUDED.instructions,
           updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [auth.clinicId, body.enabled, body.leadTimeHours, body.maxDaysAhead, body.changeWindowHours, body.showPrices, body.instructions, auth.userId]);
      for (const b of branches) {
        await c.query(
          `INSERT INTO portal_branch_settings (branch_id, clinic_id, enabled, mode, whatsapp, map_url) VALUES ($1,$2,$3,$4,$5,$6)
           ON CONFLICT (branch_id) DO UPDATE SET enabled = EXCLUDED.enabled, mode = EXCLUDED.mode, whatsapp = EXCLUDED.whatsapp, map_url = EXCLUDED.map_url`,
          [b.branchId, auth.clinicId, b.enabled, b.mode, b.whatsapp, b.mapUrl]);
      }
      const ids = body.services.map((s) => s.procedureId);
      await c.query("DELETE FROM portal_services WHERE NOT (procedure_id = ANY($1::uuid[]))", [ids]);
      for (const [i, s] of body.services.entries()) {
        await c.query(
          `INSERT INTO portal_services (procedure_id, clinic_id, price_from_cents, position) VALUES ($1,$2,$3,$4)
           ON CONFLICT (procedure_id) DO UPDATE SET price_from_cents = EXCLUDED.price_from_cents, position = EXCLUDED.position`,
          [s.procedureId, auth.clinicId, s.priceFromCents, i]);
      }
      await audit(c, auth, "portal.settings_updated", "clinic", auth.clinicId, {
        enabled: body.enabled, slug: body.slug, leadTimeHours: body.leadTimeHours, maxDaysAhead: body.maxDaysAhead, changeWindowHours: body.changeWindowHours,
        branches: branches.map((b) => ({ id: b.branchId, enabled: b.enabled, mode: b.mode })), services: ids.length,
      });
      return { ok: true };
    },
  });

  // ---------------- Solicitudes web ----------------
  route({
    method: "GET", url: "/api/portal/requests", summary: "Bandeja de solicitudes web (filtrada por sucursales permitidas)", tags: ["reserva online"], perm: "agenda.read",
    query: z.object({ status: z.enum(["pending", "decided"]).default("pending"), branchId: zId.optional() }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = await clinicZone(c, auth.clinicId!);
      const r = await c.query(
        `SELECT pb.id, pb.code, pb.status, pb.starts_at AS "startsAt", pb.ends_at AS "endsAt", pb.created_at AS "createdAt", pb.decision_reason AS "decisionReason",
                pb.branch_id AS "branchId", b.name AS "branchName", pb.dentist_id AS "dentistId", u.full_name AS "dentistName",
                pb.procedure_id AS "procedureId", pr.name AS "procedureName", pb.patient_id AS "patientId",
                p.first_name || ' ' || p.last_name AS "patientName", p.record_number AS "recordNumber", COALESCE(ps.phone, p.phone, p.guardian_phone) AS phone,
                p.notes AS "patientNotes", (p.created_at > pb.created_at - interval '1 hour' AND p.referral_source = 'Reserva web') AS "newPatient",
                pb.starts_at < now() AS expired
           FROM portal_bookings pb JOIN patients p ON p.id = pb.patient_id JOIN branches b ON b.id = pb.branch_id
           JOIN procedures pr ON pr.id = pb.procedure_id LEFT JOIN users u ON u.id = pb.dentist_id LEFT JOIN portal_sessions ps ON ps.id = pb.session_id
          WHERE pb.mode = 'request' AND (CASE WHEN $1 = 'pending' THEN pb.status = 'pending' ELSE pb.status IN ('approved','rejected','cancelled') AND pb.created_at > now() - interval '30 days' END)
            AND ($2::uuid IS NULL OR pb.branch_id = $2) AND ($3::uuid[] IS NULL OR pb.branch_id = ANY($3))
          ORDER BY pb.starts_at LIMIT 200`,
        [query.status, query.branchId ?? null, allowedBranches(auth)]);
      return r.rows.map((x) => ({ ...x, statusLabel: BOOKING_STATUS[x.status], when: fmtWhen(x.startsAt, zone) }));
    },
  });

  async function loadRequest(c: Parameters<Parameters<Route>[0]["handler"]>[0]["c"], id: string) {
    const b = (await c.query<{ id: string; code: string; status: string; branch_id: string; dentist_id: string | null; procedure_id: string; patient_id: string; starts_at: Date; ends_at: Date; phone: string | null; service: string; branch_name: string }>(
      `SELECT pb.id, pb.code, pb.status, pb.branch_id, pb.dentist_id, pb.procedure_id, pb.patient_id, pb.starts_at, pb.ends_at,
              COALESCE(ps.phone, p.phone, p.guardian_phone) AS phone, pr.name AS service, br.name AS branch_name
         FROM portal_bookings pb JOIN patients p ON p.id = pb.patient_id JOIN procedures pr ON pr.id = pb.procedure_id JOIN branches br ON br.id = pb.branch_id
         LEFT JOIN portal_sessions ps ON ps.id = pb.session_id
        WHERE pb.id = $1 AND pb.mode = 'request' FOR UPDATE OF pb`, [id])).rows[0];
    if (!b) throw notFound("Solicitud");
    return b;
  }

  const clinicName = async (c: Parameters<Parameters<Route>[0]["handler"]>[0]["c"], id: string) =>
    (await c.query<{ name: string; slug: string }>("SELECT name, slug FROM clinics WHERE id = $1", [id])).rows[0]!;

  route({
    method: "POST", url: "/api/portal/requests/:id/approve", summary: "Aprobar una solicitud web: crea la cita con las validaciones normales de la agenda", tags: ["reserva online"], perm: "agenda.write",
    params: zIdParams, body: z.object({ dentistId: zId.optional(), chairId: zId.nullish().transform((v) => v ?? null) }),
    handler: async ({ c, auth, params, body }) => {
      const b = await loadRequest(c, params.id);
      requireBranch(auth, b.branch_id);
      if (b.status !== "pending") throw conflict("Esa solicitud ya fue atendida", "invalid_status");
      if (b.starts_at.getTime() < Date.now()) throw conflict("La hora solicitada ya pasó. Recházala indicando que escriba para elegir otra.", "request_expired");
      const dentistId = body.dentistId ?? b.dentist_id;
      if (!dentistId) throw badRequest("Elige el profesional");
      const zone = await clinicZone(c, auth.clinicId!);
      await assertBookable(c, auth, zone, { branchId: b.branch_id, dentistId, chairId: body.chairId, startsAt: b.starts_at, endsAt: b.ends_at, allowOutsideSchedule: false });
      const appt = (await c.query<{ id: string }>(
        `INSERT INTO appointments (clinic_id, branch_id, chair_id, dentist_id, patient_id, procedure_id, starts_at, ends_at, reason, notes, source, idempotency_key, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'portal',$11,$12) RETURNING id`,
        [auth.clinicId, b.branch_id, body.chairId, dentistId, b.patient_id, b.procedure_id, b.starts_at, b.ends_at, b.service,
          `Solicitud web ${b.code} aprobada por recepción`, `portal-req-${b.id}`, auth.userId])).rows[0]!;
      await c.query("UPDATE portal_bookings SET status = 'approved', appointment_id = $2, dentist_id = $3, decided_by = $4, decided_at = now() WHERE id = $1",
        [b.id, appt.id, dentistId, auth.userId]);
      const cl = await clinicName(c, auth.clinicId!);
      const w = fmtWhen(b.starts_at, zone);
      if (b.phone) {
        await messenger.enqueue(c, {
          clinicId: auth.clinicId!, branchId: b.branch_id, patientId: b.patient_id, channel: "whatsapp", recipient: b.phone, template: "portal.request_approved",
          purpose: "transactional", relatedEntity: "portal_booking", relatedId: b.id,
          body: `${cl.name}: tu cita del ${w.date} a las ${w.time} en ${b.branch_name} quedó confirmada (código ${b.code}). Para reprogramar o cancelar: ${cfg.publicUrl}/mi-cuenta/${cl.slug}`,
        });
      }
      await audit(c, auth, "portal.request_approved", "portal_booking", b.id, { code: b.code, appointmentId: appt.id, dentistId }, b.branch_id);
      return { ok: true, appointmentId: appt.id };
    },
  });

  route({
    method: "POST", url: "/api/portal/requests/:id/reject", summary: "Rechazar una solicitud web con motivo (se avisa al paciente)", tags: ["reserva online"], perm: "agenda.write",
    params: zIdParams, body: z.object({ reason: z.string().trim().min(3, "Escribe el motivo (lo verá el paciente)").max(300) }),
    handler: async ({ c, auth, params, body }) => {
      const b = await loadRequest(c, params.id);
      requireBranch(auth, b.branch_id);
      if (b.status !== "pending") throw conflict("Esa solicitud ya fue atendida", "invalid_status");
      await c.query("UPDATE portal_bookings SET status = 'rejected', decision_reason = $2, decided_by = $3, decided_at = now() WHERE id = $1", [b.id, body.reason, auth.userId]);
      const cl = await clinicName(c, auth.clinicId!);
      const zone = await clinicZone(c, auth.clinicId!);
      const w = fmtWhen(b.starts_at, zone);
      if (b.phone) {
        await messenger.enqueue(c, {
          clinicId: auth.clinicId!, branchId: b.branch_id, patientId: b.patient_id, channel: "whatsapp", recipient: b.phone, template: "portal.request_rejected",
          purpose: "transactional", relatedEntity: "portal_booking", relatedId: b.id,
          body: `${cl.name}: no pudimos confirmar tu solicitud del ${w.date} a las ${w.time} (código ${b.code}). Motivo: ${body.reason}. Puedes elegir otro horario en ${cfg.publicUrl}/reservar/${cl.slug}`,
        });
      }
      await audit(c, auth, "portal.request_rejected", "portal_booking", b.id, { code: b.code, reason: body.reason }, b.branch_id);
      return { ok: true };
    },
  });

  // ---------------- Bandeja de mensajes ----------------
  route({
    method: "GET", url: "/api/messages", summary: "Bandeja de mensajes salientes (fuera de producción: simulados, incluye los códigos de un solo uso)", tags: ["mensajes"], perm: "clinic.manage",
    query: z.object({
      status: z.enum(["queued", "simulated", "sent", "failed"]).optional(),
      channel: z.enum(["whatsapp", "sms", "email"]).optional(),
      limit: z.coerce.number().int().min(1).max(500).default(100),
    }),
    handler: async ({ c, query }) => {
      const r = await c.query(
        `SELECT m.id, m.channel, m.recipient, m.template, m.purpose, m.body, m.status, m.error, m.created_at AS "createdAt", m.sent_at AS "sentAt",
                m.related_entity AS "relatedEntity", m.related_id AS "relatedId", p.first_name || ' ' || p.last_name AS "patientName", b.name AS "branchName"
           FROM outbound_messages m LEFT JOIN patients p ON p.id = m.patient_id LEFT JOIN branches b ON b.id = m.branch_id
          WHERE ($1::text IS NULL OR m.status = $1) AND ($2::text IS NULL OR m.channel = $2)
          ORDER BY m.created_at DESC LIMIT $3`,
        [query.status ?? null, query.channel ?? null, query.limit]);
      return { mode: messenger.mode, items: r.rows.map((m) => ({ ...m, statusLabel: MESSAGE_STATUS_LABELS[m.status as MessageStatus] })) };
    },
  });
}
