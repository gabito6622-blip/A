-- =====================================================================
-- 0006 — Presupuestos v2 (B-045, R2-09 a R2-16)
--
--  * Descuento por línea en % o monto y descuento global prorrateado según el
--    neto de cada línea (el reparto se guarda por línea; el residuo de
--    redondeo va a la última). El neto nunca puede ser negativo.
--  * Prestaciones de varias sesiones: plantilla en el catálogo y sesiones por
--    línea; cada sesión realizada genera su propio cargo con su profesional.
--  * Versiones: la nueva versión reemplaza a la anterior ('superseded'), que ya
--    no se puede aceptar ni cobrar. Solo una versión viva por número.
--  * Enlace público para el paciente: solo se guarda el hash del token, vence a
--    los 30 días, se revoca y se bloquea tras 5 intentos fallidos.
--  * Eventos del presupuesto (visto, aceptado, rechazado, entregado, ...) de
--    solo inserción.
--  * Una sola función de saldo del paciente (R2-11).
-- =====================================================================

-- ---------------- Presupuestos: versiones y descuento global ----------------
ALTER TABLE budgets DROP CONSTRAINT budgets_status_check;
ALTER TABLE budgets ADD CONSTRAINT budgets_status_check
  CHECK (status IN ('draft','presented','accepted','rejected','cancelled','completed','superseded'));
ALTER TABLE budgets DROP CONSTRAINT budgets_clinic_id_number_key;
ALTER TABLE budgets
  ADD COLUMN version smallint NOT NULL DEFAULT 1 CHECK (version BETWEEN 1 AND 99),
  ADD COLUMN supersedes_id uuid,
  ADD COLUMN superseded_at timestamptz,
  -- Descuento global: si hay porcentaje, discount_cents es el monto calculado; si no, el monto fijo.
  ADD COLUMN global_discount_percent numeric(5,2) CHECK (global_discount_percent IS NULL OR global_discount_percent BETWEEN 0 AND 100),
  ADD CONSTRAINT budgets_number_version_uq UNIQUE (clinic_id, number, version),
  ADD CONSTRAINT budgets_supersedes_fk FOREIGN KEY (supersedes_id, clinic_id) REFERENCES budgets(id, clinic_id);
-- Una sola versión "viva" por número y una sola sucesora por versión.
CREATE UNIQUE INDEX budgets_live_version_uq ON budgets (clinic_id, number) WHERE status <> 'superseded';
CREATE UNIQUE INDEX budgets_supersedes_once ON budgets (supersedes_id) WHERE supersedes_id IS NOT NULL;

-- ---------------- Líneas: descuento en % y parte del descuento global ----------------
ALTER TABLE budget_items
  ADD COLUMN discount_percent numeric(5,2) CHECK (discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100),
  ADD COLUMN global_discount_cents bigint NOT NULL DEFAULT 0 CHECK (global_discount_cents >= 0),
  ADD COLUMN net_cents bigint GENERATED ALWAYS AS (unit_price_cents * quantity - discount_cents - global_discount_cents) STORED,
  ADD CONSTRAINT budget_items_net_nonnegative CHECK (unit_price_cents * quantity - discount_cents - global_discount_cents >= 0);

-- Los importes de una línea solo cambian mientras el presupuesto está en borrador
-- (al presentarlo se congelan los precios). Defensa adicional a la validación de la app.
CREATE OR REPLACE FUNCTION budget_items_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF (NEW.unit_price_cents, NEW.quantity, NEW.discount_cents, NEW.global_discount_cents, NEW.budget_id, NEW.procedure_id)
     IS DISTINCT FROM (OLD.unit_price_cents, OLD.quantity, OLD.discount_cents, OLD.global_discount_cents, OLD.budget_id, OLD.procedure_id) THEN
    SELECT status INTO st FROM budgets WHERE id = OLD.budget_id;
    IF st IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Los importes de un presupuesto presentado no se modifican; crea una nueva versión'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER budget_items_freeze BEFORE UPDATE ON budget_items FOR EACH ROW EXECUTE FUNCTION budget_items_freeze();

