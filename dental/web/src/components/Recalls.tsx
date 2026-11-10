// Controles ("volver a citar"): diálogo "Próximo control", intentos de contacto,
// descarte, alta manual, selector al agendar y tarjeta de la ficha del paciente.
import { useEffect, useState } from "react";
import { CalendarPlus, PhoneCall } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { fmtDate, fmtDateTime, localDate } from "../lib/format";
import { Dialog, Empty, Field, Loading, useToast } from "./ui";

/** Altura mínima táctil de los botones de este módulo. */
export const TAP = { minHeight: 40 } as const;

export const RECALL_STATUS: Record<string, { label: string; tone: string }> = {
  pending: { label: "Pendiente", tone: "info" },
  scheduled: { label: "Agendado", tone: "ok" },
  done: { label: "Hecho", tone: "" },
  dismissed: { label: "Descartado", tone: "" },
  review: { label: "Revisar", tone: "warn" },
};
export const PRIORITY: Record<string, { label: string; tone: string }> = {
  high: { label: "Alta", tone: "danger" }, normal: { label: "Normal", tone: "" }, low: { label: "Baja", tone: "" },
};
export const CHANNELS: { id: string; label: string }[] = [
  { id: "call", label: "Llamada" }, { id: "whatsapp", label: "WhatsApp" }, { id: "sms", label: "SMS" }, { id: "in_person", label: "En persona" },
];
export const OUTCOMES: { id: string; label: string; failed?: boolean }[] = [
  { id: "no_answer", label: "No contesta", failed: true }, { id: "voicemail", label: "Buzón de voz", failed: true },
  { id: "scheduled", label: "Agendó una cita" }, { id: "declined", label: "No desea por ahora", failed: true },
  { id: "wrong_number", label: "Número equivocado", failed: true }, { id: "other", label: "Otro" },
];
export const outcomeLabel = (id: string) => OUTCOMES.find((o) => o.id === id)?.label ?? id;
export const channelLabel = (id: string) => CHANNELS.find((o) => o.id === id)?.label ?? id;

export function RecallStatusBadge({ status }: { status: string }) {
  const s = RECALL_STATUS[status] ?? { label: status, tone: "" };
  return <span className={`badge ${s.tone}`}>{s.label}</span>;
}

