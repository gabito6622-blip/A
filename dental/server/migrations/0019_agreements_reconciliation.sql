-- =====================================================================
-- 0019 — Dinero de terceros y conciliación (R2-32, B-021, D-07, D-13)
--
--  * Convenios con empresas, colegios y asociaciones: vigencia, precios
--    especiales por prestación o % de descuento por categoría, y la parte que
--    paga la empresa (% con tope opcional por paciente y año calendario).
--  * Afiliación del paciente a un convenio (N° de afiliado y vigencia; sin
--    afiliaciones superpuestas).
--  * Las líneas del presupuesto guardan una COPIA del precio de lista, del
--    precio del convenio y de la parte de la empresa: un cambio posterior del
--    convenio no las altera (y se congelan al presentar el presupuesto).
--  * Pagador distinto: cada cargo lleva la porción del tercero
--    (third_party_cents), calculada por la base al insertarlo (trigger), con el
--    tope anual y la vigencia de la afiliación. patient_money excluye esa
--    porción: sigue siendo la única verdad del saldo del paciente.
--  * Pagos de la empresa (pendiente de verificación → otra persona confirma,
--    D-07) aplicados a varios cargos; referencia bancaria única también entre
--    pagos de pacientes y de empresas.
--  * Facturación parcial "pendiente de facturar" para el futuro proveedor SIAT
--    (D-13 ⚠): no emite factura fiscal; la base impide marcar más que la línea.
--  * Conciliación bancaria por extracto: líneas con hash único (reimportar no
--    duplica), cada movimiento y cada pago se usan una sola vez, y nunca se
--    verifica solo: lo confirma una persona con payments.verify.
-- =====================================================================

-- ---------------- Convenios ----------------
CREATE TABLE agreements (
  id                     uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id              uuid NOT NULL REFERENCES clinics(id),
  name                   text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  kind                   text NOT NULL DEFAULT 'company' CHECK (kind IN ('company','school','association','other')),
  tax_id                 text CHECK (tax_id IS NULL OR tax_id ~ '^[0-9]{5,15}$'),             -- NIT (opcional)
  billing_name           text CHECK (billing_name IS NULL OR length(billing_name) BETWEEN 2 AND 160), -- razón social
  contact_name           text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  contact_phone          text CHECK (contact_phone IS NULL OR length(contact_phone) <= 30),
  contact_email          text CHECK (contact_email IS NULL OR length(contact_email) <= 160),
  valid_from             date NOT NULL,
  valid_to               date,
  default_discount_percent numeric(5,2) NOT NULL DEFAULT 0 CHECK (default_discount_percent BETWEEN 0 AND 100),
  company_share_percent  numeric(5,2) NOT NULL DEFAULT 0 CHECK (company_share_percent BETWEEN 0 AND 100),
  company_cap_cents      bigint CHECK (company_cap_cents IS NULL OR company_cap_cents > 0),  -- tope por paciente y año
  payment_terms_days     smallint NOT NULL DEFAULT 30 CHECK (payment_terms_days BETWEEN 0 AND 180),
  notes                  text CHECK (notes IS NULL OR length(notes) <= 1000),
  active                 boolean NOT NULL DEFAULT true,
  created_by             uuid REFERENCES users(id),
  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK (company_cap_cents IS NULL OR company_share_percent > 0)
);
CREATE UNIQUE INDEX agreements_name_uq ON agreements (clinic_id, lower(name));

