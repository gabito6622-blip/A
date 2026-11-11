import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { FileSpreadsheet, Plus, Search } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi, useDebounced } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { age, fmtDate, fmtDateTime } from "../lib/format";
import { Dialog, Empty, Field, Loading, useToast } from "../components/ui";
import { RELATION_OPTIONS } from "../components/family/FamilyCard";

export function PatientsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [q, setQ] = useState("");
  const [page, setPage] = useState(0);
  const dq = useDebounced(q);
  const list = useApi<any>(`/api/patients${qs({ q: dq, limit: 25, offset: page * 25 })}`);
  const [creating, setCreating] = useState(false);
  return (
    <div className="stack">
      <div className="page-head">
        <div><h1>Pacientes</h1><p className="sub">{list.data ? `${list.data.total} pacientes` : " "}</p></div>
        <div className="row">
          {can("patients.import") && <Link className="btn" to="/importar?tipo=patients"><FileSpreadsheet size={16} />Importar Excel</Link>}
          {can("patients.write") && <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Nuevo paciente</button>}
        </div>
      </div>
      <div className="card">
        <div className="card-pad" style={{ borderBottom: "1px solid var(--line)" }}>
          <div className="row" style={{ position: "relative" }}>
            <Search size={17} style={{ position: "absolute", left: 12, color: "var(--muted)" }} />
            <input className="input" style={{ paddingLeft: 36 }} placeholder="Buscar por nombre, CI, celular o N° de ficha" value={q} onChange={(e) => { setQ(e.target.value); setPage(0); }} aria-label="Buscar pacientes" />
          </div>
        </div>
        {list.loading && !list.data ? <Loading /> : list.data?.items.length ? (
          <>
            <div className="table-wrap"><table className="table">
              <thead><tr><th>Ficha</th><th>Paciente</th><th className="hide-mobile">CI</th><th className="hide-mobile">Edad</th><th>Celular</th><th className="hide-mobile">Próxima cita</th></tr></thead>
              <tbody>{list.data.items.map((p: any) => (
                <tr key={p.id} className="clickable" onClick={() => nav(`/pacientes/${p.id}`)}>
                  <td className="muted">{p.recordNumber}</td><td><b>{p.firstName} {p.lastName}</b></td>
                  <td className="hide-mobile">{p.documentNumber ?? "—"}{p.documentIssued ? ` ${p.documentIssued}` : ""}</td>
                  <td className="hide-mobile">{age(p.birthDate) ?? "—"}</td><td className="nowrap">{p.phone ?? "—"}</td>
                  <td className="hide-mobile">{p.nextAppointment ? fmtDateTime(p.nextAppointment) : <span className="muted">Sin cita</span>}</td>
                </tr>))}
              </tbody></table></div>
            <div className="row-between card-pad">
              <span className="muted small">Página {page + 1} de {Math.max(1, Math.ceil(list.data.total / 25))}</span>
              <div className="row"><button className="btn btn-sm" disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button><button className="btn btn-sm" disabled={(page + 1) * 25 >= list.data.total} onClick={() => setPage(page + 1)}>Siguiente</button></div>
            </div>
          </>
        ) : <Empty>{dq ? "Sin resultados para esa búsqueda." : "Todavía no hay pacientes."}</Empty>}
      </div>
      {creating && <PatientFormDialog onClose={() => setCreating(false)} onSaved={(id) => nav(`/pacientes/${id}`)} />}
    </div>
  );
}

const EMPTY = {
  firstName: "", lastName: "", documentType: "CI", documentNumber: "", documentIssued: "LP", birthDate: "", sex: "", phone: "", email: "",
  address: "", city: "", occupation: "", guardianName: "", guardianPhone: "", guardianRelationship: "", referralSource: "", notes: "",
  consentReminders: false, consentMarketing: false,
};

