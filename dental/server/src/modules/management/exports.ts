// Exportación a Excel de los informes existentes que aún no la tenían (R2-43).
//
// Regla: la exportación usa EXACTAMENTE los datos de la pantalla, con los mismos filtros, así los
// totales coinciden por construcción:
//  * si el informe tiene una función exportada, se llama a esa función;
//  * si el informe está escrito dentro de su ruta, se pide internamente esa misma ruta
//    (fastify.inject con la cookie de la persona): se aplican los mismos permisos, la misma
//    validación y el mismo alcance por sucursal, sin duplicar la consulta.
import { z } from "zod";
import type { FastifyRequest } from "fastify";
import type { Route } from "../../lib/http.js";
import { zDate, zId } from "../../lib/http.js";
import type { Db } from "../../lib/db.js";
import { withTenant } from "../../lib/db.js";
import type { Client } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { AppError } from "../../lib/errors.js";
import { allowedBranches, type AuthCtx } from "../../lib/rbac.js";
import { patientsWithoutNextAppointment, productionByDentist, resolveRange } from "../reports.js";
import { branchResults } from "../fees.js";
import { addSheet, bsCell, newWorkbook, sendXlsx } from "./xlsx.js";
import { DateTime } from "luxon";

/** Pide la ruta de la pantalla con la sesión de quien exporta y devuelve su JSON. */
export async function screenData<T = any>(req: FastifyRequest, url: string, query: Record<string, unknown> = {}): Promise<T> {
  const params = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== null && v !== "") params.set(k, String(v));
  const qs = params.toString();
  const r = await req.server.inject({ method: "GET", url: qs ? `${url}?${qs}` : url, headers: { cookie: req.headers.cookie ?? "" } });
  let body: any = null;
  try { body = r.json(); } catch { body = null; }
  if (r.statusCode !== 200) throw new AppError(r.statusCode, body?.error?.code ?? "export_failed", body?.error?.message ?? "No se pudo generar el informe");
  return body as T;
}

async function auditExport(db: Db, auth: AuthCtx, entity: string, data: Record<string, unknown>) {
  await withTenant(db.appPool, { clinicId: auth.clinicId, userId: auth.userId }, (c) => audit(c, auth, "report.exported", entity, null, data));
}

const dt = (v: string | Date | null | undefined, zone = "America/La_Paz") => (v ? DateTime.fromJSDate(new Date(v)).setZone(zone).toFormat("yyyy-MM-dd HH:mm") : "");

/** Pacientes sin próxima cita: lista completa (la pantalla muestra 20 por profesional + "y N más"). Misma consulta base. */
async function patientsWithoutNextDetail(c: Client, auth: AuthCtx, months: number) {
  return (await c.query(
    `WITH last AS (
       SELECT DISTINCT ON (a.patient_id) a.patient_id, a.dentist_id, a.starts_at
         FROM appointments a WHERE a.status = 'completed' AND a.starts_at > now() - make_interval(months => $1)
          AND ($2::uuid[] IS NULL OR a.branch_id = ANY($2))
        ORDER BY a.patient_id, a.starts_at DESC)
     SELECT u.full_name AS dentist, p.record_number, p.first_name || ' ' || p.last_name AS name, p.phone, l.starts_at AS last_visit
       FROM last l JOIN patients p ON p.id = l.patient_id AND p.archived_at IS NULL JOIN users u ON u.id = l.dentist_id
      WHERE NOT EXISTS (SELECT 1 FROM appointments f WHERE f.patient_id = l.patient_id AND f.starts_at > now() AND f.status NOT IN ('cancelled','no_show'))
      ORDER BY u.full_name, l.starts_at`, [months, allowedBranches(auth)])).rows;
}

