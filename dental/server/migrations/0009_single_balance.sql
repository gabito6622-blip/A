-- 0009 — Una sola función de saldo del paciente (patient_money, de 0006).
-- La 0007 había creado patient_balance con la misma fórmula; se elimina para que no existan dos cálculos.
DROP FUNCTION IF EXISTS patient_balance(uuid);
