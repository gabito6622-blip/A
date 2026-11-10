-- =====================================================================
-- 0004 — Caja por sucursal y cajero (B-043, FI-01) y liquidación de
--        honorarios por profesional (B-044, FI-03).
--
--  * cash_sessions: apertura con fondo, cierre con arqueo por billetes y
--    monedas en Bs. Una sesión cerrada es inmutable (trigger). Solo una
--    sesión abierta por (sucursal, cajero).
--  * cash_movements: ingresos y egresos manuales de solo inserción.
--  * payments.cash_session_id: los cobros en efectivo se vinculan solos a la
--    caja abierta de quien los recibe en esa sucursal (trigger).
--  * fee_profiles / fee_rules: reglas de honorarios por profesional, con
--    excepciones por categoría de prestación.
--  * fee_settlements / fee_settlement_lines: liquidación por período
--    (borrador → cerrada). El cierre guarda una copia inmutable línea por línea.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Caja
-- ---------------------------------------------------------------------
CREATE TABLE cash_sessions (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id           uuid NOT NULL REFERENCES clinics(id),
  number              bigint NOT NULL,                 -- correlativo por clínica
  branch_id           uuid NOT NULL,
  cashier_id          uuid NOT NULL,
  status              text NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_float_cents bigint NOT NULL CHECK (opening_float_cents >= 0),
  opening_note        text,
  opened_at           timestamptz NOT NULL DEFAULT now(),
  -- Cierre (copia de lo calculado por el servidor al cerrar)
  closed_at           timestamptz,
  closed_by           uuid REFERENCES users(id),
  count_detail        jsonb,                           -- {"20000": 3, "50": 4, ...} centavos → cantidad
  cash_in_cents       bigint,                          -- cobros en efectivo confirmados de la sesión
  voided_cents        bigint,                          -- cobros en efectivo de la sesión anulados (informativo)
  movements_in_cents  bigint,
  movements_out_cents bigint,
  expected_cents      bigint,
  counted_cents       bigint,
  difference_cents    bigint,                          -- contado − esperado (negativo = faltante)
  close_note          text,
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, number),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (clinic_id, cashier_id) REFERENCES memberships(clinic_id, user_id),
  CHECK ((status = 'open') = (closed_at IS NULL)),
  CHECK (status = 'open' OR (count_detail IS NOT NULL AND expected_cents IS NOT NULL AND counted_cents IS NOT NULL
                             AND counted_cents >= 0 AND difference_cents = counted_cents - expected_cents)),
  CHECK (status = 'open' OR difference_cents = 0 OR length(btrim(coalesce(close_note, ''))) >= 5)
);
-- Una sola caja abierta por cajero y sucursal: no se abre otra con una pendiente.
CREATE UNIQUE INDEX cash_sessions_one_open ON cash_sessions (clinic_id, branch_id, cashier_id) WHERE status = 'open';
CREATE INDEX cash_sessions_branch_idx ON cash_sessions (clinic_id, branch_id, opened_at DESC);

-- Una caja cerrada no se modifica ni se borra; una abierta solo puede pasar a cerrada.
CREATE OR REPLACE FUNCTION cash_sessions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las cajas no se eliminan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Una caja cerrada no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.clinic_id, NEW.number, NEW.branch_id, NEW.cashier_id, NEW.opening_float_cents, NEW.opened_at, NEW.opening_note)
     IS DISTINCT FROM (OLD.clinic_id, OLD.number, OLD.branch_id, OLD.cashier_id, OLD.opening_float_cents, OLD.opened_at, OLD.opening_note) THEN
    RAISE EXCEPTION 'Los datos de apertura de una caja no se modifican' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status <> 'closed' THEN
    RAISE EXCEPTION 'Una caja abierta solo puede cerrarse' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_sessions_guard BEFORE UPDATE OR DELETE ON cash_sessions FOR EACH ROW EXECUTE FUNCTION cash_sessions_guard();

CREATE TABLE cash_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  session_id      uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('in','out')),
  category        text NOT NULL CHECK (category IN ('change','petty_expense','deposit','refund','other')),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  reason          text NOT NULL CHECK (length(btrim(reason)) >= 3),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (session_id, clinic_id) REFERENCES cash_sessions(id, clinic_id)
);
CREATE INDEX cash_movements_session_idx ON cash_movements (clinic_id, session_id, created_at);
CREATE TRIGGER cash_movements_immutable BEFORE UPDATE OR DELETE ON cash_movements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Solo se registran movimientos en una caja abierta (bloquea la fila para que no se cierre a la vez).
CREATE OR REPLACE FUNCTION cash_movements_open_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM cash_sessions WHERE id = NEW.session_id AND clinic_id = NEW.clinic_id FOR SHARE;
  IF st IS DISTINCT FROM 'open' THEN
    RAISE EXCEPTION 'La caja está cerrada: no admite movimientos' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cash_movements_open_session BEFORE INSERT ON cash_movements FOR EACH ROW EXECUTE FUNCTION cash_movements_open_session();

