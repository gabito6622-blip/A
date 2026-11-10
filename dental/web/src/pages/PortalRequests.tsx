// Agenda → "Solicitudes web": reservas en modo solicitud que recepción aprueba (crea la cita con
// las validaciones normales) o rechaza con un motivo que se envía al paciente.
import { useState } from "react";
import { Inbox } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { Dialog, Empty, Field, Loading, useToast } from "../components/ui";

export function PortalRequestsButton({ branchId, onChanged }: { branchId: string | null; onChanged: () => void }) {
  const [open, setOpen] = useState(false);
  const pending = useApi<any[]>(`/api/portal/requests${qs({ branchId })}`);
  const n = pending.data?.length ?? 0;
  return (
    <>
      <button className="btn" onClick={() => setOpen(true)}><Inbox size={16} />Solicitudes web{n > 0 && <span className="badge warn">{n}</span>}</button>
      {open && <RequestsDialog branchId={branchId} onClose={() => { setOpen(false); pending.reload(); }} onChanged={() => { pending.reload(); onChanged(); }} />}
    </>
  );
}

function RequestsDialog({ branchId, onClose, onChanged }: { branchId: string | null; onClose: () => void; onChanged: () => void }) {
  const [view, setView] = useState<"pending" | "decided">("pending");
  const list = useApi<any[]>(`/api/portal/requests${qs({ branchId, status: view })}`);
  return (
    <Dialog title="Solicitudes web" onClose={onClose} wide>
      <div className="stack">
        <div className="row">
          <button className={`btn btn-sm ${view === "pending" ? "btn-primary" : ""}`} onClick={() => setView("pending")}>Pendientes</button>
          <button className={`btn btn-sm ${view === "decided" ? "btn-primary" : ""}`} onClick={() => setView("decided")}>Atendidas (30 días)</button>
        </div>
        {list.loading && !list.data ? <Loading /> : !list.data?.length ? <Empty>{view === "pending" ? "No hay solicitudes pendientes." : "Sin solicitudes atendidas."}</Empty> : (
          list.data.map((r) => <RequestRow key={r.id} r={r} onDone={() => { list.reload(); onChanged(); }} />)
        )}
      </div>
    </Dialog>
  );
}

function RequestRow({ r, onDone }: { r: any; onDone: () => void }) {
  const toast = useToast();
  const { can } = useAuth();
  const staff = useApi<any[]>(r.status === "pending" ? "/api/staff?professionals=1" : null);
  const [dentistId, setDentistId] = useState<string>(r.dentistId ?? "");
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const approve = async () => {
    setBusy(true); setErr(null);
    try { await api.post(`/api/portal/requests/${r.id}/approve`, { dentistId: dentistId || undefined }); toast("Cita creada y paciente avisado"); onDone(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const reject = async () => {
    if (reason.trim().length < 3) return setErr("Escribe el motivo (lo verá el paciente)");
    setBusy(true); setErr(null);
    try { await api.post(`/api/portal/requests/${r.id}/reject`, { reason }); toast("Solicitud rechazada; se avisó al paciente"); onDone(); }
    catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const pros = (staff.data ?? []).filter((s: any) => s.active !== false && (s.allBranches || !s.branchIds || s.branchIds.includes(r.branchId)));
  return (
    <div className="card card-pad stack-sm" style={{ boxShadow: "none" }}>
      <div className="row-between">
        <div>
          <b>{r.when.date} · {r.when.time}</b> <span className="muted">· {r.procedureName}</span>
          <div className="small">{r.patientName} (ficha {r.recordNumber}){r.newPatient && <span className="badge info" style={{ marginLeft: 6 }}>Paciente nuevo</span>} · {r.phone ?? "sin celular"}</div>
          <div className="small muted">{r.branchName} · código {r.code} · enviada {fmtDateTime(r.createdAt)}</div>
          {r.patientNotes && <div className="small" style={{ color: "var(--warn)" }}>{r.patientNotes}</div>}
        </div>
        <span className={`badge ${r.status === "approved" ? "ok" : r.status === "pending" ? "warn" : "danger"}`}>{r.status === "pending" ? (r.expired ? "Hora vencida" : "Pendiente") : r.statusLabel}</span>
      </div>
      {r.decisionReason && <p className="small muted">Motivo: {r.decisionReason}</p>}
      {err && <div className="alert danger" role="alert">{err}</div>}
      {r.status === "pending" && can("agenda.write") && (
        rejecting ? (
          <div className="stack-sm">
            <Field label="Motivo del rechazo (se envía al paciente)"><input className="input" value={reason} maxLength={300} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: ese día no hay atención; escríbenos para otro horario" /></Field>
            <div className="row"><button className="btn btn-sm" onClick={() => setRejecting(false)}>Volver</button><button className="btn btn-sm btn-danger" disabled={busy} onClick={reject}>Rechazar solicitud</button></div>
          </div>
        ) : (
          <div className="row">
            <Field label="Profesional">
              <select className="input" value={dentistId} onChange={(e) => setDentistId(e.target.value)} style={{ minWidth: 200 }}>
                {!dentistId && <option value="">Elegir…</option>}
                {pros.map((s: any) => <option key={s.userId} value={s.userId}>{s.fullName}</option>)}
                {dentistId && !pros.some((s: any) => s.userId === dentistId) && <option value={dentistId}>{r.dentistName ?? "Profesional solicitado"}</option>}
              </select>
            </Field>
            <button className="btn btn-primary btn-sm" disabled={busy || r.expired} onClick={approve}>Aprobar y crear cita</button>
            <button className="btn btn-sm" disabled={busy} onClick={() => setRejecting(true)}>Rechazar…</button>
          </div>
        )
      )}
    </div>
  );
}
