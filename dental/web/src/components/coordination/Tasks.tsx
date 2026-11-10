// Tareas internas del equipo: tarjeta de tarea, alta/edición y detalle con comentarios.
// Quien no puede ver pacientes recibe del servidor "Paciente (sin acceso)" y sin detalle.
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, CheckCircle2, Clock, Hand, MessageSquare, Undo2, User } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi, useDebounced } from "../../lib/hooks";
import { api, qs } from "../../lib/api";
import { addDays, fmtDateTime, localDate } from "../../lib/format";
import { Dialog, Field, Loading, useAsk, useToast } from "../ui";
import "./coordination.css";

export interface Task {
  id: string; branchId: string; branchName: string; title: string; detail: string | null; detailHidden: boolean;
  assigneeLabel: string; assigneeUserId: string | null; assigneeRole: string | null; dueAt: string | null; dueLocal: string | null;
  priority: "normal" | "high"; priorityLabel: string; patientId: string | null; patientName: string | null; hasPatient: boolean;
  appointmentId: string | null; appointmentLocal: string | null; status: "open" | "taken" | "done" | "cancelled"; statusLabel: string;
  source: string; takenByName: string | null; doneByName: string | null; doneAt: string | null; cancelledByName: string | null; cancelReason: string | null;
  createdByName: string; createdAt: string; commentCount: number; overdue: boolean;
  canTake: boolean; canRelease: boolean; canDone: boolean; canCancel: boolean; canEdit: boolean; canComment: boolean;
}

const STATUS_TONE: Record<string, string> = { open: "info", taken: "warn", done: "ok", cancelled: "" };

/** Acciones rápidas de una tarea (con aviso y recarga). */
export function useTaskActions(onChanged: () => void) {
  const toast = useToast();
  const ask = useAsk();
  return async (t: Pick<Task, "id" | "title">, action: "take" | "release" | "done" | "cancel") => {
    try {
      if (action === "cancel") {
        const reason = await ask({ title: "Cancelar tarea", message: `«${t.title}» quedará cancelada (no se borra).`, inputLabel: "Motivo de la cancelación", confirmLabel: "Cancelar tarea", danger: true });
        if (!reason) return;
        await api.post(`/api/tasks/${t.id}/cancel`, { reason });
        toast("Tarea cancelada");
      } else {
        await api.post(`/api/tasks/${t.id}/${action}`, {});
        toast(action === "take" ? "Tomaste la tarea" : action === "release" ? "La tarea volvió a quedar abierta" : "Tarea marcada como hecha");
      }
      onChanged();
    } catch (e: any) { toast(e.message, true); }
  };
}

export function TaskItem({ t, onOpen, onChanged, showBranch }: { t: Task; onOpen: (id: string) => void; onChanged: () => void; showBranch?: boolean }) {
  const act = useTaskActions(onChanged);
  return (
    <article className={`co-task ${t.overdue ? "overdue" : ""} ${t.priority === "high" ? "high" : ""}`} aria-label={`Tarea: ${t.title}`}>
      <div className="row-between" style={{ alignItems: "flex-start", flexWrap: "nowrap", gap: 8 }}>
        <h3>{t.title}</h3>
        <span className={`badge ${STATUS_TONE[t.status]}`}>{t.statusLabel}</span>
      </div>
      <div className="co-meta">
        <span><User size={13} aria-hidden /> {t.assigneeLabel}</span>
        {t.dueLocal && <span className={t.overdue ? "co-err" : ""}><Clock size={13} aria-hidden /> {t.overdue ? "Venció" : "Vence"} {t.dueLocal}</span>}
        {t.patientName && (t.patientId ? <Link to={`/pacientes/${t.patientId}`}>{t.patientName}</Link> : <span>{t.patientName}</span>)}
        {showBranch && <span>{t.branchName}</span>}
        {t.takenByName && t.status === "taken" && <span>Tomada por {t.takenByName}</span>}
        {t.commentCount > 0 && <span><MessageSquare size={13} aria-hidden /> {t.commentCount}</span>}
      </div>
      <div className="row" style={{ gap: 6 }}>
        {t.overdue && <span className="badge danger"><AlertTriangle size={12} aria-hidden /> Vencida</span>}
        {t.priority === "high" && <span className="badge warn">Prioridad alta</span>}
        {t.source === "call" && <span className="badge">Por una llamada</span>}
      </div>
      <div className="co-actions">
        {t.canTake && <button className="btn" onClick={() => act(t, "take")}><Hand size={15} />Tomar</button>}
        {t.canDone && <button className="btn btn-primary" onClick={() => act(t, "done")}><CheckCircle2 size={15} />Marcar hecha</button>}
        <button className="btn btn-ghost" onClick={() => onOpen(t.id)}>Ver detalle</button>
      </div>
    </article>
  );
}