-- ---------------- Prestaciones de varias sesiones (R2-09) ----------------
-- Plantilla: [{"name": "Toma de medidas", "amountCents": 100000}, ...]; la suma es igual al precio.
ALTER TABLE procedures
  ADD COLUMN session_template jsonb CHECK (session_template IS NULL OR jsonb_typeof(session_template) = 'array');

CREATE TABLE budget_item_sessions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  budget_item_id  uuid NOT NULL,
  position        smallint NOT NULL CHECK (position BETWEEN 1 AND 20),
  name            text NOT NULL CHECK (length(name) BETWEEN 1 AND 120),
  weight_cents    bigint NOT NULL CHECK (weight_cents >= 0),   -- importe de la plantilla (base del reparto)
  amount_cents    bigint NOT NULL CHECK (amount_cents >= 0),   -- parte del neto de la línea
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  performed_by    uuid,
  performed_at    timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (budget_item_id, position),
  CHECK ((status = 'done') = (performed_by IS NOT NULL AND performed_at IS NOT NULL)),
  FOREIGN KEY (budget_item_id, clinic_id) REFERENCES budget_items(id, clinic_id),
  FOREIGN KEY (clinic_id, performed_by) REFERENCES memberships(clinic_id, user_id)
);
CREATE INDEX budget_item_sessions_item_idx ON budget_item_sessions (clinic_id, budget_item_id);

-- El cargo de una sesión la referencia (el cargo sigue siendo de solo inserción).
ALTER TABLE charges
  ADD COLUMN session_id uuid,
  ADD CONSTRAINT charges_session_fk FOREIGN KEY (session_id, clinic_id) REFERENCES budget_item_sessions(id, clinic_id);
CREATE INDEX charges_session_idx ON charges (session_id) WHERE session_id IS NOT NULL;

-- ---------------- Enlace público del presupuesto (R2-15) ----------------
CREATE TABLE budget_share_links (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  budget_id       uuid NOT NULL,
  token_hash      bytea NOT NULL UNIQUE,                 -- SHA-256 del token; el token solo lo ve quien lo crea
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  expires_at      timestamptz NOT NULL,
  revoked_at      timestamptz,
  revoked_by      uuid REFERENCES users(id),
  failed_attempts int NOT NULL DEFAULT 0 CHECK (failed_attempts BETWEEN 0 AND 5),
  locked_at       timestamptz,
  UNIQUE (id, clinic_id),
  CHECK (expires_at > created_at),
  FOREIGN KEY (budget_id, clinic_id) REFERENCES budgets(id, clinic_id)
);
CREATE INDEX budget_share_links_budget_idx ON budget_share_links (clinic_id, budget_id);

-- Resuelve la clínica de un enlace a partir del hash del token (ignora RLS a propósito
-- y no devuelve nada más). Con esa clínica, todo lo demás se lee con RLS activo.
CREATE OR REPLACE FUNCTION budget_link_clinic(p_hash bytea) RETURNS uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS
  $$ SELECT clinic_id FROM budget_share_links WHERE token_hash = p_hash $$;
REVOKE ALL ON FUNCTION budget_link_clinic(bytea) FROM PUBLIC;

