// Fichaje del personal por sucursal (R2-41): entrada y salida desde el celular, marcas de solo
// inserción, correcciones de gerencia con motivo (nueva fila) e informe mensual de horas.
// Sin geolocalización: la marca guarda solo persona, sucursal y hora del servidor.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../../lib/http.js";
import { zId, zIdParams } from "../../lib/http.js";
import type { Client } from "../../lib/db.js";
import { audit } from "../../lib/audit.js";
import { AppError, conflict, forbidden, notFound } from "../../lib/errors.js";
import { allowedBranches, requireBranch, ROLE_LABELS, type AuthCtx, type Role } from "../../lib/rbac.js";
import { clinicZone } from "../agenda.js";
import { monthRange, zMonth } from "./common.js";
import { addSheet, newWorkbook, sendXlsx } from "./xlsx.js";

/** Un turno de más de estas horas no se suma: casi siempre es una salida olvidada. */
export const MAX_SHIFT_HOURS = 16;

export interface Punch { id: string; userId: string; branchId: string; kind: "in" | "out"; at: Date }
export interface Shift { userId: string; branchId: string; inId: string; outId: string; start: Date; end: Date; minutes: number }
export interface Issue { userId: string; branchId: string; entryId: string; at: Date; type: "missing_out" | "missing_in" | "branch_mismatch" | "too_long"; label: string }

const ISSUE_LABELS: Record<Issue["type"], string> = {
  missing_out: "Entrada sin salida",
  missing_in: "Salida sin entrada",
  branch_mismatch: "Entrada y salida en sucursales distintas",
  too_long: `Turno de más de ${MAX_SHIFT_HOURS} h (no se suma: revisar)`,
};

/**
 * Empareja las marcas vigentes (ya sin las anuladas) de cada persona en orden de hora.
 * Devuelve los turnos completos y lo que hay que revisar. Una entrada abierta reciente
 * (menos de MAX_SHIFT_HOURS) se informa como "en curso", no como problema.
 */
export function pairPunches(punches: Punch[], now: Date = new Date()): { shifts: Shift[]; issues: Issue[]; open: Punch[] } {
  const byUser = new Map<string, Punch[]>();
  for (const p of punches) byUser.set(p.userId, [...(byUser.get(p.userId) ?? []), p]);
  const shifts: Shift[] = [], issues: Issue[] = [], open: Punch[] = [];
  const issue = (p: Punch, type: Issue["type"]) => issues.push({ userId: p.userId, branchId: p.branchId, entryId: p.id, at: p.at, type, label: ISSUE_LABELS[type] });
  for (const list of byUser.values()) {
    list.sort((a, b) => +a.at - +b.at || (a.kind === b.kind ? 0 : a.kind === "in" ? -1 : 1));
    let cur: Punch | null = null;
    for (const p of list) {
      if (p.kind === "in") {
        if (cur) issue(cur, "missing_out");
        cur = p;
        continue;
      }
      if (!cur) { issue(p, "missing_in"); continue; }
      if (cur.branchId !== p.branchId) { issue(cur, "branch_mismatch"); issue(p, "branch_mismatch"); cur = null; continue; }
      const minutes = Math.round((+p.at - +cur.at) / 60_000);
      if (minutes > MAX_SHIFT_HOURS * 60) issue(cur, "too_long");
      else shifts.push({ userId: p.userId, branchId: p.branchId, inId: cur.id, outId: p.id, start: cur.at, end: p.at, minutes });
      cur = null;
    }
    if (cur) {
      if (+now - +cur.at < MAX_SHIFT_HOURS * 3_600_000) open.push(cur);
      else issue(cur, "missing_out");
    }
  }
  return { shifts, issues, open };
}

/** Marcas vigentes (sin las anuladas) entre dos instantes. */
async function effectivePunches(c: Client, from: Date, to: Date, opts: { userId?: string | null; branches?: string[] | null; branchId?: string | null } = {}): Promise<Punch[]> {
  const rows = (await c.query<{ id: string; user_id: string; branch_id: string; kind: "in" | "out"; at: Date }>(
    `SELECT t.id, t.user_id, t.branch_id, t.kind, t.at FROM time_entries t
      WHERE t.kind IN ('in','out') AND t.at >= $1 AND t.at < $2
        AND ($3::uuid IS NULL OR t.user_id = $3) AND ($4::uuid[] IS NULL OR t.branch_id = ANY($4)) AND ($5::uuid IS NULL OR t.branch_id = $5)
        AND NOT EXISTS (SELECT 1 FROM time_entries v WHERE v.voids_entry_id = t.id)
      ORDER BY t.at`, [from, to, opts.userId ?? null, opts.branches ?? null, opts.branchId ?? null])).rows;
  return rows.map((r) => ({ id: r.id, userId: r.user_id, branchId: r.branch_id, kind: r.kind, at: r.at }));
}