-- Reglas de precio: precio fijo o % por prestación, o % por categoría del catálogo.
CREATE TABLE agreement_rules (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  agreement_id     uuid NOT NULL,
  procedure_id     uuid,
  category         text CHECK (category IS NULL OR length(category) BETWEEN 1 AND 60),
  price_cents      bigint CHECK (price_cents IS NULL OR price_cents >= 0),
  discount_percent numeric(5,2) CHECK (discount_percent IS NULL OR discount_percent BETWEEN 0 AND 100),
  UNIQUE (id, clinic_id),
  CHECK ((procedure_id IS NULL) <> (category IS NULL)),
  CHECK ((price_cents IS NULL) <> (discount_percent IS NULL)),
  CHECK (category IS NULL OR price_cents IS NULL),
  FOREIGN KEY (agreement_id, clinic_id) REFERENCES agreements(id, clinic_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id)
);
CREATE UNIQUE INDEX agreement_rules_proc_uq ON agreement_rules (agreement_id, procedure_id) WHERE procedure_id IS NOT NULL;
CREATE UNIQUE INDEX agreement_rules_cat_uq ON agreement_rules (agreement_id, lower(category)) WHERE category IS NOT NULL;

-- Afiliación del paciente (N° de afiliado y vigencia). Sin afiliaciones superpuestas.
CREATE TABLE patient_agreements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES clinics(id),
  patient_id     uuid NOT NULL,
  agreement_id   uuid NOT NULL,
  member_number  text NOT NULL CHECK (length(member_number) BETWEEN 1 AND 40),
  holder_name    text CHECK (holder_name IS NULL OR length(holder_name) BETWEEN 2 AND 120),  -- titular si es dependiente
  valid_from     date NOT NULL,
  valid_to       date,
  ended_at       timestamptz,
  ended_by       uuid REFERENCES users(id),
  end_reason     text CHECK (end_reason IS NULL OR length(end_reason) BETWEEN 3 AND 300),
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK (valid_to IS NULL OR valid_to >= valid_from),
  CHECK ((ended_at IS NULL) = (end_reason IS NULL)),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (agreement_id, clinic_id) REFERENCES agreements(id, clinic_id),
  CONSTRAINT patient_agreements_no_overlap EXCLUDE USING gist
    (clinic_id WITH =, patient_id WITH =, daterange(valid_from, valid_to, '[]') WITH &&)
);
CREATE INDEX patient_agreements_agreement_idx ON patient_agreements (clinic_id, agreement_id);

-- ---------------- Copia del convenio en la línea del presupuesto ----------------
ALTER TABLE budget_items
  ADD COLUMN agreement_id            uuid,
  ADD COLUMN patient_agreement_id    uuid,
  ADD COLUMN list_unit_price_cents   bigint CHECK (list_unit_price_cents IS NULL OR list_unit_price_cents >= 0),
  ADD COLUMN agreement_note          text CHECK (agreement_note IS NULL OR length(agreement_note) <= 160),
  ADD COLUMN company_share_percent   numeric(5,2) CHECK (company_share_percent IS NULL OR company_share_percent BETWEEN 0 AND 100),
  ADD COLUMN company_cap_cents       bigint CHECK (company_cap_cents IS NULL OR company_cap_cents > 0),
  ADD CONSTRAINT budget_items_agreement_fk FOREIGN KEY (agreement_id, clinic_id) REFERENCES agreements(id, clinic_id),
  ADD CONSTRAINT budget_items_patient_agreement_fk FOREIGN KEY (patient_agreement_id, clinic_id) REFERENCES patient_agreements(id, clinic_id),
  ADD CONSTRAINT budget_items_agreement_pair CHECK ((agreement_id IS NULL) = (patient_agreement_id IS NULL)),
  ADD CONSTRAINT budget_items_agreement_copy CHECK (agreement_id IS NOT NULL OR (list_unit_price_cents IS NULL AND company_share_percent IS NULL AND company_cap_cents IS NULL));

-- La copia del convenio se congela con el resto de los importes (solo cambia en borrador).
CREATE OR REPLACE FUNCTION budget_items_agreement_freeze() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE st text;
BEGIN
  IF (NEW.agreement_id, NEW.patient_agreement_id, NEW.list_unit_price_cents, NEW.agreement_note, NEW.company_share_percent, NEW.company_cap_cents)
     IS DISTINCT FROM (OLD.agreement_id, OLD.patient_agreement_id, OLD.list_unit_price_cents, OLD.agreement_note, OLD.company_share_percent, OLD.company_cap_cents) THEN
    SELECT status INTO st FROM budgets WHERE id = OLD.budget_id;
    IF st IS DISTINCT FROM 'draft' THEN
      RAISE EXCEPTION 'Las condiciones del convenio de un presupuesto presentado no se modifican; crea una nueva versión'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER budget_items_agreement_freeze BEFORE UPDATE ON budget_items FOR EACH ROW EXECUTE FUNCTION budget_items_agreement_freeze();

