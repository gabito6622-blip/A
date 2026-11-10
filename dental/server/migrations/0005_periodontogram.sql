-- =====================================================================
-- 0005 — Periodontograma (B-042, requisitos PE-01 a PE-08 del anexo I)
--
-- Una exploración por fila; las mediciones van en un documento JSON validado
-- (la app valida con mensajes claros y la base vuelve a validar los rangos).
-- Estados: draft (borrador, se guarda solo) → closed (instantánea inmutable)
--          draft → discarded (descartado, queda en el historial; nunca se borra).
-- Las correcciones de una exploración cerrada son una exploración nueva que la
-- enmienda (amends_exam_id). Ninguna exploración se borra.
-- =====================================================================

-- Validación de rangos en la base (defensa en profundidad; la app ya rechaza con mensaje).
-- Nunca recorta: si un valor está fuera de rango, la fila se rechaza.
CREATE OR REPLACE FUNCTION perio_data_valid(d jsonb) RETURNS boolean
  LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  t record; s record; f record; k text; tooth int; v jsonb;
BEGIN
  IF jsonb_typeof(d) IS DISTINCT FROM 'object' OR jsonb_typeof(d->'teeth') IS DISTINCT FROM 'object' THEN RETURN false; END IF;
  IF (d->>'v') IS DISTINCT FROM '1' THEN RETURN false; END IF;
  IF d ? 'primary' AND jsonb_typeof(d->'primary') <> 'array' THEN RETURN false; END IF;
  FOR t IN SELECT key, value FROM jsonb_each(d->'teeth') LOOP
    IF t.key !~ '^[1-8][1-8]$' THEN RETURN false; END IF;
    tooth := t.key::int;
    IF NOT ((tooth BETWEEN 11 AND 18) OR (tooth BETWEEN 21 AND 28) OR (tooth BETWEEN 31 AND 38) OR (tooth BETWEEN 41 AND 48) OR
            (tooth BETWEEN 51 AND 55) OR (tooth BETWEEN 61 AND 65) OR (tooth BETWEEN 71 AND 75) OR (tooth BETWEEN 81 AND 85)) THEN
      RETURN false;
    END IF;
    IF jsonb_typeof(t.value) <> 'object' THEN RETURN false; END IF;
    v := t.value->'mobility';
    IF v IS NOT NULL AND jsonb_typeof(v) <> 'null' AND (jsonb_typeof(v) <> 'number' OR v::numeric NOT IN (0, 1, 2, 3)) THEN RETURN false; END IF;
    IF t.value ? 'furcation' THEN
      IF jsonb_typeof(t.value->'furcation') <> 'object' THEN RETURN false; END IF;
      FOR f IN SELECT key, value FROM jsonb_each(t.value->'furcation') LOOP
        IF f.key NOT IN ('B','L','MP','DP','M','D') THEN RETURN false; END IF;
        IF jsonb_typeof(f.value) <> 'null' AND (jsonb_typeof(f.value) <> 'number' OR f.value::numeric NOT IN (0, 1, 2, 3)) THEN RETURN false; END IF;
      END LOOP;
    END IF;
    IF t.value ? 'sites' THEN
      IF jsonb_typeof(t.value->'sites') <> 'object' THEN RETURN false; END IF;
      FOR s IN SELECT key, value FROM jsonb_each(t.value->'sites') LOOP
        IF s.key NOT IN ('MB','B','DB','ML','L','DL') OR jsonb_typeof(s.value) <> 'object' THEN RETURN false; END IF;
        v := s.value->'pd';
        IF v IS NOT NULL AND jsonb_typeof(v) <> 'null' AND (jsonb_typeof(v) <> 'number' OR v::numeric % 1 <> 0 OR v::numeric < 0 OR v::numeric > 15) THEN RETURN false; END IF;
        v := s.value->'rec';
        IF v IS NOT NULL AND jsonb_typeof(v) <> 'null' AND (jsonb_typeof(v) <> 'number' OR v::numeric % 1 <> 0 OR v::numeric < -5 OR v::numeric > 15) THEN RETURN false; END IF;
      END LOOP;
    END IF;
  END LOOP;
  RETURN true;
END $$;

