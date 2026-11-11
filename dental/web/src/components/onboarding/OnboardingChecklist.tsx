// Primeros pasos en el Inicio (propietario y administración). Todo se calcula en el servidor desde
// los datos reales: aquí no hay casillas para marcar a mano.
import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, Check, ChevronDown, ChevronUp } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api } from "../../lib/api";
import { useToast } from "../ui";
import "./onboarding.css";

export interface ChecklistItem { id: string; title: string; description: string; done: boolean; optional: boolean; warning: string | null; detail: string[]; href: string; action: string }
export interface Checklist { items: ChecklistItem[]; requiredTotal: number; requiredDone: number; progressPct: number; complete: boolean; hidden: boolean }

export function OnboardingChecklist({ force = false, onChanged }: { force?: boolean; onChanged?: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const cl = useApi<Checklist>(can("clinic.manage") ? "/api/onboarding" : null);
  const [showDone, setShowDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const d = cl.data;
  if (!d || (d.hidden && !force)) return null;
  const setHidden = async (hidden: boolean) => {
    setBusy(true);
    try {
      await api.put("/api/onboarding/visibility", { hidden });
      toast(hidden ? "Listo: los primeros pasos ya no se muestran en el Inicio" : "Los primeros pasos vuelven a mostrarse en el Inicio");
      cl.reload(); onChanged?.();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const required = d.items.filter((i) => !i.optional);
  const optional = d.items.filter((i) => i.optional);
  const visibleReq = showDone || d.complete ? required : required.filter((i) => !i.done || i.warning);
  const doneHidden = d.complete ? 0 : required.filter((i) => i.done && !i.warning).length;
  return (
    <section className="card" aria-labelledby="ob-title">
      <div className="card-head" style={{ flexWrap: "wrap" }}>
        <div className="stack-sm" style={{ gap: 6, flex: 1, minWidth: 220 }}>
          <h2 id="ob-title" style={{ margin: 0 }}>Primeros pasos</h2>
          <div className="row" style={{ gap: 10, flexWrap: "nowrap" }}>
            <div className="ob-progress" style={{ flex: 1 }} role="progressbar" aria-label="Avance de los primeros pasos" aria-valuemin={0} aria-valuemax={100} aria-valuenow={d.progressPct}>
              <span style={{ width: `${d.progressPct}%` }} />
            </div>
            <b className="nowrap">{d.progressPct}%</b>
          </div>
          <span className="muted small">{d.requiredDone} de {d.requiredTotal} pasos listos. Se marcan solos cuando el dato existe en el sistema.</span>
        </div>
        {d.complete && !d.hidden && <button className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={() => setHidden(true)}>Ocultar del Inicio</button>}
        {d.hidden && <button className="btn" style={{ minHeight: 40 }} disabled={busy} onClick={() => setHidden(false)}>Mostrar en el Inicio</button>}
      </div>
      {d.complete && <div className="card-pad" style={{ paddingBottom: 0 }}><div className="alert ok">¡La clínica está lista para trabajar! Puedes ocultar esta lista; si algo vuelve a faltar, aparecerá de nuevo.</div></div>}
      <ul className="ob-list" aria-label="Pasos obligatorios">
        {visibleReq.map((i) => <Item key={i.id} i={i} />)}
      </ul>
      {doneHidden > 0 && (
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <button className="btn btn-ghost btn-sm" style={{ minHeight: 40 }} aria-expanded={showDone} onClick={() => setShowDone(!showDone)}>
            {showDone ? <ChevronUp size={15} /> : <ChevronDown size={15} />}{showDone ? "Ocultar los pasos listos" : `Ver los ${doneHidden} pasos listos`}
          </button>
        </div>
      )}
      <div className="card-pad" style={{ borderTop: "1px solid var(--line)", paddingBottom: 4 }}><span className="label">Opcional</span></div>
      <ul className="ob-list" aria-label="Pasos opcionales">
        {optional.map((i) => <Item key={i.id} i={i} />)}
      </ul>
    </section>
  );
}

function Item({ i }: { i: ChecklistItem }) {
  return (
    <li className={`ob-item ${i.done ? "done" : ""}`} data-step={i.id}>
      <span className="ob-mark" aria-hidden="true">{i.done ? <Check size={16} /> : null}</span>
      <div className="ob-body">
        <h3>
          {i.title}
          <span className="sr-only">{i.done ? " (listo)" : " (pendiente)"}</span>
          {i.done ? <span className="badge ok">Listo</span> : <span className="badge">{i.optional ? "Opcional" : "Pendiente"}</span>}
        </h3>
        <p className="muted small">{i.description}</p>
        {i.detail.map((t, k) => <p key={k} className="small">{t}</p>)}
        {i.warning && <p className="small" style={{ color: "var(--warn)", fontWeight: 560 }}><AlertTriangle size={14} style={{ verticalAlign: "-2px" }} /> {i.warning}</p>}
      </div>
      <Link className={`btn ${i.done ? "" : "btn-primary"}`} to={i.href}>{i.done ? "Revisar" : i.action}</Link>
    </li>
  );
}
