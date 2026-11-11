import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { AlertTriangle, Pencil, Plus, Wallet } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { age, bs, fmtDate, fmtDateTime } from "../lib/format";
import { Empty, Field, Loading, StatusBadge, Tabs, useAsk, useToast } from "../components/ui";
import { Odontogram } from "../components/Odontogram";
import { PatientFormDialog } from "./Patients";
import { BudgetEditor, BudgetDetailDialog } from "./Budgets";
import { PaymentDialog } from "./Cash";
import { ConsentsPanel } from "../components/Consents";
import { PatientRecallsCard } from "../components/Recalls";
import { Periodontogram } from "../components/perio/Periodontogram";
import { PatientLabCard } from "../components/lab/LabShared";
import { PatientTimeline } from "../components/PatientTimeline";
import { ClinicalDocumentsPanel, PdfButton } from "../components/ClinicalDocuments";
import { ClinicalFilesPanel } from "../components/ClinicalFiles";
import { PatientContactActions } from "../components/coordination/Calls";
import { PatientAgreementsCard } from "../components/agreements/AgreementWidgets";

type Tab = "resumen" | "odontograma" | "periodontograma" | "historia" | "presupuestos" | "cuenta" | "consentimientos" | "documentos" | "imagenes";

export function PatientDetailPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const p = useApi<any>(`/api/patients/${id}`);
  const [tab, setTab] = useState<Tab>("resumen");
  const [editing, setEditing] = useState(false);
  const [filesTooth, setFilesTooth] = useState<number | null>(null);
  if (p.error) return <div className="alert danger">{p.error}</div>;
  if (!p.data) return <Loading rows={6} />;
  const pt = p.data.patient;
  const years = age(pt.birthDate);
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="card card-pad">
        <div className="row-between" style={{ alignItems: "flex-start" }}>
          <div className="stack-sm">
            <h1>{pt.firstName} {pt.lastName}</h1>
            <div className="row muted">
              <span>Ficha N° {pt.recordNumber}</span>
              {pt.documentNumber && <span>· {pt.documentType} {pt.documentNumber} {pt.documentIssued ?? ""}</span>}
              {years !== null && <span>· {years} años</span>}
              {pt.phone && <span>· {pt.phone}</span>}
            </div>
            <div className="row">
              {pt.consentReminders ? <span className="badge ok">Acepta recordatorios</span> : <span className="badge">Sin consentimiento de recordatorios</span>}
              {years !== null && years < 18 && <span className="badge warn">Menor · responsable: {pt.guardianName}</span>}
              {pt.archivedAt && <span className="badge danger">Archivado</span>}
            </div>
            <PatientContactActions who={{ patientId: pt.id, patientName: `${pt.firstName} ${pt.lastName}`, phone: pt.phone }} />
          </div>
          <div className="row">
            {p.data.account && (
              <div className="card" style={{ padding: "8px 14px", textAlign: "right" }}>
                <div className="muted small">Saldo</div>
                <div style={{ fontWeight: 700, fontSize: 18, color: p.data.account.balance > 0 ? "var(--danger)" : "var(--ok)" }}>{bs(p.data.account.balance)}</div>
                {p.data.account.pending > 0 && <div className="small" style={{ color: "var(--warn)" }}>{bs(p.data.account.pending)} por verificar</div>}
              </div>
            )}
            {can("patients.write") && <button className="btn" onClick={() => setEditing(true)}><Pencil size={15} />Editar</button>}
          </div>
        </div>
        {p.data.alerts.length > 0 && (
          <div className="alert danger row" style={{ marginTop: 12 }}><AlertTriangle size={18} /><b>Alertas médicas:</b> {p.data.alerts.join(" · ")}</div>
        )}
      </div>

      <Tabs<Tab> value={tab} onChange={setTab} items={[
        { id: "resumen", label: "Resumen" },
        { id: "odontograma", label: "Odontograma", hidden: !can("clinical.read") },
        { id: "periodontograma", label: "Periodontograma", hidden: !can("clinical.read") },
        { id: "historia", label: "Historia clínica", hidden: !can("clinical.read") },
        { id: "documentos", label: "Documentos", hidden: !can("clinical.read") },
        { id: "imagenes", label: "Imágenes y archivos" },
        { id: "presupuestos", label: "Presupuestos", hidden: !can("budgets.read") },
        { id: "cuenta", label: "Cuenta y pagos", hidden: !can("payments.read") },
        { id: "consentimientos", label: "Consentimientos" },
      ]} />

      {tab === "resumen" && (
        <div className="grid grid-2">
          <div className="card">
            <div className="card-head"><h2>Citas</h2></div>
            {p.data.appointments.length ? (
              <div className="table-wrap"><table className="table"><tbody>
                {p.data.appointments.map((a: any) => (
                  <tr key={a.id}><td className="nowrap">{fmtDateTime(a.startsAt)}</td><td>{a.dentistName}<div className="muted small">{a.branchName}</div></td><td><StatusBadge status={a.status} label={STATUS[a.status]} /></td></tr>
                ))}
              </tbody></table></div>
            ) : <Empty>Sin citas registradas.</Empty>}
          </div>
          <div className="card card-pad stack-sm">
            <h2>Datos de contacto</h2>
            <Row k="Celular" v={pt.phone} /><Row k="Correo" v={pt.email} /><Row k="Dirección" v={[pt.address, pt.city].filter(Boolean).join(", ")} />
            <Row k="Nacimiento" v={pt.birthDate ? fmtDate(pt.birthDate + "T12:00:00") : null} /><Row k="Ocupación" v={pt.occupation} />
            <Row k="Responsable" v={pt.guardianName ? `${pt.guardianName} (${pt.guardianRelationship ?? "—"}) ${pt.guardianPhone ?? ""}` : null} />
            <Row k="Notas" v={pt.notes} />
            <Row k="Consentimiento actualizado" v={pt.consentUpdatedAt ? fmtDateTime(pt.consentUpdatedAt) : null} />
          </div>
          <PatientAgreementsCard patientId={id!} />
          {can("agenda.read") && <PatientRecallsCard patientId={id!} />}
          {(can("clinical.read") || can("budgets.read")) && <PatientLabCard patientId={id!} patientName={`${pt.firstName} ${pt.lastName}`} />}
          <PatientTimeline patientId={id!} />
        </div>
      )}
      {tab === "odontograma" && <Odontogram patientId={id!} canWrite={can("clinical.write")} onShowImages={(t) => { setFilesTooth(t); setTab("imagenes"); }} />}
      {tab === "periodontograma" && <Periodontogram patientId={id!} patientName={`${pt.firstName} ${pt.lastName}`} />}
      {tab === "historia" && <ClinicalHistory patientId={id!} />}
      {tab === "presupuestos" && <PatientBudgets patientId={id!} onChanged={p.reload} />}
      {tab === "cuenta" && <PatientAccount patientId={id!} onChanged={p.reload} />}
      {tab === "consentimientos" && <ConsentsPanel patient={pt} />}
      {tab === "documentos" && <ClinicalDocumentsPanel patient={pt} />}
      {tab === "imagenes" && <ClinicalFilesPanel patientId={id!} tooth={filesTooth} onToothChange={setFilesTooth} />}
      {editing && <PatientFormDialog patient={pt} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); p.reload(); }} />}
    </div>
  );
}

