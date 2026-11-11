import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { KeyRound, Pencil, Plus, RotateCcw, ShieldCheck, Trash2 } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { bs, fmtDateTime, parseBs, toBsInput } from "../lib/format";
import { Dialog, Empty, Field, Loading, Tabs, useAsk, useToast } from "../components/ui";
import { StandardConsumptionEditor } from "../components/inventory/StandardConsumption";
import { SessionTemplateEditor } from "../components/BudgetV2";
import { PortalSettingsTab } from "./PortalSettings";
import { AppointmentTypesSettings } from "../components/agenda/AppointmentTypesSettings";
import { MessagingSettingsTab } from "./MessagingSettings";
import { MedicationsTab } from "../components/Medications";

type Tab = "clinic" | "branches" | "staff" | "schedules" | "procedures" | "appointmentTypes" | "medications" | "consents" | "portal" | "messaging" | "security" | "audit";

export const ROLE_OPTIONS: { id: string; label: string }[] = [
  { id: "owner", label: "Propietario" },
  { id: "admin", label: "Administrador" },
  { id: "receptionist", label: "Recepción" },
  { id: "dentist", label: "Odontólogo" },
  { id: "assistant", label: "Asistente" },
  { id: "accountant", label: "Contabilidad" },
  { id: "support", label: "Limpieza y apoyo" },
];

const WEEKDAYS = ["", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado", "Domingo"];

const CONDITIONS: { id: string; label: string }[] = [
  { id: "", label: "Ninguna" },
  { id: "caries", label: "Caries" },
  { id: "restoration", label: "Obturación / restauración" },
  { id: "sealant", label: "Sellante" },
  { id: "fracture", label: "Fractura" },
  { id: "crown", label: "Corona" },
  { id: "endodontics", label: "Tratamiento de conducto" },
  { id: "extraction", label: "Extracción" },
  { id: "missing", label: "Ausente" },
  { id: "implant", label: "Implante" },
  { id: "pontic", label: "Póntico (puente)" },
  { id: "removable_prosthesis", label: "Prótesis removible" },
  { id: "orthodontic_appliance", label: "Aparato de ortodoncia" },
];

const SCOPES: { id: string; label: string }[] = [
  { id: "mouth", label: "Boca completa" },
  { id: "quadrant", label: "Cuadrante" },
  { id: "tooth", label: "Pieza dental" },
  { id: "surface", label: "Superficie" },
];

export function SettingsPage() {
  const { can, me } = useAuth();
  const items: { id: Tab; label: string; hidden?: boolean }[] = [
    { id: "clinic", label: "Clínica", hidden: !can("clinic.manage") },
    { id: "branches", label: "Sucursales", hidden: !can("clinic.manage") },
    { id: "staff", label: "Personal", hidden: !can("staff.manage") },
    { id: "schedules", label: "Horarios", hidden: !can("clinic.manage") },
    { id: "procedures", label: "Prestaciones", hidden: !can("clinic.manage") },
    { id: "appointmentTypes", label: "Tipos de cita", hidden: !can("clinic.manage") },
    { id: "medications", label: "Medicamentos", hidden: !can("clinic.manage") },
    { id: "consents", label: "Consentimientos", hidden: !can("clinic.manage") },
    { id: "portal", label: "Reserva online", hidden: !can("clinic.manage") },
    { id: "messaging", label: "Mensajes automáticos", hidden: !can("clinic.manage") },
    { id: "security", label: "Seguridad", hidden: me?.membership?.role !== "owner" },
    { id: "audit", label: "Auditoría", hidden: !can("audit.read") },
  ];
  const visible = items.filter((i) => !i.hidden);
  // ?tab=… abre una pestaña concreta (enlaces de «Primeros pasos» y de la Ayuda).
  const [sp] = useSearchParams();
  const wanted = visible.find((i) => i.id === sp.get("tab"))?.id;
  const [tab, setTab] = useState<Tab>(wanted ?? visible[0]?.id ?? "clinic");
  useEffect(() => { if (wanted) setTab(wanted); }, [wanted]);
  if (!visible.length) return <Empty>No tienes acceso a la configuración.</Empty>;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Configuración</h1>
          <p className="sub">Clínica, sucursales, personal, horarios, prestaciones, consentimientos, seguridad y auditoría</p>
        </div>
      </div>
      <Tabs value={tab} onChange={setTab} items={items} />
      {tab === "clinic" && <ClinicTab />}
      {tab === "branches" && <BranchesTab />}
      {tab === "staff" && <StaffTab />}
      {tab === "schedules" && <SchedulesTab />}
      {tab === "procedures" && <ProceduresTab />}
      {tab === "appointmentTypes" && <AppointmentTypesSettings />}
      {tab === "medications" && <MedicationsTab />}
      {tab === "consents" && <ConsentsTab />}
      {tab === "portal" && <PortalSettingsTab />}
      {tab === "messaging" && <MessagingSettingsTab />}
      {tab === "security" && <SecurityTab />}
      {tab === "audit" && <AuditTab />}
    </div>
  );
}

