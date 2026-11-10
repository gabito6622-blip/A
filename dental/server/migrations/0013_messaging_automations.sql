-- =====================================================================
-- 0013 — Mensajes automáticos a pacientes (B-048 / B-060, WA-01 a WA-08).
--
--  * messaging_settings: horario de silencio y tope diario por paciente (por clínica).
--  * message_templates + message_template_versions: plantillas con versión (editar = nueva
--    versión, la anterior queda). Ninguna plantilla puede usar variables clínicas.
--  * message_rules: reglas por clínica y sucursal (al agendar, N antes de la cita, después
--    de la visita, control pendiente, presupuesto sin respuesta).
--  * message_jobs: cola programada con clave única por regla+cita+hora (dedupe). Una
--    ejecución repetida del programador nunca duplica; una reprogramación anula los
--    pendientes de la hora anterior.
--  * message_confirm_tokens: enlaces de confirmación de un solo uso (/c/:token).
--  * inbound_messages: respuestas recibidas por el webhook (p. ej. «BAJA»), solo inserción.
--  * outbound_messages: clave de deduplicación, reintentos y estados de entrega.
-- =====================================================================

-- ---------------- Bandeja de salida: dedupe, reintentos y entregas ----------------
ALTER TABLE outbound_messages
  ADD COLUMN dedupe_key   text CHECK (dedupe_key IS NULL OR length(dedupe_key) BETWEEN 3 AND 200),
  ADD COLUMN retry_of     uuid,
  ADD COLUMN delivered_at timestamptz,
  ADD COLUMN read_at      timestamptz,
  ADD CONSTRAINT outbound_messages_retry_fk FOREIGN KEY (retry_of, clinic_id) REFERENCES outbound_messages(id, clinic_id);
CREATE UNIQUE INDEX outbound_messages_dedupe_uq ON outbound_messages (clinic_id, dedupe_key) WHERE dedupe_key IS NOT NULL;
-- Un mensaje fallido se reintenta una sola vez (el reintento es un mensaje nuevo; el original no cambia).
CREATE UNIQUE INDEX outbound_messages_retry_uq ON outbound_messages (retry_of) WHERE retry_of IS NOT NULL;
CREATE INDEX outbound_messages_provider_idx ON outbound_messages (provider_message_id) WHERE provider_message_id IS NOT NULL;
CREATE INDEX outbound_messages_phone_idx ON outbound_messages ((right(regexp_replace(recipient, '\D', '', 'g'), 8)), created_at DESC);
ALTER TABLE outbound_messages DROP CONSTRAINT outbound_messages_status_check;
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_status_check
  CHECK (status IN ('queued','simulated','sent','delivered','read','failed'));

-- ---------------- Configuración ----------------
CREATE TABLE messaging_settings (
  clinic_id           uuid PRIMARY KEY REFERENCES clinics(id),
  quiet_start         time NOT NULL DEFAULT '20:00',
  quiet_end           time NOT NULL DEFAULT '08:00',
  max_per_patient_day smallint NOT NULL DEFAULT 2 CHECK (max_per_patient_day BETWEEN 1 AND 10),
  updated_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

-- ---------------- Plantillas versionadas ----------------
CREATE TABLE message_templates (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES clinics(id),
  name               text NOT NULL CHECK (length(name) BETWEEN 3 AND 80),
  purpose            text NOT NULL CHECK (purpose IN ('reminders','marketing')),
  -- Nombre de la plantilla aprobada en Meta (WhatsApp Cloud API) e idioma. Opcional fuera de producción.
  meta_template_name text CHECK (meta_template_name IS NULL OR meta_template_name ~ '^[a-z0-9_]{1,100}$'),
  meta_language      text NOT NULL DEFAULT 'es' CHECK (meta_language ~ '^[a-z]{2}(_[A-Z]{2})?$'),
  active             boolean NOT NULL DEFAULT true,
  created_by         uuid REFERENCES users(id),
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, name)
);

