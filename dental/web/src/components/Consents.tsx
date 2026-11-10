import { useMemo, useState } from "react";
import { FilePenLine, Printer, ShieldAlert, ShieldCheck } from "lucide-react";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { useAuth } from "../lib/auth";
import { fmtDateTime } from "../lib/format";
import { Dialog, Empty, Field, Loading, useToast } from "./ui";
import { SignaturePad } from "./SignaturePad";
import { PdfButton } from "./ClinicalDocuments";

const DECISION: Record<string, { label: string; tone: string }> = {
  granted: { label: "Acepta", tone: "ok" }, refused: { label: "No acepta", tone: "danger" }, revoked: { label: "Revocado", tone: "warn" },
};
const METHOD: Record<string, string> = { signature_pad: "Firma en pantalla", paper_signed: "Firmado en papel", staff_registered: "Registrado por el personal", online_checkbox: "Casilla marcada por el paciente en la web" };
const REL: Record<string, string> = { self: "El paciente", guardian: "Madre, padre o tutor", legal_representative: "Representante legal" };

export function ConsentsPanel({ patient }: { patient: { id: string; firstName: string; lastName: string; documentNumber: string | null; birthDate: string | null; guardianName: string | null } }) {
  const { can } = useAuth();
  const docs = useApi<any>(`/api/patients/${patient.id}/documents`);
  const [signing, setSigning] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  const kinds: [string, string][] = [["data_processing", "Tratamiento de datos"], ["reminders", "Recordatorios"], ["marketing", "Promociones"]];
  if (!docs.data) return <Loading />;
  return (
    <div className="stack">
      <div className="card card-pad stack">
        <div className="row-between">
          <h2>Consentimientos vigentes</h2>
          {(can("patients.write") || can("clinical.write") || can("budgets.write")) && <button className="btn btn-primary btn-sm" onClick={() => setSigning(true)}><FilePenLine size={15} />Registrar consentimiento</button>}
        </div>
        <div className="row">
          {kinds.map(([k, l]) => {
            const d = docs.data.current[k];
            return <span key={k} className={`badge ${d ? DECISION[d]!.tone : ""}`}>{l}: {d ? DECISION[d]!.label : "sin registro"}</span>;
          })}
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Historial de documentos</h2></div>
        {docs.data.documents.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Documento</th><th>Decisión</th><th className="hide-mobile">Forma</th><th className="hide-mobile">Firmante</th><th className="hide-mobile">Registró</th></tr></thead>
            <tbody>{docs.data.documents.map((d: any) => (
              <tr key={d.id} className="clickable" onClick={() => setOpen(d.id)}>
                <td className="nowrap">{fmtDateTime(d.signedAt)}</td>
                <td><b>{d.title}</b><div className="muted small">{d.kindLabel}{d.templateVersion ? ` · v${d.templateVersion}` : ""}</div></td>
                <td><span className={`badge ${DECISION[d.decision]!.tone}`}>{DECISION[d.decision]!.label}</span></td>
                <td className="hide-mobile">{METHOD[d.method]}</td>
                <td className="hide-mobile">{d.signerName}<div className="muted small">{REL[d.signerRelationship]}</div></td>
                <td className="hide-mobile">{d.recordedBy}</td>
              </tr>))}
            </tbody></table></div>
        ) : <Empty>Sin documentos registrados.</Empty>}
      </div>
      {signing && <SignDialog patient={patient} onClose={() => setSigning(false)} onSaved={(id) => { setSigning(false); docs.reload(); setOpen(id); }} />}
      {open && <DocumentDialog id={open} onClose={() => setOpen(null)} />}
    </div>
  );
}

