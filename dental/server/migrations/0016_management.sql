-- =====================================================================
-- 0016 — Vista del dueño y del gerente (R2-41, R2-43, B-017, B-033)
--
--  * expenses: gastos por sucursal y categoría, en centavos. Un borrador se
--    edita y se confirma; un gasto confirmado ya no cambia. Anular es una
--    fila nueva en expense_voids (solo inserción) con motivo.
--  * expense_recurring: gastos fijos mensuales (alquiler, sueldos, servicios)
--    que se generan como BORRADOR de cada mes para confirmarlos. El índice
--    único (recurring_id, period_month) impide generar dos veces el mismo mes.
--  * timeclock_staff: quién tiene activado el fichaje (botón en Inicio).
--  * time_entries: marcas de entrada y salida por sucursal, de SOLO
--    INSERCIÓN. Una marca propia lleva la hora del servidor (no se puede
--    antedatar). La gerencia corrige agregando una marca o anulando otra,
--    siempre con motivo y como fila nueva.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Gastos recurrentes (plantillas mensuales)
-- ---------------------------------------------------------------------
CREATE TABLE expense_recurring (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  branch_id     uuid NOT NULL,
  category      text NOT NULL CHECK (category IN ('rent','salaries','utilities','supplies','marketing','maintenance','taxes','other')),
  description   text NOT NULL CHECK (length(btrim(description)) BETWEEN 3 AND 200),
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
  supplier      text CHECK (supplier IS NULL OR length(supplier) <= 120),
  day_of_month  smallint NOT NULL DEFAULT 1 CHECK (day_of_month BETWEEN 1 AND 28),
  starts_month  date NOT NULL CHECK (extract(day FROM starts_month) = 1),
  ends_month    date CHECK (ends_month IS NULL OR (extract(day FROM ends_month) = 1 AND ends_month >= starts_month)),
  active        boolean NOT NULL DEFAULT true,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE INDEX expense_recurring_idx ON expense_recurring (clinic_id, branch_id);

-- ---------------------------------------------------------------------
-- Gastos
-- ---------------------------------------------------------------------
CREATE TABLE expenses (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  branch_id     uuid NOT NULL,
  category      text NOT NULL CHECK (category IN ('rent','salaries','utilities','supplies','marketing','maintenance','taxes','other')),
  description   text NOT NULL CHECK (length(btrim(description)) BETWEEN 3 AND 200),
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0 AND amount_cents <= 100000000000),
  expense_date  date NOT NULL,
  supplier      text CHECK (supplier IS NULL OR length(supplier) <= 120),
  receipt_ref   text CHECK (receipt_ref IS NULL OR length(receipt_ref) <= 120),   -- N° de factura, recibo o referencia del comprobante
  notes         text CHECK (notes IS NULL OR length(notes) <= 500),
  status        text NOT NULL DEFAULT 'confirmed' CHECK (status IN ('draft','confirmed')),
  recurring_id  uuid,
  period_month  date,                                  -- mes del gasto recurrente que generó este borrador
  idempotency_key text,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  confirmed_by  uuid REFERENCES users(id),
  confirmed_at  timestamptz,
  UNIQUE (id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (recurring_id, clinic_id) REFERENCES expense_recurring(id, clinic_id),
  CHECK ((recurring_id IS NULL) = (period_month IS NULL)),
  CHECK (period_month IS NULL OR extract(day FROM period_month) = 1),
  CHECK ((status = 'confirmed') = (confirmed_at IS NOT NULL AND confirmed_by IS NOT NULL))
);
-- Un recurrente genera un solo gasto por mes (aunque se pida generar varias veces o a la vez).
CREATE UNIQUE INDEX expenses_recurring_once ON expenses (recurring_id, period_month) WHERE recurring_id IS NOT NULL;
CREATE UNIQUE INDEX expenses_idem_uq ON expenses (clinic_id, idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX expenses_branch_date_idx ON expenses (clinic_id, branch_id, expense_date);

CREATE TABLE expense_voids (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  expense_id    uuid NOT NULL,
  reason        text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 300),
  voided_by     uuid NOT NULL REFERENCES users(id),
  voided_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (expense_id),
  FOREIGN KEY (expense_id, clinic_id) REFERENCES expenses(id, clinic_id)
);
CREATE TRIGGER expense_voids_immutable BEFORE UPDATE OR DELETE ON expense_voids
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Un gasto no se borra. Solo un borrador no anulado se edita o se confirma;
-- un gasto confirmado (o anulado) queda fijo, incluso para el dueño de la base.
CREATE OR REPLACE FUNCTION expenses_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los gastos no se eliminan; se anulan con motivo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status = 'confirmed' THEN
    RAISE EXCEPTION 'Un gasto confirmado no se modifica; anúlalo y registra uno nuevo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF EXISTS (SELECT 1 FROM expense_voids v WHERE v.expense_id = OLD.id) THEN
    RAISE EXCEPTION 'Un gasto anulado no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.id, NEW.clinic_id, NEW.recurring_id, NEW.period_month, NEW.created_by, NEW.created_at, NEW.idempotency_key)
     IS DISTINCT FROM (OLD.id, OLD.clinic_id, OLD.recurring_id, OLD.period_month, OLD.created_by, OLD.created_at, OLD.idempotency_key) THEN
    RAISE EXCEPTION 'El origen de un gasto no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expenses_guard BEFORE UPDATE OR DELETE ON expenses FOR EACH ROW EXECUTE FUNCTION expenses_guard();

-- ---------------------------------------------------------------------
-- Fichaje del personal
-- ---------------------------------------------------------------------
CREATE TABLE timeclock_staff (
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  user_id       uuid NOT NULL,
  enabled       boolean NOT NULL DEFAULT true,
  updated_by    uuid REFERENCES users(id),
  updated_at    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (clinic_id, user_id),
  FOREIGN KEY (clinic_id, user_id) REFERENCES memberships(clinic_id, user_id)
);

CREATE TABLE time_entries (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  user_id         uuid NOT NULL,
  branch_id       uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('in','out','void')),
  at              timestamptz NOT NULL DEFAULT now(),
  source          text NOT NULL CHECK (source IN ('self','manager')),
  reason          text CHECK (reason IS NULL OR length(reason) <= 300),
  voids_entry_id  uuid,
  recorded_by     uuid NOT NULL REFERENCES users(id),
  recorded_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (clinic_id, user_id) REFERENCES memberships(clinic_id, user_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (voids_entry_id, clinic_id) REFERENCES time_entries(id, clinic_id),
  CHECK ((kind = 'void') = (voids_entry_id IS NOT NULL)),
  -- La marca propia lleva la hora del servidor y la registra la misma persona (no se antedata).
  CHECK (source <> 'self' OR (kind <> 'void' AND at = recorded_at AND recorded_by = user_id)),
  -- Toda corrección de gerencia lleva motivo.
  CHECK (source <> 'manager' OR length(btrim(coalesce(reason, ''))) >= 5)
);
CREATE INDEX time_entries_user_idx ON time_entries (clinic_id, user_id, at);
CREATE INDEX time_entries_branch_idx ON time_entries (clinic_id, branch_id, at);
CREATE UNIQUE INDEX time_entries_void_once ON time_entries (voids_entry_id) WHERE voids_entry_id IS NOT NULL;
CREATE TRIGGER time_entries_immutable BEFORE UPDATE OR DELETE ON time_entries
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Una anulación apunta a una marca de entrada o salida de la misma persona.
CREATE OR REPLACE FUNCTION time_entries_void_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  IF NEW.kind <> 'void' THEN
    RETURN NEW;
  END IF;
  SELECT kind, user_id, branch_id INTO o FROM time_entries WHERE id = NEW.voids_entry_id AND clinic_id = NEW.clinic_id;
  IF o.kind IS NULL OR o.kind = 'void' OR o.user_id <> NEW.user_id OR o.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'La anulación no corresponde a una marca de esa persona' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER time_entries_void_check BEFORE INSERT ON time_entries FOR EACH ROW EXECUTE FUNCTION time_entries_void_check();

-- ---------------------------------------------------------------------
-- Row Level Security y privilegios mínimos
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['expense_recurring','expenses','expense_voids','timeclock_staff','time_entries'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON expense_recurring, expenses, expense_voids, time_entries, timeclock_staff TO dental_app;
GRANT UPDATE (category, description, amount_cents, supplier, day_of_month, ends_month, active, updated_at) ON expense_recurring TO dental_app;
GRANT UPDATE (branch_id, category, description, amount_cents, expense_date, supplier, receipt_ref, notes, status, confirmed_by, confirmed_at) ON expenses TO dental_app;
GRANT UPDATE (enabled, updated_by, updated_at) ON timeclock_staff TO dental_app;
