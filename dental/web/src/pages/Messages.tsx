// Bandeja de mensajes salientes (WhatsApp, SMS, correo). Fuera de producción nada se envía:
// aquí se ven los mensajes simulados, incluidos los códigos de un solo uso del portal.
import { useState } from "react";
import { useApi } from "../lib/hooks";
import { qs } from "../lib/api";
import { fmtDateTime } from "../lib/format";
import { Empty, Field, Loading } from "../components/ui";

const MODE: Record<string, { tone: string; text: string }> = {
  simulate: { tone: "info", text: "Modo de pruebas: ningún mensaje sale del sistema. Se guardan aquí como «Simulado»." },
  queue: { tone: "warn", text: "No hay un proveedor de WhatsApp o SMS configurado: los mensajes quedan en cola y no se envían." },
  provider: { tone: "ok", text: "Proveedor de mensajes conectado." },
};
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Correo" };
const TONE: Record<string, string> = { simulated: "info", queued: "warn", sent: "ok", failed: "danger" };

export function MessagesPage() {
  const [status, setStatus] = useState("");
  const [channel, setChannel] = useState("");
  const { data, loading, error } = useApi<{ mode: string; items: any[] }>(`/api/messages${qs({ status, channel, limit: 200 })}`);
  const mode = data ? MODE[data.mode] : null;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Mensajes</h1>
          <p className="sub">Mensajes a pacientes: códigos de acceso, confirmaciones de reservas y avisos</p>
        </div>
        <div className="row">
          <Field label="Estado">
            <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="">Todos</option><option value="simulated">Simulado</option><option value="queued">En cola</option><option value="sent">Enviado</option><option value="failed">Falló</option>
            </select>
          </Field>
          <Field label="Canal">
            <select className="input" value={channel} onChange={(e) => setChannel(e.target.value)}>
              <option value="">Todos</option><option value="whatsapp">WhatsApp</option><option value="sms">SMS</option><option value="email">Correo</option>
            </select>
          </Field>
        </div>
      </div>
      {mode && <div className={`alert ${mode.tone}`}>{mode.text}</div>}
      {error && <div className="alert danger">{error}</div>}
      <div className="card">
        {loading && !data ? <Loading rows={6} /> : !data?.items.length ? <Empty>No hay mensajes.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Para</th><th>Mensaje</th><th>Estado</th></tr></thead>
            <tbody>{data.items.map((m) => (
              <tr key={m.id}>
                <td className="nowrap">{fmtDateTime(m.createdAt)}<div className="muted small">{CHANNEL[m.channel]}</div></td>
                <td>{m.patientName ?? "—"}<div className="muted small nowrap">{m.recipient}</div></td>
                <td style={{ minWidth: 220 }}>{m.body}<div className="muted small">{m.template}{m.branchName ? ` · ${m.branchName}` : ""}</div></td>
                <td><span className={`badge ${TONE[m.status] ?? ""}`}>{m.statusLabel}</span>{m.error && <div className="small muted">{m.error}</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </div>
  );
}
