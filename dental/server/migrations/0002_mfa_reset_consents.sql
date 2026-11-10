-- =====================================================================
-- 0002 — Verificación en dos pasos, recuperación de contraseña,
--        consentimientos versionados y documentos firmados.
-- =====================================================================

-- ---------------- Verificación en dos pasos (TOTP) ----------------
ALTER TABLE users
  ADD COLUMN mfa_secret_enc text,                 -- secreto TOTP cifrado (AES-256-GCM, clave fuera de la base)
  ADD COLUMN mfa_pending_secret_enc text,         -- secreto en proceso de activación
  ADD COLUMN mfa_enabled_at timestamptz,
  ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

ALTER TABLE sessions
  ADD COLUMN mfa_pending boolean NOT NULL DEFAULT false,   -- contraseña correcta, falta el segundo paso
  ADD COLUMN mfa_failed int NOT NULL DEFAULT 0;

CREATE TABLE mfa_recovery_codes (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  code_hash   bytea NOT NULL UNIQUE,
  used_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX mfa_recovery_user_idx ON mfa_recovery_codes (user_id);

-- ---------------- Recuperación de contraseña ----------------
CREATE TABLE password_resets (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users(id),
  token_hash  bytea NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  used_at     timestamptz,
  ip          text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX password_resets_user_idx ON password_resets (user_id, created_at DESC);

-- Cantidad de clínicas a las que pertenece un usuario (ignora RLS a propósito, solo devuelve un número).
-- Se usa para impedir que una clínica restablezca credenciales de alguien que también trabaja en otra.
CREATE OR REPLACE FUNCTION user_clinic_count(p_user uuid) RETURNS int
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT count(*)::int FROM memberships WHERE user_id = p_user $$;
REVOKE ALL ON FUNCTION user_clinic_count(uuid) FROM PUBLIC;

-- ---------------- Consentimientos y documentos firmados ----------------
CREATE TABLE consent_templates (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  kind        text NOT NULL CHECK (kind IN ('data_processing','reminders','marketing','informed_consent')),
  title       text NOT NULL,
  body        text NOT NULL CHECK (length(body) BETWEEN 20 AND 30000),
  version     int NOT NULL CHECK (version > 0),
  category    text,                                   -- p. ej. 'Cirugía' para consentimientos por especialidad
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, kind, title, version)
);

CREATE TABLE signed_documents (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id),
  patient_id          uuid NOT NULL,
  branch_id           uuid NOT NULL,
  template_id         uuid,
  kind                text NOT NULL CHECK (kind IN ('data_processing','reminders','marketing','informed_consent')),
  title               text NOT NULL,
  body                text NOT NULL,                  -- copia exacta del texto aceptado o rechazado
  template_version    int,
  decision            text NOT NULL CHECK (decision IN ('granted','refused','revoked')),
  method              text NOT NULL CHECK (method IN ('signature_pad','paper_signed','staff_registered')),
  signer_name         text NOT NULL,
  signer_document     text,
  signer_relationship text NOT NULL DEFAULT 'self' CHECK (signer_relationship IN ('self','guardian','legal_representative')),
  signature_png       text CHECK (signature_png IS NULL OR (signature_png LIKE 'data:image/png;base64,%' AND length(signature_png) < 400000)),
  budget_id           uuid,
  notes               text,
  content_hash        text NOT NULL,                  -- SHA-256 de texto + firmante + decisión + fecha + firma
  recorded_by         uuid NOT NULL REFERENCES users(id),
  signed_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK (method <> 'signature_pad' OR signature_png IS NOT NULL),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (template_id, clinic_id) REFERENCES consent_templates(id, clinic_id),
  FOREIGN KEY (budget_id, clinic_id) REFERENCES budgets(id, clinic_id)
);
CREATE INDEX signed_documents_patient_idx ON signed_documents (clinic_id, patient_id, signed_at DESC);

CREATE TRIGGER signed_documents_immutable BEFORE UPDATE OR DELETE ON signed_documents
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE consent_templates ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_templates USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
ALTER TABLE signed_documents ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON signed_documents USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

-- ---------------- Privilegios ----------------
GRANT UPDATE (mfa_secret_enc, mfa_pending_secret_enc, mfa_enabled_at, must_change_password) ON users TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON mfa_recovery_codes TO dental_app;
GRANT SELECT, INSERT, UPDATE ON password_resets TO dental_app;
GRANT EXECUTE ON FUNCTION user_clinic_count(uuid) TO dental_app;
GRANT SELECT, INSERT ON consent_templates TO dental_app;
GRANT UPDATE (active) ON consent_templates TO dental_app;
GRANT SELECT, INSERT ON signed_documents TO dental_app;
