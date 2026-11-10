import { z } from "zod";
import type { Config } from "../config.js";
import type { Route } from "../lib/http.js";
import { AppError, badRequest } from "../lib/errors.js";
import { hashPassword, verifyPassword, dummyVerify, passwordProblem } from "../lib/password.js";
import { SESSION_COOKIE, hashToken, newToken } from "../lib/session.js";
import { audit } from "../lib/audit.js";
import { ROLE_LABELS, type Role } from "../lib/rbac.js";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

export function authRoutes(route: Route, cfg: Config) {
  const cookieOpts = {
    path: "/",
    httpOnly: true,
    sameSite: "lax" as const,
    secure: cfg.isProduction,
    maxAge: cfg.sessionTtlHours * 3600,
  };

  route({
    method: "POST",
    url: "/api/auth/login",
    summary: "Iniciar sesión",
    tags: ["auth"],
    access: "public",
    limit: cfg.disableRateLimit ? undefined : { max: 10, timeWindow: "1 minute" },
    body: z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) }),
    handler: async ({ body, req, reply, c }) => {
      const r = await c.query<{ id: string; password_hash: string; failed_logins: number; locked_until: Date | null; disabled_at: Date | null }>(
        "SELECT id, password_hash, failed_logins, locked_until, disabled_at FROM users WHERE email = $1",
        [body.email],
      );
      const u = r.rows[0];
      const generic = new AppError(401, "invalid_credentials", "Correo o contraseña incorrectos");
      if (!u || u.disabled_at) {
        await dummyVerify(body.password);
        throw generic;
      }
      if (u.locked_until && new Date(u.locked_until) > new Date()) {
        throw new AppError(429, "locked", "Cuenta bloqueada temporalmente por intentos fallidos. Intenta en unos minutos.");
      }
      const ok = await verifyPassword(body.password, u.password_hash);
      if (!ok) {
        // No se lanza excepción: el contador y la auditoría deben quedar guardados (un throw haría ROLLBACK).
        const failed = u.failed_logins + 1;
        const lock = failed >= MAX_FAILED;
        await c.query(
          `UPDATE users SET failed_logins = $2, locked_until = CASE WHEN $3 THEN now() + make_interval(mins => $4) ELSE NULL END WHERE id = $1`,
          [u.id, lock ? 0 : failed, lock, LOCK_MINUTES],
        );
        await audit(c, { userId: u.id, clinicId: null, ip: req.ip }, lock ? "auth.locked" : "auth.login_failed", "user", u.id);
        reply.code(401);
        return { error: { code: generic.code, message: generic.message } };
      }
      await c.query("UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1", [u.id]);
      await c.query("SELECT set_config('app.user_id', $1, true)", [u.id]);
      const ms = await c.query<{ clinic_id: string }>(
        "SELECT m.clinic_id FROM memberships m JOIN clinics cl ON cl.id = m.clinic_id WHERE m.user_id = $1 AND m.active AND cl.status IN ('trial','active') ORDER BY m.created_at",
        [u.id],
      );
      const clinicId = ms.rows.length === 1 ? ms.rows[0]!.clinic_id : null;
      const token = newToken();
      await c.query(
        `INSERT INTO sessions (token_hash, csrf_token, user_id, clinic_id, expires_at, ip, user_agent)
         VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5), $6, $7)`,
        [hashToken(token), newToken(), u.id, clinicId, cfg.sessionTtlHours, req.ip, String(req.headers["user-agent"] ?? "").slice(0, 300)],
      );
      if (clinicId) await c.query("SELECT set_config('app.clinic_id', $1, true)", [clinicId]);
      await audit(c, { userId: u.id, clinicId, ip: req.ip }, "auth.login", "user", u.id);
      reply.setCookie(SESSION_COOKIE, token, cookieOpts);
      return { ok: true };
    },
  });

  route({
    method: "POST",
    url: "/api/auth/logout",
    summary: "Cerrar sesión",
    tags: ["auth"],
    access: "session",
    handler: async ({ auth, reply, c }) => {
      await c.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [auth.sessionId]);
      reply.clearCookie(SESSION_COOKIE, { path: "/" });
      return { ok: true };
    },
  });

  route({
    method: "GET",
    url: "/api/auth/me",
    summary: "Usuario actual, clínica activa, permisos y clínicas disponibles",
    tags: ["auth"],
    access: "session",
    handler: async ({ auth, c }) => {
      const clinics = await c.query<{ id: string; name: string; role: Role }>(
        `SELECT cl.id, cl.name, m.role FROM memberships m JOIN clinics cl ON cl.id = m.clinic_id
          WHERE m.user_id = $1 AND m.active AND cl.status IN ('trial','active') ORDER BY cl.name`,
        [auth.userId],
      );
      let clinic = null;
      let branches: unknown[] = [];
      if (auth.clinicId) {
        await c.query("SELECT set_config('app.clinic_id', $1, true)", [auth.clinicId]);
        clinic = (await c.query("SELECT id, name, timezone, currency, locale, status FROM clinics WHERE id = $1", [auth.clinicId])).rows[0];
        const allowed = auth.membership!.allBranches || auth.membership!.role === "owner" ? null : auth.membership!.branchIds;
        branches = (
          await c.query(
            "SELECT id, code, name, city FROM branches WHERE active AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY code",
            [allowed],
          )
        ).rows;
      }
      return {
        user: { id: auth.userId, email: auth.email, fullName: auth.fullName, isPlatformAdmin: auth.isPlatformAdmin },
        csrfToken: auth.csrfToken,
        clinic,
        branches,
        membership: auth.membership && {
          role: auth.membership.role,
          roleLabel: ROLE_LABELS[auth.membership.role],
          allBranches: auth.membership.allBranches || auth.membership.role === "owner",
          isProfessional: auth.membership.isProfessional,
        },
        permissions: [...auth.permissions].sort(),
        clinics: clinics.rows.map((r) => ({ ...r, roleLabel: ROLE_LABELS[r.role] })),
      };
    },
  });

  route({
    method: "POST",
    url: "/api/auth/switch-clinic",
    summary: "Cambiar la clínica activa de la sesión",
    tags: ["auth"],
    access: "session",
    body: z.object({ clinicId: z.uuid() }),
    handler: async ({ body, auth, req, c }) => {
      const m = await c.query(
        `SELECT 1 FROM memberships m JOIN clinics cl ON cl.id = m.clinic_id
          WHERE m.user_id = $1 AND m.clinic_id = $2 AND m.active AND cl.status IN ('trial','active')`,
        [auth.userId, body.clinicId],
      );
      if (!m.rowCount) throw new AppError(403, "forbidden", "No perteneces a esa clínica");
      await c.query("UPDATE sessions SET clinic_id = $2 WHERE id = $1", [auth.sessionId, body.clinicId]);
      await c.query("SELECT set_config('app.clinic_id', $1, true)", [body.clinicId]);
      await audit(c, { userId: auth.userId, clinicId: body.clinicId, ip: req.ip }, "auth.switch_clinic", "clinic", body.clinicId);
      return { ok: true };
    },
  });

  route({
    method: "POST",
    url: "/api/auth/change-password",
    summary: "Cambiar la propia contraseña (cierra las demás sesiones)",
    tags: ["auth"],
    access: "session",
    body: z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }),
    handler: async ({ body, auth, c }) => {
      const u = (await c.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [auth.userId])).rows[0]!;
      if (!(await verifyPassword(body.currentPassword, u.password_hash))) throw badRequest("La contraseña actual no es correcta");
      const problem = passwordProblem(body.newPassword);
      if (problem) throw badRequest(problem);
      await c.query("UPDATE users SET password_hash = $2, password_changed_at = now() WHERE id = $1", [auth.userId, await hashPassword(body.newPassword)]);
      await c.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [auth.userId, auth.sessionId]);
      await audit(c, auth, "auth.password_changed", "user", auth.userId);
      return { ok: true };
    },
  });

}
