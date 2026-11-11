-- 0022 — Endurecimiento y rendimiento antes del piloto (Equipo Q).
-- Medido con scripts/perf-seed.ts (5 sucursales, 100 000 pacientes, 600 000 citas, 1 M de auditoría)
-- y scripts/perf-bench.ts. Cada índice responde a una consulta lenta vista con EXPLAIN (ANALYZE, BUFFERS).
-- Nota: los índices se crean dentro de la transacción de la migración (sin CONCURRENTLY); con el
-- volumen del piloto tardan segundos.

-- ---------------- Índices ----------------
-- Lista de presupuestos: «pagado» por presupuesto recorría todos los pagos (Seq Scan por fila).
CREATE INDEX IF NOT EXISTS payments_budget_idx ON payments (clinic_id, budget_id) WHERE budget_id IS NOT NULL;
-- Huecos liberados (Inicio), Mi día y disponibilidad por profesional: citas por profesional y hora.
CREATE INDEX IF NOT EXISTS appointments_dentist_day_idx ON appointments (clinic_id, dentist_id, starts_at);
-- Historial del paciente e Inicio: eventos de auditoría por acción (reprogramaciones, anulaciones).
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (clinic_id, action, created_at DESC);
-- Panel: producción del período (cargos por fecha) y pacientes nuevos del período.
CREATE INDEX IF NOT EXISTS charges_day_idx ON charges (clinic_id, created_at);
CREATE INDEX IF NOT EXISTS patients_created_idx ON patients (clinic_id, created_at);

-- ---------------- Saldo del paciente: una sola fórmula, también por lotes ----------------
-- patient_money(p) se llamaba una vez por paciente en el panel y en las cuentas por cobrar
-- (100 000 llamadas ≈ 1,5 s). La fórmula pasa a una vista (security_invoker: RLS de quien consulta,
-- NUNCA la del dueño de la vista) y patient_money la usa filtrando por paciente, así sigue habiendo
-- un único cálculo del saldo (0009, D-30) y los informes lo obtienen en una sola pasada.
CREATE OR REPLACE VIEW patient_money_v WITH (security_invoker = true) AS
  SELECT p.id AS patient_id,
         COALESCE(bud.v, 0)::bigint AS budgeted_cents,
         COALESCE(ch.v, 0)::bigint AS charged_cents,
         COALESCE(pay.paid, 0)::bigint AS paid_cents,
         COALESCE(pay.on_account, 0)::bigint AS on_account_cents,
         COALESCE(pay.pending, 0)::bigint AS pending_cents,
         (COALESCE(ch.v, 0) - COALESCE(pay.paid, 0))::bigint AS balance_cents,
         pay.last_at AS last_payment_at
    FROM patients p
    LEFT JOIN (SELECT patient_id, sum(amount_cents - third_party_cents) AS v FROM charges GROUP BY patient_id) ch ON ch.patient_id = p.id
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
GRANT SELECT ON patient_money_v TO dental_app;

-- Misma firma y mismo resultado que antes (una fila con ceros si el paciente no tiene movimientos).
CREATE OR REPLACE FUNCTION patient_money(p_patient uuid)
  RETURNS TABLE (budgeted_cents bigint, charged_cents bigint, paid_cents bigint, on_account_cents bigint,
                 pending_cents bigint, balance_cents bigint, last_payment_at timestamptz)
  LANGUAGE sql STABLE AS $$
  SELECT COALESCE(v.budgeted_cents, 0), COALESCE(v.charged_cents, 0), COALESCE(v.paid_cents, 0), COALESCE(v.on_account_cents, 0),
         COALESCE(v.pending_cents, 0), COALESCE(v.balance_cents, 0), v.last_payment_at
    FROM (SELECT 1) one LEFT JOIN patient_money_v v ON v.patient_id = p_patient
$$;

-- ---------------- Búsqueda de pacientes con el índice trigram bajo RLS ----------------
-- Con RLS, PostgreSQL no usa un índice para condiciones que no son LEAKPROOF (LIKE, <%): la búsqueda
-- recorría los 100 000 pacientes (~500 ms). Esta función devuelve solo los id de la clínica del
-- contexto (filtro explícito por app_clinic_id(); sin clínica no devuelve nada) usando el índice; la
-- ficha se lee después con RLS como siempre. Revisada en tests/db-hardening.test.ts.
CREATE OR REPLACE FUNCTION patient_search_ids(p_q text, p_likes text[])
  RETURNS SETOF uuid
  LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public, pg_temp AS $$
  SELECT p.id FROM patients p
   WHERE p.clinic_id = app_clinic_id()
     AND ((cardinality(p_likes) > 0 AND p.search_text LIKE p_likes[1] AND p.search_text LIKE ALL (p_likes))
          OR (p_q <> '' AND p_q <% p.search_text AND word_similarity(p_q, p.search_text) > 0.7))
$$;
REVOKE ALL ON FUNCTION patient_search_ids(text, text[]) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION patient_search_ids(text, text[]) TO dental_app;