-- ---------------- Porción del tercero en cada cargo ----------------
ALTER TABLE charges
  ADD COLUMN payer_agreement_id uuid,
  ADD COLUMN third_party_cents  bigint NOT NULL DEFAULT 0,
  ADD CONSTRAINT charges_payer_agreement_fk FOREIGN KEY (payer_agreement_id, clinic_id) REFERENCES agreements(id, clinic_id),
  ADD CONSTRAINT charges_third_party_ck CHECK (
    third_party_cents = 0
    OR (payer_agreement_id IS NOT NULL AND sign(third_party_cents) = sign(amount_cents) AND abs(third_party_cents) <= abs(amount_cents)));
CREATE INDEX charges_payer_idx ON charges (clinic_id, payer_agreement_id, created_at) WHERE payer_agreement_id IS NOT NULL;

-- La base calcula la porción (la aplicación no la puede fijar):
--  * anulación: la misma porción con signo negativo (libera el tope anual);
--  * cargo de una línea con convenio: % de la empresa, redondeado al centavo (mitad hacia arriba),
--    limitado al saldo del tope anual del paciente en ese convenio, y solo si la afiliación y el
--    convenio están vigentes en la fecha del cargo (si no, paga todo el paciente).
CREATE OR REPLACE FUNCTION charges_third_party() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record; it record; zone text; d date; used bigint; share bigint;
BEGIN
  NEW.third_party_cents := 0;
  NEW.payer_agreement_id := NULL;
  IF NEW.voids_charge_id IS NOT NULL THEN
    SELECT payer_agreement_id, third_party_cents INTO o FROM charges WHERE id = NEW.voids_charge_id AND clinic_id = NEW.clinic_id;
    IF FOUND AND o.third_party_cents <> 0 THEN
      NEW.payer_agreement_id := o.payer_agreement_id;
      NEW.third_party_cents := -o.third_party_cents;
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.budget_item_id IS NULL OR NEW.amount_cents <= 0 THEN
    RETURN NEW;
  END IF;
  SELECT agreement_id, patient_agreement_id, company_share_percent, company_cap_cents INTO it
    FROM budget_items WHERE id = NEW.budget_item_id AND clinic_id = NEW.clinic_id;
  IF NOT FOUND OR it.agreement_id IS NULL OR COALESCE(it.company_share_percent, 0) = 0 THEN
    RETURN NEW;
  END IF;
  SELECT COALESCE(timezone, 'America/La_Paz') INTO zone FROM clinics WHERE id = NEW.clinic_id;
  zone := COALESCE(zone, 'America/La_Paz');
  d := (COALESCE(NEW.created_at, now()) AT TIME ZONE zone)::date;
  IF NOT EXISTS (
    SELECT 1 FROM patient_agreements pa JOIN agreements a ON a.id = pa.agreement_id
     WHERE pa.id = it.patient_agreement_id AND pa.patient_id = NEW.patient_id AND a.active
       AND d BETWEEN pa.valid_from AND COALESCE(pa.valid_to, 'infinity'::date)
       AND d BETWEEN a.valid_from AND COALESCE(a.valid_to, 'infinity'::date)) THEN
    RETURN NEW;
  END IF;
  share := (NEW.amount_cents * round(it.company_share_percent * 100)::bigint + 5000) / 10000;
  IF it.company_cap_cents IS NOT NULL THEN
    -- Serializa los cargos del mismo paciente y convenio para que dos cargos simultáneos no superen el tope.
    PERFORM pg_advisory_xact_lock(hashtextextended('agcap:' || NEW.clinic_id || ':' || NEW.patient_id || ':' || it.agreement_id, 0));
    SELECT COALESCE(sum(third_party_cents), 0) INTO used FROM charges
     WHERE clinic_id = NEW.clinic_id AND patient_id = NEW.patient_id AND payer_agreement_id = it.agreement_id
       AND date_part('year', created_at AT TIME ZONE zone) = date_part('year', d);
    share := LEAST(share, GREATEST(it.company_cap_cents - used, 0));
  END IF;
  IF share > 0 THEN
    NEW.payer_agreement_id := it.agreement_id;
    NEW.third_party_cents := share;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER charges_third_party BEFORE INSERT ON charges FOR EACH ROW EXECUTE FUNCTION charges_third_party();

