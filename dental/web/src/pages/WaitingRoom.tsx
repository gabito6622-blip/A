import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { RefreshCw } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { addDays, fmtDateLong, fmtTime, laPazISO, localDate } from "../lib/format";
import { Empty, Loading, StatusBadge, useAsk, useToast } from "../components/ui";
import { NextControlDialog } from "../components/Recalls";
import { UnclosedAppointments } from "../components/VisitQuality";
import { AppointmentDrawer } from "./Agenda";
import { SurveyLinkActions } from "../components/SurveyLinkActions";

interface Appt {
  id: string; status: string; statusLabel: string; startsAt: string; endsAt: string; patientId: string; patientName: string;
  dentistName: string; dentistColor: string | null; procedureName: string | null; reason: string | null; chairName: string | null; arrivedAt: string | null;
}

const COLUMNS: { id: string; title: string; statuses: string[] }[] = [
  { id: "pending", title: "Por llegar", statuses: ["scheduled", "confirmed"] },
  { id: "waiting", title: "En sala de espera", statuses: ["arrived"] },
  { id: "chair", title: "En atención", statuses: ["in_progress"] },
  { id: "done", title: "Atendidos", statuses: ["completed"] },
];

/** Acciones disponibles según el estado (coinciden con las transiciones del servidor). */
const ACTIONS: Record<string, { to: string; label: string; primary?: boolean }[]> = {
  scheduled: [{ to: "confirmed", label: "Confirmar" }, { to: "arrived", label: "Llegó", primary: true }, { to: "no_show", label: "No asistió" }],
  confirmed: [{ to: "arrived", label: "Llegó", primary: true }, { to: "no_show", label: "No asistió" }],
  arrived: [{ to: "in_progress", label: "Pasar a atención", primary: true }, { to: "completed", label: "Atendido" }],
  in_progress: [{ to: "completed", label: "Atendido", primary: true }],
};
const CANCELLABLE = new Set(["scheduled", "confirmed", "arrived"]);

