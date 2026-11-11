// Etiquetas del paciente (R2-38): se muestran en la cabecera de la ficha y se editan con un diálogo.
import { useState } from "react";
import { Link } from "react-router-dom";
import { Tag } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { Dialog, Empty, useToast } from "../ui";
import "./experience.css";

export interface PatientTagT { id: string; name: string; color: string; active?: boolean; patients?: number }

/** Fondo suave a partir del color de la etiqueta (texto en el mismo color, contraste legible). */
export function TagChip({ tag }: { tag: Pick<PatientTagT, "name" | "color"> }) {
  return (
    <span className="xp-chip" style={{ background: `${tag.color}1a`, color: shade(tag.color), borderColor: `${tag.color}55` }}>
      <span className="dot" style={{ background: tag.color }} aria-hidden="true" />{tag.name}
    </span>
  );
}

/** Oscurece el color para que el texto cumpla contraste sobre el fondo claro. */
function shade(hex: string) {
  const n = parseInt(hex.slice(1), 16);
  const f = 0.55;
  const r = Math.round(((n >> 16) & 255) * f), g = Math.round(((n >> 8) & 255) * f), b = Math.round((n & 255) * f);
  return `rgb(${r}, ${g}, ${b})`;
}

export function PatientTagsRow({ patientId }: { patientId: string }) {
  const { can } = useAuth();
  const tags = useApi<PatientTagT[]>(`/api/patients/${patientId}/tags`);
  const [editing, setEditing] = useState(false);
  if (!tags.data) return null;
  if (!tags.data.length && !can("patients.write")) return null;
  return (
    <div className="xp-chips xp" aria-label="Etiquetas del paciente">
      {tags.data.map((t) => <TagChip key={t.id} tag={t} />)}
      {can("patients.write") && (
        <button className="btn btn-ghost btn-sm" onClick={() => setEditing(true)}><Tag size={14} />{tags.data.length ? "Etiquetas" : "Agregar etiqueta"}</button>
      )}
      {editing && <TagsDialog patientId={patientId} current={tags.data.map((t) => t.id)} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); tags.reload(); }} />}
    </div>
  );
}

function TagsDialog({ patientId, current, onClose, onSaved }: { patientId: string; current: string[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const all = useApi<PatientTagT[]>("/api/patient-tags");
  const [sel, setSel] = useState<string[]>(current);
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    try { await api.put(`/api/patients/${patientId}/tags`, { tagIds: sel }); toast("Etiquetas guardadas"); onSaved(); } catch (e: any) { setErr(e.message); }
  };
  const active = (all.data ?? []).filter((t) => t.active || sel.includes(t.id));
  return (
    <Dialog title="Etiquetas del paciente" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar</button></>}>
      <div className="stack xp">
        {err && <div className="alert danger" role="alert">{err}</div>}
        {active.length ? (
          <div className="xp-chips" role="group" aria-label="Elegir etiquetas">
            {active.map((t) => (
              <button key={t.id} type="button" className="xp-chip xp-chip-toggle" aria-pressed={sel.includes(t.id)} onClick={() => setSel((s) => (s.includes(t.id) ? s.filter((x) => x !== t.id) : [...s, t.id]))}>
                <span className="dot" style={{ background: t.color }} aria-hidden="true" />{t.name}
              </button>
            ))}
          </div>
        ) : <Empty>Todavía no hay etiquetas.</Empty>}
        <p className="muted small" style={{ margin: 0 }}>Las etiquetas se crean en <Link to="/experiencia?tab=etiquetas">Experiencia → Etiquetas</Link>. Sirven para filtrar listas y preparar campañas.</p>
      </div>
    </Dialog>
  );
}
