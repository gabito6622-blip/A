-- =====================================================================
-- 0012 — Documentos PDF con huella (B-064) y recetas, certificados y
--        derivaciones (R2-40).
--
--  * medications: catálogo de medicamentos por clínica (nombre genérico,
--    presentación, posología por defecto y grupos de alergia). Se siembra
--    con ~30 medicamentos de uso odontológico al crear la clínica (trigger)
--    y para las clínicas existentes. Nombres únicos sin distinguir
--    mayúsculas; los inactivos se conservan para el historial.
--  * clinical_documents: recetas, certificados y derivaciones EMITIDOS.
--    Emitir congela el documento (instantánea completa + SHA-256) y es de
--    solo inserción. Corregir = anular con motivo (clinical_document_voids,
--    también de solo inserción) y reemitir (reissue_of).
--  * pdf_documents: registro de cada PDF generado (recetas, certificados,
--    presupuestos aceptados, consentimientos firmados y recibos) con su
--    código de verificación público, la instantánea de datos, su huella y
--    el archivo PDF tal como se entregó. De solo inserción: el mismo
--    documento se sirve siempre con los mismos bytes.
-- =====================================================================

-- ---------------- Catálogo de medicamentos ----------------
CREATE TABLE medications (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            uuid NOT NULL REFERENCES clinics(id),
  generic_name         text NOT NULL CHECK (length(generic_name) BETWEEN 2 AND 120),
  presentation         text NOT NULL CHECK (length(presentation) BETWEEN 2 AND 120),
  default_dose         text CHECK (default_dose IS NULL OR length(default_dose) <= 80),
  default_frequency    text CHECK (default_frequency IS NULL OR length(default_frequency) <= 80),
  default_duration     text CHECK (default_duration IS NULL OR length(default_duration) <= 60),
  default_instructions text CHECK (default_instructions IS NULL OR length(default_instructions) <= 300),
  -- Grupos o principios para el aviso de alergias (minúsculas, sin tildes): {penicilina, betalactamico}
  allergy_tags         text[] NOT NULL DEFAULT '{}' CHECK (cardinality(allergy_tags) <= 12),
  active               boolean NOT NULL DEFAULT true,
  created_at           timestamptz NOT NULL DEFAULT now(),
  updated_at           timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id)
);
CREATE UNIQUE INDEX medications_name_uq ON medications (clinic_id, lower(generic_name), lower(presentation));

