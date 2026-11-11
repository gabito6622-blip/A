-- =====================================================================
-- 0023 — Miniaturas de archivos clínicos (B-081).
--
--  * clinical_file_thumbs: una miniatura (≤ 400 px por lado, ≤ 100 KB)
--    por imagen clínica. La genera el NAVEGADOR al subir (canvas, WebP o
--    JPEG; la semilla demo usa PNG) y el servidor la valida por firma de
--    bytes y dimensiones. La galería muestra la miniatura; el original
--    solo se entrega (y se audita) al abrirlo en el visor.
--  * Los bytes viven en el mismo almacenamiento privado que los
--    originales (disco o S3 compatible), bajo su propia clave aleatoria con
--    el prefijo de la clínica. De solo inserción, como clinical_files.
--  * Un archivo antiguo sin miniatura sigue funcionando: la galería
--    muestra un marcador.
-- =====================================================================

CREATE TABLE clinical_file_thumbs (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES clinics(id),
  file_id        uuid NOT NULL,
  mime_type      text NOT NULL CHECK (mime_type IN ('image/jpeg','image/webp','image/png')),
  width          smallint NOT NULL CHECK (width BETWEEN 1 AND 400),
  height         smallint NOT NULL CHECK (height BETWEEN 1 AND 400),
  size_bytes     int NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 102400),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_driver text NOT NULL CHECK (storage_driver IN ('local','s3')),
  storage_key    text NOT NULL CHECK (storage_key ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9a-f]{32}$' AND left(storage_key, 36) = clinic_id::text),
  created_by     uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CONSTRAINT clinical_file_thumbs_file_uq UNIQUE (file_id),
  CONSTRAINT clinical_file_thumbs_key_uq UNIQUE (storage_key),
  FOREIGN KEY (file_id, clinic_id) REFERENCES clinical_files(id, clinic_id),
  FOREIGN KEY (clinic_id, created_by) REFERENCES memberships(clinic_id, user_id)
);

-- Solo las imágenes llevan miniatura (un PDF o un DICOM no).
CREATE OR REPLACE FUNCTION clinical_file_thumbs_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m text;
BEGIN
  SELECT mime_type INTO m FROM clinical_files WHERE id = NEW.file_id AND clinic_id = NEW.clinic_id;
  IF m IS NULL OR m NOT IN ('image/jpeg','image/png','image/webp') THEN
    RAISE EXCEPTION 'Solo las imágenes llevan miniatura' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clinical_file_thumbs_check BEFORE INSERT ON clinical_file_thumbs
  FOR EACH ROW EXECUTE FUNCTION clinical_file_thumbs_check();

CREATE TRIGGER clinical_file_thumbs_immutable BEFORE UPDATE OR DELETE ON clinical_file_thumbs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE clinical_file_thumbs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON clinical_file_thumbs
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

GRANT SELECT, INSERT ON clinical_file_thumbs TO dental_app;
