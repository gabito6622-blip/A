// Bloqueo por intentos fallidos sin revelar cuentas ni permitir bloquear a otros (B-090).
//
//  * Por CUENTA + ORIGEN: 5 fallos seguidos desde una IP (en IPv6, su prefijo /64) bloquean solo
//    esa combinación por 15 minutos. Un tercero desde otra red no deja fuera a la persona.
//    La IP sale de req.ip, que respeta TRUST_PROXY (D-35): falsificar X-Forwarded-For no sirve.
//  * Por CUENTA (todas las redes): 50 fallos en una hora bloquean la cuenta por 1 hora y se envía
//    a la persona un correo con un enlace de desbloqueo firmado (DENTAL_LINK_KEY), de un solo uso
//    y que vence. Frena los ataques distribuidos.
//  * Mientras hay un bloqueo la contraseña NO se verifica (ni cuenta como intento) y la respuesta
//    es idéntica a la de una contraseña incorrecta o un correo inexistente: código, texto y forma.
//  * El propietario o un administrador desbloquea desde Configuración → Personal (auditado).
import { randomUUID } from "node:crypto";
import { z } from "zod";
import type { Config } from "../config.js";
import type { Client } from "../lib/db.js";
import type { Route } from "../lib/http.js";
import { zIdParams } from "../lib/http.js";
import type { Mailer } from "../lib/mailer.js";
import { AppError, notFound } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import { signLink, verifyLink } from "../lib/keys.js";

export const PAIR_MAX_FAILED = 5;
export const PAIR_LOCK_MINUTES = 15;
/** Un contador por origen sin fallos en este tiempo vuelve a empezar. */
const PAIR_RESET_MINUTES = 60;
export const ACCOUNT_MAX_FAILED = 50;
export const ACCOUNT_WINDOW_MINUTES = 60;
export const ACCOUNT_LOCK_MINUTES = 60;
export const UNLOCK_LINK_MINUTES = 60;
const UNLOCK_PURPOSE = "desbloqueo";

/** Respuesta ÚNICA para todo ingreso fallido (correo inexistente, clave incorrecta, bloqueo o cuenta deshabilitada). */
export const LOGIN_FAILED = Object.freeze({
  error: Object.freeze({
    code: "invalid_credentials",
    message: "Correo o contraseña incorrectos. Si fallaste varias veces, espera 15 minutos o usa «Olvidé mi contraseña».",
  }),
});

/** Origen del intento: la IP (IPv4) o el prefijo /64 (IPv6), que suele ser de una sola conexión. */
export function loginSource(ip: string | undefined | null): string {
  let a = String(ip ?? "").trim().toLowerCase().split("%")[0]!;
  if (!a) return "desconocido";
  if (a.startsWith("::ffff:") && a.includes(".")) a = a.slice(7);
  if (!a.includes(":")) return a.slice(0, 64);
  const [h, t] = a.split("::");
  const head = h ? h.split(":") : [];
  const tail = t ? t.split(":") : [];
  const groups = a.includes("::") ? [...head, ...Array(Math.max(0, 8 - head.length - tail.length)).fill("0"), ...tail] : head;
  return `${groups.slice(0, 4).map((g) => (parseInt(g, 16) || 0).toString(16)).join(":")}::/64`;
}

export interface LockState { source: boolean; account: boolean }