-- Revisión de un cierre por gerencia o contabilidad (solo inserción; una por caja).
CREATE TABLE cash_session_reviews (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  session_id      uuid NOT NULL,
  note            text,
  reviewed_by     uuid NOT NULL REFERENCES users(id),
  reviewed_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (session_id),
  FOREIGN KEY (session_id, clinic_id) REFERENCES cash_sessions(id, clinic_id)
);
CREATE TRIGGER cash_session_reviews_immutable BEFORE UPDATE OR DELETE ON cash_session_reviews
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Cobros en efectivo → caja abierta de quien recibe en esa sucursal.
ALTER TABLE payments ADD COLUMN cash_session_id uuid;
ALTER TABLE payments ADD FOREIGN KEY (cash_session_id, clinic_id) REFERENCES cash_sessions(id, clinic_id);
ALTER TABLE payments ADD CONSTRAINT payments_cash_session_method CHECK (cash_session_id IS NULL OR method = 'cash');
CREATE INDEX payments_cash_session_idx ON payments (cash_session_id) WHERE cash_session_id IS NOT NULL;

CREATE OR REPLACE FUNCTION payments_link_cash_session() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE s record;
BEGIN
  IF NEW.method <> 'cash' THEN
    RETURN NEW;
  END IF;
  IF NEW.cash_session_id IS NULL THEN
    SELECT id INTO NEW.cash_session_id FROM cash_sessions
     WHERE clinic_id = NEW.clinic_id AND branch_id = NEW.branch_id AND cashier_id = NEW.received_by AND status = 'open'
     FOR SHARE;
  ELSE
    SELECT status, branch_id, cashier_id INTO s FROM cash_sessions WHERE id = NEW.cash_session_id AND clinic_id = NEW.clinic_id FOR SHARE;
    IF s.status IS DISTINCT FROM 'open' OR s.branch_id <> NEW.branch_id OR s.cashier_id <> NEW.received_by THEN
      RAISE EXCEPTION 'El cobro no corresponde a una caja abierta de quien lo recibe en esa sucursal' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_link_cash_session BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION payments_link_cash_session();

-- El vínculo con la caja no cambia después de registrado el cobro (ni siquiera para el dueño de la base).
CREATE OR REPLACE FUNCTION payments_cash_session_fixed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.cash_session_id IS DISTINCT FROM OLD.cash_session_id THEN
    RAISE EXCEPTION 'La caja de un cobro registrado no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_cash_session_fixed BEFORE UPDATE ON payments FOR EACH ROW EXECUTE FUNCTION payments_cash_session_fixed();

-- ---------------------------------------------------------------------
-- Honorarios
-- ---------------------------------------------------------------------
CREATE TABLE fee_profiles (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  dentist_id      uuid NOT NULL,
  base            text NOT NULL CHECK (base IN ('production','collected')),
  notes           text,
  updated_by      uuid REFERENCES users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, dentist_id),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id)
);

CREATE TABLE fee_rules (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  dentist_id      uuid NOT NULL,
  category        text,                               -- NULL = regla general del profesional
  mode            text NOT NULL CHECK (mode IN ('percent','fixed')),
  percent_bp      int CHECK (percent_bp BETWEEN 0 AND 10000),      -- puntos básicos: 35,5 % = 3550
  fixed_cents     bigint CHECK (fixed_cents >= 0),                 -- monto fijo por tratamiento (unidad)
  deduct_cents    bigint NOT NULL DEFAULT 0 CHECK (deduct_cents >= 0), -- laboratorio y materiales por unidad
  UNIQUE (id, clinic_id),
  UNIQUE NULLS NOT DISTINCT (clinic_id, dentist_id, category),
  CHECK ((mode = 'percent') = (percent_bp IS NOT NULL)),
  CHECK ((mode = 'fixed') = (fixed_cents IS NOT NULL)),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES fee_profiles(clinic_id, dentist_id)
);

CREATE TABLE fee_settlements (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES clinics(id),
  dentist_id        uuid NOT NULL,
  period_start      date NOT NULL,
  period_end        date NOT NULL,                   -- inclusive
  status            text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','closed')),
  base              text CHECK (base IN ('production','collected')),
  rules_snapshot    jsonb,
  base_total_cents  bigint,
  fee_total_cents   bigint,
  adjustments_cents bigint,
  total_cents       bigint,
  line_count        int,
  note              text,
  created_by        uuid NOT NULL REFERENCES users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  closed_by         uuid REFERENCES users(id),
  closed_at         timestamptz,
  UNIQUE (id, clinic_id),
  CHECK (period_end >= period_start AND period_end - period_start <= 366),
  CHECK ((status = 'closed') = (closed_at IS NOT NULL)),
  CHECK (status = 'draft' OR (base IS NOT NULL AND total_cents IS NOT NULL AND total_cents = fee_total_cents + adjustments_cents)),
  FOREIGN KEY (clinic_id, dentist_id) REFERENCES memberships(clinic_id, user_id),
  -- Un profesional no tiene dos liquidaciones (borrador o cerrada) con períodos superpuestos.
  CONSTRAINT fee_settlements_no_overlap EXCLUDE USING gist (
    clinic_id WITH =, dentist_id WITH =, daterange(period_start, period_end, '[]') WITH &&)
);
CREATE INDEX fee_settlements_period_idx ON fee_settlements (clinic_id, period_start);

