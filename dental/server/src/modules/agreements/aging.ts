// Cuentas por cobrar generales con antigüedad (B-082): pacientes y empresas por separado, en tramos de
// 0–30, 31–60, 61–90 y más de 90 días, a una fecha de corte. La pantalla y el Excel usan la MISMA
// función, así los totales coinciden por construcción.
//
//  * Paciente: su saldo es el de patient_money (lo suyo de cada cargo + lo trasladado desde la empresa −
//    pagos confirmados). Para la antigüedad, cada anulación descuenta su propio cargo y cada reversión su
//    traslado; los pagos se aplican a lo más antiguo primero (FIFO). La suma de los tramos es el saldo.
//  * Empresa: por cargo, su porción viva (porción − anulaciones − traslados) menos lo pagado y confirmado;
//    la antigüedad es la del tratamiento. Los pagos por verificar no descuentan (como el estado de cuenta).
//  * Fecha de corte: se consideran los movimientos registrados hasta el fin de ese día (zona de la clínica).
//    El estado de los pagos (confirmado o anulado) es el actual.
import { z } from "zod";
import { DateTime } from "luxon";
import type { Route } from "../../lib/http.js";
import { zDate } from "../../lib/http.js";
import { badRequest } from "../../lib/errors.js";
import { audit } from "../../lib/audit.js";
import type { Client } from "../../lib/db.js";
import { hasAllBranches, type AuthCtx } from "../../lib/rbac.js";
import { clinicZone } from "../agenda.js";
import { addSheet, bsCell, newWorkbook, sendXlsx } from "../management/xlsx.js";
import { AGREEMENT_KINDS } from "./core.js";

export const BUCKETS = ["d0_30", "d31_60", "d61_90", "d90_plus"] as const;
export type Bucket = (typeof BUCKETS)[number];
export const BUCKET_LABELS: Record<Bucket, string> = { d0_30: "0 a 30 días", d31_60: "31 a 60 días", d61_90: "61 a 90 días", d90_plus: "Más de 90 días" };
type Buckets = Record<Bucket, number>;

/** Tramo según los días transcurridos (0–30, 31–60, 61–90, 91 o más). */
export function bucketOf(days: number): Bucket {
  if (days <= 30) return "d0_30";
  if (days <= 60) return "d31_60";
  if (days <= 90) return "d61_90";
  return "d90_plus";
}
const empty = (): Buckets => ({ d0_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0 });
const add = (a: Buckets, b: Buckets) => { for (const k of BUCKETS) a[k] += b[k]; return a; };
const sumOf = (b: Buckets) => BUCKETS.reduce((s, k) => s + b[k], 0);

interface Debit { key: string; date: string; cents: number }
type CompanyRow = Buckets & { agreementId: string; name: string; kindLabel: string; charges: number; patients: number; totalCents: number; oldestDays: number | null };

/** Aplica los créditos a los débitos más antiguos (FIFO) y devuelve lo que queda por tramo. */
export function ageDebits(asOf: string, debits: Debit[], credits: number): { buckets: Buckets; oldestDays: number | null } {
  const sorted = debits.filter((d) => d.cents > 0).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.key < b.key ? -1 : 1));
  let pool = credits;
  const out = empty();
  let oldest: number | null = null;
  const ref = DateTime.fromISO(asOf);
  for (const d of sorted) {
    const used = Math.min(pool, d.cents);
    pool -= used;
    const left = d.cents - used;
    if (left <= 0) continue;
    const days = Math.round(ref.diff(DateTime.fromISO(d.date), "days").days);
    out[bucketOf(days)] += left;
    if (oldest === null || days > oldest) oldest = days;
  }
  return { buckets: out, oldestDays: oldest };
}

