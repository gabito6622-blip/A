// Configuración → Medicamentos: catálogo de la clínica para recetar (clinic.manage).
import { useState } from "react";
import { Pencil, Plus, RotateCcw } from "lucide-react";
import { api } from "../lib/api";
import { useApi } from "../lib/hooks";
import { Dialog, Empty, Field, Loading, useToast } from "./ui";
import "./documents.css";

const norm = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();

export function MedicationsTab() {
  const toast = useToast();
  const list = useApi<any[]>("/api/medications?all=1");
  const [edit, setEdit] = useState<any | null>(null);
  const [filter, setFilter] = useState("");
  const rows = (list.data ?? []).filter((m) => !filter || norm(`${m.genericName} ${m.presentation} ${m.allergyTags.join(" ")}`).includes(norm(filter)));
  const seed = async () => {
    try { const r = await api.post("/api/medications/seed"); toast(r.added ? `Se agregaron ${r.added} medicamentos del catálogo inicial` : "El catálogo inicial ya está completo"); list.reload(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="stack">
      <div className="alert info small">Las posologías del catálogo inicial son referenciales para adultos: cada profesional las revisa y ajusta al recetar. Los «grupos de alergia» sirven para avisar, por ejemplo, que la amoxicilina pertenece al grupo de la penicilina. Un medicamento inactivo no se ofrece al recetar, pero las recetas emitidas conservan su copia.</div>
      <div className="row-between">
        <Field label="Buscar"><input className="input" style={{ maxWidth: 320 }} placeholder="Nombre, presentación o grupo" value={filter} onChange={(e) => setFilter(e.target.value)} /></Field>
        <div className="row">
          <button className="btn doc-btn" onClick={seed}><RotateCcw size={15} />Cargar catálogo inicial</button>
          <button className="btn btn-primary doc-btn" onClick={() => setEdit({})}><Plus size={16} />Nuevo medicamento</button>
        </div>
      </div>
      <div className="card">
        {!list.data ? <Loading /> : rows.length === 0 ? <Empty>Sin medicamentos.</Empty> : (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Medicamento</th><th className="hide-mobile">Posología por defecto</th><th className="hide-mobile">Grupos de alergia</th><th className="hide-mobile">Estado</th><th /></tr></thead>
            <tbody>{rows.map((m) => (
              <tr key={m.id}>
                <td><b>{m.genericName}</b><div className="muted small">{m.presentation}</div>{!m.active && <span className="badge">Inactivo</span>}</td>
                <td className="hide-mobile small">{[m.defaultDose, m.defaultFrequency, m.defaultDuration].filter(Boolean).join(" · ") || "—"}</td>
                <td className="hide-mobile small">{m.allergyTags.join(", ") || "—"}</td>
                <td className="hide-mobile">{m.active ? <span className="badge ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
                <td className="num"><button className="btn doc-btn" onClick={() => setEdit(m)} aria-label={`Editar ${m.genericName} ${m.presentation}`}><Pencil size={14} />Editar</button></td>
              </tr>))}
            </tbody></table></div>
        )}
      </div>
      {edit && <MedicationDialog med={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
    </div>
  );
}

function MedicationDialog({ med, onClose, onSaved }: { med: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = !med.id;
  const [f, setF] = useState({
    genericName: med.genericName ?? "", presentation: med.presentation ?? "", defaultDose: med.defaultDose ?? "", defaultFrequency: med.defaultFrequency ?? "",
    defaultDuration: med.defaultDuration ?? "", defaultInstructions: med.defaultInstructions ?? "", allergyTags: (med.allergyTags ?? []).join(", "), active: med.active ?? true,
  });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const e: Record<string, string> = {};
    if (f.genericName.trim().length < 2) e.genericName = "Escribe el nombre genérico";
    if (f.presentation.trim().length < 2) e.presentation = "Indica la presentación (forma y concentración)";
    const tags = f.allergyTags.split(",").map((t: string) => t.trim()).filter(Boolean);
    if (tags.some((t: string) => t.length < 3)) e.allergyTags = "Cada grupo debe tener al menos 3 letras";
    setErrs(e);
    if (Object.keys(e).length) return;
    setBusy(true); setErr(null);
    const body = { ...f, genericName: f.genericName.trim(), presentation: f.presentation.trim(), allergyTags: tags,
      defaultDose: f.defaultDose || null, defaultFrequency: f.defaultFrequency || null, defaultDuration: f.defaultDuration || null, defaultInstructions: f.defaultInstructions || null };
    try {
      if (isNew) await api.post("/api/medications", body); else await api.put(`/api/medications/${med.id}`, body);
      toast(isNew ? "Medicamento agregado" : "Medicamento actualizado");
      onSaved();
    } catch (x: any) { setErr(x.message); } finally { setBusy(false); }
  };
  const fe = (k: string) => errs[k] && <span className="field-error span-2">{errs[k]}</span>;
  return (
    <Dialog title={isNew ? "Nuevo medicamento" : `Editar ${med.genericName}`} onClose={onClose}
      footer={<><button className="btn doc-btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary doc-btn" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Nombre genérico"><input className="input" value={f.genericName} aria-invalid={!!errs.genericName} onChange={(e) => setF({ ...f, genericName: e.target.value })} placeholder="Amoxicilina" /></Field>
          <Field label="Presentación"><input className="input" value={f.presentation} aria-invalid={!!errs.presentation} onChange={(e) => setF({ ...f, presentation: e.target.value })} placeholder="Cápsulas 500 mg" /></Field>
          {fe("genericName")}{fe("presentation")}
          <Field label="Dosis por defecto"><input className="input" value={f.defaultDose} onChange={(e) => setF({ ...f, defaultDose: e.target.value })} placeholder="1 cápsula" /></Field>
          <Field label="Frecuencia por defecto"><input className="input" value={f.defaultFrequency} onChange={(e) => setF({ ...f, defaultFrequency: e.target.value })} placeholder="Cada 8 horas" /></Field>
          <Field label="Duración por defecto"><input className="input" value={f.defaultDuration} onChange={(e) => setF({ ...f, defaultDuration: e.target.value })} placeholder="7 días" /></Field>
          <Field label="Grupos de alergia" hint="Separados por coma, sin tildes. Ej.: penicilina, betalactamico"><input className="input" value={f.allergyTags} aria-invalid={!!errs.allergyTags} onChange={(e) => setF({ ...f, allergyTags: e.target.value })} /></Field>
          {fe("allergyTags")}
          <Field label="Indicaciones por defecto" span2><input className="input" value={f.defaultInstructions} onChange={(e) => setF({ ...f, defaultInstructions: e.target.value })} placeholder="Vía oral, después de las comidas" /></Field>
          <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activo (se ofrece al recetar)</label>
        </div>
      </div>
    </Dialog>
  );
}
