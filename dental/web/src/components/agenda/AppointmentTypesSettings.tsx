// Configuración → Tipos de cita (R2-19): nombre, color, duración por defecto, prestación sugerida y activo.
import { useState } from "react";
import { Pencil, Plus } from "lucide-react";
import { api } from "../../lib/api";
import { useApi } from "../../lib/hooks";
import { Dialog, Empty, Field, Loading, useToast } from "../ui";

const SWATCHES = ["#2563eb", "#0e8a7e", "#dc2626", "#7c3aed", "#c2410c", "#0891b2", "#db2777", "#4d7c0f", "#b45309", "#475569"];

export function AppointmentTypesSettings() {
  const list = useApi<any[]>("/api/appointment-types?all=1");
  const [edit, setEdit] = useState<any | null>(null);
  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">El tipo define el color en la agenda (si eliges “Color por tipo”) y precarga la duración al agendar.</p>
        <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />Nuevo tipo</button>
      </div>
      <div className="card">
        {!list.data ? <Loading /> : !list.data.length ? <Empty>Sin tipos de cita.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Tipo</th><th className="num">Duración</th><th className="hide-mobile">Prestación sugerida</th><th>Estado</th><th /></tr></thead>
            <tbody>{list.data.map((t) => (
              <tr key={t.id}>
                <td><span className="row" style={{ gap: 8, flexWrap: "nowrap" }}><i className="dot" style={{ background: t.color, width: 12, height: 12 }} /><b>{t.name}</b></span></td>
                <td className="num">{t.defaultDurationMin} min</td>
                <td className="hide-mobile">{t.procedureName ?? "—"}</td>
                <td>{t.active ? <span className="badge ok">Activo</span> : <span className="badge">Desactivado</span>}</td>
                <td className="num"><button className="btn btn-sm" onClick={() => setEdit(t)} aria-label={`Editar ${t.name}`}><Pencil size={14} />Editar</button></td>
              </tr>
            ))}</tbody>
          </table></div>
        )}
      </div>
      {edit && <TypeDialog type={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

function TypeDialog({ type, onClose, onSaved }: { type: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const procs = useApi<any[]>("/api/procedures");
  const isNew = !type.id;
  const [f, setF] = useState({ name: type.name ?? "", color: type.color ?? SWATCHES[0]!, defaultDurationMin: type.defaultDurationMin ?? 30, procedureId: type.procedureId ?? "", active: type.active ?? true });
  const [touched, setTouched] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const nameErr = f.name.trim().length < 2 ? "Escribe un nombre de al menos 2 letras" : null;
  const durErr = !Number.isInteger(f.defaultDurationMin) || f.defaultDurationMin < 5 || f.defaultDurationMin > 480 ? "Entre 5 y 480 minutos" : null;
  const save = async () => {
    setTouched(true);
    if (nameErr || durErr) return;
    setBusy(true); setErr(null);
    const body = { ...f, name: f.name.trim(), procedureId: f.procedureId || null };
    try {
      if (isNew) await api.post("/api/appointment-types", body); else await api.put(`/api/appointment-types/${type.id}`, body);
      toast(isNew ? "Tipo de cita creado" : "Tipo de cita actualizado");
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title={isNew ? "Nuevo tipo de cita" : `Editar ${type.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Nombre" hint={touched && nameErr ? nameErr : undefined}>
            <input className="input" value={f.name} aria-invalid={touched && !!nameErr} onChange={(e) => setF({ ...f, name: e.target.value })} />
          </Field>
          <Field label="Duración por defecto (min)" hint={touched && durErr ? durErr : undefined}>
            <input className="input" type="number" min={5} max={480} step={5} value={f.defaultDurationMin} aria-invalid={touched && !!durErr} onChange={(e) => setF({ ...f, defaultDurationMin: Number(e.target.value) })} />
          </Field>
          <Field label="Color" group span2>
            <div className="row" style={{ gap: 6 }}>
              {SWATCHES.map((c) => (
                <button key={c} type="button" className="swatch" style={{ background: c }} aria-label={`Color ${c}`} aria-pressed={f.color === c} onClick={() => setF({ ...f, color: c })} />
              ))}
              <input type="color" className="swatch-input" aria-label="Otro color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} />
            </div>
          </Field>
          <Field label="Prestación sugerida" span2>
            <select className="input" value={f.procedureId} onChange={(e) => setF({ ...f, procedureId: e.target.value })}>
              <option value="">Ninguna</option>{procs.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </Field>
          <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activo (disponible al agendar). Desactivarlo no cambia las citas ya agendadas.</label>
        </div>
      </div>
    </Dialog>
  );
}
