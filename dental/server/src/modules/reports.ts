import { z } from "zod";
import ExcelJS from "exceljs";
import { DateTime } from "luxon";
import type { Route } from "../lib/http.js";
import { zDate, zId } from "../lib/http.js";
import { badRequest } from "../lib/errors.js";
import { audit } from "../lib/audit.js";
import type { Client } from "../lib/db.js";
import { allowedBranches, type AuthCtx } from "../lib/rbac.js";
import { clinicZone } from "./agenda.js";
import { METHOD_LABELS } from "./billing.js";

export async function resolveRange(c: Client, auth: AuthCtx, from?: string, to?: string) {
  const zone = await clinicZone(c, auth.clinicId!);
  const now = DateTime.now().setZone(zone);
  const f = from ? DateTime.fromISO(from, { zone }) : now.startOf("month");
  const t = to ? DateTime.fromISO(to, { zone }).plus({ days: 1 }) : now.startOf("month").plus({ months: 1 });
  if (!f.isValid || !t.isValid || t <= f) throw badRequest("Rango de fechas inválido");
  if (t.diff(f, "days").days > 400) throw badRequest("El rango máximo es de 400 días");
  return { zone, from: f.toJSDate(), to: t.toJSDate(), fromDate: f.toISODate()!, toDateExclusive: t.toISODate()! };
}

/** Indicadores por sucursal (operativos y, si hay permiso, financieros). */
export async function dashboardData(c: Client, auth: AuthCtx, fromISO?: string, toISO?: string) {
  const range = await resolveRange(c, auth, fromISO, toISO);
  const financial = auth.permissions.has("reports.financial");
  const allowed = allowedBranches(auth);
  const params = [range.from, range.to, allowed];
  const branches = (await c.query<{ id: string; name: string; code: string }>(
    "SELECT id, name, code FROM branches WHERE active AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY code", [allowed])).rows;
  const appts = (await c.query(
    `SELECT branch_id, count(*)::int AS total,
            count(*) FILTER (WHERE status = 'completed')::int AS completed,
            count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
            count(*) FILTER (WHERE status = 'no_show')::int AS no_show,
            COALESCE(sum(extract(epoch FROM ends_at - starts_at) / 60) FILTER (WHERE status NOT IN ('cancelled','no_show')), 0)::int AS booked_min,
            count(DISTINCT patient_id) FILTER (WHERE status = 'completed')::int AS patients_seen
       FROM appointments WHERE starts_at >= $1 AND starts_at < $2 AND ($3::uuid[] IS NULL OR branch_id = ANY($3))
      GROUP BY branch_id`, params)).rows;
  const capacity = (await c.query(
    `WITH days AS (SELECT d::date AS day FROM generate_series($1::date, $2::date - 1, interval '1 day') d)
     SELECT s.branch_id, COALESCE(sum(extract(epoch FROM s.end_time - s.start_time) / 60), 0)::int AS minutes
       FROM days JOIN dentist_schedules s ON s.weekday = extract(isodow FROM days.day)
      WHERE ($3::uuid[] IS NULL OR s.branch_id = ANY($3)) GROUP BY s.branch_id`,
    [range.fromDate, range.toDateExclusive, allowed])).rows;
  let money: Record<string, { collected: number; production: number; pending: number }> = {};
  if (financial) {
    const pay = (await c.query(
      `SELECT branch_id, COALESCE(sum(amount_cents) FILTER (WHERE status = 'confirmed'),0) AS collected,
              COALESCE(sum(amount_cents) FILTER (WHERE status = 'pending_verification'),0) AS pending
         FROM payments WHERE received_at >= $1 AND received_at < $2 AND ($3::uuid[] IS NULL OR branch_id = ANY($3)) GROUP BY branch_id`, params)).rows;
    const prod = (await c.query(
      `SELECT branch_id, COALESCE(sum(amount_cents),0) AS production FROM charges
        WHERE created_at >= $1 AND created_at < $2 AND ($3::uuid[] IS NULL OR branch_id = ANY($3)) GROUP BY branch_id`, params)).rows;
    for (const b of branches) {
      money[b.id] = {
        collected: Number(pay.find((x) => x.branch_id === b.id)?.collected ?? 0),
        pending: Number(pay.find((x) => x.branch_id === b.id)?.pending ?? 0),
        production: Number(prod.find((x) => x.branch_id === b.id)?.production ?? 0),
      };
    }
  }
  const rows = branches.map((b) => {
    const a = appts.find((x) => x.branch_id === b.id) ?? { total: 0, completed: 0, cancelled: 0, no_show: 0, booked_min: 0, patients_seen: 0 };
    const cap = Number(capacity.find((x) => x.branch_id === b.id)?.minutes ?? 0);
    const attended = a.completed + a.no_show;
    return {
      branchId: b.id, branchName: b.name, code: b.code,
      appointments: a.total, completed: a.completed, cancelled: a.cancelled, noShow: a.no_show, patientsSeen: a.patients_seen,
      noShowRate: attended ? Math.round((a.no_show / attended) * 1000) / 10 : null,
      occupancyPct: cap ? Math.round((a.booked_min / cap) * 1000) / 10 : null,
      ...(financial ? { collectedCents: money[b.id]!.collected, productionCents: money[b.id]!.production, pendingVerificationCents: money[b.id]!.pending } : {}),
    };
  });
  const sum = (k: keyof (typeof rows)[number]) => rows.reduce((s, r) => s + (Number(r[k]) || 0), 0);
  const newPatients = (await c.query<{ n: number }>("SELECT count(*)::int AS n FROM patients WHERE created_at >= $1 AND created_at < $2", [range.from, range.to])).rows[0]!.n;
  let finance = null;
  if (financial) {
    const rec = (await c.query<{ receivable: number; patients: number }>(
      `SELECT COALESCE(sum(bal),0) AS receivable, count(*)::int AS patients FROM (
         SELECT p.id, (SELECT balance_cents FROM patient_money(p.id)) AS bal
           FROM patients p) t WHERE bal > 0`)).rows[0]!;
    const bud = (await c.query(
      `SELECT count(*) FILTER (WHERE status = 'presented')::int AS presented_open,
              COALESCE(sum(t.total) FILTER (WHERE status = 'presented'),0) AS presented_open_cents,
              count(*) FILTER (WHERE status IN ('accepted','completed') AND decided_at >= $1 AND decided_at < $2)::int AS accepted,
              count(*) FILTER (WHERE status = 'rejected' AND decided_at >= $1 AND decided_at < $2)::int AS rejected
         FROM budgets b CROSS JOIN LATERAL (SELECT COALESCE(sum(net_cents),0) AS total FROM budget_items i WHERE i.budget_id = b.id AND i.status <> 'cancelled') t
        WHERE ($3::uuid[] IS NULL OR b.branch_id = ANY($3))`, params)).rows[0];
    const decided = bud.accepted + bud.rejected;
    finance = {
      receivableCents: Number(rec.receivable), patientsWithDebt: rec.patients,
      openBudgets: bud.presented_open, openBudgetsCents: Number(bud.presented_open_cents),
      budgetConversionPct: decided ? Math.round((bud.accepted / decided) * 1000) / 10 : null,
    };
  }
  return {
    range: { from: range.fromDate, to: DateTime.fromISO(range.toDateExclusive).minus({ days: 1 }).toISODate(), timezone: range.zone },
    financial,
    branches: rows,
    totals: {
      appointments: sum("appointments"), completed: sum("completed"), cancelled: sum("cancelled"), noShow: sum("noShow"), newPatients,
      ...(financial ? { collectedCents: sum("collectedCents" as never), productionCents: sum("productionCents" as never), pendingVerificationCents: sum("pendingVerificationCents" as never) } : {}),
    },
    finance,
  };
}

