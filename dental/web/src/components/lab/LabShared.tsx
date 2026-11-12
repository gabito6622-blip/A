// Laboratorio protésico: constantes, selector de piezas FDI, diálogos de orden, tarjeta de la ficha
// del paciente y pista para la agenda. La página principal está en pages/Lab.tsx.
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { FlaskConical, PackageCheck, Pencil, Plus, Printer } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api, qs } from "../../lib/api";
import { bs, fmtDate, fmtDateTime, localDate, parseBs, toBsInput } from "../../lib/format";
import { Dialog, Empty, Field, Loading, useToast } from "../ui";
import { PatientPicker } from "../../pages/Agenda";
import "./lab.css";

export const WORK_TYPES: { id: string; label: string; perUnit: boolean }[] = [
  { id: "crown", label: "Corona", perUnit: true }, { id: "bridge", label: "Puente", perUnit: true },
  { id: "removable", label: "Prótesis removible", perUnit: false }, { id: "splint", label: "Placa", perUnit: false },
  { id: "veneer", label: "Carilla", perUnit: true }, { id: "inlay", label: "Incrustación", perUnit: true },
  { id: "model", label: "Modelo", perUnit: false }, { id: "other", label: "Otro", perUnit: false },
];
export const workLabel = (id: string) => WORK_TYPES.find((w) => w.id === id)?.label ?? id;
export const VITA = ["A1", "A2", "A3", "A3.5", "A4", "B1", "B2", "B3", "B4", "C1", "C2", "C3", "C4", "D2", "D3", "D4"];
export const LAB_STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Borrador", tone: "" },
  sent: { label: "Enviado", tone: "info" },
  in_process: { label: "En proceso", tone: "info" },
  received: { label: "Recibido", tone: "ok" },
  adjustment: { label: "En ajuste", tone: "warn" },
  delivered: { label: "Entregado", tone: "brand" },
  cancelled: { label: "Cancelado", tone: "danger" },
};
export const ACTION_LABELS: Record<string, string> = {
  sent: "Marcar enviado", in_process: "En proceso", received: "Registrar llegada", adjustment: "Devolver para ajuste",
  delivered: "Entregado al paciente", cancelled: "Cancelar orden", extra: "Costo adicional del laboratorio",
};
export const fmtDay = (d: string | null | undefined) => (d ? fmtDate(`${d}T12:00:00`) : "—");
export const TAP = { minHeight: 40 } as const;

export function LabStatusBadge({ status, overdue }: { status: string; overdue?: boolean }) {
  const s = LAB_STATUS[status] ?? { label: status, tone: "" };
  return <span className="row" style={{ gap: 4, display: "inline-flex" }}><span className={`badge ${s.tone}`}>{s.label}</span>{overdue && <span className="badge danger">Atrasada</span>}</span>;
}

