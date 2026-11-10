// Datos demo FICTICIOS de caja y honorarios (los llama la semilla general al final).
import { DateTime } from "luxon";
import { withTenant, nextCounter, type Db } from "../lib/db.js";
import { DENOMINATIONS, addMovement, closeSession, openSession } from "./cashSessions.js";
import { closeSettlement } from "./fees.js";

const ZONE = "America/La_Paz";

/** Desglose "natural" de un monto en billetes y monedas (para arqueos de ejemplo). */
function breakdown(cents: number): Record<string, number> {
  const out: Record<string, number> = {};
  let left = cents;
  for (const d of DENOMINATIONS) {
    const n = Math.floor(left / d.cents);
    if (n) out[String(d.cents)] = n;
    left -= n * d.cents;
  }
  return out;
}

export async function seedCashAndFees(db: Db, clinicId: string) {
  const q = (sql: string, p: unknown[] = []) => db.adminPool.query(sql, p);
  const userId = async (email: string) => (await q("SELECT id FROM users WHERE email = $1", [email])).rows[0].id as string;
  const branch = async (code: string) => (await q("SELECT id FROM branches WHERE clinic_id = $1 AND code = $2", [clinicId, code])).rows[0].id as string;

  // La clínica demo exige caja abierta para cobrar en efectivo.
  await q("UPDATE clinics SET settings = jsonb_set(settings, '{requireCashSession}', 'true') WHERE id = $1", [clinicId]);

  // Reglas de honorarios (ficticias)
  const rules: [string, "production" | "collected", [string | null, "percent" | "fixed", number, number?][]][] = [
    ["dr.mendoza@demo.local", "production", [[null, "percent", 35], ["Endodoncia", "percent", 40], ["Prótesis", "percent", 50, 40000]]],
    ["dra.vargas@demo.local", "collected", [[null, "percent", 40]]],
    ["dr.quispe@demo.local", "production", [[null, "percent", 35]]],
    ["dra.rojas@demo.local", "production", [[null, "percent", 40], ["Cirugía", "fixed", 15000]]],
    ["dr.claure@demo.local", "production", [[null, "percent", 35]]],
    ["dra.suarez@demo.local", "collected", [[null, "percent", 40], ["Ortodoncia", "percent", 45]]],
    ["dr.justiniano@demo.local", "production", [[null, "percent", 30]]],
  ];
  const owner = await userId("propietaria@demo.local");
  for (const [email, base, rs] of rules) {
    const id = await userId(email);
    await q("INSERT INTO fee_profiles (clinic_id, dentist_id, base, updated_by) VALUES ($1,$2,$3,$4)", [clinicId, id, base, owner]);
    for (const [cat, mode, v, deduct] of rs) {
      await q("INSERT INTO fee_rules (clinic_id, dentist_id, category, mode, percent_bp, fixed_cents, deduct_cents) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [clinicId, id, cat, mode, mode === "percent" ? v * 100 : null, mode === "fixed" ? v : null, deduct ?? 0]);
    }
  }

  // Cajas cerradas de los últimos días hábiles (La Paz Centro y Santa Cruz)
  const patients = (await q("SELECT id FROM patients WHERE clinic_id = $1 ORDER BY record_number LIMIT 30", [clinicId])).rows.map((r) => r.id as string);
  const accountant = await userId("contabilidad@demo.local");
  const today = DateTime.now().setZone(ZONE).startOf("day");
  const plans = [
    { email: "recepcion.lpz@demo.local", code: "LPZ", days: [3, 2, 1], diffs: [0, -1000, 0] },
    { email: "recepcion.scz@demo.local", code: "SCZ", days: [2, 1], diffs: [0, 500] },
  ];
  // Últimos días hábiles (lunes a sábado) antes de hoy
  const workdays: DateTime[] = [];
  for (let d = today.minus({ days: 1 }); workdays.length < 3; d = d.minus({ days: 1 })) if (d.weekday !== 7) workdays.push(d);
  let k = 0;
  for (const plan of plans) {
    const cashier = await userId(plan.email);
    const branchId = await branch(plan.code);
    const auth = { userId: cashier, clinicId, ip: "seed" };
    for (const [i, back] of plan.days.entries()) {
      const day = workdays[back - 1]!;
      await withTenant(db.appPool, { clinicId, userId: cashier }, async (c) => {
        const { id } = await openSession(c, auth, branchId, 20000, "Fondo de cambio entregado por gerencia", day.set({ hour: 8 }).toJSDate());
        const amounts = [15000, 25000, 10000, 35000].slice(0, 2 + (k % 3));
        for (const [j, amt] of amounts.entries()) {
          const receipt = await nextCounter(c, clinicId, "receipt");
          const at = day.set({ hour: 9 + j * 2, minute: 15 }).toJSDate();
          await c.query(
            `INSERT INTO payments (clinic_id, receipt_number, branch_id, patient_id, amount_cents, method, status, notes, idempotency_key, received_by, received_at, verified_by, verified_at, cash_session_id)
             VALUES ($1,$2,$3,$4,$5,'cash','confirmed','Consulta (demo)',$6,$7,$8,$7,$8,$9)`,
            [clinicId, receipt, branchId, patients[(k * 5 + j) % patients.length], amt, `seed-cash-${receipt}`, cashier, at, id]);
        }
        await addMovement(c, auth, id, { kind: "out", category: "petty_expense", amountCents: 1550, reason: "Agua y vasos para la sala de espera" }, day.set({ hour: 12 }).toJSDate());
        if (k % 2 === 0) await addMovement(c, auth, id, { kind: "in", category: "change", amountCents: 5000, reason: "Monedas de cambio desde gerencia" }, day.set({ hour: 10 }).toJSDate());
        const expected = (await c.query<{ e: number }>(
          `SELECT s.opening_float_cents + COALESCE((SELECT sum(amount_cents) FROM payments WHERE cash_session_id = s.id AND status = 'confirmed'),0)
                + COALESCE((SELECT sum(CASE WHEN kind = 'in' THEN amount_cents ELSE -amount_cents END) FROM cash_movements WHERE session_id = s.id),0) AS e
             FROM cash_sessions s WHERE s.id = $1`, [id])).rows[0]!.e;
        const diff = plan.diffs[i] ?? 0;
        await closeSession(c, auth, id, breakdown(Number(expected) + diff),
          diff < 0 ? "Faltan Bs 10: se dio mal un cambio; se revisará con gerencia" : diff > 0 ? "Sobran Bs 5: un paciente no esperó su cambio" : null,
          day.set({ hour: 19 }).toJSDate());
        if (diff) {
          await c.query("INSERT INTO cash_session_reviews (clinic_id, session_id, note, reviewed_by, reviewed_at) VALUES ($1,$2,$3,$4,$5)",
            [clinicId, id, "Revisado con la cajera; diferencia explicada", accountant, day.plus({ days: 1 }).set({ hour: 9 }).toJSDate()]);
        }
      });
      k++;
    }
  }

  // Liquidación cerrada del mes anterior para el Dr. Mendoza (ejemplo de solo lectura para el profesional)
  const prev = today.minus({ months: 1 });
  const mendoza = await userId("dr.mendoza@demo.local");
  await withTenant(db.appPool, { clinicId, userId: owner }, async (c) => {
    const s = (await c.query<{ id: string }>(
      "INSERT INTO fee_settlements (clinic_id, dentist_id, period_start, period_end, created_by) VALUES ($1,$2,$3,$4,$5) RETURNING id",
      [clinicId, mendoza, prev.startOf("month").toISODate(), prev.endOf("month").toISODate(), owner])).rows[0]!;
    await closeSettlement(c, { userId: owner, clinicId, ip: "seed" }, s.id, "Liquidación de ejemplo (datos ficticios)");
  });
}
