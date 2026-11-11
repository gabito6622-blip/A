-- =====================================================================
-- 0021 — Puesta en marcha de una clínica nueva (B-006): migración de datos
--        desde el sistema anterior.
--
--  * import_batches: cada importación real (no las revisiones) queda
--    registrada con el SHA-256 del archivo, los conteos y el resultado fila
--    por fila (para descargar el reporte después). Solo inserción.
--  * import_records: clave externa de cada fila importada (columna «ID
--    externo» del archivo o, si no la hay, el hash de la fila normalizada).
--    UNIQUE (clínica, tipo, clave): reimportar el mismo archivo no duplica.
--    Solo inserción.
--  * opening_balances: saldo inicial del paciente al día del corte (deuda >0
--    o saldo a favor <0). Es un movimiento propio, separado de los cargos:
--      - no es producción del período (no entra en honorarios, comisiones ni
--        rentabilidad, que leen charges);
--      - no es un cobro (no entra en la caja ni en el arqueo, que leen payments);
--      - patient_money lo suma al saldo, así la ficha, la cuenta del paciente,
--        el portal y las cuentas por cobrar siguen usando una sola fórmula.
--    Solo inserción: un error se corrige con un asiento de anulación
--    (voids_id, monto opuesto, motivo obligatorio), como los cargos.
--    Un solo saldo inicial vigente por paciente (lo garantiza un trigger).
-- =====================================================================

-- ---------------- Lotes de importación ----------------
CREATE TABLE import_batches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  kind             text NOT NULL CHECK (kind IN ('patients','appointments','balances')),
  file_name        text CHECK (file_name IS NULL OR length(file_name) <= 200),
  file_sha256      text NOT NULL CHECK (file_sha256 ~ '^[0-9a-f]{64}$'),
  total_rows       int NOT NULL CHECK (total_rows >= 0),
  created_count    int NOT NULL CHECK (created_count >= 0),
  duplicate_count  int NOT NULL CHECK (duplicate_count >= 0),
  error_count      int NOT NULL CHECK (error_count >= 0),
  review_count     int NOT NULL DEFAULT 0 CHECK (review_count >= 0),
  results          jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(results) = 'array'),
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id)
);
CREATE INDEX import_batches_clinic_idx ON import_batches (clinic_id, created_at DESC);

-- ---------------- Saldos iniciales ----------------
CREATE TABLE opening_balances (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id        uuid NOT NULL REFERENCES clinics(id),
  patient_id       uuid NOT NULL,
  branch_id        uuid,
  -- > 0: el paciente debe a la clínica; < 0: saldo a favor del paciente.
  amount_cents     bigint NOT NULL CHECK (amount_cents <> 0 AND amount_cents BETWEEN -1000000000 AND 1000000000),
  cutoff_date      date NOT NULL CHECK (cutoff_date >= DATE '2000-01-01'),
  description      text NOT NULL DEFAULT 'Saldo inicial (sistema anterior)' CHECK (length(description) BETWEEN 3 AND 120),
  notes            text CHECK (notes IS NULL OR length(notes) <= 500),
  voids_id         uuid,
  void_reason      text CHECK (void_reason IS NULL OR length(void_reason) BETWEEN 3 AND 300),
  batch_id         uuid,
  created_by       uuid NOT NULL REFERENCES users(id),
  created_at       timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, clinic_id),
  CHECK ((voids_id IS NULL) = (void_reason IS NULL)),
  FOREIGN KEY (patient_id, clinic_id) REFERENCES patients(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id)  REFERENCES branches(id, clinic_id),
  FOREIGN KEY (voids_id, clinic_id)   REFERENCES opening_balances(id, clinic_id),
  -- Diferida: el lote se registra al final de la importación, con sus conteos definitivos.
  FOREIGN KEY (batch_id, clinic_id)   REFERENCES import_batches(id, clinic_id) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX opening_balances_patient_idx ON opening_balances (clinic_id, patient_id);
CREATE UNIQUE INDEX opening_balances_void_once ON opening_balances (voids_id) WHERE voids_id IS NOT NULL;

-- Coherencia del asiento: la anulación es exactamente el opuesto del original y del mismo paciente;
-- un paciente tiene a lo sumo un saldo inicial vigente (sin anular).
CREATE OR REPLACE FUNCTION opening_balances_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE o record;
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended('opening:' || NEW.clinic_id || ':' || NEW.patient_id, 0));
  IF NEW.voids_id IS NOT NULL THEN
    SELECT * INTO o FROM opening_balances WHERE id = NEW.voids_id AND clinic_id = NEW.clinic_id;
    IF NOT FOUND OR o.voids_id IS NOT NULL THEN
      RAISE EXCEPTION 'Solo se anula un saldo inicial original' USING ERRCODE = 'check_violation';
    END IF;
    IF o.patient_id <> NEW.patient_id OR o.amount_cents <> -NEW.amount_cents THEN
      RAISE EXCEPTION 'La anulación debe ser del mismo paciente y por el monto opuesto' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM opening_balances ob
              WHERE ob.clinic_id = NEW.clinic_id AND ob.patient_id = NEW.patient_id AND ob.voids_id IS NULL
                AND NOT EXISTS (SELECT 1 FROM opening_balances v WHERE v.voids_id = ob.id)) THEN
    RAISE EXCEPTION 'El paciente ya tiene un saldo inicial vigente' USING ERRCODE = 'unique_violation', CONSTRAINT = 'opening_balances_one_active';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER opening_balances_check BEFORE INSERT ON opening_balances FOR EACH ROW EXECUTE FUNCTION opening_balances_check();

