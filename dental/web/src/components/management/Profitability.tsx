import { Fragment, useState } from "react";
import { Link } from "react-router-dom";
import { useApi } from "../../lib/hooks";
import { qs } from "../../lib/api";
import { bs } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Empty, Field, Loading } from "../ui";
import { ExportLink, InfoButton, Money, MonthPicker, Variation, thisMonth } from "./shared";

type Key = "productionCents" | "collectedCents" | "labCents" | "materialsCents" | "feesCents" | "pettyCashCents" | "expensesCents" | "marginCents" | "cashMarginCents";
const ROWS: { key: Key; label: string; cost?: boolean; strong?: boolean; link?: [string, string] }[] = [
  { key: "productionCents", label: "Producción", link: ["/reportes", "Ver reportes"] },
  { key: "collectedCents", label: "Cobrado", link: ["/caja", "Ver caja"] },
  { key: "labCents", label: "Costo de laboratorio", cost: true, link: ["/laboratorio", "Ir a Laboratorio"] },
  { key: "materialsCents", label: "Costo de materiales", cost: true, link: ["/inventario", "Ir a Inventario"] },
  { key: "feesCents", label: "Honorarios liquidados", cost: true, link: ["/honorarios", "Ir a Honorarios"] },
  { key: "pettyCashCents", label: "Gastos menores de caja", cost: true, link: ["/caja", "Ir a Caja"] },
  { key: "expensesCents", label: "Gastos de la sucursal", cost: true, link: ["/gestion?tab=gastos", "Ir a Gastos"] },
  { key: "marginCents", label: "Margen (sobre producción)", strong: true },
  { key: "cashMarginCents", label: "Margen de caja (sobre lo cobrado)", strong: true },
];

function Explain({ text, link }: { text: string; link?: [string, string] }) {
  return <>{text} {link && <Link to={link[0]}>{link[1]} →</Link>}</>;
}