-- ---------------- Saldo único del paciente: sin la porción del tercero ----------------
-- charged_cents pasa a ser lo realizado A CARGO DEL PACIENTE; la parte del convenio se cobra a la empresa.
CREATE OR REPLACE FUNCTION patient_money(p_patient uuid)
  RETURNS TABLE (budgeted_cents bigint, charged_cents bigint, paid_cents bigint, on_account_cents bigint,
                 pending_cents bigint, balance_cents bigint, last_payment_at timestamptz)
  LANGUAGE sql STABLE AS $$
  WITH ch AS (SELECT COALESCE(sum(amount_cents - third_party_cents), 0)::bigint AS v FROM charges WHERE patient_id = p_patient),
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

-- ---------------- Pagos de la empresa (D-07: pendiente → otra persona verifica) ----------------
CREATE TABLE payer_payments (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  number          bigint NOT NULL CHECK (number > 0),
  agreement_id    uuid NOT NULL,
  branch_id       uuid NOT NULL,
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  method          text NOT NULL CHECK (method IN ('transfer','qr','card')),
  status          text NOT NULL DEFAULT 'pending_verification' CHECK (status IN ('pending_verification','confirmed','rejected','voided')),
  bank_reference  text NOT NULL CHECK (length(bank_reference) BETWEEN 1 AND 80),
  notes           text CHECK (notes IS NULL OR length(notes) <= 500),
  idempotency_key text NOT NULL CHECK (length(idempotency_key) BETWEEN 8 AND 80),
  received_by     uuid NOT NULL REFERENCES users(id),
  received_at     timestamptz NOT NULL DEFAULT now(),
  verified_by     uuid REFERENCES users(id),
  verified_at     timestamptz,
  status_reason   text CHECK (status_reason IS NULL OR length(status_reason) <= 300),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, number),
  UNIQUE (clinic_id, idempotency_key),
  FOREIGN KEY (agreement_id, clinic_id) REFERENCES agreements(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE UNIQUE INDEX payer_payments_bankref_uq ON payer_payments (clinic_id, method, bank_reference)
  WHERE status IN ('pending_verification','confirmed');
CREATE INDEX payer_payments_agreement_idx ON payer_payments (clinic_id, agreement_id, received_at);

CREATE OR REPLACE FUNCTION payer_payments_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los pagos no se eliminan; se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.amount_cents, NEW.method, NEW.agreement_id, NEW.branch_id, NEW.clinic_id, NEW.number, NEW.received_at, NEW.received_by, NEW.idempotency_key, NEW.bank_reference)
     IS DISTINCT FROM (OLD.amount_cents, OLD.method, OLD.agreement_id, OLD.branch_id, OLD.clinic_id, OLD.number, OLD.received_at, OLD.received_by, OLD.idempotency_key, OLD.bank_reference) THEN
    RAISE EXCEPTION 'Los datos de un pago registrado no se modifican' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NOT ((OLD.status = 'pending_verification' AND NEW.status IN ('confirmed','rejected'))
       OR (OLD.status = 'confirmed' AND NEW.status = 'voided')
       OR (OLD.status = NEW.status)) THEN
    RAISE EXCEPTION 'Transición de estado inválida: % -> %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payer_payments_guard BEFORE UPDATE OR DELETE ON payer_payments FOR EACH ROW EXECUTE FUNCTION payer_payments_guard();

