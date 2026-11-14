// «Proveedores» por mes (15/11/2026, equipo 1 «la plata coincide»): para cada proveedor, en el mes elegido,
//  - lo que le pagaste de verdad (gastos de sus cuentas o con su nombre) y lo que te devolvió («Me devolvió plata»);
//  - el costo estimado de sus cuentas que ese mes no anotaste (la misma regla que Finanzas; las retiradas cuentan en
//    los meses en que estuvieron vivas);
//  - lo que entró por clientes que estaban en SUS cuentas cuando pagaron (no donde están hoy: si a un cliente lo
//    pasaste a otra cuenta, lo que pagó antes sigue siendo del proveedor de antes);
//  - la ganancia = entró − pagado + devuelto − estimado.
// La suma de todas las filas (más «Sin proveedor») da lo mismo que Finanzas: entró, salió y te quedó del mes.
import type { Actor, Assignment, Cents, Id } from "./types.js";
import type { Engine } from "./engine.js";
import { authorize } from "./auth.js";
import { boMonthKey } from "./time.js";
import { incomeEvents } from "./income.js";
import { accountsEstimateMonth } from "./finanzasCostos.js";
import { addMonthKey, monthLabel, pendingFixed, signedAmount } from "./gastos.js";
import { servicesOf, sharesOf } from "./plata.js";
import { looseMonth } from "./perfilSuelto.js";

/** El perfil en que estaba un servicio en un momento: el del último cambio de su historial hasta ese momento. */
export function slotAt(a: Assignment, t: number): Id {
  let slot: Id | undefined;
  for (const h of a.history ?? []) { if (h.at <= t) slot = h.slotId; else break; }
  return slot ?? a.history?.[0]?.slotId ?? a.slotId;
}

/** La cuenta en que estaba un servicio en un momento. */
export function accountAt(e: Engine, assignmentId: Id | undefined, t: number): Id | undefined {
  const a = assignmentId ? e.s.assignments[assignmentId] : undefined;
  return a ? e.s.slots[slotAt(a, t)]?.accountId : undefined;
}

/** Lo que entró en [from, to) repartido por cuenta (donde estaba cada cliente al pagar). `""` = sin cuenta. */
export function incomeByAccount(e: Engine, from: number, to: number, now = e.now()): Map<Id, Cents> {
  const out = new Map<Id, Cents>();
  for (const [k, v] of incomeBy(e, from, to, now, (id, t) => accountAt(e, id, t))) out.set(k, v.amount);
  return out;
}

/** Lo mismo, por perfil (para los perfiles sueltos): cuántos cobros y cuánto. */
export function incomeBySlot(e: Engine, from: number, to: number, now = e.now()): Map<Id, { n: number; amount: Cents }> {
  return incomeBy(e, from, to, now, (id, t) => { const a = id ? e.s.assignments[id] : undefined; return a ? slotAt(a, t) : undefined; });
}

function incomeBy(e: Engine, from: number, to: number, now: number, keyOf: (assignmentId: Id | undefined, t: number) => Id | undefined) {
  const out = new Map<Id, { n: number; amount: Cents }>();
  const add = (k: Id | undefined, v: Cents) => { const r = out.get(k ?? "") ?? { n: 0, amount: 0 }; r.amount += v; if (v > 0) r.n++; out.set(k ?? "", r); };
  for (const ev of incomeEvents(e, now)) {
    if (ev.at < from || ev.at >= to) continue;
    if (ev.source === "order" && ev.order && !ev.assignmentId) {
      const shares = sharesOf(e, ev.order);
      if (!servicesOf(ev.order).length) { add(undefined, ev.amount); continue; }
      for (const [id, v] of shares) add(keyOf(id, ev.at), v);
    } else add(keyOf(ev.assignmentId, ev.at), ev.amount);
  }
  return out;
}

export function supplierMonth(e: Engine, actor: Actor, month?: unknown) {
  authorize(actor, "supplier.manage");
  const now = e.now(), cur = boMonthKey(now);
  let key = typeof month === "string" && /^\d{4}-(0[1-9]|1[0-2])$/.test(month) ? month : cur;
  if (key > cur) key = cur;
  const [y, m] = key.split("-").map(Number);
  const start = Date.UTC(y, m - 1, 1, 4), end = Date.UTC(y, m, 1, 4);
  const supOfAcc = (id: Id | undefined) => (id ? e.s.accounts[id]?.supplierId ?? "" : "");
  type Row = { supplierId: Id; name: string; pagado: Cents; devuelto: Cents; estimado: Cents; ingresos: Cents; cuentas: number };
  const rows = new Map<Id, Row>();
  const row = (sid: Id) => {
    let r = rows.get(sid);
    if (!r) { r = { supplierId: sid, name: sid ? e.s.suppliers[sid]?.name ?? "Proveedor borrado" : "Sin proveedor", pagado: 0, devuelto: 0, estimado: 0, ingresos: 0, cuentas: 0 }; rows.set(sid, r); }
    return r;
  };
  for (const s of Object.values(e.s.suppliers)) row(s.id);
  for (const x of e.s.expenses ?? []) {
    if (boMonthKey(x.at) !== key) continue;
    const r = row(x.supplierId ?? supOfAcc(x.accountId));
    if (x.refund) r.devuelto += x.amount; else r.pagado += x.amount;
  }
  const est = accountsEstimateMonth(e, key, now);
  for (const b of est.byAccount) row(supOfAcc(b.accountId)).estimado += b.amount;
  for (const fx of pendingFixed(e, key)) row(e.s.fixedExpenses?.find((f) => f.id === fx.fixedId)?.supplierId ?? "").estimado += fx.amount;
  for (const [acc, v] of incomeByAccount(e, start, end, now)) row(supOfAcc(acc || undefined)).ingresos += v;
  for (const a of Object.values(e.s.accounts)) if (a.createdAt < end && a.supplierExpiresAt >= start) row(a.supplierId).cuentas++;
  // Perfiles sueltos de cada vendedor (perfilSuelto.ts): compré, vendí, gané, caídas y cuánto devolvió.
  const loose = looseMonth(e, key, incomeBySlot(e, start, end, now));
  const list = [...rows.values()].filter((r) => r.supplierId || r.pagado || r.devuelto || r.estimado || r.ingresos)
    .map((r) => ({ ...r, ganancia: r.ingresos - r.pagado + r.devuelto - r.estimado, ...(loose.has(r.supplierId) ? { perfiles: loose.get(r.supplierId)! } : {}) }))
    .sort((a, b) => Number(!a.supplierId) - Number(!b.supplierId) || b.ingresos - a.ingresos || a.name.localeCompare(b.name, "es"));
  const tot = (k: "pagado" | "devuelto" | "estimado" | "ingresos" | "ganancia") => list.reduce((t, r) => t + r[k], 0);
  const gastos = (e.s.expenses ?? []).filter((x) => boMonthKey(x.at) === key).reduce((t, x) => t + signedAmount(x), 0);
  return {
    month: key, label: monthLabel(key), current: key === cur,
    months: Array.from({ length: 12 }, (_, i) => { const k = addMonthKey(cur, -i); return { key: k, label: monthLabel(k) }; }),
    rows: list,
    totals: { pagado: tot("pagado"), devuelto: tot("devuelto"), estimado: tot("estimado"), ingresos: tot("ingresos"), ganancia: tot("ganancia"), gastosNetos: gastos },
  };
}