export function PatientFormDialog({ patient, onClose, onSaved }: { patient?: any; onClose: () => void; onSaved: (id: string) => void }) {
  const toast = useToast();
  const [f, setF] = useState<any>(() => {
    if (!patient) return { ...EMPTY };
    const o: any = { ...EMPTY };
    for (const k of Object.keys(EMPTY)) o[k] = patient[k] ?? (typeof (EMPTY as any)[k] === "boolean" ? false : "");
    return o;
  });
  const [dups, setDups] = useState<any[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const set = (k: string) => (e: any) => setF({ ...f, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value });
  const minor = (age(f.birthDate || null) ?? 99) < 18;
  // R2-39: el celular compartido con un familiar no es un duplicado si se declara la relación.
  const [family, setFamily] = useState<{ relatedPatientId: string; relation: string; legalGuardian: boolean } | null>(null);
  const save = async (allowDuplicate = false, fam = family) => {
    setErr(null);
    const body: any = { ...f, ...(fam && !patient ? { family: fam } : {}) };
    for (const k of Object.keys(body)) if (body[k] === "") body[k] = null;
    if (body.documentType !== "SIN" && !body.documentNumber) { setErr("Indica el número de documento o elige 'Sin documento'"); return; }
    try {
      if (patient) {
        await api.put(`/api/patients/${patient.id}`, body);
        toast("Datos actualizados"); onSaved(patient.id);
      } else {
        const r = await api.post("/api/patients", { ...body, allowDuplicate });
        toast(`Paciente registrado (ficha ${r.recordNumber})`); onSaved(r.id);
      }
    } catch (e: any) {
      if (e.code === "possible_duplicate") setDups(e.details.duplicates); else setErr(e.message);
    }
  };
  return (
    <Dialog wide title={patient ? "Editar paciente" : "Nuevo paciente"} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={() => save(false)}>Guardar</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        {dups && (
          <div className="alert warn stack-sm">
            <b>Ya hay pacientes parecidos. Revisa antes de duplicar el expediente:</b>
            {dups.map((d) => <a key={d.id} href={`/pacientes/${d.id}`}>Ficha {d.recordNumber}: {d.firstName} {d.lastName} — coincide por {d.reason}</a>)}
            {!patient && dups.some((d) => d.reason === "teléfono") && (
              <div className="stack-sm" style={{ borderTop: "1px solid var(--line)", paddingTop: 8 }}>
                <b className="small">¿Comparten celular porque son familia? Regístralo como familiar (no es un duplicado):</b>
                {dups.filter((d) => d.reason === "teléfono").map((d) => (
                  <div key={d.id} className="row" style={{ gap: 6 }}>
                    <select className="input" style={{ maxWidth: 220 }} aria-label={`Qué es ${d.firstName} ${d.lastName} del paciente nuevo`}
                      value={family && family.relatedPatientId === d.id ? family.relation : ""}
                      onChange={(e) => setFamily(e.target.value ? { relatedPatientId: d.id, relation: e.target.value, legalGuardian: minor && ["mother", "father", "guardian"].includes(e.target.value) } : null)}>
                      <option value="">{d.firstName} es…</option>
                      {RELATION_OPTIONS.filter((r) => r.id !== "other").map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
                    </select>
                    <button className="btn btn-sm" disabled={family?.relatedPatientId !== d.id} onClick={() => save(false)}>Registrar como familiar de {d.firstName}</button>
                  </div>
                ))}
                {family && minor && family.legalGuardian && <span className="muted small">Se registrará como su tutor legal y se completarán los datos del responsable.</span>}
              </div>
            )}
            <button className="btn btn-sm btn-danger" style={{ alignSelf: "flex-start" }} onClick={() => save(true)}>Es otra persona: registrar igual</button>
          </div>
        )}
        <div className="form-grid">
          <Field label="Nombres *"><input className="input" value={f.firstName} onChange={set("firstName")} /></Field>
          <Field label="Apellidos *"><input className="input" value={f.lastName} onChange={set("lastName")} /></Field>
          <Field label="Documento" group>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <select className="input" style={{ width: 120 }} value={f.documentType} onChange={set("documentType")} aria-label="Tipo de documento"><option value="CI">CI</option><option value="PASAPORTE">Pasaporte</option><option value="CE">CE</option><option value="OTRO">Otro</option><option value="SIN">Sin documento</option></select>
              <input className="input" value={f.documentNumber} onChange={set("documentNumber")} disabled={f.documentType === "SIN"} placeholder="Número" aria-label="Número de documento" />
              <select className="input" style={{ width: 80 }} value={f.documentIssued} onChange={set("documentIssued")} aria-label="Expedido">{["LP", "CB", "SC", "OR", "PT", "CH", "TJ", "BE", "PD", ""].map((x) => <option key={x} value={x}>{x || "—"}</option>)}</select>
            </div>
          </Field>
          <Field label="Fecha de nacimiento"><input className="input" type="date" value={f.birthDate ?? ""} onChange={set("birthDate")} /></Field>
          <Field label="Sexo"><select className="input" value={f.sex ?? ""} onChange={set("sex")}><option value="">—</option><option value="F">Femenino</option><option value="M">Masculino</option><option value="X">Otro</option></select></Field>
          <Field label="Celular (WhatsApp)"><input className="input" inputMode="tel" value={f.phone ?? ""} onChange={set("phone")} placeholder="7xxxxxxx" /></Field>
          <Field label="Correo"><input className="input" type="email" value={f.email ?? ""} onChange={set("email")} /></Field>
          <Field label="Ciudad"><input className="input" value={f.city ?? ""} onChange={set("city")} /></Field>
          <Field label="Dirección" span2><input className="input" value={f.address ?? ""} onChange={set("address")} /></Field>
          <Field label="Ocupación"><input className="input" value={f.occupation ?? ""} onChange={set("occupation")} /></Field>
          <Field label="¿Cómo nos conoció?"><input className="input" value={f.referralSource ?? ""} onChange={set("referralSource")} /></Field>
          {(minor || f.guardianName) && <>
            <Field label={`Responsable${minor ? " *" : ""}`}><input className="input" value={f.guardianName ?? ""} onChange={set("guardianName")} /></Field>
            <Field label="Parentesco / teléfono del responsable" group><div className="row" style={{ flexWrap: "nowrap" }}><input className="input" value={f.guardianRelationship ?? ""} onChange={set("guardianRelationship")} placeholder="Madre, padre…" aria-label="Parentesco" /><input className="input" value={f.guardianPhone ?? ""} onChange={set("guardianPhone")} placeholder="Teléfono" aria-label="Teléfono del responsable" /></div></Field>
          </>}
          <Field label="Notas administrativas (no clínicas)" span2><textarea className="input" value={f.notes ?? ""} onChange={set("notes")} /></Field>
          <div className="span-2 stack-sm">
            <span className="label">Consentimientos</span>
            <label className="check"><input type="checkbox" checked={f.consentReminders} onChange={set("consentReminders")} />Acepta recibir recordatorios de citas por WhatsApp/SMS</label>
            <label className="check"><input type="checkbox" checked={f.consentMarketing} onChange={set("consentMarketing")} />Acepta recibir promociones y novedades</label>
          </div>
        </div>
      </div>
    </Dialog>
  );
}

export { fmtDate };
