-- =====================================================================
-- 0011 — Laboratorio protésico (B-063, R2-34) y costo real de laboratorio
--        en la liquidación de honorarios.
--
--  * labs: catálogo de laboratorios de la clínica (contacto, WhatsApp,
--    lista de precios opcional por tipo de trabajo).
--  * lab_orders: órdenes por paciente, profesional y sucursal, vinculables
--    a un ítem de presupuesto. Estados:
--      borrador → enviado → en proceso → recibido → (ajuste ↔ recibido)
--      → entregado; cancelado desde borrador/enviado/en proceso.
--    El costo se edita hasta la recepción y queda fijo desde entonces
--    (trigger, también para el dueño de la base).
--  * lab_order_events: cada cambio de estado (solo inserción).
--  * lab_payments + lab_payment_allocations: pagos al laboratorio, de solo
--    inserción, imputados a órdenes recibidas sin exceder su costo.
--  * fee_rules.deduct_actual_lab_cost y fee_settlement_lines.lab_actual_cents:
--    opción de descontar el costo real de las órdenes vinculadas al ítem.
-- =====================================================================

CREATE TABLE labs (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  name          text NOT NULL CHECK (length(btrim(name)) BETWEEN 2 AND 120),
  contact_name  text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  phone         text CHECK (phone IS NULL OR length(phone) <= 30),
  whatsapp      text CHECK (whatsapp IS NULL OR length(whatsapp) <= 30),
  email         text CHECK (email IS NULL OR length(email) <= 160),
  address       text CHECK (address IS NULL OR length(address) <= 300),
  notes         text CHECK (notes IS NULL OR length(notes) <= 1000),
  -- Lista de precios opcional: {"crown": 45000, "bridge": 40000, ...} (centavos por unidad)
  price_list    jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(price_list) = 'object'),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, name)
);

CREATE OR REPLACE FUNCTION lab_valid_teeth(t smallint[]) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT coalesce(bool_and((x / 10 BETWEEN 1 AND 4 AND x % 10 BETWEEN 1 AND 8) OR (x / 10 BETWEEN 5 AND 8 AND x % 10 BETWEEN 1 AND 5)), true)
    FROM unnest(t) AS x
$$;

CREATE TABLE lab_orders (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  number          bigint NOT NULL,                       -- correlativo por clínica
  lab_id          uuid NOT NULL,
  patient_id      uuid NOT NULL,
  budget_item_id  uuid,
  dentist_id      uuid NOT NULL,
  branch_id       uuid NOT NULL,
  work_type       text NOT NULL CHECK (work_type IN ('crown','bridge','removable','splint','veneer','inlay','model','other')),
  work_detail     text CHECK (work_detail IS NULL OR length(work_detail) <= 200),
  teeth           smallint[] NOT NULL DEFAULT '{}' CHECK (cardinality(teeth) <= 32 AND lab_valid_teeth(teeth)),
  material        text CHECK (material IS NULL OR length(material) <= 120),
  shade           text CHECK (shade IS NULL OR shade IN ('A1','A2','A3','A3.5','A4','B1','B2','B3','B4','C1','C2','C3','C4','D2','D3','D4')),
  shade_note      text CHECK (shade_note IS NULL OR length(shade_note) <= 120),
  impression      text CHECK (impression IS NULL OR impression IN ('physical','digital')),
  instructions    text CHECK (instructions IS NULL OR length(instructions) <= 2000),
  attachment_url  text CHECK (attachment_url IS NULL OR length(attachment_url) <= 500),
  status          text NOT NULL DEFAULT 'draft'
                  CHECK (status IN ('draft','sent','in_process','received','adjustment','delivered','cancelled')),
  sent_on         date,
  promised_on     date,
  received_on     date,
  delivered_on    date,
  cost_cents      bigint CHECK (cost_cents IS NULL OR cost_cents BETWEEN 0 AND 100000000),
  created_by      uuid NOT NULL REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, number),
  FOREIGN KEY (lab_id, clinic_id)         REFERENCES labs(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id)     REFERENCES patients(id, clinic_id),
  FOREIGN KEY (budget_item_id, clinic_id) REFERENCES budget_items(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id)      REFERENCES branches(id, clinic_id),
  FOREIGN KEY (clinic_id, dentist_id)     REFERENCES memberships(clinic_id, user_id),
  CHECK (status = 'draft' OR status = 'cancelled' OR sent_on IS NOT NULL),
  CHECK (status NOT IN ('received','adjustment','delivered') OR (received_on IS NOT NULL AND cost_cents IS NOT NULL)),
  CHECK (status <> 'delivered' OR delivered_on IS NOT NULL),
  CHECK (promised_on IS NULL OR sent_on IS NULL OR promised_on >= sent_on),
  CHECK (received_on IS NULL OR sent_on IS NULL OR received_on >= sent_on),
  CHECK (delivered_on IS NULL OR received_on IS NULL OR delivered_on >= received_on)
);
CREATE INDEX lab_orders_status_idx ON lab_orders (clinic_id, status, promised_on);
CREATE INDEX lab_orders_patient_idx ON lab_orders (clinic_id, patient_id);
CREATE INDEX lab_orders_lab_idx ON lab_orders (clinic_id, lab_id, received_on);
CREATE INDEX lab_orders_item_idx ON lab_orders (budget_item_id) WHERE budget_item_id IS NOT NULL;

