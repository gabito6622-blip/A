// Presupuestos v2 (B-045): descuentos globales, sesiones, versiones, enlace público
// para el paciente, entrega en mano, seguimiento y embudo con días en cada estado.
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { DateTime } from "luxon";
import type { Config } from "../config.js";
import type { Route } from "../lib/http.js";
import { zDate, zId, zIdParams, zMoney, zOptText } from "../lib/http.js";
import { AppError, badRequest, conflict, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { verifyWithAny } from "../lib/keys.js";
import type { Client } from "../lib/db.js";
import { allowedBranches, requireBranch, type AuthCtx } from "../lib/rbac.js";
import { performSession, recalcBudget, zGlobalDiscount } from "./budgets-v2-core.js";
import { consumeForTreatment } from "./inventory/index.js";
import { AGREEMENT_INSERT_COLS } from "./agreements/core.js";

export const LINK_DAYS = 30;
export const MAX_ATTEMPTS = 5;
const GRANT_MINUTES = 30;
const DEFAULT_VALIDITY_DAYS = 30;

const sha256 = (s: string | Buffer) => createHash("sha256").update(s).digest();
const sha256hex = (s: string | Buffer) => createHash("sha256").update(s).digest("hex");
const bsTxt = (cents: number) => `${(cents / 100).toFixed(2).replace(".", ",")} Bs`;

/** Número para wa.me: solo dígitos; los celulares bolivianos de 8 dígitos llevan el 591. */
export function waPhone(phone: string | null | undefined): string | null {
  const d = String(phone ?? "").replace(/\D/g, "");
  if (!d) return null;
  return d.length === 8 ? `591${d}` : d;
}

function installmentPlan(total: number, n: number) {
  const base = Math.floor(total / n);
  return Array.from({ length: n }, (_, k) => (k === n - 1 ? total - base * (n - 1) : base));
}

async function validityDays(c: Client, clinicId: string): Promise<number> {
  const v = (await c.query<{ d: number | null }>("SELECT (settings->>'budgetValidityDays')::int AS d FROM clinics WHERE id = $1", [clinicId])).rows[0]?.d;
  return v ?? DEFAULT_VALIDITY_DAYS;
}

/** Auditoría de acciones del paciente por el enlace (sin usuario y sin IP). */
async function auditPublic(c: Client, clinicId: string, action: string, budgetId: string, data: Record<string, unknown>, branchId: string) {
  await c.query(
    "INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, branch_id, data, ip) VALUES ($1, NULL, $2, 'budget', $3, $4, $5, NULL)",
    [clinicId, action, budgetId, branchId, JSON.stringify({ ...data, by: "paciente (enlace)" })]);
}

async function event(c: Client, clinicId: string, budgetId: string, kind: string, f: {
  linkId?: string | null; channel?: string | null; actor?: string | null; signerName?: string | null; signerRelationship?: string | null;
  signaturePng?: string | null; reason?: string | null; uaHash?: string | null; contentHash?: string | null; data?: Record<string, unknown>;
} = {}) {
  await c.query(
    `INSERT INTO budget_events (clinic_id, budget_id, link_id, kind, channel, actor_user_id, signer_name, signer_relationship, signature_png, reason, ua_hash, content_hash, data)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
    [clinicId, budgetId, f.linkId ?? null, kind, f.channel ?? null, f.actor ?? null, f.signerName ?? null, f.signerRelationship ?? null,
      f.signaturePng ?? null, f.reason ?? null, f.uaHash ?? null, f.contentHash ?? null, JSON.stringify(f.data ?? {})]);
}

async function lockBudget(c: Client, auth: AuthCtx, id: string) {
  const b = (await c.query<{ id: string; status: string; branch_id: string; patient_id: string; number: number; version: number }>(
    "SELECT id, status, branch_id, patient_id, number, version FROM budgets WHERE id = $1 FOR UPDATE", [id])).rows[0];
  if (!b) throw notFound("Presupuesto");
  requireBranch(auth, b.branch_id);
  return b;
}

/** Presentar un borrador al entregarlo o compartirlo (queda en la auditoría). */
async function presentIfDraft(c: Client, auth: AuthCtx, b: { id: string; status: string; branch_id: string }, via: string) {
  if (b.status !== "draft") return;
  await c.query("UPDATE budgets SET status = 'presented', presented_at = now() WHERE id = $1", [b.id]);
  await audit(c, auth, "budget.status", "budget", b.id, { from: "draft", to: "presented", via }, b.branch_id);
  b.status = "presented";
}

export function budgetV2Routes(route: Route, cfg: Config) {
  // Firmado con DENTAL_LINK_KEY (vigente); se acepta también la anterior durante la rotación.
  const grant = (key: Buffer, linkId: string, exp: number) => createHmac("sha256", key).update(`budget-link:${linkId}:${exp}`).digest();
  const issueGrant = (linkId: string) => {
    const exp = Date.now() + GRANT_MINUTES * 60_000;
    return `${exp}.${grant(cfg.keys.link.current, linkId, exp).toString("base64url")}`;
  };
  const checkGrant = (linkId: string, g: string) => {
    const [expS, sig] = g.split(".");
    const exp = Number(expS);
    if (!sig || !Number.isFinite(exp) || exp < Date.now()) return false;
    return verifyWithAny(cfg.keys.link, (k) => Buffer.from(grant(k, linkId, exp).toString("base64url")), Buffer.from(sig));
  };
  const linkUrl = (token: string) => `${cfg.publicUrl}/p/presupuesto/${token}`;

  // =====================================================================
  // Personal de la clínica
  // =====================================================================

  route({
    method: "PUT", url: "/api/budgets/:id/terms", summary: "Descuento global (% o monto, prorrateado por línea) y validez de un borrador", tags: ["presupuestos"],
    perm: "budgets.write", params: zIdParams,
    body: z.object({ globalDiscount: zGlobalDiscount.optional(), validUntil: zDate.nullish() }),
    handler: async ({ c, auth, params, body }) => {
      const b = await lockBudget(c, auth, params.id);
      if (b.status !== "draft") throw conflict("Solo se cambian las condiciones de un borrador; crea una nueva versión", "invalid_status");
      const before = (await c.query("SELECT discount_cents, global_discount_percent, valid_until FROM budgets WHERE id = $1", [params.id])).rows[0];
      if (body.globalDiscount) await recalcBudget(c, params.id, body.globalDiscount);
      if (body.validUntil !== undefined) await c.query("UPDATE budgets SET valid_until = $2 WHERE id = $1", [params.id, body.validUntil ?? null]);
      const after = (await c.query("SELECT discount_cents, global_discount_percent, valid_until FROM budgets WHERE id = $1", [params.id])).rows[0];
      await audit(c, auth, "budget.terms_changed", "budget", params.id, { before, after }, b.branch_id);
      return { ok: true, globalDiscountCents: Number(after.discount_cents) };
    },
  });

  // ---------------- Sesiones (R2-09) ----------------
  const zTemplate = z.array(z.object({ name: z.string().trim().min(2, "Nombre de la sesión muy corto").max(120), amountCents: zMoney })).max(20, "Máximo 20 sesiones");

  route({
    method: "GET", url: "/api/procedure-sessions", summary: "Plantillas de sesiones de las prestaciones del catálogo", tags: ["clínica"],
    handler: async ({ c }) => (await c.query(
      `SELECT id AS "procedureId", price_cents AS "priceCents", session_template AS sessions FROM procedures WHERE session_template IS NOT NULL ORDER BY code`)).rows,
  });

  route({
    method: "PUT", url: "/api/procedures/:id/sessions", summary: "Definir la plantilla de sesiones (la suma debe ser igual al precio). Lista vacía = sin sesiones", tags: ["clínica"],
    perm: "clinic.manage", params: zIdParams, body: z.object({ sessions: zTemplate }),
    handler: async ({ c, auth, params, body }) => {
      const p = (await c.query<{ price_cents: number; session_template: unknown }>("SELECT price_cents, session_template FROM procedures WHERE id = $1 FOR UPDATE", [params.id])).rows[0];
      if (!p) throw notFound("Prestación");
      if (body.sessions.length === 1) throw badRequest("Una prestación de varias sesiones necesita al menos 2 sesiones");
      const sum = body.sessions.reduce((s, x) => s + x.amountCents, 0);
      if (body.sessions.length && sum !== Number(p.price_cents)) {
        throw new AppError(400, "sessions_sum_mismatch", `La suma de las sesiones (${bsTxt(sum)}) debe ser igual al precio de la prestación (${bsTxt(Number(p.price_cents))})`);
      }
      const value = body.sessions.length ? JSON.stringify(body.sessions) : null;
      await c.query("UPDATE procedures SET session_template = $2 WHERE id = $1", [params.id, value]);
      await audit(c, auth, "procedure.sessions_changed", "procedure", params.id, { before: p.session_template, after: body.sessions });
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/budget-item-sessions/:id/perform", summary: "Marcar una sesión como realizada: genera su cargo atribuido al profesional que la hizo", tags: ["presupuestos"],
    perm: "treatments.perform", params: zIdParams,
    body: z.object({ dentistId: zId.nullish(), appointmentId: zId.nullish(), note: zOptText(500) }),
    handler: async ({ c, auth, params, body }) => {
      const s = (await c.query<{ branch_id: string }>(
        `SELECT b.branch_id FROM budget_item_sessions s JOIN budget_items i ON i.id = s.budget_item_id JOIN budgets b ON b.id = i.budget_id WHERE s.id = $1`, [params.id])).rows[0];
      if (!s) throw notFound("Sesión");
      requireBranch(auth, s.branch_id);
      const dentistId = body.dentistId ?? auth.userId;
      if (dentistId !== auth.userId) {
        const m = (await c.query("SELECT 1 FROM memberships WHERE clinic_id = app_clinic_id() AND user_id = $1 AND active AND (role = 'dentist' OR is_professional)", [dentistId])).rowCount;
        if (!m) throw badRequest("El profesional indicado no atiende en esta clínica");
      }
      const r = await performSession(c, auth, params.id, { dentistId, appointmentId: body.appointmentId ?? null, note: body.note });
      await consumeForTreatment(c, auth, { budgetItemId: r.itemId, appointmentId: body.appointmentId ?? null, when: r.itemDone }); // inventario al completar la línea
      await audit(c, auth, "treatment.session_performed", "budget_item", r.itemId, { sessionId: params.id, chargeId: r.chargeId, amountCents: r.amountCents, dentistId, itemDone: r.itemDone }, r.branchId);
      return { ok: true, chargeId: r.chargeId, itemDone: r.itemDone };
    },
  });

  // ---------------- Versiones (R2-13) ----------------
  route({
    method: "POST", url: "/api/budgets/:id/versions", summary: "Crear una nueva versión (borrador con las mismas líneas); la anterior queda reemplazada y ya no se puede aceptar ni cobrar",
    tags: ["presupuestos"], perm: "budgets.write", params: zIdParams,
    body: z.object({ confirm: z.literal(true, { message: "Confirma que la versión actual quedará reemplazada" }) }),
    handler: async ({ c, auth, params }) => {
      const old = await lockBudget(c, auth, params.id);
      if (old.status === "superseded") throw conflict("Esta versión ya fue reemplazada; crea la nueva versión desde la vigente", "budget_superseded");
      if (old.status === "cancelled" || old.status === "completed") throw conflict(`Un presupuesto ${old.status === "cancelled" ? "anulado" : "completado"} no admite versiones: crea un presupuesto nuevo`, "invalid_status");
      const performed = await c.query(
        `SELECT 1 FROM budget_items i WHERE i.budget_id = $1 AND (i.status = 'done'
            OR EXISTS (SELECT 1 FROM budget_item_sessions s WHERE s.budget_item_id = i.id AND s.status = 'done')
            OR EXISTS (SELECT 1 FROM charges ch WHERE ch.budget_item_id = i.id))`, [params.id]);
      if (performed.rowCount) throw conflict("Este presupuesto ya tiene tratamientos realizados: para cambiarlo crea un presupuesto nuevo con lo que falta", "has_performed");
      const paid = await c.query("SELECT 1 FROM payments WHERE budget_id = $1 AND status IN ('confirmed','pending_verification')", [params.id]);
      if (paid.rowCount) throw conflict("Este presupuesto tiene pagos registrados: crea un presupuesto nuevo o anula los pagos antes", "has_payments");
      await c.query("UPDATE budgets SET status = 'superseded', superseded_at = now() WHERE id = $1", [params.id]);
      const nb = (await c.query<{ id: string; version: number }>(
        `INSERT INTO budgets (clinic_id, number, version, branch_id, patient_id, dentist_id, installments, notes, discount_cents, global_discount_percent, supersedes_id, created_by)
         SELECT clinic_id, number, version + 1, branch_id, patient_id, dentist_id, installments, notes, discount_cents, global_discount_percent, id, $2
           FROM budgets WHERE id = $1 RETURNING id, version`, [params.id, auth.userId])).rows[0]!;
      const items = (await c.query<{ id: string }>("SELECT id FROM budget_items WHERE budget_id = $1 AND status <> 'cancelled' ORDER BY position, id", [params.id])).rows;
      for (const it of items) {
        const ni = (await c.query<{ id: string }>(
          `INSERT INTO budget_items (clinic_id, budget_id, procedure_id, tooth, surfaces, description, quantity, unit_price_cents, discount_cents, discount_percent, position, ${AGREEMENT_INSERT_COLS})
           SELECT clinic_id, $2, procedure_id, tooth, surfaces, description, quantity, unit_price_cents, discount_cents, discount_percent, position, ${AGREEMENT_INSERT_COLS}
             FROM budget_items WHERE id = $1 RETURNING id`, [it.id, nb.id])).rows[0]!.id;
        await c.query(
          `INSERT INTO budget_item_sessions (clinic_id, budget_item_id, position, name, weight_cents, amount_cents)
           SELECT clinic_id, $2, position, name, weight_cents, 0 FROM budget_item_sessions WHERE budget_item_id = $1`, [it.id, ni]);
      }
      await recalcBudget(c, nb.id);
      await event(c, auth.clinicId!, nb.id, "version_created", { actor: auth.userId, data: { fromBudgetId: params.id, fromVersion: old.version } });
      await audit(c, auth, "budget.version_created", "budget", nb.id, { number: old.number, version: nb.version, supersedes: params.id }, old.branch_id);
      return { id: nb.id, number: old.number, version: nb.version };
    },
  });

  route({
    method: "GET", url: "/api/budgets/:id/versions", summary: "Historial de versiones con diferencias de líneas y totales", tags: ["presupuestos"], perm: "budgets.read", params: zIdParams,
    handler: async ({ c, params }) => {
      const num = (await c.query<{ number: number }>("SELECT number FROM budgets WHERE id = $1", [params.id])).rows[0];
      if (!num) throw notFound("Presupuesto");
      const vs = (await c.query(
        `SELECT b.id, b.version, b.status, b.created_at AS "createdAt", b.presented_at AS "presentedAt", b.superseded_at AS "supersededAt", u.full_name AS "createdByName"
           FROM budgets b LEFT JOIN users u ON u.id = b.created_by WHERE b.number = $1 ORDER BY b.version`, [num.number])).rows;
      const items = (await c.query(
        `SELECT i.budget_id AS "budgetId", i.procedure_id AS "procedureId", i.description, i.tooth, i.surfaces, i.quantity, i.net_cents AS "netCents"
           FROM budget_items i JOIN budgets b ON b.id = i.budget_id WHERE b.number = $1 AND i.status <> 'cancelled' ORDER BY i.position`, [num.number])).rows;
      const key = (i: any) => `${i.procedureId}|${i.tooth ?? ""}|${[...i.surfaces].sort().join("")}`;
      const label = (i: any) => `${i.description}${i.tooth ? ` (pieza ${i.tooth})` : ""}`;
      let prev: any[] | null = null;
      return vs.map((v) => {
        const mine = items.filter((i) => i.budgetId === v.id);
        const totalCents = mine.reduce((s, i) => s + Number(i.netCents), 0);
        const changes: { kind: "added" | "removed" | "changed"; label: string; fromCents?: number; toCents?: number }[] = [];
        if (prev) {
          for (const i of mine) {
            const p = prev.find((x) => key(x) === key(i));
            if (!p) changes.push({ kind: "added", label: label(i), toCents: Number(i.netCents) });
            else if (Number(p.netCents) !== Number(i.netCents) || p.quantity !== i.quantity) changes.push({ kind: "changed", label: label(i), fromCents: Number(p.netCents), toCents: Number(i.netCents) });
          }
          for (const p of prev) if (!mine.some((i) => key(i) === key(p))) changes.push({ kind: "removed", label: label(p), fromCents: Number(p.netCents) });
        }
        const prevTotal = prev ? prev.reduce((s, i) => s + Number(i.netCents), 0) : null;
        prev = mine;
        return { ...v, totalCents, lines: mine.length, previousTotalCents: prevTotal, changes };
      });
    },
  });

  // ---------------- Enlace público, entrega y seguimiento (R2-14, R2-15, R2-16) ----------------
  route({
    method: "POST", url: "/api/budgets/:id/share-links", summary: "Crear un enlace para el paciente (vence en 30 días). Un borrador pasa a presentado. Devuelve el enlace una sola vez",
    tags: ["presupuestos"], perm: "budgets.write", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const b = await lockBudget(c, auth, params.id);
      if (b.status === "superseded") throw conflict("Esta versión fue reemplazada: comparte la versión vigente", "budget_superseded");
      if (!["draft", "presented", "accepted", "completed"].includes(b.status)) throw conflict("Solo se comparten presupuestos en borrador, presentados o aceptados", "invalid_status");
      const p = (await c.query<{ first_name: string; phone: string | null; guardian_phone: string | null; birth_date: string | null; consent_reminders: boolean; clinic: string }>(
        `SELECT p.first_name, p.phone, p.guardian_phone, p.birth_date, p.consent_reminders, cl.name AS clinic
           FROM patients p JOIN clinics cl ON cl.id = p.clinic_id WHERE p.id = $1`, [b.patient_id])).rows[0]!;
      const digits = (x: string | null) => String(x ?? "").replace(/\D/g, "");
      if (digits(p.phone).length < 4 && digits(p.guardian_phone).length < 4 && !p.birth_date) {
        throw new AppError(409, "no_verification_data", "El paciente no tiene celular ni fecha de nacimiento registrados. Agrega uno en su ficha para que pueda verificar su identidad.");
      }
      await presentIfDraft(c, auth, b, "enlace");
      const token = randomBytes(32).toString("base64url");
      const link = (await c.query<{ id: string; expires_at: Date }>(
        `INSERT INTO budget_share_links (clinic_id, budget_id, token_hash, created_by, expires_at) VALUES ($1,$2,$3,$4, now() + make_interval(days => $5)) RETURNING id, expires_at`,
        [auth.clinicId, params.id, sha256(token), auth.userId, LINK_DAYS])).rows[0]!;
      await event(c, auth.clinicId!, params.id, "link_created", { linkId: link.id, channel: "link", actor: auth.userId });
      await audit(c, auth, "budget.link_created", "budget", params.id, { linkId: link.id, expiresAt: link.expires_at }, b.branch_id);
      const url = linkUrl(token);
      const phone = waPhone(p.phone ?? p.guardian_phone);
      // Mensaje sin datos clínicos ni montos: solo el número de presupuesto y el enlace.
      const message = `Hola ${p.first_name}, ${p.clinic} te comparte tu presupuesto N° ${b.number}. Puedes revisarlo y responder aquí: ${url} — Por tu seguridad te pediremos un dato para confirmar tu identidad.`;
      const canWhatsapp = p.consent_reminders && !!phone;
      return {
        linkId: link.id, url, expiresAt: link.expires_at, message,
        whatsappUrl: canWhatsapp ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}` : null,
        whatsappBlockedReason: canWhatsapp ? null : !p.consent_reminders ? "El paciente no autorizó mensajes por WhatsApp: copia el enlace y entrégalo por otro medio" : "El paciente no tiene celular registrado",
      };
    },
  });

  route({
    method: "POST", url: "/api/budget-share-links/:id/revoke", summary: "Revocar un enlace del paciente", tags: ["presupuestos"], perm: "budgets.write", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const l = (await c.query<{ budget_id: string; revoked_at: Date | null; branch_id: string }>(
        "SELECT l.budget_id, l.revoked_at, b.branch_id FROM budget_share_links l JOIN budgets b ON b.id = l.budget_id WHERE l.id = $1 FOR UPDATE OF l", [params.id])).rows[0];
      if (!l) throw notFound("Enlace");
      requireBranch(auth, l.branch_id);
      if (l.revoked_at) throw conflict("Ese enlace ya estaba revocado", "already_revoked");
      await c.query("UPDATE budget_share_links SET revoked_at = now(), revoked_by = $2 WHERE id = $1", [params.id, auth.userId]);
      await event(c, auth.clinicId!, l.budget_id, "link_revoked", { linkId: params.id, actor: auth.userId });
      await audit(c, auth, "budget.link_revoked", "budget", l.budget_id, { linkId: params.id }, l.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/budgets/:id/delivered", summary: "Registrar la entrega del presupuesto en mano o impreso (sin enviar mensajes). Un borrador pasa a presentado",
    tags: ["presupuestos"], perm: "budgets.write", params: zIdParams, body: z.object({ note: zOptText(300) }),
    handler: async ({ c, auth, params, body }) => {
      const b = await lockBudget(c, auth, params.id);
      if (!["draft", "presented"].includes(b.status)) throw conflict("Solo se entregan presupuestos en borrador o presentados", "invalid_status");
      await presentIfDraft(c, auth, b, "en mano");
      await event(c, auth.clinicId!, params.id, "delivered", { channel: "in_hand", actor: auth.userId, reason: body.note });
      await audit(c, auth, "budget.delivered", "budget", params.id, { channel: "in_hand", note: body.note }, b.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/budgets/:id/events", summary: "Registrar seguimiento de recepción (llamada, WhatsApp, en persona) o la apertura del WhatsApp",
    tags: ["presupuestos"], perm: "budgets.write", params: zIdParams,
    body: z.object({ kind: z.enum(["follow_up", "whatsapp_opened"]), channel: z.enum(["phone", "whatsapp", "in_person", "other"]).nullish(), note: zOptText(500), linkId: zId.nullish() }),
    handler: async ({ c, auth, params, body }) => {
      const b = await lockBudget(c, auth, params.id);
      if (body.kind === "follow_up" && !body.channel) throw badRequest("Indica por qué medio contactaste al paciente");
      if (body.linkId && !(await c.query("SELECT 1 FROM budget_share_links WHERE id = $1 AND budget_id = $2", [body.linkId, params.id])).rowCount) throw badRequest("Enlace inválido");
      await event(c, auth.clinicId!, params.id, body.kind, { channel: body.kind === "whatsapp_opened" ? "whatsapp" : body.channel, actor: auth.userId, reason: body.note, linkId: body.linkId ?? null });
      await audit(c, auth, `budget.${body.kind}`, "budget", params.id, { channel: body.channel, note: body.note }, b.branch_id);
      return { ok: true };
    },
  });

  route({
    method: "GET", url: "/api/budgets/:id/activity", summary: "Enlaces y eventos del presupuesto (visto, aceptado, rechazado, entregado, seguimientos)", tags: ["presupuestos"],
    perm: "budgets.read", params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const b = (await c.query<{ branch_id: string }>("SELECT branch_id FROM budgets WHERE id = $1", [params.id])).rows[0];
      if (!b) throw notFound("Presupuesto");
      requireBranch(auth, b.branch_id);
      const links = (await c.query(
        `SELECT l.id, l.created_at AS "createdAt", l.expires_at AS "expiresAt", l.revoked_at AS "revokedAt", l.locked_at AS "lockedAt", l.failed_attempts AS "failedAttempts",
                u.full_name AS "createdByName",
                (SELECT count(*)::int FROM budget_events e WHERE e.link_id = l.id AND e.kind = 'viewed') AS views,
                CASE WHEN l.revoked_at IS NOT NULL THEN 'revoked' WHEN l.locked_at IS NOT NULL THEN 'locked' WHEN l.expires_at < now() THEN 'expired' ELSE 'active' END AS state
           FROM budget_share_links l JOIN users u ON u.id = l.created_by WHERE l.budget_id = $1 ORDER BY l.created_at DESC`, [params.id])).rows;
      const events = (await c.query(
        `SELECT e.id, e.kind, e.channel, e.created_at AS "createdAt", e.signer_name AS "signerName", e.signer_relationship AS "signerRelationship",
                e.reason, e.content_hash AS "contentHash", e.signature_png AS "signaturePng", u.full_name AS "actorName", e.link_id AS "linkId"
           FROM budget_events e LEFT JOIN users u ON u.id = e.actor_user_id WHERE e.budget_id = $1 ORDER BY e.created_at DESC LIMIT 200`, [params.id])).rows;
      return { links, events };
    },
  });

  // ---------------- Embudo (R2-16) ----------------
  route({
    method: "GET", url: "/api/budget-settings", summary: "Validez por defecto de los presupuestos (días)", tags: ["presupuestos"], perm: "budgets.read",
    handler: async ({ c, auth }) => ({ validityDays: await validityDays(c, auth.clinicId!), followUpDays: [7, 14], linkDays: LINK_DAYS, maxAttempts: MAX_ATTEMPTS }),
  });

  route({
    method: "PUT", url: "/api/budget-settings", summary: "Cambiar la validez por defecto de los presupuestos (7 a 180 días)", tags: ["presupuestos"], perm: "clinic.manage",
    body: z.object({ validityDays: z.number().int().min(7, "Mínimo 7 días").max(180, "Máximo 180 días") }),
    handler: async ({ c, auth, body }) => {
      const before = await validityDays(c, auth.clinicId!);
      await c.query("UPDATE clinics SET settings = jsonb_set(settings, '{budgetValidityDays}', to_jsonb($2::int)) WHERE id = $1", [auth.clinicId, body.validityDays]);
      await audit(c, auth, "clinic.budget_validity_changed", "clinic", auth.clinicId, { before, after: body.validityDays });
      return { validityDays: body.validityDays };
    },
  });

  route({
    method: "GET", url: "/api/budget-funnel", summary: "Embudo de presupuestos: bandejas con días en el estado, seguimiento a 7 y 14 días y conversión", tags: ["presupuestos"],
    perm: "budgets.read", query: z.object({ branchId: zId.optional(), days: z.coerce.number().int().min(7).max(365).default(90) }),
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const zone = (await c.query<{ timezone: string }>("SELECT timezone FROM clinics WHERE id = $1", [auth.clinicId])).rows[0]!.timezone;
      const vDays = await validityDays(c, auth.clinicId!);
      const rows = (await c.query(
        `SELECT b.id, b.number, b.version, b.status, b.patient_id AS "patientId", p.first_name || ' ' || p.last_name AS "patientName", p.phone,
                br.name AS "branchName", u.full_name AS "dentistName", b.presented_at AS "presentedAt", b.decided_at AS "decidedAt",
                COALESCE(b.valid_until, (b.presented_at AT TIME ZONE $3)::date + $4::int)::text AS "validDate",
                COALESCE((SELECT sum(net_cents) FROM budget_items i WHERE i.budget_id = b.id AND i.status <> 'cancelled'),0) AS "totalCents",
                (SELECT min(a.starts_at) FROM appointments a WHERE a.patient_id = b.patient_id AND a.starts_at > now() AND a.status IN ('scheduled','confirmed')) AS "nextAppointment",
                GREATEST((SELECT max(i.performed_at) FROM budget_items i WHERE i.budget_id = b.id),
                         (SELECT max(s.performed_at) FROM budget_item_sessions s JOIN budget_items i ON i.id = s.budget_item_id WHERE i.budget_id = b.id)) AS "lastPerformedAt",
                EXISTS (SELECT 1 FROM charges ch JOIN budget_items i ON i.id = ch.budget_item_id WHERE i.budget_id = b.id) AS started,
                (SELECT min(e.created_at) FROM budget_events e WHERE e.budget_id = b.id AND e.kind = 'viewed') AS "firstViewedAt",
                (SELECT max(e.created_at) FROM budget_events e WHERE e.budget_id = b.id AND e.kind = 'follow_up') AS "lastFollowUpAt",
                (SELECT count(*)::int FROM budget_events e WHERE e.budget_id = b.id AND e.kind = 'follow_up') AS "followUps"
           FROM budgets b JOIN patients p ON p.id = b.patient_id JOIN branches br ON br.id = b.branch_id JOIN users u ON u.id = b.dentist_id
          WHERE b.status IN ('presented','accepted') AND ($1::uuid[] IS NULL OR b.branch_id = ANY($1)) AND ($2::uuid IS NULL OR b.branch_id = $2)
          ORDER BY b.presented_at NULLS LAST`,
        [allowedBranches(auth), query.branchId ?? null, zone, vDays])).rows;
      const now = Date.now();
      const today = DateTime.now().setZone(zone).startOf("day");
      const daysSince = (d: Date | null) => (d ? Math.max(0, Math.floor((now - +new Date(d)) / 86_400_000)) : 0);
      const presentedNoResponse: any[] = [], acceptedNoAppointment: any[] = [], inProgressNoNext: any[] = [], expired: any[] = [];
      for (const r of rows) {
        const base = { ...r, totalCents: Number(r.totalCents) };
        if (r.status === "presented") {
          const valid = DateTime.fromISO(r.validDate, { zone });
          if (valid < today) { expired.push({ ...base, daysInState: Math.floor(today.diff(valid, "days").days) }); continue; }
          const days = daysSince(r.presentedAt);
          const since = (d: number) => new Date(+new Date(r.presentedAt) + d * 86_400_000);
          const due = (d: number) => days >= d && (!r.lastFollowUpAt || new Date(r.lastFollowUpAt) < since(d));
          presentedNoResponse.push({ ...base, daysInState: days, followUpDue: due(14) ? 14 : due(7) ? 7 : null });
        } else if (!r.nextAppointment) {
          if (r.started) inProgressNoNext.push({ ...base, daysInState: daysSince(r.lastPerformedAt ?? r.decidedAt) });
          else acceptedNoAppointment.push({ ...base, daysInState: daysSince(r.decidedAt) });
        }
      }
      const sortDays = (a: any[]) => a.sort((x, y) => y.daysInState - x.daysInState);
      const conv = (await c.query(
        `SELECT count(*)::int AS presented,
                count(*) FILTER (WHERE b.status IN ('accepted','completed'))::int AS accepted,
                count(*) FILTER (WHERE b.status = 'rejected')::int AS rejected,
                count(*) FILTER (WHERE b.status = 'presented')::int AS open,
                COALESCE(sum(t.total),0)::bigint AS "presentedCents",
                COALESCE(sum(t.total) FILTER (WHERE b.status IN ('accepted','completed')),0)::bigint AS "acceptedCents",
                count(*) FILTER (WHERE EXISTS (SELECT 1 FROM budget_events e WHERE e.budget_id = b.id AND e.kind = 'accepted'))::int AS "acceptedOnline"
           FROM budgets b CROSS JOIN LATERAL (SELECT COALESCE(sum(net_cents),0) AS total FROM budget_items i WHERE i.budget_id = b.id AND i.status <> 'cancelled') t
          WHERE b.status IN ('presented','accepted','completed','rejected') AND b.presented_at >= now() - make_interval(days => $3)
            AND ($1::uuid[] IS NULL OR b.branch_id = ANY($1)) AND ($2::uuid IS NULL OR b.branch_id = $2)`,
        [allowedBranches(auth), query.branchId ?? null, query.days])).rows[0]!;
      return {
        validityDays: vDays, periodDays: query.days,
        buckets: {
          presentedNoResponse: sortDays(presentedNoResponse), acceptedNoAppointment: sortDays(acceptedNoAppointment),
          inProgressNoNext: sortDays(inProgressNoNext), expired: sortDays(expired),
        },
        conversion: { ...conv, presentedCents: Number(conv.presentedCents), acceptedCents: Number(conv.acceptedCents), conversionPct: conv.presented ? Math.round((conv.accepted / conv.presented) * 1000) / 10 : null },
      };
    },
  });

  // =====================================================================
  // Página pública del paciente (sin sesión). Nada se muestra antes de verificar.
  // =====================================================================
  const tokenParams = z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{40,64}$/, "Enlace inválido") });
  const INVALID = { code: "link_invalid", message: "Este enlace no es válido o ya venció. Pide uno nuevo a tu clínica." };
  const LOCKED = { code: "link_locked", message: "Por seguridad este enlace se bloqueó tras varios intentos. Pide a tu clínica un enlace nuevo." };

  interface LinkRow { id: string; clinic_id: string; budget_id: string; expires_at: Date; revoked_at: Date | null; locked_at: Date | null; failed_attempts: number }

  /** Resuelve el enlace (fija la clínica para RLS) o devuelve null si no es utilizable. */
  async function openLink(c: Client, token: string): Promise<LinkRow | null> {
    const hash = sha256(token);
    const clinicId = (await c.query<{ id: string | null }>("SELECT budget_link_clinic($1) AS id", [hash])).rows[0]?.id;
    if (!clinicId) return null;
    await c.query("SELECT set_config('app.clinic_id', $1, true)", [clinicId]);
    const l = (await c.query<LinkRow>(
      "SELECT id, clinic_id, budget_id, expires_at, revoked_at, locked_at, failed_attempts FROM budget_share_links WHERE token_hash = $1 FOR UPDATE", [hash])).rows[0];
    if (!l || l.revoked_at || +new Date(l.expires_at) < Date.now()) return null;
    return l;
  }

  const fail = (reply: any, status: number, err: { code: string; message: string }, details?: unknown) => {
    reply.code(status);
    return { error: { ...err, details } };
  };

  async function publicView(c: Client, l: LinkRow) {
    const b = (await c.query(
      `SELECT b.id, b.number, b.version, b.status, b.installments, b.notes, b.valid_until::text AS "validUntil", b.presented_at AS "presentedAt", b.decided_at AS "decidedAt",
              b.discount_cents AS "globalDiscountCents", b.global_discount_percent AS "globalDiscountPercent", b.branch_id AS "branchId",
              cl.name AS "clinicName", cl.timezone, br.name AS "branchName", br.address, br.city, br.phone AS "branchPhone", p.first_name AS "patientFirstName"
         FROM budgets b JOIN clinics cl ON cl.id = b.clinic_id JOIN branches br ON br.id = b.branch_id JOIN patients p ON p.id = b.patient_id
        WHERE b.id = $1`, [l.budget_id])).rows[0];
    const phone = waPhone(b.branchPhone);
    const contact = {
      clinicName: b.clinicName, branchName: b.branchName, address: b.address, city: b.city, phone: b.branchPhone,
      whatsappUrl: phone ? `https://wa.me/${phone}?text=${encodeURIComponent(`Hola, tengo una consulta sobre mi presupuesto N° ${b.number}.`)}` : null,
    };
    const vDays = await validityDays(c, l.clinic_id);
    const validDate = b.validUntil ?? (b.presentedAt ? DateTime.fromJSDate(new Date(b.presentedAt), { zone: b.timezone }).plus({ days: vDays }).toISODate() : null);
    const today = DateTime.now().setZone(b.timezone).toISODate()!;
    const state =
      b.status === "superseded" ? "superseded" : b.status === "draft" ? "updating" : b.status === "cancelled" ? "cancelled"
        : b.status === "accepted" || b.status === "completed" ? "accepted" : b.status === "rejected" ? "rejected"
          : validDate && validDate < today ? "expired" : "open";
    if (["superseded", "updating", "cancelled"].includes(state)) return { state, number: b.number, version: b.version, contact };
    const items = (await c.query(
      `SELECT description, tooth, surfaces, quantity, unit_price_cents * quantity AS "grossCents", discount_cents AS "lineDiscountCents", discount_percent AS "discountPercent",
              global_discount_cents AS "globalDiscountCents", net_cents AS "netCents"
         FROM budget_items WHERE budget_id = $1 AND status <> 'cancelled' ORDER BY position, id`, [l.budget_id])).rows
      .map((i) => ({ ...i, grossCents: Number(i.grossCents), netCents: Number(i.netCents), lineDiscountCents: Number(i.lineDiscountCents), globalDiscountCents: Number(i.globalDiscountCents) }));
    const totalCents = items.reduce((s, i) => s + i.netCents, 0);
    const subtotalCents = items.reduce((s, i) => s + i.grossCents, 0);
    const decision = (await c.query(
      `SELECT kind, signer_name AS "signerName", signer_relationship AS "signerRelationship", created_at AS "at" FROM budget_events
        WHERE budget_id = $1 AND kind IN ('accepted','rejected') ORDER BY created_at DESC LIMIT 1`, [l.budget_id])).rows[0] ?? null;
    return {
      state, number: b.number, version: b.version, patientFirstName: b.patientFirstName, contact,
      presentedAt: b.presentedAt, validUntil: validDate, notes: b.notes,
      items, subtotalCents, discountCents: subtotalCents - totalCents, totalCents,
      installments: b.installments, installmentPlan: installmentPlan(totalCents, b.installments),
      decision: decision ?? (b.decidedAt && state !== "open" ? { kind: state, at: b.decidedAt } : null),
    };
  }

  const verifyBody = z.union([
    z.object({ method: z.literal("phone"), phoneLast4: z.string().regex(/^\d{4}$/, "Escribe los 4 últimos dígitos") }),
    z.object({ method: z.literal("birthDate"), birthDate: zDate }),
  ]);

  route({
    method: "POST", url: "/api/public/budget-links/:token/verify", access: "public", limit: { max: 20, timeWindow: "1 minute" },
    summary: "Paciente: verificar identidad (4 últimos dígitos del celular o fecha de nacimiento). 5 intentos fallidos bloquean el enlace",
    tags: ["público"], params: tokenParams, body: verifyBody,
    handler: async ({ c, params, body, reply, req }) => {
      const l = await openLink(c, params.token);
      if (!l) return fail(reply, 404, INVALID);
      if (l.locked_at) return fail(reply, 423, LOCKED);
      // R2-39: el tutor legal declarado también puede verificar con su celular (y aceptar como tutor).
      const p = (await c.query<{ phone: string | null; guardian_phone: string | null; birth_date: string | null; tutor_phones: string[] }>(
        `SELECT p.phone, p.guardian_phone, p.birth_date::text AS birth_date,
                ARRAY(SELECT g.phone FROM patient_relationships r JOIN patients g ON g.id = r.person_a
                       WHERE r.person_b = p.id AND r.legal_guardian AND r.ended_at IS NULL AND g.phone IS NOT NULL) AS tutor_phones
           FROM budgets b JOIN patients p ON p.id = b.patient_id WHERE b.id = $1`, [l.budget_id])).rows[0]!;
      const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
      const last4 = (x: string | null) => String(x ?? "").replace(/\D/g, "").slice(-4);
      const ok = body.method === "phone"
        ? [p.phone, p.guardian_phone, ...p.tutor_phones].some((x) => last4(x).length === 4 && eq(last4(x), body.phoneLast4))
        : !!p.birth_date && eq(p.birth_date, body.birthDate);
      const uaHash = sha256hex(String(req.headers["user-agent"] ?? ""));
      if (!ok) {
        const n = l.failed_attempts + 1;
        await c.query("UPDATE budget_share_links SET failed_attempts = $2::int, locked_at = CASE WHEN $2::int >= $3::int THEN now() ELSE locked_at END WHERE id = $1", [l.id, n, MAX_ATTEMPTS]);
        await event(c, l.clinic_id, l.budget_id, "verify_failed", { linkId: l.id, uaHash, data: { method: body.method, attempt: n } });
        if (n >= MAX_ATTEMPTS) {
          await event(c, l.clinic_id, l.budget_id, "link_locked", { linkId: l.id, uaHash });
          return fail(reply, 423, LOCKED);
        }
        const left = MAX_ATTEMPTS - n;
        return fail(reply, 401, { code: "verification_failed", message: `El dato no coincide. Te quedan ${left} ${left === 1 ? "intento" : "intentos"}.` }, { attemptsLeft: left });
      }
      if (l.failed_attempts) await c.query("UPDATE budget_share_links SET failed_attempts = 0 WHERE id = $1", [l.id]);
      await event(c, l.clinic_id, l.budget_id, "viewed", { linkId: l.id, uaHash, data: { method: body.method } });
      return { access: issueGrant(l.id), budget: await publicView(c, l) };
    },
  });

  const withAccess = <T extends z.ZodRawShape>(shape: T) => z.object({ access: z.string().min(10).max(200), ...shape });

  async function authorized(c: Client, token: string, access: string, reply: any): Promise<LinkRow | { error: unknown }> {
    const l = await openLink(c, token);
    if (!l) return fail(reply, 404, INVALID);
    if (l.locked_at) return fail(reply, 423, LOCKED);
    if (!checkGrant(l.id, access)) return fail(reply, 401, { code: "verification_required", message: "Vuelve a verificar tu identidad para continuar." });
    return l;
  }

  route({
    method: "POST", url: "/api/public/budget-links/:token/view", access: "public", limit: { max: 60, timeWindow: "1 minute" },
    summary: "Paciente: ver el presupuesto (requiere haber verificado)", tags: ["público"], params: tokenParams, body: withAccess({}),
    handler: async ({ c, params, body, reply }) => {
      const l = await authorized(c, params.token, body.access, reply);
      if ("error" in l) return l;
      return { budget: await publicView(c, l) };
    },
  });

  /** Bloquea el presupuesto y comprueba que se pueda decidir (solo la versión vigente, presentada y no vencida). */
  async function decidable(c: Client, l: LinkRow) {
    const b = (await c.query<{ status: string; branch_id: string; total: number }>(
      `SELECT status, branch_id, COALESCE((SELECT sum(net_cents) FROM budget_items i WHERE i.budget_id = b.id AND i.status <> 'cancelled'),0) AS total
         FROM budgets b WHERE id = $1 FOR UPDATE`, [l.budget_id])).rows[0]!;
    const view = await publicView(c, l);
    if (view.state === "superseded") throw conflict("Hay una versión más reciente de este presupuesto. Pide a tu clínica el enlace nuevo.", "budget_superseded");
    if (view.state === "accepted") throw conflict("Ya aceptaste este presupuesto. La clínica te contactará para agendar.", "already_decided");
    if (view.state === "rejected") throw conflict("Ya respondiste a este presupuesto. Si cambiaste de opinión, escribe a la clínica.", "already_decided");
    if (view.state === "expired") throw conflict("Este presupuesto venció. Escribe a la clínica para que te envíe uno actualizado.", "budget_expired");
    if (view.state !== "open") throw conflict("Este presupuesto no está disponible para responder. Escribe a la clínica.", "invalid_status");
    return { b, view };
  }

  route({
    method: "POST", url: "/api/public/budget-links/:token/accept", access: "public", limit: { max: 10, timeWindow: "1 minute" },
    summary: "Paciente: aceptar el presupuesto con nombre, relación, casilla de conformidad y firma opcional", tags: ["público"], params: tokenParams,
    body: withAccess({
      signerName: z.string().trim().min(3, "Escribe tu nombre completo").max(120),
      relationship: z.enum(["patient", "guardian"], { message: "Indica si eres el paciente o su madre, padre o tutor" }),
      agree: z.literal(true, { message: "Marca la casilla de conformidad para aceptar" }),
      signaturePng: z.string().max(400_000, "La firma es demasiado grande").regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/, "Firma inválida").nullish(),
    }),
    handler: async ({ c, params, body, reply, req }) => {
      const l = await authorized(c, params.token, body.access, reply);
      if ("error" in l) return l;
      const { b, view } = await decidable(c, l);
      const at = new Date().toISOString();
      const snapshot = {
        budgetId: l.budget_id, number: view.number, version: view.version, totalCents: view.totalCents,
        items: (view.items ?? []).map((i: any) => ({ description: i.description, tooth: i.tooth, quantity: i.quantity, grossCents: i.grossCents, netCents: i.netCents })),
        installments: view.installments, signerName: body.signerName, relationship: body.relationship, acceptedAt: at,
        signatureSha256: body.signaturePng ? sha256hex(body.signaturePng) : null,
      };
      const contentHash = sha256hex(JSON.stringify(snapshot));
      await c.query(
        "UPDATE budgets SET status = 'accepted', decided_at = now(), decided_note = 'Aceptado por el paciente en línea' WHERE id = $1", [l.budget_id]);
      await event(c, l.clinic_id, l.budget_id, "accepted", {
        linkId: l.id, channel: "link", signerName: body.signerName, signerRelationship: body.relationship, signaturePng: body.signaturePng ?? null,
        uaHash: sha256hex(String(req.headers["user-agent"] ?? "")), contentHash, data: { snapshot },
      });
      await auditPublic(c, l.clinic_id, "budget.accepted_online", l.budget_id, { from: b.status, to: "accepted", totalCents: view.totalCents, signer: body.signerName, relationship: body.relationship, contentHash }, b.branch_id);
      return { ok: true, budget: await publicView(c, l) };
    },
  });

  route({
    method: "POST", url: "/api/public/budget-links/:token/reject", access: "public", limit: { max: 10, timeWindow: "1 minute" },
    summary: "Paciente: «No me interesa», con motivo opcional", tags: ["público"], params: tokenParams,
    body: withAccess({ reason: zOptText(500) }),
    handler: async ({ c, params, body, reply, req }) => {
      const l = await authorized(c, params.token, body.access, reply);
      if ("error" in l) return l;
      const { b } = await decidable(c, l);
      await c.query(
        "UPDATE budgets SET status = 'rejected', decided_at = now(), decided_note = $2 WHERE id = $1",
        [l.budget_id, `Rechazado por el paciente en línea${body.reason ? `: ${body.reason}` : ""}`]);
      await event(c, l.clinic_id, l.budget_id, "rejected", { linkId: l.id, channel: "link", reason: body.reason, uaHash: sha256hex(String(req.headers["user-agent"] ?? "")) });
      await auditPublic(c, l.clinic_id, "budget.rejected_online", l.budget_id, { from: b.status, to: "rejected", reason: body.reason }, b.branch_id);
      return { ok: true, budget: await publicView(c, l) };
    },
  });
}
