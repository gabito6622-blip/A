-- =====================================================================
-- 0033 — B-111: costo adicional de un trabajo de laboratorio reenviado o repetido.
--
--  * El costo de la primera recepción sigue fijo. Lo que el laboratorio cobra de más por un reenvío
--    (0 si lo rehace sin cargo) es un movimiento aparte, con su fecha y su motivo: así no se reescriben
--    meses ya cerrados (estado de cuenta, rentabilidad, honorarios).
--  * Solo inserción. Un error se corrige con un movimiento negativo con motivo; el total adicional de
--    una orden nunca queda negativo.
--  * Quién absorbe el costo frente al paciente no lo decide el sistema: aquí solo se registra lo que la
--    clínica le debe al laboratorio.
-- =====================================================================

CREATE TABLE lab_order_extra_costs (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id    uuid NOT NULL REFERENCES clinics(id),
  order_id     uuid NOT NULL,
  amount_cents bigint NOT NULL CHECK (amount_cents <> 0 AND amount_cents BETWEEN -100000000 AND 100000000),
  charged_on   date NOT NULL,
  reason       text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  created_by   uuid NOT NULL REFERENCES users(id),
  created_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (order_id, clinic_id) REFERENCES lab_orders(id, clinic_id)
);
CREATE INDEX lab_order_extra_costs_order_idx ON lab_order_extra_costs (clinic_id, order_id);
CREATE INDEX lab_order_extra_costs_date_idx ON lab_order_extra_costs (clinic_id, charged_on);
CREATE TRIGGER lab_order_extra_costs_immutable BEFORE UPDATE OR DELETE ON lab_order_extra_costs
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Solo órdenes ya recibidas; el total adicional no queda negativo ni por debajo de lo ya pagado.
CREATE OR REPLACE FUNCTION lab_order_extra_costs_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record; extra bigint; paid bigint;
BEGIN
  SELECT status, cost_cents INTO o FROM lab_orders WHERE id = NEW.order_id AND clinic_id = NEW.clinic_id FOR UPDATE;
  IF o.status IS NULL OR o.status NOT IN ('received','adjustment','delivered') THEN
    RAISE EXCEPTION 'Solo se registra un costo adicional en órdenes ya recibidas' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(amount_cents), 0) INTO extra FROM lab_order_extra_costs WHERE order_id = NEW.order_id AND clinic_id = NEW.clinic_id;
  IF extra + NEW.amount_cents < 0 THEN
    RAISE EXCEPTION 'La corrección deja el costo adicional en negativo' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(x.amount_cents), 0) INTO paid FROM lab_payment_allocations x
   WHERE x.order_id = NEW.order_id AND x.clinic_id = NEW.clinic_id
     AND NOT EXISTS (SELECT 1 FROM lab_payment_voids v WHERE v.payment_id = x.payment_id);
  IF o.cost_cents + extra + NEW.amount_cents < paid THEN
    RAISE EXCEPTION 'La corrección deja el costo por debajo de lo ya pagado: anula antes el pago' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER lab_order_extra_costs_check BEFORE INSERT ON lab_order_extra_costs
  FOR EACH ROW EXECUTE FUNCTION lab_order_extra_costs_check();

ALTER TABLE lab_order_extra_costs ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lab_order_extra_costs USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
GRANT SELECT, INSERT ON lab_order_extra_costs TO dental_app;

-- El tope de pago por orden incluye el costo adicional.
CREATE OR REPLACE FUNCTION lab_payment_allocations_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record; paid bigint; extra bigint; plab uuid;
BEGIN
  SELECT status, cost_cents, lab_id INTO o FROM lab_orders WHERE id = NEW.order_id AND clinic_id = NEW.clinic_id FOR UPDATE;
  SELECT lab_id INTO plab FROM lab_payments WHERE id = NEW.payment_id AND clinic_id = NEW.clinic_id;
  IF o.status IS NULL OR o.status NOT IN ('received','adjustment','delivered') THEN
    RAISE EXCEPTION 'Solo se pagan órdenes ya recibidas' USING ERRCODE = 'check_violation';
  END IF;
  IF o.lab_id IS DISTINCT FROM plab THEN
    RAISE EXCEPTION 'La orden es de otro laboratorio' USING ERRCODE = 'check_violation';
  END IF;
  SELECT coalesce(sum(x.amount_cents), 0) INTO paid FROM lab_payment_allocations x
   WHERE x.order_id = NEW.order_id AND x.clinic_id = NEW.clinic_id
     AND NOT EXISTS (SELECT 1 FROM lab_payment_voids v WHERE v.payment_id = x.payment_id);
  SELECT coalesce(sum(amount_cents), 0) INTO extra FROM lab_order_extra_costs WHERE order_id = NEW.order_id AND clinic_id = NEW.clinic_id;
  IF paid + NEW.amount_cents > o.cost_cents + extra THEN
    RAISE EXCEPTION 'El pago excede el saldo pendiente de la orden' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
