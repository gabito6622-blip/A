// Página "Controles": lista mensual de pacientes que deben volver, por sucursal.
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarPlus, MessageCircle, PhoneCall, RotateCcw, X } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { fmtDate, fmtDateTime, localDate } from "../lib/format";
import { Empty, Field, Loading, useToast } from "../components/ui";
import { AttemptDialog, DismissDialog, PRIORITY, RecallStatusBadge, TAP, channelLabel, monthLabel, outcomeLabel } from "../components/Recalls";
import { NewAppointmentDialog, type NewApptPrefill } from "./Agenda";

const STATUS_FILTERS = [
  { id: "active", label: "Por contactar (pendientes y a revisar)" }, { id: "pending", label: "Pendientes" }, { id: "review", label: "Revisar" },
  { id: "scheduled", label: "Agendados" }, { id: "done", label: "Hechos" }, { id: "dismissed", label: "Descartados" }, { id: "all", label: "Todos" },
];

const shiftMonth = (ym: string, n: number) => {
  const [y, m] = ym.split("-").map(Number) as [number, number];
  const d = new Date(Date.UTC(y, m - 1 + n, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
};
const daysBetween = (a: string, b: string) => Math.round((Date.parse(b + "T12:00:00Z") - Date.parse(a + "T12:00:00Z")) / 86_400_000);

export function RecallsPage() {
  const { can, branchId } = useAuth();
  const toast = useToast();
  const [sp, setSp] = useSearchParams();
  const month = sp.get("mes") ?? localDate().slice(0, 7);
  const status = sp.get("estado") ?? "active";
  const priority = sp.get("prioridad") ?? "";
  const overdue = sp.get("atrasados") !== "0";
  const [q, setQ] = useState(sp.get("q") ?? "");
  const set = (k: string, v: string | null) => { const n = new URLSearchParams(sp); if (v === null || v === "") n.delete(k); else n.set(k, v); setSp(n, { replace: true }); };
  const url = `/api/recalls${qs({ branchId: branchId ?? undefined, month, status, priority: priority || undefined, overdue: overdue ? "1" : "0", q: sp.get("q") || undefined })}`;
  const list = useApi<any>(url);
  const [attempt, setAttempt] = useState<{ recall: any; channel?: string } | null>(null);
  const [dismiss, setDismiss] = useState<any | null>(null);
  const [booking, setBooking] = useState<{ branchId: string; prefill: NewApptPrefill } | null>(null);
  const write = can("agenda.write");
  const d = list.data;
  const today = d?.today ?? localDate();

  const reactivate = async (r: any) => {
    try { await api.patch(`/api/recalls/${r.id}`, { reactivate: true }); toast("El control volvió a la lista de pendientes"); list.reload(); }
    catch (e: any) { toast(e.message, true); }
  };
  const book = (r: any) => setBooking({
    branchId: r.branchId,
    prefill: { patient: { id: r.patientId, name: r.patientName }, procedureId: r.procedureId, dentistId: r.dentistId ?? undefined,
      date: r.dueDate > today ? r.dueDate : today, recall: { id: r.id, reason: r.reason } },
  });

  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="page-head">
        <div>
          <h1>Controles</h1>
          <p className="sub">Pacientes que deben volver a su control. Llámalos o escríbeles y agenda la cita desde aquí.</p>
        </div>
        <div className="row" role="group" aria-label="Mes">
          <button className="btn btn-icon" style={TAP} onClick={() => set("mes", shiftMonth(month, -1))} aria-label="Mes anterior">‹</button>
          <span style={{ fontWeight: 620, minWidth: 140, textAlign: "center" }}>{monthLabel(month)}</span>
          <button className="btn btn-icon" style={TAP} onClick={() => set("mes", shiftMonth(month, 1))} aria-label="Mes siguiente">›</button>
          {month !== localDate().slice(0, 7) && <button className="btn" style={TAP} onClick={() => set("mes", null)}>Este mes</button>}
        </div>
      </div>

      {d && (
        <div className="grid grid-4">
          <div className="card kpi"><div className="label">Vencen esta semana</div><div className="value">{d.counters.dueThisWeek}</div><div className="foot">Fecha objetivo en los próximos 7 días</div></div>
          <div className="card kpi"><div className="label">Atrasados</div><div className="value">{d.counters.overdue}</div><div className="foot">Ya pasó la fecha y aún sin cita</div></div>
          <div className="card kpi"><div className="label">Agendados de {monthLabel(month).split(" ")[0]}</div><div className="value">{d.counters.scheduled}</div><div className="foot">Con cita futura vinculada</div></div>
          <div className="card kpi"><div className="label">Conversión del mes</div><div className="value">{d.counters.conversion.pct == null ? "—" : `${d.counters.conversion.pct}%`}</div>
            <div className="foot">{d.counters.conversion.numerator} de {d.counters.conversion.denominator} controles del mes con cita o ya hechos</div></div>
        </div>
      )}

      <div className="card card-pad">
        <div className="form-grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <Field label="Estado">
            <select className="input" value={status} onChange={(e) => set("estado", e.target.value === "active" ? null : e.target.value)}>
              {STATUS_FILTERS.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Prioridad">
            <select className="input" value={priority} onChange={(e) => set("prioridad", e.target.value)}>
              <option value="">Todas</option><option value="high">Alta</option><option value="normal">Normal</option><option value="low">Baja</option>
            </select>
          </Field>
          <Field label="Buscar paciente">
            <input className="input" value={q} placeholder="Nombre, CI o celular" onChange={(e) => setQ(e.target.value)} onBlur={() => set("q", q.trim())}
              onKeyDown={(e) => e.key === "Enter" && set("q", q.trim())} />
          </Field>
          {["active", "pending", "review"].includes(status) && (
            <Field label="Meses anteriores" group>
              <label className="check" style={{ minHeight: 40 }}><input type="checkbox" checked={overdue} onChange={(e) => set("atrasados", e.target.checked ? null : "0")} />Incluir atrasados</label>
            </Field>
          )}
        </div>
      </div>

      {!d ? (list.error ? <div className="alert danger">{list.error}</div> : <div className="card"><Loading rows={6} /></div>) : d.items.length === 0 ? (
        <div className="card"><Empty>{status === "active" ? `No hay controles por contactar en ${monthLabel(month)}${overdue ? " ni atrasados" : ""}.` : "Ningún control coincide con los filtros."}</Empty></div>
      ) : (
        <div className="grid grid-2" aria-label="Lista de controles">
          {d.items.map((r: any) => {
            const diff = daysBetween(today, r.dueDate);
            return (
              <article key={r.id} className="card" style={{ padding: 14 }} aria-label={`Control de ${r.patientName}`}>
                <div className="row-between" style={{ alignItems: "flex-start" }}>
                  <div style={{ minWidth: 0 }}>
                    <Link to={`/pacientes/${r.patientId}`} style={{ fontWeight: 650, fontSize: 15 }}>{r.patientName}</Link>
                    <div className="muted small">{r.patientPhone ?? "Sin celular"}{!branchId ? ` · ${r.branchName}` : ""}</div>
                  </div>
                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                    {r.priority !== "normal" && <span className={`badge ${PRIORITY[r.priority]!.tone}`}>Prioridad {PRIORITY[r.priority]!.label.toLowerCase()}</span>}
                    <RecallStatusBadge status={r.status} />
                  </div>
                </div>
                <div style={{ marginTop: 8 }}>
                  <b>{r.reason}</b>
                  <div className="small">
                    Fecha objetivo {fmtDate(r.dueDate + "T12:00:00Z")}
                    {["pending", "review"].includes(r.status) && <span className="muted"> · {diff === 0 ? "hoy" : diff > 0 ? `en ${diff} día(s)` : `pasó hace ${-diff} día(s)`}</span>}
                  </div>
                  {r.status === "scheduled" && r.appointmentStartsAt && <div className="small">Cita agendada: <b>{fmtDateTime(r.appointmentStartsAt)}</b></div>}
                  {r.note && <div className="small muted">Nota: {r.note}</div>}
                  {r.dismissReason && <div className="small muted">Descartado: {r.dismissReason}</div>}
                  <div className="small muted" style={{ marginTop: 4 }}>
                    {r.attempts ? <>{r.attempts} intento(s){r.lastAttempt ? <> · último: {channelLabel(r.lastAttempt.channel)}, {outcomeLabel(r.lastAttempt.outcome).toLowerCase()} ({fmtDate(r.lastAttempt.createdAt)})</> : null}</> : "Sin intentos de contacto"}
                  </div>
                  {r.status === "review" && <div className="alert warn small" style={{ marginTop: 8 }}>Tuvo {r.failedAttempts} intentos sin éxito: revisa el número o decide si reactivarlo o descartarlo.</div>}
                </div>
                {write && ["pending", "review"].includes(r.status) && (
                  <div className="row" style={{ marginTop: 10, gap: 6 }}>
                    <button className="btn btn-sm btn-primary" style={TAP} onClick={() => setAttempt({ recall: r })}><PhoneCall size={15} />Registrar intento</button>
                    {r.whatsappUrl
                      ? <a className="btn btn-sm" style={TAP} href={r.whatsappUrl} target="_blank" rel="noopener noreferrer" onClick={() => setAttempt({ recall: r, channel: "whatsapp" })}><MessageCircle size={15} />WhatsApp</a>
                      : <span className="badge" title="El botón de WhatsApp aparece solo con consentimiento y celular">{r.whatsappBlocked}</span>}
                    <button className="btn btn-sm" style={TAP} onClick={() => book(r)}><CalendarPlus size={15} />Agendar</button>
                    {r.status === "review" && <button className="btn btn-sm" style={TAP} onClick={() => reactivate(r)}><RotateCcw size={15} />Reactivar</button>}
                    <button className="btn btn-sm btn-ghost" style={TAP} onClick={() => setDismiss(r)}><X size={15} />Descartar</button>
                  </div>
                )}
              </article>
            );
          })}
        </div>
      )}
      <p className="muted small">
        Los controles solo organizan la lista: nadie recibe mensajes automáticos. El botón de WhatsApp abre tu WhatsApp con un mensaje sin datos clínicos y aparece solo si el paciente aceptó recibir mensajes.
        La conversión del mes es: controles del mes con cita agendada o ya hechos ÷ controles del mes (sin contar los descartados).
      </p>

      {attempt && <AttemptDialog recall={attempt.recall} defaultChannel={attempt.channel} onClose={() => setAttempt(null)} onSaved={() => { setAttempt(null); list.reload(); }} />}
      {dismiss && <DismissDialog recall={dismiss} onClose={() => setDismiss(null)} onSaved={() => { setDismiss(null); list.reload(); }} />}
      {booking && <NewAppointmentDialog branchId={booking.branchId} prefill={booking.prefill} onClose={() => setBooking(null)} onSaved={() => { setBooking(null); list.reload(); }} />}
    </div>
  );
}
