-- =====================================================================
-- 0014 — Tipos de cita, series de citas recurrentes y línea de tiempo del paciente
--        (R2-18, R2-19, R2-30 del anexo H; B-049 y B-015).
--
--  * appointment_types: tipos configurables por clínica (nombre, color, duración por
--    defecto, prestación sugerida, activo). No se borran: se desactivan.
--  * appointment_series: la regla con la que se agendó una serie (cada N semanas o meses,
--    hasta una fecha o N veces, máximo 52). Es un registro de solo inserción: cancelar o
--    reprogramar "esta y las siguientes" cambia las citas, no la regla original.
--  * appointments.appointment_type_id / series_id / series_index: opcionales, con FK
--    compuestas para que una cita nunca apunte a un tipo o serie de otra clínica.
-- =====================================================================

-- ---------------- Tipos de cita ----------------
CREATE TABLE appointment_types (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             uuid NOT NULL REFERENCES clinics(id),
  name                  text NOT NULL CHECK (length(name) BETWEEN 2 AND 60),
  color                 text NOT NULL CHECK (color ~ '^#[0-9a-f]{6}$'),
  default_duration_min  int NOT NULL DEFAULT 30 CHECK (default_duration_min BETWEEN 5 AND 480),
  procedure_id          uuid,                         -- prestación sugerida (opcional)
  active                boolean NOT NULL DEFAULT true,
  position              int NOT NULL DEFAULT 0,
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id)
);
-- Un nombre por clínica, sin distinguir mayúsculas.
CREATE UNIQUE INDEX appointment_types_name_uq ON appointment_types (clinic_id, lower(name));

-- ---------------- Series de citas (solo inserción) ----------------
CREATE TABLE appointment_series (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             uuid NOT NULL REFERENCES clinics(id),
  branch_id             uuid NOT NULL,
  patient_id            uuid NOT NULL,
  dentist_id            uuid NOT NULL,
  chair_id              uuid,
  appointment_type_id   uuid,
  procedure_id          uuid,
  frequency             text NOT NULL CHECK (frequency IN ('weekly','monthly')),
  interval_n            smallint NOT NULL CHECK (interval_n BETWEEN 1 AND 26),
  count_n               smallint CHECK (count_n IS NULL OR count_n BETWEEN 1 AND 52),
  until_date            date,
  first_starts_at       timestamptz NOT NULL,
  duration_min          int NOT NULL CHECK (duration_min BETWEEN 5 AND 480),
  reason                text CHECK (reason IS NULL OR length(reason) <= 200),
  idempotency_key       text,
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK ((count_n IS NULL) <> (until_date IS NULL)),     -- hasta una fecha O N veces
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (chair_id, clinic_id) REFERENCES chairs(id, clinic_id),
  FOREIGN KEY (appointment_type_id, clinic_id) REFERENCES appointment_types(id, clinic_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id)
);
CREATE UNIQUE INDEX appointment_series_idem_uq ON appointment_series (clinic_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX appointment_series_patient_idx ON appointment_series (clinic_id, patient_id);
CREATE TRIGGER appointment_series_immutable BEFORE UPDATE OR DELETE ON appointment_series
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Citas: tipo y serie ----------------
ALTER TABLE appointments
  ADD COLUMN appointment_type_id uuid,
  ADD COLUMN series_id uuid,
  ADD COLUMN series_index smallint CHECK (series_index IS NULL OR series_index BETWEEN 1 AND 52),
  ADD CONSTRAINT appointments_type_fk FOREIGN KEY (appointment_type_id, clinic_id) REFERENCES appointment_types(id, clinic_id),
  ADD CONSTRAINT appointments_series_fk FOREIGN KEY (series_id, clinic_id) REFERENCES appointment_series(id, clinic_id),
  ADD CONSTRAINT appointments_series_index_chk CHECK ((series_id IS NULL) = (series_index IS NULL));
CREATE INDEX appointments_series_idx ON appointments (clinic_id, series_id, starts_at) WHERE series_id IS NOT NULL;

-- Línea de tiempo del paciente: mensajes por paciente.
CREATE INDEX IF NOT EXISTS outbound_messages_patient_idx ON outbound_messages (clinic_id, patient_id, created_at DESC) WHERE patient_id IS NOT NULL;

-- ---------------- Tipos sugeridos para las clínicas existentes ----------------
-- (Las clínicas nuevas los reciben al abrir la agenda por primera vez; cada clínica los ajusta.)
INSERT INTO appointment_types (clinic_id, name, color, default_duration_min, procedure_id, position)
SELECT c.id, v.name, v.color, v.minutes, p.id, v.pos
  FROM clinics c
 CROSS JOIN (VALUES ('Primera vez', '#2563eb', 45, 'CON-01', 1), ('Control', '#0e8a7e', 30, NULL, 2),
                    ('Urgencia', '#dc2626', 30, NULL, 3), ('Ortodoncia', '#7c3aed', 30, 'ORT-01', 4),
                    ('Cirugía', '#c2410c', 60, 'CIR-01', 5), ('Higiene', '#0891b2', 45, 'PRE-01', 6)) AS v(name, color, minutes, code, pos)
  LEFT JOIN procedures p ON p.clinic_id = c.id AND p.code = v.code
ON CONFLICT DO NOTHING;

-- ---------------- Row Level Security ----------------
ALTER TABLE appointment_types ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointment_types USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
ALTER TABLE appointment_series ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointment_series USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

-- ---------------- Privilegios mínimos ----------------
GRANT SELECT, INSERT ON appointment_types TO dental_app;
GRANT UPDATE (name, color, default_duration_min, procedure_id, active, position, updated_at) ON appointment_types TO dental_app;
GRANT SELECT, INSERT ON appointment_series TO dental_app;