// ---------------- Clínica ----------------
function ClinicTab() {
  const toast = useToast();
  const { refresh } = useAuth();
  const c = useApi<any>("/api/clinic");
  const [f, setF] = useState({ name: "", legalName: "", taxId: "", timezone: "America/La_Paz" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (c.data) setF({ name: c.data.name ?? "", legalName: c.data.legalName ?? "", taxId: c.data.taxId ?? "", timezone: c.data.timezone ?? "America/La_Paz" });
  }, [c.data]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.patch("/api/clinic", { name: f.name, legalName: f.legalName || null, taxId: f.taxId || null, timezone: f.timezone });
      toast("Datos de la clínica guardados");
      c.reload(); refresh();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  if (!c.data) return <div className="card"><Loading /></div>;
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><h2>Datos de la clínica</h2></div>
        <div className="card-pad stack">
          {err && <div className="alert danger" role="alert">{err}</div>}
          <div className="form-grid">
            <Field label="Nombre comercial" span2><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
            <Field label="Razón social"><input className="input" value={f.legalName} onChange={(e) => setF({ ...f, legalName: e.target.value })} /></Field>
            <Field label="NIT"><input className="input" inputMode="numeric" value={f.taxId} onChange={(e) => setF({ ...f, taxId: e.target.value })} /></Field>
            <Field label="Zona horaria" hint="Bolivia: America/La_Paz (UTC-4)" span2>
              <input className="input" value={f.timezone} onChange={(e) => setF({ ...f, timezone: e.target.value })} />
            </Field>
          </div>
          <button className="btn btn-primary" style={{ alignSelf: "flex-start" }} disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar cambios"}</button>
        </div>
      </div>
      <div className="card">
        <div className="card-head"><h2>Plan contratado</h2></div>
        <div className="card-pad stack-sm">
          <div className="row-between"><span className="muted">Plan</span><b>{c.data.planName ?? "Sin plan"}</b></div>
          <div className="row-between"><span className="muted">Sucursales activas permitidas</span><b>{c.data.maxBranches ?? "—"}</b></div>
          <div className="row-between"><span className="muted">Usuarios activos permitidos</span><b>{c.data.maxUsers ?? "—"}</b></div>
          <div className="row-between"><span className="muted">Moneda</span><b>{c.data.currency}</b></div>
          <div className="row-between"><span className="muted">Estado</span><span className="badge brand">{({ trial: "Prueba", active: "Activa", suspended: "Suspendida", cancelled: "Cancelada" } as Record<string, string>)[c.data.status] ?? c.data.status}</span></div>
          <p className="muted small" style={{ marginTop: 8 }}>Para cambiar de plan, comunícate con el proveedor del servicio.</p>
        </div>
      </div>
    </div>
  );
}

// ---------------- Sucursales ----------------
type Hours = Record<string, [string, string][]>;