-- Siembra (sin duplicar) el catálogo inicial. SECURITY INVOKER: desde la app,
-- RLS impide sembrar otra clínica que no sea la activa.
-- Posologías referenciales para adultos: cada profesional las revisa al recetar.
CREATE OR REPLACE FUNCTION seed_medications(p_clinic uuid) RETURNS int
  LANGUAGE sql VOLATILE AS $$
  WITH ins AS (
    INSERT INTO medications (clinic_id, generic_name, presentation, default_dose, default_frequency, default_duration, default_instructions, allergy_tags)
    SELECT p_clinic, v.n, v.p, v.d, v.f, v.t, v.i, v.tags FROM (VALUES
      ('Amoxicilina', 'Cápsulas 500 mg', '1 cápsula', 'Cada 8 horas', '7 días', 'Vía oral. Completar el tratamiento aunque desaparezcan las molestias.', ARRAY['amoxicilina','penicilina','betalactamico']),
      ('Amoxicilina', 'Suspensión 250 mg/5 ml', 'Según peso (indicar ml)', 'Cada 8 horas', '7 días', 'Vía oral. Agitar antes de usar. Dosis pediátrica según peso.', ARRAY['amoxicilina','penicilina','betalactamico']),
      ('Amoxicilina + ácido clavulánico', 'Comprimidos 875/125 mg', '1 comprimido', 'Cada 12 horas', '7 días', 'Vía oral, al inicio de las comidas.', ARRAY['amoxicilina','clavulanico','penicilina','betalactamico']),
      ('Fenoximetilpenicilina (penicilina V)', 'Comprimidos 1 000 000 UI', '1 comprimido', 'Cada 6 horas', '7 días', 'Vía oral, una hora antes de las comidas.', ARRAY['penicilina','betalactamico']),
      ('Cefalexina', 'Cápsulas 500 mg', '1 cápsula', 'Cada 6 horas', '7 días', 'Vía oral.', ARRAY['cefalexina','cefalosporina','betalactamico']),
      ('Clindamicina', 'Cápsulas 300 mg', '1 cápsula', 'Cada 8 horas', '7 días', 'Vía oral, con un vaso lleno de agua.', ARRAY['clindamicina','lincosamida']),
      ('Azitromicina', 'Comprimidos 500 mg', '1 comprimido', 'Cada 24 horas', '3 días', 'Vía oral.', ARRAY['azitromicina','macrolido']),
      ('Claritromicina', 'Comprimidos 500 mg', '1 comprimido', 'Cada 12 horas', '7 días', 'Vía oral.', ARRAY['claritromicina','macrolido']),
      ('Metronidazol', 'Comprimidos 500 mg', '1 comprimido', 'Cada 8 horas', '7 días', 'Vía oral, con alimentos. No consumir alcohol durante el tratamiento ni 48 horas después.', ARRAY['metronidazol','nitroimidazol']),
      ('Doxiciclina', 'Cápsulas 100 mg', '1 cápsula', 'Cada 12 horas', '7 días', 'Vía oral, con abundante agua y sin acostarse en los 30 minutos siguientes.', ARRAY['doxiciclina','tetraciclina']),
      ('Ibuprofeno', 'Comprimidos 400 mg', '1 comprimido', 'Cada 8 horas', '3 días', 'Vía oral, después de las comidas.', ARRAY['ibuprofeno','aine','aspirina','acetilsalicilico']),
      ('Ibuprofeno', 'Comprimidos 600 mg', '1 comprimido', 'Cada 8 horas', '3 días', 'Vía oral, después de las comidas.', ARRAY['ibuprofeno','aine','aspirina','acetilsalicilico']),
      ('Ibuprofeno', 'Suspensión 100 mg/5 ml', 'Según peso (indicar ml)', 'Cada 8 horas', '3 días', 'Vía oral, después de las comidas. Dosis pediátrica según peso.', ARRAY['ibuprofeno','aine','aspirina','acetilsalicilico']),
      ('Paracetamol', 'Comprimidos 500 mg', '1 a 2 comprimidos', 'Cada 8 horas', '3 días', 'Vía oral. No superar 4 g al día.', ARRAY['paracetamol','acetaminofen']),
      ('Paracetamol', 'Jarabe 120 mg/5 ml', 'Según peso (indicar ml)', 'Cada 6 horas', '3 días', 'Vía oral. Dosis pediátrica según peso.', ARRAY['paracetamol','acetaminofen']),
      ('Ketorolaco', 'Comprimidos 10 mg', '1 comprimido', 'Cada 8 horas', '3 días (máximo 5)', 'Vía oral, después de las comidas.', ARRAY['ketorolaco','aine','aspirina','acetilsalicilico']),
      ('Ketorolaco', 'Ampolla 30 mg/ml', '1 ampolla', 'Dosis única', '1 día', 'Vía intramuscular, en el consultorio.', ARRAY['ketorolaco','aine','aspirina','acetilsalicilico']),
      ('Diclofenaco sódico', 'Comprimidos 50 mg', '1 comprimido', 'Cada 8 horas', '3 días', 'Vía oral, después de las comidas.', ARRAY['diclofenaco','aine','aspirina','acetilsalicilico']),
      ('Naproxeno sódico', 'Comprimidos 550 mg', '1 comprimido', 'Cada 12 horas', '3 días', 'Vía oral, después de las comidas.', ARRAY['naproxeno','aine','aspirina','acetilsalicilico']),
      ('Nimesulida', 'Comprimidos 100 mg', '1 comprimido', 'Cada 12 horas', '3 días', 'Vía oral, después de las comidas.', ARRAY['nimesulida','aine','aspirina','acetilsalicilico']),
      ('Metamizol sódico', 'Comprimidos 500 mg', '1 comprimido', 'Cada 8 horas', '3 días', 'Vía oral.', ARRAY['metamizol','dipirona','pirazolona']),
      ('Tramadol', 'Cápsulas 50 mg', '1 cápsula', 'Cada 8 horas', '3 días', 'Vía oral. Puede causar somnolencia: no conducir ni consumir alcohol.', ARRAY['tramadol','opioide']),
      ('Dexametasona', 'Comprimidos 4 mg', '1 comprimido', 'Cada 24 horas', '3 días', 'Vía oral, por la mañana con alimentos.', ARRAY['dexametasona','corticoide']),
      ('Dexametasona', 'Ampolla 8 mg/2 ml', '1 ampolla', 'Dosis única', '1 día', 'Vía intramuscular, en el consultorio.', ARRAY['dexametasona','corticoide']),
      ('Prednisona', 'Comprimidos 20 mg', '1 comprimido', 'Cada 24 horas', '3 días', 'Vía oral, por la mañana con alimentos.', ARRAY['prednisona','corticoide']),
      ('Clorhexidina', 'Colutorio 0,12 %', '15 ml', 'Cada 12 horas', '7 días', 'Enjuagar 30 segundos y escupir. No tragar. No comer ni beber en los 30 minutos siguientes.', ARRAY['clorhexidina']),
      ('Clorhexidina', 'Gel bucal 0,2 %', 'Capa fina', 'Cada 12 horas', '7 días', 'Aplicar sobre la zona indicada después del cepillado.', ARRAY['clorhexidina']),
      ('Bencidamina', 'Colutorio 0,15 %', '15 ml', 'Cada 8 horas', '5 días', 'Enjuagar y escupir. No tragar.', ARRAY['bencidamina']),
      ('Aciclovir', 'Crema 5 %', 'Capa fina', '5 veces al día', '5 días', 'Aplicar sobre la lesión del labio con las manos limpias.', ARRAY['aciclovir']),
      ('Aciclovir', 'Comprimidos 400 mg', '1 comprimido', 'Cada 8 horas', '5 días', 'Vía oral.', ARRAY['aciclovir']),
      ('Nistatina', 'Suspensión oral 100 000 UI/ml', '5 ml', 'Cada 6 horas', '14 días', 'Mantener en la boca un minuto y luego tragar.', ARRAY['nistatina']),
      ('Fluconazol', 'Cápsulas 150 mg', '1 cápsula', 'Cada 24 horas', '7 días', 'Vía oral.', ARRAY['fluconazol','azol']),
      ('Lidocaína', 'Gel tópico 2 %', 'Capa fina', 'Cada 8 horas si hay dolor', '3 días', 'Aplicar sobre la zona dolorosa. No comer hasta que pase el adormecimiento.', ARRAY['lidocaina','anestesico local']),
      ('Fluoruro de sodio', 'Pasta dental 1,1 % (5000 ppm)', 'Cepillado', 'Una vez al día, antes de dormir', '3 meses', 'Escupir sin enjuagar. No tragar. No usar en menores de 16 años.', ARRAY['fluor']),
      ('Loratadina', 'Comprimidos 10 mg', '1 comprimido', 'Cada 24 horas', '5 días', 'Vía oral.', ARRAY['loratadina','antihistaminico']),
      ('Omeprazol', 'Cápsulas 20 mg', '1 cápsula', 'Cada 24 horas, en ayunas', 'Mientras tome el antiinflamatorio', 'Vía oral, 30 minutos antes del desayuno.', ARRAY['omeprazol'])
    ) AS v(n, p, d, f, t, i, tags)
    ON CONFLICT (clinic_id, lower(generic_name), lower(presentation)) DO NOTHING
    RETURNING 1
  )
  SELECT count(*)::int FROM ins
