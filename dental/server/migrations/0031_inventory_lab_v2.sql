-- =====================================================================
-- 0031 — B-072 / B-073: inventario y laboratorio.
--
--  * Transferencia en tránsito anulada: vuelve todo al lote de origen (movimiento transfer_in en la
--    sucursal de origen con la misma transferencia), con motivo, quién y cuándo. Una recibida no se
--    anula.
--  * Pago a laboratorio anulado: registro de solo inserción con motivo (el pago y sus aplicaciones
--    se conservan); la deuda con el laboratorio vuelve a quedar abierta.
-- =====================================================================

ALTER TABLE inv_transfers DROP CONSTRAINT inv_transfers_status_check;
ALTER TABLE inv_transfers ADD CONSTRAINT inv_transfers_status_check CHECK (status IN ('in_transit','received','cancelled'));
ALTER TABLE inv_transfers
  ADD COLUMN cancelled_by  uuid REFERENCES users(id),
  ADD COLUMN cancelled_at  timestamptz,
  ADD COLUMN cancel_reason text CHECK (cancel_reason IS NULL OR length(btrim(cancel_reason)) BETWEEN 3 AND 300),
  ADD CONSTRAINT inv_transfers_cancel_ck CHECK ((status = 'cancelled') = (cancelled_at IS NOT NULL AND cancel_reason IS NOT NULL));
GRANT UPDATE (cancelled_by, cancelled_at, cancel_reason) ON inv_transfers TO dental_app;

-- ---------------- Pagos a laboratorio anulados ----------------
CREATE TABLE lab_payment_voids (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id   uuid NOT NULL REFERENCES clinics(id),
  payment_id  uuid NOT NULL,
  reason      text NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 300),
  created_by  uuid NOT NULL REFERENCES users(id),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CONSTRAINT lab_payment_voids_once UNIQUE (payment_id),
  FOREIGN KEY (payment_id, clinic_id) REFERENCES lab_payments(id, clinic_id)
);
CREATE TRIGGER lab_payment_voids_immutable BEFORE UPDATE OR DELETE ON lab_payment_voids
  FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
ALTER TABLE lab_payment_voids ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON lab_payment_voids USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
GRANT SELECT, INSERT ON lab_payment_voids TO dental_app;

-- El tope «no pagar más que el costo de la orden» ya no cuenta los pagos anulados.
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
  SELECT coalesce(sum(x.amount_cents), 0) INTO paid FROM lab_payment_allocations x
   WHERE x.order_id = NEW.order_id AND x.clinic_id = NEW.clinic_id
     AND NOT EXISTS (SELECT 1 FROM lab_payment_voids v WHERE v.payment_id = x.payment_id);
  IF paid + NEW.amount_cents > o.cost_cents THEN
    RAISE EXCEPTION 'El pago excede el saldo pendiente de la orden' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
