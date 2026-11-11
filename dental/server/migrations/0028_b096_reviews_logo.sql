-- =====================================================================
-- 0028 — B-096: revisión de plantillas de consentimiento y logo de la clínica.
--
--  * consent_template_reviews: «Marcar revisada» (quién y cuándo) sobre una
--    versión de plantilla. Es una marca INTERNA de la clínica (p. ej. «la
--    leyó nuestra asesoría»), no una declaración de validez legal. De solo
--    inserción: una revisión no se borra; una versión nueva de la plantilla
--    necesita su propia revisión.
--  * clinic_logos: historial del logo (el vigente es el último). Los bytes
--    viven en el almacenamiento privado (disco o S3) con clave aleatoria
--    bajo el prefijo de la clínica, como los archivos clínicos. Quitar el
--    logo es otra fila (removed = true). De solo inserción.
-- =====================================================================

CREATE TABLE consent_template_reviews (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id),
  template_id  uuid NOT NULL,
  reviewed_by  uuid NOT NULL,
  note         text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 300),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (template_id, clinic_id) REFERENCES consent_templates(id, clinic_id),
  FOREIGN KEY (clinic_id, reviewed_by) REFERENCES memberships(clinic_id, user_id)
);
CREATE INDEX consent_template_reviews_tpl_idx ON consent_template_reviews (clinic_id, template_id, created_at DESC);

CREATE TRIGGER consent_template_reviews_immutable BEFORE UPDATE OR DELETE ON consent_template_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE consent_template_reviews ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON consent_template_reviews
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
GRANT SELECT, INSERT ON consent_template_reviews TO dental_app;

CREATE TABLE clinic_logos (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES clinics(id),
  removed        boolean NOT NULL DEFAULT false,
  mime_type      text CHECK (mime_type IN ('image/png','image/jpeg')),
  width          smallint CHECK (width BETWEEN 16 AND 512),
  height         smallint CHECK (height BETWEEN 16 AND 512),
  size_bytes     int CHECK (size_bytes > 0 AND size_bytes <= 307200),
  sha256         text CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_driver text CHECK (storage_driver IN ('local','s3')),
  storage_key    text CHECK (storage_key ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9a-f]{32}$' AND left(storage_key, 36) = clinic_id::text),
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CONSTRAINT clinic_logos_key_uq UNIQUE (storage_key),
  -- Un logo vigente trae todos sus datos; una baja, ninguno.
  CONSTRAINT clinic_logos_shape CHECK (
    (removed AND mime_type IS NULL AND width IS NULL AND height IS NULL AND size_bytes IS NULL AND sha256 IS NULL AND storage_driver IS NULL AND storage_key IS NULL)
    OR (NOT removed AND mime_type IS NOT NULL AND width IS NOT NULL AND height IS NOT NULL AND size_bytes IS NOT NULL AND sha256 IS NOT NULL AND storage_driver IS NOT NULL AND storage_key IS NOT NULL)),
  FOREIGN KEY (clinic_id, created_by) REFERENCES memberships(clinic_id, user_id)
);
CREATE INDEX clinic_logos_current_idx ON clinic_logos (clinic_id, created_at DESC);

CREATE TRIGGER clinic_logos_immutable BEFORE UPDATE OR DELETE ON clinic_logos
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE clinic_logos ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clinic_logos
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
GRANT SELECT, INSERT ON clinic_logos TO dental_app;
