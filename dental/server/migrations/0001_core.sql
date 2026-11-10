-- =====================================================================
-- 0001_core.sql — Esquema base de la plataforma odontológica (multiempresa)
--
-- Principios:
--  * Cada fila clínica u operativa lleva clinic_id y está protegida por
--    Row Level Security (RLS). La app trabaja con el rol dental_app, que
--    NO es dueño de las tablas, así que RLS siempre se aplica.
--  * Claves foráneas COMPUESTAS (id, clinic_id): una fila de una clínica no
--    puede referenciar una fila de otra, aunque el código tenga un error
--    (los chequeos de FK ignoran RLS, por eso son necesarias).
--  * Registros clínicos, cobros, pagos y auditoría son de solo inserción.
--    Las correcciones son filas nuevas que anulan/enmiendan las anteriores.
--  * Dinero en centavos (bigint). Fechas en timestamptz (UTC); la zona de
--    cada clínica (America/La_Paz por defecto) se aplica al mostrar/agendar.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'dental_app') THEN
    CREATE ROLE dental_app NOLOGIN NOSUPERUSER NOBYPASSRLS;
  END IF;
END $$;

-- El usuario que ejecuta migraciones debe poder hacer SET ROLE dental_app.
DO $$
BEGIN
  EXECUTE format('GRANT dental_app TO %I', current_user);
EXCEPTION WHEN others THEN
  -- superusuario o ya concedido
  NULL;
END $$;

-- Contexto de la petición (fijado con set_config(..., true) dentro de cada transacción)
CREATE OR REPLACE FUNCTION app_clinic_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.clinic_id', true), '')::uuid $$;
CREATE OR REPLACE FUNCTION app_user_id() RETURNS uuid
  LANGUAGE sql STABLE AS $$ SELECT nullif(current_setting('app.user_id', true), '')::uuid $$;

-- Bloquea UPDATE/DELETE en tablas de solo inserción (defensa adicional a los GRANT)
CREATE OR REPLACE FUNCTION forbid_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'La tabla % es de solo inserción (registro inmutable)', TG_TABLE_NAME
    USING ERRCODE = 'insufficient_privilege';
END $$;

-- ---------------------------------------------------------------------
-- Plataforma (global, sin RLS): planes, clínicas, usuarios, sesiones
-- ---------------------------------------------------------------------
CREATE TABLE plans (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code            text NOT NULL UNIQUE,
  name            text NOT NULL,
  max_branches    int  NOT NULL CHECK (max_branches > 0),
  max_users       int  NOT NULL CHECK (max_users > 0),
  max_patients    int  CHECK (max_patients IS NULL OR max_patients > 0),
  price_cents     bigint NOT NULL DEFAULT 0 CHECK (price_cents >= 0),
  currency        char(3) NOT NULL DEFAULT 'BOB',
  features        jsonb NOT NULL DEFAULT '{}'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE clinics (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug            text NOT NULL UNIQUE CHECK (slug ~ '^[a-z0-9][a-z0-9-]{1,40}$'),
  name            text NOT NULL,
  legal_name      text,
  tax_id          text,                         -- NIT (Bolivia)
  timezone        text NOT NULL DEFAULT 'America/La_Paz',
  currency        char(3) NOT NULL DEFAULT 'BOB',
  locale          text NOT NULL DEFAULT 'es-BO',
  plan_id         uuid REFERENCES plans(id),
  status          text NOT NULL DEFAULT 'trial' CHECK (status IN ('trial','active','suspended','cancelled')),
  trial_ends_at   timestamptz,
  settings        jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at      timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE users (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email           text NOT NULL,
  full_name       text NOT NULL,
  password_hash   text NOT NULL,
  is_platform_admin boolean NOT NULL DEFAULT false,
  failed_logins   int NOT NULL DEFAULT 0,
  locked_until    timestamptz,
  disabled_at     timestamptz,
  password_changed_at timestamptz NOT NULL DEFAULT now(),
  created_at      timestamptz NOT NULL DEFAULT now(),
  CHECK (email = lower(email))
);
CREATE UNIQUE INDEX users_email_uq ON users (email);

CREATE TABLE sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash      bytea NOT NULL UNIQUE,
  csrf_token      text NOT NULL,
  user_id         uuid NOT NULL REFERENCES users(id),
  clinic_id       uuid REFERENCES clinics(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  last_seen_at    timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  ip              text,
  user_agent      text
);
CREATE INDEX sessions_user_idx ON sessions (user_id);

-- ---------------------------------------------------------------------
-- Clínica: membresías, sucursales, consultorios
-- ---------------------------------------------------------------------
CREATE TABLE memberships (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  user_id         uuid NOT NULL REFERENCES users(id),
  role            text NOT NULL CHECK (role IN ('owner','admin','receptionist','dentist','assistant','accountant')),
  all_branches    boolean NOT NULL DEFAULT false,
  branch_ids      uuid[] NOT NULL DEFAULT '{}',
  is_professional boolean NOT NULL DEFAULT false,   -- atiende pacientes (aparece en la agenda)
  professional_license text,                        -- matrícula profesional
  color           text,
  commission_pct  numeric(5,2) CHECK (commission_pct IS NULL OR (commission_pct >= 0 AND commission_pct <= 100)),
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, user_id)
);

CREATE TABLE branches (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  code            text NOT NULL,
  name            text NOT NULL,
  address         text,
  city            text,
  phone           text,
  -- horario de atención por día ISO (1=lunes..7=domingo): {"1":[["08:00","12:30"],["14:30","19:00"]], ...}
  opening_hours   jsonb NOT NULL DEFAULT '{}'::jsonb,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, code)
);