export async function receivablesAging(c: Client, auth: AuthCtx, asOfIn?: string) {
  const zone = await clinicZone(c, auth.clinicId!);
  const today = DateTime.now().setZone(zone).toISODate()!;
  const asOf = asOfIn ?? today;
  if (asOf > today) throw badRequest("La fecha de corte no puede ser futura");
  const end = DateTime.fromISO(asOf, { zone }).plus({ days: 1 }).startOf("day").toJSDate();
  const local = (d: Date | string) => DateTime.fromJSDate(new Date(d)).setZone(zone).toISODate()!;

  // ---------------- Pacientes ----------------
  const charges = (await c.query<{ id: string; patient_id: string; created_at: Date; net: string; voids: string | null }>(
    `SELECT id, patient_id, created_at, (amount_cents - third_party_cents)::bigint AS net, voids_charge_id AS voids
       FROM charges WHERE created_at < $1`, [end])).rows;
  const transfers = (await c.query<{ id: string; patient_id: string; created_at: Date; amount_cents: string; reverses_id: string | null }>(
    "SELECT id, patient_id, created_at, amount_cents, reverses_id FROM payer_transfers WHERE created_at < $1", [end])).rows;
  // Saldos iniciales importados del sistema anterior (0021): la deuda envejece desde la fecha de corte
  // del sistema anterior; un saldo a favor cuenta como crédito. Así la suma de los tramos sigue siendo
  // el saldo de patient_money.
  const openings = (await c.query<{ id: string; patient_id: string; cutoff_date: string; amount_cents: string; voids_id: string | null }>(
    "SELECT id, patient_id, cutoff_date::text AS cutoff_date, amount_cents, voids_id FROM opening_balances WHERE created_at < $1", [end])).rows;
  const pays = (await c.query<{ patient_id: string; v: string }>(
    "SELECT patient_id, sum(amount_cents)::bigint AS v FROM payments WHERE status = 'confirmed' AND received_at < $1 GROUP BY patient_id", [end])).rows;
  const perPatient = new Map<string, { debits: Map<string, Debit>; credits: number }>();
  const pp = (id: string) => { let x = perPatient.get(id); if (!x) perPatient.set(id, (x = { debits: new Map(), credits: 0 })); return x; };
  // Primero los cargos y traslados originales; después anulaciones y reversiones sobre su original.
  for (const ch of charges) if (!ch.voids) pp(ch.patient_id).debits.set(`c:${ch.id}`, { key: `c:${ch.id}`, date: local(ch.created_at), cents: Number(ch.net) });
  for (const t of transfers) if (!t.reverses_id) pp(t.patient_id).debits.set(`t:${t.id}`, { key: `t:${t.id}`, date: local(t.created_at), cents: Number(t.amount_cents) });
  for (const o of openings) if (!o.voids_id) {
    const cents = Number(o.amount_cents);
    if (cents > 0) pp(o.patient_id).debits.set(`o:${o.id}`, { key: `o:${o.id}`, date: o.cutoff_date, cents });
    else pp(o.patient_id).credits += -cents;
  }
  const offset = (patientId: string, key: string, cents: number) => {
    const x = pp(patientId);
    const d = x.debits.get(key);
    if (d) d.cents += cents; else x.credits -= cents; // sin original (no debería pasar): cuenta como crédito
  };
  for (const ch of charges) if (ch.voids) offset(ch.patient_id, `c:${ch.voids}`, Number(ch.net));
  for (const t of transfers) if (t.reverses_id) offset(t.patient_id, `t:${t.reverses_id}`, Number(t.amount_cents));
  for (const o of openings) if (o.voids_id) {
    const cents = Number(o.amount_cents); // opuesto exacto del original (lo garantiza la base)
    if (cents < 0) offset(o.patient_id, `o:${o.voids_id}`, cents); else pp(o.patient_id).credits -= cents;
  }
  for (const p of pays) pp(p.patient_id).credits += Number(p.v);
  // Una anulación o reversión que deja su original en negativo pasa el excedente a crédito.
  for (const x of perPatient.values()) for (const d of x.debits.values()) if (d.cents < 0) { x.credits += -d.cents; d.cents = 0; }

  const ids = [...perPatient.keys()];
  const people = ids.length ? (await c.query<{ id: string; name: string; record_number: string; phone: string | null }>(
    "SELECT id, first_name || ' ' || last_name AS name, record_number, phone FROM patients WHERE id = ANY($1)", [ids])).rows : [];
  const nameOf = new Map(people.map((p) => [p.id, p]));
  const patients = [];
  const patientTotals = empty();
  for (const [id, x] of perPatient) {
    const debit = [...x.debits.values()].reduce((s, d) => s + d.cents, 0);
    const balance = debit - x.credits;
    if (balance <= 0) continue;
    const { buckets, oldestDays } = ageDebits(asOf, [...x.debits.values()], x.credits);
    add(patientTotals, buckets);
    const who = nameOf.get(id);
    patients.push({ patientId: id, name: who?.name ?? "—", recordNumber: who ? Number(who.record_number) : null, phone: who?.phone ?? null, ...buckets, totalCents: balance, oldestDays });
  }
  patients.sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name));

  // ---------------- Empresas ----------------
  let companies: CompanyRow[] | null = null;
  const companyTotals = empty();
  const seeCompanies = hasAllBranches(auth);
  if (seeCompanies) {
    const rows = (await c.query<{ agreement_id: string; name: string; kind: string; id: string; patient_id: string; created_at: Date; due: string }>(
      `SELECT ch.payer_agreement_id AS agreement_id, a.name, a.kind, ch.id, ch.patient_id, ch.created_at,
              (ch.third_party_cents
               + COALESCE((SELECT sum(v.third_party_cents) FROM charges v WHERE v.voids_charge_id = ch.id AND v.created_at < $1), 0)
               - COALESCE((SELECT sum(t.amount_cents) FROM payer_transfers t WHERE t.charge_id = ch.id AND t.created_at < $1), 0)
               - COALESCE((SELECT sum(x.amount_cents) FROM payer_payment_allocations x JOIN payer_payments p ON p.id = x.payment_id
                            WHERE x.charge_id = ch.id AND p.status = 'confirmed' AND p.received_at < $1), 0))::bigint AS due
         FROM charges ch JOIN agreements a ON a.id = ch.payer_agreement_id
        WHERE ch.voids_charge_id IS NULL AND ch.third_party_cents > 0 AND ch.created_at < $1
        ORDER BY a.name, ch.created_at`, [end])).rows;
    const byAg = new Map<string, { name: string; kind: string; debits: Debit[]; patients: Set<string>; credits: number }>();
    for (const r of rows) {
      let g = byAg.get(r.agreement_id);
      if (!g) byAg.set(r.agreement_id, (g = { name: r.name, kind: r.kind, debits: [], patients: new Set(), credits: 0 }));
      const due = Number(r.due);
      if (due > 0) { g.debits.push({ key: r.id, date: local(r.created_at), cents: due }); g.patients.add(r.patient_id); }
      else if (due < 0) g.credits += -due; // no debería ocurrir (la base lo impide); se descuenta del total
    }
    const list: CompanyRow[] = [];
    companies = list;
    for (const [agreementId, g] of byAg) {
      const { buckets, oldestDays } = ageDebits(asOf, g.debits, g.credits);
      const total = sumOf(buckets);
      if (total <= 0) continue;
      add(companyTotals, buckets);
      list.push({ agreementId, name: g.name, kindLabel: AGREEMENT_KINDS[g.kind] ?? g.kind, charges: g.debits.length, patients: g.patients.size, ...buckets, totalCents: total, oldestDays });
    }
    list.sort((a, b) => b.totalCents - a.totalCents || a.name.localeCompare(b.name));
  }
  const general = add(add(empty(), patientTotals), companyTotals);
  return {
    asOf, zone, bucketLabels: BUCKET_LABELS,
    patients, companies,
    totals: {
      patients: { ...patientTotals, totalCents: sumOf(patientTotals), count: patients.length },
      companies: seeCompanies ? { ...companyTotals, totalCents: sumOf(companyTotals), count: companies!.length } : null,
      general: { ...general, totalCents: sumOf(general) },
    },
    note: seeCompanies ? null : "Las cuentas de empresas las ve quien tiene acceso a todas las sucursales.",
  };
}