export function WaitingRoomPage() {
  const { me, can, branchId: selBranch } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const branchId = selBranch ?? me?.branches[0]?.id ?? null;
  const today = localDate();
  const url = branchId ? `/api/appointments${qs({ from: laPazISO(today, "00:00"), to: laPazISO(addDays(today, 1), "00:00"), branchId, includeCancelled: "1" })}` : null;
  const appts = useApi<Appt[]>(url);
  const [now, setNow] = useState(Date.now());
  const [busy, setBusy] = useState<string | null>(null);
  const [showOthers, setShowOthers] = useState(false);
  const [nextControl, setNextControl] = useState<string | null>(null);
  const [drawerId, setDrawerId] = useState<string | null>(null);
  const [unclosedKey, setUnclosedKey] = useState(0);
  const { reload } = appts;

  useEffect(() => {
    const t = setInterval(() => { reload(); setNow(Date.now()); }, 30_000);
    return () => clearInterval(t);
  }, [reload]);

  const move = async (a: Appt, to: string) => {
    let reason: string | null = null;
    if (to === "cancelled") {
      reason = await ask({ title: "Cancelar cita", message: `${a.patientName}`, inputLabel: "Motivo de la cancelación", confirmLabel: "Cancelar cita", danger: true });
      if (!reason?.trim()) return;
    }
    setBusy(a.id);
    try {
      await api.post(`/api/appointments/${a.id}/status`, { status: to, reason });
      toast(`${a.patientName}: ${to === "arrived" ? "en sala de espera" : to === "in_progress" ? "en atención" : to === "completed" ? "atendido" : to === "no_show" ? "no asistió" : to === "cancelled" ? "cita cancelada" : "confirmada"}`);
      await reload();
      if (to === "completed") setNextControl(a.id);
    } catch (e: any) {
      toast(e.message, true);
    } finally { setBusy(null); }
  };

  if (!branchId) return <Empty>Selecciona una sucursal.</Empty>;
  const list = appts.data ?? [];
  const others = list.filter((a) => a.status === "no_show" || a.status === "cancelled");
  const branchName = me?.branches.find((b) => b.id === branchId)?.name;
  const writable = can("agenda.write");

  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Sala de espera</h1>
          <p className="sub">{branchName} · {fmtDateLong(laPazISO(today, "12:00"))}</p>
        </div>
        <button className="btn" onClick={() => { reload(); setNow(Date.now()); setUnclosedKey((k) => k + 1); }}><RefreshCw size={16} />Actualizar</button>
      </div>

      <UnclosedAppointments key={`${branchId}-${unclosedKey}`} branchId={branchId} onCompleted={setNextControl} onReschedule={setDrawerId} onResolved={reload} />

      {appts.loading && !appts.data ? <div className="card"><Loading rows={6} /></div> : (
        <div className="waiting-board" style={{ display: "grid", gap: 14, gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", alignItems: "start" }}>
          {COLUMNS.map((col) => {
            const items = list.filter((a) => col.statuses.includes(a.status)).sort((x, y) => x.startsAt.localeCompare(y.startsAt));
            return (
              <section key={col.id} className="card" aria-label={`${col.title}: ${items.length}`} style={{ background: "var(--surface-2)" }}>
                <div className="card-head" style={{ background: "var(--surface)" }}>
                  <h2>{col.title}</h2>
                  <span className="badge">{items.length}</span>
                </div>
                <div className="stack" style={{ padding: 10, gap: 10 }}>
                  {items.length === 0 && <p className="muted small" style={{ padding: "8px 4px" }}>Sin pacientes.</p>}
                  {items.map((a) => {
                    const lateMin = Math.floor((now - Date.parse(a.startsAt)) / 60_000);
                    const isLate = col.id === "pending" && lateMin > 0 && lateMin <= 60;
                    const pastHour = col.id === "pending" && lateMin > 60;
                    const waitMin = a.arrivedAt ? Math.floor((now - Date.parse(a.arrivedAt)) / 60_000) : null;
                    return (
                      <article key={a.id} className="card" style={{ padding: 12, borderLeft: `4px solid ${a.dentistColor ?? "var(--accent)"}` }}>
                        <div className="row-between" style={{ alignItems: "flex-start" }}>
                          <b style={{ fontSize: 15 }}>{fmtTime(a.startsAt)}</b>
                          <div className="row" style={{ gap: 6 }}>
                            {isLate && <span className="badge warn">Retrasado {lateMin} min</span>}
                            {pastHour && <span className="badge">Hora pasada</span>}
                            {col.id === "waiting" && waitMin !== null && waitMin >= 0 && <span className={`badge ${waitMin >= 20 ? "warn" : ""}`}>Espera {waitMin} min</span>}
                            {col.id === "pending" && <StatusBadge status={a.status} label={a.statusLabel} />}
                          </div>
                        </div>
                        <Link to={`/pacientes/${a.patientId}`} style={{ fontWeight: 650, display: "block", marginTop: 4 }}>{a.patientName}</Link>
                        <div className="muted small">{a.dentistName}{a.chairName ? ` · ${a.chairName}` : ""}</div>
                        {(a.procedureName || a.reason) && <div className="small" style={{ marginTop: 2 }}>{a.procedureName ?? a.reason}</div>}
                        {writable && (ACTIONS[a.status]?.length || CANCELLABLE.has(a.status)) && (
                          <div className="row" style={{ marginTop: 10, gap: 6 }}>
                            {(ACTIONS[a.status] ?? []).map((act) => (
                              <button key={act.to} type="button" className={`btn btn-sm ${act.primary ? "btn-primary" : ""}`} disabled={busy === a.id} onClick={() => move(a, act.to)}>{act.label}</button>
                            ))}
                            {CANCELLABLE.has(a.status) && (
                              <button type="button" className="btn btn-sm btn-ghost" disabled={busy === a.id} onClick={() => move(a, "cancelled")}>Cancelar</button>
                            )}
                          </div>
                        )}
                        {writable && a.status === "completed" && (
                          <div className="row" style={{ marginTop: 10, gap: 6 }}><SurveyLinkActions appointmentId={a.id} patientName={a.patientName} compact /></div>
                        )}
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      {others.length > 0 && (
        <div className="card">
          <div className="card-head">
            <h2>No asistieron / canceladas</h2>
            <button type="button" className="btn btn-sm" aria-expanded={showOthers} onClick={() => setShowOthers(!showOthers)}>{showOthers ? "Ocultar" : `Ver (${others.length})`}</button>
          </div>
          {showOthers && (
            <div className="table-wrap">
              <table className="table">
                <tbody>
                  {others.sort((x, y) => x.startsAt.localeCompare(y.startsAt)).map((a) => (
                    <tr key={a.id}>
                      <td className="nowrap">{fmtTime(a.startsAt)}</td>
                      <td><Link to={`/pacientes/${a.patientId}`}>{a.patientName}</Link><div className="muted small">{a.dentistName}</div></td>
                      <td><StatusBadge status={a.status} label={a.statusLabel} /></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      <p className="muted small">Se actualiza automáticamente cada 30 segundos.</p>
      {nextControl && <NextControlDialog appointmentId={nextControl} onClose={() => setNextControl(null)} />}
      {drawerId && <AppointmentDrawer id={drawerId} onClose={() => { setDrawerId(null); setUnclosedKey((k) => k + 1); }} onChanged={reload}
        onCompleted={(id) => { setDrawerId(null); setNextControl(id); }} />}
    </div>
  );
}