CREATE TABLE chairs (            -- consultorios / sillones
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  branch_id       uuid NOT NULL,
  name            text NOT NULL,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (branch_id, name),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);

-- Horario semanal del profesional por sucursal
CREATE TABLE dentist_schedules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  dentist_id      uuid NOT NULL,
  branch_id       uuid NOT NULL,
  weekday         smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),  -- ISO
  start_time      time NOT NULL,
  end_time        time NOT NULL,
  chair_id        uuid,
  CHECK (end_time > start_time),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (chair_id, clinic_id) REFERENCES chairs(id, clinic_id)
);
CREATE INDEX dentist_schedules_idx ON dentist_schedules (clinic_id, dentist_id, weekday);

-- Bloqueos (vacaciones, cursos, feriados)
CREATE TABLE schedule_blocks (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  dentist_id      uuid,                       -- NULL = toda la sucursal
  branch_id       uuid,                       -- NULL = todas las sucursales del profesional
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  reason          text NOT NULL,
  created_by      uuid NOT NULL REFERENCES users(id),
  CHECK (ends_at > starts_at),
  CHECK (dentist_id IS NOT NULL OR branch_id IS NOT NULL),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);

-- Contadores por clínica (números de ficha, presupuestos, recibos)
CREATE TABLE counters (
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  name            text NOT NULL,
  value           bigint NOT NULL DEFAULT 0,
  PRIMARY KEY (clinic_id, name)
);

-- ---------------------------------------------------------------------
-- Pacientes
-- ---------------------------------------------------------------------
CREATE TABLE patients (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  record_number   bigint NOT NULL,                       -- N° de ficha por clínica
  first_name      text NOT NULL,
  last_name       text NOT NULL,
  document_type   text NOT NULL DEFAULT 'CI' CHECK (document_type IN ('CI','PASAPORTE','CE','OTRO','SIN')),
  document_number text,
  document_issued text,                                  -- expedido (LP, SC, CB, ...)
  birth_date      date,
  sex             text CHECK (sex IN ('F','M','X')),
  phone           text,                                  -- E.164 (+591...)
  email           text,
  address         text,
  city            text,
  occupation      text,
  guardian_name   text,                                  -- responsable (menores)
  guardian_phone  text,
  guardian_relationship text,
  referral_source text,
  notes           text,                                  -- administrativas, no clínicas
  preferred_branch_id uuid,
  consent_reminders boolean NOT NULL DEFAULT false,      -- recordatorios por WhatsApp/SMS
  consent_marketing boolean NOT NULL DEFAULT false,
  consent_updated_at timestamptz,
  search_text     text NOT NULL DEFAULT '',              -- normalizado sin tildes (lo llena la app)
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  archived_at     timestamptz,
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, record_number),
  FOREIGN KEY (preferred_branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE UNIQUE INDEX patients_document_uq ON patients (clinic_id, document_type, document_number)
  WHERE document_number IS NOT NULL AND archived_at IS NULL;
CREATE INDEX patients_search_trgm ON patients USING gin (search_text gin_trgm_ops);
CREATE INDEX patients_phone_idx ON patients (clinic_id, phone);

-- Antecedentes médicos (anamnesis): versiones inmutables
CREATE TABLE medical_histories (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  patient_id      uuid NOT NULL,
  data            jsonb NOT NULL,     -- alergias, medicación, enfermedades, embarazo, etc.
  recorded_by     uuid NOT NULL REFERENCES users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id)
);
CREATE INDEX medical_histories_patient_idx ON medical_histories (clinic_id, patient_id, recorded_at DESC);