-- Guarda de la orden: transiciones válidas, costo fijo desde la recepción,
-- datos de identidad inmutables y órdenes cerradas sin cambios. Sin DELETE.
CREATE OR REPLACE FUNCTION lab_orders_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'Las órdenes de laboratorio no se eliminan (se cancelan)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF (NEW.clinic_id, NEW.number, NEW.patient_id, NEW.created_by, NEW.created_at)
     IS DISTINCT FROM (OLD.clinic_id, OLD.number, OLD.patient_id, OLD.created_by, OLD.created_at) THEN
    RAISE EXCEPTION 'El paciente y el número de una orden no se modifican' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('delivered','cancelled') THEN
    RAISE EXCEPTION 'La orden está cerrada (entregada o cancelada) y no se modifica' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF OLD.status IN ('received','adjustment') AND NEW.cost_cents IS DISTINCT FROM OLD.cost_cents THEN
    RAISE EXCEPTION 'El costo de la orden quedó fijo al recibir el trabajo' USING ERRCODE = 'insufficient_privilege';
  END IF;
  -- La primera recepción fija el laboratorio y la fecha que cuentan para el pago (las de un reenvío quedan en los eventos).
  IF OLD.received_on IS NOT NULL
     AND (NEW.lab_id, NEW.received_on) IS DISTINCT FROM (OLD.lab_id, OLD.received_on) THEN
    RAISE EXCEPTION 'El laboratorio y la fecha de recepción no se modifican después de recibir' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF NEW.status <> OLD.status AND NOT (
       (OLD.status = 'draft'      AND NEW.status IN ('sent','cancelled')) OR
       (OLD.status = 'sent'       AND NEW.status IN ('in_process','received','cancelled')) OR
       (OLD.status = 'in_process' AND NEW.status IN ('received','cancelled')) OR
       (OLD.status = 'received'   AND NEW.status IN ('adjustment','delivered')) OR
       (OLD.status = 'adjustment' AND NEW.status IN ('received'))
     ) THEN
    RAISE EXCEPTION 'Cambio de estado no permitido: % → %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_orders_guard BEFORE UPDATE OR DELETE ON lab_orders FOR EACH ROW EXECUTE FUNCTION lab_orders_guard();

-- Historial de estados (solo inserción).
CREATE TABLE lab_order_events (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  order_id      uuid NOT NULL,
  from_status   text,
  to_status     text NOT NULL,
  reason        text CHECK (reason IS NULL OR length(reason) <= 500),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (order_id, clinic_id) REFERENCES lab_orders(id, clinic_id),
  CHECK (to_status NOT IN ('adjustment','cancelled') OR length(btrim(coalesce(reason, ''))) >= 3)
);
CREATE INDEX lab_order_events_order_idx ON lab_order_events (clinic_id, order_id, created_at);
CREATE TRIGGER lab_order_events_immutable BEFORE UPDATE OR DELETE ON lab_order_events
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Pagos al laboratorio (solo inserción).
CREATE TABLE lab_payments (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  lab_id        uuid NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  paid_on       date NOT NULL,
  method        text NOT NULL CHECK (method IN ('cash','transfer','qr','card','check','other')),
  reference     text CHECK (reference IS NULL OR length(reference) <= 80),
  note          text CHECK (note IS NULL OR length(note) <= 500),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (lab_id, clinic_id) REFERENCES labs(id, clinic_id),
  CHECK (method = 'cash' OR reference IS NOT NULL)
);
-- La misma transferencia o cheque no se registra dos veces para el mismo laboratorio.
CREATE UNIQUE INDEX lab_payments_reference_uq ON lab_payments (clinic_id, lab_id, method, reference) WHERE reference IS NOT NULL;
CREATE INDEX lab_payments_lab_idx ON lab_payments (clinic_id, lab_id, paid_on);
CREATE TRIGGER lab_payments_immutable BEFORE UPDATE OR DELETE ON lab_payments
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

