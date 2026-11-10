// Mensajes a pacientes: panel de entregas (estado por mensaje, filtros por sucursal, estado y regla,
// reintento de los fallidos), mensajes programados u omitidos con su motivo, conteo por día y
// respuestas recibidas. Fuera de producción nada se envía: todo aparece como «Simulado».
import { useState } from "react";
import { RotateCcw } from "lucide-react";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime } from "../lib/format";
import { Empty, Field, Loading, Tabs, useToast } from "../components/ui";

const MODE: Record<string, { tone: string; text: string }> = {
  simulate: { tone: "info", text: "Modo de pruebas: ningún mensaje sale del sistema. Se guardan aquí como «Simulado»." },
  queue: { tone: "warn", text: "No hay un proveedor de WhatsApp o SMS configurado: los mensajes quedan en cola y no se envían." },
  provider: { tone: "ok", text: "Proveedor de mensajes conectado." },
};
const CHANNEL: Record<string, string> = { whatsapp: "WhatsApp", sms: "SMS", email: "Correo" };
const TONE: Record<string, string> = { simulated: "info", queued: "warn", sent: "ok", delivered: "ok", read: "ok", failed: "danger", pending: "info", done: "ok", skipped: "warn", cancelled: "" };
const PURPOSE: Record<string, string> = { transactional: "Aviso", otp: "Código", reminders: "Recordatorio", marketing: "Marketing" };

type Tab = "entregas" | "programados" | "dias" | "respuestas";

export function MessagesPage() {
  const [tab, setTab] = useState<Tab>("entregas");
  const [branchId, setBranchId] = useState("");
  const [ruleId, setRuleId] = useState("");
  const { me } = useAuth();
  const rules = useApi<any[]>("/api/messaging/rules");
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Mensajes</h1>
          <p className="sub">Recordatorios automáticos, confirmaciones, códigos de acceso y avisos a pacientes</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} items={[
        { id: "entregas", label: "Entregas" }, { id: "programados", label: "Programados y omitidos" },
        { id: "dias", label: "Por día" }, { id: "respuestas", label: "Respuestas" },
      ]} />
      {tab !== "respuestas" && (
        <div className="row">
          <Field label="Sucursal">
            <select className="input" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
              <option value="">Todas</option>
              {me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Regla">
            <select className="input" value={ruleId} onChange={(e) => setRuleId(e.target.value)}>
              <option value="">Todas</option>
              {rules.data?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
        </div>
      )}
      {tab === "entregas" && <Deliveries branchId={branchId} ruleId={ruleId} />}
      {tab === "programados" && <Jobs branchId={branchId} ruleId={ruleId} />}
      {tab === "dias" && <PerDay branchId={branchId} ruleId={ruleId} />}
      {tab === "respuestas" && <Inbound />}
    </div>
  );
}

