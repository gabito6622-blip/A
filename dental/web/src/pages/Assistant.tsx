import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { Send, ShieldCheck, Sparkles } from "lucide-react";
import { useApi } from "../lib/hooks";
import { api, newKey } from "../lib/api";
import { addDays, fmtDateLong, fmtTime, localDate } from "../lib/format";
import { Empty, Field, Loading, useToast } from "../components/ui";

const TOOL_LABELS: Record<string, string> = {
  ventas_por_sucursal: "¿Cuánto vendió cada sucursal este mes?",
  buscar_horarios_libres: "Buscar horarios libres",
  presupuestos_pendientes: "Presupuestos pendientes de aprobación",
  preparar_recordatorios: "Preparar recordatorios de mañana",
  pacientes_sin_proxima_cita: "Pacientes sin próxima cita por profesional",
  resumen_agenda: "Resumen de la agenda de hoy",
  proponer_cita: "Proponer una cita",
};

interface Result { id: string; title: string; ui: any; proposal?: any }
interface Msg { role: "user" | "assistant"; content: string; ui?: any[]; proposals?: any[] }

export function AssistantPage() {
  const toast = useToast();
  const tools = useApi<{ llmEnabled: boolean; tools: { name: string; description: string }[] }>("/api/assistant/tools");
  const [results, setResults] = useState<Result[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [slotForm, setSlotForm] = useState({ prestacion: "limpieza", fecha: addDays(localDate(), 1), turno: "any" });
  const run = async (name: string, body: Record<string, unknown> = {}) => {
    setBusy(name);
    try {
      const r = await api.post(`/api/assistant/tools/${name}`, body);
      if (!r.ui) { toast("La consulta no devolvió resultados", true); return; }
      setResults((x) => [{ id: newKey(), title: TOOL_LABELS[name] ?? name, ui: r.ui, proposal: r.proposal }, ...x].slice(0, 8));
    } catch (e: any) { toast(e.message, true); } finally { setBusy(null); }
  };
  const quick = (tools.data?.tools ?? []).filter((t) => t.name !== "proponer_cita" && t.name !== "buscar_horarios_libres");
  const hasSlots = tools.data?.tools.some((t) => t.name === "buscar_horarios_libres");
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div><h1>Asistente</h1><p className="sub">Consultas rápidas sobre los datos reales de tu clínica</p></div>
      </div>
      <div className="alert info row" style={{ alignItems: "flex-start" }}>
        <ShieldCheck size={18} style={{ flex: "none", marginTop: 1 }} />
        <span>El asistente responde <b>solo con datos reales</b> del sistema y con los permisos de tu rol. No ejecuta cambios por su cuenta: cualquier acción (por ejemplo, agendar) requiere tu confirmación. <b>No da diagnósticos ni indicaciones clínicas</b>: esas decisiones corresponden a un profesional habilitado.</span>
      </div>

      {!tools.data ? <div className="card"><Loading /></div> : (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h2>Acciones rápidas</h2></div>
            <div className="card-pad stack">
              {quick.length === 0 && !hasSlots && <p className="muted">Tu rol no tiene acciones disponibles.</p>}
              <div className="row">
                {quick.map((t) => (
                  <button key={t.name} className="btn" disabled={busy === t.name} title={t.description} onClick={() => run(t.name)}>
                    <Sparkles size={15} />{busy === t.name ? "Consultando…" : TOOL_LABELS[t.name] ?? t.name}
                  </button>
                ))}
              </div>
              {hasSlots && (
                <form className="card card-pad stack" onSubmit={(e: FormEvent) => { e.preventDefault(); run("buscar_horarios_libres", { prestacion: slotForm.prestacion || null, fecha: slotForm.fecha || null, turno: slotForm.turno }); }}>
                  <h3>Buscar horarios libres</h3>
                  <div className="form-grid">
                    <Field label="Prestación" hint="Ej.: limpieza, endodoncia, consulta"><input className="input" value={slotForm.prestacion} onChange={(e) => setSlotForm({ ...slotForm, prestacion: e.target.value })} /></Field>
                    <Field label="Fecha"><input className="input" type="date" value={slotForm.fecha} onChange={(e) => setSlotForm({ ...slotForm, fecha: e.target.value })} /></Field>
                    <Field label="Turno">
                      <select className="input" value={slotForm.turno} onChange={(e) => setSlotForm({ ...slotForm, turno: e.target.value })}>
                        <option value="any">Cualquiera</option><option value="morning">Mañana</option><option value="afternoon">Tarde</option>
                      </select>
                    </Field>
                  </div>
                  <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy === "buscar_horarios_libres"}>{busy === "buscar_horarios_libres" ? "Buscando…" : "Buscar"}</button>
                </form>
              )}
            </div>
          </div>
          {tools.data.llmEnabled ? <Chat /> : (
            <div className="card card-pad stack">
              <h2>Conversación con IA</h2>
              <div className="alert warn">El chat con inteligencia artificial no está configurado en este servidor (falta la clave ANTHROPIC_API_KEY). Las acciones rápidas funcionan igual y usan datos reales.</div>
            </div>
          )}
        </div>
      )}

      {results.map((r) => (
        <div key={r.id} className="card">
          <div className="card-head"><h2>{r.ui.title ?? r.title}</h2><button className="btn btn-ghost btn-sm" onClick={() => setResults((x) => x.filter((y) => y.id !== r.id))}>Cerrar</button></div>
          <div className="card-pad"><UiResult ui={r.ui} /></div>
        </div>
      ))}
    </div>
  );
}