// ---------------- Alta y edición ----------------
export interface TaskPrefill { branchId?: string; patient?: { id: string; name: string } | null; appointmentId?: string | null; appointmentLabel?: string; title?: string }

function MiniPatientPicker({ value, onChange }: { value: { id: string; name: string } | null; onChange: (p: { id: string; name: string } | null) => void }) {
  const [q, setQ] = useState("");
  const dq = useDebounced(q);
  const res = useApi<any>(dq.trim().length >= 2 ? `/api/patients${qs({ q: dq, limit: 6 })}` : null);
  if (value) return (
    <div className="row-between input" style={{ alignItems: "center", flexWrap: "nowrap" }}>
      <b>{value.name}</b><button type="button" className="btn btn-ghost" onClick={() => onChange(null)}>Quitar</button>
    </div>
  );
  return (
    <div className="stack-sm">
      <input className="input" placeholder="Nombre, CI o N° de ficha" value={q} onChange={(e) => setQ(e.target.value)} />
      {dq.trim().length >= 2 && res.data && (
        <div className="card" style={{ maxHeight: 200, overflowY: "auto" }}>
          {res.data.items.map((p: any) => (
            <button type="button" key={p.id} className="btn btn-ghost" style={{ width: "100%", justifyContent: "space-between" }} onClick={() => onChange({ id: p.id, name: `${p.firstName} ${p.lastName}` })}>
              <span>{p.firstName} {p.lastName}</span><span className="muted small">Ficha {p.recordNumber}</span>
            </button>
          ))}
          {!res.data.items.length && <p className="muted small" style={{ padding: 10, margin: 0 }}>Sin resultados.</p>}
        </div>
      )}
    </div>
  );
}

