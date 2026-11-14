// Reporte Excel empresarial (13/11/2026) para la tienda y para cada revendedor, con el escritor propio
// (xlsx.ts → writeXlsxPro: estilos, fórmulas, filtros, gráficos). Reglas:
//  - Ingresos = la MISMA fuente que Inicio, Finanzas y Cómo van (income.ts): pedidos entregados + cobros del
//    Control sin duplicar. Ingresos no es ganancia: la ganancia resta gastos (tienda) o lo pagado a la tienda (revendedor).
//  - El revendedor ve SOLO lo suyo: sus ventas, sus precios, lo que él pagó, sus clientes, su libreta. Nunca los costos
//    de la tienda, otros revendedores ni correos/claves de cuentas.
import type { Actor, Cents, Id, Order } from "../store/types.js";
import type { GabrielStore } from "../store/index.js";
import { authorize } from "../store/auth.js";
import { DomainError } from "../store/errors.js";
import { incomeEvents } from "../store/income.js";
import { boParts, boDayStart, DAY } from "../store/time.js";
import { lastPurchaseByPayer } from "../store/stats.js";
import { overview as fiadoOverview } from "../store/fiado.js";
import { myControl, myEarnings } from "../store/resellerTools.js";
import { myCustomers } from "../store/portal.js";
import { listMine as mySubs } from "../store/subRentals.js";
import { isForeign, listPriceMine, localeOf } from "../store/country.js";
import { paidTotal } from "../store/usd.js";
import { effectivePrice } from "../store/admin.js";
import { accountsEstimateMonth } from "../store/finanzasCostos.js";
import { CATEGORY_LABEL, pendingFixed, signedAmount } from "../store/gastos.js";
import { supplierMonth } from "../store/proveedoresMes.js";
import { writeXlsxPro, type CellStyle, type ProCell, type ProRow, type ProSheet, type Workbook } from "./xlsx.js";
import { fdate } from "./exportCenter.js";

export interface Period { from: number; to: number }
// Mes con nombre completo («junio 2026»): «jun 26» se leía como el día 26.
const MES = ["enero", "febrero", "marzo", "abril", "mayo", "junio", "julio", "agosto", "septiembre", "octubre", "noviembre", "diciembre"];
const monthKey = (t: number) => { const p = boParts(t); return `${p.y}-${String(p.m + 1).padStart(2, "0")}`; };
const monthLabel = (k: string) => `${MES[Number(k.slice(5, 7)) - 1]} ${k.slice(0, 4)}`;
// Las fechas van como Date (serie Excel, en UTC) con formato dd/mm/yyyy: se corren 4 h para que el día sea el de Bolivia.
const bo = (t: number) => new Date(t - 4 * 3_600_000);

/** «2026-11-01» → inicio de ese día en Bolivia; «to» incluye el día entero. */
export function parsePeriod(from: unknown, to: unknown, now: number): Period {
  const parse = (v: unknown): number | null => { const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v ?? "")); return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 4) : null; };
  const p = boParts(now);
  const f = parse(from) ?? Date.UTC(p.y, p.m, 1, 4);
  const t0 = parse(to);
  const t = t0 === null ? now : t0 + DAY - 1;
  if (t < f) throw new DomainError("VALIDATION", "El período está al revés: «desde» tiene que ser antes que «hasta»");
  if (t - f > 400 * DAY) throw new DomainError("VALIDATION", "El período no puede pasar de 13 meses");
  return { from: f, to: t };
}

/* ---------------- paleta y estilos ---------------- */
const C = { navy: "#0f172a", gold: "#fcc42d", ink: "#111827", muted: "#6b7280", line: "#e5e7eb", soft: "#f8fafc", ok: "#16a34a", bad: "#dc2626", warn: "#d97706", head: "#1e293b" };
const money = (sym: string, dec: number) => `"${sym}" #,##0${dec ? "." + "0".repeat(dec) : ""}`;
const TITLE: CellStyle = { bold: true, size: 20, color: C.navy };
const SUB: CellStyle = { size: 11, color: C.muted };
const H: CellStyle = { bold: true, color: "#ffffff", fill: C.head, border: true, borderColor: C.head, valign: "middle", wrap: true };
const KL: CellStyle = { color: C.muted, size: 10 };
const KV: CellStyle = { bold: true, size: 16, color: C.navy };
const SEC: CellStyle = { bold: true, size: 13, color: C.navy };
const cell = (v: ProCell["v"], s?: CellStyle, extra: Partial<ProCell> = {}): ProCell => ({ v, ...(s ? { s } : {}), ...extra });
const td = (v: ProCell["v"], s: CellStyle = {}): ProCell => cell(v, { border: true, ...s });
const num = (v: number, fmt: string, s: CellStyle = {}): ProCell => td(v, { numFmt: fmt, align: "right", ...s });
const colL = (i: number) => String.fromCharCode(65 + i);