CREATE TABLE perio_exams (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  patient_id      uuid NOT NULL,
  branch_id       uuid NOT NULL,
  examiner_id     uuid NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','closed','discarded')),
  origin          text NOT NULL CHECK (origin IN ('blank','previous','amendment')),
  source_exam_id  uuid,                    -- exploración de la que se copiaron datos (anterior o enmendada)
  amends_exam_id  uuid,                    -- si no es NULL, esta exploración corrige a otra cerrada
  data            jsonb NOT NULL DEFAULT '{"v":1,"primary":[],"teeth":{}}'::jsonb,
  revision        int NOT NULL DEFAULT 0 CHECK (revision >= 0),   -- control de concurrencia del guardado automático
  indices         jsonb,                   -- índices congelados al cerrar (mismo cálculo que el borrador)
  notes           text CHECK (notes IS NULL OR length(notes) <= 2000),
  close_note      text CHECK (close_note IS NULL OR length(close_note) <= 1000),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  updated_by      uuid REFERENCES users(id),
  closed_at       timestamptz,
  closed_by       uuid REFERENCES users(id),
  discarded_at    timestamptz,
  discarded_by    uuid REFERENCES users(id),
  discard_reason  text CHECK (discard_reason IS NULL OR length(discard_reason) <= 300),
  UNIQUE (id, clinic_id),
  CONSTRAINT perio_data_check CHECK (perio_data_valid(data)),
  CONSTRAINT perio_closed_complete CHECK ((status = 'closed') = (closed_at IS NOT NULL AND closed_by IS NOT NULL AND indices IS NOT NULL)),
  CONSTRAINT perio_discarded_complete CHECK ((status = 'discarded') = (discarded_at IS NOT NULL AND discarded_by IS NOT NULL)),
  CONSTRAINT perio_amendment_origin CHECK ((origin = 'amendment') = (amends_exam_id IS NOT NULL)),
  CONSTRAINT perio_source_origin CHECK ((origin = 'blank') = (source_exam_id IS NULL)),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (clinic_id, examiner_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (source_exam_id, clinic_id) REFERENCES perio_exams(id, clinic_id),
  FOREIGN KEY (amends_exam_id, clinic_id) REFERENCES perio_exams(id, clinic_id)
);
CREATE INDEX perio_exams_patient_idx ON perio_exams (clinic_id, patient_id, created_at DESC);
-- Un solo borrador abierto por paciente (evita dos exploraciones paralelas a medio llenar).
CREATE UNIQUE INDEX perio_one_draft_per_patient ON perio_exams (clinic_id, patient_id) WHERE status = 'draft';
-- Una exploración se enmienda una sola vez (la siguiente corrección enmienda a la enmienda).
CREATE UNIQUE INDEX perio_amend_once ON perio_exams (amends_exam_id) WHERE amends_exam_id IS NOT NULL AND status <> 'discarded';

-- Inmutabilidad: nada se borra; una exploración cerrada o descartada no cambia (ni siquiera
-- para el dueño de la base). En borrador solo cambian los datos y el estado; nunca el paciente,
-- la sucursal, el examinador ni el origen.
CREATE OR REPLACE FUNCTION perio_exams_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target record;
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las exploraciones periodontales no se borran: se descartan (borrador) o se enmiendan (cerradas)'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF NEW.amends_exam_id IS NOT NULL THEN
      SELECT status, patient_id INTO target FROM perio_exams WHERE id = NEW.amends_exam_id AND clinic_id = NEW.clinic_id;
      IF NOT FOUND OR target.status <> 'closed' OR target.patient_id <> NEW.patient_id THEN
        RAISE EXCEPTION 'Solo se enmienda una exploración cerrada del mismo paciente' USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    RETURN NEW;
  END IF;
  IF OLD.status <> 'draft' THEN
    RAISE EXCEPTION 'La exploración periodontal está %: es inmutable. Para corregirla crea una enmienda.',
      CASE OLD.status WHEN 'closed' THEN 'cerrada' ELSE 'descartada' END
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.clinic_id IS DISTINCT FROM OLD.clinic_id OR NEW.patient_id IS DISTINCT FROM OLD.patient_id
     OR NEW.branch_id IS DISTINCT FROM OLD.branch_id OR NEW.examiner_id IS DISTINCT FROM OLD.examiner_id
     OR NEW.origin IS DISTINCT FROM OLD.origin OR NEW.source_exam_id IS DISTINCT FROM OLD.source_exam_id
     OR NEW.amends_exam_id IS DISTINCT FROM OLD.amends_exam_id OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN
    RAISE EXCEPTION 'No se puede cambiar el paciente, la sucursal, el examinador ni el origen de una exploración'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER perio_exams_guard BEFORE INSERT OR UPDATE OR DELETE ON perio_exams
  FOR EACH ROW EXECUTE FUNCTION perio_exams_guard();

ALTER TABLE perio_exams ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON perio_exams USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

-- Privilegios mínimos: sin DELETE; UPDATE solo en las columnas que cambian en borrador o al cerrar/descartar.
GRANT SELECT, INSERT ON perio_exams TO dental_app;
GRANT UPDATE (data, revision, notes, updated_at, updated_by, status, indices, close_note, closed_at, closed_by,
              discarded_at, discarded_by, discard_reason) ON perio_exams TO dental_app;
