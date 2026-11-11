-- =====================================================================
-- 0024 — Convenios y gastos, segunda parte (B-082, B-083; D-07, D-29, D-30)
--
--  * Traslado al paciente de la porción impaga de la empresa: movimiento de
--    SOLO INSERCIÓN (payer_transfers) que la quita de la cuenta de la empresa
--    y la suma al saldo del paciente (patient_money la incluye). Nunca es
--    automático; se revierte solo con otro movimiento (una vez por traslado).
--    La base impide trasladar más que la porción impaga (sin traslados
--    dobles) y, si el motivo es «vencida», antes del plazo del convenio.
--  * Pagos de la empresa en efectivo: confirmados al recibirlos (D-07) y
--    vinculados por trigger a la caja abierta de quien los recibe, igual que
--    los cobros en efectivo de pacientes.
--  * Honorarios «por cobro»: las líneas de pagos de empresas se liquidan una
--    sola vez por aplicación (pago × cargo).
--  * Gastos compartidos entre sucursales: reparto por porcentaje (suma 100 %
--    y el monto exacto al centavo, comprobado al confirmar la transacción) y
--    comprobante adjunto (bytes en FileStore; metadatos de solo inserción).
-- =====================================================================

-- ---------------- Plazo del convenio para trasladar al paciente ----------------
ALTER TABLE agreements
  ADD COLUMN patient_transfer_days smallint NOT NULL DEFAULT 60 CHECK (patient_transfer_days BETWEEN 0 AND 730);
GRANT UPDATE (patient_transfer_days) ON agreements TO dental_app;

-- ---------------- Traslados empresa → paciente (solo inserción) ----------------
CREATE TABLE payer_transfers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  charge_id     uuid NOT NULL,
  agreement_id  uuid NOT NULL,
  patient_id    uuid NOT NULL,
  branch_id     uuid NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents <> 0),        -- + pasa al paciente; − vuelve a la empresa (reversión)
  cause         text NOT NULL CHECK (cause IN ('rejected','overdue','reversal')),
  reason        text NOT NULL CHECK (length(btrim(reason)) BETWEEN 5 AND 300),
  reverses_id   uuid,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK ((cause = 'reversal') = (reverses_id IS NOT NULL)),
  CHECK ((cause = 'reversal') = (amount_cents < 0)),
  FOREIGN KEY (charge_id, clinic_id) REFERENCES charges(id, clinic_id),
  FOREIGN KEY (agreement_id, clinic_id) REFERENCES agreements(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (reverses_id, clinic_id) REFERENCES payer_transfers(id, clinic_id)
);
CREATE UNIQUE INDEX payer_transfers_reverse_once ON payer_transfers (reverses_id) WHERE reverses_id IS NOT NULL;
CREATE INDEX payer_transfers_charge_idx ON payer_transfers (clinic_id, charge_id);
CREATE INDEX payer_transfers_patient_idx ON payer_transfers (clinic_id, patient_id);
CREATE INDEX payer_transfers_agreement_idx ON payer_transfers (clinic_id, agreement_id, created_at);
CREATE TRIGGER payer_transfers_immutable BEFORE UPDATE OR DELETE ON payer_transfers
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Porción VIVA de la empresa en un cargo: lo calculado por el trigger, menos anulaciones y traslados netos.
CREATE OR REPLACE FUNCTION payer_charge_due(p_charge uuid) RETURNS bigint LANGUAGE sql STABLE AS $$
  SELECT COALESCE((SELECT third_party_cents FROM charges WHERE id = p_charge), 0)
       + COALESCE((SELECT sum(third_party_cents) FROM charges WHERE voids_charge_id = p_charge), 0)
       - COALESCE((SELECT sum(amount_cents) FROM payer_transfers WHERE charge_id = p_charge), 0)
$$;

