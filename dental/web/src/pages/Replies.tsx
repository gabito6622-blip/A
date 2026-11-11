// Respuestas de los pacientes por WhatsApp (B-070): recepción las ve por sucursal y las marca
// atendidas. Las «BAJA» no aparecen: se procesan solas (consentimiento revocado).
import { useState } from "react";
import { Link } from "react-router-dom";
import { CheckCircle2, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime } from "../lib/format";
import { useApi } from "../lib/hooks";
import { Empty, Loading, Tabs, useAsk, useToast } from "../components/ui";

type Status = "pending" | "handled";

export function RepliesPage() {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const [tab, setTab] = useState<Status>("pending");
  const r = useApi<any[]>(`/api/messaging/replies?status=${tab}`);
  const act = async (x: any, action: "handled" | "reopen") => {
    let note: string | null = null;
    if (action === "handled") {
      const v = await ask({ title: "Marcar atendida", message: `Respuesta de ${x.patientName ?? x.sender}: «${x.body.slice(0, 120)}»`, inputLabel: "Nota (opcional)", placeholder: "Ej.: la llamé y reprogramamos para el jueves", minLength: 0, confirmLabel: "Marcar atendida" });
      if (v === null) return;
      note = v.trim() || null;
    }
    try {
      await api.post(`/api/messaging/replies/${x.id}/${action}`, { note });
      toast(action === "handled" ? "Respuesta atendida" : "Respuesta pendiente otra vez");
      r.reload();
    } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Respuestas</h1><p className="sub">Lo que los pacientes contestan por WhatsApp a los mensajes de la clínica</p></div>
      </div>
      <Tabs value={tab} onChange={setTab} items={[{ id: "pending", label: "Sin atender" }, { id: "handled", label: "Atendidas" }]} />
      <div className="card">
        {!r.data ? <Loading /> : r.data.length === 0 ? (
          <Empty>{tab === "pending" ? "No hay respuestas sin atender." : "Todavía no hay respuestas atendidas."}</Empty>
        ) : (
          <ul className="reply-list">
            {r.data.map((x) => (
              <li key={x.id} className="reply-item">
                <div className="row-between" style={{ alignItems: "flex-start", gap: 12 }}>
                  <div style={{ minWidth: 0 }}>
                    <b>{x.patientId ? <Link to={`/pacientes/${x.patientId}`}>{x.patientName}</Link> : (x.patientName ?? x.sender)}</b>
                    <div className="muted small">{fmtDateTime(x.createdAt)}{x.branchName ? ` · ${x.branchName}` : ""}</div>
                  </div>
                  {can("patients.write") && (tab === "pending"
                    ? <button className="btn btn-sm btn-primary" onClick={() => act(x, "handled")}><CheckCircle2 size={14} />Marcar atendida</button>
                    : <button className="btn btn-sm" onClick={() => act(x, "reopen")}><RotateCcw size={14} />Volver a pendiente</button>)}
                </div>
                <p className="reply-body">{x.body}</p>
                {x.handled && <p className="muted small">Atendida por {x.handledBy} · {fmtDateTime(x.handledAt)}{x.handledNote ? ` · ${x.handledNote}` : ""}</p>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