$$;

CREATE OR REPLACE FUNCTION clinics_seed_medications() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM seed_medications(NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER clinics_seed_medications AFTER INSERT ON clinics FOR EACH ROW EXECUTE FUNCTION clinics_seed_medications();
SELECT seed_medications(id) FROM clinics;

-- ---------------- Recetas, certificados y derivaciones emitidos ----------------
CREATE TABLE clinical_documents (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id            uuid NOT NULL REFERENCES clinics(id),
  patient_id           uuid NOT NULL,
  branch_id            uuid NOT NULL,
  kind                 text NOT NULL CHECK (kind IN ('prescription','certificate','referral')),
  template             text CHECK (template IS NULL OR template IN ('attendance','rest','treatment','referral')),
  number               bigint NOT NULL CHECK (number > 0),
  title                text NOT NULL CHECK (length(title) BETWEEN 3 AND 150),
  summary              text NOT NULL CHECK (length(summary) BETWEEN 1 AND 500),   -- para listados (sin abrir el PDF)
  snapshot             jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),   -- datos congelados con los que se generó el PDF
  issuer_id            uuid NOT NULL,
  issuer_name          text NOT NULL,
  issuer_license       text,                                                       -- matrícula al momento de emitir (puede faltar: aviso, no bloqueo)
  allergy_warnings     jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(allergy_warnings) = 'array'),
  allergy_acknowledged boolean NOT NULL DEFAULT false,
  reissue_of           uuid,
  note_id              uuid,                                                       -- nota clínica que lo registra en la historia
  content_hash         text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),      -- SHA-256 de la instantánea canónica
  issued_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, kind, number),
  -- Con un posible conflicto de alergia, solo se emite si el profesional marcó "Revisé la alergia".
  CHECK (jsonb_array_length(allergy_warnings) = 0 OR allergy_acknowledged),
  CHECK ((kind = 'prescription') = (template IS NULL)),
  CHECK (kind <> 'referral' OR template = 'referral'),
  CHECK (kind <> 'certificate' OR template IN ('attendance','rest','treatment')),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (clinic_id, issuer_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (reissue_of, clinic_id) REFERENCES clinical_documents(id, clinic_id),
  FOREIGN KEY (note_id, clinic_id) REFERENCES clinical_notes(id, clinic_id)
);
CREATE INDEX clinical_documents_patient_idx ON clinical_documents (clinic_id, patient_id, issued_at DESC);
CREATE UNIQUE INDEX clinical_documents_reissue_once ON clinical_documents (reissue_of) WHERE reissue_of IS NOT NULL;