CREATE TABLE lab_payment_allocations (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  payment_id    uuid NOT NULL,
  order_id      uuid NOT NULL,
  amount_cents  bigint NOT NULL CHECK (amount_cents > 0),
  UNIQUE (id, clinic_id),
  UNIQUE (payment_id, order_id),
  FOREIGN KEY (payment_id, clinic_id) REFERENCES lab_payments(id, clinic_id),
  FOREIGN KEY (order_id, clinic_id) REFERENCES lab_orders(id, clinic_id)
);
CREATE INDEX lab_payment_alloc_order_idx ON lab_payment_allocations (clinic_id, order_id);
CREATE TRIGGER lab_payment_allocations_immutable BEFORE UPDATE OR DELETE ON lab_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Solo se paga lo recibido, al laboratorio de la orden y sin exceder su costo
-- (bloquea la orden para evitar dos pagos simultáneos).
CREATE OR REPLACE FUNCTION lab_payment_allocations_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record; paid bigint; plab uuid;
BEGIN
  SELECT status, cost_cents, lab_id INTO o FROM lab_orders WHERE id = NEW.order_id AND clinic_id = NEW.clinic_id FOR UPDATE;
  SELECT lab_id INTO plab FROM lab_payments WHERE id = NEW.payment_id AND clinic_id = NEW.clinic_id;
  IF o.status IS NULL OR o.status NOT IN ('received','adjustment','delivered') THEN
    RAISE EXCEPTION 'Solo se pagan órdenes ya recibidas' USING ERRCODE = 'check_violation';
  END IF;
  IF o.lab_id IS DISTINCT FROM plab THEN
    RAISE EXCEPTION 'La orden es de otro laboratorio' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO paid FROM lab_payment_allocations WHERE order_id = NEW.order_id AND clinic_id = NEW.clinic_id;
  IF paid + NEW.amount_cents > o.cost_cents THEN
    RAISE EXCEPTION 'El pago excede el saldo pendiente de la orden' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_payment_allocations_check BEFORE INSERT ON lab_payment_allocations
  FOR EACH ROW EXECUTE FUNCTION lab_payment_allocations_check();

-- Honorarios: descontar el costo real de laboratorio de las órdenes vinculadas al ítem.
ALTER TABLE fee_rules ADD COLUMN deduct_actual_lab_cost boolean NOT NULL DEFAULT false;
ALTER TABLE fee_rules ADD CONSTRAINT fee_rules_actual_lab_percent CHECK (NOT deduct_actual_lab_cost OR mode = 'percent');
-- Parte del descuento de la línea que corresponde al costo real (NULL = se usó el monto fijo por unidad).
ALTER TABLE fee_settlement_lines ADD COLUMN lab_actual_cents bigint;
ALTER TABLE fee_settlement_lines ADD CONSTRAINT fee_lines_lab_actual CHECK (lab_actual_cents IS NULL OR (lab_actual_cents >= 0 AND lab_actual_cents = deduct_cents));

-- ---------------------------------------------------------------------
-- Row Level Security y privilegios
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['labs','lab_orders','lab_order_events','lab_payments','lab_payment_allocations'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON labs, lab_orders, lab_order_events, lab_payments, lab_payment_allocations TO dental_app;
GRANT UPDATE (name, contact_name, phone, whatsapp, email, address, notes, price_list, active) ON labs TO dental_app;
GRANT UPDATE (lab_id, budget_item_id, dentist_id, branch_id, work_type, work_detail, teeth, material, shade, shade_note, impression, instructions,
              attachment_url, status, sent_on, promised_on, received_on, delivered_on, cost_cents, updated_at) ON lab_orders TO dental_app;