export function NewTaskDialog({ prefill = {}, task, onClose, onSaved }: { prefill?: TaskPrefill; task?: Task; onClose: () => void; onSaved: (id: string) => void }) {
  const { me, can, branchId: topBranch } = useAuth();
  const toast = useToast();
  const editing = !!task;
  const [f, setF] = useState(() => ({
    branchId: task?.branchId ?? prefill.branchId ?? topBranch ?? me?.branches[0]?.id ?? "",
    title: task?.title ?? prefill.title ?? "",
    detail: task?.detail ?? "",
    mode: (task?.assigneeRole ? "role" : "person") as "person" | "role",
    assigneeUserId: task?.assigneeUserId ?? "",
    assigneeRole: task?.assigneeRole ?? "",
    dueDate: task?.dueAt ? localDate(new Date(task.dueAt)) : prefill.title ? addDays(localDate(), 1) : "",
    dueTime: task?.dueLocal && !task.dueLocal.endsWith("23:59") ? task.dueLocal.slice(11) : "",
    priority: task?.priority ?? "normal",
  }));
  const [patient, setPatient] = useState(prefill.patient ?? null);
  const withPatient = editing ? task!.hasPatient : !!patient || !!prefill.appointmentId;
  const opts = useApi<any>(f.branchId ? `/api/tasks/assignees?branchId=${f.branchId}` : null);
  const [err, setErr] = useState<{ field?: string; msg: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (!editing) setF((x) => ({ ...x, assigneeUserId: "", assigneeRole: "" })); }, [f.branchId, editing]);
  const people = (opts.data?.people ?? []) as any[];
  const roles = (opts.data?.roles ?? []) as any[];
  const save = async () => {
    if (f.title.trim().length < 3) return setErr({ field: "title", msg: "Escribe un título de al menos 3 caracteres" });
    if (f.mode === "person" && !f.assigneeUserId) return setErr({ field: "assignee", msg: "Elige a quién se la asignas" });
    if (f.mode === "role" && !f.assigneeRole) return setErr({ field: "assignee", msg: "Elige el rol" });
    if (f.dueTime && !f.dueDate) return setErr({ field: "due", msg: "Indica la fecha si indicas una hora" });
    if (!editing && f.dueDate && f.dueDate < localDate()) return setErr({ field: "due", msg: "El vencimiento no puede ser anterior a hoy" });
    setBusy(true); setErr(null);
    const who = f.mode === "person" ? { assigneeUserId: f.assigneeUserId, assigneeRole: null } : { assigneeUserId: null, assigneeRole: f.assigneeRole };
    const body = { title: f.title.trim(), detail: f.detail.trim() || null, ...who, dueDate: f.dueDate || null, dueTime: f.dueTime || null, priority: f.priority };
    try {
      if (editing) {
        await api.patch(`/api/tasks/${task!.id}`, body);
        toast("Tarea actualizada"); onSaved(task!.id);
      } else {
        const r = await api.post<{ id: string }>("/api/tasks", { ...body, branchId: f.branchId, patientId: patient?.id ?? null, appointmentId: prefill.appointmentId ?? null });
        toast("Tarea creada"); onSaved(r.id);
      }
    } catch (e: any) {
      const m = String(e.message);
      setErr({ field: /^assignee/.test(m) ? "assignee" : /^due/.test(m) ? "due" : /^title/.test(m) ? "title" : undefined, msg: m.replace(/^[a-zA-Z.]+: /, "") });
    } finally { setBusy(false); }
  };
  const fieldErr = (k: string) => (err?.field === k ? <span className="co-err" role="alert">{err.msg}</span> : null);
  return (
    <Dialog title={editing ? "Editar tarea" : "Nueva tarea"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : editing ? "Guardar cambios" : "Crear tarea"}</button></>}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); save(); }}>
        {err && !err.field && <div className="alert danger" role="alert">{err.msg}</div>}
        {!editing && me && me.branches.length > 1 && (
          <Field label="Sucursal">
            <select className="input" value={f.branchId} onChange={(e) => setF({ ...f, branchId: e.target.value })}>{me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
        )}
        <Field label="¿Qué hay que hacer?">
          <input className="input" maxLength={140} value={f.title} aria-invalid={err?.field === "title"} autoFocus={!editing} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Ej.: Reponer guantes en el Consultorio 2" />
        </Field>
        {fieldErr("title")}
        <Field label="Detalle (opcional)" hint="Nota interna. No escribas diagnósticos ni datos clínicos.">
          <textarea className="input" rows={2} maxLength={2000} value={f.detail} onChange={(e) => setF({ ...f, detail: e.target.value })} />
        </Field>
        <Field label="Asignar a" group>
          <div className="co-seg">
            <button type="button" aria-pressed={f.mode === "person"} onClick={() => setF({ ...f, mode: "person" })}>Una persona</button>
            <button type="button" aria-pressed={f.mode === "role"} onClick={() => setF({ ...f, mode: "role" })}>Cualquiera de un rol</button>
          </div>
        </Field>
        {f.mode === "person" ? (
          <Field label="Persona" hint={withPatient ? "Solo aparecen quienes pueden ver pacientes." : undefined}>
            <select className="input" value={f.assigneeUserId} aria-invalid={err?.field === "assignee"} onChange={(e) => setF({ ...f, assigneeUserId: e.target.value })}>
              <option value="">Elige una persona…</option>
              {people.filter((p) => !withPatient || p.canSeePatients).map((p) => <option key={p.userId} value={p.userId}>{p.fullName} · {p.roleLabel}</option>)}
            </select>
          </Field>
        ) : (
          <Field label="Rol" hint="La ve todo el rol en la sucursal; la toma quien pueda.">
            <select className="input" value={f.assigneeRole} aria-invalid={err?.field === "assignee"} onChange={(e) => setF({ ...f, assigneeRole: e.target.value })}>
              <option value="">Elige un rol…</option>
              {roles.filter((r) => !withPatient || r.canSeePatients).map((r) => <option key={r.role} value={r.role}>{r.label}</option>)}
            </select>
          </Field>
        )}
        {fieldErr("assignee")}
        <div className="form-grid">
          <Field label="Vence (opcional)"><input className="input" type="date" min={editing ? undefined : localDate()} value={f.dueDate} aria-invalid={err?.field === "due"} onChange={(e) => setF({ ...f, dueDate: e.target.value })} /></Field>
          <Field label="Hora (opcional)" hint="Sin hora, vence al final del día."><input className="input" type="time" step={900} value={f.dueTime} onChange={(e) => setF({ ...f, dueTime: e.target.value })} /></Field>
        </div>
        {fieldErr("due")}
        <Field label="Prioridad" group>
          <div className="co-seg">
            <button type="button" aria-pressed={f.priority === "normal"} onClick={() => setF({ ...f, priority: "normal" })}>Normal</button>
            <button type="button" aria-pressed={f.priority === "high"} onClick={() => setF({ ...f, priority: "high" })}>Alta</button>
          </div>
        </Field>
        {!editing && can("patients.read") && (
          prefill.appointmentId ? (
            <p className="muted small" style={{ margin: 0 }}>Ligada a la cita {prefill.appointmentLabel ?? ""}{patient ? ` de ${patient.name}` : ""}.</p>
          ) : (
            <Field label="Paciente (opcional)" group><MiniPatientPicker value={patient} onChange={setPatient} /></Field>
          )
        )}
      </form>
    </Dialog>
  );
}

