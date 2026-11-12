// Recetas, certificados y derivaciones del paciente (R2-40) y botón de descarga de PDF (B-064).
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, FileDown, FilePlus2, Pill, Plus, RotateCcw, Trash2 } from "lucide-react";
import { api, ApiError } from "../lib/api";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { fmtDate, fmtDateTime, localDate } from "../lib/format";
import { Dialog, Empty, Field, Loading, useAsk, useToast } from "./ui";
import "./documents.css";

// ---------------- Descarga de PDF ----------------
/** Descarga un PDF de la API (con la sesión). Devuelve el mensaje de error, si lo hay. */
export async function downloadPdf(url: string, fallbackName = "documento.pdf"): Promise<string | null> {
  const res = await fetch(url, { credentials: "same-origin" });
  if (!res.ok) {
    const e = await res.json().catch(() => null);
    return e?.error?.message ?? "No se pudo descargar el PDF";
  }
  const blob = await res.blob();
  const name = /filename="([^"]+)"/.exec(res.headers.get("content-disposition") ?? "")?.[1] ?? fallbackName;
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href; a.download = name; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 10_000);
  return null;
}

export function PdfButton({ url, label = "PDF", className = "btn doc-btn", title }: { url: string; label?: string; className?: string; title?: string }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const go = async (e: React.MouseEvent) => {
    e.stopPropagation();
    setBusy(true);
    const err = await downloadPdf(url).catch(() => "No se pudo descargar el PDF");
    setBusy(false);
    if (err) toast(err, true);
  };
  return <button type="button" className={className} onClick={go} disabled={busy} title={title} aria-label={title ? `${label}: ${title}` : undefined}><FileDown size={15} />{busy ? "Preparando…" : label}</button>;
}

// ---------------- Panel del paciente ----------------
interface Patient { id: string; firstName: string; lastName: string }

export function ClinicalDocumentsPanel({ patient }: { patient: Patient }) {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const list = useApi<any[]>(`/api/patients/${patient.id}/clinical-documents`);
  const [rx, setRx] = useState<{ reissueOf?: any } | null>(null);
  const [cert, setCert] = useState<{ reissueOf?: any } | null>(null);
  const write = can("clinical.write");
  const voidDoc = async (d: any) => {
    const reason = await ask({
      title: `Anular ${d.title.toLowerCase()} ${d.docNumber}`, danger: true, confirmLabel: "Anular documento", inputLabel: "Motivo de la anulación",
      message: "El documento no se borra: queda en el historial marcado ANULADO y su código de verificación lo indicará. Después puedes emitir uno corregido.",
      placeholder: "Ej.: dosis incorrecta",
    });
    if (!reason) return false;
    try { await api.post(`/api/clinical-documents/${d.id}/void`, { reason }); toast("Documento anulado"); list.reload(); return true; } catch (e: any) { toast(e.message, true); return false; }
  };
  const reissue = async (d: any) => {
    const full = await api.get(`/api/clinical-documents/${d.id}`);
    if (d.kind === "prescription") setRx({ reissueOf: { ...full, docNumber: d.docNumber } });
    else setCert({ reissueOf: { ...full, docNumber: d.docNumber } });
  };
  const correct = async (d: any) => { if (await voidDoc(d)) await reissue(d); };
  return (
    <div className="card">
      <div className="card-head">
        <h2>Recetas, certificados y derivaciones</h2>
        {write && <div className="row">
          <button className="btn btn-primary doc-btn" onClick={() => setRx({})}><Pill size={15} />Nueva receta</button>
          <button className="btn doc-btn" onClick={() => setCert({})}><FilePlus2 size={15} />Nuevo certificado</button>
        </div>}
      </div>
      {!list.data ? <Loading /> : list.data.length ? (
        <div className="table-wrap"><table className="table doc-table">
          <thead><tr><th>Documento</th><th className="hide-mobile">Emitió</th><th>Estado</th><th /></tr></thead>
          <tbody>{list.data.map((d) => (
            <tr key={d.id}>
              <td>
                <b>{d.title} {d.docNumber}</b>
                <div className="small">{d.summary}</div>
                <div className="muted small">{fmtDateTime(d.issuedAt)} · {d.branchName}{d.verifyCode ? ` · código ${d.verifyCode}` : ""}</div>
                {d.allergyAcknowledged && <div className="small" style={{ color: "var(--warn)" }}>Aviso de alergia revisado al emitir</div>}
              </td>
              <td className="hide-mobile">{d.issuerName}<div className="muted small">{d.issuerLicense ? `Matrícula ${d.issuerLicense}` : "Sin matrícula registrada"}</div></td>
              <td>{d.status === "voided"
                ? <><span className="badge danger">Anulado</span><div className="muted small">{fmtDate(d.voidedAt)}: {d.voidReason}</div>{d.reissuedById && <div className="muted small">Reemitido</div>}</>
                : <span className="badge ok">Vigente</span>}</td>
              <td>
                <div className="doc-actions">
                  <PdfButton url={`/api/clinical-documents/${d.id}/pdf`} label="PDF" title={`Descargar PDF de ${d.title} ${d.docNumber}`} />
                  {write && d.status === "valid" && <button className="btn doc-btn" onClick={() => correct(d)}><RotateCcw size={15} />Corregir</button>}
                  {write && d.status === "valid" && <button className="btn btn-danger doc-btn" onClick={() => voidDoc(d)}>Anular</button>}
                  {write && d.status === "voided" && !d.reissuedById && <button className="btn doc-btn" onClick={() => reissue(d)}><RotateCcw size={15} />Reemitir corregido</button>}
                </div>
              </td>
            </tr>))}
          </tbody></table></div>
      ) : <Empty>Sin recetas ni certificados emitidos.</Empty>}
      <div className="card-pad" style={{ paddingTop: 0 }}>
        <p className="muted small">Lo emitido no se edita: para corregir se anula con motivo y se emite de nuevo. Cada PDF lleva un código para verificar su autenticidad en /verificar.</p>
      </div>
      {rx && <PrescriptionDialog patient={patient} reissueOf={rx.reissueOf} onClose={() => setRx(null)} onSaved={() => { setRx(null); list.reload(); }} />}
      {cert && <CertificateDialog patient={patient} reissueOf={cert.reissueOf} onClose={() => setCert(null)} onSaved={() => { setCert(null); list.reload(); }} />}
    </div>
  );
}

