import { useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { qs } from "../lib/api";
import { bs, fmtDate, localDate } from "../lib/format";
import { Empty, Field, Loading } from "../components/ui";
import { VisitQualitySection } from "../components/VisitQuality";
import { ReceivablesAging } from "../components/agreements/PayerTransfers";

function currentMonth() {
  const today = localDate();
  const [y, m] = today.split("-").map(Number) as [number, number];
  const from = `${y}-${String(m).padStart(2, "0")}-01`;
  const to = new Date(Date.UTC(y, m, 0)).toISOString().slice(0, 10);
  return { from, to };
}

export function ReportsPage() {
  const { can } = useAuth();
  const [range, setRange] = useState(currentMonth);
  const fin = can("reports.financial");
  const op = can("reports.operational");
  const prod = useApi<any[]>(fin ? `/api/reports/production-by-dentist${qs(range)}` : null);
  const rec = useApi<any[]>(fin ? "/api/reports/receivables" : null);
  const noNext = useApi<any[]>(op ? "/api/reports/patients-without-next-appointment" : null);
  const totalProd = (prod.data ?? []).reduce((s, x) => s + Number(x.productionCents), 0);
  const totalComm = (prod.data ?? []).reduce((s, x) => s + Number(x.commissionCents ?? 0), 0);
  const totalRec = (rec.data ?? []).reduce((s, x) => s + Number(x.balanceCents), 0);
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div><h1>Reportes</h1><p className="sub">Producción, comisiones, cuentas por cobrar y seguimiento de pacientes</p></div>
        <div className="row" style={{ alignItems: "flex-end" }}>
          <Field label="Desde"><input className="input" type="date" value={range.from} onChange={(e) => e.target.value && setRange({ ...range, from: e.target.value })} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={range.to} onChange={(e) => e.target.value && setRange({ ...range, to: e.target.value })} /></Field>
        </div>
      </div>

      <div className="card card-pad row">
        <b>Exportar:</b>
        {fin && <a className="btn btn-sm" href={`/api/reports/payments.xlsx${qs(range)}`}><Download size={15} />Pagos (Excel)</a>}
        {(op || fin) && <a className="btn btn-sm" href={`${op ? "/api/reports/dashboard.xlsx" : "/api/reports/finance-dashboard.xlsx"}${qs(range)}`}><Download size={15} />Panel por sucursal (Excel)</a>}
        {fin && <a className="btn btn-sm" href={`/api/reports/production-by-dentist.xlsx${qs(range)}`}><Download size={15} />Producción por profesional (Excel)</a>}
        {fin && <a className="btn btn-sm" href="/api/reports/receivables.xlsx"><Download size={15} />Cuentas por cobrar (Excel)</a>}
        {op && <a className="btn btn-sm" href="/api/reports/patients-without-next-appointment.xlsx"><Download size={15} />Pacientes sin próxima cita (Excel)</a>}
        {fin && <a className="btn btn-sm" href="/gestion">Rentabilidad y gastos →</a>}
        {can("patients.export") && <a className="btn btn-sm" href="/api/patients/export.xlsx"><Download size={15} />Pacientes (Excel)</a>}
        {!fin && !can("patients.export") && <span className="muted small">Tu rol no tiene exportaciones disponibles.</span>}
        <span className="muted small">Cada exportación queda registrada en la auditoría.</span>
      </div>

      {fin && (
        <div className="card">
          <div className="card-head"><h2>Producción por profesional</h2><span className="muted small">{fmtDate(range.from + "T12:00:00Z")} a {fmtDate(range.to + "T12:00:00Z")}</span></div>
          {!prod.data ? <Loading /> : prod.data.length === 0 ? <Empty>Sin tratamientos realizados en el período.</Empty> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Profesional</th><th className="num">Tratamientos</th><th className="num">Producción</th><th className="num">% comisión</th><th className="num">Comisión estimada</th></tr></thead>
                <tbody>
                  {prod.data.map((x) => (
                    <tr key={x.dentistId}>
                      <td><b>{x.dentistName}</b></td>
                      <td className="num">{x.treatments}</td>
                      <td className="num">{bs(Number(x.productionCents))}</td>
                      <td className="num">{x.commissionPct != null ? `${x.commissionPct}%` : "—"}</td>
                      <td className="num">{x.commissionCents != null ? bs(x.commissionCents) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot><tr><td>Total</td><td /><td className="num">{bs(totalProd)}</td><td /><td className="num">{bs(totalComm)}</td></tr></tfoot>
              </table>
            </div>
          )}
          <div className="card-pad"><p className="muted small">La comisión se calcula como producción × % configurado para cada profesional. Es una <b>estimación</b>: la liquidación de honorarios definitiva (sobre lo cobrado, descuentos de laboratorio, etc.) queda pendiente de revisión por administración.</p></div>
        </div>
      )}

      <div className="grid grid-2">
        {fin && (
          <div className="card">
            <div className="card-head"><h2>Cuentas por cobrar</h2><b className="num">{bs(totalRec)}</b></div>
            {!rec.data ? <Loading /> : rec.data.length === 0 ? <Empty>Ningún paciente tiene saldo pendiente.</Empty> : (
              <div className="table-wrap" style={{ maxHeight: 480, overflowY: "auto" }}>
                <table className="table">
                  <thead><tr><th>Paciente</th><th className="num">Saldo</th><th className="hide-mobile">Último pago</th></tr></thead>
                  <tbody>
                    {rec.data.map((x) => (
                      <tr key={x.patientId}>
                        <td><Link to={`/pacientes/${x.patientId}`}>{x.name}</Link></td>
                        <td className="num"><b>{bs(Number(x.balanceCents))}</b></td>
                        <td className="hide-mobile small">{x.lastPaymentAt ? fmtDate(x.lastPaymentAt) : <span className="muted">Nunca</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
        {op && (
          <div className="card">
            <div className="card-head"><h2>Pacientes sin próxima cita</h2><span className="muted small">Atendidos en los últimos 12 meses</span></div>
            {!noNext.data ? <Loading /> : noNext.data.length === 0 ? <Empty>Todos los pacientes atendidos tienen una próxima cita.</Empty> : (
              <div className="card-pad stack">
                {noNext.data.map((d) => (
                  <details key={d.dentistId} className="card" style={{ padding: "10px 14px" }}>
                    <summary className="row-between" style={{ cursor: "pointer" }}>
                      <b>{d.dentistName}</b><span className="badge warn">{d.patients} pacientes</span>
                    </summary>
                    <div className="stack-sm" style={{ marginTop: 10 }}>
                      {(d.sample ?? []).map((p: any) => (
                        <div key={p.patientId} className="row-between small">
                          <Link to={`/pacientes/${p.patientId}`}>{p.name}</Link>
                          <span className="muted">Última visita {fmtDate(p.lastVisit)}</span>
                        </div>
                      ))}
                      {d.patients > (d.sample?.length ?? 0) && <span className="muted small">… y {d.patients - d.sample.length} más</span>}
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      {fin && <ReceivablesAging />}
      {op && <VisitQualitySection range={range} />}
      {!fin && !op && <Empty>Tu rol no tiene reportes disponibles.</Empty>}
    </div>
  );
}
