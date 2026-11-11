// Catálogo de etiquetas de la clínica (nombre y color).
import { useState } from "react";
import { Plus } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { Dialog, Empty, Field, Loading, useToast } from "../ui";
import { TagChip, type PatientTagT } from "./PatientTags";

const PALETTE = ["#0f766e", "#2563eb", "#7c3aed", "#db2777", "#d97706", "#059669", "#dc2626", "#475569"];

export function TagsAdmin() {
  const { can } = useAuth();
  const tags = useApi<PatientTagT[]>("/api/patient-tags");
  const [edit, setEdit] = useState<PatientTagT | "new" | null>(null);
  return (
    <div className="card">
      <div className="card-head">
        <h2>Etiquetas</h2>
        {can("patients.write") && <button className="btn btn-primary btn-sm" onClick={() => setEdit("new")}><Plus size={15} />Nueva etiqueta</button>}
      </div>
      {!tags.data ? <Loading /> : tags.data.length ? (
        <div className="table-wrap"><table className="table xp-table">
          <thead><tr><th>Etiqueta</th><th className="num">Pacientes</th><th>Estado</th><th /></tr></thead>
          <tbody>{tags.data.map((t) => (
            <tr key={t.id}>
              <td className="xp-main"><TagChip tag={t} /></td>
              <td className="num" data-label="Pacientes">{t.patients}</td>
              <td data-label="Estado">{t.active ? <span className="badge ok">Activa</span> : <span className="badge">Desactivada</span>}</td>
              <td data-label="">{can("patients.write") && <button className="btn btn-ghost btn-sm" onClick={() => setEdit(t)}>Editar</button>}</td>
            </tr>
          ))}</tbody>
        </table></div>
      ) : <Empty>Crea etiquetas como «Ortodoncia activa», «Empresa X» o «VIP» para agrupar pacientes.</Empty>}
      {edit && <TagDialog tag={edit === "new" ? null : edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); tags.reload(); }} />}
    </div>
  );
}

function TagDialog({ tag, onClose, onSaved }: { tag: PatientTagT | null; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: tag?.name ?? "", color: tag?.color ?? PALETTE[0]!, active: tag?.active ?? true });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    if (f.name.trim().length < 2) { setErrs({ name: "Escribe un nombre (al menos 2 caracteres)" }); return; }
    setErrs({}); setErr(null);
    try {
      if (tag) await api.put(`/api/patient-tags/${tag.id}`, f); else await api.post("/api/patient-tags", { name: f.name, color: f.color });
      toast(tag ? "Etiqueta actualizada" : "Etiqueta creada"); onSaved();
    } catch (e: any) {
      const d: Record<string, string> = {};
      for (const x of e.details ?? []) if (x.path && !d[x.path]) d[x.path] = x.message;
      if (Object.keys(d).length) setErrs(d); else setErr(e.message);
    }
  };
  return (
    <Dialog title={tag ? "Editar etiqueta" : "Nueva etiqueta"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="stack xp">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <Field label="Nombre"><input className="input" value={f.name} maxLength={40} aria-invalid={!!errs.name} onChange={(e) => setF({ ...f, name: e.target.value })} placeholder="Ej.: Ortodoncia activa" /></Field>
        {errs.name && <span className="hint" style={{ color: "var(--danger)" }} role="alert">{errs.name}</span>}
        <Field label="Color" group>
          <div className="xp-chips">
            {PALETTE.map((c) => (
              <button key={c} type="button" className="xp-chip xp-chip-toggle" aria-pressed={f.color === c} aria-label={`Color ${c}`} onClick={() => setF({ ...f, color: c })}>
                <span className="dot" style={{ background: c, width: 18, height: 18 }} />
              </button>
            ))}
          </div>
        </Field>
        {tag && <label className="check"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activa (se puede asignar)</label>}
        <div className="row"><span className="muted small">Vista previa:</span><TagChip tag={{ name: f.name || "Etiqueta", color: f.color }} /></div>
      </div>
    </Dialog>
  );
}