// ---------------- Selector de piezas (FDI) ----------------
const PERM = [[18, 17, 16, 15, 14, 13, 12, 11], [21, 22, 23, 24, 25, 26, 27, 28], [48, 47, 46, 45, 44, 43, 42, 41], [31, 32, 33, 34, 35, 36, 37, 38]];
const TEMP = [[55, 54, 53, 52, 51], [61, 62, 63, 64, 65], [85, 84, 83, 82, 81], [71, 72, 73, 74, 75]];
export function ToothPicker({ value, onChange }: { value: number[]; onChange: (v: number[]) => void }) {
  const [temp, setTemp] = useState(value.some((t) => t >= 51));
  const quads = temp ? TEMP : PERM;
  const toggle = (t: number) => onChange(value.includes(t) ? value.filter((x) => x !== t) : [...value, t].sort((a, b) => a - b));
  return (
    <div className="lab-teeth">
      <div className="row-between">
        <span className="muted small">{value.length ? `Seleccionadas: ${value.join(", ")}` : "Toca las piezas del trabajo (opcional para placas y modelos)"}</span>
        <label className="check small"><input type="checkbox" checked={temp} onChange={(e) => setTemp(e.target.checked)} />Dentición temporal</label>
      </div>
      <div className="lab-teeth-grid">
        {quads.map((q, i) => (
          <div key={i} className={`lab-quad ${temp ? "temp" : ""}`} role="group" aria-label={`Cuadrante ${Math.floor(q[0]! / 10)}`}>
            {q.map((t) => (
              <button key={t} type="button" className="lab-tooth" aria-pressed={value.includes(t)} aria-label={`Pieza ${t}`} onClick={() => toggle(t)}>{t}</button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------------- Crear / editar orden ----------------
interface OrderForm {
  labId: string; dentistId: string; branchId: string; budgetItemId: string; workType: string; workDetail: string; teeth: number[]; material: string;
  shade: string; shadeNote: string; impression: string; instructions: string; promisedOn: string; cost: string; attachmentUrl: string;
}

export function OrderDialog({ patient: fixedPatient, order, onClose, onSaved }: {
  patient?: { id: string; name: string } | null; order?: any; onClose: () => void; onSaved: (id: string) => void;
}) {
  const toast = useToast();
  const { me, branchId: currentBranch } = useAuth();
  const labs = useApi<any[]>("/api/lab/labs");
  const staff = useApi<any[]>("/api/staff?professionals=1");
  const [patient, setPatient] = useState<{ id: string; name: string } | null>(order ? { id: order.patientId, name: order.patientName } : fixedPatient ?? null);
  const items = useApi<any[]>(patient ? `/api/lab/patients/${patient.id}/budget-items` : null);
  const costLocked = !!order && ["received", "adjustment"].includes(order.status);
  const [f, setF] = useState<OrderForm>(() => order ? {
    labId: order.labId, dentistId: order.dentistId, branchId: order.branchId, budgetItemId: order.budgetItemId ?? "", workType: order.workType, workDetail: order.workDetail ?? "",
    teeth: order.teeth, material: order.material ?? "", shade: order.shade ?? "", shadeNote: order.shadeNote ?? "", impression: order.impression ?? "",
    instructions: order.instructions ?? "", promisedOn: order.promisedOn ?? "", cost: order.costCents != null ? toBsInput(order.costCents) : "", attachmentUrl: order.attachmentUrl ?? "",
  } : {
    labId: "", dentistId: me?.membership?.isProfessional ? me.user.id : "", branchId: currentBranch ?? (me?.branches.length === 1 ? me.branches[0]!.id : ""), budgetItemId: "", workType: "crown",
    workDetail: "", teeth: [], material: "", shade: "", shadeNote: "", impression: "", instructions: "", promisedOn: "", cost: "", attachmentUrl: "",
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [costTouched, setCostTouched] = useState(!!order);
  const set = (p: Partial<OrderForm>) => setF((x) => ({ ...x, ...p }));
  const activeLabs = (labs.data ?? []).filter((l) => l.active || l.id === f.labId);
  const dentists = (staff.data ?? []).filter((s) => s.allBranches || s.role === "owner" || s.branchIds.includes(f.branchId) || s.userId === f.dentistId);
  // Sugerencia de costo según la lista de precios del laboratorio (por pieza en coronas, puentes, carillas e incrustaciones).
  const suggested = useMemo(() => {
    const price = activeLabs.find((l) => l.id === f.labId)?.priceList?.[f.workType];
    if (price == null) return null;
    const perUnit = WORK_TYPES.find((w) => w.id === f.workType)?.perUnit;
    return price * (perUnit ? Math.max(1, f.teeth.length) : 1);
  }, [activeLabs, f.labId, f.workType, f.teeth.length]);
  useEffect(() => { if (!costTouched && !costLocked && suggested != null) set({ cost: toBsInput(suggested) }); }, [suggested, costTouched, costLocked]);
  const pickItem = (id: string) => {
    const it = items.data?.find((x) => x.id === id);
    set({ budgetItemId: id, ...(it?.tooth && !f.teeth.length ? { teeth: [Number(it.tooth)] } : {}), ...(it?.dentistId && !f.dentistId ? { dentistId: it.dentistId } : {}) });
  };

  const save = async (send: boolean) => {
    const e: Record<string, string> = {};
    if (!patient) e.patient = "Elige el paciente";
    if (!f.labId) e.labId = "Elige el laboratorio";
    if (!f.dentistId) e.dentistId = "Elige el profesional";
    if (!f.branchId) e.branchId = "Elige la sucursal";
    if (f.workType === "other" && f.workDetail.trim().length < 3) e.workDetail = "Describe el trabajo";
    if (f.cost && !/^\d{1,7}([.,]\d{1,2})?$/.test(f.cost.trim())) e.cost = "Monto en Bs, por ejemplo 450 o 450,50";
    if (f.attachmentUrl && !/^https?:\/\/\S+$/i.test(f.attachmentUrl.trim())) e.attachmentUrl = "Pega un enlace que empiece con http:// o https://";
    if (send && f.promisedOn && f.promisedOn < localDate()) e.promisedOn = "La fecha prometida no puede ser anterior a hoy";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    const body: Record<string, unknown> = {
      labId: f.labId, dentistId: f.dentistId, branchId: f.branchId, budgetItemId: f.budgetItemId || null, workType: f.workType, workDetail: f.workDetail || null,
      teeth: f.teeth, material: f.material || null, shade: f.shade || null, shadeNote: f.shadeNote || null, impression: f.impression || null,
      instructions: f.instructions || null, promisedOn: f.promisedOn || null, attachmentUrl: f.attachmentUrl.trim() || null,
    };
    if (!costLocked) body.costCents = f.cost ? parseBs(f.cost) : null;
    if (order?.receivedOn) delete body.labId;
    try {
      if (order) {
        await api.patch(`/api/lab/orders/${order.id}`, body);
        toast("Orden actualizada");
        onSaved(order.id);
      } else {
        const r = await api.post("/api/lab/orders", { ...body, patientId: patient!.id, send });
        toast(send ? `Orden N° ${r.number} enviada al laboratorio` : `Orden N° ${r.number} guardada como borrador`);
        onSaved(r.id);
      }
    } catch (x: any) {
      if (x.details?.field) setErrs({ [x.details.field]: x.message }); else setErr(x.message);
    } finally { setBusy(false); }
  };
  const E = ({ k }: { k: string }) => (errs[k] ? <span className="hint lab-err" role="alert">{errs[k]}</span> : null);
  return (
    <Dialog wide title={order ? `Editar orden N° ${order.number}` : "Nueva orden de laboratorio"} onClose={onClose} footer={<div className="row lab-foot">
      <button className="btn" style={TAP} onClick={onClose}>Cancelar</button>
      {order ? <button className="btn btn-primary" style={TAP} disabled={busy} onClick={() => save(false)}>Guardar cambios</button> : <>
        <button className="btn" style={TAP} disabled={busy} onClick={() => save(false)}>Guardar borrador</button>
        <button className="btn btn-primary" style={TAP} disabled={busy} onClick={() => save(true)}>Guardar y enviar</button>
      </>}
    </div>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        {!order && !fixedPatient && <Field label="Paciente" group><PatientPicker value={patient} onChange={setPatient} /><E k="patient" /></Field>}
        {(order || fixedPatient) && <div className="muted">Paciente: <b style={{ color: "var(--ink)" }}>{patient?.name}</b></div>}
        <div className="form-grid">
          <Field label="Laboratorio">
            <select className="input" value={f.labId} aria-invalid={!!errs.labId} disabled={!!order?.receivedOn} onChange={(e) => set({ labId: e.target.value })}>
              <option value="">Elegir…</option>{activeLabs.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
          <Field label="Sucursal">
            <select className="input" value={f.branchId} aria-invalid={!!errs.branchId} onChange={(e) => set({ branchId: e.target.value })}>
              <option value="">Elegir…</option>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </Field>
          <Field label="Profesional">
            <select className="input" value={f.dentistId} aria-invalid={!!errs.dentistId} onChange={(e) => set({ dentistId: e.target.value })}>
              <option value="">Elegir…</option>{dentists.map((d) => <option key={d.userId} value={d.userId}>{d.fullName}</option>)}
            </select>
          </Field>
          <Field label="Tratamiento del presupuesto (opcional)" hint="Vincularlo permite descontar el costo real en los honorarios.">
            <select className="input" value={f.budgetItemId} aria-invalid={!!errs.budgetItemId} onChange={(e) => pickItem(e.target.value)} disabled={!patient}>
              <option value="">Sin vincular</option>
              {items.data?.map((it) => <option key={it.id} value={it.id}>Pres. N° {it.budgetNumber} · {it.description}{it.tooth ? ` · pieza ${it.tooth}` : ""}</option>)}
            </select>
          </Field>
        </div>
        <E k="labId" /><E k="dentistId" /><E k="budgetItemId" />
        <div className="form-grid">
          <Field label="Tipo de trabajo">
            <select className="input" value={f.workType} onChange={(e) => set({ workType: e.target.value })}>
              {WORK_TYPES.map((w) => <option key={w.id} value={w.id}>{w.label}</option>)}
            </select>
          </Field>
          <Field label={f.workType === "other" ? "Descripción del trabajo" : "Detalle (opcional)"}>
            <input className="input" value={f.workDetail} aria-invalid={!!errs.workDetail} maxLength={200} placeholder={f.workType === "other" ? "Ej.: guarda oclusal, provisorio" : "Ej.: sobre implante"} onChange={(e) => set({ workDetail: e.target.value })} />
          </Field>
        </div>
        <E k="workDetail" />
        <Field label="Piezas (FDI)" group><ToothPicker value={f.teeth} onChange={(teeth) => set({ teeth })} /><E k="teeth" /></Field>
        <div className="form-grid">
          <Field label="Material"><input className="input" value={f.material} maxLength={120} placeholder="Ej.: zirconio, disilicato de litio, metal-porcelana" onChange={(e) => set({ material: e.target.value })} /></Field>
          <Field label="Impresión" group>
            <div className="lab-seg">
              <button type="button" aria-pressed={f.impression === "physical"} onClick={() => set({ impression: f.impression === "physical" ? "" : "physical" })}>Física</button>
              <button type="button" aria-pressed={f.impression === "digital"} onClick={() => set({ impression: f.impression === "digital" ? "" : "digital" })}>Digital</button>
            </div>
          </Field>
          <Field label="Color (guía Vita clásica)">
            <select className="input" value={f.shade} onChange={(e) => set({ shade: e.target.value })}>
              <option value="">Sin indicar</option>{VITA.map((v) => <option key={v} value={v}>{v}</option>)}
            </select>
          </Field>
          <Field label="Nota de color (opcional)"><input className="input" value={f.shadeNote} maxLength={120} placeholder="Ej.: cervical A3, incisal A1, translúcido" onChange={(e) => set({ shadeNote: e.target.value })} /></Field>
          <Field label="Instrucciones para el laboratorio" span2><textarea className="input" value={f.instructions} maxLength={2000} onChange={(e) => set({ instructions: e.target.value })} placeholder="Tipo de margen, oclusión, antagonista, pónticos…" /></Field>
          <Field label="Fecha prometida de entrega">
            <input className="input" type="date" value={f.promisedOn} aria-invalid={!!errs.promisedOn} onChange={(e) => set({ promisedOn: e.target.value })} /><E k="promisedOn" />
          </Field>
          <Field label="Costo del laboratorio (Bs)" hint={costLocked ? "Quedó fijo al recibir el trabajo." : suggested != null ? `Según la lista de precios: ${bs(suggested)}` : "Se puede completar al recibir el trabajo."}>
            <input className="input" inputMode="decimal" value={f.cost} disabled={costLocked} aria-invalid={!!errs.cost} placeholder="0,00" onChange={(e) => { setCostTouched(true); set({ cost: e.target.value }); }} /><E k="cost" /><E k="costCents" />
          </Field>
          <Field label="Enlace al archivo (escaneo, fotos)" span2 hint="Por ahora, un enlace a la carpeta compartida.">
            <input className="input" inputMode="url" value={f.attachmentUrl} aria-invalid={!!errs.attachmentUrl} placeholder="https://…" onChange={(e) => set({ attachmentUrl: e.target.value })} /><E k="attachmentUrl" />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}

// ---------------- Detalle y cambios de estado ----------------
export function OrderDetailDialog({ id, onClose, onChanged }: { id: string; onClose: () => void; onChanged: () => void }) {
  const toast = useToast();
  const d = useApi<any>(`/api/lab/orders/${id}`);
  const [action, setAction] = useState<string | null>(null);
  const [form, setForm] = useState({ date: localDate(), cost: "", reason: "", promisedOn: "", extra: "", extraReason: "" });
  const [err, setErr] = useState<string | null>(null);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const o = d.data;
  const start = (a: string) => {
    setAction(a); setErr(null); setFieldErr({});
    setForm({ date: localDate(), cost: o?.costCents != null ? toBsInput(o.costCents) : "", reason: "", promisedOn: a === "sent" ? o?.promisedOn ?? "" : "", extra: "", extraReason: "" });
  };
  const confirm = async () => {
    const e: Record<string, string> = {};
    if ((action === "adjustment" || action === "cancelled") && form.reason.trim().length < 3) e.reason = "Escribe el motivo (al menos 3 caracteres)";
    if (action === "received" && !o.receivedOn && !/^\d{1,7}([.,]\d{1,2})?$/.test(form.cost.trim())) e.cost = "Registra el costo en Bs (queda fijo desde ahora)";
    const reenvio = action === "received" && o.status === "adjustment";
    if (reenvio && form.extra.trim() && !/^\d{1,7}([.,]\d{1,2})?$/.test(form.extra.trim())) e.extra = "Monto en Bs, o déjalo vacío si no cobra";
    if (action === "extra") {
      if (!/^-?\d{1,7}([.,]\d{1,2})?$/.test(form.extra.trim()) || parseBs(form.extra.replace("-", "")) === 0) e.extra = "Monto en Bs (negativo para corregir uno anterior)";
      if (form.extraReason.trim().length < 3) e.extraReason = "Escribe el motivo (al menos 3 caracteres)";
    }
    setFieldErr(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    try {
      if (action === "extra") {
        const neg = form.extra.trim().startsWith("-");
        await api.post(`/api/lab/orders/${id}/extra-costs`, { amountCents: (neg ? -1 : 1) * parseBs(form.extra.replace("-", "")), date: form.date || null, reason: form.extraReason.trim() });
        toast(`Orden N° ${o.number}: costo adicional registrado`);
        setAction(null); d.reload(); onChanged();
        return;
      }
      const extraCents = action === "received" && o.status === "adjustment" && form.extra.trim() ? parseBs(form.extra) : 0;
      await api.post(`/api/lab/orders/${id}/transition`, {
        to: action, date: form.date || null, reason: form.reason.trim() || null,
        costCents: action === "received" && !o.receivedOn ? parseBs(form.cost) : null, promisedOn: form.promisedOn || null,
        extraCostCents: extraCents || null, extraCostReason: extraCents ? form.extraReason.trim() || null : null,
      });
      toast(`Orden N° ${o.number}: ${LAB_STATUS[action!]!.label.toLowerCase()}`);
      setAction(null); d.reload(); onChanged();
    } catch (x: any) {
      if (x.details?.field) setFieldErr({ [x.details.field === "costCents" ? "cost" : x.details.field === "extraCostCents" ? "extra" : x.details.field]: x.message }); else setErr(x.message);
    } finally { setBusy(false); }
  };
  const FE = ({ k }: { k: string }) => (fieldErr[k] ? <span className="hint lab-err" role="alert">{fieldErr[k]}</span> : null);
  return (
    <Dialog wide title={o ? `Orden de laboratorio N° ${o.number}` : "Orden de laboratorio"} onClose={onClose}>
      {!o ? (d.error ? <div className="alert danger">{d.error}</div> : <Loading />) : (
        <div className="stack">
          <div className="row-between" style={{ alignItems: "flex-start" }}>
            <div className="stack-sm">
              <b style={{ fontSize: 17 }}>{o.workLabel}{o.teeth.length ? ` · piezas ${o.teeth.join(", ")}` : ""}</b>
              <span className="muted"><Link to={`/pacientes/${o.patientId}`}>{o.patientName}</Link> · ficha {o.recordNumber} · {o.branchName}</span>
            </div>
            <LabStatusBadge status={o.status} overdue={o.overdue} />
          </div>
          {o.readyNoAppointment && <div className="alert warn">El trabajo llegó y el paciente aún no tiene cita de colocación.</div>}
          {err && <div className="alert danger" role="alert">{err}</div>}
          <div className="lab-kv">
            <Kv k="Laboratorio" v={<>{o.labName}{o.labPhone || o.labWhatsapp ? <div className="muted small">{[o.labContact, o.labPhone, o.labWhatsapp && `WhatsApp ${o.labWhatsapp}`].filter(Boolean).join(" · ")}</div> : null}</>} />
            <Kv k="Profesional" v={o.dentistName} />
            <Kv k="Material" v={o.material} />
            <Kv k="Color" v={[o.shade, o.shadeNote].filter(Boolean).join(" · ")} />
            <Kv k="Impresión" v={o.impression === "digital" ? "Digital" : o.impression === "physical" ? "Física" : null} />
            <Kv k="Presupuesto" v={o.budgetItemId ? `N° ${o.budgetNumber} · ${o.budgetItemDescription}` : "Sin vincular"} />
            <Kv k="Enviado" v={fmtDay(o.sentOn)} />
            <Kv k="Prometido" v={fmtDay(o.promisedOn)} />
            <Kv k="Recibido" v={fmtDay(o.receivedOn)} />
            <Kv k="Entregado" v={fmtDay(o.deliveredOn)} />
            <Kv k="Costo" v={o.costCents != null ? `${bs(o.costCents)}${o.receivedOn ? " (fijo)" : ""}${o.extraCostCents ? ` + ${bs(o.extraCostCents)} por reenvío = ${bs(o.totalCostCents)}` : ""}` : "Sin registrar"} />
            {o.outstandingCents != null && <Kv k="Pendiente de pago" v={bs(o.outstandingCents)} />}
          </div>
          {o.workDetail && o.workType !== "other" && <p className="small" style={{ margin: 0 }}>Detalle: {o.workDetail}</p>}
          {o.instructions && <div className="card card-pad small" style={{ whiteSpace: "pre-wrap" }}><b>Instrucciones:</b> {o.instructions}</div>}
          {o.attachmentUrl && <a href={o.attachmentUrl} target="_blank" rel="noopener noreferrer" className="small">Abrir archivo adjunto</a>}

          {action ? (
            <section className="card card-pad stack" aria-label={ACTION_LABELS[action]}>
              <h3 style={{ margin: 0 }}>{ACTION_LABELS[action]}</h3>
              {action === "received" && !o.receivedOn && <p className="muted small" style={{ margin: 0 }}>Al registrar la llegada, el costo queda fijo y pasa a «Por pagar al laboratorio».</p>}
              {action === "adjustment" && <p className="muted small" style={{ margin: 0 }}>El trabajo vuelve al laboratorio; queda el motivo en el historial.</p>}
              {action === "extra" && <p className="muted small" style={{ margin: 0 }}>Lo que el laboratorio cobra de más por un reenvío o repetición. Para corregir uno anterior, escribe el monto en negativo. Queda en el historial; no se borra.</p>}
              <div className="form-grid">
                {["sent", "received", "delivered"].includes(action) && (
                  <Field label={action === "sent" ? "Fecha de envío" : action === "received" ? "Fecha de llegada" : "Fecha de entrega al paciente"}>
                    <input className="input" type="date" value={form.date} max={localDate()} onChange={(e) => setForm({ ...form, date: e.target.value })} /><FE k="date" />
                  </Field>
                )}
                {action === "received" && !o.receivedOn && (
                  <Field label="Costo del laboratorio (Bs)">
                    <input className="input" inputMode="decimal" value={form.cost} aria-invalid={!!fieldErr.cost} onChange={(e) => setForm({ ...form, cost: e.target.value })} /><FE k="cost" />
                  </Field>
                )}
                {((action === "received" && o.status === "adjustment") || action === "extra") && (<>
                  <Field label={action === "extra" ? "Monto (Bs)" : "Costo adicional del reenvío (Bs, opcional)"} hint={action === "extra" ? undefined : "Déjalo vacío si el laboratorio no cobra el reenvío"}>
                    <input className="input" inputMode="decimal" value={form.extra} aria-invalid={!!fieldErr.extra} placeholder="0,00" onChange={(e) => setForm({ ...form, extra: e.target.value })} /><FE k="extra" />
                  </Field>
                  <Field label={action === "extra" ? "Motivo" : "Motivo del costo adicional (opcional)"}>
                    <input className="input" value={form.extraReason} aria-invalid={!!fieldErr.extraReason} maxLength={300} onChange={(e) => setForm({ ...form, extraReason: e.target.value })} placeholder="Ej.: repetición por cambio de color" /><FE k="extraReason" />
                  </Field>
                  {action === "extra" && (
                    <Field label="Fecha">
                      <input className="input" type="date" value={form.date} max={localDate()} onChange={(e) => setForm({ ...form, date: e.target.value })} /><FE k="date" />
                    </Field>
                  )}
                </>)}
                {(action === "sent" || action === "adjustment") && (
                  <Field label={action === "sent" ? "Fecha prometida" : "Nueva fecha prometida (opcional)"}>
                    <input className="input" type="date" value={form.promisedOn} min={localDate()} onChange={(e) => setForm({ ...form, promisedOn: e.target.value })} /><FE k="promisedOn" />
                  </Field>
                )}
                {(action === "adjustment" || action === "cancelled") && (
                  <Field label={action === "adjustment" ? "Motivo del ajuste o reenvío" : "Motivo de la cancelación"} span2>
                    <input className="input" value={form.reason} aria-invalid={!!fieldErr.reason} maxLength={500} onChange={(e) => setForm({ ...form, reason: e.target.value })} /><FE k="reason" />
                  </Field>
                )}
              </div>
              <div className="row">
                <button className={`btn ${action === "cancelled" ? "btn-danger" : "btn-primary"}`} style={TAP} disabled={busy} onClick={confirm}>Confirmar</button>
                <button className="btn" style={TAP} onClick={() => setAction(null)}>Volver</button>
              </div>
            </section>
          ) : (
            <div className="row no-print">
              {o.transitions.map((t: string) => (
                <button key={t} className={`btn ${t === "cancelled" ? "btn-ghost" : t === "received" || (t === "sent" && o.status === "draft") ? "btn-primary" : ""}`} style={TAP} onClick={() => start(t)}>
                  {t === "received" && <PackageCheck size={16} />}{ACTION_LABELS[t]}
                </button>
              ))}
              {o.canEdit && <button className="btn" style={TAP} onClick={() => setEditing(true)}><Pencil size={15} />Editar</button>}
              {o.canWrite && o.receivedOn && o.status !== "cancelled" && <button className="btn" style={TAP} onClick={() => start("extra")}>Costo adicional</button>}
              <Link className="btn" style={TAP} to={`/laboratorio/orden/${o.id}`}><Printer size={15} />Orden para el laboratorio</Link>
            </div>
          )}

          <section className="stack-sm">
            <h3 style={{ margin: 0 }}>Historial</h3>
            <ol className="lab-timeline">
              {o.events.map((e: any) => (
                <li key={e.id}><b>{e.toLabel}</b> · {fmtDateTime(e.createdAt)} · {e.byName}{e.reason && <div className="muted small">Motivo: {e.reason}</div>}</li>
              ))}
            </ol>
          </section>
          {o.extraCosts?.length > 0 && (
            <section className="stack-sm">
              <h3 style={{ margin: 0 }}>Costos adicionales</h3>
              <ul className="lab-timeline">
                {o.extraCosts.map((x: any) => <li key={x.id}><b>{bs(x.amountCents)}</b> · {fmtDay(x.chargedOn)} · {x.reason}<div className="muted small">{x.byName} · {fmtDateTime(x.createdAt)}</div></li>)}
              </ul>
            </section>
          )}
          {o.payments.length > 0 && (
            <section className="stack-sm">
              <h3 style={{ margin: 0 }}>Pagos al laboratorio</h3>
              {o.payments.map((p: any, i: number) => <span key={i} className="small">{p.voidReason ? <s>{fmtDay(p.paidOn)} · {bs(p.amountCents)}</s> : <>{fmtDay(p.paidOn)} · {bs(p.amountCents)}</>}{p.reference ? ` · ref. ${p.reference}` : ""}{p.voidReason ? ` · anulado: ${p.voidReason}` : ""}</span>)}
            </section>
          )}
        </div>
      )}
      {editing && o && <OrderDialog order={o} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); d.reload(); onChanged(); }} />}
    </Dialog>
  );
}

const Kv = ({ k, v }: { k: string; v: ReactNode }) => (
  <div className="lab-kv-row"><span className="muted">{k}</span><span>{v || "—"}</span></div>
);

// ---------------- Ficha del paciente ----------------
export function PatientLabCard({ patientId, patientName }: { patientId: string; patientName: string }) {
  const { can } = useAuth();
  const list = useApi<any[]>(`/api/lab/orders${qs({ patientId })}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const write = can("clinical.write") || can("budgets.write");
  return (
    <section className="card" aria-label="Trabajos de laboratorio">
      <div className="card-head">
        <h2 className="row" style={{ gap: 8 }}><FlaskConical size={18} />Trabajos de laboratorio</h2>
        {write && <button className="btn btn-sm" style={TAP} onClick={() => setCreating(true)}><Plus size={15} />Nueva orden</button>}
      </div>
      {!list.data ? <Loading rows={2} /> : list.data.length ? (
        <div className="table-wrap"><table className="table"><tbody>
          {list.data.map((o) => (
            <tr key={o.id} className="clickable" onClick={() => setOpen(o.id)}>
              <td><b>{o.label}</b><div className="muted small">N° {o.number} · {o.labName}</div></td>
              <td className="nowrap small">{o.receivedOn ? `Llegó ${fmtDay(o.receivedOn)}` : o.promisedOn ? `Prometido ${fmtDay(o.promisedOn)}` : ""}</td>
              <td><LabStatusBadge status={o.status} overdue={o.overdue} /></td>
            </tr>
          ))}
        </tbody></table></div>
      ) : <Empty>Sin trabajos de laboratorio.</Empty>}
      {creating && <OrderDialog patient={{ id: patientId, name: patientName }} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); list.reload(); setOpen(id); }} />}
      {open && <OrderDetailDialog id={open} onClose={() => setOpen(null)} onChanged={list.reload} />}
    </section>
  );
}

// ---------------- Pista en el diálogo de nueva cita ----------------
export function LabHint({ patientId, date }: { patientId: string; date: string }) {
  const { can } = useAuth();
  const allowed = can("clinical.read") || can("budgets.read");
  const h = useApi<any>(allowed ? `/api/lab/patients/${patientId}/hints${qs({ date })}` : null);
  if (!h.data) return null;
  const late = h.data.pending.filter((p: any) => p.beforePromised);
  if (!h.data.ready.length && !late.length) return null;
  return (
    <div className="span-2 stack-sm">
      {h.data.ready.map((r: any) => (
        <div key={r.id} className="alert ok small row" style={{ gap: 6 }}><PackageCheck size={16} />Trabajo de laboratorio listo: {r.label}</div>
      ))}
      {late.map((p: any) => (
        <div key={p.id} className="alert warn small">
          Trabajo de laboratorio aún no llega: {p.label} ({p.lab}{p.promisedOn ? `, prometido para el ${fmtDay(p.promisedOn)}` : ", sin fecha prometida"}). Verifica antes de agendar la colocación.
        </div>
      ))}
    </div>
  );
}
