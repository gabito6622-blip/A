-- =====================================================================
-- 0007 — Bandeja de mensajes salientes, reserva online y portal del paciente (B-046).
--
--  * outbound_messages: todo mensaje al paciente (WhatsApp, SMS, correo) pasa por aquí.
--    Fuera de producción NUNCA se envía: queda 'simulated'. En producción sin proveedor
--    queda 'queued'. El contenido no se modifica (solo las columnas de estado).
--  * portal_*: configuración por clínica, sucursal y prestación; retenciones cortas de
--    horario; códigos de un solo uso; sesiones del paciente (separadas del personal);
--    reservas web (inmediatas o solicitudes); eventos para límites de solicitudes.
--  * signed_documents admite el método 'online_checkbox' (casilla marcada por el propio
--    paciente en la web, sin personal que lo registre: recorded_by queda NULL).
--  * patient_balance(): una sola función de saldo (cargos − pagos confirmados).
-- =====================================================================

-- ---------------- Bandeja de mensajes salientes ----------------
CREATE TABLE outbound_messages (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  branch_id       uuid,
  patient_id      uuid,
  channel         text NOT NULL CHECK (channel IN ('whatsapp','sms','email')),
  recipient       text NOT NULL CHECK (length(recipient) BETWEEN 3 AND 200),
  template        text NOT NULL CHECK (template ~ '^[a-z0-9_.]{2,60}$'),
  purpose         text NOT NULL DEFAULT 'transactional' CHECK (purpose IN ('transactional','otp','reminders','marketing')),
  body            text NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  status          text NOT NULL CHECK (status IN ('queued','simulated','sent','failed')),
  provider        text,
  provider_message_id text,
  error           text,
  related_entity  text,
  related_id      uuid,
  created_at      timestamptz NOT NULL DEFAULT now(),
  sent_at         timestamptz,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id)
);
CREATE INDEX outbound_messages_clinic_idx ON outbound_messages (clinic_id, created_at DESC);

-- Solo cambian las columnas de estado; el texto y el destinatario son inmutables y no se borran.
CREATE OR REPLACE FUNCTION outbound_messages_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los mensajes de la bandeja no se eliminan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.clinic_id, NEW.channel, NEW.recipient, NEW.template, NEW.body, NEW.purpose, NEW.patient_id, NEW.created_at)
     IS DISTINCT FROM (OLD.clinic_id, OLD.channel, OLD.recipient, OLD.template, OLD.body, OLD.purpose, OLD.patient_id, OLD.created_at) THEN
    RAISE EXCEPTION 'El contenido de un mensaje no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'simulated' AND NEW.status <> 'simulated' THEN
    RAISE EXCEPTION 'Un mensaje simulado no puede pasar a enviado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER outbound_messages_guard BEFORE UPDATE OR DELETE ON outbound_messages
  FOR EACH ROW EXECUTE FUNCTION outbound_messages_guard();

-- ---------------- Configuración de la reserva online ----------------
CREATE TABLE portal_settings (
  clinic_id           uuid PRIMARY KEY REFERENCES clinics(id),
  enabled             boolean NOT NULL DEFAULT false,
  lead_time_hours     int NOT NULL DEFAULT 2 CHECK (lead_time_hours BETWEEN 0 AND 168),
  max_days_ahead      int NOT NULL DEFAULT 30 CHECK (max_days_ahead BETWEEN 1 AND 180),
  change_window_hours int NOT NULL DEFAULT 24 CHECK (change_window_hours BETWEEN 0 AND 168),
  show_prices         boolean NOT NULL DEFAULT false,
  instructions        text CHECK (instructions IS NULL OR length(instructions) <= 1000),
  updated_by          uuid REFERENCES users(id),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE portal_branch_settings (
  branch_id   uuid PRIMARY KEY,
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  enabled     boolean NOT NULL DEFAULT true,
  mode        text NOT NULL DEFAULT 'request' CHECK (mode IN ('instant','request')),
  whatsapp    text CHECK (whatsapp IS NULL OR whatsapp ~ '^\+?[0-9]{7,15}$'),
  map_url     text CHECK (map_url IS NULL OR (map_url ~ '^https://' AND length(map_url) <= 500)),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);

CREATE TABLE portal_services (
  procedure_id     uuid PRIMARY KEY,
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  price_from_cents bigint CHECK (price_from_cents IS NULL OR price_from_cents >= 0),
  position         int NOT NULL DEFAULT 0,
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id)
);

