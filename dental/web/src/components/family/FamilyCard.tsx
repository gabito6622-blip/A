// Tarjeta «Familia» de la ficha (R2-39): relaciones declaradas, tutor legal, saldos y próximas citas
// de cada miembro (según permisos) y «Agendar juntos» para atender a varios miembros seguidos.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { CalendarPlus, ShieldCheck, UserPlus, Users } from "lucide-react";
import { useAuth } from "../../lib/auth";
import { useApi } from "../../lib/hooks";
import { api, newKey, qs } from "../../lib/api";
import { addDays, bs, fmtDate, fmtDateTime, fmtTime, localDate } from "../../lib/format";
import { Dialog, Empty, Field, Loading, useAsk, useToast } from "../ui";
import { PatientPicker } from "../../pages/Agenda";
import "./experience.css";

export interface FamilyMember {
  patientId: string; name: string; recordNumber: number; birthDate: string | null; age: number | null; isMinor: boolean; phone: string | null;
  relation: string; relationshipId: string | null; derived: boolean; isLegalGuardian: boolean; isWard: boolean; samePhone: boolean;
  balanceCents?: number; pendingVerificationCents?: number; nextAppointment?: { startsAt: string; branchName: string; dentistName: string; status: string } | null;
}
interface FamilyData { members: FamilyMember[]; canSeeMoney: boolean; canSeeAgenda: boolean; familyBalanceCents: number | null }

export const RELATION_OPTIONS: { id: string; label: string }[] = [
  { id: "mother", label: "Madre" }, { id: "father", label: "Padre" }, { id: "guardian", label: "Tutor/a" }, { id: "child", label: "Hijo/a" },
  { id: "spouse", label: "Cónyuge" }, { id: "sibling", label: "Hermano/a" }, { id: "other", label: "Otro familiar" },
];