-- ---------------------------------------------------------------------
-- Catálogo de prestaciones
-- ---------------------------------------------------------------------
CREATE TABLE procedures (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  code            text NOT NULL,
  name            text NOT NULL,
  category        text NOT NULL DEFAULT 'general',
  price_cents     bigint NOT NULL CHECK (price_cents >= 0),
  duration_min    int NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 480),
  scope           text NOT NULL DEFAULT 'tooth' CHECK (scope IN ('mouth','quadrant','tooth','surface')),
  odontogram_condition text,          -- condición que se marca al completar (p. ej. 'restoration')
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, code)
);

-- ---------------------------------------------------------------------
-- Agenda
-- ---------------------------------------------------------------------
CREATE TABLE appointments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  branch_id       uuid NOT NULL,
  chair_id        uuid,
  dentist_id      uuid NOT NULL,
  patient_id      uuid NOT NULL,
  procedure_id    uuid,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  status          text NOT NULL DEFAULT 'scheduled'
                  CHECK (status IN ('scheduled','confirmed','arrived','in_progress','completed','cancelled','no_show')),
  reason          text,
  notes           text,
  source          text NOT NULL DEFAULT 'reception' CHECK (source IN ('reception','phone','whatsapp','portal','walk_in','assistant')),
  cancel_reason   text,
  reschedule_count int NOT NULL DEFAULT 0,
  idempotency_key text,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  confirmed_at    timestamptz,
  arrived_at      timestamptz,
  completed_at    timestamptz,
  cancelled_at    timestamptz,
  UNIQUE (id, clinic_id),
  CHECK (ends_at > starts_at),
  CHECK (ends_at - starts_at <= interval '12 hours'),
  FOREIGN KEY (branch_id, clinic_id)  REFERENCES branches(id, clinic_id),
  FOREIGN KEY (chair_id, clinic_id)   REFERENCES chairs(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id),
  -- Sin solapamientos: el mismo profesional, el mismo consultorio o el mismo
  -- paciente no pueden tener dos citas activas a la vez. Lo garantiza la base
  -- de datos aun con reservas simultáneas desde dos recepciones.
  CONSTRAINT appt_no_overlap_dentist EXCLUDE USING gist
    (clinic_id WITH =, dentist_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status NOT IN ('cancelled','no_show')),
  CONSTRAINT appt_no_overlap_chair EXCLUDE USING gist
    (clinic_id WITH =, chair_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (chair_id IS NOT NULL AND status NOT IN ('cancelled','no_show')),
  CONSTRAINT appt_no_overlap_patient EXCLUDE USING gist
    (clinic_id WITH =, patient_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
    WHERE (status NOT IN ('cancelled','no_show'))
);
CREATE UNIQUE INDEX appointments_idem_uq ON appointments (clinic_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX appointments_day_idx ON appointments (clinic_id, branch_id, starts_at);
CREATE INDEX appointments_patient_idx ON appointments (clinic_id, patient_id, starts_at DESC);

-- Lista de espera
CREATE TABLE waitlist_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  branch_id       uuid NOT NULL,
  patient_id      uuid NOT NULL,
  dentist_id      uuid,
  procedure_id    uuid,
  duration_min    int NOT NULL DEFAULT 30 CHECK (duration_min BETWEEN 5 AND 480),
  earliest_date   date,
  latest_date     date,
  preferred_period text NOT NULL DEFAULT 'any' CHECK (preferred_period IN ('any','morning','afternoon')),
  priority        smallint NOT NULL DEFAULT 0,
  notes           text,
  status          text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','booked','cancelled')),
  appointment_id  uuid,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (branch_id, clinic_id)  REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id)
);

