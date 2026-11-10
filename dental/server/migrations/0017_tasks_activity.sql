-- =====================================================================
-- 0017 — Coordinación del equipo: tareas internas, registro de llamadas y
--        diario de actividad (R2-36, R2-37, R2-42 y R2-44 del anexo H; B-019).
--
--  * staff_tasks: tareas internas por sucursal, asignadas a una persona o a un
--    rol, con vencimiento, prioridad (normal/alta) y vínculo opcional a un
--    paciente o a una cita. Estados: abierta → tomada → hecha, o cancelada con
--    motivo. Un trigger valida las transiciones, deja fijos los datos de origen
--    y prohíbe borrar (las tareas no se eliminan: se cancelan).
--  * staff_task_comments: comentarios de solo inserción.
--  * patient_calls: llamadas al paciente con resultado, duración manual y nota
--    no clínica. Solo inserción (un registro de contacto no se corrige: se agrega otro).
--  * Diario de actividad: NO es una tabla nueva. Se construye sobre audit_log
--    (que ya es de solo inserción); aquí solo se agregan índices para la
--    paginación por cursor con más de 10 000 filas por clínica (B-019).
-- =====================================================================

-- ---------------- Tareas internas ----------------
CREATE TABLE staff_tasks (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  branch_id        uuid NOT NULL,
  title            text NOT NULL CHECK (length(title) BETWEEN 3 AND 140),
  detail           text CHECK (detail IS NULL OR length(detail) <= 2000),
  assignee_user_id uuid,
  assignee_role    text CHECK (assignee_role IS NULL OR assignee_role IN ('owner','admin','receptionist','dentist','assistant','accountant','support')),
  due_at           timestamptz,
  priority         text NOT NULL DEFAULT 'normal' CHECK (priority IN ('normal','high')),
  patient_id       uuid,
  appointment_id   uuid,
  status           text NOT NULL DEFAULT 'open' CHECK (status IN ('open','taken','done','cancelled')),
  source           text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual','call')),
  source_call_id   uuid,
  taken_by         uuid REFERENCES users(id),
  taken_at         timestamptz,
  done_by          uuid REFERENCES users(id),
  done_at          timestamptz,
  cancelled_by     uuid REFERENCES users(id),
  cancelled_at     timestamptz,
  cancel_reason    text CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 3 AND 300),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  -- Asignada a una persona O a un rol (nunca a ambos ni a nadie).
  CHECK ((assignee_user_id IS NULL) <> (assignee_role IS NULL)),
  CHECK (status <> 'taken' OR (taken_by IS NOT NULL AND taken_at IS NOT NULL)),
  CHECK (status <> 'done' OR (done_by IS NOT NULL AND done_at IS NOT NULL)),
  CHECK (status <> 'cancelled' OR (cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL)),
  -- Una tarea ligada a una cita también queda ligada a su paciente.
  CHECK (appointment_id IS NULL OR patient_id IS NOT NULL),
  CHECK (source <> 'call' OR source_call_id IS NOT NULL),
  FOREIGN KEY (branch_id, clinic_id)        REFERENCES branches(id, clinic_id),
  FOREIGN KEY (clinic_id, assignee_user_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (patient_id, clinic_id)       REFERENCES patients(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id)   REFERENCES appointments(id, clinic_id)
);
CREATE INDEX staff_tasks_branch_idx ON staff_tasks (clinic_id, branch_id, status, due_at);
CREATE INDEX staff_tasks_user_idx ON staff_tasks (clinic_id, assignee_user_id, status) WHERE assignee_user_id IS NOT NULL;
CREATE INDEX staff_tasks_role_idx ON staff_tasks (clinic_id, assignee_role, status) WHERE assignee_role IS NOT NULL;
CREATE INDEX staff_tasks_creator_idx ON staff_tasks (clinic_id, created_by, created_at DESC);
CREATE INDEX staff_tasks_patient_idx ON staff_tasks (clinic_id, patient_id) WHERE patient_id IS NOT NULL;