CREATE TABLE clinical_document_voids (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id),
  document_id  uuid NOT NULL,
  reason       text NOT NULL CHECK (length(reason) BETWEEN 3 AND 500),
  voided_by    uuid NOT NULL REFERENCES users(id),
  voided_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CONSTRAINT clinical_document_void_once UNIQUE (document_id),
  FOREIGN KEY (document_id, clinic_id) REFERENCES clinical_documents(id, clinic_id)
);

-- Solo se reemite un documento anulado, del mismo paciente y tipo.
CREATE OR REPLACE FUNCTION clinical_documents_reissue_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  IF NEW.reissue_of IS NULL THEN RETURN NEW; END IF;
  SELECT patient_id, kind INTO o FROM clinical_documents WHERE id = NEW.reissue_of;
  IF o.patient_id IS DISTINCT FROM NEW.patient_id OR o.kind IS DISTINCT FROM NEW.kind
     OR NOT EXISTS (SELECT 1 FROM clinical_document_voids v WHERE v.document_id = NEW.reissue_of) THEN
    RAISE EXCEPTION 'Solo se reemite un documento anulado del mismo paciente y tipo' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER clinical_documents_reissue_guard BEFORE INSERT ON clinical_documents
  FOR EACH ROW EXECUTE FUNCTION clinical_documents_reissue_guard();

CREATE TRIGGER clinical_documents_immutable BEFORE UPDATE OR DELETE ON clinical_documents
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER clinical_document_voids_immutable BEFORE UPDATE OR DELETE ON clinical_document_voids
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Registro de PDF emitidos ----------------
CREATE TABLE pdf_documents (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  kind          text NOT NULL CHECK (kind IN ('prescription','certificate','referral','budget','consent','receipt')),
  source_id     uuid NOT NULL,                       -- documento clínico, presupuesto, documento firmado o pago
  variant       text NOT NULL DEFAULT 'original' CHECK (variant IN ('original','voided')),
  verify_code   text NOT NULL CHECK (verify_code ~ '^[0-9A-HJKMNP-TV-Z]{12}$'),   -- base32 de Crockford, 60 bits
  doc_number    text NOT NULL CHECK (length(doc_number) BETWEEN 1 AND 40),
  title         text NOT NULL CHECK (length(title) BETWEEN 3 AND 150),
  branch_id     uuid NOT NULL,
  issued_at     timestamptz NOT NULL,
  snapshot      jsonb NOT NULL CHECK (jsonb_typeof(snapshot) = 'object'),
  content_hash  text NOT NULL CHECK (content_hash ~ '^[0-9a-f]{64}$'),           -- huella impresa en el pie
  pdf           bytea NOT NULL CHECK (length(pdf) BETWEEN 200 AND 15000000),
  pdf_sha256    text NOT NULL CHECK (pdf_sha256 ~ '^[0-9a-f]{64}$'),
  generated_by  uuid REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CONSTRAINT pdf_documents_code_uq UNIQUE (verify_code),
  CONSTRAINT pdf_documents_source_uq UNIQUE (clinic_id, kind, source_id, variant),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE TRIGGER pdf_documents_immutable BEFORE UPDATE OR DELETE ON pdf_documents
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Página pública de verificación: resuelve SOLO la clínica de un código (ignora RLS a
-- propósito y no devuelve nada más). El resto se lee con RLS fijando esa clínica.
CREATE OR REPLACE FUNCTION pdf_document_clinic(p_code text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT clinic_id FROM pdf_documents WHERE verify_code = p_code $$;
REVOKE ALL ON FUNCTION pdf_document_clinic(text) FROM PUBLIC;

-- ---------------- RLS y privilegios ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['medications','clinical_documents','clinical_document_voids','pdf_documents'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON medications TO dental_app;
GRANT UPDATE (generic_name, presentation, default_dose, default_frequency, default_duration, default_instructions, allergy_tags, active, updated_at) ON medications TO dental_app;
GRANT SELECT, INSERT ON clinical_documents, clinical_document_voids, pdf_documents TO dental_app;
GRANT EXECUTE ON FUNCTION seed_medications(uuid) TO dental_app;
GRANT EXECUTE ON FUNCTION pdf_document_clinic(text) TO dental_app;
