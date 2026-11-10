import { useState } from "react";
import { KeyRound, Plus, ShieldOff } from "lucide-react";
import { useApi } from "../lib/hooks";
import { api } from "../lib/api";
import { bs, fmtDate, fmtDateTime, parseBs } from "../lib/format";
import { Dialog, Empty, Field, Loading, useToast } from "../components/ui";

const STATUS: Record<string, { label: string; tone: string }> = {
  trial: { label: "Prueba", tone: "info" },
  active: { label: "Activa", tone: "ok" },
  suspended: { label: "Suspendida", tone: "warn" },
  cancelled: { label: "Cancelada", tone: "danger" },
};

export function PlatformPage() {
  const toast = useToast();
  const clinics = useApi<any[]>("/api/platform/clinics");
  const plans = useApi<any[]>("/api/platform/plans");
  const [creating, setCreating] = useState(false);
  const [creatingPlan, setCreatingPlan] = useState(false);
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const patch = async (id: string, body: Record<string, unknown>) => {
    try { await api.patch(`/api/platform/clinics/${id}`, body); toast("Clínica actualizada"); clinics.reload(); }
    catch (e: any) { toast(e.message, true); }
  };
  return (
    <div className="stack" style={{ gap: 18 }}>
      <div className="page-head">
        <div><h1>Plataforma SaaS</h1><p className="sub">Clínicas, planes y suscripciones</p></div>
        <div className="row">
          <button className="btn" onClick={() => setCreatingPlan(true)}><Plus size={16} />Nuevo plan</button>
          <button className="btn btn-primary" onClick={() => setCreating(true)}><Plus size={16} />Nueva clínica</button>
        </div>
      </div>
      <div className="alert info small">Este panel muestra solo métricas agregadas (conteos). Por diseño no da acceso a datos de pacientes ni a información clínica de las clínicas.</div>
      {created && (
        <div className="alert warn stack-sm" role="alert">
          <div className="row"><KeyRound size={18} /><b>Contraseña temporal del propietario ({created.email})</b></div>
          <code style={{ fontSize: 18, fontWeight: 700, userSelect: "all" }}>{created.password}</code>
          <span className="small">Se muestra una sola vez. Entrégala por un canal seguro y pide que la cambie al primer ingreso.</span>
          <button className="btn btn-sm" style={{ alignSelf: "flex-start" }} onClick={() => setCreated(null)}>Ya la entregué</button>
        </div>
      )}

      <div className="card">
        <div className="card-head"><h2>Clínicas</h2><span className="muted small">{clinics.data?.length ?? 0} registradas</span></div>
        {!clinics.data ? <Loading /> : clinics.data.length === 0 ? <Empty>No hay clínicas todavía.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Clínica</th><th>Plan</th><th>Estado</th><th className="num">Sucursales</th><th className="num">Usuarios</th><th className="num hide-mobile">Pacientes</th><th className="num hide-mobile">Citas 30 d</th><th className="hide-mobile">Última actividad</th></tr></thead>
              <tbody>
                {clinics.data.map((c) => (
                  <tr key={c.id}>
                    <td><b>{c.name}</b><div className="muted small">{c.slug} · desde {fmtDate(c.createdAt)}</div></td>
                    <td>
                      <select className="input" style={{ minWidth: 140 }} value={c.planCode ?? ""} onChange={(e) => e.target.value && patch(c.id, { planCode: e.target.value })} aria-label={`Plan de ${c.name}`}>
                        {!c.planName && <option value="">Sin plan</option>}
                        {plans.data?.map((p) => <option key={p.id} value={p.code}>{p.name}</option>)}
                      </select>
                    </td>
                    <td>
                      <select className="input" style={{ minWidth: 130 }} value={c.status} onChange={(e) => patch(c.id, { status: e.target.value })} aria-label={`Estado de ${c.name}`}>
                        {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
                      </select>
                    </td>
                    <td className="num">{c.branches}{c.maxBranches ? <span className="muted"> / {c.maxBranches}</span> : null}</td>
                    <td className="num">{c.users}{c.maxUsers ? <span className="muted"> / {c.maxUsers}</span> : null}</td>
                    <td className="num hide-mobile">{c.patients}</td>
                    <td className="num hide-mobile">{c.appointments30d}</td>
                    <td className="hide-mobile small">{c.lastActivityAt ? fmtDateTime(c.lastActivityAt) : <span className="muted">Sin actividad</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="card">
        <div className="card-head"><h2>Planes</h2></div>
        {!plans.data ? <Loading /> : plans.data.length === 0 ? <Empty>Sin planes.</Empty> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Plan</th><th>Código</th><th className="num">Sucursales</th><th className="num">Usuarios</th><th className="num hide-mobile">Pacientes</th><th className="num">Precio mensual</th><th>Estado</th></tr></thead>
              <tbody>
                {plans.data.map((p) => (
                  <tr key={p.id}>
                    <td><b>{p.name}</b></td><td><code className="small">{p.code}</code></td>
                    <td className="num">{p.maxBranches}</td><td className="num">{p.maxUsers}</td>
                    <td className="num hide-mobile">{p.maxPatients ?? "Ilimitados"}</td>
                    <td className="num">{p.priceCents ? bs(p.priceCents) : "A convenir"}</td>
                    <td>{p.active ? <span className="badge ok">Activo</span> : <span className="badge">Inactivo</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ResetMfaTool />

      {creating && (
        <CreateClinicDialog plans={plans.data ?? []} onClose={() => setCreating(false)}
          onCreated={(r) => { setCreating(false); clinics.reload(); if (r) setCreated(r); }} />
      )}
      {creatingPlan && <CreatePlanDialog onClose={() => setCreatingPlan(false)} onCreated={() => { setCreatingPlan(false); plans.reload(); }} />}
    </div>
  );
}

function CreateClinicDialog({ plans, onClose, onCreated }: { plans: any[]; onClose: () => void; onCreated: (pw: { email: string; password: string } | null) => void }) {
  const toast = useToast();
  const [f, setF] = useState({ name: "", slug: "", planCode: plans[0]?.code ?? "", ownerEmail: "", ownerName: "", seedCatalog: true, trialDays: 30 });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const slugify = (s: string) => s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40);
  const save = async () => {
    setBusy(true); setErr(null);
    try {
      const r = await api.post("/api/platform/clinics", { ...f, trialDays: Number(f.trialDays) });
      toast("Clínica creada");
      onCreated(r.temporaryPassword ? { email: f.ownerEmail, password: r.temporaryPassword } : null);
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Nueva clínica" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Creando…" : "Crear clínica"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Nombre de la clínica" span2><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value, slug: f.slug && f.slug !== slugify(f.name) ? f.slug : slugify(e.target.value) })} /></Field>
          <Field label="Identificador (slug)" hint="Minúsculas, números y guiones"><input className="input" value={f.slug} onChange={(e) => setF({ ...f, slug: e.target.value })} /></Field>
          <Field label="Plan">
            <select className="input" value={f.planCode} onChange={(e) => setF({ ...f, planCode: e.target.value })}>
              {plans.map((p) => <option key={p.id} value={p.code}>{p.name} ({p.maxBranches} suc.)</option>)}
            </select>
          </Field>
          <Field label="Nombre del propietario"><input className="input" value={f.ownerName} onChange={(e) => setF({ ...f, ownerName: e.target.value })} /></Field>
          <Field label="Correo del propietario"><input className="input" type="email" value={f.ownerEmail} onChange={(e) => setF({ ...f, ownerEmail: e.target.value })} /></Field>
          <Field label="Días de prueba"><input className="input" type="number" min={0} max={90} value={f.trialDays} onChange={(e) => setF({ ...f, trialDays: Number(e.target.value) })} /></Field>
          <label className="check span-2"><input type="checkbox" checked={f.seedCatalog} onChange={(e) => setF({ ...f, seedCatalog: e.target.checked })} />Cargar el catálogo inicial de prestaciones (precios referenciales en Bs)</label>
        </div>
      </div>
    </Dialog>
  );
}

function CreatePlanDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ code: "", name: "", maxBranches: 1, maxUsers: 5, maxPatients: "", price: "" });
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    const priceCents = f.price ? parseBs(f.price) : 0;
    if (!Number.isFinite(priceCents) || priceCents < 0) { setErr("Precio inválido"); return; }
    setBusy(true); setErr(null);
    try {
      await api.post("/api/platform/plans", { code: f.code, name: f.name, maxBranches: Number(f.maxBranches), maxUsers: Number(f.maxUsers), maxPatients: f.maxPatients ? Number(f.maxPatients) : null, priceCents });
      toast("Plan creado"); onCreated();
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <Dialog title="Nuevo plan" onClose={onClose}
      footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={busy} onClick={save}>{busy ? "Guardando…" : "Crear plan"}</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Código" hint="Ej.: red-5"><input className="input" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toLowerCase() })} /></Field>
          <Field label="Nombre"><input className="input" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></Field>
          <Field label="Máx. sucursales"><input className="input" type="number" min={1} value={f.maxBranches} onChange={(e) => setF({ ...f, maxBranches: Number(e.target.value) })} /></Field>
          <Field label="Máx. usuarios"><input className="input" type="number" min={1} value={f.maxUsers} onChange={(e) => setF({ ...f, maxUsers: Number(e.target.value) })} /></Field>
          <Field label="Máx. pacientes" hint="Vacío = ilimitados"><input className="input" type="number" min={1} value={f.maxPatients} onChange={(e) => setF({ ...f, maxPatients: e.target.value })} /></Field>
          <Field label="Precio mensual (Bs)"><input className="input" inputMode="decimal" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} placeholder="0,00" /></Field>
        </div>
      </div>
    </Dialog>
  );
}

function ResetMfaTool() {
  const toast = useToast();
  const [userId, setUserId] = useState("");
  const [email, setEmail] = useState("");
  const [found, setFound] = useState<any | null>(null);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const valid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(userId.trim());
  const lookup = async () => {
    setErr(null); setFound(null); setUserId("");
    try {
      const r = await api.get<any[]>(`/api/platform/users?email=${encodeURIComponent(email.trim())}`);
      if (!r.length) return setErr("No hay un usuario con ese correo");
      setFound(r[0]); setUserId(r[0].id);
    } catch (e: any) { setErr(e.message); }
  };
  const run = async () => {
    setErr(null);
    if (!valid) return setErr("Ingresa un identificador de usuario válido (UUID)");
    if (reason.trim().length < 5) return setErr("Describe el motivo y cómo verificaste la identidad");
    if (!window.confirm("¿Quitar la verificación en dos pasos de este usuario? Se cerrarán todas sus sesiones.")) return;
    setBusy(true);
    try {
      await api.post(`/api/platform/users/${userId.trim()}/reset-mfa`, { reason: reason.trim() });
      toast("Verificación en dos pasos restablecida");
      setUserId(""); setReason("");
    } catch (e: any) { setErr(e.message); } finally { setBusy(false); }
  };
  return (
    <div className="card">
      <div className="card-head"><h2>Restablecer verificación en dos pasos</h2></div>
      <div className="card-pad stack">
        <div className="alert warn small">Úsalo solo si la persona perdió su celular y sus códigos de recuperación. <b>Verifica su identidad antes</b> (por ejemplo, confirmación del propietario de la clínica por un canal conocido). La acción queda registrada en la auditoría con el motivo.</div>
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Correo del usuario" group>
            <div className="row" style={{ flexWrap: "nowrap" }}><input className="input" aria-label="Correo del usuario" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /><button type="button" className="btn" onClick={lookup} disabled={email.trim().length < 3}>Buscar</button></div>
          </Field>
          <Field label="Motivo y verificación realizada"><input className="input" value={reason} onChange={(e) => setReason(e.target.value)} /></Field>
        </div>
        {found && <div className="alert info small"><b>{found.fullName}</b> · {found.email} · 2 pasos: {found.mfaEnabled ? "activa" : "inactiva"} · Clínicas: {found.clinics.map((c: any) => `${c.clinic} (${c.role})`).join(", ") || "ninguna"}</div>}
        <button className="btn btn-danger" style={{ alignSelf: "flex-start" }} disabled={busy || !valid || !found?.mfaEnabled} onClick={run}><ShieldOff size={15} />{busy ? "Procesando…" : "Restablecer"}</button>
      </div>
    </div>
  );
}
