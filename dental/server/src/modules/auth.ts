import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import QRCode from "qrcode";
import type { Config } from "../config.js";
import type { Route } from "../lib/http.js";
import type { Client } from "../lib/db.js";
import type { Mailer } from "../lib/mailer.js";
import { AppError, badRequest } from "../lib/errors.js";
import { hashPassword, verifyPassword, dummyVerify, passwordProblem } from "../lib/password.js";
import { SESSION_COOKIE, hashToken, newToken } from "../lib/session.js";
import { audit } from "../lib/audit.js";
import { ROLE_LABELS, type Role } from "../lib/rbac.js";
import { open, seal } from "../lib/secretbox.js";
import { newTotpSecret, otpauthUri, verifyTotp } from "../lib/totp.js";

const MAX_FAILED = 5;
const LOCK_MINUTES = 15;
const MAX_MFA_FAILED = 5;
const RESET_MINUTES = 30;

const sha256 = (s: string) => createHash("sha256").update(s).digest();
const normRecovery = (s: string) => s.replace(/[\s-]/g, "").toUpperCase();

function newRecoveryCodes(n = 10): string[] {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from({ length: n }, () => {
    const b = randomBytes(8);
    const raw = [...b].map((x) => alphabet[x % alphabet.length]).join("");
    return `${raw.slice(0, 4)}-${raw.slice(4)}`;
  });
}

async function storeRecoveryCodes(c: Client, userId: string): Promise<string[]> {
  const codes = newRecoveryCodes();
  await c.query("DELETE FROM mfa_recovery_codes WHERE user_id = $1", [userId]);
  for (const code of codes) await c.query("INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)", [userId, sha256(normRecovery(code))]);
  return codes;
}

