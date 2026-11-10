import { useState } from "react";
import { AlertOctagon, CheckCircle2, Download, Sparkles, Thermometer } from "lucide-react";
import { useAuth } from "../lib/auth";
import { useApi } from "../lib/hooks";
import { api, qs } from "../lib/api";
import { fmtDateTime, fmtTime, localDate } from "../lib/format";
import { Dialog, Empty, Field, Loading, Tabs, useToast } from "../components/ui";

const TASKS: { id: string; label: string; short: string }[] = [
  { id: "between_patients", label: "Limpieza entre pacientes", short: "Entre pacientes" },
  { id: "start_of_day", label: "Apertura del consultorio", short: "Apertura" },
  { id: "end_of_day", label: "Cierre del consultorio", short: "Cierre" },
  { id: "deep_disinfection", label: "Desinfección profunda", short: "Desinf. profunda" },
];
const AREAS = ["Sala de espera", "Baños", "Recepción", "Sala de esterilización", "Pasillos"];
const AREA_TASKS = [
  { id: "end_of_day", label: "Limpieza general" },
  { id: "deep_disinfection", label: "Desinfección profunda" },
  { id: "waste_disposal", label: "Retiro de residuos" },
  { id: "spill", label: "Derrame / contingencia" },
];

export function BiosafetyPage() {
  const { me, branchId: sel, setBranchId, can } = useAuth();
  const branchId = sel ?? me?.branches[0]?.id ?? null;
  const [tab, setTab] = useState<"limpieza" | "esterilizacion">("limpieza");
  const today = useApi<any>(branchId ? `/api/biosafety/today${qs({ branchId })}` : null);
  if (!branchId) return <Empty>Selecciona una sucursal.</Empty>;
  const d = today.data;
  return (
    <div className="stack">
      <div className="page-head">
        <div>
          <h1>Bioseguridad</h1>
          <div className="row" style={{ marginTop: 4 }}>
            {me && me.branches.length > 1 ? (
              <select className="input" style={{ width: "auto", minHeight: 32, padding: "4px 8px" }} aria-label="Sucursal" value={branchId} onChange={(e) => setBranchId(e.target.value)}>
                {me.branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            ) : <span className="sub">{me?.branches[0]?.name}</span>}
            <span className="muted">{localDate() === d?.date ? "Hoy" : d?.date}</span>
          </div>
        </div>
      </div>

      {d?.sterilization.failed.length > 0 && (
        <div className="alert danger stack-sm" role="alert">
          <b className="row"><AlertOctagon size={18} />Ciclos de esterilización con indicador fallido (últimos 30 días)</b>
          {d.sterilization.failed.map((f: any) => (
            <span key={f.id}>{f.sterilizer} · ciclo N° {f.cycleNumber} · {fmtDateTime(f.runAt)} · carga: {f.load} — {f.bio === "fail" ? "indicador biológico POSITIVO: rastrear pacientes y suspender el equipo" : "indicador químico fallido: reprocesar la carga"}</span>
          ))}
        </div>
      )}

      <Tabs value={tab} onChange={setTab} items={[{ id: "limpieza", label: "Limpieza" }, { id: "esterilizacion", label: `Esterilización${d?.sterilization.pendingBio ? ` (${d.sterilization.pendingBio} por leer)` : ""}` }]} />
      {tab === "limpieza" && (!d ? <Loading /> : <Cleaning branchId={branchId} data={d} reload={today.reload} canWrite={can("biosafety.write")} />)}
      {tab === "esterilizacion" && <Sterilization branchId={branchId} canWrite={can("biosafety.write")} canManage={can("clinic.manage")} onChange={today.reload} />}
    </div>
  );
}

function Cleaning({ branchId, data, reload, canWrite }: { branchId: string; data: any; reload: () => void; canWrite: boolean }) {
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [area, setArea] = useState(AREAS[0]!);
  const log = async (body: Record<string, unknown>, key: string, label: string) => {
    setBusy(key);
    try { await api.post("/api/biosafety/cleanings", { branchId, ...body }); toast(`Registrado: ${label}`); reload(); }
    catch (e) { toast((e as Error).message, true); }
    finally { setBusy(null); }
  };
  return (
    <div className="stack">
      {data.chairs.length === 0 && <Empty>Esta sucursal no tiene consultorios registrados.</Empty>}
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))" }}>
        {data.chairs.map((ch: any) => (
          <section key={ch.chairId} className="card card-pad stack" aria-label={ch.name}>
            <div className="row-between">
              <h2>{ch.name}</h2>
              {ch.betweenPending > 0 ? <span className="badge warn">{ch.betweenPending} limpieza(s) pendiente(s)</span> : <span className="badge ok"><CheckCircle2 size={13} />Al día</span>}
            </div>
            <div className="row small">
              <span className={`badge ${ch.startDone ? "ok" : ""}`}>Apertura {ch.startDone ? "✓" : "—"}</span>
              <span className="badge">Entre pacientes {ch.betweenDone}/{ch.patientsSeen}</span>
              <span className={`badge ${ch.endDone ? "ok" : ""}`}>Cierre {ch.endDone ? "✓" : "—"}</span>
            </div>
            {ch.lastAt && <span className="muted small">Última: {fmtTime(ch.lastAt)} · {ch.lastBy}</span>}
            {canWrite && (
              <div className="grid" style={{ gridTemplateColumns: "1fr 1fr", gap: 8 }}>
                {TASKS.map((t) => (
                  <button key={t.id} className={`btn ${t.id === "between_patients" ? "btn-primary" : ""}`} style={{ minHeight: 48 }}
                    disabled={busy === ch.chairId + t.id} onClick={() => log({ chairId: ch.chairId, task: t.id }, ch.chairId + t.id, `${t.label} · ${ch.name}`)}>
                    {t.short}
                  </button>
                ))}
              </div>
            )}
          </section>
        ))}
      </div>
      <section className="card card-pad stack">
        <h2 className="row"><Sparkles size={18} />Áreas comunes</h2>
        {canWrite && (
          <div className="row">
            <Field label="Área"><select className="input" value={area} onChange={(e) => setArea(e.target.value)}>{AREAS.map((a) => <option key={a}>{a}</option>)}</select></Field>
            <div className="row" style={{ alignSelf: "flex-end" }}>
              {AREA_TASKS.map((t) => <button key={t.id} className="btn" style={{ minHeight: 44 }} disabled={busy === area + t.id} onClick={() => log({ area, task: t.id }, area + t.id, `${t.label} · ${area}`)}>{t.label}</button>)}
            </div>
          </div>
        )}
        {data.areaLogs.length ? (
          <div className="table-wrap"><table className="table"><tbody>
            {data.areaLogs.map((l: any) => <tr key={l.id}><td className="nowrap">{fmtTime(l.doneAt)}</td><td>{l.area}</td><td>{l.taskLabel}</td><td className="muted">{l.doneBy}</td></tr>)}
          </tbody></table></div>
        ) : <p className="muted small">Sin registros de áreas comunes hoy.</p>}
      </section>
    </div>
  );
}

