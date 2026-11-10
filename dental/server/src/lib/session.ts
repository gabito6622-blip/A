// Sesiones opacas: el navegador guarda un token aleatorio en una cookie HttpOnly;
// la base solo guarda su SHA-256. Cada sesión tiene además un token CSRF.
import { createHash, randomBytes } from "node:crypto";
import type { FastifyRequest } from "fastify";
import type { Db } from "./db.js";
import { withTenant } from "./db.js";
import { permissionsFor, type AuthCtx, type Role } from "./rbac.js";

export const SESSION_COOKIE = "dsid";

export const hashToken = (t: string) => createHash("sha256").update(t).digest();

export function newToken(): string {
  return randomBytes(32).toString("base64url");
}

interface SessionRow {
  id: string;
  user_id: string;
  clinic_id: string | null;
  csrf_token: string;
  email: string;
  full_name: string;
  is_platform_admin: boolean;
  last_seen_at: Date;
  mfa_pending: boolean;
  mfa_enabled_at: Date | null;
  must_change_password: boolean;
}

export async function resolveSession(db: Db, req: FastifyRequest, token: string | undefined): Promise<AuthCtx | null> {
  if (!token || token.length > 100) return null;
  return withTenant(db.appPool, { clinicId: null, userId: null }, async (c) => {
    const r = await c.query<SessionRow>(
      `SELECT s.id, s.user_id, s.clinic_id, s.csrf_token, s.last_seen_at, s.mfa_pending, u.email, u.full_name, u.is_platform_admin,
              u.mfa_enabled_at, u.must_change_password
         FROM sessions s JOIN users u ON u.id = s.user_id
        WHERE s.token_hash = $1 AND s.revoked_at IS NULL AND s.expires_at > now() AND u.disabled_at IS NULL`,
      [hashToken(token)],
    );
    const s = r.rows[0];
    if (!s) return null;
    if (Date.now() - new Date(s.last_seen_at).getTime() > 60_000) {
      await c.query("UPDATE sessions SET last_seen_at = now() WHERE id = $1", [s.id]);
    }
    const auth: AuthCtx = {
      userId: s.user_id,
      email: s.email,
      fullName: s.full_name,
      isPlatformAdmin: s.is_platform_admin,
      sessionId: s.id,
      csrfToken: s.csrf_token,
      clinicId: null,
      membership: null,
      permissions: new Set(),
      ip: req.ip,
      mfaPending: s.mfa_pending,
      mfaEnabled: !!s.mfa_enabled_at,
      mfaEnrollmentRequired: false,
      mustChangePassword: s.must_change_password,
    };
    if (s.mfa_pending) return auth; // sin acceso a la clínica hasta completar el segundo paso
    if (s.clinic_id) {
      await c.query("SELECT set_config('app.user_id', $1, true)", [s.user_id]);
      const m = await c.query<{
        id: string; clinic_id: string; role: Role; all_branches: boolean; branch_ids: string[]; is_professional: boolean; clinic_status: string; mfa_roles: string[] | null;
      }>(
        `SELECT m.id, m.clinic_id, m.role, m.all_branches, m.branch_ids, m.is_professional, cl.status AS clinic_status,
                ARRAY(SELECT jsonb_array_elements_text(COALESCE(cl.settings->'mfaRequiredRoles', '[]'::jsonb))) AS mfa_roles
           FROM memberships m JOIN clinics cl ON cl.id = m.clinic_id
          WHERE m.clinic_id = $1 AND m.user_id = $2 AND m.active`,
        [s.clinic_id, s.user_id],
      );
      const row = m.rows[0];
      if (row && row.clinic_status !== "suspended" && row.clinic_status !== "cancelled") {
        auth.clinicId = row.clinic_id;
        auth.membership = {
          id: row.id, clinicId: row.clinic_id, role: row.role, allBranches: row.all_branches,
          branchIds: row.branch_ids, isProfessional: row.is_professional,
        };
        auth.permissions = permissionsFor(row.role, row.is_professional);
        auth.mfaEnrollmentRequired = !auth.mfaEnabled && (row.mfa_roles ?? []).includes(row.role);
      }
    }
    return auth;
  });
}