CREATE OR REPLACE FUNCTION fee_settlements_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status = 'closed' THEN
    RAISE EXCEPTION 'Una liquidación cerrada no se modifica ni se elimina; los ajustes van al período siguiente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF (NEW.clinic_id, NEW.dentist_id, NEW.period_start, NEW.period_end, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.clinic_id, OLD.dentist_id, OLD.period_start, OLD.period_end, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'El profesional y el período de una liquidación no se modifican' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_settlements_guard BEFORE UPDATE OR DELETE ON fee_settlements FOR EACH ROW EXECUTE FUNCTION fee_settlements_guard();

CREATE TABLE fee_settlement_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  settlement_id   uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('production','collected','adjustment')),
  branch_id       uuid NOT NULL,
  patient_id      uuid,
  charge_id       uuid,
  payment_id      uuid,
  adjusts_line_id uuid,
  occurred_at     timestamptz NOT NULL,
  description     text NOT NULL,
  category        text,
  quantity        int NOT NULL DEFAULT 1 CHECK (quantity > 0),
  base_cents      bigint NOT NULL,
  deduct_cents    bigint NOT NULL DEFAULT 0,
  mode            text CHECK (mode IN ('percent','fixed')),
  percent_bp      int,
  fixed_cents     bigint,
  fee_cents       bigint NOT NULL,
  UNIQUE (id, clinic_id),
  CHECK (kind <> 'production' OR charge_id IS NOT NULL),
  CHECK (kind <> 'collected' OR payment_id IS NOT NULL),
  CHECK (kind <> 'adjustment' OR (adjusts_line_id IS NOT NULL AND fee_cents <= 0)),
  FOREIGN KEY (settlement_id, clinic_id) REFERENCES fee_settlements(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (charge_id, clinic_id) REFERENCES charges(id, clinic_id),
  FOREIGN KEY (payment_id, clinic_id) REFERENCES payments(id, clinic_id),
  FOREIGN KEY (adjusts_line_id, clinic_id) REFERENCES fee_settlement_lines(id, clinic_id)
);
CREATE INDEX fee_lines_settlement_idx ON fee_settlement_lines (clinic_id, settlement_id);
-- Un cargo o un cobro se liquida una sola vez; cada línea se ajusta una sola vez.
CREATE UNIQUE INDEX fee_lines_charge_once ON fee_settlement_lines (charge_id) WHERE kind = 'production';
CREATE UNIQUE INDEX fee_lines_payment_once ON fee_settlement_lines (payment_id, category) NULLS NOT DISTINCT WHERE kind = 'collected';
CREATE UNIQUE INDEX fee_lines_adjust_once ON fee_settlement_lines (adjusts_line_id) WHERE adjusts_line_id IS NOT NULL;
CREATE TRIGGER fee_settlement_lines_immutable BEFORE UPDATE OR DELETE ON fee_settlement_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Las líneas solo se escriben mientras la liquidación está en borrador (al cerrarla).
CREATE OR REPLACE FUNCTION fee_lines_draft_only() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  SELECT status INTO st FROM fee_settlements WHERE id = NEW.settlement_id AND clinic_id = NEW.clinic_id FOR UPDATE;
  IF st IS DISTINCT FROM 'draft' THEN
    RAISE EXCEPTION 'La liquidación ya está cerrada' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER fee_lines_draft_only BEFORE INSERT ON fee_settlement_lines FOR EACH ROW EXECUTE FUNCTION fee_lines_draft_only();

-- ---------------------------------------------------------------------
-- Row Level Security y privilegios
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['cash_sessions','cash_movements','cash_session_reviews','fee_profiles','fee_rules','fee_settlements','fee_settlement_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON cash_sessions, cash_movements, cash_session_reviews, fee_settlement_lines TO dental_app;
GRANT UPDATE (status, closed_at, closed_by, count_detail, cash_in_cents, voided_cents, movements_in_cents, movements_out_cents,
              expected_cents, counted_cents, difference_cents, close_note) ON cash_sessions TO dental_app;
GRANT SELECT, INSERT, UPDATE ON fee_profiles TO dental_app;
GRANT SELECT, INSERT, DELETE ON fee_rules TO dental_app;
GRANT SELECT, INSERT, DELETE ON fee_settlements TO dental_app;
GRANT UPDATE (status, base, rules_snapshot, base_total_cents, fee_total_cents, adjustments_cents, total_cents, line_count, note, closed_by, closed_at)
  ON fee_settlements TO dental_app;