// ---------------- Contexto común ----------------
function useContextData(patientId: string) {
  return useApi<any>(`/api/patients/${patientId}/prescription-context`);
}

function BranchField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const { me } = useAuth();
  if ((me?.branches.length ?? 0) <= 1) return null;
  return (
    <Field label="Sucursal (membrete)">
      <select className="input" value={value} onChange={(e) => onChange(e.target.value)}>{me!.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
    </Field>
  );
}

function LicenseNotice({ ctx }: { ctx: any }) {
  if (!ctx || ctx.issuer.license) return null;
  return <div className="alert warn small">Tu matrícula profesional no está registrada. El documento saldrá con «Matrícula: no registrada»; pide a administración que la cargue en Configuración → Personal.</div>;
}

// ---------------- Receta ----------------
interface Line { medicationId: string | null; drugInput: string; drug: string; presentation: string; dose: string; frequency: string; duration: string; instructions: string }
const emptyLine = (): Line => ({ medicationId: null, drugInput: "", drug: "", presentation: "", dose: "", frequency: "", duration: "", instructions: "" });
const medLabel = (m: any) => `${m.genericName} — ${m.presentation}`;

function PrescriptionDialog({ patient, reissueOf, onClose, onSaved }: { patient: Patient; reissueOf?: any; onClose: () => void; onSaved: () => void }) {
  const { me, branchId } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const ctx = useContextData(patient.id);
  const meds = useApi<any[]>("/api/medications");
  const prev = reissueOf?.snapshot;
  const [branch, setBranch] = useState<string>(reissueOf?.branchId ?? branchId ?? me?.branches[0]?.id ?? "");
  const [lines, setLines] = useState<Line[]>(() => prev?.lines?.length
    ? prev.lines.map((l: any) => ({ medicationId: null, drugInput: l.presentation ? `${l.drug} — ${l.presentation}` : l.drug, drug: l.drug, presentation: l.presentation ?? "", dose: l.dose, frequency: l.frequency, duration: l.duration, instructions: l.instructions ?? "" }))
    : [emptyLine()]);
  const [indications, setIndications] = useState<string>(prev?.indications ?? "");
  const [warnings, setWarnings] = useState<{ line: number; drug: string; allergy: string }[]>([]);
  const [interactions, setInteractions] = useState<{ line: number; drug: string; with: string; text: string }[]>([]);
  const [ack, setAck] = useState(false);
  const [lineErr, setLineErr] = useState<Record<number, Record<string, string>>>({});
  const [ackErr, setAckErr] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const byLabel = useMemo(() => new Map((meds.data ?? []).map((m) => [medLabel(m), m])), [meds.data]);

  // Re-vincula con el catálogo las líneas reemitidas (para el aviso de alergias por grupo).
  useEffect(() => {
    if (!meds.data) return;
    setLines((ls) => ls.map((l) => (l.medicationId ? l : { ...l, medicationId: byLabel.get(l.drugInput)?.id ?? null })));
  }, [meds.data, byLabel]);

  // Aviso de alergias en vivo (no bloqueante).
  const key = lines.map((l) => `${l.medicationId}|${l.drug}`).join(";");
  const seq = useRef(0);
  useEffect(() => {
    const n = ++seq.current;
    const t = setTimeout(async () => {
      const body = { lines: lines.map((l) => ({ medicationId: l.medicationId, drug: l.drug.trim() })) };
      try { const r = await api.post(`/api/patients/${patient.id}/allergy-check`, body); if (n === seq.current) { setWarnings(r.warnings); setInteractions(r.interactions ?? []); } } catch { /* el servidor vuelve a validar al emitir */ }
    }, 250);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, patient.id]);

  const setLine = (k: number, patch: Partial<Line>) => setLines((ls) => ls.map((l, i) => (i === k ? { ...l, ...patch } : l)));
  const onDrugInput = (k: number, v: string) => {
    const m = byLabel.get(v);
    if (m) {
      const cur = lines[k]!;
      setLine(k, {
        drugInput: v, medicationId: m.id, drug: m.genericName, presentation: m.presentation,
        dose: cur.dose || m.defaultDose || "", frequency: cur.frequency || m.defaultFrequency || "", duration: cur.duration || m.defaultDuration || "",
        instructions: cur.instructions || m.defaultInstructions || "",
      });
    } else setLine(k, { drugInput: v, medicationId: null, drug: v, presentation: "" });
  };

  const validate = () => {
    const le: Record<number, Record<string, string>> = {};
    lines.forEach((l, k) => {
      const e: Record<string, string> = {};
      if (l.drug.trim().length < 2) e.drug = "Escribe o elige el medicamento";
      if (!l.dose.trim()) e.dose = "Indica la dosis";
      if (!l.frequency.trim()) e.frequency = "Indica la frecuencia";
      if (!l.duration.trim()) e.duration = "Indica la duración";
      if (Object.keys(e).length) le[k] = e;
    });
    setLineErr(le);
    const needAck = warnings.length > 0 && !ack;
    setAckErr(needAck);
    return !Object.keys(le).length && !needAck;
  };

  const issue = async () => {
    setErr(null);
    if (!validate()) return;
    const ok = await ask({ title: "Emitir receta", confirmLabel: "Emitir", message: "Al emitirla queda congelada con su PDF y su huella: no se puede editar. Para corregirla se anula con motivo y se emite otra." });
    if (!ok) return;
    setBusy(true);
    try {
      const r = await api.post(`/api/patients/${patient.id}/prescriptions`, {
        branchId: branch, indications: indications.trim() || null, acknowledgeAllergy: ack, reissueOfId: reissueOf?.id ?? null,
        lines: lines.map((l) => ({ medicationId: l.medicationId, drug: l.drug.trim(), presentation: l.presentation.trim() || null, dose: l.dose.trim(), frequency: l.frequency.trim(), duration: l.duration.trim(), instructions: l.instructions.trim() || null })),
      });
      toast(`Receta ${r.number} emitida`);
      onSaved();
    } catch (e) {
      const x = e as ApiError;
      if (x.code === "allergy_ack_required") { setWarnings(x.details?.warnings ?? []); setAckErr(true); }
      else setErr(x.message);
    } finally { setBusy(false); }
  };

  const c = ctx.data;
  return (
    <Dialog wide title={reissueOf ? `Reemitir receta corregida (reemplaza ${reissueOf.docNumber})` : "Nueva receta"} onClose={onClose} footer={<>
      <button className="btn doc-btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary doc-btn" onClick={issue} disabled={busy || !c}>{busy ? "Emitiendo…" : "Emitir receta"}</button>
    </>}>
      {!c ? <Loading /> : (
        <div className="stack">
          {err && <div className="alert danger" role="alert">{err}</div>}
          <div className="row-between"><b>{c.patient.name}</b><span className="muted small">{c.patient.age != null ? `${c.patient.age} años` : "Edad no registrada"}{c.patient.document ? ` · ${c.patient.document}` : ""}</span></div>
          {c.allergies
            ? <div className="alert danger rx-allergy"><AlertTriangle size={18} aria-hidden /><span><b>Alergias registradas:</b> {c.allergies}</span></div>
            : c.hasHistory ? <div className="alert ok small">Sin alergias registradas en la última historia ({fmtDate(c.recordedAt)}).</div>
              : <div className="alert warn small">No hay antecedentes médicos registrados: confirma alergias con el paciente antes de recetar.</div>}
          <LicenseNotice ctx={c} />
          <BranchField value={branch} onChange={setBranch} />
          <datalist id="rx-meds">{(meds.data ?? []).map((m) => <option key={m.id} value={medLabel(m)} />)}</datalist>
          {lines.map((l, k) => {
            const w = warnings.find((x) => x.line === k + 1);
            const ix = interactions.filter((x) => x.line === k + 1);
            const e = lineErr[k] ?? {};
            return (
              <section key={k} className={`rx-line ${w ? "has-warning" : ""}`} aria-label={`Medicamento ${k + 1}`}>
                <div className="rx-line-head">
                  <b>Medicamento {k + 1}</b>
                  {lines.length > 1 && <button className="btn btn-ghost btn-icon doc-btn" aria-label={`Quitar medicamento ${k + 1}`} onClick={() => setLines(lines.filter((_, i) => i !== k))}><Trash2 size={16} /></button>}
                </div>
                <Field label="Medicamento y presentación" hint="Escribe para buscar en el catálogo de la clínica, o escribe uno que no esté.">
                  <input className="input" list="rx-meds" value={l.drugInput} aria-invalid={!!e.drug} onChange={(ev) => onDrugInput(k, ev.target.value)} placeholder="Ej.: Amoxicilina — Cápsulas 500 mg" autoFocus={k === 0 && !reissueOf} />
                </Field>
                {e.drug && <span className="field-error">{e.drug}</span>}
                {w && <div className="alert danger small" role="alert"><b>Posible alergia:</b> el paciente declaró «{w.allergy}». Revisa antes de emitir.</div>}
                {ix.length > 0 && (
                  <div className="alert warn small rx-interaction" role="status">
                    <b>Posible interacción (aviso orientativo):</b>
                    <ul>{ix.map((x, i) => <li key={i}>Con {x.with}: {x.text}.</li>)}</ul>
                  </div>
                )}
                <div className="rx-grid">
                  <div className="stack-sm"><Field label="Dosis"><input className="input" value={l.dose} aria-invalid={!!e.dose} onChange={(ev) => setLine(k, { dose: ev.target.value })} placeholder="1 cápsula" /></Field>{e.dose && <span className="field-error">{e.dose}</span>}</div>
                  <div className="stack-sm"><Field label="Frecuencia"><input className="input" value={l.frequency} aria-invalid={!!e.frequency} onChange={(ev) => setLine(k, { frequency: ev.target.value })} placeholder="Cada 8 horas" /></Field>{e.frequency && <span className="field-error">{e.frequency}</span>}</div>
                  <div className="stack-sm"><Field label="Duración"><input className="input" value={l.duration} aria-invalid={!!e.duration} onChange={(ev) => setLine(k, { duration: ev.target.value })} placeholder="7 días" /></Field>{e.duration && <span className="field-error">{e.duration}</span>}</div>
                </div>
                <Field label="Indicaciones de este medicamento"><input className="input" value={l.instructions} onChange={(ev) => setLine(k, { instructions: ev.target.value })} placeholder="Vía oral, después de las comidas" /></Field>
              </section>
            );
          })}
          {lines.length < 10 && <button className="btn doc-btn" style={{ alignSelf: "flex-start" }} onClick={() => setLines([...lines, emptyLine()])}><Plus size={15} />Agregar medicamento</button>}
          <Field label="Indicaciones generales (opcional)"><textarea className="input" value={indications} onChange={(e) => setIndications(e.target.value)} placeholder="Dieta blanda, frío local las primeras 24 horas…" /></Field>
          {interactions.length > 0 && <p className="muted small rx-interaction-note">Los avisos de interacción salen de una lista corta de casos frecuentes en odontología y de lo anotado en los antecedentes: no son completos ni reemplazan tu criterio. No impiden emitir; quedan anotados en la historia.</p>}
          {warnings.length > 0 && (
            <div className="rx-ack">
              <label className="check"><input type="checkbox" checked={ack} onChange={(e) => { setAck(e.target.checked); setAckErr(false); }} aria-invalid={ackErr} />
                Revisé la alergia y decido emitir igualmente ({warnings.map((x) => `${x.drug}: «${x.allergy}»`).join(", ")})</label>
              {ackErr && <div className="field-error" role="alert" style={{ marginTop: 6 }}>Marca «Revisé la alergia» para emitir con este aviso, o cambia el medicamento.</div>}
            </div>
          )}
        </div>
      )}
    </Dialog>
  );
}

