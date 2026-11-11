import { useApi } from "../../lib/hooks";
import { qs } from "../../lib/api";
import { bs, fmtDate } from "../../lib/format";
import { useAuth } from "../../lib/auth";
import { Loading } from "../ui";
import { ExportLink, Variation } from "./shared";

const d = (iso: string) => fmtDate(`${iso}T12:00:00Z`);

/** Comparación del rango del Panel con el período anterior de igual tamaño (B-017). */
export function PeriodCompare({ from, to }: { from: string; to: string }) {
  const { can } = useAuth();
  const op = can("reports.operational");
  const base = op ? "/api/reports/dashboard-compare" : can("reports.financial") ? "/api/reports/finance-dashboard-compare" : null;
  const r = useApi<any>(base ? `${base}${qs({ from, to })}` : null);
  if (!base) return null;
  const c = r.data;
  return (
    <div className="card">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <div>
          <h2>Comparación con el período anterior</h2>
          {c && <span className="muted small">{d(c.range.from)} – {d(c.range.to)} frente a {d(c.previousRange.from)} – {d(c.previousRange.to)}</span>}
        </div>
        <ExportLink small href={`${op ? "/api/reports/dashboard.xlsx" : "/api/reports/finance-dashboard.xlsx"}${qs({ from, to })}`} />
      </div>
      {!c ? <Loading rows={3} /> : (
        <div className="table-wrap">
          <table className="table mg-cards">
            <thead><tr><th>Sucursal</th>{c.financial && <><th className="num">Cobrado</th><th className="num">Var.</th><th className="num">Producción</th><th className="num">Var.</th></>}<th className="num">Citas</th><th className="num">Var.</th><th className="num">Ocupación</th><th className="num">Inasistencia</th></tr></thead>
            <tbody>
              {c.branches.map((b: any) => (
                <tr key={b.branchId}>
                  <td className="mg-head">{b.branchName}</td>
                  {c.financial && <>
                    <td className="num" data-label="Cobrado">{bs(b.current.collectedCents)} <span className="muted small hide-mobile">(antes {bs(b.previous.collectedCents)})</span></td>
                    <td className="num" data-label="Var. cobrado"><Variation pct={b.variation.collectedPct} /></td>
                    <td className="num" data-label="Producción">{bs(b.current.productionCents)} <span className="muted small hide-mobile">(antes {bs(b.previous.productionCents)})</span></td>
                    <td className="num" data-label="Var. producción"><Variation pct={b.variation.productionPct} /></td>
                  </>}
                  <td className="num" data-label="Citas">{b.current.appointments} <span className="muted small">(antes {b.previous.appointments})</span></td>
                  <td className="num" data-label="Var. citas"><Variation pct={b.variation.appointmentsPct} /></td>
                  <td className="num" data-label="Ocupación">{b.current.occupancyPct == null ? "—" : `${b.current.occupancyPct}%`} <Variation pct={b.variation.occupancyPp} suffix="pp" /></td>
                  <td className="num" data-label="Inasistencia">{b.current.noShowRate == null ? "—" : `${b.current.noShowRate}%`} <Variation pct={b.variation.noShowRatePp == null ? null : -b.variation.noShowRatePp} suffix="pp" /></td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr>
                <td className="mg-head">Total</td>
                {c.financial && <>
                  <td className="num" data-label="Cobrado">{bs(c.totals.current.collectedCents)}</td><td className="num" data-label="Var. cobrado"><Variation pct={c.totals.variation.collectedPct} /></td>
                  <td className="num" data-label="Producción">{bs(c.totals.current.productionCents)}</td><td className="num" data-label="Var. producción"><Variation pct={c.totals.variation.productionPct} /></td>
                </>}
                <td className="num" data-label="Citas">{c.totals.current.appointments}</td><td className="num" data-label="Var. citas"><Variation pct={c.totals.variation.appointmentsPct} /></td>
                <td className="mg-empty-cell" /><td className="mg-empty-cell" />
              </tr>
            </tfoot>
          </table>
        </div>
      )}
      <div className="card-pad"><p className="muted small" style={{ margin: 0 }}>«—» significa que el período anterior fue cero (no hay base para un porcentaje). En inasistencia, una baja se muestra en verde. pp = puntos porcentuales.</p></div>
    </div>
  );
}