export async function productionByDentist(c: Client, auth: AuthCtx, fromISO?: string, toISO?: string) {
  const range = await resolveRange(c, auth, fromISO, toISO);
  const r = await c.query(
    `SELECT ch.dentist_id AS "dentistId", u.full_name AS "dentistName", m.commission_pct AS "commissionPct",
            COALESCE(sum(ch.amount_cents),0) AS "productionCents", count(*) FILTER (WHERE ch.amount_cents > 0)::int AS treatments
       FROM charges ch JOIN users u ON u.id = ch.dentist_id JOIN memberships m ON m.clinic_id = ch.clinic_id AND m.user_id = ch.dentist_id
      WHERE ch.created_at >= $1 AND ch.created_at < $2 AND ($3::uuid[] IS NULL OR ch.branch_id = ANY($3))
      GROUP BY ch.dentist_id, u.full_name, m.commission_pct ORDER BY "productionCents" DESC`,
    [range.from, range.to, allowedBranches(auth)],
  );
  return r.rows.map((x) => ({ ...x, commissionCents: x.commissionPct != null ? Math.round((Number(x.productionCents) * Number(x.commissionPct)) / 100) : null }));
}

export async function patientsWithoutNextAppointment(c: Client, auth: AuthCtx, months = 12) {
  const r = await c.query(
    `WITH last AS (
       SELECT DISTINCT ON (a.patient_id) a.patient_id, a.dentist_id, a.starts_at
         FROM appointments a WHERE a.status = 'completed' AND a.starts_at > now() - make_interval(months => $1)
          AND ($2::uuid[] IS NULL OR a.branch_id = ANY($2))
        ORDER BY a.patient_id, a.starts_at DESC)
     SELECT l.dentist_id AS "dentistId", u.full_name AS "dentistName", count(*)::int AS patients,
            (array_agg(json_build_object('patientId', p.id, 'name', p.first_name || ' ' || p.last_name, 'lastVisit', l.starts_at) ORDER BY l.starts_at))[1:20] AS sample
       FROM last l JOIN patients p ON p.id = l.patient_id AND p.archived_at IS NULL JOIN users u ON u.id = l.dentist_id
      WHERE NOT EXISTS (SELECT 1 FROM appointments f WHERE f.patient_id = l.patient_id AND f.starts_at > now() AND f.status NOT IN ('cancelled','no_show'))
      GROUP BY l.dentist_id, u.full_name ORDER BY patients DESC`,
    [months, allowedBranches(auth)],
  );
  return r.rows;
}