-- Guarda: transiciones válidas, origen inmutable, tareas cerradas sin cambios, sin DELETE.
CREATE OR REPLACE FUNCTION staff_tasks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las tareas no se eliminan (se cancelan con un motivo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.clinic_id, NEW.created_by, NEW.created_at, NEW.source, NEW.source_call_id, NEW.patient_id, NEW.appointment_id)
     IS DISTINCT FROM (OLD.clinic_id, OLD.created_by, OLD.created_at, OLD.source, OLD.source_call_id, OLD.patient_id, OLD.appointment_id) THEN
    RAISE EXCEPTION 'El origen de una tarea (quién la creó, paciente y cita) no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('done','cancelled') THEN
    RAISE EXCEPTION 'La tarea está cerrada (hecha o cancelada) y no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'open'  AND NEW.status IN ('taken','done','cancelled')) OR
       (OLD.status = 'taken' AND NEW.status IN ('open','done','cancelled'))
     ) THEN
    RAISE EXCEPTION 'Cambio de estado de tarea no permitido: % → %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER staff_tasks_guard BEFORE UPDATE OR DELETE ON staff_tasks FOR EACH ROW EXECUTE FUNCTION staff_tasks_guard();

-- ---------------- Comentarios (solo inserción) ----------------
CREATE TABLE staff_task_comments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  task_id     uuid NOT NULL,
  body        text NOT NULL CHECK (length(body) BETWEEN 1 AND 1000),
  author_id   uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (task_id, clinic_id) REFERENCES staff_tasks(id, clinic_id)
);
CREATE INDEX staff_task_comments_task_idx ON staff_task_comments (clinic_id, task_id, created_at);
CREATE TRIGGER staff_task_comments_immutable BEFORE UPDATE OR DELETE ON staff_task_comments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Llamadas al paciente (solo inserción) ----------------
CREATE TABLE patient_calls (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  branch_id       uuid NOT NULL,
  patient_id      uuid NOT NULL,
  appointment_id  uuid,
  phone           text CHECK (phone IS NULL OR length(phone) <= 30),     -- número marcado (copia)
  outcome         text NOT NULL CHECK (outcome IN ('answered','no_answer','wrong_number','call_back')),
  duration_min    smallint CHECK (duration_min IS NULL OR duration_min BETWEEN 0 AND 240),
  note            text CHECK (note IS NULL OR length(note) <= 500),         -- nota administrativa, no clínica
  user_id         uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id)      REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id)     REFERENCES patients(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id)
);
CREATE INDEX patient_calls_patient_idx ON patient_calls (clinic_id, patient_id, created_at DESC);
CREATE INDEX patient_calls_branch_idx ON patient_calls (clinic_id, branch_id, created_at DESC);
CREATE TRIGGER patient_calls_immutable BEFORE UPDATE OR DELETE ON patient_calls
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE staff_tasks
  ADD CONSTRAINT staff_tasks_call_fk FOREIGN KEY (source_call_id, clinic_id) REFERENCES patient_calls(id, clinic_id);
CREATE UNIQUE INDEX staff_tasks_call_uq ON staff_tasks (clinic_id, source_call_id) WHERE source_call_id IS NOT NULL;

-- ---------------- Diario de actividad: índices sobre la auditoría ----------------
-- Paginación por cursor (fecha y id descendentes) por clínica y por persona (B-019).
CREATE INDEX IF NOT EXISTS audit_log_clinic_at_id_idx ON audit_log (clinic_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS audit_log_clinic_user_at_idx ON audit_log (clinic_id, user_id, created_at DESC, id DESC);

-- ---------------- Row Level Security ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['staff_tasks','staff_task_comments','patient_calls'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- ---------------- Privilegios mínimos ----------------
GRANT SELECT, INSERT ON staff_tasks, staff_task_comments, patient_calls TO dental_app;
GRANT UPDATE (title, detail, assignee_user_id, assignee_role, due_at, priority, branch_id, status, taken_by, taken_at,
              done_by, done_at, cancelled_by, cancelled_at, cancel_reason, updated_at) ON staff_tasks TO dental_app;
