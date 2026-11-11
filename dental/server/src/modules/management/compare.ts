// Panel con rango libre de fechas y comparación con el período anterior (B-017).
// Reutiliza dashboardData() del panel actual: los números del rango son exactamente los del Panel.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Client } from "../../lib/db.js";
import type { Route } from "../../lib/http.js";
import { zDate } from "../../lib/http.js";
import type { AuthCtx } from "../../lib/rbac.js";
import { audit } from "../../lib/audit.js";
import { dashboardData, resolveRange } from "../reports.js";
import { pctChange } from "./common.js";
import { addSheet, bsCell, newWorkbook, sendXlsx } from "./xlsx.js";

/**
 * Período anterior de igual tamaño: si el rango son meses calendario completos, los meses
 * anteriores (octubre → septiembre); si no, la misma cantidad de días justo antes.
 */
export function previousPeriod(fromDate: string, toDateInclusive: string): { from: string; to: string } {
  const f = DateTime.fromISO(fromDate);
  const tEx = DateTime.fromISO(toDateInclusive).plus({ days: 1 });
  if (f.day === 1 && tEx.day === 1) {
    const months = Math.round(tEx.diff(f, "months").months);
    return { from: f.minus({ months }).toISODate()!, to: f.minus({ days: 1 }).toISODate()! };
  }
  const days = Math.round(tEx.diff(f, "days").days);
  return { from: f.minus({ days }).toISODate()!, to: f.minus({ days: 1 }).toISODate()! };
}

const ppDiff = (a: number | null, b: number | null) => (a == null || b == null ? null : Math.round((a - b) * 10) / 10);

export async function dashboardCompare(c: Client, auth: AuthCtx, from?: string, to?: string) {
  const range = await resolveRange(c, auth, from, to);
  const toIncl = DateTime.fromISO(range.toDateExclusive).minus({ days: 1 }).toISODate()!;
  const prev = previousPeriod(range.fromDate, toIncl);
  const current = await dashboardData(c, auth, range.fromDate, toIncl);
  const previous = await dashboardData(c, auth, prev.from, prev.to);
  const fin = current.financial;
  const branches = current.branches.map((b) => {
    const p = previous.branches.find((x) => x.branchId === b.branchId);
    const bb = b as typeof b & { collectedCents?: number; productionCents?: number };
    const pp = p as (typeof b & { collectedCents?: number; productionCents?: number }) | undefined;
    return {
      branchId: b.branchId, branchName: b.branchName,
      current: { appointments: b.appointments, completed: b.completed, noShowRate: b.noShowRate, occupancyPct: b.occupancyPct, ...(fin ? { collectedCents: bb.collectedCents, productionCents: bb.productionCents } : {}) },
      previous: { appointments: p?.appointments ?? 0, completed: p?.completed ?? 0, noShowRate: p?.noShowRate ?? null, occupancyPct: p?.occupancyPct ?? null, ...(fin ? { collectedCents: pp?.collectedCents ?? 0, productionCents: pp?.productionCents ?? 0 } : {}) },
      variation: {
        appointmentsPct: pctChange(b.appointments, p?.appointments ?? 0),
        completedPct: pctChange(b.completed, p?.completed ?? 0),
        noShowRatePp: ppDiff(b.noShowRate, p?.noShowRate ?? null),
        occupancyPp: ppDiff(b.occupancyPct, p?.occupancyPct ?? null),
        ...(fin ? { collectedPct: pctChange(bb.collectedCents, pp?.collectedCents ?? 0), productionPct: pctChange(bb.productionCents, pp?.productionCents ?? 0) } : {}),
      },
    };
  });
  const ct = current.totals as typeof current.totals & { collectedCents?: number; productionCents?: number };
  const pt = previous.totals as typeof previous.totals & { collectedCents?: number; productionCents?: number };
  return {
    financial: fin,
    range: current.range,
    previousRange: { from: prev.from, to: prev.to },
    branches,
    totals: {
      current: ct, previous: pt,
      variation: {
        appointmentsPct: pctChange(ct.appointments, pt.appointments), completedPct: pctChange(ct.completed, pt.completed), newPatientsPct: pctChange(ct.newPatients, pt.newPatients),
        ...(fin ? { collectedPct: pctChange(ct.collectedCents, pt.collectedCents), productionPct: pctChange(ct.productionCents, pt.productionCents) } : {}),
      },
    },
  };
}

const zRange = z.object({ from: zDate.optional(), to: zDate.optional() });

