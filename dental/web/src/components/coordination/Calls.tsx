// Llamar al paciente (R2-42) y crear tareas desde la ficha o la cita.
// "Llamar" abre el marcador del teléfono (tel:) y deja listo el registro del resultado; la llamada
// queda en el historial del paciente. Si pidió que lo vuelvan a llamar, se puede crear una tarea.
import { useState } from "react";
import { ClipboardList, Phone, PhoneCall } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { api } from "../../lib/api";
import { addDays, fmtDateTime, localDate } from "../../lib/format";
import { Dialog, Field, useToast } from "../ui";
import { NewTaskDialog } from "./Tasks";
import "./coordination.css";

const OUTCOMES = [
  { id: "answered", label: "Contestó" },
  { id: "no_answer", label: "No contestó" },
  { id: "wrong_number", label: "Número equivocado" },
  { id: "call_back", label: "Pidió volver a llamar" },
] as const;

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;

interface Who { patientId: string; patientName: string; phone: string | null; branchId?: string | null; appointmentId?: string | null; appointmentLabel?: string }

export function CallLogDialog({ who, onClose, onSaved }: { who: Who; onClose: () => void; onSaved: () => void }) {
  const { me, branchId: top } = useAuth();
  const toast = useToast();
  const [f, setF] = useState({
    branchId: who.branchId ?? top ?? me?.branches[0]?.id ?? "", outcome: "", duration: "", note: "",
    followUp: true, dueDate: addDays(localDate(), 1), dueTime: "",
  });
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (!f.outcome) return setErr({ field: "outcome", msg: "Elige el resultado de la llamada" });
    const dur = f.duration.trim() === "" ? null : Number(f.duration);
    if (dur != null && (!Number.isInteger(dur) || dur < 0 || dur > 240)) return setErr({ field: "duration", msg: "Escribe los minutos como número entero entre 0 y 240" });
    const follow = f.outcome === "call_back" && f.followUp;
    if (follow && !f.dueDate) return setErr({ field: "due", msg: "Indica para cuándo es la nueva llamada" });
    if (follow && f.dueDate < localDate()) return setErr({ field: "due", msg: "La fecha no puede ser anterior a hoy" });
    setBusy(true); setErr(null);
    try {
      const r = await api.post<{ taskId: string | null }>(`/api/patients/${who.patientId}/calls`, {
        branchId: f.branchId, appointmentId: who.appointmentId ?? null, outcome: f.outcome, durationMin: dur, note: f.note.trim() || null,
        followUp: follow ? { dueDate: f.dueDate, dueTime: f.dueTime || null } : null,
      });
      toast(r.taskId ? "Llamada registrada y tarea creada para volver a llamar" : "Llamada registrada");
      window.dispatchEvent(new Event("patient-timeline-refresh"));
      onSaved();
    } catch (e: any) { setErr({ msg: String(e.message).replace(/^[a-zA-Z.]+: /, "") }); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Registrar llamada" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar llamada"}</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        <div>
          <b>{who.patientName}</b>
          <div className="muted small">{who.phone ?? "Sin celular registrado"}{who.appointmentLabel ? ` · cita ${who.appointmentLabel}` : ""}</div>
        </div>
        {who.phone && <a className="btn" href={telHref(who.phone)} style={{ alignSelf: "flex-start" }}><Phone size={16} />Llamar al {who.phone}</a>}
        {err && !err.field && <div className="alert danger" role="alert">{err.msg}</div>}
        <Field label="Resultado" group>
          <div className="co-seg">
            {OUTCOMES.map((o) => <button key={o.id} type="button" aria-pressed={f.outcome === o.id} onClick={() => setF({ ...f, outcome: o.id })}>{o.label}</button>)}
          </div>
        </Field>
        {err?.field === "outcome" && <span className="co-err" role="alert">{err.msg}</span>}
        <div className="form-grid">
          <Field label="Duración (minutos)" hint="Opcional; aproximada.">
            <input className="input" inputMode="numeric" value={f.duration} aria-invalid={err?.field === "duration"} onChange={(e) => setF({ ...f, duration: e.target.value })} placeholder="Ej.: 3" />
          </Field>
          {me && me.branches.length > 1 && !who.branchId && (
            <Field label="Desde la sucursal">
              <select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </Field>
          )}
        </div>
        {err?.field === "duration" && <span className="co-err" role="alert">{err.msg}</span>}
        <Field label="Nota (opcional)" hint="Solo datos administrativos: nada clínico.">
          <textarea className="input" rows={2} maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ej.: confirma que vendrá; prefiere que lo llamen en la tarde" />
        </Field>
        {f.outcome === "call_back" && (
          <div className="card card-pad stack-sm">
            <label className="check"><input type="checkbox" checked={f.followUp} onChange={(e) => setF({ ...f, followUp: e.target.checked })} />Crear una tarea para volver a llamar (a tu cargo)</label>
            {f.followUp && (
              <div className="form-grid">
                <Field label="¿Cuándo?"><input className="input" type="date" min={localDate()} value={f.dueDate} aria-invalid={err?.field === "due"} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
                <Field label="Hora (opcional)"><input className="input" type="time" step={900} value={f.dueTime} onChange={(e) => setF({ ...f, dueTime: e.target.value })} /></Field>
              </div>
            )}
            {err?.field === "due" && <span className="co-err" role="alert">{err.msg}</span>}
          </div>
        )}
      </form>
    </Dialog>
  );
}

/** Botones "Llamar" y "Tarea" para la ficha del paciente o el detalle de la cita. */
export function PatientContactActions({ who, onLogged }: { who: Who; onLogged?: () => void }) {
  const { can } = useAuth();
  const [logging, setLogging] = useState(false);
  const [tasking, setTasking] = useState(false);
  const [last, setLast] = useState<string | null>(null);
  if (!can("patients.read")) return null;
  return (
    <div className="row" style={{ gap: 8 }}>
      {who.phone && (
        <a className="btn" href={telHref(who.phone)} onClick={() => setTimeout(() => setLogging(true), 300)} aria-label={`Llamar a ${who.patientName} al ${who.phone}`}>
          <Phone size={16} />Llamar
        </a>
      )}
      <button className="btn" onClick={() => setLogging(true)}><PhoneCall size={16} />Registrar llamada</button>
      {can("tasks.use") && <button className="btn" onClick={() => setTasking(true)}><ClipboardList size={16} />Tarea</button>}
      {last && <span className="muted small" role="status">{last}</span>}
      {logging && <CallLogDialog who={who} onClose={() => setLogging(false)} onSaved={() => { setLogging(false); setLast(`Llamada registrada ${fmtDateTime(new Date())}`); onLogged?.(); }} />}
      {tasking && (
        <NewTaskDialog prefill={{ patient: { id: who.patientId, name: who.patientName }, appointmentId: who.appointmentId ?? null, appointmentLabel: who.appointmentLabel, branchId: who.branchId ?? undefined }}
          onClose={() => setTasking(false)} onSaved={() => setTasking(false)} />
      )}
    </div>
  );
}