-- Referencia bancaria única ENTRE pagos de pacientes y pagos de empresas (misma clínica y medio).
-- El bloqueo consultivo serializa dos registros simultáneos de la misma referencia.
CREATE OR REPLACE FUNCTION bank_reference_cross_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.bank_reference IS NULL OR NEW.status NOT IN ('pending_verification','confirmed') THEN
    RETURN NEW;
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('bankref:' || NEW.clinic_id || ':' || NEW.method || ':' || NEW.bank_reference, 0));
  IF EXISTS (SELECT 1 FROM payments WHERE clinic_id = NEW.clinic_id AND method = NEW.method AND bank_reference = NEW.bank_reference
               AND status IN ('pending_verification','confirmed'))
     OR EXISTS (SELECT 1 FROM payer_payments WHERE clinic_id = NEW.clinic_id AND method = NEW.method AND bank_reference = NEW.bank_reference
               AND status IN ('pending_verification','confirmed')) THEN
    RAISE EXCEPTION 'Esa referencia bancaria ya fue registrada en otro pago' USING ERRCODE = 'unique_violation', CONSTRAINT = 'payments_bankref_uq';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payments_bankref_cross BEFORE INSERT ON payments FOR EACH ROW EXECUTE FUNCTION bank_reference_cross_check();
CREATE TRIGGER payer_payments_bankref_cross BEFORE INSERT ON payer_payments FOR EACH ROW EXECUTE FUNCTION bank_reference_cross_check();

-- Aplicación del pago de la empresa a sus cargos (solo inserción).
CREATE TABLE payer_payment_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  payment_id    uuid NOT NULL,
  charge_id     uuid NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (payment_id, charge_id),
  FOREIGN KEY (payment_id, clinic_id) REFERENCES payer_payments(id, clinic_id),
  FOREIGN KEY (charge_id, clinic_id) REFERENCES charges(id, clinic_id)
);
CREATE INDEX payer_alloc_charge_idx ON payer_payment_allocations (clinic_id, charge_id);
CREATE TRIGGER payer_payment_allocations_immutable BEFORE UPDATE OR DELETE ON payer_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- El cargo debe ser de ese convenio (y no una anulación); lo aplicado no supera la porción viva del cargo.
CREATE OR REPLACE FUNCTION payer_allocation_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE ag uuid; ch record; outstanding bigint; applied bigint;
BEGIN
  SELECT agreement_id INTO ag FROM payer_payments WHERE id = NEW.payment_id AND clinic_id = NEW.clinic_id;
  SELECT payer_agreement_id, third_party_cents, voids_charge_id INTO ch FROM charges WHERE id = NEW.charge_id AND clinic_id = NEW.clinic_id;
  IF ch.voids_charge_id IS NOT NULL OR ch.payer_agreement_id IS DISTINCT FROM ag THEN
    RAISE EXCEPTION 'El cargo no corresponde a ese convenio' USING ERRCODE = 'check_violation';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('payalloc:' || NEW.charge_id, 0));
  outstanding := ch.third_party_cents + COALESCE((SELECT sum(third_party_cents) FROM charges WHERE voids_charge_id = NEW.charge_id), 0);
  SELECT COALESCE(sum(a.amount_cents), 0) INTO applied FROM payer_payment_allocations a JOIN payer_payments p ON p.id = a.payment_id
   WHERE a.charge_id = NEW.charge_id AND p.status IN ('pending_verification','confirmed');
  IF applied + NEW.amount_cents > outstanding THEN
    RAISE EXCEPTION 'El monto aplicado supera lo pendiente del cargo' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER payer_allocation_check BEFORE INSERT ON payer_payment_allocations FOR EACH ROW EXECUTE FUNCTION payer_allocation_check();

