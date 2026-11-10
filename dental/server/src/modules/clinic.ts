import { randomBytes } from "node:crypto";
import { z } from "zod";
import type { Route } from "../lib/http.js";
import { zId, zIdParams, zMoney, zOptText } from "../lib/http.js";
import { AppError, badRequest, forbidden, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { hashPassword } from "../lib/password.js";
import { ROLES, ROLE_LABELS, type Role } from "../lib/rbac.js";
import type { Client } from "../lib/db.js";

const zTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Hora inválida (HH:MM)");
const zHours = z.record(z.string().regex(/^[1-7]$/), z.array(z.tuple([zTime, zTime])).max(4));

async function planLimits(c: Client, clinicId: string) {
  const r = await c.query<{ max_branches: number; max_users: number; max_patients: number | null }>(
    "SELECT p.max_branches, p.max_users, p.max_patients FROM clinics cl LEFT JOIN plans p ON p.id = cl.plan_id WHERE cl.id = $1",
    [clinicId],
  );
  return r.rows[0] ?? { max_branches: 1, max_users: 3, max_patients: null };
}

export function clinicRoutes(route: Route) {
  // ---------------- Clínica ----------------
  route({
    method: "GET", url: "/api/clinic", summary: "Datos de la clínica activa", tags: ["clínica"],
    handler: async ({ c, auth }) => {
      const r = await c.query(
        `SELECT cl.id, cl.name, cl.legal_name AS "legalName", cl.tax_id AS "taxId", cl.timezone, cl.currency, cl.locale, cl.status,
                cl.settings, p.name AS "planName", p.max_branches AS "maxBranches", p.max_users AS "maxUsers"
           FROM clinics cl LEFT JOIN plans p ON p.id = cl.plan_id WHERE cl.id = $1`,
        [auth.clinicId],
      );
      return r.rows[0];
    },
  });

  route({
    method: "PATCH", url: "/api/clinic", summary: "Actualizar datos de la clínica", tags: ["clínica"], perm: "clinic.manage",
    body: z.object({
      name: z.string().trim().min(2).max(120).optional(),
      legalName: zOptText(200).optional(),
      taxId: zOptText(30).optional(),
      timezone: z.string().max(60).optional(),
    }),
    handler: async ({ c, auth, body }) => {
      if (body.timezone && !Intl.supportedValuesOf("timeZone").includes(body.timezone)) throw badRequest("Zona horaria inválida");
      await c.query(
        `UPDATE clinics SET name = COALESCE($2, name), legal_name = CASE WHEN $3::boolean THEN $4 ELSE legal_name END,
                tax_id = CASE WHEN $5::boolean THEN $6 ELSE tax_id END, timezone = COALESCE($7, timezone) WHERE id = $1`,
        [auth.clinicId, body.name ?? null, body.legalName !== undefined, body.legalName ?? null, body.taxId !== undefined, body.taxId ?? null, body.timezone ?? null],
      );
      await audit(c, auth, "clinic.updated", "clinic", auth.clinicId, body);
      return { ok: true };
    },
  });

  // ---------------- Sucursales ----------------
  route({
    method: "GET", url: "/api/branches", summary: "Sucursales (incluye consultorios)", tags: ["clínica"],
    handler: async ({ c }) => {
      const b = await c.query(
        `SELECT id, code, name, address, city, phone, opening_hours AS "openingHours", active FROM branches ORDER BY code`,
      );
      const ch = await c.query(`SELECT id, branch_id AS "branchId", name, active FROM chairs ORDER BY name`);
      return b.rows.map((br) => ({ ...br, chairs: ch.rows.filter((x) => x.branchId === br.id) }));
    },
  });

  const branchBody = z.object({
    code: z.string().trim().min(1).max(12),
    name: z.string().trim().min(2).max(120),
    address: zOptText(300),
    city: zOptText(80),
    phone: zOptText(40),
    openingHours: zHours.default({}),
    active: z.boolean().default(true),
  });

  route({
    method: "POST", url: "/api/branches", summary: "Crear sucursal", tags: ["clínica"], perm: "clinic.manage", body: branchBody,
    handler: async ({ c, auth, body }) => {
      const lim = await planLimits(c, auth.clinicId!);
      const n = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM branches WHERE active")).rows[0]!.n;
      if (n >= lim.max_branches) throw new AppError(402, "plan_limit", `Tu plan permite ${lim.max_branches} sucursales activas`);
      const r = await c.query<{ id: string }>(
        `INSERT INTO branches (clinic_id, code, name, address, city, phone, opening_hours, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id`,
        [auth.clinicId, body.code, body.name, body.address, body.city, body.phone, JSON.stringify(body.openingHours), body.active],
      );
      await audit(c, auth, "branch.created", "branch", r.rows[0]!.id, { code: body.code, name: body.name });
      return { id: r.rows[0]!.id };
    },
  });

  route({
    method: "PUT", url: "/api/branches/:id", summary: "Editar sucursal", tags: ["clínica"], perm: "clinic.manage",
    params: zIdParams, body: branchBody,
    handler: async ({ c, auth, body, params }) => {
      const r = await c.query(
        `UPDATE branches SET code=$2, name=$3, address=$4, city=$5, phone=$6, opening_hours=$7, active=$8 WHERE id=$1`,
        [params.id, body.code, body.name, body.address, body.city, body.phone, JSON.stringify(body.openingHours), body.active],
      );
      if (!r.rowCount) throw notFound("Sucursal");
      await audit(c, auth, "branch.updated", "branch", params.id, { code: body.code, name: body.name, active: body.active }, params.id);
      return { ok: true };
    },
  });

  // ---------------- Consultorios ----------------
  route({
    method: "POST", url: "/api/chairs", summary: "Crear consultorio", tags: ["clínica"], perm: "clinic.manage",
    body: z.object({ branchId: zId, name: z.string().trim().min(1).max(60) }),
    handler: async ({ c, auth, body }) => {
      const r = await c.query<{ id: string }>("INSERT INTO chairs (clinic_id, branch_id, name) VALUES ($1,$2,$3) RETURNING id", [auth.clinicId, body.branchId, body.name]);
      await audit(c, auth, "chair.created", "chair", r.rows[0]!.id, body, body.branchId);
      return { id: r.rows[0]!.id };
    },
  });

  route({
    method: "PATCH", url: "/api/chairs/:id", summary: "Editar consultorio", tags: ["clínica"], perm: "clinic.manage",
    params: zIdParams, body: z.object({ name: z.string().trim().min(1).max(60).optional(), active: z.boolean().optional() }),
    handler: async ({ c, auth, body, params }) => {
      const r = await c.query("UPDATE chairs SET name = COALESCE($2, name), active = COALESCE($3, active) WHERE id = $1", [params.id, body.name ?? null, body.active ?? null]);
      if (!r.rowCount) throw notFound("Consultorio");
      await audit(c, auth, "chair.updated", "chair", params.id, body);
      return { ok: true };
    },
  });

  // ---------------- Personal ----------------
  route({
    method: "GET", url: "/api/staff", summary: "Personal de la clínica", tags: ["personal"],
    query: z.object({ professionals: z.enum(["1", "0"]).optional() }),
    handler: async ({ c, query, auth }) => {
      const full = auth.permissions.has("staff.manage");
      const r = await c.query(
        `SELECT m.user_id AS "userId", u.full_name AS "fullName", ${full ? `u.email,` : ""} m.role, m.all_branches AS "allBranches",
                m.branch_ids AS "branchIds", m.is_professional AS "isProfessional", m.professional_license AS "license",
                m.color, ${full ? `m.commission_pct AS "commissionPct",` : ""} m.active
           FROM memberships m JOIN users u ON u.id = m.user_id
          WHERE m.clinic_id = $1 AND ($2::boolean IS NOT TRUE OR (m.is_professional AND m.active))
          ORDER BY u.full_name`,
        [auth.clinicId, query.professionals === "1"],
      );
      return r.rows.map((x) => ({ ...x, roleLabel: ROLE_LABELS[x.role as Role] }));
    },
  });

  const staffBody = z.object({
    role: z.enum(ROLES),
    allBranches: z.boolean().default(false),
    branchIds: z.array(zId).max(50).default([]),
    isProfessional: z.boolean().default(false),
    license: zOptText(60),
    color: z.string().regex(/^#[0-9a-fA-F]{6}$/).nullish().transform((v) => v ?? null),
    commissionPct: z.number().min(0).max(100).nullish().transform((v) => v ?? null),
    active: z.boolean().default(true),
  });

  function assertCanGrant(actorRole: Role, targetRole: Role, currentRole?: Role) {
    // Solo un propietario crea o modifica propietarios y administradores.
    const privileged = (r?: Role) => r === "owner" || r === "admin";
    if (actorRole !== "owner" && (privileged(targetRole) || privileged(currentRole))) {
      throw forbidden("Solo el propietario puede asignar o modificar propietarios y administradores");
    }
  }

  route({
    method: "POST", url: "/api/staff", summary: "Agregar persona (crea el usuario si no existe y devuelve una contraseña temporal)",
    tags: ["personal"], perm: "staff.manage",
    body: staffBody.extend({ email: z.email().transform((e) => e.toLowerCase()), fullName: z.string().trim().min(3).max(120) }),
    handler: async ({ c, auth, body }) => {
      assertCanGrant(auth.membership!.role, body.role);
      if (!body.allBranches && body.role !== "owner" && body.branchIds.length === 0) throw badRequest("Asigna al menos una sucursal");
      const lim = await planLimits(c, auth.clinicId!);
      const n = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM memberships WHERE clinic_id = $1 AND active", [auth.clinicId])).rows[0]!.n;
      if (n >= lim.max_users) throw new AppError(402, "plan_limit", `Tu plan permite ${lim.max_users} usuarios activos`);
      let userId = (await c.query<{ id: string }>("SELECT id FROM users WHERE email = $1", [body.email])).rows[0]?.id;
      let temporaryPassword: string | null = null;
      if (!userId) {
        temporaryPassword = `Tmp-${randomBytes(6).toString("base64url")}7`;
        userId = (
          await c.query<{ id: string }>("INSERT INTO users (email, full_name, password_hash) VALUES ($1,$2,$3) RETURNING id", [
            body.email, body.fullName, await hashPassword(temporaryPassword),
          ])
        ).rows[0]!.id;
      }
      await c.query(
        `INSERT INTO memberships (clinic_id, user_id, role, all_branches, branch_ids, is_professional, professional_license, color, commission_pct, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [auth.clinicId, userId, body.role, body.allBranches, body.branchIds, body.isProfessional, body.license, body.color, body.commissionPct, body.active],
      );
      await audit(c, auth, "staff.added", "user", userId, { role: body.role, branchIds: body.branchIds, allBranches: body.allBranches });
      return { userId, temporaryPassword };
    },
  });

  route({
    method: "PUT", url: "/api/staff/:id", summary: "Editar rol, sucursales y datos profesionales", tags: ["personal"], perm: "staff.manage",
    params: zIdParams, body: staffBody,
    handler: async ({ c, auth, body, params }) => {
      const cur = (await c.query<{ role: Role }>("SELECT role FROM memberships WHERE clinic_id = $1 AND user_id = $2", [auth.clinicId, params.id])).rows[0];
      if (!cur) throw notFound("Persona");
      assertCanGrant(auth.membership!.role, body.role, cur.role);
      if (params.id === auth.userId && (body.role !== cur.role || !body.active)) throw badRequest("No puedes cambiar tu propio rol ni desactivarte");
      await c.query(
        `UPDATE memberships SET role=$3, all_branches=$4, branch_ids=$5, is_professional=$6, professional_license=$7, color=$8, commission_pct=$9, active=$10
          WHERE clinic_id=$1 AND user_id=$2`,
        [auth.clinicId, params.id, body.role, body.allBranches, body.branchIds, body.isProfessional, body.license, body.color, body.commissionPct, body.active],
      );
      if (!body.active) {
        await c.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND clinic_id = $2 AND revoked_at IS NULL", [params.id, auth.clinicId]);
      }
      await audit(c, auth, "staff.updated", "user", params.id, { from: cur.role, to: body.role, branchIds: body.branchIds, active: body.active });
      return { ok: true };
    },
  });

  // ---------------- Horarios ----------------
  route({
    method: "GET", url: "/api/schedules", summary: "Horarios semanales de los profesionales", tags: ["personal"],
    query: z.object({ dentistId: zId.optional(), branchId: zId.optional() }),
    handler: async ({ c, query }) => {
      const r = await c.query(
        `SELECT id, dentist_id AS "dentistId", branch_id AS "branchId", weekday, to_char(start_time,'HH24:MI') AS "start",
                to_char(end_time,'HH24:MI') AS "end", chair_id AS "chairId"
           FROM dentist_schedules WHERE ($1::uuid IS NULL OR dentist_id = $1) AND ($2::uuid IS NULL OR branch_id = $2)
          ORDER BY dentist_id, weekday, start_time`,
        [query.dentistId ?? null, query.branchId ?? null],
      );
      return r.rows;
    },
  });

  route({
    method: "PUT", url: "/api/schedules/:id", summary: "Reemplazar el horario semanal de un profesional", tags: ["personal"], perm: "clinic.manage",
    params: zIdParams,
    body: z.object({
      slots: z.array(z.object({ branchId: zId, weekday: z.number().int().min(1).max(7), start: zTime, end: zTime, chairId: zId.nullish() })).max(60),
    }),
    handler: async ({ c, auth, body, params }) => {
      for (const s of body.slots) if (s.end <= s.start) throw badRequest("La hora de fin debe ser posterior a la de inicio");
      // Sin superposiciones el mismo día (aunque sea en distinta sucursal)
      const byDay = new Map<number, typeof body.slots>();
      for (const s of body.slots) byDay.set(s.weekday, [...(byDay.get(s.weekday) ?? []), s]);
      for (const list of byDay.values()) {
        const sorted = [...list].sort((a, b) => a.start.localeCompare(b.start));
        for (let i = 1; i < sorted.length; i++) if (sorted[i]!.start < sorted[i - 1]!.end) throw badRequest("Hay horarios superpuestos el mismo día");
      }
      await c.query("DELETE FROM dentist_schedules WHERE dentist_id = $1", [params.id]);
      for (const s of body.slots) {
        await c.query(
          "INSERT INTO dentist_schedules (clinic_id, dentist_id, branch_id, weekday, start_time, end_time, chair_id) VALUES ($1,$2,$3,$4,$5,$6,$7)",
          [auth.clinicId, params.id, s.branchId, s.weekday, s.start, s.end, s.chairId ?? null],
        );
      }
      await audit(c, auth, "schedule.replaced", "user", params.id, { slots: body.slots.length });
      return { ok: true };
    },
  });

  route({
    method: "POST", url: "/api/schedule-blocks", summary: "Bloquear horario (vacaciones, curso, feriado)", tags: ["personal"], perm: "agenda.write",
    body: z.object({ dentistId: zId.nullish(), branchId: zId.nullish(), startsAt: z.iso.datetime({ offset: true }), endsAt: z.iso.datetime({ offset: true }), reason: z.string().trim().min(2).max(200) }),
    handler: async ({ c, auth, body }) => {
      if (!body.dentistId && !body.branchId) throw badRequest("Indica profesional o sucursal");
      if (auth.membership!.role === "dentist" && body.dentistId !== auth.userId) throw forbidden("Solo puedes bloquear tu propia agenda");
      const r = await c.query<{ id: string }>(
        "INSERT INTO schedule_blocks (clinic_id, dentist_id, branch_id, starts_at, ends_at, reason, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id",
        [auth.clinicId, body.dentistId ?? null, body.branchId ?? null, body.startsAt, body.endsAt, body.reason, auth.userId],
      );
      await audit(c, auth, "schedule.blocked", "schedule_block", r.rows[0]!.id, body);
      return { id: r.rows[0]!.id };
    },
  });

  // ---------------- Prestaciones ----------------
  route({
    method: "GET", url: "/api/procedures", summary: "Catálogo de prestaciones", tags: ["clínica"],
    query: z.object({ all: z.enum(["1", "0"]).optional() }),
    handler: async ({ c, query }) =>
      (
        await c.query(
          `SELECT id, code, name, category, price_cents AS "priceCents", duration_min AS "durationMin", scope,
                  odontogram_condition AS "odontogramCondition", active
             FROM procedures WHERE ($1::boolean OR active) ORDER BY category, name`,
          [query.all === "1"],
        )
      ).rows,
  });

  const procBody = z.object({
    code: z.string().trim().min(1).max(20),
    name: z.string().trim().min(2).max(120),
    category: z.string().trim().min(2).max(60).default("general"),
    priceCents: zMoney,
    durationMin: z.number().int().min(5).max(480).default(30),
    scope: z.enum(["mouth", "quadrant", "tooth", "surface"]).default("tooth"),
    odontogramCondition: zOptText(40),
    active: z.boolean().default(true),
  });

  route({
    method: "POST", url: "/api/procedures", summary: "Crear prestación", tags: ["clínica"], perm: "clinic.manage", body: procBody,
    handler: async ({ c, auth, body }) => {
      const r = await c.query<{ id: string }>(
        `INSERT INTO procedures (clinic_id, code, name, category, price_cents, duration_min, scope, odontogram_condition, active)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [auth.clinicId, body.code, body.name, body.category, body.priceCents, body.durationMin, body.scope, body.odontogramCondition, body.active],
      );
      await audit(c, auth, "procedure.created", "procedure", r.rows[0]!.id, body);
      return { id: r.rows[0]!.id };
    },
  });

  route({
    method: "PUT", url: "/api/procedures/:id", summary: "Editar prestación", tags: ["clínica"], perm: "clinic.manage", params: zIdParams, body: procBody,
    handler: async ({ c, auth, body, params }) => {
      const prev = (await c.query("SELECT price_cents FROM procedures WHERE id = $1", [params.id])).rows[0];
      if (!prev) throw notFound("Prestación");
      await c.query(
        `UPDATE procedures SET code=$2, name=$3, category=$4, price_cents=$5, duration_min=$6, scope=$7, odontogram_condition=$8, active=$9 WHERE id=$1`,
        [params.id, body.code, body.name, body.category, body.priceCents, body.durationMin, body.scope, body.odontogramCondition, body.active],
      );
      await audit(c, auth, "procedure.updated", "procedure", params.id, { ...body, previousPriceCents: prev.price_cents });
      return { ok: true };
    },
  });

  // ---------------- Auditoría ----------------
  route({
    method: "GET", url: "/api/audit", summary: "Registro de auditoría de la clínica", tags: ["auditoría"], perm: "audit.read",
    query: z.object({ entity: z.string().max(40).optional(), entityId: z.string().max(80).optional(), limit: z.coerce.number().int().min(1).max(500).default(100), before: z.coerce.number().int().optional() }),
    handler: async ({ c, query }) =>
      (
        await c.query(
          `SELECT a.id, a.action, a.entity, a.entity_id AS "entityId", a.branch_id AS "branchId", a.data, a.ip, a.created_at AS "createdAt",
                  u.full_name AS "userName"
             FROM audit_log a LEFT JOIN users u ON u.id = a.user_id
            WHERE ($1::text IS NULL OR a.entity = $1) AND ($2::text IS NULL OR a.entity_id = $2) AND ($4::bigint IS NULL OR a.id < $4)
            ORDER BY a.id DESC LIMIT $3`,
          [query.entity ?? null, query.entityId ?? null, query.limit, query.before ?? null],
        )
      ).rows,
  });
}