export async function lockState(c: Client, userId: string, source: string): Promise<LockState> {
  const r = (await c.query<{ source: boolean; account: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM login_throttle WHERE user_id = $1 AND source = $2 AND locked_until > now()) AS source,
            EXISTS (SELECT 1 FROM login_account_guard WHERE user_id = $1 AND locked_until > now()) AS account`, [userId, source])).rows[0]!;
  return r;
}

export const unlockUrl = (cfg: Pick<Config, "publicUrl" | "keys">, userId: string, nonce: string, nowMs = Date.now()) =>
  `${cfg.publicUrl}/desbloquear?token=${encodeURIComponent(signLink(cfg.keys.link, UNLOCK_PURPOSE, { u: userId, n: nonce }, UNLOCK_LINK_MINUTES * 60, nowMs).token)}`;

/** Token de desbloqueo (exportado para pruebas: enlaces vencidos o con otra clave). */
export const signUnlockToken = (cfg: Pick<Config, "keys">, userId: string, nonce: string, nowMs = Date.now()) =>
  signLink(cfg.keys.link, UNLOCK_PURPOSE, { u: userId, n: nonce }, UNLOCK_LINK_MINUTES * 60, nowMs).token;

/**
 * Registra un intento fallido (solo se llama si NO había bloqueo). Bloquea la combinación cuenta +
 * origen al 5.º fallo y la cuenta entera al alcanzar el límite global, enviando el enlace por correo.
 */
export async function recordLoginFailure(
  c: Client, deps: { cfg: Pick<Config, "publicUrl" | "keys">; mailer: Mailer },
  u: { id: string; email: string; fullName: string }, source: string, ip: string,
): Promise<{ sourceLocked: boolean; accountLocked: boolean }> {
  const actor = { userId: u.id, clinicId: null, ip };
  const failed = (await c.query<{ failed: number }>(
    `INSERT INTO login_throttle (user_id, source, failed) VALUES ($1, $2, 1)
     ON CONFLICT (user_id, source) DO UPDATE SET
       failed = CASE WHEN login_throttle.updated_at < now() - make_interval(mins => $3) THEN 1 ELSE login_throttle.failed + 1 END,
       locked_until = NULL, updated_at = now()
     RETURNING failed`, [u.id, source, PAIR_RESET_MINUTES])).rows[0]!.failed;
  const sourceLocked = failed >= PAIR_MAX_FAILED;
  if (sourceLocked) {
    await c.query("UPDATE login_throttle SET failed = 0, locked_until = now() + make_interval(mins => $3) WHERE user_id = $1 AND source = $2",
      [u.id, source, PAIR_LOCK_MINUTES]);
  }
  await audit(c, actor, sourceLocked ? "auth.locked" : "auth.login_failed", "user", u.id, sourceLocked ? { scope: "origen", minutes: PAIR_LOCK_MINUTES } : {});

  const total = (await c.query<{ failed: number }>(
    `INSERT INTO login_account_guard AS g (user_id, failed) VALUES ($1, 1)
     ON CONFLICT (user_id) DO UPDATE SET
       failed = CASE WHEN g.window_start <= now() - make_interval(mins => $2) THEN 1 ELSE g.failed + 1 END,
       window_start = CASE WHEN g.window_start <= now() - make_interval(mins => $2) THEN now() ELSE g.window_start END,
       updated_at = now()
     RETURNING failed`, [u.id, ACCOUNT_WINDOW_MINUTES])).rows[0]!.failed;
  if (total < ACCOUNT_MAX_FAILED) return { sourceLocked, accountLocked: false };

  const nonce = randomUUID();
  await c.query(
    `UPDATE login_account_guard SET locked_until = now() + make_interval(mins => $2), failed = 0, window_start = now(),
            unlock_nonce = $3, unlock_expires_at = now() + make_interval(mins => $4), unlock_sent_at = now(), updated_at = now()
      WHERE user_id = $1`, [u.id, ACCOUNT_LOCK_MINUTES, nonce, UNLOCK_LINK_MINUTES]);
  await audit(c, actor, "auth.account_locked", "user", u.id, { failedInWindow: total, windowMinutes: ACCOUNT_WINDOW_MINUTES, minutes: ACCOUNT_LOCK_MINUTES });
  await audit(c, actor, "auth.unlock_link_sent", "user", u.id, { expiresInMinutes: UNLOCK_LINK_MINUTES });
  const link = unlockUrl(deps.cfg, u.id, nonce);
  // Sin esperar al servidor de correo: la respuesta en pantalla no cambia ni se demora, y un
  // fallo del correo no revela nada (queda en el registro del servidor).
  deps.mailer.send({
    to: u.email,
    subject: "Bloqueamos el ingreso a tu cuenta por seguridad",
    text: `Hola ${u.fullName}:\n\nHubo muchos intentos fallidos de ingresar a tu cuenta de Dentalia desde distintas conexiones, así que bloqueamos el ingreso por ${ACCOUNT_LOCK_MINUTES} minutos.\n\nSi quieres ingresar ahora, desbloquéala con este enlace (válido ${UNLOCK_LINK_MINUTES} minutos, un solo uso):\n\n${link}\n\nSi no fuiste tú, alguien está intentando adivinar tu contraseña. Tu contraseña no cambió; por precaución, cámbiala desde «Olvidé mi contraseña» y avisa al administrador de tu clínica.`,
  }).catch((e: unknown) => console.error(`[correo] No se pudo enviar el aviso de bloqueo: ${(e as Error).message ?? e}`));
  return { sourceLocked, accountLocked: true };
}

/** Ingreso correcto desde ese origen: su contador vuelve a cero (el global no, para no premiar al atacante). */
export async function clearSourceFailures(c: Client, userId: string, source: string) {
  await c.query("DELETE FROM login_throttle WHERE user_id = $1 AND source = $2", [userId, source]);
}

/** Quita todos los bloqueos de la cuenta (desbloqueo por administración o contraseña restablecida). */
export async function clearAllLocks(c: Client, userId: string): Promise<{ sources: number; account: boolean }> {
  const sources = (await c.query("DELETE FROM login_throttle WHERE user_id = $1 AND locked_until > now()", [userId])).rowCount ?? 0;
  await c.query("DELETE FROM login_throttle WHERE user_id = $1", [userId]);
  const account = !!(await c.query("SELECT 1 FROM login_account_guard WHERE user_id = $1 AND locked_until > now()", [userId])).rowCount;
  await c.query(
    `UPDATE login_account_guard SET locked_until = NULL, failed = 0, window_start = now(), unlock_nonce = NULL, unlock_expires_at = NULL, updated_at = now()
      WHERE user_id = $1`, [userId]);
  return { sources, account };
}

const zUnlockData = z.object({ u: z.uuid(), n: z.uuid() });

export function loginGuardRoutes(route: Route, cfg: Config) {
  route({
    method: "POST", url: "/api/auth/unlock",
    summary: "Desbloquear la propia cuenta con el enlace recibido por correo (firmado, de un solo uso y con vencimiento)",
    tags: ["auth"], access: "public",
    limit: cfg.disableRateLimit ? undefined : { max: 10, timeWindow: "1 minute" },
    body: z.object({ token: z.string().min(20).max(600) }),
    handler: async ({ body, req, c }) => {
      const v = verifyLink(cfg.keys.link, UNLOCK_PURPOSE, body.token);
      if (!v.ok && v.reason === "expired") {
        throw new AppError(410, "link_expired", "El enlace venció. Si sigues sin poder ingresar, usa «Olvidé mi contraseña» o pide al administrador de tu clínica que te desbloquee.");
      }
      const d = v.ok ? zUnlockData.safeParse(v.data) : null;
      if (!d?.success) throw new AppError(400, "invalid_token", "El enlace no es válido. Revisa que lo hayas copiado completo.");
      const r = await c.query(
        `UPDATE login_account_guard SET locked_until = NULL, failed = 0, window_start = now(), unlock_nonce = NULL, unlock_expires_at = NULL, updated_at = now()
          WHERE user_id = $1 AND unlock_nonce = $2 AND unlock_expires_at > now() RETURNING user_id`, [d.data.u, d.data.n]);
      if (!r.rowCount) throw new AppError(409, "link_used", "Este enlace ya se usó o fue reemplazado por uno más reciente.");
      // También se libera el origen desde el que la persona abre el enlace (su propia red).
      await clearSourceFailures(c, d.data.u, loginSource(req.ip));
      await audit(c, { userId: d.data.u, clinicId: null, ip: req.ip }, "auth.unlocked_by_link", "user", d.data.u);
      return { ok: true, message: "Listo: tu cuenta quedó desbloqueada. Ya puedes ingresar." };
    },
  });

  route({
    method: "GET", url: "/api/staff/locks", summary: "Personas de la clínica con el ingreso bloqueado por intentos fallidos", tags: ["personal"], perm: "staff.manage",
    handler: async ({ c, auth }) => (await c.query(
      `SELECT x."userId", x."sourceLockedUntil", x.sources, x."accountLockedUntil" FROM (
         SELECT m.user_id AS "userId",
                (SELECT max(t.locked_until) FROM login_throttle t WHERE t.user_id = m.user_id AND t.locked_until > now()) AS "sourceLockedUntil",
                (SELECT count(*)::int FROM login_throttle t WHERE t.user_id = m.user_id AND t.locked_until > now()) AS sources,
                (SELECT g.locked_until FROM login_account_guard g WHERE g.user_id = m.user_id AND g.locked_until > now()) AS "accountLockedUntil"
           FROM memberships m WHERE m.clinic_id = $1) x
        WHERE x.sources > 0 OR x."accountLockedUntil" IS NOT NULL`, [auth.clinicId])).rows,
  });

  route({
    method: "POST", url: "/api/staff/:id/unlock", summary: "Desbloquear el ingreso de una persona bloqueada por intentos fallidos (queda auditado)", tags: ["personal"], perm: "staff.manage",
    params: zIdParams,
    handler: async ({ c, auth, params }) => {
      const m = (await c.query("SELECT 1 FROM memberships WHERE clinic_id = $1 AND user_id = $2", [auth.clinicId, params.id])).rowCount;
      if (!m) throw notFound("Persona");
      const cleared = await clearAllLocks(c, params.id);
      await audit(c, auth, "auth.unlocked_by_admin", "user", params.id, cleared);
      return { ok: true, ...cleared };
    },
  });
}
