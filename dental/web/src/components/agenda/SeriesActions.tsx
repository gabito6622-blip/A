// Acciones de serie en el panel de la cita: "esta y las siguientes" (reprogramar o cancelar).
// "Solo esta" usa los botones normales de la cita.
import { useState } from "react";
import { Repeat } from "lucide-react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { fmtDateLong, fmtTime, laPazISO, localDate } from "../../lib/format";
import { Field, useAsk, useToast } from "../ui";

export function SeriesActions({ appt, canWrite, onChanged }: { appt: any; canWrite: boolean; onChanged: () => void }) {
  const toast = useToast();
  const ask = useAsk();
  const s = useApi<any>(`/api/appointment-series/${appt.seriesId}`);
  const [move, setMove] = useState<{ date: string; time: string } | null>(null);
  const [preview, setPreview] = useState<any | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const total = s.data?.appointments.length;
  const following = s.data?.appointments.filter((a: any) => a.startsAt >= appt.startsAt && ["scheduled", "confirmed"].includes(a.status)).length ?? 0;
  const editable = ["scheduled", "confirmed"].includes(appt.status);

  const body = () => ({ fromAppointmentId: appt.id, scope: "following", startsAt: laPazISO(move!.date, move!.time) });
  const review = async () => {
    setErr(null); setBusy(true);
    try { setPreview(await api.post(`/api/appointment-series/${appt.seriesId}/reschedule`, { ...body(), preview: true })); } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const commit = async () => {
    setErr(null); setBusy(true);
    try {
      const r = await api.post(`/api/appointment-series/${appt.seriesId}/reschedule`, body());
      toast(r.skipped.length ? `Se movieron ${r.moved.length} citas; ${r.skipped.length} quedaron en su horario por conflicto` : `Se movieron ${r.moved.length} citas`);
      setMove(null); setPreview(null); s.reload(); onChanged();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const cancelFollowing = async () => {
    const reason = await ask({ title: "Cancelar esta y las siguientes", message: `Se cancelarán ${following} cita(s) de la serie desde el ${fmtDateLong(appt.startsAt)}. Las anteriores no cambian.`, inputLabel: "Motivo de la cancelación", confirmLabel: "Cancelar citas", danger: true });
    if (!reason) return;
    try {
      const r = await api.post(`/api/appointment-series/${appt.seriesId}/cancel`, { fromAppointmentId: appt.id, scope: "following", reason });
      toast(`${r.cancelled} cita(s) canceladas`); s.reload(); onChanged();
    } catch (e: any) { setErr(e.message); }
  };

  return (
    <div className="card card-pad stack-sm" aria-label="Serie de citas">
      <div className="row" style={{ gap: 8 }}><Repeat size={16} /><b>Cita {appt.seriesIndex}{total ? ` de una serie de ${total}` : " de una serie"}</b></div>
      {err && <div className="alert danger small" role="alert">{err}</div>}
      {canWrite && editable && (
        <>
          <span className="muted small">Esta y las siguientes ({following}):</span>
          <div className="row">
            <button className="btn btn-sm" onClick={() => { setMove({ date: localDate(new Date(appt.startsAt)), time: fmtTime(appt.startsAt) }); setPreview(null); }}>Reprogramar esta y las siguientes</button>
            <button className="btn btn-sm btn-danger" onClick={cancelFollowing}>Cancelar esta y las siguientes</button>
          </div>
        </>
      )}
      {move && (
        <div className="stack-sm">
          <div className="form-grid">
            <Field label="Nueva fecha de esta cita"><input className="input" type="date" value={move.date} onChange={(e) => { setMove({ ...move, date: e.target.value }); setPreview(null); }} /></Field>
            <Field label="Nueva hora"><input className="input" type="time" step={900} value={move.time} onChange={(e) => { setMove({ ...move, time: e.target.value }); setPreview(null); }} /></Field>
          </div>
          <span className="hint muted small">Las siguientes se mueven los mismos días y a la misma hora.</span>
          {preview && (
            <ul className="series-list compact">
              {preview.occurrences.map((o: any) => (
                <li key={o.appointmentId} className={o.ok ? "ok" : "conflict"}>
                  <span><b>{fmtDateLong(o.startsAt)}</b> · {fmtTime(o.startsAt)}</span>
                  <span className="small" style={{ color: o.ok ? "var(--ok)" : "var(--warn)" }}>{o.ok ? "Libre" : `${o.conflict.message}: queda en su horario`}</span>
                </li>
              ))}
            </ul>
          )}
          <div className="row">
            {!preview ? <button className="btn btn-sm btn-primary" disabled={busy} onClick={review}>Revisar fechas</button>
              : <button className="btn btn-sm btn-primary" disabled={busy || !preview.summary.free} onClick={commit}>Mover {preview.summary.free} cita(s)</button>}
            <button className="btn btn-sm" onClick={() => { setMove(null); setPreview(null); }}>Cerrar</button>
          </div>
        </div>
      )}
    </div>
  );
}