function Deliveries({ branchId, ruleId }: { branchId: string; ruleId: string }) {
  const toast = useToast();
  const [status, setStatus] = useState("");
  const [origin, setOrigin] = useState("all");
  const [busy, setBusy] = useState<string | null>(null);
  const { data, loading, error, reload } = useApi<{ mode: string; items: any[] }>(`/api/messaging/deliveries${qs({ status, branchId, ruleId, origin, limit: 200 })}`);
  const mode = data ? MODE[data.mode] : null;
  const retry = async (m: any) => {
    setBusy(m.id);
    try { const r = await api.post(`/api/messaging/messages/${m.id}/retry`); toast(`Reintento: ${r.statusLabel}`); reload(); }
    catch (e: any) { toast(e.message, true); } finally { setBusy(null); }
  };
  return (
    <>
      <div className="row">
        <Field label="Estado">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">Todos</option><option value="simulated">Simulado</option><option value="queued">En cola</option><option value="sent">Enviado</option>
            <option value="delivered">Entregado</option><option value="read">Leído</option><option value="failed">Falló</option>
          </select>
        </Field>
        <Field label="Origen">
          <select className="input" value={origin} onChange={(e) => setOrigin(e.target.value)}>
            <option value="all">Todos los mensajes</option><option value="auto">Solo automáticos</option>
          </select>
        </Field>
      </div>
      {mode && <div className={`alert ${mode.tone}`}>{mode.text}</div>}
      {error && <div className="alert danger">{error}</div>}
      <div className="card">
        {loading && !data ? <Loading rows={6} /> : !data?.items.length ? <Empty>No hay mensajes con esos filtros.</Empty> : (
          <div className="table-wrap"><table className="table" aria-label="Entregas">
            <thead><tr><th>Mensaje</th><th>Estado</th></tr></thead>
            <tbody>{data.items.map((m) => (
              <tr key={m.id}>
                <td style={{ minWidth: 200, overflowWrap: "anywhere" }}>
                  <div className="small"><b>{m.patientName ?? m.recipient}</b> · {fmtDateTime(m.createdAt)}</div>
                  <div className="muted small">{CHANNEL[m.channel]} {m.recipient} · {PURPOSE[m.purpose] ?? m.purpose}</div>
                  <div style={{ margin: "4px 0" }}>{m.body}</div>
                  <div className="muted small">{m.ruleName ?? m.template}{m.branchName ? ` · ${m.branchName}` : ""}{m.retryOf ? " · reintento" : ""}</div>
                </td>
                <td>
                  <span className={`badge ${TONE[m.status] ?? ""}`}>{m.statusLabel}</span>
                  {m.error && <div className="small muted">{m.error}</div>}
                  {m.status === "failed" && !m.retriedBy && m.purpose !== "otp" && (
                    <div><button className="btn btn-sm" style={{ marginTop: 6 }} disabled={busy === m.id} onClick={() => retry(m)}><RotateCcw size={14} />Reintentar</button></div>
                  )}
                  {m.retriedBy && <div className="small muted">Ya se reintentó</div>}
                </td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function Jobs({ branchId, ruleId }: { branchId: string; ruleId: string }) {
  const [status, setStatus] = useState("pending");
  const { data, loading, error } = useApi<any[]>(`/api/messaging/jobs${qs({ status, branchId, ruleId })}`);
  return (
    <>
      <div className="row">
        <Field label="Mostrar">
          <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="pending">Programados</option><option value="skipped">Omitidos (con motivo)</option><option value="cancelled">Anulados</option><option value="done">Enviados a la bandeja</option>
          </select>
        </Field>
      </div>
      {error && <div className="alert danger">{error}</div>}
      <div className="card">
        {loading && !data ? <Loading rows={5} /> : !data?.length ? <Empty>No hay mensajes en este estado.</Empty> : (
          <div className="table-wrap"><table className="table" aria-label="Mensajes programados">
            <thead><tr><th>{status === "pending" ? "Sale" : "Cuándo"}</th><th>Paciente</th><th>Regla</th><th>Estado</th></tr></thead>
            <tbody>{data.map((j) => (
              <tr key={j.id}>
                <td className="nowrap">{fmtDateTime(status === "pending" ? j.sendAt : j.processedAt ?? j.updatedAt)}</td>
                <td>{j.patientName}<div className="muted small">{j.branchName}</div></td>
                <td>{j.ruleName}<div className="muted small">{j.triggerLabel}</div></td>
                <td><span className={`badge ${TONE[j.status] ?? ""}`}>{j.statusLabel}</span>{j.reason && <div className="small muted">{j.reason}</div>}</td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
    </>
  );
}

function PerDay({ branchId, ruleId }: { branchId: string; ruleId: string }) {
  const { data, loading, error } = useApi<any[]>(`/api/messaging/stats${qs({ days: 14, branchId, ruleId })}`);
  const cols: [string, string][] = [["total", "Total"], ["simulated", "Simulados"], ["queued", "En cola"], ["sent", "Enviados"], ["delivered", "Entregados"], ["read", "Leídos"], ["failed", "Fallidos"], ["skipped", "Omitidos"]];
  return (
    <div className="card">
      {error && <div className="alert danger">{error}</div>}
      {loading && !data ? <Loading rows={4} /> : !data?.length ? <Empty>Sin mensajes en los últimos 14 días.</Empty> : (
        <div className="table-wrap"><table className="table" aria-label="Mensajes por día">
          <thead><tr><th>Día</th>{cols.map(([k, l]) => <th key={k} className="num">{l}</th>)}</tr></thead>
          <tbody>{data.map((d) => (
            <tr key={d.day}><td className="nowrap">{d.day.split("-").reverse().join("/")}</td>{cols.map(([k]) => <td key={k} className="num">{d[k] || "—"}</td>)}</tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}

function Inbound() {
  const { data, loading, error } = useApi<any[]>("/api/messaging/inbound");
  return (
    <div className="card">
      <div className="card-head"><div><h2>Respuestas de pacientes</h2><p className="muted small">Llegan por el webhook de WhatsApp. Las bajas («BAJA») se registran solas como revocación del consentimiento.</p></div></div>
      {error && <div className="alert danger">{error}</div>}
      {loading && !data ? <Loading rows={3} /> : !data?.length ? <Empty>No hay respuestas.</Empty> : (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>Fecha</th><th>Paciente</th><th>Mensaje</th></tr></thead>
          <tbody>{data.map((m) => (
            <tr key={m.id}><td className="nowrap">{fmtDateTime(m.createdAt)}</td><td>{m.patientName ?? m.sender}</td>
              <td>{m.body} {m.kind === "opt_out" && <span className="badge warn">Baja registrada</span>}</td></tr>
          ))}</tbody>
        </table></div>
      )}
    </div>
  );
}