CREATE OR REPLACE FUNCTION payer_transfers_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ch record; o record; open_cents bigint; applied bigint; zone text; days int; age int;
BEGIN
  SELECT patient_id, branch_id, payer_agreement_id, third_party_cents, voids_charge_id, created_at INTO ch
    FROM charges WHERE id = NEW.charge_id AND clinic_id = NEW.clinic_id;
  IF NOT FOUND OR ch.voids_charge_id IS NOT NULL OR ch.payer_agreement_id IS DISTINCT FROM NEW.agreement_id OR ch.third_party_cents <= 0 THEN
    RAISE EXCEPTION 'El cargo no tiene una porción de ese convenio' USING ERRCODE = 'check_violation';
  END IF;
  IF ch.patient_id <> NEW.patient_id OR ch.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'El traslado no corresponde al paciente o a la sucursal del cargo' USING ERRCODE = 'check_violation';
  END IF;
  -- Mismo bloqueo que la aplicación de pagos de la empresa: traslado y pago del mismo cargo no corren a la vez.
  PERFORM pg_advisory_xact_lock(hashtextextended('payalloc:' || NEW.charge_id, 0));
  IF NEW.reverses_id IS NOT NULL THEN
    SELECT charge_id, amount_cents, reverses_id INTO o FROM payer_transfers WHERE id = NEW.reverses_id AND clinic_id = NEW.clinic_id;
    IF NOT FOUND OR o.charge_id <> NEW.charge_id OR o.reverses_id IS NOT NULL OR NEW.amount_cents <> -o.amount_cents THEN
      RAISE EXCEPTION 'La reversión no corresponde a ese traslado' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM charges WHERE voids_charge_id = NEW.charge_id) THEN
    RAISE EXCEPTION 'El cargo está anulado' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(sum(a.amount_cents), 0) INTO applied FROM payer_payment_allocations a JOIN payer_payments p ON p.id = a.payment_id
   WHERE a.charge_id = NEW.charge_id AND p.status IN ('pending_verification','confirmed');
  open_cents := payer_charge_due(NEW.charge_id) - applied;
  IF NEW.amount_cents > open_cents THEN
    RAISE EXCEPTION 'El monto supera la porción impaga de la empresa en ese cargo' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.cause = 'overdue' THEN
    SELECT patient_transfer_days INTO days FROM agreements WHERE id = NEW.agreement_id;
    SELECT COALESCE(timezone, 'America/La_Paz') INTO zone FROM clinics WHERE id = NEW.clinic_id;
    zone := COALESCE(zone, 'America/La_Paz');
    age := (COALESCE(NEW.created_at, now()) AT TIME ZONE zone)::date - (ch.created_at AT TIME ZONE zone)::date;
    IF age < days THEN
      RAISE EXCEPTION 'La porción todavía no está vencida para trasladarla al paciente (plazo del convenio: % días)', days USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payer_transfers_check BEFORE INSERT ON payer_transfers FOR EACH ROW EXECUTE FUNCTION payer_transfers_check();

-- Anular un cargo con una porción trasladada dejaría al paciente debiendo lo trasladado: primero se revierte.
CREATE OR REPLACE FUNCTION charges_void_transfer_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.voids_charge_id IS NOT NULL
     AND COALESCE((SELECT sum(amount_cents) FROM payer_transfers WHERE charge_id = NEW.voids_charge_id), 0) <> 0 THEN
    RAISE EXCEPTION 'Este cargo tiene una porción del convenio trasladada al paciente: revierte primero el traslado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER charges_void_transfer_guard BEFORE INSERT ON charges FOR EACH ROW EXECUTE FUNCTION charges_void_transfer_guard();

-- Lo aplicado por pagos de la empresa no supera la porción viva (ahora descontando los traslados).
CREATE OR REPLACE FUNCTION payer_allocation_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ag uuid; ch record; outstanding bigint; applied bigint;
BEGIN
  SELECT agreement_id INTO ag FROM payer_payments WHERE id = NEW.payment_id AND clinic_id = NEW.clinic_id;
  SELECT payer_agreement_id, third_party_cents, voids_charge_id INTO ch FROM charges WHERE id = NEW.charge_id AND clinic_id = NEW.clinic_id;
  IF ch.voids_charge_id IS NOT NULL OR ch.payer_agreement_id IS DISTINCT FROM ag THEN
    RAISE EXCEPTION 'El cargo no corresponde a ese convenio' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payalloc:' || NEW.charge_id, 0));
  outstanding := payer_charge_due(NEW.charge_id);
  SELECT COALESCE(sum(a.amount_cents), 0) INTO applied FROM payer_payment_allocations a JOIN payer_payments p ON p.id = a.payment_id
   WHERE a.charge_id = NEW.charge_id AND p.status IN ('pending_verification','confirmed');
  IF applied + NEW.amount_cents > outstanding THEN
    RAISE EXCEPTION 'El monto aplicado supera lo pendiente del cargo' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

