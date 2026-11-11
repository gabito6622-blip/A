-- =====================================================================
-- 0030 — B-097: rentabilidad.
--
--  * Tope anual del convenio: lo que se trasladó al paciente (payer_transfers) ya no lo paga la
--    empresa, así que deja de consumir el tope del año (la reversión de un traslado lo vuelve a
--    consumir). Se redefine charges_third_party() de 0019 cambiando SOLO el cálculo de «used».
--  * Gastos fijos compartidos: un gasto fijo mensual puede repartirse por porcentaje entre
--    sucursales (como los gastos de B-083); al generarse el borrador del mes, se copia el reparto
--    exacto al centavo en expense_shares.
-- =====================================================================

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
    -- Lo trasladado al paciente (payer_transfers, B-082) ya no lo paga la empresa: libera el tope (B-097).
    SELECT COALESCE(sum(ch.third_party_cents), 0)
           - COALESCE((SELECT sum(t.amount_cents) FROM payer_transfers t JOIN charges c2 ON c2.id = t.charge_id
                        WHERE t.clinic_id = NEW.clinic_id AND t.patient_id = NEW.patient_id AND t.agreement_id = it.agreement_id
                          AND date_part('year', c2.created_at AT TIME ZONE zone) = date_part('year', d)), 0)
      INTO used FROM charges ch
     WHERE ch.clinic_id = NEW.clinic_id AND ch.patient_id = NEW.patient_id AND ch.payer_agreement_id = it.agreement_id
       AND date_part('year', ch.created_at AT TIME ZONE zone) = date_part('year', d);
    share := LEAST(share, GREATEST(it.company_cap_cents - used, 0));
  END IF;
  IF share > 0 THEN
    NEW.payer_agreement_id := it.agreement_id;
    NEW.third_party_cents := share;
  END IF;
  RETURN NEW;
END $$;

-- ---------------- Reparto de los gastos fijos ----------------
CREATE TABLE expense_recurring_shares (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clinic_id     uuid NOT NULL REFERENCES clinics(id),
  recurring_id  uuid NOT NULL,
  branch_id     uuid NOT NULL,
  percent_bp    int NOT NULL CHECK (percent_bp BETWEEN 1 AND 9999),
  UNIQUE (id, clinic_id),
  UNIQUE (recurring_id, branch_id),
  FOREIGN KEY (recurring_id, clinic_id) REFERENCES expense_recurring(id, clinic_id),
  FOREIGN KEY (branch_id, clinic_id) REFERENCES branches(id, clinic_id)
);
CREATE INDEX expense_recurring_shares_idx ON expense_recurring_shares (clinic_id, recurring_id);
ALTER TABLE expense_recurring_shares ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON expense_recurring_shares
  USING (clinic_id = app_clinic_id()) WITH CHECK (clinic_id = app_clinic_id());
-- Es una plantilla (como expense_recurring): se reemplaza al editar; lo ya generado queda en expense_shares.
GRANT SELECT, INSERT, DELETE ON expense_recurring_shares TO dental_app;
-- La sucursal principal de un gasto fijo cambia si cambia su reparto (la de mayor porcentaje).
GRANT UPDATE (branch_id) ON expense_recurring TO dental_app;
