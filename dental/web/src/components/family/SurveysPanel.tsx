// Panel de satisfacción (NPS) para propietario y administración.
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api, qs } from "../../lib/api";
import { addDays, fmtDateTime, localDate } from "../../lib/format";
import { Empty, Field, Loading, useAsk, useToast } from "../ui";

interface Stats { id?: string; name?: string; answered: number; promoters: number; passives: number; detractors: number; nps: number | null }

const npsTone = (n: number | null) => (n === null ? "" : n >= 50 ? "var(--ok)" : n >= 0 ? "var(--warn)" : "var(--danger)");
const npsText = (n: number | null) => (n === null ? "—" : n > 0 ? `+${n}` : String(n));

function Bar({ s }: { s: Stats }) {
  if (!s.answered) return null;
  const pct = (x: number) => `${(x * 100) / s.answered}%`;
  return (
    <div className="xp-nps-bar" role="img" aria-label={`${s.promoters} promotores, ${s.passives} pasivos y ${s.detractors} detractores`}>
      <span style={{ width: pct(s.promoters), background: "var(--ok)" }} /><span style={{ width: pct(s.passives), background: "#cbd5e1" }} /><span style={{ width: pct(s.detractors), background: "var(--danger)" }} />
    </div>
  );
}

function GroupTable({ title, rows }: { title: string; rows: Stats[] }) {
  return (
    <div className="card">
      <div className="card-head"><h2>{title}</h2></div>
      {rows.length ? (
        <div className="table-wrap"><table className="table xp-table">
          <thead><tr><th>{title === "Por sucursal" ? "Sucursal" : "Profesional"}</th><th className="num">NPS</th><th className="num">Respuestas</th><th className="num">Promotores</th><th className="num">Detractores</th><th>Distribución</th></tr></thead>
          <tbody>{rows.map((r) => (
            <tr key={r.id}>
              <td className="xp-main">{r.name}</td>
              <td data-label="NPS" className="num"><b style={{ color: npsTone(r.nps) }}>{npsText(r.nps)}</b></td>
              <td data-label="Respuestas" className="num">{r.answered}</td>
              <td data-label="Promotores" className="num">{r.promoters}</td>
              <td data-label="Detractores" className="num">{r.detractors}</td>
              <td data-label="Distribución" style={{ minWidth: 120 }}><Bar s={r} /></td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>Sin respuestas en el período.</Empty>}
    </div>
  );
}

export function SurveysPanel() {
  const { me, branchId: selBranch } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const today = localDate();
  const [from, setFrom] = useState(addDays(today, -89));
  const [to, setTo] = useState(today);
  const [branchId, setBranchId] = useState(selBranch ?? "");
  const s = useApi<any>(`/api/surveys/summary${qs({ from, to, branchId: branchId || undefined })}`);
  const followup = async (a: any) => {
    const note = await ask({ title: "Registrar seguimiento", message: `${a.patientName} calificó ${a.score}/10. Anota qué se hizo (llamada, disculpa, cita de revisión).`, inputLabel: "Seguimiento realizado", confirmLabel: "Registrar" });
    if (!note) return;
    try { await api.post(`/api/surveys/${a.id}/followup`, { note }); toast("Seguimiento registrado"); s.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const d = s.data;
  return (
    <div className="stack">
      <div className="card card-pad">
        <div className="form-grid">
          <Field label="Desde"><input className="input" type="date" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta"><input className="input" type="date" value={to} min={from} max={today} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="Sucursal">
            <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              {me?.membership?.allBranches && <option value="">Todas las sucursales</option>}
              {me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
        </div>
      </div>
      {s.error && <div className="alert danger">{s.error}</div>}
      {!d ? <Loading rows={4} /> : (
        <>
          <div className="xp-kpis">
            <div className="card kpi"><div className="label">NPS</div><div className="value" style={{ color: npsTone(d.overall.nps) }}>{npsText(d.overall.nps)}</div><div className="foot">% promotores − % detractores</div></div>
            <div className="card kpi"><div className="label">Respuestas</div><div className="value">{d.overall.answered}</div><div className="foot">{d.responseRate !== null ? `${d.responseRate}% de ${d.sent} enlaces` : "Sin enlaces enviados"}</div></div>
            <div className="card kpi"><div className="label">Promotores (9-10)</div><div className="value" style={{ color: "var(--ok)" }}>{d.overall.promoters}</div><div className="foot">Pasivos (7-8): {d.overall.passives}</div></div>
            <div className="card kpi"><div className="label">Detractores (0-6)</div><div className="value" style={{ color: d.overall.detractors ? "var(--danger)" : undefined }}>{d.overall.detractors}</div><div className="foot"><Bar s={d.overall} /></div></div>
          </div>

          <div className="card">
            <div className="card-head"><h2 className="row" style={{ gap: 8 }}><AlertTriangle size={18} aria-hidden="true" />Requieren atención de gerencia</h2><span className="badge danger">{d.alerts.length}</span></div>
            {!d.tasksModule && <p className="muted small card-pad" style={{ margin: 0, paddingBottom: 0 }}>Aún no existe el tablero de tareas: cada detractor queda aquí como aviso hasta que alguien registre el seguimiento.</p>}
            {d.alerts.length ? (
              <ul className="xp-members">
                {d.alerts.map((a: any) => (
                  <li key={a.id} className="xp-member">
                    <div className="who stack-sm" style={{ gap: 4 }}>
                      <div className="row" style={{ gap: 6 }}><span className="badge danger">{a.score}/10</span><Link to={`/pacientes/${a.patientId}`}><b>{a.patientName}</b></Link></div>
                      <span className="muted small">{fmtDateTime(a.answeredAt)} · {a.branchName} · {a.dentistName}{a.phone ? ` · ${a.phone}` : ""}</span>
                      {a.comment && <span>«{a.comment}»</span>}
                    </div>
                    <div className="acts"><button className="btn btn-sm btn-primary" onClick={() => followup(a)}>Registrar seguimiento</button></div>
                  </li>
                ))}
              </ul>
            ) : <Empty>Sin detractores pendientes de seguimiento.</Empty>}
          </div>

          <div className="grid grid-2">
            <GroupTable title="Por sucursal" rows={d.byBranch} />
            <GroupTable title="Por profesional" rows={d.byDentist} />
          </div>

          <div className="card">
            <div className="card-head"><h2>Comentarios</h2></div>
            {d.comments.length ? (
              <ul className="xp-members">
                {d.comments.map((c: any) => (
                  <li key={c.id} className="xp-member">
                    <div className="who stack-sm" style={{ gap: 4 }}>
                      <div className="row" style={{ gap: 6 }}>
                        <span className={`badge ${c.score >= 9 ? "ok" : c.score <= 6 ? "danger" : "warn"}`}>{c.score}/10</span>
                        <span className="muted small">{fmtDateTime(c.answeredAt)} · {c.branchName} · {c.dentistName}</span>
                      </div>
                      {c.comment ? <span>«{c.comment}»</span> : <span className="muted small">Sin comentario</span>}
                      {c.followupAt && <span className="small" style={{ color: "var(--ok)" }}>Seguimiento ({c.followupBy}): {c.followupNote}</span>}
                    </div>
                  </li>
                ))}
              </ul>
            ) : <Empty>Sin comentarios en el período.</Empty>}
          </div>
          <p className="muted small">La encuesta se envía con la regla «Encuesta de satisfacción» de <Link to="/configuracion">Configuración → Mensajes automáticos</Link> (desactivada por defecto) y solo llega a quien aceptó recordatorios. La página pública no muestra datos clínicos.</p>
        </>
      )}
    </div>
  );
}