export function reportRoutes(route: Route) {
  route({
    method: "GET", url: "/api/reports/dashboard", summary: "Panel consolidado por sucursal", tags: ["reportes"], perm: "reports.operational",
    query: z.object({ from: zDate.optional(), to: zDate.optional() }),
    handler: async ({ c, auth, query }) => dashboardData(c, auth, query.from, query.to),
  });
  // Contabilidad solo tiene reports.financial: también puede ver el panel.
  route({
    method: "GET", url: "/api/reports/finance-dashboard", summary: "Panel financiero consolidado", tags: ["reportes"], perm: "reports.financial",
    query: z.object({ from: zDate.optional(), to: zDate.optional() }),
    handler: async ({ c, auth, query }) => dashboardData(c, auth, query.from, query.to),
  });

  route({
    method: "GET", url: "/api/reports/production-by-dentist", summary: "Producción y comisión estimada por profesional (base: tratamientos realizados)", tags: ["reportes"], perm: "reports.financial",
    query: z.object({ from: zDate.optional(), to: zDate.optional() }),
    handler: async ({ c, auth, query }) => productionByDentist(c, auth, query.from, query.to),
  });

  route({
    method: "GET", url: "/api/reports/receivables", summary: "Cuentas por cobrar por paciente", tags: ["reportes"], perm: "reports.financial",
    handler: async ({ c }) =>
      (
        await c.query(
          `SELECT * FROM (
             SELECT p.id AS "patientId", p.first_name || ' ' || p.last_name AS name, p.phone,
                    m.balance_cents AS "balanceCents", m.last_payment_at AS "lastPaymentAt"
               FROM patients p CROSS JOIN LATERAL patient_money(p.id) m) t WHERE "balanceCents" > 0 ORDER BY "balanceCents" DESC LIMIT 500`,
        )
      ).rows,
  });

  route({
    method: "GET", url: "/api/reports/patients-without-next-appointment", summary: "Pacientes atendidos sin próxima cita, por profesional", tags: ["reportes"], perm: "reports.operational",
    query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }),
    handler: async ({ c, auth, query }) => patientsWithoutNextAppointment(c, auth, query.months),
  });

  route({
    method: "GET", url: "/api/reports/payments.xlsx", summary: "Exportar pagos a Excel", tags: ["reportes"], perm: "reports.financial", raw: true,
    query: z.object({ from: zDate.optional(), to: zDate.optional(), branchId: zId.optional() }),
    handler: async ({ c, auth, query, reply }) => {
      const range = await resolveRange(c, auth, query.from, query.to);
      const r = await c.query(
        `SELECT p.receipt_number, to_char(p.received_at AT TIME ZONE $4, 'YYYY-MM-DD HH24:MI') AS fecha, b.name AS sucursal,
                pt.first_name || ' ' || pt.last_name AS paciente, p.method, p.status, p.amount_cents, p.bank_reference, u.full_name AS recibido_por
           FROM payments p JOIN branches b ON b.id = p.branch_id JOIN patients pt ON pt.id = p.patient_id JOIN users u ON u.id = p.received_by
          WHERE p.received_at >= $1 AND p.received_at < $2 AND ($3::uuid IS NULL OR p.branch_id = $3) AND ($5::uuid[] IS NULL OR p.branch_id = ANY($5))
          ORDER BY p.received_at`,
        [range.from, range.to, query.branchId ?? null, range.zone, allowedBranches(auth)],
      );
      const wb = new ExcelJS.Workbook();
      const ws = wb.addWorksheet("Pagos");
      ws.addRow(["Recibo", "Fecha", "Sucursal", "Paciente", "Medio", "Estado", "Monto (Bs)", "Referencia", "Recibido por"]).font = { bold: true };
      const STATUS: Record<string, string> = { confirmed: "Confirmado", pending_verification: "Pendiente de verificación", rejected: "Rechazado", voided: "Anulado" };
      for (const x of r.rows) ws.addRow([x.receipt_number, x.fecha, x.sucursal, x.paciente, METHOD_LABELS[x.method], STATUS[x.status], x.amount_cents / 100, x.bank_reference, x.recibido_por]);
      ws.getColumn(7).numFmt = "#,##0.00";
      ws.columns.forEach((col) => (col.width = 18));
      await audit(c, auth, "report.exported", "payments", null, { from: range.fromDate, to: range.toDateExclusive, rows: r.rowCount });
      reply
        .header("content-type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
        .header("content-disposition", `attachment; filename="pagos-${range.fromDate}.xlsx"`)
        .send(Buffer.from(await wb.xlsx.writeBuffer()));
    },
  });
}
