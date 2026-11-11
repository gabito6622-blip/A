-- =====================================================================
-- 0018 — Experiencia del paciente y su familia (R2-31, R2-38, R2-39).
--
--  * patient_relationships: relaciones familiares entre pacientes (madre/padre/tutor → hijo/a,
--    cónyuge, hermano/a, otro). Una sola fila por par (sin importar el sentido): el índice único
--    sobre (menor id, mayor id) impide duplicados. Un solo tutor legal vigente por paciente.
--    Las relaciones no se borran: se cierran (ended_at) y quedan en el historial.
--  * patient_tags / patient_tag_links: etiquetas por clínica con color.
--  * patient_segments: segmentos guardados como filtros (se calculan al consultar).
--  * marketing_campaigns / marketing_campaign_recipients: campañas manuales (solo inserción),
--    con la lista exacta de destinatarios y excluidos con su motivo.
--  * satisfaction_surveys: encuesta de satisfacción (NPS) de un solo uso por cita atendida.
--  * checkin_points / checkin_attempts: QR de llegada por sucursal e intentos (solo inserción).
--  * message_rules admite el disparador 'satisfaction_survey' (regla automática de la encuesta).
-- =====================================================================

-- ---------------- Relaciones familiares ----------------
CREATE TABLE patient_relationships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  -- En 'parent': person_a es la madre, el padre o el tutor de person_b.
  person_a        uuid NOT NULL,
  person_b        uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('parent','spouse','sibling','other')),
  parent_label    text CHECK (parent_label IS NULL OR parent_label IN ('madre','padre','tutor')),
  other_label     text CHECK (other_label IS NULL OR length(other_label) BETWEEN 2 AND 40),
  -- person_a es el tutor legal de person_b (responde por el menor: acepta presupuestos, portal).
  legal_guardian  boolean NOT NULL DEFAULT false,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  ended_at        timestamptz,
  ended_by        uuid REFERENCES users(id),
  UNIQUE (id, clinic_id),
  CHECK (person_a <> person_b),
  CHECK (parent_label IS NULL OR kind = 'parent'),
  CHECK (other_label IS NULL OR kind = 'other'),
  CHECK (NOT legal_guardian OR kind = 'parent'),
  FOREIGN KEY (person_a, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (person_b, clinic_id) REFERENCES patients(id, clinic_id)
);
-- Bidireccional sin duplicados: (A,B) y (B,A) son el mismo par.
CREATE UNIQUE INDEX patient_relationships_pair_uq ON patient_relationships
  (clinic_id, least(person_a, person_b), greatest(person_a, person_b)) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX patient_relationships_guardian_uq ON patient_relationships (clinic_id, person_b)
  WHERE legal_guardian AND ended_at IS NULL;
CREATE INDEX patient_relationships_a_idx ON patient_relationships (clinic_id, person_a) WHERE ended_at IS NULL;
CREATE INDEX patient_relationships_b_idx ON patient_relationships (clinic_id, person_b) WHERE ended_at IS NULL;

-- Quiénes son y desde cuándo no cambia; una relación cerrada ya no se modifica; nada se borra.
CREATE OR REPLACE FUNCTION patient_relationships_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las relaciones familiares no se eliminan: se cierran' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.clinic_id, NEW.person_a, NEW.person_b, NEW.kind, NEW.created_at, NEW.created_by)
     IS DISTINCT FROM (OLD.clinic_id, OLD.person_a, OLD.person_b, OLD.kind, OLD.created_at, OLD.created_by) THEN
    RAISE EXCEPTION 'Las personas y el tipo de una relación no se modifican: cierra la relación y crea otra' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.ended_at IS NOT NULL THEN
    RAISE EXCEPTION 'Una relación cerrada no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER patient_relationships_guard BEFORE UPDATE OR DELETE ON patient_relationships
  FOR EACH ROW EXECUTE FUNCTION patient_relationships_guard();

-- ---------------- Etiquetas ----------------
CREATE TABLE patient_tags (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  name        text NOT NULL CHECK (length(name) BETWEEN 2 AND 40),
  color       text NOT NULL DEFAULT '#0f766e' CHECK (color ~ '^#[0-9a-f]{6}$'),
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id)
);
CREATE UNIQUE INDEX patient_tags_name_uq ON patient_tags (clinic_id, lower(name));

