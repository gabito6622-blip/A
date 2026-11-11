-- =====================================================================
-- 0029 — B-070: envío al proveedor FUERA de la transacción de la clínica, y bandeja de respuestas.
--
--  * Antes, con proveedor real, el mensaje se enviaba dentro de la transacción que lo creaba: si
--    esa transacción se revertía después, el mensaje ya había salido sin quedar registrado, y la
--    llamada de red alargaba la transacción. Ahora la transacción solo lo deja 'queued'; un
--    despachador lo toma (FOR UPDATE SKIP LOCKED), lo marca 'sending', confirma, envía y registra
--    el resultado. Errores transitorios (429, 5xx, red) se reintentan con espera creciente.
--  * Un mensaje que quedó 'sending' (el proceso se cayó en pleno envío) NO se reenvía: no se sabe
--    si salió. Pasa a 'failed' con un motivo claro y se puede reintentar a mano.
--  * Respuestas recibidas: recepción las ve por sucursal y las marca atendidas (eventos de solo
--    inserción).
-- =====================================================================

ALTER TABLE outbound_messages DROP CONSTRAINT outbound_messages_status_check;
ALTER TABLE outbound_messages ADD CONSTRAINT outbound_messages_status_check
  CHECK (status IN ('queued','sending','simulated','sent','delivered','read','failed'));
ALTER TABLE outbound_messages
  ADD COLUMN attempts        smallint NOT NULL DEFAULT 0 CHECK (attempts BETWEEN 0 AND 20),
  ADD COLUMN next_attempt_at timestamptz,
  ADD COLUMN claimed_at      timestamptz,
  -- Plantilla aprobada del proveedor y sus parámetros (se necesitan al enviar desde la cola).
  ADD COLUMN provider_template jsonb CHECK (provider_template IS NULL OR jsonb_typeof(provider_template) = 'object');
CREATE INDEX outbound_messages_dispatch_idx ON outbound_messages (clinic_id, next_attempt_at, created_at)
  WHERE status IN ('queued','sending') AND provider IS NOT NULL;
GRANT UPDATE (attempts, next_attempt_at, claimed_at) ON outbound_messages TO dental_app;

-- Clínicas con mensajes por despachar para ESE proveedor (solo identificadores).
CREATE OR REPLACE FUNCTION messaging_clinics_with_outbox(p_provider text) RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT DISTINCT m.clinic_id FROM outbound_messages m
      WHERE m.provider = p_provider AND m.status IN ('queued','sending') $$;
REVOKE ALL ON FUNCTION messaging_clinics_with_outbox(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION messaging_clinics_with_outbox(text) TO dental_app;

-- ---------------- Respuestas atendidas ----------------
CREATE TABLE inbound_message_events (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  message_id  uuid NOT NULL,
  kind        text NOT NULL CHECK (kind IN ('handled','reopened')),
  note        text CHECK (note IS NULL OR length(note) BETWEEN 1 AND 300),
  user_id     uuid NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (message_id, clinic_id) REFERENCES inbound_messages(id, clinic_id),
  FOREIGN KEY (clinic_id, user_id) REFERENCES memberships(clinic_id, user_id)
);
CREATE INDEX inbound_message_events_msg_idx ON inbound_message_events (clinic_id, message_id, created_at DESC);
CREATE TRIGGER inbound_message_events_immutable BEFORE UPDATE OR DELETE ON inbound_message_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE inbound_message_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON inbound_message_events
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
GRANT SELECT, INSERT ON inbound_message_events TO dental_app;