export function PatientFamilyCard({ patient }: { patient: { id: string; firstName: string; lastName: string; birthDate: string | null } }) {
  const { can } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const fam = useApi<FamilyData>(`/api/patients/${patient.id}/family`);
  const [adding, setAdding] = useState(false);
  const [booking, setBooking] = useState(false);
  const write = can("patients.write");
  const setGuardian = async (m: FamilyMember, value: boolean) => {
    try { await api.patch(`/api/relationships/${m.relationshipId}`, { legalGuardian: value }); toast(value ? "Tutor legal registrado" : "Se quitó la marca de tutor legal"); fam.reload(); }
    catch (e: any) { toast(e.message, true); }
  };
  const end = async (m: FamilyMember) => {
    const reason = await ask({ title: "Quitar familiar", message: `La relación con ${m.name} queda en el historial, pero deja de mostrarse en la ficha.`, inputLabel: "Motivo", confirmLabel: "Quitar familiar", danger: true });
    if (!reason) return;
    try { await api.post(`/api/relationships/${m.relationshipId}/end`, { reason }); toast("Relación cerrada"); fam.reload(); } catch (e: any) { toast(e.message, true); }
  };
  const d = fam.data;
  return (
    <div className="card xp" aria-labelledby="family-title">
      <div className="card-head">
        <h2 id="family-title" className="row" style={{ gap: 8 }}><Users size={18} aria-hidden="true" />Familia</h2>
        <div className="row" style={{ gap: 6 }}>
          {can("agenda.write") && !!d?.members.length && <button className="btn btn-sm" onClick={() => setBooking(true)}><CalendarPlus size={15} />Agendar juntos</button>}
          {write && <button className="btn btn-sm btn-primary" onClick={() => setAdding(true)}><UserPlus size={15} />Agregar familiar</button>}
        </div>
      </div>
      {!d ? (fam.error ? <div className="alert danger" style={{ margin: 14 }}>{fam.error}</div> : <Loading rows={2} />) : d.members.length ? (
        <>
          <ul className="xp-members">
            {d.members.map((m) => (
              <li key={m.patientId} className="xp-member">
                <div className="who stack-sm" style={{ gap: 4 }}>
                  <div className="row" style={{ gap: 6 }}>
                    <Link to={`/pacientes/${m.patientId}`}><b>{m.name}</b></Link>
                    <span className="badge brand">{m.relation}</span>
                    {m.isLegalGuardian && <span className="badge ok"><ShieldCheck size={12} aria-hidden="true" />Tutor legal</span>}
                    {m.isWard && <span className="badge info">A su cargo</span>}
                  </div>
                  <span className="muted small">
                    Ficha {m.recordNumber}{m.age !== null ? ` · ${m.age} años` : ""}{m.samePhone ? " · comparten celular" : ""}{m.derived ? " · por la madre, padre o tutor en común" : ""}
                  </span>
                  {d.canSeeAgenda && (
                    <span className="small">{m.nextAppointment
                      ? <>Próxima cita: <b>{fmtDateTime(m.nextAppointment.startsAt)}</b> · {m.nextAppointment.branchName}</>
                      : <span className="muted">Sin próxima cita</span>}</span>
                  )}
                </div>
                {d.canSeeMoney && (
                  <div className="money">
                    <div className="muted small">Saldo</div>
                    <b style={{ color: (m.balanceCents ?? 0) > 0 ? "var(--danger)" : "var(--ok)" }}>{bs(m.balanceCents ?? 0)}</b>
                    {!!m.pendingVerificationCents && <div className="small" style={{ color: "var(--warn)" }}>{bs(m.pendingVerificationCents)} por verificar</div>}
                  </div>
                )}
                {write && m.relationshipId && (
                  <div className="acts">
                    {(m.isLegalGuardian || ["Madre", "Padre", "Madre/padre", "Tutor/a"].includes(m.relation)) && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setGuardian(m, !m.isLegalGuardian)}>{m.isLegalGuardian ? "Quitar tutor legal" : "Marcar como tutor legal"}</button>
                    )}
                    {m.relation === "Hijo/a" && (
                      <button className="btn btn-ghost btn-sm" onClick={() => setGuardian(m, !m.isWard)}>{m.isWard ? `Quitar tutoría legal de ${patient.firstName}` : `${patient.firstName} es su tutor legal`}</button>
                    )}
                    <button className="btn btn-ghost btn-sm" onClick={() => end(m)}>Quitar</button>
                  </div>
                )}
              </li>
            ))}
          </ul>
          {d.canSeeMoney && d.familyBalanceCents !== null && d.familyBalanceCents > 0 && (
            <div className="card-pad row-between" style={{ borderTop: "1px solid var(--line)" }}>
              <span className="muted">Deuda de los familiares</span><b style={{ color: "var(--danger)" }}>{bs(d.familyBalanceCents)}</b>
            </div>
          )}
        </>
      ) : <Empty>Sin familiares registrados. Vincúlalos para compartir el celular sin duplicar fichas y para agendarlos juntos.</Empty>}
      {adding && <AddRelativeDialog patient={patient} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); fam.reload(); }} />}
      {booking && d && <FamilyBookingDialog patient={patient} members={d.members} onClose={() => setBooking(false)} onSaved={() => { setBooking(false); fam.reload(); }} />}
    </div>
  );
}