-- ---------------- Claves externas de lo importado ----------------
CREATE TABLE import_records (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id          uuid NOT NULL REFERENCES clinics(id),
  batch_id           uuid NOT NULL,
  kind               text NOT NULL CHECK (kind IN ('patients','appointments','balances')),
  external_key       text NOT NULL CHECK (length(external_key) BETWEEN 3 AND 200),
  source_row         int NOT NULL CHECK (source_row >= 2),
  patient_id         uuid,
  appointment_id     uuid,
  opening_balance_id uuid,
  needs_review       boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (clinic_id, kind, external_key),
  CHECK (kind <> 'patients' OR patient_id IS NOT NULL),
  CHECK (kind <> 'appointments' OR appointment_id IS NOT NULL),
  CHECK (kind <> 'balances' OR opening_balance_id IS NOT NULL),
  FOREIGN KEY (batch_id, clinic_id)           REFERENCES import_batches(id, clinic_id),
  FOREIGN KEY (patient_id, clinic_id)         REFERENCES patients(id, clinic_id),
  FOREIGN KEY (appointment_id, clinic_id)     REFERENCES appointments(id, clinic_id),
  FOREIGN KEY (opening_balance_id, clinic_id) REFERENCES opening_balances(id, clinic_id)
);
CREATE INDEX import_records_patient_idx ON import_records (clinic_id, patient_id) WHERE patient_id IS NOT NULL;

CREATE TRIGGER import_batches_immutable BEFORE UPDATE OR DELETE ON import_batches FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER import_records_immutable BEFORE UPDATE OR DELETE ON import_records FOR EACH ROW EXECUTE FUNCTION forbid_mutation();
CREATE TRIGGER opening_balances_immutable BEFORE UPDATE OR DELETE ON opening_balances FOR EACH ROW EXECUTE FUNCTION forbid_mutation();

-- ---------------- Saldo único del paciente: incluye el saldo inicial ----------------
-- Se agrega la columna opening_cents (al final); balance = cargos del paciente + saldo inicial − pagos confirmados.
-- Cambiar las columnas que devuelve una función exige recrearla (DROP + CREATE); ninguna vista depende de ella.
DROP FUNCTION patient_money(uuid);
CREATE FUNCTION patient_money(p_patient uuid)
  RETURNS TABLE (budgeted_cents bigint, charged_cents bigint, paid_cents bigint, on_account_cents bigint,
                 pending_cents bigint, balance_cents bigint, last_payment_at timestamptz, opening_cents bigint)
  LANGUAGE sql STABLE AS $$
  WITH ch AS (SELECT COALESCE(sum(amount_cents - third_party_cents), 0)::bigint AS v FROM charges WHERE patient_id = p_patient),
       ob AS (SELECT COALESCE(sum(amount_cents), 0)::bigint AS v FROM opening_balances WHERE patient_id = p_patient),
       pay AS (SELECT COALESCE(sum(amount_cents) FILTER (WHERE status = 'confirmed'), 0)::bigint AS paid,
                      COALESCE(sum(amount_cents) FILTER (WHERE status = 'confirmed' AND budget_id IS NULL), 0)::bigint AS on_account,
                      COALESCE(sum(amount_cents) FILTER (WHERE status = 'pending_verification'), 0)::bigint AS pending,
                      max(received_at) FILTER (WHERE status = 'confirmed') AS last_at
                 FROM payments WHERE patient_id = p_patient),
       bud AS (SELECT COALESCE(sum(i.net_cents), 0)::bigint AS v
                 FROM budget_items i JOIN budgets b ON b.id = i.budget_id
                WHERE b.patient_id = p_patient AND b.status IN ('accepted','completed') AND i.status <> 'cancelled')
  SELECT bud.v, ch.v, pay.paid, pay.on_account, pay.pending, ch.v + ob.v - pay.paid, pay.last_at, ob.v FROM ch, ob, pay, bud
$$;

-- ---------------- RLS y privilegios ----------------
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['import_batches','import_records','opening_balances'] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('CREATE POLICY tenant_isolation ON %I USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id())', t);
  END LOOP;
END $$;

GRANT SELECT, INSERT ON import_batches, import_records, opening_balances TO dental_app;
GRANT EXECUTE ON FUNCTION patient_money(uuid) TO dental_app;