-- ---------------- Saldo único del paciente: + lo trasladado desde la empresa ----------------
-- Único cambio respecto de 0019: charged_cents suma también payer_transfers.amount_cents del paciente.
-- Integración v0.6: una sola fórmula del saldo (vista patient_money_v de 0022) que ahora suma lo
-- trasladado desde la empresa al paciente; incluye los saldos iniciales de 0021.
CREATE OR REPLACE VIEW patient_money_v WITH (security_invoker = true) AS
  SELECT p.id AS patient_id,
         COALESCE(bud.v, 0)::bigint AS budgeted_cents,
         (COALESCE(ch.v, 0) + COALESCE(tr.v, 0))::bigint AS charged_cents,
         COALESCE(pay.paid, 0)::bigint AS paid_cents,
         COALESCE(pay.on_account, 0)::bigint AS on_account_cents,
         COALESCE(pay.pending, 0)::bigint AS pending_cents,
         (COALESCE(ch.v, 0) + COALESCE(tr.v, 0) + COALESCE(ob.v, 0) - COALESCE(pay.paid, 0))::bigint AS balance_cents,
         pay.last_at AS last_payment_at,
         COALESCE(ob.v, 0)::bigint AS opening_cents
    FROM patients p
    LEFT JOIN (SELECT patient_id, sum(amount_cents - third_party_cents) AS v FROM charges GROUP BY patient_id) ch ON ch.patient_id = p.id
    LEFT JOIN (SELECT patient_id, sum(amount_cents) AS v FROM payer_transfers GROUP BY patient_id) tr ON tr.patient_id = p.id
    LEFT JOIN (SELECT patient_id, sum(amount_cents) AS v FROM opening_balances GROUP BY patient_id) ob ON ob.patient_id = p.id
    LEFT JOIN (SELECT patient_id,
                      sum(amount_cents) FILTER (WHERE status = 'confirmed') AS paid,
                      sum(amount_cents) FILTER (WHERE status = 'confirmed' AND budget_id IS NULL) AS on_account,
                      sum(amount_cents) FILTER (WHERE status = 'pending_verification') AS pending,
                      max(received_at) FILTER (WHERE status = 'confirmed') AS last_at
                 FROM payments GROUP BY patient_id) pay ON pay.patient_id = p.id
    LEFT JOIN (SELECT b.patient_id, sum(i.net_cents) AS v
                 FROM budget_items i JOIN budgets b ON b.id = i.budget_id
                WHERE b.status IN ('accepted','completed') AND i.status <> 'cancelled'
                GROUP BY b.patient_id) bud ON bud.patient_id = p.id;
-- patient_money (de 0022) ya lee la vista: no cambia.

-- ---------------- Pagos de la empresa en efectivo ----------------
ALTER TABLE payer_payments DROP CONSTRAINT payer_payments_method_check;
ALTER TABLE payer_payments ADD CONSTRAINT payer_payments_method_check CHECK (method IN ('cash','transfer','qr','card'));
ALTER TABLE payer_payments ALTER COLUMN bank_reference DROP NOT NULL;
ALTER TABLE payer_payments
  ADD CONSTRAINT payer_payments_bankref_required CHECK (method = 'cash' OR bank_reference IS NOT NULL),
  -- D-07: el efectivo queda confirmado al recibirlo (nunca «por verificar»).
  ADD CONSTRAINT payer_payments_cash_confirmed CHECK (method <> 'cash' OR status IN ('confirmed','voided')),
  ADD COLUMN cash_session_id uuid,
  ADD CONSTRAINT payer_payments_cash_session_fk FOREIGN KEY (cash_session_id, clinic_id) REFERENCES cash_sessions(id, clinic_id),
  ADD CONSTRAINT payer_payments_cash_session_method CHECK (cash_session_id IS NULL OR method = 'cash');
CREATE INDEX payer_payments_cash_session_idx ON payer_payments (cash_session_id) WHERE cash_session_id IS NOT NULL;
-- Mismas funciones que los cobros de pacientes: caja abierta de quien recibe, en esa sucursal; vínculo fijo.
CREATE TRIGGER payer_payments_link_cash_session BEFORE INSERT ON payer_payments FOR EACH ROW EXECUTE FUNCTION payments_link_cash_session();
CREATE TRIGGER payer_payments_cash_session_fixed BEFORE UPDATE ON payer_payments FOR EACH ROW EXECUTE FUNCTION payments_cash_session_fixed();

-- ---------------- Honorarios «por cobro» con pagos de empresas ----------------
ALTER TABLE fee_settlement_lines DROP CONSTRAINT fee_settlement_lines_kind_check;
ALTER TABLE fee_settlement_lines
  ADD CONSTRAINT fee_settlement_lines_kind_check CHECK (kind IN ('production','collected','collected_payer','adjustment')),
  ADD COLUMN payer_allocation_id uuid,
  ADD CONSTRAINT fee_lines_payer_alloc_fk FOREIGN KEY (payer_allocation_id, clinic_id) REFERENCES payer_payment_allocations(id, clinic_id),
  ADD CONSTRAINT fee_lines_payer_alloc_ck CHECK ((kind = 'collected_payer') = (payer_allocation_id IS NOT NULL));