-- ---------------- Eventos del presupuesto (solo inserción) ----------------
CREATE TABLE budget_events (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id),
  budget_id           uuid NOT NULL,
  link_id             uuid,
  kind                text NOT NULL CHECK (kind IN ('link_created','link_revoked','delivered','whatsapp_opened','verify_failed','link_locked',
                                                    'viewed','accepted','rejected','follow_up','version_created')),
  channel             text CHECK (channel IS NULL OR channel IN ('link','whatsapp','in_hand','phone','in_person','other')),
  actor_user_id       uuid REFERENCES users(id),           -- NULL = el paciente por el enlace
  signer_name         text CHECK (signer_name IS NULL OR length(signer_name) BETWEEN 3 AND 120),
  signer_relationship text CHECK (signer_relationship IS NULL OR signer_relationship IN ('patient','guardian')),
  signature_png       text CHECK (signature_png IS NULL OR (signature_png LIKE 'data:image/png;base64,%' AND length(signature_png) < 400000)),
  reason              text CHECK (reason IS NULL OR length(reason) <= 500),
  ua_hash             text,                                -- SHA-256 del navegador (no se guarda la IP)
  content_hash        text,                                -- SHA-256 de lo aceptado (líneas, totales, firmante, fecha y firma)
  data                jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK (kind <> 'accepted' OR (signer_name IS NOT NULL AND signer_relationship IS NOT NULL AND content_hash IS NOT NULL)),
  FOREIGN KEY (budget_id, clinic_id) REFERENCES budgets(id, clinic_id),
  FOREIGN KEY (link_id, clinic_id) REFERENCES budget_share_links(id, clinic_id)
);
CREATE INDEX budget_events_budget_idx ON budget_events (clinic_id, budget_id, created_at);
CREATE TRIGGER budget_events_immutable BEFORE UPDATE OR DELETE ON budget_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Un solo saldo del paciente (R2-11) ----------------
-- Todas las vistas con dinero del paciente (ficha, cuenta, cuentas por cobrar, panel)
-- usan esta función. Se ejecuta con los permisos de quien llama: RLS se aplica.
CREATE OR REPLACE FUNCTION patient_money(p_patient uuid)
  RETURNS TABLE (budgeted_cents bigint, charged_cents bigint, paid_cents bigint, on_account_cents bigint,
                 pending_cents bigint, balance_cents bigint, last_payment_at timestamptz)
  LANGUAGE sql STABLE AS $$
  WITH ch AS (SELECT COALESCE(sum(amount_cents), 0)::bigint AS v FROM charges WHERE patient_id = p_patient),
       pay AS (SELECT COALESCE(sum(amount_cents) FILTER (WHERE status = 'confirmed'), 0)::bigint AS paid,
                      COALESCE(sum(amount_cents) FILTER (WHERE status = 'confirmed' AND budget_id IS NULL), 0)::bigint AS on_account,
                      COALESCE(sum(amount_cents) FILTER (WHERE status = 'pending_verification'), 0)::bigint AS pending,
                      max(received_at) FILTER (WHERE status = 'confirmed') AS last_at
                 FROM payments WHERE patient_id = p_patient),
       bud AS (SELECT COALESCE(sum(i.net_cents), 0)::bigint AS v
                 FROM budget_items i JOIN budgets b ON b.id = i.budget_id
                WHERE b.patient_id = p_patient AND b.status IN ('accepted','completed') AND i.status <> 'cancelled')
  SELECT bud.v, ch.v, pay.paid, pay.on_account, pay.pending, ch.v - pay.paid, pay.last_at FROM ch, pay, bud
$$;

-- ---------------- RLS y privilegios ----------------
ALTER TABLE budget_item_sessions ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budget_item_sessions USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
ALTER TABLE budget_share_links ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budget_share_links USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
ALTER TABLE budget_events ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON budget_events USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());

GRANT SELECT, INSERT ON budget_item_sessions TO dental_app;
GRANT UPDATE (amount_cents, weight_cents, name, status, performed_by, performed_at) ON budget_item_sessions TO dental_app;
GRANT SELECT, INSERT ON budget_share_links TO dental_app;
GRANT UPDATE (revoked_at, revoked_by, failed_attempts, locked_at) ON budget_share_links TO dental_app;
GRANT SELECT, INSERT ON budget_events TO dental_app;
GRANT EXECUTE ON FUNCTION budget_link_clinic(bytea) TO dental_app;
GRANT EXECUTE ON FUNCTION patient_money(uuid) TO dental_app;