async function myState(c: Client, auth: AuthCtx) {
  const zone = await clinicZone(c, auth.clinicId!);
  const enabled = !!(await c.query<{ enabled: boolean }>("SELECT enabled FROM timeclock_staff WHERE user_id = $1 AND enabled", [auth.userId])).rows[0];
  const allowed = allowedBranches(auth);
  const branches = (await c.query<{ id: string; name: string }>(
    "SELECT id, name FROM branches WHERE active AND ($1::uuid[] IS NULL OR id = ANY($1)) ORDER BY code", [allowed])).rows;
  const now = DateTime.now().setZone(zone);
  const punches = await effectivePunches(c, now.minus({ hours: MAX_SHIFT_HOURS + 24 }).toJSDate(), new Date(Date.now() + 60_000), { userId: auth.userId });
  const { open, shifts } = pairPunches(punches);
  const o = open[0] ?? null;
  const dayStart = now.startOf("day").toJSDate();
  const todayMinutes = shifts.filter((s) => s.start >= dayStart).reduce((s, x) => s + x.minutes, 0);
  const todayEntries = (await c.query(
    `SELECT t.id, t.kind, t.at, t.source, b.name AS "branchName",
            EXISTS (SELECT 1 FROM time_entries v WHERE v.voids_entry_id = t.id) AS voided
       FROM time_entries t JOIN branches b ON b.id = t.branch_id
      WHERE t.user_id = $1 AND t.kind IN ('in','out') AND t.at >= $2 ORDER BY t.at`, [auth.userId, dayStart])).rows;
  return {
    enabled, branches,
    open: o ? { entryId: o.id, branchId: o.branchId, branchName: branches.find((b) => b.id === o.branchId)?.name ?? "", at: o.at } : null,
    todayMinutes, todayEntries,
  };
}

export async function hoursReport(c: Client, auth: AuthCtx, q: { month?: string; branchId?: string; userId?: string }) {
  if (q.branchId) requireBranch(auth, q.branchId);
  const range = await monthRange(c, auth, q.month);
  const allowed = allowedBranches(auth);
  // Se leen un día antes y después para emparejar turnos que cruzan el límite del mes;
  // cada turno cuenta en el mes de su entrada.
  const punches = await effectivePunches(c, DateTime.fromJSDate(range.from).minus({ days: 1 }).toJSDate(), DateTime.fromJSDate(range.to).plus({ days: 1 }).toJSDate(),
    { branches: allowed, branchId: q.branchId ?? null, userId: q.userId ?? null });
  const { shifts: all, issues: allIssues, open } = pairPunches(punches);
  const inMonth = (d: Date) => d >= range.from && d < range.to;
  const shifts = all.filter((s) => inMonth(s.start));
  const issues = allIssues.filter((i) => inMonth(i.at));
  const people = new Map((await c.query<{ user_id: string; full_name: string; role: Role }>(
    "SELECT m.user_id, u.full_name, m.role FROM memberships m JOIN users u ON u.id = m.user_id")).rows.map((r) => [r.user_id, r]));
  const branchNames = new Map((await c.query<{ id: string; name: string }>("SELECT id, name FROM branches")).rows.map((r) => [r.id, r.name]));
  const key = (u: string, b: string) => `${u}|${b}`;
  const agg = new Map<string, { userId: string; branchId: string; minutes: number; shifts: number; days: Set<string>; issues: number }>();
  const get = (u: string, b: string) => {
    const k = key(u, b);
    if (!agg.has(k)) agg.set(k, { userId: u, branchId: b, minutes: 0, shifts: 0, days: new Set(), issues: 0 });
    return agg.get(k)!;
  };
  for (const s of shifts) {
    const a = get(s.userId, s.branchId);
    a.minutes += s.minutes; a.shifts++; a.days.add(DateTime.fromJSDate(s.start).setZone(range.zone).toISODate()!);
  }
  for (const i of issues) get(i.userId, i.branchId).issues++;
  const rows = [...agg.values()].map((a) => ({
    userId: a.userId, fullName: people.get(a.userId)?.full_name ?? "—", roleLabel: ROLE_LABELS[people.get(a.userId)?.role ?? "support"],
    branchId: a.branchId, branchName: branchNames.get(a.branchId) ?? "—",
    days: a.days.size, shifts: a.shifts, minutes: a.minutes, hours: Math.round((a.minutes / 60) * 100) / 100, issues: a.issues,
  })).sort((x, y) => x.fullName.localeCompare(y.fullName, "es") || x.branchName.localeCompare(y.branchName, "es"));
  const fmt = (d: Date) => DateTime.fromJSDate(d).setZone(range.zone).toFormat("yyyy-MM-dd HH:mm");
  return {
    month: range.month, label: range.label, from: range.fromDate, to: range.toDate,
    rows,
    totals: { minutes: rows.reduce((s, r) => s + r.minutes, 0), hours: Math.round((rows.reduce((s, r) => s + r.minutes, 0) / 60) * 100) / 100, shifts: shifts.length, issues: issues.length },
    shifts: shifts.map((s) => ({ ...s, fullName: people.get(s.userId)?.full_name ?? "—", branchName: branchNames.get(s.branchId) ?? "—", startLocal: fmt(s.start), endLocal: fmt(s.end) }))
      .sort((a, b) => +a.start - +b.start),
    issues: issues.map((i) => ({ ...i, fullName: people.get(i.userId)?.full_name ?? "—", branchName: branchNames.get(i.branchId) ?? "—", atLocal: fmt(i.at) })),
    openNow: open.filter((o) => inMonth(o.at)).map((o) => ({ userId: o.userId, fullName: people.get(o.userId)?.full_name ?? "—", branchName: branchNames.get(o.branchId) ?? "—", at: o.at })),
  };
}