-- Cada aplicación de un pago de empresa se liquida una sola vez.
CREATE UNIQUE INDEX fee_lines_payer_alloc_once ON fee_settlement_lines (payer_allocation_id) WHERE kind = 'collected_payer';

-- ---------------- Gastos compartidos entre sucursales ----------------
CREATE TABLE expense_shares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  expense_id    uuid NOT NULL,
  branch_id     uuid NOT NULL,
  percent_bp    int NOT NULL CHECK (percent_bp BETWEEN 1 AND 9999),   -- centésimos de punto: 3333 = 33,33 %
  amount_cents  bigint NOT NULL CHECK (amount_cents >= 0),
  UNIQUE (id, clinic_id),
  UNIQUE (expense_id, branch_id),
  FOREIGN KEY (expense_id, clinic_id) REFERENCES expenses(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE INDEX expense_shares_branch_idx ON expense_shares (clinic_id, branch_id);

-- El reparto solo cambia mientras el gasto es borrador (no anulado); confirmado queda fijo.
CREATE OR REPLACE FUNCTION expense_shares_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; st text;
BEGIN
  IF TG_OP = 'DELETE' THEN eid := OLD.expense_id; ELSE eid := NEW.expense_id; END IF;
  SELECT status INTO st FROM expenses WHERE id = eid;
  IF st IS DISTINCT FROM 'draft' OR EXISTS (SELECT 1 FROM expense_voids v WHERE v.expense_id = eid) THEN
    RAISE EXCEPTION 'El reparto de un gasto confirmado o anulado no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expense_shares_guard BEFORE INSERT OR UPDATE OR DELETE ON expense_shares FOR EACH ROW EXECUTE FUNCTION expense_shares_guard();

-- Al confirmar la transacción: 2 o más sucursales, 100 % exacto, montos que suman el gasto y la
-- sucursal principal del gasto entre las del reparto.
CREATE OR REPLACE FUNCTION expense_shares_total() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE eid uuid; n int; bp bigint; amt bigint; e record;
BEGIN
  IF TG_TABLE_NAME = 'expenses' THEN eid := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN eid := OLD.expense_id;
  ELSE eid := NEW.expense_id; END IF;
  SELECT count(*), COALESCE(sum(percent_bp), 0), COALESCE(sum(amount_cents), 0) INTO n, bp, amt FROM expense_shares WHERE expense_id = eid;
  IF n = 0 THEN RETURN NULL; END IF;
  SELECT amount_cents, branch_id INTO e FROM expenses WHERE id = eid;
  IF n < 2 OR bp <> 10000 OR amt <> e.amount_cents
     OR NOT EXISTS (SELECT 1 FROM expense_shares WHERE expense_id = eid AND branch_id = e.branch_id) THEN
    RAISE EXCEPTION 'El reparto del gasto debe tener dos o más sucursales, sumar 100 %% y el monto exacto' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER expense_shares_total AFTER INSERT OR UPDATE OR DELETE ON expense_shares
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION expense_shares_total();
CREATE CONSTRAINT TRIGGER expenses_shares_total AFTER UPDATE ON expenses
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION expense_shares_total();

-- ---------------- Comprobante adjunto del gasto ----------------
CREATE TABLE expense_attachments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  expense_id      uuid NOT NULL,
  original_name   text CHECK (original_name IS NULL OR length(original_name) <= 200),
  mime_type       text NOT NULL CHECK (mime_type IN ('image/jpeg','image/png','image/webp','application/pdf')),
  size_bytes      int NOT NULL CHECK (size_bytes > 0),
  sha256          text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  storage_driver  text NOT NULL CHECK (storage_driver IN ('local','s3')),
  storage_key     text NOT NULL UNIQUE,
  uploaded_by     uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CONSTRAINT expense_attachments_hash_uq UNIQUE (expense_id, sha256),
  FOREIGN KEY (expense_id, clinic_id) REFERENCES expenses(id, clinic_id)
);
CREATE INDEX expense_attachments_expense_idx ON expense_attachments (clinic_id, expense_id);
CREATE TRIGGER expense_attachments_immutable BEFORE UPDATE OR DELETE ON expense_attachments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE OR REPLACE FUNCTION expense_attachments_not_voided() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM expense_voids v WHERE v.expense_id = NEW.expense_id) THEN
    RAISE EXCEPTION 'No se adjuntan comprobantes a un gasto anulado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER expense_attachments_not_voided BEFORE INSERT ON expense_attachments FOR EACH ROW EXECUTE FUNCTION expense_attachments_not_voided();

-- ---------------- RLS y privilegios ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['payer_transfers','expense_shares','expense_attachments'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON payer_transfers, expense_attachments TO dental_app;
GRANT SELECT, INSERT, DELETE ON expense_shares TO dental_app;
