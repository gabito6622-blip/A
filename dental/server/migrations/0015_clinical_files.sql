-- =====================================================================
-- 0015 — Archivos clínicos e imágenes (B-012).
--
--  * clinical_files: radiografías, fotos intraorales y extraorales,
--    documentos escaneados y otros archivos del paciente. Solo metadatos:
--    los bytes viven en el almacenamiento privado (lib/filestore.ts) bajo una
--    clave aleatoria que empieza con el id de la clínica; el nombre que manda
--    el usuario NUNCA forma parte de la ruta. El tipo real (mime_type) sale
--    de la firma de bytes, no de la extensión. SHA-256 por archivo y
--    anti-duplicado por hash dentro del mismo paciente. De solo inserción.
--  * clinical_file_events: archivar y restaurar con motivo. El estado
--    vigente es el último evento (seq impar = archivado). También de solo
--    inserción; el trigger numera los eventos y rechaza transiciones
--    inválidas (archivar dos veces, restaurar algo vigente). Dos personas a
--    la vez chocan en UNIQUE (file_id, seq).
--  * Cada descarga o visualización queda en audit_log (lo hace la API).
-- =====================================================================

CREATE TABLE clinical_files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES clinics(id),
  patient_id     uuid NOT NULL,
  branch_id      uuid NOT NULL,
  kind           text NOT NULL CHECK (kind IN ('xray_periapical','xray_panoramic','photo_intraoral','photo_extraoral','scanned_document','other')),
  -- Piezas FDI (permanentes y temporales) opcionales.
  teeth          smallint[] NOT NULL DEFAULT '{}' CHECK (
                   cardinality(teeth) <= 16 AND teeth <@ ARRAY[
                     11,12,13,14,15,16,17,18,21,22,23,24,25,26,27,28,31,32,33,34,35,36,37,38,41,42,43,44,45,46,47,48,
                     51,52,53,54,55,61,62,63,64,65,71,72,73,74,75,81,82,83,84,85]::smallint[]),
  taken_on       date NOT NULL CHECK (taken_on >= DATE '1950-01-01'),
  description    text CHECK (description IS NULL OR length(description) BETWEEN 1 AND 500),
  original_name  text CHECK (original_name IS NULL OR length(original_name) BETWEEN 1 AND 200),   -- solo para mostrar
  mime_type      text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf','application/dicom')),
  size_bytes     bigint NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 104857600),
  sha256         text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_driver text NOT NULL DEFAULT 'local' CHECK (storage_driver IN ('local','s3')),
  storage_key    text NOT NULL CHECK (storage_key ~ '^[0-9a-f-]{36}/[0-9]{4}/[0-9a-f]{32}$' AND left(storage_key, 36) = clinic_id::text),
  uploaded_by    uuid NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CONSTRAINT clinical_files_key_uq UNIQUE (storage_key),
  CONSTRAINT clinical_files_hash_uq UNIQUE (clinic_id, patient_id, sha256),
  -- El DICOM es solo de radiografías u "otro"; el PDF, de documentos u "otro"; las fotos, imágenes.
  CHECK (mime_type <> 'application/dicom' OR kind IN ('xray_periapical','xray_panoramic','other')),
  CHECK (mime_type <> 'application/pdf' OR kind IN ('scanned_document','other')),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (clinic_id, uploaded_by) REFERENCES memberships(clinic_id, user_id)
);
CREATE INDEX clinical_files_patient_idx ON clinical_files (clinic_id, patient_id, taken_on DESC, created_at DESC);

CREATE TABLE clinical_file_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  file_id     uuid NOT NULL,
  seq         int NOT NULL CHECK (seq > 0),
  kind        text NOT NULL CHECK (kind IN ('archived','restored')),
  reason      text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CONSTRAINT clinical_file_events_seq_uq UNIQUE (file_id, seq),
  -- Alternancia: 1 archivado, 2 restaurado, 3 archivado…
  CONSTRAINT clinical_file_events_alternate CHECK ((kind = 'archived') = (seq % 2 = 1)),
  FOREIGN KEY (file_id, clinic_id) REFERENCES clinical_files(id, clinic_id),
  FOREIGN KEY (clinic_id, user_id) REFERENCES memberships(clinic_id, user_id)
);
CREATE INDEX clinical_file_events_file_idx ON clinical_file_events (file_id, seq DESC);

-- Numera el evento y rechaza transiciones inválidas con un mensaje claro.
CREATE OR REPLACE FUNCTION clinical_file_events_seq() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE last_seq int;
BEGIN
  SELECT COALESCE(max(seq), 0) INTO last_seq FROM clinical_file_events WHERE file_id = NEW.file_id;
  NEW.seq := last_seq + 1;
  IF NEW.kind = 'archived' AND NEW.seq % 2 = 0 THEN
    RAISE EXCEPTION 'El archivo ya está archivado' USING ERRCODE = 'check_violation';
  ELSIF NEW.kind = 'restored' AND NEW.seq % 2 = 1 THEN
    RAISE EXCEPTION 'El archivo no está archivado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clinical_file_events_seq BEFORE INSERT ON clinical_file_events
  FOR EACH ROW EXECUTE FUNCTION clinical_file_events_seq();

CREATE TRIGGER clinical_files_immutable BEFORE UPDATE OR DELETE ON clinical_files
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER clinical_file_events_immutable BEFORE UPDATE OR DELETE ON clinical_file_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- RLS y privilegios ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['clinical_files','clinical_file_events'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON clinical_files, clinical_file_events TO dental_app;