const STATUS: Record<string, string> = { scheduled: "Agendada", confirmed: "Confirmada", arrived: "En espera", in_progress: "En atención", completed: "Atendida", cancelled: "Cancelada", no_show: "No asistió" };
const Row = ({ k, v }: { k: string; v: string | null | undefined }) => (
  <div className="row-between" style={{ borderBottom: "1px solid var(--line)", padding: "6px 0" }}><span className="muted">{k}</span><span style={{ textAlign: "right" }}>{v || "—"}</span></div>
);

const KIND: Record<string, string> = { evolution: "Evolución", diagnosis: "Diagnóstico", prescription: "Receta", referral: "Derivación", consent: "Consentimiento", other: "Otro" };

function ClinicalHistory({ patientId }: { patientId: string }) {
  const { can, me, branchId } = useAuth();
  const toast = useToast();
  const notes = useApi<any[]>(`/api/patients/${patientId}/notes`);
  const mh = useApi<any[]>(`/api/patients/${patientId}/medical-history`);
  const [f, setF] = useState({ kind: "evolution", diagnosis: "", body: "", amendsNoteId: "" });
  const [h, setH] = useState<any>(null);
  const write = can("clinical.write");
  const saveNote = async () => {
    try {
      await api.post(`/api/patients/${patientId}/notes`, { branchId: branchId ?? me!.branches[0]!.id, kind: f.kind, diagnosis: f.diagnosis || null, body: f.body, amendsNoteId: f.amendsNoteId || null });
      toast("Nota registrada"); setF({ kind: "evolution", diagnosis: "", body: "", amendsNoteId: "" }); notes.reload();
    } catch (e: any) { toast(e.message, true); }
  };
  const current = mh.data?.[0]?.data;
  const saveHistory = async () => {
    try { await api.post(`/api/patients/${patientId}/medical-history`, h); toast("Antecedentes actualizados"); setH(null); mh.reload(); } catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="split-2-1">
      <div className="stack">
        {write && (
          <div className="card card-pad stack">
            <h2>{f.amendsNoteId ? "Enmienda a una nota" : "Nueva evolución"}</h2>
            <div className="form-grid">
              <Field label="Tipo"><select className="input" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })}>{Object.entries(KIND).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></Field>
              <Field label="Diagnóstico (CIE-10 opcional)"><input className="input" value={f.diagnosis} onChange={(e) => setF({ ...f, diagnosis: e.target.value })} /></Field>
              <Field label="Detalle" span2><textarea className="input" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} placeholder="Motivo, hallazgos, procedimiento realizado, indicaciones…" /></Field>
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={f.body.trim().length < 3} onClick={saveNote}>Firmar y guardar</button>
              {f.amendsNoteId && <button className="btn" onClick={() => setF({ ...f, amendsNoteId: "" })}>Cancelar enmienda</button>}
              <span className="muted small">Las notas firmadas no se editan: las correcciones quedan como enmiendas.</span>
            </div>
          </div>
        )}
        <div className="card">
          <div className="card-head"><h2>Evoluciones</h2></div>
          {!notes.data ? <Loading /> : notes.data.length ? (
            <div className="stack card-pad">
              {notes.data.map((n) => (
                <article key={n.id} className="stack-sm" style={{ borderBottom: "1px solid var(--line)", paddingBottom: 12, opacity: n.amended ? 0.6 : 1 }}>
                  <div className="row-between">
                    <div className="row"><span className="badge brand">{KIND[n.kind]}</span>{n.amendsNoteId && <span className="badge info">Enmienda</span>}{n.amended && <span className="badge warn">Enmendada</span>}</div>
                    <span className="muted small">{fmtDateTime(n.createdAt)} · {n.branchName}</span>
                  </div>
                  {n.diagnosis && <b>Dx: {n.diagnosis}</b>}
                  <p style={{ whiteSpace: "pre-wrap" }}>{n.body}</p>
                  <div className="row-between"><span className="muted small">{n.authorName}{n.authorLicense ? ` · ${n.authorLicense}` : ""}</span>
                    {write && !n.amended && <button className="btn btn-ghost btn-sm" onClick={() => setF({ ...f, amendsNoteId: n.id, kind: n.kind })}>Enmendar</button>}</div>
                </article>
              ))}
            </div>
          ) : <Empty>Sin evoluciones registradas.</Empty>}
        </div>
      </div>
      <div className="card card-pad stack">
        <div className="row-between"><h2>Antecedentes médicos</h2>{write && !h && <button className="btn btn-sm" onClick={() => setH({ allergies: current?.allergies ?? "", medications: current?.medications ?? "", conditions: current?.conditions ?? [], anticoagulants: !!current?.anticoagulants, pregnant: !!current?.pregnant, smoker: !!current?.smoker, bloodPressure: current?.bloodPressure ?? "", observations: current?.observations ?? "" })}>Actualizar</button>}</div>
        {h ? (
          <div className="stack">
            <Field label="Alergias"><input className="input" value={h.allergies} onChange={(e) => setH({ ...h, allergies: e.target.value })} /></Field>
            <Field label="Medicación actual"><input className="input" value={h.medications} onChange={(e) => setH({ ...h, medications: e.target.value })} /></Field>
            <Field label="Enfermedades (separadas por coma)"><input className="input" value={h.conditions.join(", ")} onChange={(e) => setH({ ...h, conditions: e.target.value.split(",").map((x: string) => x.trim()).filter(Boolean) })} /></Field>
            <Field label="Presión arterial"><input className="input" value={h.bloodPressure} onChange={(e) => setH({ ...h, bloodPressure: e.target.value })} /></Field>
            <label className="check"><input type="checkbox" checked={h.anticoagulants} onChange={(e) => setH({ ...h, anticoagulants: e.target.checked })} />Toma anticoagulantes</label>
            <label className="check"><input type="checkbox" checked={h.pregnant} onChange={(e) => setH({ ...h, pregnant: e.target.checked })} />Embarazo</label>
            <label className="check"><input type="checkbox" checked={h.smoker} onChange={(e) => setH({ ...h, smoker: e.target.checked })} />Fumador</label>
            <Field label="Observaciones"><textarea className="input" value={h.observations} onChange={(e) => setH({ ...h, observations: e.target.value })} /></Field>
            <div className="row"><button className="btn btn-primary" onClick={saveHistory}>Guardar versión</button><button className="btn" onClick={() => setH(null)}>Cancelar</button></div>
          </div>
        ) : current ? (
          <div className="stack-sm">
            <Row k="Alergias" v={current.allergies} /><Row k="Medicación" v={current.medications} /><Row k="Enfermedades" v={current.conditions?.join(", ")} />
            <Row k="Anticoagulantes" v={current.anticoagulants ? "Sí" : "No"} /><Row k="Embarazo" v={current.pregnant ? "Sí" : "No"} /><Row k="Presión" v={current.bloodPressure} />
            <Row k="Observaciones" v={current.observations} />
            <span className="muted small">Versión del {fmtDateTime(mh.data![0].recordedAt)} por {mh.data![0].recordedBy}{mh.data!.length > 1 ? ` · ${mh.data!.length - 1} versiones anteriores` : ""}</span>
          </div>
        ) : <p className="muted">Sin antecedentes registrados.</p>}
      </div>
    </div>
  );
}