-- ---------------------------------------------------------------------
-- Registro clínico (solo inserción)
-- ---------------------------------------------------------------------
-- Odontograma: cada hallazgo es una entrada. El estado actual se calcula
-- con las entradas no anuladas. Notación FDI (permanente y temporal).
CREATE TABLE odontogram_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  patient_id      uuid NOT NULL,
  tooth           smallint NOT NULL CHECK (
                    (tooth BETWEEN 11 AND 18) OR (tooth BETWEEN 21 AND 28) OR
                    (tooth BETWEEN 31 AND 38) OR (tooth BETWEEN 41 AND 48) OR
                    (tooth BETWEEN 51 AND 55) OR (tooth BETWEEN 61 AND 65) OR
                    (tooth BETWEEN 71 AND 75) OR (tooth BETWEEN 81 AND 85)),
  surfaces        text[] NOT NULL DEFAULT '{}' CHECK (surfaces <@ ARRAY['M','D','O','V','L']::text[]),
  condition       text NOT NULL,
  state           text NOT NULL CHECK (state IN ('existing','planned','completed')),
  notes           text,
  voids_entry_id  uuid,               -- si no es NULL, esta entrada anula a otra
  appointment_id  uuid,
  budget_item_id  uuid,
  recorded_by     uuid NOT NULL REFERENCES users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (voids_entry_id, clinic_id) REFERENCES odontogram_entries(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id)
);
CREATE INDEX odontogram_patient_idx ON odontogram_entries (clinic_id, patient_id, recorded_at);
CREATE UNIQUE INDEX odontogram_void_once ON odontogram_entries (voids_entry_id) WHERE voids_entry_id IS NOT NULL;

-- Evoluciones clínicas (notas). Las correcciones son enmiendas nuevas.
CREATE TABLE clinical_notes (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  patient_id      uuid NOT NULL,
  branch_id       uuid NOT NULL,
  appointment_id  uuid,
  kind            text NOT NULL DEFAULT 'evolution' CHECK (kind IN ('evolution','diagnosis','prescription','referral','consent','other')),
  diagnosis       text,
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 20000),
  amends_note_id  uuid,
  author_id       uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id),
  FOREIGN KEY (amends_note_id, clinic_id) REFERENCES clinical_notes(id, clinic_id)
);
CREATE INDEX clinical_notes_patient_idx ON clinical_notes (clinic_id, patient_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Presupuestos y tratamientos
-- ---------------------------------------------------------------------
CREATE TABLE budgets (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  number          bigint NOT NULL,
  branch_id       uuid NOT NULL,
  patient_id      uuid NOT NULL,
  dentist_id      uuid NOT NULL,
  status          text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','presented','accepted','rejected','cancelled','completed')),
  discount_cents  bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  installments    smallint NOT NULL DEFAULT 1 CHECK (installments BETWEEN 1 AND 60),
  notes           text,
  valid_until     date,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  presented_at    timestamptz,
  decided_at      timestamptz,
  decided_note    text,
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, number),
  FOREIGN KEY (branch_id, clinic_id)  REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id)
);
CREATE INDEX budgets_patient_idx ON budgets (clinic_id, patient_id);
CREATE INDEX budgets_status_idx ON budgets (clinic_id, status);

CREATE TABLE budget_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  budget_id       uuid NOT NULL,
  procedure_id    uuid NOT NULL,
  tooth           smallint,
  surfaces        text[] NOT NULL DEFAULT '{}' CHECK (surfaces <@ ARRAY['M','D','O','V','L']::text[]),
  description     text NOT NULL,
  quantity        int NOT NULL DEFAULT 1 CHECK (quantity BETWEEN 1 AND 100),
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  discount_cents  bigint NOT NULL DEFAULT 0 CHECK (discount_cents >= 0),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  performed_by    uuid,
  performed_at    timestamptz,
  position        int NOT NULL DEFAULT 0,
  UNIQUE (id, clinic_id),
  CHECK (discount_cents <= unit_price_cents * quantity),
  FOREIGN KEY (budget_id, clinic_id) REFERENCES budgets(id, clinic_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id),
  FOREIGN KEY (clinic_id, performed_by) REFERENCES memberships(clinic_id, user_id)
);
CREATE INDEX budget_items_budget_idx ON budget_items (clinic_id, budget_id);

