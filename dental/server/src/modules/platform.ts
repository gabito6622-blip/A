// Superadministrador SaaS: clínicas, planes y métricas AGREGADAS.
// Usa el pool de administración, pero ningún endpoint devuelve datos de pacientes ni clínicos.
import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Route } from "../lib/http.js";
import { zIdParams, zMoney } from "../lib/http.js";
import { badRequest, notFound } from "../lib/errors.js";
import { hashPassword } from "../lib/password.js";
import { seedCatalog } from "../lib/catalog.js";

export function platformRoutes(route: Route) {
  route({
    method: "GET", url: "/api/platform/plans", summary: "Planes comerciales", tags: ["plataforma"], access: "platform",
    handler: async ({ c }) =>
      (await c.query(`SELECT id, code, name, max_branches AS "maxBranches", max_users AS "maxUsers", max_patients AS "maxPatients", price_cents AS "priceCents", currency, features, active FROM plans ORDER BY price_cents`)).rows,
  });

  route({
    method: "POST", url: "/api/platform/plans", summary: "Crear plan", tags: ["plataforma"], access: "platform",
    body: z.object({ code: z.string().regex(/^[a-z0-9-]{2,30}$/), name: z.string().min(2).max(60), maxBranches: z.number().int().min(1).max(500), maxUsers: z.number().int().min(1).max(5000), maxPatients: z.number().int().min(1).nullish(), priceCents: zMoney }),
    handler: async ({ c, auth, body }) => {
      const r = await c.query<{ id: string }>(
        "INSERT INTO plans (code, name, max_branches, max_users, max_patients, price_cents) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id",
        [body.code, body.name, body.maxBranches, body.maxUsers, body.maxPatients ?? null, body.priceCents],
      );
      await c.query("INSERT INTO audit_log (user_id, action, entity, entity_id, data, ip) VALUES ($1,'platform.plan_created','plan',$2,$3,$4)", [auth.userId, r.rows[0]!.id, JSON.stringify(body), auth.ip]);
      return { id: r.rows[0]!.id };
    },
  });

  route({
    method: "GET", url: "/api/platform/clinics", summary: "Clínicas con métricas agregadas (sin datos clínicos)", tags: ["plataforma"], access: "platform",
    handler: async ({ c }) =>
      (
        await c.query(
          `SELECT cl.id, cl.slug, cl.name, cl.status, cl.created_at AS "createdAt", cl.trial_ends_at AS "trialEndsAt", p.name AS "planName",
                  p.max_branches AS "maxBranches", p.max_users AS "maxUsers",
                  (SELECT count(*) FROM branches b WHERE b.clinic_id = cl.id AND b.active)::int AS branches,
                  (SELECT count(*) FROM memberships m WHERE m.clinic_id = cl.id AND m.active)::int AS users,
                  (SELECT count(*) FROM patients pt WHERE pt.clinic_id = cl.id)::int AS patients,
                  (SELECT count(*) FROM appointments a WHERE a.clinic_id = cl.id AND a.starts_at > now() - interval '30 days')::int AS "appointments30d",
                  (SELECT max(s.last_seen_at) FROM sessions s WHERE s.clinic_id = cl.id) AS "lastActivityAt"
             FROM clinics cl LEFT JOIN plans p ON p.id = cl.plan_id ORDER BY cl.created_at DESC`,
        )
      ).rows,
  });

  route({
    method: "POST", url: "/api/platform/clinics", summary: "Crear clínica con su propietario (devuelve contraseña temporal)", tags: ["plataforma"], access: "platform",
    body: z.object({
      name: z.string().trim().min(2).max(120),
      slug: z.string().regex(/^[a-z0-9][a-z0-9-]{1,40}$/, "Solo minúsculas, números y guiones"),
      planCode: z.string(),
      ownerEmail: z.email().transform((e) => e.toLowerCase()),
      ownerName: z.string().trim().min(3).max(120),
      seedCatalog: z.boolean().default(true),
      trialDays: z.number().int().min(0).max(90).default(30),
    }),
    handler: async ({ c, auth, body }) => {
      const plan = (await c.query<{ id: string }>("SELECT id FROM plans WHERE code = $1 AND active", [body.planCode])).rows[0];
      if (!plan) throw badRequest("Plan inexistente");
      const clinicId = (await c.query<{ id: string }>(
        `INSERT INTO clinics (slug, name, plan_id, status, trial_ends_at) VALUES ($1,$2,$3,'trial', now() + make_interval(days => $4)) RETURNING id`,
        [body.slug, body.name, plan.id, body.trialDays],
      )).rows[0]!.id;
      let userId = (await c.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [body.ownerEmail])).rows[0]?.id;
      let temporaryPassword: string | null = null;
      if (!userId) {
        temporaryPassword = `Tmp-${randomBytes(6).toString("base64url")}7`;
        userId = (await c.query<{ id: string }>("INSERT INTO users (email, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id", [body.ownerEmail, body.ownerName, await hashPassword(temporaryPassword)])).rows[0]!.id;
      }
      await c.query("INSERT INTO memberships (clinic_id, user_id, role, all_branches) VALUES ($1,$2,'owner',true)", [clinicId, userId]);
      if (body.seedCatalog) await seedCatalog(c, clinicId);
      await c.query("INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, data, ip) VALUES ($1,$2,'platform.clinic_created','clinic',$1,$3,$4)",
        [clinicId, auth.userId, JSON.stringify({ slug: body.slug, plan: body.planCode }), auth.ip]);
      return { clinicId, ownerUserId: userId, temporaryPassword };
    },
  });

  route({
    method: "PATCH", url: "/api/platform/clinics/:id", summary: "Cambiar estado o plan de una clínica", tags: ["plataforma"], access: "platform", params: zIdParams,
    body: z.object({ status: z.enum(["trial", "active", "suspended", "cancelled"]).optional(), planCode: z.string().optional() }),
    handler: async ({ c, auth, params, body }) => {
      const planId = body.planCode ? (await c.query<{ id: string }>("SELECT id FROM plans WHERE code = $1", [body.planCode])).rows[0]?.id : null;
      if (body.planCode && !planId) throw badRequest("Plan inexistente");
      const r = await c.query("UPDATE clinics SET status = COALESCE($2, status), plan_id = COALESCE($3, plan_id) WHERE id = $1", [params.id, body.status ?? null, planId]);
      if (!r.rowCount) throw notFound("Clínica");
      await c.query("INSERT INTO audit_log (clinic_id, user_id, action, entity, entity_id, data, ip) VALUES ($1,$2,'platform.clinic_updated','clinic',$1,$3,$4)",
        [params.id, auth.userId, JSON.stringify(body), auth.ip]);
      return { ok: true };
    },
  });
}