export function ProfitabilityTab() {
  const { branchId } = useAuth();
  const [month, setMonth] = useState(thisMonth);
  const [chairBranch, setChairBranch] = useState<string | null>(null);
  const [open, setOpen] = useState<Key | null>(null);
  const r = useApi<any>(`/api/management/profitability${qs({ month, branchId })}`);
  const d = r.data;
  const toggle = (k: Key) => setOpen(open === k ? null : k);
  const many = (d?.branches.length ?? 0) > 1;
  const detail = d ? d.branches.find((b: any) => b.branchId === (chairBranch ?? d.branches[0]?.branchId)) ?? d.branches[0] : null;
  const costOf = (x: any) => ["labCents", "materialsCents", "feesCents", "pettyCashCents", "expensesCents"].reduce((s, k) => s + (x[k] ?? 0), 0);
  const missingLabel = (m: string[]) => m.map((k) => ROWS.find((r) => r.key === k)?.label.toLowerCase()).join(", ");
  return (
    <div className="stack">
      <div className="card card-pad mg-toolbar" style={{ justifyContent: "space-between" }}>
        <MonthPicker value={month} onChange={setMonth} max={thisMonth()} />
        <ExportLink href={`/api/management/profitability.xlsx${qs({ month, branchId })}`} />
      </div>
      {r.error && <div className="alert danger" role="alert">{r.error}</div>}
      {!d ? <Loading rows={6} /> : d.branches.length === 0 ? <Empty>No hay sucursales activas en tu alcance.</Empty> : (
        <>
          <div className="grid grid-4">
            <div className="card kpi"><div className="label">Producción</div><div className="value mg-kpi-value">{bs(d.total.productionCents)}</div><div className="foot"><Variation pct={d.total.variation.productionPct} /> vs. {d.previous.label}</div></div>
            <div className="card kpi"><div className="label">Cobrado</div><div className="value mg-kpi-value">{bs(d.total.collectedCents)}</div><div className="foot"><Variation pct={d.total.variation.collectedPct} /> vs. {d.previous.label}</div></div>
            <div className="card kpi"><div className="label">Costos y gastos</div><div className="value mg-kpi-value">{bs(costOf(d.total))}</div><div className="foot">Laboratorio, materiales, honorarios y gastos</div></div>
            <div className="card kpi"><div className="label">Margen {d.total.complete ? "" : "(parcial)"}</div>
              <div className={`value mg-kpi-value ${d.total.marginCents < 0 ? "mg-neg" : ""}`}>{bs(d.total.marginCents)}</div>
              <div className="foot">{d.total.marginPct == null ? "Sin producción" : `${d.total.marginPct.toLocaleString("es-BO")} % de la producción`}</div></div>
          </div>

          {!d.total.complete && (
            <div className="alert warn" role="note">
              Margen parcial: algunas sucursales no tienen datos de {missingLabel(d.total.missing)} en {d.label}. No se asume cero; esos márgenes se marcan con <b>*</b>. Revisa la fuente con el botón <b>ⓘ</b> de cada concepto.
            </div>
          )}
          {d.branches.some((b: any) => b.draftExpenses > 0) && (
            <div className="alert info" role="note">
              Hay {d.branches.reduce((s: number, b: any) => s + b.draftExpenses, 0)} gasto(s) en borrador en {d.label} que todavía no cuentan. <Link to="/gestion?tab=gastos">Revisar y confirmar →</Link>
            </div>
          )}
          {d.branches.some((b: any) => b.unsettledProfessionals > 0) && (
            <div className="alert info" role="note">
              {d.branches.reduce((s: number, b: any) => s + b.unsettledProfessionals, 0)} profesional(es) con producción en el mes aún sin liquidación cerrada: sus honorarios no están en el margen. <Link to="/honorarios">Ir a Honorarios →</Link>
            </div>
          )}

          {/* Escritorio: conceptos × sucursales */}
          <div className="card mg-only-desktop">
            <div className="card-head"><h2>Estado de resultados por sucursal</h2><span className="muted small">{d.label}</span></div>
            <div className="table-wrap">
              <table className="table mg-matrix">
                <thead><tr><th>Concepto</th>{d.branches.map((b: any) => <th key={b.branchId} className="num">{b.branchName}</th>)}{many && <th className="num">Consolidado</th>}</tr></thead>
                <tbody>
                  {ROWS.map((row) => (
                    <Fragment key={row.key}>
                      <tr className={row.strong ? "mg-total" : undefined}>
                        <td><span className="mg-concept">{row.cost ? "− " : ""}{row.label}<InfoButton label={row.label} open={open === row.key} onClick={() => toggle(row.key)} /></span></td>
                        {d.branches.map((b: any) => <td key={b.branchId} className="num"><Money cents={b[row.key]} signed={row.strong} />{row.strong && !b.complete && <sup className="mg-partial" title={`Margen parcial: falta ${missingLabel(b.missing)}`} aria-label={`margen parcial, falta ${missingLabel(b.missing)}`}>*</sup>}</td>)}
                        {many && <td className="num"><b><Money cents={d.total[row.key]} signed={row.strong} /></b>{row.strong && !d.total.complete && <sup className="mg-partial" title={`Margen parcial: falta ${missingLabel(d.total.missing)}`} aria-label={`margen parcial, falta ${missingLabel(d.total.missing)}`}>*</sup>}</td>}
                      </tr>
                      {open === row.key && <tr className="mg-explain"><td colSpan={d.branches.length + (many ? 2 : 1)}><Explain text={d.sources[row.key]} link={row.link} /></td></tr>}
                    </Fragment>
                  ))}
                  <tr><td className="muted">Variación de la producción vs. {d.previous.label}</td>{d.branches.map((b: any) => <td key={b.branchId} className="num"><Variation pct={b.variation.productionPct} /></td>)}{many && <td className="num"><Variation pct={d.total.variation.productionPct} /></td>}</tr>
                  <tr><td className="muted">Variación del margen</td>{d.branches.map((b: any) => <td key={b.branchId} className="num"><Variation pct={b.variation.marginPct} /></td>)}{many && <td className="num"><Variation pct={d.total.variation.marginPct} /></td>}</tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Celular: una tarjeta por sucursal */}
          <div className="mg-only-mobile stack">
            <h2 style={{ fontSize: 16 }}>Estado de resultados · {d.label}</h2>
            {open && <div className="mg-explain-box" role="note"><b>{ROWS.find((x) => x.key === open)?.label}:</b> <Explain text={d.sources[open]} link={ROWS.find((x) => x.key === open)?.link} /></div>}
            {[...d.branches, ...(many ? [{ ...d.total, branchId: "total", branchName: "Consolidado" }] : [])].map((b: any) => (
              <div key={b.branchId} className="card">
                <div className="card-head"><h3>{b.branchName}</h3>{b.complete === false && <span className="badge warn">margen parcial</span>}</div>
                <div className="card-pad stack-sm" style={{ paddingTop: 8, paddingBottom: 8 }}>
                  {ROWS.map((row) => (
                    <div key={row.key} className="mg-line" style={row.strong ? { fontWeight: 700 } : undefined}>
                      <span className="mg-concept">{row.cost ? "− " : ""}{row.label}<InfoButton label={row.label} open={open === row.key} onClick={() => toggle(row.key)} /></span>
                      <span className="num"><Money cents={b[row.key]} signed={row.strong} /></span>
                    </div>
                  ))}
                  {b.variation && <div className="row-between small"><span className="muted">Producción vs. {d.previous.label}</span><Variation pct={b.variation.productionPct} /></div>}
                </div>
              </div>
            ))}
          </div>

          {detail && (
            <div className="card">
              <div className="card-head" style={{ flexWrap: "wrap" }}>
                <h2>Rentabilidad por sillón</h2>
                {d.branches.length > 1 && (
                  <Field label="Sucursal">
                    <select className="input" value={detail.branchId} onChange={(e) => setChairBranch(e.target.value)}>
                      {d.branches.map((b: any) => <option key={b.branchId} value={b.branchId}>{b.branchName}</option>)}
                    </select>
                  </Field>
                )}
              </div>
              {detail.chairs?.length ? (
                <div className="table-wrap">
                  <table className="table mg-cards">
                    <thead><tr><th>Sillón</th><th className="num">Producción</th><th className="num">Horas atendidas</th><th className="num">Producción por hora</th><th className="num">Costos asignados</th><th className="num">Margen</th></tr></thead>
                    <tbody>
                      {detail.chairs.map((ch: any) => {
                        const costs = ["labCents", "materialsCents", "feesCents", "pettyCashCents", "expensesCents"].every((k) => ch[k] == null) ? null : costOf(ch);
                        return (
                          <tr key={ch.chairId ?? "none"}>
                            <td className="mg-head">{ch.chairName}</td>
                            <td className="num" data-label="Producción">{bs(ch.productionCents)}</td>
                            <td className="num" data-label="Horas atendidas">{(ch.attendedMinutes / 60).toLocaleString("es-BO", { maximumFractionDigits: 1 })} h</td>
                            <td className="num" data-label="Producción por hora">{ch.productionPerHourCents == null ? "—" : bs(ch.productionPerHourCents)}</td>
                            <td className="num" data-label="Costos asignados"><Money cents={costs} /></td>
                            <td className="num" data-label="Margen"><b><Money cents={ch.marginCents} signed /></b></td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot><tr><td className="mg-head">Total {detail.branchName}</td><td className="num" data-label="Producción">{bs(detail.productionCents)}</td><td className="mg-empty-cell" /><td className="mg-empty-cell" /><td className="num" data-label="Costos asignados">{bs(costOf(detail))}</td><td className="num" data-label="Margen"><Money cents={detail.marginCents} signed /></td></tr></tfoot>
                  </table>
                </div>
              ) : <Empty>La sucursal no tiene sillones registrados.</Empty>}
              <div className="card-pad"><p className="muted small" style={{ margin: 0 }}>{d.chairNote}</p></div>
            </div>
          )}

          {detail && detail.expensesByCategory.length > 0 && (
            <div className="card">
              <div className="card-head"><h2>Gastos por categoría · {detail.branchName}</h2><Link to="/gestion?tab=gastos" className="btn btn-sm">Ver gastos</Link></div>
              <div className="card-pad stack-sm">
                {detail.expensesByCategory.map((x: any) => {
                  const pct = detail.expensesCents ? (x.amountCents / detail.expensesCents) * 100 : 0;
                  return (
                    <div key={x.category} className="bar-row" style={{ gridTemplateColumns: "minmax(110px, 180px) 1fr 110px" }}>
                      <span className="small">{x.label}</span>
                      <div className="bar-track" aria-hidden="true"><div className="bar-fill" style={{ width: `${pct}%` }} /></div>
                      <span className="num small">{bs(x.amountCents)}</span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