ALTER TABLE odontogram_entries
  ADD FOREIGN KEY (budget_item_id, clinic_id) REFERENCES budget_items(id, clinic_id);

-- ---------------------------------------------------------------------
-- Cuenta del paciente: cargos y pagos (libro inmutable)
-- ---------------------------------------------------------------------
CREATE TABLE charges (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  branch_id       uuid NOT NULL,
  patient_id      uuid NOT NULL,
  budget_item_id  uuid,
  dentist_id      uuid,
  description     text NOT NULL,
  amount_cents    bigint NOT NULL,          -- negativo = anulación de un cargo previo
  voids_charge_id uuid,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK (amount_cents <> 0),
  CHECK ((voids_charge_id IS NULL) = (amount_cents > 0)),
  FOREIGN KEY (branch_id, clinic_id)  REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (budget_item_id, clinic_id) REFERENCES budget_items(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (voids_charge_id, clinic_id) REFERENCES charges(id, clinic_id)
);
-- Una anulación por cargo. (Un tratamiento genera un cargo por cada vez que se marca realizado;
-- el bloqueo FOR UPDATE del ítem y su estado 'pending'→'done' evitan el doble cargo.)
CREATE INDEX charges_item_idx ON charges (budget_item_id) WHERE budget_item_id IS NOT NULL;
CREATE UNIQUE INDEX charges_void_once ON charges (voids_charge_id) WHERE voids_charge_id IS NOT NULL;
CREATE INDEX charges_patient_idx ON charges (clinic_id, patient_id);

CREATE TABLE payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  receipt_number  bigint NOT NULL,
  branch_id       uuid NOT NULL,
  patient_id      uuid NOT NULL,
  budget_id       uuid,
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  method          text NOT NULL CHECK (method IN ('cash','transfer','qr','card')),
  -- Efectivo: confirmado al recibirlo. Transferencia/QR/tarjeta: quedan
  -- "pending_verification" hasta que alguien autorizado compruebe el ingreso
  -- en el banco (un comprobante o captura NO prueba el ingreso).
  status          text NOT NULL CHECK (status IN ('pending_verification','confirmed','rejected','voided')),
  bank_reference  text,
  notes           text,
  idempotency_key text NOT NULL,
  received_by     uuid NOT NULL REFERENCES users(id),
  received_at     timestamptz NOT NULL DEFAULT now(),
  verified_by     uuid REFERENCES users(id),
  verified_at     timestamptz,
  status_reason   text,
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, receipt_number),
  UNIQUE (clinic_id, idempotency_key),
  CHECK (method = 'cash' OR bank_reference IS NOT NULL),
  FOREIGN KEY (branch_id, clinic_id)  REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (budget_id, clinic_id)  REFERENCES budgets(id, clinic_id)
);
-- La misma referencia bancaria no puede registrarse dos veces (evita doble cobro).
CREATE UNIQUE INDEX payments_bankref_uq ON payments (clinic_id, method, bank_reference)
  WHERE bank_reference IS NOT NULL AND status IN ('pending_verification','confirmed');
CREATE INDEX payments_patient_idx ON payments (clinic_id, patient_id);
CREATE INDEX payments_branch_day_idx ON payments (clinic_id, branch_id, received_at);