/** Hoja con título, subtítulo, encabezado en la fila 4 y datos desde la 5; totales con SUM; filtro y panel fijo. */
function table(name: string, title: string, subtitle: string, heads: string[], rows: ProRow[], widths: number[], opts: { totals?: Record<number, string>; tab?: string; charts?: ProSheet["charts"]; note?: string } = {}): ProSheet {
  const n = rows.length, last = 4 + Math.max(n, 1);
  const totalRow: ProRow | null = opts.totals ? heads.map((_, i) => (i === 0 ? cell("Total", { bold: true, fill: C.soft, border: true }) : opts.totals![i] ? ({ f: `SUM(${colL(i)}5:${colL(i)}${last})`, s: { bold: true, numFmt: opts.totals![i], fill: C.soft, border: true, align: "right" } } as ProCell) : cell("", { fill: C.soft, border: true }))) : null;
  const out: ProRow[] = [[cell(title, TITLE)], [cell(subtitle, SUB)], [], heads.map((h) => cell(h, H)), ...(n ? rows : [[cell("Sin datos en este período", { italic: true, color: C.muted })]]), ...(totalRow ? [totalRow] : []), ...(opts.note ? [[], [cell(opts.note, { italic: true, color: C.muted, size: 9 })]] : [])];
  return { name, rows: out, widths, heights: { 0: 30, 3: 24 }, merges: [`A1:${colL(heads.length - 1)}1`, `A2:${colL(heads.length - 1)}2`], freeze: { rows: 4 }, autoFilter: `A4:${colL(heads.length - 1)}${last}`, ...(opts.tab ? { tabColor: opts.tab } : {}), ...(opts.charts ? { charts: opts.charts } : {}) };
}

interface Built { book: Workbook; name: string }