// ---------------- Certificados y derivaciones ----------------
const ymd = (s: string | null | undefined) => (s ? s.slice(0, 10).split("-").reverse().join("/") : "");
const addDays = (s: string, n: number) => { const d = new Date(`${s}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };

function fillTemplate(body: string, f: Record<string, string>, base: Record<string, string>) {
  const v: Record<string, string> = { ...base };
  for (const [k, x] of Object.entries(f)) if (x !== "") v[k] = /^\d{4}-\d{2}-\d{2}$/.test(x) ? ymd(x) : x;
  v.horario = f.timeFrom && f.timeTo ? `, de ${f.timeFrom} a ${f.timeTo}` : f.timeFrom ? `, desde las ${f.timeFrom}` : "";
  v.recipient = f.recipient ? ` ${f.recipient}` : "";
  if (f.restFrom && Number(f.restDays) >= 1) v.restTo = ymd(addDays(f.restFrom, Number(f.restDays) - 1));
  return body.replace(/\{(\w+)\}/g, (m, k: string) => v[k] ?? m);
}

function CertificateDialog({ patient, reissueOf, onClose, onSaved }: { patient: Patient; reissueOf?: any; onClose: () => void; onSaved: () => void }) {
  const { me, branchId } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const ctx = useContextData(patient.id);
  const tpls = useApi<any[]>("/api/certificate-templates");
  const prev = reissueOf?.snapshot;
  const [tplId, setTplId] = useState<string>(reissueOf?.template ?? "attendance");
  const [branch, setBranch] = useState<string>(reissueOf?.branchId ?? branchId ?? me?.branches[0]?.id ?? "");
  const today = localDate();
  const [values, setValues] = useState<Record<string, string>>(() => {
    const f = prev?.fields ?? {};
    return Object.fromEntries(Object.entries(f).filter(([k]) => k !== "restTo").map(([k, v]) => [k, v == null ? "" : String(v)]));
  });
  const [body, setBody] = useState<string>(prev?.body ?? "");
  const [edited, setEdited] = useState<boolean>(!!prev?.body);
  const [fieldErr, setFieldErr] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const tpl = tpls.data?.find((t) => t.id === tplId);
  const c = ctx.data;
  const branchName = me?.branches.find((b) => b.id === branch)?.name ?? "";
  const vals: Record<string, string> = useMemo(() => {
    const v: Record<string, string> = {};
    for (const f of tpl?.fields ?? []) {
      v[f.key] = values[f.key] ?? (f.type === "date" ? today : f.type === "number" ? "1" : f.type === "select" ? f.options[0] : "");
    }
    return v;
  }, [tpl, values, today]);
  const generated = useMemo(() => tpl && c ? fillTemplate(tpl.body, vals, {
    paciente: c.patient.name, documento: c.patient.document ? `con ${c.patient.document}` : "sin documento de identidad registrado",
    edad: c.patient.age != null ? `${c.patient.age} años` : "edad no registrada", clinica: me?.clinic?.name ?? "", sucursal: branchName,
    profesional: c.issuer.name, matricula: c.issuer.license ?? "no registrada", fecha: ymd(today),
  }) : "", [tpl, c, vals, me, branchName, today]);
  useEffect(() => { if (!edited) setBody(generated); }, [generated, edited]);

  const issue = async () => {
    setErr(null);
    const fe: Record<string, string> = {};
    for (const f of tpl?.fields ?? []) {
      if (f.required && !String(vals[f.key] ?? "").trim()) fe[f.key] = "Obligatorio";
      if (f.type === "number" && vals[f.key] && !(Number.isInteger(Number(vals[f.key])) && Number(vals[f.key]) >= 1 && Number(vals[f.key]) <= 90)) fe[f.key] = "Entre 1 y 90";
    }
    setFieldErr(fe);
    if (Object.keys(fe).length) return;
    const left = body.match(/\{\w+\}/g);
    if (left) return setErr(`Falta completar en el texto: ${[...new Set(left)].join(", ")}`);
    if (body.trim().length < 20) return setErr("El texto del documento es muy corto");
    const ok = await ask({ title: `Emitir ${tpl.title.toLowerCase()}`, confirmLabel: "Emitir", message: "Al emitirlo queda congelado con su PDF y su huella: no se puede editar. Para corregirlo se anula con motivo y se emite otro." });
    if (!ok) return;
    setBusy(true);
    try {
      const fields = Object.fromEntries(Object.entries(vals).map(([k, v]) => [k, v === "" ? null : (tpl.fields.find((f: any) => f.key === k)?.type === "number" ? Number(v) : v)]));
      const r = await api.post(`/api/patients/${patient.id}/certificates`, { branchId: branch, template: tplId, fields, body: body.trim(), reissueOfId: reissueOf?.id ?? null });
      toast(`${tpl.title} ${r.number} emitido`);
      onSaved();
    } catch (e) { setErr((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Dialog wide title={reissueOf ? `Reemitir corregido (reemplaza ${reissueOf.docNumber})` : "Nuevo certificado o derivación"} onClose={onClose} footer={<>
      <button className="btn doc-btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary doc-btn" onClick={issue} disabled={busy || !tpl || !c}>{busy ? "Emitiendo…" : "Emitir documento"}</button>
    </>}>
      {!tpls.data || !c ? <Loading /> : (
        <div className="stack">
          {err && <div className="alert danger" role="alert">{err}</div>}
          <LicenseNotice ctx={c} />
          <div className="form-grid">
            <Field label="Tipo de documento">
              <select className="input" value={tplId} disabled={!!reissueOf && reissueOf.kind === "referral"} onChange={(e) => { setTplId(e.target.value); setEdited(false); }}>
                {tpls.data.filter((t) => !reissueOf || (reissueOf.kind === "referral") === (t.kind === "referral")).map((t) => <option key={t.id} value={t.id}>{t.title}</option>)}
              </select>
            </Field>
            <BranchField value={branch} onChange={setBranch} />
            {tpl?.fields.map((f: any) => (
              <div key={`${tplId}-${f.key}`} className={`stack-sm ${f.type === "textarea" ? "span-2" : ""}`}>
                <Field label={f.required ? f.label : f.label} hint={f.hint}>
                  {f.type === "textarea" ? <textarea className="input" value={vals[f.key]} aria-invalid={!!fieldErr[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />
                    : f.type === "select" ? <select className="input" value={vals[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}>{f.options.map((o: string) => <option key={o} value={o}>{o}</option>)}</select>
                      : <input className="input" type={f.type === "number" ? "number" : f.type} min={f.type === "number" ? 1 : undefined} max={f.type === "number" ? 90 : undefined}
                        inputMode={f.type === "number" ? "numeric" : undefined} value={vals[f.key]} aria-invalid={!!fieldErr[f.key]} onChange={(e) => setValues({ ...values, [f.key]: e.target.value })} />}
                </Field>
                {fieldErr[f.key] && <span className="field-error">{fieldErr[f.key]}</span>}
              </div>
            ))}
          </div>
          <Field label="Texto del documento" hint={edited ? "Editaste el texto: los cambios en los campos ya no lo actualizan." : "Se arma con la plantilla y los datos; puedes ajustarlo antes de emitir."}>
            <textarea className="input doc-body-preview" rows={9} value={body} onChange={(e) => { setBody(e.target.value); setEdited(true); }} />
          </Field>
          {edited && <button className="btn doc-btn" style={{ alignSelf: "flex-start" }} onClick={() => setEdited(false)}><RotateCcw size={15} />Volver a generar desde la plantilla</button>}
        </div>
      )}
    </Dialog>
  );
}