CREATE TABLE message_template_versions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  template_id uuid NOT NULL,
  version     int NOT NULL CHECK (version >= 1),
  body        text NOT NULL CHECK (length(body) BETWEEN 5 AND 1000),
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (template_id, version),
  FOREIGN KEY (template_id, clinic_id) REFERENCES message_templates(id, clinic_id),
  -- Defensa adicional a la validación de la API: nunca variables clínicas.
  CONSTRAINT message_template_no_clinical CHECK (body !~* '\{\s*(procedimientos?|tratamientos?|diagn[oó]sticos?|prestaci[oó]n(es)?|servicios?|procedures?|treatments?|diagnosis|diagnoses)\s*\}')
);
CREATE TRIGGER message_template_versions_immutable BEFORE UPDATE OR DELETE ON message_template_versions
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Reglas ----------------
CREATE TABLE message_rules (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES clinics(id),
  branch_id      uuid,                         -- NULL = todas las sucursales
  name           text NOT NULL CHECK (length(name) BETWEEN 3 AND 80),
  trigger        text NOT NULL CHECK (trigger IN ('appointment_created','appointment_reminder','after_visit','recall_due','budget_unanswered')),
  -- Minutos antes de la cita (recordatorio), después de la visita, antes del control o después de presentar el presupuesto.
  offset_minutes int NOT NULL DEFAULT 0 CHECK (offset_minutes BETWEEN 0 AND 129600),
  template_id    uuid NOT NULL,
  procedure_id   uuid,                         -- solo "después de la visita": filtra por prestación
  channel        text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms')),
  active         boolean NOT NULL DEFAULT false,
  active_since   timestamptz,                  -- desde cuándo está activa: evita envíos retroactivos masivos
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK (NOT active OR active_since IS NOT NULL),
  CHECK (procedure_id IS NULL OR trigger = 'after_visit'),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (template_id, clinic_id) REFERENCES message_templates(id, clinic_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id)
);
CREATE INDEX message_rules_active_idx ON message_rules (clinic_id, trigger) WHERE active;

-- ---------------- Cola programada ----------------
CREATE TABLE message_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id),
  rule_id             uuid NOT NULL,
  branch_id           uuid NOT NULL,
  patient_id          uuid NOT NULL,
  appointment_id      uuid,
  recall_id           uuid,
  budget_id           uuid,
  dedupe_key          text NOT NULL CHECK (length(dedupe_key) BETWEEN 3 AND 200),
  anchor_at           timestamptz NOT NULL,     -- hora de la cita, de la visita, del control o del presupuesto
  due_at              timestamptz NOT NULL,     -- momento según la regla
  send_at             timestamptz NOT NULL,     -- momento real (tras horario de silencio o tope diario)
  status              text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','skipped','cancelled')),
  status_reason       text CHECK (status_reason IS NULL OR length(status_reason) <= 300),
  template_version_id uuid,
  message_id          uuid,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now(),
  processed_at        timestamptz,
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, dedupe_key),
  CHECK (status <> 'done' OR message_id IS NOT NULL),
  FOREIGN KEY (rule_id, clinic_id) REFERENCES message_rules(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id),
  FOREIGN KEY (recall_id, clinic_id) REFERENCES recalls(id, clinic_id),
  FOREIGN KEY (budget_id, clinic_id) REFERENCES budgets(id, clinic_id),
  FOREIGN KEY (template_version_id, clinic_id) REFERENCES message_template_versions(id, clinic_id),
  FOREIGN KEY (message_id, clinic_id) REFERENCES outbound_messages(id, clinic_id)
);
CREATE INDEX message_jobs_due_idx ON message_jobs (clinic_id, status, send_at);
CREATE INDEX message_jobs_appt_idx ON message_jobs (clinic_id, appointment_id) WHERE appointment_id IS NOT NULL;
CREATE INDEX message_jobs_patient_idx ON message_jobs (clinic_id, patient_id, processed_at);

-- Lo enviado u omitido es definitivo; lo anulado solo puede volver a "pendiente" (la cita volvió a su hora).
-- La identidad del trabajo (regla, paciente, clave, ancla) nunca cambia y nada se borra.
CREATE OR REPLACE FUNCTION message_jobs_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los mensajes programados no se eliminan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.clinic_id, NEW.rule_id, NEW.patient_id, NEW.dedupe_key, NEW.anchor_at, NEW.appointment_id, NEW.recall_id, NEW.budget_id, NEW.created_at)
     IS DISTINCT FROM (OLD.clinic_id, OLD.rule_id, OLD.patient_id, OLD.dedupe_key, OLD.anchor_at, OLD.appointment_id, OLD.recall_id, OLD.budget_id, OLD.created_at) THEN
    RAISE EXCEPTION 'La identidad de un mensaje programado no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('done','skipped') THEN
    RAISE EXCEPTION 'Un mensaje ya enviado u omitido no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER message_jobs_guard BEFORE UPDATE OR DELETE ON message_jobs
  FOR EACH ROW EXECUTE FUNCTION message_jobs_guard();

