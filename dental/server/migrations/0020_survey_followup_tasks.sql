-- 0020: un detractor de la encuesta de satisfacción crea una tarea de seguimiento para gerencia.
-- La tarea la crea el sistema (no una persona): created_by queda vacío solo en ese caso.

ALTER TABLE staff_tasks DROP CONSTRAINT staff_tasks_source_check;
ALTER TABLE staff_tasks ADD CONSTRAINT staff_tasks_source_check CHECK (source IN ('manual','call','survey'));
ALTER TABLE staff_tasks ADD COLUMN source_survey_id uuid;
ALTER TABLE staff_tasks ADD CONSTRAINT staff_tasks_survey_fk
  FOREIGN KEY (source_survey_id, clinic_id) REFERENCES satisfaction_surveys(id, clinic_id);
ALTER TABLE staff_tasks ADD CONSTRAINT staff_tasks_survey_src CHECK (source <> 'survey' OR source_survey_id IS NOT NULL);
CREATE UNIQUE INDEX staff_tasks_survey_uq ON staff_tasks (clinic_id, source_survey_id) WHERE source_survey_id IS NOT NULL;
ALTER TABLE staff_tasks ALTER COLUMN created_by DROP NOT NULL;
ALTER TABLE staff_tasks ADD CONSTRAINT staff_tasks_creator CHECK (created_by IS NOT NULL OR source = 'survey');

-- La guarda también protege el nuevo origen.
CREATE OR REPLACE FUNCTION staff_tasks_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las tareas no se eliminan (se cancelan con un motivo)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.clinic_id, NEW.created_by, NEW.created_at, NEW.source, NEW.source_call_id, NEW.source_survey_id, NEW.patient_id, NEW.appointment_id)
     IS DISTINCT FROM (OLD.clinic_id, OLD.created_by, OLD.created_at, OLD.source, OLD.source_call_id, OLD.source_survey_id, OLD.patient_id, OLD.appointment_id) THEN
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
