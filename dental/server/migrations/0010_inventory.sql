-- =====================================================================
-- 0010 — Inventario por sucursal y compras (B-062 / B-047 / B-024; IN-01 a IN-09)
--
-- INVARIANTE (IN-01): el stock de un insumo en una sucursal es SIEMPRE la suma
-- de sus lotes, y el saldo de cada lote es SIEMPRE la suma de sus movimientos.
--  * La única forma de cambiar un saldo es insertar un movimiento (solo inserción).
--  * Un trigger SECURITY DEFINER aplica el movimiento al lote y al stock en la
--    misma transacción. El rol dental_app NO puede escribir los saldos.
--  * CHECK qty_on_hand >= 0 en lotes y stock: nunca hay saldos negativos.
--  * Los insumos sin lotes usan un único lote implícito (lot_code NULL).
-- Cantidades en la UNIDAD DE USO (numeric, hasta 3 decimales). Costos unitarios
-- en centavos por unidad de uso (numeric con 4 decimales: una caja de 100 a 3,50 Bs
-- da 3,5 centavos por unidad). Totales de dinero siempre en centavos enteros.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------
CREATE TABLE inv_suppliers (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  name          text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  tax_id        text CHECK (tax_id IS NULL OR length(tax_id) <= 30),
  contact_name  text CHECK (contact_name IS NULL OR length(contact_name) <= 120),
  phone         text CHECK (phone IS NULL OR length(phone) <= 40),
  email         text CHECK (email IS NULL OR length(email) <= 160),
  address       text CHECK (address IS NULL OR length(address) <= 300),
  payment_terms text CHECK (payment_terms IS NULL OR length(payment_terms) <= 200),
  notes         text CHECK (notes IS NULL OR length(notes) <= 500),
  active        boolean NOT NULL DEFAULT true,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id)
);
CREATE UNIQUE INDEX inv_suppliers_name_uq ON inv_suppliers (clinic_id, lower(name));

-- ---------------------------------------------------------------------
-- Catálogo de insumos (único para toda la clínica; SKU único por clínica)
-- ---------------------------------------------------------------------
CREATE TABLE inv_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  sku             text NOT NULL CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]{0,39}$'),
  name            text NOT NULL CHECK (length(name) BETWEEN 2 AND 120),
  category        text NOT NULL DEFAULT 'General' CHECK (length(category) BETWEEN 1 AND 60),
  use_unit        text NOT NULL CHECK (length(use_unit) BETWEEN 1 AND 30),       -- «unidad», «cartucho», «ml»
  purchase_unit   text NOT NULL CHECK (length(purchase_unit) BETWEEN 1 AND 40),  -- «caja de 100»
  purchase_factor numeric(12,3) NOT NULL DEFAULT 1 CHECK (purchase_factor > 0),  -- unidades de uso por unidad de compra
  tracks_lots     boolean NOT NULL DEFAULT false,                                 -- lotes con vencimiento sí/no
  preferred_supplier_id uuid,
  active          boolean NOT NULL DEFAULT true,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (preferred_supplier_id, clinic_id) REFERENCES inv_suppliers(id, clinic_id)
);
-- SKU único por clínica (se guarda en mayúsculas; el CHECK lo exige)
CREATE UNIQUE INDEX inv_items_sku_uq ON inv_items (clinic_id, sku);