function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const send = async (e: FormEvent) => {
    e.preventDefault();
    const q = text.trim();
    if (!q) return;
    const history: Msg[] = [...msgs, { role: "user", content: q }];
    setMsgs(history); setText(""); setBusy(true); setErr(null);
    try {
      const r = await api.post("/api/assistant/chat", { messages: history.map((m) => ({ role: m.role, content: m.content })).slice(-20) });
      setMsgs([...history, { role: "assistant", content: r.reply, ui: r.ui, proposals: r.proposals }]);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  const examples = ["¿Cuánto vendió cada sucursal este mes?", "Busca horarios libres mañana para una limpieza dental", "Muéstrame los presupuestos pendientes de aprobación", "¿Qué doctores tienen más pacientes sin próxima cita?"];
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column" }}>
      <div className="card-head"><h2>Conversación</h2>{msgs.length > 0 && <button className="btn btn-ghost btn-sm" onClick={() => setMsgs([])}>Nueva</button>}</div>
      <div className="card-pad stack" style={{ maxHeight: 520, overflowY: "auto", flex: 1 }}>
        {msgs.length === 0 && (
          <div className="stack-sm">
            <p className="muted small">Prueba con:</p>
            {examples.map((x) => <button key={x} className="btn btn-sm" style={{ justifyContent: "flex-start", whiteSpace: "normal", textAlign: "left" }} onClick={() => setText(x)}>{x}</button>)}
          </div>
        )}
        {msgs.map((m, i) => (
          <div key={i} className="stack-sm" style={{ alignItems: m.role === "user" ? "flex-end" : "flex-start" }}>
            <div style={{ background: m.role === "user" ? "var(--brand-soft)" : "var(--surface-2)", border: "1px solid var(--line)", borderRadius: 12, padding: "9px 12px", maxWidth: "92%", whiteSpace: "pre-wrap" }}>{m.content}</div>
            {m.ui?.map((u, k) => <div key={k} className="card card-pad" style={{ width: "100%" }}><h3 style={{ marginBottom: 8 }}>{u.title}</h3><UiResult ui={u} /></div>)}
          </div>
        ))}
        {busy && <p className="muted small">El asistente está consultando…</p>}
        {err && <div className="alert danger">{err}</div>}
      </div>
      <form className="row" style={{ padding: 14, borderTop: "1px solid var(--line)", flexWrap: "nowrap" }} onSubmit={send}>
        <input className="input" placeholder="Escribe tu consulta…" value={text} onChange={(e) => setText(e.target.value)} maxLength={4000} aria-label="Consulta" />
        <button className="btn btn-primary btn-icon" disabled={busy || !text.trim()} aria-label="Enviar"><Send size={16} /></button>
      </form>
    </div>
  );
}

function UiResult({ ui }: { ui: any }) {
  const toast = useToast();
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  if (!ui) return null;
  if (ui.type === "table" || ui.type === "budgets") {
    const rows: any[] = ui.rows ?? [];
    if (!rows.length) return <Empty>Sin resultados.</Empty>;
    const cols = Object.keys(rows[0]).filter((k) => k !== "budgetId");
    const label = (k: string) => k.replace(/([A-Z])/g, " $1").replace(/_/g, " ").replace(/^./, (c) => c.toUpperCase());
    return (
      <div className="table-wrap">
        <table className="table">
          <thead><tr>{cols.map((c) => <th key={c}>{label(c)}</th>)}</tr></thead>
          <tbody>{rows.map((r, i) => <tr key={i}>{cols.map((c) => <td key={c}>{String(r[c] ?? "—")}</td>)}</tr>)}</tbody>
        </table>
      </div>
    );
  }
  if (ui.type === "slots") {
    const slots: any[] = ui.slots ?? [];
    if (!slots.length) return <Empty>No hay horarios libres con esos criterios.</Empty>;
    return (
      <div className="stack-sm">
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Hora</th><th>Profesional</th><th>Sucursal</th></tr></thead>
            <tbody>{slots.map((s, i) => <tr key={i}><td>{fmtDateLong(s.inicio)}</td><td><b>{fmtTime(s.inicio)}</b></td><td>{s.profesional}</td><td>{s.sucursal}</td></tr>)}</tbody>
          </table>
        </div>
        <p className="muted small">Para agendar, usa la Agenda o pide al asistente «Proponer cita» indicando el N° de ficha del paciente; la cita se crea solo cuando la confirmas.</p>
      </div>
    );
  }
  if (ui.type === "reminders") {
    return (
      <div className="stack-sm">
        <p>Los recordatorios de {ui.date} están listos para enviarse uno por uno, solo a pacientes con consentimiento.</p>
        <Link className="btn btn-primary" style={{ alignSelf: "flex-start" }} to="/agenda">Abrir Agenda → Recordatorios</Link>
      </div>
    );
  }
  if (ui.type === "proposal") {
    const confirm = async () => {
      setBusy(true);
      try {
        await api.post("/api/appointments", { ...ui.payload, idempotencyKey: newKey() });
        toast("Cita agendada"); setDone(true);
      } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
    };
    return (
      <div className="card card-pad stack-sm" style={{ borderColor: "var(--brand)" }}>
        <b>{ui.summary}</b>
        <p className="muted small">Revisa los datos. La cita se agenda únicamente al confirmar, con todas las validaciones de la agenda.</p>
        {done ? <span className="badge ok">Agendada</span> : <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={confirm}>{busy ? "Agendando…" : "Confirmar y agendar"}</button>}
      </div>
    );
  }
  return <pre className="small" style={{ whiteSpace: "pre-wrap" }}>{JSON.stringify(ui, null, 2)}</pre>;
}