-- ---------------- Enlaces de confirmación (un solo uso) ----------------
CREATE TABLE message_confirm_tokens (
  id                    uuid PRIMARY KEY,
  clinic_id             uuid NOT NULL REFERENCES clinics(id),
  appointment_id        uuid NOT NULL,
  job_id                uuid,
  token_hash            bytea NOT NULL UNIQUE,
  starts_at             timestamptz NOT NULL,   -- hora de la cita cuando se emitió (si cambia, el enlace deja de servir)
  expires_at            timestamptz NOT NULL,   -- vence a la hora de la cita
  used_at               timestamptz,
  used_action           text CHECK (used_action IS NULL OR used_action = 'confirmed'),
  reschedule_clicked_at timestamptz,
  created_at            timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK ((used_at IS NULL) = (used_action IS NULL)),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id),
  FOREIGN KEY (job_id, clinic_id) REFERENCES message_jobs(id, clinic_id)
);
CREATE INDEX message_confirm_tokens_appt_idx ON message_confirm_tokens (clinic_id, appointment_id);

-- ---------------- Respuestas recibidas (solo inserción) ----------------
CREATE TABLE inbound_messages (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id),
  patient_id          uuid,
  sender              text NOT NULL CHECK (length(sender) BETWEEN 3 AND 40),
  body                text NOT NULL CHECK (length(body) <= 1000),
  kind                text NOT NULL CHECK (kind IN ('opt_out','other')),
  provider_message_id text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, provider_message_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id)
);
CREATE INDEX inbound_messages_clinic_idx ON inbound_messages (clinic_id, created_at DESC);
CREATE TRIGGER inbound_messages_immutable BEFORE UPDATE OR DELETE ON inbound_messages
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Funciones que ignoran RLS a propósito (devuelven solo identificadores) ----------------
-- Clínicas vigentes con al menos una regla activa (el programador recorre solo esas).
CREATE OR REPLACE FUNCTION messaging_active_clinics() RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT DISTINCT r.clinic_id FROM message_rules r JOIN clinics c ON c.id = r.clinic_id
      WHERE r.active AND c.status IN ('trial','active') $$;
REVOKE ALL ON FUNCTION messaging_active_clinics() FROM PUBLIC;

-- Webhook de estados: el proveedor solo informa su id de mensaje.
CREATE OR REPLACE FUNCTION messaging_message_by_provider_id(p_id text) RETURNS TABLE (id uuid, clinic_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT m.id, m.clinic_id FROM outbound_messages m WHERE m.provider_message_id = p_id LIMIT 1 $$;
REVOKE ALL ON FUNCTION messaging_message_by_provider_id(text) FROM PUBLIC;

-- Webhook de respuestas («BAJA»): la clínica es la que envió el último mensaje a ese número.
CREATE OR REPLACE FUNCTION messaging_last_outbound_to(p_last8 text)
  RETURNS TABLE (clinic_id uuid, patient_id uuid, purpose text, branch_id uuid)
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT m.clinic_id, m.patient_id, m.purpose, m.branch_id FROM outbound_messages m
      WHERE right(regexp_replace(m.recipient, '\D', '', 'g'), 8) = p_last8 AND m.patient_id IS NOT NULL
      ORDER BY m.created_at DESC LIMIT 1 $$;
REVOKE ALL ON FUNCTION messaging_last_outbound_to(text) FROM PUBLIC;

-- ---------------- Row Level Security ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'messaging_settings','message_templates','message_template_versions','message_rules','message_jobs',
    'message_confirm_tokens','inbound_messages'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- ---------------- Privilegios mínimos ----------------
GRANT UPDATE (delivered_at, read_at) ON outbound_messages TO dental_app;
GRANT SELECT, INSERT, UPDATE ON messaging_settings TO dental_app;
GRANT SELECT, INSERT ON message_templates TO dental_app;
GRANT UPDATE (name, active, meta_template_name, meta_language) ON message_templates TO dental_app;
GRANT SELECT, INSERT ON message_template_versions TO dental_app;
GRANT SELECT, INSERT ON message_rules TO dental_app;
GRANT UPDATE (branch_id, name, offset_minutes, template_id, procedure_id, channel, active, active_since, updated_at) ON message_rules TO dental_app;
GRANT SELECT, INSERT ON message_jobs TO dental_app;
GRANT UPDATE (status, status_reason, send_at, template_version_id, message_id, updated_at, processed_at) ON message_jobs TO dental_app;
GRANT SELECT, INSERT ON message_confirm_tokens TO dental_app;
GRANT UPDATE (used_at, used_action, reschedule_clicked_at) ON message_confirm_tokens TO dental_app;
GRANT SELECT, INSERT ON inbound_messages TO dental_app;
GRANT EXECUTE ON FUNCTION messaging_active_clinics() TO dental_app;
GRANT EXECUTE ON FUNCTION messaging_message_by_provider_id(text) TO dental_app;
GRANT EXECUTE ON FUNCTION messaging_last_outbound_to(text) TO dental_app;