// ---------------- Detalle ----------------
export function TaskDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const t = useApi<Task & { comments: any[]; commentsHidden: boolean }>(`/api/tasks/${id}`);
  const toast = useToast();
  const [comment, setComment] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const changed = () => { t.reload(); onChanged(); };
  const act = useTaskActions(changed);
  const addComment = async () => {
    if (!comment.trim()) { setErr("Escribe el comentario"); return; }
    try { await api.post(`/api/tasks/${id}/comments`, { body: comment.trim() }); setComment(""); setErr(null); toast("Comentario agregado"); changed(); }
    catch (e: any) { setErr(e.message); }
  };
  const d = t.data;
  if (editing && d) return <NewTaskDialog task={d} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); changed(); }} />;
  return (
    <Dialog title="Tarea" onClose={onClose} footer={d && (
      <>
        {d.canCancel && <button className="btn btn-danger" onClick={() => act(d, "cancel")}>Cancelar tarea</button>}
        {d.canEdit && <button className="btn" onClick={() => setEditing(true)}>Editar</button>}
        {d.canRelease && <button className="btn" onClick={() => act(d, "release")}><Undo2 size={15} />Soltar</button>}
        {d.canTake && <button className="btn" onClick={() => act(d, "take")}><Hand size={15} />Tomar</button>}
        {d.canDone && <button className="btn btn-primary" onClick={() => act(d, "done")}><CheckCircle2 size={15} />Marcar hecha</button>}
      </>
    )}>
      {!d ? (t.error ? <div className="alert danger" role="alert">{t.error}</div> : <Loading />) : (
        <div className="stack">
          <div className="stack-sm">
            <h3 style={{ margin: 0, fontSize: 18, overflowWrap: "anywhere" }}>{d.title}</h3>
            <div className="row" style={{ gap: 6 }}>
              <span className={`badge ${STATUS_TONE[d.status]}`}>{d.statusLabel}</span>
              {d.overdue && <span className="badge danger">Vencida</span>}
              {d.priority === "high" && <span className="badge warn">Prioridad alta</span>}
            </div>
          </div>
          {d.detail && <p style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere" }}>{d.detail}</p>}
          {d.detailHidden && <div className="alert info small">El detalle está oculto porque la tarea está ligada a un paciente.</div>}
          <div className="card card-pad stack-sm">
            <Row k="Asignada a" v={d.assigneeLabel} />
            <Row k="Sucursal" v={d.branchName} />
            <Row k="Vence" v={d.dueLocal ?? "Sin fecha"} />
            {d.patientName && <Row k="Paciente" v={d.patientId ? <Link to={`/pacientes/${d.patientId}`}>{d.patientName}</Link> : d.patientName} />}
            {d.appointmentLocal && <Row k="Cita" v={d.appointmentLocal} />}
            <Row k="Creada por" v={`${d.createdByName} · ${fmtDateTime(d.createdAt)}`} />
            {d.takenByName && <Row k={d.status === "taken" ? "Tomada por" : "La tomó"} v={d.takenByName} />}
            {d.doneByName && <Row k="Hecha por" v={`${d.doneByName} · ${fmtDateTime(d.doneAt)}`} />}
            {d.cancelReason && <Row k="Cancelada" v={`${d.cancelledByName ?? ""}: ${d.cancelReason}`} />}
          </div>
          <section className="stack-sm" aria-labelledby={`cm-${id}`}>
            <h3 id={`cm-${id}`} style={{ margin: 0, fontSize: 15 }}>Comentarios</h3>
            {d.commentsHidden ? <p className="muted small" style={{ margin: 0 }}>No disponibles: la tarea está ligada a un paciente.</p> : (
              <>
                {d.comments.length ? (
                  <ul className="co-comments">
                    {d.comments.map((c) => <li key={c.id}><div className="muted small">{c.authorName} · {fmtDateTime(c.createdAt)}</div>{c.body}</li>)}
                  </ul>
                ) : <p className="muted small" style={{ margin: 0 }}>Sin comentarios todavía.</p>}
                {d.canComment && d.status !== "cancelled" && (
                  <div className="stack-sm">
                    <Field label="Agregar un comentario" hint="Los comentarios no se editan ni se borran.">
                      <textarea className="input" rows={2} maxLength={1000} value={comment} aria-invalid={!!err} onChange={(e) => setComment(e.target.value)} />
                    </Field>
                    {err && <span className="co-err" role="alert">{err}</span>}
                    <button className="btn" style={{ alignSelf: "flex-start" }} onClick={addComment}>Agregar comentario</button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </Dialog>
  );
}

const Row = ({ k, v }: { k: string; v: React.ReactNode }) => (
  <div className="row-between" style={{ borderBottom: "1px solid var(--line)", padding: "5px 0", gap: 10 }}><span className="muted">{k}</span><span style={{ textAlign: "right", overflowWrap: "anywhere" }}>{v}</span></div>
);
