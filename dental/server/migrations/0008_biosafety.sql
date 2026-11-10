-- =====================================================================
-- 0008 — Bioseguridad: limpieza de consultorios y trazabilidad de esterilización.
-- Nuevo rol 'support' (limpieza y apoyo) con acceso solo a este módulo.
-- =====================================================================

ALTER TABLE memberships DROP CONSTRAINT memberships_role_check;
ALTER TABLE memberships ADD CONSTRAINT memberships_role_check
  CHECK (role IN ('owner','admin','receptionist','dentist','assistant','accountant','support'));

-- Registro de limpieza / desinfección (solo inserción)
CREATE TABLE cleaning_logs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  branch_id   uuid NOT NULL,
  chair_id    uuid,                                -- NULL = área común (sala de espera, baños, esterilización)
  area        text,
  task        text NOT NULL CHECK (task IN ('between_patients','start_of_day','end_of_day','deep_disinfection','waste_disposal','spill')),
  notes       text CHECK (notes IS NULL OR length(notes) <= 500),
  done_by     uuid NOT NULL REFERENCES users(id),
  done_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK (chair_id IS NOT NULL OR area IS NOT NULL),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (chair_id, clinic_id) REFERENCES chairs(id, clinic_id)
);
CREATE INDEX cleaning_logs_day_idx ON cleaning_logs (clinic_id, branch_id, done_at DESC);

-- Equipos de esterilización (autoclaves) por sucursal
CREATE TABLE sterilizers (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  branch_id   uuid NOT NULL,
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 80),
  active      boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (branch_id, name),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);

-- Ciclos de esterilización (solo inserción). El número de ciclo es correlativo por equipo.
CREATE TABLE sterilization_cycles (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  branch_id     uuid NOT NULL,
  sterilizer_id uuid NOT NULL,
  cycle_number  int NOT NULL CHECK (cycle_number > 0),
  program       text NOT NULL CHECK (program IN ('134C','121C','flash','other')),
  temperature_c numeric(5,1) CHECK (temperature_c IS NULL OR temperature_c BETWEEN 50 AND 200),
  duration_min  int CHECK (duration_min IS NULL OR duration_min BETWEEN 1 AND 240),
  load_description text NOT NULL CHECK (length(load_description) BETWEEN 2 AND 500),
  packages      int NOT NULL DEFAULT 1 CHECK (packages BETWEEN 1 AND 500),
  chemical_indicator text NOT NULL CHECK (chemical_indicator IN ('pass','fail')),
  operator_id   uuid NOT NULL REFERENCES users(id),
  run_at        timestamptz NOT NULL DEFAULT now(),
  expires_on    date,                               -- vencimiento del material empaquetado
  notes         text CHECK (notes IS NULL OR length(notes) <= 500),
  UNIQUE (id, clinic_id),
  UNIQUE (sterilizer_id, cycle_number),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (sterilizer_id, clinic_id) REFERENCES sterilizers(id, clinic_id)
);
CREATE INDEX sterilization_cycles_idx ON sterilization_cycles (clinic_id, branch_id, run_at DESC);

-- Resultado del indicador biológico (llega 24-48 h después). Solo inserción; uno por ciclo.
CREATE TABLE sterilization_bio_results (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  cycle_id    uuid NOT NULL UNIQUE,
  result      text NOT NULL CHECK (result IN ('pass','fail')),
  notes       text CHECK (notes IS NULL OR length(notes) <= 500),
  recorded_by uuid NOT NULL REFERENCES users(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (cycle_id, clinic_id) REFERENCES sterilization_cycles(id, clinic_id)
);

CREATE TRIGGER cleaning_logs_immutable BEFORE UPDATE OR DELETE ON cleaning_logs FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sterilization_cycles_immutable BEFORE UPDATE OR DELETE ON sterilization_cycles FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER sterilization_bio_immutable BEFORE UPDATE OR DELETE ON sterilization_bio_results FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cleaning_logs','sterilizers','sterilization_cycles','sterilization_bio_results'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON cleaning_logs, sterilization_cycles, sterilization_bio_results TO dental_app;
GRANT SELECT, INSERT, UPDATE (name, active) ON sterilizers TO dental_app;
