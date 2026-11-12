// Configuración → Certificados (B-075): la clínica adapta el título y el texto de sus certificados y
// derivaciones. Cada cambio es una versión nueva; lo ya emitido conserva su texto congelado.
import { useState } from "react";
import { History, Pencil, RotateCcw } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useApi } from "../lib/hooks";
import { fmtDateTime } from "../lib/format";
import { Dialog, Empty, Field, Loading, useAsk, useToast } from "./ui";
import { fillTemplate } from "./ClinicalDocuments";
import "./documents.css";

const PLACEHOLDER_HELP: Record<string, string> = {
  paciente: "nombre del paciente", documento: "«con CI …» o «sin documento»", edad: "edad", clinica: "nombre de la clínica", sucursal: "sucursal",
  profesional: "quien emite", matricula: "su matrícula", fecha: "fecha de emisión", horario: "horario de la atención", restTo: "último día de reposo",
};

// B-113: datos FICTICIOS para la vista previa (nunca de un paciente real).
const SAMPLE_BASE: Record<string, string> = {
  paciente: "María Ejemplo Pérez", documento: "con CI 1234567 LP", edad: "34 años", clinica: "Clínica de ejemplo", sucursal: "Sucursal Centro",
  profesional: "Dra. Ejemplo", matricula: "MP-0000", fecha: "12/11/2026",
};
const SAMPLE_FIELDS: Record<string, string> = {
  attendedOn: "2026-11-10", timeFrom: "09:00", timeTo: "10:00", reason: "control y profilaxis", restDays: "2", restFrom: "2026-11-10",
  status: "se encuentra en", startedOn: "2026-03-01", treatment: "ortodoncia fija con controles mensuales",
  specialty: "Cirugía bucomaxilofacial", recipient: "Dr. Ejemplo", summary: "Pieza 38 incluida; radiografía panorámica adjunta.",
};

export function CertificateTemplatesTab() {
  const list = useApi<any[]>("/api/certificate-templates");
  const [edit, setEdit] = useState<any | null>(null);
  const [hist, setHist] = useState<any | null>(null);
  return (
    <div className="stack">
      <div className="alert info small">
        Adaptá el título y el texto de los certificados y derivaciones de la clínica. Cada cambio queda como una versión nueva con quién y cuándo:
        lo que ya se emitió no cambia. Los datos entre llaves, como {"{paciente}"}, se completan solos al emitir. Antes de usar un texto nuevo, conviene que lo revise quien asesora legalmente a la clínica.
      </div>
      <div className="card">
        {!list.data ? <Loading /> : list.data.length === 0 ? <Empty>Sin plantillas.</Empty> : (
          <div className="table-wrap"><table className="table cards-sm">
            <thead><tr><th>Plantilla</th><th>Texto</th><th>Versión</th><th /></tr></thead>
            <tbody>{list.data.map((t) => (
              <tr key={t.id}>
                <td data-label="Plantilla"><b>{t.title}</b>{t.title !== t.baseTitle && <div className="muted small">Base: {t.baseTitle}</div>}</td>
                <td data-label="Texto">{t.customized ? <span className="badge ok">Propio de la clínica</span> : <span className="badge">Texto base</span>}</td>
                <td data-label="Versión" className="small">{t.version ? `v${t.version} · ${fmtDateTime(t.updatedAt)}` : "—"}</td>
                <td className="num">
                  <div className="row" style={{ justifyContent: "flex-end" }}>
                    {t.version > 0 && <button className="btn doc-btn" onClick={() => setHist(t)} aria-label={`Historial de ${t.title}`}><History size={14} />Historial</button>}
                    <button className="btn doc-btn" onClick={() => setEdit(t)} aria-label={`Editar ${t.title}`}><Pencil size={14} />Editar</button>
                  </div>
                </td>
              </tr>))}
            </tbody></table></div>
        )}
      </div>
      {edit && <TemplateDialog tpl={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); list.reload(); }} />}
      {hist && <HistoryDialog tpl={hist} onClose={() => setHist(null)} />}
    </div>
  );
}