-- ---------------------------------------------------------------------
-- Stock por sucursal (saldo + mínimo). El saldo lo mantiene SOLO el trigger.
-- ---------------------------------------------------------------------
CREATE TABLE inv_stock (
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  item_id       uuid NOT NULL,
  branch_id     uuid NOT NULL,
  qty_on_hand   numeric(14,3) NOT NULL DEFAULT 0 CONSTRAINT inv_stock_not_negative CHECK (qty_on_hand >= 0),
  min_qty       numeric(14,3) NOT NULL DEFAULT 0 CHECK (min_qty >= 0),
  PRIMARY KEY (item_id, branch_id),
  FOREIGN KEY (item_id, clinic_id) REFERENCES inv_items(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE INDEX inv_stock_branch_idx ON inv_stock (clinic_id, branch_id);

-- ---------------------------------------------------------------------
-- Lotes por sucursal
-- ---------------------------------------------------------------------
CREATE TABLE inv_lots (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  item_id       uuid NOT NULL,
  branch_id     uuid NOT NULL,
  lot_code      text CHECK (lot_code IS NULL OR length(lot_code) BETWEEN 1 AND 60),  -- NULL = lote implícito
  expires_on    date,
  supplier_id   uuid,
  qty_on_hand   numeric(14,3) NOT NULL DEFAULT 0 CONSTRAINT inv_lots_not_negative CHECK (qty_on_hand >= 0),
  unit_cost     numeric(16,4) NOT NULL DEFAULT 0 CHECK (unit_cost >= 0),          -- centavos por unidad de uso (promedio ponderado del lote)
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  UNIQUE (id, item_id, branch_id, clinic_id),
  CHECK (lot_code IS NOT NULL OR expires_on IS NULL),
  FOREIGN KEY (item_id, clinic_id) REFERENCES inv_items(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (supplier_id, clinic_id) REFERENCES inv_suppliers(id, clinic_id),
  FOREIGN KEY (item_id, branch_id) REFERENCES inv_stock(item_id, branch_id)
);
CREATE UNIQUE INDEX inv_lots_code_uq ON inv_lots (item_id, branch_id, coalesce(lower(lot_code), ''));
CREATE INDEX inv_lots_fefo_idx ON inv_lots (clinic_id, branch_id, item_id, expires_on NULLS LAST, created_at);

-- Un lote nace siempre en cero (el saldo y el costo llegan por movimientos)
CREATE OR REPLACE FUNCTION inv_lot_starts_empty() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW.qty_on_hand := 0;
  NEW.unit_cost := 0;
  RETURN NEW;
END $$;
CREATE TRIGGER inv_lots_starts_empty BEFORE INSERT ON inv_lots FOR EACH ROW EXECUTE FUNCTION inv_lot_starts_empty();

-- ---------------------------------------------------------------------
-- Transferencias entre sucursales (dos pasos: enviada → recibida)
-- ---------------------------------------------------------------------
CREATE TABLE inv_transfers (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  number          bigint NOT NULL,
  from_branch_id  uuid NOT NULL,
  to_branch_id    uuid NOT NULL,
  status          text NOT NULL DEFAULT 'in_transit' CHECK (status IN ('in_transit','received')),
  note            text CHECK (note IS NULL OR length(note) <= 500),
  sent_by         uuid NOT NULL REFERENCES users(id),
  sent_at         timestamptz NOT NULL DEFAULT now(),
  received_by     uuid REFERENCES users(id),
  received_at     timestamptz,
  receive_note    text CHECK (receive_note IS NULL OR length(receive_note) <= 500),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, number),
  CHECK (from_branch_id <> to_branch_id),
  CHECK ((status = 'received') = (received_at IS NOT NULL)),
  FOREIGN KEY (from_branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (to_branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE INDEX inv_transfers_idx ON inv_transfers (clinic_id, status, to_branch_id);

CREATE TABLE inv_transfer_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  transfer_id     uuid NOT NULL,
  item_id         uuid NOT NULL,
  from_lot_id     uuid NOT NULL,
  qty_sent        numeric(14,3) NOT NULL CHECK (qty_sent > 0),
  to_lot_id       uuid,
  qty_received    numeric(14,3) CHECK (qty_received IS NULL OR (qty_received >= 0 AND qty_received <= qty_sent)),
  difference_reason text CHECK (difference_reason IS NULL OR length(difference_reason) <= 300),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (transfer_id, clinic_id) REFERENCES inv_transfers(id, clinic_id),
  FOREIGN KEY (item_id, clinic_id) REFERENCES inv_items(id, clinic_id),
  FOREIGN KEY (from_lot_id, clinic_id) REFERENCES inv_lots(id, clinic_id),
  FOREIGN KEY (to_lot_id, clinic_id) REFERENCES inv_lots(id, clinic_id)
);
CREATE INDEX inv_transfer_lines_idx ON inv_transfer_lines (transfer_id);

-- ---------------------------------------------------------------------
-- Conteo físico por sucursal
-- ---------------------------------------------------------------------
CREATE TABLE inv_counts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  number        bigint NOT NULL,
  branch_id     uuid NOT NULL,
  status        text NOT NULL DEFAULT 'open' CHECK (status IN ('open','approved','cancelled')),
  note          text CHECK (note IS NULL OR length(note) <= 500),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  decided_by    uuid REFERENCES users(id),
  decided_at    timestamptz,
  decided_note  text CHECK (decided_note IS NULL OR length(decided_note) <= 500),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, number),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
-- Una sola hoja abierta por sucursal
CREATE UNIQUE INDEX inv_counts_one_open ON inv_counts (branch_id) WHERE status = 'open';

CREATE TABLE inv_count_lines (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  count_id      uuid NOT NULL,
  item_id       uuid NOT NULL,
  lot_id        uuid NOT NULL,
  expected_qty  numeric(14,3) NOT NULL CHECK (expected_qty >= 0),   -- saldo del sistema al generar la hoja
  counted_qty   numeric(14,3) CHECK (counted_qty IS NULL OR counted_qty >= 0),
  counted_by    uuid REFERENCES users(id),
  counted_at    timestamptz,
  UNIQUE (id, clinic_id),
  UNIQUE (count_id, lot_id),
  FOREIGN KEY (count_id, clinic_id) REFERENCES inv_counts(id, clinic_id),
  FOREIGN KEY (item_id, clinic_id) REFERENCES inv_items(id, clinic_id),
  FOREIGN KEY (lot_id, clinic_id) REFERENCES inv_lots(id, clinic_id)
);

-- Las líneas de una hoja aprobada o anulada quedan congeladas
CREATE OR REPLACE FUNCTION inv_count_line_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (SELECT status FROM inv_counts WHERE id = OLD.count_id) <> 'open' THEN
    RAISE EXCEPTION 'La hoja de conteo ya fue cerrada (registro inmutable)' USING ERRCODE = 'insufficient_privilege';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER inv_count_lines_guard BEFORE UPDATE OR DELETE ON inv_count_lines FOR EACH ROW EXECUTE FUNCTION inv_count_line_guard();

-- ---------------------------------------------------------------------
-- Compras: órdenes, líneas y recepciones
-- ---------------------------------------------------------------------
CREATE TABLE inv_purchase_orders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  number        bigint NOT NULL,
  supplier_id   uuid NOT NULL,
  branch_id     uuid NOT NULL,                  -- sucursal de llegada
  status        text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','sent','partial','received','closed','cancelled')),
  expected_on   date,
  notes         text CHECK (notes IS NULL OR length(notes) <= 500),
  created_by    uuid NOT NULL REFERENCES users(id),
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_by       uuid REFERENCES users(id),
  sent_at       timestamptz,
  closed_by     uuid REFERENCES users(id),
  closed_at     timestamptz,
  close_note    text CHECK (close_note IS NULL OR length(close_note) <= 500),
  UNIQUE (id, clinic_id),
  UNIQUE (clinic_id, number),
  FOREIGN KEY (supplier_id, clinic_id) REFERENCES inv_suppliers(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE INDEX inv_po_idx ON inv_purchase_orders (clinic_id, status, branch_id);

CREATE TABLE inv_po_lines (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id         uuid NOT NULL REFERENCES clinics(id),
  po_id             uuid NOT NULL,
  item_id           uuid NOT NULL,
  qty_ordered       numeric(14,3) NOT NULL CHECK (qty_ordered > 0),            -- en unidades de compra
  unit_price_cents  bigint NOT NULL CHECK (unit_price_cents >= 0),            -- por unidad de compra
  position          int NOT NULL DEFAULT 0,
  UNIQUE (id, clinic_id),
  UNIQUE (po_id, item_id),
  FOREIGN KEY (po_id, clinic_id) REFERENCES inv_purchase_orders(id, clinic_id),
  FOREIGN KEY (item_id, clinic_id) REFERENCES inv_items(id, clinic_id)
);

-- Cada entrega del proveedor (solo inserción)
CREATE TABLE inv_po_receipts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  po_id         uuid NOT NULL,
  document_ref  text CHECK (document_ref IS NULL OR length(document_ref) <= 60),   -- factura o nota de entrega
  note          text CHECK (note IS NULL OR length(note) <= 500),
  received_by   uuid NOT NULL REFERENCES users(id),
  received_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  FOREIGN KEY (po_id, clinic_id) REFERENCES inv_purchase_orders(id, clinic_id)
);

CREATE TABLE inv_po_receipt_lines (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  receipt_id      uuid NOT NULL,
  po_line_id      uuid NOT NULL,
  qty_accepted    numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_accepted >= 0),   -- unidades de compra
  qty_rejected    numeric(14,3) NOT NULL DEFAULT 0 CHECK (qty_rejected >= 0),
  reject_reason   text CHECK (reject_reason IS NULL OR length(reject_reason) BETWEEN 3 AND 300),
  lot_id          uuid,
  unit_price_cents bigint NOT NULL CHECK (unit_price_cents >= 0),
  UNIQUE (id, clinic_id),
  CHECK (qty_accepted > 0 OR qty_rejected > 0),
  CHECK (qty_rejected = 0 OR reject_reason IS NOT NULL),
  CHECK ((qty_accepted > 0) = (lot_id IS NOT NULL)),
  FOREIGN KEY (receipt_id, clinic_id) REFERENCES inv_po_receipts(id, clinic_id),
  FOREIGN KEY (po_line_id, clinic_id) REFERENCES inv_po_lines(id, clinic_id),
  FOREIGN KEY (lot_id, clinic_id) REFERENCES inv_lots(id, clinic_id)
);
CREATE INDEX inv_po_receipt_lines_idx ON inv_po_receipt_lines (po_line_id);

-- ---------------------------------------------------------------------
-- Consumo estándar por prestación (IN-05)
-- ---------------------------------------------------------------------
CREATE TABLE inv_procedure_materials (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  procedure_id  uuid NOT NULL,
  item_id       uuid NOT NULL,
  qty           numeric(14,3) NOT NULL CHECK (qty > 0),
  per           text NOT NULL DEFAULT 'treatment' CHECK (per IN ('treatment','tooth','surface')),
  UNIQUE (procedure_id, item_id),
  FOREIGN KEY (procedure_id, clinic_id) REFERENCES procedures(id, clinic_id),
  FOREIGN KEY (item_id, clinic_id) REFERENCES inv_items(id, clinic_id)
);

-- Marca de "este tratamiento ya descontó materiales" (idempotencia del consumo automático)
CREATE TABLE inv_treatment_consumptions (
  budget_item_id uuid PRIMARY KEY,
  clinic_id      uuid NOT NULL REFERENCES clinics(id),
  branch_id      uuid NOT NULL,
  appointment_id uuid,
  created_by     uuid REFERENCES users(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (budget_item_id, clinic_id) REFERENCES budget_items(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id)
);

-- Consumos pendientes: el tratamiento se realizó pero faltaba stock (nunca se bloquea)
CREATE TABLE inv_pending_consumptions (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  branch_id       uuid NOT NULL,
  item_id         uuid NOT NULL,
  budget_item_id  uuid,
  appointment_id  uuid,
  qty_missing     numeric(14,3) NOT NULL CHECK (qty_missing > 0),
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  resolved_by     uuid REFERENCES users(id),
  resolved_at     timestamptz,
  resolution      text CHECK (resolution IS NULL OR resolution IN ('consumed','dismissed')),
  resolution_note text CHECK (resolution_note IS NULL OR length(resolution_note) <= 300),
  UNIQUE (id, clinic_id),
  CHECK ((resolved_at IS NULL) = (resolution IS NULL)),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id),
  FOREIGN KEY (item_id, clinic_id) REFERENCES inv_items(id, clinic_id),
  FOREIGN KEY (budget_item_id, clinic_id) REFERENCES budget_items(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id)
);
CREATE INDEX inv_pending_open_idx ON inv_pending_consumptions (clinic_id, branch_id) WHERE resolved_at IS NULL;

-- ---------------------------------------------------------------------
-- Movimientos (solo inserción). Cada movimiento afecta a UN lote.
-- ---------------------------------------------------------------------
CREATE TABLE inv_movements (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id       uuid NOT NULL REFERENCES clinics(id),
  item_id         uuid NOT NULL,
  branch_id       uuid NOT NULL,
  lot_id          uuid NOT NULL,
  kind            text NOT NULL CHECK (kind IN ('purchase','consumption','adjustment','transfer_out','transfer_in')),
  qty             numeric(14,3) NOT NULL CHECK (qty <> 0),       -- positivo = entra, negativo = sale
  unit_cost       numeric(16,4) CHECK (unit_cost IS NULL OR unit_cost >= 0),
  reason          text CHECK (reason IS NULL OR reason IN ('count','breakage','expiry','other')),
  note            text CHECK (note IS NULL OR length(note) <= 500),
  po_receipt_id   uuid,
  transfer_id     uuid,
  count_id        uuid,
  budget_item_id  uuid,
  appointment_id  uuid,
  pending_id      uuid,
  created_by      uuid REFERENCES users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK (CASE kind
           WHEN 'purchase' THEN qty > 0 AND unit_cost IS NOT NULL
           WHEN 'transfer_in' THEN qty > 0
           WHEN 'consumption' THEN qty < 0
           WHEN 'transfer_out' THEN qty < 0
           ELSE reason IS NOT NULL END),
  CHECK (reason IS NULL OR kind = 'adjustment'),
  CHECK (reason IS DISTINCT FROM 'other' OR note IS NOT NULL),
  FOREIGN KEY (lot_id, item_id, branch_id, clinic_id) REFERENCES inv_lots(id, item_id, branch_id, clinic_id),
  FOREIGN KEY (po_receipt_id, clinic_id) REFERENCES inv_po_receipts(id, clinic_id),
  FOREIGN KEY (transfer_id, clinic_id) REFERENCES inv_transfers(id, clinic_id),
  FOREIGN KEY (count_id, clinic_id) REFERENCES inv_counts(id, clinic_id),
  FOREIGN KEY (budget_item_id, clinic_id) REFERENCES budget_items(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id) REFERENCES appointments(id, clinic_id),
  FOREIGN KEY (pending_id, clinic_id) REFERENCES inv_pending_consumptions(id, clinic_id)
);
CREATE INDEX inv_movements_idx ON inv_movements (clinic_id, branch_id, created_at DESC);
CREATE INDEX inv_movements_item_idx ON inv_movements (clinic_id, item_id, created_at DESC);
CREATE INDEX inv_movements_lot_idx ON inv_movements (lot_id);
CREATE INDEX inv_movements_treatment_idx ON inv_movements (budget_item_id) WHERE budget_item_id IS NOT NULL;

CREATE TRIGGER inv_movements_immutable BEFORE UPDATE OR DELETE ON inv_movements FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER inv_po_receipts_immutable BEFORE UPDATE OR DELETE ON inv_po_receipts FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER inv_po_receipt_lines_immutable BEFORE UPDATE OR DELETE ON inv_po_receipt_lines FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER inv_treatment_consumptions_immutable BEFORE UPDATE OR DELETE ON inv_treatment_consumptions FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- Aplica el movimiento al lote y al stock de la sucursal (la ÚNICA vía para cambiar saldos).
-- SECURITY DEFINER: dental_app no tiene permiso de escritura sobre los saldos.
CREATE OR REPLACE FUNCTION inv_apply_movement() RETURNS trigger
  LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, pg_temp AS $$
DECLARE
  l_qty  numeric;
  l_cost numeric;
BEGIN
  SELECT qty_on_hand, unit_cost INTO l_qty, l_cost
    FROM inv_lots WHERE id = NEW.lot_id AND clinic_id = NEW.clinic_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Lote inexistente' USING ERRCODE = 'foreign_key_violation';
  END IF;
  IF l_qty + NEW.qty < 0 THEN
    RAISE EXCEPTION 'Stock insuficiente en el lote: hay %, se intentó sacar %', l_qty, -NEW.qty
      USING ERRCODE = 'check_violation', CONSTRAINT = 'inv_lots_not_negative';
  END IF;
  UPDATE inv_lots
     SET qty_on_hand = l_qty + NEW.qty,
         unit_cost = CASE
           WHEN NEW.qty > 0 AND NEW.unit_cost IS NOT NULL
             THEN round((l_qty * l_cost + NEW.qty * NEW.unit_cost) / (l_qty + NEW.qty), 4)
           ELSE l_cost END
   WHERE id = NEW.lot_id;
  UPDATE inv_stock SET qty_on_hand = qty_on_hand + NEW.qty
   WHERE item_id = NEW.item_id AND branch_id = NEW.branch_id;
  RETURN NEW;
END $$;
CREATE TRIGGER inv_movements_apply AFTER INSERT ON inv_movements FOR EACH ROW EXECUTE FUNCTION inv_apply_movement();
REVOKE ALL ON FUNCTION inv_apply_movement() FROM PUBLIC;

-- ---------------------------------------------------------------------
-- Row Level Security
-- ---------------------------------------------------------------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'inv_suppliers','inv_items','inv_stock','inv_lots','inv_transfers','inv_transfer_lines','inv_counts','inv_count_lines',
    'inv_purchase_orders','inv_po_lines','inv_po_receipts','inv_po_receipt_lines','inv_procedure_materials',
    'inv_treatment_consumptions','inv_pending_consumptions','inv_movements'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- Privilegios mínimos del rol de la aplicación
-- ---------------------------------------------------------------------
GRANT SELECT, INSERT ON inv_suppliers, inv_items TO dental_app;
GRANT UPDATE (name, tax_id, contact_name, phone, email, address, payment_terms, notes, active) ON inv_suppliers TO dental_app;
GRANT UPDATE (name, category, use_unit, purchase_unit, purchase_factor, tracks_lots, preferred_supplier_id, active) ON inv_items TO dental_app;
-- Saldos: la app solo crea la fila (en cero) y fija el mínimo; el saldo lo cambia el trigger.
GRANT SELECT ON inv_stock, inv_lots TO dental_app;
GRANT INSERT (clinic_id, item_id, branch_id, min_qty) ON inv_stock TO dental_app;
GRANT UPDATE (min_qty) ON inv_stock TO dental_app;
GRANT INSERT (clinic_id, item_id, branch_id, lot_code, expires_on, supplier_id) ON inv_lots TO dental_app;
GRANT SELECT, INSERT ON inv_movements, inv_po_receipts, inv_po_receipt_lines, inv_treatment_consumptions TO dental_app;
GRANT SELECT, INSERT ON inv_transfers, inv_transfer_lines TO dental_app;
GRANT UPDATE (status, received_by, received_at, receive_note) ON inv_transfers TO dental_app;
GRANT UPDATE (to_lot_id, qty_received, difference_reason) ON inv_transfer_lines TO dental_app;
GRANT SELECT, INSERT ON inv_counts, inv_count_lines TO dental_app;
GRANT UPDATE (status, decided_by, decided_at, decided_note) ON inv_counts TO dental_app;
GRANT UPDATE (counted_qty, counted_by, counted_at) ON inv_count_lines TO dental_app;
GRANT SELECT, INSERT ON inv_purchase_orders TO dental_app;
GRANT UPDATE (supplier_id, branch_id, status, expected_on, notes, sent_by, sent_at, closed_by, closed_at, close_note) ON inv_purchase_orders TO dental_app;
GRANT SELECT, INSERT, UPDATE (qty_ordered, unit_price_cents, position), DELETE ON inv_po_lines TO dental_app;
GRANT SELECT, INSERT, UPDATE (qty, per), DELETE ON inv_procedure_materials TO dental_app;
GRANT SELECT, INSERT ON inv_pending_consumptions TO dental_app;
GRANT UPDATE (resolved_by, resolved_at, resolution, resolution_note) ON inv_pending_consumptions TO dental_app;