/* ================= TIENDA ================= */
function storeReport(store: GabrielStore, actor: Actor, per: Period, origin?: string): Built {
  authorize(actor, "stats.view");
  const e = store.engine, s = e.s, now = e.now(), st = s.settings;
  const sym = st.currencySymbol || "Bs", fmt = money(sym, 2);
  const inPer = (t: number) => t >= per.from && t <= per.to;
  const events = incomeEvents(e, now);
  const evPer = events.filter((x) => inPer(x.at)).sort((a, b) => a.at - b.at);
  const nameOf = (id: Id) => s.customers[id]?.name ?? "—";
  const METHOD: Record<string, string> = { qr: "QR", balance: "Saldo", cash: "Efectivo", usdt: "USDT", binance: "Binance Pay" };
  // Ventas
  const ventas: ProRow[] = evPer.map((x) => [td(bo(x.at), { numFmt: "dd/mm/yyyy" }), td(nameOf(x.payerId)), td(x.payerId !== x.customerId ? `${nameOf(x.customerId)} (cliente del revendedor)` : ""), td(x.kind === "sale" ? "Venta" : x.kind === "renewal" ? "Renovación" : x.kind === "fiado" ? "Pago del fiado" : x.kind === "refund" ? "Devolución a cliente (resta)" : "Cobro del Control"),
    td(x.items.map((i) => `${i.qty} × ${s.products[i.productId]?.name ?? i.productId}`).join(", ")), num(x.amount / 100, fmt, x.amount < 0 ? { color: C.bad } : {}), td(x.order ? `${METHOD[x.order.paymentMethod] ?? x.order.paymentMethod}${x.order.payLater ? " · fiado, cobrado" : ""}` : x.source === "refund" ? "Devolución" : "Efectivo / QR directo"), td(x.source === "order" ? "Pedido" : x.source === "fiado" ? "Fiado" : x.source === "refund" ? "Devolución" : "Control")]);
  // Por producto
  const by = new Map<Id, { name: string; units: number; amount: Cents }>();
  for (const x of evPer) for (const it of x.items) { const b = by.get(it.productId) ?? { name: s.products[it.productId]?.name ?? it.productId, units: 0, amount: 0 }; b.units += it.qty; b.amount += it.amount; by.set(it.productId, b); }
  const prodRows = [...by.values()].sort((a, b) => b.amount - a.amount);
  const totalIn = evPer.reduce((t, x) => t + x.amount, 0);
  const porProducto: ProRow[] = prodRows.map((p) => [td(p.name), num(p.units, "0"), num(p.amount / 100, fmt), num(totalIn ? p.amount / totalIn : 0, "0.0%")]);
  // Mensual (últimos 6 meses hasta el fin del período)
  // «Te quedó» con la MISMA regla que Finanzas: ingresos − gastos − costo estimado de las cuentas (finanzasCostos.ts).
  const months: { key: string; ingresos: Cents; pedidos: Cents; control: Cents; fiado: Cents; gastos: Cents; cuentas: Cents; sinCostos: boolean }[] = [];
  const endP = boParts(per.to);
  // «Estimado» = cuentas sin anotar + gastos fijos sin anotar (la misma resta que «Te quedó» del panel).
  for (let i = 5; i >= 0; i--) { const d = new Date(Date.UTC(endP.y, endP.m - i, 1, 12)); const key = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`; const est = accountsEstimateMonth(e, key, now); months.push({ key, ingresos: 0, pedidos: 0, control: 0, fiado: 0, gastos: 0, cuentas: est.amount + pendingFixed(e, key).reduce((t, f) => t + f.amount, 0), sinCostos: est.sinCostos }); }
  const mi = new Map(months.map((m, i) => [m.key, i]));
  for (const x of events) { const i = mi.get(monthKey(x.at)); if (i !== undefined) { months[i].ingresos += x.amount; if (x.source === "order") months[i].pedidos += x.amount; else if (x.source === "fiado") months[i].fiado += x.amount; else months[i].control += x.amount; } }
  for (const g of s.expenses ?? []) { const i = mi.get(monthKey(g.at)); if (i !== undefined) months[i].gastos += signedAmount(g); }
  const mensual: ProRow[] = months.map((m, i) => [td(monthLabel(m.key)), num(m.ingresos / 100, fmt), num(m.pedidos / 100, fmt), num(m.control / 100, fmt), num(m.fiado / 100, fmt), num(m.gastos / 100, fmt), num(m.cuentas / 100, fmt), { f: `B${5 + i}-F${5 + i}-G${5 + i}`, s: { numFmt: fmt, border: true, align: "right", bold: true } } as ProCell, td(m.sinCostos ? "sin costos anotados" : "", { italic: true, color: C.muted })]);
  // Costo estimado de las cuentas en los meses del período (el mismo número que «🔑 Cuentas (estimado)» de Finanzas).
  const perKeys: string[] = [];
  for (let t = Date.UTC(boParts(per.from).y, boParts(per.from).m, 1, 12); monthKey(t) <= monthKey(per.to); t = Date.UTC(new Date(t).getUTCFullYear(), new Date(t).getUTCMonth() + 1, 1, 12)) perKeys.push(monthKey(t));
  const perEst = perKeys.map((k) => accountsEstimateMonth(e, k, now));
  const cuentasPer = perEst.reduce((t, x) => t + x.amount, 0), sinCostosPer = perEst.every((x) => x.sinCostos);
  const fijosPer = perKeys.reduce((t, k) => t + pendingFixed(e, k).reduce((u, f) => u + f.amount, 0), 0);
  // Cobros y deudas
  const fi = fiadoOverview(e, actor);
  const deudas: ProRow[] = fi.rows.map((r) => [td(r.name), td(r.phone), td(r.kind === "reseller" ? "Revendedor" : "Cliente"), num(r.owed / 100, fmt), num(r.unlinked.amount / 100, fmt), td(r.nextDue ? bo(r.nextDue) : "", { numFmt: "dd/mm/yyyy" }), td(r.overdue ? "Vencido" : r.owed > 0 ? "Pendiente" : "A favor", { color: r.overdue ? C.bad : r.owed > 0 ? C.warn : C.ok, bold: true })]);
  // Vencimientos (sin correos ni claves)
  const asg = Object.values(s.assignments).filter((a) => a.status === "active").sort((a, b) => a.customerExpiresAt - b.customerExpiresAt);
  const PAY: Record<string, string> = { pagado: "Pagado", pendiente: "Pendiente", no_pago: "No pagó" };
  const venc: ProRow[] = asg.map((a) => { const c = s.customers[a.customerId]; const days = Math.round((boDayStart(a.customerExpiresAt) - boDayStart(now)) / DAY); return [td(c?.name ?? "—"), td(c?.phone ?? ""), td(c?.resellerId ? nameOf(c.resellerId) : ""), td(s.products[a.productId]?.name ?? a.productId), td(s.slots[a.slotId]?.label ?? ""), td(bo(a.customerExpiresAt), { numFmt: "dd/mm/yyyy" }), num(days, "0", { color: days < 0 ? C.bad : days <= 3 ? C.warn : C.ink, bold: days <= 3 }), td(PAY[a.control?.payStatus ?? ""] ?? "", { color: a.control?.payStatus === "pagado" ? C.ok : a.control?.payStatus ? C.bad : C.ink }), num(effectivePrice(e, a) / 100, fmt)]; }); // el mismo precio que el panel (acordado, de su lista o en US$ a la tasa)
  // Clientes
  const last = lastPurchaseByPayer(e);
  const custs = Object.values(s.customers).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const activeOf = (id: Id) => asg.filter((a) => a.customerId === id).length;
  const clientes: ProRow[] = custs.map((c) => [td(c.name), td(c.phone ?? ""), td(c.kind === "reseller" ? "Revendedor" : c.resellerId ? `Cliente de ${nameOf(c.resellerId)}` : "Cliente"), num(activeOf(c.id), "0"), td(last[c.id] ? bo(last[c.id]) : "", { numFmt: "dd/mm/yyyy" }), td(bo(c.createdAt), { numFmt: "dd/mm/yyyy" })]);
  // KPIs
  const gastosPer = (s.expenses ?? []).filter((g) => inPer(g.at)).reduce((t, g) => t + signedAmount(g), 0);
  // Gastos del período (con fecha, categoría, dólares y tasa, proveedor) y devoluciones de proveedores (en verde, restan).
  const supName = (id?: Id) => (id ? s.suppliers[id]?.name ?? "" : "");
  const gastosRows: ProRow[] = (s.expenses ?? []).filter((g) => inPer(g.at)).sort((a, b) => a.at - b.at).map((g) => [td(bo(g.at), { numFmt: "dd/mm/yyyy" }), td(CATEGORY_LABEL[g.category ?? (g.accountId ? "cuenta" : "otro")]), td(g.note),
    num(signedAmount(g) / 100, fmt, g.refund ? { color: C.ok, bold: true } : {}), g.usd ? num(g.usd / 100, money("US$", 2)) : td(""), g.rate ? num(g.rate, "0.00##") : td(""),
    td(supName(g.supplierId ?? (g.accountId ? s.accounts[g.accountId]?.supplierId : undefined))), td(g.refund ? "Devolución (resta)" : g.months && g.months > 1 ? `Gasto · cubre ${g.months} meses` : "Gasto", g.refund ? { color: C.ok, bold: true } : {})]);
  // Proveedores, mes por mes del período: lo pagado de verdad, lo devuelto, lo estimado y lo que entró por sus cuentas.
  const provRows: ProRow[] = perKeys.flatMap((k) => supplierMonth(e, actor, k).rows.map((r) => [td(monthLabel(k)), td(r.name), num(r.pagado / 100, fmt), num(r.devuelto / 100, fmt, r.devuelto ? { color: C.ok } : {}), num(r.estimado / 100, fmt), num(r.ingresos / 100, fmt), num(r.ganancia / 100, fmt, { bold: true, color: r.ganancia < 0 ? C.bad : C.ink })]));
  const ventasN = evPer.filter((x) => x.kind === "sale").length, renovN = evPer.filter((x) => x.kind === "renewal").length, controlN = evPer.filter((x) => x.kind === "control").length, fiadoN = evPer.filter((x) => x.kind === "fiado").length;
  const activos = new Set(asg.map((a) => a.customerId)).size, porVencer = asg.filter((a) => a.customerExpiresAt >= now && a.customerExpiresAt - now <= 7 * DAY).length, vencidos = asg.filter((a) => a.customerExpiresAt < now).length;
  const portada = cover(st.storeName, "Reporte del negocio", per, sym, origin, [
    ["Ingresos del período", { f: `SUM(Ventas!F5:F${4 + Math.max(ventas.length, 1)})`, fmt }, "pedidos entregados + cobros del Control + pagos del fiado (sin duplicar)"],
    ["Gastos del período", gastosPer / 100, "anotados en Finanzas", true],
    ["Costo estimado de cuentas", cuentasPer / 100, sinCostosPer ? "sin costos anotados: cargá el costo de tus cuentas para ver la ganancia real" : "cuentas vivas que no anotaste como gasto, a su costo por mes (igual que Finanzas)", true],
    ["Gastos fijos sin anotar", fijosPer / 100, "internet, publicidad… que definiste como fijos y ese mes no anotaste (estimado)", true],
    ["Te quedó", { f: "B6-B7-B8-B9", fmt }, "ingresos − gastos − costo de las cuentas − fijos sin anotar: la misma ganancia que el panel"],
    ["Ventas", ventasN, ""], ["Renovaciones", renovN, ""], ["Cobros del Control", controlN, ""], ["Pagos del fiado", fiadoN, ""],
    ["Clientes con servicio activo", activos, ""], ["Servicios activos", asg.length, ""], ["Vencen en 7 días", porVencer, ""], ["Vencidos sin renovar", vencidos, ""],
    ["Te deben", (fi.totals.owed + fi.totals.unlinked) / 100, "libreta de fiado + servicios marcados sin pagar", true],
  ], fmt);
  const n = Math.max(prodRows.length, 1), nm = months.length;
  const book: Workbook = { creator: st.storeName, title: `Reporte ${st.storeName} ${fdate(per.from)} a ${fdate(per.to)}`, sheets: [
    portada,
    table("Resumen", "Ingresos por mes", "Últimos 6 meses · misma fuente y misma ganancia que Inicio y Finanzas", ["Mes", `Ingresos (${sym})`, "De pedidos", "Del Control", "Del fiado", "Gastos (menos devoluciones)", "Cuentas y fijos (estimado)", "Te quedó", "Nota"], mensual, [18, 16, 14, 14, 14, 14, 16, 16, 20], { tab: C.gold, charts: [{ type: "column", title: "Ingresos por mes", categories: `A5:A${4 + nm}`, series: [{ name: "Ingresos", values: `B5:B${4 + nm}`, color: C.gold }, { name: "Gastos", values: `F5:F${4 + nm}`, color: C.bad }], anchor: { col: 10, row: 3, cols: 8, rows: 16 } }] }),
    table("Ventas", "Ventas e ingresos", `${fdate(per.from)} a ${fdate(per.to)} · ${evPer.length} movimiento${evPer.length === 1 ? "" : "s"}`, ["Fecha", "Quién pagó", "Para", "Tipo", "Detalle", `Monto (${sym})`, "Forma de pago", "Origen"], ventas, [12, 24, 26, 16, 36, 14, 14, 10], { totals: { 5: fmt }, tab: "#16a34a" }),
    table("Por producto", "Ventas por producto", `${fdate(per.from)} a ${fdate(per.to)}`, ["Producto", "Unidades", `Ingresos (${sym})`, "% del total"], porProducto, [30, 12, 16, 12], { totals: { 1: "0", 2: fmt }, charts: [{ type: "bar", title: "Ingresos por producto", categories: `A5:A${4 + n}`, series: [{ name: "Ingresos", values: `C5:C${4 + n}`, color: C.navy }], anchor: { col: 5, row: 3, cols: 8, rows: 14 } }, { type: "pie", title: "Participación", categories: `A5:A${4 + n}`, series: [{ name: "Ingresos", values: `C5:C${4 + n}` }], anchor: { col: 5, row: 19, cols: 8, rows: 14 } }] }),
    table("Cobros y deudas", "Quién te debe", `Al ${fdate(now)} · ${fi.totals.people} persona${fi.totals.people === 1 ? "" : "s"}`, ["Cliente", "WhatsApp", "Tipo", `Debe (${sym})`, `Sin pagar en el Control (${sym})`, "Próximo vencimiento", "Estado"], deudas, [26, 16, 12, 14, 18, 16, 12], { totals: { 3: fmt, 4: fmt }, tab: C.bad }),
    table("Vencimientos", "Suscripciones y vencimientos", `Servicios activos al ${fdate(now)} · ${asg.length}`, ["Cliente", "WhatsApp", "Revendedor", "Producto", "Perfil", "Vence", "Días", "Pago", `Precio (${sym})`], venc, [24, 16, 18, 24, 14, 12, 8, 12, 12], { tab: C.warn, note: "Sin correos ni claves de las cuentas: eso queda en el panel." }),
    table("Clientes", "Clientes", `${custs.length} en total`, ["Nombre", "WhatsApp", "Tipo", "Servicios activos", "Última compra", "Alta"], clientes, [28, 16, 26, 14, 14, 12]),
    table("Gastos", "Gastos y devoluciones", `${fdate(per.from)} a ${fdate(per.to)} · una devolución del proveedor resta (en verde)`, ["Fecha", "Categoría", "En qué", `Monto (${sym})`, "US$", "Tasa", "Proveedor", "Tipo"], gastosRows, [12, 14, 36, 14, 10, 8, 20, 22], { totals: { 3: fmt }, tab: C.bad }),
    table("Proveedores", "Proveedores mes a mes", "Pagado de verdad, devuelto, estimado sin anotar e ingresos de los clientes que estaban en sus cuentas al pagar", ["Mes", "Proveedor", "Pagado", "Te devolvió", "Estimado sin anotar", "Entró por sus cuentas", "Ganancia"], provRows, [16, 26, 14, 14, 16, 18, 14], { totals: { 2: fmt, 3: fmt, 4: fmt, 5: fmt, 6: fmt }, tab: C.navy }),
  ] };
  return { book, name: `reporte-${slug(st.storeName)}-${monthKey(per.from)}.xlsx` };
}

/* ================= REVENDEDOR ================= */
function resellerReport(store: GabrielStore, actor: Actor, per: Period, origin?: string): Built {
  const e = store.engine, s = e.s, now = e.now();
  const me = e.get("customers", actor.customerId!);
  if (me.kind !== "reseller") throw new DomainError("FORBIDDEN", "Solo para revendedores");
  const loc = localeOf(e, me), sym = loc.symbol, fmt = money(sym, loc.decimals), split = isForeign(e, me);
  const costFmt = money(s.settings.currencySymbol || "Bs", 2);
  const inPer = (t: number) => t >= per.from && t <= per.to;
  const mine = (o: Order) => o.payerId === me.id && o.customerId !== me.id && o.status === "fulfilled" && (o.kind === "sale" || o.kind === "renewal");
  const orders = Object.values(s.orders).filter((o) => mine(o) && inPer(o.updatedAt)).sort((a, b) => a.updatedAt - b.updatedAt);
  const sellOf = (o: Order, productId: Id) => { const a = o.assignmentIds.map((id) => s.assignments[id]).find((x) => x && x.productId === productId); return a?.rcontrol?.price ?? listPriceMine(e, me, productId); };
  const revenueOf = (o: Order) => o.items.reduce((t, it) => { const sell = sellOf(o, it.productId); const units = o.kind === "renewal" ? 1 : it.qty, periods = o.kind === "renewal" ? it.qty : (o.periods ?? 1); return t + (sell === undefined ? 0 : sell * units * periods); }, 0);
  const paidOf = (o: Order) => { const a = o.assignmentIds.map((id) => s.assignments[id]).find(Boolean); return (a?.rcontrol?.payStatus ?? "pagado") === "pagado"; };
  const ventas: ProRow[] = orders.map((o) => { const rev = revenueOf(o), cost = paidTotal(o); return [td(bo(o.updatedAt), { numFmt: "dd/mm/yyyy" }), td(s.customers[o.customerId]?.name ?? "—"), td(o.kind === "sale" ? "Venta" : "Renovación"), td(o.items.map((i) => `${i.qty} × ${s.products[i.productId]?.name ?? i.productId}`).join(", ")), num(rev / 100, fmt), num(cost / 100, costFmt), split ? td("—") : num((rev - cost) / 100, fmt, { bold: true }), td(paidOf(o) ? "Pagado" : "Te debe", { color: paidOf(o) ? C.ok : C.bad, bold: true })]; });
  const by = new Map<Id, { name: string; units: number; rev: Cents; cost: Cents }>();
  for (const o of orders) for (const it of o.items) { const b = by.get(it.productId) ?? { name: s.products[it.productId]?.name ?? it.productId, units: 0, rev: 0, cost: 0 }; const sell = sellOf(o, it.productId) ?? 0; const units = o.kind === "renewal" ? 1 : it.qty, periods = o.kind === "renewal" ? it.qty : (o.periods ?? 1); b.units += units; b.rev += sell * units * periods; b.cost += Math.round(paidTotal(o) * (o.items.length === 1 ? 1 : it.qty / o.items.reduce((t, x) => t + x.qty, 0))); by.set(it.productId, b); }
  const prodRows = [...by.values()].sort((a, b) => b.rev - a.rev);
  const porProducto: ProRow[] = prodRows.map((p) => [td(p.name), num(p.units, "0"), num(p.rev / 100, fmt), num(p.cost / 100, costFmt), split ? td("—") : num((p.rev - p.cost) / 100, fmt, { bold: true })]);
  const earn = myEarnings(e, actor);
  const months = [...earn.months].reverse();
  const mensual: ProRow[] = months.map((m) => [td(monthLabel(m.key)), num(m.revenue / 100, fmt), num(m.collected / 100, fmt), num(m.cost / 100, costFmt), m.profit === null ? td("—") : num(m.profit / 100, fmt, { bold: true })]);
  const fi = fiadoOverview(e, actor);
  const subs = mySubs(e, actor).flatMap((r) => r.subs.map((x) => ({ ...x, product: r.product })));
  const deudas: ProRow[] = [
    ...fi.rows.map((r) => [td(r.name), td(r.phone), td("Libreta"), num(r.owed / 100, fmt), td(r.nextDue ? bo(r.nextDue) : "", { numFmt: "dd/mm/yyyy" }), td(r.overdue ? "Vencido" : "Pendiente", { color: r.overdue ? C.bad : C.warn, bold: true })]),
    ...subs.filter((x) => x.pay !== "pagado").map((x) => [td(x.name), td(x.phone), td(`Perfil repartido · ${x.product}${x.label ? ` (${x.label})` : ""}`), num((x.price ?? 0) / 100, fmt), td(bo(x.expiresAt), { numFmt: "dd/mm/yyyy" }), td(x.pay === "no_pago" ? "No pagó" : "Pendiente", { color: C.warn, bold: true })]),
  ];
  const PAY: Record<string, string> = { pagado: "Pagado", pendiente: "Pendiente", no_pago: "No pagó" };
  const ctl = myControl(e, actor);
  const daysOf = (t: number) => Math.round((boDayStart(t) - boDayStart(now)) / DAY);
  const venc: ProRow[] = [
    ...ctl.map((r) => [td(r.client), td(r.phone), td(r.product), td(r.profile ?? ""), td(bo(r.expiresAt), { numFmt: "dd/mm/yyyy" }), num(daysOf(r.expiresAt), "0", { color: daysOf(r.expiresAt) < 0 ? C.bad : daysOf(r.expiresAt) <= 3 ? C.warn : C.ink }), td(PAY[r.pay] ?? r.pay, { color: r.pay === "pagado" ? C.ok : C.bad }), num((r.price ?? 0) / 100, fmt)]),
    ...subs.map((x) => [td(x.name), td(x.phone), td(`${x.product} (perfil repartido)`), td(x.label), td(bo(x.expiresAt), { numFmt: "dd/mm/yyyy" }), num(daysOf(x.expiresAt), "0", { color: daysOf(x.expiresAt) < 0 ? C.bad : daysOf(x.expiresAt) <= 3 ? C.warn : C.ink }), td(PAY[x.pay] ?? x.pay, { color: x.pay === "pagado" ? C.ok : C.bad }), num((x.price ?? 0) / 100, fmt)]),
  ].sort((a, b) => ((a[4] as ProCell).v as Date).getTime() - ((b[4] as ProCell).v as Date).getTime());
  const cl = myCustomers(e, actor).sort((a, b) => a.name.localeCompare(b.name, "es"));
  const clientes: ProRow[] = cl.map((c) => [td(c.name), td(c.phone), num(c.services, "0"), td(c.nextExpiry ? bo(c.nextExpiry) : "", { numFmt: "dd/mm/yyyy" }), td(c.note ?? ""), td(bo(c.createdAt), { numFmt: "dd/mm/yyyy" })]);
  const totalRev = orders.reduce((t, o) => t + revenueOf(o), 0), totalCost = orders.reduce((t, o) => t + paidTotal(o), 0);
  const owed = fi.totals.owed + subs.filter((x) => x.pay !== "pagado").reduce((t, x) => t + (x.price ?? 0), 0);
  const name = (me.shop?.title || me.name).trim();
  const portada = cover(name, "Reporte de mi negocio", per, sym, origin, [
    ["Vendiste", { f: `SUM(Ventas!E5:E${4 + Math.max(ventas.length, 1)})`, fmt }, "a tus precios, ventas y renovaciones entregadas"],
    ["Le pagaste a la tienda", totalCost / 100, split ? `en ${s.settings.currencySymbol || "Bs"}` : "lo que te costaron esas ventas", true],
    ["Te quedó", split ? "—" : { f: "B6-B7", fmt }, split ? "monedas distintas: no se restan" : "vendiste menos lo pagado: no es lo mismo que vendiste"],
    ["Ventas", orders.filter((o) => o.kind === "sale").length, ""], ["Renovaciones", orders.filter((o) => o.kind === "renewal").length, ""],
    ["Clientes", cl.length, ""], ["Servicios activos", ctl.length + subs.length, "clientes registrados + perfiles repartidos"],
    ["Vencen en 7 días", venc.filter((r) => { const d = (r[5] as ProCell).v as number; return d >= 0 && d <= 7; }).length, ""],
    ["Te deben", owed / 100, "libreta + perfiles sin pagar", true],
  ], fmt);
  const n = Math.max(prodRows.length, 1), nm = Math.max(months.length, 1);
  const totV: Record<number, string> = { 4: fmt, 5: costFmt }, totP: Record<number, string> = { 1: "0", 2: fmt, 3: costFmt };
  if (!split) { totV[6] = fmt; totP[4] = fmt; }
  const book: Workbook = { creator: name, title: `Reporte ${name} ${fdate(per.from)} a ${fdate(per.to)}`, sheets: [
    portada,
    table("Resumen", "Mes a mes", "Últimos meses · lo que vendiste, cobraste y te quedó", ["Mes", `Vendiste (${sym})`, `Cobraste (${sym})`, "Le pagaste a la tienda", `Te quedó (${sym})`], mensual, [14, 16, 16, 20, 16], { tab: C.gold, charts: [{ type: "column", title: "Vendiste por mes", categories: `A5:A${4 + nm}`, series: [{ name: "Vendiste", values: `B5:B${4 + nm}`, color: C.gold }, { name: "Le pagaste a la tienda", values: `D5:D${4 + nm}`, color: C.muted }], anchor: { col: 6, row: 3, cols: 8, rows: 16 } }] }),
    table("Ventas", "Mis ventas", `${fdate(per.from)} a ${fdate(per.to)} · ${orders.length} entregada${orders.length === 1 ? "" : "s"}`, ["Fecha", "Cliente", "Tipo", "Detalle", `Vendiste (${sym})`, "Le pagaste a la tienda", `Te quedó (${sym})`, "Te pagó"], ventas, [12, 24, 12, 34, 14, 18, 14, 10], { totals: totV, tab: "#16a34a" }),
    table("Por producto", "Ventas por producto", `${fdate(per.from)} a ${fdate(per.to)}`, ["Producto", "Unidades", `Vendiste (${sym})`, "Le pagaste a la tienda", `Te quedó (${sym})`], porProducto, [30, 12, 16, 18, 14], { totals: totP, charts: [{ type: "bar", title: "Vendiste por producto", categories: `A5:A${4 + n}`, series: [{ name: "Vendiste", values: `C5:C${4 + n}`, color: C.navy }], anchor: { col: 6, row: 3, cols: 8, rows: 14 } }, { type: "pie", title: "Participación", categories: `A5:A${4 + n}`, series: [{ name: "Vendiste", values: `C5:C${4 + n}` }], anchor: { col: 6, row: 19, cols: 8, rows: 14 } }] }),
    table("Cobros y deudas", "Quién me debe", `Al ${fdate(now)}`, ["Cliente", "WhatsApp", "De dónde", `Debe (${sym})`, "Vence", "Estado"], deudas, [26, 16, 30, 14, 12, 12], { totals: { 3: fmt }, tab: C.bad }),
    table("Vencimientos", "Mis suscripciones y vencimientos", `Al ${fdate(now)} · ${venc.length} servicio${venc.length === 1 ? "" : "s"}`, ["Cliente", "WhatsApp", "Producto", "Perfil", "Vence", "Días", "Pago", `Precio (${sym})`], venc, [24, 16, 28, 14, 12, 8, 12, 12], { tab: C.warn }),
    table("Clientes", "Mis clientes", `${cl.length} en total`, ["Nombre", "WhatsApp", "Servicios activos", "Próximo vencimiento", "Nota", "Alta"], clientes, [28, 16, 14, 16, 30, 12]),
  ] };
  return { book, name: `reporte-${slug(name)}-${monthKey(per.from)}.xlsx` };
}

/** Portada: nombre, período, fecha de generación e indicadores con sus aclaraciones. */
function cover(business: string, kind: string, per: Period, sym: string, origin: string | undefined, kpis: [string, number | string | { f: string; fmt: string }, string, boolean?][], fmt: string): ProSheet {
  const rows: ProRow[] = [
    [cell(business, { bold: true, size: 24, color: C.navy })],
    [cell(kind, { size: 14, color: C.muted })],
    [cell(`Período: ${fdate(per.from)} a ${fdate(per.to)} · generado el ${fdate(Date.now())} · montos en ${sym}`, SUB)],
    [],
    [cell("Indicadores", SEC), cell("Valor", SEC), cell("Qué es", SEC)],
    ...kpis.map(([k, v, note, isMoney]): ProRow => [cell(k, { ...KL, border: true }), typeof v === "object" ? ({ f: v.f, s: { ...KV, numFmt: v.fmt, border: true, align: "right" } } as ProCell) : typeof v === "number" ? cell(v, { ...KV, numFmt: isMoney ? fmt : "0", border: true, align: "right" }) : cell(v, { ...KV, border: true, align: "right" }), cell(note, { ...KL, italic: true, border: true, wrap: true })]),
    [],
    [cell(`Hojas: Resumen (mes a mes, con gráfico) · Ventas · Por producto (con gráficos) · Cobros y deudas · Vencimientos · Clientes${kind === "Reporte del negocio" ? " · Gastos · Proveedores" : ""}.`, SUB)],
    [cell("Los ingresos siguen la misma regla que el panel: pedidos entregados, cobros del Control y pagos del fiado de la tienda, sin contar dos veces el mismo pago. Ingresos no es ganancia.", { ...SUB, italic: true })],
    ...(origin ? [[cell(origin, { color: "#2563eb" }, { link: origin })]] : []),
  ];
  return { name: "Portada", rows, widths: [34, 20, 60], heights: { 0: 34, 1: 22 }, merges: ["A1:C1", "A2:C2", "A3:C3"], gridLines: false, tabColor: C.navy };
}

const slug = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "negocio";

/** El reporte de quien pide (tienda o revendedor), como archivo .xlsx. */
export function businessReport(store: GabrielStore, actor: Actor, per: Period, origin?: string): { file: Buffer; name: string } {
  const b = actor.role === "reseller" && actor.customerId ? resellerReport(store, actor, per, origin) : actor.role === "owner" || actor.role === "admin" || actor.role === "seller" ? storeReport(store, actor, per, origin) : null;
  if (!b) throw new DomainError("FORBIDDEN", "Solo la tienda o un revendedor pueden exportar su reporte");
  return { file: writeXlsxPro(b.book), name: b.name };
}