CREATE TABLE patient_tag_links (
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  patient_id  uuid NOT NULL,
  tag_id      uuid NOT NULL,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (patient_id, tag_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (tag_id, clinic_id) REFERENCES patient_tags(id, clinic_id)
);
CREATE INDEX patient_tag_links_tag_idx ON patient_tag_links (clinic_id, tag_id);

-- ---------------- Segmentos guardados ----------------
CREATE TABLE patient_segments (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  name        text NOT NULL CHECK (length(name) BETWEEN 3 AND 80),
  filters     jsonb NOT NULL CHECK (jsonb_typeof(filters) = 'object'),
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  UNIQUE (id, clinic_id)
);
CREATE UNIQUE INDEX patient_segments_name_uq ON patient_segments (clinic_id, lower(name)) WHERE archived_at IS NULL;

-- ---------------- Campañas manuales (solo inserción) ----------------
CREATE TABLE marketing_campaigns (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  segment_id       uuid,
  name             text NOT NULL CHECK (length(name) BETWEEN 3 AND 80),
  body             text NOT NULL CHECK (length(body) BETWEEN 5 AND 1000),
  channel          text NOT NULL DEFAULT 'whatsapp' CHECK (channel IN ('whatsapp','sms')),
  filters          jsonb NOT NULL,
  recipients       int NOT NULL CHECK (recipients >= 0),
  excluded         int NOT NULL CHECK (excluded >= 0),
  excluded_summary jsonb NOT NULL DEFAULT '{}'::jsonb,
  delivery_mode    text NOT NULL CHECK (delivery_mode IN ('simulate','queue','provider')),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (segment_id, clinic_id) REFERENCES patient_segments(id, clinic_id)
);
CREATE INDEX marketing_campaigns_clinic_idx ON marketing_campaigns (clinic_id, created_at DESC);

CREATE TABLE marketing_campaign_recipients (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id),
  campaign_id  uuid NOT NULL,
  patient_id   uuid NOT NULL,
  status       text NOT NULL CHECK (status IN ('queued','excluded')),
  reason       text CHECK (reason IS NULL OR length(reason) <= 200),
  message_id   uuid,
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (campaign_id, patient_id),
  CHECK ((status = 'queued') = (message_id IS NOT NULL)),
  CHECK (status = 'queued' OR reason IS NOT NULL),
  FOREIGN KEY (campaign_id, clinic_id) REFERENCES marketing_campaigns(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (message_id, clinic_id) REFERENCES outbound_messages(id, clinic_id)
);
CREATE INDEX marketing_campaign_recipients_patient_idx ON marketing_campaign_recipients (clinic_id, patient_id, created_at DESC);

CREATE TRIGGER marketing_campaigns_immutable BEFORE UPDATE OR DELETE ON marketing_campaigns
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER marketing_campaign_recipients_immutable BEFORE UPDATE OR DELETE ON marketing_campaign_recipients
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Encuesta de satisfacción (NPS) ----------------
CREATE TABLE satisfaction_surveys (
  id               uuid PRIMARY KEY,                -- también es el id del enlace firmado
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  appointment_id   uuid NOT NULL,
  patient_id       uuid NOT NULL,
  branch_id        uuid NOT NULL,
  dentist_id       uuid NOT NULL,
  token_hash       bytea NOT NULL UNIQUE,
  source           text NOT NULL CHECK (source IN ('auto','manual')),
  job_id           uuid,
  created_by       uuid REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  expires_at       timestamptz NOT NULL,
  answered_at      timestamptz,
  score            smallint CHECK (score IS NULL OR score BETWEEN 0 AND 10),
  comment          text CHECK (comment IS NULL OR length(comment) <= 1000),
  followup_done_at timestamptz,
  followup_by      uuid REFERENCES users(id),
  followup_note    text CHECK (followup_note IS NULL OR length(followup_note) <= 500),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, appointment_id),
  CHECK ((answered_at IS NULL) = (score IS NULL)),
  CHECK (comment IS NULL OR answered_at IS NOT NULL),
  CHECK (followup_done_at IS NULL OR answered_at IS NOT NULL),
  CHECK ((followup_done_at IS NULL) = (followup_by IS NULL)),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (job_id, clinic_id) REFERENCES message_jobs(id, clinic_id)
);
CREATE INDEX satisfaction_surveys_answered_idx ON satisfaction_surveys (clinic_id, answered_at DESC) WHERE answered_at IS NOT NULL;
CREATE INDEX satisfaction_surveys_patient_idx ON satisfaction_surveys (clinic_id, patient_id);