-- La página pública identifica a la clínica por su slug. Esta función (que ignora RLS a
-- propósito) solo devuelve el id cuando la reserva online está activa y la clínica vigente;
-- todo lo demás se lee después con withTenant() y RLS.
CREATE OR REPLACE FUNCTION portal_clinic_by_slug(p_slug text) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT c.id FROM clinics c JOIN portal_settings s ON s.clinic_id = c.id
      WHERE c.slug = p_slug AND s.enabled AND c.status IN ('trial','active') $$;
REVOKE ALL ON FUNCTION portal_clinic_by_slug(text) FROM PUBLIC;

-- ---------------- Retención temporal de horarios ----------------
-- Evita que dos pacientes confirmen el mismo horario a la vez. Las restricciones EXCLUDE de
-- appointments siguen siendo la garantía final.
CREATE TABLE portal_slot_holds (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id),
  branch_id    uuid NOT NULL,
  dentist_id   uuid NOT NULL,
  procedure_id uuid NOT NULL,
  starts_at    timestamptz NOT NULL,
  ends_at      timestamptz NOT NULL,
  token_hash   bytea NOT NULL UNIQUE,
  ip           text,
  expires_at   timestamptz NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id),
  -- Las retenciones vencidas se borran antes de crear una nueva (en la misma transacción).
  CONSTRAINT portal_hold_no_overlap EXCLUDE USING gist
    (clinic_id WITH =, dentist_id WITH =, tstzrange(starts_at, ends_at, '[)') WITH &&)
);
CREATE INDEX portal_slot_holds_exp_idx ON portal_slot_holds (clinic_id, expires_at);

-- ---------------- Códigos de un solo uso (OTP) ----------------
CREATE TABLE portal_otps (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  purpose         text NOT NULL CHECK (purpose IN ('existing','signup')),
  patient_id      uuid,                       -- paciente existente (NULL si los datos no coincidieron)
  phone           text,                       -- celular al que se envió (NULL si no se envió nada)
  signup          jsonb,                      -- datos del paciente nuevo (se crea al verificar)
  code_hash       bytea NOT NULL,
  attempts        int NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 5),
  expires_at      timestamptz NOT NULL,
  consumed_at     timestamptz,
  ip              text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id)
);
CREATE INDEX portal_otps_clinic_idx ON portal_otps (clinic_id, created_at DESC);

-- ---------------- Sesiones del paciente (cookie psid) ----------------
CREATE TABLE portal_sessions (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id),
  patient_id   uuid NOT NULL,
  phone        text NOT NULL,                -- celular verificado con el código
  token_hash   bytea NOT NULL UNIQUE,
  created_at   timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  expires_at   timestamptz NOT NULL,
  revoked_at   timestamptz,
  ip           text,
  user_agent   text,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id)
);

-- ---------------- Reservas web ----------------
-- mode 'instant': la cita se crea al confirmar (status 'confirmed').
-- mode 'request': queda 'pending' hasta que recepción la aprueba (crea la cita) o la rechaza.
CREATE TABLE portal_bookings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  code            text NOT NULL CHECK (code ~ '^[A-Z0-9]{4}-[A-Z0-9]{4}$'),
  mode            text NOT NULL CHECK (mode IN ('instant','request')),
  status          text NOT NULL CHECK (status IN ('confirmed','pending','approved','rejected','cancelled')),
  branch_id       uuid NOT NULL,
  dentist_id      uuid,
  procedure_id    uuid NOT NULL,
  patient_id      uuid NOT NULL,
  session_id      uuid,
  starts_at       timestamptz NOT NULL,
  ends_at         timestamptz NOT NULL,
  appointment_id  uuid,
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 80),
  decision_reason text,
  decided_by      uuid REFERENCES users(id),
  decided_at      timestamptz,
  ip              text,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, code),
  UNIQUE (clinic_id, idempotency_key),
  CHECK (ends_at > starts_at),
  CHECK (status NOT IN ('confirmed','approved') OR appointment_id IS NOT NULL),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (session_id, clinic_id) REFERENCES portal_sessions(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id)
);
CREATE INDEX portal_bookings_status_idx ON portal_bookings (clinic_id, status, starts_at);
CREATE INDEX portal_bookings_patient_idx ON portal_bookings (clinic_id, patient_id);