function AddRelativeDialog({ patient, onClose, onSaved }: { patient: { id: string; firstName: string }; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [rel, setRel] = useState<{ id: string; name: string } | null>(null);
  const [f, setF] = useState({ relation: "mother", otherLabel: "", legalGuardian: false });
  const [errs, setErrs] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const parent = ["mother", "father", "guardian", "child"].includes(f.relation);
  const save = async () => {
    const v: Record<string, string> = {};
    if (!rel) v.related = "Elige al familiar";
    if (f.relation === "other" && f.otherLabel.trim().length < 2) v.otherLabel = "Escribe el parentesco (por ejemplo: abuela, tío)";
    setErrs(v); setErr(null);
    if (Object.keys(v).length) return;
    setBusy(true);
    try {
      await api.post(`/api/patients/${patient.id}/relationships`, { relatedPatientId: rel!.id, relation: f.relation, otherLabel: f.relation === "other" ? f.otherLabel : null, legalGuardian: parent && f.legalGuardian });
      toast("Familiar vinculado");
      onSaved();
    } catch (e: any) {
      const d: Record<string, string> = {};
      for (const x of e.details ?? []) if (x.path && !d[x.path]) d[x.path] = x.message;
      if (Object.keys(d).length) setErrs(d); else setErr(e.message);
    } finally { setBusy(false); }
  };
  const fe = (k: string) => errs[k] && <span className="hint" style={{ color: "var(--danger)" }} role="alert">{errs[k]}</span>;
  return (
    <Dialog title="Agregar familiar" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Vincular"}</button></>}>
      <div className="stack xp">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <Field label="Familiar (debe estar registrado como paciente)" group><PatientPicker value={rel} onChange={setRel} /></Field>
        {fe("related")}
        <Field label={`¿Qué es ${rel ? rel.name : "el familiar"} de ${patient.firstName}?`}>
          <select className="input" value={f.relation} onChange={(e) => setF({ ...f, relation: e.target.value, legalGuardian: false })}>
            {RELATION_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        </Field>
        {f.relation === "other" && <Field label="Parentesco"><input className="input" value={f.otherLabel} aria-invalid={!!errs.otherLabel} onChange={(e) => setF({ ...f, otherLabel: e.target.value })} placeholder="Abuela, tío, padrino…" /></Field>}
        {fe("otherLabel")}
        {parent && (
          <label className="check">
            <input type="checkbox" checked={f.legalGuardian} onChange={(e) => setF({ ...f, legalGuardian: e.target.checked })} />
            {f.relation === "child" ? `${patient.firstName} es su tutor legal (responde por el menor)` : "Es su tutor legal (responde por el menor: acepta presupuestos y ve sus citas en el portal)"}
          </label>
        )}
        <p className="muted small" style={{ margin: 0 }}>La relación se ve desde las dos fichas. Si comparten celular, el aviso de duplicados lo mostrará como «familiar declarado».</p>
      </div>
    </Dialog>
  );
}

interface Slot { dentistId: string; dentistName: string; slots: string[] }

function FamilyBookingDialog({ patient, members, onClose, onSaved }: { patient: { id: string; firstName: string; lastName: string }; members: FamilyMember[]; onClose: () => void; onSaved: () => void }) {
  const { me, branchId: selBranch } = useAuth();
  const toast = useToast();
  const people = useMemo(() => [{ patientId: patient.id, name: `${patient.firstName} ${patient.lastName}`, relation: "Paciente" }, ...members.map((m) => ({ patientId: m.patientId, name: m.name, relation: m.relation }))], [patient, members]);
  const [chosen, setChosen] = useState<Record<string, number>>(() => Object.fromEntries(people.filter((p) => p.patientId === patient.id || ["Hermano/a", "Hijo/a"].includes(members.find((m) => m.patientId === p.patientId)?.relation ?? "")).map((p) => [p.patientId, 30])));
  const [branchId, setBranchId] = useState(selBranch ?? me?.branches[0]?.id ?? "");
  const [date, setDate] = useState(addDays(localDate(), 1));
  const [dentistId, setDentistId] = useState("");
  const [pick, setPick] = useState<{ dentistId: string; startsAt: string } | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [key] = useState(newKey());
  const order = people.filter((p) => chosen[p.patientId]);
  const total = order.reduce((s, p) => s + (chosen[p.patientId] ?? 0), 0);
  const slots = useApi<Slot[]>(branchId && order.length ? `/api/family/slots${qs({ branchId, date, dentistId: dentistId || undefined, totalMin: total })}` : null);
  const staff = useApi<any[]>("/api/staff?professionals=1");
  const dentists = (staff.data ?? []).filter((s) => s.allBranches || s.role === "owner" || s.branchIds.includes(branchId));
  const toggle = (id: string) => { setPick(null); setChosen((c) => { const n = { ...c }; if (n[id]) delete n[id]; else n[id] = 30; return n; }); };
  const save = async () => {
    if (!pick) { setErr("Elige un horario"); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.post("/api/family/appointments", {
        branchId, dentistId: pick.dentistId, startsAt: pick.startsAt, idempotencyKey: key, reason: "Atención en familia",
        members: order.map((p) => ({ patientId: p.patientId, durationMin: chosen[p.patientId] })),
      });
      toast(`${r.ids.length} citas agendadas seguidas`);
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  let t = pick ? new Date(pick.startsAt).getTime() : 0;
  return (
    <Dialog wide title="Agendar a la familia seguida" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button>
      <button className="btn btn-primary" disabled={busy || !pick || order.length < 1} onClick={save}>{busy ? "Agendando…" : `Agendar ${order.length} ${order.length === 1 ? "cita" : "citas"}`}</button></>}>
      <div className="stack xp">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <fieldset className="stack-sm" style={{ border: "none", padding: 0, margin: 0 }}>
          <legend className="label">¿A quiénes atendemos? (en este orden)</legend>
          {people.map((p) => (
            <div key={p.patientId} className="row-between" style={{ gap: 8 }}>
              <label className="check"><input type="checkbox" checked={!!chosen[p.patientId]} onChange={() => toggle(p.patientId)} />{p.name} <span className="muted small">({p.relation})</span></label>
              {!!chosen[p.patientId] && (
                <select className="input" style={{ width: 120 }} aria-label={`Duración para ${p.name}`} value={chosen[p.patientId]} onChange={(e) => { setPick(null); setChosen({ ...chosen, [p.patientId]: Number(e.target.value) }); }}>
                  {[15, 20, 30, 45, 60, 90].map((m) => <option key={m} value={m}>{m} min</option>)}
                </select>
              )}
            </div>
          ))}
        </fieldset>
        <div className="form-grid">
          <Field label="Sucursal">
            <select className="input" value={branchId} onChange={(e) => { setBranchId(e.target.value); setPick(null); }}>{me?.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}</select>
          </Field>
          <Field label="Fecha"><input className="input" type="date" value={date} min={localDate()} onChange={(e) => { setDate(e.target.value); setPick(null); }} /></Field>
          <Field label="Profesional" span2>
            <select className="input" value={dentistId} onChange={(e) => { setDentistId(e.target.value); setPick(null); }}>
              <option value="">Cualquiera con hueco</option>{dentists.map((d) => <option key={d.userId} value={d.userId}>{d.fullName}</option>)}
            </select>
          </Field>
        </div>
        <div className="stack-sm">
          <span className="label">Horarios con {total} minutos seguidos libres</span>
          {!order.length ? <p className="muted small">Elige al menos a una persona.</p> : !slots.data ? <Loading rows={2} /> : slots.data.every((s) => !s.slots.length) ? (
            <p className="muted small">No hay {total} minutos seguidos libres ese día. Prueba otra fecha u otro profesional.</p>
          ) : slots.data.filter((s) => s.slots.length).map((s) => (
            <div key={s.dentistId} className="stack-sm">
              <b className="small">{s.dentistName}</b>
              <div className="xp-chips">
                {s.slots.slice(0, 24).map((x) => (
                  <button key={x} type="button" className="xp-chip xp-chip-toggle" aria-pressed={pick?.startsAt === x && pick.dentistId === s.dentistId} onClick={() => setPick({ dentistId: s.dentistId, startsAt: x })}>{fmtTime(x)}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
        {pick && (
          <div className="alert info" role="status">
            <b>{fmtDate(pick.startsAt)}</b>:{" "}
            {order.map((p, i) => { const s = t; t += (chosen[p.patientId] ?? 0) * 60_000; return <span key={p.patientId}>{i ? " · " : ""}{fmtTime(new Date(s))} {p.name.split(" ")[0]}</span>; })}
          </div>
        )}
      </div>
    </Dialog>
  );
}