export function exportRoutes(route: Route) {
  // ---------------- Reportes: producción por profesional ----------------
  route({
    method: "GET", url: "/api/reports/production-by-dentist.xlsx", summary: "Exportar a Excel la producción y comisión estimada por profesional (mismo rango que la pantalla)", tags: ["reportes"],
    perm: "reports.financial", query: z.object({ from: zDate.optional(), to: zDate.optional() }), raw: true,
    handler: async ({ c, auth, query, reply }) => {
      const range = await resolveRange(c, auth, query.from, query.to);
      const rows = await productionByDentist(c, auth, query.from, query.to);
      const wb = newWorkbook();
      const toIncl = DateTime.fromISO(range.toDateExclusive).minus({ days: 1 }).toISODate();
      addSheet(wb, "Producción", [{ header: "Profesional", width: 30 }, { header: "Tratamientos", width: 12 }, { header: "Producción (Bs)", money: true }, { header: "% comisión", width: 11 }, { header: "Comisión estimada (Bs)", money: true }],
        rows.map((x) => [x.dentistName, x.treatments, bsCell(Number(x.productionCents)), x.commissionPct != null ? Number(x.commissionPct) : null, bsCell(x.commissionCents)]),
        { title: `Producción por profesional · ${range.fromDate} a ${toIncl}`,
          totals: ["Total", rows.reduce((s, x) => s + Number(x.treatments), 0), bsCell(rows.reduce((s, x) => s + Number(x.productionCents), 0)), "", bsCell(rows.reduce((s, x) => s + Number(x.commissionCents ?? 0), 0))],
          notes: ["La comisión es una estimación (producción × % del profesional). La liquidación definitiva está en Honorarios."] });
      await audit(c, auth, "report.exported", "production_by_dentist", null, { from: range.fromDate, to: toIncl });
      await sendXlsx(reply, wb, `produccion-por-profesional-${range.fromDate}`);
    },
  });

  // ---------------- Reportes: cuentas por cobrar ----------------
  route({
    method: "GET", url: "/api/reports/receivables.xlsx", summary: "Exportar a Excel las cuentas por cobrar por paciente (los mismos datos de la pantalla)", tags: ["reportes"],
    perm: "reports.financial", raw: true, noTx: true,
    handler: async ({ req, db, auth, reply }) => {
      const rows = await screenData<any[]>(req, "/api/reports/receivables");
      const wb = newWorkbook();
      addSheet(wb, "Cuentas por cobrar", [{ header: "Paciente", width: 34 }, { header: "Celular", width: 16 }, { header: "Saldo (Bs)", money: true }, { header: "Último pago", width: 18 }],
        rows.map((x) => [x.name, x.phone, bsCell(Number(x.balanceCents)), x.lastPaymentAt ? dt(x.lastPaymentAt) : "Nunca"]),
        { title: "Cuentas por cobrar", totals: ["Total", "", bsCell(rows.reduce((s, x) => s + Number(x.balanceCents), 0)), ""] });
      await auditExport(db, auth, "receivables", { rows: rows.length });
      await sendXlsx(reply, wb, "cuentas-por-cobrar");
    },
  });

  // ---------------- Reportes: pacientes sin próxima cita ----------------
  route({
    method: "GET", url: "/api/reports/patients-without-next-appointment.xlsx", summary: "Exportar a Excel los pacientes atendidos sin próxima cita (resumen por profesional y lista completa)", tags: ["reportes"],
    perm: "reports.operational", query: z.object({ months: z.coerce.number().int().min(1).max(36).default(12) }), raw: true,
    handler: async ({ c, auth, query, reply }) => {
      const summary = await patientsWithoutNextAppointment(c, auth, query.months);
      const detail = await patientsWithoutNextDetail(c, auth, query.months);
      const wb = newWorkbook();
      addSheet(wb, "Por profesional", [{ header: "Profesional", width: 30 }, { header: "Pacientes", width: 12 }],
        summary.map((d: any) => [d.dentistName, d.patients]),
        { title: `Pacientes atendidos en los últimos ${query.months} meses sin próxima cita`, totals: ["Total", summary.reduce((s: number, d: any) => s + d.patients, 0)] });
      addSheet(wb, "Pacientes", [{ header: "Profesional", width: 30 }, { header: "N° de ficha", width: 11 }, { header: "Paciente", width: 32 }, { header: "Celular", width: 16 }, { header: "Última visita", width: 18 }],
        detail.map((x) => [x.dentist, Number(x.record_number), x.name, x.phone, dt(x.last_visit)]));
      await audit(c, auth, "report.exported", "patients_without_next_appointment", null, { months: query.months, rows: detail.length });
      await sendXlsx(reply, wb, "pacientes-sin-proxima-cita");
    },
  });

  // ---------------- Honorarios: resultado por sucursal ----------------
  route({
    method: "GET", url: "/api/fees/branch-results.xlsx", summary: "Exportar a Excel el resultado por sucursal con consolidado y período anterior (mismo rango que la pantalla)", tags: ["honorarios", "reportes"],
    perm: "reports.financial", query: z.object({ from: zDate.optional(), to: zDate.optional() }), raw: true,
    handler: async ({ c, auth, query, reply }) => {
      const r = await branchResults(c, auth, query.from, query.to);
      const keys: [string, string][] = [["collectedCents", "Cobrado (confirmado)"], ["pendingVerificationCents", "Por verificar en el banco"], ["productionCents", "Producción"],
        ["feesCents", "Honorarios liquidados"], ["pettyExpensesCents", "Gastos menores de caja"], ["resultCents", "Resultado (cobrado − honorarios − gastos)"]];
      const wb = newWorkbook();
      addSheet(wb, "Resultado", [{ header: "Concepto", width: 40 }, ...r.branches.map((b) => ({ header: b.branchName, money: true })), { header: "Consolidado", money: true }, { header: "Período anterior", money: true }],
        keys.map(([k, label]) => [label, ...r.branches.map((b: any) => bsCell(b[k])), bsCell((r.total as any)[k]), bsCell((r.previousTotal as any)[k])]),
        { title: `Resultado por sucursal · ${r.range.from} a ${r.range.to} (anterior: ${r.previousRange.from} a ${r.previousRange.to})`,
          notes: [`Honorarios: solo de liquidaciones cerradas cuyo período cae dentro de las fechas (${r.closedSettlements}).`] });
      await audit(c, auth, "report.exported", "branch_results", null, { from: r.range.from, to: r.range.to });
      await sendXlsx(reply, wb, `resultado-por-sucursal-${r.range.from}`);
    },
  });

  // ---------------- Controles (volver a citar) ----------------
  const zRecalls = z.object({
    branchId: zId.optional(), month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, "Mes inválido (AAAA-MM)").optional(),
    status: z.enum(["active", "all", "pending", "scheduled", "done", "dismissed", "review"]).optional(),
    priority: z.enum(["low", "normal", "high"]).optional(), overdue: z.enum(["1", "0"]).optional(), q: z.string().trim().max(80).optional(),
  });
  route({
    method: "GET", url: "/api/recalls.xlsx", summary: "Exportar a Excel la cola de controles con los mismos filtros de la pantalla (sucursal, mes, estado, prioridad, búsqueda)", tags: ["controles"],
    perm: "agenda.read", query: zRecalls, raw: true, noTx: true,
    handler: async ({ req, db, auth, query, reply }) => {
      const d = await screenData<any>(req, "/api/recalls", query);
      const PRIORITY: Record<string, string> = { high: "Alta", normal: "Normal", low: "Baja" };
      const wb = newWorkbook();
      addSheet(wb, "Controles", [
        { header: "Vence", width: 12 }, { header: "Paciente", width: 30 }, { header: "Celular", width: 16 }, { header: "Sucursal" }, { header: "Motivo", width: 28 },
        { header: "Profesional", width: 24 }, { header: "Prioridad", width: 10 }, { header: "Estado", width: 14 }, { header: "Intentos", width: 9 }, { header: "Cita", width: 18 },
      ], d.items.map((x: any) => [x.dueDate, x.patientName, x.patientPhone, x.branchName, x.reason ?? x.procedureName, x.dentistName, PRIORITY[x.priority] ?? x.priority,
        x.statusLabel, x.attempts, x.appointmentStartsAt ? dt(x.appointmentStartsAt) : ""]),
      { title: `Controles · ${d.month}`, totals: [`Total: ${d.items.length}`],
        notes: [`Vencen esta semana: ${d.counters.dueThisWeek} · Atrasados: ${d.counters.overdue} · Agendados del mes: ${d.counters.scheduled} · Conversión: ${d.counters.conversion.pct ?? "—"} % (${d.counters.conversion.numerator}/${d.counters.conversion.denominator}).`] });
      await auditExport(db, auth, "recalls", { ...query, rows: d.items.length });
      await sendXlsx(reply, wb, `controles-${d.month}`);
    },
  });

  // ---------------- Presupuestos: embudo ----------------
  route({
    method: "GET", url: "/api/budget-funnel.xlsx", summary: "Exportar a Excel el embudo de presupuestos (bandejas y conversión) con los mismos filtros de la pantalla", tags: ["presupuestos"],
    perm: "budgets.read", query: z.object({ branchId: zId.optional(), days: z.coerce.number().int().min(7).max(365).optional() }), raw: true, noTx: true,
    handler: async ({ req, db, auth, query, reply }) => {
      const d = await screenData<any>(req, "/api/budget-funnel", query);
      const BUCKETS: [string, string][] = [["presentedNoResponse", "Presentado sin respuesta"], ["acceptedNoAppointment", "Aceptado sin cita"], ["inProgressNoNext", "En curso sin próxima cita"], ["expired", "Vencido"]];
      const rows = BUCKETS.flatMap(([k, label]) => (d.buckets[k] as any[]).map((b) => [label, Number(b.number), b.patientName, b.phone, b.branchName, b.dentistName, bsCell(b.totalCents), b.daysInState]));
      const total = BUCKETS.reduce((s, [k]) => s + (d.buckets[k] as any[]).reduce((t, b) => t + Number(b.totalCents), 0), 0);
      const wb = newWorkbook();
      addSheet(wb, "Bandejas", [{ header: "Bandeja", width: 26 }, { header: "N°", width: 8 }, { header: "Paciente", width: 30 }, { header: "Celular", width: 16 }, { header: "Sucursal" },
        { header: "Profesional", width: 24 }, { header: "Total (Bs)", money: true }, { header: "Días en el estado", width: 14 }], rows,
        { title: "Embudo de presupuestos", totals: ["Total", "", "", "", "", "", bsCell(total), ""] });
      const cv = d.conversion;
      addSheet(wb, "Conversión", [{ header: "Indicador", width: 40 }, { header: "Valor", width: 16 }], [
        ["Presentados", cv.presented], ["Aceptados", cv.accepted], ["Rechazados", cv.rejected], ["Abiertos", cv.open], ["Aceptados en línea", cv.acceptedOnline],
        ["Monto presentado (Bs)", bsCell(cv.presentedCents)], ["Monto aceptado (Bs)", bsCell(cv.acceptedCents)], ["Conversión (%)", cv.conversionPct],
      ], { title: `Últimos ${d.periodDays} días` });
      await auditExport(db, auth, "budget_funnel", { ...query, rows: rows.length });
      await sendXlsx(reply, wb, "embudo-presupuestos");
    },
  });

  // ---------------- Caja: historial de cajas ----------------
  route({
    method: "GET", url: "/api/cash-sessions.xlsx", summary: "Exportar a Excel el historial de cajas (mismos filtros y alcance que la pantalla)", tags: ["caja"],
    perm: "payments.read", raw: true, noTx: true,
    query: z.object({ branchId: zId.optional(), status: z.enum(["open", "closed"]).optional(), from: zDate.optional(), to: zDate.optional(), cashierId: zId.optional() }),
    handler: async ({ req, db, auth, query, reply }) => {
      const rows = await screenData<any[]>(req, "/api/cash-sessions", query);
      const sum = (k: string) => rows.reduce((s, x) => s + Number(x[k] ?? 0), 0);
      const wb = newWorkbook();
      addSheet(wb, "Cajas", [
        { header: "N°", width: 7 }, { header: "Sucursal" }, { header: "Cajero", width: 26 }, { header: "Estado", width: 10 }, { header: "Apertura", width: 18 }, { header: "Cierre", width: 18 },
        { header: "Fondo inicial", money: true }, { header: "Cobros en efectivo", money: true }, { header: "Esperado", money: true }, { header: "Contado", money: true }, { header: "Diferencia", money: true },
        { header: "Motivo de la diferencia", width: 30 },
      ], rows.map((x) => [Number(x.number), x.branchName, x.cashierName, x.status === "open" ? "Abierta" : "Cerrada", dt(x.openedAt), dt(x.closedAt),
        bsCell(x.openingFloatCents), bsCell(x.cashInCents), bsCell(x.expectedCents ?? x.liveExpectedCents), bsCell(x.countedCents), bsCell(x.differenceCents), x.closeNote]),
      { title: "Historial de cajas", totals: ["Total", "", "", "", "", "", bsCell(sum("openingFloatCents")), bsCell(sum("cashInCents")), "", bsCell(sum("countedCents")), bsCell(sum("differenceCents")), ""],
        notes: ["En una caja abierta, «Esperado» es el valor al momento de exportar."] });
      await auditExport(db, auth, "cash_sessions", { ...query, rows: rows.length });
      await sendXlsx(reply, wb, "historial-de-cajas");
    },
  });

  // ---------------- Inventario: stock y valor ----------------
  route({
    method: "GET", url: "/api/inventory/stock.xlsx", summary: "Exportar a Excel el stock por insumo con su valor (misma sucursal o consolidado que la pantalla)", tags: ["inventario"],
    perm: "inventory.read", query: z.object({ branchId: zId.optional(), all: z.string().max(1).optional() }), raw: true, noTx: true,
    handler: async ({ req, db, auth, query, reply }) => {
      const d = await screenData<any>(req, "/api/inventory/stock", query);
      const wb = newWorkbook();
      addSheet(wb, "Stock", [
        { header: "SKU", width: 12 }, { header: "Insumo", width: 32 }, { header: "Categoría" }, { header: "Unidad", width: 10 }, { header: "Stock", fmt: "0.###", width: 10 },
        { header: "Mínimo", fmt: "0.###", width: 10 }, { header: "En tránsito", fmt: "0.###", width: 11 }, { header: "Próximo vencimiento", width: 18 }, { header: "Valor (Bs)", money: true }, { header: "Alertas", width: 30 },
      ], d.items.map((x: any) => [x.sku, x.name, x.category, x.useUnit, Number(x.qty), Number(x.minQty), Number(x.inTransit), x.nextExpiry ?? "", bsCell(Number(x.valueCents)),
        (x.alerts as any[]).map((a) => (a.type === "below_min" ? "Bajo mínimo" : a.type === "expired" ? "Vencido" : a.type === "expiring" ? `Vence en ${a.bucket} días` : "Consumo pendiente")).join(", ")]),
      { title: `Stock al ${d.today}`, totals: ["Total", "", "", "", "", "", "", "", bsCell(d.items.reduce((s: number, x: any) => s + Number(x.valueCents), 0)), ""] });
      await auditExport(db, auth, "inventory_stock", { ...query, rows: d.items.length });
      await sendXlsx(reply, wb, `stock-${d.today}`);
    },
  });
}
