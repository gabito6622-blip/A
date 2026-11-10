-- =====================================================================
-- 0003 — Tiempos de la cita (eventos de estado), informe de calidad,
--        controles ("volver a citar") con intentos de contacto.
--
--  * appointment_events: una fila inmutable por cada creación o cambio de
--    estado de una cita (de → a, usuario, sucursal, hora). De aquí salen la
--    espera, la puntualidad y la duración real (el paso "en atención" no
--    tiene columna propia en appointments).
--  * procedures.recall_months: cada cuántos meses conviene un control
--    después de la prestación (NULL = no genera control).
--  * recalls: cola de controles por paciente y sucursal.
--  * recall_attempts: intentos de contacto, de solo inserción.
-- =====================================================================

-- ---------------- Eventos de la cita (solo inserción) ----------------
CREATE TABLE appointment_events (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  appointment_id  uuid NOT NULL,
  branch_id       uuid NOT NULL,
  from_status     text CHECK (from_status IS NULL OR from_status IN ('scheduled','confirmed','arrived','in_progress','completed','cancelled','no_show')),
  to_status       text NOT NULL CHECK (to_status IN ('scheduled','confirmed','arrived','in_progress','completed','cancelled','no_show')),
  user_id         uuid REFERENCES users(id),
  reason          text,
  -- true cuando se cierra después (citas pasadas sin cerrar): la hora no es la real
  -- y el informe de calidad no la usa para medir tiempos.
  retroactive     boolean NOT NULL DEFAULT false,
  occurred_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK (from_status IS DISTINCT FROM to_status),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE INDEX appointment_events_appt_idx ON appointment_events (clinic_id, appointment_id, occurred_at);
CREATE INDEX appointment_events_branch_idx ON appointment_events (clinic_id, branch_id, occurred_at);
CREATE TRIGGER appointment_events_immutable BEFORE UPDATE OR DELETE ON appointment_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Intervalo de control por prestación ----------------
ALTER TABLE procedures
  ADD COLUMN recall_months smallint CHECK (recall_months IS NULL OR recall_months BETWEEN 1 AND 60);

-- Valores sugeridos para el catálogo inicial de las clínicas existentes (cada clínica los ajusta).
UPDATE procedures SET recall_months = v.months
  FROM (VALUES ('PRE-01', 6), ('PRE-02', 6), ('PER-01', 3), ('END-01', 12), ('END-02', 12),
               ('IMP-01', 6), ('ORT-01', 1), ('PRO-01', 12), ('PRO-02', 12)) AS v(code, months)
 WHERE procedures.code = v.code AND procedures.recall_months IS NULL;

-- ---------------- Controles ("volver a citar") ----------------
CREATE TABLE recalls (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id             uuid NOT NULL REFERENCES clinics(id),
  patient_id            uuid NOT NULL,
  branch_id             uuid NOT NULL,
  procedure_id          uuid,                       -- prestación que motiva el control (opcional)
  dentist_id            uuid,                       -- profesional sugerido (opcional)
  reason                text NOT NULL CHECK (length(reason) BETWEEN 2 AND 200),
  due_date              date NOT NULL,              -- fecha objetivo
  due_month             date GENERATED ALWAYS AS ((date_trunc('month', due_date::timestamp))::date) STORED,
  priority              text NOT NULL DEFAULT 'normal' CHECK (priority IN ('low','normal','high')),
  status                text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','scheduled','done','dismissed','review')),
  origin                text NOT NULL DEFAULT 'manual' CHECK (origin IN ('completion','manual')),
  source_appointment_id uuid,                       -- cita que lo originó ("Próximo control")
  appointment_id        uuid,                       -- cita agendada para el control
  note                  text CHECK (note IS NULL OR length(note) <= 500),
  dismiss_reason        text CHECK (dismiss_reason IS NULL OR length(dismiss_reason) <= 300),
  attempts_reset_at     timestamptz,                -- al reactivar desde "revisar", los intentos fallidos se cuentan desde aquí
  created_by            uuid REFERENCES users(id),
  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now(),
  scheduled_at          timestamptz,
  done_at               timestamptz,
  dismissed_at          timestamptz,
  UNIQUE (id, clinic_id),
  CHECK (status <> 'scheduled' OR appointment_id IS NOT NULL),
  CHECK (status <> 'dismissed' OR dismiss_reason IS NOT NULL),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (source_appointment_id, clinic_id) REFERENCES appointments(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id)
);
-- Un solo control por cita de origen (evita duplicados por doble clic).
CREATE UNIQUE INDEX recalls_source_uq ON recalls (clinic_id, source_appointment_id) WHERE source_appointment_id IS NOT NULL;
CREATE INDEX recalls_queue_idx ON recalls (clinic_id, branch_id, due_month, status);
CREATE INDEX recalls_patient_idx ON recalls (clinic_id, patient_id, status);
CREATE INDEX recalls_appointment_idx ON recalls (clinic_id, appointment_id) WHERE appointment_id IS NOT NULL;

-- ---------------- Intentos de contacto (solo inserción) ----------------
CREATE TABLE recall_attempts (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  recall_id   uuid NOT NULL,
  channel     text NOT NULL CHECK (channel IN ('call','whatsapp','sms','in_person')),
  outcome     text NOT NULL CHECK (outcome IN ('no_answer','voicemail','scheduled','declined','wrong_number','other')),
  note        text CHECK (note IS NULL OR length(note) <= 500),
  user_id     uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (recall_id, clinic_id) REFERENCES recalls(id, clinic_id)
);
CREATE INDEX recall_attempts_recall_idx ON recall_attempts (clinic_id, recall_id, created_at);
CREATE TRIGGER recall_attempts_immutable BEFORE UPDATE OR DELETE ON recall_attempts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Row Level Security ----------------
ALTER TABLE appointment_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON appointment_events USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
ALTER TABLE recalls ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recalls USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
ALTER TABLE recall_attempts ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON recall_attempts USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

-- ---------------- Privilegios mínimos ----------------
GRANT SELECT, INSERT ON appointment_events, recall_attempts TO dental_app;
GRANT SELECT, INSERT ON recalls TO dental_app;
GRANT UPDATE (status, appointment_id, priority, due_date, reason, note, dismiss_reason, attempts_reset_at,
              updated_at, scheduled_at, done_at, dismissed_at) ON recalls TO dental_app;
