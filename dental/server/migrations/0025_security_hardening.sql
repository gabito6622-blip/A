-- =====================================================================
-- 0025 — Endurecimiento de seguridad (B-090, B-091, B-093; Equipo T)
--
--  * B-090: bloqueo por intentos fallidos por CUENTA + ORIGEN (IP) y límite global por cuenta
--    con enlace de desbloqueo por correo. Reemplaza users.failed_logins / users.locked_until,
--    que bloqueaban la cuenta entera (cualquiera podía dejar fuera a la persona) y revelaban
--    que el correo existía.
--  * B-091: dental_app ya no puede leer los secretos de la tabla users (hash de la contraseña,
--    secreto TOTP cifrado y el pendiente de activación) ni el hash de los códigos de
--    recuperación (8 caracteres: un SHA-256 sin sal se adivina fuera de línea). El ingreso, el
--    cambio de clave y los 2 pasos usan funciones SECURITY DEFINER mínimas.
--  * B-093: la respuesta «BAJA» de WhatsApp se asocia por el número completo (E.164), nunca por
--    los últimos 8 dígitos; y las respuestas guardan la sucursal para filtrarlas por sucursal.
-- =====================================================================

-- ---------------------------------------------------------------------
-- B-090 · Intentos fallidos por cuenta + origen, y límite global por cuenta
-- ---------------------------------------------------------------------
-- Por cuenta y origen (IP; en IPv6, el prefijo /64): 5 fallos seguidos bloquean SOLO esa
-- combinación durante 15 minutos. La persona puede seguir entrando desde otra red.
CREATE TABLE login_throttle (
  user_id       uuid NOT NULL REFERENCES users(id),
  source        text NOT NULL CHECK (length(source) BETWEEN 1 AND 64),
  failed        int  NOT NULL DEFAULT 0 CHECK (failed >= 0),
  locked_until  timestamptz,
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, source)
);
CREATE INDEX login_throttle_locked_idx ON login_throttle (user_id) WHERE locked_until IS NOT NULL;

-- Por cuenta (todas las redes): un límite más alto por hora frena los ataques distribuidos.
-- Al alcanzarlo se bloquea la cuenta y se envía a la persona un enlace de desbloqueo firmado,
-- de un solo uso (unlock_nonce) y con vencimiento (unlock_expires_at).
CREATE TABLE login_account_guard (
  user_id            uuid PRIMARY KEY REFERENCES users(id),
  window_start       timestamptz NOT NULL DEFAULT now(),
  failed             int  NOT NULL DEFAULT 0 CHECK (failed >= 0),
  locked_until       timestamptz,
  unlock_nonce       uuid,
  unlock_expires_at  timestamptz,
  unlock_sent_at     timestamptz,
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CHECK ((unlock_nonce IS NULL) = (unlock_expires_at IS NULL))
);

ALTER TABLE users DROP COLUMN failed_logins, DROP COLUMN locked_until;

GRANT SELECT, INSERT, UPDATE, DELETE ON login_throttle TO dental_app;
GRANT SELECT, INSERT, UPDATE ON login_account_guard TO dental_app;

-- ---------------------------------------------------------------------
-- B-091 · Columnas secretas de users y de los códigos de recuperación
-- ---------------------------------------------------------------------
-- REVOKE a nivel de tabla también quita los privilegios por columna; luego se otorgan solo las
-- columnas que la app necesita. Quedan FUERA de la lectura: password_hash, mfa_secret_enc,
-- mfa_pending_secret_enc. INSERT solo de las columnas que usa el alta de personal (nunca
-- is_platform_admin ni disabled_at).
REVOKE SELECT, INSERT, UPDATE ON users FROM dental_app;
GRANT SELECT (id, email, full_name, is_platform_admin, disabled_at, password_changed_at, created_at, mfa_enabled_at, must_change_password)
  ON users TO dental_app;
GRANT INSERT (email, full_name, password_hash, must_change_password) ON users TO dental_app;
GRANT UPDATE (full_name, password_hash, password_changed_at, mfa_secret_enc, mfa_pending_secret_enc, mfa_enabled_at, must_change_password)
  ON users TO dental_app;

REVOKE SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes FROM dental_app;
GRANT SELECT (id, user_id, used_at, created_at) ON mfa_recovery_codes TO dental_app;
GRANT INSERT (user_id, code_hash) ON mfa_recovery_codes TO dental_app;
GRANT DELETE ON mfa_recovery_codes TO dental_app;

-- Parámetros y sal del hash (scrypt$N$r$p$sal), SIN el resultado: con esto la app calcula el
-- hash de la contraseña escrita y lo compara con auth_password_matches. Una cuenta deshabilitada
-- o un formato desconocido devuelven NULL.
CREATE OR REPLACE FUNCTION auth_password_salt(p_user uuid) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT CASE WHEN u.password_hash ~ '^scrypt\$[0-9]{1,8}\$[0-9]{1,3}\$[0-9]{1,3}\$[A-Za-z0-9+/=]{8,64}\$[A-Za-z0-9+/=]{16,128}$'
                 THEN regexp_replace(u.password_hash, '\$[^$]*$', '') END
       FROM users u WHERE u.id = p_user AND u.disabled_at IS NULL $$;