function TemplateDialog({ tpl, onClose, onSaved }: { tpl: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const ask = useAsk();
  const [title, setTitle] = useState<string>(tpl.title);
  const [body, setBody] = useState<string>(tpl.body);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const send = async (restoreDefault: boolean) => {
    setErr(null);
    if (restoreDefault && !(await ask({ title: "Volver al texto original", confirmLabel: "Volver al original", message: "Se guarda una versión nueva con el texto base del sistema. Lo emitido antes no cambia." }))) return;
    setBusy(true);
    try {
      const r = await api.post<{ version: number }>(`/api/certificate-templates/${tpl.id}/versions`, restoreDefault ? { restoreDefault: true, note: note.trim() || null } : { title: title.trim(), body, note: note.trim() || null });
      toast(`Guardada la versión ${r.version}`);
      onSaved();
    } catch (e) {
      const x = e as ApiError;
      setErr(x.details?.[0]?.message ? `${x.message}. ${x.details[0].message}` : x.message);
    } finally { setBusy(false); }
  };
  const fields: { key: string; label: string }[] = tpl.fields ?? [];
  return (
    <Dialog wide title={`Editar: ${tpl.baseTitle}`} onClose={onClose} footer={<>
      {tpl.customized && <button className="btn doc-btn" onClick={() => send(true)} disabled={busy}><RotateCcw size={15} />Volver al texto original</button>}
      <button className="btn doc-btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary doc-btn" onClick={() => send(false)} disabled={busy}>{busy ? "Guardando…" : "Guardar versión nueva"}</button>
    </>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <Field label="Título"><input className="input" value={title} maxLength={120} onChange={(e) => setTitle(e.target.value)} /></Field>
        <Field label="Texto" hint="Podés cambiar la redacción. Los datos obligatorios de la plantilla tienen que seguir apareciendo.">
          <textarea className="input cert-tpl-body" value={body} maxLength={5000} rows={10} onChange={(e) => setBody(e.target.value)} />
        </Field>
        <section className="cert-tpl-preview" aria-label="Vista previa con datos de ejemplo">
          <div className="muted small">Vista previa con un paciente de ejemplo (datos ficticios):</div>
          <b>{title || "—"}</b>
          <pre className="cert-tpl-pre">{fillTemplate(body, SAMPLE_FIELDS, SAMPLE_BASE)}</pre>
        </section>
        <div className="small">
          <b>Datos disponibles</b> (tocá uno para agregarlo al final):
          <div className="cert-tpl-chips">
            {(tpl.placeholders as string[]).map((p) => {
              const label = PLACEHOLDER_HELP[p] ?? fields.find((f) => f.key === p)?.label ?? p;
              return <button key={p} type="button" className="btn btn-sm doc-btn" onClick={() => setBody((b) => `${b}{${p}}`)} title={label}>{`{${p}}`}<span className="muted"> · {label}</span></button>;
            })}
          </div>
        </div>
        <Field label="Nota del cambio (opcional)"><input className="input" value={note} maxLength={300} onChange={(e) => setNote(e.target.value)} placeholder="Ej.: redacción revisada por la asesora legal" /></Field>
      </div>
    </Dialog>
  );
}

function HistoryDialog({ tpl, onClose }: { tpl: any; onClose: () => void }) {
  const v = useApi<any[]>(`/api/certificate-templates/${tpl.id}/versions`);
  return (
    <Dialog wide title={`Historial: ${tpl.baseTitle}`} onClose={onClose} footer={<button className="btn doc-btn" onClick={onClose}>Cerrar</button>}>
      {!v.data ? <Loading /> : v.data.length === 0 ? <Empty>Sin cambios: se usa el texto base.</Empty> : (
        <div className="stack">
          {v.data.map((x) => (
            <section key={x.version} className="card cert-tpl-version">
              <div className="row-between"><b>v{x.version} · {x.title}</b><span className="muted small">{fmtDateTime(x.createdAt)} · {x.byName}</span></div>
              {x.isDefault && <span className="badge">Texto base</span>}
              {x.note && <div className="small">Nota: {x.note}</div>}
              <pre className="cert-tpl-pre">{x.body}</pre>
            </section>
          ))}
        </div>
      )}
    </Dialog>
  );
}