/** "mayo de 2027" a partir de AAAA-MM-DD o AAAA-MM. */
export const monthLabel = (iso: string) => {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return new Intl.DateTimeFormat("es-BO", { month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(Date.UTC(y, m - 1, 15)));
};
/** Suma meses a una fecha AAAA-MM-DD (fin de mes ajustado, como el servidor). */
export const addMonths = (iso: string, n: number) => {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const last = new Date(Date.UTC(y, m - 1 + n + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + n, Math.min(d, last))).toISOString().slice(0, 10);
};

/** Botones de opción de un grupo (accesibles con aria-pressed). */
function Choice<T extends string | number>({ options, value, onChange }: { options: { id: T; label: string }[]; value: T; onChange: (v: T) => void }) {
  return (
    <div className="row" style={{ gap: 6 }}>
      {options.map((o) => (
        <button key={String(o.id)} type="button" className={`btn btn-sm ${value === o.id ? "btn-primary" : ""}`} style={TAP} aria-pressed={value === o.id} onClick={() => onChange(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

// ---------------- Próximo control (al marcar "Atendida") ----------------
export function NextControlDialog({ appointmentId, onClose, onDone }: { appointmentId: string; onClose: () => void; onDone?: () => void }) {
  const toast = useToast();
  const s = useApi<any>(`/api/recalls/suggestion${qs({ appointmentId })}`);
  const [f, setF] = useState<{ reason: string; months: number; procedureId: string | null; priority: string; note: string } | null>(null);
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (s.data && !f) setF({ reason: s.data.suggested.reason, months: s.data.suggested.months, procedureId: s.data.suggested.procedureId, priority: "normal", note: "" });
  }, [s.data, f]);
  const d = s.data;
  const due = d && f && f.months >= 1 && f.months <= 60 ? addMonths(d.appointment.date, f.months) : null;
  const notNow = async () => {
    try { await api.post("/api/recalls/skip", { appointmentId }); } catch { /* el registro de "Ahora no" no debe bloquear */ }
    onClose();
  };
  const save = async () => {
    if (!f || !d) return;
    if (f.reason.trim().length < 2) { setErr({ field: "reason", msg: "Indica el motivo del control" }); return; }
    if (!Number.isInteger(f.months) || f.months < 1 || f.months > 60) { setErr({ field: "months", msg: "Elige entre 1 y 60 meses" }); return; }
    setBusy(true); setErr(null);
    try {
      await api.post("/api/recalls", {
        patientId: d.appointment.patientId, sourceAppointmentId: appointmentId, reason: f.reason.trim(), months: f.months,
        procedureId: f.procedureId, priority: f.priority, note: f.note || null,
      });
      toast(`Control programado para ${monthLabel(due!)}`);
      onDone?.();
      onClose();
    } catch (e: any) { setErr({ msg: e.message }); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Próximo control" onClose={onClose}
      footer={d?.alreadyCreated ? <button className="btn" style={TAP} onClick={onClose}>Cerrar</button> : (
        <>
          <button className="btn" style={TAP} onClick={notNow}>Ahora no</button>
          <button className="btn btn-primary" style={TAP} disabled={busy || !f} onClick={save}><CalendarPlus size={16} />{busy ? "Guardando…" : "Programar control"}</button>
        </>
      )}>
      {!d || !f ? (s.error ? <div className="alert danger" role="alert">{s.error}</div> : <Loading />) : (
        <div className="stack">
          <p style={{ margin: 0 }}><b>{d.appointment.patientName}</b> fue atendido. ¿Cuándo conviene que vuelva?</p>
          {d.alreadyCreated ? (
            <div className="alert ok">Ya se programó un control para esta cita: {d.alreadyCreated.reason}, {monthLabel(d.alreadyCreated.dueDate)}.</div>
          ) : (
            <>
              {err && !err.field && <div className="alert danger" role="alert">{err.msg}</div>}
              {d.options.length > 1 && (
                <Field label="Prestación de referencia" group>
                  <Choice options={d.options.map((o: any) => ({ id: o.procedureId as string, label: `${o.name} · ${o.months} m` }))} value={f.procedureId ?? ""}
                    onChange={(id) => { const o = d.options.find((x: any) => x.procedureId === id); setF({ ...f, procedureId: id, reason: o.name, months: o.months }); }} />
                </Field>
              )}
              <Field label="Motivo del control" hint="Lo ve el personal en la lista de llamadas. No se envía al paciente.">
                <input className="input" value={f.reason} maxLength={200} aria-invalid={err?.field === "reason"} onChange={(e) => setF({ ...f, reason: e.target.value })} />
              </Field>
              {err?.field === "reason" && <div className="alert danger small" role="alert">{err.msg}</div>}
              <Field label="¿En cuánto tiempo?" group>
                <div className="row" style={{ gap: 6 }}>
                  <Choice options={[1, 3, 6, 12].map((m) => ({ id: m, label: m === 1 ? "1 mes" : `${m} meses` }))} value={f.months} onChange={(m) => setF({ ...f, months: m })} />
                  <label className="row" style={{ gap: 6 }}>
                    <span className="muted small">Otro:</span>
                    <input className="input" type="number" min={1} max={60} style={{ width: 80 }} aria-label="Meses hasta el control" value={f.months}
                      aria-invalid={err?.field === "months"} onChange={(e) => setF({ ...f, months: Number(e.target.value) })} />
                  </label>
                </div>
              </Field>
              {err?.field === "months" && <div className="alert danger small" role="alert">{err.msg}</div>}
              {due && <div className="alert info small">Quedará en la lista de controles de <b>{monthLabel(due)}</b> (fecha objetivo {fmtDate(due + "T12:00:00Z")}).</div>}
              <div className="form-grid">
                <Field label="Prioridad">
                  <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}>
                    <option value="normal">Normal</option><option value="high">Alta</option><option value="low">Baja</option>
                  </select>
                </Field>
                <Field label="Nota interna (opcional)"><input className="input" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ej.: prefiere turno tarde" /></Field>
              </div>
              {d.existing.length > 0 && (
                <p className="muted small" style={{ margin: 0 }}>
                  Ya tiene {d.existing.length === 1 ? "un control abierto" : `${d.existing.length} controles abiertos`}: {d.existing.map((x: any) => `${x.reason} (${monthLabel(x.dueDate)})`).join(" · ")}.
                </p>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ---------------- Registrar intento ----------------
export function AttemptDialog({ recall, defaultChannel = "call", onClose, onSaved }: { recall: any; defaultChannel?: string; onClose: () => void; onSaved: (r: any) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ channel: defaultChannel, outcome: "", note: "" });
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const hist = useApi<any[]>(`/api/recalls/${recall.id}/attempts`);
  const save = async () => {
    if (!f.outcome) { setErr({ field: "outcome", msg: "Elige el resultado del intento" }); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.post(`/api/recalls/${recall.id}/attempts`, { channel: f.channel, outcome: f.outcome, note: f.note || null });
      toast(r.status === "review" ? "Intento registrado. Tras 3 intentos sin éxito, el control pasó a «Revisar»." : "Intento registrado");
      onSaved(r);
    } catch (e: any) { setErr({ msg: e.message }); } finally { setBusy(false); }
  };
  const failedLeft = Math.max(0, 3 - (recall.failedAttempts ?? 0));
  return (
    <Dialog title="Registrar intento de contacto" onClose={onClose}
      footer={<><button className="btn" style={TAP} onClick={onClose}>Cancelar</button><button className="btn btn-primary" style={TAP} disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar intento"}</button></>}>
      <div className="stack">
        <div><b>{recall.patientName}</b><div className="muted small">{recall.reason} · {recall.patientPhone ?? "sin celular"}</div></div>
        {err && !err.field && <div className="alert danger" role="alert">{err.msg}</div>}
        <Field label="Canal" group><Choice options={CHANNELS} value={f.channel} onChange={(channel) => setF({ ...f, channel })} /></Field>
        <Field label="Resultado" group><Choice options={OUTCOMES} value={f.outcome} onChange={(outcome) => setF({ ...f, outcome })} /></Field>
        {err?.field === "outcome" && <div className="alert danger small" role="alert">{err.msg}</div>}
        <Field label="Nota (opcional)"><textarea className="input" maxLength={500} rows={2} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} placeholder="Ej.: pidió que llamemos el lunes" /></Field>
        {recall.status === "pending" && <p className="muted small" style={{ margin: 0 }}>
          «No contesta», «Buzón de voz», «No desea» y «Número equivocado» cuentan como intento sin éxito.{" "}
          {failedLeft > 0 ? `Con ${failedLeft} más, el control pasa a «Revisar».` : ""}
        </p>}
        {f.outcome === "scheduled" && <div className="alert info small">Recuerda agendar la cita con el botón «Agendar»: así el control queda vinculado.</div>}
        {!!hist.data?.length && (
          <div className="stack-sm">
            <span className="label">Intentos anteriores</span>
            {hist.data.map((h) => (
              <div key={h.id} className="row-between small" style={{ borderBottom: "1px solid var(--line)", padding: "4px 0" }}>
                <span>{h.channelLabel} · <b>{h.outcomeLabel}</b>{h.note ? ` — ${h.note}` : ""}</span>
                <span className="muted nowrap">{fmtDateTime(h.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </Dialog>
  );
}

// ---------------- Descartar ----------------
export function DismissDialog({ recall, onClose, onSaved }: { recall: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [reason, setReason] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (reason.trim().length < 3) { setErr("Indica el motivo (mínimo 3 caracteres)"); return; }
    try { await api.post(`/api/recalls/${recall.id}/dismiss`, { reason: reason.trim() }); toast("Control descartado"); onSaved(); }
    catch (e: any) { setErr(e.message); }
  };
  return (
    <Dialog title="Descartar control" onClose={onClose}
      footer={<><button className="btn" style={TAP} onClick={onClose}>Volver</button><button className="btn btn-danger" style={TAP} onClick={save}>Descartar</button></>}>
      <div className="stack">
        <p style={{ margin: 0 }}><b>{recall.patientName}</b> · {recall.reason}. El control sale de la lista pero no se borra.</p>
        <Field label="Motivo"><input className="input" autoFocus maxLength={300} value={reason} aria-invalid={!!err} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: se mudó, se atiende en otra clínica" /></Field>
        {err && <div className="alert danger small" role="alert">{err}</div>}
      </div>
    </Dialog>
  );
}

// ---------------- Alta manual (desde la ficha) ----------------
export function NewRecallDialog({ patientId, onClose, onSaved }: { patientId: string; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const { me, branchId } = useAuth();
  const [f, setF] = useState({ branchId: branchId ?? me?.branches[0]?.id ?? "", reason: "", months: 6, priority: "normal", note: "" });
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const due = addMonths(localDate(), f.months || 0);
  const save = async () => {
    if (f.reason.trim().length < 2) { setErr({ field: "reason", msg: "Indica el motivo del control" }); return; }
    try {
      await api.post("/api/recalls", { patientId, branchId: f.branchId, reason: f.reason.trim(), months: f.months, priority: f.priority, note: f.note || null });
      toast("Control programado"); onSaved();
    } catch (e: any) { setErr({ msg: e.message }); }
  };
  return (
    <Dialog title="Programar control" onClose={onClose}
      footer={<><button className="btn" style={TAP} onClick={onClose}>Cancelar</button><button className="btn btn-primary" style={TAP} onClick={save}>Programar</button></>}>
      <div className="stack">
        {err && !err.field && <div className="alert danger" role="alert">{err.msg}</div>}
        <Field label="Motivo"><input className="input" maxLength={200} value={f.reason} aria-invalid={err?.field === "reason"} onChange={(e) => setF({ ...f, reason: e.target.value })} placeholder="Ej.: Higiene dental" /></Field>
        {err?.field === "reason" && <div className="alert danger small" role="alert">{err.msg}</div>}
        <Field label="¿En cuánto tiempo?" group hint={`Fecha objetivo: ${fmtDate(due + "T12:00:00Z")} (${monthLabel(due)})`}>
          <Choice options={[1, 3, 6, 12].map((m) => ({ id: m, label: m === 1 ? "1 mes" : `${m} meses` }))} value={f.months} onChange={(m) => setF({ ...f, months: m })} />
        </Field>
        <div className="form-grid">
          {me && me.branches.length > 1 && (
            <Field label="Sucursal">
              <select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
            </Field>
          )}
          <Field label="Prioridad">
            <select className="input" value={f.priority} onChange={(e) => setF({ ...f, priority: e.target.value })}><option value="normal">Normal</option><option value="high">Alta</option><option value="low">Baja</option></select>
          </Field>
          <Field label="Nota interna (opcional)" span2><input className="input" maxLength={500} value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></Field>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------- Selector al agendar ----------------
/**
 * Muestra los controles pendientes que la cita puede cubrir.
 * value: id elegido, null = no vincular. Con un solo control se propone vincularlo; con 2 o más hay que elegir.
 */
export function RecallLinkPicker({ patientId, procedureId, date, fixed, value, onChange }: {
  patientId: string; procedureId: string | null; date: string; fixed?: { id: string; reason: string } | null;
  value: string | null | undefined; onChange: (v: string | null | undefined) => void;
}) {
  const c = useApi<any[]>(fixed ? null : `/api/recalls/candidates${qs({ patientId, procedureId: procedureId || undefined, date })}`);
  const list = c.data ?? [];
  useEffect(() => {
    if (fixed) { onChange(fixed.id); return; }
    if (!c.data) return;
    if (c.data.length === 0) onChange(undefined);
    else if (c.data.length === 1) onChange(c.data[0].id);
    else onChange(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [c.data, fixed?.id]);
  if (fixed) return <div className="alert ok small span-2">Esta cita queda vinculada al control <b>{fixed.reason}</b>.</div>;
  if (!list.length) return null;
  if (list.length === 1) return (
    <label className="check span-2 alert info small">
      <input type="checkbox" checked={value === list[0].id} onChange={(e) => onChange(e.target.checked ? list[0].id : null)} />
      Vincular al control pendiente «{list[0].reason}» ({monthLabel(list[0].dueDate)})
    </label>
  );
  return (
    <Field label="Control pendiente que cubre esta cita" span2 hint="El paciente tiene varios controles pendientes: elige cuál se agenda con esta cita.">
      <select className="input" value={value ?? ""} onChange={(e) => onChange(e.target.value || null)}>
        <option value="">Ninguno (no vincular)</option>
        {list.map((r) => <option key={r.id} value={r.id}>{r.reason} · {monthLabel(r.dueDate)}{r.status === "review" ? " · en revisión" : ""}</option>)}
      </select>
    </Field>
  );
}

// ---------------- Ficha del paciente ----------------
export function PatientRecallsCard({ patientId }: { patientId: string }) {
  const { can } = useAuth();
  const r = useApi<any[]>(`/api/patients/${patientId}/recalls`);
  const [adding, setAdding] = useState(false);
  const [attempt, setAttempt] = useState<any | null>(null);
  const write = can("agenda.write");
  return (
    <div className="card">
      <div className="card-head">
        <h2>Controles</h2>
        {write && <button className="btn btn-sm" style={TAP} onClick={() => setAdding(true)}><CalendarPlus size={15} />Programar control</button>}
      </div>
      {!r.data ? <Loading /> : r.data.length === 0 ? <Empty>Sin controles programados.</Empty> : (
        <div className="table-wrap"><table className="table"><tbody>
          {r.data.map((x) => (
            <tr key={x.id}>
              <td><b>{x.reason}</b><div className="muted small">{monthLabel(x.dueDate)} · {x.branchName}{x.attempts ? ` · ${x.attempts} intento(s)` : ""}</div>
                {x.status === "scheduled" && x.appointmentStartsAt && <div className="small">Cita: {fmtDateTime(x.appointmentStartsAt)}</div>}
                {x.status === "dismissed" && x.dismissReason && <div className="small muted">Motivo: {x.dismissReason}</div>}
              </td>
              <td className="num"><RecallStatusBadge status={x.status} /></td>
              <td className="num">{write && ["pending", "review"].includes(x.status) && <button className="btn btn-sm" style={TAP} onClick={() => setAttempt(x)} aria-label={`Registrar intento: ${x.reason}`}><PhoneCall size={14} /><span className="hide-mobile">Intento</span></button>}</td>
            </tr>
          ))}
        </tbody></table></div>
      )}
      {adding && <NewRecallDialog patientId={patientId} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); r.reload(); }} />}
      {attempt && <AttemptDialog recall={attempt} onClose={() => setAttempt(null)} onSaved={() => { setAttempt(null); r.reload(); }} />}
    </div>
  );
}