const zReportQuery = z.object({ month: zMonth.optional(), branchId: zId.optional(), userId: zId.optional() });
const zReason = z.string().trim().min(5, "Escribe el motivo (mínimo 5 caracteres)").max(300);

export function timeclockRoutes(route: Route) {
  // ---------------- Personal: marcar la propia entrada y salida ----------------
  route({
    method: "GET", url: "/api/timeclock/me", summary: "Mi fichaje: si lo tengo activado, si estoy dentro (desde qué hora y en qué sucursal) y mis marcas de hoy", tags: ["fichaje"],
    perm: "timeclock.punch",
    handler: async ({ c, auth }) => myState(c, auth),
  });

  route({
    method: "POST", url: "/api/timeclock/punch", summary: "Marcar mi entrada o salida en una sucursal (hora del servidor; sin ubicación). No se edita: un error lo corrige gerencia", tags: ["fichaje"],
    perm: "timeclock.punch", body: z.object({ branchId: zId, kind: z.enum(["in", "out"]) }),
    handler: async ({ c, auth, body }) => {
      // Serializa las marcas de la persona (doble toque o dos teléfonos a la vez).
      const st = (await c.query<{ enabled: boolean }>("SELECT enabled FROM timeclock_staff WHERE user_id = $1 FOR UPDATE", [auth.userId])).rows[0];
      if (!st?.enabled) throw forbidden("El fichaje no está activado para ti. Pídelo a la gerencia.");
      requireBranch(auth, body.branchId);
      const cur = await myState(c, auth);
      const zone = await clinicZone(c, auth.clinicId!);
      const at = (d: Date) => DateTime.fromJSDate(new Date(d)).setZone(zone).toFormat("HH:mm");
      if (body.kind === "in" && cur.open) throw conflict(`Ya marcaste tu entrada a las ${at(cur.open.at)} en ${cur.open.branchName}. Marca primero tu salida.`, "already_in");
      if (body.kind === "out" && !cur.open) throw conflict("No tienes una entrada abierta. Si olvidaste marcarla, pide a la gerencia que la registre.", "not_in");
      if (body.kind === "out" && cur.open && cur.open.branchId !== body.branchId) {
        throw conflict(`Tu entrada está en ${cur.open.branchName}. Marca la salida en esa sucursal.`, "other_branch");
      }
      const id = (await c.query<{ id: string }>(
        "INSERT INTO time_entries (clinic_id, user_id, branch_id, kind, source, recorded_by) VALUES ($1,$2,$3,$4,'self',$2) RETURNING id",
        [auth.clinicId, auth.userId, body.branchId, body.kind])).rows[0]!.id;
      await audit(c, auth, body.kind === "in" ? "timeclock.in" : "timeclock.out", "time_entry", id, {}, body.branchId);
      return myState(c, auth);
    },
  });

  // ---------------- Gerencia: quién ficha, correcciones e informe ----------------
  route({
    method: "GET", url: "/api/timeclock/staff", summary: "Personal de la clínica con su fichaje activado o no", tags: ["fichaje"], perm: "staff.manage",
    handler: async ({ c, auth }) => {
      const allowed = allowedBranches(auth);
      const rows = (await c.query(
        `SELECT m.user_id AS "userId", u.full_name AS "fullName", m.role, m.all_branches AS "allBranches", m.branch_ids AS "branchIds",
                COALESCE(t.enabled, false) AS enabled
           FROM memberships m JOIN users u ON u.id = m.user_id LEFT JOIN timeclock_staff t ON t.user_id = m.user_id AND t.clinic_id = m.clinic_id
          WHERE m.active AND ($1::uuid[] IS NULL OR m.all_branches OR m.branch_ids && $1)
          ORDER BY u.full_name`, [allowed])).rows;
      return rows.map((r) => ({ ...r, roleLabel: ROLE_LABELS[r.role as Role] }));
    },
  });

  route({
    method: "PUT", url: "/api/timeclock/staff/:id", summary: "Activar o desactivar el fichaje de una persona (botón en su Inicio)", tags: ["fichaje"], perm: "staff.manage",
    params: zIdParams, body: z.object({ enabled: z.boolean() }),
    handler: async ({ c, auth, params, body }) => {
      const m = (await c.query<{ all_branches: boolean; branch_ids: string[] }>("SELECT all_branches, branch_ids FROM memberships WHERE user_id = $1 AND clinic_id = $2 AND active", [params.id, auth.clinicId])).rows[0];
      if (!m) throw notFound("Persona");
      const allowed = allowedBranches(auth);
      if (allowed && !m.all_branches && !m.branch_ids.some((b) => allowed.includes(b))) throw forbidden("Esa persona no trabaja en tus sucursales");
      await c.query(
        `INSERT INTO timeclock_staff (clinic_id, user_id, enabled, updated_by) VALUES ($1,$2,$3,$4)
         ON CONFLICT (clinic_id, user_id) DO UPDATE SET enabled = EXCLUDED.enabled, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [auth.clinicId, params.id, body.enabled, auth.userId]);
      await audit(c, auth, body.enabled ? "timeclock.enabled" : "timeclock.disabled", "membership", params.id, {});
      return { ok: true };
    },
  });

  route({
    method: "GET", url: "/api/timeclock/entries", summary: "Marcas del mes (incluye anuladas y correcciones, con quién y por qué)", tags: ["fichaje"], perm: "reports.financial",
    query: zReportQuery,
    handler: async ({ c, auth, query }) => {
      if (query.branchId) requireBranch(auth, query.branchId);
      const range = await monthRange(c, auth, query.month);
      const rows = (await c.query(
        `SELECT t.id, t.user_id AS "userId", u.full_name AS "fullName", t.branch_id AS "branchId", b.name AS "branchName", t.kind, t.at, t.source, t.reason,
                t.voids_entry_id AS "voidsEntryId", rb.full_name AS "recordedByName", t.recorded_at AS "recordedAt",
                v.id AS "voidedById", v.reason AS "voidReason", vu.full_name AS "voidedByName"
           FROM time_entries t JOIN users u ON u.id = t.user_id JOIN branches b ON b.id = t.branch_id JOIN users rb ON rb.id = t.recorded_by
           LEFT JOIN time_entries v ON v.voids_entry_id = t.id LEFT JOIN users vu ON vu.id = v.recorded_by
          WHERE t.kind IN ('in','out') AND t.at >= $1 AND t.at < $2
            AND ($3::uuid[] IS NULL OR t.branch_id = ANY($3)) AND ($4::uuid IS NULL OR t.branch_id = $4) AND ($5::uuid IS NULL OR t.user_id = $5)
          ORDER BY t.at DESC LIMIT 2000`,
        [range.from, range.to, allowedBranches(auth), query.branchId ?? null, query.userId ?? null])).rows;
      return { month: range.month, items: rows };
    },
  });

  route({
    method: "POST", url: "/api/timeclock/corrections", summary: "Corrección de gerencia: agregar una marca olvidada (entrada o salida) con motivo. Queda como registro nuevo", tags: ["fichaje"],
    perm: "staff.manage",
    body: z.object({ userId: zId, branchId: zId, kind: z.enum(["in", "out"]), at: z.iso.datetime({ offset: true, message: "Fecha y hora inválidas" }), reason: zReason }),
    handler: async ({ c, auth, body }) => {
      requireBranch(auth, body.branchId);
      const m = (await c.query("SELECT 1 FROM memberships WHERE user_id = $1 AND clinic_id = $2", [body.userId, auth.clinicId])).rows[0];
      if (!m) throw notFound("Persona");
      const at = new Date(body.at);
      if (+at > Date.now() + 60_000) throw new AppError(400, "validation", "La hora de la marca no puede ser futura", [{ path: "at", message: "Hora futura" }]);
      if (Date.now() - +at > 400 * 86_400_000) throw new AppError(400, "validation", "Solo se corrigen marcas de los últimos 400 días", [{ path: "at", message: "Demasiado antigua" }]);
      const id = (await c.query<{ id: string }>(
        "INSERT INTO time_entries (clinic_id, user_id, branch_id, kind, at, source, reason, recorded_by) VALUES ($1,$2,$3,$4,$5,'manager',$6,$7) RETURNING id",
        [auth.clinicId, body.userId, body.branchId, body.kind, at, body.reason, auth.userId])).rows[0]!.id;
      await audit(c, auth, "timeclock.correction_added", "time_entry", id, { userId: body.userId, kind: body.kind, at: body.at, reason: body.reason }, body.branchId);
      return { id };
    },
  });

  route({
    method: "POST", url: "/api/timeclock/entries/:id/void", summary: "Corrección de gerencia: anular una marca equivocada con motivo (se agrega una fila de anulación; la marca original se conserva)", tags: ["fichaje"],
    perm: "staff.manage", params: zIdParams, body: z.object({ reason: zReason }),
    handler: async ({ c, auth, params, body }) => {
      const e = (await c.query<{ user_id: string; branch_id: string; kind: string }>("SELECT user_id, branch_id, kind FROM time_entries WHERE id = $1", [params.id])).rows[0];
      if (!e || e.kind === "void") throw notFound("Marca");
      requireBranch(auth, e.branch_id);
      if ((await c.query("SELECT 1 FROM time_entries WHERE voids_entry_id = $1", [params.id])).rowCount) throw conflict("Esa marca ya estaba anulada", "already_voided");
      const id = (await c.query<{ id: string }>(
        "INSERT INTO time_entries (clinic_id, user_id, branch_id, kind, source, reason, voids_entry_id, recorded_by) VALUES ($1,$2,$3,'void','manager',$4,$5,$6) RETURNING id",
        [auth.clinicId, e.user_id, e.branch_id, body.reason, params.id, auth.userId])).rows[0]!.id;
      await audit(c, auth, "timeclock.entry_voided", "time_entry", params.id, { reason: body.reason, voidId: id }, e.branch_id);
      return { id };
    },
  });

  route({
    method: "GET", url: "/api/timeclock/report", summary: "Horas trabajadas del mes por persona y sucursal, con turnos y marcas por revisar", tags: ["fichaje"], perm: "reports.financial",
    query: zReportQuery,
    handler: async ({ c, auth, query }) => hoursReport(c, auth, query),
  });

  route({
    method: "GET", url: "/api/timeclock/report.xlsx", summary: "Exportar a Excel el informe mensual de horas (mismos filtros que la pantalla)", tags: ["fichaje"], perm: "reports.financial",
    query: zReportQuery, raw: true,
    handler: async ({ c, auth, query, reply }) => {
      const d = await hoursReport(c, auth, query);
      const wb = newWorkbook();
      addSheet(wb, "Horas", [
        { header: "Persona", width: 30 }, { header: "Rol" }, { header: "Sucursal" }, { header: "Días", width: 8 }, { header: "Turnos", width: 8 },
        { header: "Horas", fmt: "0.00", width: 10 }, { header: "Marcas por revisar", width: 18 },
      ], d.rows.map((r) => [r.fullName, r.roleLabel, r.branchName, r.days, r.shifts, r.hours, r.issues]),
      { title: `Horas trabajadas · ${d.label}`, totals: ["Total", "", "", "", d.totals.shifts, d.totals.hours, d.totals.issues],
        notes: [`Cada turno cuenta en el mes de su entrada. Un turno de más de ${MAX_SHIFT_HOURS} h no se suma y queda para revisar.`] });
      addSheet(wb, "Turnos", [{ header: "Persona", width: 30 }, { header: "Sucursal" }, { header: "Entrada", width: 18 }, { header: "Salida", width: 18 }, { header: "Horas", fmt: "0.00", width: 10 }],
        d.shifts.map((s) => [s.fullName, s.branchName, s.startLocal, s.endLocal, Math.round((s.minutes / 60) * 100) / 100]));
      addSheet(wb, "Por revisar", [{ header: "Persona", width: 30 }, { header: "Sucursal" }, { header: "Hora", width: 18 }, { header: "Problema", width: 40 }],
        d.issues.map((i) => [i.fullName, i.branchName, i.atLocal, i.label]));
      await audit(c, auth, "report.exported", "timeclock", null, { month: d.month, branchId: query.branchId ?? null });
      await sendXlsx(reply, wb, `horas-${d.month}`);
    },
  });
}