function BranchesTab() {
  const toast = useToast();
  const b = useApi<any[]>("/api/branches");
  const [edit, setEdit] = useState<any | null>(null);
  const [chairFor, setChairFor] = useState<string | null>(null);
  const [chairName, setChairName] = useState("");
  const [renaming, setRenaming] = useState<{ id: string; name: string } | null>(null);
  const addChair = async () => {
    try {
      await api.post("/api/chairs", { branchId: chairFor, name: chairName });
      toast("Consultorio agregado"); setChairFor(null); setChairName(""); b.reload();
    } catch (e: any) { toast(e.message, true); }
  };
  const patchChair = async (id: string, body: Record<string, unknown>) => {
    try { await api.patch(`/api/chairs/${id}`, body); toast("Consultorio actualizado"); b.reload(); setRenaming(null); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="stack">
      <div className="row-between">
        <p className="muted">{b.data?.filter((x) => x.active).length ?? 0} sucursales activas</p>
        <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />Nueva sucursal</button>
      </div>
      {!b.data ? <div className="card"><Loading /></div> : b.data.length === 0 ? <div className="card"><Empty>Aún no hay sucursales.</Empty></div> : (
        <div className="grid grid-2">
          {b.data.map((br) => (
            <div key={br.id} className="card">
              <div className="card-head">
                <div>
                  <h3>{br.name} <span className="muted small">({br.code})</span></h3>
                  <p className="muted small">{[br.address, br.city].filter(Boolean).join(", ") || "Sin dirección"}{br.phone ? ` · ${br.phone}` : ""}</p>
                </div>
                <div className="row">
                  {!br.active && <span className="badge danger">Inactiva</span>}
                  <button className="btn btn-sm" onClick={() => setEdit(br)}><Pencil size={14} />Editar</button>
                </div>
              </div>
              <div className="card-pad stack-sm">
                <span className="label">Consultorios</span>
                {br.chairs.length === 0 && <p className="muted small">Sin consultorios.</p>}
                {br.chairs.map((ch: any) => (
                  <div key={ch.id} className="row-between">
                    {renaming && renaming.id === ch.id ? (
                      <div className="row" style={{ flex: 1 }}>
                        <input className="input" style={{ maxWidth: 220 }} value={renaming.name} onChange={(e) => setRenaming({ id: ch.id, name: e.target.value })} />
                        <button className="btn btn-sm btn-primary" onClick={() => patchChair(ch.id, { name: renaming.name })}>Guardar</button>
                        <button className="btn btn-sm btn-ghost" onClick={() => setRenaming(null)}>Cancelar</button>
                      </div>
                    ) : (
                      <>
                        <span>{ch.name} {!ch.active && <span className="badge danger">Inactivo</span>}</span>
                        <div className="row" style={{ gap: 4 }}>
                          <button className="btn btn-sm btn-ghost" onClick={() => setRenaming({ id: ch.id, name: ch.name })}>Renombrar</button>
                          <button className="btn btn-sm btn-ghost" onClick={() => patchChair(ch.id, { active: !ch.active })}>{ch.active ? "Desactivar" : "Activar"}</button>
                        </div>
                      </>
                    )}
                  </div>
                ))}
                {chairFor === br.id ? (
                  <div className="row">
                    <input className="input" style={{ maxWidth: 220 }} placeholder="Ej.: Consultorio 3" value={chairName} onChange={(e) => setChairName(e.target.value)} autoFocus />
                    <button className="btn btn-sm btn-primary" disabled={!chairName.trim()} onClick={addChair}>Agregar</button>
                    <button className="btn btn-sm btn-ghost" onClick={() => setChairFor(null)}>Cancelar</button>
                  </div>
                ) : (
                  <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => { setChairFor(br.id); setChairName(""); }}><Plus size={14} />Consultorio</button>
                )}
                <span className="label" style={{ marginTop: 8 }}>Horario de atención</span>
                <div className="small muted">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => {
                    const r: [string, string][] = br.openingHours?.[String(d)] ?? [];
                    return r.length ? <div key={d}>{WEEKDAYS[d]}: {r.map((x) => `${x[0]}–${x[1]}`).join(", ")}</div> : null;
                  })}
                  {!Object.keys(br.openingHours ?? {}).length && <span>Sin horario definido</span>}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
      {edit && <BranchDialog branch={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); b.reload(); }} />}
    </div>
  );
}

function BranchDialog({ branch, onClose, onSaved }: { branch: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = !branch.id;
  const [f, setF] = useState({
    code: branch.code ?? "", name: branch.name ?? "", address: branch.address ?? "", city: branch.city ?? "", phone: branch.phone ?? "", active: branch.active ?? true,
  });
  const [hours, setHours] = useState<Hours>(() => JSON.parse(JSON.stringify(branch.openingHours ?? {})));
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const setRange = (d: number, i: number, k: 0 | 1, v: string) => {
    const list = [...(hours[String(d)] ?? [])] as [string, string][];
    const r = [...(list[i] ?? ["08:00", "12:00"])] as [string, string];
    r[k] = v; list[i] = r;
    setHours({ ...hours, [String(d)]: list });
  };
  const addRange = (d: number) => {
    const list = [...(hours[String(d)] ?? [])] as [string, string][];
    if (list.length >= 2) return;
    list.push(list.length ? ["14:30", "19:00"] : ["08:00", "12:30"]);
    setHours({ ...hours, [String(d)]: list });
  };
  const removeRange = (d: number, i: number) => {
    const list = [...(hours[String(d)] ?? [])];
    list.splice(i, 1);
    const next = { ...hours };
    if (list.length) next[String(d)] = list as [string, string][]; else delete next[String(d)];
    setHours(next);
  };
  const save = async () => {
    setBusy(true); setErr(null);
    for (const [d, list] of Object.entries(hours)) for (const [s, e] of list) if (e <= s) { setErr(`${WEEKDAYS[Number(d)]}: la hora de cierre debe ser posterior a la de apertura`); setBusy(false); return; }
    const body = { ...f, address: f.address || null, city: f.city || null, phone: f.phone || null, openingHours: hours };
    try {
      if (isNew) await api.post("/api/branches", body); else await api.put(`/api/branches/${branch.id}`, body);
      toast(isNew ? "Sucursal creada" : "Sucursal actualizada");
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title={isNew ? "Nueva sucursal" : `Editar ${branch.name}`} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Código" hint="Corto, p. ej. LPZ"><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Nombre"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Dirección" span2><input className="input" value={f.address} onChange={(e) => setF({ ...f, address: e.target.value })} /></Field>
          <Field label="Ciudad"><input className="input" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} /></Field>
          <Field label="Teléfono"><input className="input" inputMode="tel" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} /></Field>
          {!isNew && <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Sucursal activa</label>}
        </div>
        <div className="stack-sm">
          <span className="label">Horario de atención (hasta 2 turnos por día)</span>
          {[1, 2, 3, 4, 5, 6, 7].map((d) => {
            const list = hours[String(d)] ?? [];
            return (
              <div key={d} className="row" style={{ alignItems: "center" }}>
                <span style={{ width: 90, fontWeight: 560 }}>{WEEKDAYS[d]}</span>
                {list.length === 0 && <span className="muted small" style={{ minWidth: 70 }}>Cerrado</span>}
                {list.map((r, i) => (
                  <div key={i} className="row" style={{ gap: 4 }}>
                    <input className="input" type="time" style={{ width: 110 }} value={r[0]} onChange={(e) => setRange(d, i, 0, e.target.value)} aria-label={`${WEEKDAYS[d]} apertura ${i + 1}`} />
                    <span>–</span>
                    <input className="input" type="time" style={{ width: 110 }} value={r[1]} onChange={(e) => setRange(d, i, 1, e.target.value)} aria-label={`${WEEKDAYS[d]} cierre ${i + 1}`} />
                    <button className="btn btn-ghost btn-icon btn-sm" onClick={() => removeRange(d, i)} aria-label="Quitar turno"><Trash2 size={14} /></button>
                  </div>
                ))}
                {list.length < 2 && <button className="btn btn-sm" onClick={() => addRange(d)}><Plus size={14} />Turno</button>}
              </div>
            );
          })}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------- Personal ----------------
function StaffTab() {
  const { me } = useAuth();
  const toast = useToast();
  const ask = useAsk();
  const s = useApi<any[]>("/api/staff");
  const [resetting, setResetting] = useState<string | null>(null);
  const resetPassword = async (p: any) => {
    if (!(await ask({ title: "Restablecer contraseña", message: `¿Generar una contraseña temporal para ${p.fullName}? Su contraseña actual dejará de funcionar y se cerrarán sus sesiones abiertas.`, confirmLabel: "Generar contraseña temporal" }))) return;
    setResetting(p.userId);
    try {
      const r = await api.post<{ temporaryPassword: string }>(`/api/staff/${p.userId}/reset-password`);
      setTempPw({ email: p.email ?? p.fullName, password: r.temporaryPassword });
      toast("Contraseña temporal generada");
    } catch (e: any) {
      toast(e.message, true);
    } finally { setResetting(null); }
  };
  const branches = useApi<any[]>("/api/branches");
  const [edit, setEdit] = useState<any | null>(null);
  const [tempPw, setTempPw] = useState<{ email: string; password: string } | null>(null);
  const branchName = (id: string) => branches.data?.find((b) => b.id === id)?.name ?? "—";
  return (
    <div className="stack">
      {tempPw && (
        <div className="alert warn stack-sm" role="alert">
          <div className="row"><KeyRound size={18} /><b>Contraseña temporal de {tempPw.email}</b></div>
          <code style={{ fontSize: 18, fontWeight: 700, letterSpacing: "0.04em", userSelect: "all" }}>{tempPw.password}</code>
          <span className="small">Se muestra una sola vez. Entrégala en persona o por un canal seguro (nunca por un grupo de WhatsApp). El sistema le pedirá cambiarla al ingresar.</span>
          <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setTempPw(null)}>Ya la entregué</button>
        </div>
      )}
      <div className="row-between">
        <p className="muted">{s.data?.filter((x) => x.active).length ?? 0} personas activas</p>
        <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />Agregar persona</button>
      </div>
      <div className="card">
        {!s.data ? <Loading /> : s.data.length === 0 ? <Empty>Sin personal registrado.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Nombre</th><th className="hide-mobile">Correo</th><th>Rol</th><th className="hide-mobile">Sucursales</th><th className="hide-mobile num">Comisión</th><th className="hide-mobile">2 pasos</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {s.data.map((p) => (
                  <tr key={p.userId}>
                    <td>
                      <div className="row" style={{ gap: 8 }}>
                        {p.color && <i className="dot" style={{ background: p.color }} />}
                        <div><b>{p.fullName}</b>{p.isProfessional && <div className="muted small">Atiende pacientes{p.license ? ` · ${p.license}` : ""}</div>}</div>
                      </div>
                    </td>
                    <td className="hide-mobile">{p.email ?? "—"}</td>
                    <td>{p.roleLabel}</td>
                    <td className="hide-mobile small">{p.allBranches || p.role === "owner" ? "Todas" : p.branchIds.map(branchName).join(", ") || "—"}</td>
                    <td className="hide-mobile num">{p.commissionPct != null ? `${p.commissionPct}%` : "—"}</td>
                    <td className="hide-mobile">{p.mfaEnabled ? <span className="badge ok"><ShieldCheck size={13} />Activa</span> : <span className="muted">—</span>}</td>
                    <td>{p.active ? <span className="badge ok">Activo</span> : <span className="badge danger">Inactivo</span>}</td>
                    <td className="num nowrap">{p.userId !== me?.user.id && (
                      <>
                        <button className="btn btn-sm" onClick={() => setEdit(p)}><Pencil size={14} />Editar</button>{" "}
                        <button className="btn btn-sm" disabled={resetting === p.userId} onClick={() => resetPassword(p)} title="Genera una contraseña temporal que deberá cambiar al ingresar"><RotateCcw size={14} />Restablecer contraseña</button>
                      </>
                    )}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && (
        <StaffDialog person={edit} branches={branches.data ?? []} onClose={() => setEdit(null)}
          onSaved={(pw) => { if (pw) setTempPw(pw); setEdit(null); s.reload(); }} />
      )}
    </div>
  );
}

function StaffDialog({ person, branches, onClose, onSaved }: { person: any; branches: any[]; onClose: () => void; onSaved: (pw: { email: string; password: string } | null) => void }) {
  const toast = useToast();
  const isNew = !person.userId;
  const [f, setF] = useState({
    email: person.email ?? "", fullName: person.fullName ?? "", role: person.role ?? "receptionist",
    allBranches: person.allBranches ?? false, branchIds: (person.branchIds ?? []) as string[],
    isProfessional: person.isProfessional ?? false, license: person.license ?? "", color: person.color ?? "#2563eb",
    commissionPct: person.commissionPct != null ? String(person.commissionPct) : "", active: person.active ?? true,
  });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const toggleBranch = (id: string) => setF({ ...f, branchIds: f.branchIds.includes(id) ? f.branchIds.filter((x) => x !== id) : [...f.branchIds, id] });
  const save = async () => {
    setBusy(true); setErr(null);
    const body = {
      role: f.role, allBranches: f.allBranches, branchIds: f.allBranches ? [] : f.branchIds, isProfessional: f.isProfessional,
      license: f.license || null, color: f.isProfessional ? f.color : null,
      commissionPct: f.commissionPct === "" ? null : Number(f.commissionPct), active: f.active,
    };
    try {
      if (isNew) {
        const r = await api.post("/api/staff", { ...body, email: f.email, fullName: f.fullName });
        toast("Persona agregada");
        onSaved(r.temporaryPassword ? { email: f.email, password: r.temporaryPassword } : null);
      } else {
        await api.put(`/api/staff/${person.userId}`, body);
        toast("Cambios guardados");
        onSaved(null);
      }
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title={isNew ? "Agregar persona" : `Editar ${person.fullName}`} onClose={onClose} wide
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          {isNew && <Field label="Nombre completo"><input className="input" value={f.fullName} onChange={(e) => setF({ ...f, fullName: e.target.value })} /></Field>}
          {isNew && <Field label="Correo" hint="Será su usuario de ingreso"><input className="input" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></Field>}
          <Field label="Rol">
            <select className="input" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value, isProfessional: e.target.value === "dentist" ? true : f.isProfessional })}>
              {ROLE_OPTIONS.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </select>
          </Field>
          <Field label="Comisión (%)" hint="Opcional; base: producción realizada">
            <input className="input" type="number" min={0} max={100} step={0.5} value={f.commissionPct} onChange={(e) => setF({ ...f, commissionPct: e.target.value })} />
          </Field>
          <div className="span-2 stack-sm">
            <span className="label">Sucursales</span>
            <label className="check"><input type="checkbox" checked={f.allBranches} onChange={(e) => setF({ ...f, allBranches: e.target.checked })} />Acceso a todas las sucursales</label>
            {!f.allBranches && (
              <div className="row">
                {branches.map((b) => (
                  <label key={b.id} className="check badge" style={{ height: 32, padding: "0 12px" }}>
                    <input type="checkbox" checked={f.branchIds.includes(b.id)} onChange={() => toggleBranch(b.id)} />{b.name}
                  </label>
                ))}
              </div>
            )}
          </div>
          <label className="check span-2"><input type="checkbox" checked={f.isProfessional} onChange={(e) => setF({ ...f, isProfessional: e.target.checked })} />Atiende pacientes (aparece en la agenda y puede acceder al registro clínico)</label>
          {f.isProfessional && <Field label="Matrícula profesional"><input className="input" value={f.license} onChange={(e) => setF({ ...f, license: e.target.value })} /></Field>}
          {f.isProfessional && <Field label="Color en la agenda"><input className="input" type="color" value={f.color} onChange={(e) => setF({ ...f, color: e.target.value })} style={{ padding: 4, height: 40 }} /></Field>}
          {!isNew && <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activo (al desactivar se cierran sus sesiones)</label>}
        </div>
      </div>
    </Dialog>
  );
}

// ---------------- Horarios ----------------
interface Slot { branchId: string; weekday: number; start: string; end: string }

function SchedulesTab() {
  const toast = useToast();
  const staff = useApi<any[]>("/api/staff?professionals=1");
  const branches = useApi<any[]>("/api/branches");
  const [dentistId, setDentistId] = useState("");
  const sch = useApi<any[]>(dentistId ? `/api/schedules${qs({ dentistId })}` : null);
  const [slots, setSlots] = useState<Slot[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (sch.data) setSlots(sch.data.map((x) => ({ branchId: x.branchId, weekday: x.weekday, start: x.start, end: x.end })));
  }, [sch.data]);
  const dentist = staff.data?.find((d) => d.userId === dentistId);
  const allowedBranches = (branches.data ?? []).filter((b) => !dentist || dentist.allBranches || dentist.role === "owner" || dentist.branchIds.includes(b.id));
  const update = (i: number, patch: Partial<Slot>) => setSlots(slots.map((s, k) => (k === i ? { ...s, ...patch } : s)));
  const add = () => setSlots([...slots, { branchId: allowedBranches[0]?.id ?? "", weekday: 1, start: "08:00", end: "12:30" }]);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      await api.put(`/api/schedules/${dentistId}`, { slots });
      toast("Horario guardado"); sch.reload();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="card-head">
        <h2>Horario semanal</h2>
        <select className="input" style={{ maxWidth: 280 }} value={dentistId} onChange={(e) => setDentistId(e.target.value)} aria-label="Profesional">
          <option value="">Elegir profesional…</option>
          {staff.data?.map((d) => <option key={d.userId} value={d.userId}>{d.fullName}</option>)}
        </select>
      </div>
      <div className="card-pad stack">
        {!dentistId ? <Empty>Elige un profesional para ver y editar su horario.</Empty> : !sch.data ? <Loading /> : (
          <>
            {err && <div className="alert danger" role="alert">{err}</div>}
            <p className="muted small">El horario define cuándo se le pueden agendar citas en cada sucursal. No puede haber turnos superpuestos el mismo día, aunque sean en sucursales distintas.</p>
            {slots.length === 0 && <p className="muted">Sin turnos. Agrega el primero.</p>}
            {[...slots.map((s, i) => ({ s, i }))].sort((a, b) => a.s.weekday - b.s.weekday || a.s.start.localeCompare(b.s.start)).map(({ s, i }) => (
              <div key={i} className="row">
                <select className="input" style={{ width: 130 }} value={s.weekday} onChange={(e) => update(i, { weekday: Number(e.target.value) })} aria-label="Día">
                  {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{WEEKDAYS[d]}</option>)}
                </select>
                <select className="input" style={{ width: 190 }} value={s.branchId} onChange={(e) => update(i, { branchId: e.target.value })} aria-label="Sucursal">
                  {allowedBranches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </select>
                <input className="input" type="time" step={900} style={{ width: 115 }} value={s.start} onChange={(e) => update(i, { start: e.target.value })} aria-label="Desde" />
                <span>–</span>
                <input className="input" type="time" step={900} style={{ width: 115 }} value={s.end} onChange={(e) => update(i, { end: e.target.value })} aria-label="Hasta" />
                <button className="btn btn-ghost btn-icon btn-sm" onClick={() => setSlots(slots.filter((_, k) => k !== i))} aria-label="Quitar"><Trash2 size={15} /></button>
              </div>
            ))}
            <div className="row">
              <button className="btn" onClick={add} disabled={!allowedBranches.length}><Plus size={15} />Agregar turno</button>
              <button className="btn btn-primary" onClick={save} disabled={busy}>{busy ? "Guardando…" : "Guardar horario"}</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ---------------- Prestaciones ----------------
function ProceduresTab() {
  const p = useApi<any[]>("/api/procedures?all=1");
  const [edit, setEdit] = useState<any | null>(null);
  const [filter, setFilter] = useState("");
  const rows = (p.data ?? []).filter((x) => !filter || `${x.code} ${x.name} ${x.category}`.toLowerCase().includes(filter.toLowerCase()));
  return (
    <div className="stack">
      <div className="row-between">
        <input className="input" style={{ maxWidth: 300 }} placeholder="Filtrar por código, nombre o categoría" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="btn btn-primary" onClick={() => setEdit({})}><Plus size={16} />Nueva prestación</button>
      </div>
      <div className="card">
        {!p.data ? <Loading /> : rows.length === 0 ? <Empty>Sin prestaciones.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Código</th><th>Prestación</th><th className="hide-mobile">Categoría</th><th className="num">Precio</th><th className="hide-mobile num">Duración</th><th className="hide-mobile num">Control</th><th className="hide-mobile">Alcance</th><th>Estado</th><th /></tr></thead>
              <tbody>
                {rows.map((x) => (
                  <tr key={x.id}>
                    <td className="nowrap">{x.code}</td>
                    <td><b>{x.name}</b></td>
                    <td className="hide-mobile">{x.category}</td>
                    <td className="num">{bs(x.priceCents)}</td>
                    <td className="hide-mobile num">{x.durationMin} min</td>
                    <td className="hide-mobile num">{x.recallMonths ? `${x.recallMonths} ${x.recallMonths === 1 ? "mes" : "meses"}` : "—"}</td>
                    <td className="hide-mobile">{SCOPES.find((s) => s.id === x.scope)?.label ?? x.scope}</td>
                    <td>{x.active ? <span className="badge ok">Activa</span> : <span className="badge">Inactiva</span>}</td>
                    <td className="num"><button className="btn btn-sm" onClick={() => setEdit(x)}><Pencil size={14} />Editar</button></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
      {edit && <ProcedureDialog proc={edit} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); p.reload(); }} />}
    </div>
  );
}

function ProcedureDialog({ proc, onClose, onSaved }: { proc: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const isNew = !proc.id;
  const [f, setF] = useState({
    code: proc.code ?? "", name: proc.name ?? "", category: proc.category ?? "General",
    price: proc.priceCents != null ? toBsInput(proc.priceCents) : "", durationMin: proc.durationMin ?? 30,
    scope: proc.scope ?? "tooth", odontogramCondition: proc.odontogramCondition ?? "", active: proc.active ?? true,
    recallMonths: proc.recallMonths != null ? String(proc.recallMonths) : "",
  });
  const recallInvalid = f.recallMonths !== "" && !(/^\d+$/.test(f.recallMonths) && Number(f.recallMonths) >= 1 && Number(f.recallMonths) <= 60);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const priceCents = parseBs(String(f.price));
    if (!Number.isFinite(priceCents) || priceCents < 0) { setErr("Precio inválido"); return; }
    if (recallInvalid) return;
    setBusy(true); setErr(null);
    const body = {
      code: f.code, name: f.name, category: f.category, priceCents, durationMin: Number(f.durationMin), scope: f.scope,
      odontogramCondition: f.odontogramCondition || null, active: f.active,
      recallMonths: f.recallMonths === "" ? null : Number(f.recallMonths),
    };
    try {
      if (isNew) await api.post("/api/procedures", body); else await api.put(`/api/procedures/${proc.id}`, body);
      toast(isNew ? "Prestación creada" : "Prestación actualizada");
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title={isNew ? "Nueva prestación" : `Editar ${proc.name}`} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        {!isNew && <div className="alert info small">Cambiar el precio no modifica presupuestos ya emitidos; el cambio queda en la auditoría.</div>}
        <div className="form-grid">
          <Field label="Código"><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} /></Field>
          <Field label="Categoría"><input className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} /></Field>
          <Field label="Nombre" span2><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Precio (Bs)"><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="0,00" /></Field>
          <Field label="Duración (min)"><input className="input" type="number" min={5} max={480} step={5} value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: Number(e.target.value) })} /></Field>
          <Field label="Se aplica a">
            <select className="input" value={f.scope} onChange={(e) => setF({ ...f, scope: e.target.value })}>
              {SCOPES.map((s) => <option key={s.id} value={s.id}>{s.label}</option>)}
            </select>
          </Field>
          <Field label="Marca en el odontograma al realizarse">
            <select className="input" value={f.odontogramCondition} onChange={(e) => setF({ ...f, odontogramCondition: e.target.value })}>
              {CONDITIONS.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Próximo control (meses)" hint="Al marcar la cita como atendida se propone el control a estos meses. Vacío = no se propone un intervalo propio (se sugieren 6).">
            <input className="input" type="number" min={1} max={60} inputMode="numeric" value={f.recallMonths} aria-invalid={recallInvalid}
              onChange={(e) => setF({ ...f, recallMonths: e.target.value })} placeholder="Sin control" />
          </Field>
          {recallInvalid && <div className="alert danger small span-2" role="alert">El intervalo del control debe ser un número entero entre 1 y 60 meses.</div>}
          <label className="check span-2"><input type="checkbox" checked={f.active} onChange={(e) => setF({ ...f, active: e.target.checked })} />Activa (disponible para presupuestos y citas)</label>
        </div>
        {!isNew && <SessionTemplateEditor procedure={proc} />}
        {!isNew && <StandardConsumptionEditor procedureId={proc.id} />}
      </div>
    </Dialog>
  );
}

// ---------------- Auditoría ----------------
function AuditTab() {
  const [rows, setRows] = useState<any[] | null>(null);
  const [more, setMore] = useState(true);
  const [busy, setBusy] = useState(false);
  const [entity, setEntity] = useState("");
  const load = async (before?: number, reset = false) => {
    setBusy(true);
    try {
      const r = await api.get<any[]>(`/api/audit${qs({ limit: 100, before, entity: entity || undefined })}`);
      setRows((cur) => (reset || !cur ? r : [...cur, ...r]));
      setMore(r.length === 100);
    } finally { setBusy(false); }
  };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(undefined, true); }, [entity]);
  return (
    <div className="card">
      <div className="card-head">
        <div><h2>Registro de auditoría</h2><p className="muted small">Inmutable: nadie puede editarlo ni borrarlo.</p></div>
        <select className="input" style={{ maxWidth: 200 }} value={entity} onChange={(e) => setEntity(e.target.value)} aria-label="Filtrar por entidad">
          <option value="">Todas las entidades</option>
          {["patient", "appointment", "budget", "budget_item", "payment", "charge", "user", "branch", "procedure", "clinic", "assistant"].map((x) => <option key={x} value={x}>{x}</option>)}
        </select>
      </div>
      {!rows ? <Loading /> : rows.length === 0 ? <Empty>Sin eventos.</Empty> : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Fecha</th><th>Usuario</th><th>Acción</th><th className="hide-mobile">Entidad</th><th className="hide-mobile">Detalle</th></tr></thead>
            <tbody>
              {rows.map((r) => {
                const data = JSON.stringify(r.data ?? {});
                return (
                  <tr key={r.id}>
                    <td className="nowrap small">{fmtDateTime(r.createdAt)}</td>
                    <td>{r.userName ?? "Sistema"}</td>
                    <td><code className="small">{r.action}</code></td>
                    <td className="hide-mobile small">{r.entity}{r.entityId ? <span className="muted"> · {String(r.entityId).slice(0, 8)}</span> : null}</td>
                    <td className="hide-mobile small muted" title={data} style={{ maxWidth: 360, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{data === "{}" ? "—" : data}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {rows && more && (
        <div className="card-pad"><button className="btn" disabled={busy} onClick={() => load(rows[rows.length - 1]?.id)}>{busy ? "Cargando…" : "Cargar más"}</button></div>
      )}
    </div>
  );
}

// ---------------- Seguridad (solo propietario) ----------------
function SecurityTab() {
  const toast = useToast();
  const c = useApi<any>("/api/clinic");
  const [roles, setRoles] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (c.data && roles === null) setRoles(c.data.mfaRequiredRoles ?? []); }, [c.data, roles]);
  if (!c.data || roles === null) return <div className="card"><Loading /></div>;
  const toggle = (id: string) => setRoles(roles.includes(id) ? roles.filter((r) => r !== id) : [...roles, id]);
  const save = async () => {
    setBusy(true);
    try {
      await api.patch("/api/clinic", { mfaRequiredRoles: roles });
      toast("Política de verificación en dos pasos guardada");
      c.reload();
    } catch (e: any) { toast(e.message, true); } finally { setBusy(false); }
  };
  const recommended = ["owner", "admin", "accountant"];
  return (
    <div className="grid grid-2">
      <div className="card">
        <div className="card-head"><h2>Verificación en dos pasos obligatoria</h2></div>
        <div className="card-pad stack">
          <Field label="Roles que deben usar verificación en dos pasos" group>
            <div className="stack-sm">
              {ROLE_OPTIONS.map((r) => (
                <label key={r.id} className="check">
                  <input type="checkbox" checked={roles.includes(r.id)} onChange={() => toggle(r.id)} />
                  {r.label}{recommended.includes(r.id) && <span className="badge brand" style={{ marginLeft: 6 }}>Recomendado</span>}
                </label>
              ))}
            </div>
          </Field>
          <div className="row">
            <button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Guardar política"}</button>
            <button className="btn btn-ghost" onClick={() => setRoles([...new Set([...roles, ...recommended])])}>Marcar recomendados</button>
          </div>
        </div>
      </div>
      <div className="card card-pad stack-sm">
        <h2>¿Qué pasa al activarla?</h2>
        <p>Las personas con los roles marcados que todavía no tengan la verificación en dos pasos activa verán, en su <b>próxima acción</b>, una pantalla que les pide activarla con una app autenticadora (Google Authenticator, Microsoft Authenticator u otra). Hasta hacerlo no podrán usar el sistema.</p>
        <p>Después, cada ingreso pedirá la contraseña y un código de 6 dígitos del celular. Al activarla reciben 10 códigos de recuperación de un solo uso para cuando no tengan el celular.</p>
        <p className="muted small">Recomendamos exigirla al menos a propietario, administración y contabilidad, porque acceden a datos financieros y a la gestión del personal. Si alguien pierde su celular y sus códigos, el soporte de la plataforma puede restablecerla tras verificar su identidad.</p>
      </div>
    </div>
  );
}

// ---------------- Consentimientos ----------------
const CONSENT_KINDS: { id: string; label: string }[] = [
  { id: "data_processing", label: "Tratamiento de datos personales y de salud" },
  { id: "reminders", label: "Recordatorios por WhatsApp/SMS" },
  { id: "marketing", label: "Promociones y novedades" },
  { id: "informed_consent", label: "Consentimiento informado" },
];

function ConsentsTab() {
  const toast = useToast();
  const t = useApi<any[]>("/api/consent-templates?all=1");
  const [edit, setEdit] = useState<{ mode: "new" | "version"; tpl?: any } | null>(null);
  const setActive = async (tpl: any, active: boolean) => {
    try { await api.post(`/api/consent-templates/${tpl.id}/active`, { active }); toast(active ? "Plantilla activada" : "Plantilla desactivada"); t.reload(); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="stack">
      <div className="alert warn small stack-sm">
        <b>Textos modelo: deben ser revisados por la asesoría legal de la clínica antes de usarse con pacientes.</b>
        <span>Puedes usar los marcadores <code>{"{paciente}"}</code>, <code>{"{clinica}"}</code>, <code>{"{procedimiento}"}</code> y <code>{"{fecha}"}</code>; se reemplazan al firmar. Modificar un texto crea una <b>versión nueva</b>: la anterior se conserva intacta porque los documentos ya firmados guardan una copia exacta del texto que se aceptó.</span>
      </div>
      <div className="row-between">
        <p className="muted">{t.data?.filter((x) => x.active).length ?? 0} plantillas vigentes</p>
        <button className="btn btn-primary" onClick={() => setEdit({ mode: "new" })}><Plus size={16} />Nueva plantilla</button>
      </div>
      {!t.data ? <div className="card"><Loading /></div> : t.data.length === 0 ? <div className="card"><Empty>Sin plantillas.</Empty></div> : (
        CONSENT_KINDS.filter((k) => t.data!.some((x) => x.kind === k.id)).map((k) => (
          <div key={k.id} className="card">
            <div className="card-head"><h2>{k.label}</h2></div>
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Título</th><th className="hide-mobile">Categoría</th><th className="num">Versión</th><th className="hide-mobile">Creada</th><th>Estado</th><th /></tr></thead>
                <tbody>
                  {t.data!.filter((x) => x.kind === k.id).map((x) => (
                    <tr key={x.id}>
                      <td><b>{x.title}</b></td>
                      <td className="hide-mobile">{x.category ?? "—"}</td>
                      <td className="num">v{x.version}</td>
                      <td className="hide-mobile small">{fmtDateTime(x.createdAt)}</td>
                      <td>{x.active ? <span className="badge ok">Vigente</span> : <span className="badge">Inactiva</span>}</td>
                      <td className="num nowrap">
                        {x.active && <button className="btn btn-sm" onClick={() => setEdit({ mode: "version", tpl: x })}><Pencil size={14} />Nueva versión</button>}{" "}
                        <button className="btn btn-sm btn-ghost" onClick={() => setActive(x, !x.active)}>{x.active ? "Desactivar" : "Activar"}</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ))
      )}
      {edit && <ConsentTemplateDialog mode={edit.mode} tpl={edit.tpl} onClose={() => setEdit(null)} onSaved={() => { setEdit(null); t.reload(); }} />}
    </div>
  );
}

function ConsentTemplateDialog({ mode, tpl, onClose, onSaved }: { mode: "new" | "version"; tpl?: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ kind: tpl?.kind ?? "informed_consent", title: tpl?.title ?? "", body: tpl?.body ?? "", category: tpl?.category ?? "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setErr(null);
    if (f.title.trim().length < 3) return setErr("El título debe tener al menos 3 caracteres");
    if (f.body.trim().length < 20) return setErr("El texto debe tener al menos 20 caracteres");
    setBusy(true);
    try {
      const r = await api.post<{ id: string; version: number }>("/api/consent-templates", { kind: f.kind, title: f.title.trim(), body: f.body, category: f.category || null });
      toast(`Plantilla guardada (versión ${r.version})`);
      onSaved();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog wide title={mode === "version" ? `Nueva versión: ${tpl?.title}` : "Nueva plantilla de consentimiento"} onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : mode === "version" ? `Guardar como v${(tpl?.version ?? 0) + 1}` : "Crear plantilla"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        {mode === "version" && <div className="alert info small">La versión v{tpl?.version} dejará de estar vigente para nuevas firmas, pero se conserva para los documentos ya firmados.</div>}
        <div className="form-grid">
          <Field label="Tipo">
            <select className="input" value={f.kind} disabled={mode === "version"} onChange={(e) => setF({ ...f, kind: e.target.value })}>
              {CONSENT_KINDS.map((k) => <option key={k.id} value={k.id}>{k.label}</option>)}
            </select>
          </Field>
          <Field label="Categoría (opcional)" hint="Ej.: Cirugía, Endodoncia, Ortodoncia">
            <input className="input" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
          </Field>
          <Field label="Título" span2 hint={mode === "version" ? "El título identifica la plantilla: no cambia entre versiones." : undefined}>
            <input className="input" value={f.title} readOnly={mode === "version"} onChange={(e) => setF({ ...f, title: e.target.value })} />
          </Field>
          <Field label="Texto" span2 hint="Marcadores disponibles: {paciente}, {clinica}, {procedimiento}, {fecha}">
            <textarea className="input" style={{ minHeight: 320, fontFamily: "inherit" }} value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
          </Field>
        </div>
      </div>
    </Dialog>
  );
}