-- ---------------- Límites de solicitudes del flujo anónimo ----------------
-- Eventos de solo inserción (claves con hash). Solo se pueden borrar pasadas 24 h (limpieza).
CREATE TABLE portal_rate_events (
  id          bigserial PRIMARY KEY,
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  bucket      text NOT NULL,
  key_hash    text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX portal_rate_events_idx ON portal_rate_events (clinic_id, bucket, key_hash, created_at);

CREATE OR REPLACE FUNCTION portal_rate_events_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' OR OLD.created_at > now() - interval '24 hours' THEN
    RAISE EXCEPTION 'Los eventos de límite de solicitudes no se modifican' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER portal_rate_events_guard BEFORE UPDATE OR DELETE ON portal_rate_events
  FOR EACH ROW EXECUTE FUNCTION portal_rate_events_guard();

-- ---------------- Consentimiento por casilla en la web ----------------
ALTER TABLE signed_documents DROP CONSTRAINT signed_documents_method_check;
ALTER TABLE signed_documents ADD CONSTRAINT signed_documents_method_check
  CHECK (method IN ('signature_pad','paper_signed','staff_registered','online_checkbox'));
ALTER TABLE signed_documents ALTER COLUMN recorded_by DROP NOT NULL;
ALTER TABLE signed_documents ADD CONSTRAINT signed_documents_recorded_by_check
  CHECK (recorded_by IS NOT NULL OR method = 'online_checkbox');

-- ---------------- Saldo del paciente (una sola fuente) ----------------
-- SECURITY INVOKER: respeta RLS de la clínica activa.
CREATE OR REPLACE FUNCTION patient_balance(p_patient uuid)
  RETURNS TABLE (charged_cents bigint, paid_cents bigint, pending_cents bigint, balance_cents bigint)
  LANGUAGE sql STABLE AS $$
  SELECT ch.total, pa.paid, pa.pending, ch.total - pa.paid
    FROM (SELECT COALESCE(sum(amount_cents), 0)::bigint AS total FROM charges WHERE patient_id = p_patient) ch,
         (SELECT COALESCE(sum(amount_cents) FILTER (WHERE status = 'confirmed'), 0)::bigint AS paid,
                 COALESCE(sum(amount_cents) FILTER (WHERE status = 'pending_verification'), 0)::bigint AS pending
            FROM payments WHERE patient_id = p_patient) pa
$$;

-- ---------------- Row Level Security ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'outbound_messages','portal_settings','portal_branch_settings','portal_services','portal_slot_holds',
    'portal_otps','portal_sessions','portal_bookings','portal_rate_events'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- ---------------- Privilegios ----------------
GRANT SELECT, INSERT ON outbound_messages TO dental_app;
GRANT UPDATE (status, provider, provider_message_id, error, sent_at) ON outbound_messages TO dental_app;
GRANT SELECT, INSERT, UPDATE ON portal_settings, portal_branch_settings TO dental_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON portal_services TO dental_app;
GRANT SELECT, INSERT, DELETE ON portal_slot_holds TO dental_app;
GRANT SELECT, INSERT ON portal_otps TO dental_app;
GRANT UPDATE (attempts, consumed_at) ON portal_otps TO dental_app;
GRANT SELECT, INSERT ON portal_sessions TO dental_app;
GRANT UPDATE (last_seen_at, revoked_at) ON portal_sessions TO dental_app;
GRANT SELECT, INSERT ON portal_bookings TO dental_app;
GRANT UPDATE (status, appointment_id, dentist_id, starts_at, ends_at, decision_reason, decided_by, decided_at) ON portal_bookings TO dental_app;
GRANT SELECT, INSERT, DELETE ON portal_rate_events TO dental_app;
GRANT USAGE ON SEQUENCE portal_rate_events_id_seq TO dental_app;
GRANT UPDATE (slug) ON clinics TO dental_app;
GRANT EXECUTE ON FUNCTION portal_clinic_by_slug(text) TO dental_app;
GRANT EXECUTE ON FUNCTION patient_balance(uuid) TO dental_app;