-- Estados de cuenta emitidos a la empresa (cada PDF emitido queda registrado).
CREATE TABLE payer_statements (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  number        bigint NOT NULL CHECK (number > 0),
  agreement_id  uuid NOT NULL,
  period_from   date NOT NULL,
  period_to     date NOT NULL,
  closing_cents bigint NOT NULL,
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, number),
  CHECK (period_to >= period_from),
  FOREIGN KEY (agreement_id, clinic_id) REFERENCES agreements(id, clinic_id)
);
CREATE TRIGGER payer_statements_immutable BEFORE UPDATE OR DELETE ON payer_statements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

ALTER TABLE pdf_documents DROP CONSTRAINT pdf_documents_kind_check;
ALTER TABLE pdf_documents ADD CONSTRAINT pdf_documents_kind_check
  CHECK (kind IN ('prescription','certificate','referral','budget','consent','receipt','payer_statement'));

-- ---------------- Pendiente de facturar (preparado para SIAT; no es factura fiscal) ----------------
CREATE TABLE invoice_requests (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  number          bigint NOT NULL CHECK (number > 0),
  branch_id       uuid NOT NULL,
  patient_id      uuid NOT NULL,
  budget_id       uuid NOT NULL,
  bill_to         text NOT NULL CHECK (bill_to IN ('patient','agreement','other')),
  agreement_id    uuid,
  buyer_doc_type  text NOT NULL CHECK (buyer_doc_type IN ('NIT','CI','CEX','PAS','OD')),
  buyer_tax_id    text NOT NULL CHECK (buyer_tax_id ~ '^[0-9A-Za-z-]{1,20}$'),
  buyer_name      text NOT NULL CHECK (length(buyer_name) BETWEEN 2 AND 160),       -- razón social
  buyer_email     text CHECK (buyer_email IS NULL OR length(buyer_email) <= 160),
  total_cents     bigint NOT NULL CHECK (total_cents > 0),
  status          text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cancelled')),   -- 'emitida' la agregará el proveedor SIAT
  notes           text CHECK (notes IS NULL OR length(notes) <= 500),
  cancel_reason   text CHECK (cancel_reason IS NULL OR length(cancel_reason) BETWEEN 3 AND 300),
  cancelled_by    uuid REFERENCES users(id),
  cancelled_at    timestamptz,
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, number),
  CHECK ((bill_to = 'agreement') = (agreement_id IS NOT NULL)),
  CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL AND cancelled_by IS NOT NULL)),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (budget_id, clinic_id) REFERENCES budgets(id, clinic_id),
  FOREIGN KEY (agreement_id, clinic_id) REFERENCES agreements(id, clinic_id)
);
CREATE INDEX invoice_requests_status_idx ON invoice_requests (clinic_id, status, created_at);
CREATE INDEX invoice_requests_budget_idx ON invoice_requests (clinic_id, budget_id);

CREATE OR REPLACE FUNCTION invoice_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las solicitudes de factura no se eliminan; se anulan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['status','cancel_reason','cancelled_by','cancelled_at']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status','cancel_reason','cancelled_by','cancelled_at'])
     OR NOT (OLD.status = 'pending' AND NEW.status = 'cancelled') THEN
    RAISE EXCEPTION 'Una solicitud de factura solo puede anularse mientras está pendiente' USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_requests_guard BEFORE UPDATE OR DELETE ON invoice_requests FOR EACH ROW EXECUTE FUNCTION invoice_requests_guard();