-- Solo se pueden modificar las columnas de estado y en transiciones válidas.
CREATE OR REPLACE FUNCTION payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los pagos no se eliminan; se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.amount_cents, NEW.method, NEW.patient_id, NEW.branch_id, NEW.clinic_id, NEW.receipt_number, NEW.received_at, NEW.received_by, NEW.idempotency_key)
     IS DISTINCT FROM (OLD.amount_cents, OLD.method, OLD.patient_id, OLD.branch_id, OLD.clinic_id, OLD.receipt_number, OLD.received_at, OLD.received_by, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'Los datos de un pago registrado no se modifican' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT (
       (OLD.status = 'pending_verification' AND NEW.status IN ('confirmed','rejected'))
    OR (OLD.status = 'confirmed' AND NEW.status = 'voided')
    OR (OLD.status = NEW.status)
  ) THEN
    RAISE EXCEPTION 'Transición de estado inválida: % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_guard BEFORE UPDATE OR DELETE ON payments FOR EACH ROW EXECUTE FUNCTION payments_guard();

-- ---------------------------------------------------------------------
-- Auditoría (solo inserción)
-- ---------------------------------------------------------------------
CREATE TABLE audit_log (
  id              bigserial PRIMARY KEY,
  clinic_id       uuid REFERENCES clinics(id),
  user_id         uuid REFERENCES users(id),
  action          text NOT NULL,
  entity          text NOT NULL,
  entity_id       text,
  branch_id       uuid,
  data            jsonb NOT NULL DEFAULT '{}'::jsonb,
  ip              text,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX audit_log_clinic_idx ON audit_log (clinic_id, created_at DESC);
CREATE INDEX audit_log_entity_idx ON audit_log (clinic_id, entity, entity_id);

CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON audit_log
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER odontogram_immutable BEFORE UPDATE OR DELETE ON odontogram_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER clinical_notes_immutable BEFORE UPDATE OR DELETE ON clinical_notes
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER medical_histories_immutable BEFORE UPDATE OR DELETE ON medical_histories
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER charges_immutable BEFORE UPDATE OR DELETE ON charges
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'branches','chairs','dentist_schedules','schedule_blocks','counters','patients',
    'medical_histories','procedures','appointments','waitlist_entries','odontogram_entries',
    'clinical_notes','budgets','budget_items','charges','payments'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- Membresías: visibles las de la clínica activa y las propias (para elegir clínica al ingresar)
ALTER TABLE memberships ENABLE ROW LEVEL SECURITY;
CREATE POLICY membership_read ON memberships FOR SELECT
  USING (clinic_id = app_clinic_id() OR user_id = app_user_id());
CREATE POLICY membership_write ON memberships FOR INSERT WITH CHECK (clinic_id = app_clinic_id());
CREATE POLICY membership_update ON memberships FOR UPDATE
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

-- Auditoría: se lee solo la de la clínica activa; se inserta con la clínica activa o sin clínica (eventos de plataforma/login)
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY audit_read ON audit_log FOR SELECT USING (clinic_id = app_clinic_id());
CREATE POLICY audit_insert ON audit_log FOR INSERT
  WITH CHECK (clinic_id IS NULL OR clinic_id = app_clinic_id());

-- ---------------------------------------------------------------------
-- Privilegios del rol de la aplicación
-- ---------------------------------------------------------------------
GRANT USAGE ON SCHEMA public TO dental_app;
GRANT SELECT ON plans TO dental_app;
GRANT SELECT ON clinics TO dental_app;
GRANT SELECT, UPDATE (failed_logins, locked_until, password_hash, password_changed_at, full_name) ON users TO dental_app;
GRANT INSERT ON users TO dental_app;
GRANT SELECT, INSERT, UPDATE ON sessions TO dental_app;
GRANT SELECT, INSERT, UPDATE ON memberships, branches, chairs, procedures, patients, appointments,
  waitlist_entries, budgets, budget_items, counters TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON dentist_schedules, schedule_blocks TO dental_app;
GRANT SELECT, INSERT ON medical_histories, odontogram_entries, clinical_notes, charges, audit_log TO dental_app;
GRANT SELECT, INSERT ON payments TO dental_app;
GRANT UPDATE (status, verified_by, verified_at, status_reason) ON payments TO dental_app;
GRANT USAGE ON SEQUENCE audit_log_id_seq TO dental_app;

-- Clínicas: cada usuario ve solo las clínicas activas o donde tiene membresía.
ALTER TABLE clinics ENABLE ROW LEVEL SECURITY;
CREATE POLICY clinic_read ON clinics FOR SELECT
  USING (id = app_clinic_id() OR id IN (SELECT m.clinic_id FROM memberships m WHERE m.user_id = app_user_id()));
CREATE POLICY clinic_update ON clinics FOR UPDATE USING (id = app_clinic_id()) WITH CHECK (id = app_clinic_id());
GRANT UPDATE (name, legal_name, tax_id, timezone, settings) ON clinics TO dental_app;