export function authRoutes(route: Route, cfg: Config, mailer: Mailer) {
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
    summary: "Iniciar sesión (si el usuario tiene verificación en dos pasos, la sesión queda pendiente del código)",
    tags: ["auth"],
    access: "public",
    limit: cfg.disableRateLimit ? undefined : { max: 10, timeWindow: "1 minute" },
    body: z.object({ email: z.string().trim().toLowerCase().max(200), password: z.string().max(200) }),
    handler: async ({ body, req, reply, c }) => {
      const r = await c.query<{ id: string; password_hash: string; failed_logins: number; locked_until: Date | null; disabled_at: Date | null; mfa_enabled_at: Date | null }>(
        "SELECT id, password_hash, failed_logins, locked_until, disabled_at, mfa_enabled_at FROM users WHERE email = $1",
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
      const mfaRequired = !!u.mfa_enabled_at;
      const token = newToken();
      await c.query(
        `INSERT INTO sessions (token_hash, csrf_token, user_id, clinic_id, expires_at, ip, user_agent, mfa_pending)
         VALUES ($1, $2, $3, $4, now() + make_interval(hours => $5), $6, $7, $8)`,
        [hashToken(token), newToken(), u.id, clinicId, mfaRequired ? 1 : cfg.sessionTtlHours, req.ip, String(req.headers["user-agent"] ?? "").slice(0, 300), mfaRequired],
      );
      if (clinicId) await c.query("SELECT set_config('app.clinic_id', $1, true)", [clinicId]);
      await audit(c, { userId: u.id, clinicId, ip: req.ip }, mfaRequired ? "auth.password_ok_mfa_pending" : "auth.login", "user", u.id);
      reply.setCookie(SESSION_COOKIE, token, cookieOpts);
      return { ok: true, mfaRequired };
    },
  });

  route({
    method: "POST",
    url: "/api/auth/mfa/verify",
    summary: "Segundo paso del ingreso: código TOTP de 6 dígitos o código de recuperación",
    tags: ["auth"],
    access: "session",
    restricted: "mfa_pending",
    limit: cfg.disableRateLimit ? undefined : { max: 10, timeWindow: "1 minute" },
    body: z.object({ code: z.string().trim().max(20).optional(), recoveryCode: z.string().trim().max(20).optional() }),
    handler: async ({ body, auth, reply, c }) => {
      if (!auth.mfaPending) return { ok: true };
      const u = (await c.query<{ mfa_secret_enc: string | null; clinic_id: string | null }>(
        "SELECT u.mfa_secret_enc, s.clinic_id FROM users u JOIN sessions s ON s.user_id = u.id WHERE s.id = $1", [auth.sessionId])).rows[0]!;
      let ok = false;
      let usedRecovery = false;
      if (body.code && u.mfa_secret_enc) ok = verifyTotp(open(cfg.secretKey, u.mfa_secret_enc), body.code);
      else if (body.recoveryCode) {
        const r = await c.query("UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL", [auth.userId, sha256(normRecovery(body.recoveryCode))]);
        ok = r.rowCount === 1;
        usedRecovery = ok;
      }
      if (!ok) {
        const f = (await c.query<{ mfa_failed: number }>("UPDATE sessions SET mfa_failed = mfa_failed + 1 WHERE id = $1 RETURNING mfa_failed", [auth.sessionId])).rows[0]!.mfa_failed;
        const revoke = f >= MAX_MFA_FAILED;
        if (revoke) await c.query("UPDATE sessions SET revoked_at = now() WHERE id = $1", [auth.sessionId]);
        await audit(c, { userId: auth.userId, clinicId: null, ip: auth.ip }, revoke ? "auth.mfa_locked" : "auth.mfa_failed", "user", auth.userId);
        reply.code(401);
        return { error: { code: revoke ? "mfa_locked" : "mfa_invalid", message: revoke ? "Demasiados códigos incorrectos. Vuelve a ingresar." : "Código incorrecto" } };
      }
      await c.query("UPDATE sessions SET mfa_pending = false, mfa_failed = 0, expires_at = now() + make_interval(hours => $2) WHERE id = $1", [auth.sessionId, cfg.sessionTtlHours]);
      if (u.clinic_id) await c.query("SELECT set_config('app.clinic_id', $1, true)", [u.clinic_id]);
      await audit(c, { userId: auth.userId, clinicId: u.clinic_id, ip: auth.ip }, usedRecovery ? "auth.login_recovery_code" : "auth.login", "user", auth.userId, { mfa: true });
      return { ok: true };
    },
  });

  route({
    method: "POST",
    url: "/api/auth/logout",
    summary: "Cerrar sesión",
    tags: ["auth"],
    access: "session",
    restricted: "mfa_pending",
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
    restricted: "mfa_pending",
    handler: async ({ auth, c }) => {
      if (auth.mfaPending) {
        return { mfaPending: true, csrfToken: auth.csrfToken, user: { email: auth.email, fullName: auth.fullName }, permissions: [], clinics: [], branches: [] };
      }
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
        user: { id: auth.userId, email: auth.email, fullName: auth.fullName, isPlatformAdmin: auth.isPlatformAdmin, mfaEnabled: auth.mfaEnabled },
        csrfToken: auth.csrfToken,
        mustChangePassword: auth.mustChangePassword,
        mfaEnrollmentRequired: auth.mfaEnrollmentRequired,
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
    restricted: "setup",
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
    restricted: "setup",
    body: z.object({ currentPassword: z.string().max(200), newPassword: z.string().max(200) }),
    handler: async ({ body, auth, c }) => {
      const u = (await c.query<{ password_hash: string }>("SELECT password_hash FROM users WHERE id = $1", [auth.userId])).rows[0]!;
      if (!(await verifyPassword(body.currentPassword, u.password_hash))) throw badRequest("La contraseña actual no es correcta");
      const problem = passwordProblem(body.newPassword);
      if (problem) throw badRequest(problem);
      if (body.newPassword === body.currentPassword) throw badRequest("La nueva contraseña debe ser distinta");
      await c.query("UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = false WHERE id = $1", [auth.userId, await hashPassword(body.newPassword)]);
      await c.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [auth.userId, auth.sessionId]);
      await audit(c, auth, "auth.password_changed", "user", auth.userId);
      return { ok: true };
    },
  });

  // ---------------- Verificación en dos pasos: activar / desactivar ----------------
  route({
    method: "POST",
    url: "/api/auth/mfa/setup",
    summary: "Iniciar la activación de la verificación en dos pasos (devuelve el QR para la app autenticadora)",
    tags: ["auth"],
    access: "session",
    restricted: "setup",
    body: z.object({ password: z.string().max(200) }),
    handler: async ({ body, auth, c }) => {
      const u = (await c.query<{ password_hash: string; mfa_enabled_at: Date | null }>("SELECT password_hash, mfa_enabled_at FROM users WHERE id = $1", [auth.userId])).rows[0]!;
      if (!(await verifyPassword(body.password, u.password_hash))) throw badRequest("La contraseña no es correcta");
      if (u.mfa_enabled_at) throw new AppError(409, "mfa_already_enabled", "La verificación en dos pasos ya está activa");
      const secret = newTotpSecret();
      await c.query("UPDATE users SET mfa_pending_secret_enc = $2 WHERE id = $1", [auth.userId, seal(cfg.secretKey, secret)]);
      const uri = otpauthUri(secret, auth.email);
      const qrSvg = await QRCode.toString(uri, { type: "svg", margin: 1, width: 200 });
      return { secret, uri, qrSvg };
    },
  });

  route({
    method: "POST",
    url: "/api/auth/mfa/enable",
    summary: "Confirmar la activación con un código de la app; devuelve 10 códigos de recuperación (se muestran una sola vez)",
    tags: ["auth"],
    access: "session",
    restricted: "setup",
    body: z.object({ code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 dígitos") }),
    handler: async ({ body, auth, c }) => {
      const u = (await c.query<{ mfa_pending_secret_enc: string | null }>("SELECT mfa_pending_secret_enc FROM users WHERE id = $1", [auth.userId])).rows[0]!;
      if (!u.mfa_pending_secret_enc) throw badRequest("Primero inicia la activación");
      if (!verifyTotp(open(cfg.secretKey, u.mfa_pending_secret_enc), body.code)) throw badRequest("Código incorrecto. Revisa la hora del celular.");
      await c.query("UPDATE users SET mfa_secret_enc = mfa_pending_secret_enc, mfa_pending_secret_enc = NULL, mfa_enabled_at = now() WHERE id = $1", [auth.userId]);
      const codes = await storeRecoveryCodes(c, auth.userId);
      // Las demás sesiones abiertas se cierran: deberán ingresar con el segundo paso.
      await c.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND id <> $2 AND revoked_at IS NULL", [auth.userId, auth.sessionId]);
      await audit(c, auth, "auth.mfa_enabled", "user", auth.userId);
      return { recoveryCodes: codes };
    },
  });

  route({
    method: "POST",
    url: "/api/auth/mfa/disable",
    summary: "Desactivar la verificación en dos pasos (requiere contraseña y un código vigente)",
    tags: ["auth"],
    access: "session",
    body: z.object({ password: z.string().max(200), code: z.string().trim().max(10) }),
    handler: async ({ body, auth, c }) => {
      const u = (await c.query<{ password_hash: string; mfa_secret_enc: string | null }>("SELECT password_hash, mfa_secret_enc FROM users WHERE id = $1", [auth.userId])).rows[0]!;
      if (!u.mfa_secret_enc) throw badRequest("La verificación en dos pasos no está activa");
      if (!(await verifyPassword(body.password, u.password_hash)) || !verifyTotp(open(cfg.secretKey, u.mfa_secret_enc), body.code)) {
        throw badRequest("Contraseña o código incorrectos");
      }
      await c.query("UPDATE users SET mfa_secret_enc = NULL, mfa_enabled_at = NULL WHERE id = $1", [auth.userId]);
      await c.query("DELETE FROM mfa_recovery_codes WHERE user_id = $1", [auth.userId]);
      await audit(c, auth, "auth.mfa_disabled", "user", auth.userId);
      return { ok: true };
    },
  });

  route({
    method: "POST",
    url: "/api/auth/mfa/recovery-codes",
    summary: "Generar nuevos códigos de recuperación (invalida los anteriores)",
    tags: ["auth"],
    access: "session",
    body: z.object({ code: z.string().trim().regex(/^\d{6}$/) }),
    handler: async ({ body, auth, c }) => {
      const u = (await c.query<{ mfa_secret_enc: string | null }>("SELECT mfa_secret_enc FROM users WHERE id = $1", [auth.userId])).rows[0]!;
      if (!u.mfa_secret_enc || !verifyTotp(open(cfg.secretKey, u.mfa_secret_enc), body.code)) throw badRequest("Código incorrecto");
      const codes = await storeRecoveryCodes(c, auth.userId);
      await audit(c, auth, "auth.mfa_recovery_regenerated", "user", auth.userId);
      return { recoveryCodes: codes };
    },
  });

  // ---------------- Recuperación de contraseña por correo ----------------
  const GENERIC_FORGOT = { ok: true, message: "Si el correo está registrado, recibirás un enlace para restablecer la contraseña." };

  route({
    method: "POST",
    url: "/api/auth/forgot",
    summary: "Solicitar enlace para restablecer la contraseña (respuesta idéntica exista o no el correo)",
    tags: ["auth"],
    access: "public",
    limit: cfg.disableRateLimit ? undefined : { max: 5, timeWindow: "1 minute" },
    body: z.object({ email: z.string().trim().toLowerCase().max(200) }),
    handler: async ({ body, req, c }) => {
      const u = (await c.query<{ id: string; full_name: string }>("SELECT id, full_name FROM users WHERE email = $1 AND disabled_at IS NULL", [body.email])).rows[0];
      if (!u) return GENERIC_FORGOT;
      const recent = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM password_resets WHERE user_id = $1 AND created_at > now() - interval '1 hour'", [u.id])).rows[0]!.n;
      if (recent >= 3) return GENERIC_FORGOT; // limita el abuso sin revelarlo
      const token = randomBytes(32).toString("base64url");
      await c.query("INSERT INTO password_resets (user_id, token_hash, expires_at, ip) VALUES ($1, $2, now() + make_interval(mins => $3), $4)", [u.id, sha256(token), RESET_MINUTES, req.ip]);
      await audit(c, { userId: u.id, clinicId: null, ip: req.ip }, "auth.password_reset_requested", "user", u.id);
      const link = `${cfg.publicUrl}/restablecer?token=${token}`;
      await mailer.send({
        to: body.email,
        subject: "Restablecer tu contraseña",
        text: `Hola ${u.full_name}:\n\nRecibimos una solicitud para restablecer tu contraseña. Usa este enlace (válido ${RESET_MINUTES} minutos, un solo uso):\n\n${link}\n\nSi no lo pediste, ignora este mensaje: tu contraseña no cambiará.`,
      });
      return GENERIC_FORGOT;
    },
  });

  route({
    method: "POST",
    url: "/api/auth/reset",
    summary: "Restablecer la contraseña con el enlace recibido (cierra todas las sesiones)",
    tags: ["auth"],
    access: "public",
    limit: cfg.disableRateLimit ? undefined : { max: 10, timeWindow: "1 minute" },
    body: z.object({ token: z.string().min(20).max(100), newPassword: z.string().max(200) }),
    handler: async ({ body, req, c }) => {
      const r = (await c.query<{ id: string; user_id: string }>(
        "SELECT id, user_id FROM password_resets WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now() FOR UPDATE", [sha256(body.token)])).rows[0];
      if (!r) throw new AppError(400, "invalid_token", "El enlace no es válido o ya venció. Solicita uno nuevo.");
      const problem = passwordProblem(body.newPassword);
      if (problem) throw badRequest(problem);
      await c.query("UPDATE password_resets SET used_at = now() WHERE user_id = $1 AND used_at IS NULL", [r.user_id]);
      await c.query(
        "UPDATE users SET password_hash = $2, password_changed_at = now(), must_change_password = false, failed_logins = 0, locked_until = NULL WHERE id = $1",
        [r.user_id, await hashPassword(body.newPassword)],
      );
      await c.query("UPDATE sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL", [r.user_id]);
      await audit(c, { userId: r.user_id, clinicId: null, ip: req.ip }, "auth.password_reset", "user", r.user_id);
      return { ok: true };
    },
  });
}