REVOKE ALL ON FUNCTION auth_password_salt(uuid) FROM PUBLIC;

-- ¿El hash calculado por la app coincide con el guardado? Compara los SHA-256 de ambos (el tiempo
-- no depende de cuántos caracteres coinciden) y nunca devuelve el hash.
CREATE OR REPLACE FUNCTION auth_password_matches(p_user uuid, p_candidate text) RETURNS boolean
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT COALESCE((SELECT sha256(convert_to(u.password_hash, 'UTF8')) = sha256(convert_to(coalesce(p_candidate, ''), 'UTF8'))
                        FROM users u WHERE u.id = p_user AND u.disabled_at IS NULL), false) $$;
REVOKE ALL ON FUNCTION auth_password_matches(uuid, text) FROM PUBLIC;

-- Secreto TOTP cifrado (vigente o pendiente de activación) SOLO del usuario de la sesión
-- (app.user_id que fija withTenant): no sirve para leer el de otra persona.
CREATE OR REPLACE FUNCTION auth_my_mfa_secret(p_pending boolean) RETURNS text
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT CASE WHEN p_pending THEN u.mfa_pending_secret_enc ELSE u.mfa_secret_enc END
       FROM users u WHERE u.id = app_user_id() AND u.disabled_at IS NULL $$;
REVOKE ALL ON FUNCTION auth_my_mfa_secret(boolean) FROM PUBLIC;

-- Usa (una sola vez) un código de recuperación del usuario de la sesión: true si existía sin usar.
CREATE OR REPLACE FUNCTION auth_use_recovery_code(p_hash bytea) RETURNS boolean
  LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS
  $$ WITH used AS (
       UPDATE mfa_recovery_codes SET used_at = now()
        WHERE user_id = app_user_id() AND code_hash = p_hash AND used_at IS NULL RETURNING 1)
     SELECT count(*) = 1 FROM used $$;
REVOKE ALL ON FUNCTION auth_use_recovery_code(bytea) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION auth_password_salt(uuid), auth_password_matches(uuid, text), auth_my_mfa_secret(boolean),
  auth_use_recovery_code(bytea) TO dental_app;

-- ---------------------------------------------------------------------
-- B-093 · «BAJA» por número completo (E.164)
-- ---------------------------------------------------------------------
-- Normaliza un celular a E.164. Bolivia por defecto: 8 dígitos que empiezan con 6 o 7 → +591.
-- Con «+» o «00» se respeta el código de país; 10 a 15 dígitos sin prefijo se toman como
-- internacionales (así llegan los números en el webhook de WhatsApp). Si no se puede, NULL.
CREATE OR REPLACE FUNCTION phone_e164(p text) RETURNS text
  LANGUAGE sql IMMUTABLE PARALLEL SAFE AS
  $$ SELECT CASE
       WHEN d = '' THEN NULL
       WHEN btrim(coalesce(p, '')) LIKE '+%' THEN CASE WHEN length(d) BETWEEN 8 AND 15 THEN '+' || d END
       WHEN d ~ '^00[1-9]' THEN CASE WHEN length(d) BETWEEN 10 AND 17 THEN '+' || substr(d, 3) END
       WHEN d ~ '^[67][0-9]{7}$' THEN '+591' || d
       WHEN length(d) BETWEEN 10 AND 15 THEN '+' || d
     END
     FROM (SELECT regexp_replace(coalesce(p, ''), '\D', '', 'g') AS d) x $$;

-- La función anterior asociaba por los últimos 8 dígitos (dos pacientes de clínicas distintas
-- podían coincidir). Se elimina para que nadie vuelva a usarla.
DROP FUNCTION messaging_last_outbound_to(text);

-- Clínica, paciente, finalidad y sucursal del ÚLTIMO WhatsApp enviado a ese número exacto.
CREATE OR REPLACE FUNCTION messaging_last_outbound_to_number(p_number text)
  RETURNS TABLE (clinic_id uuid, patient_id uuid, purpose text, branch_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT m.clinic_id, m.patient_id, m.purpose, m.branch_id FROM outbound_messages m
      WHERE phone_e164(p_number) IS NOT NULL AND phone_e164(m.recipient) = phone_e164(p_number)
        AND m.patient_id IS NOT NULL AND m.channel = 'whatsapp'
      ORDER BY m.created_at DESC LIMIT 1 $$;
REVOKE ALL ON FUNCTION messaging_last_outbound_to_number(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION messaging_last_outbound_to_number(text) TO dental_app;

CREATE INDEX outbound_messages_e164_idx ON outbound_messages (phone_e164(recipient), created_at DESC)
  WHERE patient_id IS NOT NULL AND channel = 'whatsapp';

-- Respuestas recibidas: sucursal del mensaje original (para filtrar la bandeja por sucursal).
ALTER TABLE inbound_messages ADD COLUMN branch_id uuid,
  ADD CONSTRAINT inbound_messages_branch_fk FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id);