const zAsOf = z.object({ asOf: zDate.optional() });

export function agingRoutes(route: Route) {
  route({
    method: "GET", url: "/api/reports/receivables-aging",
    summary: "Cuentas por cobrar generales con antigüedad (0–30, 31–60, 61–90 y más de 90 días): pacientes y empresas por separado, a una fecha de corte", tags: ["reportes"],
    perm: "reports.financial", query: zAsOf,
    handler: async ({ c, auth, query }) => receivablesAging(c, auth, query.asOf),
  });

  route({
    method: "GET", url: "/api/reports/receivables-aging.xlsx", summary: "Exportar a Excel las cuentas por cobrar con antigüedad (los mismos datos y totales de la pantalla)", tags: ["reportes"],
    perm: "reports.financial", query: zAsOf, raw: true,
    handler: async ({ c, auth, query, reply }) => {
      const d = await receivablesAging(c, auth, query.asOf);
      const wb = newWorkbook();
      const money = BUCKETS.map((k) => ({ header: BUCKET_LABELS[k], money: true }));
      const cells = (b: Buckets & { totalCents: number }) => [...BUCKETS.map((k) => bsCell(b[k])), bsCell(b.totalCents)];
      const fmt = DateTime.fromISO(d.asOf).toFormat("dd/MM/yyyy");
      addSheet(wb, "Resumen", [{ header: "Cuenta", width: 26 }, ...money, { header: "Total (Bs)", money: true }], [
        ["Pacientes", ...cells(d.totals.patients)],
        ...(d.totals.companies ? [["Empresas (convenios)", ...cells(d.totals.companies)]] : []),
      ], { title: `Cuentas por cobrar al ${fmt}`, totals: ["Total general", ...cells(d.totals.general)],
        notes: ["Antigüedad contada desde la fecha de cada tratamiento o traslado; los pagos del paciente se aplican a lo más antiguo.",
          "Los pagos por verificar no descuentan el saldo hasta confirmarse.", ...(d.note ? [d.note] : [])] });
      addSheet(wb, "Pacientes", [{ header: "Paciente", width: 30 }, { header: "Ficha", width: 8 }, { header: "Teléfono", width: 14 }, ...money, { header: "Saldo (Bs)", money: true }],
        d.patients.map((p) => [p.name, p.recordNumber, p.phone, ...cells(p)]),
        { title: `Saldos de pacientes al ${fmt}`, totals: ["Total pacientes", "", "", ...cells(d.totals.patients)] });
      if (d.companies && d.totals.companies) {
        addSheet(wb, "Empresas", [{ header: "Empresa / convenio", width: 34 }, { header: "Tipo", width: 12 }, { header: "Cargos", width: 9 }, ...money, { header: "Saldo (Bs)", money: true }],
          d.companies.map((x) => [x.name, x.kindLabel, x.charges, ...cells(x)]),
          { title: `Saldos de empresas al ${fmt}`, totals: ["Total empresas", "", "", ...cells(d.totals.companies)] });
      }
      await audit(c, auth, "report.exported", "receivables_aging", null, { asOf: d.asOf, patients: d.patients.length, companies: d.companies?.length ?? null });
      await sendXlsx(reply, wb, `cuentas-por-cobrar-${d.asOf}`);
    },
  });
}
