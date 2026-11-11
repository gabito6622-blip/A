// Superficies públicas de los mensajes automáticos (sin sesión del personal):
//  * /api/public/confirmar/:token — página «Confirmo / Necesito reprogramar» (funciona con cualquier canal);
//  * /api/public/c/:slug/me/messages/opt-out — «Dejar de recibir mensajes» desde el portal del paciente;
//  * /api/webhooks/whatsapp — estados de entrega y respuestas «BAJA» (firma X-Hub-Signature-256).
import { createHash, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { Config } from "../../config.js";
import type { Client } from "../../lib/db.js";
import { withTenant } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import { AppError, notFound } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { Messenger } from "../../lib/messaging.js";
import { TRANSITIONS } from "../agenda.js";
import { afterAppointmentStatusChange } from "../appointmentEvents.js";
import { recordPatientRevocation } from "../consents.js";
import { family, mapLink, publicActor, requireSession, whatsappLink, withPortal } from "../portal/core.js";
import { fmtLocal } from "./timing.js";
import { confirmTokenHash, verifyConfirmToken } from "./tokens.js";
import { isOptOut, parseWebhook, verifyWebhookSignature } from "./whatsapp.js";

export const WEBHOOK_PATH = "/api/webhooks/whatsapp";

/** Comparación en tiempo constante (sobre el SHA-256, así no depende del largo). */
export function sameSecret(given: string, expected: string): boolean {
  const h = (s: string) => createHash("sha256").update(s).digest();
  return timingSafeEqual(h(given), h(expected));
}
const TAGS = ["mensajes automáticos"];
const zToken = z.object({ token: z.string().min(10).max(120) });
type Actor = { clinicId: string; userId: string | null; ip: string | null };

type LinkState = "valid" | "used" | "expired" | "changed" | "cancelled";
const STATE_MESSAGES: Record<Exclude<LinkState, "valid">, string> = {
  used: "Este enlace ya se usó. Si necesitas cambiar algo, escribe a la sucursal.",
  expired: "Este enlace venció: la hora de la cita ya pasó.",
  changed: "Tu cita cambió de horario. Usa el enlace del mensaje más reciente.",
  cancelled: "Esta cita fue cancelada. Si quieres otra, reserva o escribe a la sucursal.",
};

export function messagingPublicRoutes(route: Route, cfg: Config, messenger: Messenger) {
  async function loadLink(c: Client, tokenId: string, token: string, lock = false) {
    const r = (await c.query(
      `SELECT t.id, t.appointment_id, t.starts_at AS token_starts_at, t.expires_at, t.used_at, t.used_action,
              a.status, a.starts_at, a.branch_id, p.first_name, b.name AS branch_name, b.address, b.city, b.phone AS branch_phone,
              s.whatsapp, s.map_url, cl.name AS clinic_name, cl.slug, cl.timezone, cl.status AS clinic_status, COALESCE(ps.enabled, false) AS portal
         FROM message_confirm_tokens t JOIN appointments a ON a.id = t.appointment_id JOIN patients p ON p.id = a.patient_id
         JOIN branches b ON b.id = a.branch_id LEFT JOIN portal_branch_settings s ON s.branch_id = b.id
         JOIN clinics cl ON cl.id = t.clinic_id LEFT JOIN portal_settings ps ON ps.clinic_id = t.clinic_id
        WHERE t.id = $1 AND t.token_hash = $2 ${lock ? "FOR UPDATE OF t" : ""}`,
      [tokenId, confirmTokenHash(token)])).rows[0];
    if (!r || !["trial", "active"].includes(r.clinic_status)) throw notFound("Enlace");
    let state: LinkState = "valid";
    if (r.used_at) state = "used";
    else if (["cancelled", "no_show"].includes(r.status)) state = "cancelled";
    else if (+r.starts_at !== +r.token_starts_at) state = "changed";
    else if (Date.now() >= +r.expires_at || !["scheduled", "confirmed"].includes(r.status)) state = "expired";
    const w = fmtLocal(r.starts_at, r.timezone);
    const view = {
      state, message: state === "valid" ? null : STATE_MESSAGES[state], clinicName: r.clinic_name, patientFirstName: r.first_name,
      date: w.date.charAt(0).toUpperCase() + w.date.slice(1), time: w.time, alreadyConfirmed: r.status === "confirmed",
      branch: {
        name: r.branch_name, address: r.address, city: r.city, phone: r.whatsapp ?? r.branch_phone,
        mapUrl: mapLink({ map_url: r.map_url, address: r.address, city: r.city, name: r.branch_name }, r.clinic_name),
        whatsappUrl: whatsappLink(r.whatsapp, `Hola, necesito reprogramar mi cita del ${w.date} a las ${w.time} en ${r.branch_name}.`),
      },
      canRescheduleOnline: !!r.portal,
    };
    return { row: r, view };
  }

  function withLink<T>(db: Parameters<Parameters<Route>[0]["handler"]>[0]["db"], token: string, fn: (c: Client, v: { clinicId: string; tokenId: string }) => Promise<T>) {
    const v = verifyConfirmToken(cfg.keys.link, token);
    if (!v) throw notFound("Enlace");
    return withTenant(db.appPool, { clinicId: v.clinicId, userId: null }, (c) => fn(c, v));
  }

  route({
    method: "GET", url: "/api/public/confirmar/:token", summary: "Enlace de confirmación: fecha, hora y sucursal de la cita (sin datos clínicos)", tags: TAGS,
    access: "public", noTx: true, params: zToken, limit: cfg.disableRateLimit ? undefined : { max: 60, timeWindow: "1 minute" },
    handler: async ({ db, params }) => withLink(db, params.token, async (c, v) => (await loadLink(c, v.tokenId, params.token)).view),
  });

  route({
    method: "POST", url: "/api/public/confirmar/:token", summary: "Confirmar la cita (un solo uso) o pedir reprogramarla desde el enlace del mensaje", tags: TAGS,
    access: "public", noTx: true, params: zToken, body: z.object({ action: z.enum(["confirm", "reschedule"]) }),
    limit: cfg.disableRateLimit ? undefined : { max: 20, timeWindow: "1 minute" },
    handler: async ({ db, params, body, req }) => {
      if (req.headers["x-portal"] !== "1") throw new AppError(403, "csrf", "Solicitud no válida. Recarga la página.");
      return withLink(db, params.token, async (c, v) => {
        const { row, view } = await loadLink(c, v.tokenId, params.token, true);
        const actor = publicActor({ clinicId: v.clinicId, ip: req.ip });
        if (view.state !== "valid") {
          const code = view.state === "used" ? "link_used" : view.state === "expired" ? "link_expired" : view.state === "changed" ? "appointment_changed" : "appointment_cancelled";
          throw new AppError(view.state === "expired" ? 410 : 409, code, view.message!);
        }
        if (body.action === "reschedule") {
          await c.query("UPDATE message_confirm_tokens SET reschedule_clicked_at = now() WHERE id = $1", [row.id]);
          await audit(c, actor, "messaging.reschedule_requested", "appointment", row.appointment_id, { via: "enlace" }, row.branch_id);
          return {
            ok: true, redirect: view.canRescheduleOnline ? `/mi-cuenta/${row.slug}?reprogramar=${row.appointment_id}` : null,
            whatsappUrl: view.branch.whatsappUrl, phone: view.branch.phone,
          };
        }
        // Confirmar con la transición normal de la agenda (agendada → confirmada).
        const cur = (await c.query<{ status: string; branch_id: string }>("SELECT status, branch_id FROM appointments WHERE id = $1 FOR UPDATE", [row.appointment_id])).rows[0]!;
        if (cur.status !== "confirmed") {
          if (!TRANSITIONS[cur.status]?.includes("confirmed")) throw new AppError(409, "invalid_transition", "Esta cita ya no se puede confirmar en línea. Escribe a la sucursal.");
          await c.query("UPDATE appointments SET status = 'confirmed', confirmed_at = now(), updated_at = now() WHERE id = $1", [row.appointment_id]);
          await audit(c, actor, "appointment.status", "appointment", row.appointment_id, { from: cur.status, to: "confirmed", via: "enlace de confirmación" }, cur.branch_id);
          await afterAppointmentStatusChange(c, actor, { appointmentId: row.appointment_id, branchId: cur.branch_id, from: cur.status, to: "confirmed", reason: "Confirmada por el paciente desde el enlace del mensaje" });
        }
        await c.query("UPDATE message_confirm_tokens SET used_at = now(), used_action = 'confirmed' WHERE id = $1", [row.id]);
        await audit(c, actor, "messaging.confirmed_by_link", "appointment", row.appointment_id, { alreadyConfirmed: cur.status === "confirmed" }, cur.branch_id);
        return { ok: true, state: "confirmed", date: view.date, time: view.time, branch: view.branch };
      });
    },
  });

  // ---------------- Portal: dejar de recibir mensajes (un clic) ----------------
  route({
    method: "POST", url: "/api/public/c/:slug/me/messages/opt-out", summary: "Dejar de recibir mensajes: revoca recordatorios y promociones del paciente y de los menores a su cargo",
    tags: TAGS, access: "public", noTx: true, params: z.object({ slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Dirección de clínica inválida") }),
    limit: cfg.disableRateLimit ? undefined : { max: 10, timeWindow: "1 minute" },
    handler: async ({ db, params, req }) => {
      if (req.headers["x-portal"] !== "1") throw new AppError(403, "csrf", "Solicitud no válida. Recarga la página.");
      return withPortal(db, params.slug, req, async (c, ctx) => {
        const s = await requireSession(c, req);
        const fam = await family(c, s);
        const actor = publicActor(ctx);
        let revoked = 0;
        for (const p of fam) {
          const branchId = p.preferredBranchId ?? (await c.query<{ id: string }>("SELECT id FROM branches WHERE active ORDER BY code LIMIT 1")).rows[0]?.id;
          if (!branchId) continue;
          for (const kind of ["reminders", "marketing"] as const) {
            if (await recordPatientRevocation(c, actor, { patientId: p.id, branchId, kind, notes: "El paciente pidió dejar de recibir mensajes desde el portal (un clic), tras verificar su celular con un código" })) revoked++;
          }
        }
        return { ok: true, revoked, family: (await family(c, s)).map((p) => ({ id: p.id, consentReminders: p.consentReminders, consentMarketing: p.consentMarketing })) };
      });
    },
  });

  // ---------------- Webhook de WhatsApp Cloud API ----------------
  route({
    method: "GET", url: WEBHOOK_PATH, summary: "Verificación del webhook por Meta (hub.challenge con WHATSAPP_VERIFY_TOKEN)", tags: TAGS,
    access: "public", noTx: true, raw: true,
    query: z.object({ "hub.mode": z.string().max(40).optional(), "hub.verify_token": z.string().max(200).optional(), "hub.challenge": z.string().max(200).optional() }),
    handler: async ({ query, reply }) => {
      const expected = process.env.WHATSAPP_VERIFY_TOKEN;
      if (!expected || query["hub.mode"] !== "subscribe" || !sameSecret(query["hub.verify_token"] ?? "", expected)) {
        reply.code(403).send({ error: { code: "forbidden", message: "Verificación del webhook rechazada" } });
        return;
      }
      reply.type("text/plain").send(query["hub.challenge"] ?? "");
    },
  });

  route({
    method: "POST", url: WEBHOOK_PATH, summary: "Webhook de WhatsApp: estados de entrega y respuestas «BAJA» (exige firma X-Hub-Signature-256)", tags: TAGS,
    access: "public", noTx: true, limit: cfg.disableRateLimit ? undefined : { max: 600, timeWindow: "1 minute" },
    handler: async ({ db, req }) => {
      const secret = process.env.WHATSAPP_APP_SECRET;
      if (!secret) throw new AppError(503, "webhook_not_configured", "El webhook de WhatsApp no está configurado (falta WHATSAPP_APP_SECRET)");
      const raw = (req as unknown as { rawBody?: Buffer }).rawBody ?? Buffer.from("");
      if (!verifyWebhookSignature(raw, req.headers["x-hub-signature-256"], secret)) throw new AppError(401, "invalid_signature", "Firma del webhook inválida");
      let payload: unknown;
      try { payload = JSON.parse(raw.toString("utf8")); } catch { throw new AppError(400, "bad_request", "Cuerpo del webhook inválido"); }
      const { statuses, inbound } = parseWebhook(payload);
      let updated = 0, optOuts = 0, received = 0;
      for (const s of statuses) {
        const m = (await db.appPool.query<{ id: string; clinic_id: string }>("SELECT * FROM messaging_message_by_provider_id($1)", [s.providerMessageId])).rows[0];
        if (!m) continue;
        updated += await withTenant(db.appPool, { clinicId: m.clinic_id, userId: null }, async (c) => {
          const r = await c.query(
            `UPDATE outbound_messages SET status = $2,
                    sent_at = COALESCE(sent_at, $3),
                    delivered_at = CASE WHEN $2 IN ('delivered','read') THEN COALESCE(delivered_at, $3) ELSE delivered_at END,
                    read_at = CASE WHEN $2 = 'read' THEN COALESCE(read_at, $3) ELSE read_at END,
                    error = CASE WHEN $2 = 'failed' THEN $4 ELSE error END
              WHERE id = $1 AND status <> 'simulated' AND (
                ($2 = 'failed' AND status IN ('queued','sent'))
                OR array_position(ARRAY['queued','sent','delivered','read'], $2) > array_position(ARRAY['queued','sent','delivered','read'], status))`,
            [m.id, s.status, s.at ?? new Date(), s.error ?? "El proveedor informó un fallo"]);
          return r.rowCount ?? 0;
        });
      }
      for (const msg of inbound) {
        // B-093: por el número completo (E.164) y la clínica del último WhatsApp enviado a ESE número.
        const ctx = (await db.appPool.query<{ clinic_id: string; patient_id: string; purpose: string; branch_id: string | null }>(
          "SELECT * FROM messaging_last_outbound_to_number($1)", [msg.from])).rows[0];
        if (!ctx) {
          // Número que no recibió mensajes de ninguna clínica: no se da de baja a nadie (solo queda en el registro).
          req.log.info({ providerMessageId: msg.providerMessageId }, "respuesta de WhatsApp de un número sin envíos previos: ignorada");
          continue;
        }
        const res = await withTenant(db.appPool, { clinicId: ctx.clinic_id, userId: null }, async (c) => {
          const optOut = isOptOut(msg.text);
          const ins = await c.query(
            `INSERT INTO inbound_messages (clinic_id, patient_id, sender, body, kind, provider_message_id, branch_id) VALUES ($1,$2,$3,$4,$5,$6,$7)
             ON CONFLICT (clinic_id, provider_message_id) DO NOTHING`,
            [ctx.clinic_id, ctx.patient_id, msg.from.slice(0, 40), msg.text, optOut ? "opt_out" : "other", msg.providerMessageId, ctx.branch_id]);
          if (!ins.rowCount) return { received: 0, optOut: 0 };
          if (!optOut) return { received: 1, optOut: 0 };
          return { received: 1, optOut: await handleOptOut(c, { clinicId: ctx.clinic_id, userId: null, ip: req.ip }, msg.from, ctx) };
        });
        received += res.received; optOuts += res.optOut;
      }
      return { ok: true, updated, received, optOuts };
    },
  });

  /** «BAJA»: revoca la finalidad del último mensaje (o ambas) para los pacientes de ESTA clínica con ese número completo (E.164). */
  async function handleOptOut(c: Client, actor: Actor, from: string, ctx: { purpose: string; branch_id: string | null }) {
    const kinds = ctx.purpose === "marketing" ? (["marketing"] as const) : ctx.purpose === "reminders" ? (["reminders"] as const) : (["reminders", "marketing"] as const);
    const pats = (await c.query<{ id: string; preferred_branch_id: string | null; phone: string | null; guardian_phone: string | null }>(
      `SELECT id, preferred_branch_id, phone, guardian_phone FROM patients
        WHERE archived_at IS NULL AND phone_e164($1) IS NOT NULL AND (phone_e164(phone) = phone_e164($1) OR phone_e164(guardian_phone) = phone_e164($1))`,
      [from])).rows;
    let n = 0;
    let replyTo: string | null = null;
    for (const p of pats) {
      const branchId = ctx.branch_id ?? p.preferred_branch_id ?? (await c.query<{ id: string }>("SELECT id FROM branches WHERE active ORDER BY code LIMIT 1")).rows[0]?.id;
      if (!branchId) continue;
      for (const kind of kinds) {
        if (await recordPatientRevocation(c, actor as never, { patientId: p.id, branchId, kind, notes: "El paciente respondió «BAJA» a un mensaje de WhatsApp" })) n++;
      }
      replyTo ??= p.phone ?? p.guardian_phone;
    }
    if (n && replyTo) {
      const clinic = (await c.query<{ name: string }>("SELECT name FROM clinics WHERE id = $1", [actor.clinicId])).rows[0]!.name;
      const what = kinds.length === 2 ? "mensajes automáticos" : kinds[0] === "marketing" ? "promociones" : "recordatorios";
      await messenger.enqueue(c, {
        clinicId: actor.clinicId, branchId: ctx.branch_id, patientId: pats[0]!.id, channel: "whatsapp", recipient: replyTo, template: "auto.opt_out_ack", purpose: "transactional",
        body: `${clinic}: listo, ya no te enviaremos ${what}. Si cambias de opinión, avísanos en la clínica.`,
      });
    }
    return n;
  }
}