-- Una respuesta es definitiva (un solo uso); el seguimiento de gerencia se registra una vez.
CREATE OR REPLACE FUNCTION satisfaction_surveys_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las encuestas no se eliminan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.clinic_id, NEW.appointment_id, NEW.patient_id, NEW.branch_id, NEW.dentist_id, NEW.created_at)
     IS DISTINCT FROM (OLD.id, OLD.clinic_id, OLD.appointment_id, OLD.patient_id, OLD.branch_id, OLD.dentist_id, OLD.created_at) THEN
    RAISE EXCEPTION 'La identidad de una encuesta no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.answered_at IS NOT NULL AND (NEW.answered_at, NEW.score, NEW.comment, NEW.token_hash, NEW.expires_at)
     IS DISTINCT FROM (OLD.answered_at, OLD.score, OLD.comment, OLD.token_hash, OLD.expires_at) THEN
    RAISE EXCEPTION 'La encuesta ya fue respondida: la respuesta no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.followup_done_at IS NOT NULL AND (NEW.followup_done_at, NEW.followup_by, NEW.followup_note)
     IS DISTINCT FROM (OLD.followup_done_at, OLD.followup_by, OLD.followup_note) THEN
    RAISE EXCEPTION 'El seguimiento ya quedó registrado' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER satisfaction_surveys_guard BEFORE UPDATE OR DELETE ON satisfaction_surveys
  FOR EACH ROW EXECUTE FUNCTION satisfaction_surveys_guard();

-- Regla automática de la encuesta en el módulo de mensajes.
ALTER TABLE message_rules DROP CONSTRAINT message_rules_trigger_check;
ALTER TABLE message_rules ADD CONSTRAINT message_rules_trigger_check
  CHECK (trigger IN ('appointment_created','appointment_reminder','after_visit','recall_due','budget_unanswered','satisfaction_survey'));

-- ---------------- Llegada con QR ----------------
CREATE TABLE checkin_points (
  id          uuid PRIMARY KEY,                     -- id del enlace firmado del QR
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  branch_id   uuid NOT NULL,
  active      boolean NOT NULL DEFAULT true,
  created_by  uuid REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz,
  revoked_by  uuid REFERENCES users(id),
  UNIQUE (id, clinic_id),
  CHECK (active = (revoked_at IS NULL)),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE UNIQUE INDEX checkin_points_active_uq ON checkin_points (clinic_id, branch_id) WHERE active;

CREATE TABLE checkin_attempts (
  id              bigserial PRIMARY KEY,
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  branch_id       uuid NOT NULL,
  point_id        uuid,
  method          text NOT NULL CHECK (method IN ('qr','reminder')),
  ip_hash         text NOT NULL CHECK (length(ip_hash) BETWEEN 8 AND 128),
  outcome         text NOT NULL CHECK (outcome IN ('arrived','already','early','late','not_found','blocked')),
  appointment_id  uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (point_id, clinic_id) REFERENCES checkin_points(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id)
);
CREATE INDEX checkin_attempts_rate_idx ON checkin_attempts (clinic_id, branch_id, created_at DESC);
CREATE TRIGGER checkin_attempts_immutable BEFORE UPDATE OR DELETE ON checkin_attempts
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Row Level Security ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'patient_relationships','patient_tags','patient_tag_links','patient_segments','marketing_campaigns',
    'marketing_campaign_recipients','satisfaction_surveys','checkin_points','checkin_attempts'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- ---------------- Privilegios mínimos ----------------
GRANT SELECT, INSERT ON patient_relationships TO dental_app;
GRANT UPDATE (parent_label, other_label, legal_guardian, ended_at, ended_by) ON patient_relationships TO dental_app;
GRANT SELECT, INSERT ON patient_tags TO dental_app;
GRANT UPDATE (name, color, active) ON patient_tags TO dental_app;
GRANT SELECT, INSERT, DELETE ON patient_tag_links TO dental_app;
GRANT SELECT, INSERT ON patient_segments TO dental_app;
GRANT UPDATE (name, filters, updated_at, archived_at) ON patient_segments TO dental_app;
GRANT SELECT, INSERT ON marketing_campaigns, marketing_campaign_recipients TO dental_app;
GRANT SELECT, INSERT ON satisfaction_surveys TO dental_app;
GRANT UPDATE (token_hash, expires_at, source, job_id, answered_at, score, comment, followup_done_at, followup_by, followup_note) ON satisfaction_surveys TO dental_app;
GRANT SELECT, INSERT ON checkin_points TO dental_app;
GRANT UPDATE (active, revoked_at, revoked_by) ON checkin_points TO dental_app;
GRANT SELECT, INSERT ON checkin_attempts TO dental_app;
GRANT USAGE ON SEQUENCE checkin_attempts_id_seq TO dental_app;