CREATE TABLE invoice_request_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  request_id      uuid NOT NULL,
  budget_item_id  uuid NOT NULL,
  session_id      uuid,
  description     text NOT NULL CHECK (length(description) BETWEEN 1 AND 300),
  amount_cents    bigint NOT NULL CHECK (amount_cents > 0),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (request_id, clinic_id) REFERENCES invoice_requests(id, clinic_id),
  FOREIGN KEY (budget_item_id, clinic_id) REFERENCES budget_items(id, clinic_id),
  FOREIGN KEY (session_id, clinic_id) REFERENCES budget_item_sessions(id, clinic_id)
);
CREATE INDEX invoice_request_lines_item_idx ON invoice_request_lines (clinic_id, budget_item_id);
CREATE TRIGGER invoice_request_lines_immutable BEFORE UPDATE OR DELETE ON invoice_request_lines
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Defensa en la base: lo marcado (sin anular) de una línea o sesión nunca supera su importe.
CREATE OR REPLACE FUNCTION invoice_lines_limit() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE net bigint; done bigint; sess bigint;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('invline:' || NEW.budget_item_id, 0));
  SELECT net_cents INTO net FROM budget_items WHERE id = NEW.budget_item_id AND clinic_id = NEW.clinic_id AND status <> 'cancelled';
  IF net IS NULL THEN
    RAISE EXCEPTION 'La línea del presupuesto no existe o está anulada' USING ERRCODE = 'check_violation';
  END IF;
  SELECT COALESCE(sum(l.amount_cents), 0) INTO done FROM invoice_request_lines l JOIN invoice_requests r ON r.id = l.request_id
   WHERE l.budget_item_id = NEW.budget_item_id AND r.status = 'pending';
  IF done + NEW.amount_cents > net THEN
    RAISE EXCEPTION 'No se puede marcar para facturar más de lo pendiente de la línea' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW.session_id IS NOT NULL THEN
    SELECT amount_cents INTO sess FROM budget_item_sessions WHERE id = NEW.session_id AND budget_item_id = NEW.budget_item_id;
    IF sess IS NULL THEN
      RAISE EXCEPTION 'La sesión no pertenece a esa línea' USING ERRCODE = 'check_violation';
    END IF;
    SELECT COALESCE(sum(l.amount_cents), 0) INTO done FROM invoice_request_lines l JOIN invoice_requests r ON r.id = l.request_id
     WHERE l.session_id = NEW.session_id AND r.status = 'pending';
    IF done + NEW.amount_cents > sess THEN
      RAISE EXCEPTION 'No se puede marcar para facturar más de lo pendiente de la sesión' USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER invoice_lines_limit BEFORE INSERT ON invoice_request_lines FOR EACH ROW EXECUTE FUNCTION invoice_lines_limit();

-- ---------------- Conciliación bancaria por extracto (B-021) ----------------
CREATE TABLE bank_statements (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id      uuid NOT NULL REFERENCES clinics(id),
  account_label  text NOT NULL CHECK (length(account_label) BETWEEN 2 AND 80),
  file_name      text NOT NULL CHECK (length(file_name) BETWEEN 1 AND 200),
  file_sha256    text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  mapping        jsonb NOT NULL CHECK (jsonb_typeof(mapping) = 'object'),
  total_rows     int NOT NULL CHECK (total_rows >= 0),
  imported_rows  int NOT NULL CHECK (imported_rows >= 0),
  duplicate_rows int NOT NULL CHECK (duplicate_rows >= 0),
  skipped_rows   int NOT NULL CHECK (skipped_rows >= 0),
  uploaded_by    uuid NOT NULL REFERENCES users(id),
  uploaded_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id)
);
CREATE TRIGGER bank_statements_immutable BEFORE UPDATE OR DELETE ON bank_statements
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE bank_statement_lines (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  statement_id     uuid NOT NULL,
  row_number       int NOT NULL CHECK (row_number > 0),
  line_hash        text NOT NULL CHECK (line_hash ~ '^[0-9a-f]{64}$'),
  txn_date         date NOT NULL,
  description      text CHECK (description IS NULL OR length(description) <= 300),
  reference        text CHECK (reference IS NULL OR length(reference) <= 80),
  amount_cents     bigint NOT NULL CHECK (amount_cents > 0),             -- solo abonos (ingresos)
  status           text NOT NULL DEFAULT 'unmatched' CHECK (status IN ('unmatched','matched','ignored')),
  payment_id       uuid,
  payer_payment_id uuid,
  match_kind       text CHECK (match_kind IS NULL OR match_kind IN ('exact','suggested','manual','already_verified')),
  resolved_by      uuid REFERENCES users(id),
  resolved_at      timestamptz,
  note             text CHECK (note IS NULL OR length(note) <= 300),
  UNIQUE (id, clinic_id),
  CONSTRAINT bank_lines_hash_uq UNIQUE (clinic_id, line_hash),
  CHECK ((status = 'matched') = (num_nonnulls(payment_id, payer_payment_id) = 1)),
  CHECK ((status = 'matched') = (match_kind IS NOT NULL)),
  CHECK (status = 'unmatched' OR (resolved_by IS NOT NULL AND resolved_at IS NOT NULL)),
  CHECK (status <> 'ignored' OR note IS NOT NULL),
  FOREIGN KEY (statement_id, clinic_id) REFERENCES bank_statements(id, clinic_id),
  FOREIGN KEY (payment_id, clinic_id) REFERENCES payments(id, clinic_id),
  FOREIGN KEY (payer_payment_id, clinic_id) REFERENCES payer_payments(id, clinic_id)
);
-- Un pago se concilia con un solo movimiento.
CREATE UNIQUE INDEX bank_lines_payment_once ON bank_statement_lines (payment_id) WHERE payment_id IS NOT NULL;
CREATE UNIQUE INDEX bank_lines_payer_payment_once ON bank_statement_lines (payer_payment_id) WHERE payer_payment_id IS NOT NULL;
CREATE INDEX bank_lines_status_idx ON bank_statement_lines (clinic_id, status, txn_date);

