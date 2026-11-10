// Datos de demostración (100 % ficticios): gastos en Bs de las 5 sucursales y fichajes del último mes.
import type pg from "pg";
import { DateTime } from "luxon";

const ZONE = "America/La_Paz";

export async function seedManagementDemo(pool: pg.Pool, clinicId: string) {
  const q = (sql: string, p: unknown[] = []) => pool.query(sql, p);
  let s = 16_2026;
  const rnd = () => ((s = (s * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
  const around = (cents: number, pct = 0.12) => Math.round((cents * (1 - pct + rnd() * 2 * pct)) / 100) * 100;

  const owner = (await q("SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.clinic_id = $1 AND m.role = 'owner' LIMIT 1", [clinicId])).rows[0].id as string;
  const manager = (await q("SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.clinic_id = $1 AND m.role = 'admin' LIMIT 1", [clinicId])).rows[0]?.id ?? owner;
  const accountant = (await q("SELECT u.id FROM users u JOIN memberships m ON m.user_id = u.id WHERE m.clinic_id = $1 AND m.role = 'accountant' LIMIT 1", [clinicId])).rows[0]?.id ?? owner;
  const branches = (await q("SELECT id, code FROM branches WHERE clinic_id = $1 ORDER BY code", [clinicId])).rows as { id: string; code: string }[];

  // Gastos fijos mensuales por sucursal (montos ficticios y razonables en Bs, en centavos)
  const fixed: Record<string, { rent: number; salaries: number; power: number; internet: number }> = {
    LPZ: { rent: 650000, salaries: 920000, power: 98000, internet: 35000 },
    SUR: { rent: 520000, salaries: 610000, power: 76000, internet: 35000 },
    EAL: { rent: 330000, salaries: 540000, power: 61000, internet: 29000 },
    CBB: { rent: 450000, salaries: 580000, power: 70000, internet: 32000 },
    SCZ: { rent: 700000, salaries: 860000, power: 112000, internet: 38000 },
  };
  const now = DateTime.now().setZone(ZONE);
  const today = now.toISODate()!;
  const thisMonth = now.startOf("month");
  const firstMonth = thisMonth.minus({ months: 3 });
  let expenses = 0;

  const insertExpense = async (o: { branch: string; category: string; description: string; amount: number; date: string; supplier?: string | null; receipt?: string | null;
    status: "draft" | "confirmed"; recurringId?: string | null; period?: string | null; by: string }) => {
    expenses++;
    return (await q(
      `INSERT INTO expenses (clinic_id, branch_id, category, description, amount_cents, expense_date, supplier, receipt_ref, status, recurring_id, period_month, created_by, created_at, confirmed_by, confirmed_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15) RETURNING id`,
      [clinicId, o.branch, o.category, o.description, o.amount, o.date, o.supplier ?? null, o.receipt ?? null, o.status, o.recurringId ?? null, o.period ?? null, o.by,
        DateTime.fromISO(o.date, { zone: ZONE }).set({ hour: 10 }).toJSDate(), o.status === "confirmed" ? o.by : null,
        o.status === "confirmed" ? DateTime.fromISO(o.date, { zone: ZONE }).set({ hour: 11 }).toJSDate() : null])).rows[0].id as string;
  };

  for (const b of branches) {
    const f = fixed[b.code] ?? fixed.LPZ!;
    const templates: { id: string; category: string; description: string; amount: number; day: number; supplier: string | null }[] = [];
    for (const [category, description, amount, day, supplier] of [
      ["rent", `Alquiler del local ${b.code}`, f.rent, 5, "Inmobiliaria Los Andes (ficticia)"],
      ["salaries", "Sueldos del personal de apoyo (recepción y asistencia)", f.salaries, 28, null],
      ["utilities", "Energía eléctrica y agua", f.power, 12, "Distribuidora de servicios (ficticia)"],
      ["utilities", "Internet y telefonía", f.internet, 8, "Telecom Demo (ficticia)"],
    ] as const) {
      const id = (await q(
        `INSERT INTO expense_recurring (clinic_id, branch_id, category, description, amount_cents, supplier, day_of_month, starts_month, created_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`, [clinicId, b.id, category, description, amount, supplier, day, firstMonth.toISODate(), owner])).rows[0].id;
      templates.push({ id, category, description, amount, day, supplier });
    }
    // Meses anteriores: los fijos ya confirmados (los servicios varían un poco) y gastos variables.
    for (let m = 3; m >= 0; m--) {
      const month = thisMonth.minus({ months: m });
      for (const t of templates) {
        const date = month.set({ day: t.day }).toISODate()!;
        const amount = t.category === "utilities" ? around(t.amount, 0.15) : t.amount;
        // Mes actual: borrador para confirmar (se confirma el alquiler si ya pasó su fecha)
        const status = m > 0 || (t.category === "rent" && date <= today) ? "confirmed" : "draft";
        await insertExpense({ branch: b.id, category: t.category, description: t.description, amount, date, supplier: t.supplier, status,
          recurringId: t.id, period: month.toISODate(), by: status === "confirmed" ? accountant : owner,
          receipt: status === "confirmed" ? `F-${b.code}-${month.toFormat("yyMM")}-${t.day}` : null });
      }
      const variable: [string, string, number, number, string | null][] = [
        ["supplies", "Material de limpieza y descartables", around(42000, 0.3), 3, "Comercial Illimani (ficticia)"],
        ["taxes", "Impuesto a las Transacciones (IT) del mes anterior", around(95000, 0.25), 15, "Servicio de Impuestos (referencial)"],
      ];
      if (rnd() < 0.7) variable.push(["marketing", "Publicidad en redes sociales", around(60000, 0.4), 10, "Agencia Digital (ficticia)"]);
      if (rnd() < 0.5) variable.push(["maintenance", "Mantenimiento del compresor y la autoclave", around(48000, 0.3), 18, "Servicio Técnico Dental (ficticio)"]);
      if (rnd() < 0.4) variable.push(["other", "Gastos bancarios y comisiones", around(9000, 0.3), 25, null]);
      for (const [category, description, amount, day, supplier] of variable) {
        const date = month.set({ day }).toISODate()!;
        if (date > today) continue;
        await insertExpense({ branch: b.id, category, description, amount, date, supplier, receipt: `R-${Math.floor(rnd() * 90000 + 10000)}`, status: "confirmed", by: accountant });
      }
    }
  }
  // Un gasto anulado de ejemplo (registrado dos veces)
  const lpz = branches.find((b) => b.code === "LPZ") ?? branches[0]!;
  const dupDate = thisMonth.minus({ months: 1 }).set({ day: 10 }).toISODate()!;
  const dup = await insertExpense({ branch: lpz.id, category: "marketing", description: "Publicidad en redes sociales", amount: 60000, date: dupDate, status: "confirmed", by: accountant, receipt: "R-DUPLICADO" });
  await q("INSERT INTO expense_voids (clinic_id, expense_id, reason, voided_by, voided_at) VALUES ($1,$2,$3,$4,$5)",
    [clinicId, dup, "Registrado dos veces (mismo comprobante)", manager, DateTime.fromISO(dupDate, { zone: ZONE }).plus({ days: 1 }).toJSDate()]);

  // ---------------- Fichaje: recepción, asistente y limpieza ----------------
  const staff = (await q(
    `SELECT u.id, u.email, m.role, m.branch_ids FROM users u JOIN memberships m ON m.user_id = u.id
      WHERE m.clinic_id = $1 AND m.role IN ('receptionist','assistant','support') AND cardinality(m.branch_ids) > 0 ORDER BY u.email`, [clinicId])).rows as { id: string; email: string; role: string; branch_ids: string[] }[];
  let entries = 0;
  const punch = async (userId: string, branchId: string, kind: "in" | "out", at: DateTime, source: "self" | "manager", reason: string | null = null, by = userId) => {
    entries++;
    const t = at.toJSDate();
    return (await q(
      `INSERT INTO time_entries (clinic_id, user_id, branch_id, kind, at, source, reason, recorded_by, recorded_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
      [clinicId, userId, branchId, kind, t, source, reason, by, source === "self" ? t : at.plus({ days: 1 }).set({ hour: 9 }).toJSDate()])).rows[0].id as string;
  };
  for (const [idx, p] of staff.entries()) {
    await q("INSERT INTO timeclock_staff (clinic_id, user_id, enabled, updated_by) VALUES ($1,$2,true,$3) ON CONFLICT DO NOTHING", [clinicId, p.id, owner]);
    const branchId = p.branch_ids[0]!;
    for (let d = 30; d >= 1; d--) {
      const day = now.minus({ days: d }).startOf("day");
      if (day.weekday === 7) continue;
      const inAt = day.set({ hour: 7, minute: 48 + Math.floor(rnd() * 22) });
      const outAt = day.weekday === 6 ? day.set({ hour: 12, minute: 30 + Math.floor(rnd() * 15) }) : day.set({ hour: 16, minute: Math.floor(rnd() * 35) });
      if (idx === 0 && d === 9) {
        // Olvidó marcar la salida: la gerencia la agrega con motivo
        await punch(p.id, branchId, "in", inAt, "self");
        await punch(p.id, branchId, "out", day.set({ hour: 16, minute: 0 }), "manager", "Olvidó marcar la salida; confirmado con la agenda del día", manager);
        continue;
      }
      if (idx === 1 && d === 6) {
        // Marcó dos veces la entrada: la gerencia anula la repetida
        await punch(p.id, branchId, "in", inAt, "self");
        const dupIn = await punch(p.id, branchId, "in", inAt.plus({ minutes: 1 }), "self");
        await q(`INSERT INTO time_entries (clinic_id, user_id, branch_id, kind, at, source, reason, voids_entry_id, recorded_by, recorded_at)
                 VALUES ($1,$2,$3,'void',$4,'manager','Entrada marcada dos veces',$5,$6,$4)`, [clinicId, p.id, branchId, outAt.plus({ hours: 1 }).toJSDate(), dupIn, manager]);
        await punch(p.id, branchId, "out", outAt, "self");
        continue;
      }
      if (idx === 2 && d === 4) {
        // Entrada sin salida: queda para revisar en el informe
        await punch(p.id, branchId, "in", inAt, "self");
        continue;
      }
      await punch(p.id, branchId, "in", inAt, "self");
      await punch(p.id, branchId, "out", outAt, "self");
    }
  }
  return { expenses, entries, staff: staff.length };
}