function Sterilization({ branchId, canWrite, canManage, onChange }: { branchId: string; canWrite: boolean; canManage: boolean; onChange: () => void }) {
  const toast = useToast();
  const sts = useApi<any[]>(`/api/biosafety/sterilizers${qs({ branchId })}`);
  const cycles = useApi<any[]>(`/api/biosafety/cycles${qs({ branchId })}`);
  const [form, setForm] = useState(false);
  const [bio, setBio] = useState<any | null>(null);
  const [newSt, setNewSt] = useState("");
  const reload = () => { cycles.reload(); sts.reload(); onChange(); };
  const addSterilizer = async () => {
    try { await api.post("/api/biosafety/sterilizers", { branchId, name: newSt }); setNewSt(""); sts.reload(); toast("Equipo registrado"); } catch (e) { toast((e as Error).message, true); }
  };
  const active = (sts.data ?? []).filter((s) => s.active);
  return (
    <div className="stack">
      <div className="row-between">
        <div className="row">
          {canWrite && active.length > 0 && <button className="btn btn-primary" onClick={() => setForm(true)}><Thermometer size={16} />Registrar ciclo</button>}
          <a className="btn" href={`/api/biosafety/cycles.xlsx${qs({ branchId })}`}><Download size={16} />Libro de esterilización (Excel)</a>
        </div>
        {canManage && (
          <div className="row">
            <input className="input" style={{ width: 200 }} aria-label="Nombre del nuevo equipo" placeholder="Nuevo equipo (p. ej. Autoclave 1)" value={newSt} onChange={(e) => setNewSt(e.target.value)} />
            <button className="btn" disabled={newSt.trim().length < 2} onClick={addSterilizer}>Agregar equipo</button>
          </div>
        )}
      </div>
      {sts.data && active.length === 0 && <div className="alert info">No hay equipos de esterilización registrados en esta sucursal{canManage ? ": agrega uno." : ". Pide a administración que lo registre."}</div>}
      <div className="card">
        {!cycles.data ? <Loading /> : cycles.data.length ? (
          <div className="table-wrap"><table className="table">
            <thead><tr><th>Fecha</th><th>Equipo · ciclo</th><th className="hide-mobile">Programa</th><th className="hide-mobile">Carga</th><th>Químico</th><th>Biológico</th><th className="hide-mobile">Operador</th></tr></thead>
            <tbody>{cycles.data.map((c) => (
              <tr key={c.id} style={c.chemicalIndicator === "fail" || c.bioResult === "fail" ? { background: "var(--danger-soft)" } : undefined}>
                <td className="nowrap">{fmtDateTime(c.runAt)}</td>
                <td><b>{c.sterilizer}</b> · N° {c.cycleNumber}</td>
                <td className="hide-mobile">{c.temperatureC ? `${Number(c.temperatureC)} °C` : c.programLabel}{c.durationMin ? ` · ${c.durationMin} min` : ""}</td>
                <td className="hide-mobile">{c.loadDescription} ({c.packages} paq.)</td>
                <td><span className={`badge ${c.chemicalIndicator === "pass" ? "ok" : "danger"}`}>{c.chemicalIndicator === "pass" ? "Correcto" : "Falló"}</span></td>
                <td>{c.bioResult ? <span className={`badge ${c.bioResult === "pass" ? "ok" : "danger"}`}>{c.bioResult === "pass" ? "Negativo (OK)" : "POSITIVO"}</span>
                  : canWrite ? <button className="btn btn-sm" onClick={() => setBio(c)}>Registrar</button> : <span className="badge warn">Pendiente</span>}</td>
                <td className="hide-mobile">{c.operator}</td>
              </tr>))}
            </tbody></table></div>
        ) : <Empty>Sin ciclos registrados en los últimos 30 días.</Empty>}
      </div>
      {form && <CycleDialog sterilizers={active} onClose={() => setForm(false)} onSaved={() => { setForm(false); reload(); }} />}
      {bio && <BioDialog cycle={bio} onClose={() => setBio(null)} onSaved={() => { setBio(null); reload(); }} />}
    </div>
  );
}