-- Los datos del movimiento no cambian; solo se resuelve una vez (sin emparejar → conciliado o ignorado).
CREATE OR REPLACE FUNCTION bank_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Los movimientos del extracto no se eliminan' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.statement_id, NEW.clinic_id, NEW.line_hash, NEW.txn_date, NEW.description, NEW.reference, NEW.amount_cents, NEW.row_number)
     IS DISTINCT FROM (OLD.statement_id, OLD.clinic_id, OLD.line_hash, OLD.txn_date, OLD.description, OLD.reference, OLD.amount_cents, OLD.row_number) THEN
    RAISE EXCEPTION 'Los datos de un movimiento del extracto no se modifican' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status <> 'unmatched' OR NEW.status = 'unmatched' THEN
    RAISE EXCEPTION 'Ese movimiento ya fue conciliado o descartado' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER bank_lines_guard BEFORE UPDATE OR DELETE ON bank_statement_lines FOR EACH ROW EXECUTE FUNCTION bank_lines_guard();

-- ---------------- RLS y privilegios ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['agreements','agreement_rules','patient_agreements','payer_payments','payer_payment_allocations',
                           'payer_statements','invoice_requests','invoice_request_lines','bank_statements','bank_statement_lines'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON agreements, patient_agreements, payer_payments, payer_payment_allocations, payer_statements,
  invoice_requests, invoice_request_lines, bank_statements, bank_statement_lines TO dental_app;
GRANT UPDATE (name, kind, tax_id, billing_name, contact_name, contact_phone, contact_email, valid_from, valid_to, default_discount_percent,
  company_share_percent, company_cap_cents, payment_terms_days, notes, active, updated_at) ON agreements TO dental_app;
GRANT SELECT, INSERT, DELETE ON agreement_rules TO dental_app;
GRANT UPDATE (valid_to, ended_at, ended_by, end_reason) ON patient_agreements TO dental_app;
GRANT UPDATE (status, verified_by, verified_at, status_reason) ON payer_payments TO dental_app;
GRANT UPDATE (status, cancel_reason, cancelled_by, cancelled_at) ON invoice_requests TO dental_app;
GRANT UPDATE (status, payment_id, payer_payment_id, match_kind, resolved_by, resolved_at, note) ON bank_statement_lines TO dental_app;