function PatientBudgets({ patientId, onChanged }: { patientId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const list = useApi<any[]>(`/api/budgets${qs({ patientId })}`);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState<string | null>(null);
  return (
    <div className="card">
      <div className="card-head"><h2>Presupuestos</h2>{can("budgets.write") && <button className="btn btn-primary btn-sm" onClick={() => setCreating(true)}><Plus size={15} />Nuevo presupuesto</button>}</div>
      {!list.data ? <Loading /> : list.data.length ? (
        <div className="table-wrap"><table className="table">
          <thead><tr><th>N°</th><th>Fecha</th><th className="hide-mobile">Profesional</th><th className="num">Total</th><th className="num">Pagado</th><th>Estado</th></tr></thead>
          <tbody>{list.data.map((b) => (
            <tr key={b.id} className="clickable" onClick={() => setOpen(b.id)}><td>{b.number}</td><td>{fmtDate(b.createdAt)}</td><td className="hide-mobile">{b.dentistName}</td><td className="num">{bs(b.totalCents)}</td><td className="num">{bs(b.paidCents)}</td><td><StatusBadge status={b.status} label={b.statusLabel} /></td></tr>
          ))}</tbody></table></div>
      ) : <Empty>Sin presupuestos.</Empty>}
      {creating && <BudgetEditor patientId={patientId} onClose={() => setCreating(false)} onSaved={(id) => { setCreating(false); list.reload(); setOpen(id); }} />}
      {open && <BudgetDetailDialog id={open} onClose={() => setOpen(null)} onChanged={() => { list.reload(); onChanged(); }} />}
    </div>
  );
}

function PatientAccount({ patientId, onChanged }: { patientId: string; onChanged: () => void }) {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const acc = useApi<any>(`/api/patients/${patientId}/account`);
  const [paying, setPaying] = useState(false);
  const voidCharge = async (id: string) => {
    const reason = await ask({ title: "Anular cargo", message: "Se registra un asiento negativo; el cargo original se conserva.", inputLabel: "Motivo de la anulación", confirmLabel: "Anular cargo", danger: true });
    if (!reason) return;
    try { await api.post(`/api/charges/${id}/void`, { reason }); toast("Cargo anulado"); acc.reload(); onChanged(); } catch (e: any) { toast(e.message, true); }
  };
  if (!acc.data) return <Loading />;
  const a = acc.data;
  return (
    <div className="stack">
      <div className="grid grid-4">
        <div className="card kpi"><div className="label">Tratamientos realizados{a.charges.some((c: any) => c.thirdPartyCents) ? " (parte del paciente)" : ""}</div><div className="value">{bs(a.chargedCents)}</div></div>
        <div className="card kpi"><div className="label">Pagado (confirmado)</div><div className="value">{bs(a.paidCents)}</div></div>
        <div className="card kpi"><div className="label">Por verificar</div><div className="value" style={{ color: a.pendingVerificationCents ? "var(--warn)" : undefined }}>{bs(a.pendingVerificationCents)}</div></div>
        <div className="card kpi"><div className="label">Saldo</div><div className="value" style={{ color: a.balanceCents > 0 ? "var(--danger)" : "var(--ok)" }}>{bs(a.balanceCents)}</div><div className="foot">{a.balanceCents < 0 ? "A favor del paciente" : a.balanceCents > 0 ? "Pendiente de cobro" : "Al día"}</div></div>
      </div>
      <div className="grid grid-2">
        <div className="card">
          <div className="card-head"><h2>Pagos</h2>{can("payments.create") && <button className="btn btn-primary btn-sm" onClick={() => setPaying(true)}><Wallet size={15} />Registrar pago</button>}</div>
          {a.payments.length ? <div className="table-wrap"><table className="table"><tbody>
            {a.payments.map((p: any) => (
              <tr key={p.id}><td className="nowrap">{fmtDate(p.receivedAt)}<div className="muted small">Recibo {p.receiptNumber}</div></td><td>{p.methodLabel}{p.bankReference && <div className="muted small">Ref. {p.bankReference}</div>}</td><td className="num">{bs(p.amountCents)}</td>
                <td><StatusBadge status={p.status} label={{ confirmed: "Confirmado", pending_verification: "Por verificar", rejected: "Rechazado", voided: "Anulado" }[p.status as string]} /></td>
                <td>{["confirmed", "voided"].includes(p.status) && <PdfButton url={`/api/payments/${p.id}/receipt.pdf`} label="Recibo" title={`Descargar recibo ${p.receiptNumber} en PDF`} />}</td></tr>
            ))}</tbody></table></div> : <Empty>Sin pagos.</Empty>}
        </div>
        <div className="card">
          <div className="card-head"><h2>Cargos</h2></div>
          {a.charges.length ? <div className="table-wrap"><table className="table"><tbody>
            {a.charges.map((c: any) => (
              <tr key={c.id} style={c.voided ? { textDecoration: "line-through", color: "var(--muted)" } : undefined}>
                <td className="nowrap">{fmtDate(c.createdAt)}</td><td>{c.description}<div className="muted small">{c.dentistName ?? ""}</div>{c.thirdPartyCents ? <div className="small" style={{ color: "var(--brand-ink)" }}>Paga {c.payerName}: {bs(c.thirdPartyCents)} · paciente {bs(c.amountCents - c.thirdPartyCents)}</div> : null}</td><td className="num">{bs(c.amountCents)}</td>
                <td>{can("payments.void") && !c.voided && !c.voidsChargeId && <button className="btn btn-ghost btn-sm" onClick={() => voidCharge(c.id)}>Anular</button>}</td></tr>
            ))}</tbody></table></div> : <Empty>Sin cargos.</Empty>}
        </div>
      </div>
      {paying && <PaymentDialog patientId={patientId} onClose={() => setPaying(false)} onSaved={() => { setPaying(false); acc.reload(); onChanged(); }} />}
    </div>
  );
}