function CycleDialog({ sterilizers, onClose, onSaved }: { sterilizers: any[]; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [f, setF] = useState({ sterilizerId: sterilizers[0]?.id ?? "", program: "134C", temperatureC: "134", durationMin: "18", loadDescription: "", packages: "1", chemicalIndicator: "", expiresOn: "" });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [err, setErr] = useState<string | null>(null);
  const save = async () => {
    const e: Record<string, string> = {};
    if (f.loadDescription.trim().length < 2) e.loadDescription = "Describe qué se esterilizó";
    if (!f.chemicalIndicator) e.chemicalIndicator = "Indica el resultado del indicador químico";
    if (Number(f.packages) < 1) e.packages = "Mínimo 1";
    setErrors(e);
    if (Object.keys(e).length) return;
    try {
      const r = await api.post("/api/biosafety/cycles", {
        sterilizerId: f.sterilizerId, program: f.program, temperatureC: f.temperatureC ? Number(f.temperatureC) : null, durationMin: f.durationMin ? Number(f.durationMin) : null,
        loadDescription: f.loadDescription, packages: Number(f.packages), chemicalIndicator: f.chemicalIndicator, expiresOn: f.expiresOn || null,
      });
      toast(r.alert ?? `Ciclo N° ${r.cycleNumber} registrado`, !!r.alert);
      onSaved();
    } catch (x) { setErr((x as Error).message); }
  };
  return (
    <Dialog title="Registrar ciclo de esterilización" onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" onClick={save}>Guardar ciclo</button></>}>
      <div className="stack">
        {err && <div className="alert danger" role="alert">{err}</div>}
        <div className="form-grid">
          <Field label="Equipo"><select className="input" value={f.sterilizerId} onChange={(e) => setF({ ...f, sterilizerId: e.target.value })}>{sterilizers.map((s) => <option key={s.id} value={s.id}>{s.name} (último ciclo: {s.lastCycle ?? "—"})</option>)}</select></Field>
          <Field label="Programa"><select className="input" value={f.program} onChange={(e) => setF({ ...f, program: e.target.value, temperatureC: e.target.value === "121C" ? "121" : e.target.value === "134C" ? "134" : f.temperatureC })}><option value="134C">134 °C</option><option value="121C">121 °C</option><option value="flash">Rápido (flash)</option><option value="other">Otro</option></select></Field>
          <Field label="Temperatura alcanzada (°C)"><input className="input" inputMode="decimal" value={f.temperatureC} onChange={(e) => setF({ ...f, temperatureC: e.target.value })} /></Field>
          <Field label="Duración (min)"><input className="input" inputMode="numeric" value={f.durationMin} onChange={(e) => setF({ ...f, durationMin: e.target.value })} /></Field>
          <Field label="Carga (qué se esterilizó)" span2><input className="input" aria-invalid={!!errors.loadDescription} value={f.loadDescription} onChange={(e) => setF({ ...f, loadDescription: e.target.value })} placeholder="Ej.: 6 kits de examen, fórceps, curetas" />{errors.loadDescription && <span className="hint" style={{ color: "var(--danger)" }}>{errors.loadDescription}</span>}</Field>
          <Field label="Paquetes"><input className="input" inputMode="numeric" aria-invalid={!!errors.packages} value={f.packages} onChange={(e) => setF({ ...f, packages: e.target.value })} /></Field>
          <Field label="Vencimiento del material"><input className="input" type="date" value={f.expiresOn} onChange={(e) => setF({ ...f, expiresOn: e.target.value })} /></Field>
        </div>
        <Field label="Indicador químico (cinta / integrador)" group>
          <div className="row">
            <button type="button" className={`btn ${f.chemicalIndicator === "pass" ? "btn-primary" : ""}`} style={{ minHeight: 48, flex: 1 }} onClick={() => setF({ ...f, chemicalIndicator: "pass" })}>Viró correctamente</button>
            <button type="button" className={`btn ${f.chemicalIndicator === "fail" ? "btn-danger" : ""}`} style={{ minHeight: 48, flex: 1, ...(f.chemicalIndicator === "fail" ? { background: "var(--danger-soft)" } : {}) }} onClick={() => setF({ ...f, chemicalIndicator: "fail" })}>No viró (falló)</button>
          </div>
          {errors.chemicalIndicator && <span className="hint" style={{ color: "var(--danger)" }}>{errors.chemicalIndicator}</span>}
        </Field>
        {f.chemicalIndicator === "fail" && <div className="alert danger">Si el indicador falló: no uses esta carga. Revisa el equipo y reprocesa el material en otro ciclo.</div>}
      </div>
    </Dialog>
  );
}

function BioDialog({ cycle, onClose, onSaved }: { cycle: any; onClose: () => void; onSaved: () => void }) {
  const toast = useToast();
  const [result, setResult] = useState<"" | "pass" | "fail">("");
  const [notes, setNotes] = useState("");
  const save = async () => {
    try { const r = await api.post(`/api/biosafety/cycles/${cycle.id}/bio`, { result, notes: notes || null }); toast(r.alert ?? "Resultado registrado", !!r.alert); onSaved(); }
    catch (e) { toast((e as Error).message, true); }
  };
  return (
    <Dialog title={`Indicador biológico · ${cycle.sterilizer} N° ${cycle.cycleNumber}`} onClose={onClose} footer={<><button className="btn" onClick={onClose}>Cancelar</button><button className="btn btn-primary" disabled={!result} onClick={save}>Guardar</button></>}>
      <div className="stack">
        <p className="muted">Registra la lectura de la ampolla o tira biológica incubada. Este registro no se puede modificar.</p>
        <div className="row">
          <button type="button" className={`btn ${result === "pass" ? "btn-primary" : ""}`} style={{ minHeight: 48, flex: 1 }} onClick={() => setResult("pass")}>Negativo (sin crecimiento)</button>
          <button type="button" className={`btn ${result === "fail" ? "btn-danger" : ""}`} style={{ minHeight: 48, flex: 1 }} onClick={() => setResult("fail")}>Positivo (crecimiento)</button>
        </div>
        {result === "fail" && <div className="alert danger">Un resultado positivo indica que el equipo no esterilizó. Suspende su uso, avisa a administración y revisa qué material de este ciclo se usó.</div>}
        <Field label="Nota (opcional)"><input className="input" value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
      </div>
    </Dialog>
  );
}