async function dashboardXlsx(c: Client, auth: AuthCtx, from: string | undefined, to: string | undefined) {
  const d = await dashboardData(c, auth, from, to);
  const cmp = await dashboardCompare(c, auth, from, to);
  const fin = d.financial;
  const wb = newWorkbook();
  const t = d.totals as typeof d.totals & { collectedCents?: number; productionCents?: number; pendingVerificationCents?: number };
  addSheet(wb, "Panel por sucursal", [
    { header: "Sucursal", width: 24 },
    ...(fin ? [{ header: "Cobrado (Bs)", money: true }, { header: "Producción (Bs)", money: true }, { header: "Por verificar (Bs)", money: true }] : []),
    { header: "Citas", width: 10 }, { header: "Atendidas", width: 10 }, { header: "Canceladas", width: 10 }, { header: "No asistieron", width: 12 },
    { header: "% inasistencia", width: 12 }, { header: "% ocupación", width: 12 },
  ], d.branches.map((b: any) => [b.branchName, ...(fin ? [bsCell(b.collectedCents), bsCell(b.productionCents), bsCell(b.pendingVerificationCents)] : []),
    b.appointments, b.completed, b.cancelled, b.noShow, b.noShowRate, b.occupancyPct]),
  { title: `Panel · ${d.range.from} a ${d.range.to}`,
    totals: ["Total", ...(fin ? [bsCell(t.collectedCents), bsCell(t.productionCents), bsCell(t.pendingVerificationCents)] : []), t.appointments, t.completed, t.cancelled, t.noShow, "", ""],
    notes: [`Pacientes nuevos en el período: ${t.newPatients}.`] });
  addSheet(wb, "Comparación", [
    { header: "Sucursal", width: 24 },
    ...(fin ? [{ header: "Cobrado", money: true }, { header: "Cobrado anterior", money: true }, { header: "Var. cobrado %", fmt: "0.0" },
      { header: "Producción", money: true }, { header: "Producción anterior", money: true }, { header: "Var. producción %", fmt: "0.0" }] : []),
    { header: "Citas", width: 10 }, { header: "Citas anterior", width: 12 }, { header: "Var. citas %", fmt: "0.0" },
    { header: "Ocupación (pp)", fmt: "0.0" }, { header: "Inasistencia (pp)", fmt: "0.0" },
  ], cmp.branches.map((b: any) => [b.branchName,
    ...(fin ? [bsCell(b.current.collectedCents), bsCell(b.previous.collectedCents), b.variation.collectedPct, bsCell(b.current.productionCents), bsCell(b.previous.productionCents), b.variation.productionPct] : []),
    b.current.appointments, b.previous.appointments, b.variation.appointmentsPct, b.variation.occupancyPp, b.variation.noShowRatePp]),
  { title: `${cmp.range.from} a ${cmp.range.to} frente a ${cmp.previousRange.from} a ${cmp.previousRange.to}`,
    notes: ["Variación vacía = sin base de comparación (el período anterior fue cero).", "pp = puntos porcentuales."] });
  return { wb, d };
}

export function compareRoutes(route: Route) {
  route({
    method: "GET", url: "/api/reports/dashboard-compare", summary: "Panel con rango libre y comparación con el período anterior de igual tamaño (variación % por sucursal)", tags: ["reportes"],
    perm: "reports.operational", query: zRange,
    handler: async ({ c, auth, query }) => dashboardCompare(c, auth, query.from, query.to),
  });
  // Contabilidad solo tiene reports.financial (igual que /api/reports/finance-dashboard).
  route({
    method: "GET", url: "/api/reports/finance-dashboard-compare", summary: "Comparación financiera con el período anterior (para contabilidad)", tags: ["reportes"],
    perm: "reports.financial", query: zRange,
    handler: async ({ c, auth, query }) => dashboardCompare(c, auth, query.from, query.to),
  });
  for (const [url, perm] of [["/api/reports/dashboard.xlsx", "reports.operational"], ["/api/reports/finance-dashboard.xlsx", "reports.financial"]] as const) {
    route({
      method: "GET", url, summary: "Exportar a Excel el panel por sucursal y la comparación con el período anterior (mismo rango que la pantalla)", tags: ["reportes"],
      perm, query: zRange, raw: true,
      handler: async ({ c, auth, query, reply }) => {
        const { wb, d } = await dashboardXlsx(c, auth, query.from, query.to);
        await audit(c, auth, "report.exported", "dashboard", null, { from: d.range.from, to: d.range.to });
        await sendXlsx(reply, wb, `panel-${d.range.from}-a-${d.range.to}`);
      },
    });
  }
}
