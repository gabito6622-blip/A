// Informe de calidad de la atención (Reportes) y citas pasadas sin cerrar (Sala de espera).
import { useState } from "react";
import { Link } from "react-router-dom";
import { Download } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { fmtDate, fmtTime } from "../lib/format";
import { Empty, Field, Loading, StatusBadge, useToast } from "./ui";
import { TAP } from "./Recalls";

const num = (v: number | null | undefined, unit = "") => (v == null ? "—" : `${v.toLocaleString("es-BO")}${unit}`);
const signed = (v: number | null | undefined) => (v == null ? "—" : `${v > 0 ? "+" : ""}${v.toLocaleString("es-BO")} min`);
const arrival = (v: number | null | undefined) =>
  v == null ? "sin datos" : v === 0 ? "a la hora exacta" : v < 0 ? `${Math.abs(v).toLocaleString("es-BO")} min antes` : `${v.toLocaleString("es-BO")} min después`;

export function VisitQualitySection({ range }: { range: { from: string; to: string } }) {
  const { me, branchId: globalBranch } = useAuth();
  const [branchId, setBranchId] = useState<string>(globalBranch ?? (me?.membership?.allBranches ? "" : me?.branches[0]?.id ?? ""));
  const params = { ...range, branchId: branchId || undefined };
  const r = useApi<any>(`/api/reports/visit-quality${qs(params)}`);
  const d = r.data;
  const t = d?.total;
  return (
    <section className="stack" aria-labelledby="vq-title">
      <div className="card">
        <div className="card-head" style={{ flexWrap: "wrap" }}>
          <div>
            <h2 id="vq-title">Calidad de la atención</h2>
            <span className="muted small">Cuánto esperan los pacientes, si llegan a tiempo y si las citas duran lo planificado</span>
          </div>
          <div className="row" style={{ alignItems: "flex-end" }}>
            {me && me.branches.length > 1 && (
              <Field label="Sucursal">
                <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                  {me.membership?.allBranches && <option value="">Todas</option>}
                  {me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
              </Field>
            )}
            <a className="btn btn-sm" style={TAP} href={`/api/reports/visit-quality.xlsx${qs(params)}`}><Download size={15} />Excel</a>
          </div>
        </div>
        {!d ? (r.error ? <div className="card-pad"><div className="alert danger">{r.error}</div></div> : <Loading />) : t.total === 0 ? <Empty>Sin citas en el período.</Empty> : (
          <div className="card-pad stack">
            <div className="grid grid-4">
              <div className="card kpi">
                <div className="label">Espera en sala (mediana)</div>
                <div className="value">{num(t.wait.median, " min")}</div>
                <div className="foot">Media {num(t.wait.mean)} · 9 de cada 10 esperan {num(t.wait.p90)} min o menos</div>
              </div>
              <div className="card kpi">
                <div className="label">Pacientes puntuales</div>
                <div className="value">{num(t.punctuality.onTimePct, " %")}</div>
                <div className="foot">En promedio llegan {arrival(t.punctuality.meanMin)}</div>
              </div>
              <div className="card kpi">
                <div className="label">Duración real frente a la planificada</div>
                <div className="value">{signed(t.duration.overrunMean)}</div>
                <div className="foot">Real {num(t.duration.realMean)} min · planificada {num(t.duration.plannedMean)} min · {num(t.duration.overPct, " %")} se pasó</div>
              </div>
              <div className="card kpi">
                <div className="label">No asistieron · canceladas</div>
                <div className="value">{num(t.noShowRate, " %")} · {num(t.cancellationRate, " %")}</div>
                <div className="foot">{t.noShow} no asistieron · {t.cancelled} canceladas de {t.total} citas</div>
              </div>
            </div>
            <div className="grid grid-2">
              <div className="stack-sm small">
                <b>Espera (de «llegó» a «en atención»), {t.wait.n} citas medidas</b>
                <span>Hasta 5 min: {t.wait.buckets.upTo5} · 5 a 10: {t.wait.buckets.upTo10} · 10 a 20: {t.wait.buckets.upTo20} · más de 20: {t.wait.buckets.over20}</span>
              </div>
              <div className="stack-sm small">
                <b>Llegada frente a la hora agendada, {t.punctuality.n} citas</b>
                <span>Antes de 5 min: {t.punctuality.early} · puntual (±5 min): {t.punctuality.onTime} · 5 a 15 min tarde: {t.punctuality.late} · más de 15 min tarde: {t.punctuality.veryLate}</span>
              </div>
            </div>
            <QualityTable title="Por sucursal" rows={d.byBranch.map((x: any) => ({ ...x, name: x.branchName, key: x.branchId }))} />
            <QualityTable title="Por profesional" rows={d.byDentist.map((x: any) => ({ ...x, name: x.dentistName, key: x.dentistId }))} />
            <details>
              <summary style={{ cursor: "pointer", fontWeight: 600 }}>¿Cómo se calcula?</summary>
              <ul className="small" style={{ margin: "8px 0 0", paddingLeft: 18, lineHeight: 1.6 }}>
                <li><b>Espera:</b> minutos desde que recepción marca «Llegó» hasta «Pasar a atención». La mediana es el valor del medio (la mitad espera menos); el P90 indica que 9 de cada 10 pacientes esperan eso o menos.</li>
                <li><b>Puntualidad:</b> hora de llegada menos hora agendada. Puntual = entre 5 min antes y 5 min después.</li>
                <li><b>Duración real:</b> de «en atención» a «atendido», comparada con la duración agendada. Solo cuenta si se usaron ambos botones.</li>
                <li><b>No asistieron:</b> «no asistió» ÷ (atendidas + no asistió). <b>Canceladas:</b> canceladas ÷ todas las citas del período.</li>
                <li>Las citas cerradas después, desde «Citas pasadas sin cerrar», no se usan para medir tiempos porque su hora no es la real.</li>
              </ul>
            </details>
          </div>
        )}
      </div>
    </section>
  );
}

function QualityTable({ title, rows }: { title: string; rows: any[] }) {
  if (!rows.length) return null;
  return (
    <div className="table-wrap">
      <table className="table">
        <caption style={{ textAlign: "left", fontWeight: 650, padding: "4px 0 8px" }}>{title}</caption>
        <thead><tr>
          <th scope="col">Nombre</th><th scope="col" className="num">Citas</th><th scope="col" className="num">Espera mediana</th><th scope="col" className="num hide-mobile">P90</th>
          <th scope="col" className="num hide-mobile">Puntuales</th><th scope="col" className="num hide-mobile">Real / planificada</th><th scope="col" className="num">No asistió</th><th scope="col" className="num hide-mobile">Canceladas</th>
        </tr></thead>
        <tbody>
          {rows.map((x) => (
            <tr key={x.key}>
              <td><b>{x.name}</b></td>
              <td className="num">{x.total}</td>
              <td className="num">{num(x.wait.median, " min")}</td>
              <td className="num hide-mobile">{num(x.wait.p90, " min")}</td>
              <td className="num hide-mobile">{num(x.punctuality.onTimePct, " %")}</td>
              <td className="num hide-mobile">{num(x.duration.realMean)} / {num(x.duration.plannedMean)} min</td>
              <td className="num">{num(x.noShowRate, " %")}</td>
              <td className="num hide-mobile">{num(x.cancellationRate, " %")}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const RESOLUTION_LABEL: Record<string, string> = { no_show: "No asistió", completed: "Atendida" };

/** Lista de citas pasadas que siguen abiertas, con resolución de un clic. Nunca cierra nada sola. */
export function UnclosedAppointments({ branchId, onCompleted, onReschedule, onResolved }: {
  branchId: string; onCompleted: (id: string) => void; onReschedule: (id: string) => void; onResolved?: () => void;
}) {
  const { can } = useAuth();
  const toast = useToast();
  const r = useApi<any[]>(`/api/appointments/unclosed${qs({ branchId })}`);
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!r.data?.length) return null;
  const resolve = async (a: any, resolution: string) => {
    setBusy(a.id); setErr(null);
    try {
      await api.post(`/api/appointments/${a.id}/resolve`, { resolution });
      toast(`${a.patientName}: ${RESOLUTION_LABEL[resolution]!.toLowerCase()}`);
      await r.reload();
      onResolved?.();
      if (resolution === "completed") onCompleted(a.id);
    } catch (e: any) { setErr(e.message); } finally { setBusy(null); }
  };
  const write = can("agenda.write");
  return (
    <section className="card" aria-labelledby="unclosed-title">
      <div className="card-head">
        <h2 id="unclosed-title">Citas pasadas sin cerrar</h2>
        <span className="badge warn">{r.data.length}</span>
      </div>
      <div className="card-pad stack-sm" style={{ paddingBottom: 8 }}>
        <p className="muted small" style={{ margin: 0 }}>Estas citas ya terminaron pero siguen abiertas. Ninguna se cierra sola: indica qué pasó con cada una.</p>
        {err && <div className="alert danger" role="alert">{err}</div>}
      </div>
      <div className="table-wrap">
        <table className="table">
          <tbody>
            {r.data.map((a) => (
              <tr key={a.id}>
                <td className="nowrap">{fmtDate(a.startsAt)}<div className="muted small">{fmtTime(a.startsAt)}</div></td>
                <td><Link to={`/pacientes/${a.patientId}`}><b>{a.patientName}</b></Link><div className="muted small">{a.dentistName}{a.procedureName ? ` · ${a.procedureName}` : ""}</div></td>
                <td className="hide-mobile"><StatusBadge status={a.status} label={a.statusLabel} /></td>
                <td>
                  {write && (
                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                      {a.resolutions.includes("no_show") && <button className="btn btn-sm" style={TAP} disabled={busy === a.id} onClick={() => resolve(a, "no_show")}>No asistió</button>}
                      {a.resolutions.includes("completed") && <button className="btn btn-sm btn-primary" style={TAP} disabled={busy === a.id} onClick={() => resolve(a, "completed")}>Atendida</button>}
                      {["scheduled", "confirmed"].includes(a.status) && <button className="btn btn-sm" style={TAP} disabled={busy === a.id} onClick={() => onReschedule(a.id)}>Reprogramar</button>}
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
