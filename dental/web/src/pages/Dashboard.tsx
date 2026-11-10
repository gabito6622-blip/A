import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { addDays, bs, fmtTime, localDate } from "../lib/format";
import { qs } from "../lib/api";
import { Empty, Loading, StatusBadge } from "../components/ui";
import { HomeCards } from "../components/coordination/HomeCards";

function monthRange(offset: number) {
  const today = localDate();
  const [y, m] = today.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const from = d.toISOString().slice(0, 10);
  const to = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).toISOString().slice(0, 10);
  const raw = new Intl.DateTimeFormat("es-BO", { month: "long", year: "numeric", timeZone: "UTC" }).format(d);
  const label = raw.charAt(0).toUpperCase() + raw.slice(1);
  return { from, to, label };
}

export function DashboardPage() {
  const { me, can, branchId } = useAuth();
  const [offset, setOffset] = useState(0);
  const range = monthRange(offset);
  const url = can("reports.operational") ? `/api/reports/dashboard${qs({ from: range.from, to: range.to })}` : can("reports.financial") ? `/api/reports/finance-dashboard${qs({ from: range.from, to: range.to })}` : null;
  const dash = useApi(url);
  const today = localDate();
  const appts = useApi(can("agenda.read") ? `/api/appointments${qs({ from: `${today}T00:00:00-04:00`, to: `${addDays(today, 1)}T00:00:00-04:00`, branchId })}` : null);
  const myDay = useApi<any>(me?.membership?.isProfessional && can("agenda.read") ? "/api/my-day" : null);
  const d = dash.data;
  // Personal de limpieza y apoyo: su inicio es Bioseguridad.
  if (!can("agenda.read") && !can("reports.operational") && !can("reports.financial") && can("biosafety.read")) return <Navigate to="/bioseguridad" replace />;
  const maxCollected = d ? Math.max(1, ...d.branches.map((b: any) => b.collectedCents ?? 0)) : 1;
  const maxProd = d ? Math.max(1, ...d.branches.map((b: any) => b.productionCents ?? 0)) : 1;
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div>
          <h1>Hola, {me?.user.fullName.split(" ").slice(0, 2).join(" ")}</h1>
          <p className="sub">{me?.clinic?.name} · {me?.membership?.roleLabel}</p>
        </div>
        {url && (
          <div className="row">
            <button className="btn btn-sm" onClick={() => setOffset(offset - 1)} aria-label="Mes anterior">‹</button>
            <span style={{ fontWeight: 620, minWidth: 130, textAlign: "center" }}>{range.label}</span>
            <button className="btn btn-sm" onClick={() => setOffset(offset + 1)} disabled={offset >= 0} aria-label="Mes siguiente">›</button>
          </div>
        )}
      </div>

      <HomeCards />

      {myDay.data?.professional && (
        <div className="card">
          <div className="card-head"><h2>Mis pacientes de hoy</h2><span className="badge brand">{myDay.data.appointments.length}</span></div>
          {myDay.data.appointments.length ? (
            <div className="stack" style={{ padding: 12, gap: 10 }}>
              {myDay.data.appointments.map((a: any) => (
                <article key={a.id} className="row-between" style={{ border: "1px solid var(--line)", borderRadius: 10, padding: "10px 12px", alignItems: "flex-start", gap: 12 }}>
                  <div className="stack-sm" style={{ gap: 3, minWidth: 0 }}>
                    <div className="row" style={{ gap: 8 }}>
                      <b className="nowrap">{fmtTime(a.startsAt)}</b>
                      <Link to={`/pacientes/${a.patientId}`} style={{ fontWeight: 650 }}>{a.patientName}</Link>
                      {a.firstVisit && <span className="badge info">Primera visita</span>}
                    </div>
                    <span className="muted small">{a.procedureName ?? a.reason ?? "Consulta"} · {a.branchName}{a.chairName ? ` · ${a.chairName}` : ""}{a.pendingTreatments ? ` · ${a.pendingTreatments} tratamiento(s) pendiente(s)` : ""}</span>
                    {a.alerts.length > 0 && <span className="badge danger" style={{ whiteSpace: "normal", height: "auto", padding: "3px 9px" }}>⚠ {a.alerts.join(" · ")}</span>}
                  </div>
                  <StatusBadge status={a.status} label={a.statusLabel} />
                </article>
              ))}
            </div>
          ) : <Empty>No tienes pacientes agendados hoy.</Empty>}
        </div>
      )}

      {dash.loading && !d && <div className="card"><Loading /></div>}
      {d && (
        <>
          <div className="grid grid-4">
            {d.financial && <div className="card kpi"><div className="label">Cobrado (confirmado)</div><div className="value">{bs(d.totals.collectedCents)}</div><div className="foot">{bs(d.totals.pendingVerificationCents)} por verificar</div></div>}
            {d.financial && <div className="card kpi"><div className="label">Producción</div><div className="value">{bs(d.totals.productionCents)}</div><div className="foot">Tratamientos realizados</div></div>}
            {d.finance && <div className="card kpi"><div className="label">Cuentas por cobrar</div><div className="value">{bs(d.finance.receivableCents)}</div><div className="foot">{d.finance.patientsWithDebt} pacientes con saldo</div></div>}
            {d.finance && <div className="card kpi"><div className="label">Presupuestos abiertos</div><div className="value">{d.finance.openBudgets}</div><div className="foot">{bs(d.finance.openBudgetsCents)} · conversión {d.finance.budgetConversionPct ?? "—"}%</div></div>}
            <div className="card kpi"><div className="label">Citas del período</div><div className="value">{d.totals.appointments}</div><div className="foot">{d.totals.completed} atendidas · {d.totals.noShow} no asistieron</div></div>
            <div className="card kpi"><div className="label">Pacientes nuevos</div><div className="value">{d.totals.newPatients}</div><div className="foot">Registrados en el período</div></div>
          </div>

          <div className="card">
            <div className="card-head"><h2>Comparativo por sucursal</h2><span className="muted small">{d.range.from} a {d.range.to}</span></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Sucursal</th>{d.financial && <><th className="num">Cobrado</th><th className="num">Producción</th><th className="num">Por verificar</th></>}<th className="num">Citas</th><th className="num">Atendidas</th><th className="num">Inasistencia</th><th className="num">Ocupación</th></tr></thead>
                <tbody>
                  {d.branches.map((b: any) => (
                    <tr key={b.branchId}>
                      <td><b>{b.branchName}</b></td>
                      {d.financial && <><td className="num">{bs(b.collectedCents)}</td><td className="num">{bs(b.productionCents)}</td><td className="num">{b.pendingVerificationCents ? <span className="badge warn">{bs(b.pendingVerificationCents)}</span> : "—"}</td></>}
                      <td className="num">{b.appointments}</td><td className="num">{b.completed}</td>
                      <td className="num">{b.noShowRate == null ? "—" : `${b.noShowRate}%`}</td>
                      <td className="num">{b.occupancyPct == null ? "—" : `${b.occupancyPct}%`}</td>
                    </tr>
                  ))}
                </tbody>
                {d.financial && <tfoot><tr><td>Total</td><td className="num">{bs(d.totals.collectedCents)}</td><td className="num">{bs(d.totals.productionCents)}</td><td className="num">{bs(d.totals.pendingVerificationCents)}</td><td className="num">{d.totals.appointments}</td><td className="num">{d.totals.completed}</td><td /><td /></tr></tfoot>}
              </table>
            </div>
            {d.financial && (
              <div className="card-pad">
                <div className="legend" style={{ marginBottom: 10 }}><span><i className="dot" style={{ background: "var(--brand)" }} />Cobrado</span><span><i className="dot" style={{ background: "#93c5fd" }} />Producción</span></div>
                <div className="bars">
                  {d.branches.map((b: any) => (
                    <div key={b.branchId} className="stack-sm">
                      <div className="bar-row"><span className="small">{b.branchName}</span><div className="bar-track"><div className="bar-fill" style={{ width: `${(b.collectedCents / maxCollected) * 100}%` }} /></div><span className="num small">{bs(b.collectedCents)}</span></div>
                      <div className="bar-row"><span /><div className="bar-track"><div className="bar-fill alt" style={{ width: `${(b.productionCents / maxProd) * 100}%` }} /></div><span className="num small muted">{bs(b.productionCents)}</span></div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </>
      )}

      {can("agenda.read") && (
        <div className="card">
          <div className="card-head"><h2>Citas de hoy</h2><Link to="/agenda" className="btn btn-sm">Abrir agenda</Link></div>
          {appts.loading && !appts.data ? <Loading /> : appts.data?.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Hora</th><th>Paciente</th><th className="hide-mobile">Profesional</th><th className="hide-mobile">Motivo</th><th>Estado</th></tr></thead>
                <tbody>
                  {appts.data.slice(0, 12).map((a: any) => (
                    <tr key={a.id}><td className="nowrap">{fmtTime(a.startsAt)}</td><td><Link to={`/pacientes/${a.patientId}`}>{a.patientName}</Link></td><td className="hide-mobile">{a.dentistName}</td><td className="hide-mobile">{a.procedureName ?? a.reason ?? "—"}</td><td><StatusBadge status={a.status} label={a.statusLabel} /></td></tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : <Empty>No hay citas para hoy en esta sucursal.</Empty>}
        </div>
      )}
    </div>
  );
}