function SignDialog({ patient, onClose, onSaved }: { patient: { id: string; firstName: string; lastName: string; documentNumber: string | null; birthDate: string | null; guardianName: string | null }; onClose: () => void; onSaved: (id: string) => void }) {
  const { can, me } = useAuth();
  const toast = useToast();
  const templates = useApi<any[]>("/api/consent-templates");
  const minor = !!patient.birthDate && new Date(patient.birthDate).getTime() > Date.now() - 18 * 365.25 * 86_400_000;
  const allowed = (templates.data ?? []).filter((t) => (t.kind === "informed_consent" ? can("clinical.write") || can("budgets.write") : can("patients.write")));
  const [f, setF] = useState({
    templateId: "", decision: "granted", method: "signature_pad",
    signerName: minor ? patient.guardianName ?? "" : `${patient.firstName} ${patient.lastName}`,
    signerDocument: minor ? "" : patient.documentNumber ?? "", signerRelationship: minor ? "guardian" : "self", procedure: "", notes: "",
  });
  const [png, setPng] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const t = allowed.find((x) => x.id === f.templateId);
  const preview = useMemo(() => t ? t.body
    .replaceAll("{paciente}", `${patient.firstName} ${patient.lastName}`)
    .replaceAll("{clinica}", me?.clinic?.name ?? "")
    .replaceAll("{procedimiento}", f.procedure || "según presupuesto")
    .replaceAll("{fecha}", new Date().toLocaleDateString("es-BO")) : "", [t, f.procedure, patient, me]);
  const save = async () => {
    setErr(null);
    if (!t) return setErr("Elige el documento");
    if (f.method === "signature_pad" && !png) return setErr("Falta la firma");
    setBusy(true);
    try {
      const r = await api.post(`/api/patients/${patient.id}/documents`, {
        templateId: t.id, decision: f.decision, method: f.method, signerName: f.signerName, signerDocument: f.signerDocument || null,
        signerRelationship: f.signerRelationship, signaturePng: f.method === "signature_pad" ? png : null, procedure: f.procedure || null, notes: f.notes || null,
      });
      toast("Documento registrado");
      onSaved(r.id);
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog wide title="Registrar consentimiento" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save} disabled={busy || !t}>Guardar documento</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        {minor && <div className="alert warn">Paciente menor de edad: firma su madre, padre, tutor o representante legal.</div>}
        <div className="form-grid">
          <Field label="Documento" span2>
            <select className="input" value={f.templateId} onChange={(e) => setF({ ...f, templateId: e.target.value })}>
              <option value="">Elegir…</option>
              {allowed.map((x) => <option key={x.id} value={x.id}>{x.kindLabel} — {x.title} (v{x.version})</option>)}
            </select>
          </Field>
          {t?.kind === "informed_consent" && <Field label="Procedimiento / piezas" span2><input className="input" value={f.procedure} onChange={(e) => setF({ ...f, procedure: e.target.value })} placeholder="Ej.: Extracción de la pieza 38" /></Field>}
          <Field label="Decisión" group>
            <div className="row">
              {(["granted", "refused", "revoked"] as const).map((d) => <label key={d} className="check"><input type="radio" name="decision" checked={f.decision === d} onChange={() => setF({ ...f, decision: d })} />{DECISION[d]!.label}</label>)}
            </div>
          </Field>
          <Field label="Forma" group>
            <div className="row">
              <label className="check"><input type="radio" name="method" checked={f.method === "signature_pad"} onChange={() => setF({ ...f, method: "signature_pad" })} />Firma en pantalla</label>
              <label className="check"><input type="radio" name="method" checked={f.method === "paper_signed"} onChange={() => setF({ ...f, method: "paper_signed" })} />Firmado en papel</label>
            </div>
          </Field>
          <Field label="Nombre de quien firma"><input className="input" value={f.signerName} onChange={(e) => setF({ ...f, signerName: e.target.value })} /></Field>
          <Field label="CI de quien firma"><input className="input" value={f.signerDocument} onChange={(e) => setF({ ...f, signerDocument: e.target.value })} /></Field>
          <Field label="Firma como">
            <select className="input" value={f.signerRelationship} onChange={(e) => setF({ ...f, signerRelationship: e.target.value })}>
              {Object.entries(REL).filter(([k]) => !(minor && k === "self")).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="Nota (opcional)"><input className="input" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={f.method === "paper_signed" ? "Ubicación del original en papel" : ""} /></Field>
        </div>
        {t && <div className="card card-pad" style={{ maxHeight: 220, overflowY: "auto", whiteSpace: "pre-wrap", background: "var(--surface-2)" }}>{preview}</div>}
        {t && f.method === "signature_pad" && <SignaturePad onChange={setPng} />}
      </div>
    </Dialog>
  );
}

export function DocumentDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const d = useApi<any>(`/api/documents/${id}`);
  const print = () => {
    const x = d.data;
    const w = window.open("", "_blank");
    if (!w || !x) return;
    const esc = (s: string) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
    w.document.write(`<!doctype html><html lang="es"><head><meta charset="utf-8"><title>${esc(x.title)}</title>
      <style>body{font-family:system-ui,sans-serif;max-width:720px;margin:32px auto;color:#0b2a3c;line-height:1.5}h1{font-size:20px}pre{white-space:pre-wrap;font-family:inherit}.meta{color:#556;font-size:13px}img{max-width:320px;border-bottom:1px solid #889}</style></head><body>
      <div class="meta">${esc(x.clinicName)} · ${esc(x.branchName)}${x.branchAddress ? " · " + esc(x.branchAddress) : ""}</div>
      <h1>${esc(x.title)}${x.templateVersion ? ` (v${x.templateVersion})` : ""}</h1>
      <div class="meta">Paciente: ${esc(x.patientName)} · Ficha ${esc(x.recordNumber)} · ${esc(new Date(x.signedAt).toLocaleString("es-BO"))}</div>
      <pre>${esc(x.body)}</pre>
      <p><b>Decisión:</b> ${esc(DECISION[x.decision]!.label)} · <b>Firma:</b> ${esc(x.signerName)} (${esc(REL[x.signerRelationship])})${x.signerDocument ? " · CI " + esc(x.signerDocument) : ""}</p>
      ${x.signaturePng ? `<img alt="Firma" src="${x.signaturePng}">` : `<p class="meta">${esc(METHOD[x.method])}</p>`}
      <p class="meta">Registrado por ${esc(x.recordedBy)} · Huella SHA-256: ${esc(x.contentHash)}</p></body></html>`);
    w.document.close();
    w.focus();
    w.print();
  };
  const x = d.data;
  return (
    <Dialog wide title={x ? x.title : "Documento"} onClose={onClose} footer={<>{x && <PdfButton url={`/api/consent-documents/${id}/pdf`} label="Descargar PDF" />}<button className="btn" onClick={print} disabled={!x}><Printer size={15} />Imprimir</button><button className="btn btn-primary" onClick={onClose}>Cerrar</button></>}>
      {!x ? <Loading /> : (
        <div className="stack">
          <div className="row">
            <span className={`badge ${DECISION[x.decision]!.tone}`}>{DECISION[x.decision]!.label}</span>
            <span className="badge">{METHOD[x.method]}</span>
            {x.integrityOk ? <span className="badge ok"><ShieldCheck size={13} />Integridad verificada</span> : <span className="badge danger"><ShieldAlert size={13} />No coincide la huella</span>}
          </div>
          <div className="muted small">{x.clinicName} · {x.branchName} · {fmtDateTime(x.signedAt)} · registrado por {x.recordedBy}</div>
          <div className="card card-pad" style={{ whiteSpace: "pre-wrap", background: "var(--surface-2)" }}>{x.body}</div>
          <div className="row-between" style={{ alignItems: "flex-end" }}>
            <div className="stack-sm"><b>{x.signerName}</b><span className="muted small">{REL[x.signerRelationship]}{x.signerDocument ? ` · CI ${x.signerDocument}` : ""}</span>{x.notes && <span className="small">{x.notes}</span>}</div>
            {x.signaturePng && <img src={x.signaturePng} alt="Firma" style={{ maxWidth: 280, borderBottom: "1px solid var(--line-2)" }} />}
          </div>
          <code className="small muted" style={{ wordBreak: "break-all" }}>SHA-256: {x.contentHash}</code>
        </div>
      )}
    </Dialog>
  );
}
